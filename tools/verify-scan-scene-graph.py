#!/usr/bin/env python3
"""Check RGB/depth world-coordinate conversion used by scene graph diagnostics."""
import importlib.util
from pathlib import Path
import tempfile
import numpy as np
s = importlib.util.spec_from_file_location('scene', Path(__file__).with_name('audit-scan-scene-graph.py'))
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder); depth = np.full((16, 16), 2., '<f4'); depth.tofile(root/'depth.f32')
    pose = np.eye(4); pose[:3, 3] = [1, 2, 3]
    f = {'depthFile': 'depth.f32', 'depthHeight': 16, 'depthWidth': 16, 'width': 1600,
         'height': 1600, 'intrinsics': [800, 800, 800, 800], 'transform': pose.T.ravel().tolist()}
    world, valid = m.observations(f, [[800, 800], [1000, 800], [800, 1000], [0, 0]], root)
    assert valid.tolist() == [True, True, True, False]
    np.testing.assert_allclose(world[:3], [[1, 2, 1], [1.5, 2, 1], [1, 1.5, 1]])
    depth[8, 8] = np.nan; depth.tofile(root/'depth.f32')
    assert not m.observations(f, [[800, 800]], root)[1][0]
    depth[8, 8] = 2.1; depth.tofile(root/'depth.f32')
    assert not m.observations(f, [[800, 800]], root)[1][0]
print('PASS: world translation, RGB/depth scaling, camera-axis signs, borders, invalid and discontinuous depth.')
