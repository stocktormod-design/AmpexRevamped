import Foundation
import CoreGraphics
import ImageIO
import Metal
import simd

/// Bilde-I/O delt av bake-pipelinen (MeshBakeV2, MeshPoseRefineV2): keyframe-dekoding,
/// thumb-dekoding, RGBA-uttrekk, lineær snittfarge og atlas-JPEG-koding.
/// (Løftet ut av den slettede V1-bakeren MeshTextureBaker, 2026-08-13.)
enum MeshImageIO {
    static func loadCGImage(_ dir: URL, _ file: String) -> CGImage? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(file)) as CFData,
              let src = CGImageSourceCreateWithData(data, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(src, 0, nil)
    }

    /// Miniatyr-dekoding: eksponerings-statistikk + levelling-sampling trenger ikke
    /// full oppløsning — ~10-20× raskere enn full dekoding for 4K-keyframes.
    static func loadCGImageThumb(_ dir: URL, _ file: String, maxPx: Int) -> CGImage? {
        guard let src = CGImageSourceCreateWithURL(dir.appendingPathComponent(file) as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPx,
            kCGImageSourceCreateThumbnailWithTransform: false,
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }

    static func rgbaBytes(_ cg: CGImage) -> [UInt8]? {
        let w = cg.width, h = cg.height
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return buf
    }

    /// Snitt-RGB i LINEÆRT rom (samplet ~4k piksler) — grunnlaget for per-kanal WB-utjevning.
    /// Lineært fordi gains løses og appliseres i lineært rom (gamma-rom-blanding vasket ut tonene).
    static func meanRGBLinear(_ rgba: [UInt8]) -> SIMD3<Float> {
        var sum = SIMD3<Float>(0, 0, 0)
        let stride = max(1, (rgba.count / 4) / 4096) * 4
        var n = 0
        var i = 0
        while i + 2 < rgba.count {
            let v = SIMD3(Float(rgba[i]), Float(rgba[i + 1]), Float(rgba[i + 2])) / 255.0
            sum += SIMD3(pow(v.x, 2.2), pow(v.y, 2.2), pow(v.z, 2.2))
            n += 1; i += stride
        }
        return n > 0 ? sum / Float(n) : SIMD3(0.25, 0.25, 0.25)
    }

    /// Atlas-JPEG fra en RÅFIL på disk — ingen full kopi i minnet.
    ///
    /// MÅLT 2026-09-12 (§93): veien om `[UInt8]` holdt TRE fulle kopier av flisa
    /// samtidig — Metal-bufferet, Swift-arrayen, og `Data(pixels)` inne i
    /// `makeCGImage`. Ved 8192 er det 3 × 268 MB = 800 MB oppå atlasparet, og det er
    /// grunnen til at flisemalingen ikke fikk plass til 8192 på et stort rom.
    ///
    /// `CGDataProvider(url:)` memory-mapper fila. Pikslene blir RENE sider med en fil
    /// bak seg, som iOS kan kaste ut under trykk og lese inn igjen — i motsetning til
    /// en Swift-array, som er skitten hukommelse appen eier og må betale for.
    /// Sammen med stripevis tilbakelesing (MeshBakeV2) er toppen ett stripebuffer i
    /// stedet for hele flisa tre ganger.
    static func jpegData(fromRawFile url: URL, size: Int) -> Data? {
        guard let provider = CGDataProvider(url: url as CFURL),
              let cg = cgImage(provider, size) else { return nil }
        return encodeJpeg(cg)
    }

    private static func cgImage(_ provider: CGDataProvider, _ size: Int) -> CGImage? {
        CGImage(width: size, height: size,
                bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider, decode: nil, shouldInterpolate: false,
                intent: .defaultIntent)
    }

    private static func encodeJpeg(_ cg: CGImage) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.jpeg" as CFString, 1, nil) else { return nil }
        var q = 0.80
        if let s = UserDefaults.standard.string(forKey: "meshscan.jpegkvalitet"), let v = Double(s), v >= 0.3, v <= 1 { q = v }
        CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality as String: q] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    /// Atlas → JPEG fra en array i minnet. Holder tre fulle kopier; brukes bare der
    /// bildet alt ER en array (diagnose, fixture-PNG). Produksjonsveien for fliser går
    /// gjennom `jpegData(fromRawFile:size:)`.
    ///
    /// Kvaliteten er MÅLT 2026-09-11 (§83): 0,90 → 0,80 tar teksturen fra 35,5 til 26,8 MB
    /// på en 8192-kvalitetsmodell, og de to er ikke til å skille på 3× nærmeste-nabo-zoom
    /// i det mest detaljerte feltet i atlaset. Selv 0,72 var uskillelig, men 0,80 beholder
    /// margin mot zoom i vieweren. meshscan.jpegkvalitet er A/B-armen.
    static func jpegData(_ pixels: [UInt8], _ size: Int) -> Data? {
        guard let cg = makeCGImage(pixels, size) else { return nil }
        return encodeJpeg(cg)
    }

    /// Fixture-only lossless readback: separates atlas sampling from JPEG loss.
    static func pngData(_ pixels: [UInt8], _ size: Int) -> Data? {
        guard let cg = makeCGImage(pixels, size) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    private static func makeCGImage(_ pixels: [UInt8], _ size: Int) -> CGImage? {
        let cs = CGColorSpaceCreateDeviceRGB()
        // CGDataProvider retains the Data for the lifetime of the CGImage.
        // The old CGContext(&localArray) approach caused dangling pointer → corrupted pixels.
        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
        return CGImage(width: size, height: size,
                       bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
                       space: cs,
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false,
                       intent: .defaultIntent)
    }
}
