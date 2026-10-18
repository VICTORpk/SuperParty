import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  CELL, MAP_KINDS, MAP_KIND_DEFS, MAP_LIMITS, OBJECT_TYPES, cellOf, paletteFor, type MapKind, type ObjectTypeDef,
} from "@jogo/shared";
import { EditorScene } from "./EditorScene";
import { Playtest, type PlayHud } from "./Playtest";
import { useEditor, type Editor } from "./useEditor";
import "./dev.css";

/**
 * Editor de mapas do Modo Dev. Este módulo só é carregado por `main.tsx` quando `import.meta.env.DEV` é verdadeiro
 * (servidor de desenvolvimento): o build de produção não o inclui e as rotas `/__dev` não existem fora do `vite`.
 */

const isTyping = () => { const a = document.activeElement; return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement; };

function useShortcuts(ed: Editor, hudRef: { current: PlayHud | null }) {
  const edRef = useRef(ed);
  edRef.current = ed;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ed = edRef.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "KeyS") { e.preventDefault(); void ed.save(); return; }
      if (isTyping()) return;
      if (e.code === "KeyP" && !mod) { ed.setMode(ed.mode === "edit" ? "play" : "edit"); return; }
      if (ed.mode !== "edit") return;
      if (mod && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); ed.redo(); return; }
      if (mod && e.code === "KeyD") { e.preventDefault(); if (ed.selectedId) ed.duplicate(ed.selectedId); return; }
      if ((e.code === "Delete" || e.code === "Backspace") && ed.selectedId) { e.preventDefault(); ed.remove(ed.selectedId); return; }
      if (e.code === "Escape") { if (ed.armed) ed.setArmed(null); else ed.setSelectedId(null); return; }
      if (e.code === "KeyR" && !mod) {
        if (ed.armed) { const def = OBJECT_TYPES[ed.armed]; ed.setHint((h) => ({ ...h, rot: (h.rot + (def?.placement === "block" ? 2 : 1)) % 8 })); }
        else if (ed.selectedId) ed.rotate(ed.selectedId);
        return;
      }
      if (e.code === "PageUp" || e.code === "PageDown" || e.code === "Equal" || e.code === "Minus") {
        const d = e.code === "PageUp" || e.code === "Equal" ? 1 : -1;
        if (ed.armed) ed.setHint((h) => ({ ...h, level: Math.min(MAP_LIMITS.maxLevel, Math.max(0, h.level + d)) }));
        else if (ed.selected && OBJECT_TYPES[ed.selected.type]?.placement === "block") ed.level(ed.selected.id, ed.selected.level + d);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hudRef]);
}

// ---------------------------------------------------------------- barra superior
function TopBar({ ed, onNew }: { ed: Editor; onNew: () => void }) {
  const known = ed.maps.some((m) => m.id === ed.map.id);
  return (
    <header className="dev-top">
      <strong className="dev-title">🛠 Modo Dev</strong>
      <select value={ed.map.id} onChange={(e) => void ed.open(e.target.value)} disabled={ed.busy} aria-label="Mapa">
        {!known && <option value={ed.map.id}>(novo) {ed.map.name}</option>}
        {ed.maps.map((m) => <option key={m.id} value={m.id}>{m.name} · {MAP_KIND_DEFS[m.kind]?.label ?? m.kind}</option>)}
      </select>
      <button onClick={onNew} disabled={ed.busy}>＋ Novo</button>
      <button className={ed.dirty ? "primary" : ""} onClick={() => void ed.save()} disabled={ed.busy || !ed.dirty} title="Ctrl+S">💾 Salvar{ed.dirty ? " ●" : ""}</button>
      <button onClick={() => void ed.duplicateMap()} disabled={ed.busy}>⧉ Duplicar mapa</button>
      <button onClick={() => void ed.removeMap()} disabled={ed.busy}>🗑 Excluir mapa</button>
      <span className="dev-sep" />
      <button onClick={ed.undo} disabled={!ed.canUndo || ed.mode !== "edit"} title="Ctrl+Z">↶ Desfazer</button>
      <button onClick={ed.redo} disabled={!ed.canRedo || ed.mode !== "edit"} title="Ctrl+Shift+Z">↷ Refazer</button>
      <span className="dev-sep" />
      <button className={ed.mode === "play" ? "primary" : ""} onClick={() => ed.setMode(ed.mode === "edit" ? "play" : "edit")} title="P">
        {ed.mode === "edit" ? "▶ Executar" : "✎ Voltar ao editor"}
      </button>
      <button onClick={ed.addBot} disabled={ed.bots.length >= ed.maxBots || ed.mode !== "edit"}>🤖 ＋ Bot ({ed.bots.length}/{ed.maxBots})</button>
      <span className="dev-grow" />
      {ed.dirty && <span className="dev-dirty" title="Há alterações não salvas">● não salvo</span>}
      <a href="/" className="dev-back">← Voltar ao jogo</a>
    </header>
  );
}

