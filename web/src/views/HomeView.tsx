import { motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { Button, Logo, Panel } from '../components/ui';
import { useGame } from '../hooks/useGame';
import { storage } from '../lib/storage';

export function HomeView() {
  const { createRoom, joinRoom, toast } = useGame();
  const pathCode = location.pathname.match(/^\/room\/([A-Z0-9]{4,6})/i)?.[1]?.toUpperCase() ?? '';
  const [name, setName] = useState(storage.getName());
  const [code, setCode] = useState(pathCode);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (!name.trim()) return toast('Gib zuerst einen Namen ein.', 'error');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.length < 4) return toast('Raumcode hat 4–6 Zeichen.', 'error');
    void run(() => joinRoom(code, name.trim()));
  };

  return (
    <div className="flex min-h-[85vh] flex-col items-center justify-center gap-10">
      <motion.div initial={{ scale: 0.8, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.5 }} className="text-center">
        <Logo size="lg" />
        <p className="mt-4 text-lg text-muted">Wer von euch hat <em className="text-white not-italic">dieses</em> Video geliked?</p>
      </motion.div>

      <Panel className="w-full max-w-md space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Dein Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            placeholder="z. B. Lena"
            className="w-full rounded-2xl border border-line bg-ink px-4 py-3 text-lg outline-none focus:border-ice"
            autoFocus={!pathCode}
          />
        </label>

        <form onSubmit={onJoin} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="CODE"
            aria-label="Raumcode"
            className="font-display w-0 flex-1 rounded-2xl border border-line bg-ink px-4 py-3 text-center text-2xl font-bold tracking-[0.3em] uppercase outline-none focus:border-ice"
            autoFocus={Boolean(pathCode)}
          />
          <Button type="submit" variant="ice" disabled={busy}>
            Beitreten
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-line" />
          oder
          <div className="h-px flex-1 bg-line" />
        </div>

        <Button className="w-full text-lg" disabled={busy} onClick={() => run(() => createRoom(name.trim()))}>
          Neuen Raum erstellen
        </Button>
      </Panel>

      <p className="max-w-md text-center text-xs text-muted">
        Keine Daten werden gespeichert: Räume, Videos und TikTok-Zugänge verfallen automatisch, wenn das Spiel endet oder nach 2 Stunden Inaktivität.
      </p>
    </div>
  );
}
