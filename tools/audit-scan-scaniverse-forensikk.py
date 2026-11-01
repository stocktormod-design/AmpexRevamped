#!/usr/bin/env python3
"""Utdata-forensikk på teksturerte rom-GLB-er (Scaniverse-eksport mot våre baker).

Bruk:  python3 -I tools/audit-scan-scaniverse-forensikk.py <utmappe> a.glb [b.glb ...]

Måler kun det som står i fila: glTF-JSON (uten binær), JPEG-hoder, geometri
(sveiset på eksakt posisjon), trekantstørrelse mot krumning, gitter-signatur,
doble flater, UV-felt (charts), prosjektiv tilpasning per felt med kamera-
dekomponering, sømlengde, padding og fargesprang over sømmer.

Alt er diagnostikk. Prosjektiv tilpasning sier at UV-ene i et felt er EN
kameraprojeksjon av 3D-punktene; den sier ikke hvilke foto pikslene kommer fra.
Kun ren numpy + cv2 (ingen scipy/trimesh). Krever identitetsnoder.
"""
import json
import struct
import sys
from pathlib import Path

import cv2 as cv
import numpy as np


# ---------------------------------------------------------------- GLB-lesing
def load(path):
    data = Path(path).read_bytes()
    off = 12; meta = binary = None
    while off < len(data):
        ln, ty = struct.unpack_from('<II', data, off)
        chunk = data[off+8:off+8+ln]; off += 8+ln
        if ty == 0x4E4F534A: meta = json.loads(chunk)
        elif ty == 0x004E4942: binary = chunk
    for node in meta['nodes']:
        assert not any(k in node for k in ['matrix', 'translation', 'rotation', 'scale']), 'kun identitetsnoder'

    def view(i):
        v = meta['bufferViews'][i]; s = v.get('byteOffset', 0)
        return binary[s:s+v['byteLength']]

    def acc(i):
        a = meta['accessors'][i]; v = meta['bufferViews'][a['bufferView']]
        dt = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']])
        w = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        return np.ndarray((a['count'], w), dtype=dt, buffer=view(a['bufferView']), offset=a.get('byteOffset', 0),
                          strides=(v.get('byteStride', dt.itemsize*w), dt.itemsize)).copy()
    images = []
    for im in meta.get('images', []):
        raw = view(im['bufferView'])
        images.append({'raw': raw, 'img': cv.imdecode(np.frombuffer(raw, np.uint8), cv.IMREAD_COLOR), 'mime': im['mimeType']})
    P, UV, F, T, has_normals = [], [], [], [], []
    base = 0
    for mesh in meta['meshes']:
        for pr in mesh['primitives']:
            p = acc(pr['attributes']['POSITION']).astype(np.float64)
            uv = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
            f = acc(pr['indices']).reshape(-1, 3).astype(np.int64)
            pbr = meta['materials'][pr['material']]['pbrMetallicRoughness']
            tex = meta['textures'][pbr['baseColorTexture']['index']]['source']
            P.append(p); UV.append(uv); F.append(f+base); T.append(np.full(len(f), tex)); base += len(p)
            has_normals.append('NORMAL' in pr['attributes'])
    return {'meta': meta, 'images': images, 'P': np.concatenate(P), 'UV': np.concatenate(UV),
            'F': np.concatenate(F), 'tex': np.concatenate(T), 'normals': has_normals, 'bytes': len(data)}


def json_skeleton(meta):
    """glTF-JSON uten tunge lister: bevarer nøkler, extensions, extras, generator."""
    out = {}
    for k, v in meta.items():
        if isinstance(v, list) and len(v) > 3:
            out[k] = {'_antall': len(v), '_første': v[0], '_nøkler_union': sorted({kk for e in v if isinstance(e, dict) for kk in e})}
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------- JPEG
STD_LUM = np.array([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
                    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
                    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99], float)
ZIGZAG = np.array([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
                   28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60,
                   61, 54, 47, 55, 62, 63])


def jpeg_info(raw):
    i = 2; markers = []; tables = {}; sof = None
    while i < len(raw)-4:
        if raw[i] != 0xFF: break
        m = raw[i+1]
        if m == 0xD9 or m == 0xDA:
            markers.append(hex(m)); break
        ln = struct.unpack('>H', raw[i+2:i+4])[0]; seg = raw[i+4:i+2+ln]
        markers.append(hex(m))
        if m == 0xDB:
            j = 0
            while j < len(seg):
                pq, tq = seg[j] >> 4, seg[j] & 15; j += 1
                n = 64*(2 if pq else 1)
                vals = np.frombuffer(seg[j:j+n], '>u2' if pq else 'u1').astype(float); j += n
                q = np.zeros(64); q[ZIGZAG] = vals; tables[tq] = q
        if m in (0xC0, 0xC1, 0xC2):
            nc = seg[5]
            sof = {'type': {0xC0: 'baseline', 0xC1: 'extended', 0xC2: 'progressive'}[m],
                   'h': struct.unpack('>H', seg[1:3])[0], 'w': struct.unpack('>H', seg[3:5])[0],
                   'sampling': [f'{seg[6+3*c+1] >> 4}x{seg[6+3*c+1] & 15}' for c in range(nc)]}
        if 0xE0 <= m <= 0xEF:
            markers[-1] += ':' + seg[:12].split(b'\0')[0].decode('latin1', 'replace')
        i += 2+ln
    quality = None
    if 0 in tables:
        s = 100*tables[0].sum()/STD_LUM.sum()
        quality = round((200-s)/2 if s <= 100 else 5000/s)
    return {'markers': markers, 'sof': sof, 'ijg_quality_estimate': quality,
            'lum_q_dc_ac1': tables[0][:2].tolist() if 0 in tables else None}


