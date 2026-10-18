export type GameId = "board" | "pool" | "impostor";

export interface GameDef {
  id: GameId;
  label: string;
  icon: string;
  min: number;
  max: number;
  /** Ainda não implementado: a estação aparece, mas não aceita fila. */
  available: boolean;
  station: { x: number; z: number };
}

export const GAMES: Record<GameId, GameDef> = {
  board: { id: "board", label: "Tabuleiro", icon: "🎲", min: 2, max: 10, available: true, station: { x: -10, z: -8 } },
  pool: { id: "pool", label: "Sinuca", icon: "🎱", min: 2, max: 4, available: true, station: { x: 10, z: -8 } },
  impostor: { id: "impostor", label: "Sinuca Impostor", icon: "🍾", min: 4, max: 10, available: true, station: { x: 0, z: 12 } },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];

/** Distância até a estação para aparecer o botão de jogar. */
export const STATION_RADIUS = 4.2;
/** O servidor aceita a entrada na fila com um pouco de folga (latência). */
export const STATION_RADIUS_SERVER = STATION_RADIUS + 1.5;
/** Quem se afasta mais que isso sai da fila. */
export const STATION_LEAVE_RADIUS = STATION_RADIUS + 3;
export const QUEUE_COUNTDOWN_MS = 10_000;

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && value in GAMES;
}
