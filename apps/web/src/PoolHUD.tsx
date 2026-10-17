import { useEffect, useRef, useState } from "react";
import { groupOf, GROUP_LABEL, type PlayerInfo, type PoolGroup, type PoolPublicState } from "@jogo/shared";
import { BALL_COLORS } from "./poolStyle";
import type { PoolUi } from "./PoolScene";
import { type Settings } from "./controls";

type Ref<T> = React.MutableRefObject<T>;

const END_TEXT: Record<string, string> = {
  eight: "encaçapou a bola 8", "eight-early": "o adversário encaçapou a bola 8 cedo demais",
  "eight-foul": "falta ao encaçapar a bola 8", "eight-scratch": "o adversário derrubou a bola 8 com falta", desistencia: "o adversário saiu",
};

function BallDot({ id, small }: { id: number; small?: boolean }) {
  const stripe = groupOf(id) === "stripe";
  const size = small ? 18 : 22;
  return (
    <span className="pball" style={{
      width: size, height: size,
      background: stripe ? `linear-gradient(180deg, #f8f8f2 0 28%, ${BALL_COLORS[id]} 28% 72%, #f8f8f2 72%)` : BALL_COLORS[id],
    }}>{id}</span>
  );
}

function PlayerCard({ state, id, info, active, right }: { state: PoolPublicState; id: string; info?: PlayerInfo; active: boolean; right?: boolean }) {
  const group: PoolGroup | null = state.groups[id] ?? null;
  const out = state.balls.filter((b) => b.out && b.id !== 0 && group && groupOf(b.id) === group).map((b) => b.id);
  const remaining = group ? state.balls.filter((b) => !b.out && groupOf(b.id) === group).length : null;
  return (
    <div className={`pcard${active ? " active" : ""}${right ? " right" : ""}`}>
      <div className="pname"><span className="dot" style={{ background: info?.color ?? "#999" }} />{info?.nick ?? "?"}</div>
      <div className="pgroup">{group ? `${GROUP_LABEL[group]} · faltam ${remaining}` : "mesa aberta"}</div>
      <div className="pout">{out.map((b) => <BallDot key={b} id={b} small />)}</div>
    </div>
  );
}

export function PoolHUD({ pool, ui, offsetRef, players, you, settings, onEnd, isTouch, onShoot }:
  { pool: PoolPublicState; ui: Ref<PoolUi>; offsetRef: Ref<number>; players: PlayerInfo[]; you: string; settings: Settings; onEnd: () => void; isTouch: boolean; onShoot: (angle: number, power: number) => void }) {
  const [now, setNow] = useState(Date.now());
  const [u, setU] = useState<PoolUi>({ ...ui.current });
  const [toast, setToast] = useState("");
  const last = useRef("");

  useEffect(() => {
    const iv = setInterval(() => { setNow(Date.now() + offsetRef.current); setU({ ...ui.current }); }, 100);
    return () => clearInterval(iv);
  }, [ui, offsetRef]);

  useEffect(() => {
    const key = `${pool.shotId}|${pool.message}`;
    if (!pool.message || key === last.current) return;
    last.current = key;
    setToast(pool.message);
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [pool.message, pool.shotId]);

  const info = (id: string) => players.find((p) => p.id === id);
  const [a, b] = pool.players;
  const myTurn = pool.turn === you;
  const left = pool.turnEndsAt ? Math.max(0, Math.ceil((pool.turnEndsAt - now) / 1000)) : null;
  const iPlay = pool.players.includes(you);
  void settings;

  let hint = "";
  if (pool.phase === "shooting") hint = "A tacada está rolando…";
  else if (!myTurn) hint = `Vez de ${info(pool.turn)?.nick ?? "?"}`;
  else if (pool.phase === "placing") hint = "Bola na mão: clique na mesa para posicionar a bola branca";
  else if (isTouch) hint = "Arraste na mesa para mirar · puxe a barra de força para baixo e solte para tacar";
  else hint = pool.phase === "break" ? "Quebra! Mire com o mouse, segure o clique e arraste para baixo para dar força, solte para tacar" : "Mire com o mouse · segure o clique e arraste para baixo para dar força · solte para tacar · Esc/botão direito cancela";

  return (
    <>
      <div className="hud pool-top">
        <PlayerCard state={pool} id={a} info={info(a)} active={pool.turn === a && pool.phase !== "finished"} />
        <div className="pturn">
          {pool.phase === "finished" ? "Fim" : pool.phase === "shooting" ? "🎱" : left !== null ? `${left}s` : ""}
        </div>
        <PlayerCard state={pool} id={b} info={info(b)} active={pool.turn === b && pool.phase !== "finished"} right />
      </div>

      {pool.phase !== "finished" && <div className={`hud pool-hint panel${myTurn && iPlay ? " mine" : ""}`}>{hint}</div>}
      {toast && pool.phase !== "finished" && <div className="hud pool-toast panel">{toast}</div>}

      {isTouch && myTurn && u.canShoot && !u.replay && (
        <TouchPower ui={ui} onShoot={onShoot} />
      )}

      {u.charging && !isTouch && (
        <div className="hud pool-power" aria-label="Força">
          <div className="pbar"><div style={{ height: `${u.power * 100}%` }} /></div>
          <span>{Math.round(u.power * 100)}%</span>
        </div>
      )}

      {pool.phase === "finished" && pool.winner && (
        <div className="overlay">
          <div className="panel winner">
            <div className="trophy">🏆</div>
            <h2>{info(pool.winner)?.nick} venceu!</h2>
            <p className="muted">{END_TEXT[pool.endReason ?? ""] ?? pool.message}</p>
            <p className="muted">Voltando ao lobby em alguns segundos…</p>
            <button className="primary" onClick={onEnd}>Voltar ao lobby agora</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Barra de força por toque: arraste para baixo e solte para dar a tacada. */
export function TouchPower({ ui, onShoot }: { ui: Ref<PoolUi>; onShoot: (angle: number, power: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [power, setPower] = useState(0);
  const drag = useRef(false);
  const calc = (y: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (y - r.top) / r.height));
  };
  return (
    <div className="hud pool-touchpower">
      <div className="ptrack" ref={track}
        onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = true; ui.current.charging = true; const p = calc(e.clientY); ui.current.power = p; setPower(p); }}
        onPointerMove={(e) => { if (!drag.current) return; const p = calc(e.clientY); ui.current.power = p; setPower(p); }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = false;
          const p = calc(e.clientY);
          ui.current.charging = false; ui.current.power = 0; setPower(0);
          if (p >= 0.05) onShoot(ui.current.aim, p);
        }}
        onPointerCancel={() => { drag.current = false; ui.current.charging = false; ui.current.power = 0; setPower(0); }}>
        <div className="pfill" style={{ height: `${power * 100}%` }} />
        <div className="pgrip" style={{ top: `${power * 100}%` }} />
      </div>
      <span>FORÇA {Math.round(power * 100)}%</span>
    </div>
  );
}
