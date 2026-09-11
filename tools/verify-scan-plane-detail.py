#!/usr/bin/env python3
"""Run with the environment in requirements-scan-features.txt. Diagnostic only."""
import importlib.util
from pathlib import Path
import cv2 as cv
import numpy as np

spec = importlib.util.spec_from_file_location('detail', Path(__file__).with_name('audit-scan-plane-detail.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
rng = np.random.default_rng(7)
mask = np.ones((192, 192), np.uint8)
sharp = np.tile(np.where(np.arange(192) % 32 < 16, 80, 160), (192, 1)).astype('uint8')
blurred = cv.GaussianBlur(sharp, (0, 0), 2)
score = lambda im: module.detail(im, mask)
a, b = score(sharp), score(blurred)
assert a['detail_supported'] and b['detail_supported']
assert a['edge_sharpness_ratio'] > 1.5*b['edge_sharpness_ratio']
assert a['two_direction_ratio'] < .001
assert not score(np.full_like(sharp, 100))['detail_supported']
for noise in (1, 4, 8):
    plain = np.clip(100+rng.normal(0, noise, sharp.shape), 0, 255).astype('uint8')
    noisy_blur = np.clip(blurred+rng.normal(0, noise, sharp.shape), 0, 255).astype('uint8')
    assert not score(plain)['detail_supported'], (noise, score(plain))
    d = score(noisy_blur)
    assert d['detail_supported']
    assert abs(d['edge_sharpness_ratio']/b['edge_sharpness_ratio']-1) < .1
rotated = score(sharp.T)
assert abs(rotated['edge_sharpness_ratio']/a['edge_sharpness_ratio']-1) < 1e-5
assert abs(rotated['dominant_gradient'][1]) > .999
print('PASS: sharp/blur ordering, flat/noise rejection, noise stability, rotation. Not a fixture or camera-registration quality gate.')
