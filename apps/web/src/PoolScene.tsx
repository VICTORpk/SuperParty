import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  C, POCKETS, POOL, POOL_OUT, groupOf, isValidCuePlacement, predictAim,
  type ImpostorPublicState, type PlayerInfo, type PoolShotMsg, type SimBall, type TableState,
} from "@jogo/shared";
import { Avatar, type ActionState, type Bubble, type EmoteState } from "./Scene";
import { Flat, seeded } from "./scenery";
import { BALL_COLORS } from "./poolStyle";
import type { Settings } from "./controls";

type Ref<T> = React.MutableRefObject<T>;

/** Estado da interação local, lido pela interface (HUD). */
export interface PoolUi {
  charging: boolean;
  power: number;
  canShoot: boolean;
  placing: boolean;
  placeValid: boolean;
  replay: boolean;
  /** Ângulo de mira atual (usado pelo controle de força por toque). */
  aim: number;
}

export interface PoolSceneProps {
  room: Room;
  you: string;
  players: PlayerInfo[];
  /** Estado comum da mesa (sinuca clássica ou Impostor). */
  pool: Ref<TableState | null>;
  /** Jogadores sentados ao redor da mesa, na ordem das cadeiras. */
  seats: string[];
  /** Estado extra do modo Impostor (garrafa, acertos); null na sinuca clássica. */
  imp: Ref<ImpostorPublicState | null>;
  shot: Ref<PoolShotMsg | null>;
  ui: Ref<PoolUi>;
  bubbles: Record<string, Bubble>;
  emotes: Ref<Map<string, EmoteState>>;
  settingsRef: Ref<Settings>;
  uiBlock: Ref<boolean>;
}

const R = POOL.ballR;
const noAction = () => undefined;

