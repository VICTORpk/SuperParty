import { AVATAR_COLORS, MAX_CHAT_LENGTH, MAX_NICK_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants";

// Remove caracteres de controle e de formatação invisíveis.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

export function sanitizeNick(value: unknown): string {
  return Array.from(clean(value)).slice(0, MAX_NICK_LENGTH).join("").trim();
}

/** Retorna string vazia quando a mensagem não é válida. O texto nunca é interpretado como HTML. */
export function sanitizeChat(value: unknown): string {
  return Array.from(clean(value)).slice(0, MAX_CHAT_LENGTH).join("");
}

export function sanitizeColor(value: unknown): string {
  return (AVATAR_COLORS as readonly string[]).includes(value as string) ? (value as string) : AVATAR_COLORS[0];
}

export function normalizeRoomCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  return Array.from(value).every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}
