import { Client, Room } from "colyseus.js";
import { normalizeRoomCode, type JoinOptions } from "@jogo/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
const TOKEN_KEY = "jogo:reconnect";
const client = new Client(SERVER_URL);
const HTTP_URL = SERVER_URL.replace(/^ws/, "http");

/**
 * Acorda o servidor antes de conectar. No plano gratuito do Render ele hiberna e o primeiro acesso demora
 * cerca de 1 minuto; `onSlow` é chamado se a resposta não vier em ~2,5 s, para a tela avisar o jogador.
 */
export async function wakeServer(onSlow: () => void, maxMs = 100_000): Promise<void> {
  const start = Date.now();
  let notified = false;
  for (;;) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${HTTP_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return;
    } catch { /* ainda acordando */ }
    if (!notified && Date.now() - start > 2500) { notified = true; onSlow(); }
    if (Date.now() - start > maxMs) throw new Error("O servidor não respondeu. Tente novamente em instantes.");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

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
