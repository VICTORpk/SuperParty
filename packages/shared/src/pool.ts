/**
 * Física 2D e regras geométricas da sinuca (bola 8). Código puro e determinístico: o servidor simula a tacada
 * inteira e envia a gravação; os clientes só reproduzem.
 *
 * Simplificações: sem efeito (spin), bolas todas com a mesma massa, atrito linear + arrasto leve.
 */

export const POOL = {
  halfW: 6, // meia largura da área de jogo (eixo x)
  halfD: 3, // meia profundidade (eixo z)
  ballR: 0.15,
  cornerPocketR: 0.34,
  sidePocketR: 0.36,
  maxSpeed: 16, // velocidade da bola branca com força 100%
  minPower: 0.04,
  decel: 0.9, // desaceleração constante (u/s²)
  drag: 0.25, // arrasto proporcional (1/s)
  stopSpeed: 0.04,
  ballRestitution: 0.95,
  railRestitution: 0.72,
  subSteps: 8, // passos de simulação por quadro gravado
  stepDt: 1 / 240,
  frameMs: (1000 / 240) * 8, // ≈ 33,3 ms
  maxSimSeconds: 40,
  head: { x: -3, z: 0 }, // posição inicial da bola branca
  foot: { x: 3, z: 0 }, // vértice do triângulo
} as const;

/** Valor que marca "bola fora da mesa" nos quadros gravados (centésimos de unidade). */
export const POOL_OUT = 9999;

export const POCKETS: readonly { x: number; z: number; r: number }[] = [
  { x: -POOL.halfW, z: -POOL.halfD, r: POOL.cornerPocketR },
  { x: 0, z: -POOL.halfD, r: POOL.sidePocketR },
  { x: POOL.halfW, z: -POOL.halfD, r: POOL.cornerPocketR },
  { x: -POOL.halfW, z: POOL.halfD, r: POOL.cornerPocketR },
  { x: 0, z: POOL.halfD, r: POOL.sidePocketR },
  { x: POOL.halfW, z: POOL.halfD, r: POOL.cornerPocketR },
];

export type PoolGroup = "solid" | "stripe";

/** 0 = branca · 1–7 lisas · 8 = preta · 9–15 listradas */
export function groupOf(id: number): PoolGroup | null {
  if (id >= 1 && id <= 7) return "solid";
  if (id >= 9 && id <= 15) return "stripe";
  return null;
}

export interface SimBall { id: number; x: number; z: number; vx: number; vz: number; out: boolean }

export type PoolEvent =
  | { t: number; kind: "hit"; a: number; b: number; v: number }
  | { t: number; kind: "rail"; ball: number; v: number }
  | { t: number; kind: "pocket"; ball: number; pocket: number };

export interface ShotRecording {
  frameMs: number;
  /** Um quadro = 16 bolas × (x, z) em centésimos de unidade; bola fora = POOL_OUT. */
  frames: number[][];
  events: PoolEvent[];
  totalMs: number;
}

export interface ShotResult {
  recording: ShotRecording;
  firstContact: number | null;
  pocketed: number[]; // ids na ordem em que caíram
  finalBalls: SimBall[];
}

/** `rng(n)` devolve um inteiro em [0, n). */
export function rackBalls(rng: (n: number) => number): SimBall[] {
  const r = POOL.ballR;
  const gap = 2 * r * 1.002;
  const dx = Math.sqrt(3) * r * 1.002;
  const slots: { x: number; z: number; row: number; col: number }[] = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col <= row; col++) slots.push({ x: POOL.foot.x + row * dx, z: (col - row / 2) * gap, row, col });

  const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
  const take = (arr: number[]) => arr.splice(rng(arr.length), 1)[0]!;
  const ids = new Array<number>(15).fill(0);
  // índice no vetor `slots`: linha 2 (0-based) tem os slots 3,4,5 → o do meio é o 4 (bola 8)
  ids[4] = 8;
  const last = slots.findIndex((s) => s.row === 4);
  const leftCorner = last, rightCorner = last + 4;
  const solidFirst = rng(2) === 0;
  ids[leftCorner] = take(solidFirst ? solids : stripes);
  ids[rightCorner] = take(solidFirst ? stripes : solids);
  const rest = [...solids, ...stripes];
  for (let i = 0; i < 15; i++) if (ids[i] === 0) ids[i] = take(rest);

  const balls: SimBall[] = [{ id: 0, x: POOL.head.x, z: POOL.head.z, vx: 0, vz: 0, out: false }];
  slots.forEach((s, i) => balls.push({ id: ids[i]!, x: s.x, z: s.z, vx: 0, vz: 0, out: false }));
  return balls.sort((a, b) => a.id - b.id);
}

