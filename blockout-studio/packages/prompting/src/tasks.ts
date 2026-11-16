/** Claude task registry. Each task = zod output schema + instructions + a prompt built from *facts* + a local fallback.
 *  The stable half of the context (bibles, op reference, memory) is separated so API mode can cache it. */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CameraS, CritiqueS, OP_TYPES, OpS, applyOp, batch, runContinuity, shotFacts, diffProjects, allShotFacts, type ContinuityIssue, type Op, type Project, type ShotDiff } from '@blockout/core';
import { SEGMENTS, type Segments } from './dialects';
import { activePrompt, describeShot } from './compiler';
import { alternatesLocal, bibleReviewLocal, continuityLocal, critiqueLocal, directLocal, scriptToBlockoutLocal, storyboardLocal, type DirectInput, type TakeMetrics } from './director';

const OpsS = z.array(OpS);
const FixS = z.object({ title: z.string(), ops: OpsS });
export const OUTPUTS = {
  direct: z.object({ reply: z.string(), title: z.string(), question: z.string().optional(), ops: OpsS }),
  scriptToBlockout: z.object({ title: z.string(), rationale: z.string(), ops: OpsS }),
  compilePrompts: z.object({ shots: z.array(z.object({ shotId: z.string(), segments: z.object(Object.fromEntries(SEGMENTS.map((k) => [k, z.string()])) as Record<(typeof SEGMENTS)[number], z.ZodString>), note: z.string().default('') })) }),
  critique: CritiqueS,
  continuity: z.object({ summary: z.string(), items: z.array(z.object({ id: z.string(), priority: z.number(), explanation: z.string(), fix: FixS.optional() })) }),
  alternates: z.object({ alternatives: z.array(z.object({ name: z.string(), rationale: z.string(), camera: CameraS })).min(1) }),
  bibleReview: z.object({ amendments: z.array(z.object({ target: z.string(), field: z.string(), value: z.string(), reason: z.string() })), violations: z.array(z.object({ memoryId: z.string(), text: z.string(), fix: FixS.optional() })) }),
  storyboard: z.object({ panels: z.array(z.object({ shotId: z.string(), title: z.string(), size: z.string(), action: z.string(), camera: z.string() })) }),
} as const;
export type TaskName = keyof typeof OUTPUTS;
export type TaskOutput<T extends TaskName> = z.infer<(typeof OUTPUTS)[T]>;
export interface TaskInputs {
  direct: DirectInput; scriptToBlockout: { script: string }; compilePrompts: { shotIds: string[]; changes?: ShotDiff[] };
  critique: { shotId: string; takeId: string; metrics: TakeMetrics; provider?: string }; continuity: { issues?: ContinuityIssue[] }; alternates: { shotId: string; count?: number };
  bibleReview: Record<string, never>; storyboard: Record<string, never>;
}
export const TASK_NAMES = Object.keys(OUTPUTS) as TaskName[];

const OP_REFERENCE = `Edits are expressed ONLY as ops from this closed set: ${OP_TYPES.join(', ')}.
Common shapes (ids are strings you invent for new things, must be unique):
- {"type":"addPathKey","characterId":ID,"key":{"id":ID,"t":seconds,"pos":[x,0,z],"clip":"idle|walk|run|sprint|crouch|jump|slash|thrust|block|dodge|hitReact|fall|sit|point|talk","facing":{"mode":"path"}|{"mode":"target","targetId":ID}|{"mode":"fixed","yaw":radians},"ease":"linear|easeIn|easeOut|easeInOut|hold","speed":1}}
- {"type":"moveKeyframe","target":{"kind":"character|camera","id":ID},"keyId":ID,"t":seconds,"pos":[x,y,z]} · {"type":"setPathKey","characterId":ID,"keyId":ID,"patch":{...}} · {"type":"removeKeyframe","target":{...},"keyId":ID}
- {"type":"addCamera","camera":{"id":ID,"name":str,"sensorWidth":36,"shake":{"profile":"none|handheld|runAndGun|earthquake","amount":1,"seed":1},"keys":[{"id":ID,"t":s,"pos":[x,y,z],"target":[x,y,z],"focal":mm,"focus":m,"fstop":2.8,"roll":0,"ease":"easeInOut"}],"lookAt":{"characterId":ID,"offset":[0,1.4,0]}?,"attach":{"characterId":ID,"lag":0.2}?}}
- {"type":"setLens","cameraId":ID,"focal":mm} · {"type":"setCameraKey","cameraId":ID,"keyId":ID,"patch":{...}} · {"type":"updateCamera","id":ID,"patch":{...}}
- {"type":"addShot","shot":{"id":ID,"name":str,"cameraId":ID,"start":s,"end":s,"notes":"","transition":{"kind":"cut","duration":0},"audioLead":0,"audioTail":0,"trimIn":0,"trimOut":0,"twoStage":false},"index":n?} · updateShot · removeShot · reorderShots{"order":[IDs]}
- {"type":"retimeSegment","start":s,"end":s,"newEnd":s,"ripple":true} · {"type":"setLighting","patch":{"timeOfDay":0-24,"skyColor":"#rrggbb"}} · {"type":"setProject","patch":{"duration":s,"aspect":"16:9|9:16|1:1|2.39:1|4:3"}}
- {"type":"addCharacter","character":{"id":ID,"name":str,"idColor":"#rrggbb","height":1.75,"build":1,"held":{"kind":"none|sword|staff|pistol|rifle|shield|lantern","hand":"R"},"interp":"catmull","keys":[...],"poseKeys":[]}} · addProp · addFx · addScatter · setStyleBible{"patch"} · setCharacterBible{"characterId","patch"}
World: metres, +Y up, ground at y=0, characters face +Z at yaw 0. Path key positions use y=0. Times are scene seconds.`;

