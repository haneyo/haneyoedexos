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
# the whole screen. On the FIRST boot the one-time setup wizard runs first
# (root password + unlock PIN); the marker file skips it on later boots.
export DISPLAY=:0
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
# Wake the wireless radio: rfkill can leave it soft-blocked right after a fresh
# install (and some EFI firmware settings hard-block it). NetworkManager handles
# scanning from here on; the WIFI button in eDEX drives nmcli.
rfkill unblock all 2>/dev/null || true
nmcli radio wifi on 2>/dev/null || true
# Turn on the keyboard backlight: many ThinkPads boot with it off.
if [ -d /sys/class/leds/tpacpi::kbd_backlight ]; then
    echo 2 > /sys/class/leds/tpacpi::kbd_backlight/brightness 2>/dev/null || true
fi
openbox --replace >/dev/null 2>&1 &
fcitx5 -d >/dev/null 2>&1 &
sleep 1
if [ ! -f /etc/edex-setup-done ]; then
    # -fa gives xterm a CJK-capable font (fonts-noto-cjk is baked into the
    # squashfs), so the wizard's "中文" language option renders instead of tofu.
    xterm -geometry 96x28 -fa "Noto Sans CJK SC" -fs 12 -T "eDEX-OS · SYSTEM INITIALIZATION" -e /usr/local/sbin/edex-first-setup.sh
fi
exec /opt/edex/eDEX-UI.AppImage --no-sandbox
SESH
chmod +x /usr/local/sbin/edex-session.sh

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
  </keyboard>
</openbox_config>
OPENBOX

echo "[edex] logind: suspend on lid close"
# Laptops must suspend when the lid closes (on AC too — eDEX runs in a terminal
# anyway, so there is no "docked monitor" use case). On resume the eDEX app
# re-locks the screen when a passcode is configured.
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/edex.conf <<'LOGIND'
[Login]
HandleLidSwitch=suspend
HandleLidSwitchExternalPower=suspend
HandleLidSwitchDocked=ignore
LOGIND

echo "[edex] detecting installed user"
# Find the real login user via /etc/passwd, NOT by listing /home: the ISO's live
# rootfs can carry leftover home dirs (e.g. /home/runner leaked in from the CI
# builder) that get copied into every install and would otherwise win `head -1`,
# which then made chown fail and abort the whole install.
U="$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1; exit}')"
if [ -z "$U" ]; then
    # No login user was created — the interactive identity answer can be lost on
    # an installer restart. Self-heal so the system still boots to a usable
    # autologin desktop. The password is a documented kiosk default (autologin +
    # passwordless sudo); edex-first-setup.sh rekeys root + the lock PIN on the
    # first boot.
    echo "[edex] WARN: no login user in /etc/passwd — creating default user 'edex'"
    U="edex"
    if ! id "$U" >/dev/null 2>&1; then
        useradd -m -s /bin/bash "$U"
    fi
    echo "$U:edex" | chpasswd
    usermod -aG sudo "$U"
fi
# Backlight is owned by the `video` group — the autologin user must be in it or
# the Fn brightness keys / settings slider fall back to sudo (passwordless).
usermod -aG video "$U" 2>/dev/null || true
echo "[edex] configured for user: $U"

echo "[edex] fcitx5 profile: keyboard-us + Rime, default US (input method #16)"
# fcitx5 is launched and the IM env is set (edex-session.sh), but without a
# profile the engine list is EMPTY — so Ctrl+Space has nothing to switch to and
# the system is stuck on "EN" no matter what. Writing the profile gives fcitx5
# two input methods: keyboard-us (English, the default) and rime (中文, via
# Ctrl+Space). Rime initializes ~/.config/fcitx5/rime on first activation.
mkdir -p "/home/$U/.config/fcitx5"
cat > "/home/$U/.config/fcitx5/profile" <<'PROFILE'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=keyboard-us

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=rime
Layout=

