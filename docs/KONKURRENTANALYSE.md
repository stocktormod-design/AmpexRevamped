# Konkurrentanalyse — hva andre ordresystem faktisk har

Undersøkt 2026-08-18. Kildene er leverandørenes egne hjelpesider og prislister,
ikke anmeldelser. Alt her er **skrivebordsundersøkelse** — ingenting er prøvd i
et faktisk system.

Kort konklusjon: **grossistintegrasjon er ikke uløst mark, det er inngangsbilletten.**
Vi har antatt at ordretransport var vanskelig fordi den var uløst. Den er i
virkeligheten løst av alle de etablerte, på en enklere måte enn vi trodde. Det
flytter differensieringen vår vekk fra prisfila og over på to andre ting.

---

## 1. Grossistintegrasjonen er moden — vi tok feil

`GROSSIST_INTEGRASJON.md` sier «Ingen av grossistene har åpne endepunkter».
Det stemmer ikke som generell påstand.

### Cordel gjør allerede alle tre lagene

| Lag | Hva Cordel har | Kilde |
|-----|----------------|-------|
| Prisfil | Automatisk henting over **FTP** fra Brødrene Dahl, Ahlsell, Heidenreich, Onninen. Format velges i nedtrekk: «Efo/Nelfo 4.0» | Cordel kundesider |
| Lagerstatus | Sanntidsspørring mot **åtte** grossister: Ahlsell, Heidenreich, Otra, Solar, Elektroskandia, Berggård Amundsen, Onninen, Høiax | Cordel kundesider |
| Bestilling | Elektronisk bestilling med leveringsadresse, direktebestilling, og **automatisk bestilling til lager** | Cordel kundesider |

Noen grossister har åpen spørring, andre krever at du tar kontakt for tilgang.
Heidenreich er dokumentert eksplisitt: konfigureres ved å skrive «Heidenreich» i
formatfeltet, ingen nøkkel — men de viser *om* varen finnes, ikke antall.

**Det betyr at endepunktene finnes og delvis er åpne.** Telefonen til grossisten
står fortsatt på lista, men spørsmålet er ikke lenger «går det an», det er
«hvilken av de fire kanalene får vi».

### Minuba (DK) viser at v1 kan være banal

Minuba har 80+ grossister. Mekanismen er ikke EDI:

1. Du huker av «Aktiver online modtagelse af indkøbsfakturaer»
2. Du sender en **e-postmal** til grossisten
3. Grossisten legger ordrebekreftelse, pakkseddel og faktura på en **FTP-server**
4. Minuba poller FTP-en. Inntil 20 minutters forsinkelse fra bestilling til
   materiellet vises på arbeidsordren

Systemet håndterer avvik mellom ordrebekreftelse og faktura, og overfører
materiell til ordren når status blir «Levert».

**Dette er nøyaktig e-post/PDF-adapteren vi planla, bare med FTP på returveien.**
Planen om å bygge bestilling som internt objekt med utskiftbar sending er
bekreftet riktig av en moden konkurrent. Ikke bygg EDI.

### Solar og Onninen

- **Solar Norge**: EDI og **OCI/punch-out** (Open Catalog Interface), satt opp
  i dialog per kunde for å få riktige betingelser på transaksjonene.
- **Onninen**: e-handelssiden bekrefter elektroniske prisfiler, elektronisk
  pakkseddel via QR på kolliene, og nettbasert retur/reklamasjon. **Ingenting
  offentlig om EDI/API** — dette må ringes inn, som antatt.

---

## 2. Prisfil-import er bordet, ikke maten

Alle har det:

| System | Prisfil | Merknad |
|--------|---------|---------|
| Cordel | FTP-auto, EFO/Nelfo 4.0 | Med valg av **prissett 1–4** |
| EG JobOffice | Last opp prisliste, bestill elektronisk | Prisbok på mobil — **kun Android** |
| Minuba | Rabattfiler per grossist | «se din reelle kostpris på en sag» |
| ELinn | Materiell + automatisk FDV | Skyen, Inprog AS |
| Handyman | Materiellstyring, skanner, lager online | 45 000 brukere |

