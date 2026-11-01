import Foundation
import Metal
import simd

/// Relokalisering mot et ferdig skann (SKANN_BESLUTNINGER §110). Kommer montøren tilbake til et
/// skannet rom, finner telefonen hvor den står og hvor den sikter fra kamerabildet alene, mot
/// vårt eget kart — ikke ARKits `ARWorldMap`. Da kan AR tegnes i modellens koordinater.
///
/// Kartet er LANDEMERKENE fra bildebindingen (§107/§109), ikke LiDAR-løftede trekk: dybden og
/// bildene er uenige på cm-nivå mellom passeringer (§105b), og det er teksturen montøren tegner
/// på. Prototypen målte 1 mm median der bindingen er enig med seg selv (0daef323), ~2 cm der den
/// ikke er det (a1b507ed). Gjenkjenningen er altså så god som bindingen.
///
/// Filer: bindingen skriver `relok.bin` i bundlen (bindingens verden). Baken gjør den om til
/// modellens verden med nøkkelbildenes endelige poser (driftretting, refine) og skriver
/// `<glb>.relok` ved siden av modellen — bundlene for eldre skann slettes, modellen blir.
enum MeshRelok {
    static func kartURL(glb: URL) -> URL { URL(fileURLWithPath: glb.path + ".relok") }

    /// Bindingens kart → modellens verden. Hver observasjon flyttes med SITT nøkkelbildes
    /// korreksjon D = endelig · bundet⁻¹, så punktet havner der teksturen fra det bildet la det.
    static func skrivKart(framesDir: URL, keyframes: [MeshScanPresenter.Keyframe], glbURL: URL) {
        let ut = kartURL(glb: glbURL)
        try? FileManager.default.removeItem(at: ut)
        guard MeshBildebinding.påslått,
              let d = try? Data(contentsOf: framesDir.appendingPathComponent(MeshBildebinding.kartnavn)), d.count >= 20,
              String(decoding: d.prefix(4), as: UTF8.self) == "RLB1",
              let jd = try? Data(contentsOf: framesDir.appendingPathComponent(MeshBildebinding.filnavn)),
              let r = try? JSONDecoder().decode(MeshBildebinding.Resultat.self, from: jd) else { return }
        func m4(_ a: [Double]) -> simd_double4x4 {
            simd_double4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                     SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
        }
        var bundet = [Int: simd_double4x4]()
        for (i, idx) in r.index.enumerated() { bundet[idx] = m4(r.m1[i]) }
        var D = [Int: simd_double4x4]()
        for k in keyframes where k.transform.count == 16 {
            guard let b = bundet[k.index] else { continue }
            D[k.index] = m4(k.transform.map(Double.init)) * b.inverse
        }
        let n = d.withUnsafeBytes { Int($0.load(fromByteOffset: 4, as: UInt32.self)) }
        guard d.count >= 20 + n * 148 else { return }
        var lab: [UInt32] = [], xyz: [Float] = [], desc = Data()
        lab.reserveCapacity(n); xyz.reserveCapacity(3 * n); desc.reserveCapacity(128 * n)
        d.withUnsafeBytes { p in
            for i in 0..<n {
                let o = 20 + i * 148
                let kf = Int(p.load(fromByteOffset: o, as: Int32.self))
                guard let Dk = D[kf] else { continue }
                let X = SIMD4(Double(p.load(fromByteOffset: o + 8, as: Float.self)), Double(p.load(fromByteOffset: o + 12, as: Float.self)),
                              Double(p.load(fromByteOffset: o + 16, as: Float.self)), 1)
                let Y = Dk * X
                lab.append(UInt32(bitPattern: p.load(fromByteOffset: o + 4, as: Int32.self)))
                xyz += [Float(Y.x), Float(Y.y), Float(Y.z)]
                desc.append(contentsOf: UnsafeRawBufferPointer(rebasing: p[(o + 20)..<(o + 148)]))
            }
        }
        guard lab.count >= 50 else { return }
        var o = Data(); o.reserveCapacity(20 + lab.count * 144)
        func put<T>(_ v: T) { withUnsafeBytes(of: v) { o.append(contentsOf: $0) } }
        o.append(contentsOf: Array("RLK1".utf8)); put(UInt32(lab.count))
        d.withUnsafeBytes { p in for k in 0..<3 { put(p.load(fromByteOffset: 8 + 4 * k, as: Float.self)) } }
        lab.withUnsafeBytes { o.append(contentsOf: $0) }
        xyz.withUnsafeBytes { o.append(contentsOf: $0) }
        o.append(desc)
        try? o.write(to: ut, options: .atomic)
        MeshLog.log("relok: kart \(lab.count) punkter (\(o.count / 1024) kB) → \(ut.lastPathComponent)")
    }
}

