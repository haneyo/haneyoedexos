# Ubuntu 端改动清单(装机后/真机上执行)

> 适用范围:**无法在 macOS 构建侧完成**、必须在 Ubuntu 安装机(chroot)或**真实硬件**上执行的操作。
>
> 凡标记「已自动化」的条目,都已经写进 `packaging/install/install-edex.sh`,装系统时由 curtin
> 在目标 chroot 里自动跑——**这里只列真机验证步骤和手动兜底命令**,装机后在 Ubuntu 机器上照着做。
>
> 现状说明:这些改动已提交到仓库源文件,下一次 CI/本地构建产生的 ISO 才会包含。已装机的旧 ISO
> 不受影响,需要重装新 ISO 才能拿到以下修复。

---

## 1. 开机 plymouth 启动动画(#19)— 已自动化,需真机验证

install-edex.sh 现在会在装系统时自动执行(chroot 依赖,正是只能 Ubuntu 侧做的原因):

```bash
cat > /etc/default/grub <<'GRUB'
GRUB_DEFAULT=0
GRUB_TIMEOUT=2
GRUB_DISTRIBUTOR=`lsb_release -i -s 2>/dev/null || echo Debian`
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"     # ← 关键:让 plymouth 真正启动
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL_OUTPUT="console"
GRUB_DISABLE_OS_PROBER=true
GRUB
plymouth-set-default-theme spinner
update-initramfs -u
update-grub
```

**真机验证:**
```bash
cat /etc/default/grub | grep CMDLINE_LINUX_DEFAULT   # 应含 quiet splash
plymouth-set-default-theme                             # 应输出 spinner
sudo update-initramfs -u && sudo update-grub           # 兜底,重跑一遍
lsinitramfs /boot/initrd.img-* | grep plymouth | head   # 应列出 plymouth 文件
```

开机应看到 spinner 动画代替纯文本滚动;看不到时跑上面兜底命令后重启。

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

## 3. 开机 GRUB 报错 "file '/boot/' not found"(#11)— 装饰性,优先级低

已定位:**Ubuntu 官方签名的 `grubx64.efi` 内嵌 memdisk 配置**引用了一个不存在的 `/boot/grub`
路径,报错来自 EFI 固件加载阶段,不影响实际引导。ISO 文件层面无法安全消除(改动签名 EFI 会破坏
Secure Boot)。若日后要彻底清除,需在 Ubuntu 真机上重新生成 grubx64.efi(自定义签名链),工作量
大、风险高——**当前结论:保留,不进本轮范围**。

---

## 4. Claude CLI — 已内置 + 构建期强校验,首次使用需配 API key

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

## 5. 装机后完整自检清单(建议首启跑一遍)

```bash
# WiFi
nmcli radio && nmcli dev wifi list
# Claude
claude --version
# 输入法(Rime)
fcitx5-diagnose | head -40          # 确认 fcitx5-rime 引擎在
# plymouth
cat /etc/default/grub | grep splash
# 时间
timedatectl
# 电源管理
cat /etc/systemd/logind.conf.d/edex.conf
# 挂载/网络栈
ls /etc/netplan/
```

每项结果发回,用于更新 `docs/first-boot-issues.md` 的状态。