// ---------------------------------------------------------------- paleta
function Palette({ ed }: { ed: Editor }) {
  const wasArmed = useRef(false);
  const groups = paletteFor(ed.map.kind);
  const armedDef = ed.armed ? OBJECT_TYPES[ed.armed] : null;
  return (
    <aside className="dev-side dev-left" aria-label="Paleta">
      <h3>Paleta · {MAP_KIND_DEFS[ed.map.kind].label}</h3>
      <p className="dev-muted">Arraste uma peça para o mapa, ou clique nela e depois clique no mapa. Blocos encaixam nas laterais dos vizinhos.</p>
      {groups.map((g) => (
        <section key={g.category}>
          <h4>{g.category}</h4>
          <div className="dev-grid">
            {g.types.map((t: ObjectTypeDef) => (
              <button key={t.id} className={`dev-item${ed.armed === t.id ? " armed" : ""}`} disabled={ed.mode !== "edit"}
                onPointerDown={(e) => { if (e.button !== 0) return; wasArmed.current = ed.armed === t.id; ed.setArmed(t.id); ed.paletteDrag.current = true; }}
                onClick={() => { if (wasArmed.current) ed.setArmed(null); }}
                title={t.label}>
                <span className="dev-ico" style={{ background: t.color }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h4>Colocação</h4>
        <div className="dev-row">
          <span>Nível</span>
          {Array.from({ length: MAP_LIMITS.maxLevel + 1 }, (_, l) => (
            <button key={l} className={ed.hint.level === l ? "primary" : ""} onClick={() => ed.setHint((h) => ({ ...h, level: l }))}>{l}</button>
          ))}
        </div>
        <div className="dev-row">
          <span>Arrastar</span>
          <button className={ed.scope === "block" ? "primary" : ""} onClick={() => ed.setScope("block")}>Bloco</button>
          <button className={ed.scope === "island" ? "primary" : ""} onClick={() => ed.setScope("island")}>Ilha inteira</button>
        </div>
        <label className="dev-check"><input type="checkbox" checked={ed.showConnections} onChange={(e) => ed.setShowConnections(e.target.checked)} /> Mostrar conexões</label>
        {armedDef && <p className="dev-chip">Colocando: {armedDef.icon} {armedDef.label} · Esc cancela · R gira · +/− nível <button onClick={() => ed.setArmed(null)}>Cancelar</button></p>}
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------- inspetor
function NumberField({ label, value, step = 1, min, max, onCommit }: { label: string; value: number; step?: number; min?: number; max?: number; onCommit: (v: number) => void }) {
  return (
    <label className="dev-field">{label}
      <input key={value} type="number" defaultValue={value} step={step} min={min} max={max}
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== value) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function Inspector({ ed }: { ed: Editor }) {
  const o = ed.selected;
  const def = o ? OBJECT_TYPES[o.type] : null;
  const isBlock = def?.placement === "block";
  return (
    <aside className="dev-side dev-right" aria-label="Inspetor">
      <h3>Mapa</h3>
      <label className="dev-field">Nome<input value={ed.map.name} maxLength={MAP_LIMITS.maxNameLength} onChange={(e) => ed.renameMap(e.target.value)} /></label>
      <p className="dev-muted">{MAP_KIND_DEFS[ed.map.kind].label} · {ed.map.objects.length}/{MAP_LIMITS.maxObjects} objetos · {ed.dirty ? "● não salvo" : "✓ salvo"}</p>
      {ed.warnings.length > 0 && <ul className="dev-warn">{ed.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}

      <h3>Selecionado</h3>
      {!o || !def ? <p className="dev-muted">Clique em um bloco ou objeto no mapa.</p> : (
        <>
          <p><span className="dev-ico" style={{ background: def.color }}>{def.icon}</span> <strong>{def.label}</strong> <span className="dev-muted">#{o.id}</span></p>
          {isBlock ? (
            <div className="dev-two">
              <NumberField label="Coluna" value={cellOf(o.x)} min={-50} max={50} onCommit={(v) => ed.move(o.id, v * CELL, o.z)} />
              <NumberField label="Linha" value={cellOf(o.z)} min={-50} max={50} onCommit={(v) => ed.move(o.id, o.x, v * CELL)} />
              <NumberField label="Nível" value={o.level} min={0} max={MAP_LIMITS.maxLevel} onCommit={(v) => ed.level(o.id, v)} />
            </div>
          ) : (
            <div className="dev-two">
              <NumberField label="X" value={o.x} step={0.5} onCommit={(v) => ed.move(o.id, v, o.z)} />
              <NumberField label="Z" value={o.z} step={0.5} onCommit={(v) => ed.move(o.id, o.x, v)} />
              <NumberField label="Giro (×45°)" value={o.rot} min={0} max={7} onCommit={(v) => ed.move(o.id, o.x, o.z, { rot: v })} />
            </div>
          )}
          {(def.props ?? []).map((p) => p.type === "select" ? (
            <label className="dev-field" key={p.key}>{p.label}
              <select value={String(o.props[p.key] ?? p.default)} onChange={(e) => ed.prop(o.id, p.key, e.target.value)}>{(p.options ?? []).map((v) => <option key={v}>{v}</option>)}</select>
            </label>
          ) : p.type === "number" ? (
            <NumberField key={p.key} label={p.label} value={Number(o.props[p.key] ?? p.default)} step={p.step} min={p.min} max={p.max} onCommit={(v) => ed.prop(o.id, p.key, v)} />
          ) : null)}
          <div className="dev-btns">
            <button onClick={() => ed.duplicate(o.id)} title="Ctrl+D">⧉ Duplicar</button>
            <button onClick={() => ed.rotate(o.id)} title="R">⟳ Girar</button>
            <button onClick={() => ed.remove(o.id)} title="Delete">🗑 Excluir</button>
            {isBlock && <button onClick={() => ed.level(o.id, o.level + 1)}>⬆ Subir</button>}
            {isBlock && <button onClick={() => ed.level(o.id, o.level - 1)}>⬇ Descer</button>}
            {isBlock && <button onClick={() => ed.attach(o.id)} title="Leva esta ilha ao encaixe mais próximo em outra ilha">🔗 Conectar ilha</button>}
            {isBlock && <button onClick={() => ed.detach(o.id)} title="Tira este bloco da ilha">✂ Desconectar bloco</button>}
          </div>
          {isBlock && <p className="dev-muted">Ilha: {ed.islandIds.size} bloco(s). Para mover a ilha toda, escolha “Ilha inteira” em Arrastar.</p>}
        </>
      )}

      <h3>Bots de teste</h3>
      <p className="dev-muted">Bots da sessão aparecem ao executar e vêm até você. Para guardar um bot no mapa, use o objeto 🤖 da paleta.</p>
      <div className="dev-btns">
        <button onClick={ed.addBot} disabled={ed.bots.length >= ed.maxBots}>＋ Adicionar</button>
        <button onClick={() => ed.removeBot()} disabled={!ed.bots.length}>－ Remover</button>
      </div>
      <ul className="dev-bots">{ed.bots.map((b) => <li key={b.id}>🤖 {b.id} <button onClick={() => ed.removeBot(b.id)} aria-label={`Remover ${b.id}`}>✕</button></li>)}</ul>

      <h3>Atalhos</h3>
      <ul className="dev-muted dev-keys">
        <li>Ctrl+S salvar · Ctrl+Z/Shift+Z desfazer/refazer</li>
        <li>Ctrl+D duplicar · Del excluir · R girar</li>
        <li>PgUp/PgDn (ou +/−) nível · Esc cancela</li>
        <li>P executar/editar · botão direito/roda: câmera</li>
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------- novo mapa
function NewMapDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const [kind, setKind] = useState<MapKind>("islands");
  const [name, setName] = useState("");
  return (
    <div className="dev-modal" role="dialog" aria-label="Novo mapa" onClick={onClose}>
      <form className="dev-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (ed.newMap(kind, name || "Novo mapa")) onClose(); }}>
        <h3>Novo mapa</h3>
        <label className="dev-field">Nome<input autoFocus value={name} maxLength={MAP_LIMITS.maxNameLength} placeholder="Meu mapa" onChange={(e) => setName(e.target.value)} /></label>
        <div className="dev-kinds">
          {MAP_KINDS.map((k) => (
            <label key={k} className={kind === k ? "sel" : ""}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              <strong>{MAP_KIND_DEFS[k].label}</strong><span>{MAP_KIND_DEFS[k].description}</span>
            </label>
          ))}
        </div>
        <div className="dev-btns"><button type="submit" className="primary">Criar</button><button type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- raiz
export default function DevApp() {
  const ed = useEditor();
  const [hud, setHud] = useState<PlayHud | null>(null);
  const hudRef = useRef<PlayHud | null>(null);
  const [creating, setCreating] = useState(false);
  useShortcuts(ed, hudRef);
  useEffect(() => { document.title = "Modo Dev · Editor de mapas"; }, []);
  const onHud = (h: PlayHud) => { hudRef.current = h; setHud((p) => (p && p.strokes === h.strokes && p.message === h.message && Math.abs(p.power - h.power) < 0.02 && p.bots === h.bots ? p : h)); };

  return (
    <div className="dev-root">
      <TopBar ed={ed} onNew={() => setCreating(true)} />
      <div className="dev-main">
        {ed.mode === "edit" && <Palette ed={ed} />}
        <div className="dev-canvas">
          <Canvas camera={{ fov: 50, near: 0.1, far: 800, position: [18, 22, 26] }} dpr={[1, 1.5]} style={{ touchAction: "none" }}>
            {ed.mode === "edit" ? <EditorScene ed={ed} /> : <Playtest ed={ed} onHud={onHud} />}
          </Canvas>
          {ed.mode === "edit" && ed.armed && <div className="dev-hint">Clique no mapa para colocar · Esc cancela</div>}
          {ed.mode === "play" && (
            <div className="dev-play">
              <strong>▶ Executando</strong>
              {hud?.golf ? (
                <>
                  <span>Tacadas: {hud.strokes}</span>
                  <div className="dev-power"><div style={{ width: `${(hud.power ?? 0) * 100}%` }} /></div>
                  <span className="dev-muted">Espaço (segure/solte) bate · R reinicia · arraste para girar a câmera</span>
                </>
              ) : <span className="dev-muted">WASD/setas andam · Shift corre · Espaço pula · arraste gira a câmera</span>}
              {hud?.message && <em>{hud.message}</em>}
              <span className="dev-muted">{hud?.bots ?? 0} bot(s) · P volta ao editor (nada do que você fez aqui altera o mapa)</span>
            </div>
          )}
          {ed.notice && <div className={`dev-toast ${ed.notice.kind}`} role="status">{ed.notice.text}</div>}
        </div>
        {ed.mode === "edit" && <Inspector ed={ed} />}
      </div>
      {creating && <NewMapDialog ed={ed} onClose={() => setCreating(false)} />}
    </div>
  );
}
