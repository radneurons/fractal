/** Shot package: the deterministic bundle a video model consumes. Same project + shot + seed => byte-identical zip. */
import { strToU8, zipSync } from 'fflate';
import { shotFacts, shotFrames, hashOf, type Project, type Shot } from '@blockout/core';
import { encodePNG, hashBytes, resize, stamp, type Image } from './png';
import { PASS_INFO, cameraData, flowMaxDisp, passSize, shotCamera, shotTime, DEPTH_FAR, DEPTH_NEAR, type PassName, type PassRenderer } from './passes';
import { openPoseJSON, poseKeypoints } from './soft';
import { compileFrame, GROUND_ID, SCATTER_ID } from '@blockout/core';

/** Passes whose pixel values are data: always stored losslessly (PNG), never through a video codec. */
export const EXACT_PASSES: PassName[] = ['id', 'depthMetric', 'fx', 'flow'];
export interface VideoSink { add(source: unknown, frame: number): Promise<void> | void; finish(): Promise<{ ext: string; bytes: Uint8Array; codec: string }>; audioCodec?: string | null }
export interface PackageOpts {
  renderer: PassRenderer; passes: PassName[]; height: number; prompts?: Record<string, string>; negative?: string; seed?: number;
  /** Browser: returns a WebCodecs-backed sink, or null to fall back to a PNG sequence. */
  videoSink?: (pass: PassName, width: number, height: number, fps: number) => Promise<VideoSink | null>;
  /** WebGL fast path: draw the frame and return the canvas to hand straight to the encoder (no readback). */
  drawToCanvas?: (frame: number, pass: PassName) => unknown;
  onProgress?: (done: number, total: number, label: string) => void; signal?: { aborted: boolean };
}
export interface ShotManifest {
  format: 'blockout-shot-package/1'; project: { id: string; name: string }; shot: { id: string; name: string; start: number; end: number; camera: string };
  fps: number; frames: number; duration: number; width: number; height: number; aspect: string; seed: number; renderer: string;
  passes: Record<string, { files: string; storage: 'png-sequence' | 'video'; codec?: string; purpose: string; encoding: string; hash?: string }>;
  depth: { near: number; far: number }; flow: { maxDisplacementPx: number };
  idPalette: { color: string; entityId: string; name: string; kind: string; description?: string; references?: string[] }[];
  prompts: Record<string, string>; negativePrompt: string; styleBible: Project['bibles']['style']; facts: ReturnType<typeof shotFacts>; firstFrame: string; lastFrame: string; contactSheet: string; hashes: { content: string };
}
const pad = (n: number) => String(n).padStart(4, '0');

export function idPalette(p: Project): ShotManifest['idPalette'] {
  const out: ShotManifest['idPalette'] = [{ color: GROUND_ID, entityId: 'ground', name: 'Ground / terrain', kind: 'ground' }];
  for (const c of Object.values(p.characters)) { const b = p.bibles.characters[c.id]; out.push({ color: c.idColor, entityId: c.id, name: c.name, kind: 'character', description: b ? [b.appearance, b.wardrobe, b.weapon, b.silhouette].filter(Boolean).join('; ') : undefined, references: [...(c.refImage ? [c.refImage] : []), ...(b?.refImages ?? [])] }); }
  for (const pr of Object.values(p.props)) out.push({ color: pr.idColor, entityId: pr.id, name: pr.name, kind: `prop:${pr.kind}` });
  for (const s of Object.values(p.scatter)) if (!out.some((o) => o.color === SCATTER_ID[s.kind])) out.push({ color: SCATTER_ID[s.kind], entityId: `scatter:${s.kind}`, name: s.kind, kind: 'scatter' });
  for (const f of Object.values(p.fx)) out.push({ color: f.idColor, entityId: f.id, name: f.name, kind: `fx:${f.kind} (fx pass only)` });
  return out.sort((a, b) => a.entityId.localeCompare(b.entityId));
}
export function contactSheet(frames: { index: number; img: Image }[], cols = 4, fps = 24): Image {
  const tw = 320, th = Math.round((tw * frames[0].img.height) / frames[0].img.width), rows = Math.ceil(frames.length / cols), gap = 6, W = cols * tw + (cols + 1) * gap, H = rows * (th + 14) + (rows + 1) * gap;
  const sheet: Image = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }; for (let i = 0; i < W * H; i++) { sheet.data[i * 4] = 20; sheet.data[i * 4 + 1] = 21; sheet.data[i * 4 + 2] = 24; sheet.data[i * 4 + 3] = 255; }
  frames.forEach((f, k) => { const t = resize(f.img, tw, th), x0 = gap + (k % cols) * (tw + gap), y0 = gap + Math.floor(k / cols) * (th + 14 + gap); for (let y = 0; y < th; y++) sheet.data.set(t.data.subarray(y * tw * 4, (y + 1) * tw * 4), ((y0 + y) * W + x0) * 4); stamp(sheet, `${f.index} ${(f.index / fps).toFixed(2)}s`, x0, y0 + th + 3, 2, [200, 204, 212]); });
  return sheet;
}

