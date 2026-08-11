#!/usr/bin/env bash
# patch-appimage.sh — 就地修复 eDEX-UI AppImage(纯 node + squashfs 重组,不改源文件)
#
# 修复 1:#t.setAttribute 弹窗。eDEX 的 Keyboard 类在 keydown/keyup 里对 Enter 键取
#   document.querySelectorAll("div.keyboard_key.keyboard_enter") 的 NodeList;当屏幕键盘
#   层不存在(设置关掉了键盘,但处理器仍装在 document 上)时 NodeList 为空,
#   `t.length ? t.forEach(...) : t.setAttribute(...)` 走 else 分支,
#   在 NodeList 上调用 setAttribute → TypeError → 每次按回车都弹窗、抢焦点。
#   修复:把两处 `(t.length?` 改成 `(t.forEach?` —— 空 NodeList 时 forEach 空转,安全;
#   单个 Element(其它键)没有 forEach,仍走 setAttribute,行为不变。
#
# 修复 2:天气弹窗字体。点击天气出现的弹窗内容全部用终端等宽字体
#   --font_mono(Fira Mono),与整体 UI 的 --font_main(United Sans Medium)不一致。
#   修复:把 modal.css 里 .mod_wx* 规则的字体改为 var(--font_main),其它 modal 不动。
#
# 补丁采用 asar 就地追加:仅改目标 entry 的 size/offset/integrity,其余条目与全部
# 数据原样保留,不经过 extract+repack,因此不会丢 .asar.unpacked 里的文件。
# 幂等:已打过补丁的 AppImage 再跑一遍会跳过并原样输出。
#
# 用法:
#   bash packaging/patch-appimage.sh <eDEX-UI.AppImage> [out.AppImage]
#   默认输出:与输入同目录的 <name>.patched.AppImage(不改源文件)
#
# 依赖:unsquashfs / mksquashfs / node / python3。不需要 root。
set -euo pipefail

SRC="${1:?usage: patch-appimage.sh <AppImage> [out.AppImage]}"
[[ -f "$SRC" ]] || { echo "missing AppImage: $SRC"; exit 1; }
SRC="$(readlink -f "$SRC")"
if [[ -n "${2:-}" ]]; then OUT="$(readlink -f "$2")"; else OUT="${SRC%.AppImage}.patched.AppImage"; fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SQ="$WORK/image.sqfs"

echo "[patch] AppImage: $SRC"
echo "[patch] output : $OUT"

# ---- 1. 定位 squashfs(扫描全部 'hsqs',取超块字段合法的那一个)----
OFFSET="$(python3 - "$SRC" <<'PY'
import struct, sys
data = open(sys.argv[1], 'rb').read()
n = len(data)
pos = 0
while True:
    i = data.find(b'hsqs', pos)
    if i < 0 or i + 96 > n:
        break
    blksz = struct.unpack('<I', data[i+12:i+16])[0]
    bytes_used = struct.unpack('<Q', data[i+40:i+48])[0]
    if blksz in (4096, 8192, 16384, 32768, 65536, 131072) and 0 < bytes_used < n:
        print(i)
        sys.exit(0)
    pos = i + 1
sys.exit("no valid squashfs superblock found")
PY
)"
BYTES_USED="$(python3 - "$SRC" "$OFFSET" <<'PY'
import struct, sys
data = open(sys.argv[1], 'rb').read()
o = int(sys.argv[2])
print(struct.unpack('<Q', data[o+40:o+48])[0])
PY
)"
SQ_END=$(( OFFSET + BYTES_USED ))
echo "[patch] squashfs @ $OFFSET, bytes_used=$BYTES_USED (end $SQ_END)"

# ---- 2. 切出 squashfs、解包 ----
python3 - "$SRC" "$OFFSET" "$SQ_END" "$SQ" <<'PY'
import sys
data = open(sys.argv[1], 'rb').read()
open(sys.argv[4], 'wb').write(data[int(sys.argv[2]):int(sys.argv[3])])
PY
unpacked="$WORK/unpacked"
unsquashfs -d "$unpacked" "$SQ" >/dev/null
ASAR="$unpacked/resources/app.asar"
[[ -f "$ASAR" ]] || { echo "[patch] no resources/app.asar in AppImage"; exit 1; }

