/** Cinematography math: turns splines into facts (movement type, lens class, shot size, angle, action beats)
 *  so the prompt writer works from measurements, never guesses. Also produces semantic diffs between facts. */
import type { Camera, Character, Project, Shot } from './schema';
import { DEG, type Vec3, add, sub, len, norm, dot, cross, clamp, round, hashOf, wrapAngle, qRotate } from './math';
import { evalCamera, evalCharacter, projectPoint, sunState, type CamState } from './evaluate';
import { CLIP_DEFS } from './rig';

export type MotionType = 'static' | 'pan' | 'tilt' | 'dolly in' | 'dolly out' | 'truck left' | 'truck right' | 'crane up' | 'crane down' | 'orbit' | 'handheld' | 'whip pan' | 'zoom in' | 'zoom out' | 'dolly zoom' | 'tracking';
export interface CameraMotion {
  type: MotionType; secondary: string[]; speed: 'locked' | 'slow' | 'medium' | 'fast'; easing: 'constant' | 'ease-in' | 'ease-out' | 'ease-in-out';
  travel: number; panDeg: number; tiltDeg: number; orbitDeg: number; peakPanSpeed: number; focalFrom: number; focalTo: number; shaky: boolean;
}
export const SHOT_SIZES = ['EWS', 'WS', 'MWS', 'MS', 'MCU', 'CU', 'ECU'] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];
export const SHOT_SIZE_NAMES: Record<ShotSize, string> = { EWS: 'extreme wide shot', WS: 'wide shot', MWS: 'medium wide shot', MS: 'medium shot', MCU: 'medium close-up', CU: 'close-up', ECU: 'extreme close-up' };

export function lensCategory(focal: number): 'ultra-wide' | 'wide' | 'normal' | 'portrait' | 'telephoto' | 'super-telephoto' {
  return focal < 18 ? 'ultra-wide' : focal < 35 ? 'wide' : focal <= 60 ? 'normal' : focal <= 105 ? 'portrait' : focal <= 250 ? 'telephoto' : 'super-telephoto';
}
/** Shot size from the subject's full-body height as a fraction of frame height (may exceed 1 when cropped). */
export function shotSizeFromFraction(h: number): ShotSize {
  return h < 0.3 ? 'EWS' : h < 1.05 ? 'WS' : h < 1.6 ? 'MWS' : h < 2.6 ? 'MS' : h < 4 ? 'MCU' : h < 8 ? 'CU' : 'ECU';
}
export function bodyFraction(cs: CamState, center: Vec3, height: number): number {
  const z = projectPoint(cs, center)[2]; return z <= 0.05 ? 0 : height / (2 * z * Math.tan(cs.fovY / 2));
}
export type Angle = 'low' | 'eye-level' | 'high' | 'overhead';
export function cameraAngle(camPos: Vec3, subjectEye: Vec3): Angle {
  const d = sub(camPos, subjectEye), el = Math.atan2(d[1], Math.hypot(d[0], d[2])) / DEG;
  return el > 60 ? 'overhead' : el > 15 ? 'high' : el < -12 ? 'low' : 'eye-level';
}
export const screenThird = (x: number) => (x < 0.38 ? 'left' : x > 0.62 ? 'right' : 'center') as 'left' | 'center' | 'right';