export function cloneBalls(balls: readonly SimBall[]): SimBall[] {
  return balls.map((b) => ({ ...b }));
}

/** Procura uma posição livre para a bola (usada para recolocar a bola 8 ou a branca). */
export function findFreeSpot(balls: readonly SimBall[], want: { x: number; z: number }, ignoreId = -1): { x: number; z: number } {
  const r = POOL.ballR;
  const free = (x: number, z: number) =>
    Math.abs(x) <= POOL.halfW - r && Math.abs(z) <= POOL.halfD - r &&
    balls.every((b) => b.out || b.id === ignoreId || Math.hypot(b.x - x, b.z - z) >= 2 * r + 0.01);
  if (free(want.x, want.z)) return { x: want.x, z: want.z };
  for (let ring = 1; ring < 60; ring++) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = want.x + Math.cos(a) * ring * 0.1, z = want.z + Math.sin(a) * ring * 0.1;
      if (free(x, z)) return { x, z };
    }
  }
  return { x: want.x, z: want.z };
}

export function isValidCuePlacement(balls: readonly SimBall[], x: unknown, z: unknown): x is number {
  if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const r = POOL.ballR;
  if (Math.abs(x) > POOL.halfW - r || Math.abs(z) > POOL.halfD - r) return false;
  for (const p of POCKETS) if (Math.hypot(x - p.x, z - p.z) < p.r + r) return false;
  return balls.every((b) => b.out || b.id === 0 || Math.hypot(b.x - x, b.z - z) >= 2 * r);
}

/**
 * Simula uma tacada até todas as bolas pararem. `angle` = direção da bola branca (radianos, eixo x→z),
 * `power` em (0, 1].
 */
export function simulateShot(start: readonly SimBall[], angle: number, power: number): ShotResult {
  const balls = cloneBalls(start);
  const cue = balls.find((b) => b.id === 0)!;
  const p = Math.min(1, Math.max(POOL.minPower, power));
  cue.vx = Math.cos(angle) * POOL.maxSpeed * p;
  cue.vz = Math.sin(angle) * POOL.maxSpeed * p;

  const r = POOL.ballR, dt = POOL.stepDt;
  const events: PoolEvent[] = [];
  const frames: number[][] = [];
  const pocketed: number[] = [];
  let firstContact: number | null = null;
  let step = 0;

  const snapshot = () => {
    const f: number[] = [];
    for (const b of balls) f.push(b.out ? POOL_OUT : Math.round(b.x * 100), b.out ? POOL_OUT : Math.round(b.z * 100));
    frames.push(f);
  };
  snapshot();

  const maxSteps = POOL.maxSimSeconds / dt;
  while (step < maxSteps) {
    step++;
    const t = step * dt * 1000;
    let moving = false;
    for (const b of balls) {
      if (b.out) continue;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const s = Math.hypot(b.vx, b.vz);
      if (s > 0) {
        const s2 = Math.max(0, s - POOL.decel * dt) * (1 - POOL.drag * dt);
        const k = s2 / s;
        b.vx *= k; b.vz *= k;
        if (s2 < POOL.stopSpeed) { b.vx = 0; b.vz = 0; }
        else moving = true;
      }
    }

    // bola × bola
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]!;
      if (a.out) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const c = balls[j]!;
        if (c.out) continue;
        const dx = c.x - a.x, dz = c.z - a.z;
        const d2 = dx * dx + dz * dz;
        const min = 2 * r;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const push = (min - d) / 2;
        a.x -= nx * push; a.z -= nz * push;
        c.x += nx * push; c.z += nz * push;
        const vn = (a.vx - c.vx) * nx + (a.vz - c.vz) * nz;
        if (vn > 0) {
          const j2 = ((1 + POOL.ballRestitution) / 2) * vn;
          a.vx -= j2 * nx; a.vz -= j2 * nz;
          c.vx += j2 * nx; c.vz += j2 * nz;
          events.push({ t, kind: "hit", a: a.id, b: c.id, v: vn });
          if (firstContact === null && (a.id === 0 || c.id === 0)) firstContact = a.id === 0 ? c.id : a.id;
          moving = true;
        }
      }
    }

    // caçapas e tabelas
    for (const b of balls) {
      if (b.out) continue;
      let fell = false;
      for (let pi = 0; pi < POCKETS.length; pi++) {
        const pk = POCKETS[pi]!;
        if (Math.hypot(b.x - pk.x, b.z - pk.z) <= pk.r) {
          b.out = true; b.vx = 0; b.vz = 0;
          pocketed.push(b.id);
          events.push({ t, kind: "pocket", ball: b.id, pocket: pi });
          fell = true;
          break;
        }
      }
      if (fell) continue;
      const lx = POOL.halfW - r, lz = POOL.halfD - r;
      if (b.x > lx || b.x < -lx) {
        const v = Math.abs(b.vx);
        b.x = b.x > 0 ? lx : -lx;
        b.vx = -b.vx * POOL.railRestitution;
        b.vz *= 0.985;
        if (v > 0.3) events.push({ t, kind: "rail", ball: b.id, v });
      }
      if (b.z > lz || b.z < -lz) {
        const v = Math.abs(b.vz);
        b.z = b.z > 0 ? lz : -lz;
        b.vz = -b.vz * POOL.railRestitution;
        b.vx *= 0.985;
        if (v > 0.3) events.push({ t, kind: "rail", ball: b.id, v });
      }
    }

    if (step % POOL.subSteps === 0) snapshot();
    if (!moving) break;
  }
  if (step % POOL.subSteps !== 0) snapshot();
  for (const b of balls) { b.vx = 0; b.vz = 0; }

  return {
    recording: { frameMs: POOL.frameMs, frames, events, totalMs: Math.round((frames.length - 1) * POOL.frameMs) },
    firstContact,
    pocketed,
    finalBalls: balls,
  };
}

