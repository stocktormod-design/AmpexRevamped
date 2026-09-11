#!/usr/bin/env python3
"""Check coverage eligibility before photo ranking using the production Swift method."""
from pathlib import Path
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1] / "modules/ampex-splat/ios/MeshBakeV2.swift").read_text()
start = source.index("    static func planeViewScore(")
end = source.index("\n    }", start) + len("\n    }")
method = source[start:end]
checks = r"""
// Measured failure: a high-score 89.9% view hid a valid 91.2% view.
let candidates: [(Int, Float, Float)] = [(0, 0.899, 10), (1, 0.912, 1)]
let eligible = candidates.compactMap { id, coverage, quality -> (Int, Float)? in
    guard let score = Bake.planeViewScore(coverage: coverage, meanScore: quality, isPlaneShot: false) else { return nil }
    return (id, score)
}
assert(eligible.max { $0.1 < $1.1 }?.0 == 1)
// Same coverage threshold, not a relaxed hole-filling rule.
assert(Bake.planeViewScore(coverage: 0.9, meanScore: 1, isPlaneShot: false) != nil)
assert(Bake.planeViewScore(coverage: 0.89999, meanScore: 100, isPlaneShot: true) == nil)
// Original ranking and dedicated-still priority are preserved for eligible views.
let regular = Bake.planeViewScore(coverage: 1, meanScore: 2, isPlaneShot: false)!
let still = Bake.planeViewScore(coverage: 1, meanScore: 2, isPlaneShot: true)!
assert(regular == 2 && still == 6)
assert(Bake.planeViewScore(coverage: .nan, meanScore: 2, isPlaneShot: false) == nil)
assert(Bake.planeViewScore(coverage: 1, meanScore: .infinity, isPlaneShot: false) == nil)
print("OK: 6 plane photo selection assertions (production Swift)")
"""
with tempfile.TemporaryDirectory(prefix="ampex-plane-score-") as folder:
    path = Path(folder) / "main.swift"
    path.write_text("import Foundation\nenum Bake {\n" + method + "\n}\n" + checks)
    subprocess.run(["swift", "-module-cache-path", folder + "/cache", str(path)], check=True)
