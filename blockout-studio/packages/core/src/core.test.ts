import { describe, expect, it } from 'vitest';
import * as C from './index';

const demo = C.demoProject();
const cs = (pos: C.Vec3, target: C.Vec3, focal = 35): C.CamState => ({ pos, target, quat: C.qLookAt(pos, target), focal, focus: 5, fstop: 2.8, roll: 0, fovY: C.fovYFor(focal, 36, 16 / 9), aspect: 16 / 9, near: 0.1, far: 1000 });
const track = (n: number, f: (u: number) => C.CamState) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));

describe('splines + interpolation', () => {
  it('arc-length sampling is uniform on a non-uniform curve', () => {
    const pts: C.Vec3[] = [[0, 0, 0], [1, 0, 0], [10, 0, 0], [11, 0, 5]];
    const cubic = new C.ArcTable((u) => [u * u * u, 0, 0], 0, 2, 800), cs2 = Array.from({ length: 11 }, (_, i) => cubic.at((i / 10) * cubic.total)[0]);
    cs2.forEach((x, i) => expect(x).toBeCloseTo(0.8 * i, 3));
    const tb = new C.ArcTable((u) => C.catmullRom(pts, u), 0, 3, 400);
    const steps = Array.from({ length: 21 }, (_, i) => tb.at((i / 20) * tb.total));
    const d = steps.slice(1).map((p, i) => C.dist(p, steps[i]));
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.35);
    expect(C.dist(tb.at(0), pts[0])).toBeLessThan(1e-9); expect(C.dist(tb.at(tb.total), pts[3])).toBeLessThan(1e-9);
  });
  it('catmull-rom passes through its control points', () => { const pts: C.Vec3[] = [[0, 0, 0], [2, 1, 0], [3, 0, 4]]; pts.forEach((p, i) => expect(C.dist(C.catmullRom(pts, i), p)).toBeLessThan(1e-9)); });
  it('easing endpoints + monotonic', () => { for (const e of C.EASINGS) { expect(C.ease(e, 0)).toBe(0); expect(C.ease(e, 1)).toBe(1); let prev = 0; for (let i = 0; i <= 20; i++) { const v = C.ease(e, i / 20); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; } } });
  it('keyframe interpolation hits keys exactly and holds outside the range', () => {
    const k = demo.characters.kenji; for (const key of k.keys) { const p = C.evalCharacter({ ...demo, terrain: { ...demo.terrain, heights: [] } }, k, key.t).pos; expect(C.dist(p, key.pos as C.Vec3)).toBeLessThan(1e-6); }
    expect(C.evalCharacter(demo, k, 99).pos[0]).toBeCloseTo(3.4, 5);
    const cam = demo.cameras.cam2; expect(C.evalCamera(demo, cam, 3.0).pos).toEqual(cam.keys[0].pos); expect(C.evalCamera(demo, cam, 3.8).focal).toBeCloseTo(28, 5);
  });
  it('foot speed matches path speed (phase advances with distance)', () => {
    const k = demo.characters.kenji, a = C.evalCharacter(demo, k, 1.0), b = C.evalCharacter(demo, k, 1.5);
    expect(a.speed).toBeGreaterThan(5); expect(b.dist - a.dist).toBeCloseTo(C.dist(a.pos, b.pos), 0);
  });
  it('IK keeps feet on or above the terrain', () => {
    const p = { ...demo, terrain: { size: 40, res: 3, heights: [0, 0, 0, 1, 1, 1, 3, 3, 3] } }, k = p.characters.kenji;
    for (const t of [0.2, 0.9, 1.7, 2.4]) { const sk = C.characterSkeleton(p, k, t); for (const f of ['footL', 'footR'] as const) expect(sk.pos[f][1]).toBeGreaterThanOrEqual(C.terrainHeight(p.terrain, sk.pos[f][0], sk.pos[f][2]) + 0.049 * sk.scale - 1e-6); }
  });
});

