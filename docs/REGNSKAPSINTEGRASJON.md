# Regnskapsintegrasjon — Fiken, Tripletex, PowerOffice Go

Status 2026-09-07: **Tripletex-adapteren er bygget og verifisert ende til ende i
Tripletex' sandkasse** (`lib/accounting/tripletex.ts`, `npm run verify:tripletex --fakturer`):
økt → hvem er jeg → kunde → prosjekt → varer (el-nummer) → timer på prosjekt → ordre
med produkt- og timelinjer → faktura → betaling → status «betalt». Alle synk-steg er
idempotente (kunde på org.nr/navn, prosjekt og vare på nummer). Fiken-adapteren er
skrevet, men ikke kjørt mot Fiken. Tokens ligger i `.env.local` (git-ignorert); testkontoen
utløper mars 2027. Utviklervilkårene (Visma Developer Terms) er lest: pris krever signert
addendum (2.2.9), 30 dagers oppsigelse (6.16).

Domenemapping Tripletex: Ampex-utkast = Tripletex ORDRE (ordren er utkastet; mennesket
utsteder via `fakturerOrdre`), beløp i kroner, MVA som VatType-ID slått opp fra `number`,
aktiviteter opprettes som PROJECT_GENERAL_ACTIVITY (ellers «kan ikke benyttes» på prosjekt),
`dateTo` i timesøk er eksklusiv, faktura krever org.nr + bankkonto på selskapet.

Opprinnelig vurdering (2026-08-18) under: undersøkt, ikke bygget. **Tripletex primært, Fiken nummer to.**

> Rekkefølgen ble snudd etter at ressursmodellen ble inspisert. Første vurdering
> vektet registreringsporten; den er en ventetid som kan løpe parallelt.
> Domenetilpasningen er den varige forskjellen.

## Hvorfor dette ikke er valgfritt

Et elektrofirmas ordresystem må ende i regnskapet. Ordre blir faktura, timer blir
lønn, materiell blir kostnad. Kan ikke Ampex levere inn i økonomisystemet firmaet
allerede har, kan den ikke erstatte SpeedyCraft — som integrerer mot Visma
Contracting, Visma.net, Tripletex, PowerOffice Go, Uni Economy og 24SevenOffice.

Dette er inngangsbilletten, ikke en utvidelse.

## Sammenligning

### Fiken — enklest å komme i gang med

| | |
|---|---|
| Spesifikasjon | **Offentlig og fritt tilgjengelig**: `https://api.fiken.no/api/v2/docs/swagger.yaml` (301 KB) |
| Autentisering | **OAuth2 authorization code** — kunden autoriserer Ampex mot sin egen Fiken-konto |
| Registrering | Ingen synlig portvokter i spec-en |
| Ressurser | `contacts`, `invoices`, `invoices/drafts`, `products`, `projects`, `offers`, `purchases`, `sales`, `attachments`, `accounts`, `transactions` |
| Pris for kunden | 229 kr/mnd ENK, 349 kr/mnd AS — ingen kostnad per ekstra bruker på AS |

**Den avgjørende detaljen:** Fiken har `/invoices/drafts` og
`/invoices/drafts/{draftId}/createInvoice` som førsteklasses endepunkter.

Det betyr at API-et er *bygget* for mønsteret vi allerede har valgt overalt
ellers: **Ampex lager utkastet, mennesket utsteder.** Samme linje som at AI-en
fyller kurven og montøren gjennomfører uttaket, og at AI-en aldri signerer en
samsvarserklæring.

Et ordresystem som utsteder fakturaer automatisk er et system ingen tør la styre
bedriften sin. At Fiken har gjort utkast til et eget objekt gjør den riktige
løsningen til den enkleste.

Bonus: `offers` treffer befaring-til-tilbud-flyten, og `attachments` på faktura
lar §36-dokumentasjonen følge fakturaen ut til kunden.

### Tripletex — anbefalt primært

| | |
|---|---|
| Spesifikasjon | Offentlig: `https://tripletex.no/v2/swagger.json` (1,9 MB, **490 endepunkter**) |
| Autentisering | Tre tokens: `consumerToken` + `employeeToken` → `sessionToken`, deretter Basic auth |
| Registrering | **`consumerToken` krever «API 2.0-registrering» hos Tripletex** — en reell port |
| Ressurser | Alt Fiken har, pluss `timesheet`, `inventory/stocktaking`, `documentArchive` |

