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
# Rootfs files are created by sudo (unsquashfs/chroot), so the plain rm below
# would fail with "Permission denied" — and with `set -e` that failure flips the
# whole build red even when the ISO succeeded. Clean up as root.
trap 'sudo rm -rf "$WORK"' EXIT
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
df -h "$WORK" | tail -1
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
    fonts-dejavu-core fonts-noto-cjk fontconfig libfuse2 \
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libasound2t64 libgbm1 libdrm2 \
    libxkbcommon0 xdg-utils libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    linux-firmware network-manager wpasupplicant bluez rfkill upower \
    pulseaudio alsa-utils \
    uget aria2 \
    nodejs npm \
    flatpak xdg-desktop-portal xdg-desktop-portal-gtk \
    playerctl \
    gvfs gvfs-backends libglib2.0-bin \
    fcitx5 fcitx5-rime fcitx5-pinyin fcitx5-chinese-addons librime-bin \
    fcitx5-config-qt fcitx5-frontend-gtk3 fcitx5-frontend-qt5 \
    p7zip-full intel-microcode \
    plymouth plymouth-theme-spinner xcursor-themes"

# Bind-mount /proc,/sys,/dev for the chroot. If the runner forbids mounts
# (GitHub containers), fall back to proot (userspace chroot, no mounts).
MOUNTS_OK=1
for m in /proc /sys /dev; do
    sudo mkdir -p "$WORK/rootfs$m"
    sudo mount --bind "$m" "$WORK/rootfs$m" 2>/dev/null \
        || { echo "[edex] WARN: cannot bind-mount $m — falling back to proot"; MOUNTS_OK=0; break; }
done

# Claude Code is a HARD requirement (the built-in assistant is unusable without
# it), so a failed install or a missing binary FAILS the build instead of
# silently shipping an ISO whose assistant does not run. npm -g puts the launcher
# in /usr/local/bin and its postinstall pulls the platform-native binary; the
# `claude --version` sanity check catches a wrapper without its native dep (the
# "claude native binary not installed" failure mode).
INSTALL_CLAUDE='(set -o pipefail; npm install -g @anthropic-ai/claude-code >/tmp/edex-claude-install.log 2>&1; if ! command -v claude >/dev/null 2>&1 || ! claude --version >/dev/null 2>&1; then echo "[edex] ERROR: claude CLI failed to install"; tail -30 /tmp/edex-claude-install.log; exit 1; fi; echo "[edex] claude $(claude --version 2>/dev/null | head -1) OK")'

if [ "$MOUNTS_OK" = "1" ]; then
    echo "[edex] chroot apt preinstall (mounted)"
    # `set -e` inside the chroot so a failing apt-get actually propagates: the
    # claude CLI install is the last command and without it the chroot would
    # return 0 even when the GUI stack failed to install (masked breakage).
    sudo -E chroot "$WORK/rootfs" /bin/bash -c \
        "set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y $APTOPTS; apt-get clean; addgroup --system netdev || true; $INSTALL_CLAUDE" \
        || { echo "ERROR: chroot apt install failed"; exit 1; }
else
    echo "[edex] installing proot and using userspace chroot"
    sudo apt-get install -y proot >/dev/null 2>&1 || true
    proot -S "$WORK/rootfs" /bin/bash -c \
        "set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y $APTOPTS; apt-get clean; addgroup --system netdev || true; $INSTALL_CLAUDE" \
        || { echo "ERROR: proot apt install failed"; exit 1; }
fi

# Out-of-tree WiFi drivers (RTL8821CE on the E580 + the other common Realtek /
# Broadcom cards the in-tree drivers handle poorly) — see build-wifi-drivers.sh.
# Best-effort: the script itself always exits 0; this || guard is for the
# chroot/proot wrapper failing entirely (mount, missing /bin/bash, ...).
echo "[edex] building out-of-tree WiFi drivers into the rootfs"
sudo cp "$SCRIPT_DIR/build-wifi-drivers.sh" "$WORK/rootfs/tmp/edex-build-wifi-drivers.sh"
if [ "$MOUNTS_OK" = "1" ]; then
    sudo -E chroot "$WORK/rootfs" /bin/bash /tmp/edex-build-wifi-drivers.sh \
        || echo "[edex] WARN: WiFi driver build failed (best-effort)"
else
    proot -S "$WORK/rootfs" /bin/bash /tmp/edex-build-wifi-drivers.sh \
        || echo "[edex] WARN: WiFi driver build failed (best-effort)"
fi
sudo rm -f "$WORK/rootfs/tmp/edex-build-wifi-drivers.sh"
for m in /proc /sys /dev; do sudo umount "$WORK/rootfs$m" 2>/dev/null || true; done

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

