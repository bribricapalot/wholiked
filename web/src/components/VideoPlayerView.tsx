import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { VideoCardPublic } from '@whogooned/shared';

/** How long the TikTok player may take to report onPlayerReady before the video counts as broken. */
const READY_TIMEOUT_MS = 15_000;

/** Renders a deck card: official TikTok embed player, or an animated demo card for bots. */
export function VideoPlayerView({
  card,
  compact = false,
  onBroken,
}: {
  card: VideoCardPublic;
  compact?: boolean;
  /** Called once if the TikTok player reports an error or never becomes ready (deleted/private video). */
  onBroken?: () => void;
}) {
  // Keyed by cardId so a freshly swapped-in card never inherits the previous card's state.
  const [readyId, setReadyId] = useState<string | null>(null);
  const [brokenId, setBrokenId] = useState<string | null>(null);
  const ready = readyId === card.cardId;
  const broken = brokenId === card.cardId;
  const [muted, setMuted] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);

  // The TikTok embed player posts events to the parent window (onPlayerReady, onStateChange,
  // onError …). The video stays hidden until it is ready; an error or timeout means it's gone.
  useEffect(() => {
    setMuted(true);
    if (card.kind !== 'tiktok') return;
    const id = card.cardId;
    const setBroken = () => setBrokenId(id);
    const timeout = setTimeout(setBroken, READY_TIMEOUT_MS);
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
      const { type, value } = (data ?? {}) as { type?: unknown; value?: unknown };
      if (typeof type !== 'string') return;
      if (/error/i.test(type)) {
        clearTimeout(timeout);
        setBroken();
      } else if (type === 'onPlayerReady') {
        clearTimeout(timeout);
        setReadyId(id);
      } else if (type === 'onMute') {
        setMuted(Boolean(value));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
  }, [card.cardId, card.kind]);

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (broken && onBroken && reported.current !== card.cardId) {
      reported.current = card.cardId;
      onBroken();
    }
  }, [broken, onBroken, card.cardId]);

  const toggleSound = () => {
    frame.current?.contentWindow?.postMessage({ type: muted ? 'unMute' : 'mute', 'x-tiktok-player': true }, '*');
    setMuted(!muted);
  };

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
      {card.embedUrl && (
        // The embed has no option to hide the like/comment/share column, so the frame is wider
        // than the card and that column is cropped off on the right.
        <iframe
          key={card.cardId}
          ref={frame}
          src={card.embedUrl}
          title={card.title ?? 'TikTok-Video'}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className={`absolute inset-y-0 -left-[20%] h-full w-[140%] transition-opacity duration-300 ${ready && !broken ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {/* Covers the creator's avatar and name at the top of the embed. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black from-70% to-transparent" />

      {!ready && !broken && (
        <div className="absolute inset-0 grid place-items-center text-muted">
          {card.thumbnailUrl && (
            <img src={card.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-60 blur-sm" />
          )}
          <span className="relative">Video wird geprüft…</span>
        </div>
      )}
      {broken && (
        <div className="absolute inset-0 grid place-items-center bg-black/90 p-6 text-center text-sm">
          Dieses Video ist nicht verfügbar – es wird ersetzt…
        </div>
      )}

      {ready && !broken && (
        <button
          onClick={toggleSound}
          aria-label={muted ? 'Ton an' : 'Ton aus'}
          className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white/90 backdrop-blur hover:text-white"
        >
          {muted ? '🔇 Ton an' : '🔊 Ton aus'}
        </button>
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
