import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Outlines } from "@react-three/drei";
import * as THREE from "three";
import type { Room } from "colyseus.js";
import {
  AVATAR_COLORS, C, DODGE_COOLDOWN_MS, DODGE_DISTANCE, GRAVITY, JUMP_VELOCITY, MOVE_SEND_INTERVAL_MS, PLAYER_SPEED, RUN_SPEED, WORLD_RADIUS,
  GAMES, GAME_IDS, LOBBY_ATTACK_COOLDOWN_MS, STATION_RADIUS, emoteDuration,
  type EmoteId, type GameId, type PlayerInfo, type PlayerPos, type QueueState,
} from "@jogo/shared";
import { isDown, type Settings } from "./controls";
import { INK_COLOR, getGradient } from "./toon";
import type { TouchState } from "./platform";
import { Bridge, Clouds, FacetedWater, Flat, Hut, Island, PALETTE, Pine, Rock } from "./scenery";
import { BRIDGE, FLOWERS, HUT, PINES, POND, POND_ROCKS, ROCKS, resolveCollisions } from "./lobbyLayout";

export type CameraMode = "first" | "third";
export interface Bubble { text: string }
export interface Effect { key: number; from: { x: number; z: number }; to: { x: number; z: number }; t0: number }
export interface EmoteState { name: EmoteId | null; start: number }
/** Golpes e reações (soco, chute, empurrão, levar um golpe). `start` usa performance.now(). */
export interface ActionState { kind: "punch" | "kick" | "shove" | "hit"; start: number }
export const ACTION_DUR = { punch: 0.45, kick: 0.6, shove: 0.55, hit: 0.4 } as const;
/** Idade (s) do golpe; em desenvolvimento dá para congelar a pose com `window.__freezeAct`. */
function actionAge(act: ActionState): number {
  const frozen = import.meta.env.DEV ? (window as unknown as { __freezeAct?: number }).__freezeAct : undefined;
  return frozen ?? (performance.now() - act.start) / 1000;
}

type Ref<T> = React.MutableRefObject<T>;

export interface SceneProps {
  room: Room;
  you: string;
  players: PlayerInfo[];
  positions: Ref<Map<string, PlayerPos>>;
  bubbles: Record<string, Bubble>;
  cameraMode: CameraMode;
  onToggleCamera: () => void;
  settingsRef: Ref<Settings>;
  uiBlock: Ref<boolean>;
  emotes: Ref<Map<string, EmoteState>>;
  snaps: Ref<Map<string, { x: number; z: number }>>;
  pops: Ref<Map<string, number>>;
  effects: Effect[];
  onDodge: (e: { from: { x: number; z: number }; to: { x: number; z: number } }) => void;
  queue: QueueState | null;
  actions: Ref<Map<string, ActionState>>;
  onNearStation: (game: GameId | null) => void;
  touch: Ref<TouchState>;
}

/** Dev: depois de um teleporte, força o envio de posições para o servidor alcançar o destino. */
function devForce(consume: boolean): boolean {
  if (!import.meta.env.DEV) return false;
  const w = window as unknown as { __tpSend?: number };
  if (!w.__tpSend || w.__tpSend <= 0) return false;
  if (consume) w.__tpSend -= 1;
  return true;
}

const isTyping = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

/** Teclado + mouse (pointer lock). Estado em refs para não re-renderizar a cada frame. */
function useControls(settingsRef: Ref<Settings>, uiBlock: Ref<boolean>, onToggleCamera: () => void) {
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: 0, pitch: 0 });
  const dodgeReq = useRef<"left" | "right" | "back" | null>(null);
  const attackReq = useRef<"punch" | "kick" | "shove" | null>(null);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping() || uiBlock.current) return;
      const b = settingsRef.current.bindings;
      const k = e.code;
      if (k === b.jump) {
        e.preventDefault(); // evita rolar a página ou "clicar" no botão focado
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      }
      if (k === b.camera && !e.repeat) onToggleCamera();
      if (!e.repeat) {
        if (k === b.punch) attackReq.current = "punch";
        else if (k === b.kick) attackReq.current = "kick";
        else if (k === b.shove) attackReq.current = "shove";
      }
      keys.current.add(k);
      // correr + tecla de direção (esquerda/direita/trás) = esquiva
      if (!e.repeat && k !== b.run && isDown(keys.current, b.run)) {
        if (k === b.left) dodgeReq.current = "left";
        else if (k === b.right) dodgeReq.current = "right";
        else if (k === b.back || k === "ArrowDown") dodgeReq.current = "back";
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    // Mouse: arraste (botão esquerdo ou direito) para girar a câmera; o cursor continua livre para clicar na interface.
    let dragging = false;
    let touchId: number | null = null, tx = 0, ty = 0;
    const pointerDown = (e: PointerEvent) => {
      if (uiBlock.current || isTyping()) return;
      if (e.pointerType === "touch") { touchId = e.pointerId; tx = e.clientX; ty = e.clientY; return; } // um dedo no mundo gira a câmera
      dragging = true;
      gl.domElement.style.cursor = "grabbing";
    };
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        if (touchId !== e.pointerId) return;
        const sens = 0.0055 * settingsRef.current.sensitivity;
        look.current.yaw -= (e.clientX - tx) * sens;
        look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - (e.clientY - ty) * sens));
        tx = e.clientX; ty = e.clientY;
        return;
      }
      if (!dragging) return;
      if (import.meta.env.DEV && (window as unknown as { __lockLook?: boolean }).__lockLook) return; // dev: inspeção
      const sens = 0.0035 * settingsRef.current.sensitivity;
      look.current.yaw -= e.movementX * sens;
      look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - e.movementY * sens));
    };
    const pointerUp = (e: PointerEvent) => { if (e.pointerType === "touch") { if (touchId === e.pointerId) touchId = null; return; } dragging = false; gl.domElement.style.cursor = "grab"; };
    const noMenu = (e: Event) => e.preventDefault();
    gl.domElement.style.cursor = "grab";
    gl.domElement.addEventListener("pointerdown", pointerDown);
    gl.domElement.addEventListener("contextmenu", noMenu);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      gl.domElement.removeEventListener("pointerdown", pointerDown);
      gl.domElement.removeEventListener("contextmenu", noMenu);
      gl.domElement.style.cursor = "";
    };
  }, [gl, onToggleCamera, settingsRef, uiBlock]);

  if (import.meta.env.DEV) (window as unknown as { __ctl: unknown }).__ctl = { keys: keys.current, look: look.current, dodgeReq };
  return { keys, look, dodgeReq, attackReq };
}

const INK = INK_COLOR;
const SHIRTS = ["#ecd283", "#f2b84b", "#cfe08f", "#a5dccf", "#f3b58a", "#d9c8f2"];
const SHORTS = ["#4a7bb5", "#7a5a3a", "#3f7f66", "#4a5a9a", "#9a4f4f", "#5a4a8a"];
const HAT_COUNT = 6;

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}

/** Material em estilo "cel" com contorno escuro, parecido com o visual de desenho animado. */
/** Material de desenho (cel). O contorno vem do efeito em tela cheia (InkEffect), por isso não há contorno por peça. */
function Toon({ color }: { color: string; outline?: boolean }) {
  return <meshToonMaterial color={color} gradientMap={getGradient()} />;
}

