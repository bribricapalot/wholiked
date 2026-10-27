import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { VideoCardPublic } from '@whogooned/shared';

/** Renders a deck card: official TikTok embed player, or an animated demo card for bots. */
export function VideoPlayerView({
  card,
  compact = false,
  onBroken,
}: {
  card: VideoCardPublic;
  compact?: boolean;
  /** Called once if the TikTok player reports an error (deleted/private video). */
  onBroken?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // The TikTok embed player posts events to the parent window (onPlayerReady, onStateChange,
  // onError …). An error event means the video is gone.
  useEffect(() => {
    setBroken(false);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      let data: unknown = e.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const type = (data as { type?: unknown })?.type;
      if (typeof type === 'string' && /error/i.test(type)) setBroken(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [card.cardId]);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (broken && onBroken && reported.current !== card.cardId) {
      reported.current = card.cardId;
      onBroken();
    }
  }, [broken, onBroken, card.cardId]);
  const height = compact ? 'h-[42vh] max-h-[420px]' : 'h-[62vh] max-h-[680px]';

  if (card.kind === 'demo' && card.demo) {
    const [a, b] = card.demo.gradient;
    return (
      <motion.div
        initial={{ rotateY: 90, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.35 }}
        className={`relative mx-auto aspect-[9/16] ${height} overflow-hidden rounded-3xl border border-line shadow-2xl`}
        style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}
      >
        <motion.div
          animate={{ y: [0, -14, 0], rotate: [0, 6, -6, 0] }}
          transition={{ repeat: Infinity, duration: 2.2 }}
          className="absolute inset-0 grid place-items-center text-[7rem] drop-shadow-xl"
        >
          {card.demo.emoji}
        </motion.div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-16">
          <p className="font-display text-lg leading-tight font-bold">{card.demo.caption}</p>
          <p className="mt-1 text-xs text-white/70">Demo-Video</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`relative mx-auto aspect-[9/16] ${height} overflow-hidden rounded-3xl border border-line bg-black shadow-2xl`}
    >
      {!loaded && card.thumbnailUrl && (
        <img src={card.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-60 blur-sm" />
      )}
      {!loaded && <div className="absolute inset-0 grid place-items-center text-muted">Lade Video…</div>}
      {card.embedUrl && (
        <iframe
          key={card.cardId}
          ref={frame}
          src={card.embedUrl}
          title={card.title ?? 'TikTok-Video'}
          onLoad={() => setLoaded(true)}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full"
        />
      )}
      {broken && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-sm">
          Dieses Video ist nicht mehr verfügbar 😢
        </div>
      )}
      {card.shareUrl && (
        <a
          href={card.shareUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 backdrop-blur hover:text-white"
        >
          In TikTok öffnen ↗
        </a>
      )}
    </motion.div>
  );
}
