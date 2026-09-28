# Læretid i Ampex — dokumentasjon, verifisering og kontorflate

Skrevet 16.09.2026. Planlagt i sin helhet før noe er kodet. Ingenting i denne
fila er implementert ennå.

## I én setning

Lærlingen skriver dokumentasjonen sin i Ampex ved å bli spurt ut om dagen sin,
ikke ved å få den skrevet for seg, og opplæringskontoret får for første gang et
tall som sier hvem som kommer til å stryke mens det fortsatt er tid igjen.

## Hvorfor dette og ikke noe annet

Ampex vet allerede hva lærlingen gjorde i dag. Ordre, timer, materiell, skjema,
tegninger, signaturer. Ingen annen lærlingapp har den konteksten, og det er hele
grunnlaget: spørsmålene kan handle om akkurat den jobben, og kontoret kan få
vite at det ligger en solcellejobb på torsdag som dekker det ene tomme målet.

Metoden er ikke funnet på. Den er arbeidet opp gjennom 28 egne logger og en full
opprydding i fagbrev.io 06.09.2026. **Fagbasen og reglene skal kopieres inn i
dette repoet og leve her.** Ingenting i Ampex skal peke på en mappe utenfor det.

## Rekkefølgen på salget

1. **Lærlingen betaler selv.** 300 kr/mnd, kjøpt alene, uten at noen andre må si
   ja. Testes med tre lærlinger før noe bygges: betaler de av egen lomme når
   bedriften allerede betaler for fagbrev.io?
2. **Opplæringskontoret** når nok lærlinger bruker det til at salget blir
   innkommende. Selges på dekningstallet, ikke på pris — se «Kontorflaten».
3. **VIGO og tilskuddshåndtering** bygges ikke nå. Det er tilgangs- og
   ansvarsproblemer, ikke kodeproblemer, og de er ikke verdt noe før et kontor
   faktisk vil bytte helt.

## Datamodell

### Tre lag, og de må ikke blandes

**Lag 1 — kompetansemålene (låst, felles, nasjonalt).** Ordrett tekst fra Udir,
hentet fra kilden, aldri skrevet av for hånd. Nøkkel er læreplankoden, ikke
nummeret: `ELE03-03` og `ELE03-04` er egne rader, og hver lærling henger på den
planen lærekontrakten hans gjelder under. Ingen — heller ikke et kontor — kan
redigere teksten. Gjør de det, stryker noen på fagprøven på vårt ord.

Verifisert 16.09.2026: Opplæringsplanen fra fagbrev.io er Udirs liste ordrett,
med «1.1»–«1.20» satt foran. Nummereringen er fagbrev.io sin, teksten er
forskriften. Alle elektrikerlærlinger i Norge har nøyaktig de samme tjue.

**MERK:** ELE03-03 er avløst av **ELE03-04**, gyldig fra 01.01.2026. Målene ser
uendret ut, men det må diffes ordentlig før det havner i basen.

**Lag 2 — delinndelingen (felles, vår).** Hvert mål brytes i deler
(«dimensjonere kabel/vern», «ekomutstyr», «effektfaktor»). Dette er den
finmaskede inndelingen kontorene ikke deler ut, og den er utledet fra den
ordrette teksten — ikke skrevet fritt.

Fire deler manglet i den håndskrevne versjonen og må med:
- **1.5** «ekomutstyr» (mellom målearrangement og jordingssystem)
- **1.7** «og kablet utstyr» (ikke bare radiobasert)
- **1.9** «gjøre rede for hvordan dette påvirker anleggets energiøkonomi»
- **1.20** «og reflektere rundt mulige endringer»

Det er selve argumentet for at lag 1 skal være låst: en som bryr seg mistet fire
deler i avskriften.

**Lag 3 — kontorets lag (fritt).** Nummerering, etiketter, halvårsmilepæler,
rekkefølge, egen loggmal. Ren presentasjon oppå lag 1 og 2. Her kan de gjøre hva
de vil, og her hører malopplasting hjemme.

### Fagbase mot personlig profil

`CLAUDE.md` blander i dag fag og person, og det må deles:

- **Fagbase (felles):** at skjerm jordes i én ende, at metallstrips brukes på
  loddrette strekk, at aluminium børstes og fettes i samme bevegelse. Gjelder
  alle. Referanser til NEK er **punktnummer, aldri tekst** — kartet sier hvor,
  aldri hva. Bindende krav siteres fra FEL/FSE, som er fritt gjengivelig.
- **Profil (personlig):** at han ikke vil ha branntetting eller ordet
  «stolpesikringsskap» i loggene sine, hvordan han skriver, hvor lenge han har
  holdt på. Aldri delt, verken med kontoret eller andre lærlinger.

### Verifiseringsmotoren er fagnøytral

Metoden — spør ut, vurder svaret, sett krysset — bygges uten kobling til elektro.
Elektro er første fagbase, ikke arkitekturen. De fleste kontor har flere fag, og
hvert nytt fag skal være innholdsarbeid, ikke en ombygging.

## Organisasjon og tilknytninger

Bekreftet mot fagbrev.io 16.09.2026 (skjermbilder fra Tormods konto).

Tre parter, og de er ikke det samme:

- **Lærebedriften** — «Elektrikerfaget i Aqila AS». Her gjøres arbeidet.
- **Opplæringskontoret** — «TENK LOFOTEN SA». Eget foretak, egne ansatte,
  forvalter lærlinger på tvers av mange bedrifter.
- **Lærlingen** — hører til begge, og eier dokumentasjonen sin.

### Tilknytning, ikke tenant

`company_id` kan ikke uttrykke dette. Koordinatoren hører til
opplæringskontoret og er satt på lærlinger hos både Aqila og Lofoten Elektro
samtidig. Plasserer man ham i ett firma, mister han de andre.

Derfor: **én rad per par av lærling og person**, med hvilken rolle personen har
*for den lærlingen*, og gyldig fra/til. Tilgang følger tilknytningen, ikke
firmaet. Rollene er bekreftet fra fagbrev.io sin kontaktpersonliste:

