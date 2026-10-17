import { Client, Room, matchMaker } from "@colyseus/core";
import { BoardGame } from "./BoardGame";
import { PoolGame } from "./PoolGame";
import { ImpostorGame } from "./ImpostorGame";
import {
  BOARD_RULES, C, CHAT_HISTORY_SIZE, EMOTE_COOLDOWN_MS, POSITIONS_BROADCAST_MS, CHAT_MIN_INTERVAL_MS, EMPTY_ROOM_TTL_MS, LOBBY_ATTACK_COOLDOWN_MS,
  MAX_PLAYERS, QUEUE_COUNTDOWN_MS, RECONNECT_WINDOW_S, S, GAMES, GAME_IDS, STATION_LEAVE_RADIUS, STATION_RADIUS_SERVER,
  generateRoomCode, isEmote, isGameId, sanitizeAngle, sanitizeChat, sanitizeHeight, sanitizeColor, sanitizeNick, spawnPoint, stepMove, validateDodge,
  type AttackPayload, type ChatMessage, type DodgePayload, type EmotePayload, type GameId, type PhasePayload, type JoinOptions, type PlayerInfo,
  type PlayerPos, type QueueState, type WelcomePayload,
} from "@jogo/shared";

interface Member {
  id: string;
  nick: string;
  color: string;
  joinedAt: number;
  away: boolean;
  lastChatAt: number;
  x: number;
  z: number;
  ry: number;
  y: number;
  lastMoveAt: number;
  lastDodgeAt: number;
  lastEmoteAt: number;
  lastAttackAt: number;
}

export class GameRoom extends Room {
  maxClients = MAX_PLAYERS;
  autoDispose = false; // o descarte é controlado por emptyTimer (10 min)

  private members = new Map<string, Member>(); // chave: sessionId
  private hostId: string | null = null;
  /** Partida em andamento (só uma por sala); só quem está na lista de jogadores vê a partida. */
  private active: { id: GameId; game: BoardGame | PoolGame | ImpostorGame; players: Set<string> } | null = null;
  private queues = new Map<GameId, Set<string>>(GAME_IDS.map((g) => [g, new Set<string>()]));
  private countdowns = new Map<GameId, { timer: NodeJS.Timeout; startsAt: number }>();
  private returnTimer: NodeJS.Timeout | null = null;
  private history: ChatMessage[] = [];
  private nextMsgId = 1;
  private emptyTimer: NodeJS.Timeout | null = null;
  private code = "";
  private spawnCounter = 0;
  private dirty = false;

  async onCreate() {
    this.code = await this.reserveCode();
    this.setPrivate(true); // salas privadas: só entram com o código
    this.onMessage(C.Chat, (client, raw: unknown) => this.handleChat(client, raw));
    // O cliente só registra seus handlers depois de entrar; por isso ele pede o estado inicial.
    this.onMessage(C.Hello, (client) => this.sendWelcome(client));
    this.onMessage(C.JoinQueue, (client, raw: unknown) => this.handleJoinQueue(client, raw));
    this.onMessage(C.LeaveQueue, (client) => this.removeFromQueues(client.sessionId));
    this.onMessage(C.EndGame, (client) => {
      if (this.active?.players.has(client.sessionId) && this.active.game.finished) this.endGame();
    });
    this.onMessage(C.Roll, (client) => this.gameFor(client)?.handleRoll(client.sessionId));
    this.onMessage(C.Challenge, (client, raw: unknown) => {
      if (typeof raw === "object" && raw !== null) this.gameFor(client)?.handleChallenge(client.sessionId, raw as never);
    });
    this.onMessage(C.ArenaInput, (client, raw: unknown) => this.gameFor(client)?.handleArenaInput(client.sessionId, raw));
    this.onMessage(C.ArenaAction, (client, raw: unknown) => this.gameFor(client)?.handleArenaAction(client.sessionId, raw));
    this.onMessage(C.PoolShoot, (client, raw: unknown) => (this.poolFor(client) ?? this.impostorFor(client))?.handleShoot(client.sessionId, raw));
    this.onMessage(C.ImpostorDecide, (client, raw: unknown) => this.impostorFor(client)?.handleDecision(client.sessionId, raw));
    this.onMessage(C.PoolPlace, (client, raw: unknown) => this.poolFor(client)?.handlePlace(client.sessionId, raw));
    this.onMessage(C.Attack, (client, raw: unknown) => this.handleAttack(client, raw));
    this.onMessage(C.Move, (client, raw: unknown) => this.handleMove(client, raw));
    this.onMessage(C.Dodge, (client, raw: unknown) => this.handleDodge(client, raw));
    this.onMessage(C.Emote, (client, raw: unknown) => this.handleEmote(client, raw));
    this.clock.setInterval(() => this.flushPositions(), POSITIONS_BROADCAST_MS);
    this.scheduleEmptyDispose();
    console.log(`[sala ${this.code}] criada`);
  }

