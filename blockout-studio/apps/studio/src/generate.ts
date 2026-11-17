/** Studio side of generation: render passes, build the request, run it through the queue, store frames as assets, score it. */
import { create } from 'zustand';
import { newId, shotFrames, type Project, type Shot, type Take } from '@blockout/core';
import { decodePNG, encodePNG, idPalette, passSize, softRenderer, type PassName } from '@blockout/render';
import { GenerationQueue, getProvider, httpProvider, listProviders, scoreTake, mockProvider, type GenRequest, type Job, type ProviderPlugin } from '@blockout/pipeline';
import { activePrompt, compileShot } from '@blockout/prompting';
import { S } from './store';
import { assetUrl, getAsset, putAsset } from './persist';
import { exportRenderer } from './exporter';
import { onGenProgress, rpc, setTakeFrameResolver, useGateway } from './gateway';
import { claude } from './gateway';

export interface JobView { id: string; shotId: string; providerId: string; status: Job['status']; progress: number; note: string; estimate: number; takeId: string }
export const useJobs = create<{ jobs: JobView[]; httpConfigs: unknown[] }>(() => ({ jobs: [], httpConfigs: [] }));
const spent = (p: Project) => Object.values(p.takes).reduce((a, t) => a + t.cost, 0);
const queue: GenerationQueue = new GenerationQueue({ concurrency: 2, retries: 2, budget: () => ({ cap: S().project.budgetCap, spent: spent(S().project), committed: queue.committed() }), onChange: (j) => useJobs.setState((st) => ({ jobs: st.jobs.map((v) => (v.id === j.id ? { ...v, status: j.status, progress: j.progress, note: j.note } : v)) })) });

/** Providers visible in the studio: built-ins + the user's HTTP providers (configs come from the bridge; they run *in* the bridge). */
export function providers(kind: 'video' | 'image' | 'upscale' | 'interpolate' | 'inpaint' = 'video'): ProviderPlugin[] {
  const http = useJobs.getState().httpConfigs.map((c) => { try { const p = httpProvider(c); return { ...p, generate: (req: GenRequest, ctx: Parameters<ProviderPlugin['generate']>[1]) => viaBridge(c, req, ctx) } as ProviderPlugin; } catch { return null; } }).filter((p): p is ProviderPlugin => !!p && p.caps.kind === kind);
  return [...listProviders(kind), ...http];
}
export const loadHttpProviders = () => rpc<unknown[]>('providers.list').then((httpConfigs) => useJobs.setState({ httpConfigs })).catch(() => {});
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
async function viaBridge(config: unknown, req: GenRequest, ctx: Parameters<ProviderPlugin['generate']>[1]) {
  if (!useGateway.getState().connected) throw Object.assign(new Error('HTTP providers run in the bridge (keys stay there); start it with `pnpm bridge`'), { retryable: false });
  const jobId = newId('gen'); onGenProgress(jobId, ctx.onProgress);
  try { return await rpc<{ videoUrl: string; width: number; height: number; fps: number; cost: number }>('httpGenerate', { jobId, config, request: { ...req, passes: Object.fromEntries(Object.entries(req.passes).map(([k, v]) => [k, v.map(b64)])), firstFrame: req.firstFrame && b64(req.firstFrame), lastFrame: req.lastFrame && b64(req.lastFrame), keyframe: req.keyframe && b64(req.keyframe), mask: req.mask && b64(req.mask), source: req.source?.map(b64), references: req.references.map((r) => ({ ...r, image: r.image && b64(r.image) })) } }); } finally { onGenProgress(jobId, null); }
}
/** Which passes to render for a provider: the intersection of what it accepts with what we can make. */
export function passesFor(pr: ProviderPlugin): PassName[] { const ok: PassName[] = ['clay', 'depth', 'normals', 'id', 'pose', 'canny', 'flow', 'fx']; const want = pr.caps.controls.filter((c): c is PassName => (ok as string[]).includes(c)); return [...new Set<PassName>(['clay', ...want])]; }
export async function renderPasses(p: Project, shot: Shot, passes: PassName[], height: number, onProgress?: (f: number) => void): Promise<Record<string, Uint8Array[]>> {
  const R = exportRenderer(), [w, h] = passSize(p, height), n = shotFrames(p, shot), out: Record<string, Uint8Array[]> = {}; let done = 0;
  for (const pass of passes) { out[pass] = []; for (let f = 0; f < n; f++) { out[pass].push(encodePNG(R.render(p, shot, f, pass, w, h), w, h, 1)); if (++done % 6 === 0) { onProgress?.(done / (n * passes.length)); await new Promise((r) => setTimeout(r, 0)); } } }
  return out;
}
export function promptFor(p: Project, shot: Shot, pr: ProviderPlugin) { const v = activePrompt(p, shot.id, pr.dialect) ?? activePrompt(p, shot.id, 'canonical'); if (v) return { text: v.text, negative: v.negative ?? p.bibles.style.negative, versionId: v.id }; const c = compileShot(p, shot.id, pr.dialect); return { text: c.text, negative: c.negative || p.bibles.style.negative, versionId: undefined }; }

