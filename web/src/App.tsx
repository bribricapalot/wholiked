import { AnimatePresence, motion } from 'motion/react';
import { Toasts } from './components/ui';
import { useGame } from './hooks/useGame';
import { CollectingView } from './views/CollectingView';
import { GameOverView } from './views/GameOverView';
import { HomeView } from './views/HomeView';
import { LeaderboardView } from './views/LeaderboardView';
import { LobbyView } from './views/LobbyView';
import { RevealView } from './views/RevealView';
import { RoundView } from './views/RoundView';

function Screen() {
  const { room, rejoining, result, gameOver } = useGame();
  if (!room) {
    if (rejoining) return <div className="grid min-h-screen place-items-center text-muted">Verbinde…</div>;
    return <HomeView />;
  }
  switch (room.phase) {
    case 'LOBBY':
      return <LobbyView />;
    case 'COLLECTING':
      return <CollectingView />;
    case 'ROUND_ACTIVE':
      return <RoundView />;
    case 'ROUND_REVEAL':
      return result ? <RevealView /> : <LeaderboardView />;
    case 'LEADERBOARD':
      return <LeaderboardView />;
    case 'GAME_OVER':
      return gameOver ? <GameOverView /> : <LeaderboardView />;
  }
}

export function App() {
  const { room, connected } = useGame();
  const key = room ? `${room.phase}-${room.round?.index ?? ''}` : 'home';
  return (
    <>
      <Toasts />
      {!connected && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-hot py-1.5 text-center text-sm font-medium">Verbindung unterbrochen – verbinde neu…</div>
      )}
      <AnimatePresence mode="wait">
        <motion.main
          key={key}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 sm:py-10"
        >
          <Screen />
        </motion.main>
      </AnimatePresence>
    </>
  );
}
