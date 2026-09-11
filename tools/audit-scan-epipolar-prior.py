#!/usr/bin/env python3
"""Compare recorded AR camera epipolar geometry to held-out RGB matches.
No depth is used. Large residuals can include mismatches, calibration or pose error;
small line distance does not prove correct depth or full 2D alignment.
Usage: script fixture-directory feature-results.json
"""
import json
import sys
from pathlib import Path
import numpy as np

frames = json.loads((Path(sys.argv[1])/'fixture-kf.json').read_text())
pairs = json.loads(Path(sys.argv[2]).read_text())['pairs']
flip = np.diag([1., -1., -1., 1.])
def camera(f):
    return np.array(f['transform']).reshape(4, 4).T
def intrinsics(f):
    fx, fy, cx, cy = np.array(f['intrinsics'])*1600/f['width']
    return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.]])
rows = []
for pair in pairs:
    if 'source_points' not in pair: continue
    a, b = frames[pair['reference']], frames[pair['target']]
    relative = flip@np.linalg.inv(camera(b))@camera(a)@flip
    t = relative[:3, 3]
    if np.linalg.norm(t) < 1e-5: continue
    tx = np.array([[0, -t[2], t[1]], [t[2], 0, -t[0]], [-t[1], t[0], 0]])
    fundamental = np.linalg.inv(intrinsics(b)).T@tx@relative[:3, :3]@np.linalg.inv(intrinsics(a))
    x = np.column_stack([pair['source_points'], np.ones(len(pair['source_points']))])
    y = np.column_stack([pair['target_points'], np.ones(len(pair['target_points']))])
    fx, fy = x@fundamental.T, y@fundamental
    error = np.abs(np.sum(y*fx, axis=1))/np.sqrt(np.maximum(1e-20, np.sum(fx[:,:2]**2,axis=1)+np.sum(fy[:,:2]**2,axis=1)))
    held = np.array(pair['held'], dtype=bool)
    rows.append({'reference':pair['reference'], 'target':pair['target'],
                 'held_count':int(held.sum()), 'baseline_m':float(np.linalg.norm(t)),
                 'ar_held_median_px':float(np.median(error[held])),
                 'ar_held_p90_px':float(np.percentile(error[held],90)),
                 'ar_held_under2px':int(np.sum(error[held]<2)),
                 'fitted_held_median_px':pair.get('epipolar_held_median_px'),
                 'fitted_held_under2px':pair.get('epipolar_held_under2px')})
print(json.dumps(rows, indent=2))
