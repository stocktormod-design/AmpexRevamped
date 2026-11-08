# Ampex-admin — UX-forslag (DeepSeek)

For én person (Tormod) som driver Ampex. Skjermen skal svare på **«bruker de
det?»**, ikke være et dashbord. Alt som ikke hjelper ham å se det, eller å hjelpe
en kunde inn, fjernes.

## 1. Jobbene, i rekkefølge

| # | Jobb | Hvor ofte | I dag | Forslag |
|---|---|---|---|---|
| 1 | **Bruker de det?** Se hvert firma: aktive 7 d, innhold, sist aktiv, AI | Daglig/ukentlig | 0 klikk, men 6 kolonner å skanne | 0 klikk: én «Helse»-celle per firma |
| 2 | **Hjelp noen inn** (glemt passord, mangler invitasjon) | Ukentlig | 2 klikk (Personer → knapp) | 2 klikk, med status og enhet synlig |
| 3 | **Ny kunde** (firma + eier) | Månedlig | Scroll til bunnen → 1 klikk → skjema | 1 klikk i topplinja → skjema |
| 4 | **Les tilbakemeldinger** | Ukentlig | Egen rute i menyen; tallet i tabellen er ikke klikkbart | 1 klikk fra helselinja |
| 5 | **Se kundens verden** (bytt firma) | Sjelden | 1 klikk, uten bekreftelse | 2 klikk + bekreftelse + banner |

**Må være synlig uten klikk:** alle firmaer med helse (aktiv i dag / 3 d siden /
stille 14 d / mangler eier / slettet), `3 av 5` aktive 7 d, innhold, AI på/av,
antall åpne tilbakemeldinger, og «Nytt firma». **Ikke** synlig uten klikk:
personer, enhet/bygg, selve tilbakemeldingene.

## 2. Layout, ovenfra og ned

```
Ampex                                             [ Nytt firma ]
[ Du ser Torvhaugan som kunde. Alt føres på dem.   Tilbake til Ampex ]
3 firmaer · 2 aktive siste 7 dager · 1 uten aktivitet i 14 dager · 4 åpne tilbakemeldinger
[ Søk ]   [ Alle ]  [ Trenger oppmerksomhet ]
──────────────────────────────────────────────────────────────
Firma                              Helse            AI    Handlinger
Torvhaugan Omsorgsbolig            ● Aktiv i dag    På    Personer  ⋯
123 456 789 · 4 prosjekter · …     3 av 5 aktive
──────────────────────────────────────────────────────────────
Adminbygg AS                       ● Stille 21 d    Av    Personer  ⋯
987 654 321 · 1 prosjekt · …       0 av 2 aktive
```

- **Topplinja:** tittel + én sort knapp «Nytt firma». Ingen kort, ingen
  «Oversikt»-boks.
- **Helselinja:** fire tall, ikke seks. De to siste er **klikkbare filtre**:
  «1 uten aktivitet» og «4 åpne tilbakemeldinger». «Skann» og «tegninger» er
  fjernet fra toppen — de hører til firmaet, ikke til oversikten.
- **Filtrering/søk** vises først når det er flere enn fem firmaer. «Trenger
  oppmerksomhet» = mangler eier, stille >14 d, eller åpne tilbakemeldinger.
- **Tabellen** har fire kolonner: Firma, Helse, AI, Handlinger. Ikke sju.

### Firmaraden

- **Firma:** navn (500) + orgnr/opprettet i grått. Under, i grått og smått:
  `4 prosjekter · 12 tegninger · 40 ordrer · 8 skann`. Det er svaret på «lager
  de noe?», men det er sekundært — derfor under navnet, ikke egen kolonne.
- **Helse:** prikk + tekst. `● Aktiv i dag`, `● 3 dager siden`,
  `● Ingen aktivitet på 14 dager`, `● Mangler eier`, `● Slettet`. Under:
  `3 av 5 aktive 7 d`. Prikkefargen er den eneste fargen: grønn = aktiv,
  gul = stille, rød = mangler eier/slettet. Ingen «Aktivt»-merke på normale
  firmaer — det er normen og skal være stille.
- **AI:** `På` / `Av` / `–`. Tooltip: tier og stemmeminutter. Ingen bryter her.
- **Handlinger:** `Personer` (tekstknapp) og `⋯` med **«Se som kunde»**.
  «Bytt til» forsvinner som primærknapp.

### Personene (utvidet rad)

Klikk på raden (eller «Personer») åpner personlista under firmaet:

```
Ola Nordmann · Eier                      [ Ikke tatt imot ]
ola@firma.no
Sist aktiv i går · iPhone 17 Pro · iOS 26 · bygg 1234   [ Send invitasjon ]  ⋯
```

- To kolonner, ikke fem: person (navn, rolle, e-post) og status/aktivitet/enhet.
- **Statusmerke bare når noe er galt:** `Ikke tatt imot`, `Aldri logget inn`,
  `Trukket`. En som har tilgang får **ingen** merke — det er normen.
- Enhet/bygg i grå, andre linje. Mangler den: «Ingen enhet rapportert». Ikke
  fall tilbake til invitasjonsdatoen; den hører hjemme i statusen.
- **Handling:** `Send invitasjon` (ikke bekreftet e-post) eller
  `Send innloggingslenke` (konto finnes). Samme regel som serveren; teksten
  sier hva som faktisk sendes. Ett klikk, ingen bekreftelse, kvittering med
  adressen: «Innloggingslenke sendt til ola@firma.no.»
- `⋯` per person: `Fjern fra firmaet` (bekreft med navn), `Endre rolle`
  (hvis den finnes). Ikke synlig i den vanlige raden.

## 3. Nytt firma

