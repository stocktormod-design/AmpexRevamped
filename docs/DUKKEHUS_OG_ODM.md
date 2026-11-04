# Dukkehuset og egne moduler — plan (2026-10-30)

Videre fra `docs/SMARTHUS.md` (25.10). Ingenting her er kodet. Ny Swift-kode i skannet
venter på Tormods ja til denne planen.

## Hva vi lager

Elektrikeren skanner huset med LiDAR mens han installerer. Kunden får et **dukkehus**: huset
sett ovenfra med taket av, i ekte farger, med hver lampe, bryter og stikkontakt der den sitter.
Trykker kunden på en lampe, går lyset på. Modulene bak bryterne er **våre egne**, laget av en
kinesisk ODM-fabrikk. De skal ha alt Plejd har eller bedre, og koste en tredjedel.

Inspirasjon: en video av en salgsside for en boligblokk (fasade → etasje → snittet 3D-leilighet →
fotorealistisk rom). Kunden der betalte 3 350 dollar for én side. Vi gir det samme som en del av
elektrikerens dokumentasjon, bak QR-koden på sikringsskapet, og med brytere som virker.

Tormod 30.10: «merket må ha alt Plejd har eller bedre. Kinesiske leverandører er ofte veldig
imøtekommende.»

## Del 1 — Alt Plejd har (sortimentet per september 2026)

Kilde: Plejds tyske prisliste «Stand September 2026» (via Eltric), produktsider og manualer.
Kolonnen «Vi» sier hva vi må ha. **Fet** = med i første ODM-runde.

### Moduler («pucks», bak bryteren i boksen, 46 × 46 × 18 mm)

- **DIM-01 universaldimmer**: fasesnitt både for- og bak, LED 0–200 VA, glødelys 0–300 W, to
  innganger for vanlig bryter/trykknapp/bevegelsessensor, justerbart min-, maks- og startnivå.
  Vi: **samme, og minst like god på flimmer**. Det er her Plejd har sin egentlige kunnskap.
- **DIM-02 tokanals dimmer**: som over, 100 VA LED per kanal. Vi: **samme**.
- **REL-01-2P rele 16 A, 1- eller 2-polet**: LED 800 W, nullgjennomgangsvern. Vi: **samme**.
- **REL-02 tokanals rele**, 16 A totalt. Vi: **samme**.
- **CTR-01** 0/1–10 V-styring + 16 A rele, til andres drivere. Vi: senere.
- **DAL-01** DALI broadcast, egen busspenning 128 mA, 64 laster. Vi: senere.
- **LED-10** 10 W LED-driver i boks, 1–100 %. **LED-75** 75 W for 12/24 V-stripe med tunable white.
  Vi: senere.
- **JAL-01** persienne- og markisemotor 230 V, med posisjon og vinkel. Vi: senere.
- **EXT-01** forlenger meshen, holder astroklokka gjennom strømbrudd. Vi: trenger vi ikke
  hvis hver modul videresender meldinger.
- **TRM-01 termostat for gulvvarme**: berøringsskjerm, 16 A, rom- og gulvføler, rammer for ELKO,
  Exxact og Schneider, ca. 949 kr. Vi: **ja, tidlig**. Varme er det største forbruket og der
  spotprisen sparer penger.

### Trådløst og tilbehør

- **WPH-01 trådløs bryter**, batteri opptil 15 år (CR2032). Vi: **ja**.
- **WIN-01 bak en hvilken som helst bryter**, batteri CR2450. Vi: ja.
- **WMS-01 bevegelsessensor**, PIR, 7 m, AA-batteri opptil 10 år. Vi: senere.
- **GWY-01 gateway**: Ethernet, styring utenfra, ferie-modus, Google Home, Apple HomeKit, Alexa
  og Homey, holder tidsfunksjonene gjennom strømbrudd. Vi: **ja**, se under.
- **BAT-01 reservebatteri** for klokka, MNT-01/02 monteringsklips og -boks. Vi: klips ja.
- **OUT-01/02 egne utelamper** (IP44/45, C4, IK06). Vi: nei, vi lager ikke lamper.

### Systemet

- Bluetooth-mesh på 2,4 GHz, ca. 10 m innendørs, modulene videresender til hverandre.
- **Virker uten nett og uten sky.** Bryteren på veggen virker alltid.
- Astro- og ukeklokke i hver modul, timere, scener som kan startes fra vanlige brytere.
- Elektrikeren installerer og programmerer i appen og leverer et ferdig «objekt» til eieren.
  Med gateway kan elektrikeren hjelpe kunden på avstand.
- Hvilestrøm 0,3 W, vern mot overtemperatur og overlast i programvare og maskinvare.

### Der vi skal være bedre

- **Matter.** Vi fant ingen offisiell Matter-støtte hos Plejd, men det kommer bare fra én
  brukeranmeldelse, så det må sjekkes. Matter over Thread fra start gir Apple Home, Google og
  Alexa uten at vi lager hver integrasjon selv.
- **Strømmåling per kanal** på reléene, slik at kunden ser hva som bruker strøm. Vi fant det
  ikke i Plejds datablader.
- **«Spar penger»** (SMARTHUS.md): varme, bereder og lading flyttes etter spotpris, med et
  ærlig tall for hva kunden har spart.
- **Dukkehuset** i stedet for lister med navn som «Puck 3».
- **Oppsett mot tegningen.** Modulen kobles til punktet og kursen som allerede finnes i Ampex,
  og kursfortegnelse og FDV blir oppdatert av seg selv.
- **Pris.** En tredjedel av Plejd (DIM-02 ca. 549 kr).

## Del 2 — Hva vi krever av ODM-fabrikken