Kraftigere, og `timesheet` og `inventory/stocktaking` mapper direkte mot Ampex'
timeføring og lagerbeholdning — det er en ekte gevinst senere.

Men tre tokens og en registreringsport er mer seremoni før første linje kode.
**Start registreringen parallelt**, siden den tar tid uansett, men bygg Fiken
først.

### PowerOffice Go

Ikke undersøkt. Kjent for å slippe integrasjonspartnere gjennom mer restriktivt
enn de to andre, men det er annenhåndskunnskap — må verifiseres før den
prioriteres.


## Hvorfor Tripletex, tross porten

Ressursmodellen mapper **1:1** mot Ampex' domene:

| Ressurs | Endepunkter | Hva det er hos oss |
|---|---|---|
| `/order` | 21 | Ordresystemet |
| `/project` | 40 | Prosjekter |
| `/timesheet` | 37 | `foer_timer`, `mine_timer` |
| `/product` | 30 | Varer |
| `/purchaseOrder` | 27 | Bestilling til grossist |
| `/inventory` | 11 | Beholdning, stocktaking |

Fiken har **ingen** av `order` eller `inventory`. Der må en Ampex-ordre mappes
rett til en faktura, og ordrebegrepet går tapt underveis.

To detaljer viser at modellene tenker likt: `/order/{id}/:invoice` gjør ordre til
faktura som en **eksplisitt handling**, og `/order/orderline/{id}/:pickLine` er
plukking av ordrelinjer — altså kurven vår.

> **Rettelse 2026-08-18:** påstanden om at Fiken «ikke har timeføring i det hele
> tatt» var feil. Swagger-en har `/timeEntries`, `/activities`, `/timeUsers`,
> `/projects` **og** `/timeEntries/createInvoiceDraft` med gruppering per
> aktivitet, aktivitet+person eller ingen. Timeføringen er en betalt tilleggs-
> modul (~60 kr/bruker/mnd, prosjektmodul ~60 kr til), men API-et finnes.
>
> Det som fortsatt skiller er `order` og `inventory` — dem har Fiken ikke.

Kundeprofilen peker samme vei. Fiken skjærer mot ENK og små AS. Et elektrofirma
med fem til femten montører trenger ordrebegrepet og beholdningen, ikke bare
timer inn i lønn og prosjektregnskap.

### Porten er en parallell ventetid, ikke en blokkering

- **Testmiljøet er umiddelbart.** Registrer deg på `api-test.tripletex.tech` og
  få begge tokens pluss aktiverings-e-post. Ingen godkjenning.
- **Produksjon tar 2–3 uker** via søknadsskjema. Tokens fra test virker ikke i
  produksjon.

Søk tidlig, bygg mot test imens.

---

## KRITISK: Tripletex' AI-vilkår treffer oss direkte

Utviklervilkårene (versjon 06.2026, `tripletex.no/Tripletex_Developer_Terms.pdf`)
har et eget AI-kapittel. Ampex er utvetydig omfattet.

**§2.2.13** — enhver utvikler hvis app inneholder en «AI Integration» må ha
**Tripletex' skriftlige forhåndssamtykke før produksjonstilgang**. «AI
Integration» er definert som enhver app som inneholder, styres av, eller *gir
data- eller API-tilgang til* et AI-system eller en språkmodell.

Det kommer altså **oppå** den vanlige 2–3-ukers godkjenningen, og er skjønnsmessig.
Deres egen dokumentasjon sier «should initiate the process as early as possible».
**Skriv AI-bruken inn i søknaden fra start** i stedet for å oppdage dette ved lansering.

**§2.2.10** — AI-agenten skal operere utelukkende innenfor kundens
autorisasjonsomfang, og ingen komponent må gi tilgang til Data eller API-et
videre til en **downstream agent, applikasjon eller tjeneste**.

> **Arkitektonisk følge: hold Tripletex-data ute av modellkonteksten.**
> Sender vi Tripletex-data inn i Gemini, er Google en downstream tjeneste. AI-en
> skal jobbe på Ampex' egne lokale data — som er hele poenget med offline-først —
> og `Regnskapsadapter` pusher til Tripletex som vanlig, deterministisk kode.
> Da er det ikke modellen som rører Tripletex.
>
> Dette er en lesning, ikke juridisk råd. Still spørsmålet direkte i søknaden.

