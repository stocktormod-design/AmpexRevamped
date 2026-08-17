# Roadmap og åpne beslutninger — august 2026

Oppsummering av en lang planleggingsøkt. Skrevet så det kan leses uten å ha vært
med i samtalen, og så det kan tas med inn i møter med EFO, grossister og kunder.

---

## Gjort i denne økten

| Hva | Hvor | Status |
|-----|------|--------|
| UX-opprydding etter ekstern review | `app/(app)/index.tsx`, `ordre/[id].tsx` | Ferdig, typecheck grønn |
| EFO/NELFO 4.0-parser + fixture + selvtest | `lib/pricefile/`, `tools/` | Ferdig, alle sjekker passerer |
| Ampex public pool, rettferdig kø, versjonssperre, køposisjon | `supabase/migrations/20260817200000_ampex_public_pool.sql` | Skrevet, **ikke kjørt mot database** |

### UX-endringene i detalj

- **Døde knapper fjernet som knapper.** `Timeføring`, `Skann` og `Avvik` hadde
  ingen handling. De rendres nå som `View` med «Kommer»-merke — ingen trykkflate,
  ingen haptikk. En knapp som ikke svarer koster tillit i felt.
- **Dokumentasjon viser `2/5`** i stedet for «2 fullført». Nevneren er alle maler.
  Materiell fikk bevisst *ikke* progress — det finnes ingen ekte nevner der.
- **Sveip-til-slett på materiell**, som erstattet `onLongPress` og hjelpeteksten
  «Hold inne en linje for å slette». Sveipet avdekker, trykket sletter — to ledd,
  fordi hansker og bevegelse gir utilsiktede sveip.
- **LiDAR slått fra to seksjoner til én** med segmentvalg. Antallet står på det
  uvalgte segmentet så innhold aldri gjemmes. Fjernet én overskrift, én
  legg-til-knapp og én permanent hint-tekst.
- **Status: én primærknapp** utledet fra den lineære flyten, resten bak «Endre
  status». Ingen funksjonalitet fjernet, bare rangert.

---

## Blokkert, og hvorfor

### 1. Prisfil-parseren er ikke bevist mot virkeligheten

Parseren er korrekt mot spec E-NVare4.0r4, men fixturen er **håndskrevet av meg**.
Trenger én ekte `V4*`- eller `P4*`-fil fra Onninen, Solar eller Ahlsell.

Legg den i `lib/pricefile/fixture/` og kjør `npm run verify:pricefile` — avvikslisten
viser umiddelbart hva som er tolket feil. Uten dette tør jeg ikke bygge
prisimport, terskler eller bestilling oppå, fordi en feiltolket prisfil gir feil
priser med selvtillit.

### 2. SpeedyCraft-import krever en ekte database

SpeedyCraft er laget av Devinco AS. Databasen er **MSSQL**, standardinstans
`SPEEDYSQL`, klienter kobler på servernavn/IP. Kunden eier maskinen, så vi har
full lesetilgang uten leverandørens velsignelse — mye lettere enn å migrere fra
en sky-SaaS.

Men skjemaet varierer mellom versjoner, så importen må starte med et
oppdagelsessteg mot `INFORMATION_SCHEMA`. Det kan ikke skrives blindt.

**Sjekk først:** SpeedyCraft integrerer mot Uni Micro og Dynamics, så det finnes
sannsynligvis en dokumentert eksportflate. Er den god nok, er den mer robust mot
versjonsforskjeller enn å lese tabeller direkte.

Strategien når vi kommer dit: **ikke migrer alt.** Kunderegister og åpne ordre som
levende data, ferdig dokumentasjon fordi oppbevaringsplikten krever det, og resten
som en full dump i R2 med søkbart arkiv. Det dekker både plikten og «jeg kan ikke
miste dataene mine» uten å kartlegge et fremmed skjema i detalj.

**Krav som må inn før første import:** hver importert rad beholder `source_system`
og `source_id`, og importen er upsert. Firmaer kjører begge systemer parallelt i
uker — importen må tåle å kjøres om igjen. Billig nå, dyrt å ettermontere.

### 3. Migrasjonen for public pool er ikke kjørt

Skrevet, men ingen database å kjøre den mot herfra. Må verifiseres med
`supabase db reset` eller mot et branch-prosjekt før den slippes løs.

### 4. Tegnings-skjemaet er ikke rørt

Bevisst utelatt. Endringene henger sammen (WatermelonDB-skjemaversjon 21 → 22,
modellfiler, Supabase-migrasjon, sync-RPC) og halvferdig over natta er verre enn
ikke startet. Spec'en står under.

---

## Tegningssamhandling — spec, ikke bygget

Målet: lærling, montør, bas og prosjektleder på samme tegning, og enkelt bytte av
fag og revisjon.

