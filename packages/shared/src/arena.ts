/** Regras e constantes da arena de combate (usadas pelo servidor autoritativo e pelo cliente). */

export type AttackKind = "punch" | "kick" | "shove";
export type ArenaActionKind = AttackKind | "dodge";

export const ARENA = {
  radius: 7.5,
  hp: 100,
  walkSpeed: 5,
  runSpeed: 8,
  accel: 14,
  airControl: 0.4,
  gravity: 26,
  jumpVelocity: 8,
  fallY: -4,
  kbDecay: 6,
  tickMs: 50,
  countdownMs: 3000,
  maxMs: 90_000,
  endDelayMs: 2200,
  bodyRadius: 0.5,
  dodgeDistance: 4,
  dodgeCooldownMs: 900,
  attacks: {
    // reach: alcance (u) · dmg: dano · kb: empurrão horizontal · lift: impulso vertical · windupMs: tempo até acertar
    // recoverMs: recuperação · stunMs: atordoamento de quem leva o golpe
    punch: { reach: 1.9, dmg: 8, kb: 5, lift: 0, windupMs: 120, recoverMs: 230, stunMs: 250 },
    kick: { reach: 2.3, dmg: 12, kb: 8, lift: 3, windupMs: 220, recoverMs: 420, stunMs: 350 },
    shove: { reach: 1.8, dmg: 3, kb: 12, lift: 0, windupMs: 150, recoverMs: 650, stunMs: 300 },
  },
  coneDeg: 75,
} as const;

export interface FighterSnap {
  id: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  hp: number;
  action: { kind: AttackKind; startAt: number } | null;
  hitAt: number; // quando levou o último golpe (para a animação de recuo)
  stunned: boolean;
  falling: boolean;
}

export type ArenaPhase = "countdown" | "fight" | "ended";

export interface ArenaSnapshot {
  phase: ArenaPhase;
  fighters: FighterSnap[];
  startsAt: number; // fim da contagem regressiva
  endsAt: number; // limite de tempo
  winner: string | null;
  reason: "ko" | "queda" | "tempo" | "desistencia" | null;
  serverNow: number;
}

export type ArenaEvent =
  | { kind: "hit"; attacker: string; target: string; attack: AttackKind; dmg: number }
  | { kind: "splash"; id: string; x: number; z: number }
  | { kind: "end"; winner: string; loser: string; reason: "ko" | "queda" | "tempo" | "desistencia" };

export interface ArenaInput {
  mx: number;
  mz: number;
  run: boolean;
  jump: boolean;
}

export interface ArenaActionMsg {
  kind: ArenaActionKind;
  dx?: number;
  dz?: number;
}

/** Posições iniciais dos dois lutadores. */
export const ARENA_SPAWNS: [{ x: number; z: number; ry: number }, { x: number; z: number; ry: number }] = [
  { x: -3, z: 0, ry: -Math.PI / 2 },
  { x: 3, z: 0, ry: Math.PI / 2 },
];
