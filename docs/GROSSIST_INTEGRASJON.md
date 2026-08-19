# Grossistintegrasjon — søk, prissammenligning og bestilling

Status per 2026-08-17. Skrevet som beslutningsgrunnlag, ikke som ferdig spec.

## Hvorfor dette er den mest salgbare funksjonen vi har

Den koster **ingen avtaler og ingen lisenser** å komme i gang med, og den kan
demonstreres med kundens egne tall i første møte:

> «Du har betalt 12 % over billigste på 40 varelinjer i år. Det er 8 400 kroner.»

Cordel/SmartCraft gjør allerede prissammenligning ved skrivebordet. Det vi kan
gjøre som de ikke gjør, er at **bestillingen komponerer seg selv**: terskelen
satte seg fra faktisk forbruk, uttaket skjedde med stemmen i sikringsskapet,
bestillingen bygde seg gjennom dagen, og den går kl. 16 om ingen stopper den.

Konkurrentene har bestilling som en skjerm du går til. Vi kan ha bestilling som
noe som allerede har skjedd.

## Datakildene — og hva de koster

| Lag | Kilde | Kostnad | Status |
|-----|-------|---------|--------|
| Hvem er varen | EFO/NELFO-prisfil fra grossisten | **0 kr** — del av kundeforholdet | Parser ferdig |
| Hva koster den for DENNE kunden | Samme fil (nettopriser) | 0 kr | Parser ferdig |
| Send bestillingen | EDI / webservice per grossist | Krever avtale | Ikke startet |

### EFObasen er IKKE nødvendig

Vurdert og forkastet for v1. Brukeravtalen koster et femsifret årsbeløp
(`kr XX 000,-` eks. mva i standardavtalen, satt individuelt), og punkt 2 sier at
innholdet ikke kan «formidles til tredjepart overhodet» uten særskilt avtale —
altså dekker standardavtalen ikke Ampex som viser data til mange bedrifter.

Prisfila fra grossisten inneholder alt vi trenger, inkludert forpakning, og har
i tillegg kundens fremforhandlede priser som EFObasen ikke har.

EFObasen blir en **oppgradering**, ikke en forutsetning: varer grossisten ikke
fører, produktbilder, rik ETIM-data, uavhengighet fra én grossist.

Går vi dit senere, finnes det to veier: kunden eier avtalen og vi signerer på
deres vilkår (EFO har allerede tenkt på programvareleverandører i punkt 2), eller
vi forhandler en egen leverandøravtale. Første vei holder oss gratis.

**Arkitekturkrav uansett:** EFObasen-data skal aldri bakes inn i app-bundlet
eller blandes i vår egen varetabell. Punkt 5 krever full sletting ved oppsigelse,
også hos underleverandører. Ligger det per tenant og er merket, er det enkelt.

## Prisfilformatet — EFO/NELFO 4.0

Implementert i `lib/pricefile/efo-nelfo.ts`. Spec: E-NVare4.0r4, rev. 2010-11-25.

- semikolonseparert tekst, variabel postlengde
- tegnsett **Windows ANSI (CP1252) / ISO 8859-1 — ikke UTF-8**
- poster skilles med CR+LF, semikolon er forbudt inne i felt
- filnavn `V4*` = varefil, `P4*` = pristilbud
- posttyper: `VH/PH` hode, `VL/PL` linje, `VX/PX` tillegg, `VA/PA` alternativer

### Fallgruven: implisitte desimaler

Flere tallfelt skriver **ikke** desimaltegn. Antall desimaler er gitt av formatet:

| Felt | Desimaler | `2050` betyr |
|------|-----------|--------------|
| `Pris` (9) | 2 | kr 20,50 |
| `Mengde` (10) | 4 | 0,205 |
| `SalgsPakning` (18) | 4 | 0,205 |

Leses `Pris` som heltall blir alt **100× for dyrt**. Parseren håndterer dette, og
respekterer samtidig et eksplisitt desimaltegn hvis grossisten skriver ett
likevel — å tolke «20.50» som 2050 kroner ville vært verre enn å avvike fra spec.

### Forpakning er det dyre feltet

`SalgsPakning` er antall prisenheter i minste bestillingsmengde. Å bestille 100
stk av noe som leveres i pakker à 10 gir enten avvist ordre eller ti pakker ingen
ba om. `rundTilPakning()` avrunder opp og returnerer pakningsstørrelsen, så
lesetilbakemeldingen kan si «5 pakker à 10 = 50 stk».

### Verifisering

```
npm run verify:pricefile
```

Fixturen i `lib/pricefile/fixture/V4_eksempel.txt` er **håndskrevet mot spec**,
lagret i ekte CP1252. Den dekker implisitte desimaler, VX/VA-tilknytning,
avviksfangst, pakningsavrunding og at æøå overlever ANSI-dekoding.

> **Neste steg når en ekte grossistfil finnes:** legg den i samme mappe og kjør
> skriptet. Avvikslisten viser umiddelbart hva vi har tolket feil. Fram til da er
> parseren korrekt mot spec, men ikke bevist mot virkeligheten.

## Prissammenligning på tvers av grossister