describe('op reducer', () => {
  const ops: C.Op[] = [
    { type: 'addCharacter', character: C.CharacterS.parse({ id: 'x', name: 'X', idColor: '#112233' }) },
    { type: 'updateCharacter', id: 'kenji', patch: { height: 1.9, name: 'Kenji II' } }, { type: 'removeCharacter', id: 'ren' },
    { type: 'addPathKey', characterId: 'kenji', key: C.PathKeyS.parse({ id: 'new', t: 1.2, pos: [-12, 0, 4] }) },
    { type: 'moveKeyframe', target: { kind: 'character', id: 'kenji' }, keyId: 'k1', t: 9.9, pos: [1, 0, 1] }, { type: 'moveKeyframe', target: { kind: 'camera', id: 'cam2' }, keyId: 'c2k1', t: 0.1 },
    { type: 'removeKeyframe', target: { kind: 'character', id: 'kenji' }, keyId: 'k3' }, { type: 'setLens', cameraId: 'cam2', focal: 85 },
    { type: 'retimeSegment', start: 6, end: 8.5, newEnd: 7.5, ripple: true }, { type: 'updateShot', id: 's2', patch: { end: 5 } }, { type: 'removeShot', id: 's3' },
    { type: 'reorderShots', order: ['s6', 's5', 's4', 's3', 's2', 's1'] }, { type: 'setLighting', patch: { timeOfDay: 9 } }, { type: 'sculptTerrain', cells: [[0, 3], [5, -1]] },
    { type: 'setStyleBible', patch: { medium: 'ink wash' } }, { type: 'setCharacterBible', characterId: 'kenji', patch: { weapon: 'spear' } },
    { type: 'addPromptVersion', activate: true, version: { id: 'pv1', shotId: 's1', provider: 'canonical', text: 'hi', factsHash: 'x', author: 'user', note: '', at: 0 } },
    { type: 'addFx', fx: C.FxS.parse({ id: 'f2', name: 'Rain', kind: 'rain', idColor: '#101010' }) }, { type: 'removeFx', id: 'dust' }, { type: 'setProject', patch: { aspect: '16:9', fps: 30 } },
    { type: 'addPoseKey', characterId: 'kenji', key: { id: 'pz', t: 1, joint: 'head', rot: [0, 0.5, 0], ease: 'linear' } },
    { type: 'batch', label: 'combo', ops: [{ type: 'setLens', cameraId: 'cam3', focal: 100 }, { type: 'removeProp', id: 'tree' }, { type: 'addMarker', marker: { id: 'mz', t: 2, label: 'z', kind: 'beat' } }] },
  ];
  it.each(ops.map((o) => [o.type, o] as const))('%s: apply → invert → equal', (_n, op) => {
    const before = JSON.stringify(demo), res = C.applyOp(demo, op);
    expect(res.changed).toBe(true); expect(JSON.stringify(demo)).toBe(before); // input untouched
    expect(C.ProjectS.safeParse(res.project).success).toBe(true);
    expect(C.applyOp(res.project, res.inverse).project).toEqual(demo);
    expect(C.OpS.parse(JSON.parse(JSON.stringify(op)))).toBeTruthy(); expect(C.OpS.parse(JSON.parse(JSON.stringify(res.inverse)))).toBeTruthy();
  });
  it('rejects invalid ops atomically', () => {
    expect(() => C.applyOp(demo, { type: 'removeCamera', id: 'cam1' })).toThrow(/used by a shot/);
    expect(() => C.applyOp(demo, C.batch('x', [{ type: 'setLens', cameraId: 'cam1', focal: 20 }, { type: 'removeShot', id: 'nope' }]))).toThrow();
    expect(() => C.applyUntrusted(demo, { type: 'setLens', cameraId: 'cam1', focal: 9000 })).toThrow(/invalid op/);
  });
  it('undo/redo through history, whole batch as one entry', () => {
    let st = C.commit(demo, C.emptyHistory(), C.batch('Claude: test', ops.slice(0, 2)), { author: 'claude' });
    st = C.commit(st.project, st.history, ops[7]); expect(st.history.past.map((e) => e.label)).toEqual(['Claude: test', 'Set Cam B · low hero lens to 85mm']);
    const u1 = C.undo(st.project, st.history), u2 = C.undo(u1.project, u1.history); expect(u2.project).toEqual(demo);
    const r1 = C.redo(u2.project, u2.history), r2 = C.redo(r1.project, r1.history); expect(r2.project).toEqual(st.project);
  });
  it('removing a character cleans references', () => { const p = C.applyOp(demo, { type: 'removeCharacter', id: 'kenji' }).project; expect(p.cameras.cam1.attach).toBeUndefined(); expect(p.fx.dust.attachTo).toBeUndefined(); expect(p.characters.ren.keys[0].facing.mode).toBe('path'); });
});

