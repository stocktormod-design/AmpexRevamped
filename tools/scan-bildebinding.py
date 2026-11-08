#!/usr/bin/env python3
# Bildebasert binding mellom passeringer (SKANN_BESLUTNINGER §107). Prototype på Mac — port
# til Swift når tallene holder.
#
#   <venv>/python tools/scan-bildebinding.py <bundleDir> [--skriv <utBundle>] [--anker=0.03]
#
# §105/§106e: loop closure på DYBDE flytter posene dit LiDAR er enig, men da blir BILDENE
# uenige (teppet smøres). Her er det bildene som binder: SIFT-trekk matches mellom
# nøkkelbilder som ser samme flate, også fra ulike passeringer, og posene løses i én
# bundle adjustment der landemerkene er frie punkter (ikke låst til LiDAR-dybden).
# Dybden brukes bare som (a) forslag til hvor et trekk skal havne — det dreper de falske
# treffene på periodiske panelspor (§105) — og (b) svak prior på landemerkenes avstand.
#
# Unknowns: korreksjon per nøkkelbilde i kamerarammen, M' = M · exp(δ), og landemerker X.
# Ledd: reprojeksjon (px i luma-oppløsning, Huber), ARKit-anker per bilde, relativ
# odometri mellom påfølgende bilder (ARKit er god lokalt), svak dybdeprior.
# Hvert tredje KRYSS-par (Δt ≥ GAP) holdes utenfor og måles med epipolar avstand, som
# ikke avhenger av dybden eller landemerkene.
#
# Med --skriv: kopi av bundlen der frames.json, fixture-kf.json og dense.jsonl har de nye
# posene (dybdekartene får korreksjonen interpolert mellom nabo-nøkkelbildene i tid), og
# linse.json med den løste linsemodellen (texel-baken leser den, meshscan.linse = off for A/B).
import json, os, sys, time
import numpy as np
import cv2

B = sys.argv[1].rstrip('/')
UT = sys.argv[sys.argv.index('--skriv') + 1] if '--skriv' in sys.argv else None
def flagg(n, d): return float(next((a.split('=')[1] for a in sys.argv if a.startswith(f'--{n}=')), d))
GAP = flagg('gap', 3.0)            # s — par med større tidsavstand er «kryss» (ulike passeringer)
SIG_PX = flagg('sigpx', 1.0)       # px (luma 1920) per observasjon
ANK_T = flagg('anker', 0.03)       # m  — total korreksjon mot ARKit
ANK_R = np.radians(flagg('ankerr', 1.0))
ODO_T = flagg('odot', 0.003)       # m  per sekund mellom påfølgende bilder
ODO_R = np.radians(flagg('odor', 0.15))
DYP = flagg('dyp', 0.05)           # m  — dybdeprior (svak: LiDAR har egen bias, §105b)
TOL = flagg('tol', 30.0)           # px — trekk må havne så nær der ARKit+dybde spår
CACHE = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'bildebinding-' + os.path.basename(B))
os.makedirs(CACHE, exist_ok=True)
TREKK = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--trekk=')), None)

kfs = json.load(open(f'{B}/frames.json'))
kfs.sort(key=lambda k: k['timestamp'])
if any(a.startswith('--utelat=') for a in sys.argv):   # §110: gjem hvert n-te bilde (relokaliseringstest)
    kfs = [k for i, k in enumerate(kfs) if i % int(flagg('utelat', 3))]
N = len(kfs)
T = np.array([k['timestamp'] for k in kfs]); T -= T[0]
M0 = np.stack([np.array(k['transform'], float).reshape(4, 4).T for k in kfs])   # kamera→verden
LW, LH = 1920, 1080

def K_luma(k):
    fx, fy, cx, cy = k['intrinsics']; s = LW / k['width']
    return fx * s, fy * s, cx * s, cy * s

def luma(k):
    d = np.fromfile(f"{B}/luma-{k['index']}.u8", dtype=np.uint8, offset=8)
    return d.reshape(LH, LW)

def depth(k):
    return np.fromfile(f"{B}/{k['depthFile']}", dtype=np.float32).reshape(k['depthHeight'], k['depthWidth'])

