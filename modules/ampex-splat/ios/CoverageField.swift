import Foundation
import Metal
import simd
import CoreVideo

/// Dekningsfelt (2026-09-06): en skalar c(x) over rommet som sier hvor godt punktet x
/// er SETT av kameraet — regnet hver ramme på GPU-en, ikke fra keyframes.
///
/// Hvert LiDAR-dybdebilde er per definisjon nøyaktig mengden flatepunkter kameraet så i
/// det øyeblikket (okklusjon inkludert). For hver ramme spres en vekt inn i feltet ved
/// hvert dybdepiksel:  w = kvalitet · cos²θ · avstandsvekt,  og  c = 1 − exp(−Σw / S₀).
/// Det er samme vekting som TSDF-fusjon (Curless & Levoy 1996; KinectFusion 2011), bare
/// uten geometri. Overlegget leser feltet direkte i shaderen — ingen CPU-pass, ingen
/// keyframe-bøtter, ingen klumper: stripene toner der du peker, mens du peker.
///
/// STRØMMENDE VINDU (2026-10-22, helt hus — se docs/SKANN_HELT_HUS.md). Volumet er en
/// RINGBUFFER i verdenskoordinater: voxel g (globalt, origo i ARKits origo) bor på plass
/// g mod dims. Vinduet (`loG` … `loG + dims`) følger kameraet i steg på én blokk (1 m).
/// Raden som faller ut bak og raden som kommer inn foran deler ringplass, så ett bytte-
/// kall gjør begge: det som går ut skrives til disk, det som kommer inn leses fra disk
/// (tomt hvis aldri sett). Shaderen sampler med `address::repeat`, så ringadresseringen
/// er gratis der, og trilineær filtrering over ringsømmen blir riktig. Som spill på for
/// svak maskinvare: bare rommet du står i er lastet.
final class CoverageField {
    // MSL-ekvivalenten er { float3; float3; float; } — størrelse 36 rundet opp til
    // 16-justering = 48 byte. Putene holder Swift-siden like stor, slik at
    // `handleBinding` skriver hele strukturen shaderen leser.
    struct Uniforms {
        var origin: SIMD3<Float>; var invExtent: SIMD3<Float>; var voxel: Float  // origin = vinduets nedre hjørne
        var pute: (Float, Float, Float) = (0, 0, 0)
    }
    let device: MTLDevice
    let queue: MTLCommandQueue
    let texture: MTLTexture
    let dims: SIMD3<Int32>
    let voxel: Float
    /// Vinduets nedre hjørne i GLOBALE voxler (multiplum av `blokk`).
    private var loG = SIMD3<Int32>(0, 0, 0)
    /// Vinduets nedre hjørne i meter — det shaderen trenger for «er punktet i vinduet?».
    var origin: SIMD3<Float> { SIMD3<Float>(loG) * voxel }
    private var ready = false
    private let accum: MTLBuffer
    private let splatPipe: MTLComputePipelineState
    private let convertPipe: MTLComputePipelineState
    private let byttPipe: MTLComputePipelineState
    /// Blokk = 20 voxler = 1 m. Vinduet flyttes i hele blokker, og disklageret er per blokk.
    static let blokk: Int32 = 20
    /// Kameraets plass i vinduet, i blokker fra `loG`: midt på vannrett, 2 m over bunnen.
    private static let kameraBlokk = SIMD3<Float>(6, 2, 6)
    /// Slakk før vinduet flyttes (blokker): vannrett 1 (≥ 4,5 m margin igjen), loddrett
    /// 0,3 — gulvet skal aldri falle ut når du går en trapp.
    private static let slakk = SIMD3<Float>(1.0, 0.3, 1.0)
    /// Disklager for blokker utenfor vinduet. Én mappe per økt (`nullstill` lager ny),
    /// én seriekø så en lesing alltid ser skrivingene som ble lagt i kø før den.
    private let ioKø = DispatchQueue(label: "ampex.dekningsfelt.io", qos: .utility)
    private var lager: URL
    private var flyttinger = 0
    private var tikk = 0
    private var texCache: CVMetalTextureCache?
    /// S₀: vekt som tilsvarer «godt sett». ~12 rammer på 1 m frontalt ved 30 Hz-halvering.
    private let s0: Float = 12

