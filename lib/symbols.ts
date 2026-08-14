// Elektriske symboler (NEK/IEC-inspirert, forenklet) — portet fra gamle Ampex.
// Inner-SVG i viewBox 0 0 24 24, tegnes med stroke = valgt farge (currentColor for fyll).

export type ElectricalSymbol = { id: string; label: string; body: string }

// Enheter mest relevant for sløyfer/detektorer først, så generell elektro.
export const SYMBOLS: ElectricalSymbol[] = [
  { id: 'royk', label: 'Røykvarsler', body: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>` },
  { id: 'sensor', label: 'Bevegelse', body: `<circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/><path d="M12 9a4 4 0 0 1 4 4"/><path d="M12 5a8 8 0 0 1 8 8"/>` },
  { id: 'melder', label: 'Manuell melder', body: `<rect x="5" y="5" width="14" height="14" rx="1.5"/><path d="M9 15V9l3 3 3-3v6"/>` },
  { id: 'klokke', label: 'Brannklokke', body: `<path d="M7 16a5 5 0 0 1 10 0z"/><path d="M12 6V4"/><path d="M5 16h14"/><path d="M11 20h2"/>` },
  { id: 'lyspunkt', label: 'Lyspunkt', body: `<circle cx="12" cy="12" r="6"/><path d="M7.8 7.8 16.2 16.2"/><path d="M16.2 7.8 7.8 16.2"/>` },
  { id: 'downlight', label: 'Downlight', body: `<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>` },
  { id: 'armatur', label: 'Armatur', body: `<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M3 12h18"/>` },
  { id: 'stikk', label: 'Stikkontakt', body: `<path d="M4 15a8 8 0 0 1 16 0"/><path d="M2 15h20"/><path d="M12 7V3"/>` },
  { id: 'stikk-jord', label: 'Stikk m/jord', body: `<path d="M4 15a8 8 0 0 1 16 0"/><path d="M2 15h20"/><path d="M8 11h8"/><path d="M12 7V3"/>` },
  { id: 'data', label: 'Data / tele', body: `<path d="M3 15h18"/><path d="M12 15V5"/><path d="M7 10l5-5 5 5"/>` },
  { id: 'bryter', label: 'Bryter', body: `<circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><path d="M6 18 18 6"/><circle cx="19" cy="5" r="1.4"/>` },
  { id: 'termostat', label: 'Termostat', body: `<circle cx="12" cy="12" r="7"/><path d="M9 9h6"/><path d="M12 9v7"/>` },
  { id: 'fordeling', label: 'Fordeling', body: `<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 8h8M8 12h8M8 16h8"/>` },
  { id: 'jordfeil', label: 'Jordfeil', body: `<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M12 3v5"/><path d="M9 8h6"/><path d="M11 8 16 16"/>` },
  { id: 'motor', label: 'Motor', body: `<circle cx="12" cy="12" r="7"/><path d="M9 15V9l3 4 3-4v6"/>` },
]

const BY_ID: Record<string, ElectricalSymbol> = Object.fromEntries(SYMBOLS.map(s => [s.id, s]))
export function getSymbol(id: string | undefined): ElectricalSymbol | undefined {
  return id ? BY_ID[id] : undefined
}

/** Ferdig SVG-streng for et symbol i valgt farge (currentColor-fyll løses av SvgXml color-prop). */
export function symbolSvg(id: string, color: string): string {
  const sym = BY_ID[id] ?? BY_ID.royk
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${sym.body}</svg>`
}
