#!/usr/bin/env python3
"""Diagnostic GLB: replace one measured wall's atlas UVs with source-image crops.

Usage: script mesh.glb regions.json region-id frames-dir trace-dir output.glb [scale]
Requires the region/trace belonging to this exact mesh. Geometry and frame winners
are preserved. Tone corrections, feathering and warp are intentionally absent on
the selected wall: compare scales of this SAME control to isolate sampling loss.
This is not a production exporter or evidence of correct cross-view alignment.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import cv2 as cv


def main():
    mesh, regions, rid, frames_dir, trace_dir, output, *rest = sys.argv[1:]
    scale = float(rest[0]) if rest else 1.0
    assert 0 < scale <= 1
    data = Path(mesh).read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20+size])
    source_bin = data[28+size:]

    def view(i):
        v = meta['bufferViews'][i]
        start = v.get('byteOffset', 0)
        return source_bin[start:start+v['byteLength']]

    def array(i):
        a = meta['accessors'][i]
        count = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        return np.frombuffer(view(a['bufferView']), dtype={5126: '<f4', 5125: '<u4'}[a['componentType']],
                             count=a['count']*count, offset=a.get('byteOffset', 0)).reshape(-1, count)

    primitive = meta['meshes'][0]['primitives'][0]
    pos = array(primitive['attributes']['POSITION'])
    normal = array(primitive['attributes']['NORMAL'])
    uv = array(primitive['attributes']['TEXCOORD_0'])
    triangles = array(primitive['indices']).reshape(-1, 3)
    winners = np.fromfile(Path(trace_dir)/'labels-winner.i32', dtype='<i4')
    assert len(winners) == len(triangles)
    frames = json.loads((Path(trace_dir)/'refined-kf.json').read_text())
    region = json.loads(Path(regions).read_text())['regions'][int(rid)]
    selected = np.zeros(len(triangles), bool)
    selected[region['triangle_indices']] = True
    groups = []
    accepted = np.zeros(len(triangles), bool)
    pixels = 0
    # Each crop retains the original pixel grid. PNG avoids a second JPEG loss.
    for fi in sorted(set(winners[selected]) - {-1}):
        f = frames[fi]
        ids = np.flatnonzero(selected & (winners == fi))
        p = pos[triangles[ids]].astype(float)
        w2c = np.linalg.inv(np.array(f['transform']).reshape(4, 4).T)
        camera = p@w2c[:3, :3].T+w2c[:3, 3]
        z = -camera[..., 2]
        fx, fy, cx, cy = f['intrinsics']
        projected = np.stack([fx*camera[..., 0]/z+cx, -fy*camera[..., 1]/z+cy], -1)
        valid = ((z > .05) & (projected[..., 0] >= 2) & (projected[..., 0] < f['width']-2)
                 & (projected[..., 1] >= 2) & (projected[..., 1] < f['height']-2)).all(axis=1)
        ids, projected = ids[valid], projected[valid]
        if not len(ids):
            continue
        lo = np.maximum(0, np.floor(projected.min(axis=(0, 1))).astype(int)-8)
        hi = np.minimum([f['width'], f['height']], np.ceil(projected.max(axis=(0, 1))).astype(int)+8)
        image = cv.imread(str(Path(frames_dir)/f['file']))
        assert image is not None
        crop = image[lo[1]:hi[1], lo[0]:hi[0]]
        new_size = tuple(np.maximum(1, np.rint((hi-lo)*scale)).astype(int))
        if (crop.shape[1], crop.shape[0]) != new_size:
            crop = cv.resize(crop, new_size, interpolation=cv.INTER_AREA)
        ok, encoded = cv.imencode('.png', crop)
        assert ok
        pixels += crop.shape[0]*crop.shape[1]
        groups.append((ids, ((projected-lo)/(hi-lo)).astype('<f4'), encoded.tobytes(), f['index']))
        accepted[ids] = True

    binary = bytearray()
    accessors, views, primitives, materials, textures, images = [], [], [], [], [], []

    def append(payload, target=None):
        entry = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(payload)}
        if target:
            entry['target'] = target
        views.append(entry)
        binary.extend(payload)
        binary.extend(b'\0'*((-len(binary)) % 4))
        return len(views)-1

    def accessor(values, kind, component=5126):
        values = np.asarray(values, dtype='<u4' if component == 5125 else '<f4')
        entry = {'bufferView': append(values.tobytes(), 34963 if component == 5125 else 34962),
                 'componentType': component, 'count': len(values), 'type': kind}
        if kind == 'VEC3':
            entry.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        accessors.append(entry)
        return len(accessors)-1

    def part(ids, coords, image, mime, name):
        points = pos[triangles[ids]].reshape(-1, 3)
        norms = normal[triangles[ids]].reshape(-1, 3)
        index = len(materials)
        attrs = {'POSITION': accessor(points, 'VEC3'), 'NORMAL': accessor(norms, 'VEC3'),
                 'TEXCOORD_0': accessor(coords.reshape(-1, 2), 'VEC2')}
        idx = accessor(np.arange(len(points)), 'SCALAR', 5125)
        primitives.append({'attributes': attrs, 'indices': idx, 'material': index, 'mode': 4})
        materials.append({'name': name, 'extensions': {'KHR_materials_unlit': {}}, 'doubleSided': True,
                          'pbrMetallicRoughness': {'baseColorTexture': {'index': index},
                                                   'metallicFactor': 0, 'roughnessFactor': 1}})
        textures.append({'source': index, 'sampler': 0})
        images.append({'bufferView': append(image), 'mimeType': mime})

    fallback = np.flatnonzero(~accepted)
    source_image = meta['images'][0]
    part(fallback, uv[triangles[fallback]], view(source_image['bufferView']), source_image['mimeType'], 'atlas_control')
    for ids, coords, image, fi in groups:
        part(ids, coords, image, 'image/png', f'source_frame_{fi}')
    result = {'asset': {'version': '2.0', 'generator': 'Ampex source-texture diagnostic'},
              'extensionsUsed': ['KHR_materials_unlit'], 'scene': 0, 'scenes': [{'nodes': [0]}],
              'nodes': [{'mesh': 0}], 'meshes': [{'primitives': primitives}], 'accessors': accessors,
              'bufferViews': views, 'buffers': [{'byteLength': len(binary)}], 'materials': materials,
              'textures': textures, 'images': images,
              'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]}
    encoded = json.dumps(result, separators=(',', ':')).encode()
    encoded += b' '*((-len(encoded)) % 4)
    total = 28+len(encoded)+len(binary)
    Path(output).write_bytes(struct.pack('<5I', 0x46546c67, 2, total, len(encoded), 0x4e4f534a)
                            +encoded+struct.pack('<2I', len(binary), 0x004e4942)+binary)
    report = {'region': int(rid), 'scale': scale, 'wall_triangles': int(selected.sum()),
              'source_triangles': int(accepted.sum()), 'source_textures': len(groups),
              'source_pixels': pixels, 'source_rgba_mib_without_mips': pixels*4/2**20,
              'total_triangles': len(triangles), 'output_bytes': total}
    Path(output).with_suffix('.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    main()