| Rolle | Hvor personen hører hjemme | Ser |
|-------|---------------------------|-----|
| Faglig leder | Lærebedriften | **Loggen** — de godkjenner den i virkeligheten |
| Instruktør | Lærebedriften | **Loggen** |
| Koordinator | Opplæringskontoret | Dekning, ikke innhold |
| Ansatt | Lærebedriften | Ingenting som standard |

Avklart 16.09.2026: faglig leder og instruktør ser loggen. Kladder, quizsvar og
profil er lærlingens uansett hvem som spør.

I fase 1 er dette dessuten delvis akademisk: loggen eksporteres til fagbrev.io,
og der ser bedriften den som før. Vår tilgangsmodell trenger bare å dekke det
som er vårt, til et kontor faktisk bytter.

### To lærlingroller, én datamodell

- **Firma­lærling** — lærling i et firma som bruker Ampex. Rollen `lærling`
  finnes allerede.
- **Opplæringslærling** — har kjøpt læretid alene; bedriften bruker ikke Ampex.

De deler **samme tabeller og samme felter**. Rollen styrer navigasjon og hva som
eksponeres, aldri skjemaet. Ingen duplisering per rolle, ellers blir overgangen
en migrering i stedet for et bytte av dokk. Firmalærlingen skal kunne få
opplæringsfunksjoner som tillegg senere uten at noe flyttes.

## Hva fagbrev.io faktisk gjør — og hvor de er svake

Docken deres: Dokumentasjoner · Opplæringsplan · **Hjem (midten)** · Kalender ·
Meg. Hjem har «39 % gjennomført» og en stor «Ny dokumentasjon»-knapp.
Dokumentasjonslista har filterchips med tall (Alle 28, Kladd 0, Sendt 0, Må
rettes) og rader med tittel, dato, «5 mål» og statuspille. Meg har lærlingbevis
med lærekontrakt, journal, dokumenter, felles dokumenter og kontaktpersoner.

**Svakheten er tallet de bygger alt på.** Opplæringsplanen viser et merke per
mål med antall dokumentasjoner: 1.1 har 26, 1.2 har 12, 1.3 har 6. Det er en
telling av logger som er *merket* med målet, ikke av kryss som holder. Før
oppryddingen 06.09.2026 sto 1.17 på tretten logger og 1.19 på nitten uten dekning
i teksten. «39 % gjennomført» på Hjem er regnet ut fra de samme oppblåste tallene.

Det er demoen: vis samme lærling i begge apper. Deres sier 39 %. Vår sier hvilke
mål som faktisk holder, og hvilke deler som mangler.

Det de ikke har i det hele tatt: bilder i loggflyten, hjelp til å skrive,
oppfølgingsspørsmål, og dekning på **delnivå** (de teller logger per mål, ikke
hvilke deler av målet som er dekket). Opplæringsplanen deres er tjue kort med
ordrett forskriftstekst og ingen forklaring av hva målet betyr.

### Innsiden av en dokumentasjon (16.09.2026)

Ny dokumentasjon er: **tittel, én blank rik-tekst-boks, vedlegg, mål.** Det er
alt. Ingen seksjoner, ingen risikovurdering, ingen egenvurdering, ingen
veiledning. En nittenåring som er lei av skole møter et tomt felt med en
B/I/U-verktøylinje. Det er derfor ChatGPT allerede brukes.

Livsløpet: **Kladd → Send inn → Godkjent / Må rettes**, med tilbakemeldinger som
kommentarer på dokumentasjonen («Godkjent av veileder» + en melding). Statusene
går igjen i filterchipsene: Alle, Kladd, Sendt, Må rettes.

**Det avgjørende funnet: tekstfeltet deres brukes knapt.** I Tormods egne
godkjente dokumentasjoner er vedleggene PDF-er (`RettetKabler.pdf`,
`Varmekabler.pdf`) laget utenfor systemet, og INNHOLD er bare en merknad om
vedlegget: «Nå er RettetKabler.pdf den nye dokumentasjonen, tykk skrift = det som
er blitt endret.»

Fagbrev.io er altså allerede et arkivskap for PDF-er produsert et annet sted.
Vi trenger ikke erstatte dem for å ha en jobb — vi er stedet PDF-en lages.

### Hva det betyr for eksporten

Vi replikerer ikke editoren deres. Eksporten skal treffe formen de faktisk
bruker:

- **én PDF** som vedlegg (loggen, ferdig satt i malen),
- **én kort innholdslinje** som sier hva vedlegget er,
- **krysslista** å hake av under Mål,
- og en tittel.

Det er hele integrasjonen, og den krever ikke API fra dem.

Å stjele: filterchips med tall, statuspiller, rader ledet av egne data (tittel,
dato, antall mål). Å ikke stjele: ikonflis + chevron på hver rad i Meg — det er
forbudt i regel 9 — og lange etiketter. «Dokumentasjo…» og «Må r…» er avkortet i
deres eget UI. Korte navn: **Logger**, ikke «Dokumentasjoner».

## Loggen

### Én chatbot per logg

Ikke én assistent for alt. Konteksten holder seg liten, jobbene blandes ikke, og
loggen har en naturlig slutt. Det er også enheten for eksport, deling og sletting.

### Bildene er ryggraden

Bilder lastes opp i etterkant eller tas direkte, og sorteres på EXIF-tid. Det
gir dagens rekkefølge gratis, og rekkefølgen er skjelettet i loggen.

EXIF ryker stille (Messenger, videresending, skjermbilder). Derfor: les EXIF der
den finnes, fall tilbake på opplastingsrekkefølge, **vis tidslinja synlig**, og
la rekkefølgen dras på plass.

**Notatet skrives i samme øyeblikk som bildet tas, på jobb.** Ikke ved
opplasting om kvelden. Da sitter det fortsatt i hodet, og hele
rekonstruksjonsproblemet forsvinner. Fangsten må være brutalt rask — bilde, én
setning, ferdig — og tale må være et alternativ til tastatur, for folk står med
hansker i en kjeller.

**Skriving, ikke tale (avgjort 16.09.2026).** Diktering er trent på standard
østnorsk og bommer på dialekt, og en forvansket transkripsjon er verre enn ingen
notat: den gir et falskt referat i stedet for et tomt felt. Én setning tar ti
sekunder å skrive.

