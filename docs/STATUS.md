# Status — les denne først

Sist oppdatert: 2026-08-21. Holdes oppdatert; ikke lag daterte kopier.

## Overlevering — start her

Branch **`grossist-og-pool`**, pushet. **34 commits** over `7633048`
(19.–21. august). Arbeidstreet er rent bortsett fra `modules/ampex-splat/ios/
MeshBakeV2.swift` og `MeshScanPresenter.swift`, som er Tormods egen WIP fra før
og skal ikke røres.

**Grønt:** `npm run typecheck` og tretten selvtester — `verify:pricefile`,
`verify:invoicing`, `verify:forms`, `verify:quoting`, `verify:timesheet`,
`verify:kalender`, `verify:varesok`, `verify:approvals`, `verify:arkiv`,
`verify:id-repair`, `verify:form-import`, `verify:prisfil-plan`,
`verify:kontor-tilgang`. Skjema **v31**.
iOS-bygget: 0 feil, 1 advarsel. Hele appen bundler rent
(`npx expo export --platform ios`). Kontorappen bygger rent (`cd desktop &&
npm run build`).

**Sist inn: Ampex Kontor er begynt** — `desktop/` finnes, med prisfil-import og
varekartotek. Eget avsnitt lenger ned, og `desktop/README.md`.

**UI-runden 21. august kveld** — brun grunnflate i hele appen, én font (Geist),
og ordrekalenderen — er fortsatt **ikke sett på en skjerm**. Det er det første
som bør gjøres.

### Det aller viktigste å ta med seg

**AI-en er hovedgrensesnittet, ikke skjermen.** Du trykker på Ampex-merket,
sier hva du vil, og assistenten gjør det — 38 verktøy, inkludert timeføring,
materiell, varesøk, tilbud og skjemautfylling. Skjermen finnes for å BEKREFTE
at det ble riktig, og for det tale ikke egner seg til.

Dette er lett å glemme, og jeg glemte det flere ganger i løpet av dagen: jeg
bygde en klokke med start/stopp-knapper (reversert, `e0d22b0`) og foreslo fem
nye faner (avvist). Begge løser at appen må betjenes for hånd. **Når AI-en gjør
mesteparten, trenger du færre steder og færre knapper, ikke flere.**

Assistentens oppførsel er «Jarvis»: gjør det du ber om, foreslå en bedre vei
ÉN gang hvis det finnes en, aldri omdefiner oppgaven. Se
`lib/ai/live-session.ts` sin systeminstruks — den er produktdesign, ikke
konfigurasjon.

### Verifisert på ekte data i dag

- Synk går. De åtte base62-radene som blokkerte ALT er skrevet om (skjema v30),
  og etterslepet kom fram i én transaksjon
- Migrasjon v26 → v31 kjørt på databasen med ekte data i
- Revisjonssporet skriver fra appen, med kun endrede felt
- Synk: 28 tabeller, **null** kolonneavvik klient/server
- To servermigrasjoner anvendt: `audit_row` rad_id, og
  `order_materials.discount_percent`
- `ai-voice` utrullet (låst token med fallback, mannsstemme, guidet gjennomgang)

### IKKE verifisert — gjør dette først

1. **Logg inn og se HELE appen.** Grunnflaten ble brun overalt 21. august, og
   ingen av skjermene er sett etterpå. Kontrast kan ikke typecheckes. Jeg lukket
   alle kontrastfellene jeg kunne finne mekanisk (se «Runden 21. august kveld»),
   men det som eventuelt står igjen er kremet tekst på en kremet flate — se
   spesielt etter kort som var hvite før.
2. **Snakk med assistenten.** Mannsstemmen, den guidede skjemagjennomgangen og
   Jarvis-regelen er alle uprøvd i en ekte økt.
3. **Kjør skjemaimporten mot en ekte PDF.** Oppryddingen er testet i hjel,
   lesekvaliteten er ikke prøvd én gang.
4. **Kjør på en ekte telefon.** Alt er sett på simulator.

### Det største hullet, uendret

**Ingenting forlater appen som et dokument.** Ingen PDF finnes. Sluttkontrollen
ligger inne i appen, tilbudet «markeres som sendt», fakturagrunnlaget deles som
ren tekst. I dette faget ER dokumentet leveransen. Se eget avsnitt lenger nede.

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

### Hva jeg ville tatt videre, i rekkefølge

1. **PDF ut av appen.** Låser opp kundeleveransen, tilbudet og arkivet på én
   gang, og har ingen ytre blokkering. Grunnlaget er der: skjemamotoren kjenner
   alle felttyper, signaturen har strøk og tidsstempel, arkivpakken bærer
   spørsmål OG svar. Det som mangler er gjengivelsen — HTML → PDF → del.
2. **Påminnelser som faktisk varsler.** Tabellen finnes, assistenten oppretter
   dem, ingenting varsler. Lokale varsler krever ikke push-entitlementen som er
   strippet.
3. **Foto på ordre og i skjema.** `photo` finnes som felttype, R2-opplasting
   finnes to steder. Bare fangsten mangler — krever ny avhengighet og dev-build.
4. **Instruksjoner/notater på ordren.** Både Jobber og SpeedyCraft har det.
   Montøren kommer fram og trenger å vite hva han skal gjøre; vi har
   dokumentasjon å FYLLE UT, men ingenting som forteller ham oppdraget.

Ikke gjør uten at Tormod ber om det: flere faner, bilmodus. Begge er foreslått
og avvist — de løser at appen betjenes for hånd. (Kalenderen sto på samme liste
til 21. august, da Tormod ba om den selv. Den ble en VISNING av ordrelista, ikke
en ny fane — det er forskjellen på å be om den og å foreslå den.)

### Arbeidsmåte som fungerte

- **Ta skjermbilde etter enhver fargeendring.** `xcrun simctl io booted
  screenshot`. Typecheck fanger ikke usynlig tekst; det gjorde skjermbildet, to
  ganger.
- **Bulk-erstatning av farger er en dårlig idé.** Typestilene bærer sin egen
  farge, så et kort som bytter bakgrunn må overstyre HVER tekst — ikke bare de
  som tilfeldigvis hadde en override fra før. **Løsningen ble en parallell
  typeskala** (`toolType`/`paperType`): en skjerm bytter flate ved å bytte
  importlinjen sin, ikke ved å redigere hundre `<Text>`.
