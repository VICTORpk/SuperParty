// Partida de sinuca com 2 bots passando pela fila da estação. Servidor rodando:
//   npx tsx apps/server/scripts/pool-smoke.ts   (cerca de 1 minuto; as tacadas acontecem em tempo real)
import { Client } from "colyseus.js";
import { C, GAMES, POOL, QUEUE_COUNTDOWN_MS, S, type PoolPublicState, type PoolShotMsg } from "@jogo/shared";
import { attach, autoPlayPool, goToStationAndQueue, sleep } from "./botlib";

const url = process.env.SERVER_URL ?? "ws://localhost:2567";
const RUN_MS = Number(process.env.POOL_SMOKE_MS ?? 70_000);
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}`); if (!ok) failed++; };

const a = attach(await new Client(url).create("game", { nick: "A", color: "#ef4444" }), "A");
await sleep(300);
const b = attach(await new Client(url).joinById(a.room.roomId, { nick: "B", color: "#3b82f6" }), "B");
const shots: PoolShotMsg[] = [];
const states: PoolPublicState[] = [];
a.room.onMessage(S.PoolShot, (m: PoolShotMsg) => shots.push(m));
a.room.onMessage(S.Pool, (s: PoolPublicState) => states.push(s));
await sleep(300);

await goToStationAndQueue(a, "pool");
await sleep(400);
await goToStationAndQueue(b, "pool");
const t1 = Date.now() - 100;
await sleep(500);
check("2 jogadores na fila da sinuca: contagem de 10 s", a.queue?.games.pool.members.length === 2 && a.queue.games.pool.startsAt !== null);
while (a.phase?.phase !== "in-game" && Date.now() - t1 < 20_000) await sleep(100);
check(`a sinuca começa ~10 s depois (${((Date.now() - t1) / 1000).toFixed(1)}s)`, a.phase?.game === "pool" && Math.abs(Date.now() - t1 - QUEUE_COUNTDOWN_MS) < 2500);
await sleep(500);
check("estado inicial: 16 bolas, mesa aberta, na quebra", a.pool?.balls.length === 16 && a.pool.phase === "break" && Object.values(a.pool.groups).every((g) => g === null));

// jogador fora da vez não consegue tacar
const notTurn = a.pool!.turn === a.room.sessionId ? b : a;
const before = shots.length;
notTurn.room.send(C.PoolShoot, { angle: 0, power: 1 });
await sleep(400);
check("jogador fora da vez não taca", shots.length === before);

const end = Date.now() + RUN_MS;
const done = () => Date.now() > end || a.pool?.phase === "finished";
await Promise.all([autoPlayPool(a, done, 400), autoPlayPool(b, done, 400)]);

check(`houve tacadas (${shots.length})`, shots.length >= 2);
check("cada tacada vem com gravação válida", shots.every((s) => s.recording.frames.length > 5 && s.recording.frames[0]!.length === 32));
check("quem tacou estava na vez", shots.every((s) => states.find((x) => x.phase === "shooting" && x.shotId === s.shotId)?.turn === s.shooter));
const last = a.pool!;
check("sempre 16 bolas e todas dentro da mesa", last.balls.length === 16 && last.balls.every((x) => x.out || (Math.abs(x.x) <= POOL.halfW && Math.abs(x.z) <= POOL.halfD)));
check("ambos os clientes veem o mesmo estado", JSON.stringify(a.pool?.balls) === JSON.stringify(b.pool?.balls) && a.pool?.turn === b.pool?.turn);
void GAMES;

if (a.pool?.phase === "finished") a.room.send(C.EndGame);
await sleep(500);
await a.room.leave(true); await b.room.leave(true);
process.exit(failed ? 1 : 0);
