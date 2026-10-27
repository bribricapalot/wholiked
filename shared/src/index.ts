// Shared contract between server and web client.
// Every socket payload in the game is defined here — see docs/ARCHITECTURE.md.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const ROOM_TTL_SECONDS = 2 * 60 * 60; // 2h inactivity => everything expires
export const MAX_PLAYERS = 12;
export const MAX_LINKS_PER_PLAYER = 25;
/** Likes taken from a TikTok data export (sampled client-side). */
export const MAX_EXPORT_LINKS = 500;

export const SCORING = {
  CORRECT: 100,
  SPEED_BONUS_MIN: 1,
  SPEED_BONUS_MAX: 50,
  FOOLED_PER_PLAYER: 50,
} as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  roundSeconds: 20,
  videosPerPlayer: 3,
  allowSelfVote: false,
  botCount: 0,
};

export const SETTINGS_LIMITS = {
  roundSeconds: { min: 10, max: 60 },
  videosPerPlayer: { min: 1, max: 10 },
  botCount: { min: 0, max: 4 },
} as const;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type PlayerStatus =
  | 'CONNECTED'
  | 'READY'
  | 'FETCHING_LIKES'
  | 'GUESSING'
  | 'SPECTATING';

export type RoomPhase =
  | 'LOBBY'
  | 'COLLECTING'
  | 'ROUND_ACTIVE'
  | 'ROUND_REVEAL'
  | 'LEADERBOARD'
  | 'GAME_OVER';

export interface RoomSettings {
  roundSeconds: number;
  videosPerPlayer: number;
  allowSelfVote: boolean;
  botCount: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatarUrl: string | null;
  tiktokHandle: string | null;
  isHost: boolean;
  isBot: boolean;
  status: PlayerStatus;
  connected: boolean;
  score: number;
  /** Number of videos this player has queued for the deck (count only, never the videos). */
  videoCount: number;
  /** Only meaningful during ROUND_ACTIVE. */
  hasVoted: boolean;
}

export interface PublicRoundInfo {
  index: number; // 0-based
  total: number;
  startedAt: number; // server epoch ms
  endsAt: number; // server epoch ms
}

export interface PublicRoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  settings: RoomSettings;
  players: PublicPlayer[];
  round: PublicRoundInfo | null;
  serverNow: number;
}

export interface DemoVisual {
  emoji: string;
  caption: string;
  gradient: [string, string];
}

/** A deck card as the client sees it — never contains the owner before the reveal. */
export interface VideoCardPublic {
  cardId: string;
  kind: 'tiktok' | 'demo';
  videoId: string;
  embedUrl: string | null;
  shareUrl: string | null;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  demo: DemoVisual | null;
}

/** Server-side deck card: `{ videoId, embedUrl, ownerPlayerId, ownerHandle, ownerAvatar }` + extras. */
export interface DeckCard extends VideoCardPublic {
  ownerPlayerId: string;
  ownerHandle: string | null;
  ownerAvatar: string | null;
  /** When several players liked the same video they all count as owners. */
  ownerPlayerIds: string[];
}

/** A video a player queued in the lobby (before validation). */
export interface VideoSubmission {
  videoId: string;
  url: string;
  source: 'link' | 'tiktok_api' | 'export';
  addedAt: number;
}

// ---------------------------------------------------------------------------
// Socket payloads — client -> server
// ---------------------------------------------------------------------------

export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface RoomCreatePayload {
  name: string;
}

export interface RoomJoinPayload {
  roomCode: string;
  name: string;
  /** Present when the client re-joins after a reload/disconnect. */
  playerId?: string;
  playerToken?: string;
}

export interface JoinResult {
  roomCode: string;
  playerId: string;
  playerToken: string;
  state: PublicRoomState;
}

export interface SubmitLinksPayload {
  urls: string[];
  /** 'export' replaces any earlier export import of this player. */
  source?: 'link' | 'export';
}

export interface SubmitLinksResult {
  accepted: VideoSubmission[];
  rejected: { url: string; reason: string }[];
  total: number;
}

