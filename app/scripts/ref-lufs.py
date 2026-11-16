#!/usr/bin/env python3
"""Independent BS.1770-4 integrated loudness reference (numpy only, RBJ-free: uses the published
48 kHz coefficients warped to the file's rate through the bilinear pre-warp of the pole/zero set).
Usage: ref-lufs.py in.wav out.txt"""
import sys, wave, math
import numpy as np

def biquad(x, b, a):
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    b0, b1, b2 = b; a1, a2 = a
    for i in range(len(x)):
        v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x[i], y1, v
        y[i] = v
    return y

def coeffs(fs):
    # De Man, "Evaluation of implementations of the EBU R128 loudness measurement" (parametrised filters)
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / fs); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    s = ([(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / fs); a0 = 1 + K / Q + K * K
    h = ([1.0, -2.0, 1.0], [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
    return s, h

w = wave.open(sys.argv[1]); fs = w.getframerate(); ch = w.getnchannels()
d = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float64) / 32768.0
d = d.reshape(-1, ch)
# decimate work: run the python-loop biquads on every channel (slow but independent)
s, h = coeffs(fs)
z = np.zeros(d.shape[0])
for c in range(ch):
    y = biquad(biquad(d[:, c].copy(), *s), *h)
    z += y * y
block = int(0.4 * fs); step = block // 4
cs = np.concatenate([[0.0], np.cumsum(z)])
p = np.array([(cs[i + block] - cs[i]) / block for i in range(0, len(z) - block + 1, step)])
l = -0.691 + 10 * np.log10(np.maximum(p, 1e-12))
g = p[l > -70]
rel = -0.691 + 10 * math.log10(g.mean()) - 10
g2 = p[(l > -70) & (l > rel)]
open(sys.argv[2], 'w').write('%.4f\n' % (-0.691 + 10 * math.log10(g2.mean())))
