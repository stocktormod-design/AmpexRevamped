#!/usr/bin/env python3
"""Diagnose directional correspondence, never emit a correction field.

Usage: script detail-output-directory output.json
Profiles test line-normal displacement only. Repeated stripes, camera/geometry
errors, dynamic content and tangent motion need independent identity evidence.
"""
import json
import sys
from pathlib import Path
import cv2 as cv
import numpy as np


def profiles(image, mask, direction):
    direction = np.asarray(direction, float)
    direction /= np.linalg.norm(direction)
    tangent = np.array([-direction[1], direction[0]])
    result = []
    for start, stop in [(-72, -8), (8, 72)]:
        s, t = np.meshgrid(np.arange(-95, 97), np.arange(start, stop))
        xy = (np.array(image.shape[::-1])-1)/2 + s[..., None]*direction+t[..., None]*tangent
        values = cv.remap(image.astype('float32'), xy[..., 0].astype('float32'),
                          xy[..., 1].astype('float32'), cv.INTER_LINEAR)
        valid = cv.remap(mask, xy[..., 0].astype('float32'), xy[..., 1].astype('float32'),
                        cv.INTER_NEAREST) > 0
        count = valid.sum(0)
        profile = (values*valid).sum(0)/np.maximum(count, 1)
        # Suppress exposure gradients; no wraparound or invented border samples.
        narrow = cv.GaussianBlur(profile[None].astype('float32'), (0, 0), 1)[0]
        broad = cv.GaussianBlur(profile[None].astype('float32'), (0, 0), 8)[0]
        supported = (count >= .9*(stop-start)).astype('uint8')[None]
        supported = cv.erode(supported, np.ones((1, 67), 'uint8'), borderType=cv.BORDER_CONSTANT, borderValue=0)[0] > 0
        result.append((narrow-broad, supported))
    return result


def match(a, b, limit=64):
    """Positive shift means the source b feature is at a larger profile index."""
    p, pm = a; q, qm = b; n = len(p); scores = []
    for shift in range(-limit, limit+1):
        idx = np.arange(max(0, -shift), min(n, n-shift)); keep = pm[idx] & qm[idx+shift]
        if keep.sum() < 48:
            continue
        x = p[idx[keep]].astype(float); y = q[idx[keep]+shift].astype(float)
        x -= x.mean(); y -= y.mean(); norm = np.linalg.norm(x)*np.linalg.norm(y)
        if norm < 1e-6:
            continue
        scores.append({'shift': shift, 'correlation': float(x@y/norm), 'samples': int(keep.sum())})
    if not scores:
        return {'accepted': False, 'reason': 'insufficient_profile'}
    by_shift = {s['shift']: s['correlation'] for s in scores}
    peaks = [s for s in scores if s['correlation'] >= by_shift.get(s['shift']-1, -2)
             and s['correlation'] >= by_shift.get(s['shift']+1, -2)]
    peaks.sort(key=lambda s: s['correlation'], reverse=True)
    best = peaks[0]
    competitors = [s for s in peaks[1:] if abs(s['shift']-best['shift']) >= 8]
    gap = best['correlation']-competitors[0]['correlation'] if competitors else 2.
    accepted = best['correlation'] >= .85 and gap >= .1 and min(by_shift) < best['shift'] < max(by_shift)
    return {'accepted': accepted, 'best': best, 'peak_gap': gap, 'peaks': peaks[:5],
            'reason': 'candidate_only' if accepted else 'weak_ambiguous_or_boundary'}


def main():
    folder, output = map(Path, sys.argv[1:])
    data = json.loads((folder/'results.json').read_text()); rows = []
    for tile in data['tiles']:
        ref = tile['candidates'][0]
        if ref['two_direction_ratio'] > .2:
            continue  # This diagnostic only constrains nearly one-directional detail.
        def read(c):
            prefix = folder/f"{tile['id']}-frame{c['frame']}"
            im = cv.imread(str(prefix)+'.png', 0); mask = cv.imread(str(prefix)+'-mask.png', 0)
            if im is None or mask is None:
                raise ValueError(f'Missing image/mask: {prefix}; regenerate detail outputs')
            return profiles(im, mask, ref['dominant_gradient'])
        a = read(ref)
        for source in tile['candidates'][1:]:
            b = read(source); halves = [match(x, y) for x, y in zip(a, b)]
            consistent = all(h['accepted'] for h in halves) and abs(halves[0]['best']['shift']-halves[1]['best']['shift']) <= 2
            rows.append({'tile': tile['id'], 'reference': ref['frame'], 'source': source['frame'],
                         'direction': ref['dominant_gradient'], 'halves': halves,
                         'consistent_unique_candidate': consistent})
    result = {'scope': 'Line-normal candidates only; no physical identity or tangent-motion validation; not safe to activate',
              'pairs': rows, 'pair_count': len(rows),
              'consistent_unique_candidates': sum(r['consistent_unique_candidate'] for r in rows)}
    output.write_text(json.dumps(result, indent=2, allow_nan=False))
    print(json.dumps({k: v for k, v in result.items() if k != 'pairs'}))


if __name__ == '__main__':
    main()
