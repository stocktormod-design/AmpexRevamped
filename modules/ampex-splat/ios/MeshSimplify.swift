import Foundation
import simd

/// Kvadrikk-basert kant-kollaps (Garland–Heckbert QEM) FØR xatlas — Scaniverse-grepet:
/// flate områder kollapses hardt (plan-snappede vegger/tak er ~gratis i kvadrikkfeil),
/// kanter og hjørner bevares av feilmetrikken selv. Gevinst: xatlas-tiden (62 av 82 s på
/// scan #1) faller med triangeltallet, færre charts → færre sømmer, og vinnervalget får
/// færre flater å krangle om.
///
/// V1s decimering feilet på non-manifold sliver-topologi som hang xatlas (2026-07-06) —
/// forskjellen her er vaktene: ekte kant-kollaps (ikke verteksklynging) med link-test,
/// normal-flip-vern, degenerat-vern og grensekvadrikker som holder åpne kanter (hull,
/// skannegrensen) på plass.
@available(iOS 14.0, *)
enum MeshSimplify {

    /// Symmetrisk 4×4-kvadrikk lagret som 10 floats:
    /// [a², ab, ac, ad, b², bc, bd, c², cd, d²] for planet ax+by+cz+d=0.
    private struct Quadric {
        var m = (Float(0), Float(0), Float(0), Float(0), Float(0), Float(0), Float(0), Float(0), Float(0), Float(0))
        mutating func addPlane(_ n: SIMD3<Float>, _ d: Float, weight w: Float) {
            m.0 += n.x * n.x * w; m.1 += n.x * n.y * w; m.2 += n.x * n.z * w; m.3 += n.x * d * w
            m.4 += n.y * n.y * w; m.5 += n.y * n.z * w; m.6 += n.y * d * w
            m.7 += n.z * n.z * w; m.8 += n.z * d * w
            m.9 += d * d * w
        }
        mutating func add(_ o: Quadric) {
            m.0 += o.m.0; m.1 += o.m.1; m.2 += o.m.2; m.3 += o.m.3; m.4 += o.m.4
            m.5 += o.m.5; m.6 += o.m.6; m.7 += o.m.7; m.8 += o.m.8; m.9 += o.m.9
        }
        func error(_ p: SIMD3<Float>) -> Float {
            let x = p.x, y = p.y, z = p.z
            return m.0 * x * x + 2 * m.1 * x * y + 2 * m.2 * x * z + 2 * m.3 * x
                + m.4 * y * y + 2 * m.5 * y * z + 2 * m.6 * y
                + m.7 * z * z + 2 * m.8 * z
                + m.9
        }
    }

    private struct Candidate {
        var cost: Float
        var a: Int32, b: Int32          // welded verteks-id-er (kollaps b → a)
        var va: Int32, vb: Int32        // versjonsstempler ved innsetting (lazy invalidering)
        var pos: SIMD3<Float>
    }

    /// Minimal binærheap (min på cost).
    private struct Heap {
        var items: [Candidate] = []
        mutating func push(_ c: Candidate) {
            items.append(c)
            var i = items.count - 1
            while i > 0 {
                let p = (i - 1) / 2
                if items[p].cost <= items[i].cost { break }
                items.swapAt(p, i); i = p
            }
        }
        mutating func pop() -> Candidate? {
            guard let top = items.first else { return nil }
            let last = items.removeLast()
            if !items.isEmpty {
                items[0] = last
                var i = 0
                while true {
                    let l = i * 2 + 1, r = i * 2 + 2
                    var s = i
                    if l < items.count && items[l].cost < items[s].cost { s = l }
                    if r < items.count && items[r].cost < items[s].cost { s = r }
                    if s == i { break }
                    items.swapAt(i, s); i = s
                }
            }
            return top
        }
    }

