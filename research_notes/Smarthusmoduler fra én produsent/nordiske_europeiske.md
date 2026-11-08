# Nordic and European smart-home module vendors as single-vendor sources (Norway, Oct 2026)

Scope note: about 20 tool calls were made. Search snippets were summarised by a tool model, and Norwegian retailer pages (elektroimportoren.no search, zigbee2mqtt vendor filter) did not render server-side, so **NOK prices are thin**. Statements marked **[UNVERIFIED]** come from the researcher's background knowledge and were not confirmed by a source fetched in this session.

## Plejd baseline: full lineup, prices, openness

### Takeaway
Plejd covers almost every module type from one vendor: 1- and 2-channel LED dimmers, a 1-10 V controller, relays, LED drivers, a thermostat, battery switches and a gateway. It has no DIN-rail metering, no AMS/HAN reader and no public API. Third-party access is limited to the cloud gateway partners (HomeKit, Google, Alexa, Homey) and community-written reverse-engineered BLE integrations.

### Cited Findings
- Current lineup on plejd.com: DIM-01, DIM-01-2P, DIM-02 (2-channel), VRI-01/02/03 (rotary dimmers), DAL-01 (DALI broadcast), REL-01-2P (16 A), REL-02 (2-channel relay), CTR-01 (1-10 V), EXT-01, LED-10-V2, LED-75-V2, JAL-01 (shutter), TRM-01 (thermostat), GWY-01 (gateway), WIN-01 (wireless switch module), WMS-01 (motion sensor), WPH-01 (push button), WRT-01 (rotary), SPD-01/SPR-01 (plugs), BAT-01 and more. The products page does not mention an API, Matter or Home Assistant. — [Plejd products](https://www.plejd.com/products)
- GWY-01 connects the mesh to the internet "allowing remote control and integration with third-party services". Listed partners are Google Home, Apple HomeKit, Alexa and Homey. Matter is not named. — [Plejd GWY-01](https://plejd.com/products/GWY-01)
- HomeKit support was added to GWY-01 in 2022, with no stated Matter plans. — [HomeKitNews 2022](https://homekitnews.com/2022/12/06/swedish-smart-home-ecosystem-plejd-gains-homekit-support/)
- No official API exists. Community Home Assistant integrations (hass_plejd, Plejd-for-HA, plejd2mqtt) talk BLE directly and log in with the Plejd app account, presumably to fetch mesh keys. — [oyvindwe/hass_plejd](https://github.com/oyvindwe/hass_plejd); [thomasloven/plejd2mqtt](https://hub.docker.com/r/thomasloven/plejd2mqtt); [MrE12345/Plejd-for-HA](https://github.com/MrE12345/Plejd-for-HA)
- Prices:
  - DIM-01: lowest 476 NOK on Prisjakt.no ([Prisjakt.no search "plejd bluetooth"](https://www.prisjakt.no/s/plejd-bluetooth/)).
  - DIM-01-2P: lowest 471 NOK ([Prisjakt.no](https://www.prisjakt.no/product.php?p=5873722)).
  - DIM-02: 549 SEK at Hornbach.se and Bygghemma.se; no NOK price found ([Bygghemma](https://www.bygghemma.se/hus-och-bygg/elmaterial-och-energi/smarta-hem-och-hemautomation/smarta-dimmers/smart-dimmer-plejd-dim-02-universal-tvakanals/p-1148408)).
  - DIM-01: 449 SEK at Bygghemma, but marked discontinued ("Utgått") at inet.se ([inet.se](https://www.inet.se/produkt/8309718/plejd-singeldimmer-dosdimmer)).
- Plejd DIM-02 has a Norwegian product file in EFObasen, so it sells through the Norwegian installer channel with an el-nummer. — [EFObasen file](https://efobasen.efo.no/API/Produktfiler/LastNed?id=1226013)
- Elektroimportøren lists "Plejd Vridimmer 1-2 pol" (300 W universal, art. 1400276), but the page showed no price. — [Elektroimportøren Plejd](https://www.elektroimportoren.no/plejd/)

### Inferences
- The DIM-01 might be being replaced by DIM-01-2P (a 2-pole version for the IT grid), given that inet.se marks DIM-01 as discontinued. Not confirmed.
- The gaps in Plejd's own lineup are DIN-rail per-circuit relays and metering, and an AMS/HAN reader. TRM-01 exists, but its sensor type and rating were not fetched.

### Gaps
- NOK prices for DIM-02, REL-01-2P, REL-02, CTR-01, WPH-01, LED-75-V2, GWY-01 and TRM-01. The Elektroimportøren and Proshop pages did not render prices.
- TRM-01 specs (NTC 10k or 12k, 16 A?) were not fetched.
- Whether Plejd has announced Matter by Oct 2026: none found.

## Namron (Norway)

### Takeaway
Namron has the broadest Zigbee 3.0 lineup aimed at Norway: dimmers (1-pole, 2-pole, 2.0, "Simplify" with metering), 16 A floor-heating thermostats with a 10k NTC floor sensor, remotes, and a 4-channel dimmer. Most of it is listed on zigbee2mqtt.io, and FDV documents are hosted by Elektroimportøren with el-numbers. It is the strongest open single-vendor candidate. Prices were not captured.

### Cited Findings
- Namron devices on zigbee2mqtt.io:
  - 4512791, "Simplify Zigbee dimmer (1/2-polet / Zigbee / BT)", reports power, voltage, current and energy ([z2m 4512791](https://www.zigbee2mqtt.io/devices/4512791.html)).
  - 4512708, Zigbee LED dimmer ([z2m 4512708](https://www.zigbee2mqtt.io/devices/4512708.html)).
  - 4512750, Zigbee dimmer 2.0 ([z2m 4512750](https://www.zigbee2mqtt.io/devices/4512750.html)).
  - 4512733, 2-pole 400 W dimmer ([z2m 4512733](https://www.zigbee2mqtt.io/devices/4512733.html)).
  - 4512726, 4-in-1 battery dimmer remote ([z2m 4512726](https://www.zigbee2mqtt.io/devices/4512726.html)).
  - 1402755 ([z2m 1402755](https://zigbee2mqtt.io/devices/1402755.html)).
  - 4512702 and 4512703, 1- and 4-channel dimmer remotes ([Blakadder 4512702](https://zigbee.blakadder.com/Namron_4512702.html)).
- 4512750 is "Namron Zigbee LED dimmer 2.0", El.nr 4512750, rated 3–200 W, phase-cut dimming, Zigbee 3.0 at 2.4 GHz. — [Elektroimportøren FDV 4512750](https://www.elektroimportoren.no/docs/lib/4512750-FDV-1.pdf)
- 4512737 is "Namron termostat touch Zigbee 16A", white, with floor/room sensing and a limiter. — [FDV 4512737](https://www.elektroimportoren.no/docs/lib/4512737-FDV-1.pdf)
- The Namron Edge thermostat (4512783) ships with a 10 kΩ floor sensor: "NTC, R25=10KΩ±1%@25 B25/50=3950K". — [FDV 4512783](https://www.elektroimportoren.no/docs/lib/4512783-FDV-1.pdf); [manual 4512783](https://elektroimportoren.no/docs/lib/4512783-Brukerveiledning-5.pdf)
- 4512791 being "Zigbee / BT" means some newer Namron devices are dual-protocol. — [z2m 4512791](https://www.zigbee2mqtt.io/devices/4512791.html)

### Inferences
- With el-numbers (45xxxxx) and Norwegian FDV on Elektroimportøren, Namron fits the Norwegian installer and FDV workflow directly.
- Coverage looks close to complete: dimmers, thermostats, remotes, and possibly relays and DIN modules. Relays, DIN modules and AMS/HAN were not confirmed this session.

### Gaps
- NOK prices. Elektroimportøren search did not render, and no prices appeared in results.
- **[UNVERIFIED]** Namron's Zigbee dimmers and remotes are widely believed to be Sunricher (Shenzhen) ODM products. Z2M device converters for Namron share Sunricher clusters. Not confirmed by a source here.
- Whether Namron sells a Zigbee DIN-rail relay with metering, a battery wall switch in an Elko frame, or an AMS/HAN reader.
- No flicker reports were collected.

## Heatit Controls / Thermo-Floor (Norway)

### Takeaway
Heatit is primarily Z-Wave: Z-TRM6 thermostat, Z-Dim2, Z-Relay, Z-Temp2. A small Zigbee line exists (Heatit Zig Dim, 250 W rotary, System 55), but no Zigbee thermostat or relay was found. A single-vendor lineup from Heatit would therefore mean Z-Wave, not Zigbee.

### Cited Findings
- Z-TRM6 is a Z-Wave 16 A floor-heating thermostat, priced around €90 at Domadoo (down from €120). — [Domadoo Z-TRM6](https://www.domadoo.fr/sv/smart-termostat/6780-heatit-controls-z-wave-termostat-for-elektrisk-uppvarmning-16a-z-trm6-svart-7071236018087.html); [Vesternet](https://vesternet.com/sv/products/heatit-z-trm6-electronic-thermostat)
- Z-Dim2 is a Z-Wave 250 W rotary dimmer. Heatit recommends a bypass at low loads. — [Vesternet Z-Dim2](https://www.vesternet.com/products/z-wave-heatit-z-dim-2-250w)
- Heatit Zig Dim is a Zigbee 3.0 rotary dimmer for 5–250 W LED with OTA, fits System 55 frames, and supports an external push button. It costs about €58.80 at Domadoo, is listed as Z2M/HA compatible, and was out of stock on the German page. — [Heatit Zig Dim datasheet](https://share.finqu.com/e9398c182f40ebd8d1a4471db1e3132fd1bfd769cccee288fbe864e41bed945a/heatit_zig-dim-data.pdf); [Domadoo](https://www.domadoo.fr/en/smart-lighting/6781-heatit-zigbee-250w-rotary-dimmer-switch-7071236016915.html?domid=27)
- Heatit maintains official Homey and SmartThings drivers. — [Homey app](https://homey.app/es-co/app/no.thermofloor); [SmartThings Edge driver](https://community.smartthings.com/t/edge-heatit-controls-official-edge-driver-v2-3-0/254142)

### Inferences
- Z-Wave is fully local and standardised (Z-Wave JS works with any certified device), so Heatit is open. But Z-Wave modules typically cost more than Zigbee ones, and the Zigbee side is too thin for one-vendor coverage.

### Gaps
- NOK prices.
- Whether a Heatit Zigbee thermostat exists by 2026.
- Heatit's ODM origin.

## Elko / Schneider Electric Wiser

### Takeaway
Elko sells Zigbee 3.0 Wiser micro modules and dimmers in Norwegian frames, through the installer channel. Some appear on zigbee2mqtt (Elko 316GLEDRF, LK FUGA Wiser 545D6102). Coverage of thermostats, DIN and metering was not established this session.

### Cited Findings
- ELKO 316GLEDRF is listed on zigbee2mqtt as a Zigbee in-wall smart dimmer. — [z2m 316GLEDRF](https://www.zigbee2mqtt.io/devices/316GLEDRF.html)
- LK FUGA Wiser dimmer 545D6102 is on z2m. 545D6115 is a socket outlet, not a dimmer. — [z2m 545D6102](https://www.zigbee2mqtt.io/devices/545D6102.html); [Blakadder 545D6115](https://zigbee.blakadder.com/Schneider_Electric_545D6115.html)
- The "Elko Multiwire micro module LED dimmer" is Zigbee 3.0 certified with the CSA and is controlled from the switch or the Wiser app. — [CSA listing](https://csa-iot.org/csa_product/elko-multiwire-micro-module-led-dimmer/)

### Gaps
- Whether the Wiser hub has a local API. **[UNVERIFIED]** Schneider's Wiser Home hub is cloud-first, and the HA integration is community-made.
- NOK prices, thermostat and DIN coverage, and whether Elko One frame variants are offered.

## Futurehome (Norway)

### Takeaway
Futurehome is a hub and app vendor with a documented local MQTT API (FIMP), not a full module maker.

### Cited Findings
- Local API over MQTT is in beta and needs Smarthub firmware 1.9 or later. It opens port 1884, uses credentials set in the app, and speaks FIMP (documented at github futurehomeno/fimp-api). Only Futurehome support can switch it off. — [Futurehome support](https://support.futurehome.no/hc/no/articles/360033256491-Local-API-access-over-MQTT-Beta)
- A community HA add-on builds on it. Its guide recommends blocking the hub's internet access so firmware updates do not break local functionality, and notes that an expired trial may require a factory reset to enable the Local API. — [home-assistant-futurehome install guide](https://source.netsyms.com/Mirrors/home-assistant-futurehome/src/branch/master/docs/installation.md)

### Inferences
- The local API works but is beta, subscription-entangled, and fragile across firmware updates. That is a weak foundation for a third-party app.

### Gaps
- Futurehome's own module lineup and prices. **[UNVERIFIED]** It has sold its own thermostat and HAN reader ("Futurehome HAN"), but most modules come from other brands.

## ubisys (Germany)

### Takeaway
ubisys makes premium, well-documented Zigbee 3.0 modules: the D1 universal dimmer, the D1-R DIN dimmer, the S1/S2 switches, and the H1 radiator thermostat. They come with public technical references. Pricing is high (€119 for the D1) and there is no Norwegian channel or el-nummer found.

### Cited Findings
- D1 universal dimmer (item 1045) costs €119 including VAT at the ubisys shop and 1,195 SEK at a Swedish reseller. — [ubisys D1](https://www.ubisys.de/en/products/light-and-consumers/dimmer-d1/); [Swedish reseller](https://nydemo-7838se.nyehandel.se/sv/products/universal-dimmer-d1)
- A 2018 folder lists the D1-R DIN-rail dimmer at €139 and the S1 at €99. These are old prices. — [ubisys folder 2018](https://ubisys.de/downloads/Folder_ubisys-Smart-Home_2018_EN-1.pdf)
- A full technical reference PDF is public. — [D1 technical reference](https://www.ubisys.de/downloads/ubisys-d1-technical-reference.pdf)

### Gaps
- Suitability for the IT grid (no neutral) was not established.
- No floor-heating thermostat with NTC: the H1 is a radiator valve.

## Casambi (Finland)

### Takeaway
Casambi is a BLE-mesh lighting platform licensed to OEM luminaire and driver makers. It is not a single-vendor home lineup, and API access is gated and reportedly paid.

### Cited Findings
- The developer API requires a key requested from Casambi. HA forum users report that paid tiers are coming, that the API lacks parity with the app, and that the Cloud API is described as a beta for building-management integrators. — [HA forum Casambi](https://community.home-assistant.io/t/casambi-ble-light-support/91068?page=8); [HA forum 2](https://community.home-assistant.io/t/casambi-and-home-assistant/722111)
- casambi-bt is an unofficial, reverse-engineered BLE client not associated with Casambi. — [PyPI casambi-bt](https://pypi.org/project/casambi-bt)

### Gaps
- Official API terms and pricing (developer.casambi.com was not fetched).

## Micro Matic / Nexa / others

### Gaps
- Not researched within the call budget. **[UNVERIFIED]** Nexa is a 433 MHz/Zigbee consumer brand sold at Clas Ohlson, and Micro Matic distributes in DK/NO. Neither was confirmed.

## Cross-vendor inferences
- Namron is the only vendor found with a Norway-specific Zigbee 3.0 lineup that is broadly listed on zigbee2mqtt.io, carries el-numbers and has Norwegian FDV. It is the most realistic one-vendor open alternative to Plejd. It still needs verification for relays, DIN modules, AMS/HAN and prices.
- Heatit gives full coverage only on Z-Wave.
- Elko Wiser is credible in the installer channel, but its openness is unclear.
- ubisys is open but expensive and has no Norwegian channel.
- Casambi and Plejd are both closed BLE ecosystems.
- No vendor was confirmed to cover AMS/HAN plus DIN metering plus dimmers plus thermostats all in one.
