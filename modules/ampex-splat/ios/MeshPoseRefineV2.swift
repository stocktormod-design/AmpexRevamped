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

    // Warp-rutenettets dimensjoner — delt med baken (blend=all sampler gjennom samme rutenett).
    // 8×5: aggressivt finere (12×8, løsere λ) SENKET residualen men REV opp blanke vegger —
    // teksturløse flater har ikke gradient å justere mot, så løsere regularisering lot punktene
    // drive og rive. Residual er IKKE en trygg proxy for utseende (device 2026-08-25).
    // 12×8 er trygt FORDI reguleringen nå er adaptiv (se warpLambda i refine). Uten den
    // rev dette opp blanke vegger — kommentaren over gjaldt fast λ.
    static let warpGridW = 12, warpGridH = 8

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
        maxVertices: Int = 50_000,
        forceWarp: Bool = false,
        // Ut: normaliserte warp-rutenett per keyframe (warpGridW*warpGridH SIMD2, offset i
        // [0,1]-bilderom). Tom for keyframes uten warp. Baken (blend=all) sampler gjennom dem.
        warpGridsByKF: inout [[SIMD2<Float>]]
    ) -> (before: Float, after: Float) {
        warpGridsByKF = [[SIMD2<Float>]](repeating: [], count: keyframes.count)
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

        // ── Luma-cache.
        //
        // OPPLØSNINGEN ER WARPENS SYNSGRENSE (2026-09-01). 480 px var valgt for minne, men
        // originalene er 3840: en misalignment på to piksler i full oppløsning er en KVART
        // piksel her, altså under det gradientene kan måle. Warpen kunne dermed ikke se
        // feilen den er satt til å rette — og det er grunnen til at hverken finere
        // warp-rutenett, adaptiv regularisering eller flere iterasjoner ga synlig utslag.
        //
        // 960 px koster ~2 MB/frame i Float, altså ~290 MB for 139 frames. Det får plass
        // fordi TSDF-volumet er frigjort før dette punktet (VoxelStore deinit etter surface
        // nets). Blir det trangt på svakere enheter, er neste steg å lagre luma som UInt8 og
        // konvertere i `sample` — det firedobler kapasiteten uten å tape presisjon som betyr
        // noe, siden kilden er 8-bits. meshscan.warppx overstyrer.
        let lumaMaxPx = Int(UserDefaults.standard.string(forKey: "meshscan.warppx") ?? "") ?? 960
        func mat(_ a: [Float]) -> simd_float4x4 {
            simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                    SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
        }
        var frames: [Frame] = []
        frames.reserveCapacity(keyframes.count)
        var frameKF: [Int] = [] // frames[i] ↔ keyframes[frameKF[i]]
        for (ki, k) in keyframes.enumerated() {
            guard let cg = MeshImageIO.loadCGImageThumb(framesDir, k.file, maxPx: lumaMaxPx),
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

        // ── Ikke-rigid warp (Zhou-Koltun andre halvdel): grovt kontrollrutenett i bilderom
        // per frame, 2D-forskyvning per punkt. Jacobi er ENKLERE enn den rigide (∇I·bilineær-
        // vekt, ingen rotasjon). Se docs/SUBPIXEL_ALIGN_PLAN.md. warpGW×warpGH — start grovt.
        let warpGW = warpGridW, warpGH = warpGridH
        let warpN = 2 * warpGW * warpGH
        // De 4 omkringliggende kontrollpunktene + bilineære vekter for en piksel (u,v).
        func warpCell(_ lw: Int, _ lh: Int, _ u: Float, _ v: Float)
            -> (idx: (Int, Int, Int, Int), w: (Float, Float, Float, Float)) {
            let gxf = u / Float(max(lw - 1, 1)) * Float(warpGW - 1)
            let gyf = v / Float(max(lh - 1, 1)) * Float(warpGH - 1)
            let cx = min(max(Int(gxf), 0), warpGW - 2)
            let cy = min(max(Int(gyf), 0), warpGH - 2)
            let tx = min(max(gxf - Float(cx), 0), 1), ty = min(max(gyf - Float(cy), 0), 1)
            let a = cy * warpGW + cx, b = a + 1, c = a + warpGW, d = c + 1
            return ((a, b, c, d), ((1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty))
        }
        func warpOffset(_ grid: [SIMD2<Float>], _ lw: Int, _ lh: Int, _ u: Float, _ v: Float) -> SIMD2<Float> {
            let (idx, w) = warpCell(lw, lh, u, v)
            return grid[idx.0] * w.0 + grid[idx.1] * w.1 + grid[idx.2] * w.2 + grid[idx.3] * w.3
        }
        // Generell n×n-løser (samme Gauss-eliminasjon m/ partial pivot som solve6).
        func solveN(_ A0: [Float], _ b0: [Float], _ n: Int) -> [Float]? {
            var A = A0, b = b0
            for col in 0..<n {
                var pivot = col
                for r in (col + 1)..<n where abs(A[r * n + col]) > abs(A[pivot * n + col]) { pivot = r }
                if abs(A[pivot * n + col]) < 1e-12 { return nil }
                if pivot != col {
                    for c in 0..<n { A.swapAt(col * n + c, pivot * n + c) }
                    b.swapAt(col, pivot)
                }
                let inv = 1 / A[col * n + col]
                for r in (col + 1)..<n {
                    let f = A[r * n + col] * inv
                    if f == 0 { continue }
                    for c in col..<n { A[r * n + c] -= f * A[col * n + c] }
                    b[r] -= f * b[col]
                }
            }
            var x = [Float](repeating: 0, count: n)
            for r in (0..<n).reversed() {
                var s = b[r]
                for c in (r + 1)..<n { s -= A[r * n + c] * x[c] }
                x[r] = s / A[r * n + r]
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

        // ── Ikke-rigid warp-stadium (OPT-IN: meshscan.warp = "on"). DEL 1 — MÅLER om det
        // finnes justerbar restforvrengning under det rigide gulvet (~0,044). Warpen
        // persisteres IKKE ennå: baken sampler fortsatt via pose alene, så «on» endrer
        // LOGGET residual, ikke bildet. Bildeendringen er del 2 (warp-bevisst sampler +
        // fixture v4 + blande-vei). Se docs/SUBPIXEL_ALIGN_PLAN.md.
        // Går/faller på at residualen SYNKER monotont — samme fortegns-validering som den
        // rigide (der fortegnet var flippet og residualen STEG). Synker den ikke, er warpen
        // eller Jacobi-fortegnet galt; da lyver ikke tallet.
        // OPT-IN: meshscan.warp = "on" (koster 6 ekstra iterasjoner per bake — regel 10, så
        // ikke på som standard). Validert på device 2026-08-25: residualen synker MONOTONT
        // under det rigide gulvet (0,0417→0,0399 og 0,0356→0,0341), altså rett Jacobi-fortegn.
        if (forceWarp || UserDefaults.standard.string(forKey: "meshscan.warp") == "on") && frames.count >= 3 {
            let zeroGrid = [SIMD2<Float>](repeating: .zero, count: warpGW * warpGH)
            var warps = [[SIMD2<Float>]](repeating: zeroGrid, count: frames.count)
            // Regularisering holder kontrollpunkter i tekstur-fattige felt (blank vegg) fra å
            // drive fritt og rive warpen. For lav = wobble/riving; for høy = kollapser til
            // rigid. Startverdi — TUNE på fixture (docs, felle #3).
            // ADAPTIV regularisering (2026-09-01). Den gamle faste λ måtte settes etter det
            // VERSTE tilfellet — blank vegg — og var dermed for stiv over alt som faktisk har
            // struktur. Derfor senket 12×8 residualen, men rev opp veggene: rutenettet ble
            // finere overalt, også der det ikke fantes gradient å styre etter.
            // Nå er λ per kontrollpunkt: fri der bildet har struktur, låst der det er blankt.
            // Det er det som gjør et finere rutenett trygt.
            let warpLambda: Float = 0.012    // gulv, brukes der det ER struktur
            let warpLambdaMax: Float = 0.10  // tak, brukes over teksturløse flater
            // Steget er i PIKSLER, så det må skaleres med luma-oppløsningen: 2.0 var satt
            // for 480 px, og da bildene ble doblet til 960 halverte den samme konstanten
            // effektivt hvor langt warpen får flytte seg per iterasjon (forbedringen falt
            // 8,0 % → 5,5 %). Grensen på 4.0 som «rev blanke vegger» gjaldt 480 px med FAST
            // regularisering — begge deler er endret siden.
            let warpStepClamp: Float = 2.0 * Float(lumaMaxPx) / 480
            var warpResBefore: Float = -1, warpResAfter: Float = 0
            let warpIters = 8
            for witer in 0..<warpIters {
                // Pass A: proxy fra WARPEDE samples (facing-vektet snitt) — ellers måles warpen
                // mot en proxy den selv ikke har vært med å forme.
                var sum = [Float](repeating: 0, count: nV)
                var wsum = [Float](repeating: 0, count: nV)
                for (fi, f) in frames.enumerated() {
                    let grid = warps[fi]
                    for i in 0..<nV {
                        guard let pr = project(f, verts[i], vnorms[i]) else { continue }
                        let off = warpOffset(grid, f.lw, f.lh, pr.u, pr.v)
                        guard let s = sample(f, pr.u + off.x, pr.v + off.y) else { continue }
                        let w = simd_dot(vnorms[i], simd_normalize(f.camPos - verts[i]))
                        sum[i] += s.val * w; wsum[i] += w
                    }
                }
                var proxyW = [Float](repeating: 0, count: nV)
                for i in 0..<nV where wsum[i] > 1e-4 { proxyW[i] = sum[i] / wsum[i] }

                // Pass B: per-frame GN på warp-rutenettet (parallelt — frames uavhengige)
                let framesCopy = frames
                let warpsCopy = warps
                var newWarps = warps
                var fRes = [Float](repeating: 0, count: frames.count)
                var fResN = [Int](repeating: 0, count: frames.count)
                newWarps.withUnsafeMutableBufferPointer { NW in
                    fRes.withUnsafeMutableBufferPointer { FR in
                        fResN.withUnsafeMutableBufferPointer { FN in
                            DispatchQueue.concurrentPerform(iterations: framesCopy.count) { fi in
                                let f = framesCopy[fi]
                                let grid = warpsCopy[fi]
                                var H = [Float](repeating: 0, count: warpN * warpN)
                                var b = [Float](repeating: 0, count: warpN)
                                // Bildestruktur under hvert kontrollpunkt. Et punkt over blank
                                // vegg har ingen gradient å styre etter og MÅ holdes fast;
                                // et punkt over en vinduskarm kan flytte seg fritt. Uten dette
                                // skillet må reguleringen settes etter det verste tilfellet,
                                // og da blir warpen for stiv til å rette opp smøringen.
                                var gradE = [Float](repeating: 0, count: warpGW * warpGH)
                                var rSum: Float = 0; var rN = 0
                                for i in 0..<nV where wsum[i] > 1e-4 {
                                    guard let pr = project(f, verts[i], vnorms[i]) else { continue }
                                    let (idx, wgt) = warpCell(f.lw, f.lh, pr.u, pr.v)
                                    let off = grid[idx.0] * wgt.0 + grid[idx.1] * wgt.1 + grid[idx.2] * wgt.2 + grid[idx.3] * wgt.3
                                    guard let s = sample(f, pr.u + off.x, pr.v + off.y) else { continue }
                                    let r = s.val - proxyW[i]
                                    rSum += abs(r); rN += 1
                                    if abs(r) > 0.30 { continue } // okklusjonsskift/speil — ute av GN
                                    // 4 kontrollpunkt × {x,y}: ∂I/∂cp.x = gx·w, ∂I/∂cp.y = gy·w.
                                    let cpArr = [idx.0, idx.1, idx.2, idx.3]
                                    let wArr = [wgt.0, wgt.1, wgt.2, wgt.3]
                                    var cols = [Int](repeating: 0, count: 8)
                                    var jv = [Float](repeating: 0, count: 8)
                                    let gmag = s.gx * s.gx + s.gy * s.gy
                                    for k in 0..<4 {
                                        cols[k * 2] = cpArr[k] * 2;     jv[k * 2] = s.gx * wArr[k]
                                        cols[k * 2 + 1] = cpArr[k] * 2 + 1; jv[k * 2 + 1] = s.gy * wArr[k]
                                        gradE[cpArr[k]] += gmag * wArr[k]
                                    }
                                    for a in 0..<8 {
                                        b[cols[a]] += jv[a] * r
                                        for c in 0..<8 { H[cols[a] * warpN + cols[c]] += jv[a] * jv[c] }
                                    }
                                }
                                FR[fi] = rSum; FN[fi] = rN
                                guard rN > 200 else { return }
                                // Glatthetsregularisering: naborutenett (horisontal + vertikal).
                                // Median-normalisert struktur: punkter under snittet strammes
                                // opp mot warpLambdaMax, punkter over slippes mot warpLambda.
                                var gs = gradE.filter { $0 > 0 }.sorted()
                                let gMed = gs.isEmpty ? 1 : max(gs[gs.count / 2], 1e-8)
                                func lamAt(_ k: Int) -> Float {
                                    let rel = gradE[k] / gMed
                                    // rel ≥ 1 (mye struktur) → warpLambda; rel → 0 (blankt) → maks.
                                    let t = min(1, rel)
                                    return warpLambdaMax + (warpLambda - warpLambdaMax) * t
                                }
                                func reg(_ k: Int, _ m: Int) {
                                    // Paret bindes av den STIVESTE av de to: en fri nabo skal
                                    // ikke kunne dra et låst punkt over blank vegg med seg.
                                    let lamR = max(lamAt(k), lamAt(m))
                                    for comp in 0..<2 {
                                        let ci = k * 2 + comp, cj = m * 2 + comp
                                        H[ci * warpN + ci] += lamR; H[cj * warpN + cj] += lamR
                                        H[ci * warpN + cj] -= lamR; H[cj * warpN + ci] -= lamR
                                        let diff = grid[k][comp] - grid[m][comp]
                                        b[ci] += lamR * diff; b[cj] -= lamR * diff
                                    }
                                }
                                for gy in 0..<warpGH {
                                    for gx in 0..<warpGW {
                                        let k = gy * warpGW + gx
                                        if gx + 1 < warpGW { reg(k, k + 1) }
                                        if gy + 1 < warpGH { reg(k, k + warpGW) }
                                    }
                                }
                                // Levenberg-demping (samme som den rigide)
                                var trace: Float = 0
                                for a in 0..<warpN { trace += H[a * warpN + a] }
                                let lam = max(trace / Float(warpN) * 1e-3, 1e-6)
                                for a in 0..<warpN { H[a * warpN + a] += lam }
                                guard var d = solveN(H, b, warpN) else { return }
                                for a in 0..<warpN { d[a] = -d[a] } // GN: δ = −H⁻¹b
                                var g = grid
                                for k in 0..<(warpGW * warpGH) {
                                    var step = SIMD2(d[k * 2], d[k * 2 + 1])
                                    let sl = simd_length(step)
                                    if sl > warpStepClamp { step *= warpStepClamp / sl }
                                    g[k] += step
                                }
                                NW[fi] = g
                            }
                        }
                    }
                }
                warps = newWarps
                var rs: Float = 0; var rn = 0
                for fi in 0..<frames.count { rs += fRes[fi]; rn += fResN[fi] }
                let mr = rn > 0 ? rs / Float(rn) : 0
                if witer == 0 { warpResBefore = mr }
                warpResAfter = mr
                MeshLog.log("poseRefine warp iter \(witer + 1)/\(warpIters) — snittresidual \(String(format: "%.4f", mr)) (\(rn) samples)")
            }
            // Eksporter NORMALISERTE rutenett (offset delt på thumb-størrelse → oppløsnings-
            // uavhengig, så baken kan bruke samme rutenett på fulloppløste frames). Indeksert
            // per keyframe via frameKF; frames uten thumb får tomt (baken tolker som identitet).
            for fi in 0..<frames.count {
                let f = frames[fi]
                let g = warps[fi]
                var norm = [SIMD2<Float>](repeating: .zero, count: g.count)
                for k in 0..<g.count { norm[k] = SIMD2(g[k].x / Float(max(f.lw, 1)), g[k].y / Float(max(f.lh, 1))) }
                warpGridsByKF[frameKF[fi]] = norm
            }
            MeshLog.log("poseRefine warp — residual \(String(format: "%.4f", warpResBefore)) → \(String(format: "%.4f", warpResAfter)), \(warpGW)×\(warpGH)-rutenett, \(frames.count) frames (eksportert til baken)")
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