export interface VoteSubmitPayload {
  roundIndex: number;
  targetPlayerId: string;
}

// ---------------------------------------------------------------------------
// Socket payloads — server -> client
// ---------------------------------------------------------------------------

export interface RoundStartPayload {
  roundIndex: number;
  totalRounds: number;
  card: VideoCardPublic;
  startedAt: number;
  endsAt: number;
  serverNow: number;
  /** Players who may vote this round (owners sit out). */
  eligibleVoterIds: string[];
  /** Players that can be picked as the answer. */
  candidateIds: string[];
}

export interface VoteProgressPayload {
  roundIndex: number;
  voted: number;
  eligible: number;
}

export interface VoteOutcome {
  voterId: string;
  targetId: string | null; // null => no vote before the timer ran out
  correct: boolean;
  points: number; // 100 + speed bonus, or 0
  speedBonus: number;
  elapsedMs: number | null;
}

export interface OwnerBonus {
  playerId: string;
  fooled: number;
  points: number;
}

export interface RoundResultPayload {
  roundIndex: number;
  totalRounds: number;
  card: DeckCard;
  ownerIds: string[];
  votes: VoteOutcome[];
  ownerBonuses: OwnerBonus[];
  /** Points gained this round per player. */
  deltas: Record<string, number>;
  scores: Record<string, number>;
}

export interface LeaderboardEntry {
  playerId: string;
  score: number;
  rank: number;
  delta: number;
}

export interface LeaderboardPayload {
  roundIndex: number;
  totalRounds: number;
  entries: LeaderboardEntry[];
  isFinal: boolean;
}

export interface Award {
  key: 'MASTER_GUESSER' | 'UNIQUE_TASTE' | 'SPEEDSTER';
  title: string;
  description: string;
  playerId: string;
  value: string;
}

export interface GameOverPayload {
  podium: LeaderboardEntry[];
  entries: LeaderboardEntry[];
  awards: Award[];
}

export interface NoticePayload {
  type: 'NO_VIDEOS' | 'INFO' | 'TIKTOK_REVOKED';
  message: string;
}

// ---------------------------------------------------------------------------
// Typed Socket.io maps
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  'room:create': (p: RoomCreatePayload, ack: Ack<JoinResult>) => void;
  'room:join': (p: RoomJoinPayload, ack: Ack<JoinResult>) => void;
  'room:leave': (ack?: Ack) => void;
  'room:settings': (p: Partial<RoomSettings>, ack: Ack) => void;
  'room:kick': (p: { playerId: string }, ack: Ack) => void;
  'player:ready': (p: { ready: boolean }, ack: Ack) => void;
  'player:submitLinks': (p: SubmitLinksPayload, ack: Ack<SubmitLinksResult>) => void;
  'player:removeVideo': (p: { videoId: string }, ack: Ack<{ total: number }>) => void;
  'player:clearExport': (ack: Ack<{ total: number }>) => void;
  'player:listVideos': (ack: Ack<{ videos: VideoSubmission[] }>) => void;
  'player:linkTikTok': (ack: Ack<{ name: string; avatarUrl: string | null }>) => void;
  'player:importTikTok': (ack: Ack<{ imported: number; total: number }>) => void;
  'game:start': (ack: Ack) => void;
  'vote:submit': (p: VoteSubmitPayload, ack: Ack) => void;
  'round:next': (ack: Ack) => void;
  /** Host: skip a video that won't play (deleted/private). */
  'round:skip': (p: { roundIndex: number }, ack: Ack) => void;
  'game:restart': (ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: PublicRoomState) => void;
  'room:closed': (p: { reason: string }) => void;
  'round:start': (p: RoundStartPayload) => void;
  'round:voteProgress': (p: VoteProgressPayload) => void;
  'round:result': (p: RoundResultPayload) => void;
  'leaderboard:update': (p: LeaderboardPayload) => void;
  'game:over': (p: GameOverPayload) => void;
  'player:notice': (p: NoticePayload) => void;
}
