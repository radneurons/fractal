// Minimal promise wrapper over IndexedDB (stores: projects, blobs, analysis, misc).
const DB = 'lyric-engine-pro', VERSION = 3;
export const STORES = ['projects', 'blobs', 'analysis', 'misc'] as const;
export type StoreName = (typeof STORES)[number];
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}
function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => resolve(rq.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
export const idbGet = <T>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbSet = (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key));
export const idbDel = (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
export const idbKeys = (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
export const idbAll = <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const idbClear = (store: StoreName) => tx(store, 'readwrite', (s) => s.clear());
