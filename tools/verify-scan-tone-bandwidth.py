#!/usr/bin/env python3
"""Regress sparse wall-tone aliasing using native ImageIO and production Swift.

Run on macOS with Python 3 and Swift. No scan fixture or third-party package is
needed. Thin, differently projected panel grooves must not become broad bright
triangles when a tone correction is sampled only at the mesh vertices.
"""
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
BAKE = (ROOT / "modules/ampex-splat/ios/MeshBakeV2.swift").read_text()
IMAGE_IO = (ROOT / "modules/ampex-splat/ios/MeshImageIO.swift").read_text()


def function_source(signature):
    start = BAKE.index(signature)
    opening = BAKE.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (BAKE[end] == "{") - (BAKE[end] == "}")
        end += 1
    return BAKE[start:end]


SWIFT = r'''
import Foundation
import CoreGraphics
import ImageIO
import simd
import Darwin

enum Bake {
__SIZES__
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}
let defaults = Bake.planeToneSizes(override: nil)
check(defaults.flat == 512 && defaults.hybrid == 64, "Separate ceiling and wall defaults")
for text in ["64", "512", "128"] {
    let size = Bake.planeToneSizes(override: text)
    check(size.flat == Int(text)! && size.hybrid == Int(text)!, "A/B override must set both paths")
}
for text in ["", "off", "0", "1", "-64"] {
    let size = Bake.planeToneSizes(override: text)
    check(size.flat == defaults.flat && size.hybrid == defaults.hybrid, "Invalid override must remain safe")
}

let dir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let sourceSize = 1024
let grooveCenters = [400, 416, 432]
func encoded(_ linear: Float) -> UInt8 {
    let v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * powf(linear, 1 / 2.4) - 0.055
    return UInt8(max(0, min(255, (v * 255).rounded())))
}
// The same narrow groove lands at different source pixels between views, as in
// the measured scan. A broad illumination ramp is present in every source.
for fi in 0..<grooveCenters.count {
    var pixels = [UInt8](repeating: 255, count: sourceSize * sourceSize * 4)
    for y in 0..<sourceSize { for x in 0..<sourceSize {
        let ramp: Float = 0.40 + 0.32 * (Float(x) + 0.5) / Float(sourceSize)
        let linear = abs(x - grooveCenters[fi]) < 2 ? ramp * 0.25 : ramp
        let value = encoded(linear), o = (y * sourceSize + x) * 4
        pixels[o] = value; pixels[o + 1] = value; pixels[o + 2] = value
    }}
    let provider = CGDataProvider(data: Data(pixels) as CFData)!
    let image = CGImage(width: sourceSize, height: sourceSize, bitsPerComponent: 8,
        bitsPerPixel: 32, bytesPerRow: sourceSize * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    let target = dir.appendingPathComponent("frame-\(fi).jpg")
    let destination = CGImageDestinationCreateWithURL(target as CFURL, "public.jpeg" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image,
        [kCGImageDestinationLossyCompressionQuality: 1.0] as CFDictionary)
    check(CGImageDestinationFinalize(destination), "Synthetic source encoding")
}

struct Mid { var rgba: [UInt8]; var w: Int; var h: Int }
struct Cand {
    var w2c = matrix_identity_float4x4
    var intr = SIMD4<Float>(1024, 1024, 512, 512)
    var imgW: Float = 1024
    var imgH: Float = 1024
}
let cands = [Cand](repeating: Cand(), count: 3)
let gains = [SIMD3<Float>](repeating: SIMD3(repeating: 1), count: 3)
let rasterWarpGrids: [[SIMD2<Float>]] = []
// No warp in this fixture. Fail if production sampling unexpectedly enters it.
enum MeshPoseRefineV2 { static let warpGridW = 2; static let warpGridH = 2 }
func warpedImageUV(_ uv: SIMD2<Float>, grid: [SIMD2<Float>], width: Int, height: Int) -> SIMD2<Float> {
    fatalError("Unexpected warp in the tone bandwidth fixture")
}
var s2l = [Float](repeating: 0, count: 256)
for i in 0..<256 {
    let c = Float(i) / 255
    s2l[i] = c <= 0.04045 ? c / 12.92 : powf((c + 0.055) / 1.055, 2.4)
}
let midPtr = UnsafeMutablePointer<Mid?>.allocate(capacity: 3)
let hybridPtr = UnsafeMutablePointer<Mid?>.allocate(capacity: 3)
midPtr.initialize(repeating: nil, count: 3)
hybridPtr.initialize(repeating: nil, count: 3)
defer {
    midPtr.deinitialize(count: 3); midPtr.deallocate()
    hybridPtr.deinitialize(count: 3); hybridPtr.deallocate()
}
func load(_ size: Int, _ fi: Int) -> Mid {
    let image = MeshImageIO.loadCGImageThumb(dir, "frame-\(fi).jpg", maxPx: size)!
    return Mid(rgba: MeshImageIO.rgbaBytes(image)!, w: image.width, h: image.height)
}
func prepare(_ sizes: (flat: Int, hybrid: Int)) {
    for fi in 0..<3 {
        midPtr[fi] = load(sizes.flat, fi)
        hybridPtr[fi] = load(sizes.hybrid, fi)
    }
}
__TONE_AT__

func point(_ x: Float, _ y: Float) -> SIMD3<Float> {
    SIMD3((x - 512) / 1024, -(y - 512) / 1024, -1)
}
let corners = [point(400.5, 460.5), point(400.5, 564.5), point(460.5, 512.5)]
let center = (corners[0] + corners[1] + corners[2]) / 3
func correction(_ p: SIMD3<Float>, hybrid: Bool) -> Float {
    let values = (0..<3).map { toneAt(p, $0, hybrid: hybrid)!.x }
    return max(-0.35, min(0.35, values.reduce(0, +) / 3 - values[0]))
}
func sparseCorrection(hybrid: Bool) -> Float {
    corners.map { correction($0, hybrid: hybrid) }.reduce(0, +) / 3
}

prepare(Bake.planeToneSizes(override: "512"))
let oldSparse = sparseCorrection(hybrid: true)
let oldCenter = correction(center, hybrid: true)
check(oldSparse > 0.08, "Fixture must reproduce bright-face injection at 512 px")
check(abs(oldCenter) < 0.02, "Actual face center must not need that brightening")
let flatBefore = toneAt(center, 0)!

prepare(defaults)
let newSparse = sparseCorrection(hybrid: true)
let newCenter = correction(center, hybrid: true)
print("Tone correction, sparse/center: 512", oldSparse, oldCenter, "; 64", newSparse, newCenter)
check(abs(newSparse) < 0.03 && abs(newSparse) < oldSparse * 0.20,
    "Broad wall tone must suppress at least 80 percent of the false brightening")
check(abs(newSparse - newCenter) < abs(oldSparse - oldCenter) * 0.35,
    "Tone correction must become substantially safer to interpolate sparsely")
check(simd_length(toneAt(center, 0)! - flatBefore) < 0.00001,
    "FLAT ceiling sampling must stay unchanged")

let left = point(204.5, 512.5), right = point(819.5, 512.5)
let broad64 = toneAt(right, 0, hybrid: true)!.x - toneAt(left, 0, hybrid: true)!.x
let broad512 = toneAt(right, 0)!.x - toneAt(left, 0)!.x
check(broad64 > 0.15 && abs(broad64 - broad512) < 0.015,
    "Broad illumination variation must survive wall-tone filtering")

// Detail decoding is deliberately independent of both tone thumbnail sizes.
let full = MeshImageIO.loadCGImage(dir, "frame-0.jpg")!
check(full.width == sourceSize && full.height == sourceSize, "Detail image must retain source resolution")
let fullBytes = MeshImageIO.rgbaBytes(full)!
let groove = s2l[Int(fullBytes[(512 * sourceSize + 400) * 4])]
let plank = s2l[Int(fullBytes[(512 * sourceSize + 420) * 4])]
check(plank - groove > 0.30, "Original narrow groove contrast must remain available to the detail bake")

print(String(format: "PASS: native sparse-tone error %.5f -> %.5f; broad illumination %.5f -> %.5f; full detail %d px",
    abs(oldSparse - oldCenter), abs(newSparse - newCenter), broad512, broad64, full.width))
print("PASS: separate HYBRID/FLAT defaults, A/B overrides, invalid overrides, unchanged ceiling tone and original detail")
'''


def main():
    program = (IMAGE_IO + "\n" + SWIFT
               .replace("__SIZES__", function_source("    static func planeToneSizes("))
               .replace("__TONE_AT__", function_source("        func toneAt(")))
    with tempfile.TemporaryDirectory(prefix="ampex-tone-bandwidth-") as folder:
        path = Path(folder) / "main.swift"
        path.write_text(program)
        subprocess.run(["swift", "-module-cache-path", folder + "/cache", str(path), folder], check=True)


if __name__ == "__main__":
    main()