function Hat({ variant, hair }: { variant: number; hair: string }) {
  switch (variant % HAT_COUNT) {
    case 0: // gorrinho pequeno com pompom
      return (
        <group position={[0, 0.5, 0.04]}>
          <mesh scale={[1, 0.75, 1]}><sphereGeometry args={[0.24, 16, 12]} /><Toon color="#e0553f" /></mesh>
          <mesh position={[0, 0.17, 0]}><sphereGeometry args={[0.07]} /><Toon color="#fff" /></mesh>
        </group>
      );
    case 1: // boina de aviador com óculos de proteção
      return (
        <group>
          <mesh position={[0, 0.02, 0.03]} rotation-x={-0.2}>
            <sphereGeometry args={[0.6, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.46]} /><Toon color="#7a4b2a" />
          </mesh>
          {[-0.21, 0.21].map((x) => (
            <group key={x} position={[x, 0.3, -0.44]} rotation-x={-0.35}>
              <mesh><torusGeometry args={[0.14, 0.04, 8, 20]} /><Toon color="#e08a2e" /></mesh>
              <mesh position={[0, 0, 0.01]}><circleGeometry args={[0.13, 16]} /><meshToonMaterial color="#2a2018" /></mesh>
            </group>
          ))}
        </group>
      );
    case 2: // chapéu de palha
      return (
        <group position={[0, 0.4, 0]}>
          <mesh><cylinderGeometry args={[0.78, 0.78, 0.05, 28]} /><Toon color="#dcb86b" /></mesh>
          <mesh position={[0, 0.14, 0]}><cylinderGeometry args={[0.38, 0.42, 0.26, 24]} /><Toon color="#dcb86b" /></mesh>
          <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.43, 0.43, 0.07, 24]} /><Toon color="#b04a3a" /></mesh>
        </group>
      );
    case 3: // óculos redondos + topete
      return (
        <group>
          {[-0.2, 0.2].map((x) => (
            <mesh key={x} position={[x, 0.06, -0.5]}><torusGeometry args={[0.16, 0.03, 8, 20]} /><Toon color="#c0392b" /></mesh>
          ))}
          <mesh position={[0, 0.07, -0.5]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.02, 0.02, 0.1, 6]} /><meshToonMaterial color="#c0392b" /></mesh>
          <mesh position={[0, 0.5, -0.02]} scale={[1, 0.6, 1]}><sphereGeometry args={[0.2, 12, 10]} /><Toon color={hair} /></mesh>
        </group>
      );
    case 4: // coque no cabelo
      return (
        <group>
          <mesh position={[0, 0.02, 0.06]} rotation-x={-0.35}>
            <sphereGeometry args={[0.58, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36]} /><Toon color={hair} />
          </mesh>
          <mesh position={[0, 0.62, 0.1]}><sphereGeometry args={[0.17]} /><Toon color={hair} /></mesh>
        </group>
      );
    default: // boné amarelo
      return (
        <group>
          <mesh position={[0, 0.03, 0.02]}>
            <sphereGeometry args={[0.56, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42]} /><Toon color="#f2c230" />
          </mesh>
          <mesh position={[0, 0.22, -0.52]} rotation-x={0.12}><boxGeometry args={[0.6, 0.05, 0.34]} /><Toon color="#f2c230" /></mesh>
        </group>
      );
  }
}

export function palette(color: string) {
  const idx = Math.max(0, (AVATAR_COLORS as readonly string[]).indexOf(color));
  return { idx, shirt: SHIRTS[idx % SHIRTS.length]!, shorts: SHORTS[idx % SHORTS.length]! };
}

// ---------------------------------------------------------------- caminhada
interface Gait { phase: number; amp: number; run: number; air: number }

/** Atualiza a fase do passo (mais rápida correndo) e suaviza as transições parado/andando/correndo. */
function useGait(speed: Ref<number>, height?: Ref<number>): Ref<Gait> {
  const g = useRef<Gait>({ phase: 0, amp: 0, run: 0, air: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const v = speed.current;
    const moving = v > 0.5;
    const runT = Math.min(1, Math.max(0, (v - PLAYER_SPEED * 1.1) / (RUN_SPEED - PLAYER_SPEED * 1.1)));
    g.current.amp += ((moving ? 1 : 0) - g.current.amp) * (1 - Math.exp(-10 * dt));
    g.current.run += (runT - g.current.run) * (1 - Math.exp(-8 * dt));
    if (moving) g.current.phase += dt * (11 + 5 * g.current.run);
    const airT = height && Math.abs(height.current) > 0.06 ? 1 : 0;
    g.current.air += (airT - g.current.air) * (1 - Math.exp(-16 * dt));
  });
  return g;
}

// ---------------------------------------------------------------- gestos
interface Pose {
  sx: number; sy: number; sz: number; // ombro
  ex: number; ez: number; // cotovelo
  hx: number; hy: number; hz: number; // punho (hy = girar a mão em torno do antebraço)
  c: [number, number, number, number, number]; // curvatura: polegar (-1 aberto … 1 recolhido), indicador, médio, anelar, mínimo (0 = esticado, 1 = fechado)
}

const REST_CURLS: Pose["c"] = [0.6, 0.75, 0.75, 0.75, 0.75];
const mk = (o: Partial<Pose>): Pose => ({ sx: 0, sy: 0, sz: 0.1, ex: 0.12, ez: 0, hx: 0, hy: 0, hz: 0, c: REST_CURLS, ...o });

/** Pose do braço direito para cada gesto; `t` = segundos desde o início. */
function emotePose(name: EmoteId, t: number): Pose {
  const up = { sx: 1.1, sz: 0.12, ex: 1.55, hy: Math.PI / 2 }; // antebraço para cima, palma virada para a frente (para quem está na frente)
  switch (name) {
    case "stop": return mk({ ...up, c: [-0.3, 0, 0, 0, 0] });
    case "wave": return mk({ ...up, ez: Math.sin(t * 13) * 0.5, c: [-0.2, 0, 0, 0, 0] });
    case "peace": return mk({ ...up, c: [-0.2, 0, 0, 1, 1] });
    case "middle": return mk({ ...up, hy: -Math.PI / 2, c: [0.9, 1, 0, 1, 1] }); // palma virada para quem faz o gesto
    case "point": return mk({ sx: 1.5, ex: 0.1, c: [0.8, 0, 1, 1, 1] });
    case "thumbs": return mk({ sx: 0.95, ex: 0.65, c: [-1, 1, 1, 1, 1] });
    case "punch": {
      const p = Math.pow(Math.max(0, Math.sin(t * 8)), 2);
      return mk({ sx: 1.4, ex: 2.0 - 1.9 * p, c: [0.9, 1, 1, 1, 1] });
    }
    case "come": {
      const k = 0.25 + 0.6 * Math.abs(Math.sin(t * 9));
      return mk({ sx: 1.0, ex: 0.7, hy: -Math.PI / 2, c: [0.3, k, k, k, k] });
    }
  }
}

