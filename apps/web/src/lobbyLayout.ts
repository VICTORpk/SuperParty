import { GAME_IDS, GAMES, WORLD_RADIUS } from "@jogo/shared";
import { PALETTE, ringPoints } from "./scenery";

/** Disposição do lobby, compartilhada entre o cenário (desenho) e as colisões. */

export const PINES = ringPoints(34, 13.5, 18.2, 11).map((p, i) => ({ ...p, scale: 1.3 + p.k * 0.8, color: PALETTE.pine[i % 3]!, tiers: 3 + (i % 2) }));
export const ROCKS = ringPoints(16, 6, 18, 23).map((p, i) => ({ ...p, scale: 0.8 + p.k * 1.0, color: PALETTE.rock[i % 3]! }));
export const FLOWERS = ringPoints(46, 4, 17, 31).map((p, i) => ({ ...p, color: ["#ffd54a", "#ff8fa3", "#ffffff", "#c084fc"][i % 4]! }));
export const POND_ROCKS = ringPoints(10, 4.1, 4.9, 5);

export const HUT = { x: 0, z: -14.5, scale: 1.9 };
export const POND = { radius: 4.1 };
/** Faixa da ponte (centrada em z = 0, ao longo de x). */
export const BRIDGE = { halfWidth: 1.25, halfLength: 5.3 };

export interface Circle { x: number; z: number; r: number }

/** Círculos sólidos (tronco dos pinheiros, pedras, casinha, mesas das estações). */
export const COLLIDERS: Circle[] = [
  ...PINES.map((p) => ({ x: p.x, z: p.z, r: 0.38 * p.scale + 0.1 })),
  ...ROCKS.filter((r) => r.scale > 0.95).map((r) => ({ x: r.x, z: r.z, r: 0.45 * r.scale })),
  ...POND_ROCKS.map((p) => ({ x: p.x, z: p.z, r: 0.5 })),
  // casinha (retângulo ≈ 4,9 × 4,2) aproximada por 4 círculos
  ...[-1.7, -0.6, 0.6, 1.7].map((dx) => ({ x: HUT.x + dx * (HUT.scale / 1.9) * 1.0, z: HUT.z, r: 1.55 })),
  // estações: a mesa central de cada jogo
  ...GAME_IDS.map((g) => ({ x: GAMES[g].station.x, z: GAMES[g].station.z, r: 2.1 })),
];

const PLAYER_R = 0.45;

/** Empurra a posição para fora de qualquer objeto sólido e mantém o jogador na ilha e fora da água (exceto na ponte). */
export function resolveCollisions(x: number, z: number): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of COLLIDERS) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + PLAYER_R;
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        x = c.x + nx * min;
        z = c.z + nz * min;
      }
    }
    // lago: só dá para atravessar pela ponte
    const dp = Math.hypot(x, z);
    const onBridge = Math.abs(z) < BRIDGE.halfWidth - 0.15 && Math.abs(x) < BRIDGE.halfLength + POND.radius;
    if (dp < POND.radius + PLAYER_R && !onBridge) {
      const nx = dp > 1e-4 ? x / dp : 0, nz = dp > 1e-4 ? z / dp : 1;
      x = nx * (POND.radius + PLAYER_R);
      z = nz * (POND.radius + PLAYER_R);
    }
    // corrimão da ponte: dentro do lago, não sair pelos lados
    if (dp < POND.radius + PLAYER_R && onBridge && Math.abs(z) > BRIDGE.halfWidth - 0.15) z = Math.sign(z) * (BRIDGE.halfWidth - 0.15);
  }
  const r = Math.hypot(x, z);
  if (r > WORLD_RADIUS) { x *= WORLD_RADIUS / r; z *= WORLD_RADIUS / r; }
  return { x, z };
}
