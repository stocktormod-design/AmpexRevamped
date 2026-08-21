# Status — les denne først

Sist oppdatert: 2026-08-21. Holdes oppdatert; ikke lag daterte kopier.

## Hvor vi står

Branch **`grossist-og-pool`**, pushet til `origin`. Runden 19.–20. august ligger
i åtte commits over `7633048`:

```
49e5902 docs: hvem eier kunden, og hva som faktisk er testet
c6c73bc style(ui): titler som puster, tab-linje som ikke er standard-iOS
012e597 chore(db): skjema v22–v29, delte hjelpere og widget-versjon
5ac6e07 feat(produksjon): revisjonsspor, faglig godkjenning og frosset arkiv
13a006f feat(ai): stemme → transaksjon, og tokenet låses til modellen
e807b34 feat(lager): varekartotek med pris fra flere grossister
a20855e feat(ordre): kundesignatur og ukeliste
8ad6563 feat(tilbud): ordren kan endelig oppstå av noe
746fcd3 feat(skjema): format v2 — klikklister, tabeller og betinget visning
```

Grønt: `npm run typecheck` og ti selvtester — `verify:pricefile`,
`verify:invoicing`, `verify:forms`, `verify:quoting`, `verify:timesheet`,
`verify:varesok`, `verify:approvals`, `verify:arkiv`, `verify:id-repair`,
`verify:form-import`.

> **iOS-bygget går gjennom.** 19. august ble appen kompilert for første gang:
> `npx expo run:ios` → *Build Succeeded, 0 errors*, installert på simulator.
> Hele appen bundler også rent (9,8 MB Hermes), så ingen brutte importer.
>
> **Og den er kjørt.** Samme kveld: appen startet i simulator, logget inn,
> **migrerte en eksisterende database fra skjema v15 til v26** («Migration
> successful»), importerte demokatalogen gjennom den ekte parseren og importen,
> og varesøket ble ført gjennom hele veien — el-nummer, de fire siste sifrene,
> flerordssøk, varekort med to grossistpriser og BILLIGST-merke.
>
> **20. august: synken går.** UUID-feilen under er rettet, appen bygget på nytt
> (*Build Succeeded, 0 errors*), migrert v26 → v30, og **pushen kom fram** — se
> «Synken går» lenger nede. Det som fortsatt IKKE er sett: en ekte telefon og
> Android.

### Uncommittet som IKKE er mitt

`modules/ampex-splat/ios/MeshBakeV2.swift` og `MeshScanPresenter.swift` er din
WIP fra før. Urørt.

---

## Runden 19. august: tilbud, skjemaformat v2, signatur, ukeliste, varekort

Målet var uttalt: **ordresystemet skal være minst like bra som konkurrentene**,
og skjemaer fra SpeedyCraft/Cordel skal kunne importeres. Fem hull ble lukket.

### 1. Skjemaformat v2 — det som blokkerte all skjemaimport

Firmaskjemaene hadde fire felttyper i en flat liste (`check`/`text`/`number`/
`photo`). Det var for tynt til å ta imot et ekte skjema, og verst: **klikklister
kunne ikke uttrykkes.** `check` var hardkodet til Ja/Nei/Ikke aktuelt, så en
Cordel-sluttkontroll med «OK / Avvik / Utbedret» ville blitt importert *feil* —
ikke stygt, feil, på et dokument DSB leser.

Vokabularet er nå det samme som Ampex-malene alltid har kunnet rendre, pluss det
import trenger:

| Nytt | Hvorfor |
|------|---------|
| **Seksjoner** | Et 80-punkts skjema var én uendelig rulle |
| **`choice` med egne alternativer** | Klikklista. Selve blokkeringen |
| **`table`** | Kursfortegnelse og måleprotokoll — det tyngste i en sluttkontroll |
| **`multiline`, `info`** | Fritekst og erklæringer som ikke lagres |
| **Hjelpetekst per punkt** | Der importerte skjema har «se pkt. 6.3» |
| **Enhet på tall** | A, V, Ω, mm² |
| **Betinget visning** | «Beskriv avviket» vises kun når svaret ER avvik |

- Formatet ligger i `lib/forms/schema.ts` — **uten WatermelonDB**, så både
  selvtesten og en fremtidig importør kan lese og validere en mal uten database.
- **Gamle v1-revisjoner leses fortsatt.** En revisjon er uforanderlig og skrives
  aldri om; `toSections()` løfter flat `items` til én navnløs seksjon. Testet.
- `lib/forms/visibility.ts` er ny og brukes overalt: rendering, gap-check,
  Live-assistenten og gjennomgangsarket. **Et skjult felt kan ikke være
  «manglende påkrevd»**, og AI-en får verken se eller fylle det.
- **`pruneHidden` er den viktigste linja.** Svarer du «Nei» på avvik, forsvinner
  avviksbeskrivelsen fra dokumentet. Uten den ville «ingen avvik» blitt levert
  sammen med en avviksbeskrivelse ingen kunne se i appen.
- `validateFirmSections()` blokkerer lagring av en mal som er ubrukelig i felt
  (klikkliste uten alternativer, betingelse som peker nedover, duplikat-id).

**Ingen databasemigrasjon.** Revisjonens `schema` er en JSON-streng.

### 2. Tilbud — ordren kan endelig oppstå av noe

Skjema **v24**, migrasjon `quotes_and_quote_lines` kjørt.

- `lib/quoting.ts` — **rene funksjoner, ingen database**, øre som heltall.
  Rabatt per linje, fritekstlinjer uten beløp, dekningsbidrag.
- Avrunding skjer **én gang, etter rabatten**. To avrundinger på samme linje gir
  et øre som ikke stemmer med det kunden kan regne ut selv av arket.
- **«Utløpt» lagres aldri.** Det er en funksjon av `valid_until` og regnes ut i
  visningen — en rad som må skrives om ved midnatt trenger en jobb ingen har
  skrevet.
- **Akseptert → ordre.** Materiell-linjene kopieres inn som planlagt materiell
  med tilbudsprisen. Arbeidslinjene kopieres **ikke**: de er prisen, ikke
  arbeidet, og å opprette åtte timer fordi noen priset åtte timer er å finne opp
  lønn. `orders.quote_id` binder dem sammen, og ordredetaljen viser **Avtalt
  pris** over fakturagrunnlaget.
- **Dekningsbidraget vises FØR tilbudet sendes.** Det er det eneste tidspunktet
  tallet kan endre noe.
- Skjermer: `tilbud/` (liste, detalj, ny, linje). Nås fra ordrelista.

### 3. Kundesignatur

Skjema **v25**, migrasjon `order_signatures` kjørt.

- Lagres som **vektorstrøk i JSON, ikke som bilde i R2.** Signaturen tas i en
  kjeller uten dekning; en opplasting som feiler er et bevis som forsvinner.
  JSON går gjennom den samme synken som alt annet, og rendres skarpt i alle
  størrelser.
- Signaturflaten er Skia + gesture-handler — **ingen ny avhengighet**.
- **Navn er påkrevd.** En signatur uten navn er en strek.
- «Godkjent: signert» på tilleggsarbeid sender nå til signaturflaten, som
  skriver godkjenningen selv. Før var det bare et ord.

### 4. Mine timer — ukeliste

- `lib/timesheet-calc.ts` er ren og selvtestet; `lib/timesheet.ts` har hooken.
- Uken er **mandag–søndag**. En søndag-til-lørdag-uke flytter søndagstimer inn i
  neste lønnsperiode.
- Fakturerbarhet **arves fra aktiviteten** når linja ikke sier noe — samme regel
  som fakturagrunnlaget. To svar på «er denne timen fakturerbar» ville vært
  umulig å forklare.
- Skjerm: `mine-timer.tsx`, nås fra Meg.

### 5. Varekortet og prisen per grossist — «EFObasen-følelsen»

Skjema **v26**, migrasjon `product_prices_and_varekort` kjørt.

**Innsikten:** prisfila inneholder allerede nesten alt som gjør EFObasen til
EFObasen. `VX`- og `VA`-postene har fabrikat, typebetegnelse, EAN, NRF, bilde,
FDV, HMS, erstatningsvare, pakningsstørrelse og lagerstatus. **Importen kastet
alt sammen.** Varesøket føltes tomt ved siden av EFObasen ikke fordi dataene
manglet, men fordi vi ikke tok vare på dem.

| Var | Er |
|-----|-----|
| Én pris per el-nummer. Solar-fila overskrev Onninen-fila | **`product_prices`: én rad per (vare, grossist).** Prissammenligning er mulig |
| `cost_price` = siste import | `cost_price` = **billigste kjente** pris. Det er den dekningsbidraget skal regne med |
| Raden viste navn + el-nummer | Bilde, produsent, el-nummer, beholdning, og «Solar er 2,50 billigere» |
| Ingen varekatalog | `lager/varer` med søk og filtre, `lager/vare` med fullt varekort |
| Ingen dokumenter | FDV og HMS åpnes fra varekortet |

**Søket er skrevet om** (`lib/product-search.ts`, rent og selvtestet). To ting
virket ikke før:

- **El-nummer traff bare fra starten.** De fire siste sifrene på en etikett er
  ofte det eneste som er lesbart etter et år i en kjeller. Nå treffer de.
- **Flerordssøk feilet.** «nexans pfsp» krevde at hele strengen sto
  sammenhengende i navnet. Nå må hvert ord finnes, ikke rekkefølgen.

I tillegg: EAN og NRF treffer eksakt (det en strekkodeskanner gir), og et
tallsøk på ett–to sifre gir bevisst **ingen** treff — to sifre finnes inne i
nesten hvert el-nummer, så et slikt søk ville returnert halve kartoteket i
tilfeldig rekkefølge.

**Ytelse:** søket LIKE-filtrerer i SQLite på en `search_text`-kolonne før noe
havner i JS, og slår opp beholdning kun for radene som ble treff. Før leste hvert
tastetrykk hele `products` OG hele `stock_movements` inn i minnet — usynlig med
en håndskrevet fixture, umulig med en ekte EFO-fil.

