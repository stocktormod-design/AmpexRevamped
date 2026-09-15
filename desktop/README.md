# Ampex Kontor

Kontor-PC-ens utgave av Ampex. Tauri v2 + React + TypeScript, som besluttet
18. august — begrunnelsen står i `docs/DESKTOP_OG_IMPORT.md` og skal ikke tas
opp igjen.

Maskinen dette kjører på skal etter hvert gjøre tre jobber: kontorflaten,
GPU-baken (Pool Exe som sidecar) og SpeedyCraft-importen. Det er derfor det er
én app og ikke tre.

## Kom i gang

```
cd desktop
npm install
cp .env.example .env      # fyll inn Supabase-URL og anon-nøkkel
npm run dev               # http://localhost:5174 i nettleseren
```

`npm run dev` kjører bare nettdelen. Selve skrivebordsappen krever Rust:

```
# én gang, fra https://rustup.rs
rustup default stable
npm run tauri icon ../assets/icon.png   # genererer icons/ i alle størrelser
npm run tauri dev
```

Rust er **ikke installert på denne maskinen ennå**, så `src-tauri/` er skrevet
men ikke kompilert. Nettdelen (`npm run build`) og typene er verifisert.

## Kommandoer

| Kommando | Hva den gjør |
|----------|--------------|
| `npm run dev` | Vite på port 5174 (fast — Tauri peker på den) |
| `npm run build` | `tsc --noEmit` og produksjonsbygg til `dist/` |
| `npm run tauri dev` | Skrivebordsappen med hot reload (krever Rust) |
| `npm run tauri build` | NSIS-installer for Windows (krever Rust) |

Selvtesten for importregningen ligger i rota, ikke her:
`npm run verify:prisfil-plan`.

## Hvordan den henger sammen med montørappen

**Delt logikk, aldri delt UI.** `lib/` i rota importeres med `@delt/…`:
EFO/NELFO-parseren, prisreglene, varegruppene, importplanen. Det er den
gjenbruken som betyr noe.

UI-et er skrevet fra bunnen, og det er med vilje. Et kontor-ordresystem er tette
tabeller, tastatur og flere ruter samtidig; montørappen er én hånd og berøring.
Radhøyden på skjerm er 30 px, ikke 44. Fargene er derimot de samme, og de leses
fra `lib/tokens.js` gjennom en virtuell Vite-modul, så paletten har fortsatt
bare ett sted å endres.

**Under 820 px er det likevel én hånd og berøring** — se neste avsnitt. Det er
ikke et brudd på delingen over: det er de samme kontorflatene, lagt om for en
tommel. Montørappens skjermer finnes fortsatt bare i `app/`.

**Kontoret skriver rett mot Supabase.** Montørappen er offline-først via
WatermelonDB fordi telefonen mister dekning i en kjeller. Kontor-PC-en gjør ikke
det, og skal ikke lagre en hel grossistkatalog lokalt bare for å synke den opp
igjen. Regel 2 i `CLAUDE.md` gjelder montørappens skjermer.

## Telefonformen, og appen på hjemskjermen

Kontoret er en PWA: på ampex.no kan «Legg til på Hjem-skjerm» kjøre den uten
adresselinje, med eget ikon. Det er i dag den eneste veien inn i Ampex på en
Android-telefon — `modules/ampex-splat` er kun Apple, og montørappen har ikke
noe Android-bygg.

**Grensa er 820 px**, og den står to steder som MÅ holdes like: konstanten
`TELEFON` i `src/ui/Delt.tsx` og mediespørringen nederst i `src/styles.css`.
744 px (iPad mini i portrett) skal ha telefonformen, 1024 skal ha spaltene.

Tre ting endrer seg under grensa:

1. **Sidemenyen blir en bunnlinje.** Fire flater pluss «Mer», som åpner et ark
   med hele menyen gruppert som i sidemenyen. Rekkefølgen står i `TELEFONORDEN`
   i `App.tsx` og er ikke den samme som sidemenyens — bunnlinja sorteres etter
   hvor ofte en tommel treffer flata, ikke etter arbeidsdagen.
2. **Delt visning blir to flater.** `<Delt>` setter `data-valgt`, og stilarket
   viser lista eller detaljen. Komponenten legger også på et historikksteg, så
   Androids tilbakeknapp går ett hakk opp i stedet for å lukke appen.
3. **Autovalg av første rad slås av.** På skjerm fyller det en tom
   høyrespalte; på telefon ville det kastet deg rett inn i detaljen. Flatene
   spør `paaTelefon()` før de velger.

Legger du til en flate med delt visning: bruk `<Delt>`, og husk `paaTelefon()`
rundt autovalget. Glemmer du det andre, lander telefonen i detaljen hver gang —
det var akkurat den feilen Internkontroll hadde til den ble målt.

### Montørflatene