**Notatet kan stå tomt.** Feltet dukker opp rett etter bildet med tastaturet
oppe, men ingen blokkeres på jobb. Bilder uten notat tas opp av chatboten når
loggen skrives: «du tok dette bildet 14:20, hva var det?» Notat med én gang er
idealet, ikke et krav.

**Notatet lagres ordrett, uansett hvordan det kom inn.** Ingen modell pusser på
det ved fangst. Notatet er lærlingens egen forklaring, og det er nettopp
råheten som gjør det til bevis senere. Pussing hører hjemme når loggen skrives,
og råteksten blir stående ved siden av. Alt dette skjer lokalt uten modellkall, så regel 2 holder:
det dyre skjer senere, når loggen skrives.

**Notat per bilde, ikke per logg.** Dette er ikke en bekvemmelighet, det er
feilrettingen: 30.08.2026 oppsto tre faktafeil fordi bilder ble tolket som
fakta — en gjennomføring som ikke fantes, et jordpunkt som ikke fantes, og
kabelslakk som egentlig var uferdig punktstripsing. Bildet er bevis, notatet er
lærlingens forklaring, og modellen skal aldri fylle gapet selv.

### Boten har en avhørsliste, ikke en samtale

Faste spørsmål som må besvares før loggen er ferdig, hentet fra `CLAUDE.md`:

- Hva gjorde du **selv**, og hva så du andre gjøre? (En del han bare redegjør
  for kan ikke krysses av.)
- Hva ble **faktisk målt**? Spenningsmåling er funksjonskontroll, ikke
  sluttkontroll, og skal aldri skrives som det.
- Hvilken kabeltype? **Ikke gjett** når den ikke er oppgitt.
- Hva følte du mestring over? (1.16 dekkes ikke av en tabellrad.)
- Er du usikker: da skrives «jeg husker ikke», aldri «det ble ikke gjort».

## Verifisering — kjernen i produktet

Når tekst er gratis er tekst ikke lenger bevis. Det eneste som fortsatt beviser
kompetanse er et svar på et spørsmål du ikke visste kom, om arbeid du faktisk
gjorde.

**Oppfølgingsquizen kommer fra det lærlingen selv skrev**, ikke fra en
spørsmålsbank. Skriver han «skjermen ble jordet i tavla», spør den hvorfor bare
i én ende. Da kan den ikke hallusinere: den spør om noe han allerede har påstått.

### Avkryssingsregelen (fast standard, ikke innstilling)

Et mål krysses av bare når brødteksten faktisk redegjør for det. Følgende bærer
ikke et kryss alene:

- en rad i risikovurderingstabellen (kan ikke bære 1.3 eller 1.4 — men den BÆRER 1.2:
  tabellen er risikovurderingen, avgjort 27.09.2026)
- en rad i egenvurderingstabellen (kan ikke bære 1.16 eller 1.20)
- én bisetning som nevner ordet
- nærhet til utstyr han ikke gjorde noe med
- **et generert avsnitt han bare godtok**

Fire til åtte mål er normalt. Tolv er et varselsignal om at tabellene bærer
kryssene. Feil svar på oppfølgingsspørsmålet er signalet om at krysset ikke skal
settes.

Regelen kan **ikke** skrus løs av et kontor. Kan den det, har vi solgt dem den
samme maskinen som ga 1.17 på tretten logger.

### Sporet

Registreres per avsnitt: hva lærlingen skrev selv, hva som ble generert og
godtatt, og hva han svarte da han ble spurt ut. Sporet har **ett** formål: å
svare på om krysset holder. Blir det et verktøy for å ta folk i å ha brukt AI,
går de tilbake til fanen ingen ser, og da er alle tallene verdiløse.

## Læringssløyfa (det «duolingoaktige»)

Utgangspunktet: **skoleleie lærlinger skriver ikke lange tekster, og det sitter
ikke.** De har nettopp kommet seg ut av klasserommet. Skriver vi produktet som
en skoleoppgave, taper vi uansett hvor god fagbasen er.

Derfor kommer læringen som korte utvekslinger, ikke som innleveringer.

### Hva vi tar fra Duolingo

- **Korte økter.** To–tre minutter. Tre spørsmål etter en logg, ikke et essay.
- **Spørsmål som besvares i én setning**, muntlig i formen: «forklar det som om
  du forklarer det til en ny lærling».
- **Repetisjon over tid.** Noe han bomma på i mars kommer tilbake i mai.
  Fagprøven er muntlig og ligger måneder fram — det han kunne én gang må han
  fortsatt kunne da.
- **Målrettet på det svake.** Systemet vet allerede hvilke mål og deler som er
  tynne, og spør der.
- **Synlig framgang** mot noe ekte: dekning per mål, ikke poeng.

### Hva vi ikke tar

- **Ingen streaks.** En montør på to ukers anlegg skal ikke miste noe. Skyld som
  mekanikk skaper motvilje mot et arbeidsverktøy.
- **Ingen ligaer eller poengtavler.** Dette er dokumentasjon som går til
  opplæringskontoret. Rangering av lærlinger mot hverandre er ødeleggende, og
  sjefen ser den.
- **Ingen barnete tone.** Voksne folk som gjør farlig arbeid.

Kort sagt: vi stjeler læringsforskningen (kort, spredt, målrettet), ikke
kasinomekanikken.

### To quizer per logg, med to forskjellige jobber

De henger ikke sammen, og de skal ikke komme etter hverandre.

**Quiz 1 — samme kveld, rett etter loggen.** Spørsmål: forsto du det du gjorde i
dag? Svarene her avgjør avkryssingen. Klarer han ikke å forklare det loggen
påstår, settes ikke krysset.

**Quiz 2 — rundt fire dager senere.** Spørsmål: sitter det fortsatt? Det er her
læringen faktisk skjer, og det er denne formen fagprøven har.

**Stryk på quiz 2 fjerner ikke krysset.** Han gjorde jobben og forklarte den da
den var fersk. Temaet går i stedet tilbake i rotasjon og markeres som teoretisk
svakt. Alt annet ville vært urimelig.

### To slags svakhet, og de har ulik medisin

