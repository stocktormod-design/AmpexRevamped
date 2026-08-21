# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller-oppskrift for ampex-worker.exe.

Bygg:  .\.venv\Scripts\python.exe -m PyInstaller ampex-worker.spec --noconfirm

Det som avgjør størrelsen er hva som holdes UTE. Venv-et er 4,8 GB, og
mesteparten er PyTorch. Bake-pipelinen bruker den ikke i det hele tatt —
Open3D-hjulet fra pip er CPU-only (se bake.py), og torch ble tidligere importert
bare for å lese GPU-navnet. Det gjør ampex_worker/gpu.py nå, via nvidia-smi.
Derfor står torch i `excludes` og ikke i bygget.
"""
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []

# Open3D laster ressurser og C++-utvidelser i runtime; uten collect_all finner
# den dem ikke i et frosset bygg.
for pakke in ("open3d", "xatlas", "pygltflib", "trimesh"):
    d, b, h = collect_all(pakke)
    datas += d
    binaries += b
    hiddenimports += h

UTE = [
    # ~2,5 GB, og ubrukt — se modulkommentaren.
    "torch", "torchvision", "torchaudio",
    # Drar inn Qt/GTK og et halvt vindussystem. Worker-en har ikke GUI.
    "matplotlib", "tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6",
    # Notatbok- og testverktøy fra venv-et, ikke fra koden.
    "IPython", "jupyter", "notebook", "pytest", "sphinx",
    # SciPy brukes ikke direkte; Open3D tar med det den trenger selv.
    "scipy.spatial.cKDTree",
]

a = Analysis(
    ["run_worker.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + ["ampex_worker.bake", "ampex_worker.frames",
                                   "ampex_worker.api", "ampex_worker.gpu",
                                   "ampex_worker.konfig"],
    hookspath=[],
    runtime_hooks=[],
    excludes=UTE,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="ampex-worker",
    debug=False,
    strip=False,
    # UPX komprimerer ikke Open3D-DLL-ene forsvarlig og gir sporadiske
    # innlastingsfeil. Størrelsen er ikke verdt en worker som ikke starter.
    upx=False,
    console=True,
)

# onedir, ikke onefile: onefile pakker ut ~1 GB til temp ved HVER oppstart, og
# en worker som står på en verkstedsPC startes ofte. Katalogbygget starter
# raskt og lar en installatør se hva som faktisk ligger der.
coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False,
    name="ampex-worker",
)