/** Stable context: identical between calls until the bibles/memory change, so it is cacheable. */
export function stableContext(p: Project): string {
  const chars = Object.values(p.characters).map((c) => { const b = p.bibles.characters[c.id]; return `- ${c.name} (id ${c.id}, mask colour ${c.idColor}, ${c.height} m, holds ${c.held.kind}): ${b ? [b.appearance, b.wardrobe, b.weapon, b.silhouette].filter(Boolean).join('; ') || 'no description' : 'no description'}`; }).join('\n');
  const mem = Object.values(p.memory).map((m) => `- [${m.kind}] ${m.text}`).join('\n');
  return `# Blockout Studio project context\n\n## How edits work\n${OP_REFERENCE}\n\n## Style bible\n${JSON.stringify(p.bibles.style, null, 1)}\n\n## Character bible\n${chars || '(no characters)'}\n\n## Director's standing preferences (session memory)\n${mem || '(none recorded)'}\n`;
}
const SYSTEM = `You are the director, cinematographer, prompt writer and critic inside Blockout Studio, a 3D previs tool for generative video.
Division of labour: geometry decides staging and timing, you decide the words, the video model decides the look.
You are given MEASURED facts derived from splines (camera movement class, lens class, shot size, angle, timed action beats). Treat them as ground truth: never contradict them and never invent staging that is not in them.
Respect the director's standing preferences. Everything you change is a proposal the user reviews; be concrete and minimal.
Reply with a single JSON object that matches the provided JSON schema. No prose outside the JSON, no markdown fences.`;

