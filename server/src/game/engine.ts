import crypto from 'node:crypto';
import type { Server } from 'socket.io';
import {
  DEFAULT_SETTINGS,
  MAX_EXPORT_LINKS,
  MAX_LINKS_PER_PLAYER,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_TTL_SECONDS,
  SETTINGS_LIMITS,
  type ClientToServerEvents,
  type DeckCard,
  type JoinResult,
  type PublicRoomState,
  type RoomSettings,
  type RoundStartPayload,
  type ServerToClientEvents,
  type SubmitLinksResult,
  type VideoSubmission,
} from '@whogooned/shared';
import { randomId, safeEqual, sha256 } from '../crypto.js';
import type { Sessions } from '../sessions.js';
import { keys, type KV } from '../store/index.js';
import { listVideos, revokeToken } from '../tiktok/api.js';
import { fetchOEmbed, parseTikTokUrl, resolveLink } from '../tiktok/links.js';
import { buildDeck, newCardId, shuffle, toPublicCard, type CandidateVideo, type DeckOwner } from './deck.js';
import { BOT_PROFILES, DEMO_CARDS, DEMO_TIKTOK_URLS } from './demoPool.js';
import { computeAwards, emptyStats, rank, scoreRound, type StoredVote } from './scoring.js';
import { GameError, type PlayerRecord, type RoomRecord } from './types.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const REVEAL_AUTO_ADVANCE_MS = 12_000;
const LEADERBOARD_AUTO_ADVANCE_MS = 10_000;
const EMPTY_ROOM_CLOSE_MS = 3 * 60_000;

interface RoomTimers {
  phase?: NodeJS.Timeout;
  bots: NodeJS.Timeout[];
  close?: NodeJS.Timeout;
}

interface Ctx {
  after(fn: () => unknown): void;
}

const clamp = (n: unknown, { min, max }: { min: number; max: number }, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

export function sanitizeName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 20);
  if (!name) throw new GameError('Bitte gib einen Namen ein.');
  return name;
}

export class GameEngine {
  private chains = new Map<string, Promise<unknown>>();
  private timers = new Map<string, RoomTimers>();
  /** playerKey(code, id) -> connected socket ids */
  private sockets = new Map<string, Set<string>>();

  constructor(
    private kv: KV,
    private io: IO,
    private sessions: Sessions,
  ) {}

  // -------------------------------------------------------------------------
  // Persistence + locking
  // -------------------------------------------------------------------------

  private lock<T>(code: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(code) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.chains.set(code, tail);
    void tail.then(() => {
      if (this.chains.get(code) === tail) this.chains.delete(code);
    });
    return run;
  }

  private async load(code: string): Promise<RoomRecord | null> {
    const raw = await this.kv.get(keys.room(code));
    return raw ? (JSON.parse(raw) as RoomRecord) : null;
  }

  private async save(room: RoomRecord) {
    // Sliding 2h inactivity TTL on everything that belongs to the room.
    await this.kv.set(keys.room(room.code), JSON.stringify(room), ROOM_TTL_SECONDS);
    await Promise.all([
      this.kv.expire(keys.subs(room.code), ROOM_TTL_SECONDS),
      this.kv.expire(keys.deck(room.code), ROOM_TTL_SECONDS),
      this.kv.expire(keys.reserve(room.code), ROOM_TTL_SECONDS),
    ]);
  }

  /**
   * Serialized load → mutate → save → broadcast. Side effects queued via ctx.after
   * run once the lock is released, so they may call back into mutate().
   */
  private async mutate<T>(code: string, fn: (room: RoomRecord, ctx: Ctx) => T | Promise<T>): Promise<T> {
    const afters: (() => unknown)[] = [];
    const result = await this.lock(code, async () => {
      const room = await this.load(code);
      if (!room) throw new GameError('Raum nicht gefunden oder abgelaufen.');
      const r = await fn(room, { after: (f) => afters.push(f) });
      await this.save(room);
      this.broadcast(room);
      return r;
    });
    for (const f of afters) {
      try {
        await f();
      } catch (e) {
        console.warn(`[game ${code}] side effect failed:`, (e as Error).message);
      }
    }
    return result;
  }

  private broadcast(room: RoomRecord) {
    this.io.to(room.code).emit('room:state', this.publicState(room));
  }

