import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (isProd) throw new Error('SESSION_SECRET (>= 16 chars) is required in production');
  // Dev fallback: random per process — sessions simply don't survive restarts.
  return crypto.randomBytes(32).toString('hex');
}

export const config = {
  isProd,
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3001),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
  sessionSecret: sessionSecret(),
  redisUrl: process.env.REDIS_URL || null,
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:5173/auth/tiktok/callback',
    pkce: (process.env.TIKTOK_PKCE || 'hex') as 'hex' | 'base64url' | 'off',
    scopes: ['user.info.basic', 'video.list'],
  },
};

export const tiktokEnabled = () => Boolean(config.tiktok.clientKey && config.tiktok.clientSecret);
