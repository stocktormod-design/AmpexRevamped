/**
 * Utsnittet på en tegning — panorering, zoom og synkronisering mellom ruter.
 *
 * ── Hvorfor dette er delt regning ──────────────────────────────────────────
 *
 * UNDERLAGET er plattformspesifikt: kontoret rasteriserer PDF-en med pdf.js til
 * canvas (nødvendig for synkroniserte ruter og skarp zoom), appen bruker native
 * PDF — PDFKit på iOS, PdfRenderer på Android. De to kan ikke dele kode.
 *
 * Men alt som ligger OPPÅ underlaget — rom, sløyfer, symboler, oppgave-pins —
 * er normaliserte side-koordinater (0–1), og regningen fra normalisert til
 * skjerm er den samme uansett hvem som tegner bakgrunnen. Skrives den to
 * ganger, driver de to fra hverandre, og da havner en pin ett sted på
 * telefonen og et annet på kontoret.
 *
 * Rene funksjoner, ingen DOM, ingen React Native. Selvtestet i
 * `npm run verify:tegning`.
 */

/** Synlig utsnitt av tegningen, i normaliserte side-koordinater (0–1). */
export type Utsnitt = {
  /** Venstre kant av det synlige feltet, 0–1. */
  x: number
  /** Øvre kant, 0–1. */
  y: number
  /** Hvor stor andel av sidens bredde som vises. 1 = hele, 0,25 = 4× zoom. */
  bredde: number
}

/** Ruten på skjermen utsnittet tegnes i. Piksler. */
export type Rute = { bredde: number; hoyde: number }

/** Sidens eget forhold — bredde/høyde. A4 stående ≈ 0,707. */
export type Sideforhold = number

/**
 * Minste og største zoom.
 *
 * Taket på 40× er ikke vilkårlig: en A4-plan i 1:100 vist på en 27-tommer gir
 * omtrent millimeteroppløsning der. Mer enn det er å zoome inn i
 * rasteriseringen, ikke i tegningen.
 */
export const MIN_BREDDE = 1 / 40
export const MAKS_BREDDE = 1

export const HELE_SIDEN: Utsnitt = { x: 0, y: 0, bredde: 1 }

function klem(v: number, lav: number, hoy: number): number {
  return v < lav ? lav : v > hoy ? hoy : v
}

/**
 * Høyden på utsnittet, utledet av bredden.
 *
 * Utsnittet bærer bare bredde. Høyden FØLGER av sideforholdet og ruta, og skal
 * aldri lagres ved siden av — to tall som må stemme overens er ett tall for
 * mye, og de spriker ved første vindusendring.
 */
export function utsnittshoyde(u: Utsnitt, rute: Rute, side: Sideforhold): number {
  const ruteforhold = rute.bredde / rute.hoyde
  return (u.bredde * ruteforhold) / side
}

/**
 * Holder utsnittet innenfor arket.
 *
 * Uten dette kan man dra tegningen ut av syne og sitte igjen med en blank rute
 * uten å forstå hvorfor. Er utsnittet STØRRE enn arket i en retning, sentreres
 * det i stedet for å klemmes mot kanten — et ark som ligger i venstre hjørne av
 * en bred rute ser ut som en feil.
 */
export function klemUtsnitt(u: Utsnitt, rute: Rute, side: Sideforhold): Utsnitt {
  const bredde = klem(u.bredde, MIN_BREDDE, MAKS_BREDDE)
  const hoyde = utsnittshoyde({ ...u, bredde }, rute, side)

  const x = bredde >= 1 ? (1 - bredde) / 2 : klem(u.x, 0, 1 - bredde)
  const y = hoyde >= 1 ? (1 - hoyde) / 2 : klem(u.y, 0, 1 - hoyde)

  return { x, y, bredde }
}

/** Normalisert punkt på siden → piksler i ruta. */
export function tilSkjerm(
  p: { x: number; y: number },
  u: Utsnitt,
  rute: Rute,
  side: Sideforhold,
): { x: number; y: number } {
  const hoyde = utsnittshoyde(u, rute, side)
  return {
    x: ((p.x - u.x) / u.bredde) * rute.bredde,
    y: ((p.y - u.y) / hoyde) * rute.hoyde,
  }
}

