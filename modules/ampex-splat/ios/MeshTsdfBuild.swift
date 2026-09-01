import Foundation
import simd
import CoreGraphics
import ImageIO

/// GEOMETRI FRA RÅ LiDAR-DYBDE — alternativ til ARKits anchor-mesh.
///
/// Bakgrunn (2026-08-31): ARKits `sceneReconstruction` er bygget for OKKLUSJON i AR — å vite
/// at en virtuell ball ruller bak sofaen — ikke for rekonstruksjon. Apple glatter den bevisst,
/// og resultatet er at bordkanter blir amorfe klumper. Rendret uten tekstur ser nettet ut som
/// smeltet voks, og det er den egentlige grunnen til at skannene har sett dårlige ut: teksturen
/// var aldri problemet, den ble bare malt på feil form.
///
/// `dense-N.f32` + `dense.jsonl` (rå sceneDepth, 5 Hz, med poser) har ligget innspilt siden
/// sommeren uten at noe leste dem. Det er den dybden ARKit glattet bort. Målt på en stue:
/// 303k trekanter (ARKit) → 824k med ekte kanter, og fusjonen tar under to sekunder.
///
/// Fusion ble forkastet to ganger tidligere. Fellene som trolig drepte den er alle beskrevet
/// i kommentarene under: z-dybde mot radiell avstand (ga fisheye-krumme vegger), nærmeste-nabo
/// sampling (ga salt-og-pepper-flater), og manglende kantfiltrering (LiDAR «flyr» på kanter).
@available(iOS 14.0, *)
enum MeshTsdfBuild {

    struct Options {
        /// Voxelstørrelse i meter. 20 mm er valgt fordi volumet da blir ~150 MB for et vanlig
        /// rom mot 625 MB ved 15 mm — 15 mm gir litt finere detalj, men sprenger minnetaket
        /// på telefon. Trunkering og blur skaleres med denne.
        var voxel: Float = 0.020
        /// Trunkeringssone i voxler — den viktigste avveiningen i hele fusjonen.
        ///
        /// SMAL (2.5): skarpe konkave hjørner. Men to observasjoner av samme vegg som er
        /// uenige med mer enn sonens bredde smelter IKKE sammen — de danner hvert sitt lag,
        /// og resultatet er tynne dobbeltflater med taggete kanter noen millimeter foran
        /// veggen (device 2026-09-01, rom med 40 % kastede frames).
        /// BRED (4): robust mot uenighet, men runder av vegg-mot-tak.
        /// 3.2 er kompromisset: sonen dekker typisk pose-uenighet uten å viske ut hjørnet.
        /// Overstyres med meshscan.tsdftrunc.
        var truncVoxels: Float = 3.2
        /// Minste akkumulerte vekt før en voxel regnes som ekte flate. Lavt gir krøllete
        /// falske flater der bare én-to stråler har vært innom; høyt spiser hull. Hevet fra
        /// 3 til 4 sammen med trunkeringen: det svakeste laget i en dobbeltflate har typisk
        /// få observasjoner, så terskelen luker det bort der trunkeringen ikke rekker.
        var minWeight: Float = 4
        /// Blur-passeringer på SELVE VOLUMET før nettet trekkes ut. Taubin på det ferdige
        /// nettet er utilstrekkelig — støyen sitter i SDF-en, ikke i vertekstplasseringen.
        var volumeBlur: Int = 1
        /// Taubin-passeringer på nettet etterpå. Partall holder λ og μ i balanse.
        var smoothPasses: Int = 4
        /// Maks kamerahastighet (m/s) for at et dybdekart skal telle. Dybdekart tatt under
        /// rask bevegelse legger flaten centimeter feil og kolliderer med de rolige
        /// målingene av samme vegg. MÅLT: 0,35 kaster 28 % av framene og gjør resultatet
        /// BEDRE. Drift er ikke årsaken — re-ankring flytter posene 0,0 mm.
        var maxVelocity: Float = 0.35
        /// Oppskalering av keyframe-dybden med RGB som guide (joint bilateral upsampling).
        /// 1 = av. Keyframene er det eneste stedet med både 4K-bilde og eget dybdekart
        /// perfekt synkronisert. Gir kantpresisjon; dense-framene gir dekning.
        var jbuScale: Int = 3
        /// Tak for antall voxels. Over dette økes voxelstørrelsen automatisk — et stort rom
        /// skal ikke kunne ta ned appen.
        var maxVoxels: Int = 40_000_000
    }

