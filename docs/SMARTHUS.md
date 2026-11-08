# Smarthus — billig maskinvare, god app

> 30.10: videre i `docs/DUKKEHUS_OG_ODM.md` — eget merke via kinesisk ODM, dukkehuset, Plejd-paritet.

Skrevet 25.10.2026. Idé og plan, ingenting er kodet. Startet som et sidespørsmål om
Plejd med Raspberry Pi og 3D-printede moduler i sikringsskapet.

## I én setning

Elektrikeren setter opp huset i Ampex mens han installerer, og kunden får en ferdig
oppsatt app som er bedre enn Plejd sin, på moduler som koster en tredjedel.

## Tre løfter (25.10, Tormod)

1. **Det bare funker.** Ingen oppsett for kunden, ingen spinner, bryterne virker som før.
2. **Det koster mindre enn Plejd.**
3. **Appen er bedre.**

Forsiden er nesten bare én bryter: **«Spar penger»**. På = varmekabler, bereder og lading
flyttes til de billigste timene uten at kunden merker det. Under står det hva kunden har
spart: «Du har spart 1 240 kr i år».

Tallet MÅ være ærlig: det kostnaden ville vært uten flytting (samme forbruk, opprinnelig
tidspunkt), minus faktisk kostnad. Shelly-modulene måler forbruket selv. Regn heller litt
for lavt enn for høyt; ett tall som ikke stemmer med strømregningen dreper tilliten.
Alt annet (3D-huset, scener, automasjoner) ligger ett trykk inn, ikke på forsiden.

## Hvorfor det kan virke

- **Appen er det som mangler hos de andre.** Plejd, og stort sett alle andre, har
  greie moduler og en app som ikke strekker til. Det er den delen vi kan.
