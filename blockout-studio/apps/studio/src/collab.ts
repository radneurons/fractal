/** Collaboration facade. Phase 6 swaps in the Yjs implementation via `collab.impl`. */
import { useSyncExternalStore } from 'react';
export interface Peer { id: string; name: string; color: string; cursor: [number, number, number] | null }
type Impl = { cursor(p: [number, number, number]): void; disconnect(): void };
let peers: Peer[] = []; const subs = new Set<() => void>();
export const collab = {
  impl: null as Impl | null, room: null as string | null,
  setPeers(p: Peer[]) { peers = p; subs.forEach((f) => f()); },
  cursor(p: [number, number, number]) { this.impl?.cursor(p); },
  usePeers(): Peer[] { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => peers); },
};
