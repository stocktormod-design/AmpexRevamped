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

    /// Diagnose-utløp (kun Mac-CLI): mottar per-flate-etiketter og raffinerte poser slik at
    /// en viewer kan tegne regionkartet. nil på enhet → ingen kostnad.
    static var debugSink: ((String, Data) -> Void)? = nil
    // Simulator-harness only: measured image offsets, normalized to source image size.
    // Applied after label selection so registration A/B keeps the same winning photos.
    static var debugImageOffsets: [Int: SIMD2<Float>] = [:]
    static var debugImageFields: [Int: [SIMD2<Float>]] = [:]
    // Optional measured wall scope for external fields; nil preserves the legacy
    // whole-image diagnostic. Never set by the live capture/bake path.
    static var debugImageFieldPlane: SIMD4<Float>? = nil
    // Harness-only quality ablation (§27): keep a nonzero fallback for weak photos.
    static var debugQualityFloor: Float = 0.3


    struct MergedMesh {
        var positions: [Float]   // world-space, 3 per vertex
        var normals: [Float]
        var indices: [UInt32]
        var triAnchor: [UInt32]  // per tri — chunket xatlas-fallback
        var planes: [SIMD4<Float>] = []  // snappede dominantplan (n.xyz, d)
        var faceClass: [UInt8] = []      // ARMeshClassification.rawValue per tri (0 = none)
        /// false = planene brukes bare til «flaten ligger på et plan» (plan-snitt), IKKE til
        /// å låse planet til ett foto (TSDF-nett: planene er finere oppdelt enn fotodekningen).
        var planeLock: Bool = true
    }

    /// Normalized source-image warp, matching bakev2_detail_uv in Metal.
    static func warpedImageUV(_ uv: SIMD2<Float>, grid: [SIMD2<Float>], width: Int, height: Int) -> SIMD2<Float> {
        guard width >= 2, height >= 2, grid.count == width * height else { return uv }
        let base = simd_clamp(uv, .zero, SIMD2(repeating: 1))
        let gx = base.x * Float(width - 1), gy = base.y * Float(height - 1)
        let x = min(width - 2, max(0, Int(gx))), y = min(height - 2, max(0, Int(gy)))
        let tx = min(1, max(0, gx - Float(x))), ty = min(1, max(0, gy - Float(y)))
        let a = grid[y * width + x] * ((1 - tx) * (1 - ty))
        let b = grid[y * width + x + 1] * (tx * (1 - ty))
        let c = grid[(y + 1) * width + x] * ((1 - tx) * ty)
        let d = grid[(y + 1) * width + x + 1] * (tx * ty)
        let off = (a + b) + (c + d)
        return simd_clamp(base + off, .zero, SIMD2(repeating: 1))
    }

    /// A planar registration belongs to the assigned wall, not every object that
    /// projects into the same photograph. Test the whole face so intersecting
    /// furniture cannot acquire a partial deformation near the plane.
    static func imageFieldApplies(plane: SIMD4<Float>, assignedPlane: Int32,
        planeNormals: [SIMD3<Float>], planeDistances: [Float],
        normal: SIMD3<Float>, corners: [SIMD3<Float>]) -> Bool {
        let slot = Int(assignedPlane), n = SIMD3(plane.x, plane.y, plane.z)
        guard slot >= 0, slot < planeNormals.count, slot < planeDistances.count,
              corners.count == 3, abs(n.y) < 0.35,
              simd_dot(n, planeNormals[slot]) > 0.999,
              abs(plane.w - planeDistances[slot]) < 0.02,
              simd_dot(normal, n) > 0.9 else { return false }
        return corners.allSatisfy { abs(simd_dot(n, $0) - plane.w) < 0.01 }
    }

    /// Dekningskravet gjelder FØR rangering. Ellers kan et nærmere foto med 89,9 %
    /// vinne over et gyldig med 91,2 %, og hele segmentet deles/faller tilbake unødig
    /// (én-runde-fixturen 2026-09-08). Bevar samme score blant de gyldige kandidatene.
    static func planeViewScore(coverage: Float, meanScore: Float, isPlaneShot: Bool) -> Float? {
        guard coverage.isFinite, coverage >= 0.9,
              meanScore.isFinite, meanScore >= 0 else { return nil }
        return coverage * coverage * meanScore * (isPlaneShot ? 3 : 1)
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
                let vp = les3Float(vBuf, geom.vertices.offset + i * geom.vertices.stride)
                let w4 = transform * SIMD4<Float>(vp.x, vp.y, vp.z, 1)
                positions.append(w4.x); positions.append(w4.y); positions.append(w4.z)
                let np = les3Float(nBuf, geom.normals.offset + i * geom.normals.stride)
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
        // STANDARD LIVE FRA 2026-09-11 (§85). Den sto tidligere av med henvisning til en
        // måling fra 5. september: 8,5 min av en 17-minutters bake på et 11×11 m rom. Det
        // tallet er fra FØR omskrivingen av fusjonen og gjelder ikke lenger — målt på
        // telefonen 11.09 tok hele TSDF-en 3,5 s (286 dybdekart lest, super-res 2,2 s,
        // GPU-fusjon 0,4 s, surface nets 0,7 s) på et 6,1 × 2,9 × 4,5 m rom, av en
        // live-bake på 22 s. Store rom er dekket av `maxVoxels` (40 M, voxelstørrelsen
        // økes automatisk) og av det minnekartlagte volumet.
        // GRUNNEN TIL AT DEN MÅ VÆRE PÅ: ARKit-nettet er anker-BLOKKER som ikke møtes —
        // målt 260 komponenter på dette skannet — og blokkgrensene står igjen som harde
        // svarte sprekker tvers over veggen i den ferdige modellen. Tormod 11.09: «ser ikke
        // ut som en single scan». Det er nøyaktig det de er: mange biter. TSDF-en smelter
        // rådybden til ÉN flate.
        // meshscan.geometry = "anchor" gir ARKit-nettet tilbake.
        if #available(iOS 14.0, *),
           UserDefaults.standard.string(forKey: "meshscan.geometry") != "anchor",
           FileManager.default.fileExists(atPath: framesDir.appendingPathComponent("dense.jsonl").path) {
            ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR…")
            if let t = MeshTsdfBuild.build(framesDir: framesDir, tillegg: mesh) {
                mesh = t
            } else {
                MeshLog.log("TSDF: bygg feilet i live-skann — beholder ARKit-nettet")
            }
        }
        return bake(mesh: mesh, keyframes: keyframes, framesDir: framesDir, to: glbURL)
    }

    // MARK: - Bake (delt av live skann og fixture-rebake)

    /// Les et tall-flagg. A/B-selen sender String, en defaults-write fra terminalen gir Double;
    /// leser man bare den ene, faller knotten stille tilbake til standardverdien i nettopp den
    /// veien man måler i (målt 2026-09-09 på meshscan.icmpotts).
    /// Avvignettering: K i `1 + K·(x²+y²)·4`, altså hvor mye hjørnene lysnes.
    /// 0,15 (30 % i hjørnet) sto hardkodet fem steder uten at noen hadde målt om det
    /// stemmer for iPhone-linsa. Er den feil, blir hvert foto over- eller underkorrigert
    /// mot kanten, og der to foto møtes står det et systematisk bånd som ingen
    /// atlasendring, tonelag eller avskygging kan fjerne. meshscan.devig er A/B-armen.
    static var devigK: Float { flaggTall("meshscan.devig", 0.15) }

    static func flaggTall(_ key: String, _ standard: Float) -> Float {
        let d = UserDefaults.standard
        if let s = d.string(forKey: key), let v = Double(s) { return Float(v) }
        if let n = d.object(forKey: key) as? Double { return Float(n) }
        return standard
    }

    static func bake(
        mesh meshIn: MergedMesh, keyframes: [MeshScanPresenter.Keyframe], framesDir: URL, to glbURL: URL
    ) -> ARMeshGlbExporter.TexturedExportResult {
        let t0 = CFAbsoluteTimeGetCurrent()
        let fail = ARMeshGlbExporter.TexturedExportResult(success: false, filledFraction: nil, geometryPath: "anchor-v2")
        // Kvaliteten er avgjort og skal IKKE handles bort for tid (Tormod 2026-09-05).
        // Farten skal komme av at pipelinen gjør mindre dumt arbeid, ikke av at
        // sluttresultatet blir dårligere. Se MeshTsdfBuild for fusjonen.
        // ── Budsjett fra REELT headroom, ikke total RAM. Den gamle grenen bandt maxKF OMVENDT
        // til atlasstørrelsen, så iPhone 13 Pro (6 GB) klarte så vidt >= 6e9 og arvet største
        // atlas + FÆRREST keyframes (96) — svakeste enhet på tyngste sti. For dekningsproblemer
        // slår keyframes atlasoppløsning, så de skalerer nå SAMME vei.
        // meshscan.budget = "legacy" gjenoppretter gammel gren for fixture-A/B.
        var atlasSize: Int
        let maxKF: Int
        var topK: Int
        if UserDefaults.standard.string(forKey: "meshscan.budget") == "legacy" {
            atlasSize = ProcessInfo.processInfo.physicalMemory >= 6_000_000_000 ? 8192 : 4096
            maxKF = atlasSize >= 8192 ? 96 : 120
            topK = 3
        } else {
            // Atlasparet (A+B) er den store posten: 8192² rgba8 ≈ 268 MB per tekstur, pluss
            // lavoppløsnings-intermediatene og lesebufferet i rasterize().
            let headroomMB = Int(MeshSimMem.available() / (1024 * 1024))
            // Termisk brems (regel 8): flere keyframes = lengre pose-refine og flere snitt-pass.
            // På en varm telefon er det billigere å levere et litt tynnere bake enn å bli strupet
            // midt i jobben — ett hakk ned på stigen, aldri under gulvet.
            let thermal = ProcessInfo.processInfo.thermalState
            let hot = thermal == .serious || thermal == .critical
            if headroomMB >= 2800 && !hot {
                atlasSize = 8192; maxKF = 200; topK = 6
            } else if headroomMB >= 2000 && !hot {
                // Målt på ny to-pass veggfixture 2026-09-09: 6144 → 8192 gir 5–7 % mer
                // detalj tett på veggen. iPhone 13 Pro rapporterte ~2070 MB headroom og
                // havnet tidligere unødvendig på 6144. Behold 160 bilder i dette sjiktet
                // så den ekstra atlasplassen ikke kombineres med høyeste frame-budsjett.
                atlasSize = 8192; maxKF = 160; topK = 6
            } else if headroomMB >= 1700 && !hot {
                atlasSize = 6144; maxKF = 160; topK = 6
            } else {
                atlasSize = 4096; maxKF = 120; topK = 4
            }
            MeshLog.log("V2 budsjett — headroom \(headroomMB)MB, termikk \(thermal.rawValue) → atlas \(atlasSize), maxKF \(maxKF), topK \(topK)")
        }
        // Fixture-A/B for texeltetthet. Live-skann bruker minnebudsjettet over; overstyringen
        // lar samme råscan sammenlignes ved 4096/6144/8192 uten en ny opptaksrunde.
        if let text = UserDefaults.standard.string(forKey: "meshscan.atlas"),
           let requested = Int(text), [4096, 6144, 8192].contains(requested) {
            atlasSize = requested
            MeshLog.log("V2 atlas overstyrt → \(atlasSize)")
        }
        // Antall syn i snittet er den DIREKTE skarphetskontrollen for blend=raw. Bildene er
        // typisk et par piksler uenige om hvor kanter går (warpen lukker bare ~8 % av det),
        // så et snitt av 6 syn arver spredningen mellom alle seks. To syn gir to pikslers
        // uskarphet; seks gir mye mer. Vinkelvekting alene skiller for dårlig når synene ser
        // flaten fra omtrent samme vinkel — da er facing nesten lik uansett eksponent.
        // 2 syn i snittet er STANDARD: hvert ekstra syn legger sin egen misalignment til
        // uskarpheten, og vinkelvekting skiller for dårlig når synene ser flaten fra omtrent
        // samme retning. Målt på enhet: 6 syn ga tydelig blur, 2 ga skarphet uten at sømmene
        // kom tilbake (fordi raw-snittet ikke VELGER, det vekter).
        // Taket var 2 (2026-09-12, §94). Med 2 syn flytter ett bytte HALVE fargen, og
        // tonelappene med saggtakk-kant blir tydelige. Med 6 flytter det en sjettedel.
        // Det var 2 fordi flere syn ga uskarphet — men det var før mikrokontrasten kjørte
        // i snitt-grenen (§89) og før snittet ble vektet etter skarphet (§94).
        topK = min(6, topK)
        if let s = UserDefaults.standard.string(forKey: "meshscan.topk"), let v = Int(s), v >= 1 {
            topK = v
            MeshLog.log("V2 topK overstyrt → \(topK)")
        }

        var faseT = CFAbsoluteTimeGetCurrent()
        func fase(_ navn: String) {
            let nå = CFAbsoluteTimeGetCurrent()
            MeshLog.log(String(format: "fase — %@: %.1fs", navn, nå - faseT))
            faseT = nå
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
        // Fixture-only tidsvindu for å måle om en ny passering ødelegger en allerede skarp
        // vegg. Ingen flagg settes i live-skann; uten begge grensene er listen identisk.
        if let fromText = UserDefaults.standard.string(forKey: "meshscan.framefrom"),
           let toText = UserDefaults.standard.string(forKey: "meshscan.frameto"),
           let from = Int(fromText), let to = Int(toText), from <= to {
            kfUse = kfUse.filter { $0.index >= from && $0.index <= to }
            MeshLog.log("V2 tidsvindu — frame \(from)…\(to), \(kfUse.count) bilder")
        }
        guard !kfUse.isEmpty else { return fail }
        fase("utvalg av bilder")

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
        // STANDARD ER «raw» (2026-09-01, etter en kveld med A/B på enhet): hele teksturen er
        // et warp-justert fullfrekvens-snitt. Multiband bruker warpen KUN i lavfrekvensen —
        // altså på det som deretter blurres bort — så sub-pixel-alignmentet fikk aldri virke
        // der smøringen mellom bilder faktisk synes. «winner»/«off» er A/B-armene.
        // STANDARD ER «winner» (2026-09-02, bekreftet på nytt 2026-09-12 — §90).
        // Snittet ble prøvd som standard og RULLET TILBAKE samme dag: det fjerner de
        // vannrette båndene (båndenergi 0,566 → 0,147 på Tormods soveromsvegg), men
        // vasker samtidig ut panelsporene — to syn er sub-pixel uenige om HVOR sporet
        // ligger, så den tynne streken blir et bredt bånd som mikrokontrasten blåser opp.
        // Og tonespennet over veggen DOBLET seg, 51 → 88 gråtrinn: flekkene med
        // saggtakk-kant er tilbake, altså §72-mosaikken. Veggen ser mindre ut som ÉN
        // vegg, ikke mer. «raw»/«multiband»/«off» er A/B-armene.
        // STANDARD ER «raw» (2026-09-12, §94 — tredje og siste runde på dette valget).
        // Vinnerveien gir hver flate ETT foto, og der to felt møtes hopper panelsporet noen
        // piksler til siden: lange rette linjer blir brutt opp i forskjøvede segmenter.
        // Snittet har ingen vinner og dermed ingen søm — sporene går hele veggen, rette.
        //
        // Prisen er skarphet på skann der atlaset har MER oppløsning enn justeringen klarer
        // å levere: snitting krever sub-texel samsvar mellom syn, og vi har ~2 texler feil.
        // Målt: panelfixturen har 0,7 mm per texel og synene er ~1,5 mm uenige, så et 3 mm
        // spor smøres. Store rom har 2–3 mm per texel og mister ingenting.
        //
        // Valget er Tormods, ordrett: «da var faktisk forgje versjon bedre selvom noen av
        // stripene i panelene var ikke skarp fordi de var iallefall rett.»
        // «winner»/«multiband»/«off» er A/B-armene.
        let blendFlag = UserDefaults.standard.string(forKey: "meshscan.blend") ?? "raw"
        let blendAll = blendFlag != "off" && blendFlag != "winner"
        let blendRaw = blendAll && blendFlag != "multiband"
        var warpGrids = [[SIMD2<Float>]]()
        if UserDefaults.standard.string(forKey: "meshscan.poserefine") != "off" {
            ARMeshGlbExporter.progress?("Justerer kameraer…")
            // GROV-TIL-FIN (2026-09-01). Refinen måler hvert bilde mot en proxy som er et
            // SNITT av alle syn — er synene uenige, er proxyen utsmurt, og da kan refinen
            // ikke se en feil som er mindre enn uskarpheten. Kjøres den rett på full
            // oppløsning, konvergerer den i et lokalt minimum: målt residual flatet ut på
            // 0.0538 og var ufølsom for både 8× finere proxy og lyshetskompensasjon.
            //
            // Ved å starte kraftig nedskalert er bare den STORE feilen synlig, og den kan
            // lukkes uten å bli forstyrret av detaljer. Hver runde skjerper proxyen, som
            // igjen lar neste runde se finere. meshscan.refinesteps = "off" for én runde.
            // MÅLT OG FORKASTET (2026-09-01): grov-til-fin [240, 480, 960] gjorde det VERRE
            // — spredningen mellom bilder gikk fra 16,7 til 26,5 px. På grove bilder er det
            // for lite informasjon til at Gauss-Newton finner riktig løsning, og de finere
            // rundene klarer ikke å rette opp det den grove låste seg til. Én runde på full
            // oppløsning er bedre. Sett meshscan.refinesteps = "pyramid" for å prøve igjen.
            // ARBEIDSOPPLØSNINGEN ER EN FRIHETSGRAD (2026-09-12). 960 er en FJERDEDEL av
            // kildefotoets 3840. Konvergerer justeringen til ±1 px der, er det ±4 px i
            // teksturen — og det er akkurat så mye panelsporene hopper over en feltgrense.
            // meshscan.refinepx setter oppløsningen direkte.
            let steps: [Int] = UserDefaults.standard.string(forKey: "meshscan.refinesteps") == "pyramid"
                ? [240, 480, 960]
                : [Int(flaggTall("meshscan.refinepx", 960))]
            for (si, px) in steps.enumerated() {
                UserDefaults.standard.set(String(px), forKey: "meshscan.warppx")
                MeshPoseRefineV2.refine(keyframes: &kfUse, positions: meshIn.positions, normals: meshIn.normals,
                                        framesDir: framesDir,
                                        // Warpen er bare nyttig på siste, skarpeste runde:
                                        // på grove bilder ville den bruke frihetsgrader på
                                        // støy, og de rigide stegene er det som teller der.
                                        forceWarp: blendAll && si == steps.count - 1,
                                        warpGridsByKF: &warpGrids)
            }
        }

        fase("pose-raffinering")
        var rasterWarpGrids = warpGrids
        if !debugImageOffsets.isEmpty {
            rasterWarpGrids = kfUse.map { k in
                let offset = debugImageOffsets[k.index] ?? .zero
                return [SIMD2<Float>](repeating: offset,
                    count: MeshPoseRefineV2.warpGridW * MeshPoseRefineV2.warpGridH)
            }
            MeshLog.log("harness — measured image offsets prepared for color and texture sampling")
        }

        if !debugImageFields.isEmpty {
            rasterWarpGrids = kfUse.map { debugImageFields[$0.index] ?? [] }
            MeshLog.log("harness — measured spatial fields prepared for color and texture sampling")
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
        // MÅLT 2026-09-05: regelen under gjorde nesten ingenting. Terskel 400k og MÅL
        // 400k betyr at et nett på 434k ble desimert til 399k — 1,1:1 — og xatlas fikk
        // hele nettet likevel: 267 s oppakking, 4,5 minutter av en 17-minutters bake.
        // Kommentaren over argumenterer selv for 250k som «en helt annen operasjon» enn
        // det skadelige taket på 60k; det er den verdien regelen skulle hatt.
        let bigMesh = mesh.indices.count / 3 > 300_000
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
            var maxEdge: Float = 0.30
            if let e = UserDefaults.standard.string(forKey: "meshscan.simplifyedge") { maxEdge = e == "off" ? 0 : (Float(e) ?? 0.30) }
            let førTris = mesh.indices.count / 3
            MeshSimplify.simplify(mesh: &mesh, targetTris: target, errorLimit: 1e-4, maxEdge: maxEdge)
            MeshLog.log("forenkling mål \(target) — \(førTris) → \(mesh.indices.count / 3) tris")
        }

        fase("geometri + forenkling")
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
        // MÅLT 2026-09-05: u-chunket xatlas på 96k tris tok 110 s av en bake på 151 s;
        // chunket på 390k tris tok 18 s samme kveld. Færre sømmer er ikke verdt 30× tiden
        // — sømmene repareres nedstrøms (nivellering/fjæring), tiden får ingen tilbake.
        // MÅLT IGJEN 2026-09-06 (pipeline.log): u-chunket 38k tris = 43,0 s (nesten hele
        // 45 s-fristen), mens chunket 50k = 29,1 s og chunket 75k = 32,8 s. U-chunket er
        // altså bare raskere for SMÅ nett — terskelen sto for høyt og kostet ~20 s på et
        // vanlig rom. 12k tris ≈ 10 s u-chunket; over det går vi rett på chunket.
        if mesh.indices.count / 3 <= 12_000 {
            unwrapped = xatlasUnwrapUVs(positions: mesh.positions, normals: mesh.normals, indices: mesh.indices,
                                        triAnchor: [], resolution: UInt32(atlasSize), timeout: 15)
        }
        if unwrapped == nil {
            lastChange = CFAbsoluteTimeGetCurrent(); lastTick = (-1, -1)
            xatlasProgressHandler = uiHandler // timeout-veien nuller handleren — må re-settes
            unwrapped = xatlasUnwrapUVs(positions: mesh.positions, normals: mesh.normals, indices: mesh.indices,
                                        triAnchor: mesh.triAnchor, resolution: UInt32(atlasSize))
        }
        let uv = unwrapped ?? ARMeshGlbExporter.boxUnwrapUVs(positions: mesh.positions, normals: mesh.normals, indices: mesh.indices)
        xatlasProgressHandler = nil
        fase("uv-atlas")
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
        // PARALLELT (2026-09-06): dybde + miniatyr per keyframe lastes på alle kjerner,
        // i hver sin plass så cands/frameMeans beholder rekkefølgen indeksene peker på.
        let kandLastet = UnsafeMutablePointer<(Cand, SIMD3<Float>)?>.allocate(capacity: kfUse.count)
        kandLastet.initialize(repeating: nil, count: kfUse.count)
        defer { kandLastet.deinitialize(count: kfUse.count); kandLastet.deallocate() }
        DispatchQueue.concurrentPerform(iterations: kfUse.count) { ki in
            let k = kfUse[ki]
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
            let mean = thumb.isEmpty ? SIMD3<Float>(0.25, 0.25, 0.25) : MeshImageIO.meanRGBLinear(thumb)
            kandLastet[ki] = (Cand(
                w2c: simd_inverse(c2w),
                camPos: SIMD3(k.transform[12], k.transform[13], k.transform[14]),
                intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                imgW: Float(k.width), imgH: Float(k.height),
                // kfQuality = felles rangering med fangsten; blurPx (predikert eksponerings-
                // uskarphet) er nil på eldre fixtures → faktor 1, gamle bakes er bit-like.
                quality: MeshScanPresenter.kfQuality(sharpness: k.sharpness / maxSharp, motion: k.motion, blurPx: k.blurPx)
                    * ((k.preLock ?? false) ? 0.6 : 1),
                depth: depth, dw: dw, dh: dh, thumb: thumb, tw: tw, th: th
            ), mean)
        }
        for ki in 0..<kfUse.count {
            // Rekkefølgen MÅ være kfUse sin — alle frame-indekser nedstrøms peker inn i cands.
            if let (c, m) = kandLastet[ki] { cands.append(c); frameMeans.append(m) }
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
                    lin *= 1.0 + MeshBakeV2.devigK * (qx * qx + qy * qy) * 4.0 // samme avvignettering som shaderen
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
            // 0.7 (0.30–1.70) er STANDARD: målt at solven konvergerer på 0.68–1.44 av seg
            // selv, altså at en smalere klemme kutter av en reell rest. Fargeforskjeller som
            // står igjen etter dette er ekte lys, ikke eksponering.
            // STANDARD 0.05 (2026-09-02). AE OG AWB ER LÅST under opptaket, så den sanne
            // gainen er ~1 for hvert bilde. Solven fant likevel 0.76–1.60: den tilpasset EKTE
            // lysforskjeller (sol på benken, gjenskinn i gulvet) som om de var eksponering, og
            // spredde feilen som fargestikk over alt bildet malte — gulvet ble blågrått der
            // fotoet er varmt beige. Med gains klemt til ±5 % halveres fargeavviket mot foto
            // (CHROMA 0.080 → 0.035) og blåstikket forsvinner. Vid klemme kun som A/B.
            var gainLo: Float = 0.95, gainHi: Float = 1.05
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
        // Retningen på den DELTE kanten, per naboplass. Brukes av linjevakten i
        // regulariseringen: en søm som følger veggens loddrette spor bryter dem ikke,
        // en som krysser dem lager et hakk i hver eneste linje.
        var nbrDir = [SIMD3<Float>](repeating: .zero, count: triCount * 3)
        // DETERMINISTISK NABOREKKEFØLGE. Denne løkka gikk over `edgeFaces` (en Dictionary), og
        // Swift randomiserer den rekkefølgen per prosess. Naboplassene ble dermed tildelt ulikt
        // fra kjøring til kjøring, og siden regulariseringen er Gauss-Seidel — den leser
        // naboenes FERSKE etiketter — endte to identiske bakes i ulike lokale minima.
        // Målt på samme skann med samme flagg: brudd i sporene 0,1822 / 0,0566 / 0,0382 % over
        // tre kjøringer. Fem gangers spredning gjør enhver A/B verdiløs, og en modell som blir
        // ulik hver gang du trykker «Bygg om» er en feil i seg selv.
        // Nå går løkka over trianglene i indeksrekkefølge og kantene i triangelets egen orden.
        for t in 0..<triCount {
            let a = UInt64(UInt32(wid[Int(uv.indices[t * 3])]))
            let b = UInt64(UInt32(wid[Int(uv.indices[t * 3 + 1])]))
            let c = UInt64(UInt32(wid[Int(uv.indices[t * 3 + 2])]))
            for (x, y) in [(a, b), (b, c), (c, a)] {
                let key = (min(x, y) << 32) | max(x, y)
                guard let f = edgeFaces[key], f.1 >= 0 else { continue }
                let annen = f.0 == Int32(t) ? f.1 : (f.1 == Int32(t) ? f.0 : -1)
                guard annen >= 0, nbrN[t] < 3 else { continue }
                var alt = false
                for k in 0..<Int(nbrN[t]) where nbr[t * 3 + k] == annen { alt = true }
                if alt { continue }
                let vx = Int(x) * 3, vy = Int(y) * 3
                var d = SIMD3<Float>(uv.positions[vy] - uv.positions[vx],
                                     uv.positions[vy + 1] - uv.positions[vx + 1],
                                     uv.positions[vy + 2] - uv.positions[vx + 2])
                let dl = simd_length(d)
                d = dl > 1e-9 ? d / dl : SIMD3<Float>(0, 1, 0)
                let slot = t * 3 + Int(nbrN[t])
                nbr[slot] = annen; nbrDir[slot] = d; nbrN[t] += 1
            }
        }

        // Score for (face, kandidat) — også regulariseringens gyldighetsvakt. −1 = ugyldig.
        // relaxed = redningsmodus for flater ingen frame godtar strengt: løsere terskler +
        // |facing| (ARKit-anchors har spredte flippede normaler — salt-og-pepper grå ellers).
        let qualityFloor = debugQualityFloor
        func scoreAt(_ centroid: SIMD3<Float>, _ n: SIMD3<Float>, _ c: Cand, relaxed: Bool = false) -> Float {
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
            // OPPLØSNING PÅ FLATEN (2026-09-10). Scoren var facing/d², men kildeoppløsningen
            // er fx·cosθ/z — altså er (piksler per meter)² proporsjonal med cos²θ/z², ikke
            // cosθ/z². Én potens av vinkelen manglet, og skrå bilder ble derfor undervurdert
            // for lite. MÅLT på et ekte skann: vinnerfotoet ga median 1013 px/m på veggen mens
            // beste tilgjengelige ga 1163, og på 21 % av veggarealet valgte baken et foto som
            // var over 25 % dårligere enn det som fantes. Et 2 mm panelspor trenger minst
            // 1000 px/m for å nå Nyquist — under det finnes ikke sporet i kilden, og veggen
            // ser utvasket ut uansett hva atlaset gjør.
            // meshscan.opplosning = "off" gir den gamle vektingen.
            let oppl = UserDefaults.standard.string(forKey: "meshscan.opplosning") != "off"
            var score = (oppl ? facing * abs(facing) : facing) / d2
                * (qualityFloor + (1 - qualityFloor) * c.quality)
            // Dybdekant-straffen var 0.05, altså nesten diskvalifiserende. Den finnes for å
            // hindre at forgrunnens kantfarge blør over på flaten bak — men en flate som
            // LIGGER på en geometrikant er ved en dybdekant i HVERT bilde, og ender dermed
            // uten brukbar vinner i det hele tatt. Da males den aldri, og resultatet er hvite
            // flak langs bord-, gulv- og møbelkanter (målt 2026-09-01: 7,6 % av synlige
            // flater, med normal UV-størrelse — altså ikke nåler, bare umalte).
            // En mild straff lar dem få det beste tilgjengelige bildet: litt kantblødning er
            // langt bedre enn ingen tekstur. meshscan.edgepenalty.
            if depthEdge {
                score *= Float(UserDefaults.standard.string(forKey: "meshscan.edgepenalty") ?? "") ?? 0.35
            }
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
        func scoreOf(_ t: Int, _ c: Cand, relaxed: Bool = false) -> Float {
            scoreAt(fCent[t], fNorm[t], c, relaxed: relaxed)
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
        /// Flaten ligger på et vegg-/takplan (uavhengig av om planet ble låst til ett foto).
        /// Driver PLAN-SNITTET: der reprojeksjonen er plan nok til at et snitt av alle syn
        /// holder detaljen — møbler er det ikke.
        var onPlane = [Bool](repeating: false, count: triCount)
        var planeOfFace = [Int32](repeating: -1, count: triCount)   // slot i planeNormals
        var planeNormals: [SIMD3<Float>] = []
        var planeDistances: [Float] = []
        var uvClass = [UInt8](repeating: 0, count: triCount)
        // Én parse for alle tall-knotter. (Statisk tvilling: MeshBakeV2.flaggTall, for kode
        // utenfor bake() — rasterize() ligger i samme type men ikke i samme skop.) A/B-selen sender String, en defaults-write fra
        // terminalen gir Double; leser man bare den ene, faller knotten STILLE tilbake til
        // standardverdien i nettopp den veien man måler i. Målt 2026-09-09: icmpotts hadde
        // bare string-veien, og 0,5 → 2 → 6 ga bit-identiske labels. Ingen ny knott uten denne.
        // Kvalitetsmodellen (§75): prosjektive foto-felt i fire fliser. Den slår også av
        // tonelaget og søm-fjæringen for HELE baken — begge blander innhold fra flere foto,
        // og det river ned nettopp det ett-kamera-feltene oppnår. Målt: med flaggene satt
        // bare på flis-rasteriseringen falt gevinsten bort (brudd 0,0467 % mot 0,0120–0,0268
        // når hele baken kjørte uten dem).
        // STANDARD OVERALT, OGSÅ LIVE (2026-09-11, §82). Den var først bare på for «Bygg om
        // modellen», med den begrunnelsen at live skulle være raskt og lite. Det var feil
        // avveining: modellen brukeren ser RETT ETTER skanningen er den han dømmer appen på,
        // og live-budsjettets 6144-atlas gir fire fliser à 6144 — altså ~915 texler per meter
        // vegg mot enkeltatlasets 622. Visuelt er forskjellen tydelig: enkeltatlaset har
        // tonelapper og tynne, brutte panelspor der flisene har rene, sammenhengende linjer.
        // Prisen er målt på begge fixturene: 19 → 31 s og 43 → 72 s bake, 12 → 37 MB og
        // 18 → 49 MB fil. Kvaliteten skal ikke handles bort for tid (Tormod 2026-09-05).
        // meshscan.kvalitet = "standard" slår den av; = "fliser" tvinger den på.
        let kvalitetValg = UserDefaults.standard.string(forKey: "meshscan.kvalitet")
        let kvalitetFliser = kvalitetValg != "standard"
        func flaggTall(_ key: String, _ standard: Float) -> Float {
            let d = UserDefaults.standard
            if let s = d.string(forKey: key), let v = Double(s) { return Float(v) }
            if let n = d.object(forKey: key) as? Double { return Float(n) }
            return standard
        }
        // ── FÅ, STORE FOTOFELT PER PLAN (2026-09-09). Uten plan-lås velger hver flate fritt,
        // og en vegg ender med et titalls fotolapper: målt 15 ulike vinnerfoto på ett 6,7 m²
        // veggplan, beste dekket 30 %, og 2,76 m søm per m² vegg. Hver søm er et sted der to
        // foto er 8–12 px uenige om hvor panelsporet går — altså et hakk i linjen. Scaniverses
        // tolv største UV-felt er til sammenligning 1,09–2,79 m², hvert tilpasset ÉTT kamera (§56).
        // ICM kan ikke rette det: den prøver bare naboenes labels, så den flytter grenser i
        // stedet for å slå sammen felt (λ 3 → 12 ga 2,76 → 2,78 m/m²).
        // Grepet er ikke lås, men å BEGRENSE kandidatene: på hvert plan over 1 m² rangeres
        // fotoene etter hvor mye av planet de faktisk ser, og flater som har valgt noe utenfor
        // topp-N flyttes til det beste av dem. Topp-2 dekker 82 % av veggplanet, topp-4 88 %.
        // Kvalitetsvakten er poenget: en flate flyttes BARE om topp-N-fotoet ser den minst
        // `planetopq` så godt som flatens eget valg. 0,85 og ikke 0,60: brudd i sporene falt
        // 0,0339 % → 0,0129 % med 0,85 og → 0,0061 % med 0,60, men sporkontrasten falt
        // samtidig 1,198 → 1,178 mot 1,019. Detalj er hele grunnen til å velge vinnerfoto.
        // Låste flater røres ikke — de er alt ett foto per plan.
        // Av med meshscan.planetopn = 0.
        func begrensPlanKandidater(_ planeFaces: [[Int32]]) {
            let topN = Int(flaggTall("meshscan.planetopn", 4))
            let topQ = flaggTall("meshscan.planetopq", 0.4)
            guard topN > 0 else { return }
            var flyttet = 0, behandlet = 0
            for faces in planeFaces {
                let frie = faces.filter { !locked[Int($0)] }
                let planeArea = frie.reduce(Float(0)) { $0 + fArea[Int($1)] }
                guard planeArea >= 1.0, frie.count > 50 else { continue }
                let stride = max(1, frie.count / 3000)
                var cov = [Float](repeating: 0, count: cands.count)
                var i = 0
                while i < frie.count {
                    let t = Int(frie[i]); i += stride
                    for (fi, c) in cands.enumerated() where scoreOf(t, c) > 0 { cov[fi] += fArea[t] }
                }
                let rank = cov.enumerated().sorted { $0.element > $1.element }
                    .prefix(topN).filter { $0.element > 0 }.map { Int32($0.offset) }
                guard !rank.isEmpty else { continue }
                behandlet += 1
                for tf in frie {
                    let t = Int(tf)
                    guard winner[t] >= 0, !rank.contains(winner[t]) else { continue }
                    let egen = scoreOf(t, cands[Int(winner[t])])
                    var best: Float = 0, bf: Int32 = -1
                    for fi in rank {
                        let sc = scoreOf(t, cands[Int(fi)])
                        if sc > best { best = sc; bf = fi }
                    }
                    if bf >= 0, best >= topQ * egen { winner[t] = bf; flyttet += 1 }
                }
            }
            if behandlet > 0 {
                MeshLog.log("V2 plan-kandidater — topp-\(topN) foto på \(behandlet) plan, \(flyttet) frie flater flyttet (kvalitetsgulv \(topQ))")
            }
        }
        // ── VEGGSONER (2026-09-09). Plan-tildelingen dekker bare en liten del av veggflaten:
        // målt på stue-fixturen lå 78 587 av 101 438 veggflater UTENFOR ethvert plan (5 cm
        // toleranse + normalkrav mot et ARKit-nett som bølger), og 226 av 267 m veggsøm — 85 %
        // — går mellom nettopp de flatene. De faller til fritt per-flate-valg, altså lappeteppet.
        // Sonene er en GROVERE inndeling laget kun for kandidatbegrensningen: retningsbøtte
        // (15° asimut) × offsetbånd (12 cm) over ALLE vegg-vendte flater. De brukes ALDRI til
        // å låse — en flate flyttes fortsatt bare når topp-N-fotoet ser den nesten like godt,
        // så et bilde eller en list som havner i veggsonen beholder sitt eget foto.
        func veggSoner() -> [[Int32]] {
            var bøtter = [Int64: [Int32]]()
            for t in 0..<triCount where fArea[t] > 0 {
                let n = fNorm[t]
                guard abs(n.y) < 0.35 else { continue }              // vegg-vendt
                let az = Int((atan2(n.z, n.x) + .pi) / (.pi / 12))   // 15°-bøtter
                let off = Int((simd_dot(n, fCent[t]) / 0.12).rounded())
                bøtter[Int64(az) << 32 | Int64(off & 0xFFFF), default: []].append(Int32(t))
            }
            return bøtter.values.filter { faces in
                faces.count > 200 && faces.reduce(Float(0)) { $0 + fArea[Int($1)] } >= 1.0
            }.sorted { $0.count > $1.count }
        }

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
            // Avstandstoleranse flate→plan. 5 cm er nok på TSDF-nett (plan-snappet), men
            // ARKit-nett (eldre fixtures) har dobbeltlag i taket 5–10 cm fra planet som ellers
            // beholder vinnerfoto og synes som «plater» mot snittet. meshscan.planetol (m).
            let planeTol = Float(UserDefaults.standard.string(forKey: "meshscan.planetol") ?? "") ?? 0.05
            for t in 0..<triCount where fArea[t] > 0 {
                let cls = uvClass[t]
                guard cls == wallClass || cls == ceilingClass || cls == 0 else { continue }
                for (slot, wp) in lockPlanes.enumerated() {
                    let n = SIMD3(wp.element.x, wp.element.y, wp.element.z)
                    // Horisontale plan: |dot| — snapDominantPlanes' normal-fortegn er ikke
                    // garantert å peke ned i rommet slik veggenes konvensjon er verifisert.
                    let align = simd_dot(fNorm[t], n)
                    guard abs(n.y) > 0.9 ? abs(align) > 0.9 : align > 0.9,
                          abs(simd_dot(n, fCent[t]) - wp.element.w) < planeTol else { continue }
                    planeFaces[slot].append(Int32(t))
                    break
                }
            }
            planeNormals = lockPlanes.map { SIMD3($0.element.x, $0.element.y, $0.element.z) }
            planeDistances = lockPlanes.map { $0.element.w }
            for (slot, faces) in planeFaces.enumerated() { for tf in faces { onPlane[Int(tf)] = true; planeOfFace[Int(tf)] = Int32(slot) } }
            if !mesh.planeLock {
                MeshLog.log("V2 plan-tildeling — \(planeFaces.count) vegg/tak-segmenter kjent (\(onPlane.lazy.filter { $0 }.count) flater på plan), låsing av — kun plan-snitt")
                // ── FÅ, STORE FOTOFELT PER PLAN (2026-09-09). Uten plan-lås velger hver
                // flate fritt, og en vegg ender med et titalls fotolapper: målt 15 ulike
                // vinnerfoto på ett 6,7 m² veggplan, beste dekket 30 %, 3,00 m søm per m².
                // Hver søm er et hakk i panelsporet — det er dette som skiller oss fra
                // Scaniverse på nært hold (deres 12 største UV-felt er 1,09–2,79 m² og hver
                // passer ÉTT kamera, §56). ICM kan ikke rette det: den prøver bare naboenes
                // labels, så den flytter grenser i stedet for å slå sammen felt (λ 3 → 12 ga
                // 3,00 → 3,02 m/m²).
                // Grepet er ikke lås, men å BEGRENSE kandidatene: på hvert plan over 1 m²
                // rangeres fotoene etter hvor mye av planet de faktisk ser, og flater som har
                // valgt noe utenfor topp-N flyttes til det beste av dem. Målt på soveromsplanet
                // dekker topp-2 82 % og topp-4 88 %, så N=4 er nok til å bære veggen.
                // Kvalitetsvakten er poenget: en flate flyttes BARE om topp-N-fotoet ser den
                // minst like godt som `planetopq` × sitt eget valg. Resten beholder sitt foto
                // og blir små øyer som areal-annekteringen tar.
                // 0,85 og ikke 0,6: målt på nærbilde av panelveggen falt brudd i sporene
                // (piksler med vertikalsprang > 6 nivå) 0,0339 % → 0,0129 % med gulv 0,85 og
                // → 0,0061 % med 0,60 — men sporkontrasten falt samtidig 1,198 → 1,178 mot
                // 1,019. 0,60 kjøper de siste bruddene med synlig mykere spor; det er feil
                // bytte. Detalj er poenget med å velge vinnerfoto i det hele tatt.
                // Av med meshscan.planetopn = 0.
                begrensPlanKandidater(planeFaces)
                break planeAssign
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
                    guard let val = planeViewScore(coverage: cov,
                        meanScore: scoreSum / max(valid, 1e-6),
                        isPlaneShot: kfUse[fi].isPlaneShot ?? false) else { continue }
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
            // Plan som IKKE ble låst (fallback + restene rundt delingene) faller ellers til
            // fritt per-flate-valg — samme lappeteppe som uten lås. Målt på stue-fixturen:
            // 8 av 23 plan endte i fallback. De får samme kandidatbegrensning som TSDF-veien.
            begrensPlanKandidater(planeFaces)
        }

        // Kandidatbegrensning også på veggsonene — der 85 % av sømmen ligger.
        // Av med meshscan.veggsoner = "off".
        if UserDefaults.standard.string(forKey: "meshscan.veggsoner") != "off" {
            let soner = veggSoner()
            if !soner.isEmpty {
                MeshLog.log("V2 veggsoner — \(soner.count) soner over plan-tildelingen")
                begrensPlanKandidater(soner)
            }
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
        let icmLambda: Float = flaggTall("meshscan.icmlambda", 3.0)
        // Fargeavstand (lineær RGB) der sømmen regnes som fullt synlig. Under denne bryr
        // termen seg lite; over metter den, så én grell søm ikke kan kjøpes ut med mange små.
        let seamNorm: Float = 0.12
        // POTTS-GULV (2026-09-02). Fargetermen alene sier at en søm over en HVIT flate er
        // usynlig (begge fotos ser hvitt i 96 px-thumben), og lar den derfor stå. Men sømmen
        // ER synlig: de to fotoene er 1–2 cm uenige om hvor takplankenes linjer går, og hver
        // søm er et hakk i linjen. Målt: taket hadde titalls regioner selv med λ=3, fordi
        // hver eneste søm kostet ~0. En fast kostnad per etikettskifte gjør at flater uten
        // fargekontrast smelter sammen til få store regioner; der fargen faktisk spriker,
        // teller fargetermen som før. meshscan.icmpotts (0 = gammel oppførsel).
        let icmPotts: Float = flaggTall("meshscan.icmpotts", 0.5)
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
            let devig = 1.0 + MeshBakeV2.devigK * (qx * qx + qy * qy) * 4.0 // samme avvignettering som shaderen
            let lin = SIMD3(srgbLin[Int(c.thumb[px])], srgbLin[Int(c.thumb[px + 1])], srgbLin[Int(c.thumb[px + 2])])
            return lin * devig * gains[Int(fi)]
        }

        // Skrapeminne for naboene til ÉN flate — gjenbrukes, siden feiingen er seriell
        // (Gauss-Seidel leser naboenes ferske labels, så den kan ikke parallelliseres).
        // Naboens farge ved sømmen er fast mens vi prøver labels for flaten selv, så den
        // samples én gang per nabo i stedet for én gang per (label, nabo).
        // LINJEVAKT (2026-09-10). Målt på et ekte fullromsskann: brudd i panelsporene var det
        // ENESTE målet der vi lå under Scaniverse-eksporten (0,0447 % mot 0,0264 %). Bruddene
        // oppstår der to foto møtes og er 8–12 px uenige om hvor sporet går. Færre sømmer var
        // prøvd til bunns (§65, §69) og stoppet der kvalitetsvakten stopper.
        // Men det er ikke ANTALL sømmer som brekker linjer — det er RETNINGEN. En søm som går
        // langs sporet flytter ingen linje; en som krysser det gir et hakk i hver linje den
        // krysser. Termen gjør derfor sømmer på tvers dyrere enn sømmer langs, og ICM flytter
        // kuttene dit de ikke synes. Linjeretningen antas loddrett (panel, karmer, lister,
        // flisfuger står i lodd) og projiseres inn i flatens plan. Kun vegg-vendte flater.
        // MÅLT OG FORKASTET som standard (2026-09-10): på et ekte fullromsskann, tre kjøringer
        // per innstilling etter determinisme-fiksen, ga vekt 2,5 median 0,0453 % brudd mot
        // 0,0455 % med termen AV. Ingen forskjell. Årsaken er trolig at trianglene i et
        // TSDF-nett er små og retningsløse: den lokale kantretningen sier lite om sømmen
        // krysser et spor på den skalaen et brudd synes, og ICM flytter uansett bare grenser
        // noen få centimeter. Termen står igjen bak meshscan.linjevekt for et senere forsøk
        // med grovere sømgeometri. Standard 0 = av.
        let linjeVekt = flaggTall("meshscan.linjevekt", 0)
        var nbN = 0
        var tCur = 0
        var nbDir = [SIMD3<Float>](repeating: .zero, count: 3)
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
                var retning: Float = 1
                if linjeVekt > 0, abs(fNorm[tCur].y) < 0.35 {
                    let opp = SIMD3<Float>(0, 1, 0) - fNorm[tCur] * fNorm[tCur].y
                    let ol = simd_length(opp)
                    if ol > 1e-6 {
                        // 1 = sømmen følger sporet, 0 = den krysser det
                        let langs = abs(simd_dot(nbDir[k], opp / ol))
                        retning = 1 + linjeVekt * (1 - langs)
                    }
                }
                guard nbSeen[k], let cl = sampleGained(nbMid[k], lab) else { e += icmLambda * retning * (1 + icmPotts); continue }
                e += icmLambda * retning * (icmPotts + min(1, simd_length(cl - nbCol[k]) / seamNorm))
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
                tCur = t
                for e in 0..<Int(nbrN[t]) {
                    let nb = Int(nbr[t * 3 + e])
                    let nl = winner[nb]
                    if nl < 0 { continue }
                    let p = (fCent[t] + fCent[nb]) / 2
                    nbDir[nbN] = nbrDir[t * 3 + e]
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

        // Småregion-annektering: en region under terskelen sluker naboen med flest delte
        // kanter — konfettien ICM ikke tok (indre øyer med sterk unær score) forsvinner her.
        // TERSKELEN VAR I ANTALL FLATER (30) og kalibrert for ARKit-nettets grove trekanter.
        // Et TSDF-nett har ~10× mindre flater, så 30 av dem er rundt 5 dm²: alt fra en
        // håndflate og oppover overlevde som EGEN fotolapp. Målt på soveromsbundelen
        // 2026-09-09: 15 ulike vinnerfoto på ett 6,7 m² veggplan, beste dekket 30 %, og
        // 3,00 m søm per m² vegg. Hver søm er et hakk i panelsporet — det er DET som skiller
        // oss fra Scaniverse på nært hold, ikke oppløsning. ICM kan ikke rette det: den
        // prøver bare naboenes labels, så den flytter grenser og slår ikke sammen felt
        // (målt: λ 3 → 12 ga 3,00 → 3,02 m/m²).
        // Terskelen er nå AREAL og betyr det samme på begge nettene. Vakten er uendret:
        // naboens foto må faktisk se flaten (relaxed score > 0), ellers skjer ingenting.
        let minRegionArea = flaggTall("meshscan.minregion", 0.25)
        var regionArea = [Float]()
        func buildRegionAreas() {
            regionArea = regionFaces.map { faces in faces.reduce(Float(0)) { $0 + fArea[Int($1)] } }
        }
        buildRegionAreas()
        var absorbed = 0
        for _ in 0..<6 {
            var mergeVotes = [Int64: Int](minimumCapacity: 4096) // (liten rid)<<32|nabo-rid → kantantall
            for (_, f) in edgeFaces where f.1 >= 0 {
                let ra = region[Int(f.0)], rb = region[Int(f.1)]
                guard ra >= 0, rb >= 0, ra != rb else { continue }
                // BARE oppover i størrelse. Uten dette kan to små regioner bytte etikett med
                // hverandre runde etter runde (A→B, B→A) uten at antallet faller — målt som
                // at høyere terskel ga FLERE sømmer, ikke færre (0,25 m² → 2,10 m/m², men
                // 1,0 m² → 2,77 og 3,0 m² → 3,08). Med kravet om at målet er større, vokser
                // feltene monotont og terskelen betyr det den ser ut som.
                if regionArea[Int(ra)] < minRegionArea, regionArea[Int(rb)] > regionArea[Int(ra)] {
                    mergeVotes[Int64(ra) << 32 | Int64(rb), default: 0] += 1
                }
                if regionArea[Int(rb)] < minRegionArea, regionArea[Int(ra)] > regionArea[Int(rb)] {
                    mergeVotes[Int64(rb) << 32 | Int64(ra), default: 0] += 1
                }
            }
            var bestTarget = [Int32: (nb: Int32, votes: Int)]()
            // Sortert også her: ved lik stemmetall avgjorde ellers hash-rekkefølgen hvilken
            // nabo som vant, og den er tilfeldig per prosess.
            for k in mergeVotes.keys.sorted() {
                let v = mergeVotes[k] ?? 0
                let rid = Int32(k >> 32), nb = Int32(k & 0xFFFFFFFF)
                if v > (bestTarget[rid]?.votes ?? 0) { bestTarget[rid] = (nb, v) }
            }
            var round = 0
            // SORTERT rekkefølge. Swift randomiserer Dictionary-iterasjon per prosess, så
            // annekteringen ga ULIKT resultat fra kjøring til kjøring på samme bundle: målt
            // 0,0240 % mot 0,0428 % brudd i sporene med identiske flagg. Kvalitet som spriker
            // mellom to like bakes er ikke bare umulig å måle — den er en feil i seg selv.
            for rid in bestTarget.keys.sorted() {
                guard let tgt = bestTarget[rid] else { continue }
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
            buildRegionAreas()
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
        // SISTE REDNING (2026-09-05, «gråen hvor jeg egt har skannet må fikses»): en flate
        // som fortsatt står uten vinner — degenerert normal, sentroide utenfor alle
        // bilder, dybdekant i hvert bilde — men som ligger midt blant teksturerte naboer,
        // ER skannet. Den arver naboens bilde: litt smøring er greit, grått er det ikke.
        // Bundet til fire ringer, så ekte uskannede øyer forblir ærlig grå.
        var flommet = 0
        for _ in 0..<4 {
            var nye: [(Int, Int32)] = []
            for t in 0..<triCount where winner[t] < 0 {
                for e in 0..<Int(nbrN[t]) {
                    let nw = winner[Int(nbr[t * 3 + e])]
                    if nw >= 0 { nye.append((t, nw)); break }
                }
            }
            if nye.isEmpty { break }
            for (t, w) in nye { winner[t] = w }
            flommet += nye.count
        }
        if flommet > 0 { MeshLog.log("V2 nabo-flom — \(flommet) vinnerløse flater arvet naboens bilde") }
        if rescued > 0 || flommet > 0 { buildRegions() }
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

        // TONELAGET I KVALITETSVEIEN (2026-09-11, §87). §75 slo det av fordi det blander
        // innhold fra flere foto og river ned de prosjektive feltenes skarphet. Men HYBRID
        // blander bare LAVBÅNDET — tone fra snittet av alle syn, detalj fra vinnerfotoet —
        // og det er nettopp lavbåndet som utjevner eksponeringsforskjellen mellom foto.
        // Uten det ser veggen ut som flere bilder lagt ved siden av hverandre.
        let kvalitetTone = UserDefaults.standard.string(forKey: "meshscan.kvalitettone") != "off"
        let planeMode = (kvalitetFliser && !kvalitetTone) ? "off" : (UserDefaults.standard.string(forKey: "meshscan.planeavg") ?? "hybrid")
        // One broad tone target per physical wall vertex (§61). This removes
        // measured color steps between adjacent wall faces with different support.
        // Original full-resolution detail is retained; "off" restores the A/B control.
        let sharedTone = UserDefaults.standard.string(forKey: "meshscan.toneshared") != "off"
        var tonePlane = planeOfFace
        if sharedTone, planeMode == "hybrid" {
            var rescuedTone = 0
            for t in 0..<triCount where !onPlane[t] && uvClass[t] == 1 && fArea[t] > 0 {
                let neighbors = (0..<Int(nbrN[t])).compactMap { e -> Int32? in
                    let nb = Int(nbr[t * 3 + e])
                    guard nb >= 0, uvClass[nb] == 1, planeOfFace[nb] >= 0 else { return nil }
                    return planeOfFace[nb]
                }
                let corners = (0..<3).map { j -> SIMD3<Float> in
                    let vi = Int(uv.indices[t * 3 + j]) * 3
                    return SIMD3(uv.positions[vi], uv.positions[vi + 1], uv.positions[vi + 2])
                }
                if let slot = supportedTonePlane(classification: uvClass[t], normal: fNorm[t],
                    corners: corners, neighborPlanes: neighbors, planeNormals: planeNormals, planeDistances: planeDistances) {
                    tonePlane[t] = slot; rescuedTone += 1
                }
            }
            MeshLog.log("V2 felles veggtone — \(rescuedTone) små veggflater støttet av eksisterende veggnaboer")
        }
        // The same constant face scope drives CPU measurements and every GPU
        // sample. Empty means ordinary/unscoped behavior, including old fields.
        let fieldWarpFace: [Bool]
        if let plane = debugImageFieldPlane, !debugImageFields.isEmpty {
            fieldWarpFace = (0..<triCount).map { t in
                let corners = (0..<3).map { j -> SIMD3<Float> in
                    let vi = Int(uv.indices[t * 3 + j]) * 3
                    return SIMD3(uv.positions[vi], uv.positions[vi + 1], uv.positions[vi + 2])
                }
                return imageFieldApplies(plane: plane, assignedPlane: tonePlane[t],
                    planeNormals: planeNormals, planeDistances: planeDistances,
                    normal: fNorm[t], corners: corners)
            }
            MeshLog.log("V2 målefelt — veggavgrenset til \(fieldWarpFace.filter { $0 }.count)/\(triCount) flater")
        } else { fieldWarpFace = [] }
        func fieldWarpEnabled(_ face: Int) -> Bool { fieldWarpFace.isEmpty || fieldWarpFace[face] }

        // ── Søm-nivellering (Waechter global leveling, region-konstant forenkling): mål
        // fargespranget over hver region-grense i LINEÆRT rom og løs additive offsets som
        // utjevner dem — «4 forskjellige fotos»-stegene forsvinner, teksturinnholdet består.
        var regionOfs = [SIMD3<Float>](repeating: .zero, count: regionFrame.count)
        // Per-HJØRNE forfining (se blokka nederst i samme if): én konstant per region kan ikke
        // følge en gradient, så store regioner kan bånde selv etter at spranget er borte.
        var cornerOfs = [SIMD3<Float>](repeating: .zero, count: triCount * 3)
        if regionFrame.count > 1 && regionFrame.count <= 20_000 {
            func sampleLinear(_ p: SIMD3<Float>, _ fi: Int, face: Int) -> SIMD3<Float>? {
                let c = cands[fi]
                guard c.tw > 0 else { return nil }
                let pcam = c.w2c * SIMD4(p, 1)
                if pcam.z > -0.05 { return nil }
                let z = -pcam.z
                var u = c.intr.x * (pcam.x / z) + c.intr.z
                var vv = c.intr.y * (-pcam.y / z) + c.intr.w
                if u < 0 || vv < 0 || u >= c.imgW || vv >= c.imgH { return nil }
                // Measure the same source pixel as the final warped texture.
                if fieldWarpEnabled(face), fi < rasterWarpGrids.count, !rasterWarpGrids[fi].isEmpty {
                    let uv = warpedImageUV(SIMD2(u / c.imgW, vv / c.imgH), grid: rasterWarpGrids[fi],
                        width: MeshPoseRefineV2.warpGridW, height: MeshPoseRefineV2.warpGridH)
                    u = uv.x * c.imgW; vv = uv.y * c.imgH
                }
                let tx = min(c.tw - 1, Int(u / c.imgW * Float(c.tw)))
                let ty = min(c.th - 1, Int(vv / c.imgH * Float(c.th)))
                let px = (ty * c.tw + tx) * 4
                let s = SIMD3(Float(c.thumb[px]), Float(c.thumb[px + 1]), Float(c.thumb[px + 2])) / 255
                let qx = u / c.imgW - 0.5, qy = vv / c.imgH - 0.5
                let devig = 1.0 + MeshBakeV2.devigK * (qx * qx + qy * qy) * 4.0 // samme avvignettering som shaderen
                return SIMD3(pow(s.x, 2.2), pow(s.y, 2.2), pow(s.z, 2.2)) * devig
            }
            struct Acc { var d = SIMD3<Float>.zero; var n: Float = 0 }
            var pairAcc = [Int64: Acc]()
            for (_, f) in edgeFaces where f.1 >= 0 {
                let a = Int(f.0), b = Int(f.1)
                let ra = region[a], rb = region[b]
                guard ra >= 0, rb >= 0, ra != rb else { continue }
                let p = (fCent[a] + fCent[b]) / 2
                guard let sa = sampleLinear(p, Int(winner[a]), face: a),
                      let sb = sampleLinear(p, Int(winner[b]), face: b) else { continue }
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
            let regionOfsLim = Float(UserDefaults.standard.string(forKey: "meshscan.regionofs") ?? "") ?? 0.40
            for i in 0..<regionOfs.count {
                // Hvor langt en region får flyttes i nivå. For stramt lar store tonesprang
                // stå igjen som trekantede felt på flate flater (gulv er verst: det sees i
                // grazing fra alle syn, så nabo-regioner får svært ulik bildemiks).
                // meshscan.regionofs.
                regionOfs[i] = simd_clamp(regionOfs[i], SIMD3(repeating: -regionOfsLim), SIMD3(repeating: regionOfsLim))
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
                    guard let sa = sampleLinear(p, Int(winner[a]), face: a),
                          let sb = sampleLinear(p, Int(winner[b]), face: b) else { continue }
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
                    //    meshscan.cornerdamp / cornerlim / corneriters for A/B av rekkevidden.
                    let cornerDamp = Float(UserDefaults.standard.string(forKey: "meshscan.cornerdamp") ?? "") ?? 0.92
                    let cornerIters = Int(UserDefaults.standard.string(forKey: "meshscan.corneriters") ?? "") ?? 24
                    let cornerLim = Float(UserDefaults.standard.string(forKey: "meshscan.cornerlim") ?? "") ?? 0.09
                    var next = val
                    for _ in 0..<cornerIters {
                        for i in 0..<nD where !pinned[i] {
                            var s = SIMD3<Float>.zero
                            var n: Float = 0
                            var e = adjHead[i]
                            while e >= 0 { s += val[Int(adjTo[Int(e)])]; n += 1; e = adjNext[Int(e)] }
                            next[i] = n > 0 ? s / n * cornerDamp : .zero
                        }
                        swap(&val, &next)
                    }
                    // 0,06 → 0,09 av samme grunn som region-klemmen over: den additive banen
                    // gjør nå hele jobben. Overgangen toner uansett ut innover (demping 0,92).
                    let lim = SIMD3<Float>(repeating: cornerLim)
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
        fase("vinnervalg + sømmer")
        let failG = ARMeshGlbExporter.TexturedExportResult(success: false, filledFraction: Double(filled), geometryPath: geometryPath)
        if filled < 0.05 { return failG }

        // ── HVITBALANSE FRA TAKET (2026-09-11, §86). MÅLT mot Scaniverse-eksporten av samme
        // rom: på taket har de R/G 1,031 og B/G 0,935, vi 1,104 og 0,768 — 22 % for lite blått.
        // Fangsten låser AE/AWB ved start, så rommets gule kunstlys gjengis trofast, og en
        // hvit panelvegg blir kremgul. Det er det samme valget som avskyggingen (§79):
        // referansen normaliserer bort rommets lys, vi beholdt det. Her leses det som skittent.
        // REFERANSEN ER TAKET, ikke hele rommet. Grey-world over alt ville nøytralisert en rød
        // panelvegg til grå; et tak er hvitt i praktisk talt alle bygg. Hvitpunktet er snittet
        // av den LYSESTE halvparten av takflatene (white patch), ikke snittet av alle — en
        // skygge i et hjørne skal ikke dra balansen.
        // Korreksjonen legges i `gains`, som alt ganges inn i hver eneste sampling, så den er
        // global og identisk over alle fire fliser. Luminansen holdes fast; bare farge flyttes.
        // meshscan.hvitbalanse = "off" gir det trofaste rommet tilbake.
        hvitbalanse: if UserDefaults.standard.string(forKey: "meshscan.hvitbalanse") != "off" {
            func takLin(_ t: Int, _ fi: Int32) -> SIMD3<Float>? {
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
                let sRGB = SIMD3(Float(c.thumb[pix]), Float(c.thumb[pix + 1]), Float(c.thumb[pix + 2])) / 255
                let lin = sRGB * sRGB                       // γ2 er nok for en fargetest
                return gains.indices.contains(Int(fi)) ? lin * gains[Int(fi)] : lin
            }
            var prøver = [SIMD3<Float>]()
            for t in 0..<triCount where onPlane[t] && fNorm[t].y < -0.7 {
                let w = winner[t]
                guard w >= 0, Int(w) < cands.count, let c = takLin(t, w) else { continue }
                guard c.x.isFinite, c.y.isFinite, c.z.isFinite else { continue }
                prøver.append(c)
            }
            guard prøver.count >= 200 else {
                MeshLog.log("V2 hvitbalanse — bare \(prøver.count) takflater med foto, hopper over")
                break hvitbalanse
            }
            // DE LYSESTE 20 %, ikke halvparten. Et tak har bounce-lys fra gulv og møbler i
            // hjørnene; det er den direkte belyste delen som er nærmest ren takmaling.
            prøver.sort { (0.299 * $0.x + 0.587 * $0.y + 0.114 * $0.z) > (0.299 * $1.x + 0.587 * $1.y + 0.114 * $1.z) }
            var sum = SIMD3<Float>.zero
            let n = max(1, prøver.count / 5)
            for i in 0..<n { sum += prøver[i] }
            let hvit = sum / Float(n)
            guard hvit.x > 1e-4, hvit.y > 1e-4, hvit.z > 1e-4 else { break hvitbalanse }
            // IKKE mot nøytralt — mot REFERANSENS hvitpunkt. Full nøytralisering er målt for
            // hard: to andre skann (soverom, nyskann) fikk henholdsvis lilla og blått stikk
            // fordi takene deres ikke ER rene hvite, og grey-world «retter» da ekte farge bort.
            // Scaniverse-eksporten ligger på R/G 1,031 og B/G 0,935 i gammaspace på taket, som
            // er 1,063 og 0,874 lineært. Det er målet. Ligger rommet alt på riktig side, røres
            // ingenting — samme form som avskyggingen (§79): bare overskuddet tas.
            let målRG = flaggTall("meshscan.hvitmaalrg", 1.063)
            let målBG = flaggTall("meshscan.hvitmaalbg", 0.874)
            let rg = hvit.x / hvit.y, bg = hvit.z / hvit.y
            // BLÅ FULLT, RØD MED GRENSE (justert 2026-09-11 etter Tormods tredje skann).
            // Blå-mangel er signaturen på kunstlys og rettes helt. Rød er farligere: den kan
            // være ekte maling. Et skann med tak på R/G 1,282 ble GRÅTT av full korreksjon
            // (13,7 % rødkutt), mens et rom på 1,149 ble tydelig renere av 5,4 %. Grensen
            // står derfor på 8 %: nok til å ta et vanlig varmt stikk, for lite til å bleke
            // et rom som faktisk er varmt. Målt på veggen: metning 16,4 → 13,3 % mot
            // referansens 8,0, uten at dyne, tre eller grønt tapte farge.
            let gB = bg < målBG ? målBG / max(bg, 1e-4) : 1
            let rødGulv = 1 - flaggTall("meshscan.hvitrodmaks", 0.08)
            let gR = rg > målRG ? max(rødGulv, målRG / max(rg, 1e-4)) : 1
            let tak = flaggTall("meshscan.hvitbalansetak", 1.35)
            var wb = simd_clamp(SIMD3(gR, 1, gB), SIMD3(repeating: 1 / tak), SIMD3(repeating: tak))
            let lum = 0.299 * wb.x + 0.587 * wb.y + 0.114 * wb.z
            if lum > 1e-4 { wb /= lum }                     // flytt farge, ikke lysstyrke
            guard simd_reduce_max(simd_abs(wb - SIMD3(repeating: 1))) > 0.01 else {
                MeshLog.log(String(format: "V2 hvitbalanse — tak R/G %.3f B/G %.3f er innenfor målet, ingen korreksjon", rg, bg))
                break hvitbalanse
            }
            for i in 0..<gains.count { gains[i] *= wb }
            MeshLog.log(String(format: "V2 hvitbalanse — tak-hvitpunkt R/G %.3f B/G %.3f fra %d flater (mål %.3f / %.3f) → gain ×(%.3f, %.3f, %.3f)",
                               rg, bg, prøver.count, målRG, målBG, wb.x, wb.y, wb.z))
        }

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

        // ── FJÆRING AV SØMMER (2026-09-02). Vinnerveien gir skarpe, store regioner med ett
        // foto hver, og søm-nivelleringen retter NIVÅET over grensene — men selve grensen er
        // fortsatt et hardt kutt mellom to fotos som er 1–2 cm uenige om hvor kantene ligger
        // (målt: ~20 px i 4K mellom nabobilder gjennom geometrien). Her får flatene nærmest
        // en grense tegnet NABOREGIONENS foto oppå sitt eget, med en alfa som er 0,5 på selve
        // sømmen og toner ut til 0 over `featherD` meter. Kuttet blir en kort, myk overgang —
        // en svak dobbeltkant over noen cm i stedet for et hopp — mens regionens indre er
        // urørt og skarpt. Avstanden lagres per HJØRNE og interpoleres i fragmentet, så
        // overgangen er jevn også over de store trekantene på flate vegger.
        // meshscan.feather = meter (default 0.04) eller "off".
        // SØM-FJÆRING I KVALITETSVEIEN (2026-09-11, §87): samme arm som tonelaget.
        // meshscan.kvalitetfjaering = "off" gir §75s oppførsel tilbake.
        let kvalitetFjæring = UserDefaults.standard.string(forKey: "meshscan.kvalitetfjaering") != "off"
        let fjæringAv = kvalitetFliser && !kvalitetFjæring
        var featherFaces: [FeatherFace] = []
        var featherD: Float = fjæringAv ? 0 : 0.04
        feather: if !blendRaw {
            switch fjæringAv ? "off" : UserDefaults.standard.string(forKey: "meshscan.feather") {
            case "off": break feather
            case let s? where Float(s) != nil: featherD = max(0.005, min(0.3, Float(s)!))
            default: break
            }
            let reach = featherD * 1.5
            // Sømkanter med endepunkter (sveisede vertekser → posisjon).
            struct Seed { var face: Int32; var otherRegion: Int32; var a: SIMD3<Float>; var b: SIMD3<Float> }
            var seeds: [Seed] = []
            func vpos(_ w: Int64) -> SIMD3<Float> {
                let i = Int(w) * 3
                return SIMD3(uv.positions[i], uv.positions[i + 1], uv.positions[i + 2])
            }
            for (key, f) in edgeFaces where f.1 >= 0 {
                let a = Int(f.0), b = Int(f.1)
                let ra = region[a], rb = region[b]
                guard ra >= 0, rb >= 0, ra != rb, winner[a] >= 0, winner[b] >= 0,
                      regionFrame[Int(ra)] != regionFrame[Int(rb)] else { continue }
                let p = vpos(Int64(key >> 32)), q = vpos(Int64(key & 0xFFFFFFFF))
                seeds.append(Seed(face: f.0, otherRegion: rb, a: p, b: q))
                seeds.append(Seed(face: f.1, otherRegion: ra, a: p, b: q))
            }
            func segDist(_ x: SIMD3<Float>, _ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float {
                let ab = b - a
                let l2 = simd_length_squared(ab)
                let t = l2 > 1e-12 ? min(1, max(0, simd_dot(x - a, ab) / l2)) : 0
                return simd_distance(x, a + ab * t)
            }
            // Per flate: nærmeste søm (etter centroid-avstand) og hvilken region den grenser til.
            var bestD = [Float](repeating: .greatestFiniteMagnitude, count: triCount)
            var bestSeed = [Int32](repeating: -1, count: triCount)
            var queue: [Int32] = []
            for (si, sd) in seeds.enumerated() {
                let t = Int(sd.face)
                let d = segDist(fCent[t], sd.a, sd.b)
                if d < bestD[t] { bestD[t] = d; bestSeed[t] = Int32(si); queue.append(sd.face) }
            }
            // Bredde-først: flater innen `reach` av en søm, på SAMME side (samme region).
            var head = 0
            while head < queue.count {
                let t = Int(queue[head]); head += 1
                let sd = seeds[Int(bestSeed[t])]
                for e in 0..<Int(nbrN[t]) {
                    let nb = Int(nbr[t * 3 + e])
                    guard region[nb] == region[t] else { continue }
                    let d = segDist(fCent[nb], sd.a, sd.b)
                    if d < reach, d < bestD[nb] { bestD[nb] = d; bestSeed[nb] = bestSeed[t]; queue.append(Int32(nb)) }
                }
            }
            var skippedUnseen = 0
            for t in 0..<triCount where bestSeed[t] >= 0 {
                let sd = seeds[Int(bestSeed[t])]
                let nf = regionFrame[Int(sd.otherRegion)]
                guard nf >= 0, scoreOf(t, cands[Int(nf)], relaxed: true) > 0 else { skippedUnseen += 1; continue }
                var dc = SIMD3<Float>(0, 0, 0)
                for j in 0..<3 {
                    let vi = Int(uv.indices[t * 3 + j]) * 3
                    dc[j] = segDist(SIMD3(uv.positions[vi], uv.positions[vi + 1], uv.positions[vi + 2]), sd.a, sd.b)
                }
                guard min(dc.x, min(dc.y, dc.z)) < featherD else { continue }
                featherFaces.append(FeatherFace(tri: Int32(t), frame: nf, region: sd.otherRegion, dist: dc))
            }
            MeshLog.log(String(format: "V2 søm-fjæring — %d sømkanter, %d flater i bånd (bredde %.0f mm), %d hoppet over (naboens foto ser dem ikke)",
                               seeds.count / 2, featherFaces.count, featherD * 1000, skippedUnseen))
        }

        // ── PLAN-SNITT (2026-09-07, Scaniverse-modellen — Tormod: «SÅ SYKT CLEAN TAK + VEGG …
        // alt ser ut som 1 bilde»). Scaniverse velger ikke ett foto per flate; teksturen er et
        // vektet SNITT av alle syn som ser punktet. Derfor er tak og vegg jevne: hver lampes
        // linsestripe og hvert bildes eksponering ligger på ULIKE steder i ulike syn og
        // fortynnes 1/N, mens flaten selv (panelspor, list) ligger på samme sted og består.
        //
        // To moduser (meshscan.planeavg):
        //   "hybrid" (DEFAULT): TONEN på vegg/tak hentes fra snittet av alle syn, DETALJEN
        //     fra vinnerfotoet. Regnes på CPU i VERDENSROM per flate: tone_snitt(t) = vektet
        //     snitt av thumb-fargen ved flatens centroid over alle gyldige syn (samme dom som
        //     vinnervalget), tone_vinner(t) = det vinnerfotoet faktisk leverer (thumb × gain +
        //     region-/hjørnenivå). Differansen glattes i et 10 cm-rutenett PÅ PLANET og legges
        //     inn som per-hjørne-offset (samme additive kanal som søm-nivelleringen, lineært
        //     rom). Verdensrom er poenget: et blur i ATLAS-rom lekker mellom charts som er
        //     naboer i atlaset men fremmede i rommet — det ga trekant-mosaikk (device 20:47).
        //   "flat": hele texelen erstattes av GPU-snittet (jevnt, men panelspor blir myke).
        //   "off": vinnervei som før.
        var planeAvgByFrame = [Int: [(tri: Int32, w: Float, g: SIMD3<Float>)]]()
        let planeIdx = (0..<triCount).filter { tonePlane[$0] >= 0 }
        // TAK = rent snitt (som Scaniverse: taket deres er mykt, men uten én eneste lysstripe —
        // lampenes linsestråler ligger på ulike steder i ulike syn og forsvinner i snittet),
        // VEGGER = hybrid v2 (skarpe panelspor fra vinneren, tone fra alle). meshscan.ceilflat=off
        // gir hybrid v2 på taket også.
        let ceilFlat = UserDefaults.standard.string(forKey: "meshscan.ceilflat") != "off"
        func erTak(_ t: Int) -> Bool {
            let s = Int(tonePlane[t]); return s >= 0 && s < planeNormals.count && abs(planeNormals[s].y) > 0.9
        }
        let flatIdx: [Int] = planeMode == "flat" ? planeIdx : (ceilFlat ? planeIdx.filter { erTak($0) } : [])
        let hybIdx: [Int] = planeMode == "flat" ? [] : (ceilFlat ? planeIdx.filter { !erTak($0) } : planeIdx)
        // Hybrid correction is interpolated sparsely over mesh vertices. At 512 px a
        // vertex can hit a dark panel groove and brighten the entire triangle interior
        // (§59: +0.122 linear injected where centroid correction should be -0.061).
        // Use broad 64 px tone for HYBRID only; detail still samples the original photo.
        // FLAT ceiling exposure keeps its existing 512 px measurements.
        var s2l = [Float](repeating: 0, count: 256)
        for i in 0..<256 {
            let c = Float(i) / 255
            s2l[i] = c <= 0.04045 ? c / 12.92 : powf((c + 0.055) / 1.055, 2.4)
        }
        let toneSizes = planeToneSizes(override: UserDefaults.standard.string(forKey: "meshscan.planeavgpx"))
        let midPx = toneSizes.flat, hybridPx = toneSizes.hybrid
        struct Mid { var rgba: [UInt8]; var w: Int; var h: Int }
        let midPtr = UnsafeMutablePointer<Mid?>.allocate(capacity: cands.count)
        midPtr.initialize(repeating: nil, count: cands.count)
        defer { midPtr.deinitialize(count: cands.count); midPtr.deallocate() }
        let hybridPtr = UnsafeMutablePointer<Mid?>.allocate(capacity: cands.count)
        hybridPtr.initialize(repeating: nil, count: cands.count)
        defer { hybridPtr.deinitialize(count: cands.count); hybridPtr.deallocate() }
        if planeMode != "off", !(flatIdx.isEmpty && hybIdx.isEmpty) {
            DispatchQueue.concurrentPerform(iterations: cands.count) { fi in
                guard fi < kfUse.count, let cg = MeshImageIO.loadCGImageThumb(framesDir, kfUse[fi].file, maxPx: midPx),
                      let b = MeshImageIO.rgbaBytes(cg) else { return }
                midPtr[fi] = Mid(rgba: b, w: cg.width, h: cg.height)
                if !hybIdx.isEmpty {
                    if hybridPx == midPx { hybridPtr[fi] = midPtr[fi] }
                    else if let image = MeshImageIO.loadCGImageThumb(framesDir, kfUse[fi].file, maxPx: hybridPx),
                            let pixels = MeshImageIO.rgbaBytes(image) {
                        hybridPtr[fi] = Mid(rgba: pixels, w: image.width, h: image.height)
                    }
                }
            }
        }
        func toneAt(_ p: SIMD3<Float>, _ fi: Int, warpEnabled: Bool, hybrid: Bool = false) -> SIMD3<Float>? {
            guard let m = hybrid ? hybridPtr[fi] : midPtr[fi] else { return nil }
            let c = cands[fi]
            let pcam = c.w2c * SIMD4(p, 1)
            guard pcam.z < -0.05 else { return nil }
            let z = -pcam.z
            var u = c.intr.x * (pcam.x / z) + c.intr.z
            var vv = c.intr.y * (-pcam.y / z) + c.intr.w
            guard u >= 1, vv >= 1, u < c.imgW - 1, vv < c.imgH - 1 else { return nil }
            // Measure the same source pixel as the final warped texture.
            if warpEnabled, fi < rasterWarpGrids.count, !rasterWarpGrids[fi].isEmpty {
                let uv = warpedImageUV(SIMD2(u / c.imgW, vv / c.imgH), grid: rasterWarpGrids[fi],
                    width: MeshPoseRefineV2.warpGridW, height: MeshPoseRefineV2.warpGridH)
                u = uv.x * c.imgW; vv = uv.y * c.imgH
            }
            let fx = u / c.imgW * Float(m.w) - 0.5, fy = vv / c.imgH * Float(m.h) - 0.5
            let x0 = min(m.w - 2, max(0, Int(fx))), y0 = min(m.h - 2, max(0, Int(fy)))
            let ax = min(1, max(0, fx - Float(x0))), ay = min(1, max(0, fy - Float(y0)))
            func px(_ x: Int, _ y: Int) -> SIMD3<Float> {
                let o = (y * m.w + x) * 4
                return SIMD3(s2l[Int(m.rgba[o])], s2l[Int(m.rgba[o + 1])], s2l[Int(m.rgba[o + 2])])
            }
            let col = (px(x0, y0) * (1 - ax) + px(x0 + 1, y0) * ax) * (1 - ay)
                    + (px(x0, y0 + 1) * (1 - ax) + px(x0 + 1, y0 + 1) * ax) * ay
            let qx = u / c.imgW - 0.5, qy = vv / c.imgH - 0.5
            let devig = 1 + MeshBakeV2.devigK * (qx * qx + qy * qy) * 4
            let g = gains.indices.contains(fi) ? gains[fi] : SIMD3<Float>(1, 1, 1)
            return col * devig * g
        }
        if planeMode != "off", !flatIdx.isEmpty {
            // FLAT (tak): alle gyldige syn snittes på GPU. To ting lagt til 2026-09-07 kveld etter
            // stue-fixturen (uten AE-lås, ±40 % eksponering mellom syn → «plater» i taket selv
            // om dekningen var full): (1) LOKAL EKSPONERINGSKOMPENSASJON per (flate, syn):
            // g = konsensus-tone / synets tone ved centroiden (per kanal, klemt 0,5–2,0), som i
            // panorama-stitching; alle syn blir enige FØR de snittes, så et syn som kommer
            // til/faller fra ved bildekanten flytter ikke tonen. (2) Myk kant-vekt i shaderen.
            let gamma = Float(UserDefaults.standard.string(forKey: "meshscan.planeavgsharp") ?? "") ?? 1.0
            let lokalGain = UserDefaults.standard.string(forKey: "meshscan.localgain") != "off"
            let forceLocalGain = UserDefaults.standard.string(forKey: "meshscan.localgain") == "on"
            let pchunk = 2048
            let pchunks = (flatIdx.count + pchunk - 1) / pchunk
            let perChunk = UnsafeMutablePointer<[(fi: Int, tri: Int32, w: Float, g: SIMD3<Float>)]>.allocate(capacity: pchunks)
            perChunk.initialize(repeating: [], count: pchunks)
            defer { perChunk.deinitialize(count: pchunks); perChunk.deallocate() }
            DispatchQueue.concurrentPerform(iterations: pchunks) { ci in
                var ut: [(fi: Int, tri: Int32, w: Float, g: SIMD3<Float>)] = []
                var valid: [(fi: Int, w: Float, tone: SIMD3<Float>?)] = []
                for li in (ci * pchunk)..<min((ci + 1) * pchunk, flatIdx.count) {
                    let t = flatIdx[li]
                    valid.removeAll(keepingCapacity: true)
                    for (fi, c) in cands.enumerated() {
                        let sc = scoreOf(t, c)
                        if sc > 0 { valid.append((fi, gamma == 1 ? sc : powf(sc, gamma), lokalGain ? toneAt(fCent[t], fi, warpEnabled: fieldWarpEnabled(t)) : nil)) }
                    }
                    guard !valid.isEmpty else { continue }
                    var cons = SIMD3<Float>.zero, wsum: Float = 0
                    for v in valid { if let tn = v.tone { cons += tn * v.w; wsum += v.w } }
                    let harKons = wsum > 0
                    if harKons { cons /= wsum }
                    for v in valid {
                        var g = SIMD3<Float>(1, 1, 1)
                        // AE/AWB-låste bilder har allerede felles eksponering. Per-trekant
                        // gain tilpasset lampestråler som eksponering og tegnet fasetter i
                        // taket (fixture-A/B 2026-09-08). Eldre/ulåste bilder beholder gain.
                        if harKons, let tn = v.tone, forceLocalGain || kfUse[v.fi].preLock != false {
                            g = simd_clamp(cons / simd_max(tn, SIMD3(repeating: 0.01)), SIMD3(repeating: 0.5), SIMD3(repeating: 2.0))
                        }
                        ut.append((v.fi, Int32(t), v.w, g))
                    }
                }
                perChunk[ci] = ut
            }
            var syn = 0
            for ci in 0..<pchunks {
                for e in perChunk[ci] { planeAvgByFrame[e.fi, default: []].append((e.tri, e.w, e.g)); syn += 1 }
            }
            MeshLog.log("V2 plan-snitt FLAT — \(flatIdx.count) flater på tak/plan, \(syn) flate-syn fra \(planeAvgByFrame.count) frames, lokal gain \(!lokalGain ? "av" : (forceLocalGain ? "alle bilder" : "kun ulåste/eldre bilder"))")
        }
        if planeMode != "off", !hybIdx.isEmpty {
            // HYBRID v2 (2026-09-07 kveld): tone per HJØRNE, ikke per flate i 10 cm-ruter.
            // TSDF-nettet har ~2 cm mellom hjørnene — finere enn en lampes linsestripe (≈5 cm)
            // og finere enn noe eksponeringstrinn. For hvert hjørne på en vegg/takflate:
            //   tone_snitt = score-vektet snitt av bildefargen i ALLE gyldige syn (mellom-
            //                oppløsning ~512 px, lineært, × gain, avvignettert)
            //   tone_vinner = det flatens vinnerfoto leverer i samme hjørne (+ nivåene baken
            //                 alt legger på: regionOfs + eksisterende hjørneofs)
            //   korreksjon  = tone_snitt − tone_vinner  → legges i cornerOfs (per hjørne, per
            //                 flate), som shaderen interpolerer lineært over flaten.
            // Ved hjørnene blir tonen dermed EKSAKT snittet av alle syn — sømtrinn og striper
            // forsvinner der — mens alt under ~2 cm (spor, lister, spots) kommer fra ett foto.
            // Alt skjer i verdensrom: ingen atlas-lekkasje (mosaikken fra bygg 13).
            let t0p = CFAbsoluteTimeGetCurrent()
            let maxCorr = Float(UserDefaults.standard.string(forKey: "meshscan.planeavgcorr") ?? "") ?? 0.35
            let gamma = Float(UserDefaults.standard.string(forKey: "meshscan.planeavgsharp") ?? "") ?? 1.0
            var corner = [SIMD3<Float>](repeating: .zero, count: triCount * 3)
            var cornerHas = [Bool](repeating: false, count: triCount)
            // Flerbilde-snittet lys per hjørne — grunnlaget for avskyggingen nedenfor.
            var wantLum = [SIMD3<Float>](repeating: SIMD3(repeating: .nan), count: triCount * 3)
            var toneNodeIndex = [Int32](repeating: -1, count: sharedTone ? triCount * 3 : 0)
            var toneNodes = [(p: SIMD3<Float>, plane: Int, warpEnabled: Bool)]()
            var nodeTarget = [SIMD3<Float>?]()
            if sharedTone {
                var nodeByKey = [Int64: Int32]()
                for t in hybIdx {
                    let slot = Int(tonePlane[t])
                    for j in 0..<3 {
                        let vi = Int(uv.indices[t * 3 + j])
                        // Excluded faces keep their original source sampling even when
                        // they share a physical vertex with the registered wall.
                        let scopeSlot = slot * 2 + (fieldWarpEnabled(t) ? 1 : 0)
                        let key = (Int64(scopeSlot) << 32) | Int64(UInt32(wid[vi]))
                        let ni: Int32
                        if let existing = nodeByKey[key] { ni = existing }
                        else {
                            ni = Int32(toneNodes.count); nodeByKey[key] = ni
                            toneNodes.append((SIMD3(uv.positions[vi * 3], uv.positions[vi * 3 + 1], uv.positions[vi * 3 + 2]), slot, fieldWarpEnabled(t)))
                        }
                        toneNodeIndex[t * 3 + j] = ni
                    }
                }
                nodeTarget = [SIMD3<Float>?](repeating: nil, count: toneNodes.count)
                nodeTarget.withUnsafeMutableBufferPointer { targets in
                    DispatchQueue.concurrentPerform(iterations: (toneNodes.count + 511) / 512) { chunk in
                        for ni in (chunk * 512)..<min((chunk + 1) * 512, toneNodes.count) {
                            let node = toneNodes[ni], n = planeNormals[node.plane]
                            var sum = SIMD3<Float>.zero, total: Float = 0
                            for (fi, c) in cands.enumerated() {
                                let sc = scoreAt(node.p, n, c)
                                guard sc > 0, let value = toneAt(node.p, fi, warpEnabled: node.warpEnabled, hybrid: true) else { continue }
                                let pc = c.w2c * SIMD4(node.p, 1)
                                var imageUV = SIMD2((c.intr.x * pc.x / -pc.z + c.intr.z) / c.imgW,
                                                    (c.intr.y * -pc.y / -pc.z + c.intr.w) / c.imgH)
                                if node.warpEnabled, fi < rasterWarpGrids.count, !rasterWarpGrids[fi].isEmpty {
                                    imageUV = warpedImageUV(imageUV, grid: rasterWarpGrids[fi],
                                        width: MeshPoseRefineV2.warpGridW, height: MeshPoseRefineV2.warpGridH)
                                }
                                let margin = min(min(imageUV.x, 1 - imageUV.x) * c.imgW,
                                                 min(imageUV.y, 1 - imageUV.y) * c.imgH)
                                let weight = (gamma == 1 ? sc : powf(sc, gamma)) * toneEdgeWeight(
                                    margin: margin, footprint: max(c.imgW, c.imgH) / Float(hybridPx))
                                sum += value * weight; total += weight
                            }
                            if total > 1e-8 { targets[ni] = sum / total }
                        }
                    }
                }
                // A vertex may sit just beyond all strict photo guards while its
                // triangle is visible. Leaving the whole triangle uncorrected then
                // leaks its old region exposure (§61). Fill only from two directly
                // connected, originally observed tone nodes within 5 cm, on this
                // same plane. One pass: filled nodes never propagate into unseen areas.
                var toneNeighbors = [Set<Int>](repeating: [], count: toneNodes.count)
                for t in hybIdx {
                    for j in 0..<3 {
                        let a = Int(toneNodeIndex[t * 3 + j])
                        let b = Int(toneNodeIndex[t * 3 + (j + 1) % 3])
                        if a != b { toneNeighbors[a].insert(b); toneNeighbors[b].insert(a) }
                    }
                }
                let observedTargets = nodeTarget
                var filledTone = 0
                for ni in toneNodes.indices where observedTargets[ni] == nil {
                    let neighbors = toneNeighbors[ni].sorted().compactMap { other -> (position: SIMD3<Float>, tone: SIMD3<Float>)? in
                        guard let value = observedTargets[other] else { return nil }
                        return (toneNodes[other].p, value)
                    }
                    if let target = supportedToneTarget(position: toneNodes[ni].p, neighbors: neighbors) {
                        nodeTarget[ni] = target; filledTone += 1
                    }
                }
                MeshLog.log("V2 felles veggtone — \(filledTone) randhjørner støttet av to observerte naboer innen 5 cm")
            }
            var cornerClamped = [UInt8](repeating: 0, count: triCount)
            let pchunk = 1024
            let pchunks = (hybIdx.count + pchunk - 1) / pchunk
            corner.withUnsafeMutableBufferPointer { CO in
                cornerHas.withUnsafeMutableBufferPointer { CH in
                  cornerClamped.withUnsafeMutableBufferPointer { CC in
                   wantLum.withUnsafeMutableBufferPointer { WL in
                    DispatchQueue.concurrentPerform(iterations: pchunks) { ci in
                        var valid: [(fi: Int, w: Float)] = []
                        for li in (ci * pchunk)..<min((ci + 1) * pchunk, hybIdx.count) {
                            let t = hybIdx[li]
                            let wi = Int(winner[t])
                            guard wi >= 0, wi < cands.count else { continue }
                            valid.removeAll(keepingCapacity: true)
                            for (fi, c) in cands.enumerated() where !sharedTone {
                                let sc = scoreOf(t, c)
                                if sc > 0 { valid.append((fi, gamma == 1 ? sc : powf(sc, gamma))) }
                            }
                            guard sharedTone || !valid.isEmpty else { continue }
                            let r = Int(region[t])
                            let ro = regionOfs.indices.contains(r) ? regionOfs[r] : .zero
                            var ok = true
                            var corr3 = [SIMD3<Float>](repeating: .zero, count: 3)
                            for j in 0..<3 {
                                let vi = Int(uv.indices[t * 3 + j])
                                let p = SIMD3(uv.positions[vi * 3], uv.positions[vi * 3 + 1], uv.positions[vi * 3 + 2])
                                guard let tw = toneAt(p, wi, warpEnabled: fieldWarpEnabled(t), hybrid: true) else { ok = false; break }
                                let want: SIMD3<Float>
                                if sharedTone {
                                    let ni = Int(toneNodeIndex[t * 3 + j])
                                    guard ni >= 0, let target = nodeTarget[ni] else { ok = false; break }
                                    want = target
                                } else {
                                    var sum = SIMD3<Float>.zero, wsum: Float = 0
                                    for v in valid { if let tv = toneAt(p, v.fi, warpEnabled: fieldWarpEnabled(t), hybrid: true) { sum += tv * v.w; wsum += v.w } }
                                    guard wsum > 0 else { ok = false; break }
                                    want = sum / wsum
                                }
                                let have = tw + ro + cornerOfs[t * 3 + j]
                                WL[t * 3 + j] = want          // veggens faktiske lys i hjørnet
                                corr3[j] = simd_clamp(want - have, SIMD3(repeating: -maxCorr), SIMD3(repeating: maxCorr))
                                if simd_reduce_max(simd_abs(want - have)) > maxCorr { CC[t] += 1 }
                            }
                            guard ok else { continue }
                            for j in 0..<3 { CO[t * 3 + j] = corr3[j] }
                            CH[t] = true
                        }
                    }
                  }
                 }
                }
            }
            var applied = 0
            for t in hybIdx where cornerHas[t] {
                for j in 0..<3 { cornerOfs[t * 3 + j] += corner[t * 3 + j] }
                applied += 1
            }

            // ── AVSKYGGING (2026-09-10). MÅLT på samme rom som Scaniverse-eksporten:
            // kildefotoet har 21,9 % lavfrekvent tonevariasjon på veggen, vår modell 14,1 %,
            // deres 6,0 %. Lyset er altså EKTE — vi gjengir det trofast, mens referansen
            // normaliserer det bort. Det er derfor veggen vår leses som «rotete» selv når
            // sporene er skarpere enn deres (6,42 % mot 2,52 % sporkontrast, §78).
            // Her trekkes det store lysfallet ut av veggplanet: hjørnenes flerbilde-snittede
            // lys midles i 25 cm-ruter, glattes, og hvert hjørne skyves mot planets median med
            // styrke `avskygging`. Under 25 cm røres ingenting — spor, lister og skygger fra
            // små ting står igjen. 0 = av (trofast lys), 1 = helt flatt.
            // Styrken er ADAPTIV mot et mål, ikke fast. Målt: soveromsveggen har 14,1 %
            // lavfrekvent tonevariasjon og blir mye bedre av utflating, mens det nye skannets
            // vegg alt ligger på 4,5 % — der la fast styrke 0,85 BARE til støy (4,5 → 5,0 %).
            // Nå flates bare det som ligger OVER målet, og en jevn vegg røres ikke.
            // meshscan.avskyggingmaal = ønsket variasjon i prosent (0 = av).
            let avskyggingMaal = flaggTall("meshscan.avskyggingmaal", 6)
            // Taket er 0,85 — REFERANSENIVÅ, valgt av Tormod 2026-09-10 med kostnaden på bordet.
            // Målt avveining: 0,4 er den eneste verdien som forbedrer begge testskann på begge
            // mål (soverom 14,06 → 11,56 % tone / 6,42 → 6,69 % kontrast; nytt skann 4,51 → 4,44
            // og 3,43 → 3,97). 0,85 tar soverommet til 8,3 % tone — nær referansens 5,95 — men
            // koster det jevne skannet 3,43 → 2,20 % sporkontrast.
            // Valget er prinsipielt, ikke teknisk: en vegg med vindu i den ene enden HAR 2:1
            // lysfall, kildefotoet viser 21,9 %. Referansen fjerner rommets lys; nå gjør vi det
            // samme. meshscan.avskygging = 0.4 gir den trofaste varianten tilbake.
            let avskyggingTak = flaggTall("meshscan.avskygging", 0.85)
            avskyggingBlokk: if avskyggingMaal > 0.01, avskyggingTak > 0.01 {
                // PER PLAN. Spredningen må måles på veggen selv — regnet over hele rommet
                // (gulv, tak, mørke møbler) blir den 45–55 % uansett, og «adaptiv» styrke
                // ville alltid slå i taket. Hvert plan får sin egen median og sin egen styrke.
                let rute: Float = 0.25
                func nøkkel(_ p: SIMD3<Float>, _ slot: Int) -> Int64 {
                    (Int64((p.x / rute).rounded()) & 0xFFFFF)
                        | ((Int64((p.y / rute).rounded()) & 0xFFFFF) << 20)
                        | ((Int64((p.z / rute).rounded()) & 0xFFFFF) << 40)
                        | (Int64(slot & 0x7) << 60)
                }
                var celle = [Int64: (sum: SIMD3<Float>, n: Float)]()
                var perPlan = [Int: [Float]]()
                for t in hybIdx where cornerHas[t] {
                    let slot = Int(tonePlane[t])
                    for j in 0..<3 {
                        let w = wantLum[t * 3 + j]
                        guard w.x.isFinite else { continue }
                        let vi = Int(uv.indices[t * 3 + j])
                        let p = SIMD3(uv.positions[vi * 3], uv.positions[vi * 3 + 1], uv.positions[vi * 3 + 2])
                        let k = nøkkel(p, slot)
                        let c = celle[k] ?? (.zero, 0)
                        celle[k] = (c.sum + w, c.n + 1)
                        perPlan[slot, default: []].append(0.299 * w.x + 0.587 * w.y + 0.114 * w.z)
                    }
                }
                // Spredningen måles på de GLATTEDE rutene, ikke på enkelthjørner, og trimmet
                // 10–90 %. Ellers er det møblene foran veggen som bestemmer tallet (målt 31–69 %
                // per plan), og styrken slår alltid i taket uansett hvor jevn veggen er.
                var ruterPerPlan = [Int: [Float]]()
                for (k, c) in celle where c.n >= 3 {
                    let slot = Int((k >> 60) & 0x7)
                    let m = c.sum / c.n
                    ruterPerPlan[slot, default: []].append(0.299 * m.x + 0.587 * m.y + 0.114 * m.z)
                }
                // FELLES REFERANSE (2026-09-11, §88). Hvert plan ble før flatet mot SIN EGEN
                // median. Det gjør hvert plan jevnt, men kan ikke fjerne trinnet MELLOM to
                // plan — og en vegg deles ofte i flere plan-slots av snappingen. Målt på
                // Tormods rom: en lys loddrett stripe på 12,8 gråtoner overlevde både full
                // utflating per plan, tonelagets klemme, avskyggingen og gain-utjevningen,
                // fordi stripa var et eget plan som ble flatet mot sitt eget nivå.
                // Nå deler alle vegg-/takplan én median, vektet etter hvor mange hjørner de
                // har. meshscan.fellesnivaa = "off" gir per-plan tilbake.
                let fellesNivaa = UserDefaults.standard.string(forKey: "meshscan.fellesnivaa") != "off"
                var planMedian = [Int: Float](), planStyrke = [Int: Float]()
                for (slot, var lum) in perPlan where lum.count >= 200 {
                    lum.sort()
                    let median = lum[lum.count / 2]
                    guard var ruter = ruterPerPlan[slot], ruter.count >= 12 else { continue }
                    ruter.sort()
                    // KVARTILBREDDE, ikke 10–90 %. Et veggplan får med seg bilder, kabler,
                    // stikkontakter og møbelkanter innenfor toleransen, og 10–90 % fanger dem:
                    // målt 31–45 % «variasjon» på vegger som for øyet er nokså jevne, slik at
                    // den adaptive styrken alltid slo i taket. IQR/1,349 er σ for den JEVNE
                    // delen av veggen og lar en virkelig jevn vegg få styrke ~0.
                    let lo = ruter[ruter.count / 4], hi = ruter[ruter.count * 3 / 4]
                    let midt = ruter[ruter.count / 2]
                    let spredning = 100 * (hi - lo) / max(midt, 1e-5) / 1.349
                    let styrke = min(avskyggingTak, max(0, 1 - avskyggingMaal / max(spredning, 1e-3)))
                    planMedian[slot] = median
                    planStyrke[slot] = styrke
                    MeshLog.log(String(format: "V2 avskygging — plan %d: variasjon %.1f %% → styrke %.2f (%d hjørner)",
                                       slot, spredning, styrke, lum.count))
                }
                if fellesNivaa, !planMedian.isEmpty {
                    // Vektet felles median over alle plan som faktisk fikk en styrke.
                    var alle = [Float]()
                    for (slot, med) in planMedian where (planStyrke[slot] ?? 0) > 0.02 {
                        let vekt = max(1, (perPlan[slot]?.count ?? 1) / 100)
                        for _ in 0..<vekt { alle.append(med) }
                    }
                    if alle.count >= 2 {
                        alle.sort()
                        let felles = alle[alle.count / 2]
                        let før = planMedian.values.sorted()
                        for slot in planMedian.keys where (planStyrke[slot] ?? 0) > 0.02 { planMedian[slot] = felles }
                        MeshLog.log(String(format: "V2 avskygging — felles nivå %.3f for %d plan (spredte seg %.3f–%.3f)",
                                           felles, planMedian.count, før.first ?? 0, før.last ?? 0))
                    }
                }
                var flyttet = 0
                for t in hybIdx where cornerHas[t] {
                    let slot = Int(tonePlane[t])
                    guard let median = planMedian[slot], let styrke = planStyrke[slot], styrke > 0.02 else { continue }
                    for j in 0..<3 {
                        let w = wantLum[t * 3 + j]
                        guard w.x.isFinite else { continue }
                        let vi = Int(uv.indices[t * 3 + j])
                        let p = SIMD3(uv.positions[vi * 3], uv.positions[vi * 3 + 1], uv.positions[vi * 3 + 2])
                        // SKALAVALG (2026-09-10). Å dra hvert hjørne mot planets median flater
                        // ALT — også den lokale skyggen under en hylle, som er ekte informasjon
                        // og gir dybde. Målt: full styrke tok soverommet til 8,3 % tonevariasjon,
                        // men kostet det andre skannet 3,43 → 2,20 % sporkontrast.
                        // Nå fjernes bare det STORE lysfallet: feltet glattes over ~4,75 m
                        // (19 ruter) og DET dras mot medianen, mens alt finere står igjen.
                        // En vegg med vindu i den ene enden blir jevn; skyggen under hylla blir.
                        var sum = SIMD3<Float>.zero, n: Float = 0
                        // Skalaen er MÅLT, ikke antatt: 0,75 m (R=1) vant over 1,25 / 2,25 / 3,25 m på begge
                        // skann. Bredere glatting nærmer seg planets median og gjør korreksjonen null
                        // (4,75 m ga 14,06 → 14,09 %, altså ingen virkning); smalere begynner å spise
                        // lokal skygge. meshscan.avskyggingskala i ruter à 25 cm.
                        let R = Int(flaggTall("meshscan.avskyggingskala", 1))
                        // ── TELTVEKTER, IKKE BOKS (2026-09-12, §91). DETTE ER «RUTENE».
                        // Før ble cellene i nabolaget snittet med LIK vekt, valgt etter hvilken
                        // celle hjørnet tilfeldigvis lå i. Da er `glatt` et TRAPPEFELT: to hjørner
                        // på hver side av en cellegrense slår opp ulike nabolag og får ulik
                        // korreksjon, og tonen hopper langs grensa. Resultatet er rektangler på
                        // 25/75 cm tvers over veggen — med utflatingen på maks var de umulige å
                        // ta feil av. Ingen mengde ekstra styrke fjerner dem; styrken gjør dem
                        // tydeligere, fordi det er selve korreksjonen som er trappete.
                        // Nå vektes hver celle med et telt fra hjørnets EGEN posisjon til cellens
                        // senter — vekten faller lineært til 0 ved (R+1) ruter. Feltet blir
                        // kontinuerlig, så korreksjonen glir i stedet for å hoppe, og det store
                        // lysfallet fjernes like godt. meshscan.avskyggingtelt = "off" gir boksen.
                        let telt = UserDefaults.standard.string(forKey: "meshscan.avskyggingtelt") != "off"
                        if telt {
                            let rad = Float(R + 1) * rute
                            let W = R + 1
                            for dx in -W...W { for dy in -W...W { for dz in -W...W {
                                let q = p + SIMD3(Float(dx), Float(dy), Float(dz)) * rute
                                guard let c = celle[nøkkel(q, slot)] else { continue }
                                // Vekten måles mot cellens SENTER, ikke mot dx/dy/dz, ellers er
                                // den igjen bundet til hvilken celle hjørnet lå i.
                                let senter = SIMD3((q.x / rute).rounded(), (q.y / rute).rounded(),
                                                   (q.z / rute).rounded()) * rute
                                let d = simd_abs(senter - p) / rad
                                let w = max(0, 1 - d.x) * max(0, 1 - d.y) * max(0, 1 - d.z)
                                guard w > 1e-4 else { continue }
                                sum += c.sum * w; n += c.n * w
                            } } }
                        } else {
                            for dx in -R...R { for dy in -R...R where abs(dx) + abs(dy) <= R + 4 {
                                for dz in -R...R where abs(dx) + abs(dy) + abs(dz) <= R + 6 {
                                    let q = p + SIMD3(Float(dx), Float(dy), Float(dz)) * rute
                                    if let c = celle[nøkkel(q, slot)] { sum += c.sum; n += c.n }
                                }
                            } }
                        }
                        guard n > 0 else { continue }
                        let glatt = sum / n
                        let glattLum = 0.299 * glatt.x + 0.587 * glatt.y + 0.114 * glatt.z
                        guard glattLum > 1e-4 else { continue }
                        let faktor = 1 + styrke * (median / glattLum - 1)
                        let ny = simd_clamp((w * faktor) - w, SIMD3(repeating: -maxCorr), SIMD3(repeating: maxCorr))
                        cornerOfs[t * 3 + j] += ny
                        flyttet += 1
                    }
                }
                MeshLog.log("V2 avskygging — \(flyttet) hjørner justert på \(planStyrke.filter { $0.value > 0.02 }.count) plan (mål \(avskyggingMaal) %)")
            }
            // Fjæringen (naboens foto over sømmen) bærer naboens REGIONNIVÅ, ikke hjørne-
            // korreksjonen — på plan-flater ville den dra tonen tilbake mot vinnerens. Av der.
            //
            // MEN (2026-09-11, §89): det er nettopp på plan-flater båndene synes. Målt mot
            // Scaniverse på samme vegg har vi DOBBELT så mye vannrett båndenergi (0,206 mot
            // 0,091) selv om vi er flatere totalt (3,81 mot 7,29 i lavfrekvent std) — deres
            // ujevnhet er strukturløs, vår står som rette kanter tvers over veggen. Deres
            // teksturering blander over sømmene; vår gjør det overalt UNNTATT der det synes.
            // meshscan.planfjaering = "on" beholder fjæringen på plan, som A/B.
            let before = featherFaces.count
            let fjærPlan = UserDefaults.standard.string(forKey: "meshscan.planfjaering") == "on"
            if !fjærPlan {
                featherFaces.removeAll { onPlane[Int($0.tri)] || (sharedTone && cornerHas[Int($0.tri)]) }
            }
            if sharedTone {
                MeshLog.log("V2 felles veggtone — \(nodeTarget.lazy.compactMap { $0 }.count)/\(toneNodes.count) felles hjørner, \(cornerClamped.reduce(0) { $0 + Int($1) }) korrigeringsklemmer")
            }
            MeshLog.log(String(format: "V2 plan-snitt HYBRID v2 — tone per hjørne fra alle syn på %d/%d vegg/tak-flater (mellomoppløsning %d px, klemme ±%.2f, fjæring %d→%d) på %.1fs",
                               applied, hybIdx.count, hybridPx, maxCorr, before, featherFaces.count, CFAbsoluteTimeGetCurrent() - t0p))
        }

        // ── GPU-bake: én draw per region (gruppert per kildebilde), én tekstur resident om gangen.
        ARMeshGlbExporter.progress?("Baker tekstur…")
        let colorAblation = debugSink != nil && UserDefaults.standard.string(forKey: "meshscan.colorablation") == "on"
        guard let png = rasterize(uv: uv, winner: winner, region: region, regionFrame: regionFrame,
                                  regionOfs: regionOfs, cornerOfs: cornerOfs, feather: featherFaces, featherD: featherD,
                                  topF: topF, topFavg: topFavgUse, topK: topK,
                                  seamBand: seamBand, kfUse: kfUse, gains: gains, warpGrids: rasterWarpGrids, fieldWarpFace: fieldWarpFace,
                                  blendAll: blendAll, blendRaw: blendRaw,
                                  framesDir: framesDir, atlasSize: atlasSize,
                                  planeAvg: planeAvgByFrame, planeFace: onPlane,
                                  diagnosticSink: colorAblation ? debugSink : nil) else { return failG }

        // Same-run color ablation (§58): remove ALL radiometric/feather/average changes,
        // while keeping camera, winner, geometry, UV and source sampling fixed.
        // Lossless atlases distinguish sampling from final JPEG encoding.
        if colorAblation, let sink = debugSink {
            guard let raw = rasterize(uv: uv, winner: winner, region: region, regionFrame: regionFrame,
                regionOfs: [], cornerOfs: [], feather: [], topF: topF, topFavg: topFavgUse, topK: topK,
                seamBand: seamBand, kfUse: kfUse, gains: gains, warpGrids: rasterWarpGrids, fieldWarpFace: fieldWarpFace,
                blendAll: false, blendRaw: false, framesDir: framesDir, atlasSize: atlasSize,
                diagnosticRawColor: true, diagnosticSink: { name, data in sink("raw-" + name, data) }) else { return failG }
            let url = glbURL.deletingLastPathComponent().appendingPathComponent("raw-color-fixture-\(UUID().uuidString).glb")
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                try ARMeshGlbExporter.writeTexturedGlb(positions: uv.positions, normals: uv.normals,
                    uvs: uv.uvs, indices: uv.indices, pngAtlas: raw, to: url)
                sink("raw-color.glb", try Data(contentsOf: url))
            } catch { return failG }
        }

        // Fixture-only texel-density experiment (§55). Keep cameras, winner labels,
        // world-space tone corrections and xatlas layout identical. Render four crops
        // sequentially, so only one rasterizer's Metal working set is resident at once.
        // Eight-pixel borders preserve filtering across tile boundaries. The diagnostic
        // packer clips GLB triangles at those boundaries; the ordinary export stays intact.
        if let sink = debugSink,
           let text = UserDefaults.standard.string(forKey: "meshscan.atlastiles"),
           let tileSize = Int(text), [4096, 6144].contains(tileSize) {
            let padding = Float(8) / Float(tileSize)
            for tile in 0..<4 {
                ARMeshGlbExporter.progress?("Tester detaljtekstur \(tile + 1)/4…")
                let texture: Data? = autoreleasepool {
                    var cropped = uv
                    cropped.uvs = uv.uvs.enumerated().map { i, value in
                        let origin = Float(i % 2 == 0 ? tile % 2 : tile / 2)
                        return (value * 2 - origin) * (1 - 2 * padding) + padding
                    }
                    return rasterize(uv: cropped, winner: winner, region: region, regionFrame: regionFrame,
                                     regionOfs: regionOfs, cornerOfs: cornerOfs, feather: featherFaces, featherD: featherD,
                                     topF: topF, topFavg: topFavgUse, topK: topK,
                                     seamBand: seamBand, kfUse: kfUse, gains: gains, warpGrids: rasterWarpGrids, fieldWarpFace: fieldWarpFace,
                                     blendAll: blendAll, blendRaw: blendRaw,
                                     framesDir: framesDir, atlasSize: tileSize, planeAvg: planeAvgByFrame,
                                     planeFace: onPlane)
                }
                guard let texture else { return failG }
                sink("atlas-tile-\(tile).jpg", texture)
            }
            MeshLog.log("harness — 4 teksturfliser à \(tileSize), 8 px filterkant; standard GLB beholdt")
        }

        // Fixture-only comparison (§56): camera-projected charts following the SAME
        // connected winner regions. All world-space color corrections and source choices
        // are shared with the standard bake above. Never changes the ordinary export.
        // KVALITETSMODELLEN (2026-09-10). Målt mot Scaniverse-eksporten på et ekte fullromsskann,
        // tre bakes × tre vegger: prosjektive foto-felt pakket i fire fliser gir sporkontrast
        // 0,500–0,518 % mot referansens 0,507 og brudd 0,0120–0,0268 % mot referansens 0,0264.
        // Altså LIK eller BEDRE på begge mål — det standardveien ikke klarer samtidig
        // (0,522 % kontrast, men 0,0368 % brudd).
        // Hvorfor det virker: et felt er ÉN kameraprojeksjon, så relieffet i panelsporene
        // gjengis konsistent innenfor feltet, og fire fliser gir plass til kildepikslene
        // (kildeskala 0,88 mot 0,43 i ett atlas). Tonelag og søm-fjæring er AV her: begge
        // blander innhold fra flere foto og river ned nettopp det feltene oppnår.
        // Prisen er 50 MB mot 21 og fire teksturer — derfor er den opt-in med meshscan.kvalitet
        // = "fliser", ment for «Bygg om modellen», ikke for live-skannet.
        if debugSink != nil && UserDefaults.standard.string(forKey: "meshscan.projectiveatlas") == "on" || kvalitetFliser {
            let sink = debugSink
            var projected = [SIMD2<Float>](repeating: SIMD2(repeating: .nan), count: triCount * 3)
            for t in 0..<triCount where winner[t] >= 0 {
                let c = cands[Int(winner[t])]
                for j in 0..<3 {
                    let vi = Int(uv.indices[t * 3 + j])
                    let p = c.w2c * SIMD4(uv.positions[vi * 3], uv.positions[vi * 3 + 1], uv.positions[vi * 3 + 2], 1)
                    if p.z < -0.05 {
                        let q = SIMD2(c.intr.x * p.x / -p.z + c.intr.z, c.intr.y * -p.y / -p.z + c.intr.w)
                        if q.x >= 2, q.y >= 2, q.x < c.imgW - 2, q.y < c.imgH - 2 { projected[t * 3 + j] = q }
                    }
                }
            }
            // FELTINNDELING (2026-09-10). Nøkkelen var REGION — én chart per sammenhengende
            // vinnerområde — og på et fullromsskann ga det 4339 charts. Hver chart har 8 px
            // kant hele veien rundt, så et lite felt bruker mer plass på padding enn på piksler:
            // atlaset måtte skalere kildepikslene til 0,44×, og skarpheten falt UNDER referansen
            // selv om sømmene ble bedre (§70).
            // Alle flater som har VUNNET AV SAMME FOTO ligger i samme bilde og deler dermed
            // projeksjon — de kan pakkes som ÉTT felt uansett om de henger sammen på flaten.
            // Da er antallet felt lik antallet brukte foto, ikke antallet flekker.
            // meshscan.projektivfelt = "region" gir gammel oppførsel.
            // KUN VEGG/TAK (2026-09-10). Prosjektiv pakking av HELE rommet må presse alle
            // kildepiksler inn i ett 8192-atlas: målt kildeskala 0,43, altså 817 texel/m mot
            // xatlas-veiens 1155 — og sporkontrasten faller under referansen selv om sømmene
            // blir bedre. Brudd i linjer synes bare på flate flater med retning i teksturen;
            // møbler og rot bryr seg ikke. Lar dem beholde xatlas-charts, og bruk plassen
            // som frigjøres på veggene. meshscan.projektivkun = "alt" gir hele rommet.
            let kunFlate = !kvalitetFliser && UserDefaults.standard.string(forKey: "meshscan.projektivkun") != "alt"
            let feltPerFoto = kvalitetFliser || UserDefaults.standard.string(forKey: "meshscan.projektivfelt") != "region"
            // Ett felt per foto alene ble for spredt: flatene et foto vinner ligger som øyer
            // over hele bildet, så feltets rammeboks fylles av tomrom (388 charts, men
            // kildeskala 0,33 — verre enn regionveien). Feltet er derfor (foto × grov rute i
            // BILDEPLANET): rutene er tette der flatene faktisk ligger, og alle flater i samme
            // rute deler både projeksjon og naboskap. meshscan.projektivrute = px per rute.
            let ruteStr = flaggTall("meshscan.projektivrute", 640)
            var feltKey = region
            if kunFlate {
                for t in 0..<triCount where feltKey[t] >= 0 {
                    // Vegg eller tak: normalen står nesten vannrett, eller flaten er tildelt
                    // et dominantplan i plan-tildelingen.
                    let vegg = abs(fNorm[t].y) < 0.35
                    let plan = planeOfFace[t] >= 0
                    if !(vegg || plan) { feltKey[t] = -1 }
                }
            }
            if feltPerFoto {
                let rute = max(64, ruteStr)
                feltKey = (0..<triCount).map { t -> Int32 in
                    let harProjeksjon = (0..<3).allSatisfy { projected[t * 3 + $0].x.isFinite }
                    guard winner[t] >= 0, harProjeksjon else { return -1 }
                    if kunFlate, !(abs(fNorm[t].y) < 0.35 || planeOfFace[t] >= 0) { return -1 }
                    let midt = (projected[t * 3] + projected[t * 3 + 1] + projected[t * 3 + 2]) / 3
                    let gx = Int32(midt.x / rute), gy = Int32(midt.y / rute)
                    // 12 bits foto, 6+6 bits rute — nok til 4096 foto og 64×64 ruter.
                    return (winner[t] << 12) | ((gx & 0x3F) << 6) | (gy & 0x3F)
                }
            }
            // Diagnostisk atlasstørrelse for prosjektiv-forsøket. Hypotesen som skal måles:
            // prosjektive felt har referansens sømnivå, men taper skarphet fordi hele rommets
            // kildepiksler må inn i ett 8192-atlas (målt kildeskala 0,43). Med dobbel kant —
            // altså fire ganger arealet — skal skalaen nærme seg 0,86 og skarpheten passere
            // referansen. Kun for måling; den ordinære eksporten røres ikke.
            let projAtlas = Int(flaggTall("meshscan.projektivatlas", Float(atlasSize)))
            let projStr = [4096, 6144, 8192, 12288, 16384].contains(projAtlas) ? projAtlas : atlasSize
            // ── MINNET MÅLES PÅ NYTT HER (2026-09-12, §92). Budsjettet lenger opp
            // (atlas/maxKF/topK) leses FØR TSDF, xatlas og pose-raffinering har tatt sitt.
            // På et 6×6 m rom med 258 000 trekanter var det 40 sekunder og flere hundre
            // megabyte tidligere, og ingenting sjekket på nytt. Flisemalingen — det tyngste
            // steget i hele baken — fortsatte på et tall som ikke gjaldt lenger, og appen ble
            // drept på flis 3 av 4.
            // Kostnaden per flis er ARITMETIKK, ikke en gjetning: atlasparet pluss lesebufferet
            // (3×S²×4 B), plan-akkumulatoren i halv oppløsning rgba16F (S²×2), fjæringslaget
            // (S²×1) og ett dekodet kildefoto (~33 MB) → S²×15 + 33 MB. 8192 koster ~1,0 GB,
            // 6144 ~0,6 GB, 4096 ~0,3 GB. Grensa på 70 % av ledig minne er det ENESTE valgte
            // tallet her; resten følger av størrelsene. meshscan.flisbudsjett = "off" slår av.
            // Byte per piksel: atlasparet (2×4) + lesebufferet + plan-akkumulatoren i halv
            // oppløsning rgba16F (S²×2 → 2 per piksel) + fjæringslaget (1). Med stripevis
            // lesing (§93) er lesebufferet en åttendedel av en full flis, ikke en hel.
            let stripevis = UserDefaults.standard.string(forKey: "meshscan.stripelesing") != "off"
            func flisKost(_ s: Int) -> Int {
                let perPiksel = 2 * 4 + (stripevis ? 1 : 4) + 2 + 1
                return s * s * perPiksel + 33 * 1024 * 1024
            }
            var flisStr = projStr
            if UserDefaults.standard.string(forKey: "meshscan.flisbudsjett") != "off" {
                let ledig = MeshSimMem.available()
                for kandidat in [projStr, 6144, 4096] where kandidat <= projStr {
                    flisStr = kandidat
                    if flisKost(kandidat) <= Int(Double(ledig) * 0.7) { break }
                }
                MeshLog.log("V2 fliser — ledig \(ledig / 1024 / 1024)MB, kost \(flisKost(flisStr) / 1024 / 1024)MB per flis → \(flisStr)"
                            + (flisStr < projStr ? " (NED fra \(projStr))" : ""))
            }
            // FIRE FLISER (2026-09-10). Måling: hele atlaset til veggfeltene ga kildeskala
            // 0,43 → 0,486 og sporkontrast 0,436 → 0,488 %, mens bruddene holdt seg på
            // referansenivå (0,033 mot 0,0305 %). Skarpheten følger altså atlasarealet nesten
            // proporsjonalt, og fire fliser skal ta skalaen forbi referansens 0,509 %.
            // Skrives som EGEN diagnosefil; den vanlige eksporten er urørt, og appens
            // fremviser leser i dag bare første tekstur (AmpexMeshViewerView).
            // ── FLERE BRIKKER NÅR HVER MÅ VÆRE MINDRE (2026-09-12, §93).
            // Tormod: «noen av linjene forsvant». Det var nedtrappingen fra 8192 til 6144:
            // panelspor er 1–2 texler brede, og 33 % større texler spiser dem.
            //
            // Nedtrappingen var likevel riktig — minnet holdt ikke. Feilen var å la
            // OPPLØSNINGEN betale. Rutenettet er fritt: fire brikker à 8192 gir 16384
            // effektivt, og ni à 6144 gir 18432 — MER detalj, på 453 MB per brikke i stedet
            // for 1,3 GB. Toppen bestemmes av én brikke, ikke av summen; å ta flere og
            // mindre er derfor gratis i minne og koster bare tid.
            //
            // Målet er 2 × budsjettets atlas, altså det fire brikker à `projStr` ville gitt.
            // Taket på 4×4 er der for å hindre at en liten flisstørrelse eksploderer i antall
            // tegninger. meshscan.projektivfliser overstyrer manuelt.
            let målEffektiv = 2 * projStr
            let auto = kvalitetFliser && UserDefaults.standard.string(forKey: "meshscan.projektivfliser") == nil
            let fliser: Int
            if auto {
                fliser = max(2, min(4, Int(ceil(Double(målEffektiv) / Double(flisStr)))))
                if fliser != 2 {
                    MeshLog.log("V2 fliser — \(fliser)×\(fliser) à \(flisStr) = \(fliser * flisStr) effektivt (mål \(målEffektiv))")
                }
            } else {
                // Manuell overstyring godtar 1–4 (A/B av rutenettet), ikke bare 1 eller 2.
                let bedt = Int(flaggTall("meshscan.projektivfliser", kvalitetFliser ? 2 : 1))
                fliser = (1...4).contains(bedt) ? bedt : (kvalitetFliser ? 2 : 1)
            }
            let kollaps = UserDefaults.standard.string(forKey: "meshscan.projektivkollaps") == "on"
            guard let alternative = projectiveFixtureUV(uv: uv, region: feltKey, projected: projected,
                                                        atlasSize: flisStr, fliser: fliser,
                                                        kollapsRest: kollaps) else { return failG }
            if fliser > 1 {
                // Én rasterisering per flis: UV-ene kroppes til flisens eget [0,1], og
                // trekanter utenfor havner utenfor viewporten og tegnes ikke.
                var flisData: [Data] = []
                var flisAv = [Int](repeating: -1, count: triCount)
                for f in 0..<(fliser * fliser) {
                    let kol = Float(f % fliser), rad = Float(f / fliser)
                    var kroppet = alternative.uv
                    kroppet.uvs = alternative.uv.uvs.enumerated().map { i, v in
                        v * Float(fliser) - (i % 2 == 0 ? kol : rad)
                    }
                    kroppet.atlasSize = flisStr
                    guard let bilde = autoreleasepool(invoking: { () -> Data? in
                        rasterize(uv: kroppet, winner: winner, region: region, regionFrame: regionFrame,
                                  regionOfs: regionOfs, cornerOfs: cornerOfs,
                                  feather: fjæringAv ? [] : featherFaces, featherD: featherD,
                                  topF: topF, topFavg: topFavgUse, topK: topK, seamBand: seamBand,
                                  kfUse: kfUse, gains: gains, warpGrids: rasterWarpGrids, fieldWarpFace: fieldWarpFace,
                                  blendAll: blendAll, blendRaw: blendRaw,
                                  framesDir: framesDir, atlasSize: flisStr,
                                  planeAvg: (kvalitetFliser && !kvalitetTone) ? [:] : planeAvgByFrame, planeFace: onPlane)
                    }) else { return failG }
                    flisData.append(bilde)
                    MeshLog.log("V2 fliser — flis \(f + 1)/\(fliser * fliser) malt, ledig \(MeshSimMem.available() / 1024 / 1024)MB")
                    for t in 0..<triCount where flisAv[t] < 0 {
                        let inne = (0..<3).allSatisfy { j -> Bool in
                            let u = kroppet.uvs[Int(alternative.uv.indices[t * 3 + j]) * 2]
                            let v = kroppet.uvs[Int(alternative.uv.indices[t * 3 + j]) * 2 + 1]
                            return u >= -0.001 && u <= 1.001 && v >= -0.001 && v <= 1.001
                        }
                        if inne { flisAv[t] = f }
                    }
                }
                let flisURL = kvalitetFliser ? glbURL : glbURL.deletingLastPathComponent()
                    .appendingPathComponent("projective-tiles-\(fliser * fliser).glb")
                var flisUV = [Float](repeating: 0, count: alternative.uv.uvs.count)
                for t in 0..<triCount {
                    let f = max(0, flisAv[t])
                    let kol = Float(f % fliser), rad = Float(f / fliser)
                    for j in 0..<3 {
                        let vi = Int(alternative.uv.indices[t * 3 + j])
                        flisUV[vi * 2] = alternative.uv.uvs[vi * 2] * Float(fliser) - kol
                        flisUV[vi * 2 + 1] = alternative.uv.uvs[vi * 2 + 1] * Float(fliser) - rad
                    }
                }
                do {
                    try ARMeshGlbExporter.writeTiledGlb(
                        positions: alternative.uv.positions, normals: alternative.uv.normals,
                        uvs: flisUV, indices: alternative.uv.indices,
                        tileOf: flisAv, tiles: flisData, to: flisURL)
                    let dekket = flisAv.filter { $0 >= 0 }.count
                    let bytes = ((try? FileManager.default.attributesOfItem(atPath: flisURL.path))?[.size] as? Int) ?? 0
                    MeshLog.log("prosjektive fliser — \(fliser * fliser) à \(flisStr), \(dekket)/\(triCount) trekanter plassert, \(bytes / 1024 / 1024)MB → \(flisURL.lastPathComponent)")
                    if kvalitetFliser {
                        fase("maling + eksport")
                        MeshLog.log("V2 bake ferdig — KVALITET/fliser \(bytes / 1024 / 1024)MB fylt=\(Int(filled * 100))% geometri=\(geometryPath) totalt \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms")
                        return ARMeshGlbExporter.TexturedExportResult(success: bytes > 0, filledFraction: Double(filled), geometryPath: geometryPath)
                    }
                } catch {
                    MeshLog.log("prosjektive fliser — skriving feilet: \(error.localizedDescription)")
                }
            }
            let texture = autoreleasepool {
                rasterize(uv: alternative.uv, winner: winner, region: region, regionFrame: regionFrame,
                          regionOfs: regionOfs, cornerOfs: cornerOfs, feather: featherFaces, featherD: featherD,
                          topF: topF, topFavg: topFavgUse, topK: topK, seamBand: seamBand,
                          kfUse: kfUse, gains: gains, warpGrids: rasterWarpGrids, fieldWarpFace: fieldWarpFace,
                          blendAll: blendAll, blendRaw: blendRaw, framesDir: framesDir,
                          atlasSize: flisStr, planeAvg: planeAvgByFrame, planeFace: onPlane)
            }
            guard let texture else { return failG }
            let url = glbURL.deletingLastPathComponent().appendingPathComponent("projective-fixture-\(UUID().uuidString).glb")
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                try ARMeshGlbExporter.writeTexturedGlb(positions: alternative.uv.positions, normals: alternative.uv.normals,
                    uvs: alternative.uv.uvs, indices: alternative.uv.indices, pngAtlas: texture, to: url)
                sink?("projective.glb", try Data(contentsOf: url))
                let report: [String: Any] = ["charts": alternative.uv.chartCount, "sourceScale": alternative.scale,
                    "projectedTriangles": alternative.projectedTriangles, "totalTriangles": triCount,
                    "atlasSize": atlasSize, "paddingPixels": 8]
                sink?("projective.json", try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]))
                MeshLog.log("harness — prosjektivt atlas: \(alternative.uv.chartCount) felt, \(alternative.projectedTriangles)/\(triCount) flater, kildeskala \(alternative.scale)")
            } catch { return failG }
        }

        // ── Frynse-trim (meshscan.fringetrim; device 2026-08-26-nit: hvit smurt frynse ved
        // åpen skanngrense — strukne kanttrekanter tekstureres i grazing-vinkel og smøres).
        // Fjerner KUN flater som (a) ligger på åpen mesh-kant (skanngrensen) og (b) ingen
        // kandidat så ordentlig: vinnerløs, eller beste score < 15 % av median. Trimmen skjer
        // i GLB-indeksene ETTER bake (teksturen for dem er bakt men ubrukt) → fullt rebake-
        // A/B-bar på fixtures. Sletter geometri → på som default MED 3 %-vakta under;
        // meshscan.fringetrim = "off" er kontrollarmen («gammel» i RebakeAB).
        // Vakt (dedup-havariets lærdom): kvalifiserer > 3 % av flatene er det ikke en frynse — avbryt.
        var glbIndices = uv.indices
        // DEFAULT AV (2026-09-05, Tormod: «det går bra at det er smeared, men gråen må
        // fikses»): trimmen sletter geometri, og hullene viser viewerens grå bakgrunn —
        // grå konturer rundt seng og møbler. Smurt frynse er det MINDRE ondet. Nabo-
        // flommen gir dem uansett et bilde. meshscan.fringetrim = "on" / tall slår den på.
        fringeTrim: if let ft = UserDefaults.standard.string(forKey: "meshscan.fringetrim"), ft != "off" {
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

        if let sink = debugSink {
            // Etiketter i GLB-rekkefølge (etter frynse-trim), pluss de raffinerte posene.
            var map = [Int32](); map.reserveCapacity(triCount)
            var out = 0
            for t in 0..<triCount {
                if out < glbIndices.count / 3, glbIndices[out * 3] == uv.indices[t * 3],
                   glbIndices[out * 3 + 1] == uv.indices[t * 3 + 1], glbIndices[out * 3 + 2] == uv.indices[t * 3 + 2] {
                    map.append(Int32(t)); out += 1
                }
            }
            let win = map.map { winner[Int($0)] }
            let reg = map.map { region[Int($0)] }
            let top2 = map.map { topF[Int($0) * topK + min(1, topK - 1)] }
            let band = map.map { Int32(seamBand.indices.contains(Int($0)) && seamBand[Int($0)] ? 1 : 0) }
            win.withUnsafeBufferPointer { sink("labels-winner.i32", Data(buffer: $0)) }
            reg.withUnsafeBufferPointer { sink("labels-region.i32", Data(buffer: $0)) }
            top2.withUnsafeBufferPointer { sink("labels-top2.i32", Data(buffer: $0)) }
            band.withUnsafeBufferPointer { sink("labels-band.i32", Data(buffer: $0)) }
            // Trace the actual radiometry in exported face order. Spatial seam tests
            // must not approximate gains or infer a face's treatment from AR labels.
            let flatSet = Set(flatIdx), hybridSet = Set(hybIdx)
            let planeLabels = map.map { tonePlane[Int($0)] }
            let lockedLabels = map.map { UInt8(locked[Int($0)] ? 1 : 0) }
            let modeLabels = map.map { tf -> UInt8 in
                guard planeMode != "off" else { return 0 }
                return flatSet.contains(Int(tf)) ? 2 : (hybridSet.contains(Int(tf)) ? 1 : 0)
            }
            let finalCorners = map.flatMap { tf in (0..<3).flatMap { j -> [Float] in
                let v = cornerOfs[Int(tf) * 3 + j]; return [v.x, v.y, v.z]
            } }
            let finalRegions = regionOfs.flatMap { [$0.x, $0.y, $0.z] }
            planeLabels.withUnsafeBufferPointer { sink("labels-plane.i32", Data(buffer: $0)) }
            let warpLabels = map.map { UInt8(fieldWarpEnabled(Int($0)) ? 1 : 0) }
            warpLabels.withUnsafeBufferPointer { sink("labels-field-warp.u8", Data(buffer: $0)) }
            lockedLabels.withUnsafeBufferPointer { sink("labels-locked.u8", Data(buffer: $0)) }
            modeLabels.withUnsafeBufferPointer { sink("labels-mode.u8", Data(buffer: $0)) }
            finalCorners.withUnsafeBufferPointer { sink("corner-offsets.f32", Data(buffer: $0)) }
            finalRegions.withUnsafeBufferPointer { sink("region-offsets.f32", Data(buffer: $0)) }
            let appearance: [String: Any] = ["version":1, "faceCount":map.count,
                "cornerComponents":3, "modeCodes":["regular":0,"hybrid":1,"flat":2],
                "hybridTonePixels":hybridPx, "flatTonePixels":midPx,
                "gains":gains.map { [$0.x,$0.y,$0.z] },
                "planeNormals":planeNormals.map { [$0.x,$0.y,$0.z] }]
            if let data = try? JSONSerialization.data(withJSONObject:appearance, options:[.sortedKeys]) {
                sink("appearance.json", data)
            }
            if let spec = UserDefaults.standard.string(forKey: "meshscan.tracepoint") {
                let xyz = spec.split(separator:",").compactMap { Float($0.trimmingCharacters(in:.whitespaces)) }
                if xyz.count == 3, xyz.allSatisfy({ $0.isFinite }) {
                    let target = SIMD3(xyz[0],xyz[1],xyz[2])
                    let nearest = map.map(Int.init).sorted {
                        simd_length_squared(fCent[$0]-target)<simd_length_squared(fCent[$1]-target)
                    }.prefix(8)
                    func xyzArray(_ v: SIMD3<Float>) -> [Float] { [v.x,v.y,v.z] }
                    var records = [[String:Any]]()
                    for t in nearest {
                        var views = [[String:Any]]()
                        let hybridTone = hybIdx.contains(t)
                        for (fi,c) in cands.enumerated() {
                            let score = scoreOf(t,c)
                            if score > 0 {
                                var view: [String:Any] = ["frame":fi,"index":kfUse[fi].index,"file":kfUse[fi].file,"score":score]
                                if let color=toneAt(fCent[t],fi,warpEnabled:fieldWarpEnabled(t),hybrid:hybridTone) { view["tone"] = xyzArray(color) }
                                views.append(view)
                            }
                        }
                        let feather = featherFaces.filter { Int($0.tri)==t }.map { f -> [String:Any] in
                            ["frame":f.frame,"distance":xyzArray(f.dist)]
                        }
                        let wi = Int(winner[t]), ri = Int(region[t])
                        let offsets = (0..<3).map { xyzArray(cornerOfs[t*3+$0]) }
                        records.append(["triangle":t,"center":xyzArray(fCent[t]),"winner":wi,"region":ri,
                            "locked":locked[t],"plane":Int(tonePlane[t]),"assignmentPlane":Int(planeOfFace[t]),"tonePixels":hybridTone ? hybridPx : midPx,
                            "mode":flatIdx.contains(t) ? "flat" : (hybIdx.contains(t) ? "hybrid" : "regular"),
                            "cornerOffsets":offsets,"regionOffset":ri>=0 && ri<regionOfs.count ? xyzArray(regionOfs[ri]) : [0,0,0],
                            "views":views,"feather":feather])
                    }
                    if let data=try? JSONSerialization.data(withJSONObject:records,options:[.sortedKeys]) {
                        sink("point-trace.json",data)
                    }
                }
            }
            if let kf = try? JSONEncoder().encode(kfUse) { sink("refined-kf.json", kf) }
        }
        do {
            ARMeshGlbExporter.progress?("Skriver 3D-fil…")
            try ARMeshGlbExporter.writeTexturedGlb(positions: uv.positions, normals: uv.normals, uvs: uv.uvs,
                                                   indices: glbIndices, pngAtlas: png, to: glbURL)
            let bytes = ((try? FileManager.default.attributesOfItem(atPath: glbURL.path))?[.size] as? Int) ?? 0
            fase("maling + eksport")
        MeshLog.log("V2 bake ferdig — \(bytes / 1024 / 1024)MB atlas=\(atlasSize) fylt=\(Int(filled * 100))% geometri=\(geometryPath) totalt \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms")
            if bytes > 60_000_000 { return failG }
            return ARMeshGlbExporter.TexturedExportResult(success: true, filledFraction: Double(filled), geometryPath: geometryPath)
        } catch {
            NSLog("[MeshScanV2] GLB write failed: \(error.localizedDescription)")
            return failG
        }
    }

    // MARK: - Projective fixture layout (opt-in; not a production unwrap)

    static func planeToneSizes(override: String?) -> (flat: Int, hybrid: Int) {
        if let text = override, let pixels = Int(text), pixels >= 2 {
            return (pixels, pixels) // Existing A/B flag restores the exact older path.
        }
        return (512, 64)
    }

    /// Fade a support image in over one low-frequency footprint, starting at the
    /// same eight-pixel visibility boundary used by scoreAt. Never fades detail.
    static func toneEdgeWeight(margin: Float, footprint: Float) -> Float {
        guard margin.isFinite, footprint.isFinite, footprint > 0 else { return 0 }
        let x = min(1, max(0, (margin - 8) / footprint))
        return x * x * (3 - 2 * x)
    }

    /// Bounded continuation of observed broad tone across a photo's visibility
    /// guard. Call only with distinct, directly adjacent nodes on the same plane.
    static func supportedToneTarget(position: SIMD3<Float>,
        neighbors: [(position: SIMD3<Float>, tone: SIMD3<Float>)]) -> SIMD3<Float>? {
        var total: Float = 0, count = 0
        var sum = SIMD3<Float>.zero
        for neighbor in neighbors {
            let distance = simd_distance(position, neighbor.position)
            guard distance.isFinite, distance > 0, distance <= 0.05,
                  neighbor.tone.x.isFinite, neighbor.tone.y.isFinite, neighbor.tone.z.isFinite else { continue }
            let weight = 1 / max(distance, 0.002)
            sum += neighbor.tone * weight; total += weight; count += 1
        }
        return count >= 2 && total > 0 ? sum / total : nil
    }

    /// Small wall triangles can have unstable normals despite lying on the wall.
    /// Require two ORIGINAL wall neighbors; rescued faces never propagate support.
    /// Furniture, window labels and faces extending out of the plane stay excluded.
    static func supportedTonePlane(classification: UInt8, normal: SIMD3<Float>,
        corners: [SIMD3<Float>], neighborPlanes: [Int32],
        planeNormals: [SIMD3<Float>], planeDistances: [Float]) -> Int32? {
        guard classification == 1, corners.count == 3 else { return nil }
        for slot in neighborPlanes where slot >= 0 {
            let i = Int(slot)
            guard planeNormals.indices.contains(i), planeDistances.indices.contains(i),
                  neighborPlanes.filter({ $0 == slot }).count >= 2 else { continue }
            let n = planeNormals[i], d = planeDistances[i]
            guard abs(n.y) < 0.35, simd_dot(normal, n) > 0.5,
                  corners.allSatisfy({ abs(simd_dot(n, $0) - d) < 0.01 }) else { continue }
            return slot
        }
        return nil
    }

    /// Preserve face/corner order so labels, leveling, feathering and plane averaging
    /// remain identical. Invalid source projections retain their original xatlas chart.
    /// Rectangular packing is deliberately simple; this measures a representation,
    /// not optimal packing or new photo selection. Ordinary GLB UV interpolation applies.
    static func projectiveFixtureUV(
        uv: ARMeshGlbExporter.UVUnwrapResult, region: [Int32], projected: [SIMD2<Float>], atlasSize: Int,
        fliser: Int = 1, kollapsRest: Bool = false
    ) -> (uv: ARMeshGlbExporter.UVUnwrapResult, scale: Float, projectedTriangles: Int)? {
        let corners = uv.indices.count, count = uv.positions.count / 3
        guard atlasSize >= 64, corners > 0, corners % 3 == 0, region.count == corners / 3,
              projected.count == corners, uv.normals.count == uv.positions.count,
              uv.uvs.count == count * 2, uv.indices.allSatisfy({ Int($0) < count }) else { return nil }
        var parent = Array(0..<count)
        func root(_ value: Int) -> Int {
            var i = value
            while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }
            return i
        }
        for t in 0..<corners / 3 {
            let a = root(Int(uv.indices[t * 3]))
            for j in 1..<3 { parent[root(Int(uv.indices[t * 3 + j]))] = a }
        }
        var keys = [Int](repeating: 0, count: corners / 3)
        var coords = projected
        var bounds = [Int: (lo: SIMD2<Float>, hi: SIMD2<Float>)]()
        var projectedTriangles = 0
        for t in 0..<corners / 3 {
            let valid = region[t] >= 0 && (0..<3).allSatisfy {
                projected[t * 3 + $0].x.isFinite && projected[t * 3 + $0].y.isFinite
            }
            let key = valid ? Int(region[t]) : -1 - root(Int(uv.indices[t * 3]))
            keys[t] = key
            if valid { projectedTriangles += 1 }
            for j in 0..<3 {
                let c = t * 3 + j, vi = Int(uv.indices[c])
                if !valid {
                    // Diagnosemodus: flater uten projeksjon kollapses til ett punkt, så HELE
                    // atlaset går til de prosjektive feltene. Bare for å måle hva dobbel
                    // oppløsning på veggen er verdt — resten av modellen blir ubrukelig.
                    coords[c] = kollapsRest ? SIMD2(0, 0)
                        : SIMD2(uv.uvs[vi * 2], uv.uvs[vi * 2 + 1]) * Float(uv.atlasSize)
                }
                let p = coords[c]
                guard p.x.isFinite, p.y.isFinite else { return nil }
                let b = bounds[key] ?? (p, p)
                bounds[key] = (SIMD2(min(b.lo.x, p.x), min(b.lo.y, p.y)), SIMD2(max(b.hi.x, p.x), max(b.hi.y, p.y)))
            }
        }
        let order = bounds.keys.sorted {
            let a = bounds[$0]!, b = bounds[$1]!
            let ah = a.hi.y - a.lo.y, bh = b.hi.y - b.lo.y
            return ah == bh ? $0 < $1 : ah > bh
        }
        let pad = 8
        // FLISER (2026-09-10). Ett 8192-atlas rommer ~1055 texel/m over et rom på 60 m², så
        // kildepikslene må skaleres til rundt 0,43 uansett pakkemetode (§72) — og DET, ikke
        // sømlogikken, er grunnen til at den prosjektive veien taper skarphet mot referansen.
        // Fire fliser à `atlasSize` gir fire ganger arealet uten at noen enkelt tekstur blir
        // større enn GPU-en tåler (16384² hang rasterizeren). Hvert felt pakkes HELT innenfor
        // én flis, så en flis kan rasteriseres alene og eksporteres som eget materiale.
        // fliser = 1 er den gamle oppførselen.
        // Taket var 2 (2026-09-12, §93): resten av pakkeren er generell i `ruter`, men
        // grensa hindret 3×3. Da ble UV-ene pakket for et 2×2 virtuelt atlas mens
        // flisløkka kuttet i 3×3, og 1057 trekanter havnet på tvers av en grense som
        // pakkingen ikke visste om — de fikk `flisAv = -1` og ble tegnet med flis 0s UV-er.
        let ruter = max(1, min(4, fliser))
        func pack(_ scale: Float) -> [Int: SIMD2<Float>]? {
            var origins = [Int: SIMD2<Float>]()
            var flis = 0, x = 0, y = 0, height = 0
            for key in order {
                let b = bounds[key]!, size = (b.hi - b.lo) * scale
                let w = max(1, Int(ceil(size.x))) + 2 * pad, h = max(1, Int(ceil(size.y))) + 2 * pad
                if w > atlasSize || h > atlasSize { return nil }
                if x + w > atlasSize { y += height; x = 0; height = 0 }
                if y + h > atlasSize {
                    flis += 1
                    if flis >= ruter * ruter { return nil }
                    x = 0; y = 0; height = 0
                }
                // Flisens hjørne i det virtuelle atlaset (2×2 fliser à atlasSize).
                let fx = Float((flis % ruter) * atlasSize), fy = Float((flis / ruter) * atlasSize)
                origins[key] = SIMD2(fx + Float(x + pad), fy + Float(y + pad))
                x += w; height = max(height, h)
            }
            return origins
        }
        var lo: Float = 0, hi: Float = 4
        guard pack(lo) != nil else { return nil }
        for _ in 0..<26 {
            let mid = (lo + hi) / 2
            if pack(mid) != nil { lo = mid } else { hi = mid }
        }
        guard lo > 0.001, let origins = pack(lo) else { return nil }
        var result = ARMeshGlbExporter.UVUnwrapResult(positions: [], normals: [], uvs: [],
            indices: Array(0..<UInt32(corners)), chartCount: order.count, atlasSize: atlasSize * ruter)
        result.positions.reserveCapacity(corners * 3); result.normals.reserveCapacity(corners * 3)
        result.uvs.reserveCapacity(corners * 2)
        for c in 0..<corners {
            let vi = Int(uv.indices[c]), key = keys[c / 3]
            for j in 0..<3 { result.positions.append(uv.positions[vi * 3 + j]); result.normals.append(uv.normals[vi * 3 + j]) }
            let p = ((coords[c] - bounds[key]!.lo) * lo + origins[key]!) / Float(atlasSize * ruter)
            result.uvs.append(p.x); result.uvs.append(p.y)
        }
        return (result, lo, projectedTriangles)
    }

    // MARK: - Metal-rasterisering

    /// Flate i fjæringsbåndet: tegnes en gang til med NABOREGIONENS foto, alfa etter avstand.
    struct FeatherFace {
        var tri: Int32
        var frame: Int32
        var region: Int32
        var dist: SIMD3<Float>   // avstand fra hvert hjørne til sømmen (meter)
    }

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
        regionOfs: [SIMD3<Float>], cornerOfs: [SIMD3<Float>], feather: [FeatherFace] = [], featherD: Float = 0.04,
        topF: [Int32], topFavg: [Int32], topK: Int,
        seamBand: [Bool],
        kfUse: [MeshScanPresenter.Keyframe],
        gains: [SIMD3<Float>], warpGrids: [[SIMD2<Float>]], fieldWarpFace: [Bool], blendAll: Bool, blendRaw: Bool,
        framesDir: URL, atlasSize: Int,
        planeAvg: [Int: [(tri: Int32, w: Float, g: SIMD3<Float>)]] = [:],
        planeFace: [Bool] = [],
        diagnosticRawColor: Bool = false, diagnosticSink: ((String, Data) -> Void)? = nil
    ) -> Data? {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              // DEVIG_K settes ved kompilering av shaderen, så Swift- og Metal-veien
              // alltid bruker samme tall. Se `devigK`.
              let lib = try? device.makeLibrary(
                source: shaderSource.replacingOccurrences(of: "DEVIG_K", with: String(format: "%.4f", MeshBakeV2.devigK)),
                options: nil),
              let vfn = lib.makeFunction(name: "bakev2_vertex"),
              let ffn = lib.makeFunction(name: diagnosticRawColor ? "bakev2_raw_fragment" : "bakev2_fragment"),
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
        let fthdesc = MTLRenderPipelineDescriptor()
        fthdesc.vertexFunction = vfn
        fthdesc.fragmentFunction = lib.makeFunction(name: "bakev2_feather_fragment")
        fthdesc.colorAttachments[0].pixelFormat = .rgba8Unorm_srgb
        fthdesc.colorAttachments[0].isBlendingEnabled = true
        fthdesc.colorAttachments[0].rgbBlendOperation = .add
        fthdesc.colorAttachments[0].alphaBlendOperation = .add
        fthdesc.colorAttachments[0].sourceRGBBlendFactor = .one
        fthdesc.colorAttachments[0].destinationRGBBlendFactor = .one
        fthdesc.colorAttachments[0].sourceAlphaBlendFactor = .one
        fthdesc.colorAttachments[0].destinationAlphaBlendFactor = .one
        let featherPipe = try? device.makeRenderPipelineState(descriptor: fthdesc)
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
        var vdata = [Float](repeating: 0, count: triCount * 3 * 10)
        for t in 0..<triCount {
            for j in 0..<3 {
                let vi = Int(uv.indices[t * 3 + j])
                let o = (t * 3 + j) * 10
                vdata[o] = uv.positions[vi * 3]; vdata[o + 1] = uv.positions[vi * 3 + 1]; vdata[o + 2] = uv.positions[vi * 3 + 2]
                vdata[o + 3] = uv.uvs[vi * 2]; vdata[o + 4] = uv.uvs[vi * 2 + 1]
                let c = cornerOfs.indices.contains(t * 3 + j) ? cornerOfs[t * 3 + j] : .zero
                vdata[o + 5] = c.x; vdata[o + 6] = c.y; vdata[o + 7] = c.z
                vdata[o + 9] = fieldWarpFace.isEmpty || fieldWarpFace[t] ? 1 : 0
            }
        }
        // Slot 8: seam distance. Slot 9: one constant warp gate for all three corners.
        for ff in feather {
            let t = Int(ff.tri)
            for j in 0..<3 { vdata[(t * 3 + j) * 10 + 8] = ff.dist[j] }
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
        let blendSharp = Float(UserDefaults.standard.string(forKey: "meshscan.blendsharp") ?? "") ?? 12
        // Skarphetsvekt per bilde, normalisert mot skannets EGEN 90-persentil (ikke maks —
        // ett tilfeldig knivskarpt bilde skal ikke gjøre alle andre verdiløse). Eksponenten
        // styrer hvor hardt de skarpe dominerer. meshscan.blendskarp = 0 slår av (alt = 1).
        let skarpEksp = MeshBakeV2.flaggTall("meshscan.blendskarp", 2)
        var skarpVekt = [Float](repeating: 1, count: kfUse.count)
        if skarpEksp > 0.01 {
            let alle = kfUse.map { Float($0.sharpness ?? 0) }.sorted()
            let p90 = alle.isEmpty ? 0 : alle[min(alle.count - 1, Int(Float(alle.count) * 0.9))]
            if p90 > 1e-3 {
                for i in kfUse.indices {
                    let r = min(1, max(0, Float(kfUse[i].sharpness ?? 0) / p90))
                    skarpVekt[i] = max(0.02, pow(r, skarpEksp))
                }
                MeshLog.log(String(format: "V2 snitt-vekt — skarphet^%.1f, p90 %.0f, vekt %.2f–%.2f",
                                   skarpEksp, p90, skarpVekt.min() ?? 0, skarpVekt.max() ?? 0))
            }
        }
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

            // SØM-NIVELLERING I RAW-GRENEN (2026-09-01). Nivelleringen har to ledd: et
            // REGION-NIVÅ (uniformen `c.ofs`) og en per-hjørne-forfining (`in.ofs` fra
            // vertex-bufferen). Denne grenen tegner per BILDE, ikke per region, så uniformen
            // kan ikke bære nivået — og den ble derfor satt til null. Resultatet var at
            // regionene beholdt hvert sitt tonenivå: store trekantede felt med ulik lyshet
            // på én flat hvit vegg, med skarpe kanter mellom.
            // Nivået legges nå inn i vertex-dataene, der forfiningen allerede ligger, slik at
            // begge ledd følger flaten uansett hvilket bilde som tegner den.
            var vdataRaw = vdata
            for t in 0..<triCount {
                let r = Int(region[t])
                guard regionOfs.indices.contains(r) else { continue }
                let ro = regionOfs[r]
                for j in 0..<3 {
                    let o = (t * 3 + j) * 10
                    vdataRaw[o + 5] += ro.x; vdataRaw[o + 6] += ro.y; vdataRaw[o + 7] += ro.z
                }
            }
            guard let vbufRaw = device.makeBuffer(bytes: vdataRaw, length: vdataRaw.count * 4) else { return nil }

            var firstA = true
            // AUTORELEASEPOOL PER BILDE (2026-09-11, §89). Hvert syn laster et fullt
            // kildefoto (CGImage + RGBA-Data, ~14 MB). Uten pool holdes alle igjen til
            // løkka er ferdig: 103 bilder = 1,4 GB oppå atlaset, og appen ble drept av
            // jetsam på 77 % i det store skannet. `return` her er løkkas `continue`.
            for (bi, fr) in frRange.enumerated() { autoreleasepool {
                let k = kfUse[fr.frame]
                guard let cg = MeshImageIO.loadCGImage(framesDir, k.file), let rgba = MeshImageIO.rgbaBytes(cg) else { return }
                // MIPMAPS PÅ KILDEBILDET (2026-09-10). Atlaset har 887–1220 texel per meter
                // vegg mot fotoets ~1900 px/m, altså 1,5–2× NEDSKALERING. Kilden ble samplet
                // med ETT bilineært tapp uten mipmaps, og det er aliasing, ikke filtrering:
                // på et periodisk mønster som panelspor gir det svevninger — sporene
                // forsvinner i felter og dukker opp igjen. Det er nettopp «utvasket vegg».
                // Med mipmaps velger GPU-en riktig nivå fra UV-derivatene og gjør ekte
                // arealfiltrering. Kostnad: 33 % mer teksturminne per kildebilde, ett
                // blit-kall. MÅLT OG FORKASTET som standard 2026-09-10: median sporkontrast
                // 3,14 → 3,23 % på normal avstand, men den svakeste femtedelen falt 2,33 → 1,89 %
                // og struktur-dekningen TETT PÅ falt 27 → 15 %. Ekte arealfiltrering fjerner
                // svevningene, men koster mer detalj enn den redder. meshscan.kildemip = "on".
                let vilHaMip = UserDefaults.standard.string(forKey: "meshscan.kildemip") == "on"
                let fdesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                                     width: cg.width, height: cg.height,
                                                                     mipmapped: vilHaMip)
                fdesc.usage = .shaderRead
                guard let ftex = device.makeTexture(descriptor: fdesc) else { return }
                rgba.withUnsafeBytes { raw in
                    ftex.replace(region: MTLRegionMake2D(0, 0, cg.width, cg.height), mipmapLevel: 0,
                                 withBytes: raw.baseAddress!, bytesPerRow: cg.width * 4)
                }
                if vilHaMip, ftex.mipmapLevelCount > 1,
                   let mcb = queue.makeCommandBuffer(), let mbl = mcb.makeBlitCommandEncoder() {
                    mbl.generateMipmaps(for: ftex)
                    mbl.endEncoding(); mcb.commit(); mcb.waitUntilCompleted()
                }
                var cam = CamV2(w2c: simd_inverse(simd_float4x4(columns: (
                    SIMD4(k.transform[0], k.transform[1], k.transform[2], k.transform[3]),
                    SIMD4(k.transform[4], k.transform[5], k.transform[6], k.transform[7]),
                    SIMD4(k.transform[8], k.transform[9], k.transform[10], k.transform[11]),
                    SIMD4(k.transform[12], k.transform[13], k.transform[14], k.transform[15])))),
                    intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                    img: SIMD4(Float(k.width), Float(k.height), 0, 0),
                    wb: SIMD4(gains[fr.frame], skarpVekt.indices.contains(fr.frame) ? skarpVekt[fr.frame] : 1), ofs: SIMD4(0, 0, 0, 0),
                    // meshscan.blendsharp: 4 er den gamle faste verdien.
                    camPos: SIMD4(k.transform[12], k.transform[13], k.transform[14], blendSharp))
                var grid = (fr.frame < warpGrids.count && warpGrids[fr.frame].count == gW * gH) ? warpGrids[fr.frame] : zeroGrid
                guard let cb = queue.makeCommandBuffer() else { return }
                let rp = MTLRenderPassDescriptor()
                rp.colorAttachments[0].texture = avgFull
                rp.colorAttachments[0].loadAction = firstA ? .clear : .load
                rp.colorAttachments[0].storeAction = .store
                rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
                guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return }
                enc.setRenderPipelineState(waPipe)
                enc.setVertexBuffer(vbufRaw, offset: 0, index: 0)
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
            } }
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
            // MIKROKONTRAST OGSÅ HER (2026-09-11, §89). Snitt-grenen returnerer før
            // vinnerløkka og nådde derfor aldri skarpingen lenger nede — en A/B av
            // mikrokontrast på denne veien målte nøyaktig ingenting, fordi den aldri kjørte.
            // Snittet er nettopp veien som TRENGER den: det fjerner en tredel av båndene
            // (0,206 → 0,142 i båndenergi) og betaler med uskarphet.
            let bMikro = MeshBakeV2.flaggTall("meshscan.mikrokontrast", 1.6)
            if bMikro > 0.01,
               let mfn = lib.makeFunction(name: "bakev2_mikro"),
               let mpipe = try? device.makeComputePipelineState(function: mfn),
               let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
                enc.setComputePipelineState(mpipe)
                enc.setTexture(bsrc, index: 0); enc.setTexture(bdst, index: 1)
                var par = SIMD2<Float>(bMikro, max(1, MeshBakeV2.flaggTall("meshscan.mikroradius", 3)))
                enc.setBytes(&par, length: MemoryLayout<SIMD2<Float>>.size, index: 0)
                let n = MTLSize(width: (atlasSize + 15) / 16, height: (atlasSize + 15) / 16, depth: 1)
                enc.dispatchThreadgroups(n, threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
                enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                swap(&bsrc, &bdst)
                MeshLog.log(String(format: "V2 blend=raw — mikrokontrast %.2f", bMikro))
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

        // ── Fjæringslag: naboregionens foto tegnes PREMULTIPLISERT og additivt inn i et eget,
        // halvstort atlas (4096², 67 MB) i SAMME frame-løkke som vinnerne — så dekodes hvert
        // foto bare én gang. Komposisjonen (vinner·(1−a) + lag) skjer i bakev2_composite.
        // Halv oppløsning holder: båndet er en myk overgang på 4 cm, ikke detaljbæreren.
        let fSize = min(atlasSize, 4096)
        let fDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                             width: fSize, height: fSize, mipmapped: false)
        fDesc.usage = [.renderTarget, .shaderRead]
        fDesc.storageMode = .private
        guard let atlasF = device.makeTexture(descriptor: fDesc) else { return nil }
        var featherRanges = [Int: [(region: Int32, offset: Int, count: Int)]]()
        var fIdxBuf: MTLBuffer? = nil
        if !feather.isEmpty, featherPipe != nil {
            var grouped = [Int64: [UInt32]]()
            for ff in feather {
                let t = UInt32(ff.tri)
                grouped[(Int64(ff.frame) << 32) | Int64(ff.region), default: []].append(contentsOf: [t * 3, t * 3 + 1, t * 3 + 2])
            }
            var fIdx = [UInt32]()
            for (k, v) in grouped {
                featherRanges[Int(k >> 32), default: []].append((Int32(k & 0xFFFFFFFF), fIdx.count, v.count))
                fIdx.append(contentsOf: v)
            }
            fIdxBuf = device.makeBuffer(bytes: fIdx, length: fIdx.count * 4)
        }
        var featherFirst = true
        var featherDraws = 0

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
                // w bærer skarphetsvekta (§94). Den brukes bare av avg_warp-fragmentet;
                // vinnerfragmentet leser den ikke. Må være 1 og ikke 0 når vekting er av,
                // ellers nulles snittvektene.
                wb: SIMD4(gains[r.frame], skarpVekt.indices.contains(r.frame) ? skarpVekt[r.frame] : 1),
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
            // Warp må også flytte vinnerens detaljer, ikke bare snitt-laget (09-08).
            // Når warp er av, er nullrutenettet identitet og standardresultatet beholdes.
            var detailGrid = (r.frame < warpGrids.count && warpGrids[r.frame].count == gW * gH)
                ? warpGrids[r.frame] : zeroGrid
            enc.setFragmentBytes(&detailGrid, length: detailGrid.count * MemoryLayout<SIMD2<Float>>.stride, index: 1)
            enc.setFragmentBytes(&gdim, length: MemoryLayout<SIMD2<Int32>>.stride, index: 2)
            enc.setFragmentTexture(ftex, index: 0)
            enc.drawIndexedPrimitives(type: .triangle, indexCount: r.count, indexType: .uint32,
                                      indexBuffer: ibuf, indexBufferOffset: r.offset * 4)
            enc.endEncoding()
            // Fjæringsgruppene til denne framen (én gang per frame) → atlasF.
            if let featherPipe, let fIdxBuf, let groups = featherRanges.removeValue(forKey: r.frame) {
                for g in groups {
                    var fcam = cam
                    fcam.ofs = SIMD4(regionOfs.indices.contains(Int(g.region)) ? regionOfs[Int(g.region)] : .zero, featherD)
                    let rpf = MTLRenderPassDescriptor()
                    rpf.colorAttachments[0].texture = atlasF
                    rpf.colorAttachments[0].loadAction = featherFirst ? .clear : .load
                    rpf.colorAttachments[0].storeAction = .store
                    rpf.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
                    guard let encf = cb.makeRenderCommandEncoder(descriptor: rpf) else { continue }
                    encf.setRenderPipelineState(featherPipe)
                    encf.setVertexBuffer(vbuf, offset: 0, index: 0)
                    encf.setFragmentBytes(&fcam, length: MemoryLayout<CamV2>.stride, index: 0)
                    encf.setFragmentBytes(&detailGrid, length: detailGrid.count * MemoryLayout<SIMD2<Float>>.stride, index: 1)
                    encf.setFragmentBytes(&gdim, length: MemoryLayout<SIMD2<Int32>>.stride, index: 2)
                    encf.setFragmentTexture(ftex, index: 0)
                    encf.drawIndexedPrimitives(type: .triangle, indexCount: g.count, indexType: .uint32,
                                               indexBuffer: fIdxBuf, indexBufferOffset: g.offset * 4)
                    encf.endEncoding()
                    featherFirst = false
                    featherDraws += 1
                }
            }
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

        if featherFirst, let cb = queue.makeCommandBuffer() {
            // Ingen fjæring tegnet (raw-vei / av): tøm laget så komposisjonen leser null.
            let rpf = MTLRenderPassDescriptor()
            rpf.colorAttachments[0].texture = atlasF
            rpf.colorAttachments[0].loadAction = .clear
            rpf.colorAttachments[0].storeAction = .store
            rpf.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
            cb.makeRenderCommandEncoder(descriptor: rpf)?.endEncoding()
            cb.commit(); cb.waitUntilCompleted()
        }
        if featherDraws > 0 { MeshLog.log("V2 søm-fjæring — \(featherDraws) tegninger inn i \(fSize)²-lag") }

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
                // TONE-LAGET ER AV I VINNERVEIEN (2026-09-02). Lavfrekvensen snittes her fra
                // topp-2 UTEN warp, og det andre synet ligger 1–2 cm forskjøvet: hver
                // takplanke-linje fikk et svakt, forskjøvet spøkelse ved siden av seg, og taket
                // så ut som krøllet papir selv om hele taket var ÉN region fra ett foto. Med
                // laget av er linjene rette. Søm-nivelleringen (additiv, per region/hjørne)
                // gjør tone-jobben. meshscan.toneclamp = tall slår det på igjen for A/B.
                var maxCorr: Float = blendAll ? 0.08 : 0.0
                if !diagnosticRawColor, let s = UserDefaults.standard.string(forKey: "meshscan.toneclamp") {
                    if s == "off" { maxCorr = 1.0 } else if let v = Float(s), v > 0 { maxCorr = v }
                }
                enc.setBytes(&maxCorr, length: 4, index: 0)
                enc.setTexture(atlasA, index: 0)
                enc.setTexture(tmpA, index: 1)
                enc.setTexture(avgAcc, index: 2)
                enc.setTexture(atlasB, index: 3)
                enc.setTexture(atlasF, index: 4)
                dispatch(enc, compPipe, atlasSize)
                enc.endEncoding()
            }
            cb.commit()
            cb.waitUntilCompleted()
        }
        if blendAll {
            MeshLog.log("V2 hybrid multiband — vinner-detalj + warp-justert lavfrekvens fra ekte topp-\(avgK) (\(toneMedian ? "median" : "snitt"))")
        }

        // ── PLAN-SNITT: alle gyldige syn akkumuleres (farge·vekt, vekt) for plan-låste flater,
        // deretter erstattes vinnerteksturen texel for texel der snittet har dekning.
        // Akkumulatoren er RGBA16F ≤ 4096² (128 MB); over det snittes i halv oppløsning.
        var planeDone = false
        if !planeAvg.isEmpty,
           let pafn = lib.makeFunction(name: "bakev2_planeavg_fragment"),
           let pcfn = lib.makeFunction(name: "bakev2_planeavg_composite"),
           let pcPipe = try? device.makeComputePipelineState(function: pcfn) {
            let padesc = MTLRenderPipelineDescriptor()
            padesc.vertexFunction = vfn
            padesc.fragmentFunction = pafn
            padesc.colorAttachments[0].pixelFormat = .rgba16Float
            padesc.colorAttachments[0].isBlendingEnabled = true
            padesc.colorAttachments[0].rgbBlendOperation = .add
            padesc.colorAttachments[0].alphaBlendOperation = .add
            padesc.colorAttachments[0].sourceRGBBlendFactor = .one
            padesc.colorAttachments[0].destinationRGBBlendFactor = .one
            padesc.colorAttachments[0].sourceAlphaBlendFactor = .one
            padesc.colorAttachments[0].destinationAlphaBlendFactor = .one
            let accSize = min(atlasSize, 4096)
            let accDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float,
                                                                   width: accSize, height: accSize, mipmapped: false)
            accDesc.usage = [.renderTarget, .shaderRead]
            accDesc.storageMode = .private
            let gW2 = MeshPoseRefineV2.warpGridW, gH2 = MeshPoseRefineV2.warpGridH
            var gdim2 = SIMD2<Int32>(Int32(gW2), Int32(gH2))
            let zeroGrid2 = [SIMD2<Float>](repeating: .zero, count: gW2 * gH2)
            // Pass 2 (2026-09-07): «konsensus-avvisning». Pass 1 gir snittet per texel; i pass 2
            // teller et syn bare hvis det ikke er LYSERE enn snittet med mer enn `glareThr`
            // (lampestråler, gjenskinn, utbrenthet) og ikke mørkere enn `shadowThr` (skygge av
            // den som skanner). Per texel, ikke per flate: strålen er smal og lang.
            let padesc2 = MTLRenderPipelineDescriptor()
            padesc2.vertexFunction = vfn
            padesc2.fragmentFunction = lib.makeFunction(name: "bakev2_planeavg_fragment2")
            padesc2.colorAttachments[0].pixelFormat = .rgba16Float
            padesc2.colorAttachments[0].isBlendingEnabled = true
            padesc2.colorAttachments[0].rgbBlendOperation = .add
            padesc2.colorAttachments[0].alphaBlendOperation = .add
            padesc2.colorAttachments[0].sourceRGBBlendFactor = .one
            padesc2.colorAttachments[0].destinationRGBBlendFactor = .one
            padesc2.colorAttachments[0].sourceAlphaBlendFactor = .one
            padesc2.colorAttachments[0].destinationAlphaBlendFactor = .one
            let paPipe2 = try? device.makeRenderPipelineState(descriptor: padesc2)
            let trimOn = UserDefaults.standard.string(forKey: "meshscan.planeavgtrim") != "off"
            // Gamle fixtures uten låsemetadata beholder den gamle banen. A/B: on/off.
            let softTrim = UserDefaults.standard.string(forKey: "meshscan.planetrimsoft").map { $0 == "on" }
                ?? kfUse.contains { $0.preLock == false }
            if let paPipe = try? device.makeRenderPipelineState(descriptor: padesc),
               let acc = device.makeTexture(descriptor: accDesc),
               let acc2 = device.makeTexture(descriptor: accDesc) {
                var draws = 0
                let frames = planeAvg.keys.sorted()
                func akkumuler(_ pass: Int, into target: MTLTexture, pipe: MTLRenderPipelineState, mean: MTLTexture?) {
                var first = true
                for (bi, frame) in frames.enumerated() {
                    guard let list = planeAvg[frame], !list.isEmpty, frame < kfUse.count else { continue }
                    let k = kfUse[frame]
                    guard let cg = MeshImageIO.loadCGImage(framesDir, k.file), let rgba = MeshImageIO.rgbaBytes(cg) else { continue }
                    let fdesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                                         width: cg.width, height: cg.height, mipmapped: false)
                    fdesc.usage = .shaderRead
                    guard let ftex = device.makeTexture(descriptor: fdesc) else { continue }
                    rgba.withUnsafeBytes { raw in
                        ftex.replace(region: MTLRegionMake2D(0, 0, cg.width, cg.height), mipmapLevel: 0,
                                     withBytes: raw.baseAddress!, bytesPerRow: cg.width * 4)
                    }
                    var idx = [UInt32](); idx.reserveCapacity(list.count * 3)
                    var ws = [Float](); ws.reserveCapacity(list.count)
                    var gs = [SIMD4<Float>](); gs.reserveCapacity(list.count)
                    for e in list {
                        let t = UInt32(e.tri)
                        idx.append(t * 3); idx.append(t * 3 + 1); idx.append(t * 3 + 2)
                        ws.append(e.w); gs.append(SIMD4(e.g, 1))
                    }
                    guard let ib = device.makeBuffer(bytes: idx, length: idx.count * 4),
                          let wbuf = device.makeBuffer(bytes: ws, length: ws.count * 4),
                          let gbuf = device.makeBuffer(bytes: gs, length: gs.count * 16) else { continue }
                    var cam = CamV2(w2c: simd_inverse(simd_float4x4(columns: (
                        SIMD4(k.transform[0], k.transform[1], k.transform[2], k.transform[3]),
                        SIMD4(k.transform[4], k.transform[5], k.transform[6], k.transform[7]),
                        SIMD4(k.transform[8], k.transform[9], k.transform[10], k.transform[11]),
                        SIMD4(k.transform[12], k.transform[13], k.transform[14], k.transform[15])))),
                        intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                        img: SIMD4(Float(k.width), Float(k.height), 0, 0),
                        wb: SIMD4(gains.indices.contains(frame) ? gains[frame] : SIMD3<Float>(1, 1, 1), 0),
                        ofs: SIMD4(0, 0, 0, 0),
                        camPos: SIMD4(k.transform[12], k.transform[13], k.transform[14], 0))
                    var grid = (frame < warpGrids.count && warpGrids[frame].count == gW2 * gH2) ? warpGrids[frame] : zeroGrid2
                    guard let cb = queue.makeCommandBuffer() else { continue }
                    let rp = MTLRenderPassDescriptor()
                    rp.colorAttachments[0].texture = target
                    rp.colorAttachments[0].loadAction = first ? .clear : .load
                    rp.colorAttachments[0].storeAction = .store
                    rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
                    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { continue }
                    enc.setRenderPipelineState(pipe)
                    enc.setVertexBuffer(vbuf, offset: 0, index: 0)
                    enc.setFragmentBytes(&cam, length: MemoryLayout<CamV2>.stride, index: 0)
                    enc.setFragmentBytes(&grid, length: MemoryLayout<SIMD2<Float>>.stride * gW2 * gH2, index: 1)
                    enc.setFragmentBytes(&gdim2, length: MemoryLayout<SIMD2<Int32>>.stride, index: 2)
                    enc.setFragmentBuffer(wbuf, offset: 0, index: 3)
                    enc.setFragmentBuffer(gbuf, offset: 0, index: 5)
                    var thr = SIMD4<Float>(Float(UserDefaults.standard.string(forKey: "meshscan.glarethr") ?? "") ?? 0.06,
                                           Float(UserDefaults.standard.string(forKey: "meshscan.shadowthr") ?? "") ?? 0.20,
                                           softTrim ? 1 : 0, 0)
                    enc.setFragmentBytes(&thr, length: 16, index: 4)
                    enc.setFragmentTexture(ftex, index: 0)
                    if let mean { enc.setFragmentTexture(mean, index: 1) }
                    enc.drawIndexedPrimitives(type: .triangle, indexCount: idx.count, indexType: .uint32,
                                              indexBuffer: ib, indexBufferOffset: 0)
                    enc.endEncoding()
                    cb.commit(); cb.waitUntilCompleted()
                    first = false
                    if pass == 1 { draws += 1 }
                    if bi % 16 == 0 { ARMeshGlbExporter.progress?("Snitter vegg og tak (\(pass)/2)… \(bi * 100 / max(frames.count, 1)) %") }
                }
                }
                akkumuler(1, into: acc, pipe: paPipe, mean: nil)
                var accFinal = acc
                if trimOn, let paPipe2, draws > 0, let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
                    // snitt pass 1 → tmpA (normalisert), så pass 2 mot det
                    enc.setComputePipelineState(normPipe)
                    enc.setTexture(acc, index: 0); enc.setTexture(tmpA, index: 1)
                    let tg = MTLSize(width: 16, height: 16, depth: 1)
                    enc.dispatchThreadgroups(MTLSize(width: (lowSize + 15) / 16, height: (lowSize + 15) / 16, depth: 1), threadsPerThreadgroup: tg)
                    enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                    akkumuler(2, into: acc2, pipe: paPipe2, mean: tmpA)
                    accFinal = acc2
                    MeshLog.log("V2 plan-snitt — konsensus-avvisning (pass 2): \(softTrim ? "myk nedvekting fra" : "hard avvisning ved") snitt+\(Int((Float(UserDefaults.standard.string(forKey: "meshscan.glarethr") ?? "") ?? 0.06) * 100)) % / −\(Int((Float(UserDefaults.standard.string(forKey: "meshscan.shadowthr") ?? "") ?? 0.20) * 100)) %")
                }
                // To moduser (meshscan.planeavg): "flat" = hele texelen erstattes av snittet
                // (jevnt, men panelspor og lister blir myke — Tormod 2026-09-07: «ikke
                // scaniverse level skarpt»); DEFAULT "hybrid" = vinnerfotoet beholder all
                // detalj, og BARE tonen (bredt lavbånd, ~15 cm) hentes fra snittet:
                // ut = vinner + (blur(snitt) − blur(vinner)). Lysstriper og eksponering er
                // brede → korrigeres; spor, spots og lister er smale → fra ett foto, én kopi.
                // 2026-09-02-fella (takplanker med spøkelse) kom av et SMALT lavbånd (2 cm)
                // fra topp-2 uten warp; her er båndet 8× bredere og snittet warp-justert, så
                // 1–2 cm restdrift er langt under båndbredden og gir ingen spøkelser.
                let planeMode = UserDefaults.standard.string(forKey: "meshscan.planeavg") ?? "hybrid"
                let tg16 = MTLSize(width: 16, height: 16, depth: 1)
                func ng(_ size: Int) -> MTLSize { MTLSize(width: (size + 15) / 16, height: (size + 15) / 16, depth: 1) }
                if draws > 0, planeMode == "gpu-hybrid",
                   let bwfn = lib.makeFunction(name: "bakev2_blur_stride"),
                   let bwPipe = try? device.makeComputePipelineState(function: bwfn),
                   let phfn = lib.makeFunction(name: "bakev2_planeavg_hybrid"),
                   let phPipe = try? device.makeComputePipelineState(function: phfn),
                   let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
                    var dH = SIMD2<Int32>(1, 0), dV = SIMD2<Int32>(0, 1)
                    var stride: Int32 = 8   // 9 taps × stride 8 ≈ radius 32 texels; to pass ≈ 45 (≈10–15 cm på et rom)
                    // 1) snitt normalisert → tmpA, bredt blur tmpA→tmpB→tmpA (×2)
                    enc.setComputePipelineState(normPipe)
                    enc.setTexture(accFinal, index: 0); enc.setTexture(tmpA, index: 1)
                    enc.dispatchThreadgroups(ng(lowSize), threadsPerThreadgroup: tg16)
                    for _ in 0..<2 {
                        enc.setComputePipelineState(bwPipe)
                        enc.setTexture(tmpA, index: 0); enc.setTexture(tmpB, index: 1)
                        enc.setBytes(&dH, length: 8, index: 0); enc.setBytes(&stride, length: 4, index: 1)
                        enc.dispatchThreadgroups(ng(lowSize), threadsPerThreadgroup: tg16)
                        enc.setTexture(tmpB, index: 0); enc.setTexture(tmpA, index: 1)
                        enc.setBytes(&dV, length: 8, index: 0); enc.setBytes(&stride, length: 4, index: 1)
                        enc.dispatchThreadgroups(ng(lowSize), threadsPerThreadgroup: tg16)
                    }
                    // 2) vinner (atlasB) nedskalert → avgAcc, samme brede blur avgAcc→tmpB→avgAcc (×2)
                    enc.setComputePipelineState(downPipe)
                    enc.setTexture(atlasB, index: 0); enc.setTexture(avgAcc, index: 1)
                    enc.dispatchThreadgroups(ng(lowSize), threadsPerThreadgroup: tg16)
                    for _ in 0..<2 {
                        enc.setComputePipelineState(bwPipe)
                        enc.setTexture(avgAcc, index: 0); enc.setTexture(tmpB, index: 1)
                        enc.setBytes(&dH, length: 8, index: 0); enc.setBytes(&stride, length: 4, index: 1)
                        enc.dispatchThreadgroups(ng(lowSize), threadsPerThreadgroup: tg16)
                        enc.setTexture(tmpB, index: 0); enc.setTexture(avgAcc, index: 1)
                        enc.setBytes(&dV, length: 8, index: 0); enc.setBytes(&stride, length: 4, index: 1)
                        enc.dispatchThreadgroups(ng(lowSize), threadsPerThreadgroup: tg16)
                    }
                    // 3) ut = vinner + (lavSnitt − lavVinner) der snittet har dekning → atlasA
                    var maxCorr = Float(UserDefaults.standard.string(forKey: "meshscan.planeavgcorr") ?? "") ?? 0.35
                    enc.setComputePipelineState(phPipe)
                    enc.setTexture(atlasB, index: 0); enc.setTexture(tmpA, index: 1)
                    enc.setTexture(avgAcc, index: 2); enc.setTexture(accFinal, index: 3)
                    enc.setTexture(atlasA, index: 4)
                    enc.setBytes(&maxCorr, length: 4, index: 0)
                    enc.dispatchThreadgroups(ng(atlasSize), threadsPerThreadgroup: tg16)
                    enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                    planeDone = true
                    MeshLog.log("V2 plan-snitt — HYBRID: \(draws) frames snittet, tone fra bredt lavbånd (stride \(stride) ×2), detalj fra vinner, klemme ±\(maxCorr)")
                } else if draws > 0, let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
                    enc.setComputePipelineState(pcPipe)
                    enc.setTexture(atlasB, index: 0)
                    enc.setTexture(accFinal, index: 1)
                    enc.setTexture(atlasA, index: 2)
                    var dbg: Float = UserDefaults.standard.string(forKey: "meshscan.debugflat") == "on" ? 1 : 0
                    enc.setBytes(&dbg, length: 4, index: 0)
                    enc.dispatchThreadgroups(ng(atlasSize), threadsPerThreadgroup: tg16)
                    enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                    planeDone = true
                    MeshLog.log("V2 plan-snitt — FLAT: \(draws) frames snittet inn på plan-flater (akkumulator \(accSize)²)")
                }
            }
        }

        var src = planeDone ? atlasA : atlasB, dst = planeDone ? atlasB : atlasA

        // ── VEGGMASKE I ATLASET (2026-09-11). Alt under som skal DØMME kvaliteten på en
        // flate må se på flaten, ikke på møblene foran den. Masken tegnes med samme vertex-
        // funksjon og samme UV-er som fargepassene, men bare for trekanter som ligger på et
        // vegg-/tak-plan, så den ligger eksakt på atlaset uten ny geometri eller ny unwrap.
        // Selve maskeTEKSTUREN er 67 MB på et 8192-atlas, og målingen den muliggjør viste
        // seg å ikke skille skanne-kvalitet (se under). Den bygges derfor bare når noen ber
        // om adaptiv styrke med meshscan.mikromaal; texeltettheten regnes alltid, den er en
        // CPU-løkke over trekantene.
        var wallMask: MTLTexture? = nil
        var veggTexlerPerM: Float = 0
        let vilHaMaske = MeshBakeV2.flaggTall("meshscan.mikromaal", 0) > 0.01
        if !planeFace.isEmpty, let mfrag = lib.makeFunction(name: "bakev2_mask_fragment") {
            var maskIdx = [UInt32]()
            var tetthet = [Float]()
            if vilHaMaske { maskIdx.reserveCapacity(triCount * 3) }
            tetthet.reserveCapacity(triCount)
            for t in 0..<triCount where winner[t] >= 0 && planeFace[t] {
                if vilHaMaske { maskIdx.append(contentsOf: [UInt32(t * 3), UInt32(t * 3 + 1), UInt32(t * 3 + 2)]) }
                // Texler per meter på flaten: sqrt(UV-areal · atlas² / verdensareal).
                let i0 = Int(uv.indices[t * 3]), i1 = Int(uv.indices[t * 3 + 1]), i2 = Int(uv.indices[t * 3 + 2])
                let p0 = SIMD3(uv.positions[i0 * 3], uv.positions[i0 * 3 + 1], uv.positions[i0 * 3 + 2])
                let p1 = SIMD3(uv.positions[i1 * 3], uv.positions[i1 * 3 + 1], uv.positions[i1 * 3 + 2])
                let p2 = SIMD3(uv.positions[i2 * 3], uv.positions[i2 * 3 + 1], uv.positions[i2 * 3 + 2])
                let a3 = 0.5 * simd_length(simd_cross(p1 - p0, p2 - p0))
                let u0 = SIMD2(uv.uvs[i0 * 2], uv.uvs[i0 * 2 + 1])
                let u1 = SIMD2(uv.uvs[i1 * 2], uv.uvs[i1 * 2 + 1])
                let u2 = SIMD2(uv.uvs[i2 * 2], uv.uvs[i2 * 2 + 1])
                let d1 = u1 - u0, d2 = u2 - u0
                let a2 = 0.5 * abs(d1.x * d2.y - d1.y * d2.x)
                if a3 > 1e-6, a2 > 1e-12 { tetthet.append((a2 * Float(atlasSize * atlasSize) / a3).squareRoot()) }
            }
            if tetthet.count > 100 {
                tetthet.sort()
                veggTexlerPerM = tetthet[tetthet.count / 2]
            }
            let mdesc = MTLRenderPipelineDescriptor()
            mdesc.vertexFunction = vfn
            mdesc.fragmentFunction = mfrag
            mdesc.colorAttachments[0].pixelFormat = .r8Unorm
            // r8 på 8192² er 67 MB. Bygges bare når noen faktisk ber om adaptiv styrke.
            let tdesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm,
                                                                 width: atlasSize, height: atlasSize, mipmapped: false)
            tdesc.usage = [.renderTarget, .shaderRead]
            tdesc.storageMode = .private
            if !maskIdx.isEmpty,
               let mpipe = try? device.makeRenderPipelineState(descriptor: mdesc),
               let mtex = device.makeTexture(descriptor: tdesc),
               let mibuf = device.makeBuffer(bytes: maskIdx, length: maskIdx.count * 4),
               let cb = queue.makeCommandBuffer() {
                let rp = MTLRenderPassDescriptor()
                rp.colorAttachments[0].texture = mtex
                rp.colorAttachments[0].loadAction = .clear
                rp.colorAttachments[0].storeAction = .store
                rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
                if let enc = cb.makeRenderCommandEncoder(descriptor: rp) {
                    enc.setRenderPipelineState(mpipe)
                    enc.setVertexBuffer(vbuf, offset: 0, index: 0)
                    enc.drawIndexedPrimitives(type: .triangle, indexCount: maskIdx.count,
                                              indexType: .uint32, indexBuffer: mibuf, indexBufferOffset: 0)
                    enc.endEncoding()
                }
                cb.commit(); cb.waitUntilCompleted()
                wallMask = mtex
                MeshLog.log(String(format: "V2 veggmaske — %d av %d flater på vegg/tak-plan, %.0f texler/m",
                                   maskIdx.count / 3, triCount, veggTexlerPerM))
            }
        }

        // ── MIKROKONTRAST på atlaset. Kjøres FØR dilatasjonen og innfyllingen, ikke etter.
        // Dilatasjonen legger en 16 texler bred, utsmurt krave rundt hvert hull og hver
        // chart-kant, og alfa settes til 1 der. Et ulikt-skarpt filter etter den skjerper
        // kraven og gjør fylte lapper til synlige ringer — den målte prisen i §80. Før
        // dilatasjonen har de texlene alfa 0 og hoppes over av begge kjernene, så både
        // MÅLINGEN og LØFTET ser bare ekte, fotografert innhold.
        // meshscan.mikrokontrast = fast styrke, meshscan.mikroradius = texler.
        // ADAPTIV STYRKE (meshscan.mikromaal) er PRØVD og virker ikke: 98-persentilen av
        // gradienten måler texeltetthet, ikke skarphet — 1930 mot 1214 texler/m ga 5,90 mot
        // 9,70 %, altså motsatt rangering av det øyet ser (§81). Veggmasken er bygget og
        // stenger møbler og tekst ute, men den redder ikke målet. Standard er fast styrke.
        // 0,6 er målt: et flatt belyst kveldsskann går fra 2,21 til 6,85 % sporkontrast —
        // fra «utvasket maling» til lesbart panel — mens et dagslysskann går 7,69 → 10,97 %.
        // Referansen ligger på 2,52 %. 0 slår den av.
        var mikro = MeshBakeV2.flaggTall("meshscan.mikrokontrast", 0.6)
        let mikroMaal = MeshBakeV2.flaggTall("meshscan.mikromaal", 0)
        if let kfn = lib.makeFunction(name: "bakev2_kontrastmaal"),
           let kpipe = try? device.makeComputePipelineState(function: kfn),
           let buf = device.makeBuffer(length: 128 * 4, options: .storageModeShared) {
            // Måles alltid, også når styrken er fast: tallet er avlesningen som gjør at en
            // A/B kan leses av loggen uten å rendre, og det koster ett pass over atlaset.
            func persentil(_ maske: MTLTexture?) -> Float? {
                guard let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return nil }
                memset(buf.contents(), 0, 128 * 4)
                enc.setComputePipelineState(kpipe)
                enc.setTexture(src, index: 0)
                enc.setTexture(maske ?? src, index: 1)
                enc.setBuffer(buf, offset: 0, index: 0)
                // Steget er ~2,5 mm i verden — panelsporets egen skala — så tallet betyr det
                // samme på et tett og et grovt atlas. Uten tetthet: én texel, som før.
                var par = SIMD2<Float>(maske != nil ? 1 : 0,
                                       veggTexlerPerM > 0 ? min(8, max(1, (veggTexlerPerM * 0.0025).rounded())) : 1)
                enc.setBytes(&par, length: MemoryLayout<SIMD2<Float>>.size, index: 1)
                let n = MTLSize(width: (atlasSize + 15) / 16, height: (atlasSize + 15) / 16, depth: 1)
                enc.dispatchThreadgroups(n, threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
                enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                let p = buf.contents().assumingMemoryBound(to: UInt32.self)
                var total: UInt64 = 0
                for i in 0..<128 { total += UInt64(p[i]) }
                guard total > 10000 else { return nil }
                var kum: UInt64 = 0
                var bøtte = 0
                let grense = UInt64(Double(total) * 0.98)
                for i in 0..<128 { kum += UInt64(p[i]); if kum >= grense { bøtte = i; break } }
                return 100 * (Float(bøtte) + 0.5) * 0.004      // 98-persentil i PROSENT
            }
            let vegg = wallMask != nil ? persentil(wallMask) : nil
            let helt = persentil(nil)
            MeshLog.log(String(format: "V2 mikrokontrast — %.0f texler/m på vegg/tak, 98-persentil (steg %.0f texler): vegg/tak %@, hele atlaset %@",
                               veggTexlerPerM,
                               veggTexlerPerM > 0 ? min(8, max(1, (veggTexlerPerM * 0.0025).rounded())) : 1,
                               vegg.map { String(format: "%.2f %%", $0) } ?? "—",
                               helt.map { String(format: "%.2f %%", $0) } ?? "—"))
            if mikroMaal > 0.01, let maalt = vegg ?? helt {
                let tak = MeshBakeV2.flaggTall("meshscan.mikrotak", 1.2)
                mikro = min(tak, max(0, mikroMaal / max(maalt, 1e-3) - 1))
                MeshLog.log(String(format: "V2 mikrokontrast — målt %.2f %%, mål %.2f %% → styrke %.2f", maalt, mikroMaal, mikro))
            }
        }
        if mikro > 0.01,
           let mfn = lib.makeFunction(name: "bakev2_mikro"),
           let mpipe = try? device.makeComputePipelineState(function: mfn),
           let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
            enc.setComputePipelineState(mpipe)
            enc.setTexture(src, index: 0); enc.setTexture(dst, index: 1)
            var par = SIMD2<Float>(mikro, max(1, MeshBakeV2.flaggTall("meshscan.mikroradius", 3)))
            enc.setBytes(&par, length: MemoryLayout<SIMD2<Float>>.size, index: 0)
            let n = MTLSize(width: (atlasSize + 15) / 16, height: (atlasSize + 15) / 16, depth: 1)
            enc.dispatchThreadgroups(n, threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
            enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
            swap(&src, &dst)
            MeshLog.log(String(format: "V2 mikrokontrast — styrke %.2f, radius %.0f texler", mikro, par.y))
        }

        // Dilation (fyller chart-gutters så mipmapping/bilineær ikke drar inn svart) —
        // starter fra multiband-komposittet i atlasB (eller plan-snitt-komposittet i atlasA)
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

        // ── PUSH-PULL-INNFYLLING (2026-09-09). Dilatasjonen over lukker bare gutters
        // (16 × 3×3 = 16 texler). Flater som INGEN keyframe så — målt 2,03 m² av 30,4 m² på
        // soveromsbundelen, og 98,7 % av dem lå aldri innenfor noe kamerabilde — får aldri
        // en texel skrevet. De står med alfa 0, og JPEG-en flater dem mot HVITT: den hvite
        // søylen tvers over veggen ved vinduet. Push-pull fyller dem med den omkringliggende
        // tonen i stedet: ned gjennom en dekningsvektet pyramide, opp igjen der alfa er 0.
        // Det dikter ingen detalj — bare farge fra naboflatene, som i alle skanne-apper.
        // Pyramiden starter på 2048 (fyllet er lavfrekvent uansett), så minnetoppen er ~22 MB
        // og ikke en full 8K-kjede. Av med meshscan.pushpull = "off".
        if UserDefaults.standard.string(forKey: "meshscan.pushpull") != "off",
           let ppDownFn = lib.makeFunction(name: "bakev2_pp_down"),
           let ppUpFn = lib.makeFunction(name: "bakev2_pp_up"),
           let ppDownPipe = try? device.makeComputePipelineState(function: ppDownFn),
           let ppUpPipe = try? device.makeComputePipelineState(function: ppUpFn) {
            let tPP = CFAbsoluteTimeGetCurrent()
            func lag(_ w: Int) -> MTLTexture? {
                let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm_srgb,
                                                                 width: w, height: w, mipmapped: false)
                d.usage = [.shaderRead, .shaderWrite]
                d.storageMode = .private
                return device.makeTexture(descriptor: d)
            }
            func kjør(_ pipe: MTLComputePipelineState, _ a: MTLTexture, _ b: MTLTexture?, _ ut: MTLTexture) {
                guard let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return }
                enc.setComputePipelineState(pipe)
                enc.setTexture(a, index: 0)
                if let b { enc.setTexture(b, index: 1) }
                enc.setTexture(ut, index: b == nil ? 1 : 2)
                let n = MTLSize(width: (ut.width + 15) / 16, height: (ut.width + 15) / 16, depth: 1)
                enc.dispatchThreadgroups(n, threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
                enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
            }
            // Ned til pyramidetoppen uten å holde på mellomnivåene (ARC slipper forrige `cur`).
            let ppTop = min(atlasSize, 2048)
            var cur = src
            var w = atlasSize
            var ok = true
            while w > ppTop && ok {
                w /= 2
                guard let t = lag(w) else { ok = false; break }
                kjør(ppDownPipe, cur, nil, t)
                cur = t
            }
            // Selve kjeden: ppTop → 8 px. Alle nivåene holdes, til sammen ~1/3 av toppen.
            var kjede: [MTLTexture] = [cur]
            while ok, kjede[kjede.count - 1].width > 8 {
                guard let t = lag(kjede[kjede.count - 1].width / 2) else { ok = false; break }
                kjør(ppDownPipe, kjede[kjede.count - 1], nil, t)
                kjede.append(t)
            }
            if ok {
                // Opp igjen: hvert nivå beholder sine egne texler og arver grovere tone der
                // alfa er 0. Siste steg skriver full oppløsning inn i den ledige atlasen.
                var grov = kjede[kjede.count - 1]
                for i in stride(from: kjede.count - 2, through: 0, by: -1) {
                    guard let ut = lag(kjede[i].width) else { ok = false; break }
                    kjør(ppUpPipe, kjede[i], grov, ut)
                    grov = ut
                }
                if ok {
                    kjør(ppUpPipe, src, grov, dst)
                    swap(&src, &dst)
                    MeshLog.log(String(format: "V2 push-pull — umalte texler fylt fra %d² pyramide på %.0fms",
                                       ppTop, (CFAbsoluteTimeGetCurrent() - tPP) * 1000))
                }
            }
            if !ok { MeshLog.log("V2 push-pull — hoppet over (fikk ikke plass til pyramiden)") }
        }

        // ── TILBAKELESING I STRIPER, VIA DISK (2026-09-12, §93). Tormods spørsmål:
        // «kan vi ikke cycle mellom ram og lagring for å aldri miste ram?» Svaret er ja,
        // og dette er stedet.
        //
        // Før lå hele flisa i minnet TRE ganger samtidig: Metal-bufferet, en Swift-array-
        // kopi, og `Data(pixels)` inne i CGImage-en. Ved 8192 er det 3 × 268 MB = 800 MB
        // oppå atlasparet på 536 MB, og da er det 1,3 GB for én flis. Det var grunnen til
        // at flisemalingen ikke fikk plass til 8192 på et stort rom (målt på enhet: 833 MB
        // ledig når flisene startet, mot 2140 MB da budsjettet ble lest 39 s tidligere),
        // og hvorfor nedtrappingen til 6144 spiste panelsporene.
        //
        // Nå kopieres atlaset ut en stripe om gangen og skrives til en råfil, og JPEG-
        // koderen memory-mapper fila. Toppen blir ETT stripebuffer (33 MB ved 8192) pluss
        // atlasparet — pikslene er rene, filbakte sider iOS kan kaste ut under trykk, ikke
        // skitten hukommelse appen må betale for.
        // meshscan.stripelesing = "off" gir den gamle veien tilbake for A/B.
        let bpr = atlasSize * 4
        let striper = UserDefaults.standard.string(forKey: "meshscan.stripelesing") != "off"
        if striper, diagnosticSink == nil {
            let stripeRader = max(256, atlasSize / 8)
            guard let stripe = device.makeBuffer(length: bpr * stripeRader, options: .storageModeShared)
            else { return nil }
            let råURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("atlas-\(UUID().uuidString).raw")
            guard FileManager.default.createFile(atPath: råURL.path, contents: nil),
                  let fh = try? FileHandle(forWritingTo: råURL) else { return nil }
            defer { try? FileManager.default.removeItem(at: råURL) }
            var y = 0
            while y < atlasSize {
                let rader = min(stripeRader, atlasSize - y)
                guard let cb = queue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() else { return nil }
                blit.copy(from: src, sourceSlice: 0, sourceLevel: 0,
                          sourceOrigin: MTLOrigin(x: 0, y: y, z: 0),
                          sourceSize: MTLSize(width: atlasSize, height: rader, depth: 1),
                          to: stripe, destinationOffset: 0,
                          destinationBytesPerRow: bpr, destinationBytesPerImage: bpr * rader)
                blit.endEncoding(); cb.commit(); cb.waitUntilCompleted()
                fh.write(Data(bytesNoCopy: stripe.contents(), count: bpr * rader, deallocator: .none))
                y += rader
            }
            try? fh.close()
            return MeshImageIO.jpegData(fromRawFile: råURL, size: atlasSize)
        }
        // Gammel vei: hele flisa i ett delt buffer. Beholdt for A/B og for diagnose-
        // sinken, som trenger pikslene som array for den tapsfrie PNG-en.
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
        if let sink = diagnosticSink, let lossless = MeshImageIO.pngData(pixels, atlasSize) {
            sink("atlas-lossless.png", lossless)
        }
        return MeshImageIO.jpegData(pixels, atlasSize)
    }

    // MARK: - Shader

    private static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct CamV2 { float4x4 w2c; float4 intr; float4 img; float4 wb; float4 ofs; float4 camPos; };
    struct VOutV2 { float4 position [[position]]; float3 wp; float3 ofs; float seamDist; float warpEnabled [[flat]]; };

    // 10 floats per HJØRNE: [x,y,z,u,v,ox,oy,oz,seamDist,warpEnabled]. ofs er per-hjørne søm-forfining og
    // interpoleres over flaten, så korreksjonen glir jevnt i stedet for å hoppe ved grensen.
    vertex VOutV2 bakev2_vertex(uint vid [[vertex_id]], const device float* v [[buffer(0)]]) {
        uint b = vid * 10;
        VOutV2 o;
        float2 uv = float2(v[b+3], v[b+4]);
        o.position = float4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
        o.wp = float3(v[b], v[b+1], v[b+2]);
        o.ofs = float3(v[b+5], v[b+6], v[b+7]);
        o.seamDist = v[b+8];
        o.warpEnabled = v[b+9];
        return o;
    }

    // Samme normaliserte felt som i refinen og snitt-passet.
    float2 bakev2_detail_uv(float2 uvN, constant float2* grid, constant int2& gdim) {
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
        return clamp(uvN + off, 0.0, 1.0);
    }

    float2 bakev2_scoped_uv(float2 uvN, constant float2* grid, constant int2& gdim, float enabled) {
        return enabled > 0.5 ? bakev2_detail_uv(uvN, grid, gdim) : uvN;
    }

    // Diagnostic only: identical geometric/warp sampling, with no color modification.
    fragment float4 bakev2_raw_fragment(VOutV2 in [[stage_in]],
                                       constant CamV2& c [[buffer(0)]],
                                       constant float2* grid [[buffer(1)]],
                                       constant int2& gdim [[buffer(2)]],
                                       texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float2 pixel = float2(c.intr.x * pc.x / z + c.intr.z, c.intr.y * -pc.y / z + c.intr.w);
        float2 uv = bakev2_scoped_uv(clamp(pixel / c.img.xy, 0.0, 1.0), grid, gdim, in.warpEnabled);
        return float4(frame.sample(s, uv).rgb, 1.0);
    }

    fragment float4 bakev2_fragment(VOutV2 in [[stage_in]],
                                    constant CamV2& c [[buffer(0)]],
                                    constant float2* grid [[buffer(1)]],
                                    constant int2& gdim [[buffer(2)]],
                                    texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);                          // ARKit-kamera ser -z
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;        // bilde-y peker ned
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        uvN = bakev2_scoped_uv(uvN, grid, gdim, in.warpEnabled);
        // Avvignettering (~cos⁴-falloff, K=0.15): iPhone-fotos mørkner mot hjørnene — to
        // lapper fra ulike deler av ulike fotos var uenige selv med perfekt global gain.
        float2 q = uvN - 0.5;
        float devig = 1.0 + DEVIG_K * dot(q, q) * 4.0;
        // Gain (multiplikativ) + søm-nivellering (additiv) i LINEÆRT rom — sRGB-teksturen
        // sampler lineært, render-target skriver sRGB tilbake. c.ofs er region-konstanten
        // (nivået), in.ofs er den interpolerte per-hjørne-forfiningen (overgangen).
        float3 col = clamp(frame.sample(s, uvN).rgb * devig * c.wb.rgb + c.ofs.rgb + in.ofs, 0.0, 1.0);
        return float4(col, 1.0);
    }

    // Fjæringspass: naboregionens foto med alfa 0,5 på sømmen som toner ut til 0 over c.ofs.w
    // meter. c.ofs.rgb er naboregionens nivå; hjørne-forfiningen (in.ofs) hører vinnerens foto
    // til og utelates. Skrives premultiplisert og additivt til et eget lag som legges over
    // vinneren i bakev2_composite.
    fragment float4 bakev2_feather_fragment(VOutV2 in [[stage_in]],
                                            constant CamV2& c [[buffer(0)]],
                                            constant float2* grid [[buffer(1)]],
                                            constant int2& gdim [[buffer(2)]],
                                            texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        uvN = bakev2_scoped_uv(uvN, grid, gdim, in.warpEnabled);
        float2 q = uvN - 0.5;
        float devig = 1.0 + DEVIG_K * dot(q, q) * 4.0;
        float3 col = clamp(frame.sample(s, uvN).rgb * devig * c.wb.rgb + c.ofs.rgb, 0.0, 1.0);
        float a = 0.5 * (1.0 - smoothstep(0.0, max(c.ofs.w, 1e-4), in.seamDist));
        return float4(col * a, a);   // premultiplisert, additivt lag
    }

    // Snitt-pass: additiv akkumulering (farge + dekning i alfa); region-offset utelates —
    // snittet er per definisjon på tvers av frames.
    fragment float4 bakev2_avg_fragment(VOutV2 in [[stage_in]],
                                        constant CamV2& c [[buffer(0)]],
                                        texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        float2 q = uvN - 0.5;
        float devig = 1.0 + DEVIG_K * dot(q, q) * 4.0;
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
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        // Bilineær warp-offset fra rutenettet (indeksert av uvN).
        uvN = bakev2_scoped_uv(uvN, grid, gdim, in.warpEnabled);
        float2 q = uvN - 0.5;
        float devig = 1.0 + DEVIG_K * dot(q, q) * 4.0;
        // Vinkelvekting: flaten som dette synet ser mest HEAD-ON (ortogonalt) skal dominere
        // snittet — grazing-syn bærer parallakse og gir spøkelser (LED-lenke to steder).
        // Normalen hentes fra skjermrom-deriverte av verdensposisjonen (ingen verteks-normal
        // trengs). pow(·,4) gjør vektingen aggressiv nok til å undertrykke spøkelset.
        float3 n = normalize(cross(dfdx(in.wp), dfdy(in.wp)));
        float3 viewDir = normalize(c.camPos.xyz - in.wp);
        float facing = clamp(abs(dot(n, viewDir)), 0.0, 1.0); // abs: normal-orientering er vilkårlig
        // SKARPHETSVEKT PER BILDE (c.wb.w, 2026-09-12 §94). Vekten var ren vinkelvekting:
        // et uskarpt syn som ser flaten head-on slo et skarpt syn på skrå. På et skann der
        // flertallet av bildene er uskarpe (målt: 65 % under skarphet 100 på panelfixturen)
        // blir snittet da mos, og vinnerveien — som plukker DET ENE skarpe — vinner.
        // Med skarpheten i vekten lar samme snitt seg bruke på begge slags skann: er bare
        // ett syn skarpt, dominerer det av seg selv, og snittet oppfører seg som vinneren.
        float w = pow(facing, max(c.camPos.w, 1.0)) * max(c.wb.w, 1e-4) + 1e-3;
        return float4(frame.sample(s, uvN).rgb * devig * c.wb.rgb * w, w);
    }

    // PLAN-SNITT: som avg_warp, men vekten kommer per FLATE fra CPU-scoren (okklusjon,
    // dybdekant, vinkel, avstand, skarphet, utbrenthet) via primitive_id, ikke fra
    // skjermrom-normalen. Additivt: (farge·w, w); komposittet under deler på w.
    fragment float4 bakev2_planeavg_fragment(VOutV2 in [[stage_in]],
                                             uint pid [[primitive_id]],
                                             constant CamV2& c [[buffer(0)]],
                                             constant float2* grid [[buffer(1)]],
                                             constant int2& gdim [[buffer(2)]],
                                             const device float* faceW [[buffer(3)]],
                                             const device float4* faceG [[buffer(5)]],
                                             texture2d<float, access::sample> frame [[texture(0)]]) {
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        uvN = bakev2_scoped_uv(uvN, grid, gdim, in.warpEnabled);
        float2 q = uvN - 0.5;
        float devig = 1.0 + DEVIG_K * dot(q, q) * 4.0;
        float edge = min(min(uvN.x, 1.0 - uvN.x), min(uvN.y, 1.0 - uvN.y));
        float w = (max(faceW[pid], 0.0) + 1e-5) * smoothstep(0.0, 0.08, edge);
        return float4(frame.sample(s, uvN).rgb * devig * c.wb.rgb * faceG[pid].rgb * w, w);
    }

    // Pass 2: som pass 1, men synet teller bare hvis det er innenfor [snitt·(1−shadow), snitt·(1+glare)]
    // i luminans — lampestråler/gjenskinn (lysere) og skannerens skygge (mørkere) kastes ut.
    fragment float4 bakev2_planeavg_fragment2(VOutV2 in [[stage_in]],
                                              uint pid [[primitive_id]],
                                              constant CamV2& c [[buffer(0)]],
                                              constant float2* grid [[buffer(1)]],
                                              constant int2& gdim [[buffer(2)]],
                                              const device float* faceW [[buffer(3)]],
                                              constant float4& thr [[buffer(4)]],
                                              const device float4* faceG [[buffer(5)]],
                                              texture2d<float, access::sample> frame [[texture(0)]],
                                              texture2d<float, access::sample> meanTex [[texture(1)]]) {
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float3 pc = (c.w2c * float4(in.wp, 1.0)).xyz;
        float z = max(-pc.z, 1e-4);
        float u = c.intr.x * (pc.x / z) + c.intr.z;
        float vv = c.intr.y * (-pc.y / z) + c.intr.w;
        float2 uvN = clamp(float2(u / c.img.x, vv / c.img.y), 0.0, 1.0);
        uvN = bakev2_scoped_uv(uvN, grid, gdim, in.warpEnabled);
        float2 q = uvN - 0.5;
        float devig = 1.0 + DEVIG_K * dot(q, q) * 4.0;
        float3 col = frame.sample(s, uvN).rgb * devig * c.wb.rgb * faceG[pid].rgb;
        float edge = min(min(uvN.x, 1.0 - uvN.x), min(uvN.y, 1.0 - uvN.y));
        // Texelens egen posisjon i atlaset = fragmentets skjermposisjon (render-target = atlas).
        float2 aq = in.position.xy / float2(meanTex.get_width(), meanTex.get_height());
        float4 m = meanTex.sample(s, aq);
        float lum = dot(col, float3(0.299, 0.587, 0.114));
        float mlum = dot(m.rgb, float3(0.299, 0.587, 0.114));
        float w = (max(faceW[pid], 0.0) + 1e-5) * smoothstep(0.0, 0.08, edge);
        if (m.a > 0.0) {
            if (thr.z > 0.5) {
                // Hard rejection changes the contributing image set abruptly on a flat
                // ceiling. Fade out outliers continuously instead of cutting a new seam.
                float delta = lum - mlum;
                float hi = mlum * thr.x + 0.004;
                float lo = mlum * thr.y + 0.004;
                float keep = (1.0 - smoothstep(hi, 2.0 * hi, delta))
                           * (1.0 - smoothstep(lo, 2.0 * lo, -delta));
                w *= max(keep, 1e-4);
            } else if (lum > mlum * (1.0 + thr.x) + 0.004 || lum < mlum * (1.0 - thr.y) - 0.004) {
                w = 1e-6;
            }
        }
        return float4(col * w, w);
    }

    kernel void bakev2_planeavg_composite(texture2d<float, access::read> base [[texture(0)]],
                                          texture2d<float, access::sample> acc [[texture(1)]],
                                          texture2d<float, access::write> dst [[texture(2)]],
                                          constant float& dbg [[buffer(0)]],
                                          uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float4 a = acc.sample(s, (float2(gid) + 0.5) / float(W));
        float4 b = base.read(gid);
        if (dbg > 0.5) { dst.write(a.a > 1e-3 ? float4(1.0, 0.0, 1.0, 1.0) : b, gid); return; }
        dst.write(a.a > 1e-3 ? float4(a.rgb / a.a, 1.0) : b, gid);
    }

    // Bredt separabelt blur med valgfri stride (9 taps × stride). Dekningsvektet som bakev2_blur.
    kernel void bakev2_blur_stride(texture2d<float, access::sample> src [[texture(0)]],
                                   texture2d<float, access::write> dst [[texture(1)]],
                                   constant int2& dir [[buffer(0)]],
                                   constant int& stride [[buffer(1)]],
                                   uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        const float wts[9] = {0.05, 0.09, 0.12, 0.15, 0.18, 0.15, 0.12, 0.09, 0.05};
        float3 sum = 0.0; float asum = 0.0; float wsum = 0.0;
        for (int i = -4; i <= 4; i++) {
            float2 q = (float2(gid) + 0.5 + float2(dir * i * stride)) / float(W);
            float4 v = src.sample(s, q);
            float w = wts[i + 4];
            sum += v.rgb * v.a * w; asum += v.a * w; wsum += w;
        }
        dst.write(float4(asum > 0.0 ? sum / asum : 0.0, asum / wsum), gid);
    }

    // PLAN-SNITT hybrid: ut = vinner + (lavSnitt − lavVinner), kun der snittet har dekning.
    kernel void bakev2_planeavg_hybrid(texture2d<float, access::read> base [[texture(0)]],
                                       texture2d<float, access::sample> lowAvg [[texture(1)]],
                                       texture2d<float, access::sample> lowWin [[texture(2)]],
                                       texture2d<float, access::sample> acc [[texture(3)]],
                                       texture2d<float, access::write> dst [[texture(4)]],
                                       constant float& maxCorr [[buffer(0)]],
                                       uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float2 q = (float2(gid) + 0.5) / float(W);
        float4 b = base.read(gid);
        float4 a = acc.sample(s, q);
        if (a.a <= 1e-3 || b.a == 0.0) { dst.write(b, gid); return; }
        float4 la = lowAvg.sample(s, q);
        float4 lw = lowWin.sample(s, q);
        if (la.a < 0.3 || lw.a < 0.3) { dst.write(b, gid); return; }
        float3 corr = clamp(la.rgb - lw.rgb, -maxCorr, maxCorr);
        dst.write(float4(clamp(b.rgb + corr, 0.0, 1.0), 1.0), gid);
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
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
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
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
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
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
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
                                 texture2d<float, access::sample> feather [[texture(4)]],
                                 constant float& maxCorr [[buffer(0)]],
                                 uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        float4 w = win.read(gid);
        if (w.a == 0.0) { dst.write(float4(0.0), gid); return; }
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float2 q = (float2(gid) + 0.5) / float(W);
        // Søm-fjæring: naboens foto (premultiplisert) over vinneren.
        float4 f = feather.sample(s, q);
        w.rgb = w.rgb * (1.0 - min(f.a, 1.0)) + f.rgb;
        float4 la = lowAvg.sample(s, q);
        float4 lw = lowWin.sample(s, q);
        // Tone-klemme: multiband-korreksjonen (snitt − vinner) er ALT tone-laget får lov å
        // endre. Parallakse-spøkelser (spotlight sett fra 3 vinkler) og innsmurt smuss er
        // STORE korreksjoner → kappes ved ±maxCorr; eksponerings-flating er små → passerer.
        float3 corr = clamp(la.rgb - lw.rgb, -maxCorr, maxCorr);
        float3 outc = (la.a > 0.3 && lw.a > 0.3) ? clamp(w.rgb + corr, 0.0, 1.0) : w.rgb;
        dst.write(float4(outc, 1.0), gid);
    }

    // MIKROKONTRAST (2026-09-11). Et 2 mm nedfelt panelspor synes bare fordi det fanger
    // skygge. I flatt kveldslys er sporet nesten borte I SELVE FOTOET: målt vinnerfoto i et
    // kveldsskann har 1,95 % sporkontrast mot 8,54 % i et dagslysskann av samme slags vegg,
    // med bare 1,3× forskjell i avstand. Da er det ikke mer oppløsning som mangler, det er
    // kontrast. Ulikt skarphet gir dette ingen ny detalj — det løfter den som ER der, på
    // spor-skalaen (2-4 texler), slik at veggen leses som panel og ikke som flat maling.
    // Amplituden er klemt, så JPEG-støy og chart-kanter ikke blåses opp.
    // Måler hvor mye sporkontrast atlaset FAKTISK har: snitt av |dI/dx| i luma over malte
    // texler. Brukes til å velge mikrokontrast-styrken, så et dagslysskann ikke overskjerpes
    // mens et flatt kveldsskann løftes.
    // Flatemaske: 1 der texelen tilhører et vegg-/tak-plan. Tegnes med samme vertex-
    // funksjon og de samme UV-ene som fargepassene, så masken ligger eksakt på atlaset.
    fragment float bakev2_mask_fragment(VOutV2 in [[stage_in]]) { return 1.0; }

    kernel void bakev2_kontrastmaal(texture2d<float, access::read> src [[texture(0)]],
                                    texture2d<float, access::read> mask [[texture(1)]],
                                    device atomic_uint* ut [[buffer(0)]],
                                    constant float2& par [[buffer(1)]],
                                    uint2 gid [[thread_position_in_grid]]) {
        uint W = src.get_width(), H = src.get_height();
        // STEGET ER FYSISK, ikke én texel. Per-texel-gradient måler atlasets oppløsning,
        // ikke veggens skarphet: målt 1930 texler/m mot 1214 på de to fixturene ga 5,90 mot
        // 9,70 % — forholdet 1,64 er nøyaktig tetthetsforholdet 1,59, og rangeringen blir
        // motsatt av det øyet ser. Med et steg på ~2,5 mm i VERDEN måler begge det samme.
        uint steg = uint(max(1.0, par.y));
        if (gid.x + steg >= W || gid.y >= H) return;
        // Bare PLANE flater teller. Uten masken domineres 98-persentilen av møbelkanter,
        // bokrygger og tekst — målt: den skarpe veggen fikk LAVERE tall enn den flate
        // (12,7 mot 11,3 %), altså motsatt av virkeligheten, og adaptiv styrke ble umulig.
        if (par.x > 0.5 && (mask.read(gid).r < 0.5 || mask.read(uint2(gid.x + steg, gid.y)).r < 0.5)) return;
        float4 a = src.read(gid), b = src.read(uint2(gid.x + steg, gid.y));
        if (a.a <= 0.0 || b.a <= 0.0) return;
        float la = dot(a.rgb, float3(0.299, 0.587, 0.114));
        float lb = dot(b.rgb, float3(0.299, 0.587, 0.114));
        if (la < 0.02) return;
        // HISTOGRAM, ikke snitt: snittet over et atlas domineres av flate felt og gir
        // motsatt svar (målt: den skarpe veggen fikk LAVERE snitt enn den flate, fordi
        // atlaset dekker ulike flater). 128 bøtter à 0,4 % relativ gradient (opp til 51 %;
        // med fysisk steg blir gradientene større og sprengte det gamle 64×0,2 %-taket).
        // CPU-en tar 98-persentilen, som er sporene og ikke veggen mellom dem.
        float rel = fabs(la - lb) / la;
        uint bi = uint(clamp(rel / 0.004, 0.0, 127.0));
        atomic_fetch_add_explicit(&ut[bi], 1u, memory_order_relaxed);
    }

    kernel void bakev2_mikro(texture2d<float, access::read> src [[texture(0)]],
                             texture2d<float, access::write> dst [[texture(1)]],
                             constant float2& par [[buffer(0)]],
                             uint2 gid [[thread_position_in_grid]]) {
        uint W = src.get_width(), H = src.get_height();
        if (gid.x >= W || gid.y >= H) return;
        float4 c = src.read(gid);
        if (c.a <= 0.0) { dst.write(c, gid); return; }
        int r = int(par.y);
        float3 sum = 0.0; float n = 0.0;
        for (int dy = -r; dy <= r; dy++) for (int dx = -r; dx <= r; dx++) {
            int2 q = int2(gid) + int2(dx, dy);
            if (q.x < 0 || q.y < 0 || q.x >= int(W) || q.y >= int(H)) continue;
            float4 s = src.read(uint2(q));
            if (s.a <= 0.0) continue;
            sum += s.rgb; n += 1.0;
        }
        // FULL STØTTE KREVES. Et ulikt-skarpt filter med ensidig nabolag er ikke skarping,
        // det er en kant-forsterker: en texel på chart-kanten får bare naboer fra innsiden,
        // det lokale snittet blir skjevt, og en mørk panelkant blir en mørk rand som
        // dilatasjonen deretter smører 16 texler ut i det innfylte området (målt: en mørk
        // rød brem langs hele hullkanten på soveromsfixturen). Texler nærmere enn radiusen
        // til en umalt nabo står urørt — 3 texler er 1,6 mm på 1900 texler/m.
        if (n < float((2 * r + 1) * (2 * r + 1))) { dst.write(c, gid); return; }
        float3 lav = sum / n;
        float3 detalj = c.rgb - lav;
        // Klem på ±0,12 i lineær RGB: nok til et spor, for lite til å forsterke en søm.
        float3 løft = clamp(detalj * par.x, -0.12, 0.12);
        dst.write(float4(clamp(c.rgb + løft, 0.0, 1.0), c.a), gid);
    }

    kernel void bakev2_pp_down(texture2d<float, access::read> src [[texture(0)]],
                               texture2d<float, access::write> dst [[texture(1)]],
                               uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        float3 sum = 0.0; float n = 0.0;
        for (uint dy = 0; dy < 2; dy++) for (uint dx = 0; dx < 2; dx++) {
            float4 s = src.read(uint2(gid.x * 2 + dx, gid.y * 2 + dy));
            if (s.a > 0.0) { sum += s.rgb; n += 1.0; }
        }
        dst.write(n > 0.0 ? float4(sum / n, 1.0) : float4(0.0), gid);
    }

    // Beholder egne texler, arver grovere nivå der alfa er 0. Bilineær oppsampling gir mykt
    // fyll uten trappetrinn; grovnivået er alt dekningsvektet, så tomme områder drar ikke mot svart.
    kernel void bakev2_pp_up(texture2d<float, access::read> own [[texture(0)]],
                             texture2d<float, access::sample> coarse [[texture(1)]],
                             texture2d<float, access::write> dst [[texture(2)]],
                             uint2 gid [[thread_position_in_grid]]) {
        uint W = dst.get_width();
        if (gid.x >= W || gid.y >= W) return;
        float4 o = own.read(gid);
        if (o.a > 0.0) { dst.write(o, gid); return; }
        constexpr sampler s(filter::linear, mip_filter::linear, address::clamp_to_edge);
        float4 c = coarse.sample(s, (float2(gid) + 0.5) / float(W));
        dst.write(c.a > 0.0 ? float4(c.rgb, 1.0) : float4(0.0), gid);
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
