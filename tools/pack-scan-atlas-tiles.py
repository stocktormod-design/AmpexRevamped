#!/usr/bin/env python3
"""Pack MeshBakeV2's four diagnostic raster crops into a standard multi-material GLB.

Usage: script matching-bake.glb matching-trace-directory output.glb
Clip triangles at UV tile boundaries; preserve surface position and area. Eight
pixels of gutter must match meshscan.atlastiles. No atlas image resampling occurs.
"""
import json
import struct
import sys
from pathlib import Path
import cv2 as cv
import numpy as np


def main():
    source, trace, destination = map(Path, sys.argv[1:])
    data = source.read_bytes()
    js = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20+js])
    binary_source = data[28+js:]

    def read(i):
        a = meta['accessors'][i]; v = meta['bufferViews'][a['bufferView']]
        width = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        return np.frombuffer(binary_source, dtype='<u4' if a['componentType'] == 5125 else '<f4',
                             offset=v.get('byteOffset', 0)+a.get('byteOffset', 0),
                             count=a['count']*width).reshape(-1, width)

    p = meta['meshes'][0]['primitives'][0]
    vertices = np.concatenate([read(p['attributes'][name]) for name in ['POSITION', 'NORMAL', 'TEXCOORD_0']], axis=1)
    triangles = vertices[read(p['indices']).reshape(-1, 3)].astype(float)
    assert np.isfinite(triangles).all()
    assert triangles[..., 6:].min() >= 0 and triangles[..., 6:].max() <= 1

    def area(t):
        return np.linalg.norm(np.cross(t[:, 1, :3]-t[:, 0, :3], t[:, 2, :3]-t[:, 0, :3]), axis=1).sum()/2

    def clip(poly, axis, boundary, sign):
        out = []
        for a, b in zip(poly, poly[1:]+poly[:1]):
            da, db = sign*(a[axis]-boundary), sign*(b[axis]-boundary)
            if da >= 0:
                out.append(a)
            if (da >= 0) != (db >= 0):
                out.append(a+(b-a)*(da/(da-db)))
        return out

    binary = bytearray(); views = []; accessors = []; primitives = []; images = []
    materials = []; textures = []; counts = []; areas = []; pixels = 0

    def append(payload, target=None):
        v = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(payload)}
        if target:
            v['target'] = target
        views.append(v); binary.extend(payload); binary.extend(b'\0'*((-len(binary)) % 4))
        return len(views)-1

    def accessor(a, kind, index=False):
        a = np.asarray(a, dtype='<u4' if index else '<f4')
        v = {'bufferView': append(a.tobytes(), 34963 if index else 34962), 'count': len(a),
             'type': kind, 'componentType': 5125 if index else 5126}
        if kind == 'VEC3':
            v.update(min=a.min(axis=0).tolist(), max=a.max(axis=0).tolist())
        accessors.append(v)
        return len(accessors)-1

    for tile in range(4):
        x, y = tile % 2, tile // 2
        lo, hi = np.array([x, y])*.5, (np.array([x, y])+1)*.5
        intersects = ((triangles[..., 6:].max(axis=1) >= lo) & (triangles[..., 6:].min(axis=1) <= hi)).all(axis=1)
        result = []
        for triangle in triangles[intersects]:
            poly = list(triangle)
            for axis in range(2):
                poly = clip(poly, axis+6, lo[axis], 1)
                poly = clip(poly, axis+6, hi[axis], -1)
            for k in range(1, len(poly)-1):
                result.append([poly[0], poly[k], poly[k+1]])
        t = np.asarray(result)
        nonzero = np.linalg.norm(np.cross(t[:, 1, :3]-t[:, 0, :3], t[:, 2, :3]-t[:, 0, :3]), axis=1) > 1e-16
        t = t[nonzero]
        areas.append(float(area(t))); counts.append(len(t))
        texture = (trace/f'atlas-tile-{tile}.jpg').read_bytes()
        image = cv.imdecode(np.frombuffer(texture, np.uint8), cv.IMREAD_COLOR)
        assert image is not None and image.shape[0] == image.shape[1]
        n = image.shape[0]; pixels += n*n; padding = 8/n
        t[..., 6:] = (t[..., 6:]*2-[x, y])*(1-2*padding)+padding
        a = t.reshape(-1, 8)
        attrs = {name: accessor(a[:, start:end], kind) for name, start, end, kind in
                 [('POSITION', 0, 3, 'VEC3'), ('NORMAL', 3, 6, 'VEC3'), ('TEXCOORD_0', 6, 8, 'VEC2')]}
        idx = accessor(np.arange(len(a)), 'SCALAR', True)
        primitives.append({'attributes': attrs, 'indices': idx, 'material': tile, 'mode': 4})
        images.append({'bufferView': append(texture), 'mimeType': 'image/jpeg'})
        textures.append({'source': tile, 'sampler': 0})
        materials.append({'name': f'atlas_tile_{tile}', 'doubleSided': True, 'extensions': {'KHR_materials_unlit': {}},
                          'pbrMetallicRoughness': {'baseColorTexture': {'index': tile}, 'metallicFactor': 0, 'roughnessFactor': 1}})
    original_area = float(area(triangles))
    assert abs(sum(areas)-original_area) < original_area*1e-6, 'Surface area changed during tile clipping'
    out = {'asset': {'version': '2.0', 'generator': 'Ampex tiled-atlas diagnostic'}, 'extensionsUsed': ['KHR_materials_unlit'],
           'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}], 'meshes': [{'primitives': primitives}],
           'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(binary)}],
           'images': images, 'textures': textures, 'materials': materials, 'samplers': meta['samplers']}
    encoded = json.dumps(out, separators=(',', ':')).encode(); encoded += b' '*((-len(encoded)) % 4)
    total = 28+len(encoded)+len(binary)
    destination.write_bytes(struct.pack('<5I', 0x46546c67, 2, total, len(encoded), 0x4e4f534a)+encoded
                            +struct.pack('<2I', len(binary), 0x004e4942)+binary)
    report = {'input_triangles': len(triangles), 'tile_triangles': counts, 'input_area_m2': original_area,
              'output_area_m2': sum(areas), 'texture_pixels': pixels, 'rgba_mib_without_mips': pixels*4/2**20,
              'output_bytes': total}
    destination.with_suffix('.json').write_text(json.dumps(report, indent=2)); print(json.dumps(report))


if __name__ == '__main__':
    main()
