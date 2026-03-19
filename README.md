# Cam Stream Bridge

Camera streaming system built around an Electron receiver.

Pipeline:

1. `mobile/` captures video on iPhone.
2. `desktop/` receives the stream over WebRTC.
3. `desktop/` can forward frames to:
   - `obs-plugin/` through `EVRG` raw RGBA packets
   - `virtualcam/` through `EVCM` JPEG packets

## Repo Layout

- `mobile/` Expo iOS sender app
- `desktop/` Electron receiver and packaging flow
- `obs-plugin/` OBS source plugin integration
- `virtualcam/` native virtual camera paths for macOS, Linux, and Windows

## Quick Start

1. Install deps:

```bash
cd mobile && npm install
cd ../desktop && npm install
```

2. Start Electron:

```bash
cd desktop
npm start
```

3. Run the phone app:

```bash
cd mobile
npx expo run:ios --device
```

4. In the phone app, connect to `ws://YOUR_MAC_IP:3333`.

5. Confirm the stream appears in Electron.

Detailed run guide:

- `RUN_PROJECT.md`

## Outputs

### OBS

- Follow `obs-plugin/electron_bridge_source/README.md`
- In Electron use `RAW RGBA (OBS plugin)` on port `19777`

### macOS Virtual Camera

- Follow `virtualcam/macos/BUILD_CAMERA_EXTENSION.md`
- Production packaging flow is in `desktop/PRODUCTION_MACOS.md`
- In Electron use `jpeg` on port `19777`

## Frame Protocol

- `EVRG` = OBS plugin path
- `EVCM` = native virtual camera path
- Spec: `virtualcam/protocol/FRAME_PROTOCOL.md`

## Current Status

- `mobile -> Electron` is the main stable path
- OBS plugin path is implemented
- native virtual camera work exists under `virtualcam/`, with macOS templates and packaging scaffolding in place

## Main Docs

- `RUN_PROJECT.md`
- `obs-plugin/README.md`
- `virtualcam/README.md`
- `virtualcam/macos/BUILD_CAMERA_EXTENSION.md`
- `desktop/PRODUCTION_MACOS.md`
