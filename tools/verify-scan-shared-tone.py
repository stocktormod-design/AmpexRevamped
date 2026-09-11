#!/usr/bin/env python3
"""Check the shared-wall-tone regression contracts using production Swift helpers.

Runs on macOS with Python 3 and Swift; no scan fixture or third-party packages.
The fixture-derived geometry reproduces a wall face rejected by its noisy normal.
The synthetic photometric cases exercise support entering a camera, conflicting
region offsets, and preservation of a narrow detail on an illumination ramp.
Actual mesh/atlas output still requires the native same-fixture A/B check.
"""
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
BAKE = (ROOT / "modules/ampex-splat/ios/MeshBakeV2.swift").read_text()


def function_source(signature):
    start = BAKE.index(signature)
    opening = BAKE.index("{", start)
    depth, end = 1, opening + 1
    while depth:
        depth += (BAKE[end] == "{") - (BAKE[end] == "}")
        end += 1
    return BAKE[start:end]


SWIFT = r'''
import Foundation
import simd
import Darwin

enum Bake {
__EDGE__
__RESCUE__
__TARGET__
__SIZES__

    static func sharedToneEnabled(_ override: String?) -> Bool {
        let sharedTone = __SELECTOR__
        return sharedTone
    }

    static func continueTargets(positions: [SIMD3<Float>], neighbors: [Set<Int>],
                                observed: [SIMD3<Float>?]) -> [SIMD3<Float>?] {
        let toneNodes = positions.map { (p: $0, plane: 0) }
        let toneNeighbors = neighbors
        var nodeTarget = observed
__CONTINUATION__
        return nodeTarget
    }
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

check(Bake.sharedToneEnabled(nil), "Normal app scans must use the verified shared tone by default")
check(Bake.sharedToneEnabled("on") && !Bake.sharedToneEnabled("off"),
    "The explicit off switch must still restore the comparison control")

// A dark photograph starts covering a surface at the native eight-pixel guard.
// Previously its nonzero minimum score changed the tone immediately by >0.1.
// A common point target must instead approach the same value from both sides.
func target(_ margin: Float) -> Float {
    let incoming = 0.3 * Bake.toneEdgeWeight(margin: margin, footprint: 60)
    return (0.8 + incoming * 0.2) / (1 + incoming)
}
let oldEntryJump: Float = 0.8 - (0.8 + 0.3 * 0.2) / 1.3
let newEntryJump = abs(target(8.001) - target(7.999))
check(oldEntryJump > 0.1 && newEntryJump < 0.000001,
    "An entering support photo must not create a triangle-sized exposure step")
var last: Float = 0
for i in -20...1000 {
    let weight = Bake.toneEdgeWeight(margin: Float(i) / 10, footprint: 60)
    check(weight >= 0 && weight <= 1 && weight >= last,
        "Image-edge support must remain bounded and monotonic")
    last = weight
}
check(Bake.toneEdgeWeight(margin: 8, footprint: 60) == 0,
    "A candidate exactly at the visibility boundary contributes no tone")
check(Bake.toneEdgeWeight(margin: 68, footprint: 60) == 1,
    "An interior image retains its original support weight")
for invalid: Float in [0, -1, .nan, .infinity, -.infinity] {
    check(Bake.toneEdgeWeight(margin: 100, footprint: invalid) == 0,
        "Invalid tone dimensions must not propagate NaNs or unsupported weight")
}
for invalid: Float in [.nan, .infinity, -.infinity] {
    check(Bake.toneEdgeWeight(margin: invalid, footprint: 60) == 0,
        "Invalid projected coordinates must not contribute tone")
}

// Real face 9045, new 2026-09-09 scan: every vertex is within 7.82 mm of the
// wall, but its 0.7617 normal alignment failed the former 0.9 plane criterion.
let wall = SIMD3<Float>(-0.8998206258, 0.0244355015, 0.4355753660)
let wallD: Float = -2.0196740627
let corners: [SIMD3<Float>] = [
    SIMD3(1.7225211859, -0.3806281090, -1.0749652386),
    SIMD3(1.7180893421, -0.3877478242, -1.0698890686),
    SIMD3(1.7300326824, -0.3626987636, -1.0457549095),
]
let normal = simd_normalize(simd_cross(corners[1] - corners[0], corners[2] - corners[0]))
check(simd_dot(normal, wall) < 0.9,
    "The measured test face must reproduce the original normal rejection")
func rescued(_ classification: UInt8 = 1, _ points: [SIMD3<Float>] = corners,
             _ faceNormal: SIMD3<Float> = normal, _ neighbors: [Int32] = [0, 0]) -> Int32? {
    Bake.supportedTonePlane(classification: classification, normal: faceNormal,
        corners: points, neighborPlanes: neighbors, planeNormals: [wall], planeDistances: [wallD])
}
check(rescued() == 0,
    "A coplanar wall face between two existing wall neighbors must share their treatment")
for classification: UInt8 in [0, 2, 3, 4, 5, 6, 7] {
    check(rescued(classification) == nil,
        "Wall rescue must not expand to furniture, glass, doors, floor or ceiling classes")
}
check(rescued(1, corners, normal, [0]) == nil,
    "One wall neighbor is insufficient evidence to absorb an adjacent object")
check(rescued(1, corners, normal, [0, 1]) == nil,
    "Neighbors on different planes do not establish one shared wall")
check(rescued(1, corners, -normal) == nil,
    "A folded or reverse-facing surface must not be treated as the wall")
var protruding = corners
protruding[0] += wall * 0.022
let protrudingCenter = (protruding[0] + protruding[1] + protruding[2]) / 3
check(abs(simd_dot(wall, protrudingCenter) - wallD) < 0.01,
    "The protrusion case must fool a centroid-only plane test")
check(rescued(1, protruding) == nil,
    "Every vertex, not merely the centroid, must be near the wall")
check(rescued(1, corners.map { $0 + wall * 0.02 }) == nil,
    "A separate parallel surface must retain its own treatment")
check(Bake.supportedTonePlane(classification: 1, normal: SIMD3(0, -1, 0),
    corners: [SIMD3(0, 1, 0), SIMD3(1, 1, 0), SIMD3(0, 1, 1)],
    neighborPlanes: [0, 0], planeNormals: [SIMD3(0, -1, 0)], planeDistances: [-1]) == nil,
    "The wall-only rescue must not modify FLAT ceiling handling")

// Continue an observed broad illumination field over a tiny visibility gap,
// without reaching another surface or recursively inventing a larger field.
let origin = SIMD3<Float>.zero
let nearTone = SIMD3<Float>(0.3, 0.4, 0.5)
let farTone = SIMD3<Float>(0.5, 0.6, 0.7)
let left = (position: SIMD3<Float>(-0.01, 0, 0), tone: nearTone)
let right = (position: SIMD3<Float>(0.03, 0, 0), tone: farTone)
let continuation = Bake.supportedToneTarget(position: origin, neighbors: [left, right])!
check(simd_length(continuation - SIMD3<Float>(0.35, 0.45, 0.55)) < 0.000001,
    "Continuation must stay between observed tones and favor nearby support")
check(Bake.supportedToneTarget(position: origin, neighbors: [left]) == nil,
    "One observed point cannot justify continuation across a missing camera sample")
check(Bake.supportedToneTarget(position: origin, neighbors: [left,
    (SIMD3<Float>(0.0501, 0, 0), farTone)]) == nil,
    "An observation beyond five centimeters must not fill the visibility gap")
check(Bake.supportedToneTarget(position: origin, neighbors: [left,
    (SIMD3<Float>(0.05, 0, 0), farTone)]) != nil,
    "A second valid observation at the bounded distance remains usable")
for badPoint in [origin, SIMD3<Float>(.nan, 0, 0), SIMD3<Float>(.infinity, 0, 0)] {
    check(Bake.supportedToneTarget(position: origin, neighbors: [left, (badPoint, farTone)]) == nil,
        "Coincident or invalid positions cannot fabricate a second observation")
}
check(Bake.supportedToneTarget(position: origin, neighbors: [left,
    (right.position, SIMD3<Float>(.nan, 0.5, 0.5))]) == nil,
    "Invalid observed color must not poison a shared target")
let continued = Bake.continueTargets(
    positions: [SIMD3(-0.02, 0, 0), SIMD3(0.02, 0, 0), origin, SIMD3(0, 0.02, 0)],
    neighbors: [Set([2]), Set([2, 3]), Set([0, 1, 3]), Set([1, 2])],
    observed: [nearTone, farTone, nil, nil])
check(continued[2] != nil && continued[3] == nil,
    "A newly filled node must not become evidence for filling its next neighbor")
check(continued[0] == nearTone && continued[1] == farTone,
    "Observed targets must remain unchanged during the bounded continuation pass")

// Two faces can have different pre-existing region/corner offsets. Once their
// physical vertex has one common target, those old offsets must cancel rather
// than becoming visible modes. These magnitudes mirror the observed ~0.1 leak.
let desired: Float = 0.065
func correctedLowTone(winner: Float, region: Float, corner: Float) -> Float {
    let have = winner + region + corner
    let delta = min(0.35, max(-0.35, desired - have))
    return winner + region + corner + delta
}
let regular = correctedLowTone(winner: 0.05, region: 0.106, corner: 0.001)
let hybrid = correctedLowTone(winner: 0.05, region: 0.106, corner: -0.091)
check(abs(regular - hybrid) < 0.000001 && abs(regular - desired) < 0.000001,
    "A shared target must remove the old mode-dependent region-level discontinuity")

// A linearly interpolated tone correction changes illumination, not the narrow
// source feature. Compare against the local linear baseline, so a global change
// of brightness cannot masquerade as increased sharpness or lost contrast.
let sampleCount = 4096, groove = 2039
var fullDetail = [Float](repeating: 0, count: sampleCount)
var adjusted = fullDetail
for i in 0..<sampleCount {
    let x = Float(i) / Float(sampleCount - 1)
    fullDetail[i] = 0.35 + 0.2 * x - (i == groove ? 0.18 : 0)
    adjusted[i] = fullDetail[i] + 0.08 - 0.13 * x
}
func contrast(_ pixels: [Float]) -> Float {
    (pixels[groove - 1] + pixels[groove + 1]) / 2 - pixels[groove]
}
check(abs(contrast(adjusted) - contrast(fullDetail)) < 0.000001,
    "The narrow full-resolution groove must retain its contrast after tone correction")
check(contrast(adjusted) > 0.179 && adjusted.count == fullDetail.count,
    "Tone support must neither average source detail nor change its sampling density")
let sizes = Bake.planeToneSizes(override: nil)
check(sizes.flat == 512 && sizes.hybrid == 64,
    "Shared wall support must retain independent FLAT512 and HYBRID64 sampling")
print("PASS: continuous image support; measured noisy-normal wall rescue; object/ceiling exclusions")
print("PASS: bounded continuation from observed neighbors; no recursive propagation")
print("PASS: old region levels cancel at a common target; narrow source-detail contrast is preserved")
'''


def main():
    # Execute the actual snapshot-and-fill loop as well as its pure helper. This
    # catches a seemingly harmless switch from original to newly filled targets.
    start = BAKE.index("                let observedTargets = nodeTarget")
    end = BAKE.index('                MeshLog.log("V2 felles veggtone', start)
    selector = next(line.split("let sharedTone = ", 1)[1]
                    for line in BAKE.splitlines() if "let sharedTone = " in line)
    selector = selector.replace('UserDefaults.standard.string(forKey: "meshscan.toneshared")', "override")
    program = (SWIFT
               .replace("__EDGE__", function_source("    static func toneEdgeWeight("))
               .replace("__RESCUE__", function_source("    static func supportedTonePlane("))
               .replace("__TARGET__", function_source("    static func supportedToneTarget("))
               .replace("__CONTINUATION__", BAKE[start:end])
               .replace("__SELECTOR__", selector)
               .replace("__SIZES__", function_source("    static func planeToneSizes(")))
    with tempfile.TemporaryDirectory(prefix="ampex-shared-tone-") as folder:
        path = Path(folder) / "main.swift"
        path.write_text(program)
        subprocess.run(["swift", "-module-cache-path", folder + "/cache", str(path)], check=True)


if __name__ == "__main__":
    main()
