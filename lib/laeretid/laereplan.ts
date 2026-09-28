/**
 * Læreplanen — kompetansemålene ordrett, og delinndelingen oppå dem.
 *
 * TEKSTEN ER FORSKRIFT OG SKAL IKKE REDIGERES. Den er hentet fra Udir og
 * kontrollert mot opplæringsplanen fagbrev.io leverer (16.09.2026): de er
 * ordrett like, og «1.1»–«1.20» er fagbrev.io sin nummerering satt foran
 * Udirs tekst. Alle elektrikerlærlinger i Norge har nøyaktig disse tjue.
 *
 * Derfor:
 *   - `tekst` skrives ALDRI av for hånd og kan ikke endres av et kontor.
 *     Gjør man det, stryker noen på fagprøven på vårt ord.
 *   - `deler` er VÅR inndeling, utledet av teksten. Den er finere enn noe
 *     kontorene deler ut, og den er der produktet faktisk måler.
 *   - Nummereringen er en etikett. Nøkkelen er læreplankoden + løpenummer,
 *     slik at et kontor kan kalle 1.5 hva de vil uten at noe brekker.
 *
 * Fire deler manglet i den håndskrevne mållista som ble ført gjennom 28
 * logger, og er merket `oversettI2026` nedenfor: ekomutstyr (1.5), kablet
 * utstyr (1.7), energiøkonomi (1.9) og «reflektere rundt mulige endringer»
 * (1.20). To av dem ligger på de tynneste målene.
 */

/** ELE03-03 gjaldt fra 01.08.2022. ELE03-04 avløste den 01.01.2026. */
export type Laereplankode = 'ELE03-03' | 'ELE03-04'

export type Del = {
  /** Stabil nøkkel innenfor målet. Endres aldri — dekning henger på den. */
  id: string
  navn: string
  /**
   * Krever delen at han GJORDE det selv?
   *
   * Skillet er hentet fra praksis: en del han bare har redegjort for kan ikke
   * krysses av. Å legge kabel på ferdig montert bro dekker kabelforlegning,
   * ikke føringsvei.
   *
   * Men det motsatte gjelder også, og glemmes oftere: «gjøre rede for»- og
   * «vurdere»-deler ER redegjørelse. Et dimensjoneringsregnestykke teller selv
   * om kursen var prosjektert og han ikke koblet den, så lenge det står
   * tydelig at regnestykket er hans egen vurdering.
   */
  kreverUtforelse: boolean
  /** Del som manglet i den håndskrevne lista, funnet 16.09.2026. */
  oversettI2026?: true
}

export type Kompetansemaal = {
  /** Løpenummer 1–20. Stabil. */
  nr: number
  /** Etiketten kontoret bruker. Fagbrev.io skriver «1.5». Ren presentasjon. */
  etikett: string
  /** ORDRETT fra Udir. Ikke rediger. */
  tekst: string
  deler: Del[]
}

export type Laereplan = {
  kode: Laereplankode
  navn: string
  gyldigFra: string
  maal: Kompetansemaal[]
}

