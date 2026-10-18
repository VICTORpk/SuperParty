import {
  CELL, DIRS, blockIndex, blockPlacementError, cellOf, connections, isBlock, isRamp, islands, keyOf, misfits, neighborCount,
  type BlockIndex,
} from "./grid";
import { MAP_KIND_DEFS, cleanProps, defaultProps, typeDef } from "./registry";
import { MAP_LIMITS, MAP_VERSION, cleanMapName, isMapKind, isValidMapId, makeMapId, type MapDoc, type MapKind, type MapObject, type PropValue } from "./schema";

/**
 * Operações puras e imutáveis sobre um `MapDoc`. Cada uma devolve o mapa novo ou o motivo da recusa; uma recusa
 * nunca altera nada (por isso desfazer/refazer e arrastar com segurança são triviais: basta guardar o documento).
 */

export type OpResult = { ok: true; map: MapDoc; id?: string } | { ok: false; error: string };
const fail = (error: string): OpResult => ({ ok: false, error });
const withObjects = (map: MapDoc, objects: MapObject[]): MapDoc => ({ ...map, objects, updatedAt: Date.now() });

export const snapFree = (v: number) => Math.round(v * 2) / 2;
const clampCoord = (v: number) => Math.min(MAP_LIMITS.maxCoord, Math.max(-MAP_LIMITS.maxCoord, v));
const clampLevel = (l: number) => Math.min(MAP_LIMITS.maxLevel, Math.max(0, Math.round(l)));

export function nextId(map: MapDoc): string {
  let max = 0;
  for (const o of map.objects) { const m = /^o(\d+)$/.exec(o.id); if (m) max = Math.max(max, Number(m[1])); }
  return `o${max + 1}`;
}

/** Giro válido: rampas só apontam para um dos 4 lados (passos pares); blocos planos não giram. */
function normRot(type: string, rot: number): number {
  const def = typeDef(type);
  const r = ((Math.round(rot) % 8) + 8) % 8;
  if (def?.placement === "block") return def.shape === "ramp" ? (r & 6) : 0;
  return r;
}

const SUPPORT_ERR = "Coloque este objeto sobre um bloco.";
export function hasSupport(idx: BlockIndex, x: number, z: number): boolean {
  return idx.has(keyOf(cellOf(x), cellOf(z)));
}

export interface ObjectSpec { type: string; x: number; z: number; level?: number; rot?: number; props?: Record<string, PropValue> }

export function addObject(map: MapDoc, spec: ObjectSpec): OpResult {
  const def = typeDef(spec.type);
  if (!def || !def.kinds.includes(map.kind)) return fail("Este objeto não existe neste tipo de mapa.");
  if (map.objects.length >= MAP_LIMITS.maxObjects) return fail(`Limite de ${MAP_LIMITS.maxObjects} objetos atingido.`);
  if (def.unique && map.objects.some((o) => o.type === def.id)) return fail(`Só pode haver um(a) ${def.label.toLowerCase()}.`);
  const idx = blockIndex(map);
  const rot = normRot(def.id, spec.rot ?? 0);
  let obj: MapObject;
  if (def.placement === "block") {
    obj = { id: nextId(map), type: def.id, x: cellOf(spec.x) * CELL, z: cellOf(spec.z) * CELL, level: clampLevel(spec.level ?? 0), rot, props: {} };
    const err = blockPlacementError(idx, obj);
    if (err) return fail(err);
  } else {
    obj = { id: nextId(map), type: def.id, x: clampCoord(snapFree(spec.x)), z: clampCoord(snapFree(spec.z)), level: 0, rot, props: { ...defaultProps(def), ...cleanProps(def, spec.props) } };
    if (!hasSupport(idx, obj.x, obj.z)) return fail(SUPPORT_ERR);
  }
  return { ok: true, map: withObjects(map, [...map.objects, obj]), id: obj.id };
}

const find = (map: MapDoc, id: string) => map.objects.find((o) => o.id === id);

/** Objetos livres que estão sobre a célula (ci, cj). */
function onCell(map: MapDoc, ci: number, cj: number): MapObject[] {
  return map.objects.filter((o) => !isBlock(o) && cellOf(o.x) === ci && cellOf(o.z) === cj);
}

