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
    private var keyframeReserved = 0          // gate/index, delegate thread only
    private var lastKeyframeTime: Double = -1
    private var lastKeyframePos: SIMD3<Float>?
    private var lastKeyframeFwd: SIMD3<Float>?

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
    private static let defaultHint = "Gå sidelengs og mal rommet — rutenettet er ferdig tekstur"

    // Én node per ARMeshAnchor, EID av ARSCNView (didAdd/didRemove) — SceneKit synker
    // transformene på render-tråden, vi henger bare wireframe-geometri på dem ved tikk.
    private var coverageNodes: [UUID: SCNNode] = [:]
    private var coverageTimer: Timer?
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
    private static let lockGreen = SIMD3<Float>(0.204, 0.780, 0.349) // #34C759 — teksturert/låst wireframe

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
                    if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
                    if device.isWhiteBalanceModeSupported(.locked) { device.whiteBalanceMode = .locked }
                    device.unlockForConfiguration()
                    self?.aeLockTime = CACurrentMediaTime() // samme klokkedomene som ARFrame.timestamp
                    // Celler som rakk å bli FERDIG før låsen er stemplet på frames baken selv
                    // mistror (preLock vektes 0,6 i vinnervalget) — og doneCells vokser monotont,
                    // så uten dette kan de aldri fikses ved å gå tilbake. Nullstilling her er
                    // nesten gratis: låsen slår inn 1,5 s ut i skannet, så settet er lite.
                    if let n = self?.doneCells.count, n > 0 {
                        self?.doneCells.removeAll(keepingCapacity: true)
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
            makeDot(MeshScanPresenter.lockGreen), makeLegendLabel("Teksturert – låst"),
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
        writeKeyframesManifest()
        NSLog("[MeshScan] colour diag — framesProcessed=\(sampleFramesProcessed) vertsConsidered=\(sampleVertsConsidered) rejectedBehind=\(sampleRejectedBehind) rejectedOffscreen=\(sampleRejectedOffscreen) hits=\(sampleHits) voxelsFilled=\(colorAccum.count) keyframes=\(keyframes.count) framesDir=\(framesDir?.lastPathComponent ?? "nil")")
        MeshLog.log("porten — \(gateRejected) frames avvist totalt, \(doneCells.count) ferdig-celler")
        // Erstatningsbufferets fasit: `nye` = distinkte ståsteder, `erstattet` = gjenbesøk som
        // faktisk forbedret plassen sin, `ikke bedre` = gjenbesøk som tapte mot det som lå der.
        // Er `erstattet` + `ikke bedre` ~0 over flere runder, treffer ikke bøttene hverandre og
        // den anker-lokale nøkkelen er feil — da hjelper ikke flere runder.
        let (n, r, w) = captureQueue.sync { (kfNew, kfReplaced, kfNotBetter) }
        MeshLog.log("fartsporten — \(tooFastRejected) rammer sluppet (grense 1,1 m/s / 2,0 rad/s)")
        MeshLog.log("erstatningsbuffer — \(n) nye bøtter, \(r) erstattet, \(w) ikke bedre (kadens \(bucketCadence)s)")
        if anchors.isEmpty {
            finish(.failure(MeshScanError.noMeshData))
            return
        }
        // Baking can take many seconds — run it off the main thread with a progress overlay so the
        // watchdog never kills us and the UI stays responsive.
        showBuildingOverlay()
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
        // Pose-historikk til veiledningen (billig; trimmes til ~5 s i deteksjonen)
        let cm = frame.camera.transform
        poseHistory.append((frame.timestamp,
                            SIMD3<Float>(cm.columns.3.x, cm.columns.3.y, cm.columns.3.z),
                            atan2(-cm.columns.2.z, -cm.columns.2.x)))
        if poseHistory.count > 400 { poseHistory.removeFirst(poseHistory.count - 400) }
        maybeCaptureKeyframe(frame)
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
                let vp = vBuf.advanced(by: vOffset + i * vStride).assumingMemoryBound(to: SIMD3<Float>.self).pointee
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
        let tooFast = linSpeed > 0.7 || angSpeed > 1.2                    // ~70°/s
        if tooFast == wasTooFast { return }
        wasTooFast = tooFast
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let label = self.hintLabel else { return }
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
        guard case .normal = frame.camera.trackingState else { return }

        let t = frame.timestamp
        let cam = frame.camera
        let m = cam.transform
        let pos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        let fwd = simd_normalize(SIMD3<Float>(-m.columns.2.x, -m.columns.2.y, -m.columns.2.z))

        if lastKeyframeTime >= 0 {
            if t - lastKeyframeTime < MeshScanPresenter.keyframeMinInterval { return }
            let moved = lastKeyframePos.map { simd_distance($0, pos) } ?? .greatestFiniteMagnitude
            let rotDot = lastKeyframeFwd.map { simd_dot($0, fwd) } ?? -1
            if moved < MeshScanPresenter.keyframeMinMove && rotDot > MeshScanPresenter.keyframeMinRotateDot { return }
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
            // Én dispatch per bøtte per `bucketCadence`: nok til at bøtta får kandidater å
            // velge mellom, lite nok til at captureQueue ikke bygger kø av 4K-kopier.
            if let last = bucketLastDispatch[b], t - last < bucketCadence {
                gateRejected += 1
                return
            }
            nearestAnchor = nearest
            bucket = b
        } else if !doneCells.isEmpty {
            if t - lastNoveltyCheck < 0.15 { return } // takt: porten dømmer maks ~7 Hz
            lastNoveltyCheck = t
            if let novelty = frameNovelty(frame), novelty < 0.12 {
                gateRejected += 1
                if gateRejected % 60 == 1 {
                    MeshLog.log(String(format: "nyhetsporten (uten anker) — frame avvist (%.0f%% nytt i sikte), %d avvist så langt", novelty * 100, gateRejected))
                }
                return
            }
        }

        // Copy the pixel buffer immediately so ARKit can recycle the frame, then encode off-thread.
        guard let copy = MeshScanPresenter.copyPixelBuffer(frame.capturedImage) else { return }
        lastKeyframeTime = t
        lastKeyframePos = pos
        lastKeyframeFwd = fwd
        if let b = bucket { bucketLastDispatch[b] = t }
        storeKeyframe(frame: frame, copy: copy, targetWidth: kfTargetWidth,
                      isPlaneShot: false, nearest: nearestAnchor, viewKey: bucket)
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
            let motion = self.lastLinSpeed + 0.5 * self.lastAngSpeed  // camera speed at capture (lower = steadier)

            // ── Erstatningsavgjørelsen. Tas FØR JPEG-encodingen: en kandidat som ikke slår
            // plassen sin skal ikke koste encode-tid eller varme (regel 8).
            // Scoren er identisk med `selectCoverageAware`s (skarphet dempet av bevegelse), så
            // fangst og bake-utvalg rangerer likt.
            let score = sharp / (1 + 2 * motion)
            var replaceSlot: Int? = nil
            let idx: Int
            if !isPlaneShot, let b = viewKey, let existing = self.bucketSlot[b],
               self.keyframes.indices.contains(existing) {
                let old = self.keyframes[existing]
                let oldScore = old.sharpness / (1 + 2 * old.motion)
                // Hysterese 15 %: uten den ville jevnbyrdige kandidater tvunget fram en ny
                // encode hver runde — fem runder = fem ganger encode-lasten for ingenting.
                guard score > oldScore * 1.15 else { self.kfNotBetter += 1; return }
                replaceSlot = existing
                idx = old.index // overskriv SAMME filer — lagringen vokser ikke av gjenbesøk
                self.kfReplaced += 1
            } else {
                // Nytt ståsted: taket gjelder her, mot antall LAGREDE frames.
                guard isPlaneShot || self.keyframes.count < MeshScanPresenter.maxKeyframes else { return }
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
                  let jpeg = self.ciContext.jpegRepresentation(of: img, colorSpace: cs, options: jpegOpts) else { return }
            let fname = "frame-\(idx).jpg"
            do { try jpeg.write(to: dir.appendingPathComponent(fname), options: .atomic) } catch { return }

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
                anchorID: kfAnchorID,
                relTransform: kfRel,
                preLock: nil,
                isPlaneShot: isPlaneShot ? true : nil
            )
            if let slot = replaceSlot {
                self.keyframes[slot] = kf // samme plass, samme filnavn — bøtta beholder én frame
            } else {
                self.keyframes.append(kf)
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
        guard anchor is ARMeshAnchor else { return }
        let id = anchor.identifier
        DispatchQueue.main.async { self.coverageNodes[id] = node }
    }

    func renderer(_ renderer: SCNSceneRenderer, didRemove node: SCNNode, for anchor: ARAnchor) {
        guard anchor is ARMeshAnchor else { return }
        let id = anchor.identifier
        DispatchQueue.main.async { self.coverageNodes.removeValue(forKey: id) }
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
        if coverageBusy { return }
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
        let snaps = meshAnchors.map { MeshScanPresenter.snapshot($0) }
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
                let (geo, red, pSum, pN, cT, cP, fT, fP) = MeshScanPresenter.coverageGeometry(snap: s, cams: cams, done: &doneUnion)
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
                self.coverageStride = max(1, min(8, Int(elapsed / 0.25) + 1))
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
        for i in 0..<vc {
            let vp = vBuf.advanced(by: vO + i * vS).assumingMemoryBound(to: SIMD3<Float>.self).pointee
            localVerts.append(vp)
            let w4 = t * SIMD4<Float>(vp.x, vp.y, vp.z, 1)
            verts.append(SIMD3(w4.x, w4.y, w4.z))
            let np = nBuf.advanced(by: nO + i * nS).assumingMemoryBound(to: SIMD3<Float>.self).pointee
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
                                         done: inout Set<Int64>)
        -> (SCNGeometry, Int, SIMD3<Float>, Int, Int, Int, Int, Int) {
        let n = snap.verts.count
        let colors = [SIMD4<Float>](repeating: SIMD4(lockGreen, 1), count: n)
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
            } else {
                count = 0
                // Baseline-krav: tre views fra SAMME ståsted (bare rotasjon) gir verken
                // parallakse (fantom-carving) eller ny okklusjonsinfo — «grønt» uten å flytte
                // seg lærte brukeren å feie fort fra ett punkt. Tellende views må stå ≥0,35 m
                // fra hverandre.
                var countedPos = [SIMD3<Float>]()
                for c in cams {
                    let pc = c.w2c * SIMD4<Float>(v.x, v.y, v.z, 1)
                    if pc.z > -0.05 { continue }
                    let z = -pc.z
                    // Avstandskrav: TSDF-en nedvekter dybde >1,5 m og teksturen trenger
                    // pikseltetthet — et view fra 4 m er nesten verdiløst for baken. Uten
                    // dette taket ble hele rommet «grønt» fra tre oversiktsbilder.
                    if z > 2.5 { continue }
                    let u = c.fx * (pc.x / z) + c.cx
                    let vv = c.fy * (-pc.y / z) + c.cy
                    if u < 0 || vv < 0 || u >= c.w || vv >= c.h { continue }
                    let viewDir = simd_normalize(c.camPos - v)
                    if simd_dot(nrm, viewDir) < 0.35 { continue }
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
                    if count >= 3 { break }
                }
                memo[mkey] = count
            }
            // ÉN okklusjonsbekreftet visning = TEKSTURERT = LÅST (brukerdesign 2026-08-13:
            // «where wireframe shows itll NEVER add new texture»). Visning og port deler predikat.
            if count >= 1 {
                done.insert(mkey)
                covered[i] = true
                red += 1
            } else {
                purpleSum += v; purpleN += 1
            }
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
            // KUN teksturerte triangler tegnes — utekstuert flate er usynlig (kameraet synes
            // rent der), så «wireframe = låst» blir en eksakt kontrakt, ikke en fargekode.
            guard covered[ai] && covered[bi] && covered[ci] else { continue }
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
        let program = SCNProgram()
        // I pod: shaderne ligger i egen coverage.metallib-ressurs — app-ens default-lib
        // har dem ikke, og uten library-oppslaget vises ikke dekningswireframen.
        if let lib = MeshScanPresenter.coverageLibrary { program.library = lib }
        program.vertexFunctionName   = "coverageVert"
        program.fragmentFunctionName = "coverageFrag"
        program.isOpaque = false

        let mat = SCNMaterial()
        mat.program = program
        mat.isDoubleSided = true
        mat.writesToDepthBuffer = true
        geometry.firstMaterial = mat
        return (geometry, red, purpleSum, purpleN, ceilTotal, ceilPurple, floorTotal, floorPurple)
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
