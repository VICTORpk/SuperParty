import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS, MAX_CHAT_LENGTH, MAX_NICK_LENGTH, ROOM_CODE_LENGTH,
  generateRoomCode, isValidRoomCode, normalizeRoomCode,
  sanitizeChat, sanitizeColor, sanitizeNick,
} from "./index";

describe("sanitizeNick", () => {
  it("remove espaços e caracteres de controle", () => {
    expect(sanitizeNick("  Ana\u0000​  Maria ")).toBe("Ana Maria");
  });
  it("limita o tamanho", () => {
    expect(Array.from(sanitizeNick("x".repeat(100)))).toHaveLength(MAX_NICK_LENGTH);
  });
  it("rejeita tipos inválidos", () => {
    expect(sanitizeNick(42)).toBe("");
    expect(sanitizeNick(undefined)).toBe("");
  });
});

describe("sanitizeChat", () => {
  it("limita a 200 caracteres", () => {
    expect(Array.from(sanitizeChat("a".repeat(500)))).toHaveLength(MAX_CHAT_LENGTH);
  });
  it("mensagem vazia vira string vazia", () => {
    expect(sanitizeChat("   \n ")).toBe("");
  });
  it("mantém tags como texto puro (escape é feito na renderização)", () => {
    expect(sanitizeChat("<b>oi</b>")).toBe("<b>oi</b>");
  });
});

describe("sanitizeColor", () => {
  it("aceita apenas cores da paleta", () => {
    expect(sanitizeColor(AVATAR_COLORS[3])).toBe(AVATAR_COLORS[3]);
    expect(sanitizeColor("red; background:url(x)")).toBe(AVATAR_COLORS[0]);
  });
});

describe("room code", () => {
  it("gera códigos válidos", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });
  it("normaliza entrada do usuário", () => {
    expect(normalizeRoomCode(" ab-c d2 ")).toBe("ABCD2");
    expect(normalizeRoomCode(null)).toBe("");
  });
  it("rejeita código com caracteres ambíguos ou tamanho errado", () => {
    expect(isValidRoomCode("ABCD0")).toBe(false);
    expect(isValidRoomCode("ABC")).toBe(false);
  });
});

import { MAX_SPEED, WORLD_RADIUS, sanitizeAngle, spawnPoint, stepMove } from "./index";

describe("stepMove", () => {
  it("aceita movimento dentro da velocidade", () => {
    expect(stepMove({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 100)).toEqual({ x: 0.5, z: 0 });
  });
  it("limita teletransporte pela velocidade máxima", () => {
    const r = stepMove({ x: 0, z: 0 }, { x: 15, z: 0 }, 100)!;
    expect(r.x).toBeLessThanOrEqual(MAX_SPEED * 0.1 + 0.1 + 1e-9);
    expect(r.x).toBeGreaterThan(0);
  });
  it("mantém dentro do mundo", () => {
    const r = stepMove({ x: WORLD_RADIUS - 0.1, z: 0 }, { x: WORLD_RADIUS + 5, z: 0 }, 1000)!;
    expect(Math.hypot(r.x, r.z)).toBeLessThanOrEqual(WORLD_RADIUS + 1e-9);
  });
  it("rejeita NaN, Infinity e tipos inválidos", () => {
    expect(stepMove({ x: 0, z: 0 }, { x: NaN, z: 0 }, 100)).toBeNull();
    expect(stepMove({ x: 0, z: 0 }, { x: Infinity, z: 0 }, 100)).toBeNull();
    expect(stepMove({ x: 0, z: 0 }, "x", 100)).toBeNull();
    expect(stepMove({ x: 0, z: 0 }, { x: "1", z: 0 }, 100)).toBeNull();
  });
});

describe("spawn e ângulo", () => {
  it("gera 10 pontos distintos dentro do mundo", () => {
    const pts = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(spawnPoint(i).x.toFixed(3) + spawnPoint(i).z.toFixed(3))));
    expect(pts.size).toBe(10);
  });
  it("sanitizeAngle descarta valores inválidos", () => {
    expect(sanitizeAngle(NaN)).toBe(0);
    expect(sanitizeAngle("a")).toBe(0);
    expect(sanitizeAngle(1)).toBe(1);
  });
});

import { DODGE_COOLDOWN_MS, DODGE_DISTANCE, DODGE_MAX_DISTANCE, EMOTES, isEmote, validateDodge } from "./index";

