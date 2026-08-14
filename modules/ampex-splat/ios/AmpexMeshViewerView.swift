import ExpoModulesCore
import SceneKit

// 3D-viewer for teksturert mesh (GLB fra juni-pipelinen). SceneKits innebygde
// kamerakontroll gir orbit/pinch/pan gratis — dra for å snurre, klyp for å zoome.
//
// GLB-en leses med en liten skreddersydd parser (AmpexGlbLoader) i stedet for et
// bibliotek: GLTFKit2 fins ikke på CocoaPods, og fila er vår egen (ARMeshGlbExporter
// skriver alltid samme layout: accessor 0=POSITION f32x3, 1=NORMAL f32x3,
// 2=TEXCOORD_0 f32x2, 3=indices u32, image i bufferView 4).
public final class AmpexMeshViewerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AmpexMeshViewer")
    View(AmpexMeshViewerView.self) {
      Events("onTapPoint", "onTapMarker")
      Prop("glbPath") { (view: AmpexMeshViewerView, path: String) in
        view.load(path: path)
      }
      // Kun i «Merk»-modus fyres onTapPoint for NYE punkter — eksisterende pinner
      // (onTapMarker) kan alltid trykkes, uansett modus (bare det å inspisere ett).
      Prop("markerMode") { (view: AmpexMeshViewerView, on: Bool) in
        view.markerMode = on
      }
      // JSON-array [{id,x,y,z}] — full erstatning hver gang (enkelt å diffe fra JS-siden).
      Prop("markers") { (view: AmpexMeshViewerView, json: String) in
        view.setMarkers(json: json)
      }
    }
  }
}

// Førsteperson-navigasjon (rom skannes innenfra — orbit gir feil følelse):
//   1 finger dra  = se deg rundt (yaw/pitch)
//   klyp          = gå framover/bakover langs blikket
//   2 fingre dra  = flytt sideveis/opp-ned
//   dobbelttrykk  = tilbake til start (ARKit-origo = der skannet startet)
//   ett trykk     = sett/velg 3D-punkt (kun i markerMode for NYE punkter — eksisterende
//                   pinner kan alltid velges, jf. onTap)
public final class AmpexMeshViewerView: ExpoView {
  private let scnView = SCNView(frame: .zero)
  private var loadedPath: String?

  private let camNode = SCNNode()
  private let markersNode = SCNNode() // container for punkt-pinner, lagt til scenen ved load()
  private var yaw: Float = 0
  private var pitch: Float = 0
  private var pos = SIMD3<Float>(0, 0, 0)
  private var lastLook = CGPoint.zero
  private var lastMove = CGPoint.zero
  private var lastPinch: CGFloat = 1

  let onTapPoint = EventDispatcher()
  let onTapMarker = EventDispatcher()
  var markerMode: Bool = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    scnView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    scnView.autoenablesDefaultLighting = true
    // Mellomgrå, ikke nær-svart: LiDAR gir aldri retur på glass/skjermer, så meshen HAR hull —
    // mot svart skriker de («svarte flekker»), mot grå leses de som skygge. Hvit går ikke
    // (skann-overlayet er hvit tekst).
    scnView.backgroundColor = UIColor(white: 0.42, alpha: 1)
    scnView.antialiasingMode = .multisampling4X
    addSubview(scnView)

    let camera = SCNCamera()
    camera.zNear = 0.02          // innendørs — ikke klipp vegger på nært hold
    camera.zFar = 200
    camera.fieldOfView = 70
    camNode.camera = camera

