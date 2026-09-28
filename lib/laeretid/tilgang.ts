/**
 * Hvem får se en lærlings læretid. Ren logikk, ingen database.
 * Selvtestes i `npm run verify:laeretid`.
 *
 * **`company_id` kan ikke uttrykke dette, og det er hele poenget.**
 *
 * Koordinatoren hører til opplæringskontoret (TENK Lofoten SA) og er satt på
 * lærlinger hos flere ulike bedrifter samtidig — Aqila, Lofoten Elektro og
 * andre. Plasserer man ham i ett firma, mister han de andre. RLS per firma,
 * som resten av Ampex bygger på, isolerer nettopp det han skal krysse.
 *
 * Derfor eier LÆRLINGEN dataene sine, og tilgang gis gjennom en tilknytning:
 * én rad per par av lærling og person, med hvilken rolle personen har for
 * NETTOPP den lærlingen, og gyldig fra/til.
 *
 * Det løser to ting på én gang: en lærling uten Ampex-bedrift kan eksistere,
 * og en lærling som bytter bedrift tar historikken sin med seg i stedet for å
 * migrere den.
 *
 * ── Løftet dette bærer ──────────────────────────────────────────────────────
 * Registreringsskjermen sier at kladdene, quizsvarene og profilen er hans
 * alene. De som følger ham leser den FERDIGE loggen, aldri veien fram til den.
 * Går den grensen feil vei, skriver lærlingen for sjefen fra dag én, og da er
 * hvert eneste tall i produktet verdiløst. Derfor er den testet.
 *
 * **Dette er ikke sikkerhetsmodellen.** RLS i basen er det. Denne modulen er
 * den ene sannheten om hva som SKAL være lov, slik at RLS-policyene og UI-et
 * kan skrives mot noe som er lest gjennom og prøvd.
 */

/** Hva en person er FOR en bestemt lærling. Ikke en global rolle. */
export type Tilknytningsrolle =
  /** I lærebedriften. Godkjenner dokumentasjonen i virkeligheten. */
  | 'faglig_leder'
  /** I lærebedriften. Leder oppdragene fra dag til dag. */
  | 'instruktor'
  /** I opplæringskontoret. Forvalter lærlinger på tvers av bedrifter. */
  | 'koordinator'
  /** Kollega i lærebedriften. Står i kontaktlista, har ingen innsyn. */
  | 'ansatt'

export type Tilknytning = {
  laerlingId: string
  personId: string
  rolle: Tilknytningsrolle
  /** ISO-dato. */
  gyldigFra: string
  /** ISO-dato, eller null for løpende. */
  gyldigTil: string | null
}

export type Innsyn =
  /** Dekning per mål og del, framdrift, hva som mangler. Ingen tekst. */
  | 'dekning'
  /** Den innsendte loggen: brødtekst, bilder, vedlegg, kryss. */
  | 'logg'
  /** Kladd under arbeid, utspørringen, svarene på quizen. */
  | 'kladd'
  /** Skrivestil, preferanser, hvor lenge han har holdt på. */
  | 'profil'
  /** Abonnement og betaling. */
  | 'abonnement'

/**
 * Hva hver tilknytningsrolle får se.
 *
 * Koordinatoren ser loggen (avklart 16.09.2026): han skal kunne lese det han
 * forvalter, og loggen havner uansett i fagbrev.io der han ser den i dag.
 *
 * Men merk hva som IKKE står her: **ingen rolle har `kladd` eller `profil`.**
 * Det er ikke en forglemmelse. Kladden er tenkningen hans underveis, og
 * quizsvarene er der han innrømmer at han ikke kan noe. Blir det lesbart for
 * sjefen, slutter han å innrømme det, og verifiseringen — altså produktet — dør.
 * Den innsendte loggen er delt. Veien fram til den er hans.
 */
const INNSYN: Record<Tilknytningsrolle, Innsyn[]> = {
  faglig_leder: ['dekning', 'logg'],
  instruktor: ['dekning', 'logg'],
  koordinator: ['dekning', 'logg'],
  ansatt: [],
}

