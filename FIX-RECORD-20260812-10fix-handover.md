# ⏸️ 交接文档 — 20fix 之前的状态与发现(2026-08-12)

> 本文件记录 **task #10(重启验证)之后、下一轮修复开始之前** 的完整状态:已完成的、已验证的、
> 已排查出的根因、以及待办修复计划。重启后 / 换会话后,先读本文件即可无缝续接。
> 任务清单见文末 §6。

---

## §1 已完成并已部署/推送(#10 收尾)

- **#10 tab4/5 改为 CLI 会话面板 + 默认禁用虚拟显示器** 已全部完成:
  - 补丁脚本:`packaging/patch-appimage.sh`(Edit A/B/C,见 §2 结构)。
  - 种子与 ISO:appMonitor.enabled 已改 `false`(`packaging/install/install-edex.sh`、
    `ubuntu/system/settings.json.template`),build-iso.sh 已加 `w3m`。
  - **已构建部署到真机**:当前 `/opt/edex/eDEX-UI.AppImage` 即为含 #10 的版本,eDEX 正运行它。
  - **已提交并推 GitHub**:commit `44e3c7d` = HEAD = origin/main(工作区干净)。
- 本机 settings.json(`/home/edex/.config/eDEX-UI/settings.json`):`appMonitor.enabled=false` 已翻转。

## §2 patch-appimage.sh 当前结构(重打补丁前的锚点快照)

- `_renderer.js` mega target:`expectOut` = `'window.cliApps = [ { id: "claude"'`。
  - 链首是 3 组新 reverts(CLI_SETTINGS/CLI_FS3/CLI_FS4)+ 3 组既有 reverts(visibilitychange、
    pm:suspend、SSH_SEC)+ `CURSOR1_OLD→CURSOR1_NEW` 重放;
  - 链尾新 applies:CLI_SETTINGS / CLI_SAVE / CLI_FS3 / CLI_FS4 / TAB2_SPAWN / TAB2_CLOSE /
    TAB2_HTML / TAB2_FB / CLI_PANEL。
- `_boot.js` target:`expectOut` = `'Array.isArray(o.cli)'`。
  - 链:Super+L split → resume REVERT → resume apply → noBootCR → TTYSPAWN_OLD→NEW →
    POOL_OLD→NEW。
- `_renderer.js` 里注入的 `window.cliApps` 默认列表:`claude` / `w3m` / `htop`,
  `localStorage["edex_cli_apps"]` 保存用户自加 app。
- **重打补丁的铁律**:所有变换读的是「当前 asar 内的压缩串」,新增变换的锚点必须取自
  `/tmp/live_renderer.js` / `/tmp/live_boot.js` 的**实际压缩字面量**;同文件只能一个 target;
  加了新 applies 必须配对称 reverts 进链首,否则幂等性破坏。

## §3 重启验证的发现(根因已定位)

### 3.1 ✅ 选 tab4/5 报 RangeError — 已修复(#17)

- **现象**:重启后点 tab4/5,`boot_screen` 追加 `RangeError: Maximum call stack size exceeded`。
- **根因**(已定位到代码):
  - `_renderer.js` 中 CliPanel 类的 `focus()` 末尾:
    ```js
    focus() { if (this.selected && this.sessions[this.selected.id]) { ... } else this.activate(); }
    activate() { this.focus(); }
    ```
  - tab 切换 dispatch 调 `p.activate()` → `focus()` → 无会话时 `this.activate()` → **无限递归**,
    栈溢出。与终端数量上限、端口池完全无关。
