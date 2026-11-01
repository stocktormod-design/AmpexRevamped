#!/usr/bin/env python3
# Relokalisering mot et ferdig skann (prototype på Mac, SKANN_BESLUTNINGER §110).
#
#   TMPDIR=<cache> <venv>/python tools/scan-relokalisering.py <råBundle> <bundetBundle> [--hull=8] [--hver=3]
#
# Spørsmålet: kommer du tilbake til et skannet rom, kan telefonen finne ut hvor den står og
# hvor den sikter fra ETT kamerabilde (+ dybde), uten ARKits gamle økt? Test: hvert n-te
# nøkkelbilde gjemmes, sammen med alt innen ±hull sekunder (så kartet bare har ANDRE
# passeringer av samme sted), og posen løses fra scratch mot resten av skannet.
#
# Kart: SIFT-trekk fra bildebindingen (samme cache som scan-bildebinding.py), løftet til 3D
# med LiDAR-dybden og de BUNDNE posene (frames.json i <bundetBundle>, §107). Fasit for det
# gjemte bildet er også den bundne posen — den stemmer med kartet til under en piksel.
#
# Steg: (1) trekk i spørrebildet mot hele kartet (FLANN, ratio mot nærmeste treff som er et
# ANNET sted i rommet — samme punkt sett fra ti nøkkelbilder skal ikke drepe ratioen),
# (2) PnP-RANSAC + LM, (3) valgfri finpuss med spørrebildets egen dybde (punkt-til-punkt mot
# kartpunktene, bare de som alt er bildetreff — ICP mot hele nettet er neste steg).
# Feil rapporteres som posisjon (cm), retning (°) og SIKTEFEIL: hvor langt fra fasit et punkt
# midt i bildet havner, på den avstanden kameraet faktisk ser — det er det AR-overlegget bommer med.
import json, os, sys, time
import numpy as np
import cv2

RAA, BUND = sys.argv[1].rstrip('/'), sys.argv[2].rstrip('/')
def flagg(n, d): return float(next((a.split('=')[1] for a in sys.argv if a.startswith(f'--{n}=')), d))
HULL = flagg('hull', 8.0)      # s — kartet mister alt innen dette fra spørrebildet
HVER = int(flagg('hver', 3))   # hvert n-te nøkkelbilde blir spørsmål
RATIO = flagg('ratio', 0.8)
MININL = int(flagg('mininl', 30))   # færre inliers = ikke stol på svaret (bedre «vet ikke» enn feil sted)
CACHE = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'bildebinding-' + os.path.basename(RAA))
LW, LH = 1920, 1080

kfs = json.load(open(f'{RAA}/frames.json')); kfs.sort(key=lambda k: k['timestamp'])
bund = {k['index']: np.array(k['transform'], float).reshape(4, 4).T for k in json.load(open(f'{BUND}/frames.json'))}
N = len(kfs)
T = np.array([k['timestamp'] for k in kfs]); T -= T[0]
M = np.stack([bund[k['index']] for k in kfs])   # kamera→verden (ARKit: x høyre, y opp, z bakover)

def Kmat(k):
    fx, fy, cx, cy = k['intrinsics']; s = LW / k['width']
    return np.array([[fx * s, 0, cx * s], [0, fy * s, cy * s], [0, 0, 1]])

def depth(k):
    return np.fromfile(f"{RAA}/{k['depthFile']}", dtype=np.float32).reshape(k['depthHeight'], k['depthWidth'])

def sample_depth(k, D, u, v):
    s = k['depthWidth'] / LW
    x = np.clip((u * s).astype(int), 0, k['depthWidth'] - 1); y = np.clip((v * s).astype(int), 0, k['depthHeight'] - 1)
    z = D[y, x].astype(float)
    ok = np.isfinite(z) & (z > 0.2) & (z < 5)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        zn = D[np.clip(y + dy, 0, k['depthHeight'] - 1), np.clip(x + dx, 0, k['depthWidth'] - 1)]
        ok &= np.abs(zn - z) < 0.05 * z
    return z, ok

def lift_cam(k, u, v, z):   # ARKit-kameraramme
    K = Kmat(k)
    return np.stack([(u - K[0, 2]) / K[0, 0] * z, -(v - K[1, 2]) / K[1, 1] * z, -z], -1)

