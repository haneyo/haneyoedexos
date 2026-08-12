# 18fix 完成记录(2026-08-11 夜补完,2026-08-12 归档)

> 状态:**✅ 全部完成并部署**。四个 Bug + 两个衍生修复(ws 重连 Bug5、SSVT 屏保虚拟终端)已全部写进
> `packaging/patch-appimage.sh`,`node --check` 全过,已构建 18fix(sha1 `0fd54cdb…`,185088762B)
> 并部署到 `/opt/edex/eDEX-UI.AppImage`(与构建产物 sha 一致)。**当前运行实例仍是 17fix,重启生效。**
> ⚠️ 已按用户指示推 GitHub。**重启前先问用户**;重启后按 §7 验证清单逐项验收,再做真机验证归档同步。

---

## §1 本次修的 Bug(用户原话)

1. **Bug1 左上角 sysinfo 重叠**:「画面左上角的 uptime 和 type 显示有问题,两个单词重叠了」。
   用户补充:「就是UPTIME的E和TYPE的T重合了」,并明确要求「直接重新排列并且适当缩小单词间隔即可」。
2. **Bug2 code 锁屏**:「code锁屏的密码解锁画面很有问题,锁屏框没有在终端中间,而是跑画面的左上角去了,并且整个画面只有锁屏框和虚拟键盘,其他本该出现的ui全部消失了」。
3. **Bug3 CLAUDE 终端滚动**:「CLAUDE的终端没办法上下滚动,我看不到历史消息,并且检查命令行终端是否有相同问题」。
4. **Bug4 文件浏览器跳动**:「我有时候点击回车发送消息的的时候,文件浏览器动一下,是不是回车的指令文件浏览器也反映了?但我焦点明明在终端里面」→「或者说有点像文件浏览器重新刷新了一下D的感觉」。

---

## §2 关键环境与工作流(必须遵守)

- 项目根:`/home/edex/edex-ubuntu-work`。补丁脚本:`packaging/patch-appimage.sh`(47KB,node 就地改 asar,squashfs 重组,幂等)。
- **补丁作用于原始基座** `/opt/edex/eDEX-UI.AppImage.orig-20260811`(185031425B),每次构建从头打全部补丁。
  所以补丁的 `expectIn` 必须是**原始文件内容**,不是 17fix 内容!
- 当前运行 17fix:`/opt/edex/eDEX-UI.AppImage`(185072378B),实例 mount 在 `/tmp/.mount_eDEX-UJIdNO3`,PID 3844101,DISPLAY=:0,1920×1080。
- 历史版本归档在 `/opt/edex/eDEX-UI.AppImage.{3,5,8,9,10,11,12,13,15,16,17}fix-20260811`。
- **asar 读取**:`node -e "require('/tmp/asartool/node_modules/asar').extractFile(AR, 'path/无前导斜杠')"`。
  路径前缀是 `/assets/...`、`/classes/...`、`/node_modules/...`(listPackage 带前导 /,extractFile 不带)。
- 原始基座已解包在 `/tmp/orig/unpacked/resources/app.asar`,提取的原始文件在 `/tmp/orig/out/`。
  17fix 提取文件在 `/tmp/edex-inspect-18/out/`。
- **部署纪律(12fix 事故教训)**:① 任何注入点改完必须 `node --check` 校验;② 类体内禁 const/IIFE,只写模块作用域或字段;③ 从 orig 基座重建,别从损坏版上改;④ 每次新版本在 `/opt/edex/` 存 artifacts + 更新 CONTINUE.md。
- **用户偏好**:别问 YES/NO,一律 YES;只有重启或功能修改才问;别花太多时间验证,直接修。
- 部署/重启流程:构建 → `sudo systemctl stop lightdm; sudo pkill -f eDEX-UI.AppImage; sudo cp <18fix> /opt/edex/eDEX-UI.AppImage && chmod 755; sudo systemctl start lightdm` → **重启前先问用户**。同步到 haneyoedexos 是 git 层面的(待确认上次做法)。

