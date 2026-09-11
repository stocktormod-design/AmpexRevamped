"""Innebygde standarder, så exe-en kan meldes inn med bare en kode.

anon-nøkkelen er offentlig av design — den er den samme som ligger i mobilappen
og i kontorappens JavaScript. Den gir ingen tilgang i seg selv; alt bak den er
beskyttet av RLS, og worker-en autentiserer med sitt node-token. Å legge den
her er derfor ikke en lekkasje, det er å slippe at installatøren skal taste inn
en 200 tegn lang streng fra en telefonskjerm.

Kan overstyres med --url / --anon, eller AMPEX_SUPABASE_URL / AMPEX_ANON_KEY.
"""
from __future__ import annotations

import os

DEFAULT_SUPABASE_URL = os.environ.get("AMPEX_SUPABASE_URL", "https://vymgogzcicbaizjlaurr.supabase.co")
DEFAULT_ANON_KEY = os.environ.get("AMPEX_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5bWdvZ3pjaWNiYWl6amxhdXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDUwMzgsImV4cCI6MjA5ODMyMTAzOH0.HYNjbWAItcvB13oA8Y1FXSzCCP5iH_wYGi0gQzC7rLw")