export interface GenOpts { seed?: number; height?: number; keyframeTakeId?: string; source?: Take; mask?: Uint8Array; parentTakeId?: string }
export function estimate(shot: Shot, pr: ProviderPlugin, height = 360) { const p = S().project, [w, h] = passSize(p, height), d = shot.end - shot.start; const e = pr.estimate({ duration: d, width: w, height: h, frames: shotFrames(p, shot) }); return { estimate: e, ...queue.estimate(pr, { duration: d, width: w, height: h, frames: shotFrames(p, shot) } as GenRequest).budget }; }
/** Generate a take. Resolves when finished; the take appears immediately as "queued". */
export async function generate(shotId: string, providerId: string, o: GenOpts = {}): Promise<Take | null> {
  const s = S(), p = s.project, shot = p.shots.find((x) => x.id === shotId), pr = providers(getProvider(providerId)?.caps.kind ?? 'video').concat(providers('image'), providers('upscale'), providers('interpolate'), providers('inpaint')).find((x) => x.id === providerId);
  if (!shot || !pr) { s.notify('Unknown shot or provider', 'error'); return null; }
  const height = Math.min(o.height ?? 360, pr.caps.maxHeight), [w, h] = passSize(p, height), seed = o.seed ?? ((p.seed * 1000 + Object.values(p.takes).filter((t) => t.shotId === shotId).length * 7919) % 2147483647), prompt = promptFor(p, shot, pr), takeId = newId('take');
  s.dispatch({ type: 'addTake', take: { id: takeId, shotId, providerId, promptVersionId: prompt.versionId, prompt: prompt.text, seed, status: 'queued', cost: 0, passes: [], passesHash: '', frames: [], fps: p.fps, width: w, height: h, circled: false, notes: '', at: Date.now(), parentTakeId: o.parentTakeId } }, { label: `Queue ${pr.name} take for ${shot.name}` });
  const fail = (msg: string) => { S().dispatch({ type: 'updateTake', id: takeId, patch: { status: 'failed', error: msg } }, { label: 'Take failed' }); S().notify(msg, 'error'); return null; };
  try {
    const passes = o.source ? ['clay' as PassName] : passesFor(pr), rendered = await renderPasses(p, shot, passes, height);
    const ref = idPalette(p).filter((e) => e.kind === 'character').map((e) => ({ color: e.color, name: e.name, description: e.description }));
    let keyframe: Uint8Array | undefined; if (o.keyframeTakeId) { const kt = p.takes[o.keyframeTakeId], blob = kt && (await getAsset(kt.frames[0])); if (blob) keyframe = new Uint8Array(await blob.arrayBuffer()); }
    const source = o.source ? await Promise.all(o.source.frames.map(async (id) => new Uint8Array(await (await getAsset(id))!.arrayBuffer()))) : undefined;
    const req: GenRequest = { shotId, prompt: prompt.text, negative: prompt.negative, seed, fps: p.fps, frames: shotFrames(p, shot), width: w, height: h, duration: shot.end - shot.start, passes: rendered, firstFrame: rendered.clay[0], lastFrame: rendered.clay[rendered.clay.length - 1], keyframe, palette: p.bibles.style.palette, references: ref, source, mask: o.mask };
    let enq: ReturnType<typeof queue.enqueue>; try { enq = queue.enqueue(pr, req); } catch (e) { return fail((e as Error).message); }
    useJobs.setState((st) => ({ jobs: [...st.jobs, { id: enq.job.id, shotId, providerId, status: 'queued', progress: 0, note: '', estimate: enq.job.estimate, takeId }] }));
    S().dispatch({ type: 'updateTake', id: takeId, patch: { status: 'running', passes } }, { label: 'Take running' });
    const job = await enq.done;
    if (job.status !== 'done' || !job.result) return job.status === 'cancelled' ? (S().dispatch({ type: 'updateTake', id: takeId, patch: { status: 'cancelled' } }), null) : fail(job.error ?? 'generation failed');
    let rawFrames = job.result.frames ?? [];
    if (!rawFrames.length && job.result.videoUrl) { try { rawFrames = await downloadFrames(job.result.videoUrl, p.fps, shotFrames(p, shot), h); } catch (e) { S().notify(`Take saved as a link only: ${(e as Error).message}`, 'error'); } }
    const frames: string[] = []; for (const [i, f] of rawFrames.entries()) { const id = `${takeId}_${String(i).padStart(4, '0')}.png`; await putAsset(id, new Blob([f as Uint8Array<ArrayBuffer>], { type: 'image/png' })); frames.push(id); }
    S().dispatch({ type: 'updateTake', id: takeId, patch: { status: 'done', cost: job.result.cost, frames, videoUrl: job.result.videoUrl, width: job.result.width, height: job.result.height, fps: job.result.fps } }, { label: `Take ready for ${shot.name}` });
    if (frames.length) void autoScore(takeId);
    return S().project.takes[takeId];
  } catch (e) { return fail((e as Error).message); }
}
export const cancelJob = (id: string) => queue.cancel(id);
/** Bring a provider's remote video home: download through the bridge, then decode frames at the project fps. */
export async function downloadFrames(url: string, fps: number, count: number, height: number): Promise<Uint8Array[]> {
  let blob: Blob; if (useGateway.getState().connected) { const r = await rpc<{ base64: string; contentType: string }>('fetchMedia', { url }), bin = atob(r.base64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); blob = new Blob([u8], { type: r.contentType }); } else blob = await (await fetch(url)).blob();
  return extractFrames(blob, fps, count, height);
}
export async function extractFrames(blob: Blob, fps: number, count: number, height: number): Promise<Uint8Array[]> {
  const url = URL.createObjectURL(blob), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('the video could not be decoded in this browser')); });
    const h = Math.min(height, v.videoHeight), w = Math.round((v.videoWidth * h) / v.videoHeight / 2) * 2, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true })!, out: Uint8Array[] = [];
    const n = Math.max(1, Math.min(count, Math.floor(v.duration * fps) || count));
    for (let i = 0; i < n; i++) { const t = Math.min(v.duration - 0.001, (i + 0.5) / fps); await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = t; }); g.drawImage(v, 0, 0, w, h); const b = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png')); out.push(new Uint8Array(await b!.arrayBuffer())); }
    return out;
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); }
}
if (typeof window !== 'undefined') Object.assign(((window as unknown as Record<string, object>).__blockout ??= {}), { generate, loadHttpProviders });
/** Numeric adherence score (mask IoU, flicker, palette) — runs locally after every take. */
export async function autoScore(takeId: string) {
  const p = S().project, t = p.takes[takeId], shot = p.shots.find((x) => x.id === t?.shotId); if (!t || !shot || !t.frames.length) return;
  const res = await Promise.all(t.frames.map(async (id) => decodePNG(new Uint8Array(await (await getAsset(id))!.arrayBuffer())))), n = shotFrames(p, shot), [w, h] = passSize(p, res[0].height), picks = [0, n >> 1, n - 1];
  const ids = picks.map((f) => ({ width: w, height: h, data: softRenderer.render(p, shot, f, 'id', w, h) })), clay = picks.map((f) => ({ width: w, height: h, data: softRenderer.render(p, shot, f, 'clay', w, h) }));
  const sc = await scoreTake(ids, clay, [res[0], res[res.length >> 1], res[res.length - 1]], idPalette(p), p.bibles.style.palette);
  S().dispatch({ type: 'updateTake', id: takeId, patch: { iou: Math.round(sc.iou * 1000) / 1000 } }, { label: 'Score take' }); return sc;
}
/** Vision critique: sampled blockout + result frames go to Claude; a numeric fallback when no vision backend is available. */
export async function critique(takeId: string) {
  const p = S().project, t = p.takes[takeId], shot = p.shots.find((x) => x.id === t?.shotId); if (!t || !shot) return;
  const sc = (await autoScore(takeId)) ?? { iou: t.iou ?? 0.5 }, n = t.frames.length, idx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].filter((v, i, a) => a.indexOf(v) === i && v >= 0), [w, h] = passSize(p, 270);
  const images = (await Promise.all(idx.map(async (f) => { const blk = encodePNG(softRenderer.render(p, shot, Math.round((f / Math.max(1, n - 1)) * (shotFrames(p, shot) - 1)), 'clay', w, h), w, h), res = new Uint8Array(await (await getAsset(t.frames[f]))!.arrayBuffer()); return [{ label: `Blockout frame ${f}`, mediaType: 'image/png' as const, base64: b64(blk) }, { label: `Result frame ${f} (same time)`, mediaType: 'image/png' as const, base64: b64(res) }]; }))).flat();
  for (const c of Object.values(p.characters)) for (const id of p.bibles.characters[c.id]?.refImages ?? []) { const b = await getAsset(id); if (b) images.push({ label: `Reference sheet: ${c.name}`, mediaType: (b.type === 'image/jpeg' ? 'image/jpeg' : 'image/png') as 'image/png', base64: b64(new Uint8Array(await b.arrayBuffer())) }); }
  try { const r = await claude('critique', { shotId: shot.id, takeId, metrics: sc }, { images, label: 'Critiquing take' }); S().dispatch({ type: 'updateTake', id: takeId, patch: { critique: r.value } }, { label: 'Critique take' }); S().say('claude', `${shot.name}, seed ${t.seed}: ${r.value.summary}`); return r.value; }
  catch (e) { S().notify(`Critique failed: ${(e as Error).message}`, 'error'); }
}
export const frameUrl = (id?: string) => assetUrl(id);
setTakeFrameResolver(async (takeId, frame) => { const t = S().project.takes[takeId], b = t && (await getAsset(t.frames[frame])); if (!b) throw new Error('frame not stored'); return b64(new Uint8Array(await b.arrayBuffer())); });
export { mockProvider };