### 构建命令(已执行完毕)
```bash
bash packaging/patch-appimage.sh /opt/edex/eDEX-UI.AppImage.orig-20260811 /tmp/eDEX-UI.AppImage.18fix-20260811
# 校验:从产物里 extract 改动文件,逐个 node --check(js) / 比对 css
sudo cp /tmp/eDEX-UI.AppImage.18fix-20260811 /opt/edex/eDEX-UI.AppImage && sudo chmod 755 /opt/edex/eDEX-UI.AppImage
# → 问用户后再重启 lightdm/eDEX
```

---

## §3 四个 Bug 的根因 + 修复方案(全部已定位)

### Bug1 sysinfo 重叠 —— 已定方案,直接改

**根因**:`assets/css/mod_sysinfo.css`(原始 851B)里
`div#mod_sysinfo{...font-size:1.111vh;...letter-spacing:.092vh}` + 4 列内容在 ~74px/列的等宽列里放不下,UPTIME(6字符)与 TYPE 相邻重叠。
截图 OCR 已证实:`LOAD UPTIMEYPE POWER`(E 压住 T)。

**当前 patch-appimage.sh 里 17fix 的 sysinfo 条目**(行 432-441)已经把列改成等宽:
```js
{
  name: 'mod_sysinfo.css (LOAD/UPTIME/TYPE/POWER 四列等宽不裁切)',
  path: ['assets', 'css', 'mod_sysinfo.css'],
  expectIn: 'div#mod_sysinfo div{height:100%;box-sizing:border-box;padding:.925vh .46vh;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-around}',
  expectOut: 'flex:1 1 0;min-width:0',
  transform: c => c
    .split('div#mod_sysinfo div{height:100%;box-sizing:border-box;padding:.925vh .46vh;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-around}')
    .join('div#mod_sysinfo div{height:100%;box-sizing:border-box;padding:.925vh .25vh;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-around}'),
},
```

**18fix 改动**:在上面 transform 追加两条 `.split().join()`,把主规则的字号/字距缩小(原始主规则字符串是 `font-size:1.111vh;font-family:var(--font_main_light);letter-spacing:.092vh}`):
- `font-size:1.111vh;font-family:var(--font_main_light);letter-spacing:.092vh}` → `font-size:1.0vh;font-family:var(--font_main_light);letter-spacing:.04vh}`
- 列 padding `.25vh` → `.1vh`(把上面 join 里 `.25vh` 改成 `.1vh`)

字号 12px→10.8px + 字距 1px→0.43px,估算 UPTIME ≈43px,远小于 72px 可用宽,足够。

### Bug2 锁屏 —— 已定方案,改 LOCK1_NEW

**根因**(17fix 把锁屏从「直接用 term[0]」改成「独立虚拟终端」引入了两个问题):
1. `lock_virt_term` 的 CSS `position:absolute;inset:0;overflow:hidden;background:#000` → **纯黑盖满全屏**,把锁屏遮罩(lock_block 的 `rgba(5,8,13,.42)`)后面的 UI 全挡住 →「其他 UI 全部消失」。
   原始 eDEX 锁屏是画在 term[0] 上,主终端 `allowTransparency:!0` + theme.background `rgba(0,0,0,0)`,所以能看到遮罩后的 UI。
2. 虚拟终端 fit() 时序不稳 → 没铺满屏幕 → 锁屏框按 `src.cols×src.rows`(term[0] 的尺寸)居中画,但终端本身画在左上角 → 锁屏框跑左上角。

**当前 LOCK1_OLD / LOCK1_NEW / LOCK2_NEW**(patch-appimage.sh 行 133-135)是 17fix 的。LOCK1_OLD 是原始锁屏头部,expectIn 用它;LOCK1_NEW 替换成虚拟终端版本。

**18fix 要改的 LOCK1_NEW**(把 `t.appendChild(vc),r.term.open(vc);try{const F=require("xterm-addon-fit").FitAddon;r.term.loadAddon(new F),r.term.fit()}catch(e){}` 这段以及虚拟终端的 background 换掉):

