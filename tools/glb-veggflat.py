# Legger de største veggene i en GLB flatt ut (ortografisk, rett på) og skriver PNG per vegg.
# Brukes til å sammenligne to baker av SAMME bundle side om side: planene finnes i den første
# GLB-en og gjenbrukes for resten, så utsnittene dekker nøyaktig samme flate.
#
#   python3 tools/glb-veggflat.py <utmappe> <mm_per_px> <a.glb> [b.glb ...]
#
# Rødt = ingen flate (hull). Ingen render, ingen lys: teksturen slik den ligger i atlaset.
import io, json, struct, sys, os
import numpy as np
from PIL import Image

def load(glb):
    b = open(glb, 'rb').read(); ln = struct.unpack('<I', b[8:12])[0]; off = 12; ch = []
    while off < ln:
        cl = struct.unpack('<I', b[off:off+4])[0]; ch.append((off+8, cl)); off += 8 + cl
    j = json.loads(b[ch[0][0]:ch[0][0]+ch[0][1]].decode()); bn = b[ch[1][0]:ch[1][0]+ch[1][1]]
    def view(i):
        bv = j['bufferViews'][i]; o = bv.get('byteOffset', 0); return bn[o:o+bv['byteLength']]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        ct = {5121: 'u1', 5123: 'u2', 5125: 'u4', 5126: 'f4'}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        return np.frombuffer(bn, dtype=np.dtype(ct), count=a['count']*n, offset=base).reshape(-1, n)
    imgs = [np.asarray(Image.open(io.BytesIO(view(im['bufferView']))).convert('RGB')) for im in j.get('images', [])]
    prims = []
    for m in j['meshes']:
        for pr in m['primitives']:
            P = acc(pr['attributes']['POSITION']).astype(np.float64)
            UV = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in pr['attributes'] else None
            I = acc(pr['indices']).astype(np.int64).reshape(-1, 3)
            tex = None
            if 'material' in pr:
                pbr = j['materials'][pr['material']].get('pbrMetallicRoughness', {})
                if 'baseColorTexture' in pbr:
                    tex = imgs[j['textures'][pbr['baseColorTexture']['index']]['source']]
            prims.append((P, UV, I, tex))
    return prims

def walls(prims, k=3):
    a = []; n_ = []; c_ = []
    for P, UV, I, tex in prims:
        A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
        n = np.cross(B - A, C - A); L = np.linalg.norm(n, axis=1); ok = L > 1e-12
        n_.append(n[ok] / L[ok, None]); a.append(0.5 * L[ok]); c_.append(((A + B + C) / 3)[ok])
    n = np.vstack(n_); ar = np.concatenate(a); cen = np.vstack(c_)
    v = np.abs(n[:, 1]) < 0.2; n, ar, cen = n[v], ar[v], cen[v]
    az = np.degrees(np.arctan2(n[:, 2], n[:, 0])) % 360
    out = []; used = np.zeros(len(n), bool)
    for _ in range(k):
        best = None
        for a0 in range(0, 360, 3):
            s = (~used) & (np.abs((az - a0 + 180) % 360 - 180) < 6)
            if not s.any(): continue
            nm = (n[s] * ar[s, None]).sum(0); nm[1] = 0; nm /= np.linalg.norm(nm)
            d = cen[s] @ nm
            hist, edges = np.histogram(d, bins=np.arange(d.min() - .02, d.max() + .04, .02), weights=ar[s])
            i = hist.argmax(); area = hist[max(0, i-1):i+2].sum()
            if best is None or area > best[0]:
                best = (area, nm, (edges[i] + edges[i+1]) / 2)
        if best is None: break
        _, nm, d0 = best
        out.append((nm, d0))
        used |= (np.abs(n @ nm) > 0.9) & (np.abs(cen @ nm - d0) < 0.05)
    return out

def flat(prims, nm, d0, mmpx, extent=None):
    up = np.array([0., 1., 0.]); u = np.cross(up, nm); u /= np.linalg.norm(u)
    tris = []
    for P, UV, I, tex in prims:
        if UV is None or tex is None: continue
        A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
        n = np.cross(B - A, C - A); L = np.linalg.norm(n, axis=1); ok = L > 1e-12
        nn = np.zeros_like(n); nn[ok] = n[ok] / L[ok, None]
        cen = (A + B + C) / 3
        s = ok & (np.abs(nn @ nm) > 0.85) & (np.abs(cen @ nm - d0) < 0.04)
        tris.append((P, UV, I[s], tex))
    if extent is None:
        pts = np.vstack([P[I.ravel()] for P, _, I, _ in tris if len(I)])
        extent = (np.percentile(pts @ u, .5), np.percentile(pts @ u, 99.5),
                  np.percentile(pts @ up, .5), np.percentile(pts @ up, 99.5))
    u0, u1, v0, v1 = extent; s = 1000.0 / mmpx
    W = int((u1 - u0) * s) + 1; H = int((v1 - v0) * s) + 1
    img = np.zeros((H, W, 3), np.uint8); img[:] = (255, 0, 0)
    for P, UV, I, tex in tris:
        th, tw = tex.shape[:2]
        for t in I:
            q = P[t]; x = (q @ u - u0) * s; y = (v1 - q @ up) * s; uv = UV[t]
            xa, xb = int(max(0, np.floor(x.min()))), int(min(W - 1, np.ceil(x.max())))
            ya, yb = int(max(0, np.floor(y.min()))), int(min(H - 1, np.ceil(y.max())))
            if xa > xb or ya > yb: continue
            den = (y[1]-y[2])*(x[0]-x[2]) + (x[2]-x[1])*(y[0]-y[2])
            if abs(den) < 1e-9: continue
            gx, gy = np.meshgrid(np.arange(xa, xb+1) + .5, np.arange(ya, yb+1) + .5)
            l0 = ((y[1]-y[2])*(gx-x[2]) + (x[2]-x[1])*(gy-y[2])) / den
            l1 = ((y[2]-y[0])*(gx-x[2]) + (x[0]-x[2])*(gy-y[2])) / den
            l2 = 1 - l0 - l1; m = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
            if not m.any(): continue
            tu = l0*uv[0,0] + l1*uv[1,0] + l2*uv[2,0]; tv = l0*uv[0,1] + l1*uv[1,1] + l2*uv[2,1]
            px = np.clip((tu * tw).astype(int), 0, tw-1); py = np.clip((tv * th).astype(int), 0, th-1)
            sub = img[ya:yb+1, xa:xb+1]; sub[m] = tex[py[m], px[m]]
    return img, extent

if __name__ == '__main__':
    outdir, mmpx, glbs = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
    os.makedirs(outdir, exist_ok=True)
    ref = load(glbs[0]); ws = walls(ref); exts = [None] * len(ws)
    for g in glbs:
        prims = ref if g == glbs[0] else load(g)
        tag = os.path.basename(g).removeprefix('rebake-harness-').rsplit('-', 1)[0]
        for wi, (nm, d0) in enumerate(ws):
            img, exts[wi] = flat(prims, nm, d0, mmpx, exts[wi])
            p = os.path.join(outdir, f'vegg{wi}-{tag}.png'); Image.fromarray(img).save(p)
            print(p, img.shape[1], 'x', img.shape[0])