# linsemodellen bindingen løste (§107): uten den bommer kantene med ~25 px og PnP-en vrir seg 1°
_l = json.load(open(f'{BUND}/linse.json')) if os.path.exists(f'{BUND}/linse.json') else {}
KD = np.array([_l.get('k1', 0.0), _l.get('k2', 0.0), _l.get('fs', 0.0)])
def und(k, xy):
    K = Kmat(k); xd = (xy[:, 0] - K[0, 2]) / K[0, 0]; yd = (xy[:, 1] - K[1, 2]) / K[1, 1]; xn, yn = xd.copy(), yd.copy()
    for _ in range(8):
        r2 = xn * xn + yn * yn; g = (1 + KD[2]) * (1 + KD[0] * r2 + KD[1] * r2 * r2); xn, yn = xd / g, yd / g
    return np.stack([xn * K[0, 0] + K[0, 2], yn * K[1, 1] + K[1, 2]], -1)

FLIP = np.diag([1.0, -1.0, -1.0])   # ARKit-kamera ↔ OpenCV-kamera

# ── kart ─────────────────────────────────────────────────────────────────────────────────
t0 = time.time()
Xs, Ds_, Fr, Q = [], [], [], []
depths = []
for i, k in enumerate(kfs):
    z_ = np.load(f"{CACHE}/f{k['index']}.npz"); xy, d = z_['xy'], z_['d']
    D = depth(k); depths.append(D)
    xu = und(k, xy.astype(float))
    Q.append((xy, d, xu))
    z, ok = sample_depth(k, D, xy[:, 0].astype(float), xy[:, 1].astype(float))
    Pc = lift_cam(k, xu[ok, 0], xu[ok, 1], z[ok])
    Xs.append(Pc @ M[i][:3, :3].T + M[i][:3, 3]); Ds_.append(d[ok]); Fr.append(np.full(ok.sum(), i))
X = np.concatenate(Xs); DESC = np.concatenate(Ds_).astype(np.float32); FR = np.concatenate(Fr)
KARTF = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--kart=')), None)
if KARTF:   # landemerkene fra bindingen (scan-bildebinding.py --kart, gjerne med --utelat=3) i stedet for LiDAR-løftede trekk
    z_ = np.load(KARTF); pos = {k['index']: i for i, k in enumerate(kfs)}
    FR = np.array([pos[int(i)] for i in z_['index']])
    DESC = np.stack([Q[f][1][q] for f, q in zip(FR, z_['q'])]).astype(np.float32)
    X = z_['X'][z_['l']]
    if '--enper' in sys.argv:   # én deskriptor per landemerke (første observasjon) — slik GPU-ens topp-2 kan brukes direkte
        _, første = np.unique(z_['l'], return_index=True)
        FR, DESC, X = FR[første], DESC[første], X[første]
flann = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=128))
flann.add([DESC]); flann.train()
print(f"kart: {len(X)} punkter fra {N} bilder, {time.time()-t0:.0f} s")

F4 = np.eye(4); F4[:3, :3] = FLIP
def treff(qi, lov):
    k = kfs[qi]; xy, d, xu = Q[qi]
    knn = flann.knnMatch(d.astype(np.float32), k=16)
    p2, p3 = [], []
    for a, nb in enumerate(knn):
        nb = [m for m in nb if lov[FR[m.trainIdx]]]
        if len(nb) < 2: continue
        best = nb[0]
        andre = next((m for m in nb[1:] if np.linalg.norm(X[m.trainIdx] - X[best.trainIdx]) > 0.10), None)
        if andre is not None and best.distance > RATIO * andre.distance: continue
        p2.append(xu[a]); p3.append(X[best.trainIdx])
    return np.array(p2, float).reshape(-1, 2), np.array(p3, float).reshape(-1, 3)

def pnp(qi, p2, p3):
    if len(p2) < MININL: return None
    try:   # SQPnP kan feile på degenererte utvalg (alle punkter på én linje)
        ok, rv, tv, inl = cv2.solvePnPRansac(p3, p2, Kmat(kfs[qi]), None, iterationsCount=2000, reprojectionError=4.0,
                                             confidence=0.999, flags=cv2.SOLVEPNP_SQPNP)
    except cv2.error:
        return None
    if not ok or inl is None or len(inl) < MININL: return None
    inl = inl.ravel(); rv, tv = cv2.solvePnPRefineLM(p3[inl], p2[inl], Kmat(kfs[qi]), None, rv, tv)
    Tcv = np.eye(4); Tcv[:3, :3] = cv2.Rodrigues(rv)[0]; Tcv[:3, 3] = tv.ravel()
    return np.linalg.inv(F4 @ Tcv), len(inl)