# ---- 3. 就地补丁 app.asar(纯 node,无外部依赖;每个目标文件可增可减)----
node - "$ASAR" <<'JS'
const fs = require('fs'), crypto = require('crypto');
const p = process.argv[2];
const orig = fs.readFileSync(p);
const headerSize = orig.readUInt32LE(4), jsonLen = orig.readUInt32LE(12);
const base = 8 + headerSize;                       // 数据区基址(readFileSync 用 8+headerSize)
const header = JSON.parse(orig.slice(16, 16 + jsonLen).toString('utf8'));

// 目标文件:path 沿 header.files 逐层下钻(dir 节点有 .files,文件节点有 .size)。
// expectIn/expectOut 用于幂等:已含 expectOut 视为打过补丁跳过,缺失 expectIn 视为内容意外。

// ---- 修复 4:运行久了卡顿(#12)→ 周期性「部件层无感重置」(终端 100% 不碰)----
// 机制:渲染进程每 periodicResetMinutes 分钟,在用户闲置 ≥60s 时销毁并重建 dashboard
// 部件层(clock/cpuinfo/ramwatcher/toplist/netstat/conninfo/sysinfo/globe/hardwareInspector),
// 清掉累积的动画/GC 状态。**完全不触碰 window.term 与终端 DOM/websocket**,终端内容原样保留。
//   - widget 的 interval/timeout/rAF 句柄都是 numeric 属性,通用 destroy 清掉
//     (对非句柄数字调 clearInterval/clearTimeout/cancelAnimationFrame 是安全 no-op);
//   - globe 的 rAF 递归循环用 _dead 标志停(见 locationGlobe.class.js 补丁),新实例照常跑;
//   - 清列只删非 H3 子节点,保留 PANEL title;
//   - 重置前若近 1 分钟有键盘/鼠标活动,顺延 5 分钟再重试,不打断正在输入。
// 开关:settings.json 的 periodicResetMinutes(0 或缺省→默认 90;设 0 关闭)。
// 调试:DevTools 里手动执行 window.__edexWidgetReset()。
const APPEND = `
;(function(){try{
var _edexCols=["clock","sysinfo","hardwareInspector","cpuinfo","ramwatcher","toplist","netstat","globe","conninfo"];
var _edexCtor={clock:function(){return new Clock("mod_column_left")},sysinfo:function(){return new Sysinfo("mod_column_left")},hardwareInspector:function(){return new HardwareInspector("mod_column_left")},cpuinfo:function(){return new Cpuinfo("mod_column_left")},ramwatcher:function(){return new RAMwatcher("mod_column_left")},toplist:function(){return new Toplist("mod_column_left")},netstat:function(){return new Netstat("mod_column_right")},globe:function(){return new LocationGlobe("mod_column_right")},conninfo:function(){return new Conninfo("mod_column_right")}};
var _edexDestroy=function(m){if(!m)return;try{for(var k in m){var v=m[k];if("number"==typeof v){try{clearInterval(v)}catch(e){}try{clearTimeout(v)}catch(e){}try{cancelAnimationFrame(v)}catch(e){}}}}catch(e){}try{m._dead=!0}catch(e){}};
var _edexWidgetReset=function(){try{
 var mods=window.mods||{};
 for(var i=0;i<_edexCols.length;i++){var k=_edexCols[i],m=mods[k];if(m){try{_edexDestroy(m)}catch(e){}}}
 ["mod_column_left","mod_column_right"].forEach(function(cid){try{var col=document.getElementById(cid);if(!col)return;var kids=col.children;for(var j=kids.length-1;j>=0;j--){var el=kids[j];if(el&&"H3"!==el.tagName){try{col.removeChild(el)}catch(e){}}}}catch(e){}});
 for(var i2=0;i2<_edexCols.length;i2++){var k2=_edexCols[i2];try{mods[k2]=_edexCtor[k2]()}catch(e){}}
}catch(e){try{console.error("edex widget reset failed:",e)}catch(_){}}};
window.__edexWidgetReset=_edexWidgetReset;
var _edexMins=window.settings&&window.settings.periodicResetMinutes;
_edexMins=(_edexMins===undefined||_edexMins===null)?90:Number(_edexMins);
if(_edexMins>0){setTimeout(function _edexWatch(){
 try{
  var last=window._lastActivityTime?window._lastActivityTime():0;
  if(Date.now()-last<60000){setTimeout(_edexWatch,5*60*1000);return;}
  _edexWidgetReset();
 }catch(e){}
 setTimeout(_edexWatch,_edexMins*60000);
},_edexMins*60000);}
}catch(e){try{console.error("edex wr init failed:",e)}catch(_){}}})();`;

