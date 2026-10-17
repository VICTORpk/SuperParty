import { describe, expect, it } from "vitest";
import { GAMES, WORLD_RADIUS, spawnPoint } from "@jogo/shared";
import { BRIDGE, COLLIDERS, HUT, PINES, POND, resolveCollisions } from "./lobbyLayout";

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("colisões do lobby", () => {
  it("o personagem não entra no tronco de um pinheiro", () => {
    const p = PINES[0]!;
    const out = resolveCollisions(p.x + 0.05, p.z);
    expect(dist(out, p)).toBeGreaterThanOrEqual(0.38 * p.scale + 0.1 + 0.45 - 1e-6);
  });

  it("a casinha é sólida", () => {
    const out = resolveCollisions(HUT.x, HUT.z);
    expect(dist(out, HUT)).toBeGreaterThan(1.5);
  });

  it("as mesas das estações são sólidas", () => {
    for (const g of Object.values(GAMES)) {
      const out = resolveCollisions(g.station.x, g.station.z);
      expect(dist(out, g.station)).toBeGreaterThan(1.5);
    }
  });

  it("o lago só pode ser atravessado pela ponte", () => {
    // fora da ponte (z = 2.5) o personagem é empurrado para fora do lago
    const side = resolveCollisions(0, 2.5);
    expect(Math.hypot(side.x, side.z)).toBeGreaterThanOrEqual(POND.radius + 0.45 - 1e-6);
    // sobre a ponte (z = 0) ele passa normalmente
    const bridge = resolveCollisions(0.5, 0);
    expect(bridge.x).toBeCloseTo(0.5, 5);
    expect(bridge.z).toBeCloseTo(0, 5);
  });

  it("não dá para sair pelos lados da ponte", () => {
    const out = resolveCollisions(0, BRIDGE.halfWidth + 0.5);
    expect(Math.abs(out.z)).toBeGreaterThan(0.9); // ou volta para a ponte, ou fica fora do lago
    expect(Math.hypot(out.x, out.z) >= POND.radius + 0.45 - 1e-6 || Math.abs(out.z) <= BRIDGE.halfWidth).toBe(true);
  });

  it("os jogadores não nascem dentro de objetos nem do lago", () => {
    for (let i = 0; i < 10; i++) {
      const s = spawnPoint(i);
      const out = resolveCollisions(s.x, s.z);
      expect(dist(out, s)).toBeLessThan(0.05);
    }
  });

  it("o mundo continua limitado ao raio da ilha", () => {
    const out = resolveCollisions(100, 100);
    expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(WORLD_RADIUS + 1e-6);
  });

  it("existe um conjunto razoável de colisores", () => {
    expect(COLLIDERS.length).toBeGreaterThan(40);
  });
});
