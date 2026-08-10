#!/usr/bin/env bash
# eDEX-OS 一键诊断脚本 — 放到 U 盘,在真机文件浏览器里点击运行。
#
# 用法:
#   1) 把本文件拷到 U 盘根目录(保持文件名 edex-diag.sh)
#   2) 插到真机 → 文件浏览器进入 U 盘 → 点击 edex-diag.sh → RUN(确认框)
#      脚本会用 bash 在终端里跑完,输出直接可见
#   3) 跑完把 U 盘拔回 Mac → 读 U 盘根目录的 edex-diag.txt 即可
#
# 报告位置:U 盘同目录 edex-diag.txt(首选)+ $HOME/edex-diag.txt(备份)
# 覆盖:WiFi / 电池 / 输入法候选框 / 用户名 / plymouth / clash+更新 / 7z / XDG / 时间 / 磁盘 / 应用设置(脱敏)
# 设计为无需交互(passwordless sudo 用 -n 静默尝试),缺权限的项标记 SKIP。
# FAT/exFAT 盘上没有 exec 位也没关系——文件浏览器对 .sh 一律按可运行处理。

set +e
set +u

# ---------- 定位输出目录:报告写在脚本所在目录(通常是 U 盘) ----------
SCRIPT="$0"
case "$SCRIPT" in
    /*) ;;
    *) SCRIPT="$(pwd)/$SCRIPT" ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT")" 2>/dev/null && pwd || echo "$HOME")"
OUT="$SCRIPT_DIR/edex-diag.txt"
: > "$OUT"
chmod 666 "$OUT" 2>/dev/null

# hdr: 打印章节标题到屏幕 + 追加到报告
hdr() {
    echo "" | tee -a "$OUT"
    echo "===== $1 =====" | tee -a "$OUT"
}
# r: 简单命令,记录 "命令" + 输出到报告
r() {
    echo "\$ $*" >>"$OUT"
    "$@" >>"$OUT" 2>&1
    echo >>"$OUT"
}
# sr: 需要 sudo 的命令(-n 非交互,失败标记 SKIP)
sr() {
    echo "\$ sudo $*" >>"$OUT"
    sudo -n "$@" >>"$OUT" 2>&1 || echo "(SKIP: 需要权限,未能执行)" >>"$OUT"
    echo >>"$OUT"
}
# rp: 带管道/换行的整段命令,作为字符串执行
rp() {
    echo "\$ $1" >>"$OUT"
    bash -c "$1" >>"$OUT" 2>&1
    echo >>"$OUT"
}
# rt: 带超时的命令(防真机上某命令卡死拖住整个诊断)
rt() { # rt <seconds> <cmd...>
    local sec="$1"; shift
    echo "\$ timeout $sec $*" >>"$OUT"
    timeout "$sec" "$@" >>"$OUT" 2>&1 || echo "(超时/退出码 $?)" >>"$OUT"
    echo >>"$OUT"
}

echo "" | tee -a "$OUT"
echo "eDEX-OS diagnostic report — $(date -u +%FT%TZ)Z" | tee -a "$OUT"
echo "host: $(hostname)  user: $(id -un)  report: $OUT" | tee -a "$OUT"

# ---------- 基础 ----------
hdr "SYSTEM"
r uname -a
r cat /etc/os-release
r uptime
r df -h /
r timedatectl

# ---------- 应用进程与环境 ----------
hdr "APP PROCESS + ENV"
rp 'ps aux | grep -iE "edex|electron|fcitx|lightdm|openbox" | grep -v grep | grep -v edex-diag'
echo "(eDEX 主进程的输入法/显示环境变量:)" >>"$OUT"
APPPID=$(pgrep -f 'eDEX-UI' | head -1)
if [ -n "$APPPID" ]; then
    echo "pid=$APPPID" >>"$OUT"
    tr '\0' '\n' < "/proc/$APPPID/environ" 2>/dev/null \
        | grep -iE '^(GTK_IM_MODULE|QT_IM_MODULE|XMODIFIERS|DISPLAY|XDG_SESSION_TYPE|LANG|LC_)=' >>"$OUT"
else
    echo "(未找到 eDEX-UI 进程 —— 应用没在跑?)" >>"$OUT"
fi
echo "(edex-session.sh 里与输入法/显示相关的行:)" >>"$OUT"
for f in /usr/local/bin/edex-session.sh /usr/local/bin/eDEX-session.sh /home/*/.config/autostart/*.desktop; do
    [ -f "$f" ] && { echo "-- $f --" >>"$OUT"; grep -iE 'IM_MODULE|fcitx|DISPLAY|export|exec' "$f" >>"$OUT"; }
done

# ---------- WiFi(重点) ----------
hdr "WIFI"
r nmcli radio
r rfkill list
r nmcli dev status
r ip link
r nmcli dev wifi list
# wpa_supplicant 是 WiFi 的命门:缺包/起不来 → 设备停 "unavailable"、扫描为空。
# 真机日志每 13s 一条 "Failed to D-Bus activate wpa_supplicant service" 就是它
# (之前只 dump 网卡/驱动,从没查过 wpa_supplicant,导致连不上 WiFi 一直没定位)。
echo "(wpa_supplicant 状态 —— WiFi 起不来的常见命门:)" >>"$OUT"
rp 'echo "二进制: $(command -v wpa_supplicant 2>/dev/null || echo 缺失)"; ls -la /usr/sbin/wpa_supplicant 2>&1 | tail -1 || true'
rp 'dpkg -l wpasupplicant 2>&1 | tail -2 || echo "(未安装 wpasupplicant 包)"'
rp 'ls -la /usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service 2>&1 || echo "(缺少 D-Bus 激活文件 fi.w1.wpa_supplicant1.service)"'
rp 'pgrep -a wpa_supplicant 2>&1 || echo "(wpa_supplicant 未在运行)"'
rp 'sudo -n journalctl -u NetworkManager -b --no-pager 2>&1 | grep -iE "supplicant|Failed to D-Bus activate" | tail -6 || true'
echo "(无线接口是否存在于 /sys/class/net:)" >>"$OUT"
ls -la /sys/class/net/ >>"$OUT" 2>&1
echo >>"$OUT"
r ls -la /etc/netplan/
r ls -la /etc/NetworkManager/conf.d/
rp 'for f in /etc/NetworkManager/conf.d/*.conf; do echo "-- $f"; cat "$f"; done'
rp 'lspci -nnk | grep -iA3 "network\|ethernet\|wireless" || echo "(无网卡 pci 项)"'
rp 'lsmod | grep -iE "iwlwifi|rtw88|rtl8|brcm" || echo "(未加载无线内核模块)"'
rp 'sudo -n dmesg 2>&1 | grep -iE "iwlwifi|rtw88|rtl8|cfg80211|firmware|wifi" | tail -40 || true'
rp 'sudo -n journalctl -u NetworkManager -b --no-pager 2>&1 | grep -iE "wifi|wlan|error" | tail -25 || true'
echo "(无线固件文件是否存在:)" >>"$OUT"
ls /lib/firmware/iwlwifi-* /lib/firmware/rtw88/* 2>/dev/null | head -20 >>"$OUT"
echo >>"$OUT"
echo "(关键包版本:)" >>"$OUT"
dpkg -l linux-firmware network-manager wpasupplicant rfkill iw 2>/dev/null | grep -E '^ii' >>"$OUT"
echo >>"$OUT"

# ---------- 电池 ----------
hdr "BATTERY"
r ls -la /sys/class/power_supply/
for d in /sys/class/power_supply/*/; do
    echo "== $d" >>"$OUT"
    for f in type capacity status energy_now energy_full voltage_now current_now; do
        [ -r "$d/$f" ] && echo "  $f: $(cat "$d/$f")" >>"$OUT"
    done
