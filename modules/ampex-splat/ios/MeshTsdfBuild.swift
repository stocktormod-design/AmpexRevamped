import Foundation
import simd
import Metal
import os // os_proc_available_memory — ekte headroom, ikke total RAM
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

    /// Diagnose-utløp (kun Mac-CLI): får se volumet (sdf, vekt, dim, lo, voxel) rett før
    /// flatene trekkes ut. nil på enhet.
    static var volumeProbe: ((UnsafeMutablePointer<Float>, UnsafeMutablePointer<Float>, SIMD3<Int>, SIMD3<Float>, Float) -> Void)? = nil

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
        /// Trunkering BAK flaten, i voxler. MÅLT OG FORKASTET som kur mot tynne objekter
        /// (2026-09-02): 1.5 voxler bak ga hull og avflassing over hele rommet (putekant,
        /// stolbein, gulv), fordi voxlene rett bak flaten da får for få observasjoner til å
        /// passere minWeight når dybdestøyen flytter flaten ±2 cm. Stolryggenes hull kom
        /// dessuten ikke av dette. Står som samme verdi som foran; meshscan.tsdfbehind for A/B.
        var truncBehindVoxels: Float = 3.2
        /// Kantfilterets radius (LiDAR-piksler): 1 = fire naboer. 2 (to radier) fjernet 13–22 %
        /// av pikslene og ga hull; 1 er praktisk talt likt den gamle høyre/ned-testen, men
        /// symmetrisk. Se meshscan.tsdfedge.
        var edgeRadius: Int = 1
        /// Minste akkumulerte vekt før en voxel regnes som ekte flate. Lavt gir krøllete
        /// falske flater der bare én-to stråler har vært innom; høyt spiser hull. Var 4 (hevet
        /// fra 3 sammen med trunkeringen, mot det svakeste laget i en dobbeltflate).
        /// SENKET TIL 2,5 (2026-09-09) etter måling mot Scaniverse-eksporten. 4 var kalibrert
        /// på tette skann; på et helt rom med tynnere dybdestrøm spiste den flate:
        ///   stue-fixturen  minw 4 → 45,4 m² flate og 4,98 m åpen rand/m²
        ///                  minw 2,5 → 68,0 m² og 3,87    minw 1,5 → 88,0 m² og 3,71
        ///   soveromsbundel minw 4 → 30,4 m² og 3,46      minw 2,5 → 31,8 m² og 3,38
        /// Referansen ligger på 3,70. Prisen er målt og liten: veggens RMS-avvik fra planet
        /// går 2,4 → 2,8 mm (Scaniverse selv ligger på 30,1 mm), sporkontrast og brudd på
        /// panelveggen er uendret (0,755 → 0,751 % og 0,0392 → 0,0395 %), og areal i biter
        /// under 0,05 m² går NED (0,39 → 0,27 %). 1,5 lukker enda mer, men brudd i sporene
        /// stiger til 0,046 % — derfor brukes 1,5 bare der dybden faktisk er tynn, se
        /// tetthetsregelen i `build`. meshscan.tsdfminw overstyrer alt dette.
        var minWeight: Float = 2.5
        /// Blur-passeringer på SELVE VOLUMET før nettet trekkes ut. Taubin på det ferdige
        /// nettet er utilstrekkelig — støyen sitter i SDF-en, ikke i vertekstplasseringen.
        var volumeBlur: Int = 1
        /// Taubin-passeringer på nettet etterpå. Partall holder λ og μ i balanse.
        var smoothPasses: Int = 4
        /// Maks kamerahastighet (m/s) for at et dybdekart skal telle. Dybdekart tatt under
        /// rask bevegelse legger flaten centimeter feil og kolliderer med de rolige
        /// målingene av samme vegg. MÅLT: 0,35 kaster 28 % av framene og gjør resultatet
        /// BEDRE. (Den gamle setningen «drift er ikke årsaken — re-ankring flytter posene
        /// 0,0 mm» var feil slutning: re-ankringen mot ARMeshAnchor flytter INGENTING fordi
        /// ARKit legger korreksjonen i ankerets geometri, ikke i transformen. Målt 13.09:
        /// gulv og tak drev 11 cm i løpet av 80 s. Se `driftrett`.)
        var maxVelocity: Float = 0.35
        /// Oppskalering av keyframe-dybden med RGB som guide (joint bilateral upsampling).
        /// 1 = av. Keyframene er det eneste stedet med både 4K-bilde og eget dybdekart
        /// perfekt synkronisert. Gir kantpresisjon; dense-framene gir dekning.
        var jbuScale: Int = 3
        /// FRIROM-UTSKJÆRING (space carving). En stråle som treffer en flate på avstand zr har
        /// per definisjon fritt rom hele veien dit (utenfor trunkeringssonen). Klassisk TSDF
        /// skriver ingenting der, så en falsk flate FORAN den ekte — flygende piksler, en frame
        /// med posedrift, et tynt objekt sett fra siden — blir stående så lenge noen få stråler
        /// har lagt den der. Målt (stue 2026-09-02): i en typisk frame så 6 % av pikslene en
        /// mesh-flate foran LiDAR-flaten, i de verste 25 %. Her telles frirom-stemmer i et
        /// grovere volum, og voxels der frirommet vinner klart over flatevekten fjernes.
        /// 0 = av. Verdien er hvor mange ganger flatevekten frirommet må overstige.
        /// Målt 2026-09-02 (kf65, andel LiDAR-piksler med falsk flate FORAN): av 13,5 % ·
        /// ratio 8: 3,2 % · ratio 4: 1,0 % (men begynte å skjære i stolarmer og putekanter) ·
        /// ratio 2: gulv og vegger fikk hull. 8 er valgt som den forsiktige siden.
        /// 2026-09-07 (Mac-harness, soverom 20:05, A/B 8 · 20 · 40 · av): utskjæringen tok
        /// hylla, sengekanten, TV-en og pulten — tynne/skrå flater med mange stråler GJENNOM
        /// gapene — og ga ingen synlig spøkelsesgevinst i rendret innenfra/utenfra. Av som
        /// standard; `meshscan.carve 8` slår den på igjen ved falske flater.
        var carveRatio: Float = 0.0
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
        /// Kamera→verden. `var` fordi driftrettingen (se `driftrett`) skriver den om før fusjonen.
        var c2w: simd_float4x4
        /// Rå dybde på disk (dense-frames), eller ferdig JBU-oppskalert i minnet (keyframes).
        let url: URL?
        let inline: [Float]?
        /// Tillit til denne framens pose, 0–1, ut fra kamerahastigheten da den ble tatt.
        /// Ganges inn i voxelvekten så urolige kart teller mindre uten å forsvinne.
        var trust: Float = 1
        /// Keyframe-guide for depth super-res; nil for dense-frames.
        let jbuGuide: URL?
        let jbuScale: Int
        /// ARKit-tidsstempel (sekunder). Driftrettingen interpolerer korreksjoner langs tida.
        var timestamp: Double = 0
        /// Keyframe-indeks når kartet er et nøkkelbilde — den korrigerte posen skal tilbake
        /// til teksturbaken, ellers projiseres fotoet med den drifta posen på rettet geometri.
        var kfIndex: Int? = nil

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
        let planes: [UnsafeMutablePointer<Float>]
        var sdf: UnsafeMutablePointer<Float> { planes[0] }
        var wgt: UnsafeMutablePointer<Float> { planes[1] }
        private let bytes: Int
        private let urls: [URL]
        private let fds: [Int32]

        init?(count: Int, dir: URL, names: [String] = ["tsdf-sdf.bin", "tsdf-wgt.bin"]) {
            // LOKAL kopi: brukes den lagrede egenskapen inne i opprydnings-closurene under,
            // fanger de self før alle medlemmer er satt, og Swift avviser det.
            let nb = count * MemoryLayout<Float>.stride
            var ptrs: [UnsafeMutableRawPointer] = []
            var us: [URL] = [], fs: [Int32] = []
            for name in names {
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
            planes = ptrs.map { $0.bindMemory(to: Float.self, capacity: count) }
            // ftruncate gir en fil full av nuller, som er nøyaktig startverdien vi vil ha.
            urls = us; fds = fs
        }

        deinit {
            for p in planes { munmap(UnsafeMutableRawPointer(p), bytes) }
            fds.forEach { close($0) }
            urls.forEach { try? FileManager.default.removeItem(at: $0) }
        }
    }

    // MARK: - Bygg

    /// Fusjonerer all rå dybde i `framesDir` og returnerer et mesh i samme form som
    /// `MeshBakeV2.mergeAnchors` gir, klart for unwrap og bake. nil om dataene mangler.

    // MARK: - GPU-fusjon (2026-09-05)
    //
    // Polycam-veien. Nøyaktig samme MODELL som CPU-fusjonen over: samme kantfilter
    // per piksel, samme 1/d-vekt med gulv, samme tillit og JBU-normalisering, samme
    // trunkering foran og bak flaten. Forskjellen er samplingen: CPU-veien marsjerer
    // hver stråle i halve voxelsteg og skriver voxlene den treffer; GPU-veien besøker
    // hver voxel én gang og spør «hvilken måling ser meg?». Det er den samme
    // avstandsfunksjonen evaluert på et renere rutenett — ingen doble treff nær
    // kameraet, ingen hull mellom strålene langt unna.
    //
    // Kappløp finnes ikke: to summer (Σ w·d og Σ w) akkumuleres med atomiske
    // float-add per voxel, og S = Σwd/Σw regnes ut til slutt. Det er det VEKTEDE
    // SNITTET CPU-veien tilnærmer med sitt løpende snitt; taket på 40 legges på W
    // etterpå så terskler og glatting nedstrøms ser den samme skalaen.
    private static let integrateMSL = """
    #include <metal_stdlib>
    using namespace metal;
    struct P {
        float4x4 w2c;
        float3 lo; float voxel;
        int3 dims; float trunc;
        float truncBehind; float fx, fy, cx;
        float cy; int dw, dh; float wf0;   // wf0 = trust * jbuNorm (per kart)
        int edgeRadius, jbuScale, _p0, _p1;
    };
    inline float dep(device const float* d, int x, int y, int w) { return d[y * w + x]; }
    // Selve målingen ligger i ÉN inline-funksjon, og både det tette og det sparsomme
    // volumet kaller den. Da KAN de ikke komme i utakt — §102 er en lagringsendring,
    // ikke en modellendring, og det må være synlig i koden at den er det.
    inline void ampex_fuse(device atomic_float* sumWD, device atomic_float* sumW,
                           device const float* depth, constant P& p, int3 g, uint slot) {
        float3 wp = p.lo + (float3(g) + 0.5) * p.voxel;
        float4 pc = p.w2c * float4(wp, 1.0);
        float zc = -pc.z;
        if (zc < 0.3) return;
        // Samme projeksjon som CPU-veiens unprojeksjon, bare baklengs.
        float u = p.fx * pc.x / zc + p.cx;
        float v = -p.fy * pc.y / zc + p.cy;
        int x = int(u), y = int(v);
        if (x < 1 || y < 1 || x >= p.dw - 1 || y >= p.dh - 1) return;
        float z = dep(depth, x, y, p.dw);
        if (z <= 0.3 || z >= 5.0) return;
        // Kantfilter — identisk med CPU-veien (edgeRadius 0/1/2, skalert med JBU).
        float lim = max(0.04, 0.03 * z);
        bool edge = false;
        if (p.edgeRadius <= 0) {
            float dz = max(fabs(dep(depth, x + 1, y, p.dw) - z), fabs(dep(depth, x, y + 1, p.dw) - z));
            edge = dz > lim;
        } else {
            int r1 = p.jbuScale, r2 = 2 * p.jbuScale;
            int nx[8] = { x + r1, x - r1, x, x, x + r2, x - r2, x, x };
            int ny[8] = { y, y, y + r1, y - r1, y, y, y + r2, y - r2 };
            int n = p.edgeRadius >= 2 ? 8 : 4;
            for (int k = 0; k < n && !edge; k++) {
                if (nx[k] < 0 || ny[k] < 0 || nx[k] >= p.dw || ny[k] >= p.dh) continue;
                float dn = dep(depth, nx[k], ny[k], p.dw);
                if (dn > 0.3 && fabs(dn - z) > lim) edge = true;
            }
        }
        if (edge) return;
        // sceneDepth er Z-dybde: langs pikselens stråle er avstanden z·len, og voxelen
        // ligger ved zc·len. Signert avstand langs strålen = (z − zc)·len.
        float3 ray = float3((float(x) - p.cx) / p.fx, -(float(y) - p.cy) / p.fy, -1.0);
        float len = length(ray);
        float sdf = (z - zc) * len;
        if (sdf > p.trunc || sdf < -p.truncBehind) return;
        float d = clamp(sdf / p.trunc, -1.0, 1.0);
        float wf = max(0.25, min(1.5, 1.5 / max(z, 0.4))) * p.wf0;
        atomic_fetch_add_explicit(&sumWD[slot], d * wf, memory_order_relaxed);
        atomic_fetch_add_explicit(&sumW[slot],  wf,     memory_order_relaxed);
    }
    kernel void ampex_integrate(device atomic_float* sumWD [[buffer(0)]],
                                device atomic_float* sumW  [[buffer(1)]],
                                device const float* depth  [[buffer(2)]],
                                constant P& p              [[buffer(3)]],
                                uint3 gid [[thread_position_in_grid]]) {
        if (gid.x >= (uint)p.dims.x || gid.y >= (uint)p.dims.y || gid.z >= (uint)p.dims.z) return;
        uint i = (gid.z * p.dims.y + gid.y) * p.dims.x + gid.x;
        ampex_fuse(sumWD, sumW, depth, p, int3(gid), i);
    }
    // Sparsom: én tråd per voxel i en ALLOKERT blokk. `blocks[b]` er blokkens koordinat i
    // blokkrutenettet, og plassen i lageret er b*512 + lokal indeks — samme ordning som
    // `Blokkvolum.plass` på CPU-siden.
    kernel void ampex_integrate_sparse(device atomic_float* sumWD [[buffer(0)]],
                                       device atomic_float* sumW  [[buffer(1)]],
                                       device const float* depth  [[buffer(2)]],
                                       constant P& p              [[buffer(3)]],
                                       device const int4* blocks  [[buffer(4)]],
                                       uint gid [[thread_position_in_grid]]) {
        uint b = gid >> 9, l = gid & 511u;
        int4 bc = blocks[b];
        int3 g = int3(bc.x * 8 + int(l & 7u), bc.y * 8 + int((l >> 3) & 7u), bc.z * 8 + int(l >> 6));
        if (g.x >= p.dims.x || g.y >= p.dims.y || g.z >= p.dims.z) return;
        ampex_fuse(sumWD, sumW, depth, p, g, gid);
    }
    """

    private struct GPUParams {
        var w2c: simd_float4x4
        var lo: SIMD3<Float>; var voxel: Float
        var dims: SIMD3<Int32>; var trunc: Float
        var truncBehind: Float; var fx: Float, fy: Float, cx: Float
        var cy: Float; var dw: Int32, dh: Int32; var wf0: Float
        var edgeRadius: Int32, jbuScale: Int32, p0: Int32, p1: Int32
    }

    /// Fusjonerer alle dybdekart på GPU og skriver S/W. nil = GPU utilgjengelig
    /// eller for lite minne — kalleren tar CPU-veien. Ingen kvalitetsforskjell i
    /// modellen; se kommentaren over integrateMSL.
    private static func integrateGPU(frames: [DFrame], lo: SIMD3<Float>, vox: Float, dim: SIMD3<Int>,
                                     trunc: Float, truncBehind: Float, options: Options,
                                     S: UnsafeMutablePointer<Float>, W: UnsafeMutablePointer<Float>) -> Int? {
        let total = dim.x * dim.y * dim.z
        // To flyttallsplan ekstra i RAM (Σwd, Σw). På en presset telefon er dette det
        // som avgjør om vi kjører GPU eller CPU — ikke kvaliteten.
        let trenger = UInt64(total) * 8 * 2
        if MeshSimMem.available() < trenger {
            MeshLog.log("GPU-fusjon: for lite ledig minne (\(Int(MeshSimMem.available() >> 20)) MB) — CPU-vei")
            return nil
        }
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let lib = try? device.makeLibrary(source: integrateMSL, options: nil),
              let fn = lib.makeFunction(name: "ampex_integrate"),
              let pipe = try? device.makeComputePipelineState(function: fn),
              let wdBuf = device.makeBuffer(length: total * 4, options: .storageModeShared),
              let wBuf = device.makeBuffer(length: total * 4, options: .storageModeShared) else {
            MeshLog.log("GPU-fusjon: Metal utilgjengelig — CPU-vei")
            return nil
        }
        memset(wdBuf.contents(), 0, total * 4)
        memset(wBuf.contents(), 0, total * 4)
        let jbuRaw = UserDefaults.standard.string(forKey: "meshscan.jbuweight") == "raw"
        let tg = MTLSize(width: 8, height: 8, depth: 4)
        let grid = MTLSize(width: dim.x, height: dim.y, depth: dim.z)
        var kart = 0
        let t0 = CFAbsoluteTimeGetCurrent()
        // Flere kart per kommandobuffer: GPU-en jobber mens CPU-en laster neste kart.
        var cb = queue.makeCommandBuffer()
        var iBatch = 0
        for (fi, f) in frames.enumerated() {
            if fi % 25 == 0 { ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR… \(fi * 100 / max(frames.count, 1)) %") }
            guard let dep = f.load(), let dBuf = device.makeBuffer(bytes: dep, length: dep.count * 4, options: .storageModeShared) else { continue }
            let norm: Float = (jbuRaw || f.jbuScale <= 1) ? 1 : 1 / Float(f.jbuScale * f.jbuScale)
            var P = GPUParams(w2c: f.c2w.inverse, lo: lo, voxel: vox,
                              dims: SIMD3<Int32>(Int32(dim.x), Int32(dim.y), Int32(dim.z)), trunc: trunc,
                              truncBehind: truncBehind, fx: f.fx, fy: f.fy, cx: f.cx,
                              cy: f.cy, dw: Int32(f.w), dh: Int32(f.h), wf0: f.trust * norm,
                              edgeRadius: Int32(options.edgeRadius), jbuScale: Int32(f.jbuScale), p0: 0, p1: 0)
            guard let c = cb, let enc = c.makeComputeCommandEncoder() else { continue }
            enc.setComputePipelineState(pipe)
            enc.setBuffer(wdBuf, offset: 0, index: 0)
            enc.setBuffer(wBuf, offset: 0, index: 1)
            enc.setBuffer(dBuf, offset: 0, index: 2)
            enc.setBytes(&P, length: MemoryLayout<GPUParams>.stride, index: 3)
            enc.dispatchThreads(grid, threadsPerThreadgroup: tg)
            enc.endEncoding()
            kart += 1; iBatch += 1
            if iBatch >= 8 {
                c.commit(); c.waitUntilCompleted()
                cb = queue.makeCommandBuffer(); iBatch = 0
            }
        }
        if let c = cb, iBatch > 0 { c.commit(); c.waitUntilCompleted() }
        // Σwd/Σw → S, tak på W som før.
        let wd = wdBuf.contents().bindMemory(to: Float.self, capacity: total)
        let ww = wBuf.contents().bindMemory(to: Float.self, capacity: total)
        DispatchQueue.concurrentPerform(iterations: 8) { sl in
            let a = sl * total / 8, b = (sl + 1) * total / 8
            for i in a..<b {
                let w = ww[i]
                S[i] = w > 0 ? wd[i] / w : 0
                W[i] = min(w, 40)
            }
        }
        MeshLog.log(String(format: "GPU-fusjon: %d dybdekart på %.1fs", kart, CFAbsoluteTimeGetCurrent() - t0))
        return kart
    }

    /// `tillegg` er ARKit-nettet fra SAMME økt. TSDF-en er bedre der den har dybde, men på et
    /// helt rom har den store tomrom der dybdestrømmen var tynn eller flaten aldri fikk nok
    /// målinger — målt mot Scaniverse-eksporten: 4,66–5,77 m åpen rand per m² mot referansens
    /// 3,70, og 153 av 224 m av vår rand lå i TRE store løkker. ARKit fusjonerer sin egen mesh
    /// over hele økten og dekker nettopp de områdene. Trianglene derfra tas KUN der TSDF-en
    /// ikke har flate i nærheten, så de to kan ikke legge doble skall over hverandre.
    /// `poseSink` får de DRIFTRETTEDE nøkkelbildeposene (keyframe-indeks → kamera→verden,
    /// 16 flyttall kolonnevis) når driftrettingen har flyttet dem. Teksturbaken må bruke de
    /// samme posene som geometrien er bygd med, ellers står fotoet 10 cm feil på veggen.
    static func build(framesDir: URL, options optionsIn: Options = Options(),
                      tillegg: MeshBakeV2.MergedMesh? = nil,
                      poseSink: (([Int: [Float]]) -> Void)? = nil) -> MeshBakeV2.MergedMesh? {
        var options = optionsIn
        // JBU kan lage FALSK geometri på teksturløse flater: den lar dybden hoppe der GUIDEN
        // har en kant, og et hvitt tak har ingen tekstur men vel lysgradienter og skygger.
        // Leses de som kanter, oppstår dybdesprang som ikke finnes — flak som flyter foran
        // taket. meshscan.jbu = 1 slår den av.
        if let j = Int(UserDefaults.standard.string(forKey: "meshscan.jbu") ?? "") { options.jbuScale = max(1, j) }
        if let s = UserDefaults.standard.string(forKey: "meshscan.voxel"), let v = Float(s), v >= 0.006 {
            options.voxel = v
        }
        if let s = UserDefaults.standard.string(forKey: "meshscan.tsdftrunc"), let v = Float(s), v > 0.5 {
            options.truncVoxels = min(8, v)
        }
        if let s = UserDefaults.standard.string(forKey: "meshscan.tsdfbehind"), let v = Float(s), v > 0.5 {
            options.truncBehindVoxels = min(8, v)
        }
        if let s = UserDefaults.standard.string(forKey: "meshscan.carve"), let v = Float(s), v >= 0 {
            options.carveRatio = v
        }
        if let s = UserDefaults.standard.string(forKey: "meshscan.tsdfminw"), let v = Float(s), v >= 1 {
            options.minWeight = v
        }
        // Kantfilterets radius i LiDAR-piksler: 0 = gammel test (bare høyre/ned), 1 = fire
        // naboer, 2 = fire naboer i to radier.
        if let s = UserDefaults.standard.string(forKey: "meshscan.tsdfedge"), let v = Int(s) { options.edgeRadius = v }
        let t0 = CFAbsoluteTimeGetCurrent()
        ARMeshGlbExporter.progress?("Leser dybdedata…")
        var frames = loadDense(framesDir, maxVelocity: options.maxVelocity)
        // For få dybdekart gir ingen flate uansett — da er super-res og fusjon bortkastet
        // (målt 2026-09-05: 96 s JBU + fusjon for «1/1 dense-frames» → «null verts»).
        if frames.count < 20 {
            MeshLog.log("TSDF: bare \(frames.count) dybdekart i bundelen — for lite for LiDAR-geometri, bruker ARKit-nettet")
            return nil
        }

        // TERMIKK-BUDSJETT (2026-09-05): 758 dybdebilder tok 507 s å fusjonere på en
        // strupet telefon, og hele baken 17 min. Dense-kartene ligger på 5 Hz og
        // overlapper kraftig, så vi TYNNER dem jevnt i stedet for å hoppe over
        // LiDAR-geometrien: kantene skal fortsatt være skarpe (det var hele grunnen
        // til at denne banen ble standard 2026-09-01). Keyframene beholdes alltid —
        // det er de skarpeste kildene vi har.
        let termikk = ProcessInfo.processInfo.thermalState
        let budsjett = termikk == .critical ? 200 : (termikk == .serious ? 320 : Int.max)
        if frames.count > budsjett {
            let steg = Double(frames.count) / Double(budsjett)
            let tynnet = (0..<budsjett).map { frames[min(frames.count - 1, Int(Double($0) * steg))] }
            MeshLog.log("TSDF: termikk \(termikk.rawValue) → tynner dense \(frames.count) → \(tynnet.count) dybdekart")
            frames = tynnet
        }

        // JBU-oppskaleringen er dyr og kan lage falsk geometri på teksturløse flater.
        // På en kokende telefon er den det første som ryker.
        if options.jbuScale > 1 && termikk == .critical {
            MeshLog.log("TSDF: termikk kritisk → hopper over depth super-res")
        } else if options.jbuScale > 1 {
            ARMeshGlbExporter.progress?("Skjerper dybdekanter…")
            frames += loadKeyframesJBU(framesDir, scale: options.jbuScale)
        }
        guard !frames.isEmpty else {
            MeshLog.log("TSDF: fant ingen dybdeframes i \(framesDir.lastPathComponent)")
            return nil
        }

        // ── DRIFTRETTING (2026-09-13). Se `driftrett`. Kjøres FØR romgrensene, siden posene
        // bestemmer hvor punktene havner.
        if UserDefaults.standard.string(forKey: "meshscan.driftrett") != "off" {
            ARMeshGlbExporter.progress?("Retter posedrift…")
            driftrett(&frames, framesDir: framesDir)
            if let sink = poseSink {
                var kfPoser = [Int: [Float]]()
                for f in frames {
                    guard let ki = f.kfIndex else { continue }
                    let c = f.c2w.columns
                    kfPoser[ki] = [c.0.x, c.0.y, c.0.z, c.0.w, c.1.x, c.1.y, c.1.z, c.1.w,
                                   c.2.x, c.2.y, c.2.z, c.2.w, c.3.x, c.3.y, c.3.z, c.3.w]
                }
                if !kfPoser.isEmpty { sink(kfPoser) }
            }
        }

        // ── Romgrenser fra dybden selv, ikke fra ARKit-nettet.
        // ROBUSTE GRENSER (2026-09-13). Min/maks lot noen få flyvende piksler — et vindu, en
        // dørsprekk, et blankt skap på 5 m — bestemme hele volumet: skannet 13.09 kl. 17:07
        // fikk 11,8 × 13,5 m rundt et kamera som beveget seg innenfor 2 × 3,6 m, volumet
        // sprengte taket og HELE rommet ble bakt med 24 mm voxel i stedet for 20. Nå brukes
        // 0,2/99,8-persentilen per akse, og ARKit-nettets utstrekning (+0,6 m) som tak:
        // ARKit har allerede kastet flyvende piksler, så flate utenfor det nettet finnes ikke.
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        do {
            var xs = [Float](), ys = [Float](), zs = [Float]()
            xs.reserveCapacity(frames.count * 600); ys.reserveCapacity(frames.count * 600); zs.reserveCapacity(frames.count * 600)
            for f in frames {
                guard let dep = f.load() else { continue }
                for y in stride(from: 0, to: f.h, by: 8) {
                    for x in stride(from: 0, to: f.w, by: 8) {
                        let z = dep[y * f.w + x]
                        guard z > 0.3, z < 5.0 else { continue }
                        let pc = SIMD3<Float>((Float(x) - f.cx) / f.fx * z, -(Float(y) - f.cy) / f.fy * z, -z)
                        let pw = (f.c2w * SIMD4(pc, 1)).xyz
                        xs.append(pw.x); ys.append(pw.y); zs.append(pw.z)
                    }
                }
            }
            guard xs.count > 100 else { MeshLog.log("TSDF: ingen gyldige dybdepunkter"); return nil }
            xs.sort(); ys.sort(); zs.sort()
            let raaLo = SIMD3(xs[0], ys[0], zs[0]), raaHi = SIMD3(xs[xs.count - 1], ys[ys.count - 1], zs[zs.count - 1])
            let iLo = Int(Double(xs.count) * 0.002), iHi = min(xs.count - 1, Int(Double(xs.count) * 0.998))
            lo = SIMD3(xs[iLo], ys[iLo], zs[iLo]); hi = SIMD3(xs[iHi], ys[iHi], zs[iHi])
            if let ark = tillegg, ark.positions.count >= 3 {
                var alo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), ahi = -alo
                for i in stride(from: 0, to: ark.positions.count - 2, by: 3) {
                    let p = SIMD3(ark.positions[i], ark.positions[i + 1], ark.positions[i + 2])
                    alo = simd_min(alo, p); ahi = simd_max(ahi, p)
                }
                lo = simd_max(lo, alo - 0.6); hi = simd_min(hi, ahi + 0.6)
            }
            let raa = raaHi - raaLo, ny = hi - lo
            if simd_length(raa - ny) > 0.3 {
                MeshLog.log(String(format: "TSDF: romgrenser %.1f×%.1f×%.1f m (min/maks ga %.1f×%.1f×%.1f — flyvende piksler klippet)",
                                   ny.x, ny.y, ny.z, raa.x, raa.y, raa.z))
            }
        }
        guard lo.x < hi.x, lo.y < hi.y, lo.z < hi.z else { MeshLog.log("TSDF: ingen gyldige dybdepunkter"); return nil }

        // SPARSOMT LAGER (2026-09-13, §102). Med `meshscan.sparse on` legges voxlene i
        // 8³-blokker som bare allokeres der dybden faktisk har vært — se `Blokkvolum`.
        // Taket flyttes da fra «voxler i rommet» til «voxler nær en flate», og det er den
        // forskjellen som skiller 20 mm fra 5 mm.
        let sparsomt = UserDefaults.standard.string(forKey: "meshscan.sparse") == "on"
        // Voxelstørrelsen økes til volumet får plass — et stort rom skal ikke ta ned appen.
        var vox = options.voxel
        var dim = SIMD3<Int>(0, 0, 0)
        var blokkvol: Blokkvolum? = nil
        if sparsomt {
            // Taket gjelder ALLOKERTE voxler. Blokkindeksen er tett, men billig (4 byte per
            // blokk), så den får sitt eget, romsligere tak.
            let maksPlasser = Int(MeshBakeV2.flaggTall("meshscan.sparsemax", 64)) * 1_000_000
            let lo0 = lo, hi0 = hi
            while true {
                lo = lo0 - SIMD3(repeating: vox * options.truncVoxels * 2)
                hi = hi0 + SIMD3(repeating: vox * options.truncVoxels * 2)
                dim = SIMD3(Int((hi.x - lo.x) / vox) + 1, Int((hi.y - lo.y) / vox) + 1, Int((hi.z - lo.z) / vox) + 1)
                let bTot = ((dim.x + 7) / 8) * ((dim.y + 7) / 8) * ((dim.z + 7) / 8)
                if bTot > 16_000_000 { vox *= 1.25; MeshLog.log("TSDF: blokkindeks for stor → voxel \(Int(vox * 1000))mm"); continue }
                let v = Blokkvolum(lo: lo, vox: vox, dim: dim)
                v.allokerFra(frames, trunc: vox * options.truncVoxels,
                             truncBehind: vox * min(options.truncBehindVoxels, options.truncVoxels))
                if v.plasser <= maksPlasser, v.antall > 0 { blokkvol = v; break }
                if v.antall == 0 { MeshLog.log("TSDF: sparsom allokering ga null blokker — tett vei"); break }
                MeshLog.log("TSDF: \(v.antall) blokker = \(v.plasser / 1_000_000) M voxler over taket → voxel \(Int(vox * 1250))mm")
                vox *= 1.25
            }
        }
        if blokkvol == nil {
            vox = options.voxel
            while true {
                lo -= SIMD3(repeating: vox * options.truncVoxels * 2)
                hi += SIMD3(repeating: vox * options.truncVoxels * 2)
                dim = SIMD3(Int((hi.x - lo.x) / vox) + 1, Int((hi.y - lo.y) / vox) + 1, Int((hi.z - lo.z) / vox) + 1)
                if dim.x * dim.y * dim.z <= options.maxVoxels { break }
                vox *= 1.25
                MeshLog.log("TSDF: volum for stort → voxel \(Int(vox * 1000))mm")
            }
        }
        // TETTHETSREGEL (2026-09-09): terskelen for «ekte flate» må følge hvor mange
        // dybdekart volumet faktisk har fått. Et helt rom skannet raskt får under ett kart
        // per m³, og da rekker ingen voxel 2,5 i vekt — flate spises. Måltall: stue-fixturen
        // 0,41 kart/m³ (166 kart, 402 m³) mot soveromsbundelens 2,2 (182 kart, 83 m³).
        // Under 1,0 kart/m³ senkes terskelen til 1,5, som er målt til å gi referansenivå
        // (3,71 mot 3,70 m rand/m²) på nettopp de tynne rommene. En eksplisitt meshscan.tsdfminw
        // overstyrer regelen — den skal kunne slås av i en måling.
        if UserDefaults.standard.string(forKey: "meshscan.tsdfminw") == nil {
            let volumM3 = Double((hi.x - lo.x) * (hi.y - lo.y) * (hi.z - lo.z))
            let tetthet = volumM3 > 1 ? Double(frames.count) / volumM3 : 99
            if tetthet < 1.0 {
                options.minWeight = min(options.minWeight, 1.5)
                MeshLog.log(String(format: "TSDF: tynn dybde (%.2f kart/m³) → vektterskel %.1f",
                                   tetthet, options.minWeight))
            }
        }
        let trunc = vox * options.truncVoxels
        let truncBehind = vox * min(options.truncBehindVoxels, options.truncVoxels)
        let tett = dim.x * dim.y * dim.z
        let total = blokkvol?.plasser ?? tett
        // ÉN adresseregning for begge lagringsformene. −1 = voxelen finnes ikke i lageret.
        @inline(__always) func vi(_ x: Int, _ y: Int, _ z: Int) -> Int {
            if let v = blokkvol { return v.plass(x, y, z) }
            if x < 0 || y < 0 || z < 0 || x >= dim.x || y >= dim.y || z >= dim.z { return -1 }
            return (z * dim.y + y) * dim.x + x
        }
        MeshLog.log(String(format: "TSDF: %d frames · %.1f×%.1f×%.1f m · voxel %dmm · %.1fM voxels (%dMB)",
                           frames.count, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z,
                           Int(vox * 1000), Double(total) / 1e6, total * 8 / 1024 / 1024))
        if let v = blokkvol {
            MeshLog.log(String(format: "TSDF sparsomt: %d blokker à 8³ av %d mulige (%.1f %%) — tett ville vært %.0f M voxler (%d MB)",
                               v.antall, ((dim.x + 7) / 8) * ((dim.y + 7) / 8) * ((dim.z + 7) / 8),
                               100 * Double(v.antall) / Double(max(1, ((dim.x + 7) / 8) * ((dim.y + 7) / 8) * ((dim.z + 7) / 8))),
                               Double(tett) / 1e6, tett * 8 / 1024 / 1024))
        }

        guard let store = VoxelStore(count: total, dir: framesDir) else {
            MeshLog.log("TSDF: klarte ikke å legge voxelvolumet på disk")
            return nil
        }
        let S = store.sdf, W = store.wgt
        let jbuRaw = UserDefaults.standard.string(forKey: "meshscan.jbuweight") == "raw"
        func jbuNorm(_ f: DFrame) -> Float {
            jbuRaw || f.jbuScale <= 1 ? 1 : 1 / Float(f.jbuScale * f.jbuScale)
        }

        // GPU først (Polycam-veien). Faller stille tilbake på CPU hvis Metal eller
        // minnet ikke strekker til — samme modell begge veier.
        var gpuKart: Int? = nil
        if UserDefaults.standard.string(forKey: "meshscan.gpu") != "off" {
            if let v = blokkvol {
                gpuKart = integrateSparseGPU(frames: frames, vol: v, trunc: trunc,
                                             truncBehind: truncBehind, options: options, S: S, W: W)
            } else {
                gpuKart = integrateGPU(frames: frames, lo: lo, vox: vox, dim: dim, trunc: trunc,
                                       truncBehind: truncBehind, options: options, S: S, W: W)
            }
        }
        // CPU-fusjonen skriver rett i det tette rutenettet og finnes ikke i sparsom form.
        // Faller GPU-en bort mens sparsomt lager er valgt, er det riktige å si fra og gi opp
        // heller enn å levere et halvfylt volum — kalleren tar da ARKit-nettet.
        if gpuKart == nil, blokkvol != nil {
            MeshLog.log("TSDF: sparsom fusjon krever GPU — ingen CPU-vei. Kjør uten meshscan.sparse.")
            return nil
        }
        if gpuKart == nil {
        // PARALLELL FUSJON (2026-09-05). Nøyaktig samme regnestykke som før — bare
        // rekkefølgen er endret. Målt 507 s énkjernet på et 11×11 m rom, og det er
        // grunnen til at en bake tok 17 minutter.
        //
        // To pass per dybdekart:
        //   1) Rader parallelt → kantfilter og projeksjon gjøres ÉN gang per piksel,
        //      resultatet legges i en måleliste (radene skriver til hver sine plasser).
        //   2) Voxelvolumet deles i skiver langs z, én tråd per skive. Hver tråd går
        //      gjennom målelista, men marsjerer bare den delen av strålen som treffer
        //      SIN skive — ingen to tråder rører samme voxel, så ingen låser og ingen
        //      kappløp. Uten skivedelingen ville trådene skrevet oppå hverandre i det
        //      løpende snittet (S og W), og resultatet blitt tilfeldig.
        struct Maaling { var org: SIMD3<Float>; var dir: SIMD3<Float>; var zr: Float; var wf: Float }
        let skiver = max(1, min(8, ProcessInfo.processInfo.activeProcessorCount))
        let brukt = UnsafeMutablePointer<Int>.allocate(capacity: 1); brukt.pointee = 0
        defer { brukt.deallocate() }

        for (fi, f) in frames.enumerated() {
            // Fusjonen er den lengste stille perioden i baken — uten framdrift leses
            // den som at appen henger.
            if fi % 25 == 0 {
                ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR… \(fi * 100 / max(frames.count, 1)) %")
            }
            guard let dep = f.load() else { continue }
            let org = f.c2w.columns.3.xyz
            let bredde = f.w - 2
            let rader = max(0, f.h - 2)
            if rader <= 0 || bredde <= 0 { continue }

            var maalinger = [Maaling](repeating: Maaling(org: .zero, dir: .zero, zr: 0, wf: 0), count: rader * bredde)
            var antallPerRad = [Int](repeating: 0, count: rader)

            maalinger.withUnsafeMutableBufferPointer { mbuf in
                antallPerRad.withUnsafeMutableBufferPointer { abuf in
                    DispatchQueue.concurrentPerform(iterations: rader) { ri in
                        let y = ri + 1
                        var n = 0
                        for x in 1..<(f.w - 1) {
                            let z = dep[y * f.w + x]
                            guard z > 0.3, z < 5.0 else { continue }
                            let lim = max(0.04, 0.03 * z)
                            var edge = false
                            if options.edgeRadius <= 0 {
                                let dz = max(abs(dep[y * f.w + x + 1] - z), abs(dep[(y + 1) * f.w + x] - z))
                                edge = dz > lim
                            } else {
                                let r1 = f.jbuScale, r2 = 2 * f.jbuScale
                                var nb = [(x + r1, y), (x - r1, y), (x, y + r1), (x, y - r1)]
                                if options.edgeRadius >= 2 { nb += [(x + r2, y), (x - r2, y), (x, y + r2), (x, y - r2)] }
                                for (nx, ny) in nb {
                                    guard nx >= 0, ny >= 0, nx < f.w, ny < f.h else { continue }
                                    let dn = dep[ny * f.w + nx]
                                    if dn > 0.3, abs(dn - z) > lim { edge = true; break }
                                }
                            }
                            if edge { continue }
                            let pc = SIMD3<Float>((Float(x) - f.cx) / f.fx, -(Float(y) - f.cy) / f.fy, -1)
                            let raw = (f.c2w * SIMD4(pc, 0)).xyz
                            let len = simd_length(raw)
                            let wf = max(0.25, min(1.5, 1.5 / max(z, 0.4))) * f.trust * jbuNorm(f)
                            mbuf[ri * bredde + n] = Maaling(org: org, dir: raw / len, zr: z * len, wf: wf)
                            n += 1
                        }
                        abuf[ri] = n
                    }
                }
            }

            let antall = antallPerRad.reduce(0, +)
            brukt.pointee += antall

            maalinger.withUnsafeBufferPointer { mbuf in
                DispatchQueue.concurrentPerform(iterations: skiver) { sl in
                    let gzFra = sl * dim.z / skiver
                    let gzTil = (sl + 1) * dim.z / skiver
                    if gzFra >= gzTil { return }
                    // z-vinduet skiva dekker i verdenskoordinater
                    let zLo = lo.z + Float(gzFra) * vox
                    let zHi = lo.z + Float(gzTil) * vox
                    for ri in 0..<rader {
                        let n = antallPerRad[ri]
                        if n == 0 { continue }
                        for k in 0..<n {
                            let m = mbuf[ri * bredde + k]
                            var t = m.zr - trunc
                            let tEnd = m.zr + truncBehind
                            // Hopp rett til den delen av strålen som treffer skiva.
                            if abs(m.dir.z) > 1e-6 {
                                let t1 = (zLo - m.org.z) / m.dir.z
                                let t2 = (zHi - m.org.z) / m.dir.z
                                let tInn = min(t1, t2), tUt = max(t1, t2)
                                if tUt < t || tInn > tEnd { continue }
                                if tInn > t {
                                    // Behold rutenettet på vox*0.5 så stegene er identiske med før.
                                    let hopp = floor((tInn - t) / (vox * 0.5))
                                    t += hopp * (vox * 0.5)
                                }
                            } else if m.org.z < zLo || m.org.z >= zHi {
                                continue
                            }
                            while t <= tEnd {
                                let p = m.org + m.dir * t
                                let gz = Int((p.z - lo.z) / vox)
                                if gz >= gzTil { break }
                                if gz >= gzFra {
                                    let gx = Int((p.x - lo.x) / vox), gy = Int((p.y - lo.y) / vox)
                                    if gx >= 0, gy >= 0, gz >= 0, gx < dim.x, gy < dim.y, gz < dim.z {
                                        let i = (gz * dim.y + gy) * dim.x + gx
                                        let d = max(-1, min(1, (m.zr - t) / trunc))
                                        let ow = W[i]
                                        S[i] = (S[i] * ow + d * m.wf) / (ow + m.wf)
                                        W[i] = min(ow + m.wf, 40)
                                    }
                                }
                                t += vox * 0.5
                            }
                        }
                    }
                }
            }
        }
        let used = brukt.pointee
        MeshLog.log(String(format: "TSDF: %d målinger fusjonert på %.1fs", used, CFAbsoluteTimeGetCurrent() - t0))
        } // CPU-vei

        // ── ARKIT-NETTET INN I VOLUMET (2026-09-09). Å sy sammen to FERDIGE flater virket ikke:
        // TSDF alene ga 4,98 m rand/m² på stue-fixturen, ARKit alene 5,17 — men unionen 6,64,
        // fordi de to flatene møtes uten å henge sammen og hver skjøt teller dobbelt rand.
        // Riktig sted er volumet: der fusjonen ikke har målinger i det hele tatt (vekt 0)
        // skrives ARKit-triangelet inn som avstandsfelt, og Surface Nets trekker ÉN
        // sammenhengende flate ut av begge kildene. Fortegnet tas fra retningen mot volumets
        // sentrum (rommets innside), ikke fra ARKit-normalen, som ikke er pålitelig orientert.
        // Skriver ALDRI i en voxel som alt har vekt — den ekte dybden vinner uansett.
        // PRØVD PÅ SOM STANDARD 2026-09-13 OG RULLET TILBAKE SAMME KVELD (§103).
        //
        // Argumentet var riktig i det ENE tilfellet det ble målt på: der TSDF-en hadde et
        // 44 cm bredt hull i panelveggen, hadde ARKit-nettet flate innen 5 cm i 100 % av
        // punktene. Men vakten «skriv der W ≤ 0» er ikke en vakt mot NOE — nesten hele
        // volumet har W ≤ 0. Målt på neste skann: **129 788 voxler** fikk ARKit-flate, og
        // de skapte i sin tur nye grenseløkker som hullfyllingen måtte ta (305 løkker,
        // 90 006 trekanter mot 2 699 før). Tormod: «mye triangler overalt ser aids ut».
        // Hullet den skulle fikse var ett hull; prisen var geometri over hele rommet.
        // Står som `meshscan.tsdftillegg = "volum"` for den som vil måle den igjen — men
        // da må den ha en vakt som faktisk avgrenser den til hull, ikke til tomrom.
        if let ark = tillegg, !ark.indices.isEmpty,
           UserDefaults.standard.string(forKey: "meshscan.tsdftillegg") == "volum" {
            let t1 = CFAbsoluteTimeGetCurrent()
            let senter = lo + SIMD3<Float>(Float(dim.x), Float(dim.y), Float(dim.z)) * (vox * 0.5)
            var skrevet = 0
            func punkt3(_ arr: [Float], _ i: Int) -> SIMD3<Float> {
                let j = i * 3
                return SIMD3<Float>(arr[j], arr[j + 1], arr[j + 2])
            }
            let trunk = vox * 2.5
            for t in 0..<(ark.indices.count / 3) {
                let pa = punkt3(ark.positions, Int(ark.indices[t * 3]))
                let pb = punkt3(ark.positions, Int(ark.indices[t * 3 + 1]))
                let pc = punkt3(ark.positions, Int(ark.indices[t * 3 + 2]))
                let e1 = pb - pa, e2 = pc - pa
                let kryss = simd_cross(e1, e2)
                let l = simd_length(kryss)
                guard l > 1e-9 else { continue }
                var n = kryss / l
                let midt = (pa + pb + pc) / 3
                if simd_dot(n, senter - midt) < 0 { n = -n }   // positiv side = rommets innside
                // Punktprøver over triangelet, halv voxel mellom hver.
                let steg = max(1, Int((max(simd_length(e1), simd_length(e2)) / (vox * 0.5)).rounded(.up)))
                guard steg <= 64 else { continue }
                for i in 0...steg {
                    for j in 0...(steg - i) {
                        let u = Float(i) / Float(steg), v = Float(j) / Float(steg)
                        let p = pa + e1 * u + e2 * v
                        var d = -trunk
                        while d <= trunk {
                            let q = p + n * d
                            let gx = Int(((q.x - lo.x) / vox).rounded())
                            let gy = Int(((q.y - lo.y) / vox).rounded())
                            let gz = Int(((q.z - lo.z) / vox).rounded())
                            d += vox
                            guard gx >= 0, gy >= 0, gz >= 0, gx < dim.x, gy < dim.y, gz < dim.z else { continue }
                            let k = vi(gx, gy, gz)
                            guard k >= 0, W[k] <= 0 else { continue }     // ekte dybde vinner
                            S[k] = simd_dot(q - p, n)
                            W[k] = options.minWeight * 1.5
                            skrevet += 1
                        }
                    }
                }
            }
            if skrevet > 0 {
                MeshLog.log(String(format: "TSDF: ARKit-nettet skrevet inn i %d tomme voxels på %.1fs",
                                   skrevet, CFAbsoluteTimeGetCurrent() - t1))
            }
        }

        func blurAndExtract() -> MeshBakeV2.MergedMesh? {
            ARMeshGlbExporter.progress?("Glatter volum…")
            blurVolume(S, wgt: W, count: total, dim: dim, passes: options.volumeBlur,
                       minW: options.minWeight, vol: blokkvol)
            volumeProbe?(S, W, dim, lo, vox)
            ARMeshGlbExporter.progress?("Trekker ut flater…")
            return surfaceNets(sdf: S, wgt: W, dim: dim, lo: lo, vox: vox,
                               minW: options.minWeight, smoothPasses: options.smoothPasses,
                               tillegg: tillegg, vol: blokkvol)
        }

        if options.carveRatio > 0 {
            ARMeshGlbExporter.progress?("Rydder falske flater…")
            let tc = CFAbsoluteTimeGetCurrent()
            // Frirom-stemmer telles i SAMME finmaskede grid som flatene, og bare i voxels som
            // faktisk har flatevekt. Et grovere grid ble prøvd først: da smittet luften rett
            // over gulvet over på gulvvoxlene, og gulv og vegger ble skåret bort.
            // Stemmen kalibreres til flatevektens enhet: én stråle legger ~2·wf i en voxel den
            // treffer (to halvvoxel-steg), så en frirom-stråle teller 2·wf·stride², og
            // `carveRatio` blir da direkte «hvor mange ganger flere stråler ser GJENNOM enn
            // ser flaten».
            // Stemmene ligger i en mmap-et fil som volumet (146 MB på heap ville vært en
            // drapsrisiko på telefon — se VoxelStore).
            guard let freeStore = VoxelStore(count: total, dir: framesDir, names: ["tsdf-free.bin"]) else {
                MeshLog.log("TSDF: frirom-utskjæring hoppet over — fikk ikke plass til stemmefila")
                return blurAndExtract()
            }
            let freeBuf = freeStore.planes[0]
            for f in frames {
                guard let dep = f.load() else { continue }
                let org = f.c2w.columns.3.xyz
                let stepPx = max(1, 2 * f.jbuScale)
                var y = 1
                while y < f.h - 1 {
                    var x = 1
                    while x < f.w - 1 {
                        let z = dep[y * f.w + x]
                        let px = x
                        x += stepPx
                        guard z > 0.3, z < 5.0 else { continue }
                        let pc = SIMD3<Float>((Float(px) - f.cx) / f.fx, -(Float(y) - f.cy) / f.fy, -1)
                        let raw = (f.c2w * SIMD4(pc, 0)).xyz
                        let len = simd_length(raw)
                        let dir = raw / len
                        let wf = max(0.25, min(1.5, 1.5 / max(z, 0.4))) * f.trust * jbuNorm(f)
                        let vote = 2 * wf * Float(stepPx * stepPx)
                        // Stopp godt før trunkeringssonen, så flaten selv aldri stemmes bort.
                        let tEnd = z * len - trunc * 1.5
                        var t: Float = 0.25
                        while t < tEnd {
                            let p = org + dir * t
                            let gx = Int((p.x - lo.x) / vox), gy = Int((p.y - lo.y) / vox), gz = Int((p.z - lo.z) / vox)
                            if gx >= 0, gy >= 0, gz >= 0, gx < dim.x, gy < dim.y, gz < dim.z {
                                let i = vi(gx, gy, gz)
                                if i >= 0, W[i] > 0 { freeBuf[i] += vote }
                            }
                            t += vox
                        }
                    }
                    y += stepPx
                }
            }
            var carved = 0
            for i in 0..<total where W[i] > 0 && freeBuf[i] > options.carveRatio * W[i] {
                W[i] = 0; S[i] = 0; carved += 1
            }
            MeshLog.log(String(format: "TSDF: frirom-utskjæring fjernet %d voxels (ratio %.1f) på %.1fs", carved, options.carveRatio, CFAbsoluteTimeGetCurrent() - tc))
        }

        return blurAndExtract()
    }

    // MARK: - Sparsomt blokkvolum (2026-09-13, §102)

    /// Voxellageret som gjør 5 mm mulig.
    ///
    /// Et TETT rutenett over rommet fra 13.09 (7,9 × 2,6 × 5,7 m) er 16,7 M voxler ved 20 mm
    /// og **1065 M ved 5 mm** — 8,1 GB. Det er ikke et minnetak man kan heve, det er feil
    /// datastruktur: alt utenom et par centimeter rundt flaten er tomrom vi aldri leser.
    /// Måler man modellens egen flate (48,4 m²) og allokerer bare 8³-blokker som
    /// trunkeringsbåndet faktisk treffer, blir samme rom **62 013 blokker = 31,8 M voxler,
    /// 242 MB** — 34× mindre, og godt innenfor det telefonen hadde ledig (2266 MB).
    ///
    /// Blokkindeksen er selv tett, men billig: én Int32 per blokk, 8 MB ved 5 mm. Et oppslag
    /// er to lesninger og litt skifting, ikke en hash.
    ///
    /// Blokken er 8³. Det er ikke tilfeldig: blokkbredden (8·voxel) må være minst så stor som
    /// avstanden mellom to nabostråler på lengste hold, ellers faller voxler MELLOM strålene
    /// utenfor allokeringen selv om fusjonen ville tatt dem. Ved 5 mm er blokken 40 mm; to
    /// nabopiksler i et 256-bredt dybdekart står 27 mm fra hverandre på 5 m (9 mm etter
    /// JBU ×3). Med god margin, altså — og derfor trengs ingen utvidelse av masken.
    private final class Blokkvolum {
        static let B = 8
        static let perBlokk = 512                 // B³
        let lo: SIMD3<Float>
        let vox: Float
        let dim: SIMD3<Int>
        let bdim: SIMD3<Int>
        private let indeks: UnsafeMutablePointer<Int32>
        private let bTotal: Int
        private(set) var koord: [SIMD3<Int32>] = []
        var antall: Int { koord.count }
        var plasser: Int { koord.count * Blokkvolum.perBlokk }

        init(lo: SIMD3<Float>, vox: Float, dim: SIMD3<Int>) {
            self.lo = lo; self.vox = vox; self.dim = dim
            let b = Blokkvolum.B
            bdim = SIMD3((dim.x + b - 1) / b, (dim.y + b - 1) / b, (dim.z + b - 1) / b)
            bTotal = bdim.x * bdim.y * bdim.z
            indeks = UnsafeMutablePointer<Int32>.allocate(capacity: bTotal)
            indeks.initialize(repeating: -1, count: bTotal)
        }
        deinit { indeks.deallocate() }

        /// Plassen en global voxel har i lageret, eller −1 om blokken ikke er allokert.
        @inline(__always) func plass(_ x: Int, _ y: Int, _ z: Int) -> Int {
            if x < 0 || y < 0 || z < 0 || x >= dim.x || y >= dim.y || z >= dim.z { return -1 }
            let b = indeks[((z >> 3) * bdim.y + (y >> 3)) * bdim.x + (x >> 3)]
            if b < 0 { return -1 }
            return (Int(b) << 9) | ((z & 7) << 6) | ((y & 7) << 3) | (x & 7)
        }

        /// Markerer blokkene dybdestrømmen treffer, og nummererer dem.
        /// Allokeringen er med vilje en OVERMENGDE av det fusjonen vil fylle: den hopper over
        /// kantfilteret, for en blokk som aldri blir allokert kan heller aldri fylles, mens en
        /// blokk som blir allokert uten å bli fylt bare koster minne.
        func allokerFra(_ frames: [DFrame], trunc: Float, truncBehind: Float) {
            let merke = UnsafeMutablePointer<UInt8>.allocate(capacity: bTotal)
            merke.initialize(repeating: 0, count: bTotal)
            defer { merke.deallocate() }
            let bvox = Float(Blokkvolum.B) * vox
            let steg = vox * 2                     // ≤ blokkbredden, så ingen blokk hoppes over
            let n = max(1, Int((trunc + truncBehind) / steg) + 1)
            // Trådene skriver bare 1-ere i hver sin celle-eller-ikke; kappløp er ufarlige.
            let kjerner = max(1, min(8, ProcessInfo.processInfo.activeProcessorCount))
            DispatchQueue.concurrentPerform(iterations: kjerner) { kj in
                for fi in stride(from: kj, to: frames.count, by: kjerner) {
                    let f = frames[fi]
                    guard let dep = f.load() else { continue }
                    let org = f.c2w.columns.3.xyz
                    for y in 1..<max(2, f.h - 1) {
                        for x in 1..<max(2, f.w - 1) {
                            let z = dep[y * f.w + x]
                            guard z > 0.3, z < 5.0 else { continue }
                            let pc = SIMD3<Float>((Float(x) - f.cx) / f.fx, -(Float(y) - f.cy) / f.fy, -1)
                            let raw = (f.c2w * SIMD4(pc, 0)).xyz
                            let len = simd_length(raw)
                            guard len > 1e-6 else { continue }
                            let dir = raw / len
                            let flate = org + dir * (z * len)
                            for k in 0...n {
                                let d = -truncBehind + Float(k) * steg
                                if d > trunc { break }
                                let q = flate + dir * d
                                let bx = Int((q.x - self.lo.x) / bvox)
                                let by = Int((q.y - self.lo.y) / bvox)
                                let bz = Int((q.z - self.lo.z) / bvox)
                                guard bx >= 0, by >= 0, bz >= 0,
                                      bx < self.bdim.x, by < self.bdim.y, bz < self.bdim.z else { continue }
                                merke[(bz * self.bdim.y + by) * self.bdim.x + bx] = 1
                            }
                        }
                    }
                }
            }
            koord.removeAll(keepingCapacity: true)
            for bz in 0..<bdim.z {
                for by in 0..<bdim.y {
                    for bx in 0..<bdim.x {
                        let i = (bz * bdim.y + by) * bdim.x + bx
                        guard merke[i] == 1 else { continue }
                        indeks[i] = Int32(koord.count)
                        koord.append(SIMD3<Int32>(Int32(bx), Int32(by), Int32(bz)))
                    }
                }
            }
        }
    }

    /// Sparsom GPU-fusjon. Samme måling som den tette — bokstavelig talt: begge kjernene
    /// kaller `ampex_fuse`. Forskjellen er hvilke voxler som får en tråd.
    private static func integrateSparseGPU(frames: [DFrame], vol: Blokkvolum,
                                           trunc: Float, truncBehind: Float, options: Options,
                                           S: UnsafeMutablePointer<Float>, W: UnsafeMutablePointer<Float>) -> Int? {
        let plasser = vol.plasser
        guard plasser > 0 else { return nil }
        let trenger = UInt64(plasser) * 8
        if MeshSimMem.available() < trenger {
            MeshLog.log("Sparsom fusjon: for lite ledig minne (\(Int(MeshSimMem.available() >> 20)) MB) — tett vei")
            return nil
        }
        var blokker = vol.koord.map { SIMD4<Int32>($0.x, $0.y, $0.z, 0) }
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let lib = try? device.makeLibrary(source: integrateMSL, options: nil),
              let fn = lib.makeFunction(name: "ampex_integrate_sparse"),
              let pipe = try? device.makeComputePipelineState(function: fn),
              let wdBuf = device.makeBuffer(length: plasser * 4, options: .storageModeShared),
              let wBuf = device.makeBuffer(length: plasser * 4, options: .storageModeShared),
              let bBuf = device.makeBuffer(bytes: &blokker, length: blokker.count * 16, options: .storageModeShared) else {
            MeshLog.log("Sparsom fusjon: Metal utilgjengelig — tett vei")
            return nil
        }
        memset(wdBuf.contents(), 0, plasser * 4)
        memset(wBuf.contents(), 0, plasser * 4)
        let jbuRaw = UserDefaults.standard.string(forKey: "meshscan.jbuweight") == "raw"
        let bredde = min(pipe.maxTotalThreadsPerThreadgroup, 256)
        let tg = MTLSize(width: bredde, height: 1, depth: 1)
        let grid = MTLSize(width: plasser, height: 1, depth: 1)
        var kart = 0
        let t0 = CFAbsoluteTimeGetCurrent()
        var cb = queue.makeCommandBuffer()
        var iBatch = 0
        for (fi, f) in frames.enumerated() {
            if fi % 25 == 0 { ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR… \(fi * 100 / max(frames.count, 1)) %") }
            guard let dep = f.load(),
                  let dBuf = device.makeBuffer(bytes: dep, length: dep.count * 4, options: .storageModeShared) else { continue }
            let norm: Float = (jbuRaw || f.jbuScale <= 1) ? 1 : 1 / Float(f.jbuScale * f.jbuScale)
            var P = GPUParams(w2c: f.c2w.inverse, lo: vol.lo, voxel: vol.vox,
                              dims: SIMD3<Int32>(Int32(vol.dim.x), Int32(vol.dim.y), Int32(vol.dim.z)), trunc: trunc,
                              truncBehind: truncBehind, fx: f.fx, fy: f.fy, cx: f.cx,
                              cy: f.cy, dw: Int32(f.w), dh: Int32(f.h), wf0: f.trust * norm,
                              edgeRadius: Int32(options.edgeRadius), jbuScale: Int32(f.jbuScale), p0: 0, p1: 0)
            guard let c = cb, let enc = c.makeComputeCommandEncoder() else { continue }
            enc.setComputePipelineState(pipe)
            enc.setBuffer(wdBuf, offset: 0, index: 0)
            enc.setBuffer(wBuf, offset: 0, index: 1)
            enc.setBuffer(dBuf, offset: 0, index: 2)
            enc.setBytes(&P, length: MemoryLayout<GPUParams>.stride, index: 3)
            enc.setBuffer(bBuf, offset: 0, index: 4)
            enc.dispatchThreads(grid, threadsPerThreadgroup: tg)
            enc.endEncoding()
            kart += 1; iBatch += 1
            if iBatch >= 8 { c.commit(); c.waitUntilCompleted(); cb = queue.makeCommandBuffer(); iBatch = 0 }
        }
        if let c = cb, iBatch > 0 { c.commit(); c.waitUntilCompleted() }
        let wd = wdBuf.contents().bindMemory(to: Float.self, capacity: plasser)
        let ww = wBuf.contents().bindMemory(to: Float.self, capacity: plasser)
        DispatchQueue.concurrentPerform(iterations: 8) { sl in
            let a = sl * plasser / 8, b = (sl + 1) * plasser / 8
            for i in a..<b {
                let w = ww[i]
                S[i] = w > 0 ? wd[i] / w : 0
                W[i] = min(w, 40)
            }
        }
        MeshLog.log(String(format: "Sparsom GPU-fusjon: %d dybdekart på %.1fs", kart, CFAbsoluteTimeGetCurrent() - t0))
        return kart
    }

    // MARK: - Volum-blur

    /// Separabel 3-taps blur på SELVE VOLUMET. Teller kun observerte voxels; trekker man
    /// tomrommet med, dras flatene mot null og det oppstår falske overflater i lufta.
    /// Blur på det mmap-ede volumet. Kopien per akse skjer i en TEMPORÆR buffer på samme
    /// størrelse — den er kortlevd, men for et stort volum er den likevel betydelig, så den
    /// tas én akse om gangen framfor å holde tre samtidig.
    private static func blurVolume(_ sdf: UnsafeMutablePointer<Float>, wgt: UnsafeMutablePointer<Float>,
                                   count n: Int, dim: SIMD3<Int>, passes: Int, minW: Float,
                                   vol: Blokkvolum? = nil) {
        guard passes > 0 else { return }
        // Sparsomt lager (§102): den lineære indeksen sier ingenting om koordinaten, så
        // naboen må slås opp på (x,y,z). Samme tre akser, samme 0,25/0,5/0,25, samme vakt mot
        // å blande inn tomrom — bare adresseringen er en annen.
        if let vol {
            let tmp = UnsafeMutablePointer<Float>.allocate(capacity: n)
            defer { tmp.deallocate() }
            let B = Blokkvolum.B
            for _ in 0..<passes {
                for axis in 0..<3 {
                    tmp.update(from: sdf, count: n)
                    let dx = axis == 0 ? 1 : 0, dy = axis == 1 ? 1 : 0, dz = axis == 2 ? 1 : 0
                    DispatchQueue.concurrentPerform(iterations: max(1, vol.antall)) { bi in
                        let bk = vol.koord[bi]
                        let ox = Int(bk.x) * B, oy = Int(bk.y) * B, oz = Int(bk.z) * B
                        for lz in 0..<B { for ly in 0..<B { for lx in 0..<B {
                            let x = ox + lx, y = oy + ly, z = oz + lz
                            let i = vol.plass(x, y, z)
                            guard i >= 0, wgt[i] > minW else { continue }
                            var acc = tmp[i] * 0.5, wsum: Float = 0.5
                            let a = vol.plass(x - dx, y - dy, z - dz)
                            if a >= 0, wgt[a] > minW { acc += tmp[a] * 0.25; wsum += 0.25 }
                            let b = vol.plass(x + dx, y + dy, z + dz)
                            if b >= 0, wgt[b] > minW { acc += tmp[b] * 0.25; wsum += 0.25 }
                            sdf[i] = acc / wsum
                        } } }
                    }
                }
            }
            return
        }
        let tmp = UnsafeMutablePointer<Float>.allocate(capacity: n)
        defer { tmp.deallocate() }
        for _ in 0..<passes {
            for axis in 0..<3 {
                let step = axis == 0 ? 1 : (axis == 1 ? dim.x : dim.x * dim.y)
                let axisSize = dim[axis]
                tmp.update(from: sdf, count: n)
                DispatchQueue.concurrentPerform(iterations: 8) { slice in
                    let lo = n * slice / 8, hi = n * (slice + 1) / 8
                    for i in lo..<hi {
                        guard wgt[i] > minW else { continue }
                        var acc = tmp[i] * 0.5, wsum: Float = 0.5
                        // Linear-buffer neighbors can wrap into another row/slice.
                        // Only mix cells adjacent along this actual 3D axis.
                        let coordinate = (i / step) % axisSize
                        if coordinate > 0, wgt[i - step] > minW { acc += tmp[i - step] * 0.25; wsum += 0.25 }
                        if coordinate + 1 < axisSize, wgt[i + step] > minW { acc += tmp[i + step] * 0.25; wsum += 0.25 }
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
                                    smoothPasses: Int,
                                    tillegg: MeshBakeV2.MergedMesh? = nil,
                                    vol: Blokkvolum? = nil) -> MeshBakeV2.MergedMesh? {
        let t0 = CFAbsoluteTimeGetCurrent()
        // ÉN adresseregning for begge lagringsformene (§102). −1 = finnes ikke.
        @inline(__always) func vi(_ x: Int, _ y: Int, _ z: Int) -> Int {
            if let vol { return vol.plass(x, y, z) }
            if x < 0 || y < 0 || z < 0 || x >= dim.x || y >= dim.y || z >= dim.z { return -1 }
            return (z * dim.y + y) * dim.x + x
        }
        var cell = [Int32](repeating: -1, count: vol?.plasser ?? (dim.x * dim.y * dim.z))
        var verts: [SIMD3<Float>] = []
        let corner: [SIMD3<Int>] = [SIMD3(0,0,0), SIMD3(1,0,0), SIMD3(0,1,0), SIMD3(1,1,0),
                                    SIMD3(0,0,1), SIMD3(1,0,1), SIMD3(0,1,1), SIMD3(1,1,1)]
        let edges: [(Int, Int)] = [(0,1),(2,3),(4,5),(6,7),(0,2),(1,3),(4,6),(5,7),(0,4),(1,5),(2,6),(3,7)]

        var v = [Float](repeating: 0, count: 8)
        func celle(_ x: Int, _ y: Int, _ z: Int) {
            var ok = true
            for (k, c) in corner.enumerated() {
                let i = vi(x + c.x, y + c.y, z + c.z)
                if i < 0 || wgt[i] <= minW { ok = false; break }
                v[k] = sdf[i]
            }
            guard ok else { return }
            var acc = SIMD3<Float>.zero
            var n = 0
            for (a, b) in edges where (v[a] > 0) != (v[b] > 0) {
                let t = v[a] / (v[a] - v[b])
                let pa = SIMD3<Float>(corner[a]), pb = SIMD3<Float>(corner[b])
                acc += pa + (pb - pa) * t
                n += 1
            }
            guard n > 0 else { return }
            let i0 = vi(x, y, z)
            guard i0 >= 0 else { return }
            cell[i0] = Int32(verts.count)
            // SDF entries describe voxel centers (integrateMSL: gid + 0.5),
            // not grid corners. Omitting this offset displaced every extracted
            // surface by -vox/2 on all axes: 10 mm/axis at the default 20 mm.
            verts.append(lo + (SIMD3<Float>(Float(x), Float(y), Float(z)) + SIMD3<Float>(repeating: 0.5) + acc / Float(n)) * vox)
        }
        if let vol {
            let B = Blokkvolum.B
            for bk in vol.koord {
                let ox = Int(bk.x) * B, oy = Int(bk.y) * B, oz = Int(bk.z) * B
                for lz in 0..<B { for ly in 0..<B { for lx in 0..<B {
                    celle(ox + lx, oy + ly, oz + lz)
                } } }
            }
        } else {
            for z in 0..<(dim.z - 1) {
                for y in 0..<(dim.y - 1) {
                    for x in 0..<(dim.x - 1) { celle(x, y, z) }
                }
            }
        }
        guard !verts.isEmpty else { MeshLog.log("TSDF: surface nets ga null verts"); return nil }

        var idx: [UInt32] = []
        func cellAt(_ x: Int, _ y: Int, _ z: Int) -> Int32? {
            let i = vi(x, y, z)
            guard i >= 0 else { return nil }
            let c = cell[i]
            return c >= 0 ? c : nil
        }
        func quad(_ a: Int32, _ b: Int32, _ c: Int32, _ d: Int32, flip: Bool) {
            if flip { idx += [UInt32(a), UInt32(c), UInt32(b), UInt32(a), UInt32(d), UInt32(c)] }
            else    { idx += [UInt32(a), UInt32(b), UInt32(c), UInt32(a), UInt32(c), UInt32(d)] }
        }
        func flater(_ x: Int, _ y: Int, _ z: Int) {
            let i0 = vi(x, y, z)
            guard i0 >= 0, wgt[i0] > minW else { return }
            let s0 = sdf[i0]
            let ix = vi(x + 1, y, z), iy = vi(x, y + 1, z), iz = vi(x, y, z + 1)
            if ix >= 0, wgt[ix] > minW, (s0 > 0) != (sdf[ix] > 0),
               let a = cellAt(x, y, z), let b = cellAt(x, y - 1, z),
               let c = cellAt(x, y - 1, z - 1), let d = cellAt(x, y, z - 1) {
                quad(a, b, c, d, flip: s0 > 0)
            }
            if iy >= 0, wgt[iy] > minW, (s0 > 0) != (sdf[iy] > 0),
               let a = cellAt(x, y, z), let b = cellAt(x, y, z - 1),
               let c = cellAt(x - 1, y, z - 1), let d = cellAt(x - 1, y, z) {
                quad(a, b, c, d, flip: s0 > 0)
            }
            if iz >= 0, wgt[iz] > minW, (s0 > 0) != (sdf[iz] > 0),
               let a = cellAt(x, y, z), let b = cellAt(x - 1, y, z),
               let c = cellAt(x - 1, y - 1, z), let d = cellAt(x, y - 1, z) {
                quad(a, b, c, d, flip: s0 > 0)
            }
        }
        if let vol {
            let B = Blokkvolum.B
            for bk in vol.koord {
                let ox = Int(bk.x) * B, oy = Int(bk.y) * B, oz = Int(bk.z) * B
                for lz in 0..<B { for ly in 0..<B { for lx in 0..<B {
                    flater(ox + lx, oy + ly, oz + lz)
                } } }
            }
        } else {
            for z in 1..<(dim.z - 1) {
                for y in 1..<(dim.y - 1) {
                    for x in 1..<(dim.x - 1) { flater(x, y, z) }
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

        // ── TILLEGG FRA ARKIT-NETTET der TSDF-en ikke har flate (2026-09-09).
        // Avstandsvakten er en 8 cm romhash over TSDF-verteksene: et ARKit-triangel slippes
        // inn bare når INGEN av hjørnene har en TSDF-verteks innen 8 cm. Da kan de to ikke
        // ligge som doble skall over hverandre — og det er dobbeltskallene, ikke hullene,
        // som har vært den dyre feilen på denne banen (se «dobbeltflate» i ARMeshGlbExporter).
        // Slås av med meshscan.tsdftillegg = "off".
        if let ark = tillegg, !ark.indices.isEmpty,
           UserDefaults.standard.string(forKey: "meshscan.tsdftillegg") == "on" {
            // Volumvakt: ARKit fusjonerer også gjennom dører og vinduer, og utenfor TSDF-volumet
            // er det ikke rommet vi skanner. Bare triangler helt innenfor dybdevolumet slipper inn.
            let hi = lo + SIMD3<Float>(Float(dim.x), Float(dim.y), Float(dim.z)) * vox
            func iVolum(_ p: SIMD3<Float>) -> Bool {
                p.x >= lo.x && p.y >= lo.y && p.z >= lo.z && p.x <= hi.x && p.y <= hi.y && p.z <= hi.z
            }
            let celle: Float = 0.08
            var hash = [Int64: [Int32]](minimumCapacity: pos.count / 3)
            func nøkkel(_ x: Float, _ y: Float, _ z: Float) -> Int64 {
                (Int64((x / celle).rounded(.down)) & 0x1FFFFF)
                    | ((Int64((y / celle).rounded(.down)) & 0x1FFFFF) << 21)
                    | ((Int64((z / celle).rounded(.down)) & 0x1FFFFF) << 42)
            }
            for v in 0..<(pos.count / 3) {
                let q = punkt(pos, v)
                hash[nøkkel(q.x, q.y, q.z), default: []].append(Int32(v))
            }
            func punkt(_ arr: [Float], _ i: Int) -> SIMD3<Float> {
                let j = i * 3
                return SIMD3<Float>(arr[j], arr[j + 1], arr[j + 2])
            }
            func harNaboFlate(_ p: SIMD3<Float>) -> Bool {
                for dx in -1...1 { for dy in -1...1 { for dz in -1...1 {
                    let k = nøkkel(p.x + Float(dx) * celle, p.y + Float(dy) * celle, p.z + Float(dz) * celle)
                    guard let liste = hash[k] else { continue }
                    for v in liste {
                        let q = punkt(pos, Int(v))
                        if simd_distance_squared(p, q) < celle * celle { return true }
                    }
                } } }
                return false
            }
            var nyPos = pos
            var nyIdx = idx
            var kart = [Int32: UInt32]()   // ARKit-verteks → ny indeks
            var lagtTil = 0
            var areal: Float = 0
            for t in 0..<(ark.indices.count / 3) {
                let a = Int(ark.indices[t * 3]), b = Int(ark.indices[t * 3 + 1]), c = Int(ark.indices[t * 3 + 2])
                let pa = punkt(ark.positions, a)
                let pb = punkt(ark.positions, b)
                let pc = punkt(ark.positions, c)
                let kryss = simd_cross(pb - pa, pc - pa)
                let l = simd_length(kryss)
                guard l > 1e-9 else { continue }
                guard iVolum(pa), iVolum(pb), iVolum(pc) else { continue }
                if harNaboFlate(pa) || harNaboFlate(pb) || harNaboFlate(pc) { continue }
                for (vi, p) in [(a, pa), (b, pb), (c, pc)] {
                    if kart[Int32(vi)] == nil {
                        kart[Int32(vi)] = UInt32(nyPos.count / 3)
                        nyPos.append(p.x); nyPos.append(p.y); nyPos.append(p.z)
                    }
                }
                nyIdx.append(kart[Int32(a)]!); nyIdx.append(kart[Int32(b)]!); nyIdx.append(kart[Int32(c)]!)
                lagtTil += 1
                areal += l * 0.5
            }
            if lagtTil > 0 {
                pos = nyPos
                idx = nyIdx
                MeshLog.log(String(format: "TSDF: +%d ARKit-triangler (%.1f m²) der fusjonen manglet flate",
                                   lagtTil, areal))
            }
        }

        // ── DOMINANTPLAN. Uten disse er `MergedMesh.planes` tom, og da hopper baken over
        // hele plan-tildelingen (`break planeAssign`). Konsekvensen er at hver flate velger
        // vinnerfoto helt fritt: to bilder som er omtrent like gode på samme vegg gir
        // naboflater hvert sitt valg, og du får en fargegrense midt på en vegg som burde
        // vært én sammenhengende flate. Plan-lås binder hele veggen til ETT foto når det
        // dekker den godt nok — det er kuren mot akkurat det.
        // Kallet retter samtidig verteksene inn mot planene, så vegger blir virkelig flate.
        // Diagnostic ablation: retain plane metadata for the same texture policy,
        // but inspect the fused surface before geometric flattening (§28 follow-up).
        let unsnapped = UserDefaults.standard.string(forKey: "meshscan.tsdfsnap") == "off" ? pos : nil
        var planes = ARMeshGlbExporter.snapDominantPlanes(positions: &pos, indices: idx)
        if let original = unsnapped { pos = original }

        // ── HULLFYLLING (2026-09-09). Surface Nets legger bare flate der voxlene er observert,
        // så et TSDF-nett kommer ut med slisser der dybden falt ut: langs panelspor, i glansen
        // fra vinduet, under møbler. Anchor-veien har kjørt planær hullfylling siden scan #9,
        // men TSDF-veien — som er standard siden 2026-09-01 — har ALDRI gjort det. Målt på
        // soverommet: 203,8 m åpen grense på 36 m² flate, mot 235,3 m på 63,6 m² i Scaniverse-
        // eksporten, og 150,8 m av vår grense var ÉN sammenhengende sprekk. Det er de svarte
        // rissene over veggen i renderne, ikke tekstur. Fylles FØR normaler/UV-blokker, slik
        // at lappene får normal, chart og projisert foto som resten av veggen.
        // Av med meshscan.tsdfholefill = "off" (A/B mot samme bundle).
        if UserDefaults.standard.string(forKey: "meshscan.tsdfholefill") != "off" {
            let førTris = idx.count / 3
            var noColors = [Float]()
            var noAnchors = [UInt32]()
            ARMeshGlbExporter.fillPlanarHoles(positions: &pos, colors: &noColors, indices: &idx,
                                              triAnchor: &noAnchors)
            // Re-snap etter lapping: lappene skal ligge PÅ planet, ikke i sentroidens
            // gjennomsnittshøyde — og planene som sendes videre skal beskrive sluttflaten.
            if idx.count / 3 != førTris {
                planes = ARMeshGlbExporter.snapDominantPlanes(positions: &pos, indices: idx)
            }
        }

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
                           pos.count / 3, idx.count / 3, blockIds.count, CFAbsoluteTimeGetCurrent() - t0))
        // PLAN-LÅSEN ER AV for TSDF-nett (brukerdom 2026-09-01). Planene brukes til å RETTE
        // geometrien over — det er ren gevinst, vegger blir virkelig flate — men de sendes
        // IKKE videre til baken, for der gjorde de vondt verre:
        //   · 19 delinger mot 1,3 % låste flater, og hver deling er en synlig linje på veggen
        //   · uten deling faller taket til per-region-valg og får store toneflater
        // Årsaken er at TSDF-planene er finere oppdelt enn ARKits og sjelden dekkes 90 % av
        // ett enkelt foto. `meshscan.planelock=on` sender dem likevel, for A/B.
        // 2026-09-07: planene sendes nå ALLTID (plan-snittet i baken trenger «ligger på plan»),
        // men planeLock styrer om baken også får låse dem til ett foto.
        let sendPlanes = UserDefaults.standard.string(forKey: "meshscan.planelock") == "on"
        MeshLog.log("TSDF: \(planes.count) plan snappet i geometrien, plan-lås \(sendPlanes ? "PÅ" : "av") (plan-snitt på)")
        return MeshBakeV2.MergedMesh(positions: pos, normals: nrm, indices: idx,
                                     triAnchor: anchors, planes: planes, faceClass: [], planeLock: sendPlanes)
    }

    // MARK: - Innlesing

    /// MYK vekting framfor hard kasting (2026-09-01). Et binært filter kastet 40 % av kartene
    /// i et urolig skann, og flatene mistet observasjoner de kunne hatt nytte av — det er
    /// nettopp da dobbeltflater oppstår, fordi de gjenværende er for få til å bli enige.
    /// Nå faller tilliten gradvis fra full ved rolig bevegelse til et gulv på 0.15, og bare
    /// det virkelig ustøe (over det dobbelte av grensen) kastes helt.
    // MARK: - Driftretting (2026-09-13)

    /// Ett plan funnet i ETT dybdekart, i kameraets eget koordinatsystem.
    private struct KartPlan {
        var n: SIMD3<Float>          // enhetsnormal, orientert MOT kameraet
        var d: Float                 // n·p + d = 0
        var antall: Int              // innliggere i hele kartet (vekt)
        var pts: [SIMD3<Float>]      // utvalg av innliggere (kamerarom), til løsningen
    }

    /// Et globalt plan: snittet av alle kart-planene som ble klynget sammen.
    private struct GlobaltPlan {
        var n: SIMD3<Float>
        var d: Float
        var vekt: Float
        var kart: Int
    }

    /// POSEDRIFT — ARKit-posene glir mens man går. Målt 13.09 på et 100-sekunders skann:
    /// gulvet lå 957 mm under origo de første ti sekundene og 1071 mm etter åtti — taket
    /// flyttet seg like mye samme vei, så det er KAMERAET som driver (1,4 mm/s loddrett),
    /// ikke rommet. Veggavstandene holdt seg innen 1 cm. Tidligere ble dette avvist med at
    /// «re-ankring flytter posene 0,0 mm», men re-ankringen måler mot ARMeshAnchor-
    /// transformen, og ARKit legger driftskorreksjonen i ankerets VERTEKSER, ikke i
    /// transformen — så den kunne aldri finne noe.
    ///
    /// Følgen: 404 rå dybdekart + 133 nøkkelbilder fusjoneres med poser som spriker opptil
    /// 11 cm, gulv og tak blir to skall / ett tykt, og fotoene fra første og siste runde
    /// projiseres 10 cm forbi hverandre på veggen. Det er «hakket» der man møter igjen
    /// noe man alt har skannet.
    ///
    /// GREPET: rommet er plant (§96: 83 % av veggen innen 0,5 mm). Hvert kart får sine
    /// dominante plan (RANSAC), planene klynges til globale plan over hele skannet, og hvert
    /// kart løses rigid mot de globale planene (punkt-til-plan, dempet 6-DoF, så retninger
    /// planene ikke ser står urørt). Kart uten plan interpoleres langs tida fra naboene.
    /// To runder: planene blir strammere når kartene er rettet. Kostnad ~0,5 s for 537 kart.
    /// meshscan.driftrett = "off" gir de rå posene tilbake (A/B).
    private static func driftrett(_ frames: inout [DFrame], framesDir: URL) {
        let t0 = CFAbsoluteTimeGetCurrent()
        let n = frames.count
        guard n >= 5 else { return }

        // ── 1. Plan per kart (parallelt).
        let slots = UnsafeMutablePointer<[KartPlan]>.allocate(capacity: n)
        slots.initialize(repeating: [], count: n)
        defer { slots.deinitialize(count: n); slots.deallocate() }
        DispatchQueue.concurrentPerform(iterations: n) { i in
            slots[i] = kartPlan(frames[i], seed: UInt64(i + 1))
        }
        let planer = (0..<n).map { slots[$0] }
        let medPlan = planer.filter { !$0.isEmpty }.count
        guard medPlan >= 5 else {
            MeshLog.log("driftretting — bare \(medPlan) kart med plan, hopper over")
            return
        }
        let raa = frames.map { $0.c2w }
        let rotFri = UserDefaults.standard.string(forKey: "meshscan.driftrot") == "on"
        let cos6 = cos(6 * Float.pi / 180)

        func verdensPlan(_ p: KartPlan, _ c2w: simd_float4x4) -> (n: SIMD3<Float>, d: Float) {
            let R = simd_float3x3(columns: (c2w.columns.0.xyz, c2w.columns.1.xyz, c2w.columns.2.xyz))
            let nw = simd_normalize(R * p.n)
            return (nw, p.d - simd_dot(nw, c2w.columns.3.xyz))
        }
        func flytt(_ c: simd_float4x4, _ omega: SIMD3<Float>, _ t: SIMD3<Float>) -> simd_float4x4 {
            let R = rotasjon(omega)
            let Rc = simd_float3x3(columns: (c.columns.0.xyz, c.columns.1.xyz, c.columns.2.xyz))
            let Rn = R * Rc
            let pos = R * c.columns.3.xyz + t
            return simd_float4x4(columns: (SIMD4(Rn.columns.0, 0), SIMD4(Rn.columns.1, 0), SIMD4(Rn.columns.2, 0), SIMD4(pos, 1)))
        }
        /// Legg et karts plan inn i modellen: slå sammen med et plan som ligger innen 6° og
        /// `terskel` meter, ellers nytt plan. Stram terskel = et skap 10 cm foran veggen blir
        /// sitt eget plan, ikke et «snitt» som trekker begge feil.
        func leggTil(_ modell: inout [GlobaltPlan], _ kp: [KartPlan], _ c2w: simd_float4x4, terskel: Float) {
            for p in kp {
                let (nw, dw) = verdensPlan(p, c2w)
                let w = Float(p.antall)
                var best = -1; var bestD = terskel
                for (k, c) in modell.enumerated() where simd_dot(c.n, nw) > cos6 {
                    let dd = abs(c.d - dw)
                    if dd < bestD { bestD = dd; best = k }
                }
                if best >= 0 {
                    var c = modell[best]
                    c.n = simd_normalize((c.n * c.vekt + nw * w) / (c.vekt + w))
                    c.d = (c.d * c.vekt + dw * w) / (c.vekt + w)
                    c.vekt += w; c.kart += 1
                    modell[best] = c
                } else {
                    modell.append(GlobaltPlan(n: nw, d: dw, vekt: w, kart: 1))
                }
            }
        }
        /// Dempet punkt-til-plan-løsning for ETT kart mot modellen. Returnerer (ω, t) i
        /// verdensrommet (p' = R(ω)p + t), eller nil når ingen plan passet / løsningen var
        /// urimelig. Kun modellplan med minst `minKart` kart bak seg brukes som fasit.
        func loes(_ kp: [KartPlan], _ c2wIn: simd_float4x4, _ modell: [GlobaltPlan],
                  terskel: Float, minKart: Int) -> (omega: SIMD3<Float>, t: SIMD3<Float>)? {
            var c2w = c2wIn
            var par: [(kp: KartPlan, g: GlobaltPlan)] = []
            for p in kp {
                let (nw, dw) = verdensPlan(p, c2w)
                var best: GlobaltPlan? = nil; var bestD = terskel
                for g in modell where g.kart >= minKart && simd_dot(g.n, nw) > cos6 {
                    let dd = abs(g.d - dw)
                    if dd < bestD { bestD = dd; best = g }
                }
                if let g = best { par.append((p, g)) }
            }
            guard !par.isEmpty else { return nil }
            var omegaSum = SIMD3<Float>(repeating: 0), tSum = SIMD3<Float>(repeating: 0)
            for iter in 0..<4 {
                // PARFORKASTING etter første løsning: et kart-plan som fortsatt ligger over 4 cm
                // fra modellplanet sitt er paret feil (skapfronten mot veggen bak, bordplata mot
                // gulvet). Det kastes; de riktige parene har residual nær null etter ett steg.
                if iter == 1 {
                    par = par.filter { (kp, g) in
                        var rs = kp.pts.map { abs(simd_dot(g.n, (c2w * SIMD4($0, 1)).xyz) + g.d) }
                        rs.sort()
                        return rs[rs.count / 2] < 0.04
                    }
                    guard !par.isEmpty else { return nil }
                }
                var A = [Float](repeating: 0, count: 36)
                var b = [Float](repeating: 0, count: 6)
                var N: Float = 0
                for (kp, g) in par {
                    for pc in kp.pts {
                        let pw = (c2w * SIMD4(pc, 1)).xyz
                        let r = simd_dot(g.n, pw) + g.d
                        guard abs(r) < 0.25 else { continue }
                        let jr = simd_cross(pw, g.n)
                        let J: [Float] = [jr.x, jr.y, jr.z, g.n.x, g.n.y, g.n.z]
                        for a in 0..<6 {
                            b[a] -= J[a] * r
                            for c in 0..<6 { A[a * 6 + c] += J[a] * J[c] }
                        }
                        N += 1
                    }
                }
                guard N >= 60 else { break }
                // Demping: translasjon myk (3 cm² per punkt); retninger uten plan får A=0 der
                // og løses til null — posen står urørt. KUN TRANSLASJON som standard (målt
                // 13.09): med rotasjon fri valgte løseren en vipp om x for å løfte taket når
                // bare et takstykke langt unna var synlig, og vippen flyttet VEGGENE 3 cm
                // (θ·y). Driften ARKit gjør er en glidning; gravitasjonen holder rotasjonen.
                // meshscan.driftrot = "on" slipper rotasjonen fri (A/B).
                for a in 0..<3 { A[a * 6 + a] += rotFri ? N * 1.0 : N * 1e6 }
                for a in 3..<6 { A[a * 6 + a] += N * 0.03 }
                guard let x = solve6(A, b) else { break }
                let omega = rotFri ? SIMD3(x[0], x[1], x[2]) : SIMD3<Float>(repeating: 0)
                let t = SIMD3(x[3], x[4], x[5])
                let camPos = c2w.columns.3.xyz
                c2w = flytt(c2w, omega, t)
                omegaSum += omega; tSum += (c2w.columns.3.xyz - camPos)
                if simd_length(omega) < 1e-5, simd_length(t) < 1e-5 { break }
            }
            // Mer enn 20 cm eller 5° på ett kart er ikke drift, det er feil plan.
            if simd_length(tSum) > 0.20 || simd_length(omegaSum) > 5 * Float.pi / 180 { return nil }
            return (omegaSum, tSum)
        }
        func gulvSpredning(_ poser: [simd_float4x4]) -> (lo: Float, hi: Float, kart: Int)? {
            var modell: [GlobaltPlan] = []
            for i in 0..<n { leggTil(&modell, planer[i], poser[i], terskel: 0.15) }
            guard let gulv = modell.filter({ $0.n.y > 0.85 && $0.kart >= 10 }).max(by: { $0.vekt < $1.vekt }) else { return nil }
            var ds: [Float] = []
            for i in 0..<n {
                for p in planer[i] {
                    let (nw, dw) = verdensPlan(p, poser[i])
                    if simd_dot(nw, gulv.n) > cos6, abs(dw - gulv.d) < 0.15 { ds.append(dw) }
                }
            }
            guard ds.count >= 10 else { return nil }
            ds.sort()
            return (ds[ds.count / 10], ds[ds.count * 9 / 10], ds.count)
        }
        let spredningFoer = gulvSpredning(raa)

        // ── 2. TO RUNDER GLOBALT. Runde 1: modellplan klynget LØST (15 cm) fra de rå posene —
        // driften er inntil 11 cm, så et gulv sett først og sist må havne i samme klynge.
        // Hvert kart løses mot modellen (dempet translasjon, parforkasting), kart uten
        // løsning interpoleres langs tida. Runde 2: klyng på nytt fra de rettede posene med
        // STRAM terskel (6 cm), så skapfronten skiller seg fra veggen bak, og løs én gang til.
        // (Sekvensiell kart-mot-modell ble prøvd 13.09 og løp løpsk: 885 mm på 90 s —
        // modellen fulgte kartene i stedet for omvendt.)
        let orden = (0..<n).sorted { frames[$0].timestamp < frames[$1].timestamp }
        var delta = [(omega: SIMD3<Float>, t: SIMD3<Float>)](repeating: (.zero, .zero), count: n)
        var rettet = 0, interpolert = 0, forkastet = 0
        var modell2: [GlobaltPlan] = []
        let dump = UserDefaults.standard.string(forKey: "meshscan.driftdump") == "on"
        var diag = [String](repeating: "", count: n)
        for runde in 1...2 {
            // 12 cm begge runder: per-kart-planet på én og samme vegg spriker ±3–7 cm fra
            // kart til kart (dumpet 13.09: 2528, 2507, 2593, 2514 …), så en stram terskel
            // splitter veggen i fragmenter som hvert kart «treffer» uten å bli rettet.
            let terskelKlynge: Float = runde == 1 ? 0.15 : 0.12
            let terskelPar: Float = 0.12
            var modell: [GlobaltPlan] = []
            for i in orden { leggTil(&modell, planer[i], flytt(raa[i], delta[i].omega, delta[i].t), terskel: terskelKlynge) }
            modell2 = modell
            let dslots = UnsafeMutablePointer<(SIMD3<Float>, SIMD3<Float>)?>.allocate(capacity: n)
            dslots.initialize(repeating: nil, count: n)
            defer { dslots.deinitialize(count: n); dslots.deallocate() }
            let deltaKopi = delta, modellKopi = modell
            let diagSlots = UnsafeMutablePointer<String>.allocate(capacity: n)
            diagSlots.initialize(repeating: "", count: n)
            defer { diagSlots.deinitialize(count: n); diagSlots.deallocate() }
            DispatchQueue.concurrentPerform(iterations: n) { i in
                guard !planer[i].isEmpty else { return }
                let c = flytt(raa[i], deltaKopi[i].omega, deltaKopi[i].t)
                if let svar = loes(planer[i], c, modellKopi, terskel: terskelPar, minKart: 10) { dslots[i] = (svar.omega, svar.t) }
                if dump {
                    var linje = String(format: "r%d kf%d t=%.1f delta_inn=(%.0f,%.0f,%.0f)mm", runde, frames[i].kfIndex ?? -1, frames[i].timestamp,
                                       deltaKopi[i].t.x * 1000, deltaKopi[i].t.y * 1000, deltaKopi[i].t.z * 1000)
                    for p in planer[i] {
                        let (nw, dw) = verdensPlan(p, c)
                        var best: GlobaltPlan? = nil; var bestD = terskelPar
                        for g in modellKopi where g.kart >= 10 && simd_dot(g.n, nw) > cos6 {
                            let dd = abs(g.d - dw); if dd < bestD { bestD = dd; best = g }
                        }
                        linje += String(format: " | plan n=(%.2f,%.2f,%.2f) d=%.0f n=%d", nw.x, nw.y, nw.z, dw * 1000, p.antall)
                        if let g = best { linje += String(format: " → modell d=%.0f (%d kart) Δ=%.0f", g.d * 1000, g.kart, (dw - g.d) * 1000) } else { linje += " → ingen" }
                    }
                    if let d = dslots[i] { linje += String(format: " ⇒ t=(%.0f,%.0f,%.0f)", d.1.x * 1000, d.1.y * 1000, d.1.z * 1000) } else { linje += " ⇒ nil" }
                    diagSlots[i] = linje
                }
            }
            if dump { for i in 0..<n { diag[i] += diagSlots[i] + "\n" } }
            var nyDelta = [(omega: SIMD3<Float>, t: SIMD3<Float>)?](repeating: nil, count: n)
            for i in 0..<n {
                guard case let (om, t)? = dslots[i] else { continue }
                let ny = flytt(flytt(raa[i], delta[i].omega, delta[i].t), om, t)
                let Rn = simd_float3x3(columns: (ny.columns.0.xyz, ny.columns.1.xyz, ny.columns.2.xyz))
                let Rr = simd_float3x3(columns: (raa[i].columns.0.xyz, raa[i].columns.1.xyz, raa[i].columns.2.xyz))
                let Rd = Rn * Rr.transpose
                let omegaTot = SIMD3(Rd.columns.1.z - Rd.columns.2.y, Rd.columns.2.x - Rd.columns.0.z, Rd.columns.0.y - Rd.columns.1.x) * 0.5
                nyDelta[i] = (omegaTot, ny.columns.3.xyz - Rd * raa[i].columns.3.xyz)
            }
            // GLATTING LANGS TIDA. Driften er glatt og langsom (1,4 mm/s målt), mens hvert
            // karts egen løsning bærer plan-støyen på ±3–7 cm. Korreksjonen skal derfor være en
            // glatt funksjon av tida: gaussisk snitt (σ 2,5 s ≈ 25 kart) over de løste kartene,
            // robust (kart som ligger > 5 cm fra kurven kastes i andre pass). Kart uten løsning
            // får kurvens verdi — det er interpolasjonen. ARKits egne hopp (posen steppet
            // −64 mm ved 90 s) er brudd: der medianen 2 s før og 2 s etter spriker > 4 cm
            // deles rekka, og glattingen krysser aldri et brudd.
            var loeste = [Int](); loeste.reserveCapacity(n)
            for i in orden where nyDelta[i] != nil { loeste.append(i) }
            if runde == 1 {
                rettet = loeste.count
                forkastet = (0..<n).filter { !planer[$0].isEmpty && nyDelta[$0] == nil }.count
                interpolert = n - rettet
            }
            guard loeste.count >= 3 else {
                MeshLog.log("driftretting — bare \(loeste.count) kart løst i runde \(runde), hopper over")
                return
            }
            func median3(_ v: [SIMD3<Float>]) -> SIMD3<Float> {
                guard !v.isEmpty else { return .zero }
                let xs = v.map { $0.x }.sorted(), ys = v.map { $0.y }.sorted(), zs = v.map { $0.z }.sorted()
                return SIMD3(xs[xs.count / 2], ys[ys.count / 2], zs[zs.count / 2])
            }
            let tid = loeste.map { frames[$0].timestamp }
            let tv = loeste.map { nyDelta[$0]!.t }
            // Brudd: indeks k i `loeste` der rekka deles ETTER k.
            var brudd = Set<Int>()
            for k in 0..<(loeste.count - 1) {
                var foer: [SIMD3<Float>] = [], etter: [SIMD3<Float>] = []
                for m in 0..<loeste.count {
                    let dt = tid[m] - tid[k]
                    if dt <= 0, dt > -2 { foer.append(tv[m]) }
                    if dt > 0, dt <= 2 { etter.append(tv[m]) }
                }
                if foer.count >= 3, etter.count >= 3, simd_length(median3(foer) - median3(etter)) > 0.04 { brudd.insert(k) }
            }
            // Slå sammen brudd som ligger innen 1 s: behold det med størst sprang (første er nok).
            var segmentAv = [Int](repeating: 0, count: loeste.count)
            var seg = 0
            var sisteBrudd = -1e9
            for k in 0..<loeste.count {
                segmentAv[k] = seg
                if brudd.contains(k), tid[k] - sisteBrudd > 1 { seg += 1; sisteBrudd = tid[k] }
            }
            if runde == 2, seg > 0 { MeshLog.log("driftretting — \(seg) brudd i poserekka (ARKit-hopp), glattes hver for seg") }
            func segmentVed(_ t: Double) -> Int {
                // Segmentet til det løste kartet nærmest i tid.
                var best = 0; var bestDt = Double.greatestFiniteMagnitude
                for k in 0..<loeste.count { let dt = abs(tid[k] - t); if dt < bestDt { bestDt = dt; best = k } }
                return segmentAv[best]
            }
            let sigma = 2.5
            var bruk = [Bool](repeating: true, count: loeste.count)
            func kurve(_ t: Double, _ segm: Int) -> SIMD3<Float>? {
                var sum = SIMD3<Float>(repeating: 0); var w: Float = 0
                for k in 0..<loeste.count where bruk[k] && segmentAv[k] == segm {
                    let dt = (tid[k] - t) / sigma
                    guard abs(dt) < 4 else { continue }
                    let g = Float(exp(-0.5 * dt * dt))
                    sum += tv[k] * g; w += g
                }
                return w > 0.3 ? sum / w : nil
            }
            // Pass 1 → kast avvikere → pass 2.
            for k in 0..<loeste.count {
                if let c = kurve(tid[k], segmentAv[k]), simd_length(tv[k] - c) > 0.05 { bruk[k] = false }
            }
            for i in orden {
                let t = frames[i].timestamp
                if let c = kurve(t, segmentVed(t)) {
                    delta[i] = (nyDelta[i]?.omega ?? delta[i].omega, c)
                } else if let d = nyDelta[i] {
                    delta[i] = d
                }
            }
        }

        // ── 4. Anvendelse.
        var korreksjonAbs = [Float](repeating: 0, count: n)
        for i in 0..<n {
            frames[i].c2w = flytt(raa[i], delta[i].omega, delta[i].t)
            korreksjonAbs[i] = simd_length(frames[i].c2w.columns.3.xyz - raa[i].columns.3.xyz)
        }

        let spredningEtter = gulvSpredning(frames.map { $0.c2w })
        let tStart = frames.map { $0.timestamp }.min() ?? 0
        let tSlutt = frames.map { $0.timestamp }.max() ?? 0
        var vinduer: [String] = []
        var w = 0
        while Double(w * 10) <= tSlutt - tStart && w < 200 {
            let sel = (0..<n).filter { Int((frames[$0].timestamp - tStart) / 10) == w }
            if !sel.isEmpty {
                let m = sel.map { korreksjonAbs[$0] }.reduce(0, +) / Float(sel.count)
                vinduer.append(String(format: "%d0s:%.0f", w, m * 1000))
            }
            w += 1
        }
        let maks = korreksjonAbs.max() ?? 0
        let snitt = korreksjonAbs.reduce(0, +) / Float(n)
        MeshLog.log(String(format: "driftretting — %d kart, %d modellplan, %d løst / %d interpolert / %d forkastet, flytt snitt %.0f mm maks %.0f mm på %.1fs",
                           n, modell2.filter { $0.kart >= 10 }.count, rettet, interpolert, forkastet,
                           snitt * 1000, maks * 1000, CFAbsoluteTimeGetCurrent() - t0))
        MeshLog.log("driftretting — flytt per vindu (mm): " + vinduer.joined(separator: " "))
        if let f = spredningFoer, let e = spredningEtter {
            MeshLog.log(String(format: "driftretting — gulvhøyde p10–p90 over %d kart: %.0f…%.0f mm → %.0f…%.0f mm (spenn %.0f → %.0f mm)",
                               f.kart, f.lo * 1000, f.hi * 1000, e.lo * 1000, e.hi * 1000, (f.hi - f.lo) * 1000, (e.hi - e.lo) * 1000))
        }
        // Harness: skriv de rettede posene så drift_verify.py kan måle dem uavhengig av loggen.
        if UserDefaults.standard.string(forKey: "meshscan.driftdump") == "on" {
            var txt = ""
            for f in frames {
                let c = f.c2w.columns
                let m = [c.0.x, c.0.y, c.0.z, c.0.w, c.1.x, c.1.y, c.1.z, c.1.w, c.2.x, c.2.y, c.2.z, c.2.w, c.3.x, c.3.y, c.3.z, c.3.w]
                    .map { String(format: "%.6f", $0) }.joined(separator: ",")
                txt += String(format: "{\"kf\":%d,\"t\":%.4f,\"w\":%d,\"h\":%d,\"fx\":%.3f,\"fy\":%.3f,\"cx\":%.3f,\"cy\":%.3f,\"m\":[%@]}\n",
                              f.kfIndex ?? -1, f.timestamp, f.w, f.h, f.fx, f.fy, f.cx, f.cy, m)
            }
            try? txt.write(to: framesDir.appendingPathComponent("drift-poser.jsonl"), atomically: true, encoding: .utf8)
            let modellTxt = modell2.filter { $0.kart >= 10 }.map { String(format: "modell n=(%.2f,%.2f,%.2f) d=%.0f kart=%d", $0.n.x, $0.n.y, $0.n.z, $0.d * 1000, $0.kart) }.joined(separator: "\n")
            try? (modellTxt + "\n" + orden.map { diag[$0] }.joined()).write(to: framesDir.appendingPathComponent("drift-diag.txt"), atomically: true, encoding: .utf8)
        }
    }

    /// Dominante plan i ETT dybdekart: RANSAC på et utvalg av punktene i kamerarommet, inntil
    /// tre plan, hvert med minst 12 % av de gjenværende punktene. Normalen orienteres mot
    /// kameraet (gulv og tak får dermed motsatt normal og klynges aldri sammen).
    private static func kartPlan(_ f: DFrame, seed: UInt64) -> [KartPlan] {
        guard let dep = f.load() else { return [] }
        let steg = max(1, f.w / 128)
        var pts: [SIMD3<Float>] = []
        pts.reserveCapacity((f.w / steg) * (f.h / steg))
        var y = 0
        while y < f.h {
            var x = 0
            while x < f.w {
                let z = dep[y * f.w + x]
                if z > 0.3, z < 5.0 {
                    pts.append(SIMD3((Float(x) - f.cx) / f.fx * z, -(Float(y) - f.cy) / f.fy * z, -z))
                }
                x += steg
            }
            y += steg
        }
        guard pts.count >= 300 else { return [] }
        var rng = seed &* 0x9E3779B97F4A7C15
        func rand(_ m: Int) -> Int {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17
            return Int(rng % UInt64(m))
        }
        var rest = pts
        var out: [KartPlan] = []
        let terskel: Float = 0.025
        for _ in 0..<3 {
            guard rest.count >= 300 else { break }
            var best: (n: SIMD3<Float>, d: Float, inl: Int)? = nil
            for _ in 0..<40 {
                let a = rest[rand(rest.count)], b = rest[rand(rest.count)], c = rest[rand(rest.count)]
                let nn = simd_cross(b - a, c - a)
                let l = simd_length(nn)
                guard l > 1e-6 else { continue }
                let nrm = nn / l
                let d = -simd_dot(nrm, a)
                var inl = 0
                for p in rest where abs(simd_dot(nrm, p) + d) < terskel { inl += 1 }
                if best == nil || inl > best!.inl { best = (nrm, d, inl) }
            }
            guard let b0 = best, b0.inl >= max(150, rest.count * 12 / 100) else { break }
            // Forfining: minste kvadraters plan gjennom innliggerne (kovarians + Jacobi).
            var inliers: [SIMD3<Float>] = []
            var utenfor: [SIMD3<Float>] = []
            for p in rest {
                if abs(simd_dot(b0.n, p) + b0.d) < terskel { inliers.append(p) } else { utenfor.append(p) }
            }
            var (n, d) = planFit(inliers)
            if simd_dot(n, inliers[0]) > 0 { n = -n; d = -d }   // mot kameraet (kamera i origo)
            // Andre pass med det forfinede planet, så innliggersettet er konsistent.
            inliers.removeAll(); utenfor.removeAll()
            for p in rest {
                if abs(simd_dot(n, p) + d) < terskel { inliers.append(p) } else { utenfor.append(p) }
            }
            guard inliers.count >= 150 else { break }
            // Utvalg til løsningen: maks 300 punkter, jevnt fordelt.
            let hopp = max(1, inliers.count / 300)
            var utvalg: [SIMD3<Float>] = []
            var k = 0
            while k < inliers.count { utvalg.append(inliers[k]); k += hopp }
            out.append(KartPlan(n: n, d: d, antall: inliers.count, pts: utvalg))
            rest = utenfor
        }
        return out
    }

    /// Minste kvadraters plan: normal = egenvektoren til minste egenverdi i kovariansen.
    private static func planFit(_ pts: [SIMD3<Float>]) -> (SIMD3<Float>, Float) {
        var c = SIMD3<Float>(repeating: 0)
        for p in pts { c += p }
        c /= Float(pts.count)
        var xx: Float = 0, xy: Float = 0, xz: Float = 0, yy: Float = 0, yz: Float = 0, zz: Float = 0
        for p in pts {
            let q = p - c
            xx += q.x * q.x; xy += q.x * q.y; xz += q.x * q.z; yy += q.y * q.y; yz += q.y * q.z; zz += q.z * q.z
        }
        let n = minsteEgenvektor(xx, xy, xz, yy, yz, zz)
        return (n, -simd_dot(n, c))
    }

    /// Jacobi-rotasjoner på en symmetrisk 3×3 — liten, deterministisk, ingen Accelerate.
    private static func minsteEgenvektor(_ xx: Float, _ xy: Float, _ xz: Float, _ yy: Float, _ yz: Float, _ zz: Float) -> SIMD3<Float> {
        var a: [[Float]] = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]]
        var v: [[Float]] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        for _ in 0..<30 {
            var p = 0, q = 1, maks: Float = abs(a[0][1])
            if abs(a[0][2]) > maks { p = 0; q = 2; maks = abs(a[0][2]) }
            if abs(a[1][2]) > maks { p = 1; q = 2; maks = abs(a[1][2]) }
            if maks < 1e-12 { break }
            let theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
            let t = (theta >= 0 ? 1 : -1) / (abs(theta) + (theta * theta + 1).squareRoot())
            let cs = 1 / (t * t + 1).squareRoot(), sn = t * cs
            for k in 0..<3 {
                let akp = a[k][p], akq = a[k][q]
                a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq
            }
            for k in 0..<3 {
                let apk = a[p][k], aqk = a[q][k]
                a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk
            }
            for k in 0..<3 {
                let vkp = v[k][p], vkq = v[k][q]
                v[k][p] = cs * vkp - sn * vkq; v[k][q] = sn * vkp + cs * vkq
            }
        }
        var mi = 0
        if a[1][1] < a[mi][mi] { mi = 1 }
        if a[2][2] < a[mi][mi] { mi = 2 }
        return simd_normalize(SIMD3(v[0][mi], v[1][mi], v[2][mi]))
    }

    /// Rotasjonsmatrise fra rotasjonsvektor (Rodrigues).
    private static func rotasjon(_ omega: SIMD3<Float>) -> simd_float3x3 {
        let ang = simd_length(omega)
        guard ang > 1e-9 else { return matrix_identity_float3x3 }
        let k = omega / ang
        let K = simd_float3x3(rows: [SIMD3(0, -k.z, k.y), SIMD3(k.z, 0, -k.x), SIMD3(-k.y, k.x, 0)])
        return matrix_identity_float3x3 + sin(ang) * K + (1 - cos(ang)) * (K * K)
    }

    /// Gauss-eliminasjon med pivotering på et 6×6-system.
    private static func solve6(_ Ain: [Float], _ bin: [Float]) -> [Float]? {
        var A = Ain, b = bin
        for c in 0..<6 {
            var p = c
            for r in (c + 1)..<6 where abs(A[r * 6 + c]) > abs(A[p * 6 + c]) { p = r }
            guard abs(A[p * 6 + c]) > 1e-9 else { return nil }
            if p != c {
                for k in 0..<6 { A.swapAt(c * 6 + k, p * 6 + k) }
                b.swapAt(c, p)
            }
            for r in (c + 1)..<6 {
                let f = A[r * 6 + c] / A[c * 6 + c]
                guard f != 0 else { continue }
                for k in c..<6 { A[r * 6 + k] -= f * A[c * 6 + k] }
                b[r] -= f * b[c]
            }
        }
        var x = [Float](repeating: 0, count: 6)
        for r in stride(from: 5, through: 0, by: -1) {
            var s = b[r]
            for k in (r + 1)..<6 { s -= A[r * 6 + k] * x[k] }
            x[r] = s / A[r * 6 + r]
        }
        return x.allSatisfy { $0.isFinite } ? x : nil
    }

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
                              c2w: mt.m, url: u, inline: nil, trust: trust[n], jbuGuide: nil, jbuScale: 1,
                              timestamp: mt.t))
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
        // PARALLELT (2026-09-05): målt 96 s for 61 keyframes énkjernet — hver JBU er
        // uavhengig av de andre, så de kjøres på alle kjerner og legges i hver sin plass.
        let slots = UnsafeMutablePointer<DFrame?>.allocate(capacity: kfs.count)
        slots.initialize(repeating: nil, count: kfs.count)
        defer { slots.deinitialize(count: kfs.count); slots.deallocate() }
        let t0 = CFAbsoluteTimeGetCurrent()
        DispatchQueue.concurrentPerform(iterations: kfs.count) { i in
            let k = kfs[i]
            guard let df = k.depthFile,
                  let dd = try? Data(contentsOf: dir.appendingPathComponent(df)),
                  dd.count == k.depthWidth * k.depthHeight * 4,
                  let g = loadLuma(dir.appendingPathComponent(k.file), maxW: k.depthWidth * scale)
            else { return }
            let low = dd.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            let up = jbu(depth: low, dw: k.depthWidth, dh: k.depthHeight, guide: g.y, gw: g.w, gh: g.h)
            let s = Float(g.w) / Float(k.width)
            let m = k.transform
            slots[i] = DFrame(w: g.w, h: g.h,
                              fx: k.intrinsics[0] * s, fy: k.intrinsics[1] * s,
                              cx: k.intrinsics[2] * s, cy: k.intrinsics[3] * s,
                              c2w: simd_float4x4(columns: (SIMD4(m[0], m[1], m[2], m[3]),
                                                           SIMD4(m[4], m[5], m[6], m[7]),
                                                           SIMD4(m[8], m[9], m[10], m[11]),
                                                           SIMD4(m[12], m[13], m[14], m[15]))),
                              url: nil, inline: up, trust: 1, jbuGuide: nil, jbuScale: scale,
                              timestamp: k.timestamp, kfIndex: k.index)
        }
        var out: [DFrame] = []
        out.reserveCapacity(kfs.count)
        for i in 0..<kfs.count { if let f = slots[i] { out.append(f) } }
        MeshLog.log(String(format: "TSDF: depth super-res på %d keyframes (JBU ×%d) på %.1fs", out.count, scale, CFAbsoluteTimeGetCurrent() - t0))
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
