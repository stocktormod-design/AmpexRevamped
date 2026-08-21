import { formatKr } from '@delt/invoicing'
import { tilbudStatusLabel, type TilbudStatus } from '@delt/quoting'
import { useEffect, useMemo, useState } from 'react'
import { hentTilbud, type Tilbud as Rad } from '@/lib/kontor-lager'
import { antall, Beskjed, Felt, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Tilbud.
 *
 * Summen REGNES IKKE HER. `lib/quoting.ts` gjør det, den har `verify:quoting`,
 * og montørappen bruker den samme. Kontoret og telefonen skal aldri kunne
 * komme til to forskjellige svar på det samme tilbudet — det er beløpet kunden
 * har sagt ja til.
 *
 * Statusen som vises er den EFFEKTIVE: et sendt tilbud med utløpt
 * gyldighetsdato står som utløpt, ikke som sendt. Den skjelningen er hele
 * grunnen til at `effektivStatus()` finnes.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

function dato(v: string | null): string {
  return v ? DATO.format(new Date(v)) : '–'
}

const STIL: Record<TilbudStatus, 'ny' | 'varsel' | 'feil' | 'endret' | 'noytral'> = {
  utkast: 'noytral',
  sendt: 'endret',
  akseptert: 'ny',
  avslatt: 'feil',
  utlopt: 'varsel',
}

export function Tilbud() {
  const [rader, setRader] = useState<Rad[]>([])
  const [sok, setSok] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  useEffect(() => {
    hentTilbud()
      .then(setRader)
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
      .finally(() => setLaster(false))
  }, [])

  const synlige = useMemo(() => {
    const s = sok.trim().toLowerCase()
    if (!s) return rader
    return rader.filter(t =>
      [t.title, t.customer_name, t.quote_number != null ? String(t.quote_number) : null]
        .some(v => v?.toLowerCase().includes(s)),
    )
  }, [rader, sok])

  const per = (s: TilbudStatus) => rader.filter(t => t.visning === s)
  const sum = (liste: Rad[]) => liste.reduce((n, t) => n + t.bruttoOre, 0)

  const ute = [...per('sendt')]
  const vunnet = per('akseptert')
  const utlopt = per('utlopt')

  return (
    <>
      <Sidehode
        tittel="Tilbud"
        under={laster
          ? 'Henter …'
          : `${formatKr(sum(ute))} kr ute hos kunden · ${formatKr(sum(vunnet))} kr akseptert${utlopt.length > 0 ? ` · ${stk(utlopt.length, 'utløpt', 'utløpte')}` : ''}`}
        handling={
          <div style={{ width: 250 }}>
            <Felt
              placeholder="Søk tilbudsnummer, kunde, tittel …"
              value={sok}
              onChange={e => setSok(e.target.value)}
            />
          </div>
        }
      />


      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <Kort tittel="Alle tilbud" merkelapp={laster ? 'Henter …' : stk(synlige.length, 'tilbud', 'tilbud')}>
        {synlige.length === 0 ? (
          <p className="kort-hjelp">
            {laster
              ? 'Henter tilbudene …'
              : rader.length === 0
                ? 'Ingen tilbud ennå. De skrives i appen og kan gjøres om til ordre når kunden sier ja.'
                : 'Ingen tilbud passer søket.'}
          </p>
        ) : (
          <table className="linjer">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Nr</th>
                <th>Tittel</th>
                <th>Kunde</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 110 }}>Sendt</th>
                <th style={{ width: 120 }}>Gyldig til</th>
                <th className="h" style={{ width: 70 }}>Linjer</th>
                <th className="h" style={{ width: 130 }}>Sum inkl. mva</th>
              </tr>
            </thead>
            <tbody>
              {synlige.map(t => (
                <tr key={t.id}>
                  <td style={{ color: 'var(--kobber-dyp)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {t.quote_number != null ? `#${t.quote_number}` : '—'}
                  </td>
                  <td style={{ fontWeight: 500 }}>{t.title}</td>
                  <td className="dempet">{t.customer_name ?? '–'}</td>
                  <td><Merke stil={STIL[t.visning]}>{tilbudStatusLabel[t.visning]}</Merke></td>
                  <td className="dempet-mer">{dato(t.sent_at)}</td>
                  {/* Gyldighetsdatoen er grunnen til at et tilbud blir utløpt.
                      Den skal stå ved siden av statusen, ikke i en detalj. */}
                  <td className={t.visning === 'utlopt' ? '' : 'dempet-mer'}
                      style={t.visning === 'utlopt' ? { color: 'var(--gul)' } : undefined}>
                    {dato(t.valid_until)}
                  </td>
                  <td className="h dempet">{antall(t.linjer)}</td>
                  <td className="h" style={{ fontWeight: 500 }}>{formatKr(t.bruttoOre)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Kort>
    </>
  )
}