/// Finner kameraets pose i modellens verden fra ett bilde. Brukes av MeshArPresenter.
final class MeshRelokLokalisator {
    struct Svar {
        let G: simd_double4x4       // modell ← ARKit-økt: kamera i modellen = G · ARKit-pose
        let inliers: Int
        let treff: Int
        let restPx: Double          // median reprojeksjon blant inliers
    }

    private let sift: MeshSift
    private let n: Int
    private let pos: [SIMD3<Double>]
    private let lab: [UInt32]
    private let mbuf: MTLBuffer, lbuf: MTLBuffer
    /// Spørrebildet: uten OpenCVs oktav −1 og med færre trekk. Telefonen lagget med full SIFT
    /// (oppskalert pyramide) + 5000 trekk mot 125 k kartpunkter mens ARKit skulle vise kameraet.
    var maksTrekk = 3000
    var bit = 16384          // kartrader per GPU-jobb — kamerabildet slipper til mellom bitene
    let linse: SIMD3<Double>       // k1, k2, brennviddeskala — løst av bindingen for denne telefonen
    var antall: Int { n }

    init?(kart url: URL) {
        guard let d = try? Data(contentsOf: url), d.count >= 20, String(decoding: d.prefix(4), as: UTF8.self) == "RLK1",
              let sift = MeshSift() else { return nil }
        let n = d.withUnsafeBytes { Int($0.load(fromByteOffset: 4, as: UInt32.self)) }
        guard n > 0, d.count >= 20 + n * 144 else { return nil }
        self.sift = sift; self.n = n
        sift.upsample = false
        linse = d.withUnsafeBytes { SIMD3(Double($0.load(fromByteOffset: 8, as: Float.self)), Double($0.load(fromByteOffset: 12, as: Float.self)),
                                          Double($0.load(fromByteOffset: 16, as: Float.self))) }
        var p: [SIMD3<Double>] = []
        p.reserveCapacity(n)
        guard let lb = d.withUnsafeBytes({ sift.device.makeBuffer(bytes: $0.baseAddress! + 20, length: n * 4, options: .storageModeShared) }),
              let mb = d.withUnsafeBytes({ sift.device.makeBuffer(bytes: $0.baseAddress! + 20 + n * 16, length: n * 128, options: .storageModeShared) })
        else { return nil }
        d.withUnsafeBytes { b in
            for i in 0..<n {
                let o = 20 + n * 4 + i * 12
                p.append(SIMD3(Double(b.load(fromByteOffset: o, as: Float.self)), Double(b.load(fromByteOffset: o + 4, as: Float.self)),
                               Double(b.load(fromByteOffset: o + 8, as: Float.self))))
            }
        }
        pos = p; lbuf = lb; mbuf = mb
        lab = Array(UnsafeBufferPointer(start: lb.contents().bindMemory(to: UInt32.self, capacity: n), count: n))
    }

    struct Bilde {
        let luma: [UInt8]; let w: Int; let h: Int
        let K: SIMD4<Double>              // fx, fy, cx, cy i luma-piksler
        let A: simd_double4x4             // ARKit kamera → økt
        let dybde: [Float]?; let dw: Int; let dh: Int
    }