> Dette lukker `docs/KONKURRENTANALYSE.md` punkt 4, som krevde datamodellen
> **(el-nummer, grossist, dato)** «fra første migrasjon, fordi den er dyr å legge
> til etterpå». Den var ikke fulgt. Nå er den det, og den ble lagt til før den
> første ekte prisfila er importert — altså mens den fortsatt var billig.

**Hva EFObasen fortsatt har som dette ikke gir:** ETIM-attributter (strukturerte
tekniske data), og varer ingen grossist du har fil fra fører. Resten er dekket,
til null kroner i året.

### Feilen som bare det å kjøre appen kunne finne

```
[sync] utsatt: invalid input syntax for type uuid: "yF2ddjHEXJOu1WdK"
```

WatermelonDB genererte 16-tegns base62-id-er før `setGenerator` ble lagt inn
(commit `eef17dd`). Postgres-tabellene har `uuid` som primærnøkkel. Rader som ble
laget FØR den commiten kan derfor aldri pushes.

Det ville vært til å leve med hvis de bare feilet selv. Men `watermelon_push`
kjører alt i **én transaksjon**, så én slik rad **stopper hele synken for alle
tabeller** — permanent, og stille, fordi `syncQuietly` bare logger til konsollet.
På testdatabasen var det 8 slike rader (`drawing_markup`, `orders`,
`drawing_loops`, `order_scans`), alle `_status='created'`, altså aldri synket.

**Rettet 20. august** — skjema v30, `lib/db/id-repair.ts`.

Id-ene skrives om til ekte UUID, med alle referanser. Å HOPPE OVER radene ville
vært feil: WatermelonDB markerer en hoppet rad som synket likevel, og da er den
tapt for godt. At omskriving er trygt følger av selve feilen — en base62-id kan
per definisjon aldri ha vært på serveren, så ingen andre har sett den.

Kjøres som et **migrasjonssteg**, ikke ved oppstart. Migrasjoner går i
`adapter.setUp()` før databasen serverer et eneste spørsmål; skrev vi om id-ene
senere, ville modeller som allerede lå i WatermelonDBs cache pekt på rader som
ikke fantes lenger.

Tre ting SQL-en gjør som ikke er åpenbare:

- **Lokalt slettede rader med gammel id slettes helt.** De sto og ventet på å
  bli slettet på serveren, men kom aldri dit — det finnes ingenting å slette.
- **Kartet er globalt, ikke per tabell.** Id-ene er tilfeldige og unike på
  tvers, så en referansekolonne trenger ikke vite hvilken tabell den peker på.
  Det er også forsvaret mot å skrive om noe man ikke skal: kartet inneholder
  bare id-er som faktisk finnes som primærnøkkel her, så en Fiken-kunde-id i
  `external_id` eller en Supabase-uid i `user_id` kan aldri treffe.
- **Rader nevnt inne i en arkivpakke fredes.** Pakken er hashet, og hashen er
  hele poenget: skriver vi om en id inni den, stemmer ikke SHA-256 lenger.

Selvtesten (`npm run verify:id-repair`) kjører den EKTE SQL-en mot en ekte
SQLite — ikke mot en beskrivelse av den. Feilen fantes fordi ingen hadde kjørt
noe; en test som bare sammenligner strenger ville hatt samme problem.

### Synken går — verifisert på ekte data 20. august

Appen bygget (`0 errors`), installert, migrert **v26 → v30**, og så:

| Sjekk | Resultat |
|-------|----------|
| `user_version` i SQLite | **30** |
| Gamle base62-id-er igjen | **0** |
| Hjelpetabellen `_id_reparasjon` | ryddet bort |
| Rader med `_status = 'created'` | **0** — alt står `synced` |
| `synk_helse` i local_storage | `feilPaaRad: 0`, vellykket |

Og på serversiden, i **én** transaksjon (samme mikrosekund): ordren som var
blokkert (`yF2dd…` → `ac0f7145-…`) satt inn for første gang, åtte aktiviteter,
to lagerbevegelser, én materiell-linje og én statusendring til `fakturaklar`.
Etterslepet som hadde stått fast kom fram i sin helhet.

Samme spørring bekreftet at **revisjonssporet virker i appen**, ikke bare mot
databasen: `actor_name` fanges opp, og en oppdatering lagres som KUN det som
endret seg — `{"status": {"fra": "mottatt", "til": "fakturaklar"}}`.

**Ett hull det avdekket, og som er rettet:** `company_settings` har `company_id`
som primærnøkkel, ikke `id`, så `audit_row()` skrev hendelsen med `rad_id = null`
— et spor som ikke kan si hvilken rad det beskriver. For en tabell med én rad per
firma ER `company_id` radens identitet, så `coalesce(id, company_id)` er ikke en
tilnærming, det er riktig nøkkel. Anvendt og verifisert: **0 av 14 hendelser står
uten `rad_id`.**

### En stum synk er ikke det samme som en usynlig synk

Grunnen til at åtte rader kunne blokkere alt i ukevis var ikke bare feilen — det
var at ingen kunne se den. `syncQuietly` skrev til `console.log`, som ingen leser
fra en telefon i en kjeller.

`lib/db/sync-helse.ts` skiller nå mellom å være **uten nett** og å bli **avvist**.
Uten nett er normaltilstanden appen er bygget for, og teller ikke. Tre
avvisninger på rad er en defekt — den fjerde går like dårlig — og da sier «Meg»
fra: *«Synken står. Ingenting er tapt — alt ligger lagret på telefonen. Men det
kommer ikke fram før dette er rettet.»* Kjenner vi ikke igjen feilmeldingen,
regnes den som en avvisning: å overse en ekte defekt er dyrere enn å telle en
nettverksfeil.

Regel 2 står ved lag — ingen synk-knapp, ingen spinner, ingen framdrift.

### Verifisert mot databasen

Alle tre migrasjonene er kjørt mot `ampex-revamped`, og **full synk-rundtur er
kjørt i transaksjoner som ble rullet tilbake**: insert → delvis update → pull →
soft delete. Bekreftet at `quote_number` overlever en delvis update (`no_update`),
at `company_id` fylles av `sync_payload_in`, at `orders.quote_id` og de tretten
nye `products`-kolonnene dukket opp i pull uten kodeendring (registerdrevet
synk), at signaturstrøkene bevares ordrett, og at **to grossistpriser på samme
el-nummer lever side om side** — og at en ny import fra samme grossist oppdaterer
raden i stedet for å legge på en til. Databasen står uendret etterpå.
Synken er nå **26 tabeller**.

---

## Hva som ble bygget

Ordresystemet går nå hele veien: **kunde → ordre → timer og materiell →
tilleggsarbeid → fakturagrunnlag → regnskap**, og alt synker.

### Datamodellen (skjema v22 og v23)

| Nytt | Hvorfor |
|------|---------|
| `customers` | Både Fiken og Tripletex krever en kunde med **ID** for å motta en faktura. Ordren hadde bare løse navnefelt, og hver synk ville laget duplikater i regnskapet |
| `activities` | Begge systemene modellerer timer som aktivitet × person × dato. Uten aktivitet har en time ingen pris |
| `order_extras` | Tilleggsarbeid med dokumentert godkjenning |
| `external_id` + `source_system` | På ordre, kunder, varer, aktiviteter. Uten dem kan en ordre ikke spores til fakturaen sin |
| Pris og MVA på `products` / `order_materials` | Prisen lagres som **snapshot** på linja, så en gammel ordre ikke endrer beløp når varen prises om |
| `time_entries`: `activity_id`, `internal_note`, `billable`, `invoiced_at` | `internal_note` er aldri synlig på faktura — «kunden var sur» skal ikke ut til kunden |

### Moduler

| Fil | Ansvar |
|-----|--------|
| `lib/invoicing.ts` | Fakturagrunnlaget. **Rene funksjoner, ingen database** — derfor selvtestbart. Penger regnes i **øre som heltall** |
| `lib/order-billing.ts` | Kobler ordredataene til regnestykket. `markerFakturert` / `angreFakturert` |
| `lib/customers.ts`, `lib/activities.ts`, `lib/products.ts` | Registrene og varesøket |
| `lib/accounting/adapter.ts` + `fiken.ts` | `Regnskapsadapter`-grensesnittet og adapter nummer én |
| `lib/pricefile/import.ts` | Prisfil → varekartotek |
| `lib/quoting.ts` + `lib/quotes.ts` | Tilbud: ren regning / database. Samme deling som invoicing |
| `lib/timesheet-calc.ts` + `lib/timesheet.ts` | Ukeliste: ren regning / hook |
| `lib/forms/schema.ts` | Skjemaformatet — uten WatermelonDB, så det kan testes og importeres mot |
| `lib/forms/visibility.ts` | Betinget visning. `pruneHidden` er den viktigste funksjonen |
| `lib/forms/firm-schema.ts` | Firmamal → rendermodell + `validateFirmSections` |
| `lib/signatures.ts` | Kundesignatur, og godkjenning av tilleggsarbeid via signatur |
| `lib/ai/materiell-tools.ts` | Stemmeverktøy: varesøk, uttak, materiell på ordre |
| `lib/ai/tilbud-tools.ts` | Stemmeverktøy: tilbud, linjer, sum og dekningsbidrag |
| `lib/product-search.ts` | Varesøkets rangering, synonymer og «mente du …» — ren, selvtestet |
| `lib/product-category.ts` | Varegruppe utledet av varenavnet, med frekvens over hele katalogen |
| `lib/pricefile/varekort.ts` | `VX`/`VA`-postene → varekort. Det importen kastet før |
| `lib/pricing.ts` | Listepris kontra nettopris. Hindrer at en `V4` blir lest som firmaets pris |
| `lib/pricefile/demo-katalog.ts` | To oppdiktede P4-filer i ekte format, for å kunne bla før en ekte fil finnes |

### Skjermer

