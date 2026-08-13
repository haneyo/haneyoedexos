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

**AppImage 来源**(`appimage_source` 输入):
| 选项 | 说明 |
|---|---|
| `latest-release`(默认) | 直接取 GitHub 最新 Release 的 AppImage → **ISO 与在线更新永远是同一个最新版本** |
| `tag` | 取指定 Release tag 的 AppImage(配合 `tag` 输入) |
| `source` | 从当前 commit 源码现场编译(做预发布 / 开发验证时用) |

> 推荐日常构建用默认的 `latest-release`:这样「从 GitHub 构建的 ISO」和「装机后在线更新」给的都是同一份最新版,不会出现 ISO 比在线更新还新的错位。

### 方式 B:本地构建(Ubuntu 24.04 机器 / 笔记本)
```bash
sudo apt install -y git curl squashfs-tools xorriso
git clone <your-repo> && cd <repo>
bash packaging/build-iso-local.sh            # 自动下载官方 ISO 并构建(本地始终从源码编译)
# 产物: eDEX-OS-local.iso
```

## 二、装到笔记本
1. 烧录:`dd if=eDEX-OS-*.iso of=/dev/sdX bs=4M status=progress`(或用 balenaEtcher / Rufus)。U 盘 ≥8GB。
2. 笔记本开机进 BIOS/UEFI 启动菜单,选 U 盘启动(可关 Secure Boot 或保持开启——本镜像不改引导链,Secure Boot 可用)。
3. 走一遍 Ubuntu 式安装:选语言 / 连网 / 分区 / 建用户名密码。其余自动。
4. 安装完重启 → 首次开机先跑一次「系统初始化」向导(xterm 里设置 **root 密码**和**解锁 PIN**,4-8 位数字,均输入两次确认),设完自动进 **eDEX 全屏**。PIN 即为闲置锁屏的解锁码(锁屏仅支持数字)。

## 三、用起来
- **终端 tab 1/2/3**:前两个是终端,第 3 个是内嵌 Claude(需自行 `claude` CLI + 配置 API Key)。
- **tab 4 / 5(虚拟显示器)**:点 tab 标签旁的 ▾ 下拉,选一个已安装应用(xterm 等)/ 网页(已预置 Google/Bing)/ 手动添加 AppImage 或网址。原生应用显示在终端框内(noVNC 流式),网页直接加载。
- **原生全屏**:tab 内点右上角全屏按钮 → 应用**直接接管整块屏幕原生运行**(不再流式);屏幕角落有一个不显眼的 `◀ EDEX` 小按钮,点击回到 eDEX;`Ctrl+Shift+Q` 是兜底热键。
- **装应用**:就是普通 Ubuntu——`sudo apt install <app>` 或 AppImage。
- **像 macOS 一样放 AppImage**:把 `.AppImage` 文件丢进主目录的 `~/Applications`(装机时已自动创建),tab 4/5 的 ▾ 下拉就会直接列出它,选中即可显示。点开下拉菜单会自动重新扫描,新放的文件无需重启。
- **浏览器开箱即用**:系统已内置 **Firefox**(官方版,离线可用),在 tab 4/5 的 app 列表里直接选;全屏按钮可原生全屏浏览。
- **邮件客户端**:app 列表里有 **aerc**(带操作界面的终端邮件客户端),首次启动按提示配置邮箱账号即可收发邮件。
- **Node.js 24 LTS**:系统已内置最新 LTS(apt 的 nodejs 是 18,已替换),`node`/`npm`/`npx` 直接可用,内置的 Claude CLI 依赖它。
- **锁屏/屏保**:闲置自动进入 eDEX 风格纯代码屏保(可在设置里改)。

## 四、常见问题
- **安装时提示联网**:autoinstall 的 late-commands 会 apt 安装 xorg/eDEX 依赖,装机时需联网(插网线或配好 WiFi)。
- **tab 里看不到应用**:检查 `设置 → 应用监视器` 的 Mock 后端是否为「真实」/「自动」;`scripts/setup-appmonitor.sh` 已由安装脚本执行。
- **全屏后角落按钮被盖住**:用 `Ctrl+Shift+Q` 返回(按钮层级需在真机上微调 openbox 配置)。
- **改底包版本**:`build-iso.sh` 只针对 24.04 Server(GRUB2 eltorito 布局);换版本需重新核对 `-report_el_torito` 启动标志。
- **每次回车都弹 `t.setAttribute is not a function`**:eDEX 键盘层的 Enter 处理器在空 NodeList 上 `setAttribute` 抛错。`build-iso.sh` 会自动用 `patch-appimage.sh` 修补(把 `t.length?` 改为 `t.forEach?`);已装机可对 `/opt/edex/eDEX-UI.AppImage` 单独跑 `bash packaging/patch-appimage.sh <AppImage>` 后重启。
- **天气弹窗字体跟整体 UI 不一样**:`.mod_wx*` 规则误用终端字体 `--font_mono`。`patch-appimage.sh` 已改为 `--font_main`(整体 UI 字体),其余 modal 不受影响。
- **电池图标外框与发光条没对准**:满电时发光条右端插进外框右圆角、整体右偏。`patch-appimage.sh` 已把条宽 `23*s/100` 改为 `21*s/100`,条居中贴合外框内部。

## 五、目录结构
```
packaging/
  build-iso.sh            # 核心 remaster 脚本(烘焙前自动对 AppImage 打补丁)
  build-iso-local.sh      # 本地一键构建
  patch-appimage.sh       # 就地修复 eDEX AppImage 的多个 UI 问题:keyboard 回车报错 / 天气弹窗字体 / 电池图标对准(独立脚本,幂等)
  autoinstall/            # Subiquity autoinstall(user-data / meta-data)
  install/install-edex.sh # 装机后的系统配置脚本
```
