"""Score for the film, synthesised from scratch and cut to picture.

Every melodic sound is a Karplus-Strong plucked string - the piece is, quite
literally, made of vibrating strings. Timings mirror src/timeline.js.

    python3 audio/synth.py out/score.wav
"""
import sys
import wave
import numpy as np

SR = 48000
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(1968)

ERAS = [(1968, 2.0), (1970, 3.5), (1974, 5.0), (1984, 6.5), (1985, 8.0),
        (1995, 9.5), (1997, 11.0), (2003, 12.5)]
OUTRO, NOW = 13.5, 2026
BEAT = 0.5


def hz(note):
    names = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6,
             'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave + 1) - 69) / 12)


def place(buf, sig, t, gain=1.0, pan=0.0):
    """Mix a mono signal into the stereo bus at time t with equal-power pan."""
    i = int(round(t * SR))
    if i >= N:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[: N - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + len(sig)] += sig * gain * l
    buf[1, i:i + len(sig)] += sig * gain * r


def env(n, a=0.005, d=None):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na)
    if d:
        e *= np.exp(-np.arange(n) / (d * SR))
    return e


def onepole(x, cutoff):
    """One-pole lowpass; cutoff may be a scalar or per-sample array (Hz)."""
    c = np.broadcast_to(np.asarray(cutoff, float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s)
        y[i] = s
    return y


def karplus(f, dur, bright=0.5, decay=0.996, pick=0.3):
    """Karplus-Strong plucked string, vectorised one period at a time."""
    n = int(dur * SR)
    p = SR / f
    d = int(p)
    frac = p - d
    burst = rng.uniform(-1, 1, d + 2)
    # pick-position comb + brightness lowpass on the excitation
    k = max(1, int(pick * d))
    burst[k:] -= burst[:-k] * 0.9
    burst = onepole(burst, 600 + 9000 * bright)
    y = np.zeros(n + d + 2)
    y[: d + 2] = burst
    i = d + 2
    while i < len(y):
        j = min(i + d, len(y))
        a = y[i - d: j - d]
        b = y[i - d - 1: j - d - 1]
        y[i:j] = decay * ((1 - frac) * (0.5 * a + 0.5 * b) + frac * b)
        i = j
    y = y[: n]
    y -= y.mean()
    return y / (np.abs(y).max() + 1e-9) * env(n, 0.001)


def sine_sweep(f0, f1, dur, curve=4.0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-curve * tt / dur * 3)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR))


def bandsweep(dur, f0, f1, shape=None):
    """Noise through a swept 'bandpass' (difference of two lowpasses)."""
    n = int(dur * SR)
    x = noise(dur)
    f = np.geomspace(f0, f1, n)
    y = onepole(x, f * 1.6) - onepole(x, f * 0.6)
    if shape is not None:
        y *= shape
    return y / (np.abs(y).max() + 1e-9)


def year_at(t):
    rolls = [(1.95, 0.6, 1900, 1968)]
    rolls += [(e[1] - 0.04, 0.42, ERAS[i][0], e[0]) for i, e in enumerate(ERAS[1:])]
    rolls += [(OUTRO - 0.02, 0.5, 2003, NOW)]
    v = 1900.0
    for t0, d, a, b in rolls:
        if t >= t0:
            x = min(1, (t - t0) / d)
            e = 8 * x ** 4 if x < 0.5 else 1 - (-2 * x + 2) ** 4 / 2
            v = a + (b - a) * e
    return v


def reverb_ir(seconds=2.4, predelay=0.012):
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    ir = np.zeros((2, n))
    for ch in range(2):
        x = rng.normal(0, 1, n) * np.exp(-tt * 6.9 / seconds)
        x = onepole(x, 7000) * 0.6 + x * 0.4
        ir[ch] = np.concatenate([np.zeros(int(predelay * SR)), x])[:n]
    return ir / np.abs(ir).sum(axis=1, keepdims=True) * 9


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]


