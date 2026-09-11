import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Canvas, Image as SkiaImage, Skia, type SkImage } from '@shopify/react-native-skia'
import * as FileSystem from 'expo-file-system/legacy'
import { Layers } from 'lucide-react-native'
import { getLocalPdf } from '../lib/drawings-storage'
import { renderPdfPage } from '../modules/ampex-splat'
import { colors, sizes } from '../lib/theme'

/**
 * Miniatyr av en tegning (side 1), BESKÅRET TIL BLEKKET. Et A1-ark er for det
 * meste hvit marg og tittelfelt; vist hel ble planen en frimerkeflekk nederst
 * («hele pdfen vises jo ikke engang» — Tormod 2026-09-06). Vi finner de mørke
 * pikslenes boks og rammer inn den, med litt luft.
 */
type Miniatyr = { img: SkImage; bx: number; by: number; bw: number; bh: number }
const minne = new Map<string, Miniatyr>()

function blekkboks(img: SkImage): { bx: number; by: number; bw: number; bh: number } {
  const W = img.width(), H = img.height()
  const raa = img.readPixels()
  if (!raa) return { bx: 0, by: 0, bw: W, bh: H }
  const px = raa as Uint8Array
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  const steg = 1
  for (let y = 0; y < H; y += steg) {
    for (let x = 0; x < W; x += steg) {
      const i = (y * W + x) * 4
      // Blekk = tydelig mørkere enn papir (også fargede strekpenner).
      if (px[i] + px[i + 1] + px[i + 2] < 3 * 190) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0 || x1 - x0 < W * 0.05 || y1 - y0 < H * 0.05) return { bx: 0, by: 0, bw: W, bh: H }
  const m = Math.max(x1 - x0, y1 - y0) * 0.03
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W, x1 + m); y1 = Math.min(H, y1 + m)
  return { bx: x0, by: y0, bw: x1 - x0, bh: y1 - y0 }
}

async function last(filePath: string, px: number): Promise<Miniatyr | null> {
  const u = await getLocalPdf(filePath)
  // Blekkboksen regnes på et LITE raster (192 px): readPixels på 640×480 i JS
  // tok 50–100 ms per miniatyr og hakket lista (Tormod: «noe lag»). Boksen
  // skaleres opp til visningsrasteret etterpå.
  const liten = await renderPdfPage(u, 0, 192)
  const lb64 = await FileSystem.readAsStringAsync(liten.uri.replace('file://', ''), { encoding: 'base64' })
  const limg = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(lb64))
  const r = await renderPdfPage(u, 0, px)
  const b64 = await FileSystem.readAsStringAsync(r.uri.replace('file://', ''), { encoding: 'base64' })
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(b64))
  if (!img) return null
  if (!limg) return { img, bx: 0, by: 0, bw: img.width(), bh: img.height() }
  const b = blekkboks(limg)
  const k = img.width() / limg.width()
  return { img, bx: b.bx * k, by: b.by * k, bw: b.bw * k, bh: b.bh * k }
}

export function DrawingThumb({ filePath, style, px = 640 }: { filePath: string | null; style?: object; px?: number }) {
  const key = filePath ? filePath + '@' + px : ''
  const [m, setM] = useState<Miniatyr | null>(key ? minne.get(key) ?? null : null)
  const [str, setStr] = useState({ w: 0, h: 0 })
  useEffect(() => {
    let alive = true
    if (!filePath) return
    if (minne.has(key)) { setM(minne.get(key)!); return }
    last(filePath, px).then(r => { if (r) { minne.set(key, r); if (alive) setM(r) } }).catch(() => {})
    return () => { alive = false }
  }, [filePath, key, px])

  // Blekkboksen rammes inn («contain») i flisa; resten av arket klippes bort.
  let tegn: { x: number; y: number; w: number; h: number } | null = null
  if (m && str.w > 0 && str.h > 0) {
    const s = Math.min(str.w / m.bw, str.h / m.bh)
    tegn = {
      w: m.img.width() * s, h: m.img.height() * s,
      x: str.w / 2 - (m.bx + m.bw / 2) * s,
      y: str.h / 2 - (m.by + m.bh / 2) * s,
    }
  }
  return (
    <View
      style={[{ backgroundColor: '#FFFFFF', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}
      onLayout={e => setStr({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {m && tegn
        ? <Canvas style={{ width: str.w, height: str.h }}>
            <SkiaImage image={m.img} x={tegn.x} y={tegn.y} width={tegn.w} height={tegn.h} fit="fill" />
          </Canvas>
        : <Layers size={sizes.icon} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />}
    </View>
  )
}