  publicState(room: RoomRecord): PublicRoomState {
    const voted = new Set(room.round?.votedIds ?? []);
    return {
      code: room.code,
      phase: room.phase,
      hostId: room.hostId,
      settings: room.settings,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        tiktokHandle: p.tiktokHandle,
        isHost: p.id === room.hostId,
        isBot: p.isBot,
        status: p.status,
        connected: p.connected,
        score: p.score,
        videoCount: p.videoCount,
        hasVoted: room.phase === 'ROUND_ACTIVE' && voted.has(p.id),
      })),
      round: room.round
        ? { index: room.round.index, total: room.round.total, startedAt: room.round.startedAt, endsAt: room.round.endsAt }
        : null,
      serverNow: Date.now(),
    };
  }

  private timersFor(code: string): RoomTimers {
    let t = this.timers.get(code);
    if (!t) this.timers.set(code, (t = { bots: [] }));
    return t;
  }

  private clearRoundTimers(code: string) {
    const t = this.timersFor(code);
    if (t.phase) clearTimeout(t.phase);
    t.bots.forEach(clearTimeout);
    t.phase = undefined;
    t.bots = [];
  }

  private schedulePhase(code: string, ms: number, fn: () => Promise<unknown>) {
    const t = this.timersFor(code);
    if (t.phase) clearTimeout(t.phase);
    t.phase = setTimeout(() => fn().catch((e) => console.warn(`[game ${code}]`, e.message)), ms);
  }

  // -------------------------------------------------------------------------
  // Players & connections
  // -------------------------------------------------------------------------

  private pkey = (code: string, id: string) => `${code}:${id}`;

  attachSocket(code: string, playerId: string, socketId: string) {
    const k = this.pkey(code, playerId);
    if (!this.sockets.has(k)) this.sockets.set(k, new Set());
    this.sockets.get(k)!.add(socketId);
    const t = this.timersFor(code);
    if (t.close) clearTimeout(t.close);
    t.close = undefined;
  }

  private socketsOf(code: string, playerId: string) {
    return [...(this.sockets.get(this.pkey(code, playerId)) ?? [])];
  }

  private sendTo(code: string, playerId: string, fn: (s: ReturnType<IO['to']>) => void) {
    const ids = this.socketsOf(code, playerId);
    if (ids.length) fn(this.io.to(ids));
  }

  private newPlayer(name: string, isBot = false): { player: PlayerRecord; token: string } {
    const token = randomId(24);
    return {
      token,
      player: {
        id: randomId(9),
        tokenHash: sha256(token),
        name,
        avatarUrl: null,
        tiktokHandle: null,
        tiktokOpenId: null,
        sessionId: null,
        isBot,
        status: isBot ? 'READY' : 'CONNECTED',
        connected: true,
        score: 0,
        videoCount: 0,
        joinedAt: Date.now(),
        stats: emptyStats(),
      },
    };
  }

  private uniqueName(room: RoomRecord, name: string, selfId?: string) {
    const taken = new Set(room.players.filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }

  private migrateHostIfNeeded(room: RoomRecord) {
    const host = room.players.find((p) => p.id === room.hostId);
    if (host && host.connected && !host.isBot) return;
    const next = room.players.find((p) => p.connected && !p.isBot);
    if (next) room.hostId = next.id;
  }

  async createRoom(name: string): Promise<{ room: RoomRecord; token: string; playerId: string }> {
    const clean = sanitizeName(name);
    for (let attempt = 0; attempt < 40; attempt++) {
      const len = attempt < 20 ? 4 : attempt < 30 ? 5 : 6;
      const code = Array.from({ length: len }, () => ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)]).join('');
      const { player, token } = this.newPlayer(clean);
      const room: RoomRecord = {
        code,
        phase: 'LOBBY',
        hostId: player.id,
        settings: { ...DEFAULT_SETTINGS },
        players: [player],
        round: null,
        lastDeltas: {},
        gameSeq: 0,
        createdAt: Date.now(),
      };
      if (await this.kv.setNX(keys.room(code), JSON.stringify(room), ROOM_TTL_SECONDS)) {
        return { room, token, playerId: player.id };
      }
    }
    throw new GameError('Konnte keinen freien Raumcode finden.');
  }

  async join(
    code: string,
    rawName: string,
    socketId: string,
    playerId?: string,
    playerToken?: string,
  ): Promise<JoinResult> {
    return this.mutate(code, (room) => {
      // Re-join with credentials
      if (playerId && playerToken) {
        const existing = room.players.find((p) => p.id === playerId && !p.isBot);
        if (existing && safeEqual(existing.tokenHash, sha256(playerToken))) {
          existing.connected = true;
          this.attachSocket(code, existing.id, socketId);
          this.migrateHostIfNeeded(room);
          return { roomCode: code, playerId: existing.id, playerToken, state: this.publicState(room) };
        }
      }
      if (room.players.length >= MAX_PLAYERS) throw new GameError('Der Raum ist voll.');
      const { player, token } = this.newPlayer(this.uniqueName(room, sanitizeName(rawName)));
      if (room.phase !== 'LOBBY') player.status = 'SPECTATING';
      room.players.push(player);
      this.attachSocket(code, player.id, socketId);
      return { roomCode: code, playerId: player.id, playerToken: token, state: this.publicState(room) };
    });
  }

  async create(rawName: string, socketId: string): Promise<JoinResult> {
    const { room, token, playerId } = await this.createRoom(rawName);
    this.attachSocket(room.code, playerId, socketId);
    return { roomCode: room.code, playerId, playerToken: token, state: this.publicState(room) };
  }

  async disconnect(code: string, playerId: string, socketId: string) {
    const k = this.pkey(code, playerId);
    const set = this.sockets.get(k);
    set?.delete(socketId);
    if (set && set.size > 0) return; // still connected in another tab
    this.sockets.delete(k);
    await this.mutate(code, (room, ctx) => {
      const p = room.players.find((x) => x.id === playerId);
      if (!p) return;
      p.connected = false;
      this.migrateHostIfNeeded(room);
      if (!room.players.some((x) => x.connected && !x.isBot)) {
        const t = this.timersFor(code);
        if (t.close) clearTimeout(t.close);
        t.close = setTimeout(() => void this.closeRoom(code, 'Alle Spieler haben den Raum verlassen.'), EMPTY_ROOM_CLOSE_MS);
      }
      if (room.phase === 'ROUND_ACTIVE') ctx.after(() => this.maybeEndRound(code));
    }).catch(() => {});
  }

  async leave(code: string, playerId: string) {
    const sockets = this.socketsOf(code, playerId);
    this.sockets.delete(this.pkey(code, playerId));
    for (const id of sockets) this.io.sockets.sockets.get(id)?.leave(code);
    await this.mutate(code, async (room, ctx) => {
      const p = room.players.find((x) => x.id === playerId);
      if (!p) return;
      if (room.phase === 'LOBBY') {
        room.players = room.players.filter((x) => x.id !== playerId);
        await this.kv.hdel(keys.subs(code), playerId);
        if (p.sessionId) ctx.after(() => this.revokeSession(p.sessionId!));
      } else {
        p.connected = false;
      }
      this.migrateHostIfNeeded(room);
      if (!room.players.some((x) => x.connected && !x.isBot)) ctx.after(() => this.closeRoom(code, 'Raum geschlossen.'));
      else if (room.phase === 'ROUND_ACTIVE') ctx.after(() => this.maybeEndRound(code));
    });
  }

  async kick(code: string, hostId: string, targetId: string) {
    await this.mutate(code, async (room, ctx) => {
      this.assertHost(room, hostId);
      if (targetId === hostId) throw new GameError('Du kannst dich nicht selbst kicken.');
      const p = room.players.find((x) => x.id === targetId);
      if (!p || p.isBot) throw new GameError('Spieler nicht gefunden.');
      room.players = room.players.filter((x) => x.id !== targetId);
      await this.kv.hdel(keys.subs(code), targetId);
      const sockets = this.socketsOf(code, targetId);
      this.sockets.delete(this.pkey(code, targetId));
      ctx.after(() => {
        for (const id of sockets) {
          const s = this.io.sockets.sockets.get(id);
          s?.emit('room:closed', { reason: 'Du wurdest vom Host entfernt.' });
          s?.leave(code);
          if (s) s.data = {};
        }
      });
      if (p.sessionId) ctx.after(() => this.revokeSession(p.sessionId!));
      if (room.phase === 'ROUND_ACTIVE') ctx.after(() => this.maybeEndRound(code));
    });
  }

  private assertHost(room: RoomRecord, playerId: string) {
    if (room.hostId !== playerId) throw new GameError('Nur der Host kann das.');
  }

  private me(room: RoomRecord, playerId: string) {
    const p = room.players.find((x) => x.id === playerId);
    if (!p) throw new GameError('Du bist nicht in diesem Raum.');
    return p;
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  async updateSettings(code: string, playerId: string, patch: Partial<RoomSettings>) {
    await this.mutate(code, (room) => {
      this.assertHost(room, playerId);
      if (room.phase !== 'LOBBY') throw new GameError('Einstellungen nur in der Lobby änderbar.');
      const s = room.settings;
      const L = SETTINGS_LIMITS;
      room.settings = {
        roundSeconds: patch.roundSeconds !== undefined ? clamp(patch.roundSeconds, L.roundSeconds, s.roundSeconds) : s.roundSeconds,
        videosPerPlayer:
          patch.videosPerPlayer !== undefined ? clamp(patch.videosPerPlayer, L.videosPerPlayer, s.videosPerPlayer) : s.videosPerPlayer,
        allowSelfVote: patch.allowSelfVote !== undefined ? Boolean(patch.allowSelfVote) : s.allowSelfVote,
        botCount: patch.botCount !== undefined ? clamp(patch.botCount, L.botCount, s.botCount) : s.botCount,
      };
      this.syncBots(room);
    });
  }

  private syncBots(room: RoomRecord) {
    const bots = room.players.filter((p) => p.isBot);
    const want = Math.min(room.settings.botCount, MAX_PLAYERS - (room.players.length - bots.length));
    if (bots.length > want) {
      const drop = new Set(bots.slice(want).map((b) => b.id));
      room.players = room.players.filter((p) => !drop.has(p.id));
    }
    for (let i = bots.length; i < want; i++) {
      const prof = BOT_PROFILES[i % BOT_PROFILES.length];
      const { player } = this.newPlayer(`${prof.emoji} ${prof.name}`, true);
      room.players.push(player);
    }
    for (const b of room.players.filter((p) => p.isBot)) b.videoCount = room.settings.videosPerPlayer;
  }

  async setReady(code: string, playerId: string, ready: boolean) {
    await this.mutate(code, (room) => {
      if (room.phase !== 'LOBBY') return;
      const p = this.me(room, playerId);
      if (p.status === 'FETCHING_LIKES') return;
      p.status = ready ? 'READY' : 'CONNECTED';
    });
  }

  private async readSubs(code: string, playerId: string): Promise<VideoSubmission[]> {
    const raw = await this.kv.hget(keys.subs(code), playerId);
    return raw ? (JSON.parse(raw) as VideoSubmission[]) : [];
  }

  private async writeSubs(room: RoomRecord, player: PlayerRecord, subs: VideoSubmission[]) {
    await this.kv.hset(keys.subs(room.code), player.id, JSON.stringify(subs), ROOM_TTL_SECONDS);
    player.videoCount = subs.length;
  }

  async listVideos(code: string, playerId: string) {
    return this.readSubs(code, playerId);
  }

  async submitLinks(code: string, playerId: string, urls: string[], source: 'link' | 'export' = 'link'): Promise<SubmitLinksResult> {
    const isExport = source === 'export';
    const max = isExport ? MAX_EXPORT_LINKS : MAX_LINKS_PER_PLAYER;
    const input = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u).trim()).filter(Boolean))].slice(0, max);
    // Export links are already full URLs; pasted ones may be short links that need a network
    // round trip — done outside the room lock.
    const resolved = isExport
      ? input.map((url) => ({ url, parsed: parseTikTokUrl(url) }))
      : await Promise.all(
          input.map(async (url) => {
            try {
              return { url, parsed: await resolveLink(url) };
            } catch {
              return { url, parsed: null };
            }
          }),
        );
    return this.mutate(code, async (room) => {
      if (room.phase !== 'LOBBY') throw new GameError('Videos können nur in der Lobby hinzugefügt werden.');
      const p = this.me(room, playerId);
      // A new export replaces the previous one; pasted links stay.
      const subs = (await this.readSubs(code, playerId)).filter((s) => !isExport || s.source !== 'export');
      const have = new Set(subs.map((s) => s.videoId));
      let sameSource = subs.filter((s) => (s.source === 'export') === isExport).length;
      const accepted: VideoSubmission[] = [];
      const rejected: { url: string; reason: string }[] = [];
      for (const { url, parsed } of resolved) {
        if (!parsed) rejected.push({ url, reason: 'Kein gültiger TikTok-Videolink' });
        else if (have.has(parsed.videoId)) rejected.push({ url, reason: 'Schon hinzugefügt' });
        else if (sameSource >= max) rejected.push({ url, reason: `Maximal ${max} Videos` });
        else {
          have.add(parsed.videoId);
          sameSource++;
          accepted.push({ videoId: parsed.videoId, url: parsed.url, source, addedAt: Date.now() });
        }
      }
      const all = [...subs, ...accepted];
      await this.writeSubs(room, p, all);
      return { accepted, rejected: isExport ? rejected.slice(0, 20) : rejected, total: all.length };
    });
  }

  async clearExport(code: string, playerId: string) {
    return this.mutate(code, async (room) => {
      if (room.phase !== 'LOBBY') throw new GameError('Nur in der Lobby möglich.');
      const p = this.me(room, playerId);
      const subs = (await this.readSubs(code, playerId)).filter((s) => s.source !== 'export');
      await this.writeSubs(room, p, subs);
      return { total: subs.length };
    });
  }

  async removeVideo(code: string, playerId: string, videoId: string) {
    return this.mutate(code, async (room) => {
      if (room.phase !== 'LOBBY') throw new GameError('Nur in der Lobby möglich.');
      const p = this.me(room, playerId);
      const subs = (await this.readSubs(code, playerId)).filter((s) => s.videoId !== videoId);
      await this.writeSubs(room, p, subs);
      return { total: subs.length };
    });
  }

  async linkTikTok(code: string, playerId: string, sid: string | null) {
    if (!sid) throw new GameError('Keine TikTok-Sitzung gefunden.');
    const session = await this.sessions.get(sid);
    const tt = session?.tiktok;
    if (!tt) throw new GameError('Keine TikTok-Sitzung gefunden.');
    return this.mutate(code, (room) => {
      const p = this.me(room, playerId);
      const other = room.players.find((x) => x.id !== playerId && x.tiktokOpenId === tt.openId);
      if (other) throw new GameError(`Dieser TikTok-Account ist schon mit ${other.name} verknüpft.`);
      p.tiktokOpenId = tt.openId;
      p.tiktokHandle = tt.displayName;
      p.avatarUrl = tt.avatarUrl;
      p.name = this.uniqueName(room, tt.displayName.slice(0, 20) || p.name, p.id);
      p.sessionId = sid;
      return { name: p.name, avatarUrl: p.avatarUrl };
    });
  }

  /** Pull the player's own posts via TikTok `video.list` into their submissions. */
  async importTikTok(code: string, playerId: string) {
    const room = await this.load(code);
    const p = room?.players.find((x) => x.id === playerId);
    if (!room || !p) throw new GameError('Raum nicht gefunden.');
    if (room.phase !== 'LOBBY') throw new GameError('Nur in der Lobby möglich.');
    if (!p.sessionId) throw new GameError('Verbinde zuerst deinen TikTok-Account.');
    const token = (await this.sessions.get(p.sessionId))?.tiktok?.tokens?.accessToken;
    if (!token) throw new GameError('TikTok-Sitzung abgelaufen – bitte neu verbinden.');

    const prevStatus = p.status;
    await this.mutate(code, (r) => void (this.me(r, playerId).status = 'FETCHING_LIKES'));
    let videos: Awaited<ReturnType<typeof listVideos>> = [];
    try {
      videos = await listVideos(token);
    } finally {
      await this.mutate(code, (r) => {
        const me = this.me(r, playerId);
        if (me.status === 'FETCHING_LIKES') me.status = prevStatus === 'FETCHING_LIKES' ? 'CONNECTED' : prevStatus;
      });
    }
    return this.mutate(code, async (r) => {
      const me = this.me(r, playerId);
      const subs = await this.readSubs(code, playerId);
      const have = new Set(subs.map((s) => s.videoId));
      let imported = 0;
      for (const v of videos) {
        if (have.has(v.id) || subs.length >= MAX_LINKS_PER_PLAYER) continue;
        const url = v.shareUrl && parseTikTokUrl(v.shareUrl) ? parseTikTokUrl(v.shareUrl)!.url : `https://www.tiktok.com/video/${v.id}`;
        subs.push({ videoId: v.id, url, source: 'tiktok_api', addedAt: Date.now() });
        have.add(v.id);
        imported++;
      }
      await this.writeSubs(r, me, subs);
      return { imported, total: subs.length };
    });
  }

  // -------------------------------------------------------------------------
  // Game start: aggregate + sanitize the deck
  // -------------------------------------------------------------------------

  async startGame(code: string, playerId: string) {
    const seq = await this.mutate(code, (room) => {
      this.assertHost(room, playerId);
      if (room.phase !== 'LOBBY') throw new GameError('Das Spiel läuft schon.');
      const humans = room.players.filter((p) => !p.isBot && p.connected);
      const notReady = humans.filter((p) => p.id !== room.hostId && p.status !== 'READY');
      if (notReady.length) throw new GameError(`Noch nicht bereit: ${notReady.map((p) => p.name).join(', ')}`);
      if (room.players.filter((p) => p.connected).length < 2) throw new GameError('Ihr braucht mindestens 2 Spieler (oder Bots).');
      room.phase = 'COLLECTING';
      room.gameSeq++;
      for (const p of humans) p.status = 'FETCHING_LIKES';
      return room.gameSeq;
    });
    // Collection runs outside the lock — it does network I/O.
    void this.collect(code, seq).catch(async (err) => {
      console.warn(`[game ${code}] collect failed`, err);
      await this.mutate(code, (room) => {
        if (room.gameSeq !== seq) return;
        room.phase = 'LOBBY';
        for (const p of room.players) if (!p.isBot) p.status = 'CONNECTED';
      }).catch(() => {});
    });
  }

  private async validatePlayerVideos(code: string, player: PlayerRecord, need: number): Promise<CandidateVideo[]> {
    let subs = await this.readSubs(code, player.id);

    // Linked TikTok account without imported posts yet → fetch them now.
    if (player.sessionId && !subs.some((s) => s.source === 'tiktok_api')) {
      const token = (await this.sessions.get(player.sessionId))?.tiktok?.tokens?.accessToken;
      if (token) {
        try {
          const vids = await listVideos(token, 20);
          const have = new Set(subs.map((s) => s.videoId));
          for (const v of vids) {
            if (have.has(v.id)) continue;
            subs.push({ videoId: v.id, url: `https://www.tiktok.com/video/${v.id}`, source: 'tiktok_api', addedAt: Date.now() });
          }
        } catch (e) {
          console.warn(`[game ${code}] TikTok import failed for ${player.id}:`, (e as Error).message);
        }
      }
    }

    // Validate in random order until we have enough — keeps oEmbed traffic low.
    const valid: CandidateVideo[] = [];
    for (const s of shuffle(subs)) {
      if (valid.length >= need) break;
      const info = await fetchOEmbed(this.kv, { videoId: s.videoId, url: s.url });
      if (!info.available) continue;
      valid.push({
        videoId: s.videoId,
        kind: 'tiktok',
        url: s.url,
        title: info.title,
        authorName: info.authorName,
        thumbnailUrl: info.thumbnailUrl,
        demo: null,
      });
    }
    return valid;
  }

  private async demoVideos(count: number, exclude: Set<string>): Promise<CandidateVideo[]> {
    const out: CandidateVideo[] = [];
    for (const url of shuffle(DEMO_TIKTOK_URLS)) {
      if (out.length >= count) return out;
      const parsed = parseTikTokUrl(url);
      if (!parsed || exclude.has(parsed.videoId)) continue;
      const info = await fetchOEmbed(this.kv, parsed);
      if (!info.available) continue;
      exclude.add(parsed.videoId);
      out.push({ videoId: parsed.videoId, kind: 'tiktok', url: parsed.url, title: info.title, authorName: info.authorName, thumbnailUrl: info.thumbnailUrl, demo: null });
    }
    for (const [i, demo] of shuffle(DEMO_CARDS.map((d, i) => [i, d] as const))) {
      if (out.length >= count) break;
      const id = `demo-${i}`;
      if (exclude.has(id)) continue;
      exclude.add(id);
      out.push({ videoId: id, kind: 'demo', url: null, title: demo.caption, authorName: null, thumbnailUrl: null, demo });
    }
    return out;
  }

  private async collect(code: string, seq: number) {
    const room = await this.load(code);
    if (!room || room.gameSeq !== seq) return;
    const need = room.settings.videosPerPlayer;
    const validByPlayer = new Map<string, CandidateVideo[]>();

    const humans = room.players.filter((p) => !p.isBot);
    await Promise.all(
      humans.map(async (p) => {
        let valid: CandidateVideo[] = [];
        try {
          // Validate twice as many as needed: the extras replace videos whose embed fails mid-game.
          valid = await this.validatePlayerVideos(code, p, need * 2);
        } finally {
          validByPlayer.set(p.id, valid);
          await this.mutate(code, (r) => {
            const me = r.players.find((x) => x.id === p.id);
            if (me && r.gameSeq === seq && me.status === 'FETCHING_LIKES') me.status = 'READY';
          }).catch(() => {});
          if (valid.length === 0) {
            this.sendTo(code, p.id, (s) =>
              s.emit('player:notice', {
                type: 'NO_VIDEOS',
                message:
                  'Von dir kamen keine gültigen Videos (privat, gelöscht oder keine Links). Du rätst diese Runde nur mit – füge beim nächsten Mal Links hinzu.',
              }),
            );
          }
        }
      }),
    );

    const used = new Set([...validByPlayer.values()].flat().map((v) => v.videoId));
    for (const b of room.players.filter((p) => p.isBot)) validByPlayer.set(b.id, await this.demoVideos(need, used));

    const owners = new Map<string, DeckOwner>(room.players.map((p) => [p.id, { id: p.id, handle: p.tiktokHandle ?? p.name, avatar: p.avatarUrl }]));
    const { deck, reserve } = buildDeck(validByPlayer, need, owners);

    await this.mutate(code, async (r, ctx) => {
      if (r.gameSeq !== seq || r.phase !== 'COLLECTING') return;
      if (deck.length === 0) {
        r.phase = 'LOBBY';
        for (const p of r.players) if (!p.isBot) p.status = 'CONNECTED';
        ctx.after(() =>
          this.io.to(code).emit('player:notice', {
            type: 'NO_VIDEOS',
            message: 'Keine spielbaren Videos gefunden. Fügt TikTok-Links hinzu oder aktiviert Bots in den Einstellungen.',
          }),
        );
        return;
      }
      await this.kv.set(keys.deck(code), JSON.stringify(deck), ROOM_TTL_SECONDS);
      await this.kv.set(keys.reserve(code), JSON.stringify(reserve), ROOM_TTL_SECONDS);
      for (const p of r.players) {
        p.score = 0;
        p.stats = emptyStats();
      }
      r.lastDeltas = {};
      this.beginRound(r, deck, 0, ctx);
    });
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------

  private async readReserve(code: string): Promise<DeckCard[]> {
    const raw = await this.kv.get(keys.reserve(code));
    return raw ? (JSON.parse(raw) as DeckCard[]) : [];
  }

  private async readDeck(code: string): Promise<DeckCard[]> {
    const raw = await this.kv.get(keys.deck(code));
    return raw ? (JSON.parse(raw) as DeckCard[]) : [];
  }

  /** Must be called inside mutate(). */
  private beginRound(room: RoomRecord, deck: DeckCard[], index: number, ctx: Ctx) {
    const card = deck[index];
    const now = Date.now();
    const ownerIds = card.ownerPlayerIds.filter((id) => room.players.some((p) => p.id === id));
    const owners = new Set(ownerIds);
    const eligible = room.players.filter((p) => p.connected && !owners.has(p.id)).map((p) => p.id);
    room.phase = 'ROUND_ACTIVE';
    room.round = {
      index,
      total: deck.length,
      startedAt: now,
      endsAt: now + room.settings.roundSeconds * 1000,
      ownerIds,
      eligibleVoterIds: eligible,
      candidateIds: room.players.map((p) => p.id),
      votedIds: [],
    };
    for (const p of room.players) {
      if (p.isBot) p.status = owners.has(p.id) ? 'SPECTATING' : 'GUESSING';
      else p.status = owners.has(p.id) || !p.connected ? 'SPECTATING' : 'GUESSING';
    }

    const round = room.round;
    const code = room.code;
    const seq = room.gameSeq;
    ctx.after(async () => {
      await this.kv.del(keys.votes(code, index));
      this.io.to(code).emit('round:start', {
        roundIndex: index,
        totalRounds: round.total,
        card: toPublicCard(card),
        startedAt: round.startedAt,
        endsAt: round.endsAt,
        serverNow: Date.now(),
        eligibleVoterIds: round.eligibleVoterIds,
        candidateIds: round.candidateIds,
      });
      this.clearRoundTimers(code);
      this.schedulePhase(code, round.endsAt - Date.now() + 300, () => this.endRound(code, seq, index));
      this.scheduleBotVotes(room, card);
    });
  }

  private scheduleBotVotes(room: RoomRecord, card: DeckCard) {
    const round = room.round!;
    const t = this.timersFor(room.code);
    const owners = new Set(card.ownerPlayerIds);
    for (const bot of room.players.filter((p) => p.isBot && round.eligibleVoterIds.includes(p.id))) {
      const options = round.candidateIds.filter((id) => id !== bot.id || room.settings.allowSelfVote);
      const ownerOptions = options.filter((id) => owners.has(id));
      // Bots are right ~40% of the time.
      const pick =
        ownerOptions.length && Math.random() < 0.4 ? ownerOptions[crypto.randomInt(ownerOptions.length)] : options[crypto.randomInt(options.length)];
      // Give the host's client time to find out a TikTok embed is broken (and swap it) before
      // bots can end the round by voting.
      const min = card.kind === 'tiktok' ? 8_000 : 2_000;
      const delay = min + Math.random() * Math.max(0, room.settings.roundSeconds * 1000 * 0.85 - min);
      t.bots.push(setTimeout(() => void this.submitVote(room.code, bot.id, round.index, pick).catch(() => {}), delay));
    }
  }

  /** Re-sync a (re)joining client into the running round. */
  async currentRound(code: string): Promise<RoundStartPayload | null> {
    const room = await this.load(code);
    const round = room?.round;
    if (!room || !round || room.phase !== 'ROUND_ACTIVE') return null;
    const card = (await this.readDeck(code))[round.index];
    if (!card) return null;
    return {
      roundIndex: round.index,
      totalRounds: round.total,
      card: toPublicCard(card),
      startedAt: round.startedAt,
      endsAt: round.endsAt,
      serverNow: Date.now(),
      eligibleVoterIds: round.eligibleVoterIds,
      candidateIds: round.candidateIds,
    };
  }

  async submitVote(code: string, playerId: string, roundIndex: number, targetId: string) {
    await this.mutate(code, async (room, ctx) => {
      const round = room.round;
      if (room.phase !== 'ROUND_ACTIVE' || !round || round.index !== roundIndex) throw new GameError('Diese Runde ist schon vorbei.');
      if (!round.eligibleVoterIds.includes(playerId)) throw new GameError('Du kannst in dieser Runde nicht abstimmen.');
      if (!round.candidateIds.includes(targetId)) throw new GameError('Ungültige Auswahl.');
      if (targetId === playerId && !room.settings.allowSelfVote) throw new GameError('Du kannst nicht für dich selbst stimmen.');
      const now = Date.now();
      if (now > round.endsAt + 500) throw new GameError('Zu spät!');
      const vote: StoredVote = { targetId, at: Math.min(now, round.endsAt) };
      const fresh = await this.kv.hsetNX(keys.votes(code, roundIndex), playerId, JSON.stringify(vote), ROOM_TTL_SECONDS);
      if (!fresh) throw new GameError('Du hast schon abgestimmt.');
      round.votedIds.push(playerId);
      const me = room.players.find((p) => p.id === playerId);
      if (me && !me.isBot) me.status = 'SPECTATING';
      ctx.after(() => {
        this.io.to(code).emit('round:voteProgress', {
          roundIndex,
          voted: round.votedIds.length,
          eligible: round.eligibleVoterIds.length,
        });
      });
      ctx.after(() => this.maybeEndRound(code));
    });
  }

  private async maybeEndRound(code: string) {
    const room = await this.load(code);
    const round = room?.round;
    if (!room || !round || room.phase !== 'ROUND_ACTIVE') return;
    const connected = new Set(room.players.filter((p) => p.connected).map((p) => p.id));
    const voted = new Set(round.votedIds);
    const waiting = round.eligibleVoterIds.filter((id) => connected.has(id) && !voted.has(id));
    if (waiting.length === 0) await this.endRound(code, room.gameSeq, round.index);
  }

  private async endRound(code: string, seq: number, index: number) {
    await this.mutate(code, async (room, ctx) => {
      const round = room.round;
      if (room.gameSeq !== seq || room.phase !== 'ROUND_ACTIVE' || !round || round.index !== index) return;
      this.clearRoundTimers(code);
      const deck = await this.readDeck(code);
      const card = deck[index];
      const votesRaw = await this.kv.hgetall(keys.votes(code, index));
      const votes = Object.fromEntries(Object.entries(votesRaw).map(([k, v]) => [k, JSON.parse(v) as StoredVote]));
      const result = scoreRound({
        ownerIds: round.ownerIds,
        eligibleVoterIds: round.eligibleVoterIds,
        votes,
        startedAt: round.startedAt,
        endsAt: round.endsAt,
      });

      for (const p of room.players) {
        p.score += result.deltas[p.id] ?? 0;
        p.status = 'CONNECTED';
      }
      for (const v of result.votes) {
        const p = room.players.find((x) => x.id === v.voterId);
        if (!p || !v.targetId) continue;
        p.stats.guesses++;
        if (v.correct) {
          p.stats.correct++;
          p.stats.correctMsTotal += v.elapsedMs ?? 0;
        }
      }
      for (const b of result.ownerBonuses) {
        const p = room.players.find((x) => x.id === b.playerId);
        if (p) {
          p.stats.fooled += b.fooled;
          p.stats.ownedRounds++;
        }
      }
      room.lastDeltas = result.deltas;
      room.phase = 'ROUND_REVEAL';

      ctx.after(async () => {
        await this.kv.del(keys.votes(code, index));
        this.io.to(code).emit('round:result', {
          roundIndex: index,
          totalRounds: round.total,
          card,
          ownerIds: round.ownerIds,
          votes: result.votes,
          ownerBonuses: result.ownerBonuses,
          deltas: result.deltas,
          scores: Object.fromEntries(room.players.map((p) => [p.id, p.score])),
        });
        this.schedulePhase(code, REVEAL_AUTO_ADVANCE_MS, () => this.advance(code, seq, 'ROUND_REVEAL', index));
      });
    });
  }

  /**
   * Host skips an unplayable video (deleted/private — common for old likes). The card is
   * swapped for a reserve video (same owner if possible) and the round restarts; only
   * when the reserve is empty is the round dropped and the next card started.
   */
  async skipRound(code: string, playerId: string, roundIndex: number) {
    await this.mutate(code, async (room, ctx) => {
      this.assertHost(room, playerId);
      const round = room.round;
      if (room.phase !== 'ROUND_ACTIVE' || !round || round.index !== roundIndex) return;
      this.clearRoundTimers(code);
      ctx.after(() => this.kv.del(keys.votes(code, roundIndex)));
      room.lastDeltas = {};
      const deck = await this.readDeck(code);
      const reserve = await this.readReserve(code);
      if (reserve.length > 0) {
        const sameOwner = reserve.findIndex((c) => c.ownerPlayerId === deck[roundIndex]?.ownerPlayerId);
        const [replacement] = reserve.splice(Math.max(0, sameOwner), 1);
        deck[roundIndex] = { ...replacement, cardId: newCardId() };
        await this.kv.set(keys.deck(code), JSON.stringify(deck), ROOM_TTL_SECONDS);
        await this.kv.set(keys.reserve(code), JSON.stringify(reserve), ROOM_TTL_SECONDS);
        return this.beginRound(room, deck, roundIndex, ctx);
      }
      ctx.after(() => this.io.to(code).emit('player:notice', { type: 'INFO', message: 'Video nicht verfügbar – übersprungen ⏭️' }));
      if (roundIndex + 1 >= deck.length) return this.finish(room, ctx);
      this.beginRound(room, deck, roundIndex + 1, ctx);
    });
  }

  /** Host "Weiter" button (or auto-advance timer). */
  async next(code: string, playerId: string) {
    const room = await this.load(code);
    if (!room) throw new GameError('Raum nicht gefunden.');
    this.assertHost(room, playerId);
    if (room.phase !== 'ROUND_REVEAL' && room.phase !== 'LEADERBOARD') throw new GameError('Gerade nicht möglich.');
    await this.advance(code, room.gameSeq, room.phase, room.round?.index ?? 0);
  }

  private async advance(code: string, seq: number, from: 'ROUND_REVEAL' | 'LEADERBOARD', index: number) {
    await this.mutate(code, async (room, ctx) => {
      if (room.gameSeq !== seq || room.phase !== from || room.round?.index !== index) return;
      const total = room.round.total;
      const isLast = index + 1 >= total;

      if (from === 'ROUND_REVEAL') {
        if (isLast) return this.finish(room, ctx);
        room.phase = 'LEADERBOARD';
        const entries = rank(room.players, room.lastDeltas);
        ctx.after(() => {
          this.io.to(code).emit('leaderboard:update', { roundIndex: index, totalRounds: total, entries, isFinal: false });
          this.schedulePhase(code, LEADERBOARD_AUTO_ADVANCE_MS, () => this.advance(code, seq, 'LEADERBOARD', index));
        });
        return;
      }
      const deck = await this.readDeck(code);
      if (index + 1 >= deck.length) return this.finish(room, ctx);
      this.beginRound(room, deck, index + 1, ctx);
    });
  }

  private finish(room: RoomRecord, ctx: Ctx) {
    room.phase = 'GAME_OVER';
    for (const p of room.players) p.status = 'CONNECTED';
    const code = room.code;
    const entries = rank(room.players, room.lastDeltas);
    const awards = computeAwards(room.players.filter((p) => p.connected || p.score > 0));
    const sessionIds = room.players.map((p) => p.sessionId).filter((s): s is string => Boolean(s));
    ctx.after(async () => {
      this.clearRoundTimers(code);
      this.io.to(code).emit('leaderboard:update', { roundIndex: room.round!.index, totalRounds: room.round!.total, entries, isFinal: true });
      this.io.to(code).emit('game:over', { podium: entries.slice(0, 3), entries, awards });
      // Zero persistence: the deck (all video URLs) goes away and TikTok tokens are revoked.
      await this.kv.del(keys.deck(code), keys.reserve(code));
      for (const sid of sessionIds) await this.revokeSession(sid, true);
    });
  }

  async restart(code: string, playerId: string) {
    await this.mutate(code, (room) => {
      this.assertHost(room, playerId);
      if (room.phase !== 'GAME_OVER') throw new GameError('Das Spiel läuft noch.');
      this.clearRoundTimers(code);
      room.phase = 'LOBBY';
      room.round = null;
      room.lastDeltas = {};
      room.gameSeq++;
      for (const p of room.players) {
        p.score = 0;
        p.stats = emptyStats();
        p.status = p.isBot ? 'READY' : 'CONNECTED';
      }
    });
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /** Revoke at TikTok and drop tokens from the session (profile stays for display). */
  private async revokeSession(sid: string, notify = false) {
    const s = await this.sessions.get(sid);
    const tokens = s?.tiktok?.tokens;
    if (!s?.tiktok || !tokens) return;
    await revokeToken(tokens.accessToken).catch((e) => console.warn('[tiktok] revoke failed:', e.message));
    await this.sessions.save(sid, { ...s, tiktok: { ...s.tiktok, tokens: null } });
    if (notify) {
      for (const sock of this.io.sockets.sockets.values()) {
        if (sock.data?.sid === sid) {
          sock.emit('player:notice', { type: 'TIKTOK_REVOKED', message: 'Spiel vorbei – dein TikTok-Zugriff wurde automatisch widerrufen.' });
        }
      }
    }
  }

  async closeRoom(code: string, reason: string) {
    await this.lock(code, async () => {
      const room = await this.load(code);
      this.clearRoundTimers(code);
      const t = this.timers.get(code);
      if (t?.close) clearTimeout(t.close);
      this.timers.delete(code);
      if (!room) return;
      const total = room.round?.total ?? 0;
      await this.kv.del(
        keys.room(code),
        keys.subs(code),
        keys.deck(code),
        keys.reserve(code),
        ...Array.from({ length: total }, (_, i) => keys.votes(code, i)),
      );
      for (const p of room.players) {
        if (p.sessionId) await this.revokeSession(p.sessionId);
        this.sockets.delete(this.pkey(code, p.id));
      }
      this.io.to(code).emit('room:closed', { reason });
      this.io.in(code).socketsLeave(code);
      console.log(`[game ${code}] closed: ${reason}`);
    });
  }
}