export function removeObject(map: MapDoc, id: string): OpResult {
  const o = find(map, id);
  if (!o) return fail("Objeto não encontrado.");
  const drop = new Set([id]);
  if (isBlock(o)) for (const f of onCell(map, cellOf(o.x), cellOf(o.z))) drop.add(f.id); // o que estava em cima cai junto
  return { ok: true, map: withObjects(map, map.objects.filter((x) => !drop.has(x.id))) };
}

export function moveObject(map: MapDoc, id: string, x: number, z: number, opts: { level?: number; rot?: number } = {}): OpResult {
  const o = find(map, id);
  if (!o) return fail("Objeto não encontrado.");
  if (!isBlock(o)) {
    const nx = clampCoord(snapFree(x)), nz = clampCoord(snapFree(z));
    if (!hasSupport(blockIndex(map), nx, nz)) return fail(SUPPORT_ERR);
    return { ok: true, map: withObjects(map, map.objects.map((p) => (p.id === id ? { ...p, x: nx, z: nz, rot: normRot(p.type, opts.rot ?? p.rot) } : p))) };
  }
  const moved: MapObject = { ...o, x: cellOf(x) * CELL, z: cellOf(z) * CELL, level: clampLevel(opts.level ?? o.level), rot: normRot(o.type, opts.rot ?? o.rot) };
  const err = blockPlacementError(blockIndex(map, new Set([id])), moved);
  if (err) return fail(err);
  const dx = moved.x - o.x, dz = moved.z - o.z;
  const carried = new Set(onCell(map, cellOf(o.x), cellOf(o.z)).map((f) => f.id)); // levam o que está em cima
  return {
    ok: true,
    map: withObjects(map, map.objects.map((p) => (p.id === id ? moved : carried.has(p.id) ? { ...p, x: p.x + dx, z: p.z + dz } : p))),
  };
}

export function rotateObject(map: MapDoc, id: string): OpResult {
  const o = find(map, id);
  if (!o) return fail("Objeto não encontrado.");
  if (isBlock(o)) {
    if (!isRamp(o)) return { ok: true, map }; // blocos planos não têm frente
    return moveObject(map, id, o.x, o.z, { rot: o.rot + 2 });
  }
  return { ok: true, map: withObjects(map, map.objects.map((p) => (p.id === id ? { ...p, rot: normRot(p.type, p.rot + 1) } : p))) };
}

export function setLevel(map: MapDoc, id: string, level: number): OpResult {
  const o = find(map, id);
  if (!o || !isBlock(o)) return fail("Selecione um bloco.");
  return moveObject(map, id, o.x, o.z, { level });
}

export function setProp(map: MapDoc, id: string, key: string, value: PropValue): OpResult {
  const o = find(map, id);
  const def = o && typeDef(o.type);
  if (!o || !def) return fail("Objeto não encontrado.");
  const cleaned = cleanProps(def, { ...o.props, [key]: value });
  if (!(def.props ?? []).some((p) => p.key === key)) return fail("Propriedade desconhecida.");
  return { ok: true, map: withObjects(map, map.objects.map((p) => (p.id === id ? { ...p, props: cleaned } : p))) };
}

export function duplicateObject(map: MapDoc, id: string): OpResult {
  const o = find(map, id);
  if (!o) return fail("Objeto não encontrado.");
  const def = typeDef(o.type)!;
  if (def.unique) return fail(`Só pode haver um(a) ${def.label.toLowerCase()}.`);
  if (isBlock(o)) {
    const idx = blockIndex(map);
    const ci = cellOf(o.x), cj = cellOf(o.z);
    for (let r = 1; r <= 6; r++) {
      const cands: [number, number][] = [];
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r) cands.push([di, dj]);
      cands.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      for (const [di, dj] of cands) {
        const c = { ...o, x: (ci + di) * CELL, z: (cj + dj) * CELL };
        if (!blockPlacementError(idx, c) && neighborCount(idx, c) > 0) {
          return addObject(map, { type: o.type, x: c.x, z: c.z, level: o.level, rot: o.rot });
        }
      }
    }
    return fail("Não há espaço encaixável ao lado para duplicar o bloco.");
  }
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2]] as const) {
    const r = addObject(map, { type: o.type, x: o.x + dx, z: o.z + dz, rot: o.rot, props: o.props });
    if (r.ok) return r;
  }
  return fail("Não há bloco ao lado para colocar a cópia.");
}

