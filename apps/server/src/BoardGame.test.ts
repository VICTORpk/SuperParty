import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_SIZES, RED_TILE_BACK, S, makeBoardLayout, type BoardEvent, type BoardPublicState,
} from "@jogo/shared";
import { BoardGame } from "./BoardGame";

function setup(size: number, ids: string[]) {
  const states: BoardPublicState[] = [];
  const events: BoardEvent[] = [];
  const ended: number[] = [];
  const game = new BoardGame({
    send: (type, payload) => {
      if (type === S.Board) states.push(payload as BoardPublicState);
      else if (type === S.BoardEvent) events.push(payload as BoardEvent);
    },
    isAway: () => true, // todos "ausentes": o servidor rola e joga sozinho
    onEnded: () => ended.push(Date.now()),
  }, ids, size);
  game.start();
  return { game, states, events, ended, last: () => states[states.length - 1]! };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("BoardGame: tamanhos, atalhos e casas vermelhas", () => {
  it.each(BOARD_SIZES)("uma partida de %i casas termina e respeita as regras das casas especiais", (size) => {
    const t = setup(size, ["A", "B", "C"]);
    expect(t.last().size).toBe(size);
    const layout = makeBoardLayout(size, t.last().seed);
    const pos = new Map<string, number>(Object.entries(t.last().positions));
    let guard = 0;
    while (t.last().phase !== "finished" && guard++ < 20_000) vi.advanceTimersByTime(1000);
    expect(t.last().phase).toBe("finished");
    expect(t.ended).toHaveLength(1);

    for (const ev of t.events) {
      if (ev.kind === "roll") {
        expect(ev.to).toBeLessThanOrEqual(layout.finalTile);
        pos.set(ev.playerId, ev.to);
      } else if (ev.kind === "move") {
        if (ev.reason === "shortcut") {
          const sc = layout.shortcuts.find((s) => s.from === ev.from);
          expect(sc, `atalho a partir de ${ev.from}`).toBeDefined();
          expect(ev.to).toBe(sc!.to);
        } else if (ev.reason === "red-tile") {
          expect(layout.redTiles).toContain(ev.from);
          expect(ev.to).toBe(ev.from - RED_TILE_BACK);
        }
        pos.set(ev.playerId, ev.to);
      }
    }
    expect(t.last().positions[t.last().winner!]).toBe(layout.finalTile);
    t.game.dispose();
  }, 120_000);

  it("pisar numa casa vermelha volta 2 casas e pisar no início de um atalho leva ao fim dele", () => {
    // procura (tamanho, semente) simulados até ver os dois efeitos acontecerem em partidas reais
    let sawShortcut = false, sawRed = false;
    for (let round = 0; round < 12 && !(sawShortcut && sawRed); round++) {
      const t = setup(100, ["A", "B"]);
      let guard = 0;
      while (t.last().phase !== "finished" && guard++ < 20_000) vi.advanceTimersByTime(1000);
      for (const ev of t.events) if (ev.kind === "move") { if (ev.reason === "shortcut") sawShortcut = true; if (ev.reason === "red-tile") sawRed = true; }
      t.game.dispose();
    }
    expect(sawShortcut).toBe(true);
    expect(sawRed).toBe(true);
  }, 120_000);
});
