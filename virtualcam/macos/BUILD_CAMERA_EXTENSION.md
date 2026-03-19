# Build macOS Virtual Camera

## 1. Run Electron and mobile first

```bash
cd /Users/jervi/Desktop/cam-ios-opencode-2/desktop
npm start
```

Run the mobile app and connect it to Electron.

## 2. Enable Electron virtual camera bridge

In the Electron app set:

1. Enable: ON
2. Host: `127.0.0.1`
3. Port: `19777`
4. Encoding: `jpeg`

## 3. Run the macOS bridge daemon

```bash
cd /Users/jervi/Desktop/cam-ios-opencode-2/virtualcam/macos/BridgeDaemon
swift build -c release
.build/release/ElectronVirtualCamBridgeDaemon --port 19777
```

Verify output:

```bash
ls /tmp/electron-virtualcam
open /tmp/electron-virtualcam/latest_frame.jpg
```

## 4. Create the Xcode project

In Xcode:

1. Create a new `App` project for macOS.
2. Add a new target: `Camera Extension`.
3. Copy files from `virtualcam/macos/XcodeTemplate/HostApp/` into the host target.
4. Copy files from `virtualcam/macos/XcodeTemplate/CameraExtension/` into the extension target.
5. Use the provided plist and entitlements templates.

## 5. Add entry points

Host app:

1. Open `virtualcam/macos/XcodeTemplate/HostApp/ElectronVirtualCameraHostApp.swift`.
2. Add `@main` above `struct ElectronVirtualCameraHostApp: App`.

Camera extension:

1. Add a new `main.swift` file to the extension target with:

```swift
import Foundation

do {
    try CameraExtensionService.start()
    RunLoop.main.run()
} catch {
    fputs("[camera-extension] startup failed: \(error.localizedDescription)\n", stderr)
    exit(EXIT_FAILURE)
}
```

## 6. Set bundle identifiers

Recommended:

1. Host app: `com.jervi.ElectronVirtualCameraHost`
2. Extension: `com.jervi.ElectronVirtualCameraHost.CameraExtension`

## 7. Set signing and entitlements

Host app:

1. Select your Apple Team.
2. Enable `Automatically manage signing`.
3. Add entitlement: `com.apple.developer.system-extension.install`

Camera extension:

1. Select the same Apple Team.
2. Enable `Automatically manage signing`.
3. Add entitlement: `com.apple.developer.coremediaio.camera-extension`

## 8. Embed the extension

Make sure the Camera Extension target is embedded inside the host app bundle under:

```text
YourApp.app/Contents/Library/SystemExtensions/
```

## 9. Build and run the host app

From Xcode:

1. Build the host app.
2. Run the host app.
3. Click `Install / Activate`.
4. Approve the system extension when macOS prompts.

## 10. Verify installation

```bash
systemextensionsctl list
```

You should see your camera extension listed.

## 11. Test in apps

Open one of these and choose `Electron Virtual Camera`:

1. FaceTime
2. Zoom
3. Google Meet in Brave
4. OBS camera device picker

## 12. If it does not appear

Check:

1. Electron preview is receiving the phone stream.
2. Bridge daemon is updating `/tmp/electron-virtualcam/latest_frame.jpg`.
3. `systemextensionsctl list` shows the extension as enabled.
4. Host app and extension are signed with the same team.