// ---------------------------------------------------------------- ilhas

export function islandOf(map: MapDoc, blockId: string): string[] | null {
  return islands(map).find((g) => g.includes(blockId)) ?? null;
}

/** Move uma ilha inteira (blocos encaixados e o que está sobre eles) por (di, dj) células. */
export function moveIsland(map: MapDoc, blockId: string, di: number, dj: number): OpResult {
  const group = islandOf(map, blockId);
  if (!group) return fail("Selecione um bloco da ilha.");
  if (di === 0 && dj === 0) return { ok: true, map };
  const ids = new Set(group);
  const idx = blockIndex(map, ids);
  const cells = new Set<string>();
  const shifted = new Map<string, MapObject>();
  for (const o of map.objects) {
    if (!ids.has(o.id)) continue;
    cells.add(keyOf(cellOf(o.x), cellOf(o.z)));
    shifted.set(o.id, { ...o, x: o.x + di * CELL, z: o.z + dj * CELL });
  }
  for (const b of shifted.values()) { const err = blockPlacementError(idx, b); if (err) return fail(err); }
  const objects = map.objects.map((o) => {
    if (shifted.has(o.id)) return shifted.get(o.id)!;
    if (!isBlock(o) && cells.has(keyOf(cellOf(o.x), cellOf(o.z)))) return { ...o, x: o.x + di * CELL, z: o.z + dj * CELL };
    return o;
  });
  return { ok: true, map: withObjects(map, objects) };
}

const ringOffsets = (maxR: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let di = -maxR; di <= maxR; di++) for (let dj = -maxR; dj <= maxR; dj++) out.push([di, dj]);
  return out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
};

const joinedWithOthers = (map: MapDoc, blockId: string, groupSize: number) => (islandOf(map, blockId)?.length ?? 0) > groupSize;

/** Ao arrastar uma ilha: o deslocamento mais próximo de (di, dj) que encaixa em outra ilha; senão o próprio, se válido. */
export function bestIslandDelta(map: MapDoc, blockId: string, di: number, dj: number): { di: number; dj: number; connected: boolean } | null {
  const group = islandOf(map, blockId);
  if (!group) return null;
  let fallback: { di: number; dj: number; connected: boolean } | null = null;
  for (const [a, b] of ringOffsets(2)) {
    const r = moveIsland(map, blockId, di + a, dj + b);
    if (!r.ok) continue;
    if (joinedWithOthers(r.map, blockId, group.length)) return { di: di + a, dj: dj + b, connected: true };
    if (a === 0 && b === 0) fallback = { di, dj, connected: false };
  }
  return fallback;
}

/** Conectar: leva a ilha ao encaixe mais próximo em outra ilha. */
export function attachIsland(map: MapDoc, blockId: string): OpResult {
  const group = islandOf(map, blockId);
  if (!group) return fail("Selecione um bloco da ilha.");
  if (islands(map).length < 2) return fail("Não há outra ilha para conectar.");
  if (joinedWithOthers(map, blockId, group.length)) return fail("Esta ilha já está conectada a outra.");
  for (const [di, dj] of ringOffsets(14)) {
    const r = moveIsland(map, blockId, di, dj);
    if (r.ok && joinedWithOthers(r.map, blockId, group.length)) return r;
  }
  return fail("Nenhum encaixe compatível por perto (verifique níveis e rampas).");
}

