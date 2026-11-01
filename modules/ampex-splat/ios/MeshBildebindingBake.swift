import Foundation
import simd

/// Bakens side av bildebindingen (§109). Kjøres én gang per skann før TSDF-en og lagres i
/// `bildebinding.json` i bundlen, så en ombygging gjenbruker den og blir lik. Rettingen
/// brukes tre steder: nøkkelbildene (tekstur), dybdekartene i TSDF-en (korreksjonen
/// interpolert i tid mellom nabo-nøkkelbildene, som prototypen) og linsemodellen.
/// meshscan.bildebinding = "off" slår alt av (A/B); da gjelder en eventuell linse.json
/// fra prototypen som før.
extension MeshBildebinding {
    /// Under baken av ett delkart (M2) ligger bindingen i delkartets mappe: hver del bindes for
    /// seg, og bundlens egen fil (fra en global bake) skal verken leses eller overskrives.
    static var filnavn: String { MeshBakeArbeider.omfang.map { "delkart/\($0.id)/bildebinding.json" } ?? "bildebinding.json" }
    static var kartnavn: String {   // §110: landemerkene (bindingens verden), MeshRelok gjør dem om til modellens
        MeshBakeArbeider.omfang.map { "delkart/\($0.id)/relok.bin" } ?? "relok.bin"
    }

    static var påslått: Bool { UserDefaults.standard.string(forKey: "meshscan.bildebinding") != "off" }

    struct Korreksjon {
        let tk: [Double]                 // nøkkelbildenes tid, stigende
        let Dw: [simd_double4x4]         // verdenskorreksjon M1·M0⁻¹ per nøkkelbilde
        let rv: [SIMD3<Double>]          // rotasjonsdelen som rotasjonsvektor
        let perIndex: [Int: Int]
        let linse: SIMD4<Float>
        let sk: [Double]                 // §111 dybdeskala per nøkkelbilde (tom = av)

        init(_ r: Resultat) {
            func m(_ a: [Double]) -> simd_double4x4 {
                simd_double4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                         SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
            }
            tk = r.t
            Dw = zip(r.m1, r.m0).map { m($0) * m($1).inverse }
            rv = Dw.map { MeshBildebinding.rotvec(simd_double3x3(columns: ($0.columns.0.xyz3, $0.columns.1.xyz3, $0.columns.2.xyz3))) }
            perIndex = Dictionary(uniqueKeysWithValues: r.index.enumerated().map { ($1, $0) })
            linse = r.linse.count == 3 ? SIMD4(Float(r.linse[0]), Float(r.linse[1]), Float(r.linse[2]), 1) : .zero
            sk = UserDefaults.standard.string(forKey: "meshscan.dybdeskala") == "off" ? [] : (r.dybdeSkala ?? [])
        }

        /// LiDAR-dybden rettet mot bildene (§111): nøkkelbildets egen skala, ellers lineært i tid.
        func skala(index: Int) -> Float {
            guard sk.count == tk.count, let i = perIndex[index] else { return 1 }
            return Float(sk[i])
        }
        func skala(t: Double) -> Float {
            let n = tk.count
            guard sk.count == n, n >= 2 else { return sk.count == 1 ? Float(sk[0]) : 1 }
            var a = tk.firstIndex(where: { $0 >= t }) ?? n
            a = min(max(a, 1), n - 1)
            let w = max(0, min(1, (t - tk[a - 1]) / max(tk[a] - tk[a - 1], 1e-3)))
            return Float((1 - w) * sk[a - 1] + w * sk[a])
        }

        private static func f(_ m: simd_double4x4) -> simd_float4x4 {
            simd_float4x4(columns: (SIMD4<Float>(m.columns.0), SIMD4<Float>(m.columns.1), SIMD4<Float>(m.columns.2), SIMD4<Float>(m.columns.3)))
        }
        private static func d(_ m: simd_float4x4) -> simd_double4x4 {
            simd_double4x4(columns: (SIMD4<Double>(m.columns.0), SIMD4<Double>(m.columns.1), SIMD4<Double>(m.columns.2), SIMD4<Double>(m.columns.3)))
        }

        /// Korreksjonen ved tid t: lineært mellom nabo-nøkkelbildene (korreksjonene er < 1°).
        func ved(_ t: Double) -> simd_double4x4 {
            let n = tk.count
            guard n >= 2 else { return n == 1 ? Dw[0] : matrix_identity_double4x4 }
            var a = tk.firstIndex(where: { $0 >= t }) ?? n
            a = min(max(a, 1), n - 1)
            let w = max(0, min(1, (t - tk[a - 1]) / max(tk[a] - tk[a - 1], 1e-3)))
            let R = MeshBildebinding.rodrigues((1 - w) * rv[a - 1] + w * rv[a])
            let tr = (1 - w) * Dw[a - 1].columns.3 + w * Dw[a].columns.3
            return simd_double4x4(columns: (SIMD4(R.columns.0, 0), SIMD4(R.columns.1, 0), SIMD4(R.columns.2, 0), SIMD4(tr.x, tr.y, tr.z, 1)))
        }

