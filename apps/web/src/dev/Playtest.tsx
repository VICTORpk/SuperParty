import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  BOT_CONFIG, GOLF, PLAYER_SPEED, blockIndex, isBlock, newBot, nearestTarget, stepBall, stepBot, strike, surfaceHeight,
  JUMP_VELOCITY, GRAVITY, isResting,
  type BotState, type GolfBall, type GolfWorld, type MapDoc,
} from "@jogo/shared";
import { Clouds, Flat } from "../scenery";
import { Avatar, type EmoteState } from "../Scene";
import { MapView } from "./MapView";
import type { Editor } from "./useEditor";

/**
 * Execução do mapa (pré-visualização jogável). Usa o mesmo desenho (`MapView`), a mesma altura do piso do editor e o
 * mesmo comportamento de bots do servidor (`stepBot`). Minigolfe tem a bola e a física própria; os demais tipos
 * deixam o personagem andar sobre o mapa.
 */

export interface PlayHud { strokes: number; power: number; message: string; golf: boolean; bots: number }

const noAction = () => undefined;
const STEP_UP = 0.9; // maior degrau que se sobe andando

function spawnOf(map: MapDoc): { x: number; z: number } {
  const order = ["spawn", "start", "tee"];
  for (const t of order) { const o = map.objects.find((x) => x.type === t); if (o) return { x: o.x, z: o.z }; }
  const b = map.objects.find(isBlock);
  return b ? { x: b.x, z: b.z } : { x: 0, z: 0 };
}