    /// Beskrivelse av ett dybdekart UTEN pikslene. Dybden lastes først når den skal brukes,
    /// og slippes med én gang. Å holde alle kartene i minnet samtidig fungerer for ett rom
    /// (484 kart ≈ 71 MB), men en leilighet trenger tusenvis, og da er det forskjellen på
    /// 300 MB og 300 KB. Volumet er stort nok fra før.
    private struct DFrame {
        let w: Int, h: Int
        let fx: Float, fy: Float, cx: Float, cy: Float
        let c2w: simd_float4x4
        /// Rå dybde på disk (dense-frames), eller ferdig JBU-oppskalert i minnet (keyframes).
        let url: URL?
        let inline: [Float]?
        /// Tillit til denne framens pose, 0–1, ut fra kamerahastigheten da den ble tatt.
        /// Ganges inn i voxelvekten så urolige kart teller mindre uten å forsvinne.
        var trust: Float = 1
        /// Keyframe-guide for depth super-res; nil for dense-frames.
        let jbuGuide: URL?
        let jbuScale: Int

        func load() -> [Float]? {
            if let d = inline { return d }
            guard let u = url, let dd = try? Data(contentsOf: u), dd.count == w * h * 4 else { return nil }
            return dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        }
    }

    // MARK: - Voxel-lager på disk

    /// Voxelvolumet lagt i en FIL som mappes inn i adresserommet, ikke i arbeidsminnet.
    ///
    /// Poenget: iOS gir ikke swap for vanlig heap-minne — ber du om 600 MB og systemet er
    /// presset, blir appen drept. Sider som hører til en fil er derimot «rene»: kjernen kan
    /// kaste dem og lese dem inn igjen fra disk ved behov. Volumet begrenses dermed av
    /// LAGRINGSPLASS framfor RAM, og en stor leilighet blir mulig i stedet for umulig.
    ///
    /// For et vanlig rom (~150 MB) ligger fila i page cache hele veien, så det koster
    /// ingenting. TSDF-integrering har dessuten god lokalitet — en stråle treffer voxels som
    /// ligger nær hverandre — så selv når sider må hentes inn er treffraten høy.
    private final class VoxelStore {
        let sdf: UnsafeMutablePointer<Float>
        let wgt: UnsafeMutablePointer<Float>
        private let bytes: Int
        private let urls: [URL]
        private let fds: [Int32]

        init?(count: Int, dir: URL) {
            // LOKAL kopi: brukes den lagrede egenskapen inne i opprydnings-closurene under,
            // fanger de self før alle medlemmer er satt, og Swift avviser det.
            let nb = count * MemoryLayout<Float>.stride
            var ptrs: [UnsafeMutableRawPointer] = []
            var us: [URL] = [], fs: [Int32] = []
            for name in ["tsdf-sdf.bin", "tsdf-wgt.bin"] {
                let u = dir.appendingPathComponent(name)
                try? FileManager.default.removeItem(at: u)
                let fd = open(u.path, O_RDWR | O_CREAT | O_TRUNC, 0o644)
                guard fd >= 0, ftruncate(fd, off_t(nb)) == 0 else {
                    if fd >= 0 { close(fd) }
                    for p in ptrs { munmap(p, nb) }
                    for f in fs { close(f) }
                    return nil
                }
                guard let p = mmap(nil, nb, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0),
                      p != MAP_FAILED else {
                    close(fd)
                    for q in ptrs { munmap(q, nb) }
                    for f in fs { close(f) }
                    return nil
                }
                // Volumet leses i stråler gjennom naboceller, ikke sekvensielt.
                madvise(p, nb, MADV_RANDOM)
                ptrs.append(p); us.append(u); fs.append(fd)
            }
            bytes = nb
            sdf = ptrs[0].bindMemory(to: Float.self, capacity: count)
            wgt = ptrs[1].bindMemory(to: Float.self, capacity: count)
            // ftruncate gir en fil full av nuller, som er nøyaktig startverdien vi vil ha.
            urls = us; fds = fs
        }

        deinit {
            munmap(UnsafeMutableRawPointer(sdf), bytes)
            munmap(UnsafeMutableRawPointer(wgt), bytes)
            fds.forEach { close($0) }
            urls.forEach { try? FileManager.default.removeItem(at: $0) }
        }
    }

    // MARK: - Bygg

