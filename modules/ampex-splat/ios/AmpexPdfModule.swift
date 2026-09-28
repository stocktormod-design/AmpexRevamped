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
      let digest = SHA256.hash(data: Data("v5|\(pdfPath)|\(page)|\(w)x\(h)|\(Int(mtime))".utf8))
      let key = digest.prefix(12).map { String(format: "%02x", $0) }.joined()
      let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("pdfpage-\(key).jpg")
      if !FileManager.default.fileExists(atPath: out.path) {
        // Ren CoreGraphics-bitmap, ikke UIGraphicsImageRenderer: UIKit-rendereren tegnet
        // siden for liten midt i bildet ved 3072 og 4096 (bare 2048 fylte bildet), og
        // brukte skjermens 3× så et «4096»-raster ble 12 288 px (2026-09-13). Her er
        // bildet nøyaktig w × h og siden fyller det.
        guard let cg = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                 space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else {
          throw Exception(name: "pdf", description: "Kunne ikke lage bitmap \(w)×\(h)")
        }
        cg.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        cg.fill(CGRect(x: 0, y: 0, width: w, height: h))
        // CGBitmapContext har origo nede til venstre, som PDF-en — ingen speiling.
        // getDrawingTransform skalerer ALDRI opp (dokumentert): med et raster større enn
        // sidens punktmål (2 384 pt) ble siden tegnet 1:1 midt i bildet med hvite kanter,
        // og alt oppå traff feil ved zoom (2026-09-13). Derfor: skaler konteksten selv,
        // og la transformen bare ta rotasjon og origo, med rect = boksens egne mål.
        if let ref = p.pageRef {
          cg.scaleBy(x: scale, y: scale)
          let t = ref.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: pw, height: ph), rotate: 0, preserveAspectRatio: true)
          cg.concatenate(t)
          cg.interpolationQuality = .high
          cg.drawPDFPage(ref)
        } else {
          cg.scaleBy(x: scale, y: scale)
          cg.translateBy(x: -box.minX, y: -box.minY)
          p.draw(with: .cropBox, to: cg)
        }
        guard let bilde = cg.makeImage(), let jpg = UIImage(cgImage: bilde).jpegData(compressionQuality: 0.85) else {
          throw Exception(name: "pdf", description: "JPEG-koding feilet")
        }
        try jpg.write(to: out, options: .atomic)
      }
      // Sidestørrelsen i PUNKT følger med: målverktøyet regner meter av den
      // (1 pt = 0,352778 mm papir × målestokk).
      return ["uri": out.path, "width": w, "height": h, "pageCount": doc.pageCount,
              "widthPt": Double(pw), "heightPt": Double(ph)]
    }

    /// Strekene og teksten på én side, rett fra innholdsstrømmen (CGPDFScanner).
    /// Grunnlaget for symbolsøket (lib/symbol-detekt.ts): pdf.js på Hermes hang
    /// på en A0-brannplan med 19 000 streker (2026-09-13), og bytene måtte
    /// dessuten gjennom base64. Her går det på under et sekund, og form-XObjects
    /// (som CAD-eksporter er fulle av) følges rekursivt.
    ///
    /// Koordinater: punkt, origo øverst til venstre, sidens VISTE mål (rotasjon
    /// medregnet) — samme rom som rasteret fra `renderPage`.
    /// `seg` er flat: [x0, y0, x1, y1, bredde, fyll(0/1), gråtone 0–1, metning 0–1] per strek.
    /// 0 nominal, 1 fair, 2 serious, 3 critical (ProcessInfo.thermalState). Tunge
    /// jobber (analysen ved opplasting) venter ved 2 og 3 — regel 10.
    Function("thermalState") { () -> Int in
      switch ProcessInfo.processInfo.thermalState {
      case .nominal: return 0
      case .fair: return 1
      case .serious: return 2
      default: return 3
      }
    }

    AsyncFunction("vectors") { (pdfPath: String, page: Int) -> [String: Any] in
      let url = URL(fileURLWithPath: pdfPath)
      guard let doc = PDFDocument(url: url) else {
        throw Exception(name: "pdf", description: "Kunne ikke åpne PDF: \(pdfPath)")
      }
      guard let p = doc.page(at: max(0, min(page, doc.pageCount - 1))), let ref = p.pageRef else {
        throw Exception(name: "pdf", description: "Side \(page) finnes ikke (\(doc.pageCount) sider)")
      }
      let box = p.bounds(for: .cropBox)
      let snudd = (p.rotation % 180) != 0
      let pw = snudd ? box.height : box.width, ph = snudd ? box.width : box.height
      let base = ref.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: pw, height: ph), rotate: 0, preserveAspectRatio: true)

      let t = PdfVektorTilstand(base: base, hoyde: ph)
      guard let tabell = CGPDFOperatorTableCreate() else {
        throw Exception(name: "pdf", description: "Kunne ikke lage operatortabell")
      }
      t.tabell = tabell
      PdfVektorTilstand.registrer(tabell)
      let info = Unmanaged.passUnretained(t).toOpaque()
      let cs = CGPDFContentStreamCreateWithPage(ref)
      let scanner = CGPDFScannerCreate(cs, tabell, info)
      CGPDFScannerScan(scanner)
      CGPDFScannerRelease(scanner)
      // Annotasjoner (markeringer lagt oppå: Line, Ink, Stamp …) er ikke sideinnhold, men
      // de vises, og på Norconsult-planen var alle sløyfekablene slike (2026-09-13).
      // Utseende-strømmen (/AP /N) skannes med samme tabell; plassering etter PDF 12.5.5:
      // BBox × Matrix tilpasses /Rect.
      if let pageDict = ref.dictionary {
        var annots: CGPDFArrayRef? = nil
        if CGPDFDictionaryGetArray(pageDict, "Annots", &annots), let arr = annots {
          for i in 0..<CGPDFArrayGetCount(arr) {
            var ad: CGPDFDictionaryRef? = nil
            guard CGPDFArrayGetDictionary(arr, i, &ad), let a = ad else { continue }
            var flagg: CGPDFInteger = 0
            if CGPDFDictionaryGetInteger(a, "F", &flagg), (flagg & 2) != 0 { continue } // Hidden
            var ap: CGPDFDictionaryRef? = nil
            guard CGPDFDictionaryGetDictionary(a, "AP", &ap), let apd = ap else { continue }
            var strm: CGPDFStreamRef? = nil
            if !CGPDFDictionaryGetStream(apd, "N", &strm) {
              // /N kan være en ordbok av tilstander; ta /AS eller den første
              var tilstander: CGPDFDictionaryRef? = nil
              guard CGPDFDictionaryGetDictionary(apd, "N", &tilstander), let td = tilstander else { continue }
              var asNavn: UnsafePointer<CChar>? = nil
              if CGPDFDictionaryGetName(a, "AS", &asNavn), let n = asNavn { _ = CGPDFDictionaryGetStream(td, n, &strm) }
              if strm == nil {
                CGPDFDictionaryApplyBlock(td, { _, obj, _ in
                  var s2: CGPDFStreamRef? = nil
                  if CGPDFObjectGetValue(obj, .stream, &s2), let st = s2 { strm = st; return false }
                  return true
                }, nil)
              }
            }
            guard let stream = strm, let sd = CGPDFStreamGetDictionary(stream) else { continue }
            func tall4(_ d: CGPDFDictionaryRef, _ key: String) -> [CGFloat]? {
              var arr: CGPDFArrayRef? = nil
              guard CGPDFDictionaryGetArray(d, key, &arr), let a2 = arr, CGPDFArrayGetCount(a2) >= 4 else { return nil }
              var v = [CGPDFReal](repeating: 0, count: CGPDFArrayGetCount(a2))
              for k in 0..<v.count { CGPDFArrayGetNumber(a2, k, &v[k]) }
              return v.map { CGFloat($0) }
            }
            guard let rect = tall4(a, "Rect"), let bbox = tall4(sd, "BBox") else { continue }
            var m = CGAffineTransform.identity
            if let mv = tall4(sd, "Matrix"), mv.count >= 6 { m = CGAffineTransform(a: mv[0], b: mv[1], c: mv[2], d: mv[3], tx: mv[4], ty: mv[5]) }
            let r = CGRect(x: min(rect[0], rect[2]), y: min(rect[1], rect[3]), width: abs(rect[2] - rect[0]), height: abs(rect[3] - rect[1]))
            let bb = CGRect(x: min(bbox[0], bbox[2]), y: min(bbox[1], bbox[3]), width: abs(bbox[2] - bbox[0]), height: abs(bbox[3] - bbox[1])).applying(m)
            let sx = bb.width > 0 ? r.width / bb.width : 1, sy = bb.height > 0 ? r.height / bb.height : 1
            let A = CGAffineTransform(a: sx, b: 0, c: 0, d: sy, tx: r.minX - bb.minX * sx, ty: r.minY - bb.minY * sy)
            t.ctm = m.concatenating(A); t.stakk.removeAll(); t.sti.removeAll(); t.dybde = 0
            t.bredde = 1; t.graa = 0; t.metning = 0; t.tm = .identity; t.tlm = .identity; t.fontSize = 0; t.font = nil
            let acs = CGPDFContentStreamCreateWithStream(stream, sd, cs)
            let asc = CGPDFScannerCreate(acs, tabell, info)
            CGPDFScannerScan(asc)
            CGPDFScannerRelease(asc)
            CGPDFContentStreamRelease(acs)
          }
        }
      }
      CGPDFContentStreamRelease(cs)
      CGPDFOperatorTableRelease(tabell)

      // Teksten kommer fra samme skanner som strekene (Tj/TJ), i samme koordinatrom.
      // PDFKit sine characterBounds satte «SYMBOLFORKLARING» 200 pt unna på en
      // CAD-eksport med form-XObjects (2026-09-13); skanneren følger formene selv.
      let tekster = t.tekster
      return ["seg": t.ut, "tekster": tekster, "widthPt": Double(pw), "heightPt": Double(ph), "antall": t.ut.count / 8]
    }
  }
}