Fundamentet er lagt av bransjen selv:

- **El-nummer er universelt** — samme sjusifrede nummer hos Onninen, Solar og
  Ahlsell. Eksakt join-nøkkel på tvers av leverandører, gratis.
- **Alle bruker samme filformat.** N grossister = N filer = én parser.
- **Kundens betingelser ligger i kundens egne filer.** Derfor kan ingen bygge en
  generisk prissammenligning for elektro — men en per bedrift er mer verdt.

Markedet har konsolidert: Onninen (Kesko) kjøpte Elektroskandia Norge fra Rexel
i 2023. Onninen/Elektroskandia + Solar + Ahlsell dekker det meste.

### Det som faktisk er vanskelig

1. **Samme vare har flere el-nummer.** Nexans og Draka 3G2,5 er funksjonelt like
   med ulikt nummer. Eksakt match gir bare «samme vare, annen grossist».
   Ekvivalens på tvers av produsent krever ETIM-klassifisering — og er et av få
   steder en LLM gjør ekte nytte.
2. **Billigste linje er ikke billigste ordre.** Frakt, minsteordre, leveringstid.
   Det er et kurvproblem: minimer varer + frakt, med leveringstid som betingelse.
3. **Bonusstrukturer.** Norske grossister gir årsbonus på volum. Naiv «billigste
   vinner» kan tape penger. Produktet skal **vise** sammenligningen og la
   bedriften sette policy («hold på Onninen med mindre >15 % billigere»), ikke
   velge automatisk. Nevnes dette i et salgsmøte, gir det troverdighet på ti
   sekunder.
4. **Filene oppdateres i ulik takt.** Ferskhet må vises per grossist — en fersk
   fil sammenlignet mot en tre måneder gammel gir feil svar med selvtillit.

## Autobestilling

Terskel per **(vare, lokasjon)** — bilen trenger 5, sentrallageret 50. Samme
`min_qty` som gjør lagerstatus meningsfull og lar AI-en svare «har jeg det på
bilen?».

- **Terskler som setter seg selv.** Ekte null friksjon er ikke å taste inn
  terskler for 200 varer, men at appen foreslår fra forbruk: «du har brukt ca. 18
  i uka, setter terskel 25?» Forbruket ligger i `stock_movements`.
- **Utløseren er gratis.** Sjekken kjører når en lagerbevegelse skrives, altså i
  commit fra `cart.ts`. Ingen polling, ingen bakgrunnsjobb (regel 8).
- **Samling, ikke drypp.** Under terskel legger varen seg i en ventende
  bestilling som bygges gjennom dagen.
- **Opt-out, ikke opt-in.** «Bestilling til Onninen sendes 16:00 — 7 varer. Trykk
  for å endre.» Gjør han ingenting, går den. En bestilling koster penger, så det
  skal finnes et vindu å stoppe den i — men vinduet krever ingen handling.

### Ordretransport — RETTELSE 2026-08-18

> Påstanden nedenfor om at «ingen av grossistene har åpne endepunkter» er feil.
> Se `KONKURRENTANALYSE.md` og FTP-seksjonen nederst i dette dokumentet.
> Cordel har elektronisk bestilling og sanntids lagerstatus mot åtte grossister.
> Avsnittet står igjen fordi konklusjonen — bygg bestilling som internt objekt
> med utskiftbar sending — fortsatt er riktig, og nå bekreftet av Minuba.

Ingen av grossistene har åpne endepunkter. Kanalene er EDI (EDIFACT via
operatør), punch-out, eller e-post til ordrekontoret. Solar Norge markedsfører
digital integrasjon mot innkjøpssystemer. Elektroskandia har hatt webservice for
saldoforespørsel og kundenetto, men det er dokumentert på svensk side og må
verifiseres etter Onninen-fusjonen.

**Bygg bestillingen som internt objekt med utskiftbar sending.** v1-adapter er
e-post/PDF til ordrekontoret — virker i morgen, koster null, alle tar imot det.
EDI blir en annen adapter senere. Vent ikke på integrasjonen.

Merk: EDI-operatører (Logiq, Pagero) tar månedsavgift, som bryter regelen om kun
Supabase og R2 som løpende utgifter.

## Hvor oppsettet hører hjemme

Tre ting som blandes sammen:

1. **Oppsett, én gang per firma** — grossister, første prisfiler, policy.
   Admin-konsoll ved onboarding.
2. **Ferskhet, for alltid** — den som avgjør om funksjonen lever eller råtner.
   Krever den at noen husker å laste opp månedlig, er sammenligningen feil innen
   tre måneder. **Cloudflare Email Routing → Worker → parser → Supabase.** Hver
   kunde får en adresse; grossisten sender allerede fila på e-post; admin setter
   opp én videresendingsregel. Email Routing er gratis og vi er på Cloudflare alt.
3. **Daglig bruk** — terskler, uttak, bestilling, stemme. Mobil.

### Admin-konsollen skal ikke være montørappen på web

`app.json` deklarerer web-target, men `react-native-web` og `react-dom` mangler i
`package.json` — web bygger ikke i dag. Og den bør ikke fikses ved å tvinge
montørappen ut på web: den er offline-først med native moduler (LiDAR, NFC, Live
Activity, WatermelonDB med JSI), og alt må degraderes for å laste opp en fil.

