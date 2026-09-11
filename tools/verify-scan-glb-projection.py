#!/usr/bin/env python3
"""Check the GLB audit's projective classification on independent vertices."""
import importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-scan-glb-layout.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
rng = np.random.default_rng(16)
points = rng.uniform([-1, -1, 2], [1, 1, 4], (900, 3))
uv = points[:, :2]/points[:, 2, None]*.4+.5
fit = audit.projection_fit(points, uv, [8192, 8192])
assert fit['projective_error_px_p50_p90'][1] < 1e-7, fit
assert fit['affine_error_px_p50_p90'][1] > 10, fit
bad = uv+rng.normal(0, .003, uv.shape)
reject = audit.projection_fit(points, bad, [8192, 8192])
assert reject['projective_error_px_p50_p90'][1] > 10, reject
print('PASS: camera projection recovered on held-out vertices; incompatible UVs rejected.')
