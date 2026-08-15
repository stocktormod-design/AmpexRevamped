# Ampex Worker — GPU-bake av LiDAR-skann

Bakker skann fra firmaets kø på en PC i stedet for på telefonen. Se
`docs/GPU_BAKE_PLAN.md` for hvorfor, og
`supabase/migrations/20260815120000_gpu_bake_worker_pool.sql` for kø og auth.

## Status

| Del | Status |
|-----|--------|
| Lesing av `framesDir` (samme format som iOS) | virker, verifisert på fixture |
| TSDF-fusjon → pose-refine → xatlas → tekstur → GLB | virker ende-til-ende |
| Kø: claim / heartbeat / complete / fail | skrevet, **ikke kjørt mot ekte Supabase** |
| R2-I/O via presignerte URL-er | skrevet, **Edge Function `scan-blobs` finnes ikke ennå** |
| Innmelding med engangskode | skrevet, ikke testet |
| Pakking til .exe | ikke gjort |

Migrasjonen er **ikke kjørt**. Ingenting her har møtt et ekte skann.

## Oppsett

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Kjør en bake lokalt (ingen kø, ingen R2)

Regresjonsselen — samme `framesDir` gjennom telefon-baken og denne, så
sammenlign `filledFraction`:

```powershell
.\.venv\Scripts\python.exe tools\run_bake.py <framesDir> ut.glb --atlas 8192
```

Uten et ekte skann kan du lage et syntetisk et:

```powershell
.\.venv\Scripts\python.exe tools\make_fixture.py fixture --frames 24
.\.venv\Scripts\python.exe tools\run_bake.py fixture ut.glb --atlas 2048 --rigid
```

## Meld inn PC-en og kjør fra køen

```powershell
.\.venv\Scripts\python.exe -m ampex_worker.main enroll --url <supabase-url> --anon <anon-key> --code <kode fra appen>
.\.venv\Scripts\python.exe -m ampex_worker.main run
```

Node-tokenet lagres i `%APPDATA%\AmpexWorker\node.json`. Worker-en får aldri
brukersesjon eller R2-nøkler — kun kortlevde presignerte URL-er.

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
telefonens termiske budsjett, men ikke GPU-akselerert. PyTorch ser GPU-en
(sm_120, verifisert), så egen CUDA-kode er mulig — full GPU-akselerasjon
krever at Open3D bygges med CUDA (VS Build Tools + CUDA Toolkit).

## Neste steg

1. Edge Function `scan-blobs` for presignerte R2-URL-er
2. Kjøre migrasjonen og teste claim/lease mot ekte Supabase
3. Ekte `framesDir` fra en iPhone → A/B mot telefon-baken
4. Loop closure (COLMAP) — det som faktisk fikser gjenbesøk
5. PyInstaller → .exe
