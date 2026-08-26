import Foundation
import ARKit
import simd
import Metal
import CoreGraphics
import ImageIO

/// Builds a single GLB 2.0 (Three.js-friendly) from ARKit scene-reconstruction mesh anchors —
/// the dense LiDAR surface mesh (Polycam-style). Optional per-vertex colour (sampled from the
/// camera during scanning) writes a COLOR_0 attribute so Three.js shows a textured-ish result.
enum ARMeshGlbExporter {
    /// Fase-rapportering til skanner-UI-et under baking («Pakker UV-atlas…» osv.).
    nonisolated(unsafe) static var progress: ((String) -> Void)?

    enum ExportError: LocalizedError {
        case noMeshData
        case writeFailed
        var errorDescription: String? {
            switch self {
            case .noMeshData: return "Ingen mesh-data i skannet"
            case .writeFailed: return "Kunne ikke skrive GLB-fil"
            }
        }
    }

    /// `colorProvider` maps a world-space position to an RGB colour (0–1), or nil for no colour at
    /// that point. When provided, every vertex gets a colour (grey fallback) and COLOR_0 is written.
    @available(iOS 13.4, *)
    static func export(
        anchors: [ARMeshAnchor],
        to glbURL: URL,
        colorProvider: ((SIMD3<Float>) -> SIMD3<Float>?)? = nil
    ) throws {
        let m = buildMerged(anchors: anchors, colorProvider: colorProvider)
        if m.positions.isEmpty { throw ExportError.noMeshData }
        try writeGlb(positions: m.positions, normals: m.normals, colors: m.colors, indices: m.indices, to: glbURL)
    }

    /// Utfall av tekstur-baken (MeshBakeV2) — additivt kvalitetssignal for JS/UI, ikke brukt
    /// i selve baken. `filledFraction` er kun kjent når baken faktisk kjørte (nil ellers).
    struct TexturedExportResult {
        let success: Bool
        let filledFraction: Double?
        let geometryPath: String  // "anchor-v2" eller "anchor-fallback" (uteksturert reserve)
    }

    /// Grovt «hvilket område/retning ble filmet»-bøtte fra en keyframes kamera-transform —
    /// posisjon kvantisert til 0,6 m, blikkretning kvantisert til 30°. Samme idé som dekningsoverlayens
    /// pose-dedup (MeshScanPresenter.maybeCaptureKeyframe), men grovere: vi vil ha romlige REGIONER
    /// her, ikke bare distinkte kamera-poser. transform-layoutet er identisk (camera-to-world,
    /// 16 floats kolonne-major) — samme uttrekk som c2w() i TSDFFusion.swift.
    private static func regionBucket(_ k: MeshScanPresenter.Keyframe) -> Int64 {
        let t = k.transform
        let pos = SIMD3<Float>(t[12], t[13], t[14])
        let fwd = simd_normalize(SIMD3<Float>(-t[8], -t[9], -t[10]))
        let bx = Int64((pos.x / 0.6).rounded()), by = Int64((pos.y / 0.6).rounded()), bz = Int64((pos.z / 0.6).rounded())
        let step: Float = .pi / 6 // 30°
        let yawRad: Float = atan2(fwd.z, fwd.x) + .pi
        let yawB = Int64((yawRad / step).rounded())            // 12 bøtter
        let pitchClamped: Float = max(-1, min(1, fwd.y))
        let pitchRad: Float = asin(pitchClamped) + .pi / 2
        let pitchB = Int64((pitchRad / step).rounded())        // 6 bøtter
        return (bx & 0x3FFF) | ((by & 0x3FFF) << 14) | ((bz & 0x3FFF) << 28) | ((yawB & 0x3F) << 42) | ((pitchB & 0x3F) << 48)
    }

    /// Dekningsbevisst utvalg til bake-budsjettet: garanterer minst én keyframe per besøkt
    /// område/retning FØR resten av budsjettet fylles med rene skarphets-vinnere. Uten dette
    /// kan et lite besøkt område (f.eks. et tak i et trangt rom) miste ALL bake-dekning hvis
    /// dets beste frames ikke er blant de skarpeste i hele rommet — selv om dekningsoverlayen
    /// viste grønt der under selve skanningen (se gap-analyse: coverage vs. bake er frikoblet).
    static func selectCoverageAware(_ keyframes: [MeshScanPresenter.Keyframe], budget: Int) -> [MeshScanPresenter.Keyframe] {
        func kfScore(_ k: MeshScanPresenter.Keyframe) -> Float { k.sharpness / (1 + 2 * k.motion) }
        var byBucket = [Int64: MeshScanPresenter.Keyframe](minimumCapacity: keyframes.count / 2)
        for k in keyframes {
            let b = regionBucket(k)
            if let existing = byBucket[b], kfScore(existing) >= kfScore(k) { continue }
            byBucket[b] = k
        }
        var guaranteed = Array(byBucket.values).sorted { kfScore($0) > kfScore($1) }
        if guaranteed.count > budget {
            MeshLog.log("dekningsbevisst utvalg — \(guaranteed.count) regioner > \(budget) budsjett, kutter til de skarpeste")
            return Array(guaranteed.prefix(budget))
        }
        let usedIndices = Set(guaranteed.map { $0.index })
        let rest = keyframes
            .filter { !usedIndices.contains($0.index) }
            .sorted { kfScore($0) > kfScore($1) }
        guaranteed.append(contentsOf: rest.prefix(budget - guaranteed.count))
        MeshLog.log("dekningsbevisst utvalg — \(byBucket.count) regioner garantert, \(guaranteed.count) totalt av \(keyframes.count)")
        return guaranteed
    }

