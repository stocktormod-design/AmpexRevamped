import Foundation
import simd
import CoreGraphics
import QuartzCore

/// KONSTRUERT gaussian-splat — ingen trening, ingen gradienter, ingen densification.
///
/// Bakgrunnen: en teksturert mesh må VELGE ett foto per flate, og det valget er kilden til
/// alt vi har slåss med (patchwork, sømmer, eksponeringssprang). En splat velger ikke. Hver
/// gaussian bærer sin egen farge fra sitt eget beste bilde, og naboene blender av seg selv.
/// Scaniverse gjør nettopp dette on-device på under 90 sekunder — de seeder splatten fra sin
/// egen mesh-pipeline framfor å trene fra bunnen. Vi har allerede den mesh-pipelinen.
///
/// Steg: fixture (mesh + re-ankrede kf-poser) → arealvektet flatesampling → per-punkt beste
/// bilde med SAMME scorer-konvensjon som `MeshBakeV2` (cos/d² × kvalitet, ±30 cm dybdetest,
/// dybdekant-eksklusjon, kantavfall, gjenskinnsstraff) → 3DGS-PLY som MetalSplatter leser.
///
/// Nivå null i splat-planen: er denne stygg, ligger feilen i init og ikke i en trener vi da
/// slipper å ha bygget. Er den lovende, er 300–1000 iterasjoners puss neste trinn.
enum MeshSplatBuild {

    /// SH degree 0-basis. 3DGS-renderere regner farge = f_dc · C0 + 0.5.
    private static let shC0: Float = 0.28209479177387814

    struct Options {
        /// Måltall gaussians. Sampling er arealvektet, så dette styrer TETTHET, ikke rommets
        /// størrelse — et stort rom får like fin oppløsning som et lite, det koster bare mer.
        /// Punkttettheten ER oppløsningsgrensen. Målt på 109 m² stue (avstand → hva som sees):
        /// 400k → 16,5 mm (teppemønster borte) · 1,4M → 7,8 mm (mønster + gulvfuger) ·
        /// 2,5M → 5,7 mm (ornamenter i teppet, blader på plantene). Tiden knapt rørt seg
        /// (2,0 → 2,4 s): den ligger i JPEG-dekodingen, ikke i punkttallet.
        ///
        /// MERK at faktisk antall blir ~35 % HØYERE enn måltallet — gitteroppløsningen rundes
        /// opp per triangel, og små triangler får minst ett punkt uansett. 2,5M → ~3,4M
        /// punkter → ~197 MB PLY og ~190 MB topp under bygging. `memoryCap` bremser dette
        /// på enheter som ikke tåler det.
        var targetCount: Int = 2_500_000
        /// Halverer måltallet på enheter med under 6 GB RAM. Splat-bygget topper på flere
        /// hundre MB, og en iPhone med 4 GB deler det med React Native og resten av appen.
        var memoryCap: Bool = true
        /// σ som andel av punktavstanden. Henger tett sammen med `jitter`: hull krever stor σ,
        /// og stor σ ER uskarphet. Med tilfeldig sampling måtte σ opp i 1.0 for å dekke
        /// hullene, og bildet ble tåkete. Med stratifisert gitter holder 0.7 flatene tette
        /// OG skarpe — det var samplingen, ikke σ, som gjorde de første forsøkene blurry.
        var sigmaScale: Float = 0.7
        /// Tykkelse på disken som andel av σ. Lav = flat disk som legger seg på flaten, men
        /// for lav gjør den til en strek sett på skrå (bidro til kornetheten ved 0.15).
        var thinRatio: Float = 0.3
        /// Fast opasitet før logit. Helt opakt blir hardt i skjøtene; 0.9 lar naboer blende.
        var opacity: Float = 0.9
        /// Hvor mange sikt-linjer hvert punkt blander. 1 = winner-take-all (baken sin oppførsel,
        /// nyttig som A/B-referanse); 4 lar jevnbyrdige bilder gli over i hverandre der sømmene
        /// ellers står. Koster n·K·16 byte ≈ 25 MB ved 400k punkter og K=4.
        var topK: Int = 4
        /// Hvor mye punktene får flytte seg innenfor sin gittercelle, som andel av cellen.
        /// MÅLT: 0 gir moiré (vevd rutemønster på vegger og gulv), 0.7 åpner hull igjen og
        /// flatene blir kornete. Det er den samme avveiningen som σ, sett fra motsatt kant.
        /// Merk at riktig verdi følger tettheten: 0.3 var riktig ved 7,8 mm, men ga moiré
        /// igjen ved 4,5 mm — tettere gitter trenger mer jitter for å bryte mønsteret.
        var jitter: Float = 0.4
        /// Godta at flaten sees fra «baksiden». Nett fra surface nets er LUKKET, og der er
        /// normalretningen et resultat av quad-orienteringen — snur den feil vei for noen
        /// flater, vrakes ellers synlige punkter av synsvinkeltesten og etterlater spredte
        /// hull midt i en hel vegg. Punktet ligger uansett på en ekte flate, og
        /// dybdetesten fanger opp om noe står foran, så fortegnet er ikke verdt å stole på.
        /// Av for ARKit-nettet, som har konsistent orienterte normaler.
        var twoSided: Bool = false
        /// Deterministisk frø — fixture-A/B krever at samme bundle gir samme splat.
        var seed: UInt64 = 0x9E3779B97F4A7C15
    }