Bygg en **separat admin-konsoll** med motsatte krav: online alltid, ingen native
moduler, skriver mot Supabase direkte. Rollene og RLS-en finnes fra før — `owner`
og `admin` ser konsollen, `montør` gjør ikke.

### Onboarding er ikke oppsett, det er demoen

Prisfil-opplasting er øyeblikket produktet beviser seg. Legg den først og la
belønningen komme med en gang. En onboarding som *gir* noe fremfor å kreve noe er
forskjellen på 40 % og 90 % gjennomføring.

---

# FTP-kanalen — undersøkt 2026-08-18

Dette er den viktigste korreksjonen til dokumentet. Vi planla e-post fordi vi
trodde filene måtte komme den veien. **Bransjen bruker FTP, og tilgangen er
kundens egen.**

## Hvem eier kontoen

Dette var det avgjørende spørsmålet, og svaret er godt for oss:
**prisfilene legges i kundens egen katalog på grossistens FTP-server.** Det er
ikke en systemleverandørtilgang. Det er en tilgang faren din får fordi han er
kunde, og som han kan gi til hvilket som helst system.

Elinn sier det rett ut i sin dokumentasjon: all prisoppdatering skjer ved import
av prisfiler og rabattavtaler **som du får fra grossist/leverandør**.

Det betyr at Ampex ikke trenger en avtale med Onninen for å lese prisene. Vi
trenger at kunden gir oss brukernavnet sitt.

## Feltene som kreves — identiske på tvers av alle systemene

Fire systemer, samme fem felt. Det er en de facto standard:

| Felt | Merknad |
|------|---------|
| Vert | FTP / FTPS / SFTP |
| Port | Kun nødvendig ved FTPS/SFTP |
| Brukernavn | Per kunde. **Ahlsell bruker felles brukernavn/passord for eksport** |
| Passord | Brødrene Dahl sender via **SMS** etter e-postbekreftelse |
| **Filmaske** | Ikke filnavn — et mønster. `V4*` vare, `P4*` pristilbud, **`F*` faktura (autofakt)** |

Contracting Works har i tillegg en **«Test tilkobling»-knapp** og en av/på for
automatisk import. Begge deler bør vi kopiere rett av — en FTP-konfigurasjon
uten testknapp er en supportsak i forkledning.

## `F*` er funnet vi ikke lette etter

Filmasken `F*` er **autofakt** — grossistens faktura i EFO/NELFO-format.

Det er den siste brikken i Minubas modell: innkjøpsfakturaen registreres
automatisk på riktig sak, «så ingen materialer glemmes og alt blir fakturert».
Samme kanal, samme parser, samme innlogging som prisfila.

**Parseren vår bør derfor utvides til `F*` når prisfila er bevist mot
virkeligheten.** Det er posttypene vi allerede kjenner, og gevinsten er stor:
avvik mellom bestilt og fakturert blir synlig av seg selv.

## Hvem bruker hvilken transport

| Grossist | Transport | Kilde |
|----------|-----------|-------|
| Brødrene Dahl | **SFTP via Logiq** — pakkseddel, autofakt, bestilling og prisoppdatering i én kanal | Cordel |
| Ahlsell | FTP, felles brukernavn/passord for eksport | Cordel, Tripletex |
| Onninen | FTP (prisfil bekreftet via Visma-forum) | Visma Community |
| Heidenreich | FTP | Cordel |
| Solar | EDI + OCI/punch-out | Solar |

Merk **Logiq** hos Brødrene Dahl: det er en EDI-operatør, men her betaler
*grossisten*. Kunden får bare et brukernavn. Vår regel om ingen løpende
tredjepartsavgifter brytes altså ikke av å lese fra Logiqs SFTP.

## Tripletex' modell er verdt å stjele

Tripletex Elektro/VVS oppretter grossisten automatisk som leverandør, og
grossisten sender rabattfila til **en server Tripletex kan hente fra og sende
data tilbake til**. Systemet ser etter ny fil **én gang i døgnet, om kvelden**.

To ting å ta med:

1. **Samme server begge veier.** Prisfil inn og bestilling ut over én kanal.
   Det er billigere enn to integrasjoner, og det er slik ordretransporten løses
   uten EDI-avtale.
2. **Én gang i døgnet, om kvelden.** Ingen polling-løkke. Det er nøyaktig regel 8
   i CLAUDE.md, og det er godt nok — prisfiler endres ikke oftere.

## Hva dette endrer i planen

- **Cloudflare Email Routing er fortsatt riktig som fallback**, men FTP-pull er
  primærveien. Grossistene *har* allerede en katalog til faren din.
- **Spør om tre ting i én telefon:** FTP-vert og brukernavn, om `F*`-fakturafiler
  legges i samme katalog, og om de tar imot bestilling på samme server.
- **Bygg «Test tilkobling» før automatisk import.** Uten den er første oppsett
  et gjettespill.
- **Filmaske, ikke filnavn.** Grossistene daterer filnavnene sine.