    /// Forenkler meshen in place ned mot `targetTris`, men aldri forbi `errorLimit`
    /// (sum kvadrert avstand, m² — kvalitetstaket som freder kanter/detaljer).
    /// positions/normals/indices/triAnchor/faceClass holdes konsistente; planes urørt.
    static func simplify(mesh: inout MeshBakeV2.MergedMesh, targetTris: Int, errorLimit: Float) {
        let t0 = CFAbsoluteTimeGetCurrent()
        let srcTriCount = mesh.indices.count / 3
        guard srcTriCount > targetTris, srcTriCount > 0 else { return }

        // ── 1) Sveis (1 mm): anchors deler ikke vertekser — QEM trenger ekte konnektivitet.
        // xatlas welder uansett internt, så sveiset utdata er trygt (og bedre for chart-vekst).
        let srcVC = mesh.positions.count / 3
        var weldOf = [Int32](repeating: -1, count: srcVC)
        var weldMap = [Int64: Int32](minimumCapacity: srcVC)
        var pos: [SIMD3<Float>] = []
        pos.reserveCapacity(srcVC / 2)
        for i in 0..<srcVC {
            let p = SIMD3(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2])
            let qx: Int64 = Int64((p.x * 1000).rounded()) & 0x1FFFFF
            let qy: Int64 = Int64((p.y * 1000).rounded()) & 0x1FFFFF
            let qz: Int64 = Int64((p.z * 1000).rounded()) & 0x1FFFFF
            let key: Int64 = qx | (qy << 21) | (qz << 42)
            if let w = weldMap[key] { weldOf[i] = w } else {
                let w = Int32(pos.count)
                weldMap[key] = w; weldOf[i] = w
                pos.append(p)
            }
        }
        let vc = pos.count

        var faces: [SIMD3<Int32>] = []     // welded ids
        var triAnchor: [UInt32] = []
        var faceClass: [UInt8] = []
        faces.reserveCapacity(srcTriCount)
        let hasAnchor = mesh.triAnchor.count == srcTriCount
        let hasClass = mesh.faceClass.count == srcTriCount
        for t in 0..<srcTriCount {
            let a = weldOf[Int(mesh.indices[t * 3])], b = weldOf[Int(mesh.indices[t * 3 + 1])], c = weldOf[Int(mesh.indices[t * 3 + 2])]
            if a == b || b == c || c == a { continue }
            faces.append(SIMD3(a, b, c))
            triAnchor.append(hasAnchor ? mesh.triAnchor[t] : 0)
            faceClass.append(hasClass ? mesh.faceClass[t] : 0)
        }
        var faceAlive = [Bool](repeating: true, count: faces.count)
        var aliveTris = faces.count

        // ── 2) Kvadrikker (areal-vektet) + verteks→face-adjasens + grensekanter.
        var quadrics = [Quadric](repeating: Quadric(), count: vc)
        var vFaces = [[Int32]](repeating: [], count: vc)
        var edgeFaceCount = [Int64: Int32](minimumCapacity: faces.count * 2)
        @inline(__always) func edgeKey(_ x: Int32, _ y: Int32) -> Int64 {
            (Int64(min(x, y)) << 32) | Int64(max(x, y))
        }
        for (fi, f) in faces.enumerated() {
            let p0 = pos[Int(f.x)], p1 = pos[Int(f.y)], p2 = pos[Int(f.z)]
            let cr = simd_cross(p1 - p0, p2 - p0)
            let area2 = simd_length(cr)
            guard area2 > 1e-12 else { faceAlive[fi] = false; aliveTris -= 1; continue }
            let n = cr / area2
            let d = -simd_dot(n, p0)
            var q = Quadric()
            q.addPlane(n, d, weight: area2 / 2)
            for vi in [f.x, f.y, f.z] {
                quadrics[Int(vi)].add(q)
                vFaces[Int(vi)].append(Int32(fi))
            }
            edgeFaceCount[edgeKey(f.x, f.y), default: 0] += 1
            edgeFaceCount[edgeKey(f.y, f.z), default: 0] += 1
            edgeFaceCount[edgeKey(f.z, f.x), default: 0] += 1
        }
        // Grensekvadrikker: åpne kanter (hull, skannegrense) får et sterkt «bli der»-plan
        // vinkelrett på flaten gjennom kanten — grensen kan kollapses LANGS seg selv,
        // men ikke trekkes innover.
        for (fi, f) in faces.enumerated() where faceAlive[fi] {
            let p0 = pos[Int(f.x)], p1 = pos[Int(f.y)], p2 = pos[Int(f.z)]
            let fn = simd_normalize(simd_cross(p1 - p0, p2 - p0))
            for (a, b) in [(f.x, f.y), (f.y, f.z), (f.z, f.x)] where edgeFaceCount[edgeKey(a, b)] == 1 {
                let pa = pos[Int(a)], pb = pos[Int(b)]
                let e = pb - pa
                let el = simd_length(e)
                guard el > 1e-6 else { continue }
                let bn = simd_normalize(simd_cross(e / el, fn))
                let bd = -simd_dot(bn, pa)
                var q = Quadric()
                q.addPlane(bn, bd, weight: el * el * 8) // hard straff for å forlate grenselinja
                quadrics[Int(a)].add(q)
                quadrics[Int(b)].add(q)
            }
        }

