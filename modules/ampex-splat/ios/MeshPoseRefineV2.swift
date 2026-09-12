import Foundation
import simd

/// Zhou-Koltun (SIGGRAPH 2014) RIGID fargekart-optimalisering, minimal CPU-port:
/// ARKit-poser drifter på cm-nivå, så selv perfekte keyframes prosjiserer SMURT.
/// Vi holder geometrien fast, gir hver mesh-verteks en proxy-gråtone (snitt over
/// synlige frames), og Gauss-Newton-justerer hver keyframes 6-DoF-pose så dens
/// bilde stemmer med proxyen. Alternering proxy ↔ poser konvergerer på få runder.
/// Kjøres FØR vinner-valg/bake — angriper årsaken til uskarphet, ikke symptomet.
/// (Referanse: Open3D pipelines::color_map, MIT. Ikke-rigid warp er bevisst utelatt
/// i første versjon — mål effekten på fixture før mer kompleksitet.)
@available(iOS 14.0, *)
enum MeshPoseRefineV2 {

    // Warp-rutenettets dimensjoner — delt med baken (blend=all sampler gjennom samme rutenett).
    // 8×5: aggressivt finere (12×8, løsere λ) SENKET residualen men REV opp blanke vegger —
    // teksturløse flater har ikke gradient å justere mot, så løsere regularisering lot punktene
    // drive og rive. Residual er IKKE en trygg proxy for utseende (device 2026-08-25).
    // 12×8 er trygt FORDI reguleringen nå er adaptiv (se warpLambda i refine). Uten den
    // rev dette opp blanke vegger — kommentaren over gjaldt fast λ.
    // ── WARP-RUTENETTETS OPPLØSNING (2026-09-12, §94). 12×8 over et 3840-bredt foto er
    // celler på 320 piksler. Warpen kan da bare rette en GLOBAL bøy, ikke den lokale
    // uenigheten mellom syn — og det er den lokale som smører detaljen når man snitter.
    //
    // Målt hvorfor det betyr noe: panelfixturen har ~1400 texler/m (0,7 mm per texel), og
    // synene er ~2 px uenige i fotoet ≈ 1,5 mm ≈ TO texler. Et 3 mm panelspor smøres da
    // bort av snittet. På et stort rom er texelen 2–3 mm, samme uenighet er under én texel,
    // og der smører snittet ingenting. Snitting krever altså sub-texel justering.
    // meshscan.warpgrid setter cellebredden i bilder à 12 kolonner (3 = 36×24).
    static var warpGridW: Int { 12 * warpGridMul }
    static var warpGridH: Int { 8 * warpGridMul }
    static var warpGridMul: Int {
        let v = Int(UserDefaults.standard.string(forKey: "meshscan.warpgrid") ?? "") ?? 1
        return max(1, min(8, v))
    }


    // Residualen må følge tilstanden som faktisk ble målt, aldri GN-steget den
    // foreslår. Identitet/original beholdes dersom ingen gyldig måling finnes.
    struct EvaluatedState<Value> {
        private(set) var value: Value
        private(set) var residual: Float?

        init(_ initial: Value) { value = initial }

        mutating func consider(_ candidate: Value, residual next: Float, samples: Int) {
            guard samples > 0, next.isFinite, next >= 0 else { return }
            guard residual == nil || next < residual! else { return }
            value = candidate
            residual = next
        }
    }

    // BEGIN PANEL_PHASE_ANCHOR
    /// Evidence only: this helper never changes cameras, labels, or warp grids.
    /// Inputs share a planar image coordinate system whose y axis is the observed
    /// panel-line normal. Center masks come from image bounds + recorded depth;
    /// local image context may extend beyond the mesh onto a trim/edge (§60).
    enum PanelPhaseAnchor {
        struct Image {
            let width: Int
            let height: Int
            let luma: [Float]       // 0...1; raw photo samples, not baked texture
            let validCenter: [UInt8]
        }
        struct Anchor: Codable {
            let source: SIMD2<Float>
            let target: SIMD2<Float>
            let correlation: Float
            let peakGap: Float // forward ambiguity margin; reverse is a best-match consistency test
            let reversePeakGap: Float
            let mutualError: Float
        }
        struct Evidence: Codable {
            let anchors: [Anchor]
            let midpoint: Float
            let phase: Float
            let slope: Float
            let spanMeters: Float
            let minimumCorrelation: Float
            let minimumPeakGap: Float
            let maximumMutualError: Float
            func normalShift(at coordinate: Float) -> Float { phase + slope * (coordinate - midpoint) }
        }
        struct Search: Codable {
            let evidence: Evidence?
            let candidates: Int
            let evaluated: Int
            let seconds: Double
        }
        private struct Peak { var point: SIMD2<Float>; var score: Float }
        private struct Match { var point: SIMD2<Float>; var score: Float; var gap: Float }

