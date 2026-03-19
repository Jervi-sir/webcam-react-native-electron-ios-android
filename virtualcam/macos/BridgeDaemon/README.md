# macOS Bridge Daemon

This daemon receives frame packets from Electron over `127.0.0.1:19777` and writes:

1. `latest_frame.jpg`
2. `latest_frame.json`

into `/tmp/electron-virtualcam` (default).

## Build

```bash
cd virtualcam/macos/BridgeDaemon
swift build -c release
```

## Run

```bash
cd virtualcam/macos/BridgeDaemon
.build/release/ElectronVirtualCamBridgeDaemon --port 19777
```

Optional output directory:

```bash
.build/release/ElectronVirtualCamBridgeDaemon --port 19777 --output /tmp/electron-virtualcam
```

## Integration target

Use this daemon output as your host-app bridge input for the CoreMediaIO Camera Extension stream source.
