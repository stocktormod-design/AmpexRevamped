#!/usr/bin/env python3
"""Bake per delkart (M2, §120): den EKTE `MeshBakeArbeider` på et ekte skann, på Mac.

Bruk: verify-scan-hus.py <bundleDir> <delkartDir>

`delkartDir` er utmappa fra `verify-scan-delkart.py` (den har `delkart/N/kart.json` og
`blokker.bin` laget av den ekte live-fusjonen). Bundlens fixture lenkes inn i en arbeidsmappe
sammen med delkartene, og `MeshBakeArbeider.bakHus` kjøres med bundlens ARKit-nett og
nøkkelbilder. Selve baken (og bindingen og TSDF-en, som trenger Metal på telefonen) er
byttet ut med en stand-in som skriver en GLB av nettet den får med den ekte `writeTiledGlb`,
og et lite relok-kart. Alt annet er den ekte koden: grupperingen, omfanget, fordelingen av
ARKit-nettet, klippingen mot eldre delkart, sammenslåingen av GLB og relok, og `hus.json`.

Husets poseløsning (`løsHus`: loop closure via felles bilder + etasjer) prøves på fire deler i
ring med kjent, voksende drift og skjev støy per bilde. Gulvhøyden og nettet til disk prøves også.

Påstander: hver bakegruppe fikk akkurat sine egne nøkkelbilder; hver trekant i ARKit-nettet
havner i minst én del; etter klipp ligger ingen trekant i to deler; den sammenslåtte
GLB-en er gyldig og har like mange trekanter og fliser som delene til sammen; relok-kartet
har alle punktene og ingen etikett fra to deler.
"""
import json, os, struct, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IOS = ROOT / 'modules/ampex-splat/ios'


def blokk(src, start, indent='    '):
    a = src.index(start)
    b = src.index('\n' + indent + '}\n', a) + len(indent) + 3
    return src[a:b]


bake = (IOS / 'MeshBakeV2.swift').read_text()
merged = blokk(bake, '    struct MergedMesh {')
readfix = blokk(bake, '    static func readFixture(')
pres = (IOS / 'MeshScanPresenter.swift').read_text()
keyframe = blokk(pres, '    struct Keyframe: Codable {')
glb = (IOS / 'ARMeshGlbExporter.swift').read_text()
tiled = blokk(glb, '    static func writeTiledGlb(')

stubs = f'''
import Foundation
import simd
extension SIMD4 where Scalar == Float {{ var xyz: SIMD3<Float> {{ SIMD3(x, y, z) }} }}
enum MeshLog {{ static func log(_ s: String) {{ print(s) }} }}
enum MeshSimMem {{ static func available() -> Int {{ 3_000_000_000 }} }}
enum MeshScanPresenter {{
{keyframe}
}}
enum ARMeshGlbExporter {{
    struct TexturedExportResult {{ let success: Bool; let filledFraction: Double?; let geometryPath: String }}
    static var progress: ((String) -> Void)?
{tiled}
}}
enum MeshRelok {{ static func kartURL(glb: URL) -> URL {{ URL(fileURLWithPath: glb.path + ".relok") }} }}
enum MeshBildebinding {{
    static func bind(framesDir: URL, keyframes: [MeshScanPresenter.Keyframe]) -> [MeshScanPresenter.Keyframe] {{
        Test.bundet.append((MeshBakeArbeider.omfang!.id, keyframes.map {{ $0.index }}))
        return keyframes
    }}
}}
enum MeshTsdfBuild {{
    static func build(framesDir: URL, tillegg: MeshBakeV2.MergedMesh?, poseSink: (([Int: [Float]]) -> Void)?) -> MeshBakeV2.MergedMesh? {{
        return nil
    }}
}}
enum MeshBakeV2 {{
    private static let fixtureMagic: UInt32 = 0x414D5058
    static func flaggTall(_ key: String, _ standard: Float) -> Float {{
        if let s = UserDefaults.standard.string(forKey: key), let v = Double(s) {{ return Float(v) }}
        return standard
    }}
{merged}
{readfix}
    static func driftrettedeKeyframes(_ k: [MeshScanPresenter.Keyframe], _ r: [Int: [Float]]) -> [MeshScanPresenter.Keyframe] {{ k }}
    /// Stand-in: GLB av nettet med den ekte flisskriveren, én liten JPEG-flis, og et relok-kart.
    static func bake(mesh: MergedMesh, keyframes: [MeshScanPresenter.Keyframe], framesDir: URL, to url: URL)
        -> ARMeshGlbExporter.TexturedExportResult {{
        let id = MeshBakeArbeider.omfang!.id
        Test.bakt.append((id, mesh))
        let n = mesh.positions.count / 3
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xD9])
        try! ARMeshGlbExporter.writeTiledGlb(positions: mesh.positions, normals: mesh.normals,
            uvs: [Float](repeating: 0.5, count: n * 2), indices: mesh.indices,
            tileOf: [Int](repeating: 0, count: mesh.indices.count / 3), tiles: [jpeg], to: url)
        var o = Data("RLK1".utf8)
        func put<T>(_ v: T) {{ withUnsafeBytes(of: v) {{ o.append(contentsOf: $0) }} }}
        let m = 50 + id
        put(UInt32(m)); put(Float(0.01)); put(Float(-0.02)); put(Float(1))
        for i in 0..<m {{ put(UInt32(i)) }}
        for i in 0..<m {{ put(Float(id)); put(Float(i)); put(Float(0)) }}
        o.append(Data(repeating: UInt8(id), count: 128 * m))
        try! o.write(to: MeshRelok.kartURL(glb: url))
        return .init(success: true, filledFraction: 0.9, geometryPath: "stand-in")
    }}
}}
enum Test {{
    static var bundet: [(Int, [Int])] = []
    static var bakt: [(Int, MeshBakeV2.MergedMesh)] = []
}}
'''

