import { randomInt } from "node:crypto";
import {
  IMPOSTOR_RULES, POOL, S, applyHit, checkWinner, findFreeSpot, isValidShot, nextShooter, pickBottleTarget, rackBalls, shuffle, simulateShot,
  type ImpostorPhase, type ImpostorPlayer, type ImpostorPublicState, type ImpostorRole, type ImpostorSide, type LastHit,
  type PoolShotMsg, type ShotResult, type SimBall, type BottleSpin,
} from "@jogo/shared";

export interface ImpostorHost {
  /** Para todos os jogadores da partida (nunca envie segredos por aqui). */
  send(type: string, payload: unknown): void;
  /** Mensagem privada para um único jogador. */
  sendTo(playerId: string, type: string, payload: unknown): void;
  isAway(playerId: string): boolean;
  onEnded(): void;
}

const rng = (n: number) => randomInt(0, n);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Sinuca Impostor: um Impostor secreto, rodízio de tacadas, garrafa que sorteia um alvo depois de cada tacada
 * válida, e três acertos eliminam. O servidor é a única fonte da verdade e só revela papéis na eliminação/no fim.
 */
export class ImpostorGame {
  private order: string[];
  private players: ImpostorPlayer[];
  private impostor: string;
  private balls: SimBall[] = [];
  private turn: string;
  private phase: ImpostorPhase = "aim";
  private message = "";
  private winner: ImpostorSide | null = null;
  private revealedImpostor: string | null = null;
  private turnEndsAt: number | null = null;
  private bottle: BottleSpin | null = null;
  private decisionTarget: string | null = null;
  private lastHit: LastHit | null = null;
  private hitKey = 0;
  private shotId = 0;
  private timers = new Set<NodeJS.Timeout>();
  private ended = false;

  constructor(private host: ImpostorHost, playerIds: string[]) {
    this.order = shuffle(playerIds, rng);
    this.players = this.order.map((id) => ({ id, hits: 0, alive: true, revealed: null }));
    this.impostor = this.order[rng(this.order.length)]!;
    this.turn = this.order[0]!;
  }

  get finished(): boolean {
    return this.phase === "finished";
  }

  isDead(id: string): boolean {
    const p = this.players.find((x) => x.id === id);
    return !!p && !p.alive;
  }

  start() {
    this.balls = rackBalls(rng);
    this.host.sendTo(this.impostor, S.Role, { role: "impostor" satisfies ImpostorRole });
    this.message = "Valendo! Encaçape uma bola para girar a garrafa.";
    this.beginTurn();
  }

  snapshot(): ImpostorPublicState {
    return {
      phase: this.phase,
      players: this.players.map((p) => ({ ...p })),
      turn: this.turn,
      balls: this.balls.map((b) => ({ id: b.id, x: b.x, z: b.z, out: b.out })),
      ballInHand: false,
      turnEndsAt: this.turnEndsAt,
      message: this.message,
      winner: this.winner,
      impostor: this.revealedImpostor,
      bottle: this.bottle,
      decisionTarget: this.decisionTarget,
      lastHit: this.lastHit,
      shotId: this.shotId,
      serverNow: Date.now(),
    };
  }

  /** Para quem entra/reconecta: o estado público e, se for o Impostor, o seu papel. */
  sendStateTo(send: (type: string, payload: unknown) => void, playerId?: string) {
    send(S.Impostor, this.snapshot());
    if (playerId && playerId === this.impostor) send(S.Role, { role: "impostor" satisfies ImpostorRole });
  }

  // ---------------------------------------------------------------- entradas
  handleShoot(id: string, raw: unknown) {
    if (this.phase !== "aim" || id !== this.turn || typeof raw !== "object" || raw === null) return;
    const { angle, power } = raw as { angle?: unknown; power?: unknown };
    if (!num(angle) || !num(power)) return;
    const p = Math.min(1, Math.max(POOL.minPower, power));
    this.clearTimers();
    const result = simulateShot(this.balls, angle, p);
    this.phase = "shooting";
    this.turnEndsAt = null;
    this.shotId += 1;
    const msg: PoolShotMsg = { shotId: this.shotId, shooter: id, angle, power: p, recording: result.recording };
    this.host.send(S.PoolShot, msg);
    this.emitState();
    this.later(result.recording.totalMs + IMPOSTOR_RULES.settleMs, () => this.finishShot(result, id));
  }

  handleDecision(id: string, raw: unknown) {
    if (this.phase !== "decision" || id !== this.turn || typeof raw !== "object" || raw === null) return;
    const attack = (raw as { attack?: unknown }).attack;
    if (typeof attack !== "boolean") return;
    this.decide(attack);
  }

