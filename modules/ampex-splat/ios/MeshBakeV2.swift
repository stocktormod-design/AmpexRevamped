import Foundation
import ARKit
import Metal
import CoreGraphics
import os // os_proc_available_memory — ekte headroom fra OS-et, ikke total RAM

/// V2-baken (2026-08, Scaniverse-arkitekturen): capture RECORDER bare (RGB + dybde + poser);
/// all rekonstruksjon skjer offline i denne batchen. Rekkefølge: pose-refine (Zhou-Koltun)
/// → geometri (batch-TSDF av dybdekartene m/ raffinerte poser; anchor-mesh som fallback)
/// → kvadrikk-forenkling → xatlas → per-face vinnervalg (cos×1/d²×kvalitet, dybde-okklusjon)
/// → plan-lås/ståsted-valg/ICM → søm-nivellering + multiband → GLB.
/// Alt repeterbart via fixture-rebake — kvalitet itereres på FIXTURES, ikke knotter.
@available(iOS 14.0, *)
enum MeshBakeV2 {

    struct MergedMesh {
        var positions: [Float]   // world-space, 3 per vertex
        var normals: [Float]
        var indices: [UInt32]
        var triAnchor: [UInt32]  // per tri — chunket xatlas-fallback
        var planes: [SIMD4<Float>] = []  // snappede dominantplan (n.xyz, d)
        var faceClass: [UInt8] = []      // ARMeshClassification.rawValue per tri (0 = none)
    }

    // MARK: - Geometri: anchor-mesh som den er

    /// Ren verdensroms-sammenslåing av ARMeshAnchors. Eneste filtre er xatlas-SIKKERHET
    /// (ikke kvalitetsheuristikk): strukne bro-triangler, degenererte/duplikate flater
    /// (henger xatlas), og frittsvevende småøyer (charts-eksplosjon).
    static func mergeAnchors(_ anchors: [ARMeshAnchor]) -> MergedMesh {
        var positions: [Float] = []
        var normals: [Float] = []
        var indices: [UInt32] = []
        var triAnchor: [UInt32] = []
        var faceClass: [UInt8] = []  // ARMeshClassification per tri (wall=1, floor=2, ceiling=3, …)
        // 0.5 (var 0.35, scan #10): gulv/tak i rask enkelt-passering fanges på gløtt-vinkler
        // der klassifisereren ennå ikke har rukket å merke dem (class=none) — de fikk streng
        // grense og ble kuttet. 0.5 lar umerkede-men-ekte flater overleve.
        let maxEdge: Float = 0.5

        for (anchorIdx, anchor) in anchors.enumerated() {
            let geom = anchor.geometry
            let transform = anchor.transform
            let normalMatrix = simd_transpose(simd_inverse(simd_float3x3(
                SIMD3(transform.columns.0.x, transform.columns.0.y, transform.columns.0.z),
                SIMD3(transform.columns.1.x, transform.columns.1.y, transform.columns.1.z),
                SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
            )))
            let startVertex = UInt32(positions.count / 3)
            let vBuf = geom.vertices.buffer.contents()
            let nBuf = geom.normals.buffer.contents()
            for i in 0..<geom.vertices.count {
                let vp = vBuf.advanced(by: geom.vertices.offset + i * geom.vertices.stride)
                    .assumingMemoryBound(to: SIMD3<Float>.self).pointee
                let w4 = transform * SIMD4<Float>(vp.x, vp.y, vp.z, 1)
                positions.append(w4.x); positions.append(w4.y); positions.append(w4.z)
                let np = nBuf.advanced(by: geom.normals.offset + i * geom.normals.stride)
                    .assumingMemoryBound(to: SIMD3<Float>.self).pointee
                let wn = simd_normalize(normalMatrix * np)
                normals.append(wn.x); normals.append(wn.y); normals.append(wn.z)
            }
            let faces = anchor.geometry.faces
            let fBuf = faces.buffer.contents()
            let bpi = faces.bytesPerIndex
            func readIdx(_ i: Int) -> UInt32 {
                let p = fBuf.advanced(by: i * bpi)
                return bpi == 2 ? UInt32(p.assumingMemoryBound(to: UInt16.self).pointee)
                                : p.assumingMemoryBound(to: UInt32.self).pointee
            }
            func worldAt(_ li: UInt32) -> SIMD3<Float> {
                let b = (Int(startVertex) + Int(li)) * 3
                return SIMD3(positions[b], positions[b + 1], positions[b + 2])
            }
            guard faces.indexCountPerPrimitive == 3 else { continue }
            // Per-face klassifisering (wall/floor/ceiling/…): .meshWithClassification har alltid
            // vært PÅ — bufferet lå ulest. Grunnlaget for plan-segmenteringen (fase B).
            let clsSource = geom.classification
            let clsBuf = clsSource?.buffer.contents()
            for t in 0..<faces.count {
                let a = readIdx(t * 3), b = readIdx(t * 3 + 1), c = readIdx(t * 3 + 2)
                let pa = worldAt(a), pb = worldAt(b), pc = worldAt(c)
                var cls: UInt8 = 0
                if let s = clsSource, let cb = clsBuf, t < s.count {
                    cls = cb.advanced(by: s.offset + t * s.stride).assumingMemoryBound(to: UInt8.self).pointee
                }
                // Kant-grensen er KLASSEBEVISST (scan #9-lærdom): ARKit mesher store flate
                // vegger med STORE triangler (særlig i rask enkelt-passering på avstand) —
                // 0,35m-filteret slettet hele glatte vegger mens panelvegger (små tris)
                // overlevde. Vegg/gulv/tak får slippe store tris; bro-shard-vernet består
                // for alt annet.
                let limit: Float = (cls >= 1 && cls <= 3) ? 1.5 : maxEdge
                if simd_distance(pa, pb) > limit || simd_distance(pb, pc) > limit || simd_distance(pc, pa) > limit { continue }
                indices.append(a + startVertex); indices.append(b + startVertex); indices.append(c + startVertex)
                triAnchor.append(UInt32(anchorIdx))
                faceClass.append(cls)
            }
        }

        // ── Multi-vinkel-dedup (V1-batteriet, scan #7-lærdom): gjenbesøk fra nye vinkler legger
        // drift-dobbelskall cm fra hverandre — strimlet «makulert» geometri. Enkelt-synsvinkel
        // trigget det aldri; walk-around gjør. Rekkefølgen speiler buildMerged (V1).
        // faceClass overlever via verteks-trippel-nøkkel: passene SLETTER faces, reindekserer aldri.
        func faceKey(_ t: Int) -> UInt64 {
            (UInt64(indices[t * 3]) << 42) | (UInt64(indices[t * 3 + 1]) << 21) | UInt64(indices[t * 3 + 2])
        }
        var classByFace = [UInt64: UInt8](minimumCapacity: faceClass.count)
        for t in 0..<(indices.count / 3) { classByFace[faceKey(t)] = faceClass[t] }

        let planes = ARMeshGlbExporter.snapDominantPlanes(positions: &positions, indices: indices)
        // Delt sult-bok mellom dedup-passene — se dropOverlapSheets-dokken.
        var dedupLedger = [(c: SIMD3<Float>, n: SIMD3<Float>, area: Float)]()
        ARMeshGlbExporter.dropOverlapSheets(positions: positions, indices: &indices, triAnchor: &triAnchor, droppedLedger: &dedupLedger)
        ARMeshGlbExporter.dropCoplanarLayers(planes: planes, positions: positions, indices: &indices, triAnchor: &triAnchor, droppedLedger: &dedupLedger)
        ARMeshGlbExporter.dropDoubleSurfaces(positions: positions, indices: &indices, triAnchor: &triAnchor)
        indices = ARMeshGlbExporter.dropDegenerateAndDuplicateFaces(positions: positions, indices: indices, triAnchor: &triAnchor)
        // TAKET på 600 er nytt (device-funn 2026-08-15): terskelen skalerte med MESHSTØRRELSEN,
        // så et stort rom (287k tris → minTris 1434) slettet 46k tris — hele vegger som ikke
        // hang topologisk sammen med hovedkroppen forsvant («veggen med klokka vises ikke»).
        // Flytende støy er små i ABSOLUTT forstand (titalls tris), så et tak fjerner fortsatt
        // specks uten å spise ekte flate. Store rom har FLERE ekte løsrevne biter, ikke færre.
        indices = ARMeshGlbExporter.filterSmallComponents(vertexCount: positions.count / 3, indices: indices,
                                                          minTris: min(600, max(120, indices.count / 3 / 200)),
                                                          triAnchor: &triAnchor)
        // Planær hullfylling (V1s «Polycam-triks», gjeninnført scan #9): TV-er/vinduer/
        // okkludert vegg gir hull i etablerte plan — fyll de planære grenseløkkene så baken
        // kan prosjisere ekte fotoinnhold på dem. Fyller kun FLATE løkker i eksisterende
        // plan — ingen oppdiktet geometri. Nye flater får klasse 0 (slipper inn i
        // plan-matchingen geometrisk).
        var noColors = [Float]()
        ARMeshGlbExporter.fillPlanarHoles(positions: &positions, colors: &noColors, indices: &indices, triAnchor: &triAnchor)
        // «15mm-prosessering»-finishen (Scaniverse-observasjon, scan #10): sveiset Taubin-
        // glatting runder de blokkete ARKit-trianglene til rene flater uten hjørnekrymp —
        // og sveiser anchor-flisene så gridsprekker forsvinner. Deretter degenerat-dropp
        // (glattingen gjør overlapp-posisjoner eksakt like → duplikater må ut for xatlas).
        ARMeshGlbExporter.weldedTaubinSmooth(positions: &positions, indices: indices, passes: 2)
        indices = ARMeshGlbExporter.dropDegenerateAndDuplicateFaces(positions: positions, indices: indices, triAnchor: &triAnchor)
        faceClass = (0..<(indices.count / 3)).map { classByFace[faceKey($0)] ?? 0 }
        // snapDominantPlanes flyttet verteksene → ARKit-normalene er foreldet (poseRefine leser dem)
        normals = ARMeshGlbExporter.recomputeNormals(positions: positions, indices: indices)
        MeshLog.log("V2 geometri: anchors + dedup — \(positions.count / 3) verts, \(indices.count / 3) tris, \(planes.count) plan")
        return MergedMesh(positions: positions, normals: normals, indices: indices, triAnchor: triAnchor,
                          planes: planes, faceClass: faceClass)
    }

    // MARK: - Fixture (regresjonssele): samme skann, ny bake, målbar diff

    private static let fixtureMagic: UInt32 = 0x414D5058 // "AMPX"

    static func writeFixture(mesh: MergedMesh, keyframes: [MeshScanPresenter.Keyframe], framesDir: URL) {
        var d = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        u32(fixtureMagic); u32(3)
        u32(UInt32(mesh.positions.count / 3)); u32(UInt32(mesh.indices.count / 3))
        mesh.positions.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        mesh.normals.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        mesh.indices.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        mesh.triAnchor.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        // v3: dominantplan + per-face-klasse (plan-segmenteringens innsats)
        u32(UInt32(mesh.planes.count))
        for p in mesh.planes { [p.x, p.y, p.z, p.w].withUnsafeBufferPointer { d.append(Data(buffer: $0)) } }
        mesh.faceClass.withUnsafeBufferPointer { d.append(Data(buffer: $0)) }
        try? d.write(to: framesDir.appendingPathComponent("fixture-mesh.bin"), options: .atomic)
        // Re-ankrede keyframes (ikke rå frames.json-poser) — baken skal repeteres EKSAKT.
        if let kf = try? JSONEncoder().encode(keyframes) {
            try? kf.write(to: framesDir.appendingPathComponent("fixture-kf.json"), options: .atomic)
        }
        MeshLog.log("V2 fixture skrevet — \(d.count / 1024 / 1024)MB mesh + \(keyframes.count) kf-poser")
    }