MAIN = r'''
import Foundation
import simd
setvbuf(stdout, nil, _IONBF, 0)
let bundle = URL(fileURLWithPath: CommandLine.arguments[1])
let arbeid = URL(fileURLWithPath: CommandLine.arguments[2])
guard let fx = MeshBakeV2.readFixture(framesDir: bundle) else { fatalError("ingen fixture") }
let alle = MeshBakeArbeider.kart(arbeid)
let grupper = MeshBakeArbeider.grupper(alle, framesDir: arbeid)
print("grupper: " + grupper.map { g in "[" + g.map { "\($0.id):\($0.nøkkelbilder.count)" }.joined(separator: ",") + "]" }.joined(separator: " "))
for g in grupper where g.count > 1 {
    precondition(g.reduce(0) { $0 + $1.nøkkelbilder.count } <= 450 || g.contains { $0.nøkkelbilder.count < 12 || $0.dybdekart.count < 40 },
                 "gruppe over 450 bilder")
}
if grupper.count < 2 {
    precondition(!MeshBakeArbeider.gjelder(arbeid))
    print("én gruppe → global bake (som i dag)")
    print("ENGRUPPE")
    exit(0)
}
precondition(MeshBakeArbeider.gjelder(arbeid))
let ut = arbeid.appendingPathComponent("hus-test.glb")
guard let r = MeshBakeArbeider.bakHus(framesDir: arbeid, arkit: fx.mesh, keyframes: fx.keyframes, to: ut), r.success
else { fatalError("bakHus feilet") }

// 1. Hver gruppe fikk alle sine egne nøkkelbilder, og hvert nøkkelbilde er eget i høyst én gruppe.
precondition(Test.bundet.count == grupper.count, "bundet \(Test.bundet.count) grupper, ventet \(grupper.count)")
let finnes = Set(fx.keyframes.map { $0.index })
var egneAlle: [Int] = []
var ekstra = 0
for (g, (id, idx)) in zip(grupper, Test.bundet) {
    precondition(g[0].id == id)
    let egne = Set(g.flatMap { $0.nøkkelbilder }).intersection(finnes)
    precondition(egne.isSubset(of: Set(idx)), "delkart \(id) mangler egne bilder")
    precondition(idx.count <= 450, "delkart \(id): \(idx.count) bilder over taket")
    egneAlle += egne
    ekstra += idx.count - egne.count
}
precondition(egneAlle.count == Set(egneAlle).count, "et nøkkelbilde eget i to grupper")
print("bilder: \(egneAlle.count) av \(fx.keyframes.count) egne i \(grupper.count) grupper, \(ekstra) lånt fra andre delkart")

// 2. ARKit-nettet: hver trekant havner i minst én del (ingenting går tapt).
let nT = fx.mesh.indices.count / 3
func sentroide(_ m: MeshBakeV2.MergedMesh, _ t: Int) -> SIMD3<Float> {
    var c = SIMD3<Float>(0, 0, 0)
    for j in 0..<3 { let v = Int(m.indices[t * 3 + j]); c += SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]) }
    return c / 3
}
let fordelt = MeshBakeArbeider.fordel(fx.mesh, på: grupper, keyframes: fx.keyframes, framesDir: arbeid)
var nøkler = Set<SIMD3<Float>>()
var iDelene = 0
for d in fordelt { iDelene += d.indices.count / 3; for t in 0..<(d.indices.count / 3) { nøkler.insert(sentroide(d, t)) } }
var iNoen = 0
for t in 0..<nT where nøkler.contains(sentroide(fx.mesh, t)) { iNoen += 1 }
print(String(format: "ARKit-nett: %d trekanter, %d i minst én del, %.2f deler per trekant før klipp", nT, iNoen, Double(iDelene) / Double(max(1, iNoen))))
precondition(iNoen == nT, "\(nT - iNoen) ARKit-trekanter falt utenfor alle delene")

// 3. Etter klipp: ingen trekant i to deler.
var sett = [SIMD3<Float>: Int]()
var dobbelt = 0, sum = 0
for (id, m) in Test.bakt {
    for t in 0..<(m.indices.count / 3) {
        var c = SIMD3<Float>(0, 0, 0)
        for j in 0..<3 { let v = Int(m.indices[t * 3 + j]); c += SIMD3(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]) }
        if let a = sett[c], a != id { dobbelt += 1 } else { sett[c] = id }
        sum += 1
    }
}
print("etter klipp: \(sum) trekanter i \(Test.bakt.count) deler, \(dobbelt) i to deler")
precondition(dobbelt == 0, "trekanter i to deler etter klipp")
precondition(sum >= iNoen * 9 / 10, "klippet tok mer enn overlappet: \(sum) av \(iNoen)")
// 3b. Skjøten sveises: de fleste randverteksene klippet laget, flyttes inn på eldre flate,
//     og ingen flyttes lenger enn sveisegrensa.
let sv = MeshBakeArbeider.sisteSveis
print(String(format: "sveising: %d av %d randvertekser flyttet, lengst %.1f mm", sv.sveiset, sv.rand, sv.maks * 1000))
precondition(sv.rand > 0, "klippet laget ingen rand")
precondition(sv.sveiset * 2 >= sv.rand, "under halvparten av randen ble sveiset")
precondition(sv.maks <= MeshBakeArbeider.Overflate.sveis + 1e-6)
// 4. Husets poseløsning finner kjent drift igjen: fire deler i ring (runde tilbake til del 0),
//    drift som vokser med delen, skjev støy per bilde, og gulvhøyder.
do {
    let kf = Array(fx.keyframes.prefix(120))
    func D(_ p: Int) -> simd_float4x4 {
        var m = simd_float4x4(simd_quatf(angle: Float(p) * 0.4 * .pi / 180, axis: SIMD3(0, 1, 0)))
        m.columns.3 = SIMD4(Float(p) * 0.02, Float(p) * 0.015, Float(p) * -0.01, 1)
        return m
    }
    var deler: [MeshBakeArbeider.HusDel] = []
    for p in 0..<4 {
        // Del p eier bildene [30p, 30p+30) og deler 10 med neste (del 3 med del 0: runden tilbake).
        let egne = Array(kf[(30 * p)..<(30 * p + 30)]) + Array(kf[((30 * p + 30) % 120)..<((30 * p + 30) % 120 + 10)])
        var poser: [Int: simd_float4x4] = [:]
        for (i, k) in egne.enumerated() {
            var m = D(p).inverse * MeshBakeArbeider.matrise(k.transform)
            let s = Float((i * 5 + p * 3) % 11) - 3
            m = simd_float4x4(simd_quatf(angle: s * 0.0005, axis: SIMD3(0, 1, 0))) * m
            m.columns.3 += SIMD4(s * 0.0012, -s * 0.0008, s * 0.001, 0)
            poser[k.index] = m
        }
        deler.append(.init(id: p, poser: poser, gulv: p == 2 ? nil : 0.1 - Float(p) * 0.015))
    }
    let G = MeshBakeArbeider.løsHus(deler)
    var verst: Float = 0, verstVinkel: Float = 0
    let c = MeshBakeArbeider.matrise(kf[0].transform).columns.3.xyz
    for p in 1..<4 {
        let feil = G[p] * D(p).inverse
        let q = simd_quatf(simd_float3x3(feil.columns.0.xyz, feil.columns.1.xyz, feil.columns.2.xyz))
        verst = max(verst, simd_distance((feil * SIMD4(c, 1)).xyz, c)); verstVinkel = max(verstVinkel, q.angle * 180 / .pi)
    }
    print(String(format: "poseløsning: drift opptil 1,2° / 45 mm i ring funnet igjen; verste feil %.3f° og %.1f mm ved kameraet", verstVinkel, verst * 1000))
    precondition(verstVinkel < 0.1 && verst < 0.006, "poseløsningen fant ikke driften")
    // Uten bånd står en del stille.
    let alene = MeshBakeArbeider.løsHus([deler[0], .init(id: 9, poser: [-1: matrix_identity_float4x4], gulv: nil)])
    precondition(simd_distance(alene[1].columns.3.xyz, .zero) < 1e-4, "del uten bånd ble flyttet")
}

// 5. Gulvhøyden og nettet til disk.
do {
    let g = MeshBakeArbeider.gulvhøyde(fx.mesh, kameraer: fx.keyframes)
    let ys = fx.keyframes.map { $0.transform[13] }.sorted()
    print(String(format: "gulv: %@ m (kameraenes median %.2f m)", g.map { String(format: "%.2f", $0) } ?? "ingen", ys[ys.count / 2]))
    precondition(g != nil, "fant ikke gulvet")
    let url = arbeid.appendingPathComponent("nett-test.bin")
    try! MeshBakeArbeider.skrivNett(fx.mesh, til: url)
    let m = MeshBakeArbeider.lesNett(url)!
    // bitmønstre: ARKit-normalene i fiksturen har NaN, og NaN != NaN
    precondition(m.positions.map(\.bitPattern) == fx.mesh.positions.map(\.bitPattern) && m.indices == fx.mesh.indices
                 && m.normals.map(\.bitPattern) == fx.mesh.normals.map(\.bitPattern)
                 && m.triAnchor == fx.mesh.triAnchor && m.planes == fx.mesh.planes && m.faceClass == fx.mesh.faceClass
                 && m.planeLock == fx.mesh.planeLock, "nettet ble ikke likt etter disk")
}
// 5. Lukkeveiledningen (M3.5, M4.1). Syntetisk: et 4 × 4 m rom med gulv, tak og tre vegger
//    (vestveggen mangler) gir en pil mot vest og ikke trapp; en trapp (trinn à 18 cm, 25 cm
//    dype, 1 m brede) med kameraet midt i gir trapp.
do {
    func flate(_ x0: Float, _ x1: Float, _ y0: Float, _ y1: Float, _ z0: Float, _ z1: Float, ny: Float, _ v: inout LukkeVurdering) {
        var x = x0
        while x <= x1 { var y = y0; while y <= y1 { var z = z0; while z <= z1 {
            v.legg(SIMD3(x, y, z), ny: ny); z += 0.05 }; y += 0.05 }; x += 0.05 }
    }
    let kam = SIMD3<Float>(0, 1.5, 0)
    var rom = LukkeVurdering(kamera: kam)
    flate(-2, 2, 0, 0, -2, 2, ny: 1, &rom)           // gulv
    flate(-2, 2, 2.4, 2.4, -2, 2, ny: -1, &rom)      // tak
    flate(2, 2, 0, 2.4, -2, 2, ny: 0, &rom)          // øst
    flate(-2, 2, 0, 2.4, -2, -2, ny: 0, &rom)        // nord
    flate(-2, 2, 0, 2.4, 2, 2, ny: 0, &rom)          // sør
    let r = rom.resultat()
    print(String(format: "lukkeveiledning, rom uten vestvegg: trapp=%@, %.1f m kant uten vegg, pil mot x=%.2f z=%.2f, %d gulvruter",
                 r.trapp ? "ja" : "nei", r.veggM, r.vegg?.x ?? .nan, r.vegg?.z ?? .nan, r.gulvRuter))
    precondition(!r.trapp, "rommet ble tatt for trapp")
    precondition(r.vegg != nil && r.vegg!.x < -1.5 && abs(r.vegg!.z) < 0.6, "pila peker ikke mot den manglende veggen")
    var helt = LukkeVurdering(kamera: kam)
    flate(-2, 2, 0, 0, -2, 2, ny: 1, &helt)
    flate(2, 2, 0, 2.4, -2, 2, ny: 0, &helt); flate(-2, -2, 0, 2.4, -2, 2, ny: 0, &helt)
    flate(-2, 2, 0, 2.4, -2, -2, ny: 0, &helt); flate(-2, 2, 0, 2.4, 2, 2, ny: 0, &helt)
    precondition(helt.resultat().vegg == nil && !helt.resultat().trapp, "helt rom ga veiledning")
    var trapp = LukkeVurdering(kamera: SIMD3(0, 2.4, 0))
    for i in 0..<16 { let y = Float(i) * 0.18, z = Float(i) * 0.25 - 2
        flate(-0.5, 0.5, y, y, z, z + 0.2, ny: 1, &trapp) }
    let t = trapp.resultat()
    print("lukkeveiledning, trapp: trapp=\(t.trapp ? "ja" : "nei"), \(t.gulvRuter) gulvruter på én høyde")
    precondition(t.trapp, "trappa ble ikke funnet")
    // Ekte skann (én etasje): hvor ofte ville et lukket delkart bedt om trapp eller vegg?
    var nTrapp = 0, nVegg = 0, n = 0
    let pos = fx.mesh.positions, nor = fx.mesh.normals
    for k in stride(from: 0, to: fx.keyframes.count, by: 10) where fx.keyframes[k].transform.count == 16 {
        let T = fx.keyframes[k].transform
        var v = LukkeVurdering(kamera: SIMD3(T[12], T[13], T[14]))
        for i in 0..<(pos.count / 3) where nor[i * 3 + 1].isFinite {
            v.legg(SIMD3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), ny: nor[i * 3 + 1])
        }
        let r = v.resultat()
        n += 1; if r.trapp { nTrapp += 1 } else if r.vegg != nil { nVegg += 1 }
    }
    print("lukkeveiledning på skannet: \(n) kameraer, \(nTrapp) ville sagt trapp, \(nVegg) ville pekt mot vegg")
}
// 6. Vegg mellom gulv og tak (M4.2). Et 4 × 4 × 2,4 m rom; østveggen mangler nederste 0,9 m
//    (sofa). Et klesskap (0–2,1 m) og et overskap (1,45–2,4 m) står som egne plan. Bare
//    sofahullet skal fylles.
do {
    var pos = [Float](), idx = [UInt32]()
    // Rektangel i et plan: origo o, akser a og b (lengder), 10 cm-ruter, normal a × b.
    func flak(_ o: SIMD3<Float>, _ a: SIMD3<Float>, _ b: SIMD3<Float>) {
        let na = Int((simd_length(a) / 0.1).rounded()), nb = Int((simd_length(b) / 0.1).rounded())
        let da = a / Float(na), db = b / Float(nb)
        for i in 0..<na { for j in 0..<nb {
            let q = UInt32(pos.count / 3)
            for (x, y) in [(0, 0), (1, 0), (1, 1), (0, 1)] {
                let r = o + da * Float(i + x) + db * Float(j + y)
                pos += [r.x, r.y, r.z]
            }
            idx += [q, q + 1, q + 2, q, q + 2, q + 3]
        } }
    }
    let X = SIMD3<Float>(1, 0, 0), Y = SIMD3<Float>(0, 1, 0), Z = SIMD3<Float>(0, 0, 1)
    flak(SIMD3(-2, 0, -2), Z * 4, X * 4)                 // gulv, normal +y
    flak(SIMD3(-2, 2.4, -2), X * 4, Z * 4)               // tak, normal −y
    flak(SIMD3(-2, 0, -2), Y * 2.4, Z * 4)               // vest x=−2, normal +x
    flak(SIMD3(2, 0.9, -2), Z * 4, Y * 1.5)              // øst x=2 fra 0,9 m, normal −x
    flak(SIMD3(-2, 0, -2), X * 4, Y * 2.4)               // nord z=−2, normal +z
    flak(SIMD3(-2, 0, 2), Y * 2.4, X * 4)                // sør z=2, normal −z
    flak(SIMD3(-1.8, 0, -1.2), Y * 2.1, Z * 2)           // klesskap x=−1,8, normal +x
    flak(SIMD3(-0.5, 1.5, -1.6), X * 2, Y * 0.9)         // overskap z=−1,6, normal +z
    let planer: [SIMD4<Float>] = [SIMD4(0, 1, 0, 0), SIMD4(0, -1, 0, -2.4), SIMD4(1, 0, 0, -2), SIMD4(-1, 0, 0, -2),
                                  SIMD4(0, 0, 1, -2), SIMD4(0, 0, -1, -2), SIMD4(1, 0, 0, -1.8), SIMD4(0, 0, 1, -1.6)]
    let før = idx.count
    let r = MeshVeggfyll.fyll(positions: &pos, indices: &idx, planes: planer)
    print(String(format: "veggfyll, syntetisk rom: %d plan, %d kolonner, %.2f m² (ventet 3,6 m² bak sofaen)", r.plan, r.kolonner, r.areal))
    precondition(r.plan == 1 && abs(r.areal - 3.6) < 0.25, "veggfyllingen traff feil")
    for t in (før / 3)..<(idx.count / 3) {
        let a = Int(idx[t * 3]) * 3, b = Int(idx[t * 3 + 1]) * 3, c = Int(idx[t * 3 + 2]) * 3
        let pa = SIMD3(pos[a], pos[a + 1], pos[a + 2]), pb = SIMD3(pos[b], pos[b + 1], pos[b + 2]), pc = SIMD3(pos[c], pos[c + 1], pos[c + 2])
        let n = simd_normalize(simd_cross(pb - pa, pc - pa))
        precondition(abs(pa.x - 2) < 1e-4 && pa.y < 0.95 && n.x < -0.99, "lapp utenfor østveggen eller vendt feil vei")
    }
    var p2 = fx.mesh.positions, i2 = fx.mesh.indices
    let r2 = MeshVeggfyll.fyll(positions: &p2, indices: &i2, planes: fx.mesh.planes)
    print(String(format: "veggfyll på ARKit-nettet: %d plan, %d kolonner, %.2f m²", r2.plan, r2.kolonner, r2.areal))
}
print("SUM \(sum)")
'''


