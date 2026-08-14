import Foundation
import simd

/// Zhou-Koltun (SIGGRAPH 2014) RIGID fargekart-optimalisering, minimal CPU-port:
/// ARKit-poser drifter på cm-nivå, så selv perfekte keyframes prosjiserer SMURT.
/// Vi holder geometrien fast, gir hver mesh-verteks en proxy-gråtone (snitt over
/// synlige frames), og Gauss-Newton-justerer hver keyframes 6-DoF-pose så dens
/// bilde stemmer med proxyen. Alternering proxy ↔ poser konvergerer på få runder.
/// Kjøres FØR vinner-valg/bake — angriper årsaken til uskarphet, ikke symptomet.
/// (Referanse: Open3D pipelines::color_map, MIT. Ikke-rigid warp er bevisst utelatt
/// i første versjon — mål effekten på fixture før mer kompleksitet.)
@available(iOS 14.0, *)
enum MeshPoseRefineV2 {

    private struct Frame {
        var w2c: simd_float4x4
        var camPos: SIMD3<Float>
        var fx: Float, fy: Float, cx: Float, cy: Float   // skalert til luma-oppløsningen
        var luma: [Float]                                 // 0..1, tett lw×lh
        var lw: Int, lh: Int
        var depth: [Float]; var dw: Int; var dh: Int      // LiDAR-dybde for synlighetstest
    }

    /// Justerer keyframes[i].transform (camera-to-world) in place. Returnerer (før, etter)
    /// gjennomsnittlig fotometrisk residual — logges så fixture-A/B har et tall.
    @discardableResult
    static func refine(
        keyframes: inout [MeshScanPresenter.Keyframe],
        positions: [Float], normals: [Float],
        framesDir: URL,
        iterations: Int = 8,
        maxVertices: Int = 50_000
    ) -> (before: Float, after: Float) {
        let vCountAll = positions.count / 3
        guard vCountAll > 100, !keyframes.isEmpty else { return (0, 0) }
        let t0 = CFAbsoluteTimeGetCurrent()

        // ── Verteks-subsett (jevnt stride — proxyen trenger dekning, ikke tetthet)
        let stride = max(1, vCountAll / maxVertices)
        var verts: [SIMD3<Float>] = []
        var vnorms: [SIMD3<Float>] = []
        verts.reserveCapacity(vCountAll / stride + 1)
        var vi = 0
        while vi < vCountAll {
            verts.append(SIMD3(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]))
            vnorms.append(SIMD3(normals[vi * 3], normals[vi * 3 + 1], normals[vi * 3 + 2]))
            vi += stride
        }
        let nV = verts.count

        // ── Luma-cache (480px thumbs ≈ 0,5 MB/frame — hele settet får plass i RAM)
        func mat(_ a: [Float]) -> simd_float4x4 {
            simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                    SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
        }
        var frames: [Frame] = []
        frames.reserveCapacity(keyframes.count)
        var frameKF: [Int] = [] // frames[i] ↔ keyframes[frameKF[i]]
        for (ki, k) in keyframes.enumerated() {
            guard let cg = MeshImageIO.loadCGImageThumb(framesDir, k.file, maxPx: 480),
                  let rgba = MeshImageIO.rgbaBytes(cg) else { continue }
            let lw = cg.width, lh = cg.height
            var luma = [Float](repeating: 0, count: lw * lh)
            for p in 0..<(lw * lh) {
                luma[p] = (0.299 * Float(rgba[p * 4]) + 0.587 * Float(rgba[p * 4 + 1]) + 0.114 * Float(rgba[p * 4 + 2])) / 255
            }
            var depth: [Float] = []; var dw = 0; var dh = 0
            if let df = k.depthFile, let dd = try? Data(contentsOf: framesDir.appendingPathComponent(df)),
               dd.count == k.depthWidth * k.depthHeight * 4 {
                depth = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
                dw = k.depthWidth; dh = k.depthHeight
            }
            let sx = Float(lw) / Float(k.width), sy = Float(lh) / Float(k.height)
            frames.append(Frame(
                w2c: simd_inverse(mat(k.transform)),
                camPos: SIMD3(k.transform[12], k.transform[13], k.transform[14]),
                fx: k.intrinsics[0] * sx, fy: k.intrinsics[1] * sy,
                cx: k.intrinsics[2] * sx, cy: k.intrinsics[3] * sy,
                luma: luma, lw: lw, lh: lh, depth: depth, dw: dw, dh: dh))
            frameKF.append(ki)
        }
        guard frames.count >= 3 else { return (0, 0) }