        private static func reflect(_ i: Int, _ count: Int) -> Int {
            var p = i
            while p < 0 || p >= count { p = p < 0 ? -p : 2 * count - 2 - p }
            return p
        }
        private static func blur(_ input: [Float], _ width: Int, _ height: Int, _ sigma: Float) -> [Float] {
            let size = Int((sigma * 8 + 1).rounded()) | 1, radius = size / 2
            var kernel = (-radius...radius).map { exp(-Float($0 * $0) / (2 * sigma * sigma)) }
            let sum = kernel.reduce(0, +)
            for i in kernel.indices { kernel[i] /= sum }
            var temporary = [Float](repeating: 0, count: input.count), output = temporary
            for y in 0..<height { for x in 0..<width {
                var value: Float = 0
                for k in -radius...radius { value += input[y * width + reflect(x + k, width)] * kernel[k + radius] }
                temporary[y * width + x] = value
            } }
            for y in 0..<height { for x in 0..<width {
                var value: Float = 0
                for k in -radius...radius { value += temporary[reflect(y + k, height) * width + x] * kernel[k + radius] }
                output[y * width + x] = value
            } }
            return output
        }
        private static func pixel(_ image: [Float], _ width: Int, _ height: Int, _ p: SIMD2<Float>) -> Float {
            let px = max(0, min(Float(width - 2), p.x)), py = max(0, min(Float(height - 2), p.y))
            let x = Int(px), y = Int(py), a = px - Float(x), b = py - Float(y), i = y * width + x
            return (image[i] * (1 - a) + image[i + 1] * a) * (1 - b)
                + (image[i + width] * (1 - a) + image[i + width + 1] * a) * b
        }
        private static func patch(_ image: [Float], _ width: Int, _ height: Int,
                                  _ center: SIMD2<Float>, _ radius: Int) -> [Float] {
            var values = [Float](); values.reserveCapacity((2 * radius + 1) * (2 * radius + 1))
            for y in -radius...radius { for x in -radius...radius {
                values.append(pixel(image, width, height, center + SIMD2(Float(x), Float(y))))
            } }
            let mean = values.reduce(0, +) / Float(values.count)
            var norm: Float = 0
            for i in values.indices { values[i] -= mean; norm += values[i] * values[i] }
            guard norm > 1e-12 else { return [] }
            norm = sqrt(norm)
            for i in values.indices { values[i] /= norm }
            return values
        }
        private static func score(_ template: [Float], _ image: [Float], _ width: Int, _ height: Int,
                                  _ center: SIMD2<Float>, _ radius: Int) -> Float {
            var sum: Double = 0, squares: Double = 0, product: Double = 0, i = 0
            for y in -radius...radius { for x in -radius...radius {
                let value = Double(pixel(image, width, height, center + SIMD2(Float(x), Float(y))))
                sum += value; squares += value * value; product += Double(template[i]) * value; i += 1
            } }
            let variance = squares - sum * sum / Double(i)
            return variance > 1e-14 ? Float(product / sqrt(variance)) : -1
        }
        private static func refineCorner(_ image: [Float], _ width: Int, _ height: Int,
                                         _ initial: SIMD2<Float>) -> SIMD2<Float> {
            // Weighted gradient-line intersection; subpixel seed location matters
            // for the small trim marks, independently of target peak refinement.
            var point = initial
            for _ in 0..<30 {
                var xx: Double = 0, xy: Double = 0, yy: Double = 0, bx: Double = 0, by: Double = 0
                for y in -3...3 { for x in -3...3 {
                    let p = point + SIMD2(Float(x), Float(y))
                    let dx = Double(pixel(image, width, height, p + SIMD2(1, 0)) - pixel(image, width, height, p - SIMD2(1, 0)))
                    let dy = Double(pixel(image, width, height, p + SIMD2(0, 1)) - pixel(image, width, height, p - SIMD2(0, 1)))
                    let weight = exp(-Double(x * x + y * y) / 9)
                    let a = dx * dx * weight, b = dx * dy * weight, c = dy * dy * weight
                    xx += a; xy += b; yy += c
                    bx += a * Double(x) + b * Double(y); by += b * Double(x) + c * Double(y)
                } }
                let determinant = xx * yy - xy * xy
                guard abs(determinant) > 1e-24 else { break }
                let step = SIMD2(Float((yy * bx - xy * by) / determinant), Float((xx * by - xy * bx) / determinant))
                let next = point + step
                guard next.x >= 4, next.y >= 4, next.x < Float(width - 4), next.y < Float(height - 4) else { break }
                point = next
                if simd_length_squared(step) <= 0.0001 { break }
            }
            return abs(point.x - initial.x) <= 3 && abs(point.y - initial.y) <= 3 ? point : initial
        }
        private static func corners(_ image: Image, _ margin: Int, _ budget: Int) -> [SIMD2<Float>] {
            let w = image.width, h = image.height, smoothed = blur(image.luma, w, h, 1)
            var gradients = [SIMD3<Float>](repeating: .zero, count: w * h)
            for y in 1..<(h - 1) { for x in 1..<(w - 1) {
                let i = y * w + x
                let dx = (smoothed[i - w + 1] + 2 * smoothed[i + 1] + smoothed[i + w + 1]
                          - smoothed[i - w - 1] - 2 * smoothed[i - 1] - smoothed[i + w - 1]) / 20
                let dy = (smoothed[i + w - 1] + 2 * smoothed[i + w] + smoothed[i + w + 1]
                          - smoothed[i - w - 1] - 2 * smoothed[i - w] - smoothed[i - w + 1]) / 20
                gradients[i] = SIMD3(dx * dx, dx * dy, dy * dy)
            } }
            var scores = [Float](repeating: 0, count: w * h)
            for y in 3..<(h - 3) { for x in 3..<(w - 3) where image.validCenter[y * w + x] != 0 {
                var tensor = SIMD3<Float>.zero
                for dy in -2...2 { for dx in -2...2 { tensor += gradients[(y + dy) * w + x + dx] } }
                let mean = (tensor.x + tensor.z) / 2
                let root = sqrt(max(0, (tensor.x - tensor.z) * (tensor.x - tensor.z) / 4 + tensor.y * tensor.y))
                let low = mean - root, high = mean + root
                if low > high * 0.1 && low > 0.5 / (255 * 255) { scores[y * w + x] = low }
            } }
            var candidates = [(Float, Int)]()
            for y in margin..<(h - margin) { for x in margin..<(w - margin) {
                let i = y * w + x, value = scores[i]
                guard value > 0 else { continue }
                var maximum = true
                for dy in -4...4 { for dx in -4...4 where scores[(y + dy) * w + x + dx] > value { maximum = false } }
                if maximum { candidates.append((value, i)) }
            } }
            candidates.sort { $0.0 == $1.0 ? $0.1 < $1.1 : $0.0 > $1.0 }
            let precise = blur(image.luma, w, h, 0.8)
            return candidates.prefix(budget).map {
                refineCorner(precise, w, h, SIMD2(Float($0.1 % w), Float($0.1 / w)))
            }
        }
        private static func match(_ reference: [Float], _ target: [Float], _ width: Int, _ height: Int,
                                  _ source: SIMD2<Float>, _ radius: Int, requireUnique: Bool = true) -> Match? {
            let outer = patch(reference, width, height, source, 10), inner = patch(reference, width, height, source, 6)
            guard !outer.isEmpty, !inner.isEmpty else { return nil }
            let base = SIMD2(Float(source.x.rounded()), Float(source.y.rounded()))
            let side = 2 * radius + 1
            var scores = [Float](repeating: -1, count: side * side)
            for y in -radius...radius { for x in -radius...radius {
                let p = base + SIMD2(Float(x), Float(y))
                let large = score(outer, target, width, height, p, 10)
                // A low outer score cannot meet .85 NCC or challenge an accepted
                // peak's .10 margin. Skipping its inner patch is conservative.
                scores[(y + radius) * side + x + radius] = large < 0.7 ? large
                    : min(large, score(inner, target, width, height, p, 6))
            } }
            var peaks = [Peak]()
            for y in 0..<side { for x in 0..<side {
                let value = scores[y * side + x]
                guard value >= 0.7 else { continue }
                var localMaximum = true
                for yy in max(0, y - 7)...min(side - 1, y + 7) {
                    for xx in max(0, x - 7)...min(side - 1, x + 7) where scores[yy * side + xx] > value { localMaximum = false }
                }
                if localMaximum { peaks.append(Peak(point: base + SIMD2(Float(x - radius), Float(y - radius)), score: value)) }
            } }
            peaks.sort { $0.score > $1.score }
            var refined = [Peak]()
            for peak in peaks.prefix(6) {
                var best = Peak(point: peak.point, score: -1)
                for y in -3...3 { for x in -3...3 {
                    let p = peak.point + SIMD2(Float(x), Float(y)) * 0.25
                    let value = min(score(outer, target, width, height, p, 10), score(inner, target, width, height, p, 6))
                    if value > best.score { best = Peak(point: p, score: value) }
                } }
                refined.append(best)
            }
            refined.sort { $0.score > $1.score }
            guard let best = refined.first else { return nil }
            let rival = refined.dropFirst().filter { simd_distance($0.point, best.point) > 8 }.map(\.score).max() ?? -1
            let gap = best.score - rival
            guard best.score >= 0.85, (!requireUnique || gap >= 0.10),
                  abs(best.point.x - base.x) < Float(radius), abs(best.point.y - base.y) < Float(radius) else { return nil }
            return Match(point: best.point, score: best.score, gap: gap)
        }
        static func find(reference: Image, target: Image, pixelsPerMeter: Float, periodPixels: Float,
                         candidateBudget: Int = 64) -> Search {
            let start = Date(), w = reference.width, h = reference.height
            func result(_ evidence: Evidence?, _ candidates: Int, _ evaluated: Int) -> Search {
                Search(evidence: evidence, candidates: candidates, evaluated: evaluated, seconds: Date().timeIntervalSince(start))
            }
            guard w > 160, h > 160, w <= 4096, h <= 4096, w * h <= 4_194_304,
                  w == target.width, h == target.height,
                  reference.luma.count == w * h, target.luma.count == w * h,
                  reference.validCenter.count == w * h, target.validCenter.count == w * h,
                  pixelsPerMeter.isFinite, pixelsPerMeter > 0, periodPixels.isFinite, periodPixels >= 8,
                  reference.luma.allSatisfy({ $0.isFinite }), target.luma.allSatisfy({ $0.isFinite }) else { return result(nil, 0, 0) }
            let radius = min(96, max(12, Int((periodPixels * 1.3).rounded())))
            let margin = radius + 12
            guard w > margin * 2, h > margin * 2 else { return result(nil, 0, 0) }
            let seeds = corners(reference, margin, min(256, max(1, candidateBudget)))
            guard seeds.count >= 2 else { return result(nil, seeds.count, 0) }
            let refLow = blur(reference.luma, w, h, 8), targetLow = blur(target.luma, w, h, 8)
            let refHigh = zip(reference.luma, refLow).map(-), targetHigh = zip(target.luma, targetLow).map(-)
            var anchors = [Anchor](), evaluated = 0
            for seed in seeds {
                evaluated += 1
                guard let forward = match(refHigh, targetHigh, w, h, seed, radius),
                      simd_distance(seed, forward.point) < pixelsPerMeter * 0.05,
                      abs(forward.point.y - seed.y) < periodPixels * 0.45 else { continue }
                let tx = Int(forward.point.x.rounded()), ty = Int(forward.point.y.rounded())
                guard tx >= margin, ty >= margin, tx < w - margin, ty < h - margin,
                      target.validCenter[ty * w + tx] != 0,
                      anchors.allSatisfy({ simd_distance(seed, $0.source) >= pixelsPerMeter * 0.08
                          && simd_distance(forward.point, $0.target) >= pixelsPerMeter * 0.08 }),
                      let reverse = match(targetHigh, refHigh, w, h, forward.point, radius, requireUnique: false) else { continue }
                let mutualError = simd_distance(reverse.point, seed)
                guard mutualError <= 1 else { continue }
                anchors.append(Anchor(source: seed, target: forward.point,
                                      correlation: min(forward.score, reverse.score), peakGap: forward.gap, reversePeakGap: reverse.gap, mutualError: mutualError))
                let low = anchors.map { $0.source.y }.min()!, high = anchors.map { $0.source.y }.max()!
                guard anchors.count >= 2, high - low >= pixelsPerMeter * 0.35 else { continue }
                let midpoint = (low + high) / 2
                let meanX = anchors.map { $0.source.y - midpoint }.reduce(0, +) / Float(anchors.count)
                let meanY = anchors.map { $0.target.y - $0.source.y }.reduce(0, +) / Float(anchors.count)
                var covariance: Float = 0, variance: Float = 0
                for anchor in anchors {
                    let x = anchor.source.y - midpoint - meanX
                    covariance += x * (anchor.target.y - anchor.source.y - meanY); variance += x * x
                }
                guard variance > 1 else { continue }
                let slope = covariance / variance
                let evidence = Evidence(anchors: anchors, midpoint: midpoint, phase: meanY - slope * meanX, slope: slope,
                                        spanMeters: (high - low) / pixelsPerMeter,
                                        minimumCorrelation: anchors.map(\.correlation).min()!, minimumPeakGap: anchors.map(\.peakGap).min()!,
                                        maximumMutualError: anchors.map(\.mutualError).max()!)
                return result(evidence, seeds.count, evaluated)
            }
            return result(nil, seeds.count, evaluated)
        }
    }
    // END PANEL_PHASE_ANCHOR

