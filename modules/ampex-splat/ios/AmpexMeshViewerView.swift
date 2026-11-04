import ExpoModulesCore
import SceneKit
import ImageIO
import MetalKit

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
      // §110: planlagte linjer (kabelføringer) — JSON [{id, punkter: [[x,y,z], …]}], full erstatning.
      Prop("lines") { (view: AmpexMeshViewerView, json: String) in
        view.setLines(json: json)
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
  private let linesNode = SCNNode()   // planlagte linjer (§110)
  private var yaw: Float = 0
  private var pitch: Float = 0
  private var pos = SIMD3<Float>(0, 0, 0)
  private var lastLook = CGPoint.zero
  private var lastMove = CGPoint.zero
  private var lastPinch: CGFloat = 1
  /// Hus over teksturbudsjettet: nære fliser i full oppløsning (`TeksturLod`), vurdert på nytt
  /// når kameraet har gått mer enn `lodSteg` siden sist.
  private var lod: TeksturLod?
  private var lodFra = SIMD3<Float>(0, 0, 0)
  private let lodSteg: Float = 0.75
  /// Blokkpyramiden (§128) når den finnes for skannet: tekstur etter hva som synes på skjermen.
  private var blokkLod: BlokkLod?

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
      scnView.scene = nil; lod = nil; blokkLod = nil
      NSLog("[MeshViewer] GLB finnes ikke: \(path)")
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      // .ply = konstruert splat (MeshSplatBuild), alt annet = teksturert GLB. Begge ender
      // som en SCNNode, så navigasjon, markører og reset nedenfor er felles.
      // MÅLES fordi tiden fra knappetrykk til ferdig modell er MYE lengre enn bakens egen
      // 25 s, og denne lastingen — inkludert dekoding av et 6144² JPEG-atlas — er det
      // eneste steget etter baken som ikke har vært synlig i pipeline.log.
      let tLoad = CFAbsoluteTimeGetCurrent()
      // Blokkpyramiden først (§128). Finnes den ikke, vises GLB-en som før og pyramiden bygges i
      // bakgrunnen til neste gang. `meshscan.blokker off` slår begge av.
      let blokkPå = UserDefaults.standard.string(forKey: "meshscan.blokker") != "off" && !path.hasSuffix(".ply")
      let blokker = blokkPå ? Blokkpyramide.ferdig(path).flatMap { BlokkLod(mappe: $0) } : nil
      // Mens pyramiden bygges, får GLB-en bare en forhåndsvisning (4 × 2048²). Fullt budsjett
      // (4 × 8192², ~1,4 GB med mipmaps) pluss byggets dekoding drepte appen på telefonen da
      // Tormod så seg rundt i aca96f6e, og en fjerdedel holdt ikke for huset rett etter
      // «Bygg om modellen» (1774 Mpx, 01.11; ingen krasjrapport). Neste åpning har pyramiden.
      let glbBudsjett = blokkPå && blokker == nil ? 4 * 2048 * 2048 : 4 * 8192 * 8192
      let lastet = blokker.map { ($0.rot, nil as TeksturLod?) }
        ?? (path.hasSuffix(".ply") ? MeshSplatView.loadNode(path: path).map { ($0, nil as TeksturLod?) }
                                   : AmpexGlbLoader.lastNode(path: path, nærFørst: false, budsjett: glbBudsjett))
      if blokkPå, blokker == nil, lastet != nil { Blokkpyramide.byggIBakgrunnen(path) }
      let loaded = lastet?.0
      MeshLog.log(String(format: "MeshViewer: lasting av %@ tok %.1fs",
                         (path as NSString).lastPathComponent, CFAbsoluteTimeGetCurrent() - tLoad))
      guard let node = loaded else {
        DispatchQueue.main.async { self?.scnView.scene = nil; self?.lod = nil; self?.blokkLod = nil }
        NSLog("[MeshViewer] lasting feilet: \(path)")
        return
      }
      DispatchQueue.main.async {
        guard let self else { return }
        // Pinner hører til en spesifikk skann-revisjon — nullstill til JS sender riktig sett for DENNE glb-en.
        self.markersNode.childNodes.forEach { $0.removeFromParentNode() }
        let scene = SCNScene()
        scene.rootNode.addChildNode(node)
        scene.rootNode.addChildNode(self.markersNode)
        scene.rootNode.addChildNode(self.linesNode)
        scene.rootNode.addChildNode(self.camNode)
        self.scnView.scene = scene
        self.scnView.pointOfView = self.camNode
        self.lod = lastet?.1
        self.blokkLod = blokker
        if blokker != nil { MeshLog.log("MeshViewer: blokkpyramide — tekstur etter skjermen") }
        self.lodFra = .zero
        self.lod?.oppdater(kamera: .zero)
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

  /// Linjer som rør på flaten. Ikke trykkbare (hitTest skal treffe veggen under, ikke røret).
  func setLines(json: String) {
    linesNode.childNodes.forEach { $0.removeFromParentNode() }
    guard let data = json.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    let mat = SCNMaterial()
    mat.diffuse.contents = UIColor.systemOrange
    mat.lightingModel = .constant
    for l in arr {
      let pts: [SIMD3<Float>] = ((l["punkter"] as? [[NSNumber]]) ?? []).compactMap {
        $0.count == 3 ? SIMD3($0[0].floatValue, $0[1].floatValue, $0[2].floatValue) : nil
      }
      for (i, p) in pts.enumerated() {
        let s = SCNSphere(radius: 0.007); s.firstMaterial = mat
        let n = SCNNode(geometry: s); n.simdPosition = p; n.categoryBitMask = 2
        linesNode.addChildNode(n)
        guard i + 1 < pts.count else { continue }
        let d = pts[i + 1] - p, len = simd_length(d)
        guard len > 1e-4 else { continue }
        let c = SCNCylinder(radius: 0.004, height: CGFloat(len)); c.radialSegmentCount = 8; c.firstMaterial = mat
        let cn = SCNNode(geometry: c); cn.categoryBitMask = 2
        cn.simdPosition = (p + pts[i + 1]) / 2
        cn.simdOrientation = simd_quatf(from: SIMD3(0, 1, 0), to: d / len)
        linesNode.addChildNode(cn)
      }
    }
  }

  /// Trykk på en eksisterende pinne kan alltid velges (inspiser/rediger/slett i JS).
  /// Trykk på selve meshen plasserer et NYTT punkt kun når markerMode er på.
  @objc private func onTap(_ g: UITapGestureRecognizer) {
    guard scnView.scene != nil else { return }
    let p = g.location(in: scnView)
    guard let hit = scnView.hitTest(p, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue, .categoryBitMask: 1]).first else { return }
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
    if let lod, simd_distance(pos, lodFra) > lodSteg {
      lodFra = pos
      lod.oppdater(kamera: pos)
    }
    // Slås sammen til siste stilling mens en vurdering pågår, så dette er ingen løkke.
    if let blokkLod, let fov = camNode.camera?.fieldOfView {
      let s = scnView.contentScaleFactor
      blokkLod.oppdater(kamera: camNode.simdWorldTransform, fovY: Float(fov),
                        skjerm: CGSize(width: scnView.bounds.width * s, height: scnView.bounds.height * s))
    }
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
    // Et 720-bilde trenger ikke tekstur i full oppløsning. Med vieweren sitt budsjett (4 × 8192²)
    // drepte forhåndsvisningen appen rett etter «Bygg om modellen» på huset (1774 Mpx, 01.11),
    // før den nye modellen ble lagret.
    guard let node = lastNode(path: glbPath, nærFørst: false, budsjett: 2048 * 2048)?.node,
          let device = MTLCreateSystemDefaultDevice() else { return }
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
  static func loadNode(path: String) -> SCNNode? { lastNode(path: path, nærFørst: true)?.node }

  /// Noden og, for et hus over teksturbudsjettet, LOD-en vieweren skal holde i live og oppdatere.
  /// `nærFørst`: de nærmeste flisene i full oppløsning før noden returneres (miniatyren). Vieweren
  /// viser heller huset nedskalert med en gang og ber om de nære selv (sparer sekunder per flis).
  static func lastNode(path: String, nærFørst: Bool, budsjett: Int = 4 * 8192 * 8192) -> (node: SCNNode, lod: TeksturLod?)? {
    // Minnekartlagt: LOD-en henter en flis' JPEG fra fila når den skal opp i full oppløsning,
    // uten å holde alle bildene i minnet.
    guard let file = try? Data(contentsOf: URL(fileURLWithPath: path), options: .alwaysMapped), file.count > 20 else { return nil }

    func u32(_ off: Int) -> UInt32 {
      file.subdata(in: off..<off + 4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
    }
    guard u32(0) == 0x46546C67 else { return nil } // "glTF"

    // Chunks: [len][type][payload]… — første JSON, andre BIN
    var off = 12
    var jsonData: Data?
    var bin: Data?
    var binStart = 0
    while off + 8 <= file.count {
      let len = Int(u32(off)), type = u32(off + 4)
      guard off + 8 + len <= file.count else { return nil }
      let payload = file.subdata(in: (off + 8)..<(off + 8 + len))
      if type == 0x4E4F534A { jsonData = payload }        // "JSON"
      else if type == 0x004E4942 { bin = payload; binStart = off + 8 } // "BIN\0"
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
    // Én primitiv per teksturflis (2026-09-10). Kvalitetsmodellen pakker teksturen i fire
    // fliser à 8192 — ett atlas rommer bare ~1055 texel/m over et rom på 60 m², og da må
    // kildepikslene skaleres til 0,43 (§72). Denne leseren tok tidligere KUN accessor 0-3 og
    // det FØRSTE bildet, så en flismodell ble vist med én tekstur på hele nettet.
    // Én GLB med én primitiv leses nøyaktig som før.
    // Over budsjettet (fire fliser à 8192) dekodes hver flis nedskalert ved innlasting, likt for
    // alle, så ett rom aldri blir skarpt i én flis og mykt i nabo-flisen.
    // HUS (M2, 2026-10-28): et hus bakt per delkart har én–fire fliser à 8192 PER DEL, og hver
    // primitiv bærer `extras.del`. Lastet i full oppløsning blir fem rom 2–5 GB GPU-minne. For et
    // hus over budsjettet tar `TeksturLod` over: alle deler nedskalert, og delene nærmest
    // kameraet i full oppløsning innenfor budsjettet. GLB-en på disk er urørt.
    var piksler = 0
    var størrelse = [Int: Int]()
    for (i, b) in (json["images"] as? [[String: Any]] ?? []).enumerated() {
      guard let vi = b["bufferView"] as? Int, let d = slice(view: vi),
            let src = CGImageSourceCreateWithData(d as CFData, nil),
            let pr = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
            let w = pr[kCGImagePropertyPixelWidth] as? Int, let h = pr[kCGImagePropertyPixelHeight] as? Int else { continue }
      piksler += w * h
      størrelse[i] = max(w, h)
    }
    let primitiver = ((json["meshes"] as? [[String: Any]])?.first?["primitives"] as? [[String: Any]]) ?? []
    let delAv: [Int?] = primitiver.map { ($0["extras"] as? [String: Any])?["del"] as? Int }
    let erHus = Set(delAv.compactMap { $0 }).count >= 2
    let lod: TeksturLod? = piksler > budsjett && erHus ? TeksturLod(budsjett: budsjett, totalt: piksler) : nil
    let skala = piksler > budsjett && lod == nil ? (Double(budsjett) / Double(piksler)).squareRoot() : 1
    if let lod {
      MeshLog.log(String(format: "MeshViewer: hus med %d Mpx tekstur over budsjettet — fjerne deler i %.0f %%, nære i full oppløsning",
                         piksler / 1_000_000, lod.lav * 100))
    } else if skala < 1 {
      MeshLog.log(String(format: "MeshViewer: %d Mpx tekstur over budsjettet — dekodes i %.0f %%", piksler / 1_000_000, skala * 100))
    }
    func bilde(_ bi: Int, _ data: Data) -> UIImage? {
      guard skala < 1, let side = størrelse[bi] else { return UIImage(data: data) }
      return TeksturLod.dekod(data, maks: Int(Double(side) * skala))
    }
    func lagMateriale(_ bildeIndeks: Int?, _ del: Int?, _ boks: (SIMD3<Float>, SIMD3<Float>)) -> SCNMaterial {
      let mat = SCNMaterial()
      // Teksturen ER lyset (bakt fra foto) — konstant belysning viser den ærlig.
      mat.lightingModel = .constant
      mat.isDoubleSided = true
      let bilder = json["images"] as? [[String: Any]] ?? []
      if let bi = bildeIndeks, bi < bilder.count,
         let imgVi = bilder[bi]["bufferView"] as? Int,
         let texData = slice(view: imgVi),
         let img = lod.map({ l -> UIImage? in
           let o = binStart + ((views[imgVi]["byteOffset"] as? Int) ?? 0)
           return l.legg(mat, del: del ?? -1, fil: file, område: o..<(o + texData.count), side: størrelse[bi] ?? 8192, boks: boks)
         }) ?? bilde(bi, texData) {
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
      return mat
    }
    // Materialets bilde: materials[i] → textures[j] → images[k]. Faller tilbake på samme
    // rekkefølge som materialet selv om oppslaget mangler.
    let materialer = json["materials"] as? [[String: Any]] ?? []
    let teksturer = json["textures"] as? [[String: Any]] ?? []
    func bildeFor(material mi: Int) -> Int? {
      guard mi < materialer.count,
            let pbr = materialer[mi]["pbrMetallicRoughness"] as? [String: Any],
            let bct = pbr["baseColorTexture"] as? [String: Any],
            let ti = bct["index"] as? Int, ti < teksturer.count,
            let src = teksturer[ti]["source"] as? Int else { return mi }
      return src
    }
    let rot = SCNNode()
    var laget = 0
    for (pi, prim) in primitiver.enumerated() {
      guard let attr = prim["attributes"] as? [String: Any],
            let ap = attr["POSITION"] as? Int, let an = attr["NORMAL"] as? Int,
            let au = attr["TEXCOORD_0"] as? Int, let ai = prim["indices"] as? Int,
            let pos = accessorData(ap), let norm = accessorData(an),
            let uv = accessorData(au), let idx = accessorData(ai) else { continue }
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
      geo.materials = [lagMateriale(bildeFor(material: (prim["material"] as? Int) ?? pi), delAv[pi], Self.boks(pos.data, pos.count))]
      rot.addChildNode(SCNNode(geometry: geo))
      laget += 1
    }
    guard laget > 0 else { return nil }
    if let lod, nærFørst {
      // Miniatyren rendres fra ARKit-origo: de nærmeste delene i full oppløsning først.
      lod.oppdater(kamera: .zero, synkront: true)
    }
    return (rot, lod)
  }

  /// Flisens boks i modellens koordinater (lest fra posisjonene, aksessorens min/max er valgfri).
  private static func boks(_ d: Data, _ n: Int) -> (SIMD3<Float>, SIMD3<Float>) {
    var lo = SIMD3<Float>(repeating: .infinity), hi = SIMD3<Float>(repeating: -.infinity)
    d.withUnsafeBytes { p in
      for i in 0..<n {
        let v = SIMD3(p.loadUnaligned(fromByteOffset: i * 12, as: Float.self),
                      p.loadUnaligned(fromByteOffset: i * 12 + 4, as: Float.self),
                      p.loadUnaligned(fromByteOffset: i * 12 + 8, as: Float.self))
        guard v.x.isFinite, v.y.isFinite, v.z.isFinite else { continue }
        lo = simd_min(lo, v); hi = simd_max(hi, v)
      }
    }
    return lo.x <= hi.x ? (lo, hi) : (.zero, .zero)
  }
}

/// Tekstur etter avstand for et hus over budsjettet (M2 steg 3). Enheten er DELEN (rommet), ikke
/// flisen: alle flisene i ett rom har alltid samme skala, så et rom aldri blir skarpt i én flis
/// og mykt i nabo-flisen, og ingenting bytter mens man går rundt inne i samme rom. Delene
/// nærmest kameraet (avstand til delens boks, 0 inne i den) får full oppløsning til summen når
/// `budsjett`, altså det ett rom fikk før. Er den nærmeste delen alene over budsjettet, skaleres
/// den jevnt ned til budsjettet, som et enkeltrom alltid er blitt. Resten deler en pott på én
/// flis à 8192, så teksturminnet er høyst fem fliser à 8192 uansett hus.
/// Full dekoding skjer på en egen kø; vieweren ber om ny vurdering når kameraet har flyttet seg,
/// aldri i en løkke (CLAUDE.md regel 10).
final class TeksturLod {
  private struct Flis {
    weak var mat: SCNMaterial?
    let del: Int
    let fil: Data           // hele GLB-en, minnekartlagt (delt, ikke kopiert)
    let område: Range<Int>  // flisens JPEG i fila
    let side: Int
    let piksler: Int
    let boks: (SIMD3<Float>, SIMD3<Float>)
    let lav: UIImage?
    var skala: Double = 0   // 0 = den nedskalerte kopien
  }
  let budsjett: Int
  /// Skala for de fjerne delene (sidelengde), felles for alle fliser.
  let lav: Double
  private var fliser: [Flis] = []
  private let kø = DispatchQueue(label: "ampex.viewer.lod", qos: .userInitiated)
  private let lås = NSLock()
  private var ønsket: SIMD3<Float>?
  private var arbeider = false

  init(budsjett: Int, totalt: Int) {
    self.budsjett = budsjett
    lav = min(0.5, (Double(8192 * 8192) / Double(totalt)).squareRoot())
  }

  /// Registrerer flisen og gir den nedskalerte kopien materialet starter med.
  func legg(_ mat: SCNMaterial, del: Int, fil: Data, område: Range<Int>, side: Int,
            boks: (SIMD3<Float>, SIMD3<Float>)) -> UIImage? {
    let data = fil.subdata(in: område)
    let bilde = Self.dekod(data, maks: max(256, Int(Double(side) * lav)))
    var piksler = side * side
    if let src = CGImageSourceCreateWithData(data as CFData, nil),
       let pr = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
       let w = pr[kCGImagePropertyPixelWidth] as? Int, let h = pr[kCGImagePropertyPixelHeight] as? Int { piksler = w * h }
    fliser.append(Flis(mat: mat, del: del, fil: fil, område: område, side: side, piksler: piksler, boks: boks, lav: bilde))
    return bilde
  }

  /// Ny vurdering fra kameraets posisjon (modellens koordinater). Kall fra vieweren når kameraet
  /// har flyttet seg; flere kall mens én dekoding pågår slås sammen til det siste.
  func oppdater(kamera: SIMD3<Float>, synkront: Bool = false) {
    if synkront { utfør(kamera); return }
    lås.lock()
    ønsket = kamera
    let start = !arbeider
    arbeider = true
    lås.unlock()
    guard start else { return }
    kø.async { [weak self] in
      while let self {
        self.lås.lock()
        guard let p = self.ønsket else { self.arbeider = false; self.lås.unlock(); return }
        self.ønsket = nil
        self.lås.unlock()
        self.utfør(p)
      }
    }
  }

  private func utfør(_ p: SIMD3<Float>) {
    // Delens boks og piksler.
    var boks = [Int: (SIMD3<Float>, SIMD3<Float>)](), piksler = [Int: Int]()
    for f in fliser {
      let b = boks[f.del]
      boks[f.del] = b.map { (simd_min($0.0, f.boks.0), simd_max($0.1, f.boks.1)) } ?? f.boks
      piksler[f.del, default: 0] += f.piksler
    }
    func avstand(_ d: Int) -> Float {
      guard let b = boks[d] else { return .infinity }
      return simd_length(simd_max(simd_max(b.0 - p, p - b.1), .zero))
    }
    let rekkefølge = boks.keys.sorted { (avstand($0), $0) < (avstand($1), $1) }
    var mål = [Int: Double](), brukt = 0
    for d in rekkefølge {
      let px = piksler[d] ?? 0
      if brukt == 0 && px > budsjett {
        mål[d] = (Double(budsjett) / Double(px)).squareRoot()   // nærmeste del alene for stor
        brukt = budsjett
        break
      }
      guard brukt + px <= budsjett else { break }   // neste del er lenger unna: ikke hopp over den
      mål[d] = 1; brukt += px
    }
    // Ned først, så opp: minnet stiger aldri over budsjettet mens det byttes.
    var ned: [(SCNMaterial, UIImage?)] = []
    for i in fliser.indices where fliser[i].skala > 0 && mål[fliser[i].del] != fliser[i].skala {
      fliser[i].skala = 0
      if let m = fliser[i].mat { ned.append((m, fliser[i].lav)) }
    }
    sett(ned)
    var opp = 0
    for d in rekkefølge {
      guard let s = mål[d] else { continue }
      for i in fliser.indices where fliser[i].del == d && fliser[i].skala != s {
        let maks: Int? = s < 1 ? Int(Double(fliser[i].side) * s) : nil
        guard let m = fliser[i].mat,
              let bilde = autoreleasepool(invoking: { Self.dekod(fliser[i].fil.subdata(in: fliser[i].område), maks: maks) }) else { continue }
        fliser[i].skala = s
        opp += 1
        sett([(m, bilde)])
      }
    }
    if opp > 0 || !ned.isEmpty {
      let gpu = Double(MTLCreateSystemDefaultDevice()?.currentAllocatedSize ?? 0) / 1_048_576
      let nære = rekkefølge.filter { mål[$0] != nil }.map { d in mål[d]! < 1 ? String(format: "%d (%.0f %%)", d, mål[d]! * 100) : String(d) }
      MeshLog.log(String(format: "MeshViewer: LOD — del %@ nær av %d deler (%d fliser opp, %d ned), %.0f Mpx, GPU %.0f MB",
                         nære.joined(separator: ", "), boks.count, opp, ned.count, Double(brukt) / 1e6, gpu))
    }
  }

  private func sett(_ b: [(SCNMaterial, UIImage?)]) {
    guard !b.isEmpty else { return }
    let f = { for (m, i) in b { m.diffuse.contents = i } }
    if Thread.isMainThread { f() } else { DispatchQueue.main.sync(execute: f) }
  }

  /// Dekoder JPEG-en på kallerens tråd (ikke lat på main ved første tegning). `maks` nil = full.
  static func dekod(_ data: Data, maks: Int?) -> UIImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return UIImage(data: data) }
    let cg: CGImage?
    if let maks {
      cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: maks,
        kCGImageSourceCreateThumbnailWithTransform: false,
        kCGImageSourceShouldCacheImmediately: true,
      ] as CFDictionary)
    } else {
      cg = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }
    return cg.map { UIImage(cgImage: $0) } ?? UIImage(data: data)
  }
}

