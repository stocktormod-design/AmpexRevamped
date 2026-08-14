import Foundation
import Metal
import simd

/// TSDF-fusjon — fasit-geometrien (Choi2015/Open3D-klassen): alle lagrede dybdekart stemmer
/// inn i et voxelfelt, flaten trekkes ut med Surface Nets. Drift SNITTES bort i stedet for å
/// lagres som duplikatflak — shingler/dobler/fantomer kan ikke oppstå. Verifisert 1:1 mot
/// numpy-referansen (scratchpad/tsdf_ref.py) på ekte sesjonsdata før integrasjon.
/// NB: SceneKit flipper normaler for bakvendte flater ved doubleSided — vindingen i Surface
/// Nets er verifisert mot rendring; ikke «rett» den uten å teste.
enum TSDFFusion {

    struct FusedMesh {
        var positions: [Float]
        var normals: [Float]
        var indices: [UInt32]
    }

    private static let integrateMSL = """
    #include <metal_stdlib>
    using namespace metal;
    struct Params {
        float4x4 w2c;
        float3 lo; float voxel;
        int3 dims; float trunc;
        float fx, fy, cx, cy;
        int dw, dh; float maxW; float _pad;
    };

    // Unprojiser ett dybdebilde-piksel til kamera-rom (samme projeksjonsmodell som
    // hovedprosjeksjonen under, kun invers) — brukt til lokal normal-estimering.
    inline float3 unprojectPixel(float uu, float vv, float dd, float fx, float fy, float cx, float cy) {
        return float3((uu - cx) * dd / fx, -(vv - cy) * dd / fy, -dd);
    }

    kernel void tsdf_integrate(device float* tsdf [[buffer(0)]],
                               device float* weight [[buffer(1)]],
                               device const float* depth [[buffer(2)]],
                               constant Params& P [[buffer(3)]],
                               uint3 gid [[thread_position_in_grid]]) {
        if (gid.x >= (uint)P.dims.x || gid.y >= (uint)P.dims.y || gid.z >= (uint)P.dims.z) return;
        float3 wp = P.lo + (float3(gid) + 0.5) * P.voxel;
        float4 pc = P.w2c * float4(wp, 1.0);
        float z = -pc.z;
        if (z < 0.25) return;
        float u = P.fx * pc.x / z + P.cx;
        float v = -P.fy * pc.y / z + P.cy;
        if (u < 0.0 || v < 0.0 || u >= (float)P.dw || v >= (float)P.dh) return;
        int iu = int(u), iv = int(v);
        float sz = depth[iv * P.dw + iu];
        if (sz <= 0.25) return;
        float sdf = sz - z;
        if (sdf <= -P.trunc) return;

        // --- Innfallsvinkel: lokal overflatenormal fra sentraldifferanse i SAMME dybdebilde,
        // ingen ekstra buffer. Grazing-observasjoner (fliser/vegger sett skrått på et trangt
        // bad) forsterker dybdestøy kraftig — cos²(theta) demper dem hardt uten å utelukke dem.
        float dL = (iu > 0)        ? depth[iv * P.dw + (iu - 1)] : 0.0;
        float dR = (iu < P.dw - 1) ? depth[iv * P.dw + (iu + 1)] : 0.0;
        float dU = (iv > 0)        ? depth[(iv - 1) * P.dw + iu] : 0.0;
        float dD = (iv < P.dh - 1) ? depth[(iv + 1) * P.dw + iu] : 0.0;
        float3 pC = unprojectPixel(u, v, sz, P.fx, P.fy, P.cx, P.cy);
        float3 pR = (dR > 0.05) ? unprojectPixel(u + 1.0, v, dR, P.fx, P.fy, P.cx, P.cy) : pC;
        float3 pL = (dL > 0.05) ? unprojectPixel(u - 1.0, v, dL, P.fx, P.fy, P.cx, P.cy) : pC;
        float3 pD = (dD > 0.05) ? unprojectPixel(u, v + 1.0, dD, P.fx, P.fy, P.cx, P.cy) : pC;
        float3 pU = (dU > 0.05) ? unprojectPixel(u, v - 1.0, dU, P.fx, P.fy, P.cx, P.cy) : pC;
        float3 nrm = cross(pR - pL, pD - pU);
        float nlen = length(nrm);
        float angleW;
        if (nlen > 1e-6) {
            float cosTheta = clamp(abs(dot(nrm / nlen, normalize(pC))), 0.0, 1.0);
            angleW = cosTheta * cosTheta; // cos²(theta) — brattere demping enn lineær cos
        } else {
            angleW = 0.5; // degenerert nabolag (bilde-kant / alle naboer avvist) — nøytral, ikke straff dobbelt
        }

        // --- Avstandsfalloff: «sweet spot» ~0.4-1.5 m. Nærfelt har multipath-/nærfeltstøy,
        // fjernfelt har mer generell dybdestøy — begge nedvektes mykt, aldri hardt til 0
        // (et sparsomt dekket område skal fortsatt kunne bygge opp NOK vekt over tid).
        constexpr float dMin = 0.15, dNear = 0.4, dFar = 1.5, dMax = 4.0, distFloor = 0.1;
        float distW;
        if (sz <= dMin || sz >= dMax) {
            distW = distFloor;
        } else if (sz < dNear) {
            distW = mix(distFloor, 1.0, smoothstep(dMin, dNear, sz));
        } else if (sz > dFar) {
            distW = mix(1.0, distFloor, smoothstep(dFar, dMax, sz));
        } else {
            distW = 1.0;
        }

        // --- Konfidens: ARKit sin confidenceMap er allerede brukt til å nullstille .low-piksler
        // FØR dette punktet (MeshScanPresenter.tightDepth — depth==0 der, fanget av sz<=0.25-
        // vakten over). En gradert medium/høy-vekt her ville krevd at rå confidence-verdien
        // overlevde til fusjonstidspunktet, noe den i dag ikke gjør (kollapset til et binært
        // forkast-valg ved capture, aldri lagret som egen fil per keyframe). confW er derfor 1.0
        // — alt som når hit har allerede bestått confidence-porten. Egen oppfølging om ønsket:
        // lagre en liten per-keyframe confidence-fil (speiler depthFile) og send den inn som en
        // ekstra buffer her, samme mønster som depth selv.
        float confW = 1.0;

        float w_obs = angleW * distW * confW;
        if (w_obs < 0.02) return; // ubetydelig bidrag — spar båndbredde fremfor å fusjonere støy mot ~0 vekt

        float val = clamp(sdf / P.trunc, -1.0, 1.0);
        uint idx = (gid.x * (uint)P.dims.y + gid.y) * (uint)P.dims.z + gid.z;
        float w0 = weight[idx];
        tsdf[idx] = (tsdf[idx] * w0 + val * w_obs) / (w0 + w_obs);
        weight[idx] = min(w0 + w_obs, P.maxW);
    }
    """

