# 交接文档 — 20fix:锁屏/屏保改独立真实终端(2026-08-12)

> 本文件记录 **#20 锁屏/屏保改独立真实终端** 的完整实现、验证与部署步骤,以及用户本轮
> 新增的**下一轮功能需求**(内置 BTOP / AXEL 替换 UGET / CLASH 增强 / FASTFETCH / FFMPEG)。
> 重启后 / 换会话后,先读本文件即可无缝续接。任务清单见文末 §5。

---

## §1 #20 完成总结

### 1.1 用户拍板的设计(两次权威确认)

- 「锁屏框可以借鉴老版本,使用纯代码比较好」—— 锁屏框用**纯代码**(ASCII 框 + 假代码流),
  不是 HTML overlay。
- 「CODE 模式的锁屏和屏保其实老版本就不错(更老的运行在终端的版本),我们要做的主要是用
  一个新的一次性终端替代旧版本的在真终端跑的锁屏和屏保」—— 视觉效果沿用老版本,核心是
  把「虚假绘制 / 跑真终端」换成:**每次新建一个一次性独立真实终端(node-pty + WebSocket,
  跑 cat 回显),unlock/dismiss 即销毁**,完全不碰 tabs1-5 的真实终端。

### 1.2 改动(commit `7f2faa3`,packaging/patch-appimage.sh)

| 文件 | 变换 | 内容 |
|---|---|---|
| terminal.class.js | T1 / T1b / T1c | 客户端加 `muted` 选项;`muted:!0` 时不播 stdout/info 音效 |
| lockScreen.class.js | L1 | `_showTerminalLock` 不再 `new T({cols:120,...})` 假 xterm,改为 `ipc.send("ttyspawn",{cli:["cat"]})` + 真实 `Terminal` 客户端(`muted:!0`);给 `r.term` 加 `cols/rows/_core/reset/refresh/focus/resize` 转发 shim(内层 xterm),19fix 的 `_drawLockBox/_writeLockLine/_codeRedraw/_garble*` 等绘制方法**零改动**改道 pty;`setOption("fontSize",18)` 保持锁屏框字号;`_lockSeq` 竞态守卫;socket 未就绪时 `_rawWrite` 静默丢弃 + 重试绘制循环(≤40×100ms) |
| lockScreen.class.js | L2 | `_teardownLock` 关 socket(readyState<2)+ dispose 内层 xterm,不再还原本机终端 |
| lockScreen.class.js | L3 | 删除旧的「还原真终端」块(`_origTermWrite/_origSend/_savedTerm/_serializeAddon` 全移除),仅保留 `this._term=null,this._restoreKeyboard();` |
| _renderer.js | SVT | `_mkSsvt`/`_rmSsvt`:假 xterm → `ttyspawn {cli:["cat"]}` 真实客户端(muted);`_svtSeq` 竞态守卫;回复到达时屏保已退 → 开一个临时 WebSocket 触发后端 `ondisconnected` 释放端口(防泄漏) |
| _renderer.js | I | 假代码行改经 pty 发送;每 10 行发 `ESC[2J ESC[H` 清屏(经 pty 配合行缓冲刷新,`` 发 ESC 字节、`\r\n` 发反斜杠形) |

### 1.3 验证

- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建成功
  → **`/tmp/eDEX-UI.AppImage.20fix-20260812`**(185092858B)。
- 产物 4 文件(`_renderer.js`=156571B、`lockScreen.class.js`=24273B、
  `terminal.class.js`=12930B、`_boot.js`=54198B)`node --check` **全部通过**。
- 关键标记确认:`_svtSeq`/`_lockSeq` 竞态守卫、`muted:!0`、真实客户端 spawn、
  旧假 xterm 全部清除、无 `_origTermWrite/_savedTerm` 残留。
- **幂等**:两次从 pristine 构建,app.asar **字节一致**(仅 squashfs 时间戳不同)。
- **已合并 21fix**:cliApps 里 w3m 已带默认主页 `["w3m","https://lite.duckduckgo.com/lite"]`。

### 1.4 部署(需重启 eDEX,会杀掉当前会话)

