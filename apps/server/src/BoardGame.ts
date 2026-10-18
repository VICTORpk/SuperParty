import { randomInt } from "node:crypto";
import { ArenaBattle } from "./ArenaBattle";
import {
  BOARD_RULES, CHALLENGE_CONFIG, CHALLENGE_KINDS, DEFAULT_BOARD_SIZE, RED_TILE_BACK, S,
  clampTile, clicksSuccess, colorsCheck, isChallengeTile, isRedTile, makeBoardLayout, pickColors, powerSuccess, shortcutFrom, shuffle,
  type BoardLayout, type BoardEvent, type BoardPhase, type BoardPublicState, type ChallengeInput, type ChallengePublic, type ChallengeResult,
} from "@jogo/shared";

export interface BoardHost {
  send(type: string, payload: unknown): void;
  isAway(playerId: string): boolean;
  /** Chamado quando a partida termina (vitória) ou é cancelada; o host decide quando voltar ao lobby. */
  onEnded(): void;
}

const rng = (n: number) => randomInt(0, n);

/**
 * Partida de tabuleiro com servidor autoritativo: dado, ordem dos turnos, desafios e movimentos
 * são decididos aqui. Os clientes só enviam intenções (rolar, entradas do desafio) e animam o resultado.
 */
export class BoardGame {
  private order: string[];
  private positions = new Map<string, number>();
  private turnIndex = 0;
  private round = 1;
  private phase: BoardPhase = "roll";
  private turnEndsAt: number | null = null;
  private challenge: ChallengePublic | null = null;
  private winner: string | null = null;
  private timers = new Set<NodeJS.Timeout>();
  private rollTimer: NodeJS.Timeout | null = null;
  private clickTimes: number[] = [];
  private clickFlush: NodeJS.Timeout | null = null;
  private colorInput: number[] = [];
  private ended = false;
  private arena: ArenaBattle | null = null;
  private duel: [string, string] | null = null;

  private layout: BoardLayout;
  private seed: number;

  constructor(private host: BoardHost, playerIds: string[], private size: number = DEFAULT_BOARD_SIZE) {
    this.seed = randomInt(1, 2 ** 31);
    this.layout = makeBoardLayout(size, this.seed);
    this.order = shuffle(playerIds, rng); // a ordem dos turnos é sorteada pelo sistema
    for (const id of this.order) this.positions.set(id, 0);
  }

  get finished(): boolean {
    return this.phase === "finished";
  }

  /** Envia o estado atual (para quem acabou de entrar/reconectar). */
  sendStateTo(send: (type: string, payload: unknown) => void, _playerId?: string) {
    send(S.Board, this.snapshot());
    if (this.arena) send(S.Arena, this.arena.snapshot());
  }

  get turn(): string {
    return this.order[this.turnIndex]!;
  }

  start() {
    this.beginTurn();
    // Teste manual: com BOARD_DEBUG_ARENA=1 os dois primeiros jogadores vão direto para a arena.
    if (process.env.BOARD_DEBUG_ARENA === "1" && this.order.length >= 2) {
      this.clearTimers();
      this.later(1500, () => this.startEncounter(this.order[0]!, this.order[1]!, 0));
    }
  }

  snapshot(): BoardPublicState {
    return {
      phase: this.phase,
      order: [...this.order],
      positions: Object.fromEntries(this.positions),
      turn: this.turn,
      round: this.round,
      turnEndsAt: this.turnEndsAt,
      challenge: this.challenge,
      winner: this.winner,
      duel: this.duel,
      size: this.size,
      seed: this.seed,
      serverNow: Date.now(),
    };
  }

  // ---------------------------------------------------------------- entradas dos jogadores
  handleRoll(playerId: string) {
    if (this.phase !== "roll" || playerId !== this.turn) return;
    this.doRoll();
  }

