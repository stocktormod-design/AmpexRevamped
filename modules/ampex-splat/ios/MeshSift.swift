import Foundation
import Metal

/// SIFT på GPU (SKANN_BESLUTNINGER §108) — trekkene bildebindingen (§107) matcher mellom
/// passeringer. iOS har ingen SIFT, så dette er Lowes oppskrift slik OpenCV 4 gjør den, steg for
/// steg, for at tallene fra Mac-prototypen (OpenCV) skal holde på enheten:
/// CLAHE (8×8, klipp 2) → 2× oppskalering → gausspyramide (3 lag per oktav, σ 1,6) → DoG →
/// ekstremer med kvadratisk forfining, kontrast- og kantterskel → retning (36 bøtter) → de
/// sterkeste `maxFeatures` → 128-byte deskriptor.
///
/// DoG lagres ikke: ekstrem-kernelen tar differansen av gausslagene der den leser. Det holder
/// minnet på ~300 MB med oppskalert oktav (§108) i full presisjon.
///
/// Frittstående (bare Metal + Foundation) så den kan kompileres som et kommandolinjeverktøy på
/// Mac-en og sammenlignes mot OpenCV på fixturene uten simulator.
final class MeshSift {
    struct Keypoint {
        var x: Float, y: Float          // oktavpiksler (×2^oct = bildepiksler)
        var scl: Float                  // σ innen oktaven
        var resp: Float, angle: Float
        var oct: Int32, layer: Int32, r: Int32, c: Int32
        var p0: Int32 = 0, p1: Int32 = 0, p2: Int32 = 0
    }
    struct Feature { var x: Float, y: Float, size: Float, angle: Float, response: Float }

    private struct Params {
        var w: Int32, h: Int32, nl: Int32, oct: Int32
        var thr: Float, ct: Float, edge: Float, sigma: Float
        var cap: UInt32, start: UInt32 = 0, p1: UInt32 = 0, p2: UInt32 = 0
    }
    private struct Octave { let w: Int, h: Int, gauss: MTLBuffer, cand: MTLBuffer, count: MTLBuffer, cap: Int }

    let device: MTLDevice
    var contrastThreshold: Float = 0.02
    var edgeThreshold: Float = 10
    var clahe = true
    /// OpenCVs oktav −1: bildet dobles før søket. Gir dobbelt så mange (og de minste) trekk.
    var upsample = true
    private let layers = 3, sigma: Float = 1.6
    private let candCap = 131072, oriCap = 262144, descCap = 16384
    private let queue: MTLCommandQueue
    private let pBase, pUp, pBlurH, pBlurV, pDown, pExt, pOri, pDesc, pMatch, pMatchLm: MTLComputePipelineState
    private var w = 0, h = 0, up = false, octaves: [Octave] = []
    private var src: MTLBuffer!, lut: MTLBuffer!, tmp: MTLBuffer!, base: MTLBuffer!, oriented: MTLBuffer!, orientedCount: MTLBuffer!, desc: MTLBuffer!

    init?(device: MTLDevice? = MTLCreateSystemDefaultDevice()) {
        guard let device, let queue = device.makeCommandQueue() else { return nil }
        let lib: MTLLibrary
        do { lib = try device.makeLibrary(source: Self.source, options: nil) } catch {
            NSLog("[sift] shader: \(error)"); return nil
        }
        func p(_ n: String) -> MTLComputePipelineState? {
            lib.makeFunction(name: n).flatMap { try? device.makeComputePipelineState(function: $0) }
        }
        guard let a = p("sift_base"), let b = p("sift_blur_h"), let c = p("sift_blur_v"), let d = p("sift_down"),
              let e = p("sift_up"), let f = p("sift_extrema"), let g = p("sift_orient"), let h = p("sift_desc"), let m = p("sift_match"),
              let ml = p("sift_match_lm") else { return nil }
        self.device = device; self.queue = queue
        pBase = a; pUp = e; pBlurH = b; pBlurV = c; pDown = d; pExt = f; pOri = g; pDesc = h; pMatch = m; pMatchLm = ml
    }

    private func buf(_ n: Int) -> MTLBuffer { device.makeBuffer(length: max(n, 16), options: .storageModeShared)! }

    private func prepare(_ w: Int, _ h: Int) {
        guard w != self.w || h != self.h || upsample != up else { return }
        self.w = w; self.h = h; up = upsample; octaves = []
        let s = up ? 2 : 1
        var ow = w * s, oh = h * s
        while min(ow, oh) >= 32 && octaves.count < 8 {
            let n = ow * oh
            let cap = min(max(n / 32, 4096), candCap)
            octaves.append(Octave(w: ow, h: oh, gauss: buf(n * (layers + 3) * 4),
                                  cand: buf(cap * MemoryLayout<Keypoint>.stride), count: buf(4), cap: cap))
            ow /= 2; oh /= 2
        }
        src = buf(w * h); lut = buf(64 * 256); tmp = buf(w * h * s * s * 4); base = buf(w * h * 4)
        oriented = buf(oriCap * MemoryLayout<Keypoint>.stride); orientedCount = buf(4); desc = buf(descCap * 128)
    }