def build():
    dry = np.zeros((2, N))   # direct sounds
    wet = np.zeros((2, N))   # sends to the reverb
    sub = np.zeros((2, N))   # low end, kept out of the reverb

    def both(sig, t, g, pan=0.0, send=0.35):
        place(dry, sig, t, g, pan)
        place(wet, sig, t, g * send, pan)

    # ---- 0.0-2.0 intro: shimmer, the pull, the pluck --------------------------------
    shimmer = sum(np.sin(2 * np.pi * hz(n) * np.arange(int(1.0 * SR)) / SR) for n in ['A5', 'D6', 'E6'])
    both(shimmer * env(len(shimmer), 0.6, 0.35) * 0.05, 0.0, 1, 0, 0.9)
    # the string being pulled aside: rising creak of filtered noise
    both(bandsweep(0.3, 300, 1400, np.linspace(0, 1, int(0.3 * SR)) ** 2) * 0.08, 0.48, 1, 0, 0.3)
    both(karplus(hz('D3'), 4.0, 0.7, 0.9985, 0.37), 0.78, 0.55, -0.15, 0.5)
    both(karplus(hz('A3'), 4.0, 0.55, 0.9982, 0.31), 0.785, 0.32, 0.2, 0.5)
    both(karplus(hz('D2'), 4.0, 0.4, 0.999, 0.4), 0.78, 0.35, 0, 0.3)
    # title letters landing: soft ticks
    for i in range(13):
        tk = karplus(hz('D6') * (1 + (i % 4) * 0.125), 0.25, 0.9, 0.99) * env(int(0.25 * SR), 0.001, 0.05)
        both(tk, 0.9 + i * 0.045, 0.05, -0.6 + i * 0.1, 0.6)
    # the string falls to the timeline
    both(bandsweep(0.45, 3000, 200, np.hanning(int(0.45 * SR))) * 0.22, 1.55, 1, 0, 0.4)

    # ---- era hits: rising arpeggio of plucked strings ---------------------------------
    notes = ['D4', 'F4', 'A4', 'C5', 'D5', 'F5', 'A5', 'C6']
    lows = ['D2', 'D2', 'Bb1', 'F2', 'C2', 'D2', 'Bb1', 'A1']
    for i, ((year, t0), note, low) in enumerate(zip(ERAS, notes, lows)):
        both(karplus(hz(note), 2.2, 0.6 + 0.04 * i, 0.9975, 0.27), t0, 0.32, -0.3 + 0.08 * i, 0.55)
        both(karplus(hz(note) * 1.5, 1.6, 0.6, 0.997, 0.2), t0 + 0.12, 0.12, 0.35, 0.7)
        place(sub, karplus(hz(low), 2.0, 0.25, 0.9992, 0.45), t0, 0.5)
        # playhead lands on the timeline: tiny struck string
        both(karplus(hz('D6'), 0.6, 0.8, 0.995), t0 + 0.36, 0.08, 0.5, 0.8)
        # decoded kicker text: data chirps
        for k in range(6):
            f = 2400 + 1800 * rng.random()
            n = int(0.018 * SR)
            chirp = np.sin(2 * np.pi * f * np.arange(n) / SR) * np.hanning(n)
            both(chirp, t0 + 0.06 + k * 0.06, 0.025, rng.uniform(-0.7, 0.7), 0.3)

    # ---- odometer: one click per year rolled over --------------------------------------
    ts = np.arange(1.9, OUTRO + 0.6, 1 / 2000)
    yrs = np.floor([year_at(t) for t in ts])
    last = None
    for t, y in zip(ts, yrs):
        if last is not None and y != last:
            n = int(0.006 * SR)
            click = rng.uniform(-1, 1, n) * np.exp(-np.arange(n) / (0.0012 * SR))
            both(click, t, 0.09, -0.55, 0.15)
        last = y

    # ---- pulse: kick on the beat, hats from 1984 --------------------------------------
    for b in np.arange(2.0, OUTRO, BEAT):
        if 6.0 <= b < 6.5:
            continue  # breath before the cut
        k = sine_sweep(150, 42, 0.32) * env(int(0.32 * SR), 0.002, 0.09)
        g = 0.32 if b < 6.5 else 0.42
        place(sub, k, b, g)
    for b in np.arange(6.5, OUTRO, BEAT / 2):
        h = onepole(noise(0.05), 9000)
        h = (noise(0.05) - h) * env(int(0.05 * SR), 0.001, 0.012)
        off = abs((b / BEAT) % 1 - 0.5) < 1e-6
        both(h, b, 0.06 if off else 0.035, 0.4 if off else -0.4, 0.2)

    # ---- graviton tension -> 1984 hard cut ----------------------------------------------
    rd = 1.0
    shape = np.linspace(0, 1, int(rd * SR)) ** 3
    both(bandsweep(rd, 300, 6000, shape) * 0.28, 5.5, 1, 0, 0.3)
    tt = np.arange(int(rd * SR)) / SR
    riser = np.sin(2 * np.pi * np.cumsum(np.geomspace(110, 880, len(tt))) / SR) * shape
    both(riser * 0.06, 5.5, 1, 0, 0.5)
    # the cut: sub drop + noise burst + low pluck chord
    place(sub, sine_sweep(95, 30, 1.8, 2) * env(int(1.8 * SR), 0.002, 0.6), 6.5, 0.9)
    both(onepole(noise(1.2), 2500) * env(int(1.2 * SR), 0.001, 0.18), 6.5, 0.55, 0, 0.8)
    for i, n in enumerate(['F2', 'C3', 'F3', 'A3', 'C4']):
        both(karplus(hz(n), 3.0, 0.75, 0.9985, 0.3), 6.5 + i * 0.012, 0.22, -0.4 + i * 0.2, 0.6)
    # E8 snaps into symmetry: bell cluster
    for i, n in enumerate(['C6', 'G6', 'D7', 'A6']):
        nn = int(2.0 * SR)
        x = np.arange(nn) / SR
        bell = np.sin(2 * np.pi * hz(n) * x + 2.0 * np.exp(-x * 3) * np.sin(2 * np.pi * hz(n) * 3.5 * x))
        both(bell * env(nn, 0.001, 0.5), 7.0 + i * 0.02, 0.05, -0.5 + i * 0.33, 0.9)
    place(sub, sine_sweep(70, 40, 0.6) * env(int(0.6 * SR), 0.002, 0.2), 7.0, 0.45)

    # ---- transitions --------------------------------------------------------------------
    both(bandsweep(0.4, 400, 4000, np.hanning(int(0.4 * SR))) * 0.25, 7.75, 1, 0, 0.5)   # zoom-through
    w = bandsweep(0.5, 6000, 300, np.hanning(int(0.5 * SR)) ** 0.7)                     # whip pan
    place(dry, w * 0.35, 9.22, 1, -0.6)
    place(dry, w[::-1] * 0.2, 9.5, 1, 0.6)
    place(sub, sine_sweep(80, 38, 0.8) * env(int(0.8 * SR), 0.002, 0.25), 9.5, 0.55)
    # "M": boom and a pure fifth
    place(sub, sine_sweep(90, 33, 1.4, 2) * env(int(1.4 * SR), 0.002, 0.45), 10.05, 0.75)
    both(karplus(hz('D3'), 3.0, 0.8, 0.9988), 10.05, 0.3, -0.2, 0.7)
    both(karplus(hz('A3'), 3.0, 0.8, 0.9988), 10.06, 0.25, 0.2, 0.7)
    both(onepole(noise(0.8), 1800) * env(int(0.8 * SR), 0.001, 0.12), 10.05, 0.35, 0, 0.9)
    both(bandsweep(0.35, 800, 5000, np.hanning(int(0.35 * SR))) * 0.15, 10.75, 1, 0, 0.6)  # ring -> disk
    both(bandsweep(0.3, 5000, 600, np.hanning(int(0.3 * SR))) * 0.15, 12.3, 1, 0, 0.6)    # disk tilts
    # landscape exponent counting up: accelerating ticks
    for k in range(40):
        t = 12.55 + 0.57 * (1 - (1 - k / 40) ** 0.35)
        n = int(0.004 * SR)
        both(rng.uniform(-1, 1, n) * np.exp(-np.arange(n) / 40), t, 0.05, 0.6, 0.2)

    # ---- implosion -> outro --------------------------------------------------------------
    rd = 0.7
    shape = np.linspace(0, 1, int(rd * SR)) ** 4
    rev = bandsweep(rd, 200, 9000, shape)
    both(rev * 0.35, OUTRO - rd, 1, 0, 0.2)
    place(sub, sine_sweep(110, 32, 1.5, 2) * env(int(1.5 * SR), 0.002, 0.4), OUTRO, 0.7)
    # the final pluck: D major (a Picardy third after all that D minor)
    t = OUTRO + 0.42
    chord = ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4', 'F#4', 'A4']
    for i, n in enumerate(chord):
        both(karplus(hz(n), 1.6, 0.7, 0.9992, 0.37), t + i * 0.014, 0.3 if i < 2 else 0.2, -0.6 + i * 0.17, 0.7)
    # title letters landing again
    for i in range(13):
        tk = karplus(hz('A5') * (1 + (i % 3) * 0.25), 0.25, 0.9, 0.99) * env(int(0.25 * SR), 0.001, 0.05)
        both(tk, OUTRO + 0.38 + i * 0.045, 0.04, -0.6 + i * 0.1, 0.7)
    both(karplus(hz('F#6'), 1.4, 0.8, 0.998), OUTRO + 0.75, 0.1, 0.4, 0.9)

    # ---- pads & drone ----------------------------------------------------------------------
    x = np.arange(N) / SR
    prog = [(0, 2.0, ['D3', 'A3']), (2.0, 5.0, ['D3', 'F3', 'A3']), (5.0, 6.5, ['Bb2', 'D3', 'F3']),
            (6.5, 8.0, ['F2', 'C3', 'A3']), (8.0, 9.5, ['C3', 'G3', 'E4']), (9.5, 11.0, ['D3', 'A3', 'F4']),
            (11.0, 12.5, ['Bb2', 'F3', 'D4']), (12.5, 13.5, ['A2', 'E3', 'C#4']), (13.5, 15.0, ['D3', 'F#3', 'A3'])]
    pad = np.zeros(N)
    for a, b, chord in prog:
        g = np.clip((x - a) / 0.25, 0, 1) * np.clip((b + 0.25 - x) / 0.25, 0, 1)
        for n in chord:
            f = hz(n)
            for det in (-0.12, 0.12):
                ph = 2 * np.pi * (f + det) * x
                pad += g * (np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)) / len(chord)
    pad = onepole(pad, 900 + 1400 * np.clip(x / 12, 0, 1))
    pad *= 0.05 * np.clip(x / 1.5, 0, 1)
    place(wet, pad, 0, 1.4, 0)
    place(dry, pad, 0, 0.5, 0)
    drone = (np.sin(2 * np.pi * hz('D1') * x) + 0.5 * np.sin(2 * np.pi * hz('D2') * x)) * 0.09
    drone *= np.clip((x - 0.7) / 1.5, 0, 1)
    place(sub, drone, 0, 1)

    # ---- mix ---------------------------------------------------------------------------------
    ir = reverb_ir()
    rev = np.stack([convolve(wet[c], ir[c]) for c in range(2)])
    # sidechain: duck the reverb/pads under the impacts
    duck = np.ones(N)
    for t0, a in [(6.5, 0.7), (7.0, 0.3), (9.5, 0.4), (10.05, 0.5), (OUTRO, 0.5)]:
        i = int(t0 * SR)
        k = np.exp(-np.arange(N - i) / (0.25 * SR))
        duck[i:] *= 1 - a * k
    sub_l = onepole(sub[0], 220)
    sub_r = onepole(sub[1], 220)
    mix = dry + rev * duck + np.stack([sub_l, sub_r]) * 1.25
    mix = np.tanh(mix * 1.4) / np.tanh(1.4)
    # tail: fade with the picture
    fade = np.clip((DUR - 0.02 - x) / 0.5, 0, 1) ** 2
    mix *= fade
    mix /= np.abs(mix).max() / 10 ** (-1 / 20)
    return mix


def write(path, mix):
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'out/score.wav'
    write(out, build())
    print('wrote', out)
