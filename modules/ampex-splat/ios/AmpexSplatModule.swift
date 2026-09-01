import ExpoModulesCore
import Foundation

/// Holder mesh-skanneren i live mens dens UI er presentert.
enum MeshSession {
  static var current: MeshScanPresenter?
}

public final class AmpexSplatModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AmpexSplat")

    // Juni-mesh-pipelinen (den beviste): presenter fullskjerm LiDAR-mesh-skanner
    // (egen UI m/ dekning + Ferdig), baker tekstur on-device, returnerer GLB.
    AsyncFunction("presentMeshScan") { (companyId: String, roomId: String, promise: Promise) in
      DispatchQueue.main.async {
        guard let vc = self.appContext?.utilities?.currentViewController() else {
          promise.reject("no_vc", "Fant ikke aktiv view controller")
          return
        }
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
        var restore: [String: String?] = [:]
        for (k, v) in flags where k.hasPrefix("meshscan.") {
          restore[k] = defaults.string(forKey: k)
          if v.isEmpty { defaults.removeObject(forKey: k) } else { defaults.set(v, forKey: k) }
        }
        defer {
          for (k, v) in restore {
            if let v = v { defaults.set(v, forKey: k) } else { defaults.removeObject(forKey: k) }
          }
        }
        if !flags.isEmpty {
          MeshLog.log("rebake — flagg \(flags.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " "))")
        }
        // meshscan.geometry = "tsdf" bygger geometrien på nytt fra RÅ LiDAR-dybde i stedet
        // for å bruke ARKit-nettet i fixturen. ARKits nett er glattet for okklusjonsbruk,
        // og det er den egentlige grunnen til at bordkanter blir amorfe — se MeshTsdfBuild.
        var mesh = fixture.mesh
        if UserDefaults.standard.string(forKey: "meshscan.geometry") == "tsdf" {
          ARMeshGlbExporter.progress?("Bygger geometri fra LiDAR…")
          if #available(iOS 14.0, *), let t = MeshTsdfBuild.build(framesDir: dir) {
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