done
echo >>"$OUT"
rp 'dpkg -l | grep -i upower || echo "(upower 未安装)"'
if command -v upower >/dev/null 2>&1; then
    r upower -d
else
    echo "(upower 未安装)" >>"$OUT"
fi

# ---------- 输入法候选框 ----------
hdr "IME (fcitx5)"
rp 'ps aux | grep -i fcitx | grep -v grep | grep -v edex-diag || echo "(无 fcitx 进程)"'
echo "shell env: GTK_IM_MODULE=$GTK_IM_MODULE QT_IM_MODULE=$QT_IM_MODULE XMODIFIERS=$XMODIFIERS" >>"$OUT"
r cat ~/.config/fcitx5/profile
r ls -la ~/.config/fcitx5/conf/
for f in ~/.config/fcitx5/conf/classicui.conf ~/.config/fcitx5/conf/fcitx5.conf; do
    [ -f "$f" ] && { echo "-- $f" >>"$OUT"; cat "$f" >>"$OUT"; echo >>"$OUT"; }
done
rp 'fc-list | grep -iE "cjk|noto sans cjk" | head -5 || echo "(无 CJK 字体)"'
if command -v fcitx5-diagnose >/dev/null 2>&1; then
    fcitx5-diagnose 2>&1 | head -90 >>"$OUT"
