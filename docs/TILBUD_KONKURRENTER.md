# Tilbud — hva konkurrentene har, og hva vi tar

Skrevet 2026-09-18, etter at Tormod påpekte at tilbudsflaten «ser ut som en
generisk Ampex-skjerm» og at Cordel-materialet vi skulle kopiere aldri ble
skrevet ned. Dette dokumentet er for at det ikke skal skje igjen: alt under er
lest på leverandørenes egne sider samme dag, med lenker.

## Konklusjonen først

**Formen er viktigere enn funksjonslista.** Cordels tilbud er et regneark med
tastatur: Tab mellom cellene, Enter lagrer, Escape angrer, og «Blokk» merker
mange linjer for én operasjon. Vår var en liste med opp/ned-piler per rad.

**Vi lå på Gripr-nivå, ikke Cordel-nivå.** Gripr (tilbud på fem minutter,
vedlegg, e-post, digital aksept, status) er nesten nøyaktig vår funksjonsliste.
Vi hadde fire av tolv prisfaktorer Cordel har.

**Kalkulasjonen bor på kontoret.** Tastaturnavigasjon og blokkmerking finnes
ikke på en telefon. Appen viser den ferdige oppdelingen og lar montøren slå
tilvalg av og på sammen med kunden.

## Det vi tar, fra hvem

| Vi tar | Fra | Hvorfor akkurat dem |
|---|---|---|
| **Tilvalg** — linjer kunden velger om skal med, med sum som oppdaterer seg | Jobber («optional line items») | Den klareste kundeflaten av alle: «Optional» / «Not included» i beløpskolonnen, kunden krysser av, totalen følger. Forhåndsvalgt = anbefalt. |
| **Regnearket** — Tab/Enter/piler, redigering rett i cella, Enter på siste rad lager ny linje | Cordel («Funksjoner i spesifikasjon») | Den eneste norske som behandler kalkulasjonen som et verktøy, ikke et skjema |
| **Blokk** — merk mange linjer, så flytt/slett/lås/påslag på alle | Cordel («Blokk») | Et tilbud på hundre linjer redigeres i grupper, ikke én og én |
| **Låst pris** — linja rører ikke på seg når påslaget oppdateres | Cordel («Lås priser», «Avtalt/fast pris» på pakke) | Forutsetningen for at bulk-påslag ikke ødelegger en avtalt pris |
| **Standard påslag på tilbudet** + «oppdater alle» | Cordel (kalkulasjonsmetode «selvkost + påslag»), Fergus («change markups as needed») | Slik det tastes i faget: kost inn, påslag på, pris ut |
| **Vis/skjul kost og påslag** | Fergus («show/hide markups and cost price») | Kolonnene er interne; den som kalkulerer vil se dem, den som bare leser vil ikke |
| **Varesøk rett i kalkulasjonen** — el-nummer eller navn, Enter legger til | Cordel (prisbok), Minuba | Uten dette tastes hver linje for hånd; kalkyle uten katalog er et regneark |
| **Skaffevare** — fritekst som blir en egen linje | Cordel («skaffevarer ikke i prisboka») | Ikke alt finnes i katalogen |
| **Pakker** — «lagre som pakke» fra merkede linjer, sett inn × antall | Cordel («Pakker»), simPRO («pre-builds»), Tradify («kits»), Fergus («favourites») | Det som sparer tid: en dobbel stikkontakt er kabel, boks, ramme og tid |

### Bevisst IKKE tatt (ennå)

- **Akkord** (Cordel «mindre anbud m/akkord»): montasjepriser × akkordmultiplikator
  (2,482 fra mai 2022). Tariffen er en fri PDF fra NHO Elektro — ingen avtale
  som EFObasen (29 412 kr/år). Det er den dypeste vollgraven og det som gjør
  det til et *elektriker*-tilbud, men det krever at tariffens poster ligger i
  basen. Eget løp.
- **Prissett 1–4** (Cordel): hvilken av fire priskolonner grossisten lander i.
  Vi har kost og salgspris; flere prissett kommer med grossistintegrasjonen.
- **Good/Better/Best** (ServiceTitan): tre hele løsninger side om side. Tilvalg
  per linje dekker 80 % av behovet; hele alternativer er en større modell.
- **Kundeportal** der kunden selv krysser av tilvalg og signerer (Jobber
  «client hub», Fergus, Gripr). Vi har ingen offentlig kundeflate ennå — i dag
  krysser montøren av sammen med kunden, og dokumentet viser tilvalgene.
