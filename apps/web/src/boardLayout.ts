import type { BoardLayout } from "@jogo/shared";

/** Percurso sinuoso (estilo "tabuleiro de festa"): pontos de controle em (x, z, altura) para a ilha base. */
const CONTROL: [number, number, number][] = [
  [-21, 13, 0], [-14, 16, 0], [-6, 14, 0.3], [0, 9.5, 0.6], [6, 12.5, 0.3], [14, 15, 0], [20, 9.5, 0.2],
  [21.5, 1.5, 0.8], [15.5, -4, 1.2], [8, -3, 1.3], [2, -6.5, 1], [-5, -4.5, 0.7], [-12.5, -1.5, 0.9],
  [-18.5, -6, 1.3], [-20, -12.5, 1.8], [-13, -17.5, 2.2], [-5, -16.5, 2.6], [3, -17.5, 3.2], [11, -15.5, 3.8], [16, -10, 4.4],
];

export const TILE_RADIUS = 1.25;
/** Distância mínima desejada entre os centros de casas vizinhas. */
const MIN_SPACING = 2.9;
const BASE_VOLCANO = { x: -7, z: 5, height: 9 };
const BASE_LAGOON = { x: 12, z: 5 };

export interface PathPoint { x: number; y: number; z: number; tx: number; tz: number }

/** Catmull-Rom entre pontos de controle, amostrado densamente (coordenadas da ilha base). */
function buildDense(): PathPoint[] {
  const out: PathPoint[] = [];
  const n = CONTROL.length;
  const P = (i: number) => CONTROL[Math.max(0, Math.min(n - 1, i))]!;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, c2: number, d: number) =>
        0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      out.push({ x: c(p0[0], p1[0], p2[0], p3[0]), z: c(p0[1], p1[1], p2[1], p3[1]), y: c(p0[2], p1[2], p2[2], p3[2]), tx: 0, tz: 0 });
    }
  }
  const last = CONTROL[n - 1]!;
  out.push({ x: last[0], z: last[1], y: last[2], tx: 0, tz: 0 });
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)]!, b = out[Math.min(out.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out[i]!.tx = dx / l;
    out[i]!.tz = dz / l;
  }
  return out;
}

const BASE_DENSE = buildDense();
const BASE_LENGTH = (() => {
  let s = 0;
  for (let i = 1; i < BASE_DENSE.length; i++) s += Math.hypot(BASE_DENSE[i]!.x - BASE_DENSE[i - 1]!.x, BASE_DENSE[i]!.z - BASE_DENSE[i - 1]!.z);
  return s;
})();

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Altura do terreno da ilha base: segue o percurso de perto, com colinas, vulcão, lagoa e praia nas bordas. */
function baseHeight(x: number, z: number): number {
  let best = Infinity, by = 0;
  for (let i = 0; i < BASE_DENSE.length; i += 2) {
    const p = BASE_DENSE[i]!;
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < best) { best = d2; by = p.y; }
  }
  const d = Math.sqrt(best);
  const w = Math.exp(-((d / 5.2) ** 2));
  const r = Math.hypot(x / 31, z / 26);
  let base = 0.3 - smooth(0.7, 1.0, r) * 4.5;
  base += BASE_VOLCANO.height * Math.exp(-((Math.hypot(x - BASE_VOLCANO.x, z - BASE_VOLCANO.z) / 4.6) ** 2));
  base -= 2.6 * Math.exp(-((Math.hypot(x - BASE_LAGOON.x, z - BASE_LAGOON.z) / 4.2) ** 2));
  base += 0.45 * Math.sin(x * 0.33) * Math.cos(z * 0.29);
  return by * w + base * (1 - w);
}

/**
 * Geometria do tabuleiro para um número de casas: a mesma ilha ampliada por `scale` (o percurso fica mais
 * longo e as casas continuam com o mesmo tamanho e espaçamento mínimo), com as casas distribuídas por distância.
 */
export interface BoardGeometry {
  length: number;
  scale: number;
  dense: PathPoint[];
  tiles: PathPoint[];
  volcano: { x: number; z: number; height: number };
  lagoon: { x: number; z: number };
  tilePosition(index: number): PathPoint;
  terrainHeight(x: number, z: number): number;
  distToPath(x: number, z: number): number;
}

const cache = new Map<number, BoardGeometry>();

export function boardGeometry(length: number): BoardGeometry {
  const hit = cache.get(length);
  if (hit) return hit;
  const scale = Math.max(1, (MIN_SPACING * (length - 1)) / BASE_LENGTH);
  const dense: PathPoint[] = BASE_DENSE.map((p) => ({ x: p.x * scale, y: p.y, z: p.z * scale, tx: p.tx, tz: p.tz }));
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1]! + Math.hypot(dense[i]!.x - dense[i - 1]!.x, dense[i]!.z - dense[i - 1]!.z));
  const total = cum[cum.length - 1]!;
  const sampleAt = (s: number): PathPoint => {
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid]! <= s) lo = mid; else hi = mid; }
    const a = dense[lo]!, b = dense[hi]!;
    const k = (s - cum[lo]!) / Math.max(1e-6, cum[hi]! - cum[lo]!);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, tx: a.tx + (b.tx - a.tx) * k, tz: a.tz + (b.tz - a.tz) * k };
  };
  const tiles = Array.from({ length }, (_, i) => sampleAt((i / (length - 1)) * total));
  const geo: BoardGeometry = {
    length, scale, dense, tiles,
    volcano: { x: BASE_VOLCANO.x * scale, z: BASE_VOLCANO.z * scale, height: BASE_VOLCANO.height },
    lagoon: { x: BASE_LAGOON.x * scale, z: BASE_LAGOON.z * scale },
    tilePosition: (index) => tiles[Math.max(0, Math.min(length - 1, index))]!,
    terrainHeight: (x, z) => baseHeight(x / scale, z / scale),
    distToPath: (x, z) => {
      let best = Infinity;
      for (let i = 0; i < dense.length; i += 2) best = Math.min(best, (dense[i]!.x - x) ** 2 + (dense[i]!.z - z) ** 2);
      return Math.sqrt(best);
    },
  };
  cache.set(length, geo);
  return geo;
}

/** Tipo reexportado para quem só precisa do layout de casas. */
export type { BoardLayout };
