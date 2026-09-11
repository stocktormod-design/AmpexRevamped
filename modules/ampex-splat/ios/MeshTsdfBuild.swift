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
        /// BEDRE. Drift er ikke årsaken — re-ankring flytter posene 0,0 mm.
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
    kernel void ampex_integrate(device atomic_float* sumWD [[buffer(0)]],
                                device atomic_float* sumW  [[buffer(1)]],
                                device const float* depth  [[buffer(2)]],
                                constant P& p              [[buffer(3)]],
                                uint3 gid [[thread_position_in_grid]]) {
        if (gid.x >= (uint)p.dims.x || gid.y >= (uint)p.dims.y || gid.z >= (uint)p.dims.z) return;
        float3 wp = p.lo + (float3(gid) + 0.5) * p.voxel;
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
        uint i = (gid.z * p.dims.y + gid.y) * p.dims.x + gid.x;
        atomic_fetch_add_explicit(&sumWD[i], d * wf, memory_order_relaxed);
        atomic_fetch_add_explicit(&sumW[i],  wf,     memory_order_relaxed);
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
    static func build(framesDir: URL, options optionsIn: Options = Options(),
                      tillegg: MeshBakeV2.MergedMesh? = nil) -> MeshBakeV2.MergedMesh? {
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
        let total = dim.x * dim.y * dim.z
        MeshLog.log(String(format: "TSDF: %d frames · %.1f×%.1f×%.1f m · voxel %dmm · %.1fM voxels (%dMB)",
                           frames.count, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z,
                           Int(vox * 1000), Double(total) / 1e6, total * 8 / 1024 / 1024))

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
            gpuKart = integrateGPU(frames: frames, lo: lo, vox: vox, dim: dim, trunc: trunc,
                                   truncBehind: truncBehind, options: options, S: S, W: W)
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
        // meshscan.tsdftillegg = "volum" slår den på.
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
                            let k = (gz * dim.y + gy) * dim.x + gx
                            guard W[k] <= 0 else { continue }     // ekte dybde vinner
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
            blurVolume(S, wgt: W, count: total, dim: dim, passes: options.volumeBlur, minW: options.minWeight)
            volumeProbe?(S, W, dim, lo, vox)
            ARMeshGlbExporter.progress?("Trekker ut flater…")
            return surfaceNets(sdf: S, wgt: W, dim: dim, lo: lo, vox: vox,
                               minW: options.minWeight, smoothPasses: options.smoothPasses,
                               tillegg: tillegg)
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
                                let i = (gz * dim.y + gy) * dim.x + gx
                                if W[i] > 0 { freeBuf[i] += vote }
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
                                    tillegg: MeshBakeV2.MergedMesh? = nil) -> MeshBakeV2.MergedMesh? {
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
                    // SDF entries describe voxel centers (integrateMSL: gid + 0.5),
                    // not grid corners. Omitting this offset displaced every extracted
                    // surface by -vox/2 on all axes: 10 mm/axis at the default 20 mm.
                    verts.append(lo + (SIMD3<Float>(Float(x), Float(y), Float(z)) + SIMD3<Float>(repeating: 0.5) + acc / Float(n)) * vox)
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
                              url: nil, inline: up, trust: 1, jbuGuide: nil, jbuScale: scale)
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
