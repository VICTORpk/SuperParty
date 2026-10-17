/** Regras puras do tabuleiro (usadas pelo servidor autoritativo e testadas isoladamente). */

export const BOARD_LENGTH = 40; // casas 0..39 (0 = início, 39 = final)
export const FINAL_TILE = BOARD_LENGTH - 1;
export const CHALLENGE_TILES: readonly number[] = [3, 7, 10, 14, 18, 21, 25, 29, 33, 36];

/** Valores configuráveis (o PRD pede que a penalidade de falha seja ajustável até a decisão final). */
export const BOARD_RULES = {
  diceSides: 6,
  successBonus: 2, // sucesso no desafio: permanece na casa e avança mais 2
  failAdvance: 1, // falha: avança apenas 1 casa
  encounterLoserBack: 1, // perdedor da arena volta 1 casa
  encounterWinnerAdvance: 2, // vencedor da arena avança 2 casas
  diceMs: 1_700, // o dado gira e mostra o número antes de as peças andarem
  encounterIntroMs: 2_500,
  minPlayers: 2,
  rollTimeoutMs: 20_000,
  awayActionDelayMs: 2_500, // jogador ausente joga sozinho após este tempo
  hopMs: 320, // tempo de animação por casa
  resultDelayMs: 2_200,
  returnToLobbyMs: 30_000,
} as const;

export const CHALLENGE_CONFIG = {
  power: { durationMs: 7_000, periodMs: 1_500, zoneWidth: 0.2, tolerance: 0.05, prepMs: 1_500 },
  colors: { length: 4, showMsPerColor: 700, inputMs: 9_000, prepMs: 1_500 },
  clicks: { durationMs: 5_000, target: 20, maxPerSecond: 14, prepMs: 1_500 },
} as const;

export const CHALLENGE_KINDS = ["power", "colors", "clicks"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const PAD_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308"] as const;

export function isChallengeTile(index: number): boolean {
  return CHALLENGE_TILES.includes(index);
}

export function clampTile(index: number): number {
  return Math.min(FINAL_TILE, Math.max(0, index));
}

/** Casas percorridas ao se mover de `from` para `to` (excluindo a casa de origem). */
export function tilePath(from: number, to: number): number[] {
  const out: number[] = [];
  const step = to >= from ? 1 : -1;
  for (let i = from + step; step > 0 ? i <= to : i >= to; i += step) out.push(i);
  return out;
}

/** Barra de força: o cursor vai e volta entre 0 e 1 (onda triangular). */
export function cursorAt(elapsedMs: number, periodMs: number = CHALLENGE_CONFIG.power.periodMs): number {
  const phase = ((elapsedMs % periodMs) + periodMs) % periodMs / periodMs;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

export function powerSuccess(elapsedMs: number, target: number): boolean {
  const c = CHALLENGE_CONFIG.power;
  return Math.abs(cursorAt(elapsedMs, c.periodMs) - target) <= c.zoneWidth / 2 + c.tolerance;
}

export function clicksSuccess(count: number): boolean {
  return count >= CHALLENGE_CONFIG.clicks.target;
}

/** Compara a entrada parcial com a sequência: "wrong", "partial" ou "done". */
export function colorsCheck(sequence: readonly number[], input: readonly number[]): "wrong" | "partial" | "done" {
  for (let i = 0; i < input.length; i++) if (input[i] !== sequence[i]) return "wrong";
  return input.length >= sequence.length ? "done" : "partial";
}

/** `rng(n)` devolve um inteiro em [0, n). */
export function pickColors(rng: (n: number) => number, length: number = CHALLENGE_CONFIG.colors.length): number[] {
  return Array.from({ length }, () => rng(PAD_COLORS.length));
}

export function shuffle<T>(items: readonly T[], rng: (n: number) => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------- estado público
export type BoardPhase = "roll" | "rolling" | "moving" | "challenge" | "encounter" | "arena" | "finished";

export type ChallengePublic =
  | { kind: "power"; startAt: number; endsAt: number; periodMs: number; target: number; zoneWidth: number; result: ChallengeResult | null }
  | { kind: "colors"; startAt: number; inputAt: number; endsAt: number; sequence: number[]; progress: number; result: ChallengeResult | null }
  | { kind: "clicks"; startAt: number; endsAt: number; count: number; target: number; result: ChallengeResult | null };

export interface ChallengeResult { success: boolean; detail?: string }

export interface BoardPublicState {
  phase: BoardPhase;
  order: string[];
  positions: Record<string, number>;
  turn: string;
  round: number;
  turnEndsAt: number | null;
  challenge: ChallengePublic | null;
  winner: string | null;
  /** Quando a fase é "encounter" ou "arena": os dois lutadores. */
  duel: [string, string] | null;
  serverNow: number;
}

export type BoardEvent =
  | { kind: "roll"; playerId: string; value: number; from: number; to: number }
  | { kind: "move"; playerId: string; from: number; to: number; reason: "challenge-success" | "challenge-fail" | "arena-win" | "arena-loss" }
  | { kind: "encounter"; mover: string; other: string; tile: number }
  | { kind: "arena-result"; winner: string; loser: string; reason: string }
  | { kind: "challenge-result"; playerId: string; challenge: ChallengeKind; success: boolean; detail?: string }
  | { kind: "finish"; winner: string };

export interface ChallengeInput {
  action: "stop" | "pick" | "click";
  color?: number;
}
