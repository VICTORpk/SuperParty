import { useState } from "react";
import type { Room } from "colyseus.js";
import { AVATAR_COLORS, MAX_NICK_LENGTH, ROOM_CODE_LENGTH, sanitizeNick } from "@jogo/shared";
import { createRoom, joinRoom, wakeServer } from "./net";
import { enterLandscape } from "./platform";

function load(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function Home({ onEnter, notice }: { onEnter: (r: Room) => void; notice: string }) {
  const [nick, setNick] = useState(load("jogo:nick", ""));
  const [color, setColor] = useState<string>(load("jogo:color", AVATAR_COLORS[0]));
  const [code, setCode] = useState("");
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function run(action: () => Promise<Room>) {
    void enterLandscape(); // celular: tela cheia e deitada (precisa ser no gesto do clique)
    const clean = sanitizeNick(nick);
    if (!clean) return setError("Escolha um apelido para entrar.");
    save("jogo:nick", clean);
    save("jogo:color", color);
    setBusy(true);
    setError("");
    try {
      await wakeServer(() => setStatus("Acordando o servidor (plano gratuito)… pode levar até 1 minuto."));
      setStatus("");
      onEnter(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const opts = { nick: sanitizeNick(nick), color };

  return (
    <main className="center">
      <div className="card">
        <h1>🎲 Jogo Social</h1>
        <p className="muted">Crie uma sala privada e chame seus amigos com o código.</p>

        <label>Apelido
          <input value={nick} maxLength={MAX_NICK_LENGTH} onChange={(e) => setNick(e.target.value)} placeholder="Seu apelido" />
        </label>

        <div className="colors" role="radiogroup" aria-label="Cor do avatar">
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={`Cor ${c}`}
              className={c === color ? "swatch on" : "swatch"} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>

        <button className="primary" disabled={busy} onClick={() => run(() => createRoom(opts))}>
          {busy ? "Conectando…" : "Criar sala"}
        </button>

        <div className="or">ou entre com um código</div>

        <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => joinRoom(code, opts)); }}>
          <input value={code} maxLength={ROOM_CODE_LENGTH + 2} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CÓDIGO" aria-label="Código da sala" className="code" />
          <button type="submit" disabled={busy}>Entrar</button>
        </form>

        {status && <p className="muted" role="status">{status}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {import.meta.env.DEV && import.meta.env.VITE_DEV_MODE !== "0" && <a className="muted" href="/dev">🛠 Modo Dev: editor de mapas</a>}
      </div>
    </main>
  );
}
