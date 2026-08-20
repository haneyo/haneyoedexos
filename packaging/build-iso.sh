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
sudo apt-get install -y squashfs-tools xorriso genisoimage unzip

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
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libasound2t64 libgbm1 libdrm2 libflac12t64 \
    libxkbcommon0 xdg-utils libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    linux-firmware network-manager wpasupplicant bluez rfkill upower \
    pulseaudio rtkit alsa-utils \
    btop ffmpeg axel \
    openssh-server \
    aerc less \
    flatpak xdg-desktop-portal xdg-desktop-portal-gtk \
    playerctl \
    gvfs gvfs-backends libglib2.0-bin \
    fcitx5 fcitx5-rime fcitx5-pinyin fcitx5-chinese-addons librime-bin \
    fcitx5-config-qt fcitx5-frontend-gtk3 fcitx5-frontend-qt5 \
    p7zip-full bzip2 intel-microcode numlockx \
    plymouth plymouth-theme-spinner xcursor-themes xclip"

# Bake in Node.js LTS (official tarball). The built-in Claude CLI needs
# Node >= 22, but Ubuntu noble's apt nodejs is 18 — so we ship the current LTS
# in /opt/node, symlink node/npm/npx into /usr/local/bin, and
# `nodejs npm` is dropped from APTOPTS above so the apt versions can't shadow
# it. This block runs BEFORE the chroot so the claude install sees Node 24.
# Node is a HARD requirement (claude and any npm tooling are unusable without
# it) — a failed download/extract FAILS the build.
echo "[edex] baking in Node.js LTS (official tarball)"
NODE_VER="v24.19.0"
if ! curl -fsSL --retry 2 -o "$WORK/node.tar.xz" \
        "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"; then
    echo "[edex] ERROR: Node download failed — cannot build an ISO without Node"; exit 1
fi
sudo mkdir -p "$WORK/rootfs/opt/node"
sudo tar -xJf "$WORK/node.tar.xz" -C "$WORK/rootfs/opt/node" --strip-components=1 \
    || { echo "[edex] ERROR: Node extract failed"; exit 1; }
if [ ! -x "$WORK/rootfs/opt/node/bin/node" ]; then
    echo "[edex] ERROR: node binary missing in tarball"; exit 1
fi
for _bin in node npm npx; do
    sudo ln -sf "/opt/node/bin/$_bin" "$WORK/rootfs/usr/local/bin/$_bin"
done
echo "[edex] Node $($WORK/rootfs/opt/node/bin/node -v) OK (linked into /usr/local/bin)"

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
INSTALL_CLAUDE='(set -o pipefail; npm install -g --prefix=/usr/local @anthropic-ai/claude-code >/tmp/edex-claude-install.log 2>&1; if ! command -v claude >/dev/null 2>&1 || ! claude --version >/dev/null 2>&1; then echo "[edex] ERROR: claude CLI failed to install"; tail -30 /tmp/edex-claude-install.log; exit 1; fi; echo "[edex] claude $(claude --version 2>/dev/null | head -1) OK")'

# fastfetch:Ubuntu noble 官方源无此包,从 GitHub release 装静态二进制进 /usr/local/bin。
# 装机即得 fastfetch 命令(不进 APP 列表)。失败则终止构建(用户要求内置)。
FASTFETCH_VER="2.67.0"
INSTALL_FASTFETCH='curl -fsSL https://github.com/fastfetch-cli/fastfetch/releases/download/2.67.0/fastfetch-linux-amd64.tar.gz -o /tmp/ff.tar.gz && mkdir -p /tmp/ff && tar -xzf /tmp/ff.tar.gz -C /tmp/ff && install -m 755 /tmp/ff/fastfetch-linux-amd64/usr/bin/fastfetch /usr/local/bin/fastfetch && fastfetch --version >/dev/null || { echo "[edex] ERROR: fastfetch install failed"; exit 1; }'

if [ "$MOUNTS_OK" = "1" ]; then
    echo "[edex] chroot apt preinstall (mounted)"
    # `set -e` inside the chroot so a failing apt-get actually propagates: the
    # claude CLI install is the last command and without it the chroot would
    # return 0 even when the GUI stack failed to install (masked breakage).
    sudo -E chroot "$WORK/rootfs" /bin/bash -c \
        "set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y $APTOPTS; apt-get clean; addgroup --system netdev || true; $INSTALL_CLAUDE; $INSTALL_FASTFETCH" \
        || { echo "ERROR: chroot apt install failed"; exit 1; }
