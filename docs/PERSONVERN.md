# Personvern og sikkerhet

Sist oppdatert: 2026-08-21.

**Dette dokumentet er ikke juridisk rådgivning, og det gjør ikke Ampex
GDPR-compliant.** Etterlevelse er halvt teknikk og halvt organisasjon: avtaler,
rutiner, en ansvarlig person og en logg over avvik. Denne fila dekker den
tekniske halvdelen og setter opp skjelettet for den andre. **Alt under
«Ikke på plass» må løses før første ekte kunde**, og protokollen og
databehandleravtalen bør leses av noen med personvernkompetanse.

---

## Hvem er hvem

| Rolle | Hvem | Hva det betyr |
|-------|------|---------------|
| Behandlingsansvarlig | **Elektrikerfirmaet** | Bestemmer hvorfor og hvordan kundenes og de ansattes opplysninger behandles |
| Databehandler | **Ampex** | Behandler dem kun etter instruks fra firmaet |
| Underdatabehandlere | Supabase, Cloudflare, Google, Vercel | Se egen tabell |

Konsekvensen er praktisk: Ampex kan ikke bestemme å bruke kundedata til noe nytt
uten at firmaet sier ja, og firmaet kan ikke svare en kunde som ber om innsyn
uten at Ampex gir dem verktøyet. **Databehandleravtale er derfor et krav, ikke
en formalitet** (art. 28) — den finnes ikke i dag.

Ampex er selv behandlingsansvarlig for sitt eget kundeforhold til firmaet
(fakturaadresse, kontaktperson, innlogging).

---

## Behandlingsprotokoll (art. 30)

### Kundens kunder

| | |
|---|---|
| **Registrerte** | Privatkunder og kontaktpersoner hos firmakunder |
| **Kategorier** | Navn, adresse, telefon, e-post, org.nr, notat, signatur på arbeid, bilder og 3D-skann av eiendom |
| **Formål** | Utføre og dokumentere elektrisk arbeid, fakturere, oppfylle dokumentasjonsplikt |
| **Rettslig grunnlag** | Avtale (art. 6-1-b) for gjennomføring; rettslig forpliktelse (art. 6-1-c) for dokumentasjon og bokføring |
| **Tabeller** | `customers`, `orders`, `order_signatures`, `order_documents`, `order_scans`, `drawings`, `quotes`, `order_archives` |

**Merk skannene.** LiDAR-skann av en bolig er opplysninger om hjemmet til en
fysisk person. De er ikke særlige kategorier, men de er nærgående, og de bør
behandles som det — kortere lagring enn dokumentasjonen de støtter, med mindre
de inngår i den.

### Firmaets ansatte

| | |
|---|---|
| **Registrerte** | Montører, lærlinger, baser, installatør, kontor |
| **Kategorier** | Navn, telefon, rolle, **timeføring**, GPS via Teltonika-sporing, lesebekreftelser, signaturer, revisjonsspor |
| **Formål** | Lønn, planlegging, faglig godkjenning, internkontroll |
| **Rettslig grunnlag** | Avtale (arbeidsavtalen) og rettslig forpliktelse (arbeidsmiljøloven, internkontrollforskriften) |
| **Tabeller** | `profiles`, `time_entries`, `order_members`, `order_approvals`, `ik_lest`, `audit_events`, `locations` |

**GPS-sporing av ansatte er det følsomste i hele systemet.** Kontroll med
arbeidstakere har egne regler (arbeidsmiljøloven kap. 9 og
personopplysningsloven § 8 om kameraovervåking som analogi). Sporing kan ikke
begrunnes med «det er praktisk»; formålet må være uttrykt, drøftet med de
tillitsvalgte, og de ansatte må vite om det. **Dette er ikke avklart i dag.**

**`audit_events` er også personopplysninger.** Den lagrer hvem som endret hva,
felt for felt, med gamle og nye verdier. Det er en tiltenkt og lovlig
behandling (art. 32 krever sporbarhet), men den arver innholdet i det som ble
endret — inkludert kundeopplysninger. Den må ha en oppbevaringstid.

---

## Underdatabehandlere