    /// Fusjonerer all rå dybde i `framesDir` og returnerer et mesh i samme form som
    /// `MeshBakeV2.mergeAnchors` gir, klart for unwrap og bake. nil om dataene mangler.
    static func build(framesDir: URL, options optionsIn: Options = Options()) -> MeshBakeV2.MergedMesh? {
        var options = optionsIn
        // JBU kan lage FALSK geometri på teksturløse flater: den lar dybden hoppe der GUIDEN
        // har en kant, og et hvitt tak har ingen tekstur men vel lysgradienter og skygger.
        // Leses de som kanter, oppstår dybdesprang som ikke finnes — flak som flyter foran
        // taket. meshscan.jbu = 1 slår den av.
        if let j = Int(UserDefaults.standard.string(forKey: "meshscan.jbu") ?? "") { options.jbuScale = max(1, j) }
        if let s = UserDefaults.standard.string(forKey: "meshscan.tsdftrunc"), let v = Float(s), v > 0.5 {
            options.truncVoxels = min(8, v)
        }
        let t0 = CFAbsoluteTimeGetCurrent()
        ARMeshGlbExporter.progress?("Leser dybdedata…")
        var frames = loadDense(framesDir, maxVelocity: options.maxVelocity)
        if options.jbuScale > 1 {
            ARMeshGlbExporter.progress?("Skjerper dybdekanter…")
            frames += loadKeyframesJBU(framesDir, scale: options.jbuScale)
        }
        guard !frames.isEmpty else {
            MeshLog.log("TSDF: fant ingen dybdeframes i \(framesDir.lastPathComponent)")
            return nil
        }

        // ── Romgrenser fra dybden selv, ikke fra ARKit-nettet.
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        for f in frames {
            guard let dep = f.load() else { continue }
            for y in stride(from: 0, to: f.h, by: 8) {
                for x in stride(from: 0, to: f.w, by: 8) {
                    let z = dep[y * f.w + x]
                    guard z > 0.3, z < 5.0 else { continue }
                    let pc = SIMD3<Float>((Float(x) - f.cx) / f.fx * z, -(Float(y) - f.cy) / f.fy * z, -z)
                    let pw = (f.c2w * SIMD4(pc, 1)).xyz
                    lo = simd_min(lo, pw); hi = simd_max(hi, pw)
                }
            }
        }
        guard lo.x < hi.x else { MeshLog.log("TSDF: ingen gyldige dybdepunkter"); return nil }

        // Voxelstørrelsen økes til volumet får plass — et stort rom skal ikke ta ned appen.
        var vox = options.voxel
        var dim = SIMD3<Int>(0, 0, 0)
        while true {
            lo -= SIMD3(repeating: vox * options.truncVoxels * 2)
            hi += SIMD3(repeating: vox * options.truncVoxels * 2)
            dim = SIMD3(Int((hi.x - lo.x) / vox) + 1, Int((hi.y - lo.y) / vox) + 1, Int((hi.z - lo.z) / vox) + 1)
            if dim.x * dim.y * dim.z <= options.maxVoxels { break }
            vox *= 1.25
            MeshLog.log("TSDF: volum for stort → voxel \(Int(vox * 1000))mm")
        }
        let trunc = vox * options.truncVoxels
        let total = dim.x * dim.y * dim.z
        MeshLog.log(String(format: "TSDF: %d frames · %.1f×%.1f×%.1f m · voxel %dmm · %.1fM voxels (%dMB)",
                           frames.count, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z,
                           Int(vox * 1000), Double(total) / 1e6, total * 8 / 1024 / 1024))

        guard let store = VoxelStore(count: total, dir: framesDir) else {
            MeshLog.log("TSDF: klarte ikke å legge voxelvolumet på disk")
            return nil
        }
        let S = store.sdf, W = store.wgt
        var used = 0

        do {
            for (fi, f) in frames.enumerated() {
                // Fusjonen er den lengste stille perioden i hele baken (~10 s). Uten
                // framdrift står teksten frosset og leses som at appen henger.
                if fi % 25 == 0 {
                    ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR… \(fi * 100 / max(frames.count, 1)) %")
                }
                guard let dep = f.load() else { continue }
                let org = f.c2w.columns.3.xyz
                for y in 1..<(f.h - 1) {
                    for x in 1..<(f.w - 1) {
                        let z = dep[y * f.w + x]
                        guard z > 0.3, z < 5.0 else { continue }
                        // Dybdekant: LiDAR «flyr» der dybden hopper og legger igjen falske
                        // flak i lufta. Trolig det som drepte de tidligere fusion-forsøkene.
                        let dz = max(abs(dep[y * f.w + x + 1] - z), abs(dep[(y + 1) * f.w + x] - z))
                        if dz > max(0.04, 0.03 * z) { continue }
                        used += 1
                        let pc = SIMD3<Float>((Float(x) - f.cx) / f.fx, -(Float(y) - f.cy) / f.fy, -1)
                        let raw = (f.c2w * SIMD4(pc, 0)).xyz
                        // sceneDepth er Z-DYBDE, ikke radiell avstand. Marsjerer man `z` meter
                        // langs en NORMALISERT stråle, havner punktene for nær langs kantene —
                        // ved hjørnet er strålen 1,28× lengre, altså 85 cm feil på tre meter,
                        // og flate vegger buler mot kameraet som et fisheye.
                        let len = simd_length(raw)
                        let dir = raw / len
                        let zr = z * len
                        // Avstandsvekt med GULV: ren 1/d² lot fjerne flater falle under
                        // vektterskelen uansett hvor mange ganger de var sett, og gulvet midt
                        // i rommet forsvant i et svart hull.
                        let wf = max(0.25, min(1.5, 1.5 / max(z, 0.4))) * f.trust
                        var t = zr - trunc
                        let tEnd = zr + trunc
                        while t <= tEnd {
                            let p = org + dir * t
                            let gx = Int((p.x - lo.x) / vox), gy = Int((p.y - lo.y) / vox), gz = Int((p.z - lo.z) / vox)
                            if gx >= 0, gy >= 0, gz >= 0, gx < dim.x, gy < dim.y, gz < dim.z {
                                let i = (gz * dim.y + gy) * dim.x + gx
                                let d = max(-1, min(1, (zr - t) / trunc))
                                let ow = W[i]
                                S[i] = (S[i] * ow + d * wf) / (ow + wf)
                                W[i] = min(ow + wf, 40)
                            }
                            t += vox * 0.5
                        }
                    }
                }
            }
        }
        MeshLog.log(String(format: "TSDF: %d målinger fusjonert på %.1fs", used, CFAbsoluteTimeGetCurrent() - t0))

        ARMeshGlbExporter.progress?("Glatter volum…")
        blurVolume(S, wgt: W, count: total, dim: dim, passes: options.volumeBlur, minW: options.minWeight)
        ARMeshGlbExporter.progress?("Trekker ut flater…")
        return surfaceNets(sdf: S, wgt: W, dim: dim, lo: lo, vox: vox,
                           minW: options.minWeight, smoothPasses: options.smoothPasses)
    }