20fix 与 21fix 已合并在一个 AppImage,重启一次即可:

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.20fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.20fix-20260812 /opt/edex/` 留存一份。

---

## §2 下一轮新需求(用户 2026-08-12 提出,写入交接文档)

> 共同点:全部是「**内置 CLI 应用 + 设置菜单把命令可视化**」。实际工作由命令行应用完成,
> GUI 只是拼好并执行命令。**都要写进 `packaging/install/install-edex.sh` / seed 构建**,
> 确保真机镜像自带,而不是只在本机 apt。

### 2.1 内置 BTOP —— **显示在 APP 列表**
- `sudo apt install btop`,并加入 tab4/5 CLI 面板默认 `window.cliApps`
  (如 `{ id: "btop", name: "BTOP", cmd: ["btop"] }`,需要时也进 seed)。

### 2.2 内置 AXEL —— 替换设置里原本的 UGET 菜单(**不进应用列表**)
- 用 **axel**(命令行下载器)替换 UGET 下载器。
- 设置菜单:输入 URL + 线程数(**默认 6**),下载目录**用户可自己设置**,即可开始下载。
- 下载中显示:进度、速度、剩余时间等信息;支持**暂停 / 恢复**。
- **本质是 CLI 可视化**:菜单拼好 `axel -n <线程> -o <目录> <URL>` 并执行,实际下载由
  axel 完成;暂停/恢复可考虑 `kill -STOP` / `kill -CONT`,或分包断点续传。
- 需在 `_renderer.js`(或对应设置面板类)找到现有 UGET 设置菜单的实现位置再替换。

### 2.3 CLASH 设置增强 ——(**不进应用列表**)
- 在现有「设置的 CLASH」基础上增加:节点选择、测速、模式切换(**全局 / 规则 / 直连**)、
  规则配置等。
- **本质是 GUI 写命令**:通过 Clash API(默认 9090)下发配置/切换节点/测速;或直接改
  `config.yaml` 后 `kill -HUP` 重载。
- 开工前先确认「设置的 CLASH」现有实现在哪个文件(设置面板里搜 clash)。

### 2.4 内置 FASTFETCH ——(**不进应用列表**)
- `sudo apt install fastfetch`,开机/欢迎信息显示系统信息即可,不进 app 列表。

### 2.5 确保内置 FFMPEG ——(**不进应用列表**)
- `sudo apt install ffmpeg`,确认系统内 `ffmpeg` 命令可用即可(供下载后的转码/处理等用途)。

### 2.6 CPU 超负荷 → CPU 型号文字红光闪烁(勿刺眼)
- 当 CPU 超负荷(高占用)时,CPU USAGE 组件中的 **CPU 型号文字红光闪烁** 作为提示;
- 要求**不要太刺眼**(低强度/柔和闪烁,如暗红 + 慢速呼吸式淡入淡出)。
- 实现思路:定位 CPU USAGE 组件(mod_sysinfo.css / sysinfo widget,顶部 CPU 型号文字),
  按占用率阈值加 class,配一个柔和的红色 box-shadow/text-shadow 闪烁动画。

---

## §3 遗留待办(本轮之前)

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| #5 | 终端滚动修复(历史遗留) | ⏳ | — |
| #9 | 终端文本选择+复制(历史遗留) | ⏳ | 复制已确认可用;选择部分待确认 |
| #4 | app monitor 填满:backend.js openbox `--config→--config-file` | ⏳ | 补丁已在链内,appMonitor 默认禁用未真机验证 |
| #5-ubuntu | Ubuntu 侧待办清单跟踪(#11/#128/#139/#140/#145/#163/#174/#182/#183/#173/#175) | ⏳ | 待跟踪 |

## §4 铁律与安全

- **从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建**,原文件勿动。
- **需要重启的修改:先写交接文档 → 再推 GitHub → 最后才重启**,顺序不能反。
- `sk-f4427cf72b6a406b9d6606571abfd3cc/` 是用户 API 目录,在 .gitignore 里——**永不提交、
  永不删除、永不外泄内容**。settings.json.template 里是占位符 `<your-api-key>`;本机
  settings.json 里是真 key(提交模板时别带真 key)。
- 本会话运行在 eDEX 内部进程树里,重启 eDEX = 杀掉本会话。

## §5 任务清单(TaskList 对应)

- #1 ✅ #20 锁屏/屏保改独立真实终端(已实现、构建验证、提交推送;**部署待重启**)
- #6 ✅ 21fix TAB5 Browser w3m 配默认主页(已合并进 20fix 产物)
- #7 ⏳ 下一轮:内置 BTOP(进 app 列表)
- #8 ⏳ 下一轮:内置 AXEL,替换设置里 UGET 菜单(URL/线程默认6/目录/进度/暂停恢复,CLI 可视化)
- #9 ⏳ 下一轮:CLASH 设置增强(节点/测速/全局规则直连/规则,CLI 可视化)
- #10 ⏳ 下一轮:内置 FASTFETCH(不进列表)
- #11 ⏳ 下一轮:确保内置 FFMPEG(不进列表)
- #12 ⏳ 下一轮:CPU 超负荷时 CPU 型号文字红光闪烁(勿刺眼)
- #2/#3/#4/#5 ⏳ 历史遗留(#5 滚动、#9 选择复制、appmonitor openbox、Ubuntu 待办)
