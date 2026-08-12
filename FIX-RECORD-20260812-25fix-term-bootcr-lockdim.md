# 交接文档 — 25fix:终端开屏双行(多按回车)+ CODE 锁屏时钟/锁屏框被暗化(2026-08-12)

> 记录用户新发现的两个问题的根因、修复、验证与部署。
> 任务清单唯一权威 = 根目录 [`TODOS.md`](TODOS.md)。

---

## §1 用户反馈(两个问题)

1. **问题 A**:打开任何终端,**什么都没干就都自带两行**,很像"多按了一下回车"的效果。
2. **问题 B**:CODE 锁屏的密码输入画面,**只有虚拟键盘没有暗化**——这不对:**时钟组件和
   终端(包括密码输入框)也不应当暗化**。即:时钟、锁屏框要跟键盘一样保持亮,其余背景暗化。

用户拍板:直接改,patch-appimage.sh 一处改锁屏暗化即可。

---

## §2 根因

### 问题 A —— 服务端连接建立时无条件写一个 boot `\r` 到 pty

`terminal.class.js` 的 server 端 ws 连接处理器里,连接一建立就写一个裸 `\r`:

```js
// 25fix 之前的代码(terminal.class.js server 端 connection 处理器尾部):
try{this._noBootCR||this.tty.write("\r")}catch(e){}
```

目的(上游 eDEX 遗留):新终端 attach 后"刷新一下 bash 提示符"。但对**普通 bash 终端**
(`noBootCR` 为假)来说:

- pty 是 canonical+ECHO 行缓冲,`\r` 经 ICRNL 被翻译成 `\n` = **一次空行提交**;
- 于是终端回显一行空行 + bash 重新打印提示符 → 用户看到"打开就有两行 / 多按了回车"。

实测:去掉这个 `\r` 后,打开终端只收到**一行干净的提示符**(提示符约在 spawn 后 230~320ms
到达,而 ws 连接约 40ms 建立,正常情况下提示符总是能送到,`\r` 纯属多余副作用)。
CLI 面板(claude/htop/w3m)、屏保/锁屏的 cat pty 走 `cli:` 分支,**本来就带 `noBootCR:!0`**
跳过 boot 回车,不受影响——只有普通终端(约 1/2 主终端)会触发。

### 问题 B —— #20 重构后丢了旧代码把时钟/壳抬到暗化层之上的 z-index 提升

- 暗化层:`#lock_block`,`position:fixed;inset:0;z-index:3000;background:rgba(5,8,13,.42)`。
- 虚拟键盘:z-index 3050(在暗化层之上 → 键盘没暗化,正是用户说的"只有键盘没暗化")。
- **时钟 `#mod_clock`**:CSS 只有 `position:relative`,没有 z-index → 在暗化层之下 → 被暗化。
- **锁屏框**:`#lock_virt_term` 自己 z-index 3200,但它在 `#main_shell_innercontainer` 内部;
  该容器/`#main_shell` 形成(或位于)低于 3000 的层叠上下文 → 3200 只对它自己上下文有效,
  整体仍被 `#lock_block`(3000)压住 → 锁屏框/密码框被暗化。

旧版(未引入独立虚拟终端之前的 LOCK1_OLD)正是靠这组 z-index 提升把时钟和壳抬到暗化层
之上:

```js
mod_clock            → position:relative + z-index:3100
main_shell_title     → z-index:3100
main_shell           → z-index:3200 + clip-path:none
main_shell_innercontainer → z-index:3001 + clip-path:polygon(...)
```

`#20` 把锁屏改成独立虚拟终端(LOCK1_NEW / L1_NEW)时**把这组提升删了**(注释说是
"不再需要抬壳"),但没有考虑暗化层 → 时钟和锁屏框退回暗化层之下。
`_teardownLock` 里恢复这四组 z-index/position/clip 的代码**一直还在**(只是没东西可恢复)。

---

## §3 修复(packaging/patch-appimage.sh,2 处)

### Fix A —— terminal.class.js target:boot `\r` 改为"延迟条件回退"

原无条件写 `\r` 改为:首次连接后,若 **1200ms 内 pty 无任何输出、且用户也没输入**,
才补发一次 `\r`(兜底极少数"提示符丢失"竞态);正常情况不再多回车。

- `onData` 里新增 `this._bootGot=!0`(有输出即认为提示符/内容已送达);
- `on("message")` 里新增 `this._bootIn=!0`(用户已开始输入,不要再补 `\r`);
- 首次连接(`_booted` 未置位、且 `noBootCR` 为假)启动 1200ms 定时器;
- 定时器触发时仅当 `!_bootGot && !_bootIn` 才 `this.tty.write("\r")`;
- 重连不重复计时(`_booted` 已置位)。

新片段(connection 处理器):

