import Foundation
import SceneKit
import AppKit
import simd

// Bruk: swiftc -O tools/audit-scan-hull.swift -o /tmp/hull && /tmp/hull <glb>.blokker <bundle> <ut.json>
// for hvert nøkkelbilde, rendre modellen fra bildets pose i
// dybdekartets oppløsning ×2 og sammenlign med LiDAR-dybden. Skriver hullpunkter i verden.
let a = CommandLine.arguments
let dir = URL(fileURLWithPath: a[1]), bundle = URL(fileURLWithPath: a[2])
let meta = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("blokker.json"))) as! [String: Any]
let scene = SCNScene()
scene.background.contents = NSColor.red
for b in meta["blokker"] as! [[String: Any]] {
  let id = b["id"] as! Int
  let geo = try Data(contentsOf: dir.appendingPathComponent("b\(id).geo"))
  let n = geo.count / 20
  let pos = SCNGeometrySource(data: geo, semantic: .vertex, vectorCount: n, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 20)
  let ind = (0..<UInt32(n)).map { $0 }
  let el = SCNGeometryElement(data: ind.withUnsafeBytes { Data($0) }, primitiveType: .triangles, primitiveCount: n / 3, bytesPerIndex: 4)
  let g = SCNGeometry(sources: [pos], elements: [el])
  let m = SCNMaterial(); m.lightingModel = .constant; m.isDoubleSided = true; m.diffuse.contents = NSColor.white
  g.materials = [m]
  scene.rootNode.addChildNode(SCNNode(geometry: g))
}
let cn = SCNNode(); cn.camera = SCNCamera(); cn.camera!.zNear = 0.02; cn.camera!.zFar = 50
scene.rootNode.addChildNode(cn)
let r = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil); r.scene = scene; r.pointOfView = cn
let frames = try JSONSerialization.jsonObject(with: Data(contentsOf: bundle.appendingPathComponent("frames.json"))) as! [[String: Any]]
var hull: [[Float]] = []       // x y z frame type(0 = LiDAR så flate, 1 = ingen retur)
var statistikk: [[Double]] = []
for (fi, f) in frames.enumerated() {
  autoreleasepool {
    guard let df = f["depthFile"] as? String, let dw = f["depthWidth"] as? Int, let dh = f["depthHeight"] as? Int,
          let d = try? Data(contentsOf: bundle.appendingPathComponent(df)), d.count == dw * dh * 4 else { return }
    let depth: [Float] = d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    let t = (f["transform"] as! [Double]).map(Float.init)
    let c2w = simd_float4x4(columns: (SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]), SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15])))
    let intr = (f["intrinsics"] as! [Double]).map(Float.init)
    let iw = Float(f["width"] as! Int)
    let s = Float(dw) / iw
    let fx = intr[0] * s, fy = intr[1] * s, cx = intr[2] * s, cy = intr[3] * s
    cn.camera!.fieldOfView = CGFloat(2 * atan(Float(dh) / 2 / fy) * 180 / .pi)
    cn.simdTransform = c2w
    let img = r.snapshot(atTime: 0, with: CGSize(width: dw, height: dh), antialiasingMode: .none)
    guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    var px = [UInt8](repeating: 0, count: dw * dh * 4)
    px.withUnsafeMutableBytes { m in
      CGContext(data: m.baseAddress, width: dw, height: dh, bitsPerComponent: 8, bytesPerRow: dw * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        .draw(cg, in: CGRect(x: 0, y: 0, width: dw, height: dh))
    }
    var gyldig = 0, hullSett = 0, hullIngen = 0
    for v in 0..<dh { for u in 0..<dw {
      let i = v * dw + u
      let erHull = px[i * 4] > 200 && px[i * 4 + 1] < 60
      let z = depth[i]
      let ok = z.isFinite && z > 0.2 && z < 4.5
      if ok { gyldig += 1 }
      guard erHull else { continue }
      if ok {
        hullSett += 1
        let pc = SIMD4(((Float(u) + 0.5) - cx) / fx * z, -((Float(v) + 0.5) - cy) / fy * z, -z, 1)
        let w = c2w * pc
        hull.append([w.x, w.y, w.z, Float(fi), 0])
      } else { hullIngen += 1 }
    } }
    statistikk.append([Double(fi), Double(gyldig), Double(hullSett), Double(hullIngen), Double(dw * dh)])
  }
}
let o: [String: Any] = ["hull": hull, "stat": statistikk]
try JSONSerialization.data(withJSONObject: o).write(to: URL(fileURLWithPath: a[3]))
print("\(statistikk.count) bilder, \(hull.count) hullpiksler der LiDAR så flate")
