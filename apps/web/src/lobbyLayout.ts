import { FLOWER_POINTS, PINE_POINTS } from "@jogo/shared";
import { PALETTE } from "./scenery";

/** Disposição do lobby: a geometria (colisões, lago, ponte) está em `@jogo/shared`; aqui só entram as cores do desenho. */
export { BRIDGE, COLLIDERS, HUT, POND, resolveCollisions, type Circle } from "@jogo/shared";

export const PINES = PINE_POINTS.map((p, i) => ({ ...p, color: PALETTE.pine[i % 3]!, tiers: 3 + (i % 2) }));
export const FLOWERS = FLOWER_POINTS.map((p, i) => ({ ...p, color: ["#ffd54a", "#ff8fa3", "#ffffff", "#c084fc"][i % 4]! }));
