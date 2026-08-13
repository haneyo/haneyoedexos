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
 // 重建后的 widget 是新挂载的 div,而 mod_column.css 里 .mod_column > div 默认
 // opacity:0 + animation-play-state:paused(只有开机 reveal 才会置 running)。
 // 重置后若不触发 reveal,部件将永远停在 opacity:0 → 左右列整列空。
 // 与开机 reveal 相同:把动画置 running,0.5s fadeIn 后 fill-mode:forwards 停在可见。
 ["mod_column_left","mod_column_right"].forEach(function(cid){try{var col=document.getElementById(cid);if(!col)return;var kids=col.children;for(var j=0;j<kids.length;j++){var el=kids[j];if(el&&"H3"!==el.tagName){try{el.style.animationPlayState="running"}catch(e){}}}}catch(e){}});
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
const LOCK1_NEW = 'const r={term:null,socket:null,id:"__lockvirt"};if(this._term=r,this._codeBuf="",this._suppressOutput=!0)try{const T=require("xterm").Terminal;r.term=new T({cols:120,rows:34,fontFamily:(window.theme&&window.theme.terminal&&window.theme.terminal.fontFamily)||"Fira Mono",fontSize:18,scrollback:0,disableStdin:!0,cursorBlink:!1,allowTransparency:!0,theme:{background:(window.theme&&window.theme.terminal&&window.theme.terminal.background)||"#05080d",foreground:(window.theme&&window.theme.terminal&&window.theme.terminal.foreground)||"#aacfd1"}})}catch(e){r.term=null}if(r.term){try{const vc=document.createElement("div");vc.id="lock_virt_term",vc.style.cssText="position:absolute;inset:0;overflow:hidden;z-index:3200",(document.getElementById("main_shell_innercontainer")||t).appendChild(vc),r.term.open(vc);const _sz=()=>{try{const w=vc.clientWidth||window.innerWidth,h=vc.clientHeight||window.innerHeight,co=r.term._core;let cw=8,ch=17;try{const d=co._renderService&&co._renderService.dimensions;if(d&&d.css&&d.css.cell&&d.css.cell.width>0&&d.css.cell.height>0){cw=d.css.cell.width;ch=d.css.cell.height}}catch(_){}const c=Math.max(20,Math.floor(w/cw)),rr=Math.max(6,Math.floor(h/ch));if(c!==r.term.cols||rr!==r.term.rows)r.term.resize(c,rr)}catch(_){}};try{const F=require("xterm-addon-fit").FitAddon;r.term.loadAddon(new F),r.term.fit()}catch(e){}_sz();setTimeout(()=>{try{if(this.active&&r.term&&document.getElementById("lock_block")){_sz();this._boxAnimating=!1;try{this._drawLockBox(!1)}catch(e){};try{this._startLockAnim&&this._startLockAnim()}catch(e){}}}catch(e){}},150)}catch(e){}this._rawWrite=r.term.write.bind(r.term),r.term.write=e=>this._rawWrite(e)}try{const pi=document.createElement("input");pi.id="lock_pass_input",pi.type="text",pi.autocomplete="off",pi.inputMode="numeric",pi.style.cssText="position:fixed;left:-9999px;top:0;opacity:0",document.body.appendChild(pi),pi.focus(),this._keydownHandler=e=>{if(!this.active||this._boxAnimating)return;e.preventDefault(),e.stopPropagation();const k=e.key;if("Enter"===k)return this._codeSubmit();if("Backspace"===k||"Delete"===k)return this._codeBuf=this._codeBuf.slice(0,-1),this._codeRedraw();if(1===k.length&&k>=" ")this._codeBuf+=k,this._codeRedraw()},window.addEventListener("keydown",this._keydownHandler,!0)}catch(e){}';
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

// ---- 修复 13:cursorTrap 光标策略(用户反馈"鼠标不见了")----
// 原实现:全局闲置定时器,闲置 cursorAutoHideDelay(默认10s)后加 body.cursor_hidden 隐藏光标
// → UI 状态 10s 不动鼠标光标就消失,用户频繁"找不到鼠标"。
// 用户要求:UI 状态光标**一直显示**;只有锁屏/屏保状态才闲置自动隐藏,且动一下鼠标恢复。
// 修复:show() 只在锁屏/屏保激活(_ls)时才武装闲置隐藏定时器;UI 状态 show() 后不再武装,
// 光标常显。hide() 无条件生效(锁屏/屏保/息屏调用),解锁/退出屏保时 show() 恢复。
const CURSOR1_OLD = 'window.cursorTrap=(()=>{let e=null,t=!1===window.settings.cursorAutoHide;const n=()=>{t||document.body.classList.add("cursor_hidden")},o=()=>{document.body.classList.remove("cursor_hidden"),t||(e&&clearTimeout(e),e=setTimeout(n,1e3*(Number(window.settings.cursorAutoHideDelay)||10)))},s=()=>{t=!0,document.body.classList.remove("cursor_hidden")},i=()=>{t=!1,o()};return t||(window.addEventListener("mousemove",()=>o(),{passive:!0}),o()),{show:o,hide:n,off:s,on:i}})();';
const CURSOR1_NEW = 'window.cursorTrap=(()=>{let e=null;const _ls=()=>{try{return!!(window.lockScreen&&window.lockScreen.active)||!!(window.screensaver&&window.screensaver.isActive())}catch(_){return!1}},n=()=>{document.body.classList.add("cursor_hidden")},o=()=>{document.body.classList.remove("cursor_hidden"),e&&clearTimeout(e),_ls()&&(e=setTimeout(n,1e3*(Number(window.settings.cursorAutoHideDelay)||10)))},s=()=>{o()},i=()=>{o()};window.addEventListener("mousemove",()=>o(),{passive:!0}),o();return{show:o,hide:n,off:s,on:i}})();';

