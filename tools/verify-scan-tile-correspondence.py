#!/usr/bin/env python3
"""Synthetic checks for diagnostic matching; not a real-scene validation."""
import importlib.util
from pathlib import Path
import numpy as np
import cv2 as cv
s = importlib.util.spec_from_file_location('correspondence', Path(__file__).with_name('audit-scan-tile-correspondence.py'))
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
rng = np.random.default_rng(42)
p = cv.GaussianBlur(rng.normal(size=(1, 192)).astype('float32'), (0, 0), 2)[0]
valid = np.ones(192, bool)
for shift in [-19, 11]:
    idx = np.arange(192)-shift; supported = (idx >= 0) & (idx < 192)
    q = p[np.clip(idx, 0, 191)]
    result = m.match((p, valid), (q, supported))
    assert result['accepted'] and result['best']['shift'] == shift, result
periodic = np.sin(np.arange(192)*2*np.pi/32)
assert not m.match((periodic, valid), (np.roll(periodic, 11), valid))['accepted']
assert not m.match((np.zeros(192), valid), (np.zeros(192), valid))['accepted']
assert not m.match((p, np.zeros(192, bool)), (p, valid))['accepted']
# Exercise rectification/profiling as well as the scalar matcher.
im = np.tile(120+30*p, (192, 1)).astype('float32')
source = np.zeros_like(im); source[:, 11:] = im[:, :-11]
mask = np.ones_like(im, 'uint8')*255; source_mask = mask.copy(); source_mask[:, :11] = 0
for image, other, ma, mb, direction in [(im, source, mask, source_mask, [1, 0]),
                                       (im.T, source.T, mask.T, source_mask.T, [0, 1])]:
    for a, b in zip(m.profiles(image, ma, direction), m.profiles(other, mb, direction)):
        result = m.match(a, b)
        assert result['accepted'] and result['best']['shift'] == 11, result
print('PASS: signed shifts, repeated-pattern rejection, no-detail/missing-support rejection, two directional profile halves.')
