import { describe, expect, it } from "vitest";
import { ARENA, S, type ArenaEvent, type ArenaSnapshot } from "@jogo/shared";
import { ArenaBattle } from "./ArenaBattle";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await sleep(30);
  return fn();
}

function setup() {
  const snaps: ArenaSnapshot[] = [];
  const events: ArenaEvent[] = [];
  const ended: { winner: string; loser: string; reason: string }[] = [];
  const battle = new ArenaBattle({
    send: (type, payload) => { if (type === S.Arena) snaps.push(payload as ArenaSnapshot); else if (type === S.ArenaEvent) events.push(payload as ArenaEvent); },
    isAway: () => false,
    onEnded: (winner, loser, reason) => ended.push({ winner, loser, reason }),
  }, "A", "B");
  battle.start();
  const last = () => snaps[snaps.length - 1]!;
  const fighter = (id: string) => last().fighters.find((f) => f.id === id)!;
  return { battle, snaps, events, ended, last, fighter };
}

describe("ArenaBattle (servidor autoritativo)", () => {
  it("começa com contagem regressiva e vida cheia; golpes são ignorados antes da luta", async () => {
    const t = setup();
    expect(t.last().phase).toBe("countdown");
    expect(t.fighter("A").hp).toBe(ARENA.hp);
    t.battle.handleAction("A", { kind: "punch" });
    await sleep(300);
    expect(t.fighter("B").hp).toBe(ARENA.hp);
    t.battle.dispose();
  });

  it("um soco ao alcance tira vida e empurra o alvo; fora do alcance não acerta", { timeout: 15000 }, async () => {
    const t = setup();
    expect(await waitFor(() => t.last().phase === "fight")).toBe(true);
    // distância inicial = 6 (fora do alcance)
    t.battle.handleAction("A", { kind: "punch" });
    await sleep(500);
    expect(t.fighter("B").hp).toBe(ARENA.hp);
    // aproxima A até ficar ao alcance de B
    t.battle.handleInput("A", { mx: 1, mz: 0, run: true, jump: false });
    expect(await waitFor(() => Math.hypot(t.fighter("B").x - t.fighter("A").x, t.fighter("B").z - t.fighter("A").z) < 1.6)).toBe(true);
    t.battle.handleInput("A", { mx: 0, mz: 0, run: false, jump: false });
    const bx = t.fighter("B").x;
    t.battle.handleAction("A", { kind: "punch" });
    expect(await waitFor(() => t.fighter("B").hp < ARENA.hp)).toBe(true);
    expect(t.fighter("B").hp).toBe(ARENA.hp - ARENA.attacks.punch.dmg);
    await sleep(250);
    expect(t.fighter("B").x).toBeGreaterThan(bx); // foi empurrado para longe
    expect(t.events.some((e) => e.kind === "hit" && e.attacker === "A" && e.target === "B" && e.attack === "punch")).toBe(true);
    t.battle.dispose();
  });

  it("sair da plataforma andando = queda; o oponente vence", { timeout: 20000 }, async () => {
    const t = setup();
    expect(await waitFor(() => t.last().phase === "fight")).toBe(true);
    t.battle.handleInput("B", { mx: 1, mz: 0, run: true, jump: false });
    expect(await waitFor(() => t.last().phase === "ended", 12000)).toBe(true);
    expect(t.last().winner).toBe("A");
    expect(t.last().reason).toBe("queda");
    expect(t.events.some((e) => e.kind === "splash" && e.id === "B")).toBe(true);
    expect(await waitFor(() => t.ended.length === 1, 5000)).toBe(true);
    expect(t.ended[0]).toMatchObject({ winner: "A", loser: "B", reason: "queda" });
    t.battle.dispose();
  });

  it("desistir encerra a luta com derrota", { timeout: 10000 }, async () => {
    const t = setup();
    t.battle.forfeit("A");
    expect(t.last().phase).toBe("ended");
    expect(t.last().winner).toBe("B");
    expect(t.last().reason).toBe("desistencia");
    t.battle.dispose();
  });

  it("entradas inválidas são ignoradas (NaN, tipos errados, ações desconhecidas)", { timeout: 10000 }, async () => {
    const t = setup();
    expect(await waitFor(() => t.last().phase === "fight")).toBe(true);
    t.battle.handleInput("A", { mx: NaN, mz: "x", run: 1, jump: "sim" });
    t.battle.handleAction("A", { kind: "hadouken" });
    t.battle.handleAction("A", null);
    t.battle.handleInput("ZZZ", { mx: 1, mz: 0 });
    await sleep(400);
    const a = t.fighter("A");
    expect(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.y)).toBe(true);
    expect(a.action).toBeNull();
    t.battle.dispose();
  });
});
