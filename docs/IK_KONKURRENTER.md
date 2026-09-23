# Internkontroll: hva de andre elektro-IK-systemene er, og hvordan de ser ut

Skrevet 17. september 2026, fra åpne kilder (produktsider, App Store, Elsikkerhetsportalen).
Ingen av dem har offentlige demoer; UI-beskrivelsene er fra produkttekst og brukeranmeldelser.

## De som faktisk brukes i elektrobransjen

| System | Hvem | Hva det er | Pris | UI / app |
|---|---|---|---|---|
| **NHO Elektro Integrator / NIK** (m/ Håndverksdata) | Nelfo-medlemmer. Bransjestandarden. | Web-system, «menystyrt», ferdigskrevne prosedyrer, sjekklister, tabeller og maler for hele bransjen. Moduler: NIK (egen IK), IKK (IK hos kunde), KS (sjekklister/sluttkontroll), PBL, FDV, HR. Egne prosedyrer kan legges til. iAvvik: montør melder avvik fra mobil, kontoret behandler i NIK. | 8 710 kr/år per bruker (medlemspris). Kun medlemmer. | Web (Chrome/Firefox, nevner fortsatt IE). Integrator-app for iPad: **1,3 av 5** (23 anm.), «krasjer hele tiden», særlig ved avviksregistrering. |
| **ElektroUnion HMS-IK** | Kjedens medlemsbedrifter | «Bransjens trolig mest brukte IK-verktøy», DLE-verifisert for flere hundre bedrifter. Settes opp per bedrift; avviksrapport lagres rett i IK-systemet. | Medlemsfordel | Ingen offentlig beskrivelse av UI. |
| **AEK IKAPP Intern / Kontroll** (Andersen Elektro Kompetanse) | Elektrofirmaer, kontrollforetak | To apper: *Intern* (ledelse, ansatte, DLE-revisjon) og *Kontroll* (NEK 405-sjekklister, egenkontroll, rapporter, kundeavtaler). Avvik med automatisk e-post. Kobles til kurs (FSE, NEK 400/405, 5 sikre). | Ikke oppgitt | iPad/Android. **4,4 av 5** (14 anm.). Roses for «sammenhengen i oppbygningen»; klager på krasj og at ulagrede avvik går tapt. |
| **Devinco HMS/KS** (SpeedyCraft) | SpeedyCraft-kunder | Modul i ordresystemet: HMS-håndbok, internkontroll, SJA, risikokartlegging, avvik, endringsmelding, skjema, sjekklister, vernerunde. Montør har håndbok + sjekklister + avvik i appen, kontoret eier maler og kompetanseoversikt. | Tillegg til SpeedyCraft | Web + app. |
| **SmartDok HMS** | Bygg/anlegg, en del elektro | «HMS-systemet alle får til». Mobil først: SJA, RUH, HMS-håndbok, bildedok, avvik, forbedringsforslag. Skjemabygger, malbibliotek, pushvarsler ved endringer. | Abonnement | Selger seg på at tunge systemer ikke blir brukt. |
| **Kvalitetskontroll AS** | Bygg/anlegg | Prosedyrer «justert etter lovpålagte krav» med revisjonshistorikk og varsling til ansatte; sjekklister fra bransjemaler; avvik med bilde; SJA/risiko; befaring. | Abonnement | Web + app. |
| **EG Landax** | Større firmaer, ISO 9001 | Prosesskart (flytskjema) med oppgaver, risiko og utstyr hengt på; dokumentstyring med versjon og godkjenning; avvik; dashboard. | Enterprise | For stort for en elektrobedrift på 5–30. |

Andre generiske HMS-systemer (Simployer HMS-håndbok, Grønn Jobb, Avonova, KUBA, Compilo) er
HR-produkter uten det elektrofaglige (FSE, sluttkontroll, samsvar, DSB-registrering).

## Hvordan alle er bygd opp (fellesnevneren)

Alle sammen har den samme firedelingen, uansett leverandør:

1. **Håndbok / prosedyrer** — dokumenter i kapitler. Kapitlene følger enten
   internkontrollforskriften § 5 (som Ampex) eller en «HMS-håndbok»-mal
   (lover → mål og organisering → risiko og handlingsplan → rutiner → avvik →
   beredskap → revisjon → opplæring).
