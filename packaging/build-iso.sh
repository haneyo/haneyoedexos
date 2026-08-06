#!/usr/bin/env bash
# eDEX-OS ISO builder — a MINIMAL remaster of the official Ubuntu Server ISO.
#
# Approach: do NOT touch filesystem.squashfs or any signed EFI binary (Secure
# Boot survives). Instead inject an autoinstall (nocloud datasource) and edit
# the GRUB kernel command line so Subiquity runs our user-data: the key install
# steps stay interactive (like stock Ubuntu), everything else is automated, and
# late-commands install eDEX as the fullscreen shell on the installed system.
#
# Run on Ubuntu 24.04 (CI runner or a local box). Needs ~8GB disk + internet.
#
#   usage: build-iso.sh <ubuntu-server.iso | URL> <eDEX-UI.AppImage> <out.iso>
#                        [volume-label]

set -euo pipefail

SRC_ISO="${1:?usage: build-iso.sh <ubuntu-server.iso|URL> <edex.AppImage> <out.iso> [label]}"
EDEX_APPIMAGE="${2:?missing AppImage}"
OUT_ISO="${3:?missing output path}"
VOL_LABEL="${4:-eDEX-OS}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- locate / download the stock ISO -----------------------------------------
if [[ "$SRC_ISO" == http* ]]; then
    echo "[edex] downloading $SRC_ISO"
    curl -L -o /tmp/ubuntu-stock.iso "$SRC_ISO"
    SRC_ISO=/tmp/ubuntu-stock.iso
fi
[[ -f "$SRC_ISO" ]] || { echo "missing ISO: $SRC_ISO"; exit 1; }
[[ -f "$EDEX_APPIMAGE" ]] || { echo "missing AppImage: $EDEX_APPIMAGE"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
EXTRACT="$WORK/iso-extract"

echo "[edex] installing build tools"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y squashfs-tools xorriso genisoimage

echo "[edex] extracting stock ISO"
mkdir -p "$EXTRACT"
xorriso -osirrox on -indev "$SRC_ISO" -extract / "$EXTRACT"
chmod -R u+w "$EXTRACT"
# keep [BOOT]/ — it may hold the appended UEFI partition image

# Replay the stock ISO's own boot structure. 24.04.x server UEFI boot is a
# HIDDEN El-Torito image stored as an appended GPT partition — a slice of the
# original ISO file (--interval:local_fs:...), not a regular file. The report
# carries that structure verbatim, including the -append_partition interval
# that reads the ESP from $SRC_ISO at rebuild time. Drop only the original
# volume label (we set our own) and fix the interval's ISO path.
BOOTFLAGS="$(xorriso -indev "$SRC_ISO" -report_el_torito as_mkisofs 2>/dev/null \
    | grep -E '^-' \
    | grep -vE "^-V[[:space:]]|^-volume_date|^--modification-date" \
    | sed "s|'/tmp/ubuntu-stock.iso'|'$SRC_ISO'|" \
    | sed -E "s#^(-b|-c) '/#\1 '#" \
    | tr -d "'")"
[[ -n "$BOOTFLAGS" ]] || { echo "ERROR: could not read boot flags from $SRC_ISO"; exit 1; }
echo "[edex] replaying boot flags:"
echo "$BOOTFLAGS"

echo "[edex] preinstalling the GUI stack into the live rootfs (fully OFFLINE install)"
# The installer copies this squashfs verbatim to the target disk, so anything
# installed here is present on the installed system with ZERO network at
# install time. Build-time apt needs network; the install-time system does not.
SQUASHFS="$(ls "$EXTRACT/casper/"*.squashfs 2>/dev/null | head -1)"
if [ -z "$SQUASHFS" ]; then
    echo "ERROR: no squashfs found in casper/:"; ls -la "$EXTRACT/casper/"; exit 1
