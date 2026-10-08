"""Precompute the E8 root system and its Petrie (Coxeter-plane) projection basis.

Writes src/e8.json: 240 roots (scaled x2 so they are integers), 6720 edges, and
an orthonormal 8D basis whose first two vectors span the Coxeter plane.
"""
import itertools, json, os
import numpy as np

roots = []
for i, j in itertools.combinations(range(8), 2):
    for si in (1, -1):
        for sj in (1, -1):
            v = [0] * 8
            v[i], v[j] = 2 * si, 2 * sj
            roots.append(v)
for signs in itertools.product((1, -1), repeat=8):
    if signs.count(-1) % 2 == 0:
        roots.append(list(signs))
R = np.array(roots, float) / 2
assert len(R) == 240

e = np.eye(8)
simple = [0.5 * np.array([1, -1, -1, -1, -1, -1, -1, 1]), e[0] + e[1], -e[0] + e[1],
          -e[1] + e[2], -e[2] + e[3], -e[3] + e[4], -e[4] + e[5], -e[5] + e[6]]
w = np.eye(8)
for a in simple:
    w = w @ (np.eye(8) - 2 * np.outer(a, a) / (a @ a))
vals, vecs = np.linalg.eig(w)
k = np.argmin(np.abs(vals - np.exp(2j * np.pi / 30)))
u, v = vecs[:, k].real, vecs[:, k].imag
u /= np.linalg.norm(u)
v -= (v @ u) * u
v /= np.linalg.norm(v)
# complete to an orthonormal basis (Gram-Schmidt over the identity)
basis = [u, v]
for c in np.eye(8):
    c = c - sum((c @ b) * b for b in basis)
    if np.linalg.norm(c) > 1e-6:
        basis.append(c / np.linalg.norm(c))
basis = np.array(basis[:8])

P = R @ basis[:2].T
radii = np.round(np.linalg.norm(P, axis=1), 4)
ring_vals = sorted(set(radii))
rings = [ring_vals.index(r) for r in radii]
edges = [(a, b) for a in range(240) for b in range(a + 1, 240) if abs(R[a] @ R[b] - 1) < 1e-9]
print('rings', len(ring_vals), 'edges', len(edges))

out = {
    'roots': (R * 2).astype(int).tolist(),
    'basis': np.round(basis, 8).tolist(),
    'rings': rings,
    'edges': edges,
}
path = os.path.join(os.path.dirname(__file__), '..', 'src', 'e8.json')
with open(path, 'w') as f:
    json.dump(out, f, separators=(',', ':'))