    static func readFixture(framesDir: URL) -> (mesh: MergedMesh, keyframes: [MeshScanPresenter.Keyframe])? {
        guard let d = try? Data(contentsOf: framesDir.appendingPathComponent("fixture-mesh.bin")),
              let kfData = try? Data(contentsOf: framesDir.appendingPathComponent("fixture-kf.json")),
              let keyframes = try? JSONDecoder().decode([MeshScanPresenter.Keyframe].self, from: kfData),
              d.count >= 16 else { return nil }
        var off = 0
        func u32() -> UInt32 {
            let v = d.subdata(in: off..<off + 4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
            off += 4; return UInt32(littleEndian: v)
        }
        guard u32() == fixtureMagic else { return nil }
        let version = u32()
        guard version == 2 || version == 3 else { return nil }
        let vc = Int(u32()), tc = Int(u32())
        func floats(_ n: Int) -> [Float] {
            let bytes = n * 4
            guard off + bytes <= d.count else { return [] }
            let a = d.subdata(in: off..<off + bytes).withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            off += bytes; return a
        }
        func uints(_ n: Int) -> [UInt32] {
            let bytes = n * 4
            guard off + bytes <= d.count else { return [] }
            let a = d.subdata(in: off..<off + bytes).withUnsafeBytes { Array($0.bindMemory(to: UInt32.self)) }
            off += bytes; return a
        }
        let positions = floats(vc * 3), normals = floats(vc * 3)
        let indices = uints(tc * 3), triAnchor = uints(tc)
        guard positions.count == vc * 3, indices.count == tc * 3 else { return nil }
        var planes: [SIMD4<Float>] = []
        var faceClass: [UInt8] = []
        if version >= 3 {
            let pc = Int(u32())
            let pf = floats(pc * 4)
            if pf.count == pc * 4 {
                for i in 0..<pc { planes.append(SIMD4(pf[i * 4], pf[i * 4 + 1], pf[i * 4 + 2], pf[i * 4 + 3])) }
            }
            if off + tc <= d.count {
                faceClass = Array(d.subdata(in: off..<off + tc))
                off += tc
            }
        }
        return (MergedMesh(positions: positions, normals: normals, indices: indices, triAnchor: triAnchor,
                           planes: planes, faceClass: faceClass), keyframes)
    }

    // MARK: - Hoved-inngang (live skann)

    static func exportTextured(
        anchors: [ARMeshAnchor], to glbURL: URL, framesDir: URL,
        keyframes: [MeshScanPresenter.Keyframe]
    ) -> ARMeshGlbExporter.TexturedExportResult {
        var mesh = mergeAnchors(anchors)
        guard !mesh.indices.isEmpty else {
            return ARMeshGlbExporter.TexturedExportResult(success: false, filledFraction: nil, geometryPath: "anchor-v2")
        }
        // Fixturen skrives med ANCHOR-nettet uansett, så en rebake alltid kan sammenligne mot
        // ARKits utgangspunkt. TSDF-en bygges etterpå og erstatter kun det som bakes.
        writeFixture(mesh: mesh, keyframes: keyframes, framesDir: framesDir)

        // GEOMETRI FRA RÅ LiDAR også i det LIVE skannet (2026-09-01). Uten dette brukte
        // skanningen ARKits glattede okklusjonsnett mens bare rebake fikk det nye — altså
        // ga appen sitt dårligste resultat der brukeren ser det først. `dense.jsonl` finnes
        // kun når densedepth-loggingen var på; mangler den, faller vi tilbake uendret.
        if #available(iOS 14.0, *),
           UserDefaults.standard.string(forKey: "meshscan.geometry") != "anchor",
           FileManager.default.fileExists(atPath: framesDir.appendingPathComponent("dense.jsonl").path) {
            ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR…")
            if let t = MeshTsdfBuild.build(framesDir: framesDir) {
                mesh = t
            } else {
                MeshLog.log("TSDF: bygg feilet i live-skann — beholder ARKit-nettet")
            }
        }
        return bake(mesh: mesh, keyframes: keyframes, framesDir: framesDir, to: glbURL)
    }

    // MARK: - Bake (delt av live skann og fixture-rebake)

    static func bake(
        mesh meshIn: MergedMesh, keyframes: [MeshScanPresenter.Keyframe], framesDir: URL, to glbURL: URL
    ) -> ARMeshGlbExporter.TexturedExportResult {
        let t0 = CFAbsoluteTimeGetCurrent()
        let fail = ARMeshGlbExporter.TexturedExportResult(success: false, filledFraction: nil, geometryPath: "anchor-v2")
        // ── Budsjett fra REELT headroom, ikke total RAM. Den gamle grenen bandt maxKF OMVENDT
        // til atlasstørrelsen, så iPhone 13 Pro (6 GB) klarte så vidt >= 6e9 og arvet største
        // atlas + FÆRREST keyframes (96) — svakeste enhet på tyngste sti. For dekningsproblemer
        // slår keyframes atlasoppløsning, så de skalerer nå SAMME vei.
        // meshscan.budget = "legacy" gjenoppretter gammel gren for fixture-A/B.
        let atlasSize: Int
        let maxKF: Int
        var topK: Int
        if UserDefaults.standard.string(forKey: "meshscan.budget") == "legacy" {
            atlasSize = ProcessInfo.processInfo.physicalMemory >= 6_000_000_000 ? 8192 : 4096
            maxKF = atlasSize >= 8192 ? 96 : 120
            topK = 3
        } else {
            // Atlasparet (A+B) er den store posten: 8192² rgba8 ≈ 268 MB per tekstur, pluss
            // lavoppløsnings-intermediatene og lesebufferet i rasterize().
            let headroomMB = Int(os_proc_available_memory() / (1024 * 1024))
            // Termisk brems (regel 8): flere keyframes = lengre pose-refine og flere snitt-pass.
            // På en varm telefon er det billigere å levere et litt tynnere bake enn å bli strupet
            // midt i jobben — ett hakk ned på stigen, aldri under gulvet.
            let thermal = ProcessInfo.processInfo.thermalState
            let hot = thermal == .serious || thermal == .critical
            if headroomMB >= 2800 && !hot {
                atlasSize = 8192; maxKF = 200; topK = 6
            } else if headroomMB >= 1700 && !hot {
                atlasSize = 6144; maxKF = 160; topK = 6
            } else {
                atlasSize = 4096; maxKF = 120; topK = 4
            }
            MeshLog.log("V2 budsjett — headroom \(headroomMB)MB, termikk \(thermal.rawValue) → atlas \(atlasSize), maxKF \(maxKF), topK \(topK)")
        }
        // Antall syn i snittet er den DIREKTE skarphetskontrollen for blend=raw. Bildene er
        // typisk et par piksler uenige om hvor kanter går (warpen lukker bare ~8 % av det),
        // så et snitt av 6 syn arver spredningen mellom alle seks. To syn gir to pikslers
        // uskarphet; seks gir mye mer. Vinkelvekting alene skiller for dårlig når synene ser
        // flaten fra omtrent samme vinkel — da er facing nesten lik uansett eksponent.
        if let s = UserDefaults.standard.string(forKey: "meshscan.topk"), let v = Int(s), v >= 1 {
            topK = min(v, topK)
            MeshLog.log("V2 topK overstyrt → \(topK)")
        }

        ARMeshGlbExporter.progress?("Velger beste bilder…")
        // Planshots (dedikerte 12MP-veggfotos) er fredet fra pruningen.
        func privileged(_ k: MeshScanPresenter.Keyframe) -> Bool {
            k.isPlaneShot == true
        }
        let priv = keyframes.filter(privileged)
        var kfUse: [MeshScanPresenter.Keyframe]
        if keyframes.count > maxKF {
            let rest = keyframes.filter { !privileged($0) }
            kfUse = ARMeshGlbExporter.selectCoverageAware(rest, budget: max(maxKF - priv.count, 16)) + priv
        } else {
            kfUse = keyframes
        }
        guard !kfUse.isEmpty else { return fail }

        // Zhou-Koltun rigid pose-finjustering (fotometrisk, mot mesh-proxyfarger): ARKit-drift
        // på cm-nivå er hovedårsaken til smurte projeksjoner — fiks posene FØR geometri og
        // vinnervalg. Anchor-meshen (full oppløsning) er proxy uansett geometrivalg.
        // Flagg av: meshscan.poserefine = "off" (fixture-A/B).
        // blend: DEFAULT = HYBRID multiband gjennom warpen — vinnerfoto beholder all detalj
        // (og hele scoringen: dybdekant, gjenskinn, skarphet), mens LAVFREKVENSEN kommer fra
        // et warp-justert snitt av den EKTE topp-K. Det er lavfrekvensen som er lappeteppet
        // (eksponering/tone), så snittet visker det ut uten å ofre skarphet. Rått fullfrekvens-
        // snitt (device 2026-08-26: taggete tonelapper i taket der topp-K-settet skifter, og
        // søyle-smuss dratt inn på veggen av lavt rangerte syn) beholdes som "raw" for A/B.
        // "winner"/"off" = ren vinnervei. blend tvinger warpen på (snittet sampler gjennom den).
        // Se docs/SUBPIXEL_ALIGN_PLAN.md.
        let blendFlag = UserDefaults.standard.string(forKey: "meshscan.blend")
        let blendAll = blendFlag != "off" && blendFlag != "winner"
        let blendRaw = blendFlag == "raw"
        var warpGrids = [[SIMD2<Float>]]()
        if UserDefaults.standard.string(forKey: "meshscan.poserefine") != "off" {
            ARMeshGlbExporter.progress?("Justerer kameraer…")
            MeshPoseRefineV2.refine(keyframes: &kfUse, positions: meshIn.positions, normals: meshIn.normals,
                                    framesDir: framesDir, forceWarp: blendAll, warpGridsByKF: &warpGrids)
        }

        // ── Geometri-stadium: ANCHOR-MESH ER DEFAULT (scan #8-fasiten, brukerdom 2026-08-13
        // «looks fucking amazing» vs fusjonens «looks shit»). Batch-TSDF-fusjonen står som
        // OPT-IN eksperiment (meshscan.geometry = "fusion", A/B via rebake på fixtures) til
        // den beviselig slår anchor-banen — første device-runde tapte den klart (60mm-pooling
        // er fikset, men plan-lås/geometri-finish er fortsatt ikke på anchor-nivå).
        var mesh = meshIn
        var geometryPath = "anchor-v2"
        if UserDefaults.standard.string(forKey: "meshscan.geometry") == "fusion" {
            ARMeshGlbExporter.progress?("Fusjonerer dybde…")
            if let fused = TSDFFusion.fuseBatch(keyframes: kfUse, framesDir: framesDir) {
                // Samme kvalitetsbatteri som anchor-banen (minus dedup — fusjon kan ikke doble):
                // plan-snap gjør TSDF-ens svake bølger knivrette, småøy-filter tar støyfragmenter,
                // planær hullfylling lapper vindu/TV/okklusjon, glatting tar voxel-ripple.
                var fPos = fused.positions
                var fIdx = fused.indices
                var fAnchor: [UInt32] = []
                _ = ARMeshGlbExporter.snapDominantPlanes(positions: &fPos, indices: fIdx)
                fIdx = ARMeshGlbExporter.filterSmallComponents(vertexCount: fPos.count / 3, indices: fIdx,
                                                               minTris: max(120, fIdx.count / 3 / 200), triAnchor: &fAnchor)
                var noColors = [Float]()
                ARMeshGlbExporter.fillPlanarHoles(positions: &fPos, colors: &noColors, indices: &fIdx, triAnchor: &fAnchor)
                // Re-snap ETTER lapping (lappene skal inn på planet) — dette er planene baken bruker.
                let fPlanes = ARMeshGlbExporter.snapDominantPlanes(positions: &fPos, indices: fIdx)
                ARMeshGlbExporter.weldedTaubinSmooth(positions: &fPos, indices: fIdx, passes: 2)
                fIdx = ARMeshGlbExporter.dropDegenerateAndDuplicateFaces(positions: fPos, indices: fIdx, triAnchor: &fAnchor)
                // Syntetiske chunk-id-er (1,2 m-blokker) så chunket xatlas-fallback fungerer.
                var blocks = [UInt32](repeating: 0, count: fIdx.count / 3)
                var blockMap = [Int64: UInt32]()
                for t in 0..<(fIdx.count / 3) {
                    let a = Int(fIdx[t * 3]) * 3
                    let bx = Int64((fPos[a] / 1.2).rounded()) & 0xFFFF
                    let by = Int64((fPos[a + 1] / 1.2).rounded()) & 0xFFFF
                    let bz = Int64((fPos[a + 2] / 1.2).rounded()) & 0xFFFF
                    let key = bx | (by << 16) | (bz << 32)
                    if let id = blockMap[key] { blocks[t] = id } else {
                        let id = UInt32(blockMap.count)
                        blockMap[key] = id
                        blocks[t] = id
                    }
                }
                // Adopsjonsvakt: fusjonen må være en RIMELIG rekonstruksjon, ikke et fragment —
                // ellers (rask skann, tynn dybdedekning) er anchor-meshen ærligere.
                let fTris = fIdx.count / 3
                if fTris >= 2_000 && fTris >= meshIn.indices.count / 3 / 5 {
                    mesh = MergedMesh(positions: fPos,
                                      normals: ARMeshGlbExporter.recomputeNormals(positions: fPos, indices: fIdx),
                                      indices: fIdx, triAnchor: blocks,
                                      planes: fPlanes, faceClass: [])
                    geometryPath = "fusion-v2"
                    MeshLog.log("V2 geometri: TSDF batch-fusjon — \(fPos.count / 3) verts, \(fTris) tris, \(fPlanes.count) plan")
                } else {
                    MeshLog.log("V2 geometri: fusjon forkastet (\(fTris) tris < vakt) — anchor-mesh beholdt")
                }
            } else {
                MeshLog.log("V2 geometri: fusjon utilgjengelig — anchor-mesh beholdt")
            }
        }

        // ── Forenkling FØR unwrap — OPT-IN (meshscan.simplify = "on") inntil fixture-A/B
        // viser at den ikke koster kvalitet: scan #8-fasiten kjørte uten, og forenklingen
        // endrer face-størrelsene hele nedstrøms-pipelinen er tunet rundt (plan-delevakt og
        // søm-nivellering er nå areal-/n-bevisste, men dommen hører til på en fixture).
        // OPT-IN, IKKE auto. Auto-på over xatlas-taket ble prøvd 2026-08-15 og rullet tilbake
        // samme kveld: en stue på 354k tris ble desimert til 100k, og taket fikk synlige store
        // fasetter — merkbart styggere enn den chunkede atlasen den skulle redde oss fra.
        // Lærdommen: CHUNKED xatlas koster sømmer (reparerbart nedstrøms), desimering koster
        // geometri (ikke reparerbart). Den manglende veggen som utløste hele sporet kom
        // dessuten fra komponentfilteret, ikke fra chunkingen — den er fikset for seg.
        // Et TSDF-nett kommer inn med 600k–900k trekanter der ARKits ligger rundt 300k, og
        // xatlas skalerer verre enn lineært: 99 s mot 10 s. Det LIVE skannet setter ingen
        // flagg, så uten en automatisk regel her ville skanningen tatt minutter mens
        // rebake-knappene tok sekunder. Terskelen på 400k treffer TSDF-nett og lar ARKits
        // være i fred. Merk at auto-forenkling ble rullet tilbake i august — men da mot det
        // HARDE taket på 60k, som ga fasetter i taket. 250k er en helt annen operasjon.
        let bigMesh = mesh.indices.count / 3 > 400_000
        var didSimplify = false
        var simplifyFlag = UserDefaults.standard.string(forKey: "meshscan.simplify")
        if simplifyFlag == nil, bigMesh { simplifyFlag = "250000" }
        if simplifyFlag != nil, simplifyFlag != "off", mesh.indices.count / 3 > 24_000 {
            didSimplify = true
            ARMeshGlbExporter.progress?("Forenkler mesh…")
            // "on" = det opprinnelige, HARDE taket (maks 60k). Det er en femtedel eller mindre
            // av et vanlig rom, og er nettopp det som ga fasetter i taket i august.
            //
            // Et TALL setter måltrekanter direkte, og det er det som trengs for TSDF-nett:
            // surface nets gir like mange trekanter på en flat vegg som på en detaljert list,
            // så de første 50–60 % kan kollapses nesten gratis i kvadrikkfeil. Uten dette
            // henger xatlas i mange minutter på 600k+ tris (målt device 2026-08-31).
            let target: Int
            if let n = Int(simplifyFlag ?? ""), n >= 20_000 {
                target = min(n, mesh.indices.count / 3)
            } else {
                target = max(20_000, min(60_000, mesh.indices.count / 3 / 5))
            }
            MeshSimplify.simplify(mesh: &mesh, targetTris: target, errorLimit: 1e-4)
        }

        // ── UV-atlas (uendret V1-organ): u-chunket innenfor budsjett, chunket ellers, box som nødløsning.
        ARMeshGlbExporter.progress?("Pakker UV-atlas…")
        var lastTick: (Int, Int) = (-1, -1)
        var lastChange = CFAbsoluteTimeGetCurrent()
        let uiHandler: (Int, Int) -> Bool = { category, percent in
            switch category {
            case 1: ARMeshGlbExporter.progress?("Analyserer flater… \(percent) %")
            case 2: ARMeshGlbExporter.progress?("Pakker UV-atlas… \(percent) %")
            default: break
            }
            if (category, percent) != lastTick { lastTick = (category, percent); lastChange = CFAbsoluteTimeGetCurrent() }
            return CFAbsoluteTimeGetCurrent() - lastChange < 180
        }
        xatlasProgressHandler = uiHandler
        var unwrapped: ARMeshGlbExporter.UVUnwrapResult?
        if mesh.indices.count / 3 <= 110_000 {
            unwrapped = xatlasUnwrapUVs(positions: mesh.positions, normals: mesh.normals, indices: mesh.indices,
                                        triAnchor: [], resolution: UInt32(atlasSize))
        }
        if unwrapped == nil {
            lastChange = CFAbsoluteTimeGetCurrent(); lastTick = (-1, -1)
            xatlasProgressHandler = uiHandler // timeout-veien nuller handleren — må re-settes
            unwrapped = xatlasUnwrapUVs(positions: mesh.positions, normals: mesh.normals, indices: mesh.indices,
                                        triAnchor: mesh.triAnchor, resolution: UInt32(atlasSize))
        }
        let uv = unwrapped ?? ARMeshGlbExporter.boxUnwrapUVs(positions: mesh.positions, normals: mesh.normals, indices: mesh.indices)
        xatlasProgressHandler = nil
        guard !uv.indices.isEmpty else { return fail }

        // ── Per-face vinnervalg (CPU, parallelt): cos(vinkel) × 1/d² × frame-kvalitet,
        //    okklusjon = én dybdetest (±30 cm), gjenskinn/metning = myke straffer fra thumbs.
        ARMeshGlbExporter.progress?("Velger beste bilde per flate…")
        struct Cand {
            var w2c: simd_float4x4
            var camPos: SIMD3<Float>
            var intr: SIMD4<Float>       // fx, fy, cx, cy
            var imgW: Float, imgH: Float
            var quality: Float           // skarphet/bevegelse, normalisert
            var depth: [Float]; var dw: Int; var dh: Int
            var thumb: [UInt8]; var tw: Int; var th: Int
        }
        func mat(_ a: [Float]) -> simd_float4x4 {
            simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                    SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
        }
        let maxSharp = max(kfUse.map(\.sharpness).max() ?? 1, 1e-4)
        var cands: [Cand] = []
        cands.reserveCapacity(kfUse.count)
        var frameMeans: [SIMD3<Float>] = [] // lineær snitt-RGB per frame → gain-utjevning
        for k in kfUse {
            let c2w = mat(k.transform)
            var depth: [Float] = []; var dw = 0; var dh = 0
            if let df = k.depthFile, let dd = try? Data(contentsOf: framesDir.appendingPathComponent(df)),
               dd.count == k.depthWidth * k.depthHeight * 4 {
                depth = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
                dw = k.depthWidth; dh = k.depthHeight
            }
            var thumb: [UInt8] = []; var tw = 0; var th = 0
            if let cg = MeshImageIO.loadCGImageThumb(framesDir, k.file, maxPx: 96),
               let bytes = MeshImageIO.rgbaBytes(cg) {
                thumb = bytes; tw = cg.width; th = cg.height
            }
            frameMeans.append(thumb.isEmpty ? SIMD3(0.25, 0.25, 0.25) : MeshImageIO.meanRGBLinear(thumb))
            cands.append(Cand(
                w2c: simd_inverse(c2w),
                camPos: SIMD3(k.transform[12], k.transform[13], k.transform[14]),
                intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                imgW: Float(k.width), imgH: Float(k.height),
                // kfQuality = felles rangering med fangsten; blurPx (predikert eksponerings-
                // uskarphet) er nil på eldre fixtures → faktor 1, gamle bakes er bit-like.
                quality: MeshScanPresenter.kfQuality(sharpness: k.sharpness / maxSharp, motion: k.motion, blurPx: k.blurPx)
                    * ((k.preLock ?? false) ? 0.6 : 1),
                depth: depth, dw: dw, dh: dh, thumb: thumb, tw: tw, th: th
            ))
        }
        // Gain-utjevning via OVERLAPP (V1-metoden): sammenlign SAMME flate sett fra flere
        // frames og løs multiplikative per-kanal gains. (Første forsøk brukte helbilde-snitt
        // mot median — det måler SCENEINNHOLD, ikke eksponering: en frame full av mørkt teppe
        // fikk gain 1.35 og blåste ut veggen sin. Scan #4-lærdommen.)
        _ = frameMeans // (beholdes ikke — overlappen er signalet)
        var gains = [SIMD3<Float>](repeating: SIMD3(1, 1, 1), count: cands.count)
        gainSolve: do {
            struct Obs { var frame: Int32; var c: SIMD3<Float> }
            let vCountM = mesh.positions.count / 3
            let strideM = max(1, vCountM / 8000)
            var pointObs: [[Obs]] = []
            var vi = 0
            while vi < vCountM {
                let p = SIMD3(mesh.positions[vi * 3], mesh.positions[vi * 3 + 1], mesh.positions[vi * 3 + 2])
                let n = SIMD3(mesh.normals[vi * 3], mesh.normals[vi * 3 + 1], mesh.normals[vi * 3 + 2])
                vi += strideM
                var obs: [Obs] = []
                for (fi, c) in cands.enumerated() {
                    guard c.tw > 0 else { continue }
                    let pcam = c.w2c * SIMD4(p, 1)
                    if pcam.z > -0.05 { continue }
                    let z = -pcam.z
                    let u = c.intr.x * (pcam.x / z) + c.intr.z
                    let vv = c.intr.y * (-pcam.y / z) + c.intr.w
                    if u < 8 || vv < 8 || u > c.imgW - 8 || vv > c.imgH - 8 { continue }
                    if simd_dot(n, simd_normalize(c.camPos - p)) < 0.25 { continue }
                    if c.dw > 0 {
                        let dx = min(c.dw - 1, max(0, Int(u / c.imgW * Float(c.dw))))
                        let dy = min(c.dh - 1, max(0, Int(vv / c.imgH * Float(c.dh))))
                        let sceneZ = c.depth[dy * c.dw + dx]
                        if sceneZ > 0.25 && abs(z - sceneZ) > 0.30 { continue }
                    }
                    let tx = min(c.tw - 1, Int(u / c.imgW * Float(c.tw)))
                    let ty = min(c.th - 1, Int(vv / c.imgH * Float(c.th)))
                    let px = (ty * c.tw + tx) * 4
                    let s = SIMD3(Float(c.thumb[px]), Float(c.thumb[px + 1]), Float(c.thumb[px + 2])) / 255
                    var lin = SIMD3(pow(s.x, 2.2), pow(s.y, 2.2), pow(s.z, 2.2))
                    if lin.x + lin.y + lin.z < 0.02 || max(lin.x, max(lin.y, lin.z)) > 0.92 { continue } // sort/utbrent gir null signal
                    let qx = u / c.imgW - 0.5, qy = vv / c.imgH - 0.5
                    lin *= 1.0 + 0.15 * (qx * qx + qy * qy) * 4.0 // samme avvignettering som shaderen
                    obs.append(Obs(frame: Int32(fi), c: lin))
                }
                if obs.count >= 2 { pointObs.append(obs) }
            }
            guard pointObs.count >= 200 else { break gainSolve }
            // Hvor langt gain-utjevningen får gå. Loggene fra august viser at gainene SLÅR I
            // klemmen på 0.8–1.25 — altså at utjevningen stopper før den er ferdig, og at
            // eksponeringsforskjeller blir stående igjen som fargevariasjon mellom flater.
            // Videre klemme flater mer, men risikerer å dra ekte lysforskjeller (skygge under
            // et bord er ikke en eksponeringsfeil) mot hverandre. meshscan.gainclamp = tall
            // (avstand fra 1, f.eks. 0.35 → 0.65–1.35) eller "off" for helt fri.
            var gainLo: Float = 0.8, gainHi: Float = 1.25
            switch UserDefaults.standard.string(forKey: "meshscan.gainclamp") {
            case "off": gainLo = 0.3; gainHi = 3.0
            case let s? where Float(s) != nil:
                let d = min(max(Float(s)!, 0.05), 0.6)
                gainLo = 1 - d; gainHi = 1 + d
            default: break
            }
            // Alternerende multiplikativ LSQ: punktmål = snitt av g_f·c_f; deretter g_f mot målene.
            for _ in 0..<10 {
                var num = [SIMD3<Float>](repeating: .zero, count: cands.count)
                var den = [SIMD3<Float>](repeating: .zero, count: cands.count)
                for obs in pointObs {
                    var target = SIMD3<Float>.zero
                    for o in obs { target += gains[Int(o.frame)] * o.c }
                    target /= Float(obs.count)
                    for o in obs { num[Int(o.frame)] += target * o.c; den[Int(o.frame)] += o.c * o.c }
                }
                // REKKEFØLGE: løs → normaliser → klem. Motsatt rekkefølge (klem først) lot
                // normaliseringen dytte verdier UT av klemmen igjen: med gainclamp 0.4
                // (altså 0.6–1.4) endte gain-lum på 0.67–1.43 (device 2026-09-01).
                // Driften fjernes først, deretter begrenses spredningen — ellers gjør de to
                // stegene hverandres arbeid om intet.
                for i in 0..<gains.count where den[i].x > 1e-4 {
                    gains[i] = num[i] / simd_max(den[i], SIMD3(repeating: 1e-4))
                }
                // NORMALISER bort den globale frihetsgraden. Systemet er multiplikativt: ganges
                // ALLE gains med samme tall, er den relative løsningen like god, men bildet blir
                // jevnt mørkere eller lysere. Uten dette driver solven — med vid klemme falt
                // gain-luminansen til 0,31 og hele baken ble mørk (device 2026-08-31). Den gamle
                // klemmen på ±25 % skjulte driften ved å stoppe den, i stedet for å fjerne den.
                // Geometrisk snitt fordi gains ganges, ikke summeres.
                var logSum: Float = 0, n = 0
                for g in gains {
                    let lum = 0.299 * g.x + 0.587 * g.y + 0.114 * g.z
                    if lum > 1e-4 { logSum += log(lum); n += 1 }
                }
                if n > 0 {
                    let scale = 1 / exp(logSum / Float(n))
                    for i in 0..<gains.count { gains[i] *= scale }
                }
                for i in 0..<gains.count {
                    gains[i] = simd_clamp(gains[i], SIMD3(repeating: gainLo), SIMD3(repeating: gainHi))
                }
            }
            let lums = gains.map { 0.299 * $0.x + 0.587 * $0.y + 0.114 * $0.z }
            MeshLog.log("V2 gain-utjevning (overlapp) — \(pointObs.count) punkter, gain-lum \(String(format: "%.2f", lums.min() ?? 1))–\(String(format: "%.2f", lums.max() ?? 1))")
        }

        let triCount = uv.indices.count / 3
        // Per-face geometri én gang — deles av vinnervalg, plan-segmentering, regularisering
        var fCent = [SIMD3<Float>](repeating: .zero, count: triCount)
        var fNorm = [SIMD3<Float>](repeating: .zero, count: triCount)
        var fArea = [Float](repeating: 0, count: triCount) // verdensareal (plan-scoring vektes på areal)
        for t in 0..<triCount {
            let ia = Int(uv.indices[t * 3]) * 3, ib = Int(uv.indices[t * 3 + 1]) * 3, ic = Int(uv.indices[t * 3 + 2]) * 3
            let pa = SIMD3(uv.positions[ia], uv.positions[ia + 1], uv.positions[ia + 2])
            let pb = SIMD3(uv.positions[ib], uv.positions[ib + 1], uv.positions[ib + 2])
            let pc = SIMD3(uv.positions[ic], uv.positions[ic + 1], uv.positions[ic + 2])
            fCent[t] = (pa + pb + pc) / 3
            let cross = simd_cross(pb - pa, pc - pa)
            let cl = simd_length(cross)
            if cl > 1e-12 { fNorm[t] = cross / cl; fArea[t] = cl / 2 }
        }

        // Naboskap bygges FØR vinnervalget nå — plan-segmenteringen trenger det.
        // (xatlas dupliserer chart-kanter — sveis pr 2 mm.)
        let vCountU = uv.positions.count / 3
        var wid = [Int32](repeating: -1, count: vCountU)
        var weld = [Int64: Int32](minimumCapacity: vCountU)
        for i in 0..<vCountU {
            let key = (Int64((uv.positions[i * 3] * 500).rounded()) & 0x1FFFFF)
                | ((Int64((uv.positions[i * 3 + 1] * 500).rounded()) & 0x1FFFFF) << 21)
                | ((Int64((uv.positions[i * 3 + 2] * 500).rounded()) & 0x1FFFFF) << 42)
            if let w = weld[key] { wid[i] = w } else { weld[key] = Int32(i); wid[i] = Int32(i) }
        }
        var edgeFaces = [UInt64: (Int32, Int32)](minimumCapacity: triCount * 2)
        for t in 0..<triCount {
            let a = UInt64(UInt32(wid[Int(uv.indices[t * 3])]))
            let b = UInt64(UInt32(wid[Int(uv.indices[t * 3 + 1])]))
            let c = UInt64(UInt32(wid[Int(uv.indices[t * 3 + 2])]))
            for (x, y) in [(a, b), (b, c), (c, a)] {
                let key = (min(x, y) << 32) | max(x, y)
                if var f = edgeFaces[key] {
                    if f.1 < 0 && f.0 != Int32(t) { f.1 = Int32(t); edgeFaces[key] = f }
                } else { edgeFaces[key] = (Int32(t), -1) }
            }
        }
        var nbr = [Int32](repeating: -1, count: triCount * 3)
        var nbrN = [UInt8](repeating: 0, count: triCount)
        for (_, f) in edgeFaces where f.1 >= 0 {
            if nbrN[Int(f.0)] < 3 { nbr[Int(f.0) * 3 + Int(nbrN[Int(f.0)])] = f.1; nbrN[Int(f.0)] += 1 }
            if nbrN[Int(f.1)] < 3 { nbr[Int(f.1) * 3 + Int(nbrN[Int(f.1)])] = f.0; nbrN[Int(f.1)] += 1 }
        }

        // Score for (face, kandidat) — også regulariseringens gyldighetsvakt. −1 = ugyldig.
        // relaxed = redningsmodus for flater ingen frame godtar strengt: løsere terskler +
        // |facing| (ARKit-anchors har spredte flippede normaler — salt-og-pepper grå ellers).
        func scoreOf(_ t: Int, _ c: Cand, relaxed: Bool = false) -> Float {
            let centroid = fCent[t]
            let n = fNorm[t]
            if simd_length_squared(n) < 0.5 { return -1 }
            let pcam = c.w2c * SIMD4(centroid, 1)
            if pcam.z > -0.05 { return -1 }              // bak kamera (ARKit ser -z)
            let z = -pcam.z
            let u = c.intr.x * (pcam.x / z) + c.intr.z
            let vv = c.intr.y * (-pcam.y / z) + c.intr.w // bilde-y peker ned
            let margin: Float = relaxed ? 2 : 8
            if u < margin || vv < margin || u > c.imgW - margin || vv > c.imgH - margin { return -1 }
            let viewDir = simd_normalize(c.camPos - centroid)
            let facing0 = simd_dot(n, viewDir)
            let facing = relaxed ? abs(facing0) : facing0
            if facing < (relaxed ? 0.03 : 0.15) { return -1 }
            // Okklusjon: én dybdetest, ±30 cm (planens eneste geometritest).
            var depthEdge = false
            if c.dw > 0 {
                let dx = min(c.dw - 1, max(0, Int(u / c.imgW * Float(c.dw))))
                let dy = min(c.dh - 1, max(0, Int(vv / c.imgH * Float(c.dh))))
                let sceneZ = c.depth[dy * c.dw + dx]
                if sceneZ > 0.25 && z > sceneZ + (relaxed ? 0.50 : 0.30) { return -1 }
                // Dybdekant-eksklusjon (V1-lærdom): nær en dybdekant i DETTE bildet blør
                // forgrunnens kantfarge over på flaten bak. Straff hardt.
                if sceneZ > 0.25 {
                    var dmin = sceneZ, dmax = sceneZ
                    for (nx, ny) in [(dx + 2, dy), (dx - 2, dy), (dx, dy + 2), (dx, dy - 2)] {
                        guard nx >= 0, ny >= 0, nx < c.dw, ny < c.dh else { continue }
                        let dn = c.depth[ny * c.dw + nx]
                        if dn > 0.05 { dmin = min(dmin, dn); dmax = max(dmax, dn) }
                    }
                    if dmax - dmin > max(0.12, 0.06 * sceneZ) { depthEdge = true }
                }
            }
            let d2 = max(simd_length_squared(c.camPos - centroid), 0.25)
            var score = facing / d2 * (0.3 + 0.7 * c.quality)
            if depthEdge { score *= 0.05 }
            // Kant-avfall: linsekanten er fortegnet/vignettert — foretrekk sentral sikt.
            let bfx = min(u, c.imgW - u) / (c.imgW * 0.12)
            let bfy = min(vv, c.imgH - vv) / (c.imgH * 0.12)
            score *= 0.3 + 0.7 * min(1, min(bfx, bfy))
            // Myke straffer (aldri harde avslag): gjenskinn og utbrent metning.
            if c.tw > 0 {
                let tx = min(c.tw - 1, max(0, Int(u / c.imgW * Float(c.tw))))
                let ty = min(c.th - 1, max(0, Int(vv / c.imgH * Float(c.th))))
                let pix = (ty * c.tw + tx) * 4
                let r = Float(c.thumb[pix]) / 255, g = Float(c.thumb[pix + 1]) / 255, b = Float(c.thumb[pix + 2]) / 255
                let lum = 0.299 * r + 0.587 * g + 0.114 * b
                // GRADVIS utbrenthets-straff (2026-09-01). Den gamle harde terskelen
                // (lum > 0.92 → ×0.35) slapp gjennom nettopp det som gir hvite flak i taket:
                // et bilde tatt mot taket med vindu i rammen eksponerer for rommet, taket
                // brenner ut på 0.93–0.99 og beholder likevel en tredjedel av scoren. Er alle
                // kandidater omtrent like godt vinklet, vinner den utbrente.
                // Nå faller vekten jevnt fra 0.80 til 0.97, så et litt dårligere vinklet men
                // RIKTIG EKSPONERT bilde slår et utbrent. Terskel/styrke: meshscan.blowout.
                let boThresh = Float(UserDefaults.standard.string(forKey: "meshscan.blowout") ?? "") ?? 0.80
                if lum > boThresh {
                    let t = min(1, (lum - boThresh) / max(0.97 - boThresh, 1e-3))
                    score *= max(0.02, 1 - t * t * 0.98)
                }
                let mx = max(r, max(g, b)), mn = min(r, min(g, b))
                if mx > 0.9 && mx - mn < 0.02 { score *= 0.5 } // utbrent hvitt
            }
            return score
        }

        var winner = [Int32](repeating: -1, count: triCount)
        var bestScore = [Float](repeating: 0, count: triCount)
        // Topp-K per face → lavfrekvent snitt i multiband-blendingen (sheen/skygge/eksponering
        // er lavfrekvent og midles bort; detaljene beholdes fra vinneren). K > 3 gir jevnere
        // farge når mange synsvinkler dekker samme flate — ekstra runder mater dette direkte,
        // og siden bare LAVfrekvensen snittes kan bredere K ikke gi dobbeltkonturer.
        var topF = [Int32](repeating: -1, count: triCount * topK)
        var wonUVArea = 0.0, totalUVArea = 0.0
        let chunk = 4096
        let chunks = (triCount + chunk - 1) / chunk
        winner.withUnsafeMutableBufferPointer { W in
            bestScore.withUnsafeMutableBufferPointer { B in
                topF.withUnsafeMutableBufferPointer { T in
                    DispatchQueue.concurrentPerform(iterations: chunks) { ci in
                        // Skrapeminne per CHUNK (ikke per trekant) — 4096 flater deler én allokering.
                        var sK = [Float](repeating: 0, count: topK)
                        var fK = [Int32](repeating: -1, count: topK)
                        for t in (ci * chunk)..<min((ci + 1) * chunk, triCount) {
                            for j in 0..<topK { sK[j] = 0; fK[j] = -1 }
                            for (fi, c) in cands.enumerated() {
                                let s = scoreOf(t, c)
                                if s <= sK[topK - 1] { continue } // slår ikke svakeste plass (0 = ugyldig)
                                var j = topK - 1
                                while j > 0 && sK[j - 1] < s { sK[j] = sK[j - 1]; fK[j] = fK[j - 1]; j -= 1 }
                                sK[j] = s; fK[j] = Int32(fi)
                            }
                            W[t] = fK[0]
                            B[t] = sK[0]
                            for j in 0..<topK { T[t * topK + j] = fK[j] }
                        }
                    }
                }
            }
        }

        // Snapshot av EKTE topp-K per flate FØR plan-lås/ståsted trunkerer den til ett foto.
        // blend=all snitter over dette — ellers arver låste vegger sitt ENE låste foto, og
        // plan-lås-delingene («N delt») blir synlige linjer tvers over veggen (device 2026-08-25).
        let topFavg = blendAll ? topF : []

        // ── Plan-tildeling (fase B — RoomRecon/TwinTex-klassen): vegg-plan får ETT foto.
        // Null søm på flaten folk faktisk ser på, per konstruksjon. Klassen (wall=1) kommer
        // fra ARKit-meshens per-face-klassifisering, båret mesh→uv via kvantisert centroid
        // (xatlas flytter aldri vertekser, så centroidene er bit-identiske).
        var locked = [Bool](repeating: false, count: triCount)
        planeAssign: do {
            // Segmentering via de SNAPPEDE dominantplanene (fase A-utdata): flood-fill over
            // naboskap fragmenterte (9 483 segmenter på scan #8 — ARKit-normaler wobbler >10°
            // på panelvegger, og «none»-klassede flater brøt sammenhengen). Dominantplanene er
            // globalt fittet og robuste: «hvilket plan ligger flaten PÅ» kollapser fragmentene
            // til de ~12 ekte veggene. TV/bilder henger >5 cm utenpå → utenfor automatisk.
            // Vegg-plan + TAK-plan (device 2026-08-27: LED-spot «morphed into 3» — taket var
            // IKKE plan-låst, så flere vinnerfoto delte taket, og cm-drift i posene la spoten
            // på tre steder; alle tone-lags-fiksene (trim/klemme/median) var maktesløse fordi
            // kopiene ligger i VINNER-laget. Ett foto per taksegment = én spot, per
            // konstruksjon — samme RoomRecon-mekanisme som veggene, og spotlight-lærdommen
            // nedenfor (multiband AV på låste flater) er nettopp skreddersydd for takspots).
            // Dekningskravet (≥90 %) + delingen gjør det trygt der taket er tynt dekket: da
            // faller segmentet til generisk vei som før. GULV holdes utenfor: møbler/bein
            // fragmenterer segmentene, og gulv har sjelden punktlyse detaljer.
            // meshscan.ceillock = "off" → kun vegger (A/B-arm, «gammel» i RebakeAB).
            let ceilLock = UserDefaults.standard.string(forKey: "meshscan.ceillock") != "off"
            // Maks delingsdybde når ingen ENKELT foto dekker 90 % av planet. Delingen er
            // RoomRecons splitt-og-hersk, men hver deling er samtidig en ny grense — kodens
            // egen august-kommentar: «plan-lås-delingene blir synlige linjer tvers over
            // veggen». På et TSDF-nett matcher planene fotodekningen dårligere enn ARKits
            // gjorde: målt 5 låst mot 19 DELT, altså 1,3 % av flatene låst og nitten nye
            // linjer i bytte (device 2026-09-01). 0 = lås der det går, ellers som før.
            let maxPlaneSplit = Int(UserDefaults.standard.string(forKey: "meshscan.planesplit") ?? "") ?? 2
            // TAK deles likevel. Avveiningen går motsatt vei der: et tak er rommets største
            // flate, ingen enkelt foto dekker 90 % av det, og uten deling faller hele taket
            // til per-region-valg — på en hvit flate har ICM-fargetermen da nesten ingenting
            // å styre etter, og resultatet er store trekantede toneflater. På en VEGG er
            // delingen derimot ren kostnad: hver deling er en synlig linje, og vegger låses
            // ofte helt uten (device 2026-09-01: 19 delinger, 1,3 % låste flater).
            let maxCeilSplit = Int(UserDefaults.standard.string(forKey: "meshscan.ceilsplit") ?? "") ?? 2
            func splitBudget(_ faces: [Int32]) -> Int {
                guard !faces.isEmpty else { return maxPlaneSplit }
                var n = SIMD3<Float>.zero
                for tf in faces { n += fNorm[Int(tf)] * fArea[Int(tf)] }
                let nn = simd_length_squared(n) > 1e-12 ? simd_normalize(n) : SIMD3<Float>(0, 1, 0)
                return abs(nn.y) > 0.85 ? maxCeilSplit : maxPlaneSplit
            }
            let camY = kfUse.reduce(Float(0)) { $0 + $1.transform[13] } / Float(max(kfUse.count, 1))
            let lockPlanes = mesh.planes.enumerated().filter { (_, pl) in
                if abs(pl.y) < 0.35 { return true }                 // vegg
                guard ceilLock, abs(pl.y) > 0.9 else { return false } // skrå flater → generisk vei
                return pl.w / pl.y > camY + 0.3                     // horisontalt plan OVER kamera = tak
            }
            guard !lockPlanes.isEmpty else { break planeAssign }
            // Klasse som FILTER (ikke fasit): vegg eller uklassifisert slipper inn; møbelklasser holdes ute.
            var uvClass = [UInt8](repeating: 0, count: triCount)
            if !mesh.faceClass.isEmpty {
                var meshCentClass = [Int64: UInt8](minimumCapacity: mesh.faceClass.count)
                func centKey(_ p: SIMD3<Float>) -> Int64 {
                    (Int64((p.x * 2000).rounded()) & 0x1FFFFF)
                        | ((Int64((p.y * 2000).rounded()) & 0x1FFFFF) << 21)
                        | ((Int64((p.z * 2000).rounded()) & 0x1FFFFF) << 42)
                }
                for t in 0..<min(mesh.indices.count / 3, mesh.faceClass.count) {
                    let ia = Int(mesh.indices[t * 3]) * 3, ib = Int(mesh.indices[t * 3 + 1]) * 3, ic = Int(mesh.indices[t * 3 + 2]) * 3
                    let c = SIMD3(mesh.positions[ia] + mesh.positions[ib] + mesh.positions[ic],
                                  mesh.positions[ia + 1] + mesh.positions[ib + 1] + mesh.positions[ic + 1],
                                  mesh.positions[ia + 2] + mesh.positions[ib + 2] + mesh.positions[ic + 2]) / 3
                    meshCentClass[centKey(c)] = mesh.faceClass[t]
                }
                for t in 0..<triCount { uvClass[t] = meshCentClass[centKey(fCent[t])] ?? 0 }
            }
            let wallClass: UInt8 = 1
            let ceilingClass: UInt8 = 3 // ARMeshClassification.ceiling
            var planeFaces = [[Int32]](repeating: [], count: lockPlanes.count)
            for t in 0..<triCount where fArea[t] > 0 {
                let cls = uvClass[t]
                guard cls == wallClass || cls == ceilingClass || cls == 0 else { continue }
                for (slot, wp) in lockPlanes.enumerated() {
                    let n = SIMD3(wp.element.x, wp.element.y, wp.element.z)
                    // Horisontale plan: |dot| — snapDominantPlanes' normal-fortegn er ikke
                    // garantert å peke ned i rommet slik veggenes konvensjon er verifisert.
                    let align = simd_dot(fNorm[t], n)
                    guard abs(n.y) > 0.9 ? abs(align) > 0.9 : align > 0.9,
                          abs(simd_dot(n, fCent[t]) - wp.element.w) < 0.05 else { continue }
                    planeFaces[slot].append(Int32(t))
                    break
                }
            }

            // Per-plan fotovalg (TwinTex-kriteriet, forenklet): dekningsandel² × snittscore,
            // planshots (dedikerte 12MP-stills) får sterk prior. ≥90 % dekning → lås hele
            // planet til fotoet; ellers del langs lengste akse (maks 2 nivå) før fallback.
            var lockedPlanes = 0, splitPlanes = 0, fallbackPlanes = 0
            func assign(_ faces: [Int32], depth: Int) {
                let planeArea = faces.reduce(Float(0)) { $0 + fArea[Int($1)] }
                guard planeArea >= 1.0 else { return } // små plan → generisk pipeline
                let sampleStride = max(1, faces.count / 2000) // scoring på subsett, tildeling på alt
                var bestFi = -1
                var bestVal: Float = 0
                var bestCov: Float = 0
                for (fi, c) in cands.enumerated() {
                    var valid: Float = 0, scoreSum: Float = 0, sampled: Float = 0
                    var i = 0
                    while i < faces.count {
                        let t = Int(faces[i]); i += sampleStride
                        sampled += fArea[t]
                        let s = scoreOf(t, c)
                        if s > 0 { valid += fArea[t]; scoreSum += s * fArea[t] }
                    }
                    guard sampled > 0 else { continue }
                    let cov = valid / sampled
                    if cov < 0.5 { continue }
                    let val = cov * cov * (scoreSum / max(valid, 1e-6)) * ((kfUse[fi].isPlaneShot ?? false) ? 3.0 : 1.0)
                    if val > bestVal { bestVal = val; bestFi = fi; bestCov = cov }
                }
                if bestFi >= 0 && bestCov >= 0.9 {
                    let c = cands[bestFi]
                    for tf in faces {
                        let t = Int(tf)
                        guard scoreOf(t, c) > 0 || scoreOf(t, c, relaxed: true) > 0 else { continue } // okkludert rest → generisk
                        winner[t] = Int32(bestFi)
                        locked[t] = true
                        // Multiband AV på ALLE låste flater. Dette ble forsøkt slått PÅ for delte
                        // plan (2026-08-15) for å utjevne farge mellom kvadrantene — og måtte
                        // rulles tilbake samme kveld: spotlights i taket ble smurt ut.
                        // Årsaken er prinsipiell og verdt å huske: multiband henter LAVFREKVENSEN
                        // fra snittet av topp-K. En spot er en liten, blendet, lyssterk KLATT —
                        // altså nesten ren lavfrekvens. Med restdrift i posene havner klatten
                        // noen piksler fra hverandre i hver frame, og snittet smører den ut.
                        // Fargeforskjell mellom kvadranter løses derfor ADDITIVT (søm-nivellering
                        // + per-hjørne-forfining), som flytter NIVÅ uten å blande innhold og
                        // dermed ikke kan smøre. Snitting er kuren mot flekkvis farge på flate
                        // vegger og giften mot små lyssterke detaljer — her vinner detaljene.
                        topF[t * topK] = Int32(bestFi)
                        for j in 1..<topK { topF[t * topK + j] = -1 }
                    }
                    lockedPlanes += 1
                } else if depth < splitBudget(faces) && (planeArea >= 2.0 || faces.count > 400) {
                    // AREAL-basert delevakt (device-funn 2026-08-13): etter forenklingen har
                    // en hel vegg få hundre faces — gamle «>400 faces» gjorde split umulig
                    // og ALLE vegger falt til per-face-krangel (0 låst). Arealet er stabilt
                    // uansett triangeltetthet.
                    // Del langs lengste utstrekning i planets basis (RoomRecon divide-and-conquer)
                    let n = simd_normalize(faces.reduce(SIMD3<Float>.zero) { $0 + fNorm[Int($1)] * fArea[Int($1)] })
                    let up = abs(n.y) < 0.9 ? SIMD3<Float>(0, 1, 0) : SIMD3<Float>(1, 0, 0)
                    let t1 = simd_normalize(simd_cross(n, up))
                    let t2 = simd_cross(n, t1)
                    var lo1 = Float.greatestFiniteMagnitude, hi1 = -Float.greatestFiniteMagnitude
                    var lo2 = Float.greatestFiniteMagnitude, hi2 = -Float.greatestFiniteMagnitude
                    for tf in faces {
                        let p1 = simd_dot(t1, fCent[Int(tf)]), p2 = simd_dot(t2, fCent[Int(tf)])
                        lo1 = min(lo1, p1); hi1 = max(hi1, p1); lo2 = min(lo2, p2); hi2 = max(hi2, p2)
                    }
                    let axis = (hi1 - lo1) >= (hi2 - lo2) ? t1 : t2
                    let mid = ((hi1 - lo1) >= (hi2 - lo2) ? (lo1 + hi1) : (lo2 + hi2)) / 2
                    let a = faces.filter { simd_dot(axis, fCent[Int($0)]) < mid }
                    let b = faces.filter { simd_dot(axis, fCent[Int($0)]) >= mid }
                    if !a.isEmpty && !b.isEmpty {
                        splitPlanes += 1
                        assign(a, depth: depth + 1)
                        assign(b, depth: depth + 1)
                    } else { fallbackPlanes += 1 }
                } else { fallbackPlanes += 1 }
            }
            for faces in planeFaces { assign(faces, depth: 0) }
            let lockedFaceCount = locked.lazy.filter { $0 }.count
            MeshLog.log("V2 plan-tildeling — \(planeFaces.count) vegg/tak-segmenter (tak \(ceilLock ? "på" : "av")), \(lockedPlanes) låst til ett foto, \(splitPlanes) delt, \(fallbackPlanes) fallback, \(lockedFaceCount) flater låst")
        }

        // ── Vinner-regularisering (MRF-lite): plan-låste flater er ferdig tildelt og røres ikke.
        // ICM-feiing (Gauss-Seidel). To glatthetstermer, A/B via meshscan.icmcolor:
        //   "off"  = flertallsstemme — tell naboer med samme label (gammel gren)
        //   ellers = Waechters kriterium: FARGEFORSKJELLEN over sømmen.
        // Forskjellen er hva de spør om. Flertallsstemmen spør «er naboene enige med meg»,
        // altså koherens for koherensens skyld: den kan gjerne legge en søm tvers over en
        // ensfarget vegg (usynlig sted, men den teller det ikke) eller la den stå midt i en
        // kontrastkant (grelt synlig, men naboene var enige). Fargetermen spør «SYNES
        // sømmen» og legger kuttet der bildene faktisk er enige — der overgangen ikke kan
        // ses. Det er kriteriet som treffer «seamless» direkte.
        // Fargen samples fra thumbene (96 px). Det er nok til FARGE-sammenligning — søm-
        // nivelleringen nedenfor bruker samme kilde — men ville vært altfor grovt til et
        // SKARPHETS-mål; et gradientintegral her ville målt støy, ikke detalj.
        let icmColor = UserDefaults.standard.string(forKey: "meshscan.icmcolor") != "off"
        // Vekt glatthet mot dataterm. 0 = ren dataterm (maks fragmentering), stor = ren
        // koherens (kan låse en hel flate til ett dårlig bilde). Overstyrbar for tuning.
        // A/B-selen (rebakeMeshScan) sender ALLE flagg som String, mens en defaults-write
        // fra terminalen gir Double. Godta begge — ellers faller knotten stille tilbake til
        // 0.6 nettopp i den ene veien som faktisk brukes til å måle den.
        let icmLambda: Float = {
            let d = UserDefaults.standard
            if let s = d.string(forKey: "meshscan.icmlambda"), let v = Double(s) { return Float(v) }
            if let n = d.object(forKey: "meshscan.icmlambda") as? Double { return Float(n) }
            return 0.6
        }()
        // Fargeavstand (lineær RGB) der sømmen regnes som fullt synlig. Under denne bryr
        // termen seg lite; over metter den, så én grell søm ikke kan kjøpes ut med mange små.
        let seamNorm: Float = 0.12
        // sRGB→lineær som oppslag: den indre løkka kaller dette titalls millioner ganger,
        // og pow() tre ganger per sample er ren varme (regel 10).
        var srgbLin = [Float](repeating: 0, count: 256)
        for i in 0..<256 { srgbLin[i] = pow(Float(i) / 255, 2.2) }

        // Thumb-sample i LINEÆRT rom MED gain. Gainene legges ellers først på i shaderen
        // (wb-uniformen), så uten dem her ville termen målt EKSPONERINGSFORSKJELL mellom to
        // frames i stedet for uenighet om innhold — og da flyttes sømmen til feil sted.
        func sampleGained(_ p: SIMD3<Float>, _ fi: Int32) -> SIMD3<Float>? {
            guard fi >= 0 else { return nil }
            let c = cands[Int(fi)]
            guard c.tw > 0 else { return nil }
            let pcam = c.w2c * SIMD4(p, 1)
            if pcam.z > -0.05 { return nil }
            let z = -pcam.z
            let u = c.intr.x * (pcam.x / z) + c.intr.z
            let vv = c.intr.y * (-pcam.y / z) + c.intr.w
            if u < 0 || vv < 0 || u >= c.imgW || vv >= c.imgH { return nil }
            let tx = min(c.tw - 1, Int(u / c.imgW * Float(c.tw)))
            let ty = min(c.th - 1, Int(vv / c.imgH * Float(c.th)))
            let px = (ty * c.tw + tx) * 4
            let qx = u / c.imgW - 0.5, qy = vv / c.imgH - 0.5
            let devig = 1.0 + 0.15 * (qx * qx + qy * qy) * 4.0 // samme avvignettering som shaderen
            let lin = SIMD3(srgbLin[Int(c.thumb[px])], srgbLin[Int(c.thumb[px + 1])], srgbLin[Int(c.thumb[px + 2])])
            return lin * devig * gains[Int(fi)]
        }

        // Skrapeminne for naboene til ÉN flate — gjenbrukes, siden feiingen er seriell
        // (Gauss-Seidel leser naboenes ferske labels, så den kan ikke parallelliseres).
        // Naboens farge ved sømmen er fast mens vi prøver labels for flaten selv, så den
        // samples én gang per nabo i stedet for én gang per (label, nabo).
        var nbN = 0
        var nbMid = [SIMD3<Float>](repeating: .zero, count: 3)
        var nbLab = [Int32](repeating: -1, count: 3)
        var nbCol = [SIMD3<Float>](repeating: .zero, count: 3)
        var nbSeen = [Bool](repeating: false, count: 3)

        // E(label) = dataterm + λ·Σ sømkostnad mot naboene.
        // Dataterm 0 = beste tilgjengelige syn, 1 = så vidt brukbart.
        func labelEnergy(_ lab: Int32, _ sc: Float, _ best: Float, gated: Bool) -> Float {
            if gated && sc < 0.3 * best { return .infinity }   // samme brukbarhetsgate som flertallsgrenen
            var e = 1 - min(1, max(0, sc) / best)
            for k in 0..<nbN {
                if lab == nbLab[k] { continue }                // samme bilde på begge sider = ingen søm
                guard nbSeen[k], let cl = sampleGained(nbMid[k], lab) else { e += icmLambda; continue }
                e += icmLambda * min(1, simd_length(cl - nbCol[k]) / seamNorm)
            }
            return e
        }

        // Sømenergi over HELE meshen — målestokken for A/B. Summerer synlig fargesprang over
        // hver region-grense; lavere = mindre synlige sømmer.
        func totalSeamEnergy() -> (Double, Int) {
            var sum = 0.0, n = 0
            for (_, f) in edgeFaces where f.1 >= 0 {
                let a = Int(f.0), b = Int(f.1)
                let la = winner[a], lb = winner[b]
                guard la >= 0, lb >= 0, la != lb else { continue }
                let p = (fCent[a] + fCent[b]) / 2
                guard let ca = sampleGained(p, la), let cb = sampleGained(p, lb) else { continue }
                sum += Double(min(1, simd_length(ca - cb) / seamNorm)); n += 1
            }
            return (sum, n)
        }
        let (seamE0, seamN0) = icmColor ? totalSeamEnergy() : (0, 0)

        var switched = 0
        for _ in 0..<8 {
            var changed = 0
            for t in 0..<triCount where winner[t] >= 0 && !locked[t] {
                var curSame = 0
                var w0: Int32 = -1, w1: Int32 = -1, w2: Int32 = -1
                var c0 = 0, c1 = 0, c2 = 0
                for e in 0..<Int(nbrN[t]) {
                    let nw = winner[Int(nbr[t * 3 + e])]
                    if nw < 0 { continue }
                    if nw == winner[t] { curSame += 1; continue }
                    if nw == w0 { c0 += 1 } else if nw == w1 { c1 += 1 } else if nw == w2 { c2 += 1 }
                    else if w0 < 0 { w0 = nw; c0 = 1 } else if w1 < 0 { w1 = nw; c1 = 1 } else { w2 = nw; c2 = 1 }
                }
                if !icmColor {
                    var m: Int32 = -1, mc = curSame
                    if c0 > mc { m = w0; mc = c0 }
                    if c1 > mc { m = w1; mc = c1 }
                    if c2 > mc { m = w2; mc = c2 }
                    if m >= 0, scoreOf(t, cands[Int(m)]) >= 0.3 * bestScore[t] {
                        winner[t] = m; changed += 1
                    }
                    continue
                }
                // Naboenes farge ved hver søm — én gang, gjenbrukt over alle kandidatlabels.
                nbN = 0
                for e in 0..<Int(nbrN[t]) {
                    let nb = Int(nbr[t * 3 + e])
                    let nl = winner[nb]
                    if nl < 0 { continue }
                    let p = (fCent[t] + fCent[nb]) / 2
                    nbMid[nbN] = p; nbLab[nbN] = nl
                    if let c = sampleGained(p, nl) { nbCol[nbN] = c; nbSeen[nbN] = true }
                    else { nbCol[nbN] = .zero; nbSeen[nbN] = false }
                    nbN += 1
                }
                // bestScore[t] er beste OPPNÅELIGE score (satt i vinnervalget) og brukes som
                // normalisering; dagens score må måles på nytt, siden winner[t] kan ha byttet
                // i en tidligere feiing.
                let best = max(bestScore[t], 1e-6)
                let curSc = scoreOf(t, cands[Int(winner[t])])
                var bestLab = winner[t]
                var bestE = labelEnergy(winner[t], curSc, best, gated: false) // sittende label slipper gaten
                for cand in [w0, w1, w2] where cand >= 0 {
                    let sc = scoreOf(t, cands[Int(cand)])
                    if sc <= 0 { continue }
                    let e = labelEnergy(cand, sc, best, gated: true)
                    if e < bestE { bestE = e; bestLab = cand }
                }
                if bestLab != winner[t] { winner[t] = bestLab; changed += 1 }
            }
            switched += changed
            if changed == 0 { break }
        }
        if icmColor {
            let (seamE1, seamN1) = totalSeamEnergy()
            let avg0 = seamN0 > 0 ? seamE0 / Double(seamN0) : 0
            let avg1 = seamN1 > 0 ? seamE1 / Double(seamN1) : 0
            MeshLog.log(String(format: "V2 ICM-fargeterm (λ=%.2f) — sømenergi %.1f (%d par, snitt %.3f) → %.1f (%d par, snitt %.3f)",
                               icmLambda, seamE0, seamN0, avg0, seamE1, seamN1, avg1))
        }

        // Regioner = sammenhengende flater med samme vinnerbilde (grunnlag for nivellering + draw-grupper)
        var region = [Int32](repeating: -1, count: triCount)
        var regionFrame: [Int32] = []
        var regionFaces: [[Int32]] = []
        func buildRegions() {
            region = [Int32](repeating: -1, count: triCount)
            regionFrame.removeAll(keepingCapacity: true)
            regionFaces.removeAll(keepingCapacity: true)
            var stack = [Int32]()
            for t0 in 0..<triCount where winner[t0] >= 0 && region[t0] == -1 {
                let rid = Int32(regionFrame.count)
                regionFrame.append(winner[t0])
                regionFaces.append([])
                region[t0] = rid
                stack.append(Int32(t0))
                while let t = stack.popLast() {
                    regionFaces[Int(rid)].append(t)
                    for e in 0..<Int(nbrN[Int(t)]) {
                        let nb = nbr[Int(t) * 3 + e]
                        if nb >= 0 && region[Int(nb)] == -1 && winner[Int(nb)] == winner[Int(t)] {
                            region[Int(nb)] = rid; stack.append(nb)
                        }
                    }
                }
            }
        }
        buildRegions()

        // Småregion-annektering: regioner < 30 flater sluker naboen med flest delte kanter —
        // konfettien ICM ikke tok (indre øyer med sterk unær score) forsvinner her.
        var absorbed = 0
        for _ in 0..<2 {
            var mergeVotes = [Int64: Int](minimumCapacity: 4096) // (liten rid)<<32|nabo-rid → kantantall
            for (_, f) in edgeFaces where f.1 >= 0 {
                let ra = region[Int(f.0)], rb = region[Int(f.1)]
                guard ra >= 0, rb >= 0, ra != rb else { continue }
                if regionFaces[Int(ra)].count < 30 { mergeVotes[Int64(ra) << 32 | Int64(rb), default: 0] += 1 }
                if regionFaces[Int(rb)].count < 30 { mergeVotes[Int64(rb) << 32 | Int64(ra), default: 0] += 1 }
            }
            var bestTarget = [Int32: (nb: Int32, votes: Int)]()
            for (k, v) in mergeVotes {
                let rid = Int32(k >> 32), nb = Int32(k & 0xFFFFFFFF)
                if v > (bestTarget[rid]?.votes ?? 0) { bestTarget[rid] = (nb, v) }
            }
            var round = 0
            for (rid, tgt) in bestTarget {
                let label = regionFrame[Int(tgt.nb)]
                if label == regionFrame[Int(rid)] { continue }
                for t in regionFaces[Int(rid)] where !locked[Int(t)] {
                    let s = scoreOf(Int(t), cands[Int(label)], relaxed: true)
                    if s > 0 { winner[Int(t)] = label; round += 1 }
                }
            }
            absorbed += round
            if round == 0 { break }
            buildRegions()
        }

        // Redning av nakne flater (ingen frame godtok dem strengt — flippede normaler, trange
        // vinkler, dybdekant-nærhet): løsere terskler, naboenes bilde foretrekkes så regionene
        // holder seg store. Grå speckle → faktisk fotoinnhold.
        var rescued = 0
        for t in 0..<triCount where winner[t] < 0 {
            var got: Int32 = -1
            for e in 0..<Int(nbrN[t]) {
                let nw = winner[Int(nbr[t * 3 + e])]
                if nw >= 0, scoreOf(t, cands[Int(nw)], relaxed: true) > 0 { got = nw; break }
            }
            if got < 0 {
                var best: Float = 0
                for (fi, c) in cands.enumerated() {
                    let s = scoreOf(t, c, relaxed: true)
                    if s > best { best = s; got = Int32(fi) }
                }
            }
            if got >= 0 { winner[t] = got; rescued += 1 }
        }
        if rescued > 0 { buildRegions() }
        MeshLog.log("V2 regularisering — \(switched) ICM-bytter, \(absorbed) annektert, \(rescued) reddet → \(regionFrame.count) regioner")

        // ── Ståsted-valg («stand still, sweep»-doktrinen, 2026-08-13): kvaliteten dør når
        // SAMME flate mikser keyframes fra flere ståsteder (drift + eksponering mellom
        // punktene). Keyframes klynges per ståsted (~0,9 m); tak/gulv-plan velger ståsted
        // som HELE enheter (taket = «4 bilder som slåss» ellers), øvrige regioner velger
        // hver for seg — og vinnere re-plukkes KUN fra valgt ståsted. Nye ståsteder blir
        // dermed additive (fyller nytt areal), aldri korrosive. Plan-låste vegger urørt.
        var clusterOf = [Int](repeating: 0, count: cands.count)
        var clusterCenters: [SIMD3<Float>] = []
        for (fi, c) in cands.enumerated() {
            var found = -1
            for (ci, cc) in clusterCenters.enumerated() where simd_distance(cc, c.camPos) < 0.9 { found = ci; break }
            if found < 0 { found = clusterCenters.count; clusterCenters.append(c.camPos) }
            clusterOf[fi] = found
        }
        let C = clusterCenters.count
        // meshscan.stasted: "off" = hopp over ståsted-valget helt (A/B mot dagens),
        // "legacy" = gammel oppførsel (multiband AV på alle re-plukkede flater).
        // Default OFF (2026-08-25): ståsted-valget tredoblet regionantallet på hver bake
        // (788→2648 på device) og la en av de nye grensene tvers ned en dør — synlig grå søm
        // midt på en flate («kan ikke bestemme hvilket foto»). Med valget AV faller region-
        // antallet ~10× (2648→260), dør-sømmen forsvinner, og fargetermen plasserer de få
        // sømmene som er igjen. meshscan.stasted = "on" gjenoppretter det gamle — verdt å
        // sjekke på STORE åpne rom, som var grunnen valget fantes (kryss-roms-lappeteppe).
        let stastedMode = UserDefaults.standard.string(forKey: "meshscan.stasted") ?? "off"
        if C > 1 && C <= 24 && stastedMode != "off" {
            // Pass 1 (parallelt, samme stil som vinnervalget): beste score + frame PER ståsted per face
            var bestScoreC = [Float](repeating: 0, count: triCount * C)
            var bestFrameC = [Int32](repeating: -1, count: triCount * C)
            bestScoreC.withUnsafeMutableBufferPointer { BS in
                bestFrameC.withUnsafeMutableBufferPointer { BF in
                    DispatchQueue.concurrentPerform(iterations: chunks) { ci in
                        for t in (ci * chunk)..<min((ci + 1) * chunk, triCount) {
                            if winner[t] < 0 || locked[t] { continue }
                            for (fi, c) in cands.enumerated() {
                                let s = scoreOf(t, c)
                                let idx = t * C + clusterOf[fi]
                                if s > BS[idx] { BS[idx] = s; BF[idx] = Int32(fi) }
                            }
                        }
                    }
                }
            }
            // Valg-enheter: horisontale dominantplan først (tak/gulv som helhet), så regioner
            var unitOf = [Int32](repeating: -1, count: triCount)
            var unitFaces: [[Int32]] = []
            for hp in mesh.planes where abs(hp.y) > 0.8 {
                let n = SIMD3(hp.x, hp.y, hp.z)
                var faces: [Int32] = []
                for t in 0..<triCount where winner[t] >= 0 && !locked[t] && unitOf[t] < 0 {
                    if abs(simd_dot(fNorm[t], n)) > 0.9, abs(simd_dot(n, fCent[t]) - hp.w) < 0.06 {
                        faces.append(Int32(t))
                    }
                }
                if faces.count > 100 {
                    let u = Int32(unitFaces.count)
                    for t in faces { unitOf[Int(t)] = u }
                    unitFaces.append(faces)
                }
            }
            for rid in 0..<regionFaces.count {
                let faces = regionFaces[rid].filter { unitOf[Int($0)] < 0 && !locked[Int($0)] && winner[Int($0)] >= 0 }
                if faces.count > 30 {
                    let u = Int32(unitFaces.count)
                    for t in faces { unitOf[Int(t)] = u }
                    unitFaces.append(faces)
                }
            }
            var reassigned = 0
            var skippedUnits = 0, skippedFaces = 0, keptOld = 0, unseenAll = 0, relaxedUsed = 0
            // Kandidater gruppert per ståsted — den løse reservetesten under går kun over
            // ståstedets egne frames, ikke hele lista.
            var clusterCands = [[Int]](repeating: [], count: C)
            for fi in 0..<cands.count { clusterCands[clusterOf[fi]].append(fi) }
            for faces in unitFaces {
                var cov = [Float](repeating: 0, count: C)
                var sum = [Float](repeating: 0, count: C)
                var tot: Float = 0
                for tf in faces {
                    let t = Int(tf)
                    tot += fArea[t]
                    for ci in 0..<C where bestScoreC[t * C + ci] > 0 {
                        cov[ci] += fArea[t]
                        sum[ci] += bestScoreC[t * C + ci] * fArea[t]
                    }
                }
                var elected = -1
                var bestVal: Float = 0
                for ci in 0..<C where tot > 0 && cov[ci] / tot > 0.5 {
                    let f = cov[ci] / tot
                    let val = f * f * (sum[ci] / max(cov[ci], 1e-6))
                    if val > bestVal { bestVal = val; elected = ci }
                }
                // Ingen klynge dekker >50 % av enheten → enheten beholder blandede ståsteder.
                // Telles fordi det er en stille no-op: store enheter (tak/gulv velges som HELE
                // plan) har sjelden ett ståsted som ser halve flaten, og da gjør hele
                // ståsted-valget ingenting akkurat der lappeteppet er verst. Er `uten valg`
                // stor, er flising av store enheter neste steg — ikke en lavere terskel.
                guard elected >= 0 else { skippedUnits += 1; skippedFaces += faces.count; continue }
                // Reserverekkefølge for flater det VALGTE ståstedet ikke ser. Målt på device
                // (skann «Planlegging 2», 23/08): 39056 av 318991 flater — 12 % — falt hit, ti
                // ganger så mange som 50 %-porten slipper. Før falt de tilbake på «behold gammel
                // vinner», altså på hva vinnervalget tilfeldigvis hadde plukket per flate, fra
                // hvilket som helst ståsted. Nabofaces i samme hull kunne dermed havne på hvert
                // sitt ståsted, og resultatet er en TAGGETE kant midt inne i en enhet — nøyaktig
                // flekken i taket og tonespranget i sofaputene.
                // Nå faller de i stedet gjennom ståstedene i rekkefølge etter hvor mye av
                // enheten de dekker. Naboflater i samme hull lander da på SAMME reserve-ståsted,
                // så hullet blir én sammenhengende region med én ren grense — som søm-
                // nivelleringen kan lukke — i stedet for et spettet felt den ikke kan.
                var order = [elected]
                order.append(contentsOf: (0..<C).filter { $0 != elected }.sorted { cov[$0] > cov[$1] })
                for tf in faces {
                    let t = Int(tf)
                    var nf: Int32 = -1
                    var usedCluster = elected
                    for ci in order {
                        let f = bestFrameC[t * C + ci]
                        if f >= 0 { nf = f; usedCluster = ci; break }
                    }
                    // Siste ledd: flater som ingen frame ser under den STRENGE testen. Målt
                    // 23/08 var dette 40905 av 396740 (10 %) — tre ganger så mange som reserve-
                    // ståstedet reddet, og dermed den største resten av alle. Årsaken er at
                    // redningspasset i regulariseringen tildeler vinnere med `relaxed: true`
                    // (60833 flater samme kjøring), mens ståsted-valget bare så på strenge
                    // treff — så nettopp de flatene falt gjennom hele kjeden og beholdt en
                    // vinner fra et vilkårlig ståsted. Det er streifvinkler og okklusjonskanter,
                    // altså kantsonene i rommet: taket sett på skrå, sofaputene man går forbi.
                    // Samme rekkefølge som over, bare med den løse testen — koherens vinner
                    // fortsatt over score, for alternativet er ikke et bedre bilde, det er et
                    // TILFELDIG ståsted.
                    if nf < 0 {
                        for ci in order {
                            var best: Float = 0
                            var bf: Int32 = -1
                            for fi in clusterCands[ci] {
                                let s = scoreOf(t, cands[fi], relaxed: true)
                                if s > best { best = s; bf = Int32(fi) }
                            }
                            if bf >= 0 { nf = bf; usedCluster = ci; relaxedUsed += 1; break }
                        }
                    }
                    if nf >= 0 && usedCluster != elected { keptOld += 1 }
                    guard nf >= 0 else { unseenAll += 1; continue } // ingen frame ser flaten i det hele tatt
                    if winner[t] != nf { reassigned += 1 }
                    winner[t] = nf
                    if stastedMode == "legacy" {
                        topF[t * topK] = nf
                        for j in 1..<topK { topF[t * topK + j] = -1 }
                    } else {
                        // MÅLT på Tormods egen bundle (skann 15/08 21:46, 145 frames, 8 ståsteder):
                        // for frames som ser SAMME vei er medianforskjellen i luminans 8,9 % INNAD
                        // i ett ståsted, p90 27 %. Premisset «innen ett ståsted er eksponeringen
                        // konsistent» holder altså ikke — og den gamle linja slo multiband av på
                        // hver eneste re-plukkede flate nettopp i tillit til det premisset. Da satt
                        // søm-nivelleringen alene igjen med de 9 prosentene, og den fikk samtidig
                        // 2-3× flere regioner å løse (region-tellingen dobles her, hver kjøring i
                        // pipeline.log) med færre pålitelige grensepar.
                        // Nå beholdes topp-K, men KUN kandidatene fra det VALGTE ståstedet:
                        // koherens (ett ståsted) og lavfrekvent utjevning (snitt over K) samtidig.
                        // Snittet er fortsatt innenfor ett ståsted, så det kan ikke dra inn en
                        // annen eksponering — og siden bare lavfrekvensen snittes, ikke smøre.
                        var keep: [Int32] = [nf]
                        for j in 0..<topK {
                            let f = topF[t * topK + j]
                            if f >= 0, f != nf, clusterOf[Int(f)] == usedCluster { keep.append(f) }
                        }
                        for j in 0..<topK { topF[t * topK + j] = j < keep.count ? keep[j] : -1 }
                    }
                }
            }
            buildRegions()
            MeshLog.log("V2 ståsted-valg (\(stastedMode)) — \(C) ståsteder, \(unitFaces.count) enheter, \(reassigned) flater flyttet, \(skippedUnits) enheter uten valg (\(skippedFaces) flater), \(keptOld) på reserve-ståsted, \(relaxedUsed) via løs test, \(unseenAll) usett av alle")
        } else if C > 24 {
            MeshLog.log("V2 ståsted-valg hoppet over — \(C) ståsteder (> 24, uvanlig lang vandring)")
        }

        // ── Søm-nivellering (Waechter global leveling, region-konstant forenkling): mål
        // fargespranget over hver region-grense i LINEÆRT rom og løs additive offsets som
        // utjevner dem — «4 forskjellige fotos»-stegene forsvinner, teksturinnholdet består.
        var regionOfs = [SIMD3<Float>](repeating: .zero, count: regionFrame.count)
        // Per-HJØRNE forfining (se blokka nederst i samme if): én konstant per region kan ikke
        // følge en gradient, så store regioner kan bånde selv etter at spranget er borte.
        var cornerOfs = [SIMD3<Float>](repeating: .zero, count: triCount * 3)
        if regionFrame.count > 1 && regionFrame.count <= 20_000 {
            func sampleLinear(_ p: SIMD3<Float>, _ c: Cand) -> SIMD3<Float>? {
                guard c.tw > 0 else { return nil }
                let pcam = c.w2c * SIMD4(p, 1)
                if pcam.z > -0.05 { return nil }
                let z = -pcam.z
                let u = c.intr.x * (pcam.x / z) + c.intr.z
                let vv = c.intr.y * (-pcam.y / z) + c.intr.w
                if u < 0 || vv < 0 || u >= c.imgW || vv >= c.imgH { return nil }
                let tx = min(c.tw - 1, Int(u / c.imgW * Float(c.tw)))
                let ty = min(c.th - 1, Int(vv / c.imgH * Float(c.th)))
                let px = (ty * c.tw + tx) * 4
                let s = SIMD3(Float(c.thumb[px]), Float(c.thumb[px + 1]), Float(c.thumb[px + 2])) / 255
                let qx = u / c.imgW - 0.5, qy = vv / c.imgH - 0.5
                let devig = 1.0 + 0.15 * (qx * qx + qy * qy) * 4.0 // samme avvignettering som shaderen
                return SIMD3(pow(s.x, 2.2), pow(s.y, 2.2), pow(s.z, 2.2)) * devig
            }
            struct Acc { var d = SIMD3<Float>.zero; var n: Float = 0 }
            var pairAcc = [Int64: Acc]()
            for (_, f) in edgeFaces where f.1 >= 0 {
                let a = Int(f.0), b = Int(f.1)
                let ra = region[a], rb = region[b]
                guard ra >= 0, rb >= 0, ra != rb else { continue }
                let p = (fCent[a] + fCent[b]) / 2
                guard let sa = sampleLinear(p, cands[Int(winner[a])]),
                      let sb = sampleLinear(p, cands[Int(winner[b])]) else { continue }
                let lo = min(ra, rb), hi = max(ra, rb)
                let d = (ra == lo) ? sb - sa : sa - sb // Δ = c_hi − c_lo ved sømmen
                var acc = pairAcc[Int64(lo) << 32 | Int64(hi)] ?? Acc()
                acc.d += d; acc.n += 1
                pairAcc[Int64(lo) << 32 | Int64(hi)] = acc
            }
            var adj = [[(other: Int32, d: SIMD3<Float>, w: Float)]](repeating: [], count: regionFrame.count)
            var trustedPairs = 0
            // ≥3 på u-forenklet mesh (scan #8-fasiten). Forenklede meshes har store faces
            // som ofte deler bare 1-2 kanter — der må gaten ned til 2 (85 % av grensepar
            // røk på device-kjøringen 2026-08-13). Bindes derfor til forenklings-flagget.
            // Bindes til om forenklingen FAKTISK kjørte, ikke til flagget: med auto-på over
            // xatlas-taket kan mesh være forenklet selv om flagget står av, og da ville en
            // gate på 3 kastet de fleste grensepar (819/2687 på device 2026-08-15).
            let minSamples: Float = didSimplify ? 2 : 3
            for (k, a) in pairAcc {
                guard a.n >= minSamples else { continue }
                let lo = Int32(k >> 32), hi = Int32(k & 0xFFFFFFFF)
                let mean = a.d / a.n
                adj[Int(lo)].append((hi, mean, a.n))   // g_lo skal ≈ g_hi + (c_hi − c_lo)
                adj[Int(hi)].append((lo, -mean, a.n))
                trustedPairs += 1
            }
            // Areal-vektet forankring: STORE regioner definerer tonen og flytter seg knapt,
            // små lapper retter seg etter dem. (Scan #4-lærdom: svak forankring lot en
            // gjenskinns-region dra naboene lysere kjedevis — blomstrende utvasking.)
            for _ in 0..<60 { // Jacobi — få hundre regioner konvergerer lenge før 60
                var next = regionOfs
                for i in 0..<adj.count where !adj[i].isEmpty {
                    var s = SIMD3<Float>.zero
                    var w: Float = 1.0 + Float(regionFaces[i].count) * 0.05 // demping mot 0
                    for e in adj[i] { s += (regionOfs[Int(e.other)] + e.d) * e.w; w += e.w }
                    next[i] = s / w
                }
                regionOfs = next
            }
            // Klemmen hevet 0,08 → 0,13 (2026-08-15): nivelleringen er nå ALENE om å utjevne
            // farge mellom kvadranter på et delt plan (multiband er av på låste flater — se
            // plan-tildelingen), og 0,08 rakk ikke å lukke spranget mellom to fotos av samme
            // vegg. Additivt, så det kan ikke smøre; arealvekt-forankringen står igjen som vern
            // mot «blomstrende utvasking» (scan #4).
            for i in 0..<regionOfs.count {
                regionOfs[i] = simd_clamp(regionOfs[i], SIMD3(repeating: -0.13), SIMD3(repeating: 0.13))
            }
            MeshLog.log("V2 søm-nivellering — \(regionFrame.count) regioner, \(trustedPairs)/\(pairAcc.count) grensepar brukt")

            // ── Per-hjørne søm-forfining (Waechter-retning). Region-konstantene over fjerner
            // SPRANGET mellom naboregioner; resten er gradienter én konstant ikke kan følge.
            // Her måles RESTEN ved hver søm etter at region-offsetene er lagt på, halvparten
            // legges på hver side, og korreksjonen diffunderes innover i regionen med demping
            // så den toner UT i stedet for å stoppe brått ved grensen.
            // Nøkkel er (sveiset verteks, region) — samme verteks har ULIK korreksjon på hver
            // side av en søm, derfor per hjørne og ikke per uv-verteks.
            // Rent additiv lavfrekvens: ingen detalj røres → kan ikke gi dobbeltkonturer.
            // meshscan.seamlevel = "region" slår av og beholder ren region-konstant (A/B).
            if UserDefaults.standard.string(forKey: "meshscan.seamlevel") != "region" {
                let tSeam = CFAbsoluteTimeGetCurrent()
                // 1) Ankre: restspranget ved hver søm, delt likt på de to sidene.
                var anchor = [Int64: (d: SIMD3<Float>, n: Float)]()
                for (key, f) in edgeFaces where f.1 >= 0 {
                    let a = Int(f.0), b = Int(f.1)
                    let ra = region[a], rb = region[b]
                    guard ra >= 0, rb >= 0, ra != rb, winner[a] >= 0, winner[b] >= 0 else { continue }
                    let p = (fCent[a] + fCent[b]) / 2
                    guard let sa = sampleLinear(p, cands[Int(winner[a])]),
                          let sb = sampleLinear(p, cands[Int(winner[b])]) else { continue }
                    let half = ((sb + regionOfs[Int(rb)]) - (sa + regionOfs[Int(ra)])) * 0.5
                    for v in [Int64(key >> 32), Int64(key & 0xFFFFFFFF)] {
                        let ka = (v << 32) | Int64(ra), kb = (v << 32) | Int64(rb)
                        var ea = anchor[ka] ?? (.zero, 0); ea.d += half;  ea.n += 1; anchor[ka] = ea
                        var eb = anchor[kb] ?? (.zero, 0); eb.d -= half;  eb.n += 1; anchor[kb] = eb
                    }
                }
                if !anchor.isEmpty {
                    // 2) Tett indeksering av (verteks, region)-parene — dictionary-oppslag i
                    //    diffusjonsløkka ville dominert kjøretiden, så den kjører på flate arrays.
                    var dense = [Int64: Int32](minimumCapacity: triCount * 2)
                    var cornerDense = [Int32](repeating: -1, count: triCount * 3)
                    for t in 0..<triCount where region[t] >= 0 && winner[t] >= 0 {
                        let r = Int64(region[t])
                        for j in 0..<3 {
                            let k = (Int64(wid[Int(uv.indices[t * 3 + j])]) << 32) | r
                            if let d = dense[k] { cornerDense[t * 3 + j] = d }
                            else { let d = Int32(dense.count); dense[k] = d; cornerDense[t * 3 + j] = d }
                        }
                    }
                    let nD = dense.count
                    var adjHead = [Int32](repeating: -1, count: nD)
                    var adjTo = [Int32](); adjTo.reserveCapacity(triCount * 6)
                    var adjNext = [Int32](); adjNext.reserveCapacity(triCount * 6)
                    func addEdge(_ x: Int32, _ y: Int32) {
                        adjTo.append(y); adjNext.append(adjHead[Int(x)]); adjHead[Int(x)] = Int32(adjTo.count - 1)
                    }
                    for t in 0..<triCount where cornerDense[t * 3] >= 0 {
                        let a = cornerDense[t * 3], b = cornerDense[t * 3 + 1], c = cornerDense[t * 3 + 2]
                        addEdge(a, b); addEdge(b, a); addEdge(b, c); addEdge(c, b); addEdge(c, a); addEdge(a, c)
                    }
                    var val = [SIMD3<Float>](repeating: .zero, count: nD)
                    var pinned = [Bool](repeating: false, count: nD)
                    var pinnedN = 0
                    for (k, a) in anchor where a.n > 0 {
                        guard let d = dense[k] else { continue }
                        val[Int(d)] = a.d / a.n; pinned[Int(d)] = true; pinnedN += 1
                    }
                    // 3) Jacobi-diffusjon. Dempingen (0,92) gjør at korreksjonen dør ut innover
                    //    — region-konstanten eier nivået, dette eier bare overgangen.
                    var next = val
                    for _ in 0..<24 {
                        for i in 0..<nD where !pinned[i] {
                            var s = SIMD3<Float>.zero
                            var n: Float = 0
                            var e = adjHead[i]
                            while e >= 0 { s += val[Int(adjTo[Int(e)])]; n += 1; e = adjNext[Int(e)] }
                            next[i] = n > 0 ? s / n * 0.92 : .zero
                        }
                        swap(&val, &next)
                    }
                    // 0,06 → 0,09 av samme grunn som region-klemmen over: den additive banen
                    // gjør nå hele jobben. Overgangen toner uansett ut innover (demping 0,92).
                    let lim = SIMD3<Float>(repeating: 0.09)
                    for i in 0..<(triCount * 3) where cornerDense[i] >= 0 {
                        cornerOfs[i] = simd_clamp(val[Int(cornerDense[i])], -lim, lim)
                    }
                    MeshLog.log("V2 søm-forfining — \(pinnedN)/\(nD) hjørner ankret, \(Int((CFAbsoluteTimeGetCurrent() - tSeam) * 1000))ms")
                }
            }
        }
        for t in 0..<triCount {
            let ia = Int(uv.indices[t * 3]) * 2, ib = Int(uv.indices[t * 3 + 1]) * 2, ic = Int(uv.indices[t * 3 + 2]) * 2
            let a = SIMD2(uv.uvs[ia], uv.uvs[ia + 1]), b = SIMD2(uv.uvs[ib], uv.uvs[ib + 1]), c = SIMD2(uv.uvs[ic], uv.uvs[ic + 1])
            let area = Double(abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)))
            totalUVArea += area
            if winner[t] >= 0 { wonUVArea += area }
        }
        let filled = totalUVArea > 0 ? Float(wonUVArea / totalUVArea) : 0
        MeshLog.log("V2 vinnervalg — \(triCount) tris, \(kfUse.count) frames, dekket=\(Int(filled * 100))% ms=\(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))")
        let failG = ARMeshGlbExporter.TexturedExportResult(success: false, filledFraction: Double(filled), geometryPath: geometryPath)
        if filled < 0.05 { return failG }

