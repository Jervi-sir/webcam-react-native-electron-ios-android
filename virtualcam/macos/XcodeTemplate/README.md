# macOS Camera Extension Template

This folder contains the missing native pieces for the `mobile -> Electron -> macOS virtual camera` path.

What is included:

1. `HostApp/`: SwiftUI host app template for installing/removing the Camera Extension.
2. `CameraExtension/`: CoreMediaIO Camera Extension source template.

What you still need to do in Xcode:

1. Create a new macOS App project.
2. Add a new target: `Camera Extension`.
3. Copy the files from this folder into the Xcode project.
4. Put the Camera Extension target inside the host app bundle under `Contents/Library/SystemExtensions`.
5. Set your Apple Team, bundle identifiers, entitlements, and signing.
6. Start Electron desktop app with virtual camera bridge enabled in `jpeg` mode.
7. Run the bridge daemon from `virtualcam/macos/BridgeDaemon`.
8. Build and run the host app, then approve the system extension when prompted.

Entry points to add in Xcode:

1. Host app target: mark `ElectronVirtualCameraHostApp` in `HostApp/ElectronVirtualCameraHostApp.swift` with `@main`.
2. Camera Extension target: add a tiny `main.swift` that calls `try CameraExtensionService.start()` and then `RunLoop.main.run()`.

Recommended bundle identifiers:

1. Host app: `com.jervi.ElectronVirtualCameraHost`
2. Camera Extension: `com.jervi.ElectronVirtualCameraHost.CameraExtension`

Required entitlements:

1. Host app: `com.apple.developer.system-extension.install`
2. Camera Extension: `com.apple.developer.coremediaio.camera-extension`

Expected runtime flow:

1. Mobile streams to Electron.
2. Electron sends `EVCM` JPEG frames to `127.0.0.1:19777`.
3. `BridgeDaemon` writes `/tmp/electron-virtualcam/latest_frame.jpg`.
4. Camera Extension polls that file, decodes JPEG, emits `CMSampleBuffer` frames.
5. FaceTime / Zoom / Meet / Brave can select the new camera.
