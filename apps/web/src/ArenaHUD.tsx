import { useEffect, useState } from "react";
import { ARENA, type ArenaSnapshot, type FighterSnap, type PlayerInfo } from "@jogo/shared";
import { keyLabel, type Settings } from "./controls";

type Ref<T> = React.MutableRefObject<T>;

const REASON: Record<NonNullable<ArenaSnapshot["reason"]>, string> = {
  ko: "K.O.!", queda: "Caiu da arena!", tempo: "Tempo esgotado!", desistencia: "Desistência!",
};

function Bar({ f, info, right }: { f: FighterSnap; info?: PlayerInfo; right?: boolean }) {
  const pct = Math.max(0, Math.min(100, (f.hp / ARENA.hp) * 100));
  return (
    <div className={right ? "fbar right" : "fbar"}>
      <div className="fname"><span className="dot" style={{ background: info?.color ?? "#999" }} />{info?.nick ?? "?"}</div>
      <div className="fhp"><div style={{ width: `${pct}%`, background: pct > 50 ? "#22c55e" : pct > 25 ? "#eab308" : "#ef4444" }} /></div>
      <div className="fnum">{f.hp}</div>
    </div>
  );
}

export function ArenaHUD({ arena, offsetRef, players, you, settings }:
  { arena: Ref<ArenaSnapshot | null>; offsetRef: Ref<number>; players: PlayerInfo[]; you: string; settings: Settings }) {
  const [snap, setSnap] = useState<ArenaSnapshot | null>(arena.current);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => { setSnap(arena.current ? { ...arena.current } : null); setNow(Date.now() + offsetRef.current); }, 100);
    return () => clearInterval(iv);
  }, [arena, offsetRef]);
  if (!snap || snap.fighters.length < 2) return <div className="hud banner panel">⚔️ Preparando a arena…</div>;

  const [a, b] = snap.fighters as [FighterSnap, FighterSnap];
  const info = (id: string) => players.find((p) => p.id === id);
  const fighting = snap.fighters.some((f) => f.id === you);
  const count = Math.ceil((snap.startsAt - now) / 1000);
  const left = Math.max(0, Math.ceil((snap.endsAt - now) / 1000));
  const bd = settings.bindings;

  return (
    <>
      <div className="hud arena-top">
        <Bar f={a} info={info(a.id)} />
        <div className="arena-timer">{snap.phase === "fight" ? `${left}s` : "⚔️"}</div>
        <Bar f={b} info={info(b.id)} right />
      </div>

      {snap.phase === "countdown" && count > 0 && <div className="hud arena-count">{count}</div>}
      {snap.phase === "countdown" && count <= 0 && <div className="hud arena-count go">LUTE!</div>}
      {snap.phase === "fight" && now - snap.startsAt < 900 && <div className="hud arena-count go">LUTE!</div>}

      {snap.phase === "ended" && snap.winner && (
        <div className="hud arena-end">
          <div className="ko">{snap.reason ? REASON[snap.reason] : ""}</div>
          <div>🏆 {info(snap.winner)?.nick} vence · avança 2 casas</div>
          <div className="muted">{info(snap.fighters.find((f) => f.id !== snap.winner)?.id ?? "")?.nick} volta 1 casa</div>
        </div>
      )}

      <div className="hud arena-hint panel">
        {fighting
          ? <>{keyLabel(bd.forward)}{keyLabel(bd.left)}{keyLabel(bd.back)}{keyLabel(bd.right)} mover · {keyLabel(bd.jump)} pular · {keyLabel(bd.run)} correr (+ direção = esquiva) ·
            {" "}<b>{keyLabel(bd.punch)}</b>/clique esq. soco · <b>{keyLabel(bd.kick)}</b>/clique dir. chute · <b>{keyLabel(bd.shove)}</b> empurrão — derrube o rival da plataforma ou zere a vida dele!</>
          : <>Você está assistindo a luta.</>}
      </div>
    </>
  );
}