        // ── Skjøt-bånd (kun blend=raw): flater innen K naboskritt fra en vinnergrense (to ulike
        // kildefotos). Raw-snittet bruker den EKTE topp-K KUN i båndet → tonesteget mellom to
        // plan-låste veggbiter blir en myk overgang i stedet for en grå linje, mens veggens
        // INDRE beholder sitt ene skarpe foto. Hybriden trenger ikke båndet — lavfrekvens-
        // snittet krysser grensene overalt per konstruksjon.
        var seamBand = [Bool](repeating: false, count: triCount)
        if blendRaw {
            for t in 0..<triCount where winner[t] >= 0 {
                for e in 0..<Int(nbrN[t]) {
                    let nw = winner[Int(nbr[t * 3 + e])]
                    if nw >= 0 && nw != winner[t] { seamBand[t] = true; break }
                }
            }
            // 2 skritt (~10–15cm): 6 ga 57k/97k flater i bånd på device 2026-08-26 — med ~690
            // regioner dekker 6-stegs flood fra HVER regiongrense nesten hele meshen, og de
            // plan-låste veggenes skarpe indre spises 30–60cm inn fra hver kant.
            for _ in 0..<2 {
                var nx = seamBand
                for t in 0..<triCount where !seamBand[t] && winner[t] >= 0 {
                    for e in 0..<Int(nbrN[t]) where seamBand[Int(nbr[t * 3 + e])] { nx[t] = true; break }
                }
                seamBand = nx
            }
            MeshLog.log("V2 skjøt-bånd — \(seamBand.lazy.filter { $0 }.count) flater i overgangsbånd")
        }