function gjelder(t: Tilknytning, paaDato: string): boolean {
  if (paaDato < t.gyldigFra) return false
  if (t.gyldigTil !== null && paaDato > t.gyldigTil) return false
  return true
}

/**
 * Får `personId` se `hva` om `laerlingId` på denne datoen?
 *
 * Lærlingen selv ser alt sitt eget, uten tilknytning. Alle andre må ha en
 * gyldig rad. En utløpt tilknytning gir ingenting: en faglig leder som slutter
 * skal ikke fortsette å lese loggene til en lærling han ikke lenger følger.
 */
export function kanSe(
  args: {
    personId: string
    laerlingId: string
    hva: Innsyn
    paaDato: string
    tilknytninger: Tilknytning[]
  },
): boolean {
  const { personId, laerlingId, hva, paaDato, tilknytninger } = args

  if (personId === laerlingId) return true

  return tilknytninger.some(t =>
    t.laerlingId === laerlingId &&
    t.personId === personId &&
    gjelder(t, paaDato) &&
    INNSYN[t.rolle].includes(hva),
  )
}

/** Alle lærlinger denne personen faktisk følger nå. Går på tvers av firmaer. */
export function mineLaerlinger(
  personId: string, paaDato: string, tilknytninger: Tilknytning[],
): { laerlingId: string; rolle: Tilknytningsrolle }[] {
  return tilknytninger
    .filter(t => t.personId === personId && gjelder(t, paaDato) && INNSYN[t.rolle].length > 0)
    .map(t => ({ laerlingId: t.laerlingId, rolle: t.rolle }))
}

/**
 * Teksten lærlingen får se om hvem som ser hva.
 *
 * Den genereres fra den samme matrisen som håndhever det. Et løfte som
 * vedlikeholdes for hånd ved siden av koden blir før eller siden en løgn.
 */
export function hvemSerHva(
  laerlingId: string, paaDato: string, tilknytninger: Tilknytning[],
): { personId: string; rolle: Tilknytningsrolle; ser: string }[] {
  const tekst: Record<Tilknytningsrolle, string> = {
    faglig_leder: 'loggene dine og hvor langt du er kommet',
    instruktor: 'loggene dine og hvor langt du er kommet',
    koordinator: 'loggene dine og hvor langt du er kommet',
    ansatt: 'ingenting',
  }
  return tilknytninger
    .filter(t => t.laerlingId === laerlingId && gjelder(t, paaDato))
    .map(t => ({ personId: t.personId, rolle: t.rolle, ser: tekst[t.rolle] }))
}

// ── Invitasjon ──────────────────────────────────────────────────────────────
//
// Ingen kobler seg på en lærling uten at han har sagt ja. Det er ikke bare
// ryddig, det er det som gjør at han tør å skrive ærlig — og et produkt der
// han skriver for sjefen produserer tall som er verdiløse.
//
// To retninger, samme regel:
//   - lærlingen inviterer sin faglige leder, instruktør eller koordinator
//   - kontoret eller bedriften inviterer lærlingen når de tar i bruk Ampex
//
// Begge ender med at LÆRLINGEN aksepterer. Da opprettes tilknytningsraden av
// hans egen handling, og vanlig RLS dekker den — ingen `service_role` i den
// normale veien, i motsetning til `inviter-ansatt`, som må omgå
// `profiles_vern` for å sette `company_id`.
//
// Invitasjonen går på E-POST, ikke på bruker-id, fordi den inviterte ofte ikke
// har konto ennå. Det er samme grunn som `inviter-ansatt` har.

export type Invitasjon = {
  id: string
  /** Hvem invitasjonen gjelder læretiden til. */
  laerlingId: string
  /** Adressen som inviteres. Kontoen finnes kanskje ikke ennå. */
  epost: string
  rolle: Tilknytningsrolle
  /** Hvem som sendte den. */
  fraPersonId: string
  sendtDato: string
  utloperDato: string
  status: 'sendt' | 'akseptert' | 'avslatt' | 'utlopt'
}

