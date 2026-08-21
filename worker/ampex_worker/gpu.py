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
    print(gpu_name())