    let look = UIPanGestureRecognizer(target: self, action: #selector(onLook(_:)))
    look.maximumNumberOfTouches = 1
    scnView.addGestureRecognizer(look)
    let move = UIPanGestureRecognizer(target: self, action: #selector(onMove(_:)))
    move.minimumNumberOfTouches = 2
    move.maximumNumberOfTouches = 2
    scnView.addGestureRecognizer(move)
    scnView.addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(onWalk(_:))))
    let reset = UITapGestureRecognizer(target: self, action: #selector(onReset))
    reset.numberOfTapsRequired = 2
    scnView.addGestureRecognizer(reset)
    let tap = UITapGestureRecognizer(target: self, action: #selector(onTap(_:)))
    tap.numberOfTapsRequired = 1
    tap.require(toFail: reset) // ikke fyr ett-trykk før dobbelttrykk er utelukket
    scnView.addGestureRecognizer(tap)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    scnView.frame = bounds
  }

  func load(path: String) {
    guard path != loadedPath else { return }
    loadedPath = path
    guard FileManager.default.fileExists(atPath: path) else {
      // Fila borte (slettet skann) → blank scenen; ellers blir forrige modell stående
      // i det gjenbrukte native-viewet og «den gamle kommer opp uansett».
      scnView.scene = nil
      NSLog("[MeshViewer] GLB finnes ikke: \(path)")
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let node = AmpexGlbLoader.loadNode(path: path) else {
        DispatchQueue.main.async { self?.scnView.scene = nil }
        NSLog("[MeshViewer] GLB-lasting feilet: \(path)")
        return
      }
      DispatchQueue.main.async {
        guard let self else { return }
        // Pinner hører til en spesifikk skann-revisjon — nullstill til JS sender riktig sett for DENNE glb-en.
        self.markersNode.childNodes.forEach { $0.removeFromParentNode() }
        let scene = SCNScene()
        scene.rootNode.addChildNode(node)
        scene.rootNode.addChildNode(self.markersNode)
        scene.rootNode.addChildNode(self.camNode)
        self.scnView.scene = scene
        self.scnView.pointOfView = self.camNode
        self.onReset()
      }
    }
  }

  /// Full erstatning av punkt-pinner fra JSON `[{id,x,y,z}]`. Kalles på nytt ved enhver
  /// endring i markørlista (nytt/slettet punkt) — enkelt å resonnere om, listene er små.
  func setMarkers(json: String) {
    markersNode.childNodes.forEach { $0.removeFromParentNode() }
    guard let data = json.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    for m in arr {
      guard let id = m["id"] as? String,
            let x = m["x"] as? Double, let y = m["y"] as? Double, let z = m["z"] as? Double else { continue }
      let sphere = SCNSphere(radius: 0.028)
      sphere.firstMaterial?.diffuse.contents = UIColor(red: 0.663, green: 0.486, blue: 0.310, alpha: 1) // #A97C4F — Ampex kobber
      sphere.firstMaterial?.lightingModel = .constant
      let node = SCNNode(geometry: sphere)
      node.name = "marker:\(id)"
      node.position = SCNVector3(x, y, z)
      node.constraints = [SCNBillboardConstraint()] // alltid kameravendt — synlig fra alle vinkler
      markersNode.addChildNode(node)
    }
  }

  /// Trykk på en eksisterende pinne kan alltid velges (inspiser/rediger/slett i JS).
  /// Trykk på selve meshen plasserer et NYTT punkt kun når markerMode er på.
  @objc private func onTap(_ g: UITapGestureRecognizer) {
    guard scnView.scene != nil else { return }
    let p = g.location(in: scnView)
    guard let hit = scnView.hitTest(p, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue]).first else { return }
    if let name = hit.node.name, name.hasPrefix("marker:") {
      onTapMarker(["id": String(name.dropFirst("marker:".count))])
    } else if markerMode {
      onTapPoint([
        "x": Double(hit.worldCoordinates.x), "y": Double(hit.worldCoordinates.y), "z": Double(hit.worldCoordinates.z),
      ])
    }
  }

  private var orientation: simd_quatf {
    simd_quatf(angle: yaw, axis: SIMD3(0, 1, 0)) * simd_quatf(angle: pitch, axis: SIMD3(1, 0, 0))
  }

  private func updateCamera() {
    camNode.simdOrientation = orientation
    camNode.simdPosition = pos
  }

  @objc private func onReset() {
    // ARKit-origo = enhetens pose da skannet startet → naturlig ståsted i rommet.
    yaw = 0; pitch = 0; pos = SIMD3(0, 0, 0)
    updateCamera()
  }

  @objc private func onLook(_ g: UIPanGestureRecognizer) {
    let p = g.translation(in: scnView)
    if g.state == .began { lastLook = p; return }
    guard g.state == .changed else { return }
    yaw -= Float(p.x - lastLook.x) * 0.0045
    pitch -= Float(p.y - lastLook.y) * 0.0045
    pitch = max(-1.45, min(1.45, pitch))
    lastLook = p
    updateCamera()
  }

  @objc private func onWalk(_ g: UIPinchGestureRecognizer) {
    if g.state == .began { lastPinch = g.scale; return }
    guard g.state == .changed else { return }
    let forward = orientation.act(SIMD3(0, 0, -1))
    pos += forward * Float(g.scale - lastPinch) * 2.5
    lastPinch = g.scale
    updateCamera()
  }

  @objc private func onMove(_ g: UIPanGestureRecognizer) {
    let p = g.translation(in: scnView)
    if g.state == .began { lastMove = p; return }
    guard g.state == .changed else { return }
    let right = orientation.act(SIMD3(1, 0, 0))
    let dx = Float(p.x - lastMove.x), dy = Float(p.y - lastMove.y)
    pos += right * (-dx * 0.004) + SIMD3(0, 1, 0) * (dy * 0.004) // dra verden med deg
    lastMove = p
    updateCamera()
  }
}

// MARK: - Minimal GLB-parser for våre egne filer

