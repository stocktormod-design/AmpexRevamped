"""Svarer på «hvorfor er ikke GPU-en i bruk».

    python tools\\sjekk_gpu.py

Dette blir det vanligste spørsmålet når exe-en står på en PC i et verksted, og
det har for mange mulige svar til at noen skal gjette: driveren kan mangle,
kortet kan være for nytt for torch-bygget, CUDA Toolkit kan mangle selv om
kortet virker, og Open3D kan være CPU-only selv om alt annet er på plass.

Skriptet sjekker hele kjeden i rekkefølge og sier hva som mangler og hva som
skal installeres. Ingen antakelser: hvert punkt måles.

Bakgrunn for punkt 3 og 4: torch har sin EGEN CUDA-runtime innebygd, så
`torch.cuda.is_available()` kan være True uten at det finnes en `nvcc` på
maskinen. gsplat kompilerer kjernene sine ved første bruk og trenger nvcc — og
den svelger feilen, så symptomet blir «AttributeError: 'NoneType' object has no
attribute» langt inne i en stakk, ikke en beskjed om at verktøykjeden mangler.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

# Windows-konsollen er ofte cp1252, og da kaster print() paa norske tegn i
# stedet for aa skrive dem. Et diagnoseverktoy som selv krasjer med
# UnicodeEncodeError er verre enn ingen diagnose — sa vi tvinger UTF-8 og lar
# tegn som ikke kan skrives bli erstattet framfor aa stoppe kjoringen.
for strom in (sys.stdout, sys.stderr):
    try:
        strom.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)

OK = "  ok  "
FEIL = "  --  "


def kjor(args: list[str]) -> str | None:
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=15, creationflags=FLAGS)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def finn_cuda_toolkit() -> Path | None:
    """nvcc i PATH, ellers CUDA_PATH, ellers standardplasseringen."""
    if shutil.which("nvcc"):
        return Path(shutil.which("nvcc")).parent.parent
    if os.environ.get("CUDA_PATH"):
        p = Path(os.environ["CUDA_PATH"])
        if (p / "bin" / "nvcc.exe").exists() or (p / "bin" / "nvcc").exists():
            return p
    rot = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA")
    if rot.is_dir():
        for d in sorted(rot.iterdir(), reverse=True):
            if (d / "bin" / "nvcc.exe").exists():
                return d
    return None


def finn_msvc() -> Path | None:
    if shutil.which("cl"):
        return Path(shutil.which("cl"))
    for rot in (
        Path(r"C:\Program Files\Microsoft Visual Studio"),
        Path(r"C:\Program Files (x86)\Microsoft Visual Studio"),
    ):
        if rot.is_dir():
            for aar in sorted(rot.iterdir(), reverse=True):
                if aar.is_dir():
                    return aar
    return None


def main() -> int:
    mangler: list[str] = []
    print("Ampex worker — GPU-sjekk\n")

    # ── 1. Driver ───────────────────────────────────────────────────────────
    driver = kjor(["nvidia-smi", "--query-gpu=name,driver_version,memory.total",
                   "--format=csv,noheader"])
    if driver:
        print(f"{OK}NVIDIA-driver: {driver}")
    else:
        print(f"{FEIL}Fant ingen NVIDIA-driver (nvidia-smi svarte ikke).")
        print("      Uten et NVIDIA-kort er GPU-bake ikke aktuelt. Resten kjører på CPU.")
        mangler.append("driver")

    # ── 2. Torch ────────────────────────────────────────────────────────────
    try:
        import torch
    except ImportError:
        print(f"{FEIL}PyTorch er ikke installert.")
        print("      pip install torch --index-url https://download.pytorch.org/whl/cu128")
        mangler.append("torch")
        torch = None  # type: ignore[assignment]

    if torch is not None:
        print(f"{OK}PyTorch {torch.__version__} (bygget mot CUDA {torch.version.cuda})")
        if torch.cuda.is_available():
            navn = torch.cuda.get_device_name(0)
            cc = torch.cuda.get_device_capability(0)
            print(f"{OK}Torch ser kortet: {navn}, compute capability {cc[0]}.{cc[1]}")
            # Et kort som er nyere enn torch-bygget kompilerer ikke. Symptomet er
            # «no kernel image is available for execution on the device».
            støttet = torch.cuda.get_arch_list()
            sm = f"sm_{cc[0]}{cc[1]}"
            if sm not in støttet:
                print(f"{FEIL}Dette torch-bygget har ingen kjerner for {sm}.")
                print(f"      Bygget støtter: {', '.join(støttet)}")
                print("      Installer et nyere torch-hjul.")
                mangler.append("torch-arch")
        else:
            print(f"{FEIL}Torch ser ikke kortet. Driver eller torch-bygg passer ikke.")
            mangler.append("torch-cuda")

    # ── 3. CUDA Toolkit ─────────────────────────────────────────────────────
    tk = finn_cuda_toolkit()
    if tk:
        ver = kjor(["nvcc", "--version"]) or ""
        siste = ver.strip().splitlines()[-1] if ver else str(tk)
        print(f"{OK}CUDA Toolkit: {siste}")
    else:
        print(f"{FEIL}CUDA Toolkit (nvcc) mangler.")
        print("      Torch har sin EGEN CUDA-runtime, så kortet kan virke uten denne —")
        print("      men gsplat kompilerer kjernene sine ved første bruk og trenger nvcc.")
        print("      https://developer.nvidia.com/cuda-downloads")
        mangler.append("cuda-toolkit")

    # ── 4. C++-kompilator ───────────────────────────────────────────────────
    msvc = finn_msvc()
    if msvc:
        print(f"{OK}Visual Studio / Build Tools: {msvc}")
    else:
        print(f"{FEIL}MSVC Build Tools mangler (ingen cl.exe).")
        print("      nvcc trenger en vertskompilator på Windows.")
        print("      «Build Tools for Visual Studio», arbeidslasten «Desktop development with C++».")
        mangler.append("msvc")

    # ── 5. gsplat ───────────────────────────────────────────────────────────
    try:
        import gsplat
        from gsplat.cuda import _backend
    except ImportError:
        print(f"{FEIL}gsplat er ikke installert.")
        mangler.append("gsplat")
    else:
        if getattr(_backend, "_C", None) is None:
            # Dette er den feilen som er vond å finne selv: gsplat skriver én
            # linje på stderr ved import og fortsetter, og krasjer først langt
            # senere med en AttributeError som ikke nevner verktøykjeden.
            print(f"{FEIL}gsplat {gsplat.__version__} er installert, men kjernene er IKKE kompilert.")
            print("      Den skriver «No CUDA toolkit found» ved import og fortsetter stille.")
            print("      Feilen dukker først opp midt i en bake, som en AttributeError.")
            mangler.append("gsplat-kjerner")
        else:
            print(f"{OK}gsplat {gsplat.__version__} med kompilerte kjerner")

    # ── 6. Open3D ───────────────────────────────────────────────────────────
    try:
        import open3d as o3d
    except ImportError:
        print(f"{FEIL}Open3D er ikke installert.")
        mangler.append("open3d")
    else:
        n = 0
        try:
            n = o3d.core.cuda.device_count()
        except Exception:  # noqa: BLE001 — eldre bygg har ikke o3d.core.cuda
            pass
        if n > 0:
            print(f"{OK}Open3D {o3d.__version__} med CUDA ({n} enhet)")
        else:
            # Ikke en feil: pip-hjulet er CPU-only for alle. Verdt å si HVA det
            # betyr, slik at ingen tror GPU-poolen er ødelagt fordi TSDF er treg.
            print(f"{OK}Open3D {o3d.__version__} — CPU-only (som forventet fra pip)")
            print("      TSDF, pose-refine og teksturprojeksjon kjører på CPU.")
            print("      Fortsatt langt raskere enn telefonen. GPU krever egenbygd Open3D.")

    # ── Dom ─────────────────────────────────────────────────────────────────
    print()
    if not mangler:
        print("Alt på plass. Maskinen kan både fusjonere mesh og trene splats.")
        return 0

    tunge = {"cuda-toolkit", "msvc", "gsplat-kjerner"}
    if mangler and set(mangler) <= tunge:
        print("Mesh-bake virker. Splat-trening gjør det ikke.")
        print("Mangler: CUDA Toolkit og MSVC Build Tools — samme to som skal til")
        print("for å bygge Open3D med CUDA. Én installasjon, to gevinster.")
        return 1

    print("Mangler:", ", ".join(mangler))
    return 1


if __name__ == "__main__":
    sys.exit(main())