const mix = (a: number, b: number, w: number) => a + (b - a) * w;

/** Pose dos braços durante um golpe. `side` 1 = braço direito (soco), -1 = esquerdo (guarda). */
function actionPose(kind: ActionState["kind"], side: 1 | -1, age: number): Pose {
  const ph = age / ACTION_DUR[kind];
  switch (kind) {
    case "punch":
      if (side === 1) {
        const ex = ph < 0.28 ? 1.9 : ph < 0.48 ? 1.9 - ((ph - 0.28) / 0.2) * 1.8 : 0.1 + ((ph - 0.48) / 0.52) * 1.1;
        return mk({ sx: 1.45, sz: 0.05, ex, c: [0.9, 1, 1, 1, 1] });
      }
      return mk({ sx: 1.0, sz: 0.15, ex: 1.9, c: [0.9, 1, 1, 1, 1] });
    case "kick": return mk({ sx: 0.2, sz: 0.95, ex: 0.2 });
    case "shove": return mk({ sx: 1.45, sz: 0.05, ex: ph < 0.3 ? 1.1 - (ph / 0.3) * 0.9 : 0.2 + (ph - 0.3) * 0.4, c: [-0.3, 0, 0, 0, 0] });
    case "hit": return mk({ sx: -0.5, sz: 0.9, ex: 0.6 });
  }
}
const FINGER_Z = [-0.085, -0.03, 0.028, 0.082];

/**
 * Braço completo: ombro → cotovelo → punho → mão com 4 dedos e polegar.
 * `side` = 1 (direito, faz os gestos) ou -1 (esquerdo, espelhado pelo pai com scale.x negativo).
 */
function ArmRig({ side, color, shirt, gait, getEmote, getAction, fp }:
  { side: 1 | -1; color: string; shirt: string; gait: Ref<Gait>; getEmote: () => EmoteState | undefined; getAction: () => ActionState | undefined; fp?: boolean }) {
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const wrist = useRef<THREE.Group>(null);
  const bases = useRef<(THREE.Group | null)[]>([]);
  const joints = useRef<(THREE.Group | null)[]>([]);
  const thumb = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { phase, amp: a, run } = gait.current;
    const idle = 1 - a;
    const sw = Math.sin(phase) * (0.9 + 0.35 * run) * a;
    const breathe = Math.sin(t * 2.1);

    const air = gait.current.air;
    let p: Pose = fp
      ? mk({ sx: 1.3 + sw * 0.06 * side - air * 0.25, sz: 0.08 + air * 0.25, ex: 0.3 + 0.2 * run + Math.abs(sw) * 0.05 })
      : mk({
          sx: side * (sw * 1.05 - Math.sin(t * 1.6) * 0.04 * idle) * (1 - air) - air * 0.3,
          sz: 0.1 + breathe * 0.02 * idle + air * 0.7,
          ex: (0.12 + Math.max(0, sw * side) * 0.5 + run * 0.45) * (1 - air) + 0.35 * air,
        });

    const em = side === 1 ? getEmote() : undefined;
    if (em?.name) {
      const frozen = import.meta.env.DEV ? (window as unknown as { __freeze?: number }).__freeze : undefined; // dev: congela a pose
      const age = frozen ?? (performance.now() - em.start) / 1000;
      const dur = emoteDuration(em.name);
      if (age < dur) {
        const x = Math.min(1, age / 0.18, (dur - age) / 0.25);
        const w = x * x * (3 - 2 * x);
        const e = emotePose(em.name, age);
        if (fp) {
          // em primeira pessoa a mão fica mais à frente e para o centro, para não sair da tela
          if (e.ex > 1.3) { e.sx = 1.4; e.ex = 0.8; e.sz = -0.3; } // gestos com a mão levantada
          else { e.sx = Math.min(1.5, e.sx + 0.3); e.ex = Math.max(0.1, e.ex - 0.3); e.sz -= 0.25; }
        }
        p = {
          sx: mix(p.sx, e.sx, w), sy: mix(p.sy, e.sy, w), sz: mix(p.sz, e.sz, w),
          ex: mix(p.ex, e.ex, w), ez: mix(p.ez, e.ez, w),
          hx: mix(p.hx, e.hx, w), hy: mix(p.hy, e.hy, w), hz: mix(p.hz, e.hz, w),
          c: p.c.map((v, i) => mix(v, e.c[i]!, w)) as Pose["c"],
        };
      }
    }

    const act = getAction();
    if (act) {
      const dur = ACTION_DUR[act.kind];
      const age = actionAge(act);
      if (age < dur) {
        const x = Math.min(1, age / 0.06, (dur - age) / 0.12);
        const w = x * x * (3 - 2 * x);
        const e = actionPose(act.kind, side, age);
        p = {
          sx: mix(p.sx, e.sx, w), sy: mix(p.sy, e.sy, w), sz: mix(p.sz, e.sz, w),
          ex: mix(p.ex, e.ex, w), ez: mix(p.ez, e.ez, w),
          hx: mix(p.hx, e.hx, w), hy: mix(p.hy, e.hy, w), hz: mix(p.hz, e.hz, w),
          c: p.c.map((v, i) => mix(v, e.c[i]!, w)) as Pose["c"],
        };
      }
    }

    shoulder.current?.rotation.set(p.sx, p.sy, p.sz);
    elbow.current?.rotation.set(p.ex, 0, p.ez);
    wrist.current?.rotation.set(p.hx, p.hy, p.hz);
    for (let i = 0; i < 4; i++) {
      const c = p.c[i + 1]!;
      bases.current[i]?.rotation.set(0, 0, -c * 1.15);
      joints.current[i]?.rotation.set(0, 0, -c * 1.25);
    }
    const tv = p.c[0];
    thumb.current?.rotation.set(tv < 0 ? -tv * 1.5 : 0, 0, tv >= 0 ? -tv * 1.2 : 0);
  });

  return (
    <group ref={shoulder}>
      <mesh position={[0, -0.12, 0]}><cylinderGeometry args={[0.17, 0.15, 0.24, 10]} /><Toon color={shirt} /></mesh>
      <mesh position={[0, -0.27, 0]}><capsuleGeometry args={[0.1, 0.08, 4, 8]} /><Toon color={color} /></mesh>
      <group ref={elbow} position={[0, -0.36, 0]}>
        <mesh position={[0, -0.12, 0]}><capsuleGeometry args={[0.095, 0.12, 4, 8]} /><Toon color={color} /></mesh>
        <group ref={wrist} position={[0, -0.26, 0]}>
          {/* mão: palma + 4 dedos + polegar (curvados = punho/“luva”) */}
          <mesh position={[0, -0.05, 0]} scale={[0.8, 0.95, 1.2]}><sphereGeometry args={[0.125, 14, 12]} /><Toon color={color} /></mesh>
          {FINGER_Z.map((z, i) => (
            <group key={i} ref={(el) => { bases.current[i] = el; }} position={[0, -0.1, z]}>
              <mesh position={[0, -0.06, 0]}><capsuleGeometry args={[0.03, 0.06, 3, 6]} /><Toon color={color} outline={false} /></mesh>
              <group ref={(el) => { joints.current[i] = el; }} position={[0, -0.125, 0]}>
                <mesh position={[0, -0.05, 0]}><capsuleGeometry args={[0.027, 0.05, 3, 6]} /><Toon color={color} outline={false} /></mesh>
              </group>
            </group>
          ))}
          <group ref={thumb} position={[-0.045, -0.06, -0.14]}>
            <mesh position={[0, -0.05, 0]}><capsuleGeometry args={[0.04, 0.06, 3, 6]} /><Toon color={color} outline={false} /></mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Personagem "escoteiro" cartunesco: pele colorida, cabeça grande, olhos pretos com brilho e roupas simples. */
/** Barra de vida sobre a cabeça (lê o valor de uma ref a cada 100 ms). */
export function HpBar({ hp }: { hp: Ref<number> }) {
  const [v, setV] = useState(hp.current);
  useEffect(() => { const iv = setInterval(() => setV(hp.current), 100); return () => clearInterval(iv); }, [hp]);
  return <div className="hpbar"><div style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: v > 50 ? "#22c55e" : v > 25 ? "#eab308" : "#ef4444" }} /></div>;
}

