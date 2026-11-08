#!/usr/bin/env python3
"""Overlegg-sannhet: stemmer det overlegget viste som dekket med det baken faktisk laget?
M0b i docs/PROMPT_OPUS_SKANN_DELKART.md, referansetallet M1 måles mot (≥ 95 %).

Bruk: audit-scan-overlegg-sannhet.py <bundleDir | dekning-ferdig.bin> <modell.glb>
      audit-scan-overlegg-sannhet.py --selvtest

Leser `dekning-ferdig.bin` (skrevet av CoverageField.dumpFerdig ved Ferdig, før baken) og
den ferdige GLB-en (ARKit-verden, identitetsnoder — som ARMeshGlbExporter skriver dem).

To tall:
  sannhet  = andel av cellene overlegget viste som dekket (c ≥ terskel) der det finnes
             trekantflate i GLB-en innen 5 cm fra cellesenteret. Under 100 % = overlegget
             sa «ferdig» om noe baken ikke laget flate av (luft, tapt, eller flyttet av posene).
  udekket  = andel av meshens flate (arealvektet) som lå i celler overlegget viste som
             udekket. Over 0 % = baken laget flate brukeren ble bedt om å skanne mer.
Det andre tallet gis også «med naboer» (dekket hvis en celle innen 5 cm er dekket),
som ligger nærmere det coverageFrag viser med normal-tappene sine.

Feltet er 5 cm-celler, så tallene sier ingenting under 5 cm. Rotasjon/drift mellom
live-poser og bakeposer viser seg som tap i begge tall — det er poenget.
"""
import json, struct, sys
from pathlib import Path
import numpy as np

RADIUS = 0.05


def les_dekning(path):
    raw = Path(path).read_bytes()
    nx, ny, nz, _ = struct.unpack_from('<4i', raw, 0)
    ox, oy, oz, vox, terskel = struct.unpack_from('<5f', raw, 16)
    c = np.frombuffer(raw, np.uint8, nx * ny * nz, 36).reshape(nz, ny, nx).transpose(2, 1, 0)  # [x, y, z]
    return c.astype(np.float32) / 255.0, np.array([ox, oy, oz]), vox, terskel


def les_glb(path):
    data = Path(path).read_bytes()
    n = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20 + n]); binary = data[28 + n:]
    for node in meta['nodes']:
        assert not any(k in node for k in ['matrix', 'translation', 'rotation', 'scale']), 'nodetransform støttes ikke'

    def read(i):
        a = meta['accessors'][i]; v = meta['bufferViews'][a['bufferView']]
        dtype = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']])
        width = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride', dtype.itemsize * width)
        return np.ndarray((a['count'], width), dtype=dtype, buffer=binary, offset=start,
                          strides=(stride, dtype.itemsize)).copy()
    tris = []
    for mesh in meta['meshes']:
        for p in mesh['primitives']:
            pos = read(p['attributes']['POSITION']).astype(np.float64)
            idx = read(p['indices']).reshape(-1, 3).astype(np.int64)
            tris.append(pos[idx])
    return np.concatenate(tris)   # [T, 3, 3]


def sample_flate(tris, step=0.015, seed=7):
    """Arealjevne punkter på flaten, ~1 per step². Hver trekant får minst ett (sentroiden)."""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    ok = area > 0
    a, b, c, area = a[ok], b[ok], c[ok], area[ok]
    rng = np.random.default_rng(seed)
    k = np.floor(area / step ** 2 + rng.random(len(area))).astype(np.int64)
    pts = [(a + b + c) / 3]; w = [area / (k + 1)]
    rep = np.repeat(np.arange(len(area)), k)
    if len(rep):
        r1, r2 = rng.random(len(rep)), rng.random(len(rep))
        s = np.sqrt(r1)
        pts.append(a[rep] * (1 - s)[:, None] + b[rep] * (s * (1 - r2))[:, None] + c[rep] * (s * r2)[:, None])
        w.append((area / (k + 1))[rep])
    return np.concatenate(pts), np.concatenate(w)


def nær_flate(pts, shape, origo, vox, radius=RADIUS):
    """Bool-grid: cellesenteret ligger innen radius fra et flatepunkt."""
    near = np.zeros(shape, bool)
    r = int(np.ceil(radius / vox)) + 1
    offs = np.array([(i, j, k) for i in range(-r, r + 1) for j in range(-r, r + 1) for k in range(-r, r + 1)])
    for s in range(0, len(pts), 500_000):
        p = pts[s:s + 500_000]
        base = np.floor((p - origo) / vox).astype(np.int64)
        for o in offs:
            cell = base + o
            centre = origo + (cell + 0.5) * vox
            hit = np.sum((centre - p) ** 2, axis=1) <= radius ** 2
            hit &= np.all(cell >= 0, axis=1) & np.all(cell < shape, axis=1)
            cl = cell[hit]
            near[cl[:, 0], cl[:, 1], cl[:, 2]] = True
    return near