// ---- 修复 14(v2):设置网络分类里的 SSH 开关(#4)----
// 用户需求:SSH 开关放进"网络"设置分类,只留一个开/关 select,默认关闭;
//   点开 → 后台跑一条命令开 ssh(enable --now),点关 → 后台跑一条命令关 ssh(disable --now),
//   不显示在前台终端 tab(经 sysCmd.run 的 child_process.exec,和移动文件同路径)。
// 相比 v1(独立 "SSH" 分区 + 状态显示 + start/stop)的改动:
//   1) 不再建独立分区;网络分类末尾(bt 之后)插 section("settings.cat.ssh") + 一行开关。
//      锚点取网络分类最后一行(btDevices)结尾到 clash 分类开头的转移,在 `]` 前插入。
//      select 默认 value="0"(关),openSettings 的监听块会 refreshStatus() 回填真实状态。
//   2) window.ssh 对象(挂 clash 块后,和 clash 同层):refreshStatus 查 is-active 回填开关;
//      applyEnabled 按 select 值跑 enable --now / disable --now(开机后仍保持,不再每次重开)。
//   3) 打开设置时绑定 change 监听 + 刷新状态(插在 clash 监听之后,见 SSH_WIRE_* 链)。
// 幂等:_renderer.js target 的 expectOut 换成新版特征串 o("settings.cat.ssh"),n("settings.ssh.enabled",
//   保证旧部署(v1 分类态)→ v2 会执行;旧 SSH_SEC_OLD/SSH_OBJ_OLD revert 回锚点后新注入。
// v2.1(ssh.socket 修复):Ubuntu 24.04 socket 激活 sshd,`disable --now ssh` 停不彻底。
//   expectOut 改为 ssh ssh.socket 特征串(v2 部署版不含 → 会执行;含 → 跳过)。
//   SSH_OBJ_V2_OLD(v2 版对象)revert 回锚点后再注入 SSH_OBJ_NEW(v2.1 版)。
//   注意锚点里 minified 源是字面 `\n`(反斜杠+n),故 JS 字符串写 \\n;行内容用单引号+
//   字符串拼接(不用 `${}`,避免模板插值),与 APPEND 同风格。
//   新注入串以 btDevices 行尾结尾,注入后 SSH_NET_ANCHOR 被消费,重跑安全 no-op。
const SSH_SEC_ANCHOR = '},{id:"network",titleKey:"settings.cat.network",html:()=>{';
// v1 独立 SSH 分类(14fix 旧版注入),重跑时 revert 回锚点;对 pristine/current 是 no-op。
const SSH_SEC_OLD = `},{id:"ssh",titleKey:"settings.cat.ssh",html:()=>[o("settings.cat.ssh"),n("settings.ssh.status",'<span id="settingsSshStatus" class="settings_net_status">–</span>'),n("settings.ssh.enabled",'<select id="settingsSshEnabled">\\n                <option value="1" selected>'+t("settings.network.on")+'</option>\\n                <option value="0">'+t("settings.network.off")+'</option>\\n            </select>',"settings.ssh.enabled.help")].join("")},{id:"network",titleKey:"settings.cat.network",html:()=>{`;
// v2:网络分类末尾(btDevices 行后、数组 `]` 前)插 SSH 小节 + 一行开关,默认关。
const SSH_NET_ANCHOR = '"settings.network.btDevices.help")].join("")}},{id:"clash",titleKey:"settings.cat.clash",html:()=>{';
const SSH_NET_ROW = `"settings.network.btDevices.help"),o("settings.cat.ssh"),n("settings.ssh.enabled",'<select id="settingsSshEnabled">\\n                <option value="1">'+t("settings.network.on")+'</option>\\n                <option value="0" selected>'+t("settings.network.off")+'</option>\\n            </select>',"settings.ssh.enabled.help")].join("")}},{id:"clash",titleKey:"settings.cat.clash",html:()=>{`;
// 注:minified 源里 clash-log 的 ipc.on 结尾是 `...n.scrollHeight)});`(scrollHeight 后有个 `)`),
// 后面紧跟版本比较器 `const v=(e,t)=>{const n=(e||"").replace`。锚在该唯一转移处,在其间插入 window.ssh。
const SSH_OBJ_ANCHOR = ');const v=(e,t)=>{const n=(e||"").replace';
// v1 window.ssh(带 status 显示 + start/stop),重跑时 revert 回锚点。
const SSH_OBJ_OLD = ');window.ssh={status:null,refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh").then(e=>{this.status=e;const n=document.getElementById("settingsSshStatus"),o=document.getElementById("settingsSshEnabled"),a=e.ok&&"active"===(e.out||"").trim();n&&(n.textContent=a?t("settings.ssh.running"):t("settings.ssh.stopped"));o&&(o.value=a?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"start":"stop";window.sysCmd.run("sudo -n systemctl "+a+" ssh").then(()=>{this.refreshStatus()})}};const v=(e,t)=>{const n=(e||"").replace';
// v2(本行)= 已部署的 v2 版 window.ssh(只回填开关,但命令只带 ssh 单 unit):重跑时 revert 回锚点。
const SSH_OBJ_V2_OLD = ');window.ssh={refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh").then(e=>{const o=document.getElementById("settingsSshEnabled");o&&(o.value=e.ok&&"active"===(e.out||"").trim()?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"enable --now":"disable --now";window.sysCmd.run("sudo -n systemctl "+a+" ssh").then(()=>{this.refreshStatus()}).catch(()=>{})}};const v=(e,t)=>{const n=(e||"").replace';
// v2.1(本行)= 修复版:Ubuntu 24.04 的 sshd 是 socket 激活(ssh.socket),`disable --now ssh`
// 停掉 ssh.service 后 socket 会重新拉起,关不彻底。开关命令必须同时带 ssh 与 ssh.socket。
const SSH_OBJ_NEW = ');window.ssh={refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh").then(e=>{const o=document.getElementById("settingsSshEnabled");o&&(o.value=e.ok&&"active"===(e.out||"").trim()?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"enable --now":"disable --now";window.sysCmd.run("sudo -n systemctl "+a+" ssh ssh.socket").then(()=>{this.refreshStatus()}).catch(()=>{})}};const v=(e,t)=>{const n=(e||"").replace';
const SSH_WIRE_ANCHOR = 'window.clash&&window.clash.refreshStatus();const s=(e,t)=>{';
const SSH_WIRE_NEW_OLD = "window.clash&&window.clash.refreshStatus();const _se=document.getElementById(\"settingsSshEnabled\");_se&&_se.addEventListener(\"change\",()=>window.ssh.applyEnabled());window.ssh&&window.ssh.refreshStatus();const _mw=document.getElementById(\"settingsAppMonitorManageWebapps\");_mw&&_mw.addEventListener(\"click\",()=>{(window.appmonitorA||window.appmonitorB)&&(window.appmonitorA||window.appmonitorB).manageWebapps()});const s=(e,t)=>{";
const SSH_WIRE_NEW = "window.clash&&window.clash.refreshStatus();const _se=document.getElementById(\"settingsSshEnabled\");_se&&_se.addEventListener(\"change\",()=>window.ssh.applyEnabled());window.ssh&&window.ssh.refreshStatus();const _mw=document.getElementById(\"settingsAppMonitorManageWebapps\");_mw&&_mw.addEventListener(\"click\",()=>{(window.appmonitorA||window.appmonitorB)&&(window.appmonitorA||window.appmonitorB).manageWebapps()});const _dld=document.getElementById(\"settingsDlDir\");_dld&&(_dld.value=(window.settings&&window.settings.downloadDir)||require(\"os\").homedir()+\"/Downloads\");const _dla=document.getElementById(\"settingsDlApply\");_dla&&_dla.addEventListener(\"click\",()=>{const d=(_dld?_dld.value:\"\").trim();if(!d)return;ipc.invoke(\"dl:setDir\",{dir:d}).then(r=>{if(window.settings&&r&&r.ok)window.settings.downloadDir=d})});const _dladd=document.getElementById(\"settingsDlAdd\");_dladd&&_dladd.addEventListener(\"click\",()=>window.axel&&window.axel.add());window.axel&&window.axel.startPoll();const _cmo=document.getElementById(\"settingsClashMode\");_cmo&&_cmo.addEventListener(\"change\",()=>window.clash&&window.clash.setMode());const _cgr=document.getElementById(\"settingsClashGroupsRefresh\");_cgr&&_cgr.addEventListener(\"click\",()=>window.clash&&(window.clash.refreshGroups(),window.clash.refreshRules()));const s=(e,t)=>{";
// #31 屏保修复:闲置触发屏保前关闭所有打开的 modal(设置/自动更新弹窗不再盖住动画、不再把
// 显示器钉死在唤醒态)。锚点是屏保 enabled 分支的触发三元(e>=s 即 idle >= screensaverIdle),
// 替换成"先关全部 modal 再 show 屏保"的逗号表达式。与 sysCmd.startScreensaver 同一思路,只是
// 这里清全部而不是只关最后一个。src 侧对应改动在 setInterval 的 idle 触发块。
const SSMODAL_OLD = 'e>=s?window.screensaver.show():!screenOffEl()&&e>=o&&showScreenOff()';
const SSMODAL_NEW = 'e>=s?(function(){const k=window.modals?Object.keys(window.modals):[];for(let i=0;i<k.length;i++)try{window.modals[k[i]].close()}catch(_){}}(),window.screensaver.show()):!screenOffEl()&&e>=o&&showScreenOff()';
// ---- #8 AXEL 下载管理器 + #9 CLASH 设置增强 ----
// 权威定义在 /tmp/edex-anchor-check/sim-new.js(经 node --check + 端到端仿真校验)。
// 值内含 \\n(字面反斜杠-n)与 `${...}`(字面量),经 JSON.stringify 转义,运行时解出逐字节一致。
const AXEL_BOOT_ANCHOR = "ipc.handle(\"dl:getDir\",";
const AXEL_BOOT_NEW = "// ---- #8 AXEL download manager ----\nconst axelTasks=new Map();let axelSeq=0;\nconst axelSnapshot=()=>Array.from(axelTasks.entries()).map(([id,t])=>({id:id,url:t.url,dir:t.dir,file:t.file,threads:t.threads,status:t.status,percent:t.percent||0,speed:t.speed||0,eta:t.eta||\"\",paused:!!t.paused,error:t.error||null}));\nconst axelBroadcast=()=>{const t=Date.now();if(t-axelBroadcast._last<500)return;axelBroadcast._last=t;try{if(win&&!win.isDestroyed())win.webContents.send(\"axel-tick\",axelSnapshot())}catch(e){}};\nconst AXEL_PROG_RE=/\\[\\s*(\\d{1,3})%\\][^\\[]*\\[\\s*([0-9.,]+)\\s*([KMGT]?B)\\/s\\][^\\[]*\\[\\s*(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*\\]/;\nconst axelSpeedUnit={B:1,KB:1024,MB:1048576,GB:1073741824};\nconst axelParse=(task,chunk)=>{const s=String(chunk).split(/\\r|\\n/).map(x=>x.trim()).filter(Boolean);const last=s.length?s[s.length-1]:\"\";if(!last)return;const m=last.match(AXEL_PROG_RE);if(!m)return;task.percent=Math.min(100,Number(m[1]));task.speed=Number(m[2].replace(\",\",\".\"))*(axelSpeedUnit[m[3]]||1024);task.eta=m[6]?m[4]+\":\"+m[5]+\":\"+m[6]:m[4]+\":\"+m[5];if(\"paused\"!==task.status)task.status=\"downloading\";axelBroadcast()};\nconst axelSpawn=task=>{const{spawn}=require(\"child_process\");try{fs.mkdirSync(task.dir,{recursive:true})}catch(e){}task.status=\"downloading\";task.percent=0;task.speed=0;task.eta=\"\";task.error=null;const proc=spawn(\"axel\",[\"-a\",\"-n\",String(task.threads),\"-o\",task.dir,task.url],{env:Object.assign({},process.env,{LC_ALL:\"C\",LANG:\"C\"}),stdio:[\"ignore\",\"pipe\",\"pipe\"]});task.proc=proc;proc.stdout.on(\"data\",d=>axelParse(task,d));proc.stderr.on(\"data\",d=>axelParse(task,d));proc.on(\"close\",code=>{task.proc=null;if(task.paused)return;task.status=0===code?\"done\":\"error\";0!==code&&(task.error=\"exit \"+code);axelBroadcast()});proc.on(\"error\",e=>{task.status=\"error\";task.error=e.message;axelBroadcast()})};\nipc.handle(\"axel:add\",(e,{url,threads,dir}={})=>new Promise(resolve=>{const u=String(url||\"\").trim();if(!/^https?:\\/\\//i.test(u))return resolve({ok:false,error:\"BAD_URL\"});const th=Math.max(1,Math.min(32,parseInt(threads,10)||6));let d=\"\";if(dir&&String(dir).trim())d=String(dir).trim();else{try{const s=JSON.parse(fs.readFileSync(settingsFile,\"utf8\"));d=(s&&s.downloadDir)||electron.app.getPath(\"downloads\")}catch(e){d=electron.app.getPath(\"downloads\")}}const file=decodeURIComponent(String(u).split(\"?\")[0].split(\"/\").pop())||\"download\";const task={id:\"a\"+(++axelSeq),url:u,threads:th,dir:d,file:file,proc:null,paused:false,status:\"downloading\",percent:0,speed:0,eta:\"\",error:null};axelTasks.set(task.id,task);axelSpawn(task);resolve({ok:true,task:axelSnapshot().find(x=>x.id===task.id)})}));\nipc.handle(\"axel:list\",()=>({ok:true,tasks:axelSnapshot()}));\nipc.handle(\"axel:pause\",(e,{id}={})=>{const t=axelTasks.get(id);if(!t||!t.proc)return{ok:false,error:\"NOT_FOUND\"};try{t.proc.kill(\"SIGSTOP\")}catch(e){}t.paused=true;t.status=\"paused\";axelBroadcast();return{ok:true}});\nipc.handle(\"axel:resume\",(e,{id}={})=>{const t=axelTasks.get(id);if(!t||!t.proc)return{ok:false,error:\"NOT_FOUND\"};try{t.proc.kill(\"SIGCONT\")}catch(e){}t.paused=false;t.status=\"downloading\";axelBroadcast();return{ok:true}});\nipc.handle(\"axel:remove\",(e,{id}={})=>{const t=axelTasks.get(id);if(!t)return{ok:false,error:\"NOT_FOUND\"};if(t.proc)try{t.proc.kill(\"SIGCONT\"),t.proc.kill(\"SIGKILL\")}catch(e){}axelTasks.delete(id);axelBroadcast();return{ok:true}});\n";
// ---- #188 设置输入框:复制输入框感知 ----
// 用户报:从文件浏览器重命名复制文字贴到设置输入框(如 Claude API key)时,光标频繁丢焦点、
// 输一个字母后必须再点输入框、复制好几次才能粘贴成功。静态排查排除全部应用层夺焦路径后,
// 唯一真实缺陷:useAppShortcut("COPY") 无条件走终端复制 —— 在 modal 输入框里按 Ctrl+Shift+C
// 复制的始终是终端选区,输入框选区进不了剪贴板(PASTE 已做输入框感知,COPY 没有,不对称)。
// 已修:COPY 与 PASTE 对称 —— 焦点在 .modal_popup 内 INPUT/TEXTAREA 且选区非空时复制输入框选区。
// (fcitx5 -n 经真机确认是纯查询,5s 轮询不切 IME,与丢焦点无关。)
const FS_COPY_OLD = "case\"COPY\":return window.term[window.currentTerm].clipboard.copy(),!0;case\"PASTE\":{";
const FS_COPY_NEW = "case\"COPY\":{const e=document.activeElement,t=e&&e.closest&&e.closest(\".modal_popup\")&&(\"INPUT\"===e.tagName||\"TEXTAREA\"===e.tagName);if(t&&null!=e.selectionStart&&e.selectionEnd>e.selectionStart)try{return remote.clipboard.writeText(e.value.slice(e.selectionStart,e.selectionEnd)),!0}catch(e2){}return window.term[window.currentTerm].clipboard.copy(),!0}case\"PASTE\":{";
const CLASH_CTRL_ANCHOR = "ipc.handle(\"clash:status\",";
const CLASH_CTRL_NEW = "// ---- #9 Clash controller REST passthrough ----\nipc.handle(\"clash:ctrl\",(e,{method,path,body}={})=>new Promise(resolve=>{let cfg={controller:\"127.0.0.1:9090\",secret:\"\"};try{const s=JSON.parse(fs.readFileSync(settingsFile,\"utf8\"));cfg=Object.assign(cfg,(s&&s.clash)||{})}catch(e){}if(!cfg.controller)return resolve({ok:false,error:\"NO_CONTROLLER\"});const addr=String(cfg.controller).replace(/^https?:\\/\\//,\"\"),port=Number(addr.split(\":\")[1])||9090;const payload=null==body?null:JSON.stringify(body);const h=Object.assign({},payload?{\"Content-Type\":\"application/json\",\"Content-Length\":payload.length}:{},cfg.secret?{Authorization:\"Bearer \"+cfg.secret}:{});const req=http.request({host:\"127.0.0.1\",port:port,method:method||\"GET\",path:path||\"/\",headers:h},res=>{let data=\"\";res.on(\"data\",ch=>data+=ch);res.on(\"end\",()=>{try{resolve({ok:true,data:JSON.parse(data||\"null\")})}catch(e){resolve({ok:true,data:data||null})}})});req.on(\"error\",()=>resolve({ok:false,error:\"NO_RESPONSE\"}));req.setTimeout(8000,()=>{try{req.destroy()}catch(e){}resolve({ok:false,error:\"NO_RESPONSE\"})});if(payload)req.write(payload);req.end()}));\n";
const DL_OLD = "o(\"settings.cat.download\"),n(\"settings.download.dir\",`<div class=\"settings_net_pw\"><input type=\"text\" id=\"settingsDlDir\" placeholder=\"~/Downloads\"></div>\\n                <div class=\"settings_net_actions\"><button type=\"button\" id=\"settingsDlApply\" class=\"settings_net_btn\">${t(\"settings.download.apply\")}</button></div>`),n(\"settings.download.open\",`<button type=\"button\" id=\"settingsDlOpen\" class=\"settings_net_btn\">${t(\"settings.download.open\")}</button>`),n(\"settings.download.note\",`<span class=\"settings_net_info\">${t(\"settings.download.note\")}</span>`)";
const DL_NEW = "o(\"settings.cat.download\"),n(\"settings.download.dir\",`<div class=\"settings_net_pw\"><input type=\"text\" id=\"settingsDlDir\" placeholder=\"~/Downloads\"></div>`),n(\"settings.download.threads\",`<div class=\"settings_net_pw\"><input type=\"text\" id=\"settingsDlThreads\" inputmode=\"numeric\" value=\"${(window.settings.downloadThreads||6)}\"></div>`,\"settings.download.threads.help\"),n(\"settings.download.url\",`<div class=\"settings_net_pw\"><input type=\"text\" id=\"settingsDlUrl\" placeholder=\"https://…\"></div>\\n                <div class=\"settings_net_actions\">\\n                    <button type=\"button\" id=\"settingsDlAdd\" class=\"settings_net_btn\">${t(\"settings.download.add\")}</button>\\n                    <button type=\"button\" id=\"settingsDlApply\" class=\"settings_net_btn\">${t(\"settings.download.apply\")}</button>\\n                </div>`),n(\"settings.download.tasks\",`<div id=\"settingsDlTasks\" class=\"settings_net_list\" augmented-ui=\"bl-clip tr-clip exe\"></div>`)";
const CLASH_MODE_ANCHOR = "n(\"settings.clash.controller\",";
const CLASH_MODE_ROW = "n(\"settings.clash.mode\",`<select id=\"settingsClashMode\">\\n                    <option value=\"rule\">${t(\"settings.clash.mode.rule\")}</option>\\n                    <option value=\"global\">${t(\"settings.clash.mode.global\")}</option>\\n                    <option value=\"direct\">${t(\"settings.clash.mode.direct\")}</option>\\n                </select>`,\"settings.clash.mode.help\"),n(\"settings.clash.controller\",";
const CLASH_GROUPS_ANCHOR = "\"settings.clash.subUrl.help\"),n(\"settings.clash.configPath\",";
const CLASH_GROUPS_ROWS = "\"settings.clash.subUrl.help\"),n(\"settings.clash.groups\",`<div id=\"settingsClashGroups\" class=\"settings_net_list\" augmented-ui=\"bl-clip tr-clip exe\"></div>\\n                    <div class=\"settings_net_actions\">\\n                        <button type=\"button\" id=\"settingsClashGroupsRefresh\" class=\"settings_net_btn\">${t(\"settings.clash.groupsRefresh\")}</button>\\n                    </div>`),n(\"settings.clash.rules\",`<pre id=\"settingsClashRules\" class=\"settings_net_log\">–</pre>`,\"settings.clash.rules.help\"),n(\"settings.clash.configPath\",";
const CLASH_OBJ_CLOSE_OLD = "\")}},ipc.on(\"clash-log\",";
const CLASH_OBJ_CLOSE_NEW = "\")},refreshCtrl(){const st=this.status;if(!st||!st.running||!st.controller){this._clearGroups();return}this.refreshMode();this.refreshGroups();this.refreshRules()},refreshMode(){ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/configs\"}).then(r=>{if(r&&r.ok&&r.data&&r.data.mode)this.setModeValue(r.data.mode)}).catch(()=>{})},setModeValue(mode){const el=document.getElementById(\"settingsClashMode\");if(!el)return;el.value=mode;const wrap=el.closest(\".settings_dd\");if(wrap){const btn=wrap.querySelector(\".mod_loc_btn\");const opt=wrap.querySelector(`.mod_loc_opt[data-value=\"${mode}\"]`);if(btn&&opt)btn.textContent=opt.textContent;wrap.querySelectorAll(\".mod_loc_opt\").forEach(d=>d.classList.toggle(\"mod_loc_opt_active\",d.dataset.value===mode))}},setMode(){const el=document.getElementById(\"settingsClashMode\");if(!el)return;ipc.invoke(\"clash:ctrl\",{method:\"PATCH\",path:\"/configs\",body:{mode:el.value}}).then(()=>{})},refreshGroups(){ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/proxies\"}).then(r=>{const box=document.getElementById(\"settingsClashGroups\");if(!box)return;if(!r||!r.ok||!r.data){box.innerHTML=`<div class=\"settings_net_empty\">${t(\"settings.clash.ctrlError\")}</div>`;return}const proxies=r.data.proxies||{},esc=window._escapeHtml,groups=Object.entries(proxies).filter(([k,v])=>v&&[\"Selector\",\"URLTest\",\"Fallback\",\"LoadBalance\"].includes(v.type));if(!groups.length){box.innerHTML=`<div class=\"settings_net_empty\">${t(\"settings.clash.groupsEmpty\")}</div>`;return}box.innerHTML=groups.map(([name,g])=>{const opts=(g.all||[]).map(n=>`<option value=\"${esc(n)}\" ${n===g.now?\"selected\":\"\"}>${esc(n)}</option>`).join(\"\");return `<div class=\"settings_net_row\" style=\"flex-direction:column;align-items:stretch;cursor:default\"><div style=\"display:flex;justify-content:space-between;align-items:center\"><span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">${esc(name)}</span><span data-delay=\"${esc(name)}\" class=\"settings_net_info\">–</span></div><div style=\"display:flex;gap:1vh;align-items:center\"><select class=\"clash_group_sel\" data-group=\"${esc(name)}\">${opts}</select><button type=\"button\" class=\"settings_net_btn settings_net_mini\" data-test=\"${esc(name)}\">${t(\"settings.clash.test\")}</button></div></div>`}).join(\"\");box.querySelectorAll(\".clash_group_sel\").forEach(sel=>sel.addEventListener(\"change\",()=>{ipc.invoke(\"clash:ctrl\",{method:\"PUT\",path:\"/proxies/\"+encodeURIComponent(sel.dataset.group),body:{name:sel.value}}).then(()=>{})}));box.querySelectorAll(\"[data-test]\").forEach(btn=>btn.addEventListener(\"click\",()=>{const span=box.querySelector(`[data-delay=\"${btn.dataset.test}\"]`);if(span)span.textContent=t(\"settings.clash.testing\");ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/proxies/\"+encodeURIComponent(btn.dataset.test)+\"/delay?url=https://www.gstatic.com/generate_204&timeout=3000\"}).then(r=>{if(span)span.textContent=(r&&r.ok&&r.data&&r.data.delay)?t(\"settings.clash.delay\")+\" \"+r.data.delay+\"ms\":t(\"settings.clash.delayFail\")}).catch(()=>{if(span)span.textContent=t(\"settings.clash.delayFail\")})}))}).catch(()=>{})},refreshRules(){ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/rules\"}).then(r=>{const pre=document.getElementById(\"settingsClashRules\");if(!pre)return;const rules=(r&&r.ok&&r.data&&r.data.rules)||[];pre.textContent=rules.length?rules.map(x=>`${x.type}  ${x.payload||\"\"}  →  ${x.proxy}`).join(\"\\n\").slice(0,6000):t(\"settings.clash.rulesEmpty\")}).catch(()=>{})},_clearGroups(){const box=document.getElementById(\"settingsClashGroups\");if(box)box.innerHTML=\"\"}},ipc.on(\"clash-log\",";
const CLASH_METHODS = "refreshCtrl(){const st=this.status;if(!st||!st.running||!st.controller){this._clearGroups();return}this.refreshMode();this.refreshGroups();this.refreshRules()},refreshMode(){ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/configs\"}).then(r=>{if(r&&r.ok&&r.data&&r.data.mode)this.setModeValue(r.data.mode)}).catch(()=>{})},setModeValue(mode){const el=document.getElementById(\"settingsClashMode\");if(!el)return;el.value=mode;const wrap=el.closest(\".settings_dd\");if(wrap){const btn=wrap.querySelector(\".mod_loc_btn\");const opt=wrap.querySelector(`.mod_loc_opt[data-value=\"${mode}\"]`);if(btn&&opt)btn.textContent=opt.textContent;wrap.querySelectorAll(\".mod_loc_opt\").forEach(d=>d.classList.toggle(\"mod_loc_opt_active\",d.dataset.value===mode))}},setMode(){const el=document.getElementById(\"settingsClashMode\");if(!el)return;ipc.invoke(\"clash:ctrl\",{method:\"PATCH\",path:\"/configs\",body:{mode:el.value}}).then(()=>{})},refreshGroups(){ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/proxies\"}).then(r=>{const box=document.getElementById(\"settingsClashGroups\");if(!box)return;if(!r||!r.ok||!r.data){box.innerHTML=`<div class=\"settings_net_empty\">${t(\"settings.clash.ctrlError\")}</div>`;return}const proxies=r.data.proxies||{},esc=window._escapeHtml,groups=Object.entries(proxies).filter(([k,v])=>v&&[\"Selector\",\"URLTest\",\"Fallback\",\"LoadBalance\"].includes(v.type));if(!groups.length){box.innerHTML=`<div class=\"settings_net_empty\">${t(\"settings.clash.groupsEmpty\")}</div>`;return}box.innerHTML=groups.map(([name,g])=>{const opts=(g.all||[]).map(n=>`<option value=\"${esc(n)}\" ${n===g.now?\"selected\":\"\"}>${esc(n)}</option>`).join(\"\");return `<div class=\"settings_net_row\" style=\"flex-direction:column;align-items:stretch;cursor:default\"><div style=\"display:flex;justify-content:space-between;align-items:center\"><span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">${esc(name)}</span><span data-delay=\"${esc(name)}\" class=\"settings_net_info\">–</span></div><div style=\"display:flex;gap:1vh;align-items:center\"><select class=\"clash_group_sel\" data-group=\"${esc(name)}\">${opts}</select><button type=\"button\" class=\"settings_net_btn settings_net_mini\" data-test=\"${esc(name)}\">${t(\"settings.clash.test\")}</button></div></div>`}).join(\"\");box.querySelectorAll(\".clash_group_sel\").forEach(sel=>sel.addEventListener(\"change\",()=>{ipc.invoke(\"clash:ctrl\",{method:\"PUT\",path:\"/proxies/\"+encodeURIComponent(sel.dataset.group),body:{name:sel.value}}).then(()=>{})}));box.querySelectorAll(\"[data-test]\").forEach(btn=>btn.addEventListener(\"click\",()=>{const span=box.querySelector(`[data-delay=\"${btn.dataset.test}\"]`);if(span)span.textContent=t(\"settings.clash.testing\");ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/proxies/\"+encodeURIComponent(btn.dataset.test)+\"/delay?url=https://www.gstatic.com/generate_204&timeout=3000\"}).then(r=>{if(span)span.textContent=(r&&r.ok&&r.data&&r.data.delay)?t(\"settings.clash.delay\")+\" \"+r.data.delay+\"ms\":t(\"settings.clash.delayFail\")}).catch(()=>{if(span)span.textContent=t(\"settings.clash.delayFail\")})}))}).catch(()=>{})},refreshRules(){ipc.invoke(\"clash:ctrl\",{method:\"GET\",path:\"/rules\"}).then(r=>{const pre=document.getElementById(\"settingsClashRules\");if(!pre)return;const rules=(r&&r.ok&&r.data&&r.data.rules)||[];pre.textContent=rules.length?rules.map(x=>`${x.type}  ${x.payload||\"\"}  →  ${x.proxy}`).join(\"\\n\").slice(0,6000):t(\"settings.clash.rulesEmpty\")}).catch(()=>{})},_clearGroups(){const box=document.getElementById(\"settingsClashGroups\");if(box)box.innerHTML=\"\"}";
const IPCON_CLASHLOG = "ipc.on(\"clash-log\",";
const AXEL_OBJ_NEW = "window.axel={tasks:[],_started:false,refresh(){ipc.invoke(\"axel:list\").then(r=>{this.tasks=(r&&r.tasks)||[];this.render()}).catch(()=>{})},render(){const box=document.getElementById(\"settingsDlTasks\");if(!box)return;box.innerHTML=\"\";if(!this.tasks.length){box.innerHTML=`<div class=\"settings_net_empty\">${t(\"settings.download.noTasks\")}</div>`;return}this.tasks.forEach(task=>{const row=document.createElement(\"div\");row.className=\"settings_net_row\";row.style.flexDirection=\"column\";row.style.alignItems=\"stretch\";const pct=Math.max(0,Math.min(100,task.percent||0));const statusText=\"done\"===task.status?t(\"settings.download.status.done\"):\"paused\"===task.status?t(\"settings.download.status.paused\"):\"error\"===task.status?(task.error||t(\"settings.download.status.error\")):t(\"settings.download.status.downloading\");row.innerHTML=`<div style=\"display:flex;justify-content:space-between;gap:1vh\"><span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap\" title=\"${window._escapeHtml(task.url)}\">${window._escapeHtml(task.file)}</span><span>${statusText} ${pct}%</span></div><div style=\"height:1.4vh;background:rgba(0,0,0,.4);border-radius:2px;overflow:hidden\"><div style=\"width:${pct}%;height:100%;background:rgba(var(--color_r),var(--color_g),var(--color_b),.55)\"></div></div><div style=\"display:flex;justify-content:space-between;align-items:center\"><span style=\"opacity:.8\">${task.speed?axelFmtSpeed(task.speed):\"–\"} · ${task.eta?t(\"settings.download.eta\")+\" \"+task.eta:\"–\"}</span><span style=\"display:flex;gap:1vh\"><button type=\"button\" class=\"settings_net_btn settings_net_mini\" data-act=\"${task.paused?\"resume\":\"pause\"}\">${t(task.paused?\"settings.download.resume\":\"settings.download.pause\")}</button><button type=\"button\" class=\"settings_net_btn settings_net_mini\" data-act=\"remove\">${t(\"settings.download.remove\")}</button></span></div>`;row.querySelectorAll(\"button\").forEach(b=>b.addEventListener(\"click\",()=>this.act(task.id,b.dataset.act)));box.appendChild(row)})},act(id,act){const map={pause:\"axel:pause\",resume:\"axel:resume\",remove:\"axel:remove\"};ipc.invoke(map[act],{id}).then(()=>this.refresh()).catch(()=>{})},add(){const urlEl=document.getElementById(\"settingsDlUrl\"),thEl=document.getElementById(\"settingsDlThreads\"),dirEl=document.getElementById(\"settingsDlDir\");const url=urlEl?urlEl.value.trim():\"\";if(!/^https?:\\/\\//i.test(url)){notify(t(\"settings.download.badUrl\"));return}const dir=(dirEl?dirEl.value.trim():\"\")||undefined;ipc.invoke(\"axel:add\",{url:url,threads:thEl?thEl.value:6,dir:dir}).then(r=>{notify(r&&r.ok?t(\"settings.download.added\"):t(\"settings.download.addFailed\")+(r&&r.error?\" — \"+r.error:\"\"));if(r&&r.ok&&urlEl)urlEl.value=\"\";this.refresh()}).catch(()=>{})},startPoll(){if(this._started)return;this._started=true;this.refresh()}};const axelFmtSpeed=bps=>{const u=bps>=1073741824?[bps/1073741824,\"GB/s\"]:bps>=1048576?[bps/1048576,\"MB/s\"]:bps>=1024?[bps/1024,\"KB/s\"]:[bps,\"B/s\"];return u[0].toFixed(1)+\" \"+u[1]};ipc.on(\"axel-tick\",(e,snapshot)=>{if(!document.getElementById(\"settingsEditor\")||!window.axel)return;const snap=snapshot||[];const box=document.getElementById(\"settingsDlTasks\");if(!box)return;if(snap.length!==box.querySelectorAll(\".settings_net_row\").length){window.axel.refresh();return}window.axel.tasks=snap;const rows=box.querySelectorAll(\".settings_net_row\");snap.forEach((task,i)=>{const row=rows[i];if(!row)return;const pct=Math.max(0,Math.min(100,task.percent||0));const track=row.children[1];const bar=track&&track.children[0];if(bar)bar.style.width=pct+\"%\";const top=row.children[0];const statusSpan=top&&top.children[1];if(statusSpan){const statusText=\"done\"===task.status?t(\"settings.download.status.done\"):\"paused\"===task.status?t(\"settings.download.status.paused\"):\"error\"===task.status?(task.error||t(\"settings.download.status.error\")):t(\"settings.download.status.downloading\");statusSpan.textContent=statusText+\" \"+pct+\"%\"}const bottom=row.children[2];const infoSpan=bottom&&bottom.children[0];if(infoSpan)infoSpan.textContent=(task.speed?axelFmtSpeed(task.speed):\"–\")+\" · \"+(task.eta?t(\"settings.download.eta\")+\" \"+task.eta:\"–\");const btns=bottom&&bottom.children[1];const pauseBtn=btns&&btns.children[0];if(pauseBtn){const resume=task.paused;pauseBtn.dataset.act=resume?\"resume\":\"pause\";pauseBtn.textContent=t(resume?\"settings.download.resume\":\"settings.download.pause\")}})});";
const REFRESH_CTRL_OLD = "e.log.join(\"\\n\"))}).catch";
const REFRESH_CTRL_NEW = "e.log.join(\"\\n\")),this.refreshCtrl()}).catch";
const WSF_OLD = "document.getElementById(\"settingsEditor-appMonitor-appImageDirs\").value},n.clash={enabled:";
const WSF_NEW = "document.getElementById(\"settingsEditor-appMonitor-appImageDirs\").value},document.getElementById(\"settingsDlDir\")&&(n.downloadDir=document.getElementById(\"settingsDlDir\").value.trim()),document.getElementById(\"settingsDlThreads\")&&(n.downloadThreads=Math.max(1,Math.min(32,parseInt(document.getElementById(\"settingsDlThreads\").value,10)||6))),n.clash={enabled:";
// v1(14fix)SSH 文案(含 status/running/stopped),重跑时把旧全块 revert 回锚点。
const ZH_SSH_OLD = "\"settings.cat.ssh\":\"SSH 远程登录\",\"settings.ssh.status\":\"服务状态\",\"settings.ssh.enabled\":\"SSH 服务\",\"settings.ssh.enabled.help\":\"启用/停用 OpenSSH 服务器(sshd)。需要从其它设备远程连到本机时保持开启。\",\"settings.ssh.running\":\"运行中\",\"settings.ssh.stopped\":\"已停止\",";
const EN_SSH_OLD = "\"settings.cat.ssh\":\"SSH\",\"settings.ssh.status\":\"Service status\",\"settings.ssh.enabled\":\"SSH service\",\"settings.ssh.enabled.help\":\"Start/stop the OpenSSH server (sshd). Keep it on to reach this machine from other devices.\",\"settings.ssh.running\":\"running\",\"settings.ssh.stopped\":\"stopped\",";
const ZH_APP = "\"appmonitor.webapps.title\":\"Webapps\",\"appmonitor.webapps.manage\":\"管理 Webapps\",\"appmonitor.webapps.manage.help\":\"管理自建 Webapp 应用(可点应用列表菜单里的管理 Webapps 打开)。\",\"appmonitor.webapps.empty\":\"暂无自定义 Webapp,用 + ADD APP 添加\",\"appmonitor.webapps.delete\":\"删除\",\"appmonitor.webapps.removed\":\"已删除\",";
const ZH_AXEL = "\"settings.download.threads\":\"线程数\",\"settings.download.threads.help\":\"axel 并发连接数(1-32)。\",\"settings.download.url\":\"下载链接\",\"settings.download.add\":\"开始下载\",\"settings.download.apply\":\"应用\",\"settings.download.tasks\":\"下载任务\",\"settings.download.noTasks\":\"暂无下载任务\",\"settings.download.status.downloading\":\"下载中\",\"settings.download.status.paused\":\"已暂停\",\"settings.download.status.done\":\"完成\",\"settings.download.status.error\":\"出错\",\"settings.download.pause\":\"暂停\",\"settings.download.resume\":\"继续\",\"settings.download.remove\":\"删除\",\"settings.download.eta\":\"剩余\",\"settings.download.badUrl\":\"无效链接,只支持 http(s)\",\"settings.download.added\":\"已加入下载\",\"settings.download.addFailed\":\"添加失败\",";
const ZH_CLASH = "\"settings.clash.mode\":\"代理模式\",\"settings.clash.mode.help\":\"rule 分流 / global 全局 / direct 直连。\",\"settings.clash.mode.rule\":\"规则(Rule)\",\"settings.clash.mode.global\":\"全局(Global)\",\"settings.clash.mode.direct\":\"直连(Direct)\",\"settings.clash.groups\":\"代理组\",\"settings.clash.groupsRefresh\":\"刷新\",\"settings.clash.groupsEmpty\":\"暂无代理组\",\"settings.clash.test\":\"测速\",\"settings.clash.testing\":\"测速中…\",\"settings.clash.delay\":\"延迟\",\"settings.clash.delayFail\":\"测速失败\",\"settings.clash.rules\":\"规则列表\",\"settings.clash.rules.help\":\"当前生效的规则(只读),修改请用下方「打开配置」。\",\"settings.clash.rulesEmpty\":\"暂无规则\",\"settings.clash.ctrlError\":\"控制接口无响应\",";
const EN_APP = "\"appmonitor.webapps.title\":\"Webapps\",\"appmonitor.webapps.manage\":\"Manage webapps\",\"appmonitor.webapps.manage.help\":\"Manage your custom webapps (open via the Manage webapps entry in the app list menu).\",\"appmonitor.webapps.empty\":\"No custom webapps — add one with + ADD APP\",\"appmonitor.webapps.delete\":\"Delete\",\"appmonitor.webapps.removed\":\"Removed\",";
const EN_AXEL = "\"settings.download.threads\":\"Threads\",\"settings.download.threads.help\":\"Number of axel parallel connections (1-32).\",\"settings.download.url\":\"Download URL\",\"settings.download.add\":\"Start\",\"settings.download.apply\":\"Apply\",\"settings.download.tasks\":\"Download tasks\",\"settings.download.noTasks\":\"No download tasks\",\"settings.download.status.downloading\":\"Downloading\",\"settings.download.status.paused\":\"Paused\",\"settings.download.status.done\":\"Done\",\"settings.download.status.error\":\"Error\",\"settings.download.pause\":\"Pause\",\"settings.download.resume\":\"Resume\",\"settings.download.remove\":\"Remove\",\"settings.download.eta\":\"ETA\",\"settings.download.badUrl\":\"Invalid URL — http(s) only\",\"settings.download.added\":\"Download added\",\"settings.download.addFailed\":\"Failed to add download\",";
const EN_CLASH = "\"settings.clash.mode\":\"Mode\",\"settings.clash.mode.help\":\"rule / global / direct.\",\"settings.clash.mode.rule\":\"Rule\",\"settings.clash.mode.global\":\"Global\",\"settings.clash.mode.direct\":\"Direct\",\"settings.clash.groups\":\"Proxy groups\",\"settings.clash.groupsRefresh\":\"Refresh\",\"settings.clash.groupsEmpty\":\"No proxy groups\",\"settings.clash.test\":\"Test\",\"settings.clash.testing\":\"Testing…\",\"settings.clash.delay\":\"Delay\",\"settings.clash.delayFail\":\"Test failed\",\"settings.clash.rules\":\"Rules\",\"settings.clash.rules.help\":\"Current active rules (read-only); edit via Open config below.\",\"settings.clash.rulesEmpty\":\"No rules\",\"settings.clash.ctrlError\":\"Controller unreachable\",";
// v2 SSH 文案:去掉 status/running/stopped(无状态显示),help 写明默认关闭。
const ZH_SSH = "\"settings.cat.ssh\":\"SSH 远程登录\",\"settings.ssh.enabled\":\"SSH 服务\",\"settings.ssh.enabled.help\":\"启用/停用 OpenSSH 服务器(sshd)。默认关闭;需要从其它设备远程连到本机时打开。\",";
const EN_SSH = "\"settings.cat.ssh\":\"SSH\",\"settings.ssh.enabled\":\"SSH service\",\"settings.ssh.enabled.help\":\"Start/stop the OpenSSH server (sshd). Off by default; enable to reach this machine from other devices.\",";
// 派生 i18n 全块/局部块(匹配真实部署态:updates + SSH块 + APP块 连续)
// v2 全块(含 v2 SSH 文案):当前部署最终形态;revert 时锚回 updates 键。
const ZH_FULL = '"settings.cat.updates":"更新",' + ZH_SSH + ZH_APP + ZH_AXEL + ZH_CLASH;
const EN_FULL = '"settings.cat.updates":"Updates",' + EN_SSH + EN_APP + EN_AXEL + EN_CLASH;
const ZH_PARTIAL = '"settings.cat.updates":"更新",' + ZH_SSH + ZH_APP;
const EN_PARTIAL = '"settings.cat.updates":"Updates",' + EN_SSH + EN_APP;
// v1 全块/局部块(旧 SSH 文案),重跑时把 v1 部署态 revert 回 updates 键。
const ZH_FULL_OLD = '"settings.cat.updates":"更新",' + ZH_SSH_OLD + ZH_APP + ZH_AXEL + ZH_CLASH;
const EN_FULL_OLD = '"settings.cat.updates":"Updates",' + EN_SSH_OLD + EN_APP + EN_AXEL + EN_CLASH;
const ZH_PARTIAL_OLD = '"settings.cat.updates":"更新",' + ZH_SSH_OLD + ZH_APP;
const EN_PARTIAL_OLD = '"settings.cat.updates":"Updates",' + EN_SSH_OLD + EN_APP;


