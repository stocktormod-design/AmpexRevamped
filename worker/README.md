# Ampex Worker — GPU-bake av LiDAR-skann

Bakker skann fra køen på en PC i stedet for på telefonen. Se
`docs/GPU_BAKE_PLAN.md` for hvorfor.

## Status

| Del | Status |
|-----|--------|
| Lesing av `framesDir` (samme format som iOS) | virker, verifisert på fixture |
| TSDF-fusjon → pose-refine → xatlas → tekstur → GLB | virker ende-til-ende |
| Kø: claim / heartbeat / complete / fail | **kjørt mot ekte Supabase**, 7 påstander |
| Pooler: Firma Privat + Ampex Public | **live**, med samtykkesperre |
| Pakking til .exe | **bygger**, men usignert — se under |
| R2-I/O via presignerte URL-er | skrevet, **Edge Function `scan-blobs` finnes ikke ennå** |
| Innmelding med engangskode | skrevet, ikke kjørt mot en ekte kode |

Ingenting her har møtt et ekte skann fra en telefon ennå.

## De to poolene

| | Firma Privat | Ampex Public |
|---|---|---|
| Hvem eier maskinen | firmaet selv | Ampex |
| Ser jobber fra | kun eget firma | alle firmaer **som har samtykket** |
| Ventetid før den kan ta en jobb | ingen | `pool_settings.public_pool_grace_seconds` (90 s) |
| Slås på med | innmelding fra appen | settes av Ampex, ikke via innmelding |

Nådetiden er hele prioriteringsmekanikken, og den krever ingen koordinering
mellom noder: har firmaet en egen PC oppe, rekker den alltid først. Er den nede,
tar Ampex-poolen over etter 90 sekunder.

**Samtykke er opt-in.** `company_settings.ampex_pool` er `false` som standard,
og en trigger i basen avviser `allow_ampex_pool` på firmaer som ikke har skrudd
den på. Grunnen er at et skann er LiDAR av kundens bolig: at det pakkes ut på en
maskin firmaet ikke eier er en utlevering til tredjepart, ikke en
lastbalanseringsdetalj.

**Innmelding kan aldri lage en Ampex-node.** `enroll_worker_node` setter
firmatilhørighet fra engangskoden, og `is_public` settes kun av Ampex med
service_role. Kunne en firmakode melde inn en offentlig node, kunne hvem som
helst med et abonnement enrolle en PC og laste ned andre firmaers skann.

## Oppsett for utvikling

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Selvtest: virker denne PC-en?

Svarer på «baker maskinen» alene, uten kø, R2 eller innmelding:

```powershell
.\.venv\Scripts\python.exe tools\make_fixture.py fixture --frames 24
.\.venv\Scripts\python.exe -m ampex_worker bake fixture ut.glb --atlas 2048
```

Forventet på en RTX 5070 Ti: 24 keyframes → ~204k trekanter → ~18 s → 8,5 MB GLB.
`filledFraction` på en syntetisk fixture ligger rundt 47 %; det er fixturen, ikke
baken. Regresjonsmålet er å kjøre samme `framesDir` gjennom telefon-baken og
denne, og sammenligne tallet.

## Meld inn PC-en og kjør fra køen

Supabase-URL og anon-nøkkel er innebygd (se `konfig.py` — anon-nøkkelen er
offentlig av design), så det holder med koden fra appen:

```powershell
.\.venv\Scripts\python.exe -m ampex_worker enroll --code <kode fra appen>
.\.venv\Scripts\python.exe -m ampex_worker run
```

Node-tokenet lagres i `%APPDATA%\AmpexWorker\node.json`. Worker-en får aldri
brukersesjon eller R2-nøkler — kun kortlevde presignerte URL-er.

## Bygge .exe

```powershell
.\.venv\Scripts\python.exe -m PyInstaller ampex-worker.spec --noconfirm
```

Resultatet havner i `dist\ampex-worker\`. **326 MB**, mot 4,8 GB i venv-et.
Forskjellen er nesten bare PyTorch: den ble tidligere importert kun for å lese
GPU-navnet, og `ampex_worker/gpu.py` gjør det nå via `nvidia-smi`. Open3D-hjulet
fra pip er CPU-only uansett, så ingenting i baken savner den.

`onedir`, ikke `onefile`: onefile pakker ut ~300 MB til temp ved hver oppstart,
og en worker på en verkstedsPC startes ofte.

### Sperre: Windows kjører den ikke usignert

Bygget kjører **ikke** på en Windows 11-maskin med Smart App Control på:

```
Program 'ampex-worker.exe' failed to run:
En programkontrollpolicy har blokkert denne filen
```

Det er ikke en byggefeil. Smart App Control (`VerifiedAndReputablePolicyState`
= 1) blokkerer kjørbare filer uten kjent signatur, og den er på som standard på
nye Windows 11-installasjoner. Utviklingsmaskinen her har den på, så exe-en er
verifisert bygget, men **ikke verifisert kjørt**.

Veien videre er kodesignering med et OV- eller EV-sertifikat. EV får omdømme
umiddelbart; OV må bygge det opp gjennom SmartScreen først, og de første
kundene vil se en advarsel. Å slå av Smart App Control er ikke et alternativ:
det er en enveisbryter som krever ny Windows-installasjon for å skru på igjen.

## Budsjetter

Hele poenget med å flytte jobben hit. `BakeConfig` mot telefonens verdier:

| | Worker | Telefon |
|---|--------|---------|
| Keyframes | alle | 96–120 |
| Atlas | 8192+ | 8192 / 4096 |
| Pose-refine | 30 iter, ikke-rigid | 8 iter, rigid |
| Termikk | ingen brems | `thermalState` styrer alt |

## Kjent begrensning: Open3D er CPU-only

Pip-hjulet for Windows har ingen CUDA (`o3d.core.cuda.device_count() == 0`), så
fusjon, refine og teksturprojeksjon kjører på CPU. Fortsatt langt utenfor
telefonens termiske budsjett, men navnet «GPU-pool» er foreløpig et løfte om
hvor jobben kjører, ikke om hva som regner. Full GPU-akselerasjon krever at
Open3D bygges med CUDA (VS Build Tools + CUDA Toolkit).

## Neste steg

1. Kodesignering, ellers kommer exe-en ikke forbi Smart App Control
2. Edge Function `scan-blobs` for presignerte R2-URL-er
3. Ekte `framesDir` fra en iPhone → A/B mot telefon-baken
4. Innmelding fra appen: knappen som lager engangskoden
5. Loop closure (COLMAP) — det som faktisk fikser gjenbesøk
