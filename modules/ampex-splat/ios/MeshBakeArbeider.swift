import Foundation
import simd

/// BAKE PER DELKART (2026-10-27, M2 i docs/PROMPT_OPUS_SKANN_DELKART.md). Hvert delkart bakes
/// for seg med NØYAKTIG den samme kjeden som ett rom i dag (binding → TSDF med driftretting →
/// bake), men bare med delkartets egne nøkkelbilder og dybdekart. Da gjelder hvert tak i
/// kjeden (forenkling, atlas, voxel, binding over 450, driftrettingens 20 cm) per delkart og
/// ikke per hus — det er krav 1: et rom skal bli likt alene og som del av fem.
///
/// Kjeden er ikke skrevet om. Den leser hele bundlen, så omfanget settes her og leses der det
/// trengs: `loadDense` og `loadKeyframesJBU` filtrerer på indeksene, og bindingen skriver og
/// leser `delkart/N/bildebinding.json` i stedet for bundlens.
///
/// Ut: `delkart/N/delkart-N.glb` (+ `.relok`) per delkart, `hus.json`, og ÉN sammenslått GLB
/// og ett sammenslått relok-kart på den stien kalleren ba om — så vieweren, AR og app-siden
/// er uendret i M2. Overlapp: trekanter i et nyere delkart som ligger innen ~2 voxler av
/// flaten i et eldre slettes før baken (enkel sveising, M3 lukker skjøten).
///
/// Bakegruppene er rom, ikke delkart (se `grupper`): delkart som har sett det samme bakes
/// sammen. Blir det én gruppe, er det nøyaktig dagens globale bake, og den tas.
/// `meshscan.delkartbake off` gir alltid den globale baken (A/B).
enum MeshBakeArbeider {
    struct Omfang {
        let id: Int
        let dybdekart: Set<Int>
        let nøkkelbilder: Set<Int>
    }
    /// Satt mens ett delkart bakes. Baken er seriell, så én global holder.
    static var omfang: Omfang?

    /// Et delkart med færre enn dette bakes sammen med naboen (typisk sekundene før Ferdig).
    static let minstNøkkelbilder = 12
    static let minstDybdekart = 40

    static func kart(_ framesDir: URL) -> [DelkartKart] {
        let rot = framesDir.appendingPathComponent("delkart", isDirectory: true)
        guard let navn = try? FileManager.default.contentsOfDirectory(atPath: rot.path) else { return [] }
        return navn.compactMap { n -> DelkartKart? in
            guard let d = try? Data(contentsOf: rot.appendingPathComponent(n).appendingPathComponent("kart.json")) else { return nil }
            return try? JSONDecoder().decode(DelkartKart.self, from: d)
        }.sorted { $0.id < $1.id }
    }

    /// Gjelder når delkartene danner minst to bakegrupper. Én gruppe er nøyaktig den globale
    /// baken (alle bilder, alle dybdekart), og da tas den vanlige veien.
    static func gjelder(_ framesDir: URL) -> Bool {
        UserDefaults.standard.string(forKey: "meshscan.delkartbake") != "off" && grupper(kart(framesDir), framesDir: framesDir).count >= 2
    }