        // ── Vinner-forankret trim av tone-laget (meshscan.tonetrim; device 2026-08-26-nit
        // «oily» vegg): semi-gloss-SHEEN flytter seg med synsvinkelen — warpen kan aldri
        // justere den, så 3 syn = 3 svake bloom-flekker i lavfrekvensen. Kur: snitt kun syn
        // som FARGEMESSIG er enige med vinneren for flaten (gain-korrigert, lineær RGB).
        // Trimmede plasser komprimeres bort så neste ENIGE syn fra full topp-K rykker opp —
        // snittet smalner ikke mer enn nødvendig. Risiko: eksponerings-flatingen svekkes der
        // trimmen fjerner ÆRLIGE eksponeringsavvik — grålinja kan komme tilbake på plan-låste
        // skjøter; dømmes «ny vs gammel» i RebakeAB. Verdier: default/"on" = 0.12, "off", flyttall.
        var topFavgUse = topFavg
        toneTrim: if blendAll && !blendRaw && topFavg.count == triCount * topK {
            let raw = UserDefaults.standard.string(forKey: "meshscan.tonetrim")
            let thresh: Float
            switch raw {
            case "off": break toneTrim
            case nil, "on": thresh = 0.12
            default:
                guard let v = Float(raw ?? ""), v > 0 else { break toneTrim }
                thresh = v
            }
            // Gain-korrigert LINEÆR farge for (flate, frame) fra 96px-thumben — samme
            // projeksjon som scoreOf; γ2-linearisering er nok for en enighetstest.
            func thumbLin(_ t: Int, _ fi: Int32) -> SIMD3<Float>? {
                let c = cands[Int(fi)]
                guard c.tw > 0 else { return nil }
                let pcam = c.w2c * SIMD4(fCent[t], 1)
                guard pcam.z < -0.05 else { return nil }
                let z = -pcam.z
                let u = c.intr.x * (pcam.x / z) + c.intr.z
                let vv = c.intr.y * (-pcam.y / z) + c.intr.w
                guard u >= 0, vv >= 0, u < c.imgW, vv < c.imgH else { return nil }
                let tx = min(c.tw - 1, max(0, Int(u / c.imgW * Float(c.tw))))
                let ty = min(c.th - 1, max(0, Int(vv / c.imgH * Float(c.th))))
                let pix = (ty * c.tw + tx) * 4
                let s = SIMD3(Float(c.thumb[pix]), Float(c.thumb[pix + 1]), Float(c.thumb[pix + 2])) / 255
                let lin = s * s
                return gains.indices.contains(Int(fi)) ? lin * gains[Int(fi)] : lin
            }
            var trimmedN = 0, keptN = 0
            for t in 0..<triCount {
                let w = winner[t]
                guard w >= 0, Int(w) < cands.count, let wc = thumbLin(t, w) else { continue }
                var keptF = [Int32]()
                keptF.reserveCapacity(topK)
                var faceTrimmed = 0
                for j in 0..<topK {
                    let f = topFavgUse[t * topK + j]
                    guard f >= 0 else { continue }
                    if f == w { keptF.append(f); continue }
                    guard let fc = thumbLin(t, f), simd_length(fc - wc) <= thresh else { faceTrimmed += 1; continue }
                    keptF.append(f)
                }
                // Alle uenige → behold utrimmet: et tomt snitt ville gitt hull i tone-laget.
                guard !keptF.isEmpty else { continue }
                trimmedN += faceTrimmed
                keptN += keptF.count
                for j in 0..<topK { topFavgUse[t * topK + j] = j < keptF.count ? keptF[j] : -1 }
            }
            MeshLog.log(String(format: "V2 tone-trim — vinner-forankret: %d syn trimmet, snittbredde ≈ %.2f per flate (terskel %.2f)",
                               trimmedN, triCount > 0 ? Float(keptN) / Float(triCount) : 0, thresh))
        }