    /// CLAHE som OpenCV (8×8 fliser, klipp 2,0): én oppslagstabell per flis, regnet på CPU —
    /// selve bildet slås opp og interpoleres mellom flisene på GPU.
    private func makeLut(_ luma: UnsafePointer<UInt8>) {
        let L = lut.contents().bindMemory(to: UInt8.self, capacity: 64 * 256)
        guard clahe else { for t in 0..<64 { for v in 0..<256 { L[t * 256 + v] = UInt8(v) } }; return }
        let tw = w / 8, th = h / 8, area = tw * th
        let clip = max(Int(2.0 * Float(area) / 256), 1)
        var hist = [Int](repeating: 0, count: 256)
        hist.withUnsafeMutableBufferPointer { H in
            for ty in 0..<8 { for tx in 0..<8 {
                for i in 0..<256 { H[i] = 0 }
                for y in ty * th..<(ty + 1) * th {
                    let row = luma + y * w + tx * tw
                    for x in 0..<tw { H[Int(row[x])] += 1 }
                }
                var clipped = 0
                for i in 0..<256 where H[i] > clip { clipped += H[i] - clip; H[i] = clip }
                let batch = clipped / 256, residual = clipped - batch * 256
                for i in 0..<256 { H[i] += batch }
                if residual > 0 {
                    let step = max(256 / residual, 1)
                    var i = 0, left = residual
                    while i < 256 && left > 0 { H[i] += 1; i += step; left -= 1 }
                }
                let scale = 255 / Float(area)
                var sum = 0
                for i in 0..<256 {
                    sum += H[i]
                    L[(ty * 8 + tx) * 256 + i] = UInt8(min(255, max(0, (Float(sum) * scale).rounded())))
                }
            }}
        }
    }

    private func run(_ enc: MTLComputeCommandEncoder, _ p: MTLComputePipelineState, _ w: Int, _ h: Int = 1, _ d: Int = 1) {
        enc.setComputePipelineState(p)
        let tw = p.threadExecutionWidth
        let tg = h == 1 && d == 1 ? MTLSize(width: min(256, p.maxTotalThreadsPerThreadgroup), height: 1, depth: 1)
                                  : MTLSize(width: tw, height: max(1, min(8, p.maxTotalThreadsPerThreadgroup / tw)), depth: 1)
        enc.dispatchThreads(MTLSize(width: w, height: h, depth: d), threadsPerThreadgroup: tg)
    }

    private func blur(_ enc: MTLComputeCommandEncoder, _ s: MTLBuffer, _ so: Int, _ d: MTLBuffer, _ dof: Int,
                      _ w: Int, _ h: Int, _ sigma: Float) {
        // OpenCV for float-bilder: kjerne 2·round(4σ)+1 bred, kant reflect101
        let r = (Int((sigma * 8 + 1).rounded()) | 1) / 2
        var wt = (-r...r).map { expf(-Float($0 * $0) / (2 * sigma * sigma)) }
        let sum = wt.reduce(0, +); wt = wt.map { $0 / sum }
        var p = SIMD4<Int32>(Int32(w), Int32(h), Int32(r), 0)
        enc.setBuffer(s, offset: so, index: 0); enc.setBuffer(tmp, offset: 0, index: 1)
        enc.setBytes(wt, length: wt.count * 4, index: 2); enc.setBytes(&p, length: 16, index: 3)
        run(enc, pBlurH, w, h)
        enc.setBuffer(tmp, offset: 0, index: 0); enc.setBuffer(d, offset: dof, index: 1)
        run(enc, pBlurV, w, h)
    }

    /// Slipper pyramiden (~300 MB ved 1920×1080) — kall etter siste `detect`.
    func releasePyramid() {
        octaves = []; w = 0; h = 0
        src = nil; lut = nil; tmp = nil; base = nil; oriented = nil; orientedCount = nil; desc = nil
    }

