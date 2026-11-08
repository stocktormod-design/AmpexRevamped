# «Be om avtale» — elektrikeren får grossistavtalen gjennom Ampex

Status: **design, ikke kodet.** Skrevet 2026-11-07 etter samtale med Tormod. Bygger på
`GROSSIST_INTEGRASJON.md` (prisfiler, sFTP, B4/C4) og `KRYPTERING.md` (prisfila krypteres
ved ankomst).

## Idéen i én setning

Ett trykk i Ampex sender en ferdig utfylt forespørsel til Solar, Onninen, Ahlsell, Brødrene
Dahl — én av dem eller alle samtidig — og hver forespørsel ber grossisten levere prisfila til
Ampex og ta imot bestillinger fra Ampex. Kunden får avtalen; grossisten kobler seg på oss i
samme slengen.

## Hvorfor grossistene vil komme

Grossister sier ja til kundene sine, ikke til en ny leverandør. Derfor er det **elektrikeren
som spør**, og Ampex som bærer forespørselen:

1. **Hver forespørsel er et varmt kundeemne** med orgnr, kontaktperson og volum ferdig
   utfylt, signert «sendt via Ampex». Det er gratis salg for grossisten.
2. **Det de må gjøre er lite:** sende standard V4/P4 (EFONELFO) til vår adresse og ta imot
   B4-bestillinger tilbake. Filer de allerede lager til Cordel og Tripletex. Ingen utvikling.
3. **Kundens nettopriser er kryptert med kundens egen nøkkel** (se `KRYPTERING.md`). Ampex
   kan ikke lese dem, og et innbrudd hos oss lekker ingenting. Det svarer på grossistens
   første innvending før den stilles.
4. **Tellingen blir presset.** Vi vet hvor mange firma som har bedt om hver grossist. «23
   firma spurte etter dere gjennom Ampex sist kvartal — 4 av dem fikk aldri svar» er setningen
   som får en grossist til å ta kontakt selv.
5. **Bestillingene kommer fra bilen.** Stemmeuttak og terskler bygger ordren selv; den går til
   grossisten som er koblet til. Grossisten som ikke er koblet til, får den ikke.

## Flyten for elektrikeren

**Hvor:** i oppstarten etter at firmaet er opprettet («Hvilke grossister handler du hos?»),
og senere under Meg → Firma → Grossister.

1. **Velg grossister:** Solar, Onninen (inkl. tidligere Elektroskandia), Ahlsell, Brødrene
   Dahl — eller «Alle». Hver grossist på egen rad med status (ikke spurt / sendt / svart /
   koblet til).
2. **Per grossist, ett spørsmål:** «Er dere kunde der fra før?»
   - **Ja → «Koble til»:** kundenummer (valgfritt). Forespørselen ber om V4/P4 til Ampex og
     at B4-bestillinger tas imot på kontoen.
   - **Nei → «Be om kundeavtale»:** forespørselen ber om å opprette konto og gi et pristilbud,
     og om å levere til Ampex når avtalen er på plass.
3. **Forhåndsvisning:** e-posten vises ordrett før sending. Ingenting går uten at eier/admin
   har sett hva som sendes i firmaets navn. Én «Send»-knapp sender alle.
4. **Status etterpå** på samme flate, og et varsel når grossisten svarer.

### Ferdig utfylt — elektrikeren taster nesten ingenting

| Felt | Kilde |
|---|---|
| Firmanavn, orgnr, adresse, NACE-kode | `companies` + Brønnøysundregistrene (oppslag på orgnr) |
| Registrert i Elvirksomhetsregisteret (DSB) | Oppslag hvis mulig, ellers avkryssing. Grossistene krever ofte dette for å selge til faghandel |
| Kontaktperson, telefon, e-post | Profilen til den som sender |
| Antall montører | Antall aktive profiler i firmaet |
| Omtrentlig årsvolum innkjøp | Valgfri glidebryter — ikke påkrevd |
| Nærmeste filial | Firmaets adresse → grossistens filialliste |

## Sendingen

