import { useEffect, useState } from "react";
import { ACTIONS, DEFAULT_SETTINGS, RESERVED, keyLabel, type Action, type Settings } from "./controls";

export function SettingsPanel({ settings, onChange, onClose }:
  { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const [capturing, setCapturing] = useState<Action | null>(null);
  const [message, setMessage] = useState("");

  // Captura a próxima tecla (fase de captura, para que o jogo não a receba)
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") { setCapturing(null); return; }
      if (RESERVED.has(e.code)) return;
      const next = { ...settings.bindings };
      const other = ACTIONS.find((a) => a.id !== capturing && next[a.id] === e.code);
      if (other) {
        next[other.id] = next[capturing]; // troca as duas teclas
        setMessage(`"${other.label}" agora usa ${keyLabel(next[capturing])}.`);
      } else {
        setMessage("");
      }
      next[capturing] = e.code;
      onChange({ ...settings, bindings: next });
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, settings, onChange]);

  // Esc fecha o painel (quando não está capturando uma tecla)
  useEffect(() => {
    if (capturing) return;
    const onKey = (e: KeyboardEvent) => { if (e.code === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing, onClose]);

  return (
    <div className="overlay" role="dialog" aria-label="Configurações">
      <div className="panel settings">
        <header>
          <h2>Configurações</h2>
          <button onClick={onClose} aria-label="Fechar">✕</button>
        </header>

        <div className="keylist">
          {ACTIONS.map((a) => (
            <div className="keyrow" key={a.id}>
              <span>{a.label}</span>
              <button className={capturing === a.id ? "keybtn capturing" : "keybtn"}
                onClick={() => { setMessage(""); setCapturing(a.id); }}>
                {capturing === a.id ? "Pressione uma tecla…" : keyLabel(settings.bindings[a.id])}
              </button>
            </div>
          ))}
        </div>

        <label className="sens">Sensibilidade do mouse: {settings.sensitivity.toFixed(1)}×
          <input type="range" min={0.3} max={3} step={0.1} value={settings.sensitivity}
            onChange={(e) => onChange({ ...settings, sensitivity: Number(e.target.value) })} />
        </label>

        {message && <p className="muted">{message}</p>}
        <p className="muted">Clique em uma tecla e pressione a nova. Esc cancela. Se a tecla já estiver em uso, as duas trocam de lugar.</p>
        <div className="row">
          <button onClick={() => onChange(DEFAULT_SETTINGS)}>Restaurar padrão</button>
          <button className="primary" onClick={onClose}>Pronto</button>
        </div>
      </div>
    </div>
  );
}
