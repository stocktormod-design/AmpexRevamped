# Komplett og billig modulserie med 16 A gulvtermostat (NTC) — research 26.10.2026

Kurs brukt: 1 EUR ≈ 11,7 NOK. Priser er utsalgspris inkl. mva hos EU-forhandler (mest domadoo.fr) per okt. 2026.
[UV] = uverifisert / kun én forhandlerkilde.

## Hovedfunn
1. **Sunricher er komplett likevel.** Tidligere notat sa «ingen DIN-relé» — feil nå: SR-ZGRM16-DIN4 (4×16 A, DIN, nullgjennomgangs-svitsjing, Green Power) finnes. Sunricher har dermed relé m/ måling, bakkantdimmer, 16 A gulvtermostat med VALGBAR NTC (10k/12k/15k/50k/100k), DIN-relé, trådløse brytere (også batterifrie Green Power). Standard ZCL-klustre (onOff, levelControl, hvacThermostat, metering/electricalMeasurement) + noen produsentattributter (manuf.code 0x1224). Selges også som Namron (Norge) og ROBB smarrt (NL) — samme maskinvare.
2. **Bosch Raumthermostat II 230V (BTH-RM230Z) er UTE:** potensialfritt relé, 3 A ohmsk / 1 A induktiv (Bosch-anleitung 8750002396). Kan bare styre kontaktor.
3. **Sonoff har fortsatt ingen 16 A gulvtermostat.** TP-WGZBA (Thermostat Core, 2026) har 10k NTC-inngang, men bare 3 A relé + tørrkontakt → vannbåren.
4. **Alle Tuya/Moes/Avatto gulvtermostater er TS0601 (0xEF00 DP)** i Z2M: Moes BHT-002, ZHT-S01, ZHT-S03, Avatto ZWT100, og alle «thermostat for electric floors» i tuya.ts. Ingen med standard hvacThermostat funnet.
5. **CTM Lyng (norsk) og Schneider/Elko Exxact** har Zigbee 3.0-termostater med valgbar føler (CTM: 10/12/15/47k; Schneider EKO07259/WDE002497: 2/10/12/15/33/47k), støttet i Z2M — men norsk prisnivå (CTM mTouch One fra ~959 kr).
6. Utenfor: SALUS (ingen 230 V gulvtermostat i Z2M, kun SR600-relé, FC600 fan-coil, AX10RF 24 V-mottaker), IKEA, Third Reality, frient/Develco (ingen gulvtermostat), Nobø SWT-IZ (finnes i Z2M som «floor heating control», ikke prissjekket), Micro Matic (kun ZB250-dimmer i Z2M).

## 1. Sunricher (anbefalt enkeltmerke)
| Modul | Modell | Pris | Merknad | Z2M |
|---|---|---|---|---|
| Innfelt relé 16 A m/ måling | SR-ZG9101SAC-HP-Switch(-B) | €21,99 (~257 kr) | 3680 W, 100–240 V, krever N. CSA-sertifisert | zigbee2mqtt.io/devices/ZG9101SAC-HP-Switch.html |
| 2-kanal relé m/ måling | SR-ZG9041A-2R / SR-ZG9098A-Light | [UV pris] | | /devices/SR-ZG9041A-2R.html |
| Dimmer bakkant 2-tråd (uten N) | SR-ZG9040A-S | €23,99 (~280 kr) | 400 W, 1,8 A, bakkant ⇒ transistor (MOSFET/IGBT), ikke TRIAC | /devices/SR-ZG9040A-S.html |
| Gulvtermostat 16 A | SR-ZG9092A (hvit) / -BL (sort) | €49,49–54,99 (~580–640 kr) | NTC 10k/12k/15k/50k/100k valgbar, rom/gulv/begge, måling, 80×80×52 mm, IP21. Hvit står under «clearance» — sort er ny vare. Polantall [UV] | /devices/SR-ZG9092A.html |
| DIN-relé 4×16 A | SR-ZGRM16-DIN4 | €55,79–61,99 (~180 kr/kanal) | Ingen måling. Ikke i Z2M-lista [UV, standard onOff-endepunkter → trolig generisk] | — |
| Trådløs bryter (batteri) | SR-ZG9001K2/K4-DIM | [UV ~€20–25] | | /devices/SR-ZG9001K2-DIM.html |
| Batterifri bryter (Green Power) | SR-ZGP2801K2/K4-DIM | [UV] | Kinetisk | /devices/SR-ZGP2801K4-DIM.html |
| Koordinator | — | — | Bruk egen (f.eks. Sonoff ZBDongle-E/-P) | |
CE-holder: Shenzhen Sunricher Technology (Namron/ROBB setter eget navn på white-label).

