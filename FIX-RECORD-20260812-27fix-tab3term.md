# 交接文档 — 27fix:第三终端 tab 只显示 "TERM" 不显示进程名(2026-08-12)

> 记录用户新发现的 tab 标签问题的根因、修复、验证与部署。
> 任务清单唯一权威 = 根目录 [`TODOS.md`](TODOS.md)。

---

## §1 用户反馈

打开 eDEX,三个终端 tab 的标签不一致:

- 第一 tab:`MAIN - bash`
- 第二 tab:`#2 - bash`
- 第三 tab:`TERM`(永远只显示静态名,不显示进程)

用户期望第三 tab 与第二 tab 一样带编号递增(`#3 - bash`),而不是 "TERM"。

> 排查中用户明确:当前 API **非多模态**,尽量不截图(此约定已写入 TODOS.md 铁律
> 与 `~/CLAUDE.md`,后续排查优先读代码/DOM/日志)。

---

## §2 根因

`_renderer.js` 里 shell tabs 的标签函数 `cover.tabLabel`(即 `y` 函数)只给
**tab0/tab1** 拼进程名,tab2 落回静态默认 `t[2]="TERM"`:

```js
// 27fix 之前的 y(与 pristine 基线逐字节一致):
y=(n,o)=>i?null!=e[n]?e[n]:"":0===n?o?"MAIN - "+o:t[n]:1===n?o?"#2 - "+o:t[n]:3===n||4===n?h[n]||t[n]:null!=t[n]?t[n]:""
```

- `0===n` → `"MAIN - "+o`(tab0 显示进程名)
- `1===n` → `"#2 - "+o`(tab1 显示进程名)
- **`2===n` 没有任何分支** → 落到 `t[2]`="TERM"(tab2 永远不显示进程名)
- `3/4===n` → monitor 标签

同时 `rememberProc`(onprocesschange 时把进程名记入 `r[]`)也**只放行 0/1**:

```js
rememberProc:(e,t)=>{0!==e&&1!==e||(r[e]=t)}   // tab2 的进程名根本没进 r[]
```

所以即使 tab2 是普通终端、进程是 bash,标签也只能是静态 "TERM"。

---

## §3 修复(packaging/patch-appimage.sh,并入既有 `_renderer.js` target)

> 多个 _renderer.js target 会互相覆盖,必须并入现有那个(注释原话)。两处替换对:

### Fix A —— `y` 函数补 tab2 分支

```js
// 旧:
y=(n,o)=>i?null!=e[n]?e[n]:"":0===n?o?"MAIN - "+o:t[n]:1===n?o?"#2 - "+o:t[n]:3===n||4===n?h[n]||t[n]:null!=t[n]?t[n]:""
// 新:
y=(n,o)=>i?null!=e[n]?e[n]:"":0===n?o?"MAIN - "+o:t[n]:1===n?o?"#2 - "+o:t[n]:2===n?o?"#3 - "+o:t[n]:3===n||4===n?h[n]||t[n]:null!=t[n]?t[n]:""
```

在 `3===n||4===n` 前插入 `2===n?o?"#3 - "+o:t[n]:` —— tab2 有进程名显示
`#3 - <进程>`,无进程名(未跑/已关闭)回落 "TERM"。

### Fix B —— `rememberProc` 放行 tab2

```js
// 旧:
rememberProc:(e,t)=>{0!==e&&1!==e||(r[e]=t)}
// 新:
rememberProc:(e,t)=>{0!==e&&1!==e&&2!==e||(r[e]=t)}
```

两处锚点在 pristine 基线 `_renderer.js` 各恰好 1 处(已逐字节比对确认);
替换后无旧串残留,`node --check` 通过。

效果(tab0/tab1/tab3/tab4 行为完全不变):
- tab0:`MAIN - bash`(不变)
- tab1:`#2 - bash`(不变)
- tab2:`TERM` → `#3 - bash` ✓(与 tab1 编号递增一致)

---

## §4 验证

- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建成功
  → **`/tmp/eDEX-UI.AppImage.27fix-20260812`**(185092858B,md5
  `62efc34cac18c33fd018e4bb86bc2ffc`)。
- 产物含**全部历史修复**(#20+#21+#22+#23+#24+#25+#26+#27)：
  4 文件关键尺寸与 25fix 记录一致——`terminal.class.js`=13132B、
  `lockScreen.class.js`=25092B;`_renderer.js`=157343B(比 24fix 运行版
  157313B 多 30B,恰为 #27 两处改动)。
- 11 个补丁 JS 全部 `node --check` 通过。
- 关键标记:
  - **#27**:`y` 内 `2===n?o?"#3 - "+o:t[n]:3===n||4===n` 恰好 1 处;
    旧版 `1===n?...:3===n||4===n`(无 tab2 分支)**0 处**;
    `rememberProc:(e,t)=>{0!==e&&1!==e&&2!==e||(r[e]=t)}` 恰在。
  - **#25**:`terminal.class.js` 中 `if(!this._noBootCR&&!this._booted)` 恰在。
  - **#26**:`lockScreen.class.js` 中 z-index 提升 `3001/3100×2/3200` 在;
    `lock_virt_term` 不透明背景仍在。
- **幂等**:#27 的 OLD 锚点在新产物中 0 处 → 重跑 split 空转;整体 _renderer.js
  target 的 expectOut(`window.cliApps = [ { id: "claude"`)已命中 → 整体 no-op。

---

## §5 部署(需重启 eDEX,会杀掉当前会话)

> 按铁律:**先写交接文档 → 再推 GitHub → 最后才重启**,顺序不能反。本会话运行在
> eDEX 进程树内,重启即杀掉本会话,故不代做,交给用户/下个会话执行。本产物包含
> #20+#21+#22+#23+#24+#25+#26+#27 全部改动,直接替换即可。

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.27fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.27fix-20260812 /opt/edex/` 留存一份。
> 验证要点:
> - 打开任意终端:**只有一行干净提示符**,不再多出空行/再次提示符(#25);
>   CLI 面板、屏保、锁屏 cat pty 行为不变。
> - 触发 CODE 锁屏:背景暗化,但**时钟、锁屏框(ASCII 框+密码输入)、虚拟键盘都保持亮**;
>   解锁后 z-index 全部还原(#26)。
> - 三个终端 tab:tab0=`MAIN - bash`、tab1=`#2 - bash`、**tab2=`#3 - bash`**(#27);
>   tab2 的进程被关闭后回落 "TERM"。

---

## §6 遗留待办

> 唯一权威 = [`TODOS.md`](TODOS.md)。本节仅记本轮范围外相关项:
> - 若真机验证发现问题 A(#25)的"提示符丢失"竞态(空终端 1.2s 后才补出提示符)
>   属预期兜底,无需处理。
> - 其余(内置 BTOP/AXEL/CLASH 增强/FASTFETCH/FFMPEG、#2 滚动、#4 appmonitor、
>   #174 用户名、#183 开机过渡)→ 见 TODOS.md。
