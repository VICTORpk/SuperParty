import { randomInt } from "node:crypto";
import {
  POOL, POOL_RULES, S, findFreeSpot, groupOf, isValidCuePlacement, rackBalls, resolveShot, simulateShot,
  type PoolBallState, type PoolGroup, type PoolPhase, type PoolPublicState, type PoolShotMsg, type ShotResult, type SimBall,
} from "@jogo/shared";

export interface PoolHost {
  send(type: string, payload: unknown): void;
  isAway(playerId: string): boolean;
  /** Vitória ou cancelamento; o host decide quando voltar ao lobby. */
  onEnded(): void;
}

const rng = (n: number) => randomInt(0, n);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Partida de sinuca (bola 8) com servidor autoritativo: o servidor simula a tacada inteira e envia a gravação;
 * os clientes só reproduzem. Regras em `resolveShot` (shared).
 */
export class PoolGame {
  private balls: SimBall[] = [];
  private turn: string;
  private groups: Record<string, PoolGroup | null> = {};
  private phase: PoolPhase = "break";
  private isBreak = true;
  private ballInHand = false;
  private message = "";
  private winner: string | null = null;
  private endReason: string | null = null;
  private turnEndsAt: number | null = null;
  private shotId = 0;
  private timers = new Set<NodeJS.Timeout>();
  private ended = false;

  constructor(private host: PoolHost, private players: [string, string]) {
    this.turn = players[rng(2)]!;
    this.groups = { [players[0]]: null, [players[1]]: null };
  }

  get finished(): boolean {
    return this.phase === "finished";
  }

  start() {
    this.balls = rackBalls(rng);
    this.message = "Quebra! A mesa está aberta.";
    this.beginTurn();
  }

  snapshot(): PoolPublicState {
    return {
      phase: this.phase,
      players: this.players,
      turn: this.turn,
      groups: this.groups,
      balls: this.balls.map((b): PoolBallState => ({ id: b.id, x: b.x, z: b.z, out: b.out })),
      ballInHand: this.ballInHand,
      turnEndsAt: this.turnEndsAt,
      message: this.message,
      winner: this.winner,
      endReason: this.endReason,
      shotId: this.shotId,
      serverNow: Date.now(),
    };
  }

  sendStateTo(send: (type: string, payload: unknown) => void, _playerId?: string) {
    send(S.Pool, this.snapshot());
  }

  // ---------------------------------------------------------------- entradas
  handleShoot(id: string, raw: unknown) {
    if ((this.phase !== "aim" && this.phase !== "break") || id !== this.turn || typeof raw !== "object" || raw === null) return;
    const { angle, power } = raw as { angle?: unknown; power?: unknown };
    if (!num(angle) || !num(power)) return;
    const p = Math.min(1, Math.max(POOL.minPower, power));
    this.clearTimers();

    const tableBefore = this.balls.filter((b) => !b.out && b.id !== 0).map((b) => b.id);
    const wasBreak = this.isBreak;
    const result = simulateShot(this.balls, angle, p);
    this.phase = "shooting";
    this.turnEndsAt = null;
    this.shotId += 1;
    const msg: PoolShotMsg = { shotId: this.shotId, shooter: id, angle, power: p, recording: result.recording };
    this.host.send(S.PoolShot, msg);
    this.host.send(S.Pool, this.snapshot()); // fase "shooting" com as posições de antes da tacada
    this.later(result.recording.totalMs + POOL_RULES.settleMs, () => this.finishShot(result, tableBefore, id, wasBreak));
  }

  handlePlace(id: string, raw: unknown) {
    if (this.phase !== "placing" || id !== this.turn || typeof raw !== "object" || raw === null) return;
    const { x, z } = raw as { x?: unknown; z?: unknown };
    if (!isValidCuePlacement(this.balls, x, z)) return;
    this.placeCue(x as number, z as number);
  }

  removePlayer(id: string) {
    if (this.ended || this.phase === "finished" || !this.players.includes(id)) return;
    const winner = this.players.find((p) => p !== id)!;
    this.finish(winner, "desistencia", "O adversário saiu da partida.");
  }

  dispose() {
    this.ended = true;
    this.clearTimers();
  }

  // ---------------------------------------------------------------- fluxo
  private opponent(id: string): string {
    return this.players.find((p) => p !== id)!;
  }

  private beginTurn() {
    this.clearTimers();
    this.phase = this.ballInHand ? "placing" : this.isBreak ? "break" : "aim";
    const away = this.host.isAway(this.turn);
    const ms = away ? POOL_RULES.awayActionMs : this.phase === "placing" ? POOL_RULES.placeMs : POOL_RULES.aimMs;
    this.turnEndsAt = Date.now() + ms;
    this.later(ms, () => this.onTurnTimeout());
    this.host.send(S.Pool, this.snapshot());
  }

  private onTurnTimeout() {
    if (this.phase === "placing") {
      // tempo para posicionar a bola esgotou: o servidor coloca a bola na posição inicial
      const spot = findFreeSpot(this.balls, POOL.head, 0);
      this.placeCue(spot.x, spot.z);
      return;
    }
    if (this.phase === "aim" || this.phase === "break") {
      const next = this.opponent(this.turn);
      this.message = `Tempo esgotado! Bola na mão para o adversário.`;
      this.turn = next;
      this.ballInHand = !this.isBreak;
      this.beginTurn();
    }
  }

  private placeCue(x: number, z: number) {
    const cue = this.balls.find((b) => b.id === 0)!;
    cue.x = x; cue.z = z; cue.vx = 0; cue.vz = 0; cue.out = false;
    this.ballInHand = false;
    this.phase = this.isBreak ? "break" : "aim";
    this.clearTimers();
    this.turnEndsAt = Date.now() + POOL_RULES.aimMs;
    this.later(POOL_RULES.aimMs, () => this.onTurnTimeout());
    this.host.send(S.Pool, this.snapshot());
  }

  private finishShot(result: ShotResult, tableBefore: number[], shooter: string, wasBreak: boolean) {
    this.balls = result.finalBalls;
    this.isBreak = false;
    const out = resolveShot({
      shooter, opponent: this.opponent(shooter), groups: this.groups, tableBefore, isBreak: wasBreak,
      firstContact: result.firstContact, pocketed: result.pocketed,
    });
    this.groups = out.groups;
    if (out.respotEight) {
      const eight = this.balls.find((b) => b.id === 8)!;
      const spot = findFreeSpot(this.balls, POOL.foot, 8);
      eight.x = spot.x; eight.z = spot.z; eight.out = false;
    }
    this.message = out.message;
    if (out.winner) {
      this.finish(out.winner, out.endReason ?? "eight", out.message);
      return;
    }
    this.turn = out.nextTurn;
    this.ballInHand = out.ballInHand;
    this.beginTurn();
  }

  private finish(winner: string, reason: string, message: string) {
    if (this.ended) return;
    this.clearTimers();
    this.phase = "finished";
    this.winner = winner;
    this.endReason = reason;
    this.message = message;
    this.turnEndsAt = null;
    this.host.send(S.Pool, this.snapshot());
    this.host.onEnded();
  }

  // ---------------------------------------------------------------- utilitários
  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.ended) fn();
    }, ms);
    this.timers.add(t);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

export { groupOf };