    private struct Frame {
        var w2c: simd_float4x4
        var camPos: SIMD3<Float>
        var fx: Float, fy: Float, cx: Float, cy: Float   // skalert til luma-oppløsningen
        var luma: [Float]                                 // 0..1, tett lw×lh
        var lw: Int, lh: Int
        var depth: [Float]; var dw: Int; var dh: Int      // LiDAR-dybde for synlighetstest
    }

    // Experimental full-image edge registration. Reuses decoded luma and fixed geometry;
    // estimates image offsets, never overwrites raw camera calibration.
    private static func refineEdges(frames: [Frame], points: [SIMD3<Float>], normals: [SIMD3<Float>], diagnosticsURL: URL? = nil, overlapNeighbors: Bool = false, widePatches: Bool = false, contextPatches: Bool = false) -> [SIMD2<Float>] {
        struct Patch { var contextWorld: [SIMD3<Float>]; var contextValue: [Float]; var world: [SIMD3<Float>]; var value: [Float]; var direction: SIMD2<Float>; var p: SIMD3<Float>; var normal: SIMD3<Float>; var uv: SIMD2<Float>; var score: Float; var twoDimensional: Bool }
        struct Match { var r: Int; var t: Int; var cr: SIMD2<Float>; var ct: SIMD2<Float>; var shift: Float; var validation: Bool; var uvR: SIMD2<Float>; var uvT: SIMD2<Float>; var correspondence: Int }
        func pixel(_ f: Frame, _ uv: SIMD2<Float>) -> Float? {
            guard uv.x >= 1, uv.y >= 1, uv.x < Float(f.lw - 2), uv.y < Float(f.lh - 2) else { return nil }
            let x = Int(uv.x), y = Int(uv.y), a = uv.x - Float(x), b = uv.y - Float(y), i = y * f.lw + x
            let top = f.luma[i] * (1-a) + f.luma[i+1] * a
            let bottom = f.luma[i+f.lw] * (1-a) + f.luma[i+f.lw+1] * a
            return top * (1-b) + bottom * b
        }
        func project(_ f: Frame, _ p: SIMD3<Float>) -> SIMD2<Float>? {
            let c = f.w2c * SIMD4(p,1)
            guard c.z < -0.1 else { return nil }
            return SIMD2(f.fx*c.x / -c.z+f.cx, -f.fy*c.y / -c.z+f.cy)
        }
        func visible(_ f: Frame, _ p: SIMD3<Float>, _ n: SIMD3<Float>) -> Bool {
            guard simd_dot(n,simd_normalize(f.camPos-p)) > 0.3, let uv = project(f,p), pixel(f,uv) != nil else { return false }
            if f.dw > 0 {
                let x = min(f.dw-1,max(0,Int(uv.x/Float(f.lw)*Float(f.dw))))
                let y = min(f.dh-1,max(0,Int(uv.y/Float(f.lh)*Float(f.dh))))
                let d = f.depth[y*f.dw+x], z = -(f.w2c * SIMD4(p,1)).z
                if !d.isFinite || d <= 0.25 || abs(d-z)>0.10 { return false }
            }
            return true
        }
        let patchStep = widePatches ? 6 : 2
        let searchRadius = contextPatches ? 64 : (widePatches ? 48 : 14)
        let searchStep = widePatches ? 4 : 2
        let axis = (-4...4).flatMap { y in
            (-4...4).map { x in SIMD2<Float>(Float(x*patchStep),Float(y*patchStep)) }
        }
        let axisNorm = axis.reduce(Float(0)) { $0+$1.x*$1.x }
        func normalize(_ raw: [Float]) -> [Float]? {
            let mean = raw.reduce(0,+)/Float(raw.count)
            var slope = SIMD2<Float>.zero
            for i in raw.indices { slope += axis[i]*raw[i] }
            slope /= axisNorm
            var a = raw.indices.map { raw[$0]-mean-simd_dot(slope,axis[$0]) }
            let norm = sqrt(a.reduce(Float(0)) { $0+$1*$1 })
            guard norm > 0.04 else { return nil }
            for i in a.indices { a[i] /= norm }
            return a
        }
        var allPatches = [[Patch]](repeating: [],count:frames.count)
        for (ri,f) in frames.enumerated() {
            let c2w = f.w2c.inverse
            func world(_ uv: SIMD2<Float>, _ p: SIMD3<Float>, _ n: SIMD3<Float>) -> SIMD3<Float>? {
                let local = SIMD4((uv.x-f.cx)/f.fx,-(uv.y-f.cy)/f.fy,-1,0)
                let ray4 = c2w*local, ray = SIMD3(ray4.x,ray4.y,ray4.z)
                let den = simd_dot(n,ray)
                guard abs(den)>0.2 else { return nil }
                return f.camPos + ray*(simd_dot(n,p-f.camPos)/den)
            }
            var cells = [Int: Patch]()
            let stride = max(1,points.count/10000)
            for vi in Swift.stride(from:0,to:points.count,by:stride) {
                let p = points[vi], n = simd_normalize(normals[vi])
                guard visible(f,p,n), let uv = project(f,p), uv.x>18,uv.y>18,uv.x<Float(f.lw-18),uv.y<Float(f.lh-18),
                      let left=pixel(f,uv-SIMD2(2,0)),let right=pixel(f,uv+SIMD2(2,0)),
                      let top=pixel(f,uv-SIMD2(0,2)),let bottom=pixel(f,uv+SIMD2(0,2)) else { continue }
                let gradient=SIMD2(right-left,bottom-top), strength=simd_length(gradient)
                guard strength>0.02 else { continue }
                let cell=Int(uv.x/64)+Int(uv.y/64)*100
                if let old=cells[cell],old.score>=strength { continue }
                let direction=gradient/strength
                var wp=[SIMD3<Float>](), raw=[Float]()
                for x in axis {
                    let q=uv+x
                    guard let w=world(q,p,n),let v=pixel(f,q) else { break }
                    wp.append(w);raw.append(v)
                }
                guard raw.count==axis.count,let value=normalize(raw) else { continue }
                var tensor=SIMD3<Float>.zero
                for yy in 1..<8 { for xx in 1..<8 {
                    let i=yy*9+xx, dx=value[i+1]-value[i-1],dy=value[i+9]-value[i-9]
                    tensor += SIMD3(dx*dx,dx*dy,dy*dy)
                } }
                let disc=sqrt(max(0,pow(tensor.x-tensor.z,2)+4*tensor.y*tensor.y))
                let hi=(tensor.x+tensor.z+disc)*0.5,lo=(tensor.x+tensor.z-disc)*0.5
                let dominant:SIMD2<Float> = abs(tensor.y)>1e-6 ? simd_normalize(SIMD2(tensor.y,hi-tensor.x)) : direction
                var contextWorld = [SIMD3<Float>](), contextValue = [Float]()
                if contextPatches {
                    var contextRaw = [Float]()
                    for offset in axis {
                        let q = uv + offset * (16 / Float(patchStep))
                        guard let w=world(q,p,n),let v=pixel(f,q) else { break }
                        contextWorld.append(w);contextRaw.append(v)
                    }
                    guard contextRaw.count==axis.count,let normalized=normalize(contextRaw) else { continue }
                    contextValue=normalized
                }
                cells[cell]=Patch(contextWorld:contextWorld,contextValue:contextValue,world:wp,value:value,direction:dominant,p:p,normal:n,uv:uv,score:strength,twoDimensional:lo>hi*0.1)
            }
            allPatches[ri]=Array(cells.values.sorted { $0.score > $1.score }.prefix(40))
        }
        var matches=[Match]()
        var correspondence = 0
        for (ri,r) in frames.enumerated() {
            let neighbors: [Int]
            if overlapNeighbors {
                // Camera proximity alone split the bedroom into 15 match components.
                // Rank actual visible source patches, including views from later visits.
                var candidates: [(index: Int, shared: Int)] = []
                for ti in frames.indices where ti != ri {
                    var shared = 0
                    for patch in allPatches[ri] {
                        if visible(frames[ti],patch.p,patch.normal) { shared += 1 }
                    }
                    if shared >= 6 { candidates.append((index:ti,shared:shared)) }
                }
                candidates.sort {
                    $0.shared == $1.shared ? $0.index < $1.index : $0.shared > $1.shared
                }
                var chosen = Array(candidates.prefix(8).map { $0.index })
                // Reserve four slots for temporal diversity among overlapping views.
                // This is only candidate selection; every patch still passes NCC/ambiguity.
                var remaining = candidates.filter { !chosen.contains($0.index) }
                while chosen.count < 12 && !remaining.isEmpty {
                    let best = remaining.indices.max { a,b in
                        func separation(_ i: Int) -> Int { ([ri]+chosen).map { abs($0-i) }.min() ?? 0 }
                        return separation(remaining[a].index) < separation(remaining[b].index)
                    }!
                    chosen.append(remaining.remove(at:best).index)
                }
                neighbors = chosen
            } else {
                neighbors = Array(frames.indices.filter { $0 != ri }.sorted {
                    simd_length_squared(frames[$0].camPos-r.camPos)<simd_length_squared(frames[$1].camPos-r.camPos)
                }.prefix(4))
            }
            let r2w=r.w2c.inverse
            for ti in neighbors {
                let t=frames[ti]
                for patch in allPatches[ri] {
                    guard visible(t,patch.p,patch.normal),let center=project(t,patch.p) else { continue }
                    func target(_ delta: SIMD2<Float>) -> SIMD2<Float>? {
                        let q=patch.uv+delta
                        let ray4=r2w*SIMD4((q.x-r.cx)/r.fx,-(q.y-r.cy)/r.fy,-1,0)
                        let ray=SIMD3(ray4.x,ray4.y,ray4.z),den=simd_dot(patch.normal,ray)
                        guard abs(den)>0.2 else { return nil }
                        return project(t,r.camPos+ray*(simd_dot(patch.normal,patch.p-r.camPos)/den))
                    }
                    guard let qx=target(SIMD2(1,0)),let qy=target(SIMD2(0,1)) else { continue }
                    let j=simd_float2x2(columns:(qx-center,qy-center))
                    guard abs(j.determinant)>0.1 else { continue }
                    let normal=simd_normalize(j.inverse.transpose*patch.direction)
                    let coords=patch.world.compactMap { project(t,$0) }
                    guard coords.count==axis.count else { continue }
                    let contextCoords = patch.contextWorld.compactMap { project(t,$0) }
                    if contextPatches && contextCoords.count != axis.count { continue }
                    func score(_ shift: SIMD2<Float>) -> Float {
                        let raw=coords.compactMap { pixel(t,$0+shift) }
                        guard raw.count==axis.count,let value=normalize(raw) else { return -2 }
                        var result:Float=0
                        for i in value.indices { result += value[i]*patch.value[i] }
                        if contextPatches {
                            let contextRaw=contextCoords.compactMap { pixel(t,$0+shift) }
                            guard contextRaw.count==axis.count,let value=normalize(contextRaw) else { return -2 }
                            var contextScore:Float=0
                            for i in value.indices { contextScore += value[i]*patch.contextValue[i] }
                            // Both scales must agree. A repeated local ridge alone is insufficient.
                            result=min(result,contextScore)
                        }
                        return result
                    }
                    var best:Float = -2, shift=SIMD2<Float>.zero
                    var candidates=[(SIMD2<Float>,Float)]()
                    for y in Swift.stride(from:-searchRadius,through:searchRadius,by:searchStep) { for x in Swift.stride(from:-searchRadius,through:searchRadius,by:searchStep) {
                        let delta=SIMD2<Float>(Float(x),Float(y)),v=score(delta)
                        candidates.append((delta,v))
                        if v>best { best=v;shift=delta }
                    } }
                    let coarse=shift
                    for y in -4...4 { for x in -4...4 {
                        let delta=coarse+SIMD2<Float>(Float(x)*0.5,Float(y)*0.5),v=score(delta)
                        if v>best { best=v;shift=delta }
                    } }
                    guard best>0.9,abs(shift.x)<Float(searchRadius),abs(shift.y)<Float(searchRadius) else { continue }
                    // Resolve only directions supported by the patch. A straight edge is
                    // allowed a tangent plateau, but not another equally good normal match.
                    let ambiguous=candidates.contains { delta,v in
                        let distance=patch.twoDimensional ? simd_length(delta-shift) : abs(simd_dot(delta-shift,normal))
                        return distance>4 && v>best-0.003
                    }
                    if ambiguous { continue }
                    let directions:[SIMD2<Float>] = patch.twoDimensional ? [SIMD2(1,0),SIMD2(0,1)] : [normal]
                    for n in directions {
                        matches.append(Match(r:ri,t:ti,cr:-(j.transpose*n),ct:n,shift:simd_dot(n,shift),validation:correspondence%5 == 0,uvR:patch.uv,uvT:center,correspondence:correspondence))
                    }
                    correspondence += 1
                }
            }
        }
        guard matches.count>=30 else { MeshLog.log("edgeRefine — insufficient matches: \(matches.count)"); return [] }
        let train=matches.filter { !$0.validation }
        let held=matches.filter { $0.validation }
        var degree=[Int](repeating:0,count:frames.count)
        for m in train { degree[m.r]+=1;degree[m.t]+=1 }
        let anchor=degree.indices.max(by:{degree[$0]<degree[$1]})!
        var offsets=[SIMD2<Float>](repeating:.zero,count:frames.count)
        for _ in 0..<60 {
            var h=[SIMD3<Float>](repeating:.zero,count:frames.count),b=[SIMD2<Float>](repeating:.zero,count:frames.count)
            for m in train {
                let residual=simd_dot(m.cr,offsets[m.r])+simd_dot(m.ct,offsets[m.t])-m.shift
                let w=min(1,1.5/max(abs(residual),1e-6))
                for (i,c,other) in [(m.r,m.cr,simd_dot(m.ct,offsets[m.t])),(m.t,m.ct,simd_dot(m.cr,offsets[m.r]))] {
                    h[i]+=SIMD3(c.x*c.x,c.x*c.y,c.y*c.y)*w
                    b[i]+=c*((m.shift-other)*w)
                }
            }
            for i in frames.indices where i != anchor && degree[i]>=6 {
                let a=h[i].x,c=h[i].y,d=h[i].z
                let disc=sqrt(max(0,(a-d)*(a-d)+4*c*c)),hi=(a+d+disc)*0.5,lo=(a+d-disc)*0.5
                guard hi>1e-5 else { continue }
                var solution=SIMD2<Float>.zero
                if lo>hi*0.1 {
                    let det=(a+0.02)*(d+0.02)-c*c
                    solution=SIMD2((d+0.02)*b[i].x-c*b[i].y,(a+0.02)*b[i].y-c*b[i].x)/det
                } else {
                    let v:SIMD2<Float> = abs(c)>1e-6 ? simd_normalize(SIMD2(c,hi-a)) : (a>d ? SIMD2(1,0):SIMD2(0,1))
                    solution=v*(simd_dot(v,b[i])/(hi+0.02))
                }
                let length=simd_length(solution)
                let limit: Float = widePatches ? 64 : 24
                if length>limit { solution *= limit/length }
                offsets[i]=(offsets[i]+solution)*0.5
            }
        }
        func median(_ a:[Float])->Float { let s=a.sorted();return s[s.count/2] }
        let before=median(held.map { abs($0.shift) })
        let after=median(held.map { abs(simd_dot($0.cr,offsets[$0.r])+simd_dot($0.ct,offsets[$0.t])-$0.shift) })
        MeshLog.log(String(format:"edgeRefine — %d patches, %d matches, %d held, median %.2f → %.2f px, anchor %d",allPatches.reduce(0){$0+$1.count},matches.count,held.count,before,after,anchor))
        // Headless diagnostics only: retain spatial evidence, not just an aggregate score.
        // Kept outside the solve so enabling an audit cannot alter the fitted field.
        if let url = diagnosticsURL {
            func xy(_ p: SIMD2<Float>) -> [Float] { [p.x,p.y] }
            let rows: [[String: Any]] = matches.map { m in
                ["r":m.r,"t":m.t,"cr":xy(m.cr),"ct":xy(m.ct),"shift":m.shift,
                 "held":m.validation,"uvR":xy(m.uvR),"uvT":xy(m.uvT),"pair":m.correspondence,
                 "residual":simd_dot(m.cr,offsets[m.r])+simd_dot(m.ct,offsets[m.t])-m.shift]
            }
            let record: [String: Any] = ["frames":frames.map { ["width":$0.lw,"height":$0.lh] },
                "offsets":offsets.map(xy),"anchor":anchor,"matches":rows,
                "accepted":after.isFinite && after<before*0.9]
            do {
                let data = try JSONSerialization.data(withJSONObject:record,options:[.sortedKeys])
                try data.write(to:url,options:.atomic)
            } catch { MeshLog.log("edgeRefine — audit write failed: \(error.localizedDescription)") }
        }
        guard after.isFinite,after<before*0.9 else { MeshLog.log("edgeRefine — rejected: no held-out improvement");return [] }
        return offsets
    }

