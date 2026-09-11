#!/usr/bin/env python3
"""Export actual photo-change edges for a matching Ampex GLB/trace, without edits.

Usage: script model.glb trace-directory output.json
Only manifold edges shared by two vertical faces are included. Coincident positions
are welded at 10 micrometres to reconnect UV splits. Length is diagnostic; it does
not measure image misalignment, and fewer seams need not mean a sharper texture.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np

data = Path(sys.argv[1]).read_bytes()
size = struct.unpack_from('<I', data, 12)[0]
meta = json.loads(data[20:20+size])
binary = data[28+size:]
def read(i, width, dtype):
    a = meta['accessors'][i]; v = meta['bufferViews'][a['bufferView']]
    assert 'byteStride' not in v
    return np.frombuffer(binary, dtype=dtype, count=a['count']*width,
                         offset=v.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, width)
p = meta['meshes'][0]['primitives'][0]
positions = read(p['attributes']['POSITION'], 3, '<f4').astype(float)
indices = read(p['indices'], 1, '<u4').reshape(-1, 3)
xyz = positions[indices]
trace = Path(sys.argv[2])
labels = np.fromfile(trace/'labels-winner.i32', dtype='<i4')
assert len(labels) == len(indices)
frames = json.loads((trace/'refined-kf.json').read_text())
cross = np.cross(xyz[:, 1]-xyz[:, 0], xyz[:, 2]-xyz[:, 0])
length = np.linalg.norm(cross, axis=1)
vertical = (length > 1e-10) & (abs(cross[:, 1])/np.maximum(length, 1e-12) < .3)
_, first, welded = np.unique(np.rint(positions/1e-5).astype(np.int64), axis=0,
                             return_index=True, return_inverse=True)
edges = {}
for t, face in enumerate(welded[indices]):
    for j in range(3):
        a, b = sorted((int(face[j]), int(face[(j+1) % 3])))
        edges.setdefault((a, b), []).append(t)
segments, pairs = [], {}
for (a, b), faces in edges.items():
    if len(faces) != 2:
        continue
    t, u = faces
    if not (vertical[t] and vertical[u]) or min(labels[t], labels[u]) < 0 or labels[t] == labels[u]:
        continue
    start, end = positions[first[a]], positions[first[b]]
    distance = float(np.linalg.norm(end-start))
    key = tuple(sorted((frames[labels[t]]['index'], frames[labels[u]]['index'])))
    pairs[key] = pairs.get(key, 0)+distance
    segments.append([start.tolist(), end.tolist()])
result = {'model': str(Path(sys.argv[1]).resolve()), 'segments': segments,
          'vertical_seam_edges': len(segments), 'vertical_seam_length_m': sum(pairs.values()),
          'pairs': [{'frames': key, 'length_m': value} for key, value in sorted(pairs.items(), key=lambda x: -x[1])]}
Path(sys.argv[3]).write_text(json.dumps(result, separators=(',', ':')))
print(json.dumps({k: v for k, v in result.items() if k != 'segments'}, indent=2))
