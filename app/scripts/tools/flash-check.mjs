// Independent flash check of any video file (WCAG 2.3.1 general flashes, whole-frame and per 4×4 cell):
//   node scripts/tools/flash-check.mjs video.mp4
// Decodes with ffmpeg at 64×36 grey, converts to linear luminance, counts opposing ≥ 10 % changes (darker side < 0.8)
// and reports the worst number of flashes in any one-second window. > 3 is a violation.
import { execFileSync } from 'node:child_process';

export function flashStats(file, fps = 30) {
  const W = 64, H = 36;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  const n = Math.floor(raw.length / (W * H));
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const series = []; // whole frame + 16 cells
  for (let c = 0; c < 17; c++) series.push(new Float32Array(n));
  for (let i = 0; i < n; i++) {
    let all = 0; const cell = new Float64Array(16);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = lin(raw[i * W * H + y * W + x]); all += v; cell[Math.min(3, Math.floor((y / H) * 4)) * 4 + Math.min(3, Math.floor((x / W) * 4))] += v; }
    series[0][i] = all / (W * H); for (let c = 0; c < 16; c++) series[c + 1][i] = cell[c] / ((W * H) / 16);
  }
  let worst = 0, worstAt = 0;
  for (const s of series) {
    const trans = []; let ref = s[0], dir = 0;
    for (let i = 1; i < n; i++) {
      const d = s[i] - ref;
      if (Math.abs(d) >= 0.1 && Math.min(s[i], ref) < 0.8) { const sg = Math.sign(d); if (sg !== dir) { trans.push(i); dir = sg; } ref = s[i]; }
      else if (Math.sign(d) === dir) ref = dir > 0 ? Math.max(ref, s[i]) : Math.min(ref, s[i]);
      else if (Math.abs(d) < 0.1) { /* within tolerance of the reference */ }
    }
    for (let i = 0, j = 0; i < trans.length; i++) { while (trans[i] - trans[j] >= fps) j++; const f = Math.floor((i - j + 1) / 2); if (f > worst) { worst = f; worstAt = trans[i] / fps; } }
  }
  return { frames: n, worstFlashesPerSecond: worst, at: worstAt, violation: worst > 3 };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const f of process.argv.slice(2)) { const r = flashStats(f); console.log(`${f}: ${r.frames} frames, worst ${r.worstFlashesPerSecond} flashes/s${r.worstFlashesPerSecond ? ` at ${r.at.toFixed(1)} s` : ''} → ${r.violation ? 'VIOLATION' : 'ok'}`); }
}