const MAAL: Kompetansemaal[] = [
  {
    nr: 1, etikett: '1.1',
    tekst: 'planlegge, gjennomføre og dokumentere arbeidsoppdragene individuelt og i samarbeid med andre i henhold til gjeldende regelverk og bedriftens internkontrollsystem, og begrunne valgene som er gjort',
    deler: [
      { id: 'planlegge', navn: 'Planlegge', kreverUtforelse: true },
      { id: 'gjennomfore', navn: 'Gjennomføre', kreverUtforelse: true },
      { id: 'dokumentere', navn: 'Dokumentere', kreverUtforelse: true },
      { id: 'samarbeid', navn: 'Individuelt og i samarbeid', kreverUtforelse: true },
      { id: 'regelverk', navn: 'Regelverk og internkontrollsystem', kreverUtforelse: false },
      { id: 'begrunne', navn: 'Begrunne valgene', kreverUtforelse: false },
    ],
  },
  {
    nr: 2, etikett: '1.2',
    tekst: 'risikovurdere anlegg og utstyr med hensyn til beskyttelse mot elektrisk sjokk, overstrøm, overspenning, brann, elektromagnetisk støy og ytre påvirkninger',
    deler: [
      { id: 'sjokk', navn: 'Elektrisk sjokk', kreverUtforelse: false },
      { id: 'overstrom', navn: 'Overstrøm', kreverUtforelse: false },
      { id: 'overspenning', navn: 'Overspenning', kreverUtforelse: false },
      { id: 'brann', navn: 'Brann', kreverUtforelse: false },
      { id: 'emstoy', navn: 'Elektromagnetisk støy', kreverUtforelse: false },
      { id: 'ytre', navn: 'Ytre påvirkninger', kreverUtforelse: false },
    ],
  },
  {
    nr: 3, etikett: '1.3',
    tekst: 'arbeide med hensyn til sikkerhet ved arbeid i og drift av elektriske anlegg, utføre livreddende førstehjelp, arbeide i tråd med ergonomiske prinsipper, bruke verneutstyr og drøfte hvordan sikkerhetsarbeid kan forebygge ulykker og skader',
    deler: [
      { id: 'sikkerhet', navn: 'Sikkerhet i og drift av anlegg', kreverUtforelse: true },
      { id: 'forstehjelp', navn: 'Livreddende førstehjelp', kreverUtforelse: true },
      { id: 'ergonomi', navn: 'Ergonomiske prinsipper', kreverUtforelse: true },
      { id: 'verneutstyr', navn: 'Bruke verneutstyr', kreverUtforelse: true },
      { id: 'forebygge', navn: 'Drøfte forebygging av ulykker', kreverUtforelse: false },
    ],
  },
  {
    nr: 4, etikett: '1.4',
    tekst: 'velge egnet verktøy og verneutstyr til arbeidsoppdragene og gjøre rede for vedlikeholdsrutinene for verktøy og verneutstyr i bedriftens internkontrollsystem',
    deler: [
      { id: 'verktoyvalg', navn: 'Velge egnet verktøy', kreverUtforelse: true },
      { id: 'verneutstyrvalg', navn: 'Velge verneutstyr', kreverUtforelse: true },
      { id: 'vedlikehold', navn: 'Vedlikeholdsrutiner', kreverUtforelse: false },
    ],
  },
  {
    nr: 5, etikett: '1.5',
    tekst: 'montere og sette i drift ulike fordelingssystemer fra inntak til belastning med tilhørende målearrangement, ekomutstyr og jordingssystem, dimensjonere ledning, kabel og vern og vurdere behov for kompenserende tiltak med hensyn til effektfaktor ved inntak',
    deler: [
      { id: 'montere', navn: 'Montere fordelingssystem', kreverUtforelse: true },
      { id: 'idriftsette', navn: 'Sette i drift', kreverUtforelse: true },
      { id: 'maalearrangement', navn: 'Målearrangement', kreverUtforelse: true },
      { id: 'ekomutstyr', navn: 'Ekomutstyr', kreverUtforelse: true, oversettI2026: true },
      { id: 'jording', navn: 'Jordingssystem', kreverUtforelse: true },
      // Regnestykket er hans egen vurdering og teller selv om kursen var
      // prosjektert og han ikke koblet den.
      { id: 'dimensjonere', navn: 'Dimensjonere ledning, kabel og vern', kreverUtforelse: false },
      { id: 'effektfaktor', navn: 'Effektfaktor ved inntak', kreverUtforelse: false },
    ],
  },
  {
    nr: 6, etikett: '1.6',
    tekst: 'montere, sette i drift og konfigurere ulike brukertilpassede og energieffektive installasjoner for lys, varme og variabel last med styringsutstyr og sensorer, vurdere og iverksette tiltak mot elektromagnetisk støy og gjøre rede for bygningers energikarakter og energimerking av utstyr',
    deler: [
      { id: 'lysvarmelast', navn: 'Lys, varme og variabel last', kreverUtforelse: true },
      { id: 'styring', navn: 'Styringsutstyr og sensorer', kreverUtforelse: true },
      { id: 'emstoy', navn: 'Tiltak mot elektromagnetisk støy', kreverUtforelse: true },
      { id: 'energimerking', navn: 'Energikarakter og energimerking', kreverUtforelse: false },
    ],
  },
  {
    nr: 7, etikett: '1.7',
    tekst: 'montere og konfigurere nettverkstilknyttet radiobasert og kablet utstyr for brukertilpassede og energieffektive installasjoner og beskrive hvordan datasikkerhet og personvern er ivaretatt',
    deler: [
      { id: 'nettverkstilknyttet', navn: 'Nettverkstilknyttet utstyr', kreverUtforelse: true },
      { id: 'radiobasert', navn: 'Radiobasert utstyr', kreverUtforelse: true },
      { id: 'kablet', navn: 'Kablet utstyr', kreverUtforelse: true, oversettI2026: true },
      { id: 'datasikkerhet', navn: 'Datasikkerhet og personvern', kreverUtforelse: false },
    ],
  },
  {
    nr: 8, etikett: '1.8',
    tekst: 'montere, programmere og konfigurere styringssystemer for motor med regulator og sensordata for å oppnå ønsket resultat, og vurdere og iverksette tiltak mot elektromagnetisk støy',
    deler: [
      { id: 'motorstyring', navn: 'Montere motorstyring', kreverUtforelse: true },
      { id: 'programmering', navn: 'Programmere og konfigurere', kreverUtforelse: true },
      { id: 'emstoy', navn: 'Tiltak mot elektromagnetisk støy', kreverUtforelse: true },
    ],
  },
  {
    nr: 9, etikett: '1.9',
    tekst: 'montere og konfigurere anlegg for lokal energiproduksjon med energilagring, laststyring og energileveranse til nett og gjøre rede for hvordan dette påvirker anleggets energiøkonomi',
    deler: [
      { id: 'energiproduksjon', navn: 'Lokal energiproduksjon', kreverUtforelse: true },
      { id: 'energilagring', navn: 'Energilagring', kreverUtforelse: true },
      { id: 'laststyring', navn: 'Laststyring', kreverUtforelse: true },
      { id: 'nettleveranse', navn: 'Energileveranse til nett', kreverUtforelse: true },
      // Ren redegjørelse. Krever ingen jobb — bare et avsnitt.
      { id: 'energiokonomi', navn: 'Anleggets energiøkonomi', kreverUtforelse: false, oversettI2026: true },
    ],
  },
  {
    nr: 10, etikett: '1.10',
    tekst: 'montere og konfigurere nød- og reservestrømforsyningsanlegg, avbruddsfrie strømforsyningsanlegg og koblingsutstyr for prioriterte laster og gjøre rede for farer forbundet med arbeid på batterianlegg',
    deler: [
      { id: 'nodstrom', navn: 'Nød- og reservestrøm', kreverUtforelse: true },
      { id: 'ups', navn: 'Avbruddsfri strømforsyning', kreverUtforelse: true },
      { id: 'prioriterte', navn: 'Koblingsutstyr for prioriterte laster', kreverUtforelse: true },
      { id: 'batterifarer', navn: 'Farer ved arbeid på batterianlegg', kreverUtforelse: false },
    ],
  },
  {
    nr: 11, etikett: '1.11',
    tekst: 'montere og konfigurere brannalarm og adgangs- og sikkerhetssystemer og vurdere ulike typer detektorer og alarmgivere og plasseringen deres',
    deler: [
      { id: 'brannalarm', navn: 'Brannalarm', kreverUtforelse: true },
      { id: 'adgang', navn: 'Adgangs- og sikkerhetssystemer', kreverUtforelse: true },
      { id: 'detektorer', navn: 'Detektorer, alarmgivere og plassering', kreverUtforelse: false },
    ],
  },
  {
    nr: 12, etikett: '1.12',
    tekst: 'montere føringsvei og installere ledning, kabel og fiber i henhold til krav til forlegning, og gjøre rede for hvordan forlegning påvirker strømføringsevne og transmisjonsegenskaper',
    deler: [
      // Å legge kabel på ferdig montert bro dekker forlegning, ikke føringsvei.
      { id: 'foringsvei', navn: 'Montere føringsvei', kreverUtforelse: true },
      { id: 'forlegning', navn: 'Installere ledning, kabel og fiber', kreverUtforelse: true },
      { id: 'iz', navn: 'Forlegningens virkning på strømføringsevne', kreverUtforelse: false },
      { id: 'transmisjon', navn: 'Transmisjonsegenskaper', kreverUtforelse: false },
    ],
  },
  {
    nr: 13, etikett: '1.13',
    tekst: 'skjøte og terminere ulike kabler og andre ledende forbindelser ved bruk av egnet metode, verktøy, pressutstyr og tiltrekkingsmoment, og gjøre rede for materialenes mekaniske og kjemiske egenskaper',
    deler: [
      { id: 'skjote', navn: 'Skjøte og terminere', kreverUtforelse: true },
      { id: 'metode', navn: 'Egnet metode og verktøy', kreverUtforelse: true },
      { id: 'moment', navn: 'Pressutstyr og tiltrekkingsmoment', kreverUtforelse: true },
      { id: 'materiale', navn: 'Materialenes egenskaper', kreverUtforelse: false },
    ],
  },
  {
    nr: 14, etikett: '1.14',
    tekst: 'foreta systematisk feilsøking, reparasjoner og vedlikehold på elektriske anlegg og utstyr og vurdere lønnsomheten til reparasjoner',
    deler: [
      { id: 'feilsoking', navn: 'Systematisk feilsøking', kreverUtforelse: true },
      { id: 'reparasjon', navn: 'Reparasjoner', kreverUtforelse: true },
      { id: 'vedlikehold', navn: 'Vedlikehold', kreverUtforelse: true },
      { id: 'lonnsomhet', navn: 'Lønnsomheten til reparasjoner', kreverUtforelse: false },
    ],
  },
  {
    nr: 15, etikett: '1.15',
    tekst: 'vurdere tilstand og kvalitet på installasjoner og anbefale utbedringer og forbedringer i funksjon, sikkerhet og energieffektivitet',
    deler: [
      { id: 'tilstand', navn: 'Vurdere tilstand og kvalitet', kreverUtforelse: false },
      { id: 'funksjon', navn: 'Utbedringer i funksjon', kreverUtforelse: false },
      { id: 'sikkerhet', navn: 'Utbedringer i sikkerhet', kreverUtforelse: false },
      { id: 'energi', navn: 'Utbedringer i energieffektivitet', kreverUtforelse: false },
    ],
  },
  {
    nr: 16, etikett: '1.16',
    tekst: 'diskutere verdien av å oppleve mestring og stolthet over eget arbeid og av å oppleve tilhørighet og trygghet i et arbeidsmiljø uavhengig av kjønn og kultur',
    deler: [
      { id: 'mestring', navn: 'Mestring og stolthet over eget arbeid', kreverUtforelse: false },
      { id: 'tilhorighet', navn: 'Tilhørighet og trygghet i arbeidsmiljøet', kreverUtforelse: false },
      { id: 'mangfold', navn: 'Uavhengig av kjønn og kultur', kreverUtforelse: false },
    ],
  },
  {
    nr: 17, etikett: '1.17',
    tekst: 'reflektere over bedriftsdemokratiets og det organiserte arbeidslivets forutsetninger, verdier og regler og hvordan et regulert arbeidsliv kan bidra til å motvirke arbeidslivskriminalitet, diskriminering og forskjellbehandling',
    deler: [
      { id: 'bedriftsdemokrati', navn: 'Bedriftsdemokrati', kreverUtforelse: false },
      { id: 'organisert', navn: 'Det organiserte arbeidslivet', kreverUtforelse: false },
      { id: 'kriminalitet', navn: 'Arbeidslivskriminalitet', kreverUtforelse: false },
      { id: 'diskriminering', navn: 'Diskriminering og forskjellsbehandling', kreverUtforelse: false },
    ],
  },
  {
    nr: 18, etikett: '1.18',
    tekst: 'drøfte etiske dilemmaer ved valg av elektriske produkter og løsninger og diskutere bærekraft og konsekvenser av ressursbruk lokalt, regionalt og globalt',
    deler: [
      { id: 'dilemmaer', navn: 'Etiske dilemmaer ved produktvalg', kreverUtforelse: false },
      { id: 'baerekraft', navn: 'Bærekraft', kreverUtforelse: false },
      { id: 'ressursbruk', navn: 'Ressursbruk lokalt, regionalt og globalt', kreverUtforelse: false },
    ],
  },
  {
    nr: 19, etikett: '1.19',
    tekst: 'håndtere avfall etter eget arbeid på en miljømessig og økonomisk riktig måte, drøfte produkters miljøprestasjon og slette sensitiv informasjon ved avhending',
    deler: [
      // «Søppelet ble sortert» i en tabellrad bærer ikke dette. Fraksjoner i
      // brødteksten gjør det.
      { id: 'avfall', navn: 'Håndtere avfall etter eget arbeid', kreverUtforelse: true },
      { id: 'miljoprestasjon', navn: 'Produkters miljøprestasjon', kreverUtforelse: false },
      { id: 'sletting', navn: 'Slette sensitiv informasjon ved avhending', kreverUtforelse: true },
    ],
  },
  {
    nr: 20, etikett: '1.20',
    tekst: 'dokumentere eget arbeid, vurdere arbeidsmetoder, faglige løsninger, kvalitet og estetikk i arbeidsoppdraget, foreslå forbedringer og reflektere rundt mulige endringer',
    deler: [
      { id: 'dokumentere', navn: 'Dokumentere eget arbeid', kreverUtforelse: true },
      { id: 'arbeidsmetoder', navn: 'Vurdere arbeidsmetoder', kreverUtforelse: false },
      { id: 'losninger', navn: 'Faglige løsninger', kreverUtforelse: false },
      { id: 'kvalitet', navn: 'Kvalitet og estetikk', kreverUtforelse: false },
      { id: 'forbedringer', navn: 'Foreslå forbedringer', kreverUtforelse: false },
      { id: 'endringer', navn: 'Reflektere rundt mulige endringer', kreverUtforelse: false, oversettI2026: true },
    ],
  },
]