    /// Med `G0` (allerede låst): bare finpuss rundt den. Uten: RANSAC fra scratch, som krever dybde.
    func finn(_ b: Bilde, G0: simd_double4x4?) -> Svar? {
        let r = b.luma.withUnsafeBufferPointer { sift.detect($0.baseAddress!, width: b.w, height: b.h, maxFeatures: maksTrekk) }
        guard r.features.count >= 30 else { return nil }
        // Låst: bare kartpunktene som er i synsfeltet med forrige løsning (typisk en tidel av kartet)
        let knn = G0.flatMap { synlige(b, $0) }.map { match(r.descriptors, utvalg: $0) } ?? match(r.descriptors, utvalg: nil)
        // Lowe 0,8 (kvadrerte avstander), nest beste blant ANDRE landemerker
        var uvR: [SIMD2<Double>] = [], uv: [SIMD2<Double>] = [], X: [SIMD3<Double>] = []
        for (i, m) in knn.enumerated() where m.y != 0xffffffff && (m.z == 0xffffffff || Double(m.y) < 0.64 * Double(m.z)) {
            let f = r.features[i]
            let raw = SIMD2(Double(f.x), Double(f.y))
            uvR.append(raw); uv.append(rett(raw, b.K)); X.append(pos[Int(m.x)])
        }
        let nt = uv.count
        guard nt >= 30 else { return nil }

        var G: simd_double4x4
        if let G0 { G = G0 } else {
            guard let dyb = b.dybde, let g = ransac(b, uvR, uv, X, dyb) else { return nil }
            G = g
        }
        var inl: [Int] = []
        for terskel in [8.0, 3.0] {
            let C = ci(b, G)
            inl = (0..<nt).filter { feil(b, C, uv[$0], X[$0]) < terskel }
            guard inl.count >= 12 else { return nil }
            G = lm(b, G, inl.map { uv[$0] }, inl.map { X[$0] })
        }
        let C = ci(b, G)
        inl = (0..<nt).filter { feil(b, C, uv[$0], X[$0]) < 3 }
        // «vet ikke» heller enn feil sted: prototypen fikk én 88 cm-bom på 12 inliers, ingen over 30
        guard inl.count >= 30, Double(inl.count) >= 0.15 * Double(nt) else { return nil }
        let rest = inl.map { feil(b, C, uv[$0], X[$0]) }.sorted()
        return Svar(G: G, inliers: inl.count, treff: nt, restPx: rest[rest.count / 2])
    }

    // MARK: - matching

    /// Kartpunkter foran kameraet, innenfor bildet + 25 % marg, med pose G·A.
    private func synlige(_ b: Bilde, _ G: simd_double4x4) -> [Int]? {
        let C = ci(b, G)
        let mx = Double(b.w) * 0.25, my = Double(b.h) * 0.25
        var ut: [Int] = []
        for i in 0..<n {
            let P = C * SIMD4(pos[i], 1), z = -P.z
            guard z > 0.2, z < 8 else { continue }
            let u = b.K.x * P.x / z + b.K.z, v = -b.K.y * P.y / z + b.K.w
            if u > -mx && u < Double(b.w) + mx && v > -my && v < Double(b.h) + my { ut.append(i) }
        }
        return ut.count >= 30 ? ut : nil
    }

