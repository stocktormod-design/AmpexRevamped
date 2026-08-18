# Regnskapsintegrasjon — Fiken, Tripletex, PowerOffice Go

Status 2026-08-18: undersøkt, ikke bygget. **Fiken først.**

## Hvorfor dette ikke er valgfritt

Et elektrofirmas ordresystem må ende i regnskapet. Ordre blir faktura, timer blir
lønn, materiell blir kostnad. Kan ikke Ampex levere inn i økonomisystemet firmaet
allerede har, kan den ikke erstatte SpeedyCraft — som integrerer mot Visma
Contracting, Visma.net, Tripletex, PowerOffice Go, Uni Economy og 24SevenOffice.

Dette er inngangsbilletten, ikke en utvidelse.

## Sammenligning

### Fiken — anbefalt først

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

### Tripletex — nummer to

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

1. Registrer en OAuth2-klient hos Fiken og få et testselskap
2. Bygg `Regnskapsadapter` med Fiken som første implementasjon —
   kunde-synk og fakturautkast fra en ordre er nok til demo
3. Start Tripletex' API 2.0-registrering parallelt, siden ventetiden er dødtid
4. Verifiser PowerOffice Go-vilkårene før den vurderes