```js
this.wss.on("connection",e=>{...this.onopened(this.tty.pid),e.on("close",(e,t)=>{this.ondisconnected(e,t)}),e.on("message",e=>{this._bootIn=!0;this.tty.write(e)}),this.tty.onData(t=>{this._bootGot=!0;this._nextTickUpdateTtyCWD=!0,this._nextTickUpdateProcess=!0;try{e.send(t)}catch(e){}});try{if(!this._noBootCR&&!this._booted){this._booted=!0,this._bootGot=!1,this._bootIn=!1,this._bootT=setTimeout(()=>{try{this._bootT=null;if(!this._bootGot&&!this._bootIn)this.tty.write("\r")}catch(_){}},1200)}}catch(e){}})
```

> CLI 会话、屏保/锁屏 cat pty 走 `noBootCR` 分支不受影响(本来就跳过 boot 回车)。

### Fix B —— lockScreen.class.js target:`L1_NEW` 前置恢复 z-index 提升

在 `L1_NEW` 创建 `lock_virt_term` 之前,恢复旧版那组提升(保存到 `this._orig*` 供
`_teardownLock` 还原——teardown 的还原代码本来就在):

```js
const i=document.getElementById("mod_clock");i&&(this._origClockPos=i.style.position,i.style.position="relative",i.style.zIndex="3100");
const o=document.getElementById("main_shell_title");o&&(this._origTitleZ=o.style.zIndex,o.style.zIndex="3100");
const s=document.getElementById("main_shell");s&&(this._origShellClip=s.style.clipPath,this._origShellZ=s.style.zIndex,s.style.zIndex="3200",s.style.clipPath="none");
const n=document.getElementById("main_shell_innercontainer");n&&(this._origInnerZ=n.style.zIndex,this._origInnerClip=n.style.clipPath,n.style.zIndex="3001",n.style.clipPath="polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))");
```

效果(层叠关系):`main_shell(3200) > mod_clock(3100) > 键盘(3050) > 暗化层(3000)`。
时钟、锁屏框(含密码输入框)与键盘一样保持亮,背景暗化。`lock_virt_term` 仍在
`main_shell_innercontainer` 内、带不透明背景(#22),真终端内容依旧完全被遮住。
几何上 `#cyber_panel`(键盘宿主,30vh 底部行)与 `#main_shell`(60.3% 中行)上下分离,
抬壳不会盖住键盘。

---

## §4 验证

- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建成功
  → **`/tmp/eDEX-UI.AppImage.25fix-20260812`**(185092858B)。
- 产物 4 文件(`_renderer.js`=157313B、`lockScreen.class.js`=25092B、
  `terminal.class.js`=13132B、`_boot.js`=54198B)`node --check` **全部通过**。
- 关键标记:
  - **Fix A**:`terminal.class.js` 中 `if(!this._noBootCR&&!this._booted){this._booted=!0` 恰好 1 处;
    旧的无条件 `this._noBootCR||this.tty.write("\r")` **0 处**;`_bootGot`/`_bootIn`/`_bootT`
    在 onData/onMessage/定时器三处各就位。
  - **Fix B**:`lockScreen.class.js` 中 `mod_clock`/`main_shell`/`main_shell_innercontainer`
    的 z-index 提升各恰好 1 处;`lock_virt_term` 仍 `z-index:3200;background:<theme>`(不透明);
    `_teardownLock` 还原 `_origClockPos/_origTitleZ/_origShellZ/_origInnerClip` 等全部在位。
  - `#22` `cli:["sh","-c","stty raw -echo; exec cat"]` 仍在 `_renderer.js`(1 处);
  - `#24` `I()` 无 `++S%10` 清屏(仍在 24fix 形态)。
- **幂等**:25fix 产物再跑一遍 patch 脚本 → 全部 target "already patched, no-op"。

---

## §5 部署(需重启 eDEX,会杀掉当前会话)

> 按铁律:**先写交接文档 → 再推 GitHub → 最后才重启**。本会话运行在 eDEX 进程树内,重启即
> 杀掉本会话,故此处不代做,交给用户/下个会话执行。本产物包含 #20+#21+#22+#23+#24+25fix
> 全部改动,直接替换即可。

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.25fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.25fix-20260812 /opt/edex/` 留存一份。
> 验证要点:
> - 打开任意终端(约 1/2 主终端):**只有一行干净提示符**,不再多出空行/再次提示符;
>   CLI 面板、屏保、锁屏 cat pty 行为不变;
> - 触发 CODE 锁屏:背景暗化,但**时钟、锁屏框(ASCII 框+密码输入)、虚拟键盘都保持亮**;
>   解锁后时钟/壳/终端的 z-index、position、clip 全部还原,界面无残留异常。

---

## §6 遗留待办

> 唯一权威 = [`TODOS.md`](TODOS.md)。本节仅记本轮范围外相关项:
> - 若真机验证发现问题 A 的"提示符丢失"竞态(空终端 1.2s 后才补出提示符)属预期兜底,
>   无需处理;如想更早兜底可把 1200ms 调小,但要以加载峰值下 bash 提示符实测为准。
> - 其余(内置 BTOP/AXEL/CLASH 增强/FASTFETCH/FFMPEG/超负荷红光闪烁、#2 滚动、
>   #4 appmonitor、#174 用户名、#183 开机过渡)→ 见 TODOS.md。