[GroupOrder]
0=Default
PROFILE
chown -R "$U":"$U" "/home/$U/.config/fcitx5" 2>/dev/null || true
# seed /etc/skel so any account created later gets the same IM list
mkdir -p /etc/skel/.config/fcitx5
cp "/home/$U/.config/fcitx5/profile" /etc/skel/.config/fcitx5/profile

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
# plymouth + themes are baked into the squashfs, but two things are missing on a
# fresh install: GRUB does not pass "splash" so plymouth never starts, and the
# initramfs has no plymouth embedded. All three commands below must run INSIDE the
# installed system — update-initramfs/update-grub are chroot/mount dependent, which
# is exactly why this lives here (curtin in-target) and not on the macOS build side.
cat > /etc/default/grub <<'GRUB'
GRUB_DEFAULT=0
GRUB_TIMEOUT=2
GRUB_DISTRIBUTOR=`lsb_release -i -s 2>/dev/null || echo Debian`
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL_OUTPUT="console"
GRUB_DISABLE_OS_PROBER=true
GRUB
# spinner is a text-category theme (always works, no GPU/framebuffer requirement)
# while still showing a boot animation; details would be plain scrolling text.
plymouth-set-default-theme spinner 2>/dev/null || true
update-initramfs -u >/tmp/edex-update-initramfs.log 2>&1 \
    || { echo "[edex] WARN: update-initramfs failed"; tail -20 /tmp/edex-update-initramfs.log; }
update-grub >/tmp/edex-update-grub.log 2>&1 \
    || { echo "[edex] WARN: update-grub failed"; tail -20 /tmp/edex-update-grub.log; }

echo "[edex] lightdm autologin"
mkdir -p /etc/lightdm/lightdm.conf.d
# CRITICAL: this file must sort AFTER the lightdm-autologin-greeter package's own
# /etc/lightdm/lightdm.conf.d/lightdm-autologin-greeter.conf, which ships a
# placeholder autologin-user=AUTOLOGIN-USER-NOT-CONFIGURED. lightdm reads conf.d
# files in lexicographic order with later files overriding earlier ones, so a name
# starting with 'z' (after 'l') guarantees OUR autologin-user wins — otherwise
# lightdm tries to autologin as the placeholder user, fails, and the installed
# system drops to a text console instead of eDEX. Pin the greeter explicitly for
# the same reason (default would be lightdm-gtk-greeter, which is NOT installed).
cat > /etc/lightdm/lightdm.conf.d/zz-edex-autologin.conf <<CONF
[Seat:*]
autologin-user=$U
autologin-session=edex
user-session=edex
greeter-session=lightdm-autologin-greeter
autologin-user-timeout=0
CONF

echo "[edex] creating the ~/Applications folder (drop .AppImage files here)"
mkdir -p "/home/$U/Applications"
chown "$U":"$U" "/home/$U/Applications" || echo "[edex] WARN: chown ~/Applications failed"

echo "[edex] standard user directories (file-browser tabs)"
# Ubuntu Server creates none of ~/Desktop, ~/Documents, ... by default; the file
# browser's default tabs point at them and would report "cannot connect".
for d in Desktop Documents Downloads Music Pictures Public Templates Videos; do
    mkdir -p "/home/$U/$d"
    chown "$U":"$U" "/home/$U/$d" 2>/dev/null || true
done

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

## Flatpak(需联网,一次性配好源)
- 首次使用:先跑 `flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo`。
- 安装:如 `flatpak install flathub dev.vencord.Vesktop`(wiliwili 的 x86_64 只有 flatpak 版)。
- 装好的应用会出现在终端 tab 4/5 的 app 列表。

## 其它
- 系统自带 Firefox(/opt/firefox)与 eDEX 终端(tab 1/2)与虚拟显示器(tab 4/5)。
- 交互时用中文,简洁说明你做了什么。
RULES
chown "$U":"$U" "/home/$U/CLAUDE.md" || echo "[edex] WARN: chown ~/CLAUDE.md failed"

# Let the autologin user update the baked-in Firefox and Claude CLI in place
# (their updaters write into /opt/firefox and the npm global dir).
chown -R "$U":"$U" /opt/firefox /usr/local/lib/node_modules /usr/local/bin 2>/dev/null || true

echo "[edex] passwordless sudo for $U (single-user demo laptop)"
echo "$U ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/edex-user
chmod 440 /etc/sudoers.d/edex-user

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

echo "[edex] seeding eDEX settings"
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
    "nointro": true,
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
        "enabled": true,
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
    "webapps": [
        { "name": "Google", "url": "https://www.google.com" },
        { "name": "Bing",   "url": "https://www.bing.com" }
    ]
}
SETTINGS
# fix the seeded cwd to the real home dir
sed -i "s|/home/edex|/home/$U|" "/home/$U/.config/eDEX-UI/settings.json" || true
chown -R "$U":"$U" "/home/$U/.config" || echo "[edex] WARN: chown ~/.config failed"