function inventory(p: Project): string {
  return JSON.stringify({ fps: p.fps, duration: p.duration, aspect: p.aspect, characters: Object.values(p.characters).map((c) => ({ id: c.id, name: c.name, keys: c.keys.map((k) => ({ id: k.id, t: k.t, pos: k.pos, clip: k.clip })) })), cameras: Object.values(p.cameras).map((c) => ({ id: c.id, name: c.name, lookAt: c.lookAt?.characterId, attach: c.attach?.characterId, keys: c.keys.map((k) => ({ id: k.id, t: k.t, pos: k.pos, target: k.target, focal: k.focal })) })), shots: p.shots.map((s) => ({ id: s.id, name: s.name, cameraId: s.cameraId, start: s.start, end: s.end })), fx: Object.values(p.fx).map((f) => ({ id: f.id, kind: f.kind })), props: Object.values(p.props).map((x) => ({ id: x.id, kind: x.kind, pos: x.pos })) });
}
type Def<T extends TaskName> = { title: string; instructions: string; user(p: Project, input: TaskInputs[T]): string; local(p: Project, input: TaskInputs[T]): TaskOutput<T>; vision?: boolean };
export const TASKS: { [T in TaskName]: Def<T> } = {
  direct: { title: 'Natural-language direction',
    instructions: 'Turn the instruction into ops. Compute real coordinates and times from the scene inventory. If the instruction is genuinely ambiguous (unclear who or what), return ops: [] and ask exactly one question in "question". "reply" is one or two sentences describing what the ops do. "title" is a short label for the undo history.',
    user: (p, i) => `Instruction: ${JSON.stringify(i.instruction)}\nPlayhead: ${i.t}s. Selected entity: ${i.selectionId ?? 'none'}. Active shot: ${i.activeShotId ?? 'none'}.\nScene inventory:\n${inventory(p)}\nShot facts:\n${JSON.stringify(allShotFacts(p))}`,
    local: (p, i) => directLocal(p, i) },
  scriptToBlockout: { title: 'Script → blockout',
    instructions: 'Read the script and return ONE batch of ops that creates: the characters (with ids, mask colours, starting keys), a rough set (props/scatter/fx), blocking paths with timed clips, cameras, and a shot list with coverage (a master, singles, inserts) that respects the 180° rule. Fill the character bible from the text. "rationale" explains the coverage plan briefly.',
    user: (p, i) => `Existing project (extend it, do not duplicate ids):\n${inventory(p)}\n\nScript:\n"""\n${i.script}\n"""`, local: (p, i) => scriptToBlockoutLocal(p, i.script) },
  compilePrompts: { title: 'Prompt compiler',
    instructions: `For each requested shot write the canonical description as seven segments: ${SEGMENTS.join(', ')}. Use the measured facts for every staging and camera statement; put action beats in order, each prefixed with its time range like "[0.0–2.6s]". Pull look and character wording from the bibles. A dialect layer converts your segments into each provider's grammar, so write provider-neutral prose with standard camera terms (dolly in, truck left, crane up, orbit, whip pan, tracking, static, handheld). When a current segment is supplied and the listed changes do not affect it, return it VERBATIM — the user may have hand-edited it. "note" says what you changed and why, in one sentence.`,
    user: (p, i) => JSON.stringify(i.shotIds.map((id) => { const shot = p.shots.find((s) => s.id === id)!, f = shotFacts(p, shot), cur = activePrompt(p, id, 'canonical'); return { shotId: id, facts: f, changesSinceLastPrompt: i.changes?.find((c) => c.shotId === id)?.changes ?? (cur ? ['(no recorded diff; compare facts with the current text)'] : ['first compile']), currentSegments: cur?.segments ?? null, currentText: cur?.text ?? null, draftFromFacts: describeShot(p, f) }; }), null, 1),
    local: (p, i) => ({ shots: i.shotIds.map((id) => { const shot = p.shots.find((s) => s.id === id)!; return { shotId: id, segments: describeShot(p, shotFacts(p, shot)) as Segments, note: 'Written from measured facts by the offline compiler.' }; }) }) },
  critique: { title: 'Vision critique', vision: true,
    instructions: 'You are shown pairs of frames: the blockout (control) frame and the generated result frame at the same time. Score 0–10: staging (do subjects sit where the blockout puts them, same screen direction and size), character (consistency with the character bible and across frames), style (adherence to the style bible), artifacts (10 = clean; look for warped limbs, extra fingers, flicker, identity drift). List concrete issues with a timestamp where possible, and concrete fixes: a prompt change (give the edited sentence), a stronger control pass (name it), a different seed, a re-staged moment, or a reference image. The numeric mask-IoU measured locally is provided; let it inform staging.',
    user: (p, i) => { const shot = p.shots.find((s) => s.id === i.shotId)!, take = p.takes[i.takeId]; return `Shot facts: ${JSON.stringify(shotFacts(p, shot))}\nPrompt used: ${JSON.stringify(take?.prompt ?? '')}\nProvider: ${take?.providerId}. Seed ${take?.seed}.\nLocal metrics: ${JSON.stringify(i.metrics)}`; },
    local: (p, i) => critiqueLocal(p, i.shotId, i.metrics) },
  continuity: { title: 'Continuity supervisor',
    instructions: 'The findings below were computed geometrically and are facts; do not add findings of your own. Explain each in one or two plain sentences (why an audience would notice), order them by importance (priority 1 = fix first), and where a safe fix exists return it as ops. "summary" is two sentences for the director.',
    user: (p, i) => `Findings:\n${JSON.stringify(i.issues ?? runContinuity(p), null, 1)}\nScene inventory:\n${inventory(p)}`, local: (p, i) => continuityLocal(p, i.issues) },
  alternates: { title: 'Alternate camera setups',
    instructions: 'Propose alternate camera setups for the shot as complete camera objects (new ids). Each must stay on the same side of the 180° line as the current camera (the side is given), cover the same time range, and differ meaningfully in size, angle or movement. One-sentence rationale each.',
    user: (p, i) => { const shot = p.shots.find((s) => s.id === i.shotId)!; return `Shot: ${JSON.stringify(shot)}\nFacts: ${JSON.stringify(shotFacts(p, shot))}\nCurrent camera: ${JSON.stringify(p.cameras[shot.cameraId])}\nHow many: ${i.count ?? 3}\nReference alternatives from the rule-based planner (improve on these): ${JSON.stringify(alternatesLocal(p, i.shotId, i.count ?? 3).map((a) => ({ name: a.name, keys: a.camera.keys.map((k) => ({ t: k.t, pos: k.pos, focal: k.focal })) })))}\nScene inventory:\n${inventory(p)}`; },
    local: (p, i) => ({ alternatives: alternatesLocal(p, i.shotId, i.count ?? 3) }) },
  bibleReview: { title: 'Living bibles',
    instructions: 'Compare the bibles and the director\'s preferences with what the blockout and prompts actually contain. Propose amendments (target is "style" or a character id; field is a bible field name) only where there is drift or a gap, each with a reason. Report violations of recorded preferences with a fix as ops when one is safe.',
    user: (p) => `Facts for every shot:\n${JSON.stringify(allShotFacts(p))}\nActive prompts:\n${JSON.stringify(Object.fromEntries(p.shots.map((s) => [s.id, Object.fromEntries(Object.entries(p.prompts.active[s.id] ?? {}).map(([k, v]) => [k, p.prompts.versions[v]?.text]))])))}\nRule-based draft: ${JSON.stringify(bibleReviewLocal(p))}`, local: (p) => bibleReviewLocal(p) },
  storyboard: { title: 'Storyboard notes',
    instructions: 'Write storyboard panel notes for each shot: "action" is one or two present-tense sentences a crew could shoot from; "camera" is the camera note; "size" is the shot size. Stay within the facts.',
    user: (p) => `Facts:\n${JSON.stringify(allShotFacts(p))}\nDraft: ${JSON.stringify(storyboardLocal(p))}`, local: (p) => ({ panels: storyboardLocal(p) }) },
};

