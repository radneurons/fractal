/** The offline director: deterministic, rule-based implementations of every Claude task. It keeps the whole app
 *  usable with no model at all, provides the baseline Claude is asked to improve on, and backs the test fixtures. */
import {
  CLIP_DEFS, characterPosition, evalCamera, evalCharacter, makeCamera, nextIdColor, shotFacts, runContinuity, SHOT_SIZE_NAMES,
  type Camera, type CameraPreset, type ContinuityIssue, type Critique, type Op, type PathKey, type Project, type Shot, type Vec3,
} from '@blockout/core';

export interface DirectInput { instruction: string; t: number; selectionId?: string; activeShotId?: string }
export interface DirectOutput { reply: string; title: string; question?: string; ops: Op[] }
const r2 = (x: number) => Math.round(x * 100) / 100;
const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const NUM: Record<string, number> = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };

/** Resolve "the grey ronin", "Ren", "him" to a character id. Returns null when unknown, 'ambiguous' when unclear. */
export function resolveCharacter(p: Project, phrase: string, exclude?: string): string | null | 'ambiguous' {
  const ids = Object.keys(p.characters), w = words(phrase);
  if (w.some((x) => ['him', 'her', 'them', 'opponent', 'other', 'enemy', 'rival'].includes(x)) || /each other/.test(phrase)) { const rest = ids.filter((i) => i !== exclude); return rest.length === 1 ? rest[0] : rest.length ? 'ambiguous' : null; }
  let best: string | null = null, bs = 0, tie = false;
  for (const id of ids) {
    if (id === exclude) continue; const c = p.characters[id], b = p.bibles.characters[id], name = words(c.name), hay = new Set(words(`${b?.appearance ?? ''} ${b?.wardrobe ?? ''} ${b?.weapon ?? ''} ${b?.silhouette ?? ''}`));
    let s = 0; for (const x of w) { if (name.includes(x)) s += 5; else if (x.length > 2 && hay.has(x)) s += 1; }
    if (s > bs) { bs = s; best = id; tie = false; } else if (s === bs && s > 0) tie = true;
  }
  return bs === 0 ? null : tie ? 'ambiguous' : best;
}
const ACTIONS: [RegExp, string, number][] = [
  [/\b(lunge|lunges|thrust|thrusts|stab|stabs)\b/, 'thrust', 0.7], [/\b(slash|slashes|strike|strikes|swing|swings|attack|attacks|cuts?)\b/, 'slash', 0.8], [/\b(block|blocks|parry|parries|guard|guards)\b/, 'block', 0.6],
  [/\b(dodge|dodges|evade|evades|sidestep|sidesteps)\b/, 'dodge', 0.6], [/\b(fall|falls|collapse|collapses|drops? to the ground|dies)\b/, 'fall', 1.4], [/\b(jump|jumps|leap|leaps)\b/, 'jump', 1.0],
  [/\b(sit|sits)\b/, 'sit', 1.2], [/\b(point|points)\b/, 'point', 1.0], [/\b(talk|talks|speak|speaks|says?|shouts?|yells?)\b/, 'talk', 2.4], [/\b(crouch|crouches|duck|ducks|kneel|kneels)\b/, 'crouch', 1.2],
  [/\b(recoil|recoils|stagger|staggers|flinch|flinches|is hit|gets hit)\b/, 'hitReact', 0.7], [/\b(wait|waits|pause|pauses|stop|stops|stand|stands|hold|holds)\b/, 'idle', 1.0],
];
const MOVES: [RegExp, string, number][] = [[/\b(sprint|sprints|dash|dashes|charge|charges|races?)\b/, 'sprint', 6.5], [/\b(run|runs|jog|jogs|rush|rushes)\b/, 'run', 3.8], [/\b(walk|walks|step|steps|approach|approaches|move|moves|stride|strides|back away|backs away|retreat|retreats)\b/, 'walk', 1.45]];
const CAM: [RegExp, CameraPreset, string][] = [
  [/\bcranes? (up|down)|\bcrane (shot|up)|\bjib\b/, 'crane', 'crane'], [/\b(push(es)?[- ]in|dolly(ing|s)? in|moves? in|track(s|ing)? in)\b/, 'pushIn', 'push-in'], [/\b(pull(s|ing)?[- ](out|back)|dolly(ing|s)? out)\b/, 'pullOut', 'pull-out'],
  [/\borbit(s|ing)?\b|\bcircl(es|ing)\b|\barcs? around\b/, 'orbit', 'orbit'], [/\btruck(s|ing)?\b|\btrack(s|ing)? (left|right|sideways|alongside)|\blateral\b/, 'truck', 'truck'], [/\bwhip[- ]?pan/, 'whipPan', 'whip pan'],
  [/\b(vertigo|dolly zoom|zolly)\b/, 'vertigo', 'dolly zoom'], [/\b(top[- ]down|overhead|bird'?s[- ]eye)\b/, 'topDown', 'top-down'], [/\b(follow(s|ing)?|chase(s)? cam|behind (him|her|them))\b/, 'follow', 'follow-cam'], [/\b(static|locked[- ]off|tripod|holds? still)\b/, 'static', 'static'],
];
const TIMES: [RegExp, number, string][] = [[/\b(golden hour|sunset|dusk|magic hour)\b/, 18.6, '#f2b36b'], [/\b(noon|midday|high sun)\b/, 12, '#8ec5ff'], [/\b(dawn|sunrise|daybreak)\b/, 5.6, '#f5c9a8'], [/\b(night|midnight|moonlit|moonlight)\b/, 23.5, '#0d1830'], [/\b(morning)\b/, 9, '#a9d4ff'], [/\b(afternoon)\b/, 15.5, '#9ecbff'], [/\b(blue hour|twilight)\b/, 19.6, '#39508a']];

export function directLocal(p: Project, input: DirectInput): DirectOutput {
  const text = input.instruction.trim(), lower = text.toLowerCase(), ops: Op[] = [], notes: string[] = [];
  let uid = 0; const id = (pre: string) => `${pre}_${Math.abs(hashStr(text + input.t)).toString(36)}${(uid++).toString(36)}`;
  const shot = p.shots.find((s) => s.id === input.activeShotId), selCam = input.selectionId && p.cameras[input.selectionId] ? input.selectionId : shot?.cameraId;
  // ---- global, non-staging commands ----
  const mm = /(\d{2,3})\s?mm\b/.exec(lower); if (mm && selCam && !/\b(circle|walk|run|sprint|lunge)\b/.test(lower)) { ops.push({ type: 'setLens', cameraId: selCam, focal: Math.min(600, Math.max(8, +mm[1])) }); notes.push(`${p.cameras[selCam].name} → ${mm[1]}mm`); }
  for (const [re, tod, sky] of TIMES) if (re.test(lower) && /\b(make|set|change|light|time|at|to|it'?s)\b/.test(lower)) { ops.push({ type: 'setLighting', patch: { timeOfDay: tod, skyColor: sky } }); notes.push(`lighting → ${re.exec(lower)![0]}`); break; }
  const asp = /\b(16:9|9:16|1:1|2\.39:1|4:3)\b/.exec(lower); if (asp) { ops.push({ type: 'setProject', patch: { aspect: asp[1] as Project['aspect'] } }); notes.push(`aspect → ${asp[1]}`); }
  const fxm = /\badd (?:some |a |an )?(rain|smoke|dust|sparks)\b/.exec(lower); if (fxm) { const kind = fxm[1] as 'rain' | 'smoke' | 'dust' | 'sparks'; ops.push({ type: 'addFx', fx: { id: id('fx'), name: kind, kind, pos: [0, 0, 0], size: kind === 'rain' ? [14, 6, 14] : [1, 1, 1], start: 0, end: 9999, idColor: nextIdColor(p), trail: 1.5 } }); notes.push(`added ${kind} proxy`); }
  if (/\bhandheld\b/.test(lower) && selCam && !/\bcamera (cranes|orbits|pushes)\b/.test(lower)) { ops.push({ type: 'updateCamera', id: selCam, patch: { shake: { profile: 'handheld', amount: 1, seed: 3 } } }); notes.push(`${p.cameras[selCam].name} → handheld`); }
  // ---- staging clauses ----
  const clauses: { text: string; link: 'seq' | 'sim' }[] = []; let rest = lower.replace(/^(please |have |make |let )/, ''), link: 'seq' | 'sim' = 'seq';
  for (;;) { const m = /,?\s*\b(and then|then|while|as|;)\b\s*|,\s+(?=the camera)/.exec(rest); if (!m) { clauses.push({ text: rest, link }); break; } clauses.push({ text: rest.slice(0, m.index), link }); link = m[1] === 'as' || m[1] === 'while' ? 'sim' : 'seq'; rest = rest.slice(m.index + m[0].length); }
  let T = Math.round(input.t * p.fps) / p.fps, prevStart = T, subject: string | null = null, target: string | null = null, tEnd = T; const t0 = T;
  const pos = new Map<string, Vec3>(), anchored = new Set<string>(), cams: { preset: CameraPreset; label: string; start: number; dir: number }[] = [];
  const where = (cid: string): Vec3 => pos.get(cid) ?? (() => { const st = evalCharacter({ ...p, terrain: { ...p.terrain, heights: [] } }, p.characters[cid], T); return [r2(st.pos[0]), 0, r2(st.pos[2])] as Vec3; })();
  const key = (cid: string, t: number, at: Vec3, clip: string, extra: Partial<PathKey> = {}) => { ops.push({ type: 'addPathKey', characterId: cid, key: { id: id('k'), t: Math.round(t * p.fps) / p.fps, pos: [r2(at[0]), 0, r2(at[2])], clip, facing: { mode: 'path' }, ease: 'linear', speed: 1, ...extra } }); pos.set(cid, at); };
  const anchor = (cid: string, t: number, clip: string, extra: Partial<PathKey> = {}) => { const c = p.characters[cid], ex = c.keys.find((k) => Math.abs(k.t - t) < 0.5 / p.fps); if (ex && !anchored.has(cid)) ops.push({ type: 'setPathKey', characterId: cid, keyId: ex.id, patch: { clip, ...extra } }); else key(cid, t + (anchored.has(cid) ? 0 : 0), where(cid), clip, extra); anchored.add(cid); };
  for (const cl of clauses) {
    const c = cl.text.trim(); if (!c) continue; const start = cl.link === 'sim' ? prevStart : T;
    if (/\bcamera\b|\bcam\b|\bshot\b/.test(c)) { const hit = CAM.find(([re]) => re.test(c)); if (hit) { cams.push({ preset: hit[1], label: hit[2], start: cl.link === 'sim' ? t0 : start, dir: /\b(down|left)\b/.test(c) ? -1 : 1 }); continue; } }
    // subject
    const verbAt = Math.min(...[...ACTIONS, ...MOVES, [/\b(circle|circles|orbit|orbits)\b/, '', 0] as [RegExp, string, number], [/\b(face|faces|turn|turns|look|looks)\b/, '', 0] as [RegExp, string, number]].map(([re]) => { const m = re.exec(c); return m ? m.index : Infinity; }));
    if (verbAt === Infinity) continue;
    const subjPhrase = c.slice(0, verbAt).trim(), objPhrase = c.slice(verbAt);
    if (subjPhrase && !/^(he|she|they|and|to)$/.test(subjPhrase)) { const r = resolveCharacter(p, subjPhrase); if (r === 'ambiguous') return { reply: '', title: 'Clarification needed', question: `Which character do you mean by "${subjPhrase}"? (${Object.values(p.characters).map((x) => x.name).join(', ')})`, ops: [] }; if (r) subject = r; }
    if (!subject) { const sel = input.selectionId && p.characters[input.selectionId] ? input.selectionId : null, only = Object.keys(p.characters); subject = sel ?? (only.length === 1 ? only[0] : null); }
    if (!subject) return { reply: '', title: 'Clarification needed', question: `Who should do this? (${Object.values(p.characters).map((x) => x.name).join(', ') || 'there are no characters yet'})`, ops: [] };
    const tm = /\b(?:around|at|to|toward|towards|past|behind|away from|from|him|her|them)\b(.*)$/.exec(objPhrase);
    if (tm) { const r = resolveCharacter(p, tm[0], subject); if (r === 'ambiguous') return { reply: '', title: 'Clarification needed', question: `Who is the target of "${c}"?`, ops: [] }; if (r) target = r; }
    const here = where(subject), tgt = target && target !== subject ? where(target) : null, name = p.characters[subject].name; let dur = 0;
    const circ = /\b(circle|circles|orbit|orbits)\b/.exec(c);
    if (circ) {
      if (!tgt) return { reply: '', title: 'Clarification needed', question: `Who or what should ${name} circle?`, ops: [] };
      const nm = /\b(once|twice|thrice|(\d+|one|two|three|four|five|six) times?)\b/.exec(c), loops = nm ? (NUM[nm[1]] ?? NUM[nm[2]] ?? +nm[2]) : 1, clip = /\b(slowly|walk|stalk|prowl)/.test(c) ? 'walk' : /\bsprint/.test(c) ? 'sprint' : 'run', speed = clip === 'walk' ? 1.45 : clip === 'sprint' ? 6.5 : 3.6;
      const rad = Math.min(2.6, Math.max(1.6, Math.hypot(here[0] - tgt[0], here[2] - tgt[2]))), a0 = Math.atan2(here[0] - tgt[0], here[2] - tgt[2]), steps = 6 * loops, dir = /\b(clockwise|right)\b/.test(c) ? -1 : 1; dur = (2 * Math.PI * rad * loops) / speed;
      anchor(subject, start, clip);
      for (let i = 1; i <= steps; i++) { const a = a0 + dir * (i / 6) * 2 * Math.PI; key(subject, start + (dur * i) / steps, [tgt[0] + Math.sin(a) * rad, 0, tgt[2] + Math.cos(a) * rad], i === steps ? 'idle' : clip, i === steps ? { facing: { mode: 'target', targetId: target! } } : {}); }
      notes.push(`${name} circles ${p.characters[target!].name} ${loops}× (${dur.toFixed(1)}s)`);
    } else {
      const mv = MOVES.find(([re]) => re.test(c)), act = ACTIONS.find(([re]) => re.test(c));
      if (mv) {
        const dm = /(\d+(?:\.\d+)?)\s?(m|meters?|metres?|steps?)\b/.exec(c), away = /\b(away|back|retreat)/.test(c); let dest: Vec3;
        if (tgt) { const d = Math.hypot(tgt[0] - here[0], tgt[2] - here[2]) || 1, u: Vec3 = [(tgt[0] - here[0]) / d, 0, (tgt[2] - here[2]) / d], dist = away ? -(dm ? +dm[1] : 4) : dm ? +dm[1] : Math.max(0, d - 1.4); dest = [here[0] + u[0] * dist, 0, here[2] + u[2] * dist]; }
        else { const st = evalCharacter(p, p.characters[subject], start), yaw = st.yaw + (/\bleft\b/.test(c) ? Math.PI / 2 : /\bright\b/.test(c) ? -Math.PI / 2 : away ? Math.PI : 0), dist = dm ? +dm[1] : 4; dest = [here[0] + Math.sin(yaw) * dist, 0, here[2] + Math.cos(yaw) * dist]; }
        const dist = Math.hypot(dest[0] - here[0], dest[2] - here[2]); dur = Math.max(0.4, dist / mv[2]); anchor(subject, start, mv[1]); key(subject, start + dur, dest, act && act[1] !== 'idle' ? act[1] : 'idle', target ? { facing: { mode: 'target', targetId: target } } : {});
        notes.push(`${name} ${mv[1]}s ${dist.toFixed(1)} m (${dur.toFixed(1)}s)`); if (act && act[1] !== 'idle') { dur += act[2]; key(subject, start + dur, dest, 'idle', target ? { facing: { mode: 'target', targetId: target } } : {}); notes.push(`then ${act[1]}`); }
      } else if (act) {
        const sm = /(\d+(?:\.\d+)?)\s?(s|sec|seconds?)\b/.exec(c); dur = sm ? +sm[1] : act[2]; let at = here;
        if (act[1] === 'thrust' && tgt) { const d = Math.hypot(tgt[0] - here[0], tgt[2] - here[2]) || 1, step = Math.min(0.9, Math.max(0, d - 1)); at = [here[0] + ((tgt[0] - here[0]) / d) * step, 0, here[2] + ((tgt[2] - here[2]) / d) * step]; }
        anchor(subject, start, act[1], target ? { facing: { mode: 'target', targetId: target } } : {}); key(subject, start + dur, at, 'idle', target ? { facing: { mode: 'target', targetId: target } } : {});
        notes.push(`${name} ${act[1] === 'thrust' ? 'lunges' : act[1] + (act[1].endsWith('s') ? 'es' : 's')} at ${start.toFixed(1)}s`);
      } else if (/\b(face|faces|turn|turns|look|looks)\b/.test(c) && target) { anchor(subject, start, 'idle', { facing: { mode: 'target', targetId: target } }); dur = 0.4; notes.push(`${name} turns to ${p.characters[target].name}`); }
    }
    prevStart = start; T = Math.max(T, start + dur); tEnd = Math.max(tEnd, T);
  }
  // ---- cameras: one new camera + shot per requested move, covering the staged range ----
  if (cams.length) {
    let staged = p; try { for (const o of ops) staged = applyQuiet(staged, o); } catch { /* preview only */ }
    for (const cm of cams) {
      const end = Math.max(tEnd, cm.start + 2), cid = id('cam'), subj = subject ?? (shot ? shotFacts(p, shot).subjects[0]?.id : undefined) ?? Object.keys(p.characters)[0], cur = shot ? evalCamera(p, p.cameras[shot.cameraId], cm.start) : null;
      const camera = makeCamera(staged, cm.preset, { id: cid, name: `Cam · ${cm.label}`, start: cm.start, end, subjectId: subj, from: cur?.pos, whipTo: target ? ([...characterPosition(staged, staged.characters[target], end)].map((v, i) => (i === 1 ? v + 1.4 : v)) as Vec3) : undefined });
      if (cm.preset === 'crane' && cm.dir < 0) camera.keys.reverse().forEach((k, i, a) => { k.t = [cm.start, end][i] ?? a[i].t; });
      ops.push({ type: 'addCamera', camera }, { type: 'addShot', index: shot ? p.shots.indexOf(shot) + 1 : undefined, shot: { id: id('shot'), name: `${cm.label[0].toUpperCase() + cm.label.slice(1)} on ${subj ? p.characters[subj]?.name : 'scene'}`, cameraId: cid, start: r2(cm.start), end: r2(end), notes: text, transition: { kind: 'cut', duration: 0 }, audioLead: 0, audioTail: 0, trimIn: 0, trimOut: 0, twoStage: false } });
      notes.push(`camera ${cm.label} ${cm.start.toFixed(1)}–${end.toFixed(1)}s (new shot)`); tEnd = Math.max(tEnd, end);
    }
  }
  // Ripple: existing keys of the characters we re-staged that fall inside the new action move later by its length,
  // so the inserted beat plays first and the old blocking resumes after it (instead of interleaving).
  const shift = Math.round((T - t0) * p.fps) / p.fps, ripple: Op[] = [];
  if (shift > 0) for (const cid of anchored) for (const k of [...p.characters[cid].keys].reverse()) if (k.t > t0 + 1e-6) ripple.push({ type: 'moveKeyframe', target: { kind: 'character', id: cid }, keyId: k.id, t: Math.round((k.t + shift) * p.fps) / p.fps });
  ops.unshift(...ripple);
  const lastKey = Math.max(tEnd, ...[...anchored].flatMap((cid) => p.characters[cid].keys.map((k) => (k.t > t0 + 1e-6 ? k.t + shift : k.t))));
  if (lastKey > p.duration) ops.unshift({ type: 'setProject', patch: { duration: Math.ceil(lastKey + 0.5) } });
  if (!ops.length) return { reply: `I couldn't map "${text}" to staging. Try: "<character> walks to <character>", "<character> circles him twice then lunges", "camera cranes up", "set lens to 85mm", "make it golden hour".`, title: 'No change', ops: [] };
  const later = [...anchored].filter((cid) => p.characters[cid].keys.some((k) => k.t > t0 + 1e-6));
  return { reply: notes.join('; ') + '.' + (later.length ? ` Note: ${later.map((c) => p.characters[c].name).join(', ')} had later blocking; it now resumes ${shift.toFixed(1)}s later (rippled). Shots after ${t0.toFixed(1)}s keep their times, so re-time them if needed.` : ''), title: text.length > 60 ? text.slice(0, 57) + '…' : text, ops };
}
function hashStr(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
import { applyOp } from '@blockout/core';
const applyQuiet = (p: Project, op: Op) => applyOp(p, op).project;

// ---------- script -> blockout ----------
export interface ScriptOutput { title: string; rationale: string; ops: Op[] }
export function scriptToBlockoutLocal(p: Project, script: string): ScriptOutput {
  const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), ops: Op[] = [], h = Math.abs(hashStr(script)).toString(36); let n = 0; const id = (pre: string) => `${pre}_${h}${(n++).toString(36)}`;
  const heading = lines.map((l) => /^(INT|EXT|INT\.\/EXT)[. ]+(.+?)(?:\s+[-–—]\s+(.+))?$/i.exec(l)).find(Boolean), interior = heading ? /^INT/i.test(heading[1]) : /\b(room|inside|kitchen|office|hall|corridor)\b/i.test(script);
  const STOP = new Set(['INT', 'EXT', 'DAY', 'NIGHT', 'CUT', 'TO', 'FADE', 'IN', 'OUT', 'THE', 'A', 'AND', 'CONTINUOUS', 'LATER', 'DUSK', 'DAWN', 'CLOSE', 'ON', 'ANGLE', 'POV', 'WE', 'I', 'V.O', 'O.S']);
  const names: string[] = [], add = (raw: string) => { const nm = raw.replace(/\(.*?\)/g, '').trim(); if (!nm || STOP.has(nm.toUpperCase()) || nm.length < 2 || nm.split(' ').length > 3) return; const nice = nm.split(' ').map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '); if (!names.includes(nice)) names.push(nice); };
  lines.forEach((l, i) => { if (/^[A-Z][A-Z .'-]{1,24}(\s*\(.*\))?$/.test(l) && !/^(INT|EXT)/.test(l) && lines[i + 1] && !/^[A-Z .'-]+$/.test(lines[i + 1])) add(l); });
  for (const m of script.matchAll(/\b([A-Z]{3,}(?: [A-Z]{3,})?)\b(?=[^.\n]*[a-z])/g)) add(m[1]);
  if (!names.length) for (const m of script.matchAll(/(?<=[a-z,;] )([A-Z][a-z]{2,})\b/g)) add(m[1]);
  if (!names.length) for (const m of script.matchAll(/\b([A-Z][a-z]{2,})\b(?= (?:walks|runs|sprints|draws|raises|turns|looks|stands|sits|says|lunges|slashes|falls|enters|waits|steps))/g)) add(m[1]);
  if (!names.length) names.push('Figure');
  const chars = names.slice(0, 6).map((name, i) => { const a = (i / Math.max(2, Math.min(6, names.length))) * Math.PI * 2 + Math.PI / 2, R = names.length === 1 ? 0 : names.length === 2 ? 1.7 : 2.6; return { id: id('ch'), name, pos: [r2(Math.sin(a) * R), 0, r2(Math.cos(a) * R * 0.6)] as Vec3 }; });
  const byName = (s: string) => chars.map((c) => ({ c, i: s.search(new RegExp(`\\b${c.name}\\b`, 'i')) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0]?.c;
  // beats
  interface Beat { cid: string; clip: string; t: number; end: number; move?: Vec3; text: string }
  const beats: Beat[] = []; let T = 0.5, speaker: typeof chars[number] | undefined; const cur = new Map(chars.map((c) => [c.id, c.pos]));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (/^(INT|EXT)[. ]/i.test(l) || /^(CUT TO|FADE)/i.test(l)) continue;
    if (/^[A-Z][A-Z .'-]{1,24}(\s*\(.*\))?$/.test(l)) { speaker = byName(l); continue; }
    if (speaker && lines[i - 1] && /^[A-Z][A-Z .'-]{1,24}/.test(lines[i - 1])) { const d = Math.max(1.2, l.split(/\s+/).length / 2.6); beats.push({ cid: speaker.id, clip: 'talk', t: T, end: T + d, text: `${speaker.name}: "${l.slice(0, 60)}"` }); T += d + 0.2; speaker = undefined; continue; }
    let last: typeof chars[number] | undefined;
    for (const s of l.split(/(?<=[.!?])\s+/)) {
      const c = byName(s) ?? last ?? (chars.length === 1 ? chars[0] : undefined); if (!c) continue; last = c; const low = s.toLowerCase(), mv = MOVES.find(([re]) => re.test(low)), act = ACTIONS.find(([re]) => re.test(low)), other = chars.find((o) => o !== c && new RegExp(`\\b${o.name}\\b`, 'i').test(s)) ?? chars.find((o) => o !== c);
      if (mv) { const here = cur.get(c.id)!, to = other ? cur.get(other.id)! : ([here[0] + 4, 0, here[2]] as Vec3), d = Math.hypot(to[0] - here[0], to[2] - here[2]) || 1, away = /\b(away|leaves|exits|retreat)/.test(low), dist = away ? -5 : Math.max(0.5, d - 1.5), dest: Vec3 = [r2(here[0] + ((to[0] - here[0]) / d) * dist), 0, r2(here[2] + ((to[2] - here[2]) / d) * dist)], dur = Math.max(0.6, Math.abs(dist) / mv[2]); beats.push({ cid: c.id, clip: mv[1], t: T, end: T + dur, move: dest, text: s.trim() }); cur.set(c.id, dest); T += dur; }
      if (act && !(mv && act[1] === 'idle')) { beats.push({ cid: c.id, clip: act[1], t: T, end: T + act[2], text: s.trim() }); T += act[2] + 0.15; }
    }
  }
  if (!beats.length) { beats.push({ cid: chars[0].id, clip: 'idle', t: 0.5, end: 3, text: lines[0] ?? '' }); T = 3; }
  const total = Math.ceil(T + 1);
  ops.push({ type: 'setProject', patch: { duration: Math.max(p.duration, total), name: heading ? heading[2].replace(/\s+[-–—].*$/, '').trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : p.name } });
  const tod = TIMES.find(([re]) => re.test((heading?.[3] ?? '').toLowerCase()) || re.test(script.toLowerCase())); if (tod) ops.push({ type: 'setLighting', patch: { timeOfDay: tod[1], skyColor: tod[2] } });
  let color = p; const others = (c: typeof chars[number]) => chars.find((o) => o !== c);
  for (const c of chars) {
    const mine = beats.filter((b) => b.cid === c.id), keys: PathKey[] = [], face = others(c) ? { mode: 'target' as const, targetId: others(c)!.id } : { mode: 'path' as const }; let at = c.pos, kn = 0;
    const k = (t: number, pos: Vec3, clip: string, moving = false) => keys.push({ id: `${c.id}_k${kn++}`, t: r2(t), pos, clip, facing: moving ? { mode: 'path' } : face, ease: 'linear', speed: 1 });
    k(0, at, 'idle');
    for (const b of mine) { if (keys[keys.length - 1].t < b.t - 0.01) { keys[keys.length - 1].clip = keys[keys.length - 1].clip; k(b.t, at, b.clip, !!b.move); } else keys[keys.length - 1] = { ...keys[keys.length - 1], clip: b.clip, facing: b.move ? { mode: 'path' } : face }; if (b.move) at = b.move; k(b.end, at, CLIP_DEFS[b.clip]?.loop === false && ['fall', 'sit'].includes(b.clip) ? b.clip : 'idle'); if (['fall', 'sit'].includes(b.clip)) keys.pop(); }
    const idColor = nextIdColor(color), weapon = /\b(sword|katana|blade)\b/i.test(script) ? 'sword' : /\b(gun|pistol|revolver)\b/i.test(script) ? 'pistol' : /\b(rifle|shotgun)\b/i.test(script) ? 'rifle' : /\b(staff|spear)\b/i.test(script) ? 'staff' : /\blantern\b/i.test(script) ? 'lantern' : 'none';
    const character = { id: c.id, name: c.name, idColor, height: 1.75, build: 1, held: { kind: weapon as 'none', hand: 'R' as const }, interp: 'catmull' as const, keys, poseKeys: [] };
    ops.push({ type: 'addCharacter', character }); color = applyQuiet(color, { type: 'addCharacter', character });
    const intro = new RegExp(`${c.name}\\s*\\(([^)]{3,80})\\)`, 'i').exec(script) ?? new RegExp(`${c.name},\\s*([^,.]{3,80})[,.]`, 'i').exec(script);
    ops.push({ type: 'setCharacterBible', characterId: c.id, patch: { appearance: intro ? intro[1].trim() : '', weapon: weapon === 'none' ? '' : (/\b(katana|sword|blade|pistol|revolver|gun|rifle|shotgun|staff|spear|lantern)\b/i.exec(script)?.[1].toLowerCase() ?? weapon) } });
  }
  // rough set
  if (interior) ops.push({ type: 'addProp', prop: { id: id('room'), name: heading?.[2] ?? 'Room', kind: 'building', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], idColor: nextIdColor(color), plan: { points: [[-5, -4], [5, -4], [5, 4]], height: 3, roof: false } } });
  if (/\b(forest|woods|trees?)\b/i.test(script)) ops.push({ type: 'addScatter', scatter: { id: id('trees'), kind: 'tree', seed: 4, center: [0, 0, -14], radius: 16, count: 24 } });
  if (/\b(field|plain|grass|wheat|meadow)\b/i.test(script)) ops.push({ type: 'addScatter', scatter: { id: id('grass'), kind: 'grass', seed: 2, center: [0, 0, 0], radius: 30, count: 600 } });
  if (/\b(rocks?|boulders?|stones?)\b/i.test(script)) ops.push({ type: 'addScatter', scatter: { id: id('rocks'), kind: 'rock', seed: 6, center: [3, 0, -5], radius: 18, count: 14 } });
  for (const kind of ['rain', 'smoke', 'dust', 'sparks'] as const) if (new RegExp(`\\b${kind}\\b`, 'i').test(script)) ops.push({ type: 'addFx', fx: { id: id('fx'), name: kind, kind, pos: [0, 0, 0], size: kind === 'rain' ? [16, 7, 16] : [1.2, 1.2, 1.2], attachTo: kind === 'dust' ? chars[0].id : undefined, start: 0, end: 9999, idColor: '#cc79a7', trail: 1.5 } });
  // coverage: master + singles + inserts, all on the +Z side of the action line
  const ck = (cid: string, i: number, t: number, pos: Vec3, target: Vec3, focal: number) => ({ id: `${cid}_k${i}`, t, pos, target, focal, focus: Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]), fstop: 2.8, roll: 0, ease: 'easeInOut' as const });
  const mk = (name: string, keys: ReturnType<typeof ck>[], extra: Partial<Camera> = {}): Camera => ({ id: keys[0].id.replace(/_k0$/, ''), name, sensorWidth: 36, shake: { profile: 'none', amount: 1, seed: 1 }, keys, ...extra });
  const masterId = id('cam'), spread = Math.max(4, ...chars.map((c) => Math.hypot(c.pos[0], c.pos[2])) ) ; const shots: Shot[] = [], cameras: Camera[] = [mk('Master · wide', [ck(masterId, 0, 0, [0, 1.6, spread * 2.4 + 2], [0, 1.1, 0], 28)])];
  const single = new Map<string, string>();
  for (const c of chars.slice(0, 4)) { const cid = id('cam'), o = others(c), side = o ? Math.sign(c.pos[0] - o.pos[0]) || 1 : 1; cameras.push(mk(`Single · ${c.name}`, [ck(cid, 0, 0, [0, 0, 0], [0, 0, 0], 60)], { lookAt: { characterId: c.id, offset: [0, 1.5, 0] }, attach: { characterId: c.id, lag: 0.15 }, keys: [ck(cid, 0, 0, [-side * 1.2, 1.55, 2.6], [0, 1.5, 0], 60)] })); single.set(c.id, cid); }
  const insertId = id('cam'); let insertUsed = false; const sh = (name: string, cameraId: string, a: number, b: number, notes = ''): void => { if (b - a < 0.35) return; shots.push({ id: id('shot'), name: `${shots.length + 1} · ${name}`, cameraId, start: r2(a), end: r2(b), notes, transition: { kind: 'cut', duration: 0 }, audioLead: 0, audioTail: 0, trimIn: 0, trimOut: 0, twoStage: false }); };
  const first = beats[0].t; sh('Master (establishing)', masterId, 0, Math.max(1.5, first), 'Establish geography and both characters.');
  let cursor = Math.max(1.5, first);
  for (const b of beats) {
    if (b.end <= cursor + 0.2) continue; const c = chars.find((x) => x.id === b.cid)!, a = Math.max(cursor, b.t);
    if (b.move || ['fall', 'jump'].includes(b.clip) || !single.has(b.cid)) sh(`Master · ${c.name} ${b.clip}s`, masterId, a, b.end, b.text);
    else if (['slash', 'thrust'].includes(b.clip) && !insertUsed) { insertUsed = true; cameras.push(mk(`Insert · ${c.name}'s hands`, [ck(insertId, 0, 0, [0.5, 1.15, 1.1], [0, 1.05, 0.3], 85)], { attach: { characterId: c.id, lag: 0 }, lookAt: { characterId: c.id, offset: [0, 1.05, 0] } })); sh(`Insert · ${c.name} strikes`, insertId, a, b.end, b.text); }
    else sh(`Single · ${c.name}`, single.get(b.cid)!, a, b.end, b.text);
    cursor = Math.max(cursor, b.end);
  }
  if (total - cursor > 0.4) sh('Master (resolve)', masterId, cursor, total, 'Return to the wide to resolve the scene.');
  const used = new Set(shots.map((s) => s.cameraId)); for (const c of cameras) if (used.has(c.id)) ops.push({ type: 'addCamera', camera: c }); for (const s of shots) ops.push({ type: 'addShot', shot: s });
  const firstSentence = lines.find((l) => !/^(INT|EXT)[. ]/i.test(l) && l.length > 20) ?? ''; ops.push({ type: 'setStyleBible', patch: { logline: firstSentence.slice(0, 200) } });
  return { title: `Blockout from script (${chars.length} characters, ${shots.length} shots)`, ops, rationale: `Found ${chars.map((c) => c.name).join(', ')}; ${beats.length} action beats over ${total}s. Coverage: a master on the +Z side of the action line, singles on each character from the same side (so eyelines match), ${insertUsed ? 'one insert on the strike, ' : ''}cut on action beats. ${interior ? 'Rough interior walls added. ' : ''}Review timings: durations are estimated from verbs and dialogue length.` };
}

// ---------- alternates ----------
export interface Alternate { name: string; rationale: string; camera: Camera }
export function alternatesLocal(p: Project, shotId: string, count = 3): Alternate[] {
  const shot = p.shots.find((s) => s.id === shotId); if (!shot) return [];
  const f = shotFacts(p, shot), prim = f.subjects[0], ids = Object.keys(p.characters), a = prim?.id ?? ids[0]; if (!a) return [];
  const b = f.subjects[1]?.id ?? ids.find((x) => x !== a), mid = (shot.start + shot.end) / 2, A = characterPosition(p, p.characters[a], mid), B = b ? characterPosition(p, p.characters[b], mid) : ([A[0] + 1, A[1], A[2]] as Vec3), cur = evalCamera(p, p.cameras[shot.cameraId], mid);
  const ax = Math.atan2(B[0] - A[0], B[2] - A[2]), side = Math.sign((B[2] - A[2]) * (cur.pos[0] - A[0]) - (B[0] - A[0]) * (cur.pos[2] - A[2])) || 1; // keep to the established side of the 180° line
  const at = (deg: number, dist: number, h: number): Vec3 => { const ang = ax + side * (deg * Math.PI) / 180; return [r2(A[0] + Math.sin(ang) * dist), r2(A[1] + h), r2(A[2] + Math.cos(ang) * dist)]; };
  const hid = Math.abs(hashStr(shotId + shot.cameraId)).toString(36), nm = p.characters[a].name;
  const specs: [string, CameraPreset, Vec3, number, string][] = [
    ['Low-angle push-in', 'pushIn', at(50, 3.2, 0.4), 28, `Hero framing from below on ${nm}; stays on the current side of the line.`],
    ['Long-lens profile', 'static', at(90, 9, 1.5), 135, `Compressed profile of ${nm}${b ? ' with ' + p.characters[b].name + ' stacked behind' : ''}; perpendicular to the axis so both read cleanly.`],
    ['High wide crane', 'crane', at(120, 7, 1.2), 24, 'Rises to reveal geography; good as a re-establishing beat.'],
    ['Slow orbit', 'orbit', at(40, 4.5, 1.5), 40, 'Arcs 60° without crossing the line; adds energy to a static exchange.'],
    ['Handheld follow', 'follow', at(160, 3, 1.6), 35, `Stays behind ${nm}'s shoulder with natural shake.`],
  ];
  return specs.filter(([, preset]) => !(preset === 'orbit' && f.camera.motion.type === 'orbit') && !(preset === 'static' && f.camera.motion.type === 'static' && f.camera.focal > 100)).slice(0, count).map(([name, preset, from, focal, rationale], i) => {
    const cam = makeCamera(p, preset, { id: `alt_${hid}_${i}`, name: `Alt · ${name}`, start: shot.start, end: shot.end, subjectId: a, from, focal, distance: Math.hypot(from[0] - A[0], from[2] - A[2]), height: from[1] - A[1], degrees: side * 60 });
    return { name, rationale, camera: cam };
  });
}
export function cameraSide(p: Project, cam: Camera, a: string, b: string, t: number): number { const A = characterPosition(p, p.characters[a], t), B = characterPosition(p, p.characters[b], t), c = evalCamera(p, cam, t).pos; return Math.sign((B[2] - A[2]) * (c[0] - A[0]) - (B[0] - A[0]) * (c[2] - A[2])); }

// ---------- continuity explanation + fixes ----------
export interface ContinuityReview { summary: string; items: { id: string; priority: number; explanation: string; fix?: { title: string; ops: Op[] } }[] }
export function continuityLocal(p: Project, issues: ContinuityIssue[] = runContinuity(p)): ContinuityReview {
  const WHY: Record<string, string> = { 'axis-180': 'Audiences build a mental map from screen sides. Crossing the line flips who is on the left, so the cut reads as the characters swapping places.', 'screen-direction': 'A reversal of travel direction across a cut reads as the character turning back.', eyeline: 'Matching singles need opposed eyelines or the characters seem to look at the same off-screen thing.', 'jump-cut': 'Too little change between consecutive shots of one subject reads as a glitch rather than a cut.', 'timing-gap': 'Staged action is not covered by any shot.', 'timing-overlap': 'The same action plays twice.', 'prop-continuity': 'The video model is told one thing by the bible and shown another by the control passes.', 'prompt-mismatch': 'The prompt describes something the blockout no longer shows; the model will follow one and fight the other.', lighting: 'Light direction in the text contradicts the clay pass shading.' };
  const items = issues.map((iss, i) => {
    let fix: ContinuityReview['items'][number]['fix'];
    if (iss.kind === 'axis-180' && iss.subjects.length === 2) {
      const B = p.shots.find((s) => s.id === iss.shots[1]), cam = B && p.cameras[B.cameraId];
      if (B && cam && !cam.attach) { // mirror the incoming camera across the axis
        const P = characterPosition(p, p.characters[iss.subjects[0]], B.start), Q = characterPosition(p, p.characters[iss.subjects[1]], B.start), dx = Q[0] - P[0], dz = Q[2] - P[2], l2 = dx * dx + dz * dz || 1;
        const mirror = (v: readonly number[]): Vec3 => { const t = ((v[0] - P[0]) * dx + (v[2] - P[2]) * dz) / l2, fx = P[0] + t * dx, fz = P[2] + t * dz; return [r2(2 * fx - v[0]), v[1], r2(2 * fz - v[2])]; };
        fix = { title: `Mirror ${cam.name} across the 180° line`, ops: cam.keys.map((k) => ({ type: 'setCameraKey' as const, cameraId: cam.id, keyId: k.id, patch: { pos: mirror(k.pos), ...(cam.lookAt ? {} : { target: mirror(k.target) }) } })) };
      }
    } else if (iss.kind === 'timing-gap' && iss.shots.length === 2) { const A = p.shots.find((s) => s.id === iss.shots[0]), B = p.shots.find((s) => s.id === iss.shots[1]); if (A && B) fix = { title: `Extend ${A.name} to meet ${B.name}`, ops: [{ type: 'updateShot', id: A.id, patch: { end: B.start } }] }; }
    else if (iss.kind === 'timing-overlap' && iss.shots.length === 2) { const A = p.shots.find((s) => s.id === iss.shots[0]), B = p.shots.find((s) => s.id === iss.shots[1]); if (A && B && B.start > A.start + 0.2) fix = { title: `Trim ${A.name} to end at the cut`, ops: [{ type: 'updateShot', id: A.id, patch: { end: B.start } }] }; }
    return { id: iss.id, priority: i + 1, explanation: `${iss.message}. ${WHY[iss.kind] ?? ''} ${iss.suggestion}`, fix };
  });
  const by = (s: string) => issues.filter((i) => i.severity === s).length;
  return { summary: issues.length ? `${issues.length} continuity finding${issues.length > 1 ? 's' : ''}: ${by('high')} high, ${by('medium')} medium, ${by('low')} low. Fix the high ones first — they change what the audience believes about the geography.` : 'No continuity problems found in the current cut.', items };
}

// ---------- bibles / memory ----------
export interface BibleReview { amendments: { target: string; field: string; value: string; reason: string }[]; violations: { memoryId: string; text: string; fix?: { title: string; ops: Op[] } }[] }
export function bibleReviewLocal(p: Project): BibleReview {
  const amendments: BibleReview['amendments'] = [], violations: BibleReview['violations'] = [], facts = p.shots.map((s) => shotFacts(p, s));
  for (const c of Object.values(p.characters)) {
    const b = p.bibles.characters[c.id];
    if (!b || (!b.appearance && !b.wardrobe)) amendments.push({ target: c.id, field: 'appearance', value: `${c.build > 1.15 ? 'broad-shouldered' : c.build < 0.9 ? 'slight' : 'average-build'} figure, about ${c.height.toFixed(2)} m tall`, reason: `${c.name} has no description, so every prompt leaves the look to chance.` });
    if (c.held.kind !== 'none' && b && !b.weapon) amendments.push({ target: c.id, field: 'weapon', value: c.held.kind, reason: `${c.name}'s mannequin holds a ${c.held.kind}, but the bible does not mention it.` });
    if (b && !b.silhouette) amendments.push({ target: c.id, field: 'silhouette', value: `${c.build > 1.1 ? 'wide, heavy' : 'narrow, upright'} silhouette${c.held.kind !== 'none' ? ` with a ${c.held.kind} extending from the ${c.held.hand === 'R' ? 'right' : 'left'} hand` : ''}`, reason: 'A silhouette note helps identity survive wide shots.' });
  }
  const lenses = facts.map((f) => f.camera.focal), habit = lenses.length ? `mostly ${Math.min(...lenses)}–${Math.max(...lenses)}mm; ${facts.filter((f) => f.camera.motion.type !== 'static').length} of ${facts.length} shots move` : '';
  if (habit && !p.bibles.style.lensHabits) amendments.push({ target: 'style', field: 'lensHabits', value: habit, reason: 'Derived from the cameras actually used in the cut.' });
  if (facts[0] && !p.bibles.style.lighting) amendments.push({ target: 'style', field: 'lighting', value: facts[0].lighting.quality, reason: 'Derived from the lighting blockout.' });
  for (const m of Object.values(p.memory)) {
    const t = m.text.toLowerCase(), asp = /(16:9|9:16|1:1|2\.39:1|4:3)/.exec(t);
    if (/dutch/.test(t) && /(hate|no|never|avoid|don'?t)/.test(t)) { const bad = facts.filter((f) => f.camera.dutch); if (bad.length) violations.push({ memoryId: m.id, text: `"${m.text}" — but ${bad.map((f) => f.name).join(', ')} ${bad.length > 1 ? 'are' : 'is'} dutch-tilted.`, fix: { title: 'Level the dutch-tilted cameras', ops: bad.flatMap((f) => p.cameras[f.camera.id].keys.map((k) => ({ type: 'setCameraKey' as const, cameraId: f.camera.id, keyId: k.id, patch: { roll: 0 } }))) } }); }
    if (asp && /(always|only|must)/.test(t) && p.aspect !== asp[1]) violations.push({ memoryId: m.id, text: `"${m.text}" — but the project is ${p.aspect}.`, fix: { title: `Set aspect to ${asp[1]}`, ops: [{ type: 'setProject', patch: { aspect: asp[1] as Project['aspect'] } }] } });
    if (/handheld/.test(t) && /(hate|no|never|avoid)/.test(t)) { const bad = facts.filter((f) => f.camera.shake !== 'none'); if (bad.length) violations.push({ memoryId: m.id, text: `"${m.text}" — but ${bad.map((f) => f.name).join(', ')} use camera shake.`, fix: { title: 'Remove camera shake', ops: bad.map((f) => ({ type: 'updateCamera' as const, id: f.camera.id, patch: { shake: { profile: 'none' as const, amount: 1, seed: 1 } } })) } }); }
  }
  return { amendments, violations };
}
/** Pull durable preferences out of what the user types ("I hate dutch angles", "always 2.39:1"). */
export function extractPreferences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]?/g) ?? []).map((s) => s.trim()).filter((s) => /\b(i (hate|love|prefer|like|don'?t like|never want|always want)|always|never|from now on|by default)\b/i.test(s) && s.length < 160 && s.split(' ').length >= 3);
}

// ---------- critique / storyboard ----------
export interface TakeMetrics { iou?: number; flicker?: number; paletteDistance?: number; coverage?: number; perEntity?: Record<string, number> }
export function critiqueLocal(p: Project, shotId: string, m: TakeMetrics): Critique {
  const c10 = (x: number) => Math.round(Math.max(0, Math.min(10, x)) * 10) / 10, iou = m.iou ?? 0.5, staging = c10(iou * 10 + 0.5), artifacts = c10(10 - (m.flicker ?? 0.02) * 120), style = c10(10 - (m.paletteDistance ?? 0.25) * 14);
  const worst = m.perEntity ? Object.entries(m.perEntity).sort((a, b) => a[1] - b[1])[0] : undefined, character = c10(worst ? worst[1] * 10 + 1 : staging);
  const issues: Critique['issues'] = [], fixes: Critique['fixes'] = [], name = (id: string) => p.characters[id]?.name ?? id;
  if (iou < 0.55) { issues.push({ kind: 'staging', severity: iou < 0.35 ? 'high' : 'medium', note: `Subject masks overlap the blockout by only ${(iou * 100).toFixed(0)}%.` }); fixes.push({ kind: 'control', description: 'Add or strengthen the pose and depth passes so the figures stay on their marks.', controlPass: 'pose' }); }
  if (worst && worst[1] < 0.4) { issues.push({ kind: 'character', severity: 'medium', note: `${name(worst[0])} drifts furthest from the blockout (${(worst[1] * 100).toFixed(0)}% overlap).` }); fixes.push({ kind: 'reference', description: `Attach ${name(worst[0])}'s reference sheet and restate the wardrobe in the prompt.` }); }
  if ((m.flicker ?? 0) > 0.05) { issues.push({ kind: 'flicker', severity: 'medium', note: 'Frame-to-frame brightness changes more than the blockout motion explains.' }); fixes.push({ kind: 'seed', description: 'Try another seed; if it persists, shorten the shot or add the optical-flow pass.', controlPass: 'flow' }); }
  if ((m.paletteDistance ?? 0) > 0.35) { issues.push({ kind: 'style', severity: 'low', note: 'Average colour is far from the style-bible palette.' }); fixes.push({ kind: 'prompt', description: 'Move the style sentence to the front of the prompt and name the palette colours.', promptEdit: `${p.bibles.style.medium}. ` }); }
  const overall = c10(staging * 0.4 + character * 0.25 + style * 0.15 + artifacts * 0.2), shot = p.shots.find((s) => s.id === shotId);
  return { staging, character, style, artifacts, overall, summary: `${shot?.name ?? 'Shot'}: ${overall >= 8 ? 'strong take' : overall >= 6 ? 'usable with fixes' : 'needs another pass'} — staging ${staging}/10 (mask IoU ${(iou * 100).toFixed(0)}%), consistency ${character}/10, style ${style}/10, artifacts ${artifacts}/10. Scores here are numeric heuristics only; a vision review by Claude can judge identity, limbs and style directly.`, issues, fixes };
}
export interface StoryboardPanel { shotId: string; title: string; size: string; action: string; camera: string }
export function storyboardLocal(p: Project): StoryboardPanel[] {
  return p.shots.map((s) => { const f = shotFacts(p, s), prim = f.subjects[0], m = f.camera.motion; return { shotId: s.id, title: s.name, size: prim ? `${prim.sizeStart} — ${SHOT_SIZE_NAMES[prim.sizeStart]}` : 'WS — wide shot', action: f.subjects.filter((x) => x.visible > 0.3).map((x) => `${x.name} ${x.beats.map((b) => b.verb + (b.distance >= 1 ? ` ${b.distance} m` : '')).join(', then ')}`).join('. ') + '.' + (s.notes ? ` ${s.notes}` : ''), camera: `${m.type}${m.secondary.length ? ' + ' + m.secondary.join(' + ') : ''}, ${f.camera.focal}mm, ${f.camera.angle} angle, ${f.duration.toFixed(1)}s` }; });
}
