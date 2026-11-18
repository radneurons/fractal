/** Provider dialects: declarative prompt grammars. A dialect is data, so adding a provider is a plugin
 *  (`registerDialect`, or a JSON file in the bridge's `dialects/` folder), never a code edit.
 *  NOTE: limits and vocabularies below are editable starting points, not vendor-certified specifications. */
import { z } from 'zod';

export const SEGMENTS = ['framing', 'subject', 'action', 'camera', 'lighting', 'fx', 'style'] as const;
export type SegKey = (typeof SEGMENTS)[number];
export type Segments = Record<SegKey, string>;

export const DialectS = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), notes: z.string().default(''),
  layout: z.enum(['prose', 'tagged', 'timeline']).default('prose'),
  order: z.array(z.enum(SEGMENTS)).default([...SEGMENTS]),
  /** Segments dropped first when the text exceeds maxChars (first = dropped first). */
  dropOrder: z.array(z.enum(SEGMENTS)).default(['fx', 'lighting', 'framing', 'style']),
  maxChars: z.number().int().positive().default(4000),
  labels: z.record(z.string()).default({}),
  timestamps: z.enum(['range', 'at', 'none']).default('range'),
  /** Canonical term -> provider's preferred camera/phrase vocabulary (case-insensitive whole-phrase replace). */
  vocab: z.record(z.string()).default({}),
  prefix: z.string().default(''), suffix: z.string().default(''),
  negative: z.enum(['field', 'inline', 'none']).default('field'),
  /** Which control inputs the provider family typically accepts; used to pick passes and warn early. */
  controls: z.array(z.string()).default(['firstFrame']), maxDuration: z.number().positive().default(10), supportsReferences: z.boolean().default(true),
  /** Allowed clip durations (s) when the API only takes discrete values. */
  durations: z.array(z.number()).optional(), aspects: z.array(z.string()).optional(),
  /** Provenance of the limits above: where they come from and when they were last checked. Unsourced values are estimates. */
  verified: z.object({ on: z.string(), sources: z.array(z.string()), notes: z.string().default('') }).optional(),
});
export type Dialect = z.infer<typeof DialectS>;
const D = (d: z.input<typeof DialectS>) => DialectS.parse(d);