    /// LiDAR-OKKLUSJON i overlegget (2026-10-26, flerromsskann). Overlegget er helt dekkende,
    /// så kamerabildet vises aldri — og der ARKit ennå ikke har mesh på din side av en vegg,
    /// var det malte rommet på ANDRE siden det eneste som ble tegnet: «man kunne se gjennom
    /// veggen». Shaderen sammenligner nå hvert fragment med LiDAR-dybden i samme ramme, og et
    /// fragment klart bak den ekte flaten blir striper (= ikke skannet her ennå).
    /// MSL: { float4x4 w2c; float4 K; float4 info; float4 kamera; } = 112 byte.
    struct Okklusjon {
        var w2c = matrix_identity_float4x4
        var K = SIMD4<Float>(0, 0, 0, 0)        // fx, fy, cx, cy i dybdebildets piksler
        var info = SIMD4<Float>(0, 0, 0, 0)     // bredde, høyde, har dybde (0/1), margin (m)
        var kamera = SIMD4<Float>(0, 0, 0, 0)   // kameraets posisjon i verden
    }
    private(set) var okklusjon = Okklusjon()
    /// Siste LiDAR-dybdebilde (ARKit: 256 × 192). Delt minne, skrives hver ramme; en rift
    /// mellom to rammer i én visning er usynlig mot 15 cm margin.
    let lidarTex: MTLTexture?
    private static let lidarDims = (w: 256, h: 192)