Montøren og lærlingen får tre ruter, ikke kontorets ni: **Hjem** (`MinDag` —
dagen din, og ingenting annet), **Ordre** (`MineOrdre` — alle dine, også de
ferdige) og **Meg**, som er nøyaktig den samme ruta kontoret bruker.

Selve ordren tegnes av `src/ui/MontorOrdre.tsx`, som BEGGE flatene bruker — det
er hele grunnen til at den er en egen fil. Den viser hvor, hvem man ringer, hva
som skal gjøres, egne timer og ført materiell. **Ingen priser**, verken kost,
utpris eller sum: en flate som viser hva firmaet tar for jobben blir før eller
siden vist fram til feil person.

Været fra appens Hjem er ikke med. `lib/weather.ts` setter et
`User-Agent`-hode, som met.no og Nominatim krever og som en nettleser ikke har
lov til å sette. Skal det hit, må det gå gjennom en edge function.

Tjenestearbeideren (`public/sw.js`) er bevisst tynn: den mellomlagrer skallet og
de hashede filene, og rører **aldri** noe som ikke ligger på vårt eget opphav.
Kontoret skriver rett mot Supabase, og en mellomlagret ordreliste ville vært feil
data vist som om den var riktig. Den registreres bare i produksjonsbygg.

## Hva som finnes nå

Åtte flater i menyen, fire grupper. **Alt er lesing** bortsett fra skjemamalene,
internkontrollen og det som gjelder deg selv på Meg.

**Timer, Skann, Tilbud og Prisfiler er tatt ut av menyen (14. september)** —
koden ligger fortsatt i `src/ruter/`, det er bare radene i `RUTER` (App.tsx)
som er borte. Dine egne timer ligger på Meg.

**Arbeid** — Ordre (liste og detalj side om side, fem faner, statusfilter),
Prosjekter (rom, oppgaver, deltakere), Tilbud (sum og effektiv status), Timer
(hele firmaets uke, én rad per person).

**Register** — Kunder (org.nr og kildesystem), Varer (kartoteket med
prissammenligning), Prisfiler (import, og alder på siste import per grossist).

**Kvalitet** — Internkontroll (punkter, rutiner, vedtak, lesebekreftelse) og
Skjemaer. Skjemamaler LAGES her (`src/ui/Malbygger.tsx`, 14. september):
seksjoner og punkter i `lib/forms/schema.ts`-formatet, validert med
`validateFirmSections()` før lagring; hver lagring er en ny versjon med
endringsnotat.

**Firma** — innstillinger og ansatte med rolle. (Bake-nodene er tatt ut av
flata 14. september; `lib/skann-lager.ts` har fortsatt innmelding og pool-bryter.)

**Meg** — tema (hvit er standard, papir/kobber som valg, lagret per maskin i
localStorage — se `src/lib/tema.ts`), dine timer uke for uke,
totrinnsbekreftelse (koble til og fra), utlogging og sletting av egen bruker.
Slettingen går gjennom `supabase/functions/slett-bruker`: passordet sjekkes på
serveren, profilen anonymiseres og soft-slettes, innloggingen slettes mykt i
GoTrue, og timer/signaturer beholdes (bokføringsloven). Den eneste eieren i et
firma med andre ansatte får ikke slette seg.

## Roller

Menyen viser bare det rollen faktisk kan bruke. Matrisen ligger i
`lib/kontor-tilgang.ts` med selvtest, og den er en VISNINGSregel — RLS og
databasesperrene er sikkerheten.

**To innganger, ikke én med gradering.** `kontor` gir kontorflatene;
`min.dag` gir montørflatene. Ingen rolle har begge, og selvtesten håndhever
det. En montør er ikke en kontorbruker med færre knapper — han får et annet
sett ruter (`MONTOR_RUTER` i `App.tsx`), og å skrive `#/ik` i adressefeltet
gir ham fortsatt bare sin egen Hjem.

Montør og lærling sto med tomme rettighetslister fram til 15. september, med
begrunnelsen «alt de trenger ligger i appen på telefonen». Det holdt ikke:
appen er iOS-bare, så en montør med Android hadde ingen vei inn i det hele
tatt.

«Kan godkjenne faglig» kommer fra `kan_godkjenne_faglig()` i databasen, ikke
fra rollen. En installatør er ikke automatisk firmaets faglig ansvarlige.

## Regnestykkene bor i rota, ikke her

Fakturagrunnlaget kommer fra `lib/invoicing.ts`, avviket mellom en godkjenning
og nåtilstanden fra `lib/approvals-calc.ts`, importplanen fra
`lib/pricefile/plan.ts`. Alle tre er rene, alle tre har selvtest, og
montørappen bruker de samme. To regnestykker på samme faktura er ett for mye.

## Hva som ikke finnes

Å skrive fra kontoret (rette en føring, godkjenne faglig, markere fakturert),
poolnoden (innmelding og køvisning) og SpeedyCraft-importen. Rekkefølgen og
begrunnelsen står i `docs/STATUS.md`.
