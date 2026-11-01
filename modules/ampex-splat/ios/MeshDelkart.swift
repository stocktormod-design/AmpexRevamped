import Foundation
import Metal
import simd

/// ET DELKART (2026-10-27, M1 i docs/PROMPT_OPUS_SKANN_DELKART.md). Et sparsomt 8³-blokk-TSDF
/// i sitt eget koordinatsystem, 12 × 5 × 12 m à 20 mm. Koordinatsystemet er ARKits verden
/// slik den var da delkartet ble åpnet; `T` flytter det dit ARKit mener det ligger NÅ
/// (T = A_nå · A₀⁻¹, A = delkartets eget ARAnchor). Retter ARKit sporingen, følger hele
/// delkartet med som én blokk — M0 målte at den gjør det som en dreining om ankeret (§115),
/// derfor ligger ankeret i delkartets origo.
///
/// Bare det aktive delkartet har volumet på GPU (bufferne eies av `MeshDelkartFusjon` og
/// gjenbrukes). Et lukket delkart er et volum på disk (`DelkartLager`), en beskåret
/// dekningstekstur på GPU (for overlegget) og samme dekning som bytes på CPU (veiledningen).
final class Delkart {
    enum Tilstand: String, Codable { case aktiv, lukket, bakes, ferdig, feilet }

    static let vox: Float = 0.020
    static let dim = SIMD3<Int32>(600, 250, 600)
    static let bdim = SIMD3<Int32>(75, 32, 75)            // 8³-blokker; 32·8 = 256 ≥ 250
    static let celle: Float = 0.05
    static let celleDim = SIMD3<Int32>(240, 100, 240)     // samme 5 cm-ruter som dekningsfeltet hadde
    /// Origo i volumet: kameraet står midt på vannrett og 2,4 m over bunnen (gulvet ligger
    /// 1,5–1,7 m under kameraet; samme loddrette fordeling som dekningsfeltet brukte).
    static let kameraIVolumet = SIMD3<Float>(6, 2.4, 6)

    let id: Int
    let ankerID: UUID
    /// Ankerets transform da delkartet ble åpnet.
    let A0: simd_float4x4
    /// Delkart → verden nå. Identitet til ARKit flytter ankeret.
    var T = matrix_identity_float4x4 { didSet { w2d = T.inverse } }
    /// Volumets nedre hjørne i delkartets koordinater (meter).
    let lo: SIMD3<Float>
    let åpnet: TimeInterval
    var lukket: TimeInterval?
    var tilstand: Tilstand = .aktiv
    var dybdekart: [Int] = []
    var nøkkelbilder: [Int] = []
    var antallBlokker = 0

    /// Dekningen for et lukket delkart: beskåret til de allokerte blokkene, i celler.
    var celleLo = SIMD3<Int32>(0, 0, 0)
    var celleN = Delkart.celleDim
    var tekstur: MTLTexture?
    var celler: [UInt8] = []

    init(id: Int, ankerID: UUID, A0: simd_float4x4, lo: SIMD3<Float>, åpnet: TimeInterval) {
        self.id = id; self.ankerID = ankerID; self.A0 = A0; self.lo = lo; self.åpnet = åpnet
    }

    var origo: SIMD3<Float> { lo + Delkart.kameraIVolumet }
    var utstrekning: SIMD3<Float> { SIMD3<Float>(Delkart.dim) * Delkart.vox }

    /// Verden → delkart. Lagret, ikke regnet: veiledningen slår opp hundretusener av punkter
    /// per pass, og en 4×4-invers per oppslag gjorde dekningspasset 3× tregere (telefon 27.10).
    private(set) var w2d = matrix_identity_float4x4
}

/// Det som skrives til `delkart/N/kart.json` ved lukking. M2s bake-arbeider leser dette.
struct DelkartKart: Codable {
    var id: Int
    var ankerID: String
    var A0: [Float]
    var T: [Float]
    var lo: [Float]
    var vox: Float
    var dim: [Int32]
    var åpnet: Double
    var lukket: Double
    var dybdekart: [Int]
    var nøkkelbilder: [Int]
    var antallBlokker: Int
    var celleLo: [Int32]
    var celleN: [Int32]
}

enum DelkartLager {
    static func mappe(_ framesDir: URL, _ id: Int) -> URL {
        framesDir.appendingPathComponent("delkart/\(id)", isDirectory: true)
    }

    static func flat(_ m: simd_float4x4) -> [Float] {
        [m.columns.0.x, m.columns.0.y, m.columns.0.z, m.columns.0.w, m.columns.1.x, m.columns.1.y, m.columns.1.z, m.columns.1.w,
         m.columns.2.x, m.columns.2.y, m.columns.2.z, m.columns.2.w, m.columns.3.x, m.columns.3.y, m.columns.3.z, m.columns.3.w]
    }

