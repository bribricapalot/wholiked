import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@whogooned/shared';
import type { GameEngine } from './game/engine.js';
import { GameError } from './game/types.js';
import type { Sessions } from './sessions.js';

interface SocketData {
  roomCode?: string;
  playerId?: string;
  sid?: string | null;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type AnyAck = (res: any) => void;

const normCode = (c: unknown) =>
  String(c ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

/** Per-socket token bucket so a single client can't flood the engine. */
function socketLimiter(rate = 10, burst = 20) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

export function registerSocketHandlers(io: IO, engine: GameEngine, sessions: Sessions) {
  io.on('connection', (raw) => {
    const socket = raw as unknown as S;
    socket.data.sid = sessions.sidFromCookieHeader(socket.handshake.headers.cookie);
    const allow = socketLimiter();

    /** Wrap a handler: rate limit, error → {ok:false}, success → {ok:true, ...result}. */
    const handle =
      <A extends unknown[]>(fn: (...args: A) => Promise<object | void>) =>
      async (...args: any[]): Promise<void> => {
        const maybeAck = args[args.length - 1];
        const ack: AnyAck = typeof maybeAck === 'function' ? (maybeAck as AnyAck) : () => {};
        const params = (typeof maybeAck === 'function' ? args.slice(0, -1) : args) as A;
        if (!allow()) return ack({ ok: false, error: 'Zu viele Anfragen – kurz durchatmen.' });
        try {
          const res = await fn(...params);
          ack({ ok: true, ...(res ?? {}) });
        } catch (err) {
          const msg = err instanceof GameError ? err.message : 'Serverfehler';
          if (!(err instanceof GameError)) console.error('[socket]', err);
          ack({ ok: false, error: msg });
        }
      };

    const inRoom = () => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) throw new GameError('Du bist in keinem Raum.');
      return { code: roomCode, playerId };
    };

    const enter = (code: string, playerId: string) => {
      if (socket.data.roomCode && socket.data.roomCode !== code) socket.leave(socket.data.roomCode);
      socket.data.roomCode = code;
      socket.data.playerId = playerId;
      socket.join(code);
    };

    socket.on(
      'room:create',
      handle(async (p: { name: string }) => {
        const res = await engine.create(p?.name, socket.id);
        enter(res.roomCode, res.playerId);
        return res;
      }),
    );

    socket.on(
      'room:join',
      handle(async (p: { roomCode: string; name: string; playerId?: string; playerToken?: string }) => {
        const code = normCode(p?.roomCode);
        if (code.length < 4) throw new GameError('Ungültiger Raumcode.');
        const res = await engine.join(code, p?.name, socket.id, p?.playerId, p?.playerToken);
        enter(res.roomCode, res.playerId);
        const round = await engine.currentRound(code);
        if (round) setTimeout(() => socket.emit('round:start', round), 50); // after the ack lands
        return res;
      }),
    );

    socket.on(
      'room:leave',
      handle(async () => {
        const { code, playerId } = inRoom();
        socket.data.roomCode = undefined;
        socket.data.playerId = undefined;
        await engine.leave(code, playerId);
      }),
    );

    socket.on('room:settings', handle(async (patch: object) => engine.updateSettings(inRoom().code, inRoom().playerId, patch ?? {})));
    socket.on('room:kick', handle(async (p: { playerId: string }) => engine.kick(inRoom().code, inRoom().playerId, String(p?.playerId))));
    socket.on('player:ready', handle(async (p: { ready: boolean }) => engine.setReady(inRoom().code, inRoom().playerId, Boolean(p?.ready))));
    socket.on(
      'player:submitLinks',
      handle(async (p: { urls: string[]; source?: string }) =>
        engine.submitLinks(inRoom().code, inRoom().playerId, p?.urls ?? [], p?.source === 'export' ? 'export' : 'link'),
      ),
    );
    socket.on(
      'player:removeVideo',
      handle(async (p: { videoId: string }) => engine.removeVideo(inRoom().code, inRoom().playerId, String(p?.videoId))),
    );
    socket.on('player:clearExport', handle(async () => engine.clearExport(inRoom().code, inRoom().playerId)));
    socket.on(
      'player:listVideos',
      handle(async () => ({ videos: await engine.listVideos(inRoom().code, inRoom().playerId) })),
    );
    socket.on('player:linkTikTok', handle(async () => engine.linkTikTok(inRoom().code, inRoom().playerId, socket.data.sid ?? null)));
    socket.on('player:importTikTok', handle(async () => engine.importTikTok(inRoom().code, inRoom().playerId)));
    socket.on('game:start', handle(async () => engine.startGame(inRoom().code, inRoom().playerId)));
    socket.on(
      'vote:submit',
      handle(async (p: { roundIndex: number; targetPlayerId: string }) =>
        engine.submitVote(inRoom().code, inRoom().playerId, Number(p?.roundIndex), String(p?.targetPlayerId)),
      ),
    );
    socket.on('round:next', handle(async () => engine.next(inRoom().code, inRoom().playerId)));
    socket.on(
      'round:skip',
      handle(async (p: { roundIndex: number }) => engine.skipRound(inRoom().code, inRoom().playerId, Number(p?.roundIndex))),
    );
    socket.on('game:restart', handle(async () => engine.restart(inRoom().code, inRoom().playerId)));

    socket.on('disconnect', () => {
      const { roomCode, playerId } = socket.data;
      if (roomCode && playerId) void engine.disconnect(roomCode, playerId, socket.id);
    });
  });
}
