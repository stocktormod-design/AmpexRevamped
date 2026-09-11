import ExpoModulesCore
import PDFKit
import CryptoKit

/// Rasterér én PDF-side til JPEG (caches-mappa) for DrawingPane: multiview eier
/// pan/zoom-transformen selv (Reanimated) og tegner siden som bilde i Skia — å
/// montere 4 react-native-pdf-instanser er en kjent minne-/ytelsesfelle, og
/// transformen deres kan ikke leses pålitelig (docs/TEGNING_MULTIVIEW_PLAN.md).
/// Cache-nøkkel inkluderer filens mtime så en re-lastet tegning ikke serveres gammel.
public final class AmpexPdfModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AmpexPdf")

    AsyncFunction("renderPage") { (pdfPath: String, page: Int, maxPx: Int) -> [String: Any] in
      let url = URL(fileURLWithPath: pdfPath)
      guard let doc = PDFDocument(url: url) else {
        throw Exception(name: "pdf", description: "Kunne ikke åpne PDF: \(pdfPath)")
      }
      guard let p = doc.page(at: max(0, min(page, doc.pageCount - 1))) else {
        throw Exception(name: "pdf", description: "Side \(page) finnes ikke (\(doc.pageCount) sider)")
      }
      let box = p.bounds(for: .cropBox)
      guard box.width > 1, box.height > 1 else {
        throw Exception(name: "pdf", description: "Tom PDF-side")
      }
      // /Rotate (2026-09-06): tegninger lagres ofte som stående ark med rotasjon 90 —
      // boksen er 2299×3969 mens INNHOLDET vises 3969×2299. Før ble det rotererte
      // innholdet tegnet inn i den uroterte boksen, og høyre ~40 % falt utenfor
      // («hele pdfen rastirizes ikke» — Tormod). CGPDFPage sin tegnetransform tar
      // rotasjonen med, så lerretet får sidens VISTE mål.
      let snudd = (p.rotation % 180) != 0
      let pw = snudd ? box.height : box.width, ph = snudd ? box.width : box.height
      let cap = CGFloat(min(max(maxPx, 256), 4096)) // RAM-vern — 4 ruter à 4096² er taket
      let scale = cap / max(pw, ph)
      let w = max(Int(pw * scale), 1), h = max(Int(ph * scale), 1)

      let mtime = ((try? FileManager.default.attributesOfItem(atPath: pdfPath))?[.modificationDate] as? Date)?
        .timeIntervalSince1970 ?? 0
      let digest = SHA256.hash(data: Data("v2|\(pdfPath)|\(page)|\(w)x\(h)|\(Int(mtime))".utf8))
      let key = digest.prefix(12).map { String(format: "%02x", $0) }.joined()
      let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("pdfpage-\(key).jpg")
      if !FileManager.default.fileExists(atPath: out.path) {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
        let img = renderer.image { ctx in
          UIColor.white.setFill()
          ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
          let cg = ctx.cgContext
          cg.translateBy(x: 0, y: CGFloat(h))
          cg.scaleBy(x: 1, y: -1)
          if let ref = p.pageRef {
            let t = ref.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: w, height: h), rotate: 0, preserveAspectRatio: true)
            cg.concatenate(t)
            cg.interpolationQuality = .high
            cg.drawPDFPage(ref)
          } else {
            cg.scaleBy(x: scale, y: scale)
            cg.translateBy(x: -box.minX, y: -box.minY)
            p.draw(with: .cropBox, to: cg)
          }
        }
        guard let jpg = img.jpegData(compressionQuality: 0.85) else {
          throw Exception(name: "pdf", description: "JPEG-koding feilet")
        }
        try jpg.write(to: out, options: .atomic)
      }
      // Sidestørrelsen i PUNKT følger med: målverktøyet regner meter av den
      // (1 pt = 0,352778 mm papir × målestokk).
      return ["uri": out.path, "width": w, "height": h, "pageCount": doc.pageCount,
              "widthPt": Double(pw), "heightPt": Double(ph)]
    }
  }
}