    private struct Params {
        var w2c: simd_float4x4
        var lo: SIMD3<Float>; var voxel: Float
        var dims: SIMD3<Int32>; var trunc: Float
        var fx: Float; var fy: Float; var cx: Float; var cy: Float
        var dw: Int32; var dh: Int32; var maxW: Float; var _pad: Float = 0
    }

    private static func c2w(_ k: MeshScanPresenter.Keyframe) -> simd_float4x4 {
        let t = k.transform
        return simd_float4x4(columns: (SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]),
                                       SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15])))
    }

    private static func loadDepth(_ k: MeshScanPresenter.Keyframe, _ dir: URL) -> [Float]? {
        guard let df = k.depthFile,
              let d = try? Data(contentsOf: dir.appendingPathComponent(df)),
              d.count == k.depthWidth * k.depthHeight * 4 else { return nil }
        return d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    struct Volume {
        var tsdf: [Float]
        var weight: [Float]
        var dims: SIMD3<Int32>
        var lo: SIMD3<Float>
        var voxel: Float
    }

    /// Offline batch-fusjon (Scaniverse-arkitekturen, 2026-08-13): kjøres ETTER
    /// MeshPoseRefineV2 i MeshBakeV2 — posene antas ferdig raffinert, ingen intern ICP
    /// (det var V1-fuseMesh sin rolle; den er slettet). Ren batch: alle lagrede dybdekart
    /// stemmes inn i voxelfeltet, flaten trekkes ut med Surface Nets, pooles ved behov.
    /// Kvalitets-etterarbeid (plan-snap, hullfylling, glatting) eies av kalleren.
    /// triBudget er nå kun et NØDVERN (RAM/surfaceNets) — reduksjonen eies av
    /// MeshSimplify nedstrøms (kurvatur-bevisst QEM). Første device-kjøring viste
    /// hvorfor: gamle 300k poolet et stort rom til 60mm-klosser; simplifieren gjør
    /// samme jobb uten å ødelegge kanter. RAM-vakten i fuseOnce (40M voxler)
    /// grovner voxelen automatisk for gigarom.
    static func fuseBatch(keyframes: [MeshScanPresenter.Keyframe], framesDir: URL,
                          voxel: Float = 0.010, triBudget: Int = 900_000) -> FusedMesh? {
        let withDepth = keyframes.filter { $0.depthFile != nil && $0.depthWidth > 0 }
        guard withDepth.count >= 12 else {
            MeshLog.log("TSDF batch hoppet over — kun \(withDepth.count) frames med dybde (<12)")
            return nil
        }
        guard var vol = fuseOnce(withDepth, framesDir, voxel: voxel, frameStep: 1) else { return nil }
        smoothWeak(&vol)
        guard var mesh = surfaceNets(vol) else { return nil }
        var pools = 0
        while mesh.indices.count / 3 > triBudget && pools < 3 {
            vol = pool2x(vol)
            guard let coarser = surfaceNets(vol) else { break }
            mesh = coarser
            pools += 1
            MeshLog.log("TSDF poolet ×2 → \(Int(vol.voxel * 1000))mm, \(mesh.indices.count / 3) tris")
        }
        MeshLog.log("TSDF batch — \(withDepth.count) frames → \(mesh.positions.count / 3) verts, \(mesh.indices.count / 3) tris à \(Int(vol.voxel * 1000))mm")
        return mesh
    }

    /// Retningsløs 3³-glatting av tsdf-verdien KUN i svakt observerte voxler (0 < w < 2):
    /// den senkede gyldighetsterskelen (0.35) slapp sparsomt-men-ekte flate gjennom (tak!),
    /// men også enkeltobservasjonsstøy — bulker som ble «konfetti» av feilprosjiserte specks
    /// på vegger, og hairy topologi som fikk xatlas til å stalle på 5 %. Sterke voxler
    /// (w ≥ 2) røres ikke — detaljene bevares der data er god.
    private static func smoothWeak(_ v: inout Volume) {
        let dx = Int(v.dims.x), dy = Int(v.dims.y), dz = Int(v.dims.z)
        guard dx > 2, dy > 2, dz > 2 else { return }
        let src = v.tsdf
        let w = v.weight
        var out = src
        var touched = 0
        for x in 1..<(dx - 1) {
            for y in 1..<(dy - 1) {
                for z in 1..<(dz - 1) {
                    let i = (x * dy + y) * dz + z
                    let wi = w[i]
                    if wi <= 0 || wi >= 2 { continue }
                    var ts: Float = 0, ws: Float = 0
                    for ox in -1...1 {
                        for oy in -1...1 {
                            for oz in -1...1 {
                                let j = ((x + ox) * dy + (y + oy)) * dz + (z + oz)
                                let wj = w[j]
                                if wj <= 0 { continue }
                                ts += src[j] * wj
                                ws += wj
                            }
                        }
                    }
                    if ws > 0 { out[i] = ts / ws; touched += 1 }
                }
            }
        }
        v.tsdf = out
        if touched > 0 { MeshLog.log("svak-voxel-glatting — \(touched / 1000)k voxler") }
    }

    /// Halver oppløsningen: vektet snitt av 2×2×2-barn. Ren re-ekstraksjon gir alltid clean
    /// manifold-topologi — i motsetning til mesh-decimering.
    private static func pool2x(_ v: Volume) -> Volume {
        let nd = SIMD3<Int32>((v.dims.x + 1) / 2, (v.dims.y + 1) / 2, (v.dims.z + 1) / 2)
        let n = Int(nd.x) * Int(nd.y) * Int(nd.z)
        var t = [Float](repeating: 1.0, count: n)
        var w = [Float](repeating: 0, count: n)
        let dx = Int(v.dims.x), dy = Int(v.dims.y), dz = Int(v.dims.z)
        for x in 0..<Int(nd.x) {
            for y in 0..<Int(nd.y) {
                for z in 0..<Int(nd.z) {
                    var ts: Float = 0, ws: Float = 0
                    for ox in 0...1 { for oy in 0...1 { for oz in 0...1 {
                        let sx = x * 2 + ox, sy = y * 2 + oy, sz = z * 2 + oz
                        if sx >= dx || sy >= dy || sz >= dz { continue }
                        let i = (sx * dy + sy) * dz + sz
                        ts += v.tsdf[i] * v.weight[i]
                        ws += v.weight[i]
                    }}}
                    let o = (x * Int(nd.y) + y) * Int(nd.z) + z
                    // SUM vektene (capped), ikke snitt: /8 fortynnet tynne overflate-skall under
                    // gyldighetsterskelen og ga stripete hull-kolonner (fanget i Mac-harness).
                    if ws > 0 { t[o] = ts / ws; w[o] = min(ws, 64) }
                }
            }
        }
        return Volume(tsdf: t, weight: w, dims: nd, lo: v.lo, voxel: v.voxel * 2)
    }

    private static func fuseOnce(_ kfs: [MeshScanPresenter.Keyframe], _ dir: URL,
                                 voxel: Float, frameStep: Int) -> Volume? {
        let TRUNC = 4 * voxel
        // --- Romgrenser (1/99-percentil av unprojiserte punkter ± 15 cm) ---
        var xs = [Float](), ys = [Float](), zs = [Float]()
        for k in Swift.stride(from: 0, to: kfs.count, by: max(1, kfs.count / 30)).map({ kfs[$0] }) {
            guard let D = loadDepth(k, dir) else { continue }
            let sx = Float(k.depthWidth) / Float(k.width)
            let fx = k.intrinsics[0] * sx, fy = k.intrinsics[1] * sx
            let cx = k.intrinsics[2] * sx, cy = k.intrinsics[3] * sx
            let m = c2w(k)
            for v in Swift.stride(from: 0, to: k.depthHeight, by: 4) {
                for u in Swift.stride(from: 0, to: k.depthWidth, by: 4) {
                    let z = D[v * k.depthWidth + u]
                    if z < 0.25 || z > 6.0 { continue }
                    let x = (Float(u) + 0.5 - cx) * z / fx
                    let y = -(Float(v) + 0.5 - cy) * z / fy
                    let w4 = m * SIMD4<Float>(x, y, -z, 1)
                    xs.append(w4.x); ys.append(w4.y); zs.append(w4.z)
                }
            }
        }
        guard xs.count > 1000 else { return nil }
        func pct(_ a: [Float], _ p: Float) -> Float {
            let s = a.sorted()
            return s[min(s.count - 1, max(0, Int(Float(s.count) * p)))]
        }
        let lo = SIMD3<Float>(pct(xs, 0.01) - 0.15, pct(ys, 0.01) - 0.15, pct(zs, 0.01) - 0.15)
        let hi = SIMD3<Float>(pct(xs, 0.99) + 0.15, pct(ys, 0.99) + 0.15, pct(zs, 0.99) + 0.15)
        var dims = SIMD3<Int32>(Int32(ceil((hi.x - lo.x) / voxel)), Int32(ceil((hi.y - lo.y) / voxel)), Int32(ceil((hi.z - lo.z) / voxel)))
        // RAM-vakt: maks ~40M voxler (2×4B → ~320MB); grovere voxel ved gigarom
        var effVoxel = voxel
        while Int(dims.x) * Int(dims.y) * Int(dims.z) > 40_000_000 {
            effVoxel *= 1.26
            dims = SIMD3<Int32>(Int32(ceil((hi.x - lo.x) / effVoxel)), Int32(ceil((hi.y - lo.y) / effVoxel)), Int32(ceil((hi.z - lo.z) / effVoxel)))
        }
        let nvox = Int(dims.x) * Int(dims.y) * Int(dims.z)
        MeshLog.log("TSDF-volum: \(dims.x)×\(dims.y)×\(dims.z) = \(nvox / 1_000_000)M voxler à \(Int(effVoxel * 1000))mm")

        // --- Metal-integrasjon ---
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let lib = try? device.makeLibrary(source: integrateMSL, options: nil),
              let fn = lib.makeFunction(name: "tsdf_integrate"),
              let pipe = try? device.makeComputePipelineState(function: fn),
              let tsdfBuf = device.makeBuffer(length: nvox * 4, options: .storageModeShared),
              let weightBuf = device.makeBuffer(length: nvox * 4, options: .storageModeShared) else { return nil }
        let tp = tsdfBuf.contents().bindMemory(to: Float.self, capacity: nvox)
        for i in 0..<nvox { tp[i] = 1.0 }
        for fi in Swift.stride(from: 0, to: kfs.count, by: frameStep) {
            let k = kfs[fi]
            guard let D = loadDepth(k, dir) else { continue }
            let sx = Float(k.depthWidth) / Float(k.width)
            var P = Params(w2c: c2w(k).inverse, lo: lo, voxel: effVoxel, dims: dims, trunc: 4 * effVoxel,
                           fx: k.intrinsics[0] * sx, fy: k.intrinsics[1] * sx,
                           cx: k.intrinsics[2] * sx, cy: k.intrinsics[3] * sx,
                           dw: Int32(k.depthWidth), dh: Int32(k.depthHeight), maxW: 64)
            _ = TRUNC // (P.trunc følger effVoxel)
            guard let dBuf = device.makeBuffer(bytes: D, length: D.count * 4, options: .storageModeShared),
                  let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { continue }
            enc.setComputePipelineState(pipe)
            enc.setBuffer(tsdfBuf, offset: 0, index: 0)
            enc.setBuffer(weightBuf, offset: 0, index: 1)
            enc.setBuffer(dBuf, offset: 0, index: 2)
            enc.setBytes(&P, length: MemoryLayout<Params>.stride, index: 3)
            enc.dispatchThreads(MTLSize(width: Int(dims.x), height: Int(dims.y), depth: Int(dims.z)),
                                threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 4))
            enc.endEncoding()
            cb.commit(); cb.waitUntilCompleted()
        }

        let tsdf = Array(UnsafeBufferPointer(start: tp, count: nvox))
        let wgt = Array(UnsafeBufferPointer(start: weightBuf.contents().bindMemory(to: Float.self, capacity: nvox), count: nvox))
        return Volume(tsdf: tsdf, weight: wgt, dims: dims, lo: lo, voxel: effVoxel)
    }

    private static func surfaceNets(_ vol: Volume) -> FusedMesh? {
        let tsdf = vol.tsdf, weight = vol.weight, dims = vol.dims, lo = vol.lo, voxel = vol.voxel
        let dx = Int(dims.x), dy = Int(dims.y), dz = Int(dims.z)
        @inline(__always) func vidx(_ x: Int, _ y: Int, _ z: Int) -> Int { (x * dy + y) * dz + z }
        // 0.6: tak/gulv ses skrått (cos²θ) og langt unna (falloff) → ekte flate nådde aldri
        // gamle 1.0 og ble fillete gråhull. NB: frameStep 1 (var 2) DOBLET alle vekter, så
        // 0.6 ≈ 0.3 i gamle enheter — 3× løsere enn originalen. 0.35 var 6× løsere og slapp
        // gjennom svake DRIFT-SKALL foran ekte flater: Surface Nets emitterte begge →
        // interleavede sliver-striper («persienne-madrassgavl», 2026-08-10 23:33).
        @inline(__always) func valid(_ i: Int) -> Bool { weight[i] > 0.6 }
        var cellVert = [Int32](repeating: -1, count: (dx - 1) * (dy - 1) * (dz - 1))
        @inline(__always) func cidx(_ x: Int, _ y: Int, _ z: Int) -> Int { (x * (dy - 1) + y) * (dz - 1) + z }
        var verts = [SIMD3<Float>]()
        let corners: [(Int, Int, Int)] = [(0,0,0),(1,0,0),(0,1,0),(1,1,0),(0,0,1),(1,0,1),(0,1,1),(1,1,1)]
        let edges: [(Int, Int)] = [(0,1),(2,3),(4,5),(6,7),(0,2),(1,3),(4,6),(5,7),(0,4),(1,5),(2,6),(3,7)]
        var cv = [Float](repeating: 0, count: 8)
        for x in 0..<(dx - 1) {
            for y in 0..<(dy - 1) {
                for z in 0..<(dz - 1) {
                    // Ubetraktede hjørner = LUFT (+1), IKKE skip: all-8-gyldig-kravet skippet
                    // 53 % av overflatecellene på poolet felt (tynt trunkeringsskall vs voxel)
                    // → stripete hull. Vakter mot dikting: ≥4 observerte hjørner og minst ett
                    // observert NEGATIVT (innsiden må være sett — luft-substitusjon kan aldri
                    // skape flate i helt uobservert rom).
                    var sign = 0
                    var observed = 0
                    var negObserved = false
                    for (ci, c) in corners.enumerated() {
                        let i = vidx(x + c.0, y + c.1, z + c.2)
                        if valid(i) {
                            observed += 1
                            cv[ci] = tsdf[i]
                            if cv[ci] < 0 { negObserved = true }
                        } else {
                            cv[ci] = 1.0
                        }
                        sign |= cv[ci] < 0 ? 1 : 2
                    }
                    guard sign == 3, observed >= 3, negObserved else { continue } // 3 (var 4): sparsomt tak/gulv
                    var acc = SIMD3<Float>(0, 0, 0)
                    var n = 0
                    for (a, b) in edges {
                        let va = cv[a], vb = cv[b]
                        if (va < 0) == (vb < 0) { continue }
                        let t = va / (va - vb)
                        let pa = SIMD3(Float(corners[a].0), Float(corners[a].1), Float(corners[a].2))
                        let pb = SIMD3(Float(corners[b].0), Float(corners[b].1), Float(corners[b].2))
                        acc += pa + (pb - pa) * t
                        n += 1
                    }
                    guard n > 0 else { continue }
                    let p = lo + (SIMD3(Float(x), Float(y), Float(z)) + acc / Float(n) + 0.5) * voxel
                    cellVert[cidx(x, y, z)] = Int32(verts.count)
                    verts.append(p)
                }
            }
        }
        var indices = [UInt32]()
        indices.reserveCapacity(verts.count * 6)
        func emitQuad(_ c0: Int, _ c1: Int, _ c2: Int, _ c3: Int, _ flip: Bool) {
            let a = cellVert[c0], b = cellVert[c1], c = cellVert[c2], d = cellVert[c3]
            guard a >= 0, b >= 0, c >= 0, d >= 0 else { return }
            if flip {
                indices.append(contentsOf: [UInt32(a), UInt32(b), UInt32(c), UInt32(a), UInt32(c), UInt32(d)])
            } else {
                indices.append(contentsOf: [UInt32(a), UInt32(c), UInt32(b), UInt32(a), UInt32(d), UInt32(c)])
            }
        }
        // Kant-testene bruker samme luft-substitusjon som cellene; den NEGATIVE siden av
        // kanten må være observert (samme dikt-vern).
        @inline(__always) func sval(_ i: Int) -> Float { valid(i) ? tsdf[i] : 1.0 }
        for x in 1..<(dx - 1) {
            for y in 1..<(dy - 1) {
                for z in 1..<(dz - 1) {
                    let i0 = vidx(x, y, z)
                    let v0 = sval(i0)
                    if x + 1 < dx {
                        let i1 = vidx(x + 1, y, z)
                        let v1 = sval(i1)
                        if (v0 < 0) != (v1 < 0), (v0 < 0) ? valid(i0) : valid(i1) {
                            emitQuad(cidx(x, y - 1, z - 1), cidx(x, y, z - 1), cidx(x, y, z), cidx(x, y - 1, z), v0 < 0)
                        }
                    }
                    if y + 1 < dy {
                        let i1 = vidx(x, y + 1, z)
                        let v1 = sval(i1)
                        if (v0 < 0) != (v1 < 0), (v0 < 0) ? valid(i0) : valid(i1) {
                            emitQuad(cidx(x - 1, y, z - 1), cidx(x - 1, y, z), cidx(x, y, z), cidx(x, y, z - 1), v0 < 0)
                        }
                    }
                    if z + 1 < dz {
                        let i1 = vidx(x, y, z + 1)
                        let v1 = sval(i1)
                        if (v0 < 0) != (v1 < 0), (v0 < 0) ? valid(i0) : valid(i1) {
                            emitQuad(cidx(x - 1, y - 1, z), cidx(x, y - 1, z), cidx(x, y, z), cidx(x - 1, y, z), v0 < 0)
                        }
                    }
                }
            }
        }
        guard !verts.isEmpty, !indices.isEmpty else { return nil }
        var pos = [Float](); pos.reserveCapacity(verts.count * 3)
        for v in verts { pos.append(v.x); pos.append(v.y); pos.append(v.z) }
        // Normaler fra TRIANGLENE (vindingen er sign-avledet og konsistent) — IKKE fra
        // tsdf-gradienten: uobserverte naboer lagres som +1,0 og kuppet gradienten ved
        // observasjonsgrenser → flippede normaler i striper (fanget i Mac-harness).
        let nrm = ARMeshGlbExporter.recomputeNormals(positions: pos, indices: indices)
        return FusedMesh(positions: pos, normals: nrm, indices: indices)
    }

}
