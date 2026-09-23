/**
 * Selvtest for egenskaper ut av varenavn.
 *
 *   npm run verify:egenskaper
 *
 * Navnene er ekte, fra Solars standardfil (23.09). Halvparten av påstandene er
 * det tolkeren skal LA VÆRE: et mål er ikke en kabel, en downlight er ikke en
 * automat. Et filter som viser feil vare på «3G2,5» er verre enn ingen filter.
 */
import { egenskaperFraNavn as e, egenskapTekster } from '../lib/katalog/egenskaper'

let feil = 0
function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

// ── Kabel ─────────────────────────────────────────────────────────────────
sjekk('PFXP 3G2,5 300/500V', [e('PFXP 3G2,5 ER 300/500V S200').leder, e('PFXP 3G2,5 ER 300/500V S200').spenning], ['3G2,5', '300/500 V'])
sjekk('PFSP 4X6/6 1KV', [e('PFSP 1KV 4X6/6 TR 10021726').leder, e('PFSP 1KV 4X6/6 TR 10021726').spenning], ['4×6/6', '1 kV'])
sjekk('PFSP 2X1,5/1,5', e('PFSP ER CU/AL 2X1,5/1,5 TR').leder, '2×1,5/1,5')
sjekk('PFXP 4G16', e('PFXP 1KV 4G16 TR 10022219').leder, '4G16')
sjekk('FKX 90 2x1,5 downlight', e('FKX 90 2x1,5 DOWNLIGHT sn 50 10225201').leder, '2×1,5')
sjekk('TFXP 2x1,5mm² sort', [e('TFXP MR Flex 2x1,5mm² Sort 0,6 1019166').leder, e('TFXP MR Flex 2x1,5mm² Sort 0,6 1019166').farge], ['2×1,5', 'Sort'])
sjekk('parkabel 4x2x0,5', e('RE2Y(ST)Y 4x2x0,5 mm² Sort 1002461').leder, '4×2×0,5')
sjekk('enleder 0,75 mm² grå', [e('H05 Z-K 0,75 mm² Grå Halogenfr').leder, e('H05 Z-K 0,75 mm² Grå Halogenfr').farge], ['0,75 mm²', 'Grå'])
sjekk('lysblå før blå', e('H05 Z-K 0,5 mm² Lysblå Halogen 1006507').farge, 'Lysblå')
sjekk('kabelsko 25 MM2', e('KABELSKO KHD  25 MM2 M12 DIN 4').leder, '25 mm²')

// ── Det som IKKE er kabel ─────────────────────────────────────────────────
sjekk('koblingsboks 200x200x130 er ikke en leder', e('Koblingsboks, 200x200x130 OPCP202013GE').leder, undefined)
sjekk('dør 1975X800 er ikke en leder', e('DØR H IP41 PR.S 1975X800 8PQ2197-8BA05').leder, undefined)
sjekk('jordfeilbryter 4X63A er strøm, ikke leder', [e('JORDFEILBRYTER 4X63A 30MA A CDA463N').leder, e('JORDFEILBRYTER 4X63A 30MA A CDA463N').stromA], [undefined, 63])
sjekk('downlight D300 er ikke en D-automat', [e('Downlight UNIV RING D300 WT 4099854789526').kurve, e('Downlight UNIV RING D300 WT 4099854789526').stromA], [undefined, undefined])
sjekk('M12-plugg er ikke 12 V', e('M12 8-pol rett hun 5m kabel XZCP29P11L5').spenning, undefined)

// ── Vern ──────────────────────────────────────────────────────────────────
const rcbo = e('iC60 RCBO 2P 20A B 30MA JFA A9D37220')
sjekk('RCBO: B20, 30 mA, 2P', [rcbo.kurve, rcbo.stromA, rcbo.jordfeilMa, rcbo.poler], ['B20', 20, 30, '2P'])
const jfa = e('JORDFEILAUTOMAT DS201M C6 30mA 2CSR275580R1064')
sjekk('jordfeilautomat C6 30 mA', [jfa.kurve, jfa.jordfeilMa], ['C6', 30])
const aut = e('AUTOMAT  10KA3+N-POL C32 5SY4 5SY4632-7')
sjekk('automat 3+N-pol C32', [aut.kurve, aut.poler], ['C32', '3P+N'])
sjekk('automat C 1,6A', e('AUTOMAT  1-POL C 1,6A 5SY7 5SY7115-7').kurve, 'C1,6')
sjekk('1-pol', e('AUTOMAT  1-POL C 1,6A 5SY7 5SY7115-7').poler, '1P')

