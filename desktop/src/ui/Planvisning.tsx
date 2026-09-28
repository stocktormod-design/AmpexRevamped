import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import arbeider from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Maximize } from 'lucide-react'

GlobalWorkerOptions.workerSrc = arbeider

/**
 * Tegningen på kontoret: første side rendret én gang av pdf.js i høy
 * oppløsning, flyttet og zoomet med CSS-transform (billig, 120 Hz), og
 * markørene lagt OVER i skjermkoordinater så de holder samme størrelse på
 * alle zoomnivåer — samme regel som lerretet i appen.
 *
 * Styring som i Figma/Maps: to fingre på styreflata flytter, knip zoomer
 * (nettleseren sender knip som wheel + ctrlKey), dra med musa flytter,
 * dobbeltklikk zoomer inn der du klikket.
 *
 * Koordinatene er normaliserte 0..1 på siden — de samme appen lagrer.
 */

export type Markor = {
  id: string
  x: number
  y: number
  form: 'enhet' | 'pin'
  farge: string
  /** Enhet: fylt prikk = montert. */
  fylt: boolean
  tittel: string
  under?: string
}

type Transform = { s: number; x: number; y: number }

const MAKS_PX = 4096

export function Planvisning({ url, markorer, valgt, fokus, onVelg }: {
  url: string | null
  markorer: Markor[]
  valgt: string | null
  /** Endre `n` for å fly til et punkt (oppgave valgt i lista). */
  fokus: { x: number; y: number; n: number } | null
  onVelg: (id: string | null) => void
}) {
  const boks = useRef<HTMLDivElement>(null)
  const lerret = useRef<HTMLCanvasElement>(null)
  const [side, setSide] = useState<{ w: number; h: number } | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [t, setT] = useState<Transform>({ s: 1, x: 0, y: 0 })
  const [glir, setGlir] = useState(false) // animer transformen (fokus/tilpass), ikke under dra
  const [over, setOver] = useState<string | null>(null)
  const dra = useRef<{ px: number; py: number; x: number; y: number; flyttet: boolean } | null>(null)

  // Render side 1 én gang per tegning.
  useEffect(() => {
    if (!url) return
    let levende = true
    setSide(null); setFeil(null)
    const oppgave = getDocument({ url })
    oppgave.promise
      .then(dok => dok.getPage(1))
      .then(async s => {
        const base = s.getViewport({ scale: 1 })
        const skala = Math.min(MAKS_PX / base.width, MAKS_PX / base.height, 4)
        const vp = s.getViewport({ scale: skala })
        const c = lerret.current
        if (!c || !levende) return
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height)
        await s.render({ canvas: c, viewport: vp }).promise
        if (levende) setSide({ w: c.width, h: c.height })
      })
      .catch(e => { if (levende) setFeil(e instanceof Error ? e.message : String(e)) })
    return () => { levende = false; void oppgave.destroy() }
  }, [url])

  const tilpass = useCallback((glidende: boolean) => {
    const b = boks.current
    if (!b || !side) return
    const s = Math.min(b.clientWidth / side.w, b.clientHeight / side.h) * 0.94
    setGlir(glidende)
    setT({ s, x: (b.clientWidth - side.w * s) / 2, y: (b.clientHeight - side.h * s) / 2 })
  }, [side])
  useLayoutEffect(() => { tilpass(false) }, [tilpass])

  // Fly til et punkt: minst 3× tilpasset zoom, punktet midt i boksen.
  useEffect(() => {
    const b = boks.current
    if (!fokus || !b || !side) return
    const fit = Math.min(b.clientWidth / side.w, b.clientHeight / side.h)
    setGlir(true)
    setT(g => {
      const s = Math.max(g.s, fit * 3)
      return { s, x: b.clientWidth / 2 - fokus.x * side.w * s, y: b.clientHeight / 2 - fokus.y * side.h * s }
    })
  }, [fokus?.n, side]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomRundt = useCallback((faktor: number, cx: number, cy: number) => {
    setGlir(false)
    setT(g => {
      const b = boks.current
      const fit = b && side ? Math.min(b.clientWidth / side.w, b.clientHeight / side.h) : 0.05
      const s = Math.min(Math.max(g.s * faktor, fit * 0.5), 3)
      const k = s / g.s
      return { s, x: cx - (cx - g.x) * k, y: cy - (cy - g.y) * k }
    })
  }, [side])

  // wheel må være ikke-passiv for å kunne stoppe sidezoom i nettleseren.
  useEffect(() => {
    const b = boks.current
    if (!b) return
    const hjul = (e: WheelEvent) => {
      e.preventDefault()
      const r = b.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomRundt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top)
      else { setGlir(false); setT(g => ({ ...g, x: g.x - e.deltaX, y: g.y - e.deltaY })) }
    }
    b.addEventListener('wheel', hjul, { passive: false })
    return () => b.removeEventListener('wheel', hjul)
  }, [zoomRundt])

  const skjerm = (x: number, y: number) => side ? { l: t.x + x * side.w * t.s, o: t.y + y * side.h * t.s } : { l: 0, o: 0 }
  const overlegg = over ? markorer.find(m => m.id === over) : valgt ? markorer.find(m => m.id === valgt) : null

  return (
    <div
      ref={boks}
      className="plan"
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('.plan-markor, .plan-verktoy')) return
        dra.current = { px: e.clientX, py: e.clientY, x: t.x, y: t.y, flyttet: false }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const d = dra.current
        if (!d) return
        const dx = e.clientX - d.px, dy = e.clientY - d.py
        if (Math.abs(dx) + Math.abs(dy) > 3) d.flyttet = true
        setGlir(false)
        setT(g => ({ ...g, x: d.x + dx, y: d.y + dy }))
      }}
      onPointerUp={() => {
        const d = dra.current
        dra.current = null
        if (d && !d.flyttet) onVelg(null) // klikk i tomt rom slipper valget
      }}
      onDoubleClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        setGlir(true)
        zoomRundt(2, e.clientX - r.left, e.clientY - r.top)
        setGlir(true)
      }}
    >
      <canvas
        ref={lerret}
        className="plan-lerret"
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transition: glir ? 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          opacity: side ? 1 : 0,
        }}
      />

      {side && (
        <div className="plan-lag" style={{ transition: glir ? 'none' : undefined }}>
          {markorer.map((m, i) => {
            const p = skjerm(m.x, m.y)
            return (
              <button
                key={m.id}
                type="button"
                className={`plan-markor plan-${m.form}${m.fylt ? ' fylt' : ''}${valgt === m.id ? ' valgt' : ''}${glir ? ' glir' : ''}`}
                style={{ left: p.l, top: p.o, ['--farge' as string]: m.farge, animationDelay: `${Math.min(i * 14, 700)}ms` }}
                onPointerEnter={() => setOver(m.id)}
                onPointerLeave={() => setOver(o => (o === m.id ? null : o))}
                onClick={() => onVelg(m.id)}
                aria-label={m.tittel}
              />
            )
          })}
          {overlegg && (() => {
            const p = skjerm(overlegg.x, overlegg.y)
            return (
              <div className={`plan-tips${glir ? ' glir' : ''}`} style={{ left: p.l, top: p.o }}>
                <strong>{overlegg.tittel}</strong>
                {overlegg.under ? <span>{overlegg.under}</span> : null}
              </div>
            )
          })()}
        </div>
      )}

      {!side && (
        <div className="plan-tom">{feil ? `Kunne ikke vise tegningen: ${feil}` : url ? 'Henter tegningen …' : 'Tegningen har ingen PDF ennå.'}</div>
      )}

      {side && (
        <div className="plan-verktoy">
          <button type="button" className="plan-knapp" onClick={() => tilpass(true)} title="Tilpass (0)">
            <Maximize size={15} strokeWidth={2} />
          </button>
          <span className="plan-zoom">{Math.round(t.s * 100 / Math.min((boks.current?.clientWidth ?? 1) / side.w, (boks.current?.clientHeight ?? 1) / side.h) / 0.94)} %</span>
        </div>
      )}
    </div>
  )
}