| Hva systemet ser | Hva det betyr | Hva han skal gjøre |
|---|---|---|
| Tynn dekning på et mål | Jobben mangler | Be om den jobben |
| Svake svar på et tema | Jobben er gjort, men ikke forstått | Lese og øve |

Begge vises. I dag ser ingen noen av delene.

### Takt

Quizbudsjettet følger abonnementet: fire logger i måneden gir åtte quizer, altså
én omtrent hver fjerde dag.

**Men takten er en anbefaling, ikke en sperre (presisert 16.09.2026).** Quizene
ligger alltid åpne og kan tas når han vil, alle på én kveld om han vil. Det som
er tidsstyrt er *dyttet*: varselet og anbefalingen kommer når spørsmålet er verdt
mest.

- Varsel om quiz 2 rundt fire dager etter quiz 1, aldri mer enn ett dytt om
  dagen. Skriver han fire logger på én kveld, køes varslene utover — ingen får
  åtte påminnelser på en uke.
- Tar han quiz 2 med én gang, sier appen at den er verdt mer om noen dager, men
  lar ham gjøre det. Ingen sperre, ingen skyld.
- **Et svakt tema kommer uansett tilbake senere.** Å ta quizen tidlig avlyser
  ikke repetisjonen — det er repetisjonen som er poenget.
- En quiz blokkerer aldri en ny logg.

### Innrammingen som gjør at de gidder

Dette er ikke lekser. **Det er øving på fagprøven.** På den muntlige delen sitter
sensor og spør nøyaktig disse spørsmålene om nøyaktig dette arbeidet. Å svare på
tre spørsmål om dagens jobb er generalprøven, og det er den eneste
innrammingen som betyr noe for en nittenåring som er lei av skole.

## Hvorfor kontoret trenger dette (ikke bare lærlingen)

Én koordinator har mange lærlinger. Én faglig leder har flere. De rekker ikke å
legge like mye i hver enkelt, uansett hvor mye de vil. Det er ikke vond vilje,
det er timer i døgnet.

AI kan gi hver lærling den oppfølgingen koordinatoren ikke har timer til. Og
ChatGPT gjør ikke dette i dag, uansett hvor god modellen er: den kjenner ikke
kompetansemålene, vet ikke hva han gjorde på jobb, og husker ingenting til neste
gang. Rammeverket er det som mangler, ikke modellen.

**Pitchen til kontoret er derfor ikke at vi erstatter koordinatoren.** Vi gir
hver lærling en samtale koordinatoren ikke rekker, og vi forteller koordinatoren
hvor de få timene han faktisk har bør brukes. Det gjør ham mer verdt, ikke
mindre — og det er han som må si ja til å kjøpe det.

## Eksport

- **PDF** som matcher malen, klar til opplasting der kontoret vil ha den.
- **Kryssliste** han haker av med i fagbrev.io på ett minutt. Automatisk
  opplasting dit forutsettes ikke — regn med at de ikke har åpent API.
- **Malopplasting selvbetjent:** de laster opp sin .docx, vi kjenner igjen
  seksjonene vi klarer og **viser hva vi fant** med én gang («vi kjente igjen
  fire seksjoner — stemmer det?»). Maler som ryker havner i innboksen og fikses
  sentralt. Egen mal er standard og skal være god nok til at de fleste aldri
  laster opp noe.

## Kontorflaten

Selges på ett tall ingen andre kan levere: **hvem kommer til å stryke.**
Fagbrev.io rapporterer aktivitet (28 leverte, alle godkjent). Vi rapporterer
dekning som holder («1.9 helt tomt, tynn dekning på 1.7, 1.8, 1.11 og 1.14, ni
måneder før oppmelding»).

**Kontoret ser dekning, aldri innhold.** At 1.9 er tomt er deres legitime
anliggende. Kladdene, quizsvarene og profilen er lærlingens. Går den grensen feil
vei skriver han for sjefen fra dag én.

Ikke selg på pris. Lisensen er småpenger ved siden av tilskuddene de forvalter,
og «billigst og best» leser som en advarsel i offentlig sektor.

## Rammeverket kontoret kjøper

Opplæringskontorene får AI-problemet enten de vil eller ikke. Lærlingene deres
bruker allerede modeller til loggene, i en fane ingen ser, og kontoret har i dag
ikke noe svar når fylkeskommunen spør hvordan det håndteres. De kommer heller
ikke til å bygge svaret selv.

Det er der vi kommer inn, og det er ikke programvaren vi selger dem først. Det er
en holdbar måte å si ja på.

Rammeverket består av fire ting, og alle fire finnes allerede i planen over:

1. **En skreven regel for når et kryss er dekket.** Ikke en innstilling, en
   standard. Se «Avkryssingsregelen».
2. **Et spor per kryss** som viser hva lærlingen skrev selv, hva som ble
   generert og godtatt, og hva han svarte da han ble spurt ut.
3. **Dekning på delnivå**, på tvers av alle lærlingene deres, per bedrift og per
   fag.
4. **Tidlig varsel** om hvem som ikke er i rute, mens det er tid igjen.

### Selg regelen som en standard, ikke som en funksjon

Et kontor som tar i bruk «Ampex-standarden for dokumentasjonsdekning» har noe å
si oppover som ikke handler om en leverandør. Det er veien fra verktøy til
infrastruktur, og den er åpen for oss fordi regelen faktisk kom av en ekte
opprydding og ikke av markedsføring.

Men en standard erklært av et enmannsforetak avfeies på et øyeblikk. Den må
**medsigneres av et ekte opplæringskontor.** TENK Lofoten er rekkevidde —
koordinatoren står i kontaktlista. Be dem lese regelen og sette navnet sitt på
den, før det finnes noe å selge. Det koster ingenting og er verdt mer enn
funksjonen.

## Plassering i appen

**Docken følger hva brukeren har kjøpt (regel 4), og beholder formen.**

De første kundene er lærlinger i firmaer som *ikke* bruker Ampex. De har ingen
ordrer, ingen prosjekter, ingen lager. Montørdocken er feil for dem, og læretid
gjemt under Meg er feil for et produkt de har betalt for alene. De skal ha egne
knapper.

**Lærlingdocken:** Hjem · Logger · *(orb)* · Kalender · Meg

