/** Provider plugins. A plugin declares capabilities, a cost model and a dialect; the queue does the rest.
 *  Ships: a deterministic offline mock (video + image + upscale + interpolate + inpaint) and a user-configured generic HTTP provider. */
import { z } from 'zod';
import { hexToRgb, mulberry32, type Vec3 } from '@blockout/core';
import { decodePNG, encodePNG, resize, type Image } from '@blockout/render';

export type ProviderKind = 'video' | 'image' | 'upscale' | 'interpolate' | 'inpaint';
export interface ProviderCaps { kind: ProviderKind; modes: ('text-to-video' | 'image-to-video' | 'video-to-video' | 'text-to-image')[]; controls: string[]; maxDuration: number; maxWidth: number; maxHeight: number; references: boolean }
export interface GenRequest {
  shotId: string; prompt: string; negative: string; seed: number; fps: number; frames: number; width: number; height: number; duration: number;
  /** PNG frame sequences per control pass (only those the provider accepts are sent). */
  passes: Record<string, Uint8Array[]>; firstFrame?: Uint8Array; lastFrame?: Uint8Array; keyframe?: Uint8Array; palette: string[];
  references: { color: string; name: string; description?: string; image?: Uint8Array }[]; source?: Uint8Array[]; mask?: Uint8Array; factor?: number;
}
export interface GenResult { frames?: Uint8Array[]; videoUrl?: string; width: number; height: number; fps: number; cost: number; meta?: Record<string, unknown> }
export interface GenContext { onProgress(fraction: number, note?: string): void; signal: { aborted: boolean }; secret(name: string): Promise<string | undefined>; fetch?: typeof fetch; sleep?(ms: number): Promise<void> }
export interface ProviderPlugin { id: string; name: string; dialect: string; caps: ProviderCaps; description: string; estimate(req: Pick<GenRequest, 'duration' | 'width' | 'height' | 'frames'>): number; generate(req: GenRequest, ctx: GenContext): Promise<GenResult> }

const registry = new Map<string, ProviderPlugin>();
export const registerProvider = (p: ProviderPlugin) => { registry.set(p.id, p); return p; };
export const getProvider = (id: string) => registry.get(id);
export const listProviders = (kind?: ProviderKind) => [...registry.values()].filter((p) => !kind || p.caps.kind === kind);