  removePlayer(id: string) {
    const p = this.players.find((x) => x.id === id);
    if (!p || !p.alive || this.ended || this.phase === "finished") return;
    p.alive = false;
    if (id === this.impostor) {
      p.revealed = "impostor";
      this.message = "O Impostor saiu da partida!";
      return this.finish("innocents");
    }
    p.revealed = null;
    const side = checkWinner(this.players, this.impostor);
    if (side) {
      this.message = "Restaram poucos jogadores.";
      return this.finish(side);
    }
    if (this.turn === id) {
      this.clearTimers();
      this.bottle = null;
      this.decisionTarget = null;
      this.advance();
    } else {
      this.emitState();
    }
  }

  dispose() {
    this.ended = true;
    this.clearTimers();
  }

  // ---------------------------------------------------------------- fluxo
  private aliveIds(): string[] {
    return this.players.filter((p) => p.alive).map((p) => p.id);
  }

  private beginTurn() {
    this.clearTimers();
    this.phase = "aim";
    this.bottle = null;
    this.decisionTarget = null;
    const ms = this.host.isAway(this.turn) ? IMPOSTOR_RULES.awayTurnMs : IMPOSTOR_RULES.turnMs;
    this.turnEndsAt = Date.now() + ms;
    this.later(ms, () => {
      this.message = "Tempo esgotado! A vez passa.";
      this.advance();
    });
    this.emitState();
  }

  private advance() {
    const next = nextShooter(this.order, new Set(this.aliveIds()), this.turn);
    if (!next) return this.finish("impostor");
    this.turn = next;
    this.beginTurn();
  }

  private finishShot(result: ShotResult, shooter: string) {
    this.balls = result.finalBalls;
    const cue = this.balls.find((b) => b.id === 0)!;
    if (cue.out) {
      // a branca que cai volta à posição inicial (sem bola na mão neste modo)
      const spot = findFreeSpot(this.balls, POOL.head, 0);
      cue.x = spot.x; cue.z = spot.z; cue.out = false;
    }
    if (this.balls.every((b) => b.id === 0 || b.out)) {
      // mesa limpa: novo triângulo
      const rack = rackBalls(rng);
      this.balls = rack;
    }
    if (!isValidShot(result.firstContact, result.pocketed)) {
      this.message = result.pocketed.includes(0) ? "Falta! A branca caiu: sem garrafa." : "Tacada sem encaçapar: a vez passa.";
      return this.advance();
    }
    this.startBottle(shooter);
  }

  private startBottle(shooter: string) {
    const target = pickBottleTarget(this.aliveIds(), shooter, rng);
    if (!target) return this.advance();
    this.phase = "bottle";
    this.bottle = { target, startAt: Date.now() + 300, durationMs: IMPOSTOR_RULES.bottleMs };
    this.message = "Tacada válida! A garrafa vai girar…";
    this.turnEndsAt = null;
    this.emitState();
    this.later(IMPOSTOR_RULES.bottleMs + 600, () => this.startDecision(target));
  }

  private startDecision(target: string) {
    this.phase = "decision";
    this.decisionTarget = target;
    this.turnEndsAt = Date.now() + IMPOSTOR_RULES.decisionMs;
    this.message = "A garrafa escolheu o alvo: atacar ou poupar?";
    this.later(IMPOSTOR_RULES.decisionMs, () => this.decide(false)); // sem decisão = poupar
    this.emitState();
  }

  private decide(attack: boolean) {
    const target = this.players.find((p) => p.id === this.decisionTarget);
    const attacker = this.turn;
    this.clearTimers();
    this.phase = "result";
    this.turnEndsAt = null;
    let eliminated = false;
    if (attack && target?.alive) {
      const out = applyHit(target.hits);
      target.hits = out.hits;
      eliminated = out.eliminated;
      if (eliminated) {
        target.alive = false;
        target.revealed = target.id === this.impostor ? "impostor" : "innocent";
      }
    }
    this.lastHit = { key: ++this.hitKey, attacker, target: target?.id ?? "", attacked: attack && !!target?.alive, eliminated };
    this.message = !attack ? "O alvo foi poupado." : eliminated
      ? `Eliminado! ${target?.revealed === "impostor" ? "Era o IMPOSTOR!" : "Era um inocente."}`
      : "Acertou! O alvo levou um golpe.";
    this.emitState();

    const side = checkWinner(this.players, this.impostor);
    if (side) {
      this.later(IMPOSTOR_RULES.resultMs, () => this.finish(side));
      return;
    }
    this.later(IMPOSTOR_RULES.resultMs, () => this.advance());
  }

  private finish(side: ImpostorSide) {
    if (this.ended || this.phase === "finished") return;
    this.clearTimers();
    this.phase = "finished";
    this.winner = side;
    this.revealedImpostor = this.impostor;
    for (const p of this.players) p.revealed = p.id === this.impostor ? "impostor" : (p.revealed ?? "innocent");
    this.turnEndsAt = null;
    this.bottle = null;
    this.decisionTarget = null;
    this.message = side === "innocents" ? "Os inocentes venceram!" : "O Impostor venceu!";
    this.emitState();
    this.host.onEnded();
  }

  // ---------------------------------------------------------------- utilitários
  private emitState() {
    this.host.send(S.Impostor, this.snapshot());
  }

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
