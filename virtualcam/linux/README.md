# Linux Virtual Camera (v4l2loopback)

This path makes the Electron receiver visible as a webcam device (for example `/dev/video42`).

Requirements:

1. Linux with kernel module support.
2. `v4l2loopback` kernel module.
3. `ffmpeg`.
4. `xdotool`.
5. X11 session (Wayland users should run an XWayland-capable capture path or adapt script).

## Setup

1. Load virtual camera module:
   - `sudo ./setup-v4l2loopback.sh`
2. Start Electron desktop receiver and keep its window visible.
3. Start feeding camera:
   - `./start-electron-virtualcam.sh`
4. Stop feeding camera:
   - `./stop-electron-virtualcam.sh`

## Optional arguments

`start-electron-virtualcam.sh [window_title] [device] [fps]`

Defaults:

1. `window_title`: `Desktop Stream Receiver`
2. `device`: `/dev/video42`
3. `fps`: `30`

## Verify

1. `v4l2-ctl --list-devices`
2. Open Zoom/Meet/OBS and select `Electron Virtual Camera` or matching `/dev/video42` device.

