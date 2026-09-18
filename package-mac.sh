#!/usr/bin/env bash
# package-mac.sh — Build weather-dashboard as a macOS .app bundle (arm64)
#
# Usage:
#   chmod +x package-mac.sh
#   ./package-mac.sh
#
# Output: dist/weather-dashboard.app  (drag to /Applications to install)

set -euo pipefail

APP_NAME="weather-dashboard"
DISPLAY_NAME="Weather Dashboard"
BUNDLE_ID="com.kdekorte.weather-dashboard"
VERSION="1.0.0"
BINARY_NAME="${APP_NAME}-mac_arm64"
BUILD_DIR="dist/${APP_NAME}"
APP_BUNDLE="dist/${DISPLAY_NAME}.app"

# ── 1. Build ─────────────────────────────────────────────────────────────────
echo "→ Building Neutralino app..."
neu build

# ── 2. Verify the arm64 binary exists ────────────────────────────────────────
if [ ! -f "${BUILD_DIR}/${BINARY_NAME}" ]; then
  echo "ERROR: Expected binary not found: ${BUILD_DIR}/${BINARY_NAME}"
  echo "       Run 'neu update' first to download binaries."
  exit 1
fi

# ── 3. Create .app bundle structure ──────────────────────────────────────────
echo "→ Creating .app bundle..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"

# ── 4. Copy binary ───────────────────────────────────────────────────────────
cp "${BUILD_DIR}/${BINARY_NAME}" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
chmod +x "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"

# ── 5. Copy app resources ────────────────────────────────────────────────────
cp "${BUILD_DIR}/resources.neu"     "${APP_BUNDLE}/Contents/MacOS/resources.neu"
# neutralino.config.json must live next to the binary so NL_PATH resolves it
cp neutralino.config.json           "${APP_BUNDLE}/Contents/MacOS/neutralino.config.json"

# ── 5b. Compile CoreLocation helper ──────────────────────────────────────────
# This Swift helper calls CoreLocation directly (WKWebView does not expose
# navigator.geolocation to apps signed without a developer certificate).
# The Info.plist is embedded so macOS TCC can match the bundle identifier
# when deciding whether to grant location permission.
echo "→ Compiling CoreLocation helper..."
swiftc src/get-location.swift -o "${APP_BUNDLE}/Contents/MacOS/get-location" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
  -Xlinker src/get-location-info.plist
chmod +x "${APP_BUNDLE}/Contents/MacOS/get-location"
# Sign the helper explicitly so its identifier matches the embedded plist
codesign --force --sign "-" \
  --identifier "com.kdekorte.weather-dashboard.location-helper" \
  --entitlements entitlements.plist \
  "${APP_BUNDLE}/Contents/MacOS/get-location"

# ── 6. Copy icon (convert PNG → icns if sips is available) ───────────────────
ICON_PNG="resources/icons/app.png"
ICNS_PATH="${APP_BUNDLE}/Contents/Resources/${APP_NAME}.icns"

if command -v sips &>/dev/null && command -v iconutil &>/dev/null; then
  echo "→ Generating .icns icon..."
  ICONSET_DIR="/tmp/${APP_NAME}.iconset"
  rm -rf "${ICONSET_DIR}"
  mkdir -p "${ICONSET_DIR}"
  for size in 16 32 64 128 256 512; do
    sips -z ${size} ${size} "${ICON_PNG}" \
      --out "${ICONSET_DIR}/icon_${size}x${size}.png" &>/dev/null
    double=$((size * 2))
    sips -z ${double} ${double} "${ICON_PNG}" \
      --out "${ICONSET_DIR}/icon_${size}x${size}@2x.png" &>/dev/null
  done
  iconutil -c icns "${ICONSET_DIR}" -o "${ICNS_PATH}"
  rm -rf "${ICONSET_DIR}"
else
  echo "→ sips/iconutil not found, copying PNG icon as fallback..."
  cp "${ICON_PNG}" "${APP_BUNDLE}/Contents/Resources/${APP_NAME}.png"
  ICNS_PATH="${APP_NAME}.png"
fi

# ── 7. Write Info.plist ───────────────────────────────────────────────────────
echo "→ Writing Info.plist..."
cat > "${APP_BUNDLE}/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Weather Dashboard</string>
  <key>CFBundleDisplayName</key>
  <string>Weather Dashboard</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>$(basename "${ICNS_PATH}")</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleSignature</key>
  <string>????</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSLocationWhenInUseUsageDescription</key>
  <string>Used to show local weather conditions and centre the map.</string>
</dict>
</plist>
PLIST

# ── 8. Ad-hoc code sign with location entitlement ────────────────────────────
echo "→ Code-signing (ad-hoc) with location entitlement..."
codesign --force --deep --sign "-" \
  --entitlements entitlements.plist \
  "${APP_BUNDLE}"

# ── 9. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "✓ Built: ${APP_BUNDLE}"
echo ""
echo "  To run:    open ${APP_BUNDLE}"
echo "  To install: cp -R ${APP_BUNDLE} /Applications/"
echo ""
echo "User config override (created by Settings → Set Location, or edit manually):"
echo "  ${APP_BUNDLE}/Contents/MacOS/weather.config.json"
echo ""
echo "Note: macOS may show a security warning on first launch."
echo "To allow it: System Settings → Privacy & Security → Open Anyway"
