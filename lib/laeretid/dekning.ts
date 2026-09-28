/**
 * Avkryssingsregelen — ren logikk, ingen database. Selvtestes i
 * `npm run verify:laeretid`.
 *
 * Dette er produktet. Alt annet kan kopieres.
 *
 * Regelen kom av en opprydding i 28 dokumentasjoner 06.09.2026, der det viste
 * seg at 1.17 sto på tretten logger og 1.19 på nitten uten at noen av dem
 * nevnte temaet i brødteksten. Kryssene var arvet fra malen. Et system som
 * teller merkede logger sier «39 % gjennomført» om en lærling som ikke kan
 * svare på et eneste spørsmål om fire av målene sine.
 *
 * Derfor: et kryss holder bare når brødteksten faktisk redegjør for delen.
 * Hvert kryss må kunne forsvares muntlig på fagprøven. Et kryss uten dekning
 * er en felle, ikke en gevinst.
 *
 * REGELEN ER EN STANDARD, IKKE EN INNSTILLING. Den skal ikke kunne slås av
 * av et opplæringskontor. Kan den det, har vi solgt dem den samme maskinen
 * som produserte tallene vi finnes for å rette.
 */
import type { Del, Kompetansemaal } from './laereplan'

/** Hvor i dokumentasjonen belegget står. */
export type Kilde =
  /** I den løpende teksten, der lærlingen faktisk redegjør. Det eneste som teller. */
  | 'brodtekst'
  /**
   * Risikovurderingstabellen. Bærer 1.2 — tabellen ER risikovurderingen, og en
   * rad som peker på en fare for anlegget med et tiltak er nettopp det målet ber
   * om (avgjort av Tormod 27.09.2026). Bærer ikke 1.3 eller 1.4: de handler om å
   * arbeide sikkert og velge utstyr, og det må stå i teksten.
   */
  | 'risikotabell'
  /** Egenvurderingstabellen («Hva gjorde du bra?»). Kan ikke bære 1.16 eller 1.20. */
  | 'egenvurdering'
  /** Én bisetning som nevner ordet. «Søppelet ble sortert» bærer ikke 1.19. */
  | 'bisetning'
  /** Nærhet til utstyr han ikke gjorde noe med. Kabel fram til spjeldmotor bærer ikke 1.8. */
  | 'naerhet'

/** Resultatet av oppfølgingsspørsmålet om nettopp dette. */
export type Utspurt = 'bestatt' | 'stroket' | null

export type Belegg = {
  loggId: string
  maalNr: number
  delId: string
  kilde: Kilde
  /** Skrevet av modellen og godtatt uendret. Bærer aldri et kryss alene. */
  generert: boolean
  /** Gjorde han det selv, eller redegjorde han bare for det? */
  utfortSelv: boolean
  utspurt?: Utspurt
}

export type Vurdering = { holder: boolean; grunn: string }

const AVVIST: Record<Exclude<Kilde, 'brodtekst'>, string> = {
  risikotabell: 'Står bare i risikovurderingstabellen, som fylles ut i hver logg',
  egenvurdering: 'Står bare i egenvurderingstabellen',
  bisetning: 'Nevnt i en bisetning, ikke redegjort for',
  naerhet: 'Du var i nærheten av utstyret uten å gjøre noe med det',
}

/** 1.2 «risikovurdere anlegg og utstyr» — det eneste målet tabellen kan bære. */
const RISIKOMAAL = 2

/**
 * Holder dette ene belegget?
 *
 * Rekkefølgen på avvisningene er ikke tilfeldig: lærlingen skal få den
 * grunnen som er mest handlingsrettet. At noe står i feil del av dokumentet
 * er viktigere å vite enn at han ikke utførte det selv, for det første kan
 * han rette i kveld.
 */
export function vurderBelegg(del: Del, b: Belegg): Vurdering {
  const tabellenErVurderingen = b.kilde === 'risikotabell' && b.maalNr === RISIKOMAAL
  if (b.kilde !== 'brodtekst' && !tabellenErVurderingen) {
    return { holder: false, grunn: AVVIST[b.kilde] }
  }
  // Når tekst er gratis, er tekst ikke lenger bevis. Det eneste som beviser
  // kompetanse er et svar på et spørsmål du ikke visste kom.
  if (b.generert && b.utspurt !== 'bestatt') {
    // Assistenten skrev teksten; quizen er der han viser at han kan det.
    return { holder: false, grunn: 'Teller når du har tatt quizen om jobben' }
  }
  if (b.utspurt === 'stroket') {
    return { holder: false, grunn: 'Du klarte ikke å forklare det da du ble spurt' }
  }
  // «Selve stigen monterte jeg ikke, men det er verdt å vite hva som gjelder»
  // er riktig skrevet, og gir likevel ikke kryss for føringsvei.
  if (del.kreverUtforelse && !b.utfortSelv) {
    return { holder: false, grunn: 'Du har redegjort for det, ikke utført det' }
  }
  return { holder: true, grunn: 'Redegjort for i brødteksten' }
}

