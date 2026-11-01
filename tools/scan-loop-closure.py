#!/usr/bin/env python3
# Loop closure for et skann-bundle: én samlet poseløsning over ALLE dybdekart (dense.jsonl),
# der passeringer som ser samme flate med tidsavstand blir bundet sammen punkt-mot-plan.
# Prototype for SKANN_BESLUTNINGER §104–: mål og løs her, port til Swift når tallene holder.
#
#   python3 tools/scan-loop-closure.py <bundleDir> [--skriv]
#
# Ukjente: liten korreksjon per kart i verdensrammen (ω, v): p' = p + ω×p + v.
# Ledd:  (1) punkt-mot-plan mellom kartpar med Δt ≥ GAP (projektiv assosiasjon, Huber),
#        (2) odometri: korreksjonen skal variere glatt langs tida (ARKit er god lokalt),
#        (3) kart 0 holdes fast (gauge).
# Hvert tredje par holdes UTENFOR løsningen og brukes bare til å måle — ellers måler vi
# bare at løseren har tilpasset seg sine egne punkter.
#
# Med --skriv: loop-poser.jsonl i bundlen ({"i","t","m"} per dybdekart, {"kf","t","m"} per
# nøkkelbilde, m kolonne-major som dense.jsonl).
import json, os, sys, math, time
import numpy as np

B = sys.argv[1]; SKRIV = '--skriv' in sys.argv
GAP = 3.0            # s — par nærmere i tid enn dette dekkes av odometrien
STEP = 4             # px — samplingsgrid i 256×144-kartet
ZMIN, ZMAX = 0.3, 4.0
HUBER = 0.01         # m
SIG_PT = 0.01        # m  — støy per korrespondanse
SIG_ODO_T = 0.001    # m  per kartsteg
SIG_ODO_R = 0.0005   # rad per kartsteg
PAR_PER_KART = 8
# Svak forankring mot ARKit per kart (§105): punkt-mot-plan ser bare avstanden til flatene.
# Langs en flat vegg har løsningen null kostnad og skled 3–5 cm sidelengs (tre kopier av
# bilderammen). Ankeret er så svakt at der dybden SER feilen vinner dybden; der den er blind
# blir ARKit stående — og ARKit er god langs veggen.
SIG_ANK_T = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--anker=')), '0.03'))
SIG_ANK_R = SIG_ANK_T / 2.0
RUNDER = 20

meta = [json.loads(l) for l in open(f'{B}/dense.jsonl') if l.strip()]
meta = [m for m in meta if os.path.exists(f"{B}/dense-{m['i']}.f32")]
N = len(meta); t0 = meta[0]['t']
T = np.array([m['t'] - t0 for m in meta])
M0 = np.stack([np.array(m['m'], float).reshape(4, 4).T for m in meta])
W, H = meta[0]['w'], meta[0]['h']

# Kamerapunkter og normaler per kart (kamerarammen, ARKit: x høyre, y opp, −z fram)
Pc = []; Nc = []; Dimg = []
ys, xs = np.mgrid[0:H, 0:W]
for m in meta:
    d = np.fromfile(f"{B}/dense-{m['i']}.f32", dtype=np.float32).reshape(H, W).astype(np.float64)
    d[(d < ZMIN) | (d > ZMAX) | ~np.isfinite(d)] = np.nan
    P = np.stack([(xs - m['cx']) / m['fx'] * d, -(ys - m['cy']) / m['fy'] * d, -d], -1)
    dx = np.full_like(P, np.nan); dy = np.full_like(P, np.nan)
    dx[:, 1:-1] = P[:, 2:] - P[:, :-2]; dy[1:-1] = P[2:] - P[:-2]
    n = np.cross(dx, dy); nl = np.linalg.norm(n, axis=-1, keepdims=True)
    n = n / nl
    # kast normaler over dybdesprang (kanter gir falske plan)
    with np.errstate(all='ignore'): jump = np.nanmax(np.abs(np.stack([dx[..., 2], dy[..., 2]])), axis=0) > 0.05 * np.nan_to_num(d, nan=1)
    n[jump] = np.nan
    flip = (n * P).sum(-1) > 0; n[flip] *= -1   # mot kameraet
    Pc.append(P); Nc.append(n); Dimg.append(d)
Pc = np.stack(Pc); Nc = np.stack(Nc)
K = np.array([[m['fx'], m['fy'], m['cx'], m['cy']] for m in meta])