    /// Topp-2 mot kartet (eller et utvalg), i biter. Nest beste er blant ANDRE landemerker, også
    /// på tvers av bitene: en annen bits beste teller bare hvis den er et annet landemerke.
    private func match(_ q: [UInt8], utvalg: [Int]?) -> [SIMD3<UInt32>] {
        var mb = mbuf, lb = lbuf, nn = n
        if let u = utvalg {
            guard let m2 = sift.device.makeBuffer(length: u.count * 128, options: .storageModeShared),
                  let l2 = sift.device.makeBuffer(length: u.count * 4, options: .storageModeShared) else { return [] }
            let src = mbuf.contents(), dst = m2.contents(), ld = l2.contents().bindMemory(to: UInt32.self, capacity: u.count)
            for (k, i) in u.enumerated() { memcpy(dst + k * 128, src + i * 128, 128); ld[k] = lab[i] }
            mb = m2; lb = l2; nn = u.count
        }
        let labU = utvalg.map { u in u.map { lab[$0] } } ?? lab
        var res: [SIMD3<UInt32>] = []
        var fra = 0
        while fra < nn {
            let del = sift.matchMot(query: q, map: mb, labels: lb, count: min(bit, nn - fra), fra: fra)
            if res.isEmpty { res = del } else {
                for i in 0..<min(res.count, del.count) {
                    let a = res[i], c = del[i]
                    if c.y < a.y {
                        // ny beste fra denne biten; gammel beste blir nest beste hvis annet landemerke
                        let s2 = labU[Int(a.x)] != labU[Int(c.x)] ? min(a.y, c.z) : min(a.z, c.z)
                        res[i] = SIMD3(c.x, c.y, s2)
                    } else {
                        let kand = labU[Int(a.x)] != labU[Int(c.x)] ? c.y : c.z
                        res[i] = SIMD3(a.x, a.y, min(a.z, kand))
                    }
                }
            }
            fra += bit
        }
        if let u = utvalg { for i in 0..<res.count { res[i].x = UInt32(u[Int(res[i].x)]) } }
        return res
    }

    // MARK: - geometri

    /// Fjern linseforvrengningen bindingen løste (samme fastpunkt-iterasjon som prototypen).
    private func rett(_ p: SIMD2<Double>, _ K: SIMD4<Double>) -> SIMD2<Double> {
        let xd = (p.x - K.z) / K.x, yd = (p.y - K.w) / K.y
        var xn = xd, yn = yd
        for _ in 0..<8 {
            let r2 = xn * xn + yn * yn
            let g = (1 + linse.z) * (1 + linse.x * r2 + linse.y * r2 * r2)
            xn = xd / g; yn = yd / g
        }
        return SIMD2(xn * K.x + K.z, yn * K.y + K.w)
    }

    /// `Ci` = (G·A)⁻¹, verden → kamera; regnes én gang per pose, ikke per punkt.
    private func projiser(_ b: Bilde, _ Ci: simd_double4x4, _ X: SIMD3<Double>) -> SIMD2<Double>? {
        let P = Ci * SIMD4(X, 1)
        let z = -P.z
        guard z > 0.05 else { return nil }
        return SIMD2(b.K.x * P.x / z + b.K.z, -b.K.y * P.y / z + b.K.w)
    }

    private func feil(_ b: Bilde, _ Ci: simd_double4x4, _ uv: SIMD2<Double>, _ X: SIMD3<Double>) -> Double {
        guard let p = projiser(b, Ci, X) else { return .infinity }
        return simd_distance(p, uv)
    }
    private func ci(_ b: Bilde, _ G: simd_double4x4) -> simd_double4x4 { (G * b.A).inverse }