export type DelDekning = {
  delId: string
  navn: string
  holder: boolean
  /** Antall ulike logger som bærer delen. Én logg er tynt uansett hvor god den er. */
  logger: number
}

/**
 * Hvor godt et mål står.
 *
 * `kritisk` finnes fordi et mål som hviler på én eneste logg er sårbart selv
 * når delene formelt er dekket: blir den loggen trukket i tvil, står du igjen
 * med ingenting. Fem av Tormods mål sto slik 06.09.2026.
 */
export type Status = 'holder' | 'dekket' | 'tynt' | 'kritisk' | 'tomt'

export type MaalDekning = {
  maalNr: number
  etikett: string
  status: Status
  deler: DelDekning[]
  dekkede: number
  totalt: number
  logger: number
}

export function dekningForMaal(maal: Kompetansemaal, belegg: Belegg[]): MaalDekning {
  const mine = belegg.filter(b => b.maalNr === maal.nr)

  const deler: DelDekning[] = maal.deler.map(del => {
    const holdende = mine.filter(b => b.delId === del.id && vurderBelegg(del, b).holder)
    return {
      delId: del.id,
      navn: del.navn,
      holder: holdende.length > 0,
      logger: new Set(holdende.map(b => b.loggId)).size,
    }
  })

  const dekkede = deler.filter(d => d.holder).length
  const totalt = deler.length
  const logger = new Set(
    mine.filter(b => {
      const del = maal.deler.find(d => d.id === b.delId)
      return del ? vurderBelegg(del, b).holder : false
    }).map(b => b.loggId),
  ).size

  let status: Status
  if (dekkede === 0) status = 'tomt'
  else if (logger <= 1) status = 'kritisk'
  else if (dekkede === totalt) status = 'holder'
  else if (dekkede * 2 >= totalt) status = 'dekket'
  else status = 'tynt'

  return { maalNr: maal.nr, etikett: maal.etikett, status, deler, dekkede, totalt, logger }
}

/**
 * Advarsel når én logg krysser av for mange mål.
 *
 * Fire til åtte er normalt for en god logg. Tolv er et varselsignal om at
 * tabellene bærer kryssene i stedet for teksten — det var akkurat slik 28
 * logger kom til å se ut som 300 måloppnåelser.
 */
export function varselForLogg(antallMaal: number): string | null {
  if (antallMaal <= 8) return null
  return `${antallMaal} mål på én logg. Fire til åtte er normalt — sjekk at det er brødteksten som bærer kryssene, ikke tabellene.`
}

/**
 * Hva lærlingen skal gjøre med et svakt mål.
 *
 * To slags svakhet ser like ut i en telling, men har helt ulik medisin:
 * mangler jobben, eller mangler forståelsen? Et system som bare teller logger
 * kan ikke skille dem, og gir derfor aldri et råd som er verdt noe.
 */
export type Raad = { slag: 'skaff-jobb' | 'skriv-avsnitt' | 'les-og-ov' | 'ingen'; tekst: string }

export function raadForMaal(maal: Kompetansemaal, d: MaalDekning, belegg: Belegg[]): Raad {
  const stroket = belegg.some(b => b.maalNr === maal.nr && b.utspurt === 'stroket')
  if (stroket) {
    return { slag: 'les-og-ov', tekst: 'Jobben er gjort, men forklaringen sitter ikke. Les og øv — temaet kommer tilbake.' }
  }
  const mangler = d.deler.filter(x => !x.holder)
  if (mangler.length === 0) return { slag: 'ingen', tekst: 'Målet holder.' }

  const krever = (delId: string) => !!maal.deler.find(dd => dd.id === delId)?.kreverUtforelse

  // Jobben først. En del som ikke krever utførelse koster bare et avsnitt i
  // neste logg som er i nærheten — men det rådet skal bare gis når avsnittet
  // faktisk er alt som gjenstår. På et tomt mål er «skriv et avsnitt» å late
  // som, når fire av fem deler krever at han har vært på en slik jobb.
  const manglerJobb = mangler.filter(x => krever(x.delId))
  if (manglerJobb.length > 0) {
    return { slag: 'skaff-jobb', tekst: `Be om en jobb som dekker «${manglerJobb[0].navn}».` }
  }
  return { slag: 'skriv-avsnitt', tekst: `«${mangler[0].navn}» krever ingen ny jobb — bare et avsnitt i neste logg som er i nærheten.` }
}
