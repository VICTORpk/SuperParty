import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POOL, S, type PoolPublicState, type PoolShotMsg, groupOf } from "@jogo/shared";
import { PoolGame } from "./PoolGame";

function setup(away: (id: string) => boolean = () => false, ids: string[] = ["A", "B"]) {
  const states: PoolPublicState[] = [];
  const shots: PoolShotMsg[] = [];
  const ended: number[] = [];
  const game = new PoolGame({
    send: (type, payload) => { if (type === S.Pool) states.push(payload as PoolPublicState); else if (type === S.PoolShot) shots.push(payload as PoolShotMsg); },
    isAway: away,
    onEnded: () => ended.push(Date.now()),
  }, ids);
  game.start();
  return { game, states, shots, ended, last: () => states[states.length - 1]! };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("PoolGame (servidor autoritativo)", () => {
  it("começa na quebra, com 16 bolas e a mesa aberta", () => {
    const t = setup();
    const s = t.last();
    expect(s.phase).toBe("break");
    expect(s.balls).toHaveLength(16);
    expect(s.groups).toEqual({ A: null, B: null });
    expect(["A", "B"]).toContain(s.turn);
    t.game.dispose();
  });

  it("só quem está na vez pode tacar; força e ângulo inválidos são ignorados", () => {
    const t = setup();
    const other = t.last().turn === "A" ? "B" : "A";
    t.game.handleShoot(other, { angle: 0, power: 1 });
    t.game.handleShoot(t.last().turn, { angle: NaN, power: 1 });
    t.game.handleShoot(t.last().turn, { angle: 0, power: "x" });
    t.game.handleShoot(t.last().turn, null);
    expect(t.shots).toHaveLength(0);
    expect(t.last().phase).toBe("break");
    t.game.dispose();
  });

  it("uma tacada gera gravação, passa por 'shooting' e volta com as regras aplicadas", () => {
    const t = setup();
    const shooter = t.last().turn;
    t.game.handleShoot(shooter, { angle: 0, power: 1 });
    expect(t.shots).toHaveLength(1);
    expect(t.last().phase).toBe("shooting");
    expect(t.shots[0]!.shooter).toBe(shooter);
    expect(t.shots[0]!.recording.frames.length).toBeGreaterThan(10);
    // durante a tacada ninguém joga
    t.game.handleShoot(shooter, { angle: 0, power: 1 });
    expect(t.shots).toHaveLength(1);
    vi.advanceTimersByTime(t.shots[0]!.recording.totalMs + 2000);
    expect(["aim", "placing", "break", "finished"]).toContain(t.last().phase);
    expect(t.last().shotId).toBe(1);
    t.game.dispose();
  });

  it("a quebra move as bolas e define quem joga em seguida", () => {
    const t = setup();
    const before = t.last().balls.map((b) => [b.x, b.z]);
    const shooter = t.last().turn;
    t.game.handleShoot(shooter, { angle: 0, power: 1 });
    vi.advanceTimersByTime(60_000);
    const after = t.last();
    expect(after.balls.some((b, i) => !b.out && (b.x !== before[i]![0] || b.z !== before[i]![1]))).toBe(true);
    expect(after.groups).toEqual({ A: null, B: null }); // quebra não define grupos
    t.game.dispose();
  });

  it("tacada sem tocar em nada dá bola na mão ao adversário e permite posicionar a branca", () => {
    const t = setup();
    const shooter = t.last().turn;
    t.game.handleShoot(shooter, { angle: Math.PI, power: 0.08 }); // fraca, para longe do triângulo
    vi.advanceTimersByTime(t.shots[0]!.recording.totalMs + 1_000);
    const s = t.last();
    expect(s.turn).not.toBe(shooter);
    expect(s.ballInHand).toBe(true);
    expect(s.phase).toBe("placing");
    // posicionamento inválido (em cima de uma bola) é recusado
    const target = s.balls.find((b) => b.id === 5)!;
    t.game.handlePlace(shooter, { x: -4, z: 0 }); // não é a vez dele
    t.game.handlePlace(s.turn, { x: target.x, z: target.z });
    expect(t.last().phase).toBe("placing");
    t.game.handlePlace(s.turn, { x: -4, z: 1 });
    expect(t.last().phase).toBe("aim");
    const cue = t.last().balls.find((b) => b.id === 0)!;
    expect(cue.x).toBeCloseTo(-4);
    expect(cue.z).toBeCloseTo(1);
    t.game.dispose();
  });

  it("tempo esgotado na mira passa a vez com bola na mão", () => {
    const t = setup();
    const first = t.last().turn;
    vi.advanceTimersByTime(46_000);
    expect(t.last().turn).not.toBe(first);
    t.game.dispose();
  });

  it("jogador ausente perde a vez rapidamente", () => {
    const t = setup((id) => id === "A" || id === "B");
    const first = t.last().turn;
    vi.advanceTimersByTime(3_500);
    expect(t.last().turn).not.toBe(first);
    t.game.dispose();
  });

  it("sair da partida dá a vitória ao adversário e encerra", () => {
    const t = setup();
    t.game.removePlayer("A");
    expect(t.last().phase).toBe("finished");
    expect(t.last().winner).toBe("B");
    expect(t.ended).toHaveLength(1);
    t.game.dispose();
  });

  it("uma partida inteira com tacadas aleatórias termina, sem estados inválidos", () => {
    const t = setup();
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let guard = 0;
    while (t.last().phase !== "finished" && guard++ < 800) {
      const s = t.last();
      if (s.phase === "placing") {
        t.game.handlePlace(s.turn, { x: -POOL.halfW + 0.5 + rand() * 11, z: -2.5 + rand() * 5 });
        if (t.last().phase === "placing") vi.advanceTimersByTime(31_000); // posição inválida: o servidor posiciona
      } else if (s.phase === "aim" || s.phase === "break") {
        t.game.handleShoot(s.turn, { angle: rand() * Math.PI * 2, power: 0.3 + rand() * 0.7 });
        vi.advanceTimersByTime(60_000);
      }
      const now = t.last();
      for (const b of now.balls) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.z)).toBe(true);
        if (!b.out) { expect(Math.abs(b.x)).toBeLessThanOrEqual(POOL.halfW + 1e-6); expect(Math.abs(b.z)).toBeLessThanOrEqual(POOL.halfD + 1e-6); }
      }
      expect(now.balls.filter((b) => !b.out && groupOf(b.id) === null && b.id !== 0 && b.id !== 8)).toHaveLength(0);
    }
    expect(t.last().phase).toBe("finished");
    expect(["A", "B"]).toContain(t.last().winner);
    expect(t.ended).toHaveLength(1);
    t.game.dispose();
  }, 60_000);
});