const yawPitch = (cs: CamState) => { const f = qRotate(cs.quat, [0, 0, -1]); return [Math.atan2(f[0], -f[2]), Math.asin(clamp(f[1], -1, 1))]; };
/** Classify camera movement from N uniformly spaced samples of its state over a shot. */
export function classifyCameraMotion(samples: CamState[], dt: number, opts: { shake?: boolean; subject?: Vec3[] } = {}): CameraMotion {
  const n = samples.length; let travel = 0, dolly = 0, truck = 0, crane = 0, pan = 0, tilt = 0, peakPan = 0, orbit = 0, absPan = 0;
  const speeds: number[] = [];
  for (let i = 1; i < n; i++) {
    const a = samples[i - 1], b = samples[i], d = sub(b.pos, a.pos), f = qRotate(a.quat, [0, 0, -1]), fh = norm([f[0], 0, f[2]]), fwd = len(fh) < 1e-4 ? f : fh, right = norm(cross(fwd, [0, 1, 0]));
    travel += len(d); dolly += dot(d, fwd); truck += dot(d, right); crane += d[1];
    const [ya, pa] = yawPitch(a), [yb, pb] = yawPitch(b), dy = wrapAngle(yb - ya) / DEG; pan += dy; absPan += Math.abs(dy); tilt += (pb - pa) / DEG;
    const w = opts.shake ? Math.min(3, i) : 1, [yw] = yawPitch(samples[i - w]); peakPan = Math.max(peakPan, Math.abs(wrapAngle(yb - yw) / DEG) / (dt * w));
    const ra = sub(a.pos, a.target), rb = sub(b.pos, b.target); orbit += wrapAngle(Math.atan2(rb[0], rb[2]) - Math.atan2(ra[0], ra[2])) / DEG;
    speeds.push(len(d) / dt + (Math.abs(dy) + Math.abs(pb - pa) / DEG) / dt / 30);
  }
  const first = samples[0], last = samples[n - 1], dur = dt * (n - 1), fr = last.focal / first.focal, shaky = !!opts.shake;
  // de-noise shake: net displacement instead of integrated jitter
  if (shaky) { const d = sub(last.pos, first.pos); travel = len(d); const f = qRotate(first.quat, [0, 0, -1]), fh = norm([f[0], 0, f[2]]), r = norm(cross(fh, [0, 1, 0])); dolly = dot(d, fh); truck = dot(d, r); crane = d[1]; const [y0, p0] = yawPitch(first), [y1, p1] = yawPitch(last); pan = wrapAngle(y1 - y0) / DEG; tilt = (p1 - p0) / DEG; }
  const radii = samples.map((s) => Math.hypot(s.pos[0] - s.target[0], s.pos[2] - s.target[2])), rMean = radii.reduce((a, b) => a + b, 0) / n, rDev = Math.sqrt(radii.reduce((a, b) => a + (b - rMean) ** 2, 0) / n);
  const moved = travel > 0.3, secondary: string[] = [];
  let type: MotionType;
  const trans = (): MotionType => { const ad = Math.abs(dolly), at = Math.abs(truck), ac = Math.abs(crane); return ac >= ad && ac >= at ? (crane > 0 ? 'crane up' : 'crane down') : ad >= at ? (dolly > 0 ? 'dolly in' : 'dolly out') : truck > 0 ? 'truck right' : 'truck left'; };
  let follows = false;
  if (opts.subject && moved) { const s = opts.subject, sm = len(sub(s[s.length - 1], s[0])); const d0 = len(sub(first.pos, s[0])), d1 = len(sub(last.pos, s[s.length - 1])); follows = sm > 1 && Math.abs(d1 - d0) < 0.25 * Math.max(d0, 1) && travel > 0.6 * sm; }
  if (peakPan > 120 && Math.abs(pan) > 40) type = 'whip pan';
  else if (Math.abs(orbit) > 25 && moved && rMean > 0.5 && rDev / rMean < 0.3 && !follows) type = 'orbit';
  else if (moved && Math.abs(dolly) > 0.5 * travel && Math.abs(Math.log(fr)) > 0.18 && Math.sign(dolly) !== Math.sign(Math.log(fr))) type = 'dolly zoom';
  else if (follows) type = 'tracking';
  else if (moved) type = trans();
  else if (Math.abs(pan) > 4 && Math.abs(pan) >= Math.abs(tilt)) type = 'pan';
  else if (Math.abs(tilt) > 4) type = 'tilt';
  else if (fr > 1.12) type = 'zoom in'; else if (fr < 0.89) type = 'zoom out';
  else type = shaky ? 'handheld' : 'static';
  if (type !== 'static' && type !== 'handheld') {
    if (moved && type !== 'orbit') { const t2 = trans(); if (t2 !== type && type !== 'dolly zoom') { const mag = t2.startsWith('crane') ? Math.abs(crane) : t2.startsWith('dolly') ? Math.abs(dolly) : Math.abs(truck); if (type === 'tracking' || type === 'whip pan' || mag > 0.3 * travel) secondary.push(t2); } }
    if (type === 'orbit' && Math.abs(crane) > 0.5) secondary.push(crane > 0 ? 'crane up' : 'crane down');
    if (!['pan', 'whip pan', 'orbit', 'tracking'].includes(type) && Math.abs(pan) > 12) secondary.push(pan > 0 ? 'pan right' : 'pan left');
    if (type !== 'tilt' && Math.abs(tilt) > 10) secondary.push(tilt > 0 ? 'tilt up' : 'tilt down');
    if (!type.includes('zoom') && (fr > 1.12 || fr < 0.89)) secondary.push(fr > 1 ? 'zoom in' : 'zoom out');
  }
  const lin = travel / Math.max(dur, 1e-3), ang = (Math.abs(pan) + Math.abs(tilt)) / Math.max(dur, 1e-3);
  const speed = type === 'static' ? 'locked' : type === 'handheld' ? 'slow' : lin > 2.5 || ang > 60 ? 'fast' : lin > 0.6 || ang > 15 ? 'medium' : 'slow';
  let easing: CameraMotion['easing'] = 'constant';
  if (speeds.length >= 6 && type !== 'static' && !shaky) {
    const k = Math.floor(speeds.length / 3), avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const s0 = avg(speeds.slice(0, k)), s1 = avg(speeds.slice(k, speeds.length - k)), s2 = avg(speeds.slice(speeds.length - k)), m = Math.max(s0, s1, s2, 1e-6);
    if (s1 > 1.35 * s0 && s1 > 1.35 * s2) easing = 'ease-in-out'; else if (s2 > 1.5 * s0 && s0 / m < 0.6) easing = 'ease-in'; else if (s0 > 1.5 * s2 && s2 / m < 0.6) easing = 'ease-out';
  }
  return { type, secondary, speed, easing, travel: round(travel, 2), panDeg: round(pan, 1), tiltDeg: round(tilt, 1), orbitDeg: round(orbit, 1), peakPanSpeed: round(peakPan, 0), focalFrom: round(first.focal, 1), focalTo: round(last.focal, 1), shaky };
}

