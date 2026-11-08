# Kryptering — forslag fra DeepSeek (2026-11-08)

**Kort svar:** Claude sin nøkkelmodell er riktig på det som gjør den usynlig for
brukeren — enhetsnøkler, ingen prompter ved oppstart, godkjenning fra en annen
enhet. Den er **ikke trygg nok på det som skal holde i 10+ år: gjenoppretting.**
2-of-2 (eierens iCloud + Ampex) tåler ikke at én del forsvinner, og en
1–3-mannsbedrift har ingen kollega å godkjenne fra. Papirnøkkelen i
`KRYPTERING.md` bryter dessuten Tormods «aldri en nøkkel brukeren må passe på».

Anbefalingen er: **2-of-3 gjenoppretting med en institusjonell del
(regnskapsfører/kontor-PC), en langsiktig rotnøkkel som overlever rotasjon, og en
årlig helsesjekk.** Passkeys/PRF, MLS og ren KMS løser ikke problemet.
Ampex kan ikke både «aldri lese» og «alltid kunne gjenopprette» uten at noen
andre holder en del — det er det ærlige valget Tormod må ta.

---

## 1. Det Claude har rett i

- **CDK + enhetsnøkler + godkjenning** er riktig. En ny enhet skal ikke kunne
  lese noe før en eksisterende enhet har pakket nøkkelen til den. Det gir både
  «stjålet passord gir ingenting» og «appen føles som iMessage».
- **Ingen nøkkel i brukerens hender, ingen Face ID ved oppstart.** Keychain med
  `AfterFirstUnlockThisDeviceOnly` leses stille; biometri bare ved godkjenning,
  tilbaketrekking og gjenoppretting. Riktig.
- **Innhold krypteres, struktur står åpent.** RLS, synk og varsler trenger
  `company_id`, `id`, tidsstempler — ikke innholdet.
- **Filer i R2 med egne filnøkler, innpakket av CDK**, og sealed box for
  innkommende prisfiler. Riktig.
- **Trusselmodellen er ærlig** om stjålet ulåst telefon og ondsinnet oppdatering.

## 2. Der jeg er uenig

1. **Papirnøkkelen må bort.** `KRYPTERING.md` linje 47 og 63 viser QR + 24 ord.
   Tormod har sagt nei. En 10-års arkivnøkkel på papir blir borte, og den gjør
   brukeren til nøkkelansvarlig. Erstatt med digitale deler (under).
2. **2-of-2 er for skjørt.** Mister eieren iCloud-delen (bytter Apple-ID, sier
   opp, MDM slår av Keychain, telefonen og kontoen forsvinner sammen), står bare
   Ampex-delen igjen — og da er dataene tapt. En 10-års garanti tåler at **én**
   del forsvinner. 2-of-3 gjør det.
3. **1–3-mannsbedriften er hovedtilfellet, ikke unntaket.** «Godkjenn fra en
   kollegas enhet» finnes ikke når det bare er eieren. Designen må ha en vei
   for én person: en institusjonell del (regnskapsfører/kontor-PC) i stedet for
   en kollega.
4. **«Not even Ampex» og Ampex som escrow er en motsetning.** Hvis Ampex holder
   én av to deler, kan Ampex + den andre parten lese. Det er greit — men da må
   løftet være «Ampex kan ikke lese alene», ikke «ikke engang Ampex». Vil Tormod
   det absolutte løftet, må tredjedelen være en uavhengig escrow/notar, ikke
   Ampex. To nivåer er en ærlig produktbeslutning.
5. **Kontorappen i nettleser er den svakeste flaten.** WebCrypto med
   `extractable: false` i IndexedDB er ikke hardwarebeskyttet; XSS kan bruke
   nøkkelen selv om den ikke kan eksporteres. Ikke lagre en 10-års CDK i en
   nettleser. Bruk telefonformidlet sesjon (QR) eller Tauri med TPM/OS-keystore.
6. **Driftsfunksjonene trenger klartekst, og det må stå.** Stemme-AI ser
   innholdet under samtalen; Tripletex og RunPod-baken trenger dataene. Det kan
   ikke være E2EE samtidig. Løftet må gjelde **lagret innhold**, ikke «AI-en
   vår kan aldri se noe».
