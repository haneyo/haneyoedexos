#!/usr/bin/env bash
# eDEX app-monitor dependencies for the target Ubuntu Server (Phase 1 real mode).
# Each monitor = Xvfb nested X display + x11vnc (native WebSocket) + the app.
#
#   xvfb               headless X server per monitor
#   x11vnc             serves each Xvfb display over RFB + WebSocket on 127.0.0.1
#   novnc              noVNC client pages for x11vnc's -httpdir (fallback)
#   websockify         fallback RFB->WebSocket bridge if x11vnc lacks native WS
#   openbox            tiny WM inside each nested display (focus/decoration)
#   dbus-x11           dbus-run-session for apps that need a session bus
#   fonts-dejavu-core  minimal fonts (GUI apps render empty boxes without them)
#   fontconfig         font configuration
#   libfuse2           AppImages require FUSE on Ubuntu 22.04+
#
set -euo pipefail

sudo apt-get update
sudo apt-get install -y \
  xvfb \
  x11vnc \
  novnc \
  websockify \
  openbox \
  dbus-x11 \
  fonts-dejavu-core \
  fontconfig \
  libfuse2

echo "eDEX app-monitor dependencies installed."
echo "Set settings.json appMonitor.mock=false (or \"auto\" on Linux) to use real apps."