# ---------------------------------------------------------------- topologi
def weld(P):
    q = np.round(P*1e5).astype(np.int64)  # 10 µm
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    return inv.ravel(), first


def components(n, a, b):
    lab = np.arange(n)
    while True:
        ra, rb = lab[a], lab[b]
        diff = ra != rb
        if not diff.any(): return lab
        ra, rb = ra[diff], rb[diff]
        np.minimum.at(lab, np.maximum(ra, rb), np.minimum(ra, rb))  # heng største rot under minste
        while True:  # full stikomprimering
            nxt = lab[lab]
            if np.array_equal(nxt, lab): break
            lab = nxt


def wquant(v, w, qs=(.1, .5, .9)):
    ok = np.isfinite(v) & (w > 0)
    v, w = v[ok], w[ok]
    if len(v) == 0: return [None]*len(qs)
    o = np.argsort(v); c = np.cumsum(w[o]); c /= c[-1]
    return [float(x) for x in np.interp(qs, c, v[o])]


# ---------------------------------------------------------------- prosjektiv tilpasning + kamera
def rq3(M):
    # RQ via QR på speilet matrise
    Pm = np.flipud(np.eye(3))
    q, r = np.linalg.qr((Pm @ M).T)
    R = Pm @ r.T @ Pm; Q = Pm @ q.T
    s = np.diag(np.sign(np.diag(R))); R = R @ s; Q = s @ Q
    return R, Q


def projective_chart(p, uvpix, rng):
    if len(p) < 30: return None
    ids = rng.permutation(len(p))[:2000]; p, uvpix = p[ids], uvpix[ids]
    c = p.mean(0); s = np.linalg.norm(p-c, axis=1).max()
    x = np.column_stack(((p-c)/max(s, 1e-12), np.ones(len(p))))
    uc = uvpix.mean(0); us = max(np.linalg.norm(uvpix-uc, axis=1).max(), 1e-12)
    y = (uvpix-uc)/us
    test = np.arange(len(x)) % 3 == 0; tr = ~test
    rows = np.zeros((2*tr.sum(), 12))
    rows[0::2, :4] = x[tr]; rows[1::2, 4:8] = x[tr]
    rows[0::2, 8:] = -y[tr, 0, None]*x[tr]; rows[1::2, 8:] = -y[tr, 1, None]*x[tr]
    _, sv, vh = np.linalg.svd(rows, full_matrices=False)
    Pn = vh[-1].reshape(3, 4)
    pr = x[test] @ Pn.T
    if np.any(abs(pr[:, 2]) < 1e-10): return None
    err = np.linalg.norm(pr[:, :2]/pr[:, 2, None]-y[test], axis=1)*us
    A = np.linalg.lstsq(x[tr], y[tr], rcond=None)[0]
    aerr = np.linalg.norm(x[test] @ A-y[test], axis=1)*us
    # planhet: minste PCA-std / største
    ev = np.sqrt(np.maximum(np.linalg.eigvalsh(np.cov((p-c).T)), 0))
    out = {'n': len(p), 'proj_p90_px': float(np.quantile(err, .9)), 'affin_p90_px': float(np.quantile(aerr, .9)),
           'gap': float(sv[-2]/max(sv[-1], 1e-15)), 'planhet': float(ev[0]/max(ev[2], 1e-12))}
    # tilbake til meter og atlaspiksler: P = T2^-1 Pn T3
    T3 = np.eye(4); T3[:3, :3] /= s; T3[:3, 3] = -c/s
    T2i = np.eye(3); T2i[:2, :2] *= us; T2i[:2, 2] = uc
    Po = T2i @ Pn @ T3
    M = Po[:, :3]
    if abs(np.linalg.det(M)) > 1e-12:
        C = -np.linalg.solve(M, Po[:, 3])
        K, R = rq3(M); K = K/K[2, 2]
        dist = np.linalg.norm(p-C, axis=1)
        # chartets piksler i normaliserte bildekoordinater (tan-vinkler fra optisk akse): K^-1 [u v 1]
        xn = (np.column_stack((uvpix, np.ones(len(uvpix)))) @ np.linalg.inv(K).T)[:, :2]
        # rull: vinkel mellom bildets -v-akse og verdens +Y
        out.update({'C': C.tolist(), 'fx': float(K[0, 0]), 'fy': float(K[1, 1]), 'skew': float(K[0, 1]),
                    'aspekt': float(K[0, 0]/K[1, 1]), 'avstand_median_m': float(np.median(dist)),
                    'xn_min': xn.min(0).tolist(), 'xn_max': xn.max(0).tolist(), 'R': R.tolist(),
                    'pp_atlas': [float(K[0, 2]), float(K[1, 2])]})
    return out


