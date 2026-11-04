# Prosjektering i Ampex — Verona fra inntak til samsvarserklæring (plan 2026-10-30)

Tormod 30.10: «vi må planlegge alt på Verona fra start til finish … rett og slett perfekt.»
Verona er restteori-boligen (Lofoten Tekniske, 2026/27): én etasje, 13,61 × 10,20 m, kjøkken/stue,
to soverom, bad, bod, garasje. Året følger samme rekkefølge: risikovurdering → jording og krav →
dimensjonering → sluttkontroll → tilknytning, varme og tavle → prosjektering av hele boligen.
Ampex skal kunne gjøre alt sammen og dele det som én lenke, som om mottakeren var kunden
(første mottaker: Edgar Karlsen, installatøren som har restteorien).

**Hører til ORDREN** (Tormod 30.10: «det er jo ikke prosjektering, det er jo det samme som en
ordre»). Ordren har kunden, adressen, skjemaene og godkjenningen; tegningen er én boks til på den
(«Tegning og risiko»), og delingslenka er ordrens dokumentasjon til kunden. Det som tegnes er en
**installasjonstegning** (kursnummer per punkt, føringsveier åpent/skjult, tegnforklaring);
**enlinjeskjemaet** og **kursfortegnelsen** genereres fra de samme dataene (fase C–D).

Kode: `lib/prosjektering.ts` (ren logikk, `npm run verify:prosjektering`),
`desktop/src/ruter/OrdreTegning.tsx` (`#/ordre/<id>/tegning`, boksen i `Ordre.tsx`),
`desktop/src/ui/PlanTegner.tsx`, `desktop/src/ruter/DeltOrdre.tsx` (`#/del/<nøkkel>`),
`desktop/src/lib/ordretegning-lager.ts`, `supabase/functions/delt-ordre`, tabellen
`tegningslag` (ett jsonb-dokument per ordre eller prosjekttegning).

**Selve planleggingen** (inntak, tavle, kurser, apparater, med begrunnelse): `docs/VERONA_PLANLEGGING.md`.

## Prinsipp

Ampex foreslår og regner; installatøren velger og signerer. Alle forslag som berører sikkerhet
(vern, tverrsnitt, RCD-type, IP-grad) vises som forslag med henvisning, og hver regel som gir et
tall får en selvtest. NEK-henvisningene peker til DEL og avsnitt; Tormod slår opp ordlyden.

## Dynamisk risikovurdering (Edgar, 30.10)

«Hvis det ikke er elbillader skal man jo ikke ha spørsmål om det.» `lib/risiko-katalog.ts` er en
katalog over farer der hver fare vet når den er aktuell: punktene på tegningen, rommene og
påvirkningene deres (NEK 400-5-51), ordreteksten og materiellet. Farer-fanen viser bare det som
gjelder jobben, med HVORFOR («soverommet «Soverom 1» har ingen røykvarsler på tegningen»).
«Legg til» → vanlig fare med `kilde`; «Gjelder ikke» → `avvist`, kommer ikke igjen. Selvtest i
`verify:prosjektering`. I appen (Tormod 30.10: «når du trykker risikovurdering så velger du hva den skal inneholde»):
`ampex.risikovurdering` v2 åpner med «Hva inneholder jobben?» — elleve temaer (tavle, inntak, bad,
varmekabel, elbil, varmepumpe, kjøkken, ute, lysstyring, høyde, eldre bygg), forhåndsavkrysset fra
ordretekst og materiell (`RISIKO_ORD`). Hvert tema slår på sin seksjon via `showIf`; v1-nøklene er
uendret. Mekanismen er generell: `FormSection.velger`. Kontorets utskrift viser nå bare synlige
seksjoner, som PDF-en allerede gjorde. Selvtest i `verify:forms`.

## Faser

**A. Oppgave 3 (frist 05.11) — bygget 30.10, flyttet inn på ordren samme dag; venter på tabell + funksjon.**
Plan inn (PNG/PDF), målestokk, rom som rektangler med areal, punkter (stikk, lys, downlight,
bryter, termostat, tavle, røykvarsler, data), farer pekt ut på planen (anlegg = trekant, montør =
firkant), rom for rom med bruk/brukere/ytre påvirkninger (NEK 400-5-51) og forslag per romtype,
risikomatrise 5×5 før/etter tiltak, SJA, kompetanse, «hva mangler», delingslenke og utskrift.

**B. Punktene ferdig — det meste bygget 30.10.** Kurser (nr, forsyner, vern, jordfeil, kabel, forlegning), punkter på kurs med kursnummer på tegningen, føringsveier åpent/skjult med lengde fra målestokken, lag-bryter, monteringshøyde per punkt med standard per type, åtte nye symboler, og kursfortegnelse generert inn i kundens visning. Prøvd i nettleser med Playwright mot falsk base (tabellen er ikke i prod ennå). Gjenstår av B: tegningsutskrift per lag.

**Rom og symboler fra PDF-en (30.10, kveld).** Last opp en PDF-plan → kontoret leser rommene og
symbolforklaringen selv, viser «9 rom og 39 symboler · målestokk 1:50», og legger alt inn som
ett angresteg. Samme kode som appen: strekelesingen er felles i `lib/pdf-streker.ts` (tåler
pdf.js v4 i appen og v6 på kontoret), rom fra `lib/rom-fra-streker.ts`, raster for bilde-PDF.
Rom har nå valgfritt omriss (`polygon`) og `funnet` (bekreftet / usikker = gul strek). Målt i
nettleseren: Moskenes brann 9/9 rom bekreftet + 39 symboler (4 s); tele (bilde-PDF) 60 rom via
raster, noen falske i tittelfeltet; elkraft 0 — rasteret finner ingen vegger der, appen fant 44
(ikke undersøkt hvorfor).