// Frie funksjoner, ikke statiske: C-callbacks kan ikke fange noe, heller ikke klassen selv.
private func fra(_ info: UnsafeMutableRawPointer?) -> PdfVektorTilstand {
  Unmanaged<PdfVektorTilstand>.fromOpaque(info!).takeUnretainedValue()
}
private func tall(_ s: CGPDFScannerRef) -> CGFloat {
  var v: CGPDFReal = 0
  CGPDFScannerPopNumber(s, &v)
  return CGFloat(v)
}

/// Tilstanden for innholdsstrøm-skanningen. Lever bare mens `vectors` kjører.
final class PdfVektorTilstand {
  var ctm = CGAffineTransform.identity
  var stakk: [(CGAffineTransform, CGFloat, CGFloat, CGFloat)] = []
  var bredde: CGFloat = 1
  var graa: CGFloat = 0, metning: CGFloat = 0
  var sti: [(CGPoint, CGPoint)] = []
  var cur = CGPoint.zero, start = CGPoint.zero
  var ut: [Double] = []
  var dybde = 0
  var tabell: CGPDFOperatorTableRef? = nil
  let base: CGAffineTransform
  let hoyde: CGFloat

  // ── Tekst ──
  var tekster: [[String: Any]] = []
  var tm = CGAffineTransform.identity, tlm = CGAffineTransform.identity
  var fontSize: CGFloat = 0, tegnAvstand: CGFloat = 0, ordAvstand: CGFloat = 0, hSkala: CGFloat = 1, linjeavstand: CGFloat = 0, hevet: CGFloat = 0
  var font: PdfFont? = nil
  var fontCache: [String: PdfFont] = [:]
  var tekstStakk: [(CGAffineTransform, CGAffineTransform, CGFloat, PdfFont?)] = []