export async function buildShotPackage(project: Project, shot: Shot, o: PackageOpts): Promise<{ zip: Uint8Array; manifest: ShotManifest; files: Record<string, Uint8Array> }> {
  const [w, h] = passSize(project, o.height), n = shotFrames(project, shot), files: Record<string, Uint8Array> = {}, R = o.renderer, fps = project.fps;
  const total = n * o.passes.length; let done = 0; const passMeta: ShotManifest['passes'] = {};
  const tick = async (label: string) => { o.onProgress?.(++done, total, label); if (done % 8 === 0) await new Promise((r) => setTimeout(r, 0)); if (o.signal?.aborted) throw new Error('export cancelled'); };
  for (const pass of o.passes) {
    const exact = EXACT_PASSES.includes(pass), sink = !exact && o.videoSink ? await o.videoSink(pass, w, h, fps) : null; let hash = 2166136261;
    for (let f = 0; f < n; f++) {
      if (sink && o.drawToCanvas) await sink.add(o.drawToCanvas(f, pass), f);
      else { const px = R.render(project, shot, f, pass, w, h); hash = parseInt(hashBytes(px, hash), 16); if (sink) await sink.add(px, f); else files[`passes/${pass}/${pad(f)}.png`] = encodePNG(px, w, h, 3); }
      await tick(pass);
    }
    if (sink) { const v = await sink.finish(); files[`passes/${pass}.${v.ext}`] = v.bytes; passMeta[pass] = { files: `passes/${pass}.${v.ext}`, storage: 'video', codec: v.codec, ...PASS_INFO[pass] }; }
    else passMeta[pass] = { files: `passes/${pass}/%04d.png`, storage: 'png-sequence', hash: (hash >>> 0).toString(16).padStart(8, '0'), ...PASS_INFO[pass] };
  }
  const still = (f: number): Image => ({ width: w, height: h, data: R.render(project, shot, f, 'clay', w, h) });
  const first = still(0), last = still(n - 1); files['first_frame.png'] = encodePNG(first.data, w, h); files['last_frame.png'] = encodePNG(last.data, w, h);
  const picks = Array.from(new Set(Array.from({ length: Math.min(8, n) }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, Math.min(8, n) - 1)))));
  const sheet = contactSheet(picks.map((i) => ({ index: i, img: i === 0 ? first : i === n - 1 ? last : still(i) })), 4, fps); files['contact_sheet.png'] = encodePNG(sheet.data, sheet.width, sheet.height);
  files['camera.json'] = strToU8(JSON.stringify({ convention: 'cameraToWorld is OpenGL-style (camera looks down -Z, +Y up); metres; row-major listing of a column-major 4x4', frames: Array.from({ length: n }, (_, f) => cameraData(project, shot, f, w, h)) }, null, 1));
  files['pose.json'] = strToU8(JSON.stringify(Array.from({ length: n }, (_, f) => ({ frame: f, ...openPoseJSON(poseKeypoints(project, compileFrame(project, shotTime(project, shot, f)), shotCamera(project, shot, f), w, h), w, h) }))));
  const style = project.bibles.style;
  const base: Omit<ShotManifest, 'hashes'> = {
    format: 'blockout-shot-package/1', project: { id: project.id, name: project.name }, shot: { id: shot.id, name: shot.name, start: shot.start, end: shot.end, camera: project.cameras[shot.cameraId].name },
    fps, frames: n, duration: n / fps, width: w, height: h, aspect: project.aspect, seed: o.seed ?? project.seed, renderer: R.info, passes: passMeta, depth: { near: DEPTH_NEAR, far: DEPTH_FAR }, flow: { maxDisplacementPx: flowMaxDisp(w) },
    idPalette: idPalette(project), prompts: o.prompts ?? {}, negativePrompt: o.negative ?? style.negative, styleBible: style, facts: shotFacts(project, shot), firstFrame: 'first_frame.png', lastFrame: 'last_frame.png', contactSheet: 'contact_sheet.png',
  };
  const manifest: ShotManifest = { ...base, hashes: { content: hashOf({ base, files: Object.keys(files).sort().map((k) => [k, hashBytes(files[k])]) }) } };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  const ordered: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {}; for (const k of Object.keys(files).sort()) ordered[k] = [files[k], { level: 0, mtime: new Date('2000-01-01T00:00:00Z') }];
  return { zip: zipSync(ordered), manifest, files };
}