    // MARK: - Deterministisk RNG (xorshift64*)

    private struct Rng {
        var s: UInt64
        mutating func next() -> Float {
            s ^= s >> 12; s ^= s << 25; s ^= s >> 27
            return Float((s &* 2685821657736338717) >> 40) / Float(1 << 24)
        }
    }

    // MARK: - Kamerakandidat (speiler MeshBakeV2.Cand — samme konvensjon, ellers bommer vi)

    private struct Cam {
        var w2c: simd_float4x4
        var camPos: SIMD3<Float>
        var intr: SIMD4<Float>          // fx, fy, cx, cy — skalert til lagret bildestørrelse
        var imgW: Float, imgH: Float
        var quality: Float
        var depth: [Float], dw: Int, dh: Int
        var file: String
    }

    // MARK: - Bygg

    /// Leser fixture fra `framesDir`, konstruerer splatten og skriver `splat.ply`.
    /// Returnerer filen, eller nil om fixture mangler eller ingen punkter fikk farge.
    static func build(framesDir: URL, options: Options = Options()) -> URL? {
        let t0 = CACurrentMediaTime()
        guard let fx = MeshBakeV2.readFixture(framesDir: framesDir) else {
            MeshLog.log("SPLAT: fant ingen fixture i \(framesDir.lastPathComponent)")
            return nil
        }
        let mesh = fx.mesh
        let triCount = mesh.indices.count / 3
        guard triCount > 0 else { MeshLog.log("SPLAT: tom mesh"); return nil }

        var options = options
        if options.memoryCap, ProcessInfo.processInfo.physicalMemory < 6_000_000_000 {
            options.targetCount /= 2
            MeshLog.log("SPLAT: under 6GB RAM → halverer måltall til \(options.targetCount)")
        }

        // ── 1. Arealvektet flatesampling.
        // Per verteks ville gitt tetthet etter triangelstørrelse, ikke etter detalj: store
        // glatte vegger hadde blitt tynne og små ARKit-fliser overrepresentert. Areal-vekting
        // gir jevn tetthet, som er det gaussians trenger for å slutte seg til en flate.
        var (pts, nrms) = samplePoints(mesh: mesh, triCount: triCount, options: options)
        guard !pts.isEmpty else { MeshLog.log("SPLAT: sampling ga null punkter"); return nil }
        let area = totalArea(mesh: mesh, triCount: triCount)
        let spacing = sqrt(max(area, 1e-4) / Float(pts.count))
        MeshLog.log("SPLAT: \(pts.count) punkter over \(String(format: "%.1f", area)) m² — avstand \(String(format: "%.1f", spacing * 1000))mm")

        // ── 2. Kandidater. Samme kvalitetsrangering som baken, så et bilde baken vraker
        //    heller ikke får farge her.
        let kf = fx.keyframes
        let maxSharp = max(kf.map(\.sharpness).max() ?? 1, 1e-4)
        var cams: [Cam] = []
        cams.reserveCapacity(kf.count)
        for k in kf {
            let c2w = mat4(k.transform)
            var depth: [Float] = []; var dw = 0; var dh = 0
            if let df = k.depthFile, let dd = try? Data(contentsOf: framesDir.appendingPathComponent(df)),
               dd.count == k.depthWidth * k.depthHeight * 4 {
                depth = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
                dw = k.depthWidth; dh = k.depthHeight
            }
            cams.append(Cam(
                w2c: simd_inverse(c2w),
                camPos: SIMD3(k.transform[12], k.transform[13], k.transform[14]),
                intr: SIMD4(k.intrinsics[0], k.intrinsics[1], k.intrinsics[2], k.intrinsics[3]),
                imgW: Float(k.width), imgH: Float(k.height),
                quality: MeshScanPresenter.kfQuality(sharpness: k.sharpness / maxSharp,
                                                     motion: k.motion, blurPx: k.blurPx)
                    * ((k.preLock ?? false) ? 0.6 : 1),
                depth: depth, dw: dw, dh: dh, file: k.file))
        }

        // ── 3. Strømmende farging: ETT bilde i minnet om gangen (4K RGBA ≈ 33 MB). Samme grep
        //    som teksturbaken bruker for å holde minnetaket flatt uansett antall keyframes.
        //
        //    MEN her er hele poenget med å gå via splat: vi VELGER ikke ett bilde. Baken må
        //    velge fordi en texel dekker et område der bildene er cm-uenige om hvor kanten går
        //    — så den må enten kutte (søm) eller blande (smøring). En gaussian er så liten at
        //    uenigheten ikke får plass inni den, og da er blanding gratis. Hvert punkt holder
        //    de `topK` beste sikt-linjene og blandes score-vektet til slutt. Effekten er at
        //    ett klart beste bilde fortsatt dominerer, mens to jevnbyrdige glir over i
        //    hverandre — altså blanding nøyaktig der sømmene ellers ville stått.
        //    Det er også grunnen til at flere synsvinkler blir en STYRKE her, mens de i dag
        //    straffer baken (jf. «more views = worse» i sub-pixel-planen).
        let n = pts.count
        let K = options.topK
        let twoSided = options.twoSided
        var topScore = [Float](repeating: 0, count: n * K)
        // PAKKET RGB (4 byte), ikke SIMD3<Float> (16 byte): kilden ER 8 bit per kanal, så
        // det er ingen presisjon å tape — sammenslåingen skjer i Float uansett. Firedobler
        // hvor mange punkter som får plass før minnetaket, og tetthet er det som gir skarphet.
        var topColor = [UInt32](repeating: 0, count: n * K)
        // NESTE TRINN (ikke bygget): lagre synsretningen ved siden av fargen og fitte
        // SH degree 1 per gaussian med minste kvadrater. Da får flatene view-avhengig glans
        // i stedet for én matt farge — forskjellen på et fargelagt punktskyd og en ekte splat.
        // Koster n·K·16 byte ekstra (~100 MB ved 1,6M punkter), så det skal bygges ferdig i
        // én omgang, ikke stå og samle data ingen bruker.

        for (ci, cam) in cams.enumerated() {
            guard let cg = MeshImageIO.loadCGImage(framesDir, cam.file),
                  let rgba = MeshImageIO.rgbaBytes(cg) else { continue }
            let iw = cg.width, ih = cg.height
            // Bildet kan være lagret i annen oppløsning enn intrinsics er skalert til.
            let sx = Float(iw) / cam.imgW, sy = Float(ih) / cam.imgH

            topScore.withUnsafeMutableBufferPointer { sp in
                topColor.withUnsafeMutableBufferPointer { cp in
                    let spp = sp.baseAddress!, cpp = cp.baseAddress!
                    DispatchQueue.concurrentPerform(iterations: 16) { slice in
                        let lo = n * slice / 16, hi = n * (slice + 1) / 16
                        for i in lo..<hi {
                            guard let hit = project(pts[i], nrms[i], cam, twoSided: twoSided) else { continue }
                            // Finn svakeste av de K beste; bytt bare om dette bildet slår den.
                            let base = i * K
                            var worst = 0
                            for k in 1..<K where spp[base + k] < spp[base + worst] { worst = k }
                            guard hit.score > spp[base + worst] else { continue }
                            let px = min(iw - 1, max(0, Int(hit.u * sx)))
                            let py = min(ih - 1, max(0, Int(hit.v * sy)))
                            let o = (py * iw + px) * 4
                            spp[base + worst] = hit.score
                            cpp[base + worst] = UInt32(rgba[o]) | (UInt32(rgba[o + 1]) << 8)
                                | (UInt32(rgba[o + 2]) << 16)
                        }
                    }
                }
            }
            if ci % 20 == 0 {
                ARMeshGlbExporter.progress?("Farger splat… \(ci + 1)/\(cams.count)")
            }
        }

        // Score-vektet sammenslåing av de K beste sikt-linjene per punkt.
        var color = [SIMD3<Float>](repeating: SIMD3(repeating: 0.5), count: n)
        var seen = [Bool](repeating: false, count: n)
        var viewSum = 0
        for i in 0..<n {
            let base = i * K
            var acc = SIMD3<Float>.zero, wsum: Float = 0, used = 0
            for k in 0..<K where topScore[base + k] > 0 {
                let w = topScore[base + k]
                let p = topColor[base + k]
                let c = SIMD3<Float>(Float(p & 0xFF), Float((p >> 8) & 0xFF), Float((p >> 16) & 0xFF)) / 255
                acc += c * w
                wsum += w
                used += 1
            }
            guard wsum > 0 else { continue }
            color[i] = acc / wsum
            seen[i] = true
            viewSum += used
        }

        // ── 4. Punkter ingen kamera så blir svarte flekker i visningen — de skal ut, ikke
        //    gjettes. Et hull leses som manglende data; en oppdiktet farge leses som feil.
        var keep: [Int] = []
        keep.reserveCapacity(n)
        for i in 0..<n where seen[i] { keep.append(i) }
        guard !keep.isEmpty else { MeshLog.log("SPLAT: ingen punkter fikk farge"); return nil }
        let dropped = n - keep.count
        if dropped > 0 {
            MeshLog.log("SPLAT: \(dropped) punkter (\(dropped * 100 / n)%) uten sikt — droppet")
        }
        // Snitt-antall blandede sikt-linjer: nær 1 betyr at blandingen ikke bet (for få
        // overlappende views, eller topK=1), nær K betyr at mange vinkler faktisk bidrar.
        MeshLog.log("SPLAT: \(String(format: "%.1f", Float(viewSum) / Float(keep.count))) sikt-linjer blandet per punkt (K=\(K))")

        // ── 5. Skriv 3DGS-PLY.
        let sigma = spacing * options.sigmaScale
        let logS = log(max(sigma, 1e-5))
        let logThin = log(max(sigma * options.thinRatio, 1e-6))
        let logitA = log(options.opacity / (1 - options.opacity))

        var body = Data()
        body.reserveCapacity(keep.count * 62)
        var f = [Float](repeating: 0, count: 17)
        for i in keep {
            let p = pts[i], nn = nrms[i], c = color[i]
            let q = quatFromZTo(nn)
            f[0] = p.x; f[1] = p.y; f[2] = p.z
            f[3] = nn.x; f[4] = nn.y; f[5] = nn.z
            f[6] = (c.x - 0.5) / shC0; f[7] = (c.y - 0.5) / shC0; f[8] = (c.z - 0.5) / shC0
            f[9] = logitA
            f[10] = logS; f[11] = logS; f[12] = logThin   // tynn akse = lokal z = normalen
            // 3DGS-rekkefølge er (w, x, y, z); simd_quatf lagrer imaginærdelen først.
            f[13] = q.real; f[14] = q.imag.x; f[15] = q.imag.y; f[16] = q.imag.z
            f.withUnsafeBufferPointer { body.append(Data(buffer: $0)) }
        }

        let header = """
        ply
        format binary_little_endian 1.0
        element vertex \(keep.count)
        property float x
        property float y
        property float z
        property float nx
        property float ny
        property float nz
        property float f_dc_0
        property float f_dc_1
        property float f_dc_2
        property float opacity
        property float scale_0
        property float scale_1
        property float scale_2
        property float rot_0
        property float rot_1
        property float rot_2
        property float rot_3
        end_header

        """
        var out = Data(header.utf8)
        out.append(body)
        let url = framesDir.appendingPathComponent("splat.ply")
        do { try out.write(to: url, options: .atomic) } catch {
            MeshLog.log("SPLAT: kunne ikke skrive splat.ply — \(error.localizedDescription)")
            return nil
        }
        MeshLog.log("SPLAT ferdig — \(keep.count) gaussians, \(out.count / 1024 / 1024)MB, "
                    + "\(String(format: "%.1f", CACurrentMediaTime() - t0))s")
        return url
    }