else
    echo "(fcitx5-diagnose 不存在)" >>"$OUT"
fi
for logf in ~/.local/share/fcitx5/log/fcitx5.log ~/.cache/fcitx5/fcitx5.log; do
    if [ -f "$logf" ]; then
        echo "-- $logf tail 60" >>"$OUT"
        tail -60 "$logf" >>"$OUT"
    fi
done
echo "(手动测试提示:切到「中」打字,候选窗应为黑底青色,见 ubuntu-side-changes.md §3)" >>"$OUT"

# ---------- clash / 代理(#46 Phase C 预检) ----------
hdr "CLASH / PROXY"
echo "(mihomo 版本:)" >>"$OUT"
rt 8 mihomo -v || echo "(mihomo 未安装/不可执行)" >>"$OUT"
echo >>"$OUT"
echo "(ISO 烘焙位置:)" >>"$OUT"
ls -la /opt/edex/mihomo/ 2>/dev/null >>"$OUT" || echo "(无 /opt/edex/mihomo)" >>"$OUT"
echo >>"$OUT"
echo "(mihomo 进程/端口:)" >>"$OUT"
pgrep -a mihomo 2>/dev/null >>"$OUT" || echo "(无 mihomo 进程)" >>"$OUT"
ss -tlnp 2>/dev/null | grep -E ':7890|:9090' >>"$OUT" || echo "(7890/9090 未监听)" >>"$OUT"
echo >>"$OUT"
echo "(配置目录:)" >>"$OUT"
ls -la ~/.config/edex-proxy/ 2>/dev/null >>"$OUT" || echo "(无 ~/.config/edex-proxy)" >>"$OUT"
echo >>"$OUT"
echo "(当前活动连接 + 代理设置:)" >>"$OUT"
nmcli -t -f NAME,DEVICE,STATE con show --active 2>/dev/null >>"$OUT" || true
nmcli con show --active 2>/dev/null | grep -iE 'proxy|ipv4|connection.id' >>"$OUT" || true
echo >>"$OUT"
echo "(GSettings 系统代理(Chromium 走这里):)" >>"$OUT"
for k in mode host port ignore-hosts; do
    echo "  org.gnome.system.proxy.$k = $(gsettings get org.gnome.system.proxy "$k" 2>/dev/null)" >>"$OUT"
done
echo >>"$OUT"

# ---------- 内置程序更新 / 版本(#47) ----------
hdr "BUNDLED UPDATES"
echo "(Firefox:)" >>"$OUT"
if [ -f /opt/firefox/browser/application.ini ]; then
    grep -E '^Version=' /opt/firefox/browser/application.ini >>"$OUT"
else
    echo "(无 /opt/firefox/browser/application.ini)" >>"$OUT"
