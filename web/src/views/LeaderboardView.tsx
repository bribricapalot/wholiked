import { AnimatePresence, motion } from 'motion/react';
import type { LeaderboardEntry } from '@whogooned/shared';
import { Avatar, Button, Panel } from '../components/ui';
import { useGame } from '../hooks/useGame';
import { call } from '../lib/socket';

export function LeaderboardView() {
  const { leaderboard, room, isHost, toast } = useGame();
  if (!room) return null;

  // Fall back to live room scores if we joined between events.
  const entries: LeaderboardEntry[] =
    leaderboard?.entries ??
    [...room.players].sort((a, b) => b.score - a.score).map((p, i) => ({ playerId: p.id, score: p.score, rank: i + 1, delta: 0 }));
  const roundNo = (leaderboard?.roundIndex ?? room.round?.index ?? 0) + 1;
  const total = leaderboard?.totalRounds ?? room.round?.total ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="text-center">
        <p className="text-muted">
          Nach Runde {roundNo}/{total}
        </p>
        <h1 className="font-display text-5xl font-extrabold">Leaderboard</h1>
      </div>
      <Panel>
        <LeaderboardList entries={entries} />
      </Panel>
      {room.phase === 'LEADERBOARD' &&
        (isHost ? (
          <Button className="w-full text-lg" onClick={() => call('round:next').catch((e) => toast(e.message, 'error'))}>
            Nächste Runde ▶
          </Button>
        ) : (
          <p className="text-center text-sm text-muted">Gleich geht's weiter…</p>
        ))}
    </div>
  );
}

export function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  const { playerById, me } = useGame();
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <ol className="space-y-2">
      <AnimatePresence>
        {entries.map((e, i) => {
          const p = playerById(e.playerId);
          if (!p) return null;
          return (
            <motion.li
              key={e.playerId}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ layout: { type: 'spring', bounce: 0.3 }, delay: i * 0.05 }}
              className={`flex items-center gap-3 rounded-2xl p-3 ${p.id === me?.id ? 'bg-ice/10 ring-1 ring-ice/40' : 'bg-panel-2'}`}
            >
              <span className="font-display w-8 text-center text-xl font-extrabold">{medal[e.rank - 1] ?? e.rank}</span>
              <Avatar player={p} size={40} />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {e.delta > 0 && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.4 + i * 0.05, type: 'spring' }}
                  className="rounded-full bg-good/15 px-2 py-0.5 text-sm font-bold text-good"
                >
                  +{e.delta}
                </motion.span>
              )}
              <span className="font-display w-16 text-right text-xl font-extrabold">{e.score}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
