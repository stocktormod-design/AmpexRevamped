// Design tokens — single source of truth (iOS HIG values).
// Plain CJS so both tailwind.config.js and lib/theme.ts can consume it.
// RULE: no screen uses a colour/size/radius that isn't defined here.

const colors = {
  // Backgrounds
  bg: '#FFFFFF', // primary screen background
  groupedBg: '#F2F2F7', // iOS grouped-list background (legacy — new screens use bg + card tiers)
  fill: '#F1EEE7', // icon chips, shortcut cards, input fills — warm neutral
  fillPressed: '#E5E0D3', // fill while pressed

  // Text (warm label hierarchy — synket fra Claude Design, "lys + kobber"-retningen)
  label: '#2E281F',
  secondaryLabel: '#96896F',
  tertiaryLabel: '#C9C0AC',
  iconMuted: '#5C5340', // muted icon/glyph tone on light fills

  // Lines
  separator: '#E7E2D5', // hairline between list rows
  border: '#D6CFBE',

  // Actions
  cta: '#2E281F', // primary button (Ampex warm-black)
  ctaLabel: '#FFFFFF',

  // Brand — KOBBER (som i kobbertråd). Ampex' ene identitetsfarge: brukes GJERRIG
  // (én aksent per skjermområde: hero-glimtet, primærhandlingens ikon-chip) og aldri
  // som status — semantikken (grønn/oransje/rød) forblir urørt. Rav/signalgul ble
  // vraket: kolliderer med warning-oransjen (elektrikere leser gult/oransje som avvik).
  brand: '#A97C4F',
  brandSoft: '#F7F3EA', // også "cream card"-fyll for hero/featured-kort (Neste ordre, Oppdrag)
  brandWash: 'rgba(169,124,79,0.12)', // kobber-alfa for små tall-/antall-merker (IKKE kort-fyll)

  // Slate — kjølig sekundærtone. IKKE en ny aksent: brukes til (a) sekundære/nøytrale
  // handlinger som skal skille seg fra kobber-primær, og (b) reell status (f.eks.
  // dokumentasjon fullført). Aldri dekorativ pynt ved siden av kobber i samme element.
  slate: '#3F4B5C',
  slateSoft: 'rgba(100,116,139,0.12)',
  slateBorder: 'rgba(100,116,139,0.18)',

  // Semantic (iOS system palette). Colour = meaning (status), never decoration —
  // chrome/icons stay monochrome. *Soft = colour at ~10% over white (solid hex).
  success: '#34C759',
  successSoft: '#EBF9EF',
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
  danger: '#FF3B30',
  dangerSoft: '#FFECEB',

  // Glass (Liquid Glass-era chrome) — near-neutral, depth not decoration.
  // Brukes fortsatt av Ordre-liste/Lager/Prosjekt-detalj (ambient+glass-runden);
  // Hjem/Ordre-detalj bruker nå solid cream/hvit-kort i stedet, se DESIGN.md.
  chromeGlass: 'rgba(249,249,249,0.70)', // fill under BlurView on bars (also Android fallback)
  chromeGlassWarm: 'rgba(241,238,231,0.94)', // warmer, denser frosted fill for elements floating OVER a page (cart bar/sheet) — needs more contrast against a white page bg than chromeGlass gives
  cardGlass: 'rgba(255,255,255,0.62)', // frosted card fill over blur
  cardGlassStrong: 'rgba(255,255,255,0.78)', // denser glass for list rows / empty-states over ambient
  glassEdge: 'rgba(255,255,255,0.85)', // hairline highlight on glass edges
  ambientCool: '#DCE4EE', // backdrop blob — barely-there, gives glass something to refract
  ambientWarm: '#EAE5DC',
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
