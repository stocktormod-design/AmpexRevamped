# Norske tverrgående krav for smarthusmoduler (per oktober 2026)

Merknad: rundt 18 søk/hentinger. Mange norske kilder er forumtråder (byggebolig.no, shelly-forum.com). Det står merket der det gjelder. Påstander merket **[UVERIFISERT]** kommer fra bakgrunnskunnskap og fant ingen kilde i denne runden.

## 1. IT-nett (230 V fase–fase, uten N) og TN 400 V: nøytralkrav, «N på fase 2», topolede dimmere

### Takeaway
I et norsk 230 V IT-nett finnes det ingen nøytralleder. Moduler med «N»-klemme går likevel, så lenge N kobles til den andre fasen som en «virtuell nøytral», og spenningen over modulen da blir 230 V. Ingen offisiell Shelly-, NEK- eller DSB-tekst om dette ble funnet, bare praktikerråd fra forum. Den farlige feilen er å få en tredje fase eller ulik fase inn på SW/inngangsklemmer, for da står modulen på 400 V og ødelegges. Moduler uten nøytral (2-leder) trenger en minimumslast. Shelly-varianten krever en bypass under 20 W, og bypasset er tegnet med N.

### Cited Findings
- I Norge er vanlig nett IT, der ingen av faselederne er nøytral. Nyere installasjoner har ofte 400 V TN med 230 V-kurser som har N — [byggebolig.no-tråd «Shelly 2 dimmer L versus N»](https://www.byggebolig.no/el-installasjon-teknisk-installasjon/shelly-2-dimmer-l-versus-n) (forum, uformelt)
- I samme tråd: på 230 V IT er L og N i praksis ombyttbare. Å legge en ekte N (TN) på en vendbar plugg kalles «uheldig», og det advares mot mulig flimring på grunn av kapasitiv kobling. Andre i tråden bestrider flimmer-forklaringen — [byggebolig.no](https://www.byggebolig.no/el-installasjon-teknisk-installasjon/shelly-2-dimmer-l-versus-n)
- Svar på Shelly-forumet: Shelly kjører på 230 V, så det er «no issue to wire two phases with terminal L and N; L2 is considered as virtual neutral». Andre laster på samme kurs må da også bruke L2 som N, og en ventilspole på samme kurs kan feiltrigge SW-inngangen — [shelly-forum: 3 phase network without neutral](https://shelly-forum.com/thread/31323-how-to-connect-shelly-1-mini-gen-3-to-a-3-phase-network-without-neutral); [eldre tråd](https://shelly-forum.com/thread/4673-how-to-connect-to-a-3-phase-network-without-neutral)
- Shelly-forumets leksikon advarer: kommer en annen fase (L2/L3) inn på f.eks. SW, får Shelly 400 V, det blir kortslutning og enheten ødelegges. Det anbefaler å måle med topolet tester først — [shelly-forum lexikon 156](https://shelly-forum.com/lexikon/entry-pdf-export/156-einphasiger-elektroanschluss-der-shellys)
- Shelly Pro 3EM henter driftsspenning fra N. En norsk bruker konkluderte først med at den ikke kan brukes på IT. En annen løste det ved å bruke én fase som virtuell N og måle med to strømtrafoer — [shelly-forum Pro 3EM](https://shelly-forum.com/thread/32266-shelly-pro-3em)
- Shelly Bypass trengs for nøytralløse Shelly-enheter (Shelly 1L, Dimmer 2) når lasten er under 20 W ved 240 VAC — [Shelly Bypass dokumentasjon](https://www.shelly.com/de/blogs/documentation/shelly-bypass)
- Bypasset kobles parallelt over lasten, mellom svitsjet fase og N ved armaturen. På IT blir «N» da den andre fasen — [domadoo Shelly Bypass](https://www.domadoo.fr/no/accessoires-electriques/9949-shelly-bypass-for-shelly-1l2l-3800238070908.html)
- Shelly 1L nevnes som alternativ når nøytral mangler — [homeandsmart.de](https://www.homeandsmart.de/shelly-anleitung)
- Plejd DIM-01 har klemmene «N L 1 2» i produktarket, som tyder på at den trenger N (på IT: fase 2). Ark og nettside sier ingenting om minimumslast eller drift uten N. Maks 300 VA: 200 VA LED bakkant, 100 VA LED forkant, 300 W halogen — [Plejd DIM-01](https://plejd.com/products/DIM-01); [produktark](https://sekelskifte.com/cdn/shop/files/plejd_product_sheet_dim-01_en.pdf)

### Inferences
- Moduler som trenger N (de fleste Wi-Fi-, Zigbee- og Bluetooth-relé og -dimmere) virker elektrisk på IT når «N» = L2. Forutsetningen er at alle spenningsførende klemmer på modulen, inkludert bryterinngangene, får samme fasepar. Montøren må vite hvilken fase som er «N» i hver boks.
- Mer dokumentasjon vil gjøre det tryggere: produsenten bør skrive «egnet for 230 V IT (fase–fase)» i manualen. Norske merker (Namron, Heatit, Elko, Plejd) selger i dag til IT-markedet, og det er sannsynligvis derfor de er tryggere valg enn ODM-moduler som bare er dokumentert for 230 V L-N.
- 2-leder-moduler løser «ingen N i boksen», men får LED-problemer: gløding eller flimring ved lav last, og bypass/kondensator må på. Det gjør dem dårlige som standardvalg for LED-hus.
- SW-inngangene er bryterinnganger med nettspenning. Får en eksisterende bryterkurs i boksen en annen fase, ødelegges modulen. Det er et konkret installasjonsrisiko for montører.

### Gaps
- Ingen offisiell Shelly-, NEK 400- eller DSB-uttalelse om at N-klemmen kan kobles til fase 2 ble funnet. NEK 400 krever generelt at utstyr velges for nettsystemet (IT/TN) og at bryting skjer på riktige ledere. Topolet bryting på IT er et tema **[UVERIFISERT, sjekk NEK 400-4-46/5-53]**.
- Ingen produsentoppgitt minimumslast for Plejd DIM-01 eller Shelly Dimmer Gen3/Gen4 uten N.
- Ingen kilde for at Namron/Elko/Heatit-moduler eksplisitt er godkjent for IT. Trolig er de det, siden de selges i Norge **[UVERIFISERT]**.

## 2. Gulvvarmetermostater: NTC-verdier, 16 A, NEK 400-krav

### Takeaway
10 kΩ er blitt de facto standard i nye norske og nordiske termostater (Heatit, Namron). DEVI bruker 15 kΩ som standard. Gode termostater lar deg velge 6,8–100 kΩ for å passe gamle følere. NEK 400 krever jordfeilvern på maks 30 mA uten tidsforsinkelse for varmekabler. Unntaket er 100 mA når lekkasjestrømmen ellers gir driftsproblemer.

### Cited Findings
- Heatit Z-TRM6: gulvføler NTC 6,8/10/12/15/22/33/47/100 kΩ, fabrikkinnstilling 10 kΩ, 16 A, Z-Wave — [Heatit Z-TRM6 datablad](https://infrarot-fussboden.de/mediafiles/PDF/1754_1755_Heatit%20Z-TRM6-Datenblatt-EN.pdf); [robbshop PDF](https://www.robbshop.nl/media/7b/6e/49/1701934700/HEA_Z-TRM6_download_1.pdf)
- Eldre Heatit Z-TRM2fx: 10/12/15/22/33/47 kΩ, standard 10 kΩ — (samme søk, installatørmanual Z-TRM2fx, via [elektroimportoren-dokumenter](https://www.elektroimportoren.no/docs/lib/5430560-Produktblad-3.pdf))
- Namron Edge (4512783, 4566702, 4566703): leveres med 10 kΩ føler og støtter 10/12/15/33/47 kΩ — [Namron FDV 4512783](https://www.elektroimportoren.no/docs/lib/4512783-FDV-1.pdf); [4566702](https://www.elektroimportoren.no/docs/lib/4566702-FDV-1.pdf)
- Namron Touch Termostat 16 A (4512737): Zigbee 3.0, 220–240 VAC, gulv- og romføler med temperaturbegrenser. Følerverdien står ikke på arket — [Namron 4512737 FDV](https://www.elektroimportoren.no/docs/lib/4512737-FDV-1.pdf); [blakadder](https://zigbee.blakadder.com/Namron_4512737.html)
- DEVIreg Touch (Danfoss): gulvføler 6,8/10/12/15 (standard)/33/47 kΩ, kompatibel med andre produsenters NTC-følere — [Danfoss DEVIreg Touch, norsk](https://assets.danfoss.com/documents/latest/152708/AI164886471458no-NO0113.pdf)
- Wavin Sentio gulvføler: 10 kΩ NTC (B3977) — [Wavin datablad](https://mediahub.wavin.com/asset/7758d382-e022-452d-a570-ab7578d32001/Sentio_Sensor_Floor_DataSheet_NO_20260804.pdf)
- Elektroimportøren Comforttemp: NTC 10 kΩ — [elektroimportoren FDV 5410641](https://www.elektroimportoren.no/docs/lib/5410641-FDV-1.pdf)
- Brukte følere annonseres som «10/12/15 kΩ» eller «10/12/15/47 kΩ». Verdien står på følerens etikett — [finn.no](https://www.finn.no/411944383)
- NEK 400-4-41:2022 §415.1: jordfeilvern brukt som tilleggsbeskyttelse skal være ≤ 30 mA i AC-kurser. Tolkning av 753.415.1: tidsforsinkede jordfeilvern skal ikke brukes. Opptil 100 mA er tillatt hvis varmeenhetens lekkasjestrøm i normal drift gir driftsproblemer — [NEK tolkninger 2022-12-07](https://www.nek.no/wp-content/uploads/2022/12/NEK4002022TOL1_2022-12-07.pdf)
- Varmekabler og -folier skal alltid ha jordfeilvern på maks 30 mA — [SNL: varmekabel](https://snl.no/varmekabel); DEVI: «Jordfeilbryteren skal være på 30 mA» — [DEVIfoil-veiledning (EFObasen)](https://efobasen.efo.no/mime_root/279/DEVIfoil_installationsveiledning%20november%202020.pdf)
- Varmekabel skal brukes med egnet termostat for å hindre overoppheting. Ingen varmefolie under fast inventar (kalde soner, NEK 400-7-753). Folien skal ikke utsettes for over +80 °C — [Danfoss/DEVI-veiledning](https://assets.danfoss.com/documents/latest/187149/AN384935621519no-NO0101.pdf); [DEVIfoil](https://efobasen.efo.no/mime_root/279/DEVIfoil_installationsveiledning%20november%202020.pdf)
- Ved bytte av termostat kreves ofte en annen følerkarakteristikk. Å kompensere med serie- eller parallellmotstand er usikkert — [byggebolig.no](https://byggebolig.no/el-installasjon-teknisk-installasjon/svar-pa-'dumme'-elektrikersporsmal/860)

### Inferences
- I rehabilitering er føleren støpt inn og kan ikke byttes. En leverandør som skal fungere i Norge må derfor støtte minst 10/12/15/33/47 kΩ som valgbart. Heatit og Namron Edge gjør det. Mange billige Tuya-/ODM-termostater leveres med fast 10 kΩ **[UVERIFISERT, ikke sjekket i denne runden]**.
- 16 A (3600 W ved 230 V) er norsk standard for badegulv og stuegulv. Termostaten må ha 16 A resistiv last. På IT må den bryte begge faser (topolet), ellers ligger kabelen spenningssatt mot jord **[topolet krav UVERIFISERT; eneste kilde er et forum som mener NEK anbefaler, men ikke krever, topolet brudd for skjult varme: [byggebolig.no](https://byggebolig.no/el-installasjon-teknisk-installasjon/trenger-varmekabel-jord-pa-betong-gulv)]**.
- Temperaturbegrensning (gulvføler som maks-begrenser i romfølermodus) er et vanlig krav fra varmekabelprodusentene for tregulv. Namron oppgir «temperaturbegrenser».

### Gaps
- Nobø, Ebeco, Elko (Super TR) og Thermo-Floor: standard følerverdi ikke bekreftet i denne runden. Fra hukommelsen: Elko/Ebeco er ofte 10 kΩ, Nobø/eldre Glamox 33/47 kΩ **[UVERIFISERT, må sjekkes i FDV]**.
- Den nøyaktige ordlyden i NEK 400-7-753 om temperaturbegrensning og topolet bryting er ikke lest (standarden er betalt).

## 3. AMS/HAN-porten: lesere, protokoll, lokale API-er, priser

### Takeaway
Norske AMS-målere (Aidon, Kaifa/Nuri, Kamstrup) sender data på HAN-porten (RJ45, M-Bus fysisk lag) som DLMS/COSEM-meldinger, og porten må aktiveres hos nettselskapet. Til et åpent lokalt oppsett er AmsLeser.no (Pow-U/Pow-K, åpen AmsReader-firmware, MQTT og Home Assistant autodiscovery) det sterkeste valget. Tibber Pulse er skybasert og krever Tibber-abonnement for full verdi.

### Cited Findings
- Tibber Pulse: for AMS-målere med HAN-port (Aidon, Kaifa/Nuri, Kamstrup), leser opptil hvert annet sekund og sender over 2,4 GHz Wi-Fi til Tibber-appen. Krever at HAN er aktivert hos nettselskapet — [Futurehome support: Tibber Pulse](https://support.futurehome.no/hc/no/articles/360052072892-Tibber-Pulse); [Tibber butikk](https://tibber.com/no/store/produkt/pulse)
- Tek.no: Pulse gir mest verdi med Tibber-abonnement, trenger internett og Wi-Fi-dekning i sikringsskapet — [tek.no test](https://www.tek.no/test/i/rgAGx0/tibber-pulse)
- Futurehome henter Pulse-data fra Tibbers sky, ikke lokalt. Pulse-HAN kan ikke brukes av Futurehomes Strømkontroll. Noen AMS-målere gir ikke nok strøm, så USB-forsyning anbefales — [Futurehome support](https://support.futurehome.no/hc/en-no/articles/360052072892-Tibber-Pulse)
- Forumbruker: effektstyringen i Tibber og Futurehome fungerer bare med egen maskinvare — [Futurehome forum: HAN Device](https://forum.futurehome.io/t/han-device/5917)
- AmsLeser.no Pow-U (M-Bus-målere, ESP32): MQTT med SSL, Entso-E-priser, Home Assistant autodiscovery. Pris hos forhandler ca. 63,71 USD — [lectronz Pow-U](https://lectronz.com/products/102)
- Pow-K+: HAN-leser for Kamstrup Omnipower satt opp for «Data Push» — [lectronz Pow-K+](https://www.lectronz.com/products/99)
- Åpen firmware (AmsReader / AmsToMqttBridge, ESP8266/ESP32) publiserer DLMS- og DSMR-målerdata til MQTT og støtter IEC 62056-7-5 og IEC 62056-21 — [UtilitechAS/amsreader-firmware MQTT-wiki](https://github.com/UtilitechAS/amsreader-firmware/wiki/MQTT-configuration); [AmsToMqttBridge](https://github.com/stedy6/AmsToMqttBridge)
- Home Assistant-integrasjonen amshan dekoder norske HAN-data (MQTT DLMS NO) — [toreamun/amshan-homeassistant](https://github.com/toreamun/amshan-homeassistant)

### Inferences
- Har Ampex et eget app- eller hub-lag, er det AmsReader/MQTT-veien som gir lokal 2–10 s-effekt uten sky. Det trengs til effekttrinn-styring (kapasitetsledd i nettleien).
- Et Shelly-kompatibelt alternativ er Shelly Pro 3EM med strømtrafoer i stedet for HAN. Den trenger N (se §1) og måler ikke målerens egne verdier.

### Gaps
- Ikke bekreftet: Easee Equalizer (HAN-leser med lokal tilgang?), Heatit/Namron/Futurehome egne HAN-lesere (Z-Wave/Zigbee), Shelly-HAN-produkt (ingen funnet), dagens norske priser i NOK.
- Detaljer per målertype (OBIS-liste per 2,5 s / 10 s / time hos Aidon, Kaifa, Kamstrup) ikke hentet. Fra hukommelsen: Aidon/Kaifa sender liste 1 hvert 2,5 s, Kamstrup hvert 10 s **[UVERIFISERT]**.

## 4. Mesh-robusthet for 40–80 enheter: Wi-Fi, Zigbee 3.0, Thread/Matter, Bluetooth mesh; Matter-status

### Takeaway
Ved 40–80 noder fungerer både Zigbee og Thread godt når det finnes nok strømdrevne rutere. Silicon Labs' egen test (24–192 noder) viser at Thread holder lavest latens i store nett. Zigbee er nesten like god. Bluetooth mesh (som Plejd bruker) har lav median men lang hale ved store nett og større meldinger. Zigbee-koordinatorens grense for direkte barn (20–50 etter firmware) og «≥1 ruter per 5 enheter» er praktiske tommelfingerregler. Matter 1.5 (nov. 2025) la til kameraer, lukkinger og bedre energidata. Ingen 1.5-endringer for termostater ble bekreftet.

### Cited Findings
- Silicon Labs' multicast-test med 24/48/96/144/192 noder (leverandørens egen test, egne brikker): ved 24 noder nådde alle tre protokollene nesten alle noder under 100 ms. Ved 192 noder har Thread latens opp til ca. 100 ms, Zigbee mest rundt 80 ms med spredning til 130 ms, og Bluetooth mesh median rundt 60 ms med hale over 250 ms (alle 192 som releer, ingen optimalisering) — [Embedded Computing om benchmarken](https://embeddedcomputing.com/technology/iot/edge-computing/how-zigbee-thread-and-bluetooth-mesh-stack-up-in-performance-benchmarking); [Silicon Labs mesh performance](https://www.silabs.com/mesh-performance)
- Bluetooth mesh fungerer best med korte meldinger (≤ 11 B), særlig multicast. Thread skalerer best med større nyttelast — [eeNews Europe](https://cdn.eenewseurope.com/en/testing-zigbee-thread-and-bluetooth-for-mesh-network-performance/)
- Uavhengig studie (Universitetet i Bergen): Thread har lavere latens enn Bluetooth mesh, særlig med større nyttelast, men tilpasser seg sakte når nettet endrer seg — [arXiv 2201.03470](https://ar5iv.labs.arxiv.org/html/2201.03470)
- Z-Stack-koordinator: CC2531 har 20 direkte barn (5 med source routing). CC2652-klassen med Z-Stack 3.x har 50. Source routing forbedrer nett over 40 noder — [Koenkk Z-Stack firmware README](https://github.com/Koenkk/Z-Stack-firmware/blob/5a4456a53d7647fdaf9aeb053c6bfb11e21b8fc5/coordinator/README.md)
- Homey anbefaler minst én ruter per fem endeenheter og fraråder mer enn 100 Zigbee-enheter (deres egen anbefaling, ikke en hard grense) — [Homey: stabilt Zigbee-nett](https://support.homey.app/hc/en-us/articles/10374465562652-Creating-a-stable-Zigbee-network-with-Homey-Pro-Early-2023)
- Enkeltrapport fra Zigbee2MQTT: enheter falt ut rundt 100 enheter på en CC1352P-2-koordinator (anekdotisk) — [Z2M discourse](https://zigbee2mqtt.discourse.group/t/dealing-with-networks-larger-than-100-150/1930)
- Matter 1.5 kom i november 2025 etter 1.4.1/1.4.2, som handlet om test og verktøy. Nytt: kameraer (WebRTC), lukkinger (gardin, port, garasje), bedre energistyring, jordsensorer — [CSA-IoT](https://csa-iot.org/newsroom/matter-1-5-introduces-cameras-closures-and-enhanced-energy-management-capabilities/); [Silicon Labs](https://www.silabs.com/blog/matter-1-5-for-next-generation-smart-homes)
- Shelly Gen4 (CES 2025): Wi-Fi 6, Bluetooth, Zigbee og Matter over Wi-Fi. Thread er ikke annonsert. Gen3 får Matter via oppdatering — [Shelly media kit](https://www.shelly.com/blogs/media-kit/shelly-group-introduces-multiprotocol-connectivity-at-ces-2025); [matter-smarthome.de](https://matter-smarthome.de/en/products/shelly-gen-4-with-matter-now-available/); [smarthomeassistent.de](https://www.smarthomeassistent.de/shelly-gen4-relais-mit-zigbee-ab-sofort-erhaeltlich/)

### Inferences
- Med 40–80 Wi-Fi-moduler (Shelly) havner alt på hjemmeruteren. Mange forbrukerrutere sliter med 50+ klienter på 2,4 GHz. For et elektrikerinstallert hus er det et argument for et dedikert mesh (Zigbee/Thread) eller et Wi-Fi-tilgangspunkt for IoT **[UVERIFISERT, ingen måling hentet]**.
- I et elektrikerhus er nesten alle moduler strømdrevne (relé, dimmere, termostater) og blir rutere. Da oppfylles 1:5-regelen lett, og Zigbee og Thread er begge trygge ved 80 noder. Koordinatoren er flaskehalsen.
- Matter 1.4 (nov. 2024) la til energityper som varmepumpe, solcelle, batteri og vannvarmer. Termostater, dimmere og energimåling (Electrical Power/Energy Measurement) finnes fra 1.3/1.4 **[UVERIFISERT i denne runden, bakgrunnskunnskap]**. Norsk spesialbehov som gulvføler-kΩ-valg og effekttrinn-styring er ikke standardisert i Matter og må ligge i produsentens egne klynger eller app.
- Plejd bruker Bluetooth mesh med et lukket økosystem. Halen ved store nett er greie for lys, men API-tilgangen er begrenset **[UVERIFISERT]**.

### Gaps
- Ingen uavhengig felttest av 40–80 enheter i et norsk trehus (Zigbee mot Thread mot Plejd) ble funnet.
- Hvilke termostat- og dimmerforbedringer som eventuelt kom i Matter 1.5 er ikke bekreftet. Matter 1.6-status for 2026 er ikke funnet.

## 5. Regelverk for salg og egen merking i Norge/EØS

### Takeaway
Den som setter eget merke på en ODM-modul blir rettslig produsent. Det betyr CE etter LVD + EMC + RED (radiodirektivet dekker også LVD/EMC-målene), samsvarserklæring, teknisk fil og RED-cybersikkerhet (delegert forordning 2022/30, EN 18031-1/-2/-3) fra 1. august 2025. GPSR legger på krav om sporbarhet og risikovurdering. I Norge må importør eller produsent være medlem av et godkjent returselskap for EE-avfall (avfallsforskriften kap. 1). Bare et registrert elektroforetak (DSB) kan installere i fast installasjon.

### Cited Findings
- Delegert forordning (EU) 2022/30 aktiverer RED artikkel 3(3)(d) (nett), (e) (personvern) og (f) (svindel). Gjelder trådløst utstyr i omsetning fra 1. august 2025. Harmoniserte standarder: EN 18031-1/-2/-3:2024, publisert i EUT med begrensninger 28. (andre kilder: 30.) januar 2025 — [Wikipedia: RED](https://en.wikipedia.org/wiki/Radio_Equipment_Directive_(2014)); [QIMA](https://www.qima.com/blog/certification/how-red-shapes-cybersecurity-requirements-for-wireless-products)
- Begrensningene i EN 18031 gjelder passordhåndtering, foreldrekontroll og oppdateringsmekanismer. Følges ikke disse, eller brukes ikke standarden, kreves et teknisk kontrollorgan (notified body). Delene «rationale» og «guidance» gir ikke presumpsjon om samsvar — [spansk departement: veiledning EN 18031](https://digital.gob.es/content/dam/portal-mtdfp/avance-digital/telecomunicacion-e-infraestructuras-digitales/areas_interes/equipos-telecomunicacion/documents/Guia-aplicacion-EN-18031.pdf); [BSI FAQ](https://www.bsigroup.com/siteassets/pdf/en/products-and-services/bsi_radio_equipment_directive-cybersecurity_faq_flyer_a4_241014.pdf)
- Espressif har en egen veiledning for ESP32-produkter mot RED DA/EN 18031. Det er relevant, siden Shelly og mange ODM-er bruker ESP32 — [Espressif](https://developer.espressif.com/blog/2025/04/esp32-red-da-en18031-compliance-guide/)
- GPSR art. 13: en aktør som setter produktet på markedet under eget merke (white-label/ommerking) regnes som produsent. Det gjør også den som endrer et produkt vesentlig — [EU-kommisjonen GPSR-presentasjon](https://webgate.ec.europa.eu/safety/consumers/consumers_safety_gate/obligationsForBusinesses/documents/GPSR-Presentation-E-Academy.pdf)
- Produsentplikter i GPSR art. 9: teknisk dokumentasjon med intern risikoanalyse som oppbevares i 10 år, og merking med navn, varemerke, post- og e-postadresse. Produsent utenfor EU må ha en ansvarlig person i EU/EØS — [Eurofins](https://www.eurofins.com/consumer-product-testing/media-centre/news/know-the-obligations-of-manufacturers-under-the-gpsr/); [gpsr.one](https://gpsr.one/en)
- EE-avfall: avfallsforskriften kap. 1 gjennomfører WEEE. Alle produsenter og importører i Norge må være medlem av et returselskap godkjent av Miljødirektoratet, og medlemskapet finansierer innsamlingen — [Miljødirektoratet: EE-avfall](https://www.miljodirektoratet.no/ansvarsomrader/avfall/Returordninger-avfall/elektrisk-og-elektronisk-avfall-ee-avfall/); [ERP Norge](https://erp-recycling.org/no-no/vare-tjenester/avfallsstrommer/ee-produkter/)
- Endringer i kap. 1 fra 2023 (rapportering fra returselskapene m.m.) — [Statsforvalteren](https://www.statsforvalteren.no/siteassets/fm-oslo-og-viken/miljo-og-klima/avfall-og-gjenvinning/ee-avfall/endring-i-avfallsforskriften-kap.-1---23.03.23.pdf)
- Elektriske arbeider på fast installasjon: bare foretak i DSBs Elvirksomhetsregister med riktige arbeidsoppgaver og anleggstyper avkrysset (forskrift om elektroforetak og kvalifikasjonskrav, FOR-2013-06-19-739). Det er ulovlig å montere selv og så få en installatør til å koble til — [NHO Elektro: DSB registreringsplikt](https://nhoelektro.no/contentassets/ee1220d9c20945a684053f494cc4fef2/dsb-registreringsplikten-og-faglig-ansvarlig.pdf); [byggebolig.no: registreringer hos DSB](https://byggebolig.no/el-installasjon-pristilbud-betingelser/registreringer-hos-dsb) (forum)

### Inferences
- For en Ampex-merket modul fra Sunricher eller Tuya må Ampex selv (eller en EØS-importør) eie samsvarserklæringen. ODM-ens testrapporter (LVD EN 60669-2-1 for elektroniske brytere, EMC, radio EN 300 328, EN 18031-1) kan gjenbrukes, men den tekniske filen må ligge hos merkeeieren **[standardnumrene for brytere UVERIFISERT i denne runden]**.
- En ODM-modul uten dokumentert EN 18031-samsvar (særlig skybasert Tuya med standardpassord og uklar oppdateringsvei) er en reell risiko etter august 2025.
- ENEC (frivillig, f.eks. via Nemko) er ikke lovpålagt, men norske grossister og elektrikere forventer det ofte for installasjonsmateriell **[UVERIFISERT, ingen kilde hentet]**.
- Returselskaper i Norge for EE: Elretur, RENAS, ERP, EE-Retur m.fl. Medlemsavgift etter mengde **[navnelisten delvis UVERIFISERT; ERP bekreftet]**.
- Varer for fast installasjon selges i Norge typisk med en merknad om at de skal installeres av registrert elektroforetak. Plug-in-produkter faller utenfor.

### Gaps
- Den nøyaktige EUT-referansen for EN 18031-begrensningene, og om det har kommet nye versjoner i 2026, er ikke lest i primærkilde.
- DSB-krav til «elektrisk utstyr» (FEU, forskrift om elektrisk utstyr, som gjennomfører LVD i Norge) er ikke hentet. Det samme gjelder Nkom for RED i Norge.
- Cyber Resilience Act (CRA, rapporteringsplikt fra sept. 2026, full anvendelse des. 2027) er ikke undersøkt. Den er svært relevant for tilkoblede moduler **[UVERIFISERT datoer]**.

## 6. Installatørkanalen: el-nummer, FDV, grossist

### Takeaway
I praksis må alt som selges via elektrogrossist ha et 7-sifret el-nummer i EFObasen. Elektrikeren trenger FDV-dokumentasjon (bruksanvisning, samsvarserklæring) som lenkes fra EFObasen til installasjonens FDV-perm. Lite oppdatert offentlig informasjon om hva det koster å komme inn i EFObasen ble funnet.

### Cited Findings
- El-nummerregisteret (forløperen til EFObasen) er drevet av EFO. Konkurransetilsynet påla i 2000 EFO å gi ikke-medlemmer samme tilgang. I praksis måtte alle produkter som ble solgt gjennom grossist ha el-nummer. Nummeret har 7 siffer (2 for hovedgruppe, 3 for undergruppe) og følger produktet ved bytte av agent — [Konkurransetilsynet V2000-14](https://konkurransetilsynet.no/wp-content/uploads/2018/08/v2000-14.pdf)
- FDV-dokumenter for termostater og moduler (Namron, Heatit) ligger på grossist- og EFObasen-lenker per el-nummer, f.eks. — [elektroimportoren 4512737 FDV](https://www.elektroimportoren.no/docs/lib/4512737-FDV-1.pdf); [DEVIfoil-PDF på efobasen.efo.no](https://efobasen.efo.no/mime_root/279/DEVIfoil_installationsveiledning%20november%202020.pdf)

### Inferences
- Shelly, Sunricher og Tuya-ODM-er uten norsk agent mangler ofte el-nummer. Det stenger dem ute fra elektrikerens vanlige innkjøp, kalkyle og FDV-flyt. Namron, Heatit, Elko og Plejd har el-nummer og norske FDV-er **[at de har el-nummer er sannsynlig ut fra FDV-lenker per nummer, ikke sjekket for hver modell]**.
- EFObasen-vilkår (jf. prosjektnotat om §2/§7) og kostnad for registrering bør sjekkes direkte med EFO.

### Gaps
- Gjeldende prosess og pris for å registrere en leverandør i EFObasen i 2026 er ikke funnet.
- Grossistenes (Solar, Onninen, Ahlsell, Elektroskandia) krav til nye leverandører (ENEC, norsk FDV, garanti) er ikke funnet.