// MARK: - Blokkpyramide (§128): tekstur som Google Maps — bare det som synes, i skjermens oppløsning

/// Huset delt i blokker à 1 m³, hver med eget atlas i full tetthet og nivåer i 2×-trinn ned til
/// 32 px. Vieweren laster bare blokkene som faktisk synes i fint nivå (se `BlokkLod`), så
/// teksturminnet følger skjermen og ikke husets størrelse. Målt på Mac (c1794d71): 18–78 Mpx
/// mot 1088 med alt i full oppløsning, og samme bilde (snitt ≤ 0,14/255).
///
/// Mappa `<glb>.blokker/`: `blokker.json`, `b<n>.geo` (per trekant 3 × [x y z u v] f32),
/// `b<n>_L<k>.jpg`. Bygges fra GLB-en i bakgrunnen første gang et skann åpnes; til den finnes
/// viser vieweren GLB-en som før. Pikslene kopieres 1:1 fra GLB-atlaset (UV-øyenes rammebokser),
/// så nivå 0 er nøyaktig like skarpt som GLB-en.
enum Blokkpyramide {
  static let versjon = 1
  static func mappe(_ glb: String) -> URL { URL(fileURLWithPath: glb + ".blokker", isDirectory: true) }

  /// Ferdig pyramide for GLB-en, eller nil (finnes ikke, eldre versjon, eller eldre enn GLB-en).
  static func ferdig(_ glb: String) -> URL? {
    let m = mappe(glb), j = m.appendingPathComponent("blokker.json")
    guard let d = try? Data(contentsOf: j),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          o["versjon"] as? Int == versjon,
          let tj = (try? FileManager.default.attributesOfItem(atPath: j.path))?[.modificationDate] as? Date,
          let tg = (try? FileManager.default.attributesOfItem(atPath: glb))?[.modificationDate] as? Date,
          tj >= tg else { return nil }
    return m
  }