**Tegnemodusen (30.10, natt).** Tormod: «oversiktlig, lett, intuitivt, avansert» og «i prosjekt
skal dette være bygget på allerede». Fullskjerm-modus i `desktop/src/tegnemodus/`, samme for
ordre (`#/ordre/<id>/tegning`) og prosjekttegning (`#/prosjekt/<id>/tegn/<tegning>`, knappen
«Tegn» på tegningen i prosjektet). Research i `docs/TEGNEMODUS_RESEARCH.md` (AutoCAD, DDS-CAD,
Revit, Bluebeam, Figma). Oppsett: kurser/lag/symboler til venstre, egenskaper + fortegnelse/rom/
risiko til høyre, statuslinje med meter, målestokk, Ortho og Fest, ⌘K-kommandolinje. Taster
V H P F R K M, C = ny kurs av valgte (navn fra rommet), dobbeltklikk = fokus på kurs (klikk
legger på/tar av), 1–9 sist brukte symboler, punktum roterer, boks mot høyre/venstre =
vindu/kryssing, Alt+dra kopierer, knekkpunkter som grep, forslag fra PDF-en godtas med Enter.
Ren logikk i `lib/tegning-redigering.ts` med selvtest. **Lagringen heter nå `tegningslag`**
(migrasjonen er skrevet om før den er kjørt): én rad per ordre ELLER per prosjekttegning.
`delt-ordre` leser begge. Prøvd i nettleser mot falsk base på Moskenes-brann.

**NEK-symbolene.** Symbolene var tegnet fritt. Tegnet om 30.10 etter en ekte norsk elkraft-
forklaring (NEK 144 / IEC 60617-stil): stikk «─(», jord, 3-polt, bryter med 1/2 hake,
serievender, dimmer, termostat °C, fordeling med sikksakk, varmekabel Ω, bevegelses- og
lysføler, ovn, koblingsboks påvegg/innfelt, tilkobling. `lib/el-symboler.ts` oversetter
forklaringens etiketter til punkttyper (selvtest: alle 18 etikettene). Nasjonal referanse er
NEK 144:2017 (utdrag av IEC 60617 DB); har vi den, tegnes settet av den i stedet for av
eksempler. De nye typene (2-polt, serievender, ovn, koblingsboks …) mangler ennå knapp i
verktøylinja.

Opprinnelig plan for B: Monteringshøyde per punkt (og standardhøyde per type som kan overstyres),
flere symboler (komfyr/komfyrvakt, varmekabel som flate med W/m², varmepumpe inne/ute, dimmer og
lysstyring, utelys, elbillader, varmtvannsbereder, ventilasjon), kabelføring som linjer med
**åpent / skjult** (to strektyper og egen lag-bryter), og tegningsutskrift per lag.

**C. Inntak, tavle og kurser.** Inntak (nettselskapets krav, hovedsikring, inntakskabel,
overspenningsvern), hovedtavle og underfordeling i garasjen. Punkter → kurser ved å markere på
planen. Per kurs: belastning, vern (In, karakteristikk), jordfeilvern (type), kabel (type,
tverrsnitt, forlegning), lengde målt langs føringen på planen, spenningsfall, selektivitet mot
forankoblet vern. Forslag + selvtest; tabellverdiene legges inn fra NEK 400-5-52 av Tormod.

**D. Dokumentasjonen.** Kursfortegnelse generert fra kursene, utstyrsdokumentasjon (datablad fra
varekatalogen), sluttkontroll med målinger per kurs, samsvarserklæring, og **QR-kode til
sikringsskapet** som åpner den delte dokumentasjonen (samme delingsnøkkel, egen «FDV»-visning).
Stemme: les opp kursene du ser i et gammelt skap → kursfortegnelse (finnes som stemmeutfylling i
skjema i dag; kobles hit).

**E. LiDAR.** Skann av soverommet nede (likt Veronas) festet til rommet på planen; vis «bak
gipsen» med skjult kabelføring fra fase B lagt over skannet.

## NEK-pekere (slå opp ordlyden selv)

- Ytre påvirkninger: NEK 400-5-51 (tabell over klassene AA…, AD…, AG…, BA…, BE…)
- Beskyttelse mot elektrisk sjokk, automatisk utkobling, jordfeilvern: NEK 400-4-41
- Brann og termiske virkninger (komfyrvakt): NEK 400-4-42
- Overstrømsvern: NEK 400-4-43 · Overspenning: NEK 400-4-44 og 5-534
- Kabler og ledningssystemer, belastbarhet, spenningsfall: NEK 400-5-52
- Bryter- og vernutstyr, valg av RCD-type: NEK 400-5-53
- Jording og utjevning: NEK 400-5-54
- Merking og dokumentasjon (kursfortegnelse): NEK 400-5-514
- Belysning: NEK 400-5-559
- Verifikasjon / sluttkontroll: NEK 400-6
- Bad og dusj: NEK 400-7-701 · Varmekabler: 7-753 · Elbillading: 7-722 · Solceller: 7-712
- Forskrifter: FEL § 16 (prosjektering og risikovurdering av anlegget), FSE § 10 (risikovurdering
  av arbeidet / SJA). Samsvarserklæring og dokumentasjonskrav: se FEL — sjekk paragrafnummeret.

## Åpent

- Tabellen og edge-funksjonen er skrevet, men ikke kjørt mot produksjon (venter på ja).
- Risikogrensene (lav < 5, høy ≥ 12) er et forslag; firmaets akseptkriterier bør stå i IK.