Det som allerede finnes: `drawing` har `plan` og `discipline`, `room` har polygon
og kobling til tegning, `drawing_loop` tegner kurser med farge og noder, `task` er
knyttet til rom med `assigned_to`, `project_member` har rolle.

### Tre hull

**1. `drawing_markup` er én blob per tegning.** Én rad med `data` som tekst, ingen
forfatter, ingen status. Det gjør «lærling foreslår, bas godkjenner» *umulig*.

Må bli rader:

```
drawing_markup: created_by, visibility ('privat' | 'publisert'), status, kind, data
```

**Privat til du publiserer** er kjernen — folk tegner ikke hvis alt de kladder er
synlig for basen med en gang. Private notater er halve nytten. Og det gir
lærling-flyten gratis: publisering er det som utløser bas-godkjenning. Samme knapp,
to formål. Passer også offline-først — det private laget trenger aldri synke.

**2. `task` henger på `room_id`, ikke på koordinat.** Kjernen i både Fieldwire og
Dalux er en **pin på et punkt** med bilde, ansvarlig og status. «Avvik i stue» er
en beskjed; en pin ved den konkrete boksen er en arbeidsordre. Trenger
`drawing_id` + `x`,`y`.

**3. `drawing` har ingen revisjon.** Ny revisjon → forrige merkes avløst men
slettes aldri → rom, kurser og pins følger med → **og overlegget viser hva som
endret seg** (Bluebeams Overlay Pages). En montør som får «rev C er lastet opp»
aner ikke om det angår ham; ser han at bare kjøkkenet endret seg, vet han det på
ett sekund. Pins som ligger i et endret område må flagges.

### Fag er lag, ikke bytte

En elektriker vil ha byggtegningen synlig under — han må vite hvor veggene står —
pluss sitt eget fag, og av og til VVS for kollisjoner. Bygg som fast underlag,
øvrige fag som flervalgs-toggles. Gjenbruk den scrollbare `Chip`-raden fra
`ordre/index.tsx`; flytende nederst i tommelsonen, ikke øverst.

### `source` på tegning

`lokal` (vi utsteder revisjoner) eller `ekstern` (publisert fra Dalux e.l.,
grunntegning skrivebeskyttet). Prinsippet som får begge til å fungere med samme
kode: **as-built er alltid et lokalt lag oppå grunntegningen, uansett hvor
grunntegningen kom fra.**

---

## AI-en — hva som mangler

29 verktøy i dag, hvorav sju er NEK 400-bevisste elektroberegninger. Moaten er at
fagkalkulatoren og skrivetilgangen til ordresystemet ligger i **samme løkke**.

### Største hull: materiell

Timeføring ✅ (`foer_timer`, `mine_timer`), dokumentasjon ✅, ordre ✅, **materiell
og lager ❌ — ingen verktøy i det hele tatt.** Handlingen montøren gjør flest
ganger om dagen.

To ulike handlinger:

- **`legg_til_materiell`** — fritekst på ordren (fakturagrunnlag, §36).
  `ordre/material.tsx` er allerede fritekst og slår ikke opp i `products`. Lav
  risiko, ingen katalogmatching, ingen beholdning som kan bli feil. **Ta denne
  først.**
- **`ta_ut_materiell`** — mot `products`, rører lagerbeholdning. Krever
  disambiguering når matchen er usikker, og bør lande i **kurven** (`cart.ts`) så
  montøren ser antallet før commit. AI-en fyller kurven, mennesket gjennomfører.

### Lesetilbakemelding

Alt som kan mishøres skal være hørbart:

> «Tre stykk Nelko infelt stikk 1,5 — ut fra Bil 2, ført på Storgata 4. Stemmer det?»

Pronomen skjuler nøyaktig det som kan være feil. «Tre» og «tretten» er den
klassiske bommen og må sies tilbake som tall. **Ja/nei-spørsmål kun når modellen
er sikker** — er varematchen usikker, still det åpne spørsmålet. En montør på en
stige svarer «ja» refleksivt.

### Bekreft én gang til slutt

Ikke per handling. Økta har allerede en `checking`-fase:

> «Tre ting: 2,5 timer på Storgata, 40 meter TFXP, og spenningsfallet i
> dokumentasjonen. Fører jeg dem?»

Per handling gir «vil du at jeg…» ti ganger per økt, og kolliderer med den egne
systemprompt-regelen «ALDRI MAS» (linje 125).

### Beregningene fordamper

`spenningsfall` regner ut, modellen sier det høyt, og så er det borte. For en
elektriker er en beregning som ikke er dokumentert en beregning som ikke skjedde.
De bør kunne landes som en datert, attribuerbar notatlinje på ordren — med
inndataene synlige, og aldri smeltes stilltiende inn i et signert skjema.

### Arkitektur før flere verktøy

`mine_timer`, `mine_prosjekter`, `mine_ordrer`, `mine_paaminnelser` er fire
verktøy som er ett spørsmål. Jo flere verktøy, jo dårligere velger modellen. Slå
sammen først, ellers ender vi på 80 verktøy og en assistent som velger feil.