else
    echo "[edex] installing proot and using userspace chroot"
    sudo apt-get install -y proot >/dev/null 2>&1 || true
    proot -S "$WORK/rootfs" /bin/bash -c \
        "set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y $APTOPTS; apt-get clean; addgroup --system netdev || true; $INSTALL_CLAUDE; $INSTALL_FASTFETCH" \
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

# Browser: browsh (TUI terminal browser) + the real Firefox it renders through.
# #162 reverses #58: the in-app Browser (CLI panel tab 4/5) runs `browsh <url>`,
# a TUI that drives headless Firefox over the Marionette protocol + a WebExtension
# (NO geckodriver needed). Firefox is the same binary the GUI-app launcher shows
# fullscreen, so the terminal browser and the real browser share /opt/firefox.
# Both are HARD requirements (the built-in browser is unusable without them) —
# a failed download/install, or a missing Firefox runtime, FAILS the build
# instead of shipping an ISO whose browser tab dies on launch.
echo "[edex] baking in Firefox (Mozilla official tarball → /opt/firefox)"
# Ubuntu 24.04's 'firefox' package is a snap; for a fully offline system we
# embed Mozilla's official Linux tarball and register a .desktop entry so it
# shows up in the app-monitor list (GUI app launcher).
if ! curl -fsSL --retry 2 -o "$WORK/firefox.tar.xz" \
        "https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US"; then
    echo "[edex] ERROR: Firefox download failed — cannot build an ISO without the browser"; exit 1
fi
sudo mkdir -p "$WORK/rootfs/opt/firefox"
sudo tar -xJf "$WORK/firefox.tar.xz" -C "$WORK/rootfs/opt/firefox" --strip-components=1 \
    || { echo "[edex] ERROR: Firefox extract failed"; exit 1; }
if [ ! -f "$WORK/rootfs/opt/firefox/firefox" ]; then
    echo "[edex] ERROR: /opt/firefox/firefox missing — browsh needs Firefox as its render engine; cannot build an ISO without it"; exit 1
fi
sudo ln -sf /opt/firefox/firefox "$WORK/rootfs/usr/local/bin/firefox"
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
echo "[edex] firefox $(ls -lh "$WORK/rootfs/opt/firefox/firefox" | awk '{print $5}') OK, linked into /usr/local/bin"

echo "[edex] installing browsh (terminal browser over headless Firefox)"
BROWSH_VER="1.8.2"
if ! curl -fsSL --retry 2 -o "$WORK/browsh.deb" \
        "https://github.com/browsh-org/browsh/releases/download/v$BROWSH_VER/browsh_${BROWSH_VER}_linux_amd64.deb"; then
    echo "[edex] ERROR: browsh download failed — cannot build an ISO without the browser"; exit 1
fi
sudo rm -rf "$WORK/browsh-root"
if ! sudo dpkg -x "$WORK/browsh.deb" "$WORK/browsh-root"; then
    echo "[edex] ERROR: browsh deb extract failed"; exit 1
fi
sudo install -Dm 755 "$WORK/browsh-root/usr/bin/browsh" "$WORK/rootfs/usr/local/bin/browsh" 2>/dev/null \
    || { echo "[edex] ERROR: browsh binary not found in deb"; exit 1; }
echo "[edex] browsh $(ls -lh "$WORK/rootfs/usr/local/bin/browsh" | awk '{print $5}') OK"

