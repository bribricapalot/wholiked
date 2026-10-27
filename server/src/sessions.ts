import { parse as parseCookie, serialize } from 'cookie';
import { ROOM_TTL_SECONDS } from '@whogooned/shared';
import { config } from './config.js';
import { randomId, seal, unseal } from './crypto.js';
import { keys, type KV } from './store/index.js';

export const SESSION_COOKIE = 'wg_sid';

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

export interface SessionData {
  tiktok?: {
    openId: string;
    displayName: string;
    avatarUrl: string | null;
    /** Removed (and revoked at TikTok) as soon as the game ends. */
    tokens: TikTokTokens | null;
  };
}

/**
 * Encrypted, ephemeral browser session. Lives only in the KV store under a sliding
 * 2h TTL; the cookie carries nothing but a random id.
 */
export class Sessions {
  constructor(private kv: KV) {}

  sidFromCookieHeader(header: string | undefined): string | null {
    if (!header) return null;
    const sid = parseCookie(header)[SESSION_COOKIE];
    return sid && /^[A-Za-z0-9_-]{20,64}$/.test(sid) ? sid : null;
  }

  cookieFor(sid: string): string {
    return serialize(SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      path: '/',
      maxAge: ROOM_TTL_SECONDS,
    });
  }

  newSid() {
    return randomId(32);
  }

  async get(sid: string): Promise<SessionData | null> {
    const raw = await this.kv.get(keys.session(sid));
    if (!raw) return null;
    const plain = unseal(raw);
    return plain ? (JSON.parse(plain) as SessionData) : null;
  }

  async save(sid: string, data: SessionData) {
    await this.kv.set(keys.session(sid), seal(JSON.stringify(data)), ROOM_TTL_SECONDS);
  }

  async destroy(sid: string) {
    await this.kv.del(keys.session(sid));
  }
}