/** Desconectar: tira o bloco selecionado (com o que está sobre ele) da ilha, levando-o ao ponto livre mais próximo sem vizinhos. */
export function detachBlock(map: MapDoc, blockId: string): OpResult {
  const o = find(map, blockId);
  if (!o || !isBlock(o)) return fail("Selecione um bloco.");
  const idx = blockIndex(map, new Set([blockId]));
  if (neighborCount(idx, o) === 0) return fail("Este bloco já está desconectado.");
  const ci = cellOf(o.x), cj = cellOf(o.z);
  for (const [di, dj] of ringOffsets(30)) {
    const c = { ...o, x: (ci + di) * CELL, z: (cj + dj) * CELL };
    if (blockPlacementError(idx, c) === null && neighborCount(idx, c) === 0) return moveObject(map, blockId, c.x, c.z);
  }
  return fail("Não há espaço livre por perto.");
}

// ---------------------------------------------------------------- encaixe ao arrastar/soltar

export interface Placement {
  x: number; z: number; level: number; rot: number;
  /** Cabe aqui (encaixado ou solto). */
  valid: boolean;
  /** Encosta e se encaixa em ao menos um bloco (a peça vira parte da ilha). */
  connected: boolean;
  error?: string;
}

/**
 * Onde um bloco do tipo `type` cairia se solto em (wx, wz): tenta os níveis e giros que encaixam nos vizinhos
 * (a rampa se vira sozinha para o lado certo) e prefere a opção conectada; se nada encaixa, solto (nova ilha) ou inválido.
 */
export function bestBlockPlacement(map: MapDoc, type: string, wx: number, wz: number, hint: { level?: number; rot?: number } = {}, ignoreId?: string): Placement {
  const def = typeDef(type);
  const idx = blockIndex(map, ignoreId ? new Set([ignoreId]) : undefined);
  const x = cellOf(wx) * CELL, z = cellOf(wz) * CELL;
  const level0 = clampLevel(hint.level ?? 0);
  const rot0 = normRot(type, hint.rot ?? 0);
  const levels = [level0, ...[0, 1, 2, 3].filter((l) => l !== level0 && l <= MAP_LIMITS.maxLevel)];
  const rots = def?.shape === "ramp" ? [rot0, ...[0, 2, 4, 6].filter((r) => r !== rot0)] : [0];
  for (const level of levels) for (const rot of rots) {
    const c = { type, x, z, level, rot };
    if (!blockPlacementError(idx, c) && neighborCount(idx, c) > 0) return { x, z, level, rot, valid: true, connected: true };
  }
  const hinted = { type, x, z, level: level0, rot: rot0 };
  const error = blockPlacementError(idx, hinted);
  return error ? { x, z, level: level0, rot: rot0, valid: false, connected: false, error } : { x, z, level: level0, rot: rot0, valid: true, connected: false };
}

// ---------------------------------------------------------------- documento

export function diagnose(map: MapDoc): string[] {
  const out = [...MAP_KIND_DEFS[map.kind].check(map)];
  const bad = misfits(map);
  if (bad.length) out.push(`${bad.length} encaixe(s) incompatível(is) entre blocos vizinhos.`);
  if (map.objects.length > MAP_LIMITS.maxObjects * 0.9) out.push("Perto do limite de objetos.");
  return out;
}

export function createMap(kind: MapKind, name: string, rand: () => number = Math.random): MapDoc {
  const now = Date.now();
  let map: MapDoc = { version: MAP_VERSION, id: makeMapId(name, rand), name: cleanMapName(name), kind, createdAt: now, updatedAt: now, objects: [] };
  const put = (spec: ObjectSpec) => { const r = addObject(map, spec); if (r.ok) map = r.map; };
  const strip = (n: number) => { for (let i = 0; i < n; i++) put({ type: "grass", x: i * CELL, z: 0 }); };
  if (kind === "islands") {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) put({ type: "grass", x: i * CELL, z: j * CELL });
    put({ type: "spawn", x: 0, z: 0 });
    put({ type: "pine", x: 3, z: 3 });
  } else if (kind === "board") {
    strip(6);
    put({ type: "start", x: 0, z: 0 });
    for (let i = 1; i < 5; i++) put({ type: "tile", x: i * CELL, z: 0 });
    put({ type: "finish", x: 5 * CELL, z: 0 });
  } else {
    strip(5);
    put({ type: "tee", x: 0, z: 0 });
    put({ type: "hole", x: 4 * CELL, z: 0 });
  }
  return map;
}

