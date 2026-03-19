# Virtual Camera

Native virtual camera integrations used by the Electron receiver.

## Purpose

Electron can receive and display the stream, but it cannot register itself as a real webcam device without OS-native components. This folder contains those native paths.

## Platforms

- `linux/` usable loopback-camera scripts
- `macos/` Camera Extension path, bridge daemon, templates, and build notes
- `windows/` Media Foundation path and bridge daemon

## Input From Electron

Electron forwards frames over localhost TCP on `127.0.0.1:19777`.

- `EVCM` JPEG packets for native virtual cameras
- `EVRG` raw RGBA packets for the OBS plugin

Protocol reference:

- `protocol/FRAME_PROTOCOL.md`

## Recommended Entry Points

- overall setup: `GETTING_STARTED.md`
- macOS native camera: `macos/BUILD_CAMERA_EXTENSION.md`
- production macOS packaging: `../desktop/PRODUCTION_MACOS.md`

## Notes

- macOS and Windows require native signing and platform tooling
- OBS is a separate output path and lives in `../obs-plugin/`
