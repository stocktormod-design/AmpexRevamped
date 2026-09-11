/**
 * Fakturagrunnlag → HTML. Timer og materiell, slik kunden kan regne etter.
 *
 * REN modul; regnestykket kommer fra `lib/invoicing.ts`.
 *
 * To ting holdes UTE med vilje, og begge er samme regel: dokumentet forlater
 * huset.
 *
 *  - **Dekningsbidrag og kostpris.** Firmaets innkjøp angår ikke kunden.
 *  - **Interne notater** (`internal_note` på timelinjer). De er interne per
 *    definisjon — «kunden var sur» skal ikke stå på et ark kunden får. De
 *    kommer aldri inn i `Fakturalinje.beskrivelse` fra `byggFakturagrunnlag`,
 *    men regelen skrives her fordi det er her den ville blitt brutt.
 *
 * «Ikke med på fakturaen» tas derimot MED når det er noe kunden bør vite om
 * (arbeid som ikke faktureres). Det er en kvalitet, ikke en lekkasje: det
 * forklarer hvorfor det ikke står mer på regningen.
 */
import { esc, formatKr } from './dokument'

export type FakturalinjeUt = {
  kilde: 'materiell' | 'timer' | 'tillegg'
  beskrivelse: string
  antall: number
  enhet: string
  enhetsprisOre: number
  rabattProsent?: number
  mva: string
  nettoOre: number
  elnummer?: string | null
}

export type FakturaSumUt = {
  nettoOre: number
  bruttoOre: number
  mvaFordeling: { mva: string; nettoOre: number; mvaOre: number }[]
}

const KILDE_TITTEL: Record<FakturalinjeUt['kilde'], string> = {
  materiell: 'Materiell',
  timer: 'Arbeid',
  tillegg: 'Tilleggsarbeid',
}

function tall(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

function linjeRad(l: FakturalinjeUt): string {
  // Timelinjer har notatene på egne linjer etter overskriften — samme deling
  // som skjermen gjør, ellers blir raden en vegg av tekst.
  const [forste, ...resten] = l.beskrivelse.split('\n')
  const spesifikasjon = [
    `${tall(l.antall)} ${esc(l.enhet)} × ${formatKr(l.enhetsprisOre)}`,
    l.rabattProsent ? `− ${tall(l.rabattProsent)} %` : '',
  ].filter(Boolean).join('  ')
  return `<tr>
    <td>${esc(forste)}
      ${l.elnummer ? `<div class="punkt-hjelp">El-nr ${esc(l.elnummer)}</div>` : ''}
      ${resten.length ? `<div class="punkt-hjelp">${resten.map(esc).join('<br>')}</div>` : ''}
    </td>
    <td class="tall">${spesifikasjon}</td>
    <td class="tall">${formatKr(l.nettoOre)}</td>
  </tr>`
}

export function fakturaInnholdHtml(opts: {
  linjer: FakturalinjeUt[]
  sum: FakturaSumUt
  mvaEtikett: (mva: string) => string
  /** Arbeid som bevisst ikke faktureres — forklarer regningen. */
  ikkeFakturert?: { beskrivelse: string; grunn: string }[]
}): string {
  const { linjer, sum, mvaEtikett, ikkeFakturert = [] } = opts

  const grupper = (['timer', 'materiell', 'tillegg'] as const)
    .map(kilde => ({ kilde, linjer: linjer.filter(l => l.kilde === kilde) }))
    .filter(g => g.linjer.length > 0)

  const gruppeHtml = grupper.map(g => `
    <h2>${KILDE_TITTEL[g.kilde]}</h2>
    <table>
      <thead><tr><th>Beskrivelse</th><th class="tall">Spesifikasjon</th><th class="tall">Beløp</th></tr></thead>
      <tbody>${g.linjer.map(linjeRad).join('')}</tbody>
    </table>
  `).join('')

  const mvaRader = sum.mvaFordeling
    .map(m => `<tr class="sum-rad"><td colspan="2" class="tall">Mva ${esc(mvaEtikett(m.mva))} av ${formatKr(m.nettoOre)}</td><td class="tall">${formatKr(m.mvaOre)}</td></tr>`)
    .join('')

  const utelattHtml = ikkeFakturert.length
    ? `<h2>Utført, men ikke fakturert</h2>
       <table><tbody>${ikkeFakturert.map(u =>
         `<tr><td>${esc(u.beskrivelse)}</td><td class="tall">${esc(u.grunn)}</td></tr>`).join('')}</tbody></table>`
    : ''

  return `
    ${gruppeHtml}

    <h2>Sum</h2>
    <table><tbody>
      <tr class="sum-rad"><td colspan="2" class="tall">Sum eks. mva</td><td class="tall">${formatKr(sum.nettoOre)}</td></tr>
      ${mvaRader}
      <tr class="sum-rad sum-total"><td colspan="2" class="tall">Å betale</td><td class="tall">${formatKr(sum.bruttoOre)}</td></tr>
    </tbody></table>

    ${utelattHtml}
  `
}
