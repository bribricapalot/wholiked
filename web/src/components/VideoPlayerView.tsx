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
  const [muted, setMuted] = useState(false);
  // Photo slideshows: TikTok's own arrows are cropped off, so we drive them via navigateTo.
  // The player gives no image count, so "next" is disabled once a step no longer changes the image.
  const [slide, setSlide] = useState<{ cardId: string; index: number; atEnd: boolean } | null>(null);
  const slideshow = slide?.cardId === card.cardId ? slide : null;
  const pendingNext = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frame = useRef<HTMLIFrameElement>(null);

  const send = (type: string, value?: number) =>
    frame.current?.contentWindow?.postMessage({ type, value, 'x-tiktok-player': true }, '*');

  // The TikTok embed player posts events to the parent window (onPlayerReady, onStateChange,
  // onPlayerError …). The video stays hidden until it is ready; an error or timeout means it's gone.
  useEffect(() => {
    setMuted(false);
    if (card.kind !== 'tiktok') return;
    const id = card.cardId;
    const setBroken = () => setBrokenId(id);
    const timeout = setTimeout(setBroken, READY_TIMEOUT_MS);
    const post = (type: string, value?: number) =>
      frame.current?.contentWindow?.postMessage({ type, value, 'x-tiktok-player': true }, '*');
    // Start with sound. Browsers allow that once the player has clicked something on the page
    // (joining, voting …); if it's blocked anyway, fall back to muted so the video still plays.
    let mutedFallback: ReturnType<typeof setTimeout> | undefined;
    const playMuted = () => {
      clearTimeout(mutedFallback);
      setMuted(true);
      post('mute');
      post('play');
    };
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
      if (type === 'onPlayerError') {
        // 3002 = the browser blocked autoplay with sound. The video is fine: retry muted.
        if ((value as { errorCode?: unknown })?.errorCode === 3002) return playMuted();
        clearTimeout(timeout);
        setBroken();
      } else if (type === 'onPlayerReady') {
        clearTimeout(timeout);
        setReadyId(id);
        // With controls=0 there is no play button of TikTok's, so playback is started from here.
        post('unMute');
        post('play');
        mutedFallback = setTimeout(playMuted, 2_000); // cleared once it is actually playing
        // Only image posts answer this with onImageChange, which is how slideshows are detected.
        post('navigateTo', 0);
      } else if (type === 'onStateChange') {
        if (value === 1) clearTimeout(mutedFallback);
        // Pausing isn't allowed: whatever paused or ended it, keep it running.
        else if (value === 2 || value === 0) post('play');
      } else if (type === 'onImageChange') {
        clearTimeout(pendingNext.current);
        setSlide({ cardId: id, index: Number(value) || 0, atEnd: false });
      } else if (type === 'onMute') {
        setMuted(Boolean(value));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timeout);
      clearTimeout(mutedFallback);
      clearTimeout(pendingNext.current);
      window.removeEventListener('message', onMessage);
    };
  }, [card.cardId, card.kind]);

  const prevImage = () => slideshow && slideshow.index > 0 && send('navigateTo', slideshow.index - 1);
  const nextImage = () => {
    if (!slideshow || slideshow.atEnd) return;
    send('navigateTo', slideshow.index + 1);
    clearTimeout(pendingNext.current);
    pendingNext.current = setTimeout(() => setSlide((s) => (s && s.cardId === slideshow.cardId ? { ...s, atEnd: true } : s)), 1000);
  };

  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (broken && onBroken && reported.current !== card.cardId) {
      reported.current = card.cardId;
      onBroken();
    }
  }, [broken, onBroken, card.cardId]);

  const toggleSound = () => {
    send(muted ? 'unMute' : 'mute');
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

      {/* Swallows clicks so the video can't be paused by tapping it inside TikTok's player. */}
      <div className="absolute inset-0" />
      {ready && !broken && slideshow && (
        <>
          <SlideArrow side="left" disabled={slideshow.index === 0} onClick={prevImage} />
          <SlideArrow side="right" disabled={slideshow.atEnd} onClick={nextImage} />
        </>
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

function SlideArrow({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Vorheriges Bild' : 'Nächstes Bild'}
      className={`absolute top-1/2 ${side === 'left' ? 'left-3' : 'right-3'} grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-2xl text-white/90 backdrop-blur transition hover:scale-110 hover:text-white disabled:pointer-events-none disabled:opacity-25`}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}
