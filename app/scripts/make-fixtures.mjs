// Synthesises the demo songs (SPEC §16): original lyrics, no copyrighted audio. Deterministic.
//   public/demo/demo-song.{wav,lrc,json}            73 s, 120 BPM, 4/4, A–F–G–E
//   public/demo/demo-waltz.{wav,lrc,json}           66 s, 96 BPM, 3/4, D minor → F major, duet
//   public/demo/demo-waltz.translation.txt
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo');
mkdirSync(OUT, { recursive: true });
const SR = 44100;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

class Mix {
  constructor(seconds) { this.n = Math.ceil(seconds * SR); this.L = new Float32Array(this.n); this.R = new Float32Array(this.n); }
  add(t, len, pan, fn) {
    const i0 = Math.round(t * SR), m = Math.round(len * SR);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < m; i++) {
      const j = i0 + i;
      if (j < 0 || j >= this.n) continue;
      const v = fn(i / SR, i);
      this.L[j] += v * gl * Math.SQRT2; this.R[j] += v * gr * Math.SQRT2;
    }
  }
  wav(path) {
    let peak = 0;
    for (let i = 0; i < this.n; i++) peak = Math.max(peak, Math.abs(this.L[i]), Math.abs(this.R[i]));
    const g = 0.89 / (peak || 1);
    const buf = Buffer.alloc(44 + this.n * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + this.n * 4, 4); buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(this.n * 4, 40);
    for (let i = 0; i < this.n; i++) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.L[i] * g)) * 32767), 44 + i * 4);
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, this.R[i] * g)) * 32767), 46 + i * 4);
    }
    writeFileSync(path, buf);
  }
}

// ---------- instruments ----------
function kick(mix, t, g = 1) {
  let ph = 0;
  mix.add(t, 0.3, 0, (x) => {
    const f = 46 + 110 * Math.exp(-x * 28);
    ph += (2 * Math.PI * f) / SR;
    return g * (Math.sin(ph) * Math.exp(-x * 9) + 0.25 * Math.exp(-x * 400));
  });
}
function snare(mix, t, r, g = 1) {
  let lp = 0;
  mix.add(t, 0.22, 0.05, (x) => {
    const nz = r() * 2 - 1;
    lp += 0.5 * (nz - lp);
    return g * 0.55 * ((nz - 0.6 * lp) * Math.exp(-x * 22) + 0.5 * Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x * 30));
  });
}
function hat(mix, t, r, g = 1, pan = 0.25) {
  let prev = 0;
  mix.add(t, 0.06, pan, (x) => {
    const nz = r() * 2 - 1;
    const hp = nz - prev; prev = nz;
    return g * 0.22 * hp * Math.exp(-x * 90);
  });
}
function bass(mix, t, len, midi, g = 1) {
  const f = midiHz(midi);
  mix.add(t, len, 0, (x) => {
    const env = Math.min(1, x / 0.008) * Math.min(1, (len - x) / 0.03);
    return g * 0.42 * env * (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(4 * Math.PI * f * x) + 0.15 * Math.sin(6 * Math.PI * f * x));
  });
}
function pad(mix, t, len, midis, g = 1, attack = 0.25) {
  for (const [k, m] of midis.entries()) {
    for (const [pan, det] of [[-0.7, 0.997], [0.7, 1.003]]) {
      const f = midiHz(m) * det;
      mix.add(t, len, pan, (x) => {
        const env = Math.min(1, x / attack) * Math.min(1, (len - x) / 0.2);
        return g * 0.07 * env * (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(4 * Math.PI * f * x + k) + 0.2 * Math.sin(6 * Math.PI * f * x));
      });
    }
  }
}
function stab(mix, t, len, midis, g = 1, pan = 0) {
  for (const m of midis) {
    const f = midiHz(m);
    mix.add(t, len, pan, (x) => {
      const env = Math.min(1, x / 0.004) * Math.exp(-x * 7);
      return g * 0.1 * env * (Math.sin(2 * Math.PI * f * x) + 0.5 * Math.sin(4 * Math.PI * f * x) + 0.25 * Math.sin(6 * Math.PI * f * x));
    });
  }
}
/** formant-shaped voice; `pitchAt(x)` → midi, so melisma and vibrato are exact */
function voice(mix, t, len, pitchAt, formants, r, g = 1, pan = 0) {
  let ph = 0;
  const amp = (f) => {
    let a = 0;
    for (const [F, bw, gn] of formants) a += gn / Math.sqrt(1 + ((f - F) / bw) ** 2);
    return a;
  };
  let prev = 0;
  mix.add(t, len, pan, (x) => {
    const f0 = midiHz(pitchAt(x));
    ph += (2 * Math.PI * f0) / SR;
    let s = 0;
    for (let h = 1; h * f0 < 5000; h++) s += (amp(h * f0) / h ** 0.6) * Math.sin(h * ph);
    const env = Math.min(1, x / 0.018) * Math.min(1, (len - x) / 0.04);
    // a short breath-noise consonant at the start of each syllable
    const nz = r() * 2 - 1; const hp = nz - prev; prev = nz;
    const cons = 0.25 * hp * Math.exp(-x * 120);
    return g * 0.2 * (env * s + cons);
  });
}
const VOICE_A = [[700, 110, 1], [1150, 130, 0.7], [2600, 200, 0.25]];
const VOICE_B = [[320, 90, 1], [2250, 180, 0.6], [3000, 220, 0.3]];
const VOICE_LEAD = [[560, 120, 1], [1500, 160, 0.6], [2500, 220, 0.25]];

