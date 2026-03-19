# OBS Integration

OBS support for the Electron receiver.

## Included Plugin

- `electron_bridge_source/` adds the OBS source `Electron Camera Bridge (TCP)`

## Flow

1. `mobile/` streams to `desktop/`
2. `desktop/` sends `EVRG` raw RGBA frames on localhost
3. OBS plugin receives the frames and renders them as an OBS source

## Use

1. Build and install the plugin from `electron_bridge_source/README.md`
2. In OBS add `Electron Camera Bridge (TCP)`
3. In Electron set:
   - Host `127.0.0.1`
   - Port `19777`
   - Encoding `RAW RGBA (OBS plugin)`
   - Enable `ON`

## Notes

- OBS plugin output is separate from the native macOS virtual camera path
- do not use the JPEG native path for OBS
