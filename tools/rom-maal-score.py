#!/usr/bin/env python3
# Fasit og poeng for romdelingen (tools/rom-maal.ts) mot CubiCasa5K.
#
#   <venv>/python -I tools/rom-maal-score.py forbered <cubicasa5k-dir> <utvalg.txt> <arbeidsdir>
#   node .tmp/rom-maal/tools/rom-maal.js <arbeidsdir>/liste.json <arbeidsdir>/funn.json
#   <venv>/python -I tools/rom-maal-score.py poeng <arbeidsdir> [--bilder]
#
# Fasit: hvert «Space …»-polygon i model.svg (koordinatene er pikslene i F1_scaled.png).
# Målestokk per tegning: SpaceDimensionsLabel sier «3.72 m x 1.86 m» for rommets ytre mål,
# og polygonets boks er de samme målene i piksler. Medianen over rommene.
# Ett fasitrom regnes som TRUFFET når beste funn har IoU ≥ 0,75 (plassering) og arealet er
# innen ±10 % (størrelse). Uteplass (Space Outdoor) telles for seg — den er sjelden lukket.
import json, os, re, sys
import xml.etree.ElementTree as ET
import numpy as np
import cv2

NS = '{http://www.w3.org/2000/svg}'

def fasit(svg):
    rot = ET.parse(svg).getroot()
    rom, skala = [], []
    for g in rot.iter(NS + 'g'):
        k = g.get('class') or ''
        if not k.startswith('Space '): continue
        pg = g.find(NS + 'polygon')
        if pg is None: continue
        tall = [float(v) for v in re.split(r'[ ,]+', pg.get('points').strip()) if v]
        P = np.array(tall, float).reshape(-1, 2)
        if len(P) < 3: continue
        rom.append({'klasse': k[6:], 'punkter': P.tolist()})
        for t in g.iter(NS + 'text'):
            m = re.match(r'\s*([\d.]+)\s*m\s*x\s*([\d.]+)\s*m', t.text or '')
            if m:
                a, b = float(m.group(1)), float(m.group(2))
                w, h = np.ptp(P[:, 0]), np.ptp(P[:, 1])
                if a > 0.5 and b > 0.5: skala += [w / a, h / b]
    return rom, (float(np.median(skala)) if skala else None)

def forbered(rotdir, utvalg, arb):
    os.makedirs(arb, exist_ok=True)
    liste, fas = [], {}
    for l in open(utvalg):
        p = l.strip().strip('/')
        if not p: continue
        d = os.path.join(rotdir, p)
        png, svg = os.path.join(d, 'F1_scaled.png'), os.path.join(d, 'model.svg')
        if not (os.path.exists(png) and os.path.exists(svg)): continue
        rom, pxm = fasit(svg)
        if not pxm or not rom: continue
        im = cv2.imread(png, cv2.IMREAD_COLOR)
        H, W = im.shape[:2]
        rgba = cv2.cvtColor(im, cv2.COLOR_BGR2RGBA)
        id_ = p.replace('/', '_')
        f = os.path.join(arb, id_ + '.rgba'); rgba.tofile(f)
        liste.append({'id': id_, 'rgba': f, 'W': W, 'H': H, 'pxPerM': pxm})
        fas[id_] = {'W': W, 'H': H, 'pxPerM': pxm, 'rom': rom, 'png': png}
    json.dump(liste, open(os.path.join(arb, 'liste.json'), 'w'))
    json.dump(fas, open(os.path.join(arb, 'fasit.json'), 'w'))
    print(f'{len(liste)} tegninger, {sum(len(v["rom"]) for v in fas.values())} fasitrom')

def maske(P, W, H, s):
    m = np.zeros((int(H * s) + 1, int(W * s) + 1), np.uint8)
    cv2.fillPoly(m, [np.round(np.array(P) * s).astype(np.int32)], 1)
    return m

