#!/usr/bin/env python3
"""To tilleggsmål til audit-scan-scaniverse-forensikk.py.

Bruk:  python3 tools/audit-scan-scaniverse-gitter-stoy.py a.glb [b.glb ...]

1. GITTER: ligger hjørnene på et voxelgitter? Testes på KANTDIFFERANSER (forskyvningsfritt),
   langs Y og langs alle horisontale retninger 0–90° (gitteret kan være rotert om loddlinja
   i forhold til eksportrammen). R = |mean exp(2πi d/s)| over kantkomponenter |d| > 1 mm.
   Tilfeldig forventning ≈ 1/sqrt(n). Komponenter nær 0 (plan langs aksen) er utelatt fordi
   de gir høy R for alle s.
2. STØY: Immerkær-støyestimat (robust MAD-variant) i gråtone på veggtekslene (|n_y| < 0,3),
   erodert 4 px fra chart-kanten. Både i atlasets egen oppløsning og etter nedskalering til
   felles tetthet 480 texel/m (Scaniverses median på vegg), så tallene kan sammenlignes.
   Måler høyfrekvent variasjon uten kanter; panelspor blir delvis med, så det er en øvre grense.
"""
import json
import struct
import sys
from pathlib import Path

import cv2 as cv
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module  # noqa: E402

fz = import_module('audit-scan-scaniverse-forensikk')


def lattice_edges(P, F):
    w, _ = fz.weld(P); Fw = w[F]
    a = Fw.ravel(); b = np.roll(Fw, -1, 1).ravel()
    lo, hi = np.minimum(a, b), np.maximum(a, b)
    u = np.unique(lo*(w.max()+1)+hi)
    i, j = u // (w.max()+1), u % (w.max()+1)
    _, first = np.unique(w, return_index=True)
    Pu = P[first]
    D = Pu[j]-Pu[i]
    ss = np.arange(.004, .0402, .0005)

    def scan(d):
        d = d[abs(d) > .001]
        if len(d) > 60000: d = np.random.default_rng(0).choice(d, 60000, replace=False)
        R = np.array([abs(np.exp(2j*np.pi*d/s).mean()) for s in ss])
        k = int(R.argmax())
        return float(R[k]), float(ss[k]*1000), len(d)
    out = {'y': scan(D[:, 1])}
    best = (0, 0, 0, 0)
    for th in np.arange(0, 90, .5):
        t = np.radians(th)
        r, s, n = scan(D[:, 0]*np.cos(t)+D[:, 2]*np.sin(t))
        if r > best[0]: best = (r, s, th, n)
    out['horisontal_beste'] = {'R': best[0], 's_mm': best[1], 'vinkel_grader': best[2], 'n': best[3]}
    out['tilfeldig_R'] = 1/np.sqrt(best[3]) if best[3] else None
    return out


def noise(g, P, UV, F, tex):
    tri = P[F]; cr = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]); ln = np.linalg.norm(cr, axis=1)
    n = cr/np.maximum(ln[:, None], 1e-15); area = ln/2
    wall = abs(n[:, 1]) < .3
    M = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    res = []
    for t, im in enumerate(g['images']):
        img = im['img']; h, w = img.shape[:2]
        fs = np.where(wall & (tex == t))[0]
        if len(fs) == 0: continue
        uvt = UV[F[fs]]*[w, h]
        e1 = uvt[:, 1]-uvt[:, 0]; e2 = uvt[:, 2]-uvt[:, 0]
        dens = np.sqrt(abs(e1[:, 0]*e2[:, 1]-e1[:, 1]*e2[:, 0])/2/np.maximum(area[fs], 1e-15))
        dmed = fz.wquant(dens, area[fs])[1]
        mask = np.zeros((h, w), np.uint8)
        cv.fillPoly(mask, list((uvt*16).round().astype(np.int32)), 255, shift=4)
        gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY).astype(np.float32)
        row = {'tekstur': t, 'vegg_texel_per_m_median': dmed}
        for name, k in [('egen', 1.0), ('ved_480_per_m', min(1.0, 480/dmed))]:
            gi, mi = gray, mask
            if k < 1:
                gi = cv.resize(gray, None, fx=k, fy=k, interpolation=cv.INTER_AREA)
                mi = cv.resize(mask, None, fx=k, fy=k, interpolation=cv.INTER_NEAREST)
            mi = cv.erode(mi, np.ones((9, 9), np.uint8))
            r = abs(cv.filter2D(gi, -1, M))[mi > 0]
            if len(r) < 1000: continue
            # flatfelt-støy: residual mot gauss-glattet bilde, bare i de 25 % roligste vegg-tekslene
            B = cv.GaussianBlur(gi, (0, 0), 2.0)
            gm = np.hypot(cv.Sobel(B, cv.CV_32F, 1, 0), cv.Sobel(B, cv.CV_32F, 0, 1))[mi > 0]
            res_ = (gi-B)[mi > 0]
            calm = gm <= np.quantile(gm, .25)
            row[name] = {'sigma_immerkaer_snitt': float(np.sqrt(np.pi/2)*r.mean()/6),
                         'sigma_flatfelt_mad': float(1.4826*np.median(abs(res_[calm]-np.median(res_[calm])))),
                         'piksler': int(len(r))}
        res.append(row)
    return res


def main():
    for p in sys.argv[1:]:
        g = fz.load(p)
        print(json.dumps({'fil': Path(p).name, 'gitter': lattice_edges(g['P'], g['F']),
                          'støy_vegg': noise(g, g['P'], g['UV'], g['F'], g['tex'])}, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