// ---------------------------------------------------------------- texturas
function makeBallTexture(id: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d")!;
  const color = BALL_COLORS[id]!;
  const stripe = groupOf(id) === "stripe";
  g.fillStyle = id === 0 || stripe ? "#f8f8f2" : color;
  g.fillRect(0, 0, 256, 128);
  if (stripe) { g.fillStyle = color; g.fillRect(0, 34, 256, 60); }
  if (id > 0) {
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(128, 64, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#111";
    g.font = "bold 30px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(id), 128, 66);
  } else {
    g.fillStyle = "#e11d48";
    g.beginPath(); g.arc(128, 64, 6, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeWoodTexture(base: string, dark: string, planks = 12): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  const w = 512 / planks;
  const r = seeded(9);
  for (let i = 0; i < planks; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? "0,0,0" : "255,255,255"},${0.05 + r() * 0.07})`;
    g.fillRect(i * w, 0, w, 512);
    g.fillStyle = dark; g.fillRect(i * w + w - 3, 0, 3, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- cabana e mesa
function Cabin() {
  const floor = useMemo(() => { const t = makeWoodTexture("#b07a45", "#6b4423"); t.repeat.set(4, 4); return t; }, []);
  const wall = useMemo(() => { const t = makeWoodTexture("#c9975f", "#7a5230", 16); t.repeat.set(3, 1); return t; }, []);
  useEffect(() => () => { floor.dispose(); wall.dispose(); }, [floor, wall]);
  return (
    <>
      <color attach="background" args={["#2b1d14"]} />
      <fog attach="fog" args={["#2b1d14", 22, 48]} />
      <hemisphereLight args={["#ffe9c7", "#5a3a22", 0.75]} />
      <pointLight position={[0, 4.8, 0]} intensity={150} distance={40} decay={1.6} color="#ffe2b0" />
      <directionalLight position={[-6, 8, 10]} intensity={0.35} color="#ffd9a0" />

      {/* chão, tapete e paredes de madeira */}
      <mesh position={[0, -2.6, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[40, 30]} /><meshStandardMaterial map={floor} roughness={0.9} /></mesh>
      <mesh position={[0, -2.59, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[18, 11]} /><meshStandardMaterial color="#7a2e2e" roughness={1} /></mesh>
      <mesh position={[0, 2.4, -12]}><planeGeometry args={[40, 10]} /><meshStandardMaterial map={wall} roughness={0.95} /></mesh>
      <mesh position={[-18, 2.4, 0]} rotation-y={Math.PI / 2}><planeGeometry args={[30, 10]} /><meshStandardMaterial map={wall} roughness={0.95} /></mesh>
      <mesh position={[18, 2.4, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[30, 10]} /><meshStandardMaterial map={wall} roughness={0.95} /></mesh>
      {/* janela com vista para o mar */}
      <group position={[-8, 2.2, -11.9]}>
        <mesh><planeGeometry args={[4.4, 3.2]} /><meshBasicMaterial color="#8fd3ff" /></mesh>
        <mesh position={[0, -0.9, 0.01]}><planeGeometry args={[4.4, 1.3]} /><meshBasicMaterial color="#27c3d9" /></mesh>
        {[[0, 1.7, 4.8, 0.2], [0, -1.7, 4.8, 0.2], [-2.3, 0, 0.2, 3.6], [2.3, 0, 0.2, 3.6], [0, 0, 0.12, 3.2], [0, 0, 4.4, 0.12]].map(([x, y, w, h], i) => (
          <mesh key={i} position={[x!, y!, 0.05]}><boxGeometry args={[w!, h!, 0.12]} /><Flat color="#5a3a22" /></mesh>
        ))}
      </group>
      {/* arandelas na parede (a luz principal fica acima da mesa, fora do campo de visão) */}
      {[-14, -4, 6, 14].map((x) => (
        <group key={x} position={[x, 2.6, -11.8]}>
          <mesh><boxGeometry args={[0.3, 0.5, 0.2]} /><Flat color="#3a2616" /></mesh>
          <mesh position={[0, 0.45, 0.1]}><sphereGeometry args={[0.22, 10, 8]} /><meshBasicMaterial color="#ffe2a8" /></mesh>
        </group>
      ))}
      {/* estante com troféus e quadros */}
      <mesh position={[8, 1.2, -11.6]}><boxGeometry args={[5, 0.2, 0.8]} /><Flat color="#6b4423" /></mesh>
      {[6.6, 8, 9.4].map((x, i) => <mesh key={x} position={[x, 1.75, -11.6]}><cylinderGeometry args={[0.2, 0.28, 0.7 + i * 0.12, 8]} /><Flat color={["#f5c518", "#cbd5e1", "#f59e0b"][i]!} /></mesh>)}
    </>
  );
}

/** Mesa em estilo "low poly" de cores chapadas: feltro verde, tabelas claras, caçapas escuras nos cantos e pés laranja. */
const TABLE = { felt: "#3fa655", cushion: "#2f8a43", rail: "#f2b685", apron: "#f47c3a", leg: "#f9863f", cap: "#26273a", hole: "#4a2c1a" };

function PoolTable() {
  const { halfW: W, halfD: D } = POOL;
  const capY = 0.12;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}><planeGeometry args={[W * 2 + 0.6, D * 2 + 0.6]} /><Flat color={TABLE.felt} /></mesh>
      {/* marcas: linha da cabeceira e pontos */}
      <mesh rotation-x={-Math.PI / 2} position={[POOL.head.x, 0.003, 0]}><planeGeometry args={[0.03, D * 2 - 0.3]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.28} /></mesh>
      {[POOL.head.x, POOL.foot.x].map((x) => <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.004, 0]}><circleGeometry args={[0.05, 10]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.5} /></mesh>)}
      {/* bordas de madeira clara */}
      {[-1, 1].map((s) => <mesh key={`z${s}`} position={[0, 0.05, s * (D + 0.6)]}><boxGeometry args={[W * 2 + 2.4, 0.5, 0.9]} /><Flat color={TABLE.rail} /></mesh>)}
      {[-1, 1].map((s) => <mesh key={`x${s}`} position={[s * (W + 0.6), 0.05, 0]}><boxGeometry args={[0.9, 0.5, D * 2 + 0.6]} /><Flat color={TABLE.rail} /></mesh>)}
      {/* almofadas (tabelas) com vão nas caçapas */}
      {[-1, 1].flatMap((s) => [-1, 1].map((h) => (
        <mesh key={`c${s}${h}`} position={[h * (W / 2 + 0.25), 0.16, s * (D + 0.13)]}><boxGeometry args={[W - 0.6, 0.26, 0.28]} /><Flat color={TABLE.cushion} /></mesh>
      )))}
      {[-1, 1].map((s) => <mesh key={`e${s}`} position={[s * (W + 0.13), 0.16, 0]}><boxGeometry args={[0.28, 0.26, D * 2 - 0.9]} /><Flat color={TABLE.cushion} /></mesh>)}
      {/* caçapas: boca marrom no feltro e fundo escuro */}
      {POCKETS.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[p.r + 0.04, 14]} /><meshBasicMaterial color={TABLE.hole} /></mesh>
          <mesh position={[0, -0.3, 0]}><cylinderGeometry args={[p.r, p.r * 0.8, 0.6, 14]} /><meshBasicMaterial color="#120b07" /></mesh>
        </group>
      ))}
      {/* blocos escuros nos cantos e nas laterais, sobre as caçapas */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`k${sx}${sz}`} position={[sx * (W + 0.5), capY, sz * (D + 0.5)]} rotation-y={Math.PI / 4}><boxGeometry args={[1.05, 0.62, 1.05]} /><Flat color={TABLE.cap} /></mesh>
      )))}
      {[-1, 1].map((sz) => <mesh key={`m${sz}`} position={[0, capY, sz * (D + 0.58)]}><boxGeometry args={[0.9, 0.62, 0.8]} /><Flat color={TABLE.cap} /></mesh>)}
      {/* saia e pés laranja afunilados */}
      <mesh position={[0, -0.42, 0]}><boxGeometry args={[W * 2 + 2.1, 0.5, D * 2 + 1.5]} /><Flat color={TABLE.apron} /></mesh>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`l${sx}${sz}`} position={[sx * (W - 0.1), -1.55, sz * (D - 0.05)]} rotation-y={Math.PI / 4}><cylinderGeometry args={[0.62, 0.42, 2.1, 4]} /><Flat color={TABLE.leg} /></mesh>
      )))}
    </group>
  );
}

// ---------------------------------------------------------------- bolas, taco e guia
const UP_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

interface Replay { shot: PoolShotMsg; start: number }

/** Dá a posição de cada bola no instante t da gravação (interpolando entre os quadros). */
function frameAt(shot: PoolShotMsg, t: number): number[] {
  const rec = shot.recording;
  const f = Math.min(rec.frames.length - 1, Math.max(0, t / rec.frameMs));
  const i = Math.floor(f), k = f - i;
  const a = rec.frames[i]!, b = rec.frames[Math.min(rec.frames.length - 1, i + 1)]!;
  return a.map((v, n) => (v === POOL_OUT || b[n] === POOL_OUT ? v : v + (b[n]! - v) * k));
}

function Balls({ props, replay, cueGhost }: { props: PoolSceneProps; replay: Ref<Replay | null>; cueGhost: Ref<{ x: number; z: number; show: boolean; valid: boolean }> }) {
  const textures = useMemo(() => Array.from({ length: 16 }, (_, id) => makeBallTexture(id)), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const prev = useRef<({ x: number; z: number } | null)[]>(new Array(16).fill(null));
  const ghost = useRef<THREE.Mesh>(null);
  const lastShotId = useRef(0);

  useFrame(() => {
    const state = props.pool.current;
    const shot = props.shot.current;
    if (!state) return;
    // inicia a reprodução quando chega uma tacada nova
    if (shot && shot.shotId !== lastShotId.current) {
      lastShotId.current = shot.shotId;
      replay.current = { shot, start: performance.now() };
    }
    let rep = replay.current;
    const tms = rep ? performance.now() - rep.start : 0;
    if (rep && tms > rep.shot.recording.totalMs + 400) { replay.current = null; rep = null; }
    props.ui.current.replay = !!rep;

    const frame = rep ? frameAt(rep.shot, tms) : null;
    for (let id = 0; id < 16; id++) {
      const m = meshes.current[id];
      if (!m) continue;
      let x: number, z: number, y = R, visible = true, scale = 1;
      const sb = state.balls.find((b) => b.id === id);
      if (frame) {
        const fx = frame[id * 2]!, fz = frame[id * 2 + 1]!;
        if (fx === POOL_OUT) {
          // caiu durante a tacada: afunda na caçapa
          const ev = rep!.shot.recording.events.find((e) => e.kind === "pocket" && e.ball === id);
          const pk = ev && ev.kind === "pocket" ? POCKETS[ev.pocket]! : null;
          const since = ev ? (tms - ev.t) / 1000 : 9;
          if (!pk || since > 0.5) visible = false;
          x = pk ? pk.x : 0; z = pk ? pk.z : 0;
          y = R - since * 2.4;
          scale = Math.max(0.2, 1 - since);
        } else { x = fx / 100; z = fz / 100; }
      } else if (sb && !sb.out) { x = sb.x; z = sb.z; }
      else { x = 0; z = 0; visible = false; }
      if (id === 0 && !frame && state.ballInHand && state.phase === "placing") visible = false; // a branca "está na mão"
      m.visible = visible;
      m.position.set(x, y, z);
      m.scale.setScalar(scale);
      // rolamento
      const p = prev.current[id];
      if (visible && p) {
        const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
        if (d > 1e-5 && d < 1) m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx).normalize(), d / R));
      }
      prev.current[id] = visible ? { x, z } : null;
    }

    const g = ghost.current;
    if (g) {
      const cg = cueGhost.current;
      g.visible = cg.show;
      g.position.set(cg.x, R, cg.z);
      (g.material as THREE.MeshStandardMaterial).color.set(cg.valid ? "#ffffff" : "#ff5555");
    }
  });

  return (
    <>
      {Array.from({ length: 16 }, (_, id) => (
        <mesh key={id} ref={(el) => { meshes.current[id] = el; if (el && !el.userData.init) { el.quaternion.copy(UP_Q); el.userData.init = true; } }}>
          <sphereGeometry args={[R, 24, 16]} />
          <meshStandardMaterial map={textures[id]} roughness={0.25} metalness={0.05} />
        </mesh>
      ))}
      <mesh ref={ghost} visible={false}>
        <sphereGeometry args={[R, 18, 12]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.55} />
      </mesh>
    </>
  );
}

function CueAndGuide({ props, replay, aim }: { props: PoolSceneProps; replay: Ref<Replay | null>; aim: Ref<{ angle: number; has: boolean }> }) {
  const stick = useRef<THREE.Group>(null);
  const line = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const outLine = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const state = props.pool.current;
    const grp = stick.current;
    if (!state || !grp) return;
    const rep = replay.current;
    const cueBall = state.balls.find((b) => b.id === 0);
    const canShoot = props.ui.current.canShoot;
    let show = false, angle = aim.current.angle, pull = 0.25, ax = cueBall?.x ?? 0, az = cueBall?.z ?? 0;

    if (rep) {
      // golpe do taco no início da reprodução (visto por todos)
      const t = performance.now() - rep.start;
      if (t < 380) {
        show = true; angle = rep.shot.angle;
        const f0 = rep.shot.recording.frames[0]!;
        ax = f0[0]! / 100; az = f0[1]! / 100;
        pull = t < 140 ? 0.25 + rep.shot.power * 1.6 * (1 - t / 140) : 0;
        grp.visible = t < 300;
      }
    } else if (canShoot && cueBall && !cueBall.out) {
      show = true;
      pull = 0.25 + (props.ui.current.charging ? props.ui.current.power * 1.8 : 0);
    }
    grp.visible = show && (rep ? grp.visible : true);
    if (show) {
      grp.position.set(ax, R + 0.02, az);
      grp.rotation.set(0, -angle, 0);
      grp.children[0]!.position.set(-(R + 0.02 + pull + 2.4), 0, 0);
    }

    // guia de mira
    const showGuide = canShoot && !!cueBall && !cueBall.out && !rep;
    for (const m of [line.current, ring.current, outLine.current]) if (m) m.visible = false;
    if (showGuide && line.current && ring.current && outLine.current) {
      const balls: SimBall[] = state.balls.map((b) => ({ id: b.id, x: b.x, z: b.z, vx: 0, vz: 0, out: b.out }));
      const p = predictAim(balls, angle);
      const len = Math.hypot(p.x - cueBall.x, p.z - cueBall.z);
      line.current.visible = true;
      line.current.position.set((cueBall.x + p.x) / 2, R + 0.01, (cueBall.z + p.z) / 2);
      line.current.rotation.set(0, -angle, 0);
      line.current.scale.set(len, 1, 1);
      ring.current.visible = true;
      ring.current.position.set(p.x, R + 0.01, p.z);
      if (p.hit !== null) {
        outLine.current.visible = true;
        const a2 = Math.atan2(p.outZ, p.outX);
        outLine.current.position.set(p.x + p.outX * 0.7 + p.outX * R * 2, R + 0.01, p.z + p.outZ * 0.7 + p.outZ * R * 2);
        outLine.current.rotation.set(0, -a2, 0);
      }
    }
  });

  return (
    <>
      <group ref={stick} visible={false}>
        <group>
          <mesh rotation-z={Math.PI / 2}><cylinderGeometry args={[0.022, 0.05, 4.8, 10]} /><Flat color="#d6a76a" /></mesh>
          <mesh position={[2.45, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.024, 0.024, 0.1, 10]} /><Flat color="#3b82f6" /></mesh>
          <mesh position={[-1.7, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.052, 0.052, 1.5, 10]} /><Flat color="#4a2f1a" /></mesh>
        </group>
      </group>
      <mesh ref={line} visible={false}><boxGeometry args={[1, 0.004, 0.025]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.7} /></mesh>
      <mesh ref={ring} visible={false} rotation-x={-Math.PI / 2}><ringGeometry args={[R * 0.92, R * 1.08, 24]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh ref={outLine} visible={false}><boxGeometry args={[1.4, 0.004, 0.02]} /><meshBasicMaterial color="#ffe066" transparent opacity={0.85} /></mesh>
    </>
  );
}

/** Entrada do jogador: mouse mira, clique + arrastar para baixo dá a força, soltar dá a tacada. */
function PoolInput({ props, replay, aim, cueGhost }: { props: PoolSceneProps; replay: Ref<Replay | null>; aim: Ref<{ angle: number; has: boolean }>; cueGhost: Ref<{ x: number; z: number; show: boolean; valid: boolean }> }) {
  const { pool, ui, room, you, uiBlock } = props;
  const point = useRef({ x: 0, z: 0 });
  const charge = useRef<{ startY: number; angle: number } | null>(null);

  const myState = () => {
    const s = pool.current;
    const mine = !!s && s.turn === you && !replay.current;
    return {
      s,
      canShoot: mine && (s!.phase === "aim" || s!.phase === "break"),
      placing: mine && s!.phase === "placing",
    };
  };

  useFrame(() => {
    const { s, canShoot, placing } = myState();
    ui.current.canShoot = canShoot;
    ui.current.placing = placing;
    ui.current.aim = aim.current.angle;
    if (!s) return;
    const cue = s.balls.find((b) => b.id === 0);
    if (canShoot && cue && !charge.current) aim.current = { angle: Math.atan2(point.current.z - cue.z, point.current.x - cue.x), has: true };
    if (placing) {
      const balls: SimBall[] = s.balls.map((b) => ({ id: b.id, x: b.x, z: b.z, vx: 0, vz: 0, out: b.out }));
      const valid = isValidCuePlacement(balls, point.current.x, point.current.z);
      cueGhost.current = { x: point.current.x, z: point.current.z, show: true, valid };
      ui.current.placeValid = valid;
    } else cueGhost.current.show = false;
  });

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const c = charge.current;
      if (!c) return;
      const power = Math.min(1, Math.max(0, (e.clientY - c.startY) / (window.innerHeight * 0.3)));
      ui.current.power = power;
    };
    const up = (e: PointerEvent) => {
      const c = charge.current;
      if (!c || e.button !== 0) return;
      charge.current = null;
      ui.current.charging = false;
      const power = ui.current.power;
      ui.current.power = 0;
      if (power >= 0.05 && myState().canShoot) room.send(C.PoolShoot, { angle: c.angle, power });
    };
    const cancel = () => { charge.current = null; ui.current.charging = false; ui.current.power = 0; };
    const key = (e: KeyboardEvent) => { if (e.code === "Escape") cancel(); };
    const ctx = (e: MouseEvent) => { if (e.target instanceof HTMLCanvasElement) { e.preventDefault(); cancel(); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("contextmenu", ctx);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("contextmenu", ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, you]);

  return (
    <mesh position={[0, R, 0]} rotation-x={-Math.PI / 2}
      onPointerMove={(e) => { point.current = { x: e.point.x, z: e.point.z }; }}
      onPointerDown={(e) => {
        if (e.button !== 0 || uiBlock.current) return;
        point.current = { x: e.point.x, z: e.point.z };
        const { canShoot, placing, s } = myState();
        if (placing && s) {
          const balls: SimBall[] = s.balls.map((b) => ({ id: b.id, x: b.x, z: b.z, vx: 0, vz: 0, out: b.out }));
          if (isValidCuePlacement(balls, point.current.x, point.current.z)) room.send(C.PoolPlace, { x: point.current.x, z: point.current.z });
        } else if (canShoot && e.nativeEvent.pointerType !== "touch") {
          // no toque, arrastar só mira; a força vem do controle lateral (ver PoolHUD)
          const cue = s!.balls.find((b) => b.id === 0);
          const angle = cue ? Math.atan2(point.current.z - cue.z, point.current.x - cue.x) : aim.current.angle;
          aim.current = { angle, has: true };
          charge.current = { startY: e.nativeEvent.clientY, angle };
          ui.current.charging = true;
          ui.current.power = 0;
        }
      }}>
      <planeGeometry args={[40, 24]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Posição de cada jogador ao redor da mesa. Com 2 jogadores ficam nas pontas; com mais, numa elipse. */
export function seatPosition(i: number, n: number): { x: number; z: number; angle: number } {
  if (n <= 2) return { x: i === 0 ? -9.8 : 9.8, z: 0, angle: i === 0 ? Math.PI : 0 };
  // arco no fundo e nas laterais da mesa (o lado da câmera fica livre)
  const a = Math.PI + ((i + 0.5) / n) * Math.PI;
  const x = Math.cos(a) * 11.6, z = Math.sin(a) * 7.4;
  return { x, z, angle: Math.atan2(z, x) };
}

const GLASS = "#3fae6a";

/** Garrafa girando sobre a mesa: aponta para o alvo sorteado pelo servidor. */
function Bottle({ imp, seats }: { imp: Ref<ImpostorPublicState | null>; seats: string[] }) {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const seen = useRef<{ key: number; start: number; extra: number } | null>(null);
  useFrame((st) => {
    const grp = g.current;
    const s = imp.current;
    if (!grp) return;
    const b = s?.bottle;
    const show = !!s && (s.phase === "bottle" || s.phase === "decision" || s.phase === "result") && !!(b || s.decisionTarget);
    grp.visible = show;
    if (ring.current) ring.current.visible = show;
    if (!show || !s) return;
    const targetId = b?.target ?? s.decisionTarget!;
    const idx = seats.indexOf(targetId);
    const seat = seatPosition(Math.max(0, idx), seats.length);
    if (b && (!seen.current || seen.current.key !== b.startAt)) seen.current = { key: b.startAt, start: performance.now(), extra: 4 + Math.random() * 2 };
    const t = b && seen.current ? Math.min(1, (performance.now() - seen.current.start) / b.durationMs) : 1;
    const ease = 1 - Math.pow(1 - t, 3);
    const total = seat.angle + (1 - ease) * (seen.current?.extra ?? 0) * Math.PI * 2;
    grp.rotation.y = -total;
    grp.position.y = 0.75 + Math.sin(st.clock.elapsedTime * 3) * 0.04;
    if (ring.current) ring.current.rotation.z = st.clock.elapsedTime * 0.8;
  });
  return (
    <>
      <mesh ref={ring} position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.75, 0.95, 28]} /><meshBasicMaterial color="#ffe066" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <group ref={g} visible={false}>
        <mesh rotation-z={Math.PI / 2}><cylinderGeometry args={[0.26, 0.26, 1.0, 14]} /><Flat color={GLASS} /></mesh>
        <mesh position={[0.78, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.09, 0.17, 0.6, 12]} /><Flat color={GLASS} /></mesh>
        <mesh position={[1.12, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.11, 0.11, 0.1, 12]} /><Flat color="#ffd23f" /></mesh>
        <mesh position={[-0.05, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.27, 0.27, 0.45, 14]} /><Flat color="#fff6dc" /></mesh>
      </group>
    </>
  );
}

export function PoolContent(props: PoolSceneProps) {
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const size = useThree((st) => st.size);
  // a câmera se afasta o necessário para a mesa inteira caber, qualquer que seja a proporção da tela
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    camera.fov = 42; camera.near = 0.1; camera.far = 200;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const d = Math.max(13.5, 8.6 / (t * aspect), 6.2 / t);
    camera.position.set(0, d * 0.8, d * 0.6 + 0.3);
    camera.lookAt(0, 0, 0.3);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  const replay = useRef<Replay | null>(null);
  const aim = useRef({ angle: 0, has: false });
  const cueGhost = useRef({ x: 0, z: 0, show: false, valid: true });
  const idle = useRef(0);
  const actions = useRef(new Map<string, ActionState>());
  const lastHitKey = useRef(0);
  useFrame(() => {
    const h = props.imp.current?.lastHit;
    if (h && h.key !== lastHitKey.current) {
      lastHitKey.current = h.key;
      if (h.attacked) {
        actions.current.set(h.attacker, { kind: "punch", start: performance.now() });
        actions.current.set(h.target, { kind: "hit", start: performance.now() + 250 });
      }
    }
  });

  return (
    <>
      <Cabin />
      <PoolTable />
      <Balls props={props} replay={replay} cueGhost={cueGhost} />
      <CueAndGuide props={props} replay={replay} aim={aim} />
      <PoolInput props={props} replay={replay} aim={aim} cueGhost={cueGhost} />
      <Bottle imp={props.imp} seats={props.seats} />
      {props.seats.map((id, i) => {
        const info = props.players.find((pl) => pl.id === id);
        const me = props.imp.current?.players.find((pl) => pl.id === id);
        if (!info || (me && !me.alive)) return null; // eliminados viram espectadores: saem da mesa
        const seat = seatPosition(i, props.seats.length);
        return (
          <group key={id} position={[seat.x, -2.6, seat.z]} rotation-y={Math.atan2(seat.x, seat.z)} scale={props.seats.length > 2 ? 2.1 : 2.4}>
            <Avatar color={info.color} nick={info.nick} bubble={props.bubbles[id]?.text} speed={idle} height={idle}
              getEmote={() => props.emotes.current.get(id)} getAction={() => actions.current.get(id)} />
          </group>
        );
      })}
    </>
  );
}
