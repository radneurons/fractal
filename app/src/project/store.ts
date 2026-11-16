// Project store (SPEC §12.1): IndexedDB with blobs de-duplicated by SHA-256, autosave and quota handling.
import { idbGet, idbSet, idbDel, idbAll, idbKeys } from './idb.ts';
import type { ProjectDoc } from './zip.ts';

export interface ProjectRecord { id: string; doc: ProjectDoc; audioHash: string; mediaHashes: Record<string, string>; duration: number; thumbnail?: Blob }

export async function saveProject(rec: ProjectRecord, audio: Blob | null, media: Record<string, Blob> = {}): Promise<void> {
  if (audio && rec.audioHash && !(await idbGet('blobs', rec.audioHash))) await idbSet('blobs', rec.audioHash, audio);
  for (const [id, blob] of Object.entries(media)) { const hsh = rec.mediaHashes[id]; if (hsh && !(await idbGet('blobs', hsh))) await idbSet('blobs', hsh, blob); }
  await idbSet('projects', rec.id, rec);
  try { await idbSet('misc', 'lastProject', rec.id); } catch { /* */ }
}
export const loadProject = (id: string) => idbGet<ProjectRecord>('projects', id);
export const loadBlob = (hash: string) => idbGet<Blob>('blobs', hash);
export async function listProjects(): Promise<ProjectRecord[]> { return (await idbAll<ProjectRecord>('projects')).sort((a, b) => b.doc.modified - a.doc.modified); }
export async function deleteProject(id: string): Promise<void> {
  await idbDel('projects', id);
  // drop blobs no other project references
  const rest = await idbAll<ProjectRecord>('projects');
  const used = new Set<string>();
  for (const r of rest) { used.add(r.audioHash); Object.values(r.mediaHashes).forEach((x) => used.add(x)); }
  for (const k of await idbKeys('blobs')) if (!used.has(String(k))) await idbDel('blobs', String(k));
}
export const lastProjectId = () => idbGet<string>('misc', 'lastProject');

export async function storageInfo(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  const est = (await navigator.storage?.estimate?.()) ?? { usage: 0, quota: 0 };
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}
/** ask for persistent storage on the first save */
export async function requestPersistence(): Promise<boolean> { try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; } }