- **Hjem** — dekningen, og hva som haster. Her slås fagbrev.io sine to flater
  sammen: de deler dekning mellom Hjem («39 %») og Opplæringsplan (antall per
  mål). Hos oss *er* dekningen produktet, så den har én flate. Trykk på et mål
  borer inn i delene.
- **Logger** — lista, med filterchips og statuspiller. `+` i toppen for dem som
  leter etter den.
- **Kalender** — vurderingssamtaler, samlinger, frister, oppmelding.
- **Meg** — profil, abonnement, eksport, sletting, kontaktpersoner.

**Bilder fikk ikke egen fane likevel.** De hører hjemme i loggen de skal bli til,
og en egen innboks ville blitt en fjerde plass å rydde i. Ubrukte bilder vises
som en rad på Hjem.

### Midtplassen er orben, ikke et pluss

Spørsmålet sto åpent. Anbefaling: **orben blir stående, og ny logg er å trykke
på den.** Chatboten per logg *er* produktet, og orben er veien til den — et eget
`+` ville laget to veier til samme sted og fjernet merket fra docken for nettopp
de brukerne som bare kjenner oss gjennom dette. `+` finnes i toppen av Logger for
dem som forventer den, slik fagbrev.io har den.

Det holder også formen lik montørdocken: Hjem til venstre, orb i midten, Meg til
høyre. Fagbrev.io har Hjem i midten — vi følger ikke etter der.

**Montørdocken står urørt.** Hjem / Prosjekter⇄Ordre / orb / Lager / Meg.

**Overgangen** når en lærling også er montør i et Ampex-firma: han får
montørdocken, og Logger flytter inn i den delte plassen eller under Meg. Samme
logger, samme dekning, samme historikk — bytte av dokk, ikke av produkt. Derfor
bygges læretid som egen flate fra dag én, ikke som en fane som senere løsrives.

Kjente flyter fra fagbrev.io kan ligne på deres **flyt** — hva du trykker på, i
hvilken rekkefølge — så overgangen er lett. Men det tegnes i Ampex sitt språk:
hvit grunn, sort CTA, én grå, Geist, ingen ikonflis + chevron (regel 9).
Lignende flyt, aldri lånt utseende.

### Utenfor omfang nå

Lærlingbevis med lærekontrakt, journal og felles dokumenter. Fagbrev.io har det,
det er ekte funksjoner, men ingen av dem selger produktet vårt.

## Modellvalg

**Avgjort 16.09.2026, og så endret samme kveld: ALT på Gemini.**

Først delte jeg jobben mellom Gemini Flash og Claude Sonnet. Så viste det seg at
`GEMINI_API_KEY` allerede er satt som Supabase-hemmelighet for `ai-voice`, på
betalt tier. Hemmeligheter er per prosjekt, så en ny funksjon kan bruke den
samme nøkkelen.

Det avgjør saken av tre grunner som ikke handler om modellkvalitet: nøkkelen
finnes, Google står allerede som underdatabehandler i `docs/PERSONVERN.md`, og
en Anthropic-nøkkel ville vært både en ny løpende utgift og en ny databehandler
å føre opp overfor firmaene.

Leverandøren ligger bak én modul, så byttet er billig hvis testen mot de 28
loggene sier at noe annet skriver bedre norsk.

Delt etter jobb, ikke én modell til alt:

- **Bildebeskrivelse** — stort volum, lav dømmekraft. Billig visjonsmodell.
  Gemini er allerede koblet opp (se `docs/PERSONVERN.md`), så start der. Hvert
  bilde beskrives **én gang**, beskrivelsen lagres, og det er teksten som sendes
  videre. Sendes bildene med i hver melding blir det dyrt uten grunn.
- **Utspørring og vurdering av om krysset holder** — lite volum, høy innsats.
  Sterkeste tilgjengelige modell. Det er her produktet vinner eller taper:
  en logg som lukter AI, eller en quiz som godkjenner et svar som ikke holder.

Krav uansett leverandør: databehandleravtale, betalt nivå, ingen trening på
inndata. **Gratis-tier er utelukket** — `docs/PERSONVERN.md` slår fast at Google
trener på inndata der. DeepSeek sitt eget API er utelukket: kjører i Kina, ingen
adekvansbeslutning. Vektene er åpne, så vil man ha den prisen, kjøres den hos en
vestlig leverandør med avtale.

Kallet legges bak **én modul i en Edge Function**, slik regnskap allerede gjør,
så leverandør kan byttes uten å røre appen.

**Valget avgjøres av en test, ikke av en mening.** Oppskriften, som tar én kveld:

1. Ta tre av de 28 godkjente loggene. Strip dem tilbake til råstoffet — bildene
   og notatene som lå til grunn.
2. Kjør hver modell med hele regelsettet og sammenlign med den ekte loggen.
3. Bedøm på tre ting, i denne rekkefølgen:
   - **Nekter den å påstå arbeid han ikke gjorde?** Bruk en logg der han bare så
     på. Skriver modellen «det ble kontrollert at leddene satt godt sammen»,
     har den strøket. Skriver den «selve stigen monterte jeg ikke, men det er
     verdt å vite hva som gjelder», har den bestått. Dette skiller modeller
     raskere enn noe annet.
   - **Holder den seg unna det som er forbudt?** Branntetting, nagler,
     kabelsko, tankestrek i løpende tekst, ordrenummer fra andre entreprenører.
   - **Låter det som ham?** Faglig og konkret, ikke luftig.

Nesten ingen har et slikt fasitsett å måle mot. Bruk det.

Modellkostnaden er uansett under fem prosent av 399 kr per bruker. Ikke optimaliser
den. Optimaliser bildehåndteringen.

## Betaling

**Stripe nå, for lærlingen som betaler selv.** Vipps må være med — en
nittenåring legger ikke inn kortnummer for et abonnement.

**Avgjort 16.09.2026: ENK, med Vipps og Stripe.** Foretaket registreres i
Enhetsregisteret (gratis, org.nr på dagen til et par uker). MVA-plikt inntrer
ved 50 000 kr omsetning på tolv måneder — rundt elleve årsabonnenter på 399 —
og MVA kan ikke legges på før registreringen er gjort.