  private static var pågår = Set<String>()
  private static let lås = NSLock()

  /// Bygger i bakgrunnen (lav prioritet, venter ved høy varme). Ett bygg per GLB om gangen.
  private static let byggkø = DispatchQueue(label: "no.ampex.blokkpyramide", qos: .utility)
  static func byggIBakgrunnen(_ glb: String) {
    lås.lock()
    guard !pågår.contains(glb) else { lås.unlock(); return }
    pågår.insert(glb)
    lås.unlock()
    // Én om gangen for hele appen: to bygg samtidig (aca96f6e + c1794d71, 01.11) holdt 1,8 GB
    // råfiler og to sett dekodede kildebilder på en gang.
    byggkø.async {
      defer { lås.lock(); pågår.remove(glb); lås.unlock() }
      let t0 = CFAbsoluteTimeGetCurrent()
      MeshLog.log(String(format: "blokkpyramide — start, ledig %d MB ← %@", MeshSimMem.available() / 1024 / 1024,
                         (glb as NSString).lastPathComponent))
      do {
        let n = try bygg(glb)
        MeshLog.log(String(format: "blokkpyramide — %d blokker på %.1f s ← %@", n, CFAbsoluteTimeGetCurrent() - t0,
                           (glb as NSString).lastPathComponent))
      } catch {
        try? FileManager.default.removeItem(at: mappe(glb))
        MeshLog.log("blokkpyramide — FEIL: \(error)")
      }
    }
  }