def poeng(arb, bilder=False):
    fas = json.load(open(os.path.join(arb, 'fasit.json')))
    funn = {f['id']: f for f in json.load(open(os.path.join(arb, 'funn.json')))}
    S = 0.25   # regn IoU på kvart oppløsning — rask nok, presis nok for 0,75-terskelen
    tot = {'inne': [0, 0], 'ute': [0, 0]}; plass = [0, 0]; arealfeil = []; ekstra = 0; tomme = 0
    pertegn = []
    for id_, F in fas.items():
        W, H, pxm = F['W'], F['H'], F['pxPerM']
        R = funn.get(id_, {}).get('rom', [])
        if not R: tomme += 1
        Fm = [maske(r['punkter'], W, H, S) for r in F['rom']]
        Rm = [maske(r['punkter'], W, H, S) for r in R]
        brukt = set(); treff_t = 0; n_t = 0
        for fr, fm in zip(F['rom'], Fm):
            ute = fr['klasse'].startswith('Outdoor')
            best, bj = 0.0, -1
            for j, rm in enumerate(Rm):
                i = np.logical_and(fm, rm).sum()
                if not i: continue
                u = np.logical_or(fm, rm).sum(); iou = i / u
                if iou > best: best, bj = iou, j
            fa = fm.sum() / (S * S) / (pxm * pxm)
            ra = R[bj]['areal'] if bj >= 0 else 0
            ok_plass = best >= 0.75
            ok = ok_plass and abs(ra - fa) <= 0.10 * fa
            k = 'ute' if ute else 'inne'
            tot[k][0] += ok; tot[k][1] += 1
            if not ute:
                plass[0] += ok_plass; plass[1] += 1
                if bj >= 0 and best >= 0.5: arealfeil.append((ra - fa) / fa)
                treff_t += ok; n_t += 1
            if bj >= 0 and best >= 0.5: brukt.add(bj)
        ekstra += sum(1 for j in range(len(R)) if j not in brukt)
        pertegn.append((id_, int(treff_t), n_t, len(R)))
        if bilder: tegn(arb, id_, F, R)
    i, u = tot['inne'], tot['ute']
    print(f"innerom truffet (IoU ≥ 0,75 og areal ±10 %): {i[0]}/{i[1]} = {100*i[0]/max(i[1],1):.1f} %")
    print(f"innerom plassert (IoU ≥ 0,75):                {plass[0]}/{plass[1]} = {100*plass[0]/max(plass[1],1):.1f} %")
    if arealfeil:
        a = np.abs(arealfeil); print(f"arealfeil der funnet (IoU ≥ 0,5): median {100*np.median(a):.1f} %, p90 {100*np.percentile(a,90):.1f} %, snitt fortegn {100*np.mean(arealfeil):+.1f} %")
    print(f"uteplass truffet: {u[0]}/{u[1]} · ekstra funn uten fasit: {ekstra} · tegninger uten ett eneste funn: {tomme}/{len(fas)}")
    hele = sum(1 for _, t, n, _ in pertegn if n and t == n)
    print(f"tegninger der ALLE innerom er truffet: {hele}/{len(pertegn)}")
    json.dump(pertegn, open(os.path.join(arb, 'pertegn.json'), 'w'))

def tegn(arb, id_, F, R):
    im = cv2.imread(F['png']); o = im.copy()
    for r in F['rom']: cv2.polylines(o, [np.round(np.array(r['punkter'])).astype(np.int32)], True, (0, 160, 0), 4)
    for r in R: cv2.fillPoly(o, [np.round(np.array(r['punkter'])).astype(np.int32)], (60, 60, 255))
    im = cv2.addWeighted(im, 0.55, o, 0.45, 0)
    for r in F['rom']: cv2.polylines(im, [np.round(np.array(r['punkter'])).astype(np.int32)], True, (0, 160, 0), 4)
    os.makedirs(os.path.join(arb, 'bilder'), exist_ok=True)
    s = 1400 / max(im.shape[:2])
    cv2.imwrite(os.path.join(arb, 'bilder', id_ + '.jpg'), cv2.resize(im, None, fx=s, fy=s), [cv2.IMWRITE_JPEG_QUALITY, 80])

if __name__ == '__main__':
    if sys.argv[1] == 'forbered': forbered(sys.argv[2], sys.argv[3], sys.argv[4])
    else: poeng(sys.argv[2], '--bilder' in sys.argv)
