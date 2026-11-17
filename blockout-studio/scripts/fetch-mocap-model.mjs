// pnpm mocap:fetch — downloads the MediaPipe pose model once into apps/studio/public/models so mocap works offline.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const out = new URL('../apps/studio/public/models/pose_landmarker_full.task', import.meta.url);
if (existsSync(out)) { console.log('model already present:', out.pathname); process.exit(0); }
mkdirSync(new URL('.', out), { recursive: true });
const res = await fetch(url); if (!res.ok) { console.error(`download failed: HTTP ${res.status}`); process.exit(1); }
writeFileSync(out, Buffer.from(await res.arrayBuffer())); console.log('saved', out.pathname);
