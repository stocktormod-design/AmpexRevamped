import UIKit
import ARKit
import SceneKit
import CoreImage
import os // os_proc_available_memory — ekte headroom fra OS-et

struct MeshScanResult {
    let fileURL: URL
    let relativePath: String
    let format: String
    let framesDirURL: URL?    // skann-bundle (keyframes + dybde + fixture) — rebake-harnessens inngang
    let keyframeCount: Int
    let textured: Bool                // false → falt tilbake til uteksturert vertex-farge-GLB
    let filledFraction: Double?       // andel av UV-atlaset som fikk tekstur (nil = bake ikke forsøkt)
    let geometryPath: String          // "fusion-v2", "anchor-v2" eller "anchor-fallback" (uteksturert reserve)
}

enum MeshScanError: LocalizedError {
    case cancelled
    case notSupported
    case noMeshData
    case exportFailed(String)
    var errorDescription: String? {
        switch self {
        case .cancelled: return "Skann avbrutt"
        case .notSupported: return "Enheten støtter ikke LiDAR scene-mesh"
        case .noMeshData: return "Ingen mesh ble skannet. Beveg telefonen rundt rommet"
        case .exportFailed(let m): return m
        }
    }
}

/// Polycam-style dense LiDAR mesh capture via ARKit scene reconstruction. Shows the live mesh as a
/// cyan wireframe so the user sees coverage, then exports the merged mesh to GLB.
private struct VoxelKey: Hashable {
    let x: Int32, y: Int32, z: Int32
}

@available(iOS 13.4, *)
final class MeshScanPresenter: NSObject, ARSCNViewDelegate, ARSessionDelegate {
    private let companyId: String
    private let roomId: String
    private var sceneView: ARSCNView!
    private var hostingController: UIViewController?
    private var onFinish: ((Result<MeshScanResult, Error>) -> Void)?

    // World-space colour accumulation (voxel grid ~3 cm) — sampled from the camera while scanning,
    // averaged into a per-vertex colour on export.
    private static let voxelSize: Float = 0.03
    private var colorAccum: [VoxelKey: SIMD4<Float>] = [:]  // xyz = RGB sum, w = count
    private var frameCounter = 0
    // Diagnostics: are camera-colour samples actually landing? (see doneTapped log)
    private var sampleFramesProcessed = 0
    private var sampleVertsConsidered = 0
    private var sampleRejectedBehind = 0
    private var sampleRejectedOffscreen = 0
    private var sampleHits = 0

    // MARK: - Keyframe capture (texture-baking step 1)
    // Full pipeline: capture RGB keyframes + camera params during scan → UV unwrap → Metal bake.
    struct Keyframe: Codable {
        let index: Int
        let file: String          // jpeg filename inside framesDir
        let timestamp: Double
        let width: Int            // stored (downscaled) image size
        let height: Int
        var transform: [Float]    // camera-to-world, 16 floats column-major (re-anchored at export)
        let intrinsics: [Float]   // [fx, fy, cx, cy] scaled to the stored image size
        let depthFile: String?    // raw Float32 LiDAR depth (metres), tight w*h, for occlusion test
        let depthWidth: Int
        let depthHeight: Int
        var sharpness: Float = 0   // gradient-energy blur metric (higher = sharper); used to pick the best frames
        var motion: Float = 0      // camera speed at capture (lower = steadier); pruned out if ghosty
        var blurPx: Float? = nil   // predikert bevegelsesuskarphet i lagrede piksler (eksponeringstid × fart × brennvidde); nil = eldre bundle
        var anchorID: String? = nil      // nearest mesh anchor at capture — for drift re-anchoring at export
        var relTransform: [Float]? = nil // camera pose in that anchor's local frame (column-major 16)
        var preLock: Bool? = nil         // tatt FØR AE/AWB-låsen slo inn → annen eksponering enn resten
        var isPlaneShot: Bool? = nil     // dedikert 12MP-veggfoto (fredet fra budsjett-pruning, plan-prior i baken)
    }
    private static let keyframeTargetWidth: CGFloat = 1920  // fallback når 4K-videoformat ikke støttes
    // Settes til 3840 i start() når ARKit har 4K-format (iOS 16+): teksturbaken er strømmende
    // (én frame om gangen på GPU), så høyere kildeoppløsning koster kun disk/encode-tid — og
    // 1920-video var det harde kvalitetstaket for hele tekstur-pipelinen.
    private var kfTargetWidth: CGFloat = MeshScanPresenter.keyframeTargetWidth
    // Taket styrer også hvor langt dekningsfargingen («wireframen») kan vokse — for lavt tak
    // føles som hard cap i store rom. Baken pruner uansett ned til de 50-90 skarpeste.
    private static let maxKeyframes = 600
    private static let keyframeMinInterval: Double = 0.2    // seconds
    private static let keyframeMinMove: Float = 0.12        // metres
    private static let keyframeMinRotateDot: Float = 0.99   // ~8° between forward vectors
    private lazy var ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private var framesDir: URL?
    private var aeLockTime: Double = .infinity // settes når AE/AWB-låsen slår inn
    // Encoding + disk I/O run here so the AR delegate never blocks (avoids ARFrame retention).
    private let captureQueue = DispatchQueue(label: "ampex.meshscan.capture")
    private var keyframes: [Keyframe] = []   // mutated only on captureQueue
    // ── Erstatningsbuffer (2026-08-15): fangsten holder ÉN plass per synsvinkel-bøtte i stedet
    // for en kø. Fem runder rundt et rom treffer i hovedsak de SAMME bøttene, så lagringen
    // avgrenses av antall distinkte ståsteder — ikke av hvor langt du går — og hver plass ender
    // med det beste av forsøkene. Gjenbesøk kan dermed bare forbedre, aldri fortynne.
    // Erstatter én-skann-doktrinen (2026-08-13), som var riktig så lenge bufferet var
    // først-til-mølla: da KUNNE gjenbesøk bare stjele plass. Nå konkurrerer det med seg selv.
    // Begge feltene røres KUN på captureQueue.
    private var bucketSlot: [Int64: Int] = [:]  // synsvinkel-bøtte → posisjon i keyframes
    private var nextKFIndex = 0                 // filnavn-indeks — allokeres her, ikke på delegat-tråden
    private let captureDecisionAudit = CaptureDecisionAudit()
    private var kfNew = 0, kfReplaced = 0, kfNotBetter = 0  // diagnostikk, kun captureQueue
    // Delegat-tråden: hindrer at én bøtte spammer captureQueue (og at 4K-kopier hoper seg opp).
    private var bucketLastDispatch: [Int64: Double] = [:]
    // Kadens per bøtte. Device-kjøring 2026-08-15 (30 s skann): 1,5 s ga bare 30 keyframes av
    // 160 tillatte og 90 % avvisning — når man står i ro eller dveler i et lite rom treffer man
    // de samme bøttene hele tiden, og bufferet fikk aldri kandidater å velge mellom. 0,4 s lar
    // en bøtte utfordres på nytt mens man fortsatt ser på den; erstatningen (15 % hysterese)
    // er uansett den som avgjør om noe faktisk skrives.
    // meshscan.capture = "slow" gjenoppretter 1,5 s for A/B.
    private var bucketCadence: Double {
        UserDefaults.standard.string(forKey: "meshscan.capture") == "slow" ? 1.5 : 0.4
    }
    // Uskarphetsporten (forskningsoppgradering #1, 2026-08-27): grense i predikerte
    // uskarphets-PIKSLER for kandidater til alt besøkte bøtter. Fartsporten er eksponerings-
    // blind; denne er fysikken. Harnesset sender alle flagg som String — parse den òg.
    private var blurGatePx: Float {
        if let s = UserDefaults.standard.string(forKey: "meshscan.blurgate") {
            if s == "off" { return .infinity }
            if let v = Float(s) { return v }
        }
        return 60
    }
    // Tett dybdelogg (se maybeRecordDenseDepth): teller/takt på delegat-tråden, filhandle på captureQueue.
    private var denseCount = 0
    /// Teller ALLE kandidat-tikk (ikke bare lagrede) — grunnlaget for uttynningen.
    private var denseTick: UInt64 = 0
    private var lastDenseTime: Double = -1
    private var denseHandle: FileHandle?
    private var denseClosed = false // etter Ferdig: sene kart skal IKKE gjenåpne (og trunkere) indeksen
    private static let denseMax = 600      // ~118 MB tak per bundle
    private static let denseInterval = 0.2 // 5 Hz
    private var keyframeReserved = 0          // gate/index, delegate thread only
    private var lastNoveltyForce: Double = -1 // dekningstvangens 2 Hz-takt (delegat-tråden)
    private var noveltyForced = 0             // diagnostikk: fangster tvunget av ufotografert sikt
    private var lastIntervalProbe: Double = -1 // dekningsunntakets 10 Hz-takt
    private var intervalForced = 0            // diagnostikk: fangster som gikk forbi minsteintervallet
    private var lastKeyframeTime: Double = -1
    private var lastKeyframePos: SIMD3<Float>?
    private var lastKeyframeFwd: SIMD3<Float>?
    private var lastKeyframeBlurPx: Float?

    // "Move slower" indicator — fast motion blurs the photos and hurts tracking.
    private weak var hintLabel: UILabel?
    private weak var guideView: GestureGuideView?

    // MARK: - Veiledning («babyfeed»): ÉN tydelig, animert instruks om gangen.
    // Rå Int-verdi = prioritet — høyere avbryter lavere umiddelbart, lavere må vente
    // på minimum visningstid (unngår flimring mellom nesten-like tilstander).
    private enum Guide: Int {
        case none = 0, good, turnLeft, turnRight, turnAround, floor, ceiling, tooFar, strafe, slowDown
    }
    private var guide: Guide = .none
    private var guideSince: CFAbsoluteTime = 0
    // Pose-historikk (~5 s) for «snurrer på stedet»-deteksjon: mye yaw, lite posisjon.
    private var poseHistory: [(t: Double, pos: SIMD3<Float>, yaw: Float)] = []
    private var lastMotionPos: SIMD3<Float>?
    private var lastMotionFwd: SIMD3<Float>?
    private var lastMotionTime: Double = -1
    private var wasTooFast = false
    private var lastLinSpeed: Float = 0
    private var lastAngSpeed: Float = 0
    // Uskarphets-diagnostikk (delegat-tråden): kalibreringsdata til pipeline.log — grensa på
    // 60 px er satt i blinde, disse tallene fra ekte skann er det som skal justere den.
    private var blurRejected = 0
    private var blurStatSum: Double = 0
    private var blurStatMax: Float = 0
    private var blurStatN = 0
    private var lastExposureMs: Float = 0
    private static let defaultHint = "Mal bort stripene — der de er borte, har baken et godt bilde"

    // Én node per ARMeshAnchor, EID av ARSCNView (didAdd/didRemove) — SceneKit synker
    // transformene på render-tråden, vi henger bare wireframe-geometri på dem ved tikk.
    private var coverageNodes: [UUID: SCNNode] = [:]
    private var coverageTimer: Timer?
    // Konfigurasjonen tas vare på så sesjonen kan startes igjen etter avbrudd
    // (telefon, app i bakgrunnen, kamera tatt av en annen app) UTEN å nullstille
    // sporingen — nullstilling ville kastet alle mesh-ankere, altså hele wireframen.
    private var arConfig: ARWorldTrackingConfiguration?
    private var coverageBusySince: CFAbsoluteTime = 0
    private var lastCoverageOK: CFAbsoluteTime = 0
    private var sessionTrouble = false
    /// Frosne kopier av wireframe fra ankere ARKit har fjernet. Uten dem blir
    /// skjermen tom i det ARKit slår sammen eller relokaliserer ankere.
    private let ghostRoot = SCNNode()
    private var sampleCursor = 0 // rund-robin over anchors i fargesamplingen (konstant kost per frame)
    private var coverageBusy = false
    // Dekningskameraer vedlikeholdes INKREMENTELT på delegat-tråden når keyframen tas:
    // (a) ingen captureQueue.sync per tikk (blokkerte main mens JPEG-koding pågikk → hakking),
    // (b) w2c-inversen beregnes én gang, ikke 600 stk hvert sekund, (c) pose-dedup (0,2m/22,5°)
    // så gjenbesøk i lange skann ikke vokser lista — dekningen metter på 3 uansett.
    private var kfCams: [KFCam] = []
    private var kfCamBuckets = Set<Int64>()
    // Celler som er FERDIG dekket (grønn = 3 distinkte ståsteder, okklusjonsbekreftet) —
    // bygges av dekningstikket. Monoton vekst (formUnion) innenfor én økt: en ferdig flate
    // forblir ferdig selv når ankeret glir ut av tikkens 12 m-radius. Nullstilles når
    // AE/AWB-låsen slår inn, siden pre-lås-celler hviler på frames baken selv mistror.
    // MERK (2026-08-15): dette styrer nå bare WIREFRAME-fargen, ikke fangsten. Én-skann-
    // doktrinen er erstattet av erstatningsbufferet (`bucketSlot`) — gjenbesøk over grønn
    // flate er trygt fordi en ny frame konkurrerer om sin egen bøtte i stedet for å fortynne
    // et felles budsjett. Nyhetsporten står igjen kun som fallback før første mesh-anker.
    private var doneCells = Set<Int64>()
    // INKREMENTELL DEKNING (2026-09-05). Låsen er monoton («where wireframe shows
    // it'll NEVER add new texture»), og kameralista bare vokser. Da trenger ingen
    // celle testes mot samme kamera to ganger, og en låst celle aldri igjen. Før
    // regnet hvert pass ALT om: 222k hjørner × 162 kameraer = 36M tester, 1–2,4 s
    // CPU per pass, stride 8 → fargen lå opptil 8 s bak, og telefonen hakket.
    private final class CellCache {
        struct Tilstand { var kameraerTestet: Int32 = 0; var antall: UInt8 = 0; var pos: [SIMD3<Float>] = []; var sterk = false }
        var tilstand: [Int64: Tilstand] = [:]
        var laast = Set<Int64>()
        var sterke = Set<Int64>()
        /// Visningsalpha per celle, eased mot 0 (dekket) / 1 (mangler) — stripene toner, popper ikke.
        var alpha: [Int64: Float] = [:]
    }
    private let cellCache = CellCache()
    /// GPU-dekningsfeltet overlegget leser (CoverageField.swift). nil = Metal utilgjengelig.
    static let coverageField: CoverageField? = CoverageField()
    private var feltTikk = 0
    /// Det rødstripede sløret over hele viewet (CoverageVeil). Henges på kamera-noden.
    private var veil: CoverageVeil?
    private var lastSnaps: [UUID: AnchorSnap] = [:]
    private var dirtyAnchors = Set<UUID>()
    private var camsVedSistePass = 0
    private var gateRejected = 0
    private var tooFastRejected = 0   // rammer sluppet av fartsporten (delegat-tråden)
    private var lastNoveltyCheck: Double = -1
    // Adaptiv kadens: stort mesh → dekningspasset tar lengre tid → senk frekvensen i stedet for
    // å pinne CPU. Kontinuerlig pinning ga termisk struping som gjorde ALT tregere jo lenger
    // man skannet (ARKit, UI, koding).
    private var coverageStride = 1
    private var coverageCostN = 0
    private var coverageCostSum = 0.0
    private var coverageTickCount = 0
    private weak var percentLabel: UILabel?
    private weak var doneButton: UIButton?
    private weak var buildingLabel: UILabel?   // fase-tekst under baking
    private weak var ramLabel: UILabel?        // live RAM + headroom under fase-teksten
    private var ramTimer: Timer?
    private var donePulsing = false
    private static let lockGreen = SIMD3<Float>(0.204, 0.780, 0.349) // #34C759 — (legacy) låst
    private static let stripeRed = SIMD3<Float>(1.0, 0.231, 0.188)   // #FF3B30 — mangler dekning

    /// Synsvinkel-bøtte i ANKERETS lokale ramme — samme kvantisering som bakens `regionBucket`
    /// (0,6 m posisjon × 30° yaw × 30° pitch), så fangst og utvalg deler oppfatning av «samme
    /// ståsted». Anker-lokalt fordi verdensposen har drevet ved runde 5: samme fysiske ståsted
    /// ville hashet til en NABObøtte og gitt to halvfylte plasser i stedet for én erstatning.
    /// Ankerets ramme flytter seg med ARKits driftskorreksjon, så den er invariant.
    private static func viewBucket(anchorID: String, rel: simd_float4x4) -> Int64 {
        let p = SIMD3<Float>(rel.columns.3.x, rel.columns.3.y, rel.columns.3.z)
        let f = SIMD3<Float>(-rel.columns.2.x, -rel.columns.2.y, -rel.columns.2.z)
        let fl = simd_length(f)
        let fwd = fl > 1e-6 ? f / fl : SIMD3<Float>(0, 0, -1)
        let step: Float = .pi / 6 // 30°
        let bx = Int64((p.x / 0.6).rounded()), by = Int64((p.y / 0.6).rounded()), bz = Int64((p.z / 0.6).rounded())
        let yawB = Int64(((atan2(fwd.z, fwd.x) + .pi) / step).rounded())
        let pitchB = Int64(((asin(max(-1, min(1, fwd.y))) + .pi / 2) / step).rounded())
        // anchorID hasher per prosess — fint, bøttene sammenlignes kun innenfor ett skann.
        var h = Int64(truncatingIfNeeded: anchorID.hashValue)
        for v in [bx, by, bz, yawB, pitchB] { h = h &* 1_000_003 &+ v }
        return h
    }

