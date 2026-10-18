import type { Vec2 } from "./movement";

/**
 * Comportamento simples e puro dos bots de teste: aproximar-se do jogador mais próximo, acenar quando chega
 * perto e passear quando não há ninguém. Serve ao servidor (bots do lobby) e ao editor (pré-visualização do mapa);
 * quem chama informa a função de colisão do seu mundo.
 */

export const BOT_CONFIG = {
  speed: 3.4, // u/s (abaixo da velocidade de andar do jogador)
  stopDistance: 2.4,
  waveDistance: 4,
  waveEveryMs: 7000,
  wanderRadius: 7,
  maxBots: 6,
} as const;

export interface BotState {
  x: number;
  z: number;
  /** Direção do corpo na convenção do jogo (`atan2(-dx, -dz)`), pronta para `rotation.y`. */
  ry: number;
  /** Alvo de passeio atual (quando não há jogador para seguir). */
  wx: number | null;
  wz: number | null;
  nextWaveAt: number;
  /** Desvio temporário quando um obstáculo bloqueia o caminho até o jogador. */
  detour: { x: number; z: number; until: number } | null;
  /** Controle de progresso: menor distância já atingida até o jogador e quando conferir de novo. */
  bestDist: number;
  checkAt: number;
  /** Velocidade atual (para animar o personagem). */
  speed: number;
}

export function newBot(x: number, z: number): BotState {
  return { x, z, ry: 0, wx: null, wz: null, nextWaveAt: 0, detour: null, bestDist: Infinity, checkAt: 0, speed: 0 };
}

export type Resolve = (x: number, z: number) => Vec2;

export interface BotStepResult { wave: boolean }

/** `rng()` devolve um número em [0, 1). */
export function stepBot(bot: BotState, target: Vec2 | null, dtMs: number, nowMs: number, rng: () => number, resolve: Resolve): BotStepResult {
  const dt = Math.min(dtMs, 250) / 1000;
  let goal: Vec2 | null = null;
  let wave = false;

  if (target) {
    const d = Math.hypot(target.x - bot.x, target.z - bot.z);
    bot.wx = bot.wz = null;
    if (bot.detour && (nowMs > bot.detour.until || Math.hypot(bot.detour.x - bot.x, bot.detour.z - bot.z) < 0.8)) bot.detour = null;
    if (nowMs >= bot.checkAt) {
      // sem progresso há 1,5 s (obstáculo côncavo): faz um desvio lateral
      if (!bot.detour && bot.bestDist - d < 0.6 && d > BOT_CONFIG.stopDistance) {
        const side = rng() < 0.5 ? 1 : -1;
        const a = Math.atan2(target.x - bot.x, target.z - bot.z);
        bot.detour = { x: bot.x + Math.cos(a) * side * 6, z: bot.z - Math.sin(a) * side * 6, until: nowMs + 2500 };
      }
      bot.bestDist = d;
      bot.checkAt = nowMs + 1500;
    }
    if (d > BOT_CONFIG.stopDistance) goal = bot.detour ?? target;
    else bot.ry = Math.atan2(bot.x - target.x, bot.z - target.z);
    if (d <= BOT_CONFIG.waveDistance && nowMs >= bot.nextWaveAt) {
      bot.nextWaveAt = nowMs + BOT_CONFIG.waveEveryMs;
      wave = true;
    }
  } else {
    if (bot.wx === null || bot.wz === null || Math.hypot(bot.wx - bot.x, bot.wz - bot.z) < 0.6) {
      const a = rng() * Math.PI * 2, r = 2 + rng() * BOT_CONFIG.wanderRadius;
      bot.wx = bot.x + Math.cos(a) * r;
      bot.wz = bot.z + Math.sin(a) * r;
    }
    goal = { x: bot.wx, z: bot.wz };
  }

  if (!goal) { bot.speed = 0; return { wave }; }

  const step = BOT_CONFIG.speed * dt;
  const base = Math.atan2(goal.x - bot.x, goal.z - bot.z);
  // tenta ir direto; se um obstáculo trava, contorna girando a direção
  let best: Vec2 = { x: bot.x, z: bot.z }, bestMoved = -1, bestAngle = base;
  for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
    const a = base + off;
    const p = resolve(bot.x + Math.sin(a) * step, bot.z + Math.cos(a) * step);
    const moved = Math.hypot(p.x - bot.x, p.z - bot.z) * Math.cos(off);
    if (moved > bestMoved + 1e-6) { best = p; bestMoved = moved; bestAngle = a; }
    if (off === 0 && moved > step * 0.8) break;
  }
  if (bestMoved < step * 0.35) {
    // preso: sem jogador escolhe outro ponto de passeio; com jogador faz um desvio lateral por um tempo
    if (target) {
      const side = rng() < 0.5 ? 1 : -1;
      bot.detour = { x: bot.x + Math.cos(base) * side * 6, z: bot.z - Math.sin(base) * side * 6, until: nowMs + 2500 };
    } else bot.wx = bot.wz = null;
    bot.speed = 0;
    return { wave };
  }
  bot.speed = Math.hypot(best.x - bot.x, best.z - bot.z) / Math.max(dt, 1e-3);
  bot.x = best.x;
  bot.z = best.z;
  bot.ry = bestAngle + Math.PI; // convenção do jogo: o personagem olha para -z com ry = 0
  return { wave };
}

/** Jogador mais próximo de (x, z) entre os alvos, ou null. */
export function nearestTarget(x: number, z: number, targets: readonly Vec2[]): Vec2 | null {
  let best: Vec2 | null = null, bd = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
