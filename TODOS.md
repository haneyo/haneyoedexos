# eDEX-OS 待办总清单(唯一权威)

> 2026-08-12 合并整理。所有活动待办统一放本文件;各文档(ubuntu/README.md、
> FIX-RECORD-*.md、CONTINUE.md)里的旧待办清单已移除,只留背景/实测记录作参考。
> 详细背景:Ubuntu 侧见 [`docs/ubuntu-side-changes.md`](docs/ubuntu-side-changes.md)、
> [`ubuntu/PhaseC-findings-2026-08-11.md`](ubuntu/PhaseC-findings-2026-08-11.md);
> eDEX App 补丁见 [`packaging/patch-appimage.sh`](packaging/patch-appimage.sh)。

---

## A. 当前待办(活动)

### A1. eDEX App 侧(改 AppImage 补丁)

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| #8 | 内置 **AXEL**,替换设置里 UGET 菜单 | 🔨 2026-08-13 实现完(src+patch 注入,仿真全过),**待笔记本验收** | 设置菜单:URL + 线程(默认6) + 下载目录(可设);显示进度/速度/剩余;暂停/恢复。已实现:`_boot.js` axel 任务表+5 IPC、`_renderer.js` 下载小节+`window.axel`、`_i18n.js` 文案、patch 注入。**验收**:笔记本 `sudo apt install axel` → 同步仓库 → `sudo bash packaging/patch-appimage.sh /opt/edex/eDEX-UI.AppImage` → `sudo systemctl restart lightdm` → 设置 apps 分类加 URL 下载看进度/暂停/恢复/删除 |
| #9 | **CLASH** 设置增强 | 🔨 2026-08-13 实现完(src+patch 注入,仿真全过),**待笔记本验收** | 节点选择/测速/全局·规则·直连/规则列表。已实现:`clash:ctrl` 透传 handler(controller REST API,Bearer)、renderer 模式 select+代理组+规则只读、patch 注入。**验收**(同上重跑 patch):clash 分类切模式/切代理组/测速出 ms/规则列表;daemon 未启动时显示"控制接口无响应" |

### A2. Ubuntu 侧(真机 / CI 打包侧)

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| #174 | Welcome back 用户名显示安装时填的名字(现显示 "edex") | ⏳ | **根因已确认**:getDisplayName 自缓存 `settings.username="edex"`(首启由登录名写入),edex GECOS 空,GECOS 分支用不上。修复方向:firstRun 向导加显示名 / OS 侧 `chfn` 写 GECOS + 清缓存 |
| #183 | 开机过渡:黑屏+原生鼠标光标 → 白屏 → eDEX UI | ⏳ | 白屏/原生光标过渡待处理;**不动开机动画/logo** |

---

## B. 已完成(追溯)