| Leverandør | Hva | Hvor | Status |
|-----------|-----|------|--------|
| **Supabase** | Database, autentisering, filer | AWS `eu-west-1`, Irland | Innenfor EØS. DPA må signeres |
| **Cloudflare R2** | Skann, tegninger, arkivpakker | Må settes til EØS-jurisdiksjon | **Ikke verifisert** |
| **Google (Gemini)** | AI-assistent: lyd, ordretekst, skjemainnhold | Uklart | **Se under** |
| **Vercel** | Utlevering av kontorappen | Kant-nettverk, globalt | Statiske filer, ingen persondata |

### Google er den som krever mest

Assistenten sender **lyd fra arbeidsplassen** og innholdet i ordrer og skjemaer
til Gemini. Lyd fra en arbeidsplass kan fange opp navn, adresser, helsemessige
forhold og tredjepersoner som aldri har samtykket til noe.

`supabase/functions/ai-voice/index.ts` har allerede den viktigste tekniske
sperren, og den står som en kommentar i koden: **nøkkelen må være betalt tier,
fordi gratis-tier tillater at Google trener på inndata.** Det er riktig, og det
er ikke nok alene. Det som mangler er at bruken står i protokollen, at Google er
listet som underdatabehandler overfor firmaet, og at overføringsgrunnlaget
utenfor EØS er avklart.

---

## Sletting og oppbevaring

### Regel 5 i prosjektet: soft delete på alt

Ingenting slettes fysisk; `deleted_at` settes. **Det er riktig for
dokumentasjon og feil for personvern**, og de to må skilles:

- **Har oppbevaringsplikt** — samsvarserklæringer, sluttkontroller, timer som
  ligger til grunn for lønn og faktura, bokføringsmateriale. Her går plikten
  foran retten til sletting (art. 17-3-b). `company_settings.retention_years`
  og `order_archives.oppbevares_til` styrer dette.
- **Har ingen oppbevaringsplikt** — et notat på en kunde, et telefonnummer til
  en kontaktperson, en skann som aldri ble brukt i dokumentasjon, en
  søkehistorikk. Disse skal **faktisk slettes** når de ikke trengs, og soft
  delete er da ikke sletting.

**Skillet finnes ikke i koden i dag.** Alt behandles likt.

### Det som mangler

En jobb som periodisk hardsletter rader der `deleted_at` er eldre enn
oppbevaringstiden **og** raden ikke er omfattet av plikt. Den må også rydde i
R2, og den må skrive til `audit_events` hva den slettet — uten å skrive
innholdet, som ville gjort loggen til en kopi av det man nettopp slettet.

---

## Registrertes rettigheter

| Rett | Artikkel | Status i dag |
|------|----------|--------------|
| Innsyn | 15 | **Mangler.** Ingen samlet uthenting per person |
| Retting | 16 | Delvis — kundeopplysninger kan rettes i appen |
| Sletting | 17 | **Mangler.** Se over |
| Dataportabilitet | 20 | **Mangler.** `lib/archive/bundle.ts` bygger allerede en maskinlesbar pakke per ordre; den kan gjenbrukes |
| Innsigelse | 21 | Ikke relevant for avtale- og pliktgrunnlag |

Fristen er **én måned** fra forespørselen. Uten verktøy betyr det manuelle
SQL-spørringer under tidspress, og det er nettopp da man gjør feil.

---

## Tekniske tiltak (art. 32)

### På plass

- **Radnivå-sikkerhet på samtlige tabeller.** Hver policy krever
  `company_id = current_company_id()`. Ett firma kan ikke se et annet.
- **Medlemskapsbasert tilgang innad i firmaet** (`lib/order-access.ts`): full
  informasjon kun på ordrer du er med på.
- **Rollematrise** (`lib/kontor-tilgang.ts`, selvtestet) styrer hva kontoret
  ser. Dekningsbidrag og timeliste er ikke for alle.
- **Revisjonsspor** ført av databasetrigger, ikke av klienten — en logg
  klienten skriver selv er en logg klienten kan la være å skrive.
