import { MAX_JUMP_Y, DODGE_COOLDOWN_MS, DODGE_MAX_DISTANCE, MAX_SPEED, WORLD_RADIUS } from "./constants";

export interface Vec2 { x: number; z: number }

export interface PlayerPos { id: string; x: number; z: number; ry: number; y: number }

/** Posição inicial em círculo para até 10 jogadores. */
export function spawnPoint(index: number): Vec2 {
  // anel de raio 6 com defasagem de 18°: livre de árvores, pedras, lago e estações (verificado em lobbyLayout.test.ts)
  const a = (index % 10) * ((Math.PI * 2) / 10) + (18 * Math.PI) / 180;
  return { x: Math.sin(a) * 6, z: Math.cos(a) * 6 };
}

/**
 * Valida um movimento enviado pelo cliente: limita a distância percorrida
 * pela velocidade máxima e mantém o jogador dentro do mundo. Retorna null se o dado for inválido.
 */
export function stepMove(prev: Vec2, next: unknown, dtMs: number): Vec2 | null {
  if (typeof next !== "object" || next === null) return null;
  const { x, z } = next as Partial<Vec2>;
  if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return null;

  const dt = Math.min(Math.max(dtMs, 50), 1000) / 1000;
  const maxDist = MAX_SPEED * dt + 0.1;
  let dx = x - prev.x;
  let dz = z - prev.z;
  const dist = Math.hypot(dx, dz);
  if (dist > maxDist) {
    dx = (dx / dist) * maxDist;
    dz = (dz / dist) * maxDist;
  }
  let nx = prev.x + dx;
  let nz = prev.z + dz;
  const r = Math.hypot(nx, nz);
  if (r > WORLD_RADIUS) {
    nx = (nx / r) * WORLD_RADIUS;
    nz = (nz / r) * WORLD_RADIUS;
  }
  return { x: nx, z: nz };
}

export function sanitizeAngle(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value % (Math.PI * 2) : 0;
}

/**
 * Valida uma esquiva (teleporte curto): respeita o tempo de recarga e a distância máxima,
 * e mantém o jogador dentro do mundo. Retorna null se for inválida.
 */
export function validateDodge(prev: Vec2, next: unknown, now: number, lastDodgeAt: number): Vec2 | null {
  if (now - lastDodgeAt < DODGE_COOLDOWN_MS * 0.7) return null;
  if (typeof next !== "object" || next === null) return null;
  const { x, z } = next as Partial<Vec2>;
  if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.hypot(x - prev.x, z - prev.z) > DODGE_MAX_DISTANCE) return null;
  const r = Math.hypot(x, z);
  if (r > WORLD_RADIUS) return { x: (x / r) * WORLD_RADIUS, z: (z / r) * WORLD_RADIUS };
  return { x, z };
}

/** Altura do pulo enviada pelo cliente: limitada a [0, MAX_JUMP_Y]; valores inválidos viram 0. */
export function sanitizeHeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_JUMP_Y, Math.max(0, value));
}
