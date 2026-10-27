// Only reconnect credentials and the display name live in the browser —
// never videos or TikTok data.

export interface Creds {
  roomCode: string;
  playerId: string;
  playerToken: string;
}

const CREDS = 'wg:creds';
const NAME = 'wg:name';

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key) ?? localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const storage = {
  // sessionStorage so two tabs on one machine can be two players.
  getCreds: () => read<Creds>(CREDS),
  setCreds: (c: Creds) => {
    try {
      sessionStorage.setItem(CREDS, JSON.stringify(c));
    } catch {}
  },
  clearCreds: () => {
    try {
      sessionStorage.removeItem(CREDS);
    } catch {}
  },
  getName: () => read<string>(NAME) ?? '',
  setName: (n: string) => {
    try {
      localStorage.setItem(NAME, JSON.stringify(n));
    } catch {}
  },
};
