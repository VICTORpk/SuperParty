import {
  ARENA, ARENA_SPAWNS, S,
  type ArenaActionMsg, type ArenaEvent, type ArenaInput, type ArenaPhase, type ArenaSnapshot, type AttackKind, type FighterSnap,
} from "@jogo/shared";

export interface ArenaHost {
  send(type: string, payload: unknown): void;
  isAway(playerId: string): boolean;
  onEnded(winner: string, loser: string, reason: NonNullable<ArenaSnapshot["reason"]>): void;
}

interface Fighter {
  id: string;
  x: number; y: number; z: number;
  vx: number; vz: number; vy: number; // velocidade de movimento
  kx: number; kz: number; // empurrão (decai com o tempo)
  ry: number;
  hp: number;
  input: ArenaInput;
  grounded: boolean;
  falling: boolean;
  splashed: boolean;
  stun: number; // segundos
  action: { kind: AttackKind; startAt: number; hitAt: number; doneAt: number; hit: boolean } | null;
  hitAt: number;
  lastDodge: number;
}

const ATTACKS: readonly AttackKind[] = ["punch", "kick", "shove"];
const clamp1 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/**
 * Luta 1×1 em uma plataforma circular sobre a água. O servidor simula tudo (movimento, pulo, golpes, empurrões,
 * vida e queda); os clientes só enviam intenções e desenham os quadros recebidos.
 */