// ---- #3 appmonitor 应用列表(apps 态)----
// tab4/5 应用列表:原生应用保留全部 native:/appimage:/custom:/demo:(含系统内置 Firefox,
// 系统工具由后端 native-apps.js 的 SYSTEM_APP_RE 过滤掉);init 不再回退选第一个 native;
// 无已保存选择时自动打开应用菜单;菜单加 WEBAPPS 管理入口(manageWebapps 弹窗删自定义
// webapp);设置分区加"管理 Webapps"按钮(接线已并入 SSH_WIRE_NEW)。
const AM_FILTER_OLD = 'const e=await window.appmonitorApi.nativeList();(e&&e.apps||[]).forEach(e=>this.apps.push(Object.assign({},e,{kind:"native"})))';
const AM_FILTER_NEW = 'const e=await window.appmonitorApi.nativeList();(e&&e.apps||[]).forEach(e=>("appimage:"===String(e.id).slice(0,9)||"custom:"===String(e.id).slice(0,7)||"demo:"===String(e.id).slice(0,5)||"native:"===String(e.id).slice(0,7))&&this.apps.push(Object.assign({},e,{kind:"native"})))';
const AM_SEL_OLD = 'const t=e&&this.apps.find(t=>t.name===e)||this.apps.find(e=>"native"===e.kind)||this.apps[0];this.labelEl&&!t&&';
const AM_SEL_NEW = 'const t=e&&this.apps.find(t=>t.name===e);this.labelEl&&!t&&';
const AM_INITTAIL_OLD = 'this._statusTimer||(this._statusTimer=setInterval(()=>this._fetchStatus(),3e3)),this._renderMenu()}';
const AM_INITTAIL_NEW = 'this._statusTimer||(this._statusTimer=setInterval(()=>this._fetchStatus(),3e3)),this._renderMenu(),t||setTimeout(()=>this.openAppList(),500)}';
const AM_ADDR_OLD = 'this.menu.appendChild(e),this.apps.forEach(';
const AM_ADDR_NEW = 'this.menu.appendChild(e),this._appendWaEntry(),this.apps.forEach(';
const AM_LBL_OLD = 'this.runningApps=i,this.runningStates=s,o&&this.menu&&"none"!==this.menu.style.display&&(this._sortApps(),this._renderMenu(),this.menuFocusIdx>=0&&this._focusMenu(this.menuFocusIdx))';
const AM_LBL_NEW = 'this.runningApps=i,this.runningStates=s,(()=>{try{const _rn=this.selected&&this.runningApps.has(this.selected.id)?this.selected.name:"",_first=[...this.runningApps].map(_id=>{const _a=this.apps.find(_x=>_x.id===_id);return _a?_a.name:null}).filter(Boolean)[0]||"";this.labelEl&&(this.labelEl.textContent=window.cover&&window.cover.isActive()?window.cover.fakeMonitorLabel(this.monitorId):_rn||_first||("a"===this.monitorId?"MONITOR A":"MONITOR B"))}catch(e){}})(),o&&this.menu&&"none"!==this.menu.style.display&&(this._sortApps(),this._renderMenu(),this.menuFocusIdx>=0&&this._focusMenu(this.menuFocusIdx))';
const AM_METHODS_OLD = '}}module.exports={AppMonitorPanel};';
const AM_METHODS_NEW = `}openAppList(){if(!this.menu)return;this._positionMenuDefault(),this.menu.style.display="block",this.menu.focus(),this._focusMenu(0)}_positionMenuDefault(){const e=this.container&&this.container.getBoundingClientRect?this.container.getBoundingClientRect():null;this.menu.style.left=Math.max(4,(e?e.left:40)+16)+"px",this.menu.style.top=Math.max(4,(e?e.top:40)+12)+"px"}manageWebapps(){this.refresh();const that=this,rows=(window.webapps&&window.webapps._customList&&window.webapps._customList()||[]).map(e=>'<div class="appmonitor_wa_row"><span class="appmonitor_wa_name">'+e.name+'</span><span class="appmonitor_wa_url">'+e.url+'</span><button type="button" class="appmonitor_wa_del">'+window.t("appmonitor.webapps.delete")+'</button></div>').join(""),id=new Modal({type:"custom",title:window.t("appmonitor.webapps.manage"),html:'<div class="appmonitor_wa_list">'+(rows||'<div class="appmonitor_wa_empty">'+window.t("appmonitor.webapps.empty")+"</div>")+"</div>",buttons:[{label:window.t("appmonitor.webapps.title"),action:"window.appmonitorWaModal&&window.appmonitorWaModal.close()"}]});that._waModalId=id,window.appmonitorWaModal=window.modals[id],setTimeout(()=>{document.querySelectorAll(".appmonitor_wa_del").forEach(t=>{t.onclick=()=>{const u=t.parentElement&&t.parentElement.querySelector(".appmonitor_wa_url");if(!u)return;window.webapps&&window.webapps.removeCustom(u.textContent),window.modals&&window.modals[that._waModalId]&&window.modals[that._waModalId].close(),that._notify(window.t("appmonitor.webapps.removed")),that.refresh()}})},50)}_appendWaEntry(){const e=document.createElement("div");e.className="webapp_menu_opt appmonitor_opt appmonitor_menu_wa",e.textContent=window.t("appmonitor.webapps.manage"),e.onclick=e=>{e.stopPropagation(),this.manageWebapps()},this.menu.appendChild(e)}}module.exports={AppMonitorPanel};`;
const AM_ROW_OLD = '"settings.appMonitor.appImageDirs.help"),o("settings.cat.download"),';
const AM_ROW_NEW = '"settings.appMonitor.appImageDirs.help"),n("appmonitor.webapps.manage",`<button type="button" id="settingsAppMonitorManageWebapps" class="settings_net_btn">${t("appmonitor.webapps.manage")}</button>`,"appmonitor.webapps.manage.help"),o("settings.cat.download"),';
// 旧版注入的样式块(27fix/28fix/当前均已注入此版),用于重跑时 revert 回滚。
const AM_CSS_OLD = `
.appmonitor_menu{position:fixed;z-index:9000;min-width:240px;max-width:60vw;max-height:70vh;overflow-y:auto;background:rgba(10,14,16,.96);border:1px solid rgba(var(--color_r),var(--color_g),var(--color_b),.45);border-radius:6px;padding:6px 0;box-shadow:0 6px 24px rgba(0,0,0,.5);font-family:var(--font_main);font-size:1.1vh;color:rgb(var(--color_r),var(--color_g),var(--color_b))}
.appmonitor_menu .appmonitor_opt{display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;white-space:nowrap}
.appmonitor_menu .appmonitor_opt:hover,.appmonitor_menu .appmonitor_opt.active{background:rgba(var(--color_r),var(--color_g),var(--color_b),.12)}
.appmonitor_menu .appmonitor_menu_add{font-weight:600}
.appmonitor_menu .appmonitor_menu_wa{border-top:1px solid rgba(var(--color_r),var(--color_g),var(--color_b),.2);margin-top:4px;padding-top:8px}
.appmonitor_dot_slot{width:10px;height:10px;flex:0 0 10px;display:flex;align-items:center;justify-content:center}
.appmonitor_dot{width:8px;height:8px;border-radius:50%;background:rgb(var(--color_r),var(--color_g),var(--color_b))}
.appmonitor_dot_running{background:#2ecc71;box-shadow:0 0 6px rgba(46,204,113,.7)}
.appmonitor_dot_starting{background:#f39c12}
.appmonitor_dot_exited{background:#e74c3c}
.appmonitor_icon_slot{width:22px;height:22px;flex:0 0 22px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.appmonitor_icon_slot img{width:100%;height:100%;object-fit:contain}
.appmonitor_icon_ph{width:18px;height:18px}
.appmonitor_name{overflow:hidden;text-overflow:ellipsis;max-width:280px}
.webapp_menu_del{background:transparent;border:none;color:inherit;cursor:pointer;font-size:1.3vh;opacity:.7;margin-left:auto;padding:2px 6px}
.webapp_menu_del:hover{opacity:1}
.appmonitor_wa_list{max-height:55vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
.appmonitor_wa_row{display:flex;align-items:center;gap:10px;border:1px solid rgba(var(--color_r),var(--color_g),var(--color_b),.25);border-radius:4px;padding:8px 12px}
.appmonitor_wa_name{font-weight:600}
.appmonitor_wa_url{opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw;font-family:var(--font_mono)}
.appmonitor_wa_del{background:rgba(231,76,60,.18);color:#e74c3c;border:1px solid rgba(231,76,60,.5);border-radius:4px;padding:4px 12px;cursor:pointer;font-family:var(--font_main);font-size:1.05vh}
.appmonitor_wa_del:hover{background:rgba(231,76,60,.3)}
.appmonitor_wa_empty{opacity:.6;padding:12px;text-align:center}
`;
// 当前注入的样式块 = 旧版块 + 消除菜单焦点环(browser 默认 focus outline)。
// 菜单 div 带 tabindex=-1 且打开时 focus(),会画出黄/青色焦点环,点一下(失焦/关菜单)就消失。
const AM_CSS = AM_CSS_OLD + '\n.appmonitor_menu:focus{outline:none}\n.appmonitor_menu :focus{outline:none}';