- **E-post via Resend** (allerede i bruk i `laeretid-invitasjon` og `epost-videresend`), fra
  en Ampex-adresse, **Svar-til = elektrikeren**, kopi til elektrikeren. Grossisten svarer
  altså kunden direkte; vi ser svaret fordi det også går til
  `avtale+<forespørsel-id>@inn.ampex.no` (Cloudflare Email Routing → Worker), som oppdaterer
  status.
- **Mottakeradresser per grossist må verifiseres før første sending** — nykunde-/
  kundesenteradresse, ikke ordrekontoret. Ingen gjetting; samme regel som for produsentene i
  `GROSSIST_INTEGRASJON.md`. Ligger i en tabell, ikke i koden, så de kan rettes uten ny app.
- **Påminnelse** etter 5 virkedager uten svar: varsel til elektrikeren («Purre?» → ett trykk).
  Ingen automatisk purring i kundens navn.
- **Edge Function `be-om-avtale`** gjør selve sendingen (Resend-nøkkelen kan ikke ligge i
  appen). Appen skriver forespørselen til lokal base som alt annet; funksjonen sender ved synk.
  Offline: står som «Sendes når du har dekning».

### Datamodell

`grossist_foresporsel`: `id`, `company_id`, `grossist`, `type` (`koble_til` | `ny_avtale`),
`kundenummer`, `status` (`utkast` | `sendt` | `svart` | `koblet` | `avslatt`), `sendt_at`,
`svar_at`, `sendt_av`, `enc` (innholdet i e-posten, kryptert — se `KRYPTERING.md`).

`grossister` (felles, ikke per firma): navn, nykunde-adresse, ordreadresse, transport
(`sftp` | `ftp` | `epost`), om de er bekreftet koblet til Ampex.

## Når grossisten sier ja

1. Prisfila kommer til firmaets inn-adresse eller sFTP-mappe → krypteres ved ankomst med
   firmaets offentlige nøkkel → parses på enheten → prisene fylles inn i varekortene.
2. Status → «koblet til». Bestillingskurven får grossisten som mottaker (B4 + PDF, se
   `GROSSIST_INTEGRASJON.md` «4. oktober»).
3. Første bekreftede C4-ordrebekreftelse tilbake = grossisten er ekte koblet. Først da vises
   «Bestill direkte» uten forbehold.

## Pitchen mot grossistene — Claude + DeepSeek 2026-11-07

Tormods vinkel: grossistene må skjønne at Ampex blir en hval de ikke vil gå glipp av (stemme-AI
og LiDAR finnes ikke ellers i Norge). DeepSeeks korrektiv, som Claude er enig i: **«hval» er
historien for den ene som må selge oss inn internt; de som sier ja kjøper lavere kostnad per
ordre og nye ordrelinjer.**

**Svakheter i en ren FOMO-vinkel:**
- «Den som ikke er koblet til får ikke ordren» er en trussel; etablerte grossister svarer på
  trusler med å vente. Pitch heller *nye* ordrer — de som i dag er en telefon, en SMS eller et
  butikkbesøk.
- Spørsmålet er ikke lite: prisfiler er lett, men å ta imot B4 fra en tredjepart berører
  kundenummer, kreditt, ansvar og hvem som er selger. Det avgjøres av økonomi/IT, ikke salg.
- Den uuttalte frykten er at Ampex blir butikkvinduet og de blir plukklager. Si det rett ut: vi
  er rørledning (se under).
- «23 firma spurte etter dere» teller bare med verifisert orgnr, Elvirksomhetsregisteret og et
  volumbånd — ellers er det klikk.

**Sterkeste spaker uten volum:**
1. Ett firmas ekte tall, med lov: «Dette firmaet kjøper X kr i året, null av det kommer som
   strukturert ordre. Her er ti ekte bestillinger som B4-filer som ville gått til dere.»
2. Kostnad per ordre: el-nummer, hele pakninger, ingen manuell inntasting, færre kreditnotaer.
   Spør hva en manuell ordre koster dem.
3. 90 dagers pilot med første-vindu, ikke eksklusivitet. De sender én fil og tar imot én
   prøveordre; vi gjør integrasjonsarbeidet.
4. Riktig mottaker: digital/e-handel/integrasjon, med en regional selger som sponsor — ikke
   kategorisjefer.

**Innvendinger og svar:**

