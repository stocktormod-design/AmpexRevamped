#!/usr/bin/env python3
"""Find planar connected mesh regions and their actual photo contributions.

Usage: script GLB matching-trace-directory [original-frames-directory]
No scene coordinates, wall direction, camera ID or ROI are supplied. Exported UV
seams duplicate vertices, so adjacency is reconstructed from positions at 10 µm.
Depth support checks triangle centers against recorded depth (8 cm tolerance,
4 cm maximum local span). It is not proof of visibility or image quality.
This is a geometry/selection diagnostic, not automatic registration or a bake.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np


def main():
    path, trace = Path(sys.argv[1]), Path(sys.argv[2])
    frames_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else trace.parent
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    meta = json.loads(data[20:20+size])
    def read(index):
        a = meta['accessors'][index]
        b = meta['bufferViews'][a['bufferView']]
        assert 'byteStride' not in b, 'Contiguous Ampex export required'
        width = {'VEC3': 3, 'SCALAR': 1}[a['type']]
        return np.frombuffer(data, dtype={5126: '<f4', 5125: '<u4'}[a['componentType']],
                             count=a['count']*width,
                             offset=28+size+b.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, width)
    primitive = meta['meshes'][0]['primitives'][0]
    vertices = read(primitive['attributes']['POSITION']).astype(float)
    triangles = read(primitive['indices']).reshape(-1, 3)
    xyz = vertices[triangles]
    cross = np.cross(xyz[:, 1]-xyz[:, 0], xyz[:, 2]-xyz[:, 0])
    length = np.linalg.norm(cross, axis=1)
    normals = np.divide(cross, length[:, None], out=np.zeros_like(cross), where=length[:, None] > 1e-10)
    areas = length*.5
    centers = xyz.mean(axis=1)
    labels = np.fromfile(trace/'labels-winner.i32', dtype='<i4')
    assert len(labels) == len(triangles), 'Trace must match GLB'
    frames = json.loads((trace/'refined-kf.json').read_text())
    depths = []
    for frame in frames:
        depth_path = frames_dir/frame.get('depthFile', '__missing_depth__')
        dw, dh = frame.get('depthWidth', 0), frame.get('depthHeight', 0)
        depths.append(np.fromfile(depth_path, dtype='<f4').reshape(dh, dw)
                      if dw > 2 and dh > 2 and depth_path.is_file()
                      and depth_path.stat().st_size == dw*dh*4 else None)
    # Welding is diagnostic only; do not rewrite the model's topology.
    _, welded = np.unique(np.rint(vertices/1e-5).astype(np.int64), axis=0, return_inverse=True)
    edges = {}
    parent = np.arange(len(triangles))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    threshold = np.cos(np.deg2rad(1.))
    for i, face in enumerate(welded[triangles]):
        if areas[i] < 1e-10:
            continue
        for j in range(3):
            key = tuple(sorted((int(face[j]), int(face[(j+1) % 3]))))
            for other in edges.get(key, []):
                if np.dot(normals[i], normals[other]) < threshold:
                    continue
                delta = centers[i]-centers[other]
                if max(abs(np.dot(delta, normals[i])), abs(np.dot(delta, normals[other]))) > .002:
                    continue
                a, b = root(i), root(other)
                if a != b:
                    parent[b] = a
            edges.setdefault(key, []).append(i)
    groups = {}
    for i in range(len(triangles)):
        if areas[i] >= 1e-10:
            groups.setdefault(int(root(i)), []).append(i)
    regions = []
    for group in groups.values():
        ids = np.array(group)
        area = float(areas[ids].sum())
        if area < .25:
            continue
        center = np.average(centers[ids], axis=0, weights=areas[ids])
        normal = np.sum(normals[ids]*areas[ids, None], axis=0)
        normal /= np.linalg.norm(normal)
        points = vertices[np.unique(triangles[ids])]
        residual = np.abs((points-center)@normal)
        p95 = float(np.quantile(residual, .95))
        # Local smooth adjacency alone can join a curved surface: reject it here.
        if p95 > .005 or float(np.max(residual)) > .02:
            continue
        axis = np.eye(3)[int(np.argmin(abs(normal)))]
        u = np.cross(normal, axis); u /= np.linalg.norm(u)
        v = np.cross(normal, u)
        coordinates = np.column_stack([(points-center)@u, (points-center)@v])
        contributions = []
        support_masks = []
        for index, frame in enumerate(frames):
            owned = float(areas[ids][labels[ids] == index].sum())
            local = np.column_stack([xyz[ids].reshape(-1, 3), np.ones(len(ids)*3)])@np.linalg.inv(np.array(frame['transform']).reshape(4, 4).T).T
            z = -local[:, 2]
            safe = np.where(abs(z) > 1e-8, z, 1e-8)
            fx, fy, cx, cy = frame['intrinsics']
            px, py = fx*local[:, 0]/safe+cx, -fy*local[:, 1]/safe+cy
            inside = ((z > .05) & (px >= 0) & (py >= 0) & (px < frame['width']) & (py < frame['height'])).reshape(-1, 3).all(axis=1)
            covered = float(areas[ids][inside].sum())
            supported = np.zeros(len(ids), dtype=bool)
            depth = depths[index]
            if depth is not None:
                center_camera = local.reshape(-1, 3, 4).mean(axis=1)
                cz = -center_camera[:, 2]
                safe_z = np.where(abs(cz) > 1e-8, cz, 1e-8)
                dx = (fx*center_camera[:, 0]/safe_z+cx)/frame['width']*depth.shape[1]
                dy = (-fy*center_camera[:, 1]/safe_z+cy)/frame['height']*depth.shape[0]
                valid = inside & (dx >= 1) & (dy >= 1) & (dx < depth.shape[1]-1) & (dy < depth.shape[0]-1)
                ix = np.clip(dx.astype(int), 1, depth.shape[1]-2)
                iy = np.clip(dy.astype(int), 1, depth.shape[0]-2)
                patch = np.stack([depth[iy+y, ix+x] for y in [-1, 0, 1] for x in [-1, 0, 1]])
                supported = (valid & np.isfinite(patch).all(axis=0) & (patch.min(axis=0) > .25)
                             & (np.ptp(patch, axis=0) <= .04) & (abs(depth[iy, ix]-cz) <= .08))
            support_masks.append(supported)
            if owned > .001 or covered > area*.5:
                contributions.append({'frame': frame['index'], 'assigned_m2': owned,
                                      'assigned_fraction': owned/area,
                                      'photo_bounds_fraction': covered/area,
                                      'depth_available': depth is not None,
                                      'depth_supported_fraction': float(areas[ids][supported].sum()/area)})
        overlaps = []
        support_area = [float(areas[ids][mask].sum()) for mask in support_masks]
        for left in range(len(frames)):
            for right in range(left+1, len(frames)):
                shared = float(areas[ids][support_masks[left] & support_masks[right]].sum())
                smaller = min(support_area[left], support_area[right])
                if shared >= .05 and shared >= smaller*.1:
                    overlaps.append({'frames': [frames[left]['index'], frames[right]['index']],
                                     'shared_m2': shared, 'fraction_of_smaller_support': shared/smaller})
        contributions.sort(key=lambda x: x['assigned_m2'], reverse=True)
        regions.append({'area_m2': area, 'triangles': len(ids), 'center': center.tolist(),
                        'triangle_indices': ids.tolist(),
                        'normal': normal.tolist(), 'plane_offset': float(np.dot(center, normal)),
                        'planarity_p95_mm': p95*1000, 'axis_u': u.tolist(), 'axis_v': v.tolist(),
                        'bounds_uv': [coordinates.min(axis=0).tolist(), coordinates.max(axis=0).tolist()],
                        'photos': contributions, 'depth_supported_overlaps': overlaps})
    regions.sort(key=lambda r: r['area_m2'], reverse=True)
    print(json.dumps({'mesh': str(path), 'regions': regions,
                      'note': 'Depth-consistent triangle centers are candidate overlaps, not verified visibility or RGB identity. No reference or warp is activated.'}, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
