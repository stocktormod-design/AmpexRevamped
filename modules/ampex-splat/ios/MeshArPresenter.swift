import ARKit
import SceneKit
import UIKit

/// «Se i rommet» (§110): linjer og punkter montøren tegnet på 3D-modellen, lagt over kamerabildet
/// når han står i rommet igjen. Telefonen kjenner igjen rommet mot modellens relokaliseringskart
/// (MeshRelok) — ingen ARWorldMap, ingen ny skanning.
///
/// Gangen: dybde PÅ til første treff (RANSAC-en foreslår med 3D–3D), så AV — da følger ARKit
/// kameraet lokalt med kamera + bevegelsessensor, og vi finpusser G (modell ← økt) mot nye bilder
/// annethvert sekund, bare mot kartpunktene i synsfeltet, så overlegget ikke glir. Kartet tegnes
/// aldri — bare redigeringene, under én node med G⁻¹.
final class MeshArPresenter: NSObject, ARSessionDelegate {
    static var aktiv: MeshArPresenter?

    private let glbURL: URL
    private let linjer: [[SIMD3<Float>]]
    private let punkter: [SIMD3<Float>]
    private var host: UIViewController!
    private var sceneView: ARSCNView!
    private let kartRot = SCNNode()
    private let status = UILabel()
    private let detalj = UILabel()
    private var lok: MeshRelokLokalisator?
    private let kø = DispatchQueue(label: "ampex.relok", qos: .userInitiated)
    private var opptatt = false
    private var sist: TimeInterval = 0
    private var G: simd_double4x4?
    private var dybdePå = true
    private var config = ARWorldTrackingConfiguration()
    private var onClose: (() -> Void)?

    init(glbPath: String, linjerJson: String, punkterJson: String) {
        glbURL = URL(fileURLWithPath: glbPath)
        func tall(_ a: Any) -> SIMD3<Float>? {
            guard let p = a as? [NSNumber], p.count == 3 else { return nil }
            return SIMD3(p[0].floatValue, p[1].floatValue, p[2].floatValue)
        }
        let lj = (try? JSONSerialization.jsonObject(with: Data(linjerJson.utf8))) as? [[String: Any]] ?? []
        linjer = lj.compactMap { ($0["punkter"] as? [Any])?.compactMap(tall) }.filter { $0.count >= 2 }
        let pj = (try? JSONSerialization.jsonObject(with: Data(punkterJson.utf8))) as? [[String: Any]] ?? []
        punkter = pj.compactMap { m in
            guard let x = m["x"] as? NSNumber, let y = m["y"] as? NSNumber, let z = m["z"] as? NSNumber else { return nil }
            return SIMD3(x.floatValue, y.floatValue, z.floatValue)
        }
        super.init()
    }

