import crypto from 'node:crypto';
import { config } from '../config.js';
import type { TikTokTokens } from '../sessions.js';
import { tiktokApiThrottle, throttledFetch } from './throttle.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';

export function createPkce() {
  if (config.tiktok.pkce === 'off') return { verifier: null, challenge: null };
  // 64 chars from the unreserved set, as required by RFC 7636 / TikTok.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.randomBytes(64);
  const verifier = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  const hash = crypto.createHash('sha256').update(verifier);
  // TikTok documents a hex-encoded SHA256 challenge for its Login Kit; RFC 7636 uses base64url.
  const challenge = config.tiktok.pkce === 'hex' ? hash.digest('hex') : hash.digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(state: string, challenge: string | null) {
  const p = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    scope: config.tiktok.scopes.join(','),
    response_type: 'code',
    redirect_uri: config.tiktok.redirectUri,
    state,
  });
  if (challenge) {
    p.set('code_challenge', challenge);
    p.set('code_challenge_method', 'S256');
  }
  return `${AUTH_URL}?${p}`;
}

class TikTokError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function postForm(path: string, body: Record<string, string>) {
  const res = await throttledFetch(tiktokApiThrottle, `${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body: new URLSearchParams(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || j.error) {
    throw new TikTokError(j.error_description || j.error || `TikTok HTTP ${res.status}`, j.error);
  }
  return j;
}

export async function exchangeCode(code: string, verifier: string | null): Promise<TikTokTokens> {
  const body: Record<string, string> = {
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.tiktok.redirectUri,
  };
  if (verifier) body.code_verifier = verifier;
  const j = await postForm('/oauth/token/', body);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: Date.now() + Number(j.expires_in ?? 0) * 1000,
    scope: j.scope ?? '',
  };
}

export async function revokeToken(accessToken: string) {
  await postForm('/oauth/revoke/', {
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    token: accessToken,
  });
}

async function apiCall(accessToken: string, path: string, init: RequestInit = {}) {
  const res = await throttledFetch(tiktokApiThrottle, `${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers },
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || (j.error?.code && j.error.code !== 'ok')) {
    throw new TikTokError(j.error?.message || `TikTok HTTP ${res.status}`, j.error?.code);
  }
  return j.data;
}

export interface TikTokProfile {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function fetchProfile(accessToken: string): Promise<TikTokProfile> {
  const data = await apiCall(accessToken, '/user/info/?fields=open_id,avatar_url,display_name');
  const u = data?.user ?? {};
  return { openId: u.open_id, displayName: u.display_name || 'TikTok User', avatarUrl: u.avatar_url ?? null };
}

export interface TikTokVideo {
  id: string;
  shareUrl: string | null;
  title: string | null;
  coverUrl: string | null;
}

/**
 * NOTE: TikTok's Display API (`video.list`) only returns the user's OWN public posts.
 * Liked/reposted videos are not exposed to third-party apps, so likes come in via
 * pasted share links; this import adds the user's own posts on top.
 */
export async function listVideos(accessToken: string, max = 40): Promise<TikTokVideo[]> {
  const out: TikTokVideo[] = [];
  let cursor: number | undefined;
  while (out.length < max) {
    const body: Record<string, number> = { max_count: Math.min(20, max - out.length) };
    if (cursor) body.cursor = cursor;
    const data = await apiCall(accessToken, '/video/list/?fields=id,title,share_url,cover_image_url', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    for (const v of data?.videos ?? []) {
      out.push({ id: String(v.id), shareUrl: v.share_url ?? null, title: v.title ?? null, coverUrl: v.cover_image_url ?? null });
    }
    if (!data?.has_more) break;
    cursor = data.cursor;
  }
  return out;
}
