import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  ARENA, C, type ArenaEvent, type ArenaSnapshot, type FighterSnap, type PlayerInfo,
} from "@jogo/shared";
import { Avatar, HpBar, ACTION_DUR, type ActionState, type Bubble, type EmoteState } from "./Scene";
import { Clouds, FacetedWater, Flat, Palm, PALETTE, Rock, Island } from "./scenery";
import { isDown, type Settings } from "./controls";
import type { TouchState } from "./platform";

type Ref<T> = React.MutableRefObject<T>;

export interface ArenaSceneProps {
  room: Room;
  you: string;
  players: PlayerInfo[];
  arena: Ref<ArenaSnapshot | null>;
  events: Ref<ArenaEvent[]>;
  bubbles: Record<string, Bubble>;
  emotes: Ref<Map<string, EmoteState>>;
  settingsRef: Ref<Settings>;
  uiBlock: Ref<boolean>;
  touch: Ref<TouchState>;
}

const WATER_Y = -1.3;

/** Plataforma de madeira suspensa sobre o mar, com postes e corda. */
function Platform() {
  const R = ARENA.radius;
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#c8975a";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? "#b8854a" : "#d6a76a";
      g.fillRect(i * 32, 0, 30, 512);
      g.fillStyle = "rgba(0,0,0,.12)";
      g.fillRect(i * 32 + 29, 0, 3, 512);
    }
    // anel de "luta" no centro
    g.strokeStyle = "rgba(255,255,255,.55)";
    g.lineWidth = 8;
    g.beginPath(); g.arc(256, 256, 70, 0, Math.PI * 2); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const posts = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 })), []);
  return (
    <group>
      <mesh position={[0, -0.3, 0]}><cylinderGeometry args={[R, R * 0.96, 0.6, 28]} /><Flat color="#9a6a3a" /></mesh>
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[R - 0.02, 28]} /><meshStandardMaterial map={tex} roughness={0.9} /></mesh>
      <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[R - 0.45, R - 0.05, 28]} /><meshStandardMaterial color="#ffd23f" roughness={0.8} /></mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return <mesh key={i} position={[Math.cos(a) * R * 0.7, -2.2, Math.sin(a) * R * 0.7]}><cylinderGeometry args={[0.55, 0.7, 3.8, 8]} /><Flat color="#7a4f2a" /></mesh>;
      })}
      {posts.map((p, i) => (
        <mesh key={i} position={[Math.cos(p.a) * (R - 0.2), 0.8, Math.sin(p.a) * (R - 0.2)]}>
          <cylinderGeometry args={[0.16, 0.2, 1.6, 6]} /><Flat color={i % 2 ? "#ff5a5f" : "#ffd23f"} />
        </mesh>
      ))}
      <mesh position={[0, 1.25, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[R - 0.2, 0.06, 6, 56]} /><Flat color="#e8d6a8" /></mesh>
    </group>
  );
}

function World() {
  return (
    <>
      <color attach="background" args={["#8fd3ff"]} />
      <fog attach="fog" args={["#bfe8ff", 40, 150]} />
      <hemisphereLight args={["#ffffff", "#7fd36b", 1.1]} />
      <directionalLight position={[10, 20, 8]} intensity={1.3} color="#fff6e0" />
      <FacetedWater width={240} depth={240} segments={46} position={[0, WATER_Y, 0]} color="#27c3d9" opacity={0.94} />
      <Platform />
      {[{ x: -24, z: -16, r: 5 }, { x: 28, z: -10, r: 6 }, { x: 20, z: 24, r: 4.5 }, { x: -22, z: 22, r: 4 }].map((it, i) => (
        <group key={i} position={[it.x, WATER_Y + 0.9, it.z]}>
          <Island radius={it.r} top={PALETTE.grass[i % 3]} layers={[PALETTE.sand, PALETTE.dirt, PALETTE.clay]} />
          <Palm position={[0.3, 0, 0.2]} scale={1.0} lean={0.3} rotation={i} />
          <Rock position={[-it.r * 0.4, 0.3, it.r * 0.1]} scale={1.2} seed={i + 4} />
        </group>
      ))}
      <Clouds count={10} radius={60} height={[14, 30]} seed={21} />
    </>
  );
}

