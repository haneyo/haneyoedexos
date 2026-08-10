#!/usr/bin/env bash
# eDEX-OS 开机画面修复脚本 — 放到 U 盘,在真机上从文件浏览器点击运行。
#
# 自带诊断:每个关键步骤 + 修复前后的主题状态都会写进同目录(U 盘根目录)的
#   fix-plymouth-result.txt —— 成与不成,拔回 Mac 读这个 txt 就行,不用再单独
#   跑 edex-diag.sh。
#
# 用途:
#   已经装好的机器(ThinkPad E580)开机仍是 Ubuntu 圆圈(#142 / #19)。原因:
#   Ubuntu 24.04 的 plymouth 0.9.3 two-step 插件会把主题目录里的 watermark.png
#   画在黑底背景上——stock spinner 主题带的 watermark.png 正是 Ubuntu 圆圈,
#   装机时被 cp -n 拷进了 edex 主题目录。这个脚本把 edex 主题目录里的
#   watermark.png / bgrt-fallback.png 清掉,只留黑底 + throbber 转圈(无任何 logo)。
#
# 用法:
#   1) 把本文件 + 同一目录下的 edex.plymouth 拷到 U 盘根目录
#   2) 插到真机 → 文件浏览器进入 U 盘 → 点击 fix-plymouth.sh → RUN(确认框)
#   3) 跑完重启机器。诊断报告在同目录 fix-plymouth-result.txt,拔回 Mac 读。
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
PLYMOUTH_FILE="$SCRIPT_DIR/edex.plymouth"
OUT="$SCRIPT_DIR/fix-plymouth-result.txt"
: > "$OUT"
chmod 666 "$OUT" 2>/dev/null

# ---------- 输出:屏幕 + 报告双写 ----------
log() { echo "$*" | tee -a "$OUT"; }

# ---------- 提权 ----------
# run:    执行,输出只在屏幕(用于条件判断 / 输出要被命令替换吃掉的场景)
# runlog: 执行,stdout 同时写进报告(用于诊断 dump / 重建命令)
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

# 中途失败的兜底:报告里留下明确标记,不至于"跑了一半什么都没留下"
trap 'log ""; log "!! 脚本在中途失败(第 $LINENO 行)。报告已保存: $OUT —— 请把整个文件发回。"' ERR

log "==== eDEX plymouth 开机画面修复 ===="
log "时间: $(date '+%Y-%m-%d %H:%M:%S')"
log "报告: $OUT"
log ""

if [ ! -f "$PLYMOUTH_FILE" ]; then
    log "!! 缺少 payload:需要 $SCRIPT_DIR/edex.plymouth"
    log "!! 请确认这个文件和本脚本放在一起。"
    exit 1
fi

# plymouthd lives in /usr/sbin. Do NOT probe it with `command -v` through the
# `run` helper: `command` is a bash builtin, and sudo only execs external
# programs, so `sudo command -v plymouthd` ALWAYS fails ("sudo: command: command
# not found") even when plymouth IS installed — that made this script report
# "plymouth 未安装" on machines that had it (the diag's own lsinitramfs showed
# plymouthd baked into the initramfs). Probe the binary by absolute path;
# fall back to an online install only if it is genuinely absent.
PLYMOUTHD=""
if run test -x /usr/sbin/plymouthd; then
    PLYMOUTHD=/usr/sbin/plymouthd
elif run bash -c 'command -v plymouthd' >/dev/null 2>&1; then
    PLYMOUTHD="$(run bash -c 'command -v plymouthd' 2>/dev/null)"
fi

if [ -z "$PLYMOUTHD" ]; then
    log "!! 未找到 plymouthd —— 尝试在线安装 plymouth ..."
    if run apt-get update >/dev/null 2>&1 \
        && run apt-get install -y plymouth plymouth-theme-spinner >/dev/null 2>&1; then
        PLYMOUTHD=/usr/sbin/plymouthd
        log "    plymouth 已安装。"
    else
        log "!! 在线安装失败(机器可能没联网)。"
        log "!! 请联网后重跑本脚本;或确认 build-iso.sh APTOPTS 包含 'plymouth plymouth-theme-spinner'。"
        exit 1
    fi
fi