describe("validateDodge", () => {
  const origin = { x: 0, z: 0 };
  it("aceita esquiva dentro da distância e após o recarregamento", () => {
    expect(validateDodge(origin, { x: DODGE_DISTANCE, z: 0 }, 10_000, 0)).toEqual({ x: DODGE_DISTANCE, z: 0 });
  });
  it("rejeita esquiva em recarga", () => {
    expect(validateDodge(origin, { x: 1, z: 0 }, 1000, 1000 - DODGE_COOLDOWN_MS * 0.5)).toBeNull();
  });
  it("rejeita teleporte longo e valores inválidos", () => {
    expect(validateDodge(origin, { x: DODGE_MAX_DISTANCE + 1, z: 0 }, 10_000, 0)).toBeNull();
    expect(validateDodge(origin, { x: NaN, z: 0 }, 10_000, 0)).toBeNull();
    expect(validateDodge(origin, null, 10_000, 0)).toBeNull();
  });
  it("mantém dentro do mundo", () => {
    const r = validateDodge({ x: WORLD_RADIUS - 1, z: 0 }, { x: WORLD_RADIUS + 2, z: 0 }, 10_000, 0)!;
    expect(Math.hypot(r.x, r.z)).toBeLessThanOrEqual(WORLD_RADIUS + 1e-9);
  });
});

describe("emotes", () => {
  it("valida apenas ids conhecidos", () => {
    for (const e of EMOTES) expect(isEmote(e.id)).toBe(true);
    expect(isEmote("hack")).toBe(false);
    expect(isEmote(42)).toBe(false);
  });
});

import { MAX_JUMP_Y, sanitizeHeight } from "./index";

describe("sanitizeHeight", () => {
  it("limita a altura do pulo e rejeita valores inválidos", () => {
    expect(sanitizeHeight(1)).toBe(1);
    expect(sanitizeHeight(99)).toBe(MAX_JUMP_Y);
    expect(sanitizeHeight(-3)).toBe(0);
    expect(sanitizeHeight(NaN)).toBe(0);
    expect(sanitizeHeight("2")).toBe(0);
  });
});

import {
  BOARD_LENGTH, BOARD_RULES, CHALLENGE_CONFIG, CHALLENGE_TILES, FINAL_TILE, PAD_COLORS,
  clampTile, clicksSuccess, colorsCheck, cursorAt, isChallengeTile, pickColors, powerSuccess, shuffle, tilePath,
} from "./index";

describe("tabuleiro", () => {
  it("tem 40 casas e as casas de desafio são válidas", () => {
    expect(BOARD_LENGTH).toBe(40);
    for (const t of CHALLENGE_TILES) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(FINAL_TILE);
      expect(isChallengeTile(t)).toBe(true);
    }
    expect(isChallengeTile(0)).toBe(false);
    expect(new Set(CHALLENGE_TILES).size).toBe(CHALLENGE_TILES.length);
  });
  it("regras configuráveis seguem o PRD", () => {
    expect(BOARD_RULES.successBonus).toBe(2);
    expect(BOARD_RULES.failAdvance).toBe(1);
    expect(BOARD_RULES.encounterLoserBack).toBe(1);
    expect(BOARD_RULES.encounterWinnerAdvance).toBe(2);
  });
  it("clampTile e tilePath", () => {
    expect(clampTile(100)).toBe(FINAL_TILE);
    expect(clampTile(-4)).toBe(0);
    expect(tilePath(2, 5)).toEqual([3, 4, 5]);
    expect(tilePath(5, 2)).toEqual([4, 3, 2]);
    expect(tilePath(3, 3)).toEqual([]);
  });
});