        // ── GPU-bake: én draw per region (gruppert per kildebilde), én tekstur resident om gangen.
        ARMeshGlbExporter.progress?("Baker tekstur…")
        guard let png = rasterize(uv: uv, winner: winner, region: region, regionFrame: regionFrame,
                                  regionOfs: regionOfs, cornerOfs: cornerOfs, topF: topF, topFavg: topFavgUse, topK: topK,
                                  seamBand: seamBand, kfUse: kfUse, gains: gains, warpGrids: warpGrids,
                                  blendAll: blendAll, blendRaw: blendRaw,
                                  framesDir: framesDir, atlasSize: atlasSize) else { return failG }

        // ── Frynse-trim (meshscan.fringetrim; device 2026-08-26-nit: hvit smurt frynse ved
        // åpen skanngrense — strukne kanttrekanter tekstureres i grazing-vinkel og smøres).
        // Fjerner KUN flater som (a) ligger på åpen mesh-kant (skanngrensen) og (b) ingen
        // kandidat så ordentlig: vinnerløs, eller beste score < 15 % av median. Trimmen skjer
        // i GLB-indeksene ETTER bake (teksturen for dem er bakt men ubrukt) → fullt rebake-
        // A/B-bar på fixtures. Sletter geometri → på som default MED 3 %-vakta under;
        // meshscan.fringetrim = "off" er kontrollarmen («gammel» i RebakeAB).
        // Vakt (dedup-havariets lærdom): kvalifiserer > 3 % av flatene er det ikke en frynse — avbryt.
        var glbIndices = uv.indices
        fringeTrim: if UserDefaults.standard.string(forKey: "meshscan.fringetrim") != "off" {
            var open = [Bool](repeating: false, count: triCount)
            for (_, f) in edgeFaces where f.1 < 0 { open[Int(f.0)] = true }
            let positive = bestScore.filter { $0 > 0 }.sorted()
            let median = positive.isEmpty ? 0 : positive[positive.count / 2]
            var dropF = [Bool](repeating: false, count: triCount)
            var n = 0
            for t in 0..<triCount where open[t] && (winner[t] < 0 || bestScore[t] < 0.15 * median) {
                dropF[t] = true; n += 1
            }
            guard n > 0 else { break fringeTrim }
            // Vakten var kalibrert for ARKit-nett. Et TSDF-nett har FLERE åpne grenseflater —
            // det dekker også det som bare ble sett fra én vinkel — og lander rundt 7 %, så
            // vakten slo av trimmen og etterlot nettopp de flossete kantene den skulle fjerne
            // (device 2026-08-31). `meshscan.fringetrim` tar nå et TALL (prosent); "on"/default
            // beholder 3 %. Taket på 25 % står igjen som vern mot havariet vakten ble laget for.
            // 3 %-VAKTA HAR RETT — IKKE HEV DEN FOR TSDF-NETT (prøvd og rullet tilbake
            // 2026-09-01). Resonnementet «TSDF har flere åpne grenseflater, altså må vakten
            // være feilkalibrert» er galt: på et TSDF-nett er det som kvalifiserer ikke
            // frynser, men EKTE geometri som bare ble dårlig sett. Med taket hevet til 12 %
            // fjernet trimmen 15 775 flater (6 % av modellen) og etterlot hull som ser ut som
            // avflasset maling over hele rommet — merkbart verre enn frynsene den skulle ta.
            // Flagget tar fortsatt et tall for eksperimentering, men defaulten er 3 % uansett
            // nettstørrelse.
            let pctFlag = UserDefaults.standard.string(forKey: "meshscan.fringetrim")
            let pct = min(25, max(1, Int(pctFlag ?? "") ?? 3))
            guard n <= max(64, triCount * pct / 100) else {
                MeshLog.log("V2 frynse-trim — AVBRUTT: \(n)/\(triCount) flater kvalifiserte (> \(pct) %), det er ikke en frynse")
                break fringeTrim
            }
            var out = [UInt32](); out.reserveCapacity(glbIndices.count)
            for t in 0..<triCount where !dropF[t] {
                out.append(glbIndices[t * 3]); out.append(glbIndices[t * 3 + 1]); out.append(glbIndices[t * 3 + 2])
            }
            glbIndices = out
            MeshLog.log("V2 frynse-trim — \(n) åpne grenseflater med grazing-tekstur fjernet fra GLB")
        }