// ---------- character action facts ----------
export interface ActionBeat { t: number; end: number; verb: string; clip: string; distance: number; speed: number; screenDir?: 'left-to-right' | 'right-to-left' | 'toward camera' | 'away from camera'; curve?: 'curves left' | 'curves right' | 'straight'; note?: string }
const VERBS: Record<string, string> = { idle: 'stands', walk: 'walks', run: 'runs', sprint: 'sprints', crouch: 'crouches', jump: 'jumps', slash: 'slashes', thrust: 'lunges with a thrust', block: 'raises a block', dodge: 'dodges', hitReact: 'recoils from a hit', fall: 'falls', sit: 'sits down', point: 'points', talk: 'talks' };
export function actionBeats(p: Project, c: Character, start: number, end: number, cam?: Camera): ActionBeat[] {
  const beats: ActionBeat[] = [], ks = c.keys;
  if (!ks.length) return [{ t: 0, end: round(end - start, 2), verb: 'stands', clip: 'idle', distance: 0, speed: 0 }];
  for (let i = 0; i < ks.length; i++) {
    const a = Math.max(start, i === 0 ? 0 : ks[i].t), b = Math.min(end, i + 1 < ks.length ? ks[i + 1].t : Infinity);
    if (b <= a + 1e-6) continue;
    const clip = ks[i].clip, def = CLIP_DEFS[clip], N = 12; let d = 0, turn = 0, prevDir: Vec3 | null = null, prev = evalCharacter(p, c, a).pos;
    const v0 = evalCharacter(p, c, a + (b - a) * 0.1).speed, v1 = evalCharacter(p, c, a + (b - a) * 0.9).speed;
    for (let s = 1; s <= N; s++) { const q = evalCharacter(p, c, a + ((b - a) * s) / N).pos, dv = sub(q, prev), l = len(dv); d += l; if (l > 1e-3) { const dir = norm(dv); if (prevDir) turn += wrapAngle(Math.atan2(dir[0], dir[2]) - Math.atan2(prevDir[0], prevDir[2])); prevDir = dir; } prev = q; }
    const moving = d > 0.4, loco = !!def?.stride;
    let verb = VERBS[clip] ?? (p.clips[clip] ? `performs "${p.clips[clip].name}"` : clip);
    if (loco && !moving) verb = 'stands';
    const beat: ActionBeat = { t: round(a - start, 2), end: round(Math.min(b, end) - start, 2), verb, clip: loco && !moving ? 'idle' : clip, distance: round(d, 1), speed: round(d / (b - a), 1) };
    if (moving) {
      beat.curve = turn / DEG > 25 ? 'curves left' : turn / DEG < -25 ? 'curves right' : 'straight';
      if (v1 < 0.55 * v0) beat.note = 'decelerating'; else if (v0 < 0.55 * v1) beat.note = 'accelerating';
      if (cam) { const A = projectPoint(evalCamera(p, cam, a), evalCharacter(p, c, a).pos), B = projectPoint(evalCamera(p, cam, b === Infinity ? end : Math.min(b, end)), prev); const dx = B[0] - A[0], dz = B[2] - A[2]; beat.screenDir = Math.abs(dx) > 0.08 ? (dx > 0 ? 'left-to-right' : 'right-to-left') : dz < -0.5 ? 'toward camera' : dz > 0.5 ? 'away from camera' : undefined; }
    }
    const last = beats[beats.length - 1];
    if (last && last.clip === beat.clip && (def?.loop ?? true) && last.curve === beat.curve && last.note === beat.note && last.screenDir === beat.screenDir) { last.speed = round((last.distance + beat.distance) / (beat.end - last.t), 1); last.end = beat.end; last.distance = round(last.distance + beat.distance, 1); }
    else beats.push(beat);
  }
  return beats;
}

