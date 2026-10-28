import { ROOM_TTL_SECONDS } from '@whogooned/shared';
import { keys, type KV } from '../store/index.js';
import { oembedThrottle, throttledFetch } from './throttle.js';

const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
// Links in TikTok's personal data export point at the share domain.
const SHARE_HOSTS = new Set(['tiktokv.com', 'www.tiktokv.com', 'tiktokv.eu', 'www.tiktokv.eu', 'tiktokv.us', 'www.tiktokv.us']);
const SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

export interface ParsedLink {
  videoId: string;
  url: string; // canonical-ish URL usable for oEmbed / "open in TikTok"
}

const ID_PATTERNS = [
  /^\/@[^/]+\/video\/(\d{8,25})/,
  /^\/video\/(\d{8,25})/,
  /^\/v\/(\d{8,25})(\.html)?/,
  /^\/embed\/v2\/(\d{8,25})/,
  /^\/embed\/(\d{8,25})/,
  /^\/player\/v1\/(\d{8,25})/,
];

/** Extract a video id from a full tiktok.com URL (no network). */
export function parseTikTokUrl(input: string): ParsedLink | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (SHARE_HOSTS.has(u.hostname)) {
    // oEmbed rejects share-domain URLs with a 400, so normalise to tiktok.com.
    const m = u.pathname.match(/^\/share\/video\/(\d{8,25})/);
    return m ? { videoId: m[1], url: `https://www.tiktok.com/video/${m[1]}` } : null;
  }
  if (!TIKTOK_HOSTS.has(u.hostname)) return null;
  for (const re of ID_PATTERNS) {
    const m = u.pathname.match(re);
    if (m) {
      const at = u.pathname.match(/^\/(@[^/]+)\//)?.[1];
      return {
        videoId: m[1],
        url: at ? `https://www.tiktok.com/${at}/video/${m[1]}` : `https://www.tiktok.com/video/${m[1]}`,
      };
    }
  }
  return null;
}

export const isShortLink = (input: string) => {
  try {
    return SHORT_HOSTS.has(new URL(input.trim()).hostname);
  } catch {
    return false;
  }
};

/**
 * Resolve vm./vt.tiktok.com share links by following redirects manually —
 * only ever to TikTok hosts (no open-redirect / SSRF).
 */
export async function resolveLink(input: string): Promise<ParsedLink | null> {
  const direct = parseTikTokUrl(input);
  if (direct) return direct;
  if (!isShortLink(input)) return null;

  let current = input.trim();
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(current).hostname;
    if (!SHORT_HOSTS.has(host) && !TIKTOK_HOSTS.has(host)) return null;
    const res = await throttledFetch(oembedThrottle, current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (WhoGooned link resolver)' },
    });
    const loc = res.headers.get('location');
    await res.body?.cancel();
    if (!loc) return null;
    current = new URL(loc, current).toString();
    const parsed = parseTikTokUrl(current);
    if (parsed) return parsed;
  }
  return null;
}

export interface OEmbedInfo {
  available: boolean;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}

/**
 * Check a video via TikTok's public oEmbed endpoint. Deleted/private videos return
 * 4xx and are filtered out of the deck. Transient errors count as available so a
 * flaky network doesn't wipe someone's deck.
 */
export async function fetchOEmbed(kv: KV, link: ParsedLink): Promise<OEmbedInfo> {
  const cached = await kv.get(keys.oembed(link.videoId));
  if (cached) return JSON.parse(cached);

  let info: OEmbedInfo;
  try {
    const res = await throttledFetch(
      oembedThrottle,
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(link.url)}`,
    );
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      // NOTE: oEmbed answers 200 (often without author/thumbnail) even for unknown ids, so a
      // 200 can't prove a video exists — dead videos are skipped client-side during the round.
      info = {
        available: true,
        title: typeof j.title === 'string' ? j.title : null,
        authorName: typeof j.author_name === 'string' ? j.author_name : null,
        thumbnailUrl: typeof j.thumbnail_url === 'string' ? j.thumbnail_url : null,
      };
    } else if (res.status >= 400 && res.status < 500) {
      info = { available: false, title: null, authorName: null, thumbnailUrl: null };
    } else {
      return { available: true, title: null, authorName: null, thumbnailUrl: null };
    }
  } catch {
    return { available: true, title: null, authorName: null, thumbnailUrl: null };
  }
  await kv.set(keys.oembed(link.videoId), JSON.stringify(info), ROOM_TTL_SECONDS);
  return info;
}

export const embedUrlFor = (videoId: string) =>
  `https://www.tiktok.com/player/v1/${videoId}?autoplay=1&loop=1&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0`;