替换点 A——虚拟终端构造:去掉 `disableStdin` 前的选项里加 `allowTransparency:!0`,theme.background 改 `rgba(0,0,0,0)`:
- 原(17fix):`r.term=new T({cols:src?src.cols:80,rows:src?src.rows:24,fontFamily:th.fontFamily||"monospace",fontSize:th.fontSize||14,scrollback:0,disableStdin:!0,cursorBlink:!1,theme:{background:"#000000",foreground:th.foreground||"#33ffaa"}})`
- 新:`r.term=new T({cols:120,rows:34,fontFamily:"monospace",fontSize:14,scrollback:0,disableStdin:!0,cursorBlink:!1,allowTransparency:!0,theme:{background:"rgba(0,0,0,0)",foreground:"#33ffaa"}})`

替换点 B——容器 CSS:去掉 `background:#000`:
- 原:`vc.style.cssText="position:absolute;inset:0;overflow:hidden;background:#000"`
- 新:`vc.style.cssText="position:absolute;inset:0;overflow:hidden"`

替换点 C——铺满+兜底(关键):把 `try{const F=require("xterm-addon-fit").FitAddon;r.term.loadAddon(new F),r.term.fit()}catch(e){}` 换成「fit + 手动按容器尺寸 resize 兜底 + 150ms 延迟重算重绘」:
```js
const _sz=()=>{try{const w=vc.clientWidth||window.innerWidth,h=vc.clientHeight||window.innerHeight,co=r.term._core;let cw=8,ch=17;try{const d=co._renderService&&co._renderService.dimensions;if(d&&d.css&&d.css.cell&&d.css.cell.width>0&&d.css.cell.height>0){cw=d.css.cell.width;ch=d.css.cell.height}}catch(_){}const c=Math.max(20,Math.floor(w/cw)),rr=Math.max(6,Math.floor(h/ch));if(c!==r.term.cols||rr!==r.term.rows)r.term.resize(c,rr)}catch(_){}};
try{const F=require("xterm-addon-fit").FitAddon;r.term.loadAddon(new F);r.term.fit()}catch(e){}
_sz();
setTimeout(()=>{try{if(this.active&&r.term&&document.getElementById("lock_block")){_sz();this._boxAnimating=!1;try{this._drawLockBox(!1)}catch(e){};try{this._startLockAnim&&this._startLockAnim()}catch(e){}}},150);
```

**注意**:`this._boxAnimating=!0;try{this._drawLockBox(!0)}catch(e){}` 这一段(17fix 里在替换点 C 之后)建议**删掉**——改成直接 `_drawLockBox(!1)`(直绘,不做 garble 动画),避免 garble 的异步回写与 150ms 重绘打架。LOCK2_NEW(teardown,行 135)不动。
（若想保留 garble 特效:删掉 150ms 重绘、保留 `_drawLockBox(!0)`,并接受 fit 失败时锁屏框可能不居中——不建议。）

**验证**:构建后部署,用 `super+ L` 锁屏(补丁已把锁屏快捷键改成 Super+L),看:① 锁屏框在全屏正中;② UI 是半透明遮罩可见状态(不是纯黑);③ 虚拟键盘可点;④ 输错/输对码有震动/解锁动画。

### Bug3 CLAUDE 终端滚动 —— 已定方案,改 terminal.class.js

**根因**:Claude Code 是 TUI,用 alt-screen buffer。xterm 4.14.1(已确认 334626B) **不支持 alt buffer scrollback**(`scrollLines()` 在 alt buffer 是 no-op)。#9 补丁已让 alt buffer 滚轮 return 放行,但 xterm 对没请求鼠标跟踪的 TUI 不滚动。普通 bash(normal buffer + `scrollback:1500`)应该能滚——**明天先手动验证普通终端能滚**(截图上 bash 里往上滚应该能看到 scrot 命令历史)。

**方案(已确认 SerializeAddon 在 deps 里,`/node_modules/xterm-addon-serialize/lib/xterm-addon-serialize.js` 11291B,`_serializeBufferAsHTML` 用 `t.buffer.active`——能序列化 alt buffer)**:给终端加「alt 屏截图历史」,滚轮在 alt buffer 时翻历史、滚回底部恢复 live。

