#!/usr/bin/env python3
"""Exercise the production best-evaluated-state selector used by pose and warp refinement."""
from pathlib import Path
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1] / "modules/ampex-splat/ios/MeshPoseRefineV2.swift").read_text()
start = source.index("    struct EvaluatedState<Value> {")
end = source.index("\n    private struct Frame", start)
selector = source[start:end]
checks = r"""
// The last proposal is deliberately never evaluated: it must not be exported.
var best = EvaluatedState([0])
best.consider([0], residual: 0.4, samples: 100)
best.consider([1], residual: 0.2, samples: 100)
best.consider([2], residual: 0.3, samples: 100)
assert(best.value == [1] && best.residual == 0.2)
// A worsening warp must retain identity.
var warp = EvaluatedState([Float(0), 0])
warp.consider([0, 0], residual: 0.1, samples: 100)
warp.consider([5, 3], residual: 0.2, samples: 100)
assert(warp.value == [0, 0])
// No observations is not a perfect zero-error measurement.
best.consider([3], residual: 0, samples: 0)
assert(best.value == [1])
best.consider([4], residual: .nan, samples: 100)
best.consider([5], residual: .infinity, samples: 100)
best.consider([6], residual: -1, samples: 100)
assert(best.value == [1])
// Equal scores retain the earlier state; a real improvement is accepted.
best.consider([7], residual: 0.2, samples: 100)
assert(best.value == [1])
best.consider([8], residual: 0.1, samples: 100)
assert(best.value == [8] && best.residual == 0.1)
var empty = EvaluatedState(42)
empty.consider(99, residual: 0, samples: 0)
assert(empty.value == 42 && empty.residual == nil)
print("OK: 7 refinement state assertions (production Swift)")
"""
with tempfile.TemporaryDirectory(prefix="ampex-refine-") as folder:
    path = Path(folder) / "main.swift"
    path.write_text("import Foundation\n" + selector + checks)
    subprocess.run(["swift", "-module-cache-path", folder + "/cache", str(path)], check=True)
