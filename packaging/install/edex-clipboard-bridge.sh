#!/bin/bash
# eDEX-OS 全系统剪贴板桥 — 把指定 Xvfb 虚拟显示与主显示 :0 的 CLIPBOARD(文本)双向同步。
# 用法:edex-clipboard-bridge.sh <DISPLAY>
# 由 appmonitor 后端为每个虚拟显示器各拉起一个;空剪贴板读取不广播(防回环)。
# 主显示可用环境变量 MAIN_DISPLAY 覆盖;轮询间隔 INTERVAL(秒)。
MAIN="${MAIN_DISPLAY:-:0}"
REMOTE="${1:?usage: edex-clipboard-bridge.sh <display>}"
INTERVAL="${INTERVAL:-0.4}"

read_sel() { xclip -selection clipboard -o -d "$1" 2>/dev/null; }
h() { printf %s "$1" | sha1sum | cut -d' ' -f1; }

h_main="$(h "$(read_sel "$MAIN")")"
h_remote="$(h "$(read_sel "$REMOTE")")"

while true; do
  cur_main="$(read_sel "$MAIN")"
  cur_remote="$(read_sel "$REMOTE")"
  nh_main="$(h "$cur_main")"
  nh_remote="$(h "$cur_remote")"
  if [ "$nh_main" != "$h_main" ] && [ -n "$cur_main" ]; then
    printf %s "$cur_main" | xclip -selection clipboard -in -d "$REMOTE"
    h_main="$nh_main"; h_remote="$(h "$(read_sel "$REMOTE")")"
  elif [ "$nh_remote" != "$h_remote" ] && [ -n "$cur_remote" ]; then
    printf %s "$cur_remote" | xclip -selection clipboard -in -d "$MAIN"
    h_main="$(h "$(read_sel "$MAIN")")"; h_remote="$nh_remote"
  fi
  sleep "$INTERVAL"
done
