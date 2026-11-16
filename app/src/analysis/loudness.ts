// ITU-R BS.1770-4 loudness (SPEC §4A.8). Works at any sample rate (biquads designed per rate).

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function kWeighting(sr: number): [Biquad, Biquad] {
  // stage 1: high shelf (+4 dB above ~1.7 kHz)
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0,
  };
  // stage 2: high-pass (~38 Hz)
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / a01, a2: (1 - K1 / Q1 + K1 * K1) / a01 };
  return [shelf, hp];
}

function filt(x: Float32Array, q: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = q.b0 * x[i] + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** mean-square of K-weighted audio in blocks of `blockS` seconds with the given overlap */
function blockPowers(channels: Float32Array[], sr: number, blockS: number, overlap: number): Float64Array {
  const [s1, s2] = kWeighting(sr);
  const kw = channels.map((c) => filt(filt(c, s1), s2));
  const n = channels[0]?.length ?? 0;
  const block = Math.round(blockS * sr), step = Math.max(1, Math.round(block * (1 - overlap)));
  const nb = n >= block ? Math.floor((n - block) / step) + 1 : 0;
  const out = new Float64Array(nb);
  // prefix sums of squares (channel weights 1.0 for L/R)
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of kw) s += c[i] * c[i];
    pre[i + 1] = pre[i] + s;
  }
  for (let b = 0; b < nb; b++) out[b] = (pre[b * step + block] - pre[b * step]) / block;
  return out;
}

const toLufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));

/** Integrated loudness: 400 ms blocks, 75 % overlap, absolute gate −70 LUFS, relative gate −10 LU. */
export function integratedLufs(channels: Float32Array[], sr: number): number {
  const p = blockPowers(channels, sr, 0.4, 0.75);
  if (!p.length) return -70;
  let s = 0, c = 0;
  for (const v of p) if (toLufs(v) > -70) { s += v; c++; }
  if (!c) return -70;
  const rel = toLufs(s / c) - 10;
  let s2 = 0, c2 = 0;
  for (const v of p) { const l = toLufs(v); if (l > -70 && l > rel) { s2 += v; c2++; } }
  return c2 ? toLufs(s2 / c2) : -70;
}

/** Short-term loudness (3 s window, 1 s hop). */
export function shortTermLufs(channels: Float32Array[], sr: number): Float32Array {
  const p = blockPowers(channels, sr, 3, 2 / 3);
  return Float32Array.from(p, toLufs);
}

/**
 * True-peak limiter at `ceilingDb` dBTP: 4× oversampled peak detection and a 5 ms look-ahead
 * gain envelope. Returns new channel arrays.
 */
export function limitTruePeak(channels: Float32Array[], sr: number, ceilingDb = -1): Float32Array[] {
  const n = channels[0]?.length ?? 0;
  const ceil = 10 ** (ceilingDb / 20);
  const peak = new Float32Array(n);
  // 4× oversampling by a short windowed-sinc interpolator (3 inter-sample points)
  const taps = 8, tbl: Float32Array[] = [];
  for (let ph = 1; ph < 4; ph++) {
    const t = new Float32Array(taps * 2);
    for (let k = -taps + 1; k <= taps; k++) {
      const x = k - ph / 4;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / taps);
      t[k + taps - 1] = (Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
    }
    tbl.push(t);
  }
  for (const c of channels) {
    for (let i = 0; i < n; i++) {
      let m = Math.abs(c[i]);
      if (m > ceil * 0.5) {
        for (const t of tbl) {
          let s = 0;
          for (let k = -taps + 1; k <= taps; k++) { const j = i + k; if (j >= 0 && j < n) s += c[j] * t[k + taps - 1]; }
          if (Math.abs(s) > m) m = Math.abs(s);
        }
      }
      if (m > peak[i]) peak[i] = m;
    }
  }
  // required gain, then look-ahead minimum and smoothing
  const la = Math.max(1, Math.round(0.005 * sr));
  const gain = new Float32Array(n);
  for (let i = 0; i < n; i++) gain[i] = peak[i] > ceil ? ceil / peak[i] : 1;
  const g2 = new Float32Array(n);
  // sliding minimum over [i, i+la]
  const dq: number[] = [];
  let head = 0;
  for (let i = 0, j = 0; i < n; i++) {
    while (j < n && j <= i + la) {
      while (dq.length > head && gain[dq[dq.length - 1]] >= gain[j]) dq.pop();
      dq.push(j); j++;
    }
    while (dq[head] < i) head++;
    g2[i] = gain[dq[head]];
  }
  // attack is covered by the look-ahead; smooth the release (50 ms)
  const kr = Math.exp(-1 / (0.05 * sr)), ka = Math.exp(-1 / (0.0015 * sr));
  let g = 1;
  const outG = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const target = g2[i];
    g = target < g ? target + (g - target) * ka : target + (g - target) * kr;
    outG[i] = Math.min(g, gain[i]);
  }
  return channels.map((c) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = c[i] * outG[i]; return o; });
}