# ---------------------------------------------------------------- hovedanalyse
def analyse(path, outdir):
    g = load(path); meta = g['meta']; P, UV, F, tex = g['P'], g['UV'], g['F'], g['tex']
    R = {'fil': str(path), 'bytes': g['bytes'], 'json': json_skeleton(meta), 'normaler_i_fila': g['normals']}
    R['teksturer'] = [{'w': im['img'].shape[1], 'h': im['img'].shape[0], 'bytes': len(im['raw']), **jpeg_info(im['raw'])}
                      for im in g['images']]
    tri = P[F]
    cr = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]); ln = np.linalg.norm(cr, axis=1)
    area = ln/2; n = cr/np.maximum(ln[:, None], 1e-15)
    E = np.linalg.norm(np.roll(tri, -1, 1)-tri, axis=2)  # kant i: v[i]->v[i+1]
    R['geometri'] = {'hjørner': len(P), 'trekanter': len(F), 'areal_m2': float(area.sum()),
                     'bbox_min': P.min(0).tolist(), 'bbox_max': P.max(0).tolist(),
                     'degenererte': int((area < 1e-12).sum())}
    # sveis
    w, first = weld(P); Fw = w[F]; nv = int(w.max())+1
    R['geometri']['unike_posisjoner'] = nv
    R['geometri']['duplisering'] = len(P)/nv
    # kanter
    a = Fw.ravel(); b = np.roll(Fw, -1, 1).ravel(); fid = np.repeat(np.arange(len(F)), 3); corner = np.tile([0, 1, 2], len(F))
    lo, hi = np.minimum(a, b), np.maximum(a, b); key = lo*nv+hi
    order = np.argsort(key, kind='stable'); ks = key[order]
    uniq, start, cnt = np.unique(ks, return_index=True, return_counts=True)
    elen = E.ravel()
    bnd = order[start[cnt == 1]]
    R['geometri']['grensekanter'] = int((cnt == 1).sum())
    R['geometri']['ikke_manifold_kanter'] = int((cnt > 2).sum())
    R['geometri']['grense_m_per_m2'] = float(elen[bnd].sum()/area.sum())
    # komponenter (sveiset)
    lab = components(nv, np.concatenate([Fw[:, 0], Fw[:, 1]]), np.concatenate([Fw[:, 1], Fw[:, 2]]))
    flab = lab[Fw[:, 0]]
    _, finv = np.unique(flab, return_inverse=True); carea = np.bincount(finv, weights=area)
    R['geometri']['komponenter'] = int(len(carea))
    R['geometri']['største_komponent_andel'] = float(carea.max()/area.sum())
    R['geometri']['komponenter_under_0_05m2_areal_andel'] = float(carea[carea < .05].sum()/area.sum())
    # valens
    val = np.bincount(np.concatenate([lo[order[start]], hi[order[start]]]), minlength=nv)
    vh, _ = np.histogram(val, bins=np.arange(2, 14))
    R['geometri']['valens_andel_3..12'] = (vh/vh.sum()).round(3).tolist()
    # dihedral per manifold kant
    two = cnt == 2
    f1 = fid[order[start[two]]]; f2 = fid[order[start[two]+1]]
    cosd = np.clip((n[f1]*n[f2]).sum(1), -1, 1); dih = np.degrees(np.arccos(cosd))
    R['geometri']['vending_inkonsistent_andel'] = None
    # vending: i en konsistent orientert flate går delt kant motsatt vei i de to trekantene
    same_dir = a[order[start[two]]] == a[order[start[two]+1]]
    R['geometri']['vending_inkonsistent_andel'] = float(same_dir.mean())
    fmaxdih = np.zeros(len(F)); np.maximum.at(fmaxdih, f1, dih); np.maximum.at(fmaxdih, f2, dih)
    # trekantkvalitet: lengste kant / (2*sqrt(3)*innradius)  (1 = likesidet)
    s = E.sum(1)/2; inr = area/np.maximum(s, 1e-15)
    aspect = E.max(1)/np.maximum(2*np.sqrt(3)*inr, 1e-15)
    R['geometri']['aspekt_p10_p50_p90_arealvektet'] = wquant(aspect, area)
    R['geometri']['lengste_kant_m_p10_p50_p90_arealvektet'] = wquant(E.max(1), area)
    R['geometri']['areal_per_trekant_cm2_p10_p50_p90_antall'] = (np.quantile(area, [.1, .5, .9])*1e4).tolist()
    bins = [(0, 1), (1, 5), (5, 20), (20, 60), (60, 181)]
    R['geometri']['størrelse_mot_dihedral'] = [
        {'maks_dihedral_grader': f'{lo_}-{hi_}', 'andel_trekanter': float(((fmaxdih >= lo_) & (fmaxdih < hi_)).mean()),
         'andel_areal': float(area[(fmaxdih >= lo_) & (fmaxdih < hi_)].sum()/area.sum()),
         'median_areal_cm2': float(np.median(area[(fmaxdih >= lo_) & (fmaxdih < hi_)])*1e4) if ((fmaxdih >= lo_) & (fmaxdih < hi_)).any() else None,
         'median_lengste_kant_cm': float(np.median(E.max(1)[(fmaxdih >= lo_) & (fmaxdih < hi_)])*100) if ((fmaxdih >= lo_) & (fmaxdih < hi_)).any() else None}
        for lo_, hi_ in bins]
    # gravitasjon, gulv/tak, klasser
    up = n[:, 1]
    horiz = abs(up) > .95; vert = abs(up) < .3
    yc = tri[:, :, 1].mean(1)
    # orienteringstegn: gulvet er nederst; flater nær bunnen og horisontale skal peke opp
    low = horiz & (yc < np.quantile(yc, .1)+.15)
    sign = 1.0 if (area[low]*up[low]).sum() >= 0 else -1.0
    R['koordinater'] = {'gulv_peker': '+Y' if sign > 0 else '-Y (snudd vinding eller Y ned)'}
    nn = n*sign
    floorish = (nn[:, 1] > .95); ceilish = (nn[:, 1] < -.95)
    def peak(y, wgt):
        h, e = np.histogram(y, bins=np.arange(y.min()-.01, y.max()+.02, .01), weights=wgt)
        return float(e[h.argmax()]+.005)
    fy = peak(yc[floorish], area[floorish]); cy = peak(yc[ceilish], area[ceilish])
    on_floor = floorish & (abs(yc-fy) < .06); on_ceil = ceilish & (abs(yc-cy) < .06)
    # loddavvik: snittnormal av gulvflater
    fn = (nn[on_floor]*area[on_floor, None]).sum(0); fn /= np.linalg.norm(fn)
    cn = (nn[on_ceil]*area[on_ceil, None]).sum(0); cn /= np.linalg.norm(cn)
    az = np.degrees(np.arctan2(nn[vert, 2], nn[vert, 0])) % 90
    hz, _ = np.histogram(az, bins=90, range=(0, 90), weights=area[vert])
    pk = int(hz.argmax())
    R['koordinater'].update({'gulv_y': fy, 'tak_y': cy, 'takhøyde': cy-fy,
                             'gulvnormal_vinkel_mot_Y_grader': float(np.degrees(np.arccos(abs(fn[1])))),
                             'taknormal_vinkel_mot_Y_grader': float(np.degrees(np.arccos(abs(cn[1])))),
                             'vegg_asimut_mod90_topp_grader': pk+.5,
                             'vegg_areal_innen_2gr_av_topp': float(hz[[(pk+k) % 90 for k in range(-2, 3)]].sum()/hz.sum()),
                             'vegg_areal_innen_2gr_av_aksene': float(hz[[k % 90 for k in range(-2, 3)]].sum()/hz.sum())})
    # store plan: gulv, tak og vegger (asimut 2° × offset 5 cm, > 1 m²)
    vid = np.where(vert)[0]
    azf = np.degrees(np.arctan2(nn[vid, 2], nn[vid, 0])) % 360
    cen = tri[vid].mean(1); off_ = (cen[:, 0]*nn[vid, 0]+cen[:, 2]*nn[vid, 2])
    k2 = np.round(azf/5).astype(int)*100000+np.round(off_/.10).astype(int)
    ku, kinv = np.unique(k2, return_inverse=True); karea = np.bincount(kinv, weights=area[vid])
    onwall = np.zeros(len(F), bool); onwall[vid[karea[kinv] > 0.5]] = True
    cls = np.full(len(F), 'annet', dtype=object); cls[onwall] = 'vegg'; cls[on_floor] = 'gulv'; cls[on_ceil] = 'tak'
    R['klasser_areal_m2'] = {c: float(area[cls == c].sum()) for c in ['vegg', 'gulv', 'tak', 'annet']}
    onplane = cls != 'annet'
    R['geometri']['plan_mot_resten'] = {
        'plan_lengste_kant_p50_cm': wquant(E.max(1)[onplane], area[onplane])[1]*100,
        'resten_lengste_kant_p50_cm': wquant(E.max(1)[~onplane], area[~onplane])[1]*100,
        'plan_median_areal_cm2': float(np.median(area[onplane])*1e4),
        'resten_median_areal_cm2': float(np.median(area[~onplane])*1e4),
        'plan_aspekt_p50': wquant(aspect[onplane], area[onplane])[1],
        'resten_aspekt_p50': wquant(aspect[~onplane], area[~onplane])[1]}
    # avvik fra planet (RMS, mm) på de store veggplanene
    rms = []
    for kk in np.argsort(karea)[::-1][:8]:
        sel = vid[kinv == kk]
        pts = tri[sel].reshape(-1, 3); c0 = pts.mean(0)
        _, sv_, vt = np.linalg.svd(pts-c0, full_matrices=False)
        d = (pts-c0) @ vt[2]
        rms.append(round(float(np.sqrt((d**2).mean())*1000), 1))
    R['geometri']['vegg_rms_mm_8_største_plan_bin'] = rms
    # gitter-signatur
    R['gitter'] = lattice(P[first], nn, Fw, area)
    # doble flater
    R['doble_flater'] = doubles(tri, nn, area)
    # tekstur
    R['tekstur'] = texture(g, P, UV, F, tex, area, cls, Fw, fid, order, start, cnt, a, b, corner, outdir, Path(path).stem)
    return R