- **修复(#17,已完成并验证)**:把 `focus()` 里的 `else this.activate()` 改为 `else {}`(空块),
  `activate()` 保持只调用 `focus()`、不再反向回跳。锚点变换见 `patch-appimage.sh` 的
  `CLIRECUR_OLD → CLIRECUR_NEW`(renderer target 链首)。已在从 pristine orig 重建的产物中
  确认:递归分支计数 0、`_s.term.term.focus(); } } activate()` 计数 1、语法通过。

### 3.2 端口机制验证:1-3 tab 用端口,tabs4/5 应用会话不应占端口

- 主终端端口 3000;extraTtys 池 key 就是端口:3002~3009(共 8 槽,`z=e.port||3e3; z=Number(z)+2`,
  `for(let i=0;i<8;i++) extraTtys[z+i]=null`)。
- **字符串端口没问题**:ws 2.3.11 `new WebSocketServer({port})` → `http.Server.listen("3002")` →
  Node 18 会把数字字符串强转成 TCP 端口(已在 Node 里实测验证),**不是 unix pipe**。
- 所以「RangeError 是因为端口」不成立。端口池本身工作正常。
- **用户要求(tabs4/5 不必用端口)**:应用会话走同一 ws 通道,端口只是 extraTtys 的 key 机制,
  无需新建监听——见 §5 待办 #18 思路。

### 3.3 ✅ 8 槽上限 → "exceeded max TTYs" — 已修复(#18)

- 池子固定 8 槽(3002-3009),超出会 `signale.error("TTY spawn denied (Reason: exceeded max TTYs number)")`。
- 本机两个 CLI 面板 + tab1-4 的普通终端共享此池,槽位可能被占满 → 用户担心的「终端上限」。
- **修复(#18,已完成并验证)**:extraTtys 动态分配——在原有 8 槽扫描失败后再向
  `z+8 … z+4096` 滚动找空槽(`for(let _k=z+8;_k<z+4096;_k++){if(void 0===extraTtys[_k]||null===extraTtys[_k]){extraTtys[_k]={},i=_k;break}}`),
  除非 4096 个全占满否则不再报 "max number of ttys reached"。锚点 `ALLOC_OLD → ALLOC_NEW`
  挂在 `_boot.js` target 链尾。已在从 pristine orig 重建的产物中确认:动态分配片段在、池初始化
  `for(let e=0;e<8;e++)` 在、语法通过。

### 3.4 ⚠️ tab2(EMPTY)与 tab3(TERM)功能重复

- 现状 tab 标签:`0:MAIN SHELL, 1:EMPTY, 2:TERM, 3:MONITOR A, 4:MONITOR B`(渲染成中文后
  tab3 显示 TERM、tab2 显示 EMPTY)。
- `shellSlotKinds = {0:"term",1:"term",2:"term",3:"appmonitor",4:"appmonitor"}` → tab1/2/3
  全是普通终端,`focusShellTab` 对 1-4 都 `ipc.send("ttyspawn","term")`,**tab2 和 tab3 功能完全一样**。
- 用户原话:「为啥第三tab显示的是term,第二tab就是empty这两个功能一模一样啊,要修复」。
- **这是设计分叉,需问用户**(§6 #19):
  - 选项 A:tab2/3 合并语义 —— 一个叫 EMPTY/空终端、一个留给某种特殊用途(如默认命令);
  - 选项 B:tab2 改显示 MASTER/等,把 4/5 的 CLI 面板语义前移;
  - 选项 C:保持功能相同但改标签文案,消除「EMPTY 但又是终端」的困惑。

## §4 锁屏/屏保重设计(用户拍板的新思路,未做)

- **用户原话**:「目前锁屏逻辑不对,不应该使用虚假绘制的终端,绘制永远不对。换一个思路:
  屏保和锁屏的时候新建一个独立终端跑假代码和显示锁屏框(锁屏框大小要合适),解锁以后就销毁,
  这样不会影响真实终端的显示和运行,并且屏保和锁屏的显示也能完美」。
- **现状**:19fix 用 SSVT(独立虚拟终端,z-3200,不碰真终端)+ UI 假数据。用户认为「虚假绘制
  永远不对」→ 改用 **真正的独立终端**(node-pty/WebSocket 新会话)跑假代码。
- **新方案要点**(§5 #20):
  1. 屏保/锁屏 engage 时:`ipc.send("ttyspawn", ...)` 拉起一个新独立终端(不是复用现有面板终端),
     用它在锁屏框内跑假代码流(fake code),锁屏框尺寸要合适(参考 19fix 的 72 号锁屏框)。
  2. 解锁时:dispose 该终端、销毁会话与锁屏框,释放端口/槽位。
  3. 完全不触碰 tabs1-5 的真实终端 → 真终端显示与运行零影响。
  4. 代码位置:`lockScreen.class.js` + `_renderer.js` 的 SSVT_* 区域(19fix 已埋点),需先读
     当前 asar 里这些区域的实际压缩代码再写锚点。

## §5 待办修复计划(按序)

| # | 任务 | 状态 | 说明 | 位置 |
|---|---|---|---|---|
| #17 | 修 CliPanel 无限递归(RangeError) | ✅ 已完成并验证 | `focus()` 无会话时 no-op,不再回跳 `activate()` | `patch-appimage.sh` CLIRECUR_OLD→NEW |
| #18 | extraTtys 动态分配,取消 8 槽上限 | ✅ 已完成并验证 | 8 槽扫完向 z+8…z+4096 滚动找空槽,不再报 max TTYs | `_boot.js` ALLOC_OLD→NEW |
| #19 | 消除 EMPTY/TERM 重复 tab | ⏳ **设计分叉,先问用户**(见 §3.4) | 选项 A/B/C 见 §3.4 | `_renderer.js` shellSlotKinds / 标签 |
| #20 | 锁屏/屏保改独立真实终端 | ⏳ 待做 | engage 新建 + unlock 销毁;锁屏框大小合适;不碰真终端 | `lockScreen.class.js` / SSVT_* 区域 |
| #5 | 终端滚动修复(历史遗留) | ⏳ | — | — |
| #9 | 终端文本选择+复制(历史遗留) | ⏳ | — | — |

> 每项开工前:从当前 `/opt/edex/eDEX-UI.AppImage` asar 抽取对应文件到 `/tmp/`,读实际压缩串,
> 再改 `patch-appimage.sh`。改完先 `/tmp/validate_all.js`(重放全链幂等),再构建部署。
> **注意:已部署 AppImage 已含 #17/#18,re-patch 是 no-op;新构建必须从 pristine orig 基线
> `/opt/edex/eDEX-UI.AppImage.orig-20260811` 出发**(见 §2 铁律)。

## §6 任务清单(TaskList 对应)

- #16 ✅ 写交接文档(本文)
- #17 ✅ 修 CliPanel activate/focus 无限递归(已验证,待部署重启)
- #18 ✅ extraTtys 动态分配,取消端口上限(已验证,待部署重启)
- #19 ⏳ 解决 EMPTY/TERM 两个相同终端 tab(先问用户)
- #20 ⏳ 锁屏/屏保改独立真实终端,解锁即销毁
- #5 / #9 历史遗留(滚动、选择复制)

## §7 安全与其它

- **`sk-f4427cf72b6a406b9d6606571abfd3cc/` 是用户的 API 目录,在 .gitignore 里——永不提交、
  永不删除、永不外泄内容。** settings.json.template 里是占位符 `<your-api-key>`;本机
  settings.json 里是真 key(属用户隐私,提交模板时注意别带真 key)。
- 本会话运行在 eDEX 内部进程树里,重启 eDEX = 杀掉本会话,所以部署后重启的流程要先写好脚本。
- **用户拍板的部署顺序(铁律)**:凡是有需要重启的修改 → **先写交接文档 → 再推 GitHub →
  最后才重启**。顺序不能反。
- 部署流程(参考):`sudo systemctl stop lightdm; sudo pkill -f eDEX-UI.AppImage;`
  `sudo cp <新产物> /opt/edex/eDEX-UI.AppImage && sudo chmod 755;`
  `sudo systemctl start lightdm`。
- **#17/#18 本轮验证产物**:`/tmp/patched_orig.AppImage`(从 pristine orig 重建,含 #17/#18 +
  前序全部修复,185092858 字节)。部署时用它与上述流程替换 `/opt/edex/eDEX-UI.AppImage`。