Beregningene skal derimot forbli eksplisitte — de er deterministiske og
sikkerhetsrelevante. Modellen resonnerer, `spenningsfall` avgjør.

### Største faglige hull

`strømføringsevne` med korreksjonsfaktorer (forlegging, samlet føring,
omgivelsestemperatur). `koordiner_kabel_vern` tar `kabel_Iz_A` som *input* i dag —
den bør kunne regnes ut. Bygg den på **produsentdata** (Nexans, Draka, ABB), som
er fritt publisert og mer presist enn generisk tabelloppslag.

### Grenser som ikke skal pushes

- **Samsvarserklæringen skal AI-en aldri signere.** Fylle ut: ja. Signere: aldri.
  Bør stå eksplisitt i systemprompten.
- **NEK 400 er opphavsrettsbeskyttet.** Regn og henvis til punktnummer — det
  gjøres allerede pent i `spenningsfall`. Gjengi aldri tekst eller tabeller.
- **Aldri råd om arbeid under spenning.**
- **Rollegating i koden, ikke i prompten.** `foer_timer` sjekker medlemskap i SQL.
  En modell kan overtales, en `if` kan ikke.
- **Offline-ærlighet.** Kalkulatorene er lokale, modellen er det ikke. AI-en må
  aldri påstå at noe er lagret som ikke er det.

---

## LiDAR — kalibrering av målet

Kjerneinnsikten fra økten: **AR er den vanskeligste anvendelsen, ikke den
viktigste.**

- **Dalux løser ikke justeringen med LiDAR.** TwinBIM ber brukeren peke kameraet
  mot gulvet og så flytte modellen manuelt med fingrene mot vegger og søyler.
  Markedslederen lar mennesket gjøre jobben, fordi automatisk registrering i et
  halvferdig bygg er uløst.
- Derfor: for AR betyr **relativ registrering mer enn absolutt mesh-kvalitet**.
  Et støyete skann som fester seg presist er mer verdt enn et vakkert som drifter.
  Prøv `ARWorldMap` (på enheten, offline, gratis) før eksterne SDK-er.
- **Niantic NSDK 4.0 eksponerer VPS2 for Swift**, ikke bare Unity — Unity er
  altså ikke påkrevd. Men VPS krever nett (bryter regel 2 i en kjeller), koster
  enterprise-penger, og Niantic la ned lightship.dev i februar 2026.

### Der LiDAR faktisk er banebrytende

1. **Tegninger til jobber som aldri hadde tegninger.** Dalux, Fieldwire og
   Bluebeam forutsetter alle at en tegning finnes. I norsk rehab og service gjør
   den ikke det. `room.shape` og `room.scan_path` er allerede modellert.
2. **Måling uten målebånd.** Kabellengder, areal, takhøyde — nøyaktighetskravet
   for mengdeuttak er *trivielt* oppfylt av dagens skann. Dette er inputen til
   befaring-til-tilbud, som er den høyeste kommersielle verdien vi fant.
3. **Skjult anlegg dokumentert** før lukking.

Alle tre krever mindre presisjon enn AR og treffer større marked.

### Bakekapasitet

`bake.py` kjører **i dag helt på CPU** — `ScalableTSDFVolume` og
`run_*_optimizer` er legacy-API uten CUDA-vei uansett plattform. `torch` brukes
bare til å rapportere GPU-navn. Å legge et grafikkort i poolen nå gir null.

CUDA-porten deler seg i tre:

| Del | Kostnad |
|-----|---------|
| Tekstur | Nesten gratis — `_texture` bruker alt tensor-API-et (`project_images_to_albedo`), bare flytt device |
| Fusjon | Moderat — bytt til `o3d.t.geometry.VoxelBlockGrid` |
| Refine | **Den vonde** — Zhou-Koltun finnes kun som legacy, ingen CUDA-variant. Må reimplementeres eller erstattes |

Etter porten: anslagsvis 1–3 min per skann mot 5–20 i dag. Mål baketiden med
`worker/tools/make_fixture.py` + `run_bake.py` før noe kjøpes.

**Kapasitetsregnestykket:** ved 2 min/skann tar én node 30–35 skann i et
to-timers burst ved dagens slutt (elektrikere skanner ikke jevnt fordelt). Det er
**~10–12 firmaer per node**. Fire firmaer er én node med god margin.

Og med Pool Exe hos kunden skalerer kapasiteten automatisk med kundemassen — hvert
firma tar med sin egen node, og da forsvinner både kø, båndbredde over internett
og strømregningen. Ampex' egen pool trenger bare betjene de som ikke plugger inn.

**Det som faktisk skalerer med kunder er båndbredde og lagring**, ikke GPU-tid.
Grunnen til node nummer to er **redundans, ikke kapasitet**.
