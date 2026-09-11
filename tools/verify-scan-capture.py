#!/usr/bin/env python3
"""Run the production Swift capture retry predicate on macOS, without ARKit hardware.

    python3 tools/verify-scan-capture.py

Extract the actual method so the test cannot drift into a second implementation.
The real camera, exposure estimate and replacement buffer still need device QA.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "modules/ampex-splat/ios/MeshScanPresenter.swift").read_text()
start = source.index("    static func shouldRetrySharperFrame(")
end = source.index("\n    }", start) + len("\n    }")
method = source[start:end]
o_start = source.index("    static func shouldOverrideInterval(")
o_end = source.index("\n    }", o_start) + len("\n    }")
method += "\n" + source[o_start:o_end]
e_start = source.index("    static func kortereEksponering(")
e_end = source.index("\n    }", e_start) + len("\n    }")
method += "\n" + source[e_start:e_end]
checks = r"""
func retry(_ previous: Float?, _ current: Float) -> Bool {
    Capture.shouldRetrySharperFrame(previousBlur: previous, currentBlur: current)
}
// A slowing sweep must challenge its earlier blurry image without another 12 cm move.
assert(retry(20, 10))
assert(retry(10, 2))
// Once the better frame was dispatched, steady video must not cause endless captures.
assert(!retry(2, 2))
assert(!retry(10, 10))
// Small estimator fluctuations and worsening motion do not justify another 4K copy.
assert(!retry(20, 16))
assert(!retry(20, 15))
assert(!retry(10, 20))
// Missing/nonphysical input must never open the gate.
assert(!retry(nil, 0))
assert(!retry(.infinity, 0))
assert(!retry(10, .nan))
assert(!retry(10, -1))
func slipp(_ since: Double, _ nov: Float, _ blur: Float, _ gate: Float = 40) -> Bool {
    Capture.shouldOverrideInterval(sinceLast: since, novelty: nov, blurPx: blur, blurGatePx: gate)
}
// En panorering over ufotografert vegg skal slippe forbi minsteintervallet på 0,2 s.
assert(slipp(0.12, 0.40, 10))
assert(slipp(0.09, 0.26, 39))
// Men aldri raskere enn 0,08 s, og aldri når synsfeltet alt er fotografert.
assert(!slipp(0.05, 0.90, 5))
assert(!slipp(0.15, 0.25, 5))
assert(!slipp(0.15, 0.10, 5))
// Et sløret bilde er ikke verdt en 4K-kopi selv om flaten mangler.
assert(!slipp(0.15, 0.90, 41))
assert(!slipp(0.15, 0.90, 5, 0))
// Ikke-fysiske verdier må aldri åpne porten.
assert(!slipp(.nan, 0.9, 5))
assert(!slipp(0.15, .nan, 5))
assert(!slipp(0.15, 0.9, .nan))
assert(!slipp(0.15, 0.9, -1))
assert(!slipp(.infinity, 0.9, 5))
func eksp(_ ms: Float, _ iso: Float, _ tak: Float, _ maksIso: Float, _ minMs: Float = 0.05) -> (Float?, Float?) {
    Capture.kortereEksponering(naaMs: ms, naaIso: iso, takMs: tak, maksIso: maksIso, minMs: minMs)
}
// 1/30 s med ISO-takhøyde: kortes helt ned til taket, og ISO bærer lysmengden.
let a = eksp(33.3, 200, 8, 3200)
assert(a.0 != nil && abs(a.0! - 8) < 0.01)
assert(a.1 != nil && abs(a.1! - 200 * (33.3 / 8)) < 1)
// Halv takhøyde: tiden kortes bare så langt ISO rekker, bildet blir like lyst.
let b = eksp(33.3, 1600, 8, 3200)
assert(b.0 != nil && abs(b.0! - 33.3 / 2) < 0.1)
assert(b.1 != nil && abs(b.1! - 3200) < 1)
// Alt kort nok, ingen ISO-takhøyde, eller taket av → ingen endring, vanlig lås brukes.
assert(eksp(6, 200, 8, 3200).0 == nil)
assert(eksp(33.3, 3200, 8, 3200).0 == nil)
assert(eksp(33.3, 200, 0, 3200).0 == nil)
// Kameraets korteste lukkertid respekteres.
let c = eksp(33.3, 100, 0.2, 100000, 1.0)
assert(c.0 != nil && c.0! >= 1.0 - 1e-4)
// Ikke-fysiske verdier åpner aldri for et moduskifte.
assert(eksp(.nan, 200, 8, 3200).0 == nil)
assert(eksp(33.3, .nan, 8, 3200).0 == nil)
assert(eksp(33.3, 200, 8, .nan).0 == nil)
assert(eksp(0, 200, 8, 3200).0 == nil)
assert(eksp(33.3, -5, 8, 3200).0 == nil)
print("OK: 11 capture retry + 11 coverage-override + 12 exposure-cap assertions (production Swift)")
"""
with tempfile.TemporaryDirectory(prefix="ampex-capture-") as folder:
    path = Path(folder) / "main.swift"
    path.write_text("import Foundation\nenum Capture {\n" + method + "\n}\n" + checks)
    subprocess.run(["swift", "-module-cache-path", folder + "/cache", str(path)], check=True)
