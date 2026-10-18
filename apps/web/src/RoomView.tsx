import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import {
  BOARD_SIZES, C, CHAT_BUBBLE_MS, CHAT_MIN_INTERVAL_MS, GAMES, MAX_CHAT_LENGTH, MAX_PLAYERS, S, isEmote,
  type ArenaEvent, type ArenaSnapshot, type AttackPayload, type BoardEvent, type BoardPublicState, type ChallengeInput,
  type ChatMessage, type DodgePayload, type EmoteId, type EmotePayload, type GameId, type PhasePayload, type PlayerInfo,
  type ImpostorPublicState, type PlayerPos, type PoolPublicState, type PoolShotMsg, type QueueState, type TableState, type WelcomePayload,
} from "@jogo/shared";
import { forgetSession } from "./net";
import type { ActionState, Bubble, CameraMode, Effect, EmoteState } from "./Scene";
import { type Action, type Settings, keyLabel, loadSettings, saveSettings } from "./controls";
import { SettingsPanel } from "./Settings";
import { EmoteWheel } from "./EmoteWheel";
import { BoardHUD, type RollInfo } from "./BoardHUD";
import { ArenaHUD } from "./ArenaHUD";
import { PoolHUD } from "./PoolHUD";
import { ImpostorHUD } from "./ImpostorHUD";
import { TouchControls } from "./TouchControls";
import { enterLandscape, isTouchDevice, leaveLandscape, newTouchState } from "./platform";
import type { PoolUi } from "./PoolScene";

export const INVENTORY_SLOTS = 4;
/** Itens ainda não definidos no PRD; os slots existem e podem ser selecionados, mas começam vazios. */
type Slot = { id: string; name: string; icon: string } | null;

const GameCanvas = lazy(() => import("./GameCanvas"));

type Line = { key: string; kind: "chat" | "notice"; nick?: string; text: string; dead?: boolean };