## 2. Mix: Sonoff + Sunricher-termostat (anbefalt i praksis)
Sonoff for relé (ZBMINIR2 ~104 kr), dimmer (MINI-ZBDIM ~255 kr: bakkant, 200 VA LED/400 W ohmsk, krever N), DIN 2-polet 32 A, brytere og dongle. Gulvtermostat = Sunricher SR-ZG9092A (~600 kr) eller identisk Namron 4512737/4512738 hos norsk grossist (el-nr, norsk FDV). Begge snakker standard Zigbee 3.0 mot samme koordinator.

## 3. CTM Lyng (norsk, dyrere)
mTouch One (16 A-kurs, last 2300 VA eller 3600 VA — dokumentene spriker [UV], føler 10/12/15/47k, Zigbee 3.0, fra ~959 kr på Prisjakt), mTouch Dim, mTouch Bryter, MBD-S (bevegelse + 16 A relé), NorLum Dim, mStikk, komfyrvakt. Ingen billig innfelt modul / DIN-relé. Produsentspesifikke attributter (Datek) men full Z2M-støtte.

## Maskinvarekvalitet mot Plejd-nivå
- Bakkant forutsetter transistor-utgang → Sunricher SR-ZG9040A-S og Sonoff MINI-ZBDIM er per definisjon ikke TRIAC. Tuya-dimmere (TS110E, Moes/Girier) er ofte TRIAC forkant [UV per modell] — unngå.
- Sunricher: nullgjennomgangs-svitsjing (DIN4), 5 års garanti (DIN4), CSA-sertifiserte Zigbee 3.0-produkter.
- Termostat: SR-ZG9092A krever 2,5 mm² over 13 A. Sjekk 1- vs 2-polet bryting for IT-nett før norsk standardvalg (Namron selger samme i Norge, så den er i markedet).
- Tuya/Moes-termostater: DP-protokoll (0xEF00), varierende _TZE-fingeravtrykk, CE ofte selgererklært — forkastet for termostat. Tuya innfelt-releer (TS0001/TS011F) bruker standard onOff/metering og er OK som fallback.

## Kilder
- Z2M-konvertere: github.com/Koenkk/zigbee-herdsman-converters/tree/master/src/devices (sunricher.ts l.2386 SR-ZG9092A med zigbeeModel ROB_200-040-0; floor_sensor_type 10k/15k/50k/100k/12k; moes.ts, avatto.ts, tuya.ts TS0601; ctm.ts; schneider_electric.ts temperatureSensorType)
- Bosch BTH-RM230Z: media3.bosch-home.com/Documents/22070530_AT_Bosch_Raumthermostat_II_230V_de_V002.pdf
- Sonoff TP-WGZBA: sonoff.tech/en-br/products/sonoff-thermostat-core-zigbee-smart-thermostat-tp-wgzba
- Sonoff MINI-ZBDIM: sonoff.tech/products/sonoff-mini-extreme-zigbee-dimmer-switch-mini-zbdim
- Sunricher termostat: domadoo.fr/en/clearance/6329-sunricher-zigbee-30-heating-thermostat.html, …/9569-sunricher-16a-zigbee-electric-heater-thermostat-black.html
- Sunricher relé: domadoo.fr/en/devices/6162-sunricher-16a-onoff-module-with-zigbee-30-power-meter.html
- Sunricher dimmer: domadoo.fr/en/devices/5244-sunricher-2-wire-zigbee-30-dimmer-module.html
- Sunricher DIN4: domadoo.fr/en/zigbee-devices/8947-sunricher-zigbee-din-rail-relay-module-4-channels-16a-100-230v-ac.html
- CTM mTouch One: prisjakt.no/s/mtouch/, onninen.no/en/ctm-lyng-mtouch-one-front-ph-op/p/CXS893
- Namron 4512737: elektroimportoren.no/docs/lib/4512737-FDV-1.pdf
- ROBB ROB_200-040-0: zigbee.blakadder.com/ROBB_ROB_200-040-0.html
