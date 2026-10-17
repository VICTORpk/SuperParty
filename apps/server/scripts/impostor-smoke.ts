// Sinuca Impostor com 5 bots pela fila da estação. Servidor rodando:
//   npx tsx apps/server/scripts/impostor-smoke.ts   (≈ 1,5 min, tempo real)
import { Client } from "colyseus.js";
import { C, GAMES, S, type ChatMessage } from "@jogo/shared";
import { attach, autoPlayImpostor, goToStationAndQueue, sleep, type Bot } from "./botlib";

const url = process.env.SERVER_URL ?? "ws://localhost:2567";
const RUN_MS = Number(process.env.IMPOSTOR_SMOKE_MS ?? 90_000);
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}`); if (!ok) failed++; };

const bots: Bot[] = [];
bots.push(attach(await new Client(url).create("game", { nick: "B1", color: "#ef4444" }), "B1"));
await sleep(300);
const code = bots[0]!.room.roomId;
for (let i = 2; i <= 5; i++) bots.push(attach(await new Client(url).joinById(code, { nick: `B${i}`, color: "#3b82f6" }), `B${i}`));
await sleep(400);

// com menos de 4 jogadores na fila não começa
await goToStationAndQueue(bots[0]!, "impostor");
await goToStationAndQueue(bots[1]!, "impostor");
await goToStationAndQueue(bots[2]!, "impostor");
await sleep(500);
check("3 jogadores na fila: sem contagem (mínimo 4)", bots[0]!.queue?.games.impostor.members.length === 3 && bots[0]!.queue.games.impostor.startsAt === null);
const t1 = Date.now();
await goToStationAndQueue(bots[3]!, "impostor");
await goToStationAndQueue(bots[4]!, "impostor");
const startWait = Date.now();
check("com 4+ na fila a contagem de 10 s começa", (bots[0]!.queue?.games.impostor.startsAt ?? null) !== null);
while (bots[0]!.phase?.phase !== "in-game" && Date.now() - startWait < 20_000) await sleep(100);
check("a partida começa", bots.every((b) => b.phase?.game === "impostor"));
await sleep(600);

const withRole = bots.filter((b) => b.role === "impostor");
check("exatamente 1 jogador recebe o papel de Impostor", withRole.length === 1);
check("o estado público não revela o Impostor", bots.every((b) => b.imp && b.imp.impostor === null && b.imp.players.every((p) => p.revealed === null)));
check("5 jogadores ativos sem acertos", bots[0]!.imp!.players.length === 5 && bots[0]!.imp!.players.every((p) => p.alive && p.hits === 0));

// jogador fora da vez não taca
const first = bots[0]!.imp!.turn;
const notTurn = bots.find((b) => b.room.sessionId !== first)!;
notTurn.room.send(C.PoolShoot, { angle: 0, power: 1 });
await sleep(500);
check("jogador fora da vez não taca", bots[0]!.imp!.phase === "aim");
void t1;

const bottleSeen: string[] = [];
const hitSeen: boolean[] = [];
bots[0]!.room.onMessage(S.Impostor, (st: { phase: string; bottle: { target: string } | null; turn: string; lastHit: { attacked: boolean } | null }) => {
  if (st.phase === "bottle" && st.bottle) { if (st.bottle.target === st.turn) bottleSeen.push("AUTOALVO"); else bottleSeen.push("ok"); }
  if (st.phase === "result" && st.lastHit) hitSeen.push(st.lastHit.attacked);
});

const end = Date.now() + RUN_MS;
const done = () => Date.now() > end || bots[0]!.imp?.phase === "finished";
await Promise.all(bots.map((b) => autoPlayImpostor(b, done, 0.9, 500)));

const final = bots[0]!.imp!;
check(`houve pelo menos uma garrafa (${bottleSeen.length})`, bottleSeen.length >= 1);
check("a garrafa nunca escolheu o autor da tacada", !bottleSeen.includes("AUTOALVO"));
check("todos veem o mesmo estado", bots.every((b) => b.imp?.shotId === final.shotId));
if (final.phase !== "finished") check("o Impostor continua secreto durante a partida", bots.every((b) => b.imp!.impostor === null));
else check("ao final todos os papéis são revelados", final.impostor !== null && final.players.every((p) => p.revealed !== null));

// canal dos eliminados: se alguém já foi eliminado, o chat dele só chega aos eliminados
const dead = final.players.filter((p) => !p.alive);
if (dead.length) {
  const deadBot = bots.find((b) => b.room.sessionId === dead[0]!.id)!;
  deadBot.room.send(C.Chat, { text: "sou fantasma" });
  await sleep(700);
  const got = (b: Bot) => b.chat.some((m: ChatMessage) => m.channel === "dead" && m.text === "sou fantasma");
  const deadIds = new Set(final.players.filter((p) => !p.alive).map((p) => p.id));
  check("o chat dos eliminados só chega aos eliminados", bots.every((b) => got(b) === deadIds.has(b.room.sessionId)));
} else console.log("   (ninguém foi eliminado nesta janela de tempo; o chat dos eliminados é coberto no teste de servidor)");

for (const b of bots) await b.room.leave(true);
process.exit(failed ? 1 : 0);