| Innvending | Svar |
|---|---|
| For små, kom tilbake senere | Ikke en nasjonal avtale — en 90-dagers pilot, én fil, én prøveordre. Vi gjør jobben |
| Vi har Cordel/SmartCraft/EDI | De priser ved skrivebordet; ordren tastes eller mailes fortsatt. Vi lager den i felt og sender strukturert B4 |
| Kan ikke ta B4 fra tredjepart / kreditt | Ordren bærer kundens kundenummer, kunden godkjenner, kreditten er deres. Vi er transport |
| Nettoprisene er konfidensielle | Leveres til kundens egen mappe, kryptert ved ankomst med kundens nøkkel. Ingen sammenstilling på tvers av kunder |
| Dere tar kunden fra oss | Vi setter ikke pris, tar ikke margin, fakturerer ikke. Dere er selger |
| Hvem rydder en feil ordre? | Navngitt kontakt, prøveordre, C4 tilbake til kunden, tydelig feilvei |

**Risiko:** aldri nevn konkurrenter («Solar er interessert») — de fire snakker sammen. Ingen
eksklusivitet og ingen provisjon per kunde fra grossisten (konkurranserett; abonnement fra
elektrikeren er renere). Aldri lov volum skriftlig. Krypteringen selges til IT/personvern, ikke
salg.

**Forutsetningen (Tormod, samme kveld):** ingen bruker appen ennå, og produktet er ikke
komplett. Rekkefølgen er produkt én bedrift bruker daglig → ekte tall → grossistpitch.
Pitchen ligger klar til steg 3.

## Ampex er rørledningen, ikke butikken

Tormod 2026-11-07: «vi er bare en pipeline». Hver grossists V4 er deres hylle i Ampex;
montøren søker på tvers av hyllene, ser sine egne priser, og bestillingen går rett til
grossisten. **Ampex tar ingen margin, setter ingen pris og fakturerer ikke.** Grossisten eier
kunden, prisen, kreditten og fakturaen. Mot grossisten sier vi «rørledning», aldri «Amazon» —
Amazon betyr for dem en som eier kunden og presser leverandøren.

## Prisene og bestillingsløkka

### Prisene: to lag

| Lag | Fil | Gjelder | Kommer |
|---|---|---|---|
| **Hylla** | **V4** — hele sortimentet til listepris | Felles, én per grossist | Månedlig |
| **Avtalen** | **P4** — firmaets nettopriser, *eller* **rabattfil** (% per rabattgruppe) | Bare dette firmaet, kryptert med firmanøkkelen | Når avtalen endres |

- **Montøren tilpasser ikke grossistprisen — grossisten gjør det.** Avtalen ligger alt i
  grossistens system; de bytter bare mottaker for fila de i dag sender Cordel/Tripletex.
- Hvert firma har egen mappe/adresse per grossist (`/solar/<firma-id>/` eller
  `solar.<firma>@inn.ampex.no`). P4 dit, krypteres ved ankomst (se `KRYPTERING.md`).
- På telefonen: varen fra hylla + nettopris fra P4, eller listepris minus rabatt for varens
  rabattgruppe. Samme el-nummer viser Solar/Onninen/Ahlsell side om side.
- Det montøren SELV setter er påslaget mot sin kunde (prosent per varegruppe eller fast
  utpris) — finnes alt (`verify:prisfil-plan`).

### Bestillingen: ett trykk, Ampex gjør resten

1. **Kurven bygger seg selv:** stemme i bilen, terskel på bil-lageret, materialliste fra skann
   eller plan (`lib/bestilling.ts` — utkastet ER handlelista).
2. **Deles per grossist** etter firmaets regel («billigst», eller «hold på Onninen med mindre
   den andre er >10 % billigere»), avrundet til hele pakninger (`rundTilPakning`).
3. **Én «Send»** — eller automatisk kl. 16, med angrevindu. Hver bestilling bærer firmaets
   **kundenummer** hos grossisten, **levering** (hent på filial / til bilen / byggeplassadressen
   fra ordren), og **Ampex-ordrenummeret som referanse** (BH felt 10, KOrdNr).
4. **Leveres rett inn i grossistens system:** B4 i grossistens (s)FTP(S)-ordremappe, innlogget
   som kunden. Ingen leser den — ordresystemet deres plukker den opp. E-post til ordrekontoret er
   bare siste utvei for grossister uten elektronisk kanal (se «Leveringen» under). Montøren
   merker ingen forskjell.
