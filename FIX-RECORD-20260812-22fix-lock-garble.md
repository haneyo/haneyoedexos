# 交接文档 — 22fix:CODE 屏保/锁屏渲染修复(cat pty 回显乱码 + 覆盖层透明)(2026-08-12)

> 记录用户本轮反馈的 **CODE 屏保/锁屏三大显示问题** 的根因、修复与验证,以及部署步骤。
> 任务清单唯一权威 = 根目录 [`TODOS.md`](TODOS.md)。

---

## §1 用户反馈的三个问题(2026-08-12,20fix 部署后实测)

1. **CODE 屏保**:同一行假代码显示两行;空行太多;速度太快。
2. **CODE 锁屏**:锁屏框被乱码推到屏幕上方看不到;乱码本应是锁屏框出现/消失的动画。
3. **屏保 / 锁屏出现时仍看得到真实终端的显示内容,没有起到锁屏效果。**

---

## §2 根因(两条,均已实测证实)

### 2.1 cat pty 默认 canonical+ECHO 模式,转义序列被回显/缓冲破坏

20fix 把 CODE 屏保/锁屏的绘制从「假 xterm」改成「每次新建一次性真实终端
(node-pty + WebSocket,跑 `cat` 回显)」。绘制代码仍是老逻辑:向终端写 ANSI 转义序列
(清屏 `ESC[2J`、光标定位 `ESC[<r>;<c>H`、SGR 配色、`\r\n`)。

但 node-pty `spawn("cat")` 默认是 **canonical(ICANON)+ ECHO + ECHOCTL** 模式(没有 shell
包装去设置 raw,和普通 bash 终端不同——bash 自己会调 termios)。实测(用 AppImage 内置
node-pty 跑 `pty.spawn("cat",...)` 并写入 `ESC[2J ESC[H ESC[5;30H ESC[36mhello code\r\n`):

- **ECHO**:每个字符被 tty 驱动立即回显一次 → 一行内容**双写**(问题 1「同一行显示两行」);
- **ECHOCTL**:ESC 被回显成 `^[` → 所有转义序列变成字面垃圾文本 `^[[5;30H` 等
  (问题 2「乱码」;乱码把锁屏框顶上屏幕外);
- **ICANON 行缓冲**:输入攒到换行才交给 `cat`;配合 ECHOCTL/ONLCR,每次写 → 2~3 行
  输出,含多余空行(问题 1「空行太多」「速度太快」)。

### 2.2 覆盖层 div 无背景色,内层客户端 xterm 主题背景透明 → 真终端透出

`#screensaver_vt` / `#lock_virt_term` 覆盖层 div 只有 `position:absolute;inset:0;z-index:…`,
**没有背景色**;而客户端 `Terminal`(terminal.class.js)的主题背景固定是
`rgba(0,0,0,0)`(透明,为了让主终端露出背部点阵)。于是屏保/锁屏绘制时,真实终端内容
从覆盖层透明处透出来(锁屏框四周尤其明显)→ 问题 3。

---

## §3 修复(commit 见文末;packaging/patch-appimage.sh 两处常量)

| 文件/常量 | 变换 | 内容 |
|---|---|---|
| `_renderer.js` `SVT_NEW`(_mkSsvt 屏保) | S1 | `ipc.send("ttyspawn",{cli:["cat"]})` → `{cli:["sh","-c","stty raw -echo; exec cat"]}`。子进程先 `stty raw -echo` 把 pty 调成 raw+noecho,再 `exec cat` 纯透传 → 转义序列干净回到客户端 xterm,无双写/无 `^[` 垃圾/无行缓冲空行,速度恢复正常(100ms/行,原设计) |
| `_renderer.js` `SVT_NEW` | S2 | `#screensaver_vt` 覆盖层 div 加**不透明背景** `background:"+((window.theme&&window.theme.terminal&&window.theme.terminal.background)||"#05080d")` → 屏保期间真终端内容被完全遮住 |
| `lockScreen.class.js` `L1_NEW`(_showTerminalLock 锁屏) | L1 | 同样 `cli:["cat"]` → `cli:["sh","-c","stty raw -echo; exec cat"]` |
| `lockScreen.class.js` `L1_NEW` | L2 | `#lock_virt_term` 覆盖层 div 同样加不透明背景 → 锁屏期间真终端内容被完全遮住 |

> 说明:锁屏框/假代码的绘制方法(`_drawLockBox`/`_writeLockLine`/`_garbleBoxIn`/`_garbleBoxOut`/
> `_codeRedraw`/`I()` 等)一行未改——它们原本就正确,只是被 pty 回显破坏。修好 pty 模式后
> 全部原样生效。`stty` 由子进程在启动数毫秒内完成,而绘制都等 WebSocket readyState==1 后才
> 开始,不存在竞态(实测首写回环 6ms,50 连写批首回 14ms,远小于 28ms 动画 tick)。

---

## §4 验证

- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建成功
  → **`/tmp/eDEX-UI.AppImage.22fix-20260812`**(185092858B)。
- 产物 4 文件(`_renderer.js`=156698B、`lockScreen.class.js`=24401B、
  `terminal.class.js`=12930B、`_boot.js`=54198B)`node --check` 全部通过。
- 关键标记:`cli:["sh","-c","stty raw -echo; exec cat"]` 出现在 `_renderer.js` 与
  `lockScreen.class.js` 各一处;两个覆盖层 div 均带 `background:theme.terminal.background`。
- **node-pty 实测**:
  - 旧 `cat`(canonical+echo):写入的转义序列回显成 `^[[2J^[[H` 等垃圾、内容双写、行缓冲
    攒批一次性吐出 → 复现全部三个症状。
  - 新 `sh -c "stty raw -echo; exec cat"`:转义序列原样透传,无 `^[` 垃圾、无双写、无多余
    空行 → 症状消除。
  - 端到端模拟锁屏 `_drawLockBox` 写入(clear+hide cursor+定位+ASCII 框+配色):输出干净,
    框不重复、无垃圾。
- **幂等**:22fix 产物再跑一遍 patch 脚本,全部 target "already patched, no-op",asar 未动。

---

## §5 部署(需重启 eDEX,会杀掉当前会话)

> 按铁律:**先写交接文档 → 再推 GitHub → 最后才重启**。本会话运行在 eDEX 进程树内,重启即
> 杀掉本会话,故此处不代做,交给用户/下个会话执行。

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.22fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.22fix-20260812 /opt/edex/` 留存一份。
> 若上轮 20fix 还没部署(仍用 19fix),本产物已包含 20fix+21fix+22fix 全部改动,直接替换即可。

---

## §6 遗留待办

> 唯一权威 = [`TODOS.md`](TODOS.md)。本节仅记本轮范围外相关项:
> - CODE 屏保每 10 行发 `ESC[2J ESC[H` 整屏清一次是 20fix 有意为之(配合行缓冲刷新的
>   遗留策略);raw pty 下已无必要,但保留无害——如用户觉得清屏太频繁可改为只滚不清。
> - 其余(内置 BTOP/AXEL/CLASH 增强/FASTFETCH/FFMPEG/超负荷红光闪烁、#2 滚动、
>   #4 appmonitor、#174 用户名、#183 开机过渡)→ 见 TODOS.md。
