"""Inngangspunkt for både `python -m ampex_worker` og den frosne exe-en."""
from .main import main

if __name__ == "__main__":
    raise SystemExit(main())