fi
echo "(Claude CLI:)" >>"$OUT"
rt 8 claude --version >>"$OUT" 2>&1 || echo "(claude 不可用)" >>"$OUT"
echo "(上次 apt 列表刷新(/var/lib/apt/lists mtime):)" >>"$OUT"
stat -c '%y  %n' /var/lib/apt/lists 2>/dev/null >>"$OUT" || echo "(无 /var/lib/apt/lists)" >>"$OUT"
echo "(eDEX 版本字段(src/package.json 打包进去的):)" >>"$OUT"
cat /opt/edex/resources/app/package.json 2>/dev/null | grep '"version"' >>"$OUT" || echo "(读不到打包的 package.json)" >>"$OUT"

# ---------- 7z / XDG / 时间 / 磁盘(#48 #7 #14 #145) ----------
hdr "MISC VERIFY (7z / XDG / DISKS)"
echo "(7z:)" >>"$OUT"
rt 8 7z i 2>/dev/null | grep -E '7-Zip|p7zip Version' >>"$OUT" || echo "(7z 不可用)" >>"$OUT"
echo "(XDG 用户目录:)" >>"$OUT"
for d in ~/Desktop ~/Downloads ~/Documents ~/Music ~/Pictures ~/Videos ~/Templates ~/Public ~/Applications; do
    [ -d "$d" ] && echo "  OK  $d" >>"$OUT" || echo "  MISS $d" >>"$OUT"
done
echo "(磁盘/分区(#145 Show disks 相关):)" >>"$OUT"
lsblk -o NAME,SIZE,TYPE,FSTYPE,LABEL,MOUNTPOINT 2>/dev/null >>"$OUT" || echo "(lsblk 不可用)" >>"$OUT"
rp 'udisksctl status 2>&1 | head -20 || true'

# ---------- 用户名 / GECOS ----------
hdr "USERNAME / GECOS"
r id
r getent passwd edex
r getent passwd "$(id -un)"

# ---------- 应用设置(脱敏) ----------
hdr "SETTINGS (redacted)"
EDEX_SETTINGS="$HOME/.config/eDEX-UI/settings.json"
if [ -f "$EDEX_SETTINGS" ]; then
    SETTINGS_PATH="$EDEX_SETTINGS" python3 - >>"$OUT" <<'PY'
import json, os, sys
p = os.environ["SETTINGS_PATH"]
try:
    d = json.load(open(p))
except Exception as e:
    print("settings.json unreadable:", e); sys.exit(0)
show = ["username","language","lockOnIdle","batteryAlways","clockFormat","timezone","tz","screenOffTimeout","lockCodeSet"]
out = []
for k in show:
    if k == "lockCodeSet": out.append(f"lockCodeSet: {bool(d.get('lockCode'))}")
    elif k in d: out.append(f"{k}: {d[k]}")
for k in d:
    if k in ("lockCode","apiKey","claude","accessToken","secret"):
        out.append(f"{k}: <REDACTED (len={len(str(d[k]))})>")
if "clash" in d and isinstance(d.get("clash"), dict):
    c = d["clash"]
    out.append(f"clash.enabled: {c.get('enabled')}  port: {c.get('port')}  subUrl: {'set' if c.get('subUrl') else '(empty)'}")
if "updates" in d and isinstance(d.get("updates"), dict):
    u = d["updates"]
    out.append(f"updates.lastSystemUpdate: {u.get('lastSystemUpdate')}")
print("\n".join(out) if out else "(no relevant keys)")
PY
else
    echo "(未找到 $EDEX_SETTINGS)" >>"$OUT"
    echo "搜索 settings.json..." >>"$OUT"
    find /home /etc /opt -maxdepth 5 -name settings.json 2>/dev/null >>"$OUT"
fi

