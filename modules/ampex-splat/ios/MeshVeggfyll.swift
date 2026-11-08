import Foundation
import simd

/// VEGG MELLOM GULV OG TAK (M4.2, 2026-10-28). `fillPlanarHoles` fyller bare lukkede hull
/// inne i et plan. Bak en sofa eller en seng så LiDAR aldri nederste del av veggen, og hullet
/// er åpent mot gulvet, så det blir aldri en lukket løkke og aldri fylt; fra rommet ved siden
/// av ser man gjennom veggen. Her fylles et dominerende loddrett plan mellom gulv og tak,
/// kolonne for kolonne (5 cm), når:
///
/// - kolonnen har flate over minst 40 % av høyden mellom gulv og tak,
/// - de øverste 30 cm har flate (veggen møter taket; et klesskap eller en reol gjør det ikke),
/// - hullet er høyst 1,2 m høyt (et overskap har 1,4 m tomt under seg og fylles ikke ned
///   til gulvet; en dør er 2 m og når aldri 40 % uansett),
/// - det finnes gulv og tak foran planet (innen 60 cm, på romsiden) ved kolonnen.
///
/// Lappene ligger på planet og bakes projektivt som resten av veggen. De henger ikke sammen
/// med nabotrekantene (cm-glipper), samme som `fillPlanarHoles`.
enum MeshVeggfyll {
    static let celle: Float = 0.05

    struct Resultat { var plan = 0, kolonner = 0, areal: Float = 0 }