    /// Hypoteser fra tre treff med dybde (3D–3D, Kabsch), scoret på reprojeksjon. Dybden brukes
    /// BARE til å foreslå — den endelige posen kommer fra bildetreffene (LM under).
    private func ransac(_ b: Bilde, _ uvR: [SIMD2<Double>], _ uv: [SIMD2<Double>], _ X: [SIMD3<Double>], _ dyb: [Float]) -> simd_double4x4? {
        var S: [SIMD3<Double>] = [], M: [SIMD3<Double>] = [], idx: [Int] = []
        let s = Double(b.dw) / Double(b.w)
        for i in 0..<uv.count {
            let x = min(max(Int(uvR[i].x * s), 0), b.dw - 1), y = min(max(Int(uvR[i].y * s), 0), b.dh - 1)
            let z = Double(dyb[y * b.dw + x])
            guard z.isFinite, z > 0.2, z < 5 else { continue }
            let Pc = SIMD4((uv[i].x - b.K.z) / b.K.x * z, -(uv[i].y - b.K.w) / b.K.y * z, -z, 1)
            S.append((b.A * Pc).xyz); M.append(X[i]); idx.append(i)
        }
        guard S.count >= 12 else { return nil }
        var frø: UInt64 = 0x9E3779B97F4A7C15
        func tilf(_ n: Int) -> Int { frø = frø &* 6364136223846793005 &+ 1442695040888963407; return Int((frø >> 33) % UInt64(n)) }
        var best: simd_double4x4?, bestN = 0
        for _ in 0..<400 {
            let a = tilf(S.count), c = tilf(S.count), e = tilf(S.count)
            guard a != c, a != e, c != e,
                  simd_distance(M[a], M[c]) > 0.1, simd_distance(M[a], M[e]) > 0.1, simd_distance(M[c], M[e]) > 0.1,
                  let G = kabsch([S[a], S[c], S[e]], [M[a], M[c], M[e]]) else { continue }
            var n = 0
            let C = ci(b, G)
            for i in 0..<uv.count where feil(b, C, uv[i], X[i]) < 6 { n += 1 }
            if n > bestN { bestN = n; best = G }
        }
        return bestN >= 20 ? best : nil
    }

    private func kabsch(_ A: [SIMD3<Double>], _ B: [SIMD3<Double>]) -> simd_double4x4? {
        let ca = A.reduce(.zero, +) / Double(A.count), cb = B.reduce(.zero, +) / Double(B.count)
        var H = simd_double3x3()
        for i in 0..<A.count { let a = A[i] - ca, b = B[i] - cb
            H += simd_double3x3(columns: (a * b.x, a * b.y, a * b.z)) }   // Σ a·bᵀ (kolonne j = a·b_j)
        // rotasjon via kvaternion (Horn): unngår SVD i simd
        let Sxx = H[0][0], Sxy = H[1][0], Sxz = H[2][0], Syx = H[0][1], Syy = H[1][1], Syz = H[2][1], Szx = H[0][2], Szy = H[1][2], Szz = H[2][2]
        let Nm: [Double] = [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
                            Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
                            Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
                            Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]
        // største egenvektor ved potensiterasjon med skift
        var q = SIMD4<Double>(1, 0, 0, 0)
        let skift = sqrt(Nm.reduce(0) { $0 + $1 * $1 }) + 1e-9   // ≥ |λ| for alle: største egenverdi blir dominant
        for _ in 0..<60 {
            var nq = SIMD4<Double>.zero
            for r in 0..<4 { nq[r] = skift * q[r] + (0..<4).reduce(0.0) { $0 + Nm[r * 4 + $1] * q[$1] } }
            let l = simd_length(nq); guard l > 0 else { return nil }
            q = nq / l
        }
        let R = simd_double3x3(simd_quatd(ix: q[1], iy: q[2], iz: q[3], r: q[0]))
        let t = cb - R * ca
        return simd_double4x4(columns: (SIMD4(R.columns.0, 0), SIMD4(R.columns.1, 0), SIMD4(R.columns.2, 0), SIMD4(t, 1)))
    }

