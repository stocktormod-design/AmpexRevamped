#!/usr/bin/env python3
"""Live-fusjonen i delkart mot bakens fusjon, på et ekte skann, på Mac (M1, §116).

Bruk: verify-scan-delkart.py <bundleDir> [utDir]

Kompilerer den EKTE `MeshDelkartFusjon` (+ MeshDelkart, MeshFuseKernel) med swiftc og mater
den med bundlens dybdekart i opptaksrekkefølge, med nøkkelbildene flettet inn etter tid, slik
presenteren gjør. Så bygges hvert delkart på nytt slik baken gjør det: `Blokkvolum.allokerFra`
over alle delkartets kart, deretter `ampex_integrate_sparse` per kart — begge trukket ut av
MeshTsdfBuild.swift, ikke skrevet av. Poser og tillit er like (rå ARKit-poser; bindingen og
driftrettingen er M2), så forskjellen er bare live-veiens inkrementelle allokering.

Påstander: alle bakens blokker med flate finnes live, og under 1 % av flatevoxlene
(|S| < én voxel og W ≥ minWeight i en av dem) skifter side mellom live og bake.
Skriver også `dekning-ferdig.bin` fra delkartene til utDir (til audit-scan-overlegg-sannhet).
"""
import os, json, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IOS = ROOT / 'modules/ampex-splat/ios'


def blokk(src, start, indent='    '):
    """Teksten fra linja som begynner med `start` til første linje med samme innrykk + '}'."""
    a = src.index(start)
    b = src.index('\n' + indent + '}\n', a) + len(indent) + 3
    return src[a:b]


tsdf = (IOS / 'MeshTsdfBuild.swift').read_text()
opts = blokk(tsdf, '    struct Options {')
blokkvol = blokk(tsdf, '    private final class Blokkvolum {').replace('private final class', 'final class', 1)
trust = blokk(tsdf, '    private static func trustForMotion(').replace('private static func', 'static func', 1)
felt = (IOS / 'CoverageField.swift').read_text()
okk = blokk(felt, '    struct Okklusjon {')

stubs = f'''
import Foundation
import Metal
import simd
import CoreVideo
extension SIMD4 where Scalar == Float {{ var xyz: SIMD3<Float> {{ SIMD3(x, y, z) }} }}
enum MeshLog {{ static func log(_ s: String) {{ print(s) }} }}
enum MeshBakeV2 {{ static func flaggTall(_ k: String, _ d: Float) -> Float {{ d }} }}
enum CoverageField {{
{okk}
}}
struct DFrame {{
    let w: Int, h: Int
    let fx: Float, fy: Float, cx: Float, cy: Float
    var c2w: simd_float4x4
    let url: URL
    func load() -> [Float]? {{
        guard let d = try? Data(contentsOf: url), d.count == w * h * 4 else {{ return nil }}
        return d.withUnsafeBytes {{ Array($0.bindMemory(to: Float.self)) }}
    }}
}}
enum MeshTsdfBuild {{
{opts}
{blokkvol}
{trust}
}}
'''