export function Avatar({ color, nick, bubble, hidden, speed, height, getEmote, getAction, hp }:
  { color: string; nick: string; bubble?: string; hidden?: boolean; speed: Ref<number>; height: Ref<number>; getEmote: () => EmoteState | undefined;
    getAction: () => ActionState | undefined; hp?: Ref<number> }) {
  const root = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group[]>([]);
  const shadow = useRef<THREE.Mesh>(null);
  const nextBlink = useRef(1 + Math.random() * 2);
  const blinkEnd = useRef(0);
  const gait = useGait(speed, height);
  const { idx, shirt, shorts } = palette(color);
  const hair = "#4a3328";
  const blush = useMemo(() => shade(color, 0.14), [color]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { phase, amp: a, run, air } = gait.current;
    const ground = 1 - air;
    const sw = Math.sin(phase) * (0.9 + 0.35 * run) * a * ground;
    const idle = 1 - a;
    const breathe = Math.sin(t * 2.1);
    // no ar: parado = joelhos para cima; correndo = passada longa (uma perna à frente, outra atrás)
    const L = sw + air * (0.5 + 0.5 * a);
    const R = -sw + air * (0.5 - 1.1 * a);

    // golpe em andamento
    const act = getAction();
    let kind: ActionState["kind"] | null = null, env = 0, ph = 0;
    if (act) {
      const dur = ACTION_DUR[act.kind];
      const age = actionAge(act);
      if (age < dur) { kind = act.kind; env = Math.min(1, age / 0.06, (dur - age) / 0.12); ph = age / dur; }
    }

    if (legL.current) { legL.current.rotation.x = kind === "kick" ? mix(L, -0.25, env) : L; legL.current.position.y = 0.62 + Math.max(0, -Math.cos(phase)) * (0.09 + 0.05 * run) * a * ground; }
    if (legR.current) { legR.current.rotation.x = kind === "kick" ? mix(R, 1.6, env) : R; legR.current.position.y = 0.62 + Math.max(0, Math.cos(phase)) * (0.09 + 0.05 * run) * a * ground; }
    if (root.current) root.current.position.y = Math.abs(Math.sin(phase)) * (0.06 + 0.04 * run) * a * ground;
    if (upper.current) {
      let ux = -(0.13 + 0.12 * run) * a * ground - 0.14 * air * a + breathe * 0.008;
      let uy = Math.sin(phase) * 0.14 * a * ground;
      if (kind === "punch") { uy -= 0.7 * env * (ph > 0.25 && ph < 0.6 ? 1 : 0.35); ux -= 0.12 * env; }
      else if (kind === "kick") ux += 0.3 * env;
      else if (kind === "shove") ux -= 0.25 * env;
      else if (kind === "hit") ux += 0.5 * env;
      upper.current.rotation.x = ux;
      upper.current.rotation.y = uy;
      upper.current.rotation.z = Math.sin(phase) * 0.04 * a * ground;
      upper.current.scale.y = 1 + breathe * 0.012 * (1 - a * 0.5);
    }
    if (head.current) {
      head.current.rotation.x = (0.12 + 0.1 * run) * a * ground - (kind === "hit" ? 0.35 * env : 0);
      head.current.rotation.y = -Math.sin(phase) * 0.14 * a * 0.7 * ground + Math.sin(t * 0.7) * 0.06 * idle;
      head.current.rotation.z = -Math.sin(phase) * 0.035 * a * ground + Math.sin(t * 0.9) * 0.02 * idle;
    }
    if (shadow.current) {
      const h = height.current;
      shadow.current.position.y = 0.03 - h; // fica no chão mesmo quando o personagem pula
      shadow.current.visible = h > -0.3;
      shadow.current.scale.setScalar(Math.max(0.5, 1 - Math.max(0, h) * 0.25));
    }
    if (t > nextBlink.current) { blinkEnd.current = t + 0.12; nextBlink.current = t + 2 + Math.random() * 3.5; }
    const lid = t < blinkEnd.current ? 0.08 : 1;
    for (const g of eyes.current) if (g) g.scale.y += (lid - g.scale.y) * 0.6;
  });

  const leg = (ref: React.RefObject<THREE.Group | null>, x: number) => (
    <group ref={ref} position={[x, 0.62, 0]}>
      <mesh position={[0, -0.18, 0]}><capsuleGeometry args={[0.1, 0.16, 4, 8]} /><Toon color={color} /></mesh>
      <mesh position={[0, -0.36, 0]}><cylinderGeometry args={[0.13, 0.13, 0.2, 10]} /><Toon color="#f4f1ea" /></mesh>
      <mesh position={[0, -0.52, -0.06]} scale={[1, 0.7, 1.45]}><sphereGeometry args={[0.18, 12, 10]} /><Toon color="#6b4328" /></mesh>
    </group>
  );

  return (
    <group visible={!hidden} scale={0.95}>
      {/* sombra suave no chão (acompanha o salto) */}
      <mesh ref={shadow} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} renderOrder={-1}>
        <circleGeometry args={[0.62, 20]} /><meshBasicMaterial color="#1b1410" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {/* corpo pequeno e rechonchudo; a cabeça (abaixo) é bem maior: proporção "chibi" */}
      <group ref={root} scale={0.8}>
        {leg(legL, -0.2)}
        {leg(legR, 0.2)}

        <group ref={upper} position={[0, 0.7, 0]}>
          <group position={[0, -0.7, 0]}>
            <mesh position={[0, 0.72, 0]} scale={[1, 0.8, 0.9]}><sphereGeometry args={[0.4, 16, 12]} /><Toon color={shorts} /></mesh>
            <mesh position={[0, 1.02, 0]} scale={[1, 1, 0.9]}><capsuleGeometry args={[0.38, 0.22, 6, 14]} /><Toon color={shirt} /></mesh>
            <mesh position={[0, 1.04, -0.01]} rotation={[0, 0, -0.75]} scale={[1, 1, 0.93]}>
              <cylinderGeometry args={[0.395, 0.395, 0.12, 20, 1, true]} /><meshToonMaterial color="#3b82c4" side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 1.02, 0.42]} scale={[1, 1.1, 0.7]}><sphereGeometry args={[0.36, 14, 12]} /><Toon color="#b3422f" /></mesh>
            <mesh position={[0, 1.42, 0.42]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.12, 0.12, 0.6, 10]} /><Toon color="#e8b64a" /></mesh>

            {/* braços: o direito faz os gestos, o esquerdo é o espelho */}
            <group position={[0.52, 1.2, 0]}>
              <ArmRig side={1} color={color} shirt={shirt} gait={gait} getEmote={getEmote} getAction={getAction} />
            </group>
            <group position={[-0.52, 1.2, 0]} scale={[-1, 1, 1]}>
              <ArmRig side={-1} color={color} shirt={shirt} gait={gait} getEmote={getEmote} getAction={getAction} />
            </group>

            <group ref={head} position={[0, 1.35, 0]} scale={1.625}>
              <group position={[0, 0.37, 0]}>
                <mesh scale={[1.12, 1, 1]}><sphereGeometry args={[0.5, 28, 20]} /><Toon color={color} /></mesh>
                {[-0.2, 0.2].map((x, i) => (
                  <group key={x} ref={(el) => { if (el) eyes.current[i] = el; }} position={[x, 0.04, -0.455]} rotation-y={x * 0.35}>
                    <mesh scale={[0.85, 1.2, 0.35]}><sphereGeometry args={[0.14, 16, 12]} /><meshToonMaterial color="#fff" /></mesh>
                    <mesh position={[0, -0.01, -0.035]} scale={[0.78, 1.1, 0.3]}><sphereGeometry args={[0.11, 14, 10]} /><meshToonMaterial color="#15101a" /></mesh>
                    <mesh position={[0.035, 0.05, -0.065]}><sphereGeometry args={[0.03, 8, 6]} /><meshBasicMaterial color="#fff" /></mesh>
                    <mesh position={[-0.03, -0.05, -0.06]}><sphereGeometry args={[0.015, 8, 6]} /><meshBasicMaterial color="#fff" /></mesh>
                  </group>
                ))}
                {[-0.2, 0.2].map((x) => (
                  <mesh key={`b${x}`} position={[x, 0.24, -0.45]} rotation-z={Math.PI / 2 + x * 0.6}><capsuleGeometry args={[0.014, 0.1, 3, 6]} /><meshToonMaterial color={INK} /></mesh>
                ))}
                {[-0.36, 0.36].map((x) => (
                  <mesh key={x} position={[x, -0.1, -0.36]} rotation-y={x * 0.9} scale={[1, 0.6, 0.3]}><sphereGeometry args={[0.1, 10, 8]} /><meshToonMaterial color={blush} /></mesh>
                ))}
                <mesh position={[0, -0.16, -0.47]} rotation-z={Math.PI}><torusGeometry args={[0.07, 0.018, 6, 12, Math.PI]} /><meshToonMaterial color={INK} /></mesh>
                <Hat variant={idx} hair={hair} />
              </group>
            </group>
          </group>
        </group>
      </group>

      {!hidden && (
        <Html position={[0, 2.75, 0]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
          <div className="nameplate">{bubble && <div className="bubble">{bubble}</div>}<span>{nick}</span>{hp && <HpBar hp={hp} />}</div>
        </Html>
      )}
    </group>
  );
}

