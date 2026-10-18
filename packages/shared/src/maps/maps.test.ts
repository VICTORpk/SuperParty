import { describe, expect, it } from "vitest";
import {
  CELL, MAP_LIMITS, MAP_VERSION, addObject, attachIsland, bestBlockPlacement, bestIslandDelta, blockIndex, commit, connections, createMap, detachBlock, diagnose,
  duplicateObject, islands, misfits, moveIsland, moveObject, newHistory, parseMap, redo, removeObject, rotateObject, sameContent, setLevel, setProp, surfaceHeight, undo,
  type MapDoc, type OpResult,
} from "../index";

const rand = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ok = (r: OpResult): MapDoc => { if (!r.ok) throw new Error(r.error); return r.map; };
const empty = (kind: MapDoc["kind"] = "islands"): MapDoc => ({ ...createMap(kind, "t", rand(1)), objects: [] });
const add = (m: MapDoc, type: string, ci: number, cj: number, extra: { level?: number; rot?: number } = {}) => ok(addObject(m, { type, x: ci * CELL, z: cj * CELL, ...extra }));

/** Invariantes que NENHUMA sequência de operações pode quebrar. */
function assertConsistent(m: MapDoc) {
  const ids = m.objects.map((o) => o.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(m.objects.length).toBeLessThanOrEqual(MAP_LIMITS.maxObjects);
  const cells = m.objects.filter((o) => ["grass", "sand", "snow", "stone", "ramp"].includes(o.type)).map((o) => `${o.x},${o.z}`);
  expect(new Set(cells).size).toBe(cells.length); // um bloco por célula
  expect(misfits(m)).toEqual([]); // nenhum encaixe inválido
  const idx = blockIndex(m);
  for (const o of m.objects) if (!["grass", "sand", "snow", "stone", "ramp"].includes(o.type)) expect(surfaceHeight(idx, o.x, o.z)).not.toBeNull(); // nada flutuando
  // toda conexão liga dois blocos que existem
  const exist = new Set(ids);
  for (const c of connections(m)) { expect(exist.has(c.a)).toBe(true); expect(exist.has(c.b)).toBe(true); }
}

describe("blocos e encaixe", () => {
  it("blocos vizinhos no mesmo nível se conectam e formam uma ilha maior", () => {
    let m = add(empty(), "grass", 0, 0);
    m = add(m, "grass", 1, 0);
    m = add(m, "sand", 1, 1);
    expect(connections(m)).toHaveLength(2);
    expect(islands(m)).toHaveLength(1);
    expect(islands(m)[0]).toHaveLength(3);
  });

  it("bloco solto longe vira uma ilha separada", () => {
    const m = add(add(empty(), "grass", 0, 0), "grass", 5, 5);
    expect(islands(m)).toHaveLength(2);
  });

  it("recusa bloco na célula ocupada e blocos de níveis diferentes lado a lado", () => {
    const m = add(empty(), "grass", 0, 0);
    expect(addObject(m, { type: "grass", x: 0, z: 0 }).ok).toBe(false);
    const r = addObject(m, { type: "grass", x: CELL, z: 0, level: 1 });
    expect(r.ok).toBe(false);
    expect(m.objects).toHaveLength(1); // nada mudou
  });

  it("rampa liga nível 0 ao nível 1 pelas pontas, mas não pelas laterais", () => {
    let m = add(empty(), "grass", 0, 0);
    m = add(m, "ramp", 1, 0, { rot: 2 }); // sobe para +x, pé em −x (encosta no bloco de nível 0)
    m = add(m, "grass", 2, 0, { level: 1 }); // topo da rampa encosta no nível 1
    expect(islands(m)).toHaveLength(1);
    expect(addObject(m, { type: "grass", x: CELL, z: CELL }).ok).toBe(false); // lateral da rampa
    expect(addObject(m, { type: "grass", x: 2 * CELL, z: 0, level: 0 }).ok).toBe(false); // célula ocupada
    expect(addObject(empty(), { type: "tee", x: 0, z: 0 }).ok).toBe(false); // tipo de outro mapa
  });

  it("a rampa se vira sozinha para encaixar (bestBlockPlacement)", () => {
    const m = add(empty(), "grass", 0, 0, { level: 1 });
    const p = bestBlockPlacement(m, "ramp", CELL, 0, { level: 0, rot: 0 });
    expect(p.valid && p.connected).toBe(true);
    expect(add(m, "ramp", 1, 0, { level: p.level, rot: p.rot }).objects).toHaveLength(2);
    const lone = bestBlockPlacement(m, "ramp", 10 * CELL, 10 * CELL);
    expect(lone.valid).toBe(true);
    expect(lone.connected).toBe(false);
    const bad = bestBlockPlacement(m, "grass", 0, 0);
    expect(bad.valid).toBe(false);
    expect(bad.error).toBeTruthy();
  });

  it("altura da superfície: nível e rampa linear", () => {
    let m = add(empty(), "grass", 0, 0);
    m = add(m, "ramp", 1, 0, { rot: 2 });
    const idx = blockIndex(m);
    expect(surfaceHeight(idx, 0, 0)).toBe(0);
    expect(surfaceHeight(idx, CELL - CELL / 2, 0)).toBeCloseTo(0);
    expect(surfaceHeight(idx, CELL + CELL / 2 - 0.01, 0)).toBeCloseTo(1.5, 1);
    expect(surfaceHeight(idx, 50, 50)).toBeNull();
  });
});

describe("objetos livres, mover, duplicar, excluir", () => {
  it("objetos só ficam sobre blocos; mover um bloco leva o que está em cima; excluir derruba junto", () => {
    let m = add(empty(), "grass", 0, 0);
    expect(addObject(m, { type: "pine", x: 30, z: 30 }).ok).toBe(false);
    m = ok(addObject(m, { type: "pine", x: 1, z: 1 }));
    const pine = m.objects.find((o) => o.type === "pine")!;
    const block = m.objects.find((o) => o.type === "grass")!;
    m = ok(moveObject(m, block.id, 3 * CELL, 0));
    expect(m.objects.find((o) => o.id === pine.id)).toMatchObject({ x: 3 * CELL + 1, z: 1 });
    assertConsistent(m);
    m = ok(removeObject(m, block.id));
    expect(m.objects).toHaveLength(0);
  });

  it("tipos únicos: só um ponto de partida", () => {
    let m = add(empty(), "grass", 0, 0);
    m = ok(addObject(m, { type: "spawn", x: 0, z: 0 }));
    expect(addObject(m, { type: "spawn", x: 1, z: 0 }).ok).toBe(false);
    const sp = m.objects.find((o) => o.type === "spawn")!;
    expect(duplicateObject(m, sp.id).ok).toBe(false);
  });

  it("duplicar bloco coloca a cópia encaixada ao lado; duplicar objeto livre mantém as propriedades", () => {
    let m = add(empty("minigolf"), "grass", 0, 0);
    m = add(m, "grass", 1, 0);
    m = ok(addObject(m, { type: "wall", x: 0, z: 0, props: { length: 5 } }));
    const wall = m.objects.find((o) => o.type === "wall")!;
    const dup = ok(duplicateObject(m, wall.id));
    expect(dup.objects.filter((o) => o.type === "wall")).toHaveLength(2);
    expect(dup.objects.filter((o) => o.type === "wall").every((o) => o.props.length === 5)).toBe(true);
    const g = m.objects.find((o) => o.type === "grass")!;
    const d2 = ok(duplicateObject(m, g.id));
    expect(d2.objects.filter((o) => o.type === "grass")).toHaveLength(3);
    assertConsistent(d2);
    expect(islands(d2)).toHaveLength(1);
  });

  it("propriedades são validadas e limitadas pelo esquema do tipo", () => {
    let m = add(empty("minigolf"), "grass", 0, 0);
    m = ok(addObject(m, { type: "wall", x: 0, z: 0 }));
    const w = m.objects.find((o) => o.type === "wall")!;
    expect(ok(setProp(m, w.id, "length", 999)).objects.find((o) => o.id === w.id)!.props.length).toBe(8);
    expect(ok(setProp(m, w.id, "length", "abc" as never)).objects.find((o) => o.id === w.id)!.props.length).toBe(3);
    expect(setProp(m, w.id, "inexistente", 1).ok).toBe(false);
  });

  it("girar: rampas giram de 90° validando o encaixe; objetos livres de 45°", () => {
    let m = add(empty(), "grass", 0, 0);
    m = add(m, "ramp", 1, 0, { rot: 2 });
    const ramp = m.objects.find((o) => o.type === "ramp")!;
    expect(rotateObject(m, ramp.id).ok).toBe(false); // girar quebraria o encaixe com o bloco ao lado
    m = ok(addObject(m, { type: "pine", x: 0, z: 0 }));
    const pine = m.objects.find((o) => o.type === "pine")!;
    expect(ok(rotateObject(m, pine.id)).objects.find((o) => o.id === pine.id)!.rot).toBe(1);
  });

  it("subir o nível de um bloco só é aceito se continuar encaixando", () => {
    let m = add(add(empty(), "grass", 0, 0), "grass", 1, 0);
    const b = m.objects[1]!;
    expect(setLevel(m, b.id, 1).ok).toBe(false);
    m = add(empty(), "grass", 0, 0);
    expect(ok(setLevel(m, m.objects[0]!.id, 2)).objects[0]!.level).toBe(2);
  });

  it("respeita o limite de objetos", () => {
    let m = empty();
    m = { ...m, objects: Array.from({ length: MAP_LIMITS.maxObjects }, (_, i) => ({ id: `o${i + 1}`, type: "pine", x: 0, z: 0, level: 0, rot: 0, props: {} })) };
    expect(addObject(m, { type: "grass", x: 0, z: 0 }).ok).toBe(false);
  });
});

describe("ilhas: mover, conectar, desconectar", () => {
  const twoIslands = () => {
    let m = empty();
    for (let i = 0; i < 3; i++) m = add(m, "grass", i, 0);
    for (let i = 0; i < 2; i++) m = add(m, "sand", 8 + i, 0);
    return m;
  };

  it("mover uma ilha inteira mantém as posições relativas e leva o cenário junto", () => {
    let m = ok(addObject(twoIslands(), { type: "pine", x: 0, z: 0 }));
    const first = m.objects[0]!;
    const before = m.objects.map((o) => ({ dx: o.x - first.x, dz: o.z - first.z, id: o.id }));
    const moved = ok(moveIsland(m, first.id, 0, 3));
    const newFirst = moved.objects.find((o) => o.id === first.id)!;
    for (const b of before.filter((_, i) => i < 3 || m.objects[i]!.type === "pine")) {
      const o = moved.objects.find((x) => x.id === b.id)!;
      expect(o.x - newFirst.x).toBe(b.dx);
      expect(o.z - newFirst.z).toBe(b.dz);
    }
    assertConsistent(moved);
  });

  it("mover uma ilha sobre outra é recusado e nada muda", () => {
    const m = twoIslands();
    const r = moveIsland(m, m.objects[0]!.id, 8, 0);
    expect(r.ok).toBe(false);
  });

  it("conectar leva a ilha ao encaixe e desconectar tira um bloco da ilha", () => {
    const m = twoIslands();
    expect(islands(m)).toHaveLength(2);
    const a = m.objects[0]!;
    const joined = ok(attachIsland(m, a.id));
    expect(islands(joined)).toHaveLength(1);
    assertConsistent(joined);
    const apart = ok(detachBlock(joined, a.id)); // tira um bloco da ilha
    expect(islands(apart)).toHaveLength(2);
    assertConsistent(apart);
    expect(detachBlock(apart, a.id).ok).toBe(false); // já está sozinho
    expect(ok(attachIsland(apart, a.id)).objects).toHaveLength(m.objects.length);
  });

  it("arrastar uma ilha perto de outra encaixa; longe fica solta", () => {
    const m = twoIslands();
    const a = m.objects[0]!;
    const near = bestIslandDelta(m, a.id, 4, 0)!; // ilha de 3 blocos (0..2) para 4..6; a outra começa em 8 → encaixa em 5..7
    expect(near.connected).toBe(true);
    const far = bestIslandDelta(m, a.id, 0, 10)!;
    expect(far.connected).toBe(false);
    expect(bestIslandDelta(m, a.id, 8, 0)).not.toBeNull(); // sobreposição: acha um deslocamento vizinho válido
  });
});

describe("desfazer/refazer", () => {
  it("volta e avança sem corromper o mapa", () => {
    let h = newHistory(add(empty(), "grass", 0, 0));
    h = commit(h, add(h.present, "grass", 1, 0));
    h = commit(h, add(h.present, "sand", 2, 0));
    expect(h.present.objects).toHaveLength(3);
    h = undo(h);
    expect(h.present.objects).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present.objects).toHaveLength(1);
    h = redo(h);
    expect(h.present.objects).toHaveLength(2);
    h = commit(h, add(h.present, "stone", 5, 5)); // nova edição descarta o "refazer"
    expect(redo(h)).toBe(h);
    assertConsistent(h.present);
  });
});