**Cordels «prissett 1–4» er verdt å merke seg.** Det er ikke et felt i fila — det
er hvilken av Cordels fire priskolonner grossisten lander i. Cordel lagrer altså
flere grossisters pris per el-nummer side om side. Det er prissammenligningens
datamodell, og den er ti år gammel hos dem. Vår parser er riktig som den er
(`prisType` B/N + `nettoPris`), men datamodellen på mottakersiden må ha samme
form: pris per (el-nummer, grossist, dato).

### Retningen internasjonalt: fil → live API

**Luckins** (Trimble) er UK-ekvivalenten til EFObasen: 1,5 millioner varer fra
800+ produsenter, brukt av **86 % av britiske grossistfilialer**, nå med
ETIM-klassifisering. Integrasjonen mot simPRO beskrives eksplisitt som
«rather than a static price file… a live API which means that it is always
up-to-date».

Ferskhetsproblemet vi identifiserte er altså det bransjen har brukt femti år på
å løse, og svaret deres er å slutte med filer. Vår Cloudflare Email
Routing-plan er en gyldig v1, men **spør om FTP-tilgang i samme telefonsamtale
som ordrekanalen** — det er det grossistene faktisk tilbyr i dag.

---

## 3. EFObasen-prisen er ikke lenger ukjent

`STATUS.md` sier prisen er redigert bort som «kr XX 000,-». EFOs egen prisliste
er offentlig:

| Post | Pris eks. mva |
|------|---------------|
| **API, årlig grunnpris** | **29 412 kr** |
| Etablering ny leverandørbedrift | 6 000 kr |
| Serviceavgift medlem, 0–9 MNOK omsetning (fra 01.01.2026) | 17 283 kr/år |
| El-nummer, 0–50 (minimum) | 3 825 kr medlem / 7 651 kr kunde |

29 412 kr/år er API-grunnprisen, ikke nødvendigvis totalen for en
programvareleverandør som viser data til mange bedrifter — punkt 2 i
brukeravtalen gjelder fortsatt. Men størrelsesordenen er nå kjent, og
**beslutningen om å droppe EFObasen for v1 står seg**: 30 000 kr/år før første
kunde bryter regelen om kun Supabase og R2 som løpende utgifter.

Merk at **Gripr har EFObasen-integrasjon** og selger den som per-integrasjon-
lisens per måned. Det er modellen som gjør 30 000 kr/år bærbart: la kunden eie
avtalen, ta betalt for koblingen.

---

## 4. Bilbeholdning med autopåfyll finnes — men grossisten eier den

Dette er den viktigste korreksjonen til `STATUS.md` punkt 2 («materiell og lager
har **ingen** verktøy»). Det stemmer for de norske fagsystemene. Det stemmer ikke
for markedet.

- **Ahlsell Partner**: sett opp servicebilen som et lager, uttak registreres med
  **strekkode**, **automatiske digitale påfyllingsordrer** «sørger for at du
  aldri går tom». Mobilapp + webportal. Varetelling på minutter.
- **Onninen**: tokassesystem (kanban) i bil og på byggeplass, med bemannet
  påfylling, telling og kontroll.
- **ServiceTitan** (US): materiell forbrukt på fakturaen oppdaterer
  bilbeholdningen automatisk og fyller «Truck Replenishment».
- **simPRO** (RAIN, 7. juli 2026): Field Inventory Control — mobil beholdning
  med varetelling i bilen.

**Vår autobestillingsidé er altså ikke ny. Men den er ny som nøytral.** Ahlsells
autopåfyll fyller på fra Ahlsell. Onninens kasser er Onninens kasser. Ingen av
dem kan si «Solar er 14 % billigere på denne, bestill der i stedet» — det er
strukturelt umulig for dem å bygge.

Det er den skarpeste posisjoneringen vi har funnet:

> Grossistens lagerstyring er gratis fordi den er en lås.
> Vår er den samme funksjonen uten låsen.

**Datamodellen som gjør det mulig ligger nå på plass** (`product_prices`,
19.08.2026). Varekortet viser prisen fra hver grossist side om side med
«BILLIGST» på den laveste, og materiellvelgeren sier «Solar er 2,50 billigere»
i det varen legges på ordren — som er der valget faktisk tas.