7. **Rotasjon og gjenoppretting er ikke koblet sammen.** «Ny CDK-versjon» (linje
   60) og en gjenopprettingsnøkkel som pakker CDK (linje 47) betyr at
   gjenopprettingsnøkkelen blir utdatert etter første rotasjon. Skill en
   **langsiktig rotnøkkel (FRK)** som aldri roterer fra **CDK-er** som roterer.
8. **Ingen helsesjekk.** Deler, regnskapsførere og telefoner råtner stille. Uten
   en periodisk sjekk vet ingen om gjenoppretting virker før den trengs.
9. **Eldre klartekst i backups.** Å kryptere nye rader hjelper ikke hvis gamle
   Supabase-backups fortsatt har klartekst. Migrering + backup-levetid +
   crypto-shred må planlegges før løftet brukes i salg.
10. **Lokal WatermelonDB er klartekst.** Trusselmodellen sier «stjålet ulåst
    telefon: nei». Det er greit, men det må stå i personvernerklæringen, og
    SQLCipher bør vurderes når datamengden vokser.

---

## 3. Anbefalt modell

```
FRK (firmarot, 32 B, roterer ALDRI)
 ├─ 2-of-3 deler: eier (iCloud/Keychain) · firma (regnskapsfører/kontor-PC) · Ampex/escrow
 ├─ pakker inn CDK v1, v2 … (roterer ved tilbaketrekking)
 │    ├─ pakkes til hver godkjente enhet (P-256 ECDH + HKDF)
 │    ├─ pakker filnøkler (XChaCha20-Poly1305 secretstream, 1 MB-blokker)
 │    └─ krypterer `enc`-felt (AEAD, AAD = tabell + rad-id + company_id + enc_v)
 └─ eies av eier/admin-enheter (Secure Enclave/Keystore) — ikke av vanlige enheter

Enhetsnøkkel: P-256 i Secure Enclave / Android Keystore / TPM. Privat nøkkel
forlater aldri enheten. Offentlig del i `enhet_nokler`.
Gjenoppretting: 2 av 3 deler → FRK → nyeste CDK fra `frk_wrapped_cdk` → ny enhet.
```

**Hvorfor FRK:** en CDK som roterer kan ikke være det delene peker på — da må
alle deler oppdateres ved hver rotasjon, og en gammel del blir verdiløs.
FRK står stille; CDK-er roterer under den. En tilbaketrukket enhet har en gammel
CDK og kan ikke lese nye skriv, men kan fortsatt lese det den allerede hadde
(det er fysisk umulig å ta tilbake uten omkryptering — si det).

**Deler:**

| Del | Holder | Hvordan | Merknad |
|---|---|---|---|
| 1 | Eier | iCloud Keychain, `synchronizable` (Apple) / kontor-PC eller recovery-kontakt (Android) | Personlig; må byttes ved eierskifte |
| 2 | Firmaet | Regnskapsfører (WebAuthn/BankID) eller firmakontor med TPM | Institusjonell, overlever ansatte |
| 3 | Ampex **eller** uavhengig escrow | HSM med to-personers kontroll; utlevering til ny enhets offentlige nøkkel | Ampex alene kan ikke; 2 av 3 kreves |

For 1–3-mannsbedrifter er del 2 regnskapsføreren (eller en fast
recovery-kontakt med appen) — ikke en kollega. Det er en **innstilling ved
oppstart**, ikke nøkkeladministrasjon: «Hvem kan hjelpe deg hvis telefonen blir
borte?» Eieren ser aldri en nøkkel.

**Utlevering (break-glass):** BankID + bekreftelse fra firmaets admin + 72 timers
varsel + revisjonslogg. Delen pakkes til den nye enhetens offentlige nøkkel og
vises aldri i klartekst. Ampex + regnskapsfører kan til sammen låse opp; Ampex
alene kan ikke.

---

## 4. Gjenoppretting i praksis

