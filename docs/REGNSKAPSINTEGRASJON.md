# Regnskapsintegrasjon — Fiken, Tripletex, PowerOffice Go

Status 2026-08-18: undersøkt, ikke bygget. **Tripletex primært, Fiken nummer to.**

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

### Tripletex — anbefalt primært

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

### Fiken — nummer to

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

Fiken har **ingen** av `order`, `timesheet` eller `inventory`. Der måtte en
Ampex-ordre mappes rett til en faktura, og ordrebegrepet gikk tapt underveis.

To detaljer viser at modellene tenker likt: `/order/{id}/:invoice` gjør ordre til
faktura som en **eksplisitt handling**, og `/order/orderline/{id}/:pickLine` er
plukking av ordrelinjer — altså kurven vår.

Kundeprofilen peker samme vei. Fiken skjærer mot ENK og små AS og **har ingen
timeføring i det hele tatt**. Et elektrofirma med fem til femten montører trenger
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