改动点(全部加在 terminal.class.js 的 client 分支,`this.term.loadAddon(a)`(Ligatures)之后、`m.addEventListener("wheel"...)` 之前):
1. 初始化字段(类体内字段位置,不是方法里——注意 12fix 纪律:类体内只能写字段):
   `this._altHist=[],this._altHistIdx=0,this._altLast="",this._altPaused=!1,this._altLastT=0,`
2. 包一层 `this.term.write`,在 alt buffer 且暂停时丢帧 + 定时截图:
   ```js
   const _ow=this.term.write.bind(this.term);
   this.term.write=d=>{if(this._altPaused){return}try{const b=this.term.buffer&&this.term.buffer.active;if(b&&"alt"===b.type){const t=Date.now();if(t-this._altLastT>250){this._altLastT=t;if(!this._serializeA){const{SerializeAddon:S}=require("xterm-addon-serialize");this._serializeA=new S;this.term.loadAddon(this._serializeA)}const s=this._serializeA.serialize();if(s&&s!==this._altLast){this._altLast=s;this._altHist.push(s);this._altHist.length>400&&this._altHist.shift();this._altHistIdx=0}}}}catch(e){}_ow(d)},
   ```
3. wheel handler 的 alt buffer 分支(替换 #9 的 `if(_b&&"alt"===_b.type){return}`):
   ```js
   if(_b&&"alt"===_b.type){e.preventDefault(),e.stopPropagation();const d=e.deltaY;if(d>0&&this._altHistIdx>0){this._altHistIdx--;const s=this._altHist[this._altHistIdx];if(s){this._altPaused=!0;this.term.reset();this.term.write(s)}}else if(d<0){if(this._altHistIdx<this._altHist.length-1){this._altHistIdx++;const s=this._altHist[this._altHistIdx];if(s){this._altPaused=!0;this.term.reset();this.term.write(s)}}else{this._altPaused=!1;this._altHistIdx=0;this.term.reset();this._altLast&&this.term.write(this._altLast)}}return}
   ```
   (往上滚:向前翻;往下滚:向后翻;到底:恢复 live 显示最新屏。)

**风险**:SerializeAddon 是额外内存/CPU(每 250ms 一次 200×50 屏序列化很轻);400 帧上限。若 Claude Code 自己响应 PgUp/滚轮就不需要这套——**但实现上这套兜底更稳**。
**明天先做**:确认普通终端能滚;若 Claude Code TUI 实际是 normal buffer(非 alt),这套就不触发,无副作用。

### Bug4 文件浏览器跳动 —— 已定方案,改 filesystem.class.js

**根因(已彻底排查)**:用户以为 Enter 漏给文件浏览器,但**不是**——全局 keydown 都没有普通 Enter 处理:
- `classes/browser.class.js`(29284B):只在自己的地址栏/查找栏 input 上绑 Enter。
- `_renderer.js` 所有全局 keydown(6 处):F9/F11/Alt/Meta+L/Ctrl+D/Ctrl+A/数字等,无 Enter。
- `classes/filesystem.class.js`:全局 keydown 只处理 Ctrl+A(框选)和 Delete(删除),都带 `_fsHovered` 判断。
真因:回车后 bash/Claude Code 在当前目录产生文件活动 → `watchFS` 的 fs.watch 触发 `_runNextTick=true`(1s 间隔轮询,只认非 'change' 事件=新建/删除/改名)→ `readFS` **先 `filesContainer.innerHTML='<div class="fs_loading">...LOADING...</div>'` 清空面板+转圈,再 readdir 重渲染** → 视觉「动一下/刷新了一下」。

**方案(已定)**:让「同目录后台重读」变成**静默刷新**:
1. readFS 开头,当 `e===this.dirpath` 且不是用户主动导航时,**不显示 LOADING、不清空容器**,保留当前内容直接读新列表。
2. 读完后,若新列表签名(名字+类型+顺序)与当前 `this.cwd` 一致 → **跳过 render**,完全不重绘。
3. 只有当目录内容真的变了才重渲染(此时变化是真实的,该刷新)。

改动位置(原始 `classes/filesystem.class.js` 60001B):
- readFS 的 LOADING 行:`this.filesContainer.innerHTML='<div class="fs_loading"><div class="fs_loading_ring"></div><div class="fs_loading_text">LOADING</div></div>'` 前面加一个 `const _silent=e===this.dirpath&&!!this.cwd&&this.cwd.length;` 条件,`_silent||(...LOADING...)`。
- readFS 末尾 `this.dirpath=t,this.render(this.cwd),this._reading=!1` 之前,加签名比对:
  ```js
  const _sig=this.cwd.map(x=>x.name+":"+x.type+":"+(x.size||0)).join("|");
  if(_silent&&_sig===this._fsSig){this._reading=!1;return}
  this._fsSig=_sig;
  ```
- `this.cwd.sort(...)` 之后、`this.cwd.splice(0,0,{name:"Show disks"...})` 之前的位置要拿到签名(在插入 Show disks/Go up 之前算)。

**注意**:`this.cwd` 在 readFS 里被重建(splice 头部插入 Show disks/Go up),签名要在 splice 之后才算,否则每次都不一样。建议在 `this.dirpath=t,this.render(this.cwd)` 前算签名(此时 cwd 已是最终列表)。

---

## §4 落地步骤(✅ 已全部完成)

1. ✅ 确认普通终端能滚、Claude Code 是 alt buffer(此前会话已确认)。
2. ✅ 全部补丁已写进 `packaging/patch-appimage.sh`(见 §7 实际改动)。
3. ✅ `node --check` 全部改动 js 通过(独立临时文件,避免后台并发写污染)。
4. ✅ 构建:`bash packaging/patch-appimage.sh <orig> <18fix>` → 185088762B。
5. ✅ 部署:备份 17fix(`/opt/edex/eDEX-UI.AppImage.17fix-20260811`)→ rm+cp 部署 18fix。
6. ⏳ 重启:**先问用户**(用户已指示先推 GitHub、检查确认后再重启)。
7. ⏳ 验证:见 §7 验证清单。
8. ✅ 归档:本文件 + CONTINUE.md 已更新、已 commit + push 到 `haneyo/haneyoedexos`(master)。

---

## §5 已提取/可复用的文件

- `/tmp/orig/unpacked/resources/app.asar` —— 原始基座(打补丁的输入)。
- `/tmp/orig/out/assets__css__mod_sysinfo.css`(851B)、`/tmp/orig/out/classes__lockScreen.class.js`(22526B)、`/tmp/orig/out/classes__terminal.class.js`(10413B)、`/tmp/orig/out/classes__filesystem.class.js`(60001B)、`/tmp/orig/out/assets__css__browser.css`。
- `/tmp/edex-inspect-18/out/` —— 17fix(当前运行)版本的同名文件,含 LOCK1_NEW/LOCK2_NEW 生效后的 lockScreen、加了 enableMouseEvents/scrollback 的 terminal。
- `/tmp/xterm.js` —— xterm 4.14.1(确认无 alt buffer scrollback)。
- `/tmp/shot1.png`、`/tmp/shot1_ocr.txt` —— 全屏截图 + OCR(可见 sysinfo 重叠、底部 FILESYSTEM 面板、Claude 审批界面)。
- asar 工具:`/tmp/asartool/node_modules/asar`。

## §6 本次会话已确认的事实(不用重复调查)

- Electron **v24.18.0**(Chromium ~112)→ `inset:0` 等现代 CSS 全支持。
- 全局 keydown **没有**普通 Enter 处理 → Enter 不会漏给文件浏览器(Bug4 真因是 fs.watch + readFS 的 LOADING 闪)。
- `xterm-addon-fit` 0.5.0 与 `xterm-addon-serialize` 都可用。
- 用户要求:别问 YES/NO 一律 YES;只有重启/功能修改才问;别过度分析直接修。

---

## §7 实际改动与验证记录(2026-08-12 归档)

### 部署产物
- 18fix:`/tmp/eDEX-UI.AppImage.18fix-20260811` = `/opt/edex/eDEX-UI.AppImage`(sha1 `0fd54cdb…`,185088762B)。
- 已备份 17fix:`/opt/edex/eDEX-UI.AppImage.17fix-20260811`(sha1 `bcafda63…`,185072378B)。
- 校验点:`/tmp/edex-18fix-check5/sq/resources/app.asar`(最终产物 unsquashfs 提取)。
- 原始基座未动:`/opt/edex/eDEX-UI.AppImage.orig-20260811`(185031425B)。

### 4 个 Bug + 2 个衍生修复的落地情况

1. **Bug1 sysinfo 重叠** → `mod_sysinfo.css` target:在 17fix 等宽列基础上追加
   `font-size:1.111vh→1.0vh`、`letter-spacing:.092vh→.04vh`、列 padding `.25vh→.1vh`。
2. **Bug2 code 锁屏框左上角 + UI 消失** → `lockScreen.class.js` LOCK1_NEW:
   - 虚拟终端 `allowTransparency:!0` + `theme.background:"rgba(0,0,0,0)"` → 遮罩后的 UI 可见;
   - 容器 CSS 去掉 `background:#000`;
   - fit + 按容器尺寸 `resize` 兜底 + 150ms 延迟重算重绘 → 锁屏框铺满居中;
   - 修正 setTimeout 区域 try/catch 失衡(补 TRY#5 闭合 + catch);改用 `_drawLockBox(!1)` 直绘避免与重绘打架。
3. **Bug3 CLAUDE 终端无法滚动** → `terminal.class.js`:alt-screen 截图历史
   `_altHist`(SerializeAddon 每 250ms 快照 alt buffer,400 帧上限);滚轮在 alt buffer 时翻历史、
   到底恢复 live。类内字段写法(禁 const/IIFE)。**另有 wheel join 修复**(anchor 尾部补 `)`,
   `return` 移进 alt 分支)。顺带修复 **Bug5 ws 断线重连锚点转义**(`\\.` 求值后匹配原始 `\.`,
   使 `_wsConn` 首次真正生效)。
4. **Bug4 回车文件浏览器跳动** → `filesystem.class.js`:readFS 静默刷新——
   同目录后台重读不显示 LOADING、不清容器;列表签名比对相同则跳过 render(短路表达式注入,
   避免 const/if 进逗号表达式)。
5. **SSVT 屏保虚拟终端**(用户此前要求"屏保用假终端不污染真终端"):screensaver IIFE 用独立
   xterm(`screensaver_vt` div,z-index 2500)跑虚拟代码,7 个变换锚点全命中 built。
6. **AM_LBL_NEW 修复**:appmonitorPanel try 语句包 IIFE(逗号表达式里禁语句)。

### 校验结果
- 改动文件逐个 `node --check` 全过(lockScreen/terminal/filesystem/appmonitorPanel/_renderer 等)。
- built `_renderer.js`:SSVT 7 锚点全命中(`_mkSsvt`×3/`_rmSsvt`×4/`screensaver_vt`×1),
  屏保 IIFE 区域零真终端引用,`I()`→`const I=()=>{if(!Vt||!Vt.write)return;`。
- lockScreen 独立虚拟终端(`__lockvirt`),仅剩 2 处 `window.term[0]` 为防误销毁比较。
- terminal:`_wsConn`×5 / `_altHist`×19 / `_doneT`×4 / `_userIn`×2 全部在 built 内。

### 重启后验证清单
① 锁屏框全屏正中 + UI 半透明可见(非纯黑);② 解锁后上次对话原样保留(真终端未被污染);
③ 屏保跑虚拟代码、不打断真终端;④ sysinfo LOAD/UPTIME/TYPE/POWER 不重叠;
⑤ 回车时文件浏览器不跳(无 LOADING 闪);⑥ Claude 终端滚轮可看历史;⑦ 锁屏快捷键 Super+L。
→ 验收通过后再做真机验证归档同步(U盘 artifacts + CONTINUE.md)。