describe('cinematography classifiers', () => {
  const T: C.Vec3 = [0, 1.5, 0], dt = 0.1;
  const cases: [string, C.CamState[], Partial<C.CameraMotion>][] = [
    ['static', track(20, () => cs([0, 1.5, 5], T)), { type: 'static', speed: 'locked' }],
    ['pan', track(20, (u) => cs([0, 1.5, 5], [-3 + 6 * u, 1.5, 0])), { type: 'pan' }],
    ['tilt', track(20, (u) => cs([0, 1.5, 5], [0, 4 * u, 0])), { type: 'tilt' }],
    ['dolly in', track(20, (u) => cs([0, 1.5, 8 - 5 * u], T)), { type: 'dolly in' }],
    ['dolly out', track(20, (u) => cs([0, 1.5, 3 + 5 * u], T)), { type: 'dolly out' }],
    ['truck right', track(20, (u) => cs([-2 + 4 * u, 1.5, 5], [-2 + 4 * u, 1.5, 0])), { type: 'truck right' }],
    ['truck left', track(20, (u) => cs([2 - 4 * u, 1.5, 5], [2 - 4 * u, 1.5, 0])), { type: 'truck left' }],
    ['crane up', track(20, (u) => cs([0, 0.5 + 5 * u, 6], T)), { type: 'crane up' }],
    ['orbit', track(20, (u) => cs([Math.sin(u * 2) * 5, 1.5, Math.cos(u * 2) * 5], T)), { type: 'orbit' }],
    ['whip pan', track(20, (u) => cs([0, 1.5, 5], [u < 0.45 ? -4 : u > 0.55 ? 4 : -4 + 80 * (u - 0.45), 1.5, 0])), { type: 'whip pan' }],
    ['zoom in', track(20, (u) => cs([0, 1.5, 5], T, 35 + 50 * u)), { type: 'zoom in' }],
    ['dolly zoom', track(20, (u) => cs([0, 1.5, 8 - 5 * u], T, 80 - 50 * u)), { type: 'dolly zoom' }],
  ];
  it.each(cases)('classifies %s', (_n, samples, want) => expect(C.classifyCameraMotion(samples, dt)).toMatchObject(want));
  it('handheld = shake with no net move', () => expect(C.classifyCameraMotion(track(20, (u) => cs([Math.sin(u * 40) * 0.02, 1.5, 5], T)), dt, { shake: true }).type).toBe('handheld'));
  it('easing detection', () => {
    expect(C.classifyCameraMotion(track(30, (u) => cs([0, 1.5, 8 - 5 * C.ease('easeInOut', u)], T)), dt).easing).toBe('ease-in-out');
    expect(C.classifyCameraMotion(track(30, (u) => cs([0, 1.5, 8 - 5 * u], T)), dt).easing).toBe('constant');
    expect(C.classifyCameraMotion(track(30, (u) => cs([0, 1.5, 8 - 5 * C.ease('easeOut', u)], T)), dt).easing).toBe('ease-out');
  });
  it('lens categories', () => expect([14, 24, 50, 85, 135, 400].map(C.lensCategory)).toEqual(['ultra-wide', 'wide', 'normal', 'portrait', 'telephoto', 'super-telephoto']));
  it('shot size from framed body height', () => {
    const size = (d: number, focal: number) => C.shotSizeFromFraction(C.bodyFraction(cs([0, 1, d], [0, 1, 0], focal), [0, 1, 0], 1.75));
    expect(size(60, 24)).toBe('EWS'); expect(size(6, 35)).toBe('WS'); expect(size(1.6, 35)).toBe('MS'); expect(size(1.5, 85)).toBe('CU'); expect(size(0.8, 135)).toBe('ECU');
  });
  it('camera angle', () => { const e: C.Vec3 = [0, 1.6, 0]; expect(C.cameraAngle([0, 0.3, 3], e)).toBe('low'); expect(C.cameraAngle([0, 1.6, 3], e)).toBe('eye-level'); expect(C.cameraAngle([0, 4, 3], e)).toBe('high'); expect(C.cameraAngle([0, 12, 0.5], e)).toBe('overhead'); });
  it('demo shots read as designed', () => {
    const f = C.allShotFacts(demo);
    expect(f.s1.camera.motion.type).toBe('tracking'); expect(f.s1.camera.angle).toBe('overhead');
    expect(f.s2.camera.angle).toBe('low'); expect(f.s2.camera.motion.type).toBe('dolly in');
    expect(f.s3.camera.ots).toBe('Kenji'); expect(f.s3.subjects[0].name).toBe('Ren');
    expect(f.s4.camera.motion.type).toBe('orbit'); expect(f.s5.camera.motion.type).toBe('whip pan'); expect(f.s6.subjects[0].sizeStart).toBe('EWS');
    expect(f.s1.subjects[0].beats[0]).toMatchObject({ verb: 'sprints', clip: 'sprint' }); expect(f.s1.lighting.quality).toMatch(/golden-hour/);
  });
  it('semantic diff names what changed, and only in affected shots', () => {
    const after = C.applyOp(demo, C.batch('e', [{ type: 'setLens', cameraId: 'cam2', focal: 85 }, { type: 'moveKeyframe', target: { kind: 'character', id: 'ren' }, keyId: 'r2', t: 6.5 }])).project;
    const d = C.diffProjects(demo, after); expect(d.map((x) => x.shotId)).toEqual(['s2', 's4']);
    expect(d[0].changes.join('|')).toMatch(/changed from 28mm to 85mm/); expect(d[1].changes.join('|')).toMatch(/Ren's lunge moved from 0\.9s to 0\.5s/);
    const curved = C.applyOp(demo, { type: 'addPathKey', characterId: 'kenji', key: C.PathKeyS.parse({ id: 'kc', t: 1.3, pos: [-14, 0, 7], clip: 'sprint' }) }).project;
    const dc = C.diffProjects(demo, curved); expect(dc.map((x) => x.shotId)).toEqual(['s1']); expect(dc[0].changes.join('|')).toMatch(/Kenji's path now curves/);
  });
});

describe('continuity', () => {
  const issues = C.runContinuity(demo);
  it('finds the deliberate 180° violation at the whip-pan shot', () => { const ax = issues.filter((i) => i.kind === 'axis-180'); expect(ax.some((i) => i.shots.join() === 's4,s5')).toBe(true); expect(ax[0].severity).toBe('high'); });
  it('no false 180° flags inside the well-behaved part of the cut', () => expect(issues.filter((i) => i.kind === 'axis-180' && ['s1,s2', 's2,s3', 's3,s4'].includes(i.shots.join()))).toEqual([]));
  it('detects a jump cut', () => {
    const p = C.applyOp(demo, C.batch('j', [{ type: 'addCamera', camera: { ...demo.cameras.cam2, id: 'cam2b', name: 'B2', keys: demo.cameras.cam2.keys.map((k) => ({ ...k, id: k.id + 'b', pos: [k.pos[0] + 0.3, k.pos[1], k.pos[2]] as C.Vec3 })) } }, { type: 'updateShot', id: 's3', patch: { cameraId: 'cam2b', start: 4.6, end: 6 } }])).project;
    expect(C.runContinuity(p).some((i) => i.kind === 'jump-cut' && i.shots.join() === 's2,s3')).toBe(true);
  });
  it('detects timing gaps and prop/bible conflicts', () => {
    const p = C.applyOp(demo, C.batch('g', [{ type: 'updateShot', id: 's2', patch: { end: 3.8 } }, { type: 'updateCharacter', id: 'ren', patch: { held: { kind: 'none', hand: 'R' } } }])).project, k = C.runContinuity(p).map((i) => i.kind);
    expect(k).toContain('timing-gap'); expect(k).toContain('prop-continuity');
  });
});

describe('determinism', () => {
  it('compileFrame is a pure function of (project, t)', () => { const a = C.compileFrame(demo, 6.4), b = C.compileFrame(C.ProjectS.parse(JSON.parse(JSON.stringify(demo))), 6.4); expect(C.hashOf(a.drawables)).toBe(C.hashOf(b.drawables)); expect(a.drawables.length).toBeGreaterThan(40); });
  it('sun: golden hour is low and warm', () => { const s = C.sunState(demo.lighting); expect(s.elevation).toBeGreaterThan(0); expect(s.elevation).toBeLessThan(15); expect(s.color[2]).toBeLessThan(0.7); });
});
