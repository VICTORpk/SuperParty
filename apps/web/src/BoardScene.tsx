import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { BOARD_LENGTH, BOARD_RULES, FINAL_TILE, isChallengeTile, type BoardPublicState, type PlayerInfo } from "@jogo/shared";
import { Avatar, type Bubble, type EmoteState } from "./Scene";
import { DENSE, TILE_RADIUS, VOLCANO, terrainHeight, tilePosition } from "./boardLayout";
import { Clouds, FacetedWater, Flat, GiantFlower, GoldStar, Palm, Rock, seeded } from "./scenery";
import type { RollInfo } from "./BoardHUD";

type Ref<T> = React.MutableRefObject<T>;

export interface BoardSceneProps {
  state: BoardPublicState;
  players: PlayerInfo[];
  you: string;
  bubbles: Record<string, Bubble>;
  emotes: Ref<Map<string, EmoteState>>;
  roll: RollInfo | null;
}

// ---------------------------------------------------------------- casas
const COLORS = { normal: "#3d8bff", challenge: "#43c75b", start: "#ff5a5f", end: "#ffd23f" };

/** Textura circular colorida da casa (azul = normal, verde com "!" = desafio, dourada = chegada). */
function makeTileTexture(index: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const challenge = isChallengeTile(index), start = index === 0, end = index === FINAL_TILE;
  const color = end ? COLORS.end : start ? COLORS.start : challenge ? COLORS.challenge : COLORS.normal;
  const cx = size / 2;
  const grad = g.createRadialGradient(cx, cx - 30, 10, cx, cx, cx);
  grad.addColorStop(0, "#ffffffaa");
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, color);
  g.fillStyle = "#ffffff";
  g.beginPath(); g.arc(cx, cx, cx - 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = color;
  g.beginPath(); g.arc(cx, cx, cx - 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = grad;
  g.beginPath(); g.arc(cx, cx, cx - 22, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,.22)";
  g.beginPath(); g.arc(cx, cx, cx - 22, 0, Math.PI * 2); g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(0,0,0,.45)";
  g.shadowBlur = 8;
  if (end) { g.font = "110px system-ui"; g.fillText("⭐", cx, cx - 6); g.font = "bold 44px system-ui"; g.fillText("FIM", cx, cx + 74); }
  else if (start) { g.font = "bold 52px system-ui"; g.fillText("INÍCIO", cx, cx); }
  else if (challenge) { g.font = "bold 130px system-ui"; g.fillText("!", cx, cx - 16); g.font = "bold 40px system-ui"; g.fillText(String(index), cx, cx + 78); }
  else { g.font = "bold 84px system-ui"; g.fillText(String(index), cx, cx + 4); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function Tiles() {
  const textures = useMemo(() => Array.from({ length: BOARD_LENGTH }, (_, i) => makeTileTexture(i)), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  return (
    <>
      {textures.map((tex, i) => {
        const p = tilePosition(i);
        return (
          <group key={i} position={[p.x, p.y, p.z]}>
            <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[TILE_RADIUS * 1.06, TILE_RADIUS * 1.12, 0.3, 28]} /><meshStandardMaterial color="#f4efe2" roughness={0.6} /></mesh>
            <mesh position={[0, 0.262, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[TILE_RADIUS * 0.98, 28]} /><meshStandardMaterial map={tex} roughness={0.35} /></mesh>
          </group>
        );
      })}
    </>
  );
}

/** Trilha de terra clara que liga as casas. */
function Trail() {
  const geo = useMemo(() => {
    const pts = DENSE.filter((_, i) => i % 2 === 0);
    const pos: number[] = [];
    const idx: number[] = [];
    const W = 1.5;
    pts.forEach((p, i) => {
      const nx = -p.tz, nz = p.tx;
      pos.push(p.x + nx * W, p.y + 0.07, p.z + nz * W, p.x - nx * W, p.y + 0.07, p.z - nz * W);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo}><meshStandardMaterial color="#f2dca4" roughness={1} side={THREE.DoubleSide} /></mesh>;
}

// ---------------------------------------------------------------- terreno
const hash = (x: number, z: number) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

function Terrain() {
  const geo = useMemo(() => {
    const plane = new THREE.PlaneGeometry(80, 70, 40, 35);
    plane.rotateX(-Math.PI / 2);
    const pos = plane.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    const g = plane.toNonIndexed();
    const p = g.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const col = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const h = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const n = hash(Math.round(cx * 3), Math.round(cz * 3));
      if (h < 0.1) col.set("#f6dfa4").offsetHSL(0, 0, (n - 0.5) * 0.04);
      else if (h < 0.55) col.set("#f1d995");
      else if (h > 8.2) col.set("#5b4a42");
      else if (h > 5.2) col.set("#a39489").offsetHSL(0, 0, (n - 0.5) * 0.06);
      else col.set(n > 0.5 ? "#5fcf45" : "#4fbf3b").offsetHSL(0, 0, h * 0.008);
      for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo}><meshStandardMaterial vertexColors flatShading roughness={1} /></mesh>;
}

function distToPath(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < DENSE.length; i += 2) best = Math.min(best, (DENSE[i]!.x - x) ** 2 + (DENSE[i]!.z - z) ** 2);
  return Math.sqrt(best);
}

function scatter(count: number, seed: number, accept: (x: number, z: number, h: number, d: number) => boolean) {
  const r = seeded(seed);
  const out: { x: number; y: number; z: number; k: number; seed: number }[] = [];
  for (let tries = 0; tries < count * 80 && out.length < count; tries++) {
    const x = (r() - 0.5) * 62, z = (r() - 0.5) * 54;
    const h = terrainHeight(x, z);
    const d = distToPath(x, z);
    if (accept(x, z, h, d)) out.push({ x, y: h, z, k: r(), seed: tries });
  }
  return out;
}

function Smoke() {
  const group = useRef<THREE.Group>(null);
  useFrame((s) => {
    group.current?.children.forEach((c, i) => {
      const t = (s.clock.elapsedTime * 0.25 + i / 4) % 1;
      c.position.set(Math.sin(i * 2 + t * 3) * 0.6, t * 6, 0);
      c.scale.setScalar(0.6 + t * 1.8);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.75 * (1 - t);
    });
  });
  return (
    <group ref={group}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i}><icosahedronGeometry args={[0.9, 0]} /><meshStandardMaterial color="#e9e4df" flatShading transparent opacity={0.6} depthWrite={false} /></mesh>
      ))}
    </group>
  );
}

/** Portal de chegada: dois pilares, viga e estrela dourada giratória. */
function FinishGate() {
  const p = tilePosition(FINAL_TILE);
  const yaw = Math.atan2(-p.tx, -p.tz);
  return (
    <group position={[p.x, p.y, p.z]} rotation-y={yaw}>
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[2.6, 2.9, 0.4, 10]} /><Flat color="#f4efe2" /></mesh>
      {[-2.1, 2.1].map((x) => <mesh key={x} position={[x, 2, -2.4]}><cylinderGeometry args={[0.32, 0.4, 4, 8]} /><Flat color="#ff5a5f" /></mesh>)}
      <mesh position={[0, 4.1, -2.4]}><boxGeometry args={[5.2, 0.5, 0.6]} /><Flat color="#ffd23f" /></mesh>
      <GoldStar position={[0, 5.9, -2.4]} scale={1.1} />
    </group>
  );
}

function StartGate() {
  const p = tilePosition(0);
  const yaw = Math.atan2(-p.tx, -p.tz);
  return (
    <group position={[p.x, p.y, p.z]} rotation-y={yaw}>
      {[-1.9, 1.9].map((x) => <mesh key={x} position={[x, 1.6, 0]}><cylinderGeometry args={[0.2, 0.26, 3.2, 8]} /><Flat color="#8a5a35" /></mesh>)}
      <mesh position={[0, 3.2, 0]}><boxGeometry args={[4.4, 0.8, 0.2]} /><Flat color="#ff5a5f" /></mesh>
      <Html position={[0, 3.2, 0.15]} center distanceFactor={12} style={{ pointerEvents: "none" }}><div className="stationlabel">PARTIDA</div></Html>
    </group>
  );
}

/** Ilha tropical: terreno colorido com colinas, praia, lagoa, vulcão, palmeiras e flores gigantes. */
function World() {
  const palms = useMemo(() => scatter(22, 3, (_x, _z, h, d) => h > 0.15 && h < 1.4 && d > 3.4), []);
  const flowers = useMemo(() => scatter(10, 9, (_x, _z, h, d) => h > 0.6 && h < 4 && d > 3.8), []);
  const bushes = useMemo(() => scatter(26, 17, (_x, _z, h, d) => h > 0.5 && h < 5 && d > 3), []);
  const rocks = useMemo(() => scatter(16, 21, (_x, _z, h, d) => h > 0.2 && d > 3.2), []);
  const peakY = terrainHeight(VOLCANO.x, VOLCANO.z);
  return (
    <>
      <color attach="background" args={["#8fd3ff"]} />
      <fog attach="fog" args={["#bfe8ff", 70, 190]} />
      <hemisphereLight args={["#ffffff", "#7fd36b", 1.1]} />
      <directionalLight position={[22, 30, 12]} intensity={1.3} color="#fff6e0" />

      <FacetedWater width={220} depth={220} segments={44} position={[0, -0.55, 0]} color="#27c3d9" opacity={0.93} />
      <Terrain />
      <Trail />

      {/* vulcão com cratera brilhante e fumaça */}
      <group position={[VOLCANO.x, peakY, VOLCANO.z]}>
        <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[1.5, 1.8, 0.3, 9]} /><meshStandardMaterial color="#ff6a1a" emissive="#ff4500" emissiveIntensity={1} flatShading /></mesh>
        <Smoke />
      </group>

      {palms.map((p, i) => <Palm key={i} position={[p.x, p.y, p.z]} scale={0.7 + p.k * 0.35} lean={0.15 + p.k * 0.3} rotation={p.k * 6} />)}
      {flowers.map((p, i) => <GiantFlower key={i} position={[p.x, p.y, p.z]} scale={0.75 + p.k * 0.5} color={["#ff6fa5", "#ffb347", "#c084fc", "#ff5a5f"][i % 4]} />)}
      {bushes.map((p, i) => <mesh key={i} position={[p.x, p.y + 0.35, p.z]} scale={0.9 + p.k * 0.6}><icosahedronGeometry args={[0.8, 0]} /><Flat color={["#3fae3a", "#58c24a", "#2e9a3a"][i % 3]!} /></mesh>)}
      {rocks.map((p, i) => <Rock key={i} position={[p.x, p.y + 0.1, p.z]} scale={0.9 + p.k * 0.9} seed={p.seed} />)}

      <StartGate />
      <FinishGate />
      <Clouds count={11} radius={70} height={[20, 38]} seed={12} />
    </>
  );
}

// ---------------------------------------------------------------- peças
const noAction = () => undefined;

interface PawnState { idx: number; progress: number; hopping: boolean; heading: number }

function Pawn({ info, state, slot, slots, isTurn, bubble, emotes, isWinner, pawnRefs }:
  { info: PlayerInfo; state: BoardPublicState; slot: number; slots: number; isTurn: boolean; bubble?: string; emotes: Ref<Map<string, EmoteState>>; isWinner: boolean; pawnRefs: Ref<Map<string, THREE.Group>> }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const speed = useRef(0);
  const height = useRef(0);
  const start = tilePosition(state.positions[info.id] ?? 0);
  const ps = useRef<PawnState>({ idx: state.positions[info.id] ?? 0, progress: 0, hopping: false, heading: Math.atan2(-start.tx, -start.tz) });
  const target = state.positions[info.id] ?? 0;
  const getEmote = () => emotes.current.get(info.id);

  useEffect(() => {
    const m = pawnRefs.current;
    if (group.current) m.set(info.id, group.current);
    return () => { m.delete(info.id); };
  }, [info.id, pawnRefs]);

  useFrame((s, dt) => {
    const g = group.current;
    if (!g) return;
    const p = ps.current;
    let cur = tilePosition(p.idx);
    let pos = { x: cur.x, y: cur.y, z: cur.z };
    if (!p.hopping && p.idx !== target) { p.hopping = true; p.progress = 0; }
    let hop = 0;
    if (p.hopping) {
      const step = target > p.idx ? 1 : -1;
      const next = tilePosition(p.idx + step);
      p.progress += dt / (BOARD_RULES.hopMs / 1000);
      const k = Math.min(1, p.progress);
      pos = { x: cur.x + (next.x - cur.x) * k, y: cur.y + (next.y - cur.y) * k, z: cur.z + (next.z - cur.z) * k };
      hop = Math.sin(k * Math.PI) * 0.9;
      p.heading = Math.atan2(-(next.x - cur.x), -(next.z - cur.z));
      if (p.progress >= 1) { p.idx += step; p.hopping = false; p.progress = 0; cur = tilePosition(p.idx); }
    } else {
      p.heading = Math.atan2(-cur.tx, -cur.tz);
    }
    // várias peças na mesma casa ficam em círculo
    const a = (slot / Math.max(1, slots)) * Math.PI * 2;
    const off = slots > 1 ? 0.75 : 0;
    const celebrate = isWinner ? Math.abs(Math.sin(s.clock.elapsedTime * 6)) * 0.8 : 0;
    g.position.set(pos.x + Math.cos(a) * off, pos.y + 0.26 + hop + celebrate, pos.z + Math.sin(a) * off);
    height.current = hop + celebrate;
    speed.current = p.hopping ? 3 : 0;
    const dh = Math.atan2(Math.sin(p.heading - g.rotation.y), Math.cos(p.heading - g.rotation.y));
    g.rotation.y += dh * (1 - Math.exp(-12 * dt));
    if (ring.current) {
      ring.current.visible = isTurn;
      const sc = 1 + Math.sin(s.clock.elapsedTime * 5) * 0.08;
      ring.current.scale.set(sc, sc, 1);
    }
  });

  return (
    <group ref={group}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.8, 1.0, 32]} /><meshBasicMaterial color="#ffd54a" side={THREE.DoubleSide} />
      </mesh>
      <group scale={1.0}>
        <Avatar color={info.color} nick={info.nick} bubble={bubble} speed={speed} height={height} getEmote={getEmote} getAction={noAction} />
      </group>
    </group>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.5], [0.73, 0.5], [0.27, 0.73], [0.73, 0.73]],
};
/** Ordem dos materiais do BoxGeometry: +x, -x, +y, -y, +z, -z (faces opostas somam 7). */
const FACE_VALUES = [1, 6, 2, 5, 3, 4];
const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(1, 0, 0), 6: new THREE.Vector3(-1, 0, 0), 2: new THREE.Vector3(0, 1, 0),
  5: new THREE.Vector3(0, -1, 0), 3: new THREE.Vector3(0, 0, 1), 4: new THREE.Vector3(0, 0, -1),
};

