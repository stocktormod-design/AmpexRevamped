#!/usr/bin/env python3
"""All-pairs RGB/depth connectivity using actual refined cameras. Diagnostic only.
Usage: script frames-dir trace-dir output-dir
Spatial holdout is never fitted. Both depths must have smooth, valid 3x3 support.
A broad 15 cm prior removes gross mismatches, but does not prove static identity.
"""
import importlib.util
import itertools
import json
import sys
from pathlib import Path
import cv2 as cv
import numpy as np


def observations(frame, points, root):
    depth = np.fromfile(root/frame['depthFile'], dtype='<f4').reshape(frame['depthHeight'], frame['depthWidth'])
    p = np.asarray(points).reshape(-1, 2); width = 1600; height = width*frame['height']/frame['width']
    x = np.floor(p[:, 0]/width*depth.shape[1]).astype(int); y = np.floor(p[:, 1]/height*depth.shape[0]).astype(int)
    valid = (x >= 1) & (x < depth.shape[1]-1) & (y >= 1) & (y < depth.shape[0]-1)
    x = np.clip(x, 1, depth.shape[1]-2); y = np.clip(y, 1, depth.shape[0]-2)
    patch = np.stack([depth[y+dy, x+dx] for dy in [-1, 0, 1] for dx in [-1, 0, 1]])
    z = depth[y, x]
    valid &= np.isfinite(patch).all(0) & (patch.min(0) > .25) & (np.ptp(patch, axis=0) <= .08)
    fx, fy, cx, cy = np.array(frame['intrinsics'])*width/frame['width']
    local = np.column_stack([(p[:, 0]-cx)/fx*z, -(p[:, 1]-cy)/fy*z, -z])
    pose = np.array(frame['transform']).reshape(4, 4).T
    return local@pose[:3, :3].T+pose[:3, 3], valid


def main():
    root, trace, output = map(Path, sys.argv[1:]); output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('matching', Path(__file__).with_name('audit-scan-tile-features.py'))
    matching = importlib.util.module_from_spec(spec); spec.loader.exec_module(matching)
    frames = json.loads((trace/'refined-kf.json').read_text()); cache = {}; rows = []
    cv.setNumThreads(2); cv.setRNGSeed(31)
    detector = cv.SIFT_create(nfeatures=5000, contrastThreshold=.015)
    for f in frames:
        im = cv.imread(str(root/f['file']), 0); im = cv.resize(im, None, fx=1600/im.shape[1], fy=1600/im.shape[1])
        kp, desc = detector.detectAndCompute(im, None); p = np.array([k.pt for k in kp]).reshape(-1, 2)
        world, valid = observations(f, p, root)
        cache[f['index']] = (im, kp, desc, p, world, valid)
    print(json.dumps({'stage': 'features', 'frames': len(cache)}), flush=True)
    flip = np.diag([1., -1., -1., 1.])
    for number, (a, b) in enumerate(itertools.combinations(frames, 2)):
        ia, ka, da, pa, wa, va = cache[a['index']]; ib, kb, db, pb, wb, vb = cache[b['index']]
        matches = matching.mutual(da, db)
        if len(matches) < 12:
            rows.append({'reference': a['index'], 'target': b['index'], 'mutual': len(matches), 'reason': 'few_matches'})
            continue
        ai = np.array([m.queryIdx for m in matches]); bi = np.array([m.trainIdx for m in matches])
        supported = va[ai] & vb[bi]; distances = np.linalg.norm(wa[ai]-wb[bi], axis=1)
        keep = supported & (distances <= .15)
        p, q, world = pa[ai[keep]], pb[bi[keep]], wa[ai[keep]]
        held = ((p[:, 0]//160+p[:, 1]//160).astype(int) % 2) == 0
        sites = np.unique(np.rint(p).astype(int), axis=0)
        row = {'reference': a['index'], 'target': b['index'], 'mutual': len(matches), 'dual_depth': int(supported.sum()),
               'prior_supported': int(keep.sum()), 'distinct_sites': len(sites), 'held_count': int(held.sum()),
               'source_points': p.tolist(), 'target_points': q.tolist(), 'world_points': world.tolist(), 'held': held.tolist()}
        if len(world) >= 3:
            eigenvalues = np.linalg.eigvalsh(np.cov(world.T))
            row['world_extent_m'] = np.ptp(world, axis=0).tolist(); row['world_covariance_eigenvalues'] = eigenvalues.tolist()
            row['occupied_10cm_cells'] = len(np.unique(np.floor(world/.1).astype(int), axis=0))
        if (~held).sum() >= 12 and held.sum() >= 6 and len(sites) >= 18:
            fx, fy, cx, cy = np.array(b['intrinsics'])*1600/b['width']; k = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.]])
            pose = flip@np.linalg.inv(np.array(b['transform']).reshape(4, 4).T)
            r0 = cv.Rodrigues(pose[:3, :3])[0]; t0 = pose[:3, 3:4].copy()
            ok, rv, tv, inliers = cv.solvePnPRansac(world[~held], q[~held], k, None, r0.copy(), t0.copy(), True,
                iterationsCount=1000, reprojectionError=5, confidence=.999, flags=cv.SOLVEPNP_ITERATIVE)
            if ok and inliers is not None and len(inliers) >= 8:
                rv, tv = cv.solvePnPRefineLM(world[~held][inliers[:, 0]], q[~held][inliers[:, 0]], k, None, rv, tv)
                def stats(r, t):
                    error = np.linalg.norm(cv.projectPoints(world[held], r, t, k, None)[0][:, 0]-q[held], axis=1)
                    return {'median': float(np.median(error)), 'p90': float(np.quantile(error, .9)), 'under5': int((error < 5).sum())}
                row.update({'train_inliers': len(inliers), 'before': stats(r0, t0), 'after': stats(rv, tv),
                            'candidate_world_to_cv': {'rotation_vector': rv.tolist(), 'translation': tv.tolist()}})
                # Draw all prior-supported matches, including holdout and outliers.
                selected = [m for m, keep_match in zip(matches, keep) if keep_match]
                canvas = cv.drawMatches(ia, ka, ib, kb, selected, None, flags=cv.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
                cv.imwrite(str(output/f"matches-{a['index']}-{b['index']}.jpg"), canvas)
        rows.append(row)
        if number % 20 == 0:
            print(json.dumps({'pairs_processed': number+1}), flush=True)
    summary = {'pairs': len(rows), 'pose_diagnostics': sum('after' in r for r in rows)}
    (output/'results.json').write_text(json.dumps({'summary': summary, 'pairs': rows,
        'limitations': 'No correction activated; dual depth and prior proximity do not prove static identity or whole-wall quality.'}, indent=2, allow_nan=False))
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
