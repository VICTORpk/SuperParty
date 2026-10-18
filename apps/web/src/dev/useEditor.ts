import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOT_CONFIG, CELL, MAP_LIMITS, addObject, attachIsland, blockIndex, cleanMapName, commit, createMap, detachBlock, diagnose, duplicateObject, islandOf,
  makeMapId, moveIsland, moveObject, newHistory, redo, removeObject, rotateObject, sameContent, setLevel, setProp, surfaceHeight, undo,
  type History, type MapDoc, type MapKind, type ObjectSpec, type OpResult, type PropValue,
} from "@jogo/shared";
import { deleteMap, listMaps, loadMap, saveMap, type MapMeta } from "./api";

export interface EditorBot { id: string; x: number; z: number }
export interface Notice { text: string; kind: "ok" | "err" | "info" }
export type Mode = "edit" | "play";
export type MoveScope = "block" | "island";

/** Estado e ações do editor. A interface e a cena só leem isto e chamam as ações. */
export function useEditor() {
  const [hist, setHist] = useState<History<MapDoc>>(() => newHistory(createMap("islands", "Meu mapa")));
  const [saved, setSaved] = useState<MapDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [hint, setHint] = useState({ level: 0, rot: 0 });
  const [scope, setScope] = useState<MoveScope>("block");
  const [mode, setMode] = useState<Mode>("edit");
  const [showConnections, setShowConnections] = useState(true);
  const [maps, setMaps] = useState<MapMeta[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [bots, setBots] = useState<EditorBot[]>([]);
  const [busy, setBusy] = useState(false);
  const botSeq = useRef(0);
  /** Verdadeiro enquanto o jogador arrasta uma peça da paleta (soltar sobre a cena coloca a peça). */
  const paletteDrag = useRef(false);
  const noticeTimer = useRef<number | undefined>(undefined);

  const map = hist.present;
  const dirty = !saved || !sameContent(saved, map);
  const selected = useMemo(() => map.objects.find((o) => o.id === selectedId) ?? null, [map, selectedId]);
  const warnings = useMemo(() => diagnose(map), [map]);
  const islandIds = useMemo(() => (selected ? new Set(islandOf(map, selected.id) ?? []) : new Set<string>()), [map, selected]);

  const say = useCallback((text: string, kind: Notice["kind"] = "info") => {
    setNotice({ text, kind });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), kind === "err" ? 6000 : 3500);
    if (kind === "err") console.warn("[editor]", text);
  }, []);

  /** Aplica o resultado de uma operação: confirma no histórico ou mostra o motivo da recusa (sem alterar nada). */
  const apply = useCallback((res: OpResult, select?: "result" | "keep" | "clear"): boolean => {
    if (!res.ok) { say(res.error, "err"); return false; }
    setHist((h) => commit(h, res.map));
    if (select === "result" && res.id) setSelectedId(res.id);
    if (select === "clear") setSelectedId(null);
    return true;
  }, [say]);

  // ---- edição
  const add = useCallback((spec: ObjectSpec) => apply(addObject(map, spec), "result"), [apply, map]);
  const move = useCallback((id: string, x: number, z: number, opts?: { level?: number; rot?: number }) => apply(moveObject(map, id, x, z, opts)), [apply, map]);
  const remove = useCallback((id: string) => apply(removeObject(map, id), "clear"), [apply, map]);
  const duplicate = useCallback((id: string) => apply(duplicateObject(map, id), "result"), [apply, map]);
  const rotate = useCallback((id: string) => apply(rotateObject(map, id)), [apply, map]);
  const level = useCallback((id: string, l: number) => apply(setLevel(map, id, l)), [apply, map]);
  const prop = useCallback((id: string, key: string, v: PropValue) => apply(setProp(map, id, key, v)), [apply, map]);
  const islandMove = useCallback((id: string, di: number, dj: number) => apply(moveIsland(map, id, di, dj)), [apply, map]);
  const attach = useCallback((id: string) => apply(attachIsland(map, id)), [apply, map]);
  const detach = useCallback((id: string) => apply(detachBlock(map, id)), [apply, map]);
  const doUndo = useCallback(() => setHist((h) => undo(h)), []);
  const doRedo = useCallback(() => setHist((h) => redo(h)), []);

  // ---- bots de sessão (não fazem parte do mapa; ver `bot-spawn` para bots configurados no mapa)
  const addBot = useCallback(() => {
    if (bots.length >= MAP_LIMITS.maxBotsInEditor) return say(`Limite de ${MAP_LIMITS.maxBotsInEditor} bots.`, "err");
    const idx = blockIndex(map);
    const blocks = Array.from(idx.values());
    if (!blocks.length) return say("Coloque ao menos um bloco para o bot ter onde ficar.", "err");
    const b = blocks[Math.floor(Math.random() * blocks.length)]!;
    const x = b.x + (Math.random() - 0.5) * CELL * 0.6, z = b.z + (Math.random() - 0.5) * CELL * 0.6;
    if (surfaceHeight(idx, x, z) === null) return;
    botSeq.current += 1;
    setBots((p) => [...p, { id: `bot-${botSeq.current}`, x, z }]);
  }, [bots.length, map, say]);
  const removeBot = useCallback((id?: string) => setBots((p) => (id ? p.filter((b) => b.id !== id) : p.slice(0, -1))), []);

  // ---- mapas (arquivos em maps/)
  const refresh = useCallback(async () => {
    try { setMaps(await listMaps()); } catch (e) { say(e instanceof Error ? e.message : "Não foi possível listar os mapas.", "err"); }
  }, [say]);
  // ao abrir o editor: carrega a lista e continua do mapa editado mais recentemente (se houver)
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const list = await listMaps();
        setMaps(list);
        const latest = list[0];
        if (latest) {
          const { map: m, warnings: w } = await loadMap(latest.id);
          setHist(newHistory(m)); setSaved(m);
          if (w.length) say(`Mapa carregado com avisos: ${w.join(" ")}`, "info");
        }
      } catch (e) { say(e instanceof Error ? e.message : "Não foi possível listar os mapas.", "err"); }
    })();
  }, [say]);

  const confirmDiscard = useCallback(() => !dirty || window.confirm("Há alterações não salvas. Descartá-las?"), [dirty]);

  const resetTo = useCallback((m: MapDoc, savedCopy: MapDoc | null) => {
    setHist(newHistory(m)); setSaved(savedCopy); setSelectedId(null); setArmed(null); setMode("edit"); setBots([]);
    setHint({ level: 0, rot: 0 });
  }, []);

  const newMap = useCallback((kind: MapKind, name: string) => {
    if (!confirmDiscard()) return false;
    resetTo(createMap(kind, name), null);
    return true;
  }, [confirmDiscard, resetTo]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const doc = { ...map, name: cleanMapName(map.name), updatedAt: Date.now() };
      await saveMap(doc);
      setSaved(doc);
      setHist((h) => ({ ...h, present: doc })); // o carimbo de data não conta como alteração
      say("Mapa salvo.", "ok");
      await refresh();
    } catch (e) { say(e instanceof Error ? e.message : "Erro ao salvar.", "err"); }
    finally { setBusy(false); }
  }, [map, refresh, say]);

  const open = useCallback(async (id: string) => {
    if (id === map.id && !dirty) return;
    if (!confirmDiscard()) return;
    setBusy(true);
    try {
      const { map: m, warnings: w } = await loadMap(id);
      resetTo(m, m);
      say(w.length ? `Mapa carregado com avisos: ${w.join(" ")}` : "Mapa carregado.", w.length ? "info" : "ok");
    } catch (e) { say(e instanceof Error ? e.message : "Erro ao abrir o mapa.", "err"); }
    finally { setBusy(false); }
  }, [confirmDiscard, dirty, map.id, resetTo, say]);

  /** Cria uma cópia independente do mapa atual (id novo) e a salva; o original não muda. */
  const duplicateMap = useCallback(async () => {
    const copy: MapDoc = { ...map, id: makeMapId(`${map.name} copia`), name: cleanMapName(`${map.name} (cópia)`), createdAt: Date.now(), updatedAt: Date.now() };
    setBusy(true);
    try {
      await saveMap(copy);
      resetTo(copy, copy);
      say("Cópia criada e aberta; o original continua como estava.", "ok");
      await refresh();
    } catch (e) { say(e instanceof Error ? e.message : "Erro ao duplicar.", "err"); }
    finally { setBusy(false); }
  }, [map, refresh, resetTo, say]);

  const renameMap = useCallback((name: string) => setHist((h) => ({ ...h, present: { ...h.present, name: name.slice(0, MAP_LIMITS.maxNameLength) } })), []);

  const removeMap = useCallback(async () => {
    if (!window.confirm(`Excluir o mapa "${map.name}" do disco? Isso não pode ser desfeito.`)) return;
    setBusy(true);
    try {
      if (saved) await deleteMap(map.id);
      resetTo(createMap(map.kind, "Meu mapa"), null);
      say("Mapa excluído.", "ok");
      await refresh();
    } catch (e) { say(e instanceof Error ? e.message : "Erro ao excluir.", "err"); }
    finally { setBusy(false); }
  }, [map.id, map.kind, map.name, refresh, resetTo, saved, say]);

  // avisa antes de fechar a aba com alterações não salvas
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  useEffect(() => { if (selectedId && !map.objects.some((o) => o.id === selectedId)) setSelectedId(null); }, [map, selectedId]);

  return {
    paletteDrag, map, dirty, saved, selected, selectedId, setSelectedId, warnings, islandIds, armed, setArmed, hint, setHint, scope, setScope, mode, setMode,
    showConnections, setShowConnections, maps, notice, say, bots, busy, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0,
    add, move, remove, duplicate, rotate, level, prop, islandMove, attach, detach, undo: doUndo, redo: doRedo, addBot, removeBot,
    newMap, save, open, duplicateMap, renameMap, removeMap, refresh, maxBots: BOT_CONFIG.maxBots,
  };
}

export type Editor = ReturnType<typeof useEditor>;
