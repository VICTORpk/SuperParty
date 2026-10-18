/** Regras puras do tabuleiro (usadas pelo servidor autoritativo e testadas isoladamente). */

/** Tamanhos que os jogadores podem escolher (número de casas, contando início e chegada). */
export const BOARD_SIZES = [40, 70, 100, 150] as const;
export const DEFAULT_BOARD_SIZE = 40;
export function isBoardSize(v: unknown): v is number {
  return typeof v === "number" && (BOARD_SIZES as readonly number[]).includes(v);
}
/** Quem cai numa casa vermelha volta esta quantidade de casas. */
export const RED_TILE_BACK = 2;

export interface Shortcut { from: number; to: number }

/** Distribuição das casas especiais; sai igual no servidor e nos clientes a partir de (tamanho, semente). */
export interface BoardLayout {
  length: number;
  finalTile: number;
  challengeTiles: number[];
  redTiles: number[];
  /** Cair na casa `from` leva direto para `to` (sempre adiante; o último chega perto da linha de chegada). */
  shortcuts: Shortcut[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBoardLayout(length: number, seed: number): BoardLayout {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1)); // inclusivo
  const finalTile = length - 1;
  const used = new Set<number>([0, finalTile]);
  const near = (t: number, gap: number) => { for (let d = -gap; d <= gap; d++) if (used.has(t + d)) return true; return false; };

  // atalhos: um por trecho do percurso e o último salta quase até a chegada
  const shortcuts: Shortcut[] = [];
  const count = Math.max(2, Math.round(length / 22));
  const lastFrom = Math.round(finalTile * (0.55 + rnd() * 0.1));
  const zoneLen = (lastFrom - 8) / Math.max(1, count - 1);
  for (let k = 0; k < count - 1; k++) {
    const lo = Math.round(5 + k * zoneLen), hi = Math.round(5 + k * zoneLen + zoneLen * 0.55);
    const from = int(lo, Math.max(lo, hi));
    const jump = int(Math.max(5, Math.round(length * 0.07)), Math.max(7, Math.round(length * 0.16)));
    const to = Math.min(from + jump, lastFrom - 4);
    if (to - from < 4 || near(from, 2) || near(to, 2)) continue;
    shortcuts.push({ from, to }); used.add(from); used.add(to);
  }
  const lastTo = finalTile - 3;
  if (!near(lastFrom, 2) && lastTo - lastFrom >= 5) { shortcuts.push({ from: lastFrom, to: lastTo }); used.add(lastFrom); used.add(lastTo); }
  shortcuts.sort((a, b) => a.from - b.from);

  // casas vermelhas: afastadas entre si e dos atalhos (a casa 2 atrás nunca é outra casa especial)
  const reds: number[] = [];
  const wantRed = Math.round(length * 0.12);
  for (let tries = 0; reds.length < wantRed && tries < wantRed * 60; tries++) {
    const t = int(4, finalTile - 2);
    if (near(t, 2) || near(t - RED_TILE_BACK, 0)) continue;
    reds.push(t); used.add(t);
  }
  reds.sort((a, b) => a - b);

  // desafios: espalhados de forma regular, com um pequeno sorteio de posição
  const challenges: number[] = [];
  const wantCh = Math.round(length / 4);
  for (let k = 1; k <= wantCh; k++) {
    const base = Math.round((k * finalTile) / (wantCh + 1));
    for (let d = 0; d < 6; d++) {
      const cand = base + (d === 0 ? int(-1, 1) : d % 2 ? (d + 1) >> 1 : -(d >> 1));
      if (cand < 3 || cand >= finalTile - 1 || used.has(cand)) continue;
      challenges.push(cand); used.add(cand); break;
    }
  }
  challenges.sort((a, b) => a - b);
  return { length, finalTile, challengeTiles: challenges, redTiles: reds, shortcuts };
}

export function isChallengeTile(layout: BoardLayout, index: number): boolean {
  return layout.challengeTiles.includes(index);
}
export function isRedTile(layout: BoardLayout, index: number): boolean {
  return layout.redTiles.includes(index);
}
export function shortcutFrom(layout: BoardLayout, index: number): Shortcut | undefined {
  return layout.shortcuts.find((s) => s.from === index);
}

export function clampTile(index: number, finalTile: number): number {
  return Math.min(finalTile, Math.max(0, index));
}

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
  shortcutPauseMs: 500, // pausa antes de seguir pelo atalho ou de voltar da casa vermelha
  shortcutFlightMs: 1_300, // duração do salto pelo atalho (um arco único, não casa a casa)
} as const;

export const CHALLENGE_CONFIG = {
  power: { durationMs: 7_000, periodMs: 1_500, zoneWidth: 0.2, tolerance: 0.05, prepMs: 1_500 },
  colors: { length: 4, showMsPerColor: 700, inputMs: 9_000, prepMs: 1_500 },
  clicks: { durationMs: 5_000, target: 20, maxPerSecond: 14, prepMs: 1_500 },
} as const;

export const CHALLENGE_KINDS = ["power", "colors", "clicks"] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];
export const PAD_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308"] as const;

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
  /** Tamanho do tabuleiro e semente: o cliente refaz o `BoardLayout` com `makeBoardLayout(size, seed)`. */
  size: number;
  seed: number;
  serverNow: number;
}

export type BoardEvent =
  | { kind: "roll"; playerId: string; value: number; from: number; to: number }
  | { kind: "move"; playerId: string; from: number; to: number; reason: "challenge-success" | "challenge-fail" | "arena-win" | "arena-loss" | "shortcut" | "red-tile" }
  | { kind: "encounter"; mover: string; other: string; tile: number }
  | { kind: "arena-result"; winner: string; loser: string; reason: string }
  | { kind: "challenge-result"; playerId: string; challenge: ChallengeKind; success: boolean; detail?: string }
  | { kind: "finish"; winner: string };

export interface ChallengeInput {
  action: "stop" | "pick" | "click";
  color?: number;
}
