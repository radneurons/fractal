/** Autosave to IndexedDB (crash recovery) + portable .blockout files (zip: project.json, changelog.md, assets/). */
import { get, set, del, keys } from 'idb-keyval';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { ProjectS, type Project } from '@blockout/core';
import { S, useStudio, type LogEntry } from './store';

const KEY = 'blockout:autosave', ASSET = 'blockout:asset:';
export const assetUrls = new Map<string, string>();
export async function putAsset(id: string, blob: Blob) { await set(ASSET + id, blob); assetUrls.set(id, URL.createObjectURL(blob)); }
export async function getAsset(id: string): Promise<Blob | undefined> { return get(ASSET + id); }
export function assetUrl(id?: string): string | undefined { return id ? (assetUrls.get(id) ?? (/^(data|blob|https?):/.test(id) ? id : undefined)) : undefined; }
export async function loadAssets() { for (const k of await keys()) if (typeof k === 'string' && k.startsWith(ASSET)) { const b = await get<Blob>(k); if (b) assetUrls.set(k.slice(ASSET.length), URL.createObjectURL(b)); } }

export const changeLogMarkdown = (name: string, log: LogEntry[]) => `# ${name} — change log\n\n` + log.map((l) => `- ${new Date(l.at).toISOString().replace('T', ' ').slice(0, 19)} · **${l.author}** · ${l.label}`).join('\n') + '\n';
let timer: ReturnType<typeof setTimeout> | null = null;
export function startAutosave() {
  return useStudio.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { const st = S(); set(KEY, { project: st.project, changeLog: st.changeLog, savedAt: Date.now(), clean: false }).then(() => S().set({ savedAt: Date.now() })).catch(() => {}); }, 600);
  });
}
export async function recover(): Promise<boolean> {
  try {
    await loadAssets(); const saved = await get<{ project: unknown; changeLog: LogEntry[]; savedAt: number }>(KEY); if (!saved) return false;
    const p = ProjectS.safeParse(saved.project); if (!p.success) return false;
    S().load(p.data, saved.changeLog ?? []); S().set({ savedAt: saved.savedAt }); return true;
  } catch { return false; }
}
export const clearAutosave = () => del(KEY);

export async function exportBlockout(): Promise<Uint8Array> {
  const s = S(), files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(s.project, null, 1)), 'changelog.md': strToU8(changeLogMarkdown(s.project.name, s.changeLog)), 'changelog.json': strToU8(JSON.stringify(s.changeLog)) };
  for (const k of await keys()) if (typeof k === 'string' && k.startsWith(ASSET)) { const b = await get<Blob>(k); if (b) files['assets/' + k.slice(ASSET.length)] = new Uint8Array(await b.arrayBuffer()); }
  return zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}
export async function importBlockout(bytes: Uint8Array): Promise<Project> {
  const z = unzipSync(bytes); if (!z['project.json']) throw new Error('Not a .blockout file (project.json missing)');
  const project = ProjectS.parse(JSON.parse(strFromU8(z['project.json'])));
  for (const [name, data] of Object.entries(z)) if (name.startsWith('assets/') && data.length) await putAsset(name.slice(7), new Blob([data as Uint8Array<ArrayBuffer>]));
  S().load(project, z['changelog.json'] ? JSON.parse(strFromU8(z['changelog.json'])) : []);
  return project;
}