export class ArenaBattle {
  private fighters: [Fighter, Fighter];
  private phase: ArenaPhase = "countdown";
  private startsAt = Date.now() + ARENA.countdownMs;
  private endsAt = this.startsAt + ARENA.maxMs;
  private winner: string | null = null;
  private reason: ArenaSnapshot["reason"] = null;
  private timer: NodeJS.Timeout | null = null;
  private endTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private host: ArenaHost, a: string, b: string) {
    const mk = (id: string, i: 0 | 1): Fighter => ({
      id, x: ARENA_SPAWNS[i].x, y: 0, z: ARENA_SPAWNS[i].z, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, ry: ARENA_SPAWNS[i].ry,
      hp: ARENA.hp, input: { mx: 0, mz: 0, run: false, jump: false }, grounded: true, falling: false, splashed: false,
      stun: 0, action: null, hitAt: 0, lastDodge: 0,
    });
    this.fighters = [mk(a, 0), mk(b, 1)];
  }

  start() {
    this.timer = setInterval(() => this.tick(), ARENA.tickMs);
    this.broadcast();
  }

  has(id: string): boolean {
    return this.fighters.some((f) => f.id === id);
  }

  // ---------------------------------------------------------------- entradas
  handleInput(id: string, raw: unknown) {
    const f = this.find(id);
    if (!f || typeof raw !== "object" || raw === null) return;
    const r = raw as Partial<ArenaInput>;
    f.input.mx = clamp1(r.mx);
    f.input.mz = clamp1(r.mz);
    f.input.run = r.run === true;
    if (r.jump === true) f.input.jump = true; // consumido no próximo quadro
  }

  handleAction(id: string, raw: unknown) {
    const f = this.find(id);
    if (!f || this.phase !== "fight" || typeof raw !== "object" || raw === null || f.falling || f.stun > 0) return;
    const msg = raw as ArenaActionMsg;
    const now = Date.now();
    if (f.action && now < f.action.doneAt) return;

    if (msg.kind === "dodge") {
      if (now - f.lastDodge < ARENA.dodgeCooldownMs) return;
      let dx = typeof msg.dx === "number" && Number.isFinite(msg.dx) ? msg.dx : 0;
      let dz = typeof msg.dz === "number" && Number.isFinite(msg.dz) ? msg.dz : 0;
      const l = Math.hypot(dx, dz);
      if (l < 1e-3) return;
      dx /= l; dz /= l;
      let nx = f.x + dx * ARENA.dodgeDistance, nz = f.z + dz * ARENA.dodgeDistance;
      const r = Math.hypot(nx, nz);
      const lim = ARENA.radius - 0.4;
      if (r > lim) { nx = (nx / r) * lim; nz = (nz / r) * lim; } // a esquiva nunca joga o lutador para fora
      f.x = nx; f.z = nz; f.lastDodge = now;
      return;
    }
    if (!ATTACKS.includes(msg.kind as AttackKind)) return;
    const kind = msg.kind as AttackKind;
    const def = ARENA.attacks[kind];
    // mira assistida: vira para o oponente se ele estiver perto
    const o = this.opponent(f);
    const dist = Math.hypot(o.x - f.x, o.z - f.z);
    if (dist < def.reach * 1.8 && dist > 1e-3) f.ry = Math.atan2(-(o.x - f.x), -(o.z - f.z));
    f.action = { kind, startAt: now, hitAt: now + def.windupMs, doneAt: now + def.windupMs + def.recoverMs, hit: false };
  }

  forfeit(id: string) {
    const f = this.find(id);
    if (!f || this.phase === "ended") return;
    this.end(this.opponent(f).id, id, "desistencia");
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.endTimer) clearTimeout(this.endTimer);
  }

  snapshot(): ArenaSnapshot {
    return {
      phase: this.phase,
      fighters: this.fighters.map((f): FighterSnap => ({
        id: f.id, x: f.x, y: f.y, z: f.z, ry: f.ry, hp: Math.max(0, Math.round(f.hp)),
        action: f.action ? { kind: f.action.kind, startAt: f.action.startAt } : null,
        hitAt: f.hitAt, stunned: f.stun > 0, falling: f.falling,
      })),
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      winner: this.winner,
      reason: this.reason,
      serverNow: Date.now(),
    };
  }

  // ---------------------------------------------------------------- simulação
  private tick() {
    if (this.disposed) return;
    const now = Date.now();
    const dt = ARENA.tickMs / 1000;
    if (this.phase === "countdown" && now >= this.startsAt) this.phase = "fight";

    if (this.phase !== "ended") {
      for (const f of this.fighters) this.simulate(f, dt, now);
      this.separate();
      for (const f of this.fighters) this.resolveHit(f, now);
      this.checkEnd(now);
    }
    this.broadcast();
  }

  private simulate(f: Fighter, dt: number, now: number) {
    const fighting = this.phase === "fight";
    f.stun = Math.max(0, f.stun - dt);
    const away = this.host.isAway(f.id);
    const canMove = fighting && f.stun <= 0 && !f.falling && !away;

    let mx = canMove ? f.input.mx : 0, mz = canMove ? f.input.mz : 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const busy = f.action && now < f.action.doneAt;
    const speed = (f.input.run ? ARENA.runSpeed : ARENA.walkSpeed) * (busy ? 0.4 : 1);
    const control = f.grounded ? 1 : ARENA.airControl;
    const k = Math.min(1, ARENA.accel * dt * control);
    f.vx += (mx * speed - f.vx) * k;
    f.vz += (mz * speed - f.vz) * k;
    if (len > 0.05 && !busy) f.ry = Math.atan2(-mx, -mz);

    if (canMove && f.input.jump && f.grounded) { f.vy = ARENA.jumpVelocity; f.grounded = false; }
    f.input.jump = false;

    f.x += (f.vx + f.kx) * dt;
    f.z += (f.vz + f.kz) * dt;
    const decay = Math.exp(-ARENA.kbDecay * dt);
    f.kx *= decay; f.kz *= decay;

    const over = Math.hypot(f.x, f.z) <= ARENA.radius;
    if (f.grounded && !over) { f.grounded = false; f.falling = true; } // saiu da borda andando ou empurrado
    if (!f.grounded) {
      f.y += f.vy * dt;
      f.vy -= ARENA.gravity * dt;
      if (f.y <= 0 && f.vy <= 0) {
        if (over && !f.falling) { f.y = 0; f.vy = 0; f.grounded = true; } else f.falling = true;
      }
    }
    if (f.falling && !f.splashed && f.y < -1) {
      f.splashed = true;
      this.emit({ kind: "splash", id: f.id, x: f.x, z: f.z });
    }
    if (f.action && now >= f.action.doneAt) f.action = null;
  }

  /** Impede que os dois lutadores fiquem um dentro do outro. */
  private separate() {
    const [a, b] = this.fighters;
    if (a.falling || b.falling) return;
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const min = ARENA.bodyRadius * 2;
    if (d < min && d > 1e-4) {
      const push = (min - d) / 2;
      a.x -= (dx / d) * push; a.z -= (dz / d) * push;
      b.x += (dx / d) * push; b.z += (dz / d) * push;
    }
  }

  private resolveHit(f: Fighter, now: number) {
    const act = f.action;
    if (!act || act.hit || now < act.hitAt || this.phase !== "fight") return;
    act.hit = true;
    const def = ARENA.attacks[act.kind];
    const t = this.opponent(f);
    if (t.falling) return;
    const dx = t.x - f.x, dz = t.z - f.z;
    const dist = Math.hypot(dx, dz);
    if (dist > def.reach + 0.2 || Math.abs(t.y - f.y) > 1.4) return;
    const fx = -Math.sin(f.ry), fz = -Math.cos(f.ry);
    const dot = dist > 1e-3 ? (fx * dx + fz * dz) / dist : 1;
    if (dot < Math.cos((ARENA.coneDeg * Math.PI) / 180)) return;

    t.hp -= def.dmg;
    const nx = dist > 1e-3 ? dx / dist : fx, nz = dist > 1e-3 ? dz / dist : fz;
    t.kx += nx * def.kb; t.kz += nz * def.kb;
    if (def.lift) { t.vy = def.lift; t.grounded = false; }
    t.stun = def.stunMs / 1000;
    t.hitAt = now;
    if (t.action && !t.action.hit) t.action = null; // o golpe interrompe o ataque de quem foi atingido
    this.emit({ kind: "hit", attacker: f.id, target: t.id, attack: act.kind, dmg: def.dmg });
  }

  private checkEnd(now: number) {
    const [a, b] = this.fighters;
    const out = (f: Fighter) => f.falling && f.y < ARENA.fallY;
    const ko = (f: Fighter) => f.hp <= 0;
    if (out(a) || out(b) || ko(a) || ko(b)) {
      const loser = out(a) || out(b)
        ? (out(a) && out(b) ? (a.hp <= b.hp ? a : b) : out(a) ? a : b)
        : (ko(a) && ko(b) ? (a.hp <= b.hp ? a : b) : ko(a) ? a : b);
      this.end(this.opponent(loser).id, loser.id, out(loser) ? "queda" : "ko");
    } else if (now >= this.endsAt) {
      const loser = a.hp === b.hp ? this.fighters[Math.floor(Math.random() * 2)]! : a.hp < b.hp ? a : b;
      this.end(this.opponent(loser).id, loser.id, "tempo");
    }
  }

  private end(winner: string, loser: string, reason: NonNullable<ArenaSnapshot["reason"]>) {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.winner = winner;
    this.reason = reason;
    this.emit({ kind: "end", winner, loser, reason });
    this.broadcast();
    this.endTimer = setTimeout(() => {
      if (this.timer) clearInterval(this.timer);
      if (!this.disposed) this.host.onEnded(winner, loser, reason);
    }, ARENA.endDelayMs);
  }

  // ---------------------------------------------------------------- utilitários
  private find(id: string): Fighter | undefined {
    return this.fighters.find((f) => f.id === id);
  }

  private opponent(f: Fighter): Fighter {
    return this.fighters[0] === f ? this.fighters[1] : this.fighters[0];
  }

  private broadcast() {
    this.host.send(S.Arena, this.snapshot());
  }

  private emit(e: ArenaEvent) {
    this.host.send(S.ArenaEvent, e);
  }
}
