# Production macOS App

This repo now supports a single installable Electron app bundle that carries:

1. the Electron receiver app
2. the macOS bridge daemon
3. the native Camera Extension host app bundle

## Final user flow

1. Install `ElectronVirtualCamera.pkg`
2. Open `Electron Virtual Camera.app`
3. The app auto-starts the bridge daemon
4. On first launch the bundled Camera Extension host app opens for activation
5. Approve the Camera Extension in macOS
6. Open the phone app and connect to Electron
7. Select `Electron Virtual Camera` in FaceTime / Zoom / Meet / Brave

## Build the installable app

### 1. Build the native Camera Extension host app first

You need a built `ElectronVirtualCameraHost.app` bundle.

Default expected path:

```bash
/Users/jervi/Desktop/cam-ios-opencode-2/virtualcam/macos/build/Release/ElectronVirtualCameraHost.app
```

If it lives elsewhere, pass:

```bash
VIRTUALCAM_HOST_APP="/absolute/path/to/ElectronVirtualCameraHost.app"
```

### 2. Build the final installer

```bash
cd /Users/jervi/Desktop/cam-ios-opencode-2/desktop
npm install
npm run package:macos-installer
```

Installer output:

```bash
desktop/out/installers/ElectronVirtualCamera.pkg
```

## What the packaging script does

1. builds `virtualcam/macos/BridgeDaemon`
2. stages the daemon into `desktop/native/macos/`
3. copies the built `ElectronVirtualCameraHost.app` into `desktop/native/macos/`
4. packages Electron with the native assets embedded as app resources
5. creates a `.pkg` installer

## Runtime behavior

On macOS, the packaged Electron app now:

1. auto-starts the bundled bridge daemon on port `19777`
2. opens the bundled native Camera Extension host app once on first launch

## Required one-time approval

The user must still approve the Camera Extension in macOS the first time.

After approval, normal use is:

1. open `Electron Virtual Camera.app`
2. start the mobile stream
3. pick `Electron Virtual Camera` in the target app
