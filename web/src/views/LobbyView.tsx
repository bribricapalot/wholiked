import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_EXPORT_LINKS, SETTINGS_LIMITS, type PublicPlayer, type RoomSettings, type VideoSubmission } from '@whogooned/shared';
import { Avatar, Button, Logo, Panel, StatusBadge } from '../components/ui';
import { useGame } from '../hooks/useGame';
import { call } from '../lib/socket';
import { parseTikTokExport, sampleForGame } from '../lib/tiktokExport';

export function LobbyView() {
  const { room, me, isHost, leaveRoom, toast } = useGame();
  if (!room || !me) return null;

  const humans = room.players.filter((p) => !p.isBot && p.connected);
  const waitingFor = humans.filter((p) => p.id !== room.hostId && p.status !== 'READY');
  const enoughPlayers = room.players.filter((p) => p.connected).length >= 2;

  const start = () => call('game:start').catch((e) => toast(e.message, 'error'));
  const toggleReady = () => call('player:ready', { ready: me.status !== 'READY' }).catch((e) => toast(e.message, 'error'));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <Button variant="ghost" className="px-3 py-2 text-sm" onClick={leaveRoom}>
          Verlassen
        </Button>
      </header>

      <RoomCodeBadge code={room.code} />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <PlayerList />
          {isHost && <HostSettingsPanel settings={room.settings} />}
        </div>
        <VideoSubmissionPanel />
      </div>

      <div className="sticky bottom-4 z-10">
        <Panel className="flex flex-wrap items-center justify-between gap-3 border-hot/30">
          <p className="text-sm text-muted">
            {!enoughPlayers
              ? 'Warte auf mindestens einen weiteren Spieler – oder aktiviere Bots.'
              : waitingFor.length
                ? `Warte auf: ${waitingFor.map((p) => p.name).join(', ')}`
                : 'Alle bereit! 🎉'}
          </p>
          {isHost ? (
            <Button onClick={start} disabled={!enoughPlayers || waitingFor.length > 0} className="text-lg">
              Spiel starten
            </Button>
          ) : (
            <Button variant={me.status === 'READY' ? 'ghost' : 'ice'} onClick={toggleReady} className="text-lg">
              {me.status === 'READY' ? 'Doch nicht bereit' : 'Bereit!'}
            </Button>
          )}
        </Panel>
      </div>
    </div>
  );
}

function RoomCodeBadge({ code }: { code: string }) {
  const { toast } = useGame();
  const link = `${location.origin}/room/${code}`;
  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'WhoGooned?', url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast('Einladungslink kopiert!', 'success');
      }
    } catch {}
  };
  return (
    <button onClick={copy} className="group mx-auto block text-center">
      <span className="text-sm text-muted">Raumcode – tippen zum Teilen</span>
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.55 }}
        className="font-display text-stroke block text-7xl font-extrabold tracking-[0.2em] group-hover:text-ice sm:text-8xl"
      >
        {code}
      </motion.span>
    </button>
  );
}

