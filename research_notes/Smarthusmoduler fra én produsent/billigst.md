# Billigste vei til en åpen modulrekke — oktober 2026

Søkt 26.10.2026. Mål: 50–200 kr per modul ved 100–1000 stk, åpen lokal styring, CE.
Sammenlign: Namron ca. 629 kr per dimmekanal, Plejd ca. 470–550 kr.

**Om tallene.** Alibaba-prisene er utstillingspriser hentet fra søkeutdrag. De er ikke
tilbud. Alibaba blokkerte direkte henting med captcha. Én side lot seg lese, og den viste
priser i NOK (84,73 kr = 8,90 USD), altså ca. **9,5 kr per USD**. Den kursen er brukt
under. Prisene er FOB/EXW, uten frakt, toll, håndtering og MVA. Regn +10–15 % for
frakt og håndtering til Norge, og 25 % MVA på toppen ved salg til privatkunde.
**[UVERIFISERT]** betyr at tallet bare står i et søkeutdrag, eller at det er mitt eget anslag.

---

## Kort svar

Ingen enkelt fabrikk leverer hele rekka billig *og* med standard Zigbee-klustre. De tre
veiene som faktisk virker, er disse:

1. **Sunricher direkte (én fabrikk, standard Zigbee 3.0, CSA-sertifisert, OEM/ODM).**
   Utstillingsprisene på Alibaba ligger på 85–190 kr per modul for relé og dimmer.
   Termostaten er trolig dyrere, men ingen fabrikkpris er funnet. Dette er det nærmeste
   vi kommer «én fabrikk, åpne klustre». Prisene må bekreftes med et RFQ.
2. **Sonoff Zigbee i hyllevare + en annen termostat.** Merkevare, og ITEAD har CE.
   Fungerer i Z2M. Butikkprisene er 100–285 kr, og distributørprisen er antakelig
   lavere. Sonoff har ingen 16 A gulvvarmetermostat.
3. **Tuya-ODM-miks fra flere fabrikker (Moes, Girier, Lonsonho, Tongou, Avatto).**
   Nominelt billigst, 40–230 kr. Men dimmerne er nesten alltid TRIAC (forkant), og
   termostatene bruker 0xEF00. Vi blir importør eller produsent med tynne CE-papirer.

Wi-Fi med åpen firmware (Athom, omflashet Tuya) faller utenfor som hovedvei. Athom har
verken dimmer, gulvtermostat eller 16 A DIN-relé. Omflashing av BK7231 i volum er
hobbyarbeid, og CE-erklæringen gjelder bare original firmware.

---

## 1. Sunricher direkte — én fabrikk, standard klustre