  /// Bygger NÅ, på kallerens tråd, med fremdrift i prosent. Kalles på slutten av baken (§136):
  /// pyramiden er da ferdig før modellen åpnes første gang, i stedet for åtte minutter med
  /// grov tekstur og et nytt minnetopp oppå vieweren (krasjene 01.11, §134). Feiler den, faller
  /// vieweren tilbake på byggIBakgrunnen som før.
  static func byggNå(_ glb: String) {
    guard UserDefaults.standard.string(forKey: "meshscan.blokker") != "off", !glb.hasSuffix(".ply"), ferdig(glb) == nil else { return }
    let t0 = CFAbsoluteTimeGetCurrent()
    ARMeshGlbExporter.progress?("Klargjør visningen…")
    do {
      let n = try autoreleasepool { try bygg(glb) { andel in
        ARMeshGlbExporter.progress?(String(format: "Klargjør visningen… %d %%", Int(andel * 100)))
      } }
      MeshLog.log(String(format: "blokkpyramide — %d blokker på %.1f s i baken ← %@", n, CFAbsoluteTimeGetCurrent() - t0,
                         (glb as NSString).lastPathComponent))
    } catch {
      try? FileManager.default.removeItem(at: mappe(glb))
      MeshLog.log("blokkpyramide — FEIL i baken: \(error)")
    }
  }

  struct Feil: Error, CustomStringConvertible { let description: String }

  private struct Rekt { let bilde: Int; let x: Int, y: Int, w: Int, h: Int; var ox = 0, oy = 0 }
  private final class Blokk {
    var rekter: [Rekt] = []
    var geo: [Float] = []          // 3 × [x y z u v] per trekant, u v i KILDEpiksler til pakkingen er gjort
    var rektAv: [Int32] = []       // per trekant
    var areal: Double = 0, texelAreal: Double = 0
    var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
    var side = 0
    var råOffset = 0
  }
  private struct Nøkkel: Hashable { let x, y, z: Int32 }