    @available(iOS 13.4, *)
    static func buildMerged(
        anchors: [ARMeshAnchor],
        colorProvider: ((SIMD3<Float>) -> SIMD3<Float>?)? = nil,
        refine: Bool = true
    ) -> (positions: [Float], normals: [Float], colors: [Float], indices: [UInt32], triAnchor: [UInt32], planes: [SIMD4<Float>]) {
        var positions: [Float] = []
        var normals: [Float] = []
        var colors: [Float] = []
        var indices: [UInt32] = []
        var triAnchor: [UInt32] = [] // anchor-indeks per triangel → chunket unwrap (én xatlas-mesh per anchor)
        let grey = SIMD3<Float>(0.62, 0.62, 0.64)

        for (anchorIdx, anchor) in anchors.enumerated() {
            let geom = anchor.geometry
            let transform = anchor.transform
            let normalMatrix = simd_transpose(simd_inverse(simd_float3x3(
                SIMD3(transform.columns.0.x, transform.columns.0.y, transform.columns.0.z),
                SIMD3(transform.columns.1.x, transform.columns.1.y, transform.columns.1.z),
                SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
            )))

            let startVertex = UInt32(positions.count / 3)
            let vertCount = geom.vertices.count
            let vBuf = geom.vertices.buffer.contents()
            let vStride = geom.vertices.stride
            let vOffset = geom.vertices.offset
            let nSource = geom.normals
            let nBuf = nSource.buffer.contents()
            let nStride = nSource.stride
            let nOffset = nSource.offset

            for i in 0..<vertCount {
                let vp = vBuf.advanced(by: vOffset + i * vStride).assumingMemoryBound(to: SIMD3<Float>.self).pointee
                let world4 = transform * SIMD4<Float>(vp.x, vp.y, vp.z, 1)
                let world = SIMD3<Float>(world4.x, world4.y, world4.z)
                positions.append(world.x)
                positions.append(world.y)
                positions.append(world.z)

                let np = nBuf.advanced(by: nOffset + i * nStride).assumingMemoryBound(to: SIMD3<Float>.self).pointee
                let wn = simd_normalize(normalMatrix * np)
                normals.append(wn.x)
                normals.append(wn.y)
                normals.append(wn.z)

                if colorProvider != nil {
                    let c = colorProvider?(world) ?? grey
                    colors.append(c.x)
                    colors.append(c.y)
                    colors.append(c.z)
                    colors.append(1)
                }
            }

            let faces = geom.faces
            let fBuf = faces.buffer.contents()
            let bytesPerIndex = faces.bytesPerIndex
            let perPrim = faces.indexCountPerPrimitive // 3 for triangles
            // Drop stretched triangles: ARKit surface tris are small; long edges bridge gaps/noise
            // and show up as floating shards. Skip any triangle with an edge longer than maxEdge.
            let maxEdge: Float = 0.35
            func readIdx(_ i: Int) -> UInt32 {
                let p = fBuf.advanced(by: i * bytesPerIndex)
                return bytesPerIndex == 2
                    ? UInt32(p.assumingMemoryBound(to: UInt16.self).pointee)
                    : p.assumingMemoryBound(to: UInt32.self).pointee
            }
            func worldAt(_ localIdx: UInt32) -> SIMD3<Float> {
                let base = (Int(startVertex) + Int(localIdx)) * 3
                return SIMD3<Float>(positions[base], positions[base + 1], positions[base + 2])
            }
            if perPrim == 3 {
                for t in 0..<faces.count {
                    let a = readIdx(t * 3), b = readIdx(t * 3 + 1), c = readIdx(t * 3 + 2)
                    let pa = worldAt(a), pb = worldAt(b), pc = worldAt(c)
                    if simd_distance(pa, pb) > maxEdge || simd_distance(pb, pc) > maxEdge || simd_distance(pc, pa) > maxEdge {
                        continue
                    }
                    indices.append(a + startVertex)
                    indices.append(b + startVertex)
                    indices.append(c + startVertex)
                    triAnchor.append(UInt32(anchorIdx))
                }
            } else {
                for i in 0..<(faces.count * perPrim) {
                    indices.append(readIdx(i) + startVertex)
                }
                for _ in 0..<faces.count { triAnchor.append(UInt32(anchorIdx)) }
            }
        }

        // Plane-snap FØR dedup: ARKit-drift legger gjenbesøkte tak/vegger som parallelle LAG
        // 5–12 cm fra hverandre — for langt unna til at 6cm-cellededuppen ser dem. Snapping
        // kollapser lagene til ETT plan (så dedupen kan ta interiøret), lukker drift-sprekker,
        // og gir knivflate vegger/tak.
        let planes = snapDominantPlanes(positions: &positions, indices: indices)
        // Flate-dedup: naboanchors legger OVERLAPPENDE flak over samme flate (ulik triangulering,
        // centimeter fra hverandre). Dobbeltflakene gir (a) «shingel»-tak av lag på lag, (b) svarte
        // bake-texels (flak med søppelnormal feiler facing-testen for alle bilder) og (c) dobbel
        // jobb for xatlas. Per (voxel, normal-retning) vinner anchoren med flest triangler.
        dropOverlapSheets(positions: positions, indices: &indices, triAnchor: &triAnchor)
        // Plan-bevisst lag-dedup: 3D-cellededuppen skiller lag i normal-retningen (ulike celler)
        // og ser dem aldri. I PLANETS 2D-koordinater er lagene derimot samme flate — fjern
        // fremmed-interiør der (spøkelsesflakene/halvtransparente lagrestene på tak og vegger).
        dropCoplanarLayers(planes: planes, positions: positions, indices: &indices, triAnchor: &triAnchor)
        // Dobbeltflate-fjerning langs normalen: drift-kopier 4–12 cm fra hverandre ligger i
        // dødsonen mellom celle-dedup (±6 cm) og fantomtesten (trenger ≥15 cm klaring pga
        // dybdestøy) — «samme hull vises to ganger». Denne søker eksplisitt etter en annen
        // anchors samme-vendte flate langs normalen og feller taperen per anchor-par.
        dropDoubleSurfaces(positions: positions, indices: &indices, triAnchor: &triAnchor)
        // Mesh cleanup: drop small disconnected components (floating shards from noisy tracking —
        // mørkt stoff/griller gir svak LiDAR-retur → frittsvevende spøkelsesfragmenter). Relativ
        // terskel (0,5 % av meshet, min 120 tris): ekte møbler henger sammen med gulv/vegg via
        // meshet, fragmenter gjør ikke. Færre øyer = færre charts = mye raskere xatlas.
        indices = filterSmallComponents(vertexCount: positions.count / 3, indices: indices,
                                        minTris: max(120, indices.count / 3 / 200), triAnchor: &triAnchor)
        // Hullfylling: vindusglass/skjermer/mørkt stoff gir ingen LiDAR-retur → hull som viser
        // viewer-bakgrunnen. Fyll planære grenseløkker med vifte FØR unwrap, så lappene får
        // charts og bakes projektivt fra keyframene som alt annet — vinduet/skjermen får sitt
        // faktiske fotoinnhold (Polycam-trikset).
        fillPlanarHoles(positions: &positions, colors: &colors, indices: &indices, triAnchor: &triAnchor)
        // Subdivide Apple's coarse ARMeshAnchor triangles (1 level → 4×) so the smoothing below can
        // round the blocky geometry into organic surfaces and the projective texture stretches over
        // curves without facet seams. NB: subdivision alone is a no-op (coplanar splits) — the Taubin
        // smoothing is what actually de-polygonises; the dense mesh just lets it round smoothly.
        // Teksturbanen hopper over subdivisjonen (refine=false): teksturen bærer detaljene,
        // og 4× færre triangler gjør xatlas-unwrappen dramatisk raskere.
        if refine {
            let trisBefore = indices.count / 3
            indices = subdivideMesh(positions: &positions, colors: &colors, indices: indices)
            NSLog("[MeshScan] subdivide — tris \(trisBefore) → \(indices.count / 3)")
            triAnchor = [] // 1→4-splitten invaliderer per-tri-anchors; refine-banen unwrapper ikke chunket
        }
        // Taubin smoothing (alternating λ / −μ) rounds the mesh without the corner-shrinkage that
        // repeated plain Laplacian causes — keeps 90° wall corners while melting the spiky low-poly.
        // Glattes via SVEISET konnektivitet: naboanchors deler ikke vertekser, så uten dette driver
        // flisgrensene fra hverandre → svarte sprekker langs anchor-gridet. Selve meshet holdes
        // usveiset (xatlas kveles av non-manifold topologi fra overlappende anchor-flak).
        weldedTaubinSmooth(positions: &positions, indices: indices, passes: 3)
        // KRITISK for xatlas: welded-glattingen gjør anchor-overlappenes posisjoner EKSAKT like →
        // samme flate fra to anchors blir duplikatflate, og smale triangler kollapser til null
        // areal. xatlas' chart-vekst koster på areal — null/duplikat gir NaN/evig løkke («stuck
        // på Analyserer flater»). Fjern dem her; de er per definisjon redundante.
        indices = dropDegenerateAndDuplicateFaces(positions: positions, indices: indices, triAnchor: &triAnchor)
        normals = recomputeNormals(positions: positions, indices: indices)
        return (positions, normals, colors, indices, triAnchor, planes)
    }

    /// Plan-bevisst lag-dedup: for hvert snappet plan, prosjiser nær-plan-triangler (±6 cm,
    /// normal ≤ ~25°) til planets 2D-koordinater og kjør 8 cm-celle-eierskap der. Lag som
    /// 3D-cellededuppen aldri ser (skilt i normal-retning) er samme flate i 2D. Samme
    /// konservative regel: dropp kun triangler der ALLE tre verteksceller har fremmed eier.
    static func dropCoplanarLayers(planes: [SIMD4<Float>], positions: [Float], indices: inout [UInt32], triAnchor: inout [UInt32]) {
        let triCount = indices.count / 3
        guard !planes.isEmpty, triAnchor.count == triCount, triCount > 0 else { return }
        func pt(_ vi: UInt32) -> SIMD3<Float> {
            let i = Int(vi) * 3
            return SIMD3(positions[i], positions[i + 1], positions[i + 2])
        }
        var drop = [Bool](repeating: false, count: triCount)
        var removed = 0
        for pl in planes {
            let n = SIMD3(pl.x, pl.y, pl.z)
            let d = pl.w
            let t1 = simd_normalize(abs(n.y) < 0.9 ? simd_cross(n, SIMD3(0, 1, 0)) : simd_cross(n, SIMD3(1, 0, 0)))
            let t2 = simd_cross(n, t1)
            func cell2D(_ p: SIMD3<Float>) -> Int64 {
                (Int64((simd_dot(p, t1) / 0.08).rounded()) & 0xFFFFFF) | ((Int64((simd_dot(p, t2) / 0.08).rounded()) & 0xFFFFFF) << 24)
            }
            // Pass 1: nær-plan-triangler → arealtelling per (2D-celle → anchor)
            var counts = [Int64: [UInt32: Float]]()
            var near = [Int]()
            for t in 0..<triCount where !drop[t] {
                let a = pt(indices[t * 3]), b = pt(indices[t * 3 + 1]), c = pt(indices[t * 3 + 2])
                if abs(simd_dot(n, a) - d) > 0.06 || abs(simd_dot(n, b) - d) > 0.06 || abs(simd_dot(n, c) - d) > 0.06 { continue }
                let cr = simd_cross(b - a, c - a)
                let len = simd_length(cr)
                if len < 1e-9 || simd_dot(cr / len, n) < 0.9 { continue }
                near.append(t)
                counts[cell2D((a + b + c) / 3), default: [:]][triAnchor[t], default: 0] += len * 0.5
            }
            var owner = [Int64: UInt32](minimumCapacity: counts.count)
            for (cell, byAnchor) in counts { owner[cell] = byAnchor.max { $0.value < $1.value }!.key }
            // Pass 2: dropp triangler der alle tre verteksceller er fremmed-eid
            for t in near {
                let mine = triAnchor[t]
                var interiorForeign = true
                for k in 0..<3 {
                    let o = owner[cell2D(pt(indices[t * 3 + k]))]
                    if o == nil || o == mine { interiorForeign = false; break }
                }
                if interiorForeign { drop[t] = true; removed += 1 }
            }
            // Sult-vakt: ved anchor-GRENSER (ikke ekte lag) eier cellene hverandres naboer i
            // sjakkmønster, og uten vakt felles BEGGE sider → grå kors-hull langs anchor-
            // rutenettet («crosses of grey», device 2026-08-26). Hull-fyllet redder dem ikke
            // (slisser > 1,5m-taket). Angre droppet der en celle mister >80 % av flaten sin —
            // ekte lag beholder vinnerens ≥~50 % og felles fortsatt.
            func triArea2(_ t: Int) -> Float {
                let a = pt(indices[t * 3]), b = pt(indices[t * 3 + 1]), c = pt(indices[t * 3 + 2])
                return simd_length(simd_cross(b - a, c - a)) * 0.5
            }
            var totalArea = [Int64: Float](minimumCapacity: counts.count)
            for (cell, byAnchor) in counts { totalArea[cell] = byAnchor.values.reduce(0, +) }
            var droppedArea = [Int64: Float]()
            for t in near where drop[t] {
                let a = pt(indices[t * 3]), b = pt(indices[t * 3 + 1]), c = pt(indices[t * 3 + 2])
                droppedArea[cell2D((a + b + c) / 3), default: 0] += triArea2(t)
            }
            for t in near where drop[t] {
                var starves = false
                for k in 0..<3 {
                    let cell = cell2D(pt(indices[t * 3 + k]))
                    guard let tot = totalArea[cell], tot > 0 else { continue }
                    if tot - (droppedArea[cell] ?? 0) < 0.2 * tot { starves = true; break }
                }
                if starves {
                    drop[t] = false; removed -= 1
                    let a = pt(indices[t * 3]), b = pt(indices[t * 3 + 1]), c = pt(indices[t * 3 + 2])
                    droppedArea[cell2D((a + b + c) / 3), default: 0] -= triArea2(t)
                }
            }
        }
        guard removed > 0 else { return }
        var outIdx = [UInt32](); outIdx.reserveCapacity(indices.count)
        var outAnchor = [UInt32](); outAnchor.reserveCapacity(triCount)
        for t in 0..<triCount where !drop[t] {
            outIdx.append(indices[t * 3]); outIdx.append(indices[t * 3 + 1]); outIdx.append(indices[t * 3 + 2])
            outAnchor.append(triAnchor[t])
        }
        MeshLog.log("coplanar dedup — fjernet \(removed) lag-tris på \(planes.count) plan")
        indices = outIdx
        triAnchor = outAnchor
    }

