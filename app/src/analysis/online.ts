// Online (causal) analysis for live mode (SPEC §14.2). Feed it audio in any chunk size; it keeps a running picture:
// onsets (STFT 1024/256 at 22.05 kHz, flux with a 2-frame look-ahead, adaptive threshold over 1.5 s), tempo
// (autocorrelation over the last 8 s every 0.5 s, the offline prior, 2 s hysteresis), beat phase (a PLL on onsets,
// gain 0.15, predicting the next beat), downbeats (bass onset strength per beat-in-bar, re-evaluated every 4 bars),
// 60 fps features and a drop detector. Pure TypeScript: runs in a worker, a worklet's worker, or Node for tests.
import { FFT, hann, clamp } from './dsp.ts';
import type { OnlineState } from '../live/types.ts';

const SR = 22050, N = 1024, HOP = 256, NB = N / 2 + 1;
const FR = SR / HOP; // ≈ 86.13 frames/s
const ENV_LEN = Math.ceil(FR * 8);
const THR_LEN = Math.ceil(FR * 1.5);
const LAG_MIN = Math.floor((FR * 60) / 220), LAG_MAX = Math.ceil((FR * 60) / 40);
/** onset time = frame start + this many samples (centre-of-mass of the attack inside a Hann window) */
const LEAD = N * 0.6;
const PLL_GAIN = 0.15;
/** the offline band edges (sub, bass, lowMid, mid, highMid, high, air) as bins of the 1024-point frame */
const BAND_BIN = [20, 60, 250, 500, 2000, 4000, 8000].map((f) => Math.max(1, Math.round(f / (SR / N))));

function prior(bpm: number): number { const o = Math.log2(bpm / 120); return Math.exp(-0.5 * (o / 0.9) ** 2); }

class Ring {
  readonly a: Float32Array; n = 0;
  constructor(readonly size: number) { this.a = new Float32Array(size); }
  push(v: number): void { this.a[this.n % this.size] = v; this.n++; }
  /** k-th most recent (0 = newest) */
  back(k: number): number { return k < this.n && k < this.size ? this.a[(this.n - 1 - k) % this.size] : 0; }
  get length(): number { return Math.min(this.n, this.size); }
  /** oldest → newest copy */
  ordered(len = this.length): Float32Array { const o = new Float32Array(len); for (let i = 0; i < len; i++) o[i] = this.back(len - 1 - i); return o; }
}

export interface OnlineEvents { onsets: number[]; beats: number[]; downbeats: number[]; tempo: { t: number; bpm: number }[]; drops: number[] }

export class OnlineAnalyser {
  /** everything detected so far (bounded by `keepEvents`), for tests and the presenter view */
  readonly events: OnlineEvents = { onsets: [], beats: [], downbeats: [], tempo: [], drops: [] };
  private fft = new FFT(N);
  private win = hann(N);
  private re = new Float64Array(N); private im = new Float64Array(N);
  private prevMag = new Float32Array(NB);
  private buf = new Float32Array(N * 4); private bufN = 0;
  private framesDone = 0;
  // resampler state (linear interpolation after a one-pole anti-alias at ~10 kHz; adequate for onsets/bands)
  private step: number; private pos = 0; private last = 0; private lp = 0; private lpK: number;
  // features
  private flux = new Ring(THR_LEN + 4); private bassFlux = new Ring(8);
  private env = new Ring(ENV_LEN);
  private bassEnv = new Ring(ENV_LEN);
  private loud = new Ring(Math.ceil(FR * 64)); // 16 bars at 60 BPM
  private h60 = { low: new Ring(240), mid: new Ring(240), high: new Ring(240), loudness: new Ring(240) };
  private next60 = 0;
  private peak = { low: 1e-6, mid: 1e-6, high: 1e-6, loud: 1e-6 };
  private e7 = new Float64Array(7); private peak7 = new Float64Array(7); private band7 = new Float32Array(7);
  private cur = { low: 0, mid: 0, high: 0, loud: 0, centroid: 0, vocal: 0, flat: 1 };
  private lastOnset = -Infinity;
  // tempo
  private period = 0; private bpm = 0; private conf = 0;
  private cand = { bpm: 0, since: 0 };
  private nextTempoAt = 2;
  // PLL
  private tNext = 0; private tLast = -Infinity; private phaseChecked = 0;
  private beatCount = 0;
  private barAcc = [0, 0, 0, 0]; private barN = [0, 0, 0, 0]; private dbOffset = 0; private meter = 4;
  private beatsSinceDb = 0;
  private dropAt = -Infinity; private novelty = 0;
  constructor(inputRate: number, private keepEvents = 4096) {
    this.step = inputRate / SR;
    this.lpK = Math.exp((-2 * Math.PI * Math.min(10000, inputRate * 0.45)) / inputRate);
  }

