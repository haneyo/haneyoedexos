#!/usr/bin/env bash
# eDEX-OS target setup — runs INSIDE the freshly-installed system chroot during
# the installer's late-commands (curtin in-target). The GUI stack and the eDEX
# AppImage are ALREADY baked into the image (squashfs preinstall), so this is
# pure configuration with no network: X session, autologin, openbox, and a
# seeded eDEX settings file.
set -euo pipefail

echo "[edex] marking the AppImage executable"
chmod +x /opt/edex/eDEX-UI.AppImage

echo "[edex] X session"
cat > /usr/share/xsessions/edex.desktop <<'DESKTOP'
[Desktop Entry]
Name=eDEX-OS
Comment=eDEX-OS sci-fi shell
Exec=/usr/local/sbin/edex-session.sh
Type=Application
DESKTOP

cat > /usr/local/sbin/edex-session.sh <<'SESH'
#!/bin/bash
# Runs inside the lightdm X session. openbox is the WM (no decorations — kiosk
# look), Fcitx5 + Rime (小狼毫) are started for Chinese input, then eDEX takes
# the whole screen. The one-time first-boot setup (interface language / timezone
# / unlock PIN) now runs INSIDE the app — classes/firstRun.class.js, triggered by
# the seeded settings.json having no lockCode — so there is no xterm step here.
export DISPLAY=:0
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
# Wake the wireless radio: rfkill can leave it soft-blocked right after a fresh
# install (and some EFI firmware settings hard-block it). NetworkManager handles
# scanning from here on; the WIFI button in eDEX drives nmcli.
rfkill unblock all 2>/dev/null || true
nmcli radio wifi on 2>/dev/null || true
# Turn on the keyboard backlight: many laptops boot with it off. The sysfs node
# is root-owned (leds subsystem), so a plain echo from the display user silently
# fails — use passwordless sudo (like edex-brightness.sh), with a direct write as
# fallback. Match any kbd-led name (ThinkPad tpacpi::/thinkpad::, generic kbd_)
# and use the device max so "on" means fully lit, not a fixed guess.
for LED in /sys/class/leds/*kbd*backlight /sys/class/leds/*kbd*led; do
    [ -f "$LED/brightness" ] || continue
    MAX=$(cat "$LED/max_brightness" 2>/dev/null || echo 2)
    echo "$MAX" | sudo -n tee "$LED/brightness" >/dev/null 2>&1 \
        || echo "$MAX" > "$LED/brightness" 2>/dev/null || true
done
# Black the X root window + use the eDEX cursor theme for the gap between the
# lightdm greeter closing and the eDEX window mapping — this is the "white flash
# with the default arrow" seen on real hardware at boot. Once eDEX is up it
# paints its own sci-fi image cursor over the whole screen, so the OS cursor
# only ever shows during this handoff; using the same WP7-style cursor keeps it
# visually consistent with the eDEX overlay (task #7).
xsetroot -solid black 2>/dev/null || true
export XCURSOR_THEME=edex
# Set the root window cursor to the theme's dark arrow immediately (openbox does
# this too once it maps, but doing it here covers the very first frames of X).
xsetroot -cursor_name left_ptr 2>/dev/null || true
openbox --replace >/dev/null 2>&1 &
# Kill Xorg's own screen blanking/DPMS. X ships a ~10-minute idle default that
# physically blanks the display regardless of the app, so on real hardware the
# panel would go dark before eDEX's configured screen-off timeout (and a wake
# keypress would land on whatever the app had up — often the real UI, with no
# lock). eDEX blanks the display itself with the #screen_off overlay at its own
# screenOffIdle, so OS blanking must be fully disabled for that setting to mean
# anything. xset s off + noblank kill the X screen-saver; -dpms stops the
# monitor powering down on its own.
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true
fcitx5 -d >/dev/null 2>&1 &
sleep 1
exec /opt/edex/eDEX-UI.AppImage --no-sandbox
SESH
chmod +x /usr/local/sbin/edex-session.sh

# Default X cursor theme (system-wide): eDEX (WP7 style), so the lightdm greeter
# and any native window show the eDEX-style pointer instead of the stock
# white/black arrow. The theme is bundled in the ISO payload (build-iso.sh
# copies packaging/cursor/edex into nocloud) and installed just below; the
# session XCURSOR_THEME in edex-session.sh covers the per-session case.
# Install the bundled theme (mirror of the plymouth payload pattern: check
# /root first for late-commands, then /cdrom/nocloud as fallback).
CURSOR_SRC=""
for C in /root/edex-cursor /cdrom/nocloud/edex-cursor; do
    if [ -d "$C" ] && [ -f "$C/index.theme" ]; then CURSOR_SRC="$C"; break; fi
done
if [ -n "$CURSOR_SRC" ]; then
    mkdir -p /usr/share/icons/edex
    cp -a "$CURSOR_SRC/cursors" /usr/share/icons/edex/
    cp "$CURSOR_SRC/index.theme" /usr/share/icons/edex/index.theme
    echo "[edex] cursor theme: edex (from $CURSOR_SRC)"
elif [ ! -e /usr/share/icons/edex/index.theme ]; then
    echo "[edex] WARN: edex cursor theme missing from ISO payload"
fi
if [ -e /usr/share/icons/edex/index.theme ]; then
    update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme \
        /usr/share/icons/edex/index.theme 100 2>/dev/null || true
    update-alternatives --set x-cursor-theme /usr/share/icons/edex/index.theme 2>/dev/null || true
fi

# Clipboard bridge (task #5): the appmonitor backend spawns one of these per
# nested virtual display to sync its CLIPBOARD (text) with the main display :0,
# so copying in Firefox (nested Xvfb) pastes in the eDEX terminal and vice
# versa. Needs xclip (in build-iso.sh APTOPTS). backend.js hardcodes the path
# /usr/local/bin/edex-clipboard-bridge.sh.
for S in /root/edex-clipboard-bridge.sh /cdrom/nocloud/edex-clipboard-bridge.sh; do
    if [ -f "$S" ]; then
        cp "$S" /usr/local/bin/edex-clipboard-bridge.sh
        chmod +x /usr/local/bin/edex-clipboard-bridge.sh
        echo "[edex] clipboard bridge installed"
        break
    fi
done
command -v xclip >/dev/null 2>&1 \
    || echo "[edex] WARN: xclip missing — 'xclip' must be in build-iso.sh APTOPTS"

# Fcitx5 as the system input-method framework (Rime/小狼毫 engine), so any
# GTK/Qt app (including the ones in the nested virtual displays) can type
# Chinese. The IM env is exported globally so Xvfb-launched apps inherit it.
echo "[edex] Fcitx5 input method (Rime engine) + global IM env"
cat > /etc/environment <<'IMENV'
GTK_IM_MODULE=fcitx
QT_IM_MODULE=fcitx
XMODIFIERS=@im=fcitx
IMENV

echo "[edex] touchpad tap-to-click (libinput)"
# Without this the touchpad's tap does nothing (users expect tap = click).
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/40-libinput.conf <<'XCONF'
Section "InputClass"
    Identifier "libinput touchpad catchall"
    MatchIsTouchpad "on"
    MatchDevicePath "/dev/input/event*"
    Driver "libinput"
    Option "Tapping" "on"
    Option "NaturalScrolling" "true"
    Option "ClickMethod" "clickfinger"
EndSection
XCONF

echo "[edex] openbox config (undecorated everywhere + Fn volume/brightness keys)"
mkdir -p /etc/xdg/openbox
cat > /usr/local/sbin/edex-volume.sh <<'VOL'
#!/usr/bin/env bash
# System volume helper for the Fn keys and the eDEX settings slider.
# Usage: edex-volume.sh up|down|mute|set <pct>
case "${1:-}" in
    up)   pactl set-sink-volume @DEFAULT_SINK@ +5% 2>/dev/null || amixer -q sset Master 5%+ || true ;;
    down) pactl set-sink-volume @DEFAULT_SINK@ -5% 2>/dev/null || amixer -q sset Master 5%- || true ;;
    mute) pactl set-sink-mute @DEFAULT_SINK@ toggle 2>/dev/null || amixer -q sset Master toggle || true ;;
    set)  pactl set-sink-volume @DEFAULT_SINK@ "${2:-50}%" 2>/dev/null || amixer -q sset Master "${2:-50}%" || true ;;
    *)    exit 0 ;;
esac
VOL
chmod +x /usr/local/sbin/edex-volume.sh
cat > /usr/local/sbin/edex-brightness.sh <<'BRI'
#!/usr/bin/env bash
# Backlight helper for the Fn keys and the eDEX settings slider.
# Usage: edex-brightness.sh up|down|set <pct>
B=""
for d in /sys/class/backlight/*/brightness; do [ -f "$d" ] && B="$d" && break; done
[ -n "$B" ] || exit 0
MAX=$(cat "${B%/brightness}/max_brightness" 2>/dev/null || echo 100)
CUR=$(cat "$B" 2>/dev/null || echo 0)
case "${1:-}" in
    up)   VAL=$((CUR + MAX / 20)) ;;
    down) VAL=$((CUR - MAX / 20)) ;;
    set)  VAL=$((MAX * ${2:-50} / 100)) ;;
    *)    exit 0 ;;