---

## 5. AI: vinduet er i ferd med å lukkes globalt, men er åpent i Norge

**simPRO Lightning / Cooper — lansert 13. mai 2026.** Fire agenter:

| Agent | Hva den gjør |
|-------|--------------|
| JobReady | Brief før utrykning: historikk, kunde, sted, deler |
| **JobScribe** | **Talemelding → strukturert jobbdokumentasjon** |
| JobBrief | Kundesammendrag etter jobb |
| FieldReady | Opplæring av nye teknikere |

RAIN (7. juli 2026) la til AI-planlegger og Field Inventory Control.

**ServiceTitan** har AI-stemmeagenter, men kundevendt — de tar telefonen fra
kunder, de hjelper ikke montøren.

**I Norge** fant jeg bare *Jobbkontroll* (Wollum) med «AI-støttet timeregistrering
som halverer tiden», offline og med hansker. Gripr har EFObasen og Boligmappa,
men ingen stemme. SmartCraft Spark har ingen AI-funksjoner beskrevet.

### Hva dette betyr for oss

**Stemme → tekst er ikke lenger en differensiator.** JobScribe gjør det, og det
er fire måneder gammelt. Det uinntatte er **stemme → transaksjon**: at uttaket
faktisk skriver `stock_movements`, at bestillingen faktisk bygger seg, at kurven
faktisk fylles. JobScribe produserer et dokument. Ingen av dem lar montøren
*gjøre* noe med stemmen.

Det bekrefter rekkefølgen i `STATUS.md` punkt 2 — `legg_til_materiell` og
`ta_ut_materiell` er riktig neste steg — men hever prioriteten. Det er selve
skillet mot simPRO, ikke en utfylling av et hull.

---

## 6. Den nærmeste trusselen mot LiDAR-sporet: SmartCraft Spark

SmartCraft har lansert **Spark**, gratis app for elektrikere:

> last opp plantegning, marker opp rom og plasser utstyr der det skal være — og
> mens du jobber visuelt, bygges tilbudet automatisk i bakgrunnen

Det er «tegning → tilbud», som er nøyaktig gevinsten vi begrunnet LiDAR med i
`STATUS.md` («tegning fra skann, måling uten målebånd — krever mindre presisjon
og treffer større marked»).

Forskjellen er inngangen: Spark krever at det *finnes* en plantegning. Vår
krever at det finnes et rom. På rehab og småjobber — der plantegningen er borte
eller aldri fantes — er vår inngang den eneste som virker. På nybygg har Spark
allerede vunnet, og gratis.

Det snevrer inn hva LiDAR skal selges som, og det er en innsnevring i vår favør.

---

## 7. Markedsstrukturen: ingen eier hele stacken

Visma Contracting / Contracting Works / Contracting NXT integrerer **SpeedyCraft,
Handyman, NELFO Ressurs og ELinn** som mobile frontender. Handyman har 50+
integrasjoner, åpent API og 45 000 brukere.

Normalen i Norge er altså **ett kontorsystem + en mobil frontend du velger selv**.
Det er gode nyheter: Ampex trenger ikke erstatte regnskapet for å komme inn, og
det er nøyaktig det `REGNSKAPSINTEGRASJON.md` allerede har lagt opp til.

---

## 8. Prisbildet — et titalls ganger spenn

| System | Pris |
|--------|------|
| Cordel | **1 290 – 2 499 kr per bruker/mnd** + tilleggsmoduler |
| Ordrestyring | 14 995 kr etablering |
| **Gripr** | Gratis (1 bruker) / **499 kr per selskap + 249 kr per bruker/mnd** |
| Gripr, årlig | 399 + 199 kr/mnd |
| Gripr, tillegg | Timeliste 10 kr/bruker/mnd, e-signering 9 kr/dok, SMS 0,36 kr |

Griprs modell er verdt å studere: **gratis inngang, fast pris per integrasjon per
måned uavhengig av antall brukere, ingen bindingstid, og integrasjoner kan prøves
før de aktiveres.** Det er en prismodell som passer nøyaktig på grossist- og
regnskapskoblingene våre, og den løser hvordan en 30 000-kroners EFObasen-avtale
kan bæres senere.

