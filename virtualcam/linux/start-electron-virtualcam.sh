#!/usr/bin/env bash
set -euo pipefail

WINDOW_TITLE="${1:-Desktop Stream Receiver}"
DEVICE="${2:-/dev/video42}"
FPS="${3:-30}"
PID_FILE=".virtualcam_ffmpeg.pid"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found."
  exit 1
fi

if ! command -v xdotool >/dev/null 2>&1; then
  echo "xdotool not found."
  exit 1
fi

if [ ! -e "${DEVICE}" ]; then
  echo "Virtual camera device not found: ${DEVICE}"
  echo "Run ./setup-v4l2loopback.sh first."
  exit 1
fi

WINDOW_ID="$(xdotool search --name "${WINDOW_TITLE}" | head -n1 || true)"
if [ -z "${WINDOW_ID}" ]; then
  echo "Could not find window with title containing: ${WINDOW_TITLE}"
  exit 1
fi

X="$(xwininfo -id "${WINDOW_ID}" | awk '/Absolute upper-left X:/ {print $4}')"
Y="$(xwininfo -id "${WINDOW_ID}" | awk '/Absolute upper-left Y:/ {print $4}')"
WIDTH="$(xwininfo -id "${WINDOW_ID}" | awk '/Width:/ {print $2}')"
HEIGHT="$(xwininfo -id "${WINDOW_ID}" | awk '/Height:/ {print $2}')"

if [ -z "${X}" ] || [ -z "${Y}" ] || [ -z "${WIDTH}" ] || [ -z "${HEIGHT}" ]; then
  echo "Failed to read window geometry."
  exit 1
fi

echo "Capturing window ${WINDOW_ID} (${WIDTH}x${HEIGHT}+${X},${Y}) at ${FPS}fps -> ${DEVICE}"

ffmpeg \
  -hide_banner \
  -loglevel warning \
  -f x11grab \
  -draw_mouse 0 \
  -framerate "${FPS}" \
  -video_size "${WIDTH}x${HEIGHT}" \
  -i ":0.0+${X},${Y}" \
  -vf "format=yuv420p" \
  -f v4l2 \
  "${DEVICE}" &

FFMPEG_PID="$!"
echo "${FFMPEG_PID}" > "${PID_FILE}"

echo "Virtual camera bridge started (PID ${FFMPEG_PID})."
echo "Use ./stop-electron-virtualcam.sh to stop."