def sample_depth(k, D, u, v):
    # u, v i luma-piksler → dybde (nærmeste, ingen interpolasjon over kanter)
    s = k['depthWidth'] / LW
    x = np.clip((u * s).astype(int), 0, k['depthWidth'] - 1); y = np.clip((v * s).astype(int), 0, k['depthHeight'] - 1)
    z = D[y, x].astype(float)
    # forkast over dybdesprang: 3×3-nabolaget må være innen 5 %
    ok = np.isfinite(z) & (z > 0.2) & (z < 5)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        zn = D[np.clip(y + dy, 0, k['depthHeight'] - 1), np.clip(x + dx, 0, k['depthWidth'] - 1)]
        ok &= np.abs(zn - z) < 0.05 * z
    return z, ok

def lift(k, M, u, v, z):
    fx, fy, cx, cy = K_luma(k)
    Pc = np.stack([(u - cx) / fx * z, -(v - cy) / fy * z, -z, np.ones_like(z)], -1)
    return (Pc @ M.T)[:, :3]

def project(k, M, X):
    fx, fy, cx, cy = K_luma(k)
    Mi = np.linalg.inv(M); Pc = X @ Mi[:3, :3].T + Mi[:3, 3]
    z = -Pc[:, 2]
    return np.stack([fx * Pc[:, 0] / z + cx, -fy * Pc[:, 1] / z + cy], -1), z

# ── 1. Trekk ────────────────────────────────────────────────────────────────────────────
t0 = time.time()
sift = cv2.SIFT_create(nfeatures=5000, contrastThreshold=0.02)
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
F = []
for k in kfs:
    if TREKK:   # trekk fra GPU-SIFT (MeshSift.swift via kommandolinja), §108
        b = open(f"{TREKK}/f{k['index']}.bin", 'rb').read(); n = int(np.frombuffer(b[:4], np.int32)[0])
        F.append((np.frombuffer(b[4:4 + 8 * n], np.float32).reshape(n, 2),
                  np.frombuffer(b[4 + 8 * n:], np.uint8).reshape(n, 128).astype(np.float32))); continue
    p = f"{CACHE}/f{k['index']}.npz"
    if os.path.exists(p):
        z = np.load(p); F.append((z['xy'], z['d'])); continue
    kp, d = sift.detectAndCompute(clahe.apply(luma(k)), None)
    xy = np.array([q.pt for q in kp], np.float32).reshape(-1, 2); d = d if d is not None else np.zeros((0, 128), np.float32)
    np.savez(p, xy=xy, d=d); F.append((xy, d))
print(f"trekk: {sum(len(f[0]) for f in F)} i {N} bilder, {time.time()-t0:.0f} s")

# ── 2. Par: overlapp via dybde + ARKit-poser ────────────────────────────────────────────
Ds = [depth(k) for k in kfs]
grid = []
for i, k in enumerate(kfs):
    ys, xs = np.mgrid[8:LH:60, 8:LW:60]; u = xs.ravel().astype(float); v = ys.ravel().astype(float)
    z, ok = sample_depth(k, Ds[i], u, v)
    grid.append(lift(k, M0[i], u[ok], v[ok], z[ok]))
par = []
for i in range(N):
    for j in range(i + 1, N):
        X = grid[i]
        if len(X) < 20: continue
        uv, z = project(kfs[j], M0[j], X)
        inn = (z > 0.2) & (uv[:, 0] > 0) & (uv[:, 0] < LW) & (uv[:, 1] > 0) & (uv[:, 1] < LH)
        if inn.mean() < 0.25: continue
        zj, okj = sample_depth(kfs[j], Ds[j], uv[inn, 0], uv[inn, 1])
        synlig = (okj & (np.abs(zj - z[inn]) < 0.1 + 0.03 * z[inn])).sum() / len(X)
        # vinkel mellom synsretningene — for skrått gir SIFT søppel
        ci = M0[i][:3, 2]; cj = M0[j][:3, 2]
        if synlig > 0.25 and ci @ cj > np.cos(np.radians(50)):
            par.append((i, j, synlig))
kryss = [p for p in par if T[p[1]] - T[p[0]] >= GAP]
print(f"par: {len(par)} ({len(kryss)} kryss, Δt ≥ {GAP:.0f} s)")

