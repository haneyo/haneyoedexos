# Ubuntu 端改动清单(装机后/真机上执行)

> 适用范围:**无法在 macOS 构建侧完成**、必须在 Ubuntu 安装机(chroot)或**真实硬件**上执行的操作。
>
> 凡标记「已自动化」的条目,都已经写进 `packaging/install/install-edex.sh`,装系统时由 curtin
> 在目标 chroot 里自动跑——**这里只列真机验证步骤和手动兜底命令**,装机后在 Ubuntu 机器上照着做。
>
> 现状说明:这些改动已提交到仓库源文件,下一次 CI/本地构建产生的 ISO 才会包含。已装机的旧 ISO
> 不受影响,需要重装新 ISO 才能拿到以下修复。

---

## 1. 开机画面打磨(plymouth 动画 + GRUB 暗色 + 光标)(#19 + v2.3.5 批)

**重要发现**:旧 ISO 里 plymouth **从未真正装上** —— build-iso.sh APTOPTS 没列 plymouth,
install 里的 `plymouth-set-default-theme spinner` 一直静默失败(`|| true`),开机其实在滚
纯文本。v2.3.5 起:

1. **plymouth 真正内置**:build-iso.sh APTOPTS 加入 `plymouth plymouth-theme-spinner`
   (随 squashfs 打进系统),install 时 `plymouth-set-default-theme spinner` + `update-initramfs -u`
   才真正生效 → 开机黑底 spinner 动画,不再滚文本。默认主题设为自定义 **edex**
   (见 §1.1),plymouthd.conf `Theme=edex`。
