# eDEX-OS — 可安装的发行版镜像(改装 Ubuntu Server 24.04)

把 eDEX-UI 装进一个改装过的 Ubuntu Server 24.04,做成可烧录安装的 ISO。装好后**开机直接进 eDEX 全屏科幻界面**,Linux 本身照常能 `apt` 装应用(deb / AppImage)。

## 产物形态

| 东西 | 说明 |
|---|---|
| `build-iso.sh` | 核心构建脚本:下载官方 Ubuntu Server 24.04 ISO → 注入 autoinstall(nocloud 数据源)→ 改 GRUB 内核参数 → 重打包可启动 ISO。**不动 squashfs 与签名 EFI 引导链,Secure Boot 保留。** |
| `autoinstall/user-data` | Subiquity autoinstall:`interactive-sections` 让 locale/网络/分区/建用户仍像装 Ubuntu 一样交互,其余自动化;`late-commands` 装 eDEX。 |
| `install/install-edex.sh` | 装完系统后运行:xorg + lightdm 自动登录 + openbox + eDEX AppImage + appmonitor 依赖 + eDEX 配置预置。 |
| `build-iso-local.sh` | 在 Ubuntu 24.04 机器上本地构建(自动先编 AppImage)。 |

## 一、构建 ISO

### 方式 A:GitHub Actions(推荐,无需本地 Linux)
1. 把本仓库推到 GitHub。
2. Actions → **Build eDEX-OS ISO** → Run workflow(可改 Ubuntu ISO 地址)。
3. 完成后下载 `eDEX-OS-ISO` artifact 里的 `.iso`。

### 方式 B:本地构建(Ubuntu 24.04 机器 / 笔记本)
```bash
sudo apt install -y git curl squashfs-tools xorriso
git clone <your-repo> && cd <repo>
bash packaging/build-iso-local.sh            # 自动下载官方 ISO 并构建
# 产物: eDEX-OS-local.iso
```

## 二、装到笔记本
1. 烧录:`dd if=eDEX-OS-*.iso of=/dev/sdX bs=4M status=progress`(或用 balenaEtcher / Rufus)。U 盘 ≥8GB。
2. 笔记本开机进 BIOS/UEFI 启动菜单,选 U 盘启动(可关 Secure Boot 或保持开启——本镜像不改引导链,Secure Boot 可用)。
3. 走一遍 Ubuntu 式安装:选语言 / 连网 / 分区 / 建用户名密码。其余自动。
4. 安装完重启 → **自动登录并直接进入 eDEX 全屏**。

## 三、用起来
- **终端 tab 1/2/3**:前两个是终端,第 3 个是内嵌 Claude(需自行 `claude` CLI + 配置 API Key)。
- **tab 4 / 5(虚拟显示器)**:点 tab 标签旁的 ▾ 下拉,选一个已安装应用(xterm 等)/ 网页(已预置 Google/Bing)/ 手动添加 AppImage 或网址。原生应用显示在终端框内(noVNC 流式),网页直接加载。
- **原生全屏**:tab 内点右上角全屏按钮 → 应用**直接接管整块屏幕原生运行**(不再流式);屏幕角落有一个不显眼的 `◀ EDEX` 小按钮,点击回到 eDEX;`Ctrl+Shift+Q` 是兜底热键。
- **装应用**:就是普通 Ubuntu——`sudo apt install <app>` 或 AppImage。
- **像 macOS 一样放 AppImage**:把 `.AppImage` 文件丢进主目录的 `~/Applications`(装机时已自动创建),tab 4/5 的 ▾ 下拉就会直接列出它,选中即可显示。点开下拉菜单会自动重新扫描,新放的文件无需重启。
- **锁屏/屏保**:闲置自动进入 eDEX 风格纯代码屏保(可在设置里改)。

## 四、常见问题
- **安装时提示联网**:autoinstall 的 late-commands 会 apt 安装 xorg/eDEX 依赖,装机时需联网(插网线或配好 WiFi)。
- **tab 里看不到应用**:检查 `设置 → 应用监视器` 的 Mock 后端是否为「真实」/「自动」;`scripts/setup-appmonitor.sh` 已由安装脚本执行。
- **全屏后角落按钮被盖住**:用 `Ctrl+Shift+Q` 返回(按钮层级需在真机上微调 openbox 配置)。
- **改底包版本**:`build-iso.sh` 只针对 24.04 Server(GRUB2 eltorito 布局);换版本需重新核对 `-report_el_torito` 启动标志。

## 五、目录结构
```
packaging/
  build-iso.sh            # 核心 remaster 脚本
  build-iso-local.sh      # 本地一键构建
  autoinstall/            # Subiquity autoinstall(user-data / meta-data)
  install/install-edex.sh # 装机后的系统配置脚本
```