# Musicfox (go-musicfox v5.1.0): NetEase Cloud Music TUI client, baked for the
# eDEX terminal "musicfox" tab (#185). Plays via its built-in beep engine (Go
# decoders) over ALSA→PulseAudio. Login is per-user INSIDE the app via QR code
# — the account cookie (~/.local/share/go-musicfox/cookie) and musicfox.db are
# NEVER baked into the ISO, so every install logs in fresh.
# Two SYSTEM fixes are required (proven on the laptop 2026-08-19, or the app
# crashes at startup): (1) go-musicfox dlopens libFLAC.so.8 but Ubuntu 24.04
# ships only libFLAC.so.12 → symlink below; (2) its webkitgtk init() dlopens
# libsoup3 then libsoup2, and both present → libsoup2/3 conflict → SIGTRAP →
# remove the (orphan) libsoup2 from the rootfs (web-login unavailable, QR
# login works — acceptable trade-off).
echo "[edex] installing musicfox (NetEase Cloud Music TUI, go-musicfox v5.1.0)"
MUSICFOX_VER="5.1.0"
MUSICFOX_DEB="go-musicfox_${MUSICFOX_VER}_linux_amd64.deb"
if ! curl -fsSL --retry 2 -o "$WORK/musicfox.deb" \
        "https://github.com/go-musicfox/go-musicfox/releases/download/v$MUSICFOX_VER/$MUSICFOX_DEB"; then
    echo "[edex] ERROR: musicfox download failed"; exit 1
fi
echo "d2e0c45ec401a4d6575b7e36303ef0c2df70933aed4f5b40bc09d9fd9541faa8  $WORK/musicfox.deb" \
    | sha256sum -c - >/dev/null || { echo "[edex] ERROR: musicfox deb sha256 mismatch"; exit 1; }
sudo rm -rf "$WORK/musicfox-root"
if ! sudo dpkg -x "$WORK/musicfox.deb" "$WORK/musicfox-root"; then
    echo "[edex] ERROR: musicfox deb extract failed"; exit 1
fi
MUSICFOX_BIN=$(sudo find "$WORK/musicfox-root" -type f -name musicfox -path "*/bin/*" 2>/dev/null | head -1)
[ -n "$MUSICFOX_BIN" ] || { echo "[edex] ERROR: musicfox binary not found in deb"; exit 1; }
sudo install -Dm 755 "$MUSICFOX_BIN" "$WORK/rootfs/usr/local/bin/musicfox"

# System fix 1: go-musicfox's FLAC decoder dlopens libFLAC.so.8 at runtime, but
# Ubuntu 24.04 ships only libFLAC.so.12 (libflac12t64, added to APTOPTS above).
# Symlink .8 → .12 exactly like the laptop fix, or musicfox crashes on first play.
if [ ! -e "$WORK/rootfs/usr/lib/x86_64-linux-gnu/libFLAC.so.12" ]; then
    echo "[edex] ERROR: libFLAC.so.12 missing in rootfs — musicfox needs the .8 symlink"; exit 1
fi
sudo ln -sf libFLAC.so.12 "$WORK/rootfs/usr/lib/x86_64-linux-gnu/libFLAC.so.8"

# System fix 2: go-musicfox v5.1.0's internal webkitgtk init() dlopens libsoup3
# then libsoup2; if both are loaded → libsoup2/libsoup3 conflict → SIGTRAP crash
# at startup. Remove the (orphan) libsoup2 from the rootfs — web-login stays
# unavailable, QR login works (same trade-off as the laptop fix). On eDEX-OS the
# rootfs is built from Ubuntu Server + curated APTOPTS, so libsoup2 is never an
# owned package dep; only an orphan would land here, and only these two files.
sudo rm -f "$WORK/rootfs/usr/lib/x86_64-linux-gnu/libsoup-2.4.so.1" \
    "$WORK/rootfs/usr/lib/x86_64-linux-gnu/libsoup-2.4.so.1.11.2"
echo "[edex] musicfox $(ls -lh "$WORK/rootfs/usr/local/bin/musicfox" | awk '{print $5}') OK"

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
# zipformer, int8) so voice input works with zero network at run time. This is a
# HARD dependency of the terminal's voice button — a silent skip here ships an
# ISO whose mic button is permanently greyed out ("voice model not found"), so a
# download/extract failure aborts the build instead of best-effort WARN.
echo "[edex] baking in offline ASR model (sherpa-onnx, Chinese streaming)"
# rootfs is root-owned (unsquashfs ran via sudo) — a plain mkdir trips set -e.
sudo mkdir -p "$WORK/rootfs/opt/edex/models"
# NB: the tar below MUST be sudo too — the target dir is root-owned, and a
# non-sudo tar fails every member with "Cannot mkdir: Permission denied"
# (silently, pre-set -e's visibility, because of the || below). v2.4.9–v2.4.11
# ISOs shipped without the model for exactly this reason.
curl -fSL --retry 3 --retry-delay 3 -o "$WORK/zh-asr.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-multi-zh-hans-2023-12-12.tar.bz2"
if [ -s "$WORK/zh-asr.tar.bz2" ]; then
    sudo tar -xjf "$WORK/zh-asr.tar.bz2" -C "$WORK/rootfs/opt/edex/models"