export function RoomView({ room, onLeave }: { room: Room; onLeave: (msg?: string) => void }) {
  const [code, setCode] = useState("");
  const [you, setYou] = useState(room.sessionId);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastSent, setLastSent] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("third");
  const [slots] = useState<Slot[]>(() => Array.from({ length: INVENTORY_SLOTS }, () => null));
  const [selected, setSelected] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Servidor em modo de desenvolvimento (só vale se este build também for de desenvolvimento). */
  const [devServer, setDevServer] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [gameInfo, setGameInfo] = useState<PhasePayload>({ phase: "lobby", game: null });
  const [board, setBoard] = useState<BoardPublicState | null>(null);
  const [roll, setRoll] = useState<RollInfo | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [near, setNear] = useState<GameId | null>(null);
  const [pool, setPool] = useState<PoolPublicState | null>(null);
  const [impostor, setImpostor] = useState<ImpostorPublicState | null>(null);
  const [role, setRole] = useState<"impostor" | null>(null);
  const [, setTick] = useState(0);
  const [isTouch] = useState(isTouchDevice);
  const [chatOpen, setChatOpen] = useState(!isTouchDevice());
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const positions = useRef(new Map<string, PlayerPos>());
  const bubbleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const settingsRef = useRef(settings);
  const uiBlock = useRef(false);
  const wheelRef = useRef(false);
  const emotes = useRef(new Map<string, EmoteState>());
  const actions = useRef(new Map<string, ActionState>());
  const snaps = useRef(new Map<string, { x: number; z: number }>());
  const pops = useRef(new Map<string, number>());
  const effectKey = useRef(0);
  const boardOffset = useRef(0);
  const arenaOffset = useRef(0);
  const arena = useRef<ArenaSnapshot | null>(null);
  const arenaEvents = useRef<ArenaEvent[]>([]);
  const poolRef = useRef<TableState | null>(null);
  const poolShot = useRef<PoolShotMsg | null>(null);
  const impRef = useRef<ImpostorPublicState | null>(null);
  const nullImp = useRef<ImpostorPublicState | null>(null);
  const poolUi = useRef<PoolUi>({ charging: false, power: 0, canShoot: false, placing: false, placeValid: true, replay: false, aim: 0 });
  const poolOffset = useRef(0);
  const rollKey = useRef(0);
  const inGameRef = useRef(false);
  const nearRef = useRef<GameId | null>(null);
  const queueRef = useRef<QueueState | null>(null);
  const youRef = useRef(room.sessionId);
  const touch = useRef(newTouchState());

  const toggleCamera = useCallback(() => setCameraMode((m) => (m === "first" ? "third" : "first")), []);

  const updateSettings = useCallback((next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

  const addEffect = useCallback((e: { from: { x: number; z: number }; to: { x: number; z: number } }) => {
    const key = effectKey.current++;
    setEffects((list) => [...list, { key, ...e, t0: performance.now() }]);
    setTimeout(() => setEffects((list) => list.filter((x) => x.key !== key)), 900);
  }, []);

  const relockMouse = () => {}; // o mouse não é mais travado: o cursor fica livre

  const playEmote = useCallback((id: EmoteId) => {
    emotes.current.set(room.sessionId, { name: id, start: performance.now() });
    room.send(C.Emote, { emote: id });
    wheelRef.current = false;
    setWheelOpen(false);
    relockMouse();
  }, [room]);

  const closeSettings = useCallback(() => { uiBlock.current = false; setSettingsOpen(false); }, []);
  const openSettings = () => {
    if (document.pointerLockElement) document.exitPointerLock();
    wheelRef.current = false;
    setWheelOpen(false);
    setMenuOpen(false);
    uiBlock.current = true;
    setSettingsOpen(true);
  };
  const closeWheel = useCallback(() => { wheelRef.current = false; setWheelOpen(false); }, []);
  useEffect(() => () => leaveLandscape(), []);

  const toggleMenu = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock();
    setMenuOpen((o) => !o);
  }, []);

  const sendRoll = useCallback(() => room.send(C.Roll), [room]);
  const sendChallenge = useCallback((i: ChallengeInput) => room.send(C.Challenge, i), [room]);
  const endGame = useCallback(() => room.send(C.EndGame), [room]);
  const voteBoardSize = useCallback((size: number) => room.send(C.BoardSize, { size }), [room]);

  /** Entra ou sai da fila do jogo da estação mais próxima. */
  const toggleQueue = useCallback(() => {
    const g = nearRef.current;
    if (!g) return;
    const q = queueRef.current;
    if (q?.games[g].members.includes(youRef.current)) room.send(C.LeaveQueue);
    else room.send(C.JoinQueue, { game: g });
  }, [room]);

  if (import.meta.env.DEV) {
    (window as unknown as { __emotes: unknown }).__emotes = emotes.current;
    (window as unknown as { __emote: unknown }).__emote = (id: EmoteId) => {
      emotes.current.set(room.sessionId, { name: id, start: performance.now() });
      room.send(C.Emote, { emote: id });
    };
  }

  useEffect(() => {
    const add = (l: Omit<Line, "key">) => setLines((p) => [...p.slice(-199), { ...l, key: String(counter.current++) }]);
    room.onMessage(S.Welcome, (w: WelcomePayload) => {
      setCode(w.code);
      setYou(w.you);
      youRef.current = w.you;
      setPlayers(w.players);
      setDevServer(!!w.dev);
      setLines(w.history.map((m) => ({ key: `h${m.id}`, kind: "chat", nick: m.nick, text: m.text })));
    });
    room.onMessage(S.Players, (p: PlayerInfo[]) => setPlayers(p));
    room.onMessage(S.Positions, (list: PlayerPos[]) => {
      const next = new Map<string, PlayerPos>();
      for (const p of list) next.set(p.id, p);
      positions.current = next;
    });
    room.onMessage(S.Chat, (m: ChatMessage) => {
      add({ kind: "chat", nick: m.channel === "dead" ? `👻 ${m.nick}` : m.nick, text: m.text, dead: m.channel === "dead" });
      if (m.channel === "dead") return; // o canal dos eliminados não aparece em balões
      setBubbles((b) => ({ ...b, [m.authorId]: { text: m.text } }));
      clearTimeout(bubbleTimers.current.get(m.authorId));
      bubbleTimers.current.set(m.authorId, setTimeout(() => {
        setBubbles((b) => { const { [m.authorId]: _gone, ...rest } = b; return rest; });
      }, CHAT_BUBBLE_MS));
    });
    room.onMessage(S.Notice, (t: string) => add({ kind: "notice", text: t }));
    room.onMessage(S.Emote, (e: EmotePayload) => {
      if (isEmote(e?.emote) && typeof e.id === "string") emotes.current.set(e.id, { name: e.emote, start: performance.now() });
    });
    room.onMessage(S.Attack, (a: AttackPayload) => {
      if (a && typeof a.id === "string" && (a.kind === "punch" || a.kind === "kick" || a.kind === "shove")) {
        actions.current.set(a.id, { kind: a.kind, start: performance.now() });
      }
    });
    room.onMessage(S.Dodge, (d: DodgePayload) => {
      snaps.current.set(d.id, { x: d.tx, z: d.tz });
      pops.current.set(d.id, performance.now() + 110);
      addEffect({ from: { x: d.fx, z: d.fz }, to: { x: d.tx, z: d.tz } });
    });
    room.onMessage(S.Queue, (q: QueueState) => { queueRef.current = q; setQueue(q); });
    room.onMessage(S.Phase, (p: PhasePayload) => {
      inGameRef.current = p.phase === "in-game";
      setGameInfo(p);
      if (p.phase === "lobby") { setBoard(null); setRoll(null); arena.current = null; arenaEvents.current = []; setPool(null); poolRef.current = null; poolShot.current = null; setImpostor(null); impRef.current = null; setRole(null); }
    });
    room.onMessage(S.Board, (b: BoardPublicState) => {
      boardOffset.current = b.serverNow - Date.now(); // sincroniza o relógio com o servidor
      setBoard(b);
    });
    room.onMessage(S.BoardEvent, (e: BoardEvent) => {
      if (e.kind === "roll") setRoll({ key: rollKey.current++, playerId: e.playerId, value: e.value });
    });
    room.onMessage(S.Pool, (s: PoolPublicState) => { poolRef.current = s; poolOffset.current = s.serverNow - Date.now(); setPool(s); });
    room.onMessage(S.PoolShot, (m: PoolShotMsg) => { poolShot.current = m; });
    room.onMessage(S.Impostor, (s: ImpostorPublicState) => {
      impRef.current = s;
      poolRef.current = s; // a cena da mesa lê o mesmo formato (balls, phase, turn)
      poolOffset.current = s.serverNow - Date.now();
      setImpostor(s);
    });
    room.onMessage(S.Role, (r: { role: "impostor" }) => { if (r?.role === "impostor") setRole("impostor"); });
    room.onMessage(S.Arena, (a: ArenaSnapshot) => { arena.current = a; arenaOffset.current = a.serverNow - Date.now(); });
    room.onMessage(S.ArenaEvent, (e: ArenaEvent) => { arenaEvents.current.push(e); });
    room.onLeave((closeCode) => {
      if (closeCode === 1000) return; // saída consentida
      forgetSession();
      onLeave("Você foi desconectado da sala.");
    });
    room.send(C.Hello); // pede o estado inicial agora que os handlers existem
    const timers = bubbleTimers.current;
    return () => { room.removeAllListeners(); timers.forEach(clearTimeout); };
  }, [room, onLeave, addEffect]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  // relógio para a contagem regressiva da fila (atualiza a cada 250 ms só enquanto há contagem)
  const myCountdown = queue
    ? (Object.entries(queue.games) as [GameId, QueueState["games"][GameId]][]).find(([, g]) => g.startsAt && g.members.includes(you))
    : undefined;
  useEffect(() => {
    if (!myCountdown) return;
    const iv = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(iv);
  }, [myCountdown]);

  // Atalhos do jogo (configuráveis): chat, menu de gestos, interagir e slots do inventário
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (uiBlock.current) return;
      const b = settingsRef.current.bindings;
      const typing = document.activeElement === inputRef.current;
      if (e.code === "Escape") { inputRef.current?.blur(); setMenuOpen(false); return; }
      if (typing) return;
      if (e.code === "Tab") { e.preventDefault(); toggleMenu(); return; }
      if (e.code === b.chat) {
        e.preventDefault();
        if (document.pointerLockElement) document.exitPointerLock();
        inputRef.current?.focus();
      } else if (e.code === b.emotes && !e.repeat) {
        const next = !wheelRef.current;
        wheelRef.current = next;
        setWheelOpen(next);
        if (next && document.pointerLockElement) document.exitPointerLock();
        if (!next) relockMouse();
      } else if (e.code === b.interact && !e.repeat && !inGameRef.current) {
        toggleQueue();
      } else if (!wheelRef.current && !inGameRef.current) {
        const slot = (["slot1", "slot2", "slot3", "slot4"] as Action[]).findIndex((a) => b[a] === e.code);
        if (slot >= 0) setSelected((cur) => (cur === slot ? null : slot));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMenu, toggleQueue]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || Date.now() - lastSent < CHAT_MIN_INTERVAL_MS) return;
    room.send(C.Chat, { text: t });
    setLastSent(Date.now());
    setText("");
    inputRef.current?.blur();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* navegador sem permissão */ }
  }

  async function leave() {
    forgetSession();
    leaveLandscape();
    if (document.pointerLockElement) document.exitPointerLock();
    await room.leave(true);
    onLeave();
  }

  const onNearStation = useCallback((g: GameId | null) => { nearRef.current = g; setNear(g); }, []);

  const inBoard = gameInfo.phase === "in-game" && gameInfo.game === "board" && board !== null;
  const inPool = gameInfo.phase === "in-game" && gameInfo.game === "pool" && pool !== null;
  const inImpostor = gameInfo.phase === "in-game" && gameInfo.game === "impostor" && impostor !== null;
  const inArena = inBoard && board.phase === "arena";
  const serverNow = () => Date.now() + (queue ? queue.serverNow - Date.now() : 0);

  // botão de jogar (aparece perto de uma estação)
  let stationBtn: { label: string; disabled: boolean; onClick: () => void; variant: string } | null = null;
  if (!inBoard && !inPool && !inImpostor && near) {
    const def = GAMES[near];
    const g = queue?.games[near];
    const n = g?.members.length ?? 0;
    const inQueue = g?.members.includes(you) ?? false;
    if (!def.available) stationBtn = { label: `${def.icon} ${def.label}: em breve`, disabled: true, onClick: () => {}, variant: "" };
    else if (queue?.busy) stationBtn = { label: "Há um jogo em andamento…", disabled: true, onClick: () => {}, variant: "" };
    else if (inQueue) stationBtn = { label: `Sair da fila (${n}/${def.min})`, disabled: false, onClick: toggleQueue, variant: "" };
    else stationBtn = { label: `${def.icon} Jogar ${def.label} (${n}/${def.min}) · ${keyLabel(settings.bindings.interact)}`, disabled: false, onClick: toggleQueue, variant: "primary" };
  }

  return (
    <main className="stage">
      <div className="canvas">
        <Suspense fallback={<div className="loading">Carregando o mundo 3D…</div>}>
          <GameCanvas
            mode={inArena ? "arena" : inPool || inImpostor ? "pool" : inBoard ? "board" : "lobby"}
            lobby={{
              room, you, players, positions, bubbles, cameraMode, onToggleCamera: toggleCamera, settingsRef, uiBlock,
              emotes, snaps, pops, effects, onDodge: addEffect, queue, actions, onNearStation, touch,
            }}
            board={inBoard ? { state: board, players, you, bubbles, emotes, roll } : null}
            arena={{ room, you, players, arena, events: arenaEvents, bubbles, emotes, settingsRef, uiBlock, touch }}
            pool={{ room, you, players, pool: poolRef, seats: inImpostor ? impostor.players.map((p) => p.id) : pool ? [...pool.players] : [], imp: inImpostor ? impRef : nullImp, shot: poolShot, ui: poolUi, bubbles, emotes, settingsRef, uiBlock }}
          />
        </Suspense>
      </div>

      {inPool && <PoolHUD pool={pool} ui={poolUi} offsetRef={poolOffset} players={players} you={you} settings={settings} onEnd={endGame}
        isTouch={isTouch} onShoot={(angle, power) => room.send(C.PoolShoot, { angle, power })} />}
      {inImpostor && <ImpostorHUD state={impostor} ui={poolUi} offsetRef={poolOffset} players={players} you={you} role={role}
        onDecide={(attack) => room.send(C.ImpostorDecide, { attack })} onEnd={endGame}
        isTouch={isTouch} onShoot={(angle, power) => room.send(C.PoolShoot, { angle, power })} />}
      {inArena && <ArenaHUD arena={arena} offsetRef={arenaOffset} players={players} you={you} settings={settings} />}
      {inBoard && !inArena && (
        <BoardHUD state={board} players={players} you={you} isHost={true} offsetRef={boardOffset}
          roll={roll} onRoll={sendRoll} onChallenge={sendChallenge} onEnd={endGame} />
      )}

      {isTouch && (!inBoard && !inPool && !inImpostor || inArena) && !menuOpen && !settingsOpen && (
        <TouchControls touch={touch} mode={inArena ? "arena" : "lobby"}
          onEmotes={() => { wheelRef.current = true; setWheelOpen(true); }} />
      )}

      {/* único botão geral: tudo que não é jogo fica no menu */}
      <button className="hud menubtn" onClick={toggleMenu} aria-label="Menu" aria-expanded={menuOpen}>☰ Menu</button>

      {!inBoard && !inPool && !inImpostor && myCountdown && (
        <div className="hud queuebanner panel">
          {GAMES[myCountdown[0]].icon} {GAMES[myCountdown[0]].label} começa em <b>{Math.max(0, Math.ceil(((myCountdown[1].startsAt ?? 0) - serverNow()) / 1000))}s</b>
          {" "}({myCountdown[1].members.length} jogadores)
        </div>
      )}

      {!inBoard && !inPool && !inImpostor && near === "board" && !queue?.busy && queue?.games.board.members.includes(you) && (
        <div className="hud sizepick panel">
          <div className="sizetitle">Tamanho do tabuleiro <small>(vence o mais votado)</small></div>
          <div className="sizebtns">
            {BOARD_SIZES.map((n) => {
              const votes = Object.values(queue.boardVotes).filter((v) => v === n).length;
              return (
                <button key={n} className={queue.boardVotes[you] === n ? "primary" : ""} onClick={() => voteBoardSize(n)}>
                  {n} casas{votes > 0 && <span className="votes"> · {votes}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {stationBtn && (
        <div className="hud stationbtn">
          <button className={stationBtn.variant} disabled={stationBtn.disabled} onClick={stationBtn.onClick}>{stationBtn.label}</button>
        </div>
      )}

      {isTouch && <button className="hud chatbtn" onClick={() => setChatOpen((o) => !o)} aria-label="Chat">💬</button>}
      <div className={`hud bottom-left panel chat${chatOpen ? "" : " collapsed"}`}>
        <div className="log" ref={logRef} aria-live="polite">
          {lines.map((l) => l.kind === "notice"
            ? <p key={l.key} className="notice">{l.text}</p>
            : <p key={l.key} className={l.dead ? "deadmsg" : undefined}><b>{l.nick}:</b> {l.text}</p>)}
        </div>
        <form className="row" onSubmit={send}>
          <input ref={inputRef} value={text} maxLength={MAX_CHAT_LENGTH} onChange={(e) => setText(e.target.value)}
            placeholder={`${keyLabel(settings.bindings.chat)} para conversar`} aria-label="Mensagem" />
          <button type="submit">Enviar</button>
        </form>
      </div>

      <div className="hud inventory" role="toolbar" aria-label="Inventário">
        <div className="slot-name">{selected === null ? "" : slots[selected]?.name ?? "Vazio"}</div>
        <div className="slots">
          {slots.map((item, i) => (
            <button key={i} type="button" className={i === selected ? "slot on" : "slot"} aria-pressed={i === selected}
              aria-label={`Slot ${i + 1}: ${item?.name ?? "vazio"}`} onClick={() => setSelected((c) => (c === i ? null : i))}>
              <span className="slot-key">{keyLabel(settings.bindings[`slot${i + 1}` as Action])}</span>
              <span className="slot-icon">{item?.icon ?? ""}</span>
            </button>
          ))}
        </div>
      </div>

      {menuOpen && (
        <aside className="hud menu panel" aria-label="Menu">
          <header>
            <h2>Menu</h2>
            <button onClick={() => setMenuOpen(false)} aria-label="Fechar">✕</button>
          </header>
          <section>
            <span className="muted">Código da sala</span>
            <button className="codebtn" onClick={copy} title="Copiar código">{code || "…"} {copied ? "✓" : "📋"}</button>
          </section>
          <section>
            <h3>Jogadores ({players.length}/{MAX_PLAYERS})</h3>
            <ul>
              {players.map((p) => (
                <li key={p.id} className={p.away ? "away" : ""}>
                  <span className="dot" style={{ background: p.color }} />
                  {p.nick}{p.id === you ? " (você)" : ""}
                  {p.isHost && <span className="tag">anfitrião</span>}
                  {p.inGame && <span className="tag">em partida</span>}
                  {p.away && <span className="tag">reconectando…</span>}
                  {p.bot && <span className="tag">bot</span>}
                </li>
              ))}
            </ul>
          </section>
          <section className="menubtns">
            <button onClick={() => { setMenuOpen(false); toggleCamera(); }} disabled={inBoard || inPool || inImpostor}>Câmera: {cameraMode === "first" ? "1ª pessoa" : "3ª pessoa"} ({keyLabel(settings.bindings.camera)})</button>
            <button onClick={() => { setMenuOpen(false); wheelRef.current = true; setWheelOpen(true); }}>Gestos ({keyLabel(settings.bindings.emotes)})</button>
            <button onClick={openSettings}>⚙ Configurações</button>
          </section>
          {import.meta.env.DEV && devServer && (
            <section className="menubtns devtools">
              <h3>🛠 Modo Dev</h3>
              <button onClick={() => room.send(C.DevAddBot)}>＋ Adicionar bot</button>
              <button onClick={() => room.send(C.DevRemoveBot)} disabled={!players.some((p) => p.bot)}>－ Remover bot</button>
              <a className="devlink" href="/dev" target="_blank" rel="noreferrer">Abrir o editor de mapas ↗</a>
            </section>
          )}
          <section className="help">
            <h3>Controles</h3>
            <span>{keyLabel(settings.bindings.forward)}{keyLabel(settings.bindings.left)}{keyLabel(settings.bindings.back)}{keyLabel(settings.bindings.right)}: mover · {keyLabel(settings.bindings.jump)}: pular</span>
            <span>{keyLabel(settings.bindings.run)}: correr · + direção: esquiva</span>
            <span>Mouse: arraste para olhar · {keyLabel(settings.bindings.punch)}: soco · {keyLabel(settings.bindings.kick)}: chute · {keyLabel(settings.bindings.shove)}: empurrão</span>
            <span>{keyLabel(settings.bindings.interact)}: jogar na estação · {keyLabel(settings.bindings.emotes)}: gestos</span>
            <span>{keyLabel(settings.bindings.chat)}: chat · Esc: fechar menus · Tab: este menu</span>
            <span className="muted">No lobby os golpes são só para brincar: ninguém sofre dano.</span>
          </section>
          <button className="danger" onClick={leave}>Sair da sala</button>
        </aside>
      )}

      <div className="rotate-notice" role="alert">
        <div className="rn-icon">📱↻</div>
        <p>Gire o aparelho para a horizontal para jogar.</p>
        <button className="primary" onClick={() => void enterLandscape()}>Deitar a tela automaticamente</button>
      </div>

      {wheelOpen && <EmoteWheel onPick={playEmote} onClose={closeWheel} />}
      {settingsOpen && <SettingsPanel settings={settings} onChange={updateSettings} onClose={closeSettings} />}
    </main>
  );
}