# ── vindu: flere bilder i én løsning (--vindu=W sekunder) ────────────────────────────────
# Slik telefonen gjør det: ARKit følger kameraet lokalt i den NYE økta (rå poser, glir lite over
# sekunder), og vi løser ÉN transform G (kart ← økt) mot treffene fra alle bildene i vinduet.
# Flere bilder = flere treff og bredere grunnlinje, så G blir stødigere enn ett bildes PnP.
if '--vindu' in ' '.join(sys.argv):
    from scipy.optimize import least_squares
    W = flagg('vindu', 2.0)
    Mraw = np.stack([np.array(k['transform'], float).reshape(4, 4).T for k in kfs])
    F4 = np.eye(4); F4[:3, :3] = FLIP

    def proj(qi, C, P):
        K = Kmat(kfs[qi]); Ci = np.linalg.inv(C); Pc = P @ Ci[:3, :3].T + Ci[:3, 3]; z = np.maximum(-Pc[:, 2], 0.05)
        return np.stack([K[0, 0] * Pc[:, 0] / z + K[0, 2], -K[1, 1] * Pc[:, 1] / z + K[1, 2]], -1)

    def expG(x, G0):
        D = np.eye(4); D[:3, :3] = cv2.Rodrigues(x[:3])[0]; D[:3, 3] = x[3:]
        return D @ G0

    ut = []
    for q0 in range(0, N, HVER):
        fr = [f for f in range(N) if T[q0] <= T[f] <= T[q0] + W]
        lov = (T < T[q0] - HULL) | (T > T[q0] + W + HULL)
        if lov.sum() < 5: continue
        tr = {f: treff(f, lov) for f in fr}
        kand = [(f, pnp(f, *tr[f])) for f in fr]
        kand = [(f, r) for f, r in kand if r is not None]
        if not kand:
            ut.append((q0, None)); continue
        f0, (C0, _) = max(kand, key=lambda a: a[1][1])
        G = C0 @ np.linalg.inv(Mraw[f0])
        # felles løsning: inliers under G, Huber-LM på 6 parametre, to runder med strammere grense
        for terskel in (8.0, 3.0):
            sel = {}
            for f in fr:
                p2, p3 = tr[f]
                if len(p2) == 0: continue
                e = np.linalg.norm(proj(f, G @ Mraw[f], p3) - p2, axis=1)
                if (e < terskel).sum() >= 8: sel[f] = e < terskel
            if not sel: break
            def r(x):
                Gx = expG(x, G)
                return np.concatenate([(proj(f, Gx @ Mraw[f], tr[f][1][m]) - tr[f][0][m]).ravel() for f, m in sel.items()])
            G = expG(least_squares(r, np.zeros(6), loss='huber', f_scale=1.5).x, G)
        ninl = sum(m.sum() for m in sel.values()) if sel else 0
        zc = np.nanmedian(np.where((depths[q0] > 0.2) & (depths[q0] < 5), depths[q0], np.nan))
        Pm = np.array([0, 0, -zc, 1])
        feil_en, feil_v = [], []
        for f in fr:
            sikt = lambda C: np.linalg.norm((C @ Pm)[:3] - (M[f] @ Pm)[:3]) * 100
            feil_v.append(sikt(G @ Mraw[f]))
        # sammenlign: beste enkeltbilde-PnP brukt på hele vinduet
        G1 = C0 @ np.linalg.inv(Mraw[f0])
        feil_en = [np.linalg.norm((G1 @ Mraw[f] @ Pm)[:3] - (M[f] @ Pm)[:3]) * 100 for f in fr]
        ut.append((q0, (np.median(feil_en), np.median(feil_v), len(fr), len(sel), ninl)))
    løst = [u for u in ut if u[1] is not None]
    print(f"{os.path.basename(RAA)[:14]} vindu {W:.0f} s: {len(løst)}/{len(ut)} løst")
    if løst:
        a = np.array([u[1] for u in løst])
        for j, nv in ((0, 'ett bilde'), (1, 'hele vinduet')):
            print(f"  {nv:<13} sikte median {np.median(a[:,j]):4.1f} cm  p90 {np.percentile(a[:,j],90):5.1f}  < 1 cm: {(a[:,j]<1).mean()*100:3.0f} %  < 2 cm: {(a[:,j]<2).mean()*100:3.0f} %  feil sted: {(a[:,j]>20).sum()}")
        print(f"  bilder med treff median {np.median(a[:,3]):.0f} av {np.median(a[:,2]):.0f} · inliers median {np.median(a[:,4]):.0f}")
    if '--detalj' in sys.argv:
        for q0, u in ut:
            print(f"    #{q0:3d} t={T[q0]:5.1f}s", 'IKKE LØST' if u is None else f"ett {u[0]:5.1f} cm  vindu {u[1]:5.1f} cm  ({u[3]}/{u[2]} bilder, {u[4]} inl)")
    sys.exit(0)

