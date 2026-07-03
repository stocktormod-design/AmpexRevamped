const { colors, spacing, radius } = require('./lib/tokens.js')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors, // bg-bg, bg-groupedBg, text-label, text-secondaryLabel, border-separator, …
      spacing, // p-screen, gap-md, …
      borderRadius: radius, // rounded-md (10), rounded-xl (14), …
    },
  },
  plugins: [],
}
