# Phase C 真机验证发现(E580,2026-08-11 下午)

> 在 ThinkPad E580(本机,跑 v2.3.11)上逐项验证。对应 `ubuntu/README.md` 的 Phase C 清单。

## 🐛 已确认 bug #1:appmonitor 后端 openbox 参数错(阻断"app monitor 填满")

- **现象**:tab 4/5 里原生应用窗口不最大化,停在 1280x720(有黑边、未填满槽位)。
- **根因**:`appmonitor/backend.js` 的 `realBackend` 启动嵌套 openbox 时用了
  **`--config`**(不存在的参数),openbox 3.6.1 直接拒绝并退出:
  ```
  Openbox-Message: Invalid command line argument "--config"
  ```
  正确参数是 **`--config-file`**。因此 openbox 秒退 → 嵌套显示器 :101/:102 上
  **永远没有 WM** → `<application class="*"><maximized>yes</maximized>` 永不生效。
  这也解释了 402a22b 修复"代码在、效果没出"的原因。
- **证据**:
  - `DISPLAY=:102 openbox --config /tmp/edex-monitor-openbox.xml --sm-disable`
    → `Invalid command line argument "--config"`,退出。
  - 改用 `--config-file` 后:`_NET_SUPPORTING_WM_CHECK` 设置成功,所有 Firefox 窗口
    立即最大化到 **1600x800+0+0**,铺满 2:1 帧缓冲(槽位 832×416≈2:1,noVNC 正好无黑边)。
- **修复位置(App 侧,需在 Mac 的 src 改 + 重打 AppImage/ISO)**:
  `src/appmonitor/backend.js` 内 `o("openbox",["--config",d,"--sm-disable"],...)`
  → `["--config-file",d,"--sm-disable"]`。
- **本机临时措施**:已在 :102 手动用 `--config-file` 启动了 openbox(仍在运行,让 Firefox
  现在就填满)。若应用重启 monitor,它自己的 `--config` 启动仍会失败,但只要 :102 上我这个
  openbox 还活着,最大化就保持有效。**注意**:修复前不要重启 monitor 相关进程。

## 🐛 已确认 bug #2:Welcome back 用户名 (#174)根因 = getDisplayName 自缓存

- **现象**:Welcome back 显示 "edex",不是装机时填的名字。
- **根因(逐字节确认)**:
  1. 会话账号是 `edex`(uid 1000),GECOS **为空**(`edex:x:1000:1000::/home/edex`)。
  2. `getDisplayName()` 逻辑:
     ```js
     let e = settings.username || null;
     if (e) return e;                       // ① 有 settings.username → 立即返回
     let t = await require("username")();   // ② 登录名 "edex"
     const n = require("os").userInfo();
     if (n.realname && n.realname.trim() && n.realname !== t) e = n.realname;  // ③ GECOS(需非空且≠登录名)
     return e || t, e && (settings.username = e);  // ④ 结果缓存回 settings.json
     ```
  3. 首启时 settings.username 空 → 走②得到 "edex" → GECOS 空用不上 → 返回 "edex" 并**缓存**
     `settings.username="edex"`。之后每次①直接短路返回 "edex"。
  4. `install-edex.sh` 的种子 settings.json **不含 username 字段**(逐行确认)—— 是 App 自缓存。
- **修复方向(App 侧,Mac 的 src)**:
  - **首选**:`classes/firstRun.class.js` 首启向导加一步「显示名」→ 写 `settings.username`。
  - **OS 侧兜底**:install-edex.sh 用 `chfn -f "<真名>" edex` 给会话账号写 GECOS(需拿到装机时的名字);
    并注意**清掉已缓存的 settings.username**(否则仍短路)。
  - 注意 getDisplayName 的 GECOS 分支要求 `realname ≠ 登录名`,纯 OS 侧改 GECOS 到与用户名不同才生效。

## ✅ 已验证正常

- **Firefox 真显示**:官方 tarball `/opt/firefox/firefox` 在 DISPLAY=:102 内正常运行,
  多个窗口已映射;env 带 `MOZ_DISABLE_CONTENT_SANDBOX=1` + `MOZ_DISABLE_GMP_SANDBOX=1`
  (backend.js 按 app 名自动注入,已生效)。
- **Xvfb 2:1 分辨率**::101/:102 均为 `1600x800x24`(402a22b 已生效)。
- **Xvfb 是孤儿进程**::101/:102 的 Xvfb PPID=1,由 10:15 的**上一个** appmonitor 实例启动,
  当前 eDEX(10:24)未接管 —— 说明 eDEX/appmonitor 曾重启过,孤儿 Xvfb 被复用。

## ✅ 熄屏 DPMS(#181)实测通过(机制)

- 用 ctypes 直调 libXext 的 DPMSInfo 实测(脚本 `/tmp/dpmsq.py`):
  - 初始:`power=ON, enabled=no`(会话 `xset -dpms` 已禁用自动模式)
  - `xset dpms force off` 后:`power=OFF(3), enabled=yes` → **force off 在 -dpms 下仍生效**
  - `xset dpms force on` 后:`power=ON(0)`
- 结论:App 侧 `power:screenOff` 的 `xset dpms force off/on` 机制**可用**,OS 侧 `-dpms` 不冲突。
- 注意:本机 `screenOffIdle=18000s`(5 小时)、`screensaverIdle=1800s`(用户设的),端到端触发
  需把阈值调小或等 5 小时;物理屏灭不灭由驱动决定,DPMSInfo=OFF 即 X 层已关屏。

## ⚠️ 待目测/待真机确认

- **电池呼吸光效(#173)**:需真正充电时目测。当前 BAT0 99% "Not charging"(AC 在线),无呼吸。
- **开机动画(#175)**:settings `nointro:false` 已就绪,需重启确认。

## 复现/验证命令(供后续会话用)

```bash
# 检查 :102 有没有 WM
DISPLAY=:102 xprop -root _NET_SUPPORTING_WM_CHECK

# 复现 bug
DISPLAY=:102 openbox --config /tmp/edex-monitor-openbox.xml --sm-disable   # 报 Invalid --config

# 修复验证(手动起 WM,窗口即最大化)
DISPLAY=:102 setsid openbox --config-file /tmp/edex-monitor-openbox.xml --sm-disable &
DISPLAY=:102 wmctrl -lG   # 应为 1600x800+0+0

# 提取运行中 backend.js 检查 openbox 参数(asar 头部偏移 16,长度 608070)
# 找 "realBackend" 附近
```
