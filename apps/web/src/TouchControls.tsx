import { useRef } from "react";
import type { TouchState } from "./platform";

type Ref<T> = React.MutableRefObject<T>;

/** Joystick virtual (esquerda) e botões de ação (direita) para celular. Escreve no estado compartilhado `touch`. */
export function TouchControls({ touch, mode, onEmotes }: { touch: Ref<TouchState>; mode: "lobby" | "arena"; onEmotes?: () => void }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const R = 56;

  const setStick = (clientX: number, clientY: number) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
    touch.current.moveX = dx / R;
    touch.current.moveY = dy / R;
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const resetStick = () => {
    active.current = null;
    touch.current.moveX = 0; touch.current.moveY = 0;
    if (knob.current) knob.current.style.transform = "translate(0,0)";
  };

  const press = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); fn(); },
  });

  return (
    <>
      <div className="hud tc-stick" ref={base}
        onPointerDown={(e) => { e.preventDefault(); active.current = e.pointerId; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setStick(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (active.current === e.pointerId) setStick(e.clientX, e.clientY); }}
        onPointerUp={(e) => { if (active.current === e.pointerId) resetStick(); }}
        onPointerCancel={resetStick}>
        <div className="tc-knob" ref={knob} />
      </div>

      <div className="hud tc-buttons">
        <button className="tc-btn big" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); touch.current.jump = true; }}
          onPointerUp={() => { touch.current.jump = false; }} onPointerCancel={() => { touch.current.jump = false; }} onPointerLeave={() => { touch.current.jump = false; }}>⬆</button>
        <button className="tc-btn" {...press(() => { touch.current.attack = "punch"; })}>👊</button>
        <button className="tc-btn" {...press(() => { touch.current.attack = "kick"; })}>🦶</button>
        <button className="tc-btn" {...press(() => { touch.current.attack = "shove"; })}>✋</button>
        <button className="tc-btn" {...press(() => { touch.current.dodge = true; })}>💨</button>
        {mode === "lobby" && onEmotes && <button className="tc-btn" {...press(onEmotes)}>😀</button>}
      </div>
    </>
  );
}
