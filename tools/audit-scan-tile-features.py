#!/usr/bin/env python3
"""Look for distinct local features in automatic planar tiles at original-image detail.

Usage: script detail-dir regions.json frames-dir trace-dir output-dir
Uses existing tile candidates/masks; no hand-selected surface, camera, or ROI.
No warp is emitted. Depth masks are approximate and dynamic content is unresolved.
"""
import json
import itertools
import sys
from pathlib import Path
import cv2 as cv
import numpy as np


def mutual(a, b):
    if a is None or b is None or len(a) < 2 or len(b) < 2:
        return []
    matcher = cv.BFMatcher(cv.NORM_L2)
    def ratio(x, y):
        return {m.queryIdx: m for m, n in matcher.knnMatch(x, y, k=2) if m.distance < .7*n.distance}
    forward, reverse = ratio(a, b), ratio(b, a)
    return [m for m in forward.values() if m.trainIdx in reverse and reverse[m.trainIdx].trainIdx == m.queryIdx]


def main():
    detail_dir, region_path, frame_dir, trace_dir, output = map(Path, [a for a in sys.argv[1:] if not a.startswith("--")])
    output.mkdir(parents=True, exist_ok=True)
    tiles = json.loads((detail_dir/'results.json').read_text())
    regions = json.loads(region_path.read_text())['regions']
    frames = {f['index']: f for f in json.loads((trace_dir/'refined-kf.json').read_text())}
    resolution = next((int(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--resolution=')), 768)
    assert 192 <= resolution <= 2600
    results = []; counts = []
    detector = cv.SIFT_create(nfeatures=3000, contrastThreshold=.01)
    images = {}; cv.setRNGSeed(23)
    for tile in tiles['tiles']:
        scale = resolution/tile.get('tile_size_m', tiles['tile_size_m'])
        region = regions[tile['region']]; u = np.array(region['axis_u']); v = np.array(region['axis_v'])
        xx, yy = np.meshgrid((np.arange(resolution)+.5-resolution/2)/scale,
                             (np.arange(resolution)+.5-resolution/2)/scale)
        world = np.array(tile['center'])+xx[..., None]*u+yy[..., None]*v
        cache = {}
        for c in tile['candidates']:
            index = c['frame']; f = frames[index]
            if index not in images:
                images[index] = cv.imread(str(frame_dir/f['file']), 0)
            matrix = np.linalg.inv(np.array(f['transform']).reshape(4, 4).T)
            local = world@matrix[:3, :3].T+matrix[:3, 3]; z = -local[..., 2]
            fx, fy, cx, cy = f['intrinsics']
            px = (fx*local[..., 0]/z+cx).astype('float32'); py = (-fy*local[..., 1]/z+cy).astype('float32')
            im = cv.remap(images[index], px, py, cv.INTER_LINEAR)
            mask = cv.imread(str(detail_dir/f"{tile['id']}-frame{index}-mask.png"), 0)
            if mask is None:
                raise ValueError('Regenerate detail output with masks')
            mask = cv.resize(mask, (resolution, resolution), interpolation=cv.INTER_NEAREST)
            mask = cv.erode(mask, np.ones((17, 17), 'uint8'), borderType=cv.BORDER_CONSTANT, borderValue=0)
            kp, desc = detector.detectAndCompute(im, mask)
            # Descriptor windows must stay within the measured patch, not border fill.
            distance = cv.distanceTransform(mask, cv.DIST_L2, 5)
            keep = [i for i, k in enumerate(kp) if distance[round(k.pt[1]), round(k.pt[0])] >= 3*k.size]
            kp = [kp[i] for i in keep]; desc = desc[keep] if desc is not None else None
            cache[index] = im, kp, desc
            counts.append({'tile': tile['id'], 'frame': index, 'features': len(kp)})
        indices = [c['frame'] for c in tile['candidates']]
        pairs = itertools.combinations(indices, 2) if '--all-pairs' in sys.argv else [(indices[0], i) for i in indices[1:]]
        for ref, src in pairs:
            a, ka, da = cache[ref]; b, kb, db = cache[src]; matches = mutual(da, db)
            p = np.array([ka[m.queryIdx].pt for m in matches]); q = np.array([kb[m.trainIdx].pt for m in matches])
            row = {'tile': tile['id'], 'region': tile['region'], 'reference': ref, 'source': src,
                   'mutual_matches': len(matches), 'reference_points': p.tolist(), 'source_points': q.tolist()}
            if len(matches):
                # Multiple SIFT orientations at one location are not independent sites.
                sites = np.unique(np.rint(p).astype(int), axis=0)
                row['distinct_reference_sites'] = len(sites)
                row['reference_hull_fraction'] = float(cv.contourArea(cv.convexHull(sites.astype('float32')))/resolution**2) if len(sites) >= 3 else 0.
            if len(matches) >= 12:
                # Spatial holdout avoids splitting multiple orientations at one feature.
                held = ((p[:, 0]//96+p[:, 1]//96).astype(int) % 2) == 0
                row['held'] = held.tolist()
                if held.sum() >= 4 and (~held).sum() >= 6:
                    h, inliers = cv.findHomography(p[~held], q[~held], cv.RANSAC, 3, maxIters=5000, confidence=.999)
                    if h is not None:
                        pred = cv.perspectiveTransform(p[:, None].astype('float64'), h)[:, 0]
                        errors = np.linalg.norm(pred-q, axis=1)
                        row.update({'homography': h.tolist(), 'train_inliers': int(inliers.sum()),
                                    'held_count': int(held.sum()), 'held_median_px': float(np.median(errors[held])),
                                    'held_p90_px': float(np.quantile(errors[held], .9)), 'errors': errors.tolist()})
            if len(matches) >= 4:
                canvas = cv.drawMatches(a, ka, b, kb, matches, None, flags=cv.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
                cv.imwrite(str(output/f"{tile['id']}-{ref}-{src}.jpg"), canvas)
            results.append(row)
    summary = {'pairs': len(results), 'pairs_ge4': sum(r['mutual_matches'] >= 4 for r in results),
               'pairs_ge12': sum(r['mutual_matches'] >= 12 for r in results),
               'pairs_with_held_model': sum('held_p90_px' in r for r in results)}
    (output/'results.json').write_text(json.dumps({'resolution': resolution, 'summary': summary,
        'limitations': 'Candidates only; approximate visibility and no dynamic-content/feature-identity validation.',
        'feature_counts': counts, 'pairs': results}, indent=2, allow_nan=False))
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
