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
final class CoverageField {
    struct Uniforms { var origin: SIMD3<Float>; var invExtent: SIMD3<Float> }
    let device: MTLDevice
    let queue: MTLCommandQueue
    let texture: MTLTexture
    let dims: SIMD3<Int32>
    let voxel: Float
    private(set) var origin = SIMD3<Float>(0, 0, 0)
    private var ready = false
    private let accum: MTLBuffer
    private let splatPipe: MTLComputePipelineState
    private let convertPipe: MTLComputePipelineState
    private var tikk = 0
    private var texCache: CVMetalTextureCache?
    /// S₀: vekt som tilsvarer «godt sett». ~12 rammer på 1 m frontalt ved 30 Hz-halvering.
    private let s0: Float = 12

    var uniforms: Uniforms {
        Uniforms(origin: origin,
                 invExtent: SIMD3<Float>(1 / (Float(dims.x) * voxel), 1 / (Float(dims.y) * voxel), 1 / (Float(dims.z) * voxel)))
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
        int3 g = int3(floor((wp - p.origin) / p.voxel));
        if (g.x < 0 || g.y < 0 || g.z < 0 || g.x >= p.dims.x || g.y >= p.dims.y || g.z >= p.dims.z) return;
        uint i = ((g.z * p.dims.y + g.y) * p.dims.x + g.x) * 4;
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
    """

    init?() {
        guard let dev = MTLCreateSystemDefaultDevice(), let q = dev.makeCommandQueue(),
              let lib = try? dev.makeLibrary(source: CoverageField.msl, options: nil),
              let fs = lib.makeFunction(name: "splat"), let fc = lib.makeFunction(name: "convert"),
              let ps = try? dev.makeComputePipelineState(function: fs),
              let pc = try? dev.makeComputePipelineState(function: fc) else { return nil }
        // Farge + dekning (Scaniverse-forhåndsvisning, 2026-09-06): 9,6 × 3,6 × 9,6 m på 4 cm =
        // 5,2M voxler. Teller 4×uint32 (Σw, ΣwR, ΣwG, ΣwB) = 83 MB, rgba8-tekstur 21 MB.
        let d = SIMD3<Int32>(240, 90, 240)
        let n = Int(d.x) * Int(d.y) * Int(d.z)
        guard let buf = dev.makeBuffer(length: n * 16, options: .storageModePrivate) else { return nil }
        let td = MTLTextureDescriptor()
        td.textureType = .type3D; td.pixelFormat = .rgba8Unorm
        td.width = Int(d.x); td.height = Int(d.y); td.depth = Int(d.z)
        td.usage = [.shaderRead, .shaderWrite]; td.storageMode = .private
        guard let tex = dev.makeTexture(descriptor: td) else { return nil }
        device = dev; queue = q; accum = buf; texture = tex; dims = d; voxel = 0.04
        CVMetalTextureCacheCreate(nil, nil, dev, nil, &texCache)
        splatPipe = ps; convertPipe = pc
        // Nullstill telleren.
        if let cb = q.makeCommandBuffer(), let blit = cb.makeBlitCommandEncoder() {
            blit.fill(buffer: buf, range: 0..<(n * 16), value: 0); blit.endEncoding(); cb.commit()
        }
    }

    /// Forankrer volumet rundt første kameraposisjon.
    func forankre(_ camPos: SIMD3<Float>) {
        guard !ready else { return }
        origin = camPos - SIMD3<Float>(Float(dims.x) * voxel / 2, Float(dims.y) * voxel / 2, Float(dims.z) * voxel / 2)
        ready = true
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
        // Teksturen som overlegget leser oppdateres hver 2. ramme (~21 MB skriv, ~1 ms).
        if tikk % 2 == 0, let enc2 = cb.makeComputeCommandEncoder() {
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
}