const stamp = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

// =====================================================================================
// Demo song: 73 s, 120 BPM
// =====================================================================================
function demoSong() {
  const DUR = 73, BEAT = 0.5, BAR = 2;
  const mix = new Mix(DUR);
  const r = rng(1776);
  const sections = [
    { start: 0, label: 'intro' }, { start: 8, label: 'verse' }, { start: 24, label: 'chorus' },
    { start: 40, label: 'breakdown' }, { start: 48, label: 'chorus' }, { start: 64, label: 'outro' },
  ];
  const labelAt = (t) => { let l = 'intro'; for (const s of sections) if (t >= s.start - 1e-6) l = s.label; return l; };
  // A – F – G – E, one major triad per bar
  const roots = [9, 5, 7, 4];
  const chords = [];
  const events = [];
  for (let bar = 0; bar * BAR < DUR; bar++) {
    const t = bar * BAR, lab = labelAt(t), root = roots[bar % 4];
    const end = Math.min(DUR, t + BAR);
    if (t < 72) chords.push({ start: t, end: Math.min(72, end), root, quality: 'maj' });
    const triad = [48 + root, 52 + root, 55 + root].map((m) => (m > 59 ? m - 12 : m) + 12);
    const padG = lab === 'chorus' ? 1.25 : lab === 'intro' || lab === 'breakdown' ? 1.1 : lab === 'outro' ? 0.9 * Math.max(0, 1 - (t - 64) / 9) : 0.8;
    if (t < 72) pad(mix, t, Math.min(BAR, 72 - t) + 0.15, triad, padG, lab === 'intro' && bar === 0 ? 1.2 : 0.12);
    const bassM = 36 + root; // A2 110, F2 87, G2 98, E2 82
    for (let b = 0; b < 4; b++) {
      const tb = t + b * BEAT;
      if (tb >= DUR - 0.3) break;
      if (lab === 'verse' || lab === 'chorus') {
        if (lab === 'chorus' || b % 2 === 0) { kick(mix, tb, lab === 'chorus' ? 1 : 0.85); events.push(tb); }
        if (b % 2 === 1) { snare(mix, tb, r, lab === 'chorus' ? 1 : 0.8); events.push(tb); }
        for (let e = 0; e < 2; e++) hat(mix, tb + e * 0.25, r, lab === 'chorus' ? 1 : 0.7);
        if (lab === 'chorus') { bass(mix, tb, 0.22, bassM, 1); bass(mix, tb + 0.25, 0.22, bassM, 0.85); }
        else if (b % 2 === 0) bass(mix, tb, 0.9, bassM, 0.8);
        if (lab === 'chorus' && b % 2 === 0) stab(mix, tb, 0.4, triad.map((m) => m + 12), 0.9, b ? 0.5 : -0.5);
      } else if (lab === 'breakdown') {
        // sixteenth-note hi-hat riser → the drop at 48 is preceded by a build
        for (let e = 0; e < 4; e++) { const th = tb + e * 0.125; hat(mix, th, r, 0.25 + 1.6 * ((th - 40) / 8) ** 1.5, 0.1); }
      }
    }
    if (lab === 'outro' && bar === 32) { kick(mix, t, 1); events.push(t); }
  }
  // lyrics: [line start, [word, offset in eighths, length in eighths, midi]...]
  const E = 0.25;
  const L = (t, v, ...w) => ({ t, voice: v, words: w });
  const lines = [
    L(8, '', ["I've", 0, 1, 64], ['been', 1, 1, 64], ['waiting', 2, 3, 69], ['for', 5, 1, 66], ['the', 6, 1, 64], ['light', 8, 4, 73]),
    L(12, '', ['An', 0, 1, 65], ['ember', 1, 3, 69], ['in', 4, 1, 65], ['the', 5, 1, 65], ['quiet', 6, 2, 67], ['night', 8, 4, 72]),
    L(16, '', ['The', 0, 1, 62], ['river', 1, 2, 67], ['runs', 3, 2, 71], ['to', 5, 1, 67], ['meet', 6, 2, 67], ['the', 8, 1, 62], ['morning', 9, 4, 71]),
    L(20, '', ['And', 0, 1, 64], ['every', 1, 2, 68], ['wall', 3, 2, 71], ['we', 5, 1, 68], ['built', 6, 2, 68], ['just', 8, 1, 64], ['broke', 10, 4, 71]),
    L(24, '', ['Open', 0, 2, 73], ['the', 2, 1, 69], ['garden', 4, 3, 73], ['gate', 8, 5, 76]),
    L(28, '', ['Set', 0, 2, 72], ['the', 2, 1, 69], ['sky', 4, 2, 72], ['on', 6, 1, 69], ['fire', 8, 5, 77]),
    L(32, '', ['Burn', 0, 2, 71], ['bright,', 2, 3, 74], ['burn', 6, 2, 71], ['bright', 8, 5, 79]),
    L(36, '', ['Let', 0, 1, 68], ['the', 1, 1, 68], ['thunder', 2, 3, 71], ['shake', 6, 2, 76], ['the', 8, 1, 71], ['sky', 10, 5, 76]),
    L(41, '', ['Whisper', 0, 3, 64], ['to', 4, 1, 61], ['the', 5, 1, 61], ['smoke', 6, 5, 64]),
    L(44.5, '', ['Hold', 0, 2, 65], ['still,', 2, 3, 69], ['hold', 6, 2, 65], ['still', 8, 5, 72]),
    L(48, '', ['Here', 0, 2, 73], ['comes', 2, 2, 73], ['the', 4, 1, 69], ['storm,', 5, 3, 76], ['the', 9, 1, 73], ['rain', 10, 5, 76]),
    L(52, '', ['We', 0, 1, 69], ['rise', 2, 3, 72], ['and', 5, 1, 69], ['turn', 6, 2, 72], ['again', 9, 5, 77]),
    L(56, '', ['Burn', 0, 2, 71], ['bright,', 2, 3, 74], ['burn', 6, 2, 71], ['bright', 8, 5, 79]),
    L(60, '', ['Let', 0, 1, 68], ['the', 1, 1, 68], ['thunder', 2, 3, 71], ['shake', 6, 2, 76], ['the', 8, 1, 71], ['sky', 10, 5, 76]),
    L(65, '', ["I'm", 0, 1, 64], ['still', 1, 2, 69], ['waiting', 3, 3, 69], ['for', 6, 1, 66], ['the', 7, 1, 64], ['morning', 8, 3, 69], ['light', 12, 8, 73]),
  ];
  const words = [];
  let lrc = '[ti:Open the Garden Gate]\n[ar:Lyric Engine Demo]\n[length:01:13]\n';
  for (const ln of lines) {
    let row = `[${stamp(ln.t)}]`;
    for (const [text, off, len, midi] of ln.words) {
      const start = ln.t + off * E, d = len * E - 0.04;
      voice(mix, start, d, () => midi - 12, VOICE_LEAD, r, 1.1);
      words.push({ text, start, end: start + d, midi: midi - 12 });
      events.push(start);
      row += `<${stamp(start)}>${text} `;
    }
    const last = ln.words[ln.words.length - 1];
    row += `<${stamp(ln.t + (last[1] + last[2]) * E - 0.04)}>`;
    lrc += row.trim() + '\n';
  }
  mix.wav(join(OUT, 'demo-song.wav'));
  writeFileSync(join(OUT, 'demo-song.lrc'), lrc);
  const downbeats = [];
  for (let t = 0; t < DUR; t += BAR) downbeats.push(t);
  const beats = [];
  for (let t = 0; t < DUR; t += BEAT) beats.push(t);
  writeFileSync(join(OUT, 'demo-song.json'), JSON.stringify({
    title: 'Open the Garden Gate', artist: 'Lyric Engine Demo', duration: DUR, bpm: 120, meter: 4,
    beats, downbeats, sections, drops: [48], tonic: 9, chords,
    onsets: [...new Set(events.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b),
    words,
  }, null, 1));
  return words.length;
}

// =====================================================================================
// Waltz: 66 s, 96 BPM, 3/4, D minor → F major (bar 20), two voices + backing
// =====================================================================================
function demoWaltz() {
  const DUR = 66, BEAT = 0.625, BAR = 1.875;
  const mix = new Mix(DUR);
  const r = rng(96);
  const sections = [
    { start: 0, label: 'intro' }, { start: 4 * BAR, label: 'verse' }, { start: 10 * BAR, label: 'verse' },
    { start: 16 * BAR, label: 'chorus' }, { start: 20 * BAR, label: 'bridge' }, { start: 24 * BAR, label: 'chorus' },
    { start: 30 * BAR, label: 'outro' },
  ];
  // D minor: Dm – Gm – A – Dm ; F major: F – B♭ – C – F
  const progMin = [[2, 'min'], [7, 'min'], [9, 'maj'], [2, 'min']];
  const progMaj = [[5, 'maj'], [10, 'maj'], [0, 'maj'], [5, 'maj']];
  const chords = [];
  const KEYBAR = 20;
  const nBars = Math.floor((DUR - 0.5) / BAR);
  for (let bar = 0; bar < nBars; bar++) {
    const t = bar * BAR;
    const [root, q] = (bar >= KEYBAR ? progMaj : progMin)[bar % 4];
    chords.push({ start: t, end: t + BAR, root, quality: q });
    const third = q === 'min' ? 3 : 4;
    const triad = [60 + root, 60 + root + third, 60 + root + 7].map((m) => (m > 67 ? m - 12 : m));
    const loudBar = (bar >= 16 && bar < 20) || (bar >= 24 && bar < 30);
    const g = bar < 4 ? 0.8 : loudBar ? 1.15 : bar >= 30 ? Math.max(0.2, 1 - (bar - 30) / 5) : 0.95;
    // oom-pah-pah: bass on 1, chord stabs on 2 and 3
    bass(mix, t, BEAT * 0.95, 36 + root + (root < 5 ? 12 : 0), 1.1 * g);
    if (loudBar) kick(mix, t, 0.7);
    stab(mix, t + BEAT, 0.5, triad, 1.0 * g, -0.45);
    stab(mix, t + 2 * BEAT, 0.5, triad, 0.9 * g, 0.45);
    if (bar >= 4) { hat(mix, t + BEAT, r, 0.5 * g, 0.3); hat(mix, t + 2 * BEAT, r, 0.45 * g, 0.3); }
    pad(mix, t, BAR + 0.1, triad.map((m) => m - 12), 0.55 * g, 0.2);
  }
  // ---- vocals ----
  // word = [display, startBeat (from line start), lengthBeats, midi | plateaus, syllables?]
  const lines = [];
  const A = 'A', B = 'B', AB = 'A+B';
  const line = (bar, voiceTag, words, opts = {}) => lines.push({ t: bar * BAR, voice: voiceTag, words, ...opts });
  // verse A (voice A, D minor)
  line(4, A, [['Lantern', 0, 1, 62, ['Lan', 'tern']], ['light', 1, 1, 65], ['across', 2, 1, 69], ['the', 3, 0.5, 67], ['water', 3.5, 1.5, 65, ['wa', 'ter'], true]]);
  line(6, A, [['Carry', 0, 1, 62], ['me', 1, 1, 65], ['beyond', 2, 1, 67], ['the', 3, 0.5, 64], ['harbor', 3.5, 1.5, 62]]);
  line(8, A, [['Every', 0, 1, 69], ['yesterday', 1, 2, 67, ['yes', 'ter', 'day'], true], ['is', 3, 0.5, 65], ['fading', 3.5, 1.5, 62]]);
  // verse B (voice B)
  line(10, B, [['Silver', 0, 1, 74], ['rain', 1, 1, 77], ['upon', 2, 1, 76], ['the', 3, 0.5, 74], ['window', 3.5, 1.5, 72]]);
  line(12, B, [['Tell', 0, 1, 74], ['me', 1, 1, 77], ['where', 2, 1, 79], ['the', 3, 0.5, 77], ['night', 3.5, 1, 76], ['goes', 4.5, 1, 74]]);
  line(14, B, [['I', 0, 0.5, 69], ['remember,', 0.5, 2, 74, ['re', 'mem', 'ber'], true], ['I', 3, 0.5, 72], ['remember', 3.5, 2, 74]]);
  // chorus (A+B, backing in parentheses)
  line(16, AB, [['Turn', 0, 1, 69], ['with', 1, 0.5, 67], ['me,', 1.5, 1, 65], ['around', 3, 1, 67], ['and', 4, 0.5, 65], ['around', 4.5, 1.5, 62]],
    { backing: [['(around)', 5.2, 0.8, 74]] });
  line(18, AB, [['Until', 0, 1, 65], ['the', 1, 0.5, 64], ['morning', 1.5, 1.5, 69, ['mor', 'ning'], true], ['comes', 3.5, 2, 62]],
    { backing: [['(ooh)', 3, 0.5, 77]] });
  // bridge (F major)
  line(20, A, [['Open', 0, 1, 65], ['the', 1, 0.5, 67], ['door,', 1.5, 1.5, 69], ['let', 3, 0.5, 70], ['summer', 3.5, 1, 72], ['in', 4.5, 1.2, 69]]);
  // melisma: 1.6 s, three plateaus with 6 Hz vibrato on the last
  line(22, B, [['We', 0, 0.5, 72], ['are', 0.5, 0.5, 74], ['finally', 1, 1.5, 77], ['home', 2.7, 2.56, [[72, 0.5], [76, 0.5], [79, 0.6]], null, false, true]]);
  // chorus 2 (F major)
  line(24, AB, [['Turn', 0, 1, 72], ['with', 1, 0.5, 70], ['me,', 1.5, 1, 69], ['around', 3, 1, 70], ['and', 4, 0.5, 69], ['around', 4.5, 1.5, 65]],
    { backing: [['(around)', 5.2, 0.8, 77]] });
  line(26, AB, [['Until', 0, 1, 69], ['the', 1, 0.5, 67], ['morning', 1.5, 1.5, 72], ['comes', 3.5, 2, 65]], { backing: [['(ooh)', 3, 0.5, 81]] });
  line(28, AB, [['Yesterday', 0, 1.5, 72], ['is', 1.5, 0.5, 70], ['over', 2, 1, 69], ['now', 3.5, 2, 65]], { backing: [['(over', 4.3, 0.6, 77], ['now)', 4.9, 1, 77]] });
  // outro
  line(30.67, A, [['Lantern', 0, 1, 65], ['light', 1, 2.5, 69]]);

  const words = [], vocalSpans = [];
  let melisma = null;
  let lrc = '[ti:Lantern Waltz]\n[ar:Lyric Engine Demo]\n[length:01:06]\n';
  const voiceTag = { A: 'v1:', B: 'v2:', 'A+B': '[A+B]' };
  const sing = (tag, start, len, pitchAt, backing) => {
    const g = backing ? 0.5 : 1;
    if (tag === 'A' || tag === 'A+B') voice(mix, start, len, pitchAt, VOICE_A, r, g * (tag === 'A+B' ? 0.8 : 1), 0);
    if (tag === 'B' || tag === 'A+B') voice(mix, start, len, (x) => pitchAt(x) + (tag === 'A+B' ? 12 : 0), VOICE_B, r, g * (tag === 'A+B' ? 0.7 : 1), 0);
    vocalSpans.push([start, start + len]);
  };
  for (const ln of lines) {
    let row = `[${stamp(ln.t)}]${voiceTag[ln.voice]} `;
    const all = [...ln.words.map((w) => [w, false]), ...(ln.backing ?? []).map((w) => [w, true])].sort((a, b) => a[0][1] - b[0][1]);
    for (const [w, backing] of all) {
      const [text, off, len, pitch, syl, tagged, isMel] = w;
      const start = ln.t + off * BEAT, d = len * BEAT - 0.05;
      const entry = { text, start, end: start + d, voice: backing ? 'backing' : ln.voice, backing };
      if (Array.isArray(pitch)) {
        // melisma with exact plateaus; vibrato (6 Hz, ±45 cents) on the last plateau
        const tot = pitch.reduce((a, p) => a + p[1], 0);
        const plateaus = [];
        let acc = 0;
        for (const [m, share] of pitch) { plateaus.push({ start: start + (acc / tot) * d, end: start + ((acc + share) / tot) * d, midi: m - 12 }); acc += share; }
        const pitchAt = (x) => {
          const tt = start + x;
          let p = plateaus[plateaus.length - 1];
          for (const q of plateaus) if (tt < q.end) { p = q; break; }
          const vib = p === plateaus[plateaus.length - 1] ? 0.45 * Math.sin(2 * Math.PI * 6 * (tt - p.start)) : 0;
          return p.midi + vib;
        };
        sing(ln.voice, start, d, pitchAt, false);
        entry.midi = plateaus[1].midi; entry.plateaus = plateaus; entry.melisma = true; entry.vibratoHz = 6;
        melisma = entry;
        row += `<${stamp(start)}>${text} `;
      } else if (syl) {
        // one re-articulated note per syllable
        const k = syl.length, each = d / k;
        const syls = [];
        let part = '';
        for (let s = 0; s < k; s++) {
          const ss = start + s * each;
          const m = pitch + (s === 1 ? 2 : s === 2 ? -1 : 0) - 12;
          sing(ln.voice, ss, each - 0.03, () => m, backing);
          syls.push({ text: syl[s], start: ss, end: ss + each });
          part += tagged ? `<${stamp(ss)}>${syl[s]}` : '';
        }
        entry.midi = pitch - 12; entry.syllables = syls; entry.tagged = !!tagged;
        const punct = text.replace(/^[\p{L}']+/u, '');
        row += tagged ? `${part}${punct} ` : `<${stamp(start)}>${text} `;
      } else {
        sing(backing ? (ln.voice === 'A+B' ? 'B' : ln.voice) : ln.voice, start, d, () => pitch - 12, backing);
        entry.midi = pitch - 12;
        row += `<${stamp(start)}>${text} `;
      }
      void isMel;
      words.push(entry);
    }
    lrc += row.trim() + '\n';
  }
  mix.wav(join(OUT, 'demo-waltz.wav'));
  writeFileSync(join(OUT, 'demo-waltz.lrc'), lrc);
  writeFileSync(join(OUT, 'demo-waltz.translation.txt'), [
    'Luz de farol sobre el agua', 'Llévame más allá del puerto', 'Cada ayer se desvanece',
    'Lluvia de plata en la ventana', 'Dime adónde va la noche', 'Yo recuerdo, yo recuerdo',
    'Gira conmigo, vuelta y vuelta', 'Hasta que llegue la mañana',
    'Abre la puerta, que entre el verano', 'Por fin estamos en casa',
    'Gira conmigo, vuelta y vuelta', 'Hasta que llegue la mañana', 'El ayer ya terminó',
    'Luz de farol',
  ].join('\n') + '\n');
  // merge vocal spans
  vocalSpans.sort((a, b) => a[0] - b[0]);
  const spans = [];
  for (const s of vocalSpans) {
    const last = spans[spans.length - 1];
    if (last && s[0] <= last[1] + 0.06) last[1] = Math.max(last[1], s[1]); else spans.push([...s]);
  }
  const downbeats = [], beats = [];
  for (let t = 0; t < DUR; t += BAR) downbeats.push(t);
  for (let t = 0; t < DUR; t += BEAT) beats.push(t);
  writeFileSync(join(OUT, 'demo-waltz.json'), JSON.stringify({
    title: 'Lantern Waltz', artist: 'Lyric Engine Demo', duration: DUR, bpm: 96, meter: 3,
    beats, downbeats, sections, tonic: 2, mode: 'minor',
    keyChanges: [{ t: KEYBAR * BAR, tonic: 5, mode: 'major' }], chords,
    vocalSpans: spans, melisma, words,
  }, null, 1));
  return words.length;
}

const n1 = demoSong();
const n2 = demoWaltz();
console.log(`fixtures written to ${OUT}: demo-song (${n1} words), demo-waltz (${n2} words)`);