# ── spørsmål ─────────────────────────────────────────────────────────────────────────────
def rot_deg(R):
    return np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))

# fasit=selv: posen bildet får mot sine EGNE naboer i samme passering (±0,3 s holdt ute) i SAMME kart.
# Samme passering er enig med seg selv til ~2 mm (§110), så avviket mot den måler bare om kartet
# er enig med seg selv på tvers av passeringer — det AR-overlegget trenger — og ikke hvilken
# kjøring av bindingen fasiten kom fra.
FASIT = {}
if '--fasit=selv' in sys.argv:
    for qi in range(0, N, HVER):
        r = pnp(qi, *treff(qi, np.abs(T - T[qi]) >= 0.3))
        if r is not None: FASIT[qi] = r[0]

res = []
for qi in range(0, N, HVER):
    if '--fasit=selv' in sys.argv and qi not in FASIT: continue
    k = kfs[qi]; xy, d, xu = Q[qi]
    if len(xy) < 50: continue
    tq = time.time()
    lov = np.abs(T - T[qi]) >= HULL
    if lov.sum() < 5: continue
    Mi = np.linalg.inv(M[qi]); Pc = X[lov[FR]] @ Mi[:3, :3].T + Mi[:3, 3]; zc_ = -Pc[:, 2]; Kq = Kmat(k)
    foran = zc_ > 0.2
    uq = Kq[0, 0] * Pc[foran, 0] / zc_[foran] + Kq[0, 2]; vq = -Kq[1, 1] * Pc[foran, 1] / zc_[foran] + Kq[1, 2]
    inn = (uq > 0) & (uq < LW) & (vq > 0) & (vq < LH)
    zq, okq = sample_depth(k, depths[qi], uq[inn], vq[inn])
    dekning = int((okq & (np.abs(zq - zc_[foran][inn]) < 0.05 + 0.03 * zq)).sum())
    knn = flann.knnMatch(d.astype(np.float32), k=16)
    p2, p3, rå, kilde = [], [], [], []
    for a, nb in enumerate(knn):
        nb = [m for m in nb if lov[FR[m.trainIdx]]]
        if len(nb) < 2: continue
        best = nb[0]
        # ratio mot nærmeste treff et annet sted (> 10 cm unna) — samme punkt fra flere bilder teller ikke
        andre = next((m for m in nb[1:] if np.linalg.norm(X[m.trainIdx] - X[best.trainIdx]) > 0.10), None)
        if andre is not None and best.distance > RATIO * andre.distance: continue
        p2.append(xu[a]); rå.append(xy[a]); p3.append(X[best.trainIdx]); kilde.append(FR[best.trainIdx])
    K = Kmat(k)
    if '--diag' in sys.argv and len(p2):
        Mi = np.linalg.inv(M[qi]); Pc = np.array(p3) @ Mi[:3, :3].T + Mi[:3, 3]
        uv = np.stack([K[0, 0] * Pc[:, 0] / -Pc[:, 2] + K[0, 2], -K[1, 1] * Pc[:, 1] / -Pc[:, 2] + K[1, 2]], -1)
        riktig = (np.linalg.norm(uv - np.array(p2), axis=1) < 6).sum()
        # dekning: andel av spørrebildets dybdepunkter som et lovlig kartbilde ser (grovt, via kartpunktene)
        print(f"    diag #{qi}: {len(p2)} treff, {riktig} riktige etter fasit")
    if len(p2) < 12:
        res.append((qi, None, dekning)); continue
    p2 = np.array(p2, np.float64); p3 = np.array(p3, np.float64); rå = np.array(rå, np.float64)
    ok, rv, tv, inl = cv2.solvePnPRansac(p3, p2, K, None, iterationsCount=2000, reprojectionError=4.0,
                                         confidence=0.999, flags=cv2.SOLVEPNP_SQPNP)
    if not ok or inl is None or len(inl) < MININL:
        res.append((qi, None, dekning)); continue
    inl = inl.ravel()
    rv, tv = cv2.solvePnPRefineLM(p3[inl], p2[inl], K, None, rv, tv)
    R = cv2.Rodrigues(rv)[0]
    Tcv = np.eye(4); Tcv[:3, :3] = R; Tcv[:3, 3] = tv.ravel()
    F4 = np.eye(4); F4[:3, :3] = FLIP
    Mest = np.linalg.inv(F4 @ Tcv)
    # (3) finpuss med egen dybde: inliernes 3D i spørrekameraet (LiDAR) mot kartpunktene, Kabsch
    z, okz = sample_depth(k, depths[qi], rå[inl, 0], rå[inl, 1])
    Mdyp = Mest
    if okz.sum() >= 12:
        A = lift_cam(k, p2[inl, 0][okz], p2[inl, 1][okz], z[okz]); Bp = p3[inl][okz]
        for _ in range(3):   # trimmet: dropp verste 20 % og løs igjen
            ca, cb = A.mean(0), Bp.mean(0)
            U, _, Vt = np.linalg.svd((A - ca).T @ (Bp - cb)); Dd = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
            Rr = Vt.T @ Dd @ U.T; tr = cb - Rr @ ca
            e = np.linalg.norm(A @ Rr.T + tr - Bp, axis=1); keep = e <= np.quantile(e, 0.8)
            A, Bp = A[keep], Bp[keep]
        Mdyp = np.eye(4); Mdyp[:3, :3] = Rr; Mdyp[:3, 3] = tr
    if '--diag' in sys.argv:
        for nv, Mx in (('fasit', M[qi]), ('est', Mest)):
            Mi = np.linalg.inv(Mx); Pc = p3[inl] @ Mi[:3, :3].T + Mi[:3, 3]
            uv = np.stack([K[0, 0] * Pc[:, 0] / -Pc[:, 2] + K[0, 2], -K[1, 1] * Pc[:, 1] / -Pc[:, 2] + K[1, 2]], -1)
            e = np.linalg.norm(uv - p2[inl], axis=1); kk = np.array(kilde)[inl]
            print(f"      {nv}: reproj median {np.median(e):.1f} px  per kilde:", ' '.join(f"{f}@{T[f]:.0f}s:{np.median(e[kk==f]):.0f}px(n{(kk==f).sum()})" for f in np.unique(kk) if (kk==f).sum() >= 5))
        print('      fasit t', M[qi][:3, 3], 'est t', Mest[:3, 3])
    ms = (time.time() - tq) * 1000
    # siktefeil: punktet midt i bildet på medianavstanden kameraet ser
    zc = np.nanmedian(np.where((depths[qi] > 0.2) & (depths[qi] < 5), depths[qi], np.nan))
    Pm = np.array([0, 0, -zc, 1])
    Mf = FASIT.get(qi, M[qi])
    def feil(Me):
        dt = np.linalg.norm(Me[:3, 3] - Mf[:3, 3]) * 100
        dr = rot_deg(Me[:3, :3].T @ Mf[:3, :3])
        sikt = np.linalg.norm((Me @ Pm)[:3] - (Mf @ Pm)[:3]) * 100
        return dt, dr, sikt
    res.append((qi, (feil(Mest), feil(Mdyp), len(inl), len(p2), ms, zc), dekning))

