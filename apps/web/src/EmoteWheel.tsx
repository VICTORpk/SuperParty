import { useEffect } from "react";
import { EMOTES, type EmoteId } from "@jogo/shared";

/** Roda de gestos: clique, ou use as teclas 1–8. Esc ou a tecla do menu fecham. */
export function EmoteWheel({ onPick, onClose }: { onPick: (id: EmoteId) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
      if (m) {
        e.stopImmediatePropagation();
        onPick(EMOTES[Number(m[1]) - 1]!.id);
      } else if (e.code === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onPick, onClose]);

  const radius = 140;
  return (
    <div className="wheel" role="menu" aria-label="Gestos">
      <div className="wheel-center">Gestos</div>
      {EMOTES.map((e, i) => {
        const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <button key={e.id} role="menuitem" className="wheel-item" onClick={() => onPick(e.id)}
            style={{ transform: `translate(${Math.cos(a) * radius}px, ${Math.sin(a) * radius}px)` }}>
            <span className="wheel-icon">{e.icon}</span>
            <span className="wheel-label">{e.label}</span>
            <span className="wheel-num">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