`ordre/faktura.tsx` · `ordre/timer.tsx` · `ordre/tillegg.tsx` ·
`ordre/deltakere.tsx` · `kunder/` (liste, detalj, ny, velger) ·
`aktiviteter.tsx` · `lager/prisfil.tsx` ·
`components/product-picker.tsx` · `components/sheet.tsx` ·
`tilbud/` (liste, detalj, ny, linje) · `ordre/signatur.tsx` · `mine-timer.tsx` ·
`components/signature-pad.tsx` · `components/avtalt-pris-kort.tsx` ·
`components/form-problems.tsx` · `lager/varer.tsx` (katalog) · `lager/vare.tsx` (varekort)

Registrene er skjult fra tab-baren (`href: null`) — de settes opp sjelden.

---

## De tingene som er lette å ødelegge ved uhell

1. **Beløp er øre som heltall.** Fiken vil ha `net: 25000` for 250,00 kr.
   Sendes kroner blir fakturaen 100× for lav.
2. **MVA-koden er engelsk hos Fiken** (`HIGH`/`MEDIUM`/`LOW`/`EXEMPT`), ikke
   norsk. Ampex' egne typer er nøytrale og oversettes i adapteren.
3. **Prisfila er CP1252, ikke UTF-8.** Den må leses som bytes gjennom
   `base64TilBytes` → `dekodAnsi`. Leses den som tekst blir æøå ødelagt i hvert
   eneste varenavn, og det oppdages først når noen leter etter «Vernebryter».
4. **Tusenskilleren er U+00A0**, skrevet som escape. Et vanlig mellomrom lar
   «1 234 567» brekke over to linjer i en fakturatabell.
5. **`Alert.prompt` finnes ikke på Android** og gjør ingenting — stille.
   `Alert.alert` viser maks tre knapper der. Bruk `components/sheet.tsx`.
6. **`pruneHidden` må kalles hver gang et skjemasvar endres.** Fjernes den,
   blir svaret på et punkt som ble skjult liggende igjen i dokumentet uten å
   vises noe sted i appen — «ingen avvik» levert sammen med en avviksbeskrivelse.
   Kalles i dag tre steder: skjema-skjermen, gjennomgangsarket og `applyVoiceFill`.
7. **En skjemarevisjon skrives ALDRI om.** v1-formatet (flat `items`) må derfor
   kunne leses for alltid — `toSections()` er den ene leseveien, og selvtesten
   passer på den.
8. **Tilbudslinjens pris er et snapshot i kroner**, ikke en peker til varen.
   Gjøres den om til et oppslag, endrer et sendt og bindende tilbud beløp fordi
   grossisten sendte ny prisfil.
9. **Rabatt rundes én gang, etter rabatten** (`linjeNettoOre`). Rundes
   linjebeløpet først og rabatten etterpå, stemmer ikke summen med det kunden
   regner ut av tallene på arket.
10. **`products.cost_price` er den BILLIGSTE kjente prisen, ikke den sist
    importerte.** Settes den til siste import igjen, blir dekningsbidraget feil
    på hver linje der en annen grossist er billigere. Alle prisene ligger i
    `product_prices`; `cost_price` er kun det raske oppslaget.
11. **`search_text` må skrives hver gang en vare lagres.** Uten den faller varen
    ut av SQLite-forfiltreringen og blir usynlig i søket. `useVaresok` bygger den
    på farten som reserve, men det virker bare for rader som allerede er hentet.
12. **Listepris og nettopris er ikke samme størrelse.** `lib/pricing.ts` lar
    ALDRI en listepris (brutto uten rabatt, altså en `V4`) slå en ekte nettopris,
    og påstår aldri en «besparelse» mellom to listepriser. Fjernes den regelen,
    anbefaler systemet en grossist på et tall ingen har avtalt — og
    dekningsbidraget blir for lavt, så en lønnsom jobb ser ulønnsom ut.
13. **Prisfil-import fyller kun varekortfelt fila FAKTISK har.** En grossist uten
    bilde skal ikke tømme et bilde en annen grossist ga oss — derfor `if (kort.x)`
    og ikke rett tilordning.

---

## Databasen

**`supabase/migrations/` er IKKE sannheten.** Repoet lå 18 migrasjoner bak
databasen. Skjemaet er sikret i `supabase/baseline/schema_2026-08-19.sql`
(2873 linjer, 28 funksjoner). **Spør databasen via Supabase-MCP, ikke mappa.**
Full redegjørelse i `docs/DB_DRIFT.md`.

### Synken er bygget om

Fire migrasjoner kjørt mot `ampex-revamped` (`vymgogzcicbaizjlaurr`):

| Migrasjon | Hva |
|-----------|-----|
| `order_system_tables_and_columns` | `customers`, `activities`, **`time_entries`**, `order_members`. Timene lå kun på én telefon og forsvant med telefonen |
| `generic_watermelon_sync` | Synken er **registerdrevet**. `sync_tables` har én rad per tabell; kolonnene leses fra katalogen |
| `generic_sync_push_update_first` | Rettelse av en ekte feil en testrunde fant |
| `order_extras` | Tilleggsarbeid — koblet på synken med **én rad i `sync_tables`** |

Den gamle håndskrevne synken (`_watermelon_pull_core`, `_watermelon_push_core`,
`watermelon_push_*`) står **ubrukt som tilbakevei**. Rulle tilbake = `create or
replace` de to inngangspunktene til å kalle `_core`-funksjonene igjen.

Verifisert med full rundtur mot `time_entries` i en transaksjon som ble rullet
tilbake: insert → delvis update → pull → soft delete. 22 tabeller i pull.

---

## Hva som trengs fra deg

**1. Én ekte EFO/NELFO-prisfil.** Fortsatt hovedblokkeringen, og den blokkerer
mer enn før: varesøk, varekort og prissammenligning er ferdig bygget, men
**varelista er tom** til en fil er importert.

> **Ampex er systemleverandør, ikke elektrofirma.** Vi har ingen kundeforhold hos
> Onninen eller Solar, og får derfor ingen prisfil ved å ringe og be om vår egen.
> Fila tilhører alltid et *kundefirma*. Det er ikke en begrensning å beklage —
> det er hele grunnen til at prisfil-veien er lovlig og gratis der EFObasen ikke
> er (se punkt 3 nedenfor).

Tre realistiske veier til en testfil, i den rekkefølgen de er sannsynlige:

| Vei | Hva den krever |
|-----|----------------|
| **Grossisten som integrasjonspartner** | Ring/skriv som systemleverandør og be om en *testfil*. Alle grossister har en, fordi alle systemleverandører spør. Dette er veien Cordel, Minuba og Handyman gikk |
| **Første kundefirma** | Firmaet henter sin egen `P4`-fil i grossistens kundeportal og sender den. Krever en pilotkunde |
| **Eget elektrofirma** | Når installatørprøven er bestått og firmaet har kundenummer, er fila deres egen |

**Be om begge, men i denne rekkefølgen:**

- **`V4` først** — grossistens fulle sortiment til listepris. Den er *lett* å få:
  det står ingenting konfidensielt i den, så en systemleverandør kan be om den
  til integrasjonsarbeid uten å gå veien om en kunde. Den fyller hele
  varekartoteket: navn, produsent, EAN, bilder, FDV, HMS, varegrupper.
- **`P4` deretter, per kunde** — firmaets *avtalte* priser etter rabatt.
  Listeprisene er nokså like hos alle; det er rabatten som skiller, og det er
  den prissammenligningen handler om. Uten P4 er dekningsbidraget for lavt og
  «BILLIGST» meningsløst — appen sier begge deler høyt (`lib/pricing.ts`).

Full begrunnelse og de andre kildene (produsentenes BMEcat/ETIM-kataloger) i
`docs/GROSSIST_INTEGRASJON.md`.

### Ekte el-numre finnes ikke uten en ekte fil

Spørsmålet kommer igjen, og svaret er det samme hver gang: **et oppslag fra
el-nummer til vare ER en database, og alle utgavene av den tilhører noen.**

| Kilde | Har ekte el-numre | Kan vi bruke den |
|-------|-------------------|------------------|
| **EFObasen** | Ja, den autoritative | Nei. 29 412 kr/år, og punkt 2 i avtalen forbyr en systemleverandør å vise dataene videre til mange firmaer |
| **Grossistens nettbutikk** | Ja | Nei. Å høste den og sende den ut i et produkt er samme videreformidling, uten å ha betalt |
| **`V4` fra grossisten** | **Ja** | **Ja.** Gratis, lovlig, og lett å be om — se over |

Demokatalogen kan derfor aldri ha ekte el-numre. Den har oppdiktede, og de er
merket som det.

**Men et ekte el-nummer skal ikke møtes med «ingen treff».** Taster du 6–8
siffer som ikke finnes i kartoteket, tilbyr `lager/varer` å legge inn varen med
det nummeret. Nummeret er join-nøkkelen, så når prisfila kommer, kobler den seg
på varen du alt har laget i stedet for å lage en duplikat.

**I mellomtiden finnes en demokatalog.** `lib/pricefile/demo-katalog.ts` bygger tre
P4-filer i ekte EFO/NELFO-format — **328 varer i 33 varegrupper fra tre
grossister** med ulik rabatt per rabattgruppe, EAN, NRF, pakningsstørrelser,
lagerstatus og utgåtte varer. Filene ligger ikke som tekst i appbunten: en
kompakt beskrivelse av serier og variantakser bygger dem deterministisk ved
behov (~55 kB per fil, ~13 kB kode). Lastes inn fra `Lager → Prisfil`, går
gjennom den **ekte** parseren og den **ekte** importen (ingen snarvei rundt
systemet), og merkes `source_system = 'demo'` med DEMO-merke i katalogen og på
varekortet.
Fjernes med ett trykk — men varer som har fått lagerbevegelser eller ligger på
en ordre blir stående, fordi en ordrelinje som peker på en slettet vare er verre
enn en demovare til overs.

