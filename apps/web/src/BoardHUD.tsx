import { useEffect, useRef, useState } from "react";
import {
  BOARD_RULES, CHALLENGE_CONFIG, PAD_COLORS, RED_TILE_BACK, cursorAt,
  type BoardPublicState, type ChallengeInput, type ChallengePublic, type PlayerInfo,
} from "@jogo/shared";

type Ref<T> = React.MutableRefObject<T>;

export interface RollInfo { key: number; playerId: string; value: number }

interface Props {
  state: BoardPublicState;
  players: PlayerInfo[];
  you: string;
  isHost: boolean;
  offsetRef: Ref<number>;
  roll: RollInfo | null;
  onRoll: () => void;
  onChallenge: (input: ChallengeInput) => void;
  onEnd: () => void;
}

/** Relógio sincronizado com o servidor, atualizado a cada quadro. */
function useServerNow(offsetRef: Ref<number>, active: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offsetRef.current);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => { setNow(Date.now() + offsetRef.current); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [offsetRef, active]);
  return now;
}

const isTyping = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;

export function BoardHUD({ state, players, you, isHost, offsetRef, roll, onRoll, onChallenge, onEnd }: Props) {
  const nick = (id: string) => players.find((p) => p.id === id)?.nick ?? "?";
  const color = (id: string) => players.find((p) => p.id === id)?.color ?? "#999";
  const myTurn = state.turn === you;
  const ch = state.challenge;
  const now = useServerNow(offsetRef, state.phase !== "finished");

  // atalhos: Espaço rola o dado / para a barra / clica; 1–4 escolhem cores
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.repeat || !myTurn) return;
      if (e.code === "Space") {
        if (state.phase === "roll") { e.preventDefault(); onRoll(); }
        else if (state.phase === "challenge" && ch && !ch.result) {
          if (ch.kind === "power") { e.preventDefault(); onChallenge({ action: "stop" }); }
          else if (ch.kind === "clicks") { e.preventDefault(); onChallenge({ action: "click" }); }
        }
      } else if (state.phase === "challenge" && ch?.kind === "colors" && !ch.result) {
        const m = /^Digit([1-4])$/.exec(e.code);
        if (m) onChallenge({ action: "pick", color: Number(m[1]) - 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, state.phase, ch, onRoll, onChallenge]);

  const ranking = [...state.order].sort((a, b) => (state.positions[b] ?? 0) - (state.positions[a] ?? 0));
  const left = state.turnEndsAt ? Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000)) : null;

  return (
    <>
      <div className="hud top-left panel ranking">
        <h2>Corrida · rodada {state.round}</h2>
        <ol>
          {ranking.map((id) => (
            <li key={id} className={id === state.turn ? "turn" : ""}>
              <span className="dot" style={{ background: color(id) }} />
              <span className="rname">{nick(id)}{id === you ? " (você)" : ""}</span>
              <span className="rpos">{state.positions[id]}/{(state.size - 1)}</span>
              <div className="rbar"><div style={{ width: `${((state.positions[id] ?? 0) / (state.size - 1)) * 100}%`, background: color(id) }} /></div>
            </li>
          ))}
        </ol>
        <p className="muted legend">🟥 casa vermelha: volta {RED_TILE_BACK} · ⚡ atalho: pula adiante · ❗ desafio</p>
      </div>

      {state.phase !== "finished" && (
        <div className="hud turnbanner panel">
          <span className="dot" style={{ background: color(state.turn) }} />
          {myTurn ? "Sua vez!" : `Vez de ${nick(state.turn)}`}
          {state.phase === "roll" && left !== null && <span className="muted"> · {left}s</span>}
        </div>
      )}

      {state.phase === "roll" && (
        <div className="hud rollbox">
          {myTurn
            ? <button className="primary bigbtn" onClick={onRoll}>🎲 Rolar o dado <small>(Espaço)</small></button>
            : <div className="panel">Aguardando {nick(state.turn)} rolar o dado…</div>}
        </div>
      )}

      {roll && <Dice key={roll.key} roll={roll} name={nick(roll.playerId)} />}
      {state.phase === "encounter" && (
        <div className="hud banner panel">⚔️ Encontro! {nick(state.duel?.[0] ?? "")} e {nick(state.duel?.[1] ?? "")} vão lutar na arena…</div>
      )}
      {state.phase === "challenge" && ch && (
        <ChallengeView ch={ch} now={now} mine={myTurn} who={nick(state.turn)} onInput={onChallenge} />
      )}
      {state.phase === "finished" && state.winner && (
        <div className="overlay">
          <div className="panel winner">
            <div className="trophy">🏆</div>
            <h2>{nick(state.winner)} venceu!</h2>
            <p className="muted">Voltando ao lobby em alguns segundos…</p>
            {isHost && <button className="primary" onClick={onEnd}>Voltar ao lobby agora</button>}
          </div>
        </div>
      )}
    </>
  );
}