  handleChallenge(playerId: string, input: ChallengeInput) {
    const ch = this.challenge;
    if (this.phase !== "challenge" || !ch || ch.result || playerId !== this.turn) return;
    const now = Date.now();

    if (ch.kind === "power" && input?.action === "stop") {
      if (now < ch.startAt) return;
      const elapsed = Math.min(now, ch.endsAt) - ch.startAt;
      this.resolveChallenge(powerSuccess(elapsed, ch.target), "power");
    } else if (ch.kind === "colors" && input?.action === "pick") {
      if (now < ch.inputAt || now > ch.endsAt) return;
      const color = input.color;
      if (typeof color !== "number" || !Number.isInteger(color) || color < 0 || color > 3) return;
      this.colorInput.push(color);
      const check = colorsCheck(ch.sequence, this.colorInput);
      ch.progress = this.colorInput.length;
      if (check === "wrong") this.resolveChallenge(false, "colors", "sequência errada");
      else if (check === "done") this.resolveChallenge(true, "colors");
      else this.emitState();
    } else if (ch.kind === "clicks" && input?.action === "click") {
      if (now < ch.startAt || now > ch.endsAt) return;
      this.clickTimes = this.clickTimes.filter((t) => now - t < 1000);
      if (this.clickTimes.length >= CHALLENGE_CONFIG.clicks.maxPerSecond) return; // limite de cliques por segundo
      this.clickTimes.push(now);
      ch.count += 1;
      this.scheduleClickFlush();
    }
  }

  handleArenaInput(playerId: string, raw: unknown) {
    this.arena?.handleInput(playerId, raw);
  }

  handleArenaAction(playerId: string, raw: unknown) {
    this.arena?.handleAction(playerId, raw);
  }

  removePlayer(playerId: string) {
    const idx = this.order.indexOf(playerId);
    if (idx < 0 || this.ended) return;
    const wasTurn = idx === this.turnIndex;
    const duelOther = this.duel?.includes(playerId) ? this.duel.find((d) => d !== playerId)! : null;
    if (duelOther && this.arena) { this.arena.dispose(); this.arena = null; }
    this.order.splice(idx, 1);
    this.positions.delete(playerId);
    if (this.order.length < BOARD_RULES.minPlayers) {
      this.cancel();
      return;
    }
    if (idx < this.turnIndex) this.turnIndex -= 1;
    if (duelOther) {
      // quem sai no meio da luta perde: o oponente avança como vencedor
      this.clearTimers();
      this.duel = null;
      this.challenge = null;
      if (wasTurn) this.turnIndex = this.turnIndex % this.order.length;
      const from = this.positions.get(duelOther);
      if (from === undefined) return wasTurn ? this.beginTurn() : this.nextTurn();
      const to = this.clampT(from + BOARD_RULES.encounterWinnerAdvance);
      this.positions.set(duelOther, to);
      this.phase = "moving";
      this.emit({ kind: "move", playerId: duelOther, from, to, reason: "arena-win" });
      this.emitState();
      this.later(this.travelMs(from, to) + 700, () => {
        if (to >= this.layout.finalTile) this.finish(duelOther);
        else if (wasTurn) this.beginTurn();
        else this.nextTurn();
      });
      return;
    }
    if (wasTurn) {
      this.clearTimers();
      this.turnIndex = this.turnIndex % this.order.length;
      this.challenge = null;
      this.beginTurn();
    } else {
      this.emitState();
    }
  }

  dispose() {
    this.ended = true;
    this.arena?.dispose();
    this.clearTimers();
  }

  // ---------------------------------------------------------------- fluxo do turno
  private beginTurn() {
    this.phase = "roll";
    this.challenge = null;
    const away = this.host.isAway(this.turn);
    const delay = away ? BOARD_RULES.awayActionDelayMs : BOARD_RULES.rollTimeoutMs;
    this.turnEndsAt = Date.now() + delay;
    this.rollTimer = this.later(delay, () => this.doRoll()); // tempo esgotado: o servidor rola pelo jogador
    this.emitState();
  }

