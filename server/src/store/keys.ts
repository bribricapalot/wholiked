/**
 * Redis key layout (all keys carry a TTL, refreshed on activity; see docs/ARCHITECTURE.md):
 *
 *   wg:room:{CODE}              STRING  JSON RoomRecord            TTL 2h sliding
 *   wg:room:{CODE}:subs         HASH    playerId -> JSON VideoSubmission[]
 *   wg:room:{CODE}:deck         STRING  JSON DeckCard[]            (created at game start)
 *   wg:room:{CODE}:reserve      STRING  JSON DeckCard[]            spare cards that replace broken videos
 *   wg:room:{CODE}:votes:{n}    HASH    playerId -> JSON {targetId, at}  (one hash per round)
 *   wg:sess:{SID}               STRING  AES-256-GCM sealed SessionData   TTL 2h sliding
 *   wg:oauth:{STATE}            STRING  JSON {verifier, returnTo}  TTL 10min, single use
 *   wg:oembed:{VIDEO_ID}        STRING  JSON oEmbed metadata/negative cache  TTL 2h
 */
export const keys = {
  room: (code: string) => `wg:room:${code}`,
  subs: (code: string) => `wg:room:${code}:subs`,
  deck: (code: string) => `wg:room:${code}:deck`,
  reserve: (code: string) => `wg:room:${code}:reserve`,
  votes: (code: string, round: number) => `wg:room:${code}:votes:${round}`,
  session: (sid: string) => `wg:sess:${sid}`,
  oauth: (state: string) => `wg:oauth:${state}`,
  oembed: (videoId: string) => `wg:oembed:${videoId}`,
};