Øvrige plikter verdt å kjenne:

- **§2.2.11** — oppdager de agentiske mønstre, kan de kreve skriftlig forklaring
  innen fem virkedager
- **§2.2.6** — på forespørsel må vi skriftlig egenerklære at Data ikke brukes til
  AI-trening (det gjør vi ikke, men vi må kunne svare)
- **§2.2.12** — eksponeres Tripletex noen gang via MCP: **read-only som standard**,
  skriv krever eget samtykke og transaksjonsnivå-autorisasjon fra kunden

### Pris og garantier

**Ingen utviklerpris nevnt.** Ingen minimum antall kunder, ingen inntektsdeling,
ingen sertifisering.

Men **§2.2.9** lar Tripletex etter eget skjønn pålegge tilleggsvilkår «including
**prices**, call-volumes, restrictions of certain endpoints» basert på bruken din.
Gratis å starte, men de kan prise deg senere gjennom et tillegg.

Det er en reell grunn til å ikke gjøre Tripletex til eneste vei ut — og det gjør
Fiken mer verdifull som nummer to enn ren redundans skulle tilsi: den er en vei
som ikke avhenger av skjønnsmessig AI-godkjenning fra en aktør som også kan
prise deg.

---

## Arkitektur: adapter, ikke integrasjon

Samme lærdom som for grossist-bestilling. Bygg et **`Regnskapsadapter`**-grensesnitt:

```
opprettFakturautkast(ordre)  →  utkast-ID i regnskapssystemet
synkKunde(kunde)             →  ekstern kunde-ID
hentFakturastatus(id)        →  betalt / sendt / utkast
```

Fiken er adapter nummer én. Tripletex nummer to. Appen skal ikke vite forskjell.

Uten det ender vi med Fiken-spesifikke felt spredd gjennom ordremodellen, og
adapter nummer to blir en omskriving i stedet for en fil.

## Prinsipper som gjelder uansett adapter

- **Ampex utsteder aldri en faktura.** Vi lager utkast. Mennesket trykker.
- **Regnskapssystemet eier fakturanummer og kunderegister** når det er koblet.
  Vi speiler, vi konkurrerer ikke.
- **Ekstern ID lagres på vår rad** (`source_system` / `external_id`), samme
  mønster som SpeedyCraft-importen — så en ordre kan spores til fakturaen sin.
- **Feil i integrasjonen skal aldri blokkere feltarbeid.** Offline-først betyr at
  montøren fører timer og materiell uansett; synk mot regnskap er en etterprosess
  som kan feile og prøves igjen.

## Neste steg

1. **Søk om Tripletex-produksjonstilgang i dag** — 2–3 uker venting, pluss
   skjønnsmessig AI-samtykke etter §2.2.13. Beskriv AI-bruken i søknaden.
2. Registrer deg på `api-test.tripletex.tech` og bygg `Regnskapsadapter` mot test
   — kunde-synk og fakturautkast fra en ordre er nok til demo
3. Fiken som adapter nummer to. To implementasjoner tidlig er den beste måten å
   bevise at grensesnittet holder — ellers oppdager vi først ved nummer to at
   abstraksjonen var formet etter den første
4. Verifiser PowerOffice Go-vilkårene før den vurderes

---

## Kompatibilitetssjekk mot vår datamodell (2026-08-18)

Begge spesifikasjonene ble lastet ned og sammenlignet felt for felt mot
`lib/db/schema.ts`. Dette er ikke en vurdering — det er en diff.

| | Fiken v2 | Tripletex v2 |
|---|---|---|
| Endepunkter | 111 | 490 |
| Autentisering | OAuth2 authorization code (`fiken.no/oauth/authorize`) — eller personlig token uten utløp | `consumerToken` + `employeeToken` → `sessionToken`, deretter Basic |
| Samtidighet | **Én samtidig forespørsel.** Brudd kan gi utestengelse | Ikke undersøkt |
| Har timeføring | Ja — `/timeEntries`, `/activities`, `/timeUsers` | Ja — `/timesheet` (37) |
| Har ordre | Nei (kun `orderConfirmations`) | Ja — `/order` (21) + `/orderline/{id}/:pickLine` |
| Har beholdning | Nei | Ja — `/inventory` (11), `/inventory/stocktaking` (5) |
| Har innkjøp til grossist | `/purchases` (14) | `/purchaseOrder` (27), `/goodsReceipt` |

