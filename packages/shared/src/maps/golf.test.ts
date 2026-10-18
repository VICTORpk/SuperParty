import { describe, expect, it } from "vitest";
import { GOLF, isResting, stepBall, strike, type GolfBall, type GolfWorld } from "./golf";

const flat = (extra: Partial<GolfWorld> = {}): GolfWorld => ({
  surface: (x, z) => (Math.abs(x) <= 10 && Math.abs(z) <= 4 ? 0 : null), walls: [], bumpers: [], hole: null, ...extra,
});
const run = (b: GolfBall, w: GolfWorld, seconds = 20) => {
  let ev: ReturnType<typeof stepBall> = "none";
  for (let t = 0; t < seconds && ev === "none" && !isResting(b); t += 1 / 60) ev = stepBall(b, 1 / 60, w);
  return ev;
};

describe("golf", () => {
  it("a bola desacelera até parar, na direção da tacada", () => {
    const b = strike({ x: -5, z: 0, vx: 0, vz: 0 }, Math.PI / 2, 0.4);
    expect(run(b, flat())).toBe("none");
    expect(isResting(b)).toBe(true);
    expect(b.x).toBeGreaterThan(-5);
    expect(Math.abs(b.z)).toBeLessThan(1e-6);
  });

  it("quica na parede e volta", () => {
    const wall = { x: 2, z: 0, halfLen: 3, halfThick: 0.15, angle: Math.PI / 2 }; // parede vertical em x = 2
    const b = strike({ x: -3, z: 0, vx: 0, vz: 0 }, Math.PI / 2, 0.7);
    run(b, flat({ walls: [wall] }));
    expect(b.x).toBeLessThan(2 - 0.15 - GOLF.radius + 1e-3); // nunca atravessa
    expect(b.x).toBeGreaterThan(-9);
  });

  it("quicar num pino muda a direção", () => {
    const b = strike({ x: -3, z: 0.1, vx: 0, vz: 0 }, Math.PI / 2, 0.6);
    run(b, flat({ bumpers: [{ x: 0, z: 0, r: 0.6 }] }), 3);
    expect(Math.abs(b.z)).toBeGreaterThan(0.1);
  });

  it("sair do mapa é detectado", () => {
    const b = strike({ x: 8, z: 0, vx: 0, vz: 0 }, Math.PI / 2, 1);
    expect(run(b, flat())).toBe("out");
  });

  it("cai no buraco se passar devagar; passa direto se estiver rápida demais", () => {
    const slow = strike({ x: -2, z: 0, vx: 0, vz: 0 }, Math.PI / 2, 0.3);
    expect(run(slow, flat({ hole: { x: 1, z: 0 } }))).toBe("sunk");
    const fast = strike({ x: -2, z: 0, vx: 0, vz: 0 }, Math.PI / 2, 1);
    expect(run(fast, flat({ hole: { x: 1, z: 0 } }), 0.2)).toBe("none");
  });

  it("um buraco a 16 unidades da saída é alcançável com alguma força (e há uma faixa de forças que encaçapa)", () => {
    const wide: GolfWorld = { surface: (x, z) => (x >= -1 && x <= 20 && Math.abs(z) <= 2 ? 0 : null), walls: [], bumpers: [], hole: { x: 16, z: 0 } };
    const sunk: number[] = [];
    for (let p = 0.2; p <= 1; p += 0.02) {
      const b = strike({ x: 0, z: 0, vx: 0, vz: 0 }, Math.PI / 2, p);
      if (run(b, wide, 30) === "sunk") sunk.push(p);
    }
    expect(sunk.length).toBeGreaterThanOrEqual(3);
  });

  it("a bola rola ladeira abaixo", () => {
    const hill: GolfWorld = { surface: (x, z) => (Math.abs(x) <= 10 && Math.abs(z) <= 4 ? Math.max(0, 1.5 - (x + 10) * 0.375) : null), walls: [], bumpers: [], hole: null };
    const b: GolfBall = { x: -9, z: 0, vx: 0, vz: 0 };
    for (let i = 0; i < 120; i++) stepBall(b, 1 / 60, hill);
    expect(b.x).toBeGreaterThan(-9); // desceu (alturas decrescem com x)
  });

  it("nunca produz NaN em tacadas aleatórias", () => {
    let s = 3; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 200; i++) {
      const b = strike({ x: r() * 4 - 2, z: r() * 2 - 1, vx: 0, vz: 0 }, r() * 6.28, r());
      run(b, flat({ walls: [{ x: 0, z: 1.5, halfLen: 3, halfThick: 0.15, angle: r() * 3 }], bumpers: [{ x: 1, z: 0, r: 0.5 }], hole: { x: 5, z: 0 } }), 10);
      expect(Number.isFinite(b.x) && Number.isFinite(b.z)).toBe(true);
    }
  });
});
