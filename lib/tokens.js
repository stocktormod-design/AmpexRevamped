// Design tokens — single source of truth (iOS HIG values).
// Plain CJS so both tailwind.config.js and lib/theme.ts can consume it.
// RULE: no screen uses a colour/size/radius that isn't defined here.

const colors = {
  // ── GRUNNFLATEN ER HVIT ──────────────────────────────────────────────────
  //
  // Besluttet 2026-09-06 (Tormod: «føler hvit er mer premium», «recreate den
  // som om Tesla eller Apple skulle lage field app»). Papir-æraen (#F3EEE6 +
  // messing) er erstattet av ÉN hvit flate. Det som gjør hvitt premium er alt
  // som holdes tilbake: sort blekk, én grå for gruppering (#F5F5F7, Apple),
  // hårlinjer man knapt ser, nøytrale skygger og luft.
  //
  // Platen skiller seg fra grunnen med hårlinje + skygge, ikke med farge.
  // Den ene fylte handlingen per skjerm er SORT: sort på hvitt leser som
  // beslutning, farget leser som kampanje. Farge finnes bare som semantikk.
  canvas: '#FFFFFF', // sidegrunn
  bg: '#FFFFFF', // platen — skilles med hårlinje og skygge
  bgPressed: '#F5F5F7', // platen mens den trykkes (platen ER kontrollen)
  groupedBg: '#F5F5F7', // gruppert grunn (Innstillinger-mønsteret, sjelden)
  fill: '#F2F2F4', // ikonflis, inputfyll, felt
  fillPressed: '#E5E5EA', // fill while pressed

  // Text — sort blekk. Tidene og tallene i `label`; stille tekst i `secondaryLabel`.
  label: '#1D1D1F',
  labelMuted: '#3A3A3C', // agendatitler o.l. — tydelig sekundært, fortsatt mørkt
  secondaryLabel: '#6E6E73',
  tertiaryLabel: 'rgba(29,29,31,0.36)',
  iconMuted: '#6E6E73',

  // Lines — hårlinjer, nesten usynlige. Kontrasten bor i skyggen og luften.
  separator: '#E5E5EA',
  border: '#E5E5EA',

  // Actions — hovedknappen er SORT med hvit tekst.
  cta: '#1D1D1F',
  ctaLabel: '#FFFFFF',
  brandLabel: '#FFFFFF', // tekst på brand-knapp

  // Brand — SORT. Brukes der messingen sto: neste-prikken, primærknappen,
  // aktiv tilstand. brandSoft er den grå flaten bak ikonknapper, brandWash
  // en svak sort alfa for små merker.
  brand: '#1D1D1F',
  brandSoft: '#F2F2F4',
  brandWash: 'rgba(29,29,31,0.08)',

  // Slate — kjølig sekundærtone for sekundære handlinger.
  slate: '#48484A',
  slateSoft: 'rgba(72,72,74,0.08)',
  slateBorder: 'rgba(72,72,74,0.18)',

  // Semantic. Farge = mening (status), aldri pynt. Mørknet nok for hvitt.
  success: '#1F7A3F',
  successSoft: 'rgba(31,122,63,0.10)',
  warning: '#B4530A',
  warningSoft: 'rgba(180,83,10,0.10)',
  danger: '#B3261E',
  dangerSoft: 'rgba(179,38,30,0.08)',
  successWash: 'rgba(31,122,63,0.10)',
  warningWash: 'rgba(180,83,10,0.10)',
  dangerWash: 'rgba(179,38,30,0.08)',

  // Glass — frostet KROM over hvitt. Kun tre steder (regel 10): navbar,
  // dock-pillen og stemme-orben. Aldri per listecelle.
  chromeGlass: 'rgba(255,255,255,0.72)',
  chromeGlassWarm: 'rgba(255,255,255,0.90)',
  cardGlass: 'rgba(255,255,255,0.60)',
  cardGlassStrong: 'rgba(255,255,255,0.82)',
  glassEdge: '#E5E5EA',
  ambientCool: '#EEF1F5',
  ambientWarm: '#F3F3F5',

  // Vær — nå-tilstanden på Hjem: ETT farget ikon + grader (farge = mening).
  // ── PAPIR (dokumenter) ───────────────────────────────────────────────────
  //
  // Dokument-tokenene består: inne i et skjema/tilbud/tegning er grunnen
  // fortsatt den KREMETE (mykere enn appens papir) — «nå står du i et
  // dokument» leses fortsatt som et eget lag, bare nærmere resten.
  paperCanvas: '#F5F5F7', // arkets grunn — nøytralt, litt dypere enn appens hvite
  paperBg: '#FFFFFF', // kort på arket
  paperFill: '#EAEAEE', // ikonflis, inputfyll
  paperFillPressed: '#DEDEE3',
  paperLabel: '#1D1D1F',
  paperSecondary: '#6E6E73',
  paperTertiary: '#AEAEB2',
  paperIcon: '#3A3A3C',
  paperSeparator: '#E5E5EA',
  paperBorder: '#D1D1D6',
  paperChrome: 'rgba(249,249,249,0.70)', // frostet linje over ark

  // ── VERKTØYFLATER (mørke instrumenter) ───────────────────────────────────
  //
  // Var appens grunnflate i brun-æraen. Nå er de UNNTAKET igjen: skjermer som
  // er instrumenter (skann/AR, tegning i mørk modus) beholder mørk grunn.
  // Lager-treet bruker disse i dag og beholder dem til Lager-rutenettet
  // (Finn-stil, papir) bygges.
  toolBg: '#0F0F10',
  toolRaised: 'rgba(255,255,255,0.055)',
  toolRaisedStrong: 'rgba(255,255,255,0.10)',
  toolBorder: 'rgba(255,255,255,0.10)',
  toolLabel: '#F5F5F7',
  toolSecondary: 'rgba(245,245,247,0.60)',
  toolTertiary: 'rgba(245,245,247,0.34)',
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
//   hero store, isolerte kort (platen på Hjem, tilbudskort)
const radius = {
  sm: 8, // small chips, badges
  md: 10, // icon containers, inset-list corners
  lg: 12, // cards, shortcut tiles
  xl: 14, // primary buttons — NOT for hero cards, see `hero`
  hero: 24, // hero/featured cards (platen, GlassCard, ListCard)
  pill: 999,
}

const sizes = {
  touchTarget: 44, // HIG minimum tappable size
  navBar: 44, // compact nav bar (excl. status bar inset)
  tabBar: 58, // tab bar height (excl. bottom inset) — screens pad scroll content by tabBar + inset
  iconChip: 40, // leading icon container in list rows
  ctaHeight: 54,
  voiceOrb: 54, // stemme-orben over docken
  icon: 20, // default lucide size in rows
  iconLg: 24,
  lucideStroke: 1.8, // SF Symbols-like weight
}

module.exports = { colors, spacing, radius, sizes }
