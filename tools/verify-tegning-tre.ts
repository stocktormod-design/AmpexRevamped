/**
 * Selvtest for tegningsmappene (bygg → fag → tegninger). Samme mønster som
 * verify-kalender.
 *
 *   npm run verify:tegning-tre
 *
 * Feilen som koster her er en tegning som blir usynlig: en mappe flyttet inn
 * i seg selv blir en sirkel ingen skjerm når, og en slettet mappe som ikke
 * flytter innholdet opp etterlater tegninger som peker på ingenting.
 */
import { tellRekursivt, mappeSti, etterkommere, kanFlyttesTil, mapperITreRekkefolge, slettePlan } from '../lib/tegning-tre'

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

//  Bygg A
//    Elkraft
//      Kurs (undermappe)
//    IKT
//  Bygg B
const mapper = [
  { id: 'a', parentId: null, name: 'Bygg A' },
  { id: 'a-el', parentId: 'a', name: 'Elkraft' },
  { id: 'a-el-kurs', parentId: 'a-el', name: 'Kurs' },
  { id: 'a-ikt', parentId: 'a', name: 'IKT' },
  { id: 'b', parentId: null, name: 'Bygg B' },
]
const tegninger = [
  { folderId: null },        // løs på rota
  { folderId: 'a' },
  { folderId: 'a-el' },
  { folderId: 'a-el' },
  { folderId: 'a-el-kurs' },
  { folderId: 'a-ikt' },
  { folderId: 'b' },
]

// Telling: en mappe teller alt under seg, ikke bare sitt eget nivå.
sjekk('Bygg A teller alle fem tegninger under seg', tellRekursivt('a', mapper, tegninger), 5)
sjekk('Elkraft teller sine to pluss Kurs sin ene', tellRekursivt('a-el', mapper, tegninger), 3)
sjekk('Bygg B teller én', tellRekursivt('b', mapper, tegninger), 1)
sjekk('Ukjent mappe teller null', tellRekursivt('finnes-ikke', mapper, tegninger), 0)

// Sti: leses fra rota og ned.
sjekk('Sti til Kurs', mappeSti('a-el-kurs', mapper), ['Bygg A', 'Elkraft', 'Kurs'])
sjekk('Sti til rot er tom', mappeSti(null, mapper), [])
sjekk('Sti stopper ved mappe som ikke finnes', mappeSti('finnes-ikke', mapper), [])

// Sti på et tre med sirkel (skal aldri oppstå, men må ikke henge appen).
const sirkel = [
  { id: 'x', parentId: 'y', name: 'X' },
  { id: 'y', parentId: 'x', name: 'Y' },
]
sjekk('Sirkel i tre gir endelig sti (vakt på 20)', mappeSti('x', sirkel).length, 20)

// Syklusvern: seg selv og alt under er sperret, søsken og forelder er lov.
sjekk('Etterkommere av Bygg A', [...etterkommere('a', mapper)].sort(), ['a', 'a-el', 'a-el-kurs', 'a-ikt'])
sjekk('Bygg A kan ikke flyttes inn i seg selv', kanFlyttesTil('a', 'a', mapper), false)
sjekk('Bygg A kan ikke flyttes inn i Kurs (eget barnebarn)', kanFlyttesTil('a', 'a-el-kurs', mapper), false)
sjekk('Bygg A kan flyttes inn i Bygg B', kanFlyttesTil('a', 'b', mapper), true)
sjekk('Elkraft kan flyttes til rota', kanFlyttesTil('a-el', null, mapper), true)
sjekk('Kurs kan flyttes opp til Bygg A', kanFlyttesTil('a-el-kurs', 'a', mapper), true)

// Trerekkefølge: dybde først, så flyttmenyen leser som et tre.
sjekk(
  'Trerekkefølge med dybde',
  mapperITreRekkefolge(mapper).map(x => `${x.dybde}:${x.mappe.id}`),
  ['0:a', '1:a-el', '2:a-el-kurs', '1:a-ikt', '0:b'],
)

// Sletteplan: innholdet går ett hakk opp — til forelderen, eller til rota.
const p1 = slettePlan(mapper[1], mapper, tegninger) // Elkraft
sjekk('Slett Elkraft: innholdet går til Bygg A', p1.nyForelder, 'a')
sjekk('Slett Elkraft: Kurs blir med opp', p1.barn.map(m => m.id), ['a-el-kurs'])
sjekk('Slett Elkraft: begge tegningene flyttes', p1.tegninger.length, 2)
const p2 = slettePlan(mapper[0], mapper, tegninger) // Bygg A
sjekk('Slett Bygg A: innholdet går til rota', p2.nyForelder, null)
sjekk('Slett Bygg A: bare direkte barn flyttes (Kurs følger Elkraft)', p2.barn.map(m => m.id), ['a-el', 'a-ikt'])
sjekk('Slett Bygg A: bare den direkte tegningen flyttes', p2.tegninger.length, 1)
sjekk('Slett tom mappe: ingenting å flytte', slettePlan(mapper[4], mapper, []).barn.length + slettePlan(mapper[4], mapper, []).tegninger.length, 0)

// Etter slett av Elkraft skal ingen tegning peke på en mappe som ikke finnes.
const etter = mapper.filter(m => m.id !== 'a-el').map(m => p1.barn.includes(m) ? { ...m, parentId: p1.nyForelder } : m)
const etterTegninger = tegninger.map(d => p1.tegninger.includes(d) ? { folderId: p1.nyForelder } : d)
const kjente = new Set(etter.map(m => m.id))
sjekk('Ingen foreldreløse tegninger etter sletting', etterTegninger.filter(d => d.folderId && !kjente.has(d.folderId)).length, 0)
sjekk('Ingen foreldreløse mapper etter sletting', etter.filter(m => m.parentId && !kjente.has(m.parentId)).length, 0)
sjekk('Bygg A teller fortsatt fem etter at Elkraft er borte', tellRekursivt('a', etter, etterTegninger), 5)

if (feil > 0) {
  console.error(`\n${feil} feil`)
  process.exit(1)
}
console.log('\nAlle påstander passerer.')
