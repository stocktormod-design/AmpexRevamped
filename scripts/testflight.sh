#!/usr/bin/env bash
# Arkiverer Ampex og laster opp til App Store Connect (TestFlight).
#
# Innlogging, én av to:
#   1. Apple-ID i Xcode → Settings → Accounts (team Z4ZUZRL65Q), eller
#   2. API-nøkkel fra App Store Connect → Users and Access → Integrations, med
#      tilgang Admin (App Manager får ikke lage distribusjonssertifikat i skyen):
#        ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_XXXX.p8 scripts/testflight.sh
#
# Byggenummeret er tid (ÅÅMMDDTTMM), så to opplastinger aldri kolliderer.
set -euo pipefail
cd "$(dirname "$0")/../ios"

BUILD=$(date +%y%m%d%H%M)
UT=build/testflight
ARKIV="$UT/Ampex-$BUILD.xcarchive"
mkdir -p "$UT"

AUTH=(-allowProvisioningUpdates)
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  AUTH+=(-authenticationKeyID "$ASC_KEY_ID"
         -authenticationKeyIssuerID "$ASC_ISSUER_ID"
         -authenticationKeyPath "${ASC_KEY_PATH/#\~/$HOME}")
fi

cat > "$UT/ExportOptions.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>Z4ZUZRL65Q</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "▸ Arkiverer bygg $BUILD"
xcodebuild archive \
  -workspace Ampex.xcworkspace -scheme Ampex -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARKIV" \
  CURRENT_PROJECT_VERSION="$BUILD" "${AUTH[@]}" -quiet

echo "▸ Laster opp"
xcodebuild -exportArchive -archivePath "$ARKIV" \
  -exportOptionsPlist "$UT/ExportOptions.plist" -exportPath "$UT/eksport-$BUILD" \
  "${AUTH[@]}"

echo "✓ Bygg $BUILD lastet opp. Det dukker opp i TestFlight etter behandling (5–30 min)."