    /// Justerer keyframes[i].transform (camera-to-world) in place. Returnerer (før, etter)
    /// gjennomsnittlig fotometrisk residual — logges så fixture-A/B har et tall.
    @discardableResult
    static func refine(
        keyframes: inout [MeshScanPresenter.Keyframe],
        positions: [Float], normals: [Float],
        framesDir: URL,
        iterations: Int = 8,
        // PROXY-OPPLØSNINGEN ER WARPENS MÅLESTOKK. Warpen sammenligner hvert bilde mot en
        // per-verteks proxyfarge; er proxyen grov, kan residualen ikke bli lav uansett hvor
        // god warpen er. 50k punkter over et rom er ~4,4 cm mellom hvert, mens feilen som
        // skal rettes er millimeter. TSDF-nettet har 774k vertekser — proxyen brukte 6 % av
        // dem. meshscan.proxyverts.
        maxVertices: Int = Int(UserDefaults.standard.string(forKey: "meshscan.proxyverts") ?? "") ?? 50_000,
        forceWarp: Bool = false,
        // Ut: normaliserte warp-rutenett per keyframe (warpGridW*warpGridH SIMD2, offset i
        // [0,1]-bilderom). Tom for keyframes uten warp. Baken (blend=all) sampler gjennom dem.
        warpGridsByKF: inout [[SIMD2<Float>]]
    ) -> (before: Float, after: Float) {
        warpGridsByKF = [[SIMD2<Float>]](repeating: [], count: keyframes.count)
        let vCountAll = positions.count / 3
        guard vCountAll > 100, !keyframes.isEmpty else { return (0, 0) }
        let t0 = CFAbsoluteTimeGetCurrent()

        // ── Verteks-subsett (jevnt stride — proxyen trenger dekning, ikke tetthet)
        let stride = max(1, vCountAll / maxVertices)
        var verts: [SIMD3<Float>] = []
        var vnorms: [SIMD3<Float>] = []
        verts.reserveCapacity(vCountAll / stride + 1)
        var vi = 0
        while vi < vCountAll {
            verts.append(SIMD3(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]))
            vnorms.append(SIMD3(normals[vi * 3], normals[vi * 3 + 1], normals[vi * 3 + 2]))
            vi += stride
        }
        let nV = verts.count

