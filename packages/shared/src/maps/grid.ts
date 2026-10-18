import { MAP_LIMITS, type MapDoc, type MapObject } from "./schema";
import { typeDef } from "./registry";

/** Grade dos blocos: regras de encaixe, conexões e ilhas. Tudo derivado das posições (nada é gravado à parte). */

export const CELL = 4;
/** Altura de cada nível de terreno (uma rampa sobe exatamente um nível). */
export const LEVEL_H = 1.5;

/** Direções da grade: 0 = +z, 1 = +x, 2 = −z, 3 = −x. */
export const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export const cellOf = (v: number) => Math.round(v / CELL);
export const keyOf = (ci: number, cj: number) => `${ci},${cj}`;

export function isBlock(o: MapObject): boolean {
  return typeDef(o.type)?.placement === "block";
}
export function isRamp(o: MapObject): boolean {
  return typeDef(o.type)?.shape === "ramp";
}
/** Lado para onde a rampa sobe (0..3). */
export function rampDir(o: MapObject): number {
  return ((o.rot >> 1) & 3);
}

export type BlockIndex = Map<string, MapObject>;

export function blockIndex(map: MapDoc, ignore?: ReadonlySet<string>): BlockIndex {
  const idx: BlockIndex = new Map();
  for (const o of map.objects) if (isBlock(o) && !ignore?.has(o.id)) idx.set(keyOf(cellOf(o.x), cellOf(o.z)), o);
  return idx;
}

/** Nível de altura que o bloco apresenta no lado `dir`, ou null se esse lado não pode ser ligado (laterais da rampa). */
function sideLevel(o: Pick<MapObject, "type" | "level" | "rot">, dir: number): number | null {
  if (typeDef(o.type)?.shape !== "ramp") return o.level;
  const d = (o.rot >> 1) & 3;
  if (dir === d) return o.level + 1; // topo da rampa
  if (dir === (d + 2) % 4) return o.level; // pé da rampa
  return null;
}

/** Dois blocos vizinhos (b está na direção `dir` de a) se encaixam: lados ligáveis e na mesma altura. */
export function sidesFit(a: Pick<MapObject, "type" | "level" | "rot">, b: Pick<MapObject, "type" | "level" | "rot">, dir: number): boolean {
  const la = sideLevel(a, dir), lb = sideLevel(b, (dir + 2) % 4);
  return la !== null && lb !== null && la === lb;
}

export interface BlockLike { type: string; x: number; z: number; level: number; rot: number }

const ERR = {
  occupied: "Já existe um bloco nesta célula.",
  incompatible: "Encaixe incompatível: rampas só se ligam pelas pontas e blocos só se ligam no mesmo nível.",
  bounds: "Fora dos limites do mapa.",
} as const;

/** null se o bloco pode ficar ali; senão o motivo. `ignore` = blocos que estão sendo movidos. */
export function blockPlacementError(idx: BlockIndex, b: BlockLike): string | null {
  const ci = cellOf(b.x), cj = cellOf(b.z);
  if (Math.abs(ci * CELL) > MAP_LIMITS.maxCoord || Math.abs(cj * CELL) > MAP_LIMITS.maxCoord) return ERR.bounds;
  if (idx.has(keyOf(ci, cj))) return ERR.occupied;
  for (let d = 0; d < 4; d++) {
    const nb = idx.get(keyOf(ci + DIRS[d]![0], cj + DIRS[d]![1]));
    if (nb && !sidesFit(b, nb, d)) return ERR.incompatible;
  }
  return null;
}

/** Quantos vizinhos o bloco tocaria (todos encaixados, se `blockPlacementError` for null). */
export function neighborCount(idx: BlockIndex, b: BlockLike): number {
  const ci = cellOf(b.x), cj = cellOf(b.z);
  let n = 0;
  for (const [di, dj] of DIRS) if (idx.has(keyOf(ci + di, cj + dj))) n++;
  return n;
}

export interface Connection { a: string; b: string }

/** Pares de blocos vizinhos que se encaixam (cada par uma vez). */
export function connections(map: MapDoc): Connection[] {
  const idx = blockIndex(map);
  const out: Connection[] = [];
  for (const o of idx.values()) {
    const ci = cellOf(o.x), cj = cellOf(o.z);
    for (let d = 0; d < 2; d++) { // só +z e +x: cada par é visto uma vez
      const nb = idx.get(keyOf(ci + DIRS[d]![0], cj + DIRS[d]![1]));
      if (nb && sidesFit(o, nb, d)) out.push({ a: o.id, b: nb.id });
    }
  }
  return out;
}

/** Vizinhos que NÃO se encaixam (só aparecem em mapas importados/antigos; o editor nunca cria isso). */
export function misfits(map: MapDoc): Connection[] {
  const idx = blockIndex(map);
  const out: Connection[] = [];
  for (const o of idx.values()) {
    const ci = cellOf(o.x), cj = cellOf(o.z);
    for (let d = 0; d < 2; d++) {
      const nb = idx.get(keyOf(ci + DIRS[d]![0], cj + DIRS[d]![1]));
      if (nb && !sidesFit(o, nb, d)) out.push({ a: o.id, b: nb.id });
    }
  }
  return out;
}

/** Ilhas = componentes conexos de blocos encaixados. Cada ilha é a lista de ids dos blocos. */
export function islands(map: MapDoc): string[][] {
  const parent = new Map<string, string>();
  for (const o of map.objects) if (isBlock(o)) parent.set(o.id, o.id);
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
  for (const c of connections(map)) parent.set(find(c.a), find(c.b));
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) { const r = find(id); groups.set(r, [...(groups.get(r) ?? []), id]); }
  return Array.from(groups.values());
}

/** Altura da superfície em (x, z), ou null se não há bloco ali. Rampas sobem linearmente. */
export function surfaceHeight(idx: BlockIndex, x: number, z: number): number | null {
  const ci = cellOf(x), cj = cellOf(z);
  const b = idx.get(keyOf(ci, cj));
  if (!b) return null;
  if (!isRamp(b)) return b.level * LEVEL_H;
  const lx = Math.min(1, Math.max(0, (x - ci * CELL) / CELL + 0.5)), lz = Math.min(1, Math.max(0, (z - cj * CELL) / CELL + 0.5));
  const t = [lz, lx, 1 - lz, 1 - lx][rampDir(b)]!;
  return (b.level + t) * LEVEL_H;
}