  /// Vis en streng: dekod kodene til tegn, legg ut ett tekstelement per streng.
  func vis(_ bytes: [UInt8]) {
    guard fontSize != 0, !bytes.isEmpty else { return }
    let f = font ?? PdfFont.standard
    let koder = f.koder(bytes)
    var tekst = ""
    var bredde: CGFloat = 0
    for k in koder {
      tekst += f.tegn(k)
      let w0 = f.bredde(k)
      bredde += (w0 * fontSize + tegnAvstand + (k == 32 ? ordAvstand : 0)) * hSkala
    }
    let trimmet = tekst.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmet.isEmpty {
      let full = CGAffineTransform(a: fontSize * hSkala, b: 0, c: 0, d: fontSize, tx: 0, ty: hevet).concatenating(tm).concatenating(ctm).concatenating(base)
      let origo = CGPoint.zero.applying(full)
      let topp = CGPoint(x: 0, y: 1).applying(full)
      let h = max(hypot(topp.x - origo.x, topp.y - origo.y), 0.5)
      // Ledende blanke flytter starten
      let ledende = CGFloat(tekst.prefix { $0 == " " }.count)
      let startX = origo.x + ledende * 0.5 * fontSize * hSkala * (full.a / max(fontSize * hSkala, 0.001))
      tekster.append(["tekst": trimmet, "x": Double(startX), "y": Double(hoyde - origo.y), "hoyde": Double(h)])
    }
    tm = CGAffineTransform(translationX: bredde, y: 0).concatenating(tm)
  }
  func nyLinje(_ tx: CGFloat, _ ty: CGFloat) {
    tlm = CGAffineTransform(translationX: tx, y: ty).concatenating(tlm)
    tm = tlm
  }
  func velgFont(_ navn: UnsafePointer<CChar>, _ cs: CGPDFContentStreamRef) {
    guard let obj = CGPDFContentStreamGetResource(cs, "Font", navn) else { font = nil; return }
    var dict: CGPDFDictionaryRef? = nil
    guard CGPDFObjectGetValue(obj, .dictionary, &dict), let d = dict else { font = nil; return }
    let nokkel = String(describing: d) // adressen; samme ordbok → samme font
    if let f = fontCache[nokkel] { font = f; return }
    let f = PdfFont(d)
    fontCache[nokkel] = f
    font = f
  }

