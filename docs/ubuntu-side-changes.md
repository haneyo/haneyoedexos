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
   才真正生效 → 开机黑底 spinner 动画,不再滚文本。
2. **GRUB 暗色主题**:`/etc/default/grub` 保留可靠的 VGA 文本控制台(任何 GPU 都能用),
   但改黑底白字/青色高亮(原 Ubuntu 紫色界面是"难看"的元凶之一)。
   GRUB 菜单上方闪的 `error: file '/boot/' not found` 与这份配置无关 —— 来自 UEFI 签名
   grubx64.efi 内嵌配置,纯装饰(#11,不影响引导)。
3. **光标统一 + 黑根窗口**:系统默认 X 光标主题改 DMZ-Black(暗色,和 eDEX 配色一致),
   会话启动时 `xsetroot -solid black` 把 X 根窗口涂黑 —— lightdm greeter 关掉、eDEX
   窗口还没映射的瞬间(之前白屏 + 原生箭头)变黑底黑光标。

**真机验证:**
```bash
cat /etc/default/grub | grep CMDLINE_LINUX_DEFAULT   # 应含 quiet splash
cat /etc/default/grub | grep -E "GRUB_COLOR|TERMINAL" # 应见 dark 配色
plymouth-set-default-theme                             # 应输出 spinner
lsinitramfs /boot/initrd.img-* | grep plymouth | head   # 应列出 plymouth 文件
update-alternatives --list x-cursor-theme               # 应含 DMZ-Black
grep -A2 "Icon Theme" /usr/share/icons/default/index.theme  # 默认主题
```

开机应看到:GRUB 黑底菜单 → spinner 动画 → 黑底 lightdm → eDEX 锁屏,全程无白屏无原生
箭头。看到纯文本滚动 = plymouth 没生效(跑 `sudo update-initramfs -u && sudo update-grub`
后重启)。

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

## 3. 输入法 fcitx5 + Rime(#16)— 已自动化,需真机验证

根因:fcitx5 守护进程和 IM 环境变量都正常(edex-session.sh 启动 `fcitx5 -d`,
GTK_IM_MODULE/QT_IM_MODULE/XMODIFIERS 已导出),但**没写 fcitx5 profile** →
引擎列表为空 → Ctrl+Space 无输入法可切换 → 一直 EN。

install-edex.sh 现在会写 `/home/<user>/.config/fcitx5/profile`:
两个输入法 = `keyboard-us`(英文,默认)+ `rime`(中文,Ctrl+Space 切换),
并同步播种到 `/etc/skel`(后续新建用户也带)。Rime 首次激活时自动初始化词库。

**真机验证:**
```bash
cat ~/.config/fcitx5/profile          # 应含 Groups/Items 的 keyboard-us + rime
fcitx5-diagnose | head -60            # 应看到 fcitx5-rime 引擎与 profile 加载
# 在任意应用(终端/浏览器)按 Ctrl+Space,候选窗应出现,可输入中文
```

若 Ctrl+Space 仍无效,按顺序诊断并输出发回:
```bash
ps aux | grep fcitx5                  # 守护进程应在跑(edex-session.sh 启动)
echo $GTK_IM_MODULE $QT_IM_MODULE $XMODIFIERS   # 应都是 fcitx / @im=fcitx
fcitx5-diagnose | head -80            # 重点看 input method 与 profile 段
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