| Situasjon | Vei ut |
|---|---|
| Telefonen mistet, eieren har iCloud | Eierdel + Ampex (eller regnskapsfører) → ny telefon |
| Telefonen **og** iCloud tapt | Regnskapsfører + Ampex, BankID → ny enhet |
| Eieren slutter / firmaet selges | Ny eier godkjenner enhet; gammel eierdel trekkes; ny del lages; CDK roterer |
| Firmaet går konkurs | Boet/arkivmyndighet + regnskapsfører + Ampex; eksport med revisjonsspor |
| Regnskapsfører byttes | Eier + Ampex; ny del til ny regnskapsfører; helsesjekk |
| Ampex forsvinner | Eier + regnskapsfører; offline recovery-verktøy + formatspesifikasjon |
| Alle tre deler borte | **Tapt.** Det er prisen for «ingen nøkkel hos brukeren» |

**Helsesjekk:** kvartalsvis stille sjekk av at minst to deler er tilgjengelige
(og at del 2 fortsatt er hos en levende regnskapsfører). Årlig
gjenopprettingstest i kontorappen. Ved ansettelse/oppsigelse/eierskifte kjøres
den med en gang. Uten dette er 10-årsløftet udokumentert.

**Eierskifte:** en egen «overdragelse»-flyt: ny eier får enhet, FRK re-innpakkes,
gammel eierdel trekkes, ny del lages, CDK roterer, alle filer får ny `enc_v`
ved neste skriv (gammelt beholdes under gammel CDK). Hvis gammel eier nekter:
Ampex + regnskapsfører med salgsdokumentasjon.

**Support:** ingen supporttilgang som standard. En tidsbegrenset
support-økt (CDK pakket til Ampex-supportnøkkel med utløp, kunden starter den,
revisjonslogg) kan finnes — av som standard, aldri for escrow-delen.

**Juridisk:** Ampex kan bare utlevere ciphertext og metadata. Et pålegg om
innhold må rettes mot firmaet, eller mot Ampex + regnskapsfører (2 av 3) med
rettslig grunnlag. DPA og personvernerklæring må si at Ampex ikke kan lese
dokumentasjonen, at metadata er synlig, og at enkelte driftsdata er
KMS-beskyttet. Ved eierskifte følger dataene firmaet — ikke den personen som
tilfeldigvis var eier.

---

## 5. Hva krypteres — hybriden

| E2EE (FRK/CDK) | Server-side envelope (KMS/HSM) |
|---|---|
| Tegninger/PDF-er, fliser, skann og bilder | Ordre, fakturaer, timer, materialer, tilbud |
| Skjemasvar, signaturer, avvik, internkontroll | Tripletex-payloads, AI-transkripsjoner |
| Kunde- og prosjektnavn, adresser, notater | Prisfiler under parsing (sealed box ved ankomst) |
| Tegningsmarkering, rom, markører | RunPod-bake (jobbens filnøkkel, slettes etterpå) |
| Firmanøkler, deler | Driftsdata: skannlogg, tilbakemelding, voice_usage |

**Hvorfor ikke alt E2EE:** serveren må kunne regne faktura, snakke med Tripletex,
parse prisfiler og bake skann. Å flytte alt til klienten er mulig på sikt, men
det er et større prosjekt. Det ærlige løftet er: **«dokumentasjonen og
kundedataene er uleselige for oss; driftsdata er beskyttet med KMS, men kan
leses av Ampex under behandling.»**

**Prisfiler:** sealed box ved ankomst (firmaets offentlige X25519) er riktig —
serveren kaster klarteksten. Parsing kan skje på klienten; da er også
sammenligningen E2EE.

**AI:** stemme-AI ser innholdet under samtalen. Det er ikke E2EE. Enten
on-device ASR/intent, eller si det rett ut i personvernerklæringen. Ikke bruk
«ikke engang Ampex» i samme åndedrag.

**RunPod:** jobben får filnøkkelen for akkurat den jobben, krypterer resultatet
før opplasting, og klarteksten slettes. Det er «trusted compute», ikke E2EE.