> Demoen beviser at **UI-et og regnestykket virker**. Den beviser **ikke** at
> parseren leser en ekte fil riktig: filene er generert mot spesifikasjonen av
> samme hode som skrev parseren, så en feiltolkning ville stått begge steder.
> Bare en fil fra en grossist svarer på det.

**Til sammenligningen trengs to filer fra to forskjellige grossister.** Med én
virker varekortet, søket, bildene og FDV, men «BILLIGST»-merket kan aldri dukke
opp.

Og i samme samtale, uansett hvilken vei: **spør om FTP.** Prisfilene ligger i
*kundefirmaets egen* katalog på grossistens FTP, og den tilgangen går gjennom
kundens kundenummer — ikke gjennom en godkjenning av oss som leverandør. Spør om
FTP-vert og brukernavn, om `F*`-fakturafiler ligger i samme katalog, og om de tar
imot bestilling på samme server. Se `docs/GROSSIST_INTEGRASJON.md`.

**~~2. Fire e-postmaler mangler.~~ GJORT 20. august.** `supabase/config.toml`
pekte på fire maler som ikke fantes, og CLI-en validerer HELE konfigurasjonen
selv for en funksjonsutrulling — så de blokkerte alt, også `functions deploy`.
Skrevet i Ampex-identiteten (brunt og kremet, ikke «dark theme» som kommentaren i
config.toml lovet), tabell-layout og inline-stil fordi Outlook ikke kan noe annet,
og **uten eksterne bilder eller webfonter**: e-postklienter blokkerer dem, og en
logo som ikke lastes ser verre ut enn ingen logo. CLI-en er dermed i drift igjen.

**3. Regnskap: start på Fiken.** 229 kr/mnd ENK, 349 kr AS. Ikke på grunn av
API-et, men fordi Fiken er den eneste veien der Ampex kan være koblet **fra dag
én** — OAuth tar to minutter. Tripletex krever 2–3 ukers godkjenning pluss et
skjønnsmessig AI-samtykke etter §2.2.13 som kan avslås.

> **Skill de to Tripletex-ene.** Tripletex som *regnskap* er et
> integrasjonsmål på linje med Fiken — hovedbok, faktura, lønn, og en adapter
> mot det. Det er **Tripletex Elektro/VVS til 699 kr/mnd** som er konkurrenten:
> fagpakken med ordre, prosjekt, timeføring, grossistintegrasjon,
> kontrollskjemaer og sjekklister, og medlemsfordel hos NELFO/NHO Elektro.
>
> Konsekvensen er at valget ikke er «Fiken eller Tripletex», men **hvilken
> hovedbok** — og separat: om firmaet også kjøper fagpakken. Gjør de det, kjøper
> de noe Ampex skal være. Gjør de det ikke, er Tripletex-regnskapet en helt
> vanlig integrasjon, og en vi skal ha.

---

## Veien til produksjon

Tre ting henger sammen og må bygges i denne rekkefølgen, fordi hver hviler på
den forrige.

### 1. Revisjonsspor — GJORT 20. august

`audit_events` + triggere på elleve tabeller. To valg avgjør om sporet er verdt
noe:

- **Serversiden skriver, ikke klienten.** Appen er offline-først og ligger på en
  telefon. En klient som kan skrive revisjonsrader, kan la være — eller lyve.
  Triggerne ser endringen når den pushes, med `auth.uid()` fra sesjonen.
- **Append-only.** `audit_events` har ÉN policy, og den er SELECT. Ingen
  update/delete finnes, så det er ikke et løfte — det er fravær av mulighet.

Bare feltene som faktisk endret seg lagres, med `fra` og `til`. En skriving som
kun rører `updated_at` gir ingen rad; ellers ville hver synk fylt sporet med
støy. `products`/`product_prices` er bevisst utenfor: en prisfil-import endrer
titusenvis av rader i én operasjon, og logges som ÉN hendelse via
`log_audit_event()`.

Utførerens navn lagres som **tekst**, ikke bare en fremmednøkkel: slutter en
montør og profilen ryddes, skal sporet fortsatt si hvem som førte timene i 2026.

> **Sporet synkes ikke til telefonen.** Det er et forensisk register man åpner
> når noe bestrides, ikke daglig arbeid — det leses på forespørsel og krever
> nett. Godkjenningsflyten under synkes derimot, fordi den er drift.

### 2. Faglig godkjenning — GJORT 20. august

Skjema **v28**, migrasjon `order_approvals` kjørt. Skjerm: `app/(app)/godkjenning.tsx`.

- **Godkjenning er ikke en status.** `orders.status` sier hvor arbeidet er;
  godkjenning er en beslutning med et menneske bak. Blandes de, mister man hvem
  som bestemte og hvorfor.
- **Sperren ligger i databasen.** Triggeren `krev_faglig_godkjenning` avviser
  overgangen til `fakturert` uten en godkjenning. Verifisert: fakturering ble
  stoppet, gikk gjennom etter godkjenning. `markerFakturert` sjekker også
  lokalt og kaster `ManglerGodkjenning` — ellers ville ordren sett fakturert ut
  på telefonen og så stille nektet å synke.
- **Hvem kan godkjenne:** `company_settings.faglig_ansvarlig` — en navngitt
  person, ikke en tilgangsgruppe, fordi forskriften peker på et menneske. Er den
  ikke satt, faller det tilbake på eier/admin så et nytt firma ikke står fast.
  Håndhevet i RLS, ikke i UI.
- **Avslag krever begrunnelse** (`check`-constraint) og setter ordren tilbake
  til `pagaar` — montøren skal se den blant sine aktive jobber, ikke måtte lete
  i en avvist-liste.
- **Snapshot av det som ble godkjent.** Føres to timer etterpå, sier
  ordredetaljen «Endret etter godkjenningen — Timene er endret fra 6 til 8».
  Vi blokkerer ikke; det er en samtale mellom mennesker. Men usynlig er det
  ikke. `npm run verify:approvals` dekker den logikken.
- Skjermen viser sum i display-vekt, timer, materiell, dokumenter
  (fullførte/totalt), signaturer — og advarer om det som mangler uten å sperre.
  Det er fagpersonens vurdering om en jobb kan faktureres uten signatur, ikke
  systemets.

### 3. Arkiv og frysing i R2 — GJORT 20. august

Skjema **v29**, migrasjon `order_archives` kjørt. Skjerm: `app/(app)/arkiv.tsx`
(«Gamle jobber»), kort på ordredetaljen, `lib/archive/`.

- **Man søker aldri i R2 for å finne noe.** `order_archives` ER registeret;
  objektlageret er oppbevaring. Filtrering på kunde og år er en spørring mot
  lokal SQLite. Kundenavnet dupliseres inn i raden, så «alt vi har gjort for
  Hansen» er ett oppslag og ikke en join gjennom en ordre som kan ha byttet
  kunde.
- **`oppbevares_til` stemples ved frysing**, ikke regnes ut ved oppslag. Skrus
  `retention_years` ned fra 10 til 5 neste år, forkorter det ikke det som
  allerede er lovet — en slettejobb som leser en *levende* innstilling ville
  slettet dokumenter noen trodde de hadde i ti år.
- **Pakken er deterministisk.** Nøkler sorteres, datoer skrives som ISO i UTC,
  og det finnes INGEN «generert klokken»-felt inne i pakken — et tidsstempel i
  innholdet ville gitt ny hash hver gang, og da beviser hashen ingenting.
- **SHA-256 er skrevet for hånd** (`lib/archive/sha256.ts`). Appen har ingen
  krypto-primitiv, og hashen må gi samme svar på en telefon i dag, på en
  kontor-PC neste år og i et verifiseringsskript om syv år. Testet mot FIPS
  180-4s egne testvektorer, inkludert millionen a-er — en håndskrevet hash uten
  testvektorer er ikke verdt tilliten.
- **Opplasting FØR registeroppføring.** Feiler opplastingen, finnes det ingen
  rad som lover et arkiv som ikke er der.
- **«Kontroller» henter pakken ned og sammenligner hashen.** Uten en måte å
  sjekke på er «uforanderlig arkiv» en påstand.
- Omfrysing soft-sletter den forrige raden; filen blir liggende i R2, og
  nøkkelen inneholder hashen så to versjoner kan eksistere side om side.
- Vedlegg (skann, tegninger) refereres som R2-nøkler, ikke kopieres inn — de
  ligger der fra før.
- `internal_note` på timer er ALDRI med i pakken: den er intern per definisjon,
  og et arkiv kan bli lest ut i en tvist.

**Kjører foreløpig fra appen**, fordi R2-kanalen (`r2-sign`) finnes der og én
knapp er bedre enn en Edge Function som ikke er skrevet. `byggPakke` er ren, så
den flyttes uendret til Ampex Desktop når den finnes.

> **Oppbevaringstiden.** `company_settings.retention_years` er 5 som standard
> med `check (between 5 and 50)` — gulvet ligger i databasen, ikke i UI-et.
> Bokføringsloven krever 5 år for primærdokumentasjon; elektrodokumentasjon som
> samsvarserklæring følger anlegget og har egen logikk. **Det er ikke skrevet
> noen slettejobb**, og det er med vilje: å slette for tidlig er ikke
> reparerbart. `oppbevares_til` er datoen en slik jobb skal lese når den skrives.

## Neste steg, i rekkefølge

1. **Kjør appen på en enhet.** Bygget går gjennom, men ingenting er *sett*.
   Rekkefølgen som gir mest på fem minutter:
   1. `npx expo run:ios --device` på telefonen, logg inn.
   2. `Lager → Prisfil → Last inn demokatalog` — 36 varer fra to grossister.
   3. `Lager → Søk i varer`: prøv `1451025`, så `5025` (de fire siste sifrene),
      så `nexans`, så `nexans kabel`. Åpne en vare og se prisene side om side.
   4. Så resten: tilbud, signatur, skjema, timer.

   Skjemamigrasjonen v21→v26 må prøves på en telefon som allerede har en eldre
   Ampex-installasjon — en frisk installasjon tester den ikke.
