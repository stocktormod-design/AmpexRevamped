import Foundation
import Metal
import simd
import CoreVideo

/// LIVE-FUSJON I DELKART (2026-10-27, M1 i docs/PROMPT_OPUS_SKANN_DELKART.md).
///
/// Overlegget og resultatet kommer nå fra SAMME volum og SAMME vektregel. Hvert dybdekart
/// som lagres til disk (5 Hz, `dense-N.f32`) fusjoneres med en gang inn i det aktive
/// delkartet med `ampex_fuse` — den samme kjernen baken bruker, med samme fart-tillit,
/// samme kantfilter og samme trunkering. Dekning ER vekten: en 5 cm-celle er dekket når
/// en voxel i den ligger på flaten (|S| < én voxel) med W ≥ minWeight, altså nøyaktig
/// regelen surface nets bruker for å lage flate der. Dekningsfeltet (CoverageField), som
/// ble malt med en annen vekt og levde sitt eget liv, brukes ikke når dette er på.
///
/// Per dybdekart, i ett løp på `kø`:
///   1. merk blokkene dybdekartet berører (GPU, én tråd per piksel, samme stråle-marsj som
///      `Blokkvolum.allokerFra`), CPU nummererer nye blokker;
///   2. `ampex_integrate_live` over de berørte blokkene og deres allokerte naboer;
///   3. dekningen for cellene i de samme blokkene skrives til en 3D-tekstur (overlegget)
///      og til en delt byte-buffer (veiledningen på CPU).
/// Farge til forhåndsvisningen spres fra kamerabildet i samme takt.
///
/// Fart-tilliten trenger forrige OG neste pose (som `loadDense`), så et dybdekart
/// fusjoneres når det neste kommer — 200 ms bak.
final class MeshDelkartFusjon {
    /// Den som overlegget og veiledningen leser fra. Settes ved start av et skann.
    static var gjeldende: MeshDelkartFusjon?
    static var påslått: Bool { UserDefaults.standard.string(forKey: "meshscan.delkart") != "off" }

    // MARK: Lukkeregel
    static let maksSekunder: Double = 45
    static let maksNøkkelbilder = 120
    static let maksDybdekart = 600
    static let maksPlasser = 64_000_000
    static let maksDelkartIVisning = 8
    /// Kameraets posisjon sist overlegget ble tegnet (til valget av hvilke delkart som vises).
    static var sisteKamera = SIMD3<Float>.zero

    let framesDir: URL
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let kø = DispatchQueue(label: "ampex.delkart.fusjon", qos: .userInitiated)
    private let lås = NSLock()
    private let merkPipe, fusePipe, dekningPipe, fargePipe, tømPipe: MTLComputePipelineState
    private var texCache: CVMetalTextureCache?
    /// Lager et ARAnchor med denne transformen, legger det i sesjonen og gir id-en tilbake.
    /// Kalles på fusjonskøen (presenteren legger det til sesjonen på main). nil på Mac.
    var leggAnker: ((simd_float4x4) -> UUID)?
    /// Kalles på main når listen av delkart i overlegget har endret seg.
    var visningEndret: (() -> Void)?
    /// Kalles på main når et delkart lukkes underveis (ikke ved Ferdig), med delkartets id.
    /// Veiledningen ser da etter trapp uten gulv og vegg som mangler (M3.5, M4.1).
    var delkartLukket: ((Int) -> Void)?

    // Volumet til det aktive delkartet. Gjenbrukes fra delkart til delkart.
    private let indeks: MTLBuffer          // Int32 per blokk, −1 = ikke allokert
    private let merke: MTLBuffer           // UInt8 per blokk, satt av merkekjernen
    private var sumWD: MTLBuffer
    private var sumW: MTLBuffer
    private var koordBuf: MTLBuffer        // int4 per allokert blokk, i allokeringsrekkefølge
    private var plassKapasitet: Int        // i plasser (voxler)
    private var listeBuf: MTLBuffer        // int4: blokkene dette dybdekartet fusjoneres over
    private var koord: [SIMD4<Int32>] = []
    // Dekningen til det aktive delkartet.
    private let celleBuf: MTLBuffer        // UInt8 per celle, delt — veiledningen leser den
    private let fargeBuf: MTLBuffer        // rgba8 per celle
    let aktivTekstur: MTLTexture

    private(set) var aktiv: Delkart?
    private var lukkede: [Delkart] = []
    private var nesteID = 0
    private var ankerTilDelkart: [UUID: Delkart] = [:]

    // Fart-tillit: dybdekartet venter på det neste.
    private struct Kart { let i: Int; let t: Double; let depth: Data; let w: Int; let h: Int; let K: SIMD4<Float>; let c2w: simd_float4x4 }
    private var forrige: Kart?
    private var ventende: Kart?
    private var ventendeDelkart: Delkart?

    private let opts = MeshTsdfBuild.Options()
    private let minWeight: Float
    private let edgeRadius: Int32

    // Måling
    private var tider: [Double] = []
    private var sisteTidslogg: Double = 0
    private var antallFusjonert = 0

    // Okklusjon i overlegget (som CoverageField hadde den).
    private(set) var okklusjon = CoverageField.Okklusjon()
    let lidarTex: MTLTexture?
    /// 1×1×1 tom tekstur til ubrukte plasser i overlegget.
    let tomTekstur: MTLTexture