const BUILTIN: Dialect[] = [
  D({ id: 'canonical', name: 'Canonical', notes: 'Provider-neutral description; every other dialect is derived from it.', maxChars: 20000, negative: 'field', controls: ['clay', 'depth', 'pose', 'id', 'canny', 'flow', 'firstFrame', 'lastFrame'], maxDuration: 60 }),
  D({ id: 'seedance', name: 'Seedance', notes: 'Timeline-style shot script: one header line, then timestamped beats, then camera and look. No negative-prompt field (avoidances go inline). Request-body params: resolution, ratio, duration, seed, camera_fixed (or inline --flags).', layout: 'timeline', order: ['framing', 'subject', 'action', 'camera', 'lighting', 'fx', 'style'], maxChars: 2000, timestamps: 'range', negative: 'inline', controls: ['firstFrame', 'lastFrame', 'reference'], maxDuration: 12, aspects: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    verified: { on: '2026-11-18', sources: ['https://docs.byteplus.com/docs/en/modelark/create-video-generation-task-api.md (body params, inline --flags)', 'https://developers.cloudflare.com/ai/models/bytedance/seedance-2.0/index.md (duration 4–12 s)'], notes: 'Duration/ratio from secondary listings for Seedance 2.0; BytePlus states no special ratio/duration constraints for 2.5. Prompt length is not documented: 2000 chars is our cap.' },
    vocab: { 'dolly in': 'slow push-in', 'dolly out': 'pull-back', 'truck left': 'lateral track left', 'truck right': 'lateral track right', 'crane up': 'crane shot rising', 'crane down': 'crane shot descending', 'whip pan': 'whip pan', orbit: 'orbiting shot', tracking: 'tracking shot', static: 'locked-off shot', handheld: 'handheld shot' } }),
  D({ id: 'h3', name: 'H3', notes: 'Labelled blocks (Subject / Action / Camera / Look); camera move stated first inside the Camera block.', layout: 'tagged', order: ['subject', 'action', 'camera', 'framing', 'lighting', 'fx', 'style'], labels: { subject: 'Subject', action: 'Action', camera: 'Camera', framing: 'Framing', lighting: 'Lighting', fx: 'Effects', style: 'Look' }, maxChars: 1500, timestamps: 'at', negative: 'field', controls: ['firstFrame', 'reference', 'pose', 'depth'], maxDuration: 10,
    vocab: { 'dolly in': 'push in', 'dolly out': 'pull out', orbit: '360 orbit', 'crane up': 'crane up', 'whip pan': 'whip pan', tracking: 'follow shot', static: 'static shot', 'dolly zoom': 'dolly zoom (vertigo)' } }),
  D({ id: 'kling', name: 'Kling', layout: 'prose', order: ['subject', 'action', 'camera', 'framing', 'lighting', 'fx', 'style'], maxChars: 2500, timestamps: 'none', negative: 'field', controls: ['firstFrame', 'lastFrame', 'reference'], maxDuration: 10, durations: [5, 10],
    verified: { on: '2026-11-18', sources: ['https://kling.ai/document-api/api/video/2-1-master/text-to-video.md (prompt and negative_prompt ≤ 2500 chars)', 'https://novita.ai/docs/api-reference/model-apis-kling-v2.6-pro-t2v.md (duration 5 or 10)'], notes: 'Kling v3.0 accepts 3–15 s; raise maxDuration for v3 endpoints.' }, vocab: { 'truck left': 'camera moves left', 'truck right': 'camera moves right', 'dolly in': 'camera pushes in', 'dolly out': 'camera pulls back' } }),
  D({ id: 'veo', name: 'Veo', layout: 'prose', order: ['framing', 'subject', 'action', 'camera', 'lighting', 'fx', 'style'], maxChars: 3000, timestamps: 'at', negative: 'field', controls: ['firstFrame', 'lastFrame', 'reference'], maxDuration: 8, durations: [4, 6, 8], aspects: ['16:9', '9:16'],
    verified: { on: '2026-11-18', sources: ['https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation (durationSeconds 4/6/8 for Veo 3; aspectRatio 16:9, 9:16; negativePrompt)', 'https://ai.google.dev/gemini-api/docs/video'], notes: 'Prompt length is token-limited, not character-limited; 3000 chars is our cap.' } }),
  D({ id: 'runway', name: 'Runway', notes: 'Camera first, then scene; short. Requests need X-Runway-Version; promptText is optional for most models.', layout: 'prose', order: ['camera', 'framing', 'subject', 'action', 'lighting', 'style', 'fx'], maxChars: 1000, timestamps: 'none', negative: 'none', controls: ['firstFrame', 'video', 'depth'], maxDuration: 10,
    verified: { on: '2026-11-18', sources: ['https://skills.sh/runwayml/skills/rw-api-reference (promptText ~1000 chars; duration 2–10 s, model-specific)'], notes: 'From Runway-published API reference skill, not the primary docs (docs.dev.runwayml.com was unreachable from this session).' }, vocab: { 'dolly in': 'the camera pushes in', 'dolly out': 'the camera pulls out', static: 'static camera', handheld: 'handheld camera' } }),
  D({ id: 'luma', name: 'Luma', layout: 'prose', maxChars: 1800, timestamps: 'none', controls: ['firstFrame', 'lastFrame'], maxDuration: 9 }),
  D({ id: 'wan', name: 'Wan / open-weights (ControlNet-style)', notes: 'Short prose; accepts dense control passes.', layout: 'prose', order: ['subject', 'action', 'camera', 'lighting', 'style', 'framing', 'fx'], maxChars: 800, timestamps: 'none', negative: 'field', controls: ['clay', 'depth', 'pose', 'canny', 'id', 'flow', 'firstFrame'], maxDuration: 8 }),
  D({ id: 'mock', name: 'Mock (offline)', layout: 'prose', maxChars: 4000, controls: ['clay', 'depth', 'id', 'pose', 'firstFrame'], maxDuration: 60 }),
];
const registry = new Map<string, Dialect>(BUILTIN.map((d) => [d.id, d]));
export function registerDialect(raw: unknown): Dialect { const d = DialectS.parse(raw); registry.set(d.id, d); return d; }
export const getDialect = (id: string): Dialect => registry.get(id) ?? registry.get('canonical')!;
export const listDialects = (): Dialect[] => [...registry.values()];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function applyVocab(text: string, vocab: Record<string, string>): string {
  for (const k of Object.keys(vocab).sort((a, b) => b.length - a.length)) text = text.replace(new RegExp(`\\b${esc(k)}\\b`, 'gi'), (m) => (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? vocab[k][0].toUpperCase() + vocab[k].slice(1) : vocab[k]));
  return text;
}
/** Timestamp styles: canonical action text marks beats as "[a–bs]" ; dialects restyle or strip them. */
function restamp(text: string, mode: Dialect['timestamps']): string {
  return text.replace(/\[(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s\]\s*/g, (_m, a, b) => (mode === 'range' ? `[${a}–${b}s] ` : mode === 'at' ? `At ${a}s, ` : '')).replace(/At (\d+(?:\.\d+)?)s, ([A-Z])/g, (_m, a, c) => `At ${a}s, ${c}`);
}
const sentence = (s: string) => { s = s.trim(); return !s ? '' : /[.!?]$/.test(s) ? s : s + '.'; };

/** Assemble provider text from canonical segments. Deterministic. Returns per-segment rendered text too, for diff-aware merges. */
export function assemble(seg: Segments, d: Dialect, negative = ''): { text: string; rendered: Record<string, string>; dropped: SegKey[]; negative: string } {
  const rendered: Record<string, string> = {};
  for (const k of d.order) { const raw = seg[k]?.trim(); if (!raw) continue; let t = sentence(applyVocab(restamp(raw, d.timestamps), d.vocab)); if (d.layout === 'tagged') t = `${d.labels[k] ?? k[0].toUpperCase() + k.slice(1)}: ${t}`; rendered[k] = t; }
  if (d.negative === 'inline' && negative) rendered.negative = `Avoid: ${negative}.`;
  const keys = (): string[] => [...d.order.filter((k) => rendered[k]), ...(rendered.negative ? ['negative'] : [])];
  const join = () => d.prefix + keys().map((k) => (d.layout === 'timeline' && k === 'action' ? rendered[k].replace(/\s*(?=\[\d)/g, '\n').trim() : rendered[k])).join(d.layout === 'prose' ? ' ' : '\n') + d.suffix;
  const dropped: SegKey[] = [];
  for (const k of d.dropOrder) { if (join().length <= d.maxChars) break; if (rendered[k]) { delete rendered[k]; dropped.push(k); } }
  let text = join(); if (text.length > d.maxChars) text = text.slice(0, d.maxChars - 1).replace(/\s+\S*$/, '') + '…';
  return { text, rendered, dropped, negative: d.negative === 'field' ? negative : '' };
}
