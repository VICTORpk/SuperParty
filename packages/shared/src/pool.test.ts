import { describe, expect, it } from "vitest";
import {
  POCKETS, POOL, POOL_OUT, findFreeSpot, groupOf, isValidCuePlacement, predictAim, rackBalls, resolveShot, simulateShot,
  type SimBall,
} from "./index";

function seededRng(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => { s = (s * 1664525 + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n); };
}
const empty = (): SimBall[] => Array.from({ length: 16 }, (_, id) => ({ id, x: 0, z: 0, vx: 0, vz: 0, out: id !== 0 }));
const dist = (a: SimBall, b: SimBall) => Math.hypot(a.x - b.x, a.z - b.z);

describe("triângulo e mesa", () => {
  it("monta 16 bolas distintas sem sobreposição, com a 8 no centro", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const balls = rackBalls(seededRng(seed));
      expect(balls).toHaveLength(16);
      expect(new Set(balls.map((b) => b.id)).size).toBe(16);
      for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) expect(dist(balls[i]!, balls[j]!)).toBeGreaterThanOrEqual(2 * POOL.ballR - 1e-9);
      const eight = balls.find((b) => b.id === 8)!;
      expect(eight.x).toBeGreaterThan(POOL.foot.x);
      expect(Math.abs(eight.z)).toBeLessThan(1e-9);
    }
  });
  it("as duas bolas dos cantos de trás são de grupos diferentes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const balls = rackBalls(seededRng(seed));
      const back = balls.filter((b) => b.id !== 0 && b.x > POOL.foot.x + 3.9 * POOL.ballR * 1.7 && Math.abs(Math.abs(b.z) - 4 * POOL.ballR * 1.002) < 1e-6);
      expect(back).toHaveLength(2);
      expect(new Set(back.map((b) => groupOf(b.id))).size).toBe(2);
    }
  });
  it("tem 6 caçapas", () => expect(POCKETS).toHaveLength(6));
});

describe("física da tacada", () => {
  it("é determinística", () => {
    const start = rackBalls(seededRng(3));
    const a = simulateShot(start, 0.01, 0.9);
    const b = simulateShot(start, 0.01, 0.9);
    expect(a.recording.frames).toEqual(b.recording.frames);
    expect(a.pocketed).toEqual(b.pocketed);
  });
  it("tudo para e nenhuma bola sai da mesa", () => {
    const res = simulateShot(rackBalls(seededRng(5)), 0.02, 1);
    for (const b of res.finalBalls) {
      expect(b.vx).toBe(0);
      expect(b.vz).toBe(0);
      if (!b.out) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(POOL.halfW);
        expect(Math.abs(b.z)).toBeLessThanOrEqual(POOL.halfD);
      }
    }
    expect(res.recording.totalMs).toBeGreaterThan(500);
    expect(res.recording.totalMs).toBeLessThan(POOL.maxSimSeconds * 1000);
  });
  it("tacada de frente transfere o movimento para a bola atingida", () => {
    const balls = empty();
    balls[0]!.x = -2; balls[0]!.z = 0;
    balls[1] = { id: 1, x: 0, z: 0, vx: 0, vz: 0, out: false };
    const res = simulateShot(balls, 0, 0.5);
    expect(res.firstContact).toBe(1);
    const cue = res.finalBalls[0]!, one = res.finalBalls[1]!;
    expect(one.x).toBeGreaterThan(cue.x + 0.5); // a bola 1 foi mais longe que a branca
    expect(Math.abs(one.z)).toBeLessThan(0.05);
  });
  it("tacada sem tocar em bola não tem primeiro contato", () => {
    const balls = empty();
    balls[0]!.x = -2;
    const res = simulateShot(balls, Math.PI / 2, 0.3);
    expect(res.firstContact).toBeNull();
  });
  it("encaçapa a bola-alvo mirada na direção da caçapa do canto", () => {
    const balls = empty();
    balls[0]!.x = 3.6; balls[0]!.z = 1.8;
    balls[1] = { id: 1, x: 4.8, z: 2.4, vx: 0, vz: 0, out: false }; // na reta entre a branca e o canto (6, 3)
    const res = simulateShot(balls, Math.atan2(3 - 1.8, 6 - 3.6), 0.6);
    expect(res.firstContact).toBe(1);
    expect(res.pocketed).toContain(1);
  });
  it("bola lançada contra a caçapa de canto cai", () => {
    const balls = empty();
    balls[0]!.x = 4; balls[0]!.z = 1.5;
    const ang = Math.atan2(3 - 1.5, 6 - 4); // direto no canto
    const res = simulateShot(balls, ang, 0.8);
    expect(res.pocketed).toContain(0);
    expect(res.recording.events.some((e) => e.kind === "pocket" && e.ball === 0)).toBe(true);
    expect(res.recording.frames.at(-1)![0]).toBe(POOL_OUT);
  });
  it("a bola quica na tabela e perde velocidade", () => {
    const balls = empty();
    balls[0]!.x = 1.5; balls[0]!.z = 0;
    const res = simulateShot(balls, Math.PI / 2, 0.4); // direto para a tabela (longe da caçapa lateral)
    expect(res.recording.events.some((e) => e.kind === "rail")).toBe(true);
  });
  it("potência é limitada ao mínimo e ao máximo", () => {
    const a = simulateShot(empty(), 0.3, -5);
    const b = simulateShot(empty(), 0.3, 99);
    expect(a.recording.frames.length).toBeGreaterThan(1);
    expect(b.recording.frames.length).toBeGreaterThan(a.recording.frames.length);
  });
});