// ---- #10 CLI 会话面板(cliApps):tab4/5 默认禁用虚拟显示器,改为命令行 app 会话 ----
const CLI_SETTINGS_OLD = 'o("settings.section.appMonitor"),n("settings.appMonitor.enabled",`<select id="settingsEditor-appMonitor-enabled">\\n                <option>${!1!==(window.settings.appMonitor||{}).enabled}</option>\\n                <option>${!1===(window.settings.appMonitor||{}).enabled}</option>\\n            </select>`,"settings.appMonitor.enabled.help"),n("settings.appMonitor.mock",`<select id="settingsEditor-appMonitor-mock">\\n                <option value="auto" ${null==(window.settings.appMonitor||{}).mock?"selected":""}>${t("settings.appMonitor.mock.auto")}</option>\\n                <option value="true" ${!0===(window.settings.appMonitor||{}).mock?"selected":""}>${t("settings.appMonitor.mock.mock")}</option>\\n                <option value="false" ${!1===(window.settings.appMonitor||{}).mock?"selected":""}>${t("settings.appMonitor.mock.real")}</option>\\n            </select>`,"settings.appMonitor.mock.help"),n("settings.appMonitor.appImageDirs",`<input type="text" id="settingsEditor-appMonitor-appImageDirs" value="${(window.settings.appMonitor||{}).appImageDirs||""}">`,"settings.appMonitor.appImageDirs.help"),n("appmonitor.webapps.manage",`<button type="button" id="settingsAppMonitorManageWebapps" class="settings_net_btn">${t("appmonitor.webapps.manage")}</button>`,"appmonitor.webapps.manage.help")';
const CLI_FS3_OLD = '<button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorA.fullscreenButton()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h22L1 23z"/></svg></button>';
const CLI_FS4_OLD = '<button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorB.fullscreenButton()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h22L1 23z"/></svg></button>';
const CLI_SAVE_OLD = 'n.appMonitor={enabled:"true"===document.getElementById("settingsEditor-appMonitor-enabled").value,mock:"auto"===document.getElementById("settingsEditor-appMonitor-mock").value?null:"true"===document.getElementById("settingsEditor-appMonitor-mock").value,appImageDirs:document.getElementById("settingsEditor-appMonitor-appImageDirs").value}';
const CLI_PANEL_OLD = 'window.appmonitorA=new AppMonitorPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new AppMonitorPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"})';
const CLI_PANEL_CLASS = `window.cliApps = [ { id: "claude", name: "Claude", cmd: ["claude"], icon: "ai" }, { id: "browsh", name: "browsh", cmd: ["browsh", "--startup-url", "https://lite.duckduckgo.com/lite"], icon: "browser" }, { id: "aerc", name: "aerc", cmd: ["aerc"], icon: "mail" }, { id: "htop", name: "htop", cmd: ["htop"], icon: "monitor" }, { id: "btop", name: "BTOP", cmd: ["btop"], icon: "monitor" } ]; try { const _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); if (Array.isArray(_u)) _u.forEach(_a => { if (_a && _a.cmd && _a.cmd[0] && !window.cliApps.some(_x => _x.id === _a.id)) window.cliApps.push({ id: _a.id, name: _a.name || _a.cmd[0], cmd: _a.cmd }); }); } catch (_) {} const _cliIcons={ai:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',browser:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',monitor:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',mail:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',terminal:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'}; (function(){try{var _s=document.createElement("style");_s.id="edex_cli_css";_s.textContent=".cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}";document.head.appendChild(_s)}catch(_){}})(); class CliPanel { constructor(o) { this.container = document.getElementById(o.parentId); this.monitorId = o.monitorId; this.labelEl = document.getElementById(o.labelId); this.selected = null; this.sessions = {}; this._spawning = false; this.menuFocusIdx = -1; this.menu = document.createElement("div"); this.menu.className = "webapp_menu appmonitor_menu"; this.menu.id = "appmonitor_menu_" + this.monitorId; this.menu.style.display = "none"; this.menu.setAttribute("tabindex", "-1"); document.body.appendChild(this.menu); const _t = this; document.addEventListener("click", e => { if (!_t.menu || _t.menu.style.display === "none") return; const _i = e.target && e.target.closest && (e.target.closest("#appmonitor_menu_" + _t.monitorId) || e.target.closest(".webapp_chevron")); if (!_i) _t.closeMenu(); }); this.menu.addEventListener("keydown", e => { const _o = _t.menu.querySelectorAll(".appmonitor_opt"); if (!_o.length) return; e.stopPropagation(); if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx + 1); } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx - 1); } else if (e.key === "Enter") { e.preventDefault(); const _x = _o[_t.menuFocusIdx]; if (_x) _x.click(); } else if (e.key === "Escape") { e.preventDefault(); _t.closeMenu(); } }); if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; } focus() { if (this.selected && this.sessions[this.selected.id]) { const _s = this.sessions[this.selected.id]; Object.keys(this.sessions).forEach(_k => { const _e = this.sessions[_k].el; if (_e) _e.classList.toggle("active", _k === this.selected.id); }); if (_s.term && _s.term.term && _s.term.term.focus) _s.term.term.focus(); } } activate() { this.focus(); } toggleMenu(ev) { if (ev) ev.stopPropagation(); if (!this.menu) return; if (this.menu.style.display === "none") { if (ev && ev.currentTarget) { const _r = ev.currentTarget.getBoundingClientRect(); this.menu.style.left = Math.max(4, _r.left - 20) + "px"; this.menu.style.top = (_r.bottom + 6) + "px"; } this.menu.style.display = "block"; this.menu.focus(); this._renderMenu(); this._focusMenu(0); } else this.closeMenu(); } closeMenu() { if (this.menu) this.menu.style.display = "none"; this.menuFocusIdx = -1; } _focusMenu(i) { const _o = this.menu.querySelectorAll(".appmonitor_opt"); if (!_o.length) return; this.menuFocusIdx = Math.max(0, Math.min(i, _o.length - 1)); _o.forEach((x, j) => { x.classList.toggle("active", j === this.menuFocusIdx); if (j === this.menuFocusIdx) x.scrollIntoView({ block: "nearest" }); }); } _renderMenu() { if (!this.menu) return; this.menu.innerHTML = ""; const _add = document.createElement("div"); _add.className = "webapp_menu_opt appmonitor_opt appmonitor_menu_add"; _add.textContent = "+ ADD APP"; _add.onclick = e => { e.stopPropagation(); this._addApp(); }; this.menu.appendChild(_add); window.cliApps.forEach(_a => { const _opt = document.createElement("div"); const _run = this.sessions[_a.id]; _opt.className = "webapp_menu_opt appmonitor_opt" + (this.selected && this.selected.id === _a.id ? " active" : ""); const _dot = document.createElement("span"); _dot.className = "appmonitor_dot_slot"; if (_run && (_run.starting || _run.term)) { const _d = document.createElement("span"); _d.className = "appmonitor_dot appmonitor_dot_" + (_run.starting ? "starting" : "running"); _dot.appendChild(_d); } _opt.appendChild(_dot); const _ic = document.createElement("span"); _ic.className = "appmonitor_icon_slot"; _ic.innerHTML = _cliIcons[_a.icon] || _cliIcons.terminal; _opt.appendChild(_ic); const _nm = document.createElement("span"); _nm.className = "appmonitor_name"; _nm.textContent = _a.name; _opt.appendChild(_nm); if (_run && _run.term) { const _cl = document.createElement("button"); _cl.className = "webapp_menu_del"; _cl.textContent = "×"; _cl.title = "关闭会话"; _cl.onclick = e => { e.stopPropagation(); this._closeSession(_a.id); }; _opt.appendChild(_cl); } _opt.onclick = e => { e.stopPropagation(); this.select(_a); this.closeMenu(); }; this.menu.appendChild(_opt); }); if (!window.cliApps.length) { const _em = document.createElement("div"); _em.className = "webapp_menu_opt"; _em.textContent = "No apps"; this.menu.appendChild(_em); } } select(_a) { if (!_a) return; this.selected = _a; if (this.labelEl) this.labelEl.textContent = _a.name; this._renderMenu(); if (this.sessions[_a.id]) { this.focus(); return; } if (this._spawning) return; this._startSession(_a); } _startSession(_a) { const _t = this, _sid = _a.id + "_" + Math.floor(1e6 * Math.random()); const _s = { id: _a.id, sid: _sid, starting: true, term: null, el: null }; this.sessions[_a.id] = _s; this._spawning = true; const _box = this.container; if (!_box) return this._abortSpawn(_a); const _el = document.createElement("div"); _el.className = "cli_session"; _el.id = _sid; _box.appendChild(_el); _s.el = _el; _el.classList.add("active"); Object.keys(this.sessions).forEach(_k => { if (_k !== _a.id && this.sessions[_k].el) this.sessions[_k].el.classList.remove("active"); }); ipc.send("ttyspawn", { cli: _a.cmd }); ipc.once("ttyspawn-reply", (e, r) => { this._spawning = false; if (String(r).startsWith("ERROR")) { _s.starting = false; if (_el.parentNode) _el.parentNode.removeChild(_el); delete _t.sessions[_a.id]; _t._renderMenu(); return; } const _port = Number(String(r).substr(9)); let _term = null; try { _term = new Terminal({ role: "client", parentId: _sid, port: _port }); } catch (_e) { _s.starting = false; _t._renderMenu(); return; } _term.onclose = () => { try { if (_term.term && _term.term.dispose) _term.term.dispose(); } catch (_e) {} if (_el.parentNode) _el.parentNode.removeChild(_el); delete _t.sessions[_a.id]; if (_t.selected && _t.selected.id === _a.id && _t.labelEl) _t.labelEl.textContent = "a" === _t.monitorId ? "MONITOR A" : "MONITOR B"; _t._renderMenu(); }; _s.starting = false; _s.term = _term; _t._renderMenu(); }); } _abortSpawn(_a) { this._spawning = false; if (this.sessions[_a.id]) delete this.sessions[_a.id]; if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; this._renderMenu(); } _closeSession(_id) { const _s = this.sessions[_id]; if (!_s) return; if (_s.term) { try { if (_s.term.onclose) _s.term.onclose = null; if (_s.term.term && _s.term.term.dispose) _s.term.term.dispose(); } catch (_e) {} } if (_s.el && _s.el.parentNode) _s.el.parentNode.removeChild(_s.el); delete this.sessions[_id]; if (this.selected && this.selected.id === _id && this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; this._renderMenu(); } _addApp() { this.closeMenu(); try { if (window.cliAddModal && window.cliAddModal.close) window.cliAddModal.close(); } catch (_e) {} const _pn = "a" === this.monitorId ? "A" : "B"; window.cliAddModal = new Modal({ type: "custom", title: "ADD APP", html: '<div class="appmonitor_add"><label>启动命令</label><input type="text" id="cli_add_cmd" placeholder="如 btop 或 ncmpcpp" style="width:100%"></div>', buttons: [{ label: "Add", action: "window.cliAddModal&&window.cliAddModal.close();window.appmonitor" + _pn + ".submitCliAdd()" }] }); } submitCliAdd() { const _in = document.getElementById("cli_add_cmd"); if (!_in || !_in.value || !_in.value.trim()) { this._notify("请输入启动命令"); return; } const _c = _in.value.trim().split(/\\s+/), _id = "cli_" + _c[0].replace(/[^a-zA-Z0-9_-]/g, ""); let _u = []; try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (_e) {} if (!Array.isArray(_u)) _u = []; if (!_u.some(_x => _x.id === _id)) { _u.push({ id: _id, name: _c[0], cmd: _c }); try { localStorage.setItem("edex_cli_apps", JSON.stringify(_u)); } catch (_e) {} window.cliApps.push({ id: _id, name: _c[0], cmd: _c }); } this._notify("已添加 " + _c[0]); this._renderMenu(); } _notify(m) { let _t = document.getElementById("edex_toast"); if (!_t) { _t = document.createElement("div"); _t.id = "edex_toast"; _t.className = "browser_toast"; document.body.appendChild(_t); } _t.textContent = m; _t.classList.add("show"); clearTimeout(this._notifyTimer); this._notifyTimer = setTimeout(() => _t.classList.remove("show"), 2200); } fullscreenButton() {} toggleDevTools() {} }`;
// #29 桥接锚点:27fix(d219f4e)部署版注入的 CLI 面板类体(claude/w3m/htop,无图标)。
// 仅 revert 阶段用——把旧部署版先转回当前类体再走 revert→apply;对 pristine/current 是 no-op。
const CLI_PANEL_CLASS_27 = `window.cliApps = [ { id: "claude", name: "Claude", cmd: ["claude"] }, { id: "w3m", name: "Browser", cmd: ["w3m", "https://lite.duckduckgo.com/lite"] }, { id: "htop", name: "htop", cmd: ["htop"] } ]; try { const _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); if (Array.isArray(_u)) _u.forEach(_a => { if (_a && _a.cmd && _a.cmd[0] && !window.cliApps.some(_x => _x.id === _a.id)) window.cliApps.push({ id: _a.id, name: _a.name || _a.cmd[0], cmd: _a.cmd }); }); } catch (_) {} (function(){try{var _s=document.createElement("style");_s.id="edex_cli_css";_s.textContent=".cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}";document.head.appendChild(_s)}catch(_){}})(); class CliPanel { constructor(o) { this.container = document.getElementById(o.parentId); this.monitorId = o.monitorId; this.labelEl = document.getElementById(o.labelId); this.selected = null; this.sessions = {}; this._spawning = false; this.menuFocusIdx = -1; this.menu = document.createElement("div"); this.menu.className = "webapp_menu appmonitor_menu"; this.menu.id = "appmonitor_menu_" + this.monitorId; this.menu.style.display = "none"; this.menu.setAttribute("tabindex", "-1"); document.body.appendChild(this.menu); const _t = this; document.addEventListener("click", e => { if (!_t.menu || _t.menu.style.display === "none") return; const _i = e.target && e.target.closest && (e.target.closest("#appmonitor_menu_" + _t.monitorId) || e.target.closest(".webapp_chevron")); if (!_i) _t.closeMenu(); }); this.menu.addEventListener("keydown", e => { const _o = _t.menu.querySelectorAll(".appmonitor_opt"); if (!_o.length) return; e.stopPropagation(); if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx + 1); } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx - 1); } else if (e.key === "Enter") { e.preventDefault(); const _x = _o[_t.menuFocusIdx]; if (_x) _x.click(); } else if (e.key === "Escape") { e.preventDefault(); _t.closeMenu(); } }); if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; } focus() { if (this.selected && this.sessions[this.selected.id]) { const _s = this.sessions[this.selected.id]; Object.keys(this.sessions).forEach(_k => { const _e = this.sessions[_k].el; if (_e) _e.classList.toggle("active", _k === this.selected.id); }); if (_s.term && _s.term.term && _s.term.term.focus) _s.term.term.focus(); } } activate() { this.focus(); } toggleMenu(ev) { if (ev) ev.stopPropagation(); if (!this.menu) return; if (this.menu.style.display === "none") { if (ev && ev.currentTarget) { const _r = ev.currentTarget.getBoundingClientRect(); this.menu.style.left = Math.max(4, _r.left - 20) + "px"; this.menu.style.top = (_r.bottom + 6) + "px"; } this.menu.style.display = "block"; this.menu.focus(); this._renderMenu(); this._focusMenu(0); } else this.closeMenu(); } closeMenu() { if (this.menu) this.menu.style.display = "none"; this.menuFocusIdx = -1; } _focusMenu(i) { const _o = this.menu.querySelectorAll(".appmonitor_opt"); if (!_o.length) return; this.menuFocusIdx = Math.max(0, Math.min(i, _o.length - 1)); _o.forEach((x, j) => { x.classList.toggle("active", j === this.menuFocusIdx); if (j === this.menuFocusIdx) x.scrollIntoView({ block: "nearest" }); }); } _renderMenu() { if (!this.menu) return; this.menu.innerHTML = ""; const _add = document.createElement("div"); _add.className = "webapp_menu_opt appmonitor_opt appmonitor_menu_add"; _add.textContent = "+ ADD APP (命令行)"; _add.onclick = e => { e.stopPropagation(); this._addApp(); }; this.menu.appendChild(_add); window.cliApps.forEach(_a => { const _opt = document.createElement("div"); const _run = this.sessions[_a.id]; _opt.className = "webapp_menu_opt appmonitor_opt" + (this.selected && this.selected.id === _a.id ? " active" : ""); const _dot = document.createElement("span"); _dot.className = "appmonitor_dot_slot"; if (_run && (_run.starting || _run.term)) { const _d = document.createElement("span"); _d.className = "appmonitor_dot appmonitor_dot_" + (_run.starting ? "starting" : "running"); _dot.appendChild(_d); } _opt.appendChild(_dot); const _nm = document.createElement("span"); _nm.className = "appmonitor_name"; _nm.textContent = _a.name; _opt.appendChild(_nm); if (_run && _run.term) { const _cl = document.createElement("button"); _cl.className = "webapp_menu_del"; _cl.textContent = "×"; _cl.title = "关闭会话"; _cl.onclick = e => { e.stopPropagation(); this._closeSession(_a.id); }; _opt.appendChild(_cl); } _opt.onclick = e => { e.stopPropagation(); this.select(_a); this.closeMenu(); }; this.menu.appendChild(_opt); }); if (!window.cliApps.length) { const _em = document.createElement("div"); _em.className = "webapp_menu_opt"; _em.textContent = "No apps"; this.menu.appendChild(_em); } } select(_a) { if (!_a) return; this.selected = _a; if (this.labelEl) this.labelEl.textContent = _a.name; this._renderMenu(); if (this.sessions[_a.id]) { this.focus(); return; } if (this._spawning) return; this._startSession(_a); } _startSession(_a) { const _t = this, _sid = _a.id + "_" + Math.floor(1e6 * Math.random()); const _s = { id: _a.id, sid: _sid, starting: true, term: null, el: null }; this.sessions[_a.id] = _s; this._spawning = true; const _box = this.container; if (!_box) return this._abortSpawn(_a); const _el = document.createElement("div"); _el.className = "cli_session"; _el.id = _sid; _box.appendChild(_el); _s.el = _el; _el.classList.add("active"); Object.keys(this.sessions).forEach(_k => { if (_k !== _a.id && this.sessions[_k].el) this.sessions[_k].el.classList.remove("active"); }); ipc.send("ttyspawn", { cli: _a.cmd }); ipc.once("ttyspawn-reply", (e, r) => { this._spawning = false; if (String(r).startsWith("ERROR")) { _s.starting = false; if (_el.parentNode) _el.parentNode.removeChild(_el); delete _t.sessions[_a.id]; _t._renderMenu(); return; } const _port = Number(String(r).substr(9)); let _term = null; try { _term = new Terminal({ role: "client", parentId: _sid, port: _port }); } catch (_e) { _s.starting = false; _t._renderMenu(); return; } _term.onclose = () => { try { if (_term.term && _term.term.dispose) _term.term.dispose(); } catch (_e) {} if (_el.parentNode) _el.parentNode.removeChild(_el); delete _t.sessions[_a.id]; if (_t.selected && _t.selected.id === _a.id && _t.labelEl) _t.labelEl.textContent = "a" === _t.monitorId ? "MONITOR A" : "MONITOR B"; _t._renderMenu(); }; _s.starting = false; _s.term = _term; _t._renderMenu(); }); } _abortSpawn(_a) { this._spawning = false; if (this.sessions[_a.id]) delete this.sessions[_a.id]; if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; this._renderMenu(); } _closeSession(_id) { const _s = this.sessions[_id]; if (!_s) return; if (_s.term) { try { if (_s.term.onclose) _s.term.onclose = null; if (_s.term.term && _s.term.term.dispose) _s.term.term.dispose(); } catch (_e) {} } if (_s.el && _s.el.parentNode) _s.el.parentNode.removeChild(_s.el); delete this.sessions[_id]; if (this.selected && this.selected.id === _id && this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; this._renderMenu(); } _addApp() { this.closeMenu(); try { if (window.cliAddModal && window.cliAddModal.close) window.cliAddModal.close(); } catch (_e) {} const _pn = "a" === this.monitorId ? "A" : "B"; window.cliAddModal = new Modal({ type: "custom", title: "ADD APP — 命令行", html: '<div class="appmonitor_add"><label>启动命令</label><input type="text" id="cli_add_cmd" placeholder="如 btop 或 ncmpcpp" style="width:100%"></div>', buttons: [{ label: "Add", action: "window.cliAddModal&&window.cliAddModal.close();window.appmonitor" + _pn + ".submitCliAdd()" }] }); } submitCliAdd() { const _in = document.getElementById("cli_add_cmd"); if (!_in || !_in.value || !_in.value.trim()) { this._notify("请输入启动命令"); return; } const _c = _in.value.trim().split(/\\s+/), _id = "cli_" + _c[0].replace(/[^a-zA-Z0-9_-]/g, ""); let _u = []; try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (_e) {} if (!Array.isArray(_u)) _u = []; if (!_u.some(_x => _x.id === _id)) { _u.push({ id: _id, name: _c[0], cmd: _c }); try { localStorage.setItem("edex_cli_apps", JSON.stringify(_u)); } catch (_e) {} window.cliApps.push({ id: _id, name: _c[0], cmd: _c }); } this._notify("已添加 " + _c[0]); this._renderMenu(); } _notify(m) { let _t = document.getElementById("edex_toast"); if (!_t) { _t = document.createElement("div"); _t.id = "edex_toast"; _t.className = "browser_toast"; document.body.appendChild(_t); } _t.textContent = m; _t.classList.add("show"); clearTimeout(this._notifyTimer); this._notifyTimer = setTimeout(() => _t.classList.remove("show"), 2200); } fullscreenButton() {} }`;
// #34:v2 部署态(enabled 三元)先 revert 回 pristine 再 apply,防重跑 miss。设置区恒删除。
const CLI_SETTINGS_V2_OLD = '((window.settings.appMonitor||{}).enabled===!1?"":[' + CLI_SETTINGS_OLD + '].join(""))' + ',';
// 值 = `(0,"")`(无尾逗号):替换位置是 `...<设置块>,o("settings.cat.download")...` 逗号表达式链,
// 块本身无尾逗号、上下文有。带尾逗号会产出 `(0,""),,o(` 双逗号 → SyntaxError。`(0,"")` 全文件唯一。
const CLI_SETTINGS_NEW = '(0,"")';
// #34:tab3/tab4 全屏三角按钮恒删除(全屏改由文件浏览器 APPS 负责)。
const CLI_FS3_V2_OLD = '${(window.settings.appMonitor||{}).enabled===false?"":' + "'" + '<button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorA.fullscreenButton()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h22L1 23z"/></svg></button>' + "'" + '}';
const CLI_FS3_NEW = '${!1?"":""}';
const CLI_FS4_V2_OLD = '${(window.settings.appMonitor||{}).enabled===false?"":' + "'" + '<button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorB.fullscreenButton()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h22L1 23z"/></svg></button>' + "'" + '}';
const CLI_FS4_NEW = '${""}';
const CLI_SAVE_NEW = 'n.appMonitor=document.getElementById("settingsEditor-appMonitor-enabled")?{enabled:"true"===document.getElementById("settingsEditor-appMonitor-enabled").value,mock:"auto"===document.getElementById("settingsEditor-appMonitor-mock").value?null:"true"===document.getElementById("settingsEditor-appMonitor-mock").value,appImageDirs:document.getElementById("settingsEditor-appMonitor-appImageDirs").value}:(window.settings.appMonitor||{enabled:!1})';
// ---- #34 文件浏览器 APPS 按钮 + GUI 应用全屏启动方法 ----
// 文件浏览器(CD 按钮旁)加 APPS 按钮:列出 appmonitor 后端扫到的 native GUI 应用,
// 点一个 → 在真实显示器 :0 全屏启动(复用 backend.fullscreen,含退出浮钮/Ctrl+Shift+Q)。
// FS_APPS_METHODS 是 terser 压缩产物(/tmp/fs-apps-methods.min.js),无反引号/无 ${},
// 可安全作 backtick 常量;尾部 `;` 已去掉,注入后以 `,` 续入构造体的逗号赋值链。
const FS_CD_BTN_OLD = '<button id="fs_cd_btn" title="cd to current directory in the current terminal" onclick="window.fsDisp.cdToTerminal()">CD</button>';
const FS_APPS_BTN = '<button id="fs_app_btn" title="Launch a GUI app fullscreen on the real display" onclick="window.fsDisp.showAppsLauncher()">APPS</button>';
const FS_CDT_JOIN = 'this.selected=[],this.clipboard=null';
const FS_APPS_METHODS = `this.showAppsLauncher=async()=>{let apps=[];try{const r=await window.appmonitorApi.nativeList();r&&Array.isArray(r.apps)&&(apps=r.apps)}catch(e){}if(!apps.length)return void new Modal({type:"info",title:"GUI Apps",message:"No GUI apps found — is the app backend running?"});window._pendingFsApps=apps;const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),rows=apps.map((a,i)=>'<div class="fs_app_row" data-i="'+i+'" onclick="window.fsDisp.launchFsApp('+i+')">'+esc(a.name||"?")+"</div>").join(""),modalId=new Modal({type:"custom",title:"GUI Apps",html:'<div class="fs_apps_list" id="fs_apps_list">'+rows+'<div class="fs_app_row fs_app_add" onclick="window.fsDisp.addFsApp()">+ ADD APP</div></div>',buttons:[],closeLabel:"Close"}),el=document.getElementById("modal_"+modalId);if(el){el.setAttribute("tabindex","-1");const focus=i=>{const r=el.querySelectorAll(".fs_app_row");return r.length?(i=Math.max(0,Math.min(i,r.length-1)),r.forEach((x,j)=>x.classList.toggle("active",j===i)),r[i]&&r[i].scrollIntoView({block:"nearest"}),i):i};let idx=0;focus(0),el.addEventListener("keydown",e=>{if("ArrowDown"===e.key||"ArrowRight"===e.key)e.preventDefault(),idx=focus(idx+1);else if("ArrowUp"===e.key||"ArrowLeft"===e.key)e.preventDefault(),idx=focus(idx-1);else if("Enter"===e.key){e.preventDefault();const r=void 0,x=el.querySelectorAll(".fs_app_row")[idx];x&&x.click()}else if("Escape"===e.key){e.preventDefault();const m=window.modals[modalId];m&&m.close()}})}},this.launchFsApp=async i=>{const apps=void 0,a=(window._pendingFsApps||[])[i],closeTop=()=>{const m=window.modals&&Object.keys(window.modals);m&&m.length&&window.modals[m.pop()].close()};if(!a)return void closeTop();let err=null;try{const r=await window.appmonitorApi.fullscreen("a",a.id);r&&!r.ok&&(err=String(r.error||"unknown error"))}catch(e){err=String(e&&e.message||e)}closeTop(),err&&new Modal({type:"info",title:"Could not launch fullscreen",message:err})},this.addFsApp=()=>{const closeTop=void 0;(()=>{const m=window.modals&&Object.keys(window.modals);m&&m.length&&window.modals[m.pop()].close()})(),new Modal({type:"custom",title:"ADD GUI APP",html:'<div class="appmonitor_add"><label>Name</label><input type="text" id="fs_add_name" placeholder="Firefox" style="width:100%"><label>Command / Path / AppImage</label><input type="text" id="fs_add_value" placeholder="/path/to/App.AppImage or firefox" style="width:100%"></div>',buttons:[{label:"Add",action:"window.fsDisp.submitFsAdd()"}]})},this.submitFsAdd=async()=>{const name=document.getElementById("fs_add_name"),value=document.getElementById("fs_add_value"),closeTop=()=>{const m=window.modals&&Object.keys(window.modals);m&&m.length&&window.modals[m.pop()].close()};if(!(name&&value&&name.value.trim()&&value.value.trim()))return;let err=null;try{const r=await window.appmonitorApi.addNative({name:name.value.trim(),value:value.value.trim()});r&&!r.ok&&(err=String(r.error||"unknown error"))}catch(e){err=String(e&&e.message||e)}closeTop(),err?new Modal({type:"info",title:"Could not add app",message:err}):this.showAppsLauncher()}`;
const FS_APPS_CSS = 'button#fs_app_btn{position:absolute;right:.5vw;bottom:2.8vh;background:rgba(var(--color_r),var(--color_g),var(--color_b),.12);border:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.45);color:rgb(var(--color_r),var(--color_g),var(--color_b));font-family:var(--font_main_light);font-size:.95vh;letter-spacing:.12vh;padding:.3vh .7vh;cursor:pointer;z-index:3;transition:background .2s}button#fs_app_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}div.fs_apps_list{max-height:40vh;overflow-y:auto;min-width:34vw}div.fs_app_row{padding:1.1vh 1.4vh;margin:.4vh 0;border:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.3);cursor:pointer;font-family:var(--font_main_light);font-size:1.9vh;letter-spacing:.1vh;color:rgb(var(--color_r),var(--color_g),var(--color_b));transition:background .15s}div.fs_app_row.active,div.fs_app_row:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.28)}div.fs_app_row.fs_app_add{opacity:.7;font-size:1.6vh}';

