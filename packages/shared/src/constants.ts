export const MAX_PLAYERS = 10;
export const MAX_NICK_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;
export const CHAT_MIN_INTERVAL_MS = 1000;
export const CHAT_HISTORY_SIZE = 50;
export const RECONNECT_WINDOW_S = 60;
export const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
export const ROOM_CODE_LENGTH = 5;
/** Sem 0/O/1/I/L para evitar confusão ao ditar o código. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const AVATAR_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#78716c", "#06b6d4",
] as const;

// ---- Lobby 3D ----
export const WORLD_RADIUS = 18;
export const PLAYER_SPEED = 5; // unidades/s (cliente, andando)
export const RUN_SPEED = 9; // unidades/s (cliente, correndo)
export const MAX_SPEED = 10.5; // unidades/s aceitas pelo servidor (corrida + tolerância)
export const DODGE_DISTANCE = 4.5; // distância da esquiva (teleporte curto)
export const DODGE_MAX_DISTANCE = DODGE_DISTANCE + 2; // tolerância do servidor (latência)
export const DODGE_COOLDOWN_MS = 900;
export const EMOTE_COOLDOWN_MS = 400;
export const MOVE_SEND_INTERVAL_MS = 100; // ~10 Hz
export const POSITIONS_BROADCAST_MS = 100;
export const CHAT_BUBBLE_MS = 5000;

// ---- Pulo (visual; o servidor só limita a altura) ----
export const JUMP_VELOCITY = 7.5;
export const GRAVITY = 22;
export const MAX_JUMP_Y = 2.2;

export const LOBBY_ATTACK_COOLDOWN_MS = 350;
