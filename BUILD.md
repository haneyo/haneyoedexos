# eDEX-UI 多平台构建说明

本工程已包含所有源码与构建配置，可在 **Windows / Linux / macOS** 上分别构建对应平台的安装包。

## 依赖

- [Node.js](https://nodejs.org/)（建议 LTS）
- npm（随 Node 安装）

## 各平台构建步骤

### 通用步骤（每个平台都一样）

```bash
# 1. 安装根目录依赖
npm install

# 2. 安装前端源码依赖（含 node-pty 原生模块）
cd src
npm install
cd ..
```

> 注意：如果 npm 版本较新（12+），可能会**拦截 node-pty / ffmpeg-static 的安装脚本**。
> 若 `npm install` 后出现 `install scripts blocked` 警告，请执行：
> ```bash
> npm install-scripts approve node-pty ffmpeg-static && npm install
> ```

### macOS（生成 arm64 DMG）

```bash
npm run prebuild-darwin
npm run build-darwin
# 产物：dist/eDEX-UI-macOS-*.dmg
```

### Windows（生成 exe 安装包）

```bash
npm run prebuild-windows
npm run build-windows
# 产物：dist/eDEX-UI-Windows-*.exe
```

### Linux（生成 AppImage）

```bash
npm run prebuild-linux
npm run build-linux
# 产物：dist/eDEX-UI-Linux-*.AppImage
```

## 说明

- **原生模块**：`node-pty`（终端）按平台在构建时编译/下载对应二进制，`afterPack.js` 钩子会自动清理掉无关平台的预编译文件，保证各平台包干净。
- **ffmpeg**：媒体转码用的 `ffmpeg-static` 二进制在 `npm install` 时按平台下载；若脚本被拦截需按上面步骤 approve。
- **隐私**：构建配置已禁用代码签名（`identity: null`），不会嵌入个人开发者身份。
- 若首次打开 macOS 包提示"无法验证开发者"，右键 → 打开 一次即可。
