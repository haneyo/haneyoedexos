<p align="center">
  <img alt="eDEX-OS" src="media/logo.png" width="360">
</p>

<p align="center"><strong>把一部笔记本电脑，变成电影里的科幻电脑。</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/base-Ubuntu%20Server%2024.04-orange">
  <img src="https://img.shields.io/badge/runtime-Electron%2042-blue">
  <img src="https://img.shields.io/badge/license-GPLv3-red">
</p>

eDEX-OS 基于深度定制的 [eDEX-UI](https://github.com/GitSquared/edex-ui)(一套科幻终端模拟器 + 系统监视器),进一步把它**变成一套真正的桌面操作系统**:改装 Ubuntu Server 24.04 生成可安装的 ISO,装好后**开机直接进入 eDEX 全屏科幻界面**,而底下的 Linux 一切照常——`apt` 装软件、跑 AppImage,都行。

---

## ✨ 亮点

| 能力 | 说明 |
|---|---|
| **虚拟显示器(tab 4 / 5)** | 把原生 Linux 应用(GTK/Qt/AppImage)直接"显示进"终端标签页内(noVNC 流式渲染);也支持网页应用。点标签旁 ▾ 切换应用、可手动添加 AppImage/命令/网址,菜单支持键盘操作(↑↓ + Enter + Esc)。 |
| **原生全屏** | 点全屏按钮,应用**完全原生地**接管整块真实屏幕(不再是流式画面);屏幕角落有不显眼的 `◀ EDEX` 按钮、或 `Ctrl+Shift+Q` 热键,一键回到 eDEX。 |
| **内嵌 Claude Code(tab 3)** | 第 3 个终端标签是专用的 Claude Code 工作区。 |
| **终端 + 系统监视** | 完整终端模拟器(多标签、颜色、鼠标、`curses`)、CPU/RAM/进程/网络实时监视、跟随终端目录的文件浏览器。 |
| **深度定制模块** | CyberPanel 雷达面板、迷你音乐控制器、媒体播放器、ENCOM 风格地球仪、网页应用面板、纯代码风格的科幻屏保/锁屏。 |
| **键盘可操作 UI** | 设置菜单与各类面板支持方向键导航,面向纯键盘/手柄操作设计。 |

## 📸 界面

![默认界面](media/screenshot_default.png)

![blade 主题](media/screenshot_blade.png)

![horizon 主题](media/screenshot_horizon.png)

<details>
<summary>演示动图</summary>
<img src="media/youtube-demo-teaser.gif" width="480">
</details>

---

## 🚀 快速上手(开发)

在 macOS / Linux 上从源码运行:

```bash
# 依赖安装
npm run install-linux        # 或 install-darwin / install-windows
# 运行
npm start
```

> 开发机上没有真实 Linux 时,tab 4/5 会自动使用内置的 **mock 演示后端**(纯代码渲染的画面),无需 X 服务器即可体验整条链路。

## 📦 构建

```bash
# 构建 AppImage(Linux x64)
npm install
npm run prebuild-linux
./node_modules/.bin/electron-builder build -l --x64

# 构建可安装的 eDEX-OS ISO
#   方式一:GitHub Actions 里手动触发 "Build eDEX-OS ISO"
#   方式二:在 Ubuntu 24.04 机器上
bash packaging/build-iso-local.sh
```

## 💽 装机(把 eDEX-OS 装到一台电脑)

1. 从 GitHub Actions 下载 `eDEX-OS-ISO` artifact,或用 `build-iso-local.sh` 本地构建。
2. 烧录 U 盘:`dd if=eDEX-OS-*.iso of=/dev/sdX bs=4M status=progress`(或 balenaEtcher / Rufus)。
3. 笔记本从 U 盘启动,走一遍 Ubuntu 式安装(选语言 / 分区 / 建用户名密码,其余自动化)。
4. 重启 → **自动登录并直接进入 eDEX 全屏**。

完整装机与使用说明见 [`packaging/README.md`](packaging/README.md)。

## 🗂️ 项目结构

```
src/                    # eDEX-UI 前端 + Electron 主进程
  appmonitor/           # 虚拟显示器后端(mock RFB / real Xvfb+x11vnc + noVNC 客户端)
  classes/              # 界面模块(含 appmonitorPanel / webapps / miniAudio ...)
packaging/              # 发行版打包(autoinstall / 安装脚本 / ISO 构建)
scripts/                # 辅助脚本(如 appmonitor 依赖安装)
.github/workflows/      # CI(构建 AppImage / 构建 eDEX-OS ISO)
```

## 📄 许可与致谢

- 基于 [eDEX-UI](https://github.com/GitSquared/edex-ui) 深度定制,原作者 Gabriel "Squared" Saillard;遵循 [GPLv3.0](LICENSE)。
- noVNC 内核来自 [@novnc/novnc](https://github.com/novnc/noVNC)(MPL-2.0,已 vendor 到 `src/assets/vendor/novnc`)。
- 界面风格致敬《创:战纪》(TRON: Legacy)。
