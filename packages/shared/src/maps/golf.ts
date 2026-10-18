/**
 * Física mínima de minigolfe para a pré-visualização dos mapas: bola 2D com atrito, rampas que puxam a bola,
 * paredes (caixas giradas), pinos e buraco. Pura e determinística; quem usa informa o "mundo" do mapa.
 */

export const GOLF = {
  radius: 0.2,
  decel: 1.3, // desaceleração constante (u/s²)
  drag: 0.25, // arrasto proporcional (1/s)
  slope: 14, // aceleração por unidade de inclinação (u/s²)
  restitution: 0.78,
  bumperBoost: 1.12,
  maxSpeed: 15,
  holeRadius: 0.5,
  holeMaxSpeed: 7,
  stopSpeed: 0.18,
  maxStep: 0.08, // deslocamento máximo por sub-passo (evita atravessar paredes)
} as const;

export interface GolfWall { x: number; z: number; halfLen: number; halfThick: number; /** giro em radianos (eixo y) */ angle: number }
export interface GolfBumper { x: number; z: number; r: number }
export interface GolfWorld {
  /** Altura do piso em (x, z) ou null fora do mapa. */
  surface(x: number, z: number): number | null;
  walls: readonly GolfWall[];
  bumpers: readonly GolfBumper[];
  hole: { x: number; z: number } | null;
}

export interface GolfBall { x: number; z: number; vx: number; vz: number }
export type GolfEvent = "none" | "out" | "sunk";

export const ballSpeed = (b: GolfBall) => Math.hypot(b.vx, b.vz);

/** Tacada: `power` em [0,1] e `angle` em radianos (0 = +z, π/2 = +x). */
export function strike(ball: GolfBall, angle: number, power: number): GolfBall {
  const v = Math.min(1, Math.max(0, power)) * GOLF.maxSpeed;
  return { ...ball, vx: Math.sin(angle) * v, vz: Math.cos(angle) * v };
}

function collideWall(b: GolfBall, w: GolfWall): boolean {
  const c = Math.cos(w.angle), s = Math.sin(w.angle);
  const dx = b.x - w.x, dz = b.z - w.z;
  // coordenadas locais da parede (eixo l = ao longo do comprimento, t = espessura)
  const l = dx * c - dz * s, t = dx * s + dz * c;
  const cl = Math.max(-w.halfLen, Math.min(w.halfLen, l)), ct = Math.max(-w.halfThick, Math.min(w.halfThick, t));
  let nl = l - cl, nt = t - ct;
  let d = Math.hypot(nl, nt);
  if (d >= GOLF.radius) return false;
  if (d < 1e-6) { // centro dentro da caixa: empurra pelo lado mais próximo
    if (w.halfThick - Math.abs(t) < w.halfLen - Math.abs(l)) { nl = 0; nt = Math.sign(t) || 1; } else { nl = Math.sign(l) || 1; nt = 0; }
    d = 0;
  } else { nl /= d; nt /= d; }
  // normal de volta para o mundo
  const nx = nl * c + nt * s, nz = -nl * s + nt * c;
  const push = GOLF.radius - d;
  b.x += nx * push; b.z += nz * push;
  const vn = b.vx * nx + b.vz * nz;
  if (vn < 0) { b.vx -= (1 + GOLF.restitution) * vn * nx; b.vz -= (1 + GOLF.restitution) * vn * nz; }
  return true;
}

/** Avança a bola `dt` segundos. Devolve "out" se saiu do mapa (a bola não é movida para fora) ou "sunk" se caiu no buraco. */
export function stepBall(ball: GolfBall, dt: number, world: GolfWorld): GolfEvent {
  let speed = ballSpeed(ball);
  const steps = Math.max(1, Math.ceil((speed * dt) / GOLF.maxStep));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const here = world.surface(ball.x, ball.z);
    if (here === null) return "out";
    // inclinação: a bola é puxada ladeira abaixo
    const e = 0.25;
    const hx1 = world.surface(ball.x + e, ball.z), hx0 = world.surface(ball.x - e, ball.z);
    const hz1 = world.surface(ball.x, ball.z + e), hz0 = world.surface(ball.x, ball.z - e);
    if (hx1 !== null && hx0 !== null) ball.vx -= GOLF.slope * ((hx1 - hx0) / (2 * e)) * h;
    if (hz1 !== null && hz0 !== null) ball.vz -= GOLF.slope * ((hz1 - hz0) / (2 * e)) * h;
    // atrito
    speed = ballSpeed(ball);
    if (speed > 0) {
      const k = Math.max(0, speed - (GOLF.decel + GOLF.drag * speed) * h) / speed;
      ball.vx *= k; ball.vz *= k;
    }
    const nxt = { x: ball.x + ball.vx * h, z: ball.z + ball.vz * h };
    if (world.surface(nxt.x, nxt.z) === null) return "out";
    ball.x = nxt.x; ball.z = nxt.z;
    for (const w of world.walls) collideWall(ball, w);
    for (const p of world.bumpers) {
      const dx = ball.x - p.x, dz = ball.z - p.z, d = Math.hypot(dx, dz), min = p.r + GOLF.radius;
      if (d < min && d > 1e-6) {
        const nx = dx / d, nz = dz / d;
        ball.x = p.x + nx * min; ball.z = p.z + nz * min;
        const vn = ball.vx * nx + ball.vz * nz;
        if (vn < 0) { ball.vx -= (1 + GOLF.restitution * GOLF.bumperBoost) * vn * nx; ball.vz -= (1 + GOLF.restitution * GOLF.bumperBoost) * vn * nz; }
      }
    }
    const cap = GOLF.maxSpeed * 1.3;
    const sp = ballSpeed(ball);
    if (sp > cap) { ball.vx *= cap / sp; ball.vz *= cap / sp; }
    if (world.hole && Math.hypot(ball.x - world.hole.x, ball.z - world.hole.z) < GOLF.holeRadius && ballSpeed(ball) < GOLF.holeMaxSpeed) {
      ball.x = world.hole.x; ball.z = world.hole.z; ball.vx = ball.vz = 0;
      return "sunk";
    }
  }
  if (ballSpeed(ball) < GOLF.stopSpeed) { ball.vx = 0; ball.vz = 0; }
  return "none";
}

export const isResting = (b: GolfBall) => b.vx === 0 && b.vz === 0;
