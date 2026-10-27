import { motion } from 'motion/react';
import type { PublicPlayer } from '@whogooned/shared';
import { Avatar, TimerBar } from '../components/ui';
import { VideoPlayerView } from '../components/VideoPlayerView';
import { useCountdown, useGame } from '../hooks/useGame';
import { call } from '../lib/socket';

export function RoundView() {
  const { round, room, isHost, toast } = useGame();
  const remaining = useCountdown(round?.endsAt);
  if (!round || !room) return <div className="grid min-h-[70vh] place-items-center text-muted">Nächste Runde startet…</div>;

  const total = round.endsAt - round.startedAt;
  const skip = () => call('round:skip', { roundIndex: round.roundIndex }).catch((e) => toast(e.message, 'error'));
  const secs = Math.ceil(remaining / 1000);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-4">
        <span className="font-display shrink-0 text-lg font-bold">
          Runde {round.roundIndex + 1}
          <span className="text-muted">/{round.totalRounds}</span>
        </span>
        <TimerBar remainingMs={remaining} totalMs={total} />
        <motion.span
          key={secs}
          initial={{ scale: 1.4 }}
          animate={{ scale: 1 }}
          className={`font-display w-10 shrink-0 text-right text-2xl font-extrabold ${secs <= 5 ? 'text-hot' : ''}`}
        >
          {secs}
        </motion.span>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[auto_1fr]">
        <div className="space-y-2">
          <VideoPlayerView card={round.card} onBroken={isHost ? () => skip() : undefined} />
          {isHost && (
            <button onClick={() => skip()} className="mx-auto block text-sm text-muted hover:text-white">
              ⏭ Video lädt nicht? Überspringen
            </button>
          )}
        </div>
        <GuessingGrid />
      </div>
    </div>
  );
}

export function GuessingGrid() {
  const { round, room, me, myVote, vote, voteProgress, playerById } = useGame();
  if (!round || !room || !me) return null;

  const canVote = round.eligibleVoterIds.includes(me.id);
  const candidates = round.candidateIds
    .map((id) => playerById(id))
    .filter((p): p is PublicPlayer => Boolean(p))
    .filter((p) => p.id !== me.id || room.settings.allowSelfVote);
  const voted = voteProgress?.voted ?? room.players.filter((p) => p.hasVoted).length;
  const eligible = voteProgress?.eligible ?? round.eligibleVoterIds.length;

  return (
    <div className="space-y-4">
      <h2 className="font-display text-3xl leading-tight font-extrabold">
        {canVote ? (
          <>
            Wer hat das <span className="text-hot">geliked</span>?
          </>
        ) : !round.candidateIds.includes(me.id) ? (
          'Du schaust diese Runde zu 👀'
        ) : (
          <>
            Das ist <span className="text-ice">dein</span> Video! Pokerface 😐
          </>
        )}
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {candidates.map((p, i) => {
          const selected = myVote === p.id;
          const locked = Boolean(myVote) || !canVote;
          return (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: locked && !selected ? 0.45 : 1, y: 0, scale: selected ? 1.04 : 1 }}
              transition={{ delay: i * 0.04 }}
              whileHover={!locked ? { scale: 1.04, y: -2 } : undefined}
              whileTap={!locked ? { scale: 0.96 } : undefined}
              disabled={locked}
              onClick={() => vote(p.id)}
              className={`flex flex-col items-center gap-2 rounded-3xl border-2 bg-panel p-4 transition-colors ${
                selected ? 'glow-hot border-hot' : 'border-line enabled:hover:border-ice'
              }`}
            >
              <Avatar player={p} size={64} />
              <span className="w-full truncate text-center font-semibold">{p.name}</span>
              {p.hasVoted && <span className="text-xs text-good">hat getippt ✓</span>}
            </motion.button>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted">
        {myVote ? 'Tipp abgegeben – ' : ''}
        {voted}/{eligible} haben getippt
      </p>
    </div>
  );
}