2. **Foto på ordre og i skjema.** Det eneste som gjenstår av «bevis når noe
   bestrides» etter at signaturen kom. **Krever ny avhengighet**
   (`expo-image-picker` eller `expo-camera`) og dermed et nytt dev-build — derfor
   ikke gjort. `photo` finnes allerede som felttype i skjemaformatet og rendres i
   dag som et info-punkt som sier at bildet gjenstår.
3. **Én ekte prisfil.** Nå enda mer verdt enn før: varekartoteket, varekortet,
   prissammenligningen og hele søkerangeringen er bygget, men har aldri møtt
   ekte data. To filer fra to grossister — sammenligningen kan ikke prøves med
   én. Se «Hva som trengs» over for hvordan vi som *leverandør* får tak i dem.
4. ~~**Skjemaimport: PDF/bilde → mal.**~~ **BYGGET 21. august** — se eget
   avsnitt under. Gjenstår å prøve mot en ekte PDF.
5. **Planlegging: hvem, hvor, når.** `orders.scheduled_at` og `assigned_to`
   finnes, men det finnes ingen ukevisning for hvem som gjør hva. Cordel og
   Handyman har ressursplanlegging, og det er det basen faktisk kjøper systemet
   for. Ukelista i `lib/timesheet-calc.ts` kan gjenbrukes nesten som den er.
6. **Fiken-adapteren må kobles til noe.** Den er skrevet uten
   React Native-avhengigheter og skal kjøre i en Edge Function eller Ampex
   Desktop — et Fiken-token hører ikke hjemme på en montørtelefon. «Marker som
   fakturert» skriver i dag kun lokalt. Fiken har `/offers`, så tilbudet kan
   sendes den veien når adapteren lever.
7. **Serviceavtaler / gjentakende ordre.** Årskontroll, brannvarsling,
   el-kontroll. Minuba, simPRO og ServiceTitan har det; vi har ingen modell.
8. **Bestilling til grossist som objekt.** Designet ligger i
   `GROSSIST_INTEGRASJON.md`, ingenting er bygget. Bygg e-post ut + FTP inn, ikke
   EDI — Minuba har 80+ grossister på nettopp det.
9. **Prisbok per kunde.** Avtalt rabatt/påslag ut mot kunden. Merk at
   **grossistsiden nå er løst** — `product_prices` er Cordels «prissett 1–4»-form.
   Dette som gjenstår er den andre retningen: hva VI tar av en bestemt kunde.
10. **Ordre ↔ prosjekt.** To øyer i dag.
11. **Prosjekttegning.** Grunnlaget finnes allerede — `drawings`,
    `drawing_markup`, `drawing_loops`, `rooms.shape` og tre skjermer under
    `prosjekter/`. Mindre urørt enn resten, og derfor riktig å ta etter
    ordresystemet.
12. **Poolen må avklares.** `20260815120000_gpu_bake_worker_pool.sql` og
    `20260817200000_ampex_public_pool.sql` er **aldri kjørt og kan ikke kjøres
    slik de står** — `scan_jobs` finnes med et annet skjema, `worker_nodes`
    overlapper med `scan_workers`. Enten skrives de om mot det som finnes, eller
    så droppes `scan_workers`/`scan_jobs` og de kjøres rent.

### Ordreskjermen lagt om — feltarbeid først, kontor sist

Kritikken var berettiget: deltakerliste, tilleggsarbeid, kundesignatur OG
fakturagrunnlag lå alle sammen OVER materiell og dokumentasjon. Fire
kontoroppgaver foran de tre tingene jobben faktisk består av.

Montøren står i et sikringsskap med hansker på. Han trenger, i denne
rekkefølgen: **hvor er jeg, hva gjør jeg, hva brukte jeg, hva må dokumenteres.**

| Før | Nå |
|-----|-----|
| Oppdrag | Oppdrag |
| Timer · Deltakere · Tillegg · Signatur | **På jobben:** Timer → Materiell → Dokumentasjon → LiDAR |
| Arkiv / Godkjenning / Avtalt pris | **Når jobben er ferdig:** Signatur → Tillegg* → Deltakere |
| Fakturagrunnlag | Avtalt pris → Fakturagrunnlag → Godkjenning |
| Materiell, Dokumentasjon, LiDAR | Status → Detaljer |

\* **Tilleggsarbeid vises nå kun når ordren har en avtalt pris.** Innvendingen
var riktig for løpende regning: der ER ekstra arbeid bare flere timer og mer
materiell, og begrepet står bare i veien. Men på fastpris er det motsatt —
timer og materiell utover avtalen blir slukt av fastprisen og aldri fakturert,
med mindre de føres som et tillegg kunden har godkjent. Begrepet beholdes
derfor, men kun der det gjør en forskjell (`order.quoteId`).

Fire nesten like Pressable-blokker ble til én `Rad`-komponent. Det var
dessuten grunnen til at rekkefølgen ikke ble rettet før: det var tungvint å
flytte en rad.

### Kartvisning av jobbene

Nytt: kartknapp på ordrelista. Alle jobber med adresse som pins, trykk viser
jobben nederst, ett trykk til åpner den — to ledd, fordi et feiltrykk på et
kart er lett og skal ikke navigere.

Kartet er en VISNING av samme liste, ikke en egen skjerm: filteret over gjelder
begge. Slik gjør Jobber, Housecall Pro og Tradify det, og grunnen er ikke at
kart er pent — **rekkefølgen på dagens jobber bestemmes av geografi**, og en
liste sortert på klokkeslett skjuler at to av dem ligger i samme gate.

Geokodingen er den samme hurtigbufrede som adressekortet alt brukte
(`lib/geocode.ts`): hver adresse slås opp én gang, aldri på nytt. Pins tegnes
etter hvert som de kommer, så første gang ikke gir flere sekunder tom skjerm.
iOS-only, med samme fallback-mønster som `address-map` — `kartStottes` er
false på Android, og da skjules knappen.

### Andre runde gjennomgang: pengeveien, lageret og godkjenningen

Samme sporing som på skjemaene, nå på resten. Fire nye brudd, alle av samme
slag: en regel som finnes ett sted og ikke virker det andre.

**1. «Angre fakturert» angret ALLE fakturaer, ikke bare den siste.**
Delfakturering er designet inn — en linje som alt er fakturert utelates fra
neste grunnlag, så en ordre kan faktureres flere ganger etter hvert som det
kommer på mer arbeid. Men angreknappen tømte `invoiced_at` på HVER linje på
ordren. Etter faktura nummer to ville forrige fakturas linjer bli ufakturerte
igjen og havne på neste faktura. **Kunden betaler to ganger for samme jobb**, og
ingenting i appen sier fra. Nå angres kun runden — den kjennes igjen på
tidsstempelet, som er likt for alle linjer i én fakturering.

**2. Rabatt fra tilbudet forsvant når tilbudet ble ordre.** `quote_lines` har
`discount_percent`, `order_materials` hadde det ikke. Et akseptert tilbud med
20 % rabatt ble fakturert til full pris. Rabattfeltet er fullt implementert i
tilbudsskjermen («− X kr»), så dette var ikke teoretisk.
Skjema v31 + serverkolonne. Rundingsregelen (`linjeNettoOre` — én avrunding,
etter rabatten) er flyttet til `lib/invoicing.ts` og BRUKES nå av begge: to
kopier av samme regel er nettopp slik tilbudet og fakturaen ender ett øre fra
hverandre. Rabatten vises på linja, i delingsteksten og i arkivpakken — uten
den ganger ikke antall × enhetspris opp til beløpet, og en montør som ser to
tall som ikke stemmer stoler ikke på noen av dem.

**3. Godkjenningskøen forsvant uten nett.** `useKanGodkjenne` kalte
`supabase.rpc('kan_godkjenne_faglig')` rått fra skjermen — i strid med regel 2.
Uten nett kom det ikke noe svar, flagget ble stående false, og hele køen
forsvant fra «Meg». Faglig ansvarlig i en kjeller ville sett en app som sa at
ingenting ventet på ham. Nå brukes siste kjente svar med én gang; et FEILET
oppslag overskriver aldri et kjent svar, for «vet ikke» er ikke «nei». Trygt
fordi sperren ligger i databasen (`krev_faglig_godkjenning` + RLS) — flagget
styrer kun hva som vises.

**4. Å slette en materiallinje ga ikke varen tilbake.** Et uttak fra bilen
finnes som TO rader: `stock_movements` (varen er fysisk ute) og
`order_materials` (den skal på fakturaen). Sveip-slett fjernet bare den siste,
så beholdningen ble stående for lav for alltid — uten spor, og uten at noen
kunne se hvorfor bilen manglet ti downlights.
De to utfallene er fysisk forskjellige og bare mennesket vet hvilket som
gjelder, så nå spør vi: *«Lagt tilbake på lager»* sletter uttaket, *«Fortsatt
ute — bare ikke her»* løsner det fra ordren og legger det tilbake i kurven.

**Det som HOLDT, og som er verdt å vite holder:**

- Synken: 28 tabeller, **null** kolonneavvik mellom klient og server
- Fakturaskjermen advarer allerede om manglende kunde, med «Velg kunde»
- AI-verktøyene sjekker medlemskap på ordren før de skriver
- Prissnapshot tas overalt materiell opprettes (kurv, tilbudsaksept, AI)
- Uttak via stemme løser opp lokasjon og advarer om negativ beholdning
- Tilbud ↔ ordre er koblet begge veier ved aksept
- Fakturering krever faglig godkjenning, håndhevet av en databasetrigger

Én liten justering på veien: stemmeveien kunne lage en materiallinje uten
mva-type der kurven ikke kunne (`p.vatType` mot `p.vatType ?? 'hoy'`).

**Verifisert på ekte data:** appen bygget (0 feil), migrert v30 → v31,
`discount_percent` på plass, null gamle id-er, synkhelsa uendret.

### Det største hullet: ingenting forlater appen som et dokument