function useKeys() {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => { if (!typing()) keys.current.add(e.code); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  return keys;
}

/** Bot em execução: estado do cérebro + objetos do desenho. */
interface BotRun { id: string; brain: BotState; group: THREE.Group | null; speed: { current: number }; height: { current: number }; emote: { current: EmoteState | undefined } }

function BotActor({ run }: { run: BotRun }) {
  return (
    <group ref={(g) => { run.group = g; }}>
      <Avatar color="#64748b" nick="Bot" speed={run.speed} height={run.height} getEmote={() => run.emote.current} getAction={noAction} />
    </group>
  );
}

export function Playtest({ ed, onHud }: { ed: Editor; onHud: (h: PlayHud) => void }) {
  const { camera } = useThree();
  const map = ed.map;
  const idx = useMemo(() => blockIndex(map), [map]);
  const keys = useKeys();
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const golf = map.kind === "minigolf" && map.objects.some((o) => o.type === "tee");

  // ---- personagem
  const start = useMemo(() => spawnOf(map), []); // eslint-disable-line react-hooks/exhaustive-deps
  const player = useRef({ x: start.x, z: start.z, y: surfaceHeight(idx, start.x, start.z) ?? 0, vy: 0, air: 0, heading: 0 });
  const playerGroup = useRef<THREE.Group>(null);
  const pSpeed = useRef(0), pHeight = useRef(0);
  const camInit = useRef(false);

  // ---- bots: os da sessão + os `bot-spawn` do mapa; dados fixados ao iniciar a execução
  const bots = useMemo<BotRun[]>(() => {
    const spots: { id: string; x: number; z: number }[] = [
      ...ed.bots.map((b) => ({ id: b.id, x: b.x, z: b.z })),
      ...map.objects.filter((o) => o.type === "bot-spawn").map((o) => ({ id: o.id, x: o.x, z: o.z })),
    ].slice(0, BOT_CONFIG.maxBots + 6);
    return spots.map((s) => ({ id: s.id, brain: newBot(s.x, s.z), group: null, speed: { current: 0 }, height: { current: 0 }, emote: { current: undefined } }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const walk = (fromX: number, fromZ: number, nx: number, nz: number, fromY: number) => {
    const ok = (x: number, z: number) => { const h = surfaceHeight(idx, x, z); return h !== null && Math.abs(h - fromY) <= STEP_UP; };
    if (ok(nx, nz)) return { x: nx, z: nz };
    if (ok(nx, fromZ)) return { x: nx, z: fromZ };
    if (ok(fromX, nz)) return { x: fromX, z: nz };
    return { x: fromX, z: fromZ };
  };

  // ---- minigolfe
  const tee = map.objects.find((o) => o.type === "tee");
  const hole = map.objects.find((o) => o.type === "hole");
  const world = useMemo<GolfWorld>(() => ({
    surface: (x, z) => surfaceHeight(idx, x, z),
    walls: map.objects.filter((o) => o.type === "wall").map((o) => ({ x: o.x, z: o.z, halfLen: Number(o.props.length ?? 3) / 2, halfThick: 0.15, angle: o.rot * (Math.PI / 4) })),
    bumpers: map.objects.filter((o) => o.type === "bumper").map((o) => ({ x: o.x, z: o.z, r: Number(o.props.radius ?? 0.6) })),
    hole: hole ? { x: hole.x, z: hole.z } : null,
  }), [idx, map, hole]);
  const ball = useRef<GolfBall>({ x: tee?.x ?? 0, z: tee?.z ?? 0, vx: 0, vz: 0 });
  const rest = useRef({ x: ball.current.x, z: ball.current.z });
  const ballMesh = useRef<THREE.Mesh>(null);
  const g = useRef({ strokes: 0, charging: 0, sunk: false, message: "Segure Espaço para carregar a tacada e solte para bater. O sentido é o da câmera." });
  const lastHud = useRef(0);

  // reinicia a bola (R) e carrega/solta a tacada
  useEffect(() => {
    if (!golf) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyR" && !e.repeat) { ball.current = { x: tee!.x, z: tee!.z, vx: 0, vz: 0 }; rest.current = { x: tee!.x, z: tee!.z }; g.current.strokes = 0; g.current.sunk = false; g.current.message = "Bola de volta à saída."; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || g.current.charging <= 0.03 || g.current.sunk || !isResting(ball.current)) { if (e.code === "Space") g.current.charging = 0; return; }
      const dir = camera.getWorldDirection(new THREE.Vector3());
      ball.current = strike(ball.current, Math.atan2(dir.x, dir.z), g.current.charging);
      rest.current = { x: ball.current.x, z: ball.current.z };
      g.current.strokes += 1; g.current.charging = 0; g.current.message = "";
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [golf, tee, camera]);

  useFrame((s, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now();
    const c = controls.current;
    const k = keys.current;

    // câmera: segue a bola (golfe) ou o personagem
    const focus = golf ? new THREE.Vector3(ball.current.x, (surfaceHeight(idx, ball.current.x, ball.current.z) ?? 0) + 0.5, ball.current.z)
      : new THREE.Vector3(player.current.x, player.current.y + 1.2, player.current.z);
    if (c) {
      if (!camInit.current) {
        camInit.current = true;
        c.target.copy(focus);
        if (golf && hole) { // golfe: de trás da bola, olhando para o buraco
          const d = new THREE.Vector3(hole.x - focus.x, 0, hole.z - focus.z).normalize();
          camera.position.set(focus.x - d.x * 9, focus.y + 6, focus.z - d.z * 9);
        } else camera.position.set(focus.x + 7, focus.y + 8, focus.z + 10);
        c.update();
      }
      const before = c.target.clone();
      c.target.lerp(focus, 1 - Math.exp(-8 * dt));
      camera.position.add(c.target.clone().sub(before));
      c.update();
    }

    if (golf) {
      const b = ball.current;
      if (g.current.charging > 0 || k.has("Space")) {
        if (k.has("Space") && isResting(b) && !g.current.sunk) g.current.charging = Math.min(1, g.current.charging + dt / 1.4);
      }
      if (!isResting(b) && !g.current.sunk) {
        const ev = stepBall(b, dt, world);
        if (ev === "out") { // saiu do mapa: volta ao último ponto de repouso (conta uma tacada de penalidade)
          g.current.strokes += 1; g.current.message = "Fora do mapa! +1 tacada; a bola voltou.";
          ball.current = { x: rest.current.x, z: rest.current.z, vx: 0, vz: 0 };
        } else if (ev === "sunk") { g.current.sunk = true; g.current.message = `Buraco! ${g.current.strokes} tacada(s). Aperte R para jogar de novo.`; }
        else if (isResting(b)) rest.current = { x: b.x, z: b.z };
      }
      if (ballMesh.current) ballMesh.current.position.set(ball.current.x, (surfaceHeight(idx, ball.current.x, ball.current.z) ?? 0) + GOLF.radius, ball.current.z);
    } else {
      // andar: relativo à câmera
      const f = camera.getWorldDirection(new THREE.Vector3()); f.y = 0; f.normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      let mx = 0, mz = 0;
      if (k.has("KeyW") || k.has("ArrowUp")) { mx += f.x; mz += f.z; }
      if (k.has("KeyS") || k.has("ArrowDown")) { mx -= f.x; mz -= f.z; }
      if (k.has("KeyD") || k.has("ArrowRight")) { mx -= r.x; mz -= r.z; }
      if (k.has("KeyA") || k.has("ArrowLeft")) { mx += r.x; mz += r.z; }
      const len = Math.hypot(mx, mz);
      const p = player.current;
      const sp = k.has("ShiftLeft") ? PLAYER_SPEED * 1.6 : PLAYER_SPEED;
      pSpeed.current = len > 0 ? sp : 0;
      if (len > 0) {
        mx /= len; mz /= len;
        const to = walk(p.x, p.z, p.x + mx * sp * dt, p.z + mz * sp * dt, p.y);
        p.x = to.x; p.z = to.z;
        const target = Math.atan2(-mx, -mz);
        p.heading += Math.atan2(Math.sin(target - p.heading), Math.cos(target - p.heading)) * (1 - Math.exp(-14 * dt));
      }
      const ground = surfaceHeight(idx, p.x, p.z) ?? p.y;
      if (p.air === 0 && k.has("Space")) { p.vy = JUMP_VELOCITY; p.air = 1; }
      if (p.air) {
        p.vy -= GRAVITY * dt; p.y += p.vy * dt;
        if (p.y <= ground) { p.y = ground; p.vy = 0; p.air = 0; }
      } else p.y += (ground - p.y) * (1 - Math.exp(-20 * dt)); // acompanha rampas e degraus
      pHeight.current = Math.max(0, p.y - ground);
      playerGroup.current?.position.set(p.x, p.y, p.z);
      if (playerGroup.current) playerGroup.current.rotation.y = p.heading;
    }

    // bots: aproximam-se do jogador (ou da bola, no golfe) e acenam
    const goal = golf ? { x: ball.current.x, z: ball.current.z } : { x: player.current.x, z: player.current.z };
    for (const b of bots) {
      const resolve = (nx: number, nz: number) => {
        const y0 = surfaceHeight(idx, b.brain.x, b.brain.z) ?? 0;
        const h = surfaceHeight(idx, nx, nz);
        if (h !== null && Math.abs(h - y0) <= STEP_UP) return { x: nx, z: nz };
        const hx = surfaceHeight(idx, nx, b.brain.z);
        if (hx !== null && Math.abs(hx - y0) <= STEP_UP) return { x: nx, z: b.brain.z };
        const hz = surfaceHeight(idx, b.brain.x, nz);
        if (hz !== null && Math.abs(hz - y0) <= STEP_UP) return { x: b.brain.x, z: nz };
        return { x: b.brain.x, z: b.brain.z };
      };
      const { wave } = stepBot(b.brain, nearestTarget(b.brain.x, b.brain.z, [goal]), dt * 1000, now, Math.random, resolve);
      if (wave) b.emote.current = { name: "wave", start: now };
      b.speed.current = b.brain.speed;
      const y = surfaceHeight(idx, b.brain.x, b.brain.z) ?? 0;
      b.group?.position.set(b.brain.x, y, b.brain.z);
      if (b.group) b.group.rotation.y = b.brain.ry;
    }

    if (now - lastHud.current > 100) {
      lastHud.current = now;
      onHud({ strokes: g.current.strokes, power: g.current.charging, message: golf ? g.current.message : "", golf, bots: bots.length });
    }
    void s;
  });

  // marcador de direção da tacada
  const aim = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!golf || !aim.current) return;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(dir.x, dir.z);
    const show = isResting(ball.current) && !g.current.sunk;
    aim.current.visible = show;
    aim.current.position.set(ball.current.x + Math.sin(yaw) * 1.6, (surfaceHeight(idx, ball.current.x, ball.current.z) ?? 0) + 0.12, ball.current.z + Math.cos(yaw) * 1.6);
    aim.current.rotation.set(-Math.PI / 2, 0, -yaw);
    aim.current.scale.set(1, 1 + g.current.charging * 2.5, 1);
  });

  return (
    <>
      <color attach="background" args={["#bfe3f7"]} />
      <hemisphereLight args={["#ffffff", "#8ac56a", 1.1]} />
      <directionalLight position={[20, 40, 15]} intensity={1.3} color="#fff6e0" />
      <OrbitControls ref={controls as never} makeDefault enablePan={false} minDistance={4} maxDistance={40} maxPolarAngle={Math.PI * 0.49} />
      <Clouds count={6} radius={90} height={[30, 46]} seed={4} />
      <MapView map={map} />
      {!golf && <group ref={playerGroup}><Avatar color="#ef4444" nick="Você" speed={pSpeed} height={pHeight} getEmote={() => undefined} getAction={noAction} /></group>}
      {golf && (
        <>
          <mesh ref={ballMesh}><sphereGeometry args={[GOLF.radius, 14, 10]} /><Flat color="#ffffff" /></mesh>
          <mesh ref={aim}><coneGeometry args={[0.28, 1, 3]} /><meshBasicMaterial color="#facc15" transparent opacity={0.85} /></mesh>
        </>
      )}
      {bots.map((b) => <BotActor key={b.id} run={b} />)}
    </>
  );
}

