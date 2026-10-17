import { Client, Room } from "colyseus.js";
import { normalizeRoomCode, type JoinOptions } from "@jogo/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
const TOKEN_KEY = "jogo:reconnect";
const client = new Client(SERVER_URL);

export type Session = Room;

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/not found|invalid roomid|no rooms found/i.test(msg)) return "Sala não encontrada. Confira o código e tente de novo.";
  if (/locked|maxclients|full/i.test(msg)) return "A sala está cheia (máximo de 10 jogadores).";
  if (/failed to connect|fetch|network|ECONNREFUSED/i.test(msg) || msg === "") {
    return "Não foi possível conectar ao servidor. Se ele estava inativo, aguarde ~1 minuto e tente novamente.";
  }
  return msg;
}

function remember(room: Room) {
  try {
    sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
  } catch { /* storage indisponível */ }
}

export async function createRoom(opts: JoinOptions): Promise<Room> {
  try {
    const room = await client.create("game", opts);
    remember(room);
    return room;
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function joinRoom(code: string, opts: JoinOptions): Promise<Room> {
  const id = normalizeRoomCode(code);
  if (!id) throw new Error("Digite o código da sala.");
  try {
    const room = await client.joinById(id, opts);
    remember(room);
    return room;
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function tryReconnect(): Promise<Room | null> {
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch { /* ignore */ }
  if (!token) return null;
  try {
    const room = await client.reconnect(token);
    remember(room);
    return room;
  } catch {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    return null;
  }
}

export function forgetSession() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
