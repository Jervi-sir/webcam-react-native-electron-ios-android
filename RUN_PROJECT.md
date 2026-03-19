# Run Project

## Main Dev Flow

1. Install dependencies:

```bash
cd mobile && npm install
cd ../desktop && npm install
```

2. Start the Electron receiver:

```bash
cd desktop
npm start
```

3. Start the iPhone app:

```bash
cd mobile
npx expo run:ios --device
```

4. In the phone app, connect to:

```text
ws://YOUR_MAC_IP:3333
```

5. Start the stream and confirm video appears in Electron.

## OBS Flow

1. Build and install the plugin by following:

- `obs-plugin/electron_bridge_source/README.md`

2. In Electron set:

- Host: `127.0.0.1`
- Port: `19777`
- Encoding: `RAW RGBA (OBS plugin)`
- Enable: `ON`

3. In OBS add source:

- `Electron Camera Bridge (TCP)`

## macOS Virtual Camera Flow

1. In Electron set:

- Host: `127.0.0.1`
- Port: `19777`
- Encoding: `jpeg`
- Enable: `ON`

2. Follow:

- `virtualcam/macos/BUILD_CAMERA_EXTENSION.md`
- `desktop/PRODUCTION_MACOS.md`

## Notes

- `desktop/` is the hub of the whole project.
- Use OBS plugin and macOS virtual camera as separate outputs.
- Do not run both outputs on the same bridge port at the same time unless you intentionally reconfigure one of them.