2. **Sjekklister / skjema** — sluttkontroll, NEK 405, vernerunde, SJA. Fylles av montør.
3. **Avvik** — meldes fra mobil med bilde, behandles på kontoret, lukkes. Dette er
   modulen ALLE har som egen inngang, og den montøren faktisk bruker.
4. **Opplæring / kompetanse** — hvem har FSE i år, førstehjelp, kurs. Liste per ansatt.

Ingen av dem har Ampex' mellomnivå (kapittel → punkt → rutine). De har kapittel → prosedyre
(ett dokument). Ingen har vedtak + versjon + lesebekreftelse per kapittel slik Ampex har;
Kvalitetskontroll har revisjonshistorikk og varsling, Landax har godkjenningsflyt.

## Hva DLE ser etter (det systemet må kunne vise fram)

Systemrevisjon minst hvert tredje år (hvert femte ved feilfrie anlegg), pluss 6–16
stikkprøver av utførte anlegg per år etter bedriftsstørrelse. De ber om:

- registrering i DSB-registeret med riktig faglig ansvarlig og virkeområde, og at faglig
  ansvarlig er i full stilling
- **årlig FSE-opplæring med deltakerliste** — den vanligste mangelen
- rutiner for ulykkesmelding, arbeidsmetode og verneutstyr, vedlikehold av verktøy/instrumenter
- rutiner for sluttkontroll, samsvarserklæring og overlevering til eier
- avvikssystem for feil oppdaget i eget arbeid og feil DLE finner
- at solgt materiell er lovlig omsatt

Avvik fra revisjonen kommer som forhåndsvarsel om vedtak; bedriften må svare skriftlig
med tiltak innen frist.

Elsikkerhetsportalens «oppskrift» er ti trinn: regelverk, eksisterende rutiner, mål,
risiko, handlingsplan, rutiner, avvik, oppgavefordeling, opplæring, årlig gjennomgang —
med HMS-kalender for planlagte aktiviteter som anbefalt del av systemet.

## Hva dette betyr for Ampex

**Der Ampex allerede er foran:** rutinene henger på lovkravet (14 kapitler med hjemmel),
vedtak med versjon, lesebekreftelse per versjon, gjennomgangsfrist som sier fra selv,
skjemaer knyttet til kapittelet, og alt i samme app som ordren. Ingen andre har det.
Integrator-appen har 1,3 stjerner; terskelen for «bedre app» er lav.

**Det de andre har som Ampex mangler i flata:**

1. **Avvik som egen inngang.** Alle konkurrentene har «Meld avvik» som første knapp
   for montør. Ampex har avviks-API i lib uten UI (se `docs/NAA.md`, «Funksjoner uten
   UI»). Bør inn på Meg/Hjem i montørappen og som liste under kapittel 4 på kontoret.
2. **Opplæringsregister.** «Hvem har FSE i år» er det DLE spør om først. Kapittel 7
   (Kompetanse) trenger en tabell per ansatt med kurs og dato, ikke bare en rutinetekst.
   Læretid-modellen (`lib/laeretid`) er nær.
3. **HMS-kalender.** Vernerunde, FSE-repetisjon, årlig gjennomgang, instrumentkalibrering
   som datoer i én liste. Ampex har fristen per kapittel; en samlet «neste» på Oversikt
   ville dekke det.
4. **Ferdig innhold som utgangspunkt.** NIK selger seg på at alt er ferdigskrevet. Ampex
   valgte bevisst tomme formål (17.09) fordi ferdige tekster blir en død perm. Mellomveien
   er *forslag til punkter* per kapittel (hintene i `lib/ik/skjelett.ts` er alt halvveis
   dit): «Kartlegging av farer» kan tilby «Arbeid i tavle», «Arbeid i høyden», «AUS»,
   «Graving» som ett-trykks punkter, uten tekst.

**UI-lærdom:** det ingen av dem gjør er å vise mer på én gang. De er menystyrte, én ting
per skjerm, og det som roses (IKAPP) er «sammenhengen i oppbygningen». Det som slaktes
(Integrator) er ustabilitet og tapt arbeid, ikke utseende. Drill-down-oppsettet i v2 er
riktig retning; det som teller etterpå er at ingenting går tapt (lagre ved hvert steg)
og at montørens tre handlinger (les rutine, fyll sjekkliste, meld avvik) er ett trykk unna.

## Kilder

