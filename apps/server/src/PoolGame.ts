import { randomInt } from "node:crypto";
import {
  POOL, POOL_RULES, S, shuffle, findFreeSpot, groupOf, isValidCuePlacement, rackBalls, resolveShot, simulateShot,
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
  /** Equipes (índice 0 e 1). Quem sai da partida deixa a equipe; `teamOf` guarda a equipe original de todos. */
  private teams: string[][];
  private teamOf = new Map<string, 0 | 1>();
  /** Próximo integrante de cada equipe a jogar (rodízio quando a vez passa para a equipe). */
  private nextIdx: [number, number] = [0, 0];
  private teamGroups: [PoolGroup | null, PoolGroup | null] = [null, null];
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

  private players: string[];

  /**
   * 2 jogadores: 1×1 · 3 jogadores: 1×2 · 4 jogadores: 2×2. As equipes se alternam; dentro da equipe
   * os integrantes se revezam. Sorteio de equipes e de quem começa feito aqui.
   */
  constructor(private host: PoolHost, players: string[]) {
    const order = shuffle(players, rng);
    this.players = order;
    this.teams = order.length === 2 ? [[order[0]!], [order[1]!]]
      : order.length === 3 ? [[order[0]!], [order[1]!, order[2]!]]
      : [[order[0]!, order[2]!], [order[1]!, order[3]!]];
    this.teams.forEach((t, i) => t.forEach((id) => this.teamOf.set(id, i as 0 | 1)));
    this.turn = this.pickFrom(rng(2) as 0 | 1);
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
      teams: this.teams,
      turn: this.turn,
      groups: Object.fromEntries(this.players.map((id) => [id, this.teamGroups[this.teamOf.get(id)!]])),
      balls: this.balls.map((b): PoolBallState => ({ id: b.id, x: b.x, z: b.z, out: b.out })),
      ballInHand: this.ballInHand,
      turnEndsAt: this.turnEndsAt,
      message: this.message,
      winner: this.winner,
      winners: this.winner ? this.teams[this.teamOf.get(this.winner)!]!.slice() : [],
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
    const t = this.teamOf.get(id)!;
    this.teams[t] = this.teams[t]!.filter((p) => p !== id);
    this.players = this.players.filter((p) => p !== id);
    const other = (1 - t) as 0 | 1;
    if (this.teams[t]!.length === 0) {
      const winner = this.teams[other]![0];
      if (winner) this.finish(winner, "desistencia", "O adversário saiu da partida.");
      return;
    }
    this.nextIdx[t] %= this.teams[t]!.length;
    if (this.turn === id) {
      // quem saiu estava na vez: a vez passa para a outra equipe com bola na mão (se a tacada ainda não foi dada)
      if (this.phase === "shooting") return; // o fim da tacada decide a vez
      this.turn = this.pickFrom(other);
      this.ballInHand = !this.isBreak;
      this.message = "Um jogador saiu. A vez passou para a outra equipe.";
      this.beginTurn();
    } else this.host.send(S.Pool, this.snapshot());
  }

  dispose() {
    this.ended = true;
    this.clearTimers();
  }

  // ---------------------------------------------------------------- fluxo
  /** Escolhe o próximo integrante da equipe (rodízio). */
  private pickFrom(team: 0 | 1): string {
    const members = this.teams[team]!;
    const id = members[this.nextIdx[team] % members.length]!;
    this.nextIdx[team] = (this.nextIdx[team] + 1) % members.length;
    return id;
  }

  private otherTeam(id: string): 0 | 1 {
    return (1 - this.teamOf.get(id)!) as 0 | 1;
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
      this.message = `Tempo esgotado! Bola na mão para o adversário.`;
      this.turn = this.pickFrom(this.otherTeam(this.turn));
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
    const myTeam = this.teamOf.get(shooter)!;
    const key = (t: number) => `t${t}`;
    const out = resolveShot({
      shooter: key(myTeam), opponent: key(1 - myTeam),
      groups: { t0: this.teamGroups[0], t1: this.teamGroups[1] }, tableBefore, isBreak: wasBreak,
      firstContact: result.firstContact, pocketed: result.pocketed,
    });
    this.teamGroups = [out.groups["t0"] ?? null, out.groups["t1"] ?? null];
    if (out.respotEight) {
      const eight = this.balls.find((b) => b.id === 8)!;
      const spot = findFreeSpot(this.balls, POOL.foot, 8);
      eight.x = spot.x; eight.z = spot.z; eight.out = false;
    }
    this.message = out.message;
    if (out.winner) {
      const wTeam = out.winner === key(myTeam) ? myTeam : 1 - myTeam;
      const winner = wTeam === myTeam && this.players.includes(shooter) ? shooter : this.teams[wTeam]![0] ?? shooter;
      this.finish(winner, out.endReason ?? "eight", out.message);
      return;
    }
    // a vez continua com quem encaçapou; se passa, vai para o próximo da outra equipe
    this.turn = out.nextTurn === key(myTeam) && this.players.includes(shooter) ? shooter : this.pickFrom(out.nextTurn === key(myTeam) ? myTeam : ((1 - myTeam) as 0 | 1));
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
