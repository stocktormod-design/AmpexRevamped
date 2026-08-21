"""Startpunkt for det frosne bygget.

Må ligge UTENFOR pakken og bruke absolutt import: PyInstaller kjører
inngangsskriptet som `__main__`, uten pakkekontekst, så `from .main import main`
feiler med «attempted relative import with no known parent package».
`ampex_worker/__main__.py` beholdes for `python -m ampex_worker`, der -m
setter pakken og relativ import er riktig.
"""
from ampex_worker.main import main

if __name__ == "__main__":
    raise SystemExit(main())