**Avgjort: prisen blir stående på 399, MVA tas av margin.** Merk regnestykket —
399 inkludert MVA er 319,20 til foretaket, altså 20 % av omsetningen, ikke 25 %.
Modellkostnaden er fortsatt under ti prosent av det.

**Men kontoret prises eks. MVA.** De er avgiftspliktig virksomhet og trekker
fra, så et påslag koster dem ingenting. Forbrukerpris inkludert, bedriftspris
eksklusiv — alt annet gir bort margin uten at kunden merker det.

**Tilgang og betaling holdes adskilt.** Én tilgangsrad sier hvem som kan bruke
produktet; hvordan den er finansiert er et eget felt. En plass betalt av
lærlingen selv og en plass betalt av opplæringskontoret skal være samme rad med
ulik finansiering.

Grunnen: kontoret betaler ikke med kort. De vil ha faktura, og offentlig-nære
virksomheter krever ofte EHF. Det bygges ikke nå, men Stripe må aldri bli det
eneste stedet som vet hvem som har tilgang. Blir det det, må hele tilgangsmodellen
skrives om den dagen TENK sier ja.

## Pris

**399 kr/mnd, fast, med rikelig inkludert. Ikke per logg.**

Per-logg-pris høres rettferdig ut og ødelegger produktet. Koster hver logg
penger, samler lærlingen opp: færre og lengre logger som dekker flere mål hver.
Det er nøyaktig feilen avkryssingsregelen finnes for å hindre — tolv kryss på én
logg fordi tabellene bærer dem. Vi skal ikke ta betalt for den oppførselen vi
bygger produktet for å stoppe.

«Logg» er dessuten feil enhet for kostnaden. En dag med tre bilder og en uke med
førti koster ikke det samme å kjøre, og utspørringen er der tokenene går. Per
logg betaler den grundige for den late.

**Etterslep prises separat.** Den som ligger tre måneder bak med seksti bilder er
den kunden som trenger det mest og er minst prisfølsom — han er i panikk. Gi ham
en etterslepspakke han kjøper én gang, i stedet for å få alle andre til å telle
logger hver måned.

Ikke bygg prislogikk før det finnes tre kunder. Fast pris, romslig grense, se hva
som skjer.

## Et utløpt abonnement låser aldri dokumentasjonen

Implementert i `lib/laeretid/abonnement.ts`, med selvtest.

Loggene er lærlingens eget arbeid og hans bevis på fagprøven. Går et kort ut på
dato tre uker før oppmelding, skal han ikke stenges ute fra dem. Han mister å
LAGE nytt — ny logg og utspørring — aldri å lese og eksportere det han har laget.

Det er ikke raushet. Å ta et menneskes egen dokumentasjon som gissel for en
månedsavgift er ikke et produkt vi skal lage, og eksporten er dessuten hans
etter retten til dataportabilitet uansett hva vi måtte mene.

Avslaget skiller også mellom to ting som ser like ut: «du har ikke abonnement»
tilbyr abonnement, «du har brukt opp månedens logger» tilbyr etterslepspakken.
Den siste er kunden som trenger oss mest.

## Avvik fra regel 2 (bevisst)

Montørappen skal lese og skrive kun mot lokal SQLite. En loggbot krever nett i
det øyeblikket den svarer. **Kladd, bilder og notater lagres lokalt; selve
samtalen krever dekning.** Dette står som et valg, ikke som et brudd.

## Personvern

- **«Forlater aldri oss» kan ikke sies slik det er bygget nå.**
  `docs/PERSONVERN.md` har Gemini som underdatabehandler, og gratis-tier lar
  Google trene på inndata. Den sanne, etterprøvbare formuleringen er «brukes
  aldri til å trene en modell, og deles aldri med arbeidsgiveren din». Det
  krever betalt tier med null lagring, og kostnaden må inn i de 399 kronene.
- **«Slettes permanent» krever ekte hardsletting.** Regel 5 er soft delete på
  alt, og `docs/PERSONVERN.md` konkluderer selv med at sletterutinen mangler og
  at art. 17 ikke kan oppfylles. Sletteknappen må ta med synken, R2 og
  sikkerhetskopivinduet.
- **Si på registreringsskjermen hvem som ser hva.** Det er det første en lærling
  lurer på, og svaret bestemmer om han skriver ærlig.
- Noen lærlinger er 17 ved oppstart. Egne krav.

## Juridisk om NEK

NEK 400 er opphavsrettsbeskyttet og kjøpes av NEK. Vi gjengir **aldri** tekst.
Vi viser til punktnummer, og siterer i stedet FEL/FSE, som er fritt gjengivelig
og dessuten det juridisk bindende. Å fotografere sin egen NEK til egne logger er
privat bruk av et eksemplar man har betalt for; samme rør som leverer til
betalende kunder er noe annet. **Fotoinntaket bygges ikke inn i produktet.**

Modellen brukes som kladdehjelp når fagbasen lages, og en installatør med egen
NEK går gjennom og godkjenner. Det er vanlig fagarbeid, ikke videredistribusjon.

## Framdrift: ingen kurve fra Udir

Sjekket mot udir.no 16.09.2026. **Udir gir ingen tall på hvor mange mål du
«burde» ha etter et gitt antall måneder.** Det finnes ingen normert kurve.

Det Udir faktisk krever er halvårsvurdering, som skal beskrive hvor lærlingen
står målt mot kompetansemålene og gi veiledning videre. Den gis **uten
karakter**, tidspunktet er ikke fastsatt, og ved to års læretid skal det være
**minst tre halvårsvurderinger**. Det er et konkret krav vi kan legge i
kalenderen og varsle på — og det er noe kontoret kan revideres på.

Kurven i fagbrev.io er altså deres egen, etter alt å dømme lineær over
kontraktstiden.

### Hvorfor lineært er feil, ikke bare udokumentert

Et mål blir ikke tilgjengelig fordi tiden går. Det blir tilgjengelig når
bedriften tar en slik jobb. 1.9 krever solceller, batteri eller laststyring —
har firmaet aldri hatt et slikt oppdrag, ligger lærlingen ikke «bak». Målet er
strukturelt utilgjengelig, og det er ikke hans feil.

