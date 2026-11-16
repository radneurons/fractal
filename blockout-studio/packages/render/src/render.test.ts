import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoProject, applyOp } from '@blockout/core';
import { buildShotPackage, decodePNG, encodePNG, hashBytes, softRenderer, passSize, PASSES, type PassName } from './index';

const dir = fileURLToPath(new URL('../golden/', import.meta.url)), demo = demoProject(), [w, h] = passSize(demo, 90);
const CASES: [string, number][] = [['s2', 20], ['s4', 30], ['s6', 60]];

describe('png codec', () => {
  it('round-trips RGBA exactly', () => { const px = softRenderer.render(demo, demo.shots[3], 10, 'clay', w, h), img = decodePNG(encodePNG(px, w, h)); expect(img.width).toBe(w); expect(hashBytes(img.data)).toBe(hashBytes(px)); });
});
describe('golden images (software renderer)', () => {
  for (const [shotId, frame] of CASES) for (const pass of PASSES) it(`${shotId} f${frame} ${pass}`, () => {
    const shot = demo.shots.find((s) => s.id === shotId)!, px = softRenderer.render(demo, shot, frame, pass, w, h), file = `${dir}${shotId}_${frame}_${pass}.png`;
    if (process.env.UPDATE_GOLDEN || !existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, encodePNG(px, w, h, 9)); return; }
    const gold = decodePNG(new Uint8Array(readFileSync(file))); expect([gold.width, gold.height]).toEqual([w, h]);
    let diff = 0, bad = 0; for (let i = 0; i < px.length; i++) { const d = Math.abs(px[i] - gold.data[i]); diff += d; if (d > 24) bad++; }
    expect(diff / px.length).toBeLessThan(0.6); expect(bad / px.length).toBeLessThan(0.004); // tolerance: sub-pixel edge shifts across JS engines
  });
});
describe('shot package', () => {
  const opts = { renderer: softRenderer, passes: ['clay', 'depth', 'id', 'pose', 'fx'] as PassName[], height: 54, prompts: { canonical: 'test' } };
  const shot = { ...demo.shots[2], end: demo.shots[2].start + 0.5 };
  it('is byte-identical for the same project, shot and seed', async () => {
    const a = await buildShotPackage(demo, shot, opts), b = await buildShotPackage(demoProject(), shot, opts);
    expect(hashBytes(a.zip)).toBe(hashBytes(b.zip)); expect(a.zip.length).toBe(b.zip.length); expect(a.manifest.hashes.content).toBe(b.manifest.hashes.content);
  });
  it('changes when the staging changes', async () => {
    const a = await buildShotPackage(demo, shot, opts), b = await buildShotPackage(applyOp(demo, { type: 'setLens', cameraId: 'cam3', focal: 35 }).project, shot, opts);
    expect(a.manifest.hashes.content).not.toBe(b.manifest.hashes.content);
  });
  it('contains passes, stills, camera data, pose keypoints, palette and manifest', async () => {
    const { files, manifest } = await buildShotPackage(demo, shot, opts), names = Object.keys(files);
    for (const f of ['manifest.json', 'camera.json', 'pose.json', 'first_frame.png', 'last_frame.png', 'contact_sheet.png', 'passes/id/0000.png', 'passes/clay/0011.png']) expect(names).toContain(f);
    expect(manifest.frames).toBe(12); expect(manifest.idPalette.find((e) => e.entityId === 'kenji')).toMatchObject({ color: '#56b4e9', kind: 'character' }); expect(manifest.idPalette.find((e) => e.entityId === 'kenji')!.description).toMatch(/haori/);
    const cam = JSON.parse(new TextDecoder().decode(files['camera.json'])); expect(cam.frames).toHaveLength(12); expect(cam.frames[0].intrinsics.focalMm).toBe(60); expect(cam.frames[0].extrinsics.cameraToWorld).toHaveLength(16);
    const pose = JSON.parse(new TextDecoder().decode(files['pose.json'])); expect(pose[0].people[0].pose_keypoints_2d).toHaveLength(54); expect(pose[0].people[0].hand_left_keypoints_2d).toHaveLength(63);
  });
  it('id pass only contains palette colours', async () => {
    const px = softRenderer.render(demo, demo.shots[3], 12, 'id', w, h), pal = new Set(['#000000', ...(await buildShotPackage(demo, shot, { ...opts, passes: [] })).manifest.idPalette.map((e) => e.color)]);
    for (let i = 0; i < px.length; i += 4) expect(pal.has('#' + [px[i], px[i + 1], px[i + 2]].map((c) => c.toString(16).padStart(2, '0')).join(''))).toBe(true);
  });
});
