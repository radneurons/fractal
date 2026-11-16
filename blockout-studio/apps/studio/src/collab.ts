/** Collaboration: Yjs over the op stream, relayed by the bridge (`/collab`). Presence = awareness JSON (name, colour, 3D cursor). */
import { useSyncExternalStore } from 'react';
import { OpStream, Y } from '@blockout/pipeline';
import { ID_PALETTE, type Op } from '@blockout/core';
import { S, localOpListeners } from './store';

export interface Peer { id: string; name: string; color: string; cursor: [number, number, number] | null; at: number }
let peers: Peer[] = []; const subs = new Set<() => void>(); const emit = () => subs.forEach((f) => f());
interface Session { ws: WebSocket; stream: OpStream; me: Peer; off(): void }
let session: Session | null = null, lastCursor = 0, applyingRemote = false;
const BRIDGE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BRIDGE_URL ?? 'http://127.0.0.1:8787';

export const collab = {
  get room() { return session ? (session.ws.url.match(/room=([^&]+)/)?.[1] ?? null) : null; },
  get connected() { return !!session && session.ws.readyState === 1; },
  usePeers(): Peer[] { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => peers); },
  useStatus(): string { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => (session ? (session.ws.readyState === 1 ? `live in "${decodeURIComponent(collab.room ?? '')}" · ${peers.length} other${peers.length === 1 ? '' : 's'}` : 'connecting…') : 'offline')); },
  cursor(p: [number, number, number]) { if (!session || Date.now() - lastCursor < 60) return; lastCursor = Date.now(); session.me.cursor = p; session.ws.readyState === 1 && session.ws.send(JSON.stringify({ type: 'presence', peer: session.me })); },
  connect(room: string, name: string) {
    this.disconnect(); const id = Math.random().toString(36).slice(2, 9), me: Peer = { id, name: name || 'Guest', color: ID_PALETTE[(id.charCodeAt(0) + id.charCodeAt(1)) % ID_PALETTE.length], cursor: null, at: 0 };
    const doc = new Y.Doc(), ws = new WebSocket(`${BRIDGE.replace(/^http/, 'ws')}/collab?room=${encodeURIComponent(room)}`); ws.binaryType = 'arraybuffer';
    let seeded = false;
    const stream = new OpStream(id, doc, (p, remote) => { if (!remote && seeded) return; applyingRemote = true; S().set({ project: p }); applyingRemote = false; });
    doc.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote' && ws.readyState === 1) ws.send(u); });
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) { Y.applyUpdate(doc, new Uint8Array(e.data), 'remote'); if (!seeded) { seeded = true; const p = stream.init(S().project); applyingRemote = true; S().set({ project: p }); applyingRemote = false; S().notify(`Joined "${room}".`); } return; }
      const m = JSON.parse(e.data as string); if (m.type === 'presence' && m.peer.id !== id) { peers = [...peers.filter((p) => p.id !== m.peer.id), { ...m.peer, at: Date.now() }]; emit(); } if (m.type === 'leave') { peers = peers.filter((p) => Date.now() - p.at < 5000); emit(); }
    };
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'presence', peer: me })); emit(); }; ws.onclose = () => { emit(); };
    const listener = (op: Op) => { if (!applyingRemote && seeded) stream.push(op); };
    localOpListeners.add(listener);
    const beat = setInterval(() => { ws.readyState === 1 && ws.send(JSON.stringify({ type: 'presence', peer: me })); const before = peers.length; peers = peers.filter((p) => Date.now() - p.at < 8000); if (before !== peers.length) emit(); }, 3000);
    session = { ws, stream, me, off: () => { localOpListeners.delete(listener); clearInterval(beat); } }; emit();
  },
  disconnect() { if (!session) return; session.off(); session.ws.close(); session = null; peers = []; emit(); },
};