/**
 * Får `fraPersonId` sende denne invitasjonen?
 *
 * Lærlingen bestemmer over sin egen læretid og kan invitere hvem som helst.
 * En koordinator kan invitere en lærling inn, fordi kontoret har et reelt
 * forvaltningsansvar — men invitasjonen gir ingenting før den er akseptert.
 * En faglig leder kan hente inn en instruktør på samme lærling.
 *
 * Det ingen kan: invitere seg selv inn på en lærling de ikke allerede følger.
 */
export function kanInvitere(
  args: {
    fraPersonId: string
    laerlingId: string
    rolle: Tilknytningsrolle
    paaDato: string
    tilknytninger: Tilknytning[]
  },
): boolean {
  const { fraPersonId, laerlingId, rolle, paaDato, tilknytninger } = args
  if (fraPersonId === laerlingId) return true

  const min = tilknytninger.find(t =>
    t.laerlingId === laerlingId && t.personId === fraPersonId && gjelder(t, paaDato))
  if (!min) return false

  if (min.rolle === 'koordinator') return rolle !== 'koordinator'
  if (min.rolle === 'faglig_leder') return rolle === 'instruktor' || rolle === 'ansatt'
  return false
}

/**
 * Aksept skaper tilknytningen. Avslag skaper ingenting.
 *
 * **Det er MOTTAKEREN som aksepterer**, uansett hvilken vei invitasjonen gikk.
 * Lærlingens samtykke ligger enten i at han sendte den, eller i at han tar
 * imot den:
 *
 *   Lærlingen inviterer faglig leder → faglig leder aksepterer.
 *     Samtykket lå i at lærlingen sendte den.
 *   Kontoret inviterer lærlingen     → lærlingen aksepterer.
 *     Samtykket ligger i aksepten.
 *
 * Den som FÅR tilgang er alltid motparten til lærlingen. Det er derfor
 * `fraPersonId === laerlingId` avgjør hvem tilknytningen peker på, og ikke
 * hvem som tilfeldigvis trykket på knappen.
 */
export function aksepter(
  inv: Invitasjon,
  akseptor: { personId: string; epost: string },
  paaDato: string,
): Tilknytning | null {
  if (inv.status !== 'sendt') return null
  if (paaDato > inv.utloperDato) return null
  // Bare adressen invitasjonen ble sendt til kan løse den inn.
  if (akseptor.epost.trim().toLowerCase() !== inv.epost.trim().toLowerCase()) return null

  const laerlingenInviterte = inv.fraPersonId === inv.laerlingId

  // Kom invitasjonen utenfra, er det lærlingen selv som må stå bak adressen.
  if (!laerlingenInviterte && akseptor.personId !== inv.laerlingId) return null

  return {
    laerlingId: inv.laerlingId,
    personId: laerlingenInviterte ? akseptor.personId : inv.fraPersonId,
    rolle: inv.rolle,
    gyldigFra: paaDato,
    gyldigTil: null,
  }
}

/**
 * Kan lærlingen koble noen FRA igjen?
 *
 * Ja, når han betaler selv — da er tilgangen hans å gi og hans å ta tilbake.
 *
 * Nei for koordinatoren når opplæringskontoret betaler plassen. Da følger
 * tilknytningen med plassen, på samme måte som en lærer følger med et
 * klasserom. Det skal stå på skjermen FØR han aksepterer, ikke oppdages den
 * dagen han prøver å fjerne den.
 *
 * Faglig leder og instruktør kan han alltid fjerne: bytter han bedrift, skal
 * ikke den forrige sjefen bli sittende med loggene hans.
 */
export function kanKobleFra(
  rolle: Tilknytningsrolle, finansiering: 'selv' | 'kontor' | 'bedrift' | 'gratis',
): { kan: boolean; grunn: string } {
  if (rolle === 'koordinator' && finansiering === 'kontor') {
    return { kan: false, grunn: 'Opplæringskontoret betaler plassen din, så koordinatoren følger med den.' }
  }
  if (rolle === 'faglig_leder' && finansiering === 'bedrift') {
    return { kan: false, grunn: 'Bedriften betaler plassen din, så faglig leder følger med den.' }
  }
  return { kan: true, grunn: 'Du bestemmer selv hvem som følger læretiden din.' }
}
