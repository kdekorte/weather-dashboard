#!/usr/bin/env bash
#
# release.sh — Release management for weather-dashboard
#
# Usage:
#   ./release.sh              Show current version and status
#   ./release.sh tag          Tag the current commit and push
#   ./release.sh package      Build the arm64 .app bundle and tarball
#   ./release.sh release      Create GitHub release and upload the tarball
#   ./release.sh formula      Update the Homebrew formula with correct version and SHA256
#   ./release.sh all          Run tag, package, release, and formula in sequence
#
# Requires: gh (GitHub CLI) authenticated via `gh auth login`
#           neu (Neutralino CLI) — npm install -g @neutralinojs/neu
#

set -euo pipefail

FORMULA="Casks/weather-dashboard.rb"
APP_NAME="weather-dashboard"
DISPLAY_NAME="Weather Dashboard"
BUILD_DIR="dist/${APP_NAME}"
APP_BUNDLE="dist/${DISPLAY_NAME}.app"

# Read version from neutralino.config.json (portable — no jq required)
VERSION=$(grep '"appVersion"' neutralino.config.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
TAG="v${VERSION}"

ARM64_TARBALL="${APP_NAME}-macos-arm64-${VERSION}.tar.gz"
ARM64_URL="https://github.com/kdekorte/weather-dashboard/releases/download/${TAG}/${ARM64_TARBALL}"

info()    { printf "\033[1;34m==>\033[0m \033[1m%s\033[0m\n" "$1"; }
success() { printf "\033[1;32m==>\033[0m \033[1m%s\033[0m\n" "$1"; }
error()   { printf "\033[1;31mError:\033[0m %s\n" "$1" >&2; exit 1; }

# ── status ─────────────────────────────────────────────────────────────────────

show_status() {
    info "weather-dashboard release status"
    echo "  Version:       ${VERSION}"
    echo "  Tag:           ${TAG}"
    echo "  Formula:       ${FORMULA}"
    echo "  arm64 tarball: ${ARM64_TARBALL}"
    echo ""

    if git rev-parse "${TAG}" >/dev/null 2>&1; then
        success "Tag ${TAG} exists locally"
    else
        echo "  Tag ${TAG} has not been created yet"
    fi

    if command -v gh >/dev/null 2>&1; then
        if gh release view "${TAG}" >/dev/null 2>&1; then
            success "GitHub release ${TAG} exists"
        else
            echo "  GitHub release ${TAG} has not been created yet"
        fi
    else
        echo "  gh CLI not found — cannot check GitHub release status"
    fi
}

# ── tag ────────────────────────────────────────────────────────────────────────

do_tag() {
    info "Tagging release ${TAG}"

    if git rev-parse "${TAG}" >/dev/null 2>&1; then
        error "Tag ${TAG} already exists. Bump binaryVersion in neutralino.config.json first."
    fi

    if ! git diff --quiet || ! git diff --cached --quiet; then
        error "Working tree is dirty. Commit all changes before tagging."
    fi

    git tag -a "${TAG}" -m "Release ${VERSION}"
    info "Pushing tag ${TAG} to origin"
    git push origin "${TAG}"
    success "Tag ${TAG} created and pushed"
}

# ── package ────────────────────────────────────────────────────────────────────

do_package() {
    command -v neu >/dev/null 2>&1 || error "Neutralino CLI (neu) is required. Install with: npm install -g @neutralinojs/neu"

    info "Building Neutralino app (neu build)..."
    neu build

    # ── arm64 ──
    info "Packaging arm64 .app bundle..."
    rm -rf "${APP_BUNDLE}"
    mkdir -p "${APP_BUNDLE}/Contents/MacOS"
    mkdir -p "${APP_BUNDLE}/Contents/Resources"

    cp "${BUILD_DIR}/${APP_NAME}-mac_arm64" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
    chmod +x "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
    cp "${BUILD_DIR}/resources.neu"   "${APP_BUNDLE}/Contents/MacOS/resources.neu"
    cp neutralino.config.json         "${APP_BUNDLE}/Contents/MacOS/neutralino.config.json"

    info "Compiling CoreLocation helper..."
    swiftc src/get-location.swift -o "${APP_BUNDLE}/Contents/MacOS/get-location" \
        -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
        -Xlinker src/get-location-info.plist
    chmod +x "${APP_BUNDLE}/Contents/MacOS/get-location"
    codesign --force --sign "-" \
        --identifier "com.kdekorte.weather-dashboard.location-helper" \
        --entitlements entitlements.plist \
        "${APP_BUNDLE}/Contents/MacOS/get-location"

    _write_plist "${APP_BUNDLE}"
    _write_icns  "${APP_BUNDLE}"

    info "Ad-hoc code-signing with location entitlement..."
    codesign --force --deep --sign "-" \
        --entitlements entitlements.plist \
        "${APP_BUNDLE}"

    info "Creating ${ARM64_TARBALL}..."
    tar -czf "${ARM64_TARBALL}" -C dist "${DISPLAY_NAME}.app"
    success "Created ${ARM64_TARBALL}"

    rm -rf "${APP_BUNDLE}"
}

# Write Info.plist into the .app bundle
_write_plist() {
    local bundle="$1"
    cat > "${bundle}/Contents/Info.plist" << PLIST
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
  <string>com.kdekorte.weather-dashboard</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>${APP_NAME}.icns</string>
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
}

# Generate .icns (requires sips + iconutil, both ship with macOS Xcode CLT)
_write_icns() {
    local bundle="$1"
    local icon_png="resources/icons/app.png"
    local icns_path="${bundle}/Contents/Resources/${APP_NAME}.icns"

    if command -v sips &>/dev/null && command -v iconutil &>/dev/null; then
        local iconset="/tmp/${APP_NAME}.iconset"
        rm -rf "${iconset}"
        mkdir -p "${iconset}"
        for size in 16 32 64 128 256 512; do
            sips -z ${size} ${size} "${icon_png}" \
                --out "${iconset}/icon_${size}x${size}.png" &>/dev/null
            local double=$(( size * 2 ))
            sips -z ${double} ${double} "${icon_png}" \
                --out "${iconset}/icon_${size}x${size}@2x.png" &>/dev/null
        done
        iconutil -c icns "${iconset}" -o "${icns_path}"
        rm -rf "${iconset}"
    else
        info "sips/iconutil not found — copying PNG as fallback icon"
        cp "${icon_png}" "${bundle}/Contents/Resources/${APP_NAME}.png"
    fi
}

# ── release ────────────────────────────────────────────────────────────────────

do_release() {
    info "Creating GitHub release ${TAG}"

    command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is required. Install with: brew install gh"
    gh auth status >/dev/null 2>&1 || error "Not authenticated with gh. Run: gh auth login"

    git rev-parse "${TAG}" >/dev/null 2>&1 \
        || error "Tag ${TAG} does not exist. Run './release.sh tag' first."

    [ -f "${ARM64_TARBALL}" ] \
        || error "${ARM64_TARBALL} not found. Run './release.sh package' first."

    if gh release view "${TAG}" >/dev/null 2>&1; then
        info "Release ${TAG} already exists — uploading assets (overwriting if present)"
        gh release upload "${TAG}" \
            "${ARM64_TARBALL}" \
            --clobber
    else
        info "Creating new GitHub release ${TAG}"
        gh release create "${TAG}" \
            "${ARM64_TARBALL}" \
            --title "Weather Dashboard ${VERSION}" \
            --generate-notes
    fi

    success "GitHub release ${TAG} created with assets:"
    echo "  - ${ARM64_TARBALL}"
}

# ── formula ────────────────────────────────────────────────────────────────────

do_formula() {
    info "Updating Homebrew formula for ${TAG}"

    git rev-parse "${TAG}" >/dev/null 2>&1 \
        || error "Tag ${TAG} does not exist. Run './release.sh tag' first."

    info "Downloading arm64 tarball to compute SHA256..."
    ARM64_SHA=$(curl -fsSL "${ARM64_URL}" | shasum -a 256 | awk '{print $1}')
    [ ${#ARM64_SHA} -eq 64 ] \
        || error "Failed to compute arm64 SHA256. Has the release been published? Run './release.sh release' first."

    info "arm64 SHA256: ${ARM64_SHA}"

    # Update version and sha256; the cask url uses #{version} interpolation
    # so only these two lines need changing between releases.
    sed -i '' "s|version \".*\"|version \"${VERSION}\"|" "${FORMULA}"
    sed -i '' "s|sha256 \".*\"|sha256 \"${ARM64_SHA}\"|" "${FORMULA}"

    success "Formula updated: ${FORMULA}"
    echo ""
    echo "Commit and push the updated formula:"
    echo "  git add ${FORMULA}"
    echo "  git commit -m \"Update formula for ${VERSION}\""
    echo "  git push"
}

# ── all ────────────────────────────────────────────────────────────────────────

do_all() {
    do_tag
    echo ""
    do_package
    echo ""
    do_release
    echo ""
    do_formula
    echo ""
    info "All steps complete. Commit the updated formula:"
    echo "  git add ${FORMULA}"
    echo "  git commit -m \"Update formula for ${VERSION}\""
    echo "  git push"
}

# ── main ───────────────────────────────────────────────────────────────────────

case "${1:-status}" in
    status)  show_status ;;
    tag)     do_tag ;;
    package) do_package ;;
    release) do_release ;;
    formula) do_formula ;;
    all)     do_all ;;
    *)
        echo "Usage: $0 {status|tag|package|release|formula|all}"
        echo ""
        echo "Commands:"
        echo "  status    Show current version and release status (default)"
        echo "  tag       Create and push a git tag for the current version"
        echo "  package   Build the arm64 .app bundle and tarball"
        echo "  release   Create GitHub release and upload both tarballs"
        echo "  formula   Update the Homebrew formula URL and SHA256s"
        echo "  all       Run tag, package, release, and formula in sequence"
        exit 1
        ;;
esac
