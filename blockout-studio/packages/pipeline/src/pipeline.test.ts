import { describe, expect, it } from 'vitest';
import { demoProject } from '@blockout/core';
import { decodePNG, encodePNG, hashBytes, softRenderer, passSize, idPalette, type Image } from '@blockout/render';
import * as L from './index';

const demo = demoProject(), [w, h] = passSize(demo, 72), shot = demo.shots[3];
const frames = (pass: 'clay' | 'id' | 'canny', n = 6) => Array.from({ length: n }, (_, f) => encodePNG(softRenderer.render(demo, shot, f * 4, pass, w, h), w, h, 1));
const req = (seed = 7): L.GenRequest => ({ shotId: 's4', prompt: 'p', negative: '', seed, fps: 24, frames: 6, width: w, height: h, duration: 2.5, passes: { clay: frames('clay'), canny: frames('canny') }, palette: demo.bibles.style.palette, references: [] });
const ctx = (): L.GenContext => ({ onProgress() {}, signal: { aborted: false }, secret: async (n) => (n === 'KEY' ? 'sk-test' : undefined), sleep: async () => {} });

describe('mock provider', () => {
  it('is deterministic per seed and differs across seeds', async () => {
    const a = await L.mockProvider.generate(req(7), ctx()), b = await L.mockProvider.generate(req(7), ctx()), c = await L.mockProvider.generate(req(8), ctx());
    expect(a.frames!.map((f) => hashBytes(f))).toEqual(b.frames!.map((f) => hashBytes(f))); expect(hashBytes(a.frames![0])).not.toBe(hashBytes(c.frames![0])); expect(a.frames).toHaveLength(6); expect(decodePNG(a.frames![0]).width).toBe(w);
  });
  it('upscale, interpolate and inpaint slots work', async () => {
    const base = (await L.mockProvider.generate(req(), ctx())).frames!, up = await L.getProvider('mock-upscale')!.generate({ ...req(), source: base }, ctx()), ip = await L.getProvider('mock-interpolate')!.generate({ ...req(), source: base }, ctx());
    expect(up.width).toBe(w * 2); expect(ip.frames).toHaveLength(12); expect(ip.fps).toBe(48);
    const mask = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) mask.set([255, 255, 255, 255], (y * w + x) * 4);
    const inp = await L.getProvider('mock-inpaint')!.generate({ ...req(), source: base, mask: encodePNG(mask, w, h) }, ctx()), A = decodePNG(base[0]), B = decodePNG(inp.frames![0]); let leftDiff = 0, rightDiff = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, d = Math.abs(A.data[i] - B.data[i]); if (x < w / 2) leftDiff += d; else rightDiff += d; } expect(rightDiff).toBe(0); expect(leftDiff).toBeGreaterThan(0); // only the drawn region regenerates
  });
});
describe('queue + budget', () => {
  it('warns at 80% and blocks over the cap', () => { expect(L.checkBudget({ cap: 10, spent: 5, committed: 0 }, 2)).toMatchObject({ ok: true, warn: false }); expect(L.checkBudget({ cap: 10, spent: 6, committed: 1 }, 1)).toMatchObject({ ok: true, warn: true }); expect(L.checkBudget({ cap: 10, spent: 9.8, committed: 0 }, 0.5).ok).toBe(false); expect(L.checkBudget({ cap: 0, spent: 99, committed: 0 }, 5).ok).toBe(true); });
  it('respects concurrency, retries with backoff, and cancels', async () => {
    let active = 0, peak = 0, calls = 0; const sleeps: number[] = [];
    const flaky: L.ProviderPlugin = { ...L.mockProvider, id: 'flaky', estimate: () => 1, async generate(r, c) { calls++; active++; peak = Math.max(peak, active); await new Promise((res) => setTimeout(res, 5)); active--; if (r.seed === 1 && calls < 3) throw new Error('503 upstream'); if (c.signal.aborted) throw new Error('cancelled'); return { frames: [], width: 1, height: 1, fps: 24, cost: 1 }; } };
    let spent = 0; const q: L.GenerationQueue = new L.GenerationQueue({ concurrency: 2, retries: 2, backoffMs: 100, sleep: async (ms) => { sleeps.push(ms); }, budget: () => ({ cap: 4, spent, committed: q.committed() }), onChange: (j) => { if (j.status === 'done') spent += j.cost; } });
    const a = q.enqueue(flaky, req(1)), b = q.enqueue(flaky, req(2)), c = q.enqueue(flaky, req(3)); q.cancel(c.job.id);
    const [ja, jb, jc] = await Promise.all([a.done, b.done, c.done]);
    expect(ja.status).toBe('done'); expect(ja.attempts).toBeGreaterThan(1); expect(sleeps[0]).toBe(100); expect(jb.status).toBe('done'); expect(jc.status).toBe('cancelled'); expect(peak).toBeLessThanOrEqual(2);
    q.enqueue(flaky, req(4)); q.enqueue(flaky, req(5)); expect(() => q.enqueue(flaky, req(6))).toThrow(/over the \$4\.00 budget cap/);
  });
  it('generic HTTP provider fills templates, pulls secrets from the keychain only, polls, and returns the result URL', async () => {
    const seen: { url: string; init?: RequestInit }[] = []; let polls = 0;
    const fake = (async (url: string, init?: RequestInit) => { seen.push({ url, init }); if (url.endsWith('/submit')) return new Response(JSON.stringify({ id: 'job 1' })); polls++; return new Response(JSON.stringify(polls < 2 ? { status: 'running' } : { status: 'succeeded', output: { url: 'https://cdn.example/v.mp4' } })); }) as unknown as typeof fetch;
    const p = L.httpProvider({ id: 'my-video', name: 'My video API', dialect: 'seedance', submit: { url: 'https://api.example/submit', headers: { authorization: 'Bearer {{secret:KEY}}' }, body: { prompt: '{{prompt}}', seed: '{{seed}}', image: 'data:image/png;base64,{{firstFrame}}', depth0: '{{pass:clay:0}}' } }, poll: { url: 'https://api.example/jobs/{{id}}', intervalMs: 1 }, costPerSecond: 0.2 });
    const r = await p.generate({ ...req(42), firstFrame: frames('clay', 1)[0] }, { ...ctx(), fetch: fake }), body = JSON.parse(seen[0].init!.body as string);
    expect(r.videoUrl).toBe('https://cdn.example/v.mp4'); expect((seen[0].init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test'); expect(body.seed).toBe(42); expect(body.image).toMatch(/^data:image\/png;base64,iVBOR/); expect(body.depth0.length).toBeGreaterThan(100); expect(seen[1].url).toBe('https://api.example/jobs/job%201'); expect(p.estimate(req())).toBe(0.5);
    await expect(L.httpProvider({ id: 'x', name: 'X', submit: { url: 'https://api.example/submit', headers: { a: '{{secret:MISSING}}' }, body: {} } }).generate(req(), { ...ctx(), fetch: fake })).rejects.toThrow(/not set in the bridge keychain/);
  });
});
describe('scoring', () => {
  const img = (px: Uint8ClampedArray): Image => ({ width: w, height: h, data: px }), id = img(softRenderer.render(demo, shot, 12, 'id', w, h)), palette = [...idPalette(demo), { color: '#000000', entityId: 'sky', kind: 'ground' }];
  it('IoU is 1 against itself and drops when the result is shifted', () => {
    expect(L.maskIoU(id, L.paletteSegmenter.segment(id, palette) as Image, palette).mean).toBeCloseTo(1, 5);
    const shifted = new Uint8ClampedArray(id.data.length); for (let y = 0; y < h; y++) for (let x = 12; x < w; x++) for (let c = 0; c < 4; c++) shifted[(y * w + x) * 4 + c] = id.data[(y * w + x - 12) * 4 + c];
    const r = L.maskIoU(id, img(shifted), palette); expect(r.mean).toBeLessThan(0.5); expect(Object.keys(r.perEntity)).toEqual(expect.arrayContaining(['kenji', 'ren']));
  });
  it('scores a mock take end to end', async () => {
    const res = (await L.mockProvider.generate(req(), ctx())).frames!.map(decodePNG), ids = frames('id').map(decodePNG), clay = frames('clay').map(decodePNG), s = await L.scoreTake(ids, clay, res, palette, demo.bibles.style.palette);
    expect(s.iou).toBeGreaterThan(0.15); expect(s.iou).toBeLessThanOrEqual(1); expect(s.paletteDistance).toBeLessThan(0.25); expect(s.flicker).toBeLessThan(0.05);
  });
});
describe('interchange', () => {
  it('OTIO, EDL and FCPXML agree on the cut', () => {
    const p = { ...demo, shots: demo.shots.map((s, i) => (i === 1 ? { ...s, transition: { kind: 'crossfade' as const, duration: 0.5 }, trimIn: 0.25 } : s)) }, clips = L.cutList(p), otio = JSON.parse(L.toOTIO(p)), edl = L.toEDL(p), fcp = L.toFCPXML(p);
    expect(clips).toHaveLength(6); expect(clips[0]).toMatchObject({ recIn: 0, recOut: 72 }); expect(clips[1]).toMatchObject({ srcIn: 6, transitionFrames: 12, recIn: 60 });
    const v = otio.tracks.children[0].children; expect(v.filter((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === 'Clip.2')).toHaveLength(6); expect(v.some((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === 'Transition.1')).toBe(true); expect(v[0].source_range.duration).toEqual({ OTIO_SCHEMA: 'RationalTime.1', rate: 24, value: 72 });
    expect(edl).toMatch(/001  S1       V     C         00:00:00:00 00:00:03:00 01:00:00:00 01:00:03:00/); expect(edl).toMatch(/002  S2       V     D    012/); expect(fcp).toMatch(/<asset-clip ref="r2" name="1 · Sprint \(top-down\)" offset="0\/24s" start="0\/24s" duration="72\/24s"/); expect(fcp).toMatch(/<transition name="Cross Dissolve"/);
  });
  it('USDA has every camera with time samples and the posed characters', () => { const u = L.toUSDA(demo, 6.5); expect(u.startsWith('#usda 1.0')).toBe(true); expect((u.match(/def Camera/g) ?? []).length).toBe(6); expect(u).toMatch(/def Xform "kenji"/); expect(u).toMatch(/focalLength\.timeSamples/); expect((u.match(/\{/g) ?? []).length).toBe((u.match(/\}/g) ?? []).length); });
  it('storyboard PDF is structurally valid', () => {
    const im: Image = { width: w, height: h, data: softRenderer.render(demo, shot, 10, 'clay', w, h) }, pdf = L.storyboardPDF('Field Duel', 'storyboard', demo.shots.concat(demo.shots).map((s) => ({ title: s.name, size: 'WS', action: 'Kenji slashes — Ren blocks, then lunges with a thrust.', camera: 'orbit, 40mm', image: im }))), txt = new TextDecoder('latin1').decode(pdf);
    expect(txt.startsWith('%PDF-1.4')).toBe(true); expect(txt.trimEnd().endsWith('%%EOF')).toBe(true); expect((txt.match(/\/Type \/Page /g) ?? []).length).toBe(2); expect((txt.match(/\/Subtype \/Image/g) ?? []).length).toBe(12);
    const xref = +/startxref\n(\d+)/.exec(txt)![1]; expect(txt.slice(xref, xref + 4)).toBe('xref'); const first = +/\n(\d{10}) 00000 n/.exec(txt.slice(xref))![1]; expect(txt.slice(first, first + 7)).toBe('1 0 obj');
  });
});
