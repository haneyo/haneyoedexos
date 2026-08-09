# eDEX-OS v2.2.9 真机首启问题清单

> 2026-08-07 首台真机(ThinkPad E580)装到能进 eDEX UI 后收集。装完应只看到 eDEX 全屏壳。

**里程碑已达成**:ISO 能装完、lightdm 修复后能进图形壳。以下为打磨项,按修复位置分两类:

- **OS 侧**(install-edex.sh / build-iso.sh / 配置文件,重装生效)
- **App 侧**(edex-ui 源码 → 重打 AppImage → 重打 ISO 生效)

| # | 问题 | 侧 | 状态 |
|---|------|----|------|
| 1 | 开机 GRUB 报 `error: file '/boot/' not found`(不影响引导) | OS/ISO | 已定位:Ubuntu 签名 grubx64.efi 内嵌配置所致,装饰性,暂不改(详见 ubuntu-side-changes.md §4) |
| 2 | 首启向导中文变方块字,要求改英文界面 | OS | v2.3.5 起向导整个换成**应用内** code 锁屏风格(英文,类 firstRun.class.js),xterm 向导已删(见 ubuntu-side-changes.md §9) |
| 3 | 搜不到 WiFi | OS(需真机诊断) | 已修(源码,待装验):netplan 双 renderer 冲突 + 关 wifi 电源管理(见 ubuntu-side-changes.md §2);设置菜单已加网络分类(连接/断开/已保存/代理/蓝牙),依赖 nmcli + bluetoothctl |
| 4 | 系统时间不对:需要时区 + 手动改时间 + 联网同步功能 | OS + App | App 已修(源码,待装验):设置加时间分类(实时状态/时区/手动设时间/联网同步 IPC);OS 侧需装验 |
| 5 | 语音输入按钮按下后卡死(变灰不可再点),无语音 UI | App | 已定位+已修(打包,待装验):灰 = voice:init 返回失败 = 缺 sherpa-onnx 离线 ASR 模型(旧 ISO 未烘焙模型到 /opt/edex/models);新 ISO build-iso.sh 已烘焙(带重试),路径与 _boot.js voiceModelDirs() 匹配 |
| 6 | 输入法切换无反应,一直 EN | OS | 已修(源码,待装验):fcitx5-rime 已内置 + 写 fcitx5 profile(keyboard-us 默认 + rime 中文,Ctrl+Space 切换,见 ubuntu-side-changes.md §3) |
| 7 | 文件浏览器默认标签连不上(XDG 目录不存在) | OS | 已修(源码,待装验) |
| 8 | 设置-通用-用户名显示 `undefined` | App | 已修(源码,待装验):v2.3.5 起 `getDisplayName()` 优先 GECOS `os.userInfo().realname`(安装时 "Your name" 写入的全名) |
| 9 | 默认跳过启动动画,要恢复 | OS | 已修(源码,待装验):install-edex.sh 配 quiet splash + update-initramfs/grub(见 ubuntu-side-changes.md §1) |
| 10 | 虚拟显示器(tab 4/5)黑屏,无 app 画面 | App | 已修(源码,待装验) |
| 11 | app 列表混入 google/bing/uxterm/fcitx5,只应显示用户应用;且要能在设置里配置(设置项可执行命令行) | App + seed | 已修过滤(源码,待装验);设置项未加 |
| 12 | 打开 tab 4/5 列表后锁屏,code 模式下列表不消失 | App | 已修(源码,待装验) |
| 13 | 终端第一个 tab 有时无响应、打不了字 | App | 已修(源码,待装验) |
| 14 | 终端打字后报 `TypeError: t.setAttribute is not a function`(与 #13 可能同源) | App | 已修(源码,待装验) |
| 15 | 键盘背光灯不亮、触摸板点击无效;设置菜单要加相关项(可执行命令) | OS + App | App 设置项已加(性能分类:背光 关/低/高、轻触点按 开/关,待装验);OS 侧 boot 已默认背光高亮(edex-session.sh) |
| 16 | 电源菜单加"启动屏保"按钮:立即锁屏,解除需输 PIN | App | 已完成(重设计:Lock Screen=先屏保再锁屏,移除屏保按钮) |
| 17 | 鼠标光标不够科幻,与 UI 不搭 | App + OS | 已修(源码,待装验) |
| 18 | code 模式屏保代码重复,需修正 | App | 已修(源码,待装验) |
| 19 | code 锁屏解除后,假代码留在终端里 | App | 已修(源码,待装验) |
| 20 | 笔记本电量不显示;在时钟左上角加电量指示(不改布局) | App | 已修(源码,待装验) |
| 21 | 终端内容过长时支持鼠标滚轮 / 方向键 / 滑动上下滚动;滚动速度/方向也要可设置 | App | 已修(源码,待装验) |
| 22 | matrix 锁屏解锁后先闪真实 UI 再播启动动画;应先播动画再显示 UI | App | 已修(源码,待装验) |
| 23 | 光标自动隐藏:屏保/锁屏时隐藏,移动显示,静置(如 10s)后隐藏;可设置 | App | 已修(源码,待装验) |
| 24 | 笔记本合盖不锁屏(即使设了密码):合盖应挂起,恢复后弹锁屏 | OS + App | 已修(源码,待装验) |
| 25 | 合盖再打开后鼠标点不到任何东西(挂起/恢复后点击全失效,只能重启);恢复时应强制清理屏保/锁屏全屏遮罩、重置光标与全屏窗口 | App + OS | 已修(源码,待装验) |
| 26 | 需要 Win+L 锁屏快捷键(等价电源菜单 Lock Screen:先屏保再锁屏) | App | 已修(源码,待装验) |
| 27 | 风扇一直高速转:UI 里加嵌入式性能控制器(省电/平衡/性能档,走 cpupower governor),省电档可让风扇安静 | OS + App | 已修(源码,待装验) |
| 28 | 首次启动向导要能选择时区(默认 Asia/Shanghai) | OS | 已修(源码,待装验) |
| 29 | 设置里要能调亮度和音量;Fn 键(亮度/音量/静音等)都应可用(OS 侧 acpi_backlight/键盘驱动 + App 侧滑块与快捷键) | OS + App | 已修(源码,待装验) |
| 30 | 光标改为简洁的 45°"<" 造型,颜色跟随主题色并带荧光效果(呼应 UI) | App | 已修(源码,待装验) |
| 31 | 开机先进锁屏界面,输密码后才显示 UI(设置过锁屏密码时生效) | App | 已修(源码,待装验) |
| 32 | 内置下载管理器:接管 Firefox/Chrome 下载,支持网页管理/命令行,设置菜单里自绘 UI 管理 | OS + App | 待做 |
| 33 | 内置 clash 代理程序(命令行版),浏览器管理 | OS + App | 待做 |
| 34 | 所有内置程序都要支持更新 | OS + App | 待做 |
| 35 | 内置 7z:文件浏览器里可直接解压/压缩文件 | OS + App | 已修(源码,待装验):p7zip-full 内置 + 文件浏览器右键加 Compress to .7z / Extract Archive(见 ubuntu-side-changes.md §7) |
| 36 | 文件浏览器右键空白处要有"新建文件夹"和"info(属性)"功能 | App | 待做 |
| 37 | 电量分级提示:低电警告、充电提示、满电提示、状态显示(快没电/少电/电多/满电/充电等) | App | 已修(源码,待装验):图标分级变色(≤5% 红闪/≤20% 红/≤50% 琥珀/≤80% 主题/满电辉光/充电脉冲)+ 一次性 toast(低电/危急/开始充电/已充满) |

| 51 | 时钟加日期显示(不改布局) | App | 已修(源码,待装验) |
| 52 | 确认休眠/挂起/锁屏等系统电源管理完善(Ubuntu Server 基底可能缺) | OS | 已核查:挂起/合盖/关机由 systemd-logind 管,install-edex.sh 写 edex.conf 合盖即挂起(外接电源也挂);休眠需 swap 且 Secure Boot 下默认禁用,不走;电源档走 App 性能控制器(cpupower,#37),不装 power-profiles-daemon(与手动 governor 冲突)。待装验 |
| 53 | 确认驱动/固件内置完整(对照现代桌面发行版) | OS | 已核查:linux-firmware 已内置(覆盖 E580 的 iwlwifi/蓝牙/Intel 核显/声卡固件);缺 intel-microcode(CPU 微码),已加进 build-iso.sh APTOPTS(下一版 ISO 生效);触控板/键盘背光走内核驱动无需固件。待装验 |
| 54 | 屏幕在设置的熄灭超时**之前**就熄灭;唤醒按键后无屏保/无锁屏,直接是真实 UI | App + OS | 已修(源码,待装验):(a) OS 侧关掉 Xorg 默认 ~10min DPMS 物理熄屏(xset -dpms / s off / s noblank),熄灭改由 app 的 screenOffIdle 掌控;(b) 重写 idle 轮询——黑屏只盖在**已建立**的屏保/锁屏上(不再同 tick 盖住刚启动的屏保,否则唤醒找不到屏保可解散→真实 UI)、屏保关闭时空闲按屏保超时直接锁定、模态框(如自动更新弹窗)不再挡住锁屏/熄屏;(c) 锁屏 30s 无操作回屏保时,屏保已禁用则不重启屏保。CDP 三场景(A 屏保关锁定/B 同超时唤醒进锁/C 错峰)已 PASS |
| 55 | 输入法切到"中"后拼音直通(白字、空格提交成英文),无候选框 | OS | 已修(打包,待装验):Rime 首启 schema 编译失败会退化成 latin 直通。改 fcitx5 profile 为 keyboard-us + pinyin + rime(pinyin 靠 libime **开箱即有候选窗**,en→中 一键落到 pinyin)+ classicui.conf 显式 CJK 字体/关 PerScreenDPI + 安装时 rime_deployer 预部署(best-effort)。APTOPTS 补 fcitx5-pinyin librime-bin |
## 修复顺序建议

1. **第一批(OS 侧,一次重装验多项)**: #2 向导英文、#4 时区/NTP、#7 XDG 目录、#3 WiFi、#9 plymouth(均已在源码,待装验)、#1 GRUB 报错(已定位,暂不改)
2. **App 侧(edex-ui 源码)**: #5 语音、#6 输入法、#8 用户名、#10 虚拟显示器、#11 app 列表过滤、#12 锁屏残留、#54 屏幕熄灭/锁屏(idle 轮询重写)
3. **需要真机诊断**: #3 WiFi(修复后需真机复验)、#55 输入法候选框、#10 虚拟显示器、#5 语音(新 ISO 烘焙模型后复验)

## 诊断命令(真机上跑)

```bash
# WiFi
nmcli device wifi list; nmcli radio; rfkill list; dmesg | grep -i iwl

# 输入法
fcitx5-diagnose | head -60; pgrep -a fcitx5

# 语音/虚拟显示器(App 日志在 ~/.config/eDEX-UI/ 或运行日志)
```

## 安全注意(全项目通用)

- Aliyun OSS bucket/URL 永不进 README/公开文档/CI 日志/commit(仓库公开)
- AccessKey Secret 永不粘贴到聊天

## 当前构建进度(v4 ISO,2026-08-07 更新)

**目标**:把 #5-#31 等已修源码(在 `/Users/lumiere/Desktop/edex-os/src`)打进真机用的 v4 ISO。
构建方法:macOS 交叉重打,不重编译原生模块。

### 已完成
- #42 主 squashfs(`extract/casper/ubuntu-server-minimal.squashfs`,1.98GB,ZSTD)已用 7zz 解包到 `/private/tmp/edex-iso-fix/rootfs7z/`(4.5GB),13223 个 symlink 已全部修复,大文件(libxul.so 184MB/omni.ja 53MB/libLLVM 143MB)校验完整。
- AppImage(`appimg-out/opt/edex/eDEX-UI.AppImage`,184MB)已解包出 AppDir(`appdir/`),含 edex-ui 二进制 + resources/app.asar(61MB)+ app.asar.unpacked(ffmpeg-static/node-pty/sherpa-onnx-linux-x64)。
- 构建输入目录 `app-rewrite/` 就绪 = 旧 asar 内容 + 最新 src JS + 完整 node_modules(在 /private/tmp,避开 iCloud)。

### 关键发现
- **electron-builder 26.15.3 在本机无法用**:项目在 `~/Desktop`(iCloud 同步),fileproviderd 占 212% CPU、系统负载 27、内存耗尽、磁盘 96% —— node 模块加载要 100 秒,electron-builder 假死。**已弃用 electron-builder 路线**。
- **改用手动重打 AppImage**:AppImage 布局 = runtime[0..188392] + squashfs(LZMA,block 128K,bytes_used=184506414) + 尾部[250628]。runtime 内**无签名校验逻辑**(只有 `--appimage-signature` 打印选项),所以可安全重建为 runtime(原样)+ 新 squashfs + 尾部(原样)。
- mksquashfs 4.7.5(homebrew)支持 LZMA 已验证;`@electron/asar` 3.4.1 在 repo node_modules 里。

### 下一步(重建 AppImage 的步骤)
1. 复制 @electron/asar + 依赖(commander/glob/minimatch/once/inflight 等)到 `/private/tmp/edex-iso-fix/asar-tools/`(避开 iCloud)。
2. `asar pack app-rewrite → app.asar`(--unpack-dir 覆盖 ffmpeg-static/node-pty/sherpa-onnx-linux-x64),替换进 `appdir/resources/`。
3. `mksquashfs appdir → 新squashfs`(`-comp lzma -b 128K -noappend`),拼 `head -c 188392 原AppImage` + 新squashfs + 尾部 250628 字节 → 新 AppImage。
4. 校验新 AppImage(hsqs@188392、compression=1)。
5. #44 替换 `rootfs7z/opt/edex/eDEX-UI.AppImage` → mksquashfs 重打主 squashfs → 更新 `extract/casper/filesystem.size` → xorriso 重建 `eDEX-OS-latest-fixed.iso`。

### 待用户确认后提交(repo)
- #10 改 packaging/build-iso.sh(已改:claude 硬校验 + fcitx5-rime)+ .github/workflows/release.yml(需先看现状)

### 2026-08-08 新增(已同步 src,待装验)
- **设置菜单 UI 升级(赛博科技风)**:侧边栏分类序号、等宽科技标签(◆ WIFI)、网络列表切角卡片(augmented-ui 描边环)、字体统一(数据读取值改 UI 正文字体 United Sans Light)。
- **设置-网络分类**:WiFi 开关/状态/连接详情(IP·路由器·DNS)/可用列表/已保存+自动连接/忘记/断开/代理(自动|无|手动),蓝牙开关/状态/设备列表/配对/断开/忘记。IPC 走 `nmcli`(network-manager)+ `bluetoothctl`。
- **设置-时间分类**:实时状态、时区、手动设时间、联网同步(`time:get`/`time:set` IPC)。
- **bluez OS 侧依赖**:蓝牙分类用 `bluetoothctl`,`bluez` 已加入 packaging/build-iso.sh APTOPTS 预装列表(装机离线也有);若机器无蓝牙适配器,分类显示"不可用"。
- 本次系统侧改动:install-edex.sh(WiFi/plymouth)+ docs/ubuntu-side-changes.md 新增

## v2.3.5 批(2026-08-09,已提交待装验)

**A/B/C(首启向导 + 用户名 + 锁屏快捷键)** — App 侧全部完成并 CDP 验证:
- **A**:xterm 向导 → 应用内 code 锁屏风格设置画面(firstRun.class.js:语言 → 时区 → 设置 PIN,去掉 root 密码)。触发=种子 settings.json 无 lockCode。
- **B**:`getDisplayName()` 优先 GECOS realname → "Welcome back, <全名>"。
- **C**:锁屏/首启期间 `uiLocked()` + `edex-lock-state` IPC 屏蔽全部快捷键(含 Ctrl+Tab 切 tab)。

**开机/过渡画面打磨**(本次真机反馈批,已在源码,待装验):
- 开机 plymouth **之前根本没装上**(APTOPTS 缺 plymouth,set-default-theme 静默失败)→ 现已加入 APTOPTS,开机有黑底 spinner 动画,不再滚纯文本。
- GRUB 菜单改黑底白字/青色高亮(原紫色难看);`error: file '/boot/' not found` 为装饰性(#11)。
- 进 UI 前白屏 + 原生箭头:win.show() 改 ready-to-show 门 + ui.html 首字节黑底/隐藏原生光标 + 会话 `xsetroot -solid black`。
- 系统级光标:默认 X 光标主题 DMZ-Black(暗色),eDEX 内部仍是自己的科幻图像光标。
- 合盖开盖先闪真实 UI:`powerMonitor` suspend 时立即 engage 锁,唤醒帧就是屏保/锁,不再闪桌面。
- 合盖开盖后键盘/触摸板失效:`pm:resume` 时 win.show()+focus() 重夺焦点 + resumeFromSuspend 整体 try/catch(单点 throw 不再卡死输入)。**真机待验;若仍失效需诊断输出(见下)。**
- `TypeError: t.setAttribute is not a function` 在合盖恢复路径重现(#24 复现)——resume 已加保险,但根因需要**真机报错完整文本/栈**才能定点。

**待真机诊断(把输出发回)**:
1. WiFi(#13):跑 docs/ubuntu-side-changes.md §2 的诊断块。
2. 合盖恢复后输入失效:若 v2.3.5 仍失效,跑:
   ```bash
   xinput list                                   # 键盘/触摸板设备是否还在
   dmesg | grep -iE "i8042|atkbd|psmouse|i2c_hid" | tail -30   # 恢复时驱动日志
   journalctl -b -1 -u systemd-suspend --no-pager | tail -20  # 挂起/恢复日志
   ```
3. t.setAttribute 报错:把错误弹窗的**完整文本(含文件名/行号)**拍下发回。

## v2.3.6 批(2026-08-09,已提交待装验)

**Claude tab 退出跳走 + 错误被清空**(App 侧,CDP 已验证):
- 现象:无 API key 进 claude,选完 cd 目录后 claude 认证失败立即退出,应用端把终端清空并自动切到上一个 tab,错误看不到(看起来像"崩溃")。
- 定位:**不是 claude 崩溃,是认证失败快速退出**;根因在渲染端 `onclose`:原逻辑清空 pane + `PREVIOUS_TAB` 切走,把错误抹掉了。
- 修复(`src/_renderer.js` + `main_shell.css`):claude tab 退出后**留在原 tab**,保留最后 ~60 行输出 + `[ claude process ended ]` 提示;错误文本含 `API key/auth/401/403/login` 时额外提示去 Settings→Claude 配置;再点该 tab 重新启动。其他 tab 关闭行为不变。
- 真机验证:无 API key 进 claude → 应留在 claude tab 显示认证错误 + 提示;配好 key 后点 tab 可正常进入。

## v2.3.7 批(2026-08-09,待提交待装验)

**电量图标不显示**(App + OS,App 侧 CDP 已验证):
- 现象:笔记本(E580)装上后时钟左上角没有电量图标。
- 定位:Electron `powerMonitor.getSystemBatteryLevel()` 在 Linux 走 **UPower D-Bus 守护进程**(`upower` 包);server-minimal 没装 → 返回 -1 → 渲染端隐藏图标。真机 `rfkill` 也缺失(诊断输出 `rfkill: command not found`)。
- 修复:build-iso.sh APTOPTS 加 `upower` + `rfkill`(下一版 ISO 生效);`_boot.js` battery:level 加 **sysfs 兜底** —— `powerMonitor` 报告无电池时读 `/sys/class/power_supply/BAT*/capacity|status`,内核接口对真笔记本永远存在,不依赖 upower。CDP 已验证无电池机器仍返回 `present:false` 不报错。

**电源键直接关机 → 改为弹出电源菜单**(App + OS):
- 现象:真机按下电源键 Ubuntu 直接关机。
- 定位:logind 默认 `HandlePowerKey=poweroff`(硬关机),install-edex.sh 的 edex.conf 只配了合盖,没配电源键。
- 修复(链式):
  1. logind `edex.conf` 加 `HandlePowerKey=ignore` → 电源键不再关机;
  2. openbox `rc.xml` 绑 `XF86PowerOff` → `/usr/local/sbin/edex-power-menu.sh`(ACPI 电源键在 logind 忽略后会作为 XF86PowerOff 键送到 X 会话);
  3. 脚本 `curl http://127.0.0.1:17322/` 通知应用;
  4. `_boot.js` 主进程起 127.0.0.1:17322 固定端口 HTTP 监听 → `webContents.send("show-power-menu")`;
  5. `_renderer.js` 把时钟点击的内联 POWER 弹窗抽成 `window.openPowerMenu()`,新增 `ipc.on("show-power-menu")` 复用同一弹窗(Restart / Lock Screen / Suspend / Shutdown,锁屏时隐藏 Lock Screen)。
- CDP 已验证:直接调 `openPowerMenu()` 弹 POWER 菜单;`curl 127.0.0.1:17322` 200 → 渲染端经 IPC 弹出同一菜单。
- 真机验证:短按电源键应弹出电源菜单而非关机;**长按电源键仍是硬件级强制断电**(嵌入式控制器行为,不可重映射);应用未启动(greeter/首启锁屏前)时按电源键无动作,不再直接断电。
- 备注:电量/电源键两项的 App 侧改动(`_boot.js`/`_renderer.js`)已在 CDP 预览验证;OS 侧(install-edex.sh / build-iso.sh)需重装装验。

**搜不到 WiFi(E580 RTL8821CE)+ 全网卡最大兼容批**(OS):
- 现象:真机已装 linux-firmware、WiFi 已使能,但 `nmcli device wifi list` 永远为空、wlp5s0 状态 unavailable。
- 定位(真机诊断照片):网卡是 **Realtek RTL8821CE**(10ec:c821),**不是 Intel** —— 内核自带 `rtw88_8821ce` 虽然绑定设备但**无法扫描**,刷屏 "PCIe Bus Error: Correctable Physical Layer (Receiver ID)",接口一直 unavailable。之前 grep iwlwifi 全是空转(该卡根本不是 Intel)。
- 修复 A:`GRUB_CMDLINE_LINUX_DEFAULT` 加 `pcie_aspm=off` —— 关掉 PCIe ASPM 省电,是 PCIe 错误风暴 + 笔记本 WiFi 不稳的常见解法(代价:略耗电)。
- 修复 B(最大兼容批):新增 `packaging/build-wifi-drivers.sh`,在 chroot/proot 内对**目标内核**(`KVER=$(ls /lib/modules | sort -V | tail -1)`,不是 chroot 里报主机内核的 `uname -r`)批量编译出树驱动,装进 `/lib/modules/$KVER/extra/`(modules.dep alias 优先级高于内核自带),并**只对成功落地的 .ko 写 blacklist**(失败留内核驱动兜底,绝不裸 blacklist):
  - PCIe 笔记本:8821CE(E580,替换坏掉的 rtw88_8821ce)、8822CE;
  - USB 网卡:8821CU、8822CU、8821AU、88x2bu(8822bu/8812bu)、8188EU、8192EU、8812AU、8723BU、8723DU;
  - WiFi6 USB:8852AU、8852BU、8852CU —— 内核 6.8 的 rtw89 **根本没有 USB 支持**,出树驱动是唯一选项;且**不 blacklist rtw89 core**,否则连带废掉还能用的 PCIe 8852ae/8852be/8852ce;
  - Broadcom(老 Dell/HP/Lenovo):BCM43142/4360/4352 用 multiverse `broadcom-sta-dkms` 编 wl,blacklist b43/b43legacy/ssb/brcmsmac/bcma。
  - 有线网卡 r8169/e1000e/igc/alx/r8152 已由内核 + linux-firmware 完整覆盖,无需处理。
- 真机验证:重装后 `nmcli device wifi list` 应列出家里 WiFi;`lspci -k` 应显示 `Kernel driver in use: 8821ce`(出树驱动)。其他 PC 常见的 Realtek/Broadcom 网卡同一镜像直接支持。
- 备注:每个驱动 best-effort,单个编译失败只 WARN 跳过不影响出 ISO;14 个驱动源 URL 已逐个 curl 验证 200。

**锁屏再解锁后终端命令/文字消失**(App,CDP 已验证):
- 现象:code 锁屏(终端式)锁屏再解锁后,之前敲的命令和输出从终端上消失。
- 定位:code 锁屏直接把**主 shell 终端**当锁屏画面 —— `_drawLockBox()` 先 `term.reset()` 清屏画框,解锁 `_teardownLock()` 又 `term.reset()` 一次再向 pty 要新提示符 → 整个 scrollback(1500 行)被两次清掉。矩阵锁屏是全屏覆盖层、不碰终端,不受影响。
- 修复:锁屏画框前用 `xterm-addon-serialize` 把当前 buffer(含 scrollback)序列化存 `_savedTerm`,解锁 `term.reset()` 后**重放**回终端;已恢复快照就不再发 `\r`(避免误执行输入到一半的命令)。新增依赖 `xterm-addon-serialize@0.7.0`(兼容 xterm 4.14,CI `npm install` 自动带上)。
- CDP 已验证:写入 60+ 行(含深 scrollback 标记)→ code 锁屏(标记从可视区消失)→ 解锁后两个标记原样回到 buffer,行号/scrollback 深度一致。
