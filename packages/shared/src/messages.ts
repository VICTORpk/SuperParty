import type { GameId } from "./games";

export type RoomPhase = "lobby" | "in-game";

export interface PlayerInfo {
  id: string;
  nick: string;
  color: string;
  isHost: boolean;
  /** true enquanto o jogador está dentro da janela de reconexão. */
  away: boolean;
  /** true enquanto participa de uma partida (some do lobby). */
  inGame?: boolean;
}

export interface ChatMessage {
  /** "dead": canal dos eliminados da sinuca Impostor (só eles recebem). */
  channel?: "dead";
  id: number;
  authorId: string;
  nick: string;
  text: string;
  at: number;
}

export interface JoinOptions {
  nick: string;
  color: string;
}

export interface WelcomePayload {
  you: string;
  code: string;
  phase: RoomPhase;
  players: PlayerInfo[];
  history: ChatMessage[];
}

/** Servidor → cliente */
export const S = {
  Welcome: "welcome",
  Players: "players",
  Chat: "chat",
  Notice: "notice",
  Positions: "positions",
  Emote: "emote",
  Dodge: "dodge",
  Phase: "phase",
  Board: "board",
  BoardEvent: "board-event",
  Queue: "queue",
  Attack: "attack",
  Arena: "arena",
  ArenaEvent: "arena-event",
  Pool: "pool",
  PoolShot: "pool-shot",
  Impostor: "impostor",
  Role: "role",
} as const;

/** Cliente → servidor */
export const C = {
  Chat: "chat",
  Move: "move",
  Hello: "hello",
  Emote: "emote",
  Dodge: "dodge",
  JoinQueue: "join-queue",
  LeaveQueue: "leave-queue",
  EndGame: "end-game",
  Attack: "attack",
  ArenaInput: "arena-input",
  ArenaAction: "arena-action",
  PoolShoot: "pool-shoot",
  PoolPlace: "pool-place",
  ImpostorDecide: "impostor-decide",
  Roll: "roll",
  Challenge: "challenge",
} as const;

/** Enviado a cada jogador: "in-game" só para quem participa da partida em andamento. */
export interface PhasePayload {
  phase: RoomPhase;
  game: GameId | null;
}

export interface QueueGameState {
  members: string[];
  startsAt: number | null;
}

export interface QueueState {
  games: Record<GameId, QueueGameState>;
  /** Jogo em andamento na sala (as outras estações ficam ocupadas). */
  busy: GameId | null;
  serverNow: number;
}

export interface AttackPayload {
  id: string;
  kind: string;
}

export interface EmotePayload {
  id: string;
  emote: string;
}

export interface DodgePayload {
  id: string;
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  ry: number;
}
