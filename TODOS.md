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
| #2 | 终端滚动修复 | ⏳ | 历史遗留 |
| #4 | app monitor 填满:backend.js openbox `--config→--config-file` | ⏳ | **补丁已在链内**,只差打开 appMonitor 真机验证 |
| #7 | 内置 **BTOP**,显示在 APP 列表 | ⏳ | apt + `window.cliApps` 加 `{id:"btop",name:"BTOP",cmd:["btop"]}`;写进 install-edex.sh / seed |
| #8 | 内置 **AXEL**,替换设置里 UGET 菜单 | ⏳ | 设置菜单:URL + 线程(默认6) + 下载目录(可设);显示进度/速度/剩余;暂停/恢复。本质 CLI 可视化:`axel -n <线程> -o <目录> <URL>`。先定位现有 UGET 设置实现 |
| #9 | **CLASH** 设置增强 | ⏳ | 节点选择/测速/全局·规则·直连/规则配置。本质 GUI 写命令:Clash API(9090)或改 config.yaml + `kill -HUP`。先定位现有 CLASH 设置实现 |
| #10 | 内置 **FASTFETCH**(不进列表) | ⏳ | apt 安装,开机/欢迎信息显示系统信息 |
| #11 | 确保内置 **FFMPEG**(不进列表) | ⏳ | apt 安装,确认 `ffmpeg` 可用 |
| #12 | 超负荷时 **CPU型号 / MEMORY USING / NETWORK UP·DOWN** 文字红光闪烁(勿刺眼) | ⏳ | 三处文字按各自占用率阈值加 class + 柔和红色闪烁动画(mod_sysinfo.css / sysinfo widget) |

### A2. Ubuntu 侧(真机 / CI 打包侧)

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| #174 | Welcome back 用户名显示安装时填的名字(现显示 "edex") | ⏳ | **根因已确认**:getDisplayName 自缓存 `settings.username="edex"`(首启由登录名写入),edex GECOS 空,GECOS 分支用不上。修复方向:firstRun 向导加显示名 / OS 侧 `chfn` 写 GECOS + 清缓存 |
| #183 | 开机过渡:黑屏+原生鼠标光标 → 白屏 → eDEX UI | ⏳ | 白屏/原生光标过渡待处理;**不动开机动画/logo** |

---

## B. 已完成(追溯)

| # | 内容 | 何时 |
|---|---|---|
| #23 | 周期性 widget 重置后左右列消失 → 重建后补 reveal(animationPlayState=running) | 2026-08-12,见 FIX-RECORD-20260812-23fix-widget-reset.md,待重启部署 |
| #22 | CODE 屏保/锁屏渲染修复:cat pty 改 `stty raw -echo`(消除 `^[` 乱码/双行/空行)+ 覆盖层不透明背景(遮住真终端) | 2026-08-12,见 FIX-RECORD-20260812-22fix-lock-garble.md,待重启部署 |
| #20 | 锁屏/屏保改独立真实终端(engage ttyspawn 新建 cat pty,unlock/dismiss 销毁) | 2026-08-12,commit 7f2faa3,待重启部署 |
| #6 | 21fix TAB5 Browser w3m 裸启动秒退 → 配默认主页 | 2026-08-12,已合并进 20fix 产物 |
| #9 | 终端文本选择+复制 | 用户确认可用(2026-08-12) |
| #17 | CliPanel 无限递归 RangeError | 2026-08-12,已入补丁 |
| #18 | extraTtys 动态分配,取消 8 槽上限 | 2026-08-12,已入补丁 |
| #19 | tab1/tab2 统一成普通终端(EMPTY→TERM) | 2026-08-12,已入补丁 |
| #172 | WiFi 可用(netdev 组修复) | 2026-08-11 实测 |
| #181 | 熄屏 DPMS | 2026-08-11 实测通过 |
| #144 | 中文输入无候选框(fcitx5 dbus 抢占) | 2026-08-11 已修 |
| #10 | tab4/5 改 CLI 会话面板 + 默认禁用虚拟显示器 | 2026-08-11 |

## C. 已去掉 / 不再跟踪(2026-08-12 用户确认删除)

| # | 内容 | 原因 |
|---|---|---|
| #11 | 开机 GRUB 报错 `file '/boot/' not found` | 装饰性,不影响引导 |
| #128 | 安装器 subiquity 崩溃 `load_autoinstall_data` | 不再跟踪 |
| #139 | 笔记本电量不显示(upower + sysfs 兜底) | 不再跟踪 |
| #140 | 电源键按下 → 电源菜单(非锁屏) | 不再跟踪 |
| #145 | Show disks 显示未挂载 U 盘 + 点击挂载 | 不再跟踪 |
| #163 | 解锁后光标消失(区分应用 vs 触摸板) | 不再跟踪 |
| #173 | 电池充电呼吸光效 | 不再跟踪 |
| #175 | 开机动画默认开启 | 不再跟踪 |
| #182 | 开机终端自带两行 | 不再跟踪 |

---

## 铁律

- 需要重启的修改:**先写交接文档 → 再推 GitHub → 最后才重启**,顺序不能反。
- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建。
- `sk-f4427cf72b6a406b9d6606571abfd3cc/` 是用户 API 目录,在 .gitignore 里——永不提交/删除/外泄。