    // MARK: - Sampling

    private static func totalArea(mesh: MeshBakeV2.MergedMesh, triCount: Int) -> Float {
        var a: Float = 0
        for t in 0..<triCount {
            let (p0, p1, p2) = triVerts(mesh, t)
            a += simd_length(simd_cross(p1 - p0, p2 - p0)) * 0.5
        }
        return a
    }

    private static func triVerts(_ m: MeshBakeV2.MergedMesh, _ t: Int) -> (SIMD3<Float>, SIMD3<Float>, SIMD3<Float>) {
        let i0 = Int(m.indices[t * 3]), i1 = Int(m.indices[t * 3 + 1]), i2 = Int(m.indices[t * 3 + 2])
        return (SIMD3(m.positions[i0 * 3], m.positions[i0 * 3 + 1], m.positions[i0 * 3 + 2]),
                SIMD3(m.positions[i1 * 3], m.positions[i1 * 3 + 1], m.positions[i1 * 3 + 2]),
                SIMD3(m.positions[i2 * 3], m.positions[i2 * 3 + 1], m.positions[i2 * 3 + 2]))
    }

    private static func triNormals(_ m: MeshBakeV2.MergedMesh, _ t: Int) -> (SIMD3<Float>, SIMD3<Float>, SIMD3<Float>) {
        let i0 = Int(m.indices[t * 3]), i1 = Int(m.indices[t * 3 + 1]), i2 = Int(m.indices[t * 3 + 2])
        return (SIMD3(m.normals[i0 * 3], m.normals[i0 * 3 + 1], m.normals[i0 * 3 + 2]),
                SIMD3(m.normals[i1 * 3], m.normals[i1 * 3 + 1], m.normals[i1 * 3 + 2]),
                SIMD3(m.normals[i2 * 3], m.normals[i2 * 3 + 1], m.normals[i2 * 3 + 2]))
    }

