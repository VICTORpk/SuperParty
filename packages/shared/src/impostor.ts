import type { PoolBallState } from "./pool";

/**
 * Sinuca Impostor: regras puras (sorteio da garrafa, acertos, eliminação e vitória).
 * O servidor é a única fonte da verdade; o papel secreto nunca vai no estado público antes do fim.
 */

export const IMPOSTOR_RULES = {
  hitsToEliminate: 3,
  turnMs: 20_000, // tempo para tacar (estourou, a vez passa)
  awayTurnMs: 3_000,
  bottleMs: 3_800, // duração da roleta
  decisionMs: 10_000, // tempo do autor para atacar ou poupar (estourou = poupar)
  resultMs: 2_600, // pausa para mostrar o resultado antes da próxima vez
  settleMs: 900,
  minActiveForImpostorWin: 2, // o Impostor vence quando restam só 2 jogadores ativos
} as const;

export type ImpostorRole = "impostor" | "innocent";
export type ImpostorSide = "innocents" | "impostor";

export interface ImpostorPlayer {
  id: string;
  hits: number;
  alive: boolean;
  /** Preenchido só na eliminação (ou no fim da partida, para todos). */
  revealed: ImpostorRole | null;
}

export type ImpostorPhase = "aim" | "shooting" | "bottle" | "decision" | "result" | "finished";

export interface BottleSpin {
  target: string;
  startAt: number;
  durationMs: number;
}

export interface LastHit {
  key: number;
  attacker: string;
  target: string;
  attacked: boolean;
  eliminated: boolean;
}

export interface ImpostorPublicState {
  phase: ImpostorPhase;
  players: ImpostorPlayer[];
  /** Jogador da vez (quem taca / decide). */
  turn: string;
  balls: PoolBallState[];
  ballInHand: false;
  turnEndsAt: number | null;
  message: string;
  winner: ImpostorSide | null;
  /** Identidade do Impostor: só aparece quando a partida termina. */
  impostor: string | null;
  bottle: BottleSpin | null;
  decisionTarget: string | null;
  lastHit: LastHit | null;
  shotId: number;
  serverNow: number;
}

/** Próximo jogador ativo no rodízio, depois de `current` (que pode já ter saído/sido eliminado). */
export function nextShooter(order: readonly string[], alive: ReadonlySet<string>, current: string | null): string | null {
  if (alive.size === 0) return null;
  const start = current ? order.indexOf(current) : -1;
  for (let i = 1; i <= order.length; i++) {
    const id = order[(start + i + order.length) % order.length]!;
    if (alive.has(id)) return id;
  }
  return null;
}

/** A garrafa sorteia entre os ativos, excluindo o autor da tacada. `rng(n)` devolve um inteiro em [0, n). */
export function pickBottleTarget(alive: readonly string[], shooter: string, rng: (n: number) => number): string | null {
  const pool = alive.filter((id) => id !== shooter);
  return pool.length ? pool[rng(pool.length)]! : null;
}

/** Tacada válida: encaçapou ao menos uma bola que não é a branca, a branca tocou em alguma bola e não caiu. */
export function isValidShot(firstContact: number | null, pocketed: readonly number[]): boolean {
  return firstContact !== null && !pocketed.includes(0) && pocketed.some((id) => id !== 0);
}

export interface HitOutcome {
  hits: number;
  eliminated: boolean;
}

export function applyHit(hits: number): HitOutcome {
  const next = hits + 1;
  return { hits: next, eliminated: next >= IMPOSTOR_RULES.hitsToEliminate };
}

/** Vitória: inocentes se o Impostor foi eliminado; Impostor se restam 2 ativos (e ele é um deles). */
export function checkWinner(players: readonly ImpostorPlayer[], impostor: string): ImpostorSide | null {
  const imp = players.find((p) => p.id === impostor);
  if (!imp || !imp.alive) return "innocents";
  const active = players.filter((p) => p.alive).length;
  if (active <= IMPOSTOR_RULES.minActiveForImpostorWin) return "impostor";
  return null;
}
