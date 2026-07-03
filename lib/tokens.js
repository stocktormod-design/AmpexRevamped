// Design tokens — single source of truth (iOS HIG values).
// Plain CJS so both tailwind.config.js and lib/theme.ts can consume it.
// RULE: no screen uses a colour/size/radius that isn't defined here.

const colors = {
  // Backgrounds
  bg: '#FFFFFF', // primary screen background
  groupedBg: '#F2F2F7', // iOS grouped-list background
  fill: '#F2F2F7', // icon chips, shortcut cards, input fills
  fillPressed: '#E5E5EA', // fill while pressed

  // Text (iOS label hierarchy)
  label: '#000000',
  secondaryLabel: '#8E8E93',
  tertiaryLabel: '#C7C7CC',
  iconMuted: '#3C3C43', // muted icon/glyph tone on light fills

  // Lines
  separator: '#E5E5EA', // hairline between list rows
  border: '#D1D1D6',

  // Actions
  cta: '#000000', // primary button (Ampex black)
  ctaLabel: '#FFFFFF',
  accent: '#007AFF', // links, active tab, selection (iOS systemBlue)

  // Semantic (iOS system palette)
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
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
  xl: 14, // primary buttons
  pill: 999,
}

const sizes = {
  touchTarget: 44, // HIG minimum tappable size
  iconChip: 40, // leading icon container in list rows
  ctaHeight: 54,
  icon: 20, // default lucide size in rows
  iconLg: 24,
  lucideStroke: 1.8, // SF Symbols-like weight
}

module.exports = { colors, spacing, radius, sizes }