enum AmpexGlbLoader {
  /// Render en forhåndsvisning (JPEG ved siden av GLB-en: `<sti>.jpg`) fra ARKit-origo —
  /// samme utsnitt som vieweren åpner i. Brukes til skann-kortene i appen.
  static func renderThumbnail(glbPath: String, size: CGSize = CGSize(width: 720, height: 540)) {
    guard let node = loadNode(path: glbPath), let device = MTLCreateSystemDefaultDevice() else { return }
    let scene = SCNScene()
    scene.background.contents = UIColor(white: 0.42, alpha: 1) // samme som vieweren — hull blir grå, ikke svarte
    scene.rootNode.addChildNode(node)
    let camNode = SCNNode()
    let cam = SCNCamera()
    cam.zNear = 0.02; cam.zFar = 200; cam.fieldOfView = 70
    camNode.camera = cam
    scene.rootNode.addChildNode(camNode)
    let renderer = SCNRenderer(device: device, options: nil)
    renderer.scene = scene
    renderer.pointOfView = camNode
    renderer.autoenablesDefaultLighting = true
    let img = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
    if let jpg = img.jpegData(compressionQuality: 0.82) {
      try? jpg.write(to: URL(fileURLWithPath: glbPath + ".jpg"))
    }
  }
  /// Leser en GLB skrevet av ARMeshGlbExporter.writeTexturedGlb og bygger en SCNNode.
  static func loadNode(path: String) -> SCNNode? {
    guard let file = try? Data(contentsOf: URL(fileURLWithPath: path)), file.count > 20 else { return nil }

    func u32(_ off: Int) -> UInt32 {
      file.subdata(in: off..<off + 4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    }
    guard u32(0) == 0x46546C67 else { return nil } // "glTF"

    // Chunks: [len][type][payload]… — første JSON, andre BIN
    var off = 12
    var jsonData: Data?
    var bin: Data?
    while off + 8 <= file.count {
      let len = Int(u32(off)), type = u32(off + 4)
      guard off + 8 + len <= file.count else { return nil }
      let payload = file.subdata(in: (off + 8)..<(off + 8 + len))
      if type == 0x4E4F534A { jsonData = payload }        // "JSON"
      else if type == 0x004E4942 { bin = payload }        // "BIN\0"
      off += 8 + len
    }
    guard let jsonData, let bin,
          let json = (try? JSONSerialization.jsonObject(with: jsonData)) as? [String: Any],
          let accessors = json["accessors"] as? [[String: Any]], accessors.count >= 4,
          let views = json["bufferViews"] as? [[String: Any]] else { return nil }

    func slice(view vi: Int) -> Data? {
      guard vi < views.count,
            let o = views[vi]["byteOffset"] as? Int, let l = views[vi]["byteLength"] as? Int,
            o + l <= bin.count else { return nil }
      return bin.subdata(in: o..<(o + l))
    }
    func accessorData(_ ai: Int) -> (data: Data, count: Int)? {
      guard ai < accessors.count,
            let vi = accessors[ai]["bufferView"] as? Int,
            let count = accessors[ai]["count"] as? Int,
            let d = slice(view: vi) else { return nil }
      return (d, count)
    }
    guard let pos = accessorData(0), let norm = accessorData(1),
          let uv = accessorData(2), let idx = accessorData(3) else { return nil }

    let posSrc = SCNGeometrySource(
      data: pos.data, semantic: .vertex, vectorCount: pos.count, usesFloatComponents: true,
      componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
    let normSrc = SCNGeometrySource(
      data: norm.data, semantic: .normal, vectorCount: norm.count, usesFloatComponents: true,
      componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
    let uvSrc = SCNGeometrySource(
      data: uv.data, semantic: .texcoord, vectorCount: uv.count, usesFloatComponents: true,
      componentsPerVector: 2, bytesPerComponent: 4, dataOffset: 0, dataStride: 8)
    let element = SCNGeometryElement(
      data: idx.data, primitiveType: .triangles, primitiveCount: idx.count / 3, bytesPerIndex: 4)

    let geo = SCNGeometry(sources: [posSrc, normSrc, uvSrc], elements: [element])
    let mat = SCNMaterial()
    // Teksturen ER lyset (bakt fra foto) — konstant belysning viser den ærlig.
    mat.lightingModel = .constant
    mat.isDoubleSided = true
    if let imgVi = ((json["images"] as? [[String: Any]])?.first?["bufferView"]) as? Int,
       let texData = slice(view: imgVi), let img = UIImage(data: texData) {
      mat.diffuse.contents = img
      mat.diffuse.wrapS = .clamp
      mat.diffuse.wrapT = .clamp
      mat.diffuse.mipFilter = .linear
      // Anisotropi: uten denne mipmap-blurres alle flater sett skrått (vegger langs rommet)
      // — verifisert offline å gi tydelig skarpere paneler/stoff i grazing-vinkler.
      mat.diffuse.maxAnisotropy = 16
    } else {
      mat.diffuse.contents = UIColor(white: 0.7, alpha: 1) // fallback: uteksturert
    }
    geo.materials = [mat]
    return SCNNode(geometry: geo)
  }
}
