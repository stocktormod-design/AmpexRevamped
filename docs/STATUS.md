# Status — les denne først

Sist oppdatert: 2026-08-18. Holdes oppdatert; ikke lag daterte kopier.

## Hvor vi står nå

Branch **`grossist-og-pool`** — 4 commits, pushet, ikke merget til `main`.
PR kan opprettes på:
https://github.com/stocktormod-design/AmpexRevamped/pull/new/grossist-og-pool

```
028386c docs: grossistarkitektur, roadmap og hva som er blokkert
861a8ea feat(db): Ampex public pool, rettferdig kø, versjonssperre, køposisjon
587290a feat(pricefile): EFO/NELFO 4.0-parser med fixture og selvtest
fd3e4bb fix(ui): døde knapper, dokumentasjonsprogress, sveip-slett, LiDAR i én seksjon
```

`npm run typecheck` og `npm run verify:pricefile` er grønne.

### Uncommittet i arbeidstreet — bevisst ikke rørt

| Fil | Hva |
|-----|-----|
| `modules/ampex-splat/ios/MeshBakeV2.swift` | Din WIP, 252 linjer endret |
| `modules/ampex-splat/ios/MeshScanPresenter.swift` | Din WIP, 159 linjer endret |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Utracket plan-dokument |

Swift-filene er ditt arbeid — jeg lot dem være fordi jeg ikke vet om de er i en
tilstand du vil feste. **Vil du kjøre `/code-review ultra` på dem, commit dem
først** så diffen fanges av reviewen.

---

## Hva som trengs fra deg

**Én ekte EFO/NELFO-prisfil.** Dette blokkerer hele grossist-sporet — prisimport,
terskler, autobestilling, prissammenligning. Parseren er skrevet mot spec
E-NVare4.0r4, men fixturen er håndskrevet, så den er ikke bevist mot
virkeligheten.

Skaff en `V4*`- eller `P4*`-fil fra Onninen/Elektroskandia, Solar eller Ahlsell,
legg den i `lib/pricefile/fixture/`, og kjør:

```
npm run verify:pricefile
```

Avvikslisten forteller umiddelbart hva som er tolket feil.

**En OAuth2-klient hos Fiken** når regnskapsintegrasjonen skal bygges — den er
inngangsbilletten for å erstatte SpeedyCraft, ikke en utvidelse. Fikens
spesifikasjon er fritt tilgjengelig og uten portvokter, så den kan startes når
som helst. Se `docs/REGNSKAPSINTEGRASJON.md`.

**Én telefon til grossisten** når du vil ha ordretransport: «hvordan sender jeg
ordre elektronisk?» Svaret avhenger av kundeforholdet og kan ikke googles.

---

## Neste steg, i rekkefølge

1. **Merge eller review branchen.** Migrasjonen `20260817200000_ampex_public_pool.sql`
   er **ikke kjørt mot database** — verifiser med `supabase db reset` mot et
   branch-prosjekt før den går i produksjon.

2. **AI-materiellverktøy** — største hullet i «alt administrativt». Timeføring,
   dokumentasjon og ordre finnes; materiell og lager har **ingen** verktøy.
   - `legg_til_materiell` først: fritekst på ordren, ingen katalogmatching, ingen
     beholdning som kan bli feil. Lav risiko.
   - `ta_ut_materiell` etterpå: mot `products`, og skal fylle **kurven**
     (`cart.ts`) — ikke commite uttaket. AI-en fyller, mennesket gjennomfører.
   - Lesetilbakemelding uten pronomen: «Tre stykk Nelko infelt stikk 1,5 — ut fra
     Bil 2, ført på Storgata 4. Stemmer det?»

3. **Slå sammen `mine_*`-verktøyene** til ett spørreverktøy før flere legges til.
   Fire verktøy som er ett spørsmål. Jo flere verktøy, jo dårligere velger
   modellen.

4. **Tegningssamhandling** — spec ligger i `ROADMAP_2026-08.md`. Rekkefølge:
   markeringer som rader med `created_by`/`visibility`/`status` (låser opp mest),
   så pins med koordinat, så revisjoner med overlegg.

5. **Ampex Desktop** — stack besluttet: **Tauri v2 + React + TypeScript**.
   Kontor-PC-en gjør tre jobber i én installer: ordresystem/admin, poolnode
   (Python som sidecar) og SpeedyCraft-import (Rust + `tiberius`, kobler med
   Windows integrated auth uten passord). Se `docs/DESKTOP_OG_IMPORT.md`.

