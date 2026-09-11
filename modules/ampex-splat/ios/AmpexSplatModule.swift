import ExpoModulesCore
import Foundation

/// Holder mesh-skanneren i live mens dens UI er presentert.
enum MeshSession {
  static var current: MeshScanPresenter?
}

public final class AmpexSplatModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AmpexSplat")
    // MAC-HARNESS (2026-09-07): start appen i simulatoren med
    //   xcrun simctl launch booted no.ampex.app -meshscan.autorebake <framesDir> [-meshscan.x y …]
    // så kjøres en ombygging av bundelen uten UI, GLB legges i framesDir som rebake-harness-*.glb
    // og «harness-done.txt» skrives når den er ferdig. Kvalitet itereres på Mac, ikke på telefon.
    OnCreate {
      if let dirPath = UserDefaults.standard.string(forKey: "meshscan.autorebake"), !dirPath.isEmpty {
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1.0) {
          MeshRebakeHarness.run(framesDirPath: dirPath)
        }
      }
    }
    // Fasemeldinger fra en ombygging («Bygger geometri fra LiDAR…», «Pakker UV-atlas…») —
    // samme tekster som skanneren viser i sitt overlay, men her til JS-kortet.
    Events("onRebakeProgress")

    // Juni-mesh-pipelinen (den beviste): presenter fullskjerm LiDAR-mesh-skanner
    // (egen UI m/ dekning + Ferdig), baker tekstur on-device, returnerer GLB.
    AsyncFunction("presentMeshScan") { (companyId: String, roomId: String, promise: Promise) in
      DispatchQueue.main.async {
        guard let vc = self.appContext?.utilities?.currentViewController() else {
          promise.reject("no_vc", "Fant ikke aktiv view controller")
          return
        }
        // Samme opprydding som i rebake: gamle A/B-flagg skal ikke styre et nytt skann.
        let stale = UserDefaults.standard.dictionaryRepresentation().keys.filter { $0.hasPrefix("meshscan.") }
        for k in stale { UserDefaults.standard.removeObject(forKey: k) }
        if !stale.isEmpty { MeshLog.log("skann — fjernet \(stale.count) gamle meshscan.*-flagg") }
        let scanner = MeshScanPresenter(companyId: companyId, roomId: roomId)
        MeshSession.current = scanner  // hold i live under skann
        scanner.start(from: vc) { result in
          MeshSession.current = nil
          switch result {
          case .success(let r):
            promise.resolve([
              "glbPath": r.fileURL.path,
              "relativePath": r.relativePath,   // under Documents — overlever reinstall
              "framesDir": r.framesDirURL?.path ?? "",
              "keyframes": r.keyframeCount,
              "textured": r.textured,
              "filledFraction": r.filledFraction ?? NSNull(),
              "geometryPath": r.geometryPath,
            ])
          case .failure(let e):
            promise.reject("mesh_scan", e.localizedDescription)
          }
        }
      }
    }

    // Regresjonsselen: kjør V2-baken på nytt mot et persistert skann-bundle (framesDir med
    // fixture-mesh.bin + fixture-kf.json) — iterér på tekstur UTEN å skanne på nytt.
    // `flags` setter meshscan.*-knottene for DENNE baken og legger dem tilbake etterpå, så
    // A/B kan kjøres fra appen i stedet for via Xcode-launch-argumenter. Bakene leser
    // UserDefaults synkront under kjøring, og køen er seriell for én bake om gangen.
    AsyncFunction("rebakeMeshScan") { (framesDirPath: String, flags: [String: String], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard #available(iOS 14.0, *) else {
          promise.reject("rebake", "Krever iOS 14"); return
        }
        let dir = URL(fileURLWithPath: framesDirPath)
        guard let fixture = MeshBakeV2.readFixture(framesDir: dir) else {
          promise.reject("rebake", "Fant ikke fixture-mesh.bin / fixture-kf.json i \(framesDirPath)")
          return
        }
        let defaults = UserDefaults.standard
        // NULLSTILL alle meshscan.*-knotter først. UserDefaults overlever mellom kjøringer, og
        // A/B-knappene fra august la igjen blend=raw, gainclamp=0.7 osv. — som stille overstyrte
        // alle nye standardverdier (device 2026-09-02: «Bygg om» ga gårsdagens bake). Kun
        // flaggene som sendes inn i DETTE kallet gjelder, og de ryddes bort etterpå.
        let stale = defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("meshscan.") }
        for k in stale { defaults.removeObject(forKey: k) }
        if !stale.isEmpty { MeshLog.log("rebake — fjernet \(stale.count) gamle meshscan.*-flagg: \(stale.sorted().joined(separator: " "))") }
        for (k, v) in flags where k.hasPrefix("meshscan.") && !v.isEmpty {
          defaults.set(v, forKey: k)
        }
        defer {
          for (k, _) in flags where k.hasPrefix("meshscan.") { defaults.removeObject(forKey: k) }
        }
        if !flags.isEmpty {
          MeshLog.log("rebake — flagg \(flags.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " "))")
        }
        // Framdrift → JS. Baken leser den statiske closuren synkront; nulles når vi er ferdige
        // så et etterfølgende live-skann ikke sender sine meldinger hit.
        ARMeshGlbExporter.progress = { [weak self] msg in
          self?.sendEvent("onRebakeProgress", ["message": msg])
        }
        ARMeshGlbExporter.isRebake = true
        defer { ARMeshGlbExporter.progress = nil; ARMeshGlbExporter.isRebake = false }
        ARMeshGlbExporter.progress?("Leser skannet…")
        // meshscan.geometry = "tsdf" bygger geometrien på nytt fra RÅ LiDAR-dybde i stedet
        // for å bruke ARKit-nettet i fixturen. ARKits nett er glattet for okklusjonsbruk,
        // og det er den egentlige grunnen til at bordkanter blir amorfe — se MeshTsdfBuild.
        var mesh = fixture.mesh
        // Samme regel som det live skannet (MeshBakeV2.exportTextured): LiDAR-geometri er
        // STANDARD når rådybden finnes; meshscan.geometry = "anchor" velger ARKit-nettet.
        // Her er det MENINGEN at det skal ta tid: brukeren har bedt om en bedre modell,
        // telefonen ligger gjerne på lading. Live-skannet tar den raske veien.
        if UserDefaults.standard.string(forKey: "meshscan.geometry") != "anchor",
           FileManager.default.fileExists(atPath: dir.appendingPathComponent("dense.jsonl").path) {
          ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR…")
          if #available(iOS 14.0, *), let t = MeshTsdfBuild.build(framesDir: dir, tillegg: mesh) {
            mesh = t
          } else {
            MeshLog.log("TSDF: bygg feilet — faller tilbake på ARKit-nettet")
          }
        }

        let ts = Int(Date().timeIntervalSince1970 * 1000)
        // Merk filnavnet med ALLE flaggene, ikke bare ståstedet — ellers får to kjøringer som
        // varierer noe annet (f.eks. icmcolor) identiske navn, og A/B-en blir umulig å lese.
        let tag = flags.keys.sorted()
          .compactMap { k -> String? in
            guard k.hasPrefix("meshscan."), let v = flags[k], !v.isEmpty else { return nil }
            return "-\(k.dropFirst("meshscan.".count))-\(v)"
          }
          .joined()
        let glbURL = dir.appendingPathComponent("rebake\(tag)-\(ts).glb")
        let t0 = CFAbsoluteTimeGetCurrent()
        let result = MeshBakeV2.bake(mesh: mesh, keyframes: fixture.keyframes, framesDir: dir, to: glbURL)
        let ms = Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)
        if result.success {
          // Forhåndsvisning (<glb>.jpg) som skann-kortet viser — live-skannet lager den i
          // presenteren, og uten den falt kortet til boks-ikonet etter en ombygging.
          ARMeshGlbExporter.progress?("Lager forhåndsvisning…")
          AmpexGlbLoader.renderThumbnail(glbPath: glbURL.path)
          promise.resolve([
            "glbPath": glbURL.path,
            "filledFraction": (result.filledFraction as Any?) ?? NSNull(),
            "ms": ms,
          ])
        } else {
          promise.reject("rebake", "Bake feilet (fylt=\(result.filledFraction.map { String($0) } ?? "-"))")
        }
      }
    }

    // Konstruert splat mot SAMME fixture som rebakeMeshScan — ingen trening, ingen ny
    // skanning. Svarer på ett spørsmål: ser splat-representasjonen bedre ut enn teksturbaken
    // på det samme skannet? Skriver splat.ply (3DGS-format) ved siden av fixturen.
    AsyncFunction("buildSplat") { (framesDirPath: String, targetCount: Int, topK: Int, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        let dir = URL(fileURLWithPath: framesDirPath)
        var opt = MeshSplatBuild.Options()
        if targetCount > 0 { opt.targetCount = targetCount }
        if topK > 0 { opt.topK = max(1, min(8, topK)) }   // topK=1 = winner-take-all, A/B-referansen
        let t0 = CFAbsoluteTimeGetCurrent()
        guard let url = MeshSplatBuild.build(framesDir: dir, options: opt) else {
          promise.reject("splat", "Splat-bygg feilet — mangler fixture, eller ingen punkter fikk sikt. Se pipeline.log")
          return
        }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int
        promise.resolve([
          "plyPath": url.path,
          "bytes": (bytes as Any?) ?? NSNull(),
          "ms": Int((CFAbsoluteTimeGetCurrent() - t0) * 1000),
        ])
      }
    }
  }
}


