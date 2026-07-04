#!/usr/bin/env bash
# Setter R2-hemmelighetene i Supabase fra Cloudflare-credential-fila.
# Kjør i Terminal.app (der supabase-CLI-en er innlogget):  bash scripts/set-r2-secrets.sh
set -euo pipefail

FILE="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Downloads/dht_1.txt"
REF="vymgogzcicbaizjlaurr"
BUCKET="ampex-media"

[ -f "$FILE" ] || { echo "Fant ikke $FILE"; exit 1; }

# Verdi = første ikke-tomme linje ETTER en linje som inneholder etiketten.
val_after() {
  awk -v lbl="$1" 'found && NF { print; exit } index($0, lbl) { found=1 }' "$FILE"
}

ACCESS_KEY_ID="$(val_after 'Access Key ID')"
SECRET_ACCESS_KEY="$(val_after 'Secret Access Key')"
# Konto-ID hentes trygt fra S3-endepunktet (https://<konto>.r2.cloudflarestorage.com)
ACCOUNT_ID="$(sed -n 's#.*https://\([A-Za-z0-9]*\)\.r2\.cloudflarestorage\.com.*#\1#p' "$FILE" | head -1)"

if [ -z "$ACCOUNT_ID" ] || [ -z "$ACCESS_KEY_ID" ] || [ -z "$SECRET_ACCESS_KEY" ]; then
  echo "Klarte ikke lese alle verdiene fra fila (konto:${#ACCOUNT_ID} key:${#ACCESS_KEY_ID} secret:${#SECRET_ACCESS_KEY} tegn)"; exit 1
fi

echo "Setter R2-hemmeligheter (konto-id ${#ACCOUNT_ID} tegn, key ${#ACCESS_KEY_ID}, secret ${#SECRET_ACCESS_KEY})…"
supabase secrets set \
  "R2_ACCOUNT_ID=$ACCOUNT_ID" \
  "R2_ACCESS_KEY_ID=$ACCESS_KEY_ID" \
  "R2_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY" \
  "R2_BUCKET_NAME=$BUCKET" \
  --project-ref "$REF"

echo "✅ R2-hemmeligheter satt. Si ifra til Claude, så verifiserer og tester han."