  /// Selve bygget. Minnet holdes nede: ett kildebilde dekodet om gangen, og blokkatlasene skrives
  /// via en midlertidig råfil på disk før de kodes til JPEG-nivåer.
  @discardableResult
  static func bygg(_ glb: String, blokk: Float = 1.0, fremdrift: ((Double) -> Void)? = nil) throws -> Int {
    var tFase = CFAbsoluteTimeGetCurrent(), faser: [String] = []
    guard let fil = try? Data(contentsOf: URL(fileURLWithPath: glb), options: .alwaysMapped), fil.count > 20 else { throw Feil(description: "kan ikke lese GLB") }
    func u32(_ o: Int) -> Int { Int(fil.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: o, as: UInt32.self) }) }
    guard u32(0) == 0x46546C67 else { throw Feil(description: "ikke GLB") }
    let jl = u32(12)
    guard let json = (try? JSONSerialization.jsonObject(with: fil.subdata(in: 20..<(20 + jl)))) as? [String: Any] else { throw Feil(description: "JSON") }
    let binStart = 20 + jl + 8
    let views = json["bufferViews"] as? [[String: Any]] ?? []
    let accessors = json["accessors"] as? [[String: Any]] ?? []
    func floats(_ ai: Int, _ n: Int) -> [Float] {
      let a = accessors[ai], v = views[a["bufferView"] as! Int]
      let o = binStart + (v["byteOffset"] as? Int ?? 0) + (a["byteOffset"] as? Int ?? 0), c = (a["count"] as! Int) * n
      return fil.withUnsafeBytes { p in (0..<c).map { p.loadUnaligned(fromByteOffset: o + $0 * 4, as: Float.self) } }
    }
    func indekser(_ ai: Int) -> [UInt32] {
      let a = accessors[ai], v = views[a["bufferView"] as! Int]
      let o = binStart + (v["byteOffset"] as? Int ?? 0) + (a["byteOffset"] as? Int ?? 0), c = a["count"] as! Int
      let kort = a["componentType"] as? Int == 5123
      return fil.withUnsafeBytes { p in (0..<c).map { kort ? UInt32(p.loadUnaligned(fromByteOffset: o + $0 * 2, as: UInt16.self))
                                                              : p.loadUnaligned(fromByteOffset: o + $0 * 4, as: UInt32.self) } }
    }
    let bilder = json["images"] as? [[String: Any]] ?? []
    func bildeData(_ i: Int) -> Data? {
      guard i < bilder.count, let vi = bilder[i]["bufferView"] as? Int, vi < views.count else { return nil }
      let o = binStart + (views[vi]["byteOffset"] as? Int ?? 0)
      return fil.subdata(in: o..<(o + (views[vi]["byteLength"] as? Int ?? 0)))
    }
    var størrelse = [Int: (Int, Int)]()
    for i in bilder.indices {
      guard let d = bildeData(i), let s = CGImageSourceCreateWithData(d as CFData, nil),
            let pr = CGImageSourceCopyPropertiesAtIndex(s, 0, nil) as? [CFString: Any],
            let w = pr[kCGImagePropertyPixelWidth] as? Int, let h = pr[kCGImagePropertyPixelHeight] as? Int else { continue }
      størrelse[i] = (w, h)
    }
    let materialer = json["materials"] as? [[String: Any]] ?? [], teksturer = json["textures"] as? [[String: Any]] ?? []
    func bildeFor(_ mi: Int) -> Int? {
      guard mi < materialer.count, let pbr = materialer[mi]["pbrMetallicRoughness"] as? [String: Any],
            let bct = pbr["baseColorTexture"] as? [String: Any], let ti = bct["index"] as? Int, ti < teksturer.count else { return nil }
      return teksturer[ti]["source"] as? Int
    }

    // ── 1. Trekanter til blokker, UV-øyer til rektangler i kildebildet.
    var blokker = [Nøkkel: Blokk]()
    let pad = 4
    for m in json["meshes"] as? [[String: Any]] ?? [] {
      for pr in m["primitives"] as? [[String: Any]] ?? [] {
        guard let at = pr["attributes"] as? [String: Int], let ap = at["POSITION"], let au = at["TEXCOORD_0"],
              let ai = pr["indices"] as? Int, let bi = bildeFor(pr["material"] as? Int ?? -1), let (w, h) = størrelse[bi] else { continue }
        let p = floats(ap, 3), uv = floats(au, 2), idx = indekser(ai)
        let s = SIMD2(Float(w), Float(h))
        func P(_ i: UInt32) -> SIMD3<Float> { SIMD3(p[Int(i) * 3], p[Int(i) * 3 + 1], p[Int(i) * 3 + 2]) }
        func U(_ i: UInt32) -> SIMD2<Float> { SIMD2(uv[Int(i) * 2], uv[Int(i) * 2 + 1]) * s }
        var perBlokk = [Nøkkel: [Int]]()
        for t in 0..<(idx.count / 3) {
          let c = (P(idx[t * 3]) + P(idx[t * 3 + 1]) + P(idx[t * 3 + 2])) / 3
          guard c.x.isFinite, c.y.isFinite, c.z.isFinite else { continue }
          perBlokk[Nøkkel(x: Int32((c.x / blokk).rounded(.down)), y: Int32((c.y / blokk).rounded(.down)),
                          z: Int32((c.z / blokk).rounded(.down))), default: []].append(t)
        }
        for (k, ts) in perBlokk {
          let b = blokker[k] ?? Blokk(); blokker[k] = b
          var far = [UInt32: UInt32]()
          func rot(_ v: UInt32) -> UInt32 {
            var r = v; while let f = far[r], f != r { r = f }
            var v = v; while let f = far[v], f != r { far[v] = r; v = f }
            return r
          }
          for t in ts {
            let a = idx[t * 3], b2 = idx[t * 3 + 1], c = idx[t * 3 + 2]
            for v in [a, b2, c] where far[v] == nil { far[v] = v }
            let ra = rot(a); far[rot(b2)] = ra; far[rot(c)] = ra
          }
          var øyer = [UInt32: [Int]]()
          for t in ts { øyer[rot(idx[t * 3]), default: []].append(t) }
          for (_, øts) in øyer {
            var lo = SIMD2<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
            for t in øts { for j in 0..<3 { let q = U(idx[t * 3 + j]); lo = simd_min(lo, q); hi = simd_max(hi, q) } }
            let x0 = max(0, Int(lo.x.rounded(.down)) - pad), y0 = max(0, Int(lo.y.rounded(.down)) - pad)
            let x1 = min(w, Int(hi.x.rounded(.up)) + pad), y1 = min(h, Int(hi.y.rounded(.up)) + pad)
            guard x1 > x0, y1 > y0 else { continue }
            let ri = Int32(b.rekter.count)
            b.rekter.append(Rekt(bilde: bi, x: x0, y: y0, w: x1 - x0, h: y1 - y0))
            for t in øts {
              let ps = (P(idx[t * 3]), P(idx[t * 3 + 1]), P(idx[t * 3 + 2]))
              let us = (U(idx[t * 3]), U(idx[t * 3 + 1]), U(idx[t * 3 + 2]))
              for (q, u) in [(ps.0, us.0), (ps.1, us.1), (ps.2, us.2)] {
                b.geo += [q.x, q.y, q.z, u.x, u.y]
                b.lo = simd_min(b.lo, q); b.hi = simd_max(b.hi, q)
              }
              b.rektAv.append(ri)
              b.areal += Double(simd_length(simd_cross(ps.1 - ps.0, ps.2 - ps.0))) / 2
              let d1 = us.1 - us.0, d2 = us.2 - us.0
              b.texelAreal += Double(abs(d1.x * d2.y - d1.y * d2.x)) / 2
            }
          }
        }
      }
    }
    guard !blokker.isEmpty else { throw Feil(description: "ingen trekanter") }
    func fase(_ n: String) { let t = CFAbsoluteTimeGetCurrent(); faser.append(String(format: "%@ %.1f s", n, t - tFase)); tFase = t }
    fase("blokker")

    // ── 2. Pakk hver blokk (hyller i et kvadrat som vokser til alt får plass).
    let liste = blokker.sorted { ($0.key.x, $0.key.y, $0.key.z) < ($1.key.x, $1.key.y, $1.key.z) }.map(\.value)
    var råStørrelse = 0
    for b in liste {
      let sum = b.rekter.reduce(0) { $0 + $1.w * $1.h }
      var side = max(64, Int(Double(sum).squareRoot() * 1.1))
      let orden = b.rekter.indices.sorted { b.rekter[$0].h > b.rekter[$1].h }
      while true {
        var x = 0, y = 0, rad = 0, ok = true
        for i in orden {
          let r = b.rekter[i]
          if r.w > side { ok = false; break }
          if x + r.w > side { y += rad; x = 0; rad = 0 }
          if y + r.h > side { ok = false; break }
          b.rekter[i].ox = x; b.rekter[i].oy = y
          x += r.w; rad = max(rad, r.h)
        }
        if ok { break }
        side = Int(Double(side) * 1.08) + 8
      }
      b.side = side
      b.råOffset = råStørrelse
      råStørrelse += (side * side * 4 + 16383) & ~16383   // sidejustert: blokkene kartlegges hver for seg
    }
    fase("pakking")
    let ut = mappe(glb)
    try? FileManager.default.removeItem(at: ut)
    try FileManager.default.createDirectory(at: ut, withIntermediateDirectories: true)

    // ── 3. Ett kildebilde om gangen kopieres inn i blokkatlasene (§147). Får alle plass i ~30 % av ledig
    // minne, ligger de i RAM; ellers i en råfil som kartlegges blokk for blokk (aldri hele: huset c1794d71
    // ga en råfil iOS ikke ville kartlegge, telefon 01.11). Før: seek+write per rad — stua 2,6 GB, 32 av 40 s.
    // Større telefon → mer ledig minne → oftere ingen disk i det hele tatt.
    let budsjett = Int(Double(MeshSimMem.available()) * 0.3)
    let tvang = UserDefaults.standard.string(forKey: "meshscan.pyrdisk")   // on/off: tving disk/RAM (test)
    let iRam = tvang == "off" || (råStørrelse <= budsjett && tvang != "on")
    var ramBuf: [UnsafeMutableRawPointer] = []
    var fd: Int32 = -1
    let rå = ut.appendingPathComponent("raa.tmp")
    defer {
      ramBuf.forEach { free($0) }
      if fd >= 0 { close(fd); try? FileManager.default.removeItem(at: rå) }
    }
    if iRam {
      ramBuf = liste.map { calloc($0.side * $0.side, 4)! }
    } else {
      let ledig = ((try? URL(fileURLWithPath: NSTemporaryDirectory()).resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?
        .volumeAvailableCapacityForImportantUsage).map(Int.init) ?? Int.max
      guard råStørrelse + (2 << 30) < ledig else { throw Feil(description: "for lite lagring (\(råStørrelse >> 20) MB råfil)") }
      fd = open(rå.path, O_RDWR | O_CREAT | O_TRUNC, 0o600)
      guard fd >= 0, ftruncate(fd, off_t(råStørrelse)) == 0 else { throw Feil(description: "råfil") }
    }
    /// Blokkens piksler: RAM-bufferet, eller et kart inn i råfila som `slipp` lukker.
    func hent(_ n: Int, skriv: Bool) -> UnsafeMutableRawPointer? {
      if iRam { return ramBuf[n] }
      let b = liste[n]
      let p = mmap(nil, b.side * b.side * 4, skriv ? PROT_READ | PROT_WRITE : PROT_READ, MAP_SHARED, fd, off_t(b.råOffset))
      return p == MAP_FAILED ? nil : p
    }
    func slipp(_ n: Int, _ p: UnsafeMutableRawPointer) { if !iRam { munmap(p, liste[n].side * liste[n].side * 4) } }

    // ── 4. Nivåer som JPEG, geometri med UV i blokkatlaset. Én blokk per kjerne.
    func lagNivåer(_ n: Int, _ b: Blokk, _ px: UnsafeMutableRawPointer) throws -> [String: Any] {
      let side = b.side
      guard let prov = CGDataProvider(dataInfo: nil, data: px, size: side * side * 4, releaseData: { _, _, _ in }),
            var cg = CGImage(width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: side * 4,
                             space: CGColorSpaceCreateDeviceRGB(),
                             bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                             provider: prov, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { throw Feil(description: "atlas \(n)") }
      var nivåer: [Int] = []
      while true {
        let url = ut.appendingPathComponent("b\(n)_L\(nivåer.count).jpg")
        guard let dst = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil) else { throw Feil(description: "jpeg") }
        CGImageDestinationAddImage(dst, cg, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(dst) else { throw Feil(description: "jpeg \(n)") }
        nivåer.append(cg.width)
        if cg.width <= 32 { break }
        let nw = max(1, cg.width / 2)
        guard let ctx = CGContext(data: nil, width: nw, height: nw, bitsPerComponent: 8, bytesPerRow: nw * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { break }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: nw, height: nw))
        guard let neste = ctx.makeImage() else { break }
        cg = neste
      }
      var geo = b.geo
      for t in 0..<b.rektAv.count {
        let r = b.rekter[Int(b.rektAv[t])]
        for j in 0..<3 {
          let o = (t * 3 + j) * 5
          geo[o + 3] = (geo[o + 3] - Float(r.x) + Float(r.ox)) / Float(side)
          geo[o + 4] = (geo[o + 4] - Float(r.y) + Float(r.oy)) / Float(side)
        }
      }
      try geo.withUnsafeBytes { try Data($0).write(to: ut.appendingPathComponent("b\(n).geo")) }
      return ["id": n, "lo": [b.lo.x, b.lo.y, b.lo.z], "hi": [b.hi.x, b.hi.y, b.hi.z],
              "tetthet": (b.texelAreal / max(b.areal, 1e-9)).squareRoot(), "nivåer": nivåer]
    }

    let t0 = CFAbsoluteTimeGetCurrent()
    var brukere = [Int: [Int]]()
    for (n, b) in liste.enumerated() { for bi in Set(b.rekter.map(\.bilde)) { brukere[bi, default: []].append(n) } }
    let kilder = brukere.keys.sorted()
    for (k, bi) in kilder.enumerated() {
      fremdrift?(0.7 * Double(k) / Double(max(kilder.count, 1)))
      // Varm telefon: vent, endre ingenting (samme regel som baken, §120). Høyst 5 min.
      var ventet = 0
      while ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue, ventet < 60 {
        Thread.sleep(forTimeInterval: 5); ventet += 1
      }
      try autoreleasepool {
        guard let d = bildeData(bi), let src = CGImageSourceCreateWithData(d as CFData, nil),
              let cg = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return }
        let w = cg.width, h = cg.height
        // Ikke nullstilt: .copy skriver hver piksel.
        let m = UnsafeMutableRawBufferPointer.allocate(byteCount: w * h * 4, alignment: 64)
        defer { m.deallocate() }
        let ctx = CGContext(data: m.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setBlendMode(.copy)
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        for n in brukere[bi] ?? [] {
          let b = liste[n]
          guard let dst = hent(n, skriv: true) else { throw Feil(description: "kart \(n)") }
          defer { slipp(n, dst) }
          for r in b.rekter where r.bilde == bi {
            for y in 0..<r.h {
              memcpy(dst + ((r.oy + y) * b.side + r.ox) * 4, m.baseAddress! + ((r.y + y) * w + r.x) * 4, r.w * 4)
            }
          }
        }
      }
    }
    let t1 = CFAbsoluteTimeGetCurrent()
    var meta = [[String: Any]?](repeating: nil, count: liste.count)
    var feil: Error?
    let lås = NSLock()
    let ferdigTeller = UnsafeMutablePointer<Int>.allocate(capacity: 1); ferdigTeller.pointee = 0
    defer { ferdigTeller.deallocate() }
    meta.withUnsafeMutableBufferPointer { slots in
      DispatchQueue.concurrentPerform(iterations: liste.count) { n in
        do {
          try autoreleasepool {
            guard let px = hent(n, skriv: false) else { throw Feil(description: "kart \(n)") }
            defer { slipp(n, px) }
            slots[n] = try lagNivåer(n, liste[n], px)
          }
        } catch { lås.lock(); feil = error; lås.unlock() }
        lås.lock(); ferdigTeller.pointee += 1; let f = ferdigTeller.pointee; lås.unlock()
        if f % 8 == 0 { fremdrift?(0.7 + 0.3 * Double(f) / Double(liste.count)) }
      }
    }
    if let feil { throw feil }
    let tKopi = t1 - t0, tJpeg = CFAbsoluteTimeGetCurrent() - t1
    fase("atlas")
    MeshLog.log("blokkpyramide — " + faser.joined(separator: ", ") + String(format: " (dekoding+kopi %.1f s, jpeg %.1f s), %d MB %@",
                                                                          tKopi, tJpeg, råStørrelse >> 20, iRam ? "i RAM" : "på disk"))
    // blokker.json skrives SIST: den er merket på at pyramiden er hel.
    try JSONSerialization.data(withJSONObject: ["versjon": versjon, "blokk": blokk, "blokker": meta.compactMap { $0 }])
      .write(to: ut.appendingPathComponent("blokker.json"), options: .atomic)
    return liste.count
  }
}