# ── 3. Matching med spådd posisjon som filter ───────────────────────────────────────────
bf = cv2.BFMatcher(cv2.NORM_L2)
obs = []   # (i, j, ui, vi, uj, vj, zi, zj_ok)
for (i, j, _) in par:
    (xi, di), (xj, dj) = F[i], F[j]
    if len(xi) < 10 or len(xj) < 10: continue
    m = bf.knnMatch(di, dj, k=2)
    good = [a for a, b in (mm for mm in m if len(mm) == 2) if a.distance < 0.8 * b.distance]
    if len(good) < 12: continue
    qi = np.array([g.queryIdx for g in good]); qj = np.array([g.trainIdx for g in good])
    ui, vi = xi[qi, 0].astype(float), xi[qi, 1].astype(float)
    uj, vj = xj[qj, 0].astype(float), xj[qj, 1].astype(float)
    zi, oki = sample_depth(kfs[i], Ds[i], ui, vi)
    Xw = lift(kfs[i], M0[i], ui, vi, zi)
    pj, zp = project(kfs[j], M0[j], Xw)
    err = np.hypot(pj[:, 0] - uj, pj[:, 1] - vj)
    keep = oki & (zp > 0.2) & (err < TOL)
    if keep.sum() < 12: continue
    # geometrisk sjekk uavhengig av dybden: fundamentalmatrise
    Fm, inl = cv2.findFundamentalMat(np.c_[ui[keep], vi[keep]], np.c_[uj[keep], vj[keep]], cv2.FM_RANSAC, 2.0, 0.999)
    if inl is None: continue
    idx = np.nonzero(keep)[0][inl.ravel() > 0]
    if len(idx) < 12: continue
    for a in idx:
        obs.append((i, j, ui[a], vi[a], uj[a], vj[a], zi[a], qi[a], qj[a]))
obs = np.array(obs)
if any(a.startswith('--obs=') for a in sys.argv):   # treff fra Swift-porten (MeshBildebinding.dumpObs)
    o_ = np.fromfile(next(a.split('=', 1)[1] for a in sys.argv if a.startswith('--obs=')), np.float64).reshape(-1, 9)
    pos = {k['index']: f for f, k in enumerate(kfs)}
    o_[:, 0] = [pos[int(x)] for x in o_[:, 0]]; o_[:, 1] = [pos[int(x)] for x in o_[:, 1]]
    obs = o_
print(f"matcher: {len(obs)} etter filter, {time.time()-t0:.0f} s")

pi_, pj_ = obs[:, 0].astype(int), obs[:, 1].astype(int)
erkryss = (T[pj_] - T[pi_]) >= GAP
# holdt ute: hvert tredje kryss-par (per par, ikke per match)
parid = pi_ * N + pj_
upar = np.unique(parid[erkryss])
hold_par = set(upar[::3].tolist())
hold = np.array([p in hold_par for p in parid])
fit = ~hold
# «Flere runder = mindre sloss?» (§112): løs med bare en andel av de ikke-holdte kryssparene.
# Holdt-ute-settet er det samme i alle armer, så tallene kan sammenlignes direkte.
ANDEL = flagg('kryssandel', 1.0)
if ANDEL < 1.0:
    fitpar = np.setdiff1d(upar, upar[::3])
    rng = np.random.default_rng(int(flagg('frø', 1)))
    bort = set(rng.permutation(fitpar)[:int(round(len(fitpar) * (1 - ANDEL)))].tolist())
    fit &= ~np.array([p in bort for p in parid])
    print(f"kryssandel {ANDEL:.2f}: {len(fitpar) - len(bort)} av {len(fitpar)} kryss-par i løsningen")

def rodrigues(w):
    th = np.linalg.norm(w)
    if th < 1e-12: return np.eye(3)
    k = w / th; Kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * Kx + (1 - np.cos(th)) * Kx @ Kx

def apply(M, d):
    D = np.eye(4); D[:3, :3] = rodrigues(d[:3]); D[:3, 3] = d[3:]
    return M @ D

def F_from(Mi, Mj, ki, kj):
    # fundamentalmatrise fra posene (luma-piksler, bildets y ned)
    def Km(k):
        fx, fy, cx, cy = K_luma(k); return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])
    # ARKit-kamera (x h, y opp, −z fram) → bilde-kamera (x h, y ned, z fram)
    C = np.diag([1, -1, -1])
    Rij = np.linalg.inv(Mj) @ Mi            # i-kamera → j-kamera
    R = C @ Rij[:3, :3] @ C; t = C @ Rij[:3, 3]
    tx = np.array([[0, -t[2], t[1]], [t[2], 0, -t[0]], [-t[1], t[0], 0]])
    return np.linalg.inv(Km(kj)).T @ tx @ R @ np.linalg.inv(Km(ki))

