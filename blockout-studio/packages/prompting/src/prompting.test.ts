import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyOp, batch, demoProject, emptyProject, runContinuity, shotFacts, diffProjects, evalCharacter, type Op } from '@blockout/core';
import * as P from './index';

const demo = demoProject();
const apply = (p = demo, ops: Op[]) => applyOp(p, batch('t', ops)).project;

describe('dialects', () => {
  const seg = P.describeShot(demo, shotFacts(demo, demo.shots[0]));
  it('canonical description is written from facts', () => { expect(seg.action).toMatch(/\[0\.0–2\.6s\] Kenji sprints 16\.8 m/); expect(seg.camera).toMatch(/fast tracking following Kenji/); expect(seg.camera).toMatch(/35mm normal lens/); expect(seg.framing).toMatch(/^Overhead-angle extreme wide shot of Kenji/); expect(seg.lighting).toMatch(/golden-hour/); expect(seg.fx).toMatch(/dust/); expect(seg.subject).toMatch(/grey haori/); });
  it('each dialect applies its own grammar, vocabulary and limits', () => {
    const s4 = P.describeShot(demo, shotFacts(demo, demo.shots[3])), s2 = P.describeShot(demo, shotFacts(demo, demo.shots[1]));
    expect(P.assemble(s2, P.getDialect('seedance')).text).toMatch(/slow push-in|push-in/); expect(P.assemble(s2, P.getDialect('seedance')).text).toMatch(/\n\[0\.0–/);
    const h3 = P.assemble(s4, P.getDialect('h3')).text; expect(h3).toMatch(/^Subject: /); expect(h3).toMatch(/\nCamera: .*360 orbit/); expect(h3).toMatch(/At 0\.0s, /);
    expect(P.assemble(s4, P.getDialect('kling')).text).not.toMatch(/\[\d/); expect(P.assemble(s2, P.getDialect('runway')).text).toMatch(/^Camera: /);
    for (const d of P.listDialects()) expect(P.assemble(s4, d, 'blur').text.length).toBeLessThanOrEqual(d.maxChars);
    expect(P.assemble(s4, P.getDialect('wan')).dropped.length).toBeGreaterThan(0);
  });
  it('new dialects are plugins (data), not code', () => { P.registerDialect({ id: 'my-model', name: 'Mine', layout: 'tagged', maxChars: 300, vocab: { orbit: 'ARC SHOT' }, order: ['camera', 'action'] }); const t = P.assemble(P.describeShot(demo, shotFacts(demo, demo.shots[3])), P.getDialect('my-model')).text; expect(t).toMatch(/^Camera: .*ARC SHOT/); expect(t.length).toBeLessThanOrEqual(300); expect(() => P.registerDialect({ id: 'Bad Id' })).toThrow(); });
});

describe('edit-aware prompt compiler', () => {
  const compileAll = (p = demo, providers = ['canonical', 'seedance']) => apply(p, P.promptOps(p.shots.flatMap((s) => providers.map((pr) => P.compileShot(p, s.id, pr))), 'local', 1));
  it('editing a path makes only the affected shots stale, and recompiling rewrites only changed segments', () => {
    const p1 = compileAll(); expect(P.stalePrompts(p1)).toEqual([]);
    const p2 = apply(p1, [{ type: 'setLens', cameraId: 'cam2', focal: 85 }]);
    expect(new Set(P.stalePrompts(p2).map((s) => s.shotId))).toEqual(new Set(['s2'])); expect(diffProjects(p1, p2).map((d) => d.shotId)).toEqual(['s2']);
    const c = P.compileShot(p2, 's2', 'canonical'); expect(c.changed).toContain('camera'); expect(c.changed).not.toContain('style'); expect(c.changed).not.toContain('lighting'); expect(c.text).toMatch(/85mm portrait lens/); expect(c.previous!.text).toMatch(/28mm wide lens/);
    expect(P.compileShot(p2, 's1', 'canonical').unchanged).toBe(true);
    const p3 = apply(p2, P.promptOps([c, P.compileShot(p2, 's2', 'seedance')], 'local', 2)); expect(P.stalePrompts(p3)).toEqual([]); expect(P.lineage(p3, p3.prompts.active.s2.canonical).length).toBe(2);
  });
  it("keeps the user's manual wording where it still applies", () => {
    const p1 = compileAll(), v = P.activePrompt(p1, 's2', 'canonical')!, mine = v.text.replace(v.segments!.style, 'Looks like a Ghibli background painting, thick gouache.');
    const p2 = apply(p1, [{ type: 'addPromptVersion', activate: true, version: { ...v, id: 'user1', text: mine, author: 'user', parent: v.id } }, { type: 'setLens', cameraId: 'cam2', focal: 85 }]);
    const c = P.compileShot(p2, 's2', 'canonical'); expect(c.text).toMatch(/thick gouache/); expect(c.text).toMatch(/85mm portrait lens/); expect(c.text).not.toMatch(/28mm/);
    // hand-edited the very segment that changed: wording is kept and the conflict is reported
    const mine2 = v.text.replace(v.segments!.camera, 'Camera creeps forward like a predator.'), p4 = apply(p1, [{ type: 'addPromptVersion', activate: true, version: { ...v, id: 'user2', text: mine2, author: 'user' } }, { type: 'setLens', cameraId: 'cam2', focal: 85 }]);
    const c4 = P.compileShot(p4, 's2', 'canonical'); expect(c4.text).toMatch(/creeps forward like a predator/); expect(c4.conflicts).toEqual(['camera']);
  });
  it('word diff hunks can be accepted or rejected individually', () => {
    const parts = P.wordDiff('a slow dolly in on a 28mm wide lens at dusk', 'a fast dolly in on an 85mm portrait lens at dusk'), hunks = parts.filter((x) => x.kind === 'hunk');
    expect(hunks.length).toBe(2); expect(P.applyHunks(parts, 'all')).toBe('a fast dolly in on an 85mm portrait lens at dusk'); expect(P.applyHunks(parts, new Set())).toBe('a slow dolly in on a 28mm wide lens at dusk'); expect(P.applyHunks(parts, new Set([1]))).toBe('a slow dolly in on an 85mm portrait lens at dusk');
  });
});

describe('offline director', () => {
  it('"Have the grey ronin circle him twice, then lunge as the camera cranes up."', () => {
    const out = P.directLocal(demo, { instruction: 'Have the grey ronin circle him twice, then lunge as the camera cranes up.', t: 3.4, activeShotId: 's3' });
    expect(out.question).toBeUndefined(); const kinds = out.ops.map((o) => o.type);
    expect(kinds.filter((k) => k === 'addPathKey').length).toBeGreaterThanOrEqual(13); expect(kinds).toContain('addCamera'); expect(kinds).toContain('addShot');
    const keys = out.ops.filter((o): o is Extract<Op, { type: 'addPathKey' }> => o.type === 'addPathKey'); expect(keys.every((k) => k.characterId === 'kenji')).toBe(true); expect(keys.some((k) => k.key.clip === 'thrust')).toBe(true);
    const p = apply(demo, out.ops), ren = evalCharacter(p, p.characters.ren, 5).pos, k = evalCharacter(p, p.characters.kenji, 5).pos, d = Math.hypot(k[0] - ren[0], k[2] - ren[2]); expect(d).toBeGreaterThan(1.4); expect(d).toBeLessThan(4.2);
    const shot = p.shots.find((s) => /crane/i.test(s.name))!; expect(shotFacts(p, shot).camera.motion.type).toBe('crane up'); expect(out.reply).toMatch(/Kenji circles Ren 2×/);
  });
  it('asks one clarifying question when ambiguous', () => { const p = apply(demo, [{ type: 'addCharacter', character: { ...demo.characters.ren, id: 'c3', name: 'Aki', idColor: '#123456' } }]); const out = P.directLocal(p, { instruction: 'Kenji walks to him', t: 0 }); expect(out.ops).toEqual([]); expect(out.question).toMatch(/target/i); });
  it('handles lens, lighting, aspect and fx commands', () => { const out = P.directLocal(demo, { instruction: 'set the lens to 85mm, make it night and add rain', t: 0, activeShotId: 's2' }); expect(out.ops.map((o) => o.type).sort()).toEqual(['addFx', 'setLens', 'setLighting']); });
  it('script → blockout produces characters, set, paths, coverage and bibles as one valid proposal', () => {
    const script = `EXT. BURNED FOREST - NIGHT\n\nMARA (40s, soot-streaked coat) walks toward JONAH, who waits among the trees with a lantern.\n\nMARA\nYou should not have come back.\n\nJonah draws his sword and lunges at Mara. Mara dodges. Smoke drifts across the clearing.\n\nJONAH\nNeither should you.\n\nJonah falls.`;
    const out = P.scriptToBlockoutLocal(emptyProject('x', 'X'), script), p = apply(emptyProject('x', 'X'), out.ops);
    expect(Object.values(p.characters).map((c) => c.name).sort()).toEqual(['Jonah', 'Mara']); expect(p.shots.length).toBeGreaterThanOrEqual(4); expect(p.shots.some((s) => /Master/.test(s.name))).toBe(true); expect(p.shots.some((s) => /Single/.test(s.name))).toBe(true);
    expect(Object.keys(p.scatter).length).toBe(1); expect(Object.values(p.fx).map((f) => f.kind)).toContain('smoke'); expect(p.lighting.timeOfDay).toBeGreaterThan(22); expect(p.bibles.characters[Object.values(p.characters).find((c) => c.name === 'Mara')!.id].appearance).toMatch(/soot/);
    expect(runContinuity(p).filter((i) => i.kind === 'axis-180')).toEqual([]); // coverage respects the line
    expect(Object.values(p.characters).find((c) => c.name === 'Jonah')!.keys.map((k) => k.clip)).toEqual(expect.arrayContaining(['thrust', 'fall']));
  });
  it('alternates stay on the established side of the 180° line', () => { const alts = P.alternatesLocal(demo, 's3', 3); expect(alts).toHaveLength(3); const cur = P.cameraSide(demo, demo.cameras.cam3, 'kenji', 'ren', 5.3); for (const a of alts) for (const t of [4.6, 5.3, 5.99]) expect(P.cameraSide(demo, a.camera, 'kenji', 'ren', t)).toBe(cur); });
  it('continuity review offers a fix that actually removes the 180° violation', () => {
    const rev = P.continuityLocal(demo), item = rev.items.find((i) => i.id.startsWith('axis-180:s4>s5'))!; expect(item.fix).toBeTruthy();
    const fixed = apply(demo, item.fix!.ops); expect(runContinuity(fixed).some((i) => i.id.startsWith('axis-180:s4>s5'))).toBe(false);
  });
  it('bible review flags preference violations and proposes fixes', () => {
    const p = apply(demo, [{ type: 'setCameraKey', cameraId: 'cam2', keyId: 'c2k0', patch: { roll: 0.4 } }, { type: 'setCameraKey', cameraId: 'cam2', keyId: 'c2k1', patch: { roll: 0.4 } }, { type: 'setProject', patch: { aspect: '16:9' } }]), r = P.bibleReviewLocal(p);
    expect(r.violations.map((v) => v.memoryId).sort()).toEqual(['mem1', 'mem2']); const fixed = apply(p, r.violations.flatMap((v) => v.fix!.ops)); expect(P.bibleReviewLocal(fixed).violations).toEqual([]);
    expect(P.extractPreferences('Nice. I hate dutch angles. Also move him left.')).toEqual(['I hate dutch angles.']);
  });
});

describe('ClaudeBackend contract', () => {
  const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));
  const INPUTS: { [K in P.TaskName]: P.TaskInputs[K] } = { direct: { instruction: 'Ren steps back two metres as Kenji advances', t: 4.6, activeShotId: 's3' }, scriptToBlockout: { script: 'EXT. FIELD - DUSK\nA third swordsman, HARU, watches from the tree.' }, compilePrompts: { shotIds: ['s2'] }, critique: { shotId: 's4', takeId: 'none', metrics: { iou: 0.62 } }, continuity: {}, alternates: { shotId: 's3', count: 3 }, bibleReview: {}, storyboard: {} };
  it('every task has a schema, a request builder and a local implementation that validates', async () => {
    const be = new P.LocalBackend();
    for (const task of P.TASK_NAMES) { const req = P.buildRequest(demo, task, INPUTS[task] as never); expect(req.system).toMatch(/MEASURED facts/); expect(req.stable).toMatch(/Style bible/); expect(req.jsonSchema).toHaveProperty('type', 'object'); const r = await P.runTask(be, task, INPUTS[task] as never, demo); expect(r.attempts).toBe(1); }
  });
  it('stable context is byte-identical across tasks (cacheable) and excludes volatile scene state', () => { const a = P.buildRequest(demo, 'direct', INPUTS.direct).stable, b = P.buildRequest(apply(demo, [{ type: 'setLens', cameraId: 'cam2', focal: 85 }]), 'continuity', {}).stable; expect(a).toBe(b); });
  it.each(readdirSync(dir).filter((f) => f.endsWith('.json')))('fixture %s validates against its task schema and applies to the demo', async (file) => {
    const fx = JSON.parse(readFileSync(dir + file, 'utf8')) as { task: P.TaskName; responses: string[]; expectAttempts: number };
    const be = new P.FixtureBackend({ [fx.task]: [...fx.responses] }), seen: string[] = [], r = await P.runTask(be, fx.task, INPUTS[fx.task] as never, demo, (t) => seen.push(t));
    expect(r.attempts).toBe(fx.expectAttempts); if (fx.expectAttempts === 2) { expect(seen.join(' ')).toMatch(/retrying once/); expect(be.requests[1].user).toMatch(/rejected by the validator/); }
  });
  it('retries exactly once, then surfaces the schema failure', async () => { const be = new P.FixtureBackend({ direct: ['not json', '{"reply": 1}'] }); await expect(P.runTask(be, 'direct', INPUTS.direct, demo)).rejects.toThrow(/failed schema validation twice/); expect(be.requests).toHaveLength(2); });
  it('rejects ops that would not apply (so proposals never fail on accept)', () => { expect(() => P.validateTask(demo, 'direct', { reply: 'x', title: 'x', ops: [{ type: 'setLens', cameraId: 'nope', focal: 50 }] })).toThrow(/do not apply/); });
});