- **Brikke vi kan programmere selv.** ESP32-C6 (Bluetooth LE, wifi og Thread i én brikke),
  nRF52840, eller Telink som mange kinesiske Bluetooth-mesh-moduler bruker. **Ikke Tuya-
  firmware og ikke Tuya-sky.** De skal levere skjema, programmeringspunkter og fri flashing.
- **Dimmerkortet** skal kunne velge for- eller baksnitt og justere minimumsnivå. Prøvene
  testes for flimmer og summing mot en fast liste vanlige norske LED-pærer og -drivere før vi
  velger fabrikk.
- **Varme.** Full last i en tett norsk veggboks over tid, med måling. Plejd regner med
  −20 til +35 °C rundt modulen.
- **Testrapporter:** LVD (EN 60669-2-1 for elektroniske brytere), EMC og radio (RED,
  EN 300 328). **Den som setter navnet sitt på produktet er produsenten**, og må ha teknisk
  fil og samsvarserklæring. Fabrikken leverer rapportene; ansvaret blir hos oss.
- **Bluetooth- og Matter-sertifisering** koster medlemskap og testing. Hva det koster må
  sjekkes før vi lover Matter.
- **Prøver først:** 3–5 stk av det de har av dimmer, rele og termostat, før vi snakker om
  eget kort og minimumsbestilling.

Kinesiske leverandører er imøtekommende. Det første brevet ber om datablad, testrapporter,
prøver og om de godtar egen firmware. Hvem vi skriver til, finner vi på Alibaba/1688 og blant
fabrikkene bak de kjente merkene. Det er en egen research-runde.

## Del 3 — Dukkehuset

**Skallet: Apples RoomPlan.** Det lager vegger, gulv, dører, vinduer og åpninger som rene
flater, og møbler som esker med type (seng, sofa, komfyr, badekar, vask, toalett, bord …).
Fra iOS 17 setter det sammen flere rom til ett hus. Det er gratis og kjører på telefonen.
RoomPlan gir **ingen farger og ingen tekstur**; alt er hvitt og grått.

**Fargene kommer fra skanningens egne bilder:**

1. *Snittfarge per flate*. Hver vegg og gulvflate får fargen fra bildene som ser den.
   Billig, og gir allerede et dukkehus som ligner huset.
2. *Ekte bilde på flatene*. Kamerabildene legges på veggene og gulvet. En plan flate er
   mye lettere å lage skarp enn det ujevne nettet vi baker i dag, så dette er enklere enn
   det skannet allerede gjør.
3. *Møbler*: hver eske byttes med en enkel 3D-modell av samme type (CC0, som bilpakken på
   Meg-fanen), i fargen bildet viser.

**Punktene.** Punktene fra tegningen (lys, bryter, stikk med kursnummer) skal stå i 3D der de
sitter. Tegningen og RoomPlan-planen legges oppå hverandre med to punkter, som målestokken på
tegningen. Det som avviker, flytter montøren i AR («Se i rommet» er bygget, men ikke testet).

**Visningen** finnes to steder:
- I nettleseren bak delingslenka og QR-koden (three.js), så kunden ikke trenger appen for å se.
- I appen, der lampene også kan styres.

## Faser

Hver fase er ferdig først når **sluttkravet** er oppfylt.

**F0 — Prøver på benken.** Kjøp én Shelly 1PM Mini og be 2–3 ODM-fabrikker om prøver.
Sluttkrav: vi har målt flimmer, varme og hvilestrøm på det vi har, og vet hvilken brikke
fabrikkene bruker.

**F1 — Dukkehus i farger, uten styring.** RoomPlan-skanning i appen (eget valg ved siden av
dagens skann), snittfarge per flate, punktene fra tegningen, vist bak delingslenka.
Sluttkrav: Verona-soverommet eller huset hjemme vises i nettleseren som et dukkehus du
kjenner igjen, med punktene på riktig vegg.

**F2 — Ekte flater og møbler.** Bildene legges på vegger og gulv, og møbeleskene byttes med
modeller. Sluttkrav: Tormod ser på det og sier at det er bra nok til å vise en kunde.

**F3 — Styring.** Appen snakker med modulen direkte over Bluetooth, og via gateway utenfra.
Scener, astro og timer. Sluttkrav: lyset hjemme hos faren hans styres fra dukkehuset, og
veggbryteren virker fortsatt når nettet er nede.

**F4 — Eget merke.** Egen firmware på ODM-kortet, testrapporter, samsvarserklæring og pilot
hos én kunde. Sluttkrav: CE-dokumentasjonen er komplett og en elektriker utenfor oss har
montert det.

## Åpent

- Matter hos Plejd: sjekk på produktsidene, ikke i en anmeldelse.
- Prisen for Bluetooth- og Matter-sertifisering.
- Om RoomPlan og dagens LiDAR-skann skal være ett opptak eller to. Helst ett: RoomPlan og
  ARKit kan kjøre samtidig, men det må testes på telefonen.
- Navnet på merket.

## Kilder

- Plejd, prisliste september 2026 (via Eltric):
  https://www.eltric.com/de-DE/media/151229/original/plejd_september_2026.pdf
- TRM-01: https://plejd.com/products/trm-01 · Kjell & Company (949 kr):
  https://www.kjell.com/no/produkter/elektro-og-verktoy/sterkstrom/termostater/plejd-trm-01-termostat-for-elektrisk-gulvvarme-exxact-exxact-antrasitt-p52366
- Plejd-appen (scener, astro, gateway): https://apps.apple.com/app/id1032689423 ·
  https://plejd.com/consumer · GWY-01: https://www.plejd.com/en-is/products/gwy-01
- Elektrikeren som målgruppe: https://www.plejd.com/electrician ·
  https://placera.se/nyheter/plejd-hyllas-av-installatorer--konkurrenterna-valjs-bort-2026-04-02