6. **CUDA-porten av `bake.py`** når du vil at GPU-en skal bety noe. Tekstur er
   nesten gratis, fusjon er moderat, **refine (Zhou-Koltun) er den vonde** — den
   finnes kun som legacy uten CUDA-vei.

---

## Beslutninger som er tatt (ikke ta dem opp igjen)

- **EFObasen droppes for v1.** Prisfila fra grossisten dekker behovet, koster
  kunden ingenting, og har kundens egne priser. Standardavtalen tillater dessuten
  ikke videreformidling til tredjepart.
- **Ampex public pool skal finnes**, med egen node først og Ampex som fallback.
- **Aktivering av AI-en er avklart:** to-finger-dobbelttrykk beholdes, `MicButton`
  beholdes. Rist, back tap, dobbeltbank, løft-til-øret, vekkeord, App Intents og
  Flic er alle vurdert og forkastet. **Ikke foreslå en tolvte gest.**
- **AR er den vanskeligste anvendelsen av LiDAR, ikke den viktigste.** De store
  gevinstene — tegning fra skann, måling uten målebånd — krever mindre presisjon
  og treffer større marked.
- **Rist-lytteren bør slettes** (`useShakeListener()` i `app/_layout.tsx:69`).
  50 Hz akselerometer i forgrunnen for ti aktiveringer om dagen. Ikke gjort ennå;
  kommentaren i `app/assistant.tsx` sier dessuten feilaktig at rist er borte.

---

---

## Bake-poolen — Ampex public pool og pool per firma

### Én programvare, to slags noder

`worker/` **er** Pool Exe-en. Det er ikke to produkter. En Ampex-node og en
kundenode kjører identisk kode; forskjellen er én boolean i databasen.

```
worker_nodes.is_public = false   →  privat node (kundens egen PC)
worker_nodes.is_public = true    →  offentlig node (Ampex driver den)
```

Ampex setter `is_public` på sine egne noder. Kunden kan ikke sette den selv —
den ligger bak `service_role`, ikke i innmeldingen.

### Hvordan en node kommer inn i poolen

1. Admin i firmaet ber om en innmeldingskode i appen → `create_worker_enrollment()`
   lager en engangskode med TTL (30 min som standard)
2. Firmaet laster ned Pool Exe, kjører den på kontor-PC-en, taster koden
3. `enroll_worker_node()` bytter koden i et **node-token**. Tokenet lagres bare
   som sha256-hash i basen; klartekst vises én gang
4. Noden hører nå til det firmaet. Tokenet **er** autentiseringen — exe-en kjører
   med anon-nøkkel og trenger ingen brukerinnlogging

### Hvordan jobber fordeles

`claim_scan_job()` avgjør alt, og prioriteringen er **emergent** — det finnes
ingen scheduler, ingen broker, ingen leader election. Bare en `where`-klausul:

| Nodetype | Ser hvilke jobber | Ventetid |
|----------|-------------------|----------|
| Privat | Kun `company_id = node.company_id` | Ingen |
| Offentlig | Alle firmaer med `allow_ampex_pool = true` | Kun jobber eldre enn `public_pool_grace_seconds` (90 s) |

Nådetiden er hele mekanismen: **er firmaets egen node oppe, rekker den alltid
først.** Er den nede eller opptatt, plukker Ampex-poolen opp jobben etter 90
sekunder. Ingen av nodene vet om hverandre.

`for update skip locked` gjør at to noder aldri tar samme jobb, så «plugg inn en
maskin til» virker uten kodeendring.

### Hvorfor det er trygt

**Isolasjonen ligger i SQL, ikke i klienten.** En kunde som dekompilerer eller
modifiserer exe-en kan ikke claime et annet firmas jobber — tokenet mapper til
ett `company_id`, og `claim_scan_job` er `security definer`.

**Kunder som ikke vil ha data utenfor huset** setter `allow_ampex_pool = false`.
Da forlater skannet aldri firmaets egne maskiner. Det er et salgsargument, ikke
en begrensning.

**Versjonsskjevhet stoppes i claim.** Med kunder som kjører egen exe blir gamle
versjoner uunngåelig, og gammel bake gir *stille forskjellig resultat* i stedet
for en feilmelding. `pool_settings.min_worker_version` avviser for gamle noder.
Sammenlignes som `int[]`, fordi «0.9.0» < «0.10.0» må være sant.