  init(base: CGAffineTransform, hoyde: CGFloat) { self.base = base; self.hoyde = hoyde }


  func linje(_ til: CGPoint) { sti.append((cur, til)); cur = til }
  func kurve(_ p1: CGPoint, _ p2: CGPoint, _ p3: CGPoint) {
    let p0 = cur
    var forrige = p0
    for i in 1...6 {
      let u = CGFloat(i) / 6, m = 1 - u
      let x = m*m*m*p0.x + 3*m*m*u*p1.x + 3*m*u*u*p2.x + u*u*u*p3.x
      let y = m*m*m*p0.y + 3*m*m*u*p1.y + 3*m*u*u*p2.y + u*u*u*p3.y
      let q = CGPoint(x: x, y: y)
      sti.append((forrige, q)); forrige = q
    }
    cur = p3
  }
  /// Malingsoperator: send stien ut i visningsrommet og tøm den.
  func mal(fyll: Bool, strek: Bool) {
    if sti.isEmpty { return }
    let m = ctm.concatenating(base)
    let skala = sqrt(abs(m.a * m.d - m.b * m.c))
    let b = strek ? Double(bredde * skala) : 0
    for (a, c) in sti {
      let p = a.applying(m), q = c.applying(m)
      ut.append(contentsOf: [Double(p.x), Double(hoyde - p.y), Double(q.x), Double(hoyde - q.y), b, fyll && !strek ? 1 : 0, Double(graa), Double(metning)])
    }
    sti.removeAll(keepingCapacity: true)
  }