    /// Dobbeltflate-fjerning: SAMME flate meshet to ganger av to anchors, 4–12 cm fra hverandre
    /// (drift). For hvert triangel probes 5 cm-voxler ±5/±10 cm langs normalen etter en ANNEN
    /// anchors samme-vendte geometri. Per anchor-par felles taperen globalt (minst totalareal);
    /// taperens triangler med rival i korridoren droppes — OGSÅ kantene: vinneren er samme
    /// flate og dekker dem (kant-konservatisme her ga «samme hull vises to ganger»).
    static func dropDoubleSurfaces(positions: [Float], indices: inout [UInt32], triAnchor: inout [UInt32]) {
        let triCount = indices.count / 3
        guard triAnchor.count == triCount, triCount > 0 else { return }
        let inv: Float = 1.0 / 0.05
        func cellKey(_ x: Float, _ y: Float, _ z: Float, _ bucket: Int64) -> Int64 {
            let qx = Int64((x * inv).rounded()), qy = Int64((y * inv).rounded()), qz = Int64((z * inv).rounded())
            return ((qx & 0xFFFFF) | ((qy & 0xFFFFF) << 20) | ((qz & 0xFFFFF) << 40)) | (bucket << 60)
        }
        var triN = [SIMD3<Float>](repeating: .zero, count: triCount)
        var triC = [SIMD3<Float>](repeating: .zero, count: triCount)
        var triB = [Int64](repeating: 0, count: triCount)
        var triA = [Float](repeating: 0, count: triCount)
        var cellArea = [Int64: [UInt32: Float]](minimumCapacity: triCount / 2)
        var anchorArea = [UInt32: Float]()
        for t in 0..<triCount {
            let a = Int(indices[t * 3]) * 3, b = Int(indices[t * 3 + 1]) * 3, c = Int(indices[t * 3 + 2]) * 3
            let pa = SIMD3(positions[a], positions[a + 1], positions[a + 2])
            let pb = SIMD3(positions[b], positions[b + 1], positions[b + 2])
            let pc = SIMD3(positions[c], positions[c + 1], positions[c + 2])
            let cr = simd_cross(pb - pa, pc - pa)
            let len = simd_length(cr)
            if len < 1e-9 { continue }
            let n = cr / len
            let area = len * 0.5
            let ax = abs(n.x), ay = abs(n.y), az = abs(n.z)
            let bkt: Int64 = ax >= ay && ax >= az ? (n.x >= 0 ? 0 : 1) : (ay >= az ? (n.y >= 0 ? 2 : 3) : (n.z >= 0 ? 4 : 5))
            triN[t] = n; triC[t] = (pa + pb + pc) / 3; triB[t] = bkt; triA[t] = area
            cellArea[cellKey(triC[t].x, triC[t].y, triC[t].z, bkt), default: [:]][triAnchor[t], default: 0] += area
            anchorArea[triAnchor[t], default: 0] += area
        }
        // Pass 1: finn rivaler langs normalen → konfliktareal per anchor-par.
        // REKKEVIDDE MAKS ±10 cm: ±15 spiste EKTE parallell geometri (sengegavl ~10-15cm foran
        // vegg, dyne over madrass) — veggen ble synlig GJENNOM gavlen. Ikke øk denne igjen
        // uten dybde-støtte-vakt (kun fell tris som ingen keyframe-dybde bekrefter).
        let offsets: [Float] = [-0.10, -0.05, 0.05, 0.10]
        func pairKey(_ a: UInt32, _ b: UInt32) -> UInt64 { (UInt64(min(a, b)) << 32) | UInt64(max(a, b)) }
        var pairConflict = [UInt64: Float]()
        var triRivals = [[UInt32]](repeating: [], count: triCount)
        for t in 0..<triCount where triA[t] > 0 {
            var rivals = [UInt32]()
            for off in offsets {
                let p = triC[t] + triN[t] * off
                guard let cell = cellArea[cellKey(p.x, p.y, p.z, triB[t])] else { continue }
                // ≥5 cm² i cellen (en 5 cm-celle rommer maks ~25 cm²) — filtrerer enslige støy-tris
                for (anchor, area) in cell where anchor != triAnchor[t] && area > 0.0005 {
                    if !rivals.contains(anchor) { rivals.append(anchor) }
                }
            }
            if !rivals.isEmpty {
                triRivals[t] = rivals
                for r in rivals { pairConflict[pairKey(triAnchor[t], r), default: 0] += triA[t] }
            }
        }
        // Pass 2: per par med vesentlig konflikt (≥0,15 m²): taper = minst totalareal.
        // 0,08 var for lavt — små ekte par (gavl-seksjoner, dynefolder) ble felt.
        var loser = [UInt64: UInt32]()
        for (pk, conflict) in pairConflict where conflict >= 0.15 {
            let a = UInt32(pk >> 32), b = UInt32(pk & 0xFFFF_FFFF)
            loser[pk] = (anchorArea[a] ?? 0) <= (anchorArea[b] ?? 0) ? a : b
        }
        guard !loser.isEmpty else { return }
        // Pass 3: dropp taperens triangler som har vinner-rival i korridoren
        var outIdx = [UInt32](); outIdx.reserveCapacity(indices.count)
        var outAnchor = [UInt32](); outAnchor.reserveCapacity(triCount)
        var removed = 0
        for t in 0..<triCount {
            let mine = triAnchor[t]
            var dropTri = false
            for r in triRivals[t] where loser[pairKey(mine, r)] == mine { dropTri = true; break }
            if dropTri { removed += 1; continue }
            outIdx.append(indices[t * 3]); outIdx.append(indices[t * 3 + 1]); outIdx.append(indices[t * 3 + 2])
            outAnchor.append(triAnchor[t])
        }
        if removed > 0 {
            MeshLog.log("dobbeltflate — fjernet \(removed) tris (\(loser.count) anchor-par i konflikt)")
            indices = outIdx
            triAnchor = outAnchor
        }
    }

    /// Plane-snap: finn dominante plan (tak/gulv/vegger, også skråtak) og trekk nærliggende,
    /// normal-justerte vertekser inn på planet. Retningsbucketer (24 asimut × 12 elevasjon) →
    /// offset-histogram (2,5 cm-bins) per sterk retning → topper ≥ 1 m² areal og RMS ≤ 2,2 cm
    /// blir plan. Snap-rekkevidde 12 cm fanger drift-lag (topp-undertrykkelse ±12,5 cm hindrer
    /// at laget blir eget plan), mens vaktene beskytter ekte geometri: taklister/karmer/brytere
    /// har avvikende normal (krav ≤ ~25°), dyner/senger er for ujevne (RMS-kravet), og møbler
    /// lengre enn 12 cm fra planet får enten eget plan (store flater) eller røres ikke.
    @discardableResult
    static func snapDominantPlanes(positions: inout [Float], indices: [UInt32]) -> [SIMD4<Float>] {
        let triCount = indices.count / 3
        let vc = positions.count / 3
        guard triCount > 0, vc > 0 else { return [] }
        func pt(_ vi: Int) -> SIMD3<Float> { SIMD3(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]) }

        // Per-tri normal/areal/centroid + arealvektede verteksnormaler + retningsbucketer
        var vNormal = [SIMD3<Float>](repeating: .zero, count: vc)
        var triN = [SIMD3<Float>](repeating: .zero, count: triCount)
        var triA = [Float](repeating: 0, count: triCount)
        var triD = [Float](repeating: 0, count: triCount) // gjenbrukes per retning
        var triC = [SIMD3<Float>](repeating: .zero, count: triCount)
        var dirArea = [Float](repeating: 0, count: 12 * 24)
        var dirSum = [SIMD3<Float>](repeating: .zero, count: 12 * 24)
        for t in 0..<triCount {
            let a = Int(indices[t * 3]), b = Int(indices[t * 3 + 1]), c = Int(indices[t * 3 + 2])
            let pa = pt(a), pb = pt(b), pc = pt(c)
            let cr = simd_cross(pb - pa, pc - pa)
            let len = simd_length(cr)
            if len < 1e-9 { continue }
            let n = cr / len
            let area = len * 0.5
            triN[t] = n; triA[t] = area; triC[t] = (pa + pb + pc) / 3
            let w = n * area
            vNormal[a] += w; vNormal[b] += w; vNormal[c] += w
            let el = min(11, Int((asin(max(-1, min(1, n.y))) + .pi / 2) / .pi * 12))
            // Polar-kollaps: nær vertikal normal (tak/gulv) er asimut meningsløs støy — uten
            // dette smøres takarealet utover 24 bøtter og taket blir aldri kandidat.
            let az = (el == 0 || el == 11) ? 0 : min(23, Int((atan2(n.z, n.x) + .pi) / (2 * .pi) * 24))
            dirArea[el * 24 + az] += area
            dirSum[el * 24 + az] += w
        }