else
    echo "[edex] ERROR: ASR model download produced an empty file" >&2
    exit 1
fi

# Bake in the bundled offline LLM (Qwen2.5-0.5B q4_k_m GGUF + llama.cpp
# llama-server) so the claude tab's "内置本地" provider works with zero network.
# HARD dependency, same policy as the ASR model: a download/extract/hash
# mismatch aborts the build — a silently-missing model ships an ISO where the
# local provider shows "未安装" and claude can't start.
# Layout must match LLM_DIR="/opt/edex/llm" in src/_boot.js: llama-server + its
# *.so next to the GGUF, flat (the tarball's "llama-b10488/" prefix is stripped).
echo "[edex] baking in bundled offline LLM (Qwen2.5-0.5B q4_k_m + llama-server b10488)"
sudo mkdir -p "$WORK/rootfs/opt/edex/llm"
LLM_GGUF_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
LLM_GGUF_SHA="74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"
LLM_RUN_URL="https://github.com/ggml-org/llama.cpp/releases/download/b10488/llama-b10488-bin-ubuntu-x64.tar.gz"
LLM_RUN_SHA="5a7073371d5a9b8e39978b35f49b2ff244f7a064edb92f0326d94e12b52261dd"
curl -fSL --retry 3 --retry-delay 5 -o "$WORK/llm-qwen05.gguf" "$LLM_GGUF_URL"
curl -fSL --retry 3 --retry-delay 5 -o "$WORK/llama-b10488-ubuntu.tar.gz" "$LLM_RUN_URL"
if [ ! -s "$WORK/llm-qwen05.gguf" ] || [ ! -s "$WORK/llama-b10488-ubuntu.tar.gz" ]; then
    echo "[edex] ERROR: LLM download produced an empty file" >&2
    exit 1
fi
echo "$LLM_GGUF_SHA  $WORK/llm-qwen05.gguf" | sha256sum -c - >/dev/null || { echo "[edex] ERROR: LLM GGUF sha256 mismatch" >&2; exit 1; }
echo "$LLM_RUN_SHA  $WORK/llama-b10488-ubuntu.tar.gz" | sha256sum -c - >/dev/null || { echo "[edex] ERROR: llama.cpp sha256 mismatch" >&2; exit 1; }
sudo cp "$WORK/llm-qwen05.gguf" "$WORK/rootfs/opt/edex/llm/qwen2.5-0.5b-instruct-q4_k_m.gguf"
sudo tar -xzf "$WORK/llama-b10488-ubuntu.tar.gz" -C "$WORK/rootfs/opt/edex/llm" --strip-components=1
[ -x "$WORK/rootfs/opt/edex/llm/llama-server" ] || { echo "[edex] ERROR: llama-server missing after extract" >&2; exit 1; }

# Bake in the offline Chinese TTS model so AI-chat voice replies work with zero
# network at run time. Same HARD-dependency policy as the ASR/LLM blocks: a
# download/extract/hash mismatch aborts the build. #171: matcha-icefall-zh-en
# (Matcha-TTS + vocos vocoder) is the preferred model — measured on an i3-7020U
# at ~4.9x realtime synthesis with natural neural prosody, and it handles mixed
# zh+en text. The two archives keep their "matcha-icefall-zh-en/" and
# "vocos-16khz-univ.onnx" paths — src/_boot.js ttsModelDirs()/ttsInit() resolve
# those exact locations (huayan/fanchen stay as lazy fallbacks when missing).
echo "[edex] baking in offline TTS model (sherpa-onnx matcha-icefall-zh-en + vocos)"
TTS_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/matcha-icefall-zh-en.tar.bz2"
TTS_SHA="271b804af570400d3bcdcb53bf6e53cc9f75180ee763b9f13eb5eaf2b0d086ef"
curl -fSL --retry 3 --retry-delay 5 -o "$WORK/zh-tts.tar.bz2" "$TTS_URL"
if [ ! -s "$WORK/zh-tts.tar.bz2" ]; then
    echo "[edex] ERROR: TTS download produced an empty file" >&2
    exit 1