- **Faglig godkjenning håndheves i basen** (`krev_faglig_godkjenning`), ikke i
  grensesnittet.
- **Kryptering** i transitt (TLS) og i hvile (Supabase/AWS, R2).
- **Lesebekreftelse per versjon** (`ik_lest`) — kan ikke settes for andre, og
  kan ikke redigeres bort.

### Rettet 21. august 2026

- **Rettighetseskalering i `profiles`.** `profiles_self_update` hadde ingen
  `with_check`, og Postgres brukte da `using`-uttrykket på den nye raden.
  Sjekken ble «er den nye radens id min id?» — alltid sann. Enhver innlogget
  bruker kunne kjøre `update profiles set role = 'owner'`, eller sette
  `company_id` til et annet firma og dermed få **full tilgang til et fremmed
  firmas data**, siden hele RLS-modellen leser den kolonnen.
  Lukket med trigger og strammere policy (`20260821230000_sikkerhet.sql`).
  Verifisert ved å utgi seg for en montør og forsøke begge veier.
- **`log_audit_event` kunne kalles uten innlogging.** Hvem som helst kunne
  skrive linjer inn i revisjonsloggen.
- **Triggerfunksjoner var eksponert som REST-endepunkt** (`audit_row`,
  `handle_new_user`, `krev_faglig_godkjenning` m.fl.), alle `SECURITY DEFINER`.
- **`search_path` pinnet** på to funksjoner som manglet det.
- **Test-innlogging fjernet fra produksjonsbygg** av kontorappen. Den logget
  hvem som helst inn som eier med ett trykk — forsvarlig i en app-binær til en
  kjent flåte, en dør uten lås på en offentlig URL.

### Ikke på plass

| Mangel | Konsekvens |
|--------|-----------|
| **Databehandleravtale** | Art. 28 er ikke oppfylt. Kreves før første kunde |
| **Behandlingsprotokoll signert av firmaet** | Art. 30. Denne fila er utkastet |
| **Tofaktor** | Et lekket passord gir full tilgang til firmaets data |
| **Lekkasjesjekk av passord** | Slått av i Supabase Auth. Slås på i dashbordet, ett klikk |
| **Sletterutine** | Art. 17 kan ikke oppfylles |
| **Innsyns- og eksportverktøy** | Art. 15 og 20 kan ikke oppfylles innen fristen |
| **Avklaring av GPS-sporing** | Kontrolltiltak uten drøfting og informasjon |
| **R2-jurisdiksjon verifisert** | Kan innebære overføring ut av EØS |
| **Avviksrutine** | Art. 33: 72 timer til Datatilsynet. Uten rutine bruker man dem på å finne ut hvem som ringer |
| **Oppbevaringstid på `audit_events`** | Loggen vokser uten ende og arver persondata |

---

## Avvik (art. 33)

Ved mistanke om brudd — uautorisert tilgang, tapt enhet, feil utlevering:

1. **Skriv ned tidspunktet du ble kjent med det.** Fristen på 72 timer løper
   derfra, ikke fra da bruddet skjedde.
2. Begrens: steng kontoen, roter nøkler (`set_company_ai_key`, R2, Supabase).
3. Bruk `audit_events` til å fastslå omfang — hvem, hva, når.
4. Varsle firmaet (behandlingsansvarlig) **uten ugrunnet opphold**. Det er
   firmaet som melder til Datatilsynet, ikke Ampex.
5. Er risikoen høy for de registrerte, skal de også varsles (art. 34).
6. Før det i avvikslogg uansett utfall — også når det ikke ble meldt, og
   hvorfor.

---

## Neste steg, i rekkefølge

1. Slå på lekkasjesjekk av passord i Supabase Auth. Ett klikk, i dag.
2. Signer DPA med Supabase, Cloudflare og Google.
3. Skriv databehandleravtalen Ampex tilbyr firmaene.
4. Avklar GPS-sporingen før den tas i bruk hos en ekte kunde.
5. Bygg sletterutinen og eksportverktøyet. Begge er avgrensede jobber, og
   `lib/archive/bundle.ts` er halve eksporten allerede.
6. Tofaktor for roller som ser hele firmaet.