        do {
            ARMeshGlbExporter.progress?("Skriver 3D-fil…")
            try ARMeshGlbExporter.writeTexturedGlb(positions: uv.positions, normals: uv.normals, uvs: uv.uvs,
                                                   indices: glbIndices, pngAtlas: png, to: glbURL)
            let bytes = ((try? FileManager.default.attributesOfItem(atPath: glbURL.path))?[.size] as? Int) ?? 0
            MeshLog.log("V2 bake ferdig — \(bytes / 1024 / 1024)MB atlas=\(atlasSize) fylt=\(Int(filled * 100))% geometri=\(geometryPath) totalt \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms")
            if bytes > 60_000_000 { return failG }
            return ARMeshGlbExporter.TexturedExportResult(success: true, filledFraction: Double(filled), geometryPath: geometryPath)
        } catch {
            NSLog("[MeshScanV2] GLB write failed: \(error.localizedDescription)")
            return failG
        }
    }

    // MARK: - Metal-rasterisering

    private struct CamV2 {
        var w2c: simd_float4x4
        var intr: SIMD4<Float>
        var img: SIMD4<Float> // w, h, 0, 0
        var wb: SIMD4<Float>  // lineær gain-utjevning per kanal, w ubrukt
        var ofs: SIMD4<Float> // additiv søm-nivellering per region (lineært rom)
        /// xyz = verdensrom kamera-posisjon (blend=all vinkelvekting).
        /// w = SKARPHETSEKSPONENT for snittet: hvor hardt det synet som ser flaten mest
        /// head-on skal dominere. Lav (2) = alle syn teller likt → mykt, ingen sømmer, men
        /// uskarpt fordi warpen ikke er presis nok til at et rått snitt holder detaljen.
        /// Høy (12) = nesten winner-take-all → skarpt, men sømmene kommer tilbake.
        /// Dette er den kontinuerlige knappen mellom de to ytterpunktene.
        var camPos: SIMD4<Float> = .zero
    }

    private static func rasterize(
        uv: ARMeshGlbExporter.UVUnwrapResult, winner: [Int32], region: [Int32], regionFrame: [Int32],
        regionOfs: [SIMD3<Float>], cornerOfs: [SIMD3<Float>], topF: [Int32], topFavg: [Int32], topK: Int,
        seamBand: [Bool],
        kfUse: [MeshScanPresenter.Keyframe],
        gains: [SIMD3<Float>], warpGrids: [[SIMD2<Float>]], blendAll: Bool, blendRaw: Bool,
        framesDir: URL, atlasSize: Int
    ) -> Data? {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let lib = try? device.makeLibrary(source: shaderSource, options: nil),
              let vfn = lib.makeFunction(name: "bakev2_vertex"),
              let ffn = lib.makeFunction(name: "bakev2_fragment"),
              let afn = lib.makeFunction(name: "bakev2_avg_fragment"),
              let dfn = lib.makeFunction(name: "bakev2_dilate"),
              let normfn = lib.makeFunction(name: "bakev2_norm"),
              let downfn = lib.makeFunction(name: "bakev2_down"),
              let blurfn = lib.makeFunction(name: "bakev2_blur"),
              let compfn = lib.makeFunction(name: "bakev2_composite") else { return nil }

        let pdesc = MTLRenderPipelineDescriptor()
        pdesc.vertexFunction = vfn
        pdesc.fragmentFunction = ffn
        pdesc.colorAttachments[0].pixelFormat = .rgba8Unorm_srgb
        // Snitt-pass: additiv blending inn i RGBA16F-akkumulator (farge·1 + dekning i alfa)
        let adesc = MTLRenderPipelineDescriptor()
        adesc.vertexFunction = vfn
        adesc.fragmentFunction = afn
        adesc.colorAttachments[0].pixelFormat = .rgba16Float
        adesc.colorAttachments[0].isBlendingEnabled = true
        adesc.colorAttachments[0].rgbBlendOperation = .add
        adesc.colorAttachments[0].alphaBlendOperation = .add
        adesc.colorAttachments[0].sourceRGBBlendFactor = .one
        adesc.colorAttachments[0].destinationRGBBlendFactor = .one
        adesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        adesc.colorAttachments[0].destinationAlphaBlendFactor = .one
        guard let pipeline = try? device.makeRenderPipelineState(descriptor: pdesc),
              let avgPipeline = try? device.makeRenderPipelineState(descriptor: adesc),
              let dilatePipe = try? device.makeComputePipelineState(function: dfn),
              let normPipe = try? device.makeComputePipelineState(function: normfn),
              let downPipe = try? device.makeComputePipelineState(function: downfn),
              let blurPipe = try? device.makeComputePipelineState(function: blurfn),
              let compPipe = try? device.makeComputePipelineState(function: compfn) else { return nil }

        // Interleaved verteksbuffer per HJØRNE [x,y,z,u,v,ox,oy,oz]. Per hjørne og ikke per
        // uv-verteks fordi søm-forfiningen er per (verteks, REGION): en verteks som ligger på
        // en regiongrense har ulik korreksjon på hver side, og en delt verteks kan bare bære én.
        // Indeksene blir dermed løpende hjørne-ID-er. Koster ~3× verteksminne (10 MB ved
        // xatlas-taket på 110k tris) — lite mot atlasparet.
        let triCount = winner.count
        var vdata = [Float](repeating: 0, count: triCount * 3 * 8)
        for t in 0..<triCount {
            for j in 0..<3 {
                let vi = Int(uv.indices[t * 3 + j])
                let o = (t * 3 + j) * 8
                vdata[o] = uv.positions[vi * 3]; vdata[o + 1] = uv.positions[vi * 3 + 1]; vdata[o + 2] = uv.positions[vi * 3 + 2]
                vdata[o + 3] = uv.uvs[vi * 2]; vdata[o + 4] = uv.uvs[vi * 2 + 1]
                let c = cornerOfs.indices.contains(t * 3 + j) ? cornerOfs[t * 3 + j] : .zero
                vdata[o + 5] = c.x; vdata[o + 6] = c.y; vdata[o + 7] = c.z
            }
        }
        guard let vbuf = device.makeBuffer(bytes: vdata, length: vdata.count * 4) else { return nil }

        // Indekser gruppert per REGION, sortert per kildebilde → hver frame dekodes én gang,
        // hver region får sin egen nivellerings-offset i uniformen.
        var groups = [Int32: [UInt32]]()
        for t in 0..<triCount where winner[t] >= 0 {
            groups[region[t], default: []].append(contentsOf: [UInt32(t * 3), UInt32(t * 3 + 1), UInt32(t * 3 + 2)])
        }
        var sortedIdx = [UInt32]()
        var ranges: [(frame: Int, region: Int, offset: Int, count: Int)] = []
        let regionOrder = groups.keys.sorted { (regionFrame[Int($0)], $0) < (regionFrame[Int($1)], $1) }
        for rid in regionOrder {
            let idxs = groups[rid]!
            ranges.append((Int(regionFrame[Int(rid)]), Int(rid), sortedIdx.count, idxs.count))
            sortedIdx.append(contentsOf: idxs)
        }
        guard !sortedIdx.isEmpty, let ibuf = device.makeBuffer(bytes: sortedIdx, length: sortedIdx.count * 4) else { return nil }

        let texDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                               width: atlasSize, height: atlasSize, mipmapped: false)
        texDesc.usage = [.renderTarget, .shaderRead, .shaderWrite]
        texDesc.storageMode = .private
        guard let atlasA = device.makeTexture(descriptor: texDesc),
              let atlasB = device.makeTexture(descriptor: texDesc) else { return nil }

        // Multiband-intermediater i halv/lav oppløsning (lavfrekvens trenger ikke 8K)
        let lowSize = min(atlasSize, 4096)
        let lowDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float,
                                                               width: lowSize, height: lowSize, mipmapped: false)
        lowDesc.usage = [.renderTarget, .shaderRead, .shaderWrite]
        lowDesc.storageMode = .private
        guard let avgAcc = device.makeTexture(descriptor: lowDesc),
              let tmpA = device.makeTexture(descriptor: lowDesc),
              let tmpB = device.makeTexture(descriptor: lowDesc) else { return nil }

        // ── Tone-lagets MEDIAN-modus (device 2026-08-27: LED-spot «3 different places just
        // muted» — tone-klemmen DEMPER parallakse-spøkelser, men fjerner dem ikke). Et
        // punktlys ligger på ULIKT sted i hvert av de 3 synene, så per texel er spøkelset
        // outlier i maks 1 av 3 → per-texel MEDIAN forkaster det helt, mens eksponerings-
        // flatingen består (medianen av tre eksponeringer er den midterste). Rankene
        // akkumuleres i TRE separate halvoppløselige teksturer (én flate tegnes maks én gang
        // per rank, så normaliseringen rgb/a gjenskaper synets faktiske farge eksakt) og
        // medianeres per texel før blur. meshscan.tonemedian = "off" → gammelt vektet snitt.
        var toneMedian = UserDefaults.standard.string(forKey: "meshscan.tonemedian") != "off"
        let medPipeOpt: MTLComputePipelineState? = {
            guard let fn = lib.makeFunction(name: "bakev2_median3") else { return nil }
            return try? device.makeComputePipelineState(function: fn)
        }()
        if medPipeOpt == nil { toneMedian = false }
        // Halv lav-oppløsning per rank: tone-laget blurres kraftig uansett, og 3 fulle
        // lowSize-akkumulatorer ville kostet 2×134 MB ekstra på 8k-atlas-stien (regel 8).
        var rankTex: [MTLTexture] = []
        if toneMedian {
            let rankSize = max(1024, lowSize / 2)
            let rankDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float,
                                                                    width: rankSize, height: rankSize, mipmapped: false)
            rankDesc.usage = [.renderTarget, .shaderRead]
            rankDesc.storageMode = .private
            for _ in 0..<3 {
                guard let t = device.makeTexture(descriptor: rankDesc) else { toneMedian = false; break }
                rankTex.append(t)
            }
            if rankTex.count < 3 { rankTex = []; toneMedian = false }
        }

        // ── Warp-snitt-pipeline (deles av hybridens lavfrekvens-pass og raw-grenen): additivt
        // vektet snitt (farge·vekt + vekt i alfa) som sampler gjennom warp-rutenettet.
        // Skarphet i snittet. Rått snitt av topp-K (blend=raw) fjerner sømmene, men blir
        // uskarpt fordi warpen ikke er presis nok til å holde detaljen på tvers av syn.
        // Eksponenten lar det beste synet dominere gradvis i stedet for binært: 4 var den
        // gamle faste verdien, 10–14 gir merkbart skarpere raw-bake med litt mer søm.
        let blendSharp = Float(UserDefaults.standard.string(forKey: "meshscan.blendsharp") ?? "") ?? 4
        let gW = MeshPoseRefineV2.warpGridW, gH = MeshPoseRefineV2.warpGridH
        var gdim = SIMD2<Int32>(Int32(gW), Int32(gH))
        let zeroGrid = [SIMD2<Float>](repeating: .zero, count: gW * gH)
        var waPipeOpt: MTLRenderPipelineState? = nil
        if blendAll, let wafn = lib.makeFunction(name: "bakev2_avg_warp_fragment") {
            let wadesc = MTLRenderPipelineDescriptor()
            wadesc.vertexFunction = vfn
            wadesc.fragmentFunction = wafn
            wadesc.colorAttachments[0].pixelFormat = .rgba16Float
            wadesc.colorAttachments[0].isBlendingEnabled = true
            wadesc.colorAttachments[0].rgbBlendOperation = .add
            wadesc.colorAttachments[0].alphaBlendOperation = .add
            wadesc.colorAttachments[0].sourceRGBBlendFactor = .one
            wadesc.colorAttachments[0].destinationRGBBlendFactor = .one
            wadesc.colorAttachments[0].sourceAlphaBlendFactor = .one
            wadesc.colorAttachments[0].destinationAlphaBlendFactor = .one
            waPipeOpt = try? device.makeRenderPipelineState(descriptor: wadesc)
        }

        // ── blend=raw (A/B-arm): hele teksturen = fullfrekvens-SNITT av topp-K per flate,
        // warp-justert. Ingen vinner per flate → ingen sømmer, men tonelapper der topp-K-
        // settet skifter (device 2026-08-26). Selvstendig gren som returnerer FØR vinnerløkka.
        if blendRaw {
            let fullDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float,
                                                                    width: atlasSize, height: atlasSize, mipmapped: false)
            fullDesc.usage = [.renderTarget, .shaderRead, .shaderWrite]
            fullDesc.storageMode = .private
            guard let waPipe = waPipeOpt,
                  let avgFull = device.makeTexture(descriptor: fullDesc) else { return nil }

            // Per flate: INDRE av en låst vegg bruker den plan-lås-trunkerte topF (ETT foto →
            // skarpt, bordskjøtene synes). SKJØT-BÅNDET bruker den EKTE topp-K (topFavg) → snittes
            // over begge veggfotoene, så tonesteget mellom bitene blir en myk overgang i stedet
            // for grå linje. Møbler (ikke-låst) har uansett full topp-K i topF. Slik beholdes
            // skarpheten overalt UNNTATT en smal stripe der linja lå (device 2026-08-25).
            let hasAvg = topFavg.count == triCount * topK
            let hasBand = seamBand.count == triCount
            var byFrame = [Int32: [UInt32]]()
            for t in 0..<triCount {
                let useAvg = hasAvg && hasBand && seamBand[t]
                for j in 0..<topK {
                    let f = (useAvg ? topFavg : topF)[t * topK + j]
                    guard f >= 0 else { continue }
                    byFrame[f, default: []].append(contentsOf: [UInt32(t * 3), UInt32(t * 3 + 1), UInt32(t * 3 + 2)])
                }
            }
            var idxAll = [UInt32](); var frRange = [(frame: Int, offset: Int, count: Int)]()
            for (f, idxs) in byFrame.sorted(by: { $0.key < $1.key }) {
                frRange.append((Int(f), idxAll.count, idxs.count)); idxAll.append(contentsOf: idxs)
            }
            guard !idxAll.isEmpty, let ibufA = device.makeBuffer(bytes: idxAll, length: idxAll.count * 4) else { return nil }

            var firstA = true
            for (bi, fr) in frRange.enumerated() {
                let k = kfUse[fr.frame]
                guard let cg = MeshImageIO.loadCGImage(framesDir, k.file), let rgba = MeshImageIO.rgbaBytes(cg) else { continue }
                let fdesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                                     width: cg.width, height: cg.height, mipmapped: false)
                fdesc.usage = .shaderRead
                guard let ftex = device.makeTexture(descriptor: fdesc) else { continue }
                rgba.withUnsafeBytes { raw in
                    ftex.replace(region: MTLRegionMake2D(0, 0, cg.width, cg.height), mipmapLevel: 0,
                                 withBytes: raw.baseAddress!, bytesPerRow: cg.width * 4)
                }
                var cam = CamV2(w2c: simd_inverse(simd_float4x4(columns: (
                    SIMD4(k.transform[0], k.transform[1], k.transform[2], k.transform[3]),
                    SIMD4(k.transform[4], k.transform[5], k.transform[6], k.transform[7]),
                    SIMD4(k.transform[8], k.transform[9], k.transform[10], k.transform[11]),
                    SIMD4(k.transform[12], k.transform[13], k.transform[14], k.transform[15])))),
                    intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                    img: SIMD4(Float(k.width), Float(k.height), 0, 0),
                    wb: SIMD4(gains[fr.frame], 0), ofs: SIMD4(0, 0, 0, 0),
                    // meshscan.blendsharp: 4 er den gamle faste verdien.
                    camPos: SIMD4(k.transform[12], k.transform[13], k.transform[14], blendSharp))
                var grid = (fr.frame < warpGrids.count && warpGrids[fr.frame].count == gW * gH) ? warpGrids[fr.frame] : zeroGrid
                guard let cb = queue.makeCommandBuffer() else { continue }
                let rp = MTLRenderPassDescriptor()
                rp.colorAttachments[0].texture = avgFull
                rp.colorAttachments[0].loadAction = firstA ? .clear : .load
                rp.colorAttachments[0].storeAction = .store
                rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
                guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { continue }
                enc.setRenderPipelineState(waPipe)
                enc.setVertexBuffer(vbuf, offset: 0, index: 0)
                enc.setFragmentBytes(&cam, length: MemoryLayout<CamV2>.stride, index: 0)
                enc.setFragmentBytes(&grid, length: MemoryLayout<SIMD2<Float>>.stride * gW * gH, index: 1)
                enc.setFragmentBytes(&gdim, length: MemoryLayout<SIMD2<Int32>>.stride, index: 2)
                enc.setFragmentTexture(ftex, index: 0)
                enc.drawIndexedPrimitives(type: .triangle, indexCount: fr.count, indexType: .uint32,
                                          indexBuffer: ibufA, indexBufferOffset: fr.offset * 4)
                enc.endEncoding()
                cb.commit(); cb.waitUntilCompleted()
                firstA = false
                if bi % 16 == 0 { ARMeshGlbExporter.progress?("Snitter alle syn… \(bi * 100 / max(frRange.count, 1)) %") }
            }
            // Normaliser (÷ dekning) → atlasB (srgb), så dilate atlasB→atlasA og les tilbake.
            if let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
                enc.setComputePipelineState(normPipe)
                enc.setTexture(avgFull, index: 0); enc.setTexture(atlasB, index: 1)
                let tg = MTLSize(width: 16, height: 16, depth: 1)
                enc.dispatchThreadgroups(MTLSize(width: (atlasSize + 15) / 16, height: (atlasSize + 15) / 16, depth: 1),
                                         threadsPerThreadgroup: tg)
                enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
            }
            var bsrc = atlasB, bdst = atlasA
            for _ in 0..<16 {
                guard let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { break }
                enc.setComputePipelineState(dilatePipe)
                enc.setTexture(bsrc, index: 0); enc.setTexture(bdst, index: 1)
                let tg = MTLSize(width: 16, height: 16, depth: 1)
                enc.dispatchThreadgroups(MTLSize(width: (atlasSize + 15) / 16, height: (atlasSize + 15) / 16, depth: 1),
                                         threadsPerThreadgroup: tg)
                enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                swap(&bsrc, &bdst)
            }
            let bpr = atlasSize * 4
            guard let readBuf = device.makeBuffer(length: bpr * atlasSize, options: .storageModeShared),
                  let cb = queue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() else { return nil }
            blit.copy(from: bsrc, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
                      sourceSize: MTLSize(width: atlasSize, height: atlasSize, depth: 1),
                      to: readBuf, destinationOffset: 0, destinationBytesPerRow: bpr, destinationBytesPerImage: bpr * atlasSize)
            blit.endEncoding(); cb.commit(); cb.waitUntilCompleted()
            let pixels = [UInt8](UnsafeBufferPointer(start: readBuf.contents().assumingMemoryBound(to: UInt8.self),
                                                     count: bpr * atlasSize))
            MeshLog.log("V2 blend=raw — fullfrekvens-snitt av topp-\(topK) syn per flate, \(frRange.count) frames, warp-justert")
            return MeshImageIO.jpegData(pixels, atlasSize)
        }

        // Snitt-passets indekser: alle topp-K-flater per frame. I hybriden (blendAll) brukes
        // den EKTE topp-K (topFavg, snapshottet FØR plan-lås/ståsted trunkerte til ett foto) —
        // lavfrekvensen SKAL krysse plan-grensene; det er den som visker ut tonesteget mellom
        // to låste veggbiter (grålinja) og tonelappene i taket.
        let avgTopF = (blendAll && topFavg.count == triCount * topK) ? topFavg : topF
        // Topp-3, ikke topp-K(6): objekter som stikker ut fra en plan-snappet vegg (støvsuger-
        // uttak ~2–3cm) har EKTE parallakse mellom syn — warpen retter planet, ikke det som
        // står av planet. Med 6 syn ble uttaket dobbelt-eksponert i lavfrekvensen (device
        // 2026-08-26); de 3 best skårede synene er vinkelmessig nærmest → forskyvningen
        // krymper, og 3 syn er nok til å snitte bort eksponerings-lappeteppet.
        let avgK = min(topK, 3)
        // Median-modus: indeksene grupperes per (frame, RANK) — rank j er flatens j-te beste
        // syn og tegnes inn i SIN egen akkumulator, så medianen sammenligner syn mot syn per
        // texel. Snitt-modus: alt samles som før under rank 0 → én tegning per frame i avgAcc.
        var avgIdx = [UInt32]()
        var avgRanges = [Int: [(rank: Int, offset: Int, count: Int)]]()
        do {
            var byFR = [Int64: [UInt32]]() // (frame << 2 | rank) → hjørneindekser
            for t in 0..<triCount {
                for j in 0..<avgK {
                    let f = avgTopF[t * topK + j]
                    guard f >= 0 else { continue }
                    let key = (Int64(f) << 2) | Int64(toneMedian ? j : 0)
                    byFR[key, default: []].append(contentsOf: [UInt32(t * 3), UInt32(t * 3 + 1), UInt32(t * 3 + 2)])
                }
            }
            for (key, idxs) in byFR {
                avgRanges[Int(key >> 2), default: []].append((Int(key & 3), avgIdx.count, idxs.count))
                avgIdx.append(contentsOf: idxs)
            }
        }
        guard let avgIbuf = device.makeBuffer(bytes: avgIdx.isEmpty ? [0] : avgIdx, length: max(avgIdx.count, 1) * 4) else { return nil }

        // Strømmende: dekode + tegn én keyframe om gangen (frame-antall koster tid, ikke RAM).
        // Regioner fra samme frame gjenbruker den residente teksturen; snitt-passet (multiband
        // lavfrekvens) tegnes én gang per frame mens teksturen uansett er resident.
        var first = true
        var rankFirst = [true, true, true] // clear-flagg per akkumulator (snitt-modus bruker kun [0])
        var avgDone = Set<Int>()
        var curFrame = -1
        var ftex: MTLTexture?
        for (gi, r) in ranges.enumerated() {
            let k = kfUse[r.frame]
            if r.frame != curFrame {
                ftex = nil
                if let cg = MeshImageIO.loadCGImage(framesDir, k.file),
                   let rgba = MeshImageIO.rgbaBytes(cg) {
                    let fdesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                                         width: cg.width, height: cg.height, mipmapped: false)
                    fdesc.usage = .shaderRead
                    if let tex = device.makeTexture(descriptor: fdesc) {
                        rgba.withUnsafeBytes { raw in
                            tex.replace(region: MTLRegionMake2D(0, 0, cg.width, cg.height), mipmapLevel: 0,
                                        withBytes: raw.baseAddress!, bytesPerRow: cg.width * 4)
                        }
                        ftex = tex
                    }
                }
                curFrame = r.frame
            }
            guard let ftex else { continue }
            var cam = CamV2(w2c: simd_inverse(simd_float4x4(columns: (
                SIMD4(k.transform[0], k.transform[1], k.transform[2], k.transform[3]),
                SIMD4(k.transform[4], k.transform[5], k.transform[6], k.transform[7]),
                SIMD4(k.transform[8], k.transform[9], k.transform[10], k.transform[11]),
                SIMD4(k.transform[12], k.transform[13], k.transform[14], k.transform[15])))),
                intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                img: SIMD4(Float(k.width), Float(k.height), 0, 0),
                wb: SIMD4(gains[r.frame], 0),
                ofs: SIMD4(regionOfs.indices.contains(r.region) ? regionOfs[r.region] : .zero, 0),
                camPos: SIMD4(k.transform[12], k.transform[13], k.transform[14], blendSharp))

            guard let cb = queue.makeCommandBuffer() else { continue }
            let rp = MTLRenderPassDescriptor()
            rp.colorAttachments[0].texture = atlasA
            rp.colorAttachments[0].loadAction = first ? .clear : .load
            rp.colorAttachments[0].storeAction = .store
            rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
            guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { continue }
            enc.setRenderPipelineState(pipeline)
            enc.setVertexBuffer(vbuf, offset: 0, index: 0)
            enc.setFragmentBytes(&cam, length: MemoryLayout<CamV2>.stride, index: 0)
            enc.setFragmentTexture(ftex, index: 0)
            enc.drawIndexedPrimitives(type: .triangle, indexCount: r.count, indexType: .uint32,
                                      indexBuffer: ibuf, indexBufferOffset: r.offset * 4)
            enc.endEncoding()
            // Snitt-/median-pass for denne framen (én gang): median-modus tegner én pass PER
            // RANK inn i rankens egen akkumulator; snitt-modus én samlet pass (rank 0) i avgAcc.
            if let ars = avgRanges[r.frame], !avgDone.contains(r.frame) {
                avgDone.insert(r.frame)
                for ar in ars {
                    let target: MTLTexture = toneMedian && ar.rank < rankTex.count ? rankTex[ar.rank] : avgAcc
                    let rp2 = MTLRenderPassDescriptor()
                    rp2.colorAttachments[0].texture = target
                    rp2.colorAttachments[0].loadAction = rankFirst[ar.rank] ? .clear : .load
                    rp2.colorAttachments[0].storeAction = .store
                    rp2.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
                    guard let enc2 = cb.makeRenderCommandEncoder(descriptor: rp2) else { continue }
                    // Hybrid: snittet sampler gjennom warp-rutenettet og vektes med facing⁴ —
                    // det er justeringen som gjør at lavfrekvensen ikke smører kanter på tvers
                    // av syn. Uten warp-pipeline (blend=winner): gammelt uvektet snitt.
                    if let waPipe = waPipeOpt {
                        enc2.setRenderPipelineState(waPipe)
                        enc2.setVertexBuffer(vbuf, offset: 0, index: 0)
                        enc2.setFragmentBytes(&cam, length: MemoryLayout<CamV2>.stride, index: 0)
                        var grid = (r.frame < warpGrids.count && warpGrids[r.frame].count == gW * gH)
                            ? warpGrids[r.frame] : zeroGrid
                        enc2.setFragmentBytes(&grid, length: MemoryLayout<SIMD2<Float>>.stride * gW * gH, index: 1)
                        enc2.setFragmentBytes(&gdim, length: MemoryLayout<SIMD2<Int32>>.stride, index: 2)
                    } else {
                        enc2.setRenderPipelineState(avgPipeline)
                        enc2.setVertexBuffer(vbuf, offset: 0, index: 0)
                        enc2.setFragmentBytes(&cam, length: MemoryLayout<CamV2>.stride, index: 0)
                    }
                    enc2.setFragmentTexture(ftex, index: 0)
                    enc2.drawIndexedPrimitives(type: .triangle, indexCount: ar.count, indexType: .uint32,
                                               indexBuffer: avgIbuf, indexBufferOffset: ar.offset * 4)
                    enc2.endEncoding()
                    rankFirst[ar.rank] = false
                }
            }
            cb.commit()
            cb.waitUntilCompleted()
            first = false
            if gi % 16 == 0 { ARMeshGlbExporter.progress?("Baker tekstur… \(gi * 100 / max(ranges.count, 1)) %") }
        }

        // ── Multiband-komposisjon: final = vinner + blur(snitt) − blur(vinner).
        // Lavfrekvensen (eksponering/sheen/skygge — det synlige lappeteppet) kommer fra
        // snittet av topp-K-frames; detaljene beholdes uendret fra vinneren.
        if let cb = queue.makeCommandBuffer() {
            func dispatch(_ enc: MTLComputeCommandEncoder, _ pipe: MTLComputePipelineState, _ size: Int) {
                enc.setComputePipelineState(pipe)
                let tg = MTLSize(width: 16, height: 16, depth: 1)
                enc.dispatchThreadgroups(MTLSize(width: (size + 15) / 16, height: (size + 15) / 16, depth: 1),
                                         threadsPerThreadgroup: tg)
            }
            var dirH = SIMD2<Int32>(1, 0), dirV = SIMD2<Int32>(0, 1)
            if let enc = cb.makeComputeCommandEncoder() {
                // 1) tone-lagets referanse → tmpA: per-texel MEDIAN av de tre rankene
                // (forkaster 1-av-3-outliere som parallakse-spøkelser), eller gammelt
                // normalisert snitt når median er av/utilgjengelig.
                if toneMedian, let medPipe = medPipeOpt {
                    enc.setTexture(rankTex[0], index: 0); enc.setTexture(rankTex[1], index: 1)
                    enc.setTexture(rankTex[2], index: 2); enc.setTexture(tmpA, index: 3)
                    dispatch(enc, medPipe, lowSize)
                } else {
                    enc.setTexture(avgAcc, index: 0); enc.setTexture(tmpA, index: 1)
                    dispatch(enc, normPipe, lowSize)
                }
                // 2) blur snitt: tmpA → tmpB → tmpA   (tmpA = lavAvg)
                enc.setTexture(tmpA, index: 0); enc.setTexture(tmpB, index: 1)
                enc.setBytes(&dirH, length: 8, index: 0)
                dispatch(enc, blurPipe, lowSize)
                enc.setTexture(tmpB, index: 0); enc.setTexture(tmpA, index: 1)
                enc.setBytes(&dirV, length: 8, index: 0)
                dispatch(enc, blurPipe, lowSize)
                // 3) nedskaler vinneren: atlasA → avgAcc, blur: avgAcc → tmpB → avgAcc (avgAcc = lavVinner)
                enc.setTexture(atlasA, index: 0); enc.setTexture(avgAcc, index: 1)
                dispatch(enc, downPipe, lowSize)
                enc.setTexture(avgAcc, index: 0); enc.setTexture(tmpB, index: 1)
                enc.setBytes(&dirH, length: 8, index: 0)
                dispatch(enc, blurPipe, lowSize)
                enc.setTexture(tmpB, index: 0); enc.setTexture(avgAcc, index: 1)
                enc.setBytes(&dirV, length: 8, index: 0)
                dispatch(enc, blurPipe, lowSize)
                // 4) komposisjon → atlasB, med tone-klemme (device 2026-08-27: spotlight
                // «morphed into 3» — parallakse-spøkelser fra topp-3-snittet er punkt-lyse og
                // glapp den flatevise trimmen: 96px-thumbene ved flatecentroiden ser dem ikke.
                // Per-texel-klemmen kapper dem strukturelt uansett størrelse på objektet).
                // meshscan.toneclamp: flyttall i lineær farge (default 0.08), "off" = ingen klemme.
                var maxCorr: Float = 0.08
                if let s = UserDefaults.standard.string(forKey: "meshscan.toneclamp") {
                    if s == "off" { maxCorr = 1.0 } else if let v = Float(s), v > 0 { maxCorr = v }
                }
                enc.setBytes(&maxCorr, length: 4, index: 0)
                enc.setTexture(atlasA, index: 0)
                enc.setTexture(tmpA, index: 1)
                enc.setTexture(avgAcc, index: 2)
                enc.setTexture(atlasB, index: 3)
                dispatch(enc, compPipe, atlasSize)
                enc.endEncoding()
            }
            cb.commit()
            cb.waitUntilCompleted()
        }
        if blendAll {
            MeshLog.log("V2 hybrid multiband — vinner-detalj + warp-justert lavfrekvens fra ekte topp-\(avgK) (\(toneMedian ? "median" : "snitt"))")
        }

        // Dilation (fyller chart-gutters så mipmapping/bilineær ikke drar inn svart) —
        // starter fra multiband-komposittet i atlasB
        var src = atlasB, dst = atlasA
        for _ in 0..<16 {
            guard let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { break }
            enc.setComputePipelineState(dilatePipe)
            enc.setTexture(src, index: 0)
            enc.setTexture(dst, index: 1)
            let tg = MTLSize(width: 16, height: 16, depth: 1)
            let ng = MTLSize(width: (atlasSize + 15) / 16, height: (atlasSize + 15) / 16, depth: 1)
            enc.dispatchThreadgroups(ng, threadsPerThreadgroup: tg)
            enc.endEncoding()
            cb.commit()
            cb.waitUntilCompleted()
            swap(&src, &dst)
        }

        // Readback (privat lagring → blit til delt buffer)
        let bpr = atlasSize * 4
        guard let readBuf = device.makeBuffer(length: bpr * atlasSize, options: .storageModeShared),
              let cb = queue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() else { return nil }
        blit.copy(from: src, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
                  sourceSize: MTLSize(width: atlasSize, height: atlasSize, depth: 1),
                  to: readBuf, destinationOffset: 0, destinationBytesPerRow: bpr, destinationBytesPerImage: bpr * atlasSize)
        blit.endEncoding()
        cb.commit()
        cb.waitUntilCompleted()
        let pixels = [UInt8](UnsafeBufferPointer(start: readBuf.contents().assumingMemoryBound(to: UInt8.self),
                                                 count: bpr * atlasSize))
        return MeshImageIO.jpegData(pixels, atlasSize)
    }

    // MARK: - Shader

    private static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct CamV2 { float4x4 w2c; float4 intr; float4 img; float4 wb; float4 ofs; float4 camPos; };
    struct VOutV2 { float4 position [[position]]; float3 wp; float3 ofs; };

    // 8 floats per HJØRNE: [x,y,z,u,v,ox,oy,oz]. ofs er per-hjørne søm-forfining og
    // interpoleres over flaten, så korreksjonen glir jevnt i stedet for å hoppe ved grensen.
    vertex VOutV2 bakev2_vertex(uint vid [[vertex_id]], const device float* v [[buffer(0)]]) {
        uint b = vid * 8;
        VOutV2 o;
        float2 uv = float2(v[b+3], v[b+4]);
        o.position = float4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
        o.wp = float3(v[b], v[b+1], v[b+2]);
        o.ofs = float3(v[b+5], v[b+6], v[b+7]);
        return o;
    }

    fragment float4 bakev2_fragment(VOutV2 in [[stage_in]],
                                    constant CamV2& c [[buffer(0)]],
                                    texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);                          // ARKit-kamera ser -z
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;        // bilde-y peker ned
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        // Avvignettering (~cos⁴-falloff, K=0.15): iPhone-fotos mørkner mot hjørnene — to
        // lapper fra ulike deler av ulike fotos var uenige selv med perfekt global gain.
        float2 q = uvN - 0.5;
        float devig = 1.0 + 0.15 * dot(q, q) * 4.0;
        // Gain (multiplikativ) + søm-nivellering (additiv) i LINEÆRT rom — sRGB-teksturen
        // sampler lineært, render-target skriver sRGB tilbake. c.ofs er region-konstanten
        // (nivået), in.ofs er den interpolerte per-hjørne-forfiningen (overgangen).
        float3 col = clamp(frame.sample(s, uvN).rgb * devig * c.wb.rgb + c.ofs.rgb + in.ofs, 0.0, 1.0);
        return float4(col, 1.0);
    }

    // Snitt-pass: additiv akkumulering (farge + dekning i alfa); region-offset utelates —
    // snittet er per definisjon på tvers av frames.
    fragment float4 bakev2_avg_fragment(VOutV2 in [[stage_in]],
                                        constant CamV2& c [[buffer(0)]],
                                        texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        float2 q = uvN - 0.5;
        float devig = 1.0 + 0.15 * dot(q, q) * 4.0;
        return float4(frame.sample(s, uvN).rgb * devig * c.wb.rgb, 1.0);
    }

    // Warp-justert snitt-pass (blend=all): som over, men bøyer uvN med det NORMALISERTE
    // warp-rutenettet (offset i [0,1]-bilderom, bilineær mellom kontrollpunktene) FØR
    // samplingen. Rutenettet indekseres av den projiserte uvN — samme som i refinen. Det er
    // dette som gjør snittet skarpt i stedet for smurt: alle syn peker på samme punkt.
    fragment float4 bakev2_avg_warp_fragment(VOutV2 in [[stage_in]],
                                             constant CamV2& c [[buffer(0)]],
                                             constant float2* grid [[buffer(1)]],
                                             constant int2& gdim [[buffer(2)]],
                                             texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        // Bilineær warp-offset fra rutenettet (indeksert av uvN).
        float gx = uvN.x * float(gdim.x - 1);
        float gy = uvN.y * float(gdim.y - 1);
        int cx = clamp(int(gx), 0, gdim.x - 2);
        int cy = clamp(int(gy), 0, gdim.y - 2);
        float tx = clamp(gx - float(cx), 0.0, 1.0);
        float ty = clamp(gy - float(cy), 0.0, 1.0);
        float2 o00 = grid[cy * gdim.x + cx];
        float2 o10 = grid[cy * gdim.x + cx + 1];
        float2 o01 = grid[(cy + 1) * gdim.x + cx];
        float2 o11 = grid[(cy + 1) * gdim.x + cx + 1];
        float2 off = o00 * (1 - tx) * (1 - ty) + o10 * tx * (1 - ty) + o01 * (1 - tx) * ty + o11 * tx * ty;
        uvN = clamp(uvN + off, 0.0, 1.0);
        float2 q = uvN - 0.5;
        float devig = 1.0 + 0.15 * dot(q, q) * 4.0;
        // Vinkelvekting: flaten som dette synet ser mest HEAD-ON (ortogonalt) skal dominere
        // snittet — grazing-syn bærer parallakse og gir spøkelser (LED-lenke to steder).
        // Normalen hentes fra skjermrom-deriverte av verdensposisjonen (ingen verteks-normal
        // trengs). pow(·,4) gjør vektingen aggressiv nok til å undertrykke spøkelset.
        float3 n = normalize(cross(dfdx(in.wp), dfdy(in.wp)));
        float3 viewDir = normalize(c.camPos.xyz - in.wp);
        float facing = clamp(abs(dot(n, viewDir)), 0.0, 1.0); // abs: normal-orientering er vilkårlig
        float w = pow(facing, max(c.camPos.w, 1.0)) + 1e-3;    // liten sokkel så ingen flate blir helt svart
        return float4(frame.sample(s, uvN).rgb * devig * c.wb.rgb * w, w);
    }

    kernel void bakev2_norm(texture2d<float, access::read> acc [[texture(0)]],
                            texture2d<float, access::write> dst [[texture(1)]],
                            uint2 gid [[thread_position_in_grid]]) {
        if (gid.x >= acc.get_width() || gid.y >= acc.get_height()) return;
        float4 v = acc.read(gid);
        dst.write(v.a > 0.0 ? float4(v.rgb / v.a, 1.0) : float4(0.0), gid);
    }

    // Per-texel median av de tre rank-akkumulatorene (premultiplisert farge·vekt + vekt i
    // alfa; lineær sampling av premultiplisert er korrekt, rgb/a gjenskaper synets farge).
    // 3 gyldige → per-kanal median (sum − maks − min); 2 → snitt; 1 → som den er; 0 → tomt.
    kernel void bakev2_median3(texture2d<float, access::sample> r0 [[texture(0)]],
                               texture2d<float, access::sample> r1 [[texture(1)]],
                               texture2d<float, access::sample> r2 [[texture(2)]],
                               texture2d<float, access::write> dst [[texture(3)]],
                               uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float2 q = (float2(gid) + 0.5) / float(W);
        float4 a = r0.sample(s, q), b = r1.sample(s, q), c = r2.sample(s, q);
        float3 v[3]; int n = 0;
        if (a.a > 1e-4) v[n++] = a.rgb / a.a;
        if (b.a > 1e-4) v[n++] = b.rgb / b.a;
        if (c.a > 1e-4) v[n++] = c.rgb / c.a;
        if (n == 0) { dst.write(float4(0.0), gid); return; }
        float3 m;
        if (n == 3)      m = v[0] + v[1] + v[2] - max(v[0], max(v[1], v[2])) - min(v[0], min(v[1], v[2]));
        else if (n == 2) m = (v[0] + v[1]) * 0.5;
        else             m = v[0];
        dst.write(float4(m, 1.0), gid);
    }

    kernel void bakev2_down(texture2d<float, access::sample> src [[texture(0)]],
                            texture2d<float, access::write> dst [[texture(1)]],
                            uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float2 q = (float2(gid) + 0.5) / float(W);
        float4 v = src.sample(s, q);
        dst.write(float4(v.rgb, v.a), gid);
    }

    // Separabel 9-taps gauss (stride 2 ≈ radius 8 texels), dekningsvektet så tomme
    // texels ikke drar snittet mot svart.
    kernel void bakev2_blur(texture2d<float, access::sample> src [[texture(0)]],
                            texture2d<float, access::write> dst [[texture(1)]],
                            constant int2& dir [[buffer(0)]],
                            uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        const float wts[9] = {0.05, 0.09, 0.12, 0.15, 0.18, 0.15, 0.12, 0.09, 0.05};
        float3 sum = 0.0; float asum = 0.0; float wsum = 0.0;
        for (int i = -4; i <= 4; i++) {
            float2 q = (float2(gid) + 0.5 + float2(dir * i * 2)) / float(W);
            float4 v = src.sample(s, q);
            float w = wts[i + 4];
            sum += v.rgb * v.a * w; asum += v.a * w; wsum += w;
        }
        dst.write(float4(asum > 0.0 ? sum / asum : 0.0, asum / wsum), gid);
    }

    // final = vinner + lavAvg − lavVinner (kun der begge lavfrekvenser har dekning)
    kernel void bakev2_composite(texture2d<float, access::read> win [[texture(0)]],
                                 texture2d<float, access::sample> lowAvg [[texture(1)]],
                                 texture2d<float, access::sample> lowWin [[texture(2)]],
                                 texture2d<float, access::write> dst [[texture(3)]],
                                 constant float& maxCorr [[buffer(0)]],
                                 uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        float4 w = win.read(gid);
        if (w.a == 0.0) { dst.write(float4(0.0), gid); return; }
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float2 q = (float2(gid) + 0.5) / float(W);
        float4 la = lowAvg.sample(s, q);
        float4 lw = lowWin.sample(s, q);
        // Tone-klemme: multiband-korreksjonen (snitt − vinner) er ALT tone-laget får lov å
        // endre. Parallakse-spøkelser (spotlight sett fra 3 vinkler) og innsmurt smuss er
        // STORE korreksjoner → kappes ved ±maxCorr; eksponerings-flating er små → passerer.
        float3 corr = clamp(la.rgb - lw.rgb, -maxCorr, maxCorr);
        float3 outc = (la.a > 0.3 && lw.a > 0.3) ? clamp(w.rgb + corr, 0.0, 1.0) : w.rgb;
        dst.write(float4(outc, 1.0), gid);
    }

    kernel void bakev2_dilate(texture2d<float, access::read> src [[texture(0)]],
                              texture2d<float, access::write> dst [[texture(1)]],
                              uint2 gid [[thread_position_in_grid]]) {
        uint W = src.get_width(), H = src.get_height();
        if (gid.x >= W || gid.y >= H) return;
        float4 c = src.read(gid);
        if (c.a > 0.0) { dst.write(c, gid); return; }
        float3 sum = 0.0; float n = 0.0;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            int2 q = int2(gid) + int2(dx, dy);
            if (q.x < 0 || q.y < 0 || q.x >= int(W) || q.y >= int(H)) continue;
            float4 s = src.read(uint2(q));
            if (s.a > 0.0) { sum += s.rgb; n += 1.0; }
        }
        dst.write(n > 0.0 ? float4(sum / n, 1.0) : float4(0.0), gid);
    }
    """
}