# Bake in the mihomo proxy daemon (MetaCubeX/mihomo) + metacubexd dashboard +
# geo databases so the built-in Clash proxy (#46) works fully offline at
# install time. Layout: /opt/edex/mihomo/ holds the binary + geo files, with
# /usr/local/bin/mihomo symlinking the binary (that symlink is what the in-app
# `clash:update` replaces). Best-effort — a network hiccup warns, not fails.
echo "[edex] baking in mihomo proxy + metacubexd dashboard"
MIHOMO_URL=$(curl -fsSL "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest" 2>/dev/null \
    | grep -o '"browser_download_url": *"[^"]*linux-amd64[^"]*\.gz"' | head -1 \
    | sed -E 's/.*"browser_download_url": *"([^"]*)"/\1/') || true
if [ -n "$MIHOMO_URL" ]; then
    sudo mkdir -p "$WORK/rootfs/opt/edex/mihomo"
    curl -fsSL --retry 2 -o "$WORK/mihomo.gz" "$MIHOMO_URL" || true
    if [ -s "$WORK/mihomo.gz" ]; then
        gzip -dc "$WORK/mihomo.gz" > "$WORK/mihomo" 2>/dev/null || true
        if [ -s "$WORK/mihomo" ]; then
            sudo install -m 755 "$WORK/mihomo" "$WORK/rootfs/opt/edex/mihomo/mihomo"
            sudo ln -sf /opt/edex/mihomo/mihomo "$WORK/rootfs/usr/local/bin/mihomo" 2>/dev/null || true
            # Geo databases come from the meta-rules-dat repo (mihomo's releases
            # ship binaries only); geo-auto-update stays off so first boot never
            # phones home for them.
            for geo in Country.mmdb geoip.dat geosite.dat; do
                curl -fsSL --retry 2 -o "$WORK/rootfs/opt/edex/mihomo/$geo" \
                    "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/$geo" || \
                    echo "[edex] WARN: mihomo geo file $geo download failed (best-effort)"
            done
        else
            echo "[edex] WARN: mihomo gunzip failed (best-effort)"
        fi
    else
        echo "[edex] WARN: mihomo download failed (best-effort)"
    fi
else
    echo "[edex] WARN: could not resolve mihomo release asset (best-effort)"
fi

# metacubexd web dashboard — served as /ui/ by mihomo's external-controller
# (the "Open dashboard" button in the Clash settings pane points at it).
# Older releases shipped a `gh-pages.zip` whose root was a gh-pages/ folder;
# newer ones ship `compressed-dist.tgz` with the site files at the archive root.
META_URL=$(curl -fsSL "https://api.github.com/repos/MetaCubeX/metacubexd/releases/latest" 2>/dev/null \
    | grep -oE '"browser_download_url": *"[^"]*(compressed-dist\.tgz|gh-pages\.zip)[^"]*"' | head -1 \
    | sed -E 's/.*"browser_download_url": *"([^"]*)"/\1/') || true
if [ -n "$META_URL" ]; then
    curl -fsSL --retry 2 -o "$WORK/metacubexd.pkg" "$META_URL" || true
    if [ -s "$WORK/metacubexd.pkg" ]; then
        sudo rm -rf "$WORK/rootfs/opt/edex/metacubexd"
        sudo mkdir -p "$WORK/rootfs/opt/edex/metacubexd"
        (rm -rf /tmp/metacubexd-x && mkdir /tmp/metacubexd-x && \
         case "$META_URL" in
             *.zip) unzip -q "$WORK/metacubexd.pkg" -d /tmp/metacubexd-x \
                        && sudo cp -r /tmp/metacubexd-x/gh-pages/. "$WORK/rootfs/opt/edex/metacubexd/" ;;
             *) tar -xzf "$WORK/metacubexd.pkg" -C /tmp/metacubexd-x \
                        && sudo cp -r /tmp/metacubexd-x/. "$WORK/rootfs/opt/edex/metacubexd/" ;;
         esac) || echo "[edex] WARN: metacubexd extract failed (best-effort)"
        rm -rf /tmp/metacubexd-x
    else
        echo "[edex] WARN: metacubexd download failed (best-effort)"
    fi
else
    echo "[edex] WARN: could not resolve metacubexd release asset (best-effort)"
fi

# Bake in the offline speech-recognition model (sherpa-onnx, streaming Chinese
# zipformer, int8) so voice input works with zero network at run time.
echo "[edex] baking in offline ASR model (sherpa-onnx, Chinese streaming)"
# rootfs is root-owned (unsquashfs ran via sudo) — a plain mkdir trips set -e.
sudo mkdir -p "$WORK/rootfs/opt/edex/models"
curl -fSL --retry 3 --retry-delay 3 -o "$WORK/zh-asr.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-multi-zh-hans-2023-12-12.tar.bz2" \
    || echo "[edex] WARN: ASR model download failed (best-effort)"
if [ -s "$WORK/zh-asr.tar.bz2" ]; then
    tar -xjf "$WORK/zh-asr.tar.bz2" -C "$WORK/rootfs/opt/edex/models" \
        || echo "[edex] WARN: ASR model extract failed"