    // MARK: - Volum-blur

    /// Separabel 3-taps blur på SELVE VOLUMET. Teller kun observerte voxels; trekker man
    /// tomrommet med, dras flatene mot null og det oppstår falske overflater i lufta.
    /// Blur på det mmap-ede volumet. Kopien per akse skjer i en TEMPORÆR buffer på samme
    /// størrelse — den er kortlevd, men for et stort volum er den likevel betydelig, så den
    /// tas én akse om gangen framfor å holde tre samtidig.
    private static func blurVolume(_ sdf: UnsafeMutablePointer<Float>, wgt: UnsafeMutablePointer<Float>,
                                   count n: Int, dim: SIMD3<Int>, passes: Int, minW: Float) {
        guard passes > 0 else { return }
        let tmp = UnsafeMutablePointer<Float>.allocate(capacity: n)
        defer { tmp.deallocate() }
        for _ in 0..<passes {
            for axis in 0..<3 {
                let step = axis == 0 ? 1 : (axis == 1 ? dim.x : dim.x * dim.y)
                tmp.update(from: sdf, count: n)
                DispatchQueue.concurrentPerform(iterations: 8) { slice in
                    let lo = n * slice / 8, hi = n * (slice + 1) / 8
                    for i in lo..<hi {
                        guard wgt[i] > minW else { continue }
                        var acc = tmp[i] * 0.5, wsum: Float = 0.5
                        if i >= step, wgt[i - step] > minW { acc += tmp[i - step] * 0.25; wsum += 0.25 }
                        if i + step < n, wgt[i + step] > minW { acc += tmp[i + step] * 0.25; wsum += 0.25 }
                        sdf[i] = acc / wsum
                    }
                }
            }
        }
    }

    // MARK: - Surface nets