KDcur = np.zeros(3)
def und(k, u, v):
    # fjern den løste linseforvrengningen (fastpunkt-iterasjon)
    fx, fy, cx, cy = K_luma(k); xd = (u - cx) / fx; yd = (v - cy) / fy; xn, yn = xd.copy(), yd.copy()
    for _ in range(8):
        r2 = xn * xn + yn * yn; g = (1 + KDcur[2]) * (1 + KDcur[0] * r2 + KDcur[1] * r2 * r2); xn, yn = xd / g, yd / g
    return xn * fx + cx, yn * fy + cy

def epipolar(M, sel):
    out = []
    for p in np.unique(parid[sel]):
        s = sel & (parid == p); i, j = p // N, p % N
        Fm = F_from(M[i], M[j], kfs[i], kfs[j])
        x1 = np.c_[np.stack(und(kfs[i], obs[s, 2], obs[s, 3]), 1), np.ones(s.sum())]; x2 = np.c_[np.stack(und(kfs[j], obs[s, 4], obs[s, 5]), 1), np.ones(s.sum())]
        l2 = x1 @ Fm.T; l1 = x2 @ Fm
        e = np.abs((x2 * l2).sum(1))
        out.append(0.5 * (e / np.hypot(l2[:, 0], l2[:, 1]) + e / np.hypot(l1[:, 0], l1[:, 1])))
    return np.concatenate(out) if out else np.zeros(0)

def reproj_pair(M, sel):
    # løft med i sin dybde og kast inn i j — det som faktisk gir dobbeltbilder i baken
    out = []
    for p in np.unique(parid[sel]):
        s = sel & (parid == p); i, j = p // N, p % N
        ui, vi = und(kfs[i], obs[s, 2], obs[s, 3]); uj, vj = und(kfs[j], obs[s, 4], obs[s, 5])
        X = lift(kfs[i], M[i], ui, vi, obs[s, 6]); uv, _ = project(kfs[j], M[j], X)
        out.append(np.hypot(uv[:, 0] - uj, uv[:, 1] - vj))
    return np.concatenate(out) if out else np.zeros(0)

def rapport(M, navn):
    for lbl, sel in (('kryss holdt ute', hold), ('kryss løst', fit & erkryss), ('nabo løst', fit & ~erkryss)):
        e = epipolar(M, sel); r = reproj_pair(M, sel)
        if len(e): print(f"  {navn:6s} {lbl:16s} epipolar median {np.median(e):5.2f} px p90 {np.percentile(e,90):5.2f} · løft+kast median {np.median(r):5.2f} p90 {np.percentile(r,90):5.2f} (n={sel.sum()})")

print("Før (rå ARKit):"); rapport(M0, 'før')

# ── 4. Spor (union-find over trekk) → landemerker ──────────────────────────────────────
par_ = {}
def finn(a):
    while par_.setdefault(a, a) != a:
        par_[a] = par_[par_[a]]; a = par_[a]
    return a
for o in obs[fit]:
    a = finn((int(o[0]), int(o[7]))); b = finn((int(o[1]), int(o[8])))
    if a != b: par_[a] = b
spor = {}
for o in obs[fit]:
    for (fi, fq, u, v) in ((int(o[0]), int(o[7]), o[2], o[3]), (int(o[1]), int(o[8]), o[4], o[5])):
        spor.setdefault(finn((fi, fq)), {})[fi] = (u, v, fq)   # ett trekk per bilde per spor
sporl = [s for s in spor.values() if len(s) >= 2]
L = len(sporl)
ob_f, ob_l, ob_u, ob_v, ob_z, ob_zok, ob_q = [], [], [], [], [], [], []
for li, s in enumerate(sporl):
    for fi, (u, v, fq) in s.items():
        z, ok = sample_depth(kfs[fi], Ds[fi], np.array([u]), np.array([v]))
        ob_f.append(fi); ob_l.append(li); ob_u.append(u); ob_v.append(v); ob_z.append(z[0]); ob_zok.append(ok[0]); ob_q.append(fq)
ob_f = np.array(ob_f); ob_l = np.array(ob_l); ob_u = np.array(ob_u); ob_v = np.array(ob_v)
ob_z = np.array(ob_z); ob_zok = np.array(ob_zok); ob_q = np.array(ob_q)
X0 = np.zeros((L, 3)); cnt = np.zeros(L)
for f in range(N):
    s = (ob_f == f) & ob_zok
    if s.any():
        np.add.at(X0, ob_l[s], lift(kfs[f], M0[f], ob_u[s], ob_v[s], ob_z[s])); np.add.at(cnt, ob_l[s], 1)
