import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@whogooned/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: GameSocket = io({ withCredentials: true, autoConnect: true });

type AckResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Promise wrapper around an acked emit; rejects with the server's message. */
export function call<T = {}>(event: keyof ClientToServerEvents, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const ack = (res: AckResult<T>) => (res.ok ? resolve(res as T) : reject(new Error(res.error)));
    const s = socket.timeout(15_000) as unknown as { emit: (...a: unknown[]) => void };
    const cb = (err: Error | null, res: AckResult<T>) => (err ? reject(new Error('Keine Antwort vom Server')) : ack(res));
    if (payload === undefined) s.emit(event, cb);
    else s.emit(event, payload, cb);
  });
}