En kurve som kjefter på ham for det lærer ham bare å krysse av for ting han
ikke kan. Det er nøyaktig feilen vi finnes for å rette.

### Målet vårt i stedet: rekkevidde, ikke tempo

To tall, ikke ett:

1. **Tid igjen til oppmelding**, mot hvilke mål som fortsatt er tomme.
2. **Er målet i det hele tatt oppnåelig her?** Ampex kjenner bedriftens
   oppdragsmiks. Har firmaet aldri hatt en jobb som dekker et mål, er det ikke
   lærlingens framdriftsproblem — det er bedriftens dekningsproblem.

Den andre er varselet ingen andre kan lage, og det går til faglig leder og
koordinator, ikke til lærlingen. Svaret i virkeligheten er hospitering hos en
annen bedrift, og det må planlegges i god tid. Et kontor som får vite i mars at
tre av bedriftene deres ikke kan dekke 1.9, rekker å gjøre noe. Et kontor som
ser «39 %» gjør det ikke.

## NEK 400:2026 (bekreftet 16.09.2026)

Fra bilder av Tormods eget eksemplar:

- **NEK 400:2026 trådte i kraft 1. juli 2026** og erstatter syvende utgave fra
  2022. Det er en teknisk revisjon, ikke en opppussing.
- Standarden består av åtte hoveddeler: 400-1 omfang og struktur, 400-2 termer
  og definisjoner, 400-3 generelle forhold og prinsipper, 400-4 beskyttelse for
  sikkerhet, 400-5 valg og montasje av utstyr, 400-6 verifikasjon, 400-7 og
  400-8 krav til spesielle installasjoner eller områder.
- Utgaven har en egen liste over **delstandarder med vesentlige endringer**.

To konsekvenser:

1. **Fagbasen festes til NEK 400:2026 fra start.** Hver rad merkes med utgave.
   Standarden revideres hvert fjerde år, og et kart uten utgavemerke råtner i
   stillhet.
2. **Gamle logger kan peke på punkter som ikke finnes lenger.** Endringslista
   nevner blant annet delstandarder som er trukket tilbake og fjernet. De 28
   loggene har NEK-referanser skrevet før 2026-utgaven, og noen av dem kan være
   foreldet. Det er verdt en gjennomgang — og det er en funksjon i seg selv:
   varsle om utdaterte NEK-henvisninger når utgaven skifter.

Grensen står ved lag: **punktnummer og utgave er fakta vi lagrer. Overskriftene
og teksten er NEKs.** Beskrivelsen av hva som bor hvor skrives i egne ord.

## Hva som er bygget (16.09.2026)

**Ren logikk** — `lib/laeretid/`, selvtestet i `npm run verify:laeretid` (66 sjekker):
`laereplan.ts` (de tjue målene ordrett + delinndeling), `dekning.ts`
(avkryssingsregelen), `tilgang.ts` (tilknytninger og invitasjon),
`abonnement.ts` (tilgang skilt fra betaling).

**Server** — `supabase/migrations/20260916190000_laeretid.sql`, KJØRT i to trinn.
Seks tabeller med RLS, `kan_se_laerling()`, og eierskap som data i `sync_tables`
i stedet for hardkodet `company_id` i `watermelon_push`. `verify:e2e` gikk 59/59
etterpå.

**Lokalt** — WatermelonDB-skjema v41, migrasjon og modeller i
`lib/db/models/laeretid.ts`, registrert i `lib/db/index.ts`. Synken henter
tabellnavnene fra migrasjonen, så de nye tabellene kommer med uten videre.

**NEK-kart** — `lib/laeretid/nek-kart.ts`: 52 oppslag med punktnummer,
hoveddel, sidetall i NEK 400:2026 og én linje i egne ord om når du slår opp
der. Bygget fra bokas egen innholdsfortegnelse (sidene 3–6), ikke fra noen
logger. Vi lagrer nummer og side — fakta — og skriver utløseren selv; NEKs
overskrifter gjengis ikke.

Usikre sidetall som bør etterprøves mot boka: **415** (lest 120, kan være 121)
og **445** (lest 169, kan være 170).

**Fagbase** — IKKE BYGGET, og ikke av meg. Forsøket 16.09.2026 på å utlede den
av Tormods 28 logger ble fjernet på hans beskjed: innholdet er hans arbeid, og
det bygger på Aqilas og GKs oppdrag. Hvordan fagbasen skal bli til er en åpen
beslutning, ikke en teknisk oppgave.

**Utspørring** — `lib/laeretid/quiz.ts` og `laeretid_sporsmaal`. Svarene er
lærlingens alene: RLS gir ingen tilknytning innsyn, uten unntak.

**Skjermer** — dekning, logger, mål-detalj, logg med bildetidslinje, ny logg.

**Samtalen og quizen (27.09.2026)** — kun tekst, ingen tale.

- **Lærlingen skriver ikke loggen.** Han forteller i en chat per logg
  (`app/(app)/laeretid/logg/samtale.tsx`), og boten skriver loggen av instruksen,
  bildenotatene og svarene hans. Samtalen lagres i `laeretid_melding`, med samme
  RLS som quizsvarene: bare han ser den.
- **Rekkverket er kode, ikke prompt** (`lib/laeretid/samtale.ts`, selvtestet):
  hva som MÅ spørres om bestemmes av `gjennomgang()` over avhørslista i
  `utsporing.ts` — modellen formulerer bare. Et punkt spørres høyst to ganger,
  så er det «husker ikke». Belegg modellen foreslår vaskes (`vaskBelegg()`, maks
  åtte mål), og alle er `generert`, så ingen del holder før han har svart for
  den i quizen.
- **NEK: hvor, aldri hva.** Modellen får kartet (punkt, side, når) men aldri
  innhold, og ber ham slå opp selv: «Slå opp punkt 522 på side 193». Påstår en
  setning hva NEK krever, tas den ut (`rensNek()`), og loggteksten får advarsel
  (`advarslerFor()`). Henvisningen vises under meldingen med utgave og side.
- **Quizen** (`app/(app)/laeretid/quiz.tsx`): runde 1 lages når loggen sendes,
  runde 2 når runde 1 er besvart, repetisjon tre uker etter bom. Dytt på
  læretidsforsida. «Jeg vet ikke» er en egen knapp.