5. **Kommer tilbake av seg selv:** C4-ordrebekreftelse («bekreftet, 2 linjer restordre») på
   ordren; pakkseddel → varene inn på bil-lageret; autofakt (`F*`) med ordrenummeret som
   referanse → materiellet havner på riktig ordre og faktureres sluttkunden. Fakturerte
   grossisten mer enn bestilt, flagges det.

### B4-skriveren — bygget 2026-11-07

`lib/pricefile/b4.ts` (`skrivB4`, `validerB4`), selvtest `npm run verify:b4` (45 påstander).
Spec: E-NBestilling 4.0 rev. 2004-06-18 (EFO/NELFO; speilet hos dahl.no). Fasitpunktene:

- BH 49 felt, BL 14, BT 2, BA 3. Ingen avsluttende semikolon (som vår V4-fixtur). CR+LF.
  CP1252 (`kodAnsi`), tegn utenfor blir `?`.
- `Ant` med 2 implisitte desimaler: 12,5 m → `1250`.
- For lange **identifikatorer** (BestNr, KundeNr, VareNr ≤ 10/10/14) er FEIL — et avkuttet
  kundenummer er en bestilling til feil kunde. For lang **fritekst** kortes stille.
- `ObkrType 4` (vi ber om C4-fil tilbake), `BestOpp 3` (håndholdt) / `8` (kontoret).
- Fritekst deles i BT-poster à 30 tegn på ordgrenser. Specen fraråder mye fritekst — det gir
  manuell behandling hos grossisten.

**Ikke bevist mot virkeligheten:** ingen grossist har fått en fil fra oss. Første ekte test er en
prøvebestilling til Solar (sFTP-testkontoen), og C4-svaret er fasiten. Felt som «må avtales på
forhånd» (TransportMåte, EAN-lokasjonsnr., SLager) fylles ikke ut før en grossist har sagt hva
de vil ha. BestNr er maks 10 tegn — Ampex-id-er er UUID, så bestillingen trenger et kort
løpenummer (`nummerserier` finnes).

### Leveringen — bestemt 2026-11-07

**E-post er IKKE hovedveien.** Tormod: «de sitter ikke og leser e-post». En e-post til
ordrekontoret blir en person som taster inn ordren — tregt, feilutsatt, og ikke smart. Den
smarte veien er at fila går rett inn i grossistens ordresystem uten at noen leser den:

```
appen: purchase_order → skrivB4() → B4-fil
  → Edge Function logger inn på grossistens (S)FTP(S) SOM KUNDEN → legger fila i ordremappa
  → grossistens ordresystem plukker den opp, ingen mennesker
  → C4-ordrebekreftelse kommer tilbake i kundens mappe
  → Ampex henter C4 → «Bekreftet, 2 linjer restordre» på ordren
```

Prioritet per grossist:

1. **Grossistens egen fil-server** (FTPS/SFTP), med kundens innlogging. Samme server som
   prisfilene kommer fra — én kanal begge veier (Tripletex-modellen).
2. **Punch-out/OCI** der grossisten tilbyr det (Solar), hvis fil-kanalen ikke finnes.
3. **E-post med B4 + PDF** til ordrekontoret — siste utvei, merkes i appen som «manuell hos
   grossisten» så montøren vet at det tar lenger tid.

**Solar — det vi vet:**
- Testkonto fra Jørn Normand (`jno@solarnorge.no`, JIRA GRPIT-391640), vert `b2bs.solar.eu`.
- Det er **FTPS** — eksplisitt TLS på port 21 — ikke SFTP. Vanlig FTP avvises med 503. Bra for
  oss: krever ingen SSH-bibliotek, bare TCP + TLS.
- `touser/` er mappa filer kommer UT til kunden (V4varefil.zip lå der). Hvor ordrer skal INN er
  ukjent — sannsynligvis en `fromuser/`-mappe, ikke bekreftet.
