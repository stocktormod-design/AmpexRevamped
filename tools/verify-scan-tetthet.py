#!/usr/bin/env python3
"""Lik kvalitet per m² uansett husstørrelse: teksturtetthet per del i et ferdig hus-skann.

Bruk: verify-scan-tetthet.py <glb> [<glb> ...] [--mål TEXEL_PER_M] [--spredning 0.10]

Tar enten den sammenslåtte hus-GLB-en (primitivene merket `extras.del`) eller én GLB per
delkart (`delkart/N/delkart-N.glb`). For hver del regnes flatearealet i verden og arealet
trekantene dekker i atlaset (UV × flisens faktiske pikselstørrelse, lest fra bildehodet), og
tettheten er √(texelareal / flateareal) i texel per meter.

Tormods regel: et stort hus skal ta lengre tid, ikke bli dårligere. Derfor påstås:
- alle deler ligger innen `--spredning` (standard 10 %) av den skarpeste delen;
- med `--mål` ligger hver del på eller over måltettheten.

Trekanter per m² skrives ut, men påstås ikke: forenklingen er adaptiv, så et rom med mye
møbler har med rette flere trekanter enn et tomt.

Første måling (c1794d71, telefon 30.10, 9 fliser à 6144 per del): del 0 136 m² 976 texel/m,
del 2 69 m² 1463, del 3 41 m² 1758. Feiler — det største rommet er 1,8× grovere.
"""
import json, struct, sys
from collections import defaultdict

import numpy as np


def bildestørrelse(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', data[16:24])
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        m = data[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    raise ValueError('fant ikke bildestørrelse')


def les_glb(sti):
    b = open(sti, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    binr = memoryview(b)[20 + jl + 8:]

    def view(i):
        v = j['bufferViews'][i]
        o = v.get('byteOffset', 0)
        return binr[o:o + v['byteLength']]

    def acc(i):
        a = j['accessors'][i]
        v = j['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
        o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        x = np.frombuffer(binr, dt, a['count'] * n, o)
        return x.reshape(-1, n) if n > 1 else x

    return j, acc, view


def mål_fil(sti, standarddel, summer):
    j, acc, view = les_glb(sti)
    størrelser = {}
    for m in j['meshes']:
        for pr in m['primitives']:
            del_ = pr.get('extras', {}).get('del', standarddel)
            P = acc(pr['attributes']['POSITION']).astype(np.float64)
            U = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
            I = acc(pr['indices']).reshape(-1, 3)
            tex = j['materials'][pr['material']]['pbrMetallicRoughness']['baseColorTexture']['index']
            src = j['textures'][tex]['source']
            if src not in størrelser:
                størrelser[src] = bildestørrelse(bytes(view(j['images'][src]['bufferView'])[:65536]))
            w, h = størrelser[src]
            a = P[I[:, 1]] - P[I[:, 0]]
            b = P[I[:, 2]] - P[I[:, 0]]
            ua = U[I[:, 1]] - U[I[:, 0]]
            ub = U[I[:, 2]] - U[I[:, 0]]
            s = summer[del_]
            s['flate'] += 0.5 * np.linalg.norm(np.cross(a, b), axis=1).sum()
            s['texel'] += (0.5 * np.abs(ua[:, 0] * ub[:, 1] - ua[:, 1] * ub[:, 0]) * w * h).sum()
            s['tris'] += len(I)
            s['fliser'].add((sti, src))


def main():
    args = sys.argv[1:]
    mål = None
    spredning = 0.10
    filer = []
    i = 0
    while i < len(args):
        if args[i] == '--mål':
            mål = float(args[i + 1]); i += 2
        elif args[i] == '--spredning':
            spredning = float(args[i + 1]); i += 2
        else:
            filer.append(args[i]); i += 1
    if not filer:
        sys.exit(__doc__)

    summer = defaultdict(lambda: {'flate': 0.0, 'texel': 0.0, 'tris': 0, 'fliser': set()})
    for sti in filer:
        mål_fil(sti, sti.rsplit('/', 1)[-1].removesuffix('.glb'), summer)

    tetthet = {}
    for d in sorted(summer, key=str):
        s = summer[d]
        tetthet[d] = (s['texel'] / s['flate']) ** 0.5
        print(f'del {d}: {s["flate"]:6.1f} m², {len(s["fliser"])} fliser, '
              f'{tetthet[d]:5.0f} texel/m, {s["tris"] / s["flate"]:5.0f} trekanter/m²')

    best = max(tetthet.values())
    feil = []
    for d, t in tetthet.items():
        if t < best * (1 - spredning):
            feil.append(f'del {d}: {t:.0f} texel/m er {100 * (1 - t / best):.0f} % under skarpeste del ({best:.0f})')
        if mål is not None and t < mål:
            feil.append(f'del {d}: {t:.0f} texel/m under målet {mål:.0f}')
    if feil:
        print('FEIL — kvaliteten avhenger av romstørrelsen:')
        for f in feil:
            print('  ' + f)
        sys.exit(1)
    print(f'OK — alle deler innen {spredning * 100:.0f} % av {best:.0f} texel/m')


if __name__ == '__main__':
    main()