    /// Trekk i ett 8-bits gråtonebilde. Posisjonene er i bildets piksler (pikselsenter på heltall).
    func detect(_ luma: UnsafePointer<UInt8>, width: Int, height: Int, maxFeatures: Int = 5000) -> (features: [Feature], descriptors: [UInt8]) {
        prepare(width, height)
        memcpy(src.contents(), luma, w * h)
        makeLut(luma)
        var sig = [Float](repeating: sigma, count: layers + 3)
        let k = powf(2, 1 / Float(layers))
        for i in 1..<layers + 3 { let prev = powf(k, Float(i - 1)) * sigma, tot = prev * k; sig[i] = sqrtf(tot * tot - prev * prev) }

        guard let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return ([], []) }
        for (o, oc) in octaves.enumerated() {
            let plane = oc.w * oc.h * 4
            if o == 0 {
                var p = SIMD4<Int32>(Int32(w), Int32(h), 8, 8)
                enc.setBuffer(src, offset: 0, index: 0); enc.setBuffer(lut, offset: 0, index: 1)
                enc.setBuffer(up ? base : oc.gauss, offset: up ? 0 : plane, index: 2); enc.setBytes(&p, length: 16, index: 3)
                run(enc, pBase, w, h)
                if up {
                    var q = SIMD4<Int32>(Int32(w), Int32(h), 0, 0)
                    enc.setBuffer(base, offset: 0, index: 0); enc.setBuffer(oc.gauss, offset: plane, index: 1)
                    enc.setBytes(&q, length: 16, index: 2)
                    run(enc, pUp, oc.w, oc.h)
                }
                // bildet antas å ha uskarphet 0,5 fra før (1,0 etter dobling)
                let s0: Float = up ? 1 : 0.5
                blur(enc, oc.gauss, plane, oc.gauss, 0, oc.w, oc.h, sqrtf(max(sigma * sigma - s0 * s0, 0.01)))
            } else {
                let prev = octaves[o - 1]
                var p = SIMD4<Int32>(Int32(oc.w), Int32(oc.h), Int32(prev.w), 0)
                enc.setBuffer(prev.gauss, offset: layers * prev.w * prev.h * 4, index: 0)
                enc.setBuffer(oc.gauss, offset: 0, index: 1); enc.setBytes(&p, length: 16, index: 2)
                run(enc, pDown, oc.w, oc.h)
            }
            for i in 1..<layers + 3 { blur(enc, oc.gauss, (i - 1) * plane, oc.gauss, i * plane, oc.w, oc.h, sig[i]) }
            oc.count.contents().storeBytes(of: UInt32(0), as: UInt32.self)
            // OpenCV: floor(0,5·ct/lag·255) — 0 ved ct 0,02, så alle ekstremer prøves
            var P = Params(w: Int32(oc.w), h: Int32(oc.h), nl: Int32(layers), oct: Int32(o),
                           thr: floorf(0.5 * contrastThreshold / Float(layers) * 255), ct: contrastThreshold,
                           edge: edgeThreshold, sigma: sigma, cap: UInt32(oc.cap))
            enc.setBuffer(oc.gauss, offset: 0, index: 0); enc.setBuffer(oc.cand, offset: 0, index: 1)
            enc.setBuffer(oc.count, offset: 0, index: 2); enc.setBytes(&P, length: MemoryLayout<Params>.stride, index: 3)
            run(enc, pExt, oc.w, oc.h, layers)
        }
        orientedCount.contents().storeBytes(of: UInt32(0), as: UInt32.self)
        for (o, oc) in octaves.enumerated() {
            var P = Params(w: Int32(oc.w), h: Int32(oc.h), nl: Int32(layers), oct: Int32(o), thr: 0, ct: 0, edge: 0,
                           sigma: sigma, cap: UInt32(oc.cap), start: UInt32(oriCap))
            enc.setBuffer(oc.gauss, offset: 0, index: 0); enc.setBuffer(oc.cand, offset: 0, index: 1)
            enc.setBuffer(oc.count, offset: 0, index: 2); enc.setBuffer(oriented, offset: 0, index: 3)
            enc.setBuffer(orientedCount, offset: 0, index: 4); enc.setBytes(&P, length: MemoryLayout<Params>.stride, index: 5)
            run(enc, pOri, oc.cap)
        }
        enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()

        // de sterkeste, uten duplikater (to frø kan forfines til samme punkt)
        let n = min(Int(orientedCount.contents().load(as: UInt32.self)), oriCap)
        let all = UnsafeBufferPointer(start: oriented.contents().bindMemory(to: Keypoint.self, capacity: oriCap), count: n)
        var seen = Set<Int64>(), picked: [Keypoint] = []
        for kp in all.sorted(by: { $0.resp != $1.resp ? $0.resp > $1.resp : ($0.oct, $0.r, $0.c, $0.angle) < ($1.oct, $1.r, $1.c, $1.angle) }) {
            let key = (Int64(kp.oct) << 56) | (Int64(kp.layer) << 52) | (Int64(kp.r) << 36) | (Int64(kp.c) << 20) | Int64((kp.angle * 100).rounded())
            if seen.insert(key).inserted { picked.append(kp) }
            if picked.count == min(maxFeatures, descCap) { break }
        }
        picked.sort { $0.oct < $1.oct }
        let dst = oriented.contents().bindMemory(to: Keypoint.self, capacity: oriCap)
        for (i, kp) in picked.enumerated() { dst[i] = kp }

        guard let cb2 = queue.makeCommandBuffer(), let enc2 = cb2.makeComputeCommandEncoder() else { return ([], []) }
        var start = 0
        for (o, oc) in octaves.enumerated() {
            let count = picked[start...].prefix { $0.oct == Int32(o) }.count
            if count > 0 {
                var P = Params(w: Int32(oc.w), h: Int32(oc.h), nl: Int32(layers), oct: Int32(o), thr: 0, ct: 0, edge: 0,
                               sigma: sigma, cap: UInt32(count), start: UInt32(start))
                enc2.setBuffer(oc.gauss, offset: 0, index: 0); enc2.setBuffer(oriented, offset: 0, index: 1)
                enc2.setBuffer(desc, offset: 0, index: 2); enc2.setBytes(&P, length: MemoryLayout<Params>.stride, index: 3)
                run(enc2, pDesc, count)
            }
            start += count
        }
        enc2.endEncoding(); cb2.commit(); cb2.waitUntilCompleted()