/**
 * ELE03-03 og ELE03-04 har samme tjue mål, ordrett. Forskjellen mellom
 * utgavene ligger andre steder i læreplanen. De holdes likevel som egne
 * planer: en lærling følger den planen lærekontrakten hans gjelder under, og
 * den dagen målene faktisk endres skal ingen historikk flyttes.
 */
export const LAEREPLANER: Laereplan[] = [
  { kode: 'ELE03-03', navn: 'Vg3 elektrikerfaget', gyldigFra: '2022-08-01', maal: MAAL },
  { kode: 'ELE03-04', navn: 'Vg3 elektrikerfaget', gyldigFra: '2026-01-01', maal: MAAL },
]

export function laereplan(kode: Laereplankode): Laereplan {
  const funnet = LAEREPLANER.find(p => p.kode === kode)
  if (!funnet) throw new Error(`Ukjent læreplan: ${kode}`)
  return funnet
}

/** Global nøkkel for en del: «ELE03-03/5/ekomutstyr». Aldri etiketten. */
export function delNokkel(kode: Laereplankode, maalNr: number, delId: string): string {
  return `${kode}/${maalNr}/${delId}`
}

export function finnMaal(kode: Laereplankode, nr: number): Kompetansemaal {
  const funnet = laereplan(kode).maal.find(m => m.nr === nr)
  if (!funnet) throw new Error(`Ukjent kompetansemål: ${kode}/${nr}`)
  return funnet
}
