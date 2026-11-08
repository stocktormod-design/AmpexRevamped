# Namron as the only vendor: Zigbee lineup, prices and openness (as of 26 Oct 2026)

Method: I read the zigbee-herdsman-converters source `src/devices/namron.ts` (master, fetched 2026-10-26, 3787 lines). It is the code Zigbee2MQTT uses, so every model in it is supported by Z2M. I fetched every `namron-zigbee-*`, `namron-simplify-*` and `namron-matter-*` product page on namron.com. Each one shows an Artnr and a price "per 1 Stykk". I also checked Elektroimportøren FDV and user-guide PDFs, Prisjakt and godpris.

## 1. Full module table (type, model/art.no, el-nr, rating, protocol, NOK, Z2M)

### Takeaway
Namron covers in-box dimmers, relays (16 A with metering, 30 A, 1/2-pole), floor-heating thermostats with selectable NTC, panel-heater thermostats, battery switches, sensors, plugs and a gateway. Everything except the battery rotary switch is supported in Zigbee2MQTT. **There is no DIN-rail Zigbee module and no HAN/AMS reader.** Namron's article number is the same as the Norwegian el-nummer.

### Cited Findings
- **Art.no = el-nummer.** The Elektroimportøren FDV sheets list "El.nr 4512758 / EAN 7070990338165", "El.nr 4512761 / EAN 7070990336451" and "El-nr 4512733 / EAN 7070990332996". These are the same numbers Namron uses as Artnr. — [FDV 4512758](https://www.elektroimportoren.no/docs/lib/4512758-FDV-1.pdf), [FDV 4512761](https://www.elektroimportoren.no/docs/lib/4512761-FDV-1.pdf), [FDV 4512733](https://elektroimportoren.no/docs/lib/4512733-FDV-1.pdf)
- **Prices** below are Namron's own prices from namron.com, fetched 2026-10-26. They match Elektroimportøren's prices on Prisjakt (for example the Edge Dimmer 999, the 16A relay 559 and the 30A relay 999). They are presumably consumer prices including MVA (not stated on the page). — [namron.com product pages](https://www.namron.com/products/smarthus), [Prisjakt "namron zigbee"](https://www.prisjakt.no/s/namron-zigbee/)
- **Z2M support** is per `namron.ts`. — [zigbee-herdsman-converters namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)

The Z2M column means the model is in `namron.ts`.

**Dimmers (in-box / rotary)**

| Product | Art/El-nr | Rating | Protocol | NOK | Z2M |
|---|---|---|---|---|---|
| Zigbee LED dimmer 2.0 white / black | 4512750 / 4512751 | 3–200 W (FDV); the user guide says 300 W. These conflict | Zigbee 3.0, phase-cut | – / 719 | Yes, "Zigbee dimmer 2.0", `ota: true` |
| Zigbee Dimmer 2 400W | 4512760 | 400 W halogen / 200 W LED | Zigbee 3.0 | 539 | Yes, with power metering |
| Zigbee Tunable White dimmer 400W | 4512739 | 400 W | Zigbee | 649 | Yes, with CT and metering |
| Zigbee LED dimmer 250W (rotary, System 55 style) | 1402769 | LED 5–200 W, trailing edge | Zigbee | 729 | Yes |
| Zigbee LED dimmer 2-pole 250W polar white | 1402767 | 5–250 W, phase-cut | Zigbee | 699 | Yes |
| Zigbee LED dimmer TW 250W | 1402768 | 5–250 W | Zigbee | 899 | Yes |
| Zigbee dimmer 2-pole 400W (older) | 4512733 | 2-pole, LED 200 W | Zigbee | not on the current site | Yes |
| Zigbee Edge dimmer white / black (in-wall, display) | 4566700 / 4566701 | max 250 W, trailing edge | Zigbee 3.0 | 999 / 999 | Yes; exposes 0xA0xx manufacturer attributes |
| Zigbee Edge rotary dimmer white / black | 4512781 / 4512782 | ~250 W (unverified) | Zigbee | 999 / 1049 | Yes, same definition as Edge Dimmer |
| **Simplify dimmer LED 1-2 pole 300W** | 4512791 | LED 3–300 VA trailing / 3–100 VA leading, incandescent 10–300 VA | Zigbee 3.0 + BLE (BLE from factory) | 629 | Yes; metering, min/max brightness. `dimmer_mode` is read-only in Z2M |
| Zigbee smart plug dimmer 150W | 4512788 | 150 W | Zigbee | 369 | Yes |
| Matter/Thread rotary dimmer | 4512780 | LED 5–250 W, trailing edge | **Matter over Thread, not Zigbee** | 799 | No |
| Zigbee LED controller 1-ch / 5-ch (12–24 V CV) | 4512708 / 4512707 | – | Zigbee | 464 / 579 | Yes |

**Relays / on-off**

| Product | Art/El-nr | Rating | Protocol | NOK | Z2M |
|---|---|---|---|---|---|
| Zigbee relay 16A | 4512761 | 16 A resistive, 10 A continuous, 2.5 mm² | Zigbee 3.0, metering (W/V/A/kWh) | 559 | Yes |
| **Simplify relay 1-2 pole 16A** | 4512792 | LED 1500 VA; resistive 3500 W (1-pole) / 3000 W (2-pole) | Zigbee 3.0 + BLE | 699 | Yes, with metering, `ota: true` |
| Zigbee relay 30A | 4512785 | 30 A, max 32 A fuse, IP44, 2 NTC inputs + leak input | Zigbee 3.0, custom cluster 0x04E0 | 999 | Yes |
| Zigbee 2-channel 16A switch white (+ black kit 4512769, 89 kr) | 4512768 | 16 A, "all load types" | Zigbee 3.0 | 699 | Yes |
| Smart plug 16A white / black / IP44 | 4512766 / 4512767 / 4512789 | 16 A | Zigbee, metering | 370 / 370 / 449 | Yes |
| Thermostat plug 16A | 4512749 | 16 A | Zigbee | 579 | Yes |
| Zigbee power strip, 4 outlets + 2 USB | 4512735 | 16 A | Zigbee | 719 | Yes |

**Floor heating / panel heaters**

| Product | Art/El-nr | Rating | Sensor | NOK | Z2M |
|---|---|---|---|---|---|
| Zigbee thermostat 16A white / black | 4512758 / 4512759 | 16 A, **built-in switch 1-pole 16A** | NTC 10k (default), 12k, 15k, 22k, 33k, 47k | 949 / 999 | Yes |
| Zigbee Edge thermostat white / black | 4566702 / 4566703 (+ 4512783 / 4512784) | 16 A | NTC 10/12/15/22/33/47k. Heating, cooling, water and electric modes | 1199 / 1199 (4512784: 1509) | Yes |
| Zigbee Touch thermostat 16A 2.0 white / black | 4512752 / 4512753 | 16 A | floor/air | – / 1089 | Yes, **Tuya TS0601** (`_TZE204_p3lqqy2r`) |
| Touch thermostat (older) | 4512737 / 4512738 | 16 A | 10k/15k/50k/100k/12k | – | Yes |
| **Simplify thermostat 16A white / black** | 4512795 / 4512796 | 16 A / 3600 VA, IP21, System 55 | 10k sensor included; firmware supports 6.8k/10k/12k/15k/22k/33k/47k/100k and brand presets (CTM 47k, Elko 10k, Heatit 10k, Micromatic 12k, SG 12k, Schneider 10k) | 1099 / 1099 | Yes |
| Zigbee thermostat for panel heater PRO white / black | 4512776 / 4512777 | add-on module for Namron panel heaters | – | 400 / 400 | Yes |
| Namron panel heaters with built-in Zigbee 400–2000 W | 5401392–99 and others | – | – | 1799–2599 (Prisjakt) | Yes ("540139X") |

**Switches / remotes (battery)**

| Product | Art/El-nr | Protocol | NOK | Z2M |
|---|---|---|---|---|
| Simplify channel switch (6 buttons) white / black, CR2450 | 4512793 / 4512794 | Zigbee + BLE | 500 / 500 | Yes, "Simplify 6-button remote" |
| Simplify rotary switch white / black, CR2450 | 4512797 / 4512798 | (Zigbee/BLE, unverified) | 519 / 519 | **Not in namron.ts** |
| Older K2/K4/K8 switches, 8-channel switch, remotes | 4512701/02/03/19/21/28/29, 4512772/73, 4512705/06 | Zigbee | not on the current product list (likely discontinued, unverified) | Yes |

**Sensors**

| Product | Art/El-nr | NOK | Z2M |
|---|---|---|---|
| Motion sensor | 4512763 | 349 | Yes |
| Door/window sensor | 4512762 | 349 | Yes |
| Water leak sensor | 4512764 | 349 | Yes |
| Humidity/temperature sensor | 4512765 | 349 | Yes |
| Multisensor white / black | 4512770 / 4512771 | 500 / 500 | Yes |
| Stove guard (Zigbee) | 1402790 | – | Yes |

**Gateway**

| Product | Art/El-nr | NOK | Notes |
|---|---|---|---|
| Namron Simplify Smart Hub | 4512790 | 999 | Zigbee 3.0 + Bluetooth Mesh, WiFi/LAN, cloud OTA, "future Matter (bridge)" support |

- **No DIN-rail Zigbee module was found.** Namron sells only a DIN clip (4512740) that holds a 45×45.5×20 mm actuator on a 35 mm rail. — [FDV 4512740](https://www.elektroimportoren.no/docs/lib/4512740-FDV-1.pdf), [namron.com category "namron-din-monteringsklips-for-aktuator"](https://www.namron.com/products/smarthus)
- **No Namron HAN/AMS reader** turned up on namron.com or in searches. — [namron.com smarthus](https://www.namron.com/products/smarthus)
- **The 16A relay 4512761 is in-box or surface mounted**, not DIN. Max 16 A, 10 A continuous. — [Brukerveiledning 4512761](https://www.elektroimportoren.no/docs/lib/4512761-Brukerveiledning-5.pdf)
- **The 4512758 thermostat is single-pole.** The user guide says "Innebygd bryter 1-pol, 16A" (built-in 1-pole switch). Its NTC list is 10k standard plus 12, 15, 22, 33 and 47k. — [Brukerveiledning 4512758](https://www.elektroimportoren.no/docs/lib/4512758-Brukerveiledning-5.pdf)
- **The Edge thermostat (4566702)** supports NTC 10/12/15/22/33/47k and heating, cooling and water modes. — [Brukerveiledning 4566702](https://www.elektroimportoren.no/docs/lib/4566702-Brukerveiledning-5.pdf)
- **The Simplify thermostat** is 16 A / 3600 VA, IP21, fits System 55 frames, ships with a 10 kΩ sensor, and has BLE + Zigbee 3.0. — [FDV 4512795](https://www.elektroimportoren.no/docs/lib/4512795-FDV-1.pdf). The sensor lists (6.8k–100k plus brand presets) come from [namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)
- **The Simplify relay** breaks 1- or 2-pole: resistive 3500 W (1-pole) / 3000 W (2-pole), LED 1500 VA. — [FDV 4512792](https://www.elektroimportoren.no/docs/lib/4512792-FDV-1.pdf)
- **The Simplify dimmer** handles 1- and 2-pole connection, LED 3–300 VA trailing edge / 3–100 VA leading edge. — [FDV 4512791](https://www.elektroimportoren.no/docs/lib/4512791-FDV-1.pdf)
- **The 4512750 rating conflicts between sources.** The FDV says 3–200 W; the user guide says 300 W. — [FDV 4512750](https://www.elektroimportoren.no/docs/lib/4512750-FDV-1.pdf), [Brukerveiledning 4512750](https://www.elektroimportoren.no/docs/lib/4512750-Brukerveiledning-5.pdf)
- **Other retailer prices:** godpris lists 4512758 at 949, 4512759 at 999 and 4512753 at 1089. — [godpris](https://godpris.no/kategori/1641?b=Namron)
- **Prisjakt has clear outliers.** "Zigbee Motion Sensor" shows 3 699 while 4512763 shows 349, and "Touch Termostat 16A" shows 600. These look like mismatched listings; don't use them. — [Prisjakt](https://www.prisjakt.no/s/namron-zigbee/)

### Inferences
- **Cost per room point (list price incl. MVA, unverified):** a hidden dimmer costs about 540–730 kr, a 16 A relay with metering 559–699 kr, a floor thermostat 949–1199 kr, and a battery switch about 500 kr. Electricians buying at trade terms would pay less (not verified).
- **The Simplify generation is the current line for in-box modules.** It covers 1/2-pole dimmer, relay, thermostat, switches and hub. 1/2-pole support matters for Norwegian IT networks.
- **DIN rail is a gap.** A cabinet-based design ("skap for egne kurser") cannot be Namron-only for the cabinet part. The 30A relay (IP44, wall/surface) is the closest Namron substitute.

### Gaps
- No DIN-rail relay, metering or contactor module from Namron was found. This is not 100 % confirmed, because the site's category pages load products client-side through Algolia.
- Whether the Edge thermostat and the Simplify thermostat break 1-pole or 2-pole is not confirmed. Only 4512758 is confirmed 1-pole.
- I did not find the protocol for the Simplify rotary switch 4512797/98 or whether Z2M supports it.
- Prices from Clas Ohlson, Proshop and Komplett were not checked. Namron is mostly sold through Elektroimportøren.

## 2. Who manufactures Namron Zigbee devices

### Takeaway
Namron is Elektroimportøren's own private label, made in its "factories in China". The Zigbee code for the thermostats uses **Shenzhen Sunricher**'s Zigbee manufacturer code, which strongly suggests Sunricher is the OEM for most of the line. One thermostat (Touch 2.0) is a **Tuya** device.

### Cited Findings
- **Ownership:** "Namron was established in 2007 and is a company fully owned by Elektroimportøren … head office in Oslo, a central warehouse in Vestby, and factories in China." More than one third of Elektroimportøren's sales come from the Namron private label. — [Elektroimportøren Annual Report 2023](https://www.elektroimportoren.no/docs/Investor/Elektroimport%C3%B8ren-AS-Annual-Report-2023.pdf)
- **Sunricher:** `namron.ts` defines `sunricherManufacturer = {manufacturerCode: Zcl.ManufacturerCode.SHENZHEN_SUNRICHER_TECHNOLOGY_LTD}`. It uses that code for manufacturer-specific hvacThermostat attributes on the Namron thermostats. — [namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)
- **Fingerprints:** most models are matched on a plain `zigbeeModel` equal to the Namron article number (for example "4512761"). The LED controller 4512707 is matched on `modelID "DIM Lighting", manufacturerName "Namron As"`. — [namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)
- **Tuya:** the Touch thermostat 16A 2.0 (4512752/53) is `tuya.fingerprint("TS0601", ["_TZE204_p3lqqy2r"])` and uses Tuya datapoints. — [namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)
- **No outside confirmation:** blakadder and the FDV sheets list Namron as manufacturer and name no OEM. — [blakadder 4512704](https://zigbee.blakadder.com/Namron_4512704.html)

### Inferences
- Sunricher as OEM is a strong inference, not a confirmed fact. The Sunricher code appears only on the thermostat attributes. The Edge and Simplify custom clusters may be Sunricher or another ODM.

### Gaps
- No public statement from Namron or Sunricher names the OEM.

## 3. Openness: standard clusters, Tuya, OTA, Z2M/ZHA, cloud dependence

### Takeaway
Most devices use standard ZCL clusters (genOnOff, genLevelCtrl, haElectricalMeasurement, seMetering, hvacThermostat) plus some Namron/Sunricher manufacturer attributes. So they work with a standard coordinator without Namron's cloud. The exceptions are the Tuya Touch 2.0 thermostat and a few Simplify settings that can only be changed through the Simplify app or hub.

### Cited Findings
- **Standard clusters:** the 16A relay 4512761 binds `genOnOff`, `haElectricalMeasurement` and `seMetering` and exposes switch, power, current, voltage, energy and power_on_behavior. — [namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)
- **Z2M OTA:** 24 Namron definitions have `ota: true`, including 4512750 and 4512792. — [namron.ts](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/namron.ts)
- **Simplify dimmer `dimmer_mode` limit:** leading/trailing edge "Set via Namron Simplify Hub/app". Z2M cannot write it. — [Z2M 4512791](https://www.zigbee2mqtt.io/devices/4512791.html)
- **Simplify devices ship in Bluetooth mode.** The user switches to Zigbee by holding the Zigbee button. OTA runs over Bluetooth from the Simplify app, or over Zigbee through the Simplify Gateway. — [Brukerveiledning 4512791](https://www.elektroimportoren.no/docs/lib/4512791-Brukerveiledning-5.pdf)
- **Third-party hubs are supported:** the Simplify thermostat can be used via BLE, via the Simplify Gateway "(Og Athom Homey)" (and Athom Homey), or standalone. — [FDV 4512795](https://www.elektroimportoren.no/docs/lib/4512795-FDV-1.pdf)
- **The hub uses the cloud:** "OTA-oppdatering i skyen" (OTA updates in the cloud), WiFi/LAN, Zigbee 3.0 + BLE Mesh. — [namron.com Simplify Smart Hub](https://www.namron.com/products/namron-simplify-smart-hub)
- **Futurehome pushes Namron firmware:** its changelog shipped an OTA fix for Namron dimmers 4512750/4512751. — [Futurehome changelog](https://changelog.futurehome.no/hc/en-gb/articles/25289968863389-19-02-25-Zigbee-v2-11-11-Namron-dimmer-fixes-Smarthub)

### Inferences
- **A third-party app on a standard coordinator is viable.** It would need to implement Namron's manufacturer attributes for the thermostats (min/max level, sensor type, and similar) the way Z2M does.
- **Edge mode needs a one-time step.** Setting leading/trailing edge on the Simplify dimmer would need the Namron BLE app at commissioning. Trailing edge is the factory/typical mode (unverified).
- **Avoid the Tuya TS0601 thermostat (4512752/53)** if you want a pure ZCL fleet. Use 4512758, Edge or Simplify instead.

### Gaps
- I did not check ZHA quirk coverage separately.
- Whether Z2M OTA images exist for the Simplify devices, or OTA is only through the Namron app, is unclear.

## 4. Dimming quality / flicker

### Takeaway
I found no systematic flicker complaints about Namron dimmers. There is one report of LED-strip flicker below 45–50 % on an older Namron Zigbee dimmer, and Homey reports of 4512750 dropouts. The evidence is thin.

### Cited Findings
- **Low-level flicker:** a user saw an LED strip on a Namron Zigbee dimmer "flicker if I went below 45-50%", set the minimum to 50 %, and stressed matching dimming technology (both trailing edge). — [cavelab.dev](https://blog.cavelab.dev/2021/03/hue-compatible-zigbee-dimmer/)
- **Dropouts:** a Homey thread reports Namron Zigbee dimmer 2.0 units dropping out of the network even on the newest firmware. — [Homey community](https://community.homey.app/t/namron-zigbee-dimmer-2-0-dropping-out/157861)
- **Minimum load:** for 1402769 the guide says minimum load "may need to be increased to 10W". Namron sells a base-load accessory ("bunnlast"). — [Brukerveiledning 1402769](https://www.elektroimportoren.no/docs/lib/1402769-Brukerveiledning-5.pdf), [namron.com category namron-bunnlast](https://www.namron.com/products/smarthus)

### Inferences
- **The Simplify dimmer 4512791 looks strongest on paper:** 3 W minimum trailing edge, configurable min/max level, and 1/2-pole. No field reports were found.

### Gaps
- No flicker reports were found for 4512791, 4512733 or the Edge dimmer specifically. hjemmeautomasjon.no threads did not surface in search.

## 5. B2B / grossist / partner

### Takeaway
Namron products carry Norwegian el-numbers and EANs (so they should be in EFObasen). They are sold mainly through owner Elektroimportøren, which serves both electricians and consumers. I found no white-label or app-partner program.

### Cited Findings
- **Elektroimportøren's model:** it "targets both B2B and B2C customers" through a web shop and stores with "high share of professional, skilled expert workers". The same group runs the SpotOn installer platform. — [Annual Report 2023](https://www.elektroimportoren.no/docs/Investor/Elektroimport%C3%B8ren-AS-Annual-Report-2023.pdf)
- **El-nr and EAN on FDV sheets:** for example 4512791 → GTIN 7070990342599. — [FDV 4512791](https://www.elektroimportoren.no/docs/lib/4512791-FDV-1.pdf)
- **Other channels:** Elkjøp lists some Namron dimmers (for example "Namron LED dimmer Zigbee 200W"). — [Elkjøp bedrift](https://www.elkjop.no/bedrift/product/hjem-rengjoring-og-kjokkenutstyr/belysning-og-elektriske-artikler/lamper-og-belysning/strombrytere-dimmere-og-lysstyring/namron-led-dimmer-zigbee-200w/217199)
- **Existing integrators:** third-party platforms already integrate Namron (Futurehome pushes Namron OTA; Homey has the official "Namron Simplify" app). — [Futurehome changelog](https://changelog.futurehome.no/hc/en-gb/articles/34184620755869-23-02-26-Zigbee-v3-2-6), [Homey Namron Simplify](https://homey.app/en-us/app/com.namron.simplify/)

### Inferences
- **Buying is easy, a partnership is not.** Because Namron belongs to a retailer-wholesaler that competes with Onninen, Solar and Elektroskandia, electricians tied to those wholesalers may not get Namron on their normal terms. The practical route is an Elektroimportøren trade account.
- **A partner deal would go through Elektroimportøren/Namron directly**, possibly via SpotOn as the installer channel. This is speculative.

### Gaps
- I found no evidence that Onninen, Solar or Elektroskandia stock Namron.
- I found no published white-label, OEM or app-partner program. This needs a direct inquiry to Namron AS (Nedre Kalbakkvei 88, Oslo).
- Trade (installer) price levels were not found.