// ---- 修复 10b:code 锁屏改用独立虚拟终端,不再碰真终端 term[0] ----
// 原实现:_showTerminalLock 把 main_shell z-index 提到 3200、focusShellTab(0),直接拿真终端
// term[0] 当画布 —— 截获它的 write/socket.send,_drawLockBox 里 t.reset() 清空真终端屏幕画
// 虚假代码,解锁时再 reset()+写回 _savedTerm → 真终端(Claude 会话)内容被覆盖/破坏。
// 新实现:虚假代码与解锁框画在一个临时创建的独立 xterm(放 lock_block 覆盖层内,全屏黑底),
// 键盘输入用全局 keydown 捕获,完全不动真终端 term[0];移除对 main_shell 等元素的 z-index
// 提升与 focusShellTab(0)。teardown 时移除 keydown、销毁虚拟终端、移除临时 input。
const LOCK1_OLD = 'const i=document.getElementById("mod_clock");i&&(this._origClockPos=i.style.position,i.style.position="relative",i.style.zIndex="3100");const o=document.getElementById("main_shell_title");o&&(this._origTitleZ=o.style.zIndex,o.style.zIndex="3100");const s=document.getElementById("main_shell");s&&(this._origShellClip=s.style.clipPath,this._origShellZ=s.style.zIndex,s.style.zIndex="3200",s.style.clipPath="none");const n=document.getElementById("main_shell_innercontainer");n&&(this._origInnerZ=n.style.zIndex,this._origInnerClip=n.style.clipPath,n.style.zIndex="3001",n.style.clipPath="polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))"),window.focusShellTab&&window.focusShellTab(0);const r=window.term[0];if(this._term=r,this._codeBuf="",r&&r.term&&(this._origTermWrite=r.term.write,this._rawWrite=r.term.write.bind(r.term),r.term.write=e=>{this.active&&this._suppressOutput||this._rawWrite(e)}),this._suppressOutput=!0,r)try{this._origSend=r.socket.send.bind(r.socket),r.socket.send=e=>this._termKey(e);try{const e=window.screensaver&&window.screensaver.preSaverTerm0;if(e&&"string"==typeof e&&e.length)this._savedTerm=e,this._serializeAddon=null,window.screensaver.preSaverTerm0=null;else if(this._savedTerm&&"string"==typeof this._savedTerm&&this._savedTerm.length)this._serializeAddon=null;else{const{SerializeAddon:e}=require("xterm-addon-serialize");this._serializeAddon=new e,r.term.loadAddon(this._serializeAddon),this._savedTerm=this._serializeAddon.serialize()}}catch(e){this._savedTerm=null,this._serializeAddon=null}this._boxAnimating=!0,this._drawLockBox(!0)}catch(e){}';
const LOCK1_NEW = 'const r={term:null,socket:null,id:"__lockvirt"};if(this._term=r,this._codeBuf="",this._suppressOutput=!0)try{const T=require("xterm").Terminal;const src=window.term&&window.term[0]&&window.term[0].term;const th=window.theme&&window.theme.terminal||{};r.term=new T({cols:src?src.cols:80,rows:src?src.rows:24,fontFamily:th.fontFamily||"monospace",fontSize:th.fontSize||14,scrollback:0,disableStdin:!0,cursorBlink:!1,theme:{background:"#000000",foreground:th.foreground||"#33ffaa"}})}catch(e){r.term=null}if(r.term){try{const vc=document.createElement("div");vc.id="lock_virt_term",vc.style.cssText="position:absolute;inset:0;overflow:hidden;background:#000",t.appendChild(vc),r.term.open(vc);try{const F=require("xterm-addon-fit").FitAddon;r.term.loadAddon(new F),r.term.fit()}catch(e){}}catch(e){}this._rawWrite=r.term.write.bind(r.term),r.term.write=e=>this._rawWrite(e),this._boxAnimating=!0;try{this._drawLockBox(!0)}catch(e){}}try{const pi=document.createElement("input");pi.id="lock_pass_input",pi.type="text",pi.autocomplete="off",pi.inputMode="numeric",pi.style.cssText="position:fixed;left:-9999px;top:0;opacity:0",document.body.appendChild(pi),pi.focus(),this._keydownHandler=e=>{if(!this.active||this._boxAnimating)return;e.preventDefault(),e.stopPropagation();const k=e.key;if("Enter"===k)return this._codeSubmit();if("Backspace"===k||"Delete"===k)return this._codeBuf=this._codeBuf.slice(0,-1),this._codeRedraw();if(1===k.length&&k>=" ")this._codeBuf+=k,this._codeRedraw()},window.addEventListener("keydown",this._keydownHandler,!0)}catch(e){}';
const LOCK2_NEW = '_teardownLock(e){if(this._keydownHandler){try{window.removeEventListener("keydown",this._keydownHandler,!0)}catch(e){}this._keydownHandler=null}try{const pi=document.getElementById("lock_pass_input");pi&&pi.remove()}catch(e){}try{const v=document.getElementById("lock_virt_term");v&&v.remove()}catch(e){}try{if(this._term&&this._term.term&&this._term.term!==(window.term&&window.term[0]&&window.term[0].term)){try{this._term.term.dispose()}catch(e){}}this._term.term=null}catch(e){}this.active=!1,';