/** Aviso com o resultado do dado (o bloco 3D aparece sobre a cabeça da peça). */
function Dice({ roll, name }: { roll: RollInfo; name: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    const t1 = setTimeout(() => setShown(true), 800);
    const t2 = setTimeout(() => setShown(false), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [roll]);
  if (!shown) return null;
  return <div className="hud dice-label toplabel">🎲 {name} tirou {roll.value}</div>;
}

const CHALLENGE_NAMES = { power: "Barra de força", colors: "Sequência de cores", clicks: "Cliques rápidos" } as const;

function ChallengeView({ ch, now, mine, who, onInput }:
  { ch: ChallengePublic; now: number; mine: boolean; who: string; onInput: (i: ChallengeInput) => void }) {
  const preparing = now < ch.startAt;
  const result = ch.result;
  return (
    <div className="hud challenge panel">
      <h3>⚡ Desafio de {who}: {CHALLENGE_NAMES[ch.kind]}</h3>
      {preparing && <p className="prep">Prepare-se… {Math.ceil((ch.startAt - now) / 1000)}</p>}
      {ch.kind === "power" && <PowerView ch={ch} now={now} mine={mine} onInput={onInput} disabled={preparing || !!result} />}
      {ch.kind === "colors" && <ColorsView ch={ch} now={now} mine={mine} onInput={onInput} disabled={!!result} />}
      {ch.kind === "clicks" && <ClicksView ch={ch} now={now} mine={mine} onInput={onInput} disabled={preparing || !!result} />}
      {result && (
        <p className={result.success ? "res ok" : "res bad"}>
          {result.success ? `✅ Sucesso! Avança +${BOARD_RULES.successBonus} casas` : `❌ Falhou${result.detail ? ` (${result.detail})` : ""}. Avança +${BOARD_RULES.failAdvance}`}
        </p>
      )}
      {!result && !mine && <p className="muted">Você está assistindo.</p>}
    </div>
  );
}

function PowerView({ ch, now, mine, onInput, disabled }:
  { ch: Extract<ChallengePublic, { kind: "power" }>; now: number; mine: boolean; onInput: (i: ChallengeInput) => void; disabled: boolean }) {
  const elapsed = Math.max(0, now - ch.startAt);
  const cursor = now < ch.startAt ? 0 : cursorAt(elapsed, ch.periodMs);
  return (
    <>
      <div className="powerbar">
        <div className="zone" style={{ left: `${(ch.target - ch.zoneWidth / 2) * 100}%`, width: `${ch.zoneWidth * 100}%` }} />
        <div className="cursor" style={{ left: `${cursor * 100}%` }} />
      </div>
      {mine && <button className="primary bigbtn" disabled={disabled} onClick={() => onInput({ action: "stop" })}>PARAR! <small>(Espaço)</small></button>}
    </>
  );
}

function ColorsView({ ch, now, mine, onInput, disabled }:
  { ch: Extract<ChallengePublic, { kind: "colors" }>; now: number; mine: boolean; onInput: (i: ChallengeInput) => void; disabled: boolean }) {
  const per = CHALLENGE_CONFIG.colors.showMsPerColor;
  const showing = now >= ch.startAt && now < ch.startAt + ch.sequence.length * per;
  const idx = Math.floor((now - ch.startAt) / per);
  const lit = showing && (now - ch.startAt) % per < per * 0.7 ? ch.sequence[idx] : -1;
  const inputPhase = now >= ch.inputAt;
  return (
    <>
      <p className="muted">{now < ch.startAt ? "" : showing ? "Memorize a sequência…" : inputPhase ? (mine ? "Sua vez! Repita (teclas 1–4)" : "Repetindo…") : "…"}</p>
      <div className="pads">
        {PAD_COLORS.map((c, i) => (
          <button key={i} className={lit === i ? "pad lit" : "pad"} style={{ background: c }}
            disabled={!mine || !inputPhase || disabled} onClick={() => onInput({ action: "pick", color: i })} aria-label={`Cor ${i + 1}`}>{i + 1}</button>
        ))}
      </div>
      <div className="progress">{ch.sequence.map((_, i) => <span key={i} className={i < ch.progress ? "pip on" : "pip"} />)}</div>
    </>
  );
}

function ClicksView({ ch, now, mine, onInput, disabled }:
  { ch: Extract<ChallengePublic, { kind: "clicks" }>; now: number; mine: boolean; onInput: (i: ChallengeInput) => void; disabled: boolean }) {
  const total = CHALLENGE_CONFIG.clicks.durationMs;
  const leftFrac = Math.min(1, Math.max(0, (ch.endsAt - now) / total));
  const pressed = useRef(0);
  return (
    <>
      <div className="clickcount">{ch.count} <small>/ {ch.target}</small></div>
      <div className="timebar"><div style={{ width: `${now < ch.startAt ? 100 : leftFrac * 100}%` }} /></div>
      {mine && <button className="primary bigbtn" disabled={disabled} onClick={() => { pressed.current++; onInput({ action: "click" }); }}>CLIQUE! <small>(Espaço)</small></button>}
    </>
  );
}
