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
# IMPORTANT: install-edex.sh embeds a byte-identical copy of this script as the
# single late-command deliverable — keep the two in sync when editing this file.
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

# lightdm autologin. The 'z' prefix should sort AFTER the lightdm-autologin-greeter
# package's own lightdm-autologin-greeter.conf, which ships a placeholder
# autologin-user=AUTOLOGIN-USER-NOT-CONFIGURED — normally later conf.d files win,
# so OUR value overrides the placeholder and the system boots to eDEX instead of
# a text console. BUT that merge order is not guaranteed (seen live on a v2.4.25
# laptop: the placeholder won, and a lightdm restart after an eDEX exit looped
# "Can't authenticate autologin; autologin not configured" -> black screen), so we
# ALSO overwrite the package's file with OUR values below. The greeter is pinned
# explicitly (default would be lightdm-gtk-greeter, which is NOT installed).
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
cp /etc/lightdm/lightdm.conf.d/zz-edex-autologin.conf \
   /etc/lightdm/lightdm.conf.d/lightdm-autologin-greeter.conf

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
        "provider": "local",
        "baseUrl": "http://127.0.0.1:8080",
        "apiKey": "local",
        "model": "qwen2.5-0.5b-instruct-q4_k_m",
        "haikuModel": "qwen2.5-0.5b-instruct-q4_k_m"
    },
    "voiceMicMode": "input",
    "webapps": []
}
SETTINGS
# fix the seeded cwd to the real home dir
sed -i "s|/home/edex|/home/$U|" "/home/$U/.config/eDEX-UI/settings.json" || true
chown -R "$U":"$U" "/home/$U/.config" || echo "[edex-firstboot] WARN: chown ~/.config failed"

# #169 SSH 公钥固化:把 claude-remote@mac 这把钥匙烧进真实用户的 authorized_keys,
# 每次重刷 ISO 后免重新手动添加公钥。幂等:已存在则跳过;只放公钥(可登录、不含
# 私钥),配合 NOPASSWD sudo 让 Mac 可免密直连。
mkdir -p "/home/$U/.ssh" && chmod 700 "/home/$U/.ssh"
touch "/home/$U/.ssh/authorized_keys"
if ! grep -q "claude-remote@mac" "/home/$U/.ssh/authorized_keys" 2>/dev/null; then
    echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE4DLsWgvK9viHDyZb9nYGahgsk4L3YOTiDs4GQMu3GM claude-remote@mac" >> "/home/$U/.ssh/authorized_keys"
fi
chmod 600 "/home/$U/.ssh/authorized_keys"
chown -R "$U":"$U" "/home/$U/.ssh" || echo "[edex-firstboot] WARN: chown ~/.ssh failed"

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
