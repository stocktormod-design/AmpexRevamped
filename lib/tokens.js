// Design tokens — single source of truth (iOS HIG values).
// Plain CJS so both tailwind.config.js and lib/theme.ts can consume it.
// RULE: no screen uses a colour/size/radius that isn't defined here.

const colors = {
  // ── GRUNNFLATEN ER BRUN ──────────────────────────────────────────────────
  //
  // Appen var kremet med mørke unntak. Nå er den brun med ett unntak: papiret
  // (lenger ned), som du ser når du står INNE I et dokument.
  //
  // Grunnen til byttet er ikke smak. Den kremede paletten ligger i samme
  // familie som Kindle, Apple Notes og Goodreads — lese- og notatapper — og
  // derfor leste hver eneste arbeidsskjerm som en notatblokk. Brunt sier
  // verktøy, og skiftet til kremet sier at nå er du i et dokument.
  //
  // Dybde lages med VERDI, ikke med skygge: lysere flate = nærmere.
  canvas: '#211C15', // sidegrunn. Kun skjermrot.
  bg: 'rgba(255,255,255,0.055)', // KORTFLATE — panel som ligger på grunnen
  groupedBg: '#211C15', // DØD — beholdt til tailwind-konsumenter er sjekket
  fill: 'rgba(255,255,255,0.10)', // ikonflis, inputfyll, valgt panel
  fillPressed: 'rgba(255,255,255,0.15)', // fill while pressed

  // Text — kremet blekk på brunt
  label: '#F6F1E8',
  secondaryLabel: 'rgba(246,241,232,0.58)',
  tertiaryLabel: 'rgba(246,241,232,0.32)',
  iconMuted: 'rgba(246,241,232,0.58)',

  // Lines — hårlinje i stedet for skygge
  separator: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.10)',

  // Actions
  // Knapper er KREMET eller KOBBER — aldri en mørk flate på mørk grunn.
  // Den varmsorte knappen forsvant i det grunnflaten ble brun.
  cta: '#F6F1E8', // primærknapp på brun flate
  ctaLabel: '#2E281F', // varm sort tekst PÅ den kremede knappen
  brandLabel: '#FFF9F2', // tekst på kobberknapp

  // Brand — KOBBER (som i kobbertråd). Ampex' ene identitetsfarge: brukes GJERRIG
  // (én aksent per skjermområde: hero-glimtet, primærhandlingens ikon-chip) og aldri
  // som status — semantikken (grønn/oransje/rød) forblir urørt. Rav/signalgul ble
  // vraket: kolliderer med warning-oransjen (elektrikere leser gult/oransje som avvik).
  brand: '#A97C4F',
  brandSoft: '#FBF7F0', // også "cream card"-fyll — løftet så hero-kortet leser OVER canvas for hero/featured-kort (Neste ordre, Oppdrag)
  brandWash: 'rgba(169,124,79,0.12)', // kobber-alfa for små tall-/antall-merker (IKKE kort-fyll)

  // Slate — kjølig sekundærtone. IKKE en ny aksent: brukes til (a) sekundære/nøytrale
  // handlinger som skal skille seg fra kobber-primær, og (b) reell status (f.eks.
  // dokumentasjon fullført). Aldri dekorativ pynt ved siden av kobber i samme element.
  // Lys nok til å leses PÅ brunt. Var #3F4B5C, som var riktig da grunnen var
  // kremet og usynlig i det den ble brun.
  slate: '#A9BACB',
  slateSoft: 'rgba(100,116,139,0.12)',
  slateBorder: 'rgba(100,116,139,0.18)',

  // Semantic (iOS system palette). Colour = meaning (status), never decoration —
  // chrome/icons stay monochrome.
  //
  // *Soft er fargen som ALFA, ikke som farge lagt over hvitt. De gamle
  // near-hvite variantene (#FFF4E5) ble lyse plakater med usynlig kremet tekst
  // i det grunnen ble brun. Alfa virker på begge flater.
  success: '#34C759',
  successSoft: 'rgba(52,199,89,0.16)',
  warning: '#FF9500',
  warningSoft: 'rgba(255,149,0,0.16)',
  danger: '#FF3B30',
  dangerSoft: 'rgba(255,59,48,0.16)',
  successWash: 'rgba(52,199,89,0.16)',
  warningWash: 'rgba(255,149,0,0.16)',
  dangerWash: 'rgba(255,59,48,0.16)',

  // Glass — frostet krom over brun grunn. Depth, not decoration.
  chromeGlass: 'rgba(33,28,21,0.80)', // fyll under BlurView på barer (og Android-fallback)
  chromeGlassWarm: 'rgba(33,28,21,0.92)', // tettere, for elementer som FLYTER over siden (handlekurv, ark)
  cardGlass: 'rgba(255,255,255,0.06)',
  cardGlassStrong: 'rgba(255,255,255,0.10)',
  glassEdge: 'rgba(255,255,255,0.12)', // hårlinje på glasskant
  // Ambient-flekkene tilhører PAPIR: på brun grunn brukes ToolGlow i stedet,
  // som er én kobbergradient fra hjørnet og ikke to blobber.
  ambientCool: '#DCE4EE',
  ambientWarm: '#EAE5DC',

  // ── PAPIR (dokumenter) ───────────────────────────────────────────────────
  //
  // Kremet er ikke lenger appens grunnflate, men dens UNNTAK: det du ser når du
  // står INNE I et dokument — et skjema som fylles ut, en mal som redigeres, et
  // tilbud som leses. Alt annet er brunt.
  //
  // Verdiene er de gamle default-verdiene, uendret. De har bare fått et navn
  // som sier hvor de hører hjemme, i stedet for å være «vanlig».
  paperCanvas: '#EFEAE1', // arkets grunn
  paperBg: '#FFFFFF', // kort på arket
  paperFill: '#E5DDCE', // ikonflis, inputfyll
  paperFillPressed: '#D8CEBB',
  paperLabel: '#2E281F',
  paperSecondary: '#96896F',
  paperTertiary: '#C9C0AC',
  paperIcon: '#5C5340',
  paperSeparator: '#DED6C7',
  paperBorder: '#CDC4B1',
  paperChrome: 'rgba(249,249,249,0.70)', // frostet linje over ark

  // ── VERKTØYFLATER ────────────────────────────────────────────────────────
  //
  // Disse var den mørke UNNTAKSpaletten den gangen appen var kremet. Nå er de
  // det samme som standardfargene over — brunt er grunnflaten, ikke unntaket.
  //
  // De blir stående fordi navnet sier hva flaten ER: en skjerm som skriver
  // `toolRaised` sier «panel på verktøyflaten», ikke «hvit». Bruk gjerne de
  // korte navnene (`bg`, `label`) i ny kode; disse er like gyldige.
  toolBg: '#211C15', // = canvas
  toolRaised: 'rgba(255,255,255,0.055)', // = bg
  toolRaisedStrong: 'rgba(255,255,255,0.10)', // = fill
  toolBorder: 'rgba(255,255,255,0.10)', // = border/separator
  toolLabel: '#F6F1E8', // kremet tekst
  toolSecondary: 'rgba(246,241,232,0.58)',
  toolTertiary: 'rgba(246,241,232,0.32)',
}

