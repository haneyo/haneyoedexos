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
# Turn on the keyboard backlight: many ThinkPads boot with it off.
if [ -d /sys/class/leds/tpacpi::kbd_backlight ]; then
    echo 2 > /sys/class/leds/tpacpi::kbd_backlight/brightness 2>/dev/null || true
fi
# Black the X root window + use the dark DMZ-Black cursor theme for the gap
# between the lightdm greeter closing and the eDEX window mapping — this is the
# "white flash with the default arrow" seen on real hardware at boot. Once eDEX
# is up it paints its own sci-fi image cursor over the whole screen, so the OS
# cursor only ever shows during this handoff and should be dark + minimal.
xsetroot -solid black 2>/dev/null || true
export XCURSOR_THEME=DMZ-Black
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

# Default X cursor theme (system-wide): DMZ-Black, so the lightdm greeter and any
# native window show a dark pointer that matches the eDEX palette instead of the
# stock white/black arrow. The dark root window + XCURSOR_THEME in
# edex-session.sh cover the per-session case; this covers the greeter too.
if [ -e /usr/share/icons/DMZ-Black/cursor.theme ]; then
    update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme \
        /usr/share/icons/DMZ-Black/cursor.theme 100 2>/dev/null || true
    update-alternatives --set x-cursor-theme DMZ-Black 2>/dev/null || true
else
    echo "[edex] WARN: DMZ-Black cursor theme missing — 'xcursor-themes' must be in build-iso.sh APTOPTS"
fi

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
    # passwordless sudo); the in-app first-run setup (classes/firstRun.class.js)
    # lets the user set the unlock PIN on the first boot.
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

echo "[edex] fcitx5 profile: keyboard-us + pinyin + Rime, default US (input method #16)"
# fcitx5 is launched and the IM env is set (edex-session.sh), but without a
# profile the engine list is EMPTY — so Ctrl+Space has nothing to switch to and
# the system is stuck on "EN" no matter what. Writing the profile gives fcitx5
# three input methods: keyboard-us (English, the default), pinyin (libime —
# instant candidates, no schema compile) and rime (小狼毫, builds its schemas
# on first activation). pinyin comes FIRST so the EN/中 toggle lands on a
# candidate window that works out of the box; rime stays available for users
# who want it. Rime initializes ~/.config/fcitx5/rime on first activation.
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
mkdir -p "/home/$U/.config/fcitx5/conf"
cat > "/home/$U/.config/fcitx5/conf/classicui.conf" <<'CUI'
[Appearance]
Font="Noto Sans CJK SC 12"
PerScreenDPI=False
CUI
chown -R "$U":"$U" "/home/$U/.config/fcitx5" 2>/dev/null || true
# seed /etc/skel so any account created later gets the same IM list + UI config
mkdir -p /etc/skel/.config/fcitx5
cp -r "/home/$U/.config/fcitx5/profile" "/home/$U/.config/fcitx5/conf" /etc/skel/.config/fcitx5/
# Best-effort: pre-deploy Rime so the first switch to 中 doesn't stall on the
# schema build — a stalled/failed deploy degrades Rime to latin pass-through
# with no candidate window. pinyin above is the reliable default; this only
# makes Rime usable immediately. Never fail the install over it.
if command -v rime_deployer >/dev/null 2>&1; then
    HOME="/home/$U" rime_deployer --build >/dev/null 2>&1 || true
fi

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
# plymouth + the spinner theme are BAKED into the squashfs (build-iso.sh APTOPTS);
# this block is what makes plymouth actually RUN on a fresh install: GRUB does not
# pass "splash" unless /etc/default/grub says so, and the initramfs must embed the
# plymouth modules. update-initramfs and update-grub are chroot/mount dependent,
# which is exactly why this lives here (curtin in-target) and not on the macOS
# build side.
cat > /etc/default/grub <<'GRUB'
GRUB_DEFAULT=0
GRUB_TIMEOUT=2
GRUB_DISTRIBUTOR=`lsb_release -i -s 2>/dev/null || echo Debian`
# pcie_aspm=off: PCIe Active State Power Management is the single most common
# cause of flaky built-in WiFi on laptops (RTL8821CE/8822CE flood the log with
# "PCIe Bus Error: Correctable Physical Layer" and never scan; some Broadcom and
# Intel cards drop off the bus entirely). Disabling it costs a little idle power
# but makes WiFi across arbitrary hardware far more reliable.
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash pcie_aspm=off"
GRUB_CMDLINE_LINUX=""
# Dark sci-fi GRUB menu: keep the reliable VGA text console (works on every GPU)
# but restyle it — black background, white normal text, cyan highlight — instead
# of the stock Ubuntu purple that made the boot screen ugly. The `error: file
# '/boot/' not found` line that flashes above the menu is UNRELATED to this file:
# it comes from the signed grubx64.efi's embedded config and is cosmetic (#11).
GRUB_TERMINAL_OUTPUT="console"
GRUB_COLOR_NORMAL="white/black"
GRUB_COLOR_HIGHLIGHT="cyan/black"
GRUB_DISABLE_OS_PROBER=true
GRUB
# spinner is a text-category theme (always works, no GPU/framebuffer requirement)
# while still showing a boot animation; details would be plain scrolling text.
if command -v plymouthd >/dev/null 2>&1; then
    plymouth-set-default-theme spinner 2>/dev/null || true
else
    echo "[edex] WARN: plymouthd missing — 'plymouth plymouth-theme-spinner' must be in build-iso.sh APTOPTS"
fi
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

# The one-time first-boot setup (interface language → timezone → unlock PIN)
# used to be a bash wizard launched in an xterm here. It now runs INSIDE the
# app: the seeded settings.json has no lockCode, so classes/firstRun.class.js
# shows a code-lock-style setup screen on the first launch and writes the PIN
# (lockCode / lockOnIdle / language) into this settings.json itself. Root
# password no longer exists — Ubuntu's install already set the user password.

echo "[edex] done"