describe("desafios", () => {
  it("o cursor da barra de força vai e volta entre 0 e 1", () => {
    const p = CHALLENGE_CONFIG.power.periodMs;
    expect(cursorAt(0, p)).toBe(0);
    expect(cursorAt(p / 2, p)).toBe(1);
    expect(cursorAt(p, p)).toBeCloseTo(0);
    expect(cursorAt(p / 4, p)).toBeCloseTo(0.5);
  });
  it("sucesso da barra: dentro da zona (com tolerância) e não fora dela", () => {
    const p = CHALLENGE_CONFIG.power.periodMs;
    expect(powerSuccess(p / 4, 0.5)).toBe(true);
    expect(powerSuccess(0, 0.5)).toBe(false);
  });
  it("sequência de cores: parcial, errada e completa", () => {
    expect(colorsCheck([0, 1, 2], [0, 1])).toBe("partial");
    expect(colorsCheck([0, 1, 2], [0, 2])).toBe("wrong");
    expect(colorsCheck([0, 1, 2], [0, 1, 2])).toBe("done");
  });
  it("sequência sorteada usa apenas cores válidas", () => {
    const seq = pickColors(() => 3);
    expect(seq).toHaveLength(CHALLENGE_CONFIG.colors.length);
    expect(seq.every((c) => c >= 0 && c < PAD_COLORS.length)).toBe(true);
  });
  it("cliques: precisa atingir a meta", () => {
    expect(clicksSuccess(CHALLENGE_CONFIG.clicks.target - 1)).toBe(false);
    expect(clicksSuccess(CHALLENGE_CONFIG.clicks.target)).toBe(true);
  });
  it("shuffle preserva os elementos", () => {
    const out = shuffle([1, 2, 3, 4, 5], (n) => n - 1);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

import { ARENA, GAMES, GAME_IDS, STATION_LEAVE_RADIUS, STATION_RADIUS, isGameId } from "./index";

describe("jogos e estações", () => {
  it("cada jogo tem mínimo e máximo coerentes", () => {
    for (const id of GAME_IDS) {
      expect(GAMES[id].min).toBeGreaterThanOrEqual(2);
      expect(GAMES[id].max).toBeGreaterThanOrEqual(GAMES[id].min);
    }
    expect(GAMES.impostor.min).toBe(4);
    expect(GAMES.board.available).toBe(true);
  });
  it("as estações ficam dentro do mundo e não se sobrepõem", () => {
    for (const a of GAME_IDS) {
      expect(Math.hypot(GAMES[a].station.x, GAMES[a].station.z)).toBeLessThan(WORLD_RADIUS);
      for (const b of GAME_IDS) {
        if (a === b) continue;
        const d = Math.hypot(GAMES[a].station.x - GAMES[b].station.x, GAMES[a].station.z - GAMES[b].station.z);
        expect(d).toBeGreaterThan(STATION_LEAVE_RADIUS + STATION_RADIUS);
      }
    }
  });
  it("isGameId valida", () => {
    expect(isGameId("board")).toBe(true);
    expect(isGameId("hack")).toBe(false);
    expect(isGameId(3)).toBe(false);
  });
});

describe("arena", () => {
  it("golpes têm valores positivos e o chute é o mais forte em dano", () => {
    const a = ARENA.attacks;
    expect(a.kick.dmg).toBeGreaterThan(a.punch.dmg);
    expect(a.shove.kb).toBeGreaterThan(a.punch.kb);
    for (const k of ["punch", "kick", "shove"] as const) {
      expect(a[k].reach).toBeGreaterThan(0);
      expect(a[k].windupMs).toBeGreaterThan(0);
    }
  });
  it("os lutadores começam dentro da plataforma", () => {
    expect(ARENA.radius).toBeGreaterThan(4);
    expect(ARENA.hp).toBe(100);
  });
});

import {
  IMPOSTOR_RULES, applyHit, checkWinner, isValidShot, nextShooter, pickBottleTarget, type ImpostorPlayer,
} from "./index";

describe("sinuca Impostor (regras puras)", () => {
  const mk = (ids: string[], dead: string[] = []): ImpostorPlayer[] => ids.map((id) => ({ id, hits: 0, alive: !dead.includes(id), revealed: null }));

  it("o 3º acerto elimina; 1º e 2º não", () => {
    expect(applyHit(0)).toEqual({ hits: 1, eliminated: false });
    expect(applyHit(1)).toEqual({ hits: 2, eliminated: false });
    expect(applyHit(2)).toEqual({ hits: 3, eliminated: true });
    expect(IMPOSTOR_RULES.hitsToEliminate).toBe(3);
  });
  it("tacada válida: encaçapa bola, toca em alguma e a branca não cai", () => {
    expect(isValidShot(3, [5])).toBe(true);
    expect(isValidShot(3, [])).toBe(false);
    expect(isValidShot(null, [5])).toBe(false);
    expect(isValidShot(3, [5, 0])).toBe(false);
    expect(isValidShot(3, [0])).toBe(false);
  });
  it("a garrafa nunca sorteia o autor e só sorteia ativos", () => {
    const alive = ["A", "B", "C", "D"];
    for (let i = 0; i < 4; i++) for (const r of [0, 1, 2]) expect(pickBottleTarget(alive, "A", () => r % 3)).not.toBe("A");
    expect(pickBottleTarget(["A"], "A", () => 0)).toBeNull();
    const seen = new Set<string>();
    for (let k = 0; k < 3; k++) seen.add(pickBottleTarget(alive, "B", (n) => k % n)!);
    expect(seen).toEqual(new Set(["A", "C", "D"]));
  });
  it("rodízio: pula eliminados e dá a volta", () => {
    const order = ["A", "B", "C", "D"];
    expect(nextShooter(order, new Set(order), "A")).toBe("B");
    expect(nextShooter(order, new Set(["A", "C", "D"]), "A")).toBe("C");
    expect(nextShooter(order, new Set(order), "D")).toBe("A");
    expect(nextShooter(order, new Set(["A", "B"]), "B")).toBe("A");
    expect(nextShooter(order, new Set(["B", "C"]), "A")).toBe("B"); // quem tacou saiu: segue para o próximo vivo
    expect(nextShooter(order, new Set(), "A")).toBeNull();
  });
  it("vitória: inocentes eliminando o Impostor; Impostor com 2 ativos", () => {
    expect(checkWinner(mk(["A", "B", "C", "D"]), "A")).toBeNull();
    expect(checkWinner(mk(["A", "B", "C", "D"], ["A"]), "A")).toBe("innocents");
    expect(checkWinner(mk(["A", "B", "C", "D"], ["B"]), "A")).toBeNull();
    expect(checkWinner(mk(["A", "B", "C", "D"], ["B", "C"]), "A")).toBe("impostor");
    expect(checkWinner(mk(["A", "B", "C", "D", "E"], ["B", "C"]), "A")).toBeNull();
  });
});