# ===== 修复前状态(自带诊断,无论后续成不成报告里都有) =====
log ""
log "===== 修复前状态 ====="
log "内核: $(uname -srm 2>/dev/null || uname -a)"
log "plymouthd: ${PLYMOUTHD}"
log "plymouth-set-default-theme: $(if run test -x "$(dirname "$PLYMOUTHD")/plymouth-set-default-theme"; then echo 存在; else echo 缺失; fi)"
log "GRUB 参数:"
runlog bash -c 'grep -E "GRUB_CMDLINE_LINUX_DEFAULT" /etc/default/grub 2>/dev/null || echo "(无 GRUB_CMDLINE_LINUX_DEFAULT)"'
log "plymouthd.conf 内容:"
runlog bash -c 'if [ -f /etc/plymouth/plymouthd.conf ]; then cat /etc/plymouth/plymouthd.conf | sed "s/^/    /"; else echo "    (文件不存在)"; fi'
log "plymouthd.defaults 内容:"
runlog bash -c 'if [ -f /usr/share/plymouth/plymouthd.defaults ]; then cat /usr/share/plymouth/plymouthd.defaults | sed "s/^/    /"; else echo "    (文件不存在)"; fi'
log "default.plymouth 链接链:"
runlog bash -c 'ls -la /usr/share/plymouth/themes/default.plymouth 2>&1; echo "  最终解析到: $(readlink -f /usr/share/plymouth/themes/default.plymouth 2>/dev/null || echo 未解析)"'
log "主题目录:"
runlog ls -la /usr/share/plymouth/themes/ 2>&1
log "edex 主题目录:"
runlog ls -la /usr/share/plymouth/themes/edex/ 2>&1 || true
log "BGRT(固件 logo):"
runlog bash -c 'if ls /sys/firmware/acpi/bgrt/ >/dev/null 2>&1; then echo "  存在(0.9.3 two-step 不画 BGRT;开机的 logo 来自主题目录里的 watermark.png)"; ls /sys/firmware/acpi/bgrt/ | sed "s/^/    /"; else echo "  无"; fi'
log "当前 initramfs 内主题文件数:"
log "  edex:   $(run lsinitramfs /boot/initrd.img-$(uname -r) 2>/dev/null | grep -c 'themes/edex' || echo 0)"
log "  spinner: $(run lsinitramfs /boot/initrd.img-$(uname -r) 2>/dev/null | grep -c 'themes/spinner' || echo 0)"

# 1) 建主题目录,复用 stock spinner 的动画帧。显式排除 bgrt-fallback.png 和
#    watermark.png —— 0.9.3 的 two-step 会把 watermark.png 画在黑底背景上
#    (stock spinner 的 watermark.png 就是 Ubuntu 圆圈),这俩文件一个都不能留。
log ""
log "[1/4] 组装 /usr/share/plymouth/themes/edex ..."
run mkdir -p /usr/share/plymouth/themes/edex
if [ -d /usr/share/plymouth/themes/spinner ]; then
    for f in /usr/share/plymouth/themes/spinner/*.png; do
        case "$(basename "$f")" in
            bgrt-fallback.png|watermark.png) continue ;;  # 永不拷贝 logo
        esac
        run cp -n "$f" /usr/share/plymouth/themes/edex/ 2>/dev/null || true
    done
fi

# 2) 放入 eDEX 主题配置。清掉可能从旧安装/旧脚本留下的 logo 文件,确保主题
#    目录里只有黑底 + throbber 转圈,开机的任何阶段都不画 logo。
run cp "$PLYMOUTH_FILE" /usr/share/plymouth/themes/edex/edex.plymouth
run rm -f /usr/share/plymouth/themes/edex/watermark.png /usr/share/plymouth/themes/edex/bgrt-fallback.png
log "    主题文件就绪。"

# 3) 设为默认主题(绝对路径 — 脚本以普通用户跑,其 PATH 没有 /usr/sbin)。
#    plymouth-set-default-theme 可能缺失(真机就踩到了:plymouthd 在而
#    set-default-theme 不在,报 "command not found")。存在就用它,否则直接
#    写 plymouthd.conf / plymouthd.defaults + 重指 default.plymouth 链接。
log "[2/4] 设置默认主题为 edex ..."
PSDT="$(dirname "$PLYMOUTHD")/plymouth-set-default-theme"
if run test -x "$PSDT"; then
    runlog "$PSDT" edex
    log "    默认主题: $(run "$PSDT" 2>/dev/null || echo 'edex')"
else
    log "    (plymouth-set-default-theme 缺失 —— 直接写配置 + 重指默认主题链接)"
    run bash -c '
        grep -q "^Theme=" /etc/plymouth/plymouthd.conf \
            && sed -i "s/^Theme=.*/Theme=edex/" /etc/plymouth/plymouthd.conf \
            || printf "Theme=edex\n" >> /etc/plymouth/plymouthd.conf
        printf "[Daemon]\nTheme=edex\n" > /usr/share/plymouth/plymouthd.defaults
    '
    # 关键补丁:真机缺 plymouth-set-default-theme,而 initramfs 的 plymouth hook
    # 在拿不到该工具时,靠 /usr/share/plymouth/themes/default.plymouth 这个
    # update-alternatives 链接决定烤哪个主题 —— 它此前还指向 stock spinner。
    # 只写 plymouthd.defaults 不会动这个链接,重建 initramfs 仍把 spinner 烤
    # 进去,开机就还是 Ubuntu 圆圈。这里直接重指 /etc/alternatives 链接。
    run bash -c 'ln -sf /usr/share/plymouth/themes/edex/edex.plymouth /etc/alternatives/default.plymouth'
    log "    默认主题链接: $(run readlink -f /usr/share/plymouth/themes/default.plymouth 2>/dev/null || echo 未解析)"
    log "    plymouthd.conf: $(run bash -c 'grep -E "^Theme=" /etc/plymouth/plymouthd.conf 2>/dev/null || echo 空')"