// ---------- shot facts ----------
export interface SubjectFacts { id: string; name: string; primary: boolean; sizeStart: ShotSize; sizeEnd: ShotSize; angle: Angle; screenPos: 'left' | 'center' | 'right'; screenPosEnd: 'left' | 'center' | 'right'; facing: 'toward camera' | 'away from camera' | 'screen-left' | 'screen-right'; visible: number; beats: ActionBeat[]; held: string }
export interface ShotFacts {
  shotId: string; name: string; duration: number; aspect: string;
  camera: { id: string; name: string; motion: CameraMotion; lens: ReturnType<typeof lensCategory>; focal: number; angle: Angle; dutch: boolean; rollDeg: number; shake: string; dof: 'shallow' | 'moderate' | 'deep'; height: number; ots?: string };
  subjects: SubjectFacts[];
  lighting: { description: string; side: 'camera-left' | 'camera-right' | 'backlit' | 'frontal' | 'overhead'; elevation: number; quality: string };
  fx: { kind: string; from: number; to: number; attachedTo?: string }[];
  hash: string;
}
const SAMPLES = 25;
const inFrame = (s: Vec3, m = 0.12) => s[2] > 0.1 && s[0] > -m && s[0] < 1 + m && s[1] > -m && s[1] < 1 + m;
export function sampleCamera(p: Project, shot: Shot, n = SAMPLES): CamState[] {
  const cam = p.cameras[shot.cameraId]; return Array.from({ length: n }, (_, i) => evalCamera(p, cam, shot.start + ((shot.end - shot.start) * i) / (n - 1)));
}
export function shotFacts(p: Project, shot: Shot): ShotFacts {
  const cam = p.cameras[shot.cameraId], dur = shot.end - shot.start, samples = sampleCamera(p, shot), mid = samples[(SAMPLES - 1) >> 1], first = samples[0], last = samples[SAMPLES - 1];
  const tAt = (i: number) => shot.start + (dur * i) / (SAMPLES - 1);
  const subjects: SubjectFacts[] = [];
  for (const id of Object.keys(p.characters).sort()) {
    const c = p.characters[id]; let vis = 0, score = 0;
    const centerAt = (i: number): Vec3 => add(evalCharacter(p, c, tAt(i)).pos, [0, c.height * 0.55, 0]);
    for (let i = 0; i < SAMPLES; i += 2) { const ctr = centerAt(i), s = projectPoint(samples[i], ctr), hd = projectPoint(samples[i], add(ctr, [0, c.height * 0.3, 0])); if (inFrame(s) || inFrame(hd, 0.02)) { vis++; score += Math.min(3, bodyFraction(samples[i], ctr, c.height)) * (1.3 - Math.abs(s[0] - 0.5)); } }
    const visible = vis / Math.ceil(SAMPLES / 2); if (visible < 0.2) continue;
    const c0 = centerAt(0), c1 = centerAt(SAMPLES - 1), cm = centerAt((SAMPLES - 1) >> 1), st = evalCharacter(p, c, tAt((SAMPLES - 1) >> 1));
    const eye = add(st.pos, [0, c.height * 0.92, 0]), fwd: Vec3 = [Math.sin(st.yaw), 0, Math.cos(st.yaw)], toCam = norm(sub(mid.pos, eye)), fd = dot(fwd, [toCam[0], 0, toCam[2]]);
    const right = qRotate(mid.quat, [1, 0, 0]), side = dot(fwd, right);
    subjects.push({
      id, name: c.name, primary: false, sizeStart: shotSizeFromFraction(bodyFraction(first, c0, c.height)), sizeEnd: shotSizeFromFraction(bodyFraction(last, c1, c.height)),
      angle: cameraAngle(mid.pos, eye), screenPos: screenThird(projectPoint(first, c0)[0]), screenPosEnd: screenThird(projectPoint(last, c1)[0]),
      facing: fd > 0.7 ? 'toward camera' : fd < -0.7 ? 'away from camera' : side > 0 ? 'screen-right' : 'screen-left', visible: round(visible, 2), beats: actionBeats(p, c, shot.start, shot.end, cam), held: c.held.kind,
      ...({ _score: score * (cam.lookAt?.characterId === id ? 3 : 1) * (1 + Math.min(1, len(sub(c1, c0)) / 2)) * (len(sub(cm, mid.pos)) < 2.6 && fd < -0.7 ? 0.05 : 1), _cm: cm } as object),
    });
  }
  subjects.sort((a, b) => (b as any)._score - (a as any)._score || a.id.localeCompare(b.id));
  const primary = subjects[0]; if (primary) primary.primary = true;
  const subjTrack = primary ? Array.from({ length: SAMPLES }, (_, i) => evalCharacter(p, p.characters[primary.id], tAt(i)).pos) : undefined;
  const motion = classifyCameraMotion(samples, dur / (SAMPLES - 1), { shake: cam.shake.profile !== 'none', subject: subjTrack });
  const pc = primary ? p.characters[primary.id] : undefined, eye: Vec3 | undefined = primary && pc ? add(evalCharacter(p, pc, tAt((SAMPLES - 1) >> 1)).pos, [0, pc.height * 0.92, 0]) : undefined;
  const f = qRotate(mid.quat, [0, 0, -1]), angle: Angle = eye ? cameraAngle(mid.pos, eye) : f[1] < -0.85 ? 'overhead' : f[1] < -0.25 ? 'high' : f[1] > 0.2 ? 'low' : 'eye-level';
  // over-the-shoulder: a second subject close to camera, facing away, at frame edge
  let ots: string | undefined;
  for (const s of subjects) if (!s.primary) { const c = p.characters[s.id], d = len(sub(evalCharacter(p, c, tAt(12)).pos, mid.pos)); if (d < 2.6 && s.facing === 'away from camera') ots = s.name; }
  const hyper = (mid.focal * mid.focal) / (mid.fstop * 0.03) / 1000, dof = mid.focus > hyper * 0.5 ? 'deep' : mid.focus < hyper * 0.12 ? 'shallow' : 'moderate';
  // lighting relative to camera
  const sun = sunState(p.lighting), right = qRotate(mid.quat, [1, 0, 0]), sx = dot(sun.dir, right), sz = dot(sun.dir, f);
  const el = sun.elevation, quality = el <= 0 ? 'night, moonlit ambient' : el < 12 ? 'low golden-hour sun, long shadows' : el < 35 ? 'warm afternoon sun, medium shadows' : el < 65 ? 'high daylight sun, short shadows' : 'harsh overhead noon sun';
  const side = el > 70 ? 'overhead' : sz > 0.55 ? 'backlit' : sz < -0.75 ? 'frontal' : sx < 0 ? 'camera-left' : 'camera-right';
  const fx = Object.values(p.fx).filter((x) => x.start < shot.end && x.end > shot.start).map((x) => ({ kind: x.kind, from: round(Math.max(0, x.start - shot.start), 2), to: round(Math.min(dur, x.end - shot.start), 2), attachedTo: x.attachTo ? p.characters[x.attachTo]?.name : undefined })).sort((a, b) => a.kind.localeCompare(b.kind));
  for (const s of subjects) { delete (s as any)._score; delete (s as any)._cm; }
  const facts: Omit<ShotFacts, 'hash'> = {
    shotId: shot.id, name: shot.name, duration: round(dur, 2), aspect: p.aspect,
    camera: { id: cam.id, name: cam.name, motion, lens: lensCategory(mid.focal), focal: round(mid.focal, 0), angle, dutch: Math.abs(mid.roll) > 8 * DEG && cam.shake.profile === 'none', rollDeg: round(mid.roll / DEG, 0), shake: cam.shake.profile, dof, height: round(mid.pos[1], 1), ots },
    subjects, lighting: { description: `${quality}, ${side === 'backlit' ? 'backlighting the subjects' : side === 'frontal' ? 'from behind the camera' : side === 'overhead' ? 'from directly above' : 'from ' + side}`, side, elevation: round(el, 0), quality }, fx,
  };
  return { ...facts, hash: hashOf(quantize(facts)) };
}
/** Coarsen numbers so imperceptible edits do not invalidate prompts. */
function quantize(v: unknown): unknown {
  if (typeof v === 'number') return Math.abs(v) < 10 ? Math.round(v * 5) / 5 : Math.round(v / 2) * 2;
  if (Array.isArray(v)) return v.map(quantize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k, x]) => !(typeof x === 'number' && ['travel', 'peakPanSpeed', 'visible', 'panDeg', 'tiltDeg', 'orbitDeg', 'height', 'elevation', 'rollDeg', 'speed'].includes(k))).map(([k, x]) => [k, quantize(x)]));
  return v;
}
export const allShotFacts = (p: Project): Record<string, ShotFacts> => Object.fromEntries(p.shots.map((s) => [s.id, shotFacts(p, s)]));

