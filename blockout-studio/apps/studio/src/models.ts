/** Imported GLB models: stored as assets (IndexedDB / .blockout file), registered with the renderer, placed as props. */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { newId, nextIdColor, type Vec3 } from '@blockout/core';
import { modelRegistry } from '@blockout/render';
import { S, useStudio } from './store';
import { getAsset, putAsset } from './persist';

const loading = new Map<string, Promise<{ size: [number, number, number] } | null>>();
export function ensureModel(assetId: string) {
  let p = loading.get(assetId);
  if (!p) { p = (async () => { const blob = await getAsset(assetId); if (!blob) return null; const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), ''); return modelRegistry.register(assetId, gltf.scene); })().catch((e) => { S().notify(`Could not load model: ${(e as Error).message}`, 'error'); return null; }); loading.set(assetId, p); }
  return p;
}
/** Import a .glb file as a prop. Its bounding box becomes the prop's scale, so the proxy used by every pass matches the model. */
export async function importGLB(file: File, at: Vec3 = [0, 0, 0]): Promise<string | null> {
  const id = `glb_${Date.now().toString(36)}_${file.name.replace(/[^\w.]/g, '_')}`; await putAsset(id, file);
  const r = await ensureModel(id); if (!r) return null; const p = S().project, pid = newId('prop'), r3 = (v: number) => Math.round(v * 1000) / 1000;
  S().dispatch({ type: 'addProp', prop: { id: pid, name: file.name.replace(/\.glb$/i, ''), kind: 'glb', assetId: id, pos: at, rot: [0, 0, 0], scale: r.size.map(r3) as Vec3, idColor: nextIdColor(p) } }, { label: `Import model ${file.name}` });
  S().select({ kind: 'prop', id: pid }); return pid;
}
/** Make sure every model the project references is loaded (after recovery, opening a file, or a collaborator's edit). */
export function startModelSync() { const run = () => { for (const pr of Object.values(S().project.props)) if (pr.kind === 'glb' && pr.assetId && !modelRegistry.map.has(pr.assetId)) void ensureModel(pr.assetId).then(() => S().set({ project: { ...S().project } })); }; run(); return useStudio.subscribe((s, prev) => { if (s.project.props !== prev.project.props) run(); }); }
if (typeof window !== 'undefined') Object.assign(((window as unknown as Record<string, object>).__blockout ??= {}), { modelCount: () => modelRegistry.map.size });
