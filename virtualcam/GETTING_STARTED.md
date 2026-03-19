# Getting Started

## Linux (usable now)

1. Start desktop receiver (`desktop` app) and keep video visible.
2. In terminal:
   1. `cd virtualcam/linux`
   2. `./setup-v4l2loopback.sh`
   3. `./start-electron-virtualcam.sh`
3. Open target app (Zoom/Meet/etc.) and choose `Electron Virtual Camera`.
4. Stop bridge:
   1. `./stop-electron-virtualcam.sh`

## macOS (native implementation track)

1. Start the desktop receiver and connect mobile stream.
2. In desktop app, enable `Virtual Camera Bridge` (host `127.0.0.1`, port `19777`).
3. Build/run bridge daemon:
   1. `cd virtualcam/macos/BridgeDaemon`
   2. `swift build -c release`
   3. `.build/release/ElectronVirtualCamBridgeDaemon --port 19777`
4. Continue native camera work in `virtualcam/macos/README.md` + `CameraExtensionSkeleton/`.
5. Build/sign the host app + Camera Extension with your Apple Team, then approve the extension.

## Windows (native implementation track)

1. Start the desktop receiver and connect mobile stream.
2. In desktop app, enable `Virtual Camera Bridge` (host `127.0.0.1`, port `19777`).
3. Build/run bridge daemon:
   1. `cd virtualcam\\windows\\BridgeDaemon`
   2. `cmake -S . -B build -G \"Visual Studio 17 2022\" -A x64`
   3. `cmake --build build --config Release`
   4. `build\\Release\\ElectronVirtualCamBridgeDaemon.exe --port 19777`
4. Continue native camera work in `virtualcam/windows/README.md` + `VirtualCamSkeleton/`.
5. Register/start the MF virtual camera source and select it in the target app.

## OBS Plugin (recommended now)

1. Build/install `obs-plugin/electron_bridge_source`.
2. In OBS, add source `Electron Camera Bridge (TCP)` and keep port `19777`.
3. In Electron app virtual bridge settings:
   1. Enable bridge
   2. Host `127.0.0.1`
   3. Port `19777`
   4. Encoding `RAW RGBA (OBS plugin)`
4. Mobile stream appears inside OBS through the existing Mobile -> Electron WebRTC path.