    private static func voxelKey(_ p: SIMD3<Float>) -> VoxelKey {
        VoxelKey(x: Int32((p.x / voxelSize).rounded()),
                 y: Int32((p.y / voxelSize).rounded()),
                 z: Int32((p.z / voxelSize).rounded()))
    }

    init(companyId: String, roomId: String) {
        self.companyId = companyId
        self.roomId = roomId
        super.init()
    }

    static var isSupported: Bool {
        ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    func start(from presenter: UIViewController, completion: @escaping (Result<MeshScanResult, Error>) -> Void) {
        onFinish = completion
        guard MeshScanPresenter.isSupported else {
            completion(.failure(MeshScanError.notSupported))
            return
        }

        let host = UIViewController()
        host.modalPresentationStyle = .fullScreen
        host.view.backgroundColor = .black

        sceneView = ARSCNView(frame: host.view.bounds)
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.delegate = self
        sceneView.session.delegate = self
        sceneView.automaticallyUpdatesLighting = true
        host.view.addSubview(sceneView)

        let config = ARWorldTrackingConfiguration()
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
            config.sceneReconstruction = .meshWithClassification
        } else {
            config.sceneReconstruction = .mesh
        }
        config.environmentTexturing = .automatic
        // Plan-deteksjon SAMMEN med mesh: ARKit glatter meshen der den finner plan (gratis
        // flatere vegger), og ARPlaneAnchor(.wall) driver fase C-veiledningen + auto-shutter.
        config.planeDetection = [.horizontal, .vertical]
        // Both depth modes: sceneDepth (raw) + smoothedSceneDepth (filtered) for occlusion testing.
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
        }
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
            config.frameSemantics.insert(.smoothedSceneDepth)
        }
        // 4K-keyframes (Polycam-klassen) der ARKit støtter det: kildeoppløsningen var det
        // harde kvalitetstaket for teksturbaken (1920-video → færre kildepiksler enn atlas-texels).
        if #available(iOS 16.0, *),
           let fmt4k = ARWorldTrackingConfiguration.recommendedVideoFormatFor4KResolution {
            config.videoFormat = fmt4k
            kfTargetWidth = 3840
        }
        arConfig = config
        sceneView.scene.rootNode.addChildNode(ghostRoot)
        sceneView.session.run(config)

        // AE/AWB-LÅS (scan #5-lærdom): auto-eksponeringen drev >±25 % mellom keyframes i én
        // og samme feiing (gain-solveren slo i begge klemmene) — DET er lappeteppet på hvite
        // vegger. Lås etter 1,5 s innmåling så alle keyframes deler én eksponering/fargetone.
        // Post-hoc gain-utjevning består som sikkerhetsnett for scener der låsen bommer.
        if #available(iOS 16.0, *) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard self != nil,
                      let device = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera else { return }
                do {
                    try device.lockForConfiguration()
                    // EKSPONERINGSTAK (2026-09-10). Låsen frøs det auto-eksponeringen tilfeldigvis
                    // hadde landet på, og innendørs er det gjerne 1/30 s. MÅLT på et ekte skann:
                    // median predikert bevegelsesuskarphet 14,8 px i et 3840-bilde, 50 % over 15 px,
                    // p90 25,8. På en vegg som fyller bildet er 15 px ≈ 8 mm smøring — et panelspor
                    // er 2 mm bredt. Det er derfor kildebildene våre bærer mindre skarphet per
                    // piksel enn referansens (§72), og hverken atlas eller sømlogikk kan hente det inn.
                    // Total lysmengde holdes: lukkertiden kortes ned så langt ISO-en har takhøyde,
                    // og ikke lenger. Er rommet for mørkt til hele veien, tas det som er mulig.
                    // Støy er høyfrekvent og midles bort av topp-K-snittet i baken; smøring er tapt.
                    // meshscan.eksponeringstak = ms (0 = gammel oppførsel, bare lås).
                    let takMs = MeshScanPresenter.eksponeringstakMs
                    let naaMs = Float(CMTimeGetSeconds(device.exposureDuration) * 1000)
                    let (nyMs, nyIso) = MeshScanPresenter.kortereEksponering(
                        naaMs: naaMs, naaIso: device.iso, takMs: takMs,
                        maksIso: device.activeFormat.maxISO,
                        minMs: Float(CMTimeGetSeconds(device.activeFormat.minExposureDuration) * 1000))
                    if let nyMs, let nyIso, device.isExposureModeSupported(.custom) {
                        device.setExposureModeCustom(
                            duration: CMTimeMakeWithSeconds(Double(nyMs) / 1000, preferredTimescale: 1_000_000),
                            iso: nyIso, completionHandler: nil)
                        MeshLog.log(String(format: "eksponeringstak — %.1f ms ISO %.0f → %.1f ms ISO %.0f",
                                           naaMs, device.iso, nyMs, nyIso))
                    } else if device.isExposureModeSupported(.locked) {
                        device.exposureMode = .locked
                    }
                    if device.isWhiteBalanceModeSupported(.locked) { device.whiteBalanceMode = .locked }
                    device.unlockForConfiguration()
                    self?.aeLockTime = CACurrentMediaTime() // samme klokkedomene som ARFrame.timestamp
                    // Celler som rakk å bli FERDIG før låsen er stemplet på frames baken selv
                    // mistror (preLock vektes 0,6 i vinnervalget) — og doneCells vokser monotont,
                    // så uten dette kan de aldri fikses ved å gå tilbake. Nullstilling her er
                    // nesten gratis: låsen slår inn 1,5 s ut i skannet, så settet er lite.
                    if let n = self?.doneCells.count, n > 0 {
                        self?.doneCells.removeAll(keepingCapacity: true)
                        self?.cellCache.tilstand.removeAll(keepingCapacity: true)
                        self?.cellCache.laast.removeAll(keepingCapacity: true)
                        self?.cellCache.sterke.removeAll(keepingCapacity: true)
                        self?.cellCache.alpha.removeAll(keepingCapacity: true)
                        self?.lastSnaps.removeAll(keepingCapacity: true)
                        MeshLog.log("AE/AWB låst — \(n) pre-lås-celler åpnet igjen")
                    } else {
                        MeshLog.log("AE/AWB låst etter innmåling")
                    }
                } catch {
                    MeshLog.log("AE/AWB-lås feilet: \(error.localizedDescription)")
                }
            }
        }

        // Kamera-passthrough + ÉN-FARGES wireframe KUN over teksturert flate (brukerdesign
        // 2026-08-13): rutenettet betyr «ferdig — låst, får aldri ny tekstur». Der kameraet
        // synes rent er det utekstuert — gå dit. Samme predikat driver én-skann-porten, så
        // visningen ER kontrakten. Nodene eies av ARSCNView (se renderer(_:didAdd:for:)).

        // Keyframe capture dir for texture baking (step 1).
        let sessionId = "\(companyId)-\(roomId)-\(Int(Date().timeIntervalSince1970 * 1000))"
            .replacingOccurrences(of: "/", with: "_")
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("scan-frames/\(sessionId)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        framesDir = dir
        // Rydd gamle sesjoner: frames-mappene ble aldri slettet, og med 4K-keyframes vokser de
        // ~0,5-1 GB per skann. Behold de to nyeste (denne + forrige, for evt. splat-trening/debug).
        let framesRoot = docs.appendingPathComponent("scan-frames", isDirectory: true)
        DispatchQueue.global(qos: .utility).async {
            guard let entries = try? FileManager.default.contentsOfDirectory(
                at: framesRoot, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
            let sorted = entries.sorted {
                let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return a > b
            }
            for old in sorted.dropFirst(2) where old.lastPathComponent != dir.lastPathComponent {
                try? FileManager.default.removeItem(at: old)
                NSLog("[MeshScan] pruned old scan-frames session: \(old.lastPathComponent)")
            }
        }

        // ── Bottom toolbar (frosted glass) ────────────────────────────────────
        let toolbar = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        host.view.addSubview(toolbar)

        let hint = UILabel()
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.text = MeshScanPresenter.defaultHint
        hint.textColor = UIColor.white.withAlphaComponent(0.8)
        hint.font = .systemFont(ofSize: 13, weight: .medium)
        hint.numberOfLines = 0
        hint.textAlignment = .center
        toolbar.contentView.addSubview(hint)
        hintLabel = hint

        let cancelBtn = UIButton(type: .custom)
        cancelBtn.translatesAutoresizingMaskIntoConstraints = false
        cancelBtn.setTitle("Avbryt", for: .normal)
        cancelBtn.setTitleColor(UIColor.white.withAlphaComponent(0.65), for: .normal)
        cancelBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .regular)
        cancelBtn.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        toolbar.contentView.addSubview(cancelBtn)

        let doneBtn = UIButton(type: .custom)
        doneBtn.translatesAutoresizingMaskIntoConstraints = false
        doneBtn.setTitle("Skann mer", for: .normal)
        doneBtn.setTitleColor(UIColor.white.withAlphaComponent(0.35), for: .disabled)
        doneBtn.setTitleColor(.white, for: .normal)
        doneBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        doneBtn.backgroundColor = UIColor(white: 1, alpha: 0.12)
        doneBtn.layer.cornerRadius = 22
        doneBtn.contentEdgeInsets = UIEdgeInsets(top: 12, left: 28, bottom: 12, right: 28)
        doneBtn.isEnabled = false
        doneBtn.alpha = 0.5
        doneBtn.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
        toolbar.contentView.addSubview(doneBtn)
        doneButton = doneBtn

        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
            toolbar.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
            toolbar.topAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.bottomAnchor, constant: -96),

            hint.topAnchor.constraint(equalTo: toolbar.contentView.topAnchor, constant: 12),
            hint.leadingAnchor.constraint(equalTo: toolbar.contentView.leadingAnchor, constant: 16),
            hint.trailingAnchor.constraint(equalTo: toolbar.contentView.trailingAnchor, constant: -16),

            cancelBtn.leadingAnchor.constraint(equalTo: toolbar.contentView.leadingAnchor, constant: 20),
            cancelBtn.topAnchor.constraint(equalTo: hint.bottomAnchor, constant: 12),

            doneBtn.trailingAnchor.constraint(equalTo: toolbar.contentView.trailingAnchor, constant: -20),
            doneBtn.centerYAnchor.constraint(equalTo: cancelBtn.centerYAnchor),
        ])

        // ── Top coverage pill (frosted glass) ─────────────────────────────────
        func makeDot(_ rgb: SIMD3<Float>) -> UIView {
            let d = UIView()
            d.translatesAutoresizingMaskIntoConstraints = false
            d.backgroundColor = UIColor(red: CGFloat(rgb.x), green: CGFloat(rgb.y), blue: CGFloat(rgb.z), alpha: 1)
            d.layer.cornerRadius = 4
            d.widthAnchor.constraint(equalToConstant: 8).isActive = true
            d.heightAnchor.constraint(equalToConstant: 8).isActive = true
            return d
        }
        func makeLegendLabel(_ text: String) -> UILabel {
            let l = UILabel()
            l.text = text
            l.textColor = UIColor.white.withAlphaComponent(0.75)
            l.font = .systemFont(ofSize: 12, weight: .medium)
            return l
        }
        let pctLabel = UILabel()
        pctLabel.text = "0%"
        pctLabel.textColor = .white
        pctLabel.font = .systemFont(ofSize: 17, weight: .bold)
        percentLabel = pctLabel

        let divider = UIView()
        divider.translatesAutoresizingMaskIntoConstraints = false
        divider.backgroundColor = UIColor.white.withAlphaComponent(0.25)
        divider.widthAnchor.constraint(equalToConstant: 1).isActive = true
        divider.heightAnchor.constraint(equalToConstant: 14).isActive = true

        let legendStack = UIStackView(arrangedSubviews: [
            pctLabel, divider,
            makeDot(MeshScanPresenter.stripeRed), makeLegendLabel("Striper = mangler bilde"),
        ])
        legendStack.axis = .horizontal
        legendStack.spacing = 6
        legendStack.alignment = .center
        legendStack.setCustomSpacing(10, after: pctLabel)
        legendStack.setCustomSpacing(10, after: divider)
        legendStack.translatesAutoresizingMaskIntoConstraints = false

        let legendBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        legendBlur.translatesAutoresizingMaskIntoConstraints = false
        legendBlur.layer.cornerRadius = 22
        legendBlur.clipsToBounds = true
        legendBlur.contentView.addSubview(legendStack)
        host.view.addSubview(legendBlur)

        NSLayoutConstraint.activate([
            legendBlur.topAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.topAnchor, constant: 10),
            legendBlur.centerXAnchor.constraint(equalTo: host.view.centerXAnchor),
            legendStack.topAnchor.constraint(equalTo: legendBlur.contentView.topAnchor, constant: 10),
            legendStack.bottomAnchor.constraint(equalTo: legendBlur.contentView.bottomAnchor, constant: -10),
            legendStack.leadingAnchor.constraint(equalTo: legendBlur.contentView.leadingAnchor, constant: 16),
            legendStack.trailingAnchor.constraint(equalTo: legendBlur.contentView.trailingAnchor, constant: -16),
        ])

        // ── Gest-veiledning: tegnet telefon-glyf som DEMONSTRERER bevegelsen ──
        let guideCard = GestureGuideView()
        guideCard.isHidden = true
        host.view.addSubview(guideCard)
        NSLayoutConstraint.activate([
            guideCard.topAnchor.constraint(equalTo: legendBlur.bottomAnchor, constant: 10),
            guideCard.centerXAnchor.constraint(equalTo: host.view.centerXAnchor),
        ])
        guideView = guideCard

        hostingController = host
        presenter.present(host, animated: true)

        // Recolour the mesh by coverage once per second (compute is off-thread).
        coverageTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.updateCoverageTick()
        }
    }

    @objc private func cancelTapped() {
        finish(.failure(MeshScanError.cancelled))
    }

    @objc private func doneTapped() {
        let anchors = (sceneView.session.currentFrame?.anchors ?? []).compactMap { $0 as? ARMeshAnchor }
        sceneView.session.pause()
        // Dekningsfargingen SKAL dø her, ikke i finish(). Sesjonen er pauset, men
        // `currentFrame` gir fortsatt den siste ramma, så tikken fortsatte å regne
        // på et frosset bilde gjennom hele bakingen: målt 2,4 s CPU per pass i 17
        // minutter (pipeline.log 2026-09-05), rett i konkurranse med baken den
        // stjeler fra — og telefonen ble varmere, som struper baken enda mer.
        coverageTimer?.invalidate()
        coverageTimer = nil
        writeKeyframesManifest()
        // Only metadata is accumulated during capture; serialize after pending saves.
        captureQueue.sync {
            if let dir = framesDir {
                do { try captureDecisionAudit.data().write(to: dir.appendingPathComponent("capture-decisions.json"), options: .atomic) }
                catch { MeshLog.log("opptakslogg kunne ikke lagres: \(error.localizedDescription)") }
            }
        }
        NSLog("[MeshScan] colour diag — framesProcessed=\(sampleFramesProcessed) vertsConsidered=\(sampleVertsConsidered) rejectedBehind=\(sampleRejectedBehind) rejectedOffscreen=\(sampleRejectedOffscreen) hits=\(sampleHits) voxelsFilled=\(colorAccum.count) keyframes=\(keyframes.count) framesDir=\(framesDir?.lastPathComponent ?? "nil")")
        MeshLog.log("porten — \(gateRejected) frames avvist totalt, \(doneCells.count) ferdig-celler")
        // Erstatningsbufferets fasit: `nye` = distinkte ståsteder, `erstattet` = gjenbesøk som
        // faktisk forbedret plassen sin, `ikke bedre` = gjenbesøk som tapte mot det som lå der.
        // Er `erstattet` + `ikke bedre` ~0 over flere runder, treffer ikke bøttene hverandre og
        // den anker-lokale nøkkelen er feil — da hjelper ikke flere runder.
        let (n, r, w) = captureQueue.sync { (kfNew, kfReplaced, kfNotBetter) }
        captureQueue.sync { self.denseClosed = true; try? denseHandle?.close(); denseHandle = nil }
        MeshLog.log("tett dybdelogg — \(denseCount) rå dybdekart lagret (super-res-råstoff)")
        MeshLog.log("dekningstvangen — \(noveltyForced) fangster tvunget av ufotografert sikt (>30 %), \(intervalForced) forbi minsteintervallet (>25 %)")
        MeshLog.log("fartsporten — \(tooFastRejected) rammer sluppet (grense 1,1 m/s / 2,0 rad/s)")
        // Kalibreringsdata for uskarphetsporten: 60 px-grensa er satt i blinde — snitt/maks
        // herfra på ekte skann (via pipeline.log) er det som skal justere den.
        let avgBlur = blurStatN > 0 ? Float(blurStatSum / Double(blurStatN)) : 0
        MeshLog.log(String(format: "uskarphetsporten — %d rammer sluppet (grense %.0f px); predikert uskarphet snitt %.1f / maks %.1f px, eksponering %.1f ms ved slutt", blurRejected, blurGatePx, avgBlur, blurStatMax, lastExposureMs))
        MeshLog.log("erstatningsbuffer — \(n) nye bøtter, \(r) erstattet, \(w) ikke bedre (kadens \(bucketCadence)s)")
        if anchors.isEmpty {
            finish(.failure(MeshScanError.noMeshData))
            return
        }
        // Baking can take many seconds — run it off the main thread with a progress overlay so the
        // watchdog never kills us and the UI stays responsive.
        showBuildingOverlay()
        // ── FRIGJØR AR-SESJONEN FØR BAKEN (2026-09-11, §84). Skann og bake skal være ÉN ting,
        // ikke to steg — og da må live-baken få samme budsjett som «Bygg om modellen».
        // Sesjonen var bare pauset: ARSCNView eide fortsatt en SceneKit-node med full geometri
        // per anker, og ARKit sine egne buffere lå i minnet gjennom hele baken. Det presset
        // headroom ned i 1700–2000 MB-sjiktet, som gir atlas 6144 og 160 bilder i stedet for
        // 8192 og 200 (MeshBakeV2 budsjett-trappa) — altså en dårligere modell enn samme
        // opptak ville fått ved ombygging. Ankrene er alt hentet ut over og lever videre;
        // det som slippes er visningen av dem.
        sceneView?.session.delegate = nil
        sceneView?.delegate = nil
        sceneView?.scene.rootNode.childNodes.forEach { $0.removeFromParentNode() }
        coverageNodes.removeAll()
        veil = nil
        hostingController?.view.backgroundColor = .black   // teppet ligger nå over tomrom, ikke frosset kamerabilde
        sceneView?.removeFromSuperview()
        sceneView = nil
        // Fase-rapportering fra eksporten → overlay-teksten («Pakker UV-atlas…» osv.)
        ARMeshGlbExporter.progress = { [weak self] msg in
            DispatchQueue.main.async { self?.buildingLabel?.text = msg }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let result = try self.export(anchors: anchors)
                DispatchQueue.main.async { self.finish(.success(result)) }
            } catch {
                DispatchQueue.main.async { self.finish(.failure(error)) }
            }
        }
    }

    private func showBuildingOverlay() {
        guard let host = hostingController, host.isViewLoaded else { return }
        let overlay = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        overlay.frame = host.view.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        overlay.contentView.addSubview(spinner)
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "Bygger 3D-modell…"
        label.textColor = UIColor.white.withAlphaComponent(0.9)
        label.font = .systemFont(ofSize: 16, weight: .semibold)
        overlay.contentView.addSubview(label)
        buildingLabel = label
        // Live RAM under fase-teksten: footprint (jetsam-metrikken) + faktisk headroom fra OS-et.
        let ram = UILabel()
        ram.translatesAutoresizingMaskIntoConstraints = false
        ram.textColor = UIColor.white.withAlphaComponent(0.55)
        ram.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        overlay.contentView.addSubview(ram)
        ramLabel = ram
        ramTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            let usedMB = MeshScanPresenter.memoryFootprintMB()
            let freeMB = os_proc_available_memory() / (1024 * 1024)
            self?.ramLabel?.text = "RAM \(usedMB) MB · ledig \(freeMB) MB"
        }
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: overlay.contentView.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: overlay.contentView.centerYAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 16),
            label.centerXAnchor.constraint(equalTo: overlay.contentView.centerXAnchor),
            ram.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 6),
            ram.centerXAnchor.constraint(equalTo: overlay.contentView.centerXAnchor),
        ])
        host.view.addSubview(overlay)
    }

    /// phys_footprint — det jetsam faktisk feller appen på (samme tall som Xcodes memory gauge).
    static func memoryFootprintMB() -> Int {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<Int32>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }
        return Int(info.phys_footprint / (1024 * 1024))
    }

    // MARK: - Camera colour sampling
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        updateSpeedHint(frame)       // updates lastLinSpeed/lastAngSpeed first
        // Dekningsfeltet: annenhver ramme, kun ved normal sporing. Vekten er rammens
        // kvalitet (0 når den er sløret — samme dom som keyframe-porten), så feltet
        // og baken snakker om de samme bildene.
        feltTikk &+= 1
        if feltTikk % 2 == 0, let felt = MeshScanPresenter.coverageField, case .normal = frame.camera.trackingState,
           let sd = frame.smoothedSceneDepth ?? frame.sceneDepth,
           let d = MeshScanPresenter.tightDepth(sd.depthMap, confidence: sd.confidenceMap) {
            let m = frame.camera.transform
            felt.forankre(SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z))
            let q = max(0, 1 - predictedBlurPx(frame) / max(blurGatePx, 1))
            let K = frame.camera.intrinsics, res = frame.camera.imageResolution
            let sx = Float(d.width) / Float(res.width), sy = Float(d.height) / Float(res.height)
            felt.splat(depth: d.data, w: d.width, h: d.height,
                       fx: K[0][0] * sx, fy: K[1][1] * sy, cx: K[2][0] * sx, cy: K[2][1] * sy,
                       c2w: m, w0: q, image: frame.capturedImage)
        }
        // SLØRET: hele skjermen er rødstripet til du har malt den bort. Oppdateres
        // HVER ramme — det er dette du styrer etter mens du skanner.
        if veil == nil, let pov = sceneView?.pointOfView {
            veil = CoverageVeil(library: MeshScanPresenter.coverageLibrary, felt: MeshScanPresenter.coverageField)
            if let v = veil { pov.addChildNode(v.node) }
        }
        if let v = veil, let sv = sceneView {
            let o = sv.window?.windowScene?.interfaceOrientation ?? .portrait
            v.oppdater(frame: frame, felt: MeshScanPresenter.coverageField, viewport: sv.bounds.size, orientering: o)
        }
        // Pose-historikk til veiledningen (billig; trimmes til ~5 s i deteksjonen)
        let cm = frame.camera.transform
        poseHistory.append((frame.timestamp,
                            SIMD3<Float>(cm.columns.3.x, cm.columns.3.y, cm.columns.3.z),
                            atan2(-cm.columns.2.z, -cm.columns.2.x)))
        if poseHistory.count > 400 { poseHistory.removeFirst(poseHistory.count - 400) }
        maybeCaptureKeyframe(frame)
        maybeRecordDenseDepth(frame)
        frameCounter += 1
        if frameCounter % 6 != 0 { return } // throttle — sampling is the heavy part
        let anchors = frame.anchors.compactMap { $0 as? ARMeshAnchor }
        if anchors.isEmpty { return }
        sampleFramesProcessed += 1

        let pixelBuffer = frame.capturedImage
        let camera = frame.camera
        let res = camera.imageResolution
        guard CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly) == kCVReturnSuccess else { return }
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard
            let yBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0),
            let cbcrBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 1)
        else { return }
        let yStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
        let cbcrStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 1)
        let yPtr = yBase.assumingMemoryBound(to: UInt8.self)
        let cbcrPtr = cbcrBase.assumingMemoryBound(to: UInt8.self)
        let w = Int(res.width)
        let h = Int(res.height)
        let invCam = simd_inverse(camera.transform)

        // Delegaten kjører på MAIN (ARSCNView): arbeidet her MÅ være konstant, ellers fryser
        // wireframe/UI når meshet vokser (~1 min inn i skannet). Fast verteksbudsjett per pass,
        // rund-robin over anchors så alle får farge over tid — sampling er statistisk uansett.
        var budget = 16_000
        var ai = sampleCursor % anchors.count
        var visited = 0
        while budget > 0 && visited < anchors.count {
            let anchor = anchors[ai]
            visited += 1
            ai = (ai + 1) % anchors.count
            let geom = anchor.geometry
            let vBuf = geom.vertices.buffer.contents()
            let vStride = geom.vertices.stride
            let vOffset = geom.vertices.offset
            let count = geom.vertices.count
            var i = 0
            while i < count {
                budget -= 1
                if budget <= 0 { break }
                let vp = les3Float(vBuf, vOffset + i * vStride)
                let world4 = anchor.transform * SIMD4<Float>(vp.x, vp.y, vp.z, 1)
                let world = SIMD3<Float>(world4.x, world4.y, world4.z)
                sampleVertsConsidered += 1
                // In camera space ARKit looks down -z; keep points in front.
                let cam = invCam * world4
                if cam.z > -0.05 { sampleRejectedBehind += 1; i += 4; continue }
                let pt = camera.projectPoint(world, orientation: .landscapeRight, viewportSize: res)
                let px = Int(pt.x), py = Int(pt.y)
                if px >= 0, px < w, py >= 0, py < h {
                    sampleHits += 1
                    let yv = Float(yPtr[py * yStride + px])
                    let cIdx = (py / 2) * cbcrStride + (px / 2) * 2
                    let cb = Float(cbcrPtr[cIdx]) - 128
                    let cr = Float(cbcrPtr[cIdx + 1]) - 128
                    let r = max(0, min(255, yv + 1.402 * cr)) / 255
                    let g = max(0, min(255, yv - 0.344 * cb - 0.714 * cr)) / 255
                    let b = max(0, min(255, yv + 1.772 * cb)) / 255
                    let key = MeshScanPresenter.voxelKey(world)
                    let prev = colorAccum[key] ?? SIMD4<Float>(0, 0, 0, 0)
                    colorAccum[key] = SIMD4<Float>(prev.x + r, prev.y + g, prev.z + b, prev.w + 1)
                } else {
                    sampleRejectedOffscreen += 1
                }
                i += 4
            }
        }
        sampleCursor = ai
    }

    /// Predikert bevegelsesuskarphet i LAGREDE piksler: (vinkelfart + linfart/1,5 m nominell
    /// dybde) × eksponeringstid × brennvidde. Fartstersklene alene er eksponerings-BLINDE:
    /// i et mørkt rom med lang (AE-låst) eksponeringstid smører 0,5 rad/s titalls piksler,
    /// i godt lys nesten ingenting. Fysikken, ikke farten, er dommeren.
    private func predictedBlurPx(_ frame: ARFrame) -> Float {
        let exposure = Float(frame.camera.exposureDuration)
        let fullW = Float(frame.camera.imageResolution.width)
        let scale = fullW > 0 ? min(1, Float(kfTargetWidth) / fullW) : 1
        let fx = frame.camera.intrinsics[0][0] * scale
        return (lastAngSpeed + lastLinSpeed / 1.5) * exposure * fx
    }

    /// En bedre kandidat fra samme ståsted må nå erstatningsbufferet. Ellers låser
    /// bevegelsesporten inn det første bildet, selv når neste videoramme er skarpere.
    /// Estimatet åpner bare porten; faktisk bildeskarphet avgjør fortsatt erstatningen.
    /// Dekningsunntak fra minsteintervallet (2026-09-09). MÅLT på soveromsbundelen: 1,92 m²
    /// av flaten ble sett av dybdekameraet — median 9 dybdebilder — men havnet ikke i ETT
    /// ENESTE lagret foto, og i baken er den flaten uten tekstur. I samme skann ble 480 av
    /// 1063 fangstbeslutninger avvist av nettopp «minimum_interval».
    /// Porten på 0,2 s er riktig for et rolig sveip, men en panorering over en ufotografert
    /// vegg rekker ikke å legge igjen ett bilde per bøtte før den er forbi. Når det meste av
    /// synsfeltet er ufotografert, skal intervallet vike.
    /// Vaktene: aldri raskere enn 0,08 s (12 Hz tak på 4K-kopier), aldri på et bilde som er
    /// sløret forbi uskarphetsporten, og fartsporten står urørt etter dette.
    /// Dekningsoverlegget bruker DYBDE og blir grønt her uansett — brukeren får altså ikke
    /// vite at bildet manglet. Det er derfor unntaket må ligge i fangsten, ikke i veiledningen.
    /// Lukkertid-taket i millisekunder. 8 ms (1/125 s) er valgt mot MÅLT kamerafart: medianen
    /// i et ekte skann er 0,42 m/s, og på 1,5 m avstand med 3840 px over ~60° synsfelt gir
    /// 8 ms rundt 4 px smøring mot 15 px ved 1/30 s. 0 slår av taket.
    static var eksponeringstakMs: Float {
        let d = UserDefaults.standard
        if let s = d.string(forKey: "meshscan.eksponeringstak"), let v = Float(s) { return v }
        if let n = d.object(forKey: "meshscan.eksponeringstak") as? Double { return Float(n) }
        return 8
    }

    /// Kortere lukkertid, samme lysmengde. Returnerer nil når det ikke er noe å hente
    /// (taket er av, eksponeringen er alt kort nok, eller ISO har ingen takhøyde) — da
    /// beholder kalleren den vanlige låsen. ISO skaleres nøyaktig med tidsforholdet, så
    /// bildet blir like lyst; er ikke ISO-takhøyden nok, kortes tiden bare så langt den rekker.
    static func kortereEksponering(naaMs: Float, naaIso: Float, takMs: Float,
                                   maksIso: Float, minMs: Float) -> (Float?, Float?) {
        guard takMs > 0, naaMs.isFinite, naaIso.isFinite, maksIso.isFinite, minMs.isFinite,
              naaMs > 0, naaIso > 0, maksIso >= naaIso, minMs >= 0 else { return (nil, nil) }
        guard naaMs > takMs else { return (nil, nil) }          // alt kort nok
        let ønsket = naaMs / takMs                              // hvor mye kortere vi vil ha den
        let takhøyde = maksIso / naaIso                         // hvor mye ISO kan bære
        let faktor = min(ønsket, takhøyde)
        guard faktor > 1.05 else { return (nil, nil) }          // under 5 % er ikke verdt et moduskifte
        let nyMs = max(minMs, naaMs / faktor)
        let nyIso = min(maksIso, naaIso * (naaMs / nyMs))
        guard nyMs.isFinite, nyIso.isFinite, nyMs > 0 else { return (nil, nil) }
        return (nyMs, nyIso)
    }

    static func shouldOverrideInterval(sinceLast: Double, novelty: Float,
                                       blurPx: Float, blurGatePx: Float) -> Bool {
        guard sinceLast.isFinite, sinceLast >= 0.08 else { return false }
        guard novelty.isFinite, novelty > 0.25 else { return false }
        guard blurGatePx.isFinite, blurGatePx > 0 else { return false }
        guard blurPx.isFinite, blurPx >= 0, blurPx <= blurGatePx else { return false }
        return true
    }

    static func shouldRetrySharperFrame(previousBlur: Float?, currentBlur: Float) -> Bool {
        guard let previousBlur, previousBlur.isFinite, currentBlur.isFinite,
              previousBlur > 2, currentBlur >= 0 else { return false }
        return currentBlur < previousBlur * 0.75
    }

    /// Felles kvalitetsrangering — brukes av erstatningsbufferet (fangst), dekningsutvalget
    /// (ARMeshGlbExporter.selectCoverageAware) og bake-vinnervalget (MeshBakeV2), som MÅ
    /// rangere likt. Tenengrad-skarphet dempet av fart OG predikert eksponerings-uskarphet:
    /// i mørke rom blåser sensorstøy opp gradient-energien slik at en støyete, uskarp ramme
    /// kan slå en ren — blurPx er innholds- og støyuavhengig og korrigerer akkurat det.
    /// nil blurPx (eldre fixtures) = faktor 1 → gamle bundles rangerer og baker som før.
    static func kfQuality(sharpness: Float, motion: Float, blurPx: Float?) -> Float {
        sharpness / (1 + 2 * motion) / (1 + max(0, blurPx ?? 0) / 30)
    }

    // Warn the user (and improve capture) when the phone moves/rotates too fast → motion blur.
    private func updateSpeedHint(_ frame: ARFrame) {
        let m = frame.camera.transform
        let pos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        let fwd = simd_normalize(SIMD3<Float>(-m.columns.2.x, -m.columns.2.y, -m.columns.2.z))
        let now = frame.timestamp
        defer { lastMotionPos = pos; lastMotionFwd = fwd; lastMotionTime = now }
        guard let lp = lastMotionPos, let lf = lastMotionFwd, lastMotionTime > 0 else { return }
        let dt = Float(now - lastMotionTime)
        if dt <= 0 { return }
        let linSpeed = simd_distance(lp, pos) / dt                       // m/s
        let angSpeed = acos(max(-1, min(1, simd_dot(lf, fwd)))) / dt      // rad/s
        lastLinSpeed = linSpeed                                          // reused to reject blurry keyframes
        lastAngSpeed = angSpeed
        let blurPx = predictedBlurPx(frame)
        lastExposureMs = Float(frame.camera.exposureDuration) * 1000
        blurStatSum += Double(blurPx); blurStatN += 1; blurStatMax = max(blurStatMax, blurPx)
        // Varselet slår også inn når PREDIKERT uskarphet passerer 40 % av portgrensa — i mørke
        // rom skjer det ved langt lavere fart enn de rå fartstersklene (som består som gulv).
        let tooFast = linSpeed > 0.7 || angSpeed > 1.2 || blurPx > blurGatePx * 0.4 // ~70°/s

        if tooFast == wasTooFast { return }
        wasTooFast = tooFast
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let label = self.hintLabel else { return }
            // En sesjonsadvarsel er viktigere enn fartshintet — ikke overskriv den.
            if self.sessionTrouble { return }
            label.text = tooFast ? "Beveg telefonen saktere" : MeshScanPresenter.defaultHint
            label.textColor = tooFast ? .systemYellow : .white
        }
    }

    // MARK: - Keyframe capture (texture-baking step 1)
    // Decision + a fast pixel-buffer copy happen on the AR delegate; the heavy JPEG encode + disk
    // write run on captureQueue so we never hold an ARFrame (avoids the "retaining ARFrames" stall).
    private func maybeCaptureKeyframe(_ frame: ARFrame) {
        // Taket håndheves nå på captureQueue mot ANTALL LAGREDE bøtter, ikke mot antall forsøk:
        // med erstatning vokser ikke lagringen av gjenbesøk, så et forsøkstak ville stoppet
        // fangsten på runde 2 uten grunn (og det var nettopp først-til-mølla-feilen).
        guard framesDir != nil else { return }
        var auditReason = "dispatch"
        var auditBucket: Int64?
        defer {
            captureDecisionAudit.record(time: frame.timestamp, reason: auditReason,
                bucket: auditBucket, blur: predictedBlurPx(frame), motion: lastLinSpeed + 0.5 * lastAngSpeed)
        }
        guard case .normal = frame.camera.trackingState else { auditReason = "tracking"; return }

        let t = frame.timestamp
        let cam = frame.camera
        let m = cam.transform
        let pos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        let fwd = simd_normalize(SIMD3<Float>(-m.columns.2.x, -m.columns.2.y, -m.columns.2.z))

        if lastKeyframeTime >= 0 {
            if t - lastKeyframeTime < MeshScanPresenter.keyframeMinInterval {
                // Dekningsunntak. frameNovelty er et sparsomt 16×12-dybdegrid, men ikke gratis
                // på 60 Hz — taktes til 10 Hz, som er raskere enn dekningstvangens 2 Hz fordi
                // dette gjelder mens kameraet FLYTTER seg forbi flaten.
                var slippGjennom = false
                if t - lastIntervalProbe > 0.1 {
                    lastIntervalProbe = t
                    if let nov = frameNovelty(frame) {
                        slippGjennom = MeshScanPresenter.shouldOverrideInterval(
                            sinceLast: t - lastKeyframeTime, novelty: nov,
                            blurPx: predictedBlurPx(frame), blurGatePx: blurGatePx)
                    }
                }
                guard slippGjennom else { auditReason = "minimum_interval"; return }
                auditReason = "interval_novelty_override"
                intervalForced += 1
            }
            let moved = lastKeyframePos.map { simd_distance($0, pos) } ?? .greatestFiniteMagnitude
            let rotDot = lastKeyframeFwd.map { simd_dot($0, fwd) } ?? -1
            let sharperRetry = MeshScanPresenter.shouldRetrySharperFrame(
                previousBlur: lastKeyframeBlurPx, currentBlur: predictedBlurPx(frame))
            if moved < MeshScanPresenter.keyframeMinMove && rotDot > MeshScanPresenter.keyframeMinRotateDot && !sharperRetry {
                // DEKNINGSTVANG (grå-funn 2026-08-27, replay på device-bundle: 907 av 1040
                // grå flater lå aldri inne i NOE foto — LiDAR-meshen vokser bredere enn
                // fotodekningen). Dveler man foran en ufotografert flate uten å flytte seg
                // >12 cm eller snu >8°, avviser denne porten HVER frame for alltid, og
                // flaten forblir grå uansett hvor lenge man peker på den. Er >30 % av
                // synsfeltet ufotografert (frameNovelty mot doneCells = keyframe-dekkede
                // celler), tving fangsten gjennom. Sjekken taktes til 2 Hz — frameNovelty
                // er et sparsomt 16×12-dybdegrid, men ikke gratis på 60 Hz.
                guard t - lastNoveltyForce > 0.5 else { auditReason = "move_rotate_retry_interval"; return }
                lastNoveltyForce = t
                guard let nov = frameNovelty(frame), nov > 0.30 else { auditReason = "move_rotate_no_novelty"; return }
                noveltyForced += 1
            }
        }

        // Fartsporten (løsnet 2026-08-23: 0,8/1,4 → 1,1/2,0). Den harde avvisningen ble satt da
        // bufferet var FØRST-TIL-MØLLA: en uskarp ramme okkuperte plassen sin for godt, så det
        // var riktig å nekte den. Erstatningsbufferet snudde det — hver bøtte holder ÉN plass og
        // bytter den ut mot enhver senere ramme som scorer 15 % bedre på `skarphet/(1+2·fart)`.
        // En uskarp ramme kan altså ikke lenger fortrenge en skarp; den blir enten erstattet, eller
        // så er den det ENESTE bildet av den synsvinkelen — og da slår uskarpt tomt.
        // Målt på Tormods egen bundle (145 frames): median skarphet faller bare til 0,87× ved
        // fart 0,6–0,8 og 0,73× over 0,8 — en helling, ikke en klippekant. Kostnaden ved å slippe
        // dem inn er liten, gevinsten er at man kan snu hodet mens man går uten stille bildetap.
        // Varselet står igjen på 0,7/1,2, altså med god margin FØR noe faktisk mistes.
        if lastLinSpeed > 1.1 || lastAngSpeed > 2.0 {
            auditReason = "speed"
            tooFastRejected += 1
            return
        }

        // ── PORTEN. Erstatningsbufferet (se `bucketSlot`) gjør gjenbesøk trygt: en ny vinkel på
        // ferdig flate konkurrerer nå om SIN EGEN bøtte i stedet for å fortynne et felles
        // budsjett. Porten nekter derfor ikke lenger gjenbesøk — den begrenser bare kadensen
        // per bøtte, så captureQueue ikke oversvømmes av 4K-kopier (regel 8).
        // Uten mesh-anker (aller tidligst i skannet) finnes ingen driftsinvariant bøtte, og vi
        // faller tilbake på den gamle nyhetsporten.
        var nearestAnchor: ARMeshAnchor? = nil
        var bucket: Int64? = nil
        if let nearest = frame.anchors.compactMap({ $0 as? ARMeshAnchor }).min(by: {
            simd_distance_squared(SIMD3($0.transform.columns.3.x, $0.transform.columns.3.y, $0.transform.columns.3.z), pos) <
            simd_distance_squared(SIMD3($1.transform.columns.3.x, $1.transform.columns.3.y, $1.transform.columns.3.z), pos)
        }) {
            let b = MeshScanPresenter.viewBucket(anchorID: nearest.identifier.uuidString,
                                                 rel: simd_inverse(nearest.transform) * m)
            auditBucket = b
            // Én dispatch per bøtte per `bucketCadence`: nok til at bøtta får kandidater å
            // velge mellom, lite nok til at captureQueue ikke bygger kø av 4K-kopier.
            if let last = bucketLastDispatch[b], t - last < bucketCadence {
                auditReason = "bucket_cadence"
                gateRejected += 1
                return
            }
            // Uskarphetsporten: eksponerings-VEKTET avvisning, kun for bøtter som alt har fått
            // en dispatch — «uskarpt slår tomt» består, første blikk på en flate slipper alltid
            // gjennom. Avvisningen bruker IKKE kadens-slotten (bucketLastDispatch settes bare
            // ved dispatch), så neste roligere ramme får sjansen umiddelbart i stedet for at en
            // smurt kandidat okkuperer bøttas 0,4 s og må slås med 15 % hysterese etterpå.
            if bucketLastDispatch[b] != nil, predictedBlurPx(frame) > blurGatePx {
                auditReason = "blur"
                blurRejected += 1
                return
            }
            nearestAnchor = nearest
            bucket = b
        } else if !doneCells.isEmpty {
            if t - lastNoveltyCheck < 0.15 { auditReason = "no_anchor_novelty_interval"; return } // takt: porten dømmer maks ~7 Hz
            lastNoveltyCheck = t
            if let novelty = frameNovelty(frame), novelty < 0.12 {
                auditReason = "no_anchor_no_novelty"
                gateRejected += 1
                if gateRejected % 60 == 1 {
                    MeshLog.log(String(format: "nyhetsporten (uten anker) — frame avvist (%.0f%% nytt i sikte), %d avvist så langt", novelty * 100, gateRejected))
                }
                return
            }
        }

        // Copy the pixel buffer immediately so ARKit can recycle the frame, then encode off-thread.
        guard let copy = MeshScanPresenter.copyPixelBuffer(frame.capturedImage) else { auditReason = "copy_failed"; return }
        lastKeyframeTime = t
        lastKeyframePos = pos
        lastKeyframeFwd = fwd
        lastKeyframeBlurPx = predictedBlurPx(frame)
        if let b = bucket { bucketLastDispatch[b] = t }
        storeKeyframe(frame: frame, copy: copy, targetWidth: kfTargetWidth,
                      isPlaneShot: false, nearest: nearestAnchor, viewKey: bucket)
    }

    /// ── Tett dybdelogg (super-res-fundamentet; Scaniverse-lærdom #2: «save raw data»).
    /// LiDAR-dybden tas vare på LØPENDE (5 Hz, RÅ sceneDepth — smoothedSceneDepth er alt
    /// temporalt filtrert og dermed ødelagt som super-res-kilde), ikke bare ved keyframes.
    /// Temporal dybde-superoppløsning ved re-fusjon trenger MANGE overlappende samples per
    /// flate for å komme over 256×192-taket — keyframes alene gir 30–150 kart. Koster én
    /// memcpy per tikk + ~1 MB/s disk (tak 600 kart ≈ 118 MB). Verdensposer lagres rå;
    /// re-fusjonen kan driftkorrigere dem ved å interpolere keyframenes anchor-korreksjon
    /// (samme timestamps). Av med meshscan.densedepth = "off". Leses i dag av INGEN —
    /// dette er datainnsamlingen som gjør super-res-eksperimentet mulig på ekte bundles.
    private func maybeRecordDenseDepth(_ frame: ARFrame) {
        // TYNN UT framfor å STOPPE (2026-08-31). Det harde taket stoppet opptaket helt etter
        // ~600 kart, altså to minutter ved 5 Hz — nok til ett rom, men et leilighetsskann fikk
        // da full dekning av de første to minuttene og INGENTING av resten. Nå halveres
        // frekvensen for hver gang taket nås, så dekningen blir jevn over hele skannet og
        // totalen holder seg innenfor omtrent samme diskbudsjett uansett lengde.
        denseTick &+= 1
        let stride = 1 << min(4, denseCount / max(1, MeshScanPresenter.denseMax / 2))
        guard framesDir != nil,
              denseCount < MeshScanPresenter.denseMax,
              denseTick % UInt64(stride) == 0,
              frame.timestamp - lastDenseTime >= MeshScanPresenter.denseInterval,
              case .normal = frame.camera.trackingState,
              UserDefaults.standard.string(forKey: "meshscan.densedepth") != "off",
              let sd = frame.sceneDepth ?? frame.smoothedSceneDepth,
              let depth = MeshScanPresenter.tightDepth(sd.depthMap, confidence: sd.confidenceMap)
        else { return }
        lastDenseTime = frame.timestamp
        let idx = denseCount
        denseCount += 1
        let m = frame.camera.transform
        let K = frame.camera.intrinsics
        let res = frame.camera.imageResolution
        // Intrinsics skalert til dybdekartets oppløsning — leses som fx,fy,cx,cy i kart-piksler.
        let sx = Float(depth.width) / Float(res.width), sy = Float(depth.height) / Float(res.height)
        let cols = [m.columns.0, m.columns.1, m.columns.2, m.columns.3]
        let mStr = cols.flatMap { [$0.x, $0.y, $0.z, $0.w] }.map { String(format: "%.6f", $0) }.joined(separator: ",")
        let line = String(format: "{\"i\":%d,\"t\":%.4f,\"w\":%d,\"h\":%d,\"fx\":%.3f,\"fy\":%.3f,\"cx\":%.3f,\"cy\":%.3f,\"m\":[%@]}\n",
                          idx, frame.timestamp, depth.width, depth.height,
                          K[0][0] * sx, K[1][1] * sy, K[2][0] * sx, K[2][1] * sy, mStr)
        captureQueue.async { [weak self] in
            // FUNNET 2026-09-05: bundle med 210 dense-*.f32 men dense.jsonl på ÉN linje.
            // Et kart som kom inn etter at Ferdig hadde lukket handelen fant `denseHandle
            // == nil`, kalte createFile — som TRUNKERER — og skrev sin ene linje oppå
            // 209 andre. Ombakingen leste da 1/1 kart, TSDF-en ble tom, og hele LiDAR-
            // geometrien falt tilbake på ARKit-nettet uten at noen sa fra.
            guard let self = self, let dir = self.framesDir, !self.denseClosed else { return }
            try? depth.data.write(to: dir.appendingPathComponent("dense-\(idx).f32"), options: .atomic)
            if self.denseHandle == nil {
                let url = dir.appendingPathComponent("dense.jsonl")
                if !FileManager.default.fileExists(atPath: url.path) {
                    FileManager.default.createFile(atPath: url.path, contents: nil)
                }
                self.denseHandle = try? FileHandle(forWritingTo: url)
                _ = try? self.denseHandle?.seekToEnd() // ALDRI trunkér — legg til
            }
            if let d = line.data(using: .utf8) { self.denseHandle?.write(d) }
        }
    }

    /// Andel av synsfeltet som ennå IKKE er ferdig dekket (0 = alt ferdig, 1 = alt nytt).
    /// Sampler LiDAR-dybden på et sparsomt grid (~16×12), unprojiserer til verdensrom og
    /// slår opp i doneCells med SAMME celle-nøkkel som dekningsfargingen (10 cm + normal-
    /// bøtte; normalen estimeres fra dybde-naboer og flippes mot kameraet, slik mesh-
    /// normalen ville pekt). Kvantiserings-jitter tilgis med 6 nabo-celler (samme bøtte).
    /// nil = for lite dybdedata til å dømme → slipp frame gjennom.
    private func frameNovelty(_ frame: ARFrame) -> Float? {
        guard let d = frame.smoothedSceneDepth?.depthMap else { return nil }
        CVPixelBufferLockBaseAddress(d, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(d, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(d) else { return nil }
        let dw = CVPixelBufferGetWidth(d), dh = CVPixelBufferGetHeight(d)
        let bpr = CVPixelBufferGetBytesPerRow(d)
        @inline(__always) func depthAt(_ u: Int, _ v: Int) -> Float {
            base.advanced(by: v * bpr + u * 4).assumingMemoryBound(to: Float32.self).pointee
        }
        let cam = frame.camera
        let res = cam.imageResolution
        let K = cam.intrinsics
        let sx = Float(dw) / Float(res.width), sy = Float(dh) / Float(res.height)
        let fx = K[0][0] * sx, fy = K[1][1] * sy
        let cx = K[2][0] * sx, cy = K[2][1] * sy
        let m = cam.transform
        let camPos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        @inline(__always) func unproject(_ u: Int, _ v: Int, _ z: Float) -> SIMD3<Float> {
            let x = (Float(u) + 0.5 - cx) * z / fx
            let y = -(Float(v) + 0.5 - cy) * z / fy
            let w4 = m * SIMD4<Float>(x, y, -z, 1)
            return SIMD3(w4.x, w4.y, w4.z)
        }
        var total = 0
        var fresh = 0
        let su = max(1, dw / 16), sv = max(1, dh / 12)
        var v = sv / 2
        while v < dh - 4 {
            var u = su / 2
            while u < dw - 4 {
                let z = depthAt(u, v)
                if z < 0.25 || z > 4.0 { u += su; continue }
                let zr = depthAt(u + 3, v), zd = depthAt(u, v + 3)
                if zr < 0.25 || zd < 0.25 || abs(zr - z) > 0.3 || abs(zd - z) > 0.3 { u += su; continue } // dybdekant
                let p = unproject(u, v, z)
                var nrm = simd_cross(unproject(u + 3, v, zr) - p, unproject(u, v + 3, zd) - p)
                let nl = simd_length(nrm)
                if nl < 1e-8 { u += su; continue }
                nrm /= nl
                if simd_dot(nrm, camPos - p) < 0 { nrm = -nrm } // mesh-normaler peker mot rommet
                let ax = abs(nrm.x), ay = abs(nrm.y), az = abs(nrm.z)
                let nb: Int64 = ax >= ay && ax >= az ? (nrm.x >= 0 ? 0 : 1) : (ay >= az ? (nrm.y >= 0 ? 2 : 3) : (nrm.z >= 0 ? 4 : 5))
                let qx = Int64((p.x * 10).rounded()), qy = Int64((p.y * 10).rounded()), qz = Int64((p.z * 10).rounded())
                @inline(__always) func cellKey(_ x: Int64, _ y: Int64, _ z: Int64) -> Int64 {
                    (x & 0xFFFFF) | ((y & 0xFFFFF) << 20) | ((z & 0xFFFFF) << 40) | (nb << 60)
                }
                total += 1
                var covered = doneCells.contains(cellKey(qx, qy, qz))
                if !covered {
                    for (ox, oy, oz) in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
                    where doneCells.contains(cellKey(qx &+ Int64(ox), qy &+ Int64(oy), qz &+ Int64(oz))) {
                        covered = true
                        break
                    }
                }
                if !covered { fresh += 1 }
                u += su
            }
            v += sv
        }
        guard total >= 24 else { return nil } // for tynt dybdebilde til å dømme
        return Float(fresh) / Float(total)
    }

    /// Delt lagringskjerne for video-keyframes OG dedikerte planshots (12MP-stills).
    /// Planshots omgår maxKeyframes-taket og flagges i manifestet.
    private func storeKeyframe(frame: ARFrame, copy: CVPixelBuffer, targetWidth: CGFloat,
                               isPlaneShot: Bool, nearest: ARMeshAnchor? = nil, viewKey: Int64? = nil) {
        let t = frame.timestamp
        let cam = frame.camera
        let m = cam.transform
        let pos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        let fwd = simd_normalize(SIMD3<Float>(-m.columns.2.x, -m.columns.2.y, -m.columns.2.z))
        // Predikert uskarphet leses HER (delegat-tråden — frame og fartsstate er gyldige) og
        // fanges inn i captureQueue-closuren sammen med resten av frame-dataene.
        let blurPx = predictedBlurPx(frame)
        // Frys også farten her: captureQueue kan ligge etter, og en senere kamerafart
        // ville rangert dette bildet med bevegelsen fra en annen frame ved gjenbesøk.
        let motion = lastLinSpeed + 0.5 * lastAngSpeed
        // Extract a tight Float32 depth map (small, ~256x192) synchronously for the occlusion test.
        // Low-confidence pixels (ARConfidenceLevel.low) are zeroed inline — every downstream
        // consumer (TSDF integration, ICP refine, room-bounds sampling) already skips z<=0.25,
        // so this alone excludes them everywhere without touching any of that code.
        let depth = frame.smoothedSceneDepth.flatMap {
            MeshScanPresenter.tightDepth($0.depthMap, confidence: $0.confidenceMap)
        }

        // Teller kun FORSØK nå (logging/diagnostikk) — filnavn-indeksen allokeres på
        // captureQueue, som er den eneste som vet om framen faktisk beholdes eller erstatter.
        keyframeReserved += 1

        let fullW = CGFloat(CVPixelBufferGetWidth(copy))
        let scale = fullW > 0 ? min(1.0, targetWidth / fullW) : 1.0
        let s = Float(scale)
        let k = cam.intrinsics
        let intrinsics: [Float] = [k[0][0] * s, k[1][1] * s, k[2][0] * s, k[2][1] * s] // fx, fy, cx, cy
        let transform: [Float] = [
            m.columns.0.x, m.columns.0.y, m.columns.0.z, m.columns.0.w,
            m.columns.1.x, m.columns.1.y, m.columns.1.z, m.columns.1.w,
            m.columns.2.x, m.columns.2.y, m.columns.2.z, m.columns.2.w,
            m.columns.3.x, m.columns.3.y, m.columns.3.z, m.columns.3.w,
        ]

        // Dekningskamera — inkrementelt her (delegat-tråden, samme som dekningstikket) i stedet
        // for full ombygging fra keyframes-arrayet hvert tikk. Pose-dedup: gjenbesøk av samme
        // ståsted/retning tilfører ikke dekningsinfo (metter på 3), bare CPU-kost.
        let kw = Float((CGFloat(CVPixelBufferGetWidth(copy)) * scale).rounded())
        let kh = Float((CGFloat(CVPixelBufferGetHeight(copy)) * scale).rounded())
        let bx = Int64((pos.x * 5).rounded()), by = Int64((pos.y * 5).rounded()), bz = Int64((pos.z * 5).rounded())
        let yawB = Int64(((atan2(fwd.z, fwd.x) + .pi) / (.pi / 8)).rounded())
        let pitchB = Int64(((asin(max(-1, min(1, fwd.y))) + .pi / 2) / (.pi / 8)).rounded())
        let bucket = (bx & 0xFFF) | ((by & 0xFFF) << 12) | ((bz & 0xFFF) << 24) | ((yawB & 0x3F) << 36) | ((pitchB & 0x3F) << 42)
        if kfCamBuckets.insert(bucket).inserted {
            var dsDepth = [Float]()
            var dsW = 0, dsH = 0
            if let depth = depth, depth.width > 0 {
                dsW = 64
                dsH = max(1, depth.height * dsW / depth.width)
                dsDepth = [Float](repeating: 0, count: dsW * dsH)
                depth.data.withUnsafeBytes { raw in
                    let dp = raw.bindMemory(to: Float.self)
                    for y in 0..<dsH {
                        let sy = y * depth.height / dsH
                        for x in 0..<dsW {
                            dsDepth[y * dsW + x] = dp[sy * depth.width + x * depth.width / dsW]
                        }
                    }
                }
            }
            kfCams.append(KFCam(w2c: simd_inverse(m), camPos: pos,
                                fx: intrinsics[0], fy: intrinsics[1], cx: intrinsics[2], cy: intrinsics[3],
                                w: kw, h: kh, depth: dsDepth, dw: dsW, dh: dsH))
        }

        // Drift re-anchoring (B): tie this keyframe to the nearest mesh anchor, storing the camera
        // pose in that anchor's local frame. At export we multiply by the anchor's loop-closure-
        // corrected transform → the camera path snaps onto the corrected geometry (no shredding).
        var kfAnchorID: String? = nil
        var kfRel: [Float]? = nil
        // Porten fant allerede nærmeste anker for bøtte-nøkkelen — gjenbruk det i stedet for å
        // søke gjennom alle ankere en gang til på delegat-tråden (main).
        if let nearest = nearest ?? frame.anchors.compactMap({ $0 as? ARMeshAnchor }).min(by: {
            simd_distance_squared(SIMD3($0.transform.columns.3.x, $0.transform.columns.3.y, $0.transform.columns.3.z), pos) <
            simd_distance_squared(SIMD3($1.transform.columns.3.x, $1.transform.columns.3.y, $1.transform.columns.3.z), pos)
        }) {
            let rel = simd_inverse(nearest.transform) * m
            kfAnchorID = nearest.identifier.uuidString
            kfRel = [
                rel.columns.0.x, rel.columns.0.y, rel.columns.0.z, rel.columns.0.w,
                rel.columns.1.x, rel.columns.1.y, rel.columns.1.z, rel.columns.1.w,
                rel.columns.2.x, rel.columns.2.y, rel.columns.2.z, rel.columns.2.w,
                rel.columns.3.x, rel.columns.3.y, rel.columns.3.z, rel.columns.3.w,
            ]
        }

        captureQueue.async { [weak self] in
            guard let self = self, let dir = self.framesDir else { return }
            let sharp = MeshScanPresenter.sharpnessScore(copy)  // measure blur before encoding

            // ── Erstatningsavgjørelsen. Tas FØR JPEG-encodingen: en kandidat som ikke slår
            // plassen sin skal ikke koste encode-tid eller varme (regel 8).
            // Scoren er `kfQuality` — identisk med `selectCoverageAware`s og bake-vinnervalgets,
            // så fangst og bake-utvalg rangerer likt.
            let score = MeshScanPresenter.kfQuality(sharpness: sharp, motion: motion, blurPx: blurPx)
            var replaceSlot: Int? = nil
            var replacedTimestamp: Double?
            let idx: Int
            if !isPlaneShot, let b = viewKey, let existing = self.bucketSlot[b],
               self.keyframes.indices.contains(existing) {
                let old = self.keyframes[existing]
                let oldScore = MeshScanPresenter.kfQuality(sharpness: old.sharpness, motion: old.motion, blurPx: old.blurPx)
                // Hysterese 15 %: uten den ville jevnbyrdige kandidater tvunget fram en ny
                // encode hver runde — fem runder = fem ganger encode-lasten for ingenting.
                guard score > oldScore * 1.15 else {
                    self.captureDecisionAudit.record(time: t, reason: "not_better", bucket: viewKey,
                        index: old.index, previousTime: old.timestamp, score: score, previousScore: oldScore)
                    self.kfNotBetter += 1; return
                }
                replacedTimestamp = old.timestamp
                replaceSlot = existing
                idx = old.index // overskriv SAMME filer — lagringen vokser ikke av gjenbesøk
                self.kfReplaced += 1
            } else {
                // Nytt ståsted: taket gjelder her, mot antall LAGREDE frames.
                guard isPlaneShot || self.keyframes.count < MeshScanPresenter.maxKeyframes else {
                    self.captureDecisionAudit.record(time: t, reason: "capacity", bucket: viewKey); return
                }
                idx = self.nextKFIndex
                self.nextKFIndex += 1
                self.kfNew += 1
            }

            let ci = CIImage(cvPixelBuffer: copy)
            let img = scale < 1.0 ? ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) : ci
            // Eksplisitt JPEG-kvalitet: 4K-frames med default-kvalitet ville blåst opp
            // disk-forbruket (~600 frames/skann); 0.8 er visuelt transparent for bake-formålet.
            let jpegOpts = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.8]
            guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
                  let jpeg = self.ciContext.jpegRepresentation(of: img, colorSpace: cs, options: jpegOpts) else {
                self.captureDecisionAudit.record(time: t, reason: "encode_failed", bucket: viewKey); return
            }
            let fname = "frame-\(idx).jpg"
            do { try jpeg.write(to: dir.appendingPathComponent(fname), options: .atomic) } catch {
                self.captureDecisionAudit.record(time: t, reason: "write_failed", bucket: viewKey, index: idx); return
            }

            var depthFile: String?
            var depthW = 0, depthH = 0
            if let depth = depth {
                let dname = "depth-\(idx).f32"
                if (try? depth.data.write(to: dir.appendingPathComponent(dname), options: .atomic)) != nil {
                    depthFile = dname
                    depthW = depth.width
                    depthH = depth.height
                }
            }

            let kf = Keyframe(
                index: idx,
                file: fname,
                timestamp: t,
                width: Int((CGFloat(CVPixelBufferGetWidth(copy)) * scale).rounded()),
                height: Int((CGFloat(CVPixelBufferGetHeight(copy)) * scale).rounded()),
                transform: transform,
                intrinsics: intrinsics,
                depthFile: depthFile,
                depthWidth: depthW,
                depthHeight: depthH,
                sharpness: sharp,
                motion: motion,
                blurPx: blurPx,
                anchorID: kfAnchorID,
                relTransform: kfRel,
                preLock: nil,
                isPlaneShot: isPlaneShot ? true : nil
            )
            if let slot = replaceSlot {
                self.keyframes[slot] = kf // samme plass, samme filnavn — bøtta beholder én frame
                self.captureDecisionAudit.record(time: t, reason: "saved_replacement", bucket: viewKey,
                    index: idx, previousTime: replacedTimestamp, score: score)
            } else {
                self.keyframes.append(kf)
                self.captureDecisionAudit.record(time: t, reason: "saved_new", bucket: viewKey, index: idx, score: score)
                if !isPlaneShot, let b = viewKey { self.bucketSlot[b] = self.keyframes.count - 1 }
            }
        }
    }


    /// Blur metric on the luma (Y) plane: mean squared gradient (Tenengrad-style).
    /// Higher = sharper. Subsampled for speed. Used to keep the sharpest frames for splatting.
    private static func sharpnessScore(_ pb: CVPixelBuffer) -> Float {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return 0 }
        let w = CVPixelBufferGetWidthOfPlane(pb, 0)
        let h = CVPixelBufferGetHeightOfPlane(pb, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        let p = base.assumingMemoryBound(to: UInt8.self)
        let step = max(4, w / 480) // ~samme sample-tetthet uansett kildeoppløsning (1920→4, 3840→8)
        var sum = 0.0
        var n = 0
        var y = step
        while y < h - step {
            let row = y * stride
            var x = step
            while x < w - step {
                let c = Int(p[row + x])
                let gx = Int(p[row + x + step]) - c
                let gy = Int(p[(y + step) * stride + x]) - c
                sum += Double(gx * gx + gy * gy)
                n += 1
                x += step
            }
            y += step
        }
        return n > 0 ? Float(sum / Double(n)) : 0
    }

    /// Extract a tight (no row padding) Float32 depth buffer in metres from a DepthFloat32 pixel buffer.
    /// `confidence` is ARKit's per-pixel ARConfidenceLevel map (OneComponent8: 0=low,1=medium,2=high),
    /// same dimensions as the depth map when present. Pixels at .low are zeroed — every downstream
    /// reader already treats z<=0.25 as "no sample" (TSDFFusion integration + ICP + bounds sampling),
    /// so this alone drops low-confidence depth everywhere without touching any of that code.
    private static func tightDepth(_ pb: CVPixelBuffer, confidence: CVPixelBuffer? = nil) -> (data: Data, width: Int, height: Int)? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        let w = CVPixelBufferGetWidth(pb)
        let h = CVPixelBufferGetHeight(pb)
        let bpr = CVPixelBufferGetBytesPerRow(pb)
        let rowBytes = w * 4
        var out = Data(count: rowBytes * h)

        let useConfidence = confidence != nil
            && CVPixelBufferGetWidth(confidence!) == w
            && CVPixelBufferGetHeight(confidence!) == h
        if useConfidence { CVPixelBufferLockBaseAddress(confidence!, .readOnly) }
        defer { if useConfidence { CVPixelBufferUnlockBaseAddress(confidence!, .readOnly) } }
        let confBase = useConfidence ? CVPixelBufferGetBaseAddress(confidence!) : nil
        let confBpr = useConfidence ? CVPixelBufferGetBytesPerRow(confidence!) : 0

        out.withUnsafeMutableBytes { dst in
            guard let d = dst.baseAddress else { return }
            for row in 0..<h {
                let dstRow = d.advanced(by: row * rowBytes)
                memcpy(dstRow, base.advanced(by: row * bpr), rowBytes)
                guard let confBase else { continue }
                let confRow = confBase.advanced(by: row * confBpr).assumingMemoryBound(to: UInt8.self)
                let depthRow = dstRow.assumingMemoryBound(to: Float32.self)
                for col in 0..<w where confRow[col] == 0 { depthRow[col] = 0 } // .low → treat as unobserved
            }
        }
        return (out, w, h)
    }

    /// Deep-copy a CVPixelBuffer (incl. biplanar YCbCr) so the source ARFrame can be released.
    private static func copyPixelBuffer(_ src: CVPixelBuffer) -> CVPixelBuffer? {
        let w = CVPixelBufferGetWidth(src)
        let h = CVPixelBufferGetHeight(src)
        let fmt = CVPixelBufferGetPixelFormatType(src)
        var out: CVPixelBuffer?
        let attrs: [CFString: Any] = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary]
        guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, fmt, attrs as CFDictionary, &out) == kCVReturnSuccess,
              let dst = out else { return nil }
        CVPixelBufferLockBaseAddress(src, .readOnly)
        CVPixelBufferLockBaseAddress(dst, [])
        defer {
            CVPixelBufferUnlockBaseAddress(dst, [])
            CVPixelBufferUnlockBaseAddress(src, .readOnly)
        }
        let planes = CVPixelBufferGetPlaneCount(src)
        if planes == 0 {
            if let s = CVPixelBufferGetBaseAddress(src), let d = CVPixelBufferGetBaseAddress(dst) {
                memcpy(d, s, CVPixelBufferGetDataSize(src))
            }
            return dst
        }
        for p in 0..<planes {
            guard let s = CVPixelBufferGetBaseAddressOfPlane(src, p),
                  let d = CVPixelBufferGetBaseAddressOfPlane(dst, p) else { continue }
            let srcBPR = CVPixelBufferGetBytesPerRowOfPlane(src, p)
            let dstBPR = CVPixelBufferGetBytesPerRowOfPlane(dst, p)
            let ph = CVPixelBufferGetHeightOfPlane(src, p)
            let copyBytes = min(srcBPR, dstBPR)
            for row in 0..<ph {
                memcpy(d.advanced(by: row * dstBPR), s.advanced(by: row * srcBPR), copyBytes)
            }
        }
        return dst
    }

    private func writeKeyframesManifest() {
        guard let dir = framesDir else { return }
        // Flush pending encodes, then snapshot on captureQueue.
        captureQueue.sync {
            if let data = try? JSONEncoder().encode(keyframes) {
                try? data.write(to: dir.appendingPathComponent("frames.json"), options: .atomic)
            }
        }
    }

    private func makeColorProvider() -> ((SIMD3<Float>) -> SIMD3<Float>?)? {
        if colorAccum.isEmpty { return nil }
        let accum = colorAccum
        return { world in
            let k = MeshScanPresenter.voxelKey(world)
            // Exact voxel first; fall back to nearest filled neighbour (mesh anchors refine
            // between sample-time and export, so positions drift by a voxel or two).
            if let v = accum[k], v.w > 0 {
                return SIMD3<Float>(v.x / v.w, v.y / v.w, v.z / v.w)
            }
            for radius in 1...2 {
                for dz in -radius...radius {
                    for dy in -radius...radius {
                        for dx in -radius...radius {
                            let nk = VoxelKey(x: k.x + Int32(dx), y: k.y + Int32(dy), z: k.z + Int32(dz))
                            if let v = accum[nk], v.w > 0 {
                                return SIMD3<Float>(v.x / v.w, v.y / v.w, v.z / v.w)
                            }
                        }
                    }
                }
            }
            return nil
        }
    }

    private func export(anchors: [ARMeshAnchor]) throws -> MeshScanResult {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("room-scans", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safeCompany = companyId.replacingOccurrences(of: "/", with: "_")
        let safeRoom = roomId.replacingOccurrences(of: "/", with: "_")
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        let filename = "mesh-\(safeCompany)-\(safeRoom)-\(ts).glb"
        let url = dir.appendingPathComponent(filename)

        // Try the photographic texture bake (steps 2-4); fall back to vertex-colour GLB on any failure.
        let kfCountAtExport = captureQueue.sync { keyframes.count }
        NSLog("[MeshScan] export: keyframeReserved=\(keyframeReserved) keyframes.count=\(kfCountAtExport) framesDir=\(framesDir?.lastPathComponent ?? "nil")")
        var textureResult: ARMeshGlbExporter.TexturedExportResult? = nil
        if #available(iOS 14.0, *), let framesDir = framesDir, !keyframes.isEmpty {
            let kf = captureQueue.sync { keyframes }
            // Drift re-anchoring (B): recompute each keyframe's world pose from its anchor's final,
            // loop-closure-corrected transform so the texture aligns with the corrected geometry.
            var anchorMap = [String: simd_float4x4]()
            for a in anchors { anchorMap[a.identifier.uuidString] = a.transform }
            func mat(_ a: [Float]) -> simd_float4x4 {
                simd_float4x4(columns: (SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]),
                                        SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15])))
            }
            var reanchored = 0
            let lockT = aeLockTime
            let kfFixed: [Keyframe] = kf.map { k0 in
                var k = k0
                if lockT.isFinite { k.preLock = k.timestamp < lockT } // pre-lås-frames straffes i vinnervalget
                guard let aid = k.anchorID, let rel = k.relTransform, let aFinal = anchorMap[aid] else { return k }
                let w = aFinal * mat(rel)
                var nk = k
                nk.transform = [w.columns.0.x, w.columns.0.y, w.columns.0.z, w.columns.0.w,
                                w.columns.1.x, w.columns.1.y, w.columns.1.z, w.columns.1.w,
                                w.columns.2.x, w.columns.2.y, w.columns.2.z, w.columns.2.w,
                                w.columns.3.x, w.columns.3.y, w.columns.3.z, w.columns.3.w]
                reanchored += 1
                return nk
            }
            NSLog("[MeshScan] re-anchored \(reanchored)/\(kf.count) keyframes to corrected geometry")
            textureResult = MeshBakeV2.exportTextured(anchors: anchors, to: url, framesDir: framesDir, keyframes: kfFixed)
        }
        if textureResult?.success != true {
            try ARMeshGlbExporter.export(anchors: anchors, to: url, colorProvider: makeColorProvider())
        }
        // Forhåndsvisning til skann-kortene (<glb>.jpg) — rendres fra samme ståsted som vieweren.
        ARMeshGlbExporter.progress?("Lager forhåndsvisning…")
        AmpexGlbLoader.renderThumbnail(glbPath: url.path)
        return MeshScanResult(
            fileURL: url, relativePath: "room-scans/\(filename)", format: "glb",
            framesDirURL: framesDir, keyframeCount: kfCountAtExport,
            textured: textureResult?.success ?? false,
            filledFraction: textureResult?.filledFraction,
            geometryPath: textureResult?.geometryPath ?? "anchor-fallback"
        )
    }

    private func finish(_ result: Result<MeshScanResult, Error>) {
        ARMeshGlbExporter.progress = nil
        coverageTimer?.invalidate()
        coverageTimer = nil
        ramTimer?.invalidate()
        ramTimer = nil
        coverageNodes.removeAll() // nodene eies av ARSCNView — dør med sesjonen
        let cb = onFinish
        onFinish = nil
        hostingController?.dismiss(animated: true) {
            cb?(result)
        }
        hostingController = nil
    }

    // MARK: - Live mesh + coverage overlay
    // FORANKRING (2026-08-13-fix): ARSCNView EIER anker-nodene — SceneKit synker transformene
    // på render-tråden i takt med kamerabildet (inkl. driftskorreksjoner), null svømming.
    // Vi henger bare geometri på noden ARKit alt har plassert; den manuelle per-frame-synken
    // (main-tråd, én frame bak render) var årsaken til at wireframen «fløt» mot passthrough.
    func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
        guard let ma = anchor as? ARMeshAnchor else { return }
        let id = anchor.identifier
        // Geometrien kopieres HER — ankeret ARKit rekker oss i callbacken er det eneste
        // stedet bufferne er garantert gyldige. Kopien (`AnchorSnap`) brukes både til
        // visning (med én gang) og av dekningspasset (som aldri rører anchor.geometry).
        let sn = MeshScanPresenter.snapshot(ma)
        let geo = MeshScanPresenter.quickGeometry(sn)
        DispatchQueue.main.async {
            self.coverageNodes[id] = node
            self.lastSnaps[id] = sn
            self.dirtyAnchors.insert(id)
            if let geo { node.geometry = geo }
        }
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let ma = anchor as? ARMeshAnchor else { return }
        let id = anchor.identifier
        let sn = MeshScanPresenter.snapshot(ma)
        let geo = MeshScanPresenter.quickGeometry(sn)
        DispatchQueue.main.async {
            self.lastSnaps[id] = sn
            self.dirtyAnchors.insert(id)
            if let geo { node.geometry = geo }
        }
    }

    func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
        guard anchor is ARMeshAnchor else { return }
        let id = anchor.identifier
        DispatchQueue.main.async { self.lastSnaps.removeValue(forKey: id); self.dirtyAnchors.remove(id) }
        // ARKit slår sammen og bytter ut mesh-ankere hele tiden, og ved relokalisering
        // ryker mange på én gang. Noden dør med ankeret, så uten dette blinker wireframen
        // bort. Vi beholder en frossen kopi til neste dekningspass har tegnet på nytt.
        let frozen = node.geometry
        let world = node.simdWorldTransform
        DispatchQueue.main.async {
            self.coverageNodes.removeValue(forKey: id)
            guard let geo = frozen else { return }
            let ghost = SCNNode(geometry: geo)
            ghost.simdTransform = world
            ghost.opacity = 0.55
            self.ghostRoot.addChildNode(ghost)
            // Sikring mot opphopning hvis dekningspasset skulle stoppe helt.
            if self.ghostRoot.childNodes.count > 80 {
                self.ghostRoot.childNodes.first?.removeFromParentNode()
            }
        }
    }

    // MARK: - Sesjonen faller ut og kommer tilbake
    // Uten disse tre stoppet skanningen bare opp: sesjonen døde, ingen startet den
    // igjen, og wireframen frøs eller forsvant uten at brukeren fikk vite hvorfor.

    func session(_ session: ARSession, didFailWithError error: Error) {
        MeshLog.log("AR-sesjonen feilet: \(error.localizedDescription)")
        visStatus("Skanningen mistet sporingen — starter igjen", advarsel: true)
        guard let config = arConfig else { return }
        // IKKE .resetTracking/.removeExistingAnchors: da mister vi alt som er skannet.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.sceneView?.session.run(config)
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        MeshLog.log("AR-sesjonen avbrutt (bakgrunn, samtale eller kamera opptatt)")
        visStatus("Avbrutt — hold telefonen i ro", advarsel: true)
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        MeshLog.log("AR-avbruddet over — kjører videre uten nullstilling")
        guard let config = arConfig else { return }
        // Uten nullstilling relokaliserer ARKit mot det som alt er skannet.
        sceneView?.session.run(config)
        visStatus(nil, advarsel: false)
    }

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .limited(.relocalizing):
            visStatus("Finner tilbake — pek mot noe du har skannet", advarsel: true)
        case .limited(.insufficientFeatures):
            visStatus("For lite å feste seg i — mer lys eller mer struktur", advarsel: true)
        case .normal:
            if sessionTrouble { visStatus(nil, advarsel: false) }
        default:
            break
        }
    }

    /// Én linje til brukeren i hint-etiketten. nil = tilbake til vanlig hint.
    private func visStatus(_ tekst: String?, advarsel: Bool) {
        sessionTrouble = tekst != nil
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let label = self.hintLabel else { return }
            label.text = tekst ?? MeshScanPresenter.defaultHint
            label.textColor = advarsel ? .systemYellow : .white
        }
    }

    private struct KFCam {
        let w2c: simd_float4x4
        let camPos: SIMD3<Float>
        let fx: Float, fy: Float, cx: Float, cy: Float, w: Float, h: Float
        // Nedskalert LiDAR-dybde (~64×48) → okklusjonstest i dekningsfargingen. Uten den
        // teller frustum-treff som dekning selv når møbler står i veien — «grønt som baker
        // grått». dw == 0 → ingen dybde for denne framen (ren frustum-fallback).
        let depth: [Float]
        let dw: Int, dh: Int
    }
    private struct AnchorSnap {
        let id: UUID
        let verts: [SIMD3<Float>]   // world space (dekningstest + kantfilter)
        let norms: [SIMD3<Float>]   // world space
        let faces: [UInt32]
        // Lokale koordinater + anker-transform: overlaygeometrien bygges i ANKER-lokalt
        // rom og henger på en node hvis transform synkes fra ARKit hver frame — når
        // ARKit driftskorrigerer verdenskartet følger wireframen med umiddelbart, i
        // stedet for å «svømme» til neste rebuild (som ga synlig skift, 2026-08-12).
        let localVerts: [SIMD3<Float>]
        let transform: simd_float4x4
    }

    // Fired every 1s: recolour the mesh by how many keyframes cover each vertex.
    @objc private func updateCoverageTick() {
        // Vakthund: et pass som henger (stort mesh + termisk struping) låste flagget
        // for godt, og da sluttet wireframen å oppdatere seg uten en eneste feilmelding.
        if coverageBusy {
            if CFAbsoluteTimeGetCurrent() - coverageBusySince > 20 {
                MeshLog.log("dekningspass hang i >20 s — låser opp og prøver igjen")
                coverageBusy = false
            } else {
                return
            }
        }
        // Adaptiv kadens: hopp over tikk når forrige pass var dyrt (stort mesh) eller telefonen
        // er termisk presset — kontinuerlig CPU-pinning ga struping som gjorde hele skanningen
        // tregere og tregere. Dekningsvisningen trenger ikke 1 Hz.
        coverageTickCount += 1
        var stride = coverageStride
        let thermal = ProcessInfo.processInfo.thermalState
        if thermal == .serious { stride = max(stride, 3) }
        if thermal == .critical { stride = max(stride, 6) }
        if coverageTickCount % stride != 0 { return }
        guard let frame = sceneView?.session.currentFrame else { return }
        let camPos3 = SIMD3<Float>(frame.camera.transform.columns.3.x, frame.camera.transform.columns.3.y, frame.camera.transform.columns.3.z)
        let meshAnchors = frame.anchors.compactMap { $0 as? ARMeshAnchor }.filter {
            let ap = SIMD3<Float>($0.transform.columns.3.x, $0.transform.columns.3.y, $0.transform.columns.3.z)
            return simd_distance(camPos3, ap) < 12.0
        }
        if meshAnchors.isEmpty { return }
        coverageBusy = true
        coverageBusySince = CFAbsoluteTimeGetCurrent()

        // Inkrementell, pose-dedupet kameraliste (vedlikeholdes i maybeCaptureKeyframe) —
        // ingen captureQueue.sync (som blokkerte main under JPEG-koding) og ingen 600
        // matriseinverser per tikk.
        let cams = kfCams

        // Capture camera pose on main thread; used later for direction-to-uncovered hint.
        let cameraTx = frame.camera.transform

        let tickStart = CFAbsoluteTimeGetCurrent()
        // Snapshot PÅ MAIN — IKKE flytt av: ARKit kan reallokere anchor-geometribufferne mens
        // sesjonen kjører, og lesing off-main ga SIGSEGV i snapshot() (kræsj 2026-07-05 20:43).
        // Eksportbanen leser off-main kun fordi sesjonen er PAUSET da. Den adaptive striden
        // over gjør at denne kopien skjer sjelden på store mesh — akseptabel main-kost.
        // Bare ankere ARKit har endret siden sist kopieres på main; resten gjenbrukes.
        // Har verken ankere eller kameraer endret seg, er passet gratis: hopp over.
        var snaps: [AnchorSnap] = []
        snaps.reserveCapacity(meshAnchors.count)
        var nyeSnaps = 0
        // KRÆSJ 2026-09-07 19:46 (SIGSEGV i snapshot(_:) på main): ankerne i `currentFrame`
        // kan peke på geometribuffere ARKit alt har frigjort — også på main. Derfor leses
        // anchor.geometry ALDRI her lenger. Kopien tas i renderer(_:didAdd/didUpdate:) der
        // ARKit selv rekker oss et gyldig anker, og legges i `lastSnaps`. Ankere uten kopi
        // ennå hoppes over til neste tikk.
        for a in meshAnchors {
            let id = a.identifier
            guard let sn = lastSnaps[id] else { continue }
            snaps.append(sn)
            if dirtyAnchors.contains(id) { nyeSnaps += 1 }
        }
        dirtyAnchors.removeAll(keepingCapacity: true)
        let nyeKameraer = cams.count - camsVedSistePass
        camsVedSistePass = cams.count
        if nyeSnaps == 0 && nyeKameraer <= 0 { coverageBusy = false; return }
        let cache = cellCache
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            // Per-anker-geometri i lokalt rom (IKKE én verdens-merge): nodene bærer
            // anker-transformene og synkes fra ARKit hver frame i session(_:didUpdate:) —
            // driftskorrigering flytter dermed wireframen umiddelbart selv om fargene
            // (denne dyre delen) bare bygges på tikken.
            var perAnchor: [(id: UUID, transform: simd_float4x4, geo: SCNGeometry)] = []
            var totalVerts = 0, redVerts = 0, purpleN = 0
            var purpleSum = SIMD3<Float>(0, 0, 0)
            var ceilTotal = 0, ceilPurple = 0, floorTotal = 0, floorPurple = 0
            var doneUnion = Set<Int64>()
            for s in snaps {
                let (geo, red, pSum, pN, cT, cP, fT, fP) = MeshScanPresenter.coverageGeometry(snap: s, cams: cams, done: &doneUnion, cache: cache)
                perAnchor.append((s.id, s.transform, geo))
                totalVerts += s.verts.count
                redVerts += red; purpleSum += pSum; purpleN += pN
                ceilTotal += cT; ceilPurple += cP; floorTotal += fT; floorPurple += fP
            }
            // Krever et minimum av flate før andelen betyr noe (ellers 0 → ingen veiledning)
            let ceilFrac = ceilTotal >= 300 ? Float(ceilPurple) / Float(ceilTotal) : 0
            let floorFrac = floorTotal >= 300 ? Float(floorPurple) / Float(floorTotal) : 0
            let pct = totalVerts > 0 ? (redVerts * 100) / totalVerts : 0
            let purpleCentroid: SIMD3<Float>? = purpleN > 100 ? purpleSum / Float(purpleN) : nil
            DispatchQueue.main.async {
                // Kun geometri — noden eies og plasseres av ARSCNView (didAdd/didRemove),
                // så transformen er alltid i takt med render/driftskorreksjon.
                for entry in perAnchor {
                    self.coverageNodes[entry.id]?.geometry = entry.geo
                }
                // Levende geometri er på plass igjen — de frosne kopiene kan ryddes.
                if !self.ghostRoot.childNodes.isEmpty {
                    self.ghostRoot.childNodes.forEach { $0.removeFromParentNode() }
                }
                self.lastCoverageOK = CFAbsoluteTimeGetCurrent()
                self.percentLabel?.text = "\(pct)%"
                self.doneCells.formUnion(doneUnion)

                // Terskelfritt: brukeren avgjør selv når skannet er ferdig — prosenten er
                // veiledende (nå okklusjons-bekreftet, men fortsatt bare en verteks-andel).
                let wasEnabled = self.doneButton?.isEnabled ?? false
                if !wasEnabled && cams.count >= 3 {
                    self.doneButton?.setTitle("Ferdig", for: .normal)
                    self.doneButton?.isEnabled = true
                    self.doneButton?.alpha = 1.0
                    self.doneButton?.backgroundColor = UIColor.systemGreen
                }

                // Veiledningsmotor: én prioritert, animert instruks basert på hva brukeren
                // faktisk gjør (fart, snurring, avstand) og hva som mangler (tak/gulv/retning).
                let depthC = self.sceneView?.session.currentFrame.flatMap { MeshScanPresenter.centerDepth($0) }
                self.evaluateGuidance(purpleCentroid: purpleCentroid, cameraTx: cameraTx,
                                      ceilFrac: ceilFrac, floorFrac: floorFrac, depthCenter: depthC)

                // Kalibrer kadensen mot faktisk kost: sikt på ~<25 % CPU-duty for dekningen.
                let elapsed = CFAbsoluteTimeGetCurrent() - tickStart
                self.coverageStride = max(1, min(8, Int(elapsed / 0.25) + 1)) // 1 Hz-tikk: veiledning/statistikk, ikke visning
                // Kadensen er det brukeren opplever som «responsiv wireframe»: stride 8 betyr at
                // fargen ligger opptil 8 s bak bevegelsen. Logg den EKTE kosten (hvert 10. utførte
                // pass) så terskelen på 0,25 s kan justeres mot måling. NB: et Debug-bygg er
                // ~20× tregere i denne løkka og pinner stride på 8 — knotten må dømmes på Release.
                self.coverageCostN += 1
                self.coverageCostSum += elapsed
                if self.coverageCostN % 10 == 0 {
                    let avg = self.coverageCostSum / Double(self.coverageCostN)
                    MeshLog.log(String(format: "dekningspass — snitt %.0f ms over %d pass, stride %d (termikk %d)",
                                       avg * 1000, self.coverageCostN, self.coverageStride,
                                       ProcessInfo.processInfo.thermalState.rawValue))
                }
                self.coverageBusy = false
            }
        }
    }

    private static func snapshot(_ anchor: ARMeshAnchor) -> AnchorSnap {
        let g = anchor.geometry
        let t = anchor.transform
        let nm = simd_transpose(simd_inverse(simd_float3x3(
            SIMD3(t.columns.0.x, t.columns.0.y, t.columns.0.z),
            SIMD3(t.columns.1.x, t.columns.1.y, t.columns.1.z),
            SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z))))
        let vc = g.vertices.count
        let vBuf = g.vertices.buffer.contents(); let vS = g.vertices.stride; let vO = g.vertices.offset
        let nBuf = g.normals.buffer.contents(); let nS = g.normals.stride; let nO = g.normals.offset
        var verts = [SIMD3<Float>](); verts.reserveCapacity(vc)
        var norms = [SIMD3<Float>](); norms.reserveCapacity(vc)
        var localVerts = [SIMD3<Float>](); localVerts.reserveCapacity(vc)
        // KRÆSJ 2026-09-07 (to ganger, begge KERN_INVALID_ADDRESS på en sidegrense): ARKit
        // pakker hjørner/normaler som 3 × Float = 12 byte, men `SIMD3<Float>` er 16 byte.
        // Å lese siste element som SIMD3 leser 4 byte FORBI bufferen — treffer bufferen
        // enden av en minneside, segfaulter det. Derfor tre enkeltflyttall.
        @inline(__always) func les3(_ base: UnsafeMutableRawPointer, _ off: Int) -> SIMD3<Float> {
            let f = base.advanced(by: off).assumingMemoryBound(to: Float.self)
            return SIMD3<Float>(f[0], f[1], f[2])
        }
        for i in 0..<vc {
            let vp = les3(vBuf, vO + i * vS)
            localVerts.append(vp)
            let w4 = t * SIMD4<Float>(vp.x, vp.y, vp.z, 1)
            verts.append(SIMD3(w4.x, w4.y, w4.z))
            let np = les3(nBuf, nO + i * nS)
            norms.append(simd_normalize(nm * np))
        }
        let f = g.faces
        let total = f.count * f.indexCountPerPrimitive
        let bpi = f.bytesPerIndex
        let fBuf = f.buffer.contents()
        var faces = [UInt32](); faces.reserveCapacity(total)
        for i in 0..<total {
            let p = fBuf.advanced(by: i * bpi)
            faces.append(bpi == 2 ? UInt32(p.assumingMemoryBound(to: UInt16.self).pointee)
                                  : p.assumingMemoryBound(to: UInt32.self).pointee)
        }
        return AnchorSnap(id: anchor.identifier, verts: verts, norms: norms, faces: faces,
                          localVerts: localVerts, transform: t)
    }

    // MARK: - Veiledningsmotor

    /// «Snurrer på stedet»: mye yaw-bevegelse, nesten ingen posisjonsbevegelse siste ~4 s.
    /// Nøyaktig mønsteret som gir null baseline (ingen parallakse → drift-skall overlever,
    /// og dekningen forblir gul med baseline-kravet).
    private func rotatingInPlace() -> Bool {
        guard let last = poseHistory.last else { return false }
        var minP = last.pos, maxP = last.pos
        var yawSpan: Float = 0
        var prevYaw = last.yaw
        var samples = 0
        for e in poseHistory.reversed() {
            if last.t - e.t > 4.0 { break }
            minP = simd_min(minP, e.pos); maxP = simd_max(maxP, e.pos)
            var d = e.yaw - prevYaw
            while d > .pi { d -= 2 * .pi }
            while d < -.pi { d += 2 * .pi }
            yawSpan += abs(d)
            prevYaw = e.yaw
            samples += 1
        }
        return samples > 40 && simd_length(maxP - minP) < 0.30 && yawSpan > 1.0
    }

    /// Median LiDAR-dybde i bildesentrum — «går brukeren for langt unna?» (dekningen
    /// teller kun views < 2,5 m, så å filme rommet fra døråpningen gir ingenting).
    private static func centerDepth(_ frame: ARFrame) -> Float? {
        guard let d = frame.smoothedSceneDepth?.depthMap else { return nil }
        CVPixelBufferLockBaseAddress(d, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(d, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(d) else { return nil }
        let w = CVPixelBufferGetWidth(d), h = CVPixelBufferGetHeight(d)
        let bpr = CVPixelBufferGetBytesPerRow(d)
        var vals = [Float]()
        for oy in [-16, 0, 16] {
            for ox in [-16, 0, 16] {
                let px = w / 2 + ox, py = h / 2 + oy
                guard px >= 0, px < w, py >= 0, py < h else { continue }
                let v = base.advanced(by: py * bpr + px * 4).assumingMemoryBound(to: Float32.self).pointee
                if v > 0.05 { vals.append(v) }
            }
        }
        guard vals.count >= 4 else { return nil }
        vals.sort()
        return vals[vals.count / 2]
    }

    private func evaluateGuidance(purpleCentroid: SIMD3<Float>?, cameraTx: simd_float4x4,
                                  ceilFrac: Float, floorFrac: Float, depthCenter: Float?) {
        var target: Guide = .good
        var text = ""
        if wasTooFast {
            target = .slowDown; text = "Beveg deg saktere"
        } else if rotatingInPlace() {
            target = .strafe; text = "Gå sidelengs"
        } else if let d = depthCenter, d > 2.7 {
            target = .tooFar; text = "Gå nærmere veggen"
        } else if ceilFrac > 0.6 && -cameraTx.columns.2.y < 0.3 {
            // Undertrykkes når kameraet ALT peker opp (fy ≥ 0.3): å mase «pek mot
            // taket» mens brukeren gjør nettopp det føltes ødelagt. Og det som
            // faktisk mangler er PARALLAKSE (3 posisjoner ≥0,35 m fra hverandre) —
            // derfor står det gå, ikke bare pek.
            target = .ceiling; text = "Ta noen skritt mens du peker mot taket"
        } else if floorFrac > 0.6 && -cameraTx.columns.2.y > -0.3 {
            target = .floor; text = "Ta noen skritt mens du peker mot gulvet"
        } else if let pc = purpleCentroid {
            let camPos = SIMD3<Float>(cameraTx.columns.3.x, cameraTx.columns.3.y, cameraTx.columns.3.z)
            let fx = -cameraTx.columns.2.x
            let fz = -cameraTx.columns.2.z
            let fLen = sqrt(fx * fx + fz * fz)
            if fLen > 0.01 {
                let fnx = fx / fLen, fnz = fz / fLen
                let tx = pc.x - camPos.x, tz = pc.z - camPos.z
                let tDist = sqrt(tx * tx + tz * tz)
                if tDist > 0.5 {
                    let dot = fnx * (tx / tDist) + fnz * (tz / tDist)
                    let cross = fnx * (tz / tDist) - fnz * (tx / tDist) // + → høyre, − → venstre
                    if dot <= 0.55 {
                        if abs(cross) < 0.3 { target = .turnAround; text = "Snu deg rundt" }
                        else if cross > 0 { target = .turnRight; text = "Snu mot høyre" }
                        else { target = .turnLeft; text = "Snu mot venstre" }
                    }
                }
            }
        }
        setGuide(target, text: text)
    }

    private func setGuide(_ g: Guide, text: String) {
        if g == guide { return }
        let now = CFAbsoluteTimeGetCurrent()
        // Lavere prioritet må vente på minimum visningstid; høyere avbryter straks
        if g.rawValue < guide.rawValue && now - guideSince < 1.5 { return }
        guide = g
        guideSince = now
        guideView?.show(g, text: text)
    }

    /// Wii-aktig gest-piktogram: en TEGNET telefon-glyf som demonstrerer ønsket bevegelse i
    /// loop (kun transform/opacity-animasjoner) med én kort instruks under. Ingen symboler
    /// eller emoji i tekst — bevegelsen selv ER budskapet.
    private final class GestureGuideView: UIView {
        private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        private let stage = UIView()      // scenen glyfen beveger seg i (perspektiv for tilt/rotasjon)
        private let phone = UIView()
        private let camDot = UIView()
        private let track = CAShapeLayer() // stiplet bevegelsesbane (kun sidelengs-gesten)
        private let label = UILabel()

        override init(frame: CGRect) {
            super.init(frame: frame)
            translatesAutoresizingMaskIntoConstraints = false
            isUserInteractionEnabled = false
            blur.translatesAutoresizingMaskIntoConstraints = false
            blur.layer.cornerRadius = 22
            blur.clipsToBounds = true
            addSubview(blur)
            stage.translatesAutoresizingMaskIntoConstraints = false
            var persp = CATransform3DIdentity
            persp.m34 = -1.0 / 220
            stage.layer.sublayerTransform = persp
            blur.contentView.addSubview(stage)
            phone.layer.borderColor = UIColor.white.cgColor
            phone.layer.borderWidth = 2.5
            phone.layer.cornerRadius = 8
            phone.backgroundColor = UIColor.white.withAlphaComponent(0.10)
            stage.addSubview(phone)
            camDot.backgroundColor = .white
            camDot.layer.cornerRadius = 2.5
            phone.addSubview(camDot)
            track.strokeColor = UIColor.white.withAlphaComponent(0.35).cgColor
            track.fillColor = nil
            track.lineWidth = 2
            track.lineDashPattern = [4, 5]
            track.lineCap = .round
            track.isHidden = true
            stage.layer.addSublayer(track)
            label.translatesAutoresizingMaskIntoConstraints = false
            label.textColor = .white
            label.font = .systemFont(ofSize: 15, weight: .semibold)
            label.textAlignment = .center
            blur.contentView.addSubview(label)
            NSLayoutConstraint.activate([
                blur.topAnchor.constraint(equalTo: topAnchor),
                blur.bottomAnchor.constraint(equalTo: bottomAnchor),
                blur.leadingAnchor.constraint(equalTo: leadingAnchor),
                blur.trailingAnchor.constraint(equalTo: trailingAnchor),
                widthAnchor.constraint(equalToConstant: 200),
                stage.topAnchor.constraint(equalTo: blur.contentView.topAnchor, constant: 12),
                stage.centerXAnchor.constraint(equalTo: blur.contentView.centerXAnchor),
                stage.widthAnchor.constraint(equalToConstant: 150),
                stage.heightAnchor.constraint(equalToConstant: 76),
                label.topAnchor.constraint(equalTo: stage.bottomAnchor, constant: 6),
                label.leadingAnchor.constraint(equalTo: blur.contentView.leadingAnchor, constant: 14),
                label.trailingAnchor.constraint(equalTo: blur.contentView.trailingAnchor, constant: -14),
                label.bottomAnchor.constraint(equalTo: blur.contentView.bottomAnchor, constant: -12),
            ])
        }
        required init?(coder: NSCoder) { fatalError() }

        override func layoutSubviews() {
            super.layoutSubviews()
            let s = stage.bounds
            phone.bounds = CGRect(x: 0, y: 0, width: 30, height: 54)
            phone.center = CGPoint(x: s.midX, y: s.midY)
            camDot.frame = CGRect(x: (30 - 5) / 2, y: 6, width: 5, height: 5)
            let path = UIBezierPath()
            path.move(to: CGPoint(x: 14, y: s.midY))
            path.addLine(to: CGPoint(x: s.width - 14, y: s.midY))
            track.path = path.cgPath
        }

        func show(_ g: Guide, text: String) {
            phone.layer.removeAllAnimations()
            if g == .none || g == .good {
                guard !isHidden else { return }
                UIView.animate(withDuration: 0.25, animations: { self.alpha = 0 }) { _ in
                    self.isHidden = true; self.alpha = 1
                }
                return
            }
            if isHidden {
                isHidden = false
                alpha = 0
                UIView.animate(withDuration: 0.25) { self.alpha = 1 }
            }
            UIView.transition(with: blur, duration: 0.22, options: .transitionCrossDissolve) {
                self.label.text = text
            }
            track.isHidden = g != .strafe && g != .slowDown
            func loop(_ keyPath: String, _ from: Double, _ to: Double, _ dur: Double) -> CABasicAnimation {
                let a = CABasicAnimation(keyPath: keyPath)
                a.fromValue = from; a.toValue = to
                a.duration = dur
                a.autoreverses = true
                a.repeatCount = .infinity
                a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                return a
            }
            switch g {
            case .strafe:
                // Glyfen går sidelengs langs banen i rolig tempo: «flytt deg, ikke sving»
                phone.layer.add(loop("transform.translation.x", -44, 44, 1.4), forKey: "a")
            case .slowDown:
                // Samme bane, men DEMONSTRATIVT sakte tempo: farten er budskapet
                phone.layer.add(loop("transform.translation.x", -30, 30, 2.6), forKey: "a")
            case .tooFar:
                // Glyfen «går fremover» mot betrakteren
                phone.layer.add(loop("transform.scale", 0.82, 1.14, 1.2), forKey: "a")
            case .ceiling:
                phone.layer.add(loop("transform.rotation.x", 0, 0.85, 1.0), forKey: "a")
                phone.layer.add(loop("transform.translation.y", 2, -6, 1.0), forKey: "b")
            case .floor:
                phone.layer.add(loop("transform.rotation.x", 0, -0.85, 1.0), forKey: "a")
                phone.layer.add(loop("transform.translation.y", -2, 6, 1.0), forKey: "b")
            case .turnLeft:
                phone.layer.add(loop("transform.rotation.y", 0, -0.95, 1.0), forKey: "a")
                phone.layer.add(loop("transform.translation.x", 4, -12, 1.0), forKey: "b")
            case .turnRight:
                phone.layer.add(loop("transform.rotation.y", 0, 0.95, 1.0), forKey: "a")
                phone.layer.add(loop("transform.translation.x", -4, 12, 1.0), forKey: "b")
            case .turnAround:
                phone.layer.add(loop("transform.rotation.y", 0, .pi, 1.5), forKey: "a")
            case .good, .none:
                break
            }
        }
    }

    private static func coverageGeometry(snap: AnchorSnap, cams: [KFCam],
                                         done: inout Set<Int64>, cache: CellCache)
        -> (SCNGeometry, Int, SIMD3<Float>, Int, Int, Int, Int, Int) {
        let n = snap.verts.count
        var colors = [SIMD4<Float>](repeating: SIMD4(MeshScanPresenter.stripeRed, 1), count: n)
        var covered = [Bool](repeating: false, count: n)
        var red = 0
        var purpleSum = SIMD3<Float>(0, 0, 0)
        var purpleN = 0
        // Tak-/gulvandel som mangler dekning (normal ned = takflate, opp = gulvflate) —
        // driver «Pek mot taket/gulvet»-veiledningen.
        var ceilTotal = 0, ceilPurple = 0, floorTotal = 0, floorPurple = 0
        // Voxel-memo: vertekser i samme 10cm-celle (+ normalbøtte, så tynne vegger ikke deler)
        // har samme dekning — gjenbruk svaret. ARKit-vertekser ligger ~5cm fra hverandre, så
        // dette kutter kamera-loopen ~3-4× og vokser sublineært med meshet.
        // Celler samme pass deler svar (som før); på tvers av pass lever svaret i cachen.
        var memo = [Int64: Int](minimumCapacity: n / 2)
        for i in 0..<n {
            let v = snap.verts[i]; let nrm = snap.norms[i]
            let ax = abs(nrm.x), ay = abs(nrm.y), az = abs(nrm.z)
            let nb: Int64 = ax >= ay && ax >= az ? (nrm.x >= 0 ? 0 : 1) : (ay >= az ? (nrm.y >= 0 ? 2 : 3) : (nrm.z >= 0 ? 4 : 5))
            let qx = Int64((v.x * 10).rounded()), qy = Int64((v.y * 10).rounded()), qz = Int64((v.z * 10).rounded())
            let mkey = (qx & 0xFFFFF) | ((qy & 0xFFFFF) << 20) | ((qz & 0xFFFFF) << 40) | (nb << 60)
            var count: Int
            if let cached = memo[mkey] {
                count = cached
            } else if cache.laast.contains(mkey) {
                // Låst er låst — monotont, aldri mer kameraløkke for denne cellen.
                count = 1
                memo[mkey] = 1
            } else {
                var st = cache.tilstand[mkey] ?? CellCache.Tilstand()
                count = Int(st.antall)
                // Baseline-krav: tre views fra SAMME ståsted (bare rotasjon) gir verken
                // parallakse (fantom-carving) eller ny okklusjonsinfo — «grønt» uten å flytte
                // seg lærte brukeren å feie fort fra ett punkt. Tellende views må stå ≥0,35 m
                // fra hverandre.
                var countedPos = st.pos
                var sterk = st.sterk
                // Bare kameraer som er NYE siden cellen sist ble testet.
                let fra = min(Int(st.kameraerTestet), cams.count)
                for c in cams[fra...] {
                    let pc = c.w2c * SIMD4<Float>(v.x, v.y, v.z, 1)
                    if pc.z > -0.05 { continue }
                    let z = -pc.z
                    // Avstandskrav: TSDF-en nedvekter dybde >1,5 m og teksturen trenger
                    // pikseltetthet — et view fra 4 m er nesten verdiløst for baken. Uten
                    // dette taket ble hele rommet «grønt» fra tre oversiktsbilder.
                    if z > 3.5 { continue } // 2,5 → 3,5: baken gir godt resultat fra vanlig ståavstand (Tormod 2026-09-06)
                    let u = c.fx * (pc.x / z) + c.cx
                    let vv = c.fy * (-pc.y / z) + c.cy
                    if u < 0 || vv < 0 || u >= c.w || vv >= c.h { continue }
                    let viewDir = simd_normalize(c.camPos - v)
                    let facing = simd_dot(nrm, viewDir)
                    if facing < 0.35 { continue }
                    // Okklusjonstest: frustum-treff er IKKE dekning når møbler står i veien —
                    // det ga «grønt» på flater som bakte grått. Kun views der keyframens
                    // LiDAR-dybde bekrefter flaten (±30 cm slakk for drift) teller.
                    if c.dw > 0 {
                        let du = min(c.dw - 1, Int(u / c.w * Float(c.dw)))
                        let dv = min(c.dh - 1, Int(vv / c.h * Float(c.dh)))
                        let d = c.depth[dv * c.dw + du]
                        if d > 0.05 && abs(z - d) > 0.30 { continue }
                    }
                    var distinct = true
                    for p in countedPos where simd_distance(p, c.camPos) < 0.35 { distinct = false; break }
                    if !distinct { continue }
                    countedPos.append(c.camPos)
                    count += 1
                    // Én NÆR og FRONTAL visning er nok til å slippe stripene — det er et
                    // godt foto. Skrå/fjerne visninger krever et ståsted til.
                    if facing >= 0.5 { sterk = true } // et rimelig frontalt syn holder alene; skrått (<0,5) trenger ett ståsted til
                    if count >= 3 { break }
                }
                st.kameraerTestet = Int32(cams.count)
                st.antall = UInt8(min(count, 3))
                st.pos = countedPos
                st.sterk = sterk
                if count >= 1 { cache.laast.insert(mkey); cache.tilstand.removeValue(forKey: mkey) }
                else { cache.tilstand[mkey] = st }
                if sterk { cache.sterke.insert(mkey) }
                memo[mkey] = count
            }
            // ÉN okklusjonsbekreftet visning = TEKSTURERT = LÅST (brukerdesign 2026-08-13:
            // «where wireframe shows itll NEVER add new texture»). Visning og port deler predikat.
            // Baken låser ved ÉN bekreftet visning (done → porten og keyframe-tvangen er
            // uendret). VISNINGEN krever TO ståsteder (≥0,35 m fra hverandre) før stripene
            // slippes: én visning fra ett punkt gir verken parallakse eller okklusjonsinfo,
            // og med bare én slapp stripene så fort at bare kanten av det skannede ble
            // igjen — Tormod 2026-09-05: «Scaniverse maler mer ut». Det er dette som får
            // brukeren til å FLYTTE seg, ikke bare snurre.
            if count >= 1 { done.insert(mkey) }
            let dekket = count >= 2 || cache.sterke.contains(mkey)
            if dekket {
                covered[i] = true
                red += 1
            } else {
                purpleSum += v; purpleN += 1
            }
            // Toning: alpha glir mot målet over passene (~4 Hz) i stedet for å slå av/på.
            let maal: Float = dekket ? 0 : 1
            let a: Float
            if let gammel = cache.alpha[mkey] { a = gammel + (maal - gammel) * 0.35 } else { a = maal }
            cache.alpha[mkey] = a
            colors[i].w = MeshScanPresenter.coverageField == nil ? a : 1 // feltet styrer; CPU-alpha er reserve
            if nrm.y < -0.7 { ceilTotal += 1; if count == 0 { ceilPurple += 1 } }
            else if nrm.y > 0.7 { floorTotal += 1; if count == 0 { floorPurple += 1 } }
        }
        // Rå tellinger returneres (ikke andeler): per-anker-geometrier aggregeres i
        // updateCoverageTick, og andeler kan ikke summeres — tellinger kan.

        let maxEdgeSq: Float = 2.25
        var displayFaces = [UInt32]()
        displayFaces.reserveCapacity(snap.faces.count)
        let triCount = snap.faces.count / 3
        for t in 0..<triCount {
            let ai = Int(snap.faces[t*3]), bi = Int(snap.faces[t*3+1]), ci = Int(snap.faces[t*3+2])
            guard ai < n && bi < n && ci < n else { continue }
            // SNUDD 2026-09-05 (Scaniverse-modellen): overlegget viser det som MANGLER.
            // Trekanter der alle tre hjørner er låst tegnes IKKE — kameraet synes rent der,
            // og «tomt skjermbilde = ferdig». Alt annet får striper.
            // Hele meshen tegnes; dekningsfeltet avgjør per piksel i shaderen hva som får striper.
            let d1 = snap.verts[ai] - snap.verts[bi]
            let d2 = snap.verts[bi] - snap.verts[ci]
            let d3 = snap.verts[ci] - snap.verts[ai]
            if simd_dot(d1,d1) > maxEdgeSq || simd_dot(d2,d2) > maxEdgeSq || simd_dot(d3,d3) > maxEdgeSq { continue }
            displayFaces.append(snap.faces[t*3]); displayFaces.append(snap.faces[t*3+1]); displayFaces.append(snap.faces[t*3+2])
        }

        // SIMD3<Float> is 16-byte aligned in memory (4 bytes padding) — stride must reflect that.
        // Posisjoner i ANKER-LOKALT rom (dekningstestene over brukte world) — noden
        // som får geometrien bærer anker-transformen og synkes per frame.
        let vData = snap.localVerts.withUnsafeBufferPointer { Data(buffer: $0) }
        let vSource = SCNGeometrySource(data: vData, semantic: .vertex, vectorCount: n,
                                        usesFloatComponents: true, componentsPerVector: 3,
                                        bytesPerComponent: 4, dataOffset: 0,
                                        dataStride: MemoryLayout<SIMD3<Float>>.stride)
        let cData = colors.withUnsafeBufferPointer { Data(buffer: $0) }
        let cSource = SCNGeometrySource(data: cData, semantic: .color, vectorCount: n,
                                        usesFloatComponents: true, componentsPerVector: 4,
                                        bytesPerComponent: 4, dataOffset: 0, dataStride: 16)
        let fData = displayFaces.withUnsafeBufferPointer { Data(buffer: $0) }
        let element = SCNGeometryElement(data: fData, primitiveType: .triangles,
                                         primitiveCount: displayFaces.count / 3, bytesPerIndex: 4)
        let geometry = SCNGeometry(sources: [vSource, cSource], elements: [element])
        geometry.firstMaterial = MeshScanPresenter.coverageMaterial()
        return (geometry, red, purpleSum, purpleN, ceilTotal, ceilPurple, floorTotal, floorPurple)
    }

    /// Materialet for live-meshen: dekningsfeltet avgjør per piksel striper eller farge.
    static func coverageMaterial() -> SCNMaterial {
        let program = SCNProgram()
        // I pod: shaderne ligger i egen coverage.metallib-ressurs — app-ens default-lib
        // har dem ikke, og uten library-oppslaget vises ikke dekningswireframen.
        if let lib = MeshScanPresenter.coverageLibrary { program.library = lib }
        program.vertexFunctionName   = "coverageVert"
        program.fragmentFunctionName = "coverageFrag"
        program.isOpaque = true

        let mat = SCNMaterial()
        mat.program = program
        mat.isDoubleSided = true
        mat.writesToDepthBuffer = true
        if let felt = MeshScanPresenter.coverageField {
            // Teksturen bindes ved navn (SCNProgram/Metal); uniformene skrives per frame.
            mat.setValue(SCNMaterialProperty(contents: felt.texture), forKey: "coverageField")
            program.handleBinding(ofBufferNamed: "field", frequency: .perFrame) { stream, _, _, _ in
                var u = felt.uniforms
                withUnsafeBytes(of: &u) { stream.writeBytes($0.baseAddress!, count: $0.count) }
            }
        }
        return mat
    }

    /// RASK geometri rett fra ARKit-ankeret (2026-09-07): kopierer bare hjørner og flater,
    /// ingen dekningsregning. Brukes i didAdd/didUpdate så meshen er på skjermen i SAMME
    /// øyeblikk ARKit har den — dekningspasset (1–8 s bak i Debug) bygde den før, og
    /// imens så brukeren rått kamerabilde der feltet alt var fanget. Fargene er 1 (alpha
    /// = «striper») som CPU-reserve når feltet mangler; med felt bestemmer shaderen.
    private static func quickGeometry(_ snap: AnchorSnap) -> SCNGeometry? {
        let vc = snap.localVerts.count
        guard vc > 0, snap.faces.count >= 3 else { return nil }
        let vData = snap.localVerts.withUnsafeBufferPointer { Data(buffer: $0) }
        let vSource = SCNGeometrySource(data: vData, semantic: .vertex, vectorCount: vc,
                                        usesFloatComponents: true, componentsPerVector: 3,
                                        bytesPerComponent: 4, dataOffset: 0,
                                        dataStride: MemoryLayout<SIMD3<Float>>.stride)
        let colors = [SIMD4<Float>](repeating: SIMD4<Float>(1, 1, 1, 1), count: vc)
        let cData = colors.withUnsafeBufferPointer { Data(buffer: $0) }
        let cSource = SCNGeometrySource(data: cData, semantic: .color, vectorCount: vc,
                                        usesFloatComponents: true, componentsPerVector: 4,
                                        bytesPerComponent: 4, dataOffset: 0, dataStride: 16)
        let fData = snap.faces.withUnsafeBufferPointer { Data(buffer: $0) }
        let element = SCNGeometryElement(data: fData, primitiveType: .triangles,
                                         primitiveCount: snap.faces.count / 3, bytesPerIndex: 4)
        let geometry = SCNGeometry(sources: [vSource, cSource], elements: [element])
        geometry.firstMaterial = MeshScanPresenter.coverageMaterial()
        return geometry
    }

    /// Wireframe-shaderne (coverageVert/Frag) fra podens prekompilerte metallib-ressurs.
    static let coverageLibrary: MTLLibrary? = {
        guard let dev = MTLCreateSystemDefaultDevice() else { return nil }
        var bundles = Bundle.allBundles
        bundles.append(Bundle(for: MeshScanPresenter.self))
        if let base = Bundle(for: MeshScanPresenter.self).resourceURL,
           let subs = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil) {
            for u in subs where u.pathExtension == "bundle" {
                if let b = Bundle(url: u) { bundles.append(b) }
            }
        }
        for b in bundles {
            if let url = b.url(forResource: "coverage", withExtension: "metallib"),
               let lib = try? dev.makeLibrary(URL: url) { return lib }
        }
        NSLog("[MeshScan] coverage.metallib ikke funnet — wireframe vises ikke")
        return nil
    }()

    private func startDonePulse() {
        guard !donePulsing, let btn = doneButton else { return }
        donePulsing = true
        UIView.animate(withDuration: 0.6, delay: 0, options: [.repeat, .autoreverse, .allowUserInteraction], animations: {
            btn.transform = CGAffineTransform(scaleX: 1.08, y: 1.08)
        })
    }
}