// #34(folder APPS):APPS 按钮改为打开 apps:// 虚拟文件夹(文件浏览器内,不是弹窗)。
// FS_APPS_METHODS_FOLDER 是 terser 压缩产物(/tmp/fs-apps-folder.min.js),无反引号/无 ${},
// 可安全作 backtick 常量;尾部 `;` 已去掉,注入后以 `,` 续入构造体的逗号赋值链。
// FS_APPS_BTN_NEW / FS_APPS_CSS_NEW 是文件夹版按钮与样式(替换旧 modal 版)。
const FS_APPS_BTN_NEW = '<button id="fs_app_btn" title="Browse GUI apps as a folder and launch one fullscreen" onclick="window.fsDisp.showAppsFolder()">APPS</button>';
const FS_APPS_METHODS_FOLDER = `this.edexIcons.app={width:24,height:24,svg:'<path d="M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm10 0h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm10 0h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"/>'},this._appsIdx=0,this._appsReturnTo=this.dirpath||"/",this._appsList=[],this._appsKey=s=>{if("apps://"===this.dirpath&&this._fsHovered){const t=this.filesContainer.querySelectorAll(".fs_disp_fs-app");if(t.length)if("ArrowDown"===s.key||"ArrowRight"===s.key)s.preventDefault(),s.stopPropagation(),this._appsFocus(this._appsIdx+1);else if("ArrowUp"===s.key||"ArrowLeft"===s.key)s.preventDefault(),s.stopPropagation(),this._appsFocus(this._appsIdx-1);else if("Enter"===s.key){s.preventDefault(),s.stopPropagation();const i=t[this._appsIdx];i&&i.click()}else"Escape"===s.key&&(s.preventDefault(),s.stopPropagation(),this.readFS(this._appsReturnTo))}},document.addEventListener("keydown",this._appsKey,!0),this._appsFocus=s=>{const t=this.filesContainer.querySelectorAll(".fs_disp_fs-app");if(t.length){s=Math.max(0,Math.min(s,t.length-1)),this._appsIdx=s,t.forEach((t,i)=>t.classList.toggle("active",i===s));const i=t[s];i&&i.scrollIntoView({block:"nearest"})}},this.showAppsFolder=async()=>{const s=this.dirpath;s&&"apps://"!==s&&(this._appsReturnTo=s),this.dirpath="apps://",this._reading=!1;let t=[];try{const s=await window.appmonitorApi.nativeList();s&&Array.isArray(s.apps)&&(t=s.apps)}catch(s){}this._appsList=t,this._renderAppsView()},this._renderAppsView=()=>{const s=document.getElementById("fs_disp_title_dir");s&&(s.innerText="APPS"),this.filesContainer.setAttribute("class","");const t=this.icons.up,i=this.edexIcons.app;let e='<div class="fs_disp_up" onclick="window.fsDisp.readFS(window.fsDisp._appsReturnTo)"><svg viewBox="0 0 '+t.width+" "+t.height+'" fill="'+this.iconcolor+'">'+t.svg+"</svg><h3>..</h3><h4>up</h4><h4>--</h4><h4>--</h4></div>";const a=this._appsList||[];a.length||(e+='<p class="fs_trash_none" style="grid-column:1/-1">No GUI apps found</p>'),a.forEach((s,t)=>{var a;e+='<div class="fs_disp_fs-app" data-i="'+t+'" onclick="window.fsDisp.launchFsApp('+t+')"><svg viewBox="0 0 '+i.width+" "+i.height+'" fill="'+this.iconcolor+'">'+i.svg+"</svg><h3>"+(a=s.name||"?",String(null==a?"":a).replace(/</g,"&lt;")+"</h3><h4>app</h4><h4>--</h4><h4>--</h4></div>")}),e+='<div class="fs_disp_fs-app fs_app_add" onclick="window.fsDisp.addFsApp()"><svg viewBox="0 0 '+i.width+" "+i.height+'" fill="'+this.iconcolor+'">'+i.svg+"</svg><h3>+ ADD APP</h3><h4>add a custom launcher</h4><h4>--</h4><h4>--</h4></div>",this.filesContainer.innerHTML=e,this._appsIdx>=(a.length||0)&&(this._appsIdx=0),this._appsFocus(this._appsIdx)},this.launchFsApp=async s=>{const t=(this._appsList||[])[s];if(!t)return;let i=null;try{const s=await window.appmonitorApi.fullscreen("a",t.id);s&&!s.ok&&(i=String(s.error||"unknown error"))}catch(s){i=String(s&&s.message||s)}i&&new Modal({type:"info",title:"Could not launch fullscreen",message:i})},this.addFsApp=()=>new Modal({type:"custom",title:"ADD GUI APP",html:'<div class="appmonitor_add"><label>Name</label><input type="text" id="fs_add_name" placeholder="Firefox" style="width:100%"><label>Command / Path / AppImage</label><input type="text" id="fs_add_value" placeholder="/path/to/App.AppImage or firefox" style="width:100%"></div>',buttons:[{label:"Add",action:"window.fsDisp.submitFsAdd()"}]}),this.submitFsAdd=async()=>{const s=document.getElementById("fs_add_name"),t=document.getElementById("fs_add_value");if(!(s&&t&&s.value.trim()&&t.value.trim()))return;let i=null;try{const e=await window.appmonitorApi.addNative({name:s.value.trim(),value:t.value.trim()});e&&!e.ok&&(i=String(e.error||"unknown error"))}catch(s){i=String(s&&s.message||s)}const e=window.modals&&Object.keys(window.modals);e&&e.length&&window.modals[e.pop()].close(),i?new Modal({type:"info",title:"Could not add app",message:i}):this.showAppsFolder()}`;
const FS_APPS_CSS_NEW = 'button#fs_app_btn{position:absolute;right:.5vw;bottom:2.8vh;background:rgba(var(--color_r),var(--color_g),var(--color_b),.12);border:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.45);color:rgb(var(--color_r),var(--color_g),var(--color_b));font-family:var(--font_main_light);font-size:.95vh;letter-spacing:.12vh;padding:.3vh .7vh;cursor:pointer;z-index:3;transition:background .2s}button#fs_app_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}div.fs_disp_fs-app{cursor:pointer;transition:background .15s}div.fs_disp_fs-app:hover,div.fs_disp_fs-app.active{background:rgba(var(--color_r),var(--color_g),var(--color_b),.28)}div.fs_disp_fs-app.fs_app_add{opacity:.6}div.fs_disp_fs-app.fs_app_add>h3{font-style:italic}';
// #34:v2 部署态(enabled 三元路由)桥接常量;新路由恒 CliPanel(命令行面板)。
// 关键:v2 部署的 CliPanel 类体是"当前类体去掉 toggleDevTools(){}"(toggleDevTools 是本会话
// 新加的,尚未部署),所以 CLI_PANEL_V2_OLD 必须用 v2 类体(CLI_PANEL_CLASS 去 td)+ v2 路由,
// 否则 revert 匹配不上(类体逐字不等)→ 三元路由残留、apply 又会在三元 else 分支里二次注入。
const CLI_PANEL_V2_ROUTE = 'window.appmonitorA=window.appmonitorB=null,((window.settings.appMonitor||{}).enabled===!1?(window.appmonitorA=new CliPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new CliPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"})):(window.appmonitorA=new AppMonitorPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new AppMonitorPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"})))';
const CLI_PANEL_V2_OLD = CLI_PANEL_CLASS.split(' toggleDevTools() {} }').join(' }') + CLI_PANEL_V2_ROUTE;
// #34:27fix 部署态(无图标类体 + 同款三元路由)整块 revert,必须在 CLI_PANEL_CLASS_27 桥接之前,
// 否则类体先被桥接成当前版(toggleDevTools 加入)后,类+路由整块常量匹配不上 → 三元残留。
const CLI_PANEL_27_OLD = CLI_PANEL_CLASS_27 + CLI_PANEL_V2_ROUTE;
const CLI_PANEL_NEW = CLI_PANEL_CLASS + 'window.appmonitorA=window.appmonitorB=null,(window.appmonitorA=new CliPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new CliPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"}))';
// #17 兼容:已部署 AppImage 里仍是旧递归版 focus()(else this.activate() → activate() → focus() 死循环)。
// 直接把它换成修复版片段,保证对"当前已打补丁的 AppImage 重打"时也能生效(否则链首 revert 的
// CLI_PANEL_NEW 因新旧不一致 miss → 旧递归代码残留)。对 pristine orig 是 no-op(片段不存在)。
const CLIRECUR_OLD = 'if (_s.term && _s.term.term && _s.term.term.focus) _s.term.term.focus(); } else this.activate(); } activate() { this.focus(); }';
const CLIRECUR_NEW = 'if (_s.term && _s.term.term && _s.term.term.focus) _s.term.term.focus(); } } activate() { this.focus(); }';
// ---- #10 tab3(index2)改普通命令行 tab(不再是专用 CLAUDE tab)----
const TAB2_SPAWN_OLD = 'const t=2===e;document.getElementById("shell_tab"+e).innerHTML=`<p>${t?"LAUNCHING":"LOADING"}...</p>`,ipc.send("ttyspawn",t?"claude":"term")';
const TAB2_SPAWN_NEW = 'document.getElementById("shell_tab"+e).innerHTML=`<p>LOADING...</p>`,ipc.send("ttyspawn","term")';
const TAB2_CLOSE_OLD = 'window.term[e].onclose=t=>{delete window.term[e].onprocesschange;const n=2===e;let o="";if(n)try{const t=window.term[e].term,n=t&&t.buffer&&t.buffer.active,s=n?n.length:0,i=Math.max(0,s-60),r=[];for(let e=i;e<s;e++){const t=n.getLine(e);t&&r.push(t.translateToString(!0))}o=r.join("\\r\\n")}catch(e){try{console.error("claude exit capture failed:",e)}catch(e){}}if(document.getElementById("shell_tab"+e).innerHTML="<p>"+(n?"CLAUDE":"EMPTY")+"</p>",n){const t=document.getElementById("terminal"+e);window.term[e].term.dispose(),delete window.term[e];const n=/api[_ -]?key|authenticat|anthropic|\\b401\\b|\\b403\\b|\\blogin\\b/i.test(o);return t.classList.add("terminal-closed"),void(t.textContent=(o||"(claude exited without output)")+"\\r\\n\\r\\n[ claude process ended ]\\r\\n"+(n?"No API key configured? Open Settings -> Claude and set one,\\r\\nthen click this CLAUDE tab to relaunch.\\r\\n":"Click this CLAUDE tab to relaunch.\\r\\n"))}document.getElementById("terminal"+e).innerHTML="",window.term[e].term.dispose(),delete window.term[e],window.useAppShortcut("PREVIOUS_TAB")}';
const TAB2_CLOSE_NEW = 'window.term[e].onclose=t=>{delete window.term[e].onprocesschange;document.getElementById("shell_tab"+e).innerHTML="<p>EMPTY</p>",document.getElementById("terminal"+e).innerHTML="",window.term[e].term.dispose(),delete window.term[e],window.useAppShortcut("PREVIOUS_TAB")}';
const TAB2_HTML_OLD = '<p>CLAUDE</p>';
const TAB2_HTML_NEW = '<p>TERM</p>';
const TAB2_FB_OLD = '2:"CLAUDE",3:"MONITOR A"';
const TAB2_FB_NEW = '2:"TERM",3:"MONITOR A"';
// ---- #10 _boot.js ttyspawn 支持任意命令 + claude 走目录选择器 + 池扩到 8 ----
const TTYSPAWN_OLD = 'const s="claude"===o&&r;let a=e.shell,l=e.shellArgs||"",c=!0,p=t;s&&(a=process.execPath,l=[path.join(__dirname,"assets","misc","claude-launcher.js")],p=Object.assign({},t,{ELECTRON_RUN_AS_NODE:"1",CLAUDE_BIN:r,START_DIR:tty.tty._cwd||e.cwd}),c=!1);';
const TTYSPAWN_NEW = 'let a=e.shell,l=e.shellArgs||"",c=!0,p=t,s=!1;"object"==typeof o&&null!==o&&Array.isArray(o.cli)?("claude"===o.cli[0]&&r?(s=!0,a=process.execPath,l=[path.join(__dirname,"assets","misc","claude-launcher.js")],p=Object.assign({},t,{ELECTRON_RUN_AS_NODE:"1",CLAUDE_BIN:r,START_DIR:tty.tty._cwd||e.cwd}),c=!1):(s=!0,a=o.cli[0],l=o.cli.slice(1),c=!1,p=Object.assign({},t,{START_DIR:tty.tty._cwd||e.cwd}))):"claude"===o&&r&&(s=!0,a=process.execPath,l=[path.join(__dirname,"assets","misc","claude-launcher.js")],p=Object.assign({},t,{ELECTRON_RUN_AS_NODE:"1",CLAUDE_BIN:r,START_DIR:tty.tty._cwd||e.cwd}),c=!1);';
const POOL_OLD = 'for(let e=0;e<4;e++)extraTtys[z+e]=null';
const POOL_NEW = 'for(let e=0;e<8;e++)extraTtys[z+e]=null';
// #18 取消端口上限:固定 8 槽(3002-3009)作快速复用池;池满后从 z+8 起动态扩展端口
// (上限 4096 个扩展端口≈实际无上限)。CLI 会话(4/5 tab)自动取下一个空闲端口,
// 不与 1-3 tab 的固定池冲突;会话关闭时 extraTtys[port]=null 归还,端口可复用。
// 仅替换分配逻辑,池初始化与释放逻辑保持不变。
const ALLOC_OLD = 'let i=null;if(Object.keys(extraTtys).forEach(e=>{null===extraTtys[e]&&null===i&&(extraTtys[e]={},i=e)}),null===i)signale.error("TTY spawn denied (Reason: exceeded max TTYs number)"),n.sender.send("ttyspawn-reply","ERROR: max number of ttys reached");else{';
const ALLOC_NEW = 'let i=null;if(Object.keys(extraTtys).forEach(e=>{null===extraTtys[e]&&null===i&&(extraTtys[e]={},i=e)}),null===i){for(let _k=z+8;_k<z+4096;_k++){if(void 0===extraTtys[_k]||null===extraTtys[_k]){extraTtys[_k]={},i=_k;break}}}if(null===i)signale.error("TTY spawn denied (Reason: exceeded max TTYs number)"),n.sender.send("ttyspawn-reply","ERROR: max number of ttys reached");else{';

// ---- #19:tab1 EMPTY → TERM,与 tab2 统一成普通终端 ----
// 用户:tab2(EMPTY)与 tab3(TERM)功能一模一样(都是普通终端),标签却不同,困惑。
// 统一:tab1 静态标签从 "EMPTY" 改为 "TERM",tab2 本来就是 "TERM"。三处改动:
//   a) 标签映射表 t[1]:"EMPTY"→"TERM";b) HTML 里 shell_tab1 的 <p>EMPTY</p>;
//   c) onclose 终端关闭后重置标签 "<p>EMPTY</p>"→"<p>TERM</p>"。
// 幂等:三锚点带上下文(1:"EMPTY"/<li id="shell_tab1"/shell_tab"+e)均唯一,
//   重跑时已替换为 TERM → split 空转。
const TAB_MAP_OLD = 't={0:"MAIN SHELL",1:"EMPTY",2:"TERM",3:"MONITOR A",4:"MONITOR B"}';
const TAB_MAP_NEW = 't={0:"MAIN SHELL",1:"TERM",2:"TERM",3:"MONITOR A",4:"MONITOR B"}';
const TAB1_HTML_OLD = '<li id="shell_tab1" onclick="window.focusShellTab(1);"><p>EMPTY</p></li>';
const TAB1_HTML_NEW = '<li id="shell_tab1" onclick="window.focusShellTab(1);"><p>TERM</p></li>';
const TAB1_CLOSE_OLD = 'document.getElementById("shell_tab"+e).innerHTML="<p>EMPTY</p>"';
const TAB1_CLOSE_NEW = 'document.getElementById("shell_tab"+e).innerHTML="<p>TERM</p>"';

// ---- #27:tab2 标签补 "#3 - " 前缀(用户:tab2 进程名不显示,永远 "TERM")----
// 根因:_renderer.js 的 cover.tabLabel(y 函数)只对 tab0/tab1 拼进程名
//   (0→"MAIN - o"、1→"#2 - o"),tab2 落到静态 t[2]="TERM";同时 rememberProc
//   也只记 0/1(`0!==e&&1!==e||…`),tab2 的进程名根本没进 r[]。两处一起补:
//   y 加 2===n?o?"#3 - "+o:t[n] 分支;rememberProc 放行 2。
// 效果:tab2 有进程名时显示 "#3 - bash"(与 tab1 的 "#2 - bash" 递增一致),
//   无进程名(未跑/关闭)回落到 "TERM"。tab0/tab1/tab3/tab4 行为不变。
// 幂等:OLD 在 pristine _renderer.js 各恰好 1 处;替换后 NEW 含 OLD 吗?否——NEW 在 OLD
//   中间插了新分支,重跑时 OLD 已不存在 → split 空转。
const TAB2_LABEL_Y_OLD = 'y=(n,o)=>i?null!=e[n]?e[n]:"":0===n?o?"MAIN - "+o:t[n]:1===n?o?"#2 - "+o:t[n]:3===n||4===n?h[n]||t[n]:null!=t[n]?t[n]:""';
const TAB2_LABEL_Y_NEW = 'y=(n,o)=>i?null!=e[n]?e[n]:"":0===n?o?"MAIN - "+o:t[n]:1===n?o?"#2 - "+o:t[n]:2===n?o?"#3 - "+o:t[n]:3===n||4===n?h[n]||t[n]:null!=t[n]?t[n]:""';
const TAB2_REMEMBER_OLD = 'rememberProc:(e,t)=>{0!==e&&1!==e||(r[e]=t)}';
const TAB2_REMEMBER_NEW = 'rememberProc:(e,t)=>{0!==e&&1!==e&&2!==e||(r[e]=t)}';

// ---- Bug8:code 屏保/锁屏污染真终端 → 虚拟终端 ----
// 屏保 code 模式原来把假代码写进 term[currentTerm],show 时还序列化 term[0] 存
// preSaverTerm0;hide()/windDownCodeToLock 结束时对真终端 reset()+writelr("")。
// → 锁屏(Super+L → lockScreen.engage → screensaver.show)后解锁,真终端(CLAUDE 对话)
// 被清空。修复:code 屏保改用独立虚拟终端 #screensaver_vt 覆盖层渲染假代码,
// show/windDown/hide/resumeCode 一律不碰真终端;preSaverTerm0 序列化/恢复不再需要。
// (lockScreen 侧 LOCK1_NEW 18fix 已用独立虚拟终端。)
const SSVT_VAR_OLD = 'let C=null,x=null,T=0,A=[],$=null,M=!1,L=0;';
const SSVT_VAR_NEW = 'let C=null,x=null,T=0,A=[],$=null,M=!1,L=0,Vt=null,Vo=null;';
const SSVT_I_OLD = 'const I=()=>{let e=window.term&&window.term[window.currentTerm];if(e&&e.term&&"function"==typeof e.term.write&&(e.term.write(E()+"\\r\\n"),++S%10==0))try{const t=e.term._core&&e.term._core._renderService;t&&"function"==typeof t.clear&&t.clear(),e.term.refresh(0,e.term.rows-1)}catch(e){}}';
const SSVT_I_NEW = 'const I=()=>{if(!Vt||!Vt.write)return;if(Vt.write(E()+"\\r\\n"),++S%10==0)try{const t=Vt._core&&Vt._core._renderService;t&&"function"==typeof t.clear&&t.clear(),Vt.refresh(0,Vt.rows-1)}catch(e){}}';
const SSVT_SHOW_OLD = 'this.preSaverTerm0=null;try{const e=window.term&&window.term[0];if(e&&e.term){const{SerializeAddon:t}=require("xterm-addon-serialize"),n=new t;e.term.loadAddon(n),this.preSaverTerm0=n.serialize()}}catch(e){this.preSaverTerm0=null}t=setInterval(I,100)';
const SSVT_SHOW_NEW = 'this.preSaverTerm0=null;this._mkSsvt(),t=setInterval(I,100)';
const SSVT_HIDE_OLD = 'n){if(t){clearInterval(t),t=null;const e=window.term&&window.term[window.currentTerm];if(e&&e.term)try{"function"==typeof e.term.reset&&e.term.reset(),"function"==typeof e.writelr&&e.writelr("")}catch(e){}}';
const SSVT_HIDE_NEW = 'n){if(t){clearInterval(t),t=null}this._rmSsvt();';
const SSVT_HIDE2_OLD = 'if(C&&(M=!0),t){clearInterval(t),t=null;let e=window.term&&window.term[window.currentTerm];if(e&&e.term&&"function"==typeof e.term.write){b().forEach(t=>e.term.write(t+"\\r\\n"));let t=e.term.rows||24,n=0,o=setInterval(()=>{"function"==typeof e.term.write&&e.term.write("\\n"),n++,n>=t&&(clearInterval(o),"function"==typeof e.term.reset&&"function"==typeof e.writelr&&(e.term.reset(),e.writelr("")))},45)}}';
const SSVT_HIDE2_NEW = 'if(C&&(M=!0),t){clearInterval(t),t=null;if(Vt&&Vt.write){b().forEach(x=>Vt.write(x+"\\r\\n"));let n=0,o=setInterval(()=>{if(Vt&&Vt.write)Vt.write("\\n"),n++,n>=24&&(clearInterval(o),this._rmSsvt())},45)}}';
const SSVT_WIND_OLD = 'windDownCodeToLock(o){if(!e||n)return void(o&&o());n=!0,t&&(clearInterval(t),t=null);const s=window.term&&window.term[window.currentTerm];if(!s||!s.term||"function"!=typeof s.term.write)return n=!1,void(o&&o());b().forEach(e=>s.term.write(e+"\\r\\n"));let i=0;const r=setInterval(()=>{try{for(let e=0;e<4;e++)s.term.write("\\n")}catch(e){}++i>=30&&(clearInterval(r),clearTimeout(a),n=!1,o&&o())},32),a=setTimeout(()=>{n&&(clearInterval(r),n=!1,o&&o())},2500)}';
const SSVT_WIND_NEW = 'windDownCodeToLock(o){if(!e||n)return void(o&&o());n=!0,t&&(clearInterval(t),t=null);if(!Vt||"function"!=typeof Vt.write)return n=!1,void(o&&o());b().forEach(x=>Vt.write(x+"\\r\\n"));let i=0;const r=setInterval(()=>{try{for(let x=0;x<4;x++)Vt&&Vt.write&&Vt.write("\\n")}catch(_){}++i>=30&&(clearInterval(r),clearTimeout(a),n=!1,o&&o())},32),a=setTimeout(()=>{n&&(clearInterval(r),n=!1,o&&o())},2500)}';
const SSVT_RESUME_OLD = 'resumeCode(){e||"code"!==window.settings.screensaverStyle||(e=!0,document.body.classList.add("screensaver_on"),window.cursorTrap&&window.cursorTrap.hide(),window.cover&&!window.cover.isActive()&&window.cover.set(!0),k=!0,d.clear(),n=!1,_=[],t||(t=setInterval(I,100)))}';
const SSVT_RESUME_NEW = 'resumeCode(){e||"code"!==window.settings.screensaverStyle||(e=!0,document.body.classList.add("screensaver_on"),window.cursorTrap&&window.cursorTrap.hide(),window.cover&&!window.cover.isActive()&&window.cover.set(!0),k=!0,d.clear(),n=!1,_=[],this._mkSsvt(),t||(t=setInterval(I,100)))},' +
  '_mkSsvt(){try{this._rmSsvt()}catch(_){}let d=null;try{const _box=document.getElementById("main_shell_innercontainer")||document.body;d=document.createElement("div"),d.id="screensaver_vt",d.style.cssText="position:absolute;inset:0;z-index:2500;overflow:hidden;",_box.appendChild(d);const T=require("xterm").Terminal,_bg=(window.theme&&window.theme.terminal&&window.theme.terminal.background)||"#05080d",_fg=(window.theme&&window.theme.terminal&&window.theme.terminal.foreground)||"#aacfd1",_fs=(window.theme&&window.theme.terminal&&window.theme.terminal.fontSize)||11,_ff=(window.theme&&window.theme.terminal&&window.theme.terminal.fontFamily)||"Fira Mono";Vt=new T({cols:120,rows:34,fontFamily:_ff,fontSize:_fs,scrollback:0,disableStdin:!0,cursorBlink:!1,allowTransparency:!0,theme:{background:_bg,foreground:_fg}}),Vt.open(d);const sz=()=>{try{const w=d.clientWidth||window.innerWidth,h0=d.clientHeight||window.innerHeight,co=Vt._core;let cw=8,ch=17;try{const dm=co._renderService&&co._renderService.dimensions;if(dm&&dm.css&&dm.css.cell&&dm.css.cell.width>0&&dm.css.cell.height>0){cw=dm.css.cell.width;ch=dm.css.cell.height}}catch(_){}const c=Math.max(20,Math.floor(w/cw)),r=Math.max(6,Math.floor(h0/ch));if(c!==Vt.cols||r!==Vt.rows)Vt.resize(c,r)}catch(_){}};sz();try{const F=require("xterm-addon-fit").FitAddon;Vt.loadAddon(new F),Vt.fit()}catch(_){}setTimeout(sz,120),Vo=d}catch(_){try{Vt&&Vt.dispose&&Vt.dispose()}catch(__){Vt=null}Vt=null,Vo=null}return Vt},' +
  '_rmSsvt(){try{if(Vt){try{Vt.dispose()}catch(_){}Vt=null}}catch(_){Vt=null}try{if(Vo){try{Vo.remove()}catch(_){}Vo=null}}catch(_){Vo=null}}';

// ---- 19fix:code 锁屏框加大 + 主题配色 ----
// 用户:code 锁屏框"有点略小了,颜色也和整体ui不搭配"。锁屏框画在独立虚拟终端里
// (LOCK1_NEW,字号 14→20、前景/背景取 window.theme.terminal)。这里把 ASCII 框本身
// 54→72 列、所有硬编码 ANSI 亮绿/黄/白/青换成主题色:
//   _fc = 主题前景色 truecolor(默认 #aacfd1),_tb = 加粗主题色,_rd = 红(仅告警/拒绝)
//   a(青)→_fc、_(加粗白)→_tb、n(亮红)→_rd、标题成功态 (e?n:绿)→(e?n:_fc)、
//   PASSCODE 括号/密码点→_fc/_tb;绿[OK]/黄[WAIT]/dim 保留(状态语义)。
// _codeRedraw/_lockAnimTick 也用 this._thC/_tbC(由 _buildBoxRows 头部写入)统一配色。
const BOXROWS_HEAD_OLD = '_buildBoxRows(e,t){const i=54,';
const BOXROWS_HEAD_NEW = '_buildBoxRows(e,t){const i=72,_fc=this._thC=function(){try{const x=(window.theme&&window.theme.terminal&&window.theme.terminal.foreground)||"#aacfd1",m=/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(x);if(m)return"\x1b[38;2;"+parseInt(m[1],16)+";"+parseInt(m[2],16)+";"+parseInt(m[3],16)+"m";return"\x1b[38;2;170;207;209m"}catch(_){return"\x1b[38;2;170;207;209m"}}(),_tb=this._tbC="\x1b[1;"+_fc.slice(2),_rd=this._rdC="\x1b[1;38;2;231;72;72m",';
const BOXPAD_OLD = '" ".repeat(Math.max(0,52-o(e).length))';
const BOXPAD_NEW = '" ".repeat(Math.max(0,70-o(e).length))';
const BOXLN_OLD = '"═".repeat(52)';
const BOXLN_NEW = '"═".repeat(70)';
const BOX_A_OLD = 'a=e=>"\x1b[36m"+e+"\x1b[0m"';
const BOX_A_NEW = 'a=e=>_fc+e+"\x1b[0m"';
const BOX_WB_OLD = '_=e=>"\x1b[1;37m"+e+"\x1b[0m"';
const BOX_WB_NEW = '_=e=>_tb+e+"\x1b[0m"';
const BOX_N_OLD = 'n="\x1b[1;38;5;196m"';
const BOX_N_NEW = 'n=_rd';
const BOX_TITLE_OLD = '(e?n:"\x1b[1;32m")';
const BOX_TITLE_NEW = '(e?n:_fc)';
const BOX_PASS_OLD = '+"  \x1b[1;36m[\x1b[0m\x1b[1;33m"+y+"█\x1b[0m\x1b[1;36m]\x1b[0m"';
const BOX_PASS_NEW = '+"  "+_fc+"["+"\x1b[0m"+_tb+y+"█\x1b[0m"+_fc+"]\x1b[0m"';
const BOX_DRAW_OLD = 'const i=t.cols||80,o=t.rows||24,s=54,';
const BOX_DRAW_NEW = 'const i=t.cols||80,o=t.rows||24,s=72,';
const CODE_REDRAW_OLD = '_writeLockLine(this._codeRow,"    \x1b[1;37mPASSCODE:\x1b[0m  \x1b[1;36m[\x1b[0m\x1b[1;33m"+t+"█\x1b[0m\x1b[1;36m]\x1b[0m")';
const CODE_REDRAW_NEW = '_writeLockLine(this._codeRow,"    "+(this._tbC||"\x1b[1;38;2;170;207;209m")+"PASSCODE:"+"\x1b[0m  "+(this._thC||"\x1b[38;2;170;207;209m")+"["+"\x1b[0m"+(this._tbC||"\x1b[1;38;2;170;207;209m")+t+"█\x1b[0m"+(this._thC||"\x1b[38;2;170;207;209m")+"]\x1b[0m")';
const LOCKANIM_OLD = '_writeLockLine(this._codeAnimRow,"    \x1b[2mhandshake\x1b[0m  \x1b[36m"+this._randHex()+"\x1b[0m  "+(this._animOn?"\x1b[1;37m▓\x1b[0m":" "))';
const LOCKANIM_NEW = '_writeLockLine(this._codeAnimRow,"    \x1b[2mhandshake\x1b[0m  "+(this._thC||"\x1b[38;2;170;207;209m")+this._randHex()+"\x1b[0m  "+(this._animOn?(this._tbC||"\x1b[1;38;2;170;207;209m")+"▓\x1b[0m":" "))';


