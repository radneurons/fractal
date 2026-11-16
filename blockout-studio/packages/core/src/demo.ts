/** "Field Duel": the demo project that ships with the app. Fixed ids; fully deterministic. */
import { ProjectS, type Project, type CamKey, type PathKey } from './schema';
import { fbm1, type Vec3, clamp } from './math';

const K = 'kenji', R = 'ren';
const pk = (id: string, t: number, pos: Vec3, clip: string, extra: Partial<PathKey> = {}): PathKey => ({ id, t, pos, clip, facing: { mode: 'path' }, ease: 'linear', speed: 1, ...extra });
const ck = (id: string, t: number, pos: Vec3, target: Vec3, focal: number, extra: Partial<CamKey> = {}): CamKey => ({ id, t, pos, target, focal, focus: Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]), fstop: 2.8, roll: 0, ease: 'easeInOut', ...extra });

export function demoProject(): Project {
  const res = 49, size = 240, heights: number[] = [];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = (i / (res - 1) - 0.5) * size, z = (j / (res - 1) - 0.5) * size, r = Math.hypot(x, z), k = clamp((r - 30) / 50);
    heights.push(Math.round((fbm1(x * 0.03, 11) * fbm1(z * 0.03 + 5, 23) * 14 + fbm1((x + z) * 0.02, 5) * 3) * k * k * 100) / 100 + 0);
  }
  const faceRen = { mode: 'target' as const, targetId: R }, faceKenji = { mode: 'target' as const, targetId: K };
  const orbit: CamKey[] = []; for (let i = 0; i <= 5; i++) { const a = (35 + 22 * i) * Math.PI / 180; orbit.push(ck(`c4k${i}`, 6 + 0.5 * i, [Math.cos(a) * 5.2, 1.35 + 0.08 * i, Math.sin(a) * 5.2], [0, 1.15, 0], 40, { ease: 'linear' })); }
  return ProjectS.parse({
    id: 'field-duel', name: 'Field Duel', fps: 24, duration: 14, aspect: '2.39:1', seed: 7, budgetCap: 25,
    characters: {
      [K]: { id: K, name: 'Kenji', idColor: '#56b4e9', height: 1.78, build: 1.0, held: { kind: 'sword', hand: 'R' }, keys: [
        pk('k0', 0, [-22, 0, 0.6], 'sprint'), pk('k1', 2.6, [-5.2, 0, 0.1], 'run', { ease: 'easeOut' }), pk('k2', 3.4, [-1.7, 0, 0], 'idle', { facing: faceRen }),
        pk('k3', 6.0, [-1.7, 0, 0], 'slash', { facing: faceRen }), pk('k4', 6.75, [-1.0, 0, 0.1], 'block', { facing: faceRen }), pk('k5', 7.2, [-1.0, 0, 0.1], 'dodge', { facing: faceRen }),
        pk('k6', 7.8, [-0.9, 0, 0.5], 'slash', { facing: faceRen }), pk('k7', 8.55, [-0.6, 0, 0.4], 'idle', { facing: faceRen }), pk('k8', 10.2, [-0.6, 0, 0.4], 'walk'), pk('k9', 14, [3.4, 0, -3.6], 'walk'),
      ] },
      [R]: { id: R, name: 'Ren', idColor: '#e69f00', height: 1.72, build: 1.08, held: { kind: 'sword', hand: 'R' }, keys: [
        pk('r0', 0, [1.7, 0, 0], 'idle', { facing: faceKenji }), pk('r1', 6.1, [1.7, 0, 0], 'block', { facing: faceKenji }), pk('r2', 6.9, [1.5, 0, 0], 'thrust', { facing: faceKenji }),
        pk('r3', 7.5, [0.9, 0, 0.05], 'block', { facing: faceKenji }), pk('r4', 8.0, [1.0, 0, 0.1], 'hitReact', { facing: faceKenji }), pk('r5', 8.6, [1.3, 0, 0.1], 'fall', { facing: faceKenji }),
      ] },
    },
    cameras: {
      cam1: { id: 'cam1', name: 'Cam A · top-down', keys: [ck('c1k0', 0, [0, 15, 0.05], [0, 0, 0], 35)], attach: { characterId: K, lag: 0 }, lookAt: { characterId: K, offset: [0, 0, 0] } },
      cam2: { id: 'cam2', name: 'Cam B · low hero', keys: [ck('c2k0', 3.0, [0.9, 0.35, 2.3], [-1.7, 1.45, 0], 28), ck('c2k1', 4.6, [0.1, 0.42, 1.45], [-1.7, 1.5, 0], 28)] },
      cam3: { id: 'cam3', name: 'Cam C · OTS', keys: [ck('c3k0', 4.6, [-3.45, 1.6, 0.46], [1.7, 1.42, 0], 60, { fstop: 2 }), ck('c3k1', 6.0, [-3.35, 1.6, 0.44], [1.7, 1.42, 0], 60, { fstop: 2 })] },
      cam4: { id: 'cam4', name: 'Cam D · orbit', keys: orbit },
      cam5: { id: 'cam5', name: 'Cam E · whip', keys: [ck('c5k0', 8.5, [0.4, 1.5, -2.3], [-0.6, 1.4, 0.4], 50, { ease: 'linear' }), ck('c5k1', 8.95, [0.4, 1.5, -2.3], [-0.6, 1.4, 0.4], 50), ck('c5k2', 9.2, [0.4, 1.5, -2.3], [1.9, 0.5, 0.1], 50, { ease: 'linear' }), ck('c5k3', 10, [0.4, 1.5, -2.3], [1.9, 0.45, 0.1], 50)], shake: { profile: 'handheld', amount: 1, seed: 5 } },
      cam6: { id: 'cam6', name: 'Cam F · wide', keys: [ck('c6k0', 10, [-9, 1.1, 27], [1.5, 2.2, 0], 24, { fstop: 8 })] },
    },
    shots: [
      { id: 's1', name: '1 · Sprint (top-down)', cameraId: 'cam1', start: 0, end: 3.0 }, { id: 's2', name: '2 · Hero push-in', cameraId: 'cam2', start: 3.0, end: 4.6 },
      { id: 's3', name: '3 · Standoff OTS', cameraId: 'cam3', start: 4.6, end: 6.0 }, { id: 's4', name: '4 · Clash orbit', cameraId: 'cam4', start: 6.0, end: 8.5 },
      { id: 's5', name: '5 · Whip to reaction', cameraId: 'cam5', start: 8.5, end: 10 }, { id: 's6', name: '6 · Walk away (EWS)', cameraId: 'cam6', start: 10, end: 14 },
    ],
    fx: { dust: { id: 'dust', name: 'Dust trail', kind: 'dust', attachTo: K, pos: [0, 0, 0], size: [0.9, 0.9, 0.9], start: 0, end: 14, idColor: '#cc79a7', trail: 1.6 }, arc: { id: 'arc', name: 'Slash arc', kind: 'slash', attachTo: K, start: 6.2, end: 6.6, idColor: '#f0e442' } },
    props: { tree: { id: 'tree', name: 'Lone tree', kind: 'tree', pos: [9, 0, -14], scale: [1.4, 1.4, 1.4], idColor: '#009e73' }, rock: { id: 'rock', name: 'Boulder', kind: 'rock', pos: [-6, 0, -5], scale: [2.2, 1.6, 1.8], idColor: '#999999' } },
    scatter: { wheat: { id: 'wheat', kind: 'grass', seed: 3, center: [0, 0, 0], radius: 38, count: 900 }, stones: { id: 'stones', kind: 'rock', seed: 9, center: [4, 0, -6], radius: 26, count: 18 } },
    terrain: { size, res, heights },
    lighting: { timeOfDay: 18.6, latitude: 35, dayOfYear: 172, north: 200, skyColor: '#f2b36b', sunIntensity: 1 },
    markers: { m1: { id: 'm1', t: 6, label: 'Clash', kind: 'marker' }, m2: { id: 'm2', t: 8.6, label: 'Ren falls', kind: 'marker' } },
    bibles: {
      style: { logline: 'Two swordsmen settle a debt on a windswept golden plain at dusk.', medium: 'hand-painted anime, visible brush texture, cel-shaded figures', era: 'timeless feudal Japan', palette: ['#f2b36b', '#e8c45a', '#3a6ea5', '#f7f1e3', '#2b2b33'], lensHabits: 'anamorphic 2.39:1, wide lenses for landscape, long lens for faces; no dutch angles', lighting: 'golden hour, saturated sky, towering cumulus clouds, rim-lit figures, long shadows over painterly wheat', references: ['saturated sky with cumulus clouds', 'painterly wheat field bending in wind'], negative: 'photorealism, 3D render, text, watermark, extra limbs, warped hands' },
      characters: {
        [K]: { appearance: 'lean ronin in his thirties, tied-back black hair, weathered face, calm eyes', wardrobe: 'grey haori over charcoal hakama, straw sandals', weapon: 'katana with a plain black hilt', silhouette: 'narrow, upright, long coat tails trailing in the wind' },
        [R]: { appearance: 'broad-shouldered duelist, cropped hair, scar across the left brow', wardrobe: 'ochre kimono with a crimson sash, armoured bracers', weapon: 'katana with a red-wrapped hilt', silhouette: 'wide stance, heavy shoulders, sash streaming sideways' },
      },
    },
    memory: { mem1: { id: 'mem1', kind: 'preference', text: 'Always frame for 2.39:1.' }, mem2: { id: 'mem2', kind: 'preference', text: 'I hate dutch angles.' } },
  });
}