        // ── 3) Kandidat-heap med lazy invalidering (versjonsstempel per verteks).
        var version = [Int32](repeating: 0, count: vc)
        var heap = Heap()
        heap.items.reserveCapacity(faces.count * 2)
        @inline(__always) func bestCollapse(_ a: Int32, _ b: Int32) -> (Float, SIMD3<Float>) {
            var q = quadrics[Int(a)]
            q.add(quadrics[Int(b)])
            let pa = pos[Int(a)], pb = pos[Int(b)], pm = (pa + pb) / 2
            let ea = q.error(pa), eb = q.error(pb), em = q.error(pm)
            if em <= ea && em <= eb { return (em, pm) }
            return ea <= eb ? (ea, pa) : (eb, pb)
        }
        func pushEdge(_ a: Int32, _ b: Int32) {
            let (cost, p) = bestCollapse(a, b)
            heap.push(Candidate(cost: max(cost, 0), a: a, b: b, va: version[Int(a)], vb: version[Int(b)], pos: p))
        }
        var seeded = Set<Int64>(minimumCapacity: faces.count * 2)
        for (fi, f) in faces.enumerated() where faceAlive[fi] {
            for (a, b) in [(f.x, f.y), (f.y, f.z), (f.z, f.x)] where seeded.insert(edgeKey(a, b)).inserted {
                pushEdge(a, b)
            }
        }

        // ── 4) Kollaps-løkke med topologi-vakter.
        var vAlive = [Bool](repeating: true, count: vc)
        var collapsed = 0
        var neighborScratch = Set<Int32>(minimumCapacity: 32)
        while aliveTris > targetTris, let c = heap.pop() {
            if c.cost > errorLimit { break }
            let a = Int(c.a), b = Int(c.b)
            guard vAlive[a], vAlive[b], version[a] == c.va, version[b] == c.vb else { continue }

            // Link-test (light): a og b får dele maks 2 naboverter (kantens to «vinger») —
            // flere betyr at kollapsen ville limt flak sammen non-manifold (V1-fellen).
            neighborScratch.removeAll(keepingCapacity: true)
            for fi in vFaces[a] where faceAlive[Int(fi)] {
                let f = faces[Int(fi)]
                if f.x != c.a { neighborScratch.insert(f.x) }
                if f.y != c.a { neighborScratch.insert(f.y) }
                if f.z != c.a { neighborScratch.insert(f.z) }
            }
            var shared = 0
            var sharedFaces = 0
            for fi in vFaces[b] where faceAlive[Int(fi)] {
                let f = faces[Int(fi)]
                if f.x == c.a || f.y == c.a || f.z == c.a { sharedFaces += 1; continue }
            }
            if sharedFaces > 2 { continue } // ikke-manifold vifte rundt kanten
            for fi in vFaces[b] where faceAlive[Int(fi)] {
                let f = faces[Int(fi)]
                for v in [f.x, f.y, f.z] where v != c.b && neighborScratch.contains(v) {
                    shared += 1
                }
            }
            // shared teller face-hjørner (opptil 2 per delt nabo) — grensen 4 ≈ 2 naboverter
            if shared > 4 { continue }

            // Flip-/degenerat-vern: alle overlevende faces rundt a og b må beholde retning og areal.
            var ok = true
            for src in [a, b] where ok {
                for fi in vFaces[src] where faceAlive[Int(fi)] {
                    let f = faces[Int(fi)]
                    if (f.x == c.a || f.y == c.a || f.z == c.a) && (f.x == c.b || f.y == c.b || f.z == c.b) { continue } // dør
                    var p0 = pos[Int(f.x)], p1 = pos[Int(f.y)], p2 = pos[Int(f.z)]
                    let oldN = simd_cross(p1 - p0, p2 - p0)
                    if f.x == c.a || f.x == c.b { p0 = c.pos }
                    if f.y == c.a || f.y == c.b { p1 = c.pos }
                    if f.z == c.a || f.z == c.b { p2 = c.pos }
                    let newN = simd_cross(p1 - p0, p2 - p0)
                    let newL = simd_length(newN)
                    if newL < 1e-10 || simd_dot(simd_normalize(oldN), newN / newL) < 0.2 { ok = false; break }
                }
            }
            if !ok { continue }

            // Utfør: b → a på c.pos.
            pos[a] = c.pos
            quadrics[a].add(quadrics[b])
            vAlive[b] = false
            version[a] += 1
            for fi in vFaces[b] where faceAlive[Int(fi)] {
                var f = faces[Int(fi)]
                if (f.x == c.a || f.y == c.a || f.z == c.a) {
                    faceAlive[Int(fi)] = false
                    aliveTris -= 1
                    continue
                }
                if f.x == c.b { f.x = c.a }
                if f.y == c.b { f.y = c.a }
                if f.z == c.b { f.z = c.a }
                faces[Int(fi)] = f
                vFaces[a].append(fi)
            }
            vFaces[b].removeAll(keepingCapacity: false)
            collapsed += 1
            // Nye kandidater rundt a (naboene har nytt kostnadsbilde).
            neighborScratch.removeAll(keepingCapacity: true)
            for fi in vFaces[a] where faceAlive[Int(fi)] {
                let f = faces[Int(fi)]
                if f.x != c.a { neighborScratch.insert(f.x) }
                if f.y != c.a { neighborScratch.insert(f.y) }
                if f.z != c.a { neighborScratch.insert(f.z) }
            }
            for nb in neighborScratch where vAlive[Int(nb)] { pushEdge(c.a, nb) }
        }

