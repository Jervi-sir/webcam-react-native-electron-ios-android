#!/usr/bin/env bash
set -euo pipefail

PID_FILE=".virtualcam_ffmpeg.pid"

if [ ! -f "${PID_FILE}" ]; then
  echo "No PID file found (${PID_FILE})."
  exit 0
fi

PID="$(cat "${PID_FILE}")"
if [ -n "${PID}" ] && kill -0 "${PID}" >/dev/null 2>&1; then
  kill "${PID}"
  echo "Stopped virtual camera bridge (PID ${PID})."
else
  echo "Process not running (PID ${PID})."
fi

rm -f "${PID_FILE}"