def samples(k, off=0):
    P = Pc[k, off::STEP, off::STEP].reshape(-1, 3); n = Nc[k, off::STEP, off::STEP].reshape(-1, 3)
    ok = np.isfinite(P).all(1) & np.isfinite(n).all(1)
    return P[ok], n[ok]

S = [samples(k) for k in range(N)]
SE = [samples(k, 2) for k in range(N)]   # forskjøvet grid til måling

def world(M, P): return P @ M[:3, :3].T + M[:3, 3]

def assoc(Mi, Mj, i, j, src):
    """Punktene til j (src) inn i kart i. Returnerer (p_j verden, q_i verden, n_i verden)."""
    Pj, _ = src[j]
    pw = world(Mj, Pj)
    Ri = Mi[:3, :3]; ti = Mi[:3, 3]
    pc = (pw - ti) @ Ri               # verden → kamera i
    z = -pc[:, 2]; ok = z > ZMIN
    fx, fy, cx, cy = K[i]
    u = np.round(pc[:, 0] / np.maximum(z, 1e-6) * fx + cx).astype(int)
    v = np.round(-pc[:, 1] / np.maximum(z, 1e-6) * fy + cy).astype(int)
    ok &= (u >= 1) & (u < W - 1) & (v >= 1) & (v < H - 1)
    u, v, pw, z = u[ok], v[ok], pw[ok], z[ok]
    q = Pc[i, v, u]; n = Nc[i, v, u]
    good = np.isfinite(q).all(1) & np.isfinite(n).all(1)
    good &= np.abs(-q[:, 2] - z) < 0.10
    q, n, pw = q[good], n[good], pw[good]
    return pw, world(Mi, q), n @ Ri.T

def overlap(Mi, Mj, i, j):
    pw, q, n = assoc(Mi, Mj, i, j, S)
    return len(pw) / max(1, len(S[j][0]))

# --- Kandidatpar: tidsavstand ≥ GAP, nære kamerasentre, overlapp i projeksjon -------------
c_w = np.array([world(M0[k], S[k][0]).mean(0) if len(S[k][0]) else M0[k][:3, 3] for k in range(N)])
fwd = -M0[:, :3, 2]
pairs = []
for j in range(N):
    cand = []
    for i in range(N):
        if T[j] - T[i] < GAP: continue          # i før j, i < j i tid
        if np.linalg.norm(c_w[i] - c_w[j]) > 1.2 or fwd[i] @ fwd[j] < 0.3: continue
        ov = overlap(M0[i], M0[j], i, j)
        if ov > 0.3: cand.append((ov, i))
    cand.sort(reverse=True)
    # spre over tid: ikke åtte naboer fra samme sekund
    chosen = []
    for ov, i in cand:
        if all(abs(T[i] - T[c]) > 1.0 for c in chosen): chosen.append(i)
        if len(chosen) >= PAR_PER_KART: break
    pairs += [(i, j) for i in chosen]
hold = [p for n, p in enumerate(pairs) if n % 3 == 2]
fit = [p for n, p in enumerate(pairs) if n % 3 != 2]
print(f"{N} dybdekart over {T[-1]:.0f} s · {len(pairs)} returpar (Δt ≥ {GAP:.0f} s) · {len(fit)} løses, {len(hold)} holdes ute")

def measure(M, ps, label):
    res = []; per = []
    for i, j in ps:
        p, q, n = assoc(M[i], M[j], i, j, SE)
        if len(p) < 30: continue
        r = np.abs(((p - q) * n).sum(1)); res.append(r); per.append((T[j] - T[i], np.median(r)))
    r = np.concatenate(res); per = np.array(per)
    s = f"  {label:26s} median {np.median(r)*1000:5.1f} mm · p90 {np.percentile(r,90)*1000:5.1f} mm"
    for a, b in [(3, 10), (10, 25), (25, 1e9)]:
        sel = (per[:, 0] >= a) & (per[:, 0] < b)
        if sel.any(): s += f" · Δt {a:.0f}–{'' if b > 1e8 else int(b)}s: {np.median(per[sel,1])*1000:.1f}"
    print(s)
    return np.median(r)

def rodrigues(w):
    th = np.linalg.norm(w)
    if th < 1e-12: return np.eye(3)
    k = w / th; Kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * Kx + (1 - math.cos(th)) * Kx @ Kx