- NHO Elektro: [Internkontroll (NIK)](https://www.nhoelektro.no/produkter-og-tjenester/integrator/internkontroll/),
  [NIK på Arbinn](https://arbinn.nho.no/Medlemsfordeler/nelfo/internkontroll-nik/),
  [Integrator-modulene](https://www.nhoelektro.no/produkter-og-tjenester/integrator/nelfo-integrator--en-av-mange-medlemsfordeler/),
  [NIK brukerlisens, pris](https://butikken.nhoelektro.no/visProdukt.asp?produktID=5249),
  [Integrator-appen på App Store](https://apps.apple.com/no/app/integrator/id1276656741)
- ElektroUnion: [HMS-IK](https://elektrounion.no/digitale-verktoy/hms-ik/)
- AEK: [aek.no](https://www.aek.no/), [ikapp.no på App Store](https://apps.apple.com/no/app/ikapp-no/id1422626485),
  [IKAPP Intern på Google Play](https://play.google.com/store/apps/details?id=no.ikapp.intern)
- Devinco: [HMS/KS](https://www.devinco.com/en/hms-ks/)
- SmartDok: [Brukervennlig HMS](https://smartdok.no/hms/brukervennlig-hms/)
- Kvalitetskontroll AS: [Funksjoner](https://www.kvalitetskontroll.no/funksjoner)
- EG Landax: [Oversikt](https://egsoftware.com/global/hseq-and-asset-management/eg-landax/overview)
- Elsikkerhetsportalen: [Oppskrift på internkontroll](https://elsikkerhetsportalen.no/hms/),
  [Internkontroll elektrovirksomheter](https://elsikkerhetsportalen.no/internkontroll/internkontroll-elektrovirksomheter/),
  [Tilsyn med elektrovirksomheter](https://elsikkerhetsportalen.no/dle/tilsyn-med-elektrovirksomheter/),
  [Internkontroll i virksomheter](https://elsikkerhetsportalen.no/internkontroll/internkontroll/)
- Svenn: [HMS-håndbok, 8 ting](https://svenn.com/blogg/guide-til-hms-handbok)
- Avonova: [HMS elektro](https://www.avonova.no/bransjesok/hms-elektro)

---

# Oppdatering 23. september: UI-studien — vis svaret før håndboka

**Skrevet 2026-09-23.** Bakgrunn: IK v2 (`desktop/src/ruter/InternkontrollV2.tsx`)
er ryddig, men Tormod: «roper ikke wow … gir ikke veldig ekstrem mening». Flata
er en kapittelliste man klikker seg nedover i. Den viser innholdet og lar
brukeren regne ut tilstanden selv.

Kilder er produktsider, hjelpesentre og App Store. Ingen innlogging. Utvalgte
skjermbilder ligger i `docs/ik-konkurrenter/`.

### Hovedfunnet

**Ingen i elektrobransjen viser et samlet svar på «er IK-en i orden?».** Alle
stopper ved en kapittelliste med et antall, eller en tabell. De beste
compliance-verktøyene internasjonalt (Vanta, Drata) viser aldri dokumentet
først. De viser svaret og neste handling, og håndboka ligger under det svaret.
Der ligger wow-faktoren, og det er ledig i vår bransje.

### Norske systemer for elektro

- **NHO Elektro/Nelfo NIK (Integrator, levert av Aceve).** Den bransjespesifikke
  referansen. Håndboka er en nummerert mappeliste («02 HMS i Bedrift ›
  10.000 HMS-målsetting») med antall per mappe og filterbrikkene «Arbeidsrelatert
  / Må bekreftes / Alle». Oransje ikon markerer trolig det som ikke er
  bekreftet. Avvik har TG2/TG3-brikke, ansvarlig og frist. Appen har 1,3 av 5
  i App Store, og montørene skriver at den krasjer på «Nytt avvik». Det er
  åpningen. `nik-app-appstore-3.jpg`, `-4.jpg`.
  https://apps.apple.com/no/app/integrator/id1276656741
- **Kvalitetskontroll (SmartCraft, integrert med ELinn og Cordel).** Forsida er
  et flisrutenett med rød tellebadge på Prosedyrer, som teller uleste. På nett er
  det en tett tabell med revisjonstidslinje («0: 09.11.18 · 1: 04.06.19») og en
  teller for lesebekreftelser. Purring skjer på SMS med direkte lenke.
  `kvalitetskontroll-*.{png,jpg}`. https://www.kvalitetskontroll.no/funksjoner/prosedyrer
- **Mentor HMS.** Mest dashbord. Håndbokflisa sier «lest 0 av 62» i stor skrift.
  Årshjul med tolv måneder og gjentakende oppgaver per tema.
  `mentor-arshjul-*.jpg`. https://support.mentorpluss.no/en/hjelp-hms/arshjul
- **Svenn.** Wow-en er tjenesten: eksperter skriver håndboka, chat med navngitt
  ekspert, årlig revisjon inkludert. Sjekklister har fremdriftsringer
  (OK / IR / FEIL). `svenn-sjekkliste-ok-ir-feil-fremdrift.png`.
- **SmartDok.** Håndboka er et rent, søkbart lesedokument med versjon og dato.
  AI oppsummerer ukens avvik. `smartdok-hms-handbok-ny.png`.
- **Simployer.** Mappemeny, «Handbooks AI» øverst, lesetid per artikkel og
  «verified»-blokker for lovpålagt tekst. `simployer-handbok-artikkel.png`.
- **Kuba (via Ahlsell), Devinco, Landax, Cordel KS|HMS, Gripr.** Tabeller,
  nummererte kapittellister og mockups. Devinco er i praksis det vi har i dag.
  Cordel viser bare illustrasjoner (fra 699 kr/mnd).

### Internasjonalt: mønstrene som gir «dette gir mening»

1. **Ett tall brutt ned i tellbare enheter** (Vanta Home, Drata Readiness):
   «14 controls complete / 78 total», «100 % Ready – You're good to go!». En
   enhet teller bare når ALT er oppfylt, og det gir ingen delpoeng.
   `vanta-help-home-2.png`, `drata-help-dashboard-6.png`, `drata-help-readiness-3.png`.
2. **Policylista har statusspalter** (Vanta Policies): samlet status, versjon
   (Approved/Draft/Not started), «Renew by», «Personnel acceptance 0/23» med
   ring. Standardsortering er «Recommended order», ikke nummer.
   `vanta-help-renew-policy-4.png`. Den beste enkeltreferansen.
3. **Årlig fornyelse er en frist med to knapper** (Vanta): «Update policy and
   renew» / «Renew without updates». Ved endring spør den om alle skal lese på
   nytt. `vanta-help-renew-policy-5.png`.
4. **Den ansattes egen lesekø** (Drata «My Drata», Vanta Onboarding): «0/20
   policies acknowledged», én om gangen med Previous/Next og «Acknowledge».
   `drata-help-ack-policies-3.png`, `-4.png`, `vanta-help-onboarding-tasks-2.png`.
5. **Ferskhetsmerke** (Notion Verified): hake, «Until 5. april» og eierens
   avatar. Når fristen går ut, forsvinner haken. `notion-help-verified-pages-1.webp`.
6. **Tellekort som filtre** (SafetyCulture Credentials, Secureframe): «5
   Expired · 1 Expiring soon · 24 Total», og hvert tall er et filter.
   `safetyculture-help-my-credentials-1.png`, `secureframe-cyber-dashboards-3.webp`.
7. **«Hva er neste»-kø** sortert etter frist (Vanta Tasks, Drata Task list,
   Linear My issues).

Ikke verifisert: Intelex, Cority, EcoOnline, Sitemate og Procore har bare
markedsføringssider.

### Hva vi tar

- Forsida svarer først: **«X av 14 kapitler i orden»**. Et kapittel er i orden
  når det er vedtatt, innenfor årsfristen og lest av alle. Ingen delpoeng.
- Under tallet står **neste-køen**: det som er forfalt eller forfaller, avvik
  over frist og FSE som går ut.
- Kapittellista får **faste statusspalter** i stedet for ett ord: vedtatt,
  gjennomgås innen, lest X/Y.
- Årlig gjennomgang blir **to knapper**: «Uendret — gjennomgått» og «Endre og
  vedta på nytt».
- Avvik og opplæring får **tellere som filtre**.
- Montørens **lesekø** hører hjemme i appen (egen jobb).

Vi lar ligge: flisrutenett (Mentor, Kvalitetskontroll), fargede dashbord med
kakediagram (Drata, Landax, Mentor). Det bryter med regel 9, hvit flate og
farge bare som semantikk, og Tormod har sagt «for mye å se på» om mer på
skjermen (IK v2, 17.09).