| # | 内容 | 何时 |
|---|---|---|
| #7 | 内置 BTOP 显示在 APP 列表:本机 apt 装 btop 1.3.0;补丁链 `window.cliApps` 加 `{id:"btop",name:"BTOP",cmd:["btop"]}`;build-iso APTOPTS +btop | 2026-08-12,见 FIX-RECORD-20260812-28fix-apps.md,**已并入 28fix 产物待重启部署** |
| #10 | 内置 FASTFETCH(用户澄清只装 app,不做开机显示):本机已装 2.67.0(deb);build-iso 加 INSTALL_FASTFETCH(GitHub release 静态二进制) | 2026-08-12,见 FIX-RECORD-20260812-28fix-apps.md |
| #11 | 确保内置 FFMPEG:本机已装 6.1.1(apt);build-iso APTOPTS +ffmpeg | 2026-08-12,见 FIX-RECORD-20260812-28fix-apps.md |
| #12 | 超负荷时 CPU型号/MEMORY USING/NETWORK UP·DOWN 文字柔和红光闪烁:三组件加 `.edex_overload` 类 + 阈值切换 + 3 个 CSS 加闪烁动画 | 2026-08-12,见 FIX-RECORD-20260812-28fix-apps.md,**已并入 28fix 产物待重启部署** |
| #24 | CODE 屏保假代码每 10 行整屏清屏(ESC[2J ESC[H)导致"跑到一半不见了从头跑" → 去掉清屏,改为自然上滚 | 2026-08-12,见 FIX-RECORD-20260812-24fix-ssaver-scroll.md,**已并入 25fix 产物待重启部署** |
| #25 | 打开终端自带两行/像多按回车:连接时无条件写 boot `\r`(canonical ICRNL 空行提交) → 改延迟条件回退(1200ms 无输出且无输入才补发) | 2026-08-12,见 FIX-RECORD-20260812-25fix-term-bootcr-lockdim.md,**已并入 27fix 产物待重启部署** |
| #26 | CODE 锁屏时钟/锁屏框被暗化(仅键盘不暗):恢复旧版 z-index 提升,时钟与锁屏框抬到暗化层(z3000)之上 | 2026-08-12,见 FIX-RECORD-20260812-25fix-term-bootcr-lockdim.md,**已并入 27fix 产物待重启部署** |
| #27 | 第三终端 tab 只显示 "TERM"、不显示进程名:cover.tabLabel(y 函数)与 rememberProc 只给 tab0/tab1 拼进程名,tab2 落静态 t[2] → 补 `2===n?"#3 - "+o` 分支 + rememberProc 放行 2,与 tab1 "#2 - bash" 递增一致 | 2026-08-12,见 FIX-RECORD-20260812-27fix-tab3term.md,**待重启部署** |
| #23 | 周期性 widget 重置后左右列消失 → 重建后补 reveal(animationPlayState=running) | 2026-08-12,见 FIX-RECORD-20260812-23fix-widget-reset.md,已部署 |
| #22 | CODE 屏保/锁屏渲染修复:cat pty 改 `stty raw -echo`(消除 `^[` 乱码/双行/空行)+ 覆盖层不透明背景(遮住真终端) | 2026-08-12,见 FIX-RECORD-20260812-22fix-lock-garble.md,已部署 |
| #20 | 锁屏/屏保改独立真实终端(engage ttyspawn 新建 cat pty,unlock/dismiss 销毁) | 2026-08-12,commit 7f2faa3,已部署 |
| #6 | 21fix TAB5 Browser w3m 裸启动秒退 → 配默认主页 | 2026-08-12,已合并进 20fix 产物 |
| #9 | 终端文本选择+复制 | 用户确认可用(2026-08-12) |
| #17 | CliPanel 无限递归 RangeError | 2026-08-12,已入补丁 |
| #18 | extraTtys 动态分配,取消 8 槽上限 | 2026-08-12,已入补丁 |
| #19 | tab1/tab2 统一成普通终端(EMPTY→TERM) | 2026-08-12,已入补丁 |
| #172 | WiFi 可用(netdev 组修复) | 2026-08-11 实测 |
| #181 | 熄屏 DPMS | 2026-08-11 实测通过 |
| #144 | 中文输入无候选框(fcitx5 dbus 抢占) | 2026-08-11 已修;**候选框 UI(黑底无边框+主题色)2026-08-13 真机目测确认** |
| 音效 | 开机 intro 音效(rtkit/RealtimeKit 超时修复) | 2026-08-13 重启后确认有声 |
| #10 | tab4/5 改 CLI 会话面板 + 默认禁用虚拟显示器 | 2026-08-11 |

## C. 已去掉 / 不再跟踪

| # | 内容 | 原因 |
|---|---|---|
| #2 | 终端滚动修复 | 2026-08-13 用户确认:PageUp/PageDown 等按键可滚动,忽略 |
| #4 | app monitor 填满:backend.js openbox `--config→--config-file` | 已放弃虚拟显示器路线(appMonitor 不再启用),2026-08-12 |
| #11 | 开机 GRUB 报错 `file '/boot/' not found` | 装饰性,不影响引导 |
| #128 | 安装器 subiquity 崩溃 `load_autoinstall_data` | 不再跟踪 |
| #139 | 笔记本电量不显示(upower + sysfs 兜底) | 不再跟踪 |
| #140 | 电源键按下 → 电源菜单(非锁屏) | 不再跟踪 |
| #145 | Show disks 显示未挂载 U 盘 + 点击挂载 | 不再跟踪 |
| #163 | 解锁后光标消失(区分应用 vs 触摸板) | 不再跟踪 |
| #173 | 电池充电呼吸光效 | 不再跟踪 |
| #175 | 开机动画默认开启 | 不再跟踪 |

---

## 铁律

- 需要重启的修改:**先写交接文档 → 再推 GitHub → 最后才重启**,顺序不能反。
- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建。
- `sk-f4427cf72b6a406b9d6606571abfd3cc/` 是用户 API 目录,在 .gitignore 里——永不提交/删除/外泄。
- **不截图约定仅对非多模态 API 适用**(当前 deepseek 非多模态;若用多模态 API 则可截图)。排查优先读代码/DOM/日志/OCR 文本提取。