ok_l = cnt > 0
X0[ok_l] /= cnt[ok_l, None]
# landemerker uten dybde i noe bilde: dropp
keep_o = ok_l[ob_l]
ob_f, ob_l, ob_u, ob_v, ob_z, ob_zok, ob_q = ob_f[keep_o], ob_l[keep_o], ob_u[keep_o], ob_v[keep_o], ob_z[keep_o], ob_zok[keep_o], ob_q[keep_o]
# komprimer: landemerker uten observasjoner gir nullkolonner, og x_scale=np.full(len(x0), 0.01) låser da hele
# løsningen (0daef323: null steg, 2026-10-19)
brukt, ob_l = np.unique(ob_l, return_inverse=True); X0 = X0[brukt]; L = len(brukt); ok_l = np.ones(L, bool)
print(f"landemerker: {ok_l.sum()} med {len(ob_f)} observasjoner")

# ── 5. Bundle adjustment ───────────────────────────────────────────────────────────────
KK = np.array([K_luma(k) for k in kfs])
NK = 3   # felles linsemodell: k1, k2 (radiell) og brennviddeskala — ARKit oppgir ingen forvrengning
def unpack(x):
    return x[:6 * N].reshape(N, 6), x[6 * N:6 * N + 3 * L].reshape(L, 3), x[6 * N + 3 * L:]

def poses(dl):
    th = np.linalg.norm(dl[:, :3], axis=1, keepdims=True); k = dl[:, :3] / np.maximum(th, 1e-12)
    Kx = np.zeros((N, 3, 3)); Kx[:, 0, 1] = -k[:, 2]; Kx[:, 0, 2] = k[:, 1]; Kx[:, 1, 0] = k[:, 2]
    Kx[:, 1, 2] = -k[:, 0]; Kx[:, 2, 0] = -k[:, 1]; Kx[:, 2, 1] = k[:, 0]
    s_ = np.sin(th)[:, :, None]; c_ = (1 - np.cos(th))[:, :, None]
    D = np.tile(np.eye(4), (N, 1, 1)); D[:, :3, :3] = np.eye(3) + s_ * Kx + c_ * Kx @ Kx; D[:, :3, 3] = dl[:, 3:]
    return M0 @ D
REL0I = np.linalg.inv(np.linalg.inv(M0[:-1]) @ M0[1:])
SDT = np.sqrt(np.maximum(np.diff(T), 0.05))

# Levenberg–Marquardt med Schur-komplement (landemerkene elimineres blokkvis, 3×3).
# scipy.least_squares var for treg (300 kall uten konvergens) og låste seg helt med
# x_scale='jac' på 0daef323. Dette er standardoppsettet for bundle adjustment, og det er
# det som skal porteres til Swift.
HUB = 3.0                    # Huber-terskel i σ
NP = 6 * N + NK              # pose- og linseukjente (tett blokk)
idx_obs = np.arange(len(ob_f))
zw = np.where(ob_zok, 1.0 / (DYP + 0.01 * np.nan_to_num(ob_z, nan=1.0)), 0.0)

def proj(Pc, kd, f):
    z = -Pc[:, 2]; zs = np.maximum(z, 0.05)
    fx, fy, cx, cy = KK[f].T
    xn = Pc[:, 0] / zs; yn = -Pc[:, 1] / zs; r2 = xn * xn + yn * yn
    g = (1 + kd[2]) * (1 + kd[0] * r2 + kd[1] * r2 * r2)
    return np.stack([fx * xn * g + cx, fy * yn * g + cy], -1), z

def obs_res(M, X, kd):
    Mi = np.linalg.inv(M)
    Pc = np.einsum('nij,nj->ni', Mi[ob_f, :3, :3], X[ob_l]) + Mi[ob_f, :3, 3]
    uv, z = proj(Pc, kd, ob_f)
    r = np.stack([(uv[:, 0] - ob_u) / SIG_PX, (uv[:, 1] - ob_v) / SIG_PX, np.where(ob_zok, (z - np.nan_to_num(ob_z)) * zw, 0.0)], -1)
    return r, Pc, Mi

