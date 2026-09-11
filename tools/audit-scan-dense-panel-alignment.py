#!/usr/bin/env python3
"""Bounded planar, normal-only registration experiment; never edits input scans.

Uses actual photos, a mesh-derived plane and camera projections. Searches past one
panel period, rejects competing branches, and holds disjoint tangent strips out.
The reported match residual is not by itself evidence of physical line identity.
Requires numpy/OpenCV. Example:
  python script.py GLB regions.json frames-dir keyframes.json output-dir
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

import cv2 as cv
import numpy as np


def project(world, frame):
    m = np.linalg.inv(np.array(frame['transform']).reshape(4, 4).T)
    p = world @ m[:3, :3].T + m[:3, 3]
    z = -p[..., 2]
    fx, fy, cx, cy = frame['intrinsics']
    return np.stack((fx*p[..., 0]/z+cx, -fy*p[..., 1]/z+cy), -1), z


def plane_ray(uv, frame, center, plane_normal):
    m = np.array(frame['transform']).reshape(4, 4).T
    fx, fy, cx, cy = frame['intrinsics']
    rays = np.stack(((uv[..., 0]-cx)/fx, -(uv[..., 1]-cy)/fy, -np.ones(uv.shape[:-1])), -1)@m[:3, :3].T
    depth = ((center-m[:3, 3])@plane_normal)/(rays@plane_normal)
    return m[:3, 3]+depth[..., None]*rays, depth


def feature_phase_anchor(reference, target, root, center, pn, normal, tangent, ppm):
    """Independent descriptor identities choose phase, not a free camera warp.

    A consistent cluster must span the line-normal direction. This deliberately
    permits collinear trim marks only for the scalar phase constraint. A human
    should inspect the saved identities before any on-device activation.
    """
    sift = cv.SIFT_create(nfeatures=10000, contrastThreshold=.008)
    records = []
    for frame in [reference, target]:
        image = cv.imread(str(root/frame['file']), cv.IMREAD_GRAYSCALE)
        scale = min(1., 1920/image.shape[1])
        image = cv.resize(image, (round(image.shape[1]*scale), round(image.shape[0]*scale)))
        keys, desc = sift.detectAndCompute(image, None)
        records.append((keys, desc, scale))
    ka, da, sa = records[0]; kb, db, sb = records[1]
    if da is None or db is None:
        return dict(accepted=False, reason='no descriptors')
    matcher = cv.BFMatcher()
    forward, reverse = matcher.knnMatch(da, db, k=2), matcher.knnMatch(db, da, k=2)
    reverse = {p[0].queryIdx: p[0].trainIdx for p in reverse if len(p) == 2 and p[0].distance < .7*p[1].distance}
    pairs = [p[0] for p in forward if len(p) == 2 and p[0].distance < .7*p[1].distance
             and reverse.get(p[0].trainIdx) == p[0].queryIdx]
    if len(pairs) < 3:
        return dict(accepted=False, reason='fewer than three mutual descriptor identities', matches=len(pairs))
    pa = np.array([ka[p.queryIdx].pt for p in pairs])/sa
    pb = np.array([kb[p.trainIdx].pt for p in pairs])/sb
    wa, za = plane_ray(pa, reference, center, pn)
    wb, zb = plane_ray(pb, target, center, pn)
    supported = np.ones(len(pairs), bool)
    for points, z, frame in [(pa, za, reference), (pb, zb, target)]:
        depth = np.fromfile(root/frame['depthFile'], '<f4').reshape(frame['depthHeight'], frame['depthWidth'])
        x = np.clip((points[:, 0]/frame['width']*frame['depthWidth']).astype(int), 0, frame['depthWidth']-1)
        y = np.clip((points[:, 1]/frame['height']*frame['depthHeight']).astype(int), 0, frame['depthHeight']-1)
        supported &= (z > .25) & (depth[y, x] > .25) & (abs(z-depth[y, x]) < .08)
    delta = np.stack(((wb-wa)@tangent, (wb-wa)@normal), -1)*ppm
    ids = np.flatnonzero(supported)
    if len(ids) < 3:
        return dict(accepted=False, reason='insufficient depth-supported identities', matches=len(pairs))
    nearby = np.linalg.norm(delta[ids, None]-delta[None, ids], axis=-1) < 5
    selected = ids[nearby[nearby.sum(1).argmax()]]
    span = float(np.ptp(wa[selected]@normal)*ppm)
    # A phase anchor also retains the capture-pose prior: large arbitrary feature
    # jumps cannot establish a nearby stripe identity from only three marks.
    prior_distance = float(np.linalg.norm(np.median(delta[selected], axis=0))/ppm)
    accepted = len(selected) >= 3 and span >= ppm*.35 and prior_distance < .05
    return dict(accepted=bool(accepted), matches=len(pairs), inliers=len(selected),
                normal_span_px=span, prior_distance_m=prior_distance,
                normal_shift=float(np.median(delta[selected, 1])),
                identities=[dict(reference_uv=pa[i].tolist(), target_uv=pb[i].tolist(),
                                 normal_shift=float(delta[i, 1]), tangent_shift=float(delta[i, 0])) for i in selected])


def rectify(triangles, center, tangent, normal, frames, root, ppm):
    flat = triangles.reshape(-1, 3)-center
    coords = np.stack((flat@tangent, flat@normal), -1)
    lo, hi = coords.min(0)-.02, coords.max(0)+.02
    size = np.ceil((hi-lo)*ppm).astype(int)
    x, y = np.meshgrid(np.arange(size[0]), np.arange(size[1]))
    world = center+(x/ppm+lo[0])[..., None]*tangent+(y/ppm+lo[1])[..., None]*normal
    occupancy = np.zeros((size[1], size[0]), np.uint8)
    for tri in ((coords-lo)*ppm).reshape(-1, 3, 2):
        cv.fillConvexPoly(occupancy, np.rint(tri).astype('int32'), 255)
    images, masks = {}, {}
    for fi, f in frames.items():
        uv, z = project(world, f)
        image = cv.imread(str(root/f['file']), cv.IMREAD_GRAYSCALE)
        images[fi] = cv.remap(image, (uv[..., 0]-.5).astype('f4'),
                              (uv[..., 1]-.5).astype('f4'), cv.INTER_LINEAR).astype('f4')
        depth = np.fromfile(root/f['depthFile'], '<f4').reshape(f['depthHeight'], f['depthWidth'])
        dx = np.clip((uv[..., 0]/f['width']*f['depthWidth']).astype(int), 1, f['depthWidth']-2)
        dy = np.clip((uv[..., 1]/f['height']*f['depthHeight']).astype(int), 1, f['depthHeight']-2)
        patch = np.stack([depth[dy+oy, dx+ox] for oy in [-1, 0, 1] for ox in [-1, 0, 1]])
        valid = ((occupancy > 0) & (z > .25) & (uv[..., 0] >= 8) & (uv[..., 1] >= 8)
                 & (uv[..., 0] <= f['width']-8) & (uv[..., 1] <= f['height']-8)
                 & (patch.min(0) > .25) & (np.ptp(patch, axis=0) <= .04)
                 & (abs(depth[dy, dx]-z) <= .08))
        masks[fi] = cv.erode(valid.astype('uint8'), np.ones((19, 19), 'uint8')) > 0
    return images, masks, lo, world


def filtered(profile):
    return (cv.GaussianBlur(profile[:, None].astype('f4'), (1, 0), 1, sigmaY=1)
            - cv.GaussianBlur(profile[:, None].astype('f4'), (1, 0), 8, sigmaY=8)).ravel()


def period_of(profile, valid):
    a = filtered(profile)
    scores = []
    for lag in range(15, min(160, len(a)//3)):
        good = valid[:-lag] & valid[lag:]
        x, y = a[:-lag][good], a[lag:][good]
        scores.append(float(x@y/max(np.linalg.norm(x)*np.linalg.norm(y), 1e-8)) if good.sum() > 150 else -1)
    peaks = [i for i in range(1, len(scores)-1) if scores[i] > scores[i-1] and scores[i] >= scores[i+1]]
    peaks = sorted(peaks, key=lambda i: scores[i], reverse=True)
    if not peaks:
        return None
    best = peaks[0]
    # Prefer the first strong repetition over its harmonics.
    plausible = [i for i in peaks if scores[i] >= max(.3, scores[best]*.85)]
    return min(plausible)+15 if plausible else best+15


def matches_for(images, masks, ref, target, local_affine=False, phase_anchor=None):
    a, b = images[ref], images[target]
    ma, mb = masks[ref], masks[target]
    results = []
    width = 32
    for band, x in enumerate(range(width, a.shape[1]-width, width*2)):
        pa, pb = a[:, x-width//2:x+width//2].mean(1), b[:, x-width//2:x+width//2].mean(1)
        va = ma[:, x-width//2:x+width//2].mean(1) >= .98
        vb = mb[:, x-width//2:x+width//2].mean(1) >= .98
        period = period_of(pa, va)
        if period is None:
            continue
        aa, bb = filtered(pa), filtered(pb)
        radius, search = round(period*1.75), round(period*1.3)
        for y in range(radius+search, len(pa)-radius-search, max(32, period)):
            yy = np.arange(y-radius, y+radius+1)
            scores, scales = [], []
            for shift in range(-search, search+1):
                best_score, best_scale = -1., 1.
                for scale in (np.arange(.94, 1.061, .01) if local_affine else [1.]):
                    source_y = y+(yy-y)*scale+shift
                    source_i = np.clip(np.rint(source_y).astype(int), 0, len(bb)-1)
                    ok = va[yy] & vb[source_i] & (source_y >= 0) & (source_y <= len(bb)-1)
                    if ok.mean() < .95:
                        continue
                    left, right = aa[yy][ok], np.interp(source_y[ok], np.arange(len(bb)), bb)
                    score = float(left@right/max(np.linalg.norm(left)*np.linalg.norm(right), 1e-8))
                    if score > best_score:
                        best_score, best_scale = score, float(scale)
                scores.append(best_score)
                scales.append(best_scale)
            scores = np.array(scores)
            peaks = [i for i in range(1, len(scores)-1) if scores[i] > scores[i-1] and scores[i] >= scores[i+1]]
            if not peaks:
                continue
            best = max(peaks, key=lambda i: scores[i])
            anchored = False
            if phase_anchor is not None and phase_anchor.get('accepted'):
                phase_peaks = [i for i in peaks if abs(i-search-phase_anchor['normal_shift']) < .25*period and scores[i] >= .85]
                if len(phase_peaks) == 1:
                    best, anchored = phase_peaks[0], True
            rivals = [i for i in peaks if abs(i-best) > max(8, period*.3)]
            rival = max((float(scores[i]) for i in rivals), default=-1.)
            shift = best-search
            denominator = scores[best-1]-2*scores[best]+scores[best+1]
            sub = .5*(scores[best-1]-scores[best+1])/denominator if abs(denominator) > 1e-9 else 0
            accepted = scores[best] >= .85 and (scores[best]-rival >= .1 or anchored) and abs(shift) < .45*period
            results.append(dict(x=x, y=y, band=band, holdout=band % 3 == 1, shift=float(shift+sub),
                                period=period, ncc=float(scores[best]), rival=rival, scale=scales[best], anchored=anchored,
                                accepted=bool(accepted), branches=[dict(shift=i-search, ncc=float(scores[i])) for i in peaks]))
    return results


def fit_matches(matches):
    accepted = [m for m in matches if m['accepted']]
    train = [m for m in accepted if not m['holdout']]
    held = [m for m in accepted if m['holdout']]
    if len(train) < 8 or len(held) < 5 or len({m['band'] for m in train}) < 2:
        return dict(accepted=False, reason='insufficient unambiguous, spatially separated support', train=len(train), holdout=len(held))
    origin = np.mean([[m['x'], m['y']] for m in train], axis=0)
    def design(rows):
        xy = np.array([[m['x'], m['y']] for m in rows])-origin
        return np.c_[xy/500, np.ones(len(rows))]
    A, b = design(train), np.array([m['shift'] for m in train])
    weights = np.ones(len(b))
    for _ in range(10):
        coef = np.linalg.lstsq(A*weights[:, None]**.5, b*weights**.5, rcond=None)[0]
        weights = np.minimum(1, 1.5/np.maximum(abs(A@coef-b), 1e-8))
    baseline = np.abs([m['shift'] for m in held])
    residual = abs(design(held)@coef-np.array([m['shift'] for m in held]))
    return dict(accepted=bool(np.quantile(residual, .9) < 2 and np.median(residual) < np.median(baseline)*.5),
                train=len(train), holdout=len(held), origin=origin.tolist(), coefficients=coef.tolist(),
                holdout_before_median=float(np.median(baseline)), holdout_before_p90=float(np.quantile(baseline, .9)),
                holdout_after_median=float(np.median(residual)), holdout_after_p90=float(np.quantile(residual, .9)))


def fit_serialized_grid(matches, frame, center, pn, normal, tangent, lo, ppm):
    """Fit actual native bilinear nodes, preserving image-line tangent exactly.

    Only train-supported nodes and one neighboring ring are unknown. Held-out
    correspondence values never select nodes or tune the fixed regularization.
    Exact ray/plane reprojection validates the serialized field before export.
    """
    train = [m for m in matches if m['accepted'] and not m['holdout']]
    held = [m for m in matches if m['accepted'] and m['holdout']]
    if len(train) < 8 or len(held) < 5:
        return None, dict(accepted=False, reason='insufficient support')
    if len({m['band'] for m in train}) < 3:
        return None, dict(accepted=False, reason='fewer than three training tangent strips: leave-one-strip affine model selection is rank deficient; serialize a known common-graph model separately')
    width, height = frame['width'], frame['height']
    gx, gy = np.meshgrid(np.linspace(0, width, 12), np.linspace(0, height, 8))
    nodes_uv = np.stack((gx, gy), -1).reshape(-1, 2)
    node_world, _ = plane_ray(nodes_uv, frame, center, pn)
    tangent_uv = project(node_world+tangent*.001, frame)[0]-nodes_uv
    directions = np.stack((-tangent_uv[:, 1], tangent_uv[:, 0]), -1)
    directions /= np.maximum(np.linalg.norm(directions, axis=1)[:, None], 1e-9)
    normal_uv = project(node_world+normal*.001, frame)[0]-nodes_uv
    directions *= np.where((normal_uv*directions).sum(1) < 0, -1., 1.)[:, None]
    def rows(data):
        xy = np.array([[m['x'], m['y']] for m in data])
        world = center+(xy[:, :1]/ppm+lo[0])*tangent+(xy[:, 1:]/ppm+lo[1])*normal
        uv, _ = project(world, frame)
        grid = np.clip(uv/[width, height]*[11, 7], [0, 0], [10.999999, 6.999999])
        ij = np.floor(grid).astype(int); frac = grid-ij
        indices = np.stack((ij[:, 1]*12+ij[:, 0], ij[:, 1]*12+ij[:, 0]+1,
                            (ij[:, 1]+1)*12+ij[:, 0], (ij[:, 1]+1)*12+ij[:, 0]+1), -1)
        weights = np.stack(((1-frac[:, 0])*(1-frac[:, 1]), frac[:, 0]*(1-frac[:, 1]),
                            (1-frac[:, 0])*frac[:, 1], frac[:, 0]*frac[:, 1]), -1)
        jac = np.stack([((plane_ray(uv+delta, frame, center, pn)[0]-world)@normal)*ppm
                        for delta in [[.1, 0], [0, .1]]], -1)/.1
        A = np.zeros((len(data), 96))
        for k in range(4):
            A[np.arange(len(data)), indices[:, k]] = weights[:, k]*(jac*directions[indices[:, k]]).sum(1)
        return A, uv, world, indices, weights
    A, _, _, support, _ = rows(train)
    direct = set(support.ravel().tolist())
    active = sorted({yy*12+xx for i in direct for yy in range(max(0, i//12-1), min(8, i//12+2))
                     for xx in range(max(0, i%12-1), min(12, i%12+2))})
    regularization = []
    for y in range(8):
        for x in range(12):
            for dx, dy in [(1, 0), (0, 1)]:
                if 0 <= x-dx and x+dx < 12 and 0 <= y-dy and y+dy < 8:
                    row = np.zeros(96); row[(y-dy)*12+x-dx] = 1
                    row[y*12+x] = -2; row[(y+dy)*12+x+dx] = 1
                    regularization.append(row)
    R = np.array(regularization)[:, active]
    b = np.array([m['shift'] for m in train])
    def solve(selected, regularization):
        selected_A, selected_b = A[selected][:, active], b[selected]
        weights = np.ones(len(selected_b))
        for _ in range(5):
            matrix = np.vstack((selected_A*weights[:, None]**.5, R*regularization**.5, np.eye(len(active))*.001))
            rhs = np.r_[selected_b*weights**.5, np.zeros(len(R)+len(active))]
            scalar = np.linalg.lstsq(matrix, rhs, rcond=None)[0]
            weights = np.minimum(1, 1.5/np.maximum(abs(selected_A@scalar-selected_b), 1e-8))
        return scalar
    # Choose smoothness using only the training strips. The outer held-out bands
    # remain untouched, including when the default smoothness cannot fit support.
    bands = np.array([m['band'] for m in train])
    candidates = []
    for regularization in [1e-5, 1e-4, .001, .01, .1]:
        cv_errors = []
        for band in sorted(set(bands.tolist())):
            inside, outside = bands != band, bands == band
            scalar = solve(inside, regularization)
            cv_errors.extend(abs(A[outside][:, active]@scalar-b[outside]).tolist())
        candidates.append(dict(regularization=regularization, p90=float(np.quantile(cv_errors, .9))))
    regularization = min(candidates, key=lambda candidate: candidate['p90'])['regularization']
    scalar = solve(np.ones(len(train), bool), regularization)
    # A lower-dimensional model is also evaluated through the ACTUAL grid. Its
    # three coefficients describe only normal displacement across the plane;
    # projected image-tangent movement remains zero. Select using training strips.
    origin = np.mean([[m['x'], m['y']] for m in train], axis=0)
    node_xy = np.stack(((node_world-center)@tangent, (node_world-center)@normal), -1)
    node_xy = (node_xy-lo)*ppm
    node_gradient = ((plane_ray(nodes_uv+directions*.1, frame, center, pn)[0]-node_world)@normal)*ppm/.1
    node_basis = np.c_[(node_xy-origin)/500, np.ones(96)]/node_gradient[:, None]
    BA = A[:, active]@node_basis[active]
    def affine_solve(selected):
        aa, bb = BA[selected], b[selected]
        weights = np.ones(len(bb))
        for _ in range(5):
            coef = np.linalg.lstsq(aa*weights[:, None]**.5, bb*weights**.5, rcond=None)[0]
            weights = np.minimum(1, 1.5/np.maximum(abs(aa@coef-bb), 1e-8))
        return coef
    affine_errors = []
    for band in sorted(set(bands.tolist())):
        inside, outside = bands != band, bands == band
        if np.linalg.matrix_rank(BA[inside]) < 3:
            return None, dict(accepted=False, reason='training strip fold cannot constrain the three affine coefficients')
        affine_errors.extend(abs(BA[outside]@affine_solve(inside)-b[outside]).tolist())
    affine_cv = float(np.quantile(affine_errors, .9))
    model = 'direct-grid'
    if affine_cv < min(candidate['p90'] for candidate in candidates):
        scalar = node_basis[active]@affine_solve(np.ones(len(train), bool))
        model = 'affine-normal-through-grid'
    values = np.zeros(96); values[active] = scalar
    field = directions*values[:, None]/[width, height]
    _, uv, world, indices, weights = rows(held)
    sampled = np.sum(field[indices]*weights[..., None], axis=1)*[width, height]
    observed = ((plane_ray(uv+sampled, frame, center, pn)[0]-world)@normal)*ppm
    desired = np.array([m['shift'] for m in held])
    residual = abs(observed-desired)
    accepted = (np.quantile(residual, .9) < 2 and np.median(residual) < np.median(abs(desired))*.5
                and np.max(abs(field)) <= .06 and np.isfinite(field).all())
    return field, dict(accepted=bool(accepted), active_nodes=len(active), train=len(train), holdout=len(held),
                       training_strip_cross_validation=candidates, regularization=regularization,
                       model=model, affine_training_strip_p90=affine_cv,
                       maximum_normalized_offset=float(np.max(abs(field))),
                       holdout_before_median=float(np.median(abs(desired))), holdout_before_p90=float(np.quantile(abs(desired), .9)),
                       holdout_after_median=float(np.median(residual)), holdout_after_p90=float(np.quantile(residual, .9)),
                       note='Image-node movement is normal to the projected panel lines; unsupported tangent is zero.')


def self_test():
    """Known normal affine shift must recover truth; periodic phase stays unknown."""
    rng = np.random.default_rng(12345)
    height, width = 1200, 1000
    y = np.arange(height)
    profile = np.ones(height)*180
    for center in np.arange(20, height, 46):
        center += rng.uniform(-5, 5)
        profile -= (10+rng.uniform(0, 45))*np.exp(-.5*((y-center)/1.8)**2)
    left = np.broadcast_to(profile[:, None], (height, width)).copy().astype('f4')
    right = np.empty_like(left)
    for x in range(width):
        right[:, x] = np.interp(y-(5+.004*x), y, profile)
    mask = np.ones_like(left, bool)
    matches = matches_for({0: left, 1: right}, {0: mask, 1: mask}, 0, 1)
    fit = fit_matches(matches)
    assert fit['accepted'], fit
    held = [m for m in matches if m['accepted'] and m['holdout']]
    xy = np.array([[m['x'], m['y']] for m in held])
    predicted = np.c_[(xy-fit['origin'])/500, np.ones(len(held))]@fit['coefficients']
    truth_error = np.abs(predicted-(5+.004*xy[:, 0]))
    assert max(truth_error) < .04, truth_error
    assert not ({m['band'] for m in matches if m['accepted'] and not m['holdout']}
                & {m['band'] for m in held}), 'Train and holdout strips overlap'
    frame = dict(width=3840, height=2160, intrinsics=[1400, 1400, 1920, 1080],
                 transform=np.eye(4).T.ravel().tolist())
    field, checked = fit_serialized_grid(matches, frame, np.array([0., 0., -2.]),
                                         np.array([0., 0., 1.]), np.array([0., 1., 0.]),
                                         np.array([1., 0., 0.]), np.array([-1., -1.]), 450)
    assert checked['accepted'] and checked['holdout_after_p90'] < .1, checked
    assert np.max(abs(field[:, 0])) < 1e-12, 'Unobserved image-tangent movement was introduced'
    sparse = [m for m in matches if m['band'] in [0, 1, 2]]
    rejected, sparse_check = fit_serialized_grid(sparse, frame, np.array([0., 0., -2.]),
                                                np.array([0., 0., 1.]), np.array([0., 1., 0.]),
                                                np.array([1., 0., 0.]), np.array([-1., -1.]), 450)
    assert rejected is None and not sparse_check['accepted'], 'Rank-deficient strip CV was accepted'
    periodic = 180-30*np.cos(y*2*np.pi/46)
    left = np.broadcast_to(periodic[:, None], (height, width)).copy().astype('f4')
    right = np.broadcast_to(np.interp(y-6, y, periodic)[:, None], (height, width)).copy().astype('f4')
    ambiguous = matches_for({0: left, 1: right}, {0: mask, 1: mask}, 0, 1)
    assert not any(m['accepted'] for m in ambiguous), 'Periodic aliases must be rejected'
    empty = np.zeros_like(left)
    assert not matches_for({0: empty, 1: empty}, {0: mask, 1: mask}, 0, 1)
    print(json.dumps(dict(result='PASS', holdout=len(held), maximum_known_shift_error=float(max(truth_error)),
                          serialized_grid_holdout_p90=checked['holdout_after_p90'],
                          periodic_candidates=len(ambiguous), periodic_accepted=0)))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['mesh', 'regions', 'root', 'keyframes', 'output']:
        p.add_argument(name, type=Path)
    p.add_argument('--pairs', default='35:31,4:31,35:4')
    p.add_argument('--ppm', type=float, default=450)
    p.add_argument('--local-affine', action='store_true', help='Also search ±6%% normal-direction scale per broad profile window.')
    p.add_argument('--feature-phase-anchor', action='store_true', help='Use independently matched, depth-supported trim identities to select panel phase.')
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('mesh', Path(__file__).with_name('audit-scan-mesh-matches.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    triangles = mod.load_mesh(args.mesh)
    regions = json.loads(args.regions.read_text())['regions']
    region = max((r for r in regions if abs(r['normal'][1]) < .35), key=lambda r: r['area_m2'])
    pn, center = np.array(region['normal']), np.array(region['center'])
    joined = [r for r in regions if np.dot(r['normal'], pn) > .999 and abs(np.dot(np.array(r['center'])-center, pn)) < .02]
    selected = triangles[np.concatenate([r['triangle_indices'] for r in joined])]
    pairs = [tuple(map(int, pair.split(':'))) for pair in args.pairs.split(',')]
    wanted = set(sum((list(pair) for pair in pairs), []))
    frames = {f['index']: f for f in json.loads(args.keyframes.read_text()) if f['index'] in wanted}
    u, v = np.array(region['axis_u']), np.array(region['axis_v'])
    images, masks, _, _ = rectify(selected, center, u, v, frames, args.root, args.ppm)
    # The dominant gradient determines the observable normal; no known panel angle.
    ref = pairs[0][0]; im = cv.GaussianBlur(images[ref], (0, 0), 2)
    gx, gy = np.gradient(im, axis=1), np.gradient(im, axis=0)
    good = masks[ref]
    tensor = np.array([[np.sum(gx[good]**2), np.sum(gx[good]*gy[good])],
                       [np.sum(gx[good]*gy[good]), np.sum(gy[good]**2)]])
    val, vec = np.linalg.eigh(tensor); normal2 = vec[:, -1]
    if normal2[np.argmax(abs(normal2))] < 0:
        normal2 = -normal2
    normal = normal2[0]*u+normal2[1]*v
    tangent = np.cross(pn, normal)
    images, masks, lo, _ = rectify(selected, center, tangent, normal, frames, args.root, args.ppm)
    for fi in frames:
        cv.imwrite(str(args.output/f'plane-frame-{fi}.png'), np.where(masks[fi], images[fi], 0).astype('uint8'))
    result = dict(plane_normal=pn.tolist(), center=center.tolist(), tangent=tangent.tolist(),
                  normal=normal.tolist(), lo=lo.tolist(), ppm=args.ppm,
                  direction_ratio=float(val[0]/max(val[1], 1e-9)), keyframes=str(args.keyframes), pairs=[])
    fields = {}
    for ref, target in pairs:
        anchor = feature_phase_anchor(frames[ref], frames[target], args.root, center, pn, normal, tangent, args.ppm) if args.feature_phase_anchor else None
        matches = matches_for(images, masks, ref, target, args.local_affine, anchor)
        fit = fit_matches(matches)
        field, grid_check = fit_serialized_grid(matches, frames[target], center, pn, normal, tangent, lo, args.ppm) if fit['accepted'] else (None, None)
        if grid_check and grid_check['accepted']:
            candidate = dict(gridWidth=12, gridHeight=8, fields={str(target): field.tolist()})
            (args.output/f'fields-reference-{ref}-target-{target}.json').write_text(json.dumps(candidate, indent=2, allow_nan=False))
            # Independent pair gauges must never silently overwrite/combine each
            # other. A connected common-reference graph is a separate solve.
            if len(pairs) == 1:
                fields[str(target)] = field.tolist()
        entry = dict(reference=ref, target=target, matches=matches, fit=fit, phase_anchor=anchor, grid_check=grid_check)
        result['pairs'].append(entry)
        print(json.dumps(dict(reference=ref, target=target, candidates=len(matches), accepted_matches=sum(m['accepted'] for m in matches), fit=fit, grid_check=grid_check)), flush=True)
    (args.output/'results.json').write_text(json.dumps(result, indent=2, allow_nan=False))
    if fields:
        (args.output/'fields.json').write_text(json.dumps(dict(gridWidth=12, gridHeight=8, fields=fields), indent=2, allow_nan=False))
    else:
        (args.output/'fields.json').unlink(missing_ok=True)


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    else:
        main()
