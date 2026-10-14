// IndexedDB persistence: analysis cache keyed by the audio's SHA-256, and the last session
// (audio bytes, lyrics text, edited word timing/roles) so a reload can restore everything.
import type { Analysis, Lyrics } from './types';

const DB = 'lyric-engine', VER = 1;
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('analysis')) d.createObjectStore('analysis'); if (!d.objectStoreNames.contains('session')) d.createObjectStore('session'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const ANALYSIS_VERSION = 5;   // bump when the analysis changes
export async function getCachedAnalysis(hash: string): Promise<Analysis | null> {
  try { const v = await tx<{ v: number; a: Analysis } | undefined>('analysis', 'readonly', s => s.get(hash)); return v && v.v === ANALYSIS_VERSION ? v.a : null; } catch { return null; }
}
export async function putCachedAnalysis(hash: string, a: Analysis) {
  try { await tx('analysis', 'readwrite', s => s.put({ v: ANALYSIS_VERSION, a }, hash)); } catch { /* storage unavailable */ }
}

export interface Session { audioName: string; audio: ArrayBuffer; lyricsText: string; lyrics: Lyrics | null; title: string; artist: string; savedAt: number }
export async function saveSession(s: Session) { try { await tx('session', 'readwrite', st => st.put(s, 'last')); } catch { /* storage unavailable */ } }
export async function loadSession(): Promise<Session | null> { try { return (await tx<Session | undefined>('session', 'readonly', s => s.get('last'))) ?? null; } catch { return null; } }
