// Generates synthetic test songs (no copyrighted material) + matching lyric files with known timing.
//   public/demo/demo-song.wav   120 BPM, 4/4, 72 s: intro, verse, chorus, breakdown, drop-chorus, outro
//   public/demo/demo-song.lrc   enhanced (word-level) LRC — ground-truth word onsets
//   public/demo/demo-song.json  ground truth: bpm, downbeats, section starts, drop time, words
import { writeFileSync, mkdirSync } from 'node:fs';

const SR = 44100, BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
const sections = [
  { label: 'intro', bars: 4 }, { label: 'verse', bars: 8 }, { label: 'chorus', bars: 8 },
  { label: 'breakdown', bars: 4 }, { label: 'chorus', bars: 8 }, { label: 'outro', bars: 4 }
];
const totalBars = sections.reduce((a, s) => a + s.bars, 0), DUR = totalBars * BAR + 1.0;
const N = Math.ceil(DUR * SR), L = new Float32Array(N), R = new Float32Array(N);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const add = (i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - pan) ; R[i] += v * (1 + pan); } };

function kick(t, g = 1) { const i0 = Math.round(t * SR); for (let k = 0; k < SR * 0.35; k++) { const tt = k / SR; const f = 50 + 90 * Math.exp(-tt * 28); add(i0 + k, g * 0.9 * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 9)); } }
function snare(t, g = 1) { const i0 = Math.round(t * SR); for (let k = 0; k < SR * 0.22; k++) { const tt = k / SR; add(i0 + k, g * 0.35 * ((rnd() * 2 - 1) * 0.8 + 0.4 * Math.sin(2 * Math.PI * 190 * tt)) * Math.exp(-tt * 18), 0.1); } }
function hat(t, g = 1) { const i0 = Math.round(t * SR); let p = 0; for (let k = 0; k < SR * 0.05; k++) { const tt = k / SR; const w = rnd() * 2 - 1; const hp = w - p; p = w; add(i0 + k, g * 0.12 * hp * Math.exp(-tt * 70), -0.2); } }
function bass(t, f, len, g = 1) { const i0 = Math.round(t * SR); for (let k = 0; k < SR * len; k++) { const tt = k / SR; const env = Math.min(1, tt * 60) * Math.exp(-tt * 1.5); const ph = 2 * Math.PI * f * tt; add(i0 + k, g * 0.32 * env * (Math.sin(ph) + 0.3 * Math.sin(2 * ph))); } }
function pad(t, fs, len, g = 1) { const i0 = Math.round(t * SR); for (let k = 0; k < SR * len; k++) { const tt = k / SR; const env = Math.min(1, tt / 0.4) * Math.min(1, (len - tt) / 0.4); let s = 0; for (const f of fs) s += Math.sin(2 * Math.PI * f * tt) + 0.2 * Math.sin(2 * Math.PI * f * 2.003 * tt); add(i0 + k, g * 0.05 * env * s, 0.3); } }
// a "sung" syllable: band-limited saw with vibrato and formant-ish emphasis (mid band)
function voice(t, f, len, g = 1) {
  const i0 = Math.round(t * SR); let ph = 0;
  for (let k = 0; k < SR * len; k++) {
    const tt = k / SR, vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * tt);
    ph += 2 * Math.PI * f * vib / SR;
    const env = Math.min(1, tt / 0.015) * Math.min(1, (len - tt) / 0.05);
    let s = 0; for (let h = 1; h <= 8; h++) s += Math.sin(h * ph) / h * (h === 3 || h === 4 ? 1.8 : 1);
    add(i0 + k, g * 0.10 * env * s);
  }
}

const chords = [[220, 277.2, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];
const roots = [55, 43.65, 49, 41.2];
const truth = { bpm: BPM, downbeats: [], sections: [], drop: 0, words: [] };
let bar = 0;
for (const sec of sections) {
  const t0 = bar * BAR; truth.sections.push({ label: sec.label, start: t0 });
  if (sec.label === 'chorus' && bar > 20) truth.drop = t0;
  for (let b = 0; b < sec.bars; b++, bar++) {
    const tb = bar * BAR; truth.downbeats.push(+tb.toFixed(4));
    const ch = chords[bar % 4], rt = roots[bar % 4];
    const big = sec.label === 'chorus', loud = big ? 1.25 : 1;
    if (sec.label !== 'breakdown' && sec.label !== 'intro') {
      for (let q = 0; q < 4; q++) { if (q % 2 === 0 || big) kick(tb + q * BEAT, loud); if (q % 2 === 1) snare(tb + q * BEAT, loud); }
      for (let e = 0; e < 8; e++) hat(tb + e * BEAT / 2, big ? 1.3 : 0.9);
      for (let e = 0; e < (big ? 8 : 4); e++) bass(tb + e * (big ? BEAT / 2 : BEAT), rt * (e % 4 === 3 ? 1.5 : 1), big ? BEAT / 2 : BEAT, big ? 1.3 : 1);
    } else if (sec.label === 'breakdown') {
      for (let e = 0; e < 8 * (b + 1) / sec.bars * 2; e++) hat(tb + e * BEAT / 4, 0.4 + 0.2 * b);
    } else { for (let e = 0; e < 8; e++) hat(tb + e * BEAT / 2, 0.35); }
    pad(tb, ch, BAR, sec.label === 'breakdown' ? 1.6 : 1);
  }
}

// original test lyrics (written for this fixture), sung on eighth notes from bar 4
const lyricLines = [
  // verse (bars 4–11)
  'we were waiting in the quiet light', 'counting every ember in the night',
  'the river told us we could wait', 'but morning broke the garden gate',
  // chorus (bars 12–19)
  'set the fire burn it bright', 'let the thunder shake the sky',
  'hold the storm and hold the rain', 'we will rise and turn again',
  // breakdown (bars 20–23)
  'every whisper turns to smoke',
  // drop chorus (bars 24–31)
  'set the fire burn it bright', 'let the thunder shake the sky',
  'hold the storm and hold the rain', 'we will rise and turn again'
];
const lineStartBars = [4, 6, 8, 10, 12, 14, 16, 18, 20.5, 24, 26, 28, 30];
const pitches = [262, 294, 330, 349, 392, 440, 392, 330];
const lrc = ['[ti:Demo Song]', '[ar:Lyric Engine fixture]'];
const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
lyricLines.forEach((line, li) => {
  const words = line.split(' ');
  let t = lineStartBars[li] * BAR;
  let out = `[${fmt(t)}]`;
  words.forEach((w, wi) => {
    const len = (wi === words.length - 1 ? 2 : 1) * BEAT / 2;
    out += ` <${fmt(t)}>${w}`;
    truth.words.push({ text: w, start: +t.toFixed(4) });
    voice(t, pitches[(li + wi) % pitches.length] * (lineStartBars[li] >= 12 && lineStartBars[li] < 20 || lineStartBars[li] >= 24 ? 1.0 : 0.9), len * 0.92, 1.0);
    t += len;
  });
  lrc.push(out);
});

// master: soft clip, write 16-bit stereo wav
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.tanh(L[i] * g) * 32000), 44 + i * 4); buf.writeInt16LE(Math.round(Math.tanh(R[i] * g) * 32000), 46 + i * 4); }
mkdirSync('public/demo', { recursive: true });
writeFileSync('public/demo/demo-song.wav', buf);
writeFileSync('public/demo/demo-song.lrc', lrc.join('\n') + '\n');
writeFileSync('public/demo/demo-song.json', JSON.stringify(truth, null, 1));
console.log('fixtures written:', DUR.toFixed(1), 's,', truth.words.length, 'words');
