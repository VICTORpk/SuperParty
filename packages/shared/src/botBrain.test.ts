import { describe, expect, it } from "vitest";
import { BOT_CONFIG, newBot, nearestTarget, stepBot } from "./botBrain";
import { resolveCollisions } from "./lobbyWorld";

const rng = (() => { let s = 5; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const free = (x: number, z: number) => ({ x, z });

describe("botBrain", () => {
  it("aproxima-se do jogador e para a uma distância educada, acenando uma vez", () => {
    const bot = newBot(0, 0);
    const target = { x: 10, z: 0 };
    let waves = 0;
    for (let t = 0; t < 8000; t += 100) if (stepBot(bot, target, 100, t, rng, free).wave) waves++;
    const d = Math.hypot(target.x - bot.x, target.z - bot.z);
    expect(d).toBeLessThanOrEqual(BOT_CONFIG.stopDistance + 0.4);
    expect(d).toBeGreaterThan(BOT_CONFIG.stopDistance - 0.8);
    expect(waves).toBeGreaterThanOrEqual(1);
    expect(waves).toBeLessThanOrEqual(2);
  });

  it("sem jogador, passeia sem sair do mundo nem entrar em objetos sólidos do lobby", () => {
    const bot = newBot(6, 6);
    for (let t = 0; t < 120_000; t += 100) {
      stepBot(bot, null, 100, t, rng, resolveCollisions);
      const r = resolveCollisions(bot.x, bot.z);
      expect(Math.hypot(r.x - bot.x, r.z - bot.z)).toBeLessThan(1e-6);
    }
  });

  it("contorna um obstáculo quando o caminho direto está bloqueado", () => {
    const wall = (x: number, z: number) => (Math.abs(x - 3) < 0.4 && Math.abs(z) < 2 ? { x: 2.6, z } : { x, z });
    const bot = newBot(0, 0);
    for (let t = 0; t < 30_000; t += 100) stepBot(bot, { x: 8, z: 0 }, 100, t, rng, wall);
    expect(Math.hypot(8 - bot.x, bot.z)).toBeLessThan(BOT_CONFIG.stopDistance + 0.5);
  });

  it("nearestTarget escolhe o mais próximo", () => {
    expect(nearestTarget(0, 0, [{ x: 5, z: 0 }, { x: 1, z: 1 }])).toEqual({ x: 1, z: 1 });
    expect(nearestTarget(0, 0, [])).toBeNull();
  });
});