/// Velger teksturnivå per blokk ut fra hva som faktisk synes på skjermen. Et ID-pass i lav
/// oppløsning (hver blokk sin farge) avgjør synlighet — vegger skjuler rommene bak, slik
/// estimatet i §128 forutsatte. Synlige blokker får nivå floor(log2(tetthet / (f/d))), d =
/// avstand til blokkens boks. Hysterese: finere med en gang; grovere først når blokken trenger
/// ≥ 2 nivåer mindre eller har vært usynlig i `glemEtter` vurderinger. Ingen løkke: vieweren ber
/// om vurdering når kameraet flytter seg, og flere kall mens én pågår slås sammen.
final class BlokkLod {
  private struct B {
    let id: Int
    let lo: SIMD3<Float>, hi: SIMD3<Float>
    let tetthet: Float
    let nivåer: [Int]
    weak var mat: SCNMaterial?
    var nivå: Int
    var usynlig = 0
  }
  let rot = SCNNode()
  private let idScene = SCNScene()
  private let mappe: URL
  private var blokker: [B] = []
  private let kø = DispatchQueue(label: "ampex.viewer.blokklod", qos: .userInitiated)
  private let lås = NSLock()
  private var ønsket: (simd_float4x4, Float, CGSize)?
  private var arbeider = false
  private var renderer: SCNRenderer?
  private let glemEtter = 3
  /// Teksturtak før usynlige blokker slippes straks. Synlige blokker får alltid sitt nivå:
  /// skjermen setter grensa (målt 18–95 Mpx), ikke huset.
  private let taketMpx = 150.0

