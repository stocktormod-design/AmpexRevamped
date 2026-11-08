# Shelly (Shelly Group / Allterco) som eneleverandør for et norsk smarthus — status oktober 2026

Researched 2026-10-26. Sammenligningsgrunnlag: Plejd DIM-02 (2×100 VA LED, trailing edge, Bluetooth mesh, lukket, ca. 549 NOK). Many Shelly product/doc pages returned HTTP 429 during this session, so several specs rest on search snippets and retailer pages rather than the full Shelly page. Those are marked.

## 1. Modultyper: dekker Shelly alt? (modeller, ytelser, priser)

### Takeaway
Shelly dekker relé (inn-boks og DIN), energimåling per kurs, trådløse batteribrytere, gateway og veggpanel godt og billig. Det finnes **ingen 2-kanals dimmer i boks** (Dimmer Gen4 er 1-kanals, 150 W LED; 2-kanals finnes bare som DIN-skinne-modulen Pro Dimmer 2PM). Det finnes **ingen ferdig termostat for norsk gulvføler** (krever Plus Add-On + skript), og **ingen AMS/HAN-leser** (Pro 3EM måler med strømtenger, leser ikke HAN-porten).

### Cited Findings
**Dimmer (lys)**
- Shelly Dimmer Gen4: dimbare LED inntil 150 W, glødelampe/halogen inntil 200 W, maks utgang 200 W, **trailing edge**; uten nøytral kreves Shelly Bypass hvis lasten er under 20 W — [shellyparts.de](https://shellyparts.de/en/products/shelly-dimmer-gen4), [Shelly DE produktside](https://www.shelly.com/de/products/shelly-dimmer-gen4) (søkeutdrag; hele siden ga 429)
- Dimmer Gen4 er én kanal; Wi-Fi + Bluetooth + Zigbee; ca. 49,98 USD (2PM Gen4: 38,99 USD) — [smarthomecompared.com](https://smarthomecompared.com/relays/shelly-2pm-gen4-vs-shelly-dimmer-gen4) (kommersiell sammenligningsside)
- Ingen offisiell kilde fant en 2-kanals Gen4-dimmer i boks; 2-kanalsmodellen er **Shelly Pro Dimmer 2PM** (DIN-skinne, 94×19×69 mm, Ethernet + Wi-Fi + Bluetooth, maks 200 W utgang i følge forhandler, eksternt vern 10 A), ca. £67,14 inkl. MVA — [netxl.com](https://www.netxl.com/switches-and-dimmers/shelly-pro-dimmer-2pm-din-rail-smart-dimmer-power-metering/), [smart-secure.co.uk](https://www.smart-secure.co.uk/?p=49384), [Shelly-dokumentasjon](https://us.shelly.com/blogs/documentation/shelly-pro-dimmer-2pm). Om 200 W gjelder per kanal eller totalt, og om den er trailing edge, ble IKKE bekreftet.
- Shelly Dimmer Gen4 lansert i USA (UL, Matter) i januar 2026, ca. 49,99 USD — [Notebookcheck (IT)](https://www.notebookcheck.it/Shelly-rilascia-il-nuovo-Dimmer-Gen4-compatibile-con-la-materia-negli-Stati-Uniti.1213626.0.html)

**Relé av/på (inn-boks)**
- Shelly 2PM Gen4: to kanaler, switch- eller cover-profil (persienner/garasje), Wi-Fi, BLE, MQTT, Modbus, utgående WebSocket, KNX-integrasjon, Matter, Zigbee, opptil 10 skript — [Shelly API-dok 2PM Gen4](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4/Shelly2PMG4)
- 2PM Gen4 pris: 27,00 € (kampanje, shelly.com FR), 2-pakning 53,10 €; 38,68 € (DE ved lansering); £34 (UK) — [shelly.com FR](https://www.shelly.com/fr/products/shelly-2pm-gen4), [smarthomeassistent.de](https://www.smarthomeassistent.de/shelly-2pm-gen4-jetzt-erhaeltlich/), [smart-secure.co.uk](https://www.smart-secure.co.uk/product/shelly-2pm-gen4/)
- Shelly 1PM Gen4: 16 A / 3680 W, passer i standard veggboks, måler effekt — [shelly.guide gulvvarme](https://shelly.guide/application-guide/floor-heating/)
- 1PM Gen4 priser: Prisjakt Norge «fra 239 kr» (Shelly 1-søk; modellen ikke entydig); inet.se 299 SEK (3-pakning 747 SEK); Pricerunner DK 147 DKK; Rexel Sverige fører «Relä 1PM Gen4 WiFi Zigbee» — [prisjakt.no](https://www.prisjakt.no/s/shelly-1/), [inet.se](https://www.inet.se/produkt/v101562/shelly-1pm-gen-4-3-pack), [pricerunner.dk](https://www.pricerunner.dk/mi/234502/Shelly), [Rexel SE](https://www.rexel.se/swe/Produktkatalog/Installationsmateriel-%2811-15%2C-17%2C-18%29/13---N%C3%A4rvaro--och-r%C3%B6relsedetektorer-och-kopplingsur/Hemautomation/Smart-rel%C3%A4/Rel%C3%A4-1PM-Gen4-WiFi-Zigbee/p/1302153)
- Shelly 2L Gen3: 2-kanals relé for steder uten nøytral — [linkshop.gr](https://www.linkshop.gr/smarthome/shelly-2l-gen3-smart-2-gang-relay-modul-for-no-neutral-wiring.html)

**DIN-skinne / kursmåling**
- Shelly Pro 4PM: 4 kanaler, 16 A per kanal, 40 A totalt, LAN + Wi-Fi + BT, 1,8" fargeskjerm; V2-revisjonen har 5 separate skrueklemmer; ca. 111–120 € (svensk forhandler) — [Shelly PL produktside](https://www.shelly.com/pl/products/shelly-pro-4pm), [Shelly Pro 4PM V2-dok](https://www.shelly.com/pl/blogs/documentation/shelly-pro-4pm-v2), [BayWa](https://solar-distribution.baywa-re.de/en/system-accessories/shelly-pro-4pm.html), [nyehandel.se](https://nydemo-7838se.nyehandel.se/en/products/shelly-pro-4pm), [Tibber SE](https://tibber.com/se/store/produkt/shelly-pro-4pm)
- Shelly Pro 2: to faser / to kanaler, opptil 25 A, 110–240 VAC — (forumsitat/produktutdrag) [shelly-forum.com](https://shelly-forum.com/thread/14531-two-different-phases-l1-and-l2)
- Ogemray Smart Relay 25A «Powered by Shelly» (ShellyX-brikke, full Shelly-app-støtte), selges i Shelly-butikken og hos danske Lemu — [shelly.com](https://www.shelly.com/products/ogemray-25a-smart-relay), [lemu.dk](https://www.lemu.dk/en/product/ogemray-smart-relay-25a-powered-by-shelly-id-7822623668)
- Shelly Pro 3EM: 3-fase DIN-energimåler med strømtenger, LAN/Wi-Fi, Modbus TCP — [Shelly ES dok](https://www.shelly.com/es/blogs/documentation/shelly-pro-3em), [Shelly API-dok](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2/ShellyPro3EM); føres av Onninen Finland (DEV673) — [onninen.fi](https://www.onninen.fi/en/shelly-energy-meter-shelly-pro-3em-400a/p/DEV673)

**Termostat for gulvvarme / panelovn**
- Shellys egen gulvvarmeguide (oppdatert april 2026) anbefaler Plus/Gen3/Gen4-relé + **Shelly Plus Add-On** + DS18B20-føler i avrettingen — [shelly.guide](https://shelly.guide/application-guide/floor-heating/)
- Add-On kan lese eksisterende NTC-gulvføler «uansett merke» via et skript som regner motstand → temperatur; eksemplet bruker 15 kΩ, ingen 10k/12k-eksempel — [shelly.guide NTC-skript](https://shelly.guide/en/scripting/ntc-sensor-control/)
- Forumbruker: Add-On har ikke innebygd støtte for NTC10k (Warmup), må løses med Steinhart–Hart-skript og kalibrering — [shelly-forum.com](https://shelly-forum.com/user-post-list/150237-sroggatz)
- UK-forhandler selger «Shelly Smart Electric Underfloor Heating Bundle» — [maplin.co.uk](https://www.maplin.co.uk/products/shelly-smart-electric-underfloor-heating-bundle) (innhold ikke sjekket)

**Trådløse batteribrytere, gateway, veggpanel**
- BLU Button Tough 1: 19,99 USD (Shelly US); BLU Button Tough 1 ZB (Zigbee-variant) £17; BLU Wall Switch 4 finnes — [us.shelly.com](https://us.shelly.com/products/shelly-blu-button-tough-1-ivory), [thepihut.com](https://thepihut.com/products/shelly-blu-wall-switch-4-stand-alone)
- BLU Gateway ca. £15,50; Shelly FAQ: enhver Plus/Pro/Gen3/Gen4-enhet (ikke sensorer) fungerer som BLU-gateway — [thepihut.com](https://thepihut.com/products/shelly-wall-display-x2i), [shelly.com PL](https://www.shelly.com/pl/products/shelly-wall-display-x2-blu-h-t)
- Wall Display X2i: 225 € (Shelly DE), £172,50 (Pi Hut); Wall Display XL finnes — [shelly.com DE](https://www.shelly.com/de/products/shelly-wall-display-x2-blu-h-t), [thepihut.com](https://thepihut.com/products/shelly-wall-display-x2i), [shelly.com smart controllers](https://www.shelly.com/de/collections/smart-controllers)

**AMS/HAN**
- Ingen kilde fant en Shelly-HAN/P1/M-Bus-leser. Pro 3EM måler med strømtenger, ikke via målerens HAN-port — [shelly-api-docs Pro3EM](https://shelly-api-docs.shelly.cloud/gen2/0.14/Devices/ShellyPro3EM)

### Inferences
- Norske priser: enkle relémoduler ligger rundt 240–400 NOK, altså klart under Plejd. En Plejd DIM-02 (2 kanaler, 549 NOK) tilsvarer to Dimmer Gen4 (ca. 2 × 50 USD ≈ 1000 NOK). Per dimkanal er Shelly dermed omtrent like dyr som eller dyrere enn Plejd, mens Shelly får mer LED-effekt per kanal (150 W mot 100 VA).
- Da gjenstår tre hull: 2-kanals dimmer i boks, en ferdig NTC-termostat og HAN-leser. HAN dekkes i Norge typisk av Tibber Pulse eller AMSleser. «Alt fra Shelly» er altså ikke mulig uten egen skriptlogikk eller tredjepart.

### Gaps
- Fant ikke Kjell-, Elektroimportøren-, Proshop- eller Komplett-priser i NOK på enkeltmodeller (søket ga ingen treff). Prisjakt-tallet på 239 kr gjelder et søk, ikke en bekreftet modell.
- Pro 2PM og Pro Dimmer 1PM/2PM: hvilken last per kanal og hvilket dimmeprinsipp de har, er ikke bekreftet.
- Sjekket ikke Gen4-varianter av Plus Add-On, Shelly BLU TRV eller eventuelle egne termostatprodukter fra 2026.

## 2. Dimmekvalitet (flimmer/brumming med LED)

### Takeaway
Dimmer Gen4 er trailing edge og har bypass-tilbehør for små laster. Brukere rapporterer likevel flimmer med GU10-spotter på lavt dimnivå, også med nøytral tilkoblet. Kvaliteten avhenger altså av lampen, som hos alle faseavsnitt-dimmere.

### Cited Findings
- Tråd: «Shelly Dimmer Gen 4 – Flackern von GU10-Spots – Bypass notwendig» (flimmer på lavt nivå, med nøytral) — [community.simon42.com](https://community.simon42.com/t/shelly-dimmer-gen-4-flackern-von-gu10-spots-bypass-notwendig/91981)
- Uten nøytral og under 20 W last kreves Shelly Bypass — [shellyparts.de](https://shellyparts.de/en/products/shelly-dimmer-gen4)

### Inferences
- Plejd markedsfører seg på dimmekvalitet. For Shelly finnes det bare enkeltrapporter, ingen systematisk test.

### Gaps
- Fant ingen tester av brumming, kalibreringsrutine eller laveste dimnivå for Gen4 eller Pro Dimmer.

## 3. Nett: Wi-Fi-grenser, Zigbee/Matter på Gen4, BLU

### Takeaway
Shelly oppgir ingen fast grense for antall enheter. Store anlegg (50–125 enheter) er skjøre på vanlig forbruker-Wi-Fi og mesh: Shelly støtter ikke PMF eller 802.11r/k/v og sliter med roaming. Gen4 med Zigbee fungerer mot vanlige koordinatorer (Zigbee2MQTT), men router-oppførselen er ustabil og avhenger av fastvaren.

### Cited Findings
- Bruker med over 50 Shelly på Asus-mesh: Shelly støtter ikke PMF eller 802.11r/k/v, og fallene fortsatte — [shelly-forum.com](https://shelly-forum.com/thread/15936-shellies-dropping-connection-in-asus-aimesh-network)
- Problemet ble løst med eget aksesspunkt eller egen SSID; Shelly sliter med flere AP-er — [community.simon42.com](https://community.simon42.com/t/hilfe-unifi-aps-shellies-und-home-assistant/60905), [shelly-forum.com](https://shelly-forum.com/thread/14292-intermittent-connection-issues)
- 125 Shelly-enheter ble alle utilgjengelige etter nettbytte — [shelly-forum.com](https://shelly-forum.com/user-post-list/96206-lthielen)
- Gen4 i Zigbee: router-funksjon virket bare med Wi-Fi av i noen rapporter, og enkelte enheter feilet ved innmelding — [simon42 s.2](https://community.simon42.com/t/erfahrungen-mit-shelly-2pm-gen4-im-zigbee-betrieb/65356?page=2), [s.3](https://community.simon42.com/t/erfahrungen-mit-shelly-2pm-gen4-im-zigbee-betrieb/65356?page=3)
- Gen4-strømlister oversvømte Zigbee-koordinatoren til den krasjet; fastvare 2.0 skulle fikse det, men ingen bekreftelse — [simon42 s.4](https://community.simon42.com/t/erfahrungen-mit-shelly-2pm-gen4-im-zigbee-betrieb/65356?page=4)
- Uenighet om Wi-Fi og Zigbee kan gå samtidig — [simon42 repeater-tråd](https://community.simon42.com/t/shelly-gen4-als-zigbee-repeater/54149), [s.2](https://community.simon42.com/t/shelly-gen4-als-zigbee-repeater/54149?page=2); [HA community](https://community.home-assistant.io/t/shelly-gen4-zigbee-mode/888242?page=2)
- BTHome-komponenter er ikke tilgjengelige i Zigbee-modus — [API-dok 2PM Gen4](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4/Shelly2PMG4)
- 2PM Gen4 og Pro 2PM Gen4 er Matter-sertifisert (CSA) — [csa-iot.org](https://csa-iot.org/csa_product/shelly-2pm-gen4/)
- BLU-enheter kan bruke enhver Plus/Pro/Gen3/Gen4 som gateway — [shelly.com PL](https://www.shelly.com/pl/products/shelly-wall-display-x2-blu-h-t)

### Inferences
- I et norsk hus med 40–60 moduler trenger kunden et ordentlig AP-oppsett med egen IoT-SSID. Elektrikeren kontrollerer ikke kundens ruter, og det er en driftsrisiko Plejd ikke har. Plejd-meshet er selvbærende.
- Dersom Zigbee-modusen blir moden, kan Gen4 fjerne Wi-Fi-avhengigheten, men da kreves en egen koordinator.

### Gaps
- Fant ingen offisiell Shelly-anbefaling om maksimalt antall enheter eller nettverksoppsett.
- Status for Zigbee i fastvare 2.x per oktober 2026 er ikke bekreftet.

## 4. Åpenhet: lokal API, skripting, provisjonering uten sky

### Takeaway
Shelly er det mest åpne av de store merkene. Det finnes en dokumentert lokal RPC over HTTP, WebSocket og MQTT, i tillegg til Modbus, KNX og innebygd JS-skripting (opptil 10 skript). Autentiseringen er valgfri SHA-256 digest. Lokal styring uten Shelly Cloud er etablert praksis.

### Cited Findings
- Gen2+ bruker SHA-256 digest-autentisering for HTTP og WebSocket. Shelly.GetDeviceInfo og /shelly er unntatt. Passord settes med Shelly.SetAuth (forhåndsberegnet HA1). Fra fastvare 2.0.0 kan nonce gjenbrukes — [Shelly API-dok Authentication](https://shelly-api-docs.shelly.cloud/gen2/General/Authentication/)
- Protokoller i 2PM Gen4: Wi-Fi, BLE, Cloud, Modbus, MQTT, utgående WebSocket, KNX, Matter, Zigbee, skript — [API-dok](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4/Shelly2PMG4)
- Tredjepartsverktøy styrer enheter lokalt uten Shelly Cloud: Shelly Manager og rshelly-gem — [github jfmlima/shelly-manager](https://github.com/jfmlima/shelly-manager), [github jegt/rshelly](https://github.com/jegt/rshelly)
- Homey-appen støtter ikke autentisert lokal RPC for Gen2, så brukerne må slå auth av — [homey.app](https://homey.app/a/nl.xibel.ogemray/test/) (tredjepart)
- Shelly har en side om EU Data Act — [shelly.com](https://www.shelly.com/es/blogs/documentation/eu-data-act) (innhold ikke lest)

### Inferences
- En egen app (Ampex) kan i praksis provisjonere og styre Shelly helt uten Shelly Cloud. Plejd har ingen offentlig lokal API.

### Gaps
- BLE-provisjonering (Wifi.SetConfig over BLE) ble ikke verifisert i offisiell dokumentasjon i denne økten, fordi sidene ga 429.

## 5. Norsk IT-nett (230 V fase–fase, uten N)

### Takeaway
Fant ingen offisiell Shelly-erklæring om at modulene er godkjent for IT-nett der N-klemmen kobles til en annen fase. Forumpraksis er å legge den andre fasen på N-klemmen («nøytralerstatning»), og det fungerer elektrisk siden apparatene er 110–240 V. Norske brukere har spurt om dette uten å få svar fra Shelly.

### Cited Findings
- Belgisk 3×230 V-nett: én fase deklareres som «nøytralerstatning», L1 på N-klemmen og L2 på L — [shelly-forum.com](https://shelly-forum.com/thread/19441-shelly-em-on-3x230-v-network)
- N-klemmen skal ligge på samme fase som lasten og L på bryterens fase — [shelly-forum.com](https://shelly-forum.com/thread/14531-two-different-phases-l1-and-l2)
- Norsk bruker spør om Pro 3EM/3PM kan brukes i Norge siden N mangler; ingen svar fra Shelly i tråden — [shelly-forum.com](https://shelly-forum.com/thread/32266-shelly-pro-3em)
- Diskusjon om Shelly-dimmer i IT-nett på byggebolig.no — [byggebolig.no](https://www.byggebolig.no/el-installasjon-teknisk-installasjon/shelly-2-dimmer-l-versus-n)
- Spørsmål om tilkobling uten nøytral på 3-fasenett, 1 Mini Gen3 — [shelly-forum.com](https://shelly-forum.com/thread/31323-how-to-connect-shelly-1-mini-gen-3-to-a-3-phase-network-without-neutral)

### Inferences
- Med ett relé brytes bare den ene fasen, så den andre ligger fortsatt på lasten. Dette er det samme forholdet som for andre enpolte smartmoduler i IT-nett og må vurderes mot NEK 400. Plejd har uttrykkelig norsk IT-støtte, mens Shelly overlater vurderingen til installatøren.

### Gaps
- Fant ingen offisiell Shelly KB-artikkel eller DoC-tekst om IT-nett.
- Plassbehov i nordiske 60 mm-bokser og bak Elko/System 55 er ikke kildebelagt. Kildene sier bare «passer i standard veggboks» (1PM Gen4).

## 6. CE/RED-dokumentasjon og installatørkanal i Norge

### Takeaway
Shelly har salgsorganisasjon i Norden, Norge medregnet, og 8 600 installatører i nettverket. Det fantes ingen bevis for at Shelly selges via norske elgrossister (Solar, Onninen NO, Rexel NO) med el-nummer. I Sverige fører Rexel produktene, i Finland Onninen.

### Cited Findings
- Shelly Group har salgsorganisasjoner i Danmark, Sverige, Norge og Finland; installatørnettverket teller 8 600 medlemmer; ny pan-europeisk broadline-distributøravtale (navn ikke oppgitt) — [corporate.shelly.com H1 2026](https://corporate.shelly.com/en/news/shelly-group-delivers-strong-revenue-and-earnings-growth-in-the-first-six-months-of-2026)
- H1 2026: omsetning 68,3 MEUR (+26,5 %), EBIT 17,7 MEUR (26,0 % margin). Helårsveiledningen er 195–205 MEUR omsetning og 47–52 MEUR EBIT, med vekt på andre halvår — [corporate.shelly.com](https://corporate.shelly.com/en/news/shelly-group-delivers-strong-revenue-and-earnings-growth-in-the-first-six-months-of-2026). NB: H1 på 68 MEUR mot helår på ca. 200 MEUR er et uvanlig sprik. Tallene er gjengitt slik siden oppgir dem, men bør dobbeltsjekkes.
- Partnerskap med ALSO (europeisk distributør) for installatører og integratorer — [deraktionaer.de](https://www.deraktionaer.de/nachricht/eqs-newsdieshellygroupstaerktihrepraesenzaufdemeuropaeischenmarktdurcheinepartnerschaftmitdemfuehrendentechnologie-distributoralsodeutsch-546056.html)
- Rexel Sverige fører 1PM Gen4, Onninen Finland fører Pro 3EM — [rexel.se](https://www.rexel.se/swe/Produktkatalog/Installationsmateriel-%2811-15%2C-17%2C-18%29/13---N%C3%A4rvaro--och-r%C3%B6relsedetektorer-och-kopplingsur/Hemautomation/Smart-rel%C3%A4/Rel%C3%A4-1PM-Gen4-WiFi-Zigbee/p/1302153), [onninen.fi](https://www.onninen.fi/en/shelly-energy-meter-shelly-pro-3em-400a/p/DEV673)

### Gaps
- Fant ikke om Shelly finnes i EFObasen eller har norske el-nummer.
- Lastet ikke ned DoC-er og sjekket ikke ENEC. At Shelly publiserer DoC per produkt er antatt, men ikke verifisert i denne økten.

## 7. White-label / ODM (ShellyX, «Powered by Shelly»)

### Takeaway
ShellyX er et OEM-program for produsenter som vil bygge Shelly inn i egne apparater, enten med X MOD1-modulen eller med standardmoduler som komponent. Shelly oppgir ingen royalty og ingen sky-, abonnements- eller vedlikeholdsavgift; kunden betaler bare modulen. «Powered by Shelly»-produkter (Ogemray 25A, Hörmann, WeWash/BSH) bruker Shelly-appen. Shelly tilbyr ikke en hvitmerket app eller eget merke på Shellys sluttprodukter.

### Cited Findings
- ShellyX: ingen royalty, abonnement, vedlikehold eller skyavgift, kun modulpris — [x.shelly.com/features](https://x.shelly.com/features)
- X MOD1: innebygd OEM-modul (ESP-Shelly SoC), Wi-Fi 2,4 GHz + BT5, opptil 8 I/O, Shelly-skripting — [selorahomes.com](https://selorahomes.com/devices/shelly/x-mod1/)
- «Shelly as component»: 1PM Gen3, 1 Mini Gen4, 2PM Gen4, 1PM Mini Gen4 og EM Mini Gen4 som hyllevare-moduler i apparater. Kontakt skjer via skjema og ShellyX-portalen. MOQ, priser og merkevareregler står ikke oppgitt — [x.shelly.com](https://x.shelly.com/how-it-works-shelly-as-component)
- Ogemray 25A: ShellyX-brikke, utviklet i samarbeid med Shelly, full Shelly-app-støtte — [shelly.com](https://www.shelly.com/products/ogemray-25a-smart-relay)
- IFA 2026: «Powered by Shelly» utvidet med Hörmann (Shelly X) og WeWash/BSH (Shelly Pro i WeWash Box) — [shelly.com IFA 2026](https://www.shelly.com/de/blogs/media-kit/shelly-auf-der-ifa-2026)
- Samarbeid med EcoFlow om co-brandede enheter — [shelly.com](https://www.shelly.com/blogs/media-center/shelly-group-expands-into-smart-energy-market-with-first-co-branded-devices-with-ecoflow)
- Egen brikke utviklet med Espressif (2023) — [cepro.com](https://www.cepro.com/news/allterco-shelly-microchip-development/116019/)

### Inferences
- Ampex trenger ikke en OEM-avtale. Den åpne lokale API-en gjør at Ampex-appen kan styre Shelly-moduler direkte. Hvis Ampex vil ha eget merke på maskinvaren, er ShellyX-veien åpen, men bare gjennom kontaktskjemaet, og vilkårene er ukjente.

### Gaps
- MOQ, priser og merkevilkår for ShellyX er ikke oppgitt offentlig. Om Shelly tillater ren hvitmerking (eget merke, egen app) er ukjent.