fi

# Patch the eDEX AppImage BEFORE baking it in — without these true-machine
# fixes (see packaging/patch-appimage.sh) a freshly built ISO re-introduces
# the boot/UI bugs. Idempotent: a previously patched AppImage passes through
# unchanged, so this is safe even when the input already came from a patched
# Release asset.
PATCHED_APPIMAGE="${EDEX_APPIMAGE%.AppImage}.patched.AppImage"
bash "$SCRIPT_DIR/patch-appimage.sh" "$EDEX_APPIMAGE" "$PATCHED_APPIMAGE" \
    || { echo "[edex] ERROR: AppImage patch failed"; exit 1; }
EDEX_APPIMAGE="$PATCHED_APPIMAGE"

# Bake the eDEX AppImage straight into the image.
sudo mkdir -p "$WORK/rootfs/opt/edex"
sudo cp "$EDEX_APPIMAGE" "$WORK/rootfs/opt/edex/eDEX-UI.AppImage"
sudo chmod 755 "$WORK/rootfs/opt/edex/eDEX-UI.AppImage"
# Never ship a pre-created /home: a leftover directory from the build host (e.g.
# /home/runner on a GitHub Actions runner) would leak into the squashfs, get
# copied to every target disk, and then be mistaken for the real user by naive
# `ls /home` detection. The installed user is created at install time.
sudo rm -rf "$WORK/rootfs/home"/* 2>/dev/null || true
for m in /proc /sys /dev; do sudo umount "$WORK/rootfs$m" 2>/dev/null || true; done
sudo rm -f "$SQUASHFS"
df -h "$WORK" | tail -1
# Keep the last few lines of mksquashfs output so a failure (e.g. disk full) is
# visible in CI instead of swallowed by /dev/null. pipefail propagates the error.
sudo mksquashfs "$WORK/rootfs" "$SQUASHFS" -comp zstd -b 256K -noappend 2>&1 | tail -4
sudo rm -rf "$WORK/rootfs"
df -h "$WORK" | tail -1
# casper keeps the (uncompressed) size for the installer — refresh it if present
if [ -f "$EXTRACT/casper/filesystem.size" ]; then
    du -sk "$SQUASHFS" | cut -f1 | sudo tee "$EXTRACT/casper/filesystem.size" >/dev/null
fi

echo "[edex] injecting nocloud datasource + payload"
mkdir -p "$EXTRACT/nocloud"
cp "$REPO_DIR/packaging/autoinstall/user-data"     "$EXTRACT/nocloud/user-data"
cp "$REPO_DIR/packaging/autoinstall/meta-data"     "$EXTRACT/nocloud/meta-data"
cp "$REPO_DIR/packaging/install/install-edex.sh"   "$EXTRACT/nocloud/install-edex.sh"
# eDEX boot-splash theme: install-edex.sh copies these into the target's
# /usr/share/plymouth/themes/edex (the logo replaces the stock Ubuntu
# "bgrt-fallback" image that plymouth otherwise draws on boot).
cp "$REPO_DIR/packaging/boot/edex.plymouth"        "$EXTRACT/nocloud/edex.plymouth"
cp "$REPO_DIR/packaging/boot/edex-boot-logo.png"   "$EXTRACT/nocloud/edex-boot-logo.png"

echo "[edex] enabling autoinstall on the kernel command line"
# Append  autoinstall ds=nocloud\;s=/cdrom/nocloud/  just before the '---'
# separator on every /casper/vmlinuz line of the GRUB configs. These extra
# params were worked out on real hardware (ThinkPad E580): 8250.nr_uarts=0 skips
# the serial-port probe that stalls boot, systemd.unit=multi-user.target boots
# the installer straight to a TTY (no GUI needed, and no lightdm hang), and
# pci=noaer silences the "AER: Corrected error" flood.
for cfg in boot/grub/grub.cfg boot/grub/loopback.cfg; do
    if [[ -f "$EXTRACT/$cfg" ]]; then
        sed -i '/casper\/vmlinuz/ s/ ---/ autoinstall ds=nocloud\\;s=\/cdrom\/nocloud\/ 8250.nr_uarts=0 systemd.unit=multi-user.target pci=noaer ---/' "$EXTRACT/$cfg"
    fi
done
grep -q "autoinstall" "$EXTRACT/boot/grub/grub.cfg" || { echo "ERROR: autoinstall not injected into grub.cfg"; exit 1; }

echo "[edex] regenerating md5sum.txt"
# boot.catalog and the El-Torito boot image live under [BOOT]/ and are rewritten
# by xorriso at ISO build time — their checksums computed here would be stale on
# the finished disc, so exclude them by name.
( cd "$EXTRACT" && find . -type f \
    ! -name boot.catalog ! -name eltorito.img \
    -print0 | xargs -0 md5sum > md5sum.txt )

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
