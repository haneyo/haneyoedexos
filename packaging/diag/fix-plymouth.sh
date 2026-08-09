#!/usr/bin/env bash
# eDEX-OS 开机画面修复脚本 — 放到 U 盘,在真机上从文件浏览器点击运行。
#
# 用途:
#   已经装好的机器(ThinkPad E580)开机仍是 Ubuntu 圆圈(#142)。原因是安装时
#   eDEX plymouth 主题的 payload 没进 chroot(见 61ec9c6),安装脚本静默回退到
#   stock spinner 主题,它的 bgrt-fallback.png 就是 Ubuntu 圆圈。
#   这个脚本在已装好的系统上直接补上 eDEX 主题,不用重装。
#
# 用法:
#   1) 把本文件 + 同一目录下的 edex.plymouth + edex-boot-logo.png 拷到 U 盘根目录
#   2) 插到真机 → 文件浏览器进入 U 盘 → 点击 fix-plymouth.sh → RUN(确认框)
#   3) 跑完后重启机器,开机动画就是 eDEX 品牌
#
# 需要:root 权限(sudo)。passwordless sudo 直接跑;否则会停在密码提示。
# 幂等:跑多次无副作用。

set -e
set -u

# ---------- 定位 payload:脚本同目录下的 edex.plymouth + edex-boot-logo.png ----------
SCRIPT="$0"
case "$SCRIPT" in
    /*) ;;
    *) SCRIPT="$(pwd)/$SCRIPT" ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT")" 2>/dev/null && pwd || echo "$HOME")"
PLYMOUTH_FILE="$SCRIPT_DIR/edex.plymouth"
LOGO_FILE="$SCRIPT_DIR/edex-boot-logo.png"

# ---------- 提权:优先复用当前 root;否则 sudo ----------
run() {
    if [ "$(id -u)" = "0" ]; then
        "$@"
    else
        sudo "$@"
    fi
}

echo "==== eDEX plymouth 开机画面修复 ===="

if [ ! -f "$PLYMOUTH_FILE" ] || [ ! -f "$LOGO_FILE" ]; then
    echo "!! 缺少 payload:需要 $SCRIPT_DIR/edex.plymouth 和 $SCRIPT_DIR/edex-boot-logo.png"
    echo "!! 请确认这两个文件和本脚本放在一起。"
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
    echo "!! 未找到 plymouthd —— 尝试在线安装 plymouth ..."
    if run apt-get update >/dev/null 2>&1 \
        && run apt-get install -y plymouth plymouth-theme-spinner; then
        PLYMOUTHD=/usr/sbin/plymouthd
        echo "    plymouth 已安装。"
    else
        echo "!! 在线安装失败(机器可能没联网)。"
        echo "!! 请联网后重跑本脚本;或确认 build-iso.sh APTOPTS 包含 'plymouth plymouth-theme-spinner'。"
        exit 1
    fi
fi

# 1) 建主题目录,复用 stock spinner 的动画帧(排除 bgrt-fallback.png)
echo "[1/4] 组装 /usr/share/plymouth/themes/edex ..."
run mkdir -p /usr/share/plymouth/themes/edex
if [ -d /usr/share/plymouth/themes/spinner ]; then
    for f in /usr/share/plymouth/themes/spinner/*.png; do
        [ "$(basename "$f")" = "bgrt-fallback.png" ] && continue
        cp -n "$f" /usr/share/plymouth/themes/edex/ 2>/dev/null || true
    done
fi

# 2) 放入 eDEX 主题配置 + 品牌 logo(作为 BGRT 兜底图,也就是默认开机显示那张)
run cp "$PLYMOUTH_FILE" /usr/share/plymouth/themes/edex/edex.plymouth
run cp "$LOGO_FILE" /usr/share/plymouth/themes/edex/bgrt-fallback.png
echo "    主题文件就绪。"

# 3) 设为默认主题(绝对路径 — 脚本以普通用户跑,其 PATH 没有 /usr/sbin)
echo "[2/4] 设置默认主题为 edex ..."
PSDT="$(dirname "$PLYMOUTHD")/plymouth-set-default-theme"
[ -x "$PSDT" ] || PSDT=/usr/sbin/plymouth-set-default-theme
run "$PSDT" edex
echo "    默认主题: $(run "$PSDT" 2>/dev/null || echo 'edex')"

# 4) 重建 initramfs + grub,让开机即生效
echo "[3/4] 重建 initramfs ..."
run update-initramfs -u
echo "[4/4] 更新 GRUB ..."
run update-grub

echo ""
echo "==== 完成 ===="
echo "重启后开机动画应显示 eDEX 品牌(不再是 Ubuntu 圆圈)。"
echo "如果仍有问题,把 /usr/share/plymouth/themes/edex 目录内容发回来核对。"