    /// REGULÆRT gitter per triangel, ikke tilfeldig sampling.
    ///
    /// Målt 2026-08-31: tilfeldig barysentrisk sampling gir riktig SNITT-avstand, men
    /// klumper og hull rundt det. Hullene tvinger σ opp for å dekkes, og store disker er
    /// nettopp uskarphet — kornete flater ved lav σ og blurry bilde ved høy σ er to sider
    /// av samme feil. Et jevnt gitter har ingen hull å dekke, så σ kan holdes liten og
    /// bildet blir skarpt. Fordelingen er samtidig helt deterministisk, som fixture-A/B
    /// krever (RNG-en brukes nå kun til å avgjøre brøkdeler).
    private static func samplePoints(mesh: MeshBakeV2.MergedMesh, triCount: Int,
                                     options: Options) -> ([SIMD3<Float>], [SIMD3<Float>]) {
        let area = totalArea(mesh: mesh, triCount: triCount)
        guard area > 1e-6 else { return ([], []) }
        // Ønsket avstand mellom naboer, ut fra måltallet fordelt over hele flaten.
        let spacing = sqrt(area / Float(options.targetCount))
        var rng = Rng(s: options.seed)
        var pts: [SIMD3<Float>] = [], nrms: [SIMD3<Float>] = []
        pts.reserveCapacity(options.targetCount); nrms.reserveCapacity(options.targetCount)

        for t in 0..<triCount {
            let (p0, p1, p2) = triVerts(mesh, t)
            let e1 = p1 - p0, e2 = p2 - p0
            let cr = simd_cross(e1, e2)
            let triArea = simd_length(cr) * 0.5
            guard triArea > 1e-9 else { continue }

            let (n0, n1, n2) = triNormals(mesh, t)
            let faceN = simd_length_squared(cr) > 1e-12 ? simd_normalize(cr) : SIMD3(0, 1, 0)

            // Gitteroppløsning langs hver kant.
            let n1c = max(1, Int((simd_length(e1) / spacing).rounded()))
            let n2c = max(1, Int((simd_length(e2) / spacing).rounded()))
            if n1c == 1 && n2c == 1 {
                // Trekanten er mindre enn ønsket punktavstand. Å gi den ett punkt UANSETT
                // (som var første forsøk) er bare riktig når nettet er grovt: på et tett nett
                // — TSDF-nettet har 1,6M trekanter mot ARKits 303k — blir da hver trekant
                // tildelt nøyaktig ett punkt, og den jevne gitterfordelingen kollapser til
                // samme klumping som ren tilfeldig sampling, med hull og korn som resultat.
                // Riktig er å slippe gjennom med sannsynlighet lik trekantens andel av en
                // gittercelle: forventet tetthet blir den samme, uten å favorisere små flater.
                if rng.next() > triArea / (spacing * spacing) { continue }
                let a: Float = 1.0 / 3, b: Float = 1.0 / 3
                var nv = n0 * (1 - a - b) + n1 * a + n2 * b
                nv = simd_length_squared(nv) > 1e-6 ? simd_normalize(nv) : faceN
                pts.append(p0 + e1 * a + e2 * b); nrms.append(nv)
                continue
            }
            // STRATIFISERT, ikke rent regulært: et perfekt gitter gir moiré — et vevd
            // rutemønster over vegger og gulv som ikke finnes i rommet. Jitter innenfor
            // hver celle bryter mønsteret; ±0.35 av cellen er nok til det uten å åpne
            // hullene som tilfeldig sampling led av. Frøet er fast, så A/B er reproduserbar.
            let jit = options.jitter
            for i in 0..<n1c {
                let a = (Float(i) + 0.5 + (rng.next() - 0.5) * jit) / Float(n1c)
                for j in 0..<n2c {
                    let b = (Float(j) + 0.5 + (rng.next() - 0.5) * jit) / Float(n2c)
                    if a + b > 1 { break }              // utenfor trekanten
                    var nv = n0 * (1 - a - b) + n1 * a + n2 * b
                    // ARKit-normaler kan være snudd (kjent fra baken) — fall tilbake på flatens.
                    nv = simd_length_squared(nv) > 1e-6 ? simd_normalize(nv) : faceN
                    pts.append(p0 + e1 * a + e2 * b); nrms.append(nv)
                }
            }
        }
        return (pts, nrms)
    }

