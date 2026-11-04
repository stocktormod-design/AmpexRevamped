# Asiatiske ODM-/merkeleverandører som én kilde for hele modulrekka (Sunricher, Tuya-ODM-er, Sonoff, Aqara) — per oktober 2026

Referanse: Plejd DIM-02 (2×100 VA LED, bakkant, Bluetooth-mesh, lukket). Svenske butikkpriser: 549 SEK inkl. mva hos Bygghemma og Hornbach (merk: SEK, ikke NOK; norsk pris ikke verifisert i denne runden) — [Bygghemma](https://www.bygghemma.se/hus-och-bygg/elmaterial-och-energi/smarta-hem-och-hemautomation/smarta-dimmers/smart-dimmer-plejd-dim-02-universal-tvakanals/p-1148408); [Hornbach](https://www.hornbach.se/s/Plejd). Plejd lister ikke pris selv — [Plejd](https://plejd.com/products/DIM-02).

## Modulpakning per leverandør (modeller, ytelse, priser)

### Takeaway
Sunricher er den eneste av de fire som dekker nesten hele rekka med standard Zigbee 3.0 (dimmer med/uten nøytral, DIN-dimmer uten nøytral, relé med måling, gulvvarmetermostat med valgbar NTC 10k/12k). Ingen av de fire leverer en AMS/HAN-leser; den må hentes fra nordiske aktører (Datek Eva, frient/Develco, Heimgard). Sonoff og Aqara mangler gulvvarmetermostat og DIN-dimmer; Tuya-ODM-ene dekker alt på papiret men gjennom mange ulike fabrikker og firmware.

### Cited Findings
**Sunricher (Shenzhen Sunricher Technology)**
- Produktserier: DALI, DMX512, KNX, 0/1-10V, BLE SIG Mesh, Casambi, Wirepas, Matter (LED-kontroller, fasedimmer, bro, relé, sensor, fjernkontroll), Zigbee (LED-kontroller, fasedimmer, termostat), 2.4G, RF/Wi-Fi. Har «OEM/ODM»-lenke uten detaljer — [sunricher.com](https://www.sunricher.com/)
- SR-ZG9040A(-S): 1-kanal Zigbee 3.0 dimmer, fungerer med 2-leder (uten nøytral) eller 3-leder, maks 400 W ved 230 VAC; bakkant fabrikkstandard, forkant som fabrikkvalg — [Domadoo](https://www.domadoo.fr/en/devices/5244-sunricher-2-wire-zigbee-30-dimmer-module.html); [manual](https://cdn.shopify.com/s/files/1/0688/8410/3413/files/SR-ZG9040A-S_Manual.pdf); [blakadder](https://zigbee.blakadder.com/Sunricher_SR-ZG9040A-S.html)
- SR-ZG9101SAC-HP: 1-kanal fasedimmer, 100–240 VAC, maks 400 W, krever nøytral, 45,5×45×20,3 mm, Touchlink uten koordinator — [Domadoo](https://www.domadoo.fr/en/devices/6421-sunricher-zigbee-30-in-wall-smart-dimmer-with-neutral.html?domid=13); [CSA](https://csa-iot.org/csa_product/ac-phase-cut-dimmer/); Z2M eksponerer bl.a. «minimum PWM» — [zigbee2mqtt SR-ZG9101SAC-HP-CLN](https://www.zigbee2mqtt.io/devices/SR-ZG9101SAC-HP-CLN.html)
- SR-ZG9101SAC-HP-SWITCH-2CH: 2-kanals relé med effekt/spenning/strøm/energi i Z2M; 1170 W — [zigbee2mqtt](https://www.zigbee2mqtt.io/devices/SR-ZG9101SAC-HP-SWITCH-2CH.html); [Galaxus](https://www.galaxus.ch/en/s4/product/sunricher-funk-schaltaktor-switch-actuator-actuator-54091790); [Unilight (pris)](https://unilight.com.pl/en/products/zigbee-3-0-in-wall-2-channel-switch-sr-zg9101sac-hp-switch-2ch-49013.html)
- SR-ZG9041A-D: innbyggingsdimmer uten nøytral 250 W; SR-ZG9042A-D: DIN-skinne-dimmer uten nøytral 400 W, €34,92 eks. mva / €43,30 inkl. (Hellas); bakkant/måling/sertifisering ikke oppgitt på siden — [Linkshop SR-ZG9042A-D](https://www.linkshop.gr/smarthome/sunricher-din-rail-zigbee-smart-dimmer-230v-ac-no-neutral-400w-sr-zg9042a-d.html?sl=en); [Linkshop SR-ZG9041A-D](https://www.linkshop.gr/smarthome/sunricher-zigbee-retrofit-smart-dimmer-230v-ac-no-neutral-250w-sr-zg9041a-d.html?sl=en)
- SR-ZG9041A-R: 1-kanal relémodul 5 A @240 VAC — [Domadoo](https://www.domadoo.fr/de/zigbee-geraete/8952-sunricher-zigbee-relaismodul-1-kanal-5-a-240-v-ac-10-a-2430-v-dc-sr-zg9041a-r.html?domid=27)
- SR-ZG9092A gulvvarmetermostat: 16 A relé (3680 W/230 V), ekstern gulvføler NTC valgbar 10k/12k/15k/50k/100k (B=3950, standard 10k), styring på rom/gulv/begge, IP21, 80×80×52 mm; ligger under «clearance» hos Domadoo (mulig utgående) — [zigbee2mqtt](https://zigbee2mqtt.io/devices/SR-ZG9092A.html); [Domadoo](https://www.domadoo.fr/en/clearance/6329-sunricher-zigbee-30-heating-thermostat.html)
- 2-kanals Sunricher-*dimmer* ble ikke funnet; SWITCH-2CH er relé — [zigbee2mqtt](https://www.zigbee2mqtt.io/devices/SR-ZG9101SAC-HP-SWITCH-2CH.html)

**Tuya-plattform-ODM-er (Moes, Tongou m.fl.)**
- Moes BHT-002/ZHT-002: 16 A-versjon for elektrisk gulvvarme med gulvføler; terminaler merket «NTC 10k 3950»; 5 A-versjon er for vannbåren — [SmartHomeScene](https://smarthomescene.com/reviews/moes-zigbee-smart-thermostat-bht-002/); [Domadoo](https://www.domadoo.fr/en/smart-home-thermostat/5779-moes-bht-002-white-zigbee-thermostat-for-electric-underfloor-heating.html). Z2M: kalibrering −30..30, sensorvalg IN/AL/OU, verdien kan ikke leses tilbake — [zigbee2mqtt](https://www.zigbee2mqtt.io/devices/BHT-002_BHT-006.html)
- Moes MS-105Z (1-kanal) / MS-105B (2-kanal) dimmer: krever nøytral, 2×100 W (2-kanal), 150 W (1-kanal); TS0601 `_TZE200_e3oitdyu`. No-neutral-varianten MS-104Z-L er en bryter, ikke dimmer, og er sluttenhet (ikke ruter) — [SmartHomeScene review](https://smarthomescene.com/reviews/moes-zigbee-2-gang-dimmer-module-review/); [blakadder](https://zigbee.blakadder.com/Moes_MS-105B.html); [SmartThings](https://community.smartthings.com/t/st-edge-beta-zigbee-dimmer-driver-supports-moes/236727)
- SmartHomeScene: lyset flimret noen ganger under justering i ZHA før det la seg (kontrollproblem, ikke dokumentert som bakkant-problem) — [SmartHomeScene](https://smarthomescene.com/reviews/moes-zigbee-2-gang-dimmer-module-review/)
- Generiske Tuya 2-kanals dimmere i Z2M (TS0052_2, TS0601_dimmer_4) eksponerer min/maks lysstyrke — [TS0052_2](https://www.zigbee2mqtt.io/devices/TS0052_2.html); [TS0601_dimmer_4](https://www.zigbee2mqtt.io/devices/TS0601_dimmer_4.html)
- Nærmeste funn for 2-kanal uten nøytral med bakkant: Candeo (UK-merke, ikke Tuya-merket) – uavhengig min/maks per kanal, min 5 W (anbefalt 10 W); produsentpåstand — via søkeresultat (Candeo-oppføring, URL ikke hentet; UVERIFISERT)
- Tongou TO-Q-SY1-JZT-63: DIN-skinne Zigbee-bryter 63 A, 1P+N, 90–280 VAC, måler spenning/strøm/effekt, Tuya + Z2M + ZHA — [Domadoo](https://www.domadoo.fr/en/smart-home-products/8156-tongou-chayo-zigbee-63a-din-rail-switch-power-consumption-monitoring-tuya-and-zigbee2mqtt.html)

**Sonoff (ITEAD / eWeLink)**
- MINI-ZBDIM (Zigbee 3.0): innbygging, 0–100 % bakkant, energimåling, Zigbee-ruter; LED ≤200 VA, glødelamper ≤400 W; 45×39,4×16,8 mm — [Proshop](https://www.proshop.de/Smart-Home/Sonoff-MINIZBDIM-ZigBee-Smart-Mini-Dimmer/3450865); [Vesternet](https://www.vesternet.com/blogs/smart-home/zigbee-sonoff-mini-extreme-dimmer-vs-matter-sonoff-mini-extreme-dimmer-switch-which-smart-dimmer-is-right-for-your-home)
- Orb-DIM / MINI-DIM-E og MINI-DIM (Matter over Wi-Fi, ESP32-C3): for- og bakkant (forkant kun <100 W), energimåling — [sonoff.tech](https://sonoff.tech/products/sonoff-orb-dim-matter-over-wifi-dimmer-wall-switch-mini-dim-e); [homescreen.pl](https://homescreen.pl/en/onoff-switches/129407-sonoff-mini-dim-matter-wifi-intelligent-mini-controller-dimmer-6979033600003.html)
- ZBMINIR2 relé: ~14,7 USD (1 stk) → ~11,4 USD (100 stk) hos TME — [TME](https://www.tme.com/in/en/katalog/p,sonoff_1752/)
- TRVZB/TRV-ZBT er radiatorventiler (34,90 USD) — ikke gulvvarme — [sonoff.tech](https://sonoff.tech/products/sonoff-trv-gen2-zigbee-thermostatic-radiator-valve-trv-zbt)

**Aqara**
- Dimmer Switch H2 EU (KD-R01D): Zigbee + Matter-over-Thread, bakkant standard (forkant valgbar), med/uten nøytral, System 55-ramme (ikke nordisk innsats); €49,99 inkl. mva — [Domadoo](https://www.domadoo.fr/en/smart-lighting/7655-aqara-zigbee-30-and-thread-aqara-dimmer-switch-h2-eu-gray.html?domid=27); [Tiloli](https://tiloli.com/products/interrupteur-variateur-h2-eu-1)
- Single Switch Module T1 (no neutral): relé 3–1250 W, Zigbee 3.0, CSA-sertifisert, effektmåling; full funksjon krever Aqara-hub — [CSA](https://csa-iot.org/csa_product/single-switch-module-t1-no-neutral/); [blakadder](https://zigbee.blakadder.com/Aqara_DLKZMK12LM.html); [blakadder review](https://blakadder.com/aqara-single-switch-no-neutral/)

**AMS/HAN** (ingen av de fire)
- Zigbee HAN-lesere for norske AMS-målere finnes fra Datek (Eva Meter Reader, Zigbee 3.0-sertifisert, Aidon/Kamstrup/Kaifa), frient/Develco EMI Norwegian HAN og Heimgard — [CSA Eva](https://csa-iot.org/csa_product/eva-meter-reader/); [Proshop frient](https://www.proshop.nl/Smart-Home/frient-EMI-Norwegian-HAN/3208920); [Heimgard FDV](https://www.elektroimportoren.no/docs/lib/94321-FDV-1.pdf). Rapport om −8 MW feilverdi på Kaifa med frient EMI — [Homey forum](https://community.homey.app/t/develco-products-app-control-your-home-and-make-it-safe-v2-1-0/28447?page=7)

### Inferences
- Dekningsmatrise (grovt): Sunricher ≈ 6/7 (mangler HAN; mulig også batteribrytere/gateway – katalogen nevner sensorer/fjernkontroller/broer men ikke verifisert modell for modell). Tuya-økosystemet ≈ 7/7 på papiret, men fra ulike fabrikker (Moes, Tongou …) — altså ikke reelt «én leverandør». Sonoff ≈ 4/7 (dimmer, relé, bryter, gateway; ingen gulvtermostat, ingen DIN-dimmer). Aqara ≈ 4/7, og bundet til egen hub for full funksjon.
- Ingen funnet 2-kanals dimmer uten nøytral fra disse som direkte matcher Plejd DIM-02. Nærmest: to Sunricher SR-ZG9040A eller én Moes MS-105B (krever nøytral).
- Pris: Sunricher DIN-dimmer ~€43 inkl. mva og Aqara H2 ~€50 i europeisk detalj vs Plejd 549 SEK (~€48). Gevinsten ligger ikke i sluttpris, men i åpenhet og ev. engrospris.

### Gaps
- FOB/Alibaba-engrospriser ble ikke hentet; ingen bekreftet Sunricher- eller Moes-engrospris.
- Sunricher batteri-fjernkontroller/veggbrytere og gateway ikke verifisert modell for modell.
- Sonoff SPM-Main (DIN med måling) — eksistens og spek ikke bekreftet i dette søket.
- Aqara gulvvarmetermostat og DIN-produkter ikke funnet for EU.

## Protokoll og åpenhet

### Takeaway
Sunricher og Aqara (T1) er CSA-registrerte standard-Zigbee-enheter og fungerer med Z2M/ZHA; Tuya TS0601-enheter bruker det proprietære 0xEF00-klusteret med «datapunkter» og trenger egne konvertere/quirks per fingeravtrykk.

### Cited Findings
- Sunricher er CSA-medlem; SR-ZG9101SAC-HP ligger i CSA-registeret — [CSA medlem](https://csa-iot.org/member/shenzhen-sunricher-technology-limited/); [CSA produkt](https://csa-iot.org/csa_product/ac-phase-cut-dimmer/). Sunricher viser Matter- og Thread-sertifikat på forsiden — [sunricher.com](https://www.sunricher.com/)
- Tuya TS0601 leverer verdier som nummererte datapunkter over 0xEF00 i stedet for standard ZCL-attributter, med ikke-standard skalering — [Homey forum](https://community.homey.app/t/app-pro-universal-tuya-zigbee-device-app-test/140352/269); quirk-matching feiler ved klusteravvik i ZHA — [HA forum](https://community.home-assistant.io/t/ts0601-type-radiator-valve/258765); enheter uten brukbare kanaler i openHAB — [openHAB](https://community.openhab.org/t/new-ugly-zigbee-device-humidity-temperature-clock-with-clusters-000a-time-and-ef00-tuya-ts0601-tze200-c7emyjom/131783)
- Moes BHT-002: sensorinnstillingen kan ikke leses tilbake i Z2M — [zigbee2mqtt](https://www.zigbee2mqtt.io/devices/BHT-002_BHT-006.html)
- Aqara Dimmer H2: Matter-over-Thread + Zigbee; avanserte funksjoner via Aqara-app og -hub — [Domadoo](https://www.domadoo.fr/en/smart-lighting/7655-aqara-zigbee-30-and-thread-aqara-dimmer-switch-h2-eu-gray.html?domid=27)
- Sonoff MINI-ZBDIM er Zigbee 3.0-ruter; Sonoff Matter-dimmere er Wi-Fi (ESP32-C3, OTA) — [Proshop](https://www.proshop.de/Smart-Home/Sonoff-MINIZBDIM-ZigBee-Smart-Mini-Dimmer/3450865); [homescreen.pl](https://homescreen.pl/en/onoff-switches/129407-sonoff-mini-dim-matter-wifi-intelligent-mini-controller-dimmer-6979033600003.html)

### Inferences
- For en egen app over standard koordinator er Sunricher det tryggeste: ett produsent-namespace i Z2M, standard klustre, CSA-sertifisert. Tuya-ruta betyr at hvert nytt parti kan komme med nytt `_TZE2xx`-fingeravtrykk som ikke støttes ennå.

### Gaps
- CSA-registeret ble ikke systematisk sjekket for hver Moes/Sonoff-modell. Lokal kontroll uten sky for Aqara uten Aqara-hub ikke testet.

## Dimmekvalitet

### Takeaway
Tynt, uavhengig belegg. Sunricher og Tuya-dimmere eksponerer min-nivå-kalibrering; flimmerdata finnes nesten ikke.

### Cited Findings
- Sunricher: «minimum PWM» kan settes i Z2M — [zigbee2mqtt](https://www.zigbee2mqtt.io/devices/SR-ZG9101SAC-HP-CLN.html); bakkant standard på SR-ZG9040A — [manual](https://cdn.shopify.com/s/files/1/0688/8410/3413/files/SR-ZG9040A-S_Manual.pdf)
- Moes MS-105B: kort flimring under justering i ZHA — [SmartHomeScene](https://smarthomescene.com/reviews/moes-zigbee-2-gang-dimmer-module-review/)
- Sonoff MINI-ZBDIM: markedsført «uten flimmer», LED ≤200 VA — [Proshop](https://www.proshop.de/Smart-Home/Sonoff-MINIZBDIM-ZigBee-Smart-Mini-Dimmer/3450865) (produsentpåstand)

### Gaps
- Ingen målte flimmer-/brummetester (f.eks. IEEE 1789, Pst LM) funnet for noen av modulene. Uten-nøytral-dimmere har typisk lekkasjestrøm som gir glødning i av-tilstand — ikke dokumentert for disse modellene.

## Sertifisering (CE, ENEC, TÜV, testrapporter)

### Takeaway
Ingen DoC-er eller testrapporter ble hentet. Sunricher oppgir ISO 9001 (TÜV) for fabrikken, ikke produkt-TÜV/ENEC. Ved relabel blir den som setter sitt navn på produktet juridisk produsent og eier CE-erklæringen.

### Cited Findings
- Sunricher: 201–300 ansatte, >45 patenter, TÜV ISO 9001:2015 (katalogoppføring, ikke verifisert) — [SourceReady](https://www.sourceready.com/supplier/detail/shenzhen-tenrich-control-technology-co-ltd) (merk: oppføringen kan gjelde et annet selskap — UVERIFISERT); CE ikke nevnt på forsiden — [sunricher.com](https://www.sunricher.com/)
- LVD 2014/35/EU art. 10: importør/distributør som setter utstyret på markedet under eget navn/varemerke regnes som produsent — [EUR-Lex 2014/35/EU](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0035) (samme prinsipp i RED 2014/53/EU)

### Gaps
- Ingen ENEC/TÜV-produktmerking funnet for noen modul. DoC-kvalitet ikke vurdert.

## ODM/OEM-vilkår

### Takeaway
Ingen av leverandørene publiserer MOQ eller enhetspris; alt er «ta kontakt». Sonoff har det tydeligste ODM-programmet (tre nivåer); Tuya selger OEM-app (bare logo/farger) og plattform; Sunricher har bare en OEM/ODM-lenke.

### Cited Findings
- Sonoff/eWeLink ODM: (1) kun firmware, (2) redesign av eksisterende plattform med egen industridesign, (3) ny produktutvikling. MOQ «bekreftes etter første gjennomgang»; sertifisering, pris og ledetid diskuteres etterpå; privat sky mulig — [odm.sonoff.tech](https://odm.sonoff.tech/)
- Tuya OEM-app: konfigureres på Tuya IoT-plattformen uten eget utviklerteam; endring av navn, logo, bakgrunnsfarge; pakkepris ikke offentlig — [Tuya support](https://support.tuya.com/en/help/_detail/K937bqqh3e6nv); [Tuya OEM app](https://www.tuya.com/platform/appdev/oemapp). OEM-app er billig men begrenset vs. SDK-app (leverandørblogg) — [dev.to/zediot](https://dev.to/zediot/tuya-sdk-app-migration-guide-2025-how-to-move-from-tuya-oem-app-to-a-custom-sdk-app-16jp)
- Sunricher: selvbeskrevet «first ODM/OEM choice of many global leading brands» — [HKTDC](https://www.hktdc.com/event/hklightingfairae/en/product/1Z03KUT07); OEM/ODM-lenke uten vilkår — [sunricher.com](https://www.sunricher.com/)

### Inferences
- Mange europeiske «merker» (f.eks. Sunricher-moduler under andre navn) er trolig relabel — men ikke verifisert her.
- For en egen app (Ampex) er Tuya-OEM-appen irrelevant; det som teller er standard Zigbee uten Tuya-sky.

### Gaps
- MOQ, FOB-pris, firmware-tilpasning og hvem som holder CE ved relabel — ingen konkrete tall fra noen leverandør. Krever direkte henvendelse.

## Egnethet for norske installasjoner (IT-nett, 60 mm boks)

### Takeaway
Ingen kilde bekrefter fase-fase/IT-nett-drift for noen av modulene; alle er spesifisert for 230 VAC L-N. Uten-nøytral-dimmerne (Sunricher SR-ZG9040A/9041A-D/9042A-D, Aqara H2) er de som teoretisk passer i IT-nett, men må verifiseres.

### Cited Findings
- Sunricher SR-ZG9040A og SR-ZG9042A-D fungerer uten nøytral ved 230 VAC — [Domadoo](https://www.domadoo.fr/en/devices/5244-sunricher-2-wire-zigbee-30-dimmer-module.html); [Linkshop](https://www.linkshop.gr/smarthome/sunricher-din-rail-zigbee-smart-dimmer-230v-ac-no-neutral-400w-sr-zg9042a-d.html?sl=en)
- Modulstørrelser ~45×45×20 mm (Sunricher), 45×39×17 mm (Sonoff) — [Domadoo](https://www.domadoo.fr/en/devices/6421-sunricher-zigbee-30-in-wall-smart-dimmer-with-neutral.html?domid=13); [Proshop](https://www.proshop.de/Smart-Home/Sonoff-MINIZBDIM-ZigBee-Smart-Mini-Dimmer/3450865)
- Aqara H2 er System 55-ramme, ikke nordisk innsats — [Domadoo](https://www.domadoo.fr/en/smart-lighting/7655-aqara-zigbee-30-and-thread-aqara-dimmer-switch-h2-eu-gray.html?domid=27)
- Tongou DIN-relé er 1P+N (enpolet brudd) — [Domadoo](https://www.domadoo.fr/en/smart-home-products/8156-tongou-chayo-zigbee-63a-din-rail-switch-power-consumption-monitoring-tuya-and-zigbee2mqtt.html)

### Inferences
- I IT-nett er «N» en fase; moduler med intern strømforsyning L–N vil normalt få 230 V L–L og kan virke, men en enpolet relé bryter bare én fase (relevant for gulvvarme der NEK 400 kan kreve topolet brudd). 16 A gulvtermostater fra Moes/Sunricher er trolig enpolede — ikke verifisert.
- Moduler på ~45 mm passer fysisk i 60 mm runde bokser bak bryter (antatt, ikke målt).

### Gaps
- Ingen produsent oppgir IT-nett eller fase-fase eksplisitt. Topolet brudd på gulvvarmetermostatene ikke bekreftet.