        struct Plane { var n: SIMD3<Float>; var d: Float; var area: Float }
        var planes = [Plane]()
        let minArea: Float = 1.0
        let cand = (0..<(12 * 24)).filter { dirArea[$0] >= minArea }.sorted { dirArea[$0] > dirArea[$1] }.prefix(16)
        for key in cand {
            let dir = simd_normalize(dirSum[key])
            if !dir.x.isFinite { continue }
            // Offset-histogram for tris justert med retningen (én side — motsatt normal er egen bucket)
            var hist = [Int: Float]()
            for t in 0..<triCount where triA[t] > 0 && simd_dot(triN[t], dir) > 0.9 {
                let d = simd_dot(dir, triC[t])
                triD[t] = d
                hist[Int((d / 0.025).rounded()), default: 0] += triA[t]
            }
            var suppressed = Set<Int>()
            for _ in 0..<3 { // maks 3 parallelle plan per retning (vegg + skapfront osv.)
                var bestBin = 0; var bestA: Float = -1
                for (bin, _) in hist where !suppressed.contains(bin) {
                    let a3 = (hist[bin - 1] ?? 0) + (hist[bin] ?? 0) + (hist[bin + 1] ?? 0)
                    if a3 > bestA { bestA = a3; bestBin = bin }
                }
                if bestA < minArea { break }
                for b in (bestBin - 5)...(bestBin + 5) { suppressed.insert(b) } // ±12,5 cm: drift-lag får ikke eget plan
                // Rafinert d + RMS innen ±4 cm av toppen
                let d0 = Float(bestBin) * 0.025
                var dSum: Float = 0; var aSum: Float = 0
                for t in 0..<triCount where triA[t] > 0 && simd_dot(triN[t], dir) > 0.9 && abs(triD[t] - d0) < 0.04 {
                    dSum += triD[t] * triA[t]; aSum += triA[t]
                }
                guard aSum >= minArea else { continue }
                let dRef = dSum / aSum
                var varSum: Float = 0
                for t in 0..<triCount where triA[t] > 0 && simd_dot(triN[t], dir) > 0.9 && abs(triD[t] - d0) < 0.04 {
                    let e = triD[t] - dRef; varSum += e * e * triA[t]
                }
                // RMS-vakt: vegger/tak er stramme; dyner/senger spraker ut → ikke plan
                if (varSum / aSum).squareRoot() <= 0.025 { planes.append(Plane(n: dir, d: dRef, area: aSum)) }
            }
            if planes.count >= 16 { break }
        }
        // Flett nesten-identiske plan: samme vegg kan splittes over to retningsbøtter og gi to
        // plan ~2 cm fra hverandre — å snappe til «nærmeste» ville da GJENSKAPT en sprekk.
        planes.sort { $0.area > $1.area }
        var merged = [Plane]()
        for pl in planes {
            if let j = merged.firstIndex(where: { simd_dot($0.n, pl.n) > 0.99 && abs($0.d - pl.d) < 0.035 }) {
                let w0 = merged[j].area, w1 = pl.area
                merged[j].n = simd_normalize(merged[j].n * w0 + pl.n * w1)
                merged[j].d = (merged[j].d * w0 + pl.d * w1) / (w0 + w1)
                merged[j].area = w0 + w1
            } else {
                merged.append(pl)
            }
        }
        let planesFinal = merged
        guard !planesFinal.isEmpty else { return [] }

        // Snap vertekser: normal ≤ ~25° fra planet og ≤ 12 cm unna → projiser inn på planet.
        var snapped = 0
        for i in 0..<vc {
            let nl = simd_length(vNormal[i])
            if nl < 1e-9 { continue }
            let n = vNormal[i] / nl
            let pos = pt(i)
            var bestOff = Float.greatestFiniteMagnitude
            var bestPlane: Plane?
            for pl in planesFinal where simd_dot(n, pl.n) > 0.90 {
                let off = simd_dot(pl.n, pos) - pl.d
                if abs(off) <= 0.13 && abs(off) < abs(bestOff) { bestOff = off; bestPlane = pl }
            }
            if let pl = bestPlane {
                // Feather i stedet for hard cutoff: full snap ≤ 9 cm, glidende mot 0 ved 13 cm —
                // hard grense ga «rifter» der en snappet verteks hadde usnappet nabo.
                let f = min(1, max(0, (0.13 - abs(bestOff)) / 0.04))
                let np = pos - pl.n * (bestOff * f)
                positions[i * 3] = np.x; positions[i * 3 + 1] = np.y; positions[i * 3 + 2] = np.z
                if f > 0 { snapped += 1 }
            }
        }
        MeshLog.log("plane snap — plan=\(planesFinal.count) snappet=\(snapped)/\(vc) verts")

        // Hjørne-korreksjon: to plan snappes i dag HVER FOR SEG mot sin egen flate — ved en
        // drift-feilvinkel møtes de da ikke nødvendigvis rent i hjørnet (synlig knekk/sprekk).
        // For nesten-vinkelrette planpar (ekte hjørner — vegg-vegg, vegg-tak), la vertekser nær
        // BEGGE flatene konvergere på selve skjæringslinja i stedet, så begge sider tvinges til
        // å møtes i nøyaktig samme linje. Kjøres EKSPLISITT etter hovedsnappen over, på de
        // allerede snappede posisjonene — påvirker kun vertekser genuint nær et hjørne.
        var cornerSnapped = 0
        if planesFinal.count >= 2 {
            for a in 0..<planesFinal.count {
                for b in (a + 1)..<planesFinal.count {
                    let pa = planesFinal[a], pb = planesFinal[b]
                    guard abs(simd_dot(pa.n, pb.n)) < 0.3 else { continue } // ~70-110° — ekte hjørne, ikke duplikat-plan
                    let dir = simd_cross(pa.n, pb.n)
                    let dirLenSq = simd_length_squared(dir)
                    guard dirLenSq > 1e-6 else { continue }
                    let p0 = (pa.d * simd_cross(pb.n, dir) + pb.d * simd_cross(dir, pa.n)) / dirLenSq
                    let dirN = dir / dirLenSq.squareRoot()
                    for i in 0..<vc {
                        let pos = pt(i)
                        let offA = simd_dot(pa.n, pos) - pa.d
                        let offB = simd_dot(pb.n, pos) - pb.d
                        guard abs(offA) <= 0.20, abs(offB) <= 0.20 else { continue } // billig grovfilter før linjeavstand
                        let t = simd_dot(pos - p0, dirN)
                        let onLine = p0 + dirN * t
                        // Feather: full trekk ≤ 6 cm fra linja, avtar til 0 ved 10 cm — unngår å
                        // rykke vertekser langt fra selve hjørnet inn på linja.
                        let distToLine = simd_distance(pos, onLine)
                        let f = min(1, max(0, (0.10 - distToLine) / 0.04))
                        guard f > 0 else { continue }
                        let newPos = pos + (onLine - pos) * f
                        positions[i * 3] = newPos.x; positions[i * 3 + 1] = newPos.y; positions[i * 3 + 2] = newPos.z
                        cornerSnapped += 1
                    }
                }
            }
        }
        if cornerSnapped > 0 { MeshLog.log("hjørne-korreksjon — \(cornerSnapped) verteks-treff") }