- **Cordels tastaturmerking** (shift + pil for blokk). Vi merker med avkryssing
  og shift-klikk for område; shift + pil krever en «ikke-redigerende» fokusmodus
  vi ikke har bygget.

## Konkurrentene, én og én

### Cordel — det tunge norske verktøyet

- Spesifikasjonen redigeres som regneark: **Tab** mellom celler, **Enter**
  lagrer, **Escape** ut av redigeringsmodus. «Blokk»: shift + pil merker
  linjer; så Flytt, Kopier, Slett, Seksjon, Juster, Oppdater, Lås priser.
- **Tre kalkulasjonsmetoder** velges per tilbud: salgspris − rabatt,
  selvkost + påslag, mindre anbud m/akkord.
- **Prissett**: listepris, kostpris, salgspris (+ prissett 1–4 per grossist).
- **Pakker**: «et sett av varer, timer, akkorder og lignende som er nødvendig
  for å fullføre en mindre oppgave». Pakken regnes om mot tilbudets parametre
  (kundeavtale, tariffpåslag) når den hentes inn; «Avtalt/fast pris» låser.
- **Lås priser** på hele eller deler av tilbudet; oppdater påslag på resten.
- **Ikke summér**: alternativer som vises uten å telle i summen.
- **Skaffevarer og rundsum**: linjer utenfor prisboka.
- Pris: fra 1 330 kr per *kontor*bruker/mnd; feltappen gratis, ubegrenset.