Topplinja → `Nytt firma` åpner et **modalpanel** (eller et smalt sidepanel),
ikke et skjema nederst i lista:

- `Firmanavn`
- `Organisasjonsnummer (valgfritt)` — serveren kontrollerer kontrollsifferet (MOD11); feil vises
  under feltet.
- `Eierens navn`
- `Eierens e-post`
- Primærknapp: **`Opprett firma og inviter eier`**. Den navngir målet i en linje
  over: «Torvhaugan Omsorgsbolig → ola@firma.no». Det er den ene
  sikkerheten som ikke koster et ekstra klikk.
- Feil fra serveren (adressen er i et annet firma, orgnr finnes) vises i
  panelet; feltene beholdes. Suksess: panelet lukkes, raden legges øverst og
  merkes svakt et sekund; kvittering «Firmaet er opprettet. Invitasjon sendt
  til …».

## 4. Hva fjernes, slås sammen, gjemmes

- **Fjern:** «Oversikt»-kortet med seks tall. Erstatt med helselinja.
- **Fjern:** Status-kolonnen og «Aktivt»-merket. Helse dekker det.
- **Fjern:** Innhold-kolonnen. Flytt til grå linje under firmanavnet.
- **Fjern:** «Folk»-knappen. Raden åpner personene; «Personer» er en
  tekstknapp for de som vil ha en eksplisitt.
- **Fjern:** «Bytt til» som primærknapp. Inn i `⋯` som «Se som kunde».
- **Fjern:** «Du er her» i raden. Erstatt med banneret øverst.
- **Fjern:** «Konto laget»-merket. Bruk «Aldri logget inn» bare når det gjelder.
- **Skjul:** enhet/bygg bak personraden (det er der i dag; ikke flytt det opp).
- **Skjul:** «Nytt firma»-skjemaet bak topplinjeknappen.
- **Behold:** AI-kolonnen (ett ord), fordi «AI på/av» er en av jobbene.

## 5. Feil og tomme tilstander

- **Feil ved henting:** behold siste data, vis en rød linje øverst:
  «Fikk ikke hentet firmaene. Sjekk nettet og prøv igjen.» + `Prøv igjen`.
  **Ikke** vis «Ingen firmaer» — en feil skal ikke se ut som en tom kundeliste.
- **Tom liste (vellykket):** «Ingen firmaer ennå. Opprett det første.» + knapp.
- **Ingen personer:** «Ingen personer i dette firmaet ennå.» + `Inviter person`
  (hvis backend får det) eller `Send invitasjon til eieren`.
- **Ingen tilbakemeldinger:** «Ingen åpne tilbakemeldinger.»
- **Henting:** behold tabellhodet og vis «Henter …» i radene; ikke blank skjerm.
- **Sendt:** grønn kvittering med adressen, ikke «Sendt!». Feil: rød linje med
  serverens tekst, og knappen blir aktiv igjen.

## 6. Risikohandlinger

| Handling | Risiko | Vakt | Vanlig sak |
|---|---|---|---|
| **Se som kunde** | Bytter firma; alt du gjør føres på kunden; kan forveksles med eget firma | `⋯` → bekreft med firmanavn → banner øverst med `Tilbake til Ampex`; revisjonslogg i begge firmaer | 2 klikk + bekreftelse |
| **Send innloggingslenke** | E-post til kunden; feil person | Ingen bekreftelse; kvittering navngir adressen; knappen låses mens den sender | 1 klikk |
| **Inviter person** | E-post til feil adresse | Skjema viser firma + adresse i knappen; servervalidering | 1 klikk + skjema |
| **Fjern fra firmaet** | Mister tilgangen; data blir igjen | `⋯` → bekreft med personens navn; myk sletting; revisjon | 3 klikk |
| **AI av/på** | Funksjon/betaling endres | Ikke i tabellen. Egen firmainnstilling med «Slå av AI for <firma>?» | 3 klikk |
| **Slett firma** | Datatap | **Ikke i UI.** Ampex-admin kan soft-slette i basen med vitende | – |
| **Nytt firma** | Feil e-post/orgnr | Knappen navngir firma + eier; serveren validerer; ingen ekstra bekreftelse | 1 klikk + skjema |

## 7. Backend-hull UX-en forutsetter

Dette er ikke UX, men det avgjør om skjermen kan holde løftet:

1. **«Inviter person» inn i et eksisterende firma** finnes ikke i
   `ampex-admin` i dag (bare «send på nytt»). `inviter-ansatte` krever at
   kalleren er i firmaet og har 2FA — en Ampex-admin er det ikke. Trengs en
   egen handling med `service_role` + revisjon.
2. **«Fjern person» / «Endre rolle»** finnes ikke.
3. **«Tilbake til Ampex»** finnes ikke: `bytt-firma` setter `company_id`, men
   ingen handling nullstiller det. Uten den blir «Se som kunde» en enveisdør.
4. **«Mangler eier»** er i dag utledet av `aktive === 0`, ikke av om det finnes
   en aktiv `owner`. Det gir feil merke på firmaer med ansatte men uten eier.
   Legg `eier` i `ampex_oversikt`.
5. **AI av/på** har ingen handling; `ai_tier` vises bare.
6. **Tilbakemeldinger per firma** trenger en lenke/filter hvis tallet skal være
   klikkbart.

## 8. Det jeg ikke vil ha

- Ingen «slett firma»-knapp i UI.
- Ingen AI-bryter i tabellen — den er for lett å treffe feil.
- Ingen bekreftelse på «send innloggingslenke»; det er den vanligste
  support-handlingen og skal være ett klikk.
- Ingen egen «Oversikt»-side. Helse + firmaer er oversikten.
- Ingen farger på ikoner eller knapper; farge bare som prikk for status.