const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function Fighter({ info, arena, bubble, emotes, actions }:
  { info: PlayerInfo; arena: Ref<ArenaSnapshot | null>; bubble?: string; emotes: Ref<Map<string, EmoteState>>; actions: Ref<Map<string, ActionState>> }) {
  const group = useRef<THREE.Group>(null);
  const speed = useRef(0);
  const height = useRef(0);
  const hp = useRef<number>(ARENA.hp);
  const init = useRef(false);
  const seen = useRef({ action: 0, hit: 0 });
  const getEmote = () => emotes.current.get(info.id);
  const getAction = () => actions.current.get(info.id);

  useFrame((_, dt) => {
    const g = group.current;
    const f: FighterSnap | undefined = arena.current?.fighters.find((x) => x.id === info.id);
    if (!g || !f) return;
    hp.current = f.hp;
    if (!init.current) { g.position.set(f.x, f.y, f.z); g.rotation.y = f.ry; init.current = true; }
    const k = 1 - Math.exp(-18 * dt);
    const px = g.position.x, pz = g.position.z;
    g.position.x += (f.x - g.position.x) * k;
    g.position.z += (f.z - g.position.z) * k;
    g.position.y += (f.y - g.position.y) * Math.min(1, k * 1.4);
    const v = Math.hypot(g.position.x - px, g.position.z - pz) / Math.max(dt, 1e-3);
    speed.current += (v - speed.current) * 0.3;
    g.rotation.y = lerpAngle(g.rotation.y, f.ry, 1 - Math.exp(-16 * dt));
    height.current = g.position.y;
    // animações de golpe e de reação, a partir do que o servidor informa
    if (f.action && f.action.startAt !== seen.current.action) {
      seen.current.action = f.action.startAt;
      actions.current.set(info.id, { kind: f.action.kind, start: performance.now() });
    }
    if (f.hitAt && f.hitAt !== seen.current.hit) {
      seen.current.hit = f.hitAt;
      actions.current.set(info.id, { kind: "hit", start: performance.now() });
    }
  });

  return (
    <group ref={group}>
      <Avatar color={info.color} nick={info.nick} bubble={bubble} speed={speed} height={height} hp={hp} getEmote={getEmote} getAction={getAction} />
    </group>
  );
}

interface Fx { key: number; kind: "hit" | "splash"; x: number; y: number; z: number; t0: number }

function EffectView({ fx }: { fx: Fx }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const age = (performance.now() - fx.t0) / 1000;
    const dur = fx.kind === "hit" ? 0.4 : 1.0;
    const k = Math.min(1, age / dur);
    grp.scale.setScalar(fx.kind === "hit" ? 0.5 + k * 1.6 : 0.4 + k * 3);
    grp.children.forEach((c) => { const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial; if (m) m.opacity = Math.max(0, 1 - k); });
  });
  return (
    <group ref={g} position={[fx.x, fx.y, fx.z]}>
      {fx.kind === "hit"
        ? [0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.05) * 0.45, Math.sin(i * 2.1) * 0.3, Math.sin(i * 1.05) * 0.45]}>
            <icosahedronGeometry args={[0.16, 0]} /><meshBasicMaterial color="#ffe066" transparent opacity={1} depthWrite={false} />
          </mesh>))
        : <>
          <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[0.6, 0.9, 20]} /><meshBasicMaterial color="#ffffff" transparent opacity={1} depthWrite={false} side={THREE.DoubleSide} /></mesh>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <mesh key={i} position={[Math.cos(i * 0.9) * 0.5, 0.4 + (i % 3) * 0.2, Math.sin(i * 0.9) * 0.5]}>
              <icosahedronGeometry args={[0.14, 0]} /><meshBasicMaterial color="#bff3ff" transparent opacity={1} depthWrite={false} />
            </mesh>))}
        </>}
    </group>
  );
}

/** Consome os eventos do servidor (golpes e quedas na água) e mostra os efeitos. */
function Effects({ arena, events }: { arena: Ref<ArenaSnapshot | null>; events: Ref<ArenaEvent[]> }) {
  const [list, setList] = useState<Fx[]>([]);
  const counter = useRef(0);
  useFrame(() => {
    if (events.current.length === 0) return;
    const evs = events.current.splice(0);
    const add: Fx[] = [];
    for (const e of evs) {
      const snap = arena.current;
      if (e.kind === "hit") {
        const t = snap?.fighters.find((f) => f.id === e.target);
        if (t) add.push({ key: counter.current++, kind: "hit", x: t.x, y: t.y + 1.3, z: t.z, t0: performance.now() });
      } else if (e.kind === "splash") add.push({ key: counter.current++, kind: "splash", x: e.x, y: WATER_Y + 0.1, z: e.z, t0: performance.now() });
    }
    if (add.length) {
      setList((l) => [...l.filter((x) => performance.now() - x.t0 < 1200), ...add]);
    }
  });
  return <>{list.map((fx) => <EffectView key={fx.key} fx={fx} />)}</>;
}

/** Câmera fixa de cima/atrás que enquadra os dois lutadores (o "para frente" do jogador é -z). */
function CameraRig({ arena }: { arena: Ref<ArenaSnapshot | null> }) {
  const camera = useThree((s) => s.camera);
  const mid = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const fs = arena.current?.fighters;
    if (!fs || fs.length < 2) return;
    const [a, b] = fs as [FighterSnap, FighterSnap];
    const sep = Math.hypot(a.x - b.x, a.z - b.z);
    const tx = (a.x + b.x) / 2, tz = (a.z + b.z) / 2;
    const k = 1 - Math.exp(-5 * dt);
    mid.current.x += (tx - mid.current.x) * k;
    mid.current.z += (tz - mid.current.z) * k;
    const dist = 9 + sep * 0.85;
    const want = new THREE.Vector3(mid.current.x * 0.8, 6.5 + sep * 0.45, mid.current.z * 0.8 + dist);
    camera.position.lerp(want, k);
    camera.lookAt(mid.current.x, 0.6, mid.current.z);
  });
  return null;
}