fi
echo "[edex] live rootfs: $(basename "$SQUASHFS")"
mkdir -p "$WORK/rootfs"
echo "[edex] unsquashfs..."
sudo unsquashfs -d "$WORK/rootfs" "$SQUASHFS"
sudo cp /etc/resolv.conf "$WORK/rootfs/etc/resolv.conf"
# Give the chroot apt the build host's proxy config (CI needs it) and clear the
# live image's cdrom-only sources.
sudo cp /etc/apt/apt.conf.d/* "$WORK/rootfs/etc/apt/apt.conf.d/" 2>/dev/null || true
sudo rm -rf "$WORK/rootfs/etc/apt/sources.list.d"/* 2>/dev/null || true
sudo tee "$WORK/rootfs/etc/apt/sources.list" >/dev/null <<'EOF'
deb http://archive.ubuntu.com/ubuntu noble main universe multiverse restricted
deb http://security.ubuntu.com/ubuntu noble-security main universe multiverse restricted
deb http://archive.ubuntu.com/ubuntu noble-updates main universe multiverse restricted
EOF
# The GUI stack to bake in. Shared by the chroot and proot branches.
APTOPTS="xorg lightdm lightdm-autologin-greeter openbox \
    xvfb x11vnc novnc websockify dbus-x11 wmctrl xterm curl \
    fonts-dejavu-core fontconfig libfuse2 \
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libasound2 libgbm1 libdrm2 \
    libxkbcommon0 xdg-utils libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    linux-firmware network-manager \
    pulseaudio alsa-utils \
    nodejs npm \
    flatpak xdg-desktop-portal xdg-desktop-portal-gtk \
    playerctl \
    gvfs gvfs-backends libglib2.0-bin \
    fcitx5 fcitx5-rime fcitx5-config-qt \
    fcitx5-frontend-gtk3 fcitx5-frontend-qt5 rime-data"

# Bind-mount /proc,/sys,/dev for the chroot. If the runner forbids mounts
# (GitHub containers), fall back to proot (userspace chroot, no mounts).
MOUNTS_OK=1
for m in /proc /sys /dev; do
    sudo mkdir -p "$WORK/rootfs$m"
    sudo mount --bind "$m" "$WORK/rootfs$m" 2>/dev/null \
        || { echo "[edex] WARN: cannot bind-mount $m — falling back to proot"; MOUNTS_OK=0; break; }
done

# Bake in the Claude Code CLI too, so the built-in assistant works out of the
# box (only the API key still needs to be added once from the gear menu).
INSTALL_CLAUDE='(npm install -g @anthropic-ai/claude-code 2>/dev/null || echo "[edex] WARN: claude CLI install skipped (best-effort)")'

if [ "$MOUNTS_OK" = "1" ]; then
    echo "[edex] chroot apt preinstall (mounted)"
    sudo -E chroot "$WORK/rootfs" /bin/bash -c \
        "export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y $APTOPTS; apt-get clean; $INSTALL_CLAUDE" \
        || { echo "ERROR: chroot apt install failed"; exit 1; }
    for m in /proc /sys /dev; do sudo umount "$WORK/rootfs$m" 2>/dev/null || true; done
else
    echo "[edex] installing proot and using userspace chroot"
    sudo apt-get install -y proot >/dev/null 2>&1 || true
    proot -S "$WORK/rootfs" /bin/bash -c \
        "export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y $APTOPTS; apt-get clean; $INSTALL_CLAUDE" \
        || { echo "ERROR: proot apt install failed"; exit 1; }
fi

echo "[edex] baking in Firefox (official tarball — offline, no snap)"
# Ubuntu 24.04's 'firefox' package is a snap; for a fully offline system we
# instead embed Mozilla's official Linux tarball and register a .desktop entry
# so it shows up in the app-monitor list.
curl -fsSL -o "$WORK/firefox.tar.xz" \
    "https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US" \
    || echo "[edex] WARN: Firefox download failed (best-effort)"
if [ -s "$WORK/firefox.tar.xz" ]; then
    sudo mkdir -p "$WORK/rootfs/opt/firefox"
    sudo tar -xJf "$WORK/firefox.tar.xz" -C "$WORK/rootfs/opt/firefox" --strip-components=1 \
        || echo "[edex] WARN: Firefox extract failed (best-effort)"
    sudo tee "$WORK/rootfs/usr/share/applications/firefox.desktop" >/dev/null <<'DESK'
[Desktop Entry]
Name=Firefox
Comment=Browse the web
Exec=/opt/firefox/firefox
Icon=/opt/firefox/browser/chrome/icons/default/default128.png
Type=Application
Terminal=false
Categories=Network;WebBrowser;
DESK
fi

# Bake in the offline speech-recognition model (sherpa-onnx, streaming Chinese
# zipformer, int8) so voice input works with zero network at run time.
echo "[edex] baking in offline ASR model (sherpa-onnx, Chinese streaming)"
mkdir -p "$WORK/rootfs/opt/edex/models"
curl -fsSL -o "$WORK/zh-asr.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-multi-zh-hans-2023-12-12.tar.bz2" \
    || echo "[edex] WARN: ASR model download failed (best-effort)"
if [ -s "$WORK/zh-asr.tar.bz2" ]; then
    tar -xjf "$WORK/zh-asr.tar.bz2" -C "$WORK/rootfs/opt/edex/models" \
        || echo "[edex] WARN: ASR model extract failed"
fi

# Bake the eDEX AppImage straight into the image.
sudo mkdir -p "$WORK/rootfs/opt/edex"
sudo cp "$EDEX_APPIMAGE" "$WORK/rootfs/opt/edex/eDEX-UI.AppImage"
sudo chmod 755 "$WORK/rootfs/opt/edex/eDEX-UI.AppImage"
for m in /proc /sys /dev; do sudo umount "$WORK/rootfs$m" 2>/dev/null || true; done
sudo rm -f "$SQUASHFS"
sudo mksquashfs "$WORK/rootfs" "$SQUASHFS" -comp zstd -b 256K -noappend >/dev/null
sudo rm -rf "$WORK/rootfs"
# casper keeps the (uncompressed) size for the installer — refresh it if present
if [ -f "$EXTRACT/casper/filesystem.size" ]; then
    du -sk "$SQUASHFS" | cut -f1 | sudo tee "$EXTRACT/casper/filesystem.size" >/dev/null
fi

echo "[edex] injecting nocloud datasource + payload"
mkdir -p "$EXTRACT/nocloud"
cp "$REPO_DIR/packaging/autoinstall/user-data"     "$EXTRACT/nocloud/user-data"
cp "$REPO_DIR/packaging/autoinstall/meta-data"     "$EXTRACT/nocloud/meta-data"
cp "$REPO_DIR/packaging/install/install-edex.sh"   "$EXTRACT/nocloud/install-edex.sh"

echo "[edex] enabling autoinstall on the kernel command line"
# Append  autoinstall ds=nocloud\;s=/cdrom/nocloud/  just before the '---'
# separator on every /casper/vmlinuz line of the GRUB configs.
for cfg in boot/grub/grub.cfg boot/grub/loopback.cfg; do
    if [[ -f "$EXTRACT/$cfg" ]]; then
        sed -i '/casper\/vmlinuz/ s/ ---/ autoinstall ds=nocloud\\;s=\/cdrom\/nocloud\/ ---/' "$EXTRACT/$cfg"
    fi
done
grep -q "autoinstall" "$EXTRACT/boot/grub/grub.cfg" || { echo "ERROR: autoinstall not injected into grub.cfg"; exit 1; }

echo "[edex] regenerating md5sum.txt"
( cd "$EXTRACT" && find . -type f -print0 | xargs -0 md5sum > md5sum.txt )

echo "[edex] rebuilding bootable ISO"
# MBR boot code template comes from the stock ISO itself (GRUB2 hybrid layout).
dd if="$SRC_ISO" bs=1 count=432 of="$WORK/isohdpfx.bin" 2>/dev/null

# Add the GRUB2 MBR boot code (the report's boot record uses grub2-mbr) and the
# directory-permission fix; everything else comes from the replay.
xorriso -as mkisofs \
  -r -V "$VOL_LABEL" -J -l -iso-level 3 \
  --grub2-mbr "$WORK/isohdpfx.bin" \
  -dir-mode 0755 \
  $BOOTFLAGS \
  -o "$OUT_ISO" "$EXTRACT"

echo "[edex] done: $OUT_ISO"
ls -lh "$OUT_ISO"