        // Bilineær luma + gradient (piksel-enheter i luma-oppløsning)
        func sample(_ f: Frame, _ u: Float, _ v: Float) -> (val: Float, gx: Float, gy: Float)? {
            if u < 1.5 || v < 1.5 || u > Float(f.lw) - 2.5 || v > Float(f.lh) - 2.5 { return nil }
            let x0 = Int(u), y0 = Int(v)
            let fx = u - Float(x0), fy = v - Float(y0)
            let i00 = y0 * f.lw + x0
            let v00 = f.luma[i00], v10 = f.luma[i00 + 1]
            let v01 = f.luma[i00 + f.lw], v11 = f.luma[i00 + f.lw + 1]
            let val = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
            // sentraldifferanse på nærmeste piksel — nøyaktig nok for GN-retningen
            let xc = min(max(x0, 1), f.lw - 2), yc = min(max(y0, 1), f.lh - 2)
            let gx = (f.luma[yc * f.lw + xc + 1] - f.luma[yc * f.lw + xc - 1]) * 0.5
            let gy = (f.luma[(yc + 1) * f.lw + xc] - f.luma[(yc - 1) * f.lw + xc]) * 0.5
            return (val, gx, gy)
        }

        // Prosjeksjon + synlighet: foran kamera, innenfor bildet, flate vendt mot kamera,
        // og dybdetest ±30 cm (samme konvensjon som baken: ARKit ser -z, bilde-y ned).
        func project(_ f: Frame, _ p: SIMD3<Float>, _ n: SIMD3<Float>) -> (u: Float, v: Float, pc: SIMD3<Float>)? {
            let pc4 = f.w2c * SIMD4(p, 1)
            if pc4.z > -0.1 { return nil }
            let zbar = -pc4.z
            let u = f.fx * (pc4.x / zbar) + f.cx
            let v = f.fy * (-pc4.y / zbar) + f.cy
            if u < 2 || v < 2 || u > Float(f.lw) - 3 || v > Float(f.lh) - 3 { return nil }
            let viewDir = simd_normalize(f.camPos - p)
            if simd_dot(n, viewDir) < 0.25 { return nil }
            if f.dw > 0 {
                let dx = min(f.dw - 1, max(0, Int(u / Float(f.lw) * Float(f.dw))))
                let dy = min(f.dh - 1, max(0, Int(v / Float(f.lh) * Float(f.dh))))
                let sceneZ = f.depth[dy * f.dw + dx]
                if sceneZ > 0.25 && abs(zbar - sceneZ) > 0.30 { return nil }
            }
            return (u, v, SIMD3(pc4.x, pc4.y, pc4.z))
        }

        // 6×6-løser (Gauss-eliminasjon m/ partial pivot)
        func solve6(_ A0: [Float], _ b0: [Float]) -> [Float]? {
            var A = A0, b = b0
            for col in 0..<6 {
                var pivot = col
                for r in (col + 1)..<6 where abs(A[r * 6 + col]) > abs(A[pivot * 6 + col]) { pivot = r }
                if abs(A[pivot * 6 + col]) < 1e-10 { return nil }
                if pivot != col {
                    for c in 0..<6 { A.swapAt(col * 6 + c, pivot * 6 + c) }
                    b.swapAt(col, pivot)
                }
                let inv = 1 / A[col * 6 + col]
                for r in (col + 1)..<6 {
                    let f = A[r * 6 + col] * inv
                    if f == 0 { continue }
                    for c in col..<6 { A[r * 6 + c] -= f * A[col * 6 + c] }
                    b[r] -= f * b[col]
                }
            }
            var x = [Float](repeating: 0, count: 6)
            for r in (0..<6).reversed() {
                var s = b[r]
                for c in (r + 1)..<6 { s -= A[r * 6 + c] * x[c] }
                x[r] = s / A[r * 6 + r]
            }
            return x
        }