# ---------- 开机画面 plymouth ----------
# 普通用户的 PATH 没有 /usr/sbin,所以按绝对路径探测 + dpkg 查包,区分
# "包没装" 和 "只是不在 PATH"(旧的 "command not found" 是后者,是假象)。
hdr "PLYMOUTH / BOOT THEME"
echo "\$ echo PATH" >>"$OUT"; echo "$PATH" >>"$OUT"; echo >>"$OUT"
r ls -la /usr/sbin/plymouthd /usr/sbin/plymouth-set-default-theme 2>&1
rp 'dpkg -s plymouth 2>/dev/null | grep -E "^(Package|Status|Version)" || echo "(plymouth 包未安装)"'
r /usr/sbin/plymouth-set-default-theme 2>&1
r ls -la /usr/share/plymouth/themes/
r ls -la /usr/share/plymouth/themes/edex/ 2>/dev/null
r grep -E 'CMDLINE_LINUX_DEFAULT|splash' /etc/default/grub
# 主题状态三个来源全转储:plymouthd.conf / plymouthd.defaults / default.plymouth 链接。
# 之前只 ls 主题目录,看不出 initramfs hook 到底选了谁 —— 真机缺
# plymouth-set-default-theme 时它回退读链接,链接还指向 spinner 就白搭。
r cat /etc/plymouth/plymouthd.conf 2>/dev/null || echo "(无 /etc/plymouth/plymouthd.conf)"
r cat /usr/share/plymouth/plymouthd.defaults 2>/dev/null || echo "(无 /usr/share/plymouth/plymouthd.defaults)"
rp 'readlink -f /usr/share/plymouth/themes/default.plymouth 2>&1; ls -la /etc/alternatives/default.plymouth 2>&1'
# 完整(不 head)列出 initramfs 里实际烤的 plymouth 主题文件,按目录数数量。
rp 'sudo -n lsinitramfs /boot/initrd.img-$(uname -r) 2>&1 | grep -E "plymouth|edex|spinner" || echo "(initramfs 内无 plymouth 主题文件)"'
rp 'echo "initramfs 内 edex 主题文件数: $(sudo -n lsinitramfs /boot/initrd.img-$(uname -r) 2>/dev/null | grep -c "themes/edex" || echo 0)"; echo "initramfs 内 spinner 主题文件数: $(sudo -n lsinitramfs /boot/initrd.img-$(uname -r) 2>/dev/null | grep -c "themes/spinner" || echo 0)"'
# BGRT:有固件 logo 时 two-step 用固件图(读不到 plymouth 主题的 fallback),没 BGRT 才用 bgrt-fallback.png。
rp 'ls /sys/firmware/acpi/bgrt/ 2>&1 || echo "(无 BGRT:开机会用主题的 bgrt-fallback.png = eDEX logo)"'
# initramfs hook 的主题判定逻辑源码(决定 hook 读 plymouthd.defaults 还是 default.plymouth 链接)。
rp 'grep -nE "set-default-theme|plymouthd.defaults|default.plymouth|THEME" /usr/share/initramfs-tools/hooks/plymouth 2>/dev/null | head -20 || echo "(hook 文件不存在)"'

# ---------- 输入/触摸板(#163:解锁后光标消失/点不到东西) ----------
# 区分"应用层面被 overlay 吞了点击" vs "内核/驱动层面触摸板失效"。
hdr "INPUT / TOUCHPAD"
r xinput list 2>&1
r cat /proc/bus/input/devices 2>&1
r lsmod | grep -iE 'psmouse|synaptics|elantech|alps|trackpoint|i2c' 2>&1 || echo "(无触摸板相关内核模块)"
rp 'sudo -n dmesg 2>&1 | grep -iE "psmouse|synaptics|elantech|trackpoint|touchpad|serio" | tail -30 || true'
rp 'libinput list-devices 2>&1 | grep -E "Device:|kernel:|libinput Input Class|Capabilities|Product" || true'
rp 'timeout 3 libinput debug-events --show-keycodes 2>&1 | head -30 || true'
echo "(上面 3 秒 libinput 事件捕获:空白 = 触摸板/按键无事件)" | tee -a "$OUT"