  static func registrer(_ tabell: CGPDFOperatorTableRef) {
    CGPDFOperatorTableSetCallback(tabell, "q") { _, info in let t = fra(info); t.stakk.append((t.ctm, t.bredde, t.graa, t.metning)); t.tekstStakk.append((t.tm, t.tlm, t.fontSize, t.font)) }
    CGPDFOperatorTableSetCallback(tabell, "Q") { _, info in
      let t = fra(info)
      if let e = t.stakk.popLast() { t.ctm = e.0; t.bredde = e.1; t.graa = e.2; t.metning = e.3 }
      if let e = t.tekstStakk.popLast() { t.tm = e.0; t.tlm = e.1; t.fontSize = e.2; t.font = e.3 }
    }
    CGPDFOperatorTableSetCallback(tabell, "cm") { s, info in
      let t = fra(info)
      let f = tall(s), e = tall(s), d = tall(s), c = tall(s), b = tall(s), a = tall(s)
      t.ctm = CGAffineTransform(a: a, b: b, c: c, d: d, tx: e, ty: f).concatenating(t.ctm)
    }
    CGPDFOperatorTableSetCallback(tabell, "w") { s, info in fra(info).bredde = tall(s) }
    CGPDFOperatorTableSetCallback(tabell, "RG") { s, info in
      let t = fra(info); let b = tall(s), g = tall(s), r = tall(s)
      t.graa = (r + g + b) / 3; t.metning = max(r, g, b) - min(r, g, b)
    }
    CGPDFOperatorTableSetCallback(tabell, "G") { s, info in let t = fra(info); t.graa = tall(s); t.metning = 0 }
    CGPDFOperatorTableSetCallback(tabell, "K") { s, info in
      let t = fra(info); let k = tall(s), y = tall(s), mm = tall(s), c = tall(s)
      let r = (1 - c) * (1 - k), g = (1 - mm) * (1 - k), b = (1 - y) * (1 - k)
      t.graa = (r + g + b) / 3; t.metning = max(r, g, b) - min(r, g, b)
    }
    CGPDFOperatorTableSetCallback(tabell, "m") { s, info in let t = fra(info); let y = tall(s), x = tall(s); t.cur = CGPoint(x: x, y: y); t.start = t.cur }
    CGPDFOperatorTableSetCallback(tabell, "l") { s, info in let t = fra(info); let y = tall(s), x = tall(s); t.linje(CGPoint(x: x, y: y)) }
    CGPDFOperatorTableSetCallback(tabell, "c") { s, info in
      let t = fra(info); let y3 = tall(s), x3 = tall(s), y2 = tall(s), x2 = tall(s), y1 = tall(s), x1 = tall(s)
      t.kurve(CGPoint(x: x1, y: y1), CGPoint(x: x2, y: y2), CGPoint(x: x3, y: y3))
    }
    CGPDFOperatorTableSetCallback(tabell, "v") { s, info in
      let t = fra(info); let y3 = tall(s), x3 = tall(s), y2 = tall(s), x2 = tall(s)
      t.kurve(t.cur, CGPoint(x: x2, y: y2), CGPoint(x: x3, y: y3))
    }
    CGPDFOperatorTableSetCallback(tabell, "y") { s, info in
      let t = fra(info); let y3 = tall(s), x3 = tall(s), y1 = tall(s), x1 = tall(s)
      t.kurve(CGPoint(x: x1, y: y1), CGPoint(x: x3, y: y3), CGPoint(x: x3, y: y3))
    }
    CGPDFOperatorTableSetCallback(tabell, "h") { _, info in let t = fra(info); if t.cur != t.start { t.linje(t.start) } }
    CGPDFOperatorTableSetCallback(tabell, "re") { s, info in
      let t = fra(info); let h = tall(s), w = tall(s), y = tall(s), x = tall(s)
      let p0 = CGPoint(x: x, y: y)
      t.cur = p0; t.start = p0
      t.linje(CGPoint(x: x + w, y: y)); t.linje(CGPoint(x: x + w, y: y + h)); t.linje(CGPoint(x: x, y: y + h)); t.linje(p0)
    }
    // C-callbacks kan ikke fange variabler — derfor én linje per operator.
    CGPDFOperatorTableSetCallback(tabell, "S") { _, info in fra(info).mal(fyll: false, strek: true) }
    CGPDFOperatorTableSetCallback(tabell, "s") { _, info in let t = fra(info); if t.cur != t.start { t.linje(t.start) }; t.mal(fyll: false, strek: true) }
    CGPDFOperatorTableSetCallback(tabell, "f") { _, info in fra(info).mal(fyll: true, strek: false) }
    CGPDFOperatorTableSetCallback(tabell, "F") { _, info in fra(info).mal(fyll: true, strek: false) }
    CGPDFOperatorTableSetCallback(tabell, "f*") { _, info in fra(info).mal(fyll: true, strek: false) }
    CGPDFOperatorTableSetCallback(tabell, "B") { _, info in fra(info).mal(fyll: true, strek: true) }
    CGPDFOperatorTableSetCallback(tabell, "B*") { _, info in fra(info).mal(fyll: true, strek: true) }
    CGPDFOperatorTableSetCallback(tabell, "b") { _, info in let t = fra(info); if t.cur != t.start { t.linje(t.start) }; t.mal(fyll: true, strek: true) }
    CGPDFOperatorTableSetCallback(tabell, "b*") { _, info in let t = fra(info); if t.cur != t.start { t.linje(t.start) }; t.mal(fyll: true, strek: true) }
    CGPDFOperatorTableSetCallback(tabell, "n") { _, info in fra(info).sti.removeAll(keepingCapacity: true) }
    // ── Tekst (PDF 1.7 §9.4) ──
    CGPDFOperatorTableSetCallback(tabell, "BT") { _, info in let t = fra(info); t.tm = .identity; t.tlm = .identity }
    CGPDFOperatorTableSetCallback(tabell, "Tf") { s, info in
      let t = fra(info); let storrelse = tall(s)
      var navn: UnsafePointer<CChar>? = nil
      if CGPDFScannerPopName(s, &navn), let n = navn { t.velgFont(n, CGPDFScannerGetContentStream(s)) }
      t.fontSize = storrelse
    }
    CGPDFOperatorTableSetCallback(tabell, "Td") { s, info in let t = fra(info); let ty = tall(s), tx = tall(s); t.nyLinje(tx, ty) }
    CGPDFOperatorTableSetCallback(tabell, "TD") { s, info in let t = fra(info); let ty = tall(s), tx = tall(s); t.linjeavstand = -ty; t.nyLinje(tx, ty) }
    CGPDFOperatorTableSetCallback(tabell, "Tm") { s, info in
      let t = fra(info); let f = tall(s), e = tall(s), d = tall(s), c = tall(s), b = tall(s), a = tall(s)
      t.tlm = CGAffineTransform(a: a, b: b, c: c, d: d, tx: e, ty: f); t.tm = t.tlm
    }
    CGPDFOperatorTableSetCallback(tabell, "T*") { _, info in let t = fra(info); t.nyLinje(0, -t.linjeavstand) }
    CGPDFOperatorTableSetCallback(tabell, "TL") { s, info in fra(info).linjeavstand = tall(s) }
    CGPDFOperatorTableSetCallback(tabell, "Tc") { s, info in fra(info).tegnAvstand = tall(s) }
    CGPDFOperatorTableSetCallback(tabell, "Tw") { s, info in fra(info).ordAvstand = tall(s) }
    CGPDFOperatorTableSetCallback(tabell, "Tz") { s, info in fra(info).hSkala = tall(s) / 100 }
    CGPDFOperatorTableSetCallback(tabell, "Ts") { s, info in fra(info).hevet = tall(s) }
    CGPDFOperatorTableSetCallback(tabell, "Tj") { s, info in
      var str: CGPDFStringRef? = nil
      if CGPDFScannerPopString(s, &str), let st = str { fra(info).vis(pdfBytes(st)) }
    }
    CGPDFOperatorTableSetCallback(tabell, "'") { s, info in
      let t = fra(info); var str: CGPDFStringRef? = nil
      if CGPDFScannerPopString(s, &str), let st = str { t.nyLinje(0, -t.linjeavstand); t.vis(pdfBytes(st)) }
    }
    CGPDFOperatorTableSetCallback(tabell, "\"") { s, info in
      let t = fra(info); var str: CGPDFStringRef? = nil
      let harStr = CGPDFScannerPopString(s, &str); let ac = tall(s), aw = tall(s)
      t.ordAvstand = aw; t.tegnAvstand = ac
      if harStr, let st = str { t.nyLinje(0, -t.linjeavstand); t.vis(pdfBytes(st)) }
    }
    CGPDFOperatorTableSetCallback(tabell, "TJ") { s, info in
      let t = fra(info); var arr: CGPDFArrayRef? = nil
      guard CGPDFScannerPopArray(s, &arr), let a = arr else { return }
      for i in 0..<CGPDFArrayGetCount(a) {
        var str: CGPDFStringRef? = nil
        var num: CGPDFReal = 0
        if CGPDFArrayGetString(a, i, &str), let st = str { t.vis(pdfBytes(st)) }
        else if CGPDFArrayGetNumber(a, i, &num) {
          t.tm = CGAffineTransform(translationX: -CGFloat(num) / 1000 * t.fontSize * t.hSkala, y: 0).concatenating(t.tm)
        }
      }
    }
    // Form-XObjects: CAD-eksporter legger symbolene i egne strømmer. Følg dem, med egen matrise.
    CGPDFOperatorTableSetCallback(tabell, "Do") { s, info in
      let t = fra(info)
      var navn: UnsafePointer<CChar>? = nil
      guard CGPDFScannerPopName(s, &navn), let n = navn else { return }
      let cs = CGPDFScannerGetContentStream(s)
      guard let obj = CGPDFContentStreamGetResource(cs, "XObject", n) else { return }
      var strm: CGPDFStreamRef? = nil
      guard CGPDFObjectGetValue(obj, .stream, &strm), let stream = strm, let dict = CGPDFStreamGetDictionary(stream) else { return }
      var subtype: UnsafePointer<CChar>? = nil
      guard CGPDFDictionaryGetName(dict, "Subtype", &subtype), let st = subtype, String(cString: st) == "Form" else { return }
      guard t.dybde < 12, let tabell = t.tabell else { return }
      var m = CGAffineTransform.identity
      var arr: CGPDFArrayRef? = nil
      if CGPDFDictionaryGetArray(dict, "Matrix", &arr), let a = arr, CGPDFArrayGetCount(a) == 6 {
        var v = [CGPDFReal](repeating: 0, count: 6)
        for i in 0..<6 { CGPDFArrayGetNumber(a, i, &v[i]) }
        m = CGAffineTransform(a: CGFloat(v[0]), b: CGFloat(v[1]), c: CGFloat(v[2]), d: CGFloat(v[3]), tx: CGFloat(v[4]), ty: CGFloat(v[5]))
      }
      let lagret = (t.ctm, t.bredde, t.graa, t.metning, t.cur, t.start)
      t.ctm = m.concatenating(t.ctm); t.dybde += 1
      let under = CGPDFContentStreamCreateWithStream(stream, dict, cs)
      let scanner = CGPDFScannerCreate(under, tabell, info)
      CGPDFScannerScan(scanner)
      CGPDFScannerRelease(scanner)
      CGPDFContentStreamRelease(under)
      t.dybde -= 1
      t.ctm = lagret.0; t.bredde = lagret.1; t.graa = lagret.2; t.metning = lagret.3; t.cur = lagret.4; t.start = lagret.5
    }
  }
}


