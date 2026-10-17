// Teste de fumaça: com o servidor rodando (npm run dev:server), execute `npx tsx apps/server/scripts/smoke.ts`.
import { Client } from "colyseus.js";
import { C, S, DODGE_DISTANCE, type AttackPayload, type DodgePayload, type EmotePayload, type ChatMessage, type PlayerInfo, type PlayerPos, type WelcomePayload } from "@jogo/shared";

const url = process.env.SERVER_URL ?? "ws://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}`); if (!ok) failed++; };

const a = await new Client(url).create("game", { nick: "Ana", color: "#ef4444" });
let welcomeA: WelcomePayload | undefined;
let playersA: PlayerInfo[] = [];
const chatA: ChatMessage[] = [];
a.onMessage(S.Welcome, (w: WelcomePayload) => (welcomeA = w));
a.onMessage(S.Players, (p: PlayerInfo[]) => (playersA = p));
a.onMessage(S.Chat, (m: ChatMessage) => chatA.push(m));
a.onMessage(S.Notice, () => {});
a.send(C.Hello);
await sleep(300);
check("criou sala com código de 5 letras", /^[A-Z2-9]{5}$/.test(welcomeA?.code ?? ""));
const code = welcomeA!.code;

const b = await new Client(url).joinById(code, { nick: "Ana", color: "#3b82f6" });
let playersB: PlayerInfo[] = [];
b.onMessage(S.Welcome, () => {}); b.onMessage(S.Players, (p: PlayerInfo[]) => (playersB = p)); b.onMessage(S.Chat, () => {}); b.onMessage(S.Notice, () => {});
b.send(C.Hello);
await sleep(300);
check("2 jogadores na sala", playersA.length === 2);
check("apelido duplicado ganhou sufixo", playersA[1]?.nick === "Ana 2");
check("primeiro jogador é anfitrião", playersA[0]?.isHost === true && playersA[1]?.isHost === false);

b.send(C.Chat, { text: "<b>oi</b>" });
b.send(C.Chat, { text: "spam" }); // dentro de 1s: deve ser ignorada
await sleep(300);
check("chat entregue (1 mensagem, rate limit ativo)", chatA.length === 1 && chatA[0]?.text === "<b>oi</b>");

let bad = "";
try { await new Client(url).joinById("ZZZZZ", { nick: "X", color: "#fff" }); } catch (e) { bad = String(e); }
check("código inexistente é rejeitado", bad !== "");

let noNick = "";
try { await new Client(url).joinById(code, { nick: "  ", color: "#fff" }); } catch (e) { noNick = String(e); }
check("apelido vazio é rejeitado", noNick !== "");

let posA: PlayerPos[] = [];
a.onMessage(S.Positions, (p: PlayerPos[]) => (posA = p));
b.send(C.Move, { x: 0.3, z: 0, ry: 1 });
await sleep(350);
const pb = posA.find((p) => p.id === b.sessionId);
check("movimento válido sincronizado", posA.length === 2 && !!pb && Math.abs(pb.ry - 1) < 1e-9);
const before = pb!;
b.send(C.Move, { x: 500, z: 500, ry: 0 });
b.send(C.Move, { x: NaN, z: 0 });
await sleep(350);
const pb2 = posA.find((p) => p.id === b.sessionId)!;
check("teletransporte é limitado pelo servidor", Math.hypot(pb2.x, pb2.z) < 18.01 && Math.hypot(pb2.x - before.x, pb2.z - before.z) < 4.5);

b.send(C.Move, { x: 0, z: 0, y: 99, ry: 0 });
await sleep(350);
check("altura do pulo é limitada pelo servidor", (posA.find((p) => p.id === b.sessionId)?.y ?? 99) <= 2.2);

const emotesA: EmotePayload[] = [];
const dodgesA: DodgePayload[] = [];
a.onMessage(S.Emote, (e: EmotePayload) => emotesA.push(e));
a.onMessage(S.Dodge, (d: DodgePayload) => dodgesA.push(d));
b.send(C.Emote, { emote: "wave" });
b.send(C.Emote, { emote: "hack" });
await sleep(500);
b.send(C.Emote, { emote: "middle" });
await sleep(300);
check("emote válido é transmitido; inválido e spam são ignorados", emotesA.length === 2 && emotesA[0]?.emote === "wave" && emotesA[1]?.emote === "middle");

const attacksA: AttackPayload[] = [];
a.onMessage(S.Attack, (x: AttackPayload) => attacksA.push(x));
b.send(C.Attack, { kind: "punch" });
b.send(C.Attack, { kind: "punch" }); // dentro do tempo de recarga: ignorado
b.send(C.Attack, { kind: "hadouken" });
await sleep(500);
b.send(C.Attack, { kind: "kick" });
await sleep(300);
check("golpes no lobby são retransmitidos (só visuais); inválidos e spam ignorados", attacksA.length === 2 && attacksA[0]?.kind === "punch" && attacksA[1]?.kind === "kick");
check("ninguém perde vida no lobby (o servidor nem tem estado de vida fora da arena)", !("hp" in (attacksA[0] ?? {})));

const cur = posA.find((p) => p.id === b.sessionId)!;
b.send(C.Dodge, { x: cur.x + DODGE_DISTANCE, z: cur.z, ry: 0 });
await sleep(350);
check("esquiva válida transmitida", dodgesA.length === 1 && Math.abs(dodgesA[0]!.tx - (cur.x + DODGE_DISTANCE)) < 0.01);
b.send(C.Dodge, { x: cur.x, z: cur.z, ry: 0 });
await sleep(300);
check("esquiva em recarga é ignorada", dodgesA.length === 1);
await sleep(900);
b.send(C.Dodge, { x: 17, z: 0, ry: 0 });
await sleep(300);
check("teleporte longo é rejeitado", dodgesA.length === 1);

await a.leave(true);
await sleep(300);
check("anfitrião transferido ao sair", playersB.length === 1 && playersB[0]?.isHost === true);
b.leave(true);
await sleep(200);
process.exit(failed ? 1 : 0);