        let features = picked.map { kp -> Feature in
            let s = Float(1 << Int(kp.oct)) * (up ? 0.5 : 1)
            return Feature(x: kp.x * s, y: kp.y * s, size: kp.scl * s * 2, angle: kp.angle, response: kp.resp)
        }
        let d = Array(UnsafeBufferPointer(start: desc.contents().bindMemory(to: UInt8.self, capacity: oriCap * 128), count: picked.count * 128))
        return (features, d)
    }

    /// Nærmeste og nest nærmeste deskriptor (kvadrert L2) i bilde b for hvert trekk i bilde a,
    /// for alle par på én gang — som OpenCVs knnMatch(k=2), alle mot alle. Prototypen (§107)
    /// filtrerer med Lowes forhold på HELE bildet; å sammenligne bare innen søkevinduet slapp
    /// gjennom treff der det riktige punktet lå utenfor (9ef06228: 1,03 px mot 0,58, §109).
    /// Svar per par: (indeks i b, beste, nest beste) for hvert trekk i a.
    /// `descriptors` er alle bildenes deskriptorer etter hverandre (128 byte per trekk), og
    /// bilde f har trekkene `offsets[f]..<offsets[f+1]`.
    func matchAll(descriptors dbuf: MTLBuffer, offsets off: [Int], pairs: [(Int, Int)]) -> [[SIMD3<UInt32>]] {
        guard !pairs.isEmpty, off.last ?? 0 > 0 else { return pairs.map { _ in [] } }
        // jobb = 256 rader av a mot hele b; ut-buffer i biter så toppminnet holdes nede
        struct Job { var pa: UInt32, pb: UInt32, na: UInt32, nb: UInt32, row: UInt32, out: UInt32 }
        var svar = [[SIMD3<UInt32>]](repeating: [], count: pairs.count)
        var p0 = 0
        while p0 < pairs.count {
            var jobs: [Job] = [], outN = 0, p1 = p0
            while p1 < pairs.count && (outN < 4_000_000 || p1 == p0) {
                let (a, b) = pairs[p1]
                let na = off[a + 1] - off[a], nb = off[b + 1] - off[b]
                if na > 0 && nb > 0 {
                    var r = 0
                    while r < na {
                        jobs.append(Job(pa: UInt32(off[a]), pb: UInt32(off[b]), na: UInt32(na), nb: UInt32(nb), row: UInt32(r), out: UInt32(outN + r)))
                        r += 256
                    }
                }
                outN += na; p1 += 1
            }
            guard !jobs.isEmpty, let obuf = device.makeBuffer(length: max(outN, 1) * 16, options: .storageModeShared),
                  let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { p0 = p1; continue }
            enc.setComputePipelineState(pMatch)
            enc.setBuffer(dbuf, offset: 0, index: 0)
            // setBytes tåler bare 4 KB
            guard let jbuf = device.makeBuffer(bytes: jobs, length: jobs.count * MemoryLayout<Job>.stride, options: .storageModeShared) else { enc.endEncoding(); p0 = p1; continue }
            enc.setBuffer(jbuf, offset: 0, index: 1)
            enc.setBuffer(obuf, offset: 0, index: 2)
            enc.dispatchThreadgroups(MTLSize(width: jobs.count, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
            enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
            let o = obuf.contents().bindMemory(to: SIMD4<UInt32>.self, capacity: max(outN, 1))
            var base = 0
            for p in p0..<p1 {
                let (a, b) = pairs[p]
                let na = off[a + 1] - off[a]
                if na > 0 && off[b + 1] > off[b] { svar[p] = (0..<na).map { let v = o[base + $0]; return SIMD3(v.x, v.y, v.z) } }
                base += na
            }
            p0 = p1
        }
        return svar
    }

    /// Relokalisering (§110): ett bildes deskriptorer mot hele kartet. `labels` er landemerket hver
    /// kartrad hører til; nest beste regnes bare blant ANDRE landemerker, ellers dreper samme punkt
    /// sett fra ti nøkkelbilder Lowes forholdstest. Svar per spørretrekk: (kartrad, beste, nest beste).
    /// `fra` er første kartrad (kartet tas i biter så GPU-en slipper til kamerabildet mellom dem);
    /// kartradene i svaret er absolutte.
    func matchMot(query: [UInt8], map mbuf: MTLBuffer, labels lbuf: MTLBuffer, count nb: Int, fra: Int = 0) -> [SIMD3<UInt32>] {
        let na = query.count / 128
        guard na > 0, nb > 0, let qbuf = device.makeBuffer(bytes: query, length: query.count, options: .storageModeShared),
              let obuf = device.makeBuffer(length: na * 16, options: .storageModeShared) else { return [] }
        struct Job { var pa: UInt32, pb: UInt32, na: UInt32, nb: UInt32, row: UInt32, out: UInt32 }
        var jobs: [Job] = []
        var r = 0
        while r < na { jobs.append(Job(pa: 0, pb: UInt32(fra), na: UInt32(na), nb: UInt32(nb), row: UInt32(r), out: UInt32(r))); r += 256 }
        guard let jbuf = device.makeBuffer(bytes: jobs, length: jobs.count * MemoryLayout<Job>.stride, options: .storageModeShared),
              let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return [] }
        enc.setComputePipelineState(pMatchLm)
        enc.setBuffer(qbuf, offset: 0, index: 0)
        enc.setBuffer(jbuf, offset: 0, index: 1)
        enc.setBuffer(obuf, offset: 0, index: 2)
        enc.setBuffer(mbuf, offset: 0, index: 3)
        enc.setBuffer(lbuf, offset: 0, index: 4)
        enc.dispatchThreadgroups(MTLSize(width: jobs.count, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
        enc.endEncoding(); cb.commit(); cb.waitUntilCompleted()
        let o = obuf.contents().bindMemory(to: SIMD4<UInt32>.self, capacity: na)
        return (0..<na).map { SIMD3(o[$0].x, o[$0].y, o[$0].z) }
    }

    private static let source = """
    #include <metal_stdlib>
    using namespace metal;

    struct KP { float x, y, scl, resp, angle; int oct, layer, r, c; int p0, p1, p2; };
    struct P { int w, h, nl, oct; float thr, ct, edge, sigma; uint cap, start, p1, p2; };

    inline int refl(int i, int n) { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; return clamp(i, 0, n - 1); }

    // u8 → float 0–255, med CLAHE-oppslag interpolert mellom flisene (som OpenCV)
    kernel void sift_base(device const uchar* src [[buffer(0)]], device const uchar* lut [[buffer(1)]],
                          device float* dst [[buffer(2)]], constant int4& p [[buffer(3)]], uint2 g [[thread_position_in_grid]]) {
        int w = p.x, h = p.y, tx = p.z, ty = p.w;
        if (int(g.x) >= w || int(g.y) >= h) return;
        float txf = float(g.x) / float(w / tx) - 0.5, tyf = float(g.y) / float(h / ty) - 0.5;
        int x1 = int(floor(txf)), y1 = int(floor(tyf));
        float xa = txf - x1, ya = tyf - y1;
        int x2 = min(x1 + 1, tx - 1), y2 = min(y1 + 1, ty - 1); x1 = max(x1, 0); y1 = max(y1, 0);
        int v = src[g.y * w + g.x];
        float r = (lut[(y1 * tx + x1) * 256 + v] * (1 - xa) + lut[(y1 * tx + x2) * 256 + v] * xa) * (1 - ya)
                + (lut[(y2 * tx + x1) * 256 + v] * (1 - xa) + lut[(y2 * tx + x2) * 256 + v] * xa) * ya;
        dst[g.y * w + g.x] = clamp(rint(r), 0.0, 255.0);
    }

    kernel void sift_blur_h(device const float* s [[buffer(0)]], device float* d [[buffer(1)]], constant float* wt [[buffer(2)]],
                            constant int4& p [[buffer(3)]], uint2 g [[thread_position_in_grid]]) {
        int w = p.x, h = p.y, R = p.z;
        if (int(g.x) >= w || int(g.y) >= h) return;
        device const float* row = s + g.y * w;
        float a = 0;
        for (int k = -R; k <= R; k++) a += wt[k + R] * row[refl(int(g.x) + k, w)];
        d[g.y * w + g.x] = a;
    }

    kernel void sift_blur_v(device const float* s [[buffer(0)]], device float* d [[buffer(1)]], constant float* wt [[buffer(2)]],
                            constant int4& p [[buffer(3)]], uint2 g [[thread_position_in_grid]]) {
        int w = p.x, h = p.y, R = p.z;
        if (int(g.x) >= w || int(g.y) >= h) return;
        float a = 0;
        for (int k = -R; k <= R; k++) a += wt[k + R] * s[refl(int(g.y) + k, h) * w + g.x];
        d[g.y * w + g.x] = a;
    }

    // neste oktav: hvert andre piksel av laget med σ·2 (OpenCV INTER_NEAREST)
    kernel void sift_down(device const float* s [[buffer(0)]], device float* d [[buffer(1)]], constant int4& p [[buffer(2)]],
                          uint2 g [[thread_position_in_grid]]) {
        if (int(g.x) >= p.x || int(g.y) >= p.y) return;
        d[g.y * p.x + g.x] = s[(2 * g.y) * p.z + 2 * g.x];
    }

    // 2× bilineær med halvpikselsentre (OpenCV INTER_LINEAR)
    kernel void sift_up(device const float* s [[buffer(0)]], device float* d [[buffer(1)]], constant int4& p [[buffer(2)]],
                        uint2 g [[thread_position_in_grid]]) {
        int w = p.x, h = p.y;
        if (int(g.x) >= 2 * w || int(g.y) >= 2 * h) return;
        float fx = (g.x + 0.5) * 0.5 - 0.5, fy = (g.y + 0.5) * 0.5 - 0.5;
        int x0 = int(floor(fx)), y0 = int(floor(fy));
        float ax = fx - x0, ay = fy - y0;
        int x1 = clamp(x0 + 1, 0, w - 1), y1 = clamp(y0 + 1, 0, h - 1); x0 = clamp(x0, 0, w - 1); y0 = clamp(y0, 0, h - 1);
        d[g.y * 2 * w + g.x] = (s[y0 * w + x0] * (1 - ax) + s[y0 * w + x1] * ax) * (1 - ay)
                             + (s[y1 * w + x0] * (1 - ax) + s[y1 * w + x1] * ax) * ay;
    }

    inline bool solve3(float3 c0, float3 c1, float3 c2, float3 b, thread float3& x) {
        float det = dot(c0, cross(c1, c2));
        if (det == 0 || !isfinite(det)) return false;
        x = float3(dot(b, cross(c1, c2)), dot(c0, cross(b, c2)), dot(c0, cross(c1, b))) / det;
        return all(isfinite(x));
    }

    kernel void sift_extrema(device const float* gauss [[buffer(0)]], device KP* out [[buffer(1)]],
                             device atomic_uint* count [[buffer(2)]], constant P& q [[buffer(3)]],
                             uint3 g [[thread_position_in_grid]]) {
        const int B = 5;
        int w = q.w, h = q.h, nl = q.nl;
        int c = g.x, r = g.y, layer = g.z + 1;
        if (c < B || c >= w - B || r < B || r >= h - B || layer > nl) return;
        size_t plane = size_t(w) * h;
        // DoG lag l = gauss l+1 − gauss l, regnet der det leses
        #define D(l, y, x) (gauss[size_t((l) + 1) * plane + size_t(y) * w + (x)] - gauss[size_t(l) * plane + size_t(y) * w + (x)])
        float val = D(layer, r, c);
        if (!(fabs(val) > q.thr)) return;
        bool mx = val > 0;
        for (int dl = -1; dl <= 1; dl++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            if (dl == 0 && dy == 0 && dx == 0) continue;
            float v = D(layer + dl, r + dy, c + dx);
            if (mx ? (val < v) : (val > v)) return;
        }
        const float is = 1.0 / 255, ds = is * 0.5, sds = is, cds = is * 0.25;
        float xi = 0, xr = 0, xc = 0;
        int i = 0;
        for (; i < 5; i++) {
            float3 dD = float3(D(layer, r, c + 1) - D(layer, r, c - 1), D(layer, r + 1, c) - D(layer, r - 1, c),
                               D(layer + 1, r, c) - D(layer - 1, r, c)) * ds;
            float v2 = D(layer, r, c) * 2;
            float dxx = (D(layer, r, c + 1) + D(layer, r, c - 1) - v2) * sds;
            float dyy = (D(layer, r + 1, c) + D(layer, r - 1, c) - v2) * sds;
            float dss = (D(layer + 1, r, c) + D(layer - 1, r, c) - v2) * sds;
            float dxy = (D(layer, r + 1, c + 1) - D(layer, r + 1, c - 1) - D(layer, r - 1, c + 1) + D(layer, r - 1, c - 1)) * cds;
            float dxs = (D(layer + 1, r, c + 1) - D(layer + 1, r, c - 1) - D(layer - 1, r, c + 1) + D(layer - 1, r, c - 1)) * cds;
            float dys = (D(layer + 1, r + 1, c) - D(layer + 1, r - 1, c) - D(layer - 1, r + 1, c) + D(layer - 1, r - 1, c)) * cds;
            float3 X;
            if (!solve3(float3(dxx, dxy, dxs), float3(dxy, dyy, dys), float3(dxs, dys, dss), dD, X)) return;
            xi = -X.z; xr = -X.y; xc = -X.x;
            if (fabs(xi) < 0.5 && fabs(xr) < 0.5 && fabs(xc) < 0.5) break;
            if (fabs(xi) > 1e6 || fabs(xr) > 1e6 || fabs(xc) > 1e6) return;
            c += int(rint(xc)); r += int(rint(xr)); layer += int(rint(xi));
            if (layer < 1 || layer > nl || c < B || c >= w - B || r < B || r >= h - B) return;
        }
        if (i >= 5) return;
        float3 dD = float3(D(layer, r, c + 1) - D(layer, r, c - 1), D(layer, r + 1, c) - D(layer, r - 1, c),
                           D(layer + 1, r, c) - D(layer - 1, r, c)) * ds;
        float contr = D(layer, r, c) * is + dot(dD, float3(xc, xr, xi)) * 0.5;
        if (fabs(contr) * nl < q.ct) return;
        float v2 = D(layer, r, c) * 2;
        float dxx = (D(layer, r, c + 1) + D(layer, r, c - 1) - v2) * sds;
        float dyy = (D(layer, r + 1, c) + D(layer, r - 1, c) - v2) * sds;
        float dxy = (D(layer, r + 1, c + 1) - D(layer, r + 1, c - 1) - D(layer, r - 1, c + 1) + D(layer, r - 1, c - 1)) * cds;
        float tr = dxx + dyy, det = dxx * dyy - dxy * dxy;
        if (det <= 0 || tr * tr * q.edge >= (q.edge + 1) * (q.edge + 1) * det) return;
        #undef D
        KP k;
        k.x = c + xc; k.y = r + xr; k.scl = q.sigma * pow(2.0, (layer + xi) / nl); k.resp = fabs(contr); k.angle = 0;
        k.oct = q.oct; k.layer = layer; k.r = r; k.c = c; k.p0 = k.p1 = k.p2 = 0;
        uint slot = atomic_fetch_add_explicit(count, 1, memory_order_relaxed);
        if (slot < q.cap) out[slot] = k;
    }

    kernel void sift_orient(device const float* gauss [[buffer(0)]], device const KP* cand [[buffer(1)]],
                            device const uint* ccount [[buffer(2)]], device KP* out [[buffer(3)]],
                            device atomic_uint* ocount [[buffer(4)]], constant P& q [[buffer(5)]],
                            uint gid [[thread_position_in_grid]]) {
        if (gid >= min(ccount[0], q.cap)) return;
        KP k = cand[gid];
        int w = q.w, h = q.h;
        device const float* img = gauss + size_t(k.layer) * w * h;
        const int n = 36;
        int radius = int(rint(4.5 * k.scl));
        float sw = 1.5 * k.scl, es = -1.0 / (2 * sw * sw);
        float hist[n];
        for (int i = 0; i < n; i++) hist[i] = 0;
        for (int i = -radius; i <= radius; i++) {
            int y = k.r + i;
            if (y <= 0 || y >= h - 1) continue;
            for (int j = -radius; j <= radius; j++) {
                int x = k.c + j;
                if (x <= 0 || x >= w - 1) continue;
                float dx = img[y * w + x + 1] - img[y * w + x - 1], dy = img[(y - 1) * w + x] - img[(y + 1) * w + x];
                float ori = atan2(dy, dx) * (180 / M_PI_F); if (ori < 0) ori += 360;
                int bin = int(rint(n / 360.0 * ori)); if (bin >= n) bin -= n; if (bin < 0) bin += n;
                hist[bin] += exp((i * i + j * j) * es) * sqrt(dx * dx + dy * dy);
            }
        }
        float s[n], omax = 0;
        for (int i = 0; i < n; i++) {
            s[i] = (hist[(i + n - 2) % n] + hist[(i + 2) % n]) * (1.0 / 16) + (hist[(i + n - 1) % n] + hist[(i + 1) % n]) * (4.0 / 16)
                 + hist[i] * (6.0 / 16);
            omax = max(omax, s[i]);
        }
        float thr = omax * 0.8;
        for (int j = 0; j < n; j++) {
            float l = s[(j + n - 1) % n], rr = s[(j + 1) % n];
            if (s[j] > l && s[j] > rr && s[j] >= thr) {
                float bin = j + 0.5 * (l - rr) / (l - 2 * s[j] + rr);
                bin = bin < 0 ? n + bin : bin >= n ? bin - n : bin;
                KP o = k;
                o.angle = 360 - (360.0 / n) * bin;
                if (fabs(o.angle - 360) < FLT_EPSILON) o.angle = 0;
                uint slot = atomic_fetch_add_explicit(ocount, 1, memory_order_relaxed);
                if (slot < q.start) out[slot] = o;
            }
        }
    }

    struct MJob { uint pa, pb, na, nb, row, out; };

    // alle mot alle, 256 trekk fra a per trådgruppe; b strømmes gjennom trådgruppeminnet
    kernel void sift_match(device const uint* D [[buffer(0)]], device const MJob* jobs [[buffer(1)]],
                           device uint4* out [[buffer(2)]], uint tg [[threadgroup_position_in_grid]],
                           uint lid [[thread_position_in_threadgroup]]) {
        MJob J = jobs[tg];
        uint row = J.row + lid;
        bool active = row < J.na;
        uint a[32];
        for (int k = 0; k < 32; k++) a[k] = active ? D[(J.pa + row) * 32 + k] : 0;
        threadgroup uint tile[64 * 32];
        uint best = 0xffffffff, second = 0xffffffff, bi = 0;
        for (uint t0 = 0; t0 < J.nb; t0 += 64) {
            uint cnt = min(64u, J.nb - t0);
            for (uint k = lid; k < cnt * 32; k += 256) tile[k] = D[(J.pb + t0) * 32 + k];
            threadgroup_barrier(mem_flags::mem_threadgroup);
            if (active) {
                for (uint b = 0; b < cnt; b++) {
                    uint d = 0;
                    for (int k = 0; k < 32; k++) {
                        int4 x = int4(as_type<uchar4>(a[k])) - int4(as_type<uchar4>(tile[b * 32 + k]));
                        d += uint(x.x * x.x + x.y * x.y + x.z * x.z + x.w * x.w);
                    }
                    if (d < best) { second = best; best = d; bi = t0 + b; } else if (d < second) { second = d; }
                }
            }
            threadgroup_barrier(mem_flags::mem_threadgroup);
        }
        if (active) out[J.out + lid] = uint4(bi, best, second, 0);
    }

    // som sift_match, men a og b i hver sin buffer, og nest beste bare blant andre landemerker
    kernel void sift_match_lm(device const uint* A [[buffer(0)]], device const MJob* jobs [[buffer(1)]],
                              device uint4* out [[buffer(2)]], device const uint* B [[buffer(3)]],
                              device const uint* L [[buffer(4)]], uint tg [[threadgroup_position_in_grid]],
                              uint lid [[thread_position_in_threadgroup]]) {
        MJob J = jobs[tg];
        uint row = J.row + lid;
        bool active = row < J.na;
        uint a[32];
        for (int k = 0; k < 32; k++) a[k] = active ? A[row * 32 + k] : 0;
        threadgroup uint tile[64 * 32];
        threadgroup uint tl[64];
        uint best = 0xffffffff, second = 0xffffffff, bi = 0, bl = 0xffffffff;
        for (uint t0 = 0; t0 < J.nb; t0 += 64) {
            uint cnt = min(64u, J.nb - t0);
            for (uint k = lid; k < cnt * 32; k += 256) tile[k] = B[(J.pb + t0) * 32 + k];
            if (lid < cnt) tl[lid] = L[J.pb + t0 + lid];
            threadgroup_barrier(mem_flags::mem_threadgroup);
            if (active) {
                for (uint b = 0; b < cnt; b++) {
                    uint d = 0;
                    for (int k = 0; k < 32; k++) {
                        int4 x = int4(as_type<uchar4>(a[k])) - int4(as_type<uchar4>(tile[b * 32 + k]));
                        d += uint(x.x * x.x + x.y * x.y + x.z * x.z + x.w * x.w);
                    }
                    uint l = tl[b];
                    if (l == bl) { if (d < best) { best = d; bi = J.pb + t0 + b; } }
                    else if (d < best) { second = best; best = d; bi = J.pb + t0 + b; bl = l; }
                    else if (d < second) { second = d; }
                }
            }
            threadgroup_barrier(mem_flags::mem_threadgroup);
        }
        if (active) out[J.out + lid] = uint4(bi, best, second, 0);
    }

    kernel void sift_desc(device const float* gauss [[buffer(0)]], device const KP* kps [[buffer(1)]],
                          device uchar* out [[buffer(2)]], constant P& q [[buffer(3)]], uint gid [[thread_position_in_grid]]) {
        if (gid >= q.cap) return;
        uint idx = q.start + gid;
        KP k = kps[idx];
        int w = q.w, h = q.h;
        device const float* img = gauss + size_t(k.layer) * w * h;
        const int d = 4, n = 8;
        float ang = 360 - k.angle; if (fabs(ang - 360) < FLT_EPSILON) ang = 0;
        float cos_t = cos(ang * (M_PI_F / 180)), sin_t = sin(ang * (M_PI_F / 180));
        const float bpr = n / 360.0, es = -1.0 / (d * d * 0.5);
        float hw = 3 * k.scl;
        int radius = min(int(rint(hw * 1.4142135 * (d + 1) * 0.5)), int(sqrt(float(w * w + h * h))));
        cos_t /= hw; sin_t /= hw;
        int px = int(rint(k.x)), py = int(rint(k.y));
        float hist[(d + 2) * (d + 2) * (n + 2)];
        for (int i = 0; i < (d + 2) * (d + 2) * (n + 2); i++) hist[i] = 0;
        for (int i = -radius; i <= radius; i++) {
            int r = py + i;
            if (r <= 0 || r >= h - 1) continue;
            for (int j = -radius; j <= radius; j++) {
                float c_rot = j * cos_t - i * sin_t, r_rot = j * sin_t + i * cos_t;
                float rbin = r_rot + d / 2 - 0.5, cbin = c_rot + d / 2 - 0.5;
                int c = px + j;
                if (!(rbin > -1 && rbin < d && cbin > -1 && cbin < d && c > 0 && c < w - 1)) continue;
                float dx = img[r * w + c + 1] - img[r * w + c - 1], dy = img[(r - 1) * w + c] - img[(r + 1) * w + c];
                float ori = atan2(dy, dx) * (180 / M_PI_F); if (ori < 0) ori += 360;
                float mag = sqrt(dx * dx + dy * dy) * exp((c_rot * c_rot + r_rot * r_rot) * es);
                float obin = (ori - ang) * bpr;
                int r0 = int(floor(rbin)), c0 = int(floor(cbin)), o0 = int(floor(obin));
                rbin -= r0; cbin -= c0; obin -= o0;
                if (o0 < 0) o0 += n; if (o0 >= n) o0 -= n;
                float v_r1 = mag * rbin, v_r0 = mag - v_r1;
                float v_rc11 = v_r1 * cbin, v_rc10 = v_r1 - v_rc11, v_rc01 = v_r0 * cbin, v_rc00 = v_r0 - v_rc01;
                float v_rco111 = v_rc11 * obin, v_rco110 = v_rc11 - v_rco111, v_rco101 = v_rc10 * obin, v_rco100 = v_rc10 - v_rco101;
                float v_rco011 = v_rc01 * obin, v_rco010 = v_rc01 - v_rco011, v_rco001 = v_rc00 * obin, v_rco000 = v_rc00 - v_rco001;
                int id = ((r0 + 1) * (d + 2) + c0 + 1) * (n + 2) + o0;
                hist[id] += v_rco000; hist[id + 1] += v_rco001;
                hist[id + (n + 2)] += v_rco010; hist[id + (n + 3)] += v_rco011;
                hist[id + (d + 2) * (n + 2)] += v_rco100; hist[id + (d + 2) * (n + 2) + 1] += v_rco101;
                hist[id + (d + 3) * (n + 2)] += v_rco110; hist[id + (d + 3) * (n + 2) + 1] += v_rco111;
            }
        }
        float dst[d * d * n], nrm = 0;
        for (int i = 0; i < d; i++) for (int j = 0; j < d; j++) {
            int id = ((i + 1) * (d + 2) + (j + 1)) * (n + 2);
            hist[id] += hist[id + n]; hist[id + 1] += hist[id + n + 1];
            for (int kk = 0; kk < n; kk++) { float v = hist[id + kk]; dst[(i * d + j) * n + kk] = v; nrm += v * v; }
        }
        float thr = sqrt(nrm) * 0.2; nrm = 0;
        for (int i = 0; i < d * d * n; i++) { float v = min(dst[i], thr); dst[i] = v; nrm += v * v; }
        nrm = 512 / max(sqrt(nrm), FLT_EPSILON);
        for (int i = 0; i < d * d * n; i++) out[idx * 128 + i] = uchar(clamp(rint(dst[i] * nrm), 0.0, 255.0));
    }
    """
}
