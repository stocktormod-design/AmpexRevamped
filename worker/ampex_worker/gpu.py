"""GPU-navn uten å dra inn PyTorch.

main.py brukte `torch.cuda.get_device_name(0)` til dette. Det er en riktig
avlesning, men torch er ~2,5 GB i et PyInstaller-bygg, og den ble importert
KUN for å skrive en streng i node-lista. Ingenting i bake-pipelinen bruker den
— Open3D-hjulet er CPU-only uansett (se bake.py).

Så: spør driveren i stedet. Feiler alt, er «ukjent» et helt greit svar; navnet
er kosmetikk i nodelista og skal aldri stoppe en bake.
"""
from __future__ import annotations

import subprocess

_TIMEOUT = 5.0
# Uten dette blinker et konsollvindu opp for hvert kall når exe-en kjøres
# windowed. CREATE_NO_WINDOW finnes bare på Windows.
_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _kjor(args: list[str]) -> str | None:
    try:
        ut = subprocess.run(args, capture_output=True, text=True,
                            timeout=_TIMEOUT, creationflags=_FLAGS)
    except (OSError, subprocess.SubprocessError):
        return None
    if ut.returncode != 0:
        return None
    for linje in ut.stdout.splitlines():
        linje = linje.strip()
        if linje and not linje.lower().startswith("name"):
            return linje
    return None


def _nvidia(felt: str) -> str | None:
    """Ett felt fra nvidia-smi. Samme kall, samme timeout, ett spørsmål."""
    return _kjor(["nvidia-smi", f"--query-gpu={felt}", "--format=csv,noheader"])


def vram_mb() -> int | None:
    """Minne på kortet i MiB, eller None når driveren ikke svarer.

    Ikke pynt i nodelista: dette er tallet som avgjør om en bake i det hele
    tatt får plass på kortet, og det første man ser etter når den samme jobben
    går på én maskin og feiler på en annen.

    nvidia-smi svarer «24564 MiB». Vi vil ha tallet.
    """
    raa = _nvidia("memory.total")
    if not raa:
        return None
    tall = "".join(c for c in raa if c.isdigit())
    return int(tall) if tall else None


def compute_capability() -> str | None:
    """CUDA compute capability, f.eks. «8.9». None når driveren ikke svarer.

    Eldre nvidia-smi kjenner ikke feltet og svarer med en feil i stedet for en
    verdi. Da er None riktig: kolonna er til for feilsøking, og en gjetning der
    er verre enn et tomt felt.
    """
    return _nvidia("compute_cap")


def gpu_name() -> str:
    # nvidia-smi først: den svarer med det driveren faktisk kjører, og det er
    # den avlesningen som betyr noe når vi skal feilsøke en bake.
    navn = _kjor(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])
    if navn:
        return navn

    # Ingen NVIDIA-driver. Da holder det Windows mener om skjermkortet.
    navn = _kjor(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                  "(Get-CimInstance Win32_VideoController |"
                  " Select-Object -First 1 -ExpandProperty Name)"])
    if navn:
        return navn

    return "ukjent"


if __name__ == "__main__":
    print(f"navn:   {gpu_name()}")
    print(f"vram:   {vram_mb()} MiB")
    print(f"compute: {compute_capability()}")