  private nextTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.order.length;
    if (this.turnIndex === 0) this.round += 1;
    this.beginTurn();
  }

  private doRoll() {
    if (this.phase !== "roll" || this.ended) return;
    if (this.rollTimer) clearTimeout(this.rollTimer);
    const id = this.turn;
    const value = randomInt(1, BOARD_RULES.diceSides + 1);
    const from = this.positions.get(id)!;
    const to = this.clampT(from + value);
    this.phase = "rolling"; // o dado gira; a peça só anda quando ele parar
    this.turnEndsAt = null;
    this.emit({ kind: "roll", playerId: id, value, from, to });
    this.emitState();
    this.later(BOARD_RULES.diceMs, () => {
      this.positions.set(id, to);
      this.phase = "moving";
      this.emitState();
      this.later(this.travelMs(from, to) + 500, () => this.afterDiceMove(id));
    });
  }

  private clampT(i: number): number {
    return clampTile(i, this.layout.finalTile);
  }

  private travelMs(from: number, to: number): number {
    return Math.abs(to - from) * BOARD_RULES.hopMs;
  }

  private afterDiceMove(id: string) {
    this.resolveLanding(id, "dice");
  }

  /**
   * Efeitos da casa onde a peça parou. `via` evita encadear efeitos: depois de um atalho não há outro atalho,
   * e depois da punição da casa vermelha só vale o encontro.
   */
  private resolveLanding(id: string, via: "dice" | "shortcut" | "penalty") {
    const pos = this.positions.get(id);
    if (pos === undefined) return;
    if (pos >= this.layout.finalTile) return this.finish(id);

    // Encontro: terminou o movimento em casa ocupada (a casa de início não conta)
    const other = pos > 0 ? this.order.find((o) => o !== id && this.positions.get(o) === pos) : undefined;
    if (other) return this.startEncounter(id, other, pos);
    if (via === "penalty") return this.nextTurn();

    const sc = via === "dice" ? shortcutFrom(this.layout, pos) : undefined;
    if (sc) {
      return this.later(BOARD_RULES.shortcutPauseMs, () => this.moveTo(id, sc.to, "shortcut", () => this.resolveLanding(id, "shortcut")));
    }
    if (isRedTile(this.layout, pos)) {
      return this.later(BOARD_RULES.shortcutPauseMs, () => this.moveTo(id, this.clampT(pos - RED_TILE_BACK), "red-tile", () => this.resolveLanding(id, "penalty")));
    }
    if (isChallengeTile(this.layout, pos)) return this.startChallenge(id);
    this.nextTurn();
  }

  /** Move a peça (atalho ou casa vermelha), espera a animação e segue. */
  private moveTo(id: string, to: number, reason: "shortcut" | "red-tile", then: () => void) {
    const from = this.positions.get(id);
    if (from === undefined) return;
    this.positions.set(id, to);
    this.phase = "moving";
    this.emit({ kind: "move", playerId: id, from, to, reason });
    this.emitState();
    const travel = reason === "shortcut" ? BOARD_RULES.shortcutFlightMs : this.travelMs(from, to);
    this.later(travel + 600, then);
  }

  // ---------------------------------------------------------------- encontro → arena
  private startEncounter(mover: string, other: string, tile: number) {
    this.phase = "encounter";
    this.duel = [mover, other];
    this.emit({ kind: "encounter", mover, other, tile });
    this.emitState();
    this.later(BOARD_RULES.encounterIntroMs, () => {
      if (!this.duel) return;
      this.phase = "arena";
      this.arena = new ArenaBattle({
        send: (type, payload) => this.host.send(type, payload),
        isAway: (id) => this.host.isAway(id),
        onEnded: (winner, loser, reason) => this.onArenaEnded(winner, loser, reason),
      }, mover, other);
      this.arena.start();
      this.emitState();
    });
  }

  /** Fim da luta (vida zerada, queda ou tempo): o perdedor volta 1 casa e o vencedor avança 2. */
  private onArenaEnded(winner: string, loser: string, reason: string) {
    this.arena?.dispose();
    this.arena = null;
    this.duel = null;
    this.phase = "moving";
    this.emit({ kind: "arena-result", winner, loser, reason });
    const wFrom = this.positions.get(winner), lFrom = this.positions.get(loser);
    let travel = 0;
    let wTo = wFrom ?? 0;
    if (wFrom !== undefined) {
      wTo = this.clampT(wFrom + BOARD_RULES.encounterWinnerAdvance);
      this.positions.set(winner, wTo);
      this.emit({ kind: "move", playerId: winner, from: wFrom, to: wTo, reason: "arena-win" });
      travel = Math.max(travel, this.travelMs(wFrom, wTo));
    }
    if (lFrom !== undefined) {
      const lTo = this.clampT(lFrom - BOARD_RULES.encounterLoserBack);
      this.positions.set(loser, lTo);
      this.emit({ kind: "move", playerId: loser, from: lFrom, to: lTo, reason: "arena-loss" });
      travel = Math.max(travel, this.travelMs(lFrom, lTo));
    }
    this.emitState();
    this.later(travel + 700, () => {
      if (wTo >= this.layout.finalTile && this.positions.has(winner)) this.finish(winner);
      else this.nextTurn();
    });
  }

  // ---------------------------------------------------------------- desafios
  private startChallenge(id: string) {
    const kind = CHALLENGE_KINDS[rng(CHALLENGE_KINDS.length)]!;
    const now = Date.now();
    this.colorInput = [];
    this.clickTimes = [];
    let endsAt: number;
    if (kind === "power") {
      const c = CHALLENGE_CONFIG.power;
      const startAt = now + c.prepMs;
      endsAt = startAt + c.durationMs;
      this.challenge = { kind, startAt, endsAt, periodMs: c.periodMs, target: randomInt(250, 751) / 1000, zoneWidth: c.zoneWidth, result: null };
    } else if (kind === "colors") {
      const c = CHALLENGE_CONFIG.colors;
      const startAt = now + c.prepMs;
      const inputAt = startAt + c.length * c.showMsPerColor + 400;
      endsAt = inputAt + c.inputMs;
      this.challenge = { kind, startAt, inputAt, endsAt, sequence: pickColors(rng), progress: 0, result: null };
    } else {
      const c = CHALLENGE_CONFIG.clicks;
      const startAt = now + c.prepMs;
      endsAt = startAt + c.durationMs;
      this.challenge = { kind, startAt, endsAt, count: 0, target: c.target, result: null };
    }
    this.phase = "challenge";
    this.turnEndsAt = endsAt;
    this.emitState();

    if (this.host.isAway(id)) {
      this.later(CHALLENGE_CONFIG.power.prepMs + BOARD_RULES.awayActionDelayMs, () => this.resolveChallenge(false, kind, "jogador ausente"));
    }
    // fim do tempo: cliques são avaliados pela contagem; os demais falham
    this.later(endsAt - now + 150, () => {
      const ch = this.challenge;
      if (!ch || ch.result || this.phase !== "challenge") return;
      if (ch.kind === "clicks") this.resolveChallenge(clicksSuccess(ch.count), "clicks", `${ch.count} cliques`);
      else this.resolveChallenge(false, kind, "tempo esgotado");
    });
  }

  private resolveChallenge(success: boolean, kind: (typeof CHALLENGE_KINDS)[number], detail?: string) {
    const ch = this.challenge;
    if (!ch || ch.result || this.phase !== "challenge") return;
    if (this.clickFlush) { clearTimeout(this.clickFlush); this.clickFlush = null; }
    const result: ChallengeResult = { success, detail };
    ch.result = result;
    const id = this.turn;
    this.emit({ kind: "challenge-result", playerId: id, challenge: kind, success, detail });
    this.emitState();

    this.later(BOARD_RULES.resultDelayMs, () => {
      const from = this.positions.get(id);
      if (from === undefined) return;
      // Sucesso: permanece na casa do desafio e avança mais 2. Falha: avança apenas 1 (configurável).
      const steps = success ? BOARD_RULES.successBonus : BOARD_RULES.failAdvance;
      const to = this.clampT(from + steps);
      this.positions.set(id, to);
      this.challenge = null;
      this.phase = "moving";
      this.emit({ kind: "move", playerId: id, from, to, reason: success ? "challenge-success" : "challenge-fail" });
      this.emitState();
      this.later(this.travelMs(from, to) + 600, () => {
        if (to >= this.layout.finalTile) this.finish(id);
        else this.nextTurn();
      });
    });
  }

  private scheduleClickFlush() {
    if (this.clickFlush) return;
    this.clickFlush = setTimeout(() => {
      this.clickFlush = null;
      this.emitState();
    }, 120);
    this.timers.add(this.clickFlush);
  }

  // ---------------------------------------------------------------- fim
  private finish(winner: string) {
    if (this.ended) return;
    this.clearTimers();
    this.phase = "finished";
    this.winner = winner;
    this.challenge = null;
    this.turnEndsAt = null;
    this.emit({ kind: "finish", winner });
    this.emitState();
    this.host.onEnded();
  }

  private cancel() {
    this.clearTimers();
    this.ended = true;
    this.host.onEnded();
  }

  // ---------------------------------------------------------------- utilitários
  private later(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.ended) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.rollTimer = null;
    this.clickFlush = null;
  }

  private emit(event: BoardEvent) {
    this.host.send(S.BoardEvent, event);
  }

  private emitState() {
    this.host.send(S.Board, this.snapshot());
  }
}
