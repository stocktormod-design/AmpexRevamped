#!/usr/bin/env python3
# Sett, men tapt: hvor i fusjonskjeden forsvinner flate LiDAR faktisk så? Replikerer filtrene i
# MeshTsdfBuild (fart-tillit, kantfilter, z-grenser, vektterskel) på rå dybdekart + nøkkelbildenes
# dybde, finner skilleveggen selv (to motsatte plan 5–20 cm fra hverandre) og teller per 10 cm-rute.
#
#   MINW=2.5 python3 tools/audit-scan-sett-tapt.py <bundleDir>
#
# Funn 26.10 på f92f1be0 (docs/SKANN_VURDERING_2026-10-26.md): filtrene og terskelen flytter 1–5
# prosentpoeng; tapte ruter er sett av 33–70 piksler totalt mot 1200–1600 for overlevende. Det er
# opptak, ikke fusjon.
import json, sys, os, math
import numpy as np

B = sys.argv[1]
MAXVEL = 0.35
MINW = float(os.environ.get('MINW', '2.5'))

meta = [json.loads(l) for l in open(f'{B}/dense.jsonl') if l.strip()]
meta = [m for m in meta if os.path.exists(f"{B}/dense-{m['i']}.f32")]
N = len(meta)
T = np.array([m['t'] for m in meta])
M = np.stack([np.array(m['m'], float).reshape(4, 4).T for m in meta])   # kolonnevis → rad
W, H = meta[0]['w'], meta[0]['h']

# --- tillit av fart (loadDense/trustForMotion) ---
trust = np.ones(N)
for i in range(1, N - 1):
    p0, p1 = M[i-1][:3, 3], M[i+1][:3, 3]
    f0, f1 = -M[i-1][:3, 2], -M[i+1][:3, 2]
    dt = max(0.08, min(2.0, T[i+1] - T[i-1]))
    lin = np.linalg.norm(p1 - p0) / dt
    rot = math.acos(max(-1, min(1, float(np.dot(f0/np.linalg.norm(f0), f1/np.linalg.norm(f1)))))) / dt
    worst = max(lin / MAXVEL, rot / (MAXVEL * 1.5))
    trust[i] = 1 if worst <= 1 else (0 if worst >= 2 else max(0.15, 1 - (worst - 1)))
# nøkkelbildenes dybdekart (JBU-normalisert ≈ ett dense-kart hver), tillit 1
kf = json.load(open(f'{B}/fixture-kf.json'))
kfl = []
for k in kf:
    if not k.get('depthFile') or not os.path.exists(f"{B}/{k['depthFile']}"): continue
    s_ = k['depthWidth'] / k['width']
    kfl.append({'i': None, 'file': k['depthFile'], 't': k['timestamp'], 'w': k['depthWidth'], 'h': k['depthHeight'],
                'fx': k['intrinsics'][0]*s_, 'fy': k['intrinsics'][1]*s_, 'cx': k['intrinsics'][2]*s_, 'cy': k['intrinsics'][3]*s_,
                'm': k['transform']})
NK = len(kfl)
meta = meta + kfl
M = np.concatenate([M, np.stack([np.array(m['m'], float).reshape(4, 4).T for m in kfl])]) if kfl else M
trust = np.concatenate([trust, np.ones(NK)])
N = len(meta)
print(f"nøkkelbilder med dybde: {NK}")
print(f"dense-kart {N-NK}: tillit 1: {(trust==1).sum()}, dempet: {((trust<1)&(trust>0)).sum()}, forkastet (0): {(trust==0).sum()}")

def load(i):
    m = meta[i]
    f = f"{B}/dense-{m['i']}.f32" if m['i'] is not None else f"{B}/{m['file']}"
    return np.fromfile(f, dtype=np.float32).reshape(m['h'], m['w']).astype(np.float64)

# --- global pikselbudsjett ---
tot = 0; gyldig = 0; kant = 0; forkastet = 0; dempet = 0
for i in range(N):
    d = load(i)
    ys, xs = np.mgrid[0:d.shape[0], 0:d.shape[1]]
    ok = (d > 0.3) & (d < 5.0)
    tot += d.size; gyldig += ok.sum()
    lim = np.maximum(0.04, 0.03 * d)
    e = np.zeros_like(ok)
    e[:, 1:] |= np.abs(d[:, :-1] - d[:, 1:]) > lim[:, 1:]
    e[:, :-1] |= np.abs(d[:, 1:] - d[:, :-1]) > lim[:, :-1]
    e[1:, :] |= np.abs(d[:-1, :] - d[1:, :]) > lim[1:, :]
    e[:-1, :] |= np.abs(d[1:, :] - d[:-1, :]) > lim[:-1, :]
    e &= ok
    kant += e.sum()
    if trust[i] == 0: forkastet += ok.sum()
    elif trust[i] < 1: dempet += ok.sum()
print(f"piksler: {tot}, gyldige (0,3–5 m): {gyldig} ({100*gyldig/tot:.0f} %), av disse: kantfiltrert {100*kant/gyldig:.1f} %, i forkastede kart {100*forkastet/gyldig:.1f} %, i dempede kart {100*dempet/gyldig:.1f} %")