    static func fyll(positions: inout [Float], indices: inout [UInt32], planes: [SIMD4<Float>]) -> Resultat {
        var res = Resultat()
        let nT = indices.count / 3
        guard nT > 0, !planes.isEmpty else { return res }
        func p(_ v: UInt32) -> SIMD3<Float> {
            let i = Int(v) * 3
            return SIMD3(positions[i], positions[i + 1], positions[i + 2])
        }
        // Trekantene per plan (sentroide innen 3 cm, normal innen ~25°), med normalens fortegn.
        var tilPlan = [[Int]](repeating: [], count: planes.count)
        var fortegn = [Float](repeating: 0, count: planes.count)
        var areal = [Float](repeating: 0, count: planes.count)
        var sentroider = [SIMD3<Float>](repeating: .zero, count: nT)
        var normaler = [SIMD3<Float>](repeating: .zero, count: nT)
        for t in 0..<nT {
            let a = p(indices[t * 3]), b = p(indices[t * 3 + 1]), c = p(indices[t * 3 + 2])
            let cr = simd_cross(b - a, c - a)
            let l = simd_length(cr)
            guard l > 1e-12 else { continue }
            let n = cr / l, m = (a + b + c) / 3
            sentroider[t] = m; normaler[t] = n
            for (j, pl) in planes.enumerated() {
                let pn = SIMD3(pl.x, pl.y, pl.z)
                let d = simd_dot(n, pn)
                guard abs(d) > 0.9, abs(simd_dot(pn, m) - pl.w) < 0.03 else { continue }
                tilPlan[j].append(t)
                fortegn[j] += d * l
                areal[j] += l * 0.5
                break
            }
        }
        // Gulv og tak: største vannrette plan med flate som peker opp, og ned.
        var gulv: (j: Int, h: Float)? = nil, tak: (j: Int, h: Float)? = nil
        for (j, pl) in planes.enumerated() where abs(pl.y) > 0.95 && areal[j] > 1 {
            let h = pl.w / pl.y
            let opp = fortegn[j] * pl.y > 0
            if opp, gulv.map({ areal[j] > areal[$0.j] }) ?? true { gulv = (j, h) }
            if !opp, tak.map({ areal[j] > areal[$0.j] }) ?? true { tak = (j, h) }
        }
        guard let g = gulv, let k = tak, k.h - g.h > 1.8, k.h - g.h < 4 else { return res }
        // Gulv og tak som 10 cm-ruter i xz, til «finnes det gulv og tak foran planet».
        func rute(_ x: Float, _ z: Float) -> Int64 {
            (Int64((x * 10).rounded(.down)) & 0xFFFFFFFF) | (Int64((z * 10).rounded(.down)) << 32)
        }
        var gulvRuter = Set<Int64>(), takRuter = Set<Int64>()
        for t in tilPlan[g.j] { gulvRuter.insert(rute(sentroider[t].x, sentroider[t].z)) }
        for t in tilPlan[k.j] { takRuter.insert(rute(sentroider[t].x, sentroider[t].z)) }
        func foran(_ q: SIMD3<Float>, _ inn: SIMD3<Float>, _ ruter: Set<Int64>) -> Bool {
            var s: Float = 0.05
            while s <= 0.6 {
                let r = q + inn * s
                if ruter.contains(rute(r.x, r.z)) { return true }
                s += 0.05
            }
            return false
        }

        let høyde = k.h - g.h
        let nV = Int((høyde / celle).rounded(.down))
        let topp = Int((0.30 / celle).rounded())
        let maksHull = Int((1.2 / celle).rounded())
        for (j, pl) in planes.enumerated() where abs(pl.y) < 0.1 && areal[j] > 1 {
            var n = simd_normalize(SIMD3(pl.x, 0, pl.z))
            let w = pl.w / simd_length(SIMD3(pl.x, pl.y, pl.z))
            // Romsiden: den flaten faktisk peker mot.
            let inn: SIMD3<Float> = fortegn[j] >= 0 ? n : -n
            n = SIMD3(pl.x, pl.y, pl.z) / simd_length(SIMD3(pl.x, pl.y, pl.z))
            let u = simd_normalize(simd_cross(SIMD3<Float>(0, 1, 0), n))
            let o = n * w            // et punkt på planet
            var uMin = Float.greatestFiniteMagnitude, uMax = -Float.greatestFiniteMagnitude
            for t in tilPlan[j] { let s = simd_dot(sentroider[t] - o, u); uMin = min(uMin, s); uMax = max(uMax, s) }
            guard uMax > uMin else { continue }
            let nU = Int(((uMax - uMin) / celle).rounded(.up)) + 1
            guard nU < 4000 else { continue }
            var dekket = [Bool](repeating: false, count: nU * nV)
            func merk(_ q: SIMD3<Float>) {
                let iu = Int(((simd_dot(q - o, u) - uMin) / celle).rounded(.down))
                let iv = Int(((q.y - g.h) / celle).rounded(.down))
                if iu >= 0 && iu < nU && iv >= 0 && iv < nV { dekket[iv * nU + iu] = true }
            }
            // Hele trekanten merkes (punkter med høyst en halv celle mellom), ikke bare hjørnene:
            // en ARKit-trekant kan være større enn ruta.
            for t in tilPlan[j] {
                let a = p(indices[t * 3]), b = p(indices[t * 3 + 1]), c = p(indices[t * 3 + 2])
                let l = max(simd_length(b - a), simd_length(c - a), simd_length(c - b))
                let s = max(1, Int((l / (celle * 0.5)).rounded(.up)))
                for i in 0...s { for k in 0...(s - i) {
                    merk(a + (b - a) * (Float(i) / Float(s)) + (c - a) * (Float(k) / Float(s)))
                } }
            }
            var fylteHer = 0
            for iu in 0..<nU {
                var sum = 0
                for iv in 0..<nV where dekket[iv * nU + iu] { sum += 1 }
                guard sum * 10 >= nV * 4 else { continue }
                var toppen = false
                for iv in (nV - topp)..<nV where dekket[iv * nU + iu] { toppen = true; break }
                guard toppen else { continue }
                let su = uMin + (Float(iu) + 0.5) * celle
                let midt = o + u * su
                guard foran(SIMD3(midt.x, g.h, midt.z), inn, gulvRuter),
                      foran(SIMD3(midt.x, k.h, midt.z), inn, takRuter) else { continue }
                // Tomme løp i kolonnen, høyst 1,2 m, fylles som én lapp hver.
                var iv = 0
                var fyltKolonne = false
                while iv < nV {
                    guard !dekket[iv * nU + iu] else { iv += 1; continue }
                    var e = iv
                    while e < nV && !dekket[e * nU + iu] { e += 1 }
                    if e - iv <= maksHull {
                        let u0 = uMin + Float(iu) * celle, u1 = u0 + celle
                        let y0 = g.h + Float(iv) * celle, y1 = g.h + Float(e) * celle
                        let b = UInt32(positions.count / 3)
                        for (uu, yy) in [(u0, y0), (u1, y0), (u1, y1), (u0, y1)] {
                            let q = o + u * uu
                            positions += [q.x, yy, q.z]
                        }
                        // Vinding: normalen (u × y) skal peke mot romsiden.
                        if simd_dot(simd_cross(u, SIMD3<Float>(0, 1, 0)), inn) > 0 {
                            indices += [b, b + 1, b + 2, b, b + 2, b + 3]
                        } else {
                            indices += [b, b + 2, b + 1, b, b + 3, b + 2]
                        }
                        res.areal += (y1 - y0) * celle
                        fyltKolonne = true
                    }
                    iv = e
                }
                if fyltKolonne { res.kolonner += 1; fylteHer += 1 }
            }
            if fylteHer > 0 { res.plan += 1 }
        }
        return res
    }
}
