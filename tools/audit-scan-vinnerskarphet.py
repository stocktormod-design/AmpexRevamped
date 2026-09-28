#!/usr/bin/env python3
"""Hvor skarpt er fotoet baken velger per flate? Se SKANN_BESLUTNINGER §99.

Bruk: audit-scan-vinnerskarphet.py <bundleDir> [gulv] [eksp]

Regner vinnerscoren fra MeshBakeV2.scoreAt for hver flate i fixture-mesh.bin og
sammenligner den valgte vinnerens skarphet med den SKARPESTE kandidaten som ser samme
flate. Kjører begge vektingene: gammel (skarphet/maks, gulv 0,30) og ny
((skarphet/p90)², gulv 0,08), slik at endringen kan dømmes i tall før en rebake.

Uten dybdekartene gjøres ingen okklusjonstest — tallene gjelder flater med fri sikt, og
er derfor et litt optimistisk anslag for møblerte rom. Skarphet er målt på HELE bildet,
ikke på flaten; et bilde kan være skarpt på et objekt i hjørnet. Derfor er dette en
indikator på lappeteppe, ikke en dom over enkeltflater.
"""
import json, struct, sys
import numpy as np

B = sys.argv[1] if len(sys.argv) > 1 else '.'
F = json.load(open(f'{B}/frames.json'))
d = open(f'{B}/fixture-mesh.bin', 'rb').read()
magic, ver, vc, tc = struct.unpack_from('<4I', d, 0)
assert magic == 0x414D5058, 'ikke en fixture-mesh.bin'
pos = np.frombuffer(d, np.float32, vc * 3, 16).reshape(-1, 3).astype(np.float64)
idx = np.frombuffer(d, np.uint32, tc * 3, 16 + vc * 24).reshape(-1, 3).astype(np.int64)

v0, v1, v2 = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
C = (v0 + v1 + v2) / 3
N = np.cross(v1 - v0, v2 - v0)
L = np.linalg.norm(N, axis=1)
keep = L > 1e-9
C, N = C[keep], N[keep] / np.maximum(L[keep], 1e-12)[:, None]
if len(C) > 40000:                      # jevnt utvalg — scoren er per flate, ikke per naboskap
    s = np.linspace(0, len(C) - 1, 40000).astype(int); C, N = C[s], N[s]

sh = np.array([f['sharpness'] for f in F], float)
p90 = np.sort(sh)[min(len(sh) - 1, int(len(sh) * 0.9))]
maks = max(sh.max(), 1e-4)

def score(gulv, ny, eksp):
    S = np.full((len(F), len(C)), -1.0)
    for k, f in enumerate(F):
        K = f['intrinsics']; W, H = f['width'], f['height']
        M = np.array(f['transform']).reshape(4, 4).T; R = M[:3, :3]; t = M[:3, 3]
        r = min(1, sh[k] / p90) ** eksp if ny else sh[k] / maks
        q = r / (1 + 2 * f.get('motion', 0)) / (1 + max(0, f.get('blurPx', 0)) / 30)
        if f.get('preLock'): q *= 0.6
        pc = (C - t) @ R; z = -pc[:, 2]
        zz = np.where(z > 1e-6, z, 1e-6)
        px = pc[:, 0] / zz * K[0] + K[2]; py = -pc[:, 1] / zz * K[1] + K[3]
        vd = t - C; vd /= np.maximum(np.linalg.norm(vd, axis=1, keepdims=True), 1e-12)
        fac = np.sum(N * vd, axis=1)
        ok = (z > 0.05) & (px > 8) & (py > 8) & (px < W - 8) & (py < H - 8) & (fac > 0.15)
        sc = fac * np.abs(fac) / np.maximum(np.sum((C - t) ** 2, 1), 0.25) * (gulv + (1 - gulv) * q)
        bfx = np.minimum(px, W - px) / (W * 0.12); bfy = np.minimum(py, H - py) / (H * 0.12)
        sc *= 0.3 + 0.7 * np.minimum(1, np.minimum(bfx, bfy))
        S[k][ok] = sc[ok]
    w = S.argmax(0); har = S.max(0) > 0
    kand = S > 0
    beste = np.array([sh[kand[:, i]].max() if kand[:, i].any() else np.nan for i in range(len(C))])
    return sh[w], beste, har

gulv = float(sys.argv[2]) if len(sys.argv) > 2 else 0.08
eksp = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
print(f"{len(F)} keyframes, skarphet min {sh.min():.0f} / p90 {p90:.0f} / maks {maks:.0f}; {len(C)} flater")
for navn, (g, ny, e) in (("gammel (skarphet/maks, gulv 0,30)", (0.30, False, 1.0)),
                         (f"ny ((skarphet/p90)^{eksp:g}, gulv {gulv:g})", (gulv, True, eksp))):
    v, best, har = score(g, ny, e)
    t = v[har] / np.maximum(best[har], 1e-9)
    print(f"  {navn}:")
    print(f"    vinnerens skarphet: median {np.median(v[har]):5.0f}  p10 {np.percentile(v[har],10):5.0f}")
    print(f"    flater med under halve tilgjengelige skarphet: {100*np.mean(t<0.5):4.0f} %   under en firedel: {100*np.mean(t<0.25):4.0f} %")
