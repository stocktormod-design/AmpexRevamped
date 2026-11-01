import Foundation
import ARKit
import Metal
import SceneKit
import simd

/**
 SLØRET (2026-09-06, Tormod: «ALT på hele skjermen skal starte rødstripet … du maler
 altså rommet/meshen og ser preview»).

 Et heldekkende rødstripet lag rett foran kameraet. For hver piksel slår vi opp LiDAR-
 dybden, regner verdenspunktet og spør dekningsfeltet (CoverageField) om flaten er
 fanget. Er den det, forsvinner sløret i den pikselen — og den malte meshen under
 kommer til syne. Alt annet blir stående rødt, så det som mangler er selvforklarende.

 Dette er forskjellen fra forrige forsøk: stripene lå PÅ ARKit-meshen, så et område
 uten mesh ennå fikk ingen striper. Sløret bryr seg ikke om mesh — det dekker alt.
 */
final class CoverageVeil {
    /// Avstanden planet henger i foran kameraet. Bare et lerret som dekker hele viewet.
    static let dist: Float = 1.0
    let node = SCNNode()
    private let material = SCNMaterial()
    private(set) var klar = false

    /// 2026-09-07: sløret er BAKGRUNNEN (renderingOrder lavest, ingen dybde). Meshen
    /// tegnes oppå og velger selv striper eller farge per piksel via dekningsfeltet.
    /// Før lå sløret ØVERST og slapp kamerabildet gjennom der feltet var fanget — men
    /// ARKit-meshen henger 1–8 s etter feltet, så brukeren så rått kamera før meshen
    /// kom («hvorfor vises noe som helt vanlig kamera så blir det mesh etterpå?»).
    ///
    /// `bak` (DELKART, 2026-10-27): meshen er nå GJENNOMSIKTIG der flaten er dekket, så sløret
    /// kan ikke ligge under den — det ville skint gjennom. Det henger i stedet langt bak (30 m)
    /// og tegnes SIST med dybdetest: der det finnes mesh vinner meshens dybde, og bare
    /// piksler uten mesh blir stripete. Samme løfte som før — kamerabildet vises aldri før
    /// flaten er fanget — men en ferdig flate viser det skarpe kamerabildet.
    init?(library: MTLLibrary?, felt: CoverageField?, bak: Bool = false) {
        guard let lib = library else { return nil }
        let plan = SCNPlane(width: 2, height: 2)
        let program = SCNProgram()
        program.library = lib
        program.vertexFunctionName = "veilVert"
        program.fragmentFunctionName = "veilFrag"
        program.isOpaque = true
        material.program = program
        material.isDoubleSided = true
        material.writesToDepthBuffer = false
        material.readsFromDepthBuffer = false
        plan.firstMaterial = material
        node.geometry = plan
        node.position = SCNVector3(0, 0, -CoverageVeil.dist)
        // Halvutstrekning 12 m på 1 m avstand = ±85° — dekker hele viewet uansett
        // orientering/linse. Dybdetest er av, så størrelsen koster ingenting.
        node.scale = SCNVector3(12, 12, 1)
        node.renderingOrder = -10_000       // først av alt — alt annet legger seg oppå
        if bak {
            let d: Float = 30
            node.position = SCNVector3(0, 0, -d)
            node.scale = SCNVector3(12 * d, 12 * d, 1)
            material.readsFromDepthBuffer = true
            node.renderingOrder = 10_000    // sist: meshens dybde må ligge der først
        }
        node.castsShadow = false
        klar = true
    }

    /// Beholdt for kallstedet i presenteren; sløret trenger ikke lenger per-ramme-data.
    func oppdater(frame: ARFrame, felt: CoverageField?, viewport: CGSize, orientering: UIInterfaceOrientation) {}
}