// ---- #20:锁屏/屏保改独立真实终端(engage ttyspawn 新建 cat pty,unlock/dismiss 销毁,不碰 tabs1-5) ----
// 用户拍板:CODE 锁屏/屏保视觉效果沿用老版本(纯代码 ASCII 框+假代码流),核心是把
// "虚假绘制/跑真终端"换成每次新建一次性独立真实终端(node-pty+ws,跑 cat 回显)。
const SVT_OLD = "_mkSsvt(){try{this._rmSsvt()}catch(_){}let d=null;try{const _box=document.getElementById(\"main_shell_innercontainer\")||document.body;d=document.createElement(\"div\"),d.id=\"screensaver_vt\",d.style.cssText=\"position:absolute;inset:0;z-index:2500;overflow:hidden;\",_box.appendChild(d);const T=require(\"xterm\").Terminal,_bg=(window.theme&&window.theme.terminal&&window.theme.terminal.background)||\"#05080d\",_fg=(window.theme&&window.theme.terminal&&window.theme.terminal.foreground)||\"#aacfd1\",_fs=(window.theme&&window.theme.terminal&&window.theme.terminal.fontSize)||11,_ff=(window.theme&&window.theme.terminal&&window.theme.terminal.fontFamily)||\"Fira Mono\";Vt=new T({cols:120,rows:34,fontFamily:_ff,fontSize:_fs,scrollback:0,disableStdin:!0,cursorBlink:!1,allowTransparency:!0,theme:{background:_bg,foreground:_fg}}),Vt.open(d);const sz=()=>{try{const w=d.clientWidth||window.innerWidth,h0=d.clientHeight||window.innerHeight,co=Vt._core;let cw=8,ch=17;try{const dm=co._renderService&&co._renderService.dimensions;if(dm&&dm.css&&dm.css.cell&&dm.css.cell.width>0&&dm.css.cell.height>0){cw=dm.css.cell.width;ch=dm.css.cell.height}}catch(_){}const c=Math.max(20,Math.floor(w/cw)),r=Math.max(6,Math.floor(h0/ch));if(c!==Vt.cols||r!==Vt.rows)Vt.resize(c,r)}catch(_){}};sz();try{const F=require(\"xterm-addon-fit\").FitAddon;Vt.loadAddon(new F),Vt.fit()}catch(_){}setTimeout(sz,120),Vo=d}catch(_){try{Vt&&Vt.dispose&&Vt.dispose()}catch(__){Vt=null}Vt=null,Vo=null}return Vt},_rmSsvt(){try{if(Vt){try{Vt.dispose()}catch(_){}Vt=null}}catch(_){Vt=null}try{if(Vo){try{Vo.remove()}catch(_){}Vo=null}}catch(_){Vo=null}}";
const SVT_NEW = "_mkSsvt(){try{this._rmSsvt()}catch(_){}let d=null;try{const _box=document.getElementById(\"main_shell_innercontainer\")||document.body;d=document.createElement(\"div\"),d.id=\"screensaver_vt\",d.style.cssText=\"position:absolute;inset:0;z-index:2500;overflow:hidden;background:\"+((window.theme&&window.theme.terminal&&window.theme.terminal.background)||\"#05080d\"),_box.appendChild(d),Vo=d}catch(_){Vo=null}this._svtSeq=(this._svtSeq||0)+1;const _seq=this._svtSeq;try{ipc.send(\"ttyspawn\",{cli:[\"sh\",\"-c\",\"stty raw -echo; exec cat\"]}),ipc.once(\"ttyspawn-reply\",(ev,r)=>{try{if(_seq!==this._svtSeq)return;if(String(r).startsWith(\"ERROR\")){try{d&&d.remove()}catch(_){}return}const _port=Number(String(r).substr(9));if(!d||!d.isConnected||!document.getElementById(\"screensaver_vt\")){try{const x=new WebSocket(\"ws://127.0.0.1:\"+_port);x.onopen=()=>{try{x.close()}catch(_){}}}catch(_){}return}Vt=new Terminal({role:\"client\",parentId:\"screensaver_vt\",port:_port,muted:!0});try{const _oW=Vt.write.bind(Vt);Vt.write=x=>{try{if(Vt.socket&&1===Vt.socket.readyState)_oW(x)}catch(_){}}}catch(_){}setTimeout(()=>{try{if(Vt&&Vt.socket&&1===Vt.socket.readyState)Vt.write(\"\\r\")}catch(_){}},80)}catch(_){}})}catch(_){}return Vt},_rmSsvt(){this._svtSeq=(this._svtSeq||0)+1;try{if(Vt){try{if(Vt.socket&&Vt.socket.readyState<2)Vt.socket.close()}catch(_){}try{Vt.term&&Vt.term.dispose&&Vt.term.dispose()}catch(_){}Vt=null}}catch(_){Vt=null}try{if(Vo){try{Vo.remove()}catch(_){}Vo=null}}catch(_){Vo=null}}";
const I_OLD = "const I=()=>{if(!Vt||!Vt.write)return;if(Vt.write(E()+\"\\r\\n\"),++S%10==0)try{const t=Vt._core&&Vt._core._renderService;t&&\"function\"==typeof t.clear&&t.clear(),Vt.refresh(0,Vt.rows-1)}catch(e){}};";
const I_NEW = "const I=()=>{if(!Vt||!Vt.write)return;try{Vt.write(E()+\"\\r\\n\")}catch(e){}};";
const L1_OLD = "if(this._term=r,this._codeBuf=\"\",this._suppressOutput=!0)try{const T=require(\"xterm\").Terminal;r.term=new T({cols:120,rows:34,fontFamily:(window.theme&&window.theme.terminal&&window.theme.terminal.fontFamily)||\"Fira Mono\",fontSize:18,scrollback:0,disableStdin:!0,cursorBlink:!1,allowTransparency:!0,theme:{background:(window.theme&&window.theme.terminal&&window.theme.terminal.background)||\"#05080d\",foreground:(window.theme&&window.theme.terminal&&window.theme.terminal.foreground)||\"#aacfd1\"}})}catch(e){r.term=null}if(r.term){try{const vc=document.createElement(\"div\");vc.id=\"lock_virt_term\",vc.style.cssText=\"position:absolute;inset:0;overflow:hidden;z-index:3200\",(document.getElementById(\"main_shell_innercontainer\")||t).appendChild(vc),r.term.open(vc);const _sz=()=>{try{const w=vc.clientWidth||window.innerWidth,h=vc.clientHeight||window.innerHeight,co=r.term._core;let cw=8,ch=17;try{const d=co._renderService&&co._renderService.dimensions;if(d&&d.css&&d.css.cell&&d.css.cell.width>0&&d.css.cell.height>0){cw=d.css.cell.width;ch=d.css.cell.height}}catch(_){}const c=Math.max(20,Math.floor(w/cw)),rr=Math.max(6,Math.floor(h/ch));if(c!==r.term.cols||rr!==r.term.rows)r.term.resize(c,rr)}catch(_){}};try{const F=require(\"xterm-addon-fit\").FitAddon;r.term.loadAddon(new F),r.term.fit()}catch(e){}_sz();setTimeout(()=>{try{if(this.active&&r.term&&document.getElementById(\"lock_block\")){_sz();this._boxAnimating=!1;try{this._drawLockBox(!1)}catch(e){};try{this._startLockAnim&&this._startLockAnim()}catch(e){}}}catch(e){}},150)}catch(e){}this._rawWrite=r.term.write.bind(r.term),r.term.write=e=>this._rawWrite(e)}";
const L1_NEW = "if(this._term=r,this._codeBuf=\"\",this._suppressOutput=!0){try{const i=document.getElementById(\"mod_clock\");i&&(this._origClockPos=i.style.position,i.style.position=\"relative\",i.style.zIndex=\"3100\");const o=document.getElementById(\"main_shell_title\");o&&(this._origTitleZ=o.style.zIndex,o.style.zIndex=\"3100\");const s=document.getElementById(\"main_shell\");s&&(this._origShellClip=s.style.clipPath,this._origShellZ=s.style.zIndex,s.style.zIndex=\"3200\",s.style.clipPath=\"none\");const n=document.getElementById(\"main_shell_innercontainer\");n&&(this._origInnerZ=n.style.zIndex,this._origInnerClip=n.style.clipPath,n.style.zIndex=\"3001\",n.style.clipPath=\"polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))\")}catch(e){}try{const vc=document.createElement(\"div\");vc.id=\"lock_virt_term\",vc.style.cssText=\"position:absolute;inset:0;overflow:hidden;z-index:3200;background:\"+((window.theme&&window.theme.terminal&&window.theme.terminal.background)||\"#05080d\"),(document.getElementById(\"main_shell_innercontainer\")||t).appendChild(vc)}catch(e){}this._rawWrite=e=>{try{if(r.term&&r.term.socket&&1===r.term.socket.readyState)r.term.write(e)}catch(_){}};this._lockSeq=(this._lockSeq||0)+1;const _seq=this._lockSeq;const _ipc=require(\"electron\").ipcRenderer;try{_ipc.send(\"ttyspawn\",{cli:[\"sh\",\"-c\",\"stty raw -echo; exec cat\"]}),_ipc.once(\"ttyspawn-reply\",(ev,res)=>{try{if(_seq!==this._lockSeq)return;if(String(res).startsWith(\"ERROR\")){r.term=null;return}const _port=Number(String(res).substr(9));const vc=document.getElementById(\"lock_virt_term\");if(!vc||!document.getElementById(\"lock_block\")||!this.active){try{const x=new WebSocket(\"ws://127.0.0.1:\"+_port);x.onopen=()=>{try{x.close()}catch(_){}}}catch(_){}r.term=null;return}r.term=new Terminal({role:\"client\",parentId:\"lock_virt_term\",port:_port,muted:!0});try{r.term.term&&r.term.term.setOption&&r.term.term.setOption(\"fontSize\",18)}catch(_){}try{Object.defineProperty(r.term,\"cols\",{get:()=>r.term.term?r.term.term.cols:80});Object.defineProperty(r.term,\"rows\",{get:()=>r.term.term?r.term.term.rows:24});Object.defineProperty(r.term,\"_core\",{get:()=>r.term.term?r.term.term._core:null})}catch(_){}r.term.reset=()=>{try{r.term.term&&r.term.term.reset()}catch(_){}};r.term.refresh=(a,b)=>{try{r.term.term&&r.term.term.refresh(a,b)}catch(_){}};r.term.focus=()=>{try{r.term.term&&r.term.term.focus()}catch(_){}};r.term.resize=(a,b)=>{try{r.term.term&&r.term.term.resize(a,b)}catch(_){}};let _n=0;const _draw=()=>{try{if(!this.active||!r.term||!document.getElementById(\"lock_block\"))return;if(r.term.socket&&1===r.term.socket.readyState){this._boxAnimating=!1;try{this._drawLockBox(!1)}catch(e){}try{this._startLockAnim&&this._startLockAnim()}catch(e){}return}if(++_n<40)setTimeout(_draw,100)}catch(_){}};setTimeout(_draw,150)}catch(_){}})}catch(_){}}";
const L2_OLD = "try{if(this._term&&this._term.term&&this._term.term!==(window.term&&window.term[0]&&window.term[0].term)){try{this._term.term.dispose()}catch(e){}}this._term.term=null}catch(e){}";
const L2_NEW = "this._lockSeq=(this._lockSeq||0)+1;try{if(this._term&&this._term.term){try{if(this._term.term.socket&&this._term.term.socket.readyState<2)this._term.term.socket.close()}catch(e){}try{this._term.term.term&&this._term.term.term.dispose&&this._term.term.term.dispose()}catch(e){}}this._term.term=null}catch(e){}";
const L3_OLD = "if(this._term){let t=!1;try{if(this._origSend&&(this._term.socket.send=this._origSend),this._term.term&&(this._origTermWrite&&(this._term.term.write=this._origTermWrite),this._suppressOutput=!1,this._term.term.reset(),this._term.term.write(\"\u001b[?25h\"),e&&this._savedTerm&&(this._term.term.write(this._savedTerm),this._savedTerm=null,this._serializeAddon=null,t=!0)),e&&!t&&this._term.socket&&1===this._term.socket.readyState)try{this._term.socket.send(\"\\r\")}catch(e){}}catch(e){}}this._term=null,this._restoreKeyboard();";
const L3_NEW = "this._term=null,this._restoreKeyboard();";
const T1_OLD = "this.port=e.port||3e3,this.cwd=\"\",this._altHist=[]";
const T1_NEW = "this.port=e.port||3e3,this.cwd=\"\",this.muted=!!e.muted,this._altHist=[]";
const T1b_OLD = "this.socket.addEventListener(\"message\",e=>{let t=Date.now();if(t-this.lastSoundFX>30&&(window.audioManager.stdout.play(),this.lastSoundFX=t),";
const T1b_NEW = "this.socket.addEventListener(\"message\",e=>{let t=Date.now();if(!this.muted&&t-this.lastSoundFX>30&&(window.audioManager.stdout.play(),this.lastSoundFX=t),";
const T1c_OLD = "if(this._userIn&&Date.now()-this._lastOut>=1500)";
const T1c_NEW = "if(!this.muted&&this._userIn&&Date.now()-this._lastOut>=1500)";