  /** Gera um código curto e o usa como roomId, repetindo se já existir. */
  private async reserveCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode();
      const taken = await matchMaker.getRoomById(code);
      if (!taken) {
        this.roomId = code;
        return code;
      }
    }
    throw new Error("Não foi possível gerar um código de sala");
  }

  onAuth(_client: Client, options: Partial<JoinOptions>) {
    if (!sanitizeNick(options?.nick)) throw new Error("Informe um apelido válido.");
    return true;
  }

  onJoin(client: Client, options: JoinOptions) {
    this.cancelEmptyDispose();
    const spawn = spawnPoint(this.spawnCounter++);
    this.members.set(client.sessionId, {
      id: client.sessionId,
      nick: this.uniqueNick(sanitizeNick(options.nick)),
      color: sanitizeColor(options.color),
      joinedAt: Date.now(),
      away: false,
      lastChatAt: 0,
      x: spawn.x,
      z: spawn.z,
      ry: 0,
      y: 0,
      lastMoveAt: Date.now(),
      lastDodgeAt: 0,
      lastEmoteAt: 0,
      lastAttackAt: 0,
    });
    this.dirty = true;
    if (!this.hostId) this.hostId = client.sessionId;

    this.broadcastPlayers();
    this.notice(`${this.members.get(client.sessionId)!.nick} entrou na sala.`);
  }

  async onLeave(client: Client, consented: boolean) {
    const member = this.members.get(client.sessionId);
    if (!member) return;

    if (!consented) {
      member.away = true;
      this.broadcastPlayers();
      try {
        await this.allowReconnection(client, RECONNECT_WINDOW_S);
        member.away = false;
        this.broadcastPlayers();
        return;
      } catch {
        // janela expirou: segue para a remoção definitiva
      }
    }
    this.removeMember(client.sessionId);
  }

  // ---- jogos: filas nas estações do lobby ----
  private gameFor(client: Client): BoardGame | null {
    const a = this.active;
    return a && a.players.has(client.sessionId) && a.game instanceof BoardGame ? a.game : null;
  }

  private poolFor(client: Client): PoolGame | null {
    const a = this.active;
    return a && a.players.has(client.sessionId) && a.game instanceof PoolGame ? a.game : null;
  }

  private impostorFor(client: Client): ImpostorGame | null {
    const a = this.active;
    return a && a.players.has(client.sessionId) && a.game instanceof ImpostorGame ? a.game : null;
  }

  private phaseFor(id: string): PhasePayload {
    return this.active?.players.has(id) ? { phase: "in-game", game: this.active.id } : { phase: "lobby", game: null };
  }

  private queueState(): QueueState {
    const games = {} as QueueState["games"];
    for (const g of GAME_IDS) games[g] = { members: Array.from(this.queues.get(g)!), startsAt: this.countdowns.get(g)?.startsAt ?? null };
    return { games, busy: this.active?.id ?? null, serverNow: Date.now() };
  }

  private broadcastQueue() {
    this.broadcast(S.Queue, this.queueState());
  }

  private sendToPlayers(type: string, payload: unknown) {
    if (!this.active) return;
    for (const c of this.clients) if (this.active.players.has(c.sessionId)) c.send(type, payload);
  }

  private handleJoinQueue(client: Client, raw: unknown) {
    const m = this.members.get(client.sessionId);
    const game = typeof raw === "object" && raw ? (raw as { game?: unknown }).game : raw;
    if (!m || !isGameId(game)) return;
    const def = GAMES[game];
    if (!def.available) return void client.send(S.Notice, `${def.label} ainda não está disponível.`);
    if (this.active) return void client.send(S.Notice, "Já há um jogo em andamento na sala. Aguarde o fim.");
    if (Math.hypot(m.x - def.station.x, m.z - def.station.z) > STATION_RADIUS_SERVER) {
      return void client.send(S.Notice, "Chegue mais perto da estação para entrar na fila.");
    }
    const q = this.queues.get(game)!;
    if (q.has(m.id)) return;
    if (q.size >= def.max) return void client.send(S.Notice, `A fila de ${def.label} está cheia.`);
    this.removeFromQueues(m.id, true);
    q.add(m.id);
    this.notice(`${m.nick} entrou na fila de ${def.label} (${q.size}/${def.min}).`);
    this.refreshCountdown(game);
    this.broadcastQueue();
  }

  private removeFromQueues(id: string, silent = false) {
    let changed = false;
    for (const g of GAME_IDS) {
      const q = this.queues.get(g)!;
      if (q.delete(id)) {
        changed = true;
        this.refreshCountdown(g);
      }
    }
    if (changed && !silent) this.broadcastQueue();
  }

  /** Inicia a contagem de 10 s quando a fila alcança o mínimo; cancela se cair abaixo dele. */
  private refreshCountdown(game: GameId) {
    const def = GAMES[game];
    const size = this.queues.get(game)!.size;
    const running = this.countdowns.get(game);
    if (size >= def.min && !running) {
      const startsAt = Date.now() + QUEUE_COUNTDOWN_MS;
      const timer = setTimeout(() => this.startGame(game), QUEUE_COUNTDOWN_MS);
      this.countdowns.set(game, { timer, startsAt });
    } else if (size < def.min && running) {
      clearTimeout(running.timer);
      this.countdowns.delete(game);
    }
  }

  private startGame(game: GameId) {
    const run = this.countdowns.get(game);
    if (run) clearTimeout(run.timer);
    this.countdowns.delete(game);
    const def = GAMES[game];
    const players = Array.from(this.queues.get(game)!).filter((id) => this.members.has(id));
    this.queues.get(game)!.clear();
    if (this.active || players.length < def.min || !def.available) {
      this.broadcastQueue();
      return;
    }
    const set = new Set(players);
    const host = {
      send: (type: string, payload: unknown) => this.sendToPlayers(type, payload),
      sendTo: (id: string, type: string, payload: unknown) => { for (const c of this.clients) if (c.sessionId === id) c.send(type, payload); },
      isAway: (id: string) => this.members.get(id)?.away ?? true,
      onEnded: () => this.onGameEnded(),
    };
    this.active = {
      id: game,
      players: set,
      game: game === "pool" ? new PoolGame(host, [players[0]!, players[1]!]) : game === "impostor" ? new ImpostorGame(host, players) : new BoardGame(host, players),
    };
    for (const c of this.clients) if (set.has(c.sessionId)) c.send(S.Phase, this.phaseFor(c.sessionId));
    this.broadcastPlayers();
    this.broadcastQueue();
    this.active.game.start();
  }

  /** Vitória ou cancelamento: volta ao lobby automaticamente depois de um tempo (qualquer jogador pode antecipar). */
  private onGameEnded() {
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = setTimeout(() => this.endGame(), BOARD_RULES.returnToLobbyMs);
  }

  private endGame() {
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = null;
    const active = this.active;
    if (!active) return;
    active.game.dispose();
    this.active = null;
    for (const c of this.clients) if (active.players.has(c.sessionId)) c.send(S.Phase, { phase: "lobby", game: null } satisfies PhasePayload);
    this.broadcastPlayers();
    this.broadcastQueue();
  }

  /** Ataques no lobby são só visuais (ninguém sofre dano); o servidor apenas retransmite com limite de frequência. */
  private handleAttack(client: Client, raw: unknown) {
    const m = this.members.get(client.sessionId);
    const kind = typeof raw === "object" && raw ? (raw as { kind?: unknown }).kind : raw;
    if (!m || (kind !== "punch" && kind !== "kick" && kind !== "shove")) return;
    if (this.active?.players.has(m.id)) return;
    const now = Date.now();
    if (now - m.lastAttackAt < LOBBY_ATTACK_COOLDOWN_MS) return;
    m.lastAttackAt = now;
    this.broadcast(S.Attack, { id: m.id, kind } satisfies AttackPayload, { except: client });
  }

  onDispose() {
    this.active?.game.dispose();
    for (const c of this.countdowns.values()) clearTimeout(c.timer);
    if (this.returnTimer) clearTimeout(this.returnTimer);
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    console.log(`[sala ${this.code}] encerrada`);
  }

  private sendWelcome(client: Client) {
    if (!this.members.has(client.sessionId)) return;
    const welcome: WelcomePayload = {
      you: client.sessionId,
      code: this.code,
      phase: this.phaseFor(client.sessionId).phase,
      players: this.playerList(),
      history: this.history,
    };
    client.send(S.Welcome, welcome);
    client.send(S.Phase, this.phaseFor(client.sessionId));
    client.send(S.Queue, this.queueState());
    if (this.active?.players.has(client.sessionId)) this.active.game.sendStateTo((t, p) => client.send(t, p), client.sessionId);
    this.dirty = true; // reenvia posições para quem acabou de entrar
  }

  // ---- chat ----
  private handleChat(client: Client, raw: unknown) {
    const member = this.members.get(client.sessionId);
    if (!member) return;
    const now = Date.now();
    if (now - member.lastChatAt < CHAT_MIN_INTERVAL_MS) return; // rate limit
    const text = sanitizeChat(typeof raw === "object" && raw ? (raw as { text?: unknown }).text : raw);
    if (!text) return;
    member.lastChatAt = now;

    // Sinuca Impostor: os eliminados têm um canal próprio que só eles recebem (os vivos não o veem)
    const a = this.active;
    if (a && a.game instanceof ImpostorGame && a.players.has(member.id) && a.game.isDead(member.id)) {
      const dead: ChatMessage = { id: this.nextMsgId++, authorId: member.id, nick: member.nick, text, at: now, channel: "dead" };
      for (const c of this.clients) if (a.players.has(c.sessionId) && a.game.isDead(c.sessionId)) c.send(S.Chat, dead);
      return;
    }
    const msg: ChatMessage = { id: this.nextMsgId++, authorId: member.id, nick: member.nick, text, at: now };
    this.history.push(msg);
    if (this.history.length > CHAT_HISTORY_SIZE) this.history.shift();
    this.broadcast(S.Chat, msg);
  }

  // ---- movimento ----
  private handleMove(client: Client, raw: unknown) {
    const m = this.members.get(client.sessionId);
    if (!m || typeof raw !== "object" || raw === null) return;
    const now = Date.now();
    const next = stepMove({ x: m.x, z: m.z }, raw, now - m.lastMoveAt);
    if (!next) return;
    m.lastMoveAt = now;
    m.x = next.x;
    m.z = next.z;
    m.ry = sanitizeAngle((raw as { ry?: unknown }).ry);
    m.y = sanitizeHeight((raw as { y?: unknown }).y);
    this.dirty = true;
    for (const g of GAME_IDS) {
      if (this.queues.get(g)!.has(m.id) && Math.hypot(m.x - GAMES[g].station.x, m.z - GAMES[g].station.z) > STATION_LEAVE_RADIUS) {
        this.removeFromQueues(m.id);
        client.send(S.Notice, "Você saiu da fila por se afastar da estação.");
      }
    }
  }

  /** Esquiva: teleporte curto validado no servidor; os demais jogadores recebem o evento para animar. */
  private handleDodge(client: Client, raw: unknown) {
    const m = this.members.get(client.sessionId);
    if (!m || typeof raw !== "object" || raw === null) return;
    const now = Date.now();
    const next = validateDodge({ x: m.x, z: m.z }, raw, now, m.lastDodgeAt);
    if (!next) return;
    const payload: DodgePayload = {
      id: m.id, fx: m.x, fz: m.z, tx: next.x, tz: next.z, ry: sanitizeAngle((raw as { ry?: unknown }).ry),
    };
    m.lastDodgeAt = now;
    m.lastMoveAt = now;
    m.x = next.x;
    m.z = next.z;
    m.ry = payload.ry;
    this.dirty = true;
    this.broadcast(S.Dodge, payload, { except: client });
  }

  private handleEmote(client: Client, raw: unknown) {
    const m = this.members.get(client.sessionId);
    const id = typeof raw === "object" && raw ? (raw as { emote?: unknown }).emote : raw;
    if (!m || !isEmote(id)) return;
    const now = Date.now();
    if (now - m.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    m.lastEmoteAt = now;
    const payload: EmotePayload = { id: m.id, emote: id };
    this.broadcast(S.Emote, payload, { except: client });
  }

  private flushPositions() {
    if (!this.dirty) return;
    this.dirty = false;
    const list: PlayerPos[] = Array.from(this.members.values(), (m) => ({ id: m.id, x: m.x, z: m.z, ry: m.ry, y: m.y }));
    this.broadcast(S.Positions, list);
  }

  // ---- membros ----
  private removeMember(sessionId: string) {
    const member = this.members.get(sessionId);
    if (!member) return;
    this.members.delete(sessionId);
    this.removeFromQueues(sessionId);
    if (this.active?.players.delete(sessionId)) this.active.game.removePlayer(sessionId);
    this.dirty = true;
    if (this.hostId === sessionId) this.hostId = this.oldestMemberId();
    this.broadcastPlayers();
    this.notice(`${member.nick} saiu da sala.`);
    if (this.members.size === 0) this.scheduleEmptyDispose();
  }

  private oldestMemberId(): string | null {
    let best: Member | null = null;
    for (const m of this.members.values()) if (!best || m.joinedAt < best.joinedAt) best = m;
    return best?.id ?? null;
  }

  private uniqueNick(base: string): string {
    const taken = new Set(Array.from(this.members.values(), (m) => m.nick.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  private playerList(): PlayerInfo[] {
    return Array.from(this.members.values())
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ id: m.id, nick: m.nick, color: m.color, isHost: m.id === this.hostId, away: m.away, inGame: this.active?.players.has(m.id) ?? false }));
  }

  private broadcastPlayers() {
    this.broadcast(S.Players, this.playerList());
  }

  private notice(text: string) {
    this.broadcast(S.Notice, text);
  }

  // ---- ciclo de vida ----
  private scheduleEmptyDispose() {
    this.cancelEmptyDispose();
    this.emptyTimer = setTimeout(() => {
      if (this.members.size === 0) this.disconnect();
    }, EMPTY_ROOM_TTL_MS);
  }

  private cancelEmptyDispose() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }
}
