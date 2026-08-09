#!/usr/bin/env bash
# eDEX-OS 一键诊断脚本 — 在实机上运行,收集所有排障所需信息。
#
#   bash ~/edex-diag.sh
#
# 生成单个报告文件 ~/edex-diag.txt(并在终端打印全文)。
# 把 edex-diag.txt 的内容(或终端全选复制)发给开发侧即可。
# 覆盖:电池、WiFi、输入法候选框、用户名/GECOS、开机 plymouth、应用环境。
# 设计成无需交互(passwordless sudo 用 -n 静默尝试),缺权限的项标记 SKIP。

set +e
set +u
OUT="$HOME/edex-diag.txt"
: > "$OUT"

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

echo "" | tee -a "$OUT"
echo "eDEX-OS diagnostic report — $(date -u +%FT%TZ)Z" | tee -a "$OUT"
echo "host: $(hostname)  user: $(id -un)" | tee -a "$OUT"

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

# ---------- WiFi ----------
hdr "WIFI"
r nmcli radio
r rfkill list
r nmcli dev status
r ip link
r nmcli dev wifi list
r ls -la /etc/netplan/
r ls -la /etc/NetworkManager/conf.d/
rp 'for f in /etc/NetworkManager/conf.d/*.conf; do echo "-- $f"; cat "$f"; done'
rp 'lspci -nnk | grep -iA3 "network\|ethernet\|wireless" || echo "(无网卡 pci 项)"'
rp 'sudo -n dmesg 2>&1 | grep -iE "iwlwifi|rtl88|rtl8|brcm|cfg80211|firmware|wifi" | tail -40 || true'
rp 'sudo -n journalctl -u NetworkManager -b --no-pager 2>&1 | grep -iE "wifi|wlan|error" | tail -25 || true'

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
if [ -f ~/.local/share/fcitx5/log/fcitx5.log ]; then
    echo "-- fcitx5.log tail 60" >>"$OUT"
    tail -60 ~/.local/share/fcitx5/log/fcitx5.log >>"$OUT"
fi
if [ -f ~/.cache/fcitx5/fcitx5.log ]; then
    echo "-- ~/.cache/fcitx5/fcitx5.log tail 60" >>"$OUT"
    tail -60 ~/.cache/fcitx5/fcitx5.log >>"$OUT"
fi

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
show = ["username","language","lockOnIdle","batteryAlways","clockFormat","timezone","tz","screenOffTimeout"]
out = []
for k in show:
    if k in d: out.append(f"{k}: {d[k]}")
for k in d:
    if k in ("lockCode","apiKey","claude","accessToken","secret"):
        out.append(f"{k}: <REDACTED (len={len(str(d[k]))})>")
print("\n".join(out) if out else "(no relevant keys)")
PY
else
    echo "(未找到 $EDEX_SETTINGS)" >>"$OUT"
    echo "搜索 settings.json..." >>"$OUT"
    find /home /etc /opt -maxdepth 5 -name settings.json 2>/dev/null >>"$OUT"
fi

# ---------- 开机画面 plymouth ----------
hdr "PLYMOUTH / BOOT THEME"
r plymouth-set-default-theme 2>&1
r ls -la /usr/share/plymouth/themes/
r ls -la /usr/share/plymouth/themes/edex/ 2>/dev/null
r grep -E 'CMDLINE_LINUX_DEFAULT|splash' /etc/default/grub
rp 'sudo -n lsinitramfs /boot/initrd.img-$(uname -r) 2>&1 | grep -iE "plymouth|edex|spinner" | head -20 || true'

# ---------- 结果复制回 U 盘(如果插着 EDIAG 盘) ----------
# eDEX-OS 无桌面文件管理器,可能不会自动挂载 U 盘;这里主动找 label=EDIAG 的盘,
# 没挂载就用 passwordless sudo 挂到 /mnt/ediag,把报告复制进去再卸载,方便直接拔。
hdr "USB COPY-BACK"
USB_LABEL="EDIAG"
# 1) 已在某处挂载?(按卷标,找不到再认 /mnt/ediag)
USB_MNT=$(findmnt -rn -o TARGET,LABEL -t vfat,fuseblk,exfat 2>/dev/null \
    | awk -v L="$USB_LABEL" '$2 == L { print $1; exit }')
if [ -z "$USB_MNT" ]; then
    if findmnt -rn -o TARGET /mnt/ediag >/dev/null 2>&1; then
        USB_MNT="/mnt/ediag"
    fi
fi
# 2) 未挂载 → 尝试用卷标路径挂载(带当前用户 uid/gid,FAT 才能直接写)
if [ -z "$USB_MNT" ] && [ -e "/dev/disk/by-label/$USB_LABEL" ]; then
    sudo -n mkdir -p /mnt/ediag 2>/dev/null
    if sudo -n mount -t vfat -o uid="$(id -u)",gid="$(id -g)" \
        "/dev/disk/by-label/$USB_LABEL" /mnt/ediag 2>/dev/null; then
        USB_MNT="/mnt/ediag"
    else
        echo "(U盘在,但 sudo mount 失败)" >>"$OUT"
    fi
fi
# 3) 卷标路径不可用 → 从 lsblk 找一个可移动分区挂上
if [ -z "$USB_MNT" ]; then
    REM_DEV=$(lsblk -rno NAME,TYPE,RM 2>/dev/null \
        | awk '$2=="part" && $3==1 { print $1; exit }')
    if [ -n "$REM_DEV" ]; then
        sudo -n mkdir -p /mnt/ediag 2>/dev/null
        if sudo -n mount "/dev/$REM_DEV" /mnt/ediag 2>/dev/null; then
            USB_MNT="/mnt/ediag"
        fi
    fi
fi
if [ -n "$USB_MNT" ]; then
    # 手动 sudo mount 挂的 FAT 属主是 root,直接 cp 会失败,用 sudo cp 兜底
    if cp "$OUT" "$USB_MNT/edex-diag.txt" 2>/dev/null || sudo -n cp "$OUT" "$USB_MNT/edex-diag.txt" 2>/dev/null; then
        echo "已复制到U盘: $USB_MNT/edex-diag.txt" | tee -a "$OUT"
        sync
        if [ "$USB_MNT" = "/mnt/ediag" ]; then
            # 若脚本自己在U盘上跑(没先 cp 到 home),卸载会导致后续几行读取失败,
            # 因此判断 $0 不在挂载点下才卸载。
            case "$0" in
                "$USB_MNT"/*|"$USB_MNT" )
                    echo "(脚本正从U盘运行,不自动卸载 —— 稍后手动 umount /mnt/ediag)" | tee -a "$OUT"
                    ;;
                *)
                    sudo -n umount /mnt/ediag 2>/dev/null && echo "(已安全卸载,可拔U盘)" | tee -a "$OUT"
                    ;;
            esac
        fi
    else
        echo "(U盘不可写 —— 报告仍保存在 $OUT)" >>"$OUT"
    fi
else
    echo "(未找到 EDIAG U盘 —— 报告仍保存在 $OUT)" >>"$OUT"
fi

# ---------- 结束 ----------
echo "" | tee -a "$OUT"
echo "===== DONE =====" | tee -a "$OUT"
echo "报告已保存到: $OUT" | tee -a "$OUT"
echo "把这整个文件的内容发给开发侧即可。(或终端全选复制)" | tee -a "$OUT"
echo "" | tee -a "$OUT"
echo "========== 报告全文开始 ==========" | tee -a "$OUT"
cat "$OUT"
echo "========== 报告全文结束 ==========" | tee -a "$OUT"
echo "($(wc -l < "$OUT") 行)"
