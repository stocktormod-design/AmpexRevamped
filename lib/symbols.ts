// Elektriske symboler (NEK/IEC-inspirert, forenklet) — portet fra gamle Ampex.
// Inner-SVG i viewBox 0 0 24 24, tegnes med stroke = valgt farge (currentColor for fyll).

export type ElectricalSymbol = { id: string; label: string; body: string }

// Enheter mest relevant for sløyfer/detektorer først, så generell elektro.
export const SYMBOLS: ElectricalSymbol[] = [
  { id: 'royk', label: 'Røykvarsler', body: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>` },
  { id: 'sensor', label: 'Bevegelsesføler', body: `<rect x="3" y="3" width="18" height="18"/><circle cx="8" cy="15" r="2"/><path d="M9.4 13.6 14 8"/><path d="M17 6v2M17 11v2M17 16v2"/>` },
  { id: 'melder', label: 'Manuell melder', body: `<rect x="5" y="5" width="14" height="14" rx="1.5"/><path d="M9 15V9l3 3 3-3v6"/>` },
  { id: 'klokke', label: 'Brannklokke', body: `<path d="M2 12h6"/><path d="M8 6v12"/><path d="M8 6a6 6 0 0 1 0 12"/>` },
  { id: 'lyspunkt', label: 'Lyspunkt', body: `<circle cx="12" cy="12" r="6"/><path d="M7.8 7.8 16.2 16.2"/><path d="M16.2 7.8 7.8 16.2"/>` },
  { id: 'downlight', label: 'Downlight', body: `<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>` },
  { id: 'armatur', label: 'Armatur', body: `<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M3 12h18"/>` },
  { id: 'stikk', label: 'Stikkontakt', body: `<path d="M2 12h9"/><path d="M18 5a7 7 0 0 0 0 14"/>` },
  { id: 'stikk-jord', label: 'Stikk m/jord', body: `<path d="M2 12h9"/><path d="M18 5a7 7 0 0 0 0 14"/><path d="M6.5 8v8"/>` },
  { id: 'data', label: 'Data / tele', body: `<path d="M3 15h18"/><path d="M12 15V5"/><path d="M7 10l5-5 5 5"/>` },
  { id: 'bryter', label: 'Bryter', body: `<circle cx="7" cy="17" r="2.5"/><path d="M8.8 15.2 17 5"/><path d="M17 5l3 2.4"/>` },
  { id: 'termostat', label: 'Termostat', body: `<rect x="3" y="3" width="18" height="18"/><circle cx="8" cy="8" r="1.4"/><path d="M17.5 8.5a4.2 4.2 0 1 0 0 7"/>` },
  { id: 'fordeling', label: 'Fordeling', body: `<rect x="2" y="7" width="20" height="10"/><path d="M4 15l8-5v4l8-5"/>` },
  { id: 'jordfeil', label: 'Jordfeil', body: `<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M12 3v5"/><path d="M9 8h6"/><path d="M11 8 16 16"/>` },
  { id: 'motor', label: 'Motor', body: `<circle cx="12" cy="12" r="7"/><path d="M9 15V9l3 4 3-4v6"/>` },
  // Boligprosjektering (Verona, 30.10)
  { id: 'dimmer', label: 'Dimmer', body: `<circle cx="7" cy="17" r="2.5"/><path d="M8.8 15.2 17 5"/><path d="M13 6.5l6 5"/><path d="M19 11.5l-2.6-.3M19 11.5l-.9-2.4"/>` },
  { id: 'utelys', label: 'Utelys', body: `<circle cx="12" cy="13" r="5"/><path d="M8.5 9.5l7 7"/><path d="M15.5 9.5l-7 7"/><path d="M12 3v3"/><path d="M4 6l2 2"/><path d="M20 6l-2 2"/>` },
  { id: 'komfyr', label: 'Komfyr', body: `<rect x="4" y="4" width="16" height="16" rx="1.5"/><circle cx="9" cy="9" r="2"/><circle cx="15" cy="9" r="2"/><circle cx="9" cy="15" r="2"/><circle cx="15" cy="15" r="2"/>` },
  { id: 'varmekabel', label: 'Varmekabel', body: `<rect x="3" y="3" width="18" height="18"/><path d="M7 17h3.2v-1.6a4.8 4.8 0 1 1 3.6 0V17H17"/>` },
  { id: 'varmepumpe', label: 'Varmepumpe', body: `<rect x="3" y="6" width="18" height="12" rx="1.5"/><circle cx="15" cy="12" r="3.5"/><path d="M15 8.5v7"/><path d="M11.5 12h7"/><path d="M6 9h3M6 12h3M6 15h3"/>` },
  { id: 'bereder', label: 'Varmtvannsbereder', body: `<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M10 9h4"/><path d="M12 13v4"/>` },
  { id: 'elbillader', label: 'Elbillader', body: `<rect x="5" y="3" width="11" height="18" rx="1.5"/><path d="M11 7l-3 5h4l-3 5"/><path d="M16 9h2a1 1 0 0 1 1 1v6a1 1 0 0 0 2 0v-4"/>` },
  { id: 'vifte', label: 'Ventilasjon', body: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C11 7 13 5 15 6"/><path d="M13.3 12.8c3.3 1.3 3.6 3.9 2 5"/><path d="M10.6 12.6C7.7 14.6 5.6 13.4 5.8 11.4"/>` },
  // NEK 144 / IEC 60617 — etter en ekte elkraft-forklaring (30.10). Lyspunkt, stikk, bryter,
  // dimmer, termostat, fordeling, varmekabel og bevegelse over er tegnet om etter den samme.
  { id: 'bryter-2pol', label: 'Bryter, 2-polt', body: `<circle cx="7" cy="17" r="2.5"/><path d="M8.8 15.2 17 5"/><path d="M17 5l3 2.4"/><path d="M15.4 7l3 2.4"/>` },
  { id: 'serievender', label: 'Serievender', body: `<circle cx="12" cy="17" r="2.5"/><path d="M10.6 15 6 5"/><path d="M13.4 15 18 5"/><path d="M6 5 3.5 6.6"/><path d="M18 5l2.5 1.6"/>` },
  { id: 'stikk-3fas', label: 'Stikk 3-polt / industri', body: `<path d="M2 12h9"/><path d="M18 5a7 7 0 0 0 0 14"/><path d="M4 15l2-6M6.5 15l2-6M9 15l2-6"/>` },
  { id: 'ovn', label: 'Ovn', body: `<path d="M3 12h18" stroke-width="4.5"/>` },
  { id: 'koblingsboks', label: 'Koblingsboks, påvegg', body: `<circle cx="12" cy="12" r="4" fill="currentColor"/>` },
  { id: 'koblingsboks-innfelt', label: 'Koblingsboks, innfelt', body: `<circle cx="12" cy="12" r="4"/>` },
  { id: 'lysfoler', label: 'Lysføler', body: `<rect x="3" y="3" width="18" height="18"/><path d="M8 8l9 9"/><path d="M17 17v-3.5M17 17h-3.5"/><circle cx="7" cy="7" r="1.6"/>` },
  { id: 'tilkobling', label: 'Tilkobling, utstyr levert av andre', body: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>` },
  // Svakstrøm (forklaring 30.10: data/tele, adgang, brann i samme stil).
  { id: 'rack', label: 'Rack, for data', body: `<rect x="4" y="4" width="16" height="16"/>` },
  { id: 'data-dobbel', label: 'Uttak, data dobbel', body: `<path d="M2 12h8"/><path d="M10 5v14"/><path d="M10 5h3M10 19h3"/><path d="M9 21.5l3-3"/><text x="0" y="0" transform="translate(18.5 12) rotate(90)" text-anchor="middle" dominant-baseline="central" font-size="6.5" font-family="sans-serif" fill="currentColor" stroke="none">2d</text>` },
  { id: 'fiber-dobbel', label: 'Uttak, fiber dobbel', body: `<path d="M2 12h8"/><path d="M10 5v14"/><path d="M10 5h3M10 19h3"/><path d="M9 21.5l3-3"/><text x="0" y="0" transform="translate(18.5 12) rotate(90)" text-anchor="middle" dominant-baseline="central" font-size="6.5" font-family="sans-serif" fill="currentColor" stroke="none">2f</text>` },
  { id: 'tele-dobbel', label: 'Uttak, tele dobbel', body: `<path d="M2 12h8"/><path d="M10 5v14"/><path d="M10 5h3M10 19h3"/><path d="M9 21.5l3-3"/><text x="0" y="0" transform="translate(18.5 12) rotate(90)" text-anchor="middle" dominant-baseline="central" font-size="6.5" font-family="sans-serif" fill="currentColor" stroke="none">2t</text>` },
  { id: 'adresseledd', label: 'Adresseledd', body: `<rect x="4" y="3" width="16" height="18"/><path d="M8 6.5v7"/><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none"/><path d="M11.5 17l2.75-10 2.75 10M12.6 13.5h3.3"/>` },
  { id: 'alarmsender', label: 'Alarmsender', body: `<rect x="1" y="6.5" width="22" height="11"/><text x="12" y="12.3" text-anchor="middle" dominant-baseline="central" font-size="6" font-family="sans-serif" fill="currentColor" stroke="none">Al.send</text>` },
  { id: 'sirene', label: 'Alarmsirene', body: `<path d="M2 12h6"/><path d="M8 6v12l11-6z"/>` },
  { id: 'summer', label: 'Alarmsummer', body: `<path d="M2 12h8"/><path d="M10 6v12"/><path d="M18 6a6 6 0 0 0 0 12"/>` },
  { id: 'dorholder', label: 'Dørholder', body: `<circle cx="12" cy="9" r="5"/><path d="M12 14v6M8 20h8"/>` },
  { id: 'ir-detektor', label: 'IR-detektor', body: `<rect x="2" y="9" width="12" height="7"/><path d="M14 12.5l4-5-1 4 4-5"/><path d="M19.5 6.5l1.5-.5-.3 1.6"/>` },
  { id: 'kamera', label: 'Kamera', body: `<rect x="2" y="7" width="15" height="10"/><path d="M17 10l4-1.5v7L17 14"/>` },
  { id: 'kamera-dome', label: 'Kamera, dome', body: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>` },
  { id: 'kortleser', label: 'Kortleser', body: `<rect x="2" y="7" width="20" height="10"/><path d="M6 9.5v5"/>` },
  { id: 'kortleser-tastatur', label: 'Kortleser m/tastatur', body: `<rect x="2" y="7" width="20" height="10"/><path d="M5 9.5v5"/><rect x="10" y="9" width="9" height="6"/><path d="M10 12h9M13 9v6M16 9v6"/>` },
  { id: 'inngangsenhet', label: 'Inngangsenhet', body: `<rect x="4" y="3" width="16" height="18"/><path d="M8.5 6.5v7"/><circle cx="8.5" cy="17" r="1" fill="currentColor" stroke="none"/><path d="M15 6v12"/>` },
  { id: 'utgangsenhet', label: 'Utgangsenhet', body: `<rect x="4" y="3" width="16" height="18"/><path d="M8.5 6.5v7"/><circle cx="8.5" cy="17" r="1" fill="currentColor" stroke="none"/><ellipse cx="15" cy="12" rx="2.3" ry="4.5"/>` },
  { id: 'nokkelsafe', label: 'Nøkkelsafe', body: `<rect x="1" y="7" width="22" height="10"/><circle cx="6" cy="12" r="2.3"/><path d="M8.3 12H19v2.5M16 12v2"/>` },
  { id: 'blinklampe', label: 'Roterende blinklampe', body: `<circle cx="12" cy="12" r="8"/><path d="M12 12 6.3 6.3A8 8 0 0 1 17.7 6.3Z" fill="currentColor"/><path d="M12 12 6.3 17.7A8 8 0 0 0 17.7 17.7Z" fill="currentColor"/>` },
  { id: 'magnetkontakt', label: 'Magnetkontakt', body: `<path d="M4 19.5a8 8 0 0 1 16 0"/><path d="M12 6.5l5.5 13h-11z" fill="currentColor"/>` },
  { id: 'nodapner', label: 'Nødåpner, KAC', body: `<rect x="3" y="3" width="18" height="18"/><circle cx="7" cy="12" r="1.8"/><circle cx="15.5" cy="6.8" r="1.4" fill="currentColor" stroke="none"/><path d="M15 9l-2.3 4.2 2.6 1.8-.8 3.8M12.7 13.2 10.5 15M14.8 10.6l3.2 1.2"/>` },
  { id: 'ranskontakt', label: 'Ranskontakt', body: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.6"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>` },
  { id: 'utpasseringsknapp', label: 'Utpasseringsknapp', body: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="4"/>` },
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