// BEGIN CAPTURE DECISION AUDIT — Foundation-only, tested without ARKit.
/// Metadata-only timeline: no retained ARFrame, no images, no per-frame disk I/O.
/// The delegate and encoding queue may record concurrently; completion drains encoding
/// before taking a snapshot. Truncation is explicit rather than silently implying coverage.
final class CaptureDecisionAudit {
    struct Event: Codable {
        let time: Double
        let reason: String
        let bucket: String?
        let index: Int?
        let previousTime: Double?
        let score: Float?
        let previousScore: Float?
        let blur: Float?
        let motion: Float?
    }
    struct Snapshot: Codable {
        let version: Int
        let limit: Int
        let total: Int
        let dropped: Int
        let counts: [String: Int]
        let events: [Event]
    }
    private let lock = NSLock()
    private let limit: Int
    private var total = 0
    private var counts: [String: Int] = [:]
    private var events: [Event] = []
    init(limit: Int = 20000) { self.limit = max(0, limit) }
    func record(time: Double, reason: String, bucket: Int64? = nil, index: Int? = nil,
                previousTime: Double? = nil, score: Float? = nil, previousScore: Float? = nil,
                blur: Float? = nil, motion: Float? = nil) {
        guard time.isFinite else { return }
        func finite(_ value: Float?) -> Float? { value.flatMap { $0.isFinite ? $0 : nil } }
        let event = Event(time: time, reason: reason, bucket: bucket.map { String($0) }, index: index,
            previousTime: previousTime.flatMap { $0.isFinite ? $0 : nil }, score: finite(score),
            previousScore: finite(previousScore), blur: finite(blur), motion: finite(motion))
        lock.lock(); defer { lock.unlock() }
        total += 1; counts[reason, default: 0] += 1
        if events.count < limit { events.append(event) }
    }
    func data() throws -> Data {
        lock.lock()
        let snapshot = Snapshot(version: 1, limit: limit, total: total, dropped: total-events.count,
                                counts: counts, events: events)
        lock.unlock()
        return try JSONEncoder().encode(snapshot)
    }
}
// END CAPTURE DECISION AUDIT