const targets = [
  {
    name: '_boot.js (win+L 锁屏快捷键 + 系统级 idle 推送)',
    path: ['_boot.js'],
    expectIn: 'let d=new Terminal({role:"server",shell:a,params:l,login:c,cwd:tty.tty._cwd||e.cwd,env:p,port:i',
    expectOut: 'axel:list',
    // 锁屏快捷键 CommandOrControl+Shift+O → Super+L(Windows 键 + L)。
    // 另:在 powerMonitor suspend/resume 注册后追加 system-idle 推送,把系统级空闲秒数
    // 周期性发给渲染进程,供 _renderer.js 的 idle 检测用(焦点在其它窗口时不误判闲置)。
    // #10:ttyspawn 支持 {cli:[cmd,...args]} 任意命令(CLI 面板);其中 claude 与旧 tab2
    // 一样走 claude-launcher.js 目录选择器再启动;extraTtys 池 4→8 给两个面板留端口。
    // 幂等:resume 的注入是 prefix-nested(OLD ⊂ NEW),重跑会叠加 → 先 revert 再 apply。
    transform: c => c
      .split('"CommandOrControl+Shift+O"').join('"Super+L"')
      .split('e.on("resume",()=>{win&&!win.isDestroyed()&&(win.webContents.send("pm:resume"),win.show(),win.focus(),win.webContents&&win.webContents.focus())})}catch(e){}try{setInterval(()=>{try{if(win&&!win.isDestroyed()){let s=0;try{s=require("electron").powerMonitor.getSystemIdleTime()||0}catch(_){}win.webContents.send("system-idle",Math.floor(s))}}catch(_){}},1e3)}catch(_){}')
      .join('e.on("resume",()=>{win&&!win.isDestroyed()&&(win.webContents.send("pm:resume"),win.show(),win.focus(),win.webContents&&win.webContents.focus())})}catch(e){}')
      .split('e.on("resume",()=>{win&&!win.isDestroyed()&&(win.webContents.send("pm:resume"),win.show(),win.focus(),win.webContents&&win.webContents.focus())})}catch(e){}')
      .join('e.on("resume",()=>{win&&!win.isDestroyed()&&(win.webContents.send("pm:resume"),win.show(),win.focus(),win.webContents&&win.webContents.focus())})}catch(e){}try{setInterval(()=>{try{if(win&&!win.isDestroyed()){let s=0;try{s=require("electron").powerMonitor.getSystemIdleTime()||0}catch(_){}win.webContents.send("system-idle",Math.floor(s))}}catch(_){}},1e3)}catch(_){}')
      .split('let d=new Terminal({role:"server",shell:a,params:l,login:c,cwd:tty.tty._cwd||e.cwd,env:p,port:i})')
      .join('let d=new Terminal({role:"server",shell:a,params:l,login:c,cwd:tty.tty._cwd||e.cwd,env:p,port:i,noBootCR:!!s})')
      .split(TTYSPAWN_OLD).join(TTYSPAWN_NEW)
      .split(POOL_OLD).join(POOL_NEW)
      .split(ALLOC_OLD).join(ALLOC_NEW)
      // #8/#9:AXEL 主进程(5 handler)+ clash:ctrl 透传 handler(锚点前缀注入,expectOut 换新防重跑)
      .split(AXEL_BOOT_ANCHOR).join(AXEL_BOOT_NEW + AXEL_BOOT_ANCHOR)
      .split(CLASH_CTRL_ANCHOR).join(CLASH_CTRL_NEW + CLASH_CTRL_ANCHOR),
  },
  {
    name: 'terminal.class.js (alt-screen 历史滚动 + ws 断线重连 + #9 完成音效)',
    path: ['classes', 'terminal.class.js'],
    expectIn: 'scrollback:1500,',
    expectOut: 'this._doneT=setTimeout',
    // Bug3 alt-screen 历史滚动:Claude Code 等 TUI 用 alt-screen buffer,该 buffer 无
    // scrollback,xterm scrollLines 无效 → 滚轮"不能滚动"。修复:写包装器拦截 xterm.write,
    // 当活动 buffer 是 alt 时,每 250ms 用 SerializeAddon 序列化一帧,存进 _altHist
    // (unshift 最新在前,上限 400 帧,最多可回看约 100 秒)。滚轮向上进入历史查看
    // (reset+写帧),继续上滚看更旧,下滚回更新,滚到最新/最旧自动回到实时。应用退出
    // alt 模式时自动解除暂停,避免界面冻结。
    // Bug5 断线重连:挂起(合盖)期间主进程 node-pty / WebSocket server 可能被系统冻结,
    // 恢复后 ws 已死,renderer 的 socket.send 静默失败 → "页面在但无法输入"。修复:客户端
    // 抽出 _wsConn() 并拦截 onclose → 1.5s 后自动重连(每次重建 AttachAddon 并 dispose 旧的,
    // 消息监听在 _wsConn 内,重连后重新挂上);服务端 verifyClient 放开单客户端限制 +
    // 新连接到来时关掉旧客户端。resumeFromSuspend 调 reconnectNow() 主动重连。
    // 重连时先做 DOM 存活性检查(term.element 已不在 body → tab 已关,不重连,防僵尸连接)。
    // claude 启动修复:新终端连接建立时 server 会给 pty 写一个裸 \r(为了刷新 bash 提示符)。
    // 但 claude 的 shell 是 claude-launcher.js(目录选择器),\r → select() → cursor=-1 →
    // 立即 launch(claude) → "选 cd 路径"和"启动 claude"同时发生。
    // 修复:claude 终端(noBootCR)跳过 boot 回车,用户先选目录再 Enter 才启动。
    // #9 完成音效:终端/Claude 停止输出后静默 1.5s 播放 info.wav(需已启用音频设置;
    // 且用户至少输入过一次,避免启动时空响)。_lastOut 由每条输出刷新,新输出重置定时器。
    transform: c => c
      .split('scrollback:1500,').join('scrollback:1500,enableMouseEvents:!0,')
      .split('this.port=e.port||3e3,this.cwd=""')
      .join('this.port=e.port||3e3,this.cwd="",this._altHist=[],this._altHistIdx=0,this._altLast="",this._altPaused=!1,this._altLastT=0,this._serializeA=null')
      .split('let a=new r;this.term.loadAddon(a),this.term.attachCustomKeyEventHandler')
      .join('let a=new r;this.term.loadAddon(a),this._ow=this.term.write.bind(this.term),this.term.write=d=>{try{const b=this.term.buffer&&this.term.buffer.active;if(this._altPaused&&(!b||"alt"!==b.type))this._altPaused=!1;if(this._altPaused)return;if(b&&"alt"===b.type){const tt=Date.now();if(tt-this._altLastT>250){this._altLastT=tt;if(!this._serializeA){const{SerializeAddon:SA}=require("xterm-addon-serialize");this._serializeA=new SA;try{this.term.loadAddon(this._serializeA)}catch(e){}}const ss=this._serializeA?this._serializeA.serialize():"",pv=this._altHist[0];if(ss&&ss!==pv){this._altLast=ss,this._altHist.unshift(ss),this._altHist.length>400&&this._altHist.pop(),this._altHistIdx=0}}}}catch(e){}this._ow(d)},this.term.attachCustomKeyEventHandler')
      .split('m.addEventListener("wheel",e=>{e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      .join('m.addEventListener("wheel",e=>{const _b=this.term&&this.term.buffer&&this.term.buffer.active;if(_b&&"alt"===_b.type){e.preventDefault(),e.stopPropagation();const _d=e.deltaY;if(_d<0){if(this._altPaused){if(this._altHistIdx<this._altHist.length-1)this._altHistIdx++;else this._altPaused=!1,this._altHistIdx=0,this.term.reset(),this._altLast&&this._ow(this._altLast)}else this._altHist.length&&(this._altPaused=!0,this._altHistIdx=Math.min(1,this._altHist.length-1));if(this._altPaused){const h=this._altHist[this._altHistIdx];h&&(this.term.reset(),this._ow(h))}}else if(_d>0&&this._altPaused){if(this._altHistIdx>0)this._altHistIdx--;else this._altPaused=!1,this._altHistIdx=0,this.term.reset(),this._altLast&&this._ow(this._altLast)}return}e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      .split('this._disableCWDtracking=!1,').join('this._disableCWDtracking=!1,this._noBootCR=!!e.noBootCR,')
      .split('try{this.tty.write("\\r")}catch(e){}}').join('try{this._noBootCR||this.tty.write("\\r")}catch(e){}}')
      .split('this.socket=new WebSocket("ws://"+d+":"+w),this.socket.onopen=()=>{let e=new t(this.socket);this.term.loadAddon(e),this.fit();try{this.term.focus()}catch(e){}},this.socket.onerror=e=>{throw JSON.stringify(e)},this.socket.onclose=e=>{this.onclose&&this.onclose(e)},this.lastSoundFX=Date.now(),this.socket.addEventListener("message",e=>{let t=Date.now();if(t-this.lastSoundFX>30&&(window.audioManager.stdout.play(),this.lastSoundFX=t),t-this.lastRefit>1e4&&this.fit(),!window.settings.experimentalGlobeFeatures)return;let i=e.data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);null!==i&&i.length>=1&&(i=i.filter((e,t,i)=>i.indexOf(e)===t),i.forEach(e=>{window.mods.globe.addTemporaryConnectedMarker(e)}))})')
      .join('this._closing=!1,this._rcT=null,this._attachAddon=null,this.reconnectNow=()=>{try{this._rcT&&(clearTimeout(this._rcT),this._rcT=null),this._wsConn&&this._wsConn()}catch(e){}},this._wsConn=()=>{this.socket=new WebSocket("ws://"+d+":"+w),this.socket.onopen=()=>{try{this._attachAddon&&this._attachAddon.dispose()}catch(e){};try{this._attachAddon=new t(this.socket)}catch(e){this._attachAddon=null}try{this.term.loadAddon(this._attachAddon)}catch(e){}this.fit();try{this.term.focus()}catch(e){}},this.socket.onerror=()=>{try{this.socket.close()}catch(e){}},this.socket.onclose=e=>{this.onclose&&this.onclose(e);if(this._closing)return;try{if(!(this.term&&this.term.element&&document.body.contains(this.term.element)))return}catch(e){return}this._rcT&&clearTimeout(this._rcT),this._rcT=setTimeout(()=>{try{this._wsConn()}catch(e){}},1500)},this.socket.addEventListener("message",e=>{let t=Date.now();if(t-this.lastSoundFX>30&&(window.audioManager.stdout.play(),this.lastSoundFX=t),t-this.lastRefit>1e4&&this.fit(),!window.settings.experimentalGlobeFeatures)return;let i=e.data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);null!==i&&i.length>=1&&(i=i.filter((e,t,i)=>i.indexOf(e)===t),i.forEach(e=>{window.mods.globe.addTemporaryConnectedMarker(e)}))})},this.lastSoundFX=Date.now(),this._wsConn()')
      .split('this.socket.addEventListener("message",e=>{let t=Date.now();if(t-this.lastSoundFX>30&&(window.audioManager.stdout.play(),this.lastSoundFX=t),')
      .join('this.socket.addEventListener("message",e=>{let t=Date.now();if(t-this.lastSoundFX>30&&(window.audioManager.stdout.play(),this.lastSoundFX=t),this._doneT&&clearTimeout(this._doneT),this._lastOut=Date.now(),this._doneT=setTimeout(()=>{this._doneT=null;if(this._userIn&&Date.now()-this._lastOut>=1500)try{window.audioManager&&window.audioManager.info&&window.audioManager.info.play()}catch(_){}},1500),')
      .split('this.write=e=>{this.socket.send(e)}').join('this.write=e=>{this._userIn=!0;this.socket.send(e)}')
      .split('this.wss=new this.Websocket({port:this.port,clientTracking:!0,verifyClient:e=>!(this.wss.clients.length>=1)})').join('this.wss=new this.Websocket({port:this.port,clientTracking:!0,verifyClient:()=>!0})')
      .split('this.wss.on("connection",e=>{this.onopened(this.tty.pid)').join('this.wss.on("connection",e=>{try{this.wss.clients.forEach(c=>{try{c!==e&&c.close()}catch(_){}})}catch(_){}this.onopened(this.tty.pid)')
      .split(T1_OLD).join(T1_NEW).split(T1b_OLD).join(T1b_NEW).split(T1c_OLD).join(T1c_NEW)
      // 25fix:开终端就有两行/像多按回车 —— 连接建立时无条件写一个 boot \r 到 pty
      // (canonical 模式 ICRNL 会把它当成一次空行提交 → 空行+再次提示符)。改为:
      // 首次连接后只保留"延迟条件回退":1200ms 内若 pty 无任何输出、用户也没输入,
      // 才补发一次 \r(兜底极少数"提示符丢失"竞态),正常情况不再多回车。
      .split('this.wss.on("connection",e=>{try{this.wss.clients.forEach(c=>{try{c!==e&&c.close()}catch(_){}})}catch(_){}this.onopened(this.tty.pid),e.on("close",(e,t)=>{this.ondisconnected(e,t)}),e.on("message",e=>{this.tty.write(e)}),this.tty.onData(t=>{this._nextTickUpdateTtyCWD=!0,this._nextTickUpdateProcess=!0;try{e.send(t)}catch(e){}});try{this._noBootCR||this.tty.write("\\r")}catch(e){}})')
      .join('this.wss.on("connection",e=>{try{this.wss.clients.forEach(c=>{try{c!==e&&c.close()}catch(_){}})}catch(_){}this.onopened(this.tty.pid),e.on("close",(e,t)=>{this.ondisconnected(e,t)}),e.on("message",e=>{this._bootIn=!0;this.tty.write(e)}),this.tty.onData(t=>{this._bootGot=!0;this._nextTickUpdateTtyCWD=!0,this._nextTickUpdateProcess=!0;try{e.send(t)}catch(e){}});try{if(!this._noBootCR&&!this._booted){this._booted=!0,this._bootGot=!1,this._bootIn=!1,this._bootT=setTimeout(()=>{try{this._bootT=null;if(!this._bootGot&&!this._bootIn)this.tty.write("\\r")}catch(_){}},1200)}}catch(e){}})'),
  },
  {
    name: 'lockScreen.class.js (code 锁屏用独立虚拟终端 + 框加大 + 主题配色)',
    path: ['classes', 'lockScreen.class.js'],
    expectIn: 'const r=window.term[0];if(this._term=r,this._codeBuf=""',
    expectOut: 'id:"__lockvirt"',
    transform: c => c
      .split(LOCK1_OLD).join(LOCK1_NEW)
      .split('_teardownLock(e){this.active=!1,').join(LOCK2_NEW)
      .split(BOXROWS_HEAD_OLD).join(BOXROWS_HEAD_NEW)
      .split(BOXPAD_OLD).join(BOXPAD_NEW)
      .split(BOXLN_OLD).join(BOXLN_NEW)
      .split(BOX_A_OLD).join(BOX_A_NEW)
      .split(BOX_WB_OLD).join(BOX_WB_NEW)
      .split(BOX_N_OLD).join(BOX_N_NEW)
      .split(BOX_TITLE_OLD).join(BOX_TITLE_NEW)
      .split(BOX_PASS_OLD).join(BOX_PASS_NEW)
      .split(BOX_DRAW_OLD).join(BOX_DRAW_NEW)
      .split(CODE_REDRAW_OLD).join(CODE_REDRAW_NEW)
      .split(LOCKANIM_OLD).join(LOCKANIM_NEW)
      .split(L1_OLD).join(L1_NEW).split(L2_OLD).join(L2_NEW).split(L3_OLD).join(L3_NEW),
  },
  {
    name: 'backend.js (openbox --config → --config-file + #5 剪贴板桥 + #7 Xvfb 光标)',
    path: ['appmonitor', 'backend.js'],
    expectIn: '"openbox",["--config",d,"--sm-disable"]',
    expectOut: 'edex-clipboard-bridge.sh',
    // appmonitor 的 realBackend 用非法参数 --config 启动嵌套 openbox(正确是 --config-file),
    // openbox 秒退 → 虚拟显示器上无 WM → 应用窗口永不最大化。修复:用正确参数。
    // 另:noVNC 直连 ws://127.0.0.1:<rfbPort>/websockify,但 x11vnc 只提供 RFB(无 websocket)
    // → 握手失败 → Firefox tab 显示 link lost。修复:x11vnc 改用 rfbPort+10,再起 websockify
    // 监听原 rfbPort 转发到 rfbPort+10(系统已装 /usr/bin/websockify)。
    // 另:虚拟屏不再 spawn fcitx5。fcitx5 的 dbus name org.fcitx.Fcitx5 是 per-session 单实例
    // (不是 per-display)。主屏 :0 的 fcitx5 由 edex-session.sh 启动,供 eDEX 显示候选窗;
    // backend 对 :101/:102 再 spawn "fcitx5 -d --replace" 会把主屏实例顶掉 → eDEX 输入中文
    // 无候选窗(#144 盲打)。删除虚拟屏 fcitx5,让主屏实例独占 dbus name。
    // #5 剪贴板桥:每个虚拟显示器再拉起 edex-clipboard-bridge.sh,把虚拟屏与主屏 :0 的
    // CLIPBOARD(文本)双向同步 → Firefox 复制可在 eDEX 终端粘贴,反之亦然。
    // #7 Xvfb 光标:spawn 的应用 env 加 XCURSOR_THEME=edex,虚拟屏内用 eDEX 风格光标。
    transform: c => c
      .split('"openbox",["--config",d,"--sm-disable"]').join('"openbox",["--config-file",d,"--sm-disable"]')
      .split('s=o("x11vnc",["-display",e.display,"-rfbport",String(e.rfbPort),"-shared","-forever","-nopw","-listen","127.0.0.1"],{stdio:"ignore"});r.push(i,t,s);')
      .join('s=o("x11vnc",["-display",e.display,"-rfbport",String(e.rfbPort+10),"-shared","-forever","-nopw","-listen","127.0.0.1"],{stdio:"ignore"}),w=o("websockify",[String(e.rfbPort),"127.0.0.1:"+String(e.rfbPort+10)],{stdio:"ignore"}),B=o("/usr/local/bin/edex-clipboard-bridge.sh",[e.display],{stdio:"ignore",env:Object.assign({},process.env,{DISPLAY:e.display})});r.push(i,t,s,w,B);')
      .split('const n=o("fcitx5",["-d","--replace"],{stdio:"ignore",env:Object.assign({},process.env,{DISPLAY:e.display,GTK_IM_MODULE:"fcitx",QT_IM_MODULE:"fcitx",XMODIFIERS:"@im=fcitx"})});r.push(n);')
      .join('')
      .split('{DISPLAY:i.display,GTK_IM_MODULE:"fcitx",QT_IM_MODULE:"fcitx",XMODIFIERS:"@im=fcitx"}')
      .join('{DISPLAY:i.display,GTK_IM_MODULE:"fcitx",QT_IM_MODULE:"fcitx",XMODIFIERS:"@im=fcitx",XCURSOR_THEME:"edex"}')
      .split('{DISPLAY:":0"}')
      .join('{DISPLAY:":0",XCURSOR_THEME:"edex"}'),
  },
  {
    name: 'backend.js (fullscreen 按 PID 定位窗口:不再 wmctrl :ACTIVE: 误全屏 eDEX)',
    path: ['appmonitor', 'backend.js'],
    expectIn: 'setTimeout(()=>{try{o("wmctrl",["-r",":ACTIVE:","-b","add,fullscreen"],{env:p,stdio:"ignore"})}catch(e){}},1500)',
    expectOut: 'child_process").spawnSync',
    // #34 fullscreen:原实现 wmctrl -r :ACTIVE: 在 +1500ms 把"当时活动窗口"全屏——
    // 但启动应用时 eDEX 仍持有焦点,:ACTIVE: 是 eDEX 主窗,应用缩在后面不动。
    // 改为:轮询 wmctrl -l -p 按 _NET_WM_PID(子进程 pid)找到应用自己的窗口,
    // 再用 wmctrl -i -a(激活)+ -r -b add,fullscreen(全屏)+ add,above(置顶)。
    // 轮询 40×500ms 兼容 Firefox 冷启动;fullscreenPid 被清(退出/被顶替)即停。
    transform: c => c
      .split('setTimeout(()=>{try{o("wmctrl",["-r",":ACTIVE:","-b","add,fullscreen"],{env:p,stdio:"ignore"})}catch(e){}},1500)')
      .join('setTimeout(()=>{const q=require("child_process").spawnSync;let n=0;(function w(){if(!a)return;n++;let line=null;try{const out=q("wmctrl",["-l","-p"],{env:p,encoding:"utf8"}).stdout||"";out.split("\\n").some(x=>{const f=x.trim().split(/\\s+/);if(f.length>=4&&f[2]===String(a)){line=f[0];return true}return false})}catch(e){}if(line){try{o("wmctrl",["-i","-a",line],{env:p,stdio:"ignore"})}catch(e){}try{o("wmctrl",["-i","-r",line,"-b","add,fullscreen"],{env:p,stdio:"ignore"})}catch(e){}try{o("wmctrl",["-i","-r",line,"-b","add,above"],{env:p,stdio:"ignore"})}catch(e){}}else if(n<40)setTimeout(w,500)})()},800)'),
  },
  {
    name: 'native-apps.js (SYSTEM_APP_RE 补漏:应用列表含 native 后滤掉系统工具)',
    path: ['appmonitor', 'native-apps.js'],
    expectIn: 'org\\.kde\\.)([\\s_.\\/-]|$)/i',
    expectOut: '|x11vnc)([\\s_.\\/-]|$)/i',
    // #17 应用列表恢复 native:(含 Firefox)后,Input Method / Keyboard layout viewer /
    // X11VNC Server 这三个系统工具名没被原 SYSTEM_APP_RE 命中,会混进应用列表。
    // 补漏:按 exec/名字追加三个精准替代(im-config / kbd-layout-viewer5 / x11vnc)。
    transform: c => c
      .split('org\\.kde\\.)([\\s_.\\/-]|$)/i')
      .join('org\\.kde\\.|im-config|kbd-layout-viewer5|x11vnc)([\\s_.\\/-]|$)/i'),
  },
  {
    name: 'keyboard.class.js',
    path: ['classes', 'keyboard.class.js'],
    expectIn: '(t.length?', expectOut: '(t.forEach?',
    transform: c => c.split('(t.length?').join('(t.forEach?'),
  },
  {
    name: 'filesystem.class.js (Bug4 静默刷新 + #34 APPS 按钮/GUI 应用全屏启动)',
    path: ['classes', 'filesystem.class.js'],
    expectIn: "this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>'",
    // expectOut = APPS 方法特征串(showAppsLauncher 仅存在于 #34 注入后)。
    // 旧部署版(有 _fsSig、无 showAppsLauncher)→ transform 跑 → Bug4 用 _fsSig 守卫空转、只补 APPS。
    // 已打 #34(有 showAppsLauncher)→ no-op,幂等。
    expectOut: 'showAppsFolder',
    // Bug4 文件浏览器闪烁:对"正在显示的目录"再次 readFS(Enter 同一项 / 刷新)时,
    // 每次都会闪 LOADING 再全量重渲染。修复:1) 开头算 _silent(目标 == 当前 dirpath 且
    // 已有列表);_silent 时跳过 LOADING 显示(静默刷新)。2) 读取完成、渲染前算 _sig
    // (name:type:size 指纹),若 _silent 且指纹与上次一致 → 内容没变,直接返回不重渲染。
    // 避免闪一次还白刷屏。首次进入或跨目录时不 silent,行为不变。
    // #34:CD 按钮旁插 APPS 按钮 + showAppsLauncher/launchFsApp/addFsApp/submitFsAdd 四个方法
    // (注入点 this.selected=[],... 前的逗号赋值链;FS_APPS_METHODS 尾部 `;` 已去,以 `,` 续链)。
    // 重跑时 expectOut(showAppsLauncher)命中 → 整 target 跳过;但"有 _fsSig 无 showAppsLauncher"
    // 的旧部署版会重跑,故 Bug4 两步必须用 _fsSig 守卫、APPS 两步用自身锚点(FS_APPS_BTN/
    // FS_APPS_METHODS)守卫,全部防二次注入(transform 幂等)。
    transform: c => c
      .split("this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>'")
      .join(c.includes('this._fsSig=') ? "this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>'" : "this._silent=e===this.dirpath&&!!this.cwd&&this.cwd.length||(this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>',!1)")
      .split('this.dirpath=t,this.render(this.cwd),this._reading=!1')
      .join(c.includes('this._fsSig=') ? 'this.dirpath=t,this.render(this.cwd),this._reading=!1' : '(this._sig=this.cwd.map(x=>x.name+":"+x.type+":"+(x.size||0)).join("|"),this._silent&&this._sig===this._fsSig?this._reading=!1:(this._fsSig=this._sig,this.dirpath=t,this.render(this.cwd),this._reading=!1))')
      // APPS 三对 swap/insert:modal 版按钮/方法/CSS 换成文件夹版;全新文件直接插文件夹版。
      // insert 守卫必须是「modal 或 folder 任一存在即空转」——modal 文件经过前面的 swap
      // 已变成 folder,若 insert 只查 folder(看的是原始 c)会再插一份,造成重复注入。
      .split(FS_APPS_BTN).join(c.includes(FS_APPS_BTN_NEW) ? FS_APPS_BTN : FS_APPS_BTN_NEW)
      .split(FS_CD_BTN_OLD).join(c.includes(FS_APPS_BTN) || c.includes(FS_APPS_BTN_NEW) ? FS_CD_BTN_OLD : FS_CD_BTN_OLD + FS_APPS_BTN_NEW)
      .split(FS_APPS_METHODS).join(c.includes(FS_APPS_METHODS_FOLDER) ? FS_APPS_METHODS : FS_APPS_METHODS_FOLDER)
      .split(FS_CDT_JOIN).join(c.includes(FS_APPS_METHODS) || c.includes(FS_APPS_METHODS_FOLDER) ? FS_CDT_JOIN : FS_APPS_METHODS_FOLDER + ',' + FS_CDT_JOIN)
      // apps:// 虚拟视图接线:readFS 短路、渲染三分支、cdToTerminal 的 apps:// 守卫。
      .split('"trash://"===e||"network://"===e')
      .join(c.includes('||"apps://"===e') ? '"trash://"===e||"network://"===e' : '"trash://"===e||"network://"===e||"apps://"===e')
      .split('"trash://"===e?this._renderTrashView():this._renderNetworkView()')
      .join(c.includes(':this._renderAppsView()') ? '"trash://"===e?this._renderTrashView():this._renderNetworkView()' : '"trash://"===e?this._renderTrashView():"network://"===e?this._renderNetworkView():this._renderAppsView()')
      .split('this.dirpath&&window.term[window.currentTerm].writelr(')
      .join(c.includes('"apps://"!==this.dirpath&&window.term') ? 'this.dirpath&&window.term[window.currentTerm].writelr(' : 'this.dirpath&&"apps://"!==this.dirpath&&window.term[window.currentTerm].writelr('),
  },
  {
    name: 'filesystem.css (#34 APPS 按钮 + GUI 应用列表样式)',
    path: ['assets', 'css', 'filesystem.css'],
    expectIn: 'button#fs_cd_btn:hover{',
    expectOut: 'div.fs_disp_fs-app{',
    // APPS 按钮样式(CD 按钮上方,bottom 2.8vh)+ 全屏应用列表 modal 行样式。
    // 锚点用 CD 按钮 hover 规则(CleanCSS 压缩态,唯一);重跑时 expectOut 命中 → no-op;
    // transform 自身用 FS_APPS_CSS 守卫,防半态/重跑二次追加(幂等)。
    transform: c => c
      // 先 swap(modal 行样式 → 文件夹行样式),再 insert 守卫(全新文件直接插文件夹版)。
      // insert 守卫同 fs.class:modal 或 folder 任一存在即空转,防 swap 后重复注入。
      .split(FS_APPS_CSS).join(c.includes(FS_APPS_CSS_NEW) ? FS_APPS_CSS : FS_APPS_CSS_NEW)
      .split('button#fs_cd_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}')
      .join(c.includes(FS_APPS_CSS) || c.includes(FS_APPS_CSS_NEW) ? 'button#fs_cd_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}' : 'button#fs_cd_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}' + FS_APPS_CSS_NEW),
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
    name: '_renderer.js (battery centering + widget-layer reset + 光标策略 + SSH 开关 + 管理 Webapps 按钮)',
    path: ['_renderer.js'],
    expectIn: 'document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})',
    // 幂等标记 = SSH 开关补丁后的特征串(13fix 的 cursorTrap 标记不足以判断本 target 是否
    // 打过 14fix 的 SSH 补丁,换用 SSH 专属标记,保证 13fix→14fix 会执行;对 .orig 同样适用)。
    // #29 又换过一次:旧的 cliApps 前缀 'window.cliApps = [ { id: "claude"' 在 27fix(及更早)
    // 部署版上同样命中 → 整 target 误判"already patched"跳过,桥接(CLI_PANEL_CLASS_27)
    // 根本没机会执行。改用当前版专属标记 _cliIcons(仅 f649c0c 起的版本才有):
    //   27fix/原始 → 无 → transform 跑 → 桥接+apply 升级;current → 有 → 跳过(幂等)。
    // #188 再换一次:新增 复制输入框感知,标记换成 COPY 修复的特征串:
    //   旧版(无 settingsDlAdd、无此串)→ transform 跑 → 守卫 axelFmtSpeed=false → 补 #8/#9 + COPY;
    //   已打 #8/#9(有 settingsDlAdd、无此串)→ transform 跑 → 守卫 axelFmtSpeed=true → 只补 COPY;
    //   src 新构建(两者都有)→ no-op,ISO 烘焙不重复注入。
    // #188→v2.1(ssh.socket 修复):标记换成 ssh ssh.socket 命令特征串。
    //   v2 部署版(有 settingsDlAdd、无此串)→ transform 跑 → SSH_OBJ_V2_OLD revert 后补 ssh.socket;
    //   已打 v2.1(有此串)→ no-op,幂等。
    // #34(恒 CliPanel):标记换成新路由特征串。v2/v2.1 部署版是三元路由(enabled 判断),
    //   `null,(window.appmonitorA=new CliPanel` 只存在于恒 CliPanel 新串(前面是 `null,((window`),
    //   故旧部署版必跑 transform(桥接 revert 升级),新构建 no-op。
    expectOut: 'null,(window.appmonitorA=new CliPanel',
    // 合并成一个 target:多个 _renderer.js target 会相互覆盖,必须合并。
    // 1) 电池图标对准:外框 rect x=1 w=25(rx=2,圆角从 x=24 开始),发光条 x=3 w=23*s/100。
    //    满电时条右端到 x=26 插进右圆角、条整体右偏 1 单位。改 21:条右端恰止于 x=24。
    // 2) 末尾追加部件层周期重置(不碰终端,见 APPEND)。
    // 3) 锁屏误触发修复 A:resumeFromSuspend/pm:resume 只恢复 UI,不再锁屏。全屏其它应用
    //    (如 Firefox)会让 Electron 窗口被 occlude → visibilitychange→visible →
    //    resumeFromSuspend → 无条件 lockScreen.engage() → 一回 eDEX 就锁屏(闲置几秒也锁)。
    // 4) 锁屏误触发修复 B:原实现把 pm:suspend 的锁屏改成了空函数(17fix),导致开盖恢复后
    //    不再锁屏(Bug6)。powerMonitor suspend 只在真实休眠前触发(Firefox 遮挡走的是
    //    visibilitychange,不经过 powerMonitor),所以恢复原锁屏 handler 安全:合盖休眠前
    //    锁定,开盖必须先输密码。顺带挂 system-idle 监听:主进程每秒推系统级空闲秒数,
    //    供 idle 检测(修复 C)使用。
    // 5) 锁屏误触发修复 C:idle 检测改用系统级空闲秒数。原来只算 eDEX 窗口自身 DOM 事件
    //    停更时长,焦点在其它窗口(全屏 Firefox)时误判闲置 → 误触发屏保/锁屏。
    // 6) 修复 13:光标策略 —— UI 常显;仅锁屏/屏保激活时闲置自动隐藏(见 CURSOR1_NEW)。
    // 7) 修复 14(v2):SSH 开关(#4)—— 网络分类里的单行开关 + window.ssh + 监听(见 SSH_* 常量)。
    //    v1 的独立 SSH 分区/状态显示/start-stop 由 SSH_SEC_OLD/SSH_OBJ_OLD revert 后换新。
    // 8) 修复 18(Bug8):code 屏保改用虚拟终端 #screensaver_vt 渲染假代码,不写 term[currentTerm]、
    //    不再 preSaverTerm0 序列化、hide/windDown 不 reset 真终端(见 SSVT_* 常量)。
    //    解锁后 CLAUDE 等真终端对话不再被清空。
    transform: c => c
      // #10 幂等 revert:先把上一轮注入的自引用文本还原为旧锚点,再走旧变换+新 apply,保证重跑不叠加。
      // #34:v2 部署态(enabled 三元)先桥接回 pristine,再走常规 revert→apply(v3 态直接走常规 revert)。
      .split(CLI_SETTINGS_V2_OLD).join(CLI_SETTINGS_OLD)
      .split(CLI_FS3_V2_OLD).join(CLI_FS3_OLD)
      .split(CLI_FS4_V2_OLD).join(CLI_FS4_OLD)
      .split(CLI_SETTINGS_NEW).join(CLI_SETTINGS_OLD)
      .split(CLI_FS3_NEW).join(CLI_FS3_OLD)
      .split(CLI_FS4_NEW).join(CLI_FS4_OLD)
      .split(CLIRECUR_OLD).join(CLIRECUR_NEW)
      // #29 桥接:27fix(及更早)部署版含旧 CLI 面板类体(无 aerc/图标),既不匹配下面 revert 的
      // 当前 NEW、也不匹配 apply 的 pristine OLD → 会整段跳过(expectOut 前缀还误判"已打")。
      // 先把它还原成当前类体,revert 就能把整块(类+尾部)还原为 pristine,再正常 apply。
      // #34:先试 27fix 整块(旧类体+三元路由)还原为 pristine;未命中才轮到 v2 整块/类体桥接。
      .split(CLI_PANEL_27_OLD).join(CLI_PANEL_OLD)
      .split(CLI_PANEL_CLASS_27).join(CLI_PANEL_CLASS)
      .split(CLI_PANEL_V2_OLD).join(CLI_PANEL_OLD)
      .split(CLI_PANEL_NEW).join(CLI_PANEL_OLD)
      .split('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})'+APPEND)
      .join('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})')
      .split('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}}),ipc.on("system-idle",(e,s)=>{try{window._sysIdleSec=Number(s)||0}catch(_){}})')
      .join('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}})')
      .split(SSH_SEC_OLD).join(SSH_SEC_ANCHOR)
      .split(SSH_OBJ_OLD).join(SSH_OBJ_ANCHOR)
      .split(CURSOR1_OLD).join(CURSOR1_NEW)
      .split('(23*s/100)').join('(21*s/100)')
      .split('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})')
      .join('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})'+APPEND)
      .split('window.cursorTrap&&window.cursorTrap.show(),window.lockScreen&&!window.lockScreen.active&&!1!==window.settings.lockOnIdle&&String(window.settings.lockCode||"").length>0&&window.lockScreen.engage(),Object.keys(window.term||{})')
      .join('window.cursorTrap&&window.cursorTrap.show(),Object.keys(window.term||{})')
      .split('Object.keys(window.term||{}).forEach(e=>{const t=window.term[e];t&&t.term&&"function"==typeof t.fit&&t.fit()})')
      .join('Object.keys(window.term||{}).forEach(e=>{const t=window.term[e];t&&t.term&&"function"==typeof t.fit&&t.fit(),t&&"function"==typeof t.reconnectNow&&t.reconnectNow()})')
      .split('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}})')
      .join('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}}),ipc.on("system-idle",(e,s)=>{try{window._sysIdleSec=Number(s)||0}catch(_){}})')
      .split('const e=Date.now()-lastActivity,t=window.lockScreen')
      .join('const e=1e3*(window._sysIdleSec>=0?window._sysIdleSec:Math.round((Date.now()-lastActivity)/1e3)),t=window.lockScreen')
      .split(SSH_NET_ANCHOR).join(SSH_NET_ROW)
      // v2.1:部署版(v2)的 window.ssh 是旧命令(只带 ssh),先 revert 回锚点再注入新对象。
      .split(SSH_OBJ_V2_OLD).join(SSH_OBJ_ANCHOR)
      .split(SSH_OBJ_ANCHOR).join(SSH_OBJ_NEW)
      // #31 屏保触发前关闭全部 modal(仅闲置触发路径;startScreensaver 已有此逻辑)。
      .split(SSMODAL_OLD).join(SSMODAL_NEW)
      .split(AM_ROW_OLD).join(AM_ROW_NEW)
      .split(SSH_WIRE_NEW_OLD).join(SSH_WIRE_ANCHOR)
      .split(SSVT_VAR_OLD).join(SSVT_VAR_NEW)
      .split(SSVT_I_OLD).join(SSVT_I_NEW)
      .split(SSVT_SHOW_OLD).join(SSVT_SHOW_NEW)
      .split(SSVT_HIDE_OLD).join(SSVT_HIDE_NEW)
      .split(SSVT_HIDE2_OLD).join(SSVT_HIDE2_NEW)
      .split(SSVT_WIND_OLD).join(SSVT_WIND_NEW)
      .split(SSVT_RESUME_OLD).join(SSVT_RESUME_NEW)
      // #10 追加 apply(在旧变换之后;CLI_SETTINGS/FS3/FS4/PANEL 是自引用对,需配合顶部 revert)
      .split(CLI_SETTINGS_OLD).join(CLI_SETTINGS_NEW)
      .split(CLI_SAVE_OLD).join(CLI_SAVE_NEW)
      .split(CLI_FS3_OLD).join(CLI_FS3_NEW)
      .split(CLI_FS4_OLD).join(CLI_FS4_NEW)
      .split(TAB2_SPAWN_OLD).join(TAB2_SPAWN_NEW)
      .split(TAB2_CLOSE_OLD).join(TAB2_CLOSE_NEW)
      .split(TAB2_HTML_OLD).join(TAB2_HTML_NEW)
      .split(TAB2_FB_OLD).join(TAB2_FB_NEW)
      .split(CLI_PANEL_OLD).join(CLI_PANEL_NEW)
      // #19:tab1 EMPTY→TERM 统一成普通终端(三处独立锚点,均带上下文唯一)
      .split(TAB_MAP_OLD).join(TAB_MAP_NEW)
      .split(TAB1_HTML_OLD).join(TAB1_HTML_NEW)
      .split(TAB1_CLOSE_OLD).join(TAB1_CLOSE_NEW)
      // #27:tab2 标签补 "#3 - " 前缀(根因见常量定义;y 函数与 rememberProc 两处)
      .split(TAB2_LABEL_Y_OLD).join(TAB2_LABEL_Y_NEW)
      .split(TAB2_REMEMBER_OLD).join(TAB2_REMEMBER_NEW)
      .split(SVT_OLD).join(SVT_NEW).split(I_OLD).join(I_NEW)
      // #8 AXEL + #9 CLASH 增强注入(顺序约束:clash-methods 必须先于 axel-obj;wire 已在上方 revert,此处新 apply)。
      // 幂等:目标级 expectOut 换成新标记后,已打 #8/#9 的部署版会被判为"需打"而整链重跑;
      // 若直接注入,axelFmtSpeed 等会二次声明(renderer 挂掉)。故每个 join 目标按 c.includes('axelFmtSpeed')
      // 守卫:已含标记(= 已打 #8/#9)→ 原地 join 回旧锚点(no-op);无标记(pristine / 27fix 旧版)→ 注入新代码。
      .split(CLASH_OBJ_CLOSE_OLD).join(c.includes('axelFmtSpeed') ? CLASH_OBJ_CLOSE_OLD : CLASH_OBJ_CLOSE_NEW)
      .split(IPCON_CLASHLOG).join(c.includes('axelFmtSpeed') ? IPCON_CLASHLOG : AXEL_OBJ_NEW + IPCON_CLASHLOG)
      .split(DL_OLD).join(c.includes('axelFmtSpeed') ? DL_OLD : DL_NEW)
      .split(CLASH_MODE_ANCHOR).join(c.includes('axelFmtSpeed') ? CLASH_MODE_ANCHOR : CLASH_MODE_ROW)
      .split(CLASH_GROUPS_ANCHOR).join(c.includes('axelFmtSpeed') ? CLASH_GROUPS_ANCHOR : CLASH_GROUPS_ROWS)
      .split(REFRESH_CTRL_OLD).join(c.includes('axelFmtSpeed') ? REFRESH_CTRL_OLD : REFRESH_CTRL_NEW)
      .split(WSF_OLD).join(c.includes('axelFmtSpeed') ? WSF_OLD : WSF_NEW)
      .split(SSH_WIRE_ANCHOR).join(c.includes('axelFmtSpeed') ? SSH_WIRE_ANCHOR : SSH_WIRE_NEW)
      // #188:复制输入框感知(锚点被消费,重跑不再叠加)。
      .split(FS_COPY_OLD).join(FS_COPY_NEW),
  },
  {
    name: 'appmonitorPanel.class.js (#3 apps 态:默认应用列表,不含 Firefox,加 WEBAPPS 管理)',
    path: ['classes', 'appmonitorPanel.class.js'],
    expectIn: AM_ADDR_OLD,
    expectOut: 'this._appendWaEntry()',
    // tab4/5 应用列表:1) native 过滤掉系统应用(只留 appimage:/custom:/demo:);
    //   2) init 不再回退选第一个 native(Firefox),无已保存选择时 500ms 后自动弹出应用菜单;
    //   3) 菜单 "+ ADD APP" 下加 WEBAPPS 管理入口;4) 新增 openAppList/manageWebapps 等方法。
    // Bug7 TAB 标签:每次 _fetchStatus 刷新 runningApps/runningStates 后,把 labelEl 文本
    // 校正为当前状态——已选且在跑 → 该应用名;否则第一个正在运行的应用名;都没有 →
    // 默认 "MONITOR A"/"MONITOR B"(用户要求,不要长标签)。init 从 localStorage 恢复的
    // 旧选择(Firefox)即使被 select() 写了名字,下一次 _fetchStatus(≤3s)也会校正回来。
    transform: c => c
      .split(AM_FILTER_OLD).join(AM_FILTER_NEW)
      .split(AM_SEL_OLD).join(AM_SEL_NEW)
      .split(AM_INITTAIL_OLD).join(AM_INITTAIL_NEW)
      .split(AM_ADDR_OLD).join(AM_ADDR_NEW)
      .split(AM_LBL_OLD).join(AM_LBL_NEW)
      .split(AM_METHODS_OLD).join(AM_METHODS_NEW),
  },
  {
    name: 'main_shell.css (appmonitor 应用列表菜单样式)',
    path: ['assets', 'css', 'main_shell.css'],
    expectIn: '.xterm:not(.enable-mouse-events){cursor:text}',
    // expectOut 用焦点环消除规则做标记:已注入新版(含 :focus outline:none)才跳过;
    // 旧版(.appmonitor_menu{position:fixed 开头)或 pristine 都会重新走 revert→apply。
    expectOut: '.appmonitor_menu:focus{outline:none}',
    // 原 asar 没有任何 appmonitor_menu 样式(菜单裸排),追加一套主题化样式(锚在文件末尾最后一条规则后)。
    // 重跑时先 revert 掉旧注入块(旧版 AM_CSS_OLD 或当前 AM_CSS 均可回滚),再注入最新版,避免重复堆积。
    transform: c => c
      .split('.xterm:not(.enable-mouse-events){cursor:text}' + AM_CSS).join('.xterm:not(.enable-mouse-events){cursor:text}')
      .split('.xterm:not(.enable-mouse-events){cursor:text}' + AM_CSS_OLD).join('.xterm:not(.enable-mouse-events){cursor:text}')
      .split('.xterm:not(.enable-mouse-events){cursor:text}')
      .join('.xterm:not(.enable-mouse-events){cursor:text}' + AM_CSS),
  },
  {
    name: 'mod_toplist.css (top processes NAME 列缩短,数字右对齐)',
    path: ['assets', 'css', 'mod_toplist.css'],
    expectIn: 'table#mod_toplist_table td:nth-child(2){max-width:7vw;min-width:7vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    expectOut: 'table#mod_toplist_table td:nth-child(2){max-width:5vw',
    // #17 用户反馈 top processes 的数值太靠右、不协调。原 NAME 列 7vw(≈134px)太宽,
    // 长进程名把 CPU/MEM 推到右缘。缩短 NAME 列到 5vw 并给 PID 列定宽(避免 auto 列把
    // 多余空间吸收走),CPU/MEM 保持右对齐 → 表格紧凑、数字位置整齐。
    transform: c => c
      .split('table#mod_toplist_table td:nth-child(2){max-width:7vw;min-width:7vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
      .join('table#mod_toplist_table td:nth-child(1){max-width:4.2vw;min-width:4.2vw}table#mod_toplist_table td:nth-child(2){max-width:5vw;min-width:5vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'),
  },
  {
    name: 'mod_sysinfo.css (LOAD/UPTIME/TYPE/POWER 间距均匀不裁切)',
    path: ['assets', 'css', 'mod_sysinfo.css'],
    expectIn: 'div#mod_sysinfo div{height:100%;box-sizing:border-box;padding:.925vh .46vh;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-around}',
    expectOut: 'align-items:center;justify-content:space-around;text-align:center',
    // #17 用户反馈左上 LOAD/UPTIME/TYPE/POWER 的 POWER 字母 r 有一半被裁掉。
    // 根因:flex 容器 justify-content:space-between + 子项 min-width:auto,总宽超出时
    // 末列溢出被裁。改为四列 flex:1 1 0;min-width:0(等宽均分,永不溢出),并收紧水平内边距。
    // #18 用户反馈 UPTIME 的 E 与 TYPE 的 T 重叠:等宽列下 6 字符 UPTIME(字号 12px+字距 1px)
    // ≈43px 仍挤。进一步缩小字号 1.111vh→1.0vh、字距 .092vh→.04vh、列 padding .25vh→.1vh。
    // #19 用户反馈四个单词间距不均:等宽列+左对齐下 单词间距=列宽−词宽,UPTIME(6字符)撑满
    // 自己那列 → 与 TYPE 粘连(真机 OCR "UPTIMETYPE"),LOAD/POWER 又留出大空隙。
    // 改为:子项自然宽度 flex:0 1 auto(不再等宽均分)+ 容器 justify-content:space-evenly
    // (间隙/边距等分,所有间距=同一值)+ 内容居中 align-items:center(抵消子项内 label/value
    // 宽度差) → 四个单词间距均匀(实测约 27/27/26px,值行 23px 均匀)。min-width:0 保留兜底防溢出。
    transform: c => c
      .split('div#mod_sysinfo{position:relative;display:flex;flex-direction:row;align-items:center;justify-content:space-between;height:5.556vh;border-top:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.3);font-size:1.111vh;font-family:var(--font_main_light);letter-spacing:.092vh}')
      .join('div#mod_sysinfo{position:relative;display:flex;flex-direction:row;align-items:center;justify-content:space-evenly;height:5.556vh;border-top:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.3);font-size:1.0vh;font-family:var(--font_main_light);letter-spacing:.04vh}')
      .split('div#mod_sysinfo div{height:100%;box-sizing:border-box;padding:.925vh .46vh;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-around}')
      .join('div#mod_sysinfo div{height:100%;box-sizing:border-box;padding:.925vh .1vh;flex:0 1 auto;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:space-around;text-align:center}'),
  },
  {
    name: '_i18n.js (SSH 设置文案 + appmonitor Webapps 文案)',
    path: ['_i18n.js'],
    expectIn: '"settings.cat.updates":"更新",',
    // v2 SSH 文案特征串:默认关闭 help(旧部署无此文案 → 本 target 会执行并换掉 v1 的 status/running/stopped)。
    expectOut: '需要从其它设备远程连到本机时打开',
    // 新增 SSH 设置分区的中英文案(挂在 updates 分类键后;对象里键顺序无关紧要)。
    // #3 再加 appmonitor.webapps.* 文案,锚在前一步刚插入的 ssh.stopped 键上(链式,
    // 必须在同一 transform 里按序执行;对未打 SSH 补丁的镜像也能一次到位)。
    transform: c => c
      // #8/#9 重写 + 14fix→v2 SSH 文案:revert(先 v2 全块,再 v1 全块/局部块,再 v2 局部块)→ apply(v2 全块)。
      // v1 部署态含旧 SSH 文案(status/running/stopped),必须用 *_OLD 块 revert 回 updates 键,否则残留。
      .split(ZH_FULL).join('"settings.cat.updates":"更新",')
      .split(EN_FULL).join('"settings.cat.updates":"Updates",')
      .split(ZH_FULL_OLD).join('"settings.cat.updates":"更新",')
      .split(EN_FULL_OLD).join('"settings.cat.updates":"Updates",')
      .split(ZH_PARTIAL).join('"settings.cat.updates":"更新",')
      .split(EN_PARTIAL).join('"settings.cat.updates":"Updates",')
      .split(ZH_PARTIAL_OLD).join('"settings.cat.updates":"更新",')
      .split(EN_PARTIAL_OLD).join('"settings.cat.updates":"Updates",')
      .split('"settings.cat.updates":"更新",').join(ZH_FULL)
      .split('"settings.cat.updates":"Updates",').join(EN_FULL),
  },
  {
    name: 'cpuinfo.class.js (#12 CPU 型号超负荷红光闪烁)',
    path: ['classes', 'cpuinfo.class.js'],
    expectIn: '<h1>CPU USAGE<i>${s}</i></h1>',
    expectOut: 'mod_cpuinfo_model',
    // #12:CPU 平均 load ≥90% 时,左上 CPU 型号文字柔和红光闪烁(勿刺眼)。
    // 给型号 <i> 加 id,并在 updateCPUload(每 500ms 刷新 Avg. X%)里按平均负载切 class。
    transform: c => c
      .split('<h1>CPU USAGE<i>${s}</i></h1>')
      .join('<h1>CPU USAGE<i id="mod_cpuinfo_model">${s}</i></h1>')
      .split('document.getElementById(`mod_cpuinfo_usagecounter${i}`).innerText=`Avg. ${t[i]}%`}catch(e){}}),this.updatingCPUload=!1')
      .join('document.getElementById(`mod_cpuinfo_usagecounter${i}`).innerText=`Avg. ${t[i]}%`}catch(e){}}),(()=>{try{var _m=0,_el=document.getElementById("mod_cpuinfo_model");t.forEach(function(_v){_m=Math.max(_m,_v)}),t.length&&_el&&(_m>=90?_el.classList.add("edex_overload"):_el.classList.remove("edex_overload"))}catch(_){}}),this.updatingCPUload=!1'),
  },
  {
    name: 'ramwatcher.class.js (#12 MEMORY USING 超负荷红光闪烁)',
    path: ['classes', 'ramwatcher.class.js'],
    expectIn: 'document.getElementById("mod_ramwatcher_info").innerText=`USING ${i} OUT OF ${r} GiB`',
    expectOut: '_m.classList.add("edex_overload")',
    // #12:内存占用 ≥90%(used/total)时 MEMORY 行文字红光闪烁(每 1.5s 刷新)。
    transform: c => c
      .split('document.getElementById("mod_ramwatcher_info").innerText=`USING ${i} OUT OF ${r} GiB`')
      .join('document.getElementById("mod_ramwatcher_info").innerText=`USING ${i} OUT OF ${r} GiB`,(()=>{try{var _m=document.getElementById("mod_ramwatcher_info");_m&&(r>0&&i/r>=.9?_m.classList.add("edex_overload"):_m.classList.remove("edex_overload"))}catch(_){}})()'),
  },
  {
    name: 'conninfo.class.js (#12 NETWORK UP/DOWN 高流量红光闪烁)',
    path: ['classes', 'conninfo.class.js'],
    expectIn: 'this.current.innerText="UP "+parseFloat(t[0].tx_sec/125e3).toFixed(2)+" DOWN "+parseFloat(t[0].rx_sec/125e3).toFixed(2)',
    expectOut: 'this.current.classList',
    // #12:UP 或 DOWN 瞬时速率 ≥10 MB/s(≈80Mbps)视为高流量,NETWORK 行文字红光闪烁(每 1s 刷新)。
    transform: c => c
      .split('this.current.innerText="UP "+parseFloat(t[0].tx_sec/125e3).toFixed(2)+" DOWN "+parseFloat(t[0].rx_sec/125e3).toFixed(2)')
      .join('this.current.innerText="UP "+parseFloat(t[0].tx_sec/125e3).toFixed(2)+" DOWN "+parseFloat(t[0].rx_sec/125e3).toFixed(2),(()=>{try{var _u=parseFloat(t[0].tx_sec/125e3),_d=parseFloat(t[0].rx_sec/125e3);(_u>=10||_d>=10)?this.current.classList.add("edex_overload"):this.current.classList.remove("edex_overload")}catch(_){}})()'),
  },
  {
    name: 'mod_cpuinfo.css (#12 CPU 型号红光闪烁样式)',
    path: ['assets', 'css', 'mod_cpuinfo.css'],
    expectIn: 'div#mod_cpuinfo canvas{width:76%;height:4.167vh;border-top:.092vh dashed rgba(var(--color_r),var(--color_g),var(--color_b),.3);border-bottom:.092vh dashed rgba(var(--color_r),var(--color_g),var(--color_b),.3);margin:.46vh 0}',
    expectOut: 'edex_overload_flash',
    transform: c => c
      .split('div#mod_cpuinfo canvas{width:76%;height:4.167vh;border-top:.092vh dashed rgba(var(--color_r),var(--color_g),var(--color_b),.3);border-bottom:.092vh dashed rgba(var(--color_r),var(--color_g),var(--color_b),.3);margin:.46vh 0}')
      .join('div#mod_cpuinfo canvas{width:76%;height:4.167vh;border-top:.092vh dashed rgba(var(--color_r),var(--color_g),var(--color_b),.3);border-bottom:.092vh dashed rgba(var(--color_r),var(--color_g),var(--color_b),.3);margin:.46vh 0}div#mod_cpuinfo i.edex_overload{color:rgba(255,90,90,.9);opacity:1;animation:edex_overload_flash 1.2s ease-in-out infinite}@keyframes edex_overload_flash{0%,100%{color:rgba(255,90,90,.9);opacity:1}50%{color:rgba(255,90,90,.3);opacity:.45}}'),
  },
  {
    name: 'mod_ramwatcher.css (#12 MEMORY 红光闪烁样式)',
    path: ['assets', 'css', 'mod_ramwatcher.css'],
    expectIn: 'h3#mod_ramwatcher_swaptext{font-style:normal;font-size:1.3vh;line-height:1.5vh;opacity:.5;margin:0;white-space:nowrap;align-self:center;text-align:right}',
    expectOut: 'edex_overload_flash',
    transform: c => c
      .split('h3#mod_ramwatcher_swaptext{font-style:normal;font-size:1.3vh;line-height:1.5vh;opacity:.5;margin:0;white-space:nowrap;align-self:center;text-align:right}')
      .join('h3#mod_ramwatcher_swaptext{font-style:normal;font-size:1.3vh;line-height:1.5vh;opacity:.5;margin:0;white-space:nowrap;align-self:center;text-align:right}div#mod_ramwatcher_inner>h1:first-child>i.edex_overload{color:rgba(255,90,90,.9);opacity:1;animation:edex_overload_flash 1.2s ease-in-out infinite}@keyframes edex_overload_flash{0%,100%{color:rgba(255,90,90,.9);opacity:1}50%{color:rgba(255,90,90,.3);opacity:.45}}'),
  },
  {
    name: 'mod_conninfo.css (#12 NETWORK 红光闪烁样式)',
    path: ['assets', 'css', 'mod_conninfo.css'],
    expectIn: 'div#mod_conninfo.offline h3:last-child{opacity:1}',
    expectOut: 'edex_overload_flash',
    transform: c => c
      .split('div#mod_conninfo.offline h3:last-child{opacity:1}')
      .join('div#mod_conninfo.offline h3:last-child{opacity:1}div#mod_conninfo i.edex_overload{color:rgba(255,90,90,.9);opacity:1;animation:edex_overload_flash 1.2s ease-in-out infinite}@keyframes edex_overload_flash{0%,100%{color:rgba(255,90,90,.9);opacity:1}50%{color:rgba(255,90,90,.3);opacity:.45}}'),
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
