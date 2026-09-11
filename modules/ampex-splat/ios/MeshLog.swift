import Foundation

/// Pipeline-logg til fil: NSLog går til os_log som ikke kan hentes fra Mac uten root, så
/// nøkkellinjene skrives OGSÅ til Documents/room-scans/pipeline.log — hentes med
/// `devicectl device copy from` for feilsøking uten Xcode.
enum MeshLog {
    private static let queue = DispatchQueue(label: "no.ampex.meshlog")
    private static let url: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("room-scans/pipeline.log")
    }()
    private static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func log(_ msg: String) {
        NSLog("[MeshScan] %@", msg)
        queue.async {
            let line = "\(stamp.string(from: Date())) \(msg)\n"
            guard let data = line.data(using: .utf8) else { return }
            if let h = try? FileHandle(forWritingTo: url) {
                defer { try? h.close() }
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: data)
            } else {
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: url)
            }
        }
    }
}


/// Leser 3 × Float (12 byte) fra en rå ARKit-buffer. ALDRI som `SIMD3<Float>` — den er
/// 16 byte og leser 4 byte forbi siste element (segfault på sidegrense, 2026-09-07).
@inline(__always) func les3Float(_ base: UnsafeMutableRawPointer, _ offset: Int) -> SIMD3<Float> {
    let f = base.advanced(by: offset).assumingMemoryBound(to: Float.self)
    return SIMD3<Float>(f[0], f[1], f[2])
}


import os
/// os_proc_available_memory() gir 0 i simulatoren (Mac-harness) — da later vi som 2,5 GB
/// så budsjettet (atlas/maxKF/topK) og GPU-fusjonen blir som på telefonen.
enum MeshSimMem {
    static func available() -> Int {
        let v = os_proc_available_memory()
        return v == 0 ? 2500 * 1024 * 1024 : v
    }
}
