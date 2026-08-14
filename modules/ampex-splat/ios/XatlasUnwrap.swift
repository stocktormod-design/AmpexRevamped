import Foundation

// Progress fra xatlas' C-callback (kan ikke fange kontekst) → global handler.
// Returner false for å avbryte → caller faller tilbake til box-unwrap.
nonisolated(unsafe) var xatlasProgressHandler: ((Int, Int) -> Bool)?
private let xatlasProgressTrampoline: @convention(c) (Int32, Int32) -> Int32 = { category, percent in
    (xatlasProgressHandler?(Int(category), Int(percent)) ?? true) ? 1 : 0
}

/// Delt kanselleringsflagg mellom fristvokteren og xatlas-tråden.
private final class XatlasCancelFlag: @unchecked Sendable {
    var cancelled = false
}
private final class XatlasJobBox: @unchecked Sendable {
    var result: XatlasResult?
}

/// xatlas-based UV unwrap (replaces the box projection for far fewer seams / less stretch).
/// Kjøres på egen tråd med HARD frist: på stygg topologi kan Generate() bli sittende uten å
/// rapportere progress i det hele tatt, og da hjelper ingen callback-vakthund. Ved frist settes
/// kanselleringsflagget (zombietråden avbryter ved neste callback eller rydder selv når den
/// omsider blir ferdig) og caller får nil → box-unwrap-fallback. Pipelinen kan aldri henge her.
@available(iOS 13.4, *)
func xatlasUnwrapUVs(
    positions: [Float],
    normals: [Float],
    indices: [UInt32],
    triAnchor: [UInt32] = [],    // per-tri anchor-id → chunket unwrap (én xatlas-mesh per anchor)
    resolution: UInt32 = 2048,
    timeout: TimeInterval = 600  // KUN mot total-wedge (ingen callbacks). Treg-men-jobber er OK:
                                 // kvaliteten kommer fra at xatlas fullfører — box-fallback er nødløsning.
) -> ARMeshGlbExporter.UVUnwrapResult? {
    if positions.isEmpty || indices.isEmpty { return nil }
    let chunked = triAnchor.count == indices.count / 3
    MeshLog.log("xatlas start — verts=\(positions.count / 3) tris=\(indices.count / 3) chunked=\(chunked)")
    let t0 = CFAbsoluteTimeGetCurrent()

    let flag = XatlasCancelFlag()
    let userHandler = xatlasProgressHandler
    xatlasProgressHandler = { category, percent in
        if flag.cancelled { return false }
        return userHandler?(category, percent) ?? true
    }
    xatlas_set_progress(xatlasProgressTrampoline)

    let sem = DispatchSemaphore(value: 0)
    let job = XatlasJobBox()
    DispatchQueue.global(qos: .userInitiated).async {
        var r = positions.withUnsafeBufferPointer { pBuf in
            normals.withUnsafeBufferPointer { nBuf in
                indices.withUnsafeBufferPointer { iBuf in
                    triAnchor.withUnsafeBufferPointer { aBuf in
                        xatlas_unwrap(
                            pBuf.baseAddress,
                            UInt32(positions.count / 3),
                            normals.isEmpty ? nil : nBuf.baseAddress,
                            iBuf.baseAddress,
                            UInt32(indices.count),
                            chunked ? aBuf.baseAddress : nil,
                            resolution
                        )
                    }
                }
            }
        }
        if flag.cancelled { xatlas_free(&r) } // ingen venter lenger — rydd selv
        else { job.result = r }
        sem.signal()
    }

    if sem.wait(timeout: .now() + timeout) == .timedOut {
        flag.cancelled = true
        // IKKE gjenopprett userHandler: zombietråden ville da (a) aldri se kanselleringen og
        // (b) fortsette å skrive «Analyserer flater…» oppå de nye stegtekstene (så pipelinen
        // SER stuck ut selv når den går videre). Drep zombien ved neste callback i stedet.
        xatlasProgressHandler = { _, _ in false }
        MeshLog.log("xatlas TIMEOUT etter \(Int(timeout))s — faller tilbake til box-unwrap")
        return nil
    }
    xatlasProgressHandler = userHandler

    guard var result = job.result else { return nil }
    guard result.ok != 0,
          result.vertexCount > 0, result.indexCount > 0,
          let pp = result.positions, let np = result.normals, let up = result.uvs, let ip = result.indices
    else {
        xatlas_free(&result)
        return nil
    }

    let vc = Int(result.vertexCount)
    let ic = Int(result.indexCount)
    let outPos = Array(UnsafeBufferPointer(start: pp, count: vc * 3))
    let outNorm = Array(UnsafeBufferPointer(start: np, count: vc * 3))
    let outUV = Array(UnsafeBufferPointer(start: up, count: vc * 2))
    let outIdx = Array(UnsafeBufferPointer(start: ip, count: ic))
    let atlasW = Int(result.atlasWidth)
    xatlas_free(&result)

    MeshLog.log("xatlas unwrap FERDIG — outVerts=\(vc) outTris=\(ic / 3) atlas=\(atlasW) ms=\(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))")
    return ARMeshGlbExporter.UVUnwrapResult(
        positions: outPos, normals: outNorm, uvs: outUV, indices: outIdx, chartCount: 0, atlasSize: atlasW
    )
}