describe("PoolGame com equipes (3 e 4 jogadores)", () => {
  it("4 jogadores formam duas duplas e se revezam dentro da dupla", () => {
    const t = setup(() => false, ["A", "B", "C", "D"]);
    const { teams } = t.last();
    expect(teams.map((x) => x.length)).toEqual([2, 2]);
    expect(teams.flat().sort()).toEqual(["A", "B", "C", "D"]);
    // sem encaçapar, a vez passa à outra equipe e, na volta, ao outro integrante
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const cur = t.last().turn;
      order.push(cur);
      for (let ms = 0; t.last().turn === cur && ms < 200_000; ms += 1000) vi.advanceTimersByTime(1000); // tempo esgotado passa a vez
    }
    const teamOf = (id: string) => teams.findIndex((x) => x.includes(id));
    expect(teamOf(order[0]!)).not.toBe(teamOf(order[1]!));
    expect(teamOf(order[0]!)).toBe(teamOf(order[2]!));
    expect(order[0]).not.toBe(order[2]); // rodízio dentro da equipe
    expect(order[1]).not.toBe(order[3]);
    t.game.dispose();
  });

  it("3 jogadores: um contra dois, e os companheiros dividem o grupo de bolas", () => {
    const t = setup(() => false, ["A", "B", "C"]);
    expect(t.last().teams.map((x) => x.length).sort()).toEqual([1, 2]);
    const pair = t.last().teams.find((x) => x.length === 2)!;
    expect(t.last().groups[pair[0]!]).toBe(t.last().groups[pair[1]!]);
    t.game.dispose();
  });

  it("quem sai de uma dupla não encerra a partida; sair da equipe inteira dá a vitória à outra", () => {
    const t = setup(() => false, ["A", "B", "C", "D"]);
    const [t0, t1] = t.last().teams as [string[], string[]];
    t.game.removePlayer(t0[0]!);
    expect(t.last().phase).not.toBe("finished");
    expect(t.last().players).toHaveLength(3);
    t.game.removePlayer(t0[1]!);
    expect(t.last().phase).toBe("finished");
    expect(t1).toContain(t.last().winner);
    expect(t.last().winners.sort()).toEqual([...t1].sort());
    t.game.dispose();
  });

  it("uma partida de 4 jogadores com tacadas aleatórias termina com uma equipe vencedora", () => {
    const t = setup(() => false, ["A", "B", "C", "D"]);
    let seed = 777;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let guard = 0;
    while (t.last().phase !== "finished" && guard++ < 800) {
      const s = t.last();
      if (s.phase === "placing") vi.advanceTimersByTime(31_000);
      else if (s.phase === "aim" || s.phase === "break") {
        // mira na bola mais próxima (com um pouco de erro): tacadas totalmente aleatórias quase não acertam nada no fim da partida
        const cue = s.balls.find((b) => b.id === 0 && !b.out);
        const near = s.balls.filter((b) => !b.out && b.id !== 0).sort((p, q) => Math.hypot(p.x - cue!.x, p.z - cue!.z) - Math.hypot(q.x - cue!.x, q.z - cue!.z))[0];
        const angle = cue && near ? Math.atan2(near.z - cue.z, near.x - cue.x) + (rand() - 0.5) * 0.3 : rand() * Math.PI * 2;
        t.game.handleShoot(s.turn, { angle, power: 0.3 + rand() * 0.7 });
        vi.advanceTimersByTime(60_000);
      }
    }
    expect(t.last().phase).toBe("finished");
    expect(t.last().winners.length).toBe(2);
    expect(t.last().winners).toContain(t.last().winner!);
    t.game.dispose();
  }, 60_000);
});
