import { motion } from 'motion/react';
import { Avatar, Button, Panel } from '../components/ui';
import { VideoPlayerView } from '../components/VideoPlayerView';
import { useGame } from '../hooks/useGame';
import { call } from '../lib/socket';

export function RevealView() {
  const { result, playerById, isHost, me, toast } = useGame();
  if (!result) return null;

  const owners = result.ownerIds.map(playerById).filter((p) => p !== undefined);
  const myOutcome = result.votes.find((v) => v.voterId === me?.id);
  const myDelta = me ? (result.deltas[me.id] ?? 0) : 0;
  const isLast = result.roundIndex + 1 >= result.totalRounds;

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 lg:grid-cols-[auto_1fr]">
        <VideoPlayerView card={result.card} compact />

        <div className="space-y-5">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center lg:text-left">
            <p className="text-muted">Geliked von…</p>
            <div className="mt-3 flex flex-wrap justify-center gap-6 lg:justify-start">
              {owners.map((o, i) => (
                <motion.div
                  key={o.id}
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', bounce: 0.5, delay: 0.5 + i * 0.25 }}
                  className="flex flex-col items-center gap-2"
                >
                  <Avatar player={o} size={110} ring="var(--color-hot)" />
                  <span className="font-display text-3xl font-extrabold">{o.name}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {myOutcome && (
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.1 }}
              className={`font-display text-center text-2xl font-extrabold lg:text-left ${myOutcome.correct ? 'text-good' : 'text-hot'}`}
            >
              {myOutcome.correct
                ? `Richtig! +${myOutcome.points} (inkl. ${myOutcome.speedBonus} Speed-Bonus)`
                : myOutcome.targetId
                  ? 'Daneben!'
                  : 'Zu langsam ⏰'}
            </motion.p>
          )}
          {!myOutcome && myDelta > 0 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="font-display text-2xl font-extrabold text-ice">
              Du hast {myDelta / 50} getäuscht: +{myDelta}
            </motion.p>
          )}

          <Panel>
            <ul className="space-y-2">
              {result.votes.map((v, i) => {
                const voter = playerById(v.voterId);
                const target = v.targetId ? playerById(v.targetId) : undefined;
                if (!voter) return null;
                return (
                  <motion.li
                    key={v.voterId}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 1.3 + i * 0.08 }}
                    className="flex items-center gap-3 text-sm"
                  >
                    <Avatar player={voter} size={28} />
                    <span className="w-24 truncate font-medium">{voter.name}</span>
                    <span className="text-muted">→</span>
                    <span className="min-w-0 flex-1 truncate">{target?.name ?? '—'}</span>
                    <span className={v.correct ? 'font-bold text-good' : 'text-hot'}>{v.correct ? `+${v.points}` : '✗'}</span>
                  </motion.li>
                );
              })}
              {result.ownerBonuses
                .filter((b) => b.points > 0)
                .map((b) => (
                  <li key={b.playerId} className="flex justify-between border-t border-line pt-2 text-sm">
                    <span>
                      🎭 {playerById(b.playerId)?.name} hat {b.fooled} getäuscht
                    </span>
                    <span className="font-bold text-ice">+{b.points}</span>
                  </li>
                ))}
            </ul>
          </Panel>

          {isHost ? (
            <Button className="w-full text-lg" onClick={() => call('round:next').catch((e) => toast(e.message, 'error'))}>
              {isLast ? 'Zum Finale 🏆' : 'Weiter zum Leaderboard'}
            </Button>
          ) : (
            <p className="text-center text-sm text-muted">Gleich geht's weiter…</p>
          )}
        </div>
      </div>
    </div>
  );
}