Kilder: [Funksjoner i spesifikasjon](https://kundesider.cordel.no/hc/no/articles/20870798900241-Funksjoner-i-spesifikasjon),
[Kalkulasjonsmetoder](https://kundesider.cordel.no/hc/no/articles/21880356774289-Kalkulasjonsmetoder),
[Pakker](https://kundesider.cordel.no/hc/no/articles/21762456277265-Pakker),
[Skaffevarer/rundsum](https://kundesider.cordel.no/hc/no/articles/4853913901329-Hvordan-legge-inn-skaffevarer-ikke-i-prisboka-eller-rundsum-i-spesifikasjonen).
Zendesk-sidene svarer 403 på direktehenting; innholdet er lest via søk.

### Jobber — den beste kundeflaten for tilvalg

- «Mark as optional» på linja. Forhåndsvalgt = anbefaling; kunden kan fjerne.
- Kunden ser tilbudet i «client hub», krysser av og på, **totalen oppdaterer
  seg** mens hun velger. Beløpskolonnen sier «Optional» (valgt) eller
  «Not included» (grået ut, ikke i summen).
- Prosentbasert depositum følger de valgte linjene.
- «Preview as Client» for den som lager tilbudet.
- Ved godkjenning blir valgte tilvalg vanlige linjer; fravalgte forsvinner.
- Inntil 30 tilbudsmaler med ferdige linjer og vilkår.

Kilde: [Optional Line Items on Quotes](https://help.getjobber.com/en/articles/optional-line-items-on-quotes/).

### ServiceTitan — Good/Better/Best

- Teknikeren bygger forslaget på nettbrett med **flere hele alternativer**
  (good/better/best) fra en «pricebook» med bilder og forklarings-PDF-er.
- Kunden velger ett alternativ og signerer; det blir faktura.
- Poenget er høyere snittordre gjennom valg, ikke lavere pris.

Kilde: [Electrical Proposal Software](https://www.servicetitan.com/industries/electrical-software/proposals).

### simPRO — pre-builds og seksjoner

- «Parts & Labour»-fanen: take-off-maler, **pre-builds** (pakkede jobber, enten
  T&M-mal eller fastpris), katalogvarer og timesatser.
- Seksjoner og «cost centres» — samme rolle som våre områder.
- Påslag settes på katalognivå; endrer leverandøren pris, regnes alle
  pre-builds om automatisk. Salg = estimat + påslag, påvirket av kundens
  prisnivå.

Kilde: [How to Build an Electrical Contractor Price Book](https://www.simprogroup.com/blog/electrical-contractor-price-book).

### Fergus — favoritter og skjulte kolonner

- «Favourites»: lagre materiell og arbeid som brukes ofte.
- Grupper varer og timer, legg på påslag/margin.
- **«Show/hide markups and cost price»** — kolonnene er interne og kan slås av.
- Trinnvise påslag per kundetype/jobbtype. Ubegrenset versjonssporing.
- Kunden godkjenner rett fra e-postlenka.

Kilde: [Fergus quoting](https://fergus.com/features/quoting/).

### Tradify — kits på fem minutter

- Maler, prislister og **kits** for jobber som gjentar seg. «Komplett tilbud
  på under fem minutter på stedet».

Kilde: [Tradify electrical quoting](https://www.tradifyhq.com/uk/electrical-quoting-software-app).

### Minuba — fire prisgrunnlag

- Per tilbud: **Forbrug** (medgått), **Kalkulation** (linjer), **Fast pris**,
  **Entreprise** (milepæler). Linja viser salgspris og forventet kostnad.
- Kundespesifikke rabattavtaler på timer og materiell legges på automatisk.
- Linjene i kalkulasjonen følger med til fakturaen.

Kilde: [Opret tilbud eller ordre](https://minuba.dk/support/opret-tilbud-eller-ordre/).

### Gripr — den enkle enden (der vi var)

- Tilbud på fem minutter, vedlegg og bilder, send på e-post, kunden aksepterer
  digitalt, status fra sendt til akseptert. «Send fra egen e-post» er «kommer snart».

Kilde: [Gripr tilbud](https://www.gripr.no/feature-categories/tilbud).

### Elinn og SpeedyCraft

Ingen egen kalkyle å snakke om — begge er feltordre-systemer der prisingen bor
i regnskapssystemet bak (Elinn: 469–1 337 kr/bruker + 349 kr/mnd og 3 199 kr
etablering for regnskapskobling). Ikke en referanse for tilbud.

### Akkordtariffen (til senere)

Montasjepriser i kr per enhet × akkordmultiplikator (2,482 fra 1. mai 2022).
Fri PDF: [Akkordtariff 2022–2024](https://www.nhoelektro.no/siteassets/arbeidsliv-jus-og-tariff/diverse-dokumenter/2022-2024/akkordtariff-2022---2024.pdf).
LOK 2024–2026 finnes hos elogit.no.

## Hva som er bygget (2026-09-18)

**Modell** (`supabase/migrations/20260918180000_tilbud_tilvalg_pakker.sql`):
`quote_lines.is_optional`, `is_selected`, `price_locked`;
`quotes.default_markup_percent`; nye tabeller `quote_packages` +
`quote_package_lines` (kun kontoret — ikke i `sync_tables`, appen trenger dem
ikke). Appens WatermelonDB-skjema v45 har de tre linjefeltene.

**Regnestykket** (`lib/quoting.ts`, `verify:quoting`): et fravalgt tilvalg
teller ikke i netto, mva, rabatt, kost eller områdesum, men linja beholder sin
egen pris så kunden ser hva den koster. `tilvalgUtenforOre` er det som fortsatt
kan legges til. `anvendPaslag` setter pris = kost + påslag på alt som har kost,
ikke er tekst og ikke er låst. `utvidPakke` ganger pakkens linjer med antall og
priser dem med pakkens egen pris eller kost + påslag.

**Dokumentet** (`lib/pdf/tilbud.ts`, `verify:pdf`): fravalgte tilvalg står på
sin plass i lista, merket «Tilvalg – ikke medregnet», med prisen i
spesifikasjonskolonnen og tom beløpskolonne. Summen får en linje «Tilvalg som
kan legges til». Kost og påslag lekker fortsatt aldri.

**Kontoret** (`desktop/src/ruter/Tilbud.tsx`): kalkulasjonen er et regneark.
Varesøk øverst (el-nummer eller navn; Enter på fritekst = skaffevare), pakker,
målområde for alt som legges til, standard påslag med «oppdater alle», «vis
kost». Piler opp/ned og Enter flytter mellom radene; Enter på siste rad lager
ny linje. Avkryssing (shift-klikk for område) gir utvalgslinja: flytt til
område, påslag, lås/lås opp, tilvalg av/på, lagre som pakke, slett.

**Appen** (`app/(app)/tilbud/[id].tsx`, `linje.tsx`): tilvalg vises med
avkryssing som montøren slår av og på sammen med kunden — også etter at
tilbudet er sendt, fram til det er besvart. Et fravalgt tilvalg blir ikke
planlagt materiell på ordren (`registrerSvar`).

## Neste

1. Akkordtariffen inn som data (egen tabell, import fra PDF-en) og
   kalkulasjonsmetode «akkord» på linja.
2. Kundeflate: en lenke kunden åpner, krysser av tilvalg, og aksepterer.
   Krever en offentlig rute med token — samme mønster som Boligmappa-lenker.
3. Pakker som kan redigeres etter at de er lagret (i dag: slett og lagre på nytt).
