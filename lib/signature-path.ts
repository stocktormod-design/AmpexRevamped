/**
 * Signaturstrøk → SVG-sti.
 *
 * Bor her, ikke i `components/signature-pad.tsx`, fordi den skal brukes to
 * steder med helt ulike krav: Skia tegner den på skjermen, og PDF-en tegner
 * den som SVG. Komponentfila drar med seg Skia og gesture-handler, og da kan
 * verken selvtesten (`npm run verify:pdf`) eller en ren dokumentmodul importere
 * den. To kopier av denne åtte linjene ville betydd at signaturen kunne se
 * ulik ut i appen og på dokumentet kunden får.
 */
export function signaturSti(points: [number, number][], w: number, h: number): string {
  if (points.length === 0) return ''
  let d = `M${points[0][0] * w} ${points[0][1] * h}`
  for (let i = 1; i < points.length; i++) d += ` L${points[i][0] * w} ${points[i][1] * h}`
  // Ett enkelt punkt (en prikk) tegner ingen linje — gi den en minimal lengde,
  // ellers forsvinner en signatur som bare er en prikk helt.
  if (points.length === 1) d += ` L${points[0][0] * w + 0.6} ${points[0][1] * h}`
  return d
}