/// Ombygging uten UI, for iterasjon i simulatoren på Mac. Speiler `rebakeMeshScan` i
/// AmpexSplatModule, men leser flaggene fra UserDefaults (launch-argumenter `-meshscan.x y`)
/// og skriver resultat + «harness-done.txt» i bundelen.
enum MeshRebakeHarness {
    static func run(framesDirPath: String) {
        let dir: URL
        if framesDirPath.hasPrefix("/") {
            dir = URL(fileURLWithPath: framesDirPath)
        } else {
            // En fysisk iPhone har en installasjonsspesifikk containersti som Mac-en ikke
            // kjenner. Et fixture-navn skal derfor kunne løses inne i appens Documents.
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let direct = docs.appendingPathComponent(framesDirPath)
            let underScans = docs.appendingPathComponent("scan-frames").appendingPathComponent(framesDirPath)
            dir = FileManager.default.fileExists(atPath: direct.path) ? direct : underScans
        }
        let done = dir.appendingPathComponent("harness-done.txt")
        try? FileManager.default.removeItem(at: done)
        func finish(_ msg: String) {
            MeshLog.log("harness — \(msg)")
            try? msg.write(to: done, atomically: true, encoding: .utf8)
        }
        guard #available(iOS 14.0, *) else { finish("FEIL: krever iOS 14"); return }
        guard let fixture = MeshBakeV2.readFixture(framesDir: dir) else { finish("FEIL: fant ikke fixture i \(framesDirPath)"); return }
        let flags = UserDefaults.standard.dictionaryRepresentation()
            .filter { $0.key.hasPrefix("meshscan.") && $0.key != "meshscan.autorebake" }
            .map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " ")
        MeshLog.log("harness — start \(dir.lastPathComponent) flagg: \(flags)")
        ARMeshGlbExporter.progress = { msg in MeshLog.log("harness — \(msg)") }
        ARMeshGlbExporter.isRebake = true
        defer { ARMeshGlbExporter.progress = nil; ARMeshGlbExporter.isRebake = false }
        var mesh = fixture.mesh
        // Harness-only ablation: identical anchor geometry, but allow local image
        // selection on planes. Default and live capture retain their current policy.
        if UserDefaults.standard.string(forKey: "meshscan.anchorplanelock") == "off" {
            mesh.planeLock = false
        }
        MeshBakeV2.debugQualityFloor = 0.3
        defer { MeshBakeV2.debugQualityFloor = 0.3 }
        if let s = UserDefaults.standard.string(forKey: "meshscan.qualityfloor"),
           let v = Float(s), v.isFinite, v >= 0.01, v <= 0.3 {
            MeshBakeV2.debugQualityFloor = v
        }
        if UserDefaults.standard.string(forKey: "meshscan.geometry") != "anchor",
           FileManager.default.fileExists(atPath: dir.appendingPathComponent("dense.jsonl").path) {
            if let t = MeshTsdfBuild.build(framesDir: dir, tillegg: mesh) { mesh = t } else { MeshLog.log("TSDF: bygg feilet — ARKit-nettet") }
        }
        // Headless A/B only. Preserve original camera metadata and winner selection;
        // feed measured offsets directly to the sampler. No live-scan setting is changed.
        MeshBakeV2.debugImageOffsets = [:]
        MeshBakeV2.debugImageFields = [:]
        MeshBakeV2.debugImageFieldPlane = nil
        defer {
            MeshBakeV2.debugImageOffsets = [:]; MeshBakeV2.debugImageFields = [:]
            MeshBakeV2.debugImageFieldPlane = nil
        }
        if let path = UserDefaults.standard.string(forKey: "meshscan.edgeoffsets") {
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let width = obj["width"] as? Double, width.isFinite, width > 0,
                  let offsets = obj["offsets"] as? [String: [Double]] else {
                finish("FEIL: ugyldig målefil for bildeforskyvning"); return
            }
            for (id, xy) in offsets {
                guard let index = Int(id), xy.count == 2, xy.allSatisfy({ $0.isFinite && abs($0) <= 32 }),
                      let frame = fixture.keyframes.first(where: { $0.index == index }), frame.height > 0 else {
                    finish("FEIL: ugyldig bildeforskyvning"); return
                }
                let scaledHeight = width * Double(frame.height) / Double(frame.width)
                MeshBakeV2.debugImageOffsets[index] = SIMD2(Float(xy[0] / width), Float(xy[1] / scaledHeight))
            }
        }
        if let path = UserDefaults.standard.string(forKey: "meshscan.edgefields") {
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  obj["gridWidth"] as? Int == MeshPoseRefineV2.warpGridW,
                  obj["gridHeight"] as? Int == MeshPoseRefineV2.warpGridH,
                  let fields = obj["fields"] as? [String: [[Double]]], !fields.isEmpty else {
                finish("FEIL: ugyldig romlig målefelt"); return
            }
            for (id, nodes) in fields {
                guard let index = Int(id), fixture.keyframes.contains(where: { $0.index == index }),
                      nodes.count == MeshPoseRefineV2.warpGridW * MeshPoseRefineV2.warpGridH,
                      nodes.allSatisfy({ $0.count == 2 && $0.allSatisfy { $0.isFinite && abs($0) <= 0.06 } }) else {
                    finish("FEIL: ugyldig romlig bildeforskyvning"); return
                }
                MeshBakeV2.debugImageFields[index] = nodes.map { SIMD2(Float($0[0]),Float($0[1])) }
            }
            if let value = obj["plane"] {
                guard let plane = value as? [String: Any], let xyz = plane["normal"] as? [Double],
                      xyz.count == 3, xyz.allSatisfy({ $0.isFinite }),
                      let distance = plane["distance"] as? Double, distance.isFinite else {
                    finish("FEIL: ugyldig veggplan for målefelt"); return
                }
                let n = SIMD3(Float(xyz[0]), Float(xyz[1]), Float(xyz[2]))
                let length = simd_length(n), d = Float(distance)
                guard length.isFinite, length > 1e-6, d.isFinite, abs(n.y / length) < 0.35 else {
                    finish("FEIL: målefelt krever et gyldig veggplan"); return
                }
                MeshBakeV2.debugImageFieldPlane = SIMD4(n / length, d / length)
            }
        }
        let tag = UserDefaults.standard.string(forKey: "meshscan.tag") ?? ""
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        let glbURL = dir.appendingPathComponent("rebake-harness\(tag.isEmpty ? "" : "-" + tag)-\(ts).glb")
        let t0 = CFAbsoluteTimeGetCurrent()
        MeshBakeV2.debugSink = nil
        defer { MeshBakeV2.debugSink = nil }
        if UserDefaults.standard.string(forKey: "meshscan.trace") == "on" {
            let traceDir = dir.appendingPathComponent("trace-" + String(ts))
            try? FileManager.default.createDirectory(at:traceDir,withIntermediateDirectories:true)
            MeshBakeV2.debugSink = { name,data in
                do { try data.write(to:traceDir.appendingPathComponent(name),options:.atomic) }
                catch { MeshLog.log("harness — trace write failed: \(error.localizedDescription)") }
            }
            MeshLog.log("harness — trace directory \(traceDir.path)")
        }
        let result = MeshBakeV2.bake(mesh: mesh, keyframes: fixture.keyframes, framesDir: dir, to: glbURL)
        let ms = Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)
        finish(result.success ? "OK \(glbURL.lastPathComponent) \(ms)ms" : "FEIL: bake feilet")
    }
}
