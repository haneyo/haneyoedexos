# ⏸️ 工作交接文档 — 重启后从这里继续

> **最后更新**:2026-08-11 19:15(本会话追加 3.16/3.17 节,多任务进行中)
> **目的**:eDEX 重启会中断当前会话。重启后打开 Claude 先读本文件 + `ubuntu/README.md`,即可无缝续接。
> **目的**:eDEX 重启会中断当前会话。重启后打开 Claude 先读本文件 + `ubuntu/README.md`,即可无缝续接。

---

## 1. 项目位置

| 位置 | 说明 |
|---|---|
| **本机工作副本** | `/home/edex/edex-ubuntu-work/`(2026-08-11 从 U 盘 rsync 过来,已校验文件清单一致) |
| **U 盘源** | `/media/edex/EDEXWORK/edex-ubuntu-work/`(勿改,备份) |
| 项目性质 | eDEX-OS 发行版打包(改装 Ubuntu Server 24.04 → 可安装 ISO) |

**注意**:本机**就是真机验证目标机 ThinkPad E580**,装的是 **v2.3.11**。U 盘 `ubuntu/README.md` = 当前进度清单(Phase C)。

## 2. 本机已验证确认的状态(已确认,不用重做)

- ✅ eDEX v2.3.11 运行中(versions_log.json 确认),窗口名 `eDEX-UI`
- ✅ WiFi 已连接(wlp5s0,netdev 组在 → #172 修复生效)
- ✅ 时区 Asia/Shanghai + 时间已同步
- ✅ Xvfb :101/:102 已是 **1600x800(2:1)** → app monitor 填满修复(402a22b)已生效
- ✅ settings.json:`nointro:false`(开机动画默认开启)、lockCode 已设、language=zh
- ✅ 电池 100%、cpupower(linux-tools-common)、upower 已装
- ⚠️ 缺:rfkill、p7zip-full、bluez、fcitx5 系列包未装(dpkg 判缺;疑似此机非全新 ISO 装机)

## 3. 当前任务清单(Claude Task 列表)

| # | 任务 | 状态 |
|---|---|---|
| 1 | Phase C 验证:熄屏 DPMS(#181) | ✅ 实测通过:force off 在 -dpms 下仍生效(DPMSInfo=OFF);端到端触发受 screenOffIdle=18000s 限制 |
| 2 | Phase C 验证:app monitor 填满 + Firefox 真显示 | ✅ 已验证(**发现 bug**:backend.js openbox `--config` 应为 `--config-file`;Firefox 显示✓) |
| 3 | Phase C 验证:电池呼吸光效(#173) | 待验(需真正充电时目测;BAT0 现 99% Not charging) |
| 4 | Phase C 验证:开机动画默认开启(#175)→ **需重启**,重启后验证 | 待验(settings nointro:false 已确认) |
| 5 | 诊断 #174 用户名显示为 edex | ✅ 根因确认:getDisplayName 自缓存 settings.username="edex";GECOS 空。修复方向见 findings |

**发现 bug 汇总(2026-08-11)**:
1. **appmonitor openbox 参数**:`backend.js` 用 `--config`(非法)→ openbox 秒退无 WM → 应用不最大化。应为 `--config-file`。
2. **#174 用户名**:getDisplayName 首启自缓存 `settings.username="edex"`,GECOS 空 → 永远显示 edex。修复:firstRun 向导加显示名 / chfn 写 GECOS+清缓存。
3. **✅ 已修复:t.setAttribute is not a function(每次回车弹窗抢焦点)** —— **本次会话重点**。详见第 3.5 节。

详见 `ubuntu/PhaseC-findings-2026-08-11.md`。**注意:不要重启 monitor/eDEX 相关进程,否则 :102 的 WM 会消失。**

**关键 bug(2026-08-11 发现)**:`appmonitor/backend.js` 给 openbox 传 `--config`(非法参数,
应为 `--config-file`)→ 嵌套 openbox 秒退 → 无 WM → 应用窗口永不最大化。已在 :102 手动用
`--config-file` 启动 openbox(仍运行),Firefox 现已铺满 1600×800。修复在 App 侧 src,
详见 `ubuntu/PhaseC-findings-2026-08-11.md`。**注意:不要重启 monitor/eDEX 相关进程,否则 :102 的 WM 会消失。**

**用户已选方向**:先把项目拷到本机(✅ 完成)。下一步 = Phase C 真机验证。

## 3.5 ✅ 已修复:t.setAttribute is not a function(每次回车弹窗)

**症状**:每次在 Claude tab 发消息(或任何 Enter 键按下/抬起),都弹错误窗口
`TypeError: t.setAttribute is not a function` + `at keyboard.class.js 1:10502`,并抢走焦点。

**根因(已用 OCR + 代码分析证实)**:
- eDEX 的 `classes/keyboard.class.js` 在 `document.onkeydown/onkeyup` 里对 Enter 取
  `document.querySelectorAll("div.keyboard_key.keyboard_enter")`(NodeList)。
- 屏幕键盘层不存在时(showKeyboard 曾被开过→键盘装过、后关掉;但 `destroyKeyboard`
  **从不被调用**,document 级 handler 永驻)→ NodeList 为空 → `t.length?t.forEach():t.setAttribute()`
  走 else 分支,在空 NodeList 上 `setAttribute` → TypeError。
- 证据链:设置文件 mtime 10:22 < 本实例启动(8-10 22:50,mount 时间),说明启动时
  showKeyboard 可能为 true、键盘装过;后改成 false 但 handler 未摘。

**修复**(`packaging/patch-appimage.sh`,已接入 `build-iso.sh` 烘焙点):
- 把 keydown/keyup 两处 `(t.length?` 改为 `(t.forEach?`:
  - 空 NodeList → forEach 空转,安全;
  - 单个 Element → 无 forEach,仍走 setAttribute,行为不变。
- asar 用**就地追加补丁**(只改 keyboard.class.js 一个 entry,其余 2702 个条目 + 全部数据逐字节一致;
  已验证 2145 个打包文件仅 keyboard 有差异)。AppImage 用超块解析定位 squashfs(gzip/131072),
  重建后运行时仍能挂载(已验证 --appimage-extract 出补丁版)。

**部署状态(11:43 已更新为「三修复合一版」)**:
- ✅ 从原始备份重建,一次打入 3 个修复(keyboard + 天气弹窗字体 + 电池图标对准),
  替换 `/opt/edex/eDEX-UI.AppImage`(sha `0d193a5a…`,185019130 B)。
- ✅ 原版备份:`/opt/edex/eDEX-UI.AppImage.orig-20260811`(未动)。
- ⚠️ **生效需重启 eDEX**。当前运行实例仍用旧 inode/mount(Text file busy 已用 rename 绕过,不影响运行)。
- 临时产物(可复用/删):`/tmp/asar-src/`(解包+补丁后的 appdir)、`/tmp/dbg-wx/`(解包调试)、
  `/tmp/wxfont-test.AppImage`、`/tmp/final-test.AppImage`(三修复版验证产物)。

## 3.6 ✅ 已修复:天气弹窗字体与整体 UI 不一致

**症状**:点击天气(或 netstat 天气块)弹出的 WEATHER 弹窗,字体看起来跟整体 UI 不一样。
**根因**:`assets/css/modal.css` 里 `.mod_wx*` 规则全部用 `font-family:var(--font_mono)`
(Fira Mono,终端字体);整体 UI body 用 `var(--font_main)`(United Sans Medium)。
**修复**:`.mod_wx*` 内 mono 全改 `var(--font_main)`(9 处),其余 modal 的 6 处 mono 保留不动。

## 3.7 ✅ 已修复:电池图标外框与发光条不对准

**根因**:`_renderer.js` 电池 SVG — 外框 `rect x=1 w=25 rx=2`(圆角从 x=24 开始),
发光条 `x=3 w=23*s/100` → 满电时右端到 x=26,插进外框右圆角、条整体右偏 1 单位
(左内缩 2、右内缩 0)。
**修复**:`(23*s/100)` → `(21*s/100)`,条右端恰止于 x=24,与左圆角起点对称,条居中贴合外框内部。

## 3.8 ✅ 已修复:install-edex.sh 用户名检测误选残留 `edex`

**症状/根因**:装机时输入的用户名(如 `aki`)不是实际用户;`/etc/passwd` 里残留的
`edex`(uid 1000,GECOS 空,CI/旧脚本遗留)被 `awk 第一个 uid>=1000` 选中,
而 Subiquity 创建的真实用户 `aki`(uid 1001,在 adm/cdrom/dip/lxd/plugdev/sudo 组)落选。
**修复**(`packaging/install/install-edex.sh`):改为
1. 取 `adm` 组里 uid>=1000 的第一个成员(Subiquity 创建的用户必在 admin 组,残留用户不在);
2. 回落第一个 uid>=1000;
3. 再回落到原有"建 edex"默认路径。
本机实测:旧逻辑选 `edex`,新逻辑选 `aki`。⚠️ 只影响**未来装机**;本机现有账户改名需单独处理。
**用户决定(2026-08-11):本机暂不动**,保持 autologin=edex;以后要改再迁移。

## 3.9 ✅ 本机已修并部署:backend.js openbox 参数 + 修复4 抗卡顿(2026-08-11)

**纠正**:App 侧修复**不需要 Mac**——`packaging/patch-appimage.sh` 用 node 直改 asar,
本机即可完成。已把 backend.js 补丁加入该脚本,与修复4 一起打成新版并部署:

- **bug #1 openbox 参数**:backend.js `["--config",d,...]` → `["--config-file",d,...]`
  (全文唯一一处)。重启后 backend 会自动用 `--config-file` 拉起 :102 openbox,不再依赖手动 WM。
- **修复4 抗卡顿(#12)**:部件层周期重置(locationGlobe rAF 停止 + `_renderer.js` 末尾追加)。
- **部署**:`/opt/edex/eDEX-UI.AppImage` = sha `fb1bf494…`(185065032B)。
  备份:`eDEX-UI.AppImage.3fix-20260811`(上版 0d193a5a)、`eDEX-UI.AppImage.orig-20260811`(原始)。
- **生效需重启 eDEX**。

## 3.10 ✅ 已修复并部署(2026-08-11 下午):5 个新 bug 全修

**报告**:①天气弹窗被截断 ②Claude 终端无法滚动 ③Firefox tab link lost ④全屏 Firefox 回 eDEX 就锁屏(闲置几秒)⑤code 锁屏污染真终端。

**④的根因**(用户判断正确,非误触 Shift+O):Electron 窗口被全屏 Firefox occlude →
`visibilitychange→visible` → `resumeFromSuspend()` → **无条件 `lockScreen.engage()`** → 一回 eDEX 就锁屏。

**6 项修复**(全本机 patch 进 `packaging/patch-appimage.sh`,已部署新版 sha `bfda7b97…`,185051898B):
1. **锁屏误触发**:`resumeFromSuspend()` 与 `pm:suspend` 不再锁屏(只恢复 UI);idle 检测改用
   系统级 `powerMonitor.getSystemIdleTime`(主进程每秒推 `system-idle`)。锁屏只由 屏幕超时 /
   电源菜单锁屏按钮 / win+L 触发。
2. **锁屏快捷键**:`CommandOrControl+Shift+O` → `Super+L`(Windows 键 + L)。
3. **终端滚动**:xterm 开 `enableMouseEvents`(Claude Code/Ink 自动请求鼠标跟踪 → 滚轮转 SGR
   发给 pty);wheel handler 在 alt-screen buffer 时放行不拦截,normal buffer 照旧。
4. **link lost**:x11vnc 改用 `rfbPort+10`,加 `websockify` 桥接监听原 rfbPort 转发到 x11vnc,
   noVNC 的 ws 握手有 websockify 承接(系统已装 /usr/bin/websockify)。
5. **天气弹窗高度**:`.mod_wx_week` max-height 30vh→50vh(7 天预报不再截断)。
6. **code 锁屏虚拟终端**:不再拿真终端 term[0] 当画布(原实现截获 write/socket、`reset()` 真
   终端画虚假代码);改独立 xterm 放 lock_block 覆盖层全屏黑底显示,全局 keydown 捕获输入,
   真终端(Claude 会话)完全不碰,解锁后内容原样。

**部署**:`/opt/edex/eDEX-UI.AppImage` = `bfda7b97…`。备份:`eDEX-UI.AppImage.5fix-20260811`(上版 fb1bf494)、`.3fix-20260811`(0d193a5a)、`.orig-20260811`。已同步 U盘。

**⚠️ 重启前清理(重要)**:旧 x11vnc 仍占 5902 → 会阻止新 backend 的 websockify 绑定;手动
openbox(:102,PID 会变)会挡新 backend 的 openbox。重启 eDEX 前请执行:
`pkill -f x11vnc; pgrep -af 'openbox --config-file'`(杀掉手动 openbox)。Xvfb 可留(backend 复用)。

## 3.11 ✅ 已修复并部署(2026-08-11 傍晚):Claude 标签"选目录"与"启动 claude"同时进行

**报告**:Claude 标签打开时,目录选择器(claude-launcher)和 claude 启动同时进行,不再先选目录。

**根因**:`classes/terminal.class.js`(server 端)每次前端 WebSocket 连上时执行
`try{this.tty.write("\r")}catch(e){}` —— 给 pty 写一个裸回车(本意是刷新 bash 提示符)。
普通 shell 无害;但 claude 的 shell 是 `assets/misc/claude-launcher.js`(目录选择器),
`\r` → `select()` → 光标初始 **-1** → 立即 `launch(cwd)` → claude 直接启动。目录列表刚
render 就被 launch 清屏接管 → 看起来"选 cd 和启动 claude 同时发生"。

**修复**(`packaging/patch-appimage.sh`,2 处,均合并进既有 target):
1. `_boot.js` ttyspawn:`new Terminal({...,port:i})` → `{...,port:i,noBootCR:!!s}`
   (claude tab 时 `s="claude"===o&&r` 为真 → noBootCR=true)。
2. `terminal.class.js`:构造器加 `this._noBootCR=!!e.noBootCR`;wss 连接处
   `try{this.tty.write("\r")}catch(e){}` → `try{this._noBootCR||this.tty.write("\r")}catch(e){}`。
   普通终端 noBootCR=false,行为不变;claude 终端跳过 boot 回车,用户先选目录、Enter 才启动。

**部署**:`/opt/edex/eDEX-UI.AppImage` = sha `c0a0e541…`(185051898B)。备份:
`eDEX-UI.AppImage.8fix-20260811`(上版 bfda7b97)、`.5fix`、`.3fix`、`.orig`。已同步 U盘
(patch 脚本 sha `5348e718…`)。

**⚠️ 输入法候选字(#144)仍未解决**:fcitx5 系列包未装(task #6)。需联网
`sudo apt install fcitx5 fcitx5-chinese-addons` 等,并确认 eDEX/Xvfb 环境能显示候选窗。

## 3.12 ✅ 已修复并部署(2026-08-11 傍晚):eDEX 输入中文无候选窗(#144)

**根因**(实锤):fcitx5 其实已装(Mar 2024 随系统 bake,非 dpkg 包,所以 `dpkg -l` 查不到)。
但 `appmonitor/backend.js` 对每个虚拟屏(:101/:102)spawn `fcitx5 -d --replace`,
而 **fcitx5 的 dbus name `org.fcitx.Fcitx5` 是 per-session 单实例(不是 per-display)**。
主屏 :0 的 fcitx5(edex-session.sh 起的)被虚拟屏的 `--replace` 顶掉 → eDEX(:0)无
fcitx5 → 输入中文无候选窗(盲打)。
**证据**:唯一 fcitx5 实例的 DISPLAY=:102;journal 15:04 手动 `fcitx5 --replace` 注册
dbus name 时把 :102 同名实例也挤掉(dbup name 抢占行为实锤)。

**修复**(`packaging/patch-appimage.sh`,backend.js target 追加):删除虚拟屏的
`fcitx5 -d --replace` spawn(anchor:`const n=o("fcitx5",["-d","--replace"],...`);
GTK_IM_MODULE env 保留,虚拟屏应用仍可连主屏 fcitx5 输入)。主屏 :0 fcitx5 独占
dbus name,候选窗正常显示。**已即时拉起**:`DISPLAY=:0 fcitx5 -d --replace`(pid 3484326,
持有 org.fcitx.Fcitx5),**无需重启当前会话即已生效**。

**部署**:`/opt/edex/eDEX-UI.AppImage` = sha `18b39bbd…`(185051898B,10 修复版)。
备份:`.9fix-20260811`(上版 c0a0e541)、`.8fix`、`.5fix`、`.3fix`、`.orig`。patch 脚本已同步
U盘(sha `648b5639…`)。重启后 edex-session.sh 会照常起 :0 fcitx5,backend 不再抢。

## 3.13 ⚠️ 鼠标消失/指针锁死(2026-08-11,重启解决)

**报告**:鼠标光标不见了,无法点击 eDEX 的重启按钮。

**诊断结论**:
- 物理鼠标设备全在(Compx 2.4G 接收器 id=12 / Synaptics 触摸板 id=13 / TrackPoint id=14),**不是硬件**。
- 指针被 **X 层锁死在 (1130,352)**:`xdotool mousemove` 5 次(含四角)后 `getmouselocation` 全不变。
  fcitx5 杀了、D-Bus 激活禁了,指针仍锁 → **不是输入法/候选窗干的**。
- **真凶**:主渲染进程(旧版 14:10 启动)CPU 空转 **79%**——locationGlobe 的 rAF 动画循环没停的
  老 bug,正是**修复 #12「部件层周期重置」修的那个**。渲染进程空转 → mousemove 事件不处理 →
  自绘光标不动、点击无响应;而系统光标被 eDEX 用 CSS `cursor:none` 隐藏 → 看起来"鼠标没了"。
- 结论:**重启加载 10 修复版即根治**。lightdm autologin=edex 已确认,杀 eDEX 会自动拉起新会话。

**用户提议的加固方向(未做,可后续)**:把系统光标直接替换成自绘光标(去 CSS `cursor:none` +
自定义 Xcursor 主题),这样即使渲染进程卡死,光标也由 X 服务器渲染、始终可见可点。

## 3.14 ✅ 输入法候选框 UI 对齐 eDEX 风格(2026-08-11,已应用待实测)

用户要求候选框风格与 eDEX UI 一致:**黑底、无边框、主题色文字、主题字体、通用主题**(不绑死某种颜色)。

**定制 fcitx5(5.1.7,eDEX bake)的关键限制**(strace 实锤):
- `libclassicui.so` 只识别 `NormalColor / HighlightColor / HighlightBackgroundColor /
  BorderColor / BorderWidth / PerScreenDPI / UseDarkTheme`。`Theme / DarkTheme / Font /
  NormalBackgroundColor / SpellHintColor / ShadowColor` 会被忽略。
- fcitx5 **始终加载 `default` 主题**;搜索顺序 XDG_DATA_DIRS,`/usr/share/edex/fcitx5/themes/`
  优先 → 把 eDEX 版 default 主题放到这里即可全局生效。

**当前生效配置**:
- `/usr/share/edex/fcitx5/themes/default/theme.conf`(sudo):黑底 `#000000`、`BorderWidth=0`、
  `Opacity=1`、`Font=Fira Mono 14`、高亮块=主题主色、NormalColor=主色。
- `~/.config/fcitx5/conf/classicui.conf`:仅受支持键,`NormalColor=#aacfd1 HighlightColor=#000000
  HighlightBackgroundColor=#aacfd1 UseDarkTheme=False PerScreenDPI=False`。
- **同步脚本** `packaging/fcitx5-theme/sync-fcitx5-theme.sh`:读 settings.json 当前主题 →
  解析 themes/<theme>.json(r/g/b/black/terminal.fontFamily)→ 同时更新上述两个文件 → `fcitx5-remote -r`。
  **在 eDEX 里切换主题后跑一次即自动跟随**(也可配 inotify)。
- ✅ 已验证(2026-08-11):strace 确认 fcitx5 读取 `/usr/share/edex/.../default/theme.conf`(openat 返 8)
  和 classicui.conf;脚本运行后经典主题/tron 应用成功。
- ⚠️ **真机目测待用户确认**:测试环境全屏 eDEX 抢焦点,候选窗弹出位置不稳定,无法自动截图验证。
  需用户进 eDEX 终端 tab 切中文输入法,打拼音看候选窗是否黑底无边框+主题色。

**将来做**:自动跟随(eDEX 设置里切主题 → inotifywait 监听 settings.json → 跑 sync 脚本)。

## 3.15 ✅ globe 动画空转 → 鼠标消失/卡顿(2026-08-11 下午,10 修复版仍复现;已修 11 修复版)

**报告**:鼠标又不见了(同 3.13),渲染进程主线程实时 **63% CPU**,load 6.28,界面卡顿。

**根因**(实锤,代码级):
- `locationGlobe.class.js` 的 `_animate` 是 **30fps rAF 递归循环,永不停**:
  `this._animate=()=>{...globe.tick()...,window.mods.globe._animate&&!this._dead&&setTimeout(()=>{try{requestAnimationFrame(window.mods.globe._animate)}catch(e){}},1e3/30)}`
- 修复 #12(3.13)加的 `!this._dead` 守卫是**死的**:全 app 只有一处设置 `_dead=!0`,在
  `_edexWidgetReset`(periodicResetMinutes,默认 90 分钟,且**仅在用户完全空闲≥1 分钟时**才执行)。
  用户活跃使用 eDEX → `_edexWatch` 永远 return → 重置永不触发 → globe 永不停止。
- 3.13 重启"解决"是因为那次 eDEX 曾空闲触发了重置;活跃使用后 globe 又满速转回来。
- 主线程被 30fps 3D 渲染占满 → 不处理输入事件 → eDEX 自绘光标(CSS `cursor:none` 藏了系统
  光标)不动 = "鼠标没了"。GPU 进程 0%(纯 JS/渲染 CPU 忙)。

**修复**(12 修复版,最终方案):**不降帧**(用户否决降帧:动画变慢不值),保持 **30fps 流畅**;
注入 **随机 3/4/5 分钟无感重置**:清掉 globe 累积的 pins/markers/conns(用 ENCOM globe 现成的
`removePins`/`removeMarkers`),只重加本地定位点(`_locPin`/`_locMarker`,视觉不变)。随机间隔
`[18e4,24e4,3e5]` 避免固定节奏被察觉。只清数据不重建实例,无闪断。
- 补充确认:**cyberPanel(雷达/data stream)已自限不累积**——`radarPulses` 动画结束自动
  `filter` 移除、`radarBlips>24 && shift()`、`_logQueue>14 && splice`;marker 4s 自动清。
  **真正累积源是 globe 的 pin**(`addTemporaryConnectedMarker` 只加不清,直到位置变化/offline)。
  故只需重置 globe,cyberPanel 无需动。
- 再确认 **CPU/MEM/NET 实时小组件也自限、无需动**(2026-08-11 复检):
  - `cpuinfo.class.js`(CPU 图):smoothie 每次渲染 `dropOldData` 剪掉滚出画布左缘的旧点
    (默认 `maxDataSetLength:2`),数据数组≈一个画布窗口(~20s),`streamTo` 500ms + `limitFPS:30`,
    非 rAF 死循环。
  - `ramwatcher.class.js`(内存):固定 440 个点 div,1.5s 原地改 class + innerText,无增长。
  - `netstat.class.js`(网络/天气):实时值 innerText 覆盖;唯一增长是 GeoLookup 的 Map
    (按公网 IP 键,仅几个),`failedAttempts` 按 URL 键,均极小。
  - `toplist.class.js`(进程):`innerHTML=` 整体覆盖,无 appendChild 增长。
  → 全 app 唯一"只加不清"的是 globe pin,12 版重置已覆盖全部累积源。

**⚠️ 重启后首次观察(2026-08-11 15:38,需复测,勿下结论)**:
`pkill` 后 lightdm 确实重登拉起新实例(新 PID,12 版 sha `b8db42bd` 在跑),但**渲染进程仍满
~96-106%**,且 **GPU 进程 ~74%**(原报告 GPU 是 0%)。原因未明,候选:
① 重启后 3-5 分钟重置未触发,globe pin 快速累积(每 3s 一个 `_addRandomActivity`),30fps 绘制
   成本随 pin 数上涨 → 需要看重置触发后 CPU 是否掉下来;
② 本 Claude 会话存活并重连到新实例,终端在持续渲染本会话输出(采样时 claude 进程 33%);
③ 启动负载(天气/各 widget/字体)未完全落;
④ GPU 74% 是新差异——可能渲染器换用了 GPU 合成,或卫星/globe 走 WebGL。
**手动重启后要做的**:新会话里用干净状态测——启动后第 1 分钟、第 4 分钟(重置前)、第 6 分钟
(重置后)分别采样渲染进程 CPU(用 `/proc/<pid>/stat` 5s 差值),看是否呈"爬升→重置回落"锯齿;
同时 `ps -eo pcpu,pid,comm | sort` 看 GPU 进程占比是否回落。
**若仍满 CPU**:给 globe 动画降频(用户否决过 8fps,但可试 20fps=`1e3/20` 视觉几乎无感),或
考虑 `_addRandomActivity` 的 3s pin 间隔改为更长(如 15s),从源头减 pin 累积速度。
- 修改在 `packaging/patch-appimage.sh` 的 locationGlobe target(**合并**,不能新建 target 会覆盖;
  带 `!this._dead` 守卫保持)。11 修复版(8fps,`1e3/8`)→ 12 版:`1e3/8`→`1e3/30` 恢复 + 注入
  `RESET_JS`(`_resetGlobe`,随机 3-5 分钟)。`expectOut` 改 `_resetGlobe` 保持幂等。
- 部署:`/opt/edex/eDEX-UI.AppImage` = **12 修复版 sha1 `b8db42bd`(185055881B)**;
  备份 `.11fix-20260811`(3dd03149,8fps 临时版)、`.10fix-20260811`(9ee24297)。
  verified:asar 里 `1e3/30` ✓ / `1e3/8` ✗ / `!this._dead` ✓ / `_resetGlobe` ✓ / `18e4` ✓。
- ⚠️ **重启会断当前 Claude 会话**(Claude 正跑在 eDEX 终端 tab 里,属 edex-ui 渲染进程后代)。
  因此重启前须把本交接文档写好;重启后开新 Claude 会话继续。
- ⚠️ 若重启后仍卡(cyberPanel 等固定 60fps 渲染开销):可给 cyberPanel 雷达降频
  (每 2 帧渲染一次=30fps,视觉无感),或光标改系统 Xcursor(去 CSS `cursor:none` + 自定义
  Xcursor 主题,渲染卡死时光标也可见,3.13 用户提议过的方向)。

## 3.16 ✅ 开机动画无音效 — 根因已修复(rtkit/RealtimeKit 超时,2026-08-11 晚)

**报告**:开机动画(logo 出现、boot log 滚动、主题音乐)没有音效,不像原版 eDEX-UI。

**根因(实锤,证据链完整)**:
1. 系统音频本身正常(paplay/aplay 成功、monitor 有信号、终端输出触发 stdout.wav 有声音事件)。
2. 但**开机前 ~6 秒的 intro 无声**:Chromium 音频服务在开机时连 pulse 失败
   (`ALSA lib pulse.c pulse_connect: Connection refused`)。
3. **为什么 pulse 没就绪**:`pulseaudio.service`(systemd user,`Type=notify`)每次开机都
   **51-76s 才 Started**(journal 多日记录:10:14→10:15:25、14:10→14:12、16:41→16:43、18:16:30→18:17:46)。
   51s=2 次、76s=3 次 × **25s 超时**(journal:`Failed to activate org.freedesktop.RealtimeKit1:
   timed out (service_start_timeout=25000ms)`)。
4. **RealtimeKit 为何激活超时**:`rtkit-daemon.service` 失败退出
   (`Failed to find user 'rtkit'`)——系统里**没有 `rtkit` 用户**(rtkit 包是被其它包拉进来的依赖,
   postinst 建用户这步丢了/被删)。daemon 起不来 → D-Bus 名字无人持有 → 所有激活请求等 25s 超时。

**修复(本机已应用 + 部署脚本已更新)**:
- 本机:创建 rtkit 系统用户 → `systemctl enable rtkit-daemon` → 重启 pulse 实测
  **从 76s → 0.34s**(systemd 67ms 即 active)。`org.freedesktop.RealtimeKit1` NameHasOwner=true。
- 部署(`packaging/`):
  - `build-iso.sh`:`rtkit` 加入 APTOPTS 包列表(pulseaudio 旁)。
  - `install/install-edex.sh`:netdev 段后新增 idempotent rtkit 段(建用户/组 + /var/lib/rtkit 属主 + enable 服务)。
- 时序:rtkit 在 multi-user.target 起(早于 lightdm)→ 用户会话 pulse 调用 RealtimeKit 立即成功 →
  pulse 开机 ~0.3s 就绪 → intro(~6s)音频服务连 pulse 成功 → **开机音效恢复**。

**⚠️ 待重启验证**:重启后听 intro 是否有音效。若仍无声,再查 intro 时机(动画开始即播放,
音频服务首次开设备若仍在 pulse 就绪前,可加"theme 音效重试"兜底)。

**⚠️ 当前会话副作用(测试导致)**:验证时我重启了 pulse 并杀掉了 Chromium 音频服务
(`kill 1498`),当前会话 app 音效可能失效(音频服务会按需重生,但需真实 renderer 音频请求才触发;
xdotool 输入进了 Claude 标签没触发到 eDEX 终端)。**重启后即恢复,无需处理。**

## 3.17 ✅ 已完成(2026-08-11 晚,本会话任务 #3-#9,构建 16fix)

本会话在原有 5 任务基础上新增 4 个用户需求,已全部实现并打包进 **16fix**:
- **#3 tab4/5 默认 Firefox → 应用列表**(apps 态,只列用户装的 UI 应用,不含 Firefox;clash 加 webapp 管理入口)
- **#4 设置菜单加 SSH 开关**(能真正启停 sshd)
- **#5 全系统剪贴板**(Firefox 复制 → eDEX 终端/Claude 粘贴)
- **#6 消除开机黑屏+白闪**(进开机动画前两段突兀画面)
- **#7 系统默认光标 → eDEX 风格**
- **#8 去除开机(电源)Ubuntu logo**(grub/plymouth)
- **#9 终端/Claude 停止输出时播放完成音效**(提示用户输出结束/等待确认)
- 另有已构建待重启的 **13fix(光标策略)**:UI 态常显;锁屏/屏保态闲置自动隐藏、动鼠标恢复。

**16fix**(`/opt/edex/eDEX-UI.AppImage.16fix-20260811`,185068282B) = orig + 全部补丁,已提取验证:
backend.js(桥+光标)/terminal.class.js(#9)都通过 node --check,各 marker 全部命中。**尚未部署/重启**。

**本会话系统侧改动(已 live 生效)**:xclip 已装;update-alternatives x-cursor-theme → edex;
gsettings cursor-theme=edex;`/usr/local/bin/edex-clipboard-bridge.sh` 已装并双向实测通过。

**打包持久化已同步**:build-iso.sh APTOPTS +xclip;nocloud 新增 `edex-cursor`(packaging/cursor/edex)
与 `edex-clipboard-bridge.sh`(packaging/install/);install-edex.sh 装光标主题并设 update-alternatives、
装桥脚本、XCURSOR_THEME=edex(会话期导出)。

**待办**:统一重启 eDEX(见 §4),16fix 部署到 `/opt/edex/eDEX-UI.AppImage` 后验证 #3/#5/#7/#9。

## 4. 重启后如何继续

1. 启动 Claude,读 `/home/edex/edex-ubuntu-work/CONTINUE.md` + `ubuntu/README.md`
2. 若 eDEX 刚重启 → **先验证 globe 卡顿修复(3.15)**:用 `ps -eo pid,pcpu,comm --sort=-pcpu | grep edex-ui`
   看渲染进程 CPU 应**显著低于 63%**(恢复 30fps + 靠 3-5 分钟无感重置清累积,数值应明显回落),
   鼠标可正常移动、不再锁死,界面不卡(用几分钟后看 CPU 是否维持低位,验证重置生效)。
   → 再看三个 UI 修复(3.5/3.6/3.7):① Claude tab 发条消息不再弹 t.setAttribute;② 天气弹窗
   字体是 United Sans;③ 电池图标满电发光条不外偏。→ 再**优先做任务 #4**:确认开机动画(nointro:false)。
3. 然后按 `ubuntu/README.md`「v2.3.11 之后要做」清单逐项验证:
   - DPMS 熄屏(#181):闲置 30s → 屏灭;动鼠标 → 亮。
   - tab4/5 选 Firefox → 画面填满无黑框、Firefox 真启动。
   - 插电 → 电池图标呼吸(#173)。
4. 诊断 #174:开机 Welcome back 仍显示 "edex"。
   - 根因推测:登录用户就是 `edex`(GECOS=edex),`getDisplayName` 的 GECOS 优先失效。
   - 排查:`getent passwd edex`(看 GECOS)、装机时用户填的名字在哪。
   - 修复方向(App 侧,Mac 上有 src):首启向导 firstRun.class.js 让用户输入显示名 → 写 settings.json → getDisplayName 优先读它。

## 5. 安全注意

- Aliyun OSS bucket/URL 永不进公开文档/日志
- AccessKey Secret 永不粘贴到聊天

## 6. 附:本机截图工具

- `DISPLAY=:0 scrot -z /tmp/xxx.png` 可截 eDEX 全屏(1920x1080)
- 截图 Read 不了时先缩小:`python3 -c "from PIL import Image; Image.open(p).resize((960,540)).save('/tmp/small.png')"`

---

## 7. ⚠️ 2026-08-11 晚:UI 无法启动事故 & 12fix 修正版(必读)

### 发生了什么
3.15 节的 fix-12(RESET_JS 注入)当时把重置逻辑注进了 `locationGlobe.class.js` 的 **class 类体内**
(构造器 `},4e3)}` 与方法 `_addRandomActivity(){` 之间)。JS 类体只允许方法/字段/分号,不允许
`const`/IIFE 语句 → `SyntaxError: Unexpected identifier` → renderer 加载该模块即崩 → **eDEX UI 无法启动**。
故障版 sha256 `7dbe8aeb…`(185055881B)。用户用 U 盘 `fix-edex.sh` 一键恢复(换回 `.orig`)才活过来。

### 修正(已重建 12fix,sha256 `7850fff8…`,185055881B)
- `packaging/patch-appimage.sh` 修复 12 target:**锚点从类体内改为文件尾** `module.exports={LocationGlobe};`,
  RESET_JS 改为**模块级 IIFE**(每次查 `window.mods.globe` 单例,随机 3/4/5 分钟清 pins/markers/conns,
  重加 `_locPin/_locMarker`,保持 30fps)。幂等标记 `expectOut` 改为 `__edexGlobeReset`。
- 已对 12fix 全量验证:7 个 patch 文件 `node --check` 全过;非 node_modules/vendor 的 app JS 全过;
  用户关心的修复(candidate window/Claude 滚动/性能/锁屏/天气弹窗)逐项断言在位。
- 12fix 相对 11fix 的差异只有 globe 一个文件:8fps→30fps + 文件尾无感重置 IIFE。

### 部署(当前 /opt/edex/eDEX-UI.AppImage = .orig,已由恢复脚本换回)
```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage || true
sudo cp <12fix> /opt/edex/eDEX-UI.AppImage && sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```
部署后再验证:candidate window(#144)、Claude 滚动、性能、开机音效(音效链路已查健康,若仍无声属
动画时机/音频层问题,另立 issue)。

### 以后改 App 的纪律(重要)
1. **任何注入点**都必须 `node --check` 校验后再部署——类体内禁 const/IIFE,只在模块作用域或字段里写。
2. 改完 `patch-appimage.sh` 后:用 `artifacts/eDEX-UI.AppImage.11fix-20260811` 重建 → 校验 → 部署,
   **不要**从损坏版上改。
3. 每次新版本:U 盘 `artifacts/` 存一份 + 更新本文件 + `FIX-RECORD-20260811-12fix.md`。

## 3.18 ✅ 已完成(2026-08-11 晚,本会话 4 项 UI 需求,已构建 17fix)

用户新报 4 个问题,全部修复并打包进 **17fix**(`packaging/patch-appimage.sh` 新增 3 个 target + 改 1 个常量):
- **#1 tab4/5 两个网页(Google/Bing)不是用户加的,删除**:本机 `~/.config/eDEX-UI/settings.json` 的
  `webapps` 已清空(已备份 .bak-20260811);`packaging/install/install-edex.sh` 默认 `webapps` 也改为 `[]`。
- **#2 应用列表不显示系统内置 Firefox**:`appmonitorPanel.class.js` 的 native 过滤恢复 `native:` 前缀
  (AM_FILTER_NEW 加 `||"native:"===String(e.id).slice(0,7)`)→ Firefox 回到列表。
  **用户原则:只有有 UI 的应用才显示。** 故同时给 `appmonitor/native-apps.js` 的 SYSTEM_APP_RE 补漏
  (`im-config|kbd-layout-viewer5|x11vnc`),滤掉 Input Method / Keyboard layout viewer / X11VNC Server
  三个非 UI 系统工具。列表最终=Firefox、uGet(皆有 UI)+ AppImage/webapp。
- **#3 top processes 数字太靠右/不协调**:`mod_toplist.css` NAME 列 `7vw→5vw`(缩短)+ 新增 PID 列定宽
  `4.2vw`(防 auto 列吸走多余空间),CPU/MEM 保持右对齐 → 表格紧凑、数字位置整齐。
- **#4 左上 LOAD/UPTIME/TYPE/POWER 的 POWER 字母 r 被裁掉一半**:`mod_sysinfo.css` 四个子列改
  `flex:1 1 0;min-width:0`(等宽均分、永不溢出)+ 收紧水平内边距 `.46vh→.25vh`。

**17fix**(`/tmp/edex-17fix/eDEX-UI.AppImage.17fix`,185072378B)= orig + 全部 15 个 patch,已全量验证:
10 个 patch JS `node --check` 全过;15 个 marker 全命中(native: filter / x11vnc / 5vw / flex:1 1 0 等)。
比对 16fix 只多了 native-apps.js + 两个 CSS + appmonitorPanel 过滤变化。

**⚠️ 当前有两个 eDEX 实例**:1372(18:16,旧版)与 3483184(22:05,16fix)同时在 :0。重启时需
`pkill -f eDEX-UI.AppImage` 全部杀掉,lightdm autologin=edex 会拉起新实例。

**待办**:部署 17fix 到 `/opt/edex/eDEX-UI.AppImage` + 重启后验证:①tab4/5 无 Google/Bing、含 Firefox;
②Firefox 可启动铺满;③top processes 数字整齐;④sysinfo POWER 不裁切。

## 4. 重启后如何继续

1. 启动 Claude,读 `/home/edex/edex-ubuntu-work/CONTINUE.md` + `ubuntu/README.md`
2. 若 eDEX 刚重启 → **先验证 globe 卡顿修复(3.15)**:用 `ps -eo pid,pcpu,comm --sort=-pcpu | grep edex-ui`
   看渲染进程 CPU 应**显著低于 63%**(恢复 30fps + 靠 3-5 分钟无感重置清累积,数值应明显回落),
   鼠标可正常移动、不再锁死,界面不卡(用几分钟后看 CPU 是否维持低位,验证重置生效)。
   → 再看三个 UI 修复(3.5/3.6/3.7):① Claude tab 发条消息不再弹 t.setAttribute;② 天气弹窗
   字体是 United Sans;③ 电池图标满电发光条不外偏。→ 再**优先做任务 #4**:确认开机动画(nointro:false)。
3. 然后按 `ubuntu/README.md`「v2.3.11 之后要做」清单逐项验证:
   - DPMS 熄屏(#181):闲置 30s → 屏灭;动鼠标 → 亮。
   - tab4/5 选 Firefox → 画面填满无黑框、Firefox 真启动。
   - 插电 → 电池图标呼吸(#173)。
4. 诊断 #174:开机 Welcome back 仍显示 "edex"。
   - 根因推测:登录用户就是 `edex`(GECOS=edex),`getDisplayName` 的 GECOS 优先失效。
   - 排查:`getent passwd edex`(看 GECOS)、装机时用户填的名字在哪。
   - 修复方向(App 侧,Mac 上有 src):首启向导 firstRun.class.js 让用户输入显示名 → 写 settings.json → getDisplayName 优先读它。

## 5. 安全注意

- Aliyun OSS bucket/URL 永不进公开文档/日志
- AccessKey Secret 永不粘贴到聊天

## 6. 附:本机截图工具

- `DISPLAY=:0 scrot -z /tmp/xxx.png` 可截 eDEX 全屏(1920x1080)
- 截图 Read 不了时先缩小:`python3 -c "from PIL import Image; Image.open(p).resize((960,540)).save('/tmp/small.png')"`

---

## 7. ⚠️ 2026-08-11 晚:UI 无法启动事故 & 12fix 修正版(必读)

### 发生了什么
3.15 节的 fix-12(RESET_JS 注入)当时把重置逻辑注进了 `locationGlobe.class.js` 的 **class 类体内**
(构造器 `},4e3)}` 与方法 `_addRandomActivity(){` 之间)。JS 类体只允许方法/字段/分号,不允许
`const`/IIFE 语句 → `SyntaxError: Unexpected identifier` → renderer 加载该模块即崩 → **eDEX UI 无法启动**。
故障版 sha256 `7dbe8aeb…`(185055881B)。用户用 U 盘 `fix-edex.sh` 一键恢复(换回 `.orig`)才活过来。

### 修正(已重建 12fix,sha256 `7850fff8…`,185055881B)
- `packaging/patch-appimage.sh` 修复 12 target:**锚点从类体内改为文件尾** `module.exports={LocationGlobe};`,
  RESET_JS 改为**模块级 IIFE**(每次查 `window.mods.globe` 单例,随机 3/4/5 分钟清 pins/markers/conns,
  重加 `_locPin/_locMarker`,保持 30fps)。幂等标记 `expectOut` 改为 `__edexGlobeReset`。
- 已对 12fix 全量验证:7 个 patch 文件 `node --check` 全过;非 node_modules/vendor 的 app JS 全过;
  用户关心的修复(candidate window/Claude 滚动/性能/锁屏/天气弹窗)逐项断言在位。
- 12fix 相对 11fix 的差异只有 globe 一个文件:8fps→30fps + 文件尾无感重置 IIFE。

### 部署(当前 /opt/edex/eDEX-UI.AppImage = .orig,已由恢复脚本换回)
```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage || true
sudo cp <12fix> /opt/edex/eDEX-UI.AppImage && sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```
部署后再验证:candidate window(#144)、Claude 滚动、性能、开机音效(音效链路已查健康,若仍无声属
动画时机/音频层问题,另立 issue)。

### 以后改 App 的纪律(重要)
1. **任何注入点**都必须 `node --check` 校验后再部署——类体内禁 const/IIFE,只在模块作用域或字段里写。
2. 改完 `patch-appimage.sh` 后:用 `artifacts/eDEX-UI.AppImage.11fix-20260811` 重建 → 校验 → 部署,
   **不要**从损坏版上改。
3. 每次新版本:U 盘 `artifacts/` 存一份 + 更新本文件 + `FIX-RECORD-20260811-12fix.md`。
