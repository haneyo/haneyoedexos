# 交接文档 — 28fix:内置 BTOP/FASTFETCH/FFMPEG + sysinfo 超负荷红光闪烁(2026-08-12)

> 任务清单唯一权威 = 根目录 [`TODOS.md`](TODOS.md)。
> 本轮同时完成 A1 区 4 项(#7/#10/#11/#12);A2 区与 #2/#8/#9 未动,见 TODOS.md。

---

## §1 本轮成果概览

| # | 内容 | 状态 |
|---|---|---|
| #7 | 内置 BTOP 显示在 APP 列表(tab4/5 CLI 面板) | ✅ 补丁已入 **28fix**,待重启部署 |
| #10 | 内置 FASTFETCH(用户澄清**只装 app**,不做开机/欢迎显示系统信息) | ✅ 本机已装,免部署 AppImage |
| #11 | 确保内置 FFMPEG | ✅ 本机已装,免部署 AppImage |
| #12 | 超负荷时 CPU型号 / MEMORY USING / NETWORK UP·DOWN 文字**柔和红光闪烁** | ✅ 补丁已入 **28fix**,待重启部署 |

**28fix 产物**:`/tmp/eDEX-UI.AppImage.28fix-20260812`(185096954B),从 pristine 基线
`/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建,含**全部历史修复 + 本轮新增**,21 个
target 全命中、node --check 全过、重打幂等 21/21 no-op。

---

## §2 #7 内置 BTOP(显示在 APP 列表)

**需求**:apt 装 btop;tab4/5 CLI 会话面板默认列表出现 BTOP。

**改动**:
1. **真机**:`sudo apt-get install -y btop` → `/usr/bin/btop`,v1.3.0 ✓
2. **补丁链** `packaging/patch-appimage.sh`:`CLI_PANEL_CLASS` 的 `window.cliApps` 默认列表
   `htop` 后追加 `{ id: "btop", name: "BTOP", cmd: ["btop"] }`(注入于 `_renderer.js` mega target,
   expectOut `'window.cliApps = [ { id: "claude"'` 不变,幂等不受影响)。
3. **装机** `packaging/build-iso.sh`:APTOPTS 加 `btop`(未来装机自带)。

**效果**:重启后 tab4/5 应用列表含 Claude / Browser / htop / **BTOP**,选中即起
`btop` CLI(走既有 ttyspawn 通道)。用户也可继续用 "+ ADD APP" 自加。

---

## §3 #10 内置 FASTFETCH(只装 app,不做开机显示)

**用户澄清(2026-08-12)**:只装 fastfetch 这个 app,不需要开机/欢迎信息显示系统信息。
TODOS.md 原"开机/欢迎信息显示"描述已按澄清更新。

**难点**:Ubuntu noble 官方源**无 fastfetch 包**(apt-cache policy/search 均空)。

**改动**:
1. **真机**:从 GitHub release 下载 v2.67.0 deb → `sudo apt-get install -y /tmp/fastfetch.deb`
   → `/usr/bin/fastfetch`,`fastfetch 2.67.0 (x86_64)` ✓(依赖仅 libc6 ≥2.35,免额外)。
2. **装机** `packaging/build-iso.sh`:新增 `INSTALL_FASTFETCH`(curl 下载 GitHub release
   `fastfetch-linux-amd64.tar.gz` 静态二进制 → `install -m 755` 到 `/usr/local/bin/fastfetch`),
   并接入 chroot / proot 两个分支(`$INSTALL_CLAUDE; $INSTALL_FASTFETCH`)。失败则终止构建。
   版本 `FASTFETCH_VER="2.67.0"` 便于后续升级。

**不进 APP 列表**(与 #11 一致,纯系统工具,终端里随时 `fastfetch` 可用)。

---

## §4 #11 确保内置 FFMPEG

1. **真机**:`sudo apt-get install -y ffmpeg` → `/usr/bin/ffmpeg`,v6.1.1-3ubuntu5 ✓
2. **装机** `packaging/build-iso.sh`:APTOPTS 加 `ffmpeg`。

---

## §5 #12 超负荷时 CPU型号/MEMORY USING/NETWORK UP·DOWN 红光闪烁(勿刺眼)

**需求**:超负荷时三处文字按各自占用率阈值加 class + **柔和**红色闪烁动画。

**改动**(6 个新 target,均独立文件,追加在 targets 数组尾部):

| 文件 | 阈值 | 逻辑 |
|---|---|---|
| `classes/cpuinfo.class.js` | CPU 平均 load ≥ **90%** | 型号 `<i>` 加 `id="mod_cpuinfo_model"`;updateCPUload(每 500ms)里平均负载 ≥90 时加 `.edex_overload`,否则移除 |
| `classes/ramwatcher.class.js` | 内存占用(used/total)≥ **90%** | updateInfo(每 1.5s)里切 `.edex_overload` |
| `classes/conninfo.class.js` | UP 或 DOWN 瞬时速率 ≥ **10 MB/s**(≈80Mbps) | updateInfo(每 1s)里切 `.edex_overload` |
| `assets/css/mod_cpuinfo.css` | — | `.edex_overload` 红色 + `@keyframes edex_overload_flash`(1.2s ease-in-out,峰值 `rgba(255,90,90,.9)`、谷 `rgba(255,90,90,.3)` + opacity 抖动,柔和不刺眼) |
| `assets/css/mod_ramwatcher.css` | — | 同上(选择器 `div#mod_ramwatcher_inner>h1:first-child>i.edex_overload`) |
| `assets/css/mod_conninfo.css` | — | 同上(选择器 `div#mod_conninfo i.edex_overload`) |

**关键点**:
- 三个 JS 注入都用**箭头 IIFE** `(()=>{...})()`(conninfo 内需 `this.current`,箭头才能捕获类实例 this)。
- 三个 CSS 各自带完整 `@keyframes`(同名重复定义无害,避免依赖加载顺序)。
- 阈值/颜色都可改:阈值在 patch 脚本里 `>=90` / `>=10`,颜色 `rgba(255,90,90,…)`。

**验证**(§6)已确认:`mod_cpuinfo_model` ×1、cpuinfo `.edex_overload` ×1、ramwatcher
`_m.classList.add("edex_overload")` ×1、conninfo `this.current.classList` ×1、三个 CSS
`edex_overload_flash` 各 ×1;4 个补丁 JS `node --check` 全过。

---

## §6 验证

- **构建**:`bash packaging/patch-appimage.sh /opt/edex/eDEX-UI.AppImage.orig-20260811 /tmp/eDEX-UI.AppImage.28fix-20260812`
  → 185096954B,21/21 target patched(含历史 15 + 本轮 6)。`_renderer.js` 157343B→157388B
  (恰为 btop 条目 45B)。
- **node --check**:`_renderer.js` / `cpuinfo.class.js` / `ramwatcher.class.js` / `conninfo.class.js` 全过。
- **标记核对**:见 §5 验证段,全部命中;旧串(未打补丁的原始锚点)在产物中不再以可重打形式存在。
- **幂等**:对 28fix 重跑 patch-appimage.sh → 21/21 "already patched, no-op" → "nothing to patch"。✓
- **本机安装**:btop 1.3.0 / fastfetch 2.67.0 / ffmpeg 6.1.1 均已 `command -v` 确认。

---

## §7 部署(需重启 eDEX,会杀掉当前会话)

> 按铁律:**先写交接文档 → 再推 GitHub → 最后才重启**,顺序不能反。本会话运行在 eDEX
> 进程树内,重启即杀掉本会话,故不代做,交给用户/下个会话执行。

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.28fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.28fix-20260812 /opt/edex/` 留存一份。

**重启后验证要点**:
- tab4/5 CLI 面板应用列表含 **BTOP**,选中能启动 btop 全屏会话(#7);
- 终端里 `fastfetch` / `ffmpeg -version` / `btop` 可用(#10/#11);
- 高负载时(如 `stress` 或开多个应用)CPU 型号 / MEMORY 行文字柔和红闪,恢复后熄灭(#12);
  下载/上传大流量时 NETWORK 行红闪。

---

## §8 遗留待办

> 唯一权威 = [`TODOS.md`](TODOS.md)。本轮范围外:
> - **#8 AXEL**(替换设置里 UGET 菜单)、**#9 CLASH 设置增强**:下一轮,已定位现有
>   UGET/CLASH 设置实现(src/_renderer.js download 分类 / _boot.js mihomo 管理,见
>   本轮 Explore 结论,可在 FIX-RECORD 或 docs 下补一份定位备忘)。
> - **#2 终端滚动修复**(历史遗留)、A2 区 **#174 用户名** / **#183 开机过渡**。
> - 注意:UGET 现走 appmonitor(`appmonitorApi.launch("a", id)`),而虚拟显示器路线已放弃
>   (appMonitor.enabled=false,#4 已移除)→ **#8 AXEL 不能再走 appmonitor**,应改走 CLI 会话面板
>   (tab4/5)或设置内直接拉起终端跑 axel,方案待定。