  init?(mappe: URL) {
    self.mappe = mappe
    guard let d = try? Data(contentsOf: mappe.appendingPathComponent("blokker.json")),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let liste = o["blokker"] as? [[String: Any]] else { return nil }
    for b in liste {
      guard let id = b["id"] as? Int, let lo = b["lo"] as? [Double], let hi = b["hi"] as? [Double],
            let t = b["tetthet"] as? Double, let nv = b["nivåer"] as? [Int], !nv.isEmpty,
            let geo = try? Data(contentsOf: mappe.appendingPathComponent("b\(id).geo")), geo.count >= 60 else { continue }
      let n = geo.count / 20
      let pos = SCNGeometrySource(data: geo, semantic: .vertex, vectorCount: n, usesFloatComponents: true,
                                  componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 20)
      let uv = SCNGeometrySource(data: geo, semantic: .texcoord, vectorCount: n, usesFloatComponents: true,
                                 componentsPerVector: 2, bytesPerComponent: 4, dataOffset: 12, dataStride: 20)
      let ind = (0..<UInt32(n)).map { $0 }
      let el = SCNGeometryElement(data: ind.withUnsafeBytes { Data($0) }, primitiveType: .triangles,
                                  primitiveCount: n / 3, bytesPerIndex: 4)
      let g = SCNGeometry(sources: [pos, uv], elements: [el])
      let mat = SCNMaterial()
      mat.lightingModel = .constant
      mat.isDoubleSided = true
      mat.diffuse.wrapS = .clamp; mat.diffuse.wrapT = .clamp
      mat.diffuse.mipFilter = .linear
      mat.diffuse.maxAnisotropy = 16
      let grov = nv.count - 1
      mat.diffuse.contents = Self.tekstur(mappe.appendingPathComponent("b\(id)_L\(grov).jpg"))
      g.materials = [mat]
      rot.addChildNode(SCNNode(geometry: g))
      // ID-scenen deler geometrikildene; bare materialet er en flat farge. 6 bit per kanal med
      // senterverdi, så en fargekonvertering på ±1 ikke gir feil id.
      let idg = SCNGeometry(sources: [pos], elements: [el])
      let im = SCNMaterial()
      im.lightingModel = .constant
      im.isDoubleSided = true
      func k(_ v: Int) -> CGFloat { CGFloat(v * 4 + 2) / 255 }
      im.diffuse.contents = CGColor(srgbRed: k(id & 63), green: k((id >> 6) & 63), blue: k((id >> 12) & 63), alpha: 1)
      idg.materials = [im]
      idScene.rootNode.addChildNode(SCNNode(geometry: idg))
      blokker.append(B(id: id, lo: SIMD3(Float(lo[0]), Float(lo[1]), Float(lo[2])), hi: SIMD3(Float(hi[0]), Float(hi[1]), Float(hi[2])),
                       tetthet: Float(t), nivåer: nv, mat: mat, nivå: grov))
    }
    guard !blokker.isEmpty else { return nil }
    idScene.background.contents = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)   // id 63·… = ingen blokk
  }

  /// `kamera`: kameranodens verdenstransform. `fovY` i grader (SCNCamera.fieldOfView, vertikal).
  /// `skjerm`: viewets størrelse i PIKSLER.
  func oppdater(kamera: simd_float4x4, fovY: Float, skjerm: CGSize, synkront: Bool = false) {
    if synkront { utfør(kamera, fovY, skjerm); return }
    lås.lock()
    ønsket = (kamera, fovY, skjerm)
    let start = !arbeider
    arbeider = true
    lås.unlock()
    guard start else { return }
    kø.async { [weak self] in
      while let self {
        self.lås.lock()
        guard let (k, f, s) = self.ønsket else { self.arbeider = false; self.lås.unlock(); return }
        self.ønsket = nil
        self.lås.unlock()
        // Én GCD-jobb kan vare så lenge kameraet beveger seg, og da tømmes aldri den ytre
        // autorelease-puljen: de utbyttede teksturene ble liggende (Mac: 1,8 GB GPU ved 33 Mpx
        // lastet; med pulje per vurdering 285 MB).
        autoreleasepool { self.utfør(k, f, s) }
      }
    }
  }

  private func utfør(_ kamera: simd_float4x4, _ fovY: Float, _ skjerm: CGSize) {
    guard skjerm.width > 0, skjerm.height > 0 else { return }
    let t0 = CFAbsoluteTimeGetCurrent()
    // ID-pass i ⅛ av skjermens piksler (langsida ~300 px).
    if renderer == nil {
      renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
      let cn = SCNNode(); cn.camera = SCNCamera(); cn.camera?.zNear = 0.02; cn.camera?.zFar = 200
      idScene.rootNode.addChildNode(cn)
      renderer?.scene = idScene
      renderer?.pointOfView = cn
    }
    guard let r = renderer, let cn = r.pointOfView else { return }
    cn.camera?.fieldOfView = CGFloat(fovY)
    cn.simdTransform = kamera
    let iw = max(16, Int(skjerm.width / 8)), ih = max(16, Int(skjerm.height / 8))
    let bilde = r.snapshot(atTime: 0, with: CGSize(width: iw, height: ih), antialiasingMode: .none)
    var synlig = Set<Int>()
    if let cg = Self.cg(bilde) {
      let w = cg.width, h = cg.height
      var px = [UInt8](repeating: 0, count: w * h * 4)
      px.withUnsafeMutableBytes { m in
        CGContext(data: m.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?
          .draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
      }
      for i in stride(from: 0, to: px.count, by: 4) {
        let id = Int(px[i]) / 4 | (Int(px[i + 1]) / 4) << 6 | (Int(px[i + 2]) / 4) << 12
        if id != (1 << 18) - 1 { synlig.insert(id) }
      }
    }
    let f = Float(skjerm.height) / 2 / tan(fovY * .pi / 360)
    let cam = SIMD3(kamera.columns.3.x, kamera.columns.3.y, kamera.columns.3.z)
    var bytt: [(Int, Int)] = []   // (indeks, nivå)
    // Over taket glemmes usynlige blokker med en gang i stedet for etter `glemEtter` vurderinger.
    let glem = lastetMpx > taketMpx ? 1 : glemEtter
    for i in blokker.indices {
      let b = blokker[i], grov = b.nivåer.count - 1
      var mål = grov
      if synlig.contains(b.id) {
        blokker[i].usynlig = 0
        let d = max(0.05, simd_length(simd_clamp(cam, b.lo, b.hi) - cam))
        mål = max(0, min(grov, Int(floor(log2(max(1, b.tetthet / (f / d)))))))
      } else {
        blokker[i].usynlig += 1
        if blokker[i].usynlig < glem { mål = b.nivå }
      }
      if mål < b.nivå || mål >= b.nivå + 2 || (mål > b.nivå && blokker[i].usynlig >= glem) { bytt.append((i, mål)) }
    }
    // Grovere først (frigjør minne), så finere nærmest først.
    bytt.sort { (a, c) in
      let ga = a.1 > blokker[a.0].nivå, gc = c.1 > blokker[c.0].nivå
      return ga != gc ? ga : a.1 < c.1
    }
    for (i, l) in bytt {
      guard let m = blokker[i].mat, let img = autoreleasepool(invoking: {
        Self.tekstur(mappe.appendingPathComponent("b\(blokker[i].id)_L\(l).jpg"))
      }) else { continue }
      blokker[i].nivå = l
      if Thread.isMainThread { m.diffuse.contents = img } else { DispatchQueue.main.sync { m.diffuse.contents = img } }
    }
    if !bytt.isEmpty {
      let mpx = blokker.reduce(0.0) { $0 + Double($1.nivåer[$1.nivå] * $1.nivåer[$1.nivå]) } / 1e6
      MeshLog.log(String(format: "MeshViewer: blokker — %d synlige, %d byttet, %.0f Mpx tekstur, %.0f ms",
                         synlig.count, bytt.count, mpx, (CFAbsoluteTimeGetCurrent() - t0) * 1000))
    }
  }

  /// Sum teksturpiksler som er lastet nå (til måling).
  var lastetMpx: Double { blokker.reduce(0.0) { $0 + Double($1.nivåer[$1.nivå] * $1.nivåer[$1.nivå]) } / 1e6 }

  /// Egen Metal-tekstur i stedet for et CGImage: SceneKit holdt på sin GPU-kopi av bildet etter
  /// at innholdet ble byttet (telefon 31.10: GPU 1,5 → 2,4 GB mens lastet tekstur falt til
  /// 35 Mpx). Med teksturen selv som innhold frigjøres den gamle når den byttes ut.
  private static let laster = MTLCreateSystemDefaultDevice().map { MTKTextureLoader(device: $0) }
  static func tekstur(_ url: URL) -> MTLTexture? {
    try? laster?.newTexture(URL: url, options: [
      .SRGB: true,
      .generateMipmaps: true,
      .textureUsage: MTLTextureUsage.shaderRead.rawValue,
      .textureStorageMode: MTLStorageMode.private.rawValue,
    ])
  }
}

