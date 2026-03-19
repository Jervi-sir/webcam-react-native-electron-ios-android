#!/usr/bin/env bash
set -euo pipefail

DEVICE_NR="${1:-42}"
CARD_LABEL="${2:-Electron Virtual Camera}"

if ! command -v modprobe >/dev/null 2>&1; then
  echo "modprobe not found."
  exit 1
fi

echo "Loading v4l2loopback: video_nr=${DEVICE_NR}, card_label=${CARD_LABEL}"
sudo modprobe v4l2loopback \
  devices=1 \
  video_nr="${DEVICE_NR}" \
  card_label="${CARD_LABEL}" \
  exclusive_caps=1

echo "Done. Virtual camera should be available at /dev/video${DEVICE_NR}."