private func pdfBytes(_ st: CGPDFStringRef) -> [UInt8] {
  guard let p = CGPDFStringGetBytePtr(st) else { return [] }
  return Array(UnsafeBufferPointer(start: p, count: CGPDFStringGetLength(st)))
}

/// Det vi trenger av en font for å lese tekst: hvor mange byte per kode, hvilket
/// tegn en kode er (ToUnicode), og omtrent hvor bred den er (Widths). Ikke mer.
final class PdfFont {
  static let standard = PdfFont()
  var byterPerKode = 1
  var tilUnicode: [Int: String] = [:]
  var bredder: [Int: CGFloat] = [:]
  var standardBredde: CGFloat = 0.5
  var erType0 = false

  init() {}
  init(_ d: CGPDFDictionaryRef) {
    var subtype: UnsafePointer<CChar>? = nil
    if CGPDFDictionaryGetName(d, "Subtype", &subtype), let st = subtype, String(cString: st) == "Type0" {
      erType0 = true; byterPerKode = 2
    }
    var tu: CGPDFStreamRef? = nil
    if CGPDFDictionaryGetStream(d, "ToUnicode", &tu), let strm = tu {
      var fmt = CGPDFDataFormat.raw
      if let data = CGPDFStreamCopyData(strm, &fmt) as Data?, let cmap = String(data: data, encoding: .isoLatin1) { lesCMap(cmap) }
    }
    // Bredder for enkle fonter: /FirstChar + /Widths (per 1000).
    var first: CGPDFInteger = 0
    var w: CGPDFArrayRef? = nil
    if !erType0, CGPDFDictionaryGetInteger(d, "FirstChar", &first), CGPDFDictionaryGetArray(d, "Widths", &w), let arr = w {
      for i in 0..<CGPDFArrayGetCount(arr) {
        var v: CGPDFReal = 0
        if CGPDFArrayGetNumber(arr, i, &v), v > 0 { bredder[Int(first) + i] = CGFloat(v) / 1000 }
      }
    }
    if erType0 {
      var desc: CGPDFArrayRef? = nil
      if CGPDFDictionaryGetArray(d, "DescendantFonts", &desc), let da = desc, CGPDFArrayGetCount(da) > 0 {
        var cid: CGPDFDictionaryRef? = nil
        if CGPDFArrayGetDictionary(da, 0, &cid), let cd = cid {
          var dw: CGPDFReal = 0
          if CGPDFDictionaryGetNumber(cd, "DW", &dw), dw > 0 { standardBredde = CGFloat(dw) / 1000 }
        }
      }
    }
  }