        // ── Luma-cache.
        //
        // OPPLØSNINGEN ER WARPENS SYNSGRENSE (2026-09-01). 480 px var valgt for minne, men
        // originalene er 3840: en misalignment på to piksler i full oppløsning er en KVART
        // piksel her, altså under det gradientene kan måle. Warpen kunne dermed ikke se
        // feilen den er satt til å rette — og det er grunnen til at hverken finere
        // warp-rutenett, adaptiv regularisering eller flere iterasjoner ga synlig utslag.
        //
        // 960 px koster ~2 MB/frame i Float, altså ~290 MB for 139 frames. Det får plass
        // fordi TSDF-volumet er frigjort før dette punktet (VoxelStore deinit etter surface
        // nets). Blir det trangt på svakere enheter, er neste steg å lagre luma som UInt8 og
        // konvertere i `sample` — det firedobler kapasiteten uten å tape presisjon som betyr
        // noe, siden kilden er 8-bits. meshscan.warppx overstyrer.
        let lumaMaxPx = Int(UserDefaults.standard.string(forKey: "meshscan.warppx") ?? "") ?? 960
        func mat(_ a: [Float]) -> simd_float4x4 {
            simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                    SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
        }
        // PARALLELT (2026-09-06): 55 JPEG-dekodinger til 960 px tok ~20 s på én kjerne og
        // var den lengste stille perioden i en 46-sekunders bake. Hver keyframe er
        // uavhengig; resultatet legges i sin egen plass så rekkefølgen er som før.
        let lastet = UnsafeMutablePointer<Frame?>.allocate(capacity: keyframes.count)
        lastet.initialize(repeating: nil, count: keyframes.count)
        defer { lastet.deinitialize(count: keyframes.count); lastet.deallocate() }
        DispatchQueue.concurrentPerform(iterations: keyframes.count) { ki in
            let k = keyframes[ki]
            guard let cg = MeshImageIO.loadCGImageThumb(framesDir, k.file, maxPx: lumaMaxPx),
                  let rgba = MeshImageIO.rgbaBytes(cg) else { return }
            let lw = cg.width, lh = cg.height
            var luma = [Float](repeating: 0, count: lw * lh)
            for p in 0..<(lw * lh) {
                luma[p] = (0.299 * Float(rgba[p * 4]) + 0.587 * Float(rgba[p * 4 + 1]) + 0.114 * Float(rgba[p * 4 + 2])) / 255
            }
            var depth: [Float] = []; var dw = 0; var dh = 0
            if let df = k.depthFile, let dd = try? Data(contentsOf: framesDir.appendingPathComponent(df)),
               dd.count == k.depthWidth * k.depthHeight * 4 {
                depth = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
                dw = k.depthWidth; dh = k.depthHeight
            }
            let sx = Float(lw) / Float(k.width), sy = Float(lh) / Float(k.height)
            lastet[ki] = Frame(
                w2c: simd_inverse(mat(k.transform)),
                camPos: SIMD3(k.transform[12], k.transform[13], k.transform[14]),
                fx: k.intrinsics[0] * sx, fy: k.intrinsics[1] * sy,
                cx: k.intrinsics[2] * sx, cy: k.intrinsics[3] * sy,
                luma: luma, lw: lw, lh: lh, depth: depth, dw: dw, dh: dh)
        }
        var frames: [Frame] = []
        frames.reserveCapacity(keyframes.count)
        var frameKF: [Int] = [] // frames[i] ↔ keyframes[frameKF[i]]
        for ki in 0..<keyframes.count { if let f = lastet[ki] { frames.append(f); frameKF.append(ki) } }
        guard frames.count >= 3 else { return (0, 0) }
        if UserDefaults.standard.string(forKey: "meshscan.edgerefine") == "on" {
            let auditURL = UserDefaults.standard.string(forKey: "meshscan.edgeaudit") == "on"
                ? framesDir.appendingPathComponent("edge-audit.json") : nil
            let offsets = refineEdges(frames: frames, points: verts, normals: vnorms, diagnosticsURL: auditURL,
                overlapNeighbors: UserDefaults.standard.string(forKey: "meshscan.edgeoverlap") == "on",
                widePatches: UserDefaults.standard.string(forKey: "meshscan.edgewide") == "on",
                contextPatches: UserDefaults.standard.string(forKey: "meshscan.edgecontext") == "on")
            for fi in offsets.indices {
                let f = frames[fi], d = offsets[fi]
                let normalized = SIMD2(d.x / Float(f.lw), d.y / Float(f.lh))
                warpGridsByKF[frameKF[fi]] = [SIMD2<Float>](repeating: normalized, count: warpGridW * warpGridH)
            }
            return (0, 0) // Different objective; edge residuals are logged separately.
        }


        // Bilineær luma + gradient (piksel-enheter i luma-oppløsning)
        func sample(_ f: Frame, _ u: Float, _ v: Float) -> (val: Float, gx: Float, gy: Float)? {
            if u < 1.5 || v < 1.5 || u > Float(f.lw) - 2.5 || v > Float(f.lh) - 2.5 { return nil }
            let x0 = Int(u), y0 = Int(v)
            let fx = u - Float(x0), fy = v - Float(y0)
            let i00 = y0 * f.lw + x0
            let v00 = f.luma[i00], v10 = f.luma[i00 + 1]
            let v01 = f.luma[i00 + f.lw], v11 = f.luma[i00 + f.lw + 1]
            let val = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
            // sentraldifferanse på nærmeste piksel — nøyaktig nok for GN-retningen
            let xc = min(max(x0, 1), f.lw - 2), yc = min(max(y0, 1), f.lh - 2)
            let gx = (f.luma[yc * f.lw + xc + 1] - f.luma[yc * f.lw + xc - 1]) * 0.5
            let gy = (f.luma[(yc + 1) * f.lw + xc] - f.luma[(yc - 1) * f.lw + xc]) * 0.5
            return (val, gx, gy)
        }

        // Prosjeksjon + synlighet: foran kamera, innenfor bildet, flate vendt mot kamera,
        // og dybdetest ±30 cm (samme konvensjon som baken: ARKit ser -z, bilde-y ned).
        func project(_ f: Frame, _ p: SIMD3<Float>, _ n: SIMD3<Float>) -> (u: Float, v: Float, pc: SIMD3<Float>)? {
            let pc4 = f.w2c * SIMD4(p, 1)
            if pc4.z > -0.1 { return nil }
            let zbar = -pc4.z
            let u = f.fx * (pc4.x / zbar) + f.cx
            let v = f.fy * (-pc4.y / zbar) + f.cy
            if u < 2 || v < 2 || u > Float(f.lw) - 3 || v > Float(f.lh) - 3 { return nil }
            let viewDir = simd_normalize(f.camPos - p)
            if simd_dot(n, viewDir) < 0.25 { return nil }
            if f.dw > 0 {
                let dx = min(f.dw - 1, max(0, Int(u / Float(f.lw) * Float(f.dw))))
                let dy = min(f.dh - 1, max(0, Int(v / Float(f.lh) * Float(f.dh))))
                let sceneZ = f.depth[dy * f.dw + dx]
                if sceneZ > 0.25 && abs(zbar - sceneZ) > 0.30 { return nil }
            }
            return (u, v, SIMD3(pc4.x, pc4.y, pc4.z))
        }

