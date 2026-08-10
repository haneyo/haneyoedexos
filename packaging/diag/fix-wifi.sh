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
#   驱动/固件都正常(RTL8821CE, 固件 24.11.0 已加载)。真实根因
#   (fix-wifi-result.txt 确认):系统缺 netdev 组 → wpa_supplicant.service
#   (声明 Group=netdev)起不来(status=216/GROUP "Failed to determine group
#   credentials")→ D-Bus 激活失败。其次才是 wpasupplicant 包缺失
#   (NetworkManager 对它只是 Recommends 而非 Depends,缺了也不报安装错误)。
#   本脚本:先确保 wpa_supplicant 在,再补 netdev 组,最后重启服务。
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
log "netdev 系统组(wpa_supplicant 服务的属组):"
runlog bash -c 'getent group netdev 2>&1 || echo "缺失 —— netdev 组不存在,wpa_supplicant 服务 Group=netdev 解析失败(status=216/GROUP)"'
log "NetworkManager 最近 supplicant 报错:"
runlog bash -c 'journalctl -u NetworkManager -b --no-pager 2>&1 | grep -iE "supplicant|Failed to D-Bus activate" | tail -6 || true'

# ===== 判定 + 修复 =====
log ""
if run test -x /usr/sbin/wpa_supplicant; then
    log "wpa_supplicant 已存在 —— 问题不在缺包,转入下面的组/服务修复。"
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
    if ! run test -x /usr/sbin/wpa_supplicant; then
        log "!! wpa_supplicant 仍缺失 —— 见上方 apt/dpkg 输出。报告已保存,发回核对。"
        exit 0
    fi
    log "    wpa_supplicant 就绪。"
fi

# 真机根因(2026-08-10 fix-wifi-result.txt):wpa_supplicant.service 声明
# Group=netdev,但系统里没有 netdev 组 → systemd 解析组凭据失败
# (status=216/GROUP "Failed to determine group credentials: No such process")
# → D-Bus 激活 wpa_supplicant 失败 → wlp5s0 停在 "unavailable"。
# 光重启 NetworkManager 不解决;必须先补上 netdev 组。
log ""
log "检查 netdev 系统组(wpa_supplicant 服务声明的属组):"
if run getent group netdev >/dev/null 2>&1; then
    log "    netdev 组存在。"
else
    log "    netdev 组缺失 —— 创建系统组(供 wpa_supplicant 服务解析组凭据)..."
    run bash -c 'groupadd --system netdev 2>/dev/null || addgroup --system netdev 2>/dev/null || true'
    if run getent group netdev >/dev/null 2>&1; then
        log "    netdev 组已创建。"
    else
        log "!! netdev 组仍无法解析 —— 继续重启服务试一下,报告里会有 systemctl 输出。"
    fi
fi

log "重载 systemd + 重启 wpa_supplicant / NetworkManager:"
runlog systemctl daemon-reload
runlog systemctl restart wpa_supplicant || true
runlog systemctl restart NetworkManager
sleep 6

# ===== 修复后验证 =====
log ""
log "===== 修复后验证 ====="
log "netdev 组:"
runlog bash -c 'getent group netdev 2>&1 || echo "(仍缺失)"'
log "wpa_supplicant 服务:"
runlog bash -c 'systemctl is-active wpa_supplicant 2>&1 || true; systemctl status wpa_supplicant --no-pager -l 2>&1 | head -8 || true'
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