- Jørn bekreftet 2026-09-08 at bestillinger kan legges på samme server.
- Brukernavn/passord står i e-posten fra `bit.no@solarnorge.no` 14.09 — ikke i repoet, og
  agenten skal ikke lete dem fram. Tormod legger dem i `.env.local` som `SOLAR_FTP_USER` /
  `SOLAR_FTP_PASS`.

**Åpne spørsmål til Jørn (Solar):**
1. Hvilken mappe på `b2bs.solar.eu` skal B4-bestillinger legges i?
2. Kan vi sende en prøvebestilling som behandles uten at noe leveres, og få C4 tilbake?
3. Leser ordresystemet deres alle felt vi fyller ut, eller bare et utvalg (kundenr, varer,
   antall)? Særlig leveringsadresse og KOrdNr (vår ordrereferanse).
4. Kommer C4 tilbake i `touser/`, og med hvilket filnavnmønster?

**Teknisk usikkerhet:** at Supabase Edge Functions kan åpne utgående TCP på port 21 og de
passive dataportene FTPS bruker. Testes mot en offentlig FTPS-testserver før Solar.

### Hva som venter på hvem

| Venter på | Hva |
|---|---|
| **Tormod** | Solar-innloggingen i `.env.local` (`SOLAR_FTP_USER`, `SOLAR_FTP_PASS`) |
| **Tormod** | Spørsmålene over til Jørn, i den eksisterende tråden |
| **Agent** (kan startes nå) | FTPS-sender som Edge Function, testet mot offentlig testserver |
| **Agent** (kan startes nå) | C4-leser mot spec (E-NOrdrebekr 4.0, hos dahl.no) med selvtest |
| **Agent** (kan startes nå) | Kort bestillingsnummer (≤ 10 tegn) — se under |
| **Agent**, etter innloggingen | Logge inn på Solar, liste mappene, finne ordremappa |
| **Agent**, etter Jørns svar | Første prøvebestilling, C4 tilbake = beviset |

**Bestillingsnummeret:** B4 tillater maks 10 tegn, Ampex-id-er er UUID. To veier:
(a) ny serie `bestilling` i `nummerserier` + kolonne på `purchase_orders` — krever migrasjon og
WatermelonDB-skjemabump; (b) avledet av id-en uten migrasjon, f.eks. `A` + 8 første tegn
(`A3F9C21B`) — lesbart i telefonen, kollisjon per firma praktisk talt umulig. **(b) først**, (a)
hvis grossistene vil ha løpende tall.

### Mangler

- inn-mappe/adresse per firma og grossist (prisfiler inn)
- rabattfil-parser (E-NRabatt 4.0) for grossister som sender det i stedet for P4
- `lib/bestilling-send.ts`: purchase_order → B4 → FTPS/SFTP (e-post bare som siste utvei)
- per firma og grossist: lagre kundens innlogging til grossistens server — kryptert, aldri i
  klartekst i databasen (Supabase Vault nå, firmanøkkel når `KRYPTERING.md` er bygget)
- C4-, pakkseddel- og autofakt-leser (specene for C4 og faktura 4.0 ligger hos dahl.no)
- «Send»-knapp på handlelista (`components/efobasen-panel.tsx`, lista grupperer alt per
  grossist — én bestilling per gruppe), og innstillinger for kundenummer per grossist
- fordelingsregelen og 16:00-sendingen

## Senere, ikke nå

- **Grossistside:** en enkel side der en grossist ser antall forespørsler mot seg og kan svare
  «vi tar imot Ampex-kunder» én gang for alle. Bygges når tallene finnes.
- **Velkomsttilbud** fra grossisten til nye Ampex-kunder, eller henvisningsprovisjon. Krever
  avtale og et blikk på konkurranseregler før vi tar betalt av grossisten for kunder.

## Rekkefølge

1. Verifiser mottakeradressene til de fire grossistene (telefon/e-post, ikke gjett).
2. Tabellene + Edge Function `be-om-avtale` + e-postmal. Test ved å sende til oss selv.
3. Flaten i appen (Meg → Firma → Grossister) og i oppstarten.
4. Inn-adressen for svar og prisfiler (Cloudflare Email Routing → Worker), med kryptering
   ved ankomst når `KRYPTERING.md` steg 1 er på plass.
5. Første ekte sending: Aqila eller farens firma mot Solar (sFTP er allerede bekreftet der).