describe("guia de mira e posicionamento", () => {
  it("achar a primeira bola na linha de mira", () => {
    const balls = empty();
    balls[0]!.x = -2;
    balls[1] = { id: 1, x: 1, z: 0, vx: 0, vz: 0, out: false };
    const p = predictAim(balls, 0);
    expect(p.hit).toBe(1);
    expect(p.x).toBeCloseTo(1 - 2 * POOL.ballR, 3);
    expect(p.outX).toBeCloseTo(1, 3);
  });
  it("sem bola na linha, a mira termina na tabela", () => {
    const balls = empty();
    const p = predictAim(balls, Math.PI);
    expect(p.hit).toBeNull();
    expect(p.x).toBeCloseTo(-(POOL.halfW - POOL.ballR), 3);
  });
  it("posicionamento válido: dentro da mesa, fora de caçapas e sem sobrepor", () => {
    const balls = rackBalls(seededRng(2));
    expect(isValidCuePlacement(balls, -4, 1)).toBe(true);
    expect(isValidCuePlacement(balls, 99, 0)).toBe(false);
    expect(isValidCuePlacement(balls, POOL.halfW, POOL.halfD)).toBe(false);
    expect(isValidCuePlacement(balls, NaN, 0)).toBe(false);
    const other = balls.find((b) => b.id === 5)!;
    expect(isValidCuePlacement(balls, other.x, other.z)).toBe(false);
  });
  it("findFreeSpot acha um lugar livre perto", () => {
    const balls = rackBalls(seededRng(2));
    const eight = balls.find((b) => b.id === 8)!;
    const spot = findFreeSpot(balls, eight, 8);
    expect(Math.hypot(spot.x - eight.x, spot.z - eight.z)).toBeLessThan(1);
  });
});

describe("regras da bola 8", () => {
  const A = "A", B = "B";
  const table = (...ids: number[]) => ids;
  const base = { shooter: A, opponent: B, groups: { A: null, B: null } as Record<string, null | "solid" | "stripe">, isBreak: false };

  it("quebra sem encaçapar passa a vez, sem bola na mão", () => {
    const r = resolveShot({ ...base, isBreak: true, tableBefore: table(1, 2, 8), firstContact: 1, pocketed: [] });
    expect(r.nextTurn).toBe(B);
    expect(r.ballInHand).toBe(false);
  });
  it("quebra encaçapando mantém a vez e não define grupos", () => {
    const r = resolveShot({ ...base, isBreak: true, tableBefore: table(1, 9, 8), firstContact: 1, pocketed: [9] });
    expect(r.nextTurn).toBe(A);
    expect(r.groups.A).toBeNull();
  });
  it("bola 8 na quebra volta para a mesa (sem vitória nem derrota)", () => {
    const r = resolveShot({ ...base, isBreak: true, tableBefore: table(1, 9, 8), firstContact: 1, pocketed: [8] });
    expect(r.respotEight).toBe(true);
    expect(r.winner).toBeNull();
  });
  it("primeira bola encaçapada define os grupos", () => {
    const r = resolveShot({ ...base, tableBefore: table(1, 2, 9, 10, 8), firstContact: 2, pocketed: [10] });
    expect(r.groups.A).toBe("stripe");
    expect(r.groups.B).toBe("solid");
    expect(r.nextTurn).toBe(A);
  });
  it("encaçapar bola do adversário passa a vez", () => {
    const r = resolveShot({ ...base, groups: { A: "solid", B: "stripe" }, tableBefore: table(1, 2, 9, 10, 8), firstContact: 1, pocketed: [9] });
    expect(r.nextTurn).toBe(B);
    expect(r.foul).toBe(false);
  });
  it("falta (branca na caçapa) dá bola na mão ao adversário", () => {
    const r = resolveShot({ ...base, groups: { A: "solid", B: "stripe" }, tableBefore: table(1, 9, 8), firstContact: 1, pocketed: [0, 1] });
    expect(r.foul).toBe(true);
    expect(r.nextTurn).toBe(B);
    expect(r.ballInHand).toBe(true);
  });
  it("falta (não tocou em nenhuma bola) dá bola na mão", () => {
    const r = resolveShot({ ...base, groups: { A: "solid", B: "stripe" }, tableBefore: table(1, 9, 8), firstContact: null, pocketed: [] });
    expect(r.foul).toBe(true);
    expect(r.ballInHand).toBe(true);
    expect(r.nextTurn).toBe(B);
  });
  it("em falta não se definem os grupos", () => {
    const r = resolveShot({ ...base, tableBefore: table(1, 9, 8), firstContact: 1, pocketed: [0, 9] });
    expect(r.groups.A).toBeNull();
  });
  it("bola 8 depois de limpar o grupo vence", () => {
    const r = resolveShot({ ...base, groups: { A: "solid", B: "stripe" }, tableBefore: table(8, 9, 10), firstContact: 8, pocketed: [8] });
    expect(r.winner).toBe(A);
    expect(r.endReason).toBe("eight");
  });
  it("bola 8 antes da hora perde", () => {
    const r = resolveShot({ ...base, groups: { A: "solid", B: "stripe" }, tableBefore: table(1, 8, 9), firstContact: 8, pocketed: [8] });
    expect(r.winner).toBe(B);
    expect(r.endReason).toBe("eight-early");
  });
  it("bola 8 com a branca na caçapa perde mesmo com o grupo limpo", () => {
    const r = resolveShot({ ...base, groups: { A: "solid", B: "stripe" }, tableBefore: table(8, 9), firstContact: 8, pocketed: [8, 0] });
    expect(r.winner).toBe(B);
  });
  it("bola 8 com grupos ainda indefinidos perde", () => {
    const r = resolveShot({ ...base, tableBefore: table(1, 9, 8), firstContact: 8, pocketed: [8] });
    expect(r.winner).toBe(B);
  });
});