- **Snu tokenene, ikke skjermene.** Da alt skulle bli brunt var det 39 skjermer
  igjen. Å flippe standardverdiene i `lib/tokens.js` og gi UNNTAKET (papiret)
  egne navn tok en brøkdel av tiden, og gjør at neste skjerm blir riktig av seg
  selv i stedet for å måtte huskes på.
- **Skriv en sjekk for det typecheck ikke ser.** `colors` er
  `Record<string, string>`, så `colors.finnesIkke` kompilerer fint og blir
  `undefined` ved kjøring — gjennomsiktig flate, usynlig tekst. Et 20-linjers
  skript som slår hver `colors.X` i app/, components/ og lib/ opp i tokens
  fanger hele klassen.
- **Expo-pakker installeres med `npx expo install`, aldri `npm install`.** Et
  SDK 57-bibliotek i et SDK 56-prosjekt bygget med 0 feil og krasjet ved
  oppstart med «Symbol not found».
- **Ingenting kosmetisk får blokkere oppstart.** Fonten holdt hele treet tilbake
  og hvitskjermet appen uten én feilmelding noe sted.

### Uncommittet som IKKE er mitt

`modules/ampex-splat/ios/MeshBakeV2.swift` og `MeshScanPresenter.swift` er din
WIP fra før. Urørt.

---

## Runden 21. august (kveld): brun grunnflate, én font, ordrekalender

Fire ting Tormod ba om, i denne rekkefølgen. Alt er typechecket, alle elleve
selvtestene er grønne og hele appen bundler for iOS — men **ingenting er sett
på en skjerm.** Kontrast er det eneste i denne runden som ikke kan verifiseres
uten øyne.

### 1. Ordrekalenderen

«Elsker timer-charten for uken — kan man gjøre noe lignende på avtalte jobber?»

Det ble en tredje **visning** av ordrelista (knappen ved siden av kartet), ikke
en ny fane og ikke en ny skjerm. Filterchipsene gjelder alle tre visningene —
samme begrunnelse som allerede sto i koden for kartet.

- Samme ukevelger og samme søylehøyde som «Mine timer», men **hver blokk er én
  avtalt jobb**. En dag med fire jobber ser tung ut på en meters avstand; det er
  hele poenget med å tegne det.
- Under søylene: dagens jobber med klokkeslett først, og til slutt **«Ikke satt
  opp»** — ordrene uten dato. De hører ikke til i noen uke, og er derfor det
  egentlige arbeidet på skjermen.
- Regnestykket ligger i `lib/schedule-calc.ts`, uten database, og deler
  ukevelgeren med `timesheet-calc` så de to aldri kan bli uenige om hvilken uke
  det er. `npm run verify:kalender` — 14 påstander som dekker det som faktisk
  kan gå galt: jobb i feil dag, søndag 23:59 som lekker til neste uke, og
  sommertidsukene i mars og oktober der en floor-divisjon på døgnet bommer.
- **Jobber har ingen varighet.** Blokkene sier *antall*, ikke *hvor lenge*. En
  ekte dagsplan med tidslinje (08–16) krever et estimert timetall på ordren.

### 2. Én font: Geist

Instrument Serif på titler + systemfont på brødtekst er borte. Systemfonten var
dessuten ikke ett valg men to — SF på iOS, Roboto på Android.

**Regelen som følger av dette, og som er lett å bryte uten å merke det:**
`Text` og `TextInput` importeres fra `components/text.tsx`, aldri fra
react-native. En egendefinert font kan ikke gjøres fetere av `fontWeight` — hver
vekt er sin egen fil — så vekt→fil oversettes der, ett sted, for alle 118
stedene appen overstyrer vekt. Importerer du fra react-native vises teksten
fint, bare i feil vekt. Det er en feil ingen oppdager og alle ser.

RN 0.85 gjorde `Text` til en vanlig funksjonskomponent, så den kan ikke patches
sentralt slik man kunne før. Innpakningen ER løsningen, ikke en snarvei.

Kun de fire vektene appen bruker lastes (400/500/600/700, 364 kB). Importer fra
undermappene — `@expo-google-fonts/geist/400Regular` — pakkeroten drar med seg
alle 18 vektene inn i bundelen.

### 3. Grunnflaten er brun — overalt

«Alt skal være brunt bortsett fra inne i dokumenter.»

Gjort ved å **snu standardverdiene** i `lib/tokens.js` i stedet for å konvertere
39 skjermer hver for seg: `canvas`, `bg`, `fill`, `label`, `separator` og resten
peker nå på de brune verdiene. Papiret fikk egne navn (`paperCanvas`,
`paperLabel`, …) og gjelder kun der du står INNE i et dokument:

- utfylling av skjema på ordre, og signering
- skjemamalen: vise, redigere, lage nytt, importere
- tilbudsdokumentet
- tegningen (arbeidsflaten var lys fra før)

Lister over dokumenter — skjema-lista, tilbudslista, arkivet — er brune. Det er
ikke et dokument å bla i en liste.

Papirskjermer bruker `paperType as t`, `colors.paper*` og
`usePapirStatuslinje()`. Alt annet bruker standardtokenene og blir riktig av seg
selv.

### 4. Knapper er kremet eller kobber

`cta` er kremet (#F6F1E8) med varm sort tekst; kobber (`brand` + nye
`brandLabel`) er den andre. Den gamle varmsorte knappen forsvant i det grunnen
ble brun. Dokumentskjermene bruker kobber — en kremet knapp på et kremet ark er
ingen knapp.

Samtidig: **«Legg til materiell/dokumentasjon» er ekte knapper nå**, ikke 13 px
kobbertekst med teksten selv som treffflate. Og skjemavelgeren og
skanntype-velgeren bruker Ampex-arket (`components/sheet.tsx`) i stedet for
`ActionSheetIOS`. Det siste var mer enn kosmetikk: systemarket finnes ikke på
Android, og fallbacken der åpnet bare *det første* skjemaet i lista uten å
spørre.

### Fellene som ble lukket i flippen

Disse hadde alle blitt usynlig tekst eller usynlige flater. De står her fordi
samme klasse feil kommer tilbake neste gang noe bytter flate:

