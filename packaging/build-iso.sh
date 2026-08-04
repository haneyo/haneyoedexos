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
rm -rf "$EXTRACT/[BOOT]"

echo "[edex] replaying the stock ISO's boot flags (authoritative)"
# -report_el_torito as_mkisofs prints the exact El Torito / GPT-partition flags
# the stock ISO was built with (UEFI may be a file or an appended partition —
# this handles both). The GRUB2 MBR boot code is captured separately below.
BOOTFLAGS="$(xorriso -indev "$SRC_ISO" -report_el_torito as_mkisofs 2>/dev/null | grep -E '^-[a-z]|^--' || true)"
[[ -n "$BOOTFLAGS" ]] || { echo "ERROR: could not read boot flags from $SRC_ISO"; exit 1; }
echo "[edex] boot flags: $BOOTFLAGS"

echo "[edex] injecting nocloud datasource + payload"
mkdir -p "$EXTRACT/nocloud"
cp "$REPO_DIR/packaging/autoinstall/user-data"     "$EXTRACT/nocloud/user-data"
cp "$REPO_DIR/packaging/autoinstall/meta-data"     "$EXTRACT/nocloud/meta-data"
cp "$REPO_DIR/packaging/install/install-edex.sh"   "$EXTRACT/nocloud/install-edex.sh"
cp "$EDEX_APPIMAGE"                                 "$EXTRACT/nocloud/eDEX-UI.AppImage"

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

xorriso -as mkisofs \
  -r -V "$VOL_LABEL" -J -l -iso-level 3 \
  --grub2-mbr "$WORK/isohdpfx.bin" \
  -dir-mode 0755 \
  $BOOTFLAGS \
  -o "$OUT_ISO" "$EXTRACT"

echo "[edex] done: $OUT_ISO"
ls -lh "$OUT_ISO"
