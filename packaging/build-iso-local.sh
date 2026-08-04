#!/usr/bin/env bash
# Build the eDEX-OS ISO locally on an Ubuntu 24.04 machine (or the laptop
# itself once Ubuntu is installed). Builds the eDEX AppImage from source, then
# runs the remaster.
#
#   usage: build-iso-local.sh [ubuntu-server.iso | auto]
#     (omit / "auto" to download the stock Ubuntu Server 24.04 ISO)

set -euo pipefail

SRC="${1:-auto}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! ls dist/*.AppImage >/dev/null 2>&1; then
    echo "[edex] building eDEX AppImage (this takes a while)"
    npm install
    (cd src && npm install) || (npm install-scripts approve node-pty ffmpeg-static && (cd src && npm install))
    npm run prebuild-linux
    ./node_modules/.bin/electron-builder build -l --x64
    rm -R prebuild-src
fi

APPIMAGE="$(ls dist/*.AppImage | head -1)"
echo "[edex] using AppImage: $APPIMAGE"

if [ "$SRC" = "auto" ]; then
    ISO_URL="${UBUNTU_ISO_URL:-https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso}"
    echo "[edex] downloading stock ISO: $ISO_URL"
    curl -fL -o /tmp/ubuntu-stock.iso "$ISO_URL"
    SRC=/tmp/ubuntu-stock.iso
fi

bash packaging/build-iso.sh "$SRC" "$APPIMAGE" eDEX-OS-local.iso eDEX-OS
echo "[edex] ISO ready: $(pwd)/eDEX-OS-local.iso"