- **Server:** `supabase/functions/laeretid-ai`, fire moduser (samtale, skriv,
  lag, vurder). Modellnavnet er ikke hardkodet — den spør Google og tar nyeste
  flash til samtalen (3–4 s per tur) og nyeste pro til skriving og vurdering.
  Lås med `LAERETID_RASK_MODELL` / `LAERETID_MODELL`.

**Omlegging 27.09.2026 (kveld) — quiz er hovedsaken, loggen skal gå av seg selv.**

- **Ny logg = fotomodus.** Ta bilde eller hent fra kamerarullen, én setning under
  hvert. Tiden leses fra EXIF (bare tiden, aldri GPS), og arbeidsdatoen flyttes
  til dagen bildene er fra. Bildene lagres på telefonen først, lastes til R2 under
  `laerling/<uid>/` (r2-sign: `laeretid/`-prefiks, uten firma), og bakes inn i PDF-en.
- **Malen er fra fagbrev.io** («Loggmal for elektrofagene», Felles dokumenter, TENK).
  `lib/laeretid/mal.ts` har den ordrett, pluss «Skriftlig refleksjon». Loggen
  blir en PDF i den malen (`lib/pdf/logg.ts`).
- **Få spørsmål før loggen.** Bare «hva gjorde du selv / hva gjorde andre» og
  bilder uten notat («hva ville du få med på bildet?»). Alt annet fyller modellen
  ut — hele risikovurderingen, vurderingen og vedleggslista — og `fyllResten()`
  setter glemte rader til Nei / Ikke relevant. Lærlingen fyller ingenting selv.
- **NEK-henvisning er valgfri**: «NEK 400:2026, punkt 522, side 193» holder.
- **Teoristien** (`lib/laeretid/teori.ts`, `app/(app)/laeretid/teori.tsx`): 27 temaer
  i seks enheter (Ohms lov, effekt, trefase, vernkarakteristikk B/C/D,
  jordfeilbryter, overspenningsvern, spenningsfall, TN/TT/IT, isolasjonsmåling …),
  hvert knyttet til en del av et kompetansemål. Spørsmål på hans nivå.
- **Læringsprofil** (`lib/laeretid/profil.ts`): nivå 0–3 per del og per teoritema,
  REGNES UT fra quizsvar og logger, lagres aldri. Nyere svar teller mer
  (halveringstid 60 d), nylig bom holder nivået nede til han klarer det igjen.
  Quizen får nivået og tilpasser vanskelighetsgraden; stien anbefaler det han
  bommet på, så neste tema han ikke har prøvd.

**Gjennomgang 27.09.2026 (sent):** flyten er nå Ny logg → bilder (malknapp) →
ett spørsmål i chatten → «Loggen er klar» → send inn og quiz. Forsida har én
øv-knapp (jobbquiz først, ellers neste teoritema). Etter en teoriøkt: «Neste tema».
Målsiden viser hver del i farge med vanlige ord og «Øv på dette».
Feil rettet samme kveld: r2-sign godtok `%2e%2e` i nøkkelen og kunne signere et
annet firmas filer (gjaldt ALLE prefikser, også før læretid) — nå kun
`[A-Za-z0-9._/-]` og sjekk av ferdig sti. Doble quizspørsmål ved dobbelttrykk,
bilderader uten fil, UTC-dato etter midnatt, runde 2 som kunne gå tapt.
Kjent hull: grensen på to AI-omskrivinger sjekkes bare i appen.

**Ikke bygget (28.09.2026):** lærlingdocken, kalender, Meg-flate for lærlingen,
betaling (Stripe/Vipps), kontorflaten, kryssliste-eksport, verving i koden og
deploy av `laeretid-invitasjon`. Bildeopptak, R2, quizskjerm, PDF-eksport og
teoristi ER bygget — se over og `docs/NAA.md` (27.–28. september).

### Funn: NEK 400:2026 omnummererte verifikasjonsdelen

Verifikasjon er `6.1`–`6.5` i 2026-utgaven, mot `61x` tidligere. Referanser som
«NEK 400-6-61» i de 28 loggene peker dermed på noe som ikke finnes i boka
lærlingen har foran seg på fagprøven. `erUtgaatt()` fanger det, og det er en
funksjon i seg selv: varsle om utdaterte henvisninger når utgaven skifter.

### Det ærlige løftet om quizsvarene

«Ingen ser svarene dine» er ikke sant. Modellen ser dem. Den etterprøvbare
formuleringen er: ingen på jobben og ingen i opplæringskontoret ser dem,
modellen behandler dem uten å lagre eller trene, og Ampex kan teknisk komme til
dem i basen men leser dem ikke. Man kan ikke både ha en AI som spør ut og ha
svar som er usynlige for systemet.

## Åpne spørsmål

1. Betaler tre lærlinger 300 kr/mnd av egen lomme? **Spørres denne uka.**
2. Diff ELE03-03 mot ELE03-04 ordrett. Skal dokumentene bære ny kode?
3. Hvilket signeringsnivå trengs per dokumenttype? En signatur på en
   vurderingssamtale skal holde år senere i en diskusjon om hevet lærekontrakt.
   Arkivpakkens SHA-256 + `audit_events` er riktig mønster, nivået er ikke valgt.
4. Vil TENK Lofoten medsignere avkryssingsregelen som standard?
5. Teller kabelvalg-begrunnelse mot 1.5, eller er det 1.12 (forlegning) og 1.13
   (materialegenskaper)? Grensetilfellene er PFSP i parallell og gjenbruk av
   eksisterende kabel. Uavklart.

## Første steg

1. Spør de tre lærlingene. Alt under her venter på svaret.
2. Hent de tjue målene ordrett fra Udir inn i basen, med læreplankode.
3. Be TENK Lofoten lese avkryssingsregelen. Koster ingenting, og et medsignert
   kontor er verdt mer enn en funksjon.
4. Utled delinndelingen fra den ordrette teksten, med de fire manglende delene.
5. Kopier fagbasen inn i repoet, delt i fagbase (felles) og profil (personlig).