// ---------- deterministic mock ----------
const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
function ramp(palette: string[]): Vec3[] { const cols = (palette.length >= 2 ? palette : ['#1b1b2a', '#3a6ea5', '#e8c45a', '#f7f1e3']).map(hexToRgb); return cols.sort((a, b) => lum(a[0], a[1], a[2]) - lum(b[0], b[1], b[2])); }
/** Stylize a clay frame: luminance -> palette ramp, posterized, with seeded paper grain and ink edges. Pure function of (pixels, palette, seed, frame). */
export function stylize(clay: Image, palette: string[], seed: number, frame: number, edges?: Image, mask?: Image, ids?: { img: Image; costumes: Map<number, Vec3> }): Image {
  const R = ramp(palette), n = clay.width * clay.height, out = new Uint8ClampedArray(n * 4), rnd = mulberry32(seed * 7919 + 13), grain = new Float32Array(4096); for (let i = 0; i < 4096; i++) grain[i] = rnd() - 0.5;
  const steps = 7, off = (seed * 31 + frame * 0) & 4095;
  for (let i = 0; i < n; i++) {
    if (mask && mask.data[i * 4] < 128) { out[i * 4] = clay.data[i * 4]; out[i * 4 + 1] = clay.data[i * 4 + 1]; out[i * 4 + 2] = clay.data[i * 4 + 2]; out[i * 4 + 3] = 255; continue; }
    let l = lum(clay.data[i * 4], clay.data[i * 4 + 1], clay.data[i * 4 + 2]); l = Math.min(0.999, Math.max(0, l + grain[(i * 2654435761 + off) & 4095] * 0.05)); l = (Math.floor(l * steps) + 0.5) / steps;
    const f = l * (R.length - 1), k = Math.min(R.length - 2, Math.floor(f)), t = f - k, e = edges && edges.data[i * 4] > 128 ? 0.35 : 1, warm = clay.data[i * 4] - clay.data[i * 4 + 2] > 40 ? 1.06 : 1;
    out[i * 4] = (R[k][0] + (R[k + 1][0] - R[k][0]) * t) * e * warm; out[i * 4 + 1] = (R[k][1] + (R[k + 1][1] - R[k][1]) * t) * e; out[i * 4 + 2] = (R[k][2] + (R[k + 1][2] - R[k][2]) * t) * e; out[i * 4 + 3] = 255;
    if (ids) { const d = ids.img.data, cost = ids.costumes.get((d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]); if (cost) { const sh = 0.45 + 0.75 * l; out[i * 4] = cost[0] * sh * e; out[i * 4 + 1] = cost[1] * sh * e; out[i * 4 + 2] = cost[2] * sh * e; } }
  }
  return { width: clay.width, height: clay.height, data: out };
}
/** Costume tone per character: a deterministic, saturated colour from the mask colour's hue (what a real model gets from the bible). */
export function costumes(req: Pick<GenRequest, 'references'>): Map<number, Vec3> {
  const m = new Map<number, Vec3>(); for (const r of req.references) { const [R, G, B] = hexToRgb(r.color), mx = Math.max(R, G, B), mn = Math.min(R, G, B); let h = 0; if (mx !== mn) h = mx === R ? ((G - B) / (mx - mn)) % 6 : mx === G ? (B - R) / (mx - mn) + 2 : (R - G) / (mx - mn) + 4;
    const hue = ((h * 60 + 360) % 360) / 60, c = 150, x = c * (1 - Math.abs((hue % 2) - 1)), [r1, g1, b1] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]; m.set((R << 16) | (G << 8) | B, [r1 + 40, g1 + 40, b1 + 40]); }
  return m;
}
const wait = (ctx: GenContext, ms: number) => (ctx.sleep ?? ((m: number) => new Promise<void>((r) => setTimeout(r, m))))(ms);
export const mockProvider = registerProvider({
  id: 'mock', name: 'Mock (offline, deterministic)', dialect: 'mock', description: 'Stylizes the clay pass with the style-bible palette. Same seed, same frames. Costs nothing; lets the whole pipeline run offline.',
  caps: { kind: 'video', modes: ['video-to-video', 'image-to-video'], controls: ['clay', 'canny', 'id', 'depth', 'pose', 'firstFrame', 'keyframe'], maxDuration: 60, maxWidth: 1920, maxHeight: 1080, references: true },
  estimate: (r) => Math.round(r.duration * 0.05 * 100) / 100, // pretend $0.05 / s so budget logic is exercised
  async generate(req, ctx) {
    const clay = req.passes.clay; if (!clay?.length) throw new Error('mock provider needs the clay pass');
    const frames: Uint8Array[] = []; let w = 0, h = 0;
    for (let f = 0; f < clay.length; f++) {
      if (ctx.signal.aborted) throw new Error('cancelled');
      let img = decodePNG(clay[f]); const tw = Math.min(img.width, 512); if (img.width > tw) img = resize(img, tw, Math.round((img.height * tw) / img.width / 2) * 2);
      let edges = req.passes.canny?.[f] ? decodePNG(req.passes.canny[f]) : undefined; if (edges && edges.width !== img.width) edges = resize(edges, img.width, img.height);
      let idImg = req.passes.id?.[f] ? decodePNG(req.passes.id[f]) : undefined; if (idImg && idImg.width !== img.width) idImg = resize(idImg, img.width, img.height);
      const st = stylize(img, req.palette, req.seed, f, edges, undefined, idImg ? { img: idImg, costumes: costumes(req) } : undefined); w = st.width; h = st.height; frames.push(encodePNG(st.data, w, h, 2));
      ctx.onProgress((f + 1) / clay.length); if (f % 6 === 5) await wait(ctx, 0);
    }
    return { frames, width: w, height: h, fps: req.fps, cost: this.estimate(req), meta: { seed: req.seed } };
  },
});
export const mockImageProvider = registerProvider({
  id: 'mock-image', name: 'Mock keyframe (offline)', dialect: 'mock', description: 'Styled keyframe from the clay + depth passes, for two-stage generation.',
  caps: { kind: 'image', modes: ['text-to-image'], controls: ['clay', 'depth'], maxDuration: 0, maxWidth: 1920, maxHeight: 1080, references: true }, estimate: () => 0.01,
  async generate(req, ctx) { const src = req.firstFrame ?? req.passes.clay?.[0]; if (!src) throw new Error('needs a clay frame'); const img = decodePNG(src), st = stylize(img, req.palette, req.seed + 101, 0); ctx.onProgress(1); return { frames: [encodePNG(st.data, st.width, st.height, 2)], width: st.width, height: st.height, fps: req.fps, cost: 0.01 }; },
});
registerProvider({ id: 'mock-upscale', name: 'Mock upscale ×2', dialect: 'mock', description: 'Nearest-neighbour ×2; stands in for an upscaler.', caps: { kind: 'upscale', modes: ['video-to-video'], controls: [], maxDuration: 60, maxWidth: 3840, maxHeight: 2160, references: false }, estimate: (r) => r.duration * 0.01,
  async generate(req, ctx) { const k = req.factor ?? 2, out: Uint8Array[] = []; let W = 0, H = 0; for (const [i, f] of (req.source ?? []).entries()) { const a = decodePNG(f); W = a.width * k; H = a.height * k; const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((Math.floor(y / k)) * a.width + Math.floor(x / k)) * 4, o = (y * W + x) * 4; d[o] = a.data[s]; d[o + 1] = a.data[s + 1]; d[o + 2] = a.data[s + 2]; d[o + 3] = 255; } out.push(encodePNG(d, W, H, 2)); ctx.onProgress((i + 1) / req.source!.length); } return { frames: out, width: W, height: H, fps: req.fps, cost: this.estimate(req) }; } });