/** Braços em primeira pessoa, presos à câmera. A posição lateral acompanha a proporção da tela (em telas largas os ombros ficam mais afastados). */
function FirstPersonHands({ color, shirt, speed, height, getEmote, getAction }:
  { color: string; shirt: string; speed: Ref<number>; height: Ref<number>; getEmote: () => EmoteState | undefined; getAction: () => ActionState | undefined }) {
  const gait = useGait(speed, height);
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const t = Math.min(1.2, Math.max(0, (aspect - 1.06) / 0.72));
  const sx = 0.07 + 0.07 * t;
  const sc = 0.38;
  return (
    <>
      <group position={[-sx, -0.1, 0.1]} scale={[-sc, sc, sc]}>
        <ArmRig side={-1} color={color} shirt={shirt} gait={gait} getEmote={getEmote} getAction={getAction} fp />
      </group>
      <group position={[sx, -0.1, 0.1]} scale={sc}>
        <ArmRig side={1} color={color} shirt={shirt} gait={gait} getEmote={getEmote} getAction={getAction} fp />
      </group>
    </>
  );
}

// ---------------------------------------------------------------- esquiva (teleporte)
const GLOW = "#9fe3ff";

function fadeMat(m: THREE.Material | THREE.Material[] | undefined, opacity: number) {
  if (m && !Array.isArray(m)) (m as THREE.MeshBasicMaterial).opacity = Math.max(0, opacity);
}