### Fire konkrete hull i vår modell

Disse må lukkes uansett hvilken adapter som bygges først. Alle er billige nå og
dyre senere.

**1. Vi har ingen kunde-entitet.** `orders` har `customer_name`, `customer_phone`
og `address` som løse felt. Begge API-ene krever en `contact`/`customer` med
**ID** for å henge en faktura på. Uten en `customers`-tabell blir hver
fakturasynk et navneoppslag som lager duplikater i regnskapet.
→ **Dette er det største hullet.**

**2. Ingen `external_id` / `source_system`.** Prinsipp 3 lenger opp i dette
dokumentet krever det, men ingen tabell har feltene. Uten dem kan en ordre ikke
spores til fakturaen sin, og andre synk lager duplikat av alt.

**3. `time_entries` mangler aktivitet.** Vi har
`order_id, user_id, user_name, date, hours, note`.
Fiken krever `date, hours, activityId, timeUserId`; Tripletex krever også
aktivitet. **Begge** systemene modellerer timer som *aktivitet* × *person* ×
*dato*, ikke som timer på en ordre.

Dessuten deler begge notatet i to: `description` (synlig på faktura) og
`internalNote` (ikke synlig). Vår ene `note` må splittes — ellers havner
«kunden var sur» på fakturaen.

**4. `products` mangler pris og MVA.** Vi har `elnummer, name, unit`. Fiken
`product` krever `name, unitPrice, incomeAccount, vatType`. Vi kan altså lese
prisfila, men ikke skyve en vare inn i regnskapet uten å finne på tre felt.

### Ordrebegrepet: den ene reelle forskjellen

Fiken har `/timeEntries/createInvoiceDraft`, som lager fakturautkast direkte fra
timer med gruppering per aktivitet, aktivitet+person, eller én linje per føring.
Det dekker time-til-faktura helt.

Men **materiell** har ingen tilsvarende vei i Fiken. Der må Ampex selv bygge
fakturalinjene fra `order_materials` og legge dem i utkastet. Det er ikke
vanskelig — det er bare kode vi eier i stedet for et endepunkt som gjør det.

Tripletex' `/order/{id}/:invoice` gjør ordre til faktura som én eksplisitt
handling, og `pickLine` er kurven vår. Der er mappingen gratis.

**Konsekvens for adapteren:** grensesnittet må ta imot en *ordre* og selv avgjøre
hvordan den blir en faktura. Signaturen `opprettFakturautkast(ordre)` er riktig
allerede — den skjuler nøyaktig denne forskjellen.

---

## Minst friksjon for en nystartet enmannsbedrift

Spørsmålet er ikke hvilket API som er best å bygge mot. Det er hva som gir minst
motstand den dagen firmaet starter.

| | Fiken | Tripletex | Tripletex Elektro/VVS |
|---|---|---|---|
| Pris | 229 kr/mnd ENK, 349 kr/mnd AS | fra 249 kr, reelt 450–650 kr | **fra 699 kr/mnd** |
| Ekstra bruker | 0 kr ENK, 49 kr AS | Per modul | Per modul |
| Timeføring | ~60 kr/bruker/mnd | Tilleggsmodul | Inkludert |
| Prosjekt | ~60 kr/mnd | Fra Komplett (649 kr) | Inkludert |
| Grossistintegrasjon | Nei | Nei | **Ja, inkludert** |
| Ampex-tilgang | OAuth, ingen port | 2–3 uker + AI-samtykke | Samme port |

**Anbefaling: start faren din på Fiken.**

Begrunnelsen er ikke API-et — det er at Fiken er den eneste veien der Ampex kan
være koblet **fra dag én**. OAuth-autorisasjon tar to minutter i nettleseren.
Tripletex krever 2–3 ukers godkjenning pluss et skjønnsmessig AI-samtykke etter
§2.2.13, og det samtykket kan avslås. Å be en nystartet bedrift vente på at
leverandøren vår blir godkjent er den motsatte av lav friksjon.