    init?(framesDir: URL) {
        guard let dev = MTLCreateSystemDefaultDevice(), let q = dev.makeCommandQueue(),
              let fuseLib = try? dev.makeLibrary(source: MeshFuseKernel.msl, options: nil),
              let lib = try? dev.makeLibrary(source: MeshDelkartFusjon.msl, options: nil),
              let fFuse = fuseLib.makeFunction(name: "ampex_integrate_live"),
              let fMerk = lib.makeFunction(name: "delkart_merk"),
              let fDek = lib.makeFunction(name: "delkart_dekning"),
              let fFarge = lib.makeFunction(name: "delkart_farge"),
              let fTøm = lib.makeFunction(name: "delkart_tom"),
              let pFuse = try? dev.makeComputePipelineState(function: fFuse),
              let pMerk = try? dev.makeComputePipelineState(function: fMerk),
              let pDek = try? dev.makeComputePipelineState(function: fDek),
              let pFarge = try? dev.makeComputePipelineState(function: fFarge),
              let pTøm = try? dev.makeComputePipelineState(function: fTøm) else { return nil }
        let bAnt = Int(Delkart.bdim.x * Delkart.bdim.y * Delkart.bdim.z)
        let cAnt = Int(Delkart.celleDim.x * Delkart.celleDim.y * Delkart.celleDim.z)
        let start = 4_000_000
        guard let ix = dev.makeBuffer(length: bAnt * 4, options: .storageModeShared),
              let mk = dev.makeBuffer(length: bAnt, options: .storageModeShared),
              let wd = dev.makeBuffer(length: start * 4, options: .storageModeShared),
              let w = dev.makeBuffer(length: start * 4, options: .storageModeShared),
              let kb = dev.makeBuffer(length: (start / 512) * 16, options: .storageModeShared),
              let lb = dev.makeBuffer(length: 16_384 * 16, options: .storageModeShared),
              let cb = dev.makeBuffer(length: cAnt, options: .storageModeShared),
              let fb = dev.makeBuffer(length: cAnt * 4, options: .storageModePrivate) else { return nil }
        let td = MTLTextureDescriptor()
        td.textureType = .type3D; td.pixelFormat = .rgba8Unorm
        td.width = Int(Delkart.celleDim.x); td.height = Int(Delkart.celleDim.y); td.depth = Int(Delkart.celleDim.z)
        td.usage = [.shaderRead, .shaderWrite]; td.storageMode = .private
        let tt = MTLTextureDescriptor()
        tt.textureType = .type3D; tt.pixelFormat = .rgba8Unorm; tt.width = 1; tt.height = 1; tt.depth = 1
        tt.usage = [.shaderRead]; tt.storageMode = .shared
        guard let tex = dev.makeTexture(descriptor: td), let tom = dev.makeTexture(descriptor: tt) else { return nil }
        tom.replace(region: MTLRegionMake3D(0, 0, 0, 1, 1, 1), mipmapLevel: 0, slice: 0,
                    withBytes: [UInt8](repeating: 0, count: 4), bytesPerRow: 4, bytesPerImage: 4)
        let ld = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r32Float, width: 256, height: 192, mipmapped: false)
        ld.usage = [.shaderRead]; ld.storageMode = .shared
        lidarTex = dev.makeTexture(descriptor: ld)
        device = dev; queue = q
        merkPipe = pMerk; fusePipe = pFuse; dekningPipe = pDek; fargePipe = pFarge; tømPipe = pTøm
        indeks = ix; merke = mk; sumWD = wd; sumW = w; koordBuf = kb; listeBuf = lb
        plassKapasitet = start
        celleBuf = cb; fargeBuf = fb; aktivTekstur = tex; tomTekstur = tom
        self.framesDir = framesDir
        CVMetalTextureCacheCreate(nil, nil, dev, nil, &texCache)
        let d = UserDefaults.standard
        minWeight = Float(d.string(forKey: "meshscan.tsdfminw") ?? "").flatMap { $0 >= 1 ? $0 : nil } ?? opts.minWeight
        edgeRadius = Int32(d.string(forKey: "meshscan.tsdfedge").flatMap { Int($0) } ?? opts.edgeRadius)
        memset(mk.contents(), 0, bAnt)
        nullstillVolum()
    }

    // MARK: - Inngang fra presenteren

    /// Ett dybdekart, akkurat som det ble skrevet til `dense-<i>.f32`. Kalles på main.
    func mottaDybde(i: Int, t: Double, depth: Data, w: Int, h: Int, fx: Float, fy: Float, cx: Float, cy: Float,
                    c2w: simd_float4x4, image: CVPixelBuffer) {
        let k = Kart(i: i, t: t, depth: depth, w: w, h: h, K: SIMD4(fx, fy, cx, cy), c2w: c2w)
        // Kamerabildets planer må tas her — ARKit gjenbruker bufferen.
        let planer = fargeplaner(image)
        let rgbFx = fx * Float(CVPixelBufferGetWidth(image)) / Float(max(w, 1))
        kø.async { [weak self] in self?.behandle(k, planer: planer, rgbFx: rgbFx) }
    }

    /// Et nøkkelbilde er lagret (indeksen i filnavnet). Teller mot lukkeregelen.
    func nøkkelbilde(_ index: Int) {
        kø.async { [weak self] in self?.aktiv?.nøkkelbilder.append(index) }
    }

    /// ARKit har flyttet et anker. Kalles på main.
    func ankerOppdatert(_ id: UUID, _ transform: simd_float4x4) {
        lås.lock(); defer { lås.unlock() }
        guard let d = ankerTilDelkart[id] else { return }
        d.T = transform * d.A0.inverse
    }

    /// LiDAR-dybden i samme ramme, til okklusjonstesten i shaderen. Hver ramme, på main.
    func oppdaterOkklusjon(depth: Data, w: Int, h: Int, fx: Float, fy: Float, cx: Float, cy: Float, c2w: simd_float4x4) {
        guard let tex = lidarTex, w == tex.width, h == tex.height, depth.count >= w * h * 4 else {
            okklusjon.info.z = 0; return
        }
        depth.withUnsafeBytes { tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: w * 4) }
        let margin = Float(MeshBakeV2.flaggTall("meshscan.okkmargin", 0.15))
        okklusjon = CoverageField.Okklusjon(w2c: c2w.inverse, K: SIMD4(fx, fy, cx, cy),
                                            info: SIMD4(Float(w), Float(h), margin > 0 ? 1 : 0, margin),
                                            kamera: SIMD4(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z, 1))
    }

    /// Ferdig: fusjoner det siste ventende kartet, lukk det aktive delkartet og vent til alt
    /// er skrevet. Blokkerer kalleren.
    func avslutt() {
        kø.sync {
            if let v = ventende, let d = ventendeDelkart {
                fusjoner(v, trust: 1, inn: d)   // siste kart: tillit 1, som i `loadDense`
                ventende = nil
            }
            if aktiv != nil { lukkAktivt(tid: forrige?.t ?? 0, grunn: "ferdig") }
            loggTider(tvang: true)
        }
    }

    // MARK: - Overlegget

    /// Uniformene til `delkartFrag`: inntil 8 delkart à { w2d, lo+celle, invExtent+aktiv },
    /// så { antall }. Samme rekkefølge som `teksturer()`. Kalles per ramme fra SceneKit.
    func uniformer(kamera: SIMD3<Float>) -> [Float] {
        MeshDelkartFusjon.sisteKamera = kamera
        let liste = visning(kamera: kamera)
        var u = [Float](); u.reserveCapacity(MeshDelkartFusjon.maksDelkartIVisning * 24 + 4)
        for k in 0..<MeshDelkartFusjon.maksDelkartIVisning {
            if k < liste.count {
                let d = liste[k]
                u += DelkartLager.flat(d.w2d)
                let lo = d.lo + SIMD3<Float>(d.celleLo) * Delkart.celle
                let ext = SIMD3<Float>(d.celleN) * Delkart.celle
                u += [lo.x, lo.y, lo.z, Delkart.celle, 1 / ext.x, 1 / ext.y, 1 / ext.z, 1]
            } else {
                u += [Float](repeating: 0, count: 24)
            }
        }
        u += [Float(liste.count), 0, 0, 0]
        return u
    }

    /// Teksturene i samme rekkefølge som uniformene. Oppdateres av presenteren én gang i
    /// sekundet (SceneKit binder teksturer per materiale, ikke per ramme).
    func teksturer(kamera: SIMD3<Float>) -> [MTLTexture] {
        let liste = visning(kamera: kamera)
        return (0..<MeshDelkartFusjon.maksDelkartIVisning).map { k in
            k < liste.count ? (liste[k].tekstur ?? tomTekstur) : tomTekstur
        }
    }

    private var visningsListe: [Delkart] = []
    private var visningsTid: CFAbsoluteTime = 0
    /// Det aktive pluss de sju nærmeste lukkede, målt fra kameraet. Listen holdes fast i ett
    /// sekund så uniformene og teksturene ikke kommer i utakt mellom to oppdateringer.
    private func visning(kamera: SIMD3<Float>) -> [Delkart] {
        lås.lock(); defer { lås.unlock() }
        let nå = CFAbsoluteTimeGetCurrent()
        if nå - visningsTid < 1, !visningsListe.isEmpty { return visningsListe }
        visningsTid = nå
        var l: [Delkart] = []
        if let a = aktiv, a.tekstur != nil { l.append(a) }
        let nære = lukkede.filter { $0.tekstur != nil }.sorted {
            simd_distance(($0.T * SIMD4($0.origo, 1)).xyz, kamera) < simd_distance(($1.T * SIMD4($1.origo, 1)).xyz, kamera)
        }
        l += nære.prefix(MeshDelkartFusjon.maksDelkartIVisning - l.count)
        if l.map(\.id) != visningsListe.map(\.id) {
            DispatchQueue.main.async { [weak self] in self?.visningEndret?() }
        }
        visningsListe = l
        return l
    }

    // MARK: - Veiledningen (CPU)

    /// Ett øyeblikksbilde av dekningen for ett helt pass. Låsen tas ÉN gang her, ikke per
    /// oppslag: med fem delkart og fire tapper per celle ble lås + løkke per punkt det som
    /// gjorde dekningspasset 3× tregere enn før M1 (telefon 27.10: 21 → 67 ms snitt etter
    /// 100 pass, over 300 ms per pass mot slutten).
    struct Oppslag {
        fileprivate struct Del {
            let w2d: simd_float4x4, lo: SIMD3<Float>, cLo: SIMD3<Float>, n: SIMD3<Float>, nx: Int, ny: Int
            let celler: [UInt8]                 // lukket: egen kopi (CoW, ingen kopiering)
            let aktiv: UnsafePointer<UInt8>?    // aktivt: den delte bufferen (GPU skriver, bytes er atomiske nok)
        }
        fileprivate let deler: [Del]
        private static let tapper: [Float] = [0, 1, -1, 2]

        /// Dekning 0…1 i punktet (verden), største over alle delkart. Nærmeste celle.
        func dekning(_ p: SIMD3<Float>) -> Float {
            var best: UInt8 = 0
            for d in deler {
                let q = (d.w2d * SIMD4(p, 1)).xyz
                // Sjekk i flyttall FØR Int: et NaN-punkt eller -normal fra ARKit-nettet krasjet
                // konverteringen (telefon 27.10, to ganger i første sekund av skannet).
                let f = ((q - d.lo) / Delkart.celle).rounded(.down) - d.cLo
                guard all(f .>= 0), all(f .< d.n) else { continue }   // NaN feiler begge
                let i = (Int(f.z) * d.ny + Int(f.y)) * d.nx + Int(f.x)
                best = max(best, d.aktiv?[i] ?? d.celler[i])
                if best == 255 { return 1 }
            }
            return Float(best) / 255
        }

        /// Er flaten i p dekket? Samme tapper langs normalen som shaderen (0, +1, −1, +2 celler,
        /// normalen vendt mot kameraet), så veiledningen og overlegget sier det samme.
        func dekket(_ p: SIMD3<Float>, normal n: SIMD3<Float>, kamera: SIMD3<Float>) -> Bool {
            let nn = simd_dot(n, kamera - p) < 0 ? -n : n
            for s in Oppslag.tapper where dekning(p + nn * (s * Delkart.celle)) >= 0.999 { return true }
            return false
        }
    }

    func oppslag() -> Oppslag {
        lås.lock(); defer { lås.unlock() }
        var deler: [Oppslag.Del] = []
        if let a = aktiv {
            let n = Delkart.celleDim
            deler.append(.init(w2d: a.w2d, lo: a.lo, cLo: .zero, n: SIMD3<Float>(n), nx: Int(n.x), ny: Int(n.y),
                               celler: [], aktiv: UnsafePointer(celleBuf.contents().assumingMemoryBound(to: UInt8.self))))
        }
        for d in lukkede where !d.celler.isEmpty {
            deler.append(.init(w2d: d.w2d, lo: d.lo, cLo: SIMD3<Float>(d.celleLo), n: SIMD3<Float>(d.celleN),
                               nx: Int(d.celleN.x), ny: Int(d.celleN.y), celler: d.celler, aktiv: nil))
        }
        return Oppslag(deler: deler)
    }

    /// Finnes det noen dekning i det hele tatt (erstatter `!doneCells.isEmpty`)?
    var harDekning: Bool { lås.lock(); defer { lås.unlock() }; return !lukkede.isEmpty || antallFusjonert > 0 }

    // MARK: - M0b-dumpen fra delkartene

    /// `dekning-ferdig.bin` i samme format som `CoverageField.dumpFerdig`, men fra W: et
    /// verdensrutenett à 5 cm over alle delkart, største dekning per celle. Terskel 0,999
    /// (c = 1 betyr dekket). Kalles etter `avslutt`.
    func dumpFerdig(til url: URL) {
        lås.lock()
        let alle = lukkede
        lås.unlock()
        guard !alle.isEmpty else { return }
        var bMin = SIMD3<Float>(repeating: .greatestFiniteMagnitude), bMax = -bMin
        for d in alle {
            let a = d.lo + SIMD3<Float>(d.celleLo) * Delkart.celle
            let b = a + SIMD3<Float>(d.celleN) * Delkart.celle
            for k in 0..<8 {
                let hj = SIMD3<Float>(k & 1 == 0 ? a.x : b.x, k & 2 == 0 ? a.y : b.y, k & 4 == 0 ? a.z : b.z)
                let w = (d.T * SIMD4(hj, 1)).xyz
                bMin = simd_min(bMin, w); bMax = simd_max(bMax, w)
            }
        }
        let c = Delkart.celle
        let o = (bMin / c).rounded(.down) * c
        let n = SIMD3<Int>(((bMax - o) / c).rounded(.up))
        guard n.x > 0, n.y > 0, n.z > 0, n.x * n.y * n.z < 400_000_000 else { return }
        var tett = [UInt8](repeating: 0, count: n.x * n.y * n.z)
        tett.withUnsafeMutableBufferPointer { ut in
            DispatchQueue.concurrentPerform(iterations: n.z) { z in
                for y in 0..<n.y { for x in 0..<n.x {
                    let p = o + (SIMD3<Float>(Float(x), Float(y), Float(z)) + 0.5) * c
                    var best: UInt8 = 0
                    for d in alle where !d.celler.isEmpty {
                        let v = d.celler.withUnsafeBufferPointer { b -> UInt8 in
                            let q = (d.w2d * SIMD4(p, 1)).xyz
                            let f = ((q - d.lo) / c).rounded(.down) - SIMD3<Float>(d.celleLo)
                            guard all(f .>= 0), all(f .< SIMD3<Float>(d.celleN)) else { return 0 }
                            let ci = SIMD3<Int32>(f)
                            return b[(Int(ci.z) * Int(d.celleN.y) + Int(ci.y)) * Int(d.celleN.x) + Int(ci.x)]
                        }
                        best = max(best, v)
                    }
                    ut[(z * n.y + y) * n.x + x] = best
                } }
            }
        }
        var hode = Data()
        for i in [Int32(n.x), Int32(n.y), Int32(n.z), 0] { withUnsafeBytes(of: i.littleEndian) { hode.append(contentsOf: $0) } }
        for f in [o.x, o.y, o.z, c, Float(0.999)] { withUnsafeBytes(of: f.bitPattern.littleEndian) { hode.append(contentsOf: $0) } }
        hode.append(contentsOf: tett)
        do {
            try hode.write(to: url, options: .atomic)
            MeshLog.log(String(format: "overlegg — dekning-ferdig.bin fra %d delkart: %d×%d×%d celler, %d dekket",
                               alle.count, n.x, n.y, n.z, tett.reduce(0) { $0 + ($1 == 255 ? 1 : 0) }))
        } catch {
            MeshLog.log("overlegg — dekning-ferdig.bin kunne ikke skrives: \(error.localizedDescription)")
        }
    }

    /// Ankrenes flytting ved Ferdig (det som var M0a, nå på delkartenes egne ankere).
    func ankerSum() {
        lås.lock(); let alle = lukkede + (aktiv.map { [$0] } ?? []); lås.unlock()
        guard !alle.isEmpty else { return }
        var mm: [Float] = [], grader: [Float] = []
        for d in alle {
            // Hvor langt delkartets origo er flyttet (T = identitet om ankeret står stille).
            mm.append(simd_distance((d.T * SIMD4(d.origo, 1)).xyz, d.origo) * 1000)
            let tr = d.T.columns.0.x + d.T.columns.1.y + d.T.columns.2.z
            grader.append(acos(max(-1, min(1, (tr - 1) / 2))) * 180 / .pi)
        }
        MeshLog.log(String(format: "anker — %d delkart, størst flyttet %.0f mm / %.2f° (T = A_nå·A₀⁻¹ ved Ferdig)",
                           alle.count, mm.max() ?? 0, grader.max() ?? 0))
    }

    // MARK: - Løpet per dybdekart (på `kø`)

    private func behandle(_ k: Kart, planer: (MTLTexture, MTLTexture, CVMetalTexture, CVMetalTexture)?, rgbFx: Float) {
        // 1. Det ventende kartet har nå en nabo på hver side: tillit som i `loadDense`.
        if let v = ventende, let d = ventendeDelkart {
            let trust: Float
            if let f = forrige {
                let dt = Float(max(0.08, min(2.0, k.t - f.t)))
                let lin = simd_distance(f.c2w.columns.3.xyz, k.c2w.columns.3.xyz) / dt
                let f0 = simd_normalize(-f.c2w.columns.2.xyz), f1 = simd_normalize(-k.c2w.columns.2.xyz)
                let rot = acos(max(-1, min(1, simd_dot(f0, f1)))) / dt
                trust = MeshDelkartFusjon.trustForMotion(lin, rot, opts.maxVelocity)
            } else {
                trust = 1   // første kart: tillit 1, som i `loadDense`
            }
            if trust > 0 { fusjoner(v, trust: trust, inn: d) }
        }
        forrige = ventende
        ventende = nil; ventendeDelkart = nil

        // 2. Lukkeregelen, målt på det nye kartets kamera.
        if let a = aktiv {
            let kam = (a.w2d * SIMD4(k.c2w.columns.3.xyz, 1)).xyz
            let utenfor = simd_max(a.lo - kam, kam - (a.lo + a.utstrekning))
            var grunn: String?
            if utenfor.max() > 1 { grunn = "kameraet utenfor" }
            else if k.t - a.åpnet >= MeshDelkartFusjon.maksSekunder { grunn = "45 s" }
            else if a.nøkkelbilder.count >= MeshDelkartFusjon.maksNøkkelbilder { grunn = "120 bilder" }
            else if a.dybdekart.count >= MeshDelkartFusjon.maksDybdekart { grunn = "600 dybdekart" }
            else if koord.count * 512 >= MeshDelkartFusjon.maksPlasser { grunn = "64 M plasser" }
            if let g = grunn { lukkAktivt(tid: k.t, grunn: g) }
        }
        if aktiv == nil { åpne(c2w: k.c2w, tid: k.t) }
        guard let a = aktiv else { return }
        a.dybdekart.append(k.i)
        ventende = k
        ventendeDelkart = a

        // 3. Farge til forhåndsvisningen fra dette bildet (trenger ingen tillit).
        if let pl = planer { farge(k, inn: a, y: pl.0, cbcr: pl.1, holdt: (pl.2, pl.3), rgbFx: rgbFx) }
    }

    private static func trustForMotion(_ lin: Float, _ rot: Float, _ maxVel: Float) -> Float {
        // Kopi av MeshTsdfBuild.trustForMotion — samme regel live som i baken.
        guard maxVel > 0 else { return 1 }
        let worst = max(lin / maxVel, rot / (maxVel * 1.5))
        if worst <= 1 { return 1 }
        if worst >= 2 { return 0 }
        return max(0.15, 1 - (worst - 1))
    }

    private func åpne(c2w: simd_float4x4, tid: Double) {
        let b = Float(8) * Delkart.vox
        let kam = c2w.columns.3.xyz
        let origo = (kam / b).rounded(.toNearestOrAwayFromZero) * b
        var A0 = matrix_identity_float4x4
        A0.columns.3 = SIMD4(origo, 1)
        let ankerID = leggAnker?(A0) ?? UUID()
        let d = Delkart(id: nesteID, ankerID: ankerID, A0: A0, lo: origo - Delkart.kameraIVolumet, åpnet: tid)
        nesteID += 1
        d.tekstur = aktivTekstur
        nullstillVolum()
        lås.lock()
        aktiv = d
        ankerTilDelkart[ankerID] = d
        visningsTid = 0
        lås.unlock()
        MeshLog.log(String(format: "delkart — %d åpnet ved (%.1f, %.1f, %.1f)", d.id, origo.x, origo.y, origo.z))
    }

    /// Tømmer volumet, merkene, dekningen og fargen til et nytt delkart.
    private func nullstillVolum() {
        let bAnt = Int(Delkart.bdim.x * Delkart.bdim.y * Delkart.bdim.z)
        memset(indeks.contents(), 0xFF, bAnt * 4)         // −1
        let brukt = koord.count * 512 * 4
        if brukt > 0 { memset(sumWD.contents(), 0, brukt); memset(sumW.contents(), 0, brukt) }
        koord.removeAll(keepingCapacity: true)
        memset(celleBuf.contents(), 0, celleBuf.length)
        guard let cb = queue.makeCommandBuffer() else { return }
        if let blit = cb.makeBlitCommandEncoder() {
            blit.fill(buffer: fargeBuf, range: 0..<fargeBuf.length, value: 0)
            blit.endEncoding()
        }
        if let enc = cb.makeComputeCommandEncoder() {
            enc.setComputePipelineState(tømPipe)
            enc.setTexture(aktivTekstur, index: 0)
            enc.dispatchThreads(MTLSize(width: Int(Delkart.celleDim.x), height: Int(Delkart.celleDim.y), depth: Int(Delkart.celleDim.z)),
                                threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 4))
            enc.endEncoding()
        }
        cb.commit(); cb.waitUntilCompleted()
    }

    /// Kamera → delkartets koordinater (T⁻¹ · c2w), så ARKits retting av ankeret også
    /// gjelder kart som kommer etter rettingen.
    private func c2wI(_ d: Delkart, _ c2w: simd_float4x4) -> simd_float4x4 {
        lås.lock(); defer { lås.unlock() }
        return d.T.inverse * c2w
    }

    private struct MerkP {
        var c2w: simd_float4x4
        var lo: SIMD3<Float>; var vox: Float
        var bdim: SIMD3<Int32>; var trunc: Float
        var truncBehind: Float; var fx: Float, fy: Float, cx: Float
        var cy: Float; var dw: Int32, dh: Int32; var steg: Int32
    }
    private struct DekP {
        var lo: SIMD3<Float>; var vox: Float
        var dims: SIMD3<Int32>; var celle: Float
        var bdim: SIMD3<Int32>; var minW: Float
        var cdim: SIMD3<Int32>; var sGrense: Float
        var antall: UInt32, a: UInt32 = 0, b: UInt32 = 0, c: UInt32 = 0
    }

    private func fusjoner(_ k: Kart, trust: Float, inn d: Delkart) {
        // Et kart fra et delkart som alt er lukket (det ventet da lukkeregelen slo til)
        // fusjoneres før lukkingen i `lukkAktivt`; her skal det bare være det aktive.
        guard d === aktiv else { return }
        let t0 = CFAbsoluteTimeGetCurrent()
        let c2w = c2wI(d, k.c2w)
        let trunc = Delkart.vox * opts.truncVoxels
        let truncBehind = Delkart.vox * min(opts.truncBehindVoxels, opts.truncVoxels)
        guard let dBuf = k.depth.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: k.depth.count, options: .storageModeShared) })
        else { return }

        // 1. Merk blokkene (samme stråle-marsj som `Blokkvolum.allokerFra`).
        var mp = MerkP(c2w: c2w, lo: d.lo, vox: Delkart.vox, bdim: Delkart.bdim, trunc: trunc,
                       truncBehind: truncBehind, fx: k.K.x, fy: k.K.y, cx: k.K.z, cy: k.K.w,
                       dw: Int32(k.w), dh: Int32(k.h),
                       steg: Int32(max(1, Int((trunc + truncBehind) / (Delkart.vox * 2)) + 1)))
        guard let cb1 = queue.makeCommandBuffer(), let e1 = cb1.makeComputeCommandEncoder() else { return }
        e1.setComputePipelineState(merkPipe)
        e1.setBuffer(dBuf, offset: 0, index: 0)
        e1.setBuffer(merke, offset: 0, index: 1)
        e1.setBytes(&mp, length: MemoryLayout<MerkP>.stride, index: 2)
        e1.dispatchThreads(MTLSize(width: k.w, height: k.h, depth: 1), threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
        e1.endEncoding()
        cb1.commit(); cb1.waitUntilCompleted()

        // 2. Nummerer nye blokker, bygg lista: merkede + allokerte 6-naboer (en voxel nær
        // blokkgrensen kan ligge i naboblokken; baken har den allokert fra andre kart).
        let bd = Delkart.bdim
        let bAnt = Int(bd.x * bd.y * bd.z)
        let mk = merke.contents().assumingMemoryBound(to: UInt8.self)
        let ix = indeks.contents().assumingMemoryBound(to: Int32.self)
        var merket: [Int] = []
        for i in 0..<bAnt where mk[i] != 0 { merket.append(i); mk[i] = 0 }
        guard !merket.isEmpty else { return }
        var nye = 0
        for i in merket where ix[i] < 0 {
            if (koord.count + 1) * 512 > plassKapasitet, !vokse() { break }
            let bx = Int32(i % Int(bd.x)), by = Int32((i / Int(bd.x)) % Int(bd.y)), bz = Int32(i / (Int(bd.x) * Int(bd.y)))
            ix[i] = Int32(koord.count)
            koord.append(SIMD4(bx, by, bz, Int32(koord.count)))
            nye += 1
        }
        if nye > 0 {
            koord.withUnsafeBytes { src in
                (koordBuf.contents() + (koord.count - nye) * 16).copyMemory(from: src.baseAddress! + (koord.count - nye) * 16, byteCount: nye * 16)
            }
        }
        var liste: [SIMD4<Int32>] = []
        liste.reserveCapacity(merket.count * 2)
        var iListe = Set<Int>()
        func legg(_ i: Int) {
            guard ix[i] >= 0, iListe.insert(i).inserted else { return }
            liste.append(koord[Int(ix[i])])
        }
        let sx = 1, sy = Int(bd.x), sz = Int(bd.x * bd.y)
        for i in merket {
            legg(i)
            let x = i % Int(bd.x), y = (i / Int(bd.x)) % Int(bd.y), z = i / sz
            if x > 0 { legg(i - sx) }; if x < Int(bd.x) - 1 { legg(i + sx) }
            if y > 0 { legg(i - sy) }; if y < Int(bd.y) - 1 { legg(i + sy) }
            if z > 0 { legg(i - sz) }; if z < Int(bd.z) - 1 { legg(i + sz) }
        }
        guard !liste.isEmpty else { return }
        if liste.count * 16 > listeBuf.length {
            guard let nb = device.makeBuffer(length: liste.count * 32, options: .storageModeShared) else { return }
            listeBuf = nb
        }
        liste.withUnsafeBytes { listeBuf.contents().copyMemory(from: $0.baseAddress!, byteCount: $0.count) }

        // 3. Fusjon og dekning i ett kommandobuffer.
        var P = MeshFuseKernel.Params(w2c: c2w.inverse, lo: d.lo, voxel: Delkart.vox,
                                      dims: Delkart.dim, trunc: trunc,
                                      truncBehind: truncBehind, fx: k.K.x, fy: k.K.y, cx: k.K.z,
                                      cy: k.K.w, dw: Int32(k.w), dh: Int32(k.h), wf0: trust,
                                      edgeRadius: edgeRadius, jbuScale: 1, p0: -1, p1: 0)
        var n = UInt32(liste.count)
        guard let cb = queue.makeCommandBuffer(), let e2 = cb.makeComputeCommandEncoder() else { return }
        e2.setComputePipelineState(fusePipe)
        e2.setBuffer(sumWD, offset: 0, index: 0)
        e2.setBuffer(sumW, offset: 0, index: 1)
        e2.setBuffer(dBuf, offset: 0, index: 2)
        e2.setBytes(&P, length: MemoryLayout<MeshFuseKernel.Params>.stride, index: 3)
        e2.setBuffer(listeBuf, offset: 0, index: 4)
        e2.setBytes(&n, length: 4, index: 5)
        e2.dispatchThreads(MTLSize(width: liste.count * 512, height: 1, depth: 1),
                           threadsPerThreadgroup: MTLSize(width: min(fusePipe.maxTotalThreadsPerThreadgroup, 256), height: 1, depth: 1))
        e2.endEncoding()
        var dp = DekP(lo: d.lo, vox: Delkart.vox, dims: Delkart.dim, celle: Delkart.celle, bdim: bd,
                      minW: minWeight, cdim: Delkart.celleDim, sGrense: 1 / opts.truncVoxels, antall: n)
        if let e3 = cb.makeComputeCommandEncoder() {
            e3.setComputePipelineState(dekningPipe)
            e3.setBuffer(sumWD, offset: 0, index: 0)
            e3.setBuffer(sumW, offset: 0, index: 1)
            e3.setBuffer(indeks, offset: 0, index: 2)
            e3.setBuffer(listeBuf, offset: 0, index: 3)
            e3.setBuffer(fargeBuf, offset: 0, index: 4)
            e3.setBuffer(celleBuf, offset: 0, index: 5)
            e3.setBytes(&dp, length: MemoryLayout<DekP>.stride, index: 6)
            e3.setTexture(aktivTekstur, index: 0)
            e3.dispatchThreads(MTLSize(width: liste.count * 64, height: 1, depth: 1),
                               threadsPerThreadgroup: MTLSize(width: 64, height: 1, depth: 1))
            e3.endEncoding()
        }
        cb.commit(); cb.waitUntilCompleted()
        antallFusjonert += 1
        tider.append(CFAbsoluteTimeGetCurrent() - t0)
        loggTider(tvang: false)
    }

    /// Dobler volumbufferne. Taket er 64 M plasser; nås det, lukkes delkartet (det er en
    /// størrelsesgrense, ikke en kvalitetsgrense — neste delkart fortsetter).
    private func vokse() -> Bool {
        let ny = plassKapasitet * 2
        guard ny <= MeshDelkartFusjon.maksPlasser,
              let wd = device.makeBuffer(length: ny * 4, options: .storageModeShared),
              let w = device.makeBuffer(length: ny * 4, options: .storageModeShared),
              let kb = device.makeBuffer(length: (ny / 512) * 16, options: .storageModeShared) else { return false }
        let brukt = koord.count * 512 * 4
        wd.contents().copyMemory(from: sumWD.contents(), byteCount: brukt)
        w.contents().copyMemory(from: sumW.contents(), byteCount: brukt)
        memset(wd.contents() + brukt, 0, ny * 4 - brukt)
        memset(w.contents() + brukt, 0, ny * 4 - brukt)
        kb.contents().copyMemory(from: koordBuf.contents(), byteCount: koord.count * 16)
        sumWD = wd; sumW = w; koordBuf = kb
        plassKapasitet = ny
        MeshLog.log("delkart — volumet vokste til \(ny / 1_000_000) M plasser (\((ny * 8) >> 20) MB)")
        return true
    }

    private func lukkAktivt(tid: Double, grunn: String) {
        guard let d = aktiv else { return }
        // Vanligvis er det ventende kartet alt fusjonert i `behandle` før lukkeregelen
        // slår til; dette fanger bare et kart som fortsatt venter.
        if let v = ventende, ventendeDelkart === d {
            fusjoner(v, trust: 1, inn: d)
            ventende = nil; ventendeDelkart = nil
        }
        d.lukket = tid
        d.antallBlokker = koord.count
        // Beskjær dekningen til de allokerte blokkenes boks, i celler.
        var bMin = SIMD3<Int32>(repeating: .max), bMax = SIMD3<Int32>(repeating: .min)
        for k in koord { let b = SIMD3(k.x, k.y, k.z); bMin = simd_min(bMin, b); bMax = simd_max(bMax, b) }
        var cLo = SIMD3<Int32>(0, 0, 0), cN = SIMD3<Int32>(1, 1, 1)
        if !koord.isEmpty {
            let r = Delkart.vox / Delkart.celle
            let v0 = SIMD3<Float>(bMin &* 8) * r, v1 = SIMD3<Float>((bMax &+ 1) &* 8) * r
            cLo = simd_max(SIMD3<Int32>(v0.rounded(.down)), .zero)
            let cHi = simd_min(SIMD3<Int32>(v1.rounded(.up)), Delkart.celleDim)
            cN = simd_max(cHi &- cLo, SIMD3<Int32>(1, 1, 1))
        }
        let td = MTLTextureDescriptor()
        td.textureType = .type3D; td.pixelFormat = .rgba8Unorm
        td.width = Int(cN.x); td.height = Int(cN.y); td.depth = Int(cN.z)
        td.usage = [.shaderRead]; td.storageMode = .private
        let tex = device.makeTexture(descriptor: td)
        if let tex, let cb = queue.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() {
            blit.copy(from: aktivTekstur, sourceSlice: 0, sourceLevel: 0,
                      sourceOrigin: MTLOrigin(x: Int(cLo.x), y: Int(cLo.y), z: Int(cLo.z)),
                      sourceSize: MTLSize(width: Int(cN.x), height: Int(cN.y), depth: Int(cN.z)),
                      to: tex, destinationSlice: 0, destinationLevel: 0, destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
            blit.endEncoding()
            cb.commit(); cb.waitUntilCompleted()
        }
        var celler = [UInt8](repeating: 0, count: Int(cN.x * cN.y * cN.z))
        let src = celleBuf.contents().assumingMemoryBound(to: UInt8.self)
        let D = Delkart.celleDim
        for z in 0..<Int(cN.z) { for y in 0..<Int(cN.y) {
            let s = ((Int(cLo.z) + z) * Int(D.y) + Int(cLo.y) + y) * Int(D.x) + Int(cLo.x)
            let t = (z * Int(cN.y) + y) * Int(cN.x)
            for x in 0..<Int(cN.x) { celler[t + x] = src[s + x] }
        } }
        d.celleLo = cLo; d.celleN = cN
        var mb = 0
        do {
            mb = try DelkartLager.skriv(d, framesDir: framesDir, koord: koordBuf.contents(),
                                        sumWD: sumWD.contents(), sumW: sumW.contents()) >> 20
        } catch {
            MeshLog.log("delkart — \(d.id) kunne ikke skrives: \(error.localizedDescription)")
        }
        lås.lock()
        d.tekstur = tex
        d.celler = celler
        d.tilstand = .lukket
        lukkede.append(d)
        aktiv = nil
        visningsTid = 0
        lås.unlock()
        let dekket = celler.reduce(0) { $0 + ($1 == 255 ? 1 : 0) }
        if grunn != "ferdig" {
            let id = d.id
            DispatchQueue.main.async { [weak self] in self?.delkartLukket?(id) }
        }
        MeshLog.log("delkart — \(d.id) lukket (\(grunn)): \(d.antallBlokker) blokker, \(d.dybdekart.count) dybdekart, \(d.nøkkelbilder.count) bilder, \(mb) MB på disk, \(dekket) celler dekket, tekstur \(cN.x)×\(cN.y)×\(cN.z)")
    }

    private func loggTider(tvang: Bool) {
        let nå = CFAbsoluteTimeGetCurrent()
        guard !tider.isEmpty, tvang || nå - sisteTidslogg >= 60 else { return }
        sisteTidslogg = nå
        let s = tider.sorted()
        MeshLog.log(String(format: "delkart — fusjon per dybdekart p50 %.1f ms, p95 %.1f ms over %d kart; %d blokker (%d MB volum)",
                           s[s.count / 2] * 1000, s[min(s.count - 1, s.count * 95 / 100)] * 1000, s.count,
                           koord.count, (plassKapasitet * 8) >> 20))
        tider.removeAll(keepingCapacity: true)
    }

    // MARK: - Farge

    private func fargeplaner(_ image: CVPixelBuffer) -> (MTLTexture, MTLTexture, CVMetalTexture, CVMetalTexture)? {
        guard let cache = texCache else { return nil }
        func plane(_ i: Int, _ fmt: MTLPixelFormat) -> (MTLTexture, CVMetalTexture)? {
            var cvt: CVMetalTexture?
            let pw = CVPixelBufferGetWidthOfPlane(image, i), ph = CVPixelBufferGetHeightOfPlane(image, i)
            guard CVMetalTextureCacheCreateTextureFromImage(nil, cache, image, nil, fmt, pw, ph, i, &cvt) == kCVReturnSuccess,
                  let t = cvt, let m = CVMetalTextureGetTexture(t) else { return nil }
            return (m, t)
        }
        guard let y = plane(0, .r8Unorm), let c = plane(1, .rg8Unorm) else { return nil }
        return (y.0, c.0, y.1, c.1)
    }

    private struct FargeP {
        var c2w: simd_float4x4
        var lo: SIMD3<Float>; var celle: Float
        var cdim: SIMD3<Int32>; var fx: Float
        var fy: Float, cx: Float, cy: Float; var dw: Int32
        var dh: Int32, a: Int32 = 0, b: Int32 = 0, c: Int32 = 0
    }

    private func farge(_ k: Kart, inn d: Delkart, y: MTLTexture, cbcr: MTLTexture,
                       holdt: (CVMetalTexture, CVMetalTexture), rgbFx: Float) {
        guard let dBuf = k.depth.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: k.depth.count, options: .storageModeShared) }),
              let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return }
        var p = FargeP(c2w: c2wI(d, k.c2w), lo: d.lo, celle: Delkart.celle, cdim: Delkart.celleDim,
                       fx: k.K.x, fy: k.K.y, cx: k.K.z, cy: k.K.w, dw: Int32(k.w), dh: Int32(k.h))
        enc.setComputePipelineState(fargePipe)
        enc.setBuffer(dBuf, offset: 0, index: 0)
        enc.setBuffer(fargeBuf, offset: 0, index: 1)
        enc.setBytes(&p, length: MemoryLayout<FargeP>.stride, index: 2)
        enc.setTexture(y, index: 0)
        enc.setTexture(cbcr, index: 1)
        enc.dispatchThreads(MTLSize(width: k.w, height: k.h, depth: 1), threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
        enc.endEncoding()
        cb.addCompletedHandler { _ in _ = holdt }   // kamerabildet lever til GPU-en er ferdig
        cb.commit()
    }

    // MARK: - Kjernene

    static let msl = """
    #include <metal_stdlib>
    using namespace metal;
    struct MerkP {
        float4x4 c2w;
        float3 lo; float vox;
        int3 bdim; float trunc;
        float truncBehind; float fx, fy, cx;
        float cy; int dw, dh; int steg;
    };
    // Blokkene dybdekartet berører — samme stråle-marsj som Blokkvolum.allokerFra: fra
    // truncBehind bak flaten til trunc foran, i steg på to voxler, uten kantfilter.
    // int() kutter mot null som Swifts Int(), så samme blokk velges ved nedre kant.
    kernel void delkart_merk(device const float* depth [[buffer(0)]],
                             device uchar* merke [[buffer(1)]],
                             constant MerkP& p [[buffer(2)]],
                             uint2 gid [[thread_position_in_grid]]) {
        int x = gid.x, y = gid.y;
        if (x < 1 || y < 1 || x >= p.dw - 1 || y >= p.dh - 1) return;
        float z = depth[y * p.dw + x];
        if (!(z > 0.3 && z < 5.0)) return;
        float3 pc = float3((float(x) - p.cx) / p.fx, -(float(y) - p.cy) / p.fy, -1.0);
        float3 raw = (p.c2w * float4(pc, 0.0)).xyz;
        float len = length(raw);
        if (len <= 1e-6) return;
        float3 dir = raw / len;
        float3 org = p.c2w[3].xyz;
        float3 flate = org + dir * (z * len);
        float steg = p.vox * 2.0, bvox = p.vox * 8.0;
        for (int k = 0; k <= p.steg; k++) {
            float d = -p.truncBehind + float(k) * steg;
            if (d > p.trunc) break;
            float3 q = flate + dir * d;
            int bx = int((q.x - p.lo.x) / bvox), by = int((q.y - p.lo.y) / bvox), bz = int((q.z - p.lo.z) / bvox);
            if (bx < 0 || by < 0 || bz < 0 || bx >= p.bdim.x || by >= p.bdim.y || bz >= p.bdim.z) continue;
            merke[(bz * p.bdim.y + by) * p.bdim.x + bx] = 1;
        }
    }
    struct DekP {
        float3 lo; float vox;
        int3 dims; float celle;
        int3 bdim; float minW;
        int3 cdim; float sGrense;
        uint antall, a, b, c;
    };
    // Dekning per 5 cm-celle = største W blant voxlene med sentrum i cellen som ligger PÅ
    // flaten (|S| < én voxel), delt på minWeight og klemt til 1. Én tråd per (blokk, celle
    // i et 4³-vindu): cellene som overlapper blokken. En celle som ligger i to blokker regnes
    // av begge, fra alle sine voxler — samme svar, så kappløpet er ufarlig.
    kernel void delkart_dekning(device const float* sumWD [[buffer(0)]],
                                device const float* sumW  [[buffer(1)]],
                                device const int* indeks  [[buffer(2)]],
                                device const int4* blocks [[buffer(3)]],
                                device const uint* farge  [[buffer(4)]],
                                device uchar* celler      [[buffer(5)]],
                                constant DekP& p          [[buffer(6)]],
                                texture3d<float, access::write> tex [[texture(0)]],
                                uint gid [[thread_position_in_grid]]) {
        uint b = gid >> 6, k = gid & 63u;
        if (b >= p.antall) return;
        int3 bc = blocks[b].xyz;
        float r = p.celle / p.vox;                       // 2,5 voxler per celle
        int3 v0 = bc * 8;
        int3 c0 = int3(floor(float3(v0) / r));
        int3 ci = c0 + int3(int(k & 3u), int((k >> 2) & 3u), int(k >> 4));
        if (any(ci < 0) || any(ci >= p.cdim)) return;
        if (any(float3(ci) * r >= float3(v0 + 8))) return; // cellen begynner etter blokken
        int3 j0 = int3(ceil(float3(ci) * r - 0.5));
        int3 j1 = int3(ceil(float3(ci + 1) * r - 0.5));
        float best = 0.0;
        for (int z = j0.z; z < j1.z; z++) for (int y = j0.y; y < j1.y; y++) for (int x = j0.x; x < j1.x; x++) {
            if (x < 0 || y < 0 || z < 0 || x >= p.dims.x || y >= p.dims.y || z >= p.dims.z) continue;
            int bi = indeks[((z >> 3) * p.bdim.y + (y >> 3)) * p.bdim.x + (x >> 3)];
            if (bi < 0) continue;
            uint s = uint(bi) * 512u + uint(((z & 7) << 6) | ((y & 7) << 3) | (x & 7));
            float w = sumW[s];
            if (w <= 0.0) continue;
            if (fabs(sumWD[s] / w) < p.sGrense) best = max(best, w);
        }
        float c = clamp(best / p.minW, 0.0, 1.0);
        uint idx = uint((ci.z * p.cdim.y + ci.y) * p.cdim.x + ci.x);
        celler[idx] = uchar(c * 255.0 + 0.5);
        float4 f = unpack_unorm4x8_to_float(farge[idx]);
        tex.write(float4(f.rgb, c), uint3(ci));
    }
    struct FargeP {
        float4x4 c2w;
        float3 lo; float celle;
        int3 cdim; float fx;
        float fy, cx, cy; int dw;
        int dh, a, b, c;
    };
    constant float4x4 ycbcrToRGB = float4x4(float4( 1.0000,  1.0000, 1.0000, 0.0),
                                            float4( 0.0000, -0.3441, 1.7720, 0.0),
                                            float4( 1.4020, -0.7141, 0.0000, 0.0),
                                            float4(-0.7010,  0.5291,-0.8860, 1.0));
    // Kamerafargen der dybden traff, glidende snitt per celle. Bare forhåndsvisning.
    kernel void delkart_farge(device const float* depth [[buffer(0)]],
                              device uint* farge [[buffer(1)]],
                              constant FargeP& p [[buffer(2)]],
                              texture2d<float, access::sample> texY [[texture(0)]],
                              texture2d<float, access::sample> texCbCr [[texture(1)]],
                              uint2 gid [[thread_position_in_grid]]) {
        constexpr sampler cs(coord::normalized, filter::linear, address::clamp_to_edge);
        int x = gid.x, y = gid.y;
        if (x >= p.dw || y >= p.dh) return;
        float z = depth[y * p.dw + x];
        if (!(z > 0.3 && z < 5.0)) return;
        float3 pc = float3((float(x) - p.cx) / p.fx * z, -(float(y) - p.cy) / p.fy * z, -z);
        float3 q = (p.c2w * float4(pc, 1.0)).xyz;
        int3 ci = int3(floor((q - p.lo) / p.celle));
        if (any(ci < 0) || any(ci >= p.cdim)) return;
        float2 uv = float2((float(x) + 0.5) / float(p.dw), (float(y) + 0.5) / float(p.dh));
        float4 ycc = float4(texY.sample(cs, uv).r, texCbCr.sample(cs, uv).rg, 1.0);
        float3 rgb = clamp((ycbcrToRGB * ycc).rgb, 0.0, 1.0);
        uint idx = uint((ci.z * p.cdim.y + ci.y) * p.cdim.x + ci.x);
        uint gml = farge[idx];
        float4 g = unpack_unorm4x8_to_float(gml);
        float3 ny = gml == 0u ? rgb : mix(g.rgb, rgb, 0.3);
        farge[idx] = pack_float_to_unorm4x8(float4(ny, 1.0));
    }
    kernel void delkart_tom(texture3d<float, access::write> tex [[texture(0)]],
                            uint3 gid [[thread_position_in_grid]]) {
        if (gid.x >= tex.get_width() || gid.y >= tex.get_height() || gid.z >= tex.get_depth()) return;
        tex.write(float4(0.0), gid);
    }
    """
}