esac
[ "$VAL" -lt 0 ] && VAL=0
[ "$VAL" -gt "$MAX" ] && VAL=$MAX
if [ -w "$B" ]; then echo "$VAL" > "$B" 2>/dev/null || true
else echo "$VAL" | sudo -n tee "$B" >/dev/null 2>&1 || true; fi
BRI
chmod +x /usr/local/sbin/edex-brightness.sh
cat > /etc/xdg/openbox/rc.xml <<'OPENBOX'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <!-- kiosk look: no title bars on anything -->
    <application class="*">
      <decor>no</decor>
    </application>
  </applications>
  <keyboard>
    <keybind key="XF86AudioRaiseVolume"><action name="Execute"><command>/usr/local/sbin/edex-volume.sh up</command></action></keybind>
    <keybind key="XF86AudioLowerVolume"><action name="Execute"><command>/usr/local/sbin/edex-volume.sh down</command></action></keybind>
    <keybind key="XF86AudioMute"><action name="Execute"><command>/usr/local/sbin/edex-volume.sh mute</command></action></keybind>
    <keybind key="XF86MonBrightnessUp"><action name="Execute"><command>/usr/local/sbin/edex-brightness.sh up</command></action></keybind>
    <keybind key="XF86MonBrightnessDown"><action name="Execute"><command>/usr/local/sbin/edex-brightness.sh down</command></action></keybind>
    <!-- Power button: logind is told to ignore the ACPI power key (edex.conf),
         so it reaches X as XF86PowerOff and opens the in-app POWER menu. -->
    <keybind key="XF86PowerOff"><action name="Execute"><command>/usr/local/sbin/edex-power-menu.sh</command></action></keybind>
  </keyboard>
