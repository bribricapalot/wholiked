import { AnimatePresence, motion } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { PlayerStatus, PublicPlayer } from '@whogooned/shared';
import { useGame } from '../hooks/useGame';

const PALETTE = ['#fe2c55', '#25f4ee', '#ffd23f', '#a78bfa', '#3ddc84', '#ff8a3d', '#f472b6', '#60a5fa'];

export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ player, size = 48, ring }: { player: Pick<PublicPlayer, 'id' | 'name' | 'avatarUrl'>; size?: number; ring?: string }) {
  const style = { width: size, height: size, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined };
  if (player.avatarUrl) {
    return <img src={player.avatarUrl} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={style} />;
  }
  const first = Array.from(player.name.trim())[0] ?? '?';
  return (
    <div
      className="font-display grid shrink-0 place-items-center rounded-full font-extrabold text-ink"
      style={{ ...style, background: colorFor(player.id), fontSize: size * 0.45 }}
      aria-hidden
    >
      {first.toUpperCase()}
    </div>
  );
}

type Variant = 'hot' | 'ice' | 'ghost' | 'sun';

export function Button({
  variant = 'hot',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    hot: 'bg-hot text-white hover:brightness-110 glow-hot',
    ice: 'bg-ice text-ink hover:brightness-110 glow-ice',
    sun: 'bg-sun text-ink hover:brightness-110',
    ghost: 'bg-panel-2 text-white hover:bg-line border border-line',
  };
  return (
    <button
      className={`font-display rounded-2xl px-5 py-3 font-bold tracking-tight transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-panel/80 p-5 backdrop-blur ${className}`}>{children}</div>;
}

const STATUS_LABEL: Record<PlayerStatus, { label: string; cls: string }> = {
  CONNECTED: { label: 'Online', cls: 'bg-panel-2 text-muted' },
  READY: { label: 'Bereit', cls: 'bg-good/15 text-good' },
  FETCHING_LIKES: { label: 'Lädt Videos…', cls: 'bg-ice/15 text-ice animate-pulse' },
  GUESSING: { label: 'Rät…', cls: 'bg-sun/15 text-sun' },
  SPECTATING: { label: 'Schaut zu', cls: 'bg-panel-2 text-muted' },
};

export function StatusBadge({ player }: { player: PublicPlayer }) {
  if (!player.connected) return <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted">Offline</span>;
  const s = STATUS_LABEL[player.status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`font-display text-stroke font-extrabold tracking-tighter ${size === 'lg' ? 'text-6xl sm:text-7xl' : 'text-2xl'}`}>
      WhoGooned<span className="text-hot">?</span>
    </span>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useGame();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            onClick={() => dismissToast(t.id)}
            className={`pointer-events-auto max-w-md rounded-2xl border px-4 py-3 text-left text-sm shadow-xl backdrop-blur ${
              t.tone === 'error'
                ? 'border-hot/50 bg-hot/15 text-white'
                : t.tone === 'success'
                  ? 'border-good/50 bg-good/15 text-white'
                  : 'border-line bg-panel/95 text-white'
            }`}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function TimerBar({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const pct = Math.max(0, Math.min(1, remainingMs / totalMs));
  const color = pct > 0.5 ? 'var(--color-ice)' : pct > 0.2 ? 'var(--color-sun)' : 'var(--color-hot)';
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-panel-2">
      <div className="h-full rounded-full transition-[width] duration-100 ease-linear" style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}
