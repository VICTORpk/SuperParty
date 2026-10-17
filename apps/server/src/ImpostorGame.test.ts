import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPOSTOR_RULES, S, type ImpostorPublicState } from "@jogo/shared";
import { ImpostorGame } from "./ImpostorGame";

function setup(ids: string[] = ["A", "B", "C", "D", "E"], away: (id: string) => boolean = () => false) {
  const states: ImpostorPublicState[] = [];
  const privates: { to: string; type: string; payload: unknown }[] = [];
  const publicRaw: string[] = [];
  const ended: number[] = [];
  const game = new ImpostorGame({
    send: (type, payload) => { publicRaw.push(JSON.stringify({ type, payload })); if (type === S.Impostor) states.push(payload as ImpostorPublicState); },
    sendTo: (to, type, payload) => privates.push({ to, type, payload }),
    isAway: away,
    onEnded: () => ended.push(1),
  }, ids);
  game.start();
  return { game, states, privates, publicRaw, ended, last: () => states[states.length - 1]! };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Dá tacadas até uma ser válida (ir para a garrafa), devolvendo o estado. */
/** Avança o relógio simulado até a tacada terminar de rolar (sem pular a garrafa nem a decisão). */
function settle(t: ReturnType<typeof setup>) {
  let guard = 0;
  while (t.last().phase === "shooting" && guard++ < 200) vi.advanceTimersByTime(500);
}

function shootUntilBottle(t: ReturnType<typeof setup>, seed = 7) {
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 400; i++) {
    const st = t.last();
    if (st.phase === "bottle" || st.phase === "decision" || st.phase === "finished") return st;
    if (st.phase === "aim") {
      t.game.handleShoot(st.turn, { angle: rand() * Math.PI * 2, power: 0.5 + rand() * 0.5 });
      settle(t);
    } else vi.advanceTimersByTime(1000);
  }
  throw new Error("nenhuma tacada válida");
}

describe("ImpostorGame — segredo do papel", () => {
  it("só o Impostor recebe o papel, e por mensagem privada", () => {
    const t = setup();
    const roles = t.privates.filter((p) => p.type === S.Role);
    expect(roles).toHaveLength(1);
    expect(roles[0]!.payload).toEqual({ role: "impostor" });
    expect(["A", "B", "C", "D", "E"]).toContain(roles[0]!.to);
    t.game.dispose();
  });

  it("o estado público nunca contém a identidade do Impostor antes do fim", () => {
    const t = setup();
    const imp = t.privates.find((p) => p.type === S.Role)!.to;
    shootUntilBottle(t);
    for (const raw of t.publicRaw) {
      const o = JSON.parse(raw) as { payload: Partial<ImpostorPublicState> };
      if (o.payload.phase && o.payload.phase !== "finished") {
        expect(o.payload.impostor).toBeNull();
        expect(o.payload.players!.every((p) => p.revealed === null)).toBe(true);
      }
    }
    expect(imp).toBeTruthy();
    t.game.dispose();
  });

  it("reconectar devolve o papel só ao Impostor", () => {
    const t = setup();
    const imp = t.privates.find((p) => p.type === S.Role)!.to;
    const got: string[] = [];
    t.game.sendStateTo((type) => got.push(type), "A" === imp ? "B" : "A");
    expect(got).toEqual([S.Impostor]);
    const got2: string[] = [];
    t.game.sendStateTo((type) => got2.push(type), imp);
    expect(got2).toEqual([S.Impostor, S.Role]);
    t.game.dispose();
  });
});

