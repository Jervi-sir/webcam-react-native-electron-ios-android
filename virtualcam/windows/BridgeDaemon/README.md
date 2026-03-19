# Windows Bridge Daemon

This daemon receives frame packets from Electron over `127.0.0.1:19777` and writes:

1. `latest_frame.jpg`
2. `latest_frame.json`

into `%TEMP%\\electron-virtualcam` by default.

## Build (Developer Command Prompt)

```bat
cd virtualcam\\windows\\BridgeDaemon
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

## Run

```bat
cd virtualcam\\windows\\BridgeDaemon
build\\Release\\ElectronVirtualCamBridgeDaemon.exe --port 19777
```

Optional output directory:

```bat
build\\Release\\ElectronVirtualCamBridgeDaemon.exe --port 19777 --output C:\\Temp\\electron-virtualcam
```

## Integration target

Use this daemon output/stream as your feed into the Media Foundation virtual camera source path.
