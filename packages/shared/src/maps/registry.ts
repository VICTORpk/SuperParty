import type { MapDoc, MapKind, PropValue } from "./schema";

/**
 * Registro de tipos de objeto e de tipos de mapa. Para criar um objeto novo basta uma entrada em `OBJECT_TYPES`
 * (e, se tiver visual próprio, um desenhista no cliente); para um tipo de mapa novo, uma entrada em `MAP_KIND_DEFS`.
 * O editor lê estes dados e monta paleta, inspetor e verificações sozinho.
 */

/** "block": ocupa uma célula da grade e encaixa nos vizinhos. "free": fica sobre um bloco, em qualquer ponto. */
export type PlacementMode = "block" | "free";
export type BlockShape = "flat" | "ramp";

export interface PropDef {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  default: PropValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export interface ObjectTypeDef {
  id: string;
  label: string;
  icon: string;
  category: string;
  placement: PlacementMode;
  /** Em quais tipos de mapa aparece na paleta. */
  kinds: readonly MapKind[];
  color: string;
  shape?: BlockShape;
  /** Só pode haver um (ex.: ponto de partida). */
  unique?: boolean;
  props?: readonly PropDef[];
}

const ALL: readonly MapKind[] = ["islands", "board", "minigolf"];

const block = (id: string, label: string, icon: string, color: string, shape: BlockShape = "flat"): ObjectTypeDef =>
  ({ id, label, icon, category: "Terreno", placement: "block", kinds: ALL, color, shape });

const TYPE_LIST: ObjectTypeDef[] = [
  block("grass", "Grama", "🟩", "#6aae3f"),
  block("sand", "Areia", "🟨", "#e8c777"),
  block("snow", "Neve", "⬜", "#eef6fb"),
  block("stone", "Pedra", "⬛", "#9a8f86"),
  block("ramp", "Rampa", "📐", "#7bbf4a", "ramp"),

  { id: "pine", label: "Pinheiro", icon: "🌲", category: "Cenário", placement: "free", kinds: ["islands", "board"], color: "#2f7d4a" },
  { id: "palm", label: "Palmeira", icon: "🌴", category: "Cenário", placement: "free", kinds: ["islands", "board"], color: "#3fae3a" },
  { id: "rock", label: "Pedra", icon: "🪨", category: "Cenário", placement: "free", kinds: ["islands", "board", "minigolf"], color: "#9a8f86" },
  { id: "flower", label: "Flor", icon: "🌼", category: "Cenário", placement: "free", kinds: ["islands", "board"], color: "#ffd54a" },

  { id: "spawn", label: "Ponto de partida", icon: "🚩", category: "Jogo", placement: "free", kinds: ["islands", "board"], color: "#ef4444", unique: true },
  { id: "bot-spawn", label: "Bot de teste", icon: "🤖", category: "Jogo", placement: "free", kinds: ALL, color: "#64748b" },

  {
    id: "tile", label: "Casa do tabuleiro", icon: "🔵", category: "Tabuleiro", placement: "free", kinds: ["board"], color: "#3d8bff",
    props: [{ key: "tileKind", label: "Tipo da casa", type: "select", default: "normal", options: ["normal", "desafio", "vermelha", "atalho"] }],
  },
  { id: "start", label: "Largada", icon: "🏁", category: "Tabuleiro", placement: "free", kinds: ["board"], color: "#ff5a5f", unique: true },
  { id: "finish", label: "Chegada", icon: "⭐", category: "Tabuleiro", placement: "free", kinds: ["board"], color: "#ffd23f", unique: true },

  { id: "tee", label: "Saída (tee)", icon: "⛳", category: "Minigolfe", placement: "free", kinds: ["minigolf"], color: "#22c55e", unique: true },
  { id: "hole", label: "Buraco", icon: "🕳️", category: "Minigolfe", placement: "free", kinds: ["minigolf"], color: "#111827", unique: true },
  {
    id: "wall", label: "Parede", icon: "🧱", category: "Minigolfe", placement: "free", kinds: ["minigolf"], color: "#c2763f",
    props: [{ key: "length", label: "Comprimento", type: "number", default: 3, min: 1, max: 8, step: 0.5 }, { key: "height", label: "Altura", type: "number", default: 0.8, min: 0.4, max: 2, step: 0.2 }],
  },
  {
    id: "bumper", label: "Pino", icon: "🔴", category: "Minigolfe", placement: "free", kinds: ["minigolf"], color: "#e11d48",
    props: [{ key: "radius", label: "Raio", type: "number", default: 0.6, min: 0.3, max: 1.5, step: 0.1 }],
  },
];

export const OBJECT_TYPES: Record<string, ObjectTypeDef> = Object.fromEntries(TYPE_LIST.map((d) => [d.id, d] as const));

export function typeDef(id: string): ObjectTypeDef | undefined {
  return OBJECT_TYPES[id];
}

/** Valor padrão das propriedades de um tipo. */
export function defaultProps(def: ObjectTypeDef): Record<string, PropValue> {
  return Object.fromEntries((def.props ?? []).map((p) => [p.key, p.default]));
}

/** Aplica o esquema de propriedades: descarta chaves desconhecidas e corrige tipos/limites. */
export function cleanProps(def: ObjectTypeDef, raw: unknown): Record<string, PropValue> {
  const src = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, PropValue> = {};
  for (const p of def.props ?? []) {
    const v = src[p.key];
    if (p.type === "number") out[p.key] = typeof v === "number" && Number.isFinite(v) ? Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v)) : p.default;
    else if (p.type === "boolean") out[p.key] = typeof v === "boolean" ? v : p.default;
    else out[p.key] = typeof v === "string" && (p.options ?? []).includes(v) ? v : p.default;
  }
  return out;
}

export interface MapKindDef {
  id: MapKind;
  label: string;
  description: string;
  /** Verificações do tipo de mapa: devolve avisos (não bloqueiam a edição). */
  check(map: MapDoc): string[];
}

const count = (map: MapDoc, type: string) => map.objects.filter((o) => o.type === type).length;

export const MAP_KIND_DEFS: Record<MapKind, MapKindDef> = {
  islands: {
    id: "islands", label: "Ilhas", description: "Ilhas soltas ou conectadas, com cenário e ponto de partida.",
    check: (m) => (count(m, "spawn") === 0 ? ["Falta o ponto de partida (🚩)."] : []),
  },
  board: {
    id: "board", label: "Tabuleiro", description: "Casas, caminhos e plataformas de movimentação.",
    check: (m) => [
      ...(count(m, "start") === 0 ? ["Falta a casa de largada (🏁)."] : []),
      ...(count(m, "finish") === 0 ? ["Falta a casa de chegada (⭐)."] : []),
      ...(count(m, "tile") < 2 ? ["Coloque ao menos 2 casas no caminho."] : []),
    ],
  },
  minigolf: {
    id: "minigolf", label: "Minigolfe", description: "Percurso com saída, buraco, paredes e obstáculos.",
    check: (m) => [
      ...(count(m, "tee") === 0 ? ["Falta a saída (⛳)."] : []),
      ...(count(m, "hole") === 0 ? ["Falta o buraco (🕳️)."] : []),
    ],
  },
};

/** Tipos disponíveis na paleta de cada tipo de mapa, agrupados por categoria. */
export function paletteFor(kind: MapKind): { category: string; types: ObjectTypeDef[] }[] {
  const groups = new Map<string, ObjectTypeDef[]>();
  for (const t of Object.values(OBJECT_TYPES)) {
    if (!t.kinds.includes(kind)) continue;
    groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  }
  return Array.from(groups, ([category, types]) => ({ category, types }));
}