// ---- 修复 12:globe 累积状态 3-5 分钟无感重置(12fix 修正版)----
// 卡顿根因(#3.15):globe 动画 30fps 永不停 + 临时连接 pin(addTemporaryConnectedMarker)只加
// 不清(conns/pins 累积)→ 越用越卡 → 渲染主线程占满 → 鼠标锁死。
// 修复:随机 3/4/5 分钟无感重置一次 —— 清掉累积的 pins/markers/conns(ENCOM globe 已有
// removePins/removeMarkers),只重加本地定位点(_locPin/_locMarker,视觉不变)。帧率保持 30fps
// 流畅。随机间隔避免固定节奏被用户察觉。重置只清数据不重建实例,无闪断。
// ⚠️ 12fix 修正(2026-08-11):旧版把 `const _g=this;...!function t(){...}()` 语句直接注入
// class LocationGlobe{...} 类体内(构造器 `},4e3)}` 与方法 `_addRandomActivity(){` 之间)。
// JS 类体只允许方法/字段/分号,不允许 const 声明和 IIFE 语句 → SyntaxError(Unexpected
// identifier)→ locationGlobe.class.js 解析失败 → renderer 崩溃 → eDEX UI 无法启动
// (故障版 sha 7dbe8aeb…,用户经 fix-edex.sh 换回 .orig 恢复)。
// 修正:重置逻辑改为模块级 IIFE,注入到文件末尾 `module.exports={LocationGlobe};` 之后
// (模块作用域,语法合法),每次定时触发时查 window.mods.globe 单例(与 this 是同一对象),
// 每 3/4/5 分钟随机清一次累积状态。锚点改为文件尾,expectOut 标记 __edexGlobeReset。
const RESET_JS = ';(function(){window.__edexGlobeReset=function(){try{var _g=window.mods&&window.mods.globe;if(!_g||!_g.globe)return;try{_g.removePins&&_g.removePins()}catch(e){}try{_g.removeMarkers&&_g.removeMarkers()}catch(e){}_g.conns=[];try{var p=window.mods.netstat&&window.mods.netstat.ipinfo&&window.mods.netstat.ipinfo.geo;if(p&&void 0!==p.latitude&&void 0!==p.longitude){try{_g._locPin=_g.globe.addPin(p.latitude,p.longitude,"",1.2)}catch(e){}try{_g._locMarker=_g.globe.addMarker(p.latitude,p.longitude,"",!1,1.2)}catch(e){}}}catch(e){}}catch(e){}};var t=function(){try{window.__edexGlobeReset&&window.__edexGlobeReset()}catch(e){}setTimeout(t,[18e4,24e4,3e5][Math.floor(3*Math.random())])};setTimeout(t,[18e4,24e4,3e5][Math.floor(3*Math.random())])})();';


