import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  GameOverPayload,
  JoinResult,
  LeaderboardPayload,
  PublicPlayer,
  PublicRoomState,
  RoundResultPayload,
  RoundStartPayload,
  VoteProgressPayload,
} from '@whogooned/shared';
import { call, socket } from '../lib/socket';
import { storage } from '../lib/storage';

export interface Toast {
  id: number;
  tone: 'info' | 'error' | 'success';
  message: string;
}

interface GameState {
  connected: boolean;
  room: PublicRoomState | null;
  playerId: string | null;
  round: RoundStartPayload | null;
  myVote: string | null;
  voteProgress: VoteProgressPayload | null;
  result: RoundResultPayload | null;
  leaderboard: LeaderboardPayload | null;
  gameOver: GameOverPayload | null;
  clockOffset: number;
  tiktokEnabled: boolean;
  rejoining: boolean;
  toasts: Toast[];
}

interface GameApi extends GameState {
  me: PublicPlayer | null;
  isHost: boolean;
  playerById: (id: string) => PublicPlayer | undefined;
  serverNow: () => number;
  createRoom: (name: string) => Promise<void>;
  joinRoom: (code: string, name: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  vote: (targetId: string) => Promise<void>;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<GameApi | null>(null);

const roomPath = (code: string) => `/room/${code}`;

export function GameProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<GameState>({
    connected: socket.connected,
    room: null,
    playerId: null,
    round: null,
    myVote: null,
    voteProgress: null,
    result: null,
    leaderboard: null,
    gameOver: null,
    clockOffset: 0,
    tiktokEnabled: false,
    rejoining: Boolean(storage.getCreds()),
    toasts: [],
  });
  const patch = useCallback((p: Partial<GameState> | ((prev: GameState) => Partial<GameState>)) => {
    setS((prev) => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) }));
  }, []);

  const toastSeq = useRef(0);
  const toast = useCallback(
    (message: string, tone: Toast['tone'] = 'info') => {
      const id = ++toastSeq.current;
      patch((prev) => ({ toasts: [...prev.toasts, { id, tone, message }].slice(-4) }));
      setTimeout(() => patch((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 4500);
    },
    [patch],
  );
  const dismissToast = useCallback((id: number) => patch((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })), [patch]);

  const onJoined = useCallback(
    (res: JoinResult) => {
      storage.setCreds({ roomCode: res.roomCode, playerId: res.playerId, playerToken: res.playerToken });
      if (location.pathname !== roomPath(res.roomCode)) history.replaceState(null, '', roomPath(res.roomCode) + location.search);
      patch({ room: res.state, playerId: res.playerId, clockOffset: res.state.serverNow - Date.now(), rejoining: false });

      // Back from TikTok OAuth?
      const q = new URLSearchParams(location.search);
      const tt = q.get('tiktok');
      if (tt) {
        history.replaceState(null, '', roomPath(res.roomCode));
        if (tt === 'linked') {
          call<{ name: string }>('player:linkTikTok')
            .then((r) => toast(`TikTok verbunden als ${r.name}`, 'success'))
            .catch((e) => toast(e.message, 'error'));
        } else toast(`TikTok-Login fehlgeschlagen (${q.get('reason') ?? 'unbekannt'})`, 'error');
      }
    },
    [patch, toast],
  );

  // Socket wiring
  useEffect(() => {
    const rejoin = () => {
      const creds = storage.getCreds();
      const pathCode = location.pathname.match(/^\/room\/([A-Z0-9]{4,6})/i)?.[1]?.toUpperCase();
      if (!creds || (pathCode && pathCode !== creds.roomCode)) return patch({ rejoining: false });
      patch({ rejoining: true });
      call<JoinResult>('room:join', { name: storage.getName() || 'Spieler', ...creds })
        .then(onJoined)
        .catch(() => {
          storage.clearCreds();
          patch({ rejoining: false, room: null, playerId: null });
        });
    };
    const onConnect = () => {
      patch({ connected: true });
      rejoin();
    };
    const onDisconnect = () => patch({ connected: false });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', (room) => patch({ room, clockOffset: room.serverNow - Date.now() }));
    socket.on('room:closed', ({ reason }) => {
      storage.clearCreds();
      history.replaceState(null, '', '/');
      patch({ room: null, playerId: null, round: null, result: null, leaderboard: null, gameOver: null });
      toast(reason, 'info');
    });
    socket.on('round:start', (round) =>
      patch({ round, myVote: null, result: null, voteProgress: null, clockOffset: round.serverNow - Date.now() }),
    );
    socket.on('round:voteProgress', (voteProgress) => patch({ voteProgress }));
    socket.on('round:result', (result) => patch({ result }));
    socket.on('leaderboard:update', (leaderboard) => patch({ leaderboard }));
    socket.on('game:over', (gameOver) => patch({ gameOver }));
    socket.on('player:notice', (n) => toast(n.message, n.type === 'NO_VIDEOS' ? 'error' : 'info'));

    if (socket.connected) onConnect();
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => patch({ tiktokEnabled: Boolean(c.tiktokEnabled) }))
      .catch(() => {});

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const ev of ['room:state', 'room:closed', 'round:start', 'round:voteProgress', 'round:result', 'leaderboard:update', 'game:over', 'player:notice'] as const) {
        socket.off(ev);
      }
    };
  }, [onJoined, patch, toast]);

  // Reset per-game state when a new game begins.
  useEffect(() => {
    if (s.room?.phase === 'LOBBY' && (s.gameOver || s.round)) patch({ gameOver: null, round: null, result: null, leaderboard: null });
  }, [s.room?.phase, s.gameOver, s.round, patch]);

  const api = useMemo<GameApi>(() => {
    const playerById = (id: string) => s.room?.players.find((p) => p.id === id);
    const me = s.playerId ? (playerById(s.playerId) ?? null) : null;
    return {
      ...s,
      me,
      isHost: Boolean(me && s.room?.hostId === me.id),
      playerById,
      serverNow: () => Date.now() + s.clockOffset,
      createRoom: async (name) => {
        storage.setName(name);
        onJoined(await call<JoinResult>('room:create', { name }));
      },
      joinRoom: async (code, name) => {
        storage.setName(name);
        onJoined(await call<JoinResult>('room:join', { roomCode: code, name }));
      },
      leaveRoom: async () => {
        await call('room:leave').catch(() => {});
        storage.clearCreds();
        history.replaceState(null, '', '/');
        patch({ room: null, playerId: null, round: null, result: null, leaderboard: null, gameOver: null });
      },
      vote: async (targetId) => {
        if (!s.round) return;
        patch({ myVote: targetId });
        try {
          await call('vote:submit', { roundIndex: s.round.roundIndex, targetPlayerId: targetId });
        } catch (e) {
          patch({ myVote: null });
          toast((e as Error).message, 'error');
        }
      },
      toast,
      dismissToast,
    };
  }, [s, onJoined, patch, toast, dismissToast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGame() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame outside GameProvider');
  return v;
}

/** Remaining ms until a server timestamp, ticking ~10x/s. */
export function useCountdown(endsAt: number | null | undefined) {
  const { serverNow } = useGame();
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(t);
  }, [endsAt, serverNow]);
  return endsAt ? Math.max(0, endsAt - now) : 0;
}