# støygulv: nabokart (0,5–1 s) — så tett i tid at ARKit-posene er gode; under dette kommer ingen
gulv = [(k, k+3) for k in range(0, N-3, 2)]
print("Støygulv (nabokart 0,7 s, rå poser):")
measure(M0, gulv, "nabokart")

# --- Fotometrisk ledd: nøkkelbildene binder glidning LANGS flatene ----------------------
# Punkt-mot-plan låser bare avstanden til en flat vegg; hvor bildet ligger langs veggen ser
# den ikke (§104). Mønster i bildet (panelspor, rammer, kontakter) gjør. Hvert nøkkelbilde
# henger på nærmeste dybdekart, så korreksjonen er den samme ukjente.
FOTO = '--uten-foto' not in sys.argv
SIG_I = 0.3          # normalisert høypass (enhetsløs)
HUBER_I = 0.6
KFS = json.load(open(f'{B}/frames.json'))
KFS = [k for k in KFS if os.path.exists(f"{B}/luma-{k['index']}.u8") and os.path.exists(f"{B}/{k['depthFile']}")]
def blur(a, r):
    if r <= 0: return a
    k = np.exp(-0.5 * (np.arange(-2*r, 2*r+1) / r) ** 2); k /= k.sum()
    a = np.apply_along_axis(lambda x: np.convolve(x, k, 'same'), 1, a)
    return np.apply_along_axis(lambda x: np.convolve(x, k, 'same'), 0, a)