registerProvider({ id: 'mock-interpolate', name: 'Mock frame interpolation ×2', dialect: 'mock', description: 'Blends neighbouring frames to double the frame rate.', caps: { kind: 'interpolate', modes: ['video-to-video'], controls: [], maxDuration: 60, maxWidth: 1920, maxHeight: 1080, references: false }, estimate: (r) => r.duration * 0.01,
  async generate(req, ctx) { const src = (req.source ?? []).map(decodePNG), out: Uint8Array[] = []; for (let i = 0; i < src.length; i++) { const a = src[i], b = src[Math.min(i + 1, src.length - 1)]; out.push(encodePNG(a.data, a.width, a.height, 2)); const m = new Uint8ClampedArray(a.data.length); for (let j = 0; j < m.length; j++) m[j] = (a.data[j] + b.data[j]) >> 1; out.push(encodePNG(m, a.width, a.height, 2)); ctx.onProgress((i + 1) / src.length); } return { frames: out, width: src[0]?.width ?? 0, height: src[0]?.height ?? 0, fps: req.fps * 2, cost: this.estimate(req) }; } });
registerProvider({ id: 'mock-inpaint', name: 'Mock region inpaint', dialect: 'mock', description: 'Regenerates only the masked region (white = regenerate) with a new seed.', caps: { kind: 'inpaint', modes: ['video-to-video'], controls: ['clay'], maxDuration: 60, maxWidth: 1920, maxHeight: 1080, references: false }, estimate: (r) => r.duration * 0.02,
  async generate(req, ctx) { if (!req.mask || !req.source) throw new Error('inpaint needs source frames and a mask'); const out: Uint8Array[] = []; let W = 0, H = 0; for (const [i, f] of req.source.entries()) { const a = decodePNG(f); W = a.width; H = a.height; let mk = decodePNG(req.mask); if (mk.width !== W) mk = resize(mk, W, H); let clay = req.passes.clay?.[i] ? decodePNG(req.passes.clay[i]) : a; if (clay.width !== W) clay = resize(clay, W, H); const st = stylize(clay, req.palette, req.seed + 5003, i), d = new Uint8ClampedArray(a.data); for (let p = 0; p < W * H; p++) if (mk.data[p * 4] >= 128) { d[p * 4] = st.data[p * 4]; d[p * 4 + 1] = st.data[p * 4 + 1]; d[p * 4 + 2] = st.data[p * 4 + 2]; } out.push(encodePNG(d, W, H, 2)); ctx.onProgress((i + 1) / req.source.length); } return { frames: out, width: W, height: H, fps: req.fps, cost: this.estimate(req) }; } });