    func oppdaterOkklusjon(depth: Data, w: Int, h: Int, fx: Float, fy: Float, cx: Float, cy: Float, c2w: simd_float4x4) {
        guard let tex = lidarTex, w == tex.width, h == tex.height, depth.count >= w * h * 4 else {
            okklusjon.info.z = 0; return
        }
        depth.withUnsafeBytes { tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: w * 4) }
        let margin = Float(MeshBakeV2.flaggTall("meshscan.okkmargin", 0.15))
        okklusjon = Okklusjon(w2c: c2w.inverse, K: SIMD4(fx, fy, cx, cy),
                              info: SIMD4(Float(w), Float(h), margin > 0 ? 1 : 0, margin),
                              kamera: SIMD4(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z, 1))
    }

    var uniforms: Uniforms {
        Uniforms(origin: origin,
                 invExtent: SIMD3<Float>(1 / (Float(dims.x) * voxel), 1 / (Float(dims.y) * voxel), 1 / (Float(dims.z) * voxel)),
                 voxel: voxel)
    }

    private static let msl = """
    #include <metal_stdlib>
    using namespace metal;
    struct P {
        float4x4 c2w;
        float3 origin; float voxel;
        int3 dims; float w0;
        float fx, fy, cx, cy;
        int dw, dh, _a, _b;
        float rgbFx, resMin, resMaal, _c;
    };
    // ARKit-kameraet leverer 420 YpCbCr full-range; samme matrise som Apples ARKit-eksempel.
    constant float4x4 ycbcrToRGB = float4x4(float4( 1.0000,  1.0000, 1.0000, 0.0),
                                            float4( 0.0000, -0.3441, 1.7720, 0.0),
                                            float4( 1.4020, -0.7141, 0.0000, 0.0),
                                            float4(-0.7010,  0.5291,-0.8860, 1.0));
    inline float3 unproj(float x, float y, float z, constant P& p) {
        return float3((x - p.cx) / p.fx * z, -(y - p.cy) / p.fy * z, -z);
    }
    kernel void splat(device atomic_uint* acc [[buffer(0)]],
                      device const float* depth [[buffer(1)]],
                      constant P& p [[buffer(2)]],
                      texture2d<float, access::sample> texY [[texture(0)]],
                      texture2d<float, access::sample> texCbCr [[texture(1)]],
                      uint2 gid [[thread_position_in_grid]]) {
        constexpr sampler cs(coord::normalized, filter::linear, address::clamp_to_edge);
        int x = gid.x, y = gid.y;
        if (x < 1 || y < 1 || x >= p.dw - 1 || y >= p.dh - 1) return;
        float z = depth[y * p.dw + x];
        if (z < 0.3 || z > 5.0) return;
        // Dybdekant: der dybden hopper er punktet usikkert — ikke gi dekning.
        float lim = max(0.04, 0.03 * z);
        if (fabs(depth[y * p.dw + x + 1] - z) > lim || fabs(depth[(y + 1) * p.dw + x] - z) > lim) return;
        float3 pc = unproj(float(x), float(y), z, p);
        float dL = depth[y * p.dw + x - 1], dR = depth[y * p.dw + x + 1];
        float dU = depth[(y - 1) * p.dw + x], dD = depth[(y + 1) * p.dw + x];
        float3 pR = dR > 0.3 ? unproj(float(x + 1), float(y), dR, p) : pc;
        float3 pL = dL > 0.3 ? unproj(float(x - 1), float(y), dL, p) : pc;
        float3 pD = dD > 0.3 ? unproj(float(x), float(y + 1), dD, p) : pc;
        float3 pU = dU > 0.3 ? unproj(float(x), float(y - 1), dU, p) : pc;
        float3 n = cross(pR - pL, pD - pU);
        float nl = length(n);
        float cosT = nl > 1e-6 ? clamp(fabs(dot(n / nl, normalize(-pc))), 0.0, 1.0) : 0.5;
        // Vekt: kvalitet (uskarphet) · hvor godt flaten faktisk BLIR OPPLØST i dette bildet.
        // OPPLØSNINGSKRAV (2026-09-10). Den gamle vekten var cos²θ · klemt 1,5/z med GULV 0,25:
        // et bilde tatt 5 m unna og skrått ga fortsatt en firedel, og tolv slike gjorde flaten
        // «ferdig» i overlegget. MÅLT på et ekte skann: vinnerfotoet ga median 1013 piksler per
        // meter vegg, og 52 % av veggarealet var malt fra bilder under 1000 px/m. Et 2 mm
        // panelspor trenger minst 1000 px/m for å nå Nyquist — under det finnes ikke sporet i
        // kilden, og veggen blir utvasket uansett hva baken gjør. Brukeren fikk aldri vite det,
        // for stripene forsvant likevel.
        // Nå teller et bilde bare i den grad det faktisk oppløser flaten: null under resMin,
        // fullt fra resMaal. Det gjør overlegget til en «gå nærmere»-instruks.
        float pxPerM = p.rgbFx * cosT / max(z, 0.2);
        // Gulv på 0,15: et fjernt bilde skal ikke telle som ferdig, men det skal heller ikke
        // være en blindvei. Tolv fjerne syn gir da c ≈ 0,14 — stripene står igjen og sier
        // «kom nærmere», i stedet for at overlegget aldri reagerer på at du peker dit.
        float oppl = 0.15 + 0.85 * clamp((pxPerM - p.resMin) / max(p.resMaal - p.resMin, 1.0), 0.0, 1.0);
        float w = p.w0 * cosT * cosT * oppl;
        float3 wp = (p.c2w * float4(pc, 1.0)).xyz;
        // Globalt voxelnummer; utenfor vinduet → ingenting (raden lastes når du kommer dit).
        int3 g = int3(floor(wp / p.voxel));
        int3 l = g - int3(round(p.origin / p.voxel));
        if (l.x < 0 || l.y < 0 || l.z < 0 || l.x >= p.dims.x || l.y >= p.dims.y || l.z >= p.dims.z) return;
        int3 r = ((g % p.dims) + p.dims) % p.dims;   // ringplass
        uint i = ((r.z * p.dims.y + r.y) * p.dims.x + r.x) * 4;
        // Dybdebildet og kamerabildet deler synsfelt og forhold — samme normaliserte koordinat.
        float2 uv = float2((float(x) + 0.5) / float(p.dw), (float(y) + 0.5) / float(p.dh));
        float4 ycc = float4(texY.sample(cs, uv).r, texCbCr.sample(cs, uv).rg, 1.0);
        float3 rgb = clamp((ycbcrToRGB * ycc).rgb, 0.0, 1.0);
        uint wi = uint(w * 256.0);
        atomic_fetch_add_explicit(&acc[i + 0], wi, memory_order_relaxed);
        atomic_fetch_add_explicit(&acc[i + 1], uint(w * 256.0 * rgb.r * 255.0), memory_order_relaxed);
        atomic_fetch_add_explicit(&acc[i + 2], uint(w * 256.0 * rgb.g * 255.0), memory_order_relaxed);
        atomic_fetch_add_explicit(&acc[i + 3], uint(w * 256.0 * rgb.b * 255.0), memory_order_relaxed);
    }
    // Bytter én skive (én blokk tykk) mellom ringen og et delt mellomlager: det som lå i
    // ringen (raden som går ut) havner i mellomlageret, det mellomlageret hadde (raden som
    // kommer inn, lest fra disk) havner i ringen. Samme ringplass for begge — derfor ett kall.
    struct Skive { int3 lo; int3 ext; int3 dims; };   // int3 = 16 byte i MSL, som SIMD3<Int32>
    kernel void bytt(device uint4* acc [[buffer(0)]],
                     device uint4* stage [[buffer(1)]],
                     constant Skive& s [[buffer(2)]],
                     uint3 gid [[thread_position_in_grid]]) {
        int3 q = int3(gid);
        if (q.x >= s.ext.x || q.y >= s.ext.y || q.z >= s.ext.z) return;
        int3 g = s.lo + q;
        int3 r = ((g % s.dims) + s.dims) % s.dims;
        uint i = (r.z * s.dims.y + r.y) * s.dims.x + r.x;
        uint j = (q.z * s.ext.y + q.y) * s.ext.x + q.x;
        uint4 ut = acc[i];
        acc[i] = stage[j];
        stage[j] = ut;
    }
    kernel void convert(device const uint* acc [[buffer(0)]],
                        texture3d<half, access::write> tex [[texture(0)]],
                        constant float& s0 [[buffer(1)]],
                        uint3 gid [[thread_position_in_grid]]) {
        if (gid.x >= tex.get_width() || gid.y >= tex.get_height() || gid.z >= tex.get_depth()) return;
        uint i = ((gid.z * tex.get_height() + gid.y) * tex.get_width() + gid.x) * 4;
        float sw = float(acc[i]);
        float s = sw / 256.0;
        float c = 1.0 - exp(-s / s0);
        // Premultiplisert med dekning: trilineær sampling blir da et riktig vektet snitt,
        // og tomme naboceller mørkner ikke kantene. Shaderen deler på alpha.
        float3 rgb = sw > 0.0 ? float3(float(acc[i+1]), float(acc[i+2]), float(acc[i+3])) / (sw * 255.0) : float3(0.0);
        tex.write(half4(half3(rgb * c), half(c)), gid);
    }
    // M0b: c som én byte per celle, i ringrekkefølge — til `dumpFerdig`.
    kernel void dekning8(device const uint* acc [[buffer(0)]],
                         device uchar* ut [[buffer(1)]],
                         constant float& s0 [[buffer(2)]],
                         uint id [[thread_position_in_grid]]) {
        float c = 1.0 - exp(-(float(acc[id * 4]) / 256.0) / s0);
        ut[id] = uchar(clamp(c, 0.0, 1.0) * 255.0 + 0.5);
    }
    """

    init?() {
        guard let dev = MTLCreateSystemDefaultDevice(), let q = dev.makeCommandQueue(),
              let lib = try? dev.makeLibrary(source: CoverageField.msl, options: nil),
              let fs = lib.makeFunction(name: "splat"), let fc = lib.makeFunction(name: "convert"),
              let fb = lib.makeFunction(name: "bytt"),
              let ps = try? dev.makeComputePipelineState(function: fs),
              let pc = try? dev.makeComputePipelineState(function: fc),
              let pb = try? dev.makeComputePipelineState(function: fb) else { return nil }
        // Farge + dekning (Scaniverse-forhåndsvisning, 2026-09-06): 9,6 × 3,6 × 9,6 m på 4 cm =
        // 5,2M voxler. Teller 4×uint32 (Σw, ΣwR, ΣwG, ΣwB) = 83 MB, rgba8-tekstur 21 MB.
        // 2026-10-22: 12 × 5 × 12 m på 5 cm, og vinduet FØLGER kameraet (se klassehodet).
        // Før sto volumet fast rundt første kameraposisjon, så bare ±4,8 m nådde ut —
        // skannet 22.10 (rom 6,8 × 7,8 m, startet ved én vegg) hadde motsatt vegg utenfor,
        // og stripene der kunne aldri forsvinne. 5,8M voxler (92 + 23 MB). Prisen for 5 cm:
        // normal-tappene i CoverageMesh.metal når ±10 cm i stedet for ±8.
        let d = SIMD3<Int32>(240, 100, 240)
        let n = Int(d.x) * Int(d.y) * Int(d.z)
        guard let buf = dev.makeBuffer(length: n * 16, options: .storageModePrivate) else { return nil }
        let td = MTLTextureDescriptor()
        td.textureType = .type3D; td.pixelFormat = .rgba8Unorm
        td.width = Int(d.x); td.height = Int(d.y); td.depth = Int(d.z)
        td.usage = [.shaderRead, .shaderWrite]; td.storageMode = .private
        guard let tex = dev.makeTexture(descriptor: td) else { return nil }
        let ld = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r32Float, width: CoverageField.lidarDims.w,
                                                          height: CoverageField.lidarDims.h, mipmapped: false)
        ld.usage = [.shaderRead]; ld.storageMode = .shared
        lidarTex = dev.makeTexture(descriptor: ld)
        device = dev; queue = q; accum = buf; texture = tex; dims = d; voxel = 0.05
        CVMetalTextureCacheCreate(nil, nil, dev, nil, &texCache)
        splatPipe = ps; convertPipe = pc; byttPipe = pb
        lager = CoverageField.nyttLager()
        // Nullstill telleren.
        if let cb = q.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() {
            blit.fill(buffer: buf, range: 0..<(n * 16), value: 0); blit.endEncoding(); cb.commit()
        }
    }

    /// TØMMER feltet mellom skann (2026-09-13). `coverageField` er en `static let` — én
    /// instans for hele appens levetid — mens ARKit gir HVERT skann et nytt verdensorigo.
    /// Uten dette arvet skann nr. 2 både malingen og forankringen fra skann nr. 1: deler av
    /// det nye rommet lå utenfor det gamle volumet (stripene kunne ikke forsvinne der
    /// uansett hvor lenge man pekte), og andre deler leste dekning malt i et ANNET rom.
    func nullstill() {
        guard let cb = queue.makeCommandBuffer() else { return }
        if let blit = cb.makeBlitCommandEncoder() {
            blit.fill(buffer: accum, range: 0..<accum.length, value: 0)
            blit.endEncoding()
        }
        // Teksturen overlegget leser skrives fra telleren — kjør én konvertering med det
        // samme, ellers står forrige skanns bilde der til neste ramme har rukket det.
        if let enc = cb.makeComputeCommandEncoder() {
            var s = s0
            enc.setComputePipelineState(convertPipe)
            enc.setBuffer(accum, offset: 0, index: 0)
            enc.setBytes(&s, length: 4, index: 1)
            enc.setTexture(texture, index: 0)
            enc.dispatchThreads(MTLSize(width: Int(dims.x), height: Int(dims.y), depth: Int(dims.z)),
                                threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 4))
            enc.endEncoding()
        }
        cb.commit()
        tikk = 0
        ready = false
        if flyttinger > 0 { MeshLog.log("dekningsfelt — vinduet flyttet \(flyttinger) ganger forrige økt") }
        flyttinger = 0
        let gammelt = lager
        lager = CoverageField.nyttLager()
        ioKø.async { try? FileManager.default.removeItem(at: gammelt) }
    }

    private static func nyttLager() -> URL {
        let rot = FileManager.default.temporaryDirectory.appendingPathComponent("dekningsfelt", isDirectory: true)
        // Rester fra en økt appen døde midt i ryddes ved første oppstart.
        if !FileManager.default.fileExists(atPath: rot.path) {
            try? FileManager.default.createDirectory(at: rot, withIntermediateDirectories: true)
        }
        let u = rot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    /// Forankrer volumet rundt første kameraposisjon.
    /// LODDRETT ER IKKE SENTRERT (2026-09-13): volumet var 3,6 m høyt (nå 4,0), og kameraet starter
    /// 1,5–1,7 m over gulvet — sentrert ga bare 1,8 m ned og dermed 13 cm margin til gulvet
    /// på skannet 13.09 (gulvet lå på −1,64 m). Holder man telefonen høyere, faller gulvet
    /// UT av feltet og blir aldri malt — stripene der kan da ikke forsvinne uansett.
    /// 2,4 m ned / 1,6 m opp: taket ligger typisk 0,7–1,0 m over kameraet.
    func forankre(_ camPos: SIMD3<Float>) {
        guard !ready else { return }
        let b = CoverageField.blokk
        let kb = SIMD3<Int32>((camPos / (Float(b) * voxel)).rounded(.down))
        loG = (kb &- SIMD3<Int32>(CoverageField.kameraBlokk)) &* b
        ready = true
    }

    /// Flytter vinduet etter kameraet, én blokk om gangen (et hopp i sporingen tas som
    /// flere steg). Kalles før hver splat; koster ingenting når kameraet er innenfor slakken.
    private func følg(_ camPos: SIMD3<Float>) {
        let b = Float(CoverageField.blokk)
        for _ in 0..<64 {
            let kf = camPos / (b * voxel)                                  // kamera i blokker
            let midt = SIMD3<Float>(loG) / b + CoverageField.kameraBlokk + 0.5
            let avvik = kf - midt
            var flyttet = false
            for a in 0..<3 {
                let grense = 0.5 + CoverageField.slakk[a]
                if avvik[a] > grense { bytt(akse: a, retning: 1); flyttet = true; break }
                if avvik[a] < -grense { bytt(akse: a, retning: -1); flyttet = true; break }
            }
            if !flyttet { return }
        }
    }

    /// Flytter vinduet én blokk langs `akse`. Skiven som kommer inn hentes fra disk, skiven
    /// som går ut skrives til disk (bare blokker med innhold — lufta lagres ikke).
    private func bytt(akse a: Int, retning d: Int32) {
        let b = CoverageField.blokk
        var nyLo = loG; nyLo[a] += d * b
        // Skiven i NYE globale koordinater (den som kommer inn), og den som går ut.
        var innLo = nyLo; innLo[a] = d > 0 ? nyLo[a] + dims[a] - b : nyLo[a]
        var utLo = innLo; utLo[a] -= d * dims[a]
        var extV = dims; extV[a] = b
        let ext = extV, inn = innLo, ut = utLo
        let n = Int(ext.x) * Int(ext.y) * Int(ext.z)
        guard let stage = device.makeBuffer(length: n * 16, options: .storageModeShared) else { return }
        let blokker = ext / b
        // Inn: les de blokkene som finnes på disk inn i mellomlageret (resten er null).
        let lagerNå = lager
        ioKø.sync {
            let p = stage.contents().assumingMemoryBound(to: UInt32.self)
            for bz in 0..<blokker.z { for by in 0..<blokker.y { for bx in 0..<blokker.x {
                let k = SIMD3<Int32>(inn.x / b + bx, inn.y / b + by, inn.z / b + bz)
                guard let data = try? Data(contentsOf: lagerNå.appendingPathComponent("\(k.x)_\(k.y)_\(k.z).bin")),
                      data.count == Int(b * b * b) * 16 else { continue }
                data.withUnsafeBytes { raw in
                    let src = raw.bindMemory(to: UInt32.self)
                    for z in 0..<b { for y in 0..<b {
                        let qz = bz * b + z, qy = by * b + y, qx = bx * b
                        let j = (Int(qz) * Int(ext.y) + Int(qy)) * Int(ext.x) + Int(qx)
                        let s0 = (Int(z) * Int(b) + Int(y)) * Int(b)
                        (p + j * 4).update(from: src.baseAddress! + s0 * 4, count: Int(b) * 4)
                    } }
                }
            } } }
        }
        guard let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return }
        struct Skive { var lo: SIMD3<Int32>; var ext: SIMD3<Int32>; var dims: SIMD3<Int32> }
        var sk = Skive(lo: inn, ext: ext, dims: dims)
        enc.setComputePipelineState(byttPipe)
        enc.setBuffer(accum, offset: 0, index: 0)
        enc.setBuffer(stage, offset: 0, index: 1)
        enc.setBytes(&sk, length: MemoryLayout<Skive>.stride, index: 2)
        enc.dispatchThreads(MTLSize(width: Int(ext.x), height: Int(ext.y), depth: Int(ext.z)),
                            threadsPerThreadgroup: MTLSize(width: 4, height: 4, depth: 4))
        enc.endEncoding()
        cb.commit()
        // Venter (et par ms, én gang per meter gått) så skrivingen under ser riktige data, og
        // så neste lesing av samme blokk aldri kan komme før den er skrevet (seriekøen).
        cb.waitUntilCompleted()
        loG = nyLo
        flyttinger += 1
        ioKø.async {
            let p = stage.contents().assumingMemoryBound(to: UInt32.self)
            let blokkLen = Int(b * b * b) * 4
            var buf = [UInt32](repeating: 0, count: blokkLen)
            for bz in 0..<blokker.z { for by in 0..<blokker.y { for bx in 0..<blokker.x {
                var noe = false
                buf.withUnsafeMutableBufferPointer { dst in
                    for z in 0..<b { for y in 0..<b {
                        let qz = bz * b + z, qy = by * b + y, qx = bx * b
                        let j = (Int(qz) * Int(ext.y) + Int(qy)) * Int(ext.x) + Int(qx)
                        let s0 = (Int(z) * Int(b) + Int(y)) * Int(b)
                        (dst.baseAddress! + s0 * 4).update(from: p + j * 4, count: Int(b) * 4)
                        if !noe { for x in 0..<Int(b) where dst[(s0 + x) * 4] != 0 { noe = true; break } }
                    } }
                }
                guard noe else { continue }
                let k = SIMD3<Int32>(ut.x / b + bx, ut.y / b + by, ut.z / b + bz)
                let data = buf.withUnsafeBytes { Data($0) }
                try? data.write(to: lagerNå.appendingPathComponent("\(k.x)_\(k.y)_\(k.z).bin"))
            } } }
        }
    }

    /// Sprer én ramme inn i feltet. `w0` = kvalitet (0–1) — 0 for sløret ramme.
    /// Oppløsningskravet i piksler per meter flate. 700 = ingenting teller (kameraet er
    /// 3,9 m unna rett på), 1600 = fullt (1,7 m). Kalibrert mot at et 2 mm panelspor trenger
    /// minst 1000 px/m for å finnes i kilden i det hele tatt.
    static var oppløsningskrav: (min: Float, maal: Float) {
        let d = UserDefaults.standard
        let mn = Float(d.string(forKey: "meshscan.dekningmin") ?? "") ?? 700
        let ml = Float(d.string(forKey: "meshscan.dekningmaal") ?? "") ?? 1600
        return (mn, max(mn + 1, ml))
    }

    func splat(depth: Data, w: Int, h: Int, fx: Float, fy: Float, cx: Float, cy: Float,
               c2w: simd_float4x4, w0: Float, image: CVPixelBuffer) {
        guard ready, w0 > 0, let cache = texCache else { return }
        følg(SIMD3<Float>(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z))
        // Kamerabildet som to Metal-teksturer (Y + CbCr) uten kopi.
        func plane(_ i: Int, _ fmt: MTLPixelFormat) -> MTLTexture? {
            var cvt: CVMetalTexture?
            let pw = CVPixelBufferGetWidthOfPlane(image, i), ph = CVPixelBufferGetHeightOfPlane(image, i)
            guard CVMetalTextureCacheCreateTextureFromImage(nil, cache, image, nil, fmt, pw, ph, i, &cvt) == kCVReturnSuccess,
                  let t = cvt else { return nil }
            return CVMetalTextureGetTexture(t)
        }
        guard let texY = plane(0, .r8Unorm), let texC = plane(1, .rg8Unorm) else { return }
        guard let dbuf = depth.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: depth.count, options: .storageModeShared) }),
              let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return }
        struct P { var c2w: simd_float4x4; var origin: SIMD3<Float>; var voxel: Float; var dims: SIMD3<Int32>; var w0: Float
                   var fx: Float, fy: Float, cx: Float, cy: Float; var dw: Int32, dh: Int32, a: Int32, b: Int32
                   var rgbFx: Float, resMin: Float, resMaal: Float, c: Float }
        // RGB-kameraets brennvidde i FOTOETS piksler: dybdekartet og bildet deler synsfelt,
        // så fx skaleres opp med breddeforholdet. Det er den som avgjør hvor mange piksler
        // per meter flaten faktisk får i keyframen.
        let krav = CoverageField.oppløsningskrav
        let rgbFx = fx * Float(CVPixelBufferGetWidth(image)) / Float(max(w, 1))
        var p = P(c2w: c2w, origin: origin, voxel: voxel, dims: dims, w0: w0, fx: fx, fy: fy, cx: cx, cy: cy,
                  dw: Int32(w), dh: Int32(h), a: 0, b: 0,
                  rgbFx: rgbFx, resMin: krav.min, resMaal: krav.maal, c: 0)
        enc.setComputePipelineState(splatPipe)
        enc.setBuffer(accum, offset: 0, index: 0)
        enc.setBuffer(dbuf, offset: 0, index: 1)
        enc.setBytes(&p, length: MemoryLayout<P>.stride, index: 2)
        enc.setTexture(texY, index: 0)
        enc.setTexture(texC, index: 1)
        enc.dispatchThreads(MTLSize(width: w, height: h, depth: 1), threadsPerThreadgroup: MTLSize(width: 16, height: 16, depth: 1))
        enc.endEncoding()
        tikk += 1
        // Teksturen som overlegget leser oppdateres hver 2. splat (~21 MB skriv, ~1 ms).
        // Med splatting på hver ramme (§101) er det 15 Hz på en 30 Hz-økt, mot 7,5 Hz før.
        // meshscan.feltvis = n: skriv teksturen hver n-te splat.
        let visRate = max(1, Int(MeshBakeV2.flaggTall("meshscan.feltvis", 2)))
        if tikk % visRate == 0, let enc2 = cb.makeComputeCommandEncoder() {
            var s = s0
            enc2.setComputePipelineState(convertPipe)
            enc2.setBuffer(accum, offset: 0, index: 0)
            enc2.setBytes(&s, length: 4, index: 1)
            enc2.setTexture(texture, index: 0)
            enc2.dispatchThreads(MTLSize(width: Int(dims.x), height: Int(dims.y), depth: Int(dims.z)),
                                 threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 4))
            enc2.endEncoding()
        }
        cb.commit()
    }

    /// M0b — OVERLEGG-SANNHET (2026-10-26, docs/PROMPT_OPUS_SKANN_DELKART.md). Skriver c for
    /// HELE det skannede området slik overlegget hadde det ved Ferdig: vinduet fra GPU-en og
    /// blokkene som er skjøvet ut til disk. `tools/audit-scan-overlegg-sannhet.py` holder det
    /// mot den ferdige GLB-en. Format (little endian): 4 × Int32 (nx, ny, nz, 0), 3 × Float
    /// origo (m, cellens nedre hjørne), Float voxel, Float terskel, så nx·ny·nz × UInt8
    /// (c · 255, x raskest, så y, så z). Bare måling; erstattes av W-teksturene i M1.
    func dumpFerdig(til url: URL) {
        guard ready, let lib = try? device.makeLibrary(source: CoverageField.msl, options: nil),
              let fn = lib.makeFunction(name: "dekning8"),
              let pipe = try? device.makeComputePipelineState(function: fn) else { return }
        let n = Int(dims.x) * Int(dims.y) * Int(dims.z)
        guard let ut = device.makeBuffer(length: n, options: .storageModeShared),
              let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return }
        var s = s0
        enc.setComputePipelineState(pipe)
        enc.setBuffer(accum, offset: 0, index: 0)
        enc.setBuffer(ut, offset: 0, index: 1)
        enc.setBytes(&s, length: 4, index: 2)
        enc.dispatchThreads(MTLSize(width: n, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
        enc.endEncoding()
        cb.commit()
        cb.waitUntilCompleted()
        ioKø.sync {}   // alle utskrivinger til disk er ferdige

        let b = CoverageField.blokk, bl = Int(b)
        let blokkN = bl * bl * bl
        var blokker: [SIMD3<Int32>: [UInt8]] = [:]
        // Vinduet: global voxel g bor på ringplass g mod dims.
        let ring = ut.contents().assumingMemoryBound(to: UInt8.self)
        let lo = loG / b, ant = dims / b
        for bz in 0..<ant.z { for by in 0..<ant.y { for bx in 0..<ant.x {
            let k = SIMD3<Int32>(lo.x + bx, lo.y + by, lo.z + bz)
            var v = [UInt8](repeating: 0, count: blokkN)
            var noe = false
            for z in 0..<b { for y in 0..<b { for x in 0..<b {
                let g = k &* b &+ SIMD3<Int32>(x, y, z)
                let r = ((g % dims) &+ dims) % dims
                let c = ring[(Int(r.z) * Int(dims.y) + Int(r.y)) * Int(dims.x) + Int(r.x)]
                v[(Int(z) * bl + Int(y)) * bl + Int(x)] = c
                if c != 0 { noe = true }
            } } }
            if noe { blokker[k] = v }
        } } }
        // Disken: blokker utenfor vinduet (de innenfor er lest inn igjen og står i ringen).
        let filer = (try? FileManager.default.contentsOfDirectory(atPath: lager.path)) ?? []
        var fraDisk = 0
        for f in filer where f.hasSuffix(".bin") {
            let d = f.dropLast(4).split(separator: "_").compactMap { Int32($0) }
            guard d.count == 3 else { continue }
            let k = SIMD3<Int32>(d[0], d[1], d[2])
            if all(k .>= lo) && all(k .< lo &+ ant) { continue }
            guard let data = try? Data(contentsOf: lager.appendingPathComponent(f)), data.count == blokkN * 16 else { continue }
            var v = [UInt8](repeating: 0, count: blokkN)
            data.withUnsafeBytes { raw in
                let src = raw.bindMemory(to: UInt32.self)
                for i in 0..<blokkN {
                    let c = 1 - exp(-(Float(src[i * 4]) / 256) / s0)
                    v[i] = UInt8(min(max(c, 0), 1) * 255 + 0.5)
                }
            }
            blokker[k] = v
            fraDisk += 1
        }
        guard let første = blokker.keys.first else { return }
        var bMin = første, bMax = første
        for k in blokker.keys { bMin = simd_min(bMin, k); bMax = simd_max(bMax, k) }
        let nb = bMax &- bMin &+ 1
        let nx = Int(nb.x) * bl, ny = Int(nb.y) * bl, nz = Int(nb.z) * bl
        var tett = [UInt8](repeating: 0, count: nx * ny * nz)
        for (k, v) in blokker {
            let o = (k &- bMin) &* b
            for z in 0..<bl { for y in 0..<bl {
                let dst = ((Int(o.z) + z) * ny + Int(o.y) + y) * nx + Int(o.x)
                let src = (z * bl + y) * bl
                for x in 0..<bl { tett[dst + x] = v[src + x] }
            } }
        }
        var hode = Data()
        for i in [Int32(nx), Int32(ny), Int32(nz), 0] { withUnsafeBytes(of: i.littleEndian) { hode.append(contentsOf: $0) } }
        let origo = SIMD3<Float>(bMin &* b) * voxel
        for f in [origo.x, origo.y, origo.z, voxel, Float(0.40)] { withUnsafeBytes(of: f.bitPattern.littleEndian) { hode.append(contentsOf: $0) } }
        hode.append(contentsOf: tett)
        do {
            try hode.write(to: url, options: .atomic)
            let dekket = tett.reduce(0) { $0 + ($1 >= 102 ? 1 : 0) }
            MeshLog.log(String(format: "overlegg — dekning-ferdig.bin: %d×%d×%d celler, %d blokker (%d fra disk), %d celler ≥ terskel",
                               nx, ny, nz, blokker.count, fraDisk, dekket))
        } catch {
            MeshLog.log("overlegg — dekning-ferdig.bin kunne ikke skrives: \(error.localizedDescription)")
        }
    }
}
