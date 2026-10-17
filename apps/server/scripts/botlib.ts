import { Room } from "colyseus.js";
import {
  C, GAMES, S, cursorAt,
  type ArenaSnapshot, type BoardEvent, type BoardPublicState, type PhasePayload, type PlayerPos, type PoolPublicState, type QueueState, type ImpostorPublicState, type ChatMessage, findFreeSpot, POOL, POCKETS,
} from "@jogo/shared";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Bot {
  room: Room;
  nick: string;
  pos?: { x: number; z: number };
  state?: BoardPublicState;
  arena?: ArenaSnapshot;
  pool?: PoolPublicState;
  imp?: ImpostorPublicState;
  role?: string;
  chat: ChatMessage[];
  phase?: PhasePayload;
  queue?: QueueState;
  events: BoardEvent[];
  notices: string[];
  attacks: { id: string; kind: string }[];
  offset: number;
  skill: number;
  stop: boolean;
}

export function attach(room: Room, nick: string, skill = 1): Bot {
  const bot: Bot = { room, nick, events: [], notices: [], attacks: [], chat: [], offset: 0, skill, stop: false };
  for (const t of [S.Welcome, S.Players, S.Emote, S.Dodge]) room.onMessage(t, () => {});
  room.onMessage(S.Chat, (m: ChatMessage) => bot.chat.push(m));
  room.onMessage(S.Impostor, (st: ImpostorPublicState) => (bot.imp = st));
  room.onMessage(S.Role, (r: { role: string }) => (bot.role = r.role));
  room.onMessage(S.Positions, (list: PlayerPos[]) => { const me = list.find((p) => p.id === room.sessionId); if (me) bot.pos = { x: me.x, z: me.z }; });
  room.onMessage(S.Notice, (t: string) => bot.notices.push(t));
  room.onMessage(S.Phase, (p: PhasePayload) => { bot.phase = p; if (p.phase === "lobby") { bot.state = undefined; bot.arena = undefined; bot.pool = undefined; bot.imp = undefined; bot.role = undefined; } });
  room.onMessage(S.Queue, (q: QueueState) => (bot.queue = q));
  room.onMessage(S.Attack, (a: { id: string; kind: string }) => bot.attacks.push(a));
  room.onMessage(S.BoardEvent, (e: BoardEvent) => bot.events.push(e));
  room.onMessage(S.ArenaEvent, () => {});
  room.onMessage(S.Arena, (a: ArenaSnapshot) => (bot.arena = a));
  room.onMessage(S.Pool, (p: PoolPublicState) => (bot.pool = p));
  room.onMessage(S.PoolShot, () => {});
  room.onMessage(S.Board, (s: BoardPublicState) => { bot.state = s; bot.offset = s.serverNow - Date.now(); });
  room.send(C.Hello);
  return bot;
}

/** Caminha até um ponto enviando passos de movimento dentro do limite de velocidade. */
export async function walkTo(bot: Bot, x: number, z: number) {
  for (let i = 0; i < 200 && bot.pos; i++) {
    const dx = x - bot.pos.x, dz = z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return;
    const step = Math.min(d, 0.5);
    const nx = bot.pos.x + (dx / d) * step, nz = bot.pos.z + (dz / d) * step;
    bot.room.send(C.Move, { x: nx, z: nz, y: 0, ry: 0 });
    bot.pos = { x: nx, z: nz };
    await sleep(100);
  }
}

export async function goToStationAndQueue(bot: Bot, game: keyof typeof GAMES = "board") {
  const st = GAMES[game].station;
  await sleep(300);
  await walkTo(bot, st.x + 1.5, st.z + 1.5);
  await sleep(200);
  bot.room.send(C.JoinQueue, { game });
}

/** Joga automaticamente: rola o dado, resolve desafios (com a habilidade dada) e luta na arena. */
export async function autoPlay(bot: Bot, until: () => boolean) {
  const handled = new Set<string>();
  let lastAct = 0;
  while (!until() && !bot.stop) {
    await sleep(80);
    const me = bot.room.sessionId;
    const ar = bot.arena;
    if (ar && ar.phase !== "ended" && bot.state?.phase === "arena") {
      const mine = ar.fighters.find((f) => f.id === me), opp = ar.fighters.find((f) => f.id !== me);
      if (mine && opp && ar.phase === "fight") {
        const dx = opp.x - mine.x, dz = opp.z - mine.z, d = Math.hypot(dx, dz) || 1;
        bot.room.send(C.ArenaInput, { mx: d > 1.6 ? dx / d : 0, mz: d > 1.6 ? dz / d : 0, run: d > 4, jump: false });
        if (d < 2.1 && Date.now() - lastAct > 450) {
          lastAct = Date.now();
          bot.room.send(C.ArenaAction, { kind: (["punch", "kick", "shove"] as const)[Math.floor(Math.random() * 3)] });
        }
      }
      continue;
    }
    const st = bot.state;
    if (!st || st.turn !== me) continue;
    const now = Date.now() + bot.offset;
    if (st.phase === "roll") {
      const key = `roll-${st.round}-${st.turnEndsAt}`;
      if (!handled.has(key)) { handled.add(key); bot.room.send(C.Roll); }
    } else if (st.phase === "challenge" && st.challenge && !st.challenge.result) {
      const ch = st.challenge;
      const key = `ch-${ch.startAt}`;
      if (handled.has(key)) continue;
      const good = Math.random() < bot.skill;
      if (ch.kind === "power" && now >= ch.startAt) {
        const aim = good ? ch.target : (ch.target + 0.5) % 1;
        if (Math.abs(cursorAt(now - ch.startAt, ch.periodMs) - aim) < 0.04) { handled.add(key); bot.room.send(C.Challenge, { action: "stop" }); }
      } else if (ch.kind === "colors" && now >= ch.inputAt) {
        handled.add(key);
        for (const [i, c] of ch.sequence.entries()) { bot.room.send(C.Challenge, { action: "pick", color: !good && i === 2 ? (c + 1) % 4 : c }); await sleep(180); }
      } else if (ch.kind === "clicks" && now >= ch.startAt) {
        handled.add(key);
        const stop = ch.endsAt - bot.offset - 400;
        const gap = good ? 100 : 400;
        while (Date.now() < stop) { bot.room.send(C.Challenge, { action: "click" }); await sleep(gap); }
      }
    }
  }
}

