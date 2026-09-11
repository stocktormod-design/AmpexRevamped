#!/usr/bin/env python3
"""Inspect uncompressed mesh GLBs: texture budgets, surface density and UV islands.

Usage: script output-directory model.glb [model.glb ...]
Area-weighted texel density is diagnostic; UV area sums do not prove no overlap.
Only identity node transforms are supported to keep physical units unambiguous.
"""
import json
import struct
import sys
from pathlib import Path
import cv2 as cv
import numpy as np


def projection_fit(points, texcoords, texture_size):
    """Held-out UV errors for affine and 3D projective mappings, in atlas pixels.

    A close projective fit is consistent with a camera-projected chart; it cannot
    reveal how a vendor selected, aligned or corrected the source photographs.
    """
    if len(points) < 30:
        return None
    rng = np.random.default_rng(728)
    ids = rng.permutation(len(points))[:1800]
    p, uv = points[ids], texcoords[ids] * texture_size
    center = p.mean(axis=0); scale = np.linalg.norm(p-center, axis=1).max()
    x = np.column_stack(((p-center)/max(scale, 1e-12), np.ones(len(p))))
    uv_center = uv.mean(axis=0); uv_scale = np.linalg.norm(uv-uv_center, axis=1).max()
    y = (uv-uv_center)/max(uv_scale, 1e-12)
    test = np.arange(len(x)) % 3 == 0; train = ~test
    affine = np.linalg.lstsq(x[train], y[train], rcond=None)[0]
    rows = np.zeros((2*train.sum(), 12))
    rows[0::2, :4] = x[train]; rows[1::2, 4:8] = x[train]
    rows[0::2, 8:] = -y[train, 0, None]*x[train]
    rows[1::2, 8:] = -y[train, 1, None]*x[train]
    _, singular, vh = np.linalg.svd(rows, full_matrices=False)
    camera = vh[-1].reshape(3, 4)
    projected = x[test] @ camera.T
    if np.any(abs(projected[:, 2]) < 1e-10):
        return {'unstable_projective_fit': True}
    projective_error = np.linalg.norm(projected[:, :2]/projected[:, 2, None]-y[test], axis=1)*uv_scale
    affine_error = np.linalg.norm(x[test]@affine-y[test], axis=1)*uv_scale
    return {'vertices': len(points), 'holdout_vertices': int(test.sum()),
            'affine_error_px_p50_p90': np.quantile(affine_error, [.5, .9]).tolist(),
            'projective_error_px_p50_p90': np.quantile(projective_error, [.5, .9]).tolist(),
            'projective_nullspace_gap': float(singular[-2]/max(singular[-1], 1e-15))}


def inspect(path, out):
    data = path.read_bytes(); n = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20+n]); binary = data[28+n:]
    assert not any(any(k in node for k in ['matrix', 'translation', 'rotation', 'scale']) for node in meta['nodes'])
    def view(i):
        v = meta['bufferViews'][i]; start = v.get('byteOffset', 0)
        return binary[start:start+v['byteLength']]
    def read(i):
        a = meta['accessors'][i]; v = meta['bufferViews'][a['bufferView']]
        dtype = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']])
        width = {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[a['type']]
        return np.ndarray((a['count'], width), dtype=dtype, buffer=view(a['bufferView']),
                          offset=a.get('byteOffset', 0), strides=(v.get('byteStride', dtype.itemsize*width), dtype.itemsize)).copy()
    textures = []
    for i, im in enumerate(meta.get('images', [])):
        payload = view(im['bufferView']); image = cv.imdecode(np.frombuffer(payload, np.uint8), cv.IMREAD_COLOR)
        assert image is not None
        h, w = image.shape[:2]
        textures.append({'width': w, 'height': h, 'bytes': len(payload), 'mime': im['mimeType']})
        (out/f'{path.stem}-texture-{i}.jpg').write_bytes(payload)
        cv.imwrite(str(out/f'{path.stem}-atlas-preview-{i}.jpg'), cv.resize(image, (1200, round(h*1200/w))))
    def quantiles(value, weights):
        valid = np.isfinite(value) & (weights > 1e-12)
        value, weights = value[valid], weights[valid]
        order = np.argsort(value); value, weights = value[order], weights[order]
        cum = np.cumsum(weights)/weights.sum()
        return np.interp([.1, .5, .9], cum, value).tolist()
    primitives = []
    for mesh in meta['meshes']:
        for p in mesh['primitives']:
            pos = read(p['attributes']['POSITION']).astype(float)
            uv = read(p['attributes']['TEXCOORD_0']).astype(float)
            idx = read(p['indices']).reshape(-1, 3)
            tri, tex = pos[idx], uv[idx]
            cross = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]); length = np.linalg.norm(cross, axis=1)
            area = length/2; normal = cross/np.maximum(length[:, None], 1e-12)
            e, f = tex[:, 1]-tex[:, 0], tex[:, 2]-tex[:, 0]
            uvarea = abs(e[:, 0]*f[:, 1]-e[:, 1]*f[:, 0])/2
            material = meta['materials'][p['material']]
            ti = material['pbrMetallicRoughness']['baseColorTexture']['index']
            im = textures[meta['textures'][ti]['source']]
            density = np.sqrt(uvarea*im['width']*im['height']/np.maximum(area, 1e-15))
            edges = np.linalg.norm(np.roll(tri, -1, axis=1)-tri, axis=2)
            parent = np.arange(len(pos))
            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]; i = parent[i]
                return i
            for a, b, c in idx:
                ra = find(a); parent[find(b)] = ra; parent[find(c)] = ra
            roots = np.array([find(i) for i in idx[:, 0]])
            islands, inverse = np.unique(roots, return_inverse=True)
            island_areas = np.bincount(inverse, weights=area)
            fits = []
            for island in np.argsort(island_areas)[-12:][::-1]:
                vertices = np.unique(idx[inverse == island])
                fits.append({'area_m2': float(island_areas[island]),
                             'fit': projection_fit(pos[vertices], uv[vertices], [im['width'], im['height']])})
            vertical = abs(normal[:, 1]) < .3
            horizontal = abs(normal[:, 1]) > .95
            primitives.append({'vertices': len(pos), 'triangles': len(idx), 'area_m2': float(area.sum()),
                               'bounds': [pos.min(axis=0).tolist(), pos.max(axis=0).tolist()],
                               'uv_area_sum_not_occupancy': float(uvarea.sum()), 'uv_connected_components': len(islands),
                               'largest_components_area_m2': sorted(island_areas.tolist(), reverse=True)[:12],
                               'largest_components_uv_projection_fits': fits,
                               'texels_per_m_p10_p50_p90_area_weighted': quantiles(density, area),
                               'vertical_area_m2': float(area[vertical].sum()),
                               'vertical_texels_per_m_p10_p50_p90': quantiles(density[vertical], area[vertical]),
                               'horizontal_texels_per_m_p10_p50_p90': quantiles(density[horizontal], area[horizontal]),
                               'triangle_max_edge_m_p10_p50_p90_area_weighted': quantiles(edges.max(axis=1), area),
                               'vertical_triangle_max_edge_m_p10_p50_p90': quantiles(edges.max(axis=1)[vertical], area[vertical]),
                               'degenerate_triangles': int((area < 1e-12).sum())})
    return {'file': str(path), 'bytes': len(data), 'generator': meta['asset'].get('generator'),
            'textures': textures, 'materials': len(meta['materials']), 'primitives': primitives}


def main():
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    results = [inspect(Path(p), out) for p in sys.argv[2:]]
    (out/'layout.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