def les_glb(p):
    d = Path(p).read_bytes()
    magic, ver, tot = struct.unpack_from('<III', d, 0)
    assert magic == 0x46546C67 and ver == 2 and tot == len(d), 'GLB-hode'
    jl, jt = struct.unpack_from('<II', d, 12)
    assert jt == 0x4E4F534A
    j = json.loads(d[20:20 + jl])
    bl, bt = struct.unpack_from('<II', d, 20 + jl)
    assert bt == 0x004E4942
    return j, d[28 + jl:28 + jl + bl]


def tris(j):
    return sum(j['accessors'][p['indices']]['count'] // 3 for m in j['meshes'] for p in m['primitives'])


def sjekk_glb(j, b):
    assert j['buffers'][0]['byteLength'] == len(b)
    for v in j['bufferViews']:
        assert v['byteOffset'] + v['byteLength'] <= len(b), 'visning utenfor bufferen'
    for a in j['accessors']:
        assert a['bufferView'] < len(j['bufferViews'])
    for i in j['images']:
        assert i['bufferView'] < len(j['bufferViews'])
        v = j['bufferViews'][i['bufferView']]
        assert b[v['byteOffset']:v['byteOffset'] + 2] == b'\xff\xd8', 'bildet peker ikke på en JPEG'
    for t in j['textures']:
        assert t['source'] < len(j['images']) and t['sampler'] < len(j['samplers'])
    for m in j['materials']:
        assert m['pbrMetallicRoughness']['baseColorTexture']['index'] < len(j['textures'])
    for m in j['meshes']:
        for p in m['primitives']:
            for a in list(p['attributes'].values()) + [p['indices']]:
                assert a < len(j['accessors'])
            assert p['material'] < len(j['materials'])
            n = j['accessors'][p['attributes']['POSITION']]['count']
            iv = j['bufferViews'][j['accessors'][p['indices']]['bufferView']]
            idx = struct.unpack_from('<%dI' % (iv['byteLength'] // 4), b, iv['byteOffset'])
            assert max(idx) < n, 'indeks utenfor aksessoren'


def les_relok(p):
    d = Path(p).read_bytes()
    assert d[:4] == b'RLK1'
    n = struct.unpack_from('<I', d, 4)[0]
    assert len(d) == 20 + n * 144
    return n, struct.unpack_from('<%dI' % n, d, 20)


def main():
    bundle, dk = Path(sys.argv[1]), Path(sys.argv[2])
    arbeid = Path(tempfile.mkdtemp(prefix='hus-'))
    for f in bundle.iterdir():
        if f.name in ('fixture-mesh.bin', 'fixture-kf.json', 'dense.jsonl') or \
           (f.suffix == '.f32' and (f.name.startswith('dense-') or f.name.startswith('depth-'))):
            os.symlink(f, arbeid / f.name)
    for n in sorted((dk / 'delkart').iterdir()):
        (arbeid / 'delkart' / n.name).mkdir(parents=True)
        for f in ('kart.json', 'blokker.bin'):
            os.symlink(n / f, arbeid / 'delkart' / n.name / f)
    src = arbeid / 'src'
    src.mkdir()
    (src / 'stubs.swift').write_text(stubs)
    (src / 'main.swift').write_text(MAIN)
    exe = arbeid / 'hus'
    subprocess.run(['xcrun', 'swiftc', '-O', '-o', str(exe), str(IOS / 'MeshBakeArbeider.swift'),
                    str(IOS / 'MeshDelkart.swift'), str(IOS / 'MeshVeggfyll.swift'), str(src / 'stubs.swift'), str(src / 'main.swift')], check=True)
    r = subprocess.run([str(exe), str(bundle), str(arbeid)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(r.stdout, end='')
    if r.returncode != 0:
        sys.exit('FEIL: testen stoppet')
    if 'ENGRUPPE' in r.stdout:
        print('ok')
        return
    total = int([l for l in r.stdout.splitlines() if l.startswith('SUM ')][-1].split()[1])

    hus = json.loads((arbeid / 'hus.json').read_text())
    deler = hus['deler']
    j, b = les_glb(arbeid / 'hus-test.glb')
    sjekk_glb(j, b)
    delsum, fliser = 0, 0
    for d in deler:
        dj, db = les_glb(arbeid / d['glb'])
        sjekk_glb(dj, db)
        delsum += tris(dj)
        fliser += len(dj['images'])
    assert tris(j) == delsum == total, f'sammenslått {tris(j)} trekanter, delene {delsum}, bakt {total}'
    assert len(j['images']) == fliser
    # Vieweren gir rommet du står i full tekstur ut fra extras.del (TeksturLod): hver primitiv
    # må bære delen sin, og del k må ha nøyaktig like mange primitiver som delens egen GLB.
    prims = [p for m in j['meshes'] for p in m['primitives']]
    assert all(isinstance(p.get('extras', {}).get('del'), int) for p in prims), 'primitiv uten extras.del'
    for k, d in enumerate(deler):
        dj, _ = les_glb(arbeid / d['glb'])
        egne = sum(len(m['primitives']) for m in dj['meshes'])
        assert sum(1 for p in prims if p['extras']['del'] == k) == egne, f'del {k}: feil antall primitiver'
    n, lab = les_relok(arbeid / 'hus-test.glb.relok')
    ventet = sum(les_relok(arbeid / d['relok'])[0] for d in deler)
    assert n == ventet, f'relok {n} punkter, ventet {ventet}'
    assert len(set(lab)) == n, 'samme relok-etikett fra to deler'
    print(f'GLB: {len(deler)} deler → {tris(j)} trekanter, {fliser} fliser, gyldig; relok {n} punkter, unike etiketter')
    print(f'hus.json: deler {[d["delkart"] for d in deler]}')
    print('ok')


if __name__ == '__main__':
    main()