// ── Stikk og lys ──────────────────────────────────────────────────────────
const stikk = e('STIKKONTAKT 4P+J, 400V, 16A 1030-SP')
sjekk('stikkontakt 4P+J 400V 16A', [stikk.poler, stikk.spenning, stikk.stromA], ['4P+J', '400 V', 16])
sjekk('stikkontakt IP44', e('Stikkontakt 316-6 IP44 QC Topp 11905').ip, 'IP44')
sjekk('dobbel stikkontakt sort', e('Dobbel stikkontakt sort 460412').farge, 'Sort')
sjekk('IP69K', e('BELG IP69K SORT  FOR Ø40 SOPPK ZBZ28').ip, 'IP69K')
sjekk('IP2X', e('Deksel  MSW IP2X xE Light XLMWL18').ip, 'IP2X')
const lys = e('URBINO 53W 6050lm 3000K O26 KL 130222.5L442.101.854')
sjekk('armatur 53 W, 6050 lm, 3000 K', [lys.effektW, lys.lumen, lys.kelvin], [53, 6050, 3000])
sjekk('4K er 4000 K', e('DUWA IP66 44W 6400LM 4K PC EL- 86 46 065 045').kelvin, 4000)
sjekk('lysfarge /830 er 3000 K', e('DOWNLIGHT 20S/830 PSU-E UGR19 911401552032').kelvin, 3000)
sjekk('lysfarge /927 er 2700 K', e('ZIP 1T TUBE MICRO  HVIT 7W/927 320600').kelvin, 2700)
sjekk('6,8 W', e('DOWNLIGHT ECO 6,8W/CCT HVIT DI SLDOE76').effektW, 6.8)
sjekk('1,1 kW', e('DC1 Frekvensomformer 1,1kW DC1-S2011FB-A20N').effektW, 1100)
sjekk('24 VDC', e('STB KIT 16 UT, 24VDC,0.5A BESK STBDDO3705KS').spenning, '24 VDC')
sjekk('RAL-kode', e('NIPPEL PERFECT M16 4-8 MM RAL7035').farge, 'RAL 7035')

// ── Funnet i hele katalogen (23.09) ───────────────────────────────────────
sjekk('modellkode MP-956 V er ikke en spenning', e('Deksel f/festeplate datauttak MP-956 V').spenning, undefined)
sjekk('gul/grønn er jordlederfargen, ikke grønn', e('Krympeflex 3:1 gul/grønn 12/4 FRZ30120GSH30M').farge, 'Gul/grønn')
sjekk('varmematte 2X0,5M er et mål', e('VARMEMATTE ØS120-2X0,5M 120W').leder, undefined)
sjekk('63A/C gir kurve C63', e('AUT.SIKR C120N 3P 63A/C A9N18364').kurve, 'C63')
sjekk('450/750 V', e('H07Z-K 1X1,5 BLÅ 450/750 V S10 20098375').spenning, '450/750 V')
sjekk('24V AC/DC', e('LED RØD 24V AC/DC LZS:PTML0524').spenning, '24 V')

// ── Merkelappene ──────────────────────────────────────────────────────────
sjekk('merkelapper i fast rekkefølge', egenskapTekster(rcbo), ['B20', '30 mA', '2P'])
sjekk('merkelapper for kabel', egenskapTekster(e('PFXP 3G2,5 ER 300/500V S200')), ['3G2,5', '300/500 V'])
sjekk('et navn uten egenskaper gir ingen', egenskapTekster(e('Skrallenøkkel 21 mm 7 R 21')), [])

if (feil) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nAlle påstander holder.')