/** Efeito de "transmissão instantânea": rastro de luz, silhueta que se esvai e anel/brilho na chegada. */
function TeleportFX({ fx }: { fx: Effect }) {
  const ghost = useRef<THREE.Mesh>(null);
  const streak = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Mesh>(null);
  const sparks = useRef<THREE.Group>(null);
  const dx = fx.to.x - fx.from.x;
  const dz = fx.to.z - fx.from.z;
  const len = Math.hypot(dx, dz) || 0.01;
  const yaw = Math.atan2(dx, dz);
  const ARRIVE = 0.11;

  useFrame(() => {
    const age = (performance.now() - fx.t0) / 1000;
    const g = ghost.current;
    if (g) {
      const k = Math.min(1, age / 0.35);
      g.scale.set(1 - 0.85 * k, 1 + 2.2 * k, 1 - 0.85 * k);
      fadeMat(g.material, 0.9 * (1 - k));
    }
    fadeMat(streak.current?.material, 0.85 * (1 - Math.min(1, age / 0.3)));
    const arr = age - ARRIVE;
    if (ring.current) {
      const k = Math.min(1, Math.max(0, arr) / 0.45);
      ring.current.scale.setScalar(0.3 + k * 2.6);
      fadeMat(ring.current.material, arr < 0 ? 0 : 0.9 * (1 - k));
    }
    if (flash.current) {
      const k = Math.min(1, Math.max(0, arr) / 0.28);
      flash.current.scale.setScalar(0.6 + k * 1.8);
      fadeMat(flash.current.material, arr < 0 ? 0 : 0.7 * (1 - k));
    }
    if (sparks.current) {
      const k = Math.min(1, Math.max(0, arr) / 0.5);
      sparks.current.children.forEach((c, i) => {
        const a = (i / 10) * Math.PI * 2;
        const r = 0.3 + k * (1.2 + (i % 3) * 0.4);
        c.position.set(Math.cos(a) * r, 0.4 + k * (0.8 + (i % 4) * 0.3), Math.sin(a) * r);
        c.scale.setScalar(arr < 0 ? 0.001 : Math.max(0.001, 1 - k));
      });
    }
  });

  const glow = { color: GLOW, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false } as const;
  return (
    <group>
      <mesh ref={ghost} position={[fx.from.x, 1.1, fx.from.z]}>
        <capsuleGeometry args={[0.45, 1.1, 6, 12]} /><meshBasicMaterial {...glow} color="#d8f3ff" />
      </mesh>
      <group position={[(fx.from.x + fx.to.x) / 2, 1.1, (fx.from.z + fx.to.z) / 2]} rotation-y={yaw}>
        <mesh ref={streak} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.1, 0.1, len, 8]} /><meshBasicMaterial {...glow} />
        </mesh>
      </group>
      <group position={[fx.to.x, 0, fx.to.z]}>
        <mesh ref={ring} position={[0, 0.06, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[1, 0.07, 8, 40]} /><meshBasicMaterial {...glow} />
        </mesh>
        <mesh ref={flash} position={[0, 1.1, 0]}>
          <sphereGeometry args={[0.8, 16, 12]} /><meshBasicMaterial {...glow} color="#ffffff" />
        </mesh>
        <group ref={sparks}>
          {Array.from({ length: 10 }, (_, i) => (
            <mesh key={i}><sphereGeometry args={[0.07, 6, 6]} /><meshBasicMaterial color={GLOW} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/** Esconde o avatar durante o "salto" e faz um pequeno "pop" ao reaparecer. */
function applyPop(id: string, pops: Ref<Map<string, number>>, obj: THREE.Object3D) {
  const appear = pops.current.get(id);
  if (appear === undefined) return;
  const now = performance.now();
  if (now < appear) { obj.visible = false; return; }
  obj.visible = true;
  const k = (now - appear) / 160;
  if (k >= 1) { obj.scale.setScalar(1); pops.current.delete(id); } else obj.scale.setScalar(1.35 - 0.35 * k);
}

// ---------------------------------------------------------------- jogadores
function RemotePlayer({ info, positions, bubble, emotes, actions, snaps, pops }:
  { info: PlayerInfo; positions: Ref<Map<string, PlayerPos>>; bubble?: string; emotes: Ref<Map<string, EmoteState>>;
    actions: Ref<Map<string, ActionState>>; snaps: Ref<Map<string, { x: number; z: number }>>; pops: Ref<Map<string, number>> }) {
  const ref = useRef<THREE.Group>(null);
  const pop = useRef<THREE.Group>(null);
  const init = useRef(false);
  const speed = useRef(0);
  const height = useRef(0);
  const getEmote = () => emotes.current.get(info.id);
  const getAction = () => actions.current.get(info.id);

  useFrame((_, dt) => {
    const g = ref.current;
    const target = positions.current.get(info.id);
    if (!g || !target) return;
    const snap = snaps.current.get(info.id);
    if (snap) { g.position.set(snap.x, 0, snap.z); snaps.current.delete(info.id); }
    if (!init.current) {
      g.position.set(target.x, 0, target.z);
      g.rotation.y = target.ry;
      init.current = true;
      return;
    }
    const k = 1 - Math.exp(-12 * dt);
    const px = g.position.x, pz = g.position.z;
    g.position.x += (target.x - g.position.x) * k;
    g.position.z += (target.z - g.position.z) * k;
    const v = Math.hypot(g.position.x - px, g.position.z - pz) / Math.max(dt, 1e-3);
    speed.current += (v - speed.current) * 0.3;
    let d = target.ry - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * k;
    g.position.y += ((target.y ?? 0) - g.position.y) * k;
    height.current = g.position.y;
    if (pop.current) applyPop(info.id, pops, pop.current);
  });

  return (
    <group ref={ref}>
      <group ref={pop}>
        <Avatar color={info.color} nick={info.nick + (info.away ? " (ausente)" : "")} bubble={bubble} speed={speed} height={height} getEmote={getEmote} getAction={getAction} />
      </group>
    </group>
  );
}

function LocalPlayer({ info, room, positions, bubble, cameraMode, onToggleCamera, settingsRef, uiBlock, emotes, actions, pops, onDodge, onNearStation, touch }:
  { info: PlayerInfo; room: Room; positions: Ref<Map<string, PlayerPos>>; bubble?: string; cameraMode: CameraMode;
    onToggleCamera: () => void; settingsRef: Ref<Settings>; uiBlock: Ref<boolean>; emotes: Ref<Map<string, EmoteState>>;
    actions: Ref<Map<string, ActionState>>; pops: Ref<Map<string, number>>; onDodge: SceneProps["onDodge"]; onNearStation: SceneProps["onNearStation"]; touch: Ref<TouchState> }) {
  const group = useRef<THREE.Group>(null);
  const pop = useRef<THREE.Group>(null);
  const { keys, look, dodgeReq, attackReq } = useControls(settingsRef, uiBlock, onToggleCamera);
  const lastAttack = useRef(0);
  const near = useRef<GameId | null>(null);
  const ready = useRef(false);
  const lastSent = useRef(0);
  const lastPos = useRef({ x: NaN, z: NaN, ry: NaN, y: NaN });
  const lastDodge = useRef(0);
  const speed = useRef(0);
  const height = useRef(0);
  const vy = useRef(0);
  const heading = useRef(0); // para onde o corpo olha (independente da câmera)
  const hands = useRef<THREE.Group>(null);
  const focus = useRef(new THREE.Vector3());
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const getEmote = () => emotes.current.get(info.id);
  const getAction = () => actions.current.get(info.id);

  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    if (!ready.current) {
      const spawn = positions.current.get(info.id);
      if (!spawn) return; // aguarda a posição inicial do servidor
      g.position.set(spawn.x, 0, spawn.z);
      focus.current.set(spawn.x, 0, spawn.z);
      ready.current = true;
    }

    if (import.meta.env.DEV) {
      const w = window as unknown as { __tp?: { x: number; z: number } | null };
      if (w.__tp) { g.position.set(w.__tp.x, 0, w.__tp.z); w.__tp = null; (window as unknown as { __tpSend?: number }).__tpSend = 25; } // dev: teleporte para testes
    }
    const b = settingsRef.current.bindings;
    const blocked = isTyping() || uiBlock.current;
    const k = keys.current;
    if (!blocked) {
      if (k.has("ArrowLeft")) look.current.yaw += 1.8 * dt;
      if (k.has("ArrowRight")) look.current.yaw -= 1.8 * dt;
    }
    const tc = touch.current;
    const stick = Math.hypot(tc.moveX, tc.moveY);
    const touchMove = !blocked && stick > 0.12;
    const f = blocked ? 0 : touchMove ? -tc.moveY : (isDown(k, b.forward) || k.has("ArrowUp") ? 1 : 0) - (isDown(k, b.back) || k.has("ArrowDown") ? 1 : 0);
    const s = blocked ? 0 : touchMove ? tc.moveX : (isDown(k, b.right) ? 1 : 0) - (isDown(k, b.left) ? 1 : 0);
    const running = !blocked && (isDown(k, b.run) || (touchMove && stick > 0.85)) && (f !== 0 || s !== 0);
    const sp = running ? RUN_SPEED : PLAYER_SPEED;
    const { yaw, pitch } = look.current;
    // yaw 0 olha para -z
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = fx * f + rx * s, mz = fz * f + rz * s;
    const len = Math.hypot(mx, mz);
    speed.current = len > 0 ? sp : 0;
    if (len > 0) {
      mx /= len; mz /= len;
      g.position.x += mx * sp * dt;
      g.position.z += mz * sp * dt;
      const c = resolveCollisions(g.position.x, g.position.z);
      g.position.x = c.x;
      g.position.z = c.z;
      if (cameraMode === "third") {
        // o corpo vira para a direção do movimento; a câmera fica livre para ver o rosto
        const target = Math.atan2(-mx, -mz);
        const diff = Math.atan2(Math.sin(target - heading.current), Math.cos(target - heading.current));
        heading.current += diff * (1 - Math.exp(-14 * dt));
      }
    }

    // esquiva: correr + esquerda/direita/trás = teleporte curto (validado pelo servidor)
    // pulo (apenas visual; o servidor limita a altura)
    if (!blocked && (isDown(k, b.jump) || tc.jump) && height.current === 0 && vy.current === 0) vy.current = JUMP_VELOCITY;
    if (vy.current !== 0 || height.current > 0) {
      height.current += vy.current * dt;
      vy.current -= GRAVITY * dt;
      if (height.current <= 0) { height.current = 0; vy.current = 0; }
    }
    g.position.y = height.current;

    let req = dodgeReq.current;
    dodgeReq.current = null;
    if (tc.dodge) {
      tc.dodge = false;
      req = Math.abs(tc.moveX) > 0.5 ? (tc.moveX < 0 ? "left" : "right") : "back"; // esquiva pelo botão: para o lado do joystick, ou para trás
    }
    const now = performance.now();
    if (req && !blocked && now - lastDodge.current >= DODGE_COOLDOWN_MS) {
      const dir = req === "left" ? { x: -rx, z: -rz } : req === "right" ? { x: rx, z: rz } : { x: -fx, z: -fz };
      const from = { x: g.position.x, z: g.position.z };
      const hit = resolveCollisions(from.x + dir.x * DODGE_DISTANCE, from.z + dir.z * DODGE_DISTANCE);
      const tx = hit.x, tz = hit.z;
      g.position.x = tx;
      g.position.z = tz;
      lastDodge.current = now;
      pops.current.set(info.id, now + 110);
      room.send(C.Dodge, { x: tx, z: tz, ry: heading.current });
      onDodge({ from, to: { x: tx, z: tz } });
      lastPos.current = { x: tx, z: tz, ry: heading.current, y: height.current };
      lastSent.current = now;
    }
    if (pop.current) applyPop(info.id, pops, pop.current);

    // golpes no lobby: só animação (ninguém sofre dano no lobby)
    const atk = attackReq.current ?? tc.attack;
    attackReq.current = null;
    tc.attack = null;
    if (atk && !blocked && now - lastAttack.current >= LOBBY_ATTACK_COOLDOWN_MS) {
      lastAttack.current = now;
      actions.current.set(info.id, { kind: atk, start: now });
      room.send(C.Attack, { kind: atk });
    }

    // proximidade das estações dos minijogos
    let nearest: GameId | null = null;
    for (const id of GAME_IDS) {
      const st = GAMES[id].station;
      if (Math.hypot(g.position.x - st.x, g.position.z - st.z) <= STATION_RADIUS) { nearest = id; break; }
    }
    if (nearest !== near.current) { near.current = nearest; onNearStation(nearest); }

    if (cameraMode === "first") heading.current = yaw;
    g.rotation.y = heading.current;
    if (import.meta.env.DEV) (window as unknown as { __ctl: Record<string, unknown> }).__ctl.heading = heading.current;

    // zoom de corrida
    const fov = running ? 78 : 70;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-8 * dt));
      camera.updateProjectionMatrix();
    }

    // câmera
    if (cameraMode === "first") {
      focus.current.set(g.position.x, 0, g.position.z);
      camera.position.set(g.position.x, 1.65 + height.current, g.position.z);
      camera.rotation.set(pitch, yaw, 0, "YXZ");
      if (hands.current) { hands.current.position.copy(camera.position); hands.current.quaternion.copy(camera.quaternion); }
    } else {
      // segue o personagem com leve atraso, para a esquiva não "estalar" a câmera
      const kf = 1 - Math.exp(-22 * dt);
      focus.current.x += (g.position.x - focus.current.x) * kf;
      focus.current.z += (g.position.z - focus.current.z) * kf;
      const inspect = (import.meta.env.DEV && (window as unknown as { __camDist?: number }).__camDist) || 0; // __camDist: só para inspeção em dev
      const dist = inspect || 5;
      camera.position.set(
        focus.current.x + Math.sin(yaw) * dist * Math.cos(pitch),
        Math.max(0.5, (inspect ? 1.3 : 3.6) + height.current * 0.6 + Math.sin(-pitch) * dist),
        focus.current.z + Math.cos(yaw) * dist * Math.cos(pitch),
      );
      camera.lookAt(focus.current.x, 1.35 + height.current * 0.6, focus.current.z);
    }

    // envio (~10 Hz, somente se mudou)
    const lp = lastPos.current;
    if (now - lastSent.current >= MOVE_SEND_INTERVAL_MS &&
        (lp.x !== g.position.x || lp.z !== g.position.z || lp.ry !== heading.current || lp.y !== height.current || devForce(true))) {
      room.send(C.Move, { x: g.position.x, z: g.position.z, y: height.current, ry: heading.current });
      lastSent.current = now;
      lastPos.current = { x: g.position.x, z: g.position.z, ry: heading.current, y: height.current };
    }
  });

  const { shirt } = palette(info.color);
  return (
    <>
      <group ref={group}>
        <group ref={pop}>
          <Avatar color={info.color} nick={info.nick} bubble={bubble} hidden={cameraMode === "first"} speed={speed} height={height} getEmote={getEmote} getAction={getAction} />
        </group>
      </group>
      <group ref={hands} visible={cameraMode === "first"}>
        <FirstPersonHands color={info.color} shirt={shirt} speed={speed} height={height} getEmote={getEmote} getAction={getAction} />
      </group>
    </>
  );
}