def oppsum(navn, j):
    gode = [r[1][j] for r in res if r[1] is not None]
    if not gode: return
    a = np.array(gode)
    treff = (a[:, 2] < 5).mean() * 100
    print(f"  {navn:<12} feil sted (sikte > 20 cm): {(a[:,2] > 20).sum()}")
    print(f"  {navn:<12} posisjon median {np.median(a[:,0]):5.1f} cm p90 {np.percentile(a[:,0],90):6.1f} · retning median {np.median(a[:,1]):4.2f}° "
          f"· sikte median {np.median(a[:,2]):5.1f} cm p90 {np.percentile(a[:,2],90):6.1f} · sikte < 5 cm: {treff:.0f} %")

n = len(res); fant = sum(r[1] is not None for r in res)
dekket = [r for r in res if r[2] >= 300]
print(f"  dekket av en annen passering (≥ 300 synlige kartpunkter): {len(dekket)}/{n}, av dem løst {sum(r[1] is not None for r in dekket)}")
print(f"{os.path.basename(RAA)[:14]}: {fant}/{n} spørrebilder løst (kart uten ±{HULL:.0f} s)")
oppsum('bilde', 0); oppsum('bilde+dybde', 1)
if fant:
    a = np.array([[r[1][2], r[1][3], r[1][4], r[1][5]] for r in res if r[1] is not None])
    print(f"  inliers median {np.median(a[:,0]):.0f} av {np.median(a[:,1]):.0f} treff · {np.median(a[:,2]):.0f} ms per bilde · avstand median {np.median(a[:,3]):.1f} m")
if '--detalj' in sys.argv:
    for qi, r, dk in res:
        print(f"    #{qi:3d} t={T[qi]:5.1f}s dekning {dk:5d}", "IKKE LØST" if r is None else
              f"pos {r[0][0]:6.1f} cm  ret {r[0][1]:5.2f}°  sikte {r[0][2]:6.1f} cm  (dybde: {r[1][2]:6.1f})  inl {r[2]}/{r[3]}")