</openbox_config>
OPENBOX
cat > /usr/local/sbin/edex-power-menu.sh <<'PWR'
#!/usr/bin/env bash
# Power button → eDEX POWER menu. logind ignores the ACPI power key
# (HandlePowerKey=ignore in edex.conf), so openbox gets it as an XF86PowerOff
# keypress and runs this script, which asks the running eDEX app to open the
# same power modal the clock opens (Restart / Lock Screen / Suspend / Shutdown).
# If the app is not up yet (greeter / pre-login) nothing happens — the button
# does nothing rather than yanking power. Long-pressing the hardware power
# button still force-powers-off (embedded-controller behavior, not remappable).
curl -s -m 2 http://127.0.0.1:17322/ >/dev/null 2>&1 || true
PWR
chmod +x /usr/local/sbin/edex-power-menu.sh

echo "[edex] logind: suspend on lid close, power key → app power menu"
# Laptops must suspend when the lid closes (on AC too — eDEX runs in a terminal
# anyway, so there is no "docked monitor" use case). On resume the eDEX app
# re-locks the screen when a passcode is configured.
# HandlePowerKey=ignore makes the ACPI power button NOT power off (logind's
# default is a hard poweroff). Instead openbox receives it as an XF86PowerOff
# keypress and shows the in-app POWER menu — see the openbox keybind below.
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/edex.conf <<'LOGIND'
[Login]
HandleLidSwitch=suspend
HandleLidSwitchExternalPower=suspend
HandleLidSwitchDocked=ignore
HandlePowerKey=ignore
LOGIND

echo "[edex] login-user setup moved to first boot (edex-firstboot.service)"
# The interactive identity (#174) is created by cloud-init on the INSTALLED
# system's FIRST boot — AFTER these late-commands run (verified 2026-08-14:
# user created 16:50 by cloud-init, install-edex ran 16:43). No user-level
# config can be done here. /usr/local/sbin/edex-firstboot.sh (unit:
# After=cloud-init.target, Before=lightdm.service) detects the real user and
# applies autologin / passwordless sudo / seeded settings / folders / fcitx
# profile once it exists.

# WiFi: wpa_supplicant.service declares Group=netdev. The build-time rootfs
# addgroup does NOT survive the install — the real machine (2026-08-10) came up
# missing netdev, so wpa_supplicant failed to start (status=216/GROUP) and the
# wifi scan returned empty. Ensure the group exists on every installed system.
getent group netdev >/dev/null 2>&1 || addgroup --system netdev
# (the login user is added to video/netdev by edex-firstboot.sh at first boot)

# Audio boot race fix: rtkit-daemon fails to start if the `rtkit` system user is
# missing ("Failed to find user 'rtkit'") — then every RealtimeKit activation
# (pulseaudio realtime, xdg-desktop-portal, ...) blocks on a 25s D-Bus timeout,
# which on this machine made pulseaudio take 51-76s to become ready. eDEX plays
# its boot animation sound in the first ~6s, before pulse was up -> no sound.
# Ensure the user exists (idempotent) and the service starts at boot.
if ! id rtkit >/dev/null 2>&1; then
    getent group rtkit >/dev/null 2>&1 || addgroup --system rtkit
    useradd --system --gid rtkit --home-dir /var/lib/rtkit \
        --shell /usr/sbin/nologin --comment "RealtimeKit" rtkit
fi
mkdir -p /var/lib/rtkit
chown rtkit:rtkit /var/lib/rtkit 2>/dev/null || true
systemctl enable rtkit-daemon 2>/dev/null || true

echo "[edex] fcitx5 profile: keyboard-us + pinyin + Rime, default US (input method #16)"
# fcitx5 is launched and the IM env is set (edex-session.sh), but without a
# profile the engine list is EMPTY — so Ctrl+Space has nothing to switch to and
# the system is stuck on "EN" no matter what. The profile is seeded into
# /etc/skel (NOT the login user): Subiquity defers creating the real user to
# cloud-init at FIRST BOOT, so /home/<user> doesn't exist at install time.
# edex-firstboot.sh copies /etc/skel/.config/fcitx5 into the real home after
# the user is created. Writing the profile gives fcitx5 three input methods:
# keyboard-us (English, the default), pinyin (libime — instant candidates, no
# schema compile) and rime (小狼毫, builds its schemas on first activation).
# pinyin comes FIRST so the EN/中 toggle lands on a candidate window that works
# out of the box; rime stays available for users who want it. Rime initializes
# ~/.config/fcitx5/rime on first activation.
mkdir -p /etc/skel/.config/fcitx5
cat > /etc/skel/.config/fcitx5/profile <<'PROFILE'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=keyboard-us

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=pinyin
Layout=

[Groups/0/Items/2]
Name=rime
Layout=

[GroupOrder]
0=Default
PROFILE
# classicui renders the candidate window. On a minimal X build its font
# fallback can produce a window that is blank or tofu (no visible candidates)
# even though the engine is working; pin a CJK font explicitly so 候选框 always
# draws. PerScreenDPI=False stops the popup from picking a wrong DPI in
# nested/Xvfb displays and mis-scaling (or flying off-screen).
# The colors match the seeded "tron" theme (#144): near-black panel on the
# terminal's #05080d, accent #aacfd1 text, and the selected candidate as an
# accent block with dark text — the same dark/cyan look as the rest of the UI.
mkdir -p /etc/skel/.config/fcitx5/conf
cat > /etc/skel/.config/fcitx5/conf/classicui.conf <<'CUI'
[Appearance]
Font="Noto Sans CJK SC 12"
PerScreenDPI=False
NormalColor=#aacfd1
NormalBackgroundColor=#05080d
HighlightColor=#05080d
HighlightBackgroundColor=#aacfd1
SpellHintColor=#6b7f80
ShadowColor=#000000
CUI
# (rime_deployer --build moved to edex-firstboot.sh — it needs the real user's
#  home, which only exists at first boot.)

