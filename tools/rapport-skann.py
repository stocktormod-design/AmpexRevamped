#!/usr/bin/env python3
"""Skannrapport: måler et skann (bundle + bakt GLB) mot Scaniverse-referansen.

    python3 tools/rapport-skann.py <bundle-katalog> [bakt.glb]

Uten GLB rapporteres bare opptaket. Referansetallene er målt på
`Scaniverse 2026-09-06 123218.glb` og står i docs/SKANN_BESLUTNINGER.md §66-§72.
"""
import json, sys, struct, math, pathlib
import numpy as np

REF = {"rand": 3.70, "veggRMS": 30.1, "kontrast": 0.507, "brudd": 0.0264, "texel": 462}

def les_glb(sti):
    b = open(sti, 'rb').read()
    ln = struct.unpack('<I', b[8:12])[0]; off = 12; ch = []
    while off < ln:
        cl = struct.unpack('<I', b[off:off+4])[0]; ch.append((off+8, cl)); off += 8+cl
    j = json.loads(b[ch[0][0]:ch[0][0]+ch[0][1]].decode()); bn = b[ch[1][0]:ch[1][0]+ch[1][1]]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        ct = {5121: 'u1', 5123: 'u2', 5125: 'u4', 5126: 'f4'}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        return np.frombuffer(bn, dtype=np.dtype(ct), count=a['count']*n, offset=base).reshape(-1, n)
    P = []; I = []; vb = 0
    for m in j['meshes']:
        for pr in m['primitives']:
            p = acc(pr['attributes']['POSITION']).astype(np.float64)
            i = acc(pr['indices']).astype(np.int64).ravel()
            P.append(p); I.append(i + vb); vb += len(p)
    return np.vstack(P), np.concatenate(I).reshape(-1, 3)

def opptak(bundle):
    kf = json.load(open(bundle / "fixture-kf.json"))
    blur = np.array([k.get('blurPx', np.nan) for k in kf], float)
    fart = np.array([k.get('motion', np.nan) for k in kf], float)
    dense = sum(1 for _ in open(bundle / "dense.jsonl")) if (bundle / "dense.jsonl").exists() else 0
    print(f"OPPTAK  {len(kf)} foto, {dense} dybdekart")
    print(f"  bevegelsesuskarphet  median {np.nanmedian(blur):6.1f} px   p90 {np.nanpercentile(blur,90):6.1f}   "
          f"andel > 10 px: {100*np.nanmean(blur>10):3.0f} %   MÅL: median < 5")
    print(f"  kamerafart           median {np.nanmedian(fart):6.2f} m/s  p90 {np.nanpercentile(fart,90):6.2f}")
    d = bundle / "capture-decisions.json"
    if d.exists():
        a = json.load(open(d)); c = a.get('counts', {})
        tot = max(a.get('total', 1), 1)
        for k in ("minimum_interval", "interval_novelty_override", "saved_new", "saved_replacement"):
            if k in c:
                print(f"  {k:26s} {c[k]:5d}  ({100*c[k]/tot:4.1f} % av beslutningene)")

def geometri(glb):
    pos, idx = les_glb(glb)
    a, b, c = pos[idx[:,0]], pos[idx[:,1]], pos[idx[:,2]]
    n = np.cross(b-a, c-a); L = np.linalg.norm(n, axis=1); ok = L > 1e-12
    ar = 0.5*L[ok]; nn = n[ok]/L[ok, None]; cen = ((a+b+c)/3)[ok]
    key = np.round(pos*10000).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    w = inv[idx]
    from collections import defaultdict
    cnt = defaultdict(int)
    for t in w:
        for u, v in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0])):
            cnt[(min(u,v),max(u,v))] += 1
    rand = 0.0
    P = {i: p for i, p in enumerate(pos)}
    inv_first = {}
    for i, r in enumerate(inv):
        inv_first.setdefault(r, i)
    for (u, v), k in cnt.items():
        if k == 1:
            rand += np.linalg.norm(pos[inv_first[u]] - pos[inv_first[v]])
    A = ar.sum()
    print(f"GEOMETRI  {len(idx)} trekanter, {A:.1f} m² flate")
    print(f"  åpen rand per m²     {rand/max(A,1e-9):6.2f}   REFERANSE {REF['rand']:.2f}  "
          f"{'OK' if rand/max(A,1e-9) <= REF['rand'] else 'UNDER MÅL'}")
    vert = np.abs(nn[:,1]) < 0.3
    if vert.sum() > 200:
        az = ((np.arctan2(nn[vert,2], nn[vert,0])+np.pi)/(np.pi/12)).astype(int)
        d = (cen[vert]*nn[vert]).sum(axis=1)
        best = None
        for k in np.unique(az):
            sel = az == k
            if sel.sum() < 200: continue
            h, e = np.histogram(d[sel], bins=np.arange(d[sel].min()-0.05, d[sel].max()+0.1, 0.03), weights=ar[vert][sel])
            i = h.argmax(); band = (d[sel] >= e[i]-0.06) & (d[sel] < e[i+1]+0.06)
            omr = ar[vert][sel][band].sum()
            if best is None or omr > best[0]:
                dd = d[sel][band]; best = (omr, math.sqrt(((dd-dd.mean())**2).mean()))
        if best:
            print(f"  veggens planhet      {1000*best[1]:6.1f} mm  REFERANSE {REF['veggRMS']:.1f} mm  "
                  f"{'OK' if 1000*best[1] <= REF['veggRMS'] else 'UNDER MÅL'}")

b = pathlib.Path(sys.argv[1])
opptak(b)
if len(sys.argv) > 2:
    geometri(sys.argv[2])
else:
    glbs = sorted(b.glob("rebake-harness-*.glb"), key=lambda p: p.stat().st_mtime)
    if glbs: geometri(glbs[-1])
print("\nSporkontrast og brudd måles med tools/audit-scan-wall-camera.py + rendring (se §66).")