  /** audio clock in seconds (frames analysed so far) */
  get time(): number { return (this.framesDone * HOP + LEAD) / SR; }

  /** Feed mono samples at the input rate. */
  push(x: Float32Array): void {
    for (let i = 0; i < x.length; i++) {
      const v = (this.lp = x[i] + (this.lp - x[i]) * this.lpK);
      // emit output samples that fall between the previous input sample and this one
      while (this.pos <= 1) {
        this.append(this.last + (v - this.last) * this.pos);
        this.pos += this.step;
      }
      this.pos -= 1; this.last = v;
    }
  }

  private append(s: number): void {
    this.buf[this.bufN++] = s;
    if (this.bufN === N) {
      this.frame();
      this.buf.copyWithin(0, HOP, N); this.bufN = N - HOP;
    }
  }

  private frame(): void {
    const { re, im, win } = this;
    for (let i = 0; i < N; i++) { re[i] = this.buf[i] * win[i]; im[i] = 0; }
    this.fft.forward(re, im);
    const binHz = SR / N;
    const bLow = Math.round(150 / binHz), bVoc0 = Math.round(200 / binHz), bVoc1 = Math.round(4000 / binHz);
    let fl = 0, bfl = 0, cNum = 0, cDen = 0, logS = 0, linS = 0, nF = 0;
    const e7 = this.e7; e7.fill(0);
    let band = 0;
    for (let k = 1; k < NB; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const m = Math.log(1 + 100 * Math.sqrt(p));
      const d = m - this.prevMag[k];
      if (d > 0) { fl += d; if (k <= bLow) bfl += d; }
      this.prevMag[k] = m;
      while (band < 6 && k >= BAND_BIN[band + 1]) band++;
      e7[band] += p;
      cNum += k * p; cDen += p;
      if (k >= bVoc0 && k <= bVoc1 && (k & 1) === 0) { logS += Math.log(p + 1e-12); linS += p + 1e-12; nF++; }
    }
    const j = this.framesDone++;
    const t = (j * HOP + LEAD) / SR;
    this.flux.push(fl); this.bassFlux.push(bfl);
    // features (dB-ish, normalised by slowly decaying peaks)
    const dbs = (e: number) => Math.max(0, 10 * Math.log10(e + 1e-10) + 100);
    const eL = e7[0] + e7[1], eM = e7[2] + e7[3], eH = e7[4] + e7[5] + e7[6];
    const L = dbs(eL), M = dbs(eM), Hh = dbs(eH), Lo = dbs(eL + eM + eH);
    for (let b = 0; b < 7; b++) { const v = dbs(e7[b]); this.peak7[b] = Math.max(v, this.peak7[b] * 0.99995); this.band7[b] = clamp((v - (this.peak7[b] - 40)) / 40, 0, 1); }
    const decay = (k: 'low' | 'mid' | 'high' | 'loud', v: number) => { this.peak[k] = Math.max(v, this.peak[k] * 0.99995); return clamp((v - (this.peak[k] - 45)) / 45, 0, 1); };
    this.cur.low = decay('low', L); this.cur.mid = decay('mid', M); this.cur.high = decay('high', Hh); this.cur.loud = decay('loud', Lo);
    this.cur.centroid = cDen > 0 ? clamp((cNum / cDen) * binHz / 5000, 0, 1) : 0;
    this.cur.flat = nF ? Math.exp(logS / nF) / (linS / nF) : 1;
    // vocal activity without pitch: mid-band share, tonality and level (logistic)
    const midShare = eM / Math.max(1e-12, eL + eM + eH);
    const z = -4 + 3.2 * this.cur.mid + 2.5 * midShare + 2.2 * (1 - clamp(Math.sqrt(this.cur.flat) * 2, 0, 1));
    this.cur.vocal += (1 / (1 + Math.exp(-z)) - this.cur.vocal) * 0.08;
    this.loud.push(Lo);
    while (this.next60 <= t) {
      this.h60.low.push(this.cur.low); this.h60.mid.push(this.cur.mid); this.h60.high.push(this.cur.high); this.h60.loudness.push(this.cur.loud);
      this.next60 += 1 / 60;
    }
    // ---- onset decision for frame j−2 (2-frame look-ahead)
    if (this.flux.length >= 5) {
      const c = this.flux.back(2);
      const isPeak = c > this.flux.back(3) && c >= this.flux.back(1) && c >= this.flux.back(0) && c >= this.flux.back(4);
      // adaptive threshold: median + spread over the last 1.5 s
      const len = Math.min(this.flux.length, THR_LEN);
      const w = new Float32Array(len); for (let i = 0; i < len; i++) w[i] = this.flux.back(i);
      w.sort();
      const med = w[len >> 1], p90 = w[Math.floor(len * 0.9)];
      const thr = med + 0.35 * (p90 - med) + 1e-3;
      const env = Math.max(0, c - med);
      this.env.push(env);
      this.bassEnv.push(Math.max(0, this.bassFlux.back(2)));
      const to = t - 2 * HOP / SR;
      if (isPeak && c > thr && to - this.lastOnset > 0.06) {
        this.lastOnset = to;
        this.pushEvent(this.events.onsets, to);
        this.onOnset(to, (c - med) / Math.max(1e-6, p90 - med));
      }
    }
    // ---- tempo every 0.5 s
    if (t >= this.nextTempoAt) { this.nextTempoAt = t + 0.5; this.updateTempo(t); }
    // ---- beat clock
    if (this.period > 0) this.advanceBeats(t);
    // ---- sections / drop: last bar vs the 4 bars before (16-bar novelty)
    if (this.period > 0 && j % 16 === 0) this.updateSections(t);
  }