describe("salvar, carregar e dados inválidos", () => {
  it("round-trip preserva objetos, propriedades, posições e conexões", () => {
    let m = createMap("minigolf", "Meu campo", rand(3));
    m = ok(addObject(m, { type: "wall", x: 4, z: 0, rot: 2, props: { length: 4.5, height: 1.2 } }));
    const parsed = parseMap(JSON.parse(JSON.stringify(m)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(sameContent(parsed.map, m)).toBe(true);
    expect(connections(parsed.map)).toEqual(connections(m));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.map.version).toBe(MAP_VERSION);
  });

  it.each([null, 42, "x", [], {}, { id: "../x", kind: "islands" }, { id: "ok", kind: "nada" }])("entrada inválida %j não derruba o carregamento", (raw) => {
    expect(parseMap(raw).ok).toBe(false);
  });

  it("descarta objetos inválidos e corrige valores, sem lançar", () => {
    const r = parseMap({
      version: 1, id: "teste", name: "  ", kind: "minigolf",
      objects: [
        { id: "a", type: "grass", x: 0, z: 0, level: 99, rot: 5 },
        { id: "a", type: "grass", x: 0.4, z: 0, level: 0, rot: 0 }, // mesma célula
        { id: "b", type: "naoexiste", x: 0, z: 0 },
        { id: "c", type: "pine", x: 0, z: 0 }, // tipo de outro mapa
        { id: "d", type: "wall", x: 0, z: 0, props: { length: 1e9, lixo: 1 } },
        { id: "e", type: "wall", x: 100, z: 100 }, // sem bloco embaixo
        { id: "f", type: "tee", x: NaN, z: 0 },
        null, 5, "x",
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.map.name).toBe("Mapa sem nome");
    expect(r.map.objects.find((o) => o.type === "grass")!.level).toBe(MAP_LIMITS.maxLevel);
    expect(r.map.objects.find((o) => o.type === "wall")!.props).toEqual({ length: 8, height: 0.8 });
    expect(r.map.objects.filter((o) => o.type === "grass")).toHaveLength(1);
    expect(r.map.objects.some((o) => ["naoexiste", "pine", "tee"].includes(o.type))).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
    assertConsistent(r.map);
  });

  it("recusa mapas de uma versão futura e aceita sem versão (v1)", () => {
    expect(parseMap({ version: 99, id: "x", kind: "islands", objects: [] }).ok).toBe(false);
    expect(parseMap({ id: "x", kind: "islands", objects: [] }).ok).toBe(true);
  });

  it("mapas criados do zero são válidos nos três tipos e sem avisos", () => {
    for (const kind of ["islands", "board", "minigolf"] as const) {
      const m = createMap(kind, `Novo ${kind}`, rand(9));
      assertConsistent(m);
      expect(diagnose(m)).toEqual([]);
    }
    expect(diagnose(empty("board")).length).toBeGreaterThan(0);
  });

  it("um mapa novo não altera os outros (documentos independentes)", () => {
    const a = createMap("islands", "A", rand(1));
    const snapshot = JSON.stringify(a);
    const b = createMap("islands", "B", rand(2));
    ok(addObject(b, { type: "grass", x: 40, z: 40 }));
    expect(JSON.stringify(a)).toBe(snapshot);
    expect(a.id).not.toBe(b.id);
  });
});

describe("robustez: sequências aleatórias de operações nunca deixam o mapa inconsistente", () => {
  it.each([1, 2, 3, 4, 5])("semente %i", (seed) => {
    const r = rand(seed * 977);
    const kind = (["islands", "board", "minigolf"] as const)[seed % 3]!;
    let m = createMap(kind, "fuzz", r);
    const types = ["grass", "sand", "stone", "snow", "ramp", "pine", "rock", "tile", "wall", "bumper", "flower", "bot-spawn"];
    for (let i = 0; i < 400; i++) {
      const pick = r();
      const ids = m.objects.map((o) => o.id);
      const id = ids[Math.floor(r() * ids.length)] ?? "x";
      const cell = () => Math.floor(r() * 9) - 4;
      let res: OpResult;
      if (pick < 0.4) res = addObject(m, { type: types[Math.floor(r() * types.length)]!, x: cell() * CELL + r() * 3, z: cell() * CELL + r() * 3, level: Math.floor(r() * 4), rot: Math.floor(r() * 8) });
      else if (pick < 0.55) res = moveObject(m, id, cell() * CELL, cell() * CELL, { level: Math.floor(r() * 4) });
      else if (pick < 0.65) res = removeObject(m, id);
      else if (pick < 0.72) res = duplicateObject(m, id);
      else if (pick < 0.78) res = rotateObject(m, id);
      else if (pick < 0.84) res = moveIsland(m, id, Math.floor(r() * 7) - 3, Math.floor(r() * 7) - 3);
      else if (pick < 0.9) res = attachIsland(m, id);
      else if (pick < 0.95) res = detachBlock(m, id);
      else res = setLevel(m, id, Math.floor(r() * 4));
      const before = JSON.stringify(m.objects);
      if (res.ok) m = res.map;
      else expect(JSON.stringify(m.objects)).toBe(before); // recusa não muda nada
      assertConsistent(m);
    }
    expect(parseMap(JSON.parse(JSON.stringify(m))).ok).toBe(true);
  }, 60_000);
});