def prior_res(dl, M, kd):
    ra = np.c_[dl[:, :3] / ANK_R, dl[:, 3:] / ANK_T]
    Mi = np.linalg.inv(M)
    E = np.einsum('nij,njk->nik', REL0I, Mi[:-1] @ M[1:])
    w = np.stack([E[:, 2, 1] - E[:, 1, 2], E[:, 0, 2] - E[:, 2, 0], E[:, 1, 0] - E[:, 0, 1]], -1) / 2
    ro = np.c_[w / (ODO_R * SDT[:, None]), E[:, :3, 3] / (ODO_T * SDT[:, None])]
    return ra, ro, kd[:2] / 0.2

def huber_w(r):
    a = np.abs(r); return np.where(a <= HUB, 1.0, HUB / np.maximum(a, 1e-12))

def kost(dl, X, kd):
    M = poses(dl); r, _, _ = obs_res(M, X, kd); ra, ro, rk = prior_res(dl, M, kd)
    a = np.abs(r); ro_ = np.where(a <= HUB, a * a, 2 * HUB * a - HUB * HUB)
    return 0.5 * (ro_.sum() + (ra ** 2).sum() + (ro ** 2).sum() + (rk ** 2).sum())

def skew(v):
    Z = np.zeros(v.shape[:-1] + (3, 3))
    Z[..., 0, 1] = -v[..., 2]; Z[..., 0, 2] = v[..., 1]; Z[..., 1, 0] = v[..., 2]
    Z[..., 1, 2] = -v[..., 0]; Z[..., 2, 0] = -v[..., 1]; Z[..., 2, 1] = v[..., 0]
    return Z

