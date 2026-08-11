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

## v2.3.11 之后要做:Phase C 真机验证(ThinkPad E580)

以下修复代码已完成并随 v2.3.11 ISO 发布,**尚未在真机验证**:

- [x] **熄屏 DPMS**(#181,`fac0e21`):闲置超时后 `xset dpms force off` 真关屏,鼠标一动 `force on`。✅ 机制实测通过:`force off` 在 `-dpms` 下仍生效(DPMSInfo=OFF)。端到端触发受本机 `screenOffIdle=18000s` 限制,需调小阈值目测(见 `ubuntu/PhaseC-findings-2026-08-11.md`)。
- [ ] **app monitor 填满**(`402a22b`):Xvfb 1600×800(2:1)+ openbox 自动最大化/去装饰(`/tmp/edex-monitor-openbox.xml`)。**🆕 已确认 bug**:backend.js 用 `openbox --config`(非法参数,应 `--config-file`)→ openbox 秒退、无 WM、窗口不最大化。手动用 `--config-file` 后 Firefox 完美最大化 1600×800 无黑边。修复在 App 侧 src(`appmonitor/backend.js`)。(详见 `ubuntu/PhaseC-findings-2026-08-11.md`)
- [x] **Firefox 真显示**:官方 tarball(`/opt/firefox/firefox`)在虚拟显示器内可开,`MOZ_DISABLE_CONTENT_SANDBOX` 生效。✅ 已验证(:102 内 Firefox 窗口已映射,env 正确)。
- [ ] **用户名显示安装时填的名字**(#174):`getDisplayName` 优先 GECOS realname。验证:Welcome back 显示安装时"你的名字",不是 `edex`。🆕 根因已确认:getDisplayName 自缓存 `settings.username="edex"`(首启由登录名写入并缓存),会话账号 edex GECOS 为空,GECOS 分支永远用不上。修复方向:firstRun 向导加显示名步骤 / OS 侧 chfn 写 GECOS + 清缓存(见 `ubuntu/PhaseC-findings-2026-08-11.md`)。
- [ ] **电池呼吸光效**(#173):充电时 `battery_fill` 1.2s 呼吸(`battery_charge_pulse`)。验证:插电 → 时钟左上角电量图标呼吸;不插电 → 静态。
- [ ] **开机动画默认开启**(#175):种子 `nointro:false` + `_boot.js:94` 默认 false。验证:开机先播动画,不是直接进 UI。settings 已确认 `nointro:false`,待重启确认。

## 未完成功能任务(Linux 侧)

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| #11 | 开机 GRUB 报错 `file '/boot/' not found` | 待办 | 引导结构问题 |
| #128 | 新 ISO 安装器崩溃(subiquity `load_autoinstall_data`) | 进行中 | 安装流程 |
| #139 | 笔记本电量不显示:upower + sysfs 兜底 | 进行中 | 真机电池读数 |
| #140 | 电源键按下显示电源菜单而非直接关机 | 进行中 | openbox 键绑定 + 菜单 |
| #144 | 中文输入无候选框(盲打) | ✅ 已修(2026-08-11,backend 不再抢 fcitx5 dbus name) | 根因:backend.js 虚拟屏 `fcitx5 --replace` 顶掉主屏 :0 实例;已删该 spawn,部署 10 修复版 |
| #145 | Show disks 显示未挂载 U 盘 + 点击挂载 | 进行中 | udisks2 |
| #163 | 解锁后光标消失:区分应用 vs 触摸板 | 待办 | |

## 已取消 / 不要动

- **#19 开机 logo 部分**:用户决定保持原样(plymouth 原版 logo),已 revert `22aebfe`。**不要再改开机动画/logo**。

## CI 打包侧备忘

- 打 tag `v*` 触发 `release.yml`(AppImage + ISO 双构建,ISO 镜像 OSS)。
- tag 名必须与 `src/package.json` version 一致(去 `v`),否则 UpdateChecker 版本比对失效。
- 内置 mihomo/metacubexd/geo + Firefox tarball 已在 `packaging/build-iso.sh` bake,无需手动。