| Felle | Rettet til |
|-------|-----------|
| `*Soft`-statusfargene var nesten hvite (#FFF4E5) | fargen som alfa — virker på begge flater |
| `slate` #3F4B5C — riktig på kremet, usynlig på brunt | løftet til en lys kjølig tone |
| Statuslinja sto på mørk tekst | lys er standard; papiret ber om mørk |
| Ordredetaljen brukte `cta` som sin egen mørke grunn | `canvas` |
| Varesøket og Ampex-merket hadde papir som standard | brunt som standard, papir som prop |
| Handlekurv-arket og regnestykket på tilbudslinja var kremede paneler | panel på grunnen |
| Glass, ambient-flekker og BlurView-toner | mørke på brunt, lyse på papir |

**Sjekken som fanger resten:** `colors` er `Record<string, string>`, så et
fargenavn som ikke finnes kompilerer fint og blir `undefined` ved kjøring. Et
lite skript som slår hver `colors.X`-referanse opp i tokens fanger hele klassen
— verdt å skrive på nytt neste gang paletten røres.

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
   `Alert.alert` viser maks tre knapper der, og `ActionSheetIOS` finnes ikke i
   det hele tatt. Bruk `components/sheet.tsx`.
6. **`Text` og `TextInput` importeres fra `components/text.tsx`**, aldri fra
   react-native. Vekt→fontfil oversettes der; importerer du fra react-native
   vises teksten fint, bare i feil vekt — en feil ingen oppdager og alle ser.
7. **`pruneHidden` må kalles hver gang et skjemasvar endres.** Fjernes den,
   blir svaret på et punkt som ble skjult liggende igjen i dokumentet uten å
   vises noe sted i appen — «ingen avvik» levert sammen med en avviksbeskrivelse.
   Kalles i dag tre steder: skjema-skjermen, gjennomgangsarket og `applyVoiceFill`.
8. **En skjemarevisjon skrives ALDRI om.** v1-formatet (flat `items`) må derfor
   kunne leses for alltid — `toSections()` er den ene leseveien, og selvtesten
   passer på den.
9. **Tilbudslinjens pris er et snapshot i kroner**, ikke en peker til varen.
   Gjøres den om til et oppslag, endrer et sendt og bindende tilbud beløp fordi
   grossisten sendte ny prisfil.
10. **Rabatt rundes én gang, etter rabatten** (`linjeNettoOre`). Rundes
   linjebeløpet først og rabatten etterpå, stemmer ikke summen med det kunden
   regner ut av tallene på arket.
11. **`products.cost_price` er den BILLIGSTE kjente prisen, ikke den sist
    importerte.** Settes den til siste import igjen, blir dekningsbidraget feil
    på hver linje der en annen grossist er billigere. Alle prisene ligger i
    `product_prices`; `cost_price` er kun det raske oppslaget.
12. **`search_text` må skrives hver gang en vare lagres.** Uten den faller varen
    ut av SQLite-forfiltreringen og blir usynlig i søket. `useVaresok` bygger den
    på farten som reserve, men det virker bare for rader som allerede er hentet.
13. **Listepris og nettopris er ikke samme størrelse.** `lib/pricing.ts` lar
    ALDRI en listepris (brutto uten rabatt, altså en `V4`) slå en ekte nettopris,
    og påstår aldri en «besparelse» mellom to listepriser. Fjernes den regelen,
    anbefaler systemet en grossist på et tall ingen har avtalt — og
    dekningsbidraget blir for lavt, så en lønnsom jobb ser ulønnsom ut.
14. **Prisfil-import fyller kun varekortfelt fila FAKTISK har.** En grossist uten
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

### Timeføring: si det, eller skriv det

Klokka som startet ved «Start jobben» ble bygget og **reversert samme dag**.
Den løste feil problem. Modellen er ikke at appen måler dagen din — den er at
du trykker på merket og sier *«legg til 7,5 timer på den ordren»*, eller fører
dem for hånd på ordren. To veier, ingen tredje som må vedlikeholdes.

Det som manglet var ikke en klokke. Det var at assistenten **aldri spurte om
kommentaren**. `foer_timer` har alltid tatt et notat — og notatet står PÅ
FAKTURAEN til kunden, ofte det eneste hun leser — men montøren tilbyr det ikke
selv, og verktøyet ba aldri om det.

Nå: timene føres FØRST, uten spørsmål. Så tilbys kommentaren, én gang, og bare
når den mangler. Rekkefølgen er med vilje — timene er det viktige, og et
spørsmål i veien kan koste begge deler hvis samtalen brytes.

Nytt verktøy `utfyll_timenotat` (38 totalt) legger kommentaren på føringen
etterpå. Fire grenser: bare din egen føring, bare på den ordren, bare i dag, og
bare hvis den ikke alt har en kommentar. Uten dem kunne assistenten skrevet
over en kollegas beskrivelse av hva HAN gjorde — og en kommentar som er feil er
verre enn ingen kommentar.

### Telefonen er felt, desktop er kontor

SpeedyCraft-skjermbildet avgjorde rekkefølgen. Deres ordre er Timer →
Produkter → Skjema → Vedlegg, og det er riktig: **flyten på en ordre er
timeføring og materiell**, ikke fakturering.

Delingen som nå gjelder:

| Telefon (felt) | Desktop (kontor) |
|----------------|------------------|
| Timer, materiell, dokumentasjon, 3D-skann | Kundesignatur |
| Tilleggsarbeid (når prisen er avtalt) | Fakturagrunnlag og fakturasending |
| Beskjed fra faglig ansvarlig ved avslag | Deltakerliste, avtalt pris |

Kontorsakene er **ikke fjernet — de er lagt bak ett trykk** under «Kontor». Å
amputere en funksjon fordi den er sjelden er like galt som å la den ligge
øverst fordi den finnes. Men fire rader montøren aldri trykker på, midt blant
de tre han bruker hver dag, er akkurat den slags rot SpeedyCraft-skjermen viser
for mye av.

**Ett unntak slipper aldri å bli skjult:** mangler ordren kunde, kan den ikke
faktureres — og det må oppdages mens montøren står på stedet og kan spørre hvem
regningen skal til. Den advarselen vises også når «Kontor» er lukket.

### Jobber-mønsteret: én forankret hovedhandling

Det Jobber og Tradify gjør som vi ikke gjorde: **hver skjerm har ÉN handling.**
Hos oss konkurrerte fem kort med lik vekt, og statusknappen — det eneste steget
som faktisk flytter jobben framover — lå nederst mellom «Endre status» og
metadata.

Nå ligger den forankret nederst, over tabbaren, alltid synlig uansett hvor
langt ned du har rullet. En montør med hansker skal ikke lete.

**Verbet er halve poenget.** «Marker som pågår» beskriver en databasekolonne.
«Start jobben» beskriver det montøren gjør. Den ene må oversettes i hodet, den
andre ikke.

| Status | Handlingen |
|--------|-----------|
| mottatt | Marker som planlagt |
| planlagt | **Start jobben** |
| pågår | **Meld ferdig** |
| fakturaklar | **Til fakturagrunnlaget** (peker videre — fakturering krever godkjenning) |
| fakturert | ingen — jobben er ferdig, og da skal det ikke stå en knapp der |

Materiell-lista kappes til de fire SISTE med «Vis alle N» under. En jobb kan ha
tjue linjer, og tjue rader dyttet dokumentasjonen ut av syne — halve grunnen
til at siden føltes uendelig. De siste, ikke de første: det du nettopp førte er
det du vil se at kom med.

### Femte brudd: statuslista kunne sette «fakturert» direkte

Funnet under omleggingen. `setStatus` skrev status rått, og «Fakturert» lå som
en likeverdig chip. Ett trykk der hoppet over `markerFakturert()` — som krever
faglig godkjenning, stempler `invoiced_at` på linjene og låser dem mot ny
fakturering. Uten det kan samme arbeid faktureres om igjen.

Og verre: serveren har en trigger (`krev_faglig_godkjenning`) som avviser
status `fakturert` uten godkjenning. Siden `watermelon_push` kjører i én
transaksjon, ville ett slikt trykk **blokkert hele synken** — stille, akkurat
som base62-id-ene gjorde. Nå sender chippen deg til fakturaskjermen i stedet.

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

## Ampex Kontor — skallet står (21. august)

`desktop/` er en Tauri v2 + React + TS-app. Den kjører foreløpig som nettdel
(`cd desktop && npm run dev`, port 5174); Rust-siden er skrevet, men **ikke
kompilert** — `rustup` er ikke installert på maskinen, så `npm run tauri dev`
er uprøvd. Full begrunnelse for stacken står i `docs/DESKTOP_OG_IMPORT.md`.

**Ordre er hovedskjermen, og den virker.** Liste til venstre, detalj til
høyre — formen kontorfolk kjenner fra Handyman Office og Cordel, fordi den er
den eneste som lar deg gå gjennom en bunke uten å navigere fram og tilbake.
Filtrering på status med tall per status, søk på ordrenummer/kunde/adresse,
piltaster i lista, og fem faner: Oversikt, Materiell, Timer, Dokumentasjon,
Fakturagrunnlag.

Fakturagrunnlaget REGNES IKKE PÅ NYTT. `lib/invoicing.ts` gjør det, den er ren,
den har `verify:invoicing`, og montørappen bruker den samme. To regnestykker på
samme faktura er ett for mye. Det samme gjelder `finnAvvik()` fra
`approvals-calc.ts`: godkjennes en ordre på 12 400 kr og noen fører to timer
etterpå, står det «Godkjent, men endret siden» på skjermen.

**Prisfil-import virker.** Det er den ene jobben som gjorde at Desktop måtte
finnes i det hele tatt: montøren skal ikke ut på web for å laste opp en
grossistfil. Tre steg — les fila lokalt, regn ut mot kartoteket, skriv — der
steg to er sitt eget trykk fordi det koster nett.

Regningen ligger i **`lib/pricefile/plan.ts`**, altså i den delte lib-en, ikke i
desktop. Der har den selvtest (`verify:prisfil-plan`, 40 påstander), og der kan
montørappen ta den i bruk senere uten en flytting. Skrivingen ligger i
`desktop/src/lib/prisfil-lager.ts` og har ingen test, fordi den ikke inneholder
regning — bare upsert.

### Åtte flater, i tre grupper

**ARBEID** — dagen kontoret jobber gjennom:

| Flate | Hva den er |
|-------|-----------|
| Oversikt | Forsiden. Svarer på ett spørsmål: hva må noen gjøre noe med i dag? |
| Ordre | Liste og detalj side om side. Hovedskjermen |
| Prosjekter | Bygg med rom, tegninger og oppgaver. Kolonnene er rom og oppgaver, ikke kroner — pengene ligger på ordrene |
| Tilbud | Det som ligger ute hos kunden og det som er sagt ja til. Summen fra `lib/quoting.ts`, statusen er den EFFEKTIVE (utløpt slår sendt) |
| Timer | Hele firmaets timeliste, uke for uke, én rad per person og sju dagkolonner. Ukeinndelingen fra `lib/timesheet-calc.ts` |

**REGISTER** — oppslagsverket bak:

| Flate | Hva den er |
|-------|-----------|
| Kunder | Registeret SpeedyCraft-importen lander i. `source_system` vises som egen merkelapp, og org.nr har egen kolonne fordi det er den eneste harde dedup-nøkkelen |
| Varer | Kartoteket med søk mot `search_text`, kostpris, utsalg og hvor mange grossister vi har pris fra |
| Prisfiler | Importen, pluss «siste import per grossist» med alder — 94 dager gamle priser er ikke en teknisk detalj, det er feil dekningsbidrag |

**KVALITET** — det som gjør at firmaet kan vise hva de gjør:

| Flate | Hva den er |
|-------|-----------|
| Internkontroll | Firmaets IK-system, punkt for punkt. Den ENESTE flaten som skriver noe utenom prisfilimporten |
| Skjemaer | Firmamalene, historikken deres, og hvilket IK-punkt hver av dem hører til |

**Det finnes ingen endringslogg-flate, og det er en beslutning.** En tabell med
alle firmaets hendelser er utviklerens utsyn på databasen. Det kontoret faktisk
lurer på er «hva har skjedd med DENNE rutinen», så historikken står PÅ rutinen
og PÅ malen. Se `desktop/src/ui/Historikk.tsx`.

**FIRMA** — oppsettet man rører sjelden: innstillinger (oppbevaringstid, faglig
ansvarlig, regnskapssystem), ansatte med rolle, og bake-nodene. Det siste er
begynnelsen på poolens klientside, som hører hjemme her og ikke i montørappen.

---

## Internkontroll — bygget 21. august

Faglig ansvarlig kan nå bygge firmaets IK-system fra kontoret. Migrasjonen
`supabase/migrations/20260821180000_internkontroll.sql` er **kjørt**: tre nye
tabeller (`ik_punkter`, `ik_revisjoner`, `ik_punkt_skjema`), RLS, og
audit-triggere. Den rører ingen eksisterende tabell bortsett fra at
`form_templates` og `form_template_revisions` endelig fikk `audit_row` — de
manglet sporing helt. Rulles tilbake med `drop table`.

### Hvorfor egne tabeller

Et IK-punkt er en RUTINE med hjemmel, ansvarlig og gjennomgangsfrist. Et skjema
er noe man fyller ut. De henger sammen — punktet «Sluttkontroll» peker på
sluttkontrollskjemaet — men et kapittel presset inn i en skjemamal mister
nettopp de feltene som gjør systemet levende.

### Lesebekreftelse per person og per VERSJON

`ik_lest` (migrasjon `20260821220000_ik_lest.sql`, kjørt). Hver ansatt krysser av
for at hun har lest rutinen, og avkryssingen gjelder **én versjon**. Endres
rutinen til v3, står alle som bare bekreftet v2 som uleste igjen — automatisk,
uten at noen må huske å nullstille noe.

Det er nettopp den mekanismen § 5 andre ledd nr. 2 ber om når den sier at folk
skal ha kunnskap om HMS-arbeidet «herunder informasjon om **endringer**». At
noen leste rutinen én gang sier ingenting om at de har lest den etter at den
ble endret.

To ting i RLS er med vilje: `insert` krever `user_id = auth.uid()` — en
bekreftelse noen andre kan sette på dine vegne er ikke et bevis. Og det finnes
**ingen update- eller delete-policy**: en avkryssing som kan redigeres bort i
ettertid er ingen dokumentasjon.

### Den levende delen er tre ting

1. **Gjennomgangsfristen.** Hvert punkt har intervall og dato for sist
   gjennomgang. Går fristen ut, sier punktet fra selv. «Gjennomgått i dag»
   flytter fristen uten å lage revisjon — ingenting ble endret — men havner i
   audit-loggen, så gjennomgangen kan dokumenteres.
2. **Revisjonene.** Hver endring arkiveres med HELE teksten, ikke en diff, og
   med påkrevd endringsnotat. Skal man dokumentere hva rutinen SA den dagen noe
   skjedde, holder det ikke å vite hva den sier nå. `ik_revisjoner` har ingen
   update-policy: historikk som kan redigeres er ingen historikk.
3. **Historikken på hvert punkt.** Revisjonene og databasens audit-spor slås
   sammen til én tidslinje av `lib/ik/hendelser.ts` (`verify:ik-hendelser`).
   Den viktigste regelen der: én lagring skriver BÅDE en revisjonsrad og en
   audit-rad, og skal telles én gang. Vises begge, står hver endring dobbelt,
   og en historikk som teller dobbelt er en historikk ingen stoler på.

   Tidslinja skiller også «vedtatt» og «gjennomgått, ingen endring» fra vanlige
   feltendringer. En gjennomgang som så ut som en tilfeldig lagring ville ikke
   dokumentert noe. Auditsporet vises bare til roller med `logg.les`;
   revisjonene, som bærer endringsnotatet, er en del av dokumentet og leses av
   alle som leser rutinen.

### Skjelettet

`lib/ik/skjelett.ts` gir fjorten punkter med formål og hjemmel, men **uten
innhold**. Rutinene må firmaet skrive selv; et IK-system skrevet av
leverandøren er nettopp den døde permen forskriften skal hindre.

### To tall, ikke ett

Flaten viser **«Skriftlige krav dekket 0 / 5»** og **«Punkter med rutine 0 / 14»**
ved siden av hverandre, med en setning under som sier hvilket som er hvilket.

Femtallet er de punktene internkontrollforskriften § 5 tredje ledd krever
skriftlig, altså andre ledd nr. 4–8: mål, organisasjon, risikovurdering,
avvikshåndtering og systematisk gjennomgang. Det er punkt 1–5 i skjelettet.

Det ene tallet alene var misvisende, og en bruker spurte med én gang: «hvorfor
står det 0/5 når det er 14?». Med bare det tallet ser det ut som fem er alt
firmaet trenger. **Punkt 6–8 er nr. 1–3 i samme paragraf og like bindende** —
de har bare ikke kravet om skriftlighet. **Punkt 9–13 følger av FEK og FEL**,
der flere har egne dokumentasjonskrav, og det er faglig ansvarlig som må
vurdere hvilke.

Femtallet er likevel det som teller for «er systemet komplett»: et firma med
fjorten fine kapitler og ingen avvikshåndtering har ikke et
internkontrollsystem, og en samlet prosent som sa 93 % ville skjult det.
Selvtestet i `verify:ik-skjelett`.

**Hjemmelshenvisningene til § 5 er presise. De elektrofaglige punktene har
INGEN paragraf**, med vilje: en feil paragrafhenvisning i et IK-system er verre
enn ingen, og faglig ansvarlig er den som skal slå den opp i gjeldende
forskrift. Feltet er fritekst nettopp derfor.

**Ikke bygget ennå på ordreflaten:** å skrive fra kontoret. Alt er lesing.
Å rette en føring, godkjenne faglig og markere fakturert er de tre neste, og de
er i den rekkefølgen fordi den siste er sperret av databasen uten den midterste.

### Roller: hva som vises, ikke hva som er lov

`lib/kontor-tilgang.ts` er en matrise over ni rettigheter og sju roller, med
selvtest (`verify:kontor-tilgang`). Den er **ikke sikkerhetsmodellen** — RLS,
`krev_faglig_godkjenning` og `kan_godkjenne_faglig()` er det. Matrisen fjerner
rot, ikke risiko.

| Rolle | Kort sagt |
|-------|-----------|
| Eier, administrator | Alt |
| Regnskapsfører | Alle ordrer, tilbud, timeliste, kunder, fakturagrunnlag og dekningsbidrag. Markerer fakturert. Retter ikke montørens føringer, importerer ikke prisfil |
| Installatør | Hele firmaet, retter føringer, ser summen han godkjenner og hele timelista. Ikke dekningsbidrag, ikke fakturering, ikke firmaoppsettet |
| Bas | Sine egne ordrer, prosjektene og kunderegisteret. Ingen priser ut mot kunde, og ikke firmaets timeliste |
| Montør, lærling | Slippes ikke inn. Alt de trenger ligger i appen |

Timelista er verdt en merknad: den er **lønnsgrunnlag**, og basen har den ikke.
Timene han faktisk trenger står på ordrene hans, og en samlet oversikt over hva
kollegaene har ført er noe annet enn å lede en jobb.

To ting er verdt å huske. **Menyen viser bare det rollen kan bruke** — en
regnskapsfører ser ikke «Prisfiler» og får beskjed om at hun ikke har lov, hun
ser den ikke. Og **«kan godkjenne faglig» spør databasen**, ikke rollen:
`company_settings.faglig_ansvarlig` peker på én person, og en installatør er
ikke automatisk den personen.

### Ampex-merket er inngangen til assistenten

Sidemenyens topp er **den ekte logoen** (samme paths som `components/ampex-logo.tsx`
og `assets/ampex-icon-black-on-white.svg`, portert til vanlig SVG i
`desktop/src/ui/AmpexLogo.tsx`). Den er en KNAPP, ikke en dekorasjon: den åpner
assistentskuffen, og Ctrl+K gjør det samme uten mus. Det er samme regel som i
appen, der merket er den synlige inngangen.

**Den talende assistenten er ikke koblet på kontoret ennå,** og skuffen later
ikke som noe annet — den sier det rett ut i bunnen. Det som ligger der i dag er
kommandopaletten: skriv hva du vil se, Enter. Samme inngang og samme vane, så
den dagen modellen kobles på er det ingen ny plass å lære.

Å koble den på krever tre beslutninger som ikke er tatt: tekst eller tale på
kontoret, hvilke av appens 38 verktøy som gir mening her, og hvor konteksten
skal komme fra. `supabase/functions/ai-voice` er en tynn Gemini-proxy der
klienten sender all kontekst selv (appen har den lokalt via WatermelonDB), og
kontoret har den ikke lokalt.

### Forsiden

`Oversikt` er ny og er første flate. «Venter på deg» står øverst og lister bare
det som FAKTISK venter — en linje med tallet 0 er ikke informasjon, den er en
linje man må lese for å finne ut at den ikke gjaldt. Er alt i orden, sier flaten
det med én setning.

Forsiden regner ikke penger. Fakturagrunnlaget må hentes per ordre og er dyrt;
å gjøre det for hele porteføljen for ett tall ville gjort at flaten tok flere
sekunder å åpne. Kroner står på ordredetaljen.

### Tre valg som ble tatt her, og som ikke bør omgjøres uten grunn

1. **Kontoret skriver rett mot Supabase, ikke gjennom WatermelonDB.** Regel 2 i
   `CLAUDE.md` er en regel for montørappens skjermer: telefonen mister dekning i
   en kjeller. Kontor-PC-en gjør ikke det, og skal ikke lagre en hel
   grossistkatalog lokalt bare for å synke den opp igjen.
2. **Delt logikk, aldri delt UI. Og kontoret er PAPIR, ikke brunt.**
   `lib/` importeres med `@delt/…`. Paletten er fortsatt den låste, men kontoret
   bruker `tokens.js` sin PAPIRdel — den regel 9 beskriver som «det du ser når du
   står INNE I et dokument»:

   ```
   #EFEAE1 paperCanvas   lerret      #2E281F paperLabel      brødtekst
   #FFFFFF paperBg       kort        #5C5340 paperIcon       sekundær
   #E5DDCE paperFill     inputfyll   #96896F paperSecondary  hjelpetekst
   #DED6C7 paperSeparator hårlinje   #C9C0AC paperTertiary   plassholder
   #CDC4B1 paperBorder   sterk kant  #A97C4F brand           KOBBER, den ene aksenten
   ```

   Skillet er regel 9 sitt eget, og kontoret bruker BEGGE halvdelene:
   **sidemenyen er brun** (`#211C15`, montørappens `canvas`) fordi den er
   verktøyet du navigerer med, og **innholdet er papir** fordi det er dokumentet
   du leser og skriver. Kontrasten mellom dem er ikke pynt — den forteller hva
   som er krom og hva som er sak.

   Semantikken er den samme, men **mørknet** for papir: `#34C759` er valgt for å
   lyse på brunt og er uleselig på hvitt. Kobberet finnes av samme grunn i to
   lysheter — `#A97C4F` på papir, `#B98A5C` på brunt. Samme kulør, justert for
   underlaget.

   **Formen følger `DESIGN.md`** (Dubs system, med Ampex-farger i stedet for
   electric blue og deep sapphire): lyst lerret, **hårlinjer i stedet for
   skygger**, tett monokrom typografi som gjør det strukturelle arbeidet, og én
   aksent som snakker. Kort er hvite med 1 px `#DED6C7`-kant og ingen skygge —
   kanten er systemet.

   Radiusvokabularet er stramt og har fire trinn: 6 input, 8 knapp, 12 kort,
   16 store kort, 9999 piller. Ad hoc-avrunding bryter rytmen.

   Skygge brukes i to tilfeller og ikke flere: et såvidt merkbart løft på fylte
   knapper, og en ring rundt skuffen som flyter over siden.

   Aktivt menyvalg er en **myk kobberflate**, ikke en fet stolpe i kanten —
   DESIGN.md er uttrykkelig på det. Den dekorative kobbergradienten i
   ordre-heroen er borte av samme grunn: farge brukes ikke til pynt på
   UI-elementer.

   **Fonten er fortsatt Geist alene.** DESIGN.md vil ha Satoshi til display og
   Inter til brødtekst, men regel 8 låser Ampex til én font, og prosjektets egen
   regel går foran en ekstern referanse. Skalaen er DESIGN.md sin: 11 / 14 / 16 /
   18 / 20 / 24 / 30 / 36, med vekt 500 på overskrifter — halvfet, aldri fet.

   Grunnen: montørappen legger kort på 5,5 % hvitt over brunt. På en telefon
   ser du én flate av gangen og det holder. På en bred skjerm med fire flater
   samtidig forsvinner forskjellen, og hele bildet leser som ett brunt
   rektangel. Kontoret trenger noe å legge panelene OPPÅ, så grunnen er trukket
   mørkere (`#141009`) og panelene ligger over den. Kobberet er lysnet fra
   `#A97C4F` til `#B98A5C` av samme grunn: samme kulør, hevet nok til å lese på
   en mørkere grunn enn den ble valgt for.

   Formspråket er flytende, avrundede paneler med luft rundt, stor talltypografi
   (42 px på nøkkeltall), og aksentfargen på DATA — ikke på krom. Statusfargene
   er fortsatt semantiske, og kobber er derfor ikke med blant dem.
3. **Ingen plassholderruter.** Menyen har to valg fordi det finnes to ruter.

### Funnet underveis: EAN-varer importeres ikke

`tilVarekort()` godtar EAN som nøkkel når linjeposten mangler el-nummer, men
`elnummer()`-vakten i BEGGE importene slipper bare varemerke 1 gjennom. En
EAN-vare telles derfor som «uten el-nummer» og hoppes over. Det er montørappens
oppførsel fra før, og desktop følger den bevisst — men det betyr at
EAN-fallbacken i `varekort.ts` er død kode i praksis. Skal det endres, må begge
endres, og det er en egen beslutning.

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
| `docs/DESKTOP_OG_IMPORT.md` | Ampex Kontor (`desktop/`), SpeedyCraft-import |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Skann-planen (utracket) |
| `docs/NEW_APP_PLAN.md` | Opprinnelig domene- og datamodell-plan |

---

# 21. august, sen kveld — sikkerhet, GDPR, poolene og exe-en

## Sikkerhet

**Rettighetseskalering i `profiles`, lukket.** `profiles_self_update` var
`using (id = auth.uid())` uten `with_check`. Postgres gjenbruker da
`using`-uttrykket på den nye raden, så sjekken ble «er den nye radens id min
id?» — alltid sann, uansett hva annet setningen endret. Enhver innlogget bruker
kunne kjøre `update profiles set role='owner'`, eller sette `company_id` til et
annet firma og dermed få full tilgang til et fremmed firmas data, siden hele
RLS-modellen leser den kolonnen. Det var den **eneste** policyen i basen der den
nye raden ikke var bundet til `company_id`.

Lukket med `profiles_vern()` (BEFORE UPDATE), en ekte `with_check`, og en ny
`profiles_admin_update` så eier og admin fortsatt kan endre kollegers rolle.
Verifisert ved å utgi seg for en montør i en transaksjon som rulles tilbake:
selvforfremmelse blokkert, firmabytte blokkert.

Videre: `log_audit_event` var kallbar av `anon` (hvem som helst kunne skrive i
revisjonsloggen), triggerfunksjoner lå eksponert som REST-endepunkt, og to
funksjoner manglet pinnet `search_path`. Alt i
`20260821195749_sikkerhet_profiles_og_rpc`.

**Bevisst ikke rørt:** `current_company_id()` og `kan_skrive_ik()` beholder anon
EXECUTE. De brukes inne i RLS-policyer, som evalueres med kallerens rolle;
revokering bytter et tomt svar mot en databasefeil og vinner ingenting.

**Gjenstår, og krever deg:** slå på lekkasjesjekk av passord i Supabase Auth.
Kan ikke settes via MCP.

## GDPR

Fire dokumenter, alle utkast som må leses av advokat før de brukes:

- `docs/PERSONVERN.md` — behandlingsprotokoll, underdatabehandlere, art. 32-tiltak, avviksrutine, og en ærlig liste over det som ikke er på plass
- `docs/VILKAR.md` — avtalevilkår mot firmaet
- `docs/DATABEHANDLERAVTALE.md` — art. 28, med vedlegg A og B
- `docs/PERSONVERNERKLARING_MAL.md` — mal firmaet fyller ut til sine egne kunder

Teknisk: `personinnsyn_kunde()` og `personinnsyn_ansatt()` (art. 15 og 20),
begrenset til eier/admin i eget firma, og selv logget til `audit_events` — uten
å skrive hva som ble hentet, som ville gjort loggen til en kopi av uttrekket.

Det største uavklarte er **GPS-sporingen av ansatte**: kontrolltiltak har egne
regler, og drøfting og informasjon er ikke gjort.

## GPU-pool: Firma Privat + Ampex Public

**Basen og repoet hadde divergert.** Live lå et utkast fra 14. august —
`scan_jobs` + `scan_claim_job(p_worker uuid)` — som aldri fantes i repoet.
Signaturen tok en rå uuid og ingen hemmelighet, og var kallbar av anon: hvem som
helst kunne plukket jobber ut av køen. Tabellen hadde 0 rader og ingen kode
kalte funksjonene, så den er droppet.

Repoets to migrasjoner (`gpu_bake_worker_pool`, `ampex_public_pool`) var aldri
kjørt. De er nå kjørt, med tre endringer:

1. **`allow_ampex_pool` er `default false`**, ikke `true`. Et skann er LiDAR av
   kundens bolig; at det pakkes ut på en maskin firmaet ikke eier er en
   utlevering til tredjepart. Styrt av `company_settings.ampex_pool`, håndhevet
   av trigger.
2. **`claim_scan_job` var ødelagt** — `for update` kan ikke kombineres med en
   vindusfunksjon (0A000), og rettferdighetsrangeringen trenger `row_number()`.
   Delt i to: finn id uten lås, lås den ene raden, bekreft at den fortsatt er
   `queued`. Taper man kappløpet blir det en tom runde, ikke en dobbel bake.
3. Innmelding kan aldri lage en Ampex-node. `is_public` settes kun med
   service_role.

Verifisert med sju påstander i en transaksjon som rulles tilbake: samtykkesperre,
at en Ampex-node ikke ser private jobber, at egen node tar dem, at en delt jobb
går til Ampex-poolen etter nådetid, at en fremmed node ikke kan fullføre andres
jobb, at riktig node kan, og versjonssperren (0.1.0 < 0.10.0).

## Exe-en

`worker/ampex-worker.spec` → `dist\ampex-worker\`, **326 MB** mot 4,8 GB i
venv-et. Forskjellen er nesten bare PyTorch, som ble importert kun for å lese
GPU-navnet; `ampex_worker/gpu.py` gjør det nå via `nvidia-smi`.

Ny `bake`-kommando svarer på «virker denne PC-en» uten kø eller innmelding.
Kjørt på fixture: 24 keyframes → 204k trekanter → 18,2 s → 8,5 MB GLB.

**Sperre: Smart App Control blokkerer den.** «En programkontrollpolicy har
blokkert denne filen» — den er på som standard på nye Windows 11-maskiner, og på
denne. Exe-en er altså verifisert **bygget**, ikke verifisert **kjørt**. Krever
kodesignering (OV eller EV). Å slå av Smart App Control er en enveisbryter og
ikke et alternativ.

## Vercel

Kontorappen bygger rent (1,2 MB, testbrukeren tree-shakes bort i produksjon).
`vercel.json` og `.vercelignore` er på plass. **Blokkert på innlogging** —
`npx vercel login` må kjøres av deg. Domenet `ampex.no` må deretter legges til i
prosjektet og DNS pekes dit.

---

# 22. august — skannekjeden, kontorflatene og en toolchain-blokker

## Opplastingslivsløpet

`scan_jobs` fikk et livsløp som starter FØR filene lastes opp:

```
venter (venter_paa: wifi)  →  queued  →  claimed  →  running  →  done
   ↑ jobben finnes alt her                                        ↓
   telefonen holder filene                        input_slettes_etter = +72t
```

Grunnen er ikke teknisk. Montøren skanner i en kjeller uten dekning og laster
opp når han er tilbake på wifi; opprettes jobben først ved opplasting, er
skannet usynlig for kontoret i mellomtiden. `venter_paa` sier hvorfor det
venter, så kontoret kan se «tre skann ligger på telefonen til Ola».

Bytetak i basen: 1 GiB per jobb, 100 GiB rullerende 30 dager per firma.
Rullerende, ikke kalendermåned — en kvote som nullstilles den 1. gir en topp
den 1. og en tom pool den 31. Elleve påstander kjørt mot ekte base.

`scan_job_lokalt_slettet` lar telefonen bekrefte at den har slettet sine egne
kopier, og `input_slettes_etter` rydder R2 72 timer etter en vellykket bake.
Rammene er inndata, ikke leveranse.

## scan-blobs

Den ene delen som manglet i hele kjeden. Fire grener med fire ulike
autentiseringer: `upload` og `finish` (telefon, sesjon), `download` og `output`
(worker, node-token).

**`finish` teller selv.** `scan_job_opplastet` tar imot et byte-tall, og kom det
tallet fra klienten var kvoten en høflig forespørsel — en modifisert app oppgir
1 MB og laster opp 900. Funksjonen lister objektene i R2 og sender R2 sin egen
sum inn i basen.

`output`-grenen manglet i første utkast: `api.py` kalte `upload` med en nøkkel,
og den veien krever brukersesjon. Worker-en har node-token. Resultatet navngis
dessuten av serveren, så et kompromittert node-token ikke kan skrive utenfor
sin egen jobb.

**Ikke deployet.** R2-nøklene ligger i Vercel, ikke som Supabase-secrets, og
verken supabase-CLI eller dashbordet er innlogget her.

## Kontorflatene

**Skann** under Arbeid: fire bolker, med «på telefonene» øverst fordi det er den
eneste kontoret kan gjøre noe med. «Ryddet»-kolonnen viser om rammene faktisk er
borte fra telefonen — står den tom, ligger LiDAR av kundens bolig i to
eksemplarer.

**Poolstyring** i Firma: innmeldingskode (verifisert mot ekte base) og
Ampex-bryteren.

To nye rettigheter i den delte matrisen. `pool.styr` er kun eier og
administrator — ikke installatør. Å slå på Ampex-poolen er å tillate at LiDAR av
kundens bolig pakkes ut på en maskin firmaet ikke eier; det binder firmaet
overfor kundene sine og hører ikke hos den som setter opp PC-en.

**Innloggingen** sto på `className="panel …"`, og `.panel` finnes ikke i
`styles.css`. Kortet hadde verken bakgrunn, kant eller luft — krem på krem, med
sidemenyens avatarprikk lånt som logo. Nå krom som grunnflate og papir som kort.

## Splat: blokkert på verktøykjede, ikke på kode

Testet direkte på maskinen. `gsplat` 1.5.3 installerer fint (rent Python-hjul),
men **CUDA-kjernene JIT-kompileres ved første bruk**, og det krever nvcc.

| Ledd | Status |
|---|---|
| Driver 610.88, RTX 5070 Ti | ok |
| PyTorch 2.11 + cu128, ser sm_120 | ok |
| CUDA Toolkit | **ikke installert** |
| MSVC Build Tools | **ikke installert** |
| gsplat-kjerner | **ikke kompilert** |

Feilen er stygg å finne selv: gsplat skriver «No CUDA toolkit found» én gang på
stderr ved import, fortsetter, og krasjer først midt i en bake med
`AttributeError: 'NoneType' object has no attribute 'CameraModelType'` — som
ikke nevner verktøykjeden med et ord.

`worker/tools/sjekk_gpu.py` diagnostiserer hele kjeden og sier hva som mangler.
Den tvinger UTF-8 på stdout, fordi den første versjonen krasjet med
`UnicodeEncodeError` på en cp1252-konsoll — nøyaktig feilmodusen den finnes for
å unngå på en verkstedsPC.

Det som skal til er CUDA Toolkit + MSVC Build Tools. Samme to som README-en
allerede oppga for å bygge Open3D med CUDA.

## Blokkere, alle på deg

| Blokker | Hva den stopper |
|---|---|
| `supabase login` / dashbord | R2-secrets → `scan-blobs`, og lekkasjesjekk av passord |
| CUDA Toolkit + MSVC Build Tools | all splat-trening |
| `MeshScanPresenter.swift` (din WIP) | wifi-gating, sletting etter opplasting, dybdekomprimering |
| Kodesignering | at exe-en kan kjøre forbi Smart App Control |