/** Entrada do lutador: movimento, pulo, golpes (soco, chute, empurrão) e esquiva. Enviada ao servidor, que decide tudo. */
function ArenaInputHandler({ room, you, arena, settingsRef, uiBlock, touch }: { room: Room; you: string; arena: Ref<ArenaSnapshot | null>; settingsRef: Ref<Settings>; uiBlock: Ref<boolean>; touch: Ref<TouchState> }) {
  useEffect(() => {
    const keys = new Set<string>();
    let last = { mx: 0, mz: 0, run: false };
    let lastSent = 0;
    const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    const fighting = () => arena.current?.fighters.some((f) => f.id === you) && arena.current.phase !== "ended";

    const compute = () => {
      const b = settingsRef.current.bindings;
      let mx = (isDown(keys, b.right) ? 1 : 0) - (isDown(keys, b.left) ? 1 : 0);
      let mz = (isDown(keys, b.back) || keys.has("ArrowDown") ? 1 : 0) - (isDown(keys, b.forward) || keys.has("ArrowUp") ? 1 : 0);
      const tc = touch.current;
      const stick = Math.hypot(tc.moveX, tc.moveY);
      if (stick > 0.12) { mx = tc.moveX; mz = tc.moveY; } // joystick: para cima = para frente (-z)
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      return { mx, mz, run: isDown(keys, b.run) || stick > 0.85 };
    };
    const send = (jump = false) => {
      if (!fighting() || uiBlock.current) return;
      const cur = compute();
      last = cur;
      lastSent = performance.now();
      room.send(C.ArenaInput, { ...cur, jump });
    };
    const act = (kind: "punch" | "kick" | "shove") => { if (fighting() && !uiBlock.current) room.send(C.ArenaAction, { kind }); };

    const down = (e: KeyboardEvent) => {
      if (typing() || uiBlock.current) return;
      const b = settingsRef.current.bindings;
      const k = e.code;
      if (k === b.jump) { e.preventDefault(); if (!e.repeat) send(true); return; }
      keys.add(k);
      if (e.repeat) return;
      if (k === b.punch) act("punch");
      else if (k === b.kick) act("kick");
      else if (k === b.shove) act("shove");
      else if (isDown(keys, b.run) && k !== b.run && fighting()) {
        // correr + esquerda/direita/trás = esquiva curta
        const dir = k === b.left ? [-1, 0] : k === b.right ? [1, 0] : k === b.back ? [0, 1] : null;
        if (dir) room.send(C.ArenaAction, { kind: "dodge", dx: dir[0], dz: dir[1] });
      }
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.code); };
    const mouse = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (e.button === 0) act("punch");
      else if (e.button === 2) act("kick");
    };
    const noMenu = (e: Event) => { if (e.target instanceof HTMLCanvasElement) e.preventDefault(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", mouse);
    window.addEventListener("contextmenu", noMenu);
    const iv = setInterval(() => {
      const tc = touch.current;
      if (tc.attack) { act(tc.attack); tc.attack = null; }
      if (tc.dodge) {
        tc.dodge = false;
        const sx = Math.abs(tc.moveX) > 0.5 ? Math.sign(tc.moveX) : 0;
        if (fighting() && !uiBlock.current) room.send(C.ArenaAction, { kind: "dodge", dx: sx, dz: sx === 0 ? 1 : 0 });
      }
      if (tc.jump) { send(true); tc.jump = false; }
      const cur = compute();
      if (cur.mx !== last.mx || cur.mz !== last.mz || cur.run !== last.run || performance.now() - lastSent > 400) send();
    }, 60);
    return () => {
      clearInterval(iv);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", mouse);
      window.removeEventListener("contextmenu", noMenu);
    };
  }, [room, you, arena, settingsRef, uiBlock, touch]);
  return null;
}

export function ArenaContent({ room, you, players, arena, events, bubbles, emotes, settingsRef, uiBlock, touch }: ArenaSceneProps) {
  const actions = useRef(new Map<string, ActionState>());
  const [ids, setIds] = useState<string[]>([]);
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  useEffect(() => { camera.fov = 55; camera.near = 0.1; camera.far = 400; camera.position.set(0, 9, 14); camera.updateProjectionMatrix(); }, [camera]);
  // os lutadores só aparecem quando o primeiro quadro chega
  useEffect(() => {
    const iv = setInterval(() => {
      const f = arena.current?.fighters.map((x) => x.id) ?? [];
      setIds((cur) => (cur.join() === f.join() ? cur : f));
    }, 100);
    return () => clearInterval(iv);
  }, [arena]);
  void ACTION_DUR;

  return (
    <>
      <World />
      {ids.map((id) => {
        const info = players.find((p) => p.id === id);
        return info ? <Fighter key={id} info={info} arena={arena} bubble={bubbles[id]?.text} emotes={emotes} actions={actions} /> : null;
      })}
      <Effects arena={arena} events={events} />
      <CameraRig arena={arena} />
      <ArenaInputHandler room={room} you={you} arena={arena} settingsRef={settingsRef} uiBlock={uiBlock} touch={touch} />
    </>
  );
}

export { HpBar };
