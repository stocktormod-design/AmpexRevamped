# Ampex Desktop og migrering fra SpeedyCraft

Status 2026-08-18: planlegging. Pool Exe er så vidt begynt på Windows-PC-en.

## Innsikten: kontor-PC-en skal gjøre tre jobber, og én installer bærer alle

Vi var på vei til å planlegge tre separate ting. De hører på samme maskin:

| Jobb | Hvorfor den må stå på kontor-PC-en |
|------|-----------------------------------|
| **Ampex Desktop** — ordresystem, admin, prisfil-import | Det er der kontorfolk sitter. Montørappen skal ikke ut på web for å laste opp en fil |
| **Pool-node** — GPU-bake | Må stå på en maskin som alltid er på. Det er kontor-PC-en |
| **SpeedyCraft-import** | **`speedycraft`-databasen ligger på denne maskinen** |

Det siste punktet er det viktige. Importverktøyet trenger ikke nettverk, ikke
åpne porter, ikke skytilgang til kundens database. Den kobler til `localhost\SPEEDYSQL`.

Og med **Windows integrated auth** kan den koble til uten passord i det hele
tatt, hvis den kjører som en Windows-bruker som alt har tilgang. Det fjerner det
jeg trodde var hovedhinderet — at kunden måtte skaffe `sa`-passordet fra Devinco.

**Konsekvens for veikartet:** ikke bygg en «admin-konsoll på web» som eget spor.
Bygg Ampex Desktop, og la konsollen, poolnoden og importen være moduler i den.
Én nedlasting for kunden, og det er samme nedlasting som allerede må skje for at
poolen skal virke.

Web-target i `app.json` kan da bli liggende urørt — den er uansett ikke
installerbar i dag (`react-native-web` og `react-dom` mangler).

---

## SpeedyCraft — hva vi vet

- Laget av **Devinco AS**
- **MSSQL**, databasenavn `speedycraft`, standardinstans `SPEEDYSQL`
- Klient-server: klientene kobler på servernavn/IP + instansnavn
- Integrerer mot Visma Contracting, Visma.net, Uni Economy, Tripletex,
  PowerOffice Go, 24SevenOffice
- **`SCImpExpCOM`** — et COM-basert integrasjonsobjekt brukt av visse
  integrasjoner (Visma Contracting, med oppdateringskonto `visma1100`)
- Dokumentert at «ferdige ordre med alt materiell, timer og dokumentasjon» kan
  overføres via integrasjonen

### To veier ut av dataene

**A. `SCImpExpCOM`** — støttet og dokumentert, og formen på dataene er kjent
(ordre + materiell + timer + dokumentasjon). Men: den er laget for løpende synk
til ERP, ikke for historisk masseuttrekk, den detaljerte dokumentasjonen ligger
bak Devincos partnerportal, og **Devinco har null interesse av å hjelpe en
konkurrent**. Verdt å sjekke om kunden alt har den aktivert.

**B. Lese `speedycraft`-basen direkte** — kunden eier maskinen og databasen. Full
lesetilgang, ingen leverandør som portvokter, ingen API-kvoter. Dette er den
realistiske veien for en engangsmigrering.

Ulempen er at skjemaet varierer mellom SpeedyCraft-versjoner. Derfor må importen
starte med et **oppdagelsessteg** mot `INFORMATION_SCHEMA.TABLES` og
`sys.columns`, som dumper det faktiske skjemaet og lar oss mappe mot det — ikke
hardkode tabellnavn vi gjettet.

Merk også at SpeedyCraft har egendefinerte felt i en XML-struktur
(`ObjectDataDefinition` / `ObjectDataResponse`). Kundespesifikke felt ligger
altså ikke som kolonner. De må parses, og de er sannsynligvis der de mest
verdifulle firmaspesifikke dataene ligger.

---

## Import kontra merge

De er ikke samme problem. **Import** har et tomt mål. **Merge** har data på
begge sider som fortsetter å divergere gjennom en parallellkjøring på uker.

### Kravet som må inn før første import

Hver importert rad beholder `source_system` og `source_id`, unike sammen, og
importen er **upsert — ikke insert**.

Firmaer kjører begge systemer parallelt mens de tør. Importen må derfor kunne
kjøres om igjen, mange ganger, uten å duplisere noe. Billig å legge inn nå,
smertefullt å ettermontere.

### Retning: én vei, alltid

