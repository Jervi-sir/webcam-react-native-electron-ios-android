# macOS Native Virtual Camera (CoreMediaIO Camera Extension)

Goal: register a real camera device visible to Zoom/Meet/Teams as a system camera.

## Required components

1. Host macOS app (for installation lifecycle and user approval flow).
2. Camera Extension target (`com.apple.cmio.CameraExtension`).
3. Entitlements and signing:
   - `com.apple.developer.coremediaio.camera-extension`
   - `com.apple.developer.system-extension.install`
4. IPC transport between Electron receiver and extension.
   - implemented here: loopback TCP bridge protocol (`127.0.0.1:19777`).
5. Bridge daemon (`BridgeDaemon/`) to receive frames from Electron and expose latest artifacts.

## What to implement

1. In extension:
   - `CMIOExtensionProvider`
   - `CMIOExtensionDeviceSource`
   - `CMIOExtensionStreamSource`
   - frame pacing + timestamping for stable output.
   - consume frames via `CameraExtensionSkeleton/LoopbackTCPFrameBridge`.
2. In host app:
   - install/update/remove extension
   - trigger system approval prompt
   - display extension state.
3. In daemon:
   - build/run `BridgeDaemon` (`swift build -c release`)
   - verify `latest_frame.jpg/json` updates in `/tmp/electron-virtualcam`.
4. In Electron:
   - enable `Virtual Camera Bridge` in desktop UI.

## Notes

1. This cannot be completed by Electron-only code.
2. It must be built and signed in Xcode with your Apple Team.
3. Test with:
   - FaceTime camera selector
   - `systemextensionsctl list`
   - Zoom camera dropdown.

## Starter files

1. `BridgeDaemon/`: runnable Swift daemon that ingests frame protocol from Electron.
2. `CameraExtensionSkeleton/`: extension-side bridge interfaces and parser.
3. `XcodeTemplate/`: host app + Camera Extension source templates for building the real macOS virtual camera path.
