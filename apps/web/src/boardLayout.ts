import { BOARD_LENGTH } from "@jogo/shared";

/** Percurso sinuoso (estilo "tabuleiro de festa"): pontos de controle em (x, z, altura). */
const CONTROL: [number, number, number][] = [
  [-21, 13, 0], [-14, 16, 0], [-6, 14, 0.3], [0, 9.5, 0.6], [6, 12.5, 0.3], [14, 15, 0], [20, 9.5, 0.2],
  [21.5, 1.5, 0.8], [15.5, -4, 1.2], [8, -3, 1.3], [2, -6.5, 1], [-5, -4.5, 0.7], [-12.5, -1.5, 0.9],
  [-18.5, -6, 1.3], [-20, -12.5, 1.8], [-13, -17.5, 2.2], [-5, -16.5, 2.6], [3, -17.5, 3.2], [11, -15.5, 3.8], [16, -10, 4.4],
];

export const TILE_RADIUS = 1.25;
export interface PathPoint { x: number; y: number; z: number; tx: number; tz: number }

/** Catmull-Rom entre pontos de controle, amostrado densamente. */
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

export const DENSE = buildDense();

const cum: number[] = [0];
for (let i = 1; i < DENSE.length; i++) cum.push(cum[i - 1]! + Math.hypot(DENSE[i]!.x - DENSE[i - 1]!.x, DENSE[i]!.z - DENSE[i - 1]!.z));
export const PATH_LENGTH = cum[cum.length - 1]!;

function sampleAt(s: number): PathPoint {
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid]! <= s) lo = mid; else hi = mid; }
  const a = DENSE[lo]!, b = DENSE[hi]!;
  const k = (s - cum[lo]!) / Math.max(1e-6, cum[hi]! - cum[lo]!);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, tx: a.tx + (b.tx - a.tx) * k, tz: a.tz + (b.tz - a.tz) * k };
}

const TILES: PathPoint[] = Array.from({ length: BOARD_LENGTH }, (_, i) => sampleAt((i / (BOARD_LENGTH - 1)) * PATH_LENGTH));

/** Posição (x, y, z) do centro da casa; `tx/tz` é a direção do percurso. */
export function tilePosition(index: number): PathPoint {
  return TILES[Math.max(0, Math.min(BOARD_LENGTH - 1, index))]!;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export const VOLCANO = { x: -7, z: 5, height: 9 };
export const LAGOON = { x: 12, z: 5 };

/** Altura do terreno: segue o percurso de perto, com colinas, vulcão, lagoa e praia nas bordas. */
export function terrainHeight(x: number, z: number): number {
  let best = Infinity, by = 0;
  for (let i = 0; i < DENSE.length; i += 2) {
    const p = DENSE[i]!;
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < best) { best = d2; by = p.y; }
  }
  const d = Math.sqrt(best);
  const w = Math.exp(-((d / 5.2) ** 2));
  const r = Math.hypot(x / 31, z / 26);
  let base = 0.3 - smooth(0.7, 1.0, r) * 4.5;
  base += VOLCANO.height * Math.exp(-((Math.hypot(x - VOLCANO.x, z - VOLCANO.z) / 4.6) ** 2));
  base -= 2.6 * Math.exp(-((Math.hypot(x - LAGOON.x, z - LAGOON.z) / 4.2) ** 2));
  base += 0.45 * Math.sin(x * 0.33) * Math.cos(z * 0.29);
  return by * w + base * (1 - w);
}