def lattice(Pu, nn, Fw, area):
    """Konsentrasjon av koordinat mod s (|mean exp(2πi x/s)|). 1 = alle på gitteret, ~0 = ingen gitter."""
    out = {}
    for ax, name in enumerate('xyz'):
        x = Pu[:, ax]
        best = []
        for s in np.arange(.008, .0251, .00005):  # smal topp: 0,5 mm-steg bommer
            r = abs(np.exp(2j*np.pi*x/s).mean())
            best.append((r, s))
        best.sort(reverse=True)
        out[name] = [{'s_mm': round(s*1000, 1), 'R': round(float(r), 4)} for r, s in best[:3]]
    # tilfeldig referanse: forventet R for n uniforme punkt
    out['tilfeldig_R_forventet'] = float(1/np.sqrt(len(Pu)))
    # andel hjørner der minst to koordinater ligger innenfor 0,5 mm av en heltalls-multippel av beste s
    return out


def doubles(tri, nn, area, cell=.05):
    """Andel areal med en annen flate nesten parallell 5–60 mm unna langs normalen, sideveis < 2 cm."""
    c = tri.mean(1); key = np.floor(c/cell).astype(np.int64)
    k = (key[:, 0]*73856093) ^ (key[:, 1]*19349663) ^ (key[:, 2]*83492791)
    order = np.argsort(k); ks = k[order]
    has = np.zeros(len(c), bool); opp = np.zeros(len(c), bool)
    rng = np.random.default_rng(1)
    sample = rng.choice(len(c), size=min(len(c), 60000), replace=False, p=area/area.sum())
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                kk = key[sample]+np.array([dx, dy, dz])
                h = (kk[:, 0]*73856093) ^ (kk[:, 1]*19349663) ^ (kk[:, 2]*83492791)
                lo = np.searchsorted(ks, h, 'left'); hi = np.searchsorted(ks, h, 'right')
                m = hi-lo
                for j in range(int(m.max()) if len(m) else 0):
                    ok = m > j
                    s_ = sample[ok]; o = order[lo[ok]+j]
                    d = c[o]-c[s_]
                    along = (d*nn[s_]).sum(1)
                    lat = np.linalg.norm(d-along[:, None]*nn[s_], axis=1)
                    dot = (nn[o]*nn[s_]).sum(1)
                    hit = (abs(along) > .005) & (abs(along) < .06) & (lat < .02) & (abs(dot) > .95) & (o != s_)
                    has[s_[hit]] = True; opp[s_[hit & (dot < 0)]] = True
    return {'andel_areal_med_parallell_nabo_5_60mm': float(has[sample].mean()),
            'herav_motsatt_normal': float(opp[sample].mean()), 'utvalg': int(len(sample))}


