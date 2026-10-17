// Bot que entra numa sala, vai até a estação do tabuleiro, entra na fila e joga sozinho:
//   npx tsx apps/server/scripts/bot.ts CODIGO [apelido] [acerto 0-1] [--game=board|pool|impostor] [--no-queue]
import { Client } from "colyseus.js";
import { attach, autoPlay, autoPlayImpostor, autoPlayPool, goToStationAndQueue } from "./botlib";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [code, nick = "Bot", skillArg = "0.8"] = args;
if (!code) { console.error("Uso: bot.ts CODIGO [apelido] [acerto 0-1] [--no-queue]"); process.exit(1); }
const gameArg = (process.argv.find((a) => a.startsWith("--game=")) ?? "--game=board").slice(7) as "board" | "pool" | "impostor";
const url = process.env.SERVER_URL ?? "ws://localhost:2567";

const room = await new Client(url).joinById(code.toUpperCase(), { nick, color: "#3b82f6" });
const bot = attach(room, nick, Number(skillArg));
console.log(`[bot ${nick}] entrou na sala ${code}`);
if (!process.argv.includes("--no-queue")) {
  await goToStationAndQueue(bot, gameArg);
  console.log(`[bot ${nick}] entrou na fila de ${gameArg}`);
}
await Promise.all([autoPlay(bot, () => false), autoPlayPool(bot, () => false), autoPlayImpostor(bot, () => false)]);