# --- finn skilleveggen: RANSAC-plan per kart, klynget i verden ---
rng = np.random.default_rng(1)
planer = []   # (n_world, d_world, antall, kart)
for i in range(N):
    d = load(i)
    ys, xs = np.mgrid[0:d.shape[0], 0:d.shape[1]]
    ok = (d > 0.3) & (d < 5.0)
    P = np.stack([(xs - meta[i]['cx']) / meta[i]['fx'] * d, -(ys - meta[i]['cy']) / meta[i]['fy'] * d, -d], -1)[ok]
    if len(P) < 300: continue
    sub = P[rng.choice(len(P), min(4000, len(P)), replace=False)]
    rest = sub
    for _ in range(3):
        if len(rest) < 300: break
        best = None
        for _ in range(40):
            a, b, c = rest[rng.choice(len(rest), 3, replace=False)]
            n = np.cross(b - a, c - a); l = np.linalg.norm(n)
            if l < 1e-6: continue
            n /= l; dd = -n @ a
            inl = np.abs(rest @ n + dd) < 0.025
            if best is None or inl.sum() > best[2]: best = (n, dd, inl.sum(), inl)
        if best is None or best[2] < max(150, len(rest) * 0.12): break
        n, dd, cnt, inl = best
        q = rest[inl]; c0 = q.mean(0); u, s, vt = np.linalg.svd(q - c0); n = vt[-1]
        if n @ q[0] > 0: n = -n
        dd = -n @ c0
        inl = np.abs(rest @ n + dd) < 0.025
        R = M[i][:3, :3]; nw = R @ n; dw = dd - nw @ M[i][:3, 3]
        planer.append((nw, dw, int(inl.sum()), i))
        rest = rest[~inl]
# klyng vertikale plan
klynger = []
for nw, dw, cnt, i in planer:
    if abs(nw[1]) > 0.3: continue
    hit = None
    for k in klynger:
        if k['n'] @ nw > math.cos(math.radians(6)) and abs(k['d'] - dw) < 0.06: hit = k; break
    if hit:
        w = hit['w']; hit['n'] = (hit['n'] * w + nw * cnt); hit['n'] /= np.linalg.norm(hit['n'])
        hit['d'] = (hit['d'] * w + dw * cnt) / (w + cnt); hit['w'] += cnt; hit['kart'].append(i)
    else:
        klynger.append({'n': nw.copy(), 'd': dw, 'w': cnt, 'kart': [i]})
klynger.sort(key=lambda k: -k['w'])
# par: motsatt normal, 5–20 cm fra hverandre → skillevegg
par = []
for a in klynger:
    for b in klynger:
        if a is b or a['n'] @ b['n'] > -0.98: continue
        # posisjon langs a['n']: xa = -da ; b: n_b = -n_a, xb = db
        tyk = abs(-a['d'] - b['d'])
        if 0.05 < tyk < 0.20: par.append((a['w'] + b['w'], tyk, a, b))
par.sort(key=lambda p: -p[0])
if not par:
    print("fant ingen skillevegg (par av motsatte plan 5–20 cm fra hverandre)"); sys.exit(0)
_, tyk, A, Bp = par[0]
print(f"skillevegg: normal ({A['n'][0]:.2f},{A['n'][1]:.2f},{A['n'][2]:.2f}), tykkelse {tyk*100:.0f} cm, A støttet av {len(A['kart'])} kart, B av {len(Bp['kart'])} kart")

