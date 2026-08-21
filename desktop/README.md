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
Radhøyden her er 30 px, ikke 44. Fargene er derimot de samme, og de leses fra
`lib/tokens.js` gjennom en virtuell Vite-modul, så paletten har fortsatt bare
ett sted å endres.

**Kontoret skriver rett mot Supabase.** Montørappen er offline-først via
WatermelonDB fordi telefonen mister dekning i en kjeller. Kontor-PC-en gjør ikke
det, og skal ikke lagre en hel grossistkatalog lokalt bare for å synke den opp
igjen. Regel 2 i `CLAUDE.md` gjelder montørappens skjermer.

## Hva som finnes nå

Åtte flater i tre grupper. **Alt er lesing** bortsett fra prisfilimporten.

**Arbeid** — Ordre (liste og detalj side om side, fem faner, statusfilter),
Prosjekter (rom, oppgaver, deltakere), Tilbud (sum og effektiv status), Timer
(hele firmaets uke, én rad per person).

**Register** — Kunder (org.nr og kildesystem), Varer (kartoteket med
prissammenligning), Prisfiler (import, og alder på siste import per grossist).

**Firma** — innstillinger, ansatte med rolle, bake-noder.

## Roller

Menyen viser bare det rollen faktisk kan bruke. Matrisen ligger i
`lib/kontor-tilgang.ts` med selvtest, og den er en VISNINGSregel — RLS og
databasesperrene er sikkerheten. Montør og lærling slippes ikke inn; alt de
trenger ligger i appen på telefonen.

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