extension BlokkLod {
  static func cg(_ i: UIImage) -> CGImage? { i.cgImage }
}

/// Test uten UI for blokkpyramiden (§129), som `MeshRebakeHarness`: launch-argumentene
/// `-meshscan.blokktest <glb>` og `-meshscan.blokkframes <bundle>` (stier absolutte eller under
/// appens Documents). Bygger pyramiden om den mangler, går til hvert 25. nøkkelbilde i bundelen,
/// velger nivåer med `BlokkLod` og rendrer. Til sammenligning rendres samme stilling med den
/// gamle GLB-veien. Skriver `Documents/blokktest/{blokk,glb}_<k>.jpg` og `ferdig.txt`.
enum BlokkHarness {
  static func run(glb: String, bundle: String) {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    func løs(_ s: String) -> String { s.hasPrefix("/") ? s : docs.appendingPathComponent(s).path }
    let glbSti = løs(glb), ut = docs.appendingPathComponent("blokktest")
    try? FileManager.default.removeItem(at: ut)
    try? FileManager.default.createDirectory(at: ut, withIntermediateDirectories: true)
    func ferdig(_ m: String) {
      MeshLog.log("blokktest — \(m)")
      try? m.write(to: ut.appendingPathComponent("ferdig.txt"), atomically: true, encoding: .utf8)
    }
    guard let fd = try? Data(contentsOf: URL(fileURLWithPath: løs(bundle)).appendingPathComponent("frames.json")),
          let frames = try? JSONSerialization.jsonObject(with: fd) as? [[String: Any]] else { ferdig("FEIL: frames.json"); return }
    // Skjermen skal ikke låse seg under testen: iOS stanser GPU-arbeid fra en app i bakgrunnen
    // (telefon 31.10: testen stod stille i snapshot da Tormod la fra seg telefonen).
    DispatchQueue.main.sync { UIApplication.shared.isIdleTimerDisabled = true }
    defer { DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false } }
    let t0 = CFAbsoluteTimeGetCurrent()
    if Blokkpyramide.ferdig(glbSti) == nil {
      do { try Blokkpyramide.bygg(glbSti) } catch { ferdig("FEIL bygg: \(error)"); return }
      MeshLog.log(String(format: "blokktest — pyramide bygget på %.1f s", CFAbsoluteTimeGetCurrent() - t0))
    }
    guard let m = Blokkpyramide.ferdig(glbSti), let lod = BlokkLod(mappe: m) else { ferdig("FEIL: pyramide"); return }
    guard let device = MTLCreateSystemDefaultDevice() else { ferdig("FEIL: Metal"); return }
    let W = 2532.0, H = 1170.0, fov: Float = 70
    func lagScene(_ node: SCNNode) -> (SCNRenderer, SCNNode) {
      let s = SCNScene(); s.rootNode.addChildNode(node)
      s.background.contents = UIColor(white: 0.42, alpha: 1)
      let cn = SCNNode(); cn.camera = SCNCamera()
      cn.camera?.fieldOfView = CGFloat(fov); cn.camera?.zNear = 0.02; cn.camera?.zFar = 200
      s.rootNode.addChildNode(cn)
      let r = SCNRenderer(device: device, options: nil); r.scene = s; r.pointOfView = cn
      return (r, cn)
    }
    let (rb, cb) = lagScene(lod.rot)
    var linjer: [String] = []
    for k in stride(from: 0, to: frames.count, by: 25) { autoreleasepool {
      guard let t = (frames[k]["transform"] as? [Double])?.map(Float.init), t.count == 16 else { return }
      let c2w = simd_float4x4(columns: (SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]),
                                         SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15])))
      let t1 = CFAbsoluteTimeGetCurrent()
      lod.oppdater(kamera: c2w, fovY: fov, skjerm: CGSize(width: W, height: H), synkront: true)
      let ms = (CFAbsoluteTimeGetCurrent() - t1) * 1000
      cb.simdTransform = c2w
      let img = rb.snapshot(atTime: 0, with: CGSize(width: W, height: H), antialiasingMode: .none)
      try? img.jpegData(compressionQuality: 0.9)?.write(to: ut.appendingPathComponent("blokk_\(k).jpg"))
      let l = String(format: "kf %d: %.0f Mpx tekstur, vurdering %.0f ms, GPU %.0f MB", k, lod.lastetMpx, ms,
                     Double(device.currentAllocatedSize) / 1_048_576)
      MeshLog.log("blokktest — " + l); linjer.append(l)
    } }
    let blokkGPU = Double(device.currentAllocatedSize) / 1_048_576
    // Den gamle veien, samme stillinger (første tre), for sammenligning.
    if let gammel = AmpexGlbLoader.lastNode(path: glbSti, nærFørst: true) {
      let (rg, cg) = lagScene(gammel.node)
      for k in stride(from: 0, to: min(frames.count, 75), by: 25) {
        guard let t = (frames[k]["transform"] as? [Double])?.map(Float.init), t.count == 16 else { continue }
        cg.simdTransform = simd_float4x4(columns: (SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]),
                                                    SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15])))
        gammel.lod?.oppdater(kamera: SIMD3(t[12], t[13], t[14]), synkront: true)
        let img = rg.snapshot(atTime: 0, with: CGSize(width: W, height: H), antialiasingMode: .none)
        try? img.jpegData(compressionQuality: 0.9)?.write(to: ut.appendingPathComponent("glb_\(k).jpg"))
      }
    }
    ferdig(String(format: "OK %d stillinger, GPU blokker %.0f MB, med gammel GLB i tillegg %.0f MB, totalt %.1f s\n",
                  linjer.count, blokkGPU, Double(device.currentAllocatedSize) / 1_048_576, CFAbsoluteTimeGetCurrent() - t0)
           + linjer.joined(separator: "\n"))
  }
}