from scipy.sparse import csr_matrix, bsr_matrix
def ba(dl, X, kd, iters):
    lam = 1e-3
    c0 = kost(dl, X, kd)
    for it in range(iters):
        M = poses(dl); r, Pc, Mi = obs_res(M, X, kd)
        # d(res)/d(Pc) og d(res)/d(linse) numerisk, vektorisert over alle observasjoner
        eps = 1e-6
        dRdP = np.zeros((len(ob_f), 3, 3))
        for c in range(3):
            P2 = Pc.copy(); P2[:, c] += eps
            uv, z = proj(P2, kd, ob_f)
            r2 = np.stack([(uv[:, 0] - ob_u) / SIG_PX, (uv[:, 1] - ob_v) / SIG_PX, np.where(ob_zok, (z - np.nan_to_num(ob_z)) * zw, 0.0)], -1)
            dRdP[:, :, c] = (r2 - r) / eps
        dRdK = np.zeros((len(ob_f), 3, NK))
        for c in range(NK):
            k2 = kd.copy(); k2[c] += eps; uv, z = proj(Pc, k2, ob_f)
            dRdK[:, 0, c] = (uv[:, 0] - ob_u) / SIG_PX - r[:, 0]; dRdK[:, 1, c] = (uv[:, 1] - ob_v) / SIG_PX - r[:, 1]
        dRdK[:, :2] /= eps
        # Pc = Rᵀ(X − c); høyreperturbasjon M·Exp(ω, v): dPc/dω = [Pc]×, dPc/dv = −I, dPc/dX = Rᵀ
        Jw = dRdP @ skew(Pc); Jv = -dRdP; Jl = dRdP @ Mi[ob_f, :3, :3]
        Jp = np.concatenate([Jw, Jv, dRdK], 2)           # (n, 3, 6+NK)
        W = huber_w(r)                                    # (n, 3)
        # tett pose/linse-blokk
        cols = np.concatenate([6 * ob_f[:, None] + np.arange(6)[None], np.broadcast_to(6 * N + np.arange(NK), (len(ob_f), NK))], 1)  # (n, 6+NK)
        JpW = Jp * W[:, :, None]
        Hb = np.einsum('nri,nrj->nij', JpW, Jp)          # (n, 9, 9)
        Hpp = np.zeros((NP, NP))
        np.add.at(Hpp, (cols[:, :, None], cols[:, None, :]), Hb)
        gp = np.zeros(NP); np.add.at(gp, cols, np.einsum('nri,nr->ni', JpW, r))
        Hll = np.zeros((L, 3, 3)); np.add.at(Hll, ob_l, np.einsum('nri,nrj->nij', Jl * W[:, :, None], Jl))
        gl = np.zeros((L, 3)); np.add.at(gl, ob_l, np.einsum('nri,nr->ni', Jl * W[:, :, None], r))
        Hpl_b = np.einsum('nri,nrj->nij', JpW, Jl)       # (n, 9, 3)
        rows = np.repeat(cols, 3, axis=1).ravel()
        lc = (3 * ob_l[:, None] + np.arange(3)[None])
        colsl = np.tile(lc, (1, 6 + NK)).ravel()
        Hpl = csr_matrix((Hpl_b.reshape(len(ob_f), -1).ravel(), (rows, colsl)), shape=(NP, 3 * L))
        # priorledd: numerisk Jacobi, partall/oddetall-bilder hver for seg (odometrien kobler naboer)
        ra, ro, rk = prior_res(dl, M, kd)
        Jo = np.zeros((N - 1, 6, 12)); Ja = np.zeros((N, 6, 6))
        for par_ in (0, 1):
            for c in range(6):
                d2 = dl.copy(); d2[par_::2, c] += eps
                ra2, ro2, _ = prior_res(d2, poses(d2), kd)
                Ja[par_::2, :, c] = (ra2 - ra)[par_::2] / eps
                dro = (ro2 - ro) / eps
                # par f: δ_f er kolonne c, δ_{f+1} er kolonne 6+c
                Jo[par_::2, :, c] = dro[par_::2]
                Jo[(1 - par_)::2, :, 6 + c] = dro[(1 - par_)::2]
        for f in range(N):
            sl = slice(6 * f, 6 * f + 6)
            Hpp[sl, sl] += Ja[f].T @ Ja[f]; gp[sl] += Ja[f].T @ ra[f]
        for f in range(N - 1):
            sl = slice(6 * f, 6 * f + 12)
            Hpp[sl, sl] += Jo[f].T @ Jo[f]; gp[sl] += Jo[f].T @ ro[f]
        for c in range(2):
            Hpp[6 * N + c, 6 * N + c] += 1 / 0.04; gp[6 * N + c] += rk[c] / 0.2
        while True:
            A = Hpp + lam * np.diag(np.diag(Hpp) + 1e-9)
            Hl = Hll + lam * (Hll * np.eye(3)[None]) + 1e-9 * np.eye(3)[None]
            Dinv = np.linalg.inv(Hl)
            Dsp = bsr_matrix((Dinv, np.arange(L), np.arange(L + 1)), shape=(3 * L, 3 * L)).tocsr()
            HD = Hpl @ Dsp
            S_ = A - (HD @ Hpl.T).toarray()
            rhs = -gp + HD @ gl.ravel()
            dp = np.linalg.solve(S_, rhs)
            dlm = -(Dinv @ (gl + (Hpl.T @ dp).reshape(L, 3))[:, :, None])[:, :, 0]
            dl2 = dl + dp[:6 * N].reshape(N, 6); kd2 = kd + dp[6 * N:]; X2 = X + dlm
            c1 = kost(dl2, X2, kd2)
            if c1 < c0:
                dl, X, kd = dl2, X2, kd2; rel = (c0 - c1) / c0; c0 = c1; lam = max(lam / 3, 1e-7); break
            lam *= 5
            if lam > 1e6: return dl, X, kd, c0, it
        if rel < 1e-5: return dl, X, kd, c0, it + 1
    return dl, X, kd, c0, iters

t1 = time.time()
dl, X, KD, kost_slutt, nit = ba(np.zeros((N, 6)), X0.copy(), np.zeros(NK), int(flagg('iter', 40)))
M1 = poses(dl)
print(f"linse: k1 {KD[0]:+.4f} k2 {KD[1]:+.4f} brennvidde {KD[2]*100:+.2f} %")
print(f"BA: {time.time()-t1:.0f} s, {nit} runder, kost {kost_slutt:.0f}")