def dilater(mask):
    out = mask.copy()
    for ax in range(3):
        for d in (-1, 1):
            s = np.roll(mask, d, axis=ax)
            idx = [slice(None)] * 3; idx[ax] = 0 if d == 1 else -1
            s[tuple(idx)] = False
            out |= s
    return out


def mål(c, origo, vox, terskel, tris):
    dekket = c >= terskel - 0.5 / 255
    pts, w = sample_flate(tris)
    near = nær_flate(pts, c.shape, origo, vox)
    n_dekket = int(dekket.sum())
    sannhet = float((dekket & near).sum()) / max(n_dekket, 1)
    cell = np.floor((pts - origo) / vox).astype(np.int64)
    inne = np.all(cell >= 0, axis=1) & np.all(cell < c.shape, axis=1)
    ci = np.where(inne[:, None], cell, 0)
    i_dekket = inne & dekket[ci[:, 0], ci[:, 1], ci[:, 2]]
    # «Med naboer»: cellen eller en nabo (6-nabolag ≈ 5 cm) er dekket.
    nabo = dilater(dekket)
    i_nabo = inne & nabo[ci[:, 0], ci[:, 1], ci[:, 2]]
    W = w.sum()
    return {
        'celler_dekket': n_dekket,
        'sannhet': sannhet,
        'udekket_flate': float(w[~i_dekket].sum() / W),
        'udekket_flate_med_naboer': float(w[~i_nabo].sum() / W),
        'flate_utenfor_feltet': float(w[~inne].sum() / W),
        'flate_m2': float(W),
    }


def selvtest():
    # Gulv 4×4 m på y=0, en vegg 4×2,5 m på z=0. Feltet dekker gulvet + halve veggen,
    # pluss en «luft»-flekk 1 m over gulvet som ikke har flate.
    vox = 0.05; origo = np.array([-0.5, -0.5, -0.5]); shape = (110, 70, 110)
    c = np.zeros(shape, np.float32)
    def cells(lo, hi):
        a = np.floor((np.array(lo) - origo) / vox).astype(int); b = np.ceil((np.array(hi) - origo) / vox).astype(int)
        return tuple(slice(a[i], b[i]) for i in range(3))
    c[cells([0, -0.02, 0], [4, 0.02, 4])] = 1.0               # gulvet
    c[cells([0, 0, -0.02], [2, 2.5, 0.02])] = 1.0             # venstre halvdel av veggen
    luft = cells([2, 1, 2], [2.5, 1.5, 2.5]); c[luft] = 1.0     # 10×10×10 celler luft
    def quad(p0, u, v):
        p1, p2, p3 = p0 + u, p0 + u + v, p0 + v
        return np.array([[p0, p1, p2], [p0, p2, p3]])
    tris = np.concatenate([quad(np.array([0., 0, 0]), np.array([4., 0, 0]), np.array([0, 0, 4.])),
                           quad(np.array([0., 0, 0]), np.array([4., 0, 0]), np.array([0, 2.5, 0]))])
    r = mål(c, origo, vox, 0.4, tris)
    n_luft = 10 * 10 * 10
    assert abs(r['sannhet'] - (1 - n_luft / r['celler_dekket'])) < 0.01, r
    # Udekket flate: halve veggen = 5 m² av 26 m².
    assert abs(r['udekket_flate'] - 5 / 26) < 0.01, r
    assert r['udekket_flate_med_naboer'] < r['udekket_flate'], r
    assert r['flate_utenfor_feltet'] == 0, r
    # Forskyvning 8 cm (mer enn radius): sannheten skal falle merkbart.
    r2 = mål(c, origo, vox, 0.4, tris + np.array([0, 0.08, 0]))
    assert r2['sannhet'] < r['sannhet'] - 0.2, (r, r2)
    print('selvtest ok', {k: round(v, 3) if isinstance(v, float) else v for k, v in r.items()})


def main():
    if sys.argv[1:] == ['--selvtest']:
        return selvtest()
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    if src.is_dir():
        src = src / 'dekning-ferdig.bin'
    c, origo, vox, terskel = les_dekning(src)
    tris = les_glb(sys.argv[2])
    r = mål(c, origo, vox, terskel, tris)
    print(f'felt {c.shape[0]}×{c.shape[1]}×{c.shape[2]} à {vox * 100:.0f} cm, terskel {terskel:.2f}, '
          f'{r["celler_dekket"]} celler dekket; mesh {len(tris)} trekanter, {r["flate_m2"]:.1f} m²')
    print(f'overlegg-sannhet: {r["sannhet"] * 100:.1f} % av dekkede celler har flate innen {RADIUS * 100:.0f} cm')
    print(f'udekket flate:    {r["udekket_flate"] * 100:.1f} % av meshen lå i celler vist som udekket '
          f'({r["udekket_flate_med_naboer"] * 100:.1f} % med naboer, {r["flate_utenfor_feltet"] * 100:.1f} % utenfor feltet)')
    print(json.dumps(r))


if __name__ == '__main__':
    main()