fi

# 4) 重建 initramfs + grub,让开机即生效
log "[3/4] 重建 initramfs ..."
runlog update-initramfs -u
log "[4/4] 更新 GRUB ..."
runlog update-grub

# ===== 修复后验证 =====
log ""
log "===== 修复后验证 ====="
INITRD="/boot/initrd.img-$(uname -r)"
log "plymouthd.conf:        $(run bash -c 'grep -E "^Theme=" /etc/plymouth/plymouthd.conf 2>/dev/null || echo 空')"
log "plymouthd.defaults:    $(run bash -c 'grep -E "^Theme=" /usr/share/plymouth/plymouthd.defaults 2>/dev/null || echo 空')"
log "default.plymouth 解析到: $(run readlink -f /usr/share/plymouth/themes/default.plymouth 2>/dev/null || echo 未解析)"
EDEX_COUNT="$(run lsinitramfs "$INITRD" 2>/dev/null | grep -c 'themes/edex' || true)"
SPINNER_COUNT="$(run lsinitramfs "$INITRD" 2>/dev/null | grep -c 'themes/spinner' || true)"
log "initramfs 内主题文件数: edex=${EDEX_COUNT:-0} / spinner=${SPINNER_COUNT:-0}"
log "initramfs 内 plymouth 相关文件:"
runlog bash -c 'lsinitramfs /boot/initrd.img-$(uname -r) 2>&1 | grep -E "plymouth|themes/edex|themes/spinner" | sed "s/^/    /" || echo "    (无)"'
log "initramfs hook 的主题判定逻辑(hook 源码):"
runlog bash -c 'grep -nE "set-default-theme|plymouthd.defaults|default.plymouth|THEME|theme" /usr/share/initramfs-tools/hooks/plymouth 2>/dev/null | head -25 || echo "    (hook 文件不存在)"'

log ""
if [ "${EDEX_COUNT:-0}" -gt 0 ]; then
    log "==== 结果:成功 ===="
    log "initramfs 已烤入 eDEX 主题($EDEX_COUNT 个文件)。重启后开机动画应只有黑底 + 转圈,无任何 logo。"
else
    log "==== 结果:未生效 ===="
    log "initramfs 里没有 eDEX 主题文件(edex=${EDEX_COUNT:-0} / spinner=${SPINNER_COUNT:-0})。"
    log "把本报告(fix-plymouth-result.txt)发回,据此再定位。"
fi
log "报告文件: $OUT"