echo "[edex] NetworkManager as the network stack (WiFi via nmcli)"
# CRITICAL: the interactive installer (subiquity) writes /etc/netplan/00-installer-config.yaml
# from the network answers, and Ubuntu Server defaults to renderer: networkd there.
# Leaving that file in place means the system has TWO netplan files declaring two
# DIFFERENT renderers — netplan refuses that ("conflicting renderer"), the whole
# network config fails to generate, and NetworkManager never takes over. That is
# the classic "cannot find any WiFi" failure on this build. Drop every
# installer-generated config so ours is the only netplan file in play.
rm -f /etc/netplan/00-installer-config.yaml /etc/netplan/*-installer-config.yaml
cat > /etc/netplan/01-network-manager-all.yaml <<'NETPLAN'
network:
  version: 2
  renderer: NetworkManager
NETPLAN
chmod 600 /etc/netplan/01-network-manager-all.yaml
systemctl enable NetworkManager.service 2>/dev/null || true

# Boot-critical: subiquity may enable systemd-networkd (+ wait-online) when the
# install-time network answer rendered with networkd. This system is pure
# NetworkManager, and with our netplan gone wait-online has no interface to
# watch — systemd 255 then blocks boot forever ("A start job is running for
# systemd-networkd-wait-online.service / no limit") while plymouth shows a frozen
# logo. Mask it so fresh installs boot straight to the UI.
systemctl disable systemd-networkd-wait-online.service 2>/dev/null || true
systemctl mask systemd-networkd-wait-online.service 2>/dev/null || true

echo "[edex] wifi: disable power-save (weak/invisible-signal fix)"
# Ubuntu ships a default-wifi-powersave-on.conf setting wifi.powersave=3. Power-save
# makes iwlwifi drop beacons and miss networks entirely on some laptops (the E580
# included). NetworkManager merges /etc/NetworkManager/conf.d/*.conf in name order,
# so a file sorting AFTER "default-*" (zz-) overrides the shipped default. 2 =
# NM_SETTING_WIRELESS_POWERSAVE_DISABLE.
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/zz-edex-wifi-powersave-off.conf <<'NMPW'
[connection]
wifi.powersave = 2
NMPW
systemctl try-restart NetworkManager 2>/dev/null || true

echo "[edex] timezone Asia/Shanghai + NTP sync"
# Fresh installs boot on UTC with no timezone, so the clock is wrong until the
# user fixes it. Set Asia/Shanghai as the default and let systemd-timesyncd sync
# it over the network. The settings UI can override both later via timedatectl.
echo "Asia/Shanghai" > /etc/timezone
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
systemctl enable systemd-timesyncd.service 2>/dev/null || true

echo "[edex] bluetooth: enable the bluez stack"
# bluez is injected into the squashfs on the build side (a fresh boot has no apt).
# A real dpkg postinst would create the "bluetooth" group and enable the unit —
# do that here instead. `systemctl enable` also writes the dbus-org.bluez.service
# alias, so bluetoothd is D-Bus auto-activated the first time anything (the eDEX
# settings Bluetooth tab, NetworkManager) talks to org.bluez.
addgroup --system bluetooth 2>/dev/null || true
systemctl enable bluetooth.service 2>/dev/null || true

echo "[edex] plymouth boot splash (#19)"
# plymouth + the spinner theme are BAKED into the squashfs (build-iso.sh APTOPTS);
# this block is what makes plymouth actually RUN on a fresh install: GRUB does not
# pass "splash" unless /etc/default/grub says so, and the initramfs must embed the
# plymouth modules. update-initramfs and update-grub are chroot/mount dependent,
# which is exactly why this lives here (curtin in-target) and not on the macOS
# build side.
cat > /etc/default/grub <<'GRUB'
GRUB_DEFAULT=0
# Hidden menu + zero timeout: skip the 2s black text-menu entirely on normal
# boots (task #6 "黑屏"). The menu still appears on a FAILED boot via the
# recordfail path (grub.cfg then sets timeout=30), so recovery stays reachable.
GRUB_TIMEOUT_STYLE=hidden
GRUB_TIMEOUT=0
GRUB_DISTRIBUTOR=`lsb_release -i -s 2>/dev/null || echo Debian`
# pcie_aspm=off: PCIe Active State Power Management is the single most common
# cause of flaky built-in WiFi on laptops (RTL8821CE/8822CE flood the log with
# "PCIe Bus Error: Correctable Physical Layer" and never scan; some Broadcom and
# Intel cards drop off the bus entirely). Disabling it costs a little idle power
# but makes WiFi across arbitrary hardware far more reliable.
# No "quiet splash": boot logs stream to the console so a hang is diagnosable
# on the first screen (the splash masked a frozen boot as a still logo on v2.4.9
# fresh installs). Text boot, no plymouth overlay — user-approved default.
GRUB_CMDLINE_LINUX_DEFAULT="pcie_aspm=off"
GRUB_CMDLINE_LINUX=""
# Dark sci-fi GRUB menu: render in graphical mode at the panel's native
# resolution and keep the same framebuffer for the kernel, so there is no
# VGA-text->KMS mode switch — that switch is the "white flash" before the boot
# splash on real hardware (task #4 boot). gfxterm auto-falls back to the VGA
# text console if a GPU cannot do graphical mode, so bootability is preserved.
# The `error: file '/boot/' not found` line that flashes above the menu is
# UNRELATED to this file: it comes from the signed grubx64.efi's embedded config
# and is cosmetic (#11).
GRUB_TERMINAL_OUTPUT="gfxterm"
GRUB_GFXMODE=1920x1080,1024x768,800x600,auto
GRUB_GFXPAYLOAD_LINUX=keep
GRUB_COLOR_NORMAL="white/black"
GRUB_COLOR_HIGHLIGHT="cyan/black"
GRUB_DISABLE_OS_PROBER=true
GRUB
# eDEX boot theme. The stock spinner theme is kept as a fallback; we build an
# "edex" theme on top of its assets: the animation/dialog PNGs are generic
# (no Ubuntu branding), and the two branded bits come from the ISO payload —
# edex.plymouth (config) and edex-boot-logo.png, installed as bgrt-fallback.png
# because the two-step plugin draws that image centered when the firmware has no
# BGRT logo (that is precisely where the stock Ubuntu circle came from).
if command -v plymouthd >/dev/null 2>&1; then
    mkdir -p /usr/share/plymouth/themes/edex
    if [ -d /usr/share/plymouth/themes/spinner ]; then
        for f in /usr/share/plymouth/themes/spinner/*.png; do
            [ "$(basename "$f")" = "bgrt-fallback.png" ] && continue
            # watermark.png in the stock spinner theme IS the Ubuntu circle, drawn
            # at the bottom of the splash (edex.plymouth WatermarkVerticalAlignment
            # =.96). We install a transparent one below instead, so no Ubuntu logo
            # survives at the bottom (task #4 boot).
            [ "$(basename "$f")" = "watermark.png" ] && continue
            cp -n "$f" /usr/share/plymouth/themes/edex/ 2>/dev/null || true
        done
    fi
    # Fully transparent watermark (1x1 PNG): the theme draws whatever watermark.png
    # is at the bottom; transparent = no logo. base64 is coreutils, always present.
    echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' \
        | base64 -d > /usr/share/plymouth/themes/edex/watermark.png
    # This script runs inside the curtin chroot (/target), where the live ISO's
    # /cdrom is NOT mounted — the payload is copied to /root by user-data
    # late-commands. Check /root first, then /cdrom/nocloud as a fallback for
    # older ISOs / manual runs. Falling back to the stock spinner theme is the
    # "keep something working" path, but its bgrt-fallback.png is the Ubuntu
    # circle — so a silent fallback is exactly the bug the user sees as "still
    # the Ubuntu logo" (#142). The payload must land.
    PLYMOUTH_SRC=""
    if [ -f /root/edex.plymouth ] && [ -f /root/edex-boot-logo.png ]; then
        PLYMOUTH_SRC=/root
    elif [ -f /cdrom/nocloud/edex.plymouth ] && [ -f /cdrom/nocloud/edex-boot-logo.png ]; then
        PLYMOUTH_SRC=/cdrom/nocloud
    fi
    if [ -n "$PLYMOUTH_SRC" ]; then
        cp "$PLYMOUTH_SRC/edex.plymouth" /usr/share/plymouth/themes/edex/edex.plymouth
        cp "$PLYMOUTH_SRC/edex-boot-logo.png" /usr/share/plymouth/themes/edex/bgrt-fallback.png
        # Replace the stock white Ubuntu spinner ring (the "power-on Ubuntu logo",
        # task #8) with the eDEX green ring shipped in the payload.
        if [ -d "$PLYMOUTH_SRC/throbber" ]; then
            cp "$PLYMOUTH_SRC/throbber/"*.png /usr/share/plymouth/themes/edex/ 2>/dev/null || true
            cp "$PLYMOUTH_SRC/animation/"*.png /usr/share/plymouth/themes/edex/ 2>/dev/null || true
        fi
        plymouth-set-default-theme edex 2>/dev/null || true
        echo "[edex] plymouth theme: edex"
    else
        # payload missing — spinner is a text-category theme (always works, no
        # GPU requirement) and still animates.
        echo "[edex] WARN: edex theme payload missing — keeping spinner theme"
        plymouth-set-default-theme spinner 2>/dev/null || true
    fi
else
    echo "[edex] WARN: plymouthd missing — 'plymouth plymouth-theme-spinner' must be in build-iso.sh APTOPTS"
fi
update-initramfs -u >/tmp/edex-update-initramfs.log 2>&1 \
    || { echo "[edex] WARN: update-initramfs failed"; tail -20 /tmp/edex-update-initramfs.log; }
update-grub >/tmp/edex-update-grub.log 2>&1 \
    || { echo "[edex] WARN: update-grub failed"; tail -20 /tmp/edex-update-grub.log; }

echo "[edex] lightdm system user"
# lightdm needs its own system user for the greeter/autologin to work; when it's
# missing (apt installed lightdm without it, or the image was built before this
# block existed) lightdm silently fails to start and the system drops to a text
# console. Create it defensively — uid/gid are assigned automatically.
if ! getent passwd lightdm >/dev/null 2>&1; then
    groupadd --system lightdm 2>/dev/null || true
    useradd --system --gid lightdm --home-dir /var/lib/lightdm \
        --shell /usr/sbin/nologin --comment "Light Display Manager" lightdm 2>/dev/null || true
    mkdir -p /var/lib/lightdm
    chown lightdm:lightdm /var/lib/lightdm 2>/dev/null || true
fi

echo "[edex] lightdm autologin + ALL user-level config → FIRST BOOT (edex-firstboot.service)"
# The autoinstall keeps the identity step interactive (#174), so Subiquity defers
# creating the real login user to cloud-init on the INSTALLED system's FIRST BOOT
# — AFTER this script's late-commands (verified on the 2026-08-14 laptop: user
# created 16:50 by cloud-init, install-edex ran 16:43). Any user-level config
# written here (autologin / sudoers / ~/Applications / CLAUDE.md / settings.json)
# would land on the self-heal 'edex' account while the real user got nothing →
# lightdm crash-loop (black screen). ALL of it now lives in edex-firstboot.sh,
# which runs After=cloud-init.target (user exists) and Before=lightdm.service
# (autologin in place); the systemd unit is installed at the end of this script.
# System-level lightdm pieces stay here: the lightdm system user is above, and
# the autologin conf.d 'z' prefix + 0-byte guard logic live in edex-firstboot.sh.

echo "[edex] SSH server: installed and ON by default (settings → network → SSH)"
# openssh-server is baked into the ISO; default SSH to ON on fresh installs
# (socket-activated, survives reboot). Toggle off in settings → network → SSH
# runs `systemctl disable --now ssh.socket`.
# Two bugs in the old `enable --now ssh ssh.socket`, both fixed here:
#   1) sshd privilege-separation user: the ISO build's openssh-server postinst
#      can silently skip creating `sshd` (adduser fails inside the build's
#      proot), so a fresh install boots with `sshd -t` → "Privilege separation
#      user sshd does not exist" and SSH is dead. Create group/user/dir
#      idempotently here — this runs in the real target chroot where adduser
#      works. Order matters: group first, then /run/sshd, then the user (adduser
#      wants its --home to exist).
#   2) enable ONLY ssh.socket, not ssh.service: enabling both makes ssh.socket
#      bind :22 first at boot and ssh.service then fail with "Address already in
#      use" → red FAILED text. Ubuntu 24.04 socket-activates sshd, so the socket
#      alone is enough (`--now` can't work in a chroot anyway — no PID 1).
#      ssh.service must be explicitly disabled, else it fights the socket.
if ! getent group ssh >/dev/null 2>&1; then addgroup --system ssh || true; fi
mkdir -p /run/sshd
if ! getent passwd sshd >/dev/null 2>&1; then
    adduser --system --ingroup ssh --home /run/sshd --no-create-home --shell /usr/sbin/nologin sshd || true
fi
# Regenerate host keys if the skipped postinst left none behind.
[ -s /etc/ssh/ssh_host_ed25519_key ] || [ -s /etc/ssh/ssh_host_rsa_key ] || ssh-keygen -A 2>/dev/null || true
systemctl disable ssh.service 2>/dev/null || true
systemctl enable ssh.socket 2>/dev/null || true

echo "[edex] Flatpak: flathub remote (flatpak group add → edex-firstboot.sh)"
# flatpak core + xdg-desktop-portal(-gtk) are baked into the ISO. Wire up the
# app source so the system "directly runs Flatpak" (run needs no privileges;
# the app list auto-scans /var/lib/flatpak/exports/share/applications). The
# flatpak group add for the login user moved to edex-firstboot.sh (the real
# user doesn't exist until first boot). Register the flathub remote here
# (best-effort: install may be offline — the same command is echoed so it can
# be re-run at first use; `sudo flatpak install` via the user's passwordless
# sudo is the reliable install path).
if ! flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo 2>/dev/null; then
    echo "[edex] WARN: flathub remote-add failed (offline?) — run later:"
    echo "         flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo"
fi

# apt must point at the Ubuntu archive so 'sudo apt update && upgrade' works.
# Ubuntu 24.04 writes the same repos as /etc/apt/sources.list.d/ubuntu.sources at
# install time; keeping both makes apt warn about duplicate sources on every login
# MOTD. Drop the deb822 file and keep our plain sources.list as the single source.
rm -f /etc/apt/sources.list.d/ubuntu.sources
cat > /etc/apt/sources.list <<'SOURCES'
deb http://archive.ubuntu.com/ubuntu noble main universe multiverse restricted
deb http://security.ubuntu.com/ubuntu noble-security main universe multiverse restricted
deb http://archive.ubuntu.com/ubuntu noble-updates main universe multiverse restricted
SOURCES

echo "[edex] seeding eDEX settings → FIRST BOOT (edex-firstboot.sh)"
# settings.json must land in the REAL user's ~/.config/eDEX-UI, which doesn't
# exist until cloud-init creates the user at first boot — so the seed (template,
# cwd fix to the real home, chown) moved to edex-firstboot.sh. No lockCode is
# seeded, so classes/firstRun.class.js shows a code-lock-style setup screen on
# the first launch and writes the PIN (lockCode / lockOnIdle / language) into
# settings.json itself. Root password no longer exists — Ubuntu's install set
# the user password.

# ---------------------------------------------------------------------------
# first-boot user-setup unit (delivers ALL login-user config once cloud-init
# has created the real user — see edex-firstboot.sh at the top of the FATAL
# section for the full WHY). This is the ONLY user-config deliverable.
# ---------------------------------------------------------------------------
rm -f /etc/edex-firstboot.done
cat > /usr/local/sbin/edex-firstboot.sh <<'FBEOF'
#!/usr/bin/env bash
# eDEX-OS first-boot user setup.
#
# WHY this runs at first boot and NOT at install:
#   The autoinstall keeps the identity step interactive (#174), so Subiquity
#   defers creating the real login user to cloud-init on the INSTALLED system's
#   FIRST BOOT — AFTER install-edex.sh's late-commands have finished (verified on
#   the 2026-08-14 laptop: user created 16:50 by cloud-init, install-edex ran
#   16:43). Install-time user detection therefore never sees the real user; what
#   it did write went to the self-heal 'edex' account while the real user got
#   nothing → lightdm crash-loop (black screen). This script runs once the user
#   exists (unit: After=cloud-init.target) and before lightdm (Before=lightdm.service),
#   and applies ALL user-level config to the real account.
#
# Runs once: /etc/edex-firstboot.done is touched on success; the systemd unit
# skips when the done-file exists, so a failed run retries on the next boot.
# Idempotent — safe to re-run manually for repair:
#     sudo /usr/local/sbin/edex-firstboot.sh
#
# IMPORTANT: the canonical copy of this script lives in
# packaging/install/edex-firstboot.sh — keep the two in sync when editing.
set -euo pipefail

# ---------------------------------------------------------------------------
# user detection
# ---------------------------------------------------------------------------
# Leftover build/CI accounts that must never be treated as the real user.
leftover() { # true if $1 is a known leftover name
    case "$1" in edex|runner|ubuntu) return 0 ;; *) return 1 ;; esac
}

pick_user() {
    # 1) the first uid>=1000 member of `adm` — Subiquity's marker (the real user
    #    is always added to adm/cdrom/sudo/...; the self-heal 'edex' is only in
    #    sudo, never adm, so it can't win here).
    local u
    u="$(getent group adm 2>/dev/null | cut -d: -f4 | tr ',' '\n' \
        | while read -r c; do
            [ -n "$c" ] || continue
            leftover "$c" && continue
            uid="$(id -u "$c" 2>/dev/null)" || continue
            [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ] && { echo "$c"; break; }
          done)" || true
    [ -n "$u" ] && { echo "$u"; return; }
    # 2) else: the uid>=1000 account whose home-dir is newest — the freshly
    #    created user wins over any leftover regardless of name. Home comes from
    #    getent passwd (field 6) so non-/home locations work too.
    local best="" best_t=0 home t
    for u in $(getent passwd | awk -F: '$3>=1000 && $3<65534 {print $1}'); do
        home="$(getent passwd "$u" 2>/dev/null | cut -d: -f6)"
        home="${home:-/home/$u}"
        [ -d "$home" ] || continue
        t="$(stat -c %Y "$home" 2>/dev/null)" || continue
        [ "$t" -gt "$best_t" ] && { best="$u"; best_t="$t"; }
    done
    [ -n "$best" ] && { echo "$best"; return; }
    return 1
}

echo "[edex-firstboot] detecting the real login user"
# Wait up to ~30s for cloud-init to finish creating the login user (normal boot:
# After=cloud-init.target makes this instant; the poll is insurance only).
U=""
for ((i=0; i<10; i++)); do
    U="$(pick_user)" && break
    sleep 3
done
if [ -z "$U" ]; then
    echo "[edex-firstboot] WARN: no login user found — creating default user 'edex'"
    U="edex"
    id "$U" >/dev/null 2>&1 || useradd -m -s /bin/bash "$U"
    echo "$U:edex" | chpasswd
    usermod -aG sudo "$U"
fi
echo "[edex-firstboot] configured for user: $U"

# ---------------------------------------------------------------------------
# critical user config (failure here → no done-file → retry next boot)
# ---------------------------------------------------------------------------

# Backlight is owned by the `video` group — the Fn keys / settings slider fall
# back to sudo (passwordless) without it. wpa_supplicant uses `netdev`.
usermod -aG video "$U" 2>/dev/null || true
usermod -aG netdev "$U" 2>/dev/null || true

# lightdm autologin. The 'z' prefix must sort AFTER the lightdm-autologin-greeter
# package's own lightdm-autologin-greeter.conf, which ships a placeholder
# autologin-user=AUTOLOGIN-USER-NOT-CONFIGURED — later conf.d files win, so OUR
# value overrides the placeholder and the system boots to eDEX instead of a
# text console. The greeter is pinned explicitly (default would be
# lightdm-gtk-greeter, which is NOT installed).
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/zz-edex-autologin.conf <<CONF
[Seat:*]
autologin-user=$U
autologin-session=edex
user-session=edex
greeter-session=lightdm-autologin-greeter
autologin-user-timeout=0
CONF
if [ ! -s /etc/lightdm/lightdm.conf.d/zz-edex-autologin.conf ]; then
    echo "[edex-firstboot] FATAL: zz-edex-autologin.conf empty/missing (autologin would break)" >&2
    exit 1
fi

# Passwordless sudo for the autologin user (single-user demo laptop). Every
# privileged UI action (settings toggles, sshd, apt updates, flatpak install)
# relies on it.
echo "$U ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/edex-user
chmod 440 /etc/sudoers.d/edex-user
if [ ! -s /etc/sudoers.d/edex-user ]; then
    echo "[edex-firstboot] FATAL: /etc/sudoers.d/edex-user empty/missing (passwordless sudo broken)" >&2
    exit 1
fi
visudo -cf /etc/sudoers.d/edex-user >/dev/null 2>&1 \
    || { echo "[edex-firstboot] FATAL: /etc/sudoers.d/edex-user failed visudo -cf" >&2; exit 1; }

# Seed eDEX settings. No lockCode yet → the in-app first-run setup
# (classes/firstRun.class.js) shows a code-lock-style screen on first launch and
# writes the PIN (lockCode / lockOnIdle / language) into this file itself. Root
# password no longer exists — Ubuntu's install already set the user password.
mkdir -p "/home/$U/.config/eDEX-UI"
cat > "/home/$U/.config/eDEX-UI/settings.json" <<'SETTINGS'
{
    "shell": "bash",
    "shellArgs": "",
    "cwd": "/home/edex",
    "theme": "tron",
    "termFontSize": 14,
    "audio": true,
    "audioVolume": 1.0,
    "disableFeedbackAudio": false,
    "clockHours": 24,
    "pingAddr": "223.5.5.5",
    "port": 3000,
    "nointro": false,
    "nocursor": false,
    "forceFullscreen": true,
    "allowWindowed": false,
    "excludeThreadsFromToplist": true,
    "hideDotfiles": false,
    "fsListView": false,
    "screensaverEnabled": true,
    "screensaverIdle": 180,
    "screensaverStyle": "code",
    "appMonitor": {
        "enabled": false,
        "mock": false,
        "httpPort": 6080,
        "wsPort": 6081,
        "appImageDirs": "~/Applications,~/AppImages"
    },
    "claude": {
        "enabled": true,
        "baseUrl": "",
        "apiKey": "",
        "model": "",
        "haikuModel": ""
    },
    "webapps": []
}
SETTINGS
# fix the seeded cwd to the real home dir
sed -i "s|/home/edex|/home/$U|" "/home/$U/.config/eDEX-UI/settings.json" || true
chown -R "$U":"$U" "/home/$U/.config" || echo "[edex-firstboot] WARN: chown ~/.config failed"

# ---------------------------------------------------------------------------
# best-effort user config (failure → WARN, keep going)
# ---------------------------------------------------------------------------

# fcitx5 profile: install-edex.sh seeds /etc/skel (user-independent content);
# copy it into the real user so Ctrl+Space has pinyin/rime to switch to.
if [ -d /etc/skel/.config/fcitx5 ]; then
    mkdir -p "/home/$U/.config/fcitx5"
    cp -r /etc/skel/.config/fcitx5/. "/home/$U/.config/fcitx5/" 2>/dev/null || true
    chown -R "$U":"$U" "/home/$U/.config/fcitx5" 2>/dev/null || true
fi
# Best-effort: pre-deploy Rime so the first switch to 中 doesn't stall on the
# schema build — a stalled/failed deploy degrades Rime to latin pass-through.
if command -v rime_deployer >/dev/null 2>&1; then
    HOME="/home/$U" rime_deployer --build >/dev/null 2>&1 || true
fi

# ~/Applications (drop .AppImage files here) + standard folders (file-browser
# tabs point at them and would report "cannot connect" otherwise).
mkdir -p "/home/$U/Applications"
for d in Desktop Documents Downloads Music Pictures Public Templates Videos; do
    mkdir -p "/home/$U/$d"
done
chown "$U":"$U" "/home/$U/Applications" "/home/$U/Desktop" "/home/$U/Documents" \
    "/home/$U/Downloads" "/home/$U/Music" "/home/$U/Pictures" "/home/$U/Public" \
    "/home/$U/Templates" "/home/$U/Videos" 2>/dev/null || true

# House rules for the built-in Claude Code assistant (~/CLAUDE.md is read
# automatically): how to install apps, where AppImages go, wifi, updates.
cat > "/home/$U/CLAUDE.md" <<'RULES'
# eDEX-OS 系统约定(Claude Code 请遵守)

这是一台 eDEX-OS 演示机(改装 Ubuntu 24.04),单用户,自动登录用户有**免密 sudo**。用户说中文。

## 安装应用
- AppImage → 下载到 `~/Applications/` 并 `chmod +x`(会自动出现在终端 tab 4/5 的 app 列表)。
- .deb → `sudo apt install ./xxx.deb`。
- 其它包 → `sudo apt install <包名>`(需已联网)。

## 联网
- NetworkManager:`nmcli dev wifi connect <ssid> password <pw>`;或提示用户点右下角 WIFI 按钮。

## 系统更新
- `sudo apt update && sudo apt full-upgrade`;或提示用户用齿轮菜单的"系统更新"按钮。

## Flatpak(需联网;装系统时已配好 flathub 源,若当时没网请先跑下面那条)
- 确保源:先跑 `flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo`。
- 安装:`sudo flatpak install flathub <app-id>`(如 `sudo flatpak install flathub dev.vencord.Vesktop`;
  本机自动登录用户已有免密 sudo,这是可靠路径。装好即出现在 tab 4/5 应用列表,点开即全屏运行)。
- wiliwili 的 x86_64 只有 flatpak 版。

## 其它
- 系统自带 Firefox(/opt/firefox)与 eDEX 终端(tab 1/2)与虚拟显示器(tab 4/5)。
- 交互时用中文,简洁说明你做了什么。
RULES
chown "$U":"$U" "/home/$U/CLAUDE.md" || echo "[edex-firstboot] WARN: chown ~/CLAUDE.md failed"

# Let the autologin user update the baked-in Firefox and Claude CLI in place
# (their updaters write into /opt/firefox and the npm global dir).
chown -R "$U":"$U" /opt/firefox /usr/local/lib/node_modules /usr/local/bin 2>/dev/null || true

# flatpak group (best-effort; the reliable install path is the passwordless sudo
# the user already has → `sudo flatpak install flathub <app>`).
if getent group flatpak >/dev/null 2>&1; then
    usermod -aG flatpak "$U" 2>/dev/null || true
fi

touch /etc/edex-firstboot.done
echo "[edex-firstboot] done — configured for user $U"
FBEOF
chmod 755 /usr/local/sbin/edex-firstboot.sh
cat > /etc/systemd/system/edex-firstboot.service <<'SVC'
[Unit]
Description=eDEX-OS first-boot user setup
# The real login user is created by cloud-init on the installed system's FIRST
# BOOT (Subiquity defers the interactive identity past install-edex.sh), so this
# must run After=cloud-init.target — and Before=lightdm.service so the autologin
# config is in place before the greeter starts. A done-file touched by the script
# makes a failed run retry on the next boot.
ConditionPathExists=!/etc/edex-firstboot.done
After=cloud-init.target systemd-user-sessions.service
Before=lightdm.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/edex-firstboot.sh
RemainAfterExit=yes

[Install]
# WantedBy=cloud-init.target (NOT multi-user.target) — cloud-init.target itself is
# After=multi-user.target, so WantedBy=multi-user.target + After=cloud-init.target
# forms an ordering cycle (multi-user→edex→cloud-init→multi-user) and systemd
# deletes the start job → firstboot never runs → autologin placeholder → lightdm
# crash loop. Seen on v2.4.4 fresh install (2026-08-15, laptop aki).
WantedBy=cloud-init.target
SVC
systemctl daemon-reload
systemctl enable edex-firstboot.service 2>/dev/null || true

echo "[edex] done"
