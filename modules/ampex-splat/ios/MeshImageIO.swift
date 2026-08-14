import Foundation
import CoreGraphics
import ImageIO
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

    /// Atlas → JPEG. 0.90 kvalitet: kilde-JPEG + atlas-JPEG er dobbel tapskoding — ringing oppå ringing.
    static func jpegData(_ pixels: [UInt8], _ size: Int) -> Data? {
        guard let cg = makeCGImage(pixels, size) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality as String: 0.90] as CFDictionary)
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