        func rodrigues(_ w: SIMD3<Float>) -> simd_float3x3 {
            let th = simd_length(w)
            if th < 1e-8 { return matrix_identity_float3x3 }
            let k = w / th
            let K = simd_float3x3(SIMD3(0, k.z, -k.y), SIMD3(-k.z, 0, k.x), SIMD3(k.y, -k.x, 0)) // kolonne-major
            return matrix_identity_float3x3 + sin(th) * K + (1 - cos(th)) * (K * K)
        }

        // ── Alternering: proxy-oppdatering (alle frames) ↔ per-frame GN-steg
        var proxy = [Float](repeating: 0, count: nV)
        var meanResBefore: Float = -1
        var meanResAfter: Float = 0
        // Sikkerhetsnett: refineren skal ALDRI kunne gjøre det verre enn ARKit-posene.
        // Residualen logget i iterasjon i måler posene ETTER steg i-1 — ta vare på beste sett.
        var bestRes: Float = .greatestFiniteMagnitude
        var bestW2C = frames.map(\.w2c)
        for iter in 0..<iterations {
            // Pass A: proxy = facing-vektet snitt av lumaverdiene som ser verteksen
            var sum = [Float](repeating: 0, count: nV)
            var wsum = [Float](repeating: 0, count: nV)
            for f in frames {
                for i in 0..<nV {
                    guard let pr = project(f, verts[i], vnorms[i]),
                          let s = sample(f, pr.u, pr.v) else { continue }
                    let w = simd_dot(vnorms[i], simd_normalize(f.camPos - verts[i]))
                    sum[i] += s.val * w
                    wsum[i] += w
                }
            }
            var resSum: Float = 0; var resN = 0
            for i in 0..<nV where wsum[i] > 1e-4 { proxy[i] = sum[i] / wsum[i] }

            // Pass B: GN-steg per frame mot proxyen (parallelt — frames er uavhengige)
            let framesCopy = frames
            var newW2C = framesCopy.map(\.w2c)
            var frameRes = [Float](repeating: 0, count: framesCopy.count)
            var frameResN = [Int](repeating: 0, count: framesCopy.count)
            newW2C.withUnsafeMutableBufferPointer { W in
                frameRes.withUnsafeMutableBufferPointer { FR in
                    frameResN.withUnsafeMutableBufferPointer { FN in
                        DispatchQueue.concurrentPerform(iterations: framesCopy.count) { fi in
                            let f = framesCopy[fi]
                            var H = [Float](repeating: 0, count: 36)
                            var b = [Float](repeating: 0, count: 6)
                            var rSum: Float = 0; var rN = 0
                            for i in 0..<nV where wsum[i] > 1e-4 {
                                guard let pr = project(f, verts[i], vnorms[i]),
                                      let s = sample(f, pr.u, pr.v) else { continue }
                                let r = s.val - proxy[i]
                                rSum += abs(r); rN += 1
                                if abs(r) > 0.30 { continue } // okklusjonsskift/speil — ute av GN
                                // Jacobi: ∇I · ∂(u,v)/∂pc · ∂pc/∂ξ, venstre-perturbasjon exp(ξ)·w2c
                                let pc = pr.pc
                                let zbar = -pc.z
                                let iz = 1 / zbar
                                // du/dpc, dv/dpc (u = fx·x/z̄+cx, v = fy·(−y)/z̄+cy, z̄ = −z)
                                let du = SIMD3<Float>(f.fx * iz, 0, f.fx * pc.x * iz * iz)
                                let dv = SIMD3<Float>(0, -f.fy * iz, -f.fy * pc.y * iz * iz)
                                let gpc = s.gx * du + s.gy * dv   // ∂I/∂pc (1×3)
                                // ∂pc/∂ξ = [ -[pc]× | I ]; gpcᵀ·(-[pc]×) = (pc × gpc)ᵀ.
                                // NB fortegnet HER var flippet i første device-kjøring (residual
                                // STEG 0.039→0.046) — pc × gpc, ikke gpc × pc.
                                var J = [Float](repeating: 0, count: 6)
                                J[0] = pc.y * gpc.z - pc.z * gpc.y   // (pc × gpc) — rotasjon
                                J[1] = pc.z * gpc.x - pc.x * gpc.z
                                J[2] = pc.x * gpc.y - pc.y * gpc.x
                                J[3] = gpc.x; J[4] = gpc.y; J[5] = gpc.z
                                for a in 0..<6 {
                                    b[a] += J[a] * r
                                    for c in a..<6 { H[a * 6 + c] += J[a] * J[c] }
                                }
                            }
                            FR[fi] = rSum; FN[fi] = rN
                            guard rN > 200 else { return }
                            for a in 0..<6 { for c in 0..<a { H[a * 6 + c] = H[c * 6 + a] } } // symmetriser
                            var trace: Float = 0
                            for a in 0..<6 { trace += H[a * 6 + a] }
                            let lambda = max(trace / 6 * 1e-3, 1e-6)
                            for a in 0..<6 { H[a * 6 + a] += lambda }
                            guard var d = solve6(H, b) else { return }
                            for a in 0..<6 { d[a] = -d[a] } // GN: δ = −H⁻¹b
                            // Trinnklemme: drift er cm-nivå — store hopp er alltid outlier-drevet
                            var w = SIMD3(d[0], d[1], d[2]); var t = SIMD3(d[3], d[4], d[5])
                            let wl = simd_length(w), tl = simd_length(t)
                            if wl > 0.02 { w *= 0.02 / wl }
                            if tl > 0.03 { t *= 0.03 / tl }
                            let R = rodrigues(w)
                            let old = f.w2c
                            let oldR = simd_float3x3(SIMD3(old.columns.0.x, old.columns.0.y, old.columns.0.z),
                                                     SIMD3(old.columns.1.x, old.columns.1.y, old.columns.1.z),
                                                     SIMD3(old.columns.2.x, old.columns.2.y, old.columns.2.z))
                            let oldT = SIMD3(old.columns.3.x, old.columns.3.y, old.columns.3.z)
                            let nR = R * oldR
                            let nT = R * oldT + t
                            W[fi] = simd_float4x4(columns: (
                                SIMD4(nR.columns.0, 0), SIMD4(nR.columns.1, 0), SIMD4(nR.columns.2, 0), SIMD4(nT, 1)))
                        }
                    }
                }
            }
            for fi in 0..<frames.count {
                frames[fi].w2c = newW2C[fi]
                let c2w = simd_inverse(newW2C[fi])
                frames[fi].camPos = SIMD3(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z)
                resSum += frameRes[fi]; resN += frameResN[fi]
            }
            let meanRes = resN > 0 ? resSum / Float(resN) : 0
            if iter == 0 { meanResBefore = meanRes }
            meanResAfter = meanRes
            // Residualen gjelder posene FØR dette stegets oppdatering — snapshotet som ga den
            // er forrige iterasjons resultat (framesCopy), ikke det nye.
            if meanRes < bestRes { bestRes = meanRes; bestW2C = framesCopy.map(\.w2c) }
            MeshLog.log("poseRefine iter \(iter + 1)/\(iterations) — snittresidual \(String(format: "%.4f", meanRes)) (\(resN) samples)")
        }
        if meanResAfter > bestRes {
            MeshLog.log("poseRefine — siste residual \(String(format: "%.4f", meanResAfter)) > beste \(String(format: "%.4f", bestRes)), ruller tilbake til beste poser")
            for fi in 0..<frames.count { frames[fi].w2c = bestW2C[fi] }
            meanResAfter = bestRes
        }

        // ── Skriv raffinerte c2w-poser tilbake i keyframes
        for (fi, ki) in frameKF.enumerated() {
            let c2w = simd_inverse(frames[fi].w2c)
            keyframes[ki].transform = [
                c2w.columns.0.x, c2w.columns.0.y, c2w.columns.0.z, c2w.columns.0.w,
                c2w.columns.1.x, c2w.columns.1.y, c2w.columns.1.z, c2w.columns.1.w,
                c2w.columns.2.x, c2w.columns.2.y, c2w.columns.2.z, c2w.columns.2.w,
                c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z, c2w.columns.3.w,
            ]
        }
        MeshLog.log("poseRefine ferdig — residual \(String(format: "%.4f", meanResBefore)) → \(String(format: "%.4f", meanResAfter)), \(frames.count) frames, \(nV) verts, \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms")
        return (meanResBefore, meanResAfter)
    }
}
