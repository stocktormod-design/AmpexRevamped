import Foundation
import SceneKit
import simd

/// Viser en konstruert splat (3DGS-PLY fra `MeshSplatBuild`) i den EKSISTERENDE
/// SceneKit-vieweren, så førstepersonsnavigasjonen, markørene og resetten virker uendret.
///
/// Merk hva dette er og ikke er: SceneKit tegner punkter, ikke ellipser med gaussisk alfa.
/// Vi får altså riktig geometri og riktige farger, men ikke ekte splat-blending — flatene
/// blir litt hardere i kantene enn en dedikert splat-renderer ville gitt. Det er en bevisst
/// mellomstasjon: den koster ~50 linjer og null nye avhengigheter, og svarer på om modellen
/// er riktig. En ekte renderer (MetalSplatter eller egen Metal-shader) er neste trinn.
enum MeshSplatView {

    /// SH degree 0-basis. 3DGS lagrer farge som koeffisient, ikke som RGB.
    private static let shC0: Float = 0.28209479177387814

    /// Leser 3DGS-PLY og bygger en punktsky-node. Returnerer nil om fila ikke er en slik PLY.
    static func loadNode(path: String) -> SCNNode? {
        guard let d = FileManager.default.contents(atPath: path),
              let hdrEnd = d.range(of: Data("end_header\n".utf8)) else { return nil }
        let header = String(decoding: d[..<hdrEnd.lowerBound], as: UTF8.self)
        guard header.hasPrefix("ply") else { return nil }

        var count = 0
        var props = 0
        for line in header.split(separator: "\n") {
            if line.hasPrefix("element vertex ") { count = Int(line.dropFirst(15)) ?? 0 }
            if line.hasPrefix("property float") { props += 1 }
        }
        guard count > 0, props >= 17 else { return nil }
        let stride = props * 4
        let body = d[hdrEnd.upperBound...]
        guard body.count >= count * stride else {
            MeshLog.log("SPLATVIEW: PLY kortere enn header lover — \(body.count) < \(count * stride)")
            return nil
        }

        // Posisjon (0,1,2) og farge (f_dc på 6,7,8) er alt SceneKit trenger; skala/rotasjon/
        // opasitet hører til ekte splat-rendering og hoppes over her.
        var pos = [Float](repeating: 0, count: count * 3)
        var col = [Float](repeating: 0, count: count * 3)
        body.withUnsafeBytes { raw in
            for i in 0..<count {
                let o = i * stride
                for k in 0..<3 {
                    pos[i * 3 + k] = raw.loadUnaligned(fromByteOffset: o + k * 4, as: Float.self)
                    let c = raw.loadUnaligned(fromByteOffset: o + (6 + k) * 4, as: Float.self)
                    col[i * 3 + k] = min(1, max(0, c * shC0 + 0.5))
                }
            }
        }

        let posData = pos.withUnsafeBufferPointer { Data(buffer: $0) }
        let colData = col.withUnsafeBufferPointer { Data(buffer: $0) }
        let vSrc = SCNGeometrySource(data: posData, semantic: .vertex, vectorCount: count,
                                     usesFloatComponents: true, componentsPerVector: 3,
                                     bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let cSrc = SCNGeometrySource(data: colData, semantic: .color, vectorCount: count,
                                     usesFloatComponents: true, componentsPerVector: 3,
                                     bytesPerComponent: 4, dataOffset: 0, dataStride: 12)

        var idx = [UInt32](repeating: 0, count: count)
        for i in 0..<count { idx[i] = UInt32(i) }
        let idxData = idx.withUnsafeBufferPointer { Data(buffer: $0) }
        let el = SCNGeometryElement(data: idxData, primitiveType: .point,
                                    primitiveCount: count, bytesPerIndex: 4)
        // Taket her er kritisk. Punktene ligger millimeter fra hverandre i VERDEN, så jo
        // nærmere du står, jo flere piksler må hvert punkt dekke for at flaten skal henge
        // sammen. Et lavt tak (8 px var første forsøk) gjør at veggen faller fra hverandre
        // i prikker så snart du zoomer inn — modellen er hel, det er tegningen som gir opp.
        // Gulvet på 2 px hindrer at fjerne flater forsvinner mellom pikslene.
        el.pointSize = 10
        el.minimumPointScreenSpaceRadius = 2
        el.maximumPointScreenSpaceRadius = 96

        let geo = SCNGeometry(sources: [vSrc, cSrc], elements: [el])
        // Fargene er allerede belyst (bakt fra fotoene) — all ekstra lyssetting ville
        // dobbeltbelyst dem. Samme grunn som teksturbaken bruker constant.
        let mat = SCNMaterial()
        mat.lightingModel = .constant
        mat.isDoubleSided = true
        mat.writesToDepthBuffer = true
        geo.firstMaterial = mat

        MeshLog.log("SPLATVIEW: \(count) punkter lastet fra \((path as NSString).lastPathComponent)")
        return SCNNode(geometry: geo)
    }
}
