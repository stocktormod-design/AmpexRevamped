#!/usr/bin/env python3
"""Compare mesh-ray and recorded-depth reprojection on identical held RGB matches.

Usage: script GLB camera-fixture feature-results.json
Use a fixture containing refined-kf.json renamed fixture-kf.json to audit native
post-refinement cameras. No fitting, pose edits, or texture changes are performed.
Features are in the 1600-pixel-wide coordinates used by audit-scan-features.py.
Nearest mesh intersection is not proof of correct visibility at thin objects.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np


def load_mesh(path):
    data = Path(path).read_bytes()
    n = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20+n])
    def read(i):
        a = meta['accessors'][i]
        b = meta['bufferViews'][a['bufferView']]
        assert 'byteStride' not in b, 'Requires contiguous Ampex GLB'
        columns = {'VEC3': 3, 'SCALAR': 1}[a['type']]
        return np.frombuffer(data, dtype={5126: '<f4', 5125: '<u4'}[a['componentType']],
                             count=a['count']*columns,
                             offset=28+n+b.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, columns)
    primitive = meta['meshes'][0]['primitives'][0]
    return read(primitive['attributes']['POSITION']).astype(float)[read(primitive['indices']).reshape(-1, 3)]


def ray_hit(tris, origin, direction):
    a = tris[:, 0]
    e1, e2 = tris[:, 1]-a, tris[:, 2]-a
    h = np.cross(direction, e2)
    det = np.sum(e1*h, axis=1)
    valid = np.abs(det) > 1e-10
    inv = np.divide(1., det, out=np.zeros_like(det), where=valid)
    s = origin-a
    u = inv*np.sum(s*h, axis=1)
    q = np.cross(s, e1)
    v = inv*np.sum(q*direction, axis=1)
    distance = inv*np.sum(e2*q, axis=1)
    valid &= (u >= 0) & (v >= 0) & (u+v <= 1) & (distance > .05)
    if not valid.any():
        return None
    return origin+direction*np.min(distance[valid])


def main():
    tris = load_mesh(sys.argv[1])
    root = Path(sys.argv[2])
    frames = {f['index']: f for f in json.loads((root/'fixture-kf.json').read_text())}
    pairs = json.loads(Path(sys.argv[3]).read_text())['pairs']
    results = []
    for pair in pairs:
        if 'source_points' not in pair:
            continue
        if pair.get('epipolar_held_median_px', float('inf')) > 2 or pair.get('epipolar_held_under2px', 0) < .75*pair['held_count']:
            continue
        r, t = frames[pair['reference']], frames[pair['target']]
        rt = np.array(r['transform']).reshape(4, 4).T
        ti = np.linalg.inv(np.array(t['transform']).reshape(4, 4).T)
        fr = np.array(r['intrinsics'])*1600/r['width']
        ft = np.array(t['intrinsics'])*1600/t['width']
        depth = np.fromfile(root/r['depthFile'], dtype='<f4').reshape(r['depthHeight'], r['depthWidth'])
        rows = []
        for n, ((u, v), target) in enumerate(zip(pair['source_points'], pair['target_points'])):
            if not pair['held'][n]:
                continue
            ix, iy = int(u/1600*r['depthWidth']), int(v/(1600*r['height']/r['width'])*r['depthHeight'])
            if not (1 <= ix < r['depthWidth']-1 and 1 <= iy < r['depthHeight']-1):
                continue
            patch = depth[iy-1:iy+2, ix-1:ix+2]
            z = float(depth[iy, ix])
            if not np.isfinite(patch).all() or z < .25 or np.ptp(patch) > .08:
                continue
            local = np.array([(u-fr[2])/fr[0], -(v-fr[3])/fr[1], -1.])
            direction = rt[:3, :3]@local
            hit = ray_hit(tris, rt[:3, 3], direction)
            row = {'match': n, 'source': [u, v], 'target': target, 'raw_depth_m': z}
            for name, point in [('depth', rt[:3, 3]+direction*z), ('mesh', hit)]:
                if point is None:
                    row[name+'_error_px'] = None
                    continue
                p = ti@np.append(point, 1.)
                if p[2] >= -.05:
                    row[name+'_error_px'] = None
                    continue
                uv = np.array([ft[0]*p[0]/-p[2]+ft[2], -ft[1]*p[1]/-p[2]+ft[3]])
                row[name+'_error_px'] = float(np.linalg.norm(uv-target))
                row[name+'_delta_px'] = (uv-target).tolist()
            if hit is not None:
                row['mesh_minus_depth_mm'] = float((np.dot(hit-rt[:3, 3], direction)/np.dot(direction, direction)-z)*1000)
            rows.append(row)
        common = [row for row in rows if row['mesh_error_px'] is not None and row['depth_error_px'] is not None]
        summary = {}
        for name in ['depth', 'mesh']:
            e = [row[name+'_error_px'] for row in common]
            summary[name] = {'median': float(np.median(e)), 'p90': float(np.quantile(e, .9)), 'under5': int(np.sum(np.array(e) < 5))} if e else None
        results.append({'pair': [r['index'], t['index']], 'held_depth_valid': len(rows), 'common': len(common), 'summary': summary, 'matches': rows})
    print(json.dumps(results, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