    /// Gauss–Newton/LM på G (venstreperturbasjon exp(δ)·G), Huber 1,5 px, numerisk Jacobi (6 ukjente).
    private func lm(_ b: Bilde, _ G0: simd_double4x4, _ uv: [SIMD2<Double>], _ X: [SIMD3<Double>]) -> simd_double4x4 {
        func exp6(_ d: [Double]) -> simd_double4x4 {
            let R = MeshBildebinding.rodrigues(SIMD3(d[0], d[1], d[2]))
            return simd_double4x4(columns: (SIMD4(R.columns.0, 0), SIMD4(R.columns.1, 0), SIMD4(R.columns.2, 0), SIMD4(d[3], d[4], d[5], 1)))
        }
        func res(_ G: simd_double4x4) -> [Double] {
            var r: [Double] = []; r.reserveCapacity(2 * uv.count)
            let C = ci(b, G)
            for i in 0..<uv.count {
                let p = projiser(b, C, X[i]) ?? SIMD2(1e4, 1e4)
                r += [p.x - uv[i].x, p.y - uv[i].y]
            }
            return r
        }
        func kost(_ r: [Double]) -> Double {
            var c = 0.0
            for i in stride(from: 0, to: r.count, by: 2) {
                let e = hypot(r[i], r[i + 1]); c += e < 1.5 ? e * e : 2 * 1.5 * e - 1.5 * 1.5
            }
            return c
        }
        var G = G0, r0 = res(G), c0 = kost(r0), lam = 1e-3
        for _ in 0..<15 {
            // Jacobi numerisk (6 kolonner)
            var J = [[Double]](repeating: [], count: 6)
            for k in 0..<6 {
                var d = [Double](repeating: 0, count: 6); d[k] = 1e-6
                let rk = res(exp6(d) * G)
                J[k] = zip(rk, r0).map { ($0 - $1) / 1e-6 }
            }
            // Huber-vekter per observasjon
            var w = [Double](repeating: 1, count: r0.count)
            for i in stride(from: 0, to: r0.count, by: 2) {
                let e = hypot(r0[i], r0[i + 1]); let v = e < 1.5 ? 1 : 1.5 / e; w[i] = v; w[i + 1] = v
            }
            var H = [Double](repeating: 0, count: 36), g = [Double](repeating: 0, count: 6)
            for a in 0..<6 {
                for c in a..<6 { var s = 0.0; for i in 0..<r0.count { s += w[i] * J[a][i] * J[c][i] }; H[a * 6 + c] = s; H[c * 6 + a] = s }
                var s = 0.0; for i in 0..<r0.count { s += w[i] * J[a][i] * r0[i] }; g[a] = -s
            }
            var bedre = false
            for _ in 0..<6 {
                var Hd = H; for a in 0..<6 { Hd[a * 6 + a] *= 1 + lam }
                guard let d = løs6(Hd, g) else { lam *= 10; continue }
                let G2 = exp6(d) * G, r2 = res(G2), c2 = kost(r2)
                if c2 < c0 {
                    G = G2; r0 = r2; lam = max(lam / 3, 1e-7)
                    bedre = c0 - c2 > 1e-6 * c0; c0 = c2; break
                }
                lam *= 10
            }
            if !bedre { break }
        }
        return G
    }

    private func løs6(_ A0: [Double], _ b0: [Double]) -> [Double]? {
        var A = A0, b = b0
        for c in 0..<6 {
            var p = c
            for r in c..<6 where abs(A[r * 6 + c]) > abs(A[p * 6 + c]) { p = r }
            guard abs(A[p * 6 + c]) > 1e-15 else { return nil }
            if p != c { for k in 0..<6 { A.swapAt(c * 6 + k, p * 6 + k) }; b.swapAt(c, p) }
            for r in (c + 1)..<6 {
                let f = A[r * 6 + c] / A[c * 6 + c]
                for k in c..<6 { A[r * 6 + k] -= f * A[c * 6 + k] }
                b[r] -= f * b[c]
            }
        }
        var x = [Double](repeating: 0, count: 6)
        for c in stride(from: 5, through: 0, by: -1) {
            var s = b[c]; for k in (c + 1)..<6 { s -= A[c * 6 + k] * x[k] }
            x[c] = s / A[c * 6 + c]
        }
        return x
    }
}

private extension SIMD4 where Scalar == Double {
    var xyz: SIMD3<Double> { SIMD3(x, y, z) }
}