const targets = [
  {
    name: '_boot.js (win+L 锁屏快捷键 + 系统级 idle 推送)',
    path: ['_boot.js'],
    expectIn: '"CommandOrControl+Shift+O"',
    expectOut: '"Super+L"',
    // 锁屏快捷键 CommandOrControl+Shift+O → Super+L(Windows 键 + L)。
    // 另:在 powerMonitor suspend/resume 注册后追加 system-idle 推送,把系统级空闲秒数
    // 周期性发给渲染进程,供 _renderer.js 的 idle 检测用(焦点在其它窗口时不误判闲置)。
    transform: c => c
      .split('"CommandOrControl+Shift+O"').join('"Super+L"')
      .split('e.on("resume",()=>{win&&!win.isDestroyed()&&(win.webContents.send("pm:resume"),win.show(),win.focus(),win.webContents&&win.webContents.focus())})}catch(e){}')
      .join('e.on("resume",()=>{win&&!win.isDestroyed()&&(win.webContents.send("pm:resume"),win.show(),win.focus(),win.webContents&&win.webContents.focus())})}catch(e){}try{setInterval(()=>{try{if(win&&!win.isDestroyed()){let s=0;try{s=require("electron").powerMonitor.getSystemIdleTime()||0}catch(_){}win.webContents.send("system-idle",Math.floor(s))}}catch(_){}},1e3)}catch(_){}')
      .split('let d=new Terminal({role:"server",shell:a,params:l,login:c,cwd:tty.tty._cwd||e.cwd,env:p,port:i})')
      .join('let d=new Terminal({role:"server",shell:a,params:l,login:c,cwd:tty.tty._cwd||e.cwd,env:p,port:i,noBootCR:!!s})'),
  },
  {
    name: 'terminal.class.js (enableMouseEvents + alt-screen wheel 放行)',
    path: ['classes', 'terminal.class.js'],
    expectIn: 'scrollback:1500,',
    expectOut: 'scrollback:1500,enableMouseEvents:!0,',
    // 终端滚动修复:Claude Code 等 TUI 用 alt-screen buffer,滚轮事件被 eDEX 的 capture
    // handler preventDefault+scrollLines 吞掉(alt buffer 无 scrollback,scrollLines 无效)。
    // 1) xterm 开 enableMouseEvents:TUI 应用自会发 DECSET 请求鼠标跟踪,滚轮才以 SGR 发给
    //    pty(Claude Code/Ink 响应滚轮);bash 等不请求鼠标跟踪,不受影响。
    // 2) wheel handler 检测到 alt buffer 时直接 return(不 preventDefault),让事件到 xterm。
    transform: c => c
      .split('scrollback:1500,').join('scrollback:1500,enableMouseEvents:!0,')
      .split('m.addEventListener("wheel",e=>{e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      .join('m.addEventListener("wheel",e=>{const _b=this.term&&this.term.buffer&&this.term.buffer.active;if(_b&&"alt"===_b.type){return}e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      // claude 启动修复:新终端连接建立时 server 会给 pty 写一个裸 \r(为了刷新 bash 提示符)。
      // 但 claude 的 shell 是 claude-launcher.js(目录选择器),\r → select() → cursor=-1 →
      // 立即 launch(claude) → "选 cd 路径"和"启动 claude"同时发生。
      // 修复:claude 终端(noBootCR)跳过 boot 回车,用户先选目录再 Enter 才启动。
      .split('this._disableCWDtracking=!1,').join('this._disableCWDtracking=!1,this._noBootCR=!!e.noBootCR,')
      .split('try{this.tty.write("\\r")}catch(e){}}').join('try{this._noBootCR||this.tty.write("\\r")}catch(e){}}'),
  },
  {
    name: 'lockScreen.class.js (code 锁屏用独立虚拟终端)',
    path: ['classes', 'lockScreen.class.js'],
    expectIn: 'const r=window.term[0];if(this._term=r,this._codeBuf=""',
    expectOut: 'id:"__lockvirt"',
    transform: c => c
      .split(LOCK1_OLD).join(LOCK1_NEW)
      .split('_teardownLock(e){this.active=!1,').join(LOCK2_NEW),
  },
  {
    name: 'backend.js (openbox --config → --config-file)',
    path: ['appmonitor', 'backend.js'],
    expectIn: '"openbox",["--config",d,"--sm-disable"]',
    expectOut: '"openbox",["--config-file",d,"--sm-disable"]',
    // appmonitor 的 realBackend 用非法参数 --config 启动嵌套 openbox(正确是 --config-file),
    // openbox 秒退 → 虚拟显示器上无 WM → 应用窗口永不最大化。修复:用正确参数。
    // 另:noVNC 直连 ws://127.0.0.1:<rfbPort>/websockify,但 x11vnc 只提供 RFB(无 websocket)
    // → 握手失败 → Firefox tab 显示 link lost。修复:x11vnc 改用 rfbPort+10,再起 websockify
    // 监听原 rfbPort 转发到 rfbPort+10(系统已装 /usr/bin/websockify)。
    // 另:虚拟屏不再 spawn fcitx5。fcitx5 的 dbus name org.fcitx.Fcitx5 是 per-session 单实例
    // (不是 per-display)。主屏 :0 的 fcitx5 由 edex-session.sh 启动,供 eDEX 显示候选窗;
    // backend 对 :101/:102 再 spawn "fcitx5 -d --replace" 会把主屏实例顶掉 → eDEX 输入中文
    // 无候选窗(#144 盲打)。删除虚拟屏 fcitx5,让主屏实例独占 dbus name。
    transform: c => c
      .split('"openbox",["--config",d,"--sm-disable"]').join('"openbox",["--config-file",d,"--sm-disable"]')
      .split('s=o("x11vnc",["-display",e.display,"-rfbport",String(e.rfbPort),"-shared","-forever","-nopw","-listen","127.0.0.1"],{stdio:"ignore"});r.push(i,t,s);')
      .join('s=o("x11vnc",["-display",e.display,"-rfbport",String(e.rfbPort+10),"-shared","-forever","-nopw","-listen","127.0.0.1"],{stdio:"ignore"}),w=o("websockify",[String(e.rfbPort),"127.0.0.1:"+String(e.rfbPort+10)],{stdio:"ignore"});r.push(i,t,s,w);')
      .split('const n=o("fcitx5",["-d","--replace"],{stdio:"ignore",env:Object.assign({},process.env,{DISPLAY:e.display,GTK_IM_MODULE:"fcitx",QT_IM_MODULE:"fcitx",XMODIFIERS:"@im=fcitx"})});r.push(n);')
      .join(''),
  },
  {
    name: 'keyboard.class.js',
    path: ['classes', 'keyboard.class.js'],
    expectIn: '(t.length?', expectOut: '(t.forEach?',
    transform: c => c.split('(t.length?').join('(t.forEach?'),
  },
  {
    name: 'modal.css (weather popup font)',
    path: ['assets', 'css', 'modal.css'],
    expectIn: 'div.modal_popup .mod_wx_now b{font-family:var(--font_mono),monospace',
    expectOut: 'div.modal_popup .mod_wx_now b{font-family:var(--font_main)',
    // 天气弹窗(.mod_wx*)全部用终端等宽字体 --font_mono(Fira Mono),与整体 UI 的
    // --font_main(United Sans Medium)不一致;改成整体 UI 字体。其余 modal 不动。
    // 另:一周预报 .mod_wx_week 的 max-height:30vh 放不下 7 行(每行约 4.4vh,共约 31vh),
    // 第 7 天被截断、弹窗显"短"。修复:30vh → 50vh。
    transform: c => c
      .replace(/div\.modal_popup \.mod_wx[^{]*\{[^}]*\}/g, b =>
        b.replace(/font-family:var\(--font_mono\),monospace/g, 'font-family:var(--font_main)'))
      .split('div.modal_popup .mod_wx_week{max-height:30vh').join('div.modal_popup .mod_wx_week{max-height:50vh'),
  },
  {
    name: 'locationGlobe.class.js (30fps 恢复流畅 + 模块级 3-5 分钟无感重置)',
    path: ['classes', 'locationGlobe.class.js'],
    expectIn: 'this._animate=()=>{window.mods.globe.globe&&window.mods.globe.globe.tick()',
    expectOut: '__edexGlobeReset',
    // 卡顿/鼠标锁死修复(#3.15):globe rAF 30fps 永不停 + 临时连接 pin 只加不清 → 累积 →
    // 主线程占满 → 鼠标锁死。
    // 1) _dead 守卫保留:重置 widget 时旧 globe 的 rAF 要能停(widget 重置设 _dead=!0 再 new)。
    // 2) 帧率:11 修复版临时降到 8fps(1e3/8)被用户否决(动画变慢不值);恢复 30fps(1e3/30)。
    // 3) 注入 RESET_JS:随机 3/4/5 分钟无感重置 globe 累积状态(模块级 IIFE,见上方定义)。
    //    锚点是文件尾 module.exports={LocationGlobe}; 行;对已含 __edexGlobeReset 的版本
    //    再跑会因 expectOut 命中而 no-op。源输入必须含 1e3/8(11 修复版)才能恢复 30fps。
    transform: c => c
      .split('window.mods.globe._animate&&setTimeout').join('window.mods.globe._animate&&!this._dead&&setTimeout')
      .split('1e3/8)').join('1e3/30)')
      .split('module.exports={LocationGlobe};').join('module.exports={LocationGlobe};'+RESET_JS),
  },
  {
    name: '_renderer.js (battery centering + periodic widget-layer reset)',
    path: ['_renderer.js'],
    expectIn: 'document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})',
    expectOut: 'window.__edexWidgetReset',
    // 合并成一个 target:多个 _renderer.js target 会相互覆盖,必须合并。
    // 1) 电池图标对准:外框 rect x=1 w=25(rx=2,圆角从 x=24 开始),发光条 x=3 w=23*s/100。
    //    满电时条右端到 x=26 插进右圆角、条整体右偏 1 单位。改 21:条右端恰止于 x=24。
    // 2) 末尾追加部件层周期重置(不碰终端,见 APPEND)。
    // 3) 锁屏误触发修复 A:resumeFromSuspend/pm:resume 只恢复 UI,不再锁屏。全屏其它应用
    //    (如 Firefox)会让 Electron 窗口被 occlude → visibilitychange→visible →
    //    resumeFromSuspend → 无条件 lockScreen.engage() → 一回 eDEX 就锁屏(闲置几秒也锁)。
    // 4) 锁屏误触发修复 B:系统 suspend 事件不再自动锁屏(锁屏只由 屏幕超时/电源菜单/win+L 触发)。
    //    顺带挂 system-idle 监听:主进程每秒推系统级空闲秒数,供 idle 检测(修复 C)使用。
    // 5) 锁屏误触发修复 C:idle 检测改用系统级空闲秒数。原来只算 eDEX 窗口自身 DOM 事件
    //    停更时长,焦点在其它窗口(全屏 Firefox)时误判闲置 → 误触发屏保/锁屏。
    transform: c => c
      .split('(23*s/100)').join('(21*s/100)')
      .split('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})')
      .join('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})'+APPEND)
      .split('window.cursorTrap&&window.cursorTrap.show(),window.lockScreen&&!window.lockScreen.active&&!1!==window.settings.lockOnIdle&&String(window.settings.lockCode||"").length>0&&window.lockScreen.engage(),Object.keys(window.term||{})')
      .join('window.cursorTrap&&window.cursorTrap.show(),Object.keys(window.term||{})')
      .split('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}})')
      .join('ipc.on("pm:suspend",()=>{}),ipc.on("system-idle",(e,s)=>{try{window._sysIdleSec=Number(s)||0}catch(_){}})')
      .split('const e=Date.now()-lastActivity,t=window.lockScreen')
      .join('const e=1e3*(window._sysIdleSec>=0?window._sysIdleSec:Math.round((Date.now()-lastActivity)/1e3)),t=window.lockScreen'),
  },
];

function getEntry(path) {
  // header.files 本身就是根文件字典;包一层虚拟目录,统一用 `.files` 下钻
  let node = { files: header.files };
  for (const part of path) {
    if (!node || !node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return (node && node.size !== undefined) ? node : null;
}

const bufs = [];
for (const t of targets) {
  const entry = getEntry(t.path);
  if (!entry) { console.error(`[patch] ${t.name} not found in asar header`); process.exit(1); }
  const content = orig.slice(base + parseInt(entry.offset), base + parseInt(entry.offset) + entry.size).toString('utf8');
  if (content.includes(t.expectOut)) { console.log(`[patch] ${t.name} already patched, no-op`); continue; }
  if (!content.includes(t.expectIn)) { console.error(`[patch] unexpected content in ${t.name}: missing \`${t.expectIn}\``); process.exit(1); }
  const patched = t.transform(content);
  const buf = Buffer.from(patched, 'utf8');
  // 追加到数据区末尾,仅改这一个 entry;offset 取原数据区末尾 + 已追加缓冲之和
  entry.size = buf.length;
  entry.offset = String(orig.length - base + bufs.reduce((a, b) => a + b.length, 0));
  const blockSize = 4194304, blocks = [];
  for (let i = 0; i < buf.length; i += blockSize)
    blocks.push(crypto.createHash('sha256').update(buf.slice(i, i + blockSize)).digest('hex'));
  entry.integrity = { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(buf).digest('hex'), blockSize, blocks };
  bufs.push(buf);
  console.log(`[patch] ${t.name} ${content.length}B -> ${buf.length}B (patched)`);
}

if (!bufs.length) { console.log('[patch] nothing to patch, asar left untouched'); process.exit(0); }
const newJSON = JSON.stringify(header);
if (newJSON.length > jsonLen) { console.error(`[patch] header grew beyond original JSON len (${newJSON.length} > ${jsonLen})`); process.exit(1); }
const jsonBytes = Buffer.from(newJSON.padEnd(jsonLen, ' '), 'utf8');
const out = Buffer.concat([orig.slice(0, 16), jsonBytes, orig.slice(16 + jsonLen, base), orig.slice(base), ...bufs]);
fs.writeFileSync(p, out);
JS

# ---- 4. 重建 squashfs(与原版同参数 gzip/131072)----
SQUASHFS_OPTIONS="$(unsquashfs -s "$SQ" | awk '/Compression/{c=$2} /Block size/{b=$3} END{print c, b}')"
COMP="$(echo "$SQUASHFS_OPTIONS" | awk '{print $1}')"
BLOCK="$(echo "$SQUASHFS_OPTIONS" | awk '{print $2}')"
echo "[patch] rebuild squashfs: -comp $COMP -b $BLOCK"
mksquashfs "$unpacked" "$WORK/new.sqfs" -comp "${COMP:-gzip}" -b "${BLOCK:-131072}" -noappend >/dev/null

# ---- 5. 重组:运行时 + 新 squashfs + 原 trailer ----
python3 - "$SRC" "$OFFSET" "$SQ_END" "$WORK/new.sqfs" "$OUT" <<'PY'
import sys, os
src, off, end, nsq, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
data = open(src, 'rb').read()
runtime = data[:off]
trailer = data[end:]
new = bytearray(runtime) + open(nsq, 'rb').read() + trailer
if os.path.exists(out): os.remove(out)
open(out, 'wb').write(new)
os.chmod(out, 0o755)
print(f'[patch] wrote {out} ({len(new)} bytes)')
PY

echo "[patch] done. 原文件未动;新的补丁版 AppImage 已生成: $OUT"