export interface AimPrediction {
  /** Ponto onde o centro da bola branca estará no primeiro contato (ou na tabela). */
  x: number;
  z: number;
  /** Bola atingida primeiro (null = tabela). */
  hit: number | null;
  /** Direção em que a bola atingida vai sair (unitária), quando há bola. */
  outX: number;
  outZ: number;
}

/** Guia de mira: varre a bola branca ao longo da direção e acha o primeiro contato. */
export function predictAim(balls: readonly SimBall[], angle: number): AimPrediction {
  const cue = balls.find((b) => b.id === 0)!;
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const r2 = 2 * POOL.ballR;
  let bestT = Infinity, hit: number | null = null;
  for (const b of balls) {
    if (b.id === 0 || b.out) continue;
    const fx = cue.x - b.x, fz = cue.z - b.z;
    const bq = fx * dx + fz * dz;
    const c = fx * fx + fz * fz - r2 * r2;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < bestT) { bestT = t; hit = b.id; }
  }
  const lx = POOL.halfW - POOL.ballR, lz = POOL.halfD - POOL.ballR;
  let tWall = Infinity;
  if (dx > 1e-6) tWall = Math.min(tWall, (lx - cue.x) / dx);
  if (dx < -1e-6) tWall = Math.min(tWall, (-lx - cue.x) / dx);
  if (dz > 1e-6) tWall = Math.min(tWall, (lz - cue.z) / dz);
  if (dz < -1e-6) tWall = Math.min(tWall, (-lz - cue.z) / dz);
  if (tWall < bestT) { bestT = tWall; hit = null; }
  const x = cue.x + dx * bestT, z = cue.z + dz * bestT;
  let outX = 0, outZ = 0;
  if (hit !== null) {
    const o = balls.find((b) => b.id === hit)!;
    const nx = o.x - x, nz = o.z - z, l = Math.hypot(nx, nz) || 1;
    outX = nx / l; outZ = nz / l;
  }
  return { x, z, hit, outX, outZ };
}

// ---------------------------------------------------------------- estado público e mensagens
export type PoolPhase = "break" | "aim" | "placing" | "shooting" | "finished";

export interface PoolBallState { id: number; x: number; z: number; out: boolean }

export interface PoolPublicState {
  phase: PoolPhase;
  /** Todos os jogadores (2 a 4). */
  players: string[];
  /** Duas equipes: 1×1, 1×2 (com 3 jogadores) ou 2×2. Quem joga a seguir alterna entre as equipes. */
  teams: string[][];
  turn: string;
  /** Grupo de bolas de cada jogador (os companheiros de equipe têm o mesmo). */
  groups: Record<string, PoolGroup | null>;
  balls: PoolBallState[];
  /** O jogador da vez deve posicionar a bola branca. */
  ballInHand: boolean;
  turnEndsAt: number | null;
  message: string;
  winner: string | null;
  /** Equipe vencedora (todos os integrantes). */
  winners: string[];
  endReason: string | null;
  shotId: number;
  serverNow: number;
}

export interface PoolShotMsg {
  shotId: number;
  shooter: string;
  angle: number;
  power: number;
  recording: ShotRecording;
}

export const POOL_RULES = {
  aimMs: 45_000,
  placeMs: 30_000,
  awayActionMs: 3_000,
  settleMs: 900, // espera depois da gravação antes de aplicar as regras
} as const;

/** O que a cena da mesa precisa saber, comum à sinuca clássica e à Impostor. */
export interface TableState {
  phase: string;
  turn: string;
  balls: PoolBallState[];
  ballInHand: boolean;
  shotId: number;
}
