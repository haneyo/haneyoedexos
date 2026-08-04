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
# look), then eDEX takes the whole screen.
export DISPLAY=:0
openbox --replace >/dev/null 2>&1 &
sleep 1
exec /opt/edex/eDEX-UI.AppImage --no-sandbox
SESH
chmod +x /usr/local/sbin/edex-session.sh

echo "[edex] openbox config (undecorated everywhere)"
mkdir -p /etc/xdg/openbox
cat > /etc/xdg/openbox/rc.xml <<'OPENBOX'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <!-- kiosk look: no title bars on anything -->
    <application class="*">
      <decor>no</decor>
    </application>
  </applications>
</openbox_config>
OPENBOX

echo "[edex] detecting installed user"
U="$(ls /home 2>/dev/null | head -1 || true)"
if [ -z "$U" ]; then
    echo "[edex] ERROR: no /home user found — did the interactive identity step run?"
    exit 1
fi

echo "[edex] NetworkManager as the network stack (WiFi via nmcli)"
cat > /etc/netplan/01-network-manager-all.yaml <<'NETPLAN'
network:
  version: 2
  renderer: NetworkManager
NETPLAN
systemctl enable NetworkManager.service 2>/dev/null || true

echo "[edex] lightdm autologin"
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-edex-autologin.conf <<CONF
[Seat:*]
autologin-user=$U
autologin-session=edex
user-session=edex
CONF

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
    "webapps": [
        { "name": "Google", "url": "https://www.google.com" },
        { "name": "Bing",   "url": "https://www.bing.com" }
    ]
}
SETTINGS
# fix the seeded cwd to the real home dir
sed -i "s|/home/edex|/home/$U|" "/home/$U/.config/eDEX-UI/settings.json"
chown -R "$U":"$U" "/home/$U/.config"

echo "[edex] done"