    /// Bakegruppene er ROM, ikke delkart. Lukkeregelen (45 s, 120 bilder) deler et rom i flere
    /// delkart selv om kameraet aldri går ut: 8f3b8017 er ett rom i fire delkart, og baket hver
    /// for seg fikk delkart 3 klippet 227 k av 284 k trekanter mot delkart 0 — veggen fikk bare
    /// den første rundens bilder. Delkart som har sett det samme slås derfor sammen: overlapp =
    /// felles 16 cm-celler / cellene i det minste, ≥ 0,5 slår sammen (mest overlapp først), så
    /// lenge gruppen holder seg under `meshscan.gruppemaks` nøkkelbilder (450 = taket bindingen
    /// tåler i ett løp). Små rester (sekundene før Ferdig) går til gruppen de overlapper mest.
    static func grupper(_ alle: [DelkartKart], framesDir: URL) -> [[DelkartKart]] {
        guard alle.count >= 2 else { return alle.isEmpty ? [] : [alle] }
        // Harness (A/B): `meshscan.grupper "0,1;2;3;4"` tvinger grupperingen. Delkart som ikke
        // er nevnt, blir egne grupper.
        if let tvang = UserDefaults.standard.string(forKey: "meshscan.grupper"), !tvang.isEmpty {
            var brukt = Set<Int>()
            var ut: [[DelkartKart]] = tvang.split(separator: ";").map { g in
                let ids = Set(g.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) })
                brukt.formUnion(ids)
                return alle.filter { ids.contains($0.id) }
            }.filter { !$0.isEmpty }
            ut += alle.filter { !brukt.contains($0.id) }.map { [$0] }
            return ut.sorted { $0[0].id < $1[0].id }
        }
        let celler = alle.map { verdensceller(framesDir, $0) }
        let maks = Int(MeshBakeV2.flaggTall("meshscan.gruppemaks", 450))
        let n = alle.count
        var forelder = Array(0..<n)
        func rot(_ i: Int) -> Int { var i = i; while forelder[i] != i { i = forelder[i] }; return i }
        var bilder = alle.map { $0.nøkkelbilder.count }
        func overlapp(_ a: Int, _ b: Int) -> Double {
            let (x, y) = celler[a].count <= celler[b].count ? (celler[a], celler[b]) : (celler[b], celler[a])
            guard !x.isEmpty else { return 0 }
            return Double(x.reduce(0) { $0 + (y.contains($1) ? 1 : 0) }) / Double(x.count)
        }
        var par: [(Double, Int, Int)] = []
        for a in 0..<n { for b in (a + 1)..<n { par.append((overlapp(a, b), a, b)) } }
        par.sort { $0.0 != $1.0 ? $0.0 > $1.0 : ($0.1, $0.2) < ($1.1, $1.2) }
        for (o, a, b) in par where o >= 0.5 {
            let ra = rot(a), rb = rot(b)
            guard ra != rb, bilder[ra] + bilder[rb] <= maks else { continue }
            forelder[max(ra, rb)] = min(ra, rb); bilder[min(ra, rb)] += bilder[max(ra, rb)]
        }
        // Små rester: inn i gruppen med mest overlapp (eller forrige delkart), uansett tak.
        for i in 0..<n where rot(i) == i {
            let medlemmer = (0..<n).filter { rot($0) == i }
            let nb = medlemmer.reduce(0) { $0 + alle[$1].nøkkelbilder.count }
            let nd = medlemmer.reduce(0) { $0 + alle[$1].dybdekart.count }
            guard nb < minstNøkkelbilder || nd < minstDybdekart else { continue }
            var best = -1.0, mål = -1
            for j in 0..<n where rot(j) != i {
                let o = medlemmer.map { overlapp($0, j) }.max() ?? 0
                if o > best { best = o; mål = rot(j) }
            }
            if best <= 0 { mål = i > 0 ? rot(i - 1) : (n > 1 ? rot(1) : -1) }
            if mål >= 0, mål != i { forelder[i] = mål }
        }
        var ut: [Int: [DelkartKart]] = [:]
        for i in 0..<n { ut[rot(i), default: []].append(alle[i]) }
        return ut.values.map { $0.sorted { $0.id < $1.id } }.sorted { $0[0].id < $1[0].id }
    }

    /// Blokkene et delkart har allokert, som 16 cm-celler i verden (delkartenes egne gitter er
    /// forskjøvet mot hverandre, så de må gjennom verden for å kunne sammenlignes).
    static func verdensceller(_ framesDir: URL, _ k: DelkartKart) -> Set<SIMD3<Int32>> {
        guard k.T.count == 16, k.lo.count == 3, let bl = lesBlokker(framesDir, k.id) else { return [] }
        let t = k.T
        let T = simd_float4x4(columns: (SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]),
                                        SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15])))
        let lo = SIMD3(k.lo[0], k.lo[1], k.lo[2]), b = k.vox * 8
        var s = Set<SIMD3<Int32>>(minimumCapacity: bl.count)
        for c in bl {
            let p = (T * SIMD4(lo + (SIMD3<Float>(c) + 0.5) * b, 1)).xyz / 0.16
            s.insert(SIMD3(Int32(p.x.rounded(.down)), Int32(p.y.rounded(.down)), Int32(p.z.rounded(.down))))
        }
        return s
    }

    static func bakHus(framesDir: URL, arkit: MeshBakeV2.MergedMesh,
                       keyframes: [MeshScanPresenter.Keyframe], to glbURL: URL)
        -> ARMeshGlbExporter.TexturedExportResult? {
        guard UserDefaults.standard.string(forKey: "meshscan.delkartbake") != "off" else { return nil }
        let alle = kart(framesDir)
        let grupper = grupper(alle, framesDir: framesDir)
        guard grupper.count >= 2 else { return nil }
        let t0 = CFAbsoluteTimeGetCurrent()
        let gruppeTekst: [String] = grupper.map { g in "[" + g.map { String($0.id) }.joined(separator: ",") + "]" }
        MeshLog.log("hus — \(alle.count) delkart i \(grupper.count) bakegrupper: \(gruppeTekst.joined(separator: " "))")
        defer { omfang = nil }

        let arkitDeler = fordel(arkit, på: grupper, keyframes: keyframes, framesDir: framesDir)
        let omfangene = utvid(grupper, deler: arkitDeler, keyframes: keyframes, framesDir: framesDir)
        var pauser = 0

        // FASE 1: geometri og poser per del (binding → TSDF → driftretting), nettet til disk.
        // Alle deler må være bundet før husets poser kan løses, og nettene holdes ikke i minnet.
        var bygde: [(n: Int, bilder: [MeshScanPresenter.Keyframe], nett: URL, gulv: Float?)] = []
        for (n, gruppe) in grupper.enumerated() {
            let id = gruppe[0].id
            pauser += ventPåTermikkOgMinne()
            ARMeshGlbExporter.progress?("Bygger geometri \(n + 1) av \(grupper.count)…")
            let o = omfangene[n]
            omfang = o
            let kf = keyframes.filter { o.nøkkelbilder.contains($0.index) }
            guard kf.count >= 3 else {
                MeshLog.log("hus — delkart \(id): bare \(kf.count) nøkkelbilder, hoppet over")
                continue
            }
            let tf = CFAbsoluteTimeGetCurrent()
            var tBind = 0.0
            let r = autoreleasepool { () -> (bilder: [MeshScanPresenter.Keyframe], nett: URL, gulv: Float?)? in
                let dir = DelkartLager.mappe(framesDir, id)
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var bilder = MeshBildebinding.bind(framesDir: framesDir, keyframes: kf)
                tBind = CFAbsoluteTimeGetCurrent() - tf
                var mesh = arkitDeler[n]
                if UserDefaults.standard.string(forKey: "meshscan.geometry") != "anchor",
                   FileManager.default.fileExists(atPath: framesDir.appendingPathComponent("dense.jsonl").path) {
                    var rettede = [Int: [Float]]()
                    if let t = MeshTsdfBuild.build(framesDir: framesDir, tillegg: mesh.indices.isEmpty ? nil : mesh,
                                                   poseSink: { rettede = $0 }) {
                        mesh = t
                    } else {
                        MeshLog.log("hus — delkart \(id): TSDF feilet, ARKit-nettet for delen")
                    }
                    bilder = MeshBakeV2.driftrettedeKeyframes(bilder, rettede)
                }
                guard !mesh.indices.isEmpty else { return nil }
                let url = dir.appendingPathComponent("nett.bin")
                do { try skrivNett(mesh, til: url) } catch {
                    MeshLog.log("hus — delkart \(id): nettet kunne ikke skrives: \(error.localizedDescription)"); return nil
                }
                return (bilder, url, gulvhøyde(mesh, kameraer: bilder))
            }
            // Fase 1 og fase 3 hver for seg: avgjør hva bake i bakgrunnen under skanning kan spare.
            MeshLog.log(String(format: "hus — delkart %d fase 1: %d nøkkelbilder (%d lånte), binding %.1f s, geometri %.1f s",
                               id, kf.count, kf.filter { k in !gruppe.contains { $0.nøkkelbilder.contains(k.index) } }.count,
                               tBind, CFAbsoluteTimeGetCurrent() - tf - tBind))
            if let r { bygde.append((n, r.bilder, r.nett, r.gulv)) }
        }
        omfang = nil
        guard !bygde.isEmpty else { MeshLog.log("hus — ingen delkart fikk geometri"); return nil }

        // FASE 2: husets poser i ett løp (loop closure + etasjer).
        ARMeshGlbExporter.progress?("Retter huset…")
        let G = løsHus(bygde.map { b in
            HusDel(id: grupper[b.n][0].id,
                   poser: Dictionary(b.bilder.compactMap { k in k.transform.count == 16 ? (k.index, matrise(k.transform)) : nil },
                                     uniquingKeysWith: { a, _ in a }),
                   gulv: b.gulv)
        })
        sisteLøsning = Dictionary(uniqueKeysWithValues: zip(bygde.map { grupper[$0.n][0].id }, G))

        // FASE 3: hver del flyttet inn i huset, klippet mot eldre deler og bakt.
        let eldre = Overflate()
        var deler: [(id: Int, glb: URL, kart: [DelkartKart])] = []
        var fylt: [Double] = []
        for (j, b) in bygde.enumerated() {
            let gruppe = grupper[b.n]
            let id = gruppe[0].id
            pauser += ventPåTermikkOgMinne()
            ARMeshGlbExporter.progress?("Bygger del \(j + 1) av \(bygde.count)…")
            let tg = CFAbsoluteTimeGetCurrent()
            omfang = omfangene[b.n]
            let ut = autoreleasepool { () -> (URL, Double?)? in
                guard var mesh = lesNett(b.nett) else { MeshLog.log("hus — delkart \(id): fant ikke nettet"); return nil }
                mesh = flytt(mesh, G[j])
                let bilder = flytt(b.bilder, G[j])
                let før = mesh.indices.count / 3
                let sveisetFør = eldre.sveiset, randFør = eldre.randvertekser
                mesh = eldre.klipp(mesh)
                let klippet = før - mesh.indices.count / 3
                guard !mesh.indices.isEmpty else {
                    MeshLog.log("hus — delkart \(id): ingenting igjen etter overlapp (\(før) trekanter lå i eldre delkart)")
                    return nil
                }
                eldre.legg(mesh)
                let url = DelkartLager.mappe(framesDir, id).appendingPathComponent("delkart-\(id).glb")
                let r = MeshBakeV2.bake(mesh: mesh, keyframes: bilder, framesDir: framesDir, to: url)
                MeshLog.log(String(format: "hus — delkart %d: %d bilder, %d trekanter (%d klippet mot eldre, %d av %d randvertekser sveiset), %.1f s, %@",
                                   id, bilder.count, mesh.indices.count / 3, klippet,
                                   eldre.sveiset - sveisetFør, eldre.randvertekser - randFør,
                                   CFAbsoluteTimeGetCurrent() - tg, r.success ? "ok" : "FEIL"))
                return r.success ? (url, r.filledFraction) : nil
            }
            try? FileManager.default.removeItem(at: b.nett)
            if let (url, f) = ut {
                deler.append((id, url, gruppe))
                if let f { fylt.append(f) }
            }
        }
        omfang = nil
        sisteSveis = (eldre.sveiset, eldre.randvertekser, eldre.flyttMaks)
        guard !deler.isEmpty else { MeshLog.log("hus — ingen delkart ble bakt"); return nil }

        ARMeshGlbExporter.progress?("Setter sammen huset…")
        do {
            try slåSammenGlb(deler.map { $0.glb }, til: glbURL)
        } catch {
            MeshLog.log("hus — sammenslåing feilet: \(error.localizedDescription)")
            return nil
        }
        slåSammenRelok(deler.map { MeshRelok.kartURL(glb: $0.glb) }, til: MeshRelok.kartURL(glb: glbURL))
        skrivHus(framesDir: framesDir, deler: deler, glb: glbURL)
        let snitt = fylt.isEmpty ? nil : fylt.reduce(0, +) / Double(fylt.count)
        MeshLog.log(String(format: "hus — ferdig: %d deler, %.1f s, %d termikk-/minnepauser → %@",
                           deler.count, CFAbsoluteTimeGetCurrent() - t0, pauser, glbURL.lastPathComponent))
        return ARMeshGlbExporter.TexturedExportResult(success: true, filledFraction: snitt, geometryPath: "delkart")
    }

    /// Husets løsning fra siste `bakHus` (del-id → G), til harnessen og loggen.
    static var sisteLøsning: [Int: simd_float4x4] = [:]
    /// Sveisingen fra siste `bakHus`: vertekser flyttet, randvertekser i alt, lengste flytt (m).
    static var sisteSveis: (sveiset: Int, rand: Int, maks: Float) = (0, 0, 0)

    // MARK: - Alle syn på delens flate

    /// Omfanget per gruppe: egne nøkkelbilder og dybdekart, PLUSS de fra andre delkart som ser
    /// gruppens flate. Uten dette fikk en runde tilbake gjennom rom som alt var skannet aldri
    /// gitt rommet sine bilder (8f3b8017: delkart 3 ligger 57 % inne i det delkart 0–2 så, og
    /// klippet mot dem fikk veggene bare første rundes bilder). Med dette får et rom de samme
    /// synene enten det bakes alene eller som del av et hus — krav 1.
    ///
    /// «Ser» er veiledningens regel: 10 cm-ruter av delens ARKit-flate innen 3,5 m, vendt mot
    /// kameraet (cos ≥ 0,35) og bekreftet av bildets egen LiDAR-dybde (±30 cm). Et bilde eller
    /// dybdekart tas med når det ser minst 30 ruter av delen og minst 20 % av alt det ser.
    /// Nøkkelbilder holdes under `meshscan.gruppemaks` (egne først, så de som ser mest).
    static func utvid(_ grupper: [[DelkartKart]], deler: [MeshBakeV2.MergedMesh],
                      keyframes: [MeshScanPresenter.Keyframe], framesDir: URL) -> [Omfang] {
        let t0 = CFAbsoluteTimeGetCurrent()
        let egneKF = grupper.map { Set($0.flatMap { $0.nøkkelbilder }) }
        let egneD = grupper.map { Set($0.flatMap { $0.dybdekart }) }
        let ruter = deler.map(Self.ruter)
        let maks = Int(MeshBakeV2.flaggTall("meshscan.gruppemaks", 450))

        /// Ruter av hver gruppe ett kamera ser.
        func ser(c2w: simd_float4x4, K: SIMD4<Float>, bw: Float, bh: Float,
                 dybde: [Float], dw: Int, dh: Int) -> [Int] {
            let w2c = c2w.inverse
            let kam = c2w.columns.3.xyz
            return ruter.map { r in
                var n = 0
                for (p, nrm) in r {
                    if simd_distance_squared(p, kam) > 12.25 { continue }
                    let pc = w2c * SIMD4(p, 1)
                    let z = -pc.z
                    if z < 0.05 || z > 3.5 { continue }
                    let u = K.x * (pc.x / z) + K.z, v = K.y * (-pc.y / z) + K.w
                    if u < 0 || v < 0 || u >= bw || v >= bh { continue }
                    if simd_dot(nrm, simd_normalize(kam - p)) < 0.35 { continue }
                    if dw > 0 {
                        let d = dybde[min(dh - 1, Int(v / bh * Float(dh))) * dw + min(dw - 1, Int(u / bw * Float(dw)))]
                        if !(d > 0.05 && abs(z - d) < 0.30) { continue }
                    }
                    n += 1
                }
                return n
            }
        }
        func med(_ syn: [Int], _ g: Int) -> Bool {
            let sum = syn.reduce(0, +)
            return syn[g] >= 30 && Double(syn[g]) >= 0.2 * Double(sum)
        }

        // Nøkkelbilder.
        var ekstraKF = [[(Int, Int)]](repeating: [], count: grupper.count)   // (indeks, ruter sett)
        for k in keyframes where k.transform.count == 16 && k.intrinsics.count == 4 {
            var dybde: [Float] = []
            if let f = k.depthFile, let d = try? Data(contentsOf: framesDir.appendingPathComponent(f)),
               d.count == k.depthWidth * k.depthHeight * 4 {
                dybde = d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            }
            let m = k.transform
            let c2w = simd_float4x4(columns: (SIMD4(m[0], m[1], m[2], m[3]), SIMD4(m[4], m[5], m[6], m[7]),
                                              SIMD4(m[8], m[9], m[10], m[11]), SIMD4(m[12], m[13], m[14], m[15])))
            let syn = ser(c2w: c2w, K: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                          bw: Float(k.width), bh: Float(k.height), dybde: dybde,
                          dw: dybde.isEmpty ? 0 : k.depthWidth, dh: k.depthHeight)
            for g in grupper.indices where !egneKF[g].contains(k.index) && med(syn, g) { ekstraKF[g].append((k.index, syn[g])) }
        }

        // Dybdekart (dense.jsonl: rå ARKit-poser, intrinsikk i kartets piksler).
        var ekstraD = [Set<Int>](repeating: [], count: grupper.count)
        if let txt = try? String(contentsOf: framesDir.appendingPathComponent("dense.jsonl"), encoding: .utf8) {
            for line in txt.split(separator: "\n") {
                guard let d = line.data(using: .utf8),
                      let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let i = o["i"] as? Int, let w = o["w"] as? Int, let h = o["h"] as? Int,
                      let fx = o["fx"] as? Double, let fy = o["fy"] as? Double,
                      let cx = o["cx"] as? Double, let cy = o["cy"] as? Double,
                      let mm = o["m"] as? [Double], mm.count == 16 else { continue }
                guard !egneD.allSatisfy({ $0.contains(i) }),
                      let dd = try? Data(contentsOf: framesDir.appendingPathComponent("dense-\(i).f32")), dd.count == w * h * 4
                else { continue }
                let dybde = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
                let f = mm.map { Float($0) }
                let c2w = simd_float4x4(columns: (SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]),
                                                  SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15])))
                let syn = ser(c2w: c2w, K: SIMD4(Float(fx), Float(fy), Float(cx), Float(cy)),
                              bw: Float(w), bh: Float(h), dybde: dybde, dw: w, dh: h)
                for g in grupper.indices where !egneD[g].contains(i) && med(syn, g) { ekstraD[g].insert(i) }
            }
        }

        var ut: [Omfang] = []
        for (g, gruppe) in grupper.enumerated() {
            let rom = max(0, maks - egneKF[g].count)
            let valgt = ekstraKF[g].sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }.prefix(rom).map { $0.0 }
            ut.append(Omfang(id: gruppe[0].id, dybdekart: egneD[g].union(ekstraD[g]), nøkkelbilder: egneKF[g].union(valgt)))
            MeshLog.log("hus — del \(gruppe[0].id): \(ruter[g].count) ruter; nøkkelbilder \(egneKF[g].count) egne + \(valgt.count) fra andre delkart" +
                        (valgt.count < ekstraKF[g].count ? " (\(ekstraKF[g].count - valgt.count) over taket)" : "") +
                        ", dybdekart \(egneD[g].count) + \(ekstraD[g].count)")
        }
        MeshLog.log(String(format: "hus — syn på delene funnet på %.1f s", CFAbsoluteTimeGetCurrent() - t0))
        return ut
    }

    /// Delens flate som 10 cm-ruter: snittet av trekantsentroidene og normalene i hver rute.
    static func ruter(_ m: MeshBakeV2.MergedMesh) -> [(SIMD3<Float>, SIMD3<Float>)] {
        var sum: [SIMD3<Int32>: (SIMD3<Float>, SIMD3<Float>, Float)] = [:]
        for t in 0..<(m.indices.count / 3) {
            var c = SIMD3<Float>(0, 0, 0), n = SIMD3<Float>(0, 0, 0)
            for j in 0..<3 {
                let v = Int(m.indices[t * 3 + j])
                c += SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
                if v * 3 + 2 < m.normals.count { n += SIMD3(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]) }
            }
            c /= 3
            let k = SIMD3<Int32>(Int32((c.x * 10).rounded(.down)), Int32((c.y * 10).rounded(.down)), Int32((c.z * 10).rounded(.down)))
            let e = sum[k] ?? (.zero, .zero, 0)
            sum[k] = (e.0 + c, e.1 + n, e.2 + 1)
        }
        return sum.keys.sorted { ($0.x, $0.y, $0.z) < ($1.x, $1.y, $1.z) }.compactMap { k in
            let e = sum[k]!
            let l = simd_length(e.1)
            return l > 1e-6 ? (e.0 / e.2, e.1 / l) : nil
        }
    }

    // MARK: - Husets poser: loop closure og etasjer

    struct HusDel {
        let id: Int
        let poser: [Int: simd_float4x4]   // nøkkelbilde → pose i delens egen verden (bundet, driftrettet)
        let gulv: Float?                  // gulvhøyden i delens verden, nil = ingen (trapp)
    }

    /// Hver del bindes og driftrettes for seg, så verdenene kan skille noen cm. Det er det som
    /// gir sprang i skjøter og trapp, og som flytter etasjene i forhold til hverandre (Glenns
    /// borevinkel). Løsningen tar alle delene i ett løp, så en runde tilbake retter også delene
    /// imellom (loop closure), ikke bare den siste.
    ///
    /// Ukjente per del: dreining θ om loddlinjen og forflytning t. Helning er ikke med: ARKit
    /// kjenner tyngden godt, og etasjene skal bli liggende vannrett. Første del ligger fast.
    /// Bånd:
    /// - Felles bilder (et lånt nøkkelbilde har pose i to deler): kamerasentrene skal falle
    ///   sammen (σ 1 cm) og dreiningen være lik (σ 0,2°).
    /// - Etasjer: deler med gulv innen 20 cm av hverandre står på samme gulv (σ 3 cm).
    /// - Svak forankring av hver del der den er (σ 1 m, 30°), så en del uten bånd blir stående.
    /// Linearisert rundt dagens løsning, tre runder, Huber på 3σ.
    static func løsHus(_ deler: [HusDel]) -> [simd_float4x4] {
        let N = deler.count
        var G = [simd_float4x4](repeating: matrix_identity_float4x4, count: N)
        guard N >= 2 else { return G }
        // Gulvbåndet er mykere enn bildene: rom på samme etasje kan ha ekte høydeforskjell (terskel,
        // bad). 8f3b8017 viser 40 mm mellom deler som felles bilder holder helt fast.
        let σp: Float = 0.01, σθ: Float = 0.2 * .pi / 180, σg: Float = 0.03
        // Felles bilder, par for par (a < b).
        var felles: [(a: Int, b: Int, k: [Int])] = []
        for a in 0..<N { for b in (a + 1)..<N {
            let k = deler[a].poser.keys.filter { deler[b].poser[$0] != nil }.sorted()
            if k.count >= 3 { felles.append((a, b, k)) }
        } }
        var etasjer: [(Int, Int)] = []
        for a in 0..<N { for b in (a + 1)..<N {
            if let ga = deler[a].gulv, let gb = deler[b].gulv, abs(ga - gb) < 0.2 { etasjer.append((a, b)) }
        } }

        @inline(__always) func yaw(_ m: simd_float4x4) -> Float {
            let q = simd_quatf(simd_float3x3(m.columns.0.xyz, m.columns.1.xyz, m.columns.2.xyz))
            return q.angle < 1e-7 ? 0 : (q.axis * q.angle).y
        }
        func rest() -> (p: [Float], g: [Float]) {
            var p: [Float] = [], g: [Float] = []
            for f in felles { for k in f.k {
                let ca = (G[f.a] * deler[f.a].poser[k]!).columns.3.xyz, cb = (G[f.b] * deler[f.b].poser[k]!).columns.3.xyz
                p.append(simd_distance(ca, cb))
            } }
            for (a, b) in etasjer { g.append(abs(deler[a].gulv! + G[a].columns.3.y - deler[b].gulv! - G[b].columns.3.y)) }
            return (p, g)
        }
        func beskriv(_ r: (p: [Float], g: [Float])) -> String {
            let p = r.p.sorted(), g = r.g.sorted()
            return String(format: "felles bilder median %.0f mm, maks %.0f mm; gulv maks %.0f mm",
                          p.isEmpty ? 0 : p[p.count / 2] * 1000, (p.last ?? 0) * 1000, (g.last ?? 0) * 1000)
        }
        let før = rest()

        let M = 4 * N
        for runde in 0..<3 {
            var A = [Double](repeating: 0, count: M * M), bv = [Double](repeating: 0, count: M)
            // Én likning: Σ c_i x_i = r, vekt w.
            func likning(_ c: [(Int, Float)], _ r: Float, _ σ: Float) {
                var w = 1 / Double(σ * σ)
                if runde > 0, abs(r) > 3 * σ { w *= Double(3 * σ / abs(r)) }   // Huber
                for (i, ci) in c { bv[i] += w * Double(ci) * Double(r)
                    for (j, cj) in c { A[i * M + j] += w * Double(ci) * Double(cj) } }
            }
            for f in felles {
                let ia = 4 * f.a, ib = 4 * f.b
                for k in f.k {
                    let Pa = G[f.a] * deler[f.a].poser[k]!, Pb = G[f.b] * deler[f.b].poser[k]!
                    let ca = Pa.columns.3.xyz, cb = Pb.columns.3.xyz
                    // R_y(δθ)·c ≈ c + δθ·(c.z, 0, −c.x)
                    let r = cb - ca
                    likning([(ia, ca.z), (ia + 1, 1), (ib, -cb.z), (ib + 1, -1)], r.x, σp)
                    likning([(ia + 2, 1), (ib + 2, -1)], r.y, σp)
                    likning([(ia, -ca.x), (ia + 3, 1), (ib, cb.x), (ib + 3, -1)], r.z, σp)
                    likning([(ia, 1), (ib, -1)], yaw(Pb * Pa.inverse), σθ)
                }
            }
            for (a, b) in etasjer {
                let r = (deler[b].gulv! + G[b].columns.3.y) - (deler[a].gulv! + G[a].columns.3.y)
                likning([(4 * a + 2, 1), (4 * b + 2, -1)], r, σg)
            }
            for p in 0..<N {
                likning([(4 * p, 1)], 0, 0.5); likning([(4 * p + 1, 1)], 0, 1)
                likning([(4 * p + 2, 1)], 0, 1); likning([(4 * p + 3, 1)], 0, 1)
            }
            // Første del ligger fast.
            for i in 0..<4 { for j in 0..<M { A[i * M + j] = 0; A[j * M + i] = 0 }; A[i * M + i] = 1; bv[i] = 0 }
            guard let x = løs(A, bv, M) else { MeshLog.log("hus — poseløsningen var singulær, delene står der de er"); break }
            for p in 1..<N {
                let δ = simd_float4x4(simd_quatf(angle: Float(x[4 * p]), axis: SIMD3(0, 1, 0)))
                var D = δ; D.columns.3 = SIMD4(Float(x[4 * p + 1]), Float(x[4 * p + 2]), Float(x[4 * p + 3]), 1)
                G[p] = D * G[p]
            }
        }
        let etter = rest()
        MeshLog.log("hus — poseløsning: \(N) deler, \(felles.count) par med felles bilder, \(etasjer.count) gulvpar. Før: \(beskriv(før)). Etter: \(beskriv(etter))")
        for p in 1..<N {
            let t = G[p].columns.3.xyz
            MeshLog.log(String(format: "hus — del %d flyttet %.2f° om loddlinjen, (%.0f, %.0f, %.0f) mm", deler[p].id,
                               yaw(G[p]) * 180 / .pi, t.x * 1000, t.y * 1000, t.z * 1000))
        }
        return G
    }

    /// Ax = b for symmetrisk positiv definitt A (Cholesky). nil hvis singulær.
    static func løs(_ A: [Double], _ b: [Double], _ n: Int) -> [Double]? {
        var L = [Double](repeating: 0, count: n * n)
        for i in 0..<n { for j in 0...i {
            var s = A[i * n + j]
            for k in 0..<j { s -= L[i * n + k] * L[j * n + k] }
            if i == j { guard s > 1e-12 else { return nil }; L[i * n + i] = s.squareRoot() } else { L[i * n + j] = s / L[j * n + j] }
        } }
        var y = [Double](repeating: 0, count: n)
        for i in 0..<n { var s = b[i]; for k in 0..<i { s -= L[i * n + k] * y[k] }; y[i] = s / L[i * n + i] }
        var x = [Double](repeating: 0, count: n)
        for i in stride(from: n - 1, through: 0, by: -1) { var s = y[i]; for k in (i + 1)..<n { s -= L[k * n + i] * x[k] }; x[i] = s / L[i * n + i] }
        return x
    }

    /// Gulvet under kameraene: høyden med mest oppovervendt flate (2 cm-bøtter, ±3 cm vindu)
    /// mellom 0,8 og 2,2 m under kameraenes median. Under 2 m² slik flate (trapp) gir nil.
    static func gulvhøyde(_ m: MeshBakeV2.MergedMesh, kameraer: [MeshScanPresenter.Keyframe]) -> Float? {
        let ys = kameraer.compactMap { $0.transform.count == 16 ? $0.transform[13] : nil }.sorted()
        guard !ys.isEmpty else { return nil }
        let kam = ys[ys.count / 2]
        var bøtte = [Int: Float]()
        for t in 0..<(m.indices.count / 3) {
            let v = (0..<3).map { j -> SIMD3<Float> in
                let i = Int(m.indices[t * 3 + j]); return SIMD3(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2])
            }
            let kryss = simd_cross(v[1] - v[0], v[2] - v[0])
            let areal = simd_length(kryss) / 2
            guard areal > 0, kryss.y / (2 * areal) > 0.9 else { continue }
            let y = (v[0].y + v[1].y + v[2].y) / 3
            guard y < kam - 0.8, y > kam - 2.2 else { continue }
            bøtte[Int((y / 0.02).rounded(.down)), default: 0] += areal
        }
        var best: (Int, Float) = (0, 0)
        for (b, _) in bøtte {
            let a = (b - 1...b + 1).reduce(Float(0)) { $0 + (bøtte[$1] ?? 0) }
            if a > best.1 || (a == best.1 && b < best.0) { best = (b, a) }
        }
        return best.1 >= 2 ? (Float(best.0) + 0.5) * 0.02 : nil
    }

    // MARK: - Nettet til disk mellom fasene

    static func skrivNett(_ m: MeshBakeV2.MergedMesh, til url: URL) throws {
        var d = Data()
        func u32(_ v: Int) { withUnsafeBytes(of: UInt32(v)) { d.append(contentsOf: $0) } }
        func legg<T>(_ a: [T]) { u32(a.count); a.withUnsafeBytes { d.append(contentsOf: $0) } }
        d.append(contentsOf: Array("HNT1".utf8))
        legg(m.positions); legg(m.normals); legg(m.indices); legg(m.triAnchor); legg(m.planes); legg(m.faceClass)
        u32(m.planeLock ? 1 : 0)
        try d.write(to: url, options: .atomic)
    }

    static func lesNett(_ url: URL) -> MeshBakeV2.MergedMesh? {
        guard let d = try? Data(contentsOf: url), d.count >= 8, String(decoding: d.prefix(4), as: UTF8.self) == "HNT1" else { return nil }
        var o = 4
        func u32() -> Int? {
            guard o + 4 <= d.count else { return nil }
            defer { o += 4 }
            return Int(d.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: o, as: UInt32.self) })
        }
        func les<T>(_: T.Type) -> [T]? {
            guard let n = u32(), o + n * MemoryLayout<T>.stride <= d.count else { return nil }
            defer { o += n * MemoryLayout<T>.stride }
            return d.subdata(in: o..<(o + n * MemoryLayout<T>.stride)).withUnsafeBytes { Array($0.bindMemory(to: T.self)) }
        }
        guard let p = les(Float.self), let n = les(Float.self), let i = les(UInt32.self), let ta = les(UInt32.self),
              let pl = les(SIMD4<Float>.self), let fc = les(UInt8.self), let lås = u32() else { return nil }
        var m = MeshBakeV2.MergedMesh(positions: p, normals: n, indices: i, triAnchor: ta)
        m.planes = pl; m.faceClass = fc; m.planeLock = lås != 0
        return m
    }

    static func matrise(_ m: [Float]) -> simd_float4x4 {
        simd_float4x4(columns: (SIMD4(m[0], m[1], m[2], m[3]), SIMD4(m[4], m[5], m[6], m[7]),
                                SIMD4(m[8], m[9], m[10], m[11]), SIMD4(m[12], m[13], m[14], m[15])))
    }

    /// Nettet flyttet med G: posisjoner, normaler og dominantplanene (n·x = w).
    static func flytt(_ m: MeshBakeV2.MergedMesh, _ G: simd_float4x4) -> MeshBakeV2.MergedMesh {
        var ut = m
        let R = simd_float3x3(G.columns.0.xyz, G.columns.1.xyz, G.columns.2.xyz), t = G.columns.3.xyz
        for v in 0..<(m.positions.count / 3) {
            let p = R * SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]) + t
            ut.positions[v * 3] = p.x; ut.positions[v * 3 + 1] = p.y; ut.positions[v * 3 + 2] = p.z
        }
        for v in 0..<(m.normals.count / 3) {
            let n = R * SIMD3(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2])
            ut.normals[v * 3] = n.x; ut.normals[v * 3 + 1] = n.y; ut.normals[v * 3 + 2] = n.z
        }
        ut.planes = m.planes.map { pl in
            let n = R * SIMD3(pl.x, pl.y, pl.z)
            return SIMD4(n, pl.w + simd_dot(n, t))
        }
        return ut
    }

    static func flytt(_ k: [MeshScanPresenter.Keyframe], _ G: simd_float4x4) -> [MeshScanPresenter.Keyframe] {
        k.map { k0 in
            guard k0.transform.count == 16 else { return k0 }
            var k1 = k0
            k1.transform = DelkartLager.flat(G * matrise(k0.transform))
            return k1
        }
    }

    // MARK: - Termikk og minne: vent, aldri endre en parameter

    /// Antall pauser. Varm telefon venter (5 s om gangen) til den er under serious, høyst 5 min;
    /// lite minne venter høyst 1 min (ved Ferdig er det ingenting annet som slipper minne).
    static func ventPåTermikkOgMinne() -> Int {
        var n = 0
        let start = CFAbsoluteTimeGetCurrent()
        while CFAbsoluteTimeGetCurrent() - start < 300 {
            let t = ProcessInfo.processInfo.thermalState
            let varm = t == .serious || t == .critical
            let liteMinne = MeshSimMem.available() < 400 * 1024 * 1024 && CFAbsoluteTimeGetCurrent() - start < 60
            if !varm && !liteMinne { break }
            if n == 0 { MeshLog.log("bake — pause \(varm ? "termikk \(t.rawValue)" : "minne \(MeshSimMem.available() / 1_048_576) MB")") }
            n += 1
            Thread.sleep(forTimeInterval: 5)
        }
        return n
    }

    // MARK: - ARKit-nettet for én del

    /// ARKit-nettet fordelt på bakegruppene. En trekant går til hver gruppe som har allokert
    /// blokken sentroiden ligger i (overlappet klippes etterpå). Uten dette ville hver del fått
    /// hele husets ARKit-nett som tillegg der TSDF-en mangler flate, og lagt sin grove kopi oppå
    /// naboens. Trekanter utenfor ALLE blokker (11,7 % i trappeskannet c1794d71: ARKit så lenger
    /// enn live-fusjonen tok med) går til gruppen med nærmeste nøkkelbildekamera — den globale
    /// baken tok dem med, og det skal ikke gå tapt.
    static func fordel(_ m: MeshBakeV2.MergedMesh, på grupper: [[DelkartKart]],
                       keyframes: [MeshScanPresenter.Keyframe], framesDir: URL) -> [MeshBakeV2.MergedMesh] {
        struct Del { let g: Int; let w2d: simd_float4x4; let lo: SIMD3<Float>; let b: Float; let blokker: Set<SIMD3<Int32>> }
        var deler: [Del] = []
        for (gi, gruppe) in grupper.enumerated() {
            for k in gruppe {
                guard k.T.count == 16, k.lo.count == 3, let bl = lesBlokker(framesDir, k.id) else { continue }
                let t = k.T
                let T = simd_float4x4(columns: (SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]),
                                                SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15])))
                deler.append(Del(g: gi, w2d: T.inverse, lo: SIMD3(k.lo[0], k.lo[1], k.lo[2]), b: k.vox * 8, blokker: bl))
            }
        }
        var kameraer: [(SIMD3<Float>, Int)] = []
        for (gi, gruppe) in grupper.enumerated() {
            let idx = Set(gruppe.flatMap { $0.nøkkelbilder })
            for k in keyframes where k.transform.count == 16 && idx.contains(k.index) {
                kameraer.append((SIMD3(k.transform[12], k.transform[13], k.transform[14]), gi))
            }
        }
        var ut = [MeshBakeV2.MergedMesh](repeating: m, count: grupper.count)
        for i in ut.indices { ut[i].indices = []; ut[i].triAnchor = []; ut[i].faceClass = [] }
        var utenfor = 0
        for t in 0..<(m.indices.count / 3) {
            var c = SIMD3<Float>(0, 0, 0)
            for j in 0..<3 {
                let v = Int(m.indices[t * 3 + j])
                c += SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
            }
            c /= 3
            var hvem = [Bool](repeating: false, count: grupper.count)
            var noen = false
            for d in deler where !hvem[d.g] {
                let p = (d.w2d * SIMD4(c, 1)).xyz - d.lo
                let b = SIMD3<Int32>(Int32((p.x / d.b).rounded(.down)), Int32((p.y / d.b).rounded(.down)), Int32((p.z / d.b).rounded(.down)))
                if d.blokker.contains(b) { hvem[d.g] = true; noen = true }
            }
            if !noen {
                var best = Float.greatestFiniteMagnitude, bg = -1
                for (p, g) in kameraer { let d = simd_distance_squared(p, c); if d < best { best = d; bg = g } }
                guard bg >= 0 else { continue }
                hvem[bg] = true; utenfor += 1
            }
            for g in 0..<grupper.count where hvem[g] {
                ut[g].indices.append(contentsOf: m.indices[(t * 3)..<(t * 3 + 3)])
                if t < m.triAnchor.count { ut[g].triAnchor.append(m.triAnchor[t]) }
                if t < m.faceClass.count { ut[g].faceClass.append(m.faceClass[t]) }
            }
        }
        MeshLog.log("hus — ARKit-nettet: \(m.indices.count / 3) trekanter fordelt, \(utenfor) utenfor alle delkart gitt til nærmeste kamera")
        return ut
    }

    /// Blokkoordinatene fra `delkart/N/blokker.bin` (se `DelkartLager.skriv`).
    static func lesBlokker(_ framesDir: URL, _ id: Int) -> Set<SIMD3<Int32>>? {
        let url = DelkartLager.mappe(framesDir, id).appendingPathComponent("blokker.bin")
        guard let h = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? h.close() }
        guard let hode = try? h.read(upToCount: 8), hode.count == 8,
              String(decoding: hode.prefix(4), as: UTF8.self) == "DKB1" else { return nil }
        let n = Int(hode.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: Int32.self) })
        guard n > 0, let k = try? h.read(upToCount: n * 16), k.count == n * 16 else { return nil }
        var s = Set<SIMD3<Int32>>(minimumCapacity: n)
        k.withUnsafeBytes { p in
            for i in 0..<n {
                s.insert(SIMD3(p.loadUnaligned(fromByteOffset: i * 16, as: Int32.self),
                               p.loadUnaligned(fromByteOffset: i * 16 + 4, as: Int32.self),
                               p.loadUnaligned(fromByteOffset: i * 16 + 8, as: Int32.self)))
            }
        }
        return s
    }

    // MARK: - Enkel sveising: eldre delkart vinner overlappet

    /// Flaten til delkartene som alt er bakt, som 2 cm-celler (hjørnene og trekantenes
    /// sentroider; surface nets på 20 mm legger hjørnene ~2 cm fra hverandre, men ARKit-tillegget
    /// har trekanter på 15 cm der bare sentroiden treffer). En trekant regnes som «i eldre
    /// flate» når sentroiden har et punkt i en av de 27 nabocellene, altså innen ~2 voxler.
    final class Overflate {
        static let celle: Float = 0.02
        /// Hvor langt en randvertex kan flyttes for å lukke skjøten. Klippet fjerner trekanter
        /// med sentroide inntil ~4 cm fra eldre flate, så den nye randen ligger 2–6 cm unna.
        static let sveis: Float = 0.06
        private var celler = Set<SIMD3<Int32>>()
        /// Eldre TREKANTER per celle (alle cellene flaten går gjennom), til sveisingen av randen.
        /// Først lå bare hjørnene her. Forenklingen gir gulv og vegger store trekanter med
        /// hjørner 10–20 cm fra hverandre, så nærmeste hjørne lå ofte utenfor `sveis`; 13–15 %
        /// av randen ble aldri sveiset, og skjøten viste seg som en rød strek i gulvet (01.11).
        private var trekanter: [(a: SIMD3<Float>, b: SIMD3<Float>, c: SIMD3<Float>, n: SIMD3<Float>)] = []
        private var iCelle: [SIMD3<Int32>: [Int32]] = [:]
        private(set) var sveiset = 0, randvertekser = 0
        private(set) var flyttMaks: Float = 0

        private static func c(_ p: SIMD3<Float>) -> SIMD3<Int32> {
            SIMD3(Int32((p.x / celle).rounded(.down)), Int32((p.y / celle).rounded(.down)), Int32((p.z / celle).rounded(.down)))
        }

        private static func normal(_ m: MeshBakeV2.MergedMesh, _ v: Int) -> SIMD3<Float> {
            guard m.normals.count >= v * 3 + 3 else { return .zero }
            let n = SIMD3(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2])
            return n.x.isFinite && n.y.isFinite && n.z.isFinite ? n : .zero
        }

        /// Cellene en trekant går gjennom: flaten samples tettere enn cellen, så en stor
        /// gulvtrekant dekker hele sin flate og ikke bare hjørnene og sentroiden.
        private static func flateceller(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>) -> Set<SIMD3<Int32>> {
            let lengst = max(simd_length(b - a), simd_length(c - a), simd_length(c - b))
            let n = max(1, min(400, Int((lengst / (celle * 0.5)).rounded(.up))))
            var ut = Set<SIMD3<Int32>>()
            for i in 0...n { for j in 0...(n - i) {
                let u = Float(i) / Float(n), v = Float(j) / Float(n)
                ut.insert(Self.c(a + (b - a) * u + (c - a) * v))
            } }
            return ut
        }

        func legg(_ m: MeshBakeV2.MergedMesh) {
            for t in 0..<(m.indices.count / 3) {
                let p = (0..<3).map { j -> SIMD3<Float> in
                    let v = Int(m.indices[t * 3 + j])
                    return SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
                }
                guard p.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }) else { continue }
                let kryss = simd_cross(p[1] - p[0], p[2] - p[0])
                let l = simd_length(kryss)
                guard l > 1e-10 else { continue }
                let id = Int32(trekanter.count)
                trekanter.append((p[0], p[1], p[2], kryss / l))
                for k in Self.flateceller(p[0], p[1], p[2]) {
                    celler.insert(k)
                    iCelle[k, default: []].append(id)
                }
            }
        }

        /// Nærmeste punkt på trekanten (Ericson, Real-Time Collision Detection 5.1.5).
        private static func nærmest(_ p: SIMD3<Float>, _ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>) -> SIMD3<Float> {
            let ab = b - a, ac = c - a, ap = p - a
            let d1 = simd_dot(ab, ap), d2 = simd_dot(ac, ap)
            if d1 <= 0 && d2 <= 0 { return a }
            let bp = p - b, d3 = simd_dot(ab, bp), d4 = simd_dot(ac, bp)
            if d3 >= 0 && d4 <= d3 { return b }
            let vc = d1 * d4 - d3 * d2
            if vc <= 0 && d1 >= 0 && d3 <= 0 { return a + ab * (d1 / (d1 - d3)) }
            let cp = p - c, d5 = simd_dot(ab, cp), d6 = simd_dot(ac, cp)
            if d6 >= 0 && d5 <= d6 { return c }
            let vb = d5 * d2 - d1 * d6
            if vb <= 0 && d2 >= 0 && d6 <= 0 { return a + ac * (d2 / (d2 - d6)) }
            let va = d3 * d6 - d5 * d4
            if va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0 { return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6))) }
            let den = 1 / (va + vb + vc)
            return a + ab * (vb * den) + ac * (vc * den)
        }

        /// Fjerner trekantene som ligger i eldre flate, og SVEISER randen klippet lager: hver
        /// vertex på en kant der en kept og en klippet trekant møttes, flyttes til nærmeste
        /// eldre vertex innen `sveis` med normal på samme side. Randen som fantes fra før
        /// (vinduer, kanten av det skannede) røres ikke.
        func klipp(_ m: MeshBakeV2.MergedMesh) -> MeshBakeV2.MergedMesh {
            guard !celler.isEmpty else { return m }
            let nT = m.indices.count / 3
            var behold = [Bool](repeating: true, count: nT)
            for t in 0..<nT {
                var s = SIMD3<Float>(0, 0, 0)
                for j in 0..<3 {
                    let v = Int(m.indices[t * 3 + j])
                    s += SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
                }
                let k = Self.c(s / 3)
                // Bare cellen selv, ikke de 26 naboene (§135): med naboene ble den nye delen klippet
                // 2–4 cm før den eldre flaten begynte, og skjøten var en rød strek. Nå overlapper
                // delene med inntil én celle. Simulator: hull 5,6 → 5,2 % median, trapp 11,7 → 10,8.
                let nr = Int(MeshBakeV2.flaggTall("meshscan.klippnabo", 0))
                søk: for dz in -nr...nr { for dy in -nr...nr { for dx in -nr...nr
                    where celler.contains(k &+ SIMD3(Int32(dx), Int32(dy), Int32(dz))) { behold[t] = false; break søk } } }
            }
            // Kanter brukt av en klippet trekant; de beholdte trekantenes kanter i dette settet er
            // den nye randen. Kantene nøkles på POSISJON (0,5 mm), ikke indeks: TSDF-nettet på
            // telefonen har doble hjørner langs UV-blokkene og etter forenklingen (102 k hjørner
            // på 126 k trekanter i c1794d71), så en klippet og en beholdt nabo delte sjelden en
            // indeks, og sveisingen fant 0 randvertekser (30.10). Mac-testen brukte ARKit-nettet.
            let nV = m.positions.count / 3
            var nøkkel = [SIMD3<Int32>](repeating: .zero, count: nV)
            for v in 0..<nV {
                let q = SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]) / 0.0005
                // NaN/uendelig får en egen nøkkel per hjørne (aldri delt), aldri en Int32-felle.
                nøkkel[v] = q.x.isFinite && q.y.isFinite && q.z.isFinite && simd_reduce_max(simd_abs(q)) < 2e9
                    ? SIMD3<Int32>(q.rounded(.toNearestOrEven)) : SIMD3(Int32.min, Int32.min, Int32(truncatingIfNeeded: v))
            }
            struct Kant: Hashable { let a: SIMD3<Int32>, b: SIMD3<Int32> }
            func kant(_ i: UInt32, _ j: UInt32) -> Kant {
                let a = nøkkel[Int(i)], b = nøkkel[Int(j)]
                return (a.x, a.y, a.z) < (b.x, b.y, b.z) ? Kant(a: a, b: b) : Kant(a: b, b: a)
            }
            var klippetKant = Set<Kant>()
            for t in 0..<nT where !behold[t] {
                let i = m.indices[t * 3], j = m.indices[t * 3 + 1], l = m.indices[t * 3 + 2]
                klippetKant.insert(kant(i, j)); klippetKant.insert(kant(j, l)); klippetKant.insert(kant(l, i))
            }
            var randNøkler = Set<SIMD3<Int32>>()
            for t in 0..<nT where behold[t] {
                let i = m.indices[t * 3], j = m.indices[t * 3 + 1], l = m.indices[t * 3 + 2]
                for (a, b) in [(i, j), (j, l), (l, i)] where klippetKant.contains(kant(a, b)) {
                    randNøkler.insert(nøkkel[Int(a)]); randNøkler.insert(nøkkel[Int(b)])
                }
            }
            // Alle kopier av et randhjørne flyttes likt, ellers åpner sveisingen en sprekk.
            var rand = Set<UInt32>()
            for t in 0..<nT where behold[t] {
                for j in 0..<3 where randNøkler.contains(nøkkel[Int(m.indices[t * 3 + j])]) { rand.insert(m.indices[t * 3 + j]) }
            }
            var ut = m
            var flyttet = Set<UInt32>()
            let r = Int32((Self.sveis / Self.celle).rounded(.up))
            for v in rand {
                let vi = Int(v)
                let p = SIMD3(m.positions[vi * 3], m.positions[vi * 3 + 1], m.positions[vi * 3 + 2])
                let n = Self.normal(m, vi)
                let k = Self.c(p)
                var best: SIMD3<Float>? = nil, bd = Self.sveis * Self.sveis
                var sett = Set<Int32>()
                for dz in -r...r { for dy in -r...r { for dx in -r...r {
                    guard let liste = iCelle[k &+ SIMD3(dx, dy, dz)] else { continue }
                    for id in liste where sett.insert(id).inserted {
                        let tri = trekanter[Int(id)]
                        // Trekantens normal har ingen fast side (TSDF-nettets vinding følger flaten
                        // fra kameraet), så samme LINJE holder: |dot| ≥ 0,5.
                        if n != .zero && abs(simd_dot(n, tri.n)) < 0.5 { continue }
                        let q = Self.nærmest(p, tri.a, tri.b, tri.c)
                        let d = simd_length_squared(q - p)
                        if d < bd { bd = d; best = q }
                    }
                } } }
                guard let b = best else { continue }
                ut.positions[vi * 3] = b.x; ut.positions[vi * 3 + 1] = b.y; ut.positions[vi * 3 + 2] = b.z
                sveiset += 1
                flyttet.insert(v)
                flyttMaks = max(flyttMaks, bd.squareRoot())
            }
            randvertekser += rand.count
            ut.indices = []; ut.triAnchor = []; ut.faceClass = []
            ut.indices.reserveCapacity(m.indices.count)
            for t in 0..<nT where behold[t] {
                // En trekant der alle hjørnene ble sveiset, ligger i eldre flate; en der to
                // hjørner havnet i samme punkt, er borte.
                if flyttet.contains(m.indices[t * 3]) && flyttet.contains(m.indices[t * 3 + 1])
                    && flyttet.contains(m.indices[t * 3 + 2]) { continue }
                let i = Int(m.indices[t * 3]), j = Int(m.indices[t * 3 + 1]), l = Int(m.indices[t * 3 + 2])
                let pi = SIMD3(ut.positions[i * 3], ut.positions[i * 3 + 1], ut.positions[i * 3 + 2])
                let pj = SIMD3(ut.positions[j * 3], ut.positions[j * 3 + 1], ut.positions[j * 3 + 2])
                let pl = SIMD3(ut.positions[l * 3], ut.positions[l * 3 + 1], ut.positions[l * 3 + 2])
                if simd_length_squared(simd_cross(pj - pi, pl - pi)) < 1e-14 { continue }
                ut.indices.append(contentsOf: m.indices[(t * 3)..<(t * 3 + 3)])
                if t < m.triAnchor.count { ut.triAnchor.append(m.triAnchor[t]) }
                if t < m.faceClass.count { ut.faceClass.append(m.faceClass[t]) }
            }
            return ut
        }
    }

    // MARK: - Sammenslåing

    /// Én GLB av flere: alle primitivene i ett mesh, buffervisninger, aksessorer, bilder,
    /// teksturer og materialer forskjøvet. Hver del beholder sine egne fliser, og hver primitiv
    /// får `extras.del` (rekkefølgen i `filer`), så vieweren kan gi rommet du står i full
    /// tekstur (`TeksturLod`).
    static func slåSammenGlb(_ filer: [URL], til url: URL) throws {
        var bin = Data()
        var views: [[String: Any]] = [], accessors: [[String: Any]] = [], images: [[String: Any]] = []
        var textures: [[String: Any]] = [], materials: [[String: Any]] = [], primitives: [[String: Any]] = []
        var samplers: [[String: Any]] = []
        for (delNr, f) in filer.enumerated() {
            let (json, del) = try lesGlb(f)
            let vO = views.count, aO = accessors.count, iO = images.count, tO = textures.count
            let mO = materials.count, sO = samplers.count
            let binO = bin.count
            bin.append(del)
            while bin.count % 4 != 0 { bin.append(0) }
            for var v in json["bufferViews"] as? [[String: Any]] ?? [] {
                v["byteOffset"] = (v["byteOffset"] as? Int ?? 0) + binO
                v["buffer"] = 0
                views.append(v)
            }
            for var a in json["accessors"] as? [[String: Any]] ?? [] {
                if let b = a["bufferView"] as? Int { a["bufferView"] = b + vO }
                accessors.append(a)
            }
            for var i in json["images"] as? [[String: Any]] ?? [] {
                if let b = i["bufferView"] as? Int { i["bufferView"] = b + vO }
                images.append(i)
            }
            samplers += json["samplers"] as? [[String: Any]] ?? []
            for var t in json["textures"] as? [[String: Any]] ?? [] {
                if let s = t["source"] as? Int { t["source"] = s + iO }
                if let s = t["sampler"] as? Int { t["sampler"] = s + sO }
                textures.append(t)
            }
            for var m in json["materials"] as? [[String: Any]] ?? [] {
                if var pbr = m["pbrMetallicRoughness"] as? [String: Any],
                   var bc = pbr["baseColorTexture"] as? [String: Any], let i = bc["index"] as? Int {
                    bc["index"] = i + tO; pbr["baseColorTexture"] = bc; m["pbrMetallicRoughness"] = pbr
                }
                materials.append(m)
            }
            for mesh in json["meshes"] as? [[String: Any]] ?? [] {
                for var p in mesh["primitives"] as? [[String: Any]] ?? [] {
                    if var at = p["attributes"] as? [String: Int] {
                        for (k, v) in at { at[k] = v + aO }
                        p["attributes"] = at
                    }
                    if let i = p["indices"] as? Int { p["indices"] = i + aO }
                    if let m = p["material"] as? Int { p["material"] = m + mO }
                    p["extras"] = ["del": delNr]
                    primitives.append(p)
                }
            }
        }
        guard !primitives.isEmpty else { throw NSError(domain: "ampex.hus", code: 1) }
        var json: [String: Any] = [
            "asset": ["version": "2.0", "generator": "Ampex hus (delkart)"],
            "scene": 0, "scenes": [["nodes": [0]]], "nodes": [["mesh": 0]],
            "meshes": [["primitives": primitives]],
            "accessors": accessors, "bufferViews": views,
            "buffers": [["byteLength": bin.count]],
        ]
        if !materials.isEmpty { json["materials"] = materials }
        if !textures.isEmpty { json["textures"] = textures }
        if !images.isEmpty { json["images"] = images }
        if !samplers.isEmpty { json["samplers"] = samplers }
        var jd = try JSONSerialization.data(withJSONObject: json)
        while jd.count % 4 != 0 { jd.append(0x20) }
        var ut = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { ut.append(contentsOf: $0) } }
        u32(0x46546C67); u32(2); u32(UInt32(12 + 8 + jd.count + 8 + bin.count))
        u32(UInt32(jd.count)); u32(0x4E4F534A); ut.append(jd)
        u32(UInt32(bin.count)); u32(0x004E4942); ut.append(bin)
        try ut.write(to: url, options: .atomic)
    }

    static func lesGlb(_ url: URL) throws -> ([String: Any], Data) {
        let d = try Data(contentsOf: url)
        func u32(_ o: Int) -> Int { Int(d.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: o, as: UInt32.self) }) }
        guard d.count >= 28, u32(0) == 0x46546C67 else { throw NSError(domain: "ampex.hus", code: 2) }
        let jl = u32(12)
        guard u32(16) == 0x4E4F534A, d.count >= 20 + jl,
              let json = try JSONSerialization.jsonObject(with: d.subdata(in: 20..<(20 + jl))) as? [String: Any]
        else { throw NSError(domain: "ampex.hus", code: 3) }
        var bin = Data()
        let bo = 20 + jl
        if d.count >= bo + 8, u32(bo + 4) == 0x004E4942 {
            let bl = u32(bo)
            if d.count >= bo + 8 + bl { bin = d.subdata(in: (bo + 8)..<(bo + 8 + bl)) }
        }
        return (json, bin)
    }

    /// RLK1-kartene etter hverandre (alle i samme verden). Etikettene forskyves så to
    /// landemerker fra ulike delkart aldri regnes som det samme. Linsen fra det første.
    static func slåSammenRelok(_ filer: [URL], til url: URL) {
        var lab: [UInt32] = [], xyz = Data(), desc = Data()
        var linse: Data?
        for f in filer {
            guard let d = try? Data(contentsOf: f), d.count >= 20, String(decoding: d.prefix(4), as: UTF8.self) == "RLK1" else { continue }
            let n = Int(d.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self) })
            guard n > 0, d.count >= 20 + n * 144 else { continue }
            if linse == nil { linse = d.subdata(in: 8..<20) }
            let forskyv = (lab.max() ?? 0) &+ (lab.isEmpty ? 0 : 1)
            d.withUnsafeBytes { p in
                for i in 0..<n { lab.append(p.loadUnaligned(fromByteOffset: 20 + i * 4, as: UInt32.self) &+ forskyv) }
            }
            xyz.append(d.subdata(in: (20 + n * 4)..<(20 + n * 16)))
            desc.append(d.subdata(in: (20 + n * 16)..<(20 + n * 144)))
        }
        try? FileManager.default.removeItem(at: url)
        guard let linse, !lab.isEmpty else { return }
        var o = Data(); o.reserveCapacity(20 + lab.count * 144)
        o.append(contentsOf: Array("RLK1".utf8))
        withUnsafeBytes(of: UInt32(lab.count)) { o.append(contentsOf: $0) }
        o.append(linse)
        lab.withUnsafeBytes { o.append(contentsOf: $0) }
        o.append(xyz); o.append(desc)
        try? o.write(to: url, options: .atomic)
        MeshLog.log("relok: hus-kart \(lab.count) punkter fra \(filer.count) delkart (\(o.count / 1024) kB)")
    }

    // MARK: - hus.json

    struct HusManifest: Codable {
        struct Del: Codable { var id: Int; var delkart: [Int]; var glb: String; var relok: String; var T: [Float]; var etasje: Int }
        var v = 1
        var glb: String
        var deler: [Del]
    }

    /// Delene i samme verden som skannet (T = identitet): baken bruker ARKits poser rettet av
    /// bindingen og driftrettingen per del. Posegrafen i M3 skriver nye T her uten ny bake.
    static func skrivHus(framesDir: URL, deler: [(id: Int, glb: URL, kart: [DelkartKart])], glb: URL) {
        func rel(_ u: URL) -> String {
            let p = u.path, r = framesDir.path + "/"
            return p.hasPrefix(r) ? String(p.dropFirst(r.count)) : p
        }
        let m = HusManifest(glb: rel(glb), deler: deler.map {
            .init(id: $0.id, delkart: $0.kart.map { $0.id }, glb: rel($0.glb), relok: rel(MeshRelok.kartURL(glb: $0.glb)),
                  T: DelkartLager.flat(matrix_identity_float4x4), etasje: 0)
        })
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let d = try? enc.encode(m) { try? d.write(to: framesDir.appendingPathComponent("hus.json"), options: .atomic) }
    }
}