Shenzhen Sunricher Technology er CSA-medlem og har produkter i CSA-registeret. De
markedsfører seg som ODM/OEM ([CSA-medlem](https://csa-iot.org/member/shenzhen-sunricher-technology-limited/)).
De selger også direkte på Alibaba som «Custom Manufacturer»
([butikk](https://szsunricher.en.alibaba.com/)). Namron sine Zigbee-termostater bruker
Sunrichers produsentkode i Z2M, så Sunricher er trolig OEM bak Namron (se `namron.md`).

| Modul | Modell | Fabrikkpris (oppgitt) | ≈ kr | Kilde / status |
|---|---|---|---|---|
| 2-kanal innbygging, med måling | SR-ZG9101SAC-HP-SWITCH-2CH | 9,90 USD (10–29 stk), 8,90 USD (30+) | **85–94** | [Alibaba](https://www.alibaba.com/product-detail/Sunricher-Zigbee-2-Gang-AC-Push_1601803126147.html), lest 26.10: 94,25 kr / 84,73 kr, «CE Certified». Tittelen sier «push dim phase cut», mens Z2M eksponerer den som relé **[uklart om den dimmer]** |
| 1-kanal fasedimmer 400 W (TRIAC-tittel) | SR-ZG9101SAC-HP / «Triac Dimmer 400W» | 18 USD (20+) | **~170** | [Alibaba](https://www.alibaba.com/product-detail/Sunricher-Zigbee-3-0-Triac-Dimmer_60826989986.html), kun søkeutdrag **[UVERIFISERT]**. En annen oppføring av samme vare viser 1000 USD (plassholder) |
| 0–10 V/PWM-dimmer (for drivere) | SR-ZG9101FA-DIM | 9,90 / 8,90 USD | 85–94 | [Alibaba](https://www.alibaba.com/product-detail/Sunricher-ZigBee-to-0-10V-PWM_1601788604222.html), søkeutdrag **[UVERIFISERT]** |
| 2-leder dimmer (uten N), bakkant | SR-ZG9040A(-S) | ikke funnet | — | Butikkpris ca. €21–25 hos Domadoo (se `asiatiske_odm.md`) |
| DIN-dimmer uten N, 400 W | SR-ZG9042A-D | ikke funnet | — | Butikkpris €34,92 eks. mva ([Linkshop](https://www.linkshop.gr/smarthome/sunricher-din-rail-zigbee-smart-dimmer-230v-ac-no-neutral-400w-sr-zg9042a-d.html?sl=en)). [Alibaba-oppføring](https://french.alibaba.com/product-detail/Sunricher-ZigBee-Din-Rail-Smart-Dimmer-1601577213108.html) finnes, men prisen ble ikke lest |
| Gulvtermostat 16 A, NTC 10k/12k/15k… | SR-ZG9092A | ikke funnet | anslag 200–280 | Butikkpris €49,49–54,99 hos Domadoo ([Domadoo](https://www.domadoo.fr/en/clearance/6329-sunricher-zigbee-30-heating-thermostat.html?domid=8)). Ligger under «clearance» og kan være utgående. Fabrikkpris **[UVERIFISERT anslag]** |
| Matter-over-Thread-relé | SR-MT9041A-R | ikke funnet | — | Butikkpris €23,39–25,99 ([Domadoo](https://www.domadoo.fr/en/smart-home-products/8792-sunricher-module-relais-onoff-matter-thread-230v-sr-mt9041a-r.html)). Bare 4,3 A |
| Batteribryter / fjernkontroll | (SR-ZG90xx-serien) | ikke funnet | — | **[UVERIFISERT]** |
| 16 A DIN-relé med måling | — | ikke funnet | — | Hull. Ta Sonoff BASIC-ZB1GSP eller Tongou |

**Åpenhet:** Standard ZCL (genOnOff, genLevelCtrl, haElectricalMeasurement, seMetering,
hvacThermostat) pluss noen produsentattributter. Fungerer i Z2M uten sky
([Z2M SR-ZG9092A](https://zigbee2mqtt.io/devices/SR-ZG9092A.html)).
**CE:** Fabrikken holder testrapporter. Selger vi den under Sunricher-navn, er vi importør.
Setter vi Ampex-merke på, er vi produsent og må eie samsvarserklæringen og den tekniske
fila, også RED-DA/EN 18031 (se `norske_krav.md`).
**Risiko:** Prisene er utstillingspriser, og 8,90 USD for en målende 2-kanal er
mistenkelig lavt. MOQ for egen merking er ukjent. Termostaten kan være utgående. Det
finnes ingen egen 2-kanals bakkantdimmer.

---

## 2. Sonoff Zigbee (ITEAD) — merkevare, standard nok, ingen gulvtermostat

Prisene er fra Sonoffs egen nettbutikk ([sonoff.tech/products.json](https://sonoff.tech/products.json),
hentet 26.10, USD). Distributørprisen er ikke offentlig. Sonoff har et distributørprogram
med minimumskjøp ([become a distributor](https://sonoff.tech/en-us/pages/become-a-distributor)).
TME tar 11,37–11,41 USD netto for ZBMINIR2 ved 100 stk, altså *over* Sonoffs egen
butikkpris på 10,90 ([TME](https://www.tme.com/in/en/katalog/p,sonoff_1752/)).
Distributørrabatt på 20–35 % er **[UVERIFISERT anslag]**.

| Modul | Modell | Butikk USD | ≈ kr | Merknad |
|---|---|---|---|---|
| Dimmer, bakkant, med måling | MINI-ZBDIM | 26,90 | 255 | Z2M: standard light + måling i Sonoffs eget kluster ([sonoff.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/sonoff.ts)). LED ≤200 VA. Én kanal |
| Dimmer, veggbryter | MINI-ZBDIM-E (Orb) | 29,90 | 285 | Kun 220–240 V |
| Relé 10 A | ZBMINIR2 | 10,90 | **104** | Ruter, standard klustre |
| Relé 16 A med måling | MINI-ZB1GSP | 19,90 | **190** | «up to 16A» |
| 2-kanal uten N | MINI-ZB2GS-L | 21,90 (2-pk 39,90) | 190–210 | 8 A per kanal, 12 A totalt |
| DIN-relé 32 A, **topolet**, måling | BASIC-ZB1GSP | 19,90 | **190** | Topolet brudd passer IT-nett og varmekabel. Zigbee-ruter |
| Batteribryter | SNZB-01P | 16,90 | 160 | |
| Koordinator | Dongle-E / Dongle Max (PoE) | 24,90 / 42,90 | 237 / 410 | Dongle Max: CE/FCC/RoHS oppgitt |
| Gulvtermostat 16 A | — | — | — | **Finnes ikke.** Thermostat Core TP-WGZBA er 3 A, for vannbåren varme og kjeler |

**CE:** ITEAD er produsent med CE. Kjøper vi fra en EU-distributør, er vi distributør og
ikke produsent, så produsentansvaret blir lettest her. **Risiko:** Dimmeren koster over
200 kr i butikk. Merkevaren er synlig for kunden.

---

## 3. Tuya-ODM-er direkte — billigst, men blandet

Hvem som står bak merkene:
- **Moes** = Wenzhou Morning Electronics (egen fabrikk, merket fra 2017) ([CSA](https://csa-iot.org/member/wenzhou-morning-electronics-co-ltd/))
- **Tongou** = egen nettside, DIN-produsent ([tongou.com](https://www.tongou.com/))
- **Girier, Avatto, Zemismart, Lonsonho:** fabrikk ikke bekreftet **[UVERIFISERT]**

Klustre, sjekket i Z2M-kildekoden ([tuya.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/tuya.ts)):
- **Moes/Zemismart/Lonsonho-dimmere TS0601** bruker 0xEF00-datapunkter. Ikke standard.
- **Lonsonho QS-Zigbee-D02-TRIAC-LN/-L = TS110E** og **CSP051 = TS110F** bruker
  genOnOff/genLevelCtrl, men med Tuya-private attributter (0xF000, 0xFC02–FC04) og egen
  kommando `moveToLevelTuya`. Halvstandard, men ikke EF00.
- **Tongou TO-Q-SY1-JZT (DIN) = TS011F** har standard klustre, men måling «via polling».
  Den rapporterer ikke selv.
- **Relé TS0001/TS011F med måling** har standard klustre.
- **Alle Tuya-gulvtermostater** (Moes ZHT-002/BHT-002, Avatto ZWT198/ZWT100) er TS0601
  og bruker 0xEF00.

| Modul | Eksempel | Oppgitt pris | ≈ kr | Kilde |
|---|---|---|---|---|
| Dimmer 1/2-kanal (TS0601, EF00) | Girier / Moes / ZM-105B-MS | 5,99–9,50 USD; 8,90 @1000 | **57–90** | [Alibaba-søk](https://www.alibaba.com/showroom/zigbee-dimmer-module.html), [MIC ZM-105B](https://novanewenergy.en.made-in-china.com/product/kQarylodXAhb/China-Tuya-Zigbee-Dimmer-2-Gang-Switch-Module-in-Line-Box.html) **[UVERIFISERT]** |
| Dimmer TS110E (halvstandard), TRIAC | Lonsonho QS-Zigbee-D02-TRIAC-LN | 15,43–17,64 USD (MOQ 2) | 147–168 | [Alibaba](https://www.alibaba.com/product-detail/Zigbee-3-0-Dimmer-Module-1Gang_1600246111574.html) **[UVERIFISERT]** |
| Relé 16 A med måling | Tuya TS011F/TS0001-type | 5,40–5,70 USD (50–10 000), 3,98–4,28 (GS) | **38–54** | [Alibaba](https://www.alibaba.com/product-detail/3Gang-Tuya-Smart-Zigbee-16A-Light_1601536375650.html) **[UVERIFISERT]** |
| DIN 63 A med måling | Tongou TO-Q-SY1-JZT | 13,19–17,40 USD | 125–165 | [Alibaba](https://www.alibaba.com/product-detail/API-TUYA-Zigbee-smart-circuit-breaker_1600633680494.html). Butikk €16,72–18,32 ([Domadoo](https://www.domadoo.fr/en/smart-home-products/8156-tongou-chayo-zigbee-63a-din-rail-switch-power-consumption-monitoring-tuya-and-zigbee2mqtt.html)) |
| Gulvtermostat 16 A, NTC 10k (EF00) | Moes BHT-002, Hysen HY609, Shyugj T5E-ZG, Coolseer | 15–24 USD; 21–24 @500 | **143–228** | [Global Sources](https://www.globalsources.com/Floor-heater/16A-heating-1220147434p.htm), [Alibaba Shyugj](https://www.alibaba.com/product-detail/Best-Electronic-Heating-Zigbee-Tuya-Smart_1600913167800.html) **[UVERIFISERT]** |
| Batteri-scenebryter 4 knapper | Moes / Zemismart / Lerlink | 7,30–9,90 USD | 70–95 | [Zemismart GS](https://www.globalsources.com/Self-powered/Wireless-Switch-Zigbee-Scene-Switch-1218728042p.htm), [Nova MIC](https://novanewenergy.en.made-in-china.com/product/JXnEwDSHAFrd/China-Zigbee-12-Scene-Switch-4-Gang-Tuya-Wireless-Mechanical-Push-Button-Battery-Powered-Smart-Home-Automation-Scenario-Switch.html) **[UVERIFISERT]** |
| DIN-energimåler 1-fase med relé | Xinghao DAC2161C m.fl. | 23,85–25,85 USD | 225–245 | [Made-in-China](https://shanghailingrui.en.made-in-china.com/product/dOsAueXKlPrf/China-Model-No-Dac2161c-Tuya-Zigbee-Single-Phase-Smart-Wireless-Multi-Rate-DIN-Rail-Electricity-Meter.html) **[UVERIFISERT]** |
| Koordinator | — | — | — | Kjøp Sonoff/SMLIGHT. Tuya-gatewayer er skybundet |

**Risiko:**
- **Flimmer.** Billige Tuya-dimmere er nesten alltid **TRIAC = forkant**. Det er dårlig
  for LED og motsatt av det Plejd og Sunricher gjør. Ingen bakkant-Tuya-dimmer med pris
  ble funnet.
- **Fingeravtrykk.** Nye `_TZE2xx`-fingeravtrykk kan komme per parti og må da støttes på
  nytt.
- **CE.** Merket «CE Certified» på Alibaba er ofte en egenerklæring. RED-DA/EN 18031
  (gjeldende fra 01.08.2025) er sjelden dokumentert. Vi blir minst importør, og produsent
  dersom vi bruker eget merke.
- **Kvalitet.** Ingen dokumentasjon på relélevetid, krypping eller temperatur.

---

## Wi-Fi med åpen firmware — vurdert og lagt bort som hovedvei

**Athom** ([athom.tech](https://www.athom.tech/esphome), butikkpriser hentet 26.10, USD).
Ferdigflashet ESPHome eller Tasmota, med åpne konfigurasjoner på GitHub.

| Modul | USD | ≈ kr |
|---|---|---|
| Minirelé med effektmåling (10 A) | 11,90 | 113 |
| EU-veggbryter med og uten N | 12,79 | 122 |
| 2-kanals energimåler (strømtenger) | 29,40 | 280 |
| 6-kanals energimåler | 43,40 | 412 |
| Zigbee-gateway + BLE-proxy (ESP32) | 29,07 | 276 |
| Zigbee-USB-dongle | 13,21 | 125 |
| ESP-NOW-fjernkontroll | 15,75 | 150 |

Athom har **ingen** 230 V-dimmer, gulvtermostat eller 16 A DIN-relé. Releet er bare
10 A ([ESPHome-enhetsside](https://devices.esphome.io/devices/athom-mini-relay-rs01c3)).
Vi fant verken OEM-vilkår eller CE-dokumenter **[UVERIFISERT]**. Athom fungerer for
releer, men ikke som hele rekka.

**Omflashet Tuya BK7231 (OpenBeken):** Verktøyene finnes (cloudcutter, UART). Forum viser
at partier med samme brikkenavn oppfører seg ulikt, at pad-merkingen kan være feil og at
bootloaderen kan bli ødelagt
([elektroda](https://www.elektroda.com/rtvforum/topic4100454.html),
[OpenBeken](https://github.com/openshwprojects/OpenBK7231T_App/wiki/BK7231T)). Vi fant
ingen produksjonsflyt eller fabrikkflashing. Bytter vi firmware, gjelder ikke lenger
fabrikkens RED-erklæring for radio og cybersikkerhet. Da blir vi produsent. Dette egner
seg ikke i volum.

**Matter-over-Thread:** Billige kinesiske ODM-moduler med pris fant vi ikke. Det vi fant,
var Sunricher SR-MT9041A-R til €23–26 i butikk og europeiske merkevarer (Wago, Hager,
Warema) uten pris. Thread er ikke billigere enn Zigbee i dag **[UVERIFISERT for 1688]**.

**1688:** Vi fikk ingen treff på 1688 i søket. Prisene der er typisk 10–30 % under
Alibaba, men fabrikkene selger ofte ikke til utlandet **[UVERIFISERT]**.

**Shelly:** Distributørprisene er ikke offentlige. Konsernet omsatte for €149,7 mill. i
2025 ([Shelly](https://www.shelly.com/blogs/media-center/shelly-reports-2025-results-and-outlook-for-2026)),
men oppgir ingen snittpris. Butikkprisene ligger over Sonoff (se `shelly.md`). Siden
shellyy.it.com, som viser «5,85 USD», ser ut som en falsk butikk og er ignorert.

---

## Anbefalt kombinasjon (billigst og levedyktig)

| Funksjon | Valg | ≈ kr per stk (eks. mva, før frakt) |
|---|---|---|
| Dimmer, bakkant | Sunricher SR-ZG9040A eller SR-ZG9101SAC-HP fra fabrikk, ellers Sonoff MINI-ZBDIM | 170 (fabrikk, uverifisert) / 255 (Sonoff butikk) |
| Relé 16 A med måling | Sonoff MINI-ZB1GSP, eller Tuya TS011F hvis prisen må helt ned | 190 / 40–55 |
| DIN-relé med måling | Sonoff BASIC-ZB1GSP (topolet 32 A) | 190 |
| Gulvtermostat | Sunricher SR-ZG9092A (standard), eller Moes BHT-002 (EF00, men støttet i Z2M) | 200–280 (anslag) / 145–230 |
| Batteribryter | Sonoff SNZB-01P, eller Tuya 4-knapps | 160 / 70–95 |
| Koordinator | Sonoff Dongle Max (PoE) eller Dongle-E | 410 / 237 |

Med Sunricher-tilbud på oppgitt nivå havner relé og dimmer på **85–170 kr**, altså innenfor
målet. Termostaten blir trolig liggende på 200–280 kr. Det billigste vi har funnet for en
termostat med standard klustre, er Sunricher. Tuya er billigere, men bruker EF00.

## Neste steg
1. Send RFQ til Sunricher (Alibaba-butikk eller sunricher.com): SR-ZG9040A, SR-ZG9101SAC-HP,
   SWITCH-2CH, SR-ZG9092A og SR-ZG9042A-D ved 100/500/1000 stk. Be om MOQ for egen merking,
   CE-pakke (LVD, EMC, RED, EN 18031) og bekreftelse på bakkant.
2. Bestill prøver: 2 av hver Sunricher-modul, 2× Sonoff MINI-ZBDIM og 2× Lonsonho TS110E.
   Mål flimmer med mobilkamera eller flimmermåler på 3–4 vanlige LED-pærer.
3. Spør Sonoff om distributørpris for MINI-ZB1GSP, BASIC-ZB1GSP og MINI-ZBDIM ved 500 stk.