# ---------- 报告是否在 U 盘上:不在则尝试拷到可移动盘 ----------
# 报告已写在脚本同目录(插 U 盘跑 → 已在 U 盘上)。只有从 home 跑时才尝试
# 再拷一份到 EDIAG 卷标 / 任意可移动分区,方便拔回。
hdr "REPORT PLACEMENT"
OUT_DEV=$(df -P "$OUT" 2>/dev/null | awk 'NR==2 {print $1}')
IS_RM=""
if [ -n "$OUT_DEV" ]; then
    IS_RM=$(lsblk -rno RM "$OUT_DEV" 2>/dev/null | head -1)
fi
if [ "$IS_RM" = "1" ]; then
    echo "报告已直接写在可移动设备上: $OUT" | tee -a "$OUT"
    echo "拔 U 盘回 Mac 即可读取。" | tee -a "$OUT"
else
    cp "$OUT" "$HOME/edex-diag.txt" 2>/dev/null
    echo "报告写在了 $OUT (非可移动盘)" | tee -a "$OUT"
    echo "尝试复制到可移动盘 ..." | tee -a "$OUT"
    USB_MNT=$(findmnt -rn -o TARGET,LABEL -t vfat,fuseblk,exfat 2>/dev/null \
        | awk -v L=EDIAG '$2 == L { print $1; exit }')
    if [ -z "$USB_MNT" ] && findmnt -rn -o TARGET /mnt/ediag >/dev/null 2>&1; then
        USB_MNT="/mnt/ediag"
    fi
    if [ -z "$USB_MNT" ] && [ -e "/dev/disk/by-label/EDIAG" ]; then
        sudo -n mkdir -p /mnt/ediag 2>/dev/null
        if sudo -n mount -t vfat -o uid="$(id -u)",gid="$(id -g)" \
            "/dev/disk/by-label/EDIAG" /mnt/ediag 2>/dev/null; then
            USB_MNT="/mnt/ediag"
        fi
    fi
    if [ -z "$USB_MNT" ]; then
        REM_DEV=$(lsblk -rno NAME,TYPE,RM 2>/dev/null | awk '$2=="part" && $3==1 { print $1; exit }')
        if [ -n "$REM_DEV" ]; then
            sudo -n mkdir -p /mnt/ediag 2>/dev/null
            if sudo -n mount "/dev/$REM_DEV" /mnt/ediag 2>/dev/null; then
                USB_MNT="/mnt/ediag"
            fi
        fi
    fi
    if [ -n "$USB_MNT" ]; then
        if cp "$OUT" "$USB_MNT/edex-diag.txt" 2>/dev/null || sudo -n cp "$OUT" "$USB_MNT/edex-diag.txt" 2>/dev/null; then
            echo "已复制到U盘: $USB_MNT/edex-diag.txt" | tee -a "$OUT"
            sync
            [ "$USB_MNT" = "/mnt/ediag" ] && { case "$0" in "$USB_MNT"/*) ;; *) sudo -n umount /mnt/ediag 2>/dev/null && echo "(已卸载,可拔U盘)" | tee -a "$OUT" ;; esac; }
        else
            echo "(U盘不可写 —— 报告仍在 $OUT)" >>"$OUT"
        fi
    else
        echo "(未找到可移动盘 —— 报告仍在 $OUT)" | tee -a "$OUT"
    fi
fi

# ---------- 结束 ----------
echo "" | tee -a "$OUT"
echo "===== DONE =====" | tee -a "$OUT"
echo "报告已保存到: $OUT" | tee -a "$OUT"
echo "把 U 盘插回 Mac,读上面的 edex-diag.txt 发给开发侧即可。" | tee -a "$OUT"
echo "" | tee -a "$OUT"
echo "========== 报告全文开始 ==========" | tee -a "$OUT"
cat "$OUT"
echo "========== 报告全文结束 ==========" | tee -a "$OUT"
echo "($(wc -l < "$OUT") 行)"