        return planesFinal.map { SIMD4($0.n.x, $0.n.y, $0.n.z, $0.d) }
    }

    /// Flate-dedup på tvers av anchors: 6 cm-voxel + normal-retningsbøtte (±X/±Y/±Z) → anchoren
    /// med flest triangler i cellen eier den. Et triangel droppes KUN når alle tre vertekscellene
    /// dets er eid av en annen anchor — dvs. det ligger helt inne i et ekte dobbeltflak. Grense-
    /// triangler (minst én verteks i egen eller herreløs celle) beholdes alltid: anchor-TILER
    /// deler søm uten å overlappe, og vinner-tar-alt per centroid-celle karvet stiplede hull
    /// langs alle anchor-grenser (kvalitetsregresjonen 2026-07-05).
    static func dropOverlapSheets(positions: [Float], indices: inout [UInt32], triAnchor: inout [UInt32]) {
        let triCount = indices.count / 3
        guard triAnchor.count == triCount, triCount > 0 else { return }
        let inv: Float = 1.0 / 0.06
        // Face-normal → dominant akse+fortegn (0..5) så to ulike flater (vegg møter tak) i
        // samme celle ikke krangler om eierskap
        func bucket(_ t: Int) -> Int64 {
            let a = Int(indices[t * 3]) * 3, b = Int(indices[t * 3 + 1]) * 3, c = Int(indices[t * 3 + 2]) * 3
            let e1 = SIMD3<Float>(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2])
            let e2 = SIMD3<Float>(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2])
            let n = simd_cross(e1, e2)
            let ax = abs(n.x), ay = abs(n.y), az = abs(n.z)
            return ax >= ay && ax >= az ? (n.x >= 0 ? 0 : 1) : (ay >= az ? (n.y >= 0 ? 2 : 3) : (n.z >= 0 ? 4 : 5))
        }
        func cellKey(_ x: Float, _ y: Float, _ z: Float, _ bucket: Int64) -> Int64 {
            let qx = Int64((x * inv).rounded()), qy = Int64((y * inv).rounded()), qz = Int64((z * inv).rounded())
            return ((qx & 0xFFFFF) | ((qy & 0xFFFFF) << 20) | ((qz & 0xFFFFF) << 40)) | (bucket << 60)
        }
        func centroidKey(_ t: Int, _ b: Int64) -> Int64 {
            let i0 = Int(indices[t * 3]) * 3, i1 = Int(indices[t * 3 + 1]) * 3, i2 = Int(indices[t * 3 + 2]) * 3
            return cellKey((positions[i0] + positions[i1] + positions[i2]) / 3,
                           (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3,
                           (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3, b)
        }
        // Pass 1: tell triangler per (centroid-celle → anchor); eieren er anchoren med flest
        var counts = [Int64: [UInt32: Int32]](minimumCapacity: triCount / 4)
        for t in 0..<triCount { counts[centroidKey(t, bucket(t)), default: [:]][triAnchor[t], default: 0] += 1 }
        var owner = [Int64: UInt32](minimumCapacity: counts.count)
        for (cell, byAnchor) in counts { owner[cell] = byAnchor.max { $0.value < $1.value }!.key }
        // Pass 2: dropp kun triangler der ALLE tre vertekscellene har fremmed eier
        var drop = [Bool](repeating: false, count: triCount)
        for t in 0..<triCount {
            let mine = triAnchor[t]
            let b = bucket(t)
            var interiorForeign = true
            for k in 0..<3 {
                let vi = Int(indices[t * 3 + k]) * 3
                let o = owner[cellKey(positions[vi], positions[vi + 1], positions[vi + 2], b)]
                if o == nil || o == mine { interiorForeign = false; break }
            }
            // interiorForeign = alle tre hjørner i fremmed-eide celler → DETTE er laget som felles
            if interiorForeign { drop[t] = true }
        }
        // Sult-vakt (samme felle som i dropCoplanarLayers): ved anchor-grenser kan sjakkmønstret
        // eierskap felle BEGGE sider av grensen → hull. Angre droppet der en celle mister alle
        // sine triangler så minst ~20 % overlever.
        var totalCnt = [Int64: Int32](minimumCapacity: counts.count)
        for (cell, byAnchor) in counts { totalCnt[cell] = byAnchor.values.reduce(0, +) }
        var droppedCnt = [Int64: Int32]()
        for t in 0..<triCount where drop[t] { droppedCnt[centroidKey(t, bucket(t)), default: 0] += 1 }
        for t in 0..<triCount where drop[t] {
            let b = bucket(t)
            var starves = false
            for k in 0..<3 {
                let vi = Int(indices[t * 3 + k]) * 3
                let cell = cellKey(positions[vi], positions[vi + 1], positions[vi + 2], b)
                guard let tot = totalCnt[cell], tot > 0 else { continue }
                let survive = tot - (droppedCnt[cell] ?? 0)
                if survive * 5 < tot { starves = true; break }
            }
            if starves {
                drop[t] = false
                droppedCnt[centroidKey(t, b), default: 0] -= 1
            }
        }
        var outIdx = [UInt32](); outIdx.reserveCapacity(indices.count)
        var outAnchor = [UInt32](); outAnchor.reserveCapacity(triCount)
        for t in 0..<triCount where !drop[t] {
            outIdx.append(indices[t * 3]); outIdx.append(indices[t * 3 + 1]); outIdx.append(indices[t * 3 + 2])
            outAnchor.append(triAnchor[t])
        }
        MeshLog.log("overlap dedup — tris \(triCount) → \(outAnchor.count) (fjernet \(triCount - outAnchor.count) dobbeltflak)")
        indices = outIdx
        triAnchor = outAnchor
    }

    /// Fyller planære hull (vindusglass, TV-skjermer, mørkt stoff — ingen LiDAR-retur) med en
    /// vifte fra løkke-sentroiden. Kjøres FØR unwrap så lappene får UV-charts og bakes projektivt
    /// fra keyframene: vinduet/skjermen males med sitt faktiske fotoinnhold. Konservative vakter
    /// så vi aldri dikter geometri: lukket grenseløkke uten kryss, 3–500 kanter, < 1,5 m radius,
    /// planær (RMS < 3 cm mot Newell-planet). Ytre skanngrense er enorm og skjev → aldri fylt.
    static func fillPlanarHoles(positions: inout [Float], colors: inout [Float], indices: inout [UInt32], triAnchor: inout [UInt32]) {
        let triCount = indices.count / 3
        guard triCount > 0 else { return }
        let trackAnchors = triAnchor.count == triCount
        let hasColors = !colors.isEmpty

        // Sveis vertekser (3mm-hash, som weldedTaubinSmooth) — anchor-kloner må telle som én,
        // ellers er hver anchor-søm en falsk «grense».
        let vc = positions.count / 3
        var weldOf = [Int32](repeating: -1, count: vc)
        var weldKeyToId = [Int64: Int32](minimumCapacity: vc)
        for i in 0..<vc {
            let qx = Int64((positions[i * 3] * 333.33).rounded())
            let qy = Int64((positions[i * 3 + 1] * 333.33).rounded())
            let qz = Int64((positions[i * 3 + 2] * 333.33).rounded())
            let key = (qx & 0x1F_FFFF) | ((qy & 0x1F_FFFF) << 21) | ((qz & 0x1F_FFFF) << 42)
            if let id = weldKeyToId[key] { weldOf[i] = id } else {
                let id = Int32(weldKeyToId.count)
                weldKeyToId[key] = id
                weldOf[i] = id
            }
        }
        // Tell udirigerte kanter i weld-rommet; grensekant = brukt av nøyaktig ett triangel.
        func ekey(_ a: Int32, _ b: Int32) -> Int64 { (Int64(min(a, b)) << 32) | Int64(UInt32(max(a, b))) }
        var edgeCount = [Int64: Int32](minimumCapacity: triCount * 3 / 2)
        for t in 0..<triCount {
            let w0 = weldOf[Int(indices[t * 3])], w1 = weldOf[Int(indices[t * 3 + 1])], w2 = weldOf[Int(indices[t * 3 + 2])]
            if w0 == w1 || w1 == w2 || w2 == w0 { continue }
            edgeCount[ekey(w0, w1), default: 0] += 1
            edgeCount[ekey(w1, w2), default: 0] += 1
            edgeCount[ekey(w2, w0), default: 0] += 1
        }
        // Rettede grensekanter (a→b slik de står i triangelet) → utgående per weld-id.
        // Weld-id med >1 utgående = non-manifold kryss → løkker gjennom det droppes.
        struct BEdge { let toW: Int32; let fromV: UInt32; let toV: UInt32; let anchor: UInt32 }
        var outgoing = [Int32: BEdge](minimumCapacity: 4096)
        var junction = Set<Int32>()
        for t in 0..<triCount {
            let a = triAnchor.indices.contains(t) && trackAnchors ? triAnchor[t] : 0
            for k in 0..<3 {
                let v0 = indices[t * 3 + k], v1 = indices[t * 3 + (k + 1) % 3]
                let w0 = weldOf[Int(v0)], w1 = weldOf[Int(v1)]
                if w0 == w1 || edgeCount[ekey(w0, w1)] != 1 { continue }
                if outgoing[w0] != nil { junction.insert(w0) } else {
                    outgoing[w0] = BEdge(toW: w1, fromV: v0, toV: v1, anchor: a)
                }
            }
        }
        func pos(_ v: UInt32) -> SIMD3<Float> {
            let i = Int(v) * 3
            return SIMD3(positions[i], positions[i + 1], positions[i + 2])
        }
        var visited = Set<Int32>()
        var loopsFilled = 0, trisAdded = 0
        // 500/1.5m (var 240/0.9m): fillete takhull etter sparsom dekning har lange, taggete
        // grenseløkker — de er fortsatt PLANÆRE (RMS-vakten består), bare store. Ytre skanngrense
        // stoppes fortsatt av radius + planaritet.
        let maxLoopEdges = 500, maxTotalTris = 24_000
        for start in outgoing.keys {
            if visited.contains(start) || trisAdded >= maxTotalTris { continue }
            // Følg rettede kanter til vi er tilbake ved start (lukket løkke) eller feiler.
            var loop = [BEdge]()
            var w = start
            var ok = false
            while loop.count <= maxLoopEdges {
                if junction.contains(w) { break }
                guard let e = outgoing[w] else { break }
                loop.append(e)
                w = e.toW
                if w == start { ok = true; break }
                if visited.contains(w) { break } // treffer annen (behandlet) løkke → skjev topologi
            }
            for e in loop { visited.insert(weldOf[Int(e.fromV)]) }
            visited.insert(start)
            guard ok, loop.count >= 3, loop.count <= maxLoopEdges else { continue }
            // Vakter: utstrekning + planaritet (Newell-normal over polygonet).
            var c = SIMD3<Float>(0, 0, 0)
            for e in loop { c += pos(e.fromV) }
            c /= Float(loop.count)
            var maxR: Float = 0
            var n = SIMD3<Float>(0, 0, 0)
            for i in 0..<loop.count {
                let p = pos(loop[i].fromV), q = pos(loop[(i + 1) % loop.count].fromV)
                maxR = max(maxR, simd_length(p - c))
                n += SIMD3((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y))
            }
            let nLen = simd_length(n)
            // 2.2m (var 1.5): kors-formede dedup-hull på vegg (vertikal+horisontal slisse som
            // henger sammen) har maxR ~1.5–1.6m fra sentroiden og gled akkurat under gamle
            // taket (device 2026-08-26). Planaritets-vakten (RMS 3cm) bærer fortsatt sikkerheten
            // mot å fylle den ytre skanngrensen.
            guard maxR <= 2.2, nLen > 1e-6 else { continue }
            n /= nLen
            var sq: Float = 0
            for e in loop { let d = simd_dot(pos(e.fromV) - c, n); sq += d * d }
            guard (sq / Float(loop.count)).squareRoot() <= 0.03 else { continue }
            // Fyll: sentroid-verteks + vifte. Rettet kant a→b står som a→b i nabotriangelet,
            // så lappen bruker b→a (b, a, C) — samme vinding som omgivelsene (bake-facing OK).
            let cIdx = UInt32(positions.count / 3)
            positions.append(c.x); positions.append(c.y); positions.append(c.z)
            if hasColors { colors.append(0.62); colors.append(0.62); colors.append(0.64); colors.append(1) }
            // Én anchor for hele viften (flertall i løkka) → xatlas ser lappen som ETT chart,
            // ikke N én-triangels-fliser spredt over chunk-meshene.
            var tally = [UInt32: Int]()
            for e in loop { tally[e.anchor, default: 0] += 1 }
            let fanAnchor = tally.max { $0.value < $1.value }?.key ?? 0
            for e in loop {
                indices.append(e.toV); indices.append(e.fromV); indices.append(cIdx)
                if trackAnchors { triAnchor.append(fanAnchor) }
                trisAdded += 1
            }
            loopsFilled += 1
        }
        if loopsFilled > 0 || trisAdded > 0 {
            MeshLog.log("hole fill — løkker=\(loopsFilled) tris+=\(trisAdded)")
        }
    }

    /// Dropper triangler med (nær) null areal og eksakte duplikatflater (posisjonsnøkkel per
    /// hjørne, uordnet trippel). Trygt: duplikatens første kopi beholdes, kollapsede triangler
    /// rendres ikke uansett.
    static func dropDegenerateAndDuplicateFaces(positions: [Float], indices: [UInt32], triAnchor: inout [UInt32]) -> [UInt32] {
        var out = [UInt32](); out.reserveCapacity(indices.count)
        let trackAnchors = triAnchor.count == indices.count / 3
        var keptAnchor = [UInt32](); if trackAnchors { keptAnchor.reserveCapacity(triAnchor.count) }
        var seen = Set<[Int64]>(minimumCapacity: indices.count / 3)
        func key(_ v: UInt32) -> Int64 {
            let i = Int(v) * 3
            let qx = Int64((positions[i] * 1000).rounded())
            let qy = Int64((positions[i + 1] * 1000).rounded())
            let qz = Int64((positions[i + 2] * 1000).rounded())
            return (qx & 0x1F_FFFF) | ((qy & 0x1F_FFFF) << 21) | ((qz & 0x1F_FFFF) << 42)
        }
        var droppedZero = 0, droppedDup = 0
        var t = 0
        while t + 2 < indices.count {
            let a = indices[t], b = indices[t + 1], c = indices[t + 2]
            let ka = key(a), kb = key(b), kc = key(c)
            if ka == kb || kb == kc || kc == ka { droppedZero += 1; t += 3; continue }
            let ia = Int(a) * 3, ib = Int(b) * 3, ic = Int(c) * 3
            let ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2]
            let e1 = SIMD3<Float>(positions[ib] - ax, positions[ib + 1] - ay, positions[ib + 2] - az)
            let e2 = SIMD3<Float>(positions[ic] - ax, positions[ic + 1] - ay, positions[ic + 2] - az)
            if simd_length_squared(simd_cross(e1, e2)) < 1e-12 { droppedZero += 1; t += 3; continue }
            if !seen.insert([ka, kb, kc].sorted()).inserted { droppedDup += 1; t += 3; continue }
            out.append(a); out.append(b); out.append(c)
            if trackAnchors { keptAnchor.append(triAnchor[t / 3]) }
            t += 3
        }
        MeshLog.log("face cleanup — zeroArea=\(droppedZero) duplikater=\(droppedDup) beholdt=\(out.count / 3)")
        if trackAnchors { triAnchor = keptAnchor }
        return out
    }

    /// Taubin-glatting via sveiset konnektivitet: sammenfallende vertekser (kvantisert
    /// posisjonshash, celle = `tolerance`) glattes som ÉN verteks og alle klonene får samme
    /// resultat — anchor-grensene forblir limt. Selve mesh-arrayene (indices, verteksantall)
    /// endres ikke, så nedstrøms (xatlas, subdivide-farger) ser samme topologi som før.
    static func weldedTaubinSmooth(positions: inout [Float], indices: [UInt32], tolerance: Float = 0.003, passes: Int = 3) {
        let vc = positions.count / 3
        guard vc > 0, !indices.isEmpty else { return }
        let inv = 1.0 / tolerance
        var map = [Int64: UInt32](minimumCapacity: vc)
        var remap = [UInt32](repeating: 0, count: vc)
        var weldedPos = [Float](); weldedPos.reserveCapacity(positions.count)
        for i in 0..<vc {
            let x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
            let qx = Int64((x * inv).rounded()), qy = Int64((y * inv).rounded()), qz = Int64((z * inv).rounded())
            let key = (qx & 0x1F_FFFF) | ((qy & 0x1F_FFFF) << 21) | ((qz & 0x1F_FFFF) << 42)
            if let j = map[key] {
                remap[i] = j
            } else {
                let j = UInt32(weldedPos.count / 3)
                map[key] = j
                remap[i] = j
                weldedPos.append(x); weldedPos.append(y); weldedPos.append(z)
            }
        }
        var weldedIdx = [UInt32](); weldedIdx.reserveCapacity(indices.count)
        var t = 0
        while t + 2 < indices.count {
            let a = remap[Int(indices[t])], b = remap[Int(indices[t + 1])], c = remap[Int(indices[t + 2])]
            if a != b, b != c, c != a { weldedIdx.append(a); weldedIdx.append(b); weldedIdx.append(c) }
            t += 3
        }
        MeshLog.log("weldedSmooth — verts \(vc) → \(weldedPos.count / 3) for glatting")
        taubinSmooth(positions: &weldedPos, indices: weldedIdx, passes: passes)
        for i in 0..<vc {
            let j = Int(remap[i])
            positions[i * 3] = weldedPos[j * 3]
            positions[i * 3 + 1] = weldedPos[j * 3 + 1]
            positions[i * 3 + 2] = weldedPos[j * 3 + 2]
        }
    }

    /// Triangle-weighted Laplacian smooth — each vertex moves λ toward the average of its neighbours.
    /// Uses triangle accumulation (no adjacency list) so it runs in O(triangles) per iteration.
    static func laplacianSmooth(positions: inout [Float], indices: [UInt32], iterations: Int = 2, lambda: Float = 0.5) {
        let vertCount = positions.count / 3
        let triCount = indices.count / 3
        var sum = [Float](repeating: 0, count: positions.count)
        var cnt = [Float](repeating: 0, count: vertCount)
        for _ in 0..<iterations {
            for i in 0..<sum.count { sum[i] = 0 }
            for i in 0..<cnt.count { cnt[i] = 0 }
            for t in 0..<triCount {
                let a = Int(indices[t*3]), b = Int(indices[t*3+1]), c = Int(indices[t*3+2])
                sum[a*3]   += positions[b*3]   + positions[c*3]
                sum[a*3+1] += positions[b*3+1] + positions[c*3+1]
                sum[a*3+2] += positions[b*3+2] + positions[c*3+2]; cnt[a] += 2
                sum[b*3]   += positions[a*3]   + positions[c*3]
                sum[b*3+1] += positions[a*3+1] + positions[c*3+1]
                sum[b*3+2] += positions[a*3+2] + positions[c*3+2]; cnt[b] += 2
                sum[c*3]   += positions[a*3]   + positions[b*3]
                sum[c*3+1] += positions[a*3+1] + positions[b*3+1]
                sum[c*3+2] += positions[a*3+2] + positions[b*3+2]; cnt[c] += 2
            }
            for i in 0..<vertCount {
                guard cnt[i] > 0 else { continue }
                positions[i*3]   += lambda * (sum[i*3]   / cnt[i] - positions[i*3])
                positions[i*3+1] += lambda * (sum[i*3+1] / cnt[i] - positions[i*3+1])
                positions[i*3+2] += lambda * (sum[i*3+2] / cnt[i] - positions[i*3+2])
            }
        }
    }

    /// One level of midpoint (1→4) subdivision with shared edge vertices (no cracks). Splits each
    /// coarse triangle into 4 by inserting a vertex at each edge midpoint, interpolating position +
    /// colour. Cache keyed by the (sorted) endpoint pair so adjacent triangles share midpoints.
    static func subdivideMesh(positions: inout [Float], colors: inout [Float], indices: [UInt32]) -> [UInt32] {
        let vertCount = positions.count / 3
        let colorStride = vertCount > 0 ? colors.count / vertCount : 0   // 0 or 4
        var midCache = [UInt64: UInt32](minimumCapacity: indices.count)
        func midpoint(_ a: UInt32, _ b: UInt32) -> UInt32 {
            let key = a < b ? (UInt64(a) << 32 | UInt64(b)) : (UInt64(b) << 32 | UInt64(a))
            if let m = midCache[key] { return m }
            let ia = Int(a), ib = Int(b)
            positions.append((positions[ia*3]   + positions[ib*3])   * 0.5)
            positions.append((positions[ia*3+1] + positions[ib*3+1]) * 0.5)
            positions.append((positions[ia*3+2] + positions[ib*3+2]) * 0.5)
            if colorStride > 0 {
                for k in 0..<colorStride {
                    colors.append((colors[ia*colorStride+k] + colors[ib*colorStride+k]) * 0.5)
                }
            }
            let m = UInt32(positions.count / 3 - 1)
            midCache[key] = m
            return m
        }
        var out = [UInt32]()
        out.reserveCapacity(indices.count * 4)
        for t in 0..<(indices.count / 3) {
            let a = indices[t*3], b = indices[t*3+1], c = indices[t*3+2]
            let ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a)
            out.append(contentsOf: [a, ab, ca,  ab, b, bc,  ca, bc, c,  ab, bc, ca])
        }
        return out
    }

    /// Taubin smoothing: alternating λ (smooth) / −μ (re-inflate) passes round the mesh without the
    /// corner-shrinkage that repeated plain Laplacian causes. Reuses laplacianSmooth as the primitive.
    static func taubinSmooth(positions: inout [Float], indices: [UInt32], passes: Int = 3, lambda: Float = 0.5, mu: Float = 0.53) {
        for _ in 0..<passes {
            laplacianSmooth(positions: &positions, indices: indices, iterations: 1, lambda: lambda)
            laplacianSmooth(positions: &positions, indices: indices, iterations: 1, lambda: -mu)
        }
    }

    /// Recompute per-vertex normals by area-weighting triangle face normals.
    static func recomputeNormals(positions: [Float], indices: [UInt32]) -> [Float] {
        var normals = [Float](repeating: 0, count: positions.count)
        let triCount = indices.count / 3
        for t in 0..<triCount {
            let ai = Int(indices[t*3])*3, bi = Int(indices[t*3+1])*3, ci = Int(indices[t*3+2])*3
            let a = SIMD3<Float>(positions[ai], positions[ai+1], positions[ai+2])
            let b = SIMD3<Float>(positions[bi], positions[bi+1], positions[bi+2])
            let c = SIMD3<Float>(positions[ci], positions[ci+1], positions[ci+2])
            let n = simd_cross(b - a, c - a)
            normals[ai] += n.x; normals[ai+1] += n.y; normals[ai+2] += n.z
            normals[bi] += n.x; normals[bi+1] += n.y; normals[bi+2] += n.z
            normals[ci] += n.x; normals[ci+1] += n.y; normals[ci+2] += n.z
        }
        for i in stride(from: 0, to: normals.count, by: 3) {
            let n = simd_normalize(SIMD3<Float>(normals[i], normals[i+1], normals[i+2]))
            normals[i] = n.x; normals[i+1] = n.y; normals[i+2] = n.z
        }
        return normals
    }

    /// Union-find over shared vertices; keep only triangles in components with >= minTris triangles.
    static func filterSmallComponents(vertexCount: Int, indices: [UInt32], minTris: Int, triAnchor: inout [UInt32]) -> [UInt32] {
        if indices.count < 3 { return indices }
        let trackAnchors = triAnchor.count == indices.count / 3
        var parent = Array(0..<vertexCount)
        func find(_ x: Int) -> Int {
            var r = x
            while parent[r] != r { parent[r] = parent[parent[r]]; r = parent[r] }
            return r
        }
        func union(_ a: Int, _ b: Int) {
            let ra = find(a), rb = find(b)
            if ra != rb { parent[ra] = rb }
        }
        let triCount = indices.count / 3
        for t in 0..<triCount {
            let a = Int(indices[t*3]), b = Int(indices[t*3+1]), c = Int(indices[t*3+2])
            union(a, b); union(b, c)
        }
        var trisByRoot = [Int: Int]()
        for t in 0..<triCount {
            trisByRoot[find(Int(indices[t*3])), default: 0] += 1
        }
        var kept = [UInt32](); kept.reserveCapacity(indices.count)
        var keptAnchor = [UInt32](); if trackAnchors { keptAnchor.reserveCapacity(triAnchor.count) }
        for t in 0..<triCount {
            if (trisByRoot[find(Int(indices[t*3])) ] ?? 0) >= minTris {
                kept.append(indices[t*3]); kept.append(indices[t*3+1]); kept.append(indices[t*3+2])
                if trackAnchors { keptAnchor.append(triAnchor[t]) }
            }
        }
        MeshLog.log("mesh cleanup — components=\(trisByRoot.count) trisIn=\(triCount) trisKept=\(kept.count/3)")
        if kept.isEmpty { return indices }
        if trackAnchors { triAnchor = keptAnchor }
        return kept
    }

    // MARK: - Box-projection UV unwrap (step 2)
    // Buckets each triangle by dominant face-normal axis (±X/±Y/±Z), projects onto that plane, and
    // packs the 6 charts into a 3×2 atlas layout. Vertices are split per-face (no shared UVs across
    // charts). Seamful but dependency-free; xatlas can replace this later for fewer seams.
    struct UVUnwrapResult {
        var positions: [Float]
        var normals: [Float]
        var uvs: [Float]
        var indices: [UInt32]
        var chartCount: Int
        var atlasSize: Int
    }

    @available(iOS 13.4, *)
    static func boxUnwrapUVs(positions: [Float], normals: [Float], indices: [UInt32], padding: Float = 0.02) -> UVUnwrapResult {
        let triCount = indices.count / 3
        func pos(_ vi: UInt32) -> SIMD3<Float> {
            let i = Int(vi) * 3
            return SIMD3(positions[i], positions[i + 1], positions[i + 2])
        }
        func project(_ p: SIMD3<Float>, _ bucket: Int) -> SIMD2<Float> {
            switch bucket {
            case 0: return SIMD2(-p.z, p.y)   // +X
            case 1: return SIMD2(p.z, p.y)    // -X
            case 2: return SIMD2(p.x, -p.z)   // +Y
            case 3: return SIMD2(p.x, p.z)    // -Y
            case 4: return SIMD2(p.x, p.y)    // +Z
            default: return SIMD2(-p.x, p.y)  // -Z
            }
        }

        var faceBucket = [Int](repeating: 0, count: triCount)
        var bbMin = [SIMD2<Float>](repeating: SIMD2(.greatestFiniteMagnitude, .greatestFiniteMagnitude), count: 6)
        var bbMax = [SIMD2<Float>](repeating: SIMD2(-.greatestFiniteMagnitude, -.greatestFiniteMagnitude), count: 6)

        for t in 0..<triCount {
            let p0 = pos(indices[t * 3]), p1 = pos(indices[t * 3 + 1]), p2 = pos(indices[t * 3 + 2])
            let n = simd_cross(p1 - p0, p2 - p0)
            let ax = abs(n.x), ay = abs(n.y), az = abs(n.z)
            let bucket: Int
            if ax >= ay && ax >= az { bucket = n.x >= 0 ? 0 : 1 }
            else if ay >= az { bucket = n.y >= 0 ? 2 : 3 }
            else { bucket = n.z >= 0 ? 4 : 5 }
            faceBucket[t] = bucket
            for k in 0..<3 {
                let uv = project(pos(indices[t * 3 + k]), bucket)
                bbMin[bucket] = simd_min(bbMin[bucket], uv)
                bbMax[bucket] = simd_max(bbMax[bucket], uv)
            }
        }

        let cols = 3, rows = 2
        let cellW = 1.0 / Float(cols), cellH = 1.0 / Float(rows)
        var outPos: [Float] = []; outPos.reserveCapacity(triCount * 9)
        var outNorm: [Float] = []; outNorm.reserveCapacity(triCount * 9)
        var outUV: [Float] = []; outUV.reserveCapacity(triCount * 6)
        var outIdx: [UInt32] = []; outIdx.reserveCapacity(triCount * 3)
        var used = Set<Int>()
        var next: UInt32 = 0

        for t in 0..<triCount {
            let bucket = faceBucket[t]
            used.insert(bucket)
            let col = bucket % cols, row = bucket / cols
            let mn = bbMin[bucket]
            let span = simd_max(bbMax[bucket] - mn, SIMD2<Float>(1e-4, 1e-4))
            for k in 0..<3 {
                let vi = indices[t * 3 + k]
                let p = pos(vi)
                let ni = Int(vi) * 3
                var local = (project(p, bucket) - mn) / span
                local = local * (1 - 2 * padding) + SIMD2(padding, padding)
                outPos.append(p.x); outPos.append(p.y); outPos.append(p.z)
                outNorm.append(normals[ni]); outNorm.append(normals[ni + 1]); outNorm.append(normals[ni + 2])
                outUV.append((Float(col) + local.x) * cellW)
                outUV.append((Float(row) + local.y) * cellH)
                outIdx.append(next); next += 1
            }
        }

        return UVUnwrapResult(positions: outPos, normals: outNorm, uvs: outUV, indices: outIdx, chartCount: used.count, atlasSize: 2048)
    }

    private static func writeGlb(positions: [Float], normals: [Float], colors: [Float], indices: [UInt32], to url: URL) throws {
        let hasColor = !colors.isEmpty && colors.count == (positions.count / 3) * 4

        var bin = Data()
        func appendAligned(_ data: Data) {
            bin.append(data)
            let pad = (4 - (bin.count % 4)) % 4
            if pad > 0 { bin.append(Data(repeating: 0, count: pad)) }
        }

        let posBytes = positions.withUnsafeBufferPointer { Data(buffer: $0) }
        let normBytes = normals.withUnsafeBufferPointer { Data(buffer: $0) }
        let colorBytes = hasColor ? colors.withUnsafeBufferPointer { Data(buffer: $0) } : Data()
        let idxBytes = indices.withUnsafeBufferPointer { Data(buffer: $0) }

        let posOffset = 0
        let normOffset = posBytes.count
        let colorOffset = normOffset + normBytes.count
        let idxOffset = colorOffset + colorBytes.count

        appendAligned(posBytes)
        appendAligned(normBytes)
        if hasColor { appendAligned(colorBytes) }
        appendAligned(idxBytes)

        var minP = [Float](repeating: .greatestFiniteMagnitude, count: 3)
        var maxP = [Float](repeating: -.greatestFiniteMagnitude, count: 3)
        for i in stride(from: 0, to: positions.count, by: 3) {
            for j in 0..<3 {
                minP[j] = min(minP[j], positions[i + j])
                maxP[j] = max(maxP[j], positions[i + j])
            }
        }

        let vertexCount = positions.count / 3
        let idxAccessorIndex = hasColor ? 3 : 2
        var attributes: [String: Int] = ["POSITION": 0, "NORMAL": 1]
        if hasColor { attributes["COLOR_0"] = 2 }

        var accessors: [[String: Any]] = [
            ["bufferView": 0, "componentType": 5126, "count": vertexCount, "type": "VEC3", "min": minP, "max": maxP],
            ["bufferView": 1, "componentType": 5126, "count": vertexCount, "type": "VEC3"],
        ]
        var bufferViews: [[String: Any]] = [
            ["buffer": 0, "byteOffset": posOffset, "byteLength": posBytes.count, "target": 34962],
            ["buffer": 0, "byteOffset": normOffset, "byteLength": normBytes.count, "target": 34962],
        ]
        if hasColor {
            accessors.append(["bufferView": 2, "componentType": 5126, "count": vertexCount, "type": "VEC4"])
            bufferViews.append(["buffer": 0, "byteOffset": colorOffset, "byteLength": colorBytes.count, "target": 34962])
        }
        accessors.append(["bufferView": idxAccessorIndex, "componentType": 5125, "count": indices.count, "type": "SCALAR"])
        bufferViews.append(["buffer": 0, "byteOffset": idxOffset, "byteLength": idxBytes.count, "target": 34963])

        let json: [String: Any] = [
            "asset": ["version": "2.0", "generator": "Ampex ARMesh GLB Exporter"],
            "scene": 0,
            "scenes": [["nodes": [0]]],
            "nodes": [["mesh": 0]],
            "meshes": [[
                "primitives": [[
                    "attributes": attributes,
                    "indices": idxAccessorIndex,
                    "mode": 4,
                ]],
            ]],
            "accessors": accessors,
            "bufferViews": bufferViews,
            "buffers": [["byteLength": bin.count]],
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: json)
        var jsonChunk = jsonData
        let jsonPad = (4 - (jsonChunk.count % 4)) % 4
        if jsonPad > 0 { jsonChunk.append(Data(repeating: 0x20, count: jsonPad)) }

        var file = Data()
        let totalLength = 12 + 8 + jsonChunk.count + 8 + bin.count
        file.append(contentsOf: [0x67, 0x6C, 0x54, 0x46]) // glTF
        file.append(contentsOf: [0x02, 0x00, 0x00, 0x00]) // version 2
        file.append(contentsOf: withUnsafeBytes(of: UInt32(totalLength).littleEndian) { Data($0) })
        file.append(contentsOf: withUnsafeBytes(of: UInt32(jsonChunk.count).littleEndian) { Data($0) })
        file.append(contentsOf: withUnsafeBytes(of: UInt32(0x4E4F534A).littleEndian) { Data($0) }) // "JSON"
        file.append(jsonChunk)
        file.append(contentsOf: withUnsafeBytes(of: UInt32(bin.count).littleEndian) { Data($0) })
        file.append(contentsOf: withUnsafeBytes(of: UInt32(0x004E4942).littleEndian) { Data($0) }) // "BIN\0"
        file.append(bin)

        do {
            try file.write(to: url, options: .atomic)
        } catch {
            throw ExportError.writeFailed
        }
    }

    // MARK: - Textured GLB writer (step 4)
    /// Writes a GLB with POSITION/NORMAL/TEXCOORD_0 + a PBR material whose baseColorTexture is the
    /// embedded PNG atlas. No Draco yet (would need the C++ encoder wired into the target).
    static func writeTexturedGlb(
        positions: [Float], normals: [Float], uvs: [Float], indices: [UInt32], pngAtlas: Data, to url: URL
    ) throws {
        var bin = Data()
        func appendAligned(_ data: Data) {
            bin.append(data)
            let pad = (4 - (bin.count % 4)) % 4
            if pad > 0 { bin.append(Data(repeating: 0, count: pad)) }
        }
        let posBytes = positions.withUnsafeBufferPointer { Data(buffer: $0) }
        let normBytes = normals.withUnsafeBufferPointer { Data(buffer: $0) }
        let uvBytes = uvs.withUnsafeBufferPointer { Data(buffer: $0) }
        let idxBytes = indices.withUnsafeBufferPointer { Data(buffer: $0) }

        let posOff = 0
        let normOff = posBytes.count
        let uvOff = normOff + normBytes.count
        let idxOff = uvOff + uvBytes.count
        let pngOff = idxOff + idxBytes.count
        appendAligned(posBytes); appendAligned(normBytes); appendAligned(uvBytes); appendAligned(idxBytes)
        appendAligned(pngAtlas)

        var minP = [Float](repeating: .greatestFiniteMagnitude, count: 3)
        var maxP = [Float](repeating: -.greatestFiniteMagnitude, count: 3)
        for i in stride(from: 0, to: positions.count, by: 3) {
            for j in 0..<3 { minP[j] = min(minP[j], positions[i + j]); maxP[j] = max(maxP[j], positions[i + j]) }
        }
        let vCount = positions.count / 3

        let json: [String: Any] = [
            "asset": ["version": "2.0", "generator": "Ampex ARMesh Textured GLB Exporter"],
            "scene": 0,
            "scenes": [["nodes": [0]]],
            "nodes": [["mesh": 0]],
            "meshes": [[
                "primitives": [[
                    "attributes": ["POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2],
                    "indices": 3,
                    "material": 0,
                    "mode": 4,
                ]],
            ]],
            "materials": [[
                "pbrMetallicRoughness": [
                    "baseColorTexture": ["index": 0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                ],
                "name": "scan_atlas",
            ]],
            "textures": [["source": 0, "sampler": 0]],
            "samplers": [["magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071]],
            "images": [["bufferView": 4, "mimeType": "image/jpeg"]],
            "accessors": [
                ["bufferView": 0, "componentType": 5126, "count": vCount, "type": "VEC3", "min": minP, "max": maxP],
                ["bufferView": 1, "componentType": 5126, "count": vCount, "type": "VEC3"],
                ["bufferView": 2, "componentType": 5126, "count": vCount, "type": "VEC2"],
                ["bufferView": 3, "componentType": 5125, "count": indices.count, "type": "SCALAR"],
            ],
            "bufferViews": [
                ["buffer": 0, "byteOffset": posOff, "byteLength": posBytes.count, "target": 34962],
                ["buffer": 0, "byteOffset": normOff, "byteLength": normBytes.count, "target": 34962],
                ["buffer": 0, "byteOffset": uvOff, "byteLength": uvBytes.count, "target": 34962],
                ["buffer": 0, "byteOffset": idxOff, "byteLength": idxBytes.count, "target": 34963],
                ["buffer": 0, "byteOffset": pngOff, "byteLength": pngAtlas.count],
            ],
            "buffers": [["byteLength": bin.count]],
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: json)
        var jsonChunk = jsonData
        let jsonPad = (4 - (jsonChunk.count % 4)) % 4
        if jsonPad > 0 { jsonChunk.append(Data(repeating: 0x20, count: jsonPad)) }

        var file = Data()
        let total = 12 + 8 + jsonChunk.count + 8 + bin.count
        file.append(contentsOf: [0x67, 0x6C, 0x54, 0x46])
        file.append(contentsOf: [0x02, 0x00, 0x00, 0x00])
        file.append(contentsOf: withUnsafeBytes(of: UInt32(total).littleEndian) { Data($0) })
        file.append(contentsOf: withUnsafeBytes(of: UInt32(jsonChunk.count).littleEndian) { Data($0) })
        file.append(contentsOf: withUnsafeBytes(of: UInt32(0x4E4F534A).littleEndian) { Data($0) }) // "JSON"
        file.append(jsonChunk)
        file.append(contentsOf: withUnsafeBytes(of: UInt32(bin.count).littleEndian) { Data($0) })
        file.append(contentsOf: withUnsafeBytes(of: UInt32(0x004E4942).littleEndian) { Data($0) }) // "BIN\0"
        file.append(bin)
        do { try file.write(to: url, options: .atomic) } catch { throw ExportError.writeFailed }
    }
}
