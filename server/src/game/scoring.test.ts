import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAwards, emptyStats, rank, scoreRound, speedBonus } from './scoring.js';

test('speed bonus spans 1..50', () => {
  assert.equal(speedBonus(0, 0, 20_000), 50);
  assert.equal(speedBonus(20_000, 0, 20_000), 1);
  assert.equal(speedBonus(10_000, 0, 20_000), 26);
  assert.equal(speedBonus(99_999, 0, 20_000), 1); // late vote clamps
});

test('correct guess, wrong guess, no vote, owner bonus', () => {
  const r = scoreRound({
    ownerIds: ['owner'],
    eligibleVoterIds: ['a', 'b', 'c'],
    votes: { a: { targetId: 'owner', at: 0 }, b: { targetId: 'a', at: 5_000 } },
    startedAt: 0,
    endsAt: 20_000,
  });
  assert.equal(r.deltas.a, 150);
  assert.equal(r.deltas.b, 0);
  assert.equal(r.deltas.c ?? 0, 0);
  assert.equal(r.deltas.owner, 50); // fooled b only — c didn't vote
  assert.deepEqual(r.ownerBonuses, [{ playerId: 'owner', fooled: 1, points: 50 }]);
  assert.equal(r.votes.find((v) => v.voterId === 'c')?.targetId, null);
});

test('shared video: any owner counts as correct, every owner earns the fool bonus', () => {
  const r = scoreRound({
    ownerIds: ['x', 'y'],
    eligibleVoterIds: ['a', 'b'],
    votes: { a: { targetId: 'y', at: 20_000 }, b: { targetId: 'a', at: 1 } },
    startedAt: 0,
    endsAt: 20_000,
  });
  assert.equal(r.deltas.a, 101);
  assert.equal(r.deltas.x, 50);
  assert.equal(r.deltas.y, 50);
});

test('competition ranking handles ties', () => {
  const ranked = rank([
    { id: 'a', score: 100 },
    { id: 'b', score: 300 },
    { id: 'c', score: 100 },
    { id: 'd', score: 50 },
  ]);
  assert.deepEqual(
    ranked.map((e) => [e.playerId, e.rank]),
    [['b', 1], ['a', 2], ['c', 2], ['d', 4]],
  );
});

test('awards', () => {
  const awards = computeAwards([
    { id: 'a', score: 300, stats: { ...emptyStats(), correct: 3, guesses: 4, correctMsTotal: 9_000 } },
    { id: 'b', score: 200, stats: { ...emptyStats(), correct: 2, guesses: 4, correctMsTotal: 2_000, fooled: 5 } },
  ]);
  assert.deepEqual(
    awards.map((a) => [a.key, a.playerId]),
    [['MASTER_GUESSER', 'a'], ['UNIQUE_TASTE', 'b'], ['SPEEDSTER', 'b']],
  );
});
