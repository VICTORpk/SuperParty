// Teste de fumaça dos bots de desenvolvimento: com `npm run dev:server` (DEV_MODE=1) rodando,
// execute `npx tsx apps/server/scripts/dev-bots-smoke.ts`. Com o servidor em modo normal os bots devem ser ignorados
// (use `EXPECT_DEV=0` para verificar isso).
import { Client } from "colyseus.js";
import { BOT_CONFIG, C, S, type EmotePayload, type PlayerInfo, type PlayerPos, type WelcomePayload } from "@jogo/shared";

const url = process.env.SERVER_URL ?? "ws://localhost:2567";
const expectDev = process.env.EXPECT_DEV !== "0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}`); if (!ok) failed++; };

const a = await new Client(url).create("game", { nick: "Dev", color: "#ef4444" });
let welcome: WelcomePayload | undefined;
let players: PlayerInfo[] = [];
let pos: PlayerPos[] = [];
const emotes: EmotePayload[] = [];
a.onMessage(S.Welcome, (w: WelcomePayload) => (welcome = w));
a.onMessage(S.Players, (p: PlayerInfo[]) => (players = p));
a.onMessage(S.Positions, (p: PlayerPos[]) => (pos = p));
a.onMessage(S.Emote, (e: EmotePayload) => emotes.push(e));
a.onMessage(S.Notice, () => {}); a.onMessage(S.Chat, () => {}); a.onMessage(S.Phase, () => {}); a.onMessage(S.Queue, () => {});
a.send(C.Hello);
await sleep(300);
check(`servidor ${expectDev ? "informa" : "não informa"} modo de desenvolvimento`, Boolean(welcome?.dev) === expectDev);

a.send(C.DevAddBot);
await sleep(400);
if (!expectDev) {
  check("em servidor normal o comando de bot é ignorado", players.length === 1);
} else {
  check("bot entrou na sala marcado como bot", players.length === 2 && players[1]?.bot === true);
  const botId = players[1]!.id;
  const first = pos.find((p) => p.id === botId)!;
  const me = pos.find((p) => p.id === a.sessionId)!;
  const d0 = Math.hypot(first.x - me.x, first.z - me.z);
  await sleep(6000);
  const later = pos.find((p) => p.id === botId)!;
  const d1 = Math.hypot(later.x - me.x, later.z - me.z);
  check(`o bot se aproximou do jogador (${d0.toFixed(1)} → ${d1.toFixed(1)})`, d1 < d0 || d1 <= BOT_CONFIG.stopDistance + 0.6);
  check("o bot acena ao chegar perto", emotes.some((e) => e.id === botId && e.emote === "wave") || d1 > BOT_CONFIG.waveDistance);
  for (let i = 0; i < BOT_CONFIG.maxBots + 3; i++) a.send(C.DevAddBot);
  await sleep(500);
  check(`limite de bots respeitado (${players.length - 1}/${BOT_CONFIG.maxBots})`, players.filter((p) => p.bot).length === BOT_CONFIG.maxBots);
  a.send(C.DevRemoveBot);
  await sleep(300);
  check("bot removido pela interface", players.filter((p) => p.bot).length === BOT_CONFIG.maxBots - 1);
}
void a.leave();
await sleep(150);
console.log(failed ? `${failed} falha(s)` : "tudo certo");
process.exit(failed ? 1 : 0);