**Kontor:** WebCrypto i nettleser er ikke nok for CDK. Anbefal telefonformidlet
sesjon (QR ved oppstart, nøkkel i minnet) eller Tauri med TPM. Hvis kontoret må
virke uten telefon, er Tauri den ærlige veien — ikke IndexedDB.

---

## 6. Hvorfor ikke de andre primitivene

- **Passkeys/WebAuthn PRF:** PRF krever en assertion (Face ID) for å gi
  nøkkelavledning. Det bryter «ingen ekstra prompt ved oppstart». Du kan cache
  CDK i Keychain etter første login, men da tilfører passkeyen lite. Passkeys
  synker via iCloud/Google og er kontoavhengige — en 10-års arkivnøkkel bør ikke
  henge på eierens personlige konto. Bruk passkeys til **kontor-enheten** og
  **godkjenning**, ikke som rot.
- **iCloud Keychain alene:** Apple-only. Android og kontor kan ikke lese den.
  `expo-secure-store` støtter ikke `synchronizable` i dag; det krever native
  modul. MDM kan slå det av. Bra som **én** del, ikke som eneste backup.
- **MLS:** en bedrift er en liten, lukket gruppe. CDK + innpakning per enhet er
  enklere, billigere og lettere å revidere. MLS løser asynkron gruppeavtale,
  ikke arkivgjenoppretting.
- **Ren KMS/server-side:** beskytter mot DB-lekkasje, men ikke mot Ampex-innsider
  eller kompromittert Ampex. Det er nettopp løftet «ikke engang Ampex» som
  ryker. KMS hører hjemme på driftsdata, ikke på dokumentasjonen.
- **Papir/QR:** bryter Tormods krav, og papir overlever sjelden 10 år med
  eierskifter.

---

## 7. Rekkefølge (forslag)

0. **Beslut:** to nivåer (Ampex-escrow vs uavhengig escrow), regnskapsfører som
   del 2, og om driftsdata får KMS-unntak. Uten disse valgene koder vi feil ting.
1. **FRK + CDK + enhetsnøkler + 2-of-3-deler** med `verify:krypto` (pakk
   inn/ut, 2 av 3, rotasjon, bit-likhet app ↔ kontor). Ingen data røres ennå.
2. **Kunder + priser + prisfil-innkomst** (E2EE; sealed box). Størst
   salgsargument, minst data.
3. **R2-filer** (tegninger, skann, bilder) med secretstream; render-core
   dekrypterer i minnet; temp-filer med `NSFileProtectionComplete`.
4. **Skjema, signaturer, avvik, rom** — de 10-års-dokumentene.
5. **Kontorflaten** (telefonformidlet sesjon først, Tauri/TPM senere).
6. **Driftsdata til KMS**; AI/Tripletex/RunPod får eksplisitte unntak i
   personvernerklæringen.
7. **Migrering + backup-levetid + crypto-shred**; helsesjekk og
   overdragelsesflyt før løftet brukes i salg.

---

## 8. Beslutninger til Tormod

1. **Skal Ampex holde én av tre deler** (gir garantert gjenoppretting, men
   Ampex + regnskapsfører kan til sammen lese), **eller skal en uavhengig
   escrow/notar** holde den (absolutt «ikke engang Ampex», men dyrere og
   avhengig av en tredjepart i 10 år)?
2. **Er regnskapsføreren villig** til å være del 2? Det er den mest stabile
   institusjonen de fleste små firmaer har. Alternativ: firmakontor med TPM
   eller en fast recovery-kontakt.
3. **Hvor går grensen mellom E2EE og KMS** — og kan vi si det høyt i salget?
4. **Kontor uten telefon:** godtar vi QR-sesjon, eller må vi bygge Tauri med
   TPM før kontoret kan dekryptere?
5. **Backup-vinduet:** hvor lenge kan gamle klartekst-backups leve etter at
   migreringen er ferdig? Løftet er først sant etter det.

**Det jeg ikke anbefaler:** å bytte til passkeys som rot, å beholde papirnøkkelen,
å bruke 2-of-2, eller å love «ikke engang Ampex» mens Ampex holder en del.