def distinct_cams(good):
    C = np.array([f['C'] for f in good]); Rm = np.array([np.array(f['R']) for f in good])
    rep = []
    for i in range(len(C)):
        for j in rep:
            ang = np.degrees(np.arccos(np.clip((np.trace(Rm[i] @ Rm[j].T)-1)/2, -1, 1)))
            if np.linalg.norm(C[i]-C[j]) < .05 and ang < 2: break
        else:
            rep.append(i)
    return len(rep)


def texture(g, P, UV, F, tex, area, cls, Fw, fid, order, start, cnt, a, b, corner, outdir, stem):
    imgs = [im['img'] for im in g['images']]
    out = {}
    W = np.array([[im.shape[1], im.shape[0]] for im in imgs], float)
    uvt = UV[F]; e1 = uvt[:, 1]-uvt[:, 0]; e2 = uvt[:, 2]-uvt[:, 0]
    uvarea = abs(e1[:, 0]*e2[:, 1]-e1[:, 1]*e2[:, 0])/2*W[tex, 0]*W[tex, 1]
    dens = np.sqrt(uvarea/np.maximum(area, 1e-15))
    out['texel_per_m_p10_p50_p90'] = {'alt': wquant(dens, area)}
    for c in ['vegg', 'gulv', 'tak', 'annet']:
        out['texel_per_m_p10_p50_p90'][c] = wquant(dens[cls == c], area[cls == c])
    out['atlas_texel_totalt'] = float(W.prod(1).sum())
    out['uv_areal_sum_andel_av_atlas'] = float(uvarea.sum()/W.prod(1).sum())
    # charts: sammenheng via UOPPSPLITTEDE indekser (søm splitter hjørner)
    nvo = len(P)
    lab = components(nvo, np.concatenate([F[:, 0], F[:, 1]]), np.concatenate([F[:, 1], F[:, 2]]))
    chart_raw = lab[F[:, 0]]
    _, chart = np.unique(chart_raw, return_inverse=True); nch = int(chart.max())+1
    ca = np.bincount(chart, weights=area); cn_ = np.bincount(chart)
    srt = np.sort(ca)[::-1]; cs = np.cumsum(srt)/srt.sum()
    out['charts'] = {'antall': nch, 'per_m2': nch/area.sum(),
                     'areal_m2_p10_p50_p90_antall': np.quantile(ca, [.1, .5, .9]).tolist(),
                     'areal_m2_p50_arealvektet': wquant(ca[chart], area)[1],
                     'største_12_m2': srt[:12].round(3).tolist(),
                     'antall_for_50_90_prosent_av_areal': [int(np.searchsorted(cs, .5))+1, int(np.searchsorted(cs, .9))+1],
                     'trekanter_per_chart_median': float(np.median(cn_))}
    # rekkefølge i indeksbufferet
    out['charts']['chartskift_i_indeksbuffer_per_chart'] = float((np.diff(chart) != 0).sum()/nch)
    # prosjektiv tilpasning for alle charts med >= 30 hjørner
    rng = np.random.default_rng(728)
    fits = []
    for c in np.argsort(ca)[::-1]:
        fs = np.where(chart == c)[0]
        vi = np.unique(F[fs])
        if len(vi) < 30: continue
        t = tex[fs[0]]
        r = projective_chart(P[vi], UV[vi]*W[t], rng)
        if r is None: continue
        r['areal_m2'] = float(ca[c]); r['klasse'] = max(['vegg', 'gulv', 'tak', 'annet'], key=lambda k: area[fs][cls[fs] == k].sum())
        fits.append(r)
        if len(fits) >= 400: break
    fa = np.array([f['areal_m2'] for f in fits]); fp = np.array([f['proj_p90_px'] for f in fits])
    faff = np.array([f['affin_p90_px'] for f in fits])
    covered = fa.sum()/area.sum() if len(fa) else 0
    out['prosjektiv'] = {'charts_testet': len(fits), 'areal_andel_testet': float(covered),
                         'andel_testareal_proj_p90_under_0_5px': float(fa[fp < .5].sum()/max(fa.sum(), 1e-12)),
                         'andel_testareal_affin_p90_under_0_5px': float(fa[faff < .5].sum()/max(fa.sum(), 1e-12)),
                         'proj_p90_px_median': float(np.median(fp)) if len(fp) else None}
    good = [f for f in fits if f['proj_p90_px'] < .5 and 'C' in f and f['gap'] > 30 and f['planhet'] > .03]
    out['prosjektiv']['kamera_gjenfinnbart_antall'] = len(good)
    if good:
        fx = np.array([f['fx'] for f in good]); asp = np.array([f['aspekt'] for f in good])
        sk = np.array([abs(f['skew'])/abs(f['fx']) for f in good]); dist = np.array([f['avstand_median_m'] for f in good])
        C = np.array([f['C'] for f in good])
        out['prosjektiv'].update({
            'fx_atlaspx_p10_p50_p90': np.quantile(abs(fx), [.1, .5, .9]).tolist(),
            'aspekt_fx_fy_p10_p50_p90': np.quantile(asp, [.1, .5, .9]).tolist(),
            'skew_rel_p90': float(np.quantile(sk, .9)),
            'kameraavstand_m_p10_p50_p90': np.quantile(dist, [.1, .5, .9]).tolist(),
            'kamerasenter_y_p10_p50_p90': np.quantile(C[:, 1], [.1, .5, .9]).tolist(),
            'xn_min_p1': np.quantile(np.array([f['xn_min'] for f in good]), .01, axis=0).tolist(),
            'xn_max_p99': np.quantile(np.array([f['xn_max'] for f in good]), .99, axis=0).tolist(),
            'xn_min_abs': np.array([f['xn_min'] for f in good]).min(0).tolist(),
            'xn_max_abs': np.array([f['xn_max'] for f in good]).max(0).tolist(),
            'distinkte_kamera_5cm_2grader': distinct_cams(good),
            'kamera_par_innen_5cm_andel': float(np.mean([(np.linalg.norm(C-C[i], axis=1) < .05).sum() > 1 for i in range(len(C))])),
        })
        (outdir/f'{stem}-kamera.json').write_text(json.dumps(good, indent=1))
    # sømmer: manifold sveisede kanter der de to sidene har ulik chart (eller ulik UV)
    two = cnt == 2
    ia = order[start[two]]; ib = order[start[two]+1]
    fa_, fb_ = fid[ia], fid[ib]
    seam = chart[fa_] != chart[fb_]
    Elen = np.linalg.norm(P[F[fa_, (corner[ia]+1) % 3]]-P[F[fa_, corner[ia]]], axis=1)
    out['sømmer'] = {'søm_m_per_m2': float(Elen[seam].sum()/area.sum()), 'sømkanter': int(seam.sum())}
    for c in ['vegg', 'gulv', 'tak']:
        m = (cls[fa_] == c) & (cls[fb_] == c)
        aa = area[cls == c].sum()
        out['sømmer'][f'{c}_søm_m_per_m2'] = float(Elen[seam & m].sum()/max(aa, 1e-9))
    # fargesprang over søm mot kontroll (ikke-søm-kanter), samme geometri: punkt 2 texler inn i hver trekant
    out['sømsprang'] = seam_steps(imgs, W, P, UV, F, tex, fa_, fb_, ia, ib, corner, seam, chart, cls)
    # hvor langt inn fra sømmen strekker en eventuell lokal sømkorreksjon seg? (vegg+tak, median |ln L_a/L_b|)
    sweep = {}
    for ins in [1, 2, 4, 8, 16, 32]:
        r = seam_steps(imgs, W, P, UV, F, tex, fa_, fb_, ia, ib, corner, seam, chart, cls, inset=ins)
        sweep[str(ins)] = {k: [r[k].get('vegg_abs_logratio_p50_p90'), r[k].get('tak_abs_logratio_p50_p90')] for k in r}
    out['sømsprang_mot_innrykk_px'] = sweep
    # padding og okkupasjon per atlas
    out['atlas'] = []
    for t, im in enumerate(imgs):
        out['atlas'].append(padding(im, UV, F, tex, chart, t, outdir, f'{stem}-{t}'))
    return out


