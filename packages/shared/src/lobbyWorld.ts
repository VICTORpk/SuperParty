import { WORLD_RADIUS } from "./constants";
import { GAME_IDS, GAMES } from "./games";

/**
 * Geometria do lobby (posições dos objetos sólidos e colisões), compartilhada entre o cenário (desenho),
 * o cliente (colisão local) e o servidor (bots de desenvolvimento que andam pelo lobby).
 */

/** Gerador pseudoaleatório determinístico (mesmo cenário para todos os jogadores). */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Espalha elementos em um anel (determinístico). */
export function ringPoints(count: number, rMin: number, rMax: number, seed: number, zScale = 1) {
  const r = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.4;
    const d = rMin + r() * (rMax - rMin);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d * zScale, k: r(), seed: i + seed * 17 };
  });
}

export const PINE_POINTS = ringPoints(34, 13.5, 18.2, 11).map((p) => ({ ...p, scale: 1.3 + p.k * 0.8 }));
export const FLOWER_POINTS = ringPoints(46, 4, 17, 31);

export const HUT = { x: 0, z: -14.5, scale: 1.9 };
export const POND = { radius: 4.1 };
/** Faixa da ponte (centrada em z = 0, ao longo de x). */
export const BRIDGE = { halfWidth: 1.25, halfLength: 5.3 };

export interface Circle { x: number; z: number; r: number }

/** Círculos sólidos (tronco dos pinheiros, casinha, mesas das estações). */
export const COLLIDERS: Circle[] = [
  ...PINE_POINTS.map((p) => ({ x: p.x, z: p.z, r: 0.38 * p.scale + 0.1 })),
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
