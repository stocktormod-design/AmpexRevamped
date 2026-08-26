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
      let cap = CGFloat(min(max(maxPx, 256), 4096)) // RAM-vern — 4 ruter à 4096² er taket
      let scale = cap / max(box.width, box.height)
      let w = max(Int(box.width * scale), 1), h = max(Int(box.height * scale), 1)

      let mtime = ((try? FileManager.default.attributesOfItem(atPath: pdfPath))?[.modificationDate] as? Date)?
        .timeIntervalSince1970 ?? 0
      let digest = SHA256.hash(data: Data("\(pdfPath)|\(page)|\(w)x\(h)|\(Int(mtime))".utf8))
      let key = digest.prefix(12).map { String(format: "%02x", $0) }.joined()
      let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("pdfpage-\(key).jpg")
      if !FileManager.default.fileExists(atPath: out.path) {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
        let img = renderer.image { ctx in
          UIColor.white.setFill()
          ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
          ctx.cgContext.translateBy(x: 0, y: CGFloat(h))
          ctx.cgContext.scaleBy(x: scale, y: -scale)
          ctx.cgContext.translateBy(x: -box.minX, y: -box.minY)
          p.draw(with: .cropBox, to: ctx.cgContext)
        }
        guard let jpg = img.jpegData(compressionQuality: 0.85) else {
          throw Exception(name: "pdf", description: "JPEG-koding feilet")
        }
        try jpg.write(to: out, options: .atomic)
      }
      return ["uri": out.path, "width": w, "height": h, "pageCount": doc.pageCount]
    }
  }
}
