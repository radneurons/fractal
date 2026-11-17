/** Assembly: render the cut (selected takes, blockout fallback) with trims and crossfades to MP4, plus interchange exports. */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { compileFrame, shotFrames, type Project } from '@blockout/core';
import { GLStage, createVideoSink, decodePNG, passSize, resize, encodePNG, type Image } from '@blockout/render';
import { cutList, encodeWAV, mixCutAudio, storyboardPDF, toEDL, toFCPXML, toOTIO, toUSDA, type PcmTrack } from '@blockout/pipeline';
import { storyboardLocal } from '@blockout/prompting';
import { S } from './store';
import { getAsset } from './persist';
import { exportRenderer } from './exporter';
import { claude } from './gateway';

export const selectedTake = (p: Project, shotId: string) => { const sh = p.shots.find((s) => s.id === shotId), done = Object.values(p.takes).filter((t) => t.shotId === shotId && t.status === 'done' && t.frames.length); return done.find((t) => t.id === sh?.selectedTakeId) ?? done.find((t) => t.circled) ?? null; };
/** Pull one frame of the cut at shot-relative frame f: from the selected take if any, else the blockout clay pass. */
async function frameOf(p: Project, shotId: string, f: number, w: number, h: number, cache: Map<string, Image>): Promise<Image> {
  const shot = p.shots.find((s) => s.id === shotId)!, t = selectedTake(p, shotId);
  if (t) { const i = Math.min(t.frames.length - 1, Math.round((f / Math.max(1, shotFrames(p, shot) - 1)) * (t.frames.length - 1))), key = t.frames[i]; let img = cache.get(key); if (!img) { img = decodePNG(new Uint8Array(await (await getAsset(key))!.arrayBuffer())); if (img.width !== w) img = resize(img, w, h); cache.set(key, img); } return img; }
  return { width: w, height: h, data: exportRenderer().render(p, shot, f, 'clay', w, h) };
}
/** Decode the project's audio tracks and mix them into cut time (following trims and J/L-cut leads/tails). */
export async function cutAudio(rate = 48000): Promise<Float32Array[] | null> {
  const p = S().project, list = Object.values(p.audio); if (!list.length) return null;
  const ctx = new OfflineAudioContext(2, 1, rate), tracks: PcmTrack[] = [];
  for (const a of list) { const b = await getAsset(a.assetId); if (!b) continue; const buf = await ctx.decodeAudioData(await b.arrayBuffer()); tracks.push({ offset: a.offset, gain: a.gain, sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) }); }
  if (!tracks.length) return null; const clips = cutList(p), total = clips.length ? clips[clips.length - 1].recOut / p.fps : 0;
  return mixCutAudio(clips.map((c) => ({ sceneStart: c.shot.start + c.srcIn / p.fps, sceneEnd: c.shot.start + c.srcOut / p.fps, recStart: c.recIn / p.fps, lead: c.shot.audioLead, tail: c.shot.audioTail })), total, tracks, rate);
}
export async function renderCut(height = 540, onProgress?: (d: number, t: number) => void): Promise<{ bytes: Uint8Array; ext: string; frames: number; audio: string | null }> {
  const p = S().project, [w, h] = passSize(p, height), clips = cutList(p), total = clips.length ? clips[clips.length - 1].recOut : 0, mix = await cutAudio(48000), sink = await createVideoSink(w, h, p.fps, undefined, mix ? { sampleRate: 48000, channels: mix } : undefined), cache = new Map<string, Image>(), pngs: Record<string, Uint8Array> = {};
  for (let r = 0; r < total; r++) {
    const live = clips.filter((c) => r >= c.recIn && r < c.recOut), cur = live[live.length - 1]; let img = await frameOf(p, cur.shot.id, cur.srcIn + (r - cur.recIn), w, h, cache);
    if (live.length > 1 && cur.transitionFrames) { const prev = live[0], a = await frameOf(p, prev.shot.id, prev.srcIn + (r - prev.recIn), w, h, cache), k = (r - cur.recIn + 1) / (cur.transitionFrames + 1), d = new Uint8ClampedArray(img.data.length); for (let i = 0; i < d.length; i++) d[i] = a.data[i] * (1 - k) + img.data[i] * k; img = { width: w, height: h, data: d }; }
    if (sink) await sink.add(img.data, r); else pngs[`cut/${String(r).padStart(5, '0')}.png`] = encodePNG(img.data, w, h, 3);
    if (r % 12 === 0) { onProgress?.(r, total); await new Promise((res) => setTimeout(res, 0)); }
  }
  if (sink) { const v = await sink.finish(), ac = sink.audioCodec ?? null; if (mix && !ac) { const { zipSync } = await import('fflate'); return { bytes: zipSync({ [`cut.${v.ext}`]: v.bytes, 'cut.wav': encodeWAV(mix, 48000) }), ext: 'zip', frames: total, audio: 'wav (no audio encoder; muxed separately)' }; } return { bytes: v.bytes, ext: v.ext, frames: total, audio: ac }; }
  if (mix) pngs['cut.wav'] = encodeWAV(mix, 48000);
  const { zipSync } = await import('fflate'); return { bytes: zipSync(pngs), ext: 'zip', frames: total, audio: mix ? 'wav' : null };
}
export const exportOTIO = () => toOTIO(S().project, cutList(S().project, (s) => `${s.id}.mp4`));
export const exportEDL = () => toEDL(S().project);
export const exportFCPXML = () => toFCPXML(S().project);
export const exportUSD = () => toUSDA(S().project, S().t);
export async function exportGLTF(): Promise<ArrayBuffer> {
  const p = S().project, stage = new GLStage(), scene = new THREE.Scene(); stage.sync(compileFrame(p, S().t)); stage.setLook('view'); scene.add(stage.group);
  return new Promise((res, rej) => new GLTFExporter().parse(scene, (r) => res(r as ArrayBuffer), (e) => rej(e), { binary: true }));
}
/** Storyboard PDF: one clay frame per shot, shot size, camera note, and action notes written by Claude (offline fallback). */
export async function exportStoryboard(): Promise<Uint8Array> {
  const p = S().project, [w, h] = passSize(p, 270); let panels = storyboardLocal(p);
  try { panels = (await claude('storyboard', {}, { label: 'Writing storyboard notes' })).value.panels; } catch { /* offline notes */ }
  return storyboardPDF(p.name, `${p.shots.length} shots · ${p.aspect} · ${p.fps} fps`, p.shots.map((s) => { const pn = panels.find((x) => x.shotId === s.id) ?? storyboardLocal(p).find((x) => x.shotId === s.id)!, mid = Math.floor(shotFrames(p, s) / 2); return { title: s.name, size: pn.size, action: pn.action, camera: pn.camera, meta: `${(s.end - s.start).toFixed(1)}s`, image: { width: w, height: h, data: exportRenderer().render(p, s, mid, 'clay', w, h) } }; }));
}
