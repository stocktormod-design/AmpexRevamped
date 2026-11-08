import Accelerate
import Metal
import Foundation
import simd

/// Bildebinding mellom passeringer (SKANN_BESLUTNINGER §107–§109), portert fra
/// tools/scan-bildebinding.py — den er fasiten, og tallene skal stemme med den.
///
/// ARKit-posene er gode lokalt, men et sted filmet i to passeringer får 5–8 px bom mellom
/// bildene, og da «slåss» de i baken. Her bindes nøkkelbildene med SIFT-trekk (MeshSift):
/// 1. par som ser samme flate (dybde + poser), maks 50° mellom synsretningene
/// 2. veiledet matching: et trekk må havne innen `tol` px fra der ARKit + dybde spår, så
///    bare trekk i det vinduet sammenlignes (Python sammenlignet alle mot alle), og RANSAC
///    på fundamentalmatrisen fjerner resten
/// 3. spor (union-find) → frie landemerker
/// 4. bundle adjustment: korreksjon per nøkkelbilde M' = M·exp(δ) og én felles linsemodell
///    (k1, k2, brennviddeskala — ARKit oppgir ingen forvrengning), Huber-reprojeksjon,
///    anker mot ARKit, odometri mellom påfølgende bilder og svak dybdeprior.
///    Levenberg–Marquardt der landemerkene elimineres med Schur-komplement.
///
/// Frittstående (Foundation + simd + Accelerate + MeshSift) så den kjøres fra kommandolinja
/// på Mac-en mot fixturene.
enum MeshBildebinding {
    static var guidetGjensidig: Bool { UserDefaults.standard.string(forKey: "meshscan.bbgjensidig") != "off" }
    static var guidetRatio: Double { let r = UserDefaults.standard.double(forKey: "meshscan.bbratio"); return r > 0 ? r * r : 0.64 }
    struct Bilde {
        let index: Int
        let timestamp: Double
        var transform: [Float]        // kamera→verden, kolonnevis
        let intrinsics: [Float]       // fx fy cx cy ved `width`
        let width: Int
        let depthFile: String?
        let depthWidth: Int, depthHeight: Int
    }

    struct Valg {
        var gap = 3.0                 // s — par med større tidsavstand er «kryss» (ulike passeringer)
        var sigPx = 1.0               // px per observasjon (luma-oppløsning)
        var ankT = 0.03, ankR = 1.0 * Double.pi / 180
        var odoT = 0.003, odoR = 0.15 * Double.pi / 180   // per √s
        var dyp = 0.05                // m — dybdeprior (svak: LiDAR har egen bias, §105b)
        var tol = 30.0                // px — trekk må havne så nær der ARKit + dybde spår
        var iter = 40
        var holdUte = false           // hvert tredje kryss-par utenfor løsningen, for måling
        var maxTrekk = 5000
        var oppskaler = true          // OpenCVs oktav −1 (dobbel oppløsning før søket) — halve SIFT-tiden uten
        var vinkel = 50.0             // ° — største vinkel mellom synsretningene i et par
        var lager: TrekkLager? = nil  // trekk fra en tidligere kjøring (ommatching uten ny SIFT)
        var dumpObs: URL? = nil
        var kart: URL? = nil          // §110: landemerkene som relokaliseringskart (MeshRelok)
        var guidet = false            // §146: kandidater bare rundt spådd posisjon (trinn 2), ikke alle mot alle
    }

    /// SIFT-trekkene fra én kjøring, så andre trinn (ommatching med bundne poser) slipper å regne dem på nytt.
    final class TrekkLager {
        var XY: [[SIMD2<Float>]] = []
        var off: [Int] = []
        var dbuf: MTLBuffer?
    }

    struct Resultat: Codable {
        var v = 1
        var index: [Int]
        var t: [Double]
        var m0: [[Double]]            // posene bindingen startet fra (kolonnevis 16)
        var m1: [[Double]]            // bundne poser
        var linse: [Double]           // k1, k2, brennviddeskala
        var rapport: [String]
        var dybdeSkala: [Double]? = nil   // §111: z_bilde/z_lidar per nøkkelbilde (1 = urørt)
    }

    // MARK: - Hjelpere

    private typealias M4 = simd_double4x4

    private static func m4(_ a: [Float]) -> M4 {
        M4(columns: (SIMD4(Double(a[0]), Double(a[1]), Double(a[2]), Double(a[3])),
                     SIMD4(Double(a[4]), Double(a[5]), Double(a[6]), Double(a[7])),
                     SIMD4(Double(a[8]), Double(a[9]), Double(a[10]), Double(a[11])),
                     SIMD4(Double(a[12]), Double(a[13]), Double(a[14]), Double(a[15]))))
    }
    private static func flat(_ m: M4) -> [Double] {
        [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }
    private static func rot(_ m: M4) -> simd_double3x3 {
        simd_double3x3(columns: (m.columns.0.xyz, m.columns.1.xyz, m.columns.2.xyz))
    }
    private static func rigidInv(_ m: M4) -> M4 {
        let rt = rot(m).transpose, t = -(rt * m.columns.3.xyz)
        return M4(columns: (SIMD4(rt.columns.0, 0), SIMD4(rt.columns.1, 0), SIMD4(rt.columns.2, 0), SIMD4(t, 1)))
    }
    static func rodrigues(_ w: SIMD3<Double>) -> simd_double3x3 {
        let th = simd_length(w)
        if th < 1e-12 { return matrix_identity_double3x3 }
        let k = w / th
        let K = simd_double3x3(rows: [SIMD3(0, -k.z, k.y), SIMD3(k.z, 0, -k.x), SIMD3(-k.y, k.x, 0)])
        return matrix_identity_double3x3 + sin(th) * K + (1 - cos(th)) * (K * K)
    }
    private static func skew(_ v: SIMD3<Double>) -> simd_double3x3 {
        simd_double3x3(rows: [SIMD3(0, -v.z, v.y), SIMD3(v.z, 0, -v.x), SIMD3(-v.y, v.x, 0)])
    }
    private static func apply(_ m: M4, _ d: ArraySlice<Double>) -> M4 {
        let b = d.startIndex
        let R = rodrigues(SIMD3(d[b], d[b + 1], d[b + 2]))
        let D = M4(columns: (SIMD4(R.columns.0, 0), SIMD4(R.columns.1, 0), SIMD4(R.columns.2, 0),
                             SIMD4(d[b + 3], d[b + 4], d[b + 5], 1)))
        return m * D
    }
    static func rotvec(_ R: simd_double3x3) -> SIMD3<Double> {
        let c = max(-1, min(1, (R[0, 0] + R[1, 1] + R[2, 2] - 1) / 2)), th = acos(c)
        if th < 1e-9 { return .zero }
        // simd: R[kolonne, rad]
        return th / (2 * sin(th)) * SIMD3(R[1, 2] - R[2, 1], R[2, 0] - R[0, 2], R[0, 1] - R[1, 0])
    }
    private static func median(_ a: [Double]) -> Double {
        guard !a.isEmpty else { return .nan }
        let s = a.sorted(); return s[s.count / 2]
    }
    private static func pct(_ a: [Double], _ p: Double) -> Double {
        guard !a.isEmpty else { return .nan }
        let s = a.sorted(); return s[min(s.count - 1, Int(Double(s.count - 1) * p))]
    }

    // MARK: - Hoved

    static func kjør(framesDir: URL, bilder bilderInn: [Bilde], valg o: Valg = Valg(),
                     logg: (String) -> Void = { print($0) }) -> Resultat? {
        let t0 = CFAbsoluteTimeGetCurrent()
        // bilder med luma og dybde; sortert i tid
        struct Kf { let b: Bilde; let M0: M4; let K: SIMD4<Double>; let depth: [Float]; let luma: Data }
        var LW = 0, LH = 0
        var kfs: [Kf] = []
        for b in bilderInn.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard b.transform.count == 16, b.intrinsics.count == 4, let df = b.depthFile,
                  let dd = try? Data(contentsOf: framesDir.appendingPathComponent(df)),
                  dd.count == b.depthWidth * b.depthHeight * 4,
                  let ld = try? Data(contentsOf: framesDir.appendingPathComponent("luma-\(b.index).u8"), options: .alwaysMapped),
                  ld.count > 8 else { continue }
            let (w, h) = ld.withUnsafeBytes { (Int($0.load(as: UInt32.self)), Int($0.load(fromByteOffset: 4, as: UInt32.self))) }
            guard ld.count == 8 + w * h, LW == 0 || (w == LW && h == LH) else { continue }
            LW = w; LH = h
            let s = Double(w) / Double(b.width)
            kfs.append(Kf(b: b, M0: m4(b.transform),
                          K: SIMD4(Double(b.intrinsics[0]) * s, Double(b.intrinsics[1]) * s,
                                   Double(b.intrinsics[2]) * s, Double(b.intrinsics[3]) * s),
                          depth: dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }, luma: ld))
        }
        let N = kfs.count
        guard N >= 3 else { logg("bildebinding: for få nøkkelbilder (\(N))"); return nil }
        let T = kfs.map { $0.b.timestamp - kfs[0].b.timestamp }
        let M0 = kfs.map { $0.M0 }

