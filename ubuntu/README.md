# eDEX-OS · Ubuntu 侧待办

> 这里放 **只能在 Ubuntu 真机 / CI 打包侧** 做的事。macOS 预览(cdp 9222)做不了的都归这儿。
> 详细背景见 [`docs/ubuntu-side-changes.md`](../docs/ubuntu-side-changes.md)。

## Phase C 实测记录(2026-08-11,v2.3.11)

- ✅ **WiFi**:已可用(#172 netdev 组修复生效)。
- ❌ **用户名 #174**:装机时设了自己的 Ubuntu 用户名,Welcome back **仍显示 "edex"**。
  **注意**:v2.3.11 已含 `6c5dbe8` 的 autoinstall 修复(身份屏不再预填 `username: edex` 默认值),
  但真机仍显示 "edex" → 问题在更深处,大概率**实际登录账号就是 "edex"**(install-edex.sh 的
  self-heal:当 `/etc/passwd` 无 uid≥1000 账号时 `useradd -m edex`,且该账号 GECOS 为空)。
  真机诊断(eDEX 终端里跑,WiFi 可用可远程):
  ```bash
  getent passwd | awk -F: '$3 >= 1000 && $3 < 65534'   # 看 uid≥1000 账号和 GECOS
  whoami && grep -E '^autologin-user' /etc/lightdm/lightdm.conf.d/*.conf
  grep -i username ~/.config/eDEX-UI/settings.json      # 看是否有残留 username 键
  ```
  若首账号是 `edex` 且 GECOS 空 → 修 install-edex.sh(self-heal 用用户真名 / 写 GECOS);若账号正常
  但 settings.json 残留 username → 修 `getDisplayName`(去掉 `if (user) settings.username = user` 的持久化,或存之前先对比 GECOS)。
- 🆕 **#182 开机终端两行**:一开机终端就有两行,疑似解锁时按 Enter 多打了一行。
- 🆕 **#183 开机过渡**:黑屏 + 原生鼠标光标 → 白屏一下 → 才进 eDEX UI。logo 部分用户已取消,白屏/原生光标过渡仍待处理(不动开机动画)。

> 💡 **2026-08-11 真机 12fix**:本机跑了一轮 12 处补丁修复并部署为 12fix,
> 以 `packaging/patch-appimage.sh` 保留(权威来源,`src/` 未改)。含 #144 候选框、
> Claude 滚动、性能/光标锁死、win+L 锁屏、独立锁屏终端、天气弹窗、globe 30fps 等。
> 重建方法与事故纪律见 [`FIXES-2026-08-11.md`](./FIXES-2026-08-11.md)。

## v2.3.11 之后要做:Phase C 真机验证(ThinkPad E580)

以下修复代码已完成并随 v2.3.11 ISO 发布,**尚未在真机验证**:

- [ ] **熄屏 DPMS**(#181,`fac0e21`):闲置超时后 `xset dpms force off` 真关屏,鼠标一动 `force on`。验证:等 30s 熄屏 → 动鼠标亮屏 → 再等再亮。
- [ ] **app monitor 填满**(`402a22b`):Xvfb 1600×800(2:1)+ openbox 自动最大化/去装饰(`/tmp/edex-monitor-openbox.xml`)。验证:tab4/5 选 Firefox → 画面填满无黑框无缺角;选别的 app 也满。
- [ ] **Firefox 真显示**:官方 tarball(`/opt/firefox/firefox`)在虚拟显示器内可开,`MOZ_DISABLE_CONTENT_SANDBOX` 生效。
- [ ] **用户名显示安装时填的名字**(#174):`getDisplayName` 优先 GECOS realname。验证:Welcome back 显示安装时"你的名字",不是 `edex`。
- [ ] **电池呼吸光效**(#173):充电时 `battery_fill` 1.2s 呼吸(`battery_charge_pulse`)。验证:插电 → 时钟左上角电量图标呼吸;不插电 → 静态。
- [ ] **开机动画默认开启**(#175):种子 `nointro:false` + `_boot.js:94` 默认 false。验证:开机先播动画,不是直接进 UI。

## 未完成功能任务(Linux 侧)

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| #11 | 开机 GRUB 报错 `file '/boot/' not found` | 待办 | 引导结构问题 |
| #128 | 新 ISO 安装器崩溃(subiquity `load_autoinstall_data`) | 进行中 | 安装流程 |
| #139 | 笔记本电量不显示:upower + sysfs 兜底 | 进行中 | 真机电池读数 |
| #140 | 电源键按下显示电源菜单而非直接关机 | 进行中 | openbox 键绑定 + 菜单 |
| #144 | 中文输入无候选框(盲打) | ✅ 真机已修复 | backend.js 删虚拟屏 fcitx5 spawn(见 12fix) |
| #145 | Show disks 显示未挂载 U 盘 + 点击挂载 | 进行中 | udisks2 |
| #163 | 解锁后光标消失:区分应用 vs 触摸板 | 待办 | |

## 已取消 / 不要动

- **#19 开机 logo 部分**:用户决定保持原样(plymouth 原版 logo),已 revert `22aebfe`。**不要再改开机动画/logo**。

## CI 打包侧备忘

- 打 tag `v*` 触发 `release.yml`(AppImage + ISO 双构建,ISO 镜像 OSS)。
- tag 名必须与 `src/package.json` version 一致(去 `v`),否则 UpdateChecker 版本比对失效。
- 内置 mihomo/metacubexd/geo + Firefox tarball 已在 `packaging/build-iso.sh` bake,无需手动。