        // 6×6-løser (Gauss-eliminasjon m/ partial pivot)
        func solve6(_ A0: [Float], _ b0: [Float]) -> [Float]? {
            var A = A0, b = b0
            for col in 0..<6 {
                var pivot = col
                for r in (col + 1)..<6 where abs(A[r * 6 + col]) > abs(A[pivot * 6 + col]) { pivot = r }
                if abs(A[pivot * 6 + col]) < 1e-10 { return nil }
                if pivot != col {
                    for c in 0..<6 { A.swapAt(col * 6 + c, pivot * 6 + c) }
                    b.swapAt(col, pivot)
                }
                let inv = 1 / A[col * 6 + col]
                for r in (col + 1)..<6 {
                    let f = A[r * 6 + col] * inv
                    if f == 0 { continue }
                    for c in col..<6 { A[r * 6 + c] -= f * A[col * 6 + c] }
                    b[r] -= f * b[col]
                }
            }
            var x = [Float](repeating: 0, count: 6)
            for r in (0..<6).reversed() {
                var s = b[r]
                for c in (r + 1)..<6 { s -= A[r * 6 + c] * x[c] }
                x[r] = s / A[r * 6 + r]
            }
            return x
        }

        // ── Ikke-rigid warp (Zhou-Koltun andre halvdel): grovt kontrollrutenett i bilderom
        // per frame, 2D-forskyvning per punkt. Jacobi er ENKLERE enn den rigide (∇I·bilineær-
        // vekt, ingen rotasjon). Se docs/SUBPIXEL_ALIGN_PLAN.md. warpGW×warpGH — start grovt.
        let warpGW = warpGridW, warpGH = warpGridH
        let warpN = 2 * warpGW * warpGH
        // De 4 omkringliggende kontrollpunktene + bilineære vekter for en piksel (u,v).
        func warpCell(_ lw: Int, _ lh: Int, _ u: Float, _ v: Float)
            -> (idx: (Int, Int, Int, Int), w: (Float, Float, Float, Float)) {
            let gxf = u / Float(max(lw - 1, 1)) * Float(warpGW - 1)
            let gyf = v / Float(max(lh - 1, 1)) * Float(warpGH - 1)
            let cx = min(max(Int(gxf), 0), warpGW - 2)
            let cy = min(max(Int(gyf), 0), warpGH - 2)
            let tx = min(max(gxf - Float(cx), 0), 1), ty = min(max(gyf - Float(cy), 0), 1)
            let a = cy * warpGW + cx, b = a + 1, c = a + warpGW, d = c + 1
            return ((a, b, c, d), ((1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty))
        }

        /// Lyshetskompensasjon per bilde: løser skalaren `a` og forskyvningen `b` som best mapper
        /// dette bildets samples over på proxyfargene.
        ///
        /// HVORFOR: refinen minimerte ren fargedifferanse `s − proxy`. Varierer eksponeringen
        /// 10 % mellom bilder, bidrar det alene mer til residualen enn hele den geometriske
        /// feilen — og da jager optimeringen LYSHET i stedet for POSISJON. Målt: residualen sto
        /// på 0.0538 uansett om proxyen hadde 52k eller 417k punkter, altså helt ufølsom for
        /// geometrisk oppløsning. Med (a, b) trukket fra måler residualen kun om innholdet ligger
        /// på samme sted, slik det skal.
        func photoGain(_ f: Frame, _ proxy: [Float], stride: Int = 4) -> (Float, Float) {
            var sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0, n = 0.0
            var i = 0
            while i < verts.count {
                defer { i += stride }
                // proxy < 0 markerer et punkt uten farge ennå; hopp over det.
                guard proxy[i] > 0, let pr = project(f, verts[i], vnorms[i]),
                      let s = sample(f, pr.u, pr.v) else { continue }
                let x = Double(s.val), y = Double(proxy[i])
                sx += x; sy += y; sxx += x * x; sxy += x * y; n += 1
            }
            guard n > 50 else { return (1, 0) }
            let den = n * sxx - sx * sx
            guard abs(den) > 1e-9 else { return (1, 0) }
            // Klemt: en frame skal justeres, ikke omskrives. Utenfor dette er noe annet galt
            // (okklusjon, speil), og da er identitet tryggere.
            let a = Float(max(0.6, min(1.7, (n * sxy - sx * sy) / den)))
            let b = Float((sy - Double(a) * sx) / n)
            return (a, max(-0.25, min(0.25, b)))
    }


        func warpOffset(_ grid: [SIMD2<Float>], _ lw: Int, _ lh: Int, _ u: Float, _ v: Float) -> SIMD2<Float> {
            let (idx, w) = warpCell(lw, lh, u, v)
            return grid[idx.0] * w.0 + grid[idx.1] * w.1 + grid[idx.2] * w.2 + grid[idx.3] * w.3
        }
        // Generell n×n-løser (samme Gauss-eliminasjon m/ partial pivot som solve6).
        func solveN(_ A0: [Float], _ b0: [Float], _ n: Int) -> [Float]? {
            var A = A0, b = b0
            for col in 0..<n {
                var pivot = col
                for r in (col + 1)..<n where abs(A[r * n + col]) > abs(A[pivot * n + col]) { pivot = r }
                if abs(A[pivot * n + col]) < 1e-12 { return nil }
                if pivot != col {
                    for c in 0..<n { A.swapAt(col * n + c, pivot * n + c) }
                    b.swapAt(col, pivot)
                }
                let inv = 1 / A[col * n + col]
                for r in (col + 1)..<n {
                    let f = A[r * n + col] * inv
                    if f == 0 { continue }
                    for c in col..<n { A[r * n + c] -= f * A[col * n + c] }
                    b[r] -= f * b[col]
                }
            }
            var x = [Float](repeating: 0, count: n)
            for r in (0..<n).reversed() {
                var s = b[r]
                for c in (r + 1)..<n { s -= A[r * n + c] * x[c] }
                x[r] = s / A[r * n + r]
            }
            return x
        }

        func rodrigues(_ w: SIMD3<Float>) -> simd_float3x3 {
            let th = simd_length(w)
            if th < 1e-8 { return matrix_identity_float3x3 }
            let k = w / th
            let K = simd_float3x3(SIMD3(0, k.z, -k.y), SIMD3(-k.z, 0, k.x), SIMD3(k.y, -k.x, 0)) // kolonne-major
            return matrix_identity_float3x3 + sin(th) * K + (1 - cos(th)) * (K * K)
        }

        // ── Alternering: proxy-oppdatering (alle frames) ↔ per-frame GN-steg
        var proxy = [Float](repeating: 0, count: nV)
        var meanResBefore: Float = -1
        var meanResAfter: Float = 0
        // Sikkerhetsnett: refineren skal ALDRI kunne gjøre det verre enn ARKit-posene.
        // Residualen logget i iterasjon i måler posene ETTER steg i-1 — ta vare på beste sett.
        var bestPose = EvaluatedState(frames.map(\.w2c))
        // Siste pass måler siste forslag uten å ta et nytt steg. Behold hele
        // det opprinnelige antallet GN-steg når de faktisk forbedrer resultatet.
        for iter in 0...iterations {
            // Pass A: proxy = facing-vektet snitt av lumaverdiene som ser verteksen
            var sum = [Float](repeating: 0, count: nV)
            var wsum = [Float](repeating: 0, count: nV)
            for f in frames {
                for i in 0..<nV {
                    guard let pr = project(f, verts[i], vnorms[i]),
                          let s = sample(f, pr.u, pr.v) else { continue }
                    let w = simd_dot(vnorms[i], simd_normalize(f.camPos - verts[i]))
                    sum[i] += s.val * w
                    wsum[i] += w
                }
            }
            var resSum: Float = 0; var resN = 0
            for i in 0..<nV where wsum[i] > 1e-4 { proxy[i] = sum[i] / wsum[i] }

            // Pass B: GN-steg per frame mot proxyen (parallelt — frames er uavhengige)
            let framesCopy = frames
            var newW2C = framesCopy.map(\.w2c)
            var frameRes = [Float](repeating: 0, count: framesCopy.count)
            var frameResN = [Int](repeating: 0, count: framesCopy.count)
            newW2C.withUnsafeMutableBufferPointer { W in
                frameRes.withUnsafeMutableBufferPointer { FR in
                    frameResN.withUnsafeMutableBufferPointer { FN in
                        DispatchQueue.concurrentPerform(iterations: framesCopy.count) { fi in
                            let f = framesCopy[fi]
                            var H = [Float](repeating: 0, count: 36)
                            var b = [Float](repeating: 0, count: 6)
                            var rSum: Float = 0; var rN = 0
                            let (ga, gb) = photoGain(f, proxy)
                            for i in 0..<nV where wsum[i] > 1e-4 {
                                guard let pr = project(f, verts[i], vnorms[i]),
                                      let s = sample(f, pr.u, pr.v) else { continue }
                                let r = (ga * s.val + gb) - proxy[i]
                                rSum += abs(r); rN += 1
                                if abs(r) > 0.30 { continue } // okklusjonsskift/speil — ute av GN
                                // Jacobi: ∇I · ∂(u,v)/∂pc · ∂pc/∂ξ, venstre-perturbasjon exp(ξ)·w2c
                                let pc = pr.pc
                                let zbar = -pc.z
                                let iz = 1 / zbar
                                // du/dpc, dv/dpc (u = fx·x/z̄+cx, v = fy·(−y)/z̄+cy, z̄ = −z)
                                let du = SIMD3<Float>(f.fx * iz, 0, f.fx * pc.x * iz * iz)
                                let dv = SIMD3<Float>(0, -f.fy * iz, -f.fy * pc.y * iz * iz)
                                // Gradienten skaleres med samme a, siden residualen nå er a·I + b.
                                let gpc = (ga * s.gx) * du + (ga * s.gy) * dv   // ∂I/∂pc (1×3)
                                // ∂pc/∂ξ = [ -[pc]× | I ]; gpcᵀ·(-[pc]×) = (pc × gpc)ᵀ.
                                // NB fortegnet HER var flippet i første device-kjøring (residual
                                // STEG 0.039→0.046) — pc × gpc, ikke gpc × pc.
                                var J = [Float](repeating: 0, count: 6)
                                J[0] = pc.y * gpc.z - pc.z * gpc.y   // (pc × gpc) — rotasjon
                                J[1] = pc.z * gpc.x - pc.x * gpc.z
                                J[2] = pc.x * gpc.y - pc.y * gpc.x
                                J[3] = gpc.x; J[4] = gpc.y; J[5] = gpc.z
                                for a in 0..<6 {
                                    b[a] += J[a] * r
                                    for c in a..<6 { H[a * 6 + c] += J[a] * J[c] }
                                }
                            }
                            FR[fi] = rSum; FN[fi] = rN
                            guard iter < iterations, rN > 200 else { return }
                            for a in 0..<6 { for c in 0..<a { H[a * 6 + c] = H[c * 6 + a] } } // symmetriser
                            var trace: Float = 0
                            for a in 0..<6 { trace += H[a * 6 + a] }
                            let lambda = max(trace / 6 * 1e-3, 1e-6)
                            for a in 0..<6 { H[a * 6 + a] += lambda }
                            guard var d = solve6(H, b) else { return }
                            for a in 0..<6 { d[a] = -d[a] } // GN: δ = −H⁻¹b
                            // Trinnklemme: drift er cm-nivå — store hopp er alltid outlier-drevet
                            var w = SIMD3(d[0], d[1], d[2]); var t = SIMD3(d[3], d[4], d[5])
                            let wl = simd_length(w), tl = simd_length(t)
                            if wl > 0.02 { w *= 0.02 / wl }
                            if tl > 0.03 { t *= 0.03 / tl }
                            let R = rodrigues(w)
                            let old = f.w2c
                            let oldR = simd_float3x3(SIMD3(old.columns.0.x, old.columns.0.y, old.columns.0.z),
                                                     SIMD3(old.columns.1.x, old.columns.1.y, old.columns.1.z),
                                                     SIMD3(old.columns.2.x, old.columns.2.y, old.columns.2.z))
                            let oldT = SIMD3(old.columns.3.x, old.columns.3.y, old.columns.3.z)
                            let nR = R * oldR
                            let nT = R * oldT + t
                            W[fi] = simd_float4x4(columns: (
                                SIMD4(nR.columns.0, 0), SIMD4(nR.columns.1, 0), SIMD4(nR.columns.2, 0), SIMD4(nT, 1)))
                        }
                    }
                }
            }
            for fi in 0..<frames.count {
                frames[fi].w2c = newW2C[fi]
                let c2w = simd_inverse(newW2C[fi])
                frames[fi].camPos = SIMD3(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z)
                resSum += frameRes[fi]; resN += frameResN[fi]
            }
            let meanRes = resN > 0 ? resSum / Float(resN) : 0
            if iter == 0 { meanResBefore = meanRes }
            meanResAfter = meanRes
            // Residualen gjelder posene FØR dette stegets oppdatering — snapshotet som ga den
            // er forrige iterasjons resultat (framesCopy), ikke det nye.
            bestPose.consider(framesCopy.map(\.w2c), residual: meanRes, samples: resN)
            MeshLog.log("poseRefine iter \(iter + 1)/\(iterations + 1) — snittresidual \(String(format: "%.4f", meanRes)) (\(resN) samples)")
        }
        // Siste pass har målt alle foreslåtte GN-steg. Velg beste målte sett.
        // Oppdater camPos sammen med w2c: warpens facing/synlighet bruker begge.
        for fi in 0..<frames.count {
            frames[fi].w2c = bestPose.value[fi]
            let c2w = simd_inverse(bestPose.value[fi])
            frames[fi].camPos = SIMD3(c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z)
        }
        meanResAfter = bestPose.residual ?? meanResBefore
        MeshLog.log("poseRefine — eksport velger beste målte poser, inkludert kontroll av siste steg")

        // ── Ikke-rigid warp-stadium (OPT-IN: meshscan.warp = "on"). DEL 1 — MÅLER om det
        // finnes justerbar restforvrengning under det rigide gulvet (~0,044). Warpen
        // persisteres IKKE ennå: baken sampler fortsatt via pose alene, så «on» endrer
        // LOGGET residual, ikke bildet. Bildeendringen er del 2 (warp-bevisst sampler +
        // fixture v4 + blande-vei). Se docs/SUBPIXEL_ALIGN_PLAN.md.
        // Går/faller på at residualen SYNKER monotont — samme fortegns-validering som den
        // rigide (der fortegnet var flippet og residualen STEG). Synker den ikke, er warpen
        // eller Jacobi-fortegnet galt; da lyver ikke tallet.
        // OPT-IN: meshscan.warp = "on" (koster 6 ekstra iterasjoner per bake — regel 10, så
        // ikke på som standard). Validert på device 2026-08-25: residualen synker MONOTONT
        // under det rigide gulvet (0,0417→0,0399 og 0,0356→0,0341), altså rett Jacobi-fortegn.
        if (forceWarp || UserDefaults.standard.string(forKey: "meshscan.warp") == "on") && frames.count >= 3 {
            let zeroGrid = [SIMD2<Float>](repeating: .zero, count: warpGW * warpGH)
            var warps = [[SIMD2<Float>]](repeating: zeroGrid, count: frames.count)
            var bestWarp = EvaluatedState(warps)
            // Regularisering holder kontrollpunkter i tekstur-fattige felt (blank vegg) fra å
            // drive fritt og rive warpen. For lav = wobble/riving; for høy = kollapser til
            // rigid. Startverdi — TUNE på fixture (docs, felle #3).
            // ADAPTIV regularisering (2026-09-01). Den gamle faste λ måtte settes etter det
            // VERSTE tilfellet — blank vegg — og var dermed for stiv over alt som faktisk har
            // struktur. Derfor senket 12×8 residualen, men rev opp veggene: rutenettet ble
            // finere overalt, også der det ikke fantes gradient å styre etter.
            // Nå er λ per kontrollpunkt: fri der bildet har struktur, låst der det er blankt.
            // Det er det som gjør et finere rutenett trygt.
            let warpLambda: Float = 0.012    // gulv, brukes der det ER struktur
            let warpLambdaMax: Float = 0.10  // tak, brukes over teksturløse flater
            // Steget er i PIKSLER, så det må skaleres med luma-oppløsningen: 2.0 var satt
            // for 480 px, og da bildene ble doblet til 960 halverte den samme konstanten
            // effektivt hvor langt warpen får flytte seg per iterasjon (forbedringen falt
            // 8,0 % → 5,5 %). Grensen på 4.0 som «rev blanke vegger» gjaldt 480 px med FAST
            // regularisering — begge deler er endret siden.
            let warpStepClamp: Float = 2.0 * Float(lumaMaxPx) / 480
            var warpResBefore: Float = -1, warpResAfter: Float = 0
            let warpIters = 8
            for witer in 0...warpIters {
                // Pass A: proxy fra WARPEDE samples (facing-vektet snitt) — ellers måles warpen
                // mot en proxy den selv ikke har vært med å forme.
                var sum = [Float](repeating: 0, count: nV)
                var wsum = [Float](repeating: 0, count: nV)
                for (fi, f) in frames.enumerated() {
                    let grid = warps[fi]
                    for i in 0..<nV {
                        guard let pr = project(f, verts[i], vnorms[i]) else { continue }
                        let off = warpOffset(grid, f.lw, f.lh, pr.u, pr.v)
                        guard let s = sample(f, pr.u + off.x, pr.v + off.y) else { continue }
                        let w = simd_dot(vnorms[i], simd_normalize(f.camPos - verts[i]))
                        sum[i] += s.val * w; wsum[i] += w
                    }
                }
                var proxyW = [Float](repeating: 0, count: nV)
                for i in 0..<nV where wsum[i] > 1e-4 { proxyW[i] = sum[i] / wsum[i] }

                // Pass B: per-frame GN på warp-rutenettet (parallelt — frames uavhengige)
                let framesCopy = frames
                let warpsCopy = warps
                var newWarps = warps
                var fRes = [Float](repeating: 0, count: frames.count)
                var fResN = [Int](repeating: 0, count: frames.count)
                newWarps.withUnsafeMutableBufferPointer { NW in
                    fRes.withUnsafeMutableBufferPointer { FR in
                        fResN.withUnsafeMutableBufferPointer { FN in
                            DispatchQueue.concurrentPerform(iterations: framesCopy.count) { fi in
                                let f = framesCopy[fi]
                                let grid = warpsCopy[fi]
                                var H = [Float](repeating: 0, count: warpN * warpN)
                                var b = [Float](repeating: 0, count: warpN)
                                // Bildestruktur under hvert kontrollpunkt. Et punkt over blank
                                // vegg har ingen gradient å styre etter og MÅ holdes fast;
                                // et punkt over en vinduskarm kan flytte seg fritt. Uten dette
                                // skillet må reguleringen settes etter det verste tilfellet,
                                // og da blir warpen for stiv til å rette opp smøringen.
                                var gradE = [Float](repeating: 0, count: warpGW * warpGH)
                                var rSum: Float = 0; var rN = 0
                                let (ga, gb) = photoGain(f, proxyW)
                                for i in 0..<nV where wsum[i] > 1e-4 {
                                    guard let pr = project(f, verts[i], vnorms[i]) else { continue }
                                    let (idx, wgt) = warpCell(f.lw, f.lh, pr.u, pr.v)
                                    let off = grid[idx.0] * wgt.0 + grid[idx.1] * wgt.1 + grid[idx.2] * wgt.2 + grid[idx.3] * wgt.3
                                    guard let s = sample(f, pr.u + off.x, pr.v + off.y) else { continue }
                                    let r = (ga * s.val + gb) - proxyW[i]
                                    rSum += abs(r); rN += 1
                                    if abs(r) > 0.30 { continue } // okklusjonsskift/speil — ute av GN
                                    // 4 kontrollpunkt × {x,y}: ∂I/∂cp.x = gx·w, ∂I/∂cp.y = gy·w.
                                    let cpArr = [idx.0, idx.1, idx.2, idx.3]
                                    let wArr = [wgt.0, wgt.1, wgt.2, wgt.3]
                                    var cols = [Int](repeating: 0, count: 8)
                                    var jv = [Float](repeating: 0, count: 8)
                                    let gmag = s.gx * s.gx + s.gy * s.gy
                                    for k in 0..<4 {
                                        cols[k * 2] = cpArr[k] * 2;     jv[k * 2] = (ga * s.gx) * wArr[k]
                                        cols[k * 2 + 1] = cpArr[k] * 2 + 1; jv[k * 2 + 1] = (ga * s.gy) * wArr[k]
                                        gradE[cpArr[k]] += gmag * wArr[k]
                                    }
                                    for a in 0..<8 {
                                        b[cols[a]] += jv[a] * r
                                        for c in 0..<8 { H[cols[a] * warpN + cols[c]] += jv[a] * jv[c] }
                                    }
                                }
                                FR[fi] = rSum; FN[fi] = rN
                                guard witer < warpIters, rN > 200 else { return }
                                // Glatthetsregularisering: naborutenett (horisontal + vertikal).
                                // Median-normalisert struktur: punkter under snittet strammes
                                // opp mot warpLambdaMax, punkter over slippes mot warpLambda.
                                var gs = gradE.filter { $0 > 0 }.sorted()
                                let gMed = gs.isEmpty ? 1 : max(gs[gs.count / 2], 1e-8)
                                func lamAt(_ k: Int) -> Float {
                                    let rel = gradE[k] / gMed
                                    // rel ≥ 1 (mye struktur) → warpLambda; rel → 0 (blankt) → maks.
                                    let t = min(1, rel)
                                    return warpLambdaMax + (warpLambda - warpLambdaMax) * t
                                }
                                func reg(_ k: Int, _ m: Int) {
                                    // Paret bindes av den STIVESTE av de to: en fri nabo skal
                                    // ikke kunne dra et låst punkt over blank vegg med seg.
                                    let lamR = max(lamAt(k), lamAt(m))
                                    for comp in 0..<2 {
                                        let ci = k * 2 + comp, cj = m * 2 + comp
                                        H[ci * warpN + ci] += lamR; H[cj * warpN + cj] += lamR
                                        H[ci * warpN + cj] -= lamR; H[cj * warpN + ci] -= lamR
                                        let diff = grid[k][comp] - grid[m][comp]
                                        b[ci] += lamR * diff; b[cj] -= lamR * diff
                                    }
                                }
                                for gy in 0..<warpGH {
                                    for gx in 0..<warpGW {
                                        let k = gy * warpGW + gx
                                        if gx + 1 < warpGW { reg(k, k + 1) }
                                        if gy + 1 < warpGH { reg(k, k + warpGW) }
                                    }
                                }
                                // Levenberg-demping (samme som den rigide)
                                var trace: Float = 0
                                for a in 0..<warpN { trace += H[a * warpN + a] }
                                let lam = max(trace / Float(warpN) * 1e-3, 1e-6)
                                for a in 0..<warpN { H[a * warpN + a] += lam }
                                guard var d = solveN(H, b, warpN) else { return }
                                for a in 0..<warpN { d[a] = -d[a] } // GN: δ = −H⁻¹b
                                var g = grid
                                for k in 0..<(warpGW * warpGH) {
                                    var step = SIMD2(d[k * 2], d[k * 2 + 1])
                                    let sl = simd_length(step)
                                    if sl > warpStepClamp { step *= warpStepClamp / sl }
                                    g[k] += step
                                }
                                NW[fi] = g
                            }
                        }
                    }
                }
                var rs: Float = 0; var rn = 0
                for fi in 0..<frames.count { rs += fRes[fi]; rn += fResN[fi] }
                let mr = rn > 0 ? rs / Float(rn) : 0
                if witer == 0 { warpResBefore = mr }
                warpResAfter = mr
                bestWarp.consider(warps, residual: mr, samples: rn)
                warps = newWarps
                MeshLog.log("poseRefine warp iter \(witer + 1)/\(warpIters + 1) — snittresidual \(String(format: "%.4f", mr)) (\(rn) samples)")
            }
            warps = bestWarp.value
            warpResAfter = bestWarp.residual ?? warpResBefore
            // Eksporter NORMALISERTE rutenett (offset delt på thumb-størrelse → oppløsnings-
            // uavhengig, så baken kan bruke samme rutenett på fulloppløste frames). Indeksert
            // per keyframe via frameKF; frames uten thumb får tomt (baken tolker som identitet).
            for fi in 0..<frames.count {
                let f = frames[fi]
                let g = warps[fi]
                var norm = [SIMD2<Float>](repeating: .zero, count: g.count)
                for k in 0..<g.count { norm[k] = SIMD2(g[k].x / Float(max(f.lw, 1)), g[k].y / Float(max(f.lh, 1))) }
                warpGridsByKF[frameKF[fi]] = norm
            }
            MeshLog.log("poseRefine warp — residual \(String(format: "%.4f", warpResBefore)) → \(String(format: "%.4f", warpResAfter)), \(warpGW)×\(warpGH)-rutenett, \(frames.count) frames (eksportert til baken)")
        }

        // ── Skriv raffinerte c2w-poser tilbake i keyframes
        for (fi, ki) in frameKF.enumerated() {
            let c2w = simd_inverse(frames[fi].w2c)
            keyframes[ki].transform = [
                c2w.columns.0.x, c2w.columns.0.y, c2w.columns.0.z, c2w.columns.0.w,
                c2w.columns.1.x, c2w.columns.1.y, c2w.columns.1.z, c2w.columns.1.w,
                c2w.columns.2.x, c2w.columns.2.y, c2w.columns.2.z, c2w.columns.2.w,
                c2w.columns.3.x, c2w.columns.3.y, c2w.columns.3.z, c2w.columns.3.w,
            ]
        }
        MeshLog.log("poseRefine ferdig — residual \(String(format: "%.4f", meanResBefore)) → \(String(format: "%.4f", meanResAfter)), \(frames.count) frames, \(nV) verts, \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms")
        return (meanResBefore, meanResAfter)
    }
}