/** Texto flutuante da estação: nome do jogo, fila (n/mín) e contagem regressiva. */
function StationLabel({ game, queue }: { game: GameId; queue: QueueState | null }) {
  const def = GAMES[game];
  const [now, setNow] = useState(() => Date.now());
  const startsAt = queue?.games[game].startsAt ?? null;
  useEffect(() => {
    if (!startsAt) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [startsAt]);
  const offset = queue ? queue.serverNow - Date.now() : 0;
  const n = queue?.games[game].members.length ?? 0;
  let text = `${def.icon} ${def.label}`;
  if (!def.available) text += " (em breve)";
  else if (queue?.busy) text += queue.busy === game ? " — em andamento" : "";
  else if (startsAt) text += ` — começa em ${Math.max(0, Math.ceil((startsAt - (now + offset)) / 1000))}s`;
  else text += ` · ${n}/${def.min}`;
  return <div className="stationlabel">{text}</div>;
}

function Station({ game, queue, color, children }: { game: GameId; queue: QueueState | null; color: string; children: React.ReactNode }) {
  const st = GAMES[game].station;
  return (
    <group position={[st.x, 0, st.z]}>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[2.9, 3.1, 0.3, 8]} /><Flat color="#d8c7a3" /></mesh>
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[2.5, 2.6, 0.1, 8]} /><Flat color={color} /></mesh>
      <group position={[0, 0.3, 0]} scale={1.5}>{children}</group>
      <Html position={[0, 4.4, 0]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
        <StationLabel game={game} queue={queue} />
      </Html>
    </group>
  );
}