SpeedyCraft → Ampex. **Aldri tilbake.** Toveis synk mellom to systemer du ikke
kontrollerer begge sider av er en myr, og det finnes ingen gevinst i den —
kunden er på vei *ut* av SpeedyCraft.

### Kundededup er den farlige delen

Samme kunde finnes ofte i begge systemer. Feil sammenslåing betyr faktura til
feil part, så dette skal aldri skje automatisk.

- Match på **organisasjonsnummer** når det finnes — det er den eneste harde
  nøkkelen
- Ellers normalisert navn + adresse som *kandidat*
- Presenter kandidatene, la et menneske bekrefte

### Ordre: skjæringspunkt per ordre, ikke per firma

- **Lukkede/fakturerte ordre** kommer inn som skrivebeskyttet arkiv
- **Åpne ordre** kommer inn som levende og blir redigerbare i Ampex — men da må
  de **fryses i SpeedyCraft**, ellers får du dobbeltarbeid og to sannheter

Det er et prosessproblem, ikke et kodeproblem, og det må sies høyt til kunden:
velg skjæringsdato per ordre, ikke slå av det gamle systemet på en gitt dato.

### Dokumentasjon: importer som arkiv, ikke som Ampex-skjema

Samsvarserklæringer og sluttkontroller ble signert i SpeedyCraft av en person
under deres autorisasjon. Å importere dem som native Ampex-skjemaer ville
fremstille det som at Ampex produserte dem.

De skal inn som **arkiverte vedlegg med original metadata** — signatar, dato,
kildesystem — og aldri som noe som ser ut som vår egen skjemamotor har fylt dem.

### Timer: skrivebeskyttet regnskap

Historiske timer er relevante for rapportering, men de er alt utbetalt. De skal
ikke kunne komme inn i lønnsløypa på nytt.

### Ikke migrer alt

Tre nivåer:

1. **Må med, ellers blir det ikke salg** — kunderegister og åpne ordre
2. **Må bevares** — ferdig dokumentasjon, fordi oppbevaringsplikten krever det
3. **Resten** — ti år med timer og materiell-linjer

Nivå 3 tas som en **full dump i R2 med søkbart arkiv**, ikke som kartlagte rader.
Det dekker både plikten og «jeg kan ikke miste dataene mine» uten at vi må
modellere et fremmed skjema i detalj. Dette er sannsynligvis den største
enkeltbesparelsen i hele migreringsplanen.

---

## Hvorfor dette er et salgsvåpen

De fleste konkurrenter gidder ikke bygge migrering, og derfor sitter firmaer fast
i systemer de hater. En ett-klikks SpeedyCraft-import er en grunn til å bytte helt
alene.

Og salgsargumentet mot SpeedyCraft er noe kunden alt kjenner: PC som server,
manuell synk, timer for å endre noe. **Når kontor-PC-en deres kræsjer, stopper
bedriften.** Ampex er offline-først med usynlig synk.

Merk ironien vi må håndtere ærlig: Ampex Desktop står også på en kontor-PC. Men
forskjellen er reell — hos oss er PC-en en *node*, ikke sannheten. Data ligger i
Supabase og på hver telefon. Dør maskinen, mister du bakekapasitet og
kontorutsikt, ikke bedriften.

---

## Blokkert

| Hva | Hvorfor |
|-----|---------|
| Skjemakartlegging | Krever en ekte `speedycraft`-base å kjøre oppdagelsessteget mot |
| `SCImpExpCOM`-vurdering | Dokumentasjonen ligger bak Devincos partnerportal (403 utenfra) |
| Valg av desktop-stack | Ikke bestemt. Pool Exe er Python i dag; Ampex Desktop trenger UI |

### Åpen beslutning: hvilken stack for Ampex Desktop

Ikke tatt. Momenter:

- **Pool Exe er Python** med Open3D. Skal desktop-appen bære den, må Python med
  — eller de skilles som to prosesser i samme installer
- **MSSQL og COM** peker mot .NET, som er det naturlige på Windows
- **React/Electron** ville gjenbrukt UI-kompetanse og komponenter fra appen, men
  må da snakke med Python og MSSQL gjennom en sidevogn
- **Tauri** er lettere enn Electron og kan kalle .NET/native, men er et nytt
  økosystem å lære

Anbefaling ved neste økt: avgjør dette **før** noe desktop-kode skrives, fordi
det bestemmer hvordan de tre modulene pakkes.