/** Piksler i ruta → normalisert punkt på siden. Motsatt av `tilSkjerm`. */
export function tilSide(
  p: { x: number; y: number },
  u: Utsnitt,
  rute: Rute,
  side: Sideforhold,
): { x: number; y: number } {
  const hoyde = utsnittshoyde(u, rute, side)
  return {
    x: u.x + (p.x / rute.bredde) * u.bredde,
    y: u.y + (p.y / rute.hoyde) * hoyde,
  }
}

/**
 * Zoom om et punkt — typisk musepekeren eller midt mellom to fingre.
 *
 * Punktet under pekeren skal bli LIGGENDE under pekeren. Zoomer man om midten
 * i stedet, glir det man ser på vekk mens man zoomer, og man må panorere
 * tilbake hver gang. Det er forskjellen på en tegning man kan jobbe i og en man
 * kjemper mot.
 */
export function zoomOm(
  u: Utsnitt,
  ankerSkjerm: { x: number; y: number },
  faktor: number,
  rute: Rute,
  side: Sideforhold,
): Utsnitt {
  const anker = tilSide(ankerSkjerm, u, rute, side)
  const nyBredde = klem(u.bredde / faktor, MIN_BREDDE, MAKS_BREDDE)

  // Andelen av ruta ankeret ligger på skal være uendret etter zoomen.
  const andelX = ankerSkjerm.x / rute.bredde
  const andelY = ankerSkjerm.y / rute.hoyde
  const nyHoyde = utsnittshoyde({ x: 0, y: 0, bredde: nyBredde }, rute, side)

  return klemUtsnitt(
    { x: anker.x - andelX * nyBredde, y: anker.y - andelY * nyHoyde, bredde: nyBredde },
    rute,
    side,
  )
}

/** Panorer med et piksel-dra. */
export function panorer(
  u: Utsnitt,
  dxPiksler: number,
  dyPiksler: number,
  rute: Rute,
  side: Sideforhold,
): Utsnitt {
  const hoyde = utsnittshoyde(u, rute, side)
  return klemUtsnitt(
    {
      x: u.x - (dxPiksler / rute.bredde) * u.bredde,
      y: u.y - (dyPiksler / rute.hoyde) * hoyde,
      bredde: u.bredde,
    },
    rute,
    side,
  )
}

/**
 * Samme utsnitt i en rute med ANNET format.
 *
 * Multiview-rutene er like store, men tegningene i dem trenger ikke ha samme
 * sideforhold — en plan kan være A3 liggende og et snitt A4 stående. Uten denne
 * ville «samme sted» betydd samme tallpar, og det er ikke samme sted når arkene
 * har ulik form.
 *
 * Bredden beholdes, og midtpunktet bevares. Høyden følger av det nye
 * sideforholdet, slik den skal.
 */
export function speilTil(u: Utsnitt, fraSide: Sideforhold, tilSideforhold: Sideforhold, rute: Rute): Utsnitt {
  const hoyde = utsnittshoyde(u, rute, fraSide)
  const midtY = u.y + hoyde / 2

  const nyHoyde = utsnittshoyde(u, rute, tilSideforhold)
  return klemUtsnitt({ x: u.x, y: midtY - nyHoyde / 2, bredde: u.bredde }, rute, tilSideforhold)
}

/**
 * Ligger punktet inne i firkanten? Til treffdeteksjon på rom.
 *
 * `rooms.shape` er `{x, y, w, h}` i samme normaliserte rom.
 */
export function iFirkant(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/**
 * Nærmeste pin innenfor en treffradius — i PIKSLER, ikke i sidekoordinater.
 *
 * Radiusen må måles på skjermen: en pin er like stor uansett zoom, så en
 * treffradius i sidekoordinater ville krevd millimeterpresisjon når man er
 * zoomet ut, og truffet halve arket når man er zoomet inn.
 */
export function finnPin<T extends { x: number; y: number }>(
  pins: T[],
  klikkSkjerm: { x: number; y: number },
  u: Utsnitt,
  rute: Rute,
  side: Sideforhold,
  radiusPiksler = 18,
): T | null {
  let beste: T | null = null
  let besteAvstand = radiusPiksler

  for (const p of pins) {
    const s = tilSkjerm(p, u, rute, side)
    const d = Math.hypot(s.x - klikkSkjerm.x, s.y - klikkSkjerm.y)
    if (d <= besteAvstand) {
      besteAvstand = d
      beste = p
    }
  }
  return beste
}

/** Zoomnivået som et lesbart tall — 1 = hele siden, 4 = fire ganger inn. */
export function zoomniva(u: Utsnitt): number {
  return 1 / u.bredde
}
