#!/usr/bin/env python3
"""Locate a visible mesh defect and report raw-depth agreement per camera.

Usage: script GLB fixture-directory camera-index screenshot-x screenshot-y
Matches render-frame.swift's centered 1400x788 vertical-FOV camera, not raw RGB
pixel coordinates. Reports measurements only; never modifies a fixture.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np

glb, root = Path(sys.argv[1]), Path(sys.argv[2])
camera, sx, sy = int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
data = glb.read_bytes()
jlen = struct.unpack_from('<I', data, 12)[0]
meta = json.loads(data[20:20+jlen])
binary = 28+jlen
def accessor(index, dtype, columns):
    a = meta['accessors'][index]
    v = meta['bufferViews'][a['bufferView']]
    assert 'byteStride' not in v, 'Interleaved accessors unsupported'
    offset = binary+v.get('byteOffset', 0)+a.get('byteOffset', 0)
    return np.frombuffer(data, dtype=dtype, count=a['count']*columns,
                         offset=offset).reshape(-1, columns)
vertices = accessor(0, '<f4', 3).astype(float)
triangles = accessor(3, '<u4', 1).reshape(-1, 3)
frames = json.loads((root/'fixture-kf.json').read_text())
frame = next(f for f in frames if f['index'] == camera)
pose = np.array(frame['transform']).reshape(4, 4).T
focal = frame['intrinsics'][1]*788/frame['height']
direction = pose[:3, :3]@np.array([(sx-700)/focal, -(sy-394)/focal, -1.])
direction /= np.linalg.norm(direction)
origin = pose[:3, 3]
a, b, c = (vertices[triangles[:, k]] for k in range(3))
e1, e2 = b-a, c-a
h = np.cross(direction, e2)
det = np.sum(e1*h, axis=1)
valid = np.abs(det) > 1e-10
inv = np.divide(1., det, out=np.zeros_like(det), where=valid)
s = origin-a
u = inv*np.sum(s*h, axis=1)
q = np.cross(s, e1)
v = inv*(q@direction)
distance = inv*np.sum(e2*q, axis=1)
valid &= (u >= 0) & (v >= 0) & (u+v <= 1) & (distance > .05)
assert valid.any(), 'Ray missed mesh'
hit = int(np.argmin(np.where(valid, distance, np.inf)))
point = origin+direction*distance[hit]
normal = np.cross(e1[hit], e2[hit]); normal /= np.linalg.norm(normal)
observations = []
for f in frames:
    tf = np.array(f['transform']).reshape(4, 4).T
    local = np.linalg.inv(tf)@np.append(point, 1.)
    z = -local[2]
    if z <= 0: continue
    fx, fy, cx, cy = f['intrinsics']
    x, y = fx*local[0]/z+cx, -fy*local[1]/z+cy
    if not (0 <= x < f['width'] and 0 <= y < f['height']): continue
    row = {'file': f['file'], 'pixel': [x, y], 'mesh_depth_m': z}
    if f.get('depthFile'):
        dw, dh = f['depthWidth'], f['depthHeight']
        depth = np.fromfile(root/f['depthFile'], dtype='<f4').reshape(dh, dw)
        dx, dy = int(x/f['width']*dw), int(y/f['height']*dh)
        patch = depth[max(0,dy-1):dy+2, max(0,dx-1):dx+2]
        measured = float(depth[dy, dx])
        good = patch[np.isfinite(patch) & (patch > .05)]
        row.update(raw_depth_m=measured if np.isfinite(measured) else None,
                   mesh_minus_raw_m=z-measured if np.isfinite(measured) and measured>.05 else None,
                   neighborhood_span_m=float(np.ptp(good)) if good.size else None)
    observations.append(row)
print(json.dumps({'mesh': str(glb), 'camera': camera, 'screenshot_pixel': [sx, sy],
                  'triangle': hit, 'point': point.tolist(), 'normal': normal.tolist(),
                  'observations': observations}, indent=2, allow_nan=False))
