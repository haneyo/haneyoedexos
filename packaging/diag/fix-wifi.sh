#!/usr/bin/env bash
# eDEX-OS WiFi 修复脚本 — 放到 U 盘,在真机上从文件浏览器点击运行。
#
# 自带诊断:每个关键步骤 + 修复前后的状态都会写进同目录(U 盘根目录)的
#   fix-wifi-result.txt —— 成与不成,拔回 Mac 读这个 txt 就行。
#
# 背景(真机诊断 2026-08-10):
#   NetworkManager 每 13 秒报
#     device (wlp5s0): Couldn't initialize supplicant interface:
#     Failed to D-Bus activate wpa_supplicant service
#   导致 wlp5s0 停在 "unavailable",nmcli dev wifi list 空白 —— 连不上 WiFi。
#   驱动/固件都正常(RTL8821CE, 固件 24.11.0 已加载),卡在 wpa_supplicant
#   起不来。最常见原因:wpasupplicant 包没装上(NetworkManager 对它只是
#   Recommends 而非 Depends,缺了也不报安装错误)。
#
# 用法:
#   1) 把本文件拷到 U 盘根目录
#   2) 插到真机 → 文件浏览器进入 U 盘 → 点击 fix-wifi.sh → RUN(确认框)
#   3) 跑完看同目录 fix-wifi-result.txt:
#        - 若 apt 装不上(机器没联网),给真机临时插一根网线再重跑本脚本
#        - 若修复后扫描出网络了,去 eDEX 设置 → 网络 里连接 WiFi
#
# 需要:root 权限(sudo)。passwordless sudo 直接跑;否则会停在密码提示。
# 幂等:跑多次无副作用。

set -e
set -u
set -o pipefail

# ---------- 定位脚本目录 + 报告文件(脚本同目录,U 盘) ----------
SCRIPT="$0"
case "$SCRIPT" in
    /*) ;;
    *) SCRIPT="$(pwd)/$SCRIPT" ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT")" 2>/dev/null && pwd || echo "$HOME")"
OUT="$SCRIPT_DIR/fix-wifi-result.txt"
: > "$OUT"
chmod 666 "$OUT" 2>/dev/null

# ---------- 输出:屏幕 + 报告双写 ----------
log() { echo "$*" | tee -a "$OUT"; }

# ---------- 提权 ----------
# run:    执行,输出只在屏幕(用于条件判断 / 输出要被命令替换吃掉的场景)
# runlog: 执行,stdout 同时写进报告(用于诊断 dump / 重启命令)
run() {
    if [ "$(id -u)" = "0" ]; then
        "$@"
    else
        sudo "$@"
    fi
}
runlog() {
    if [ "$(id -u)" = "0" ]; then
        "$@" 2>&1 | tee -a "$OUT"
    else
        sudo "$@" 2>&1 | tee -a "$OUT"
    fi
}

trap 'log ""; log "!! 脚本在中途失败(第 $LINENO 行)。报告已保存: $OUT —— 请把整个文件发回。"' ERR

log "==== eDEX WiFi 修复 ===="
log "时间: $(date '+%Y-%m-%d %H:%M:%S')"
log "报告: $OUT"
log ""

# ===== 修复前状态 =====
log "===== 修复前状态 ====="
log "网卡状态:"
runlog bash -c 'nmcli dev status 2>&1'
log "无线扫描(空 = wpa_supplicant 起不来):"
runlog bash -c 'nmcli -t dev wifi list 2>&1 | head -10 || true'
log "wpa_supplicant 二进制:"
runlog bash -c 'ls -la /usr/sbin/wpa_supplicant 2>&1 || echo "(缺失 /usr/sbin/wpa_supplicant)"'
log "wpasupplicant 包:"
runlog bash -c 'dpkg -l wpasupplicant 2>&1 | tail -2 || echo "(未安装 wpasupplicant 包)"'
log "D-Bus 激活文件:"
runlog bash -c 'ls -la /usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service 2>&1 || echo "(缺少 D-Bus 激活文件 fi.w1.wpa_supplicant1.service —— 包没装/被清理就会这样)"'
log "wpa_supplicant 服务状态:"
runlog bash -c 'systemctl status wpa_supplicant --no-pager -l 2>&1 | head -15 || echo "(无 wpa_supplicant 服务)"'
log "NetworkManager 最近 supplicant 报错:"
runlog bash -c 'journalctl -u NetworkManager -b --no-pager 2>&1 | grep -iE "supplicant|Failed to D-Bus activate" | tail -6 || true'

# ===== 判定 + 修复 =====
log ""
if run test -x /usr/sbin/wpa_supplicant; then
    log "wpa_supplicant 已存在 —— 问题不在缺包。重启 NetworkManager 让 D-Bus 重新激活:"
    runlog systemctl restart NetworkManager
    sleep 5
else
    log "!! /usr/sbin/wpa_supplicant 缺失 —— 尝试安装 wpasupplicant ..."
    if run apt-get update >/dev/null 2>&1 && run apt-get install -y wpasupplicant >/dev/null 2>&1; then
        log "    apt 安装成功。"
    elif ls "$SCRIPT_DIR"/*.deb >/dev/null 2>&1; then
        log "    apt 失败 —— 尝试离线安装 U 盘上的 .deb ..."
        run dpkg -i "$SCRIPT_DIR"/*.deb
        run apt-get -f install -y >/dev/null 2>&1 || true
    else
        log "!! apt 安装失败(大概率没联网),U 盘上也没有 .deb 可离线装。"
        log "!! 请给真机临时插一根网线,再重跑本脚本。"
        log "!! (或手动: sudo apt-get install -y wpasupplicant && sudo systemctl restart NetworkManager)"
        exit 0
    fi
    if run test -x /usr/sbin/wpa_supplicant; then
        log "    安装完成,重启 NetworkManager ..."
        runlog systemctl restart NetworkManager
        sleep 5
    else
        log "!! wpa_supplicant 仍缺失 —— 见上方 apt/dpkg 输出。报告已保存,发回核对。"
        exit 0
    fi
fi

# ===== 修复后验证 =====
log ""
log "===== 修复后验证 ====="
runlog bash -c 'nmcli dev status 2>&1'
log "无线扫描:"
runlog bash -c 'nmcli -t dev wifi list 2>&1 | head -12 || true'
STATE="$(run nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep '^wlp5s0:' | cut -d: -f2 || true)"
SCAN="$(run nmcli -t dev wifi list 2>/dev/null | wc -l || true)"
log ""
if [ -n "$STATE" ] && [ "$STATE" != "unavailable" ]; then
    log "==== 结果:有进展 ===="
    log "wlp5s0 状态 = $STATE(不再是 unavailable);扫描到 ${SCAN:-0} 个网络。"
    if [ "${SCAN:-0}" -gt 0 ]; then
        log "去 eDEX 设置 → 网络 里连接 WiFi 即可。"
    else
        log "状态活了但还扫不到网络 —— 把本报告发回再核对。"
    fi
else
    log "==== 结果:仍不可用 ===="
    log "wlp5s0 状态 = ${STATE:-未识别}(扫描 ${SCAN:-0} 个)。把本报告(fix-wifi-result.txt)发回。"
fi
log "报告文件: $OUT"
