import crypto from 'node:crypto';
import type { DeckCard, DemoVisual } from '@whogooned/shared';
import { embedUrlFor } from '../tiktok/links.js';

export interface CandidateVideo {
  videoId: string;
  kind: 'tiktok' | 'demo';
  url: string | null;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  demo: DemoVisual | null;
}

export interface DeckOwner {
  id: string;
  handle: string | null;
  avatar: string | null;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Sample up to `perPlayer` videos per player, merge duplicates (everyone who has
 * the video is an owner) and shuffle everything into one master deck. Videos that
 * weren't picked become the reserve that replaces cards whose embed turns out broken.
 */
export function buildDeck(
  validByPlayer: Map<string, CandidateVideo[]>,
  perPlayer: number,
  owners: Map<string, DeckOwner>,
): { deck: DeckCard[]; reserve: DeckCard[] } {
  const holders = new Map<string, string[]>(); // videoId -> playerIds that have it
  for (const [pid, vids] of validByPlayer) {
    for (const v of vids) holders.set(v.videoId, [...(holders.get(v.videoId) ?? []), pid]);
  }

  const picked = new Map<string, { video: CandidateVideo; pickedBy: string }>();
  // Players with the fewest videos pick first so shared videos don't starve them.
  const order = [...validByPlayer.entries()].sort((a, b) => a[1].length - b[1].length);
  for (const [pid, vids] of order) {
    let n = 0;
    for (const v of shuffle(vids)) {
      if (n >= perPlayer) break;
      if (picked.has(v.videoId)) continue;
      picked.set(v.videoId, { video: v, pickedBy: pid });
      n++;
    }
  }

  const spare = new Map<string, { video: CandidateVideo; pickedBy: string }>();
  for (const [pid, vids] of validByPlayer) {
    for (const v of vids) if (!picked.has(v.videoId) && !spare.has(v.videoId)) spare.set(v.videoId, { video: v, pickedBy: pid });
  }

  const toCard = ({ video, pickedBy }: { video: CandidateVideo; pickedBy: string }): DeckCard => {
    const ownerIds = holders.get(video.videoId) ?? [pickedBy];
    const primary = owners.get(pickedBy);
    return {
      cardId: newCardId(),
      kind: video.kind,
      videoId: video.videoId,
      embedUrl: video.kind === 'tiktok' ? embedUrlFor(video.videoId) : null,
      shareUrl: video.url,
      title: video.title,
      authorName: video.authorName,
      thumbnailUrl: video.thumbnailUrl,
      demo: video.demo,
      ownerPlayerId: pickedBy,
      ownerHandle: primary?.handle ?? null,
      ownerAvatar: primary?.avatar ?? null,
      ownerPlayerIds: ownerIds,
    };
  };
  return { deck: shuffle([...picked.values()].map(toCard)), reserve: shuffle([...spare.values()].map(toCard)) };
}

export const newCardId = () => crypto.randomBytes(6).toString('base64url');

export function toPublicCard(c: DeckCard) {
  const { ownerPlayerId: _o, ownerHandle: _h, ownerAvatar: _a, ownerPlayerIds: _ids, ...pub } = c;
  return pub;
}