### Hva modellen gir forretningsmessig

- **Kapasitet skalerer med kundemassen.** Hvert firma som plugger inn en PC tar
  sin egen last. Da forsvinner både kø, båndbredde over internett og strømregning
  for de kundene.
- **Ampex-poolen er fallback — og den betalte planen.** Firmaer uten egen maskin
  får bakingen levert. `scan_jobs.pool` (`'firm'` / `'ampex'`) registrerer hvem
  som faktisk gjorde jobben, og er dermed faktureringsgrunnlaget.
- **~10–12 firmaer per node** i burst ved dagens slutt. Fire firmaer er én node
  med god margin. (Anslag — se usikkerheter.)
- **Grunnen til node nummer to er redundans, ikke kapasitet.** Dør maskinen,
  stopper alle kundenes skann samtidig.

### Ikke bygget ennå

| Mangler | Konsekvens |
|---------|-----------|
| **All app-side kode** — ingen treff på `worker_node`/`scan_job` i `app/` eller `lib/` | Appen kan ikke lage innmeldingskoder, ikke køe jobber, ikke vise køposisjon. Poolen finnes kun som SQL + Python |
| Ampex driver ingen offentlig node | `is_public`-veien er uprøvd i praksis |
| Auto-oppdatering av Pool Exe | Kunder havner på gamle versjoner og blir avvist av versjonssperren uten å forstå hvorfor |
| Fakturering på `pool`-kolonnen | Ingen inntekt fra fallback-poolen |
| Opplasting av frames til R2 fra telefonen | Jobben har `input_prefix`, men ingen laster opp dit fra appen |

Dette er ikke etterslep — poolen er så vidt begynt på Windows-PC-en, og resten
er fortsatt planlegging. Men rekkefølgen som gir mest er **klientsiden først**
(innmelding, køing, køposisjon), for uten den er poolen utilgjengelig fra
produktet.

Og den hører sannsynligvis i **Ampex Desktop**, ikke i montørappen — se
`docs/DESKTOP_OG_IMPORT.md`.

---

## Oppsummering — hva som ble gjort

| Levert | Verifisert hvordan |
|--------|--------------------|
| UX-buntene på Hjem og ordredetalj | `tsc --noEmit` grønn |
| EFO/NELFO 4.0-parser | 33 påstander i `npm run verify:pricefile`, alle grønne |
| Fixture i ekte CP1252 | `file` bekrefter ISO-8859, æøå testes |
| Public pool-migrasjon | Kun lest gjennom — **ikke kjørt** |
| Fire dokumenter | — |

Fem commits på `grossist-og-pool`, pushet.

### Sikkert (verifisert mot kilde eller kode)

- **Formatspesifikasjonen.** Hentet den offisielle PDF-en (E-NVare4.0r4,
  rev. 2010-11-25) fra NHO Elektro. Semikolonseparert, CP1252/ISO-8859-1, CR+LF,
  posttyper VH/VL/VX/VA, `V4*`/`P4*`-filnavn. Feltrekkefølge og de implisitte
  desimalene (`Pris` 2, `Mengde` og `SalgsPakning` 4) er lest rett fra tabellen.
- **EFObasen-vilkårene.** Trakk ut teksten fra brukeravtalen. Punkt 2 forbyr
  videreformidling til tredjepart uten særskilt avtale; punkt 3 har prisen
  redigert til `kr XX 000,-`; punkt 5 krever full sletting ved oppsigelse.
- **`bake.py` kjører helt på CPU i dag.** `ScalableTSDFVolume` og
  `run_*_optimizer` er legacy-API uten CUDA-vei. `torch` brukes bare til å
  rapportere GPU-navn. Din egen kodekommentar sier det samme.
- **`_texture` er allerede på tensor-API-et** (`project_images_to_albedo`), så den
  delen av CUDA-porten er nesten gratis.
- **`claim_scan_job` scoper på `company_id`.** Lest i migrasjonen.
- **AI-en har ingen materiell- eller lagerverktøy.** Grep over
  `live-session.ts` — 29 verktøy, ingen av dem rører materiell.
- **`drawing_markup` er én blob per tegning.** Én `data`-kolonne, ingen forfatter.
- **`task` har `room_id`, ikke koordinat.**
- **Web-target bygger ikke.** `app.json` deklarerer den, men `react-native-web`
  og `react-dom` mangler i `package.json`.
