#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
NATIVE_DIR="$DESKTOP_DIR/native/macos"
BRIDGE_DAEMON_DIR="$ROOT_DIR/virtualcam/macos/BridgeDaemon"
BRIDGE_DAEMON_BINARY="$BRIDGE_DAEMON_DIR/.build/release/ElectronVirtualCamBridgeDaemon"

HOST_APP_INPUT="${VIRTUALCAM_HOST_APP:-$ROOT_DIR/virtualcam/macos/build/Release/ElectronVirtualCameraHost.app}"

mkdir -p "$NATIVE_DIR"

echo "[stage] Building macOS bridge daemon"
swift build -c release --package-path "$BRIDGE_DAEMON_DIR"

if [ ! -x "$BRIDGE_DAEMON_BINARY" ]; then
  echo "[stage] Missing bridge daemon binary: $BRIDGE_DAEMON_BINARY" >&2
  exit 1
fi

rm -f "$NATIVE_DIR/ElectronVirtualCamBridgeDaemon"
cp "$BRIDGE_DAEMON_BINARY" "$NATIVE_DIR/ElectronVirtualCamBridgeDaemon"
chmod +x "$NATIVE_DIR/ElectronVirtualCamBridgeDaemon"

if [ ! -d "$HOST_APP_INPUT" ]; then
  echo "[stage] Missing native host app bundle: $HOST_APP_INPUT" >&2
  echo "[stage] Build the Camera Extension host app first, then re-run with VIRTUALCAM_HOST_APP=/absolute/path/to/ElectronVirtualCameraHost.app" >&2
  exit 1
fi

rm -rf "$NATIVE_DIR/ElectronVirtualCameraHost.app"
cp -R "$HOST_APP_INPUT" "$NATIVE_DIR/ElectronVirtualCameraHost.app"

echo "[stage] Staged native macOS assets in $NATIVE_DIR"
