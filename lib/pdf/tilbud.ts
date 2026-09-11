/**
 * Tilbud → HTML. Det bindende dokumentet kunden svarer ja eller nei til.
 *
 * REN modul. Regnestykket kommer ferdig fra `lib/quoting.ts` — dette er
 * gjengivelsen, ikke matematikken.
 *
 * **Dekningsbidraget skal ALDRI ut.** `dbOre`, `dbProsent` og `kostOre` finnes
 * i summen, og de er firmaets innkjøpspris. En PDF sendes videre, videresendes
 * og skrives ut; det er ingen «intern» versjon av et dokument som har forlatt
 * huset. Derfor tar denne funksjonen bare imot det kunden skal se.
 */
import { esc, formatKr, datoNo } from './dokument'

export type TilbudslinjeUt = {
  art: 'materiell' | 'arbeid' | 'tekst'
  beskrivelse: string
  antall: number
  enhet: string
  enhetsprisOre: number
  rabattProsent: number
  nettoOre: number
  elnummer?: string | null
}

export type TilbudSumUt = {
  nettoOre: number
  rabattOre: number
  bruttoOre: number
  mvaFordeling: { mva: string; nettoOre: number; mvaOre: number }[]
}

function tall(n: number): string {
  // Norsk desimalkomma, og ingen unødvendige nuller: «2» og «2,5».
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

export function tilbudInnholdHtml(opts: {
  linjer: TilbudslinjeUt[]
  sum: TilbudSumUt
  /** MVA-etikett per sats («25 %») — kommer fra `mvaLabel` i invoicing. */
  mvaEtikett: (mva: string) => string
  gyldigTil?: string | null
  beskrivelse?: string | null
  /** Vilkår nederst. Uten tekst her sier dokumentet ingenting om hva som gjelder. */
  vilkaar?: string | null
}): string {
  const { linjer, sum, mvaEtikett, gyldigTil, beskrivelse, vilkaar } = opts

  const linjerHtml = linjer.map(l => {
    if (l.art === 'tekst') {
      // Fritekstlinjer har ingen beløp — de er forklaring, ikke pris.
      return `<tr><td colspan="4">${esc(l.beskrivelse).replace(/\n/g, '<br>')}</td></tr>`
    }
    const spesifikasjon = [
      `${tall(l.antall)} ${esc(l.enhet)} × ${formatKr(l.enhetsprisOre)}`,
      l.rabattProsent ? `− ${tall(l.rabattProsent)} %` : '',
    ].filter(Boolean).join('  ')
    return `<tr>
      <td>${esc(l.beskrivelse)}${l.elnummer ? `<div class="punkt-hjelp">El-nr ${esc(l.elnummer)}</div>` : ''}</td>
      <td class="tall">${spesifikasjon}</td>
      <td class="tall">${formatKr(l.nettoOre)}</td>
    </tr>`
  }).join('')

  const mvaRader = sum.mvaFordeling
    .map(m => `<tr class="sum-rad"><td colspan="2" class="tall">Mva ${esc(mvaEtikett(m.mva))} av ${formatKr(m.nettoOre)}</td><td class="tall">${formatKr(m.mvaOre)}</td></tr>`)
    .join('')

  return `
    ${beskrivelse ? `<div style="margin-bottom:12pt">${esc(beskrivelse).replace(/\n/g, '<br>')}</div>` : ''}

    <h2>Tilbudet omfatter</h2>
    <table>
      <thead><tr><th>Beskrivelse</th><th class="tall">Spesifikasjon</th><th class="tall">Beløp</th></tr></thead>
      <tbody>
        ${linjerHtml}
        <tr class="sum-rad"><td colspan="2" class="tall">Sum eks. mva</td><td class="tall">${formatKr(sum.nettoOre)}</td></tr>
        ${sum.rabattOre > 0 ? `<tr class="sum-rad"><td colspan="2" class="tall">Herav rabatt</td><td class="tall">−${formatKr(sum.rabattOre)}</td></tr>` : ''}
        ${mvaRader}
        <tr class="sum-rad sum-total"><td colspan="2" class="tall">Totalt inkl. mva</td><td class="tall">${formatKr(sum.bruttoOre)}</td></tr>
      </tbody>
    </table>

    ${gyldigTil ? `<h2>Gyldighet</h2><div>Tilbudet er gyldig til og med ${esc(datoNo(gyldigTil))}.</div>` : ''}
    ${vilkaar ? `<h2>Vilkår</h2><div class="punkt-hjelp" style="font-size:9pt">${esc(vilkaar).replace(/\n/g, '<br>')}</div>` : ''}
  `
}
