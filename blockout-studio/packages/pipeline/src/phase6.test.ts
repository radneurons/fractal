import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { demoProject } from '@blockout/core';
import { OpStream, detectBeats, peaks } from './index';

describe('beat detection', () => {
  it('finds the tempo and beats of a click track', () => {
    const sr = 22050, bpm = 120, dur = 8, s = new Float32Array(sr * dur);
    for (let b = 0.25; b < dur; b += 60 / bpm) for (let i = 0; i < 800; i++) { const k = Math.floor(b * sr) + i; if (k < s.length) s[k] += Math.sin(i * 0.3) * Math.exp(-i / 200); }
    const r = detectBeats(s, sr); expect(r.bpm).toBeGreaterThan(117); expect(r.bpm).toBeLessThan(123); expect(r.onsets.length).toBeGreaterThanOrEqual(14);
    for (const t of [0.25, 1.25, 4.25]) expect(Math.min(...r.beats.map((x) => Math.abs(x - t)))).toBeLessThan(0.04);
    expect(peaks(s, 100)).toHaveLength(100);
  });
});
describe('collaboration over the op stream (Yjs)', () => {
  it('two peers editing concurrently converge to the same project', () => {
    const a = new OpStream('alice'), b = new OpStream('bob'); a.init(demoProject());
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc)); expect(b.project).toEqual(a.project);
    // offline concurrent edits, including a conflicting one
    a.push({ type: 'setLens', cameraId: 'cam2', focal: 85 }); a.push({ type: 'removeShot', id: 's3' });
    b.push({ type: 'updateShot', id: 's3', patch: { name: 'Bob renamed' } }); b.push({ type: 'setLighting', patch: { timeOfDay: 9 } });
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc)); Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project)); expect(a.project!.cameras.cam2.keys[0].focal).toBe(85); expect(a.project!.lighting.timeOfDay).toBe(9); expect(a.skipped).toBe(b.skipped);
  });
  it('a late joiner adopts the room state', () => { const a = new OpStream('a'); a.init(demoProject()); a.push({ type: 'setLens', cameraId: 'cam1', focal: 20 }); const c = new OpStream('c'); Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(a.doc)); expect(c.project!.cameras.cam1.keys[0].focal).toBe(20); });
});