        func sampleDepth(_ f: Int, _ u: Double, _ v: Double) -> (Double, Bool) {
            let k = kfs[f], dw = k.b.depthWidth, dh = k.b.depthHeight
            let s = Double(dw) / Double(LW)
            let x = min(max(Int(u * s), 0), dw - 1), y = min(max(Int(v * s), 0), dh - 1)
            let z = Double(k.depth[y * dw + x])
            guard z.isFinite, z > 0.2, z < 5 else { return (z, false) }
            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let zn = Double(k.depth[min(max(y + dy, 0), dh - 1) * dw + min(max(x + dx, 0), dw - 1)])
                if !(abs(zn - z) < 0.05 * z) { return (z, false) }
            }
            return (z, true)
        }
        func lift(_ f: Int, _ M: M4, _ u: Double, _ v: Double, _ z: Double) -> SIMD3<Double> {
            let K = kfs[f].K
            return (M * SIMD4((u - K.z) / K.x * z, -(v - K.w) / K.y * z, -z, 1)).xyz
        }
        func project(_ f: Int, _ Mi: M4, _ X: SIMD3<Double>) -> (SIMD2<Double>, Double) {
            let K = kfs[f].K, P = (Mi * SIMD4(X, 1)).xyz, z = -P.z
            return (SIMD2(K.x * P.x / z + K.z, -K.y * P.y / z + K.w), z)
        }
        let M0i = M0.map(rigidInv)

        // ── 1. Trekk ──────────────────────────────────────────────────────────────────
        guard let sift = MeshSift() else { logg("bildebinding: ingen Metal"); return nil }
        sift.upsample = o.oppskaler
        // deskriptorene rett i én GPU-buffer (≈ N × 640 kB), pyramiden slippes før matchingen
        var XY = [[SIMD2<Float>]](repeating: [], count: N), off = [Int](repeating: 0, count: N + 1)
        let gjenbruk = o.lager.flatMap { $0.dbuf != nil && $0.XY.count == N ? $0 : nil }
        guard let dbuf = gjenbruk?.dbuf ?? sift.device.makeBuffer(length: max(N * o.maxTrekk * 128, 16), options: .storageModeShared)
        else { logg("bildebinding: fikk ikke deskriptorbuffer"); return nil }
        if let g = gjenbruk { XY = g.XY; off = g.off }
        var fraSkann = 0
        for f in 0..<N where gjenbruk == nil {
            // regnet mens skannet pågikk (forhåndsTrekk) med samme innstillinger? da slipper vi SIFT her
            let r: (features: [MeshSift.Feature], descriptors: [UInt8])
            if let c = lesTrekk(framesDir, kfs[f].b.index, oppskaler: o.oppskaler, maks: o.maxTrekk) { r = c; fraSkann += 1 } else {
                r = kfs[f].luma.withUnsafeBytes {
                    sift.detect($0.baseAddress!.advanced(by: 8).assumingMemoryBound(to: UInt8.self), width: LW, height: LH, maxFeatures: o.maxTrekk)
                }
            }
            XY[f] = r.features.map { SIMD2($0.x, $0.y) }
            off[f + 1] = off[f] + r.features.count
            r.descriptors.withUnsafeBytes { if let b = $0.baseAddress { memcpy(dbuf.contents() + off[f] * 128, b, r.descriptors.count) } }
        }
        sift.releasePyramid()
        if fraSkann > 0 { logg("bildebinding: \(fraSkann)/\(N) bilder hadde trekk fra skanningen") }
        if let l = o.lager, gjenbruk == nil { l.XY = XY; l.off = off; l.dbuf = dbuf }
        let tTrekk = CFAbsoluteTimeGetCurrent() - t0

        // ── 2. Par ────────────────────────────────────────────────────────────────────
        var grid = [[SIMD3<Double>]](repeating: [], count: N)
        for f in 0..<N {
            var g: [SIMD3<Double>] = []
            var y = 8
            while y < LH { var x = 8; while x < LW {
                let (z, ok) = sampleDepth(f, Double(x), Double(y)); if ok { g.append(lift(f, M0[f], Double(x), Double(y), z)) }
                x += 60 }; y += 60 }
            grid[f] = g
        }
        var par: [(Int, Int)] = []
        let cos50 = cos(o.vinkel * Double.pi / 180)
        for i in 0..<N where grid[i].count >= 20 {
            let ci = M0[i].columns.2.xyz
            for j in (i + 1)..<N {
                guard simd_dot(ci, M0[j].columns.2.xyz) > cos50 else { continue }
                var inn = 0, synlig = 0
                for X in grid[i] {
                    let (uv, z) = project(j, M0i[j], X)
                    guard z > 0.2, uv.x > 0, uv.x < Double(LW), uv.y > 0, uv.y < Double(LH) else { continue }
                    inn += 1
                    let (zj, okj) = sampleDepth(j, uv.x, uv.y)
                    if okj && abs(zj - z) < 0.1 + 0.03 * z { synlig += 1 }
                }
                let n = Double(grid[i].count)
                if Double(inn) / n >= 0.25 && Double(synlig) / n > 0.25 { par.append((i, j)) }
            }
        }

        // ── 3. Matching (alle mot alle på GPU) → spådd posisjon → RANSAC ──────────────
        // §146 GUIDET MATCHING i trinn 2: posene er bundet, så hvert trekk sammenlignes bare med trekk
        // innen 3 × vinduet rundt der det spås å havne (forholdstesten mot dem), og beste treff må ligge
        // innen vinduet. Alle-mot-alle på GPU kostet 11 s per del på telefonen; dette er en brøkdel.
        let knn = o.guidet ? [] : sift.matchAll(descriptors: dbuf, offsets: off, pairs: par)
        let rCelle = max(8.0, o.tol), rSøk = 3 * o.tol
        let gRatio = MeshBildebinding.guidetRatio, gGjensidig = MeshBildebinding.guidetGjensidig
        var trekkNett = [[Int64: [Int32]]](repeating: [:], count: o.guidet ? N : 0)
        if o.guidet {
            for f in 0..<N {
                var g = [Int64: [Int32]]()
                for (b, q) in XY[f].enumerated() {
                    let k = Int64(Double(q.x) / rCelle) << 32 | Int64(UInt32(bitPattern: Int32(Double(q.y) / rCelle)))
                    g[k, default: []].append(Int32(b))
                }
                trekkNett[f] = g
            }
        }
        let dsk = dbuf.contents().assumingMemoryBound(to: UInt8.self)
        @inline(__always) func avstand(_ x: Int, _ y: Int) -> Int {
            let a = dsk + x * 128, b = dsk + y * 128
            var s = SIMD8<Int32>()
            var k = 0
            while k < 128 {
                let va = SIMD8<Int32>(truncatingIfNeeded: UnsafeRawPointer(a + k).loadUnaligned(as: SIMD8<UInt8>.self))
                let vb = SIMD8<Int32>(truncatingIfNeeded: UnsafeRawPointer(b + k).loadUnaligned(as: SIMD8<UInt8>.self))
                let d = va &- vb
                s &+= d &* d
                k += 8
            }
            return Int(s.wrappedSum())
        }
        struct Obs { var i: Int32, j: Int32, qi: Int32, qj: Int32; var ui: Double, vi: Double, uj: Double, vj: Double, zi: Double }
        var parObs = [[Obs]](repeating: [], count: par.count)
        parObs.withUnsafeMutableBufferPointer { slots in
            DispatchQueue.concurrentPerform(iterations: par.count) { pi in
                let (i, j) = par[pi]
                var kand: [Obs] = []
                if o.guidet {
                    guard XY[i].count >= 10, XY[j].count >= 10 else { return }
                    let nett = trekkNett[j]
                    var bestB = [Int32: (Int, Int)]()   // gjensidig: b → (avstand, kandidatindeks)
                    for a in 0..<XY[i].count {
                        let u = Double(XY[i][a].x), v = Double(XY[i][a].y)
                        let (z, ok) = sampleDepth(i, u, v); guard ok else { continue }
                        let (p, zp) = project(j, M0i[j], lift(i, M0[i], u, v, z))
                        guard zp > 0.2 else { continue }
                        var b1 = -1, d1 = Int.max, d2 = Int.max
                        let cx0 = Int((p.x - rSøk) / rCelle), cx1 = Int((p.x + rSøk) / rCelle)
                        let cy0 = Int((p.y - rSøk) / rCelle), cy1 = Int((p.y + rSøk) / rCelle)
                        guard cx1 >= 0, cy1 >= 0 else { continue }
                        for cy in max(0, cy0)...cy1 { for cx in max(0, cx0)...cx1 {
                            guard let liste = nett[Int64(cx) << 32 | Int64(UInt32(bitPattern: Int32(cy)))] else { continue }
                            for bb in liste {
                                let b = Int(bb), q = XY[j][b]
                                guard hypot(Double(q.x) - p.x, Double(q.y) - p.y) < rSøk else { continue }
                                let d = avstand(off[i] + a, off[j] + b)
                                if d < d1 { d2 = d1; d1 = d; b1 = b } else if d < d2 { d2 = d }
                            }
                        } }
                        guard b1 >= 0, d2 == Int.max || Double(d1) < gRatio * Double(d2) else { continue }
                        let uj = Double(XY[j][b1].x), vj = Double(XY[j][b1].y)
                        guard hypot(p.x - uj, p.y - vj) < o.tol else { continue }
                        if gGjensidig, let (dv, kv) = bestB[Int32(b1)] {
                            if d1 >= dv { continue }
                            kand[kv].qj = -1   // tidligere vinner taper — b1 er nærmere dette trekket
                        }
                        bestB[Int32(b1)] = (d1, kand.count)
                        kand.append(Obs(i: Int32(i), j: Int32(j), qi: Int32(a), qj: Int32(b1), ui: u, vi: v, uj: uj, vj: vj, zi: z))
                    }
                    kand.removeAll { $0.qj < 0 }
                }
                let m = o.guidet ? [] : knn[pi]
                guard o.guidet || (m.count == XY[i].count && XY[i].count >= 10 && XY[j].count >= 10) else { return }
                for a in 0..<m.count {
                    // Lowes forholdstest over HELE bildet (0,8 på avstand = 0,64 på kvadrat)
                    guard Double(m[a].y) < 0.64 * Double(m[a].z) else { continue }
                    let b = Int(m[a].x)
                    let u = Double(XY[i][a].x), v = Double(XY[i][a].y)
                    let (z, ok) = sampleDepth(i, u, v); guard ok else { continue }
                    // trekket må havne nær der ARKit + dybde spår — dreper falske treff på
                    // periodiske mønstre (§105)
                    let (p, zp) = project(j, M0i[j], lift(i, M0[i], u, v, z))
                    let uj = Double(XY[j][b].x), vj = Double(XY[j][b].y)
                    guard zp > 0.2, hypot(p.x - uj, p.y - vj) < o.tol else { continue }
                    kand.append(Obs(i: Int32(i), j: Int32(j), qi: Int32(a), qj: Int32(b), ui: u, vi: v, uj: uj, vj: vj, zi: z))
                }
                guard kand.count >= 12 else { return }
                var rng = UInt64(truncatingIfNeeded: pi &* 2654435761 &+ 1)
                guard let inl = ransacF(kand.map { SIMD2($0.ui, $0.vi) }, kand.map { SIMD2($0.uj, $0.vj) }, thr: 2, conf: 0.999, rng: &rng)
                else { return }
                let ut = zip(kand, inl).filter { $0.1 }.map { $0.0 }
                if ut.count >= 12 { slots[pi] = ut }
            }
        }
        let obs = parObs.flatMap { $0 }
        if let u = o.dumpObs {   // til tools/scan-bildebinding.py --obs= (feilsøking mot fasiten)
            var d = Data()
            for ob in obs { for x in [Double(kfs[Int(ob.i)].b.index), Double(kfs[Int(ob.j)].b.index), ob.ui, ob.vi, ob.uj, ob.vj, ob.zi, Double(ob.qi), Double(ob.qj)] { withUnsafeBytes(of: x) { d.append(contentsOf: $0) } } }
            try? d.write(to: u)
        }
        let tMatch = CFAbsoluteTimeGetCurrent() - t0 - tTrekk
        guard obs.count >= 50 else { logg("bildebinding: for få treff (\(obs.count))"); return nil }

        let erKryss = obs.map { T[Int($0.j)] - T[Int($0.i)] >= o.gap }
        let parid = obs.map { Int($0.i) * N + Int($0.j) }
        var holdPar = Set<Int>()
        if o.holdUte {
            let u = Array(Set(zip(parid, erKryss).filter { $0.1 }.map { $0.0 })).sorted()
            for (n, p) in u.enumerated() where n % 3 == 0 { holdPar.insert(p) }
        }
        let hold = parid.map { holdPar.contains($0) }

        // ── måling: epipolar avstand (uavhengig av dybde og landemerker) ──────────────
        func epipolar(_ M: [M4], _ kd: SIMD3<Double>, _ sel: [Bool]) -> [Double] {
            func und(_ f: Int, _ u: Double, _ v: Double) -> SIMD3<Double> {
                let K = kfs[f].K, xd = (u - K.z) / K.x, yd = (v - K.w) / K.y
                var xn = xd, yn = yd
                for _ in 0..<8 { let r2 = xn * xn + yn * yn; let g = (1 + kd.z) * (1 + kd.x * r2 + kd.y * r2 * r2); xn = xd / g; yn = yd / g }
                return SIMD3(xn * K.x + K.z, yn * K.y + K.w, 1)
            }
            func kmat(_ f: Int) -> simd_double3x3 {
                let K = kfs[f].K; return simd_double3x3(rows: [SIMD3(K.x, 0, K.z), SIMD3(0, K.y, K.w), SIMD3(0, 0, 1)])
            }
            var Fc = [Int: simd_double3x3](), out: [Double] = []
            let C = simd_double3x3(diagonal: SIMD3(1, -1, -1))
            for (n, ob) in obs.enumerated() where sel[n] {
                let i = Int(ob.i), j = Int(ob.j)
                let F = Fc[parid[n]] ?? {
                    let Rij = rigidInv(M[j]) * M[i]
                    let R = C * rot(Rij) * C, t = C * Rij.columns.3.xyz
                    let F = kmat(j).inverse.transpose * skew(t) * R * kmat(i).inverse
                    Fc[parid[n]] = F; return F
                }()
                let x1 = und(i, ob.ui, ob.vi), x2 = und(j, ob.uj, ob.vj)
                let l2 = F * x1, l1 = F.transpose * x2, e = abs(simd_dot(x2, l2))
                out.append(0.5 * (e / simd_length(SIMD2(l2.x, l2.y)) + e / simd_length(SIMD2(l1.x, l1.y))))
            }
            return out
        }
        var rapport: [String] = []
        func rapporter(_ M: [M4], _ kd: SIMD3<Double>, _ navn: String, skala: [Double]? = nil) {
            let sett: [(String, [Bool])] = o.holdUte
                ? [("kryss holdt ute", hold), ("kryss løst", (0..<obs.count).map { !hold[$0] && erKryss[$0] })]
                : [("kryss", erKryss)]
            for (lbl, sel) in sett {
                let e = epipolar(M, kd, sel)
                guard !e.isEmpty else { continue }
                // løft+kast: trekket løftet med LiDAR-dybden i bilde i, kastet inn i j — dybde mot bilder
                var lk: [Double] = []
                let Mi = M.map(rigidInv)
                for (n, ob) in obs.enumerated() where sel[n] {
                    let i = Int(ob.i), j = Int(ob.j), Ki = kfs[i].K, Kj = kfs[j].K
                    var xd = (ob.ui - Ki.z) / Ki.x, yd = (ob.vi - Ki.w) / Ki.y
                    var xn = xd, yn = yd
                    for _ in 0..<8 { let r2 = xn * xn + yn * yn; let g = (1 + kd.z) * (1 + kd.x * r2 + kd.y * r2 * r2); xn = xd / g; yn = yd / g }
                    let zi = ob.zi * (skala?[i] ?? 1)
                    let X = (M[i] * SIMD4(xn * zi, -yn * zi, -zi, 1))
                    let P = Mi[j] * X, z = -P.z
                    guard z > 0.1 else { continue }
                    xd = P.x / z; yd = -P.y / z
                    let r2 = xd * xd + yd * yd, g = (1 + kd.z) * (1 + kd.x * r2 + kd.y * r2 * r2)
                    lk.append(hypot(Kj.x * xd * g + Kj.z - ob.uj, Kj.y * yd * g + Kj.w - ob.vj))
                }
                let s = String(format: "%@%@ %@: epipolar median %.2f px p90 %.2f · løft+kast median %.2f p90 %.2f (n=%d)", navn, skala == nil ? "" : " (dybdeskala)", lbl, median(e), pct(e, 0.9), median(lk), pct(lk, 0.9), e.count)
                rapport.append(s); logg("bildebinding: " + s)
            }
        }
        logg(String(format: "bildebinding: %d bilder, %d trekk (%.1f s), %d par, %d treff (%.1f s)",
                    N, XY.reduce(0) { $0 + $1.count }, tTrekk, par.count, obs.count, tMatch))
        rapporter(M0, .zero, "før")

        // ── 4. Spor → landemerker ─────────────────────────────────────────────────────
        var forelder = [Int: Int]()
        func finn(_ a0: Int) -> Int {
            var a = a0
            while let p = forelder[a], p != a { let pp = forelder[p] ?? p; forelder[a] = pp; a = pp }
            return a
        }
        let fit = hold.map { !$0 }
        for (n, ob) in obs.enumerated() where fit[n] {
            let a = finn(Int(ob.i) << 20 | Int(ob.qi)), b = finn(Int(ob.j) << 20 | Int(ob.qj))
            if a != b { forelder[a] = b }
        }
        var sporId = [Int: Int](), spor: [[Int: SIMD3<Double>]] = []
        for (n, ob) in obs.enumerated() where fit[n] {
            for (f, q, u, v) in [(Int(ob.i), Int(ob.qi), ob.ui, ob.vi), (Int(ob.j), Int(ob.qj), ob.uj, ob.vj)] {
                let r = finn(f << 20 | q)
                let id = sporId[r] ?? { spor.append([:]); sporId[r] = spor.count - 1; return spor.count - 1 }()
                spor[id][f] = SIMD3(u, v, Double(q))   // ett trekk per bilde per spor (u, v, trekknr)
            }
        }
        var obF: [Int] = [], obL: [Int] = [], obU: [Double] = [], obV: [Double] = [], obZ: [Double] = [], obZok: [Bool] = [], obQ: [Int] = []
        var X: [SIMD3<Double>] = []
        for s in spor where s.count >= 2 {
            var sum = SIMD3<Double>.zero, cnt = 0
            var rader: [(Int, SIMD3<Double>, Double, Bool)] = []
            for f in s.keys.sorted() {
                let uv = s[f]!, (z, ok) = sampleDepth(f, uv.x, uv.y)
                if ok { sum += lift(f, M0[f], uv.x, uv.y, z); cnt += 1 }
                rader.append((f, uv, z, ok))
            }
            guard cnt > 0 else { continue }   // landemerker uten dybde i noe bilde: dropp
            let l = X.count
            X.append(sum / Double(cnt))
            for (f, uv, z, ok) in rader {
                obF.append(f); obL.append(l); obU.append(uv.x); obV.append(uv.y); obZ.append(z); obZok.append(ok); obQ.append(Int(uv.z))
            }
        }
        let L = X.count, NO = obF.count
        logg("bildebinding: \(L) landemerker, \(NO) observasjoner")
        guard L >= 20 else { return nil }

        // ── 5. Bundle adjustment ──────────────────────────────────────────────────────
        let NP = 6 * N + 3, HUB = 3.0
        let zw = (0..<NO).map { obZok[$0] ? 1 / (o.dyp + 0.01 * (obZ[$0].isFinite ? obZ[$0] : 1)) : 0 }
        let rel0i = (0..<(N - 1)).map { rigidInv(M0i[$0] * M0[$0 + 1]) }
        let sdt = (0..<(N - 1)).map { sqrt(max(T[$0 + 1] - T[$0], 0.05)) }

        func poses(_ dl: [Double]) -> [M4] { (0..<N).map { apply(M0[$0], dl[(6 * $0)..<(6 * $0 + 6)]) } }
        // residual og Jacobi for én observasjon (rad u, v, z)
        func proj(_ P: SIMD3<Double>, _ kd: SIMD3<Double>, _ f: Int) -> (u: Double, v: Double, z: Double, xn: Double, yn: Double, zs: Double, clamp: Bool) {
            let K = kfs[f].K, z = -P.z, zs = max(z, 0.05)
            let xn = P.x / zs, yn = -P.y / zs, r2 = xn * xn + yn * yn
            let g = (1 + kd.z) * (1 + kd.x * r2 + kd.y * r2 * r2)
            return (K.x * xn * g + K.z, K.y * yn * g + K.w, z, xn, yn, zs, z < 0.05)
        }
        func odoRes(_ Ma: M4, _ Mb: M4, _ f: Int) -> [Double] {
            let E = rel0i[f] * rigidInv(Ma) * Mb
            // simd: E[kolonne][rad]; Python E[rad, kol]
            let w = SIMD3(E[1][2] - E[2][1], E[2][0] - E[0][2], E[0][1] - E[1][0]) / 2
            let a = o.odoR * sdt[f], b = o.odoT * sdt[f]
            return [w.x / a, w.y / a, w.z / a, E[3][0] / b, E[3][1] / b, E[3][2] / b]
        }
        func huberKost(_ r: Double) -> Double { let a = abs(r); return a <= HUB ? a * a : 2 * HUB * a - HUB * HUB }
        func kost(_ dl: [Double], _ X: [SIMD3<Double>], _ kd: SIMD3<Double>) -> Double {
            let M = poses(dl), Mi = M.map(rigidInv)
            var c = 0.0
            for n in 0..<NO {
                let f = obF[n], P = (Mi[f] * SIMD4(X[obL[n]], 1)).xyz, p = proj(P, kd, f)
                c += huberKost((p.u - obU[n]) / o.sigPx) + huberKost((p.v - obV[n]) / o.sigPx)
                if obZok[n] { c += huberKost((p.z - obZ[n]) * zw[n]) }
            }
            for f in 0..<N {
                for c3 in 0..<3 { let a = dl[6 * f + c3] / o.ankR, b = dl[6 * f + 3 + c3] / o.ankT; c += a * a + b * b }
            }
            for f in 0..<(N - 1) { for r in odoRes(M[f], M[f + 1], f) { c += r * r } }
            c += (kd.x / 0.2) * (kd.x / 0.2) + (kd.y / 0.2) * (kd.y / 0.2)
            return 0.5 * c
        }

        var dl = [Double](repeating: 0, count: 6 * N), kd = SIMD3<Double>.zero
        var lam = 1e-3, c0 = kost(dl, X, kd), runder = 0
        let tBA = CFAbsoluteTimeGetCurrent()
        // Per observasjon: Jp (3×9: ω, v, linse), Jl (3×3), Huber-vekt og residual, og
        // B = JpᵀWJl (9×3). Regnes parallelt i flate buffere — ingen allokering i løkkene.
        var JP = [Double](repeating: 0, count: NO * 27), WR = [Double](repeating: 0, count: NO * 6)
        var Bo = [Double](repeating: 0, count: NO * 27)
        var obsAvL = [[Int]](repeating: [], count: L)
        for n in 0..<NO { obsAvL[obL[n]].append(n) }
        let maxSpor = obsAvL.map(\.count).max() ?? 0
        var Hpp = [Double](repeating: 0, count: NP * NP), gp = [Double](repeating: 0, count: NP)
        var Hll = [simd_double3x3](repeating: .init(), count: L), gl = [SIMD3<Double>](repeating: .zero, count: L)
        var S = [Double](repeating: 0, count: NP * NP)
        var Dinv = [simd_double3x3](repeating: .init(), count: L)
        var Ebuf = [Double](repeating: 0, count: maxSpor * 18)
        let sig = o.sigPx

        lm: for it in 0..<o.iter {
            runder = it + 1
            let M = poses(dl), Mi = M.map(rigidInv)
            let Xs = X, kds = kd
            JP.withUnsafeMutableBufferPointer { jpB in WR.withUnsafeMutableBufferPointer { wrB in Bo.withUnsafeMutableBufferPointer { boB in
                let jp = jpB.baseAddress!, wr = wrB.baseAddress!, bo = boB.baseAddress!
                DispatchQueue.concurrentPerform(iterations: (NO + 2047) / 2048) { ch in
                    for n in (ch * 2048)..<min(NO, ch * 2048 + 2048) {
                        let f = obF[n], l = obL[n]
                        let Rt = rot(Mi[f]), P = (Mi[f] * SIMD4(Xs[l], 1)).xyz
                        let p = proj(P, kds, f), K = kfs[f].K
                        let r2 = p.xn * p.xn + p.yn * p.yn
                        let rad = 1 + kds.x * r2 + kds.y * r2 * r2, g = (1 + kds.z) * rad
                        let dg = (1 + kds.z) * (kds.x + 2 * kds.y * r2) * 2   // dg/dxn = dg·xn, dg/dyn = dg·yn
                        let dxn = SIMD3(1 / p.zs, 0, p.clamp ? 0 : P.x / (p.zs * p.zs))
                        let dyn = SIMD3(0, -1 / p.zs, p.clamp ? 0 : -P.y / (p.zs * p.zs))
                        let du = K.x * ((g + p.xn * dg * p.xn) * dxn + p.xn * dg * p.yn * dyn) / sig
                        let dv = K.y * (p.yn * dg * p.xn * dxn + (g + p.yn * dg * p.yn) * dyn) / sig
                        let zok = obZok[n]
                        let dz = zok ? SIMD3<Double>(0, 0, -zw[n]) : .zero
                        let res = SIMD3((p.u - obU[n]) / sig, (p.v - obV[n]) / sig, zok ? (p.z - obZ[n]) * zw[n] : 0)
                        let lu = SIMD3(K.x * p.xn * (1 + kds.z) * r2, K.x * p.xn * (1 + kds.z) * r2 * r2, K.x * p.xn * rad) / sig
                        let lv = SIMD3(K.y * p.yn * (1 + kds.z) * r2, K.y * p.yn * (1 + kds.z) * r2 * r2, K.y * p.yn * rad) / sig
                        // Pc = Rᵀ(X − c); høyreperturbasjon: dPc/dω = [Pc]×, dPc/dv = −I, dPc/dX = Rᵀ
                        let PxT = skew(P).transpose, R = Rt.transpose
                        var jl = (SIMD3<Double>.zero, SIMD3<Double>.zero, SIMD3<Double>.zero)
                        for r in 0..<3 {
                            let d = r == 0 ? du : r == 1 ? dv : dz
                            let ln = r == 0 ? lu : r == 1 ? lv : SIMD3<Double>.zero
                            let jw = PxT * d, jlr = R * d
                            let b = jp + n * 27 + r * 9
                            b[0] = jw.x; b[1] = jw.y; b[2] = jw.z; b[3] = -d.x; b[4] = -d.y; b[5] = -d.z
                            b[6] = ln.x; b[7] = ln.y; b[8] = ln.z
                            let a = abs(res[r])
                            wr[n * 6 + r] = a <= HUB ? 1 : HUB / max(a, 1e-12)
                            wr[n * 6 + 3 + r] = res[r]
                            if r == 0 { jl.0 = jlr } else if r == 1 { jl.1 = jlr } else { jl.2 = jlr }
                        }
                        // B = Σ_r w_r·Jp[r]ᵀ·Jl[r]
                        let B = bo + n * 27
                        for a in 0..<9 {
                            var v = SIMD3<Double>.zero
                            v += wr[n * 6] * jp[n * 27 + a] * jl.0
                            v += wr[n * 6 + 1] * jp[n * 27 + 9 + a] * jl.1
                            v += wr[n * 6 + 2] * jp[n * 27 + 18 + a] * jl.2
                            B[a * 3] = v.x; B[a * 3 + 1] = v.y; B[a * 3 + 2] = v.z
                        }
                    }
                }
            }}}
            // Hll og gl per landemerke (parallelt): Jl regnes på nytt — 3×3, billig
            Hll.withUnsafeMutableBufferPointer { hB in gl.withUnsafeMutableBufferPointer { gB in
                let hp = hB.baseAddress!, gpp = gB.baseAddress!
                DispatchQueue.concurrentPerform(iterations: (L + 1023) / 1024) { ch in
                    for l in (ch * 1024)..<min(L, ch * 1024 + 1024) {
                        var H = simd_double3x3(), g3 = SIMD3<Double>.zero
                        for n in obsAvL[l] {
                            let R = rot(Mi[obF[n]])   // Jl-rad = d·R(Mi), d = dRes/dPc = −Jp[3..5]
                            for r in 0..<3 {
                                let d = SIMD3(-JP[n * 27 + r * 9 + 3], -JP[n * 27 + r * 9 + 4], -JP[n * 27 + r * 9 + 5])
                                let j = R.transpose * d
                                let w = WR[n * 6 + r]
                                H += w * simd_double3x3(columns: (j * j.x, j * j.y, j * j.z))
                                g3 += w * WR[n * 6 + 3 + r] * j
                            }
                        }
                        hp[l] = H; gpp[l] = g3
                    }
                }
            }}
            // tett pose/linse-blokk (serielt: alle skriver i samme matrise)
            for k in 0..<(NP * NP) { Hpp[k] = 0 }
            for k in 0..<NP { gp[k] = 0 }
            Hpp.withUnsafeMutableBufferPointer { hB in JP.withUnsafeBufferPointer { jpB in WR.withUnsafeBufferPointer { wrB in
                let H = hB.baseAddress!, jp = jpB.baseAddress!, wr = wrB.baseAddress!
                var col = [Int](repeating: 0, count: 9)
                for c in 0..<3 { col[6 + c] = 6 * N + c }
                for n in 0..<NO {
                    let f = obF[n]
                    for c in 0..<6 { col[c] = 6 * f + c }
                    for r in 0..<3 {
                        let w = wr[n * 6 + r], wres = w * wr[n * 6 + 3 + r], j = jp + n * 27 + r * 9
                        for a in 0..<9 {
                            let wa = w * j[a]
                            if wa == 0 { continue }
                            gp[col[a]] += j[a] * wres
                            let row = H + col[a] * NP
                            for b in 0..<9 { row[col[b]] += wa * j[b] }
                        }
                    }
                }
            }}}
            // anker (lineært i δ), odometri (numerisk, 12 kolonner per par), linseprior
            for f in 0..<N {
                for c in 0..<6 {
                    let s = c < 3 ? o.ankR : o.ankT, k = 6 * f + c
                    Hpp[k * NP + k] += 1 / (s * s); gp[k] += dl[k] / (s * s)
                }
            }
            let eps = 1e-6
            for f in 0..<(N - 1) {
                let r0 = odoRes(M[f], M[f + 1], f)
                var J = [[Double]](repeating: [Double](repeating: 0, count: 12), count: 6)
                for c in 0..<12 {
                    var d2 = Array(dl[(6 * f)..<(6 * f + 12)]); d2[c] += eps
                    let r1 = odoRes(apply(M0[f], d2[0..<6]), apply(M0[f + 1], d2[6..<12]), f)
                    for r in 0..<6 { J[r][c] = (r1[r] - r0[r]) / eps }
                }
                for a in 0..<12 {
                    var gsum = 0.0
                    for r in 0..<6 { gsum += J[r][a] * r0[r] }
                    gp[6 * f + a] += gsum
                    for b in 0..<12 {
                        var h = 0.0
                        for r in 0..<6 { h += J[r][a] * J[r][b] }
                        Hpp[(6 * f + a) * NP + 6 * f + b] += h
                    }
                }
            }
            for c in 0..<2 { Hpp[(6 * N + c) * NP + 6 * N + c] += 1 / 0.04; gp[6 * N + c] += kd[c] / 0.04 }

            while true {
                // Schur: S = A − Σ_l Hpl_l·D_l⁻¹·Hpl_lᵀ, rhs = −gp + Σ_l Hpl_l·D_l⁻¹·gl_l.
                // Blokkene til et landemerke: 6 rader per bilde som ser det + én felles linseblokk.
                for k in 0..<(NP * NP) { S[k] = Hpp[k] }
                for k in 0..<NP { S[k * NP + k] += lam * (Hpp[k * NP + k] + 1e-9) }
                var rhs = gp.map { -$0 }
                S.withUnsafeMutableBufferPointer { sB in Bo.withUnsafeBufferPointer { boB in Ebuf.withUnsafeMutableBufferPointer { eB in
                    let Sp = sB.baseAddress!, bo = boB.baseAddress!, E = eB.baseAddress!
                    for l in 0..<L {
                        var Hl = Hll[l]
                        for c in 0..<3 { Hl[c][c] += lam * Hll[l][c][c] + 1e-9 }
                        let Di = Hl.inverse
                        Dinv[l] = Di
                        let ob = obsAvL[l], gl3 = gl[l]
                        var lensB = (SIMD3<Double>.zero, SIMD3<Double>.zero, SIMD3<Double>.zero)
                        for (k, n) in ob.enumerated() {
                            let B = bo + n * 27
                            lensB.0 += SIMD3(B[18], B[19], B[20]); lensB.1 += SIMD3(B[21], B[22], B[23]); lensB.2 += SIMD3(B[24], B[25], B[26])
                            for a in 0..<6 {   // E = B·D⁻¹ (D symmetrisk)
                                let e = Di * SIMD3(B[a * 3], B[a * 3 + 1], B[a * 3 + 2])
                                E[k * 18 + a * 3] = e.x; E[k * 18 + a * 3 + 1] = e.y; E[k * 18 + a * 3 + 2] = e.z
                            }
                        }
                        let El = (Di * lensB.0, Di * lensB.1, Di * lensB.2)
                        let lensRows = [lensB.0, lensB.1, lensB.2], ElRows = [El.0, El.1, El.2]
                        for (k, n) in ob.enumerated() {
                            let rk = 6 * obF[n]
                            for a in 0..<6 {
                                let e = SIMD3(E[k * 18 + a * 3], E[k * 18 + a * 3 + 1], E[k * 18 + a * 3 + 2])
                                rhs[rk + a] += simd_dot(e, gl3)
                                let row = Sp + (rk + a) * NP
                                for m in ob {
                                    let Bm = bo + m * 27, cm = 6 * obF[m]
                                    for b in 0..<6 { row[cm + b] -= e.x * Bm[b * 3] + e.y * Bm[b * 3 + 1] + e.z * Bm[b * 3 + 2] }
                                }
                                for b in 0..<3 {
                                    let v = simd_dot(e, lensRows[b])
                                    row[6 * N + b] -= v
                                    Sp[(6 * N + b) * NP + rk + a] -= v
                                }
                            }
                        }
                        for a in 0..<3 {
                            rhs[6 * N + a] += simd_dot(ElRows[a], gl3)
                            for b in 0..<3 { Sp[(6 * N + a) * NP + 6 * N + b] -= simd_dot(ElRows[a], lensRows[b]) }
                        }
                    }
                }}}
                guard let dp = cholSolve(S, rhs, NP) else {
                    lam *= 5; if lam > 1e6 { break lm }; continue
                }
                var X2 = X
                for l in 0..<L {
                    var v = gl[l]
                    for n in obsAvL[l] {
                        let f = obF[n]
                        for a in 0..<9 {
                            let k: Int = n * 27 + a * 3
                            let d: Double = a < 6 ? dp[6 * f + a] : dp[6 * N + a - 6]
                            let bv = SIMD3<Double>(Bo[k], Bo[k + 1], Bo[k + 2])
                            v += d * bv
                        }
                    }
                    X2[l] = X[l] - Dinv[l] * v
                }
                var dl2 = dl
                for k in 0..<(6 * N) { dl2[k] += dp[k] }
                let kd2 = kd + SIMD3(dp[6 * N], dp[6 * N + 1], dp[6 * N + 2])
                let c1 = kost(dl2, X2, kd2)
                if c1 < c0 {
                    let rel = (c0 - c1) / c0
                    dl = dl2; X = X2; kd = kd2; c0 = c1; lam = max(lam / 3, 1e-7)
                    if rel < 1e-5 { break lm }
                    break
                }
                lam *= 5
                if lam > 1e6 { break lm }
            }
        }
        let M1 = poses(dl)
        if let url = o.kart {
            // Bare observasjoner som stemmer med løsningen (< 3 px med linsa) — et landemerke som
            // BA-en har Huber-dempet, ville trukket relokaliseringen mot feil sted.
            var d = Data(); d.reserveCapacity(20 + NO * 148)
            func put<T>(_ v: T) { withUnsafeBytes(of: v) { d.append(contentsOf: $0) } }
            d.append(contentsOf: Array("RLB1".utf8)); put(UInt32(0))
            put(Float(kd.x)); put(Float(kd.y)); put(Float(kd.z))
            let M1i = M1.map(rigidInv)
            var n = 0
            for i in 0..<NO {
                let f = obF[i], K = kfs[f].K, P = (M1i[f] * SIMD4(X[obL[i]], 1)).xyz, z = -P.z
                guard z > 0.1 else { continue }
                let xn = P.x / z, yn = -P.y / z, r2 = xn * xn + yn * yn
                let g = (1 + kd.z) * (1 + kd.x * r2 + kd.y * r2 * r2)
                guard hypot(K.x * xn * g + K.z - obU[i], K.y * yn * g + K.w - obV[i]) < 3 else { continue }
                put(Int32(kfs[f].b.index)); put(Int32(obL[i]))
                put(Float(X[obL[i]].x)); put(Float(X[obL[i]].y)); put(Float(X[obL[i]].z))
                d.append(Data(bytes: dbuf.contents() + (off[f] + obQ[i]) * 128, count: 128))
                n += 1
            }
            d.replaceSubrange(4..<8, with: withUnsafeBytes(of: UInt32(n)) { Data($0) })
            try? d.write(to: url, options: .atomic)
            logg("bildebinding: relokaliseringskart \(n) av \(NO) observasjoner (\(d.count / 1024) kB)")
        }
        logg(String(format: "bildebinding: BA %.1f s, %d runder, kost %.0f; linse k1 %+.4f k2 %+.4f brennvidde %+.2f %%",
                    CFAbsoluteTimeGetCurrent() - tBA, runder, c0, kd.x, kd.y, kd.z * 100))
        rapporter(M1, kd, "etter")
        // §111 dybde mot bilder: LiDAR-dybden der landemerket (løst av bildene) faktisk ligger
        var perBilde = [[(Double, Double)]](repeating: [], count: N)   // (z_lidar, z_bilde)
        var dybdeSkala = [Double](repeating: 1, count: N)
        do {
            let M1i = M1.map(rigidInv)
            var nObs = [Int](repeating: 0, count: L)
            for l in obL { nObs[l] += 1 }
            for i in 0..<NO where obZok[i] && nObs[obL[i]] >= 3 {
                let f = obF[i], P = M1i[f] * SIMD4(X[obL[i]], 1), z = -P.z
                guard z > 0.2, z < 5 else { continue }
                perBilde[f].append((obZ[i], z))
            }
            var alle: [Double] = [], fm: [Double] = []
            var sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0, sn = 0.0
            for f in 0..<N {
                let r = perBilde[f].map { $0.1 / $0.0 }
                alle += r
                if r.count >= 20 { fm.append(median(r)) }
                for (zl, zb) in perBilde[f] { sx += zl; sy += zb; sxx += zl * zl; sxy += zl * zb; sn += 1 }
            }
            let b = (sn * sxy - sx * sy) / max(sn * sxx - sx * sx, 1e-9), a0 = (sy - b * sx) / max(sn, 1)
            for f in 0..<N where perBilde[f].count >= 20 {
                dybdeSkala[f] = min(1.03, max(0.97, median(perBilde[f].map { $0.1 / $0.0 })))
            }
            logg(String(format: "bildebinding: dybde — z_bilde/z_lidar median %.4f (p10 %.4f p90 %.4f, n=%d); per bilde p10–p90 %.4f–%.4f (%d bilder); lineært z_bilde = %.4f·z %+.1f mm",
                        median(alle), pct(alle, 0.1), pct(alle, 0.9), alle.count, pct(fm, 0.1), pct(fm, 0.9), fm.count, b, a0 * 1000))
        }
        rapporter(M1, kd, "etter", skala: dybdeSkala)
        let flytt = (0..<N).map { simd_distance(M1[$0].columns.3.xyz, M0[$0].columns.3.xyz) }
        logg(String(format: "bildebinding: flytt median %.0f mm, maks %.0f mm; totalt %.1f s",
                    median(flytt) * 1000, (flytt.max() ?? 0) * 1000, CFAbsoluteTimeGetCurrent() - t0))
        return Resultat(index: kfs.map { $0.b.index }, t: kfs.map { $0.b.timestamp },
                        m0: M0.map(flat), m1: M1.map(flat), linse: [kd.x, kd.y, kd.z], rapport: rapport, dybdeSkala: dybdeSkala)
    }

    // MARK: - Trekk under skanningen (§111)

    /// SIFT per nøkkelbilde MENS det skannes, så bindingen ved «Ferdig» bare matcher og løser.
    /// Samme innstillinger som bindingen (uten oppskalering, 5000 trekk); fila bærer dem, og
    /// bindingen regner på nytt hvis de ikke stemmer. Seriell kø med lav prioritet, og hoppes
    /// over når telefonen er varm — da tas bildet ved «Ferdig» som før.
    private static let trekkKø = DispatchQueue(label: "ampex.bildebinding.trekk", qos: .utility)
    private static var trekkSift: MeshSift?

    static func trekkURL(_ dir: URL, _ index: Int) -> URL { dir.appendingPathComponent("sift-\(index).bin") }

    static func forhåndsTrekk(framesDir: URL, index: Int) {
        guard påslått else { return }
        trekkKø.async {
            let th = ProcessInfo.processInfo.thermalState
            guard th != .serious, th != .critical else { return }
            autoreleasepool {
                guard let ld = try? Data(contentsOf: framesDir.appendingPathComponent("luma-\(index).u8"), options: .alwaysMapped), ld.count > 8 else { return }
                let (w, h) = ld.withUnsafeBytes { (Int($0.load(as: UInt32.self)), Int($0.load(fromByteOffset: 4, as: UInt32.self))) }
                guard ld.count == 8 + w * h else { return }
                if trekkSift == nil { trekkSift = MeshSift(); trekkSift?.upsample = false }
                guard let sift = trekkSift else { return }
                let r = ld.withUnsafeBytes { sift.detect($0.baseAddress!.advanced(by: 8).assumingMemoryBound(to: UInt8.self), width: w, height: h, maxFeatures: 5000) }
                var d = Data(); d.reserveCapacity(16 + r.features.count * 136)
                func put<T>(_ v: T) { withUnsafeBytes(of: v) { d.append(contentsOf: $0) } }
                d.append(contentsOf: Array("SFT1".utf8)); put(UInt32(r.features.count)); put(UInt32(0)); put(UInt32(5000))   // 0 = uten oppskalering
                for f in r.features { put(f.x); put(f.y) }
                d.append(contentsOf: r.descriptors)
                try? d.write(to: trekkURL(framesDir, index), options: .atomic)
            }
        }
    }

    /// Vent til bildene i kø er ferdige (arbeid bindingen ellers ville gjort selv), og slipp
    /// SIFT-bufferne (pyramiden er ~100 MB) før bindingen lager sine egne.
    static func ventPåForhåndsTrekk() { trekkKø.sync { trekkSift = nil } }

    static func lesTrekk(_ dir: URL, _ index: Int, oppskaler: Bool, maks: Int) -> (features: [MeshSift.Feature], descriptors: [UInt8])? {
        guard let d = try? Data(contentsOf: trekkURL(dir, index)), d.count >= 16, String(decoding: d.prefix(4), as: UTF8.self) == "SFT1" else { return nil }
        let (n, opp, mx) = d.withUnsafeBytes { (Int($0.load(fromByteOffset: 4, as: UInt32.self)), $0.load(fromByteOffset: 8, as: UInt32.self), Int($0.load(fromByteOffset: 12, as: UInt32.self))) }
        guard (opp == 1) == oppskaler, mx == maks, d.count == 16 + n * 136 else { return nil }
        var fs: [MeshSift.Feature] = []; fs.reserveCapacity(n)
        d.withUnsafeBytes { p in
            for i in 0..<n {
                fs.append(MeshSift.Feature(x: p.load(fromByteOffset: 16 + i * 8, as: Float.self), y: p.load(fromByteOffset: 20 + i * 8, as: Float.self), size: 0, angle: 0, response: 0))
            }
        }
        return (fs, [UInt8](d[(16 + n * 8)...]))
    }

    /// To trinn (§111): bind, så match på nytt med de BUNDNE posene — strammere spådomsvindu og
    /// større vinkler, så passeringer som bare så hverandre skrått også blir bundet. Trekkene
    /// gjenbrukes. Resultatet er relativt til de opprinnelige posene (m0 fra første trinn).
    static func kjørToTrinn(framesDir: URL, bilder: [Bilde], valg o: Valg = Valg(), tol2: Double = 10, vinkel2: Double = 70,
                            logg: @escaping (String) -> Void = { print($0) }) -> Resultat? {
        let lager = TrekkLager()
        var v1 = o; v1.lager = lager; v1.kart = nil; v1.holdUte = false
        guard let r1 = kjør(framesDir: framesDir, bilder: bilder, valg: v1, logg: logg) else { return nil }
        var m1 = [Int: [Double]]()
        for (i, idx) in r1.index.enumerated() { m1[idx] = r1.m1[i] }
        let b2 = bilder.map { b -> Bilde in
            var nb = b
            if let m = m1[b.index] { nb.transform = m.map(Float.init) }
            return nb
        }
        var v2 = o; v2.lager = lager; v2.tol = tol2; v2.vinkel = vinkel2
        v2.guidet = UserDefaults.standard.string(forKey: "meshscan.bbguidet") == "on"   // §146: av — raskere, men dårligere p90
        logg("bildebinding: trinn 2 — ommatching med bundne poser (vindu \(Int(tol2)) px, vinkel \(Int(vinkel2))°)")
        guard let r2 = kjør(framesDir: framesDir, bilder: b2, valg: v2, logg: logg), r2.index == r1.index else { return r1 }
        return Resultat(index: r2.index, t: r2.t, m0: r1.m0, m1: r2.m1, linse: r2.linse, rapport: r1.rapport + r2.rapport,
                        dybdeSkala: r2.dybdeSkala)
    }

    // MARK: - Lineær algebra

    /// Løser S·x = b for symmetrisk positiv definitt S (Cholesky, LAPACK).
    private static func cholSolve(_ S: [Double], _ b: [Double], _ n: Int) -> [Double]? {
        var A = S, x = b
        var N = __CLPK_integer(n), nrhs = __CLPK_integer(1), lda = __CLPK_integer(n), ldb = __CLPK_integer(n), info = __CLPK_integer(0)
        var uplo = Int8(UInt8(ascii: "L"))
        dposv_(&uplo, &N, &nrhs, &A, &lda, &x, &ldb, &info)
        return info == 0 && x.allSatisfy({ $0.isFinite }) ? x : nil
    }

    /// Egenverdier/-vektorer for symmetrisk n×n (Jacobi). Vektorene er kolonner i `v`, radvis lagret.
    private static func jacobi(_ a0: [Double], _ n: Int) -> (w: [Double], v: [Double]) {
        var a = a0, v = [Double](repeating: 0, count: n * n)
        for i in 0..<n { v[i * n + i] = 1 }
        for _ in 0..<60 {
            var off = 0.0
            for p in 0..<n { for q in (p + 1)..<n { off += a[p * n + q] * a[p * n + q] } }
            if off < 1e-22 { break }
            for p in 0..<n { for q in (p + 1)..<n {
                let apq = a[p * n + q]
                guard abs(apq) > 1e-300 else { continue }
                let th = (a[q * n + q] - a[p * n + p]) / (2 * apq)
                let t = (th >= 0 ? 1 : -1) / (abs(th) + sqrt(th * th + 1))
                let c = 1 / sqrt(t * t + 1), s = t * c
                for k in 0..<n {
                    let akp = a[k * n + p], akq = a[k * n + q]
                    a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq
                }
                for k in 0..<n {
                    let apk = a[p * n + k], aqk = a[q * n + k]
                    a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk
                }
                for k in 0..<n {
                    let vkp = v[k * n + p], vkq = v[k * n + q]
                    v[k * n + p] = c * vkp - s * vkq; v[k * n + q] = s * vkp + c * vkq
                }
            }}
        }
        return ((0..<n).map { a[$0 * n + $0] }, v)
    }

    /// Fundamentalmatrise med RANSAC (normalisert 8-punkt, rang 2), feilmål som OpenCV:
    /// maks av kvadrert avstand til epipolarlinja i hvert bilde. Deterministisk via `rng`.
    static func ransacF(_ p1: [SIMD2<Double>], _ p2: [SIMD2<Double>], thr: Double, conf: Double,
                        rng: inout UInt64, maxIter: Int = 1000) -> [Bool]? {
        let n = p1.count
        guard n >= 8 else { return nil }
        func norm(_ p: [SIMD2<Double>]) -> simd_double3x3 {
            let c = p.reduce(.zero, +) / Double(p.count)
            let d = p.reduce(0) { $0 + simd_distance($1, c) } / Double(p.count)
            let s = d > 0 ? sqrt(2) / d : 1
            return simd_double3x3(rows: [SIMD3(s, 0, -s * c.x), SIMD3(0, s, -s * c.y), SIMD3(0, 0, 1)])
        }
        let T1 = norm(p1), T2 = norm(p2)
        let q1 = p1.map { T1 * SIMD3($0, 1) }, q2 = p2.map { T2 * SIMD3($0, 1) }
        func fit(_ idx: [Int]) -> simd_double3x3? {
            var ata = [Double](repeating: 0, count: 81)
            for i in idx {
                let a = q1[i], b = q2[i]
                let r = [b.x * a.x, b.x * a.y, b.x, b.y * a.x, b.y * a.y, b.y, a.x, a.y, 1.0]
                for x in 0..<9 { for y in 0..<9 { ata[x * 9 + y] += r[x] * r[y] } }
            }
            let (w, v) = jacobi(ata, 9)
            guard let mi = w.indices.min(by: { w[$0] < w[$1] }) else { return nil }
            let f = (0..<9).map { v[$0 * 9 + mi] }
            let F = simd_double3x3(rows: [SIMD3(f[0], f[1], f[2]), SIMD3(f[3], f[4], f[5]), SIMD3(f[6], f[7], f[8])])
            // rang 2: F = Σ sᵢ uᵢ vᵢᵀ uten minste ledd
            let ftf = F.transpose * F
            let (ew, ev) = jacobi([ftf[0][0], ftf[1][0], ftf[2][0], ftf[0][1], ftf[1][1], ftf[2][1], ftf[0][2], ftf[1][2], ftf[2][2]], 3)
            let ord = [0, 1, 2].sorted { ew[$0] > ew[$1] }
            var F2 = simd_double3x3()
            for k in ord.prefix(2) {
                let vk = SIMD3(ev[k], ev[3 + k], ev[6 + k]), s = sqrt(max(ew[k], 0))
                guard s > 0 else { continue }
                let uk = F * vk / s
                F2 += s * simd_double3x3(columns: (uk * vk.x, uk * vk.y, uk * vk.z))
            }
            let Fd = T2.transpose * F2 * T1
            return Fd
        }
        let t2 = thr * thr
        func inliers(_ F: simd_double3x3) -> [Bool] {
            (0..<n).map { i in
                let x1 = SIMD3(p1[i], 1), x2 = SIMD3(p2[i], 1)
                let l2 = F * x1, l1 = F.transpose * x2
                let d2 = simd_dot(x2, l2), d1 = simd_dot(x1, l1)
                let e2 = d2 * d2 / max(l2.x * l2.x + l2.y * l2.y, 1e-300), e1 = d1 * d1 / max(l1.x * l1.x + l1.y * l1.y, 1e-300)
                return max(e1, e2) <= t2
            }
        }
        func next() -> Int {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17
            return Int(rng % UInt64(n))
        }
        var best: [Bool]? = nil, bestN = 0, iters = maxIter, it = 0
        while it < iters {
            it += 1
            var s = Set<Int>()
            while s.count < 8 { s.insert(next()) }
            guard let F = fit(s.sorted()) else { continue }
            let m = inliers(F), k = m.filter { $0 }.count
            if k > bestN {
                bestN = k; best = m
                let w = Double(k) / Double(n)
                let denom = log(max(1 - pow(w, 8), 1e-12))
                if denom < 0 { iters = min(iters, Int(ceil(log(1 - conf) / denom))) }
            }
        }
        return best
    }
}

private extension SIMD4 where Scalar == Double {
    var xyz: SIMD3<Double> { SIMD3(x, y, z) }
}
