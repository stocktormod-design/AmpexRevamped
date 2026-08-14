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