main = r'''
import Foundation
import Metal
import simd
import CoreVideo
setvbuf(stdout, nil, _IONBF, 0)
let args = CommandLine.arguments
let bundle = URL(fileURLWithPath: args[1])
let ut = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: ut, withIntermediateDirectories: true)
UserDefaults.standard.removeObject(forKey: "meshscan.tsdfminw")

struct Meta { let i: Int; let t: Double; let w: Int; let h: Int; let k: SIMD4<Float>; let m: simd_float4x4 }
var meta: [Meta] = []
for line in try! String(contentsOf: bundle.appendingPathComponent("dense.jsonl"), encoding: .utf8).split(separator: "\n") {
    guard let o = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
          let i = o["i"] as? Int, let w = o["w"] as? Int, let h = o["h"] as? Int, let t = o["t"] as? Double,
          let fx = o["fx"] as? Double, let fy = o["fy"] as? Double, let cx = o["cx"] as? Double, let cy = o["cy"] as? Double,
          let m = o["m"] as? [Double], m.count == 16 else { continue }
    let f = m.map { Float($0) }
    meta.append(Meta(i: i, t: t, w: w, h: h, k: SIMD4(Float(fx), Float(fy), Float(cx), Float(cy)),
                     m: simd_float4x4(columns: (SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]),
                                                SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15])))))
}
// Kart uten fil (f97d682a mangler 79 av 854) kan ikke mates live her. På telefonen får live
// ALLE kartene før noe skrives, så naboene der er de samme som i `loadDense`. Her filtreres
// lista før både live og referansetilliten, ellers ser de ulike naboer og fartsfilteret
// gir ulik tillit akkurat ved hullene.
let førFilter = meta.count
meta = meta.filter { FileManager.default.fileExists(atPath: bundle.appendingPathComponent("dense-\($0.i).f32").path) }
if meta.count < førFilter { print("dense.jsonl: \(førFilter) linjer, \(meta.count) med fil") }
// Nøkkelbildene etter tid (lukkeregelen teller dem).
var kfTider: [(t: Double, i: Int)] = []
if let d = try? Data(contentsOf: bundle.appendingPathComponent("frames.json")),
   let a = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] {
    for k in a { if let t = k["timestamp"] as? Double, let i = k["index"] as? Int { kfTider.append((t, i)) } }
}
kfTider.sort { $0.t < $1.t }
print("bundle: \(meta.count) dybdekart, \(kfTider.count) nøkkelbilder")

// Et grått kamerabilde (fargen er bare forhåndsvisning).
var pb: CVPixelBuffer?
CVPixelBufferCreate(nil, 256, 192, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                    [kCVPixelBufferMetalCompatibilityKey: true, kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pb)

// ── LIVE ────────────────────────────────────────────────────────────────────────────
let live = MeshDelkartFusjon(framesDir: ut)!
var kj = 0
let t0 = CFAbsoluteTimeGetCurrent()
for m in meta {
    while kj < kfTider.count && kfTider[kj].t <= m.t { live.nøkkelbilde(kfTider[kj].i); kj += 1 }
    guard let d = try? Data(contentsOf: bundle.appendingPathComponent("dense-\(m.i).f32")) else { continue }
    live.mottaDybde(i: m.i, t: m.t, depth: d, w: m.w, h: m.h, fx: m.k.x, fy: m.k.y, cx: m.k.z, cy: m.k.w, c2w: m.m, image: pb!)
}
live.avslutt()
print(String(format: "live: %.1f s på Mac", CFAbsoluteTimeGetCurrent() - t0))
live.dumpFerdig(til: ut.appendingPathComponent("dekning-ferdig.bin"))

// Tillit som loadDense: forrige og neste kart i hele lista.
var trust = [Float](repeating: 1, count: meta.count)
let opts = MeshTsdfBuild.Options()
for i in 1..<(meta.count - 1) {
    let p0 = meta[i - 1].m.columns.3.xyz, p1 = meta[i + 1].m.columns.3.xyz
    let f0 = -meta[i - 1].m.columns.2.xyz, f1 = -meta[i + 1].m.columns.2.xyz
    let dt = Float(max(0.08, min(2.0, meta[i + 1].t - meta[i - 1].t)))
    let lin = simd_distance(p0, p1) / dt
    let rot = acos(max(-1, min(1, simd_dot(simd_normalize(f0), simd_normalize(f1))))) / dt
    trust[i] = MeshTsdfBuild.trustForMotion(lin, rot, opts.maxVelocity)
}
var trustAv = [Int: Float](); for (n, m) in meta.enumerated() { trustAv[m.i] = trust[n] }
var metaAv = [Int: Meta](); for m in meta { metaAv[m.i] = m }

// ── BAKE, per delkart ───────────────────────────────────────────────────────────────
let dev = MTLCreateSystemDefaultDevice()!, q = dev.makeCommandQueue()!
let lib = try! dev.makeLibrary(source: MeshFuseKernel.msl, options: nil)
let pipe = try! dev.makeComputePipelineState(function: lib.makeFunction(name: "ampex_integrate_sparse")!)
let trunc = Delkart.vox * opts.truncVoxels, truncBehind = Delkart.vox * min(opts.truncBehindVoxels, opts.truncVoxels)
let sGrense = 1 / opts.truncVoxels
var flipTot = 0, flateTot = 0, manglerTot = 0, ekstraTot = 0, refBlokkTot = 0
var dirs = (try? FileManager.default.contentsOfDirectory(atPath: ut.appendingPathComponent("delkart").path)) ?? []
dirs.sort { Int($0)! < Int($1)! }
for dn in dirs {
    let dir = ut.appendingPathComponent("delkart/\(dn)")
    let kart = try! JSONDecoder().decode(DelkartKart.self, from: Data(contentsOf: dir.appendingPathComponent("kart.json")))
    let lo = SIMD3<Float>(kart.lo[0], kart.lo[1], kart.lo[2])
    let frames: [(DFrame, Float)] = kart.dybdekart.compactMap { i in
        guard let m = metaAv[i], let tr = trustAv[i], tr > 0 else { return nil }
        return (DFrame(w: m.w, h: m.h, fx: m.k.x, fy: m.k.y, cx: m.k.z, cy: m.k.w, c2w: m.m,
                       url: bundle.appendingPathComponent("dense-\(i).f32")), tr)
    }
    let vol = MeshTsdfBuild.Blokkvolum(lo: lo, vox: Delkart.vox, dim: SIMD3<Int>(truncatingIfNeeded: Delkart.dim))
    vol.allokerFra(frames.map(\.0), trunc: trunc, truncBehind: truncBehind)
    let plasser = vol.plasser
    var blokker = vol.koord.map { SIMD4<Int32>($0.x, $0.y, $0.z, 0) }
    let wd = dev.makeBuffer(length: plasser * 4, options: .storageModeShared)!
    let ww = dev.makeBuffer(length: plasser * 4, options: .storageModeShared)!
    memset(wd.contents(), 0, plasser * 4); memset(ww.contents(), 0, plasser * 4)
    let bb = dev.makeBuffer(bytes: &blokker, length: blokker.count * 16, options: .storageModeShared)!
    for (f, tr) in frames {
        guard let dep = f.load() else { continue }
        let db = dev.makeBuffer(bytes: dep, length: dep.count * 4, options: .storageModeShared)!
        var P = MeshFuseKernel.Params(w2c: f.c2w.inverse, lo: lo, voxel: Delkart.vox, dims: Delkart.dim, trunc: trunc,
                                      truncBehind: truncBehind, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy,
                                      dw: Int32(f.w), dh: Int32(f.h), wf0: tr, edgeRadius: Int32(opts.edgeRadius),
                                      jbuScale: 1, p0: -1, p1: 0)
        let cb = q.makeCommandBuffer()!, e = cb.makeComputeCommandEncoder()!
        e.setComputePipelineState(pipe)
        e.setBuffer(wd, offset: 0, index: 0); e.setBuffer(ww, offset: 0, index: 1); e.setBuffer(db, offset: 0, index: 2)
        e.setBytes(&P, length: MemoryLayout<MeshFuseKernel.Params>.stride, index: 3); e.setBuffer(bb, offset: 0, index: 4)
        e.dispatchThreads(MTLSize(width: plasser, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
        e.endEncoding(); cb.commit(); cb.waitUntilCompleted()
    }
    // Live fra disk.
    let raw = try! Data(contentsOf: dir.appendingPathComponent("blokker.bin"))
    let n = Int(raw.withUnsafeBytes { $0.load(fromByteOffset: 4, as: Int32.self) })
    var liveIndeks = [SIMD3<Int32>: Int]()
    raw.withUnsafeBytes { r in
        for b in 0..<n {
            let k = r.loadUnaligned(fromByteOffset: 8 + b * 16, as: SIMD4<Int32>.self)
            liveIndeks[SIMD3(k.x, k.y, k.z)] = b
        }
    }
    func floats(_ off: Int) -> [Float] {
        raw.withUnsafeBytes { (r: UnsafeRawBufferPointer) -> [Float] in
            let p: UnsafePointer<Float> = (r.baseAddress! + off).assumingMemoryBound(to: Float.self)
            return Array(UnsafeBufferPointer(start: p, count: n * 512))
        }
    }
    let lwd = floats(8 + n * 16), lw = floats(8 + n * 16 + n * 2048)
    let rwd = wd.contents().assumingMemoryBound(to: Float.self), rw = ww.contents().assumingMemoryBound(to: Float.self)
    func flate(_ wdv: Float, _ wv: Float) -> Bool { wv >= opts.minWeight && abs(wdv / wv) < sGrense }
    var flip = 0, flateN = 0, mangler = 0, maksDW: Float = 0
    var refBlokker = Set<SIMD3<Int32>>()
    for (bi, k) in vol.koord.enumerated() {
        refBlokker.insert(k)
        let li = liveIndeks[k]
        var harFlate = false
        for l in 0..<512 {
            let s = bi * 512 + l
            let rf = flate(rwd[s], rw[s])
            var lf = false
            if let li { let t = li * 512 + l; lf = lw[t] > 0 && flate(lwd[t], lw[t]); maksDW = max(maksDW, abs(lw[t] - rw[s])) }
            if rf || lf { flateN += 1 }
            if rf != lf { flip += 1 }
            if rf { harFlate = true }
        }
        if li == nil && harFlate { mangler += 1 }
    }
    let ekstra = liveIndeks.keys.filter { !refBlokker.contains($0) }.count
    print(String(format: "delkart %@: %d kart, bake %d blokker, live %d (%d ekstra, %d med flate mangler live); flatevoxler %d, skiftet %d (%.3f %%), maks |ΔW| %.3f",
                 dn, frames.count, vol.antall, n, ekstra, mangler, flateN, flip, 100 * Double(flip) / Double(max(flateN, 1)), maksDW))
    flipTot += flip; flateTot += flateN; manglerTot += mangler; ekstraTot += ekstra; refBlokkTot += vol.antall
}
let andel = 100 * Double(flipTot) / Double(max(flateTot, 1))
print(String(format: "SUM: %d delkart, flatevoxler %d, skiftet %.3f %%, %d bakeblokker med flate mangler live", dirs.count, flateTot, andel, manglerTot))
precondition(!dirs.isEmpty, "ingen delkart skrevet")
precondition(manglerTot == 0, "live mangler blokker med flate")
precondition(andel < 1.0, "over 1 % av flatevoxlene skifter side — live og bake måler ulikt")
print("ok")
'''

with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    (d / 'stubs.swift').write_text(stubs)
    (d / 'main.swift').write_text(main)
    srcs = [IOS / 'MeshFuseKernel.swift', IOS / 'MeshDelkart.swift', IOS / 'MeshDelkartFusjon.swift', d / 'stubs.swift', d / 'main.swift']
    subprocess.run(['swiftc', '-Onone' if os.environ.get('AMPEX_ONONE') else '-O', '-module-cache-path', str(d / 'cache'), *map(str, srcs), '-o', str(d / 'verify')], check=True)
    ut = sys.argv[2] if len(sys.argv) > 2 else str(d / 'ut')
    subprocess.run([str(d / 'verify'), sys.argv[1], ut], check=True)