    /// Valgt framfor marching cubes: ingen 256-oppslagstabeller, ett verteks per kube i
    /// stedet for opptil fem, og bedre formede trekanter.
    private static func surfaceNets(sdf: UnsafeMutablePointer<Float>, wgt: UnsafeMutablePointer<Float>, dim: SIMD3<Int>,
                                    lo: SIMD3<Float>, vox: Float, minW: Float,
                                    smoothPasses: Int) -> MeshBakeV2.MergedMesh? {
        let t0 = CFAbsoluteTimeGetCurrent()
        var cell = [Int32](repeating: -1, count: dim.x * dim.y * dim.z)
        var verts: [SIMD3<Float>] = []
        let corner: [SIMD3<Int>] = [SIMD3(0,0,0), SIMD3(1,0,0), SIMD3(0,1,0), SIMD3(1,1,0),
                                    SIMD3(0,0,1), SIMD3(1,0,1), SIMD3(0,1,1), SIMD3(1,1,1)]
        let edges: [(Int, Int)] = [(0,1),(2,3),(4,5),(6,7),(0,2),(1,3),(4,6),(5,7),(0,4),(1,5),(2,6),(3,7)]

        for z in 0..<(dim.z - 1) {
            for y in 0..<(dim.y - 1) {
                for x in 0..<(dim.x - 1) {
                    var v = [Float](repeating: 0, count: 8)
                    var ok = true
                    for (k, c) in corner.enumerated() {
                        let i = ((z + c.z) * dim.y + (y + c.y)) * dim.x + (x + c.x)
                        if wgt[i] <= minW { ok = false; break }
                        v[k] = sdf[i]
                    }
                    guard ok else { continue }
                    var acc = SIMD3<Float>.zero
                    var n = 0
                    for (a, b) in edges where (v[a] > 0) != (v[b] > 0) {
                        let t = v[a] / (v[a] - v[b])
                        let pa = SIMD3<Float>(corner[a]), pb = SIMD3<Float>(corner[b])
                        acc += pa + (pb - pa) * t
                        n += 1
                    }
                    guard n > 0 else { continue }
                    cell[(z * dim.y + y) * dim.x + x] = Int32(verts.count)
                    verts.append(lo + (SIMD3<Float>(Float(x), Float(y), Float(z)) + acc / Float(n)) * vox)
                }
            }
        }
        guard !verts.isEmpty else { MeshLog.log("TSDF: surface nets ga null verts"); return nil }

        var idx: [UInt32] = []
        func cellAt(_ x: Int, _ y: Int, _ z: Int) -> Int32? {
            guard x >= 0, y >= 0, z >= 0, x < dim.x, y < dim.y, z < dim.z else { return nil }
            let c = cell[(z * dim.y + y) * dim.x + x]
            return c >= 0 ? c : nil
        }
        func quad(_ a: Int32, _ b: Int32, _ c: Int32, _ d: Int32, flip: Bool) {
            if flip { idx += [UInt32(a), UInt32(c), UInt32(b), UInt32(a), UInt32(d), UInt32(c)] }
            else    { idx += [UInt32(a), UInt32(b), UInt32(c), UInt32(a), UInt32(c), UInt32(d)] }
        }
        for z in 1..<(dim.z - 1) {
            for y in 1..<(dim.y - 1) {
                for x in 1..<(dim.x - 1) {
                    let i0 = (z * dim.y + y) * dim.x + x
                    guard wgt[i0] > minW else { continue }
                    let s0 = sdf[i0]
                    let ix = i0 + 1, iy = i0 + dim.x, iz = i0 + dim.x * dim.y
                    if wgt[ix] > minW, (s0 > 0) != (sdf[ix] > 0),
                       let a = cellAt(x, y, z), let b = cellAt(x, y - 1, z),
                       let c = cellAt(x, y - 1, z - 1), let d = cellAt(x, y, z - 1) {
                        quad(a, b, c, d, flip: s0 > 0)
                    }
                    if wgt[iy] > minW, (s0 > 0) != (sdf[iy] > 0),
                       let a = cellAt(x, y, z), let b = cellAt(x, y, z - 1),
                       let c = cellAt(x - 1, y, z - 1), let d = cellAt(x - 1, y, z) {
                        quad(a, b, c, d, flip: s0 > 0)
                    }
                    if wgt[iz] > minW, (s0 > 0) != (sdf[iz] > 0),
                       let a = cellAt(x, y, z), let b = cellAt(x - 1, y, z),
                       let c = cellAt(x - 1, y - 1, z), let d = cellAt(x, y - 1, z) {
                        quad(a, b, c, d, flip: s0 > 0)
                    }
                }
            }
        }

        // Taubin: nabosnitt akkumulert rett over trekantlista. En naboliste per verteks ville
        // betydd over en million små allokeringer og sprengte minnet.
        for pass in 0..<smoothPasses {
            let f: Float = pass % 2 == 0 ? 0.55 : -0.58
            var sum = [SIMD3<Float>](repeating: .zero, count: verts.count)
            var cnt = [Float](repeating: 0, count: verts.count)
            for t in stride(from: 0, to: idx.count, by: 3) {
                let a = Int(idx[t]), b = Int(idx[t + 1]), c = Int(idx[t + 2])
                sum[a] += verts[b] + verts[c]; cnt[a] += 2
                sum[b] += verts[a] + verts[c]; cnt[b] += 2
                sum[c] += verts[a] + verts[b]; cnt[c] += 2
            }
            for i in 0..<verts.count where cnt[i] >= 3 {
                verts[i] += (sum[i] / cnt[i] - verts[i]) * f
            }
        }

        var pos = [Float](); pos.reserveCapacity(verts.count * 3)
        for v in verts { pos += [v.x, v.y, v.z] }

        // ── DOMINANTPLAN. Uten disse er `MergedMesh.planes` tom, og da hopper baken over
        // hele plan-tildelingen (`break planeAssign`). Konsekvensen er at hver flate velger
        // vinnerfoto helt fritt: to bilder som er omtrent like gode på samme vegg gir
        // naboflater hvert sitt valg, og du får en fargegrense midt på en vegg som burde
        // vært én sammenhengende flate. Plan-lås binder hele veggen til ETT foto når det
        // dekker den godt nok — det er kuren mot akkurat det.
        // Kallet retter samtidig verteksene inn mot planene, så vegger blir virkelig flate.
        let planes = ARMeshGlbExporter.snapDominantPlanes(positions: &pos, indices: idx)

        let nrm = ARMeshGlbExporter.recomputeNormals(positions: pos, indices: idx)

        // ── ROMLIGE BLOKKER som pseudo-anchors.
        // `triAnchor` styrer xatlas' chunking: hver distinkte id blir en EGEN xatlas-mesh, og
        // de pakkes parallelt. ARKit-nettet får dette gratis fra sine anchors; et TSDF-nett
        // har ingen, og med én felles id blir hele nettet én sekvensiell jobb — som er den
        // desidert største posten i baketiden (99 s av 115 s på 250k tris).
        // Blokker på 3 m ligner ARKit-anchorenes egen størrelse. Prisen er sømmer der blokkene
        // møtes, men nedstrøms søm-nivellering og multiband er bygget for nettopp det.
        // Stor verdi (f.eks. 999) = ÉN blokk = ingen chunking. Testbryter: chunkingen gjorde
        // xatlas 10× raskere, men fragmenterer atlaset kraftig, og flater i små charts kan
        // ende med UV som peker inn i dilatasjonssonen mellom charts — synlig som hvite flak
        // med fargede fragmenter i. meshscan.uvblock.
        let blockSize = Float(UserDefaults.standard.string(forKey: "meshscan.uvblock") ?? "") ?? 3.0
        var anchors = [UInt32](repeating: 0, count: idx.count / 3)
        var blockIds = [Int64: UInt32]()
        for t in 0..<(idx.count / 3) {
            // Fra `pos`, ikke `verts`: snapDominantPlanes har flyttet punktene siden.
            let i0 = Int(idx[t * 3]) * 3, i1 = Int(idx[t * 3 + 1]) * 3, i2 = Int(idx[t * 3 + 2]) * 3
            let c = SIMD3<Float>(pos[i0] + pos[i1] + pos[i2],
                                 pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1],
                                 pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3
            let key = (Int64(floor(c.x / blockSize)) &* 73856093)
                ^ (Int64(floor(c.y / blockSize)) &* 19349663)
                ^ (Int64(floor(c.z / blockSize)) &* 83492791)
            if let id = blockIds[key] { anchors[t] = id }
            else { let id = UInt32(blockIds.count); blockIds[key] = id; anchors[t] = id }
        }
        MeshLog.log(String(format: "TSDF: surface nets %d verts, %d tris, %d UV-blokker på %.1fs",
                           verts.count, idx.count / 3, blockIds.count, CFAbsoluteTimeGetCurrent() - t0))
        // PLAN-LÅSEN ER AV for TSDF-nett (brukerdom 2026-09-01). Planene brukes til å RETTE
        // geometrien over — det er ren gevinst, vegger blir virkelig flate — men de sendes
        // IKKE videre til baken, for der gjorde de vondt verre:
        //   · 19 delinger mot 1,3 % låste flater, og hver deling er en synlig linje på veggen
        //   · uten deling faller taket til per-region-valg og får store toneflater
        // Årsaken er at TSDF-planene er finere oppdelt enn ARKits og sjelden dekkes 90 % av
        // ett enkelt foto. `meshscan.planelock=on` sender dem likevel, for A/B.
        let sendPlanes = UserDefaults.standard.string(forKey: "meshscan.planelock") == "on"
        MeshLog.log("TSDF: \(planes.count) plan snappet i geometrien, plan-lås \(sendPlanes ? "PÅ" : "av")")
        return MeshBakeV2.MergedMesh(positions: pos, normals: nrm, indices: idx,
                                     triAnchor: anchors, planes: sendPlanes ? planes : [], faceClass: [])
    }

