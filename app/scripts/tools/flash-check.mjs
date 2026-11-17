// Independent flash check of any video file (WCAG 2.3.1 general flashes, whole-frame and per 4×4 cell):
//   node scripts/tools/flash-check.mjs video.mp4
// Decodes with ffmpeg at 64×36 grey, converts to linear luminance, counts opposing ≥ 10 % changes (darker side < 0.8)
// over ≥ 25 % of the screen (WCAG's area rule: 4 of 16 cells, or the whole frame) and reports the worst number of
// flashes in any one-second window. > 3 is a violation.
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
  // per-series transitions (opposing ≥ 10 % changes between extrema, darker side < 0.8)
  const trans = (sr) => { const out = new Int8Array(n); let ref = sr[0], dir = 0; for (let i = 1; i < n; i++) { const d = sr[i] - ref; if (Math.abs(d) >= 0.1 && Math.min(sr[i], ref) < 0.8) { const sg = Math.sign(d); if (sg !== dir) { out[i] = sg; dir = sg; } ref = sr[i]; } else if ((dir > 0 && sr[i] > ref) || (dir < 0 && sr[i] < ref)) ref = sr[i]; } return out; };
  // WCAG area rule: a flash counts when ≥ 25 % of the screen (4 of 16 cells, or the whole frame) changes the same way
  const cellT = series.slice(1).map(trans), wholeT = trans(series[0]);
  const events = []; let lastSign = 0, lastF = -10;
  for (let i = 1; i < n; i++) {
    let up = 0, down = 0;
    for (const t of cellT) { if (t[i] > 0 || t[i - 1] > 0) up++; else if (t[i] < 0 || t[i - 1] < 0) down++; }
    const sg = wholeT[i] || (up >= 4 && up >= down ? 1 : down >= 4 ? -1 : 0);
    if (!sg || (sg === lastSign && i - lastF <= 2)) { if (sg) lastF = i; continue; }
    events.push(i); lastSign = sg; lastF = i;
  }
  let worst = 0, worstAt = 0;
  for (let i = 0, j = 0; i < events.length; i++) { while (events[i] - events[j] >= fps) j++; const f = Math.floor((i - j + 1) / 2); if (f > worst) { worst = f; worstAt = events[i] / fps; } }
  return { frames: n, worstFlashesPerSecond: worst, at: worstAt, violation: worst > 3 };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const f of process.argv.slice(2)) { const r = flashStats(f); console.log(`${f}: ${r.frames} frames, worst ${r.worstFlashesPerSecond} flashes/s${r.worstFlashesPerSecond ? ` at ${r.at.toFixed(1)} s` : ''} → ${r.violation ? 'VIOLATION' : 'ok'}`); }
}
