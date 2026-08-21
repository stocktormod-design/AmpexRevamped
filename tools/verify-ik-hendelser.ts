/**
 * Selvtest for historikken på et internkontrollpunkt.
 *
 *   npm run verify:ik-hendelser
 *
 * Historikken er bevis. Teller den dobbelt, ser det ut som rutinen ble endret
 * to ganger. Kaller den en vanlig lagring for «gjennomgått», ser det ut som
 * noen kontrollerte punktet en dag de bare rettet en skrivefeil. Begge deler er
 * feil i den dokumentasjonen firmaet legger fram på tilsyn.
 */
import { byggHistorikk, tolkAudit, type Auditrad, type Revisjonsrad } from '../lib/ik/hendelser'

let feil = 0

function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

function audit(over: Partial<Auditrad>): Auditrad {
  return {
    id: 'a1',
    actor_name: 'Per Installatør',
    operasjon: 'update',
    endringer: null,
    skjedde_at: '2026-08-21T10:00:00.000Z',
    ...over,
  }
}

const endring = (fra: unknown, til: unknown) => ({ fra, til })

// ── Opprettelse og sletting ────────────────────────────────────────────────

sjekk('insert blir «Opprettet»', tolkAudit(audit({ operasjon: 'insert', endringer: { nummer: '1' } }))?.tekst, 'Opprettet')
sjekk('delete blir «Slettet»', tolkAudit(audit({ operasjon: 'delete' }))?.tekst, 'Slettet')
sjekk(
  'soft delete er også en sletting',
  tolkAudit(audit({ endringer: { deleted_at: endring(null, '2026-08-21T10:00:00Z') } }))?.tekst,
  'Slettet',
)

// ── Vedtaket ──────────────────────────────────────────────────────────────

// `vedta()` setter status, vedtatt_at, vedtatt_av OG sist_gjennomgatt i samme
// oppdatering. Hendelsen er vedtaket, ikke «endret fire felt».
const vedtak = audit({
  endringer: {
    status: endring('utkast', 'vedtatt'),
    vedtatt_at: endring(null, '2026-08-21T10:00:00Z'),
    vedtatt_av: endring(null, 'u1'),
    sist_gjennomgatt: endring(null, '2026-08-21'),
  },
})
sjekk('vedtaket leses som ett vedtak', tolkAudit(vedtak)?.slag, 'vedtatt')
sjekk('og ikke som fire endrede felt', tolkAudit(vedtak)?.tekst, 'Vedtatt')
sjekk(
  'utgått status har sin egen tekst',
  tolkAudit(audit({ endringer: { status: endring('vedtatt', 'utgatt') } }))?.tekst,
  'Satt som utgått',
)

// ── Gjennomgang uten endring ──────────────────────────────────────────────

// Dette er den levende delen: faglig ansvarlig leser gjennom, finner rutinen
// fortsatt riktig, og flytter fristen. Ingen revisjon, men det ER en hendelse.
sjekk(
  'bare gjennomgangsdato endret er en kvittering',
  tolkAudit(audit({ endringer: { sist_gjennomgatt: endring('2025-08-21', '2026-08-21') } }))?.slag,
  'gjennomgang',
)

// Er noe annet med, var det ikke bare en gjennomgang, og da skal den ikke
// utgi seg for å være det.
sjekk(
  'gjennomgangsdato sammen med noe annet er en vanlig endring',
  tolkAudit(audit({ endringer: { sist_gjennomgatt: endring('a', 'b'), ansvarlig: endring('x', 'y') } }))?.slag,
  'endret',
)

// ── Dobbelttellingen ──────────────────────────────────────────────────────

// En lagring skriver BÅDE en revisjonsrad og en audit-rad. Audit-raden bumper
// `gjeldende_versjon`, og det er kjennetegnet vi bruker for å droppe den.
const lagring = audit({
  endringer: {
    innhold: endring('gammel', 'ny'),
    gjeldende_versjon: endring(1, 2),
  },
})
sjekk('en lagring fortelles av revisjonen, ikke av auditen', tolkAudit(lagring), null)
sjekk(
  'samme gjelder skjemamaler (current_version)',
  tolkAudit(audit({ endringer: { title: endring('a', 'b'), current_version: endring(1, 2) } })),
  null,
)

sjekk('en tom endringsmengde gir ingen hendelse', tolkAudit(audit({ endringer: {} })), null)
sjekk('null gir ingen hendelse', tolkAudit(audit({ endringer: null })), null)

// ── Vanlige endringer får menneskelige feltnavn ───────────────────────────

sjekk(
  'feltnavnene oversettes',
  tolkAudit(audit({ endringer: { innhold: endring('a', 'b'), hjemmel: endring('c', 'd') } }))?.tekst,
  'Endret rutinen, hjemmelen',
)
sjekk(
  'ukjent felt vises som det heter, ikke som ingenting',
  tolkAudit(audit({ endringer: { noe_nytt: endring(1, 2) } }))?.tekst,
  'Endret noe_nytt',
)

// ── Den sammenslåtte historikken ──────────────────────────────────────────

const revisjoner: Revisjonsrad[] = [
  { id: 'r2', versjon: 2, endringsnotat: 'Presisert at måling skal loggføres', endret_av_navn: 'Per', created_at: '2026-08-20T09:00:00.000Z' },
  { id: 'r3', versjon: 3, endringsnotat: 'Lagt til krav om isolasjonsmåling', endret_av_navn: 'Per', created_at: '2026-08-21T09:00:00.000Z' },
]

const auditrader: Auditrad[] = [
  audit({ id: 'a-opprett', operasjon: 'insert', skjedde_at: '2026-08-19T08:00:00.000Z', endringer: { nummer: '3' } }),
  audit({ id: 'a-lagring2', skjedde_at: '2026-08-20T09:00:00.000Z', endringer: { innhold: endring('a', 'b'), gjeldende_versjon: endring(1, 2) } }),
  audit({ id: 'a-vedtak', skjedde_at: '2026-08-20T10:00:00.000Z', endringer: { status: endring('utkast', 'vedtatt') } }),
  audit({ id: 'a-lagring3', skjedde_at: '2026-08-21T09:00:00.000Z', endringer: { innhold: endring('b', 'c'), gjeldende_versjon: endring(2, 3) } }),
  audit({ id: 'a-gjennomgang', skjedde_at: '2026-08-21T11:00:00.000Z', endringer: { sist_gjennomgatt: endring('2026-08-20', '2026-08-21') } }),
]

const h = byggHistorikk(revisjoner, auditrader)

sjekk('to lagringer + tre hendelser gir fem linjer, ikke sju', h.length, 5)
sjekk(
  'nyeste først',
  h.map(x => x.slag),
  ['gjennomgang', 'revisjon', 'vedtatt', 'revisjon', 'opprettet'],
)
sjekk('revisjonene bærer begrunnelsen', h[1].tekst, 'Lagt til krav om isolasjonsmåling')
sjekk('og versjonsnummeret', h[1].versjon, 3)
sjekk('audit-hendelser har ingen versjon', h[0].versjon, undefined)
sjekk('id-ene er unike, så React ikke blander radene', new Set(h.map(x => x.id)).size, h.length)

sjekk('uten noe som helst blir historikken tom', byggHistorikk([], []), [])
sjekk('bare revisjoner virker også', byggHistorikk(revisjoner, []).length, 2)

console.log(feil === 0 ? '\nAlle påstander holder.' : `\n${feil} påstander feilet.`)
process.exit(feil === 0 ? 0 : 1)