def down(a, f):
    h, w = a.shape[0] // f * f, a.shape[1] // f * f
    return a[:h, :w].reshape(h // f, f, w // f, f).mean((1, 3))
LEVELS = [8, 4]      # nedskalering fra 3840 — 480×270 og 960×540
KF = []
for k in KFS:
    raw = np.frombuffer(open(f"{B}/luma-{k['index']}.u8", 'rb').read()[8:], np.uint8).reshape(1080, 1920).astype(np.float64)
    lv = {}
    for L in LEVELS:
        im = blur(down(raw, L // 2), 1.0)
        # høypass delt på lokal kontrast: glans og lysfall langs veggen (2,2× mellom ståsteder,
        # §103) forsvinner, mønsteret (spor, rammer, kanter) blir igjen
        hp = im - blur(im, 4.0); im = hp / (np.sqrt(blur(hp * hp, 4.0)) + 2.0)
        gy, gx = np.gradient(im)
        lv[L] = (im, gx, gy)
    dep = np.fromfile(f"{B}/{k['depthFile']}", dtype=np.float32).reshape(k['depthHeight'], k['depthWidth']).astype(np.float64)
    nk = int(np.argmin(np.abs(T - (k['timestamp'] - t0))))
    KF.append(dict(k=k, lv=lv, dep=dep, nk=nk, M0=np.array(k['transform'], float).reshape(4, 4).T,
                   t=k['timestamp'] - t0, K=np.array(k['intrinsics'], float)))
def kf_pose(M, e): return M[e['nk']] @ np.linalg.inv(M0[e['nk']]) @ e['M0']
def bilin(a, u, v):
    h, w = a.shape; u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int)
    ok = (u0 >= 0) & (v0 >= 0) & (u0 < w - 1) & (v0 < h - 1)
    u0 = np.clip(u0, 0, w - 2); v0 = np.clip(v0, 0, h - 2); fu = u - u0; fv = v - v0
    val = a[v0, u0] * (1-fu) * (1-fv) + a[v0, u0+1] * fu * (1-fv) + a[v0+1, u0] * (1-fu) * fv + a[v0+1, u0+1] * fu * fv
    return val, ok
def kf_points(e, L, off=0):
    """Høygradient-piksler i nøkkelbilde e på nivå L, med 3D-punkt i kamerarammen."""
    im, gx, gy = e['lv'][L]; g = np.hypot(gx, gy)
    c = 8; h, w = (g.shape[0] // c) * c, (g.shape[1] // c) * c
    gg = g[:h, :w].reshape(h // c, c, w // c, c).transpose(0, 2, 1, 3).reshape(h // c, w // c, c * c)
    am = gg.argmax(-1); mx = gg.max(-1)
    cy_, cx_ = np.mgrid[0:h // c, 0:w // c]
    if off: sel = ((cy_ + cx_) % 2 == 1)
    else: sel = ((cy_ + cx_) % 2 == 0)
    sel &= mx > 0.15
    v = (cy_ * c + am // c)[sel].astype(float); u = (cx_ * c + am % c)[sel].astype(float)
    fx, fy, cx, cy = e['K']; dh, dw = e['dep'].shape
    uf, vf = u * L, v * L                       # full oppløsning (3840×2160)
    z, ok = bilin(e['dep'], uf * dw / 3840.0, vf * dh / 2160.0)
    # kast dybdesprang: punktet må ligge på en glatt flate
    z2, _ = bilin(e['dep'], uf * dw / 3840.0 + 1.5, vf * dh / 2160.0)
    z3, _ = bilin(e['dep'], uf * dw / 3840.0, vf * dh / 2160.0 + 1.5)
    ok &= (z > ZMIN) & (z < ZMAX) & (np.abs(z2 - z) < 0.03 * z) & (np.abs(z3 - z) < 0.03 * z)
    P = np.stack([(uf - cx) / fx * z, -(vf - cy) / fy * z, -z], -1)
    return P[ok], im[v[ok].astype(int), u[ok].astype(int)]
KP = {L: [kf_points(e, L) for e in KF] for L in LEVELS}
KPE = [kf_points(e, 4, off=1) for e in KF]      # annet utvalg til måling
def photo_res(M, a, b, L, pts=None):
    """Punktene til a inn i b. Gir residual (affin lysjustert), jacobian mot (δ_a − δ_b), maske."""
    ea, eb = KF[a], KF[b]
    Pa, Ia = (pts or KP[L])[a]
    Ma, Mb = kf_pose(M, ea), kf_pose(M, eb)
    p = Pa @ Ma[:3, :3].T + Ma[:3, 3]
    Rb, tb = Mb[:3, :3], Mb[:3, 3]
    c = (p - tb) @ Rb; Z = -c[:, 2]
    fx, fy, cx, cy = eb['K']; s = 1.0 / L
    u = s * (fx * c[:, 0] / np.maximum(Z, 1e-6) + cx); v = s * (-fy * c[:, 1] / np.maximum(Z, 1e-6) + cy)
    im, gx, gy = eb['lv'][L]
    Ib, ok = bilin(im, u, v); Gx, _ = bilin(gx, u, v); Gy, _ = bilin(gy, u, v)
    ok &= Z > ZMIN
    # synlighet: punktet må ligge på b sin egen dybde (ikke bak noe)
    dh, dw = eb['dep'].shape
    zb, okd = bilin(eb['dep'], u * L * dw / 3840.0, v * L * dh / 2160.0)
    ok &= okd & (np.abs(zb - Z) < 0.06)
    if ok.sum() < 40: return None
    Ia_, Ib_ = Ia[ok], Ib[ok]
    A_ = np.stack([Ia_, np.ones_like(Ia_)], 1); al, be = np.linalg.lstsq(A_, Ib_, rcond=None)[0]
    r = Ib_ - (al * Ia_ + be)
    cc, ZZ, pp = c[ok], Z[ok], p[ok]
    # d(u,v)/d(kamerapunkt)
    du = np.stack([s * fx / ZZ, np.zeros_like(ZZ), s * fx * cc[:, 0] / ZZ**2], 1)
    dv = np.stack([np.zeros_like(ZZ), -s * fy / ZZ, -s * fy * cc[:, 1] / ZZ**2], 1)
    gc = Gx[ok, None] * du + Gy[ok, None] * dv          # dI/d(kamerapunkt)
    gw = gc @ Rb.T                                      # dI/d(verdenspunkt)
    # q = p + Δω×p + Δv  →  dq/dΔω = −[p]×,  dI/dΔω = gw·(−[p]×) = (p × gw)
    J = np.hstack([np.cross(pp, gw), gw])
    return r, J


# fotometriske par: nøkkelbilder med Δt ≥ GAP som ser det samme
fpairs = []
for b_ in range(len(KF)):
    cand = []
    for a_ in range(len(KF)):
        if KF[b_]['t'] - KF[a_]['t'] < GAP: continue
        rr = photo_res(M0, a_, b_, 8)
        if rr is not None and len(rr[0]) > 0.25 * len(KP[8][a_][0]): cand.append((len(rr[0]), a_))
    cand.sort(reverse=True); ch = []
    for n_, a_ in cand:
        if all(abs(KF[a_]['t'] - KF[c_]['t']) > 1.0 for c_ in ch): ch.append(a_)
        if len(ch) >= 6: break
    fpairs += [(a_, b_) for a_ in ch]
ffit = [p_ for n_, p_ in enumerate(fpairs) if n_ % 3 != 2]; fhold = [p_ for n_, p_ in enumerate(fpairs) if n_ % 3 == 2]
print(f"{len(KF)} nøkkelbilder · {len(fpairs)} fotometriske returpar · {len(ffit)} løses, {len(fhold)} holdes ute")
def fmeasure(M, ps, label):
    r = [np.abs(x[0]) for x in (photo_res(M, a_, b_, 4, KPE) for a_, b_ in ps) if x is not None]
    r = np.concatenate(r); print(f"  {label:26s} foto median {np.median(r):5.2f} · p90 {np.percentile(r,90):5.2f} (normalisert)")
if '--diag' in sys.argv:
    # Er returfeilen POSE eller MÅLING? Hvis LiDAR har avstands-/vinkelavhengig feil, følger
    # residualen forskjellen i avstand/innfallsvinkel mellom de to kartene — ikke tida.
    rows = []
    for i, j in pairs:
        p_, q_, n_ = assoc(M0[i], M0[j], i, j, SE)
        if len(p_) < 50: continue
        r = ((p_ - q_) * n_).sum(1)                       # + = j ligger foran i langs i sin normal
        ci, cj = M0[i][:3, 3], M0[j][:3, 3]
        di = np.linalg.norm(q_ - ci, axis=1); dj = np.linalg.norm(p_ - cj, axis=1)
        ai = np.abs(((q_ - ci) / di[:, None] * n_).sum(1)); aj = np.abs(((p_ - cj) / dj[:, None] * n_).sum(1))
        rows.append((np.median(r), np.median(dj - di), np.median(aj - ai), T[j] - T[i], np.median(di), np.median(dj)))
    R_ = np.array(rows)
    for k_, nm in [(1, 'avstand j−i'), (2, 'cos(innfall) j−i'), (3, 'Δt')]:
        c_ = np.corrcoef(R_[:, 0], R_[:, k_])[0, 1]
        print(f"  korrelasjon residual ~ {nm:16s}: {c_:+.2f}")
    # skalafeil: r ≈ s·(dj−di)?
    sl = np.polyfit(R_[:, 1], R_[:, 0], 1); print(f"  helning residual/avstandsforskjell: {sl[0]*100:+.1f} % (skalafeil i LiDAR om ≠0), konst {sl[1]*1000:+.1f} mm")
    print(f"  par: {len(R_)}, |residual| median {np.median(np.abs(R_[:,0]))*1000:.1f} mm")
print("Før:")
fmeasure(M0, fhold, "foto holdt ute")
measure(M0, fit, "løste par")
measure(M0, hold, "holdt ute (ærlig tall)")

M = M0.copy()
t_start = time.time()
for rnd in range(RUNDER):
    n6 = 6 * N
    A = np.zeros((n6, n6)); b = np.zeros(n6)
    # punkt-mot-plan
    for i, j in fit:
        p, q, n = assoc(M[i], M[j], i, j, S)
        if len(p) < 30: continue
        r0 = ((p - q) * n).sum(1)
        w = np.where(np.abs(r0) < HUBER, 1.0, HUBER / np.abs(r0)) / SIG_PT**2
        w = w / max(1.0, len(p) / 300.0)      # ett par skal ikke veie som tusen
        Jj = np.hstack([np.cross(p, n), n]); Ji = -np.hstack([np.cross(q, n), n])
        J = np.zeros((len(p), 12)); J[:, :6] = Ji; J[:, 6:] = Jj
        JW = J * w[:, None]
        Hb = J.T @ JW; gb = JW.T @ r0
        idx = np.r_[6*i:6*i+6, 6*j:6*j+6]
        A[np.ix_(idx, idx)] += Hb; b[idx] += gb
    if FOTO:
        L = 8 if rnd < RUNDER // 2 else 4
        for a_, b_ in ffit:
            rr = photo_res(M, a_, b_, L)
            if rr is None: continue
            r0, Jf = rr
            w = np.where(np.abs(r0) < HUBER_I, 1.0, HUBER_I / np.abs(r0)) / SIG_I**2
            w = w / max(1.0, len(r0) / 300.0)
            ia, ib = KF[a_]['nk'], KF[b_]['nk']
            if ia == ib: continue
            J = np.zeros((len(r0), 12)); J[:, :6] = Jf; J[:, 6:] = -Jf
            JW = J * w[:, None]
            idx = np.r_[6*ia:6*ia+6, 6*ib:6*ib+6]
            A[np.ix_(idx, idx)] += J.T @ JW; b[idx] += JW.T @ r0
    # odometri: δ_k − δ_{k+1} ≈ 0 (skalert med tidssteget)
    for k in range(N - 1):
        dt = max(1e-3, (T[k+1] - T[k]) / 0.233)
        wv = np.r_[[1 / (SIG_ODO_R**2 * dt)] * 3, [1 / (SIG_ODO_T**2 * dt)] * 3]
        a, c = 6*k, 6*(k+1)
        for d in range(6):
            A[a+d, a+d] += wv[d]; A[c+d, c+d] += wv[d]; A[a+d, c+d] -= wv[d]; A[c+d, a+d] -= wv[d]
    # anker: total korreksjon (M·M0⁻¹) mot null, linearisert rundt nåværende
    for k in range(N):
        Dk = M[k] @ np.linalg.inv(M0[k]); R_ = Dk[:3, :3]
        w_ = np.array([R_[2, 1] - R_[1, 2], R_[0, 2] - R_[2, 0], R_[1, 0] - R_[0, 1]]) / 2
        cur = np.r_[w_, Dk[:3, 3]]
        wv = np.r_[[1 / SIG_ANK_R**2] * 3, [1 / SIG_ANK_T**2] * 3]
        A[6*k:6*k+6, 6*k:6*k+6] += np.diag(wv); b[6*k:6*k+6] += wv * cur
    A[:6, :6] += np.eye(6) * 1e12        # kart 0 fast
    dx = np.linalg.solve(A + np.eye(n6) * 1e-9, -b)
    for k in range(N):
        R = rodrigues(dx[6*k:6*k+3]); v = dx[6*k+3:6*k+6]
        D = np.eye(4); D[:3, :3] = R; D[:3, 3] = v
        M[k] = D @ M[k]
    step = np.abs(dx.reshape(N, 6)[:, 3:]).max()
    print(f"runde {rnd+1}: største flytt {step*1000:.1f} mm")
    if step < 2e-4 and (not FOTO or rnd >= RUNDER // 2): break
print(f"løst på {time.time()-t_start:.1f} s")

print("Etter:")
measure(M, gulv, "nabokart (skal ikke bli verre)")
fmeasure(M, fhold, "foto holdt ute")
measure(M, fit, "løste par")
measure(M, hold, "holdt ute (ærlig tall)")
corr = np.array([np.linalg.norm(M[k][:3, 3] - M0[k][:3, 3]) for k in range(N)])
print(f"Korreksjon av kameraposisjon: median {np.median(corr)*1000:.0f} mm, maks {corr.max()*1000:.0f} mm (ved {T[corr.argmax()]:.0f} s)")
for w0 in range(0, int(T[-1]) + 1, 10):
    sel = (T >= w0) & (T < w0 + 10)
    if sel.any(): print(f"  {w0:3d}–{w0+10}s: {np.mean(corr[sel])*1000:5.1f} mm", end='')
print()

if SKRIV:
    # nøkkelbilder: korreksjonen (D = M·M0⁻¹) interpoleres i tid mellom nærmeste dybdekart
    D = np.stack([M[k] @ np.linalg.inv(M0[k]) for k in range(N)])
    kfs = json.load(open(f'{B}/frames.json'))
    with open(f'{B}/loop-poser.jsonl', 'w') as f:
        for k, m in enumerate(meta):
            f.write(json.dumps({'i': m['i'], 't': m['t'], 'm': M[k].T.ravel().round(6).tolist()}) + '\n')
        for kf in kfs:
            tk = kf['timestamp'] - t0
            Dk = D[int(np.argmin(np.abs(T - tk)))]   # samme node som fotoleddet løste mot
            Mk = Dk @ np.array(kf['transform'], float).reshape(4, 4).T
            f.write(json.dumps({'kf': kf['index'], 't': kf['timestamp'], 'm': Mk.T.ravel().round(6).tolist()}) + '\n')
    print(f"skrev {B}/loop-poser.jsonl")
