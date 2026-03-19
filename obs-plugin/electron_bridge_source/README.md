# Electron Camera Bridge Source

OBS source plugin that receives raw RGBA frames from the Electron app.

## What It Adds

- OBS source name: `Electron Camera Bridge (TCP)`
- transport: localhost TCP
- expected packet type: `EVRG`

## Expected Flow

1. `mobile/` streams to `desktop/`
2. `desktop/` forwards frames to `127.0.0.1:19777`
3. this plugin receives the frames and renders them in OBS

## Build

```bash
cd obs-plugin/electron_bridge_source
cmake -S . -B build
cmake --build build --config Release
```

If `libobs` is not found, build against your local OBS/libobs development environment and pass `libobs_DIR` to CMake.

## Install

Install the built plugin into your OBS plugin location.

- macOS: user plugin bundle under `~/Library/Application Support/obs-studio/plugins/`
- Windows: `%ProgramFiles%/obs-studio/obs-plugins/64bit`
- Linux: your OBS plugin path

## Run

1. Open OBS
2. Add source `Electron Camera Bridge (TCP)`
3. Use port `19777`
4. In Electron set:
   - Host `127.0.0.1`
   - Port `19777`
   - Encoding `RAW RGBA (OBS plugin)`
   - Enable `ON`

## Packet Format

- magic: `EVRG`
- width: `uint16` little-endian
- height: `uint16` little-endian
- timestamp: `uint64` little-endian
- payload length: `uint32` little-endian
- payload: `width * height * 4` RGBA bytes

Full protocol reference:

- `../../virtualcam/protocol/FRAME_PROTOCOL.md`

## Notes

- localhost-only by design
- separate from the native macOS virtual camera path
