import { Router, type Request } from 'express';
import { tiktokEnabled } from '../config.js';
import { randomId } from '../crypto.js';
import type { Sessions } from '../sessions.js';
import { keys, type KV } from '../store/index.js';
import { authorizeUrl, createPkce, exchangeCode, fetchProfile, revokeToken } from '../tiktok/api.js';

const OAUTH_STATE_TTL = 10 * 60;

/** Tiny fixed-window per-IP limiter for the auth endpoints. */
function ipLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    return ++h.n <= limit;
  };
}

const safeReturnTo = (v: unknown) =>
  typeof v === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(v) && !v.startsWith('//') ? v : '/';

export function authRouter(kv: KV, sessions: Sessions) {
  const r = Router();
  const allow = ipLimiter(20, 60_000);

  r.get('/api/config', (_req, res) => {
    res.json({ tiktokEnabled: tiktokEnabled() });
  });

  r.get('/auth/tiktok/login', async (req, res) => {
    if (!tiktokEnabled()) return res.status(503).send('TikTok login is not configured');
    if (!allow(req)) return res.status(429).send('Too many requests');

    let sid = sessions.sidFromCookieHeader(req.headers.cookie);
    if (!sid) {
      sid = sessions.newSid();
      res.setHeader('set-cookie', sessions.cookieFor(sid));
    }
    const state = randomId(24);
    const { verifier, challenge } = createPkce();
    await kv.set(
      keys.oauth(state),
      JSON.stringify({ verifier, sid, returnTo: safeReturnTo(req.query.returnTo) }),
      OAUTH_STATE_TTL,
    );
    res.redirect(authorizeUrl(state, challenge));
  });

  r.get('/auth/tiktok/callback', async (req, res) => {
    if (!allow(req)) return res.status(429).send('Too many requests');
    const state = String(req.query.state ?? '');
    const raw = state ? await kv.get(keys.oauth(state)) : null;
    if (raw) await kv.del(keys.oauth(state)); // single use
    if (!raw) return res.redirect('/?tiktok=error&reason=state');

    const { verifier, sid, returnTo } = JSON.parse(raw) as { verifier: string | null; sid: string; returnTo: string };
    const back = (q: string) => res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${q}`);

    // The flow must finish in the same browser that started it.
    if (sessions.sidFromCookieHeader(req.headers.cookie) !== sid) return back('tiktok=error&reason=session');
    if (req.query.error) return back(`tiktok=error&reason=${encodeURIComponent(String(req.query.error))}`);

    try {
      const tokens = await exchangeCode(String(req.query.code ?? ''), verifier);
      const profile = await fetchProfile(tokens.accessToken);
      const existing = (await sessions.get(sid)) ?? {};
      await sessions.save(sid, { ...existing, tiktok: { ...profile, tokens } });
      back('tiktok=linked');
    } catch (err) {
      console.warn('[auth] TikTok callback failed:', (err as Error).message);
      back('tiktok=error&reason=exchange');
    }
  });

  r.post('/auth/tiktok/logout', async (req, res) => {
    const sid = sessions.sidFromCookieHeader(req.headers.cookie);
    if (sid) {
      const s = await sessions.get(sid);
      const token = s?.tiktok?.tokens?.accessToken;
      if (token) await revokeToken(token).catch(() => {});
      await sessions.destroy(sid);
    }
    res.json({ ok: true });
  });

  return r;
}
