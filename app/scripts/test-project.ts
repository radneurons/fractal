// SPEC §17 test-project: zip round trip deep-equal; v2 → v3 migration; undo/redo of 50 random commands.
import { check, done } from './lib/check.ts';
import { packProject, unpackProject, migrateProject, packAnalysis, unpackAnalysis, type ProjectDoc } from '../src/project/zip.ts';
import { defaultState } from '../src/project/state.ts';
import { SnapshotHistory } from '../src/project/history.ts';
import { mulberry32 } from '../src/analysis/dsp.ts';
import { readWav } from './lib/node-audio.ts';
import { analyze } from '../src/analysis/index.ts';
import { lyricsFromText } from '../src/lyrics/build.ts';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const pcm = readWav('public/demo/demo-song.wav');
const a = analyze(pcm);
const ly = lyricsFromText(readFileSync('public/demo/demo-song.lrc', 'utf8'), a);
const st = defaultState();
st.layers.push({ id: 'l2', kind: 'effect', effect: 'swarm', instanceId: 'i2', enabled: true, blend: 'screen', opacity: 0.4, mask: 'inside-words' });
st.routes.push({ id: 'r', source: 'bass', target: { instanceId: 'plan:swarm', key: 'breath' }, amount: 0.3, curve: 'exp', attackMs: 10, releaseMs: 100, lo: 0, hi: 1, invert: false, enabled: true });
st.lanes.push({ target: { instanceId: 'post', key: 'bloom' }, keys: [{ t: 1, v: 0.2, ease: 'linear' }], snap: 'beat' });
st.instances['plan:press'] = { effect: 'press', params: { wMax: 3 } };
const doc: ProjectDoc = { version: 3, name: 'Round trip', created: 1, modified: 2, audioName: 'demo.wav', lyricsText: 'x', translationText: 'y', lyrics: ly, state: st };
const audio = new Uint8Array(readFileSync('public/demo/demo-song.wav'));
const zip = packProject({ doc, audio, media: { m1: new Uint8Array([1, 2, 3]) }, analysis: a, lrc: '[00:01.00]hi' });
const back = unpackProject(zip);
check('zip round trip: project.json deep-equal', isDeepStrictEqual(JSON.parse(JSON.stringify(back.doc)), JSON.parse(JSON.stringify(doc))));
check('zip round trip: audio and media bytes', back.audio!.length === audio.length && back.audio!.every((v, i) => v === audio[i]) && back.media.m1.join() === '1,2,3');
const aa = unpackAnalysis(packAnalysis(a));
check('analysis.json round trip (typed arrays, NaN)', isDeepStrictEqual(Array.from(aa.loud), Array.from(a.loud)) && Number.isNaN(aa.f0.find((v) => Number.isNaN(v)) ?? NaN) && aa.beats.length === a.beats.length);
check('zip is small for text (deflated JSON)', zip.length < audio.length + 2_000_000, `${(zip.length / 1e6).toFixed(1)} MB`);
// v2 → v3 migration: hybrid → layers
const v2 = { settings: { aspect: '9:16', seed: 42 }, effect: 'broadside', mode: 'director', transition: 'ink wipe', params: { broadside: { palette: 'neon' }, swarm: { count: 8000 } }, hybrid: { material: 'liquid chrome', strength: 0.7, backdrop: 'material', tint: '#ffcc00', overlay: 'swarm', blend: 'screen', opacity: 0.5 }, title: 'Old', lyricsText: 'hello' };
const m = migrateProject(v2);
check('v2 hybrid.material → the plan layer material', m.state.layers[0].kind === 'plan' && m.state.layers[0].material?.kind === 'chrome' && m.state.layers[0].material?.strength === 0.7);
check('v2 hybrid.overlay → a second layer', m.state.layers.length === 2 && m.state.layers[1].effect === 'swarm' && m.state.layers[1].blend === 'screen' && m.state.layers[1].opacity === 0.5);
check('v2 settings, params, mode and transition carried', m.state.settings.aspect === '9:16' && m.state.settings.seed === 42 && m.state.instances['plan:broadside'].params.palette === 'neon' && m.state.plan.mode === 'director' && m.state.plan.transition === 'wipe' && m.version === 3);
let threw = false; try { migrateProject({ version: 99, state: {} }); } catch { threw = true; }
check('a newer project version is refused', threw);
// undo/redo of 50 random commands returns to the start state
let state = { x: 0, list: [] as number[], s: 'a' };
const h = new SnapshotHistory(() => state, (v) => { state = v as typeof state; });
const start = JSON.stringify(state);
const rnd = mulberry32(5);
const snaps: string[] = [start];
for (let i = 0; i < 50; i++) {
  const r = rnd();
  state = JSON.parse(JSON.stringify(state));
  if (r < 0.33) state.x += Math.floor(rnd() * 10) + 1; else if (r < 0.66) state.list.push(i); else state.s += String.fromCharCode(97 + (i % 26));
  h.commit(`cmd ${i}`);
  snaps.push(JSON.stringify(state));
}
let ok = true;
for (let i = 50; i > 0; i--) { h.history.undo(); if (JSON.stringify(state) !== snaps[i - 1]) ok = false; }
check('50 undos return to the start state', ok && JSON.stringify(state) === start);
for (let i = 0; i < 50; i++) h.history.redo();
check('50 redos return to the end state', JSON.stringify(state) === snaps[50]);
// coalescing: a drag is one step
const before = h.history.list().length;
for (let i = 0; i < 5; i++) { state = { ...state, x: state.x + 1 }; h.commit('Change opacity', 'Change opacity'); }
check('a drag coalesces into one step', h.history.list().length === before + 1);
done();