// 4pt grid. Screen edge = 24 (matches existing screens).
const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  screen: 24,
  xxl: 32,
  xxxl: 48,
}

// Radius MED MENING. At alt har samme hjørne er et av de tydeligste tegnene på
// grensesnitt ingen har tatt et valg i: chip, rad, kort og knapp får xl, og da
// sier radiusen ingenting. Skalaen under er ment brukt slik:
//   sm   inputfelt, små merker
//   md   rader i en liste, ikonfliser
//   lg   paneler og kort
//   xl   ÉN flate per skjerm — den som er hovedsaken
//   hero store, isolerte kort (tilbudskort, arkivkort)
const radius = {
  sm: 8, // small chips, badges
  md: 10, // icon containers, inset-list corners
  lg: 12, // cards, shortcut tiles
  xl: 14, // primary buttons — NOT for hero cards, see `hero`
  hero: 24, // hero/featured cards (GlassCard, CreamCard, ListCard) — softer than button radius on purpose
  pill: 999,
}

const sizes = {
  touchTarget: 44, // HIG minimum tappable size
  navBar: 44, // compact nav bar (excl. status bar inset)
  tabBar: 58, // tab bar height (excl. bottom inset) — screens pad scroll content by tabBar + inset
  iconChip: 40, // leading icon container in list rows
  ctaHeight: 54,
  icon: 20, // default lucide size in rows
  iconLg: 24,
  lucideStroke: 1.8, // SF Symbols-like weight
}

module.exports = { colors, spacing, radius, sizes }
