/**
 * Dokumentet kunden faktisk får — sluttkontroll, samsvarserklæring, risikovurdering.
 *
 * **I dette faget ER dokumentet leveransen.** En sluttkontroll kunden ikke kan
 * få utlevert er ikke dokumentasjon for kunden; den er en notis hos oss. Denne
 * modulen er veien fra utfylt skjema til noe et menneske kan åpne, skrive ut og
 * arkivere i sin egen perm.
 *
 * ── Hvorfor HTML og ikke et PDF-bibliotek ──────────────────────────────────
 *
 * Både telefonen (`expo-print`) og nettleseren (`window.print()`) lager PDF av
 * HTML uten hjelp. Et PDF-bibliotek ville vært en TREDJE implementasjon av
 * hvordan dokumentet ser ut, ved siden av skjemavisningen i appen og
 * arkivpakken — og tre steder som må enes om utseendet enes ikke.
 *
 * Ren funksjon inn, streng ut. Ingen database, ingen `Date.now()`, ingen
 * plattform-API-er. Selvtestet i `npm run verify:dokument`.
 *
 * ── Hvorfor `skrevetUt` sendes inn ─────────────────────────────────────────
 *
 * Utskriftsdatoen står på arket — den hører hjemme der, for et papir uten dato
 * er et papir ingen vet alderen på. Men den LESES ikke fra klokken her inne.
 * En funksjon som kaller `new Date()` selv kan ikke selvtestes, og kan ikke
 * gjenskape det samme arket to ganger.
 *
 * ── Hva som ALDRI havner her ───────────────────────────────────────────────
 *
 * Interne notater. Kostpriser. Dekningsbidrag. Dette arket kan ende hos en
 * advokat i en tvist, og alt som ikke skal leses av kunden skal ikke kunne
 * havne på det ved et uhell. Modulen tar bare imot det den skal skrive.
 */

/** Firmaet som utsteder dokumentet. Står i toppen — mottakeren må vite hvem. */
export type UtskriftFirma = {
  navn: string
  orgnr?: string | null
  adresse?: string | null
  telefon?: string | null
  epost?: string | null
}

export type UtskriftPunkt = {
  sporsmal: string
  /** Felttypen fra skjemamalen. Styrer hvordan svaret formateres. */
  type: string
  svar: unknown
  enhet?: string | null
  /** For klikklister: hva man KUNNE svart. Uten den er «Nei» uten kontekst. */
  alternativer?: string[] | null
}

export type UtskriftSeksjon = {
  tittel: string
  punkter: UtskriftPunkt[]
}

/** Signaturen lagres som vektorstrøk i 0–1-koordinater, ikke som bilde. */
export type UtskriftSignatur = {
  formaal: string
  signertAv: string
  tittel?: string | null
  signertTid: Date
  strok: { points: [number, number][] }[]
  /** Bredde/høyde-forholdet feltet ble tegnet i. Uten det strekkes signaturen. */
  aspect?: number | null
  merknad?: string | null
}

export type Utskrift = {
  firma: UtskriftFirma
  dokument: {
    tittel: string
    malversjon: number
    status: string
    fullfortAv?: string | null
    fullfortTid?: Date | null
  }
  ordre: {
    nummer: number | null
    tittel: string
    adresse?: string | null
  }
  kunde?: { navn?: string | null; adresse?: string | null } | null
  seksjoner: UtskriftSeksjon[]
  signaturer: UtskriftSignatur[]
  /** Sendes inn, leses aldri fra klokken. Se toppen av fila. */
  skrevetUt: Date
}

/**
 * Escaper alt som skal inn i HTML.
 *
 * Ikke valgfritt: et kundenavn med `&` eller en merknad med `<` ville ellers
 * ødelagt dokumentet — i beste fall visuelt, i verste fall ved at tekst
 * forsvinner ut av arket uten at noen ser det. Alt brukerinnhold går gjennom
 * denne, uten unntak.
 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
const DATOTID = new Intl.DateTimeFormat('nb-NO', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

/**
 * Svaret slik det skal LESES på papir.
 *
 * Et ubesvart punkt skrives «Ikke besvart» og skjules ikke. At noe ikke ble
 * krysset av er også dokumentasjon — og et ark som bare viser de utfylte
 * punktene ser mer komplett ut enn jobben var. Samme regel som arkivpakken.
 */
