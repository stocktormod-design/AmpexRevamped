import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, type ReactNode } from 'react'

/**
 * Tett tabell med virtualiserte rader.
 *
 * En grossistfil har titusenvis av linjer, og forhåndsvisningen skal vise dem
 * uten å legge like mange DOM-noder i WebView2. Kontor-PC-en baker samtidig
 * splat-atlas i Open3D; en tabell som spiser en halv gigabyte stjeler fra den.
 *
 * Radhøyden er fast (`--rad`, 30 px) fordi den er kjent på forhånd. Det er den
 * enkleste og raskeste varianten, og den holder så lenge ingen rad brekker over
 * to linjer, som ingen skal.
 */

export type Kolonne<T> = {
  nokkel: string
  navn: string
  /** CSS grid-track, f.eks. `'110px'`, `'minmax(0,1fr)'`. */
  bredde: string
  /** Høyrestilt med tabulærsiffer. Brukes på alle tall. */
  tall?: boolean
  celle: (rad: T) => ReactNode
}

const RADHOYDE = 30

export function Tabell<T>({
  rader,
  kolonner,
  nokkel,
  tomTekst = 'Ingenting å vise',
}: {
  rader: T[]
  kolonner: Kolonne<T>[]
  nokkel: (rad: T, i: number) => string
  tomTekst?: string
}) {
  const kropp = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({
    count: rader.length,
    getScrollElement: () => kropp.current,
    estimateSize: () => RADHOYDE,
    overscan: 12,
  })
  const grid = { gridTemplateColumns: kolonner.map(k => k.bredde).join(' ') }

  return (
    <div className="tabell">
      <div className="tabell-hode" style={grid}>
        {kolonner.map(k => (
          <div key={k.nokkel} className={k.tall ? 'tabell-celle tall' : 'tabell-celle'}>
            {k.navn}
          </div>
        ))}
      </div>
      <div className="tabell-kropp" ref={kropp}>
        {rader.length === 0 ? (
          <div className="tomt">{tomTekst}</div>
        ) : (
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map(item => {
              const rad = rader[item.index]
              return (
                <div
                  key={nokkel(rad, item.index)}
                  className="tabell-rad"
                  style={{
                    ...grid,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {kolonner.map(k => (
                    <div key={k.nokkel} className={k.tall ? 'tabell-celle tall' : 'tabell-celle'}>
                      {k.celle(rad)}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