describe("ImpostorGame — fluxo", () => {
  it("só quem está na vez taca", () => {
    const t = setup();
    const other = ["A", "B", "C", "D", "E"].find((x) => x !== t.last().turn)!;
    t.game.handleShoot(other, { angle: 0, power: 1 });
    expect(t.last().phase).toBe("aim");
    t.game.dispose();
  });

  it("tempo esgotado passa a vez para o próximo ativo", () => {
    const t = setup();
    const first = t.last().turn;
    vi.advanceTimersByTime(IMPOSTOR_RULES.turnMs + 500);
    expect(t.last().turn).not.toBe(first);
    t.game.dispose();
  });

  it("jogador ausente perde a vez em poucos segundos", () => {
    const t = setup(["A", "B", "C", "D"], () => true);
    const first = t.last().turn;
    vi.advanceTimersByTime(IMPOSTOR_RULES.awayTurnMs + 300);
    expect(t.last().turn).not.toBe(first);
    t.game.dispose();
  });

  it("depois de uma tacada válida a garrafa escolhe alguém que não é o autor", () => {
    const t = setup();
    const st = shootUntilBottle(t);
    expect(st.phase).toBe("bottle");
    expect(st.bottle!.target).not.toBe(st.turn);
    expect(st.players.find((p) => p.id === st.bottle!.target)!.alive).toBe(true);
    t.game.dispose();
  });

  it("só o autor decide; sem decisão em 10 s, poupa", () => {
    const t = setup();
    shootUntilBottle(t);
    vi.advanceTimersByTime(IMPOSTOR_RULES.bottleMs + 700);
    expect(t.last().phase).toBe("decision");
    const shooter = t.last().turn;
    const other = ["A", "B", "C", "D", "E"].find((x) => x !== shooter)!;
    t.game.handleDecision(other, { attack: true });
    expect(t.last().phase).toBe("decision");
    vi.advanceTimersByTime(IMPOSTOR_RULES.decisionMs + 100);
    expect(t.last().phase).toBe("result");
    expect(t.last().lastHit!.attacked).toBe(false);
    expect(t.last().players.every((p) => p.hits === 0)).toBe(true);
    t.game.dispose();
  });

  it("atacar dá um acerto ao alvo; 3 acertos eliminam e revelam o papel", () => {
    const t = setup(["A", "B", "C", "D", "E", "F"]);
    let eliminated: string | null = null;
    for (let round = 0; round < 60 && !eliminated; round++) {
      shootUntilBottle(t, round + 3);
      if (t.last().phase === "finished") break;
      vi.advanceTimersByTime(IMPOSTOR_RULES.bottleMs + 700);
      const target = t.last().decisionTarget!;
      const before = t.last().players.find((p) => p.id === target)!.hits;
      t.game.handleDecision(t.last().turn, { attack: true });
      const p = t.last().players.find((x) => x.id === target)!;
      expect(p.hits).toBe(before + 1);
      if (!p.alive) { eliminated = target; expect(p.hits).toBe(3); expect(p.revealed).not.toBeNull(); }
      vi.advanceTimersByTime(IMPOSTOR_RULES.resultMs + 200);
      if (t.last().phase === "finished") break;
    }
    expect(eliminated !== null || t.last().phase === "finished").toBe(true);
    t.game.dispose();
  });

  it("uma partida inteira (sempre atacando) termina com vencedor, sem estados inválidos", () => {
    const t = setup(["A", "B", "C", "D", "E", "F", "G"]);
    let guard = 0;
    while (t.last().phase !== "finished" && guard++ < 4000) {
      const st = t.last();
      expect(st.players.every((p) => p.hits >= 0 && p.hits <= 3)).toBe(true);
      expect(st.players.filter((p) => !p.alive).every((p) => p.hits >= 3 || p.revealed === null)).toBe(true);
      if (st.phase === "aim") {
        t.game.handleShoot(st.turn, { angle: (guard * 0.7) % (Math.PI * 2), power: 0.6 + (guard % 4) / 10 });
        settle(t);
      } else if (st.phase === "decision") {
        t.game.handleDecision(st.turn, { attack: true });
      } else vi.advanceTimersByTime(1500);
    }
    const end = t.last();
    expect(end.phase).toBe("finished");
    expect(["innocents", "impostor"]).toContain(end.winner);
    expect(end.impostor).toBe(t.privates.find((p) => p.type === S.Role)!.to);
    expect(end.players.every((p) => p.revealed !== null)).toBe(true);
    expect(t.ended).toHaveLength(1);
    if (end.winner === "impostor") expect(end.players.filter((p) => p.alive)).toHaveLength(2);
    t.game.dispose();
  }, 60_000);

  it("se o Impostor sai da partida, os inocentes vencem", () => {
    const t = setup();
    const imp = t.privates.find((p) => p.type === S.Role)!.to;
    t.game.removePlayer(imp);
    expect(t.last().phase).toBe("finished");
    expect(t.last().winner).toBe("innocents");
    t.game.dispose();
  });

  it("se um inocente sai, a vez segue; com poucos restantes o Impostor vence", () => {
    const t = setup(["A", "B", "C", "D"]);
    const imp = t.privates.find((p) => p.type === S.Role)!.to;
    const inn = ["A", "B", "C", "D"].filter((x) => x !== imp);
    t.game.removePlayer(inn[0]!);
    expect(t.last().phase).toBe("aim");
    expect(t.last().players.find((p) => p.id === inn[0])!.alive).toBe(false);
    t.game.removePlayer(inn[1]!);
    expect(t.last().phase).toBe("finished");
    expect(t.last().winner).toBe("impostor");
    t.game.dispose();
  });
});