    func present(from presenter: UIViewController, onClose: @escaping () -> Void) {
        self.onClose = onClose
        host = UIViewController()
        host.modalPresentationStyle = .fullScreen
        host.view.backgroundColor = .black
        sceneView = ARSCNView(frame: host.view.bounds)
        sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sceneView.session.delegate = self
        sceneView.automaticallyUpdatesLighting = false
        host.view.addSubview(sceneView)

        bygg()
        kartRot.isHidden = true
        sceneView.scene.rootNode.addChildNode(kartRot)

        // Topp: lukk + status. Hvit tekst på mørk pille (kamerabildet bak er uforutsigbart).
        let lukk = UIButton(type: .system)
        lukk.setTitle("Lukk", for: .normal)
        lukk.setTitleColor(.white, for: .normal)
        lukk.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        lukk.backgroundColor = UIColor(white: 0, alpha: 0.45)
        lukk.layer.cornerRadius = 18
        lukk.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        lukk.addTarget(self, action: #selector(lukkTrykket), for: .touchUpInside)
        lukk.translatesAutoresizingMaskIntoConstraints = false
        host.view.addSubview(lukk)
        for (l, størrelse) in [(status, CGFloat(17)), (detalj, CGFloat(12))] {
            l.textColor = .white
            l.font = .systemFont(ofSize: størrelse, weight: l === status ? .semibold : .regular)
            l.textAlignment = .center
            l.numberOfLines = 2
            l.backgroundColor = UIColor(white: 0, alpha: l === status ? 0.45 : 0)
            l.layer.cornerRadius = 14
            l.clipsToBounds = true
            l.translatesAutoresizingMaskIntoConstraints = false
            host.view.addSubview(l)
        }
        let g = host.view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            lukk.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            lukk.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            status.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -24),
            status.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            status.widthAnchor.constraint(lessThanOrEqualTo: g.widthAnchor, constant: -32),
            status.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            detalj.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 4),
            detalj.centerXAnchor.constraint(equalTo: g.centerXAnchor),
        ])

        lok = MeshRelokLokalisator(kart: MeshRelok.kartURL(glb: glbURL))
        if lok == nil {
            settStatus("Rommet mangler kart. Bygg modellen på nytt («Bygg skarpere modell»).")
        } else {
            settStatus("Sikt mot noe du skannet")
        }

        // Vanlig videoformat (1920×1440), ikke 4K som skanningen: 4K i ARKit lagget sammen med
        // gjenkjenningen. Full oppløsning her har samme pikselskala som nøkkelbildenes halve 4K
        // (begge 1920 over sensorbredden), så kartets trekk og spørrebildets trekk er like store.
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) { config.frameSemantics.insert(.sceneDepth) }
        sceneView.session.run(config)
        presenter.present(host, animated: true)
        MeshLog.log("relok: AR åpnet — \(linjer.count) linjer, \(punkter.count) punkter, kart \(lok?.antall ?? 0)")
    }

    private func bygg() {
        // Linjer som rør (6 mm tykke), punkter som kuler. Tegnes OPPÅ alt (ingen dybdetest):
        // dette er «røntgen» — en kabel bak gipsen skal synes selv om ARKit ser veggen foran.
        let farge = UIColor.systemOrange
        func mat() -> SCNMaterial {
            let m = SCNMaterial()
            m.diffuse.contents = farge
            m.lightingModel = .constant
            m.readsFromDepthBuffer = false
            m.writesToDepthBuffer = false
            return m
        }
        for l in linjer {
            for i in 0..<(l.count - 1) {
                let a = l[i], b = l[i + 1], d = b - a, len = simd_length(d)
                guard len > 1e-4 else { continue }
                let c = SCNCylinder(radius: 0.003, height: CGFloat(len))
                c.radialSegmentCount = 8
                c.firstMaterial = mat()
                let n = SCNNode(geometry: c)
                n.renderingOrder = 100
                n.simdPosition = (a + b) / 2
                n.simdOrientation = simd_quatf(from: SIMD3(0, 1, 0), to: d / len)
                kartRot.addChildNode(n)
            }
            for p in l {
                let s = SCNSphere(radius: 0.006); s.firstMaterial = mat()
                let n = SCNNode(geometry: s); n.renderingOrder = 100; n.simdPosition = p
                kartRot.addChildNode(n)
            }
        }
        for p in punkter {
            let s = SCNSphere(radius: 0.015); s.firstMaterial = mat()
            let n = SCNNode(geometry: s); n.renderingOrder = 100; n.simdPosition = p
            kartRot.addChildNode(n)
        }
    }

    private func settStatus(_ s: String, _ d: String = "") {
        DispatchQueue.main.async {
            self.status.text = "  \(s)  "
            self.detalj.text = d
        }
    }

    @objc private func lukkTrykket() {
        sceneView.session.pause()
        host.dismiss(animated: true)
        onClose?()
        MeshArPresenter.aktiv = nil
    }

    // MARK: - ARSessionDelegate

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard let lok, !opptatt, case .normal = frame.camera.trackingState else { return }
        let intervall = G == nil ? 0.5 : 2.0
        guard frame.timestamp - sist >= intervall else { return }
        let pb = frame.capturedImage
        // 4K-format (om ARKit likevel ga det): halver til nøkkelbildenes skala; ellers full Y
        guard let (luma, w, h) = CVPixelBufferGetWidth(pb) > 2000 ? Self.lumaHalv(pb) : Self.lumaHel(pb) else { return }
        sist = frame.timestamp
        opptatt = true
        let s = Double(w) / Double(CVPixelBufferGetWidth(frame.capturedImage))
        let k = frame.camera.intrinsics
        let K = SIMD4(Double(k[0][0]) * s, Double(k[1][1]) * s, Double(k[2][0]) * s, Double(k[2][1]) * s)
        let m = frame.camera.transform
        let A = simd_double4x4(columns: (SIMD4<Double>(m.columns.0), SIMD4<Double>(m.columns.1), SIMD4<Double>(m.columns.2), SIMD4<Double>(m.columns.3)))
        var dyb: [Float]?, dw = 0, dh = 0
        if G == nil, let dm = frame.sceneDepth?.depthMap { (dyb, dw, dh) = Self.kopier(dm) }
        let b = MeshRelokLokalisator.Bilde(luma: luma, w: w, h: h, K: K, A: A, dybde: dyb, dw: dw, dh: dh)
        let G0 = G
        kø.async { [weak self] in
            guard let self else { return }
            let t0 = CFAbsoluteTimeGetCurrent()
            let svar = lok.finn(b, G0: G0)
            let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
            DispatchQueue.main.async {
                self.opptatt = false
                guard let svar else {
                    if self.G == nil { self.settStatus("Sikt mot noe du skannet", String(format: "leter … %.0f ms", ms)) }
                    return
                }
                self.oppdater(svar, ms: ms)
            }
        }
    }

    private func oppdater(_ svar: MeshRelokLokalisator.Svar, ms: Double) {
        if let gammel = G {
            // finpuss: halvveis mot den nye (demper sprang, følger glidningen)
            let qa = simd_quatd(Self.rot(gammel)), qb = simd_quatd(Self.rot(svar.G))
            let R = simd_double3x3(simd_slerp(qa, qb, 0.5))
            let t = (gammel.columns.3 + svar.G.columns.3) / 2
            G = simd_double4x4(columns: (SIMD4(R.columns.0, 0), SIMD4(R.columns.1, 0), SIMD4(R.columns.2, 0), t))
        } else {
            G = svar.G
            MeshLog.log(String(format: "relok: låst — %d/%d inliers, rest %.2f px, %.0f ms", svar.inliers, svar.treff, svar.restPx, ms))
            if dybdePå {   // dybden trengs bare til første treff
                dybdePå = false
                config.frameSemantics.remove(.sceneDepth)
                sceneView.session.run(config)
            }
        }
        guard let G else { return }
        let Gi = G.inverse
        kartRot.simdTransform = simd_float4x4(columns: (SIMD4<Float>(Gi.columns.0), SIMD4<Float>(Gi.columns.1), SIMD4<Float>(Gi.columns.2), SIMD4<Float>(Gi.columns.3)))
        kartRot.isHidden = false
        settStatus(linjer.isEmpty && punkter.isEmpty ? "Funnet — ingen linjer tegnet ennå" : "Funnet",
                   String(format: "%d punkter · %.1f px · %.0f ms", svar.inliers, svar.restPx, ms))
    }

    // MARK: - hjelpere

    private static func rot(_ m: simd_double4x4) -> simd_double3x3 {
        simd_double3x3(columns: (SIMD3(m.columns.0.x, m.columns.0.y, m.columns.0.z), SIMD3(m.columns.1.x, m.columns.1.y, m.columns.1.z),
                                 SIMD3(m.columns.2.x, m.columns.2.y, m.columns.2.z)))
    }

    /// Y-planet i halv oppløsning — samme 2×2-snitt som nøkkelbildenes `luma-<i>.u8`.
    static func lumaHalv(_ pb: CVPixelBuffer) -> ([UInt8], Int, Int)? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        let p = base.assumingMemoryBound(to: UInt8.self)
        let hw = w / 2, hh = h / 2
        var ut = [UInt8](repeating: 0, count: hw * hh)
        ut.withUnsafeMutableBufferPointer { o in
            for y in 0..<hh {
                let r0 = p + (y * 2) * stride, r1 = r0 + stride
                for x in 0..<hw {
                    let i = x * 2
                    let a: Int = Int(r0[i]) + Int(r0[i + 1])
                    let b: Int = Int(r1[i]) + Int(r1[i + 1])
                    o[y * hw + x] = UInt8((a + b + 2) / 4)
                }
            }
        }
        return (ut, hw, hh)
    }

    static func lumaHel(_ pb: CVPixelBuffer) -> ([UInt8], Int, Int)? {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
        var ut = [UInt8](repeating: 0, count: w * h)
        ut.withUnsafeMutableBytes { o in
            for y in 0..<h { memcpy(o.baseAddress! + y * w, base + y * stride, w) }
        }
        return (ut, w, h)
    }

    private static func kopier(_ pb: CVPixelBuffer) -> ([Float]?, Int, Int) {
        CVPixelBufferLockBaseAddress(pb, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return (nil, 0, 0) }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), stride = CVPixelBufferGetBytesPerRow(pb)
        var ut = [Float](repeating: 0, count: w * h)
        for y in 0..<h {
            let rad = (base + y * stride).assumingMemoryBound(to: Float32.self)
            for x in 0..<w { ut[y * w + x] = rad[x] }
        }
        return (ut, w, h)
    }
}