KDcur = KD
print("Etter:"); rapport(M1, 'etter')
if '--runder' in sys.argv:
    # Hvor mange passeringer løsningen har sett hvert bilde i: tidsklynger (brudd ≥ GAP) blant
    # bildet selv og partnerne det har løste treff med. Holdt-ute-feilen bøttes på det minste
    # tallet av de to bildene i paret.
    partner = [set([f]) for f in range(N)]
    for p in np.unique(parid[fit]):
        partner[p // N].add(p % N); partner[p % N].add(p // N)
    runder = np.array([1 + int((np.diff(np.sort(T[list(s)])) >= GAP).sum()) for s in partner])
    hp = np.unique(parid[hold])
    for lbl, M in (('før', M0), ('etter', M1)):
        b = {}
        for p in hp:
            s = hold & (parid == p); e = epipolar(M, s)
            b.setdefault(min(runder[p // N], runder[p % N], 4), []).append(e)
        print(f"  {lbl:6s} holdt ute per runder: " + ' · '.join(
            f"{r}{'+' if r == 4 else ''}: median {np.median(np.concatenate(v)):.2f} px ({len(v)} par)" for r, v in sorted(b.items())))
flytt = np.linalg.norm(M1[:, :3, 3] - M0[:, :3, 3], axis=1)
rot = np.degrees(np.linalg.norm(dl[:, :3], axis=1))
nobs_f = np.bincount(ob_f, minlength=N)
for f in np.argsort(-flytt)[:5]:
    print(f"  kf {kfs[f]['index']:3d} t={T[f]:5.1f}s flytt {flytt[f]*1000:4.0f} mm rot {rot[f]:.2f}° obs {nobs_f[f]}")
print(f"flytt kamera: median {np.median(flytt)*1000:.0f} mm, maks {flytt.max()*1000:.0f} mm (ved {T[flytt.argmax()]:.0f} s); rotasjon median {np.median(rot):.2f}°, maks {rot.max():.2f}°")

DUMP = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--dump=')), None)
if DUMP:   # driftmodell: hva skilte stegene der bindingen måtte rette ARKit mye
    np.savez(DUMP, M0=M0, M1=M1, T=T, index=np.array([k['index'] for k in kfs]), nobs=nobs_f)
KART = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--kart=')), None)
if KART:   # §110: landemerkene som relokaliseringskart — enige med de bundne posene, ikke med LiDAR
    np.savez(KART, X=X, l=ob_l, index=np.array([kfs[f]['index'] for f in ob_f]), q=ob_q)
    print(f"kart: {len(X)} landemerker, {len(ob_l)} observasjoner → {KART}")

if UT:
    import shutil
    UT = UT.rstrip('/')
    if os.path.exists(UT): shutil.rmtree(UT)
    os.makedirs(UT)
    for n in os.listdir(B):
        if n in ('frames.json', 'fixture-kf.json', 'dense.jsonl', 'harness-done.txt') or n.endswith('.glb') or n.startswith('loop-poser'): continue
        os.symlink(os.path.join(B, n), os.path.join(UT, n))
    ny = {k['index']: M1[f] for f, k in enumerate(kfs)}
    for fn in ('frames.json', 'fixture-kf.json'):
        fr = json.load(open(f'{B}/{fn}'))
        for k in fr: k['transform'] = ny[k['index']].T.ravel().tolist()
        json.dump(fr, open(f'{UT}/{fn}', 'w'))
    # dybdekart: verdenskorreksjon D = M1·M0⁻¹, lineært i tid mellom nabo-nøkkelbilder
    Dw = np.stack([M1[f] @ np.linalg.inv(M0[f]) for f in range(N)])
    tk = np.array([k['timestamp'] for k in kfs])
    def rotvec(R):
        th = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
        if th < 1e-9: return np.zeros(3)
        return th / (2 * np.sin(th)) * np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    RV = np.stack([rotvec(Dw[f][:3, :3]) for f in range(N)])
    with open(f'{UT}/dense.jsonl', 'w') as f:
        for l in open(f'{B}/dense.jsonl'):
            if not l.strip(): continue
            m = json.loads(l); Md = np.array(m['m'], float).reshape(4, 4).T
            a = np.searchsorted(tk, m['t']); a = min(max(a, 1), N - 1)
            w = np.clip((m['t'] - tk[a - 1]) / max(tk[a] - tk[a - 1], 1e-3), 0, 1)
            # korreksjonene er små (< 1°): rotasjonsvektor og flytt interpoleres lineært
            Dd = np.eye(4); Dd[:3, :3] = rodrigues((1 - w) * RV[a - 1] + w * RV[a])
            Dd[:3, 3] = (1 - w) * Dw[a - 1][:3, 3] + w * Dw[a][:3, 3]
            m['m'] = (Dd @ Md).T.ravel().round(6).tolist(); f.write(json.dumps(m) + '\n')
    json.dump({'k1': float(KD[0]), 'k2': float(KD[1]), 'fs': float(KD[2])}, open(f'{UT}/linse.json', 'w'))
    print(f"skrev {UT}")
