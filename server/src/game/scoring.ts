import {
  SCORING,
  type Award,
  type LeaderboardEntry,
  type OwnerBonus,
  type VoteOutcome,
} from '@whogooned/shared';

export interface StoredVote {
  targetId: string;
  at: number; // server epoch ms
}

export interface RoundInput {
  ownerIds: string[];
  eligibleVoterIds: string[];
  votes: Record<string, StoredVote>;
  startedAt: number;
  endsAt: number;
}

export interface RoundScore {
  votes: VoteOutcome[];
  ownerBonuses: OwnerBonus[];
  deltas: Record<string, number>;
}

/** +1..+50 linear in the remaining time when the vote landed. */
export function speedBonus(at: number, startedAt: number, endsAt: number): number {
  const total = Math.max(1, endsAt - startedAt);
  const remaining = Math.min(total, Math.max(0, endsAt - at));
  const { SPEED_BONUS_MIN: min, SPEED_BONUS_MAX: max } = SCORING;
  return Math.round(min + (max - min) * (remaining / total));
}

/**
 * Rules: +100 for a correct guess, +1..50 speed bonus, and every owner earns +50
 * for each voter who guessed wrong (players who didn't vote don't count as fooled).
 */
export function scoreRound(input: RoundInput): RoundScore {
  const owners = new Set(input.ownerIds);
  const deltas: Record<string, number> = {};
  const add = (id: string, pts: number) => (deltas[id] = (deltas[id] ?? 0) + pts);

  let fooled = 0;
  const votes: VoteOutcome[] = input.eligibleVoterIds.map((voterId) => {
    const v = input.votes[voterId];
    if (!v) {
      return { voterId, targetId: null, correct: false, points: 0, speedBonus: 0, elapsedMs: null };
    }
    const correct = owners.has(v.targetId);
    const bonus = correct ? speedBonus(v.at, input.startedAt, input.endsAt) : 0;
    const points = correct ? SCORING.CORRECT + bonus : 0;
    if (!correct) fooled++;
    add(voterId, points);
    return { voterId, targetId: v.targetId, correct, points, speedBonus: bonus, elapsedMs: v.at - input.startedAt };
  });

  const ownerBonuses = input.ownerIds.map((playerId) => {
    const points = fooled * SCORING.FOOLED_PER_PLAYER;
    add(playerId, points);
    return { playerId, fooled, points };
  });

  return { votes, ownerBonuses, deltas };
}

/** Standard competition ranking (1,2,2,4) sorted by score desc, then name order given. */
export function rank(
  players: { id: string; score: number }[],
  deltas: Record<string, number> = {},
): LeaderboardEntry[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  let lastScore = Number.NaN;
  let lastRank = 0;
  return sorted.map((p, i) => {
    if (p.score !== lastScore) {
      lastRank = i + 1;
      lastScore = p.score;
    }
    return { playerId: p.id, score: p.score, rank: lastRank, delta: deltas[p.id] ?? 0 };
  });
}

export interface PlayerStats {
  correct: number;
  guesses: number;
  correctMsTotal: number;
  fooled: number;
  ownedRounds: number;
}

export const emptyStats = (): PlayerStats => ({ correct: 0, guesses: 0, correctMsTotal: 0, fooled: 0, ownedRounds: 0 });

export function computeAwards(players: { id: string; score: number; stats: PlayerStats }[]): Award[] {
  const awards: Award[] = [];
  const best = <T>(list: T[], better: (a: T, b: T) => boolean) =>
    list.reduce<T | null>((acc, x) => (acc === null || better(x, acc) ? x : acc), null);

  const guesser = best(
    players.filter((p) => p.stats.correct > 0),
    (a, b) => a.stats.correct > b.stats.correct || (a.stats.correct === b.stats.correct && a.score > b.score),
  );
  if (guesser) {
    awards.push({
      key: 'MASTER_GUESSER',
      title: 'Master Guesser',
      description: 'Die meisten richtigen Tipps',
      playerId: guesser.id,
      value: `${guesser.stats.correct}/${guesser.stats.guesses} richtig`,
    });
  }

  const unique = best(
    players.filter((p) => p.stats.fooled > 0),
    (a, b) => a.stats.fooled > b.stats.fooled,
  );
  if (unique) {
    awards.push({
      key: 'UNIQUE_TASTE',
      title: 'Most Unique Taste',
      description: 'Hat mit eigenen Videos die meisten getäuscht',
      playerId: unique.id,
      value: `${unique.stats.fooled}× getäuscht`,
    });
  }

  const avg = (p: (typeof players)[number]) => p.stats.correctMsTotal / p.stats.correct;
  const speedster = best(
    players.filter((p) => p.stats.correct > 0),
    (a, b) => avg(a) < avg(b),
  );
  if (speedster) {
    awards.push({
      key: 'SPEEDSTER',
      title: 'Speedrunner',
      description: 'Schnellste richtige Antworten',
      playerId: speedster.id,
      value: `Ø ${(avg(speedster) / 1000).toFixed(1)} s`,
    });
  }
  return awards;
}