fi
echo "$TTS_SHA  $WORK/zh-tts.tar.bz2" | sha256sum -c - >/dev/null || { echo "[edex] ERROR: TTS model sha256 mismatch" >&2; exit 1; }
sudo tar -xjf "$WORK/zh-tts.tar.bz2" -C "$WORK/rootfs/opt/edex/models"
[ -f "$WORK/rootfs/opt/edex/models/matcha-icefall-zh-en/model-steps-3.onnx" ] \
    || { echo "[edex] ERROR: TTS onnx missing after extract" >&2; exit 1; }
echo "[edex] baking in matcha vocoder (vocos-16khz-univ.onnx)"
VOC_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-16khz-univ.onnx"
VOC_SHA="b599142a1fb8ff03de3e84ac35ff537c619e56f4267a6fe894851a42844acf9e"
curl -fSL --retry 3 --retry-delay 5 -o "$WORK/zh-tts-vocoder.onnx" "$VOC_URL"
if [ ! -s "$WORK/zh-tts-vocoder.onnx" ]; then
    echo "[edex] ERROR: TTS vocoder download produced an empty file" >&2
    exit 1
fi
echo "$VOC_SHA  $WORK/zh-tts-vocoder.onnx" | sha256sum -c - >/dev/null || { echo "[edex] ERROR: TTS vocoder sha256 mismatch" >&2; exit 1; }
sudo install -m 0644 -D "$WORK/zh-tts-vocoder.onnx" "$WORK/rootfs/opt/edex/models/vocos-16khz-univ.onnx"

# Bake the eDEX AppImage straight into the image.
# First apply the keyboard.class.js fix (empty-NodeList TypeError on every Enter)
# so every shipped ISO carries the patch. Fail soft: a stock AppImage still boots,
# just with the bug.
EDEX_TO_BAKE="$EDEX_APPIMAGE"
if [[ -x "$SCRIPT_DIR/patch-appimage.sh" ]] \
   && bash "$SCRIPT_DIR/patch-appimage.sh" "$EDEX_APPIMAGE" "$WORK/eDEX-UI-patched.AppImage" >/dev/null 2>&1; then
    EDEX_TO_BAKE="$WORK/eDEX-UI-patched.AppImage"
    echo "[edex] AppImage patched (keyboard fix)"
else
    echo "[edex] WARN: AppImage patch unavailable, baking stock AppImage"
fi
sudo mkdir -p "$WORK/rootfs/opt/edex"
sudo cp "$EDEX_TO_BAKE" "$WORK/rootfs/opt/edex/eDEX-UI.AppImage"
sudo chmod 755 "$WORK/rootfs/opt/edex/eDEX-UI.AppImage"
# #136:#162 后 CLI 浏览器(browsh)主页 = 本地深色搜索页(搜索栏 + 可更换搜索引擎),
# browsh 启动 URL 指向 file:///opt/edex/cli-start.html(见 cliPanel.class.js)。
sudo install -m 644 "$REPO_DIR/src/assets/browser/cli-start.html" "$WORK/rootfs/opt/edex/cli-start.html"
echo "[edex] cli-start.html (browsh search page) OK"
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
# eDEX green spinner frames replace the stock white Ubuntu ring (task #8).
cp -r "$REPO_DIR/packaging/boot/throbber"          "$EXTRACT/nocloud/throbber"
cp -r "$REPO_DIR/packaging/boot/animation"         "$EXTRACT/nocloud/animation"
# eDEX cursor theme (task #7): install-edex.sh copies these into the target's
# /usr/share/icons/edex and makes it the system default (update-alternatives).
cp -r "$REPO_DIR/packaging/cursor/edex"            "$EXTRACT/nocloud/edex-cursor"
# Clipboard bridge (task #5): backend.js spawns /usr/local/bin/edex-clipboard-bridge.sh
# per virtual display; install-edex.sh installs it from nocloud.
cp "$REPO_DIR/packaging/install/edex-clipboard-bridge.sh" "$EXTRACT/nocloud/edex-clipboard-bridge.sh"

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