/** Joga sinuca: posiciona a bola branca quando preciso e dá tacadas em bolas da mesa. */
export async function autoPlayPool(bot: Bot, until: () => boolean, thinkMs = 1200) {
  let lastKey = "";
  while (!until() && !bot.stop) {
    await sleep(150);
    const s = bot.pool;
    if (!s || s.turn !== bot.room.sessionId) continue;
    const key = `${s.shotId}-${s.phase}-${s.turnEndsAt}`;
    if (key === lastKey) continue;
    if (s.phase === "placing") {
      lastKey = key;
      await sleep(600);
      const spot = findFreeSpot(s.balls.map((b) => ({ ...b, vx: 0, vz: 0 })), POOL.head, 0);
      bot.room.send(C.PoolPlace, spot);
    } else if (s.phase === "aim" || s.phase === "break") {
      const cue = s.balls.find((b) => b.id === 0);
      const targets = s.balls.filter((b) => !b.out && b.id !== 0);
      if (!cue || cue.out || targets.length === 0) continue;
      lastKey = key;
      await sleep(thinkMs);
      const mine = s.groups[bot.room.sessionId];
      const pref = mine ? targets.filter((b) => (mine === "solid" ? b.id >= 1 && b.id <= 7 : b.id >= 9)) : targets.filter((b) => b.id !== 8);
      const pick = (pref.length ? pref : targets)[Math.floor(Math.random() * (pref.length ? pref.length : targets.length))]!;
      const angle = Math.atan2(pick.z - cue.z, pick.x - cue.x) + (Math.random() - 0.5) * 0.08;
      bot.room.send(C.PoolShoot, { angle, power: s.phase === "break" ? 1 : 0.35 + Math.random() * 0.4 });
    }
  }
}

/** Joga a sinuca Impostor: toca em bolas e, quando a garrafa escolhe, ataca com a probabilidade dada. */
export async function autoPlayImpostor(bot: Bot, until: () => boolean, attackProb = 0.6, thinkMs = 800) {
  let lastKey = "";
  while (!until() && !bot.stop) {
    await sleep(150);
    const s = bot.imp;
    if (!s || s.turn !== bot.room.sessionId) continue;
    const key = `${s.shotId}-${s.phase}-${s.turnEndsAt}-${s.lastHit?.key ?? 0}`;
    if (key === lastKey) continue;
    if (s.phase === "aim") {
      const cue = s.balls.find((b) => b.id === 0);
      const targets = s.balls.filter((b) => !b.out && b.id !== 0);
      if (!cue || cue.out || targets.length === 0) continue;
      lastKey = key;
      await sleep(thinkMs);
      const pick = targets[Math.floor(Math.random() * targets.length)]!;
      const smart = aimToPocket(cue, s.balls);
      bot.room.send(C.PoolShoot, { angle: (smart ?? Math.atan2(pick.z - cue.z, pick.x - cue.x)) + (Math.random() - 0.5) * 0.015, power: 0.5 + Math.random() * 0.25 });
    } else if (s.phase === "decision") {
      lastKey = key;
      await sleep(900);
      bot.room.send(C.ImpostorDecide, { attack: Math.random() < attackProb });
    }
  }
}

/** Mira "bola fantasma": escolhe a bola e a caçapa com o menor caminho e devolve o ângulo da branca. */
export function aimToPocket(cue: { x: number; z: number }, balls: { id: number; x: number; z: number; out: boolean }[], only?: (id: number) => boolean): number | null {
  let best: { angle: number; cost: number } | null = null;
  for (const b of balls) {
    if (b.id === 0 || b.out || (only && !only(b.id))) continue;
    for (const p of POCKETS) {
      const dx = p.x - b.x, dz = p.z - b.z, l = Math.hypot(dx, dz) || 1;
      const gx = b.x - (dx / l) * 2 * POOL.ballR, gz = b.z - (dz / l) * 2 * POOL.ballR;
      const toGhost = Math.hypot(gx - cue.x, gz - cue.z);
      // a bola precisa estar "na frente" da branca em relação à caçapa (evita cortes impossíveis)
      const cut = ((gx - cue.x) * dx + (gz - cue.z) * dz) / ((toGhost || 1) * l);
      if (cut < 0.35) continue;
      const cost = toGhost + l * 1.2 - cut * 2;
      if (!best || cost < best.cost) best = { angle: Math.atan2(gz - cue.z, gx - cue.x), cost };
    }
  }
  return best ? best.angle : null;
}