export type ParseResult = { ok: true; map: MapDoc; warnings: string[] } | { ok: false; error: string };

/** Migrações por versão de origem: `MIGRATIONS[n]` converte um documento da versão n para n+1. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Lê um documento vindo do disco/rede sem confiar nele: descarta o que é inválido (e conta nos avisos),
 * corrige valores fora dos limites e migra versões antigas. Nunca lança.
 */
export function parseMap(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "O arquivo do mapa não é um objeto JSON." };
  let raw = input as Record<string, unknown>;
  let version = typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : 1;
  if (version > MAP_VERSION) return { ok: false, error: `Mapa criado por uma versão mais nova do editor (v${version}; esta lê até v${MAP_VERSION}).` };
  while (version < MAP_VERSION) { raw = MIGRATIONS[version]?.(raw) ?? raw; version++; }
  if (!isValidMapId(raw.id)) return { ok: false, error: "Mapa sem identificador válido." };
  if (!isMapKind(raw.kind)) return { ok: false, error: "Tipo de mapa desconhecido." };
  const warnings: string[] = [];
  let map: MapDoc = {
    version: MAP_VERSION, id: raw.id, name: cleanMapName(raw.name), kind: raw.kind,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(), updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(), objects: [],
  };
  const list = Array.isArray(raw.objects) ? raw.objects : [];
  const seen = new Set<string>();
  let dropped = 0;
  const free: MapObject[] = [];
  const blocks: MapObject[] = [];
  for (const r of list.slice(0, MAP_LIMITS.maxObjects)) {
    const o = r as Partial<MapObject> | null;
    const def = o && typeof o.type === "string" ? typeDef(o.type) : undefined;
    if (!o || !def || !def.kinds.includes(map.kind) || typeof o.x !== "number" || typeof o.z !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.z)) { dropped++; continue; }
    const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(o.id) && !seen.has(o.id) ? o.id : `o${seen.size + list.length + 1}`;
    seen.add(id);
    const obj: MapObject = {
      id, type: def.id,
      x: def.placement === "block" ? cellOf(clampCoord(o.x)) * CELL : clampCoord(snapFree(o.x)),
      z: def.placement === "block" ? cellOf(clampCoord(o.z)) * CELL : clampCoord(snapFree(o.z)),
      level: def.placement === "block" ? clampLevel(typeof o.level === "number" ? o.level : 0) : 0,
      rot: normRot(def.id, typeof o.rot === "number" && Number.isFinite(o.rot) ? o.rot : 0),
      props: def.placement === "free" ? cleanProps(def, o.props) : {},
    };
    (def.placement === "block" ? blocks : free).push(obj);
  }
  // sobreposição de blocos na mesma célula: fica o primeiro
  const cells = new Set<string>();
  const keptBlocks = blocks.filter((b) => { const k = keyOf(cellOf(b.x), cellOf(b.z)); if (cells.has(k)) { dropped++; return false; } cells.add(k); return true; });
  const uniq = new Set<string>();
  const keptFree = free.filter((f) => {
    if (!cells.has(keyOf(cellOf(f.x), cellOf(f.z)))) { dropped++; return false; } // flutuando sem bloco embaixo
    if (typeDef(f.type)!.unique) { if (uniq.has(f.type)) { dropped++; return false; } uniq.add(f.type); }
    return true;
  });
  map = { ...map, objects: [...keptBlocks, ...keptFree] };
  if (dropped) warnings.push(`${dropped} objeto(s) inválido(s) foram descartados ao carregar.`);
  if (list.length > MAP_LIMITS.maxObjects) warnings.push(`Mapa cortado em ${MAP_LIMITS.maxObjects} objetos.`);
  return { ok: true, map, warnings };
}

/** Compara o conteúdo editável (ignora a data de atualização) para saber se há alterações não salvas. */
export function sameContent(a: MapDoc, b: MapDoc): boolean {
  return a.id === b.id && a.name === b.name && a.kind === b.kind && JSON.stringify(a.objects) === JSON.stringify(b.objects);
}

export { connections };
