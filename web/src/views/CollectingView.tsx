import { motion } from 'motion/react';
import { Avatar, Panel, StatusBadge } from '../components/ui';
import { useGame } from '../hooks/useGame';

export function CollectingView() {
  const { room } = useGame();
  if (!room) return null;
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-8">
      <motion.div animate={{ rotate: [0, -8, 8, 0], scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} className="text-7xl">
        🎬
      </motion.div>
      <div className="text-center">
        <h1 className="font-display text-4xl font-extrabold">Mische das Deck…</h1>
        <p className="mt-2 text-muted">Videos werden geprüft, gelöschte aussortiert und alles gemischt.</p>
      </div>
      <Panel className="w-full max-w-md">
        <ul className="space-y-2">
          {room.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <Avatar player={p} size={36} />
              <span className="flex-1 font-medium">{p.name}</span>
              <StatusBadge player={p} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
