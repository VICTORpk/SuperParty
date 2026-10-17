import { useEffect, useState } from "react";
import { IMPOSTOR_RULES, type ImpostorPublicState, type PlayerInfo } from "@jogo/shared";
import type { PoolUi } from "./PoolScene";
import type { PoolShotMsg } from "@jogo/shared";

type Ref<T> = React.MutableRefObject<T>;

function Hits({ n }: { n: number }) {
  return <span className="ihits">{[0, 1, 2].map((i) => <span key={i} className={i < n ? "ih on" : "ih"}>🥊</span>)}</span>;
}

export function ImpostorHUD({ state, ui, offsetRef, players, you, role, onDecide, onEnd, isTouch, onShoot }:
  { state: ImpostorPublicState; ui: Ref<PoolUi>; offsetRef: Ref<number>; players: PlayerInfo[]; you: string; role: "impostor" | null;
    onDecide: (attack: boolean) => void; onEnd: () => void; isTouch: boolean; onShoot: (angle: number, power: number) => void }) {
  const [now, setNow] = useState(Date.now());
  const [u, setU] = useState<PoolUi>({ ...ui.current });
  const [toast, setToast] = useState("");

  useEffect(() => {
    const iv = setInterval(() => { setNow(Date.now() + offsetRef.current); setU({ ...ui.current }); }, 100);
    return () => clearInterval(iv);
  }, [ui, offsetRef]);

  useEffect(() => {
    if (!state.message) return;
    setToast(state.message);
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [state.message, state.shotId, state.phase, state.lastHit?.key]);

  const nick = (id: string) => players.find((p) => p.id === id)?.nick ?? "?";
  const color = (id: string) => players.find((p) => p.id === id)?.color ?? "#999";
  const me = state.players.find((p) => p.id === you);
  const myTurn = state.turn === you && !!me?.alive;
  const left = state.turnEndsAt ? Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000)) : null;
  const amDead = !!me && !me.alive;

  let hint = "";
  if (state.phase === "aim") hint = myTurn ? (isTouch ? "Arraste na mesa para mirar e use a barra de força" : "Sua vez! Mire com o mouse, segure o clique e arraste para baixo para dar força") : `Vez de ${nick(state.turn)} (${left ?? 0}s)`;
  else if (state.phase === "shooting") hint = "A tacada está rolando…";
  else if (state.phase === "bottle") hint = "🍾 A garrafa está girando…";
  else if (state.phase === "decision") hint = state.turn === you ? "" : `${nick(state.turn)} decide se ataca ${nick(state.decisionTarget ?? "")}…`;

  return (
    <>
      <div className="hud imp-top">
        {state.players.map((p) => (
          <div key={p.id} className={`ichip${p.alive ? "" : " dead"}${p.id === state.turn && state.phase !== "finished" ? " turn" : ""}${p.id === you ? " me" : ""}`}>
            <span className="dot" style={{ background: color(p.id) }} />
            <span className="inick">{nick(p.id)}</span>
            {p.alive ? <Hits n={p.hits} /> : <span className="irole">{p.revealed === "impostor" ? "🕵️ Impostor" : p.revealed === "innocent" ? "😇 inocente" : "saiu"}</span>}
          </div>
        ))}
      </div>

      <div className={`hud imp-role${role ? " impostor" : ""}`}>
        {amDead ? "👻 Você foi eliminado: assista e converse com os outros eliminados" : role ? "🕵️ Você é o IMPOSTOR. Ninguém sabe!" : "😇 Você é inocente. Descubra quem é o Impostor!"}
      </div>

      {state.phase !== "finished" && <div className={`hud pool-hint panel${myTurn ? " mine" : ""}`}>{hint}</div>}
      {toast && state.phase !== "finished" && <div className="hud pool-toast panel">{toast}</div>}

      {state.phase === "decision" && state.turn === you && !amDead && (
        <div className="hud imp-decision panel">
          <div className="imp-target">🍾 A garrafa escolheu <b style={{ color: color(state.decisionTarget ?? "") }}>{nick(state.decisionTarget ?? "")}</b></div>
          <div className="row">
            <button className="primary bigbtn" onClick={() => onDecide(true)}>🥊 Atacar</button>
            <button className="bigbtn" onClick={() => onDecide(false)}>🕊 Poupar</button>
          </div>
          <div className="muted">{Math.max(0, Math.ceil(((state.turnEndsAt ?? now) - now) / 1000))}s · sem resposta, o alvo é poupado ({IMPOSTOR_RULES.decisionMs / 1000}s)</div>
        </div>
      )}

      {isTouch && myTurn && state.phase === "aim" && u.canShoot && !u.replay && <TouchPowerLite ui={ui} onShoot={onShoot} />}

      {u.charging && !isTouch && (
        <div className="hud pool-power" aria-label="Força">
          <div className="pbar"><div style={{ height: `${u.power * 100}%` }} /></div>
          <span>{Math.round(u.power * 100)}%</span>
        </div>
      )}

      {state.phase === "finished" && state.winner && (
        <div className="overlay">
          <div className="panel winner">
            <div className="trophy">{state.winner === "innocents" ? "😇" : "🕵️"}</div>
            <h2>{state.winner === "innocents" ? "Os inocentes venceram!" : "O Impostor venceu!"}</h2>
            <p>O Impostor era <b style={{ color: color(state.impostor ?? "") }}>{nick(state.impostor ?? "")}</b></p>
            <p className="muted">Voltando ao lobby em alguns segundos…</p>
            <button className="primary" onClick={onEnd}>Voltar ao lobby agora</button>
          </div>
        </div>
      )}
    </>
  );
}

import { TouchPower as TouchPowerLite } from "./PoolHUD";
export type { PoolShotMsg };
