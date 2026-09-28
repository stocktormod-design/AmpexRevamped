#!/usr/bin/env python3
"""Leser dekningsfeltet overlegget viser, fra et skann-bundle. Se SKANN_BESLUTNINGER §98.

Bruk: audit-scan-dekningsfelt.py <bundleDir>

Replikerer CoverageField.splat i Python (samme vekting: kvalitet · cos²θ · oppløsning,
c = 1 − exp(−Σw/12), 4 cm voxler) fra nøkkelbildenes dybdekart, og slår så feltet opp
der ARKit-meshen ligger (fixture-mesh.bin) — akkurat som coverageFrag gjør.

Svarer på ETT spørsmål: ligger meshen i de voxlene som faktisk ble malt? Gjør den ikke det,
reagerer ikke stripene uansett hvor lenge man peker. Sammenligner ett oppslag mot fem
tapper langs normalen (0, ±1, ±2 voxler), som er rettelsen fra §98.

Feltet mates live av HVER ANNEN ARFrame (~30 Hz); bundlen har bare nøkkelbildene, så de
absolutte c-verdiene er lave. Det som betyr noe er FORHOLDET mellom eget oppslag og
tappene — det er geometri, ikke antall rammer.
"""
import json, os, struct, sys
import numpy as np

B = sys.argv[1] if len(sys.argv) > 1 else '.'
DIMS = np.array([240, 90, 240]); VOXEL = 0.04; S0 = 12.0
RES_MIN, RES_MAAL = 700.0, 1600.0
NED = 2.2   # forankring under kameraet (§98); 1.8 = gammel, sentrert

frames = [f for f in json.load(open(f'{B}/frames.json'))
          if os.path.exists(f'{B}/depth-{f["index"]}.f32')]
if not frames:
    sys.exit('fant ingen depth-N.f32 i bundlen')
cam0 = np.array(frames[0]['transform']).reshape(4, 4).T[:3, 3]
origin = cam0 - np.array([DIMS[0] * VOXEL / 2, NED, DIMS[2] * VOXEL / 2])

acc = np.zeros(tuple(DIMS))
for f in frames:
    w, h = f['depthWidth'], f['depthHeight']
    z = np.fromfile(f'{B}/depth-{f["index"]}.f32', dtype=np.float32).reshape(h, w).astype(np.float64)
    K = f['intrinsics']; sx = w / f['width']; sy = h / f['height']
    fx, fy, cx, cy = K[0] * sx, K[1] * sy, K[2] * sx, K[3] * sy
    q = max(0.0, 1 - f.get('blurPx', 0) / 60.0)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    unp = lambda X, Y, Z: np.stack([(X - cx) / fx * Z, -(Y - cy) / fy * Z, -Z], -1)
    ok = np.zeros((h, w), bool); ok[1:-1, 1:-1] = True
    ok &= (z > 0.3) & (z < 5.0)
    lim = np.maximum(0.04, 0.03 * z)
    ok &= (np.abs(np.roll(z, -1, 1) - z) <= lim) & (np.abs(np.roll(z, -1, 0) - z) <= lim)
    pc = unp(xs, ys, z)
    nb = lambda dx, dy: np.where((np.roll(z, (-dy, -dx), (0, 1)) > 0.3)[..., None],
                                 unp(xs + dx, ys + dy, np.roll(z, (-dy, -dx), (0, 1))), pc)
    n = np.cross(nb(1, 0) - nb(-1, 0), nb(0, 1) - nb(0, -1))
    nl = np.linalg.norm(n, axis=-1)
    view = -pc / np.maximum(np.linalg.norm(pc, axis=-1, keepdims=True), 1e-9)
    cosT = np.clip(np.abs(np.sum(np.where(nl[..., None] > 1e-6, n / np.maximum(nl, 1e-9)[..., None], 0) * view, -1)), 0, 1)
    oppl = 0.15 + 0.85 * np.clip((K[0] * cosT / np.maximum(z, 0.2) - RES_MIN) / (RES_MAAL - RES_MIN), 0, 1)
    wgt = q * cosT * cosT * oppl
    c2w = np.array(f['transform']).reshape(4, 4).T
    wp = pc @ c2w[:3, :3].T + c2w[:3, 3]
    g = np.floor((wp - origin) / VOXEL).astype(np.int64)
    sel = ok & np.all((g >= 0) & (g < DIMS), axis=-1)
    np.add.at(acc, (g[sel][:, 0], g[sel][:, 1], g[sel][:, 2]), wgt[sel])
cov = 1 - np.exp(-acc / S0)

d = open(f'{B}/fixture-mesh.bin', 'rb').read()
magic, ver, vc, _tc = struct.unpack_from('<4I', d, 0)
assert magic == 0x414D5058, 'ikke en fixture-mesh.bin'
pos = np.frombuffer(d, np.float32, vc * 3, 16).reshape(-1, 3).astype(np.float64)
nrm = np.frombuffer(d, np.float32, vc * 3, 16 + vc * 12).reshape(-1, 3).astype(np.float64)
nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)

def samp(p):
    g = np.floor((p - origin) / VOXEL)
    g = np.where(np.isfinite(g), g, -1).astype(np.int64)
    inne = np.all((g >= 0) & (g < DIMS), axis=1)
    ut = np.zeros(len(p)); gg = g[inne]
    ut[inne] = cov[gg[:, 0], gg[:, 1], gg[:, 2]]
    return ut

taps = np.stack([samp(pos)] + [samp(pos + nrm * (k * VOXEL)) for k in (1, -1, 2, -2)])
vekt = np.array([1.0, 0.95, 0.95, 0.85, 0.85])[:, None]
base, best = taps[0], (taps * vekt).max(0)
har = best > 0
utenfor = ~np.all((pos >= origin) & (pos < origin + DIMS * VOXEL), axis=1)

print(f"{len(frames)} dybdekart, {vc} mesh-hjørner, feltorigo {np.round(origin,2)}")
print(f"mesh utenfor volumet (kan aldri males):        {100*utenfor.mean():5.1f} %")
print(f"hjørner med dekning i egen voxel:              {100*(base>0).mean():5.1f} %")
print(f"hjørner med dekning innen ±2 voxler (±8 cm):   {100*har.mean():5.1f} %")
print(f"  av dem: egen voxel TOM, nabo malt:           {100*((base<=0)&har).sum()/max(har.sum(),1):5.1f} %  ← §98")
for navn, m in (("vegg", np.abs(nrm[:, 1]) < 0.5), ("gulv", nrm[:, 1] > 0.7), ("tak", nrm[:, 1] < -0.7)):
    s = m & har
    if s.sum() < 100: continue
    print(f"  {navn}: over terskel 0,40 — eget oppslag {100*(base[s]>=0.4).mean():4.1f} % → fem tapper {100*(best[s]>=0.4).mean():4.1f} %")
