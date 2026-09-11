#!/usr/bin/env python3
"""Build whole-region inputs for audit-scan-tile-features.py, no hand-chosen ROI.
Usage: script GLB regions.json frames-dir trace-dir output-dir
Masks use approximate recorded-depth support, not a dynamic-content classifier.
"""
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np
import cv2 as cv


def main():
    mesh, regions_file, root, trace, out = map(Path, sys.argv[1:]); out.mkdir(parents=True, exist_ok=True)
    s = importlib.util.spec_from_file_location('mesh', Path(__file__).with_name('audit-scan-mesh-matches.py'))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
    triangles = m.load_mesh(mesh); regions = json.loads(regions_file.read_text())['regions']
    frames = {f['index']: f for f in json.loads((trace/'refined-kf.json').read_text())}
    result = []; resolution = 384
    for ri, region in enumerate(regions):
        low, high = np.array(region['bounds_uv']); mid = (low+high)/2; side = float(max(high-low)+.02)
        u = np.array(region['axis_u']); v = np.array(region['axis_v']); center = np.array(region['center'])+mid[0]*u+mid[1]*v
        scale = resolution/side; xy = triangles[region['triangle_indices']]-center
        uv = np.stack([xy@u, xy@v], axis=-1)*scale+(resolution-1)/2
        occupancy = np.zeros((resolution, resolution), 'uint8')
        for tri in uv:
            cv.fillConvexPoly(occupancy, np.rint(tri).astype('int32'), 255)
        xx, yy = np.meshgrid((np.arange(resolution)+.5-resolution/2)/scale, (np.arange(resolution)+.5-resolution/2)/scale)
        world = center+xx[..., None]*u+yy[..., None]*v; candidates = []
        for photo in region['photos']:
            if photo['depth_supported_fraction'] < .1:
                continue
            f = frames[photo['frame']]; path = root/f.get('depthFile', '__missing__')
            if not path.is_file():
                continue
            depth = np.fromfile(path, dtype='<f4').reshape(f['depthHeight'], f['depthWidth'])
            matrix = np.linalg.inv(np.array(f['transform']).reshape(4, 4).T)
            local = world@matrix[:3, :3].T+matrix[:3, 3]; z = -local[..., 2]; safe = np.where(abs(z)>1e-8, z, 1e-8)
            fx, fy, cx, cy = f['intrinsics']; px = fx*local[..., 0]/safe+cx; py = -fy*local[..., 1]/safe+cy
            dx = np.clip((px/f['width']*depth.shape[1]).astype(int), 1, depth.shape[1]-2)
            dy = np.clip((py/f['height']*depth.shape[0]).astype(int), 1, depth.shape[0]-2)
            patch = np.stack([depth[dy+y, dx+x] for y in [-1, 0, 1] for x in [-1, 0, 1]])
            valid = ((occupancy > 0) & (z > .25) & (px >= 2) & (py >= 2) & (px < f['width']-2) & (py < f['height']-2)
                     & np.isfinite(patch).all(0) & (patch.min(0) > .25) & (np.ptp(patch, axis=0) <= .04)
                     & (abs(depth[dy, dx]-z) <= .08))
            supported = float(valid.sum()/max((occupancy > 0).sum(), 1))
            if supported < .1:
                continue
            cv.imwrite(str(out/f"r{ri}-frame{f['index']}-mask.png"), valid.astype('uint8')*255)
            candidates.append({'frame': f['index'], 'supported_fraction': supported})
        if len(candidates) >= 2:
            result.append({'id': f'r{ri}', 'region': ri, 'center': center.tolist(), 'tile_size_m': side, 'candidates': candidates})
    (out/'results.json').write_text(json.dumps({'tile_size_m': 1., 'resolution': resolution, 'tiles': result}, indent=2, allow_nan=False))
    print(json.dumps({'regions': len(result), 'photos': sum(len(t['candidates']) for t in result)}))


if __name__ == '__main__':
    main()
