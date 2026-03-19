#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
OUT_DIR="$DESKTOP_DIR/out"
INSTALLER_DIR="$OUT_DIR/installers"

bash "$DESKTOP_DIR/scripts/stage-macos-native.sh"

echo "[package] Packaging Electron app"
npm --prefix "$DESKTOP_DIR" run package

APP_PATH="$(find "$OUT_DIR" -maxdepth 3 -type d -name "Electron Virtual Camera.app" | head -n 1)"

if [ -z "$APP_PATH" ]; then
  echo "[package] Could not find packaged Electron app in $OUT_DIR" >&2
  exit 1
fi

mkdir -p "$INSTALLER_DIR"
PKG_PATH="$INSTALLER_DIR/ElectronVirtualCamera.pkg"
rm -f "$PKG_PATH"

echo "[package] Creating installer pkg"
pkgbuild \
  --component "$APP_PATH" \
  --identifier "com.jervi.electron-virtual-camera" \
  --install-location "/Applications" \
  "$PKG_PATH"

echo "[package] Created $PKG_PATH"