def bilinear(img, xy):
    # glTF-UV: (0,0) = øvre venstre hjørne av bildet; pikselsenter ved +0,5
    h, w = img.shape[:2]
    x = np.clip(xy[:, 0]-.5, 0, w-1.001); y = np.clip(xy[:, 1]-.5, 0, h-1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = (x-x0)[:, None]; fy = (y-y0)[:, None]
    im = img.astype(float)
    return (im[y0, x0]*(1-fx)*(1-fy)+im[y0, x0+1]*fx*(1-fy)+im[y0+1, x0]*(1-fx)*fy+im[y0+1, x0+1]*fx*fy)


def seam_steps(imgs, W, P, UV, F, tex, fa_, fb_, ia, ib, corner, seam, chart, cls, inset=2.0):
    def side(face, cidx, t):
        i0 = F[face, cidx]; i1 = F[face, (cidx+1) % 3]; i2 = F[face, (cidx+2) % 3]
        Wf = W[tex[face]]
        u0, u1, u2 = UV[i0]*Wf, UV[i1]*Wf, UV[i2]*Wf
        pe = u0+(u1-u0)*t[:, None]
        # mot motstående hjørne, 'inset' texler
        d = u2-pe; dl = np.linalg.norm(d, axis=1, keepdims=True)
        pin = pe+d/np.maximum(dl, 1e-9)*inset  # kan krysse inn i nabotrekant i samme chart; bildet er sammenhengende der
        x0, x1 = P[i0], P[i1]
        return pin, x0, x1
    res = {}
    rng = np.random.default_rng(3)
    for name, msk in [('søm', seam), ('kontroll_ikke_søm', ~seam)]:
        ids = np.where(msk)[0]
        if len(ids) == 0: continue
        ids = rng.choice(ids, size=min(len(ids), 40000), replace=False)
        t = np.full(len(ids), .5)
        pa, x0a, x1a = side(fa_[ids], corner[ia[ids]], t)
        # samme 3D-punkt på side b: kant går motsatt vei, finn hvilken ende som er x0a
        cb = corner[ib[ids]]
        pb, x0b, x1b = side(fb_[ids], cb, t)
        la = np.zeros(len(ids)); lb = np.zeros(len(ids))
        for tt in np.unique(tex):
            m1 = tex[fa_[ids]] == tt; m2 = tex[fb_[ids]] == tt
            if m1.any(): la[m1] = cv.cvtColor(bilinear(imgs[tt], pa[m1]).astype(np.float32).reshape(-1, 1, 3), cv.COLOR_BGR2GRAY).ravel()
            if m2.any(): lb[m2] = cv.cvtColor(bilinear(imgs[tt], pb[m2]).astype(np.float32).reshape(-1, 1, 3), cv.COLOR_BGR2GRAY).ravel()
        ok = (la > 8) & (lb > 8) & (la < 250) & (lb < 250)
        lr = np.log(la[ok]/lb[ok])
        r = {'n': int(ok.sum()), 'abs_logratio_p50_p90': np.quantile(abs(lr), [.5, .9]).tolist(),
             'abs_dL_p50_p90': np.quantile(abs(la[ok]-lb[ok]), [.5, .9]).tolist()}
        if name == 'søm':
            # systematisk forskyvning per chart-par (eksponeringsfeil gir konstant fortegn langs sømmen)
            ca, cb_ = chart[fa_[ids]][ok], chart[fb_[ids]][ok]
            pair = np.minimum(ca, cb_)*10**7+np.maximum(ca, cb_)
            sgn = np.where(ca < cb_, 1, -1)*lr
            pu, pinv, pc = np.unique(pair, return_inverse=True, return_counts=True)
            mean = np.bincount(pinv, weights=sgn)/pc
            big = pc >= 10
            r['chartpar_med_>=10_prøver'] = int(big.sum())
            r['chartpar_abs_middel_logratio_p50_p90'] = np.quantile(abs(mean[big]), [.5, .9]).tolist() if big.any() else None
        for c in ['vegg', 'tak', 'gulv', 'annet']:
            m = (cls[fa_[ids]][ok] == c) & (cls[fb_[ids]][ok] == c)
            if m.sum() > 50:
                r[f'{c}_abs_logratio_p50_p90'] = np.quantile(abs(lr[m]), [.5, .9]).tolist()
        res[name] = r
    return res


def padding(img, UV, F, tex, chart, t, outdir, tag):
    h, w = img.shape[:2]
    fs = np.where(tex == t)[0]
    lab = np.zeros((h, w), np.int32)
    pts = (UV[F[fs]]*[w, h]*16).round().astype(np.int32)  # shift=4
    ch = chart[fs]
    for c in np.unique(ch):
        sel = pts[ch == c]
        cv.fillPoly(lab, list(sel), int(c)+1, lineType=cv.LINE_8, shift=4)
    occ = lab > 0
    r = {'tekstur': t, 'okkupert_andel': float(occ.mean())}
    free = (~occ).astype(np.uint8)
    dist, lbl = cv.distanceTransformWithLabels(free, cv.DIST_L2, 5, labelType=cv.DIST_LABEL_PIXEL)
    # lbl: indeks for nærmeste null-piksel (okkupert). Kartlegg indeks -> chart.
    ys, xs = np.nonzero(free == 0)
    idx_chart = np.zeros(lbl.max()+1, np.int32)
    idx_chart[lbl[ys, xs]] = lab[ys, xs]
    near = idx_chart[lbl]
    # Voronoi-grenser mellom ulike charts i fri plass: gap ~ 2*avstand
    vor = (near[:, 1:] != near[:, :-1]) & (free[:, 1:] > 0) & (free[:, :-1] > 0)
    dd = dist[:, 1:][vor]
    vor2 = (near[1:, :] != near[:-1, :]) & (free[1:, :] > 0) & (free[:-1, :] > 0)
    dd = np.concatenate([dd, dist[1:, :][vor2]])
    if len(dd):
        r['gap_mellom_charts_px_p1_p10_p50'] = (2*np.quantile(dd, [.01, .1, .5])).tolist()
    # direkte naboskap uten gap: piksler der to ulike charts møtes
    touch = ((lab[:, 1:] != lab[:, :-1]) & (lab[:, 1:] > 0) & (lab[:, :-1] > 0)).sum()
    r['charts_som_berører_hverandre_pikselkanter'] = int(touch)
    # utfylling (bleed): fargede piksler i ring d utenfor charts
    far = free.astype(bool) & (dist > 40)
    bg = None
    if far.sum() > 1000:
        bg = np.median(img[far].reshape(-1, 3), axis=0)
    else:
        bg = np.array([0, 0, 0.])
    r['bakgrunn_bgr'] = bg.tolist()
    rings = {}
    diff = abs(img.astype(np.int16)-bg.astype(np.int16)).max(2)
    for d0 in [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]:
        m = free.astype(bool) & (dist > d0-1) & (dist <= d0)
        if m.sum() > 100:
            rings[str(d0)] = float((diff[m] > 12).mean())
    r['ikke_bakgrunn_andel_per_ring_px'] = rings
    # lagre forhåndsvisning av okkupasjon
    prev = cv.resize(img, (1024, round(h*1024/w)))
    occp = cv.resize(occ.astype(np.uint8)*255, (1024, round(h*1024/w)), interpolation=cv.INTER_AREA)
    cv.imwrite(str(outdir/f'{tag}-atlas.jpg'), prev)
    cv.imwrite(str(outdir/f'{tag}-okkupasjon.png'), occp)
    return r


def main():
    outdir = Path(sys.argv[1]); outdir.mkdir(parents=True, exist_ok=True)
    allr = []
    for p in sys.argv[2:]:
        r = analyse(Path(p), outdir); allr.append(r)
        (outdir/f'{Path(p).stem}-forensikk.json').write_text(json.dumps(r, indent=1, ensure_ascii=False, default=str))
        print(json.dumps({k: v for k, v in r.items() if k != 'json'}, indent=1, ensure_ascii=False, default=str))
        print(json.dumps(r['json'], indent=1, ensure_ascii=False, default=str)[:4000])


if __name__ == '__main__':
    main()