Sjekket 21. august, og det er verdt å skrive tydelig: **Ampex produserer ikke én
PDF.** `react-native-pdf` finnes, men bare for å VISE tegninger. Ingen
`expo-print`, ingen deling av fil, ingen e-post.

Konsekvensen i praksis:

| Det kunden skal få | Hva som skjer i dag |
|--------------------|---------------------|
| Sluttkontroll / samsvarserklæring | Finnes kun inne i appen |
| Tilbud | «Marker som sendt» — en statusendring, ingen forsendelse |
| Fakturagrunnlag | `Share.share({ message: tekst })` — ren tekst i en meldingsapp |

I dette faget ER dokumentet leveransen. En sluttkontroll kunden ikke kan få
utlevert, er ikke dokumentasjon for kunden — den er en notis hos oss. Og et
tilbud man ikke kan sende, er ikke et tilbud.

Dette er også det som gjør arkivet halvferdig: pakken er nå selvforklarende
(format 2), men det finnes ingen vei fra den til noe et menneske kan åpne.

**Merk at grunnlaget er på plass:** skjemamotoren kjenner alle felttyper,
signaturen har strøk og tidsstempel, arkivpakken bærer spørsmål og svar. Det som
mangler er gjengivelsen — HTML → PDF → del/arkiver. Én modul, ikke et lag.

### Påminnelser påminner ikke

`reminders` finnes som tabell, assistenten kan opprette dem, og de leses opp når
en samtale starter. Men **ingenting varsler**. Ingen `expo-notifications`, ingen
planlagt lokal varsling. Setter fattern en påminnelse, hører han om den kun hvis
han tilfeldigvis starter en stemmeøkt.

Push-entitlementen er strippet med vilje (`plugins/with-no-push-entitlement.js`),
men det gjelder APNs. **Lokale varsler krever den ikke** — dette er ikke blokkert
av noe.

### Gjennomgang: snakker delene sammen? — fire brudd funnet 21. august

Skjemaimporten gjorde det verdt å spore ÉN mal gjennom hvert sted den skal
virke: rendering, gap-check, Live-assistenten, faglig godkjenning, arkiv og
synk. Fire steder gjorde de ikke det.

**1. «Fullfør og signer» brydde seg ikke om påkrevde felt.** Det verste.
`findUnfilledRequired` fantes, var selvtestet og ble brukt av AI-en — men ikke
av knappen som avgjør om et dokument er ferdig. En sluttkontroll kunne merkes
fullført med hvert eneste påkrevde punkt blankt, telles som dokumentasjon i den
faglige godkjenningen, og fryses i arkivet med `null` på alt. Hele
påkrevd-maskineriet var pynt i den ene flaten der det betyr noe.
Nå: knappen er sperret, og de manglende punktene NAVNGIS. «Noe mangler» sender
montøren på leting gjennom førti punkt — og da fyller de bare noe.

**2. AI-en kunne skrive tekst i en tabell.** En tabell lagres som rader.
`components/form-field-view.tsx` faller tilbake til tom liste når verdien ikke
er en liste — så skjemaet så komplett ut, montøren signerte, og svaret fantes
ingen steder. Stille tap av dokumentasjon.
gap-check og voice-fill hadde dessuten HVER SIN regel for hva AI-en fikk fylle,
og de var ulike: innholdet i et dokument avhang av hvilken knapp som ble trykt.
Regelen ligger nå ett sted (`lib/forms/ai-fill-rules.ts`) og er selvtestet.
De to flatene skiller seg fortsatt på ett punkt, med vilje: Live-assistenten
FÅR se tabellene, fordi lista dens også er en statusrapport — utelot vi
kursfortegnelsen ville den sagt «skjemaet er ferdig» om et skjema som ikke var
det. Den kan si fra, men ikke skrive.

**3. Arkivpakken kunne ikke leses uten appen.** Dokumentene bar `mal`-id og en
nøkkel/verdi-tabell — ingen spørsmål. For en Ampex-mal går det an å slå opp,
men for et IMPORTERT firmaskjema finnes ordlyden kun i
`form_template_revisions`. En pakke som trenger databasen for å gi mening er en
peker til et arkiv, ikke et arkiv. **«12» er ikke et bevis. «Målt
isolasjonsresistans: 12 MΩ» er det.**
Pakken bærer nå spørsmål, enhet og alternativer, hentet fra den malversjonen
dokumentet FAKTISK ble fylt mot (`resolveTemplateAt`) — bruker man gjeldende
versjon, får frosne svar nye spørsmål når malen revideres, og da lyver arkivet
troverdig. Ubesvarte punkt tas med (at noe ikke ble besvart er også
dokumentasjon), og svar uten spørsmål havner i `uplasserteSvar` — ingen svar
skal noensinne falle ut, heller ikke ett vi ikke lenger vet spørsmålet til.
Formatet gikk 1 → 2. Gjort nå fordi det fantes **null** frosne pakker; etter
den første er formatet i praksis uforanderlig, siden en gammel pakke ikke kan
skrives om uten at hashen ryker.

**4. Assistenten kalte alle Ampex-maler «Ukjent skjema».** Malnavn ble slått opp
kun i `form_templates`, som bare inneholder firmaets egne. Spurte du «hva er
dokumentert på ordre 42?», kom hver sluttkontroll og samsvarserklæring tilbake
uten navn — mens importerte skjemaer virket. To malkilder, ett oppslag.

**Det som HOLDT:** synken dekker `form_templates`, `form_template_revisions`,
`form_comments` og `order_documents` (28 tabeller totalt), server- og
klientkolonner stemmer, `order_documents.template_id` er `text` og tar både
`ampex.*` og uuid, importerte maler publiseres rett inn i AI-ens malkatalog, og
rendereren håndterer alle åtte felttyper.

**Kjent og bevisst:** `photo`-felt i et importert skjema vises som et notat
(«bilde legges til i appen») fordi bildeopplasting ikke er bygget ennå. Et
påkrevd bildefelt blir dermed ikke påkrevd. Det står her fordi det er en ekte
begrensning, ikke fordi det er greit.

### Skjemaimport: firmaets eget skjema inn på ett minutt

Bygget 21. august. `Skjema → Importer` tar en **PDF eller et bilde** og gjør det
om til en redigerbar mal. Klikklister, tabeller, enheter og «hvis ja, beskriv»
blir med.

**Hvorfor denne veien og ikke SpeedyCraft-basen:** et firma som skal bytte
system har skjemaene sine fra før, og de ligger like ofte i et Word-dokument fra
2009 som i et fagsystem. Leser vi *filen deres*, virker importen mot SpeedyCraft,
Cordel, Handyman, NELFO **og** Word — uten én integrasjon. Å be dem taste inn
skjemaene på nytt er å be dem la være å ta systemet i bruk.

**Modellen lagrer ingenting.** Den lager et utkast; et menneske går gjennom det
før det blir en mal. En publisert mal går rett ut til montører som bruker den som
dokumentasjon — et punkt som ble lest feil blir et hull i papirene på en jobb.

**`lib/forms/import.ts` er det som står mellom modellen og malen.** En
språkmodell som leser et skannet skjema bommer alltid på det mekaniske: id-er som
kolliderer, klikklister uten alternativer, betingelser som peker nedover. Å be
mennesket rydde det opp er feil bruk av mennesket — det er deterministisk arbeid.
Regelen er **rett alt som kan rettes uten å gjette på innhold, og si fra om hver
eneste rettelse**. Da handler gjennomgangen om FAGET, ikke om datastruktur.

Selvtesten (`npm run verify:form-import`) tester ikke at modellen svarer riktig —
det kan ingen test love. Den tester at **uansett hva modellen svarer, kommer det
ut en mal `validateFirmSections()` godtar**. Et bevisst ødelagt svar med ti feil
i (duplikat-id, tom klikkliste, tabell uten kolonner, ukjent type, punkt uten
tekst, fire slags ugyldige betingelser, tom seksjon) kommer ut lovlig — og med ti
lesbare setninger om hva som ble gjort.

**Gjennomgangen er bygget rundt tre spørsmål, i rekkefølge:**

| Spørsmål | Hvor det besvares |
|----------|-------------------|
| Hva så den? | Kildekort: filnavn, antall deler og punkt, modellens egen merknad |
| Hva er den usikker på? | Gul ramme **på selve punktet** — ikke i en liste på toppen |
| Hva rettet den selv? | Sammenslått linje som åpnes hvis du vil vite |

Resten er den vanlige skjemaredigeringen, uendret. Ingen ny flate å lære.

**To valg verdt å vite om:**

- **Den dyre modellen brukes med vilje.** Import er en sjelden operasjon med
  varig resultat: en mal leses inn én gang og brukes på hver jobb i årevis.
  Kostnaden er engangs, feilen er ikke. `GEMINI_IMPORT_MODEL` (standard
  `gemini-2.5-pro`) faller tilbake til standardmodellen hvis navnet ikke finnes,
  så et modellbytte hos Google ikke tar funksjonen med seg.
- **Bilde er med, ikke bare PDF.** Et skjema finnes like ofte som et telefonbilde
  av et papirark. Den veien går gjennom Filer-appen, så den krever verken ny
  avhengighet eller nytt dev-build.

**Ikke prøvd mot en ekte PDF ennå.** Oppryddingen er testet i hjel; selve
lesekvaliteten er det bare et virkelig skjema som kan avgjøre. Det er den ene
tingen som gjenstår, og den tar fem minutter: `Skjema → Importer → Velg fil`.

### Stemme → transaksjon: assistenten kan nå gjøre jobben, ikke bare beskrive den

Live-assistenten (`lib/ai/live-session.ts`, verifisert på enhet 12.–13. august)
hadde 31 verktøy, men **null** for materiell, lager, varesøk og tilbud — altså
alt som er bygget denne runden. Nå har den **37**:

| Verktøy | Hva som skjer |
|---------|---------------|
| `sok_vare` | El-nummer, EAN, produsent eller navn → pris per grossist, hvem som er billigst, hva vi har på lager |
| `ta_ut_materiell` | «Jeg tok ti downlights fra bilen» → ekte `stock_movements`, lander i kurven |
| `legg_til_materiell` | «Sett tre meter PFXP på ordre 42» → materiellinje med prissnapshot |
| `nytt_tilbud` | «Nytt tilbud til Hansen på Storgata 4» |
| `legg_til_tilbudslinje` | «Tolv downlights og åtte timer montasje» → ekte beløp fra kartoteket |
| `tilbudssum` | Leser opp sum og **dekningsbidrag** — det eneste tidspunktet tallet kan endre noe |
| `vis_tilbud` | Åpner det på skjermen |

**Dette er skillet mot simPRO.** JobScribe (13. mai 2026) gjør tale →
dokumentasjon. Stemme til TEKST er tatt. Ingen har stemme til **transaksjon**:
at uttaket faktisk skriver en lagerbevegelse, at tilbudslinja faktisk får en
pris fra varekartoteket.

**Tilgang:** assistenten har brukerens tilgang, verken mer eller mindre.
`legg_til_materiell` krever medlemskap på ordren, som resten. Sperren ligger i
verktøyet, ikke i prompten — modellen kan ikke snakkes rundt den.

**Tre ting den fortsatt ikke får gjøre**, og det er ikke mangler:
sende et tilbud, fullføre/signere et skjema, godkjenne et tilleggsarbeid. Alle
tre er bindende handlinger ut mot en kunde. Den forbereder alt; mennesket
trykker.

**To ærlighetsregler er skrevet inn i instruksen**, begge om penger: er prisen
en listepris, skal den si at det er grossistens katalogpris og ikke firmaets.
Gir et uttak negativ beholdning, skal den si det høyt.

### Stemme på simulator — feilen som skjulte fallbacken

`isEchoCancelledMicAvailable` sjekket om det native mikrofonmodulet var
**kompilert inn**, ikke om det virket der appen kjører. På simulatoren er det
kompilert inn, så appen tok primærveien og kalte
`setVoiceProcessingEnabled(true)` — som kaster, fordi VoiceProcessingIO ikke
finnes på simulator. Økten døde med «Fikk ikke startet mikrofonen», og
`AudioRecorder`-fallbacken, som står der NETTOPP for simulator, ble aldri nådd.

Rettet 20. august: primærveien er nå et **forsøk**, ikke en tilgjengelighetssjekk
— enhver feil faller gjennom til fallbacken. Det hjelper også på enheter der
VoiceProcessingIO svikter av andre grunner.

> Merk likevel at **stemmen aldri har vært verifisert på simulator**, kun på
> enhet (12.–13. august). Ekko-kansellering, nærhetssensor og lydsesjonens
> avbruddshåndtering er maskinvare. Fallbacken holder mikrofonen døv mens
> assistenten snakker, så barge-in virker ikke der — det er forventet.

**Slik ser du hvor det stopper** (Debug, Metro-konsollen). Loggen er en stige:
`Live: kobler til` → `Live: setup OK — starter mikrofon` → `Live: mikrofon
streamer` → `Live: mottar lyd fra modellen`. Den siste du ser, er der det stoppet.
I Release leses feilen HØYT, og strengene peker rett på grenen: «avviste
tilkoblingen» = lukket før setup, «Mistet forbindelsen» = WS-feil, «Fikk ikke
startet mikrofonen» = mikrofonen, stille fade = ren lukking.

### Åpne punkter i stemmelaget

- ~~**`liveConnectConstraints` mangler**~~ **GJORT.** Tokenet er nå låst til
  `model` og `responseModalities: ['AUDIO']`. Det stanser den faktiske trusselen
  — en dyr modell på firmaets kvote — og at tokenet gjenbrukes som en gratis
  tekst-LLM.

  **Ikke** låst, med vilje: `sessionResumption` (Googles eget eksempel setter den
  til `{}`, men klienten sender et `handle` for å gjenoppta forrige samtale —
  låsing ville drept det), `speechConfig` (stemmen er et personlig valg i
  Meg-fanen), og `systemInstruction`/`tools` (instruksen bygges på klienten fordi
  den inneholder brukerens navn, notater, påminnelser og skjemakatalog).

  **UTRULLET 20. august — `ai-voice` versjon 5, ACTIVE.**

  Semantikken rundt `liveConnectConstraints` er tynt dokumentert, og en
  sikkerhetsherding som kan slå ut stemmen i felt er ikke en herding — den er en
  feil med god begrunnelse. Derfor er låsen bygget som noe som ikke KAN drepe
  stemmen, i stedet for noe som forhåpentligvis ikke gjør det:

  1. **Serveren faller tilbake selv.** Avviser Google selve constraint-formen
     (feil feltnavn, feil nesting, ikke støttet på modellen), utstedes tokenet
     uten lås i stedet for at kallet feiler. Vi er da tilbake på gårsdagens
     sikkerhet — ikke bedre, men heller ikke verre — og svaret sier
     `laast: false`, så det ikke blir en stille nedgradering.
  2. **Klienten har en stige.** Avvises økten ved setup, prøves den på nytt uten
     Google-søk (kvoten på grounding er den vanlige synderen), og deretter med et
     ULÅST token. Ett forsøk per trinn, aldri flere: `laast` er false på neste
     runde, så det kan ikke bli en løkke.

  Å la klienten be om et ulåst token svekker ikke trusselmodellen. Den handler om
  et token som snappes opp i tominuttersvinduet — den som allerede har brukerens
  innlogging kan uansett be om så mange tokens den vil.

  Feilmeldingen sier nå «Prøvd både med og uten låst token» først når BEGGE er
  utelukket. Å peke på låsen vi nettopp fjernet ville sendt feilsøkingen feil vei.

  **Nødbryter beholdt:** `supabase secrets set GEMINI_LIVE_UNLOCK=1` slår låsen av
  på serveren helt, uten utrulling.

  **Fortsatt uprøvd i en ekte økt** — men verste utfall er nå en logget
  nedgradering, ikke en død stemme.

  **Gjenstår:** Google anbefaler å flytte `systemInstruction` serverside. Det
  krever at all brukerkonteksten sendes til edge-funksjonen først, og er en egen
  jobb.
- ~~**Kode og dokumentasjon er uenige om aktivering.**~~ **AVKLART 20. august:
  Ampex-merket er inngangen.** `lib/ai/shake-listener.ts` er slettet.

  Merket sto allerede på åtte skjermer og startet økten; nå står det også på
  Prosjekter, Lager og Meg, så det er tilgjengelig fra alle fem faner.
  To-finger-dobbelttrykk beholdes som den usynlige veien når merket ikke er på
  skjermen.

  **Batterigevinsten er den egentlige grunnen.** Rist krevde et 50 Hz
  aksellerometer i forgrunnen HELE DAGEN for ti aktiveringer — i strid med regel
  8. Men strømmen var ikke bare til rist: ørepositur-sjekken leste den for å
  flytte lyden til ørehøyttaleren. Den har nå sitt eget abonnement på **10 Hz,
  kun mens en økt varer**.

  Sidegevinst: `setIsShakeToShowDevMenuEnabled(false)` forsvant med lytteren, så
  rist åpner React-dev-menyen normalt igjen i dev-builds.
- **Google-søk er av** (`ENABLE_GOOGLE_SEARCH = false`) fordi grounding har egen
  døgnkvote som drepte hele økter ved setup. Riktig beslutning, men assistenten
  kan ikke slå opp noe utenfor appen.

### Konsekvensen av at Ampex er leverandør, ikke elektrofirma

Dette er ikke bare et anskaffelsesspørsmål — det former produktet:

- **Varekartoteket er per firma, ikke felles.** `products` og `product_prices`
  er scopet på `company_id` med RLS. Det er riktig som det er, men det betyr at
  **prisfil-import er en del av onboardingen for hver eneste kunde**, ikke et
  oppsett vi gjør én gang.
- **Derfor må FTP-henting kjøre per kunde**, med kundens egne innloggingsdata, i
  Ampex Desktop eller en Edge Function scopet på `company_id`. Ikke én
  Ampex-bred nedlasting.
- **Det er også grunnen til at EFObasen ble droppet — og grunnen er sterkere enn
  prisen.** Punkt 2 i EFOs brukeravtale forbyr videreformidling. En leverandør
  som viser EFO-data til mange firmaer er ikke det API-prisen på 29 412 kr
  dekker. En prisfil er derimot kundens egne data, som vi leser på deres vegne.
  Det er juridisk rent, og det koster null.
- **Prismodellen følger av det samme:** Gripr tar betalt per integrasjon per
  måned, og lar kunden eie avtalen. Det er formen som bærer grossist- og
  regnskapskoblingene, og senere en eventuell EFObasen-avtale.

### Hva som fortsatt skiller oss fra konkurrentene

Etter denne runden er hullene mot Cordel/Handyman/Gripr disse, i den rekkefølgen
de betyr noe: **planlegging** (5), **foto** (2), **serviceavtaler** (7),
**prisbok per kunde** (9). Tilbud, signatur, timeliste og varekartotek er lukket.

Det vi har som de ikke har: offline-først med usynlig synk, versjonerte
firmaskjemaer med kommentarer og «hvorfor endret», LiDAR — og nå
**prissammenligning på tvers av grossister**, som er den ene tingen ingen
grossists eget system strukturelt kan bygge. Ahlsell gir bort autopåfyll fra
Ahlsell. Ingen kan gi bort «bestill hos den billigste».

Skjemamotoren er også den eneste som kan ta imot et fremmed skjema uten å miste
klikklistene.

### Fortsatt ikke synket

`reminders`, `assistant_notes`, `nfc_tags`, `mesh_markers`. De to første er
**bruker**skopet, ikke firmaskopet, og trenger en annen RLS-form enn resten.

### Android

Fungerer, men **LiDAR-skanning gjør ikke** — `ampex-splat` er
`platforms: ["apple"]`. Lastes i try/catch, så appen starter og degraderer.
Ordre, timer, materiell, faktura og varesøk virker fullt ut.

