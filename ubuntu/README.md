# eDEX-OS · Ubuntu 侧待办

> 这里放 **只能在 Ubuntu 真机 / CI 打包侧** 做的事。macOS 预览(cdp 9222)做不了的都归这儿。
> 详细背景见 [`docs/ubuntu-side-changes.md`](../docs/ubuntu-side-changes.md)。

## Phase C 实测记录(2026-08-11,v2.3.11)

- ✅ **WiFi**:已可用(#172 netdev 组修复生效)。
- 🆕 **app monitor 未填满根因已定位**:backend.js 给 openbox 传 `--config`(非法,应为 `--config-file`)→ openbox 秒退无 WM → 窗口不最大化。手动修正后 Firefox 完美铺满 1600×800。见 `ubuntu/PhaseC-findings-2026-08-11.md`。
- ❌ **用户名 #174**:装机时设了自己的 Ubuntu 用户名,Welcome back **仍显示 "edex"**。
  根因推测:eDEX 会话以固定 `edex` 账号运行,`os.userInfo().realname` 拿到的是该账号的 GECOS
  = "edex",`getDisplayName` 的 GECOS 优先逻辑因此失效。待查:install-edex.sh 到底创建了哪个
  会话账号;真名应改为读 Ubuntu 安装时创建的主用户(如最高非系统 uid 的 GECOS,或首启向导把用户名写进 settings.json)。
- 🆕 **#182 开机终端两行**:一开机终端就有两行,疑似解锁时按 Enter 多打了一行。
- 🆕 **#183 开机过渡**:黑屏 + 原生鼠标光标 → 白屏一下 → 才进 eDEX UI。logo 部分用户已取消,白屏/原生光标过渡仍待处理(不动开机动画)。

## 活动待办

> ⚠️ **活动待办已统一合并到根目录 [`TODOS.md`](../TODOS.md)**(唯一权威)。
> 本文件仅保留历史背景与实测记录;下面这些已不再单独跟踪:
> Ubuntu 侧仅剩 **#174 用户名显示**、**#183 开机过渡**;其余 #11/#128/#139/#140/#145/#163/
> #173/#175/#182 已由用户确认去掉(见 TODOS.md §C)。

### 历史背景(2026-08-11,Phase C 真机验证)**

- 熄屏 DPMS(#181,`fac0e21`)机制已实测通过;端到端触发受 `screenOffIdle=18000s` 限制。
- app monitor 填满(`402a22b`):Xvfb 1600×800 + openbox 最大化/去装饰;🆕 已确认 bug:
  backend.js 用 `openbox --config`(非法,应 `--config-file`)→ openbox 秒退无 WM。
  修复在 App 侧 src(`appmonitor/backend.js`),已入补丁链,待真机验证。
- Firefox 真显示:官方 tarball 在虚拟显示器内可开,`MOZ_DISABLE_CONTENT_SANDBOX` 生效,已验证。
- 中文输入无候选框(#144):backend 不再抢 fcitx5 dbus name,已修(2026-08-11)。

## 已取消 / 不要动

- **#19 开机 logo 部分**:用户决定保持原样(plymouth 原版 logo),已 revert `22aebfe`。**不要再改开机动画/logo**。

## CI 打包侧备忘

- 打 tag `v*` 触发 `release.yml`(AppImage + ISO 双构建,ISO 镜像 OSS)。
- tag 名必须与 `src/package.json` version 一致(去 `v`),否则 UpdateChecker 版本比对失效。
- 内置 mihomo/metacubexd/geo + Firefox tarball 已在 `packaging/build-iso.sh` bake,无需手动。
