// Partida completa do tabuleiro com 2 bots, passando pela fila das estações e pela arena.
//   npx tsx apps/server/scripts/board-smoke.ts   (servidor rodando; ~2-3 min)
import { Client } from "colyseus.js";
import { BOARD_RULES, C, FINAL_TILE, GAMES, QUEUE_COUNTDOWN_MS, type BoardEvent } from "@jogo/shared";
import { attach, autoPlay, goToStationAndQueue, sleep, walkTo } from "./botlib";

const url = process.env.SERVER_URL ?? "ws://localhost:2567";
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}`); if (!ok) failed++; };

const a = attach(await new Client(url).create("game", { nick: "A", color: "#ef4444" }), "A", 0.9);
await sleep(300);
const code = a.room.roomId;
const b = attach(await new Client(url).joinById(code, { nick: "B", color: "#3b82f6" }), "B", 0.9);
await sleep(400);

// longe da estação não entra na fila
a.room.send(C.JoinQueue, { game: "board" });
await sleep(300);
check("não entra na fila longe da estação", a.queue?.games.board.members.length === 0 && a.notices.some((n) => /perto/.test(n)));

// jogo indisponível
await walkTo(a, GAMES.pool.station.x + 1, GAMES.pool.station.z + 1);
a.room.send(C.JoinQueue, { game: "pool" });
await sleep(300);
check("jogo ainda indisponível não aceita fila", a.queue?.games.pool.members.length === 0 && a.notices.some((n) => /dispon/.test(n)));

await goToStationAndQueue(a, "board");
await sleep(500);
check("1 jogador na fila: sem contagem", a.queue?.games.board.members.length === 1 && a.queue.games.board.startsAt === null);

const t0 = Date.now();
await goToStationAndQueue(b, "board");
await sleep(500);
check("2 jogadores: contagem de 10 s iniciada", a.queue?.games.board.members.length === 2 && a.queue.games.board.startsAt !== null);

// B sai da fila → cancela; entra de novo
b.room.send(C.LeaveQueue);
await sleep(400);
check("sair da fila cancela a contagem", a.queue?.games.board.startsAt === null);
const t1 = Date.now();
b.room.send(C.JoinQueue, { game: "board" });
await sleep(500);

while (a.phase?.phase !== "in-game" && Date.now() - t1 < 20_000) await sleep(100);
const waited = Date.now() - t1;
check(`a partida começa ~10 s após completar a fila (${(waited / 1000).toFixed(1)}s)`, a.phase?.phase === "in-game" && Math.abs(waited - QUEUE_COUNTDOWN_MS) < 1500);
check("ambos entram no tabuleiro", b.phase?.game === "board" && !!a.state && a.queue?.busy === "board");
void t0;

const started = Date.now();
const arenaSeen = { phases: new Set<string>(), hits: 0 };
let lastLog = "";
const watch = setInterval(() => {
  if (a.arena) arenaSeen.phases.add(a.arena.phase);
  const st = a.state;
  if (!st) return;
  const line = `${st.phase} turn=${st.turn.slice(0, 4)} pos=${Object.values(st.positions).join("/")}${st.phase === "arena" && a.arena ? ` arena=${a.arena.phase} hp=${a.arena.fighters.map((f) => f.hp).join("/")}` : ""}`;
  if (line !== lastLog && process.env.VERBOSE) { lastLog = line; console.log(`   [${Math.round((Date.now() - started) / 1000)}s] ${line}`); }
}, 200);
const bots = new Map([[a.room.sessionId, a], [b.room.sessionId, b]]);
void bots;
const done = () => a.state?.phase === "finished" || Date.now() - started > 320_000;
const pa = autoPlay(a, done), pb = autoPlay(b, done);
await Promise.all([pa, pb]);
clearInterval(watch);

const st = a.state!;
check("a partida terminou com vencedor", st.phase === "finished" && !!st.winner);
check("o vencedor chegou à casa final", st.positions[st.winner!] === FINAL_TILE);
const rolls = a.events.filter((e): e is Extract<BoardEvent, { kind: "roll" }> => e.kind === "roll");
check("dados entre 1 e 6", rolls.length > 0 && rolls.every((r) => r.value >= 1 && r.value <= 6));
const arenaResults = a.events.filter((e): e is Extract<BoardEvent, { kind: "arena-result" }> => e.kind === "arena-result");
console.log(`   dados: ${rolls.length}, arenas: ${arenaResults.length} (${arenaResults.map((r) => r.reason).join(",")}), tempo: ${Math.round((Date.now() - started) / 1000)}s`);
if (arenaResults.length) {
  check("a arena passou por contagem e luta", arenaSeen.phases.has("countdown") && arenaSeen.phases.has("fight"));
  const moves = a.events.filter((e): e is Extract<BoardEvent, { kind: "move" }> => e.kind === "move" && e.reason.startsWith("arena"));
  check("arena: vencedor avança 2 e perdedor volta 1",
    moves.every((m) => m.reason === "arena-win" ? m.to === Math.min(FINAL_TILE, m.from + BOARD_RULES.encounterWinnerAdvance) : m.to === Math.max(0, m.from - BOARD_RULES.encounterLoserBack)));
} else console.log("   (nenhum encontro nesta partida; a arena é testada em arena-smoke.ts)");
check("ambos viram o mesmo vencedor", b.state?.winner === st.winner);

a.room.send(C.EndGame);
await sleep(600);
check("volta ao lobby", a.phase?.phase === "lobby" && b.phase?.phase === "lobby" && a.queue?.busy === null);
await a.room.leave(true); await b.room.leave(true);
process.exit(failed ? 1 : 0);