229 kr/mnd med alt inkludert mot 699 kr/mnd er også riktig vei å ta feil: er
Fiken for lite om to år, er flytting til Tripletex en kjent og støttet vei. Er
Tripletex for mye det første året, er pengene brukt.

### Skill de to Tripletex-ene

**Tripletex som regnskap er et integrasjonsmål**, på linje med Fiken: hovedbok,
faktura, lønn — og en adapter mot det. Det er en kobling vi skal ha.

**Tripletex Elektro/VVS til 699 kr/mnd er noe annet: konkurrenten.** Fagpakken
markedsføres som «alt-i-ett for elektro» med ordre, prosjekt, timeføring,
regnskap, faktura, lønn **og grossistintegrasjon, kontrollskjemaer og
sjekklister** — og den er en **medlemsfordel hos NELFO/NHO Elektro**, altså det
faren din blir tilbudt idet han melder seg inn.

Valget er derfor ikke «Fiken eller Tripletex». Det er **hvilken hovedbok**, og
separat: om firmaet også kjøper fagpakken. Gjør de det, kjøper de noe Ampex skal
være.

Velger han Fiken, velger han samtidig bort den pakken. Det er riktig for oss,
men det må være et bevisst valg og ikke noe som skjer ved et uhell.

Ampex må derfor dekke det Fiken ikke har — ordre, beholdning, grossist — for at
Fiken skal være nok. **Det er ikke en nisje, det er hele ordresystemet.** Så
lenge det er planen uansett, er Fiken riktig partner: den gjør regnskapet, vi
gjør driften, og de to overlapper minst mulig.

Tripletex er motsatt: den gjør begge deler, og da konkurrerer vi mot verten vår.

---

## Hvem eier hva — undersøkt mot SpeedyCraft × Tripletex (20.08.2026)

SpeedyCraft er den modne norske referansen, og Tripletex dokumenterer
integrasjonen selv:

| Retning | Objekter |
|---------|----------|
| Tripletex → SpeedyCraft | ansatte, produkter, leverandører |
| SpeedyCraft → Tripletex | timer |
| **Toveis** | prosjekter, kunder |

Krever **Tripletex Komplett + logistikk basis** (eller VVS/elektro-pakken), og
kunden må ligge i SpeedyCrafts egen skyløsning. Aktiveres ved å kontakte
Devinco — ikke selvbetjent. Tripletex fraskriver seg ansvar for feil i
integrasjonen.

### Hva vi tar med, og hva vi ikke tar med

Hovedmønsteret er riktig: **regnskapet eier registrene, feltsystemet eier
arbeidet.** Det er den eneste delingen som gir én sannhet per ting.

**Men vi kopierer ikke toveis kundesynk.** To systemer som begge kan opprette en
kunde er nettopp der duplikatene oppstår, og en duplisert kunde betyr faktura
til feil part. `docs/DESKTOP_OG_IMPORT.md` sier allerede at kundededup er den
farlige delen ved import; det er samme problem, bare kontinuerlig.

Vår deling:

| Eier | Objekter |
|------|----------|
| **Regnskapet** | kunder, ansatte, aktiviteter/lønnsarter, kontoplan |
| **Ampex** | ordre, timer, materiell, dokumentasjon, tilbud, signatur |

Oppretter montøren en kunde i felt, opprettes den i regnskapet **først** og
`external_id` hentes tilbake. Uten nett lages den lokalt uten `external_id`, og
ordren kan arbeides på — men fakturagrunnlaget sier fra at den ikke kan sendes
før koblingen er gjort. Samme mønster som listepris kontra nettopris: bygg
videre, men si tydelig fra om hva som mangler.

### Friksjonen som må bort

Det som gjør SpeedyCraft-oppsettet tungt, og som vi kan gjøre bedre:

1. **Aktivering krever en telefonsamtale med leverandøren.** Fiken har OAuth —
   to minutter, selvbetjent. Det er hele grunnen til at Fiken er valgt først.
2. **Krever en bestemt Tripletex-pakke.** Vi kan ikke fjerne det kravet, men vi
   kan si det FØR kunden prøver, ikke etter.
3. **Ingen synlig tilstand.** En kunde som ikke er koblet, en time som ikke er
   overført — det skal stå på ordren, ikke oppdages i regnskapet en måned senere.
