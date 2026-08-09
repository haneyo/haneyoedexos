# eDEX-OS v2.2.9 真机首启问题清单

> 2026-08-07 首台真机(ThinkPad E580)装到能进 eDEX UI 后收集。装完应只看到 eDEX 全屏壳。

**里程碑已达成**:ISO 能装完、lightdm 修复后能进图形壳。以下为打磨项,按修复位置分两类:

- **OS 侧**(install-edex.sh / build-iso.sh / 配置文件,重装生效)
- **App 侧**(edex-ui 源码 → 重打 AppImage → 重打 ISO 生效)

| # | 问题 | 侧 | 状态 |
|---|------|----|------|
| 1 | 开机 GRUB 报 `error: file '/boot/' not found`(不影响引导) | OS/ISO | 已定位:Ubuntu 签名 grubx64.efi 内嵌配置所致,装饰性,暂不改(详见 ubuntu-side-changes.md §4) |
| 2 | 首启向导中文变方块字,要求改英文界面 | OS | 已修(源码,待装验) |
| 3 | 搜不到 WiFi | OS(需真机诊断) | 已修(源码,待装验):netplan 双 renderer 冲突 + 关 wifi 电源管理(见 ubuntu-side-changes.md §2);设置菜单已加网络分类(连接/断开/已保存/代理/蓝牙),依赖 nmcli + bluetoothctl |
| 4 | 系统时间不对:需要时区 + 手动改时间 + 联网同步功能 | OS + App | App 已修(源码,待装验):设置加时间分类(实时状态/时区/手动设时间/联网同步 IPC);OS 侧需装验 |
| 5 | 语音输入按钮按下后卡死,无法再按、无法语音输入 | App | 已修(源码,待装验) |
| 6 | 输入法切换无反应,一直 EN | OS | 已修(源码,待装验):fcitx5-rime 已内置 + 写 fcitx5 profile(keyboard-us 默认 + rime 中文,Ctrl+Space 切换,见 ubuntu-side-changes.md §3) |
| 7 | 文件浏览器默认标签连不上(XDG 目录不存在) | OS | 已修(源码,待装验) |
| 8 | 设置-通用-用户名显示 `undefined` | App | 已修(源码,待装验) |
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
## 修复顺序建议

1. **第一批(OS 侧,一次重装验多项)**: #2 向导英文、#4 时区/NTP、#7 XDG 目录、#3 WiFi、#9 plymouth(均已在源码,待装验)、#1 GRUB 报错(已定位,暂不改)
2. **App 侧(edex-ui 源码)**: #5 语音、#6 输入法、#8 用户名、#10 虚拟显示器、#11 app 列表过滤、#12 锁屏残留
3. **需要真机诊断**: #3 WiFi(修复后需真机复验)、#6 输入法、#10 虚拟显示器、#5 语音

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