export function formatterSvar(p: UtskriftPunkt): string {
  const v = p.svar

  if (v === null || v === undefined || v === '') return '—'

  // Tabellsvar (kursfortegnelse, måleprotokoll) er en liste av rader.
  if (Array.isArray(v)) {
    if (v.length === 0) return '—'
    return v
      .map(rad =>
        typeof rad === 'object' && rad !== null
          ? Object.values(rad as Record<string, unknown>).filter(x => x !== '' && x != null).join(' · ')
          : String(rad),
      )
      .filter(Boolean)
      .join('\n')
  }

  const s = String(v)
  return p.enhet ? `${s} ${p.enhet}` : s
}

/** Strøkene → én SVG-path i 0–1-rommet. Ingen bildefil, ingen ekstern ressurs. */
function signaturSvg(sig: UtskriftSignatur): string {
  const aspect = sig.aspect && sig.aspect > 0 ? sig.aspect : 3
  const h = 100
  const w = Math.round(h * aspect)

  const d = sig.strok
    .filter(s => s.points.length > 0)
    .map(s =>
      s.points
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * w).toFixed(1)} ${(y * h).toFixed(1)}`)
        .join(' '),
    )
    .join(' ')

  if (!d) return '<div class="sig-tom">Ingen strøk registrert</div>'

  return `<svg class="sig-strek" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Signatur">`
    + `<path d="${d}" fill="none" stroke="#2E281F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    + '</svg>'
}

function faktalinje(navn: string, verdi: string | null | undefined): string {
  if (!verdi) return ''
  return `<div class="fakta-rad"><span class="fakta-navn">${esc(navn)}</span><span class="fakta-verdi">${esc(verdi)}</span></div>`
}

/**
 * Bygger hele dokumentet som én selvstendig HTML-streng.
 *
 * Alt er inline: ingen eksterne fonter, ingen bilder, ingen stilark. Et
 * dokument som ser annerledes ut fordi et nettverkskall feilet, er ikke et
 * dokument man kan arkivere — samme regel som e-postmalene i
 * `supabase/templates/`.
 */
export function byggUtskriftHtml(u: Utskrift): string {
  const ferdig = u.dokument.status === 'ferdig' || u.dokument.status === 'fullfort'

  const seksjoner = u.seksjoner
    .map(s => {
      const rader = s.punkter
        .map(p => {
          const svar = formatterSvar(p)
          const tomt = svar === '—'
          return '<tr class="punkt">'
            + `<td class="sp">${esc(p.sporsmal)}</td>`
            + `<td class="sv${tomt ? ' sv-tom' : ''}">${tomt ? 'Ikke besvart' : esc(svar).replace(/\n/g, '<br>')}</td>`
            + '</tr>'
        })
        .join('')
      return `<section class="seksjon"><h2>${esc(s.tittel)}</h2><table class="punkter">${rader}</table></section>`
    })
    .join('')

  const signaturer = u.signaturer.length === 0
    ? ''
    : '<section class="seksjon signaturer"><h2>Signaturer</h2>'
      + u.signaturer
        .map(sig =>
          '<div class="sig">'
          + signaturSvg(sig)
          + '<div class="sig-under">'
          + `<div class="sig-navn">${esc(sig.signertAv)}${sig.tittel ? ` — ${esc(sig.tittel)}` : ''}</div>`
          + `<div class="sig-meta">${esc(sig.formaal)} · ${esc(DATOTID.format(sig.signertTid))}</div>`
          + (sig.merknad ? `<div class="sig-meta">${esc(sig.merknad)}</div>` : '')
          + '</div></div>',
        )
        .join('')
      + '</section>'

  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<title>${esc(u.dokument.tittel)}${u.ordre.nummer != null ? ` — ordre ${u.ordre.nummer}` : ''}</title>
<style>
  /* A4 med romslig marg: arket skal kunne hulles og settes i en perm uten at
     tekst havner i hullene. */
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #2E281F;
    background: #FFFFFF;
  }
  /* Paa skjerm skal arket se ut som ARKET. Uten dette flyter svarkolonnen ut
     til hoyre i et bredt vindu, og den som ser gjennom dokumentet for han
     sender det ser noe annet enn det kunden faar. */
  @media screen {
    body { max-width: 210mm; margin: 0 auto; padding: 18mm 16mm; background: #FFFFFF; }
    html { background: #EFEAE1; padding: 12px 0; }
  }
  header { border-bottom: 2px solid #2E281F; padding-bottom: 10px; margin-bottom: 18px; }
  .merke { font-size: 8pt; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: #A97C4F; }
  h1 { margin: 6px 0 2px; font-size: 19pt; line-height: 1.2; letter-spacing: -0.3px; }
  .undertittel { font-size: 9.5pt; color: #5C5340; }
  .firma { margin-top: 10px; font-size: 9pt; color: #5C5340; }

  .fakta { margin-bottom: 20px; }
  .fakta-rad { display: flex; gap: 12px; padding: 3px 0; }
  .fakta-navn { width: 42mm; flex: none; color: #5C5340; font-size: 9.5pt; }
  .fakta-verdi { font-weight: 500; }

  /* En overskrift alene nederst på siden er en overskrift uten innhold. */
  .seksjon { margin-bottom: 20px; break-inside: auto; }
  h2 {
    font-size: 11.5pt; margin: 0 0 8px; padding-bottom: 4px;
    border-bottom: 1px solid #DED6C7; break-after: avoid; page-break-after: avoid;
  }
  table.punkter { width: 100%; border-collapse: collapse; }
  /* Spørsmål og svar skal aldri skilles av et sideskift. */
  tr.punkt { break-inside: avoid; page-break-inside: avoid; }
  td { padding: 5px 0; border-bottom: 1px solid #EFEAE1; vertical-align: top; }
  td.sp { width: 62%; padding-right: 12px; color: #2E281F; }
  td.sv { font-weight: 500; }
  td.sv-tom { color: #9A8E76; font-weight: 400; font-style: italic; }

  .sig { break-inside: avoid; page-break-inside: avoid; margin-bottom: 16px; }
  .sig-strek { height: 22mm; max-width: 90mm; display: block; }
  .sig-tom { height: 22mm; display: flex; align-items: center; color: #9A8E76; font-style: italic; }
  .sig-under { border-top: 1px solid #2E281F; padding-top: 4px; max-width: 90mm; }
  .sig-navn { font-weight: 600; }
  .sig-meta { font-size: 9pt; color: #5C5340; }

  footer {
    margin-top: 22px; padding-top: 8px; border-top: 1px solid #DED6C7;
    font-size: 8.5pt; color: #776B55;
  }
  .utkast {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    background: #FBF3E4; border: 1px solid #D8B24A; color: #6B5210;
    font-size: 9pt; font-weight: 600;
  }
</style>
</head>
<body>
<header>
  <div class="merke">${esc(u.firma.navn)}</div>
  <h1>${esc(u.dokument.tittel)}</h1>
  <div class="undertittel">
    ${u.ordre.nummer != null ? `Ordre ${esc(u.ordre.nummer)} · ` : ''}${esc(u.ordre.tittel)}
  </div>
  <div class="firma">
    ${[u.firma.adresse, u.firma.orgnr ? `Org.nr ${u.firma.orgnr}` : null, u.firma.telefon, u.firma.epost]
      .filter(Boolean).map(x => esc(x)).join(' · ')}
  </div>
</header>

${!ferdig ? '<p><span class="utkast">Utkast — dokumentet er ikke ferdigstilt</span></p>' : ''}

<div class="fakta">
  ${faktalinje('Kunde', u.kunde?.navn)}
  ${faktalinje('Anleggsadresse', u.ordre.adresse ?? u.kunde?.adresse)}
  ${faktalinje('Utført av', u.dokument.fullfortAv)}
  ${faktalinje('Dato', u.dokument.fullfortTid ? DATO.format(u.dokument.fullfortTid) : null)}
</div>

${seksjoner}
${signaturer}

<footer>
  Skrevet ut ${esc(DATO.format(u.skrevetUt))} fra Ampex ·
  ${esc(u.dokument.tittel)} versjon ${esc(u.dokument.malversjon)}
</footer>
</body>
</html>`
}