// ---------- generic HTTP provider (user-configured) ----------
export const HttpProviderConfigS = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), dialect: z.string().default('canonical'), kind: z.enum(['video', 'image', 'upscale', 'interpolate', 'inpaint']).default('video'),
  controls: z.array(z.string()).default(['firstFrame']), maxDuration: z.number().default(10), maxWidth: z.number().default(1920), maxHeight: z.number().default(1080), costPerSecond: z.number().default(0.1), costFixed: z.number().default(0),
  submit: z.object({ url: z.string().url(), method: z.string().default('POST'), headers: z.record(z.string()).default({}), body: z.unknown() }),
  /** Optional polling for async APIs. `{{id}}` etc. are filled from the submit response via `idPath`. */
  poll: z.object({ url: z.string(), intervalMs: z.number().default(4000), timeoutMs: z.number().default(900000), headers: z.record(z.string()).default({}), idPath: z.string().default('id'), statusPath: z.string().default('status'), done: z.array(z.string()).default(['succeeded', 'completed', 'done', 'success']), failed: z.array(z.string()).default(['failed', 'error', 'canceled', 'cancelled']) }).optional(),
  resultPath: z.string().default('output.url'),
});
export type HttpProviderConfig = z.infer<typeof HttpProviderConfigS>;
const dig = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k.replace(/\[(\d+)\]/, '.$1').split('.')[0]] !== undefined && /\[\d+\]/.test(k) ? ((a as Record<string, unknown[]>)[k.split('[')[0]] ?? [])[+/\[(\d+)\]/.exec(k)![1]] : (a as Record<string, unknown>)[k]), o);
const b64 = (u?: Uint8Array) => { if (!u) return ''; let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(u).toString('base64'); };
/** Template placeholders: {{prompt}} {{negative}} {{seed}} {{fps}} {{frames}} {{width}} {{height}} {{duration}} {{firstFrame}} {{lastFrame}} {{keyframe}} {{mask}} (base64 PNG), {{pass:NAME:N}} (base64 PNG frame N), {{secret:NAME}} (from the bridge keychain; never stored in the project). */
export async function fillTemplate(v: unknown, req: GenRequest, ctx: GenContext, extra: Record<string, string> = {}): Promise<unknown> {
  if (typeof v === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(v); if (whole && ['seed', 'fps', 'frames', 'width', 'height', 'duration'].includes(whole[1])) return (req as unknown as Record<string, number>)[whole[1]];
    let out = v; for (const m of v.matchAll(/\{\{([^}]+)\}\}/g)) { const k = m[1].trim(); let r: string;
      if (k.startsWith('secret:')) { const s = await ctx.secret(k.slice(7)); if (s === undefined) throw new Error(`secret "${k.slice(7)}" is not set in the bridge keychain`); r = s; }
      else if (k.startsWith('pass:')) { const [, name, idx] = k.split(':'); r = b64(req.passes[name]?.[+(idx ?? 0)]); }
      else if (['firstFrame', 'lastFrame', 'keyframe', 'mask'].includes(k)) r = b64((req as unknown as Record<string, Uint8Array | undefined>)[k]);
      else if (k in extra) r = extra[k]; else r = String((req as unknown as Record<string, unknown>)[k] ?? '');
      out = out.replace(m[0], r); }
    return out;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => fillTemplate(x, req, ctx, extra)));
  if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await fillTemplate(x, req, ctx, extra)])));
  return v;
}
export function httpProvider(raw: unknown): ProviderPlugin {
  const c = HttpProviderConfigS.parse(raw);
  return {
    id: c.id, name: c.name, dialect: c.dialect, description: `HTTP provider → ${new URL(c.submit.url).host}`, caps: { kind: c.kind, modes: ['image-to-video', 'text-to-video'], controls: c.controls, maxDuration: c.maxDuration, maxWidth: c.maxWidth, maxHeight: c.maxHeight, references: true },
    estimate: (r) => Math.round((c.costFixed + c.costPerSecond * r.duration) * 100) / 100,
    async generate(req, ctx) {
      const f = ctx.fetch ?? fetch, headers = (await fillTemplate({ 'content-type': 'application/json', ...c.submit.headers }, req, ctx)) as Record<string, string>;
      const res = await f(c.submit.url, { method: c.submit.method, headers, body: JSON.stringify(await fillTemplate(c.submit.body, req, ctx)) });
      if (!res.ok) throw Object.assign(new Error(`${c.name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`), { retryable: res.status === 429 || res.status >= 500 });
      let json: unknown = await res.json();
      if (c.poll) {
        const id = String(dig(json, c.poll.idPath) ?? ''), t0 = Date.now(), ph = (await fillTemplate(c.poll.headers, req, ctx)) as Record<string, string>;
        for (;;) {
          if (ctx.signal.aborted) throw new Error('cancelled'); if (Date.now() - t0 > c.poll.timeoutMs) throw new Error(`${c.name}: timed out`);
          await wait(ctx, c.poll.intervalMs); const pr = await f(c.poll.url.replace('{{id}}', encodeURIComponent(id)), { headers: ph }); if (!pr.ok) { if (pr.status >= 500) continue; throw new Error(`${c.name}: poll HTTP ${pr.status}`); }
          json = await pr.json(); const st = String(dig(json, c.poll.statusPath) ?? '').toLowerCase(); ctx.onProgress(Math.min(0.95, (Date.now() - t0) / 120000), st);
          if (c.poll.done.includes(st)) break; if (c.poll.failed.includes(st)) throw new Error(`${c.name}: generation ${st}`);
        }
      }
      const url = dig(json, c.resultPath); if (typeof url !== 'string') throw new Error(`${c.name}: no result at "${c.resultPath}"`);
      ctx.onProgress(1); return { videoUrl: url, width: req.width, height: req.height, fps: req.fps, cost: this.estimate(req) };
    },
  };
}
