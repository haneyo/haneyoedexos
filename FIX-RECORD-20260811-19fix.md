# 19fix 完成记录(2026-08-12,已构建待部署)

> 基于 18fix 构建部署之后继续。构建基线:`/opt/edex/eDEX-UI.AppImage.orig-20260811`。
> 本轮 4 项任务全部落地:`packaging/patch-appimage.sh`(①屏保 ②锁屏)+ 系统级开机打磨(④)
> + 部署期清理(③ localStorage)。AppImage 产物:`/tmp/eDEX-UI.AppImage.19fix-20260811`。
>
> **追加修复(⑤ sysinfo 间距)**:2026-08-12 部署前又收到一条小反馈,已并入 19fix
> 重建。见下方「§0 追加修复(19fix 构建后)」。产物已用同一路径重建(185088762B,内容含⑤)。

## §0 追加修复:左上 LOAD/UPTIME/TYPE/POWER 单词间距不均

- **用户原话**:「左上角的 uptime 和 type 两个单词都挨到一起去了,load 和 power 和他们的间距
  又有些远,几个单词间距应该一样」。
- **根因(真机 OCR 实测)**:18fix 把 `div#mod_sysinfo div` 改成 `flex:1 1 0`(四列等宽均分,
  每列≈74px)仍保留左对齐 → 单词间距 = 列宽 − 词宽,UPTIME(6 字符,约 70px)几乎撑满自己那列,
  → 与 TYPE 粘连(OCR 直接读成 "UPTIMETYPE");LOAD(4 字符)留出 ~29px、POWER 留出 ~27px 大空隙。
- **修复(patch-appimage.sh mod_sysinfo.css transform)**:
  - 子项 `flex:1 1 0` → `flex:0 1 auto`(回到自然宽度,不再等宽均分);
  - 容器 `justify-content:space-between` → `space-evenly`(间隙与左右边距全部等分);
  - 子项 `align-items:flex-start` → `align-items:center` + `text-align:center`(抵消子项内
    label/value 宽度差)。`min-width:0` 保留兜底防溢出。
- **效果(数学验证,已对照真机截图像素)**:每个子项里 label 都比 value 宽(LOAD 45>30、UPTIME
  ~70>57、TYPE ~47>32、POWER 62>46)→ 子项宽=label 宽,居中后 label 零偏移 → 四个单词间距
  严格相等(=space-evenly 的值,约 13~18px),比原来的"远"(29px)还略紧;值行也均匀。
- **构建验证**:从重建产物 asar 提取 `assets/css/mod_sysinfo.css`,与旧 19fix 对比 diff 仅此一处;
  `lockScreen/renderer/appmonitorPanel/sysinfo` 四个 JS `node --check` 全过。

## §1 本轮任务(用户原话)

1. **code 屏保**(18fix 把它做成了全屏假代码,挡住整个 UI):改回「UI 显示假数据 + 假终端假代码,
   且假终端不影响真终端」。
2. **code 锁屏框**:加大、配色与整体 UI 一致。
3. **应用 tab**:默认不应显示 firefox(没打开任何 app 就不该显示)。
4. **开机去 Ubuntu 元素**:屏幕最下方 Ubuntu logo;进入 UI 前黑屏+原始鼠标;动画前白屏,均要去掉。

## §2 根因 + 修复方案

### ① code 屏保 — 全屏改回「UI 假数据 + 假终端」
- 18fix 的 `_mkSsvt` 用 `position:fixed;inset:0;background:#05080d`(全屏不透明)盖住整个 UI。
- 新实现:假终端 div(`#screensaver_vt`)改为 `position:absolute;inset:0;z-index:2500`,挂到
  `#main_shell_innercontainer` 内 → 只显示在终端区域;UI 其余部分由 `cover.set(!0)` 显示假数据。
  字体/配色读 `window.theme.terminal`。真终端 `term[0]` 全程不碰。

### ② code 锁屏框 — 加大 + 主题配色
- `_drawLockBox`/`_buildBoxRows` 盒宽 54→72;终端 fontSize 14→18(行数仍够放 22 行盒)。
- 锁屏假终端从全屏 lock_block 覆盖层改挂 `main_shell_innercontainer`,z-index:3200(盖过 #lock_block
  的 3000),独立 xterm,**不再拿真终端 term[0] 当画布** → 退出锁屏后真终端内容/滚动全部保留。