  private pushEvent(arr: number[], v: number): void { arr.push(v); if (arr.length > this.keepEvents) arr.splice(0, arr.length - this.keepEvents); }

  private updateTempo(t: number): void {
    const n = this.env.length;
    if (n < FR * 3) return;
    const e = this.env.ordered(n);
    let mean = 0; for (let i = 0; i < n; i++) mean += e[i]; mean /= n;
    for (let i = 0; i < n; i++) e[i] -= mean;
    const ac = new Float64Array(Math.min(n - 1, LAG_MAX * 2 + 2) + 1);
    for (let lag = 0; lag < ac.length; lag++) { let s = 0; for (let i = lag; i < n; i++) s += e[i] * e[i - lag]; ac[lag] = s / (n - lag); }
    const ac0 = ac[0] > 1e-12 ? ac[0] : 1;
    let best = -Infinity, bl = -1;
    for (let lag = LAG_MIN; lag <= Math.min(LAG_MAX, (ac.length - 1) >> 1); lag++) {
      const s = ((ac[lag] + 0.5 * ac[2 * lag]) / ac0) * prior((60 * FR) / lag);
      if (s > best) { best = s; bl = lag; }
    }
    if (bl < 0) return;
    let lagF = bl;
    const a = ac[bl - 1], b = ac[bl], c = ac[bl + 1], den = a - 2 * b + c;
    if (Math.abs(den) > 1e-12) lagF = bl + clamp((0.5 * (a - c)) / den, -0.5, 0.5);
    const bpm = (60 * FR) / lagF;
    this.conf = clamp((ac[bl] / ac0) * 2, 0, 1);
    if (!this.bpm) { this.setTempo(bpm, t, true); return; }
    // hysteresis: a different tempo (> 4 %) must win for 2 s; small drifts are followed at once
    if (Math.abs(bpm / this.bpm - 1) < 0.04) { this.setTempo(this.bpm + (bpm - this.bpm) * 0.3, t, false); this.cand.bpm = 0; return; }
    if (!this.cand.bpm || Math.abs(bpm / this.cand.bpm - 1) > 0.04) { this.cand = { bpm, since: t }; return; }
    if (t - this.cand.since >= 2) { this.setTempo(bpm, t, true); this.cand.bpm = 0; }
  }

  private setTempo(bpm: number, t: number, rephase: boolean): void {
    this.bpm = bpm; this.period = 60 / bpm;
    this.pushEvent(this.events.tempo as never[], { t, bpm } as never);
    if (rephase) { this.rephase(t, true); this.phaseChecked = t; }
  }

  /** Comb over the onset envelope: which phase of the current period fits the last 8 s best? */
  private phaseScore(phase: number, n: number, e: Float32Array, t: number): number {
    const P = this.period * FR; let s = 0;
    // env index i (oldest→newest) is the frame decided at time tEnd − (n−1−i)/FR
    const tEnd = t - 2 * HOP / SR;
    for (let b = phase; ; b -= this.period) {
      const i = Math.round(n - 1 - (tEnd - b) * FR);
      if (i < 1) break;
      if (i < n - 1) s += Math.max(e[i - 1], e[i], e[i + 1]);
    }
    void P;
    return s;
  }
  private rephase(t: number, force: boolean): void {
    const n = this.env.length; if (n < FR * 2) return;
    const e = this.env.ordered(n);
    // candidate phases: offsets of one period ending at the newest decided frame
    const tEnd = t - 2 * HOP / SR;
    let best = -1, bestPh = 0;
    const steps = 48;
    for (let k = 0; k < steps; k++) {
      const ph = tEnd - (k / steps) * this.period;
      const s = this.phaseScore(ph, n, e, t);
      if (s > best) { best = s; bestPh = ph; }
    }
    // current hypothesis: the beat grid through tNext
    const cur = this.tNext > 0 ? this.phaseScore(this.tNext - Math.ceil((this.tNext - tEnd) / this.period) * this.period, n, e, t) : 0;
    if (force || best > cur * 1.35) {
      let nb = bestPh; while (nb <= t) nb += this.period;
      this.tNext = nb;
    }
  }

