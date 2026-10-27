import { motion } from 'motion/react';
import type { Award, LeaderboardEntry } from '@whogooned/shared';
import { Avatar, Button, Panel } from '../components/ui';
import { useGame } from '../hooks/useGame';
import { call } from '../lib/socket';
import { LeaderboardList } from './LeaderboardView';

const AWARD_ICON: Record<Award['key'], string> = { MASTER_GUESSER: '🧠', UNIQUE_TASTE: '🦄', SPEEDSTER: '⚡' };

export function GameOverView() {
  const { gameOver, isHost, leaveRoom, toast } = useGame();
  if (!gameOver) return null;

  return (
    <div className="space-y-10">
      <motion.h1
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.5 }}
        className="font-display text-stroke text-center text-6xl font-extrabold"
      >
        Game Over!
      </motion.h1>

      <Podium podium={gameOver.podium} />

      {gameOver.awards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {gameOver.awards.map((a, i) => (
            <AwardCard key={a.key} award={a} delay={1.6 + i * 0.2} />
          ))}
        </div>
      )}

      <Panel className="mx-auto max-w-2xl">
        <LeaderboardList entries={gameOver.entries} />
      </Panel>

      <div className="flex flex-wrap justify-center gap-3">
        {isHost && (
          <Button className="text-lg" onClick={() => call('game:restart').catch((e) => toast(e.message, 'error'))}>
            Nochmal spielen
          </Button>
        )}
        <Button variant="ghost" onClick={leaveRoom}>
          Raum verlassen
        </Button>
      </div>
    </div>
  );
}

function Podium({ podium }: { podium: LeaderboardEntry[] }) {
  const { playerById } = useGame();
  // Display order: 2nd, 1st, 3rd
  const slots = [
    { entry: podium[1], height: 'h-28', place: 2, color: '#c0c6d6', delay: 0.6 },
    { entry: podium[0], height: 'h-40', place: 1, color: 'var(--color-sun)', delay: 1.0 },
    { entry: podium[2], height: 'h-20', place: 3, color: '#d08a4c', delay: 0.3 },
  ];
  return (
    <div className="flex items-end justify-center gap-3 sm:gap-6">
      {slots.map(({ entry, height, place, color, delay }) => {
        const p = entry ? playerById(entry.playerId) : undefined;
        return (
          <div key={place} className="flex w-28 flex-col items-center sm:w-36">
            {p && entry && (
              <motion.div
                initial={{ y: -40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: delay + 0.3, type: 'spring', bounce: 0.5 }}
                className="mb-3 flex flex-col items-center gap-1"
              >
                {place === 1 && <span className="text-4xl">👑</span>}
                <Avatar player={p} size={place === 1 ? 88 : 68} ring={color} />
                <span className="font-display max-w-full truncate text-lg font-bold">{p.name}</span>
                <span className="text-sm text-muted">{entry.score} Pkt.</span>
              </motion.div>
            )}
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay, duration: 0.5, ease: 'backOut' }}
              style={{ background: color, originY: 1 }}
              className={`font-display grid w-full ${height} place-items-center rounded-t-2xl text-4xl font-extrabold text-ink`}
            >
              {place}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

function AwardCard({ award, delay }: { award: Award; delay: number }) {
  const { playerById } = useGame();
  const p = playerById(award.playerId);
  if (!p) return null;
  return (
    <motion.div initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay }}>
      <Panel className="flex h-full items-center gap-4">
        <span className="text-4xl">{AWARD_ICON[award.key]}</span>
        <div className="min-w-0">
          <p className="font-display font-extrabold text-sun">{award.title}</p>
          <p className="flex items-center gap-2 truncate font-semibold">
            <Avatar player={p} size={22} /> {p.name}
          </p>
          <p className="text-xs text-muted">
            {award.description} · {award.value}
          </p>
        </div>
      </Panel>
    </motion.div>
  );
}