    // MARK: - Innlesing

    /// MYK vekting framfor hard kasting (2026-09-01). Et binært filter kastet 40 % av kartene
    /// i et urolig skann, og flatene mistet observasjoner de kunne hatt nytte av — det er
    /// nettopp da dobbeltflater oppstår, fordi de gjenværende er for få til å bli enige.
    /// Nå faller tilliten gradvis fra full ved rolig bevegelse til et gulv på 0.15, og bare
    /// det virkelig ustøe (over det dobbelte av grensen) kastes helt.
    private static func trustForMotion(_ lin: Float, _ rot: Float, _ maxVel: Float) -> Float {
        guard maxVel > 0 else { return 1 }
        let worst = max(lin / maxVel, rot / (maxVel * 1.5))
        if worst <= 1 { return 1 }
        if worst >= 2 { return 0 }
        return max(0.15, 1 - (worst - 1))
    }

    private static func loadDense(_ dir: URL, maxVelocity: Float) -> [DFrame] {
        guard let txt = try? String(contentsOf: dir.appendingPathComponent("dense.jsonl"), encoding: .utf8)
        else { return [] }
        var meta: [(i: Int, t: Double, w: Int, h: Int, k: SIMD4<Float>, m: simd_float4x4)] = []
        for line in txt.split(separator: "\n") {
            guard let d = line.data(using: .utf8),
                  let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let i = o["i"] as? Int, let w = o["w"] as? Int, let h = o["h"] as? Int,
                  let ts = o["t"] as? Double,
                  let fx = o["fx"] as? Double, let fy = o["fy"] as? Double,
                  let cx = o["cx"] as? Double, let cy = o["cy"] as? Double,
                  let m = o["m"] as? [Double], m.count == 16 else { continue }
            let f = m.map { Float($0) }
            meta.append((i, ts, w, h, SIMD4(Float(fx), Float(fy), Float(cx), Float(cy)),
                         simd_float4x4(columns: (SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]),
                                                 SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15])))))
        }
        // Bevegelsesfilter, av posene selv. Dense ligger på 5 Hz, derav faktoren 2,5 for
        // avstand over to steg.
        var trust = [Float](repeating: 1, count: meta.count)
        if maxVelocity > 0, meta.count > 2 {
            for i in 1..<(meta.count - 1) {
                let p0 = meta[i - 1].m.columns.3.xyz, p1 = meta[i + 1].m.columns.3.xyz
                let f0 = -meta[i - 1].m.columns.2.xyz, f1 = -meta[i + 1].m.columns.2.xyz
                // FAKTISK tidsdifferanse, ikke antatt 5 Hz. Uttynningen for lange skann
                // (halvert opptaksfrekvens når taket nærmer seg) gjør intervallet VARIABELT,
                // og med en fast faktor ble hastigheten overvurdert med det dobbelte etter
                // kart 300 — et rolig skann fikk da 40 % av kartene forkastet for å ha gått
                // fort (device 2026-09-01). Klemmen tåler hull i tidsrekka.
                let dt = Float(max(0.08, min(2.0, meta[i + 1].t - meta[i - 1].t)))
                let lin = simd_distance(p0, p1) / dt
                let rot = acos(max(-1, min(1, simd_dot(simd_normalize(f0), simd_normalize(f1))))) / dt
                trust[i] = trustForMotion(lin, rot, maxVelocity)
            }
        }
        var out: [DFrame] = []
        var dempet = 0
        for (n, mt) in meta.enumerated() where trust[n] > 0 {
            let u = dir.appendingPathComponent("dense-\(mt.i).f32")
            guard FileManager.default.fileExists(atPath: u.path) else { continue }
            if trust[n] < 1 { dempet += 1 }
            out.append(DFrame(w: mt.w, h: mt.h, fx: mt.k.x, fy: mt.k.y, cx: mt.k.z, cy: mt.k.w,
                              c2w: mt.m, url: u, inline: nil, trust: trust[n], jbuGuide: nil, jbuScale: 1))
        }
        MeshLog.log("TSDF: \(out.count)/\(meta.count) dense-frames (\(dempet) dempet, \(meta.count - out.count) forkastet)")
        return out
    }

    /// Depth super-resolution: keyframene har både 4K-bilde og eget dybdekart perfekt
    /// synkronisert — det eneste stedet i bundlet der en RGB-guide finnes.
    private static func loadKeyframesJBU(_ dir: URL, scale: Int) -> [DFrame] {
        guard let kd = try? Data(contentsOf: dir.appendingPathComponent("fixture-kf.json")),
              let kfs = try? JSONDecoder().decode([MeshScanPresenter.Keyframe].self, from: kd)
        else { return [] }
        var out: [DFrame] = []
        for k in kfs {
            guard let df = k.depthFile,
                  let dd = try? Data(contentsOf: dir.appendingPathComponent(df)),
                  dd.count == k.depthWidth * k.depthHeight * 4,
                  let g = loadLuma(dir.appendingPathComponent(k.file), maxW: k.depthWidth * scale)
            else { continue }
            let low = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            let up = jbu(depth: low, dw: k.depthWidth, dh: k.depthHeight, guide: g.y, gw: g.w, gh: g.h)
            let s = Float(g.w) / Float(k.width)
            let m = k.transform
            out.append(DFrame(w: g.w, h: g.h,
                              fx: k.intrinsics[0] * s, fy: k.intrinsics[1] * s,
                              cx: k.intrinsics[2] * s, cy: k.intrinsics[3] * s,
                              c2w: simd_float4x4(columns: (SIMD4(m[0], m[1], m[2], m[3]),
                                                           SIMD4(m[4], m[5], m[6], m[7]),
                                                           SIMD4(m[8], m[9], m[10], m[11]),
                                                           SIMD4(m[12], m[13], m[14], m[15]))),
                              url: nil, inline: up, trust: 1, jbuGuide: nil, jbuScale: scale))
        }
        MeshLog.log("TSDF: depth super-res på \(out.count) keyframes (JBU ×\(scale))")
        return out
    }

    /// Joint bilateral upsampling (Kopf 2007). Vekter nabodybder både etter avstand OG etter
    /// likhet i guiden, så dybden får hoppe nøyaktig der bildet hopper og holder seg glatt
    /// der bildet er glatt. Klassisk metode, ingen ML.
    private static func jbu(depth: [Float], dw: Int, dh: Int,
                            guide: [Float], gw: Int, gh: Int, sigmaColor: Float = 0.09) -> [Float] {
        var out = [Float](repeating: 0, count: gw * gh)
        let sx = Float(dw) / Float(gw), sy = Float(dh) / Float(gh)
        var spatial = [Float](repeating: 0, count: 25)
        for j in -2...2 { for i in -2...2 { spatial[(j + 2) * 5 + (i + 2)] = exp(-Float(i * i + j * j) / 4.5) } }
        out.withUnsafeMutableBufferPointer { op in
            let O = op.baseAddress!
            DispatchQueue.concurrentPerform(iterations: 8) { slice in
                let y0 = gh * slice / 8, y1 = gh * (slice + 1) / 8
                for y in y0..<y1 {
                    let cy = Int(Float(y) * sy)
                    for x in 0..<gw {
                        let cx = Int(Float(x) * sx)
                        let gRef = guide[y * gw + x]
                        // Senterdybden er referansen for DYBDE-termen under.
                        let dRef = depth[min(dh - 1, max(0, cy)) * dw + min(dw - 1, max(0, cx))]
                        var acc: Float = 0, wsum: Float = 0
                        for j in -2...2 {
                            let ny = cy + j
                            guard ny >= 0, ny < dh else { continue }
                            for i in -2...2 {
                                let nx = cx + i
                                guard nx >= 0, nx < dw else { continue }
                                let d = depth[ny * dw + nx]
                                guard d > 0.3, d < 5.0 else { continue }
                                let ggx = min(gw - 1, max(0, Int(Float(nx) / sx)))
                                let ggy = min(gh - 1, max(0, Int(Float(ny) / sy)))
                                let dc = guide[ggy * gw + ggx] - gRef
                                // DYBDE-TERM (2026-09-01). Uten den lar JBU dybden hoppe der
                                // bare BILDET har en kant — og et hvitt tak har ingen tekstur,
                                // men vel lysgradienter og skygger. De ble lest som kanter, og
                                // resultatet var falske flak foran taket: målt utvidet JBU
                                // rommets bounding box med 2,4 m. Nå må bildet OG dybden være
                                // enige før dybden får hoppe. Kantpresisjonen på ekte kanter
                                // (klokke, list, karm) beholdes, siden dybden der faktisk
                                // hopper — det er bare de oppdiktede spranga som forsvinner.
                                // Toleransen vokser med avstanden, som LiDAR-støyen gjør.
                                let dd = d - dRef
                                let sigmaD = max(0.03, 0.03 * dRef)
                                let w = spatial[(j + 2) * 5 + (i + 2)]
                                    * exp(-dc * dc / (sigmaColor * sigmaColor))
                                    * exp(-dd * dd / (sigmaD * sigmaD))
                                acc += d * w; wsum += w
                            }
                        }
                        O[y * gw + x] = wsum > 1e-5 ? acc / wsum : 0
                    }
                }
            }
        }
        return out
    }

    /// Luminans som guide, ikke farge: der bare kulør skifter (tapet mot hvitmalt list) er
    /// lyshet en bedre kantindikator.
    private static func loadLuma(_ url: URL, maxW: Int) -> (y: [Float], w: Int, h: Int)? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxW,
            kCGImageSourceCreateThumbnailWithTransform: false,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary),
              let rgba = MeshImageIO.rgbaBytes(cg) else { return nil }
        let w = cg.width, h = cg.height
        var y = [Float](repeating: 0, count: w * h)
        for i in 0..<(w * h) {
            y[i] = (0.299 * Float(rgba[i * 4]) + 0.587 * Float(rgba[i * 4 + 1])
                    + 0.114 * Float(rgba[i * 4 + 2])) / 255
        }
        return (y, w, h)
    }
}

extension SIMD4 where Scalar == Float {
    var xyz: SIMD3<Float> { SIMD3(x, y, z) }
}