---

## Beslutninger som er tatt (ikke ta dem opp igjen)

- **EFObasen droppes for v1.** API-tilgang koster **29 412 kr/år eks. mva**
  (offentlig prisliste hos EFO), pluss etablering 6 000 kr. Prisfila fra
  grossisten dekker behovet, koster null, og har kundens egne priser.
- **Ampex public pool skal finnes**, med egen node først og Ampex som fallback.
- **Aktivering av AI-en er LUKKET.** To-finger-dobbelttrykk beholdes, og
  Ampex-merket er den synlige inngangen. Rist, back tap, dobbeltbank,
  løft-til-øret, vekkeord, App Intents, Flic, volumknapp og nærhetssensor er
  vurdert og forkastet. **Ikke foreslå en tolvte gest.**
- **AR er den vanskeligste anvendelsen av LiDAR, ikke den viktigste.** Tegning
  fra skann og måling uten målebånd krever mindre presisjon og treffer større
  marked. **Selg LiDAR på rehab** — SmartCraft Spark eier nybygg fra i år, med
  plantegning → visuell oppmerking → automatisk tilbud, gratis.
- **Ampex Desktop: Tauri v2 + React + TypeScript.** Ikke Electron, ikke RN for
  Windows.
- **Regnskap: Fiken først** (snudd 19. august — se begrunnelsen over).
  Tripletex som adapter nummer to.
- **Fargevalg: tonet grunn med hvite kort, ikke mørkt tema.** Kobber som eneste
  identitetsfarge.
- **Bygg ikke EDI mot grossist.** Minuba har 80+ grossister på e-postmal ut og
  FTP inn, med inntil 20 minutters forsinkelse. Det holder.
- **`ios/` er gitignorert og genereres av `expo prebuild`.** Rettelser i
  Xcode-prosjektet må gjøres som config-plugin under `plugins/`, ellers
  forsvinner de ved neste prebuild. `with-widget-version.js` er et eksempel: den
  synkroniserer widget-målets `MARKETING_VERSION` med appens `version`, fordi
  App Store Connect avviser opplasting når de spriker.
- **Ikke les priser fra grossistens nettbutikk.** Prisen som ligger åpent er
  listepris, og listeprisen er nesten lik hos alle — det er rabatten som
  skiller, og den finnes bare bak kundenummeret. En sammenligning på offentlige
  priser ville sagt «Onninen og Solar koster det samme», som er usant og verre
  enn ingen sammenligning. Full begrunnelse i `docs/GROSSIST_INTEGRASJON.md`.
- **AI-en kan foreslå tilleggsarbeid, aldri godkjenne det.** Et tillegg som
  fødes godkjent er et tillegg ingen spurte kunden om.
- ~~**Rist-lytteren bør slettes.**~~ **GJORT 20. august.** Ampex-merket er
  inngangen, to-finger-dobbelttrykk er reserven. Aksellerometeret leses nå kun
  under en aktiv økt, til ørepositur-sjekken.

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

---

## Sikkert / usikkert

### Sikkert (verifisert mot kode, kilde eller database)

- **Databasen synker 25 tabeller** etter ombyggingen, registerdrevet. Verifisert
  med `watermelon_pull(0)`. `quotes`, `quote_lines` og `order_signatures` kom til
  19. august og er verifisert med full rundtur (insert → delvis update → pull →
  soft delete) i en transaksjon som ble rullet tilbake.
- **Den registerdrevne synken plukket opp `orders.quote_id` uten kodeendring.**
  Kolonnen dukket opp i pull fordi kolonnene leses fra katalogen. Det var
  påstanden bak ombyggingen, og den er nå prøvd.
- **Skjemaformatets v1-lesevei virker.** Gamle flate `items`-revisjoner løftes til
  seksjoner av `toSections()`, testet i `verify:forms`.
- **Seks selvtester er grønne**: pricefile, invoicing, forms, quoting, timesheet,
  varesok.
- **To grossistpriser på samme el-nummer lever side om side**, og en ny import
  fra samme grossist oppdaterer raden i stedet for å duplisere. Verifisert med
  rundtur mot `product_prices`.
- **Fiken vil ha øre som heltall** og engelsk MVA-enum. Lest rett fra
  `api.fiken.no/api/v2/docs/swagger.yaml` (111 endepunkter).
- **Fiken HAR timeføring i API-et** — `/timeEntries`, `/activities`, `/timeUsers`
  og `/timeEntries/createInvoiceDraft`. Tidligere påstand om det motsatte var feil.
- **Tripletex har 490 endepunkter**, `/order` 21, `/project` 40, `/timesheet` 37.
- **EFObasen API: 29 412 kr/år eks. mva.** Fra EFOs egen prisliste.
- **Cordel har lagerstatus mot åtte grossister**, FTP-prisfiler fra fire, og
  elektronisk bestilling. Vår antakelse om at grossistene var lukket var feil.
- **Minuba aktiveres med e-postmal + FTP-polling**, inntil 20 min forsinkelse.
- **Ahlsell Partner har allerede bil-som-lager med strekkodeuttak og automatisk
  påfylling.** Autobestilling er ikke ny — men den er ny som *nøytral*.
- **simPRO lanserte JobScribe 13. mai 2026** (tale → jobbdokumentasjon).
  Stemme → tekst er ikke lenger en differensiator. Stemme → *transaksjon* er.
- **WatermelonDB dropper ukjente kolonner fra serveren** — `sanitizedRaw` bygger
  raden fra det lokale skjemaet. Lest i `node_modules`. Superset-pull er trygt.
- **`ampex-splat` er `platforms: ["apple"]`** og lastes i try/catch.
- **Formatspesifikasjonen E-NVare4.0r4** — semikolon, CP1252, CR+LF, `V4*`/`P4*`,
  implisitte desimaler.

### Usikkert (anslag eller uprøvd)

- **Parseren er ikke møtt med en ekte fil.** Både fixturen og demokatalogen er
  skrevet mot spesifikasjonen av samme hode som skrev parseren — en
  feiltolkning av formatet ville stått begge steder og passert alle testene.
  **Fortsatt den viktigste usikkerheten i alt som er levert.**
- **Ingen ekte synk fra appen er sett lykkes.** Migrasjonen og skjermene er
  verifisert i simulator, men pushen stoppes av UUID-feilen over. Til den er
  rettet vet vi ikke om synken virker fra klienten i det hele tatt.
- **Ingenting er kjørt på en fysisk telefon**, kun simulator.
- **Android er ikke bygget** i denne runden i det hele tatt.
- **Signaturflaten er uprøvd på ekte glass.** Skia + gesture-handler er riktig
  valg på papiret (ingen ny avhengighet), men om strøket føles som en penn på en
  telefon i regn er ikke noe som kan avgjøres i en typecheck.
- **Ukelista antar at `time_entries.date` er midnatt lokal tid.** Føres en time
  med et klokkeslett fra en annen tidssone, kan den havne på feil dag. Ikke
  observert, ikke testet mot ekte data.
- **Varekortet er bygget på hva `VX`/`VA`-postene BØR inneholde.** Vi vet at
  FELTID-ene `BILDE`, `FDV`, `HMS` og `EFOBASE` finnes, men ikke om alle
  grossister fyller dem, om de er URL-er hos alle, eller hvilke andre FELTID-er
  som er i bruk. Derfor lagres ALT i `products.extra` og vises med FELTID-en som
  etikett når vi ikke kjenner den — ingenting kastes, og en senere versjon kan
  forfremme flere felt uten ny import.
- **Ytelsen ved søk er beregnet, ikke målt.** LIKE-forfiltreringen bør holde,
  men verken 40 000 varer eller `products.search_text` uten indeks er prøvd på en
  telefon.
- **EFObasen-lenken på varekortet gjetter URL-formen** (`efobasen.no/produkt/<elnr>`).
  Den vises kun når fila oppgir en EFOBASE-verdi, men selve adressen er ikke
  verifisert.
- **Fiken-adapteren er ikke testet mot ekte API** — kun mot spesifikasjonen.
- **Om FTP-veien er åpen for tredjeparter** eller kun for systemleverandører med
  avtale. Viktigste enkeltspørsmål i grossistsporet.
- **Om Onninen har API/EDI i det hele tatt.** E-handelssiden nevner det ikke.
- **Tripletex' AI-samtykke (§2.2.13)** er skjønnsmessig og kan avslås.
- **Om §2.2.10 forbyr å sende Tripletex-data til Gemini.** Min lesning er ja,
  og at data derfor må holdes ute av modellkonteksten. Ikke bekreftet.
- **Baketiden er gjettet**, og «10–12 firmaer per node» arver den usikkerheten.
- **VRAM-anslaget (4–8 GB)** er regnet, ikke målt.
- **Om `ARWorldMap` er nøyaktig nok** til relokalisering. Utestet.
- **Ekvivalensmatching på tvers av produsent** via ETIM er en hypotese.

---

## Dokumentkart

| Fil | Innhold |
|-----|---------|
| `docs/STATUS.md` | Denne — hvor vi står, hva som er neste |
| `docs/DB_DRIFT.md` | **Les før du rører databasen.** Repoet er 18 migrasjoner bak |
| `docs/KONKURRENTANALYSE.md` | Hva Cordel, Handyman, Minuba, simPRO og Ahlsell faktisk har |
| `docs/GROSSIST_INTEGRASJON.md` | Prisfiler, FTP-kanalen, prissammenligning, autobestilling |
| `docs/REGNSKAPSINTEGRASJON.md` | Fiken/Tripletex — API-diff, kompatibilitet, friksjon |
| `docs/ROADMAP_2026-08.md` | Full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering |
| `docs/DESKTOP_OG_IMPORT.md` | Ampex Desktop, SpeedyCraft-import |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Skann-planen (utracket) |
| `docs/NEW_APP_PLAN.md` | Opprinnelig domene- og datamodell-plan |
