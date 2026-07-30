#!/bin/bash
# Builds the CC Shot screenshot helper and the browser relaunch app.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APPS="$HOME/Applications"
BUNDLE_ID="${CC_BUNDLE_ID:-dev.browsercopilot.ccshot}"
mkdir -p "$APPS"

# --- ccwin : window ID lookup ----------------------------------------------
# CGWindowListCopyWindowInfo needs no Screen Recording permission for IDs and
# bounds, so this stays a plain binary. It feeds `screencapture -l`.
echo "→ compiling ccwin..."
swiftc -O "$HERE/ccwin.swift" -o "$HERE/ccwin"
echo "✅ $HERE/ccwin"

# --- CC Shot : ScreenCaptureKit helper ------------------------------------
# Packaged as an app so macOS attributes the Screen Recording permission to
# the helper itself, not to whatever terminal or agent runtime invoked it.
SHOT="$APPS/CC Shot.app"
rm -rf "$SHOT"
mkdir -p "$SHOT/Contents/MacOS"
cat > "$SHOT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>CC Shot</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>ccshot</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Captures the browser window for the agent.</string>
</dict>
</plist>
PLIST
echo "→ compiling ccshot..."
swiftc -O "$HERE/ccshot.swift" -o "$SHOT/Contents/MacOS/ccshot"

# Sign with a Developer ID if one is available. This matters: macOS binds the
# Screen Recording grant to the signing identity, so a stable identity survives
# rebuilds. Ad-hoc signing binds it to the binary's cdhash instead, which means
# every recompile silently revokes the permission.
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep 'Developer ID Application' | head -1 | sed 's/.*"\(.*\)"/\1/')"
if [ -n "$IDENTITY" ]; then
  codesign --force --options runtime -s "$IDENTITY" --identifier "$BUNDLE_ID" "$SHOT"
  echo "✅ $SHOT (signed: $IDENTITY)"
  echo "   → the Screen Recording grant will survive future rebuilds"
else
  codesign --force -s - --identifier "$BUNDLE_ID" "$SHOT"
  echo "✅ $SHOT (ad-hoc signed)"
  echo "   ⚠️  no Developer ID found: every rebuild revokes the Screen Recording"
  echo "      grant. Re-run 'tccutil reset ScreenCapture $BUNDLE_ID' after each one."
fi

# --- Browser relaunch app --------------------------------------------------
BROWSER_APP="${CC_BROWSER_APP:-/Applications/Dia.app}"
NAME="$(basename "$BROWSER_APP" .app)"
LAUNCH="$APPS/$NAME Copilot.app"
rm -rf "$LAUNCH"
mkdir -p "$LAUNCH/Contents/MacOS" "$LAUNCH/Contents/Resources"
cat > "$LAUNCH/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME Copilot</string>
  <key>CFBundleIdentifier</key><string>dev.browsercopilot.launcher</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
cat > "$LAUNCH/Contents/MacOS/launch" <<SH
#!/bin/bash
exec "$HERE/relaunch.sh"
SH
chmod +x "$LAUNCH/Contents/MacOS/launch"
ICON="$(ls "$BROWSER_APP/Contents/Resources/"*.icns 2>/dev/null | head -1 || true)"
[ -n "$ICON" ] && cp "$ICON" "$LAUNCH/Contents/Resources/app.icns"
echo "✅ $LAUNCH"

cat <<'EOF'

Next steps
  1. Enable the AppleScript JS bridge:   ./relaunch.sh
  2. Grant Screen Recording to "CC Shot":
     System Settings > Privacy & Security > Screen Recording
     (the prompt appears on the first `node copilot.mjs shot`)
  3. Try it:   node copilot.mjs tabs
EOF