        func dense(t: Double, _ m: simd_float4x4) -> simd_float4x4 { Self.f(ved(t) * Self.d(m)) }

        func keyframe(_ k: MeshScanPresenter.Keyframe) -> MeshScanPresenter.Keyframe {
            guard k.transform.count == 16 else { return k }
            let a = k.transform
            let m = simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                            SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
            // eget nøkkelbilde: nøyaktig dets korreksjon; ellers (ikke bundet) interpolert i tid
            let D = perIndex[k.index].map { Dw[$0] } ?? ved(k.timestamp)
            let r = Self.f(D * Self.d(m))
            var nk = k
            nk.transform = [r.columns.0, r.columns.1, r.columns.2, r.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
            return nk
        }
    }

    private static var cache: (path: String, k: Korreksjon?)?
    private static let lås = NSLock()

    /// Gjeldende korreksjon for skannet, eller nil (av, ikke kjørt, eller feilet).
    static func gjeldende(_ dir: URL) -> Korreksjon? {
        guard påslått else { return nil }
        lås.lock(); defer { lås.unlock() }
        let fil = dir.appendingPathComponent(filnavn)
        if let c = cache, c.path == fil.path { return c.k }
        var k: Korreksjon? = nil
        if let d = try? Data(contentsOf: fil),
           let r = try? JSONDecoder().decode(Resultat.self, from: d), r.v == 1, !r.index.isEmpty {
            k = Korreksjon(r)
        }
        cache = (fil.path, k)
        return k
    }

    /// Sørger for at bindingen finnes for skannet (kjører den ellers) og gir nøkkelbildene
    /// med bundne poser. Uendret ved av, feil eller for lite å binde.
    static func bind(framesDir: URL, keyframes: [MeshScanPresenter.Keyframe]) -> [MeshScanPresenter.Keyframe] {
        guard påslått else { return keyframes }
        // HELT HUS (2026-10-22): bindingen holder alle bildenes trekk i én buffer
        // (N × 5000 × 128 byte — 113 MB for 177 bilder, 1,3 GB for et hus på 2000) og løser
        // alt i ett. Over taket bakes det på ARKit-posene til bindingen går per delkart
        // (docs/SKANN_HELT_HUS.md steg 2). Mykere, men ingen krasj.
        let maksBilder = Int(MeshBakeV2.flaggTall("meshscan.bbmaks", 450))
        if keyframes.count > maksBilder {
            MeshLog.log("bildebinding: \(keyframes.count) bilder > \(maksBilder) — hoppet over (binding per delkart er ikke bygget ennå)")
            return keyframes
        }
        let url = framesDir.appendingPathComponent(filnavn)
        let kart = framesDir.appendingPathComponent(kartnavn)
        // skann bundet før §110 har ingen kart: bind på nytt (samme resultat, deterministisk) for å få det
        if !FileManager.default.fileExists(atPath: url.path) || !FileManager.default.fileExists(atPath: kart.path) {
            ARMeshGlbExporter.progress?("Binder bildene sammen…")
            ventPåForhåndsTrekk()
            let bilder = keyframes.map {
                Bilde(index: $0.index, timestamp: $0.timestamp, transform: $0.transform, intrinsics: $0.intrinsics,
                      width: $0.width, depthFile: $0.depthFile, depthWidth: $0.depthWidth, depthHeight: $0.depthHeight)
            }
            var valg = Valg(); valg.kart = kart
            // §111: uten oppskalert SIFT + andre trinn (ommatching med bundne poser) — raskere OG bedre
            valg.oppskaler = UserDefaults.standard.string(forKey: "meshscan.bbopp") == "on"
            let r = autoreleasepool {
                UserDefaults.standard.string(forKey: "meshscan.bbtrinn") == "1"
                    ? kjør(framesDir: framesDir, bilder: bilder, valg: valg, logg: { MeshLog.log($0) })
                    : kjørToTrinn(framesDir: framesDir, bilder: bilder, valg: valg, tol2: 10, vinkel2: 50, logg: { MeshLog.log($0) })
            }
            if let r, let d = try? JSONEncoder().encode(r) {
                try? d.write(to: url, options: .atomic)
            }
            lås.lock(); cache = nil; lås.unlock()
        }
        guard let k = gjeldende(framesDir) else { return keyframes }
        return keyframes.map(k.keyframe)
    }
}

private extension SIMD4 where Scalar == Double {
    var xyz3: SIMD3<Double> { SIMD3(x, y, z) }
}
