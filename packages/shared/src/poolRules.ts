import { groupOf, type PoolGroup } from "./pool";

/** Regras da bola 8 (versão simples do PRD). Função pura: recebe o resultado da tacada e devolve o novo estado do jogo. */

export interface RulesInput {
  shooter: string;
  opponent: string;
  groups: Record<string, PoolGroup | null>;
  /** Ids das bolas na mesa antes da tacada (sem a branca). */
  tableBefore: readonly number[];
  isBreak: boolean;
  firstContact: number | null;
  pocketed: readonly number[];
}

export type EndReason = "eight" | "eight-early" | "eight-foul" | "eight-scratch";

export interface RulesOutput {
  groups: Record<string, PoolGroup | null>;
  nextTurn: string;
  /** O próximo jogador pode posicionar a bola branca onde quiser. */
  ballInHand: boolean;
  foul: boolean;
  foulReason: string | null;
  winner: string | null;
  endReason: EndReason | null;
  /** Na quebra a bola 8 que cair volta para a mesa. */
  respotEight: boolean;
  message: string;
}

export const GROUP_LABEL: Record<PoolGroup, string> = { solid: "lisas", stripe: "listradas" };

export function resolveShot(inp: RulesInput): RulesOutput {
  const { shooter, opponent, isBreak } = inp;
  const groups = { ...inp.groups };
  const cueScratch = inp.pocketed.includes(0);
  const noContact = inp.firstContact === null;
  const foul = cueScratch || noContact;
  const foulReason = cueScratch ? "bola branca na caçapa" : noContact ? "a bola branca não tocou em nenhuma bola" : null;
  const pocketedBalls = inp.pocketed.filter((id) => id !== 0);
  const eight = pocketedBalls.includes(8);

  const base = { groups, foul, foulReason, respotEight: false, winner: null as string | null, endReason: null as EndReason | null };
  const other = (w: string) => (w === shooter ? opponent : shooter);

  if (eight && !isBreak) {
    const mine = groups[shooter];
    const remaining = mine ? inp.tableBefore.filter((id) => groupOf(id) === mine).length : 99;
    if (remaining === 0 && !foul) {
      return { ...base, nextTurn: shooter, ballInHand: false, winner: shooter, endReason: "eight", message: "Encaçapou a bola 8 e venceu!" };
    }
    const reason: EndReason = cueScratch ? "eight-scratch" : foul ? "eight-foul" : "eight-early";
    const msg = reason === "eight-early" ? "Encaçapou a bola 8 antes da hora e perdeu!" : "Falta ao encaçapar a bola 8: derrota!";
    return { ...base, nextTurn: opponent, ballInHand: false, winner: other(shooter), endReason: reason, message: msg };
  }

  // Grupos: definidos na primeira tacada válida depois da quebra
  if (!isBreak && !foul && !groups[shooter]) {
    const first = pocketedBalls.find((id) => groupOf(id) !== null);
    if (first !== undefined) {
      groups[shooter] = groupOf(first)!;
      groups[opponent] = groups[shooter] === "solid" ? "stripe" : "solid";
    }
  }

  const mine = groups[shooter];
  const scoredLegal = pocketedBalls.some((id) => id !== 8 && (isBreak || !mine || groupOf(id) === mine));
  const respotEight = eight && isBreak;

  if (foul) {
    return { ...base, groups, respotEight, nextTurn: opponent, ballInHand: true, message: `Falta: ${foulReason}. Bola na mão para o adversário.` };
  }
  if (scoredLegal) {
    const assigned = !inp.groups[shooter] && mine ? ` Você joga com as ${GROUP_LABEL[mine]}.` : "";
    return { ...base, groups, respotEight, nextTurn: shooter, ballInHand: false, message: `Encaçapou! Joga de novo.${assigned}` };
  }
  return { ...base, groups, respotEight, nextTurn: opponent, ballInHand: false, message: isBreak ? "Quebra sem encaçapar." : "Passa a vez." };
}