/** Lobby: ilha flutuante de grama com lago e ponte, casinha, pinheiros, pedras e estações dos jogos. */
function World({ queue }: { queue: QueueState | null }) {
  const islets = useMemo(() => [
    { x: -34, y: -3, z: 14, r: 4.5 }, { x: 33, y: -5, z: -10, r: 5.5 }, { x: 22, y: 1, z: 36, r: 3.5 }, { x: -26, y: -1, z: -34, r: 4 },
  ], []);
  return (
    <>
      <color attach="background" args={["#a9dcff"]} />
      <fog attach="fog" args={["#cfe9ff", 35, 120]} />
      <hemisphereLight args={["#ffffff", "#a8d67a", 1.0]} />
      <directionalLight position={[14, 22, 9]} intensity={1.25} color="#fff4e0" />

      <Island radius={WORLD_RADIUS + 1.6} top={PALETTE.grass[0]} />

      {/* caminhos de areia ligando o centro às estações */}
      {GAME_IDS.map((g) => {
        const { x, z } = GAMES[g].station;
        const len = Math.hypot(x, z);
        return (
          <mesh key={g} position={[x / 2, 0.02, z / 2]} rotation={[-Math.PI / 2, 0, -Math.atan2(z, x)]}>
            <planeGeometry args={[len, 2.4]} /><Flat color={PALETTE.sand} />
          </mesh>
        );
      })}

      {/* lago central com ponte (só dá para atravessar pela ponte) */}
      <mesh position={[0, 0.04, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[POND.radius + 0.5, 10]} /><Flat color={PALETTE.sand} /></mesh>
      <FacetedWater width={POND.radius * 2 - 0.4} depth={POND.radius * 2 - 0.4} round position={[0, 0.07, 0]} />
      {POND_ROCKS.map((p, i) => <Rock key={i} position={[p.x, 0.15, p.z]} scale={0.8 + p.k * 0.5} seed={p.seed} color={PALETTE.rock[i % 3]} />)}
      <Bridge position={[0, 0.24, 0]} length={BRIDGE.halfLength * 2 - 1} width={BRIDGE.halfWidth * 2 - 0.1} />

      {/* casinha ao fundo, em escala compatível com os personagens (porta mais alta que eles) */}
      <Hut position={[HUT.x, 0, HUT.z]} scale={HUT.scale} />
      <mesh position={[0, 0.03, HUT.z + 3.4]} rotation-x={-Math.PI / 2}><planeGeometry args={[1.8, 3.2]} /><Flat color={PALETTE.sand} /></mesh>

      {/* estações dos jogos */}
      <Station game="board" queue={queue} color="#7ed3a0">
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[(i - 1.5) * 0.9, 0.15, (i % 2) * 0.5 - 0.25]}><boxGeometry args={[0.8, 0.3, 0.8]} />
            <Flat color={["#ef4444", "#facc15", "#22c55e", "#3b82f6"][i]!} /></mesh>
        ))}
        <mesh position={[0, 0.9, -0.8]} rotation-y={0.5}><icosahedronGeometry args={[0.5, 0]} /><Flat color="#ffffff" /></mesh>
      </Station>
      <Station game="pool" queue={queue} color="#e9d29b">
        <mesh position={[0, 0.8, 0]}><boxGeometry args={[3.2, 0.2, 1.8]} /><Flat color="#15803d" /></mesh>
        <mesh position={[0, 0.45, 0]}><boxGeometry args={[3.4, 0.5, 2]} /><Flat color={PALETTE.wood} /></mesh>
        {[-1.4, 1.4].flatMap((x) => [-0.7, 0.7].map((z) => <mesh key={`${x}${z}`} position={[x, 0.15, z]}><boxGeometry args={[0.2, 0.3, 0.2]} /><Flat color={PALETTE.wood} /></mesh>))}
      </Station>
      <Station game="impostor" queue={queue} color="#c9b6e8">
        <mesh position={[0, 0.8, 0]}><boxGeometry args={[3.2, 0.2, 1.8]} /><Flat color="#7e22ce" /></mesh>
        <mesh position={[0, 0.45, 0]}><boxGeometry args={[3.4, 0.5, 2]} /><Flat color="#3b0764" /></mesh>
        <mesh position={[0, 1.15, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.12, 0.12, 0.6, 8]} /><Flat color="#16a34a" /></mesh>
      </Station>

      {PINES.map((p, i) => <Pine key={i} position={[p.x, 0, p.z]} scale={p.scale} color={p.color} tiers={p.tiers} />)}
      {ROCKS.map((p, i) => <Rock key={i} position={[p.x, 0.15, p.z]} scale={p.scale} seed={p.seed} color={p.color} />)}
      {FLOWERS.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.025, 0.03, 0.4, 5]} /><Flat color="#3fae3a" /></mesh>
          <mesh position={[0, 0.45, 0]}><icosahedronGeometry args={[0.17, 0]} /><Flat color={p.color} /></mesh>
        </group>
      ))}

      {/* ilhotas ao redor e nuvens */}
      {islets.map((it, i) => (
        <group key={i} position={[it.x, it.y, it.z]}>
          <Island radius={it.r} top={PALETTE.grass[i % 3]} />
          <Pine position={[0.4, 0, 0.2]} scale={1.3 + (i % 2) * 0.5} color={PALETTE.pine[i % 3]} />
          {i % 2 === 0 && <Rock position={[-it.r * 0.4, 0.3, it.r * 0.2]} scale={1.3} seed={i + 3} />}
        </group>
      ))}
      <Clouds count={9} radius={58} />
    </>
  );
}

export function LobbyContent(p: SceneProps) {
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  useEffect(() => { camera.fov = 70; camera.near = 0.05; camera.far = 400; camera.updateProjectionMatrix(); }, [camera]);
  const visible = p.players.filter((pl) => pl.id === p.you || !pl.inGame); // quem está numa partida some do lobby
  return (
    <>
      <World queue={p.queue} />
      {p.effects.map((fx) => <TeleportFX key={fx.key} fx={fx} />)}
      {visible.map((pl) => pl.id === p.you
        ? <LocalPlayer key={pl.id} info={pl} room={p.room} positions={p.positions} bubble={p.bubbles[pl.id]?.text}
            cameraMode={p.cameraMode} onToggleCamera={p.onToggleCamera} settingsRef={p.settingsRef} uiBlock={p.uiBlock}
            emotes={p.emotes} actions={p.actions} pops={p.pops} onDodge={p.onDodge} onNearStation={p.onNearStation} touch={p.touch} />
        : <RemotePlayer key={pl.id} info={pl} positions={p.positions} bubble={p.bubbles[pl.id]?.text}
            emotes={p.emotes} actions={p.actions} snaps={p.snaps} pops={p.pops} />)}
    </>
  );
}