function PlayerList() {
  const { room, me, isHost, toast } = useGame();
  if (!room) return null;
  const kick = (p: PublicPlayer) => call('room:kick', { playerId: p.id }).catch((e) => toast(e.message, 'error'));
  return (
    <Panel>
      <h2 className="font-display mb-4 text-xl font-bold">
        Spieler <span className="text-muted">{room.players.length}</span>
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        <AnimatePresence>
          {room.players.map((p) => (
            <motion.li
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: p.connected ? 1 : 0.45, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={`flex items-center gap-3 rounded-2xl border bg-panel-2 p-3 ${p.id === me?.id ? 'border-ice/50' : 'border-transparent'}`}
            >
              <Avatar player={p} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate font-semibold">
                  {p.name}
                  {p.isHost && <span title="Host">👑</span>}
                  {p.tiktokHandle && <span title={`TikTok: ${p.tiktokHandle}`}>🎵</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <StatusBadge player={p} />
                  <span className="text-xs text-muted">{p.videoCount} 🎬</span>
                </div>
              </div>
              {isHost && !p.isBot && p.id !== me?.id && (
                <button onClick={() => kick(p)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-hot/20 hover:text-hot" title="Entfernen">
                  ✕
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}

function HostSettingsPanel({ settings }: { settings: RoomSettings }) {
  const { toast } = useGame();
  const update = (p: Partial<RoomSettings>) => call('room:settings', p).catch((e) => toast(e.message, 'error'));
  const L = SETTINGS_LIMITS;
  return (
    <Panel className="space-y-4">
      <h2 className="font-display text-xl font-bold">Einstellungen</h2>
      <Slider label="Sekunden pro Runde" value={settings.roundSeconds} {...L.roundSeconds} step={5} onCommit={(v) => update({ roundSeconds: v })} />
      <Slider label="Videos pro Spieler" value={settings.videosPerPlayer} {...L.videosPerPlayer} onCommit={(v) => update({ videosPerPlayer: v })} />
      <Slider label="Bots (mit Demo-Videos)" value={settings.botCount} {...L.botCount} onCommit={(v) => update({ botCount: v })} />
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
        <span>Für sich selbst stimmen erlaubt</span>
        <input type="checkbox" checked={settings.allowSelfVote} onChange={(e) => update({ allowSelfVote: e.target.checked })} className="size-5 accent-hot" />
      </label>
    </Panel>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  // Debounced commit so dragging/holding an arrow key sends one update.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      if (v !== value) onCommit(v);
    }, 350);
    return () => clearTimeout(t);
  }, [v, value, onCommit]);
  return (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-display font-bold text-ice">{v}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          dirty.current = true;
          setV(Number(e.target.value));
        }}
        className="mt-2 w-full"
      />
    </label>
  );
}

function VideoSubmissionPanel() {
  const { me, room, tiktokEnabled, toast } = useGame();
  const [text, setText] = useState('');
  const [videos, setVideos] = useState<VideoSubmission[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    call<{ videos: VideoSubmission[] }>('player:listVideos')
      .then((r) => setVideos(r.videos))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh, me?.videoCount]);

  const submit = async () => {
    const urls = text.split(/[\s,]+/).filter((u) => u.includes('tiktok.com'));
    if (!urls.length) return toast('Füge mindestens einen TikTok-Link ein.', 'error');
    setBusy(true);
    try {
      const r = await call<{ accepted: VideoSubmission[]; rejected: { url: string; reason: string }[] }>('player:submitLinks', { urls });
      if (r.accepted.length) toast(`${r.accepted.length} Video(s) hinzugefügt`, 'success');
      if (r.rejected.length) toast(`${r.rejected.length} abgelehnt: ${r.rejected[0].reason}`, 'error');
      setText(r.rejected.map((x) => x.url).join('\n'));
      refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const importTikTok = async () => {
    setBusy(true);
    try {
      const r = await call<{ imported: number }>('player:importTikTok');
      toast(r.imported ? `${r.imported} eigene Videos importiert` : 'Keine neuen Videos gefunden', r.imported ? 'success' : 'info');
      refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCount = videos.filter((v) => v.source === 'export').length;
  const clearExport = () =>
    call('player:clearExport')
      .then(refresh)
      .catch((e) => toast(e.message, 'error'));

  const remove = (videoId: string) =>
    call('player:removeVideo', { videoId })
      .then(refresh)
      .catch((e) => toast(e.message, 'error'));

  if (!me || !room) return null;
  return (
    <Panel className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">Deine Likes</h2>
        <p className="mt-1 text-sm text-muted">Die anderen sehen nur die Anzahl, nie die Videos selbst.</p>
      </div>

      <ExportImport busy={busy} setBusy={setBusy} onDone={refresh} />

      <details className="group rounded-2xl border border-line bg-panel-2 p-4">
        <summary className="cursor-pointer text-sm font-semibold select-none">Oder einzelne Links einfügen</summary>
        <p className="mt-2 text-sm text-muted">
          TikTok → Profil → <b className="text-white">❤️ Gelikt</b> → Video → <b className="text-white">Teilen → Link kopieren</b>
        </p>
        <div className="mt-3 space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={'https://vm.tiktok.com/…\nhttps://www.tiktok.com/@user/video/…'}
        className="w-full resize-y rounded-2xl border border-line bg-ink px-4 py-3 font-mono text-sm outline-none focus:border-ice"
      />
      <Button variant="ice" className="w-full" onClick={submit} disabled={busy || !text.trim()}>
        {busy ? 'Prüfe…' : 'Links hinzufügen'}
      </Button>
        </div>
      </details>

      {tiktokEnabled && (
        <div className="rounded-2xl border border-line bg-panel-2 p-4">
          {me.tiktokHandle ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm">
                Verbunden als <b>{me.tiktokHandle}</b>
              </span>
              <Button variant="ghost" className="px-3 py-2 text-sm" onClick={importTikTok} disabled={busy}>
                Eigene Posts importieren
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">Mit TikTok verbinden für Avatar & eigene Posts</span>
              <a
                href={`/auth/tiktok/login?returnTo=${encodeURIComponent(`/room/${room.code}`)}`}
                className="font-display rounded-2xl bg-white px-4 py-2 text-sm font-bold text-ink hover:brightness-90"
              >
                Mit TikTok verbinden
              </a>
            </div>
          )}
        </div>
      )}

      <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {exportCount > 0 && (
            <motion.li
              key="export"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex items-center gap-2 rounded-xl bg-hot/10 px-3 py-2 text-sm ring-1 ring-hot/30"
            >
              <span>📦</span>
              <span className="flex-1">
                <b>{exportCount}</b> Likes aus deinem Datenexport
              </span>
              <button onClick={clearExport} className="rounded px-1.5 text-muted hover:text-hot" aria-label="Export entfernen">
                ✕
              </button>
            </motion.li>
          )}
          {videos.filter((v) => v.source !== 'export').map((v) => (
            <motion.li
              key={v.videoId}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-sm"
            >
              <span>{v.source === 'tiktok_api' ? '📤' : '❤️'}</span>
              <a href={v.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-muted hover:text-white">
                {v.url.replace('https://www.', '')}
              </a>
              <button onClick={() => remove(v.videoId)} className="rounded px-1.5 text-muted hover:text-hot" aria-label="Entfernen">
                ✕
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
        {!videos.length && <li className="py-4 text-center text-sm text-muted">Noch keine Videos.</li>}
      </ul>
    </Panel>
  );
}

function ExportImport({ busy, setBusy, onDone }: { busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const { toast } = useGame();
  const [dragOver, setDragOver] = useState(false);
  const [includeFavorites, setIncludeFavorites] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseTikTokExport(file);
      const pool = [...parsed.likes, ...parsed.reposts, ...(includeFavorites ? parsed.favorites : [])];
      if (!pool.length) {
        toast('Keine Likes in der Datei gefunden. Hast du beim Export „Aktivität“ mit ausgewählt?', 'error');
        return;
      }
      // Dedupe across categories, newest first.
      const seen = new Set<string>();
      const unique = pool
        .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
        .filter((i) => !seen.has(i.videoId) && seen.add(i.videoId));
      const urls = sampleForGame(unique, MAX_EXPORT_LINKS);
      const r = await call<{ accepted: unknown[] }>('player:submitLinks', { urls, source: 'export' });
      const found = [
        `${parsed.likes.length} Likes`,
        parsed.favorites.length ? `${parsed.favorites.length} Favoriten` : '',
        parsed.reposts.length ? `${parsed.reposts.length} Reposts` : '',
      ].filter(Boolean);
      toast(`${found.join(', ')} gefunden – ${r.accepted.length} kommen in den Pool`, 'success');
      onDone();
    } catch (e) {
      toast(`Datei konnte nicht gelesen werden: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
        className={`w-full rounded-2xl border-2 border-dashed p-6 text-center transition ${
          dragOver ? 'border-ice bg-ice/10' : 'border-hot/50 bg-hot/5 hover:bg-hot/10'
        }`}
      >
        <div className="text-4xl">📦</div>
        <div className="font-display mt-2 text-lg font-bold">{busy ? 'Lese Export…' : 'TikTok-Datenexport hierher ziehen'}</div>
        <div className="text-sm text-muted">oder klicken · .zip, .json oder .txt</div>
      </button>
      <input ref={input} type="file" accept=".zip,.json,.txt,application/zip,application/json,text/plain" hidden onChange={(e) => handleFile(e.target.files?.[0])} />

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={includeFavorites} onChange={(e) => setIncludeFavorites(e.target.checked)} className="size-4 accent-hot" />
        Favoriten (🔖) auch verwenden
      </label>

      <details className="rounded-2xl bg-panel-2 p-4 text-sm">
        <summary className="cursor-pointer font-semibold select-none">So bekommst du deinen Export</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>TikTok → Profil → ☰ → <b className="text-white">Einstellungen und Datenschutz</b></li>
          <li><b className="text-white">Konto → Deine Daten herunterladen</b></li>
          <li>Format <b className="text-white">JSON</b> wählen, mindestens <b className="text-white">Aktivität</b> auswählen → Daten anfordern</li>
          <li>Wenn fertig (dauert meist Minuten bis Stunden): Tab „Daten herunterladen“ → ZIP laden und hier reinziehen</li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          🔒 Die Datei wird nur in deinem Browser gelesen. An den Server gehen ausschließlich bis zu {MAX_EXPORT_LINKS} zufällige Video-Links aus
          deinen Likes – keine Nachrichten, kein Verlauf, nichts anderes. Sie verfallen mit dem Raum.
        </p>
      </details>
    </div>
  );
}