- **Prisgapet finnes allerede, uten egen maskinvare.** Plejd DIM-02 koster rundt
  549 kr ([Bygghemma](https://www.bygghemma.se/hus-och-bygg/elmaterial-och-energi/smarta-hem-och-hemautomation/smarta-dimmers/smart-dimmer-plejd-dim-02-universal-tvakanals/p-1148408),
  SEK, oktober 2026). Shelly 1PM Mini Gen3 koster fra 167 kr
  ([Prisjakt](https://www.prisjakt.no/product.php?p=13628131)). «En tredjedel» kan vi
  altså nå med hyllevare. Egen maskinvare er ikke nødvendig for å teste ideen.
- **Ampex vet allerede hvordan huset ser ut.** Tegningen (rom fra `lib/rom-detekt.ts`,
  symboler fra `lib/symbol-detekt.ts`) og skannet sier hvilke rom som finnes og hvor
  lyspunktene sitter. Montøren skal bare koble «denne modulen» til «dette punktet».
  Det klarer ingen andre, og oppsettet er det smarthus er dårligst på i dag.

## Hvorfor IKKE egen maskinvare først

Se samtalen 25.10. Kort fortalt:

- Moduler i sikringsskapet krever stjernekabling. Norske hus er kablet i sløyfer, så
  modulen hører hjemme bak bryteren eller ved lampa, som Plejd og Shelly allerede gjør.
- Alt som monteres i en kundes anlegg må være CE-merket (lavspenning, EMC og radio).
  Den som setter navnet sitt på produktet er produsent og bærer ansvaret.
- 3D-printet plast består ikke glødetrådprøven og er ikke brannklassifisert. Den kan
  ikke brukes i skap eller bakboks.
- Det vanskelige er å dimme LED uten flimmer, ikke å slå av og på. Det er der Plejd
  har den egentlige kunnskapen sin.
- En Raspberry Pi blir et svakt punkt for hele huset. Lyset må virke når hjernen er nede.

## Hvor bredt: hva «helt smarthus» betyr her

Rekkefølgen er hva kunden sparer eller merker mest, ikke hva som er gøyest å bygge.

| Del | Med | Hvorfor |
|-----|-----|---------|
| Lys: av/på og dimming | Ja, først | Kjernen. Det Plejd selger. |
| Varme: varmekabler og ovner | Ja | Største strømforbruket i et norsk hus. |
| Strømpris og AMS (HAN-porten) | Ja | Styr varme og bereder etter spotpris. Sparte kroner er det beste salgsargumentet. |
| Varmtvannsbereder | Ja | Én modul, mye å spare med prisstyring. |
| Elbillader | Les og styr via produsentens API (Easee, Zaptec) | Ikke egen maskinvare. |
| Lekkasje- og bevegelsessensorer | Ja, senere | Lekkasje er det forsikringen bryr seg om. |
| Stikkontakter og persienner | Senere | Enkelt når resten virker. |
| Alarm, dørlås, kamera | Nei | Strengt regulert, ansvar ved innbrudd. Andre gjør det godt. |

## Skapet og punktene: to halvdeler

Ønsket (25.10): «alt kobles i én maskin før det går ut i lys og lignende». Det går for
halve huset:

- **Skapet: én boks for alt med egen kurs.** Varmekabler, bereder, elbillader og ofte
  ovner har egen kurs. De kan styres helt fra skapet uten å røre noe ute i huset, og
  boksen kan måle forbruket per kurs, slik at kunden ser hva som bruker strøm. Det er
  her pengene og prisstyringen er. Boksen bygges av CE-merkede DIN-moduler (Shelly
  Pro-serien, kontaktorer, strømtrafoer per kurs), ikke av en Pi og printet plast.
- **Punktene: lys ved bryteren.** Én lyskurs forsyner mange punkter i sløyfe, så en
  boks i skapet ville bare slå av hele kursen, altså lyset i flere rom samtidig. Hvert
  punkt styrt fra skapet krever stjernekabling, og det har man bare i nybygg (der KNX
  og Loxone allerede gjør det). I eksisterende hus sitter lysmodulene ute ved punktet.

Appen ser begge som ett hus. For kunden er det ingen forskjell på hvor modulen sitter.

## Arkitektur

- **Moduler:** Shelly (Gen3/Gen4) i første omgang. Lokalt API over wifi (HTTP og
  WebSocket RPC), Bluetooth for oppsett, CE-merket og solgt i Norge. Matter holdes
  åpent som vei til andre merker, men er ikke et krav for å starte.
- **Plejd:** Det finnes ikke noe offisielt API, bare omvendt konstruerte
  Bluetooth-integrasjoner ([hass_plejd](https://github.com/thomasloven/hass_plejd)
  m.fl.). Ikke noe å bygge et produkt på. Kunder som allerede har Plejd er ikke målgruppa.
- **Hjemme:** Appen snakker direkte med modulene på samme nett. Ingen sky.
- **Borte:** Krever noe som er hjemme hele tida. To veier:
  1. Shellys egen sky. Gratis og raskt, men da er vi avhengige av dem.
  2. En liten hub i huset (først en Pi i plastboks *utenfor* skapet, senere egen boks)
     som holder automasjonene og snakker ut via Supabase Realtime. Passer med regelen
     om at bare Supabase og R2 er tillatt som løpende kostnad.
  Start med 1, bytt til 2 når det er kunder.
- **Automasjoner bor i huben eller modulen, ikke i telefonen.** Shelly kan kjøre
  skript lokalt. Prisstyringen må virke selv om ingen har appen åpen.
- **Wifi er en reell grense.** 40–60 moduler på én forbrukerruter går dårlig. Må måles
  før vi lover et helt hus. Alternativet er Zigbee eller Thread med én koordinator.

## Kundeappen: huset i 3D, men rask først

Ønsket (25.10): en forbrukerapp på Tesla/Apple-nivå som slår Plejd sin app.

- **Huset i 3D fra vårt eget skann.** Det andre viser fram (Home Assistant med en
  håndtegnet 3D-plan) får vi gratis: elektrikeren skanner huset, modulene kobles til
  punktene der lampene faktisk sitter, og kunden trykker på lampa i sitt eget
  teksturerte hus. Plejd kan ikke kopiere dette uten hele skannestakken.
- **Fart foran pynt.** Under 100 ms fra trykk til lys, direkte mot modulen på hjemmenettet,
  ingen spinner. Det er det som gjør Tesla og Apple 10/10.
- **3D er utstillingsvinduet, ikke hverdagen.** Til daglig brukes bryter, widget på
  låseskjermen og Siri. Appen må ha widgets og Apple Home/Matter, ellers er den kul i ei uke.

## Brytere

- **Vanlige brytere virker som før.** Shelly-modulen har inngang for bryteren bak seg. Kunden
  beholder eller velger egen bryterdesign, og alt virker uten nett. Trykkbryter + Shelly-dimmer
  gir dimming ved å holde inne. Dette er Plejds egentlige styrke, og vi får den samme.
- **Trådløse batteribrytere** (Shelly BLU) der det ikke går kabel.
- **Veggpanel:** et billig nettbrett i ramme som kjører kundeappen, med 3D-huset som
  startskjerm i gangen. Shellys eget Wall Display er alternativet.

## To apper, ikke én

- **Montøren** setter opp i Ampex: legg modulen til, koble den til punktet på
  tegningen, gi den navn og rom. Det hører hjemme i appen han allerede bruker på jobb.
- **Kunden** får en egen, enkel app («Hjemme»?), ferdig oppsatt når elektrikeren går.
  Annen bruker, andre behov, samme backend. Dette er ikke montørappen med en ekstra fane.

## Faser med stoppunkt

1. **Hjemme hos far (et par uker).** Tre–fem Shelly-moduler, en enkel app som styrer
   dem lokalt: lys, dimming, én varmekabel med prisstyring.
   *Stopp hvis:* dimmingen med vanlige LED-pærer er så dårlig at det ikke kan selges.
2. **Montøroppsett i Ampex.** Koble moduler til punkter på tegningen. Kunden får
   appen ferdig. Prøves på én ekte installasjon (Glenn eller Aqila).
   *Stopp hvis:* oppsettet ikke er raskere enn med Plejds egen app.
3. **Borte-styring og hub.** Først når noen faktisk har det i huset sitt.
4. **Egen maskinvare.** Bare hvis salget viser at marginen på Shelly er for liten.
   Veien er en kinesisk ODM med ferdig CE-sertifiserte moduler (ofte ESP32), med vårt
   merke og vår fastvare. Ikke egen elektronikk, ikke 3D-print.

## Det som kan velte det

- **Brukerstøtte.** Smarthus gir mange «lyset virker ikke»-telefoner. Elektrikeren må
  kunne se modulenes status selv, ellers havner alt hos oss.
- **Avhengighet av Shelly.** Endrer de API-et eller prisene, har vi et problem. Matter
  og fase 4 er forsikringen.
- **Fokus.** Ampex har skann, læretid, tilbud og kontor gående. Dette bør vente til
  pilotene virker, eller være et rent helgeprosjekt i fase 1.

## Moduler mot Plejd (søk 26.10)

Plejd DIM-02: to utganger à 100 VA LED bakkant (50 VA forkant), Bluetooth-mesh, ikke noe
offisielt API ([plejd.com](https://plejd.com/products/DIM-02)). Ingen uavhengige flimmertester
funnet for noen av modulene under; det må testes på benken med egne pærer.

- **ubisys D1 (Tyskland, Zigbee 3.0):** 500 VA, både forkant og bakkant, måler R/L/C ved
  oppstart og velger dimmemåte selv, strømmåling, to 230 V-innganger for bryter, Zigbee-ruter.
  Passer i rund boks (DIN 49073). Teknisk bedre enn Plejd per kanal, men én kanal og dyrere.
  Godt støttet i Zigbee2MQTT. ([ubisys](https://www.ubisys.de/en/products/light-and-consumers/dimmer-d1/))
- **Namron Edge (norsk, Zigbee + Bluetooth for oppdatering):** vridimmer 5–250 W, passer
  System 55 og Elko One, selges via Elektroimportøren. Erstatter bryteren, ikke skjult modul.
- **Shelly Dimmer Gen4:** wifi, Bluetooth, Zigbee og Matter i samme modul, 150 W LED. Zigbee
  gjør at wifi-grensa kan unngås uten å bytte leverandør.
- **Casambi TED:** Bluetooth-mesh som Plejd, 100 W bakkant; bygges inn i mange armaturer
  (proff belysning). Samme lukkethet-spørsmål som Plejd, ikke undersøkt videre.
- **Sunricher:** ODM bak mange merker, Zigbee, virker med to ledere uten nøytral i EU-boks. Kandidat for
  egen merkevare i fase 4.

- **Kinesiske ODM-er, to sjikt:** Sunricher (Shenzhen, siden 2007) lager for store merker,
  oppgir CE/TÜV/ENEC/UL og har Zigbee-sertifiserte produkter i CSA-registeret
  ([CSA](https://csa-iot.org/member/shenzhen-sunricher-technology-limited/)). Tuya-sjiktet
  (Moes, Zemismart, Avatto) koster en brøkdel, men flimmer er rapportert ved justering
  ([test](https://smarthomescene.com/reviews/moes-zigbee-2-gang-dimmer-module-review/)) og
  CE-papirene er ofte tynne. Med vårt merke på blir VI produsent; da holder bare sjiktet som
  leverer full teknisk dokumentasjon. ENEC for Sunricher må bekreftes direkte.

**Retning:** Zigbee som husets nett (mesh som Plejd, åpent, flere leverandører), ubisys der
dimmingen må være perfekt, Shelly Gen4/Namron der pris eller bryterdesign avgjør.

## Åpne spørsmål

- Hva koster en Plejd-installasjon i et vanlig hus i dag, totalt med montasje? Det er
  tallet vi skal være en tredjedel av, ikke modulprisen.
- Hvor godt dimmer Shelly Dimmer Gen3/Gen4 vanlige LED-pærer fra Clas Ohlson og Jula?
## Inntekt: modulene, ikke abonnement (bestemt 25.10)

Appen er gratis og kjører på kundens telefon og nett, så driftskostnaden er nær null
(Supabase-meldinger for borte-styring, øre per hus i R2 for 3D-skannet). Pengene tjenes
på modulene.

- **Fallgruve i fase 1:** Shelly selges overalt for ~167 kr. Videresalg gir liten margin,
  og kunden kan kjøpe dem selv.
- **Pakke gjennom elektrikeren:** «smarthus kjøkken og stue, montert og satt opp» til
  fast pris. Modulprisen er en del av pakken, ikke en egen linje kunden sammenligner.
- **Ikke klistre eget merke på kjøpte Shelly:** den som setter navnet sitt på produktet er
  produsent etter EU-reglene (fullt CE-ansvar uten dokumentasjonen), pluss varemerket.
- **«Powered by Shelly»:** Shelly lisensierer ShellyX-brikken til andre merker (eks.
  [Ogemray 25A](https://us.shelly.com/products/ogemray-25a-smart-relay)). Fase 4 kan være ODM-modul
  med vårt merke og ShellyX inni: Shellys fastvare og API, ingen egen fastvare å vedlikeholde.
  Offentlig white-label-program ikke funnet 25.10. Spør Shelly Group direkte.
- **Eget merke (fase 4):** der marginen ligger, mellom ODM-pris og en utsalgspris godt
  under Plejd. 3D-huset og prisstyringen kan forbeholdes egne moduler. Shelly virker fortsatt.