// ---------- semantic diff ----------
export interface ShotDiff { shotId: string; name: string; changes: string[] }
const fmtT = (t: number) => `${t.toFixed(1)}s`;
export function diffShotFacts(a: ShotFacts, b: ShotFacts): string[] {
  const out: string[] = []; if (a.hash === b.hash) return out;
  const cn = b.camera.name;
  if (a.camera.id !== b.camera.id) out.push(`shot now uses ${cn} instead of ${a.camera.name}`);
  if (a.duration !== b.duration && Math.abs(a.duration - b.duration) >= 0.1) out.push(`duration changed from ${fmtT(a.duration)} to ${fmtT(b.duration)}`);
  const ma = a.camera.motion, mb = b.camera.motion;
  if (ma.type !== mb.type) out.push(`${cn} movement changed from ${ma.type} to ${mb.type}`);
  else { if (ma.speed !== mb.speed) out.push(`${cn} ${mb.type} is now ${mb.speed} (was ${ma.speed})`); if (ma.easing !== mb.easing) out.push(`${cn} ${mb.type} easing changed from ${ma.easing} to ${mb.easing}`); }
  const sa = ma.secondary.join('+'), sb = mb.secondary.join('+'); if (sa !== sb && ma.type === mb.type) out.push(sb ? `${cn} now also does: ${mb.secondary.join(', ')}` : `${cn} no longer does: ${ma.secondary.join(', ')}`);
  if (Math.abs(a.camera.focal - b.camera.focal) / a.camera.focal > 0.05) out.push(`${cn} changed from ${a.camera.focal}mm to ${b.camera.focal}mm`);
  if (a.camera.angle !== b.camera.angle) out.push(`${cn} angle changed from ${a.camera.angle} to ${b.camera.angle}`);
  if (a.camera.dutch !== b.camera.dutch) out.push(b.camera.dutch ? `${cn} is now dutch-tilted (${b.camera.rollDeg}°)` : `${cn} is no longer dutch-tilted`);
  if (a.camera.shake !== b.camera.shake) out.push(`${cn} shake changed from ${a.camera.shake} to ${b.camera.shake}`);
  if (a.camera.dof !== b.camera.dof) out.push(`depth of field is now ${b.camera.dof}`);
  if (a.camera.ots !== b.camera.ots) out.push(b.camera.ots ? `now framed over ${b.camera.ots}'s shoulder` : 'no longer an over-the-shoulder framing');
  const A = new Map(a.subjects.map((s) => [s.id, s])), B = new Map(b.subjects.map((s) => [s.id, s]));
  for (const [id, s] of B) {
    const o = A.get(id); if (!o) { out.push(`${s.name} is now in frame`); continue; }
    if (o.sizeStart !== s.sizeStart || o.sizeEnd !== s.sizeEnd) out.push(`${s.name} framing changed from ${o.sizeStart}${o.sizeEnd !== o.sizeStart ? '→' + o.sizeEnd : ''} to ${s.sizeStart}${s.sizeEnd !== s.sizeStart ? '→' + s.sizeEnd : ''}`);
    if (o.screenPos !== s.screenPos) out.push(`${s.name} now starts screen-${s.screenPos} (was ${o.screenPos})`);
    if (o.held !== s.held) out.push(`${s.name} now holds ${s.held === 'none' ? 'nothing' : 'a ' + s.held}`);
    const n = Math.max(o.beats.length, s.beats.length);
    for (let i = 0; i < n; i++) {
      const x = o.beats[i], y = s.beats[i];
      if (!x && y) { out.push(`${s.name} now also ${y.verb} at ${fmtT(y.t)}`); continue; }
      if (x && !y) { out.push(`${s.name} no longer ${x.verb} at ${fmtT(x.t)}`); continue; }
      if (x.clip !== y.clip) { out.push(`${s.name} now ${y.verb} at ${fmtT(y.t)} (was: ${x.verb})`); continue; }
      const what = y.clip === 'thrust' ? 'lunge' : y.clip === 'idle' ? 'pause' : y.clip;
      if (Math.abs(x.t - y.t) >= 0.1) out.push(`${s.name}'s ${what} moved from ${fmtT(x.t)} to ${fmtT(y.t)}`);
      if (x.curve !== y.curve && y.curve) out.push(y.curve === 'straight' ? `${s.name}'s path is now straight` : `${s.name}'s path now ${y.curve}`);
      if (x.screenDir !== y.screenDir && y.screenDir) out.push(`${s.name} now moves ${y.screenDir}`);
      if (Math.abs(x.distance - y.distance) > Math.max(0.5, 0.15 * x.distance)) out.push(`${s.name} now ${y.verb} ${y.distance} m (was ${x.distance} m)`);
      if (x.note !== y.note) out.push(y.note ? `${s.name} is now ${y.note} during the ${what}` : `${s.name} keeps a steady pace during the ${what}`);
    }
  }
  for (const [id, s] of A) if (!B.has(id)) out.push(`${s.name} is no longer in frame`);
  if (a.lighting.description !== b.lighting.description) out.push(`lighting is now: ${b.lighting.description}`);
  const fa = a.fx.map((f) => f.kind).join(','), fb = b.fx.map((f) => f.kind).join(','); if (fa !== fb) out.push(`effects in shot are now: ${fb || 'none'}`);
  if (a.aspect !== b.aspect) out.push(`aspect ratio is now ${b.aspect}`);
    return out;
}
/** Which shots did an edit touch, and how — the input to the edit-aware prompt compiler. */
export function diffProjects(before: Project, after: Project): ShotDiff[] {
  const fa = allShotFacts(before), out: ShotDiff[] = [];
  for (const s of after.shots) { const b = shotFacts(after, s), a = fa[s.id]; if (!a) out.push({ shotId: s.id, name: s.name, changes: ['new shot'] }); else if (a.hash !== b.hash) { const changes = diffShotFacts(a, b); if (changes.length) out.push({ shotId: s.id, name: s.name, changes }); } }
  return out;
}