export interface TaskImage { label: string; mediaType: 'image/png' | 'image/jpeg'; base64: string }
export interface TaskRequest { task: TaskName; system: string; stable: string; user: string; jsonSchema: Record<string, unknown>; images?: TaskImage[] }
const schemaCache = new Map<string, Record<string, unknown>>();
export function outputJsonSchema(task: TaskName): Record<string, unknown> {
  let s = schemaCache.get(task); if (!s) { s = zodToJsonSchema(OUTPUTS[task], { $refStrategy: 'root', target: 'jsonSchema7' }) as Record<string, unknown>; schemaCache.set(task, s); } return s;
}
export function buildRequest<T extends TaskName>(p: Project, task: T, input: TaskInputs[T], images?: TaskImage[]): TaskRequest {
  const def = TASKS[task];
  return { task, system: `${SYSTEM}\n\nTask: ${def.title}. ${def.instructions}`, stable: stableContext(p), user: def.user(p, input), jsonSchema: outputJsonSchema(task), images };
}
export class TaskValidationError extends Error { constructor(msg: string, readonly raw?: string) { super(msg); this.name = 'TaskValidationError'; } }
/** Extract the first balanced JSON object from model text (tolerates fences and preamble). */
export function extractJson(text: string): unknown {
  const s = text.indexOf('{'); if (s < 0) throw new TaskValidationError('response contains no JSON object', text);
  let depth = 0, inStr = false, escNext = false;
  for (let i = s; i < text.length; i++) { const c = text[i]; if (inStr) { if (escNext) escNext = false; else if (c === '\\') escNext = true; else if (c === '"') inStr = false; continue; } if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(s, i + 1)); } catch (e) { throw new TaskValidationError(`invalid JSON: ${(e as Error).message}`, text); } } }
  throw new TaskValidationError('unterminated JSON object', text);
}
const collectOps = (v: unknown, out: Op[][] = []): Op[][] => { if (Array.isArray(v)) v.forEach((x) => collectOps(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'ops' && Array.isArray(x)) out.push(x as Op[]); else collectOps(x, out); } return out; };
/** zod-validate a task response AND dry-run any ops against the project, so a proposal can never fail on apply. */
export function validateTask<T extends TaskName>(p: Project, task: T, raw: unknown): TaskOutput<T> {
  const r = OUTPUTS[task].safeParse(typeof raw === 'string' ? extractJson(raw) : raw);
  if (!r.success) throw new TaskValidationError(r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
  for (const ops of collectOps(r.data)) if (ops.length) { try { applyOp(p, batch('dry-run', ops)); } catch (e) { throw new TaskValidationError(`ops do not apply to the project: ${(e as Error).message}`); } }
  if (task === 'compilePrompts') for (const s of (r.data as TaskOutput<'compilePrompts'>).shots) if (!p.shots.some((x) => x.id === s.shotId)) throw new TaskValidationError(`unknown shotId ${s.shotId}`);
  return r.data as TaskOutput<T>;
}
export { diffProjects };
