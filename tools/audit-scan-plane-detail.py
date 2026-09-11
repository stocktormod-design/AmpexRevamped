#!/usr/bin/env python3
"""Compare local detail on automatic planar regions at the same physical scale.

Usage: script GLB regions.json frames-directory matching-trace-directory output-dir
40 cm tiles, 192² pixels. Depth support is approximate; scores do not validate
feature identity, dynamic content, or suitability for automatic camera correction.
"""
import importlib.util
import json
import sys
from pathlib import Path
import cv2 as cv
import numpy as np


def detail(image, mask):
    image = image.astype(np.float32)/255.
    valid = cv.erode(mask.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
    if valid.sum() < 100:
        return None
    # Calibrate white-noise propagation through the exact derivative kernels.
    # The previous unsmoothed Laplacian/Sobel ratio rewarded noisy blurred photos.
    # MAD is only a noise estimate: JPEG/aliasing and real fine texture can violate it.
    residual = cv.Laplacian(image, cv.CV_32F, ksize=1)[valid]
    noise_variance = float((np.median(abs(residual-np.median(residual))) /
                            (.67448975*np.sqrt(20)))**2)
    impulse = np.zeros((41, 41), np.float32); impulse[20, 20] = 1
    energies = []; noise_energies = []; coarse_values = None; coarse_vectors = None; coarse_noise = None
    for sigma in (1., 3.):
        smooth = cv.GaussianBlur(image, (0, 0), sigma)
        x = cv.Sobel(smooth, cv.CV_32F, 1, 0, ksize=3)/8
        y = cv.Sobel(smooth, cv.CV_32F, 0, 1, ksize=3)/8
        tensor = np.array([[np.mean(x[valid]**2), np.mean(x[valid]*y[valid])],
                           [np.mean(x[valid]*y[valid]), np.mean(y[valid]**2)]])
        kernel = cv.Sobel(cv.GaussianBlur(impulse, (0, 0), sigma), cv.CV_32F, 1, 0, ksize=3)/8
        propagated_noise = noise_variance*float(np.sum(kernel**2))
        values, vectors = np.linalg.eigh(tensor)
        values = np.maximum(values-propagated_noise, 0)
        energies.append(float(values.sum()))
        noise_energies.append(2*propagated_noise)
        coarse_values, coarse_vectors, coarse_noise = values, vectors, 2*propagated_noise
    # Smooth shading can pass the coarse check without resolved edges. Require
    # fine-scale signal too; empirical diagnostic gates, not registration proof.
    signal_to_noise = energies[1]/max(coarse_noise, 1e-12)
    return {'gradient_energy': energies[1],
            'edge_sharpness_ratio': energies[0]/max(energies[1], 1e-12),
            'noise_variance': noise_variance,
            'coarse_signal_to_noise': signal_to_noise,
            'fine_signal_to_noise': energies[0]/max(noise_energies[0], 1e-12),
            'detail_supported': bool(signal_to_noise >= 10 and energies[0] >= 3*max(noise_energies[0], 1e-12)
                                     and energies[1] >= 1e-8),
            'two_direction_ratio': float(coarse_values[0]/max(coarse_values[1], 1e-12)),
            'dominant_gradient': coarse_vectors[:, 1].tolist()}


def main():
    mesh_path, regions_path, frames_path, trace_path, out_path = map(Path, sys.argv[1:])
    spec = importlib.util.spec_from_file_location('mesh_matches', Path(__file__).with_name('audit-scan-mesh-matches.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    triangles = module.load_mesh(mesh_path)
    regions = json.loads(regions_path.read_text())['regions']
    frames = json.loads((trace_path/'refined-kf.json').read_text())
    images, depths = {}, {}
    for f in frames:
        images[f['index']] = cv.imread(str(frames_path/f['file']), cv.IMREAD_GRAYSCALE)
        path = frames_path/f.get('depthFile', '__missing__')
        if path.is_file():
            depths[f['index']] = np.fromfile(path, dtype='<f4').reshape(f['depthHeight'], f['depthWidth'])
    out_path.mkdir(parents=True, exist_ok=True)
    tiles = []; side = .4; resolution = 192; scale = resolution/side
    for ri, region in enumerate(regions):
        center = np.array(region['center']); u = np.array(region['axis_u']); v = np.array(region['axis_v'])
        low, high = np.array(region['bounds_uv'])
        shape = np.ceil((high-low)*scale).astype(int)+3
        assert np.all(shape < 12000), 'Region too large for diagnostic raster'
        occupancy = np.zeros((shape[1], shape[0]), np.uint8)
        local = triangles[region['triangle_indices']]-center
        projected = np.stack([local@u, local@v], axis=-1)
        for triangle in projected:
            cv.fillConvexPoly(occupancy, np.rint((triangle-low)*scale+1).astype(np.int32), 1)
        for iy in range(int(np.ceil((high[1]-low[1])/side))):
            for ix in range(int(np.ceil((high[0]-low[0])/side))):
                tile_center = low+(np.array([ix, iy])+.5)*side
                xx, yy = np.meshgrid(tile_center[0]+(np.arange(resolution)+.5-resolution/2)/scale,
                                     tile_center[1]+(np.arange(resolution)+.5-resolution/2)/scale)
                mask = cv.remap(occupancy, ((xx-low[0])*scale+1).astype('float32'),
                                ((yy-low[1])*scale+1).astype('float32'), cv.INTER_NEAREST) > 0
                if mask.mean() < .9:
                    continue
                world = center+xx[..., None]*u+yy[..., None]*v
                candidates = []; patches = {}; masks = {}
                for f in frames:
                    image = images[f['index']]; depth = depths.get(f['index'])
                    if image is None or depth is None:
                        continue
                    matrix = np.linalg.inv(np.array(f['transform']).reshape(4, 4).T)
                    local = world@matrix[:3, :3].T+matrix[:3, 3]
                    z = -local[..., 2]; safe = np.where(abs(z) > 1e-8, z, 1e-8)
                    fx, fy, cx, cy = f['intrinsics']
                    px, py = fx*local[..., 0]/safe+cx, -fy*local[..., 1]/safe+cy
                    inside = (z > .25) & (px >= 2) & (py >= 2) & (px < f['width']-2) & (py < f['height']-2)
                    if (inside & mask).sum()/mask.sum() < .98:
                        continue
                    # Sparse depth audit avoids treating a projected image rectangle as visible.
                    dx = np.clip((px[::8, ::8]/f['width']*depth.shape[1]).astype(int), 1, depth.shape[1]-2)
                    dy = np.clip((py[::8, ::8]/f['height']*depth.shape[0]).astype(int), 1, depth.shape[0]-2)
                    patch = np.stack([depth[dy+y, dx+x] for y in [-1, 0, 1] for x in [-1, 0, 1]])
                    supported = (np.isfinite(patch).all(0) & (patch.min(0) > .25)
                                 & (np.ptp(patch, axis=0) <= .04)
                                 & (abs(depth[dy, dx]-z[::8, ::8]) <= .08))
                    if supported.mean() < .8:
                        continue
                    rectified = cv.remap(image, px.astype('float32'), py.astype('float32'), cv.INTER_LINEAR)
                    metrics = detail(rectified, mask & inside)
                    if metrics is None or not metrics['detail_supported']:
                        continue
                    candidates.append({'frame': f['index'], 'depth_supported_fraction': float(supported.mean()), **metrics})
                    patches[f['index']] = rectified
                    masks[f['index']] = (mask & inside).astype('uint8')*255
                if len(candidates) < 2:
                    continue
                candidates.sort(key=lambda c: c['edge_sharpness_ratio'], reverse=True)
                tile_id = f'r{ri}-x{ix}-y{iy}'
                for c in candidates:
                    cv.imwrite(str(out_path/f"{tile_id}-frame{c['frame']}.png"), patches[c['frame']])
                    cv.imwrite(str(out_path/f"{tile_id}-frame{c['frame']}-mask.png"), masks[c['frame']])
                tiles.append({'id': tile_id, 'region': ri,
                              'center': (center+tile_center[0]*u+tile_center[1]*v).tolist(),
                              'candidates': candidates})
    (out_path/'results.json').write_text(json.dumps({'metric': 'noise-adjusted-gradient-scale-ratio-v2',
                                                  'limitations': 'Diagnostic ranking only; white-noise approximation, resampling aliasing, dynamic content and correspondence identity are not validated.',
                                                  'tile_size_m': side, 'resolution': resolution,
                                                  'tiles': tiles}, indent=2, allow_nan=False))
    print(json.dumps({'tiles_with_multiple_candidates': len(tiles), 'output': str(out_path)}))


if __name__ == '__main__':
    main()