- 硬编码 ANSI 颜色全部改为由 `window.theme.terminal.foreground`(#aacfd1)派生:`_fc`(前景)、
  `_tb`(加粗)、`_rd`(红色警示)存到 `this._thC/_tbC/_rdC`,`_codeRedraw`/`_lockAnimTick` 复用。
  状态语义保留:绿=OK、黄=WAIT、暗红=警示。

### ③ 应用 tab 默认 firefox — 代码已修,根因在残留 localStorage
- **代码侧早已修好**(18fix 已部署):`appmonitorPanel.class.js` 的 `init()` 不再回退选第一个
  native(`AM_SEL`:仅当 localStorage 有匹配的保存应用才 `select`,否则 `t=null`);无选中时 tab
  显示 MONITOR A/B 并 `setTimeout(openAppList,500)` 自动打开应用列表;`_fetchStatus` 用
  `AM_LBL` 把 tab 更新为「当前运行应用 → 首个运行应用 → MONITOR A/B」。
- **但真机残留**:`~/.config/eDEX-UI/Local Storage/leveldb` 有 `edex_monitor_a_app="Firefox"`、
  `edex_monitor_b_app="Bing"`(旧版 bug 自动 select 时写入)。19fix 开机仍会 `find("Firefox")`
  命中并 `select(Firefox)` → 拉起 firefox。
- **解决**:部署 19fix 时清掉 `~/.config/eDEX-UI/"Local Storage"` 目录(eDEX 停止时执行)。

### ④ 开机去 Ubuntu 元素(系统级,不在 AppImage)
- **底部 Ubuntu logo** = edex plymouth 主题的 `watermark.png` 仍是 Ubuntu 圆标(spinner 主题自带,
  `install-edex.sh` 复制 PNG 时只跳过 bgrt-fallback,没跳 watermark;edex.plymouth
  `WatermarkVerticalAlignment=.96` 画在底部)。已把 watermark.png 换成**全透明** 1x1 PNG,
  并 `update-initramfs -u`(6.8.0-137 与 6.8.0-71 两个内核都重生成,已验证 initrd 内 alpha=0)。
- **黑屏+原始鼠标** = 真机 `edex-session.sh` 写 `XCURSOR_THEME=DMZ-Black`,但 `dmz-cursor-theme`
  **未安装** → X 回退原始黑白箭头。已改 `XCURSOR_THEME=edex`(内置 WP7 暗色主题),并补
  `xsetroot -cursor_name left_ptr` 立即切暗色箭头(openbox 起来前覆盖首帧)。
- **白屏才显示动画** = GRUB `GRUB_TERMINAL_OUTPUT="console"`(VGA 文本)在 EFI framebuffer 上
  的模式切换 → 白/空帧。已改 `gfxterm` + `GRUB_GFXMODE=1920x1080,1024x768,800x600,auto`
  + `GRUB_GFXPAYLOAD_LINUX=keep`(GRUB 原生分辨率黑底渲染,内核沿用同一 framebuffer,无切换)。
  gfxterm 失败会自动回退 console,不影响引导。已 `sudo update-grub`。

## §3 仓库改动

- `packaging/patch-appimage.sh`:①屏保 `_mkSsvt`、②锁屏 LOCK1_NEW + BOX*/CODE*/LOCKANIM*
  颜色/尺寸常量(③ appmonitor 改动 18fix 已含,本轮未动)。
- `packaging/install/install-edex.sh`(源):GRUB gfxterm 块;plymouth spinner 复制跳过
  watermark.png + 写全透明 watermark(base64 内嵌 1x1);session 脚本补 `xsetroot -cursor_name
  left_ptr`。
- `ubuntu-side-changes.md` §1 重写:GRUB gfxterm、光标 edex、§1.1 watermark 根因与真机验证。
- `CONTINUE.md` 顶部更新为 19fix 状态与部署命令。

## §4 构建与验证(已执行)

```bash
bash packaging/patch-appimage.sh /opt/edex/eDEX-UI.AppImage.orig-20260811 /tmp/eDEX-UI.AppImage.19fix-20260811
```
- 产物 `/tmp/eDEX-UI.AppImage.19fix-20260811`(185088762B)。
- **重建**:2026-08-12 追加 sysinfo 间距修复后,用同一命令重建覆盖(产物仍 185088762B);
  `mod_sysinfo.css 851B -> 886B`。
- 从产物 asar 提取 `classes/lockScreen.class.js`(24229B)、`_renderer.js`(148302B)、
  `classes/appmonitorPanel.class.js`(14776B)、`classes/sysinfo.class.js`,`node --check` 全通过。
- 内容核对:lockScreen `fontSize:18`、`"═".repeat(70)`×3(无 54 残留)、`_fc=this._thC=`、
  `z-index:3200`、`main_shell_innercontainer` 挂载;appmonitor AM_SEL_NEW/AM_LBL_NEW/openAppList
  均在、旧 auto-select 无残留;renderer `#screensaver_vt` + `z-index:2500` 均在。
- 真机开机文件已改:watermark(两内核 initrd 验证透明)、GRUB gfxterm(update-grub done)、
  edex-session.sh(edex 光标 + xsetroot -cursor_name)。**重启生效**。

## §5 部署(先问用户)

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.19fix-20260811 /opt/edex/eDEX-UI.AppImage && sudo chmod 755
sudo rm -rf ~/.config/eDEX-UI/"Local Storage"     # 清残留 edex_monitor_*_app=Firefox/Bing
sudo systemctl start lightdm
# 随后重启,验收开机画面(§2 ④)与 19fix UI
```

## §6 重启后验证清单

- [ ] 开机:黑底 GRUB(gfxterm)无白屏 → edex 动画黑底、居中 wordmark、底部**无** Ubuntu logo
      → 黑底 lightdm → eDEX 锁屏;全程无原始箭头。
- [ ] code 屏保:UI 假数据可见,假代码只在终端区域,退出/解除不破坏真终端内容。
- [ ] code 锁屏:框更大、配色与 UI 一致;解锁后真终端内容/滚动原样保留。
- [ ] 应用 tab:开机无 firefox;未开 app 时显示 MONITOR A/B 并自动弹出应用列表;开 app 后显示其名。