function makeDieTexture(value: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff6dc";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "#e0c98a";
  g.lineWidth = 14;
  g.strokeRect(7, 7, size - 14, size - 14);
  for (const [x, y] of PIPS[value]!) {
    g.beginPath();
    g.arc(x * size, y * size, 24, 0, Math.PI * 2);
    g.fillStyle = value === 1 ? "#dc2626" : "#1f2937";
    g.fill();
    g.beginPath();
    g.arc(x * size - 7, y * size - 8, 7, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,.35)";
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Dado com textura (pontos nas faces) flutuando sobre a cabeça de quem joga. Gira enquanto rola
 * e para mostrando para a câmera a face sorteada; as peças só andam depois que ele para.
 */
function DiceBlock({ state, pawnRefs, roll }: { state: BoardPublicState; pawnRefs: Ref<Map<string, THREE.Group>>; roll: RollInfo | null }) {
  const g = useRef<THREE.Group>(null);
  const cube = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const rollRef = useRef<{ start: number; value: number } | null>(null);
  const lastKey = useRef<number | null>(null);
  const textures = useMemo(() => FACE_VALUES.map((v) => makeDieTexture(v)), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  if (roll && roll.key !== lastKey.current) {
    lastKey.current = roll.key;
    rollRef.current = { start: performance.now(), value: roll.value };
  }

  useFrame((s, dt) => {
    const grp = g.current, mesh = cube.current;
    if (!grp || !mesh) return;
    const r = rollRef.current;
    const since = r ? (performance.now() - r.start) / 1000 : Infinity;
    const visible = state.phase !== "finished" && (state.phase === "roll" || state.phase === "rolling" || since < 3.2) && state.phase !== "arena";
    grp.visible = visible;
    const pawn = pawnRefs.current.get(state.turn);
    if (!pawn || !visible) return;
    const bounce = since < 0.8 ? Math.abs(Math.sin(since * 9)) * 0.5 : 0;
    grp.position.set(pawn.position.x, pawn.position.y + 3.4 + Math.sin(s.clock.elapsedTime * 3) * 0.1 + bounce, pawn.position.z);
    if (state.phase === "roll" && since > 3.2) {
      mesh.rotation.y += dt * 1.2; // esperando o jogador rolar: gira devagar
    } else if (r && since < 0.8) {
      mesh.rotateX(dt * 13); mesh.rotateY(dt * 9); mesh.rotateZ(dt * 6); // rolando
    } else if (r) {
      // parou: mostra a face sorteada para a câmera
      const toCam = camera.position.clone().sub(grp.position).normalize();
      const target = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[r.value]!, toCam);
      mesh.quaternion.slerp(target, 1 - Math.exp(-14 * dt));
    }
  });

  return (
    <group ref={g} visible={false}>
      <mesh ref={cube}>
        <boxGeometry args={[1.25, 1.25, 1.25]} />
        {textures.map((t, i) => <meshStandardMaterial key={i} attach={`material-${i}`} map={t} roughness={0.45} />)}
      </mesh>
    </group>
  );
}

/** Câmera orbital que acompanha a peça da vez. */
function CameraRig({ state, pawnRefs }: { state: BoardPublicState; pawnRefs: Ref<Map<string, THREE.Group>> }) {
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const camera = useThree((s) => s.camera);
  const focus = useRef(new THREE.Vector3());
  const init = useRef(false);

  useFrame((_, dt) => {
    const c = controls.current;
    if (import.meta.env.DEV) (window as unknown as { __cam?: unknown }).__cam = { camera, c: !!c, init: init.current, target: c ? { x: c.target.x, y: c.target.y, z: c.target.z } : null };
    if (!c) return;
    if (!init.current) {
      // primeira vez: alvo e câmera começam perto da peça da vez
      const p = tilePosition(state.positions[state.turn] ?? 0);
      c.target.set(p.x, p.y + 1, p.z);
      camera.position.set(p.x - p.tx * 9 + 3, p.y + 9, p.z - p.tz * 9 + 7);
      c.update();
      init.current = true;
      return;
    }
    const pawn = pawnRefs.current.get(state.turn);
    const fallback = tilePosition(state.positions[state.turn] ?? 0);
    const tx = pawn ? pawn.position.x : fallback.x, ty = (pawn ? pawn.position.y : fallback.y) + 1, tz = pawn ? pawn.position.z : fallback.z;
    focus.current.set(tx, ty, tz);
    const before = c.target.clone();
    c.target.lerp(focus.current, 1 - Math.exp(-4 * dt));
    camera.position.add(c.target.clone().sub(before)); // a câmera acompanha o alvo mantendo o ângulo escolhido
    c.update();
  });
  return <OrbitControls ref={controls as never} makeDefault enablePan={false} minDistance={8} maxDistance={34} maxPolarAngle={1.4} />;
}

export function BoardContent({ state, players, you, bubbles, emotes, roll }: BoardSceneProps) {
  const pawnRefs = useRef(new Map<string, THREE.Group>());
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  useEffect(() => { camera.fov = 55; camera.near = 0.1; camera.far = 400; camera.updateProjectionMatrix(); }, [camera]);
  const byTile = new Map<number, string[]>();
  for (const id of state.order) {
    const t = state.positions[id] ?? 0;
    byTile.set(t, [...(byTile.get(t) ?? []), id]);
  }
  void you;

  return (
    <>
      <World />
      <Tiles />
      {state.order.map((id) => {
        const info = players.find((p) => p.id === id);
        if (!info) return null;
        const group = byTile.get(state.positions[id] ?? 0) ?? [id];
        return (
          <Pawn key={id} info={info} state={state} slot={group.indexOf(id)} slots={group.length} pawnRefs={pawnRefs}
            isTurn={state.phase !== "finished" && state.turn === id} bubble={bubbles[id]?.text} emotes={emotes}
            isWinner={state.winner === id} />
        );
      })}
      <DiceBlock state={state} pawnRefs={pawnRefs} roll={roll} />
      <CameraRig state={state} pawnRefs={pawnRefs} />
    </>
  );
}