        // ── 5) Kompakter tilbake til MergedMesh-layout.
        var newIdxOf = [Int32](repeating: -1, count: vc)
        var outPos: [Float] = []
        var outIdx: [UInt32] = []
        var outAnchor: [UInt32] = []
        var outClass: [UInt8] = []
        outIdx.reserveCapacity(aliveTris * 3)
        // Duplikat-vern i samme pass (xatlas kveles av dem): to faces som endte på samme
        // verteks-trippel etter kollaps — behold første. Nøkkel er sortert trippel.
        var seenFace = Set<Int64>(minimumCapacity: aliveTris)
        for (fi, f) in faces.enumerated() where faceAlive[fi] {
            if f.x == f.y || f.y == f.z || f.z == f.x { continue }
            let lo = min(f.x, min(f.y, f.z)), hi = max(f.x, max(f.y, f.z))
            let mid = f.x &+ f.y &+ f.z &- lo &- hi
            let fkey = (Int64(lo) << 42) | (Int64(mid) << 21) | Int64(hi)
            guard seenFace.insert(fkey).inserted else { continue }
            var ids = [UInt32](repeating: 0, count: 3)
            for (slot, v) in [f.x, f.y, f.z].enumerated() {
                if newIdxOf[Int(v)] < 0 {
                    newIdxOf[Int(v)] = Int32(outPos.count / 3)
                    outPos.append(pos[Int(v)].x); outPos.append(pos[Int(v)].y); outPos.append(pos[Int(v)].z)
                }
                ids[slot] = UInt32(newIdxOf[Int(v)])
            }
            outIdx.append(ids[0]); outIdx.append(ids[1]); outIdx.append(ids[2])
            outAnchor.append(triAnchor[fi])
            outClass.append(faceClass[fi])
        }
        guard outIdx.count >= 3 else { return } // aldri returner tom mesh — behold original

        mesh.positions = outPos
        mesh.indices = outIdx
        mesh.triAnchor = outAnchor
        mesh.faceClass = outClass
        mesh.normals = ARMeshGlbExporter.recomputeNormals(positions: mesh.positions, indices: mesh.indices)
        MeshLog.log(String(format: "forenkling — %d → %d tris (%d kollaps, %.1f:1) på %dms",
                           srcTriCount, mesh.indices.count / 3, collapsed,
                           Float(srcTriCount) / Float(max(mesh.indices.count / 3, 1)),
                           Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)))
    }
}