# First-boot setup wizard. The autoinstall's late-commands run in the chroot
# with no interactive stdin, so the root password + unlock PIN cannot be asked
# for here — edex-session.sh launches this wizard once (in an xterm) on the
# first boot, before eDEX starts. It sets the root password and writes the
# numeric PIN into settings.json's lockCode, then marks the system configured.
echo "[edex] first-boot setup wizard (root password + unlock PIN)"
cat > /usr/local/sbin/edex-first-setup.sh <<'WIZARD'
#!/usr/bin/env bash
# eDEX-OS first-boot setup — runs once (before eDEX) in the autologin X session.
# Sets the interface language (used by eDEX, and skips eDEX's own first-launch
# picker), the root password and the numeric unlock PIN (4-8 digits), writes the
# language + PIN into eDEX's settings.json (language / lockCode) so the idle
# lock/screensaver unlocks with it, then marks the system configured. A later
# boot skips straight to eDEX.
set -euo pipefail

if [ -f /etc/edex-setup-done ]; then
    exit 0
fi

echo
echo "================================================================"
echo "    eDEX-OS · SYSTEM INITIALIZATION"
echo "    Choose the language, then set the root password + unlock PIN"
echo "================================================================"
echo

# --- interface language ---
# Drives eDEX's settings-menu language. Writing it here also sets
# settings.language before eDEX's first launch, which makes eDEX skip its own
# first-launch language picker — the choice is asked exactly once.
echo "Select interface language (default 1 = English):"
echo "   1) English"
echo "   2) 中文"
read -rp "Choice [1-2, default 1]: " UILANG
case "${UILANG:-1}" in
    2) UILANG="zh";;
    *) UILANG="en";;
esac
echo "  Interface language: $UILANG"
echo

# --- timezone ---
echo "Select timezone (default 1 = Asia/Shanghai):"
echo "   1) Asia/Shanghai       5) Europe/Berlin"
echo "   2) Asia/Tokyo          6) Europe/London"
echo "   3) Asia/Singapore      7) America/New_York"
echo "   4) Asia/Seoul          8) America/Los_Angeles"
read -rp "Choice [1-8, default 1]: " TZCHOICE
case "${TZCHOICE:-1}" in
    2) TZ="Asia/Tokyo";;
    3) TZ="Asia/Singapore";;
    4) TZ="Asia/Seoul";;
    5) TZ="Europe/Berlin";;
    6) TZ="Europe/London";;
    7) TZ="America/New_York";;
    8) TZ="America/Los_Angeles";;
    *) TZ="Asia/Shanghai";;
esac
sudo timedatectl set-timezone "$TZ" 2>/dev/null || sudo ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
echo "  Timezone set to $TZ"

# --- root password (any non-empty value, entered twice) ---
while :; do
    read -sp "Set root password: " R1; echo
    read -sp "Confirm root password: " R2; echo
    if [ -n "$R1" ] && [ "$R1" = "$R2" ]; then
        break
    fi
    echo "  Empty or mismatched. Try again."
done
echo "root:$R1" | sudo chpasswd
unset R1 R2

# --- unlock PIN (4-8 digits, entered twice) ---
while :; do
    read -sp "Set unlock PIN (4-8 digits): " P1; echo
    read -sp "Confirm PIN: " P2; echo
    if [[ "$P1" =~ ^[0-9]{4,8}$ ]] && [ "$P1" = "$P2" ]; then
        break
    fi
    if ! [[ "$P1" =~ ^[0-9]{4,8}$ ]]; then
        echo "  PIN must be 4-8 digits. Try again."
    else
        echo "  Mismatched. Try again."
    fi
done

# --- write the PIN into eDEX's settings.json, keeping everything else ---
SET="$HOME/.config/eDEX-UI/settings.json"
mkdir -p "$(dirname "$SET")"
[ -f "$SET" ] || echo '{}' > "$SET"
python3 - "$SET" "$P1" "$UILANG" <<'PY'
import json, sys
p, pin, lang = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(p))
d["lockCode"] = pin
d["lockOnIdle"] = True
d["language"] = lang if lang in ("zh", "en") else "en"
json.dump(d, open(p, "w"), indent=4, ensure_ascii=False)
PY
unset P1 P2

sudo touch /etc/edex-setup-done

echo
echo "  ✓ System initialized. eDEX will start now."
read -rp "  Press Enter to continue…" _ || true
exit 0
WIZARD
chmod +x /usr/local/sbin/edex-first-setup.sh

echo "[edex] done"