  /// ToUnicode-CMap: bfchar og bfrange. Kodelengden leses av codespacerange.
  private func lesCMap(_ s: String) {
    if let r = s.range(of: "begincodespacerange") {
      let etter = s[r.upperBound...]
      if let lo = etter.range(of: "<"), let hi = etter[lo.upperBound...].range(of: ">") {
        let hexLen = etter[lo.upperBound..<hi.lowerBound].count
        byterPerKode = max(1, hexLen / 2)
      }
    }
    let hexTegn = { (h: Substring) -> String in
      var ut = [UInt16]()
      var i = h.startIndex
      while i < h.endIndex, let j = h.index(i, offsetBy: 4, limitedBy: h.endIndex) {
        if let v = UInt16(h[i..<j], radix: 16) { ut.append(v) }
        i = j
      }
      return String(utf16CodeUnits: ut, count: ut.count)
    }
    let tokens = s.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\r" || $0 == "\t" }).map { Substring($0) }
    var i = 0
    while i < tokens.count {
      let t = tokens[i]
      if t == "beginbfchar" {
        i += 1
        while i + 1 < tokens.count, tokens[i] != "endbfchar" {
          if let src = Int(tokens[i].dropFirst().dropLast(), radix: 16) { tilUnicode[src] = hexTegn(tokens[i + 1].dropFirst().dropLast()) }
          i += 2
        }
      } else if t == "beginbfrange" {
        i += 1
        while i + 2 < tokens.count, tokens[i] != "endbfrange" {
          guard let lo = Int(tokens[i].dropFirst().dropLast(), radix: 16), let hi = Int(tokens[i + 1].dropFirst().dropLast(), radix: 16) else { i += 3; continue }
          let dst = tokens[i + 2]
          if dst.hasPrefix("[") {
            // [<d1> <d2> …] — ett mål per kode
            var k = i + 2; var kode = lo
            var forste = true
            while k < tokens.count {
              var tok = tokens[k]
              if forste { tok = tok.dropFirst(); forste = false }
              let slutt = tok.hasSuffix("]")
              if slutt { tok = tok.dropLast() }
              if tok.hasPrefix("<") { tilUnicode[kode] = hexTegn(tok.dropFirst().dropLast()); kode += 1 }
              k += 1
              if slutt { break }
            }
            i = k
          } else {
            let start = hexTegn(dst.dropFirst().dropLast())
            if let forsteEnhet = start.utf16.first, hi >= lo, hi - lo < 65536 {
              for kode in lo...hi {
                let enhet = UInt16(truncatingIfNeeded: Int(forsteEnhet) + (kode - lo))
                tilUnicode[kode] = String(utf16CodeUnits: [enhet], count: 1)
              }
            }
            i += 3
          }
        }
      } else { i += 1 }
    }
  }

  func koder(_ bytes: [UInt8]) -> [Int] {
    if byterPerKode == 2 {
      var ut: [Int] = []
      var i = 0
      while i + 1 < bytes.count { ut.append(Int(bytes[i]) << 8 | Int(bytes[i + 1])); i += 2 }
      return ut
    }
    return bytes.map { Int($0) }
  }
  func tegn(_ kode: Int) -> String {
    if let u = tilUnicode[kode] { return u }
    if byterPerKode == 1, let s = String(bytes: [UInt8(truncatingIfNeeded: kode)], encoding: .windowsCP1252) { return s }
    return ""
  }
  func bredde(_ kode: Int) -> CGFloat { bredder[kode] ?? standardBredde }
}
