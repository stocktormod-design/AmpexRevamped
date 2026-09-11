#!/usr/bin/env python3
"""Check experimental panel fields where their source actually wins texture.

Usage: script GLB fixture-kf.json trace-dir line-offsets.json field-fit.json camera
Optional final arguments: input-fields.json filtered-fields.json. Empty output
fields means no candidate survives and a field bake should not be launched.
When input fields are supplied, gates evaluate the actual bilinear grid including
its taper. Without fields, they evaluate the ideal polynomial only.
Only winner-held statistics use grid evaluation; nonwinner rows retain the ideal
model and all-held statistics must not be interpreted as a complete grid audit.
The trace MUST belong to this GLB. No fitting or production changes are performed.
Line coordinates follow the centered 1400x788 render-frame.swift camera. Current
panel experiments reserve x=500/1100 for holdout unless points carry an explicit
held flag; repeated lines remain ambiguous.
Winner support tests detail contributions, not all tone or feather contributions.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np


def main():
    assert len(sys.argv) in [7, 9], __doc__
    glb, fixture, trace, lines, fits, camera = sys.argv[1:7]
    input_fields = json.loads(Path(sys.argv[7]).read_text()) if len(sys.argv) == 9 else None
    data = Path(glb).read_bytes()
    n = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20+n])
    def read(i):
        a = meta['accessors'][i]
        b = meta['bufferViews'][a['bufferView']]
        assert 'byteStride' not in b, 'Requires contiguous Ampex GLB'
        k = {'VEC3': 3, 'SCALAR': 1}[a['type']]
        return np.frombuffer(data, dtype={5126: '<f4', 5125: '<u4'}[a['componentType']],
                             count=a['count']*k,
                             offset=28+n+b.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, k)
    prim = meta['meshes'][0]['primitives'][0]
    xyz = read(prim['attributes']['POSITION']).astype(float)[read(prim['indices']).reshape(-1, 3)]
    labels = np.fromfile(Path(trace)/'labels-winner.i32', dtype='<i4')
    assert len(labels) == len(xyz), 'Trace triangle count differs from mesh'
    native_frames = json.loads((Path(trace)/'refined-kf.json').read_text())
    ids = [f['index'] for f in native_frames]
    f = next(f for f in json.loads(Path(fixture).read_text()) if f['index'] == int(camera))
    pose = np.array(f['transform']).reshape(4, 4).T
    focal = f['intrinsics'][1]*788/f['height']
    a = xyz[:, 0]
    e1, e2 = xyz[:, 1]-a, xyz[:, 2]-a
    s = pose[:3, 3]-a
    q = np.cross(s, e1)
    num = np.sum(e2*q, axis=1)
    def winner(x, y):
        d = pose[:3, :3]@np.array([(x-700)/focal, -(y-394)/focal, -1.])
        h = np.cross(d, e2)
        det = np.sum(e1*h, axis=1)
        valid = abs(det) > 1e-10
        inv = np.divide(1., det, out=np.zeros_like(det), where=valid)
        u, v = inv*np.sum(s*h, axis=1), inv*np.sum(q*d, axis=1)
        distance = inv*num
        valid &= (u >= 0) & (v >= 0) & (u+v <= 1) & (distance > .05)
        if not valid.any():
            return None, None, None
        hit = int(np.argmin(np.where(valid, distance, np.inf)))
        label = int(labels[hit])
        normal = np.cross(e1[hit], e2[hit])
        normal /= np.linalg.norm(normal)
        return (ids[label] if 0 <= label < len(ids) else None,
                pose[:3, 3]+d*distance[hit], normal)
    def applied_shift(source, point, normal, y):
        frame = next(f for f in native_frames if f['index'] == source)
        matrix = np.array(frame['transform']).reshape(4, 4).T
        local = np.linalg.inv(matrix)@np.r_[point, 1.]
        fx, fy, cx, cy = frame['intrinsics']
        assert local[2] < -.05, 'Source cannot see this plane point'
        uv = np.clip(np.array([fx*local[0]/-local[2]+cx, -fy*local[1]/-local[2]+cy])
                     / [frame['width'], frame['height']], 0, 1)
        gw, gh = input_fields['gridWidth'], input_fields['gridHeight']
        grid = np.array(input_fields['fields'][str(source)]).reshape(gh, gw, 2)
        gx, gy = uv*[gw-1, gh-1]
        ix, iy = min(int(gx), gw-2), min(int(gy), gh-2)
        tx, ty = gx-ix, gy-iy
        off = (grid[iy, ix]*(1-tx)*(1-ty)+grid[iy, ix+1]*tx*(1-ty)
               +grid[iy+1, ix]*(1-tx)*ty+grid[iy+1, ix+1]*tx*ty)
        pixel = np.clip(uv+off, 0, 1)*[frame['width'], frame['height']]
        direction = matrix[:3, :3]@np.array([(pixel[0]-cx)/fx, -(pixel[1]-cy)/fy, -1.])
        denominator = np.dot(direction, normal)
        assert abs(denominator) > 1e-8, 'Warped ray is parallel to the local plane'
        distance = np.dot(point-matrix[:3, 3], normal)/denominator
        assert distance > 0, 'Warped point is behind source'
        mapped = np.linalg.inv(pose)@np.r_[matrix[:3, 3]+direction*distance, 1.]
        assert mapped[2] < -.05, 'Warped point is behind render camera'
        return float(394-focal*mapped[1]/-mapped[2]-y)
    all_lines = json.loads(Path(lines).read_text())
    results = []
    for fit in json.loads(Path(fits).read_text()):
        source = fit['frame']
        if input_fields is not None and str(source) not in input_fields['fields']:
            continue
        assert len(fit['coefficients']) in [1, 3, 4], 'Constant, affine or affine+x² field required'
        rows = []
        for line in all_lines:
            if line['cameras'] != 'refined' or line['source'] != source:
                continue
            x = line['x']
            for point in line['pairs']:
                y = point['target_y']
                basis = [1, x/1400-.5, y/788-.5, (x/1400-.5)**2]
                prediction = np.dot(basis[:len(fit['coefficients'])], fit['coefficients'])
                owner, point3d, normal = winner(x, y)
                actual = (applied_shift(source, point3d, normal, y)
                          if input_fields is not None and owner == source else prediction)
                rows.append({'x': x, 'y': y, 'held': point.get('held', x in [500, 1100]),
                             'winner': owner, 'before': point['delta_y'],
                             'ideal_after': float(point['delta_y']-prediction),
                             'after': float(point['delta_y']-actual)})
        summary = {}
        for name, subset in [('all_held', [r for r in rows if r['held']]),
                             ('winner_held', [r for r in rows if r['held'] and r['winner'] == source])]:
            summary[name] = {'count': len(subset)}
            if subset:
                for key in ['before', 'after']:
                    errors = np.abs([r[key] for r in subset])
                    summary[name][key+'_median'] = float(np.median(errors))
                    summary[name][key+'_p90'] = float(np.quantile(errors, .9))
        support = summary['winner_held']
        # Additional experimental gate, not a guarantee of visual quality.
        accepted = (support['count'] >= 6
                    and support['after_median'] <= .5*support['before_median']
                    and support['after_p90'] <= min(2., support['before_p90']))
        results.append({'frame': source, 'winner_gate_passes': accepted,
                        'winner_evaluation': 'bilinear_grid' if input_fields is not None else 'polynomial',
                        'summary': summary, 'rows': rows})
    if len(sys.argv) == 9:
        fields = input_fields
        accepted_ids = {str(r['frame']) for r in results if r['winner_gate_passes']}
        fields['fields'] = {k: v for k, v in fields['fields'].items() if k in accepted_ids}
        Path(sys.argv[8]).write_text(json.dumps(fields, indent=2, allow_nan=False))
    print(json.dumps(results, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