2. **GRUB 暗色主题(消除开机白屏)**:`/etc/default/grub` 用 `GRUB_TERMINAL_OUTPUT=gfxterm`
   图形模式 + `GRUB_GFXMODE=1920x1080,1024x768,800x600,auto` + `GRUB_GFXPAYLOAD_LINUX=keep`:
   GRUB 以面板原生分辨率黑底渲染并让内核沿用同一 framebuffer,不再有 VGA 文本→KMS 的
   模式切换 —— 那个切换正是真机开机"先白屏再动画"的来源。gfxterm 在 GPU 不支持图形模式时
   会自动回退到 VGA 文本控制台,不影响引导。配色仍为黑底白字/青色高亮。
   GRUB 菜单上方闪的 `error: file '/boot/' not found` 与这份配置无关 —— 来自 UEFI 签名
   grubx64.efi 内嵌配置,纯装饰(#11,不影响引导)。
3. **光标统一 + 黑根窗口**:系统默认 X 光标主题改 **edex**(WP7 暗色箭头,随 ISO 内置,
   `update-alternatives` 指向 `/usr/share/icons/edex/index.theme`),会话启动时
   `xsetroot -solid black` 涂黑 X 根窗口 + `xsetroot -cursor_name left_ptr` 立刻切暗色
   箭头 —— lightdm greeter 关掉、eDEX 窗口还没映射的瞬间(之前白屏 + 原生箭头)变黑底黑光标。
   ⚠️ 旧装机(如本机 E580)的 edex-session.sh 还写着 `XCURSOR_THEME=DMZ-Black`,而
   `dmz-cursor-theme` **未安装** → X 回退到原始黑白箭头。已改为 `XCURSOR_THEME=edex`。

### 1.1 edex plymouth 主题 — 底部 Ubuntu logo 的来源与去除

edex 主题的动画/throbber 帧是 eDEX 绿色环(无 Ubuntu 品牌);品牌部分只有两处:
`bgrt-fallback.png`(居中,已用 edex-boot-logo.png)与 **`watermark.png`(底部,edex.plymouth
`WatermarkVerticalAlignment=.96`)**。install-edex.sh 从 spinner 主题复制 PNG 时只跳过了
`bgrt-fallback.png`,`watermark.png` 仍是 **Ubuntu 圆标** → 真机开机屏幕最下方出现 Ubuntu
logo。修复:复制时同样跳过 `watermark.png`,并向 edex 主题写入一张**全透明** PNG(base64
内嵌 1x1),底部不再画任何 logo。真机验证(每张 initramfs 都应全透明):

```bash
cat /etc/plymouth/plymouthd.conf                    # Theme=edex
grep -A2 Watermark /usr/share/plymouth/themes/edex/edex.plymouth
python3 -c "from PIL import Image;print(Image.open('/usr/share/plymouth/themes/edex/watermark.png').getextrema()[3])"  # (0, 0)=全透明
unmkinitramfs /boot/initrd.img-* out && python3 -c "from PIL import Image;print(Image.open('out/main/usr/share/plymouth/themes/edex/watermark.png').getextrema()[3])"
```

**真机验证:**
```bash
cat /etc/default/grub | grep CMDLINE_LINUX_DEFAULT    # 应含 quiet splash
cat /etc/default/grub | grep -E "GRUB_COLOR|TERMINAL|GFXMODE|GFXPAYLOAD"  # 应见 gfxterm + dark 配色
cat /etc/plymouth/plymouthd.conf                       # Theme=edex
lsinitramfs /boot/initrd.img-* | grep plymouth | head   # 应列出 plymouth 文件
update-alternatives --get-selections | grep x-cursor-theme   # 应指向 /usr/share/icons/edex/index.theme
grep -n XCURSOR_THEME /usr/local/sbin/edex-session.sh  # 应为 edex(不是 DMZ-Black)
grep -A2 Watermark /usr/share/plymouth/themes/edex/edex.plymouth
```

开机应看到:GRUB 黑底(gfxterm,无白屏)→ edex 动画(黑底,居中 eDEX wordmark,底部**无**
Ubuntu logo)→ 黑底 lightdm → eDEX 锁屏,全程无白屏无原生箭头。看到纯文本滚动 =
plymouth 没生效(跑 `sudo update-initramfs -u && sudo update-grub` 后重启);底部仍见
Ubuntu 圆标 = watermark.png 未替换(见 §1.1)。

---

## 2. WiFi(#13)— 已自动化(两个修复),需真机验证

install-edex.sh 现在会:

**a. 删除 subiquity 安装器生成的 netplan 配置,消除双 renderer 冲突(根因):**
安装器交互阶段会写 `/etc/netplan/00-installer-config.yaml`(renderer: **networkd**),
与 install-edex.sh 写的 `01-network-manager-all.yaml`(renderer: **NetworkManager**)
同时存在 → netplan 报 "conflicting renderer" → 整个网络栈生成失败 → 搜不到任何 WiFi。
现在安装时自动 `rm -f /etc/netplan/00-installer-config.yaml /etc/netplan/*-installer-config.yaml`。

**b. 关闭 WiFi 电源管理(信号弱/搜不到的常见坑):**
写 `/etc/NetworkManager/conf.d/zz-edex-wifi-powersave-off.conf`(wifi.powersave = 2),
覆盖 Ubuntu 自带的 powersave=3。

**真机验证:**
```bash
ls /etc/netplan/                                  # 应只有 01-network-manager-all.yaml
cat /etc/NetworkManager/conf.d/zz-edex-wifi-powersave-off.conf
nmcli radio                                      # wifi: enabled
nmcli dev wifi list                              # 应列出附近网络
nmcli dev wifi connect <SSID> password <pw>      # 连网测试
```

**如果仍搜不到网络**,在真机按顺序诊断并把输出发回 macOS 侧:

```bash
nmcli radio; rfkill list                         # 软/硬 block 状态
nmcli dev status
sudo dmesg | grep -iE "iwlwifi|firmware|wifi" | tail -30
ip link                                          # wlan0 是否存在/UP
systemctl status NetworkManager --no-pager | head -20
journalctl -u NetworkManager -b --no-pager | grep -iE "wifi|wlan|error" | tail -20
```

`rfkill list` 若显示 hard-blocked,是 EFI/物理开关问题(需查 BIOS/飞行模式键),软件无解。

---

## 3. 输入法 fcitx5 + pinyin + Rime(#16 + #55)— 已自动化,需真机验证

根因 1(一直 EN):fcitx5 守护进程和 IM 环境变量都正常(edex-session.sh 启动
`fcitx5 -d`,GTK_IM_MODULE/QT_IM_MODULE/XMODIFIERS 已导出),但**没写 fcitx5
profile** → 引擎列表为空 → Ctrl+Space 无输入法可切换 → 一直 EN。

根因 2(候选框不出现,#55):只装了 Rime,而 Rime **首次激活时才编译 schema**;
编译失败/未完成会退化成 latin 直通(输入白字、空格提交成英文、无候选框)。
且 minimal 系统里 classicui 候选窗字体回退可能渲染成空白/豆腐块。

install-edex.sh 现在写 `/home/<user>/.config/fcitx5/profile`:
三个输入法 = `keyboard-us`(英文,默认)+ `pinyin`(libime,**开箱即有候选窗**,
en→中 一键落到它)+ `rime`(小狼毫,第二中文选项),并播种到 `/etc/skel`。
同时写 `conf/classicui.conf`(`Font="Noto Sans CJK SC 12"` + `PerScreenDPI=False`,
候选窗显式 CJK 字体、防嵌套/Xvfb 下错 DPI 跑偏),并在安装时 best-effort
`rime_deployer --build` 预部署 Rime(装 librime-bin 提供该命令)。APTOPTS 补
`fcitx5-pinyin librime-bin`。

**真机验证:**
```bash
cat ~/.config/fcitx5/profile          # 应含 keyboard-us + pinyin + rime 三项
cat ~/.config/fcitx5/conf/classicui.conf   # Font 应为 Noto Sans CJK SC;且含 #aacfd1/#05080d 配色
fcitx5-diagnose | head -60            # 应看到 fcitx5-pinyin 与 fcitx5-rime 引擎
# 终端点 EN/中 切到"中"(pinyin),打字应立刻出现候选框,空格上屏中文
# 候选框应为黑底青色(#aacfd1)选中高亮,与 tron 主题一致(#144)
```

**#144 候选框现状**:切换已修复(#16);候选框**配色**已改成 tron 主题同款(上面 classicui.conf)。
但用户报告:切到"中"后打字**只有拼音/英文上屏,候选框仍不出现**。Mac 侧无法跑 fcitx5,
以下诊断在真机执行,输出发回:

```bash
ps aux | grep fcitx5                  # 守护进程应在跑(edex-session.sh 启动)
echo $GTK_IM_MODULE $QT_IM_MODULE $XMODIFIERS   # 应都是 fcitx / @im=fcitx
fcitx5-diagnose | head -80            # 重点看 input method 与 profile/engine 段
cat ~/.config/fcitx5/rime/build/*.bin 2>/dev/null | head -1   # 空=Rime 未部署
# 候选窗渲染确认(打字时):
xdotool search --name "" getwindowname 2>/dev/null || xwininfo -root -children | tail -20
#   若打字时多出一个 fcitx/fcitx5 窗口 → 候选窗在渲染,可能是 z-order/位置问题
#   若没有任何新窗口 → fcitx5 没进组合状态,是 app 输入路径/IM 上下文问题
tail -60 ~/.local/share/fcitx5/log/fcitx5.log 2>/dev/null    # 或 ~/.cache/fcitx5/
```

---

## 4. 开机 GRUB 报错 "file '/boot/' not found"(#11)— 装饰性,优先级低

已定位:**Ubuntu 官方签名的 `grubx64.efi` 内嵌 memdisk 配置**引用了一个不存在的 `/boot/grub`
路径,报错来自 EFI 固件加载阶段,不影响实际引导。ISO 文件层面无法安全消除(改动签名 EFI 会破坏
Secure Boot)。若日后要彻底清除,需在 Ubuntu 真机上重新生成 grubx64.efi(自定义签名链),工作量
大、风险高——**当前结论:保留,不进本轮范围**。

---

## 5. Claude CLI — 已内置 + 构建期强校验,首次使用需配 API key

- 二进制已内置:`/usr/local/bin/claude`(原生 290MB ELF,平台二进制齐全,`claude --version` 可用)。
- build-iso.sh 现在把 Claude 列为**硬性依赖**:npm 安装失败或 `claude --version` 校验不过 → 构建直接报错,
  不会再静默产出"助手装不上"的 ISO。
- **首次使用**:在齿轮菜单的 Claude 设置里填 API key(settings.json → `claude.apiKey`),
  或在终端 `export ANTHROPIC_API_KEY=...`。装机后的 CLAUDE.md 已写好系统约定,claude 会自动读取。

验证:
```bash
claude --version
```

---

## 6. 装机后完整自检清单(建议首启跑一遍)

```bash
# WiFi
nmcli radio && nmcli dev wifi list
# Claude
claude --version
# 输入法(Rime)
fcitx5-diagnose | head -40          # 确认 fcitx5-rime 引擎在
cat ~/.config/fcitx5/profile        # 应含 keyboard-us + rime 两个输入法
# plymouth
cat /etc/default/grub | grep splash
# 时间(#14 OS 侧:时区 + NTP)
timedatectl                                   # Timezone 应 Asia/Shanghai;联网后 synchronized: yes
# 文件浏览器默认标签(#17:XDG 目录已建)
ls -d ~/Desktop ~/Documents ~/Downloads ~/Music ~/Pictures ~/Public ~/Templates ~/Videos 2>&1
# 电源管理
cat /etc/systemd/logind.conf.d/edex.conf
# 挂载/网络栈
ls /etc/netplan/
# 7z(#48)
which 7z
```

**App 侧目测项**(首次启动 eDEX UI 后):
- 锁屏(电源菜单 Lock Screen / Win+L)→ 解锁后,**文件浏览器应显示真实文件列表**,与锁前一致(#79,cover 会在解锁时重读真实目录)。
- 文件浏览器右侧标签(DESKTOP / DOCUMENTS / DOWNLOADS 等)应能进入对应 XDG 目录(#17)。

每项结果发回,用于更新 `docs/first-boot-issues.md` 的状态。

---

## 7. 内置 7z:文件浏览器解压/压缩(#48)— 已自动化,需真机验证

**App 侧**(文件浏览器右键菜单,来源 `classes/filesystem.class.js`):
- **Compress to .7z**(压缩):选中 1 个文件/目录 → 当前目录生成 `<名字>.7z`;
  选中多个 → 当前目录生成 `<当前目录名>.7z`。
- **Extract Archive**(解压):**恰好选中 1 个**压缩包时可用 →
  解压到当前目录下同名文件夹(去扩展名,如 `foo.tar.gz` → `foo/`),内容原样。
- 识别为压缩包的扩展名:.7z / .zip / .tar / .tar.gz / .tgz / .gz / .xz / .bz2 / .rar / .cab / .zst / .lzma。
- 实现走系统 `7z` 命令(`cd` 进目标目录再打包,保证归档内是相对路径),完成后自动刷新列表。

**OS 侧**:`p7zip-full` 已加入 `packaging/build-iso.sh` 的 APTOPTS,装机离线即带 `7z`。

**真机验证:**
```bash
which 7z                     # 应输出 /usr/bin/7z(p7zip-full 已内置)
# 文件浏览器里:右键任意文件 → Compress to .7z;右键一个 .7z/.zip → Extract Archive
# 压缩后当前目录出现 <名字>.7z;解压后出现 <名字>/ 目录且内容一致
# 命令行兜底(与 App 内部同款操作):
mkdir -p ~/7ztest && cd ~/7ztest && echo hi > a.txt
7z a t.7z a.txt && 7z t t.7z
7z x -o~/7ztest/t t.7z && cat ~/7ztest/t/a.txt    # 应输出 hi
```

---

## 8. 安装器崩溃 subiquity load_autoinstall_data(#128)— 需真机 traceback

现状:ISO 装到一半,安装器(Subiquity)在解析 autoinstall 时崩溃,
错误标志为 `subiquity/Error/load_autoinstall_data`。macOS 侧无法运行 Subiquity,
静态分析已排除的嫌疑项(v2.3.0 起):

- **identity 密码 hash**:已用 `openssl passwd -6 -salt edexsalt edex` 逐字节核对,
  user-data 里的 hash 就是 "edex" 的正确 sha512crypt,**不是**密码错误(先前怀疑
  是 macOS ruby `crypt` 只支持 DES 造成的误报)。
- **`updates: none` 非法值**:早在 b297709 已改为 `apt: fallback: offline-install`,
  该 rejection 已不在。
- **`source` 段**:user-data 没有 source 段,不触发 `get_matching_source` KeyError。
- **`keyboard.toggle`**:只有 `{layout: us}`,无 toggle 键,不触发
  "None is not of type 'string'"。

**结论:当前 user-data 各键均符合 Subiquity 24.04 autoinstall schema,无法静态定位。
需真机装 v2.3.0 ISO,抓到崩溃现场再修。**

真机抓取 traceback(装 v2.3.0 时):
1. 在崩溃的 Subiquity 屏幕拍照/记下最后几行(通常含 `Traceback` + 具体 exception 类名
   与文件名)。Subiquity 崩溃界面通常允许 `Ctrl+Alt+F2/F3` 切 TTY。
2. 切到实时日志 TTY 后抓尾段发回:
   ```bash
   tail -100 /var/log/subiquity-server-debug.log
   ```
3. 若崩溃现场拿不到,回 live 环境(Try Ubuntu)后:
   ```bash
   ls /var/crash/                       # 崩溃的 .crash 文件(若有)
   sudo dmesg | tail -50
   ```
   注意安装器日志在内存盘,重启即失——优先在崩溃现场直接抓。

---

## 9. 首启向导(应用内,替代 xterm)(#132, v2.3.5)— 已自动化,需真机验证

**v2.3.5 起,开机首启的 xterm bash 向导已整个删除,换成应用内的 code 锁屏风格设置画面**
(`classes/firstRun.class.js`):全屏点阵背景 + 居中 ASCII 终端框,纯英文,分三步 ——
界面语言(ENGLISH / CHINESE)→ 时区(8 区列表,默认 Asia/Shanghai)→ 设置解锁 PIN(4-8 位,
输两遍确认)。**root 密码已移除**(装系统时 Ubuntu 已设 `edex` 用户密码)。

- 触发条件:种子里 settings.json 的 `lockCode` 为空(首启天然命中;设置过 PIN 后不再出现)。
- 完成时写 `lockCode` / `lockOnIdle: true` / `language` 到 settings.json,并
  `sudo timedatectl set-timezone <tz>`(edex 用户有 passwordless sudo),然后进 UI,
  语言选择器自动跳过。
- 设置画面期间 `edex-lock-state` IPC 置锁 → 全局快捷键全部屏蔽。

**真机验证:**
```bash
cat /etc/edex-settings.json 2>/dev/null | grep -E "lockCode|lockOnIdle|language"   # 装完首启前应无 lockCode
# 首次进系统应直接看到 SETUP TERMINAL 框;完成语言/时区/PIN 后进入桌面
grep -E "lockCode|lockOnIdle|language" ~/.config/eDEX-UI/settings.json            # 首启后应写入
timedatectl show -p Timezone                                                     # 应等于所选时区
```

---

## 10. 电源键按下 → 电源菜单(非锁屏态)(#140)— 需真机验证

锁屏/屏保下的电源键行为已按 #148 做掉(矩阵→熄屏,code→电源菜单)。**非锁屏态**按下物理
电源键,预期是弹出 eDEX 电源菜单而不是直接关机。macOS 侧无法模拟 ThinkPad 电源键/ACPI 事件,
按键路由依赖真机。

**真机验证:**
```bash
# 正常桌面(未锁屏)按一下电源键 → 应弹出 eDEX 电源菜单(SHUTDOWN / RESTART / SLEEP / SCREENSAVER…)
# 长按(>5s)应仍由固件强制断电(BIOS 行为,软件管不到)
# 若直接关机了:看谁在响应
systemd-inhibit --list                       # 谁持有电源键 inhibit
grep -iE "handle_power_key|PowerKeyIgnore|PowerKeyInhibit" /etc/systemd/logind.conf /etc/systemd/logind.conf.d/* 2>/dev/null
loginctl show-session $(loginctl | awk 'NR==2{print $1}') -p IdleHint   # 空闲状态
```

---

## 11. 笔记本电量不显示(upower + sysfs 兜底)(#139)— 需真机验证

电量显示组件(时钟左上角)已在 #30/#50 做好并在无电池机器上验证过。笔记本真机上若仍不显示,
是电池信息源(upower 拿不到 → 回退 sysfs `/sys/class/power_supply/`)的问题。

**真机验证:**
```bash
upower -e | grep -i battery || echo "upower 无电池设备"
cat /sys/class/power_supply/BAT*/capacity 2>/dev/null || echo "无 BAT* sysfs 节点"
ls /sys/class/power_supply/                 # 看电池枚举名(如 BAT0 / BAT1 / CMB0)
grep . /sys/class/power_supply/*/type 2>/dev/null   # type 是否为 Battery
# eDEX 时钟旁应显示电量百分比 + 状态(充电/低电),插拔电源应实时变化
```

---

## 12. Show disks 显示未挂载 U 盘 + 点击挂载(#145)— 需真机验证

文件浏览器 "Show disks" 视图预期列出**未挂载的 U 盘/移动盘**,点击即挂载。macOS 侧已实现
app 侧调用(lsblk 枚举 + `udisksctl mount`),但真实 U 盘插拔、挂载权限、vfat/ntfs 行为只能在
真机上验。

**真机验证:**
```bash
# 插入 U 盘 → 文件浏览器 Show disks 应出现该设备(未挂载)
# 点击设备 → 应自动挂载并进入其目录;再点 → 卸载
udisksctl status                            # 应看到该 U 盘节点
lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS | grep -E "sd[b-z]"   # 挂载点是否出现
# 若点击无反应,把 app 终端里报错发回(挂载走 udisksctl,权限由 polkit 控制)
```

---

## 13. 内置 clash 代理(#46)+ 集中「更新」分类(#47)— 已实现,需真机验证

**已落地**(本批):
- **App 侧(macOS 已 CDP 验证)**:设置新增 `clash` 分类(启用开关 / 状态 / 混合端口 / 控制接口 / 控制密钥 / 订阅 URL + 拉取 / 配置目录 / 运行日志)+ `updates` 分类(App 自更新检查 / apt 系统更新 + 上次更新时间 / 内置程序状态:clash、Firefox、Claude Code)。底部 UPDATE 按钮改路由到 `updates` 分类。macOS 无 mihomo 二进制 → 全部返回 mock 态。
- **主进程**:clash 守护(clashDaemon 闭包,`~/.config/edex-proxy/config.yaml`,ring 日志,fs.watch 配置变更重启,设置 `enabled` 开机自启,before-quit SIGTERM);系统代理联动(nmcli proxy.method/http/https + ignore-servers 绕过内网 ws 与面板自身);更新 IPC(`edex:latest-release` / `apt:last-update` / `bundled:status` / `clash:check-update` / `clash:update` 走 `sudo -n install` 换 `/usr/local/bin/mihomo`);`system:update` 完成时写 `updates.lastSystemUpdate` 时间戳。
- **构建侧(Phase B,已写入 build-iso.sh,CI 触发)**:烤入 mihomo 二进制(`/opt/edex/mihomo/mihomo` + `/usr/local/bin/mihomo` 软链)、geo 数据(Country.mmdb / geoip.dat / geosite.dat,来自 MetaCubeX meta-rules-dat)、metacubexd 面板(`/opt/edex/metacubexd`)。全部 best-effort WARN 不中断。

**真机验证清单:**
```bash
# 1) 二进制与配置就位
mihomo -v                                   # 应有版本号(烤入或 clash:update 后)
ls -l /opt/edex/mihomo/{mihomo,Country.mmdb,geoip.dat,geosite.dat}
ls -l /usr/local/bin/mihomo                 # 软链
# 2) 设置里启用 clash → 自动 start + 设系统代理
nmcli -t -f proxy.method,proxy.http,proxy.https,proxy.ignore-servers connection show "<WiFi名>"
#    期望 manual / 127.0.0.1:7890 / 127.0.0.1:7890 / 127.0.0.1,localhost,::1
# 3) 面板:设置 → clash → 打开面板(全屏 webview 加载 http://127.0.0.1:9090/ui/)
#    面板自身应正常打开(ignore-servers 含 127.0.0.1 → 不打进 mihomo,无代理循环)
# 4) 订阅:填机场 URL → 拉取订阅 → config.yaml 被替换并重启;跑 curl 走代理验证
#    curl -s https://api.ip.sb/geoip          # 出口 IP 应是机场节点
# 5) 内网绕过:终端 ws://127.0.0.1:3000 连接不受代理影响(ignore-servers)
# 6) 更新:updates 分类 → mihomo 检查更新/更新(换 /usr/local/bin/mihomo + 重启);
#    App 检查更新 → v2.3.7+ 提示与现有 UpdateChecker 一致;系统更新 → apt 全量升级
# 7) 关闭 clash → 恢复原代理(settings.clash.preProxy);再开 → 重新捕获
# 8) 若 webview 流量不走 nmcli 代理(Chromium 读 GSettings 而非 NM 连接代理):
#    gsettings set org.gnome.system.proxy mode manual
#    gsettings set org.gnome.system.proxy host 127.0.0.1
#    gsettings set org.gnome.system.proxy port 7890   # 标记为备选方案
```

---

## 14. 应用监视器虚拟显示器:macOS 预览 vs Ubuntu 真机差距(重点)

> **背景:为什么 macOS 预览"堪称完美",而 Ubuntu 真机是"黑框 + 应用不出现"。**
> 应用监视器的 tab 有两种内容,**别混为一谈**:
>
> **A. Web 应用(网页 / 内置面板)** —— 直接在 `<webview>` 里加载 URL
> (appmonitorPanel.class.js `_showWebWebview`),**完全不经过 Xvfb / noVNC**。
> 这条路径 macOS 和 Ubuntu 一样,都是真内容真渲染,所以两边都完美。
> "mac 上浏览器和 webapp 完美显示"指的就是这一半 —— 它没有虚拟显示器参与,
> **不会有黑框问题**。
>
> **B. 原生应用(真二进制,如 Firefox)** —— 走 noVNC 流式渲染嵌套显示器:

| | macOS 预览(B 类) | Ubuntu 真机(B 类) |
|---|---|---|
| 后端 | `mock`(假屏) | `real`(真应用) |
| 渲染来源 | `mock-rfb.js` 合成帧缓冲 | `Xvfb :101/:102` + `openbox` + `x11vnc` + 真应用 |
| 帧缓冲 | 800×600,**全铺满主题内容**(终端/矩阵/雷达演示屏) | 800×600,**黑色桌面 + 一个未最大化的小窗口** |
| 观感 | 完美 —— 但是**假的**(Firefox 本体没启动,只放演示动画) | 黑框 + 应用可能根本不出现 |

- **macOS 的 B 类从不跑真应用。** mock 后端(`backend.js` DEMO_APPS)的列表只有
  `DEMO TERMINAL / DEMO MATRIX / DEMO RADAR` 三个假应用;在 mock 下选 Firefox,
  也只是放一段假"终端"动画(`setDemo(scene,"terminal")`),Firefox 本体不会启动。
- 因此 **"原生应用画面不出现"和"黑框没填满"只存在于 real 后端(B 类)**,
  macOS 侧**既复现不了、也修不了** —— 必须在 Ubuntu(ISO/真机)侧解决。
- **mock 与 real 共享完全相同的 800×600 → noVNC → webview 管线**(仅 B 类)。
  所以容器/缩放类渲染问题(webview 是否填满插槽、黑边)可以在 macOS 预览上调试;
  而"应用窗口填满 Xvfb 桌面、Firefox 能否启动"纯属 Linux 侧,预览无法验证。
- 症状 B 的"黑框"只来自 B 类。**A 类(web 应用)不受影响,无需处理。**

### 症状 A:选中 Firefox 后 app 画面不出现(真机)

real 后端(`appmonitor/backend.js`)每个 monitor 起 `Xvfb :101/:102 -screen 0 800x600x24`
+ `openbox --sm-disable` + `x11vnc`,再把 `.desktop` 里的应用 `spawn` 进 `DISPLAY=:N`。
Firefox 在 ISO 里是官方 tarball(`/opt/firefox/firefox`,build-iso.sh 已确认,**不是 snap**),
会话是非 root 的 autologin 用户(install-edex.sh 已确认,**不是 root 拒绝问题**)。

Phase C 真机排查顺序(在 tab 4/5 选中 Firefox 后):

```bash
# 1) 应用进程到底起没起
ps aux | grep -i firefox | grep -v grep
#    没有 → spawn 失败(看下方 appmonitor 日志);有 → 进下一步

# 2) 嵌套 display 里有没有窗口映射出来(以 :101 为例)
DISPLAY=:101 wmctrl -l            # 没有 wmctrl 先: sudo apt install -y wmctrl
DISPLAY=:101 xdotool search --onlyvisible "" getwindowname %@ 2>/dev/null

# 3) 帧缓冲内容到底什么样(Xvfb 桌面截图,黑=没窗口 / 有窗口=看是否只占一角)
xwd -display :101 -root | xwdtopnm 2>/dev/null | pnmtopng > /tmp/mon101.png

# 4) appmonitor 后端日志(渲染进程 → 主进程日志,标着 [appmonitor])
#    在 eDEX 里 Ctrl+Shift+I 打开 DevTools → Console,或看主进程 stdout
#    spawn error / exit 码就是线索

# 5) 手动在嵌套 display 里试跑一次,排除 webview/时序因素
DISPLAY=:101 /opt/firefox/firefox --no-remote about:blank &
sleep 5; DISPLAY=:101 wmctrl -l
```

已知注意点:
- Firefox 首次启动要建 profile + 无 GPU 软渲染,**启动慢**(5~15s),期间黑屏是正常的,
  要等状态点变绿(running)再看画面。
- `backend.js` 对 Firefox 只设了 `MOZ_DISABLE_CONTENT_SANDBOX/GMP_SANDBOX` 两个 env,
  **没有**像 Chromium 那样追加 `--no-sandbox`。若真机 Firefox 起不来,试手动
  `DISPLAY=:101 /opt/firefox/firefox --no-sandbox` 对比。

### 症状 B:黑框没有填满终端窗口(tab 槽位)

两层原因叠加:
1. **Xvfb 桌面本身是黑的** —— 800×600 里只有应用窗口一小块(openbox 默认不最大化新窗口),
   其余都是黑。这是"黑框"的主要来源。
2. **比例留边** —— 帧缓冲 800×600(4:3),tab 槽位接近 16:9,noVNC `scaleViewport`
   保持比例缩放 → 左右出现黑边(macOS mock 也有同样的边,但内容铺满所以看不出)。

**修法(已实现到 `appmonitor/backend.js`,real 后端)**,Phase C 验证。
思路:tab 4/5 全是带 UI 的 app、大多支持调整窗口大小 → **把 app 窗口最大化到和终端槽位
一样大**即可,缺角由 shell 的 clip-path 切掉(和 webapp 一样)。app 就两种尺寸:
终端窗口大小(监视器 tab)+ 全屏(native fullscreen),反而更简洁。**不做留边美化**。

实现(数据驱动):
1. **嵌套 Xvfb 分辨率改成 2:1**:`SCREEN = "1600x800x24"`。槽位实测约 **832×416 ≈ 2:1**
   (#main_shell 是 65%×60.3% 视口,任何分辨率下比例都 ~2:1)→ noVNC `scaleViewport`
   正好铺满,无黑边。
2. **app 窗口自动最大化 + 去装饰**:给嵌套 openbox 专用配置
   `edex-monitor-openbox.xml`(写入 `/tmp`,由 backend.js 生成),
   `<application class="*"><maximized>yes</maximized><decor>no</decor></application>`,
   启动 openbox 时 `--config` 传入 —— **不动 :0 的 openbox、零新依赖**(无需 wmctrl)。
3. Phase C 真机验证:tab 4/5 选 Firefox → 应用铺满整个槽位、无黑场;若仍有细黑边
   (槽位比例实际略偏离 2:1),微调 `backend.js` 的 `SCREEN` 宽高即可。

### 兜底:Ubuntu 能不能走 mock?

**能,但那只影响 B 类(原生应用)。** `settings.appMonitor.mock` 手动设 `true`
(设置 → 应用监视器 → mock)真机的原生应用也会跑起来,长得和 macOS 预览一模一样"完美"。
但它只显示三个演示屏(假终端/矩阵/雷达),**Firefox 不会真的启动**;A 类(web 应用)
**不受 mock 影响**,仍是真 webview 加载真页面。
用途是**隔离问题**:如果 mock 下原生应用画面完美、real 下黑框,就证明 noVNC 渲染管线没问题,
锅全在 real 后端的应用启动/窗口布局上。
**不是**用户想要的"真机显示真 Firefox"方案。

---

## 15. 其他遗留项状态(不阻塞本轮)

- **#143「Welcome back 显示真实用户名」** = 已完成的 #133,重复项,可关。
- **#11 GRUB `file '/boot/' not found`** = 见第 4 节,装饰性报错,不进本轮。
- **#128 安装器 subiquity 崩溃** = 见第 8 节,需真机装 v2.3.0 抓 traceback。