- **Kun `orders` synker.** `watermelon_pull` i migrasjonen fra 3. juli rører bare
  den tabellen.
- **Dalux justerer AR manuelt** — gulvdeteksjon, så flytt modellen med fingrene
  mot vegger. Fra deres egen HelpCenter-artikkel.
- **NSDK 4.0 eksponerer VPS2 for Swift**, ikke bare Unity. lightship.dev ble lagt
  ned 28. februar 2026.
- **SpeedyCraft er MSSQL** (Devinco AS, databasenavn `speedycraft`, instans
  `SPEEDYSQL`). Fra deres support-doc. Basen står på kundens egen kontor-PC, så
  importen kan kjøre mot `localhost` — og med Windows integrated auth muligens
  uten passord i det hele tatt.
- **`SCImpExpCOM` finnes** — COM-basert integrasjonsobjekt hos Devinco, brukt av
  bl.a. Visma Contracting. Overfører ordre med materiell, timer og dokumentasjon.
- **Onninen kjøpte Elektroskandia Norge** fra Rexel, slått sammen fra mars 2023.

### Usikkert (anslag eller uprøvd)

- **Parseren er ikke møtt med en ekte fil.** Fixturen er min egen, skrevet mot
  spec. Grossister avviker fra spec i praksis — særlig på desimaltegn, feltlengder
  og hvor mange tomme felt de faktisk skriver. **Dette er den viktigste
  usikkerheten i alt jeg leverte.**
- **Baketiden er gjettet.** «5–20 min på CPU» og «1–3 min etter CUDA-port» er
  anslag, ikke målinger. Kjør `worker/tools/make_fixture.py` +
  `run_bake.py` og ta tiden.
- **«10–12 firmaer per node» arver den usikkerheten**, og bygger i tillegg på to
  antakelser jeg fant på: to timers burst ved dagens slutt, og tre skann per firma
  per dag. Endre du de tallene, endres konklusjonen.
- **Migrasjonen er ikke kjørt.** Syntaks og logikk er kun lest. `version_as_ints`,
  `row_number()`-rettferdigheten og `scan_job_queue_position` kan ha feil jeg ikke
  ser uten en database.
- **VRAM-anslaget (4–8 GB)** er regnet, ikke målt.
- **Elektroskandias webservice** for saldo og kundenetto er dokumentert på svensk
  side. Hva som gjelder i Norge etter Onninen-fusjonen vet jeg ikke.
- **Om `SCImpExpCOM` er brukbar for historisk masseuttrekk.** Den er laget for
  løpende ERP-synk, og dokumentasjonen ligger bak Devincos partnerportal (403
  utenfra). Antakelsen er at direkte MSSQL-lesing blir den realistiske veien.
- **SpeedyCraft-skjemaet er ukjent.** Varierer mellom versjoner, og egendefinerte
  felt ligger i en XML-struktur (`ObjectDataDefinition`), ikke som kolonner.
  Krever et oppdagelsessteg mot en ekte base.
- **Om grossistene tillater prisfila i tredjepartssystem.** Det er formatets
  uttalte formål, og Cordel gjør det åpent, men jeg har ikke lest vilkårene.
- **Om `ARWorldMap` er nøyaktig nok** til relokalisering i et rom som endrer seg.
  Utestet — en dags eksperiment.
- **EFObasens faktiske pris.** `XX 000` er redigert bort i standardavtalen.
- **Ekvivalensmatching på tvers av produsent** (Nexans vs Draka 3G2,5) via ETIM.
  Jeg tror en LLM løser det godt, men det er en hypotese.

## Dokumentkart

| Fil | Innhold |
|-----|---------|
| `docs/STATUS.md` | Denne — hvor vi står, hva som er neste |
| `docs/ROADMAP_2026-08.md` | Full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering |
| `docs/GROSSIST_INTEGRASJON.md` | Prisfiler, prissammenligning, autobestilling, admin-konsoll |
| `docs/DESKTOP_OG_IMPORT.md` | Ampex Desktop, SpeedyCraft-import og merge-semantikk |
| `docs/REGNSKAPSINTEGRASJON.md` | Fiken/Tripletex/PowerOffice — inngangsbilletten for å erstatte SpeedyCraft |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Skann-planen (utracket) |
| `docs/NEW_APP_PLAN.md` | Opprinnelig domene- og datamodell-plan |
