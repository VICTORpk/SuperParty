/**
 * Formato dos mapas do Modo Dev (editor): um documento JSON simples, versionado, que descreve só o necessário
 * para reconstruir o cenário (objetos, posições, propriedades). As conexões entre blocos NÃO são gravadas:
 * derivam da vizinhança na grade (ver `grid.ts`), então nunca ficam inconsistentes com as posições.
 */

export const MAP_VERSION = 1;

/** Tipos de mapa. Novos tipos entram em `MAP_KIND_DEFS` (registry.ts) sem mexer no editor. */
export const MAP_KINDS = ["islands", "board", "minigolf"] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export const MAP_LIMITS = {
  maxObjects: 600,
  maxNameLength: 40,
  /** Coordenadas máximas (unidades do mundo) em cada eixo. */
  maxCoord: 200,
  maxLevel: 3,
  maxBotsInEditor: 6,
} as const;

export type PropValue = string | number | boolean;

export interface MapObject {
  id: string;
  /** Chave do registro de tipos (`OBJECT_TYPES`). */
  type: string;
  /** Posição no mundo (blocos: centro da célula, múltiplo de CELL). */
  x: number;
  z: number;
  /** Nível de altura (só blocos): 0..maxLevel. */
  level: number;
  /** Giro em passos de 45° (0..7). Rampas só usam passos pares (apontam para um dos 4 lados). */
  rot: number;
  props: Record<string, PropValue>;
}

export interface MapDoc {
  version: number;
  id: string;
  name: string;
  kind: MapKind;
  createdAt: number;
  updatedAt: number;
  objects: MapObject[];
}

export function isMapKind(v: unknown): v is MapKind {
  return typeof v === "string" && (MAP_KINDS as readonly string[]).includes(v);
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export function isValidMapId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** `rand()` devolve [0, 1). O sufixo evita colisões ao duplicar mapas com o mesmo nome. */
export function makeMapId(name: string, rand: () => number = Math.random): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "mapa";
  return `${slug}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export function cleanMapName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAP_LIMITS.maxNameLength) : "";
  return s || "Mapa sem nome";
}