    /// `blokker.bin`: "DKB1", Int32 antall, antall × int4 (bx, by, bz, plass), så Σwd og Σw
    /// som Float for antall·512 plasser hver. Leses rett ut av de delte GPU-bufferne, uten kopi.
    static func skriv(_ d: Delkart, framesDir: URL, koord: UnsafeRawPointer, sumWD: UnsafeRawPointer,
                      sumW: UnsafeRawPointer) throws -> Int {
        let dir = mappe(framesDir, d.id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("blokker.bin")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let h = try FileHandle(forWritingTo: url)
        defer { try? h.close() }
        var hode = Data("DKB1".utf8)
        withUnsafeBytes(of: Int32(d.antallBlokker).littleEndian) { hode.append(contentsOf: $0) }
        try h.write(contentsOf: hode)
        let n = d.antallBlokker
        try h.write(contentsOf: Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: koord), count: n * 16, deallocator: .none))
        try h.write(contentsOf: Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: sumWD), count: n * 512 * 4, deallocator: .none))
        try h.write(contentsOf: Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: sumW), count: n * 512 * 4, deallocator: .none))
        let kart = DelkartKart(id: d.id, ankerID: d.ankerID.uuidString, A0: flat(d.A0), T: flat(d.T),
                               lo: [d.lo.x, d.lo.y, d.lo.z], vox: Delkart.vox,
                               dim: [Delkart.dim.x, Delkart.dim.y, Delkart.dim.z],
                               åpnet: d.åpnet, lukket: d.lukket ?? d.åpnet,
                               dybdekart: d.dybdekart, nøkkelbilder: d.nøkkelbilder, antallBlokker: n,
                               celleLo: [d.celleLo.x, d.celleLo.y, d.celleLo.z],
                               celleN: [d.celleN.x, d.celleN.y, d.celleN.z])
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        try enc.encode(kart).write(to: dir.appendingPathComponent("kart.json"), options: .atomic)
        return 8 + n * 16 + n * 512 * 8
    }
}

/// Veiledningen når et delkart lukkes (M3.5, M4.1), fra ARKit-nettets vertekser rundt kameraet
/// i 0,5 m-ruter. *Trapp*: under 2 m² gulv på én høyde (15 cm) innen 2 m. *Vegg mangler*:
/// gulvruter innen 4 m der en nabo er TOM (ingen flate i noen høyde, så ikke en sofa eller et
/// annet rom gjennom en dør), og uten loddrett flate ≥ 1 m høy i ruta eller en nabo; fire
/// eller flere (≈ 2 m kant) gir et punkt å peke mot.
struct LukkeVurdering {
    let kamera: SIMD3<Float>
    private var gulv = Set<Int64>()
    private var gulvHøyder = [Int32: Set<Int64>]()
    private var veggLav = [Int64: Float](), veggHøy = [Int64: Float]()
    private var noe = Set<Int64>()

    init(kamera: SIMD3<Float>) { self.kamera = kamera }

    private static func k(_ x: Int32, _ z: Int32) -> Int64 { (Int64(x) & 0xFFFFFFFF) | (Int64(z) << 32) }
    private static func rute(_ p: SIMD3<Float>) -> Int64 {
        k(Int32((p.x * 2).rounded(.down)), Int32((p.z * 2).rounded(.down)))
    }

    /// Én vertex med normalens y-komponent. Alt over 5 m unna vannrett ignoreres.
    mutating func legg(_ p: SIMD3<Float>, ny: Float) {
        let dx = p.x - kamera.x, dz = p.z - kamera.z
        let d2 = dx * dx + dz * dz
        if d2 > 25 { return }
        let dy = p.y - kamera.y
        if dy > -2.2 && dy < 1.5 { noe.insert(Self.rute(p)) }
        if ny > 0.8 && dy < -0.5 && dy > -2.2 {
            let r = Self.rute(p)
            gulv.insert(r)
            if d2 < 4 { gulvHøyder[Int32((p.y / 0.05).rounded(.down)), default: []].insert(r) }
        } else if abs(ny) < 0.3 && dy > -2.2 && dy < 1.5 {
            let r = Self.rute(p)
            veggLav[r] = min(veggLav[r] ?? p.y, p.y)
            veggHøy[r] = max(veggHøy[r] ?? p.y, p.y)
        }
    }

    /// `gulvRuter`: flest ruter på én høyde innen 2 m. `veggM`: meter gulvkant uten vegg.
    func resultat() -> (trapp: Bool, vegg: SIMD3<Float>?, veggM: Float, gulvRuter: Int) {
        var ettGulv = 0
        for b in gulvHøyder.keys {
            let u = (gulvHøyder[b - 1] ?? []).union(gulvHøyder[b] ?? []).union(gulvHøyder[b + 1] ?? [])
            ettGulv = max(ettGulv, u.count)
        }
        var sum = SIMD2<Float>(0, 0), n = 0
        for r in gulv {
            let x = Int32(truncatingIfNeeded: r), z = Int32(truncatingIfNeeded: r >> 32)
            let c = SIMD2<Float>((Float(x) + 0.5) * 0.5, (Float(z) + 0.5) * 0.5)
            guard simd_length_squared(c - SIMD2(kamera.x, kamera.z)) < 16 else { continue }
            guard !noe.contains(Self.k(x + 1, z)) || !noe.contains(Self.k(x - 1, z))
                || !noe.contains(Self.k(x, z + 1)) || !noe.contains(Self.k(x, z - 1)) else { continue }
            var vegg = false
            nabo: for dz in -1...1 { for dx in -1...1 {
                let nb = Self.k(x + Int32(dx), z + Int32(dz))
                if let lo = veggLav[nb], let hi = veggHøy[nb], hi - lo >= 1.0 { vegg = true; break nabo }
            } }
            if !vegg { sum += c; n += 1 }
        }
        let v: SIMD3<Float>? = n >= 4 ? SIMD3(sum.x / Float(n), kamera.y, sum.y / Float(n)) : nil
        return (ettGulv < 8, v, Float(n) * 0.5, ettGulv)
    }
}
