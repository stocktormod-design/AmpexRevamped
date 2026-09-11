#!/usr/bin/env python3
"""Verify UV tiling on a sloped, continuous wall across all four texture pages."""
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
import cv2 as cv
import numpy as np

with tempfile.TemporaryDirectory(prefix='ampex-atlas-test-') as directory:
    root = Path(directory)
    uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype='<f4')
    pos = np.column_stack([uv, 2*uv[:, 0]+uv[:, 1]]).astype('<f4')
    normal = np.tile(np.array([-2, -1, 1])/np.sqrt(6), (4, 1)).astype('<f4')
    arrays = [pos, normal, uv, np.array([0, 1, 2, 0, 2, 3], dtype='<u4')]
    binary = b''; views = []; accessors = []
    for a, kind in zip(arrays, ['VEC3', 'VEC3', 'VEC2', 'SCALAR']):
        views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': a.nbytes})
        accessors.append({'bufferView': len(views)-1, 'componentType': 5125 if kind == 'SCALAR' else 5126,
                          'type': kind, 'count': len(a)})
        binary += a.tobytes()
    meta = {'accessors': accessors, 'bufferViews': views,
            'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3}]}],
            'samplers': [{'wrapS': 33071, 'wrapT': 33071, 'magFilter': 9729, 'minFilter': 9987}]}
    j = json.dumps(meta).encode(); j += b' '*((-len(j)) % 4)
    (root/'input.glb').write_bytes(struct.pack('<5I', 0x46546c67, 2, 28+len(j)+len(binary), len(j), 0x4e4f534a)
                                  +j+struct.pack('<2I', len(binary), 0x004e4942)+binary)
    for tile in range(4):
        assert cv.imwrite(str(root/f'atlas-tile-{tile}.jpg'), np.full((64, 64, 3), 50+tile*50, np.uint8))
    subprocess.run([sys.executable, str(Path(__file__).with_name('pack-scan-atlas-tiles.py')),
                    str(root/'input.glb'), str(root), str(root/'output.glb')], check=True, capture_output=True)
    d = (root/'output.glb').read_bytes(); n = struct.unpack_from('<I', d, 12)[0]; m = json.loads(d[20:20+n])
    def read(i):
        a = m['accessors'][i]; v = m['bufferViews'][a['bufferView']]
        width = {'VEC2': 2, 'VEC3': 3, 'SCALAR': 1}[a['type']]
        return np.frombuffer(d, dtype='<u4' if width == 1 else '<f4', count=a['count']*width,
                             offset=28+n+v['byteOffset']).reshape(-1, width)
    primitives = m['meshes'][0]['primitives']
    assert len(primitives) == 4
    for tile, p in enumerate(primitives):
        xyz = read(p['attributes']['POSITION']); tex = read(p['attributes']['TEXCOORD_0'])
        assert np.allclose(xyz[:, 2], 2*xyz[:, 0]+xyz[:, 1]), 'Wall moved'
        assert np.allclose(read(p['attributes']['NORMAL']), normal[0]), 'Normal changed'
        restored = ((tex-8/64)/(1-16/64)+[tile % 2, tile // 2])/2
        assert np.allclose(restored, xyz[:, :2]), 'Texture shifted'
        assert np.all(tex >= 8/64) and np.all(tex <= 1-8/64), 'Missing filter border'
        tris = xyz[read(p['indices']).reshape(-1, 3)]
        area = np.linalg.norm(np.cross(tris[:, 1]-tris[:, 0], tris[:, 2]-tris[:, 0]), axis=1).sum()/2
        assert np.isclose(area, np.sqrt(6)/4), 'Missing or duplicate quadrant'
    print('PASS: four pages preserve wall position, normals, UV alignment, filter borders and per-page area')