# --- per side: 10 cm-ruter på planet, hvem så dem, og hva ville overlevd fusjonen ---
def side(S, navn):
    n = S['n']; d = S['d']
    # planbasis
    u = np.cross(n, [0, 1, 0]); u /= np.linalg.norm(u); v = np.cross(n, u)
    sett = {}; raa_obs = {}; fus = {}; fus_utenfart = {}; fus_utenkant = {}; fus_alt = {}
    kamera = {}; avst = {}; sub4 = {}
    for i in range(N):
        dmap = load(i)
        ys, xs = np.mgrid[0:dmap.shape[0], 0:dmap.shape[1]]
        ok = (dmap > 0.3) & (dmap < 5.0)
        if not ok.any(): continue
        lim = np.maximum(0.04, 0.03 * dmap)
        e = np.zeros_like(ok)
        e[:, 1:] |= np.abs(dmap[:, :-1] - dmap[:, 1:]) > lim[:, 1:]
        e[:, :-1] |= np.abs(dmap[:, 1:] - dmap[:, :-1]) > lim[:, :-1]
        e[1:, :] |= np.abs(dmap[:-1, :] - dmap[1:, :]) > lim[1:, :]
        e[:-1, :] |= np.abs(dmap[1:, :] - dmap[:-1, :]) > lim[:-1, :]
        Pc = np.stack([(xs - meta[i]['cx']) / meta[i]['fx'] * dmap, -(ys - meta[i]['cy']) / meta[i]['fy'] * dmap, -dmap], -1)
        Pw = Pc @ M[i][:3, :3].T + M[i][:3, 3]
        dist = Pw @ n + d
        # denne siden: kameraet må stå på plansiden (n peker mot kamera-siden)
        cam = M[i][:3, 3]
        if cam @ n + d < 0.15: continue
        paa = ok & (np.abs(dist) < 0.06)
        if not paa.any(): continue
        z = dmap[paa]
        wf = np.clip(1.5 / np.maximum(z, 0.4), 0.25, 1.5)
        pu = (Pw[paa] @ u); pv = (Pw[paa] @ v)
        cell = (np.floor(pu / 0.10).astype(int), np.floor(pv / 0.10).astype(int))
        sub = (np.floor(pu / 0.02).astype(int), np.floor(pv / 0.02).astype(int))
        ek = e[paa]
        sub4c = (np.floor(pu / 0.04).astype(int), np.floor(pv / 0.04).astype(int))
        for k in range(len(z)):
            c = cell[0][k], cell[1][k]; s = sub[0][k], sub[1][k]
            sett[c] = sett.get(c, 0) + 1
            avst.setdefault(c, []).append(z[k])
            if not ek[k] and trust[i] > 0:
                s4 = sub4c[0][k], sub4c[1][k]; sub4[s4] = sub4.get(s4, 0) + wf[k] * trust[i]
            fus_alt[s] = fus_alt.get(s, 0) + wf[k]                       # ingen filtre
            if not ek[k]: fus_utenfart[s] = fus_utenfart.get(s, 0) + wf[k]   # bare kantfilter
            if trust[i] > 0: fus_utenkant[s] = fus_utenkant.get(s, 0) + wf[k] * trust[i]  # bare fart
            if not ek[k] and trust[i] > 0: fus[s] = fus.get(s, 0) + wf[k] * trust[i]       # som i baken
    def overlever(fusdict):
        ok = set()
        for (su, sv), w in fusdict.items():
            if w >= MINW: ok.add((su * 2 // 10 if su >= 0 else -((-su * 2 + 9) // 10), sv * 2 // 10 if sv >= 0 else -((-sv * 2 + 9) // 10)))
        return ok
    # enklere: en rute «overlever» hvis minst halvparten av dens 2 cm-underruter har W ≥ MINW
    def overlever2(fusdict):
        per = {}
        for (su, sv), w in fusdict.items():
            c = (math.floor(su * 0.02 / 0.10), math.floor(sv * 0.02 / 0.10))
            per.setdefault(c, []).append(w)
        return {c: (sum(1 for w in ws if w >= MINW) >= 12) for c, ws in per.items()}
    S_sett = {c for c, k in sett.items() if k >= 3}   # «sett» = minst 3 rå piksler i ruta
    o = overlever2(fus); o_f = overlever2(fus_utenfart); o_k = overlever2(fus_utenkant); o_a = overlever2(fus_alt)
    n_sett = len(S_sett)
    tapt = [c for c in S_sett if not o.get(c, False)]
    tapt_f = [c for c in S_sett if not o_f.get(c, False)]
    tapt_k = [c for c in S_sett if not o_k.get(c, False)]
    tapt_a = [c for c in S_sett if not o_a.get(c, False)]
    print(f"side {navn}: {n_sett} ruter sett (≥3 piksler). Modell av fusjonen (W ≥ {MINW} i ≥ halve ruta):")
    print(f"  som i baken (fart + kant):      {100*len(tapt)/n_sett:.0f} % av sette ruter får ikke flate")
    print(f"  uten fartsfilter (bare kant):   {100*len(tapt_f)/n_sett:.0f} %")
    print(f"  uten kantfilter (bare fart):    {100*len(tapt_k)/n_sett:.0f} %")
    print(f"  uten filtre (bare vektterskel): {100*len(tapt_a)/n_sett:.0f} %")
    # hvor mange sette ruter har bare få observasjoner?
    tynn = sum(1 for c in S_sett if sett[c] < 15)
    import statistics
    ta = [statistics.median(avst[c]) for c in tapt]; oa = [statistics.median(avst[c]) for c in S_sett if o.get(c, False)]
    tn = [sett[c] for c in tapt]; on = [sett[c] for c in S_sett if o.get(c, False)]
    print(f"  tapte ruter: median avstand {statistics.median(ta):.1f} m, median {statistics.median(tn):.0f} piksler; overlevende: {statistics.median(oa):.1f} m, {statistics.median(on):.0f} piksler")
    ws = np.array(list(fus.values())); print(f"  2 cm-underceller sett: {len(ws)}, andel med W < {MINW}: {100*(ws < MINW).mean():.0f} %, median W {np.median(ws):.2f}")
    w4 = np.array(list(sub4.values())); print(f"  4 cm-underceller sett: {len(w4)}, andel med W < {MINW}: {100*(w4 < MINW).mean():.0f} %, median W {np.median(w4):.2f}")
    print(f"  ruter sett av < 15 piksler totalt (tynn dekning): {100*tynn/n_sett:.0f} %")
side(A, 'A'); side(Bp, 'B')
