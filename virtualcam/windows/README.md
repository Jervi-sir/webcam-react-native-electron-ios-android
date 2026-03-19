# Windows Native Virtual Camera (Media Foundation Virtual Camera)

Goal: expose a real camera device to Windows apps (Zoom/Meet/Teams/OBS/browser).

## Required components

1. Windows 11 virtual camera API path (Media Foundation).
2. Native C++ module/service that:
   - registers virtual camera
   - accepts frames from Electron
   - pushes frames to MF source stream.
3. Build with Visual Studio + Windows SDK.

## Suggested architecture

1. Electron receiver app:
   - decode remote WebRTC stream
   - publish frames over loopback TCP frame protocol (`127.0.0.1:19777`).
2. Native virtual camera service:
   - reads latest frame from TCP bridge
   - keeps stable frame pacing
   - converts to required media subtype.
3. Registration helper:
   - install/uninstall lifecycle
   - startup integration.

## Notes

1. This cannot be implemented purely in Electron JS.
2. Requires native Windows toolchain and packaging/signing flow.
3. Keep frame format simple first: BGRA or NV12.

## Starter files

1. `BridgeDaemon/`: runnable Winsock daemon that ingests frame protocol from Electron.
2. `VirtualCamSkeleton/`: frame-bridge and MF source starter interfaces.

## Build path

1. Build/run daemon:
   - `cmake -S BridgeDaemon -B BridgeDaemon/build -G \"Visual Studio 17 2022\" -A x64`
   - `cmake --build BridgeDaemon/build --config Release`
   - `BridgeDaemon\\build\\Release\\ElectronVirtualCamBridgeDaemon.exe --port 19777`
2. Enable `Virtual Camera Bridge` in Electron desktop UI.
3. Integrate `VirtualCamSkeleton/` into your MF virtual camera source registration flow.