    // MARK: - Projeksjon (identisk konvensjon med MeshBakeV2-scoreren)

    private static func project(_ p: SIMD3<Float>, _ n: SIMD3<Float>,
                                _ c: Cam, twoSided: Bool = false) -> (u: Float, v: Float, score: Float)? {
        let pcam = c.w2c * SIMD4(p, 1)
        if pcam.z > -0.05 { return nil }                    // bak kamera (ARKit ser -z)
        let z = -pcam.z
        let u = c.intr.x * (pcam.x / z) + c.intr.z
        let v = c.intr.y * (-pcam.y / z) + c.intr.w         // bilde-y peker ned
        let margin: Float = 8
        if u < margin || v < margin || u > c.imgW - margin || v > c.imgH - margin { return nil }

        let viewDir = simd_normalize(c.camPos - p)
        let facing0 = simd_dot(n, viewDir)
        let facing = twoSided ? abs(facing0) : facing0
        if facing < 0.15 { return nil }

        var depthEdge = false
        if c.dw > 0 {
            let dx = min(c.dw - 1, max(0, Int(u / c.imgW * Float(c.dw))))
            let dy = min(c.dh - 1, max(0, Int(v / c.imgH * Float(c.dh))))
            let sceneZ = c.depth[dy * c.dw + dx]
            if sceneZ > 0.25 && z > sceneZ + 0.30 { return nil }   // okkludert
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

        let d2 = max(simd_length_squared(c.camPos - p), 0.25)
        var score = facing / d2 * (0.3 + 0.7 * c.quality)
        if depthEdge { score *= 0.05 }
        let bfx = min(u, c.imgW - u) / (c.imgW * 0.12)
        let bfy = min(v, c.imgH - v) / (c.imgH * 0.12)
        score *= 0.3 + 0.7 * min(1, min(bfx, bfy))
        return (u, v, score)
    }

    // MARK: - Småting

    private static func mat4(_ a: [Float]) -> simd_float4x4 {
        simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
    }

    /// Quaternion som roterer lokal +z til `n` — disken legger seg dermed i flaten, med den
    /// tynne aksen (scale_2) langs normalen.
    private static func quatFromZTo(_ n: SIMD3<Float>) -> simd_quatf {
        let z = SIMD3<Float>(0, 0, 1)
        let d = simd_dot(z, n)
        if d > 0.999999 { return simd_quatf(ix: 0, iy: 0, iz: 0, r: 1) }
        if d < -0.999999 { return simd_quatf(ix: 1, iy: 0, iz: 0, r: 0) }  // 180° om x
        let v = simd_cross(z, n)
        return simd_normalize(simd_quatf(ix: v.x, iy: v.y, iz: v.z, r: 1 + d))
    }
}
