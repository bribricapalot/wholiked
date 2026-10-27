import type { PlayerStatus, RoomPhase, RoomSettings } from '@whogooned/shared';
import type { PlayerStats } from './scoring.js';

/** Server-side room record, stored as JSON under wg:room:{CODE}. */
export interface PlayerRecord {
  id: string;
  tokenHash: string;
  name: string;
  avatarUrl: string | null;
  tiktokHandle: string | null;
  tiktokOpenId: string | null;
  /** Session id (wg:sess:*) holding this player's TikTok tokens, if linked. */
  sessionId: string | null;
  isBot: boolean;
  status: PlayerStatus;
  connected: boolean;
  score: number;
  videoCount: number;
  joinedAt: number;
  stats: PlayerStats;
}

export interface RoundRecord {
  index: number;
  total: number;
  startedAt: number;
  endsAt: number;
  ownerIds: string[];
  eligibleVoterIds: string[];
  candidateIds: string[];
  votedIds: string[];
}

export interface RoomRecord {
  code: string;
  phase: RoomPhase;
  hostId: string;
  settings: RoomSettings;
  players: PlayerRecord[];
  round: RoundRecord | null;
  lastDeltas: Record<string, number>;
  /** Bumped on every (re)start so stale timers from an earlier game no-op. */
  gameSeq: number;
  createdAt: number;
}

export class GameError extends Error {}