  private onOnset(to: number, strength: number): void {
    if (this.period <= 0) return;
    // nearest predicted beat (the one just passed or the next one)
    const prev = this.tNext - this.period;
    const target = Math.abs(to - prev) < Math.abs(to - this.tNext) ? prev : this.tNext;
    const err = to - target;
    if (Math.abs(err) > 0.2 * this.period) return; // off-beat or syncopation: ignore
    const w = clamp(strength, 0.2, 1.5);
    this.tNext += PLL_GAIN * w * err;
    // gentle period correction from persistent phase error
    this.period += 0.01 * w * err; this.period = clamp(this.period, 60 / 220, 60 / 40);
  }

  private advanceBeats(t: number): void {
    if (t - this.phaseChecked > 2) { this.phaseChecked = t; this.rephase(t, false); }
    while (this.tNext <= t) {
      const b = this.tNext;
      this.tLast = b;
      this.pushEvent(this.events.beats, b);
      // bass onset strength at this beat → bar position statistics
      const k = Math.round((t - b) * FR) + 2;
      const bass = Math.max(this.bassEnv.back(k - 1), this.bassEnv.back(k), this.bassEnv.back(k + 1));
      const slot = this.beatCount % 4;
      this.barAcc[slot] = this.barAcc[slot] * 0.9 + bass; this.barN[slot]++;
      this.beatCount++; this.beatsSinceDb++;
      if (this.beatsSinceDb >= 16) { // re-evaluate every 4 bars
        this.beatsSinceDb = 0;
        let bi = 0; for (let i = 1; i < 4; i++) if (this.barAcc[i] > this.barAcc[bi]) bi = i;
        this.dbOffset = bi;
      }
      if ((this.beatCount - 1 - this.dbOffset) % this.meter === 0) this.pushEvent(this.events.downbeats, b);
      this.tNext += this.period;
    }
  }

  private updateSections(t: number): void {
    const bar = this.period * 4;
    const per = Math.round(bar * FR);
    if (this.loud.length < per * 5) return;
    let last = 0, before = 0;
    for (let i = 0; i < per; i++) last += this.loud.back(i);
    for (let i = per; i < per * 5; i++) before += this.loud.back(i);
    last /= per; before /= per * 4;
    let lo = Infinity; for (let b = 1; b < 5; b++) { let s = 0; for (let i = b * per; i < (b + 1) * per; i++) s += this.loud.back(i); lo = Math.min(lo, s / per); }
    this.novelty = clamp((last - before) / 12, 0, 1);
    if (last - before > 5 && last - lo > 7 && t - this.dropAt > bar * 4) { this.dropAt = t; this.pushEvent(this.events.drops, t); }
  }

  private sentUpTo = { onsets: -Infinity, beats: -Infinity, downbeats: -Infinity, drops: -Infinity };
  /** Events detected since the previous drain (each list is time-ordered). */
  drain(): { onsets: number[]; beats: number[]; downbeats: number[]; drops: number[] } {
    const out = { onsets: [] as number[], beats: [] as number[], downbeats: [] as number[], drops: [] as number[] };
    for (const k of ['onsets', 'beats', 'downbeats', 'drops'] as const) {
      const arr = this.events[k], last = this.sentUpTo[k];
      let i = arr.length; while (i > 0 && arr[i - 1] > last) i--;
      out[k] = arr.slice(i);
      if (out[k].length) this.sentUpTo[k] = out[k][out[k].length - 1];
    }
    return out;
  }

  state(): OnlineState {
    const t = this.time;
    const P = this.period || 0.5;
    const last = this.tNext > 0 ? this.tNext - P : t;
    return {
      t, bands: Array.from(this.band7), low: this.cur.low, mid: this.cur.mid, high: this.cur.high, loudness: this.cur.loud, centroid: this.cur.centroid, vocal: this.cur.vocal,
      onset: Math.exp(-(t - this.lastOnset) * 9),
      bpm: this.bpm, tempoConfidence: this.conf,
      nextBeat: this.tNext, lastBeat: last, beatPhase: clamp((t - last) / P, 0, 1),
      beatInBar: ((this.beatCount - 1 - this.dbOffset) % this.meter + this.meter) % this.meter, meter: this.meter,
      dropAt: this.dropAt, novelty: this.novelty,
      history: { low: this.h60.low.ordered(), mid: this.h60.mid.ordered(), high: this.h60.high.ordered(), loudness: this.h60.loudness.ordered() },
    };
  }
}