Cordel på 1 290–2 499 kr per bruker er der pengene er, men også der forventningen
om komplett kalkyle, prosjekt og FDV bor.

---

## Sikkert / usikkert

### Sikkert (lest på leverandørens egen side)
- Cordel har lagerstatusspørring mot åtte navngitte grossister, FTP-prisfiler fra
  fire, og elektronisk bestilling inkludert automatisk bestilling til lager.
- Minuba aktiveres med e-postmal + FTP-polling, inntil 20 min forsinkelse.
- Solar tilbyr EDI og OCI/punch-out.
- EFObasen API: 29 412 kr/år eks. mva. El-nummer-etablering 6 000 kr.
- Ahlsell Partner: bil som lager, strekkodeuttak, automatiske påfyllingsordrer.
- simPRO Cooper/Lightning 13.05.2026 med JobScribe (tale → dokumentasjon);
  RAIN 07.07.2026 med Field Inventory Control.
- SmartCraft Spark: plantegning → visuell oppmerking → automatisk tilbud, gratis app.
- Gripr og Cordels priser som gjengitt over.
- Heidenreich viser tilgjengelighet, ikke antall, i Cordel.

### Usikkert (ikke verifisert)
- **Om Onninen har API/EDI i det hele tatt.** E-handelssiden nevner det ikke.
  Cordels lagerspørring mot Onninen antyder at noe finnes, men ikke hva.
- **Hvilke av de åtte grossistene som har «åpen» spørring** og hvilke som krever
  avtale. Cordel sier begge deler finnes, ikke hvem som er hvem.
- **Om FTP-veien er tilgjengelig for tredjeparter** eller kun for etablerte
  systemleverandører med avtale. Dette er det viktigste å avklare i telefonen.
- **Om EFObasens API-pris på 29 412 kr dekker vår bruk.** Punkt 2 i avtalen
  forbyr videreformidling; API-prisen er trolig for én bedrifts eget bruk.
- **Om simPRO/ServiceTitan er relevante i Norge overhodet.** Ingen indikasjon på
  norsk lokalisering eller EFO/NELFO-støtte funnet.
- **Om Jobbkontrolls «AI-timeregistrering» er stemme** eller bare mønstergjetting.
  Beskrivelsen er markedsføringstekst.
- **Cordels faktiske pris.** 1 290–2 499 kr kommer fra en tredjeparts
  sammenligningsside (drifti.no), ikke fra Cordel.
- **Om noen norsk aktør har stemme på vei** som ikke er annonsert.

---

## Hva dette bør endre i planen

1. **Ring grossisten om FTP, ikke bare om ordre.** Både prisfil-ferskhet og
   ordrebekreftelse/faktura-retur går over FTP hos de etablerte. Én samtale,
   tre svar.
2. **Ikke bygg EDI. Noensinne, sannsynligvis.** Minuba har 80+ grossister på
   e-post ut og FTP inn.
3. **Prioriter `ta_ut_materiell` opp.** Stemme → transaksjon er det eneste vi
   fant som ingen har. Stemme → dokumentasjon er tatt.
4. ~~**Datamodellen for pris må være (el-nummer, grossist, dato)** fra første
   migrasjon — Cordels prissett 1–4 er den formen, og den er dyr å legge til
   etterpå.~~ **GJORT 19.08.2026** (`product_prices`, skjema v26). Den var IKKE
   fulgt: prisen lå som én kolonne på varen, og neste grossists fil overskrev
   den forrige. Rettet før første ekte prisfil, altså mens den fortsatt var
   billig. Samme runde reddet varekortdataene (fabrikat, EAN, bilde, FDV, HMS)
   som `VX`/`VA`-postene inneholdt og importen kastet — se `docs/STATUS.md`.
5. **Selg nøytralitet, ikke autobestilling.** Ahlsell gir bort autobestilling.
   Ingen kan gi bort «bestill hos den billigste».
6. **LiDAR skal selges på rehab**, der plantegningen ikke finnes. Spark eier
   nybygg fra i år.
7. **Vurder Griprs prismodell**: gratis kjerne, betalt per integrasjon per måned.
   Den bærer grossist- og regnskapskoblingene og senere EFObasen.
