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
# macOS 自带 readlink 无 -f,且对不存在的文件不解析(exit 1 → set -e 秒退);
# 用 python3 os.path.realpath 跨平台(脚本本就依赖 python3 定位 squashfs)。
RP() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
SRC="$(RP "$SRC")"
if [[ -n "${2:-}" ]]; then OUT="$(RP "$2")"; else OUT="${SRC%.AppImage}.patched.AppImage"; fi

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
// v2.2(可靠性修复):refreshStatus 改查 `is-active ssh.socket`(真正的 :22 监听者)而非
//   `is-active ssh`。socket 激活下 ssh.service 空闲即 inactive,原查法让开关误显示 OFF。
//   SSH_OBJ_NEW_OLD(v2.1 版对象,仍查 ssh.service)revert 回锚点后再注入新 SSH_OBJ_NEW(v2.2)。
//   注意锚点里 minified 源是字面 `\n`(反斜杠+n),故 JS 字符串写 \\n;行内容用单引号+
//   字符串拼接(不用 `${}`,避免模板插值),与 APPEND 同风格。
//   新注入串以 btDevices 行尾结尾,注入后 SSH_NET_ANCHOR 被消费,重跑安全 no-op。
const SSH_SEC_ANCHOR = '},{id:"network",titleKey:"settings.cat.network",html:()=>{';
// v1 独立 SSH 分类(14fix 旧版注入),重跑时 revert 回锚点;对 pristine/current 是 no-op。
const SSH_SEC_OLD = `},{id:"ssh",titleKey:"settings.cat.ssh",html:()=>[o("settings.cat.ssh"),n("settings.ssh.status",'<span id="settingsSshStatus" class="settings_net_status">–</span>'),n("settings.ssh.enabled",'<select id="settingsSshEnabled">\\n                <option value="1" selected>'+t("settings.network.on")+'</option>\\n                <option value="0">'+t("settings.network.off")+'</option>\\n            </select>',"settings.ssh.enabled.help")].join("")},{id:"network",titleKey:"settings.cat.network",html:()=>{`;
// v2:网络分类末尾(btDevices 行后、数组 `]` 前)插 SSH 小节 + 一行开关,默认关。
// v2.2:默认翻到开(SSH 开机默认打开):SSH_NET_ROW_OLD(默认关,当前部署)revert 回锚点,
//   SSH_NET_ROW(默认开,新目标)从锚点注入,重跑收敛。
const SSH_NET_ANCHOR = '"settings.network.btDevices.help")].join("")}},{id:"clash",titleKey:"settings.cat.clash",html:()=>{';
const SSH_NET_ROW_OLD = `"settings.network.btDevices.help"),o("settings.cat.ssh"),n("settings.ssh.enabled",'<select id="settingsSshEnabled">\\n                <option value="1">'+t("settings.network.on")+'</option>\\n                <option value="0" selected>'+t("settings.network.off")+'</option>\\n            </select>',"settings.ssh.enabled.help")].join("")}},{id:"clash",titleKey:"settings.cat.clash",html:()=>{`;
const SSH_NET_ROW = `"settings.network.btDevices.help"),o("settings.cat.ssh"),n("settings.ssh.enabled",'<select id="settingsSshEnabled">\\n                <option value="1" selected>'+t("settings.network.on")+'</option>\\n                <option value="0">'+t("settings.network.off")+'</option>\\n            </select>',"settings.ssh.enabled.help")].join("")}},{id:"clash",titleKey:"settings.cat.clash",html:()=>{`;
// 注:minified 源里 clash-log 的 ipc.on 结尾是 `...n.scrollHeight)});`(scrollHeight 后有个 `)`),
// 后面紧跟版本比较器 `const v=(e,t)=>{const n=(e||"").replace`。锚在该唯一转移处,在其间插入 window.ssh。
const SSH_OBJ_ANCHOR = ');const v=(e,t)=>{const n=(e||"").replace';
// v1 window.ssh(带 status 显示 + start/stop),重跑时 revert 回锚点。
const SSH_OBJ_OLD = ');window.ssh={status:null,refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh").then(e=>{this.status=e;const n=document.getElementById("settingsSshStatus"),o=document.getElementById("settingsSshEnabled"),a=e.ok&&"active"===(e.out||"").trim();n&&(n.textContent=a?t("settings.ssh.running"):t("settings.ssh.stopped"));o&&(o.value=a?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"start":"stop";window.sysCmd.run("sudo -n systemctl "+a+" ssh").then(()=>{this.refreshStatus()})}};const v=(e,t)=>{const n=(e||"").replace';
// v2(本行)= 已部署的 v2 版 window.ssh(只回填开关,但命令只带 ssh 单 unit):重跑时 revert 回锚点。
const SSH_OBJ_V2_OLD = ');window.ssh={refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh").then(e=>{const o=document.getElementById("settingsSshEnabled");o&&(o.value=e.ok&&"active"===(e.out||"").trim()?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"enable --now":"disable --now";window.sysCmd.run("sudo -n systemctl "+a+" ssh").then(()=>{this.refreshStatus()}).catch(()=>{})}};const v=(e,t)=>{const n=(e||"").replace';
// v2.1(本行)= 已部署版:开关命令已带 ssh.socket,但 refreshStatus 仍查 `is-active ssh`。
// Ubuntu 24.04 的 sshd 是 socket 激活,空闲时 ssh.service 是 inactive → 开关误显示 OFF。
// 重跑时先 revert 回锚点,再注入 v2.2。
const SSH_OBJ_NEW_OLD = ');window.ssh={refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh").then(e=>{const o=document.getElementById("settingsSshEnabled");o&&(o.value=e.ok&&"active"===(e.out||"").trim()?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"enable --now":"disable --now";window.sysCmd.run("sudo -n systemctl "+a+" ssh ssh.socket").then(()=>{this.refreshStatus()}).catch(()=>{})}};const v=(e,t)=>{const n=(e||"").replace';
// v2.2 = 可靠性修复:refreshStatus 改查 `is-active ssh.socket`(真正的 :22 监听者)。
// 与 src/_renderer.js 的 window.ssh 保持一致。Ubuntu 24.04 的 sshd 是 socket 激活,
// ssh.service 只在有连接时才 active,查它会误报 inactive(开关显示 OFF 但 SSH 实际可用)。
// v2.3 起降级为 revert 桥接(部署态,开关命令仍带 ssh 双 unit)。
const SSH_OBJ_V23_OLD = ');window.ssh={refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh.socket").then(e=>{const o=document.getElementById("settingsSshEnabled");o&&(o.value=e.ok&&"active"===(e.out||"").trim()?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"enable --now":"disable --now";window.sysCmd.run("sudo -n systemctl "+a+" ssh ssh.socket").then(()=>{this.refreshStatus()}).catch(()=>{})}};const v=(e,t)=>{const n=(e||"").replace';
// v2.3(本行)= socket-only 开关:命令只动 ssh.socket,不再带 ssh 双 unit。
// 安装脚本只 enable ssh.socket(ssh.service 保持 disabled);若开关仍 enable 两个 unit,
// 开机 ssh.socket 先占 :22,ssh.service 再绑就 "Address already in use" → 红字 FAILED。
// 与 src/_renderer.js 的 window.ssh(已改 socket-only)保持一致。
const SSH_OBJ_NEW = ');window.ssh={refreshStatus(){window.sysCmd.run("sudo -n systemctl is-active ssh.socket").then(e=>{const o=document.getElementById("settingsSshEnabled");o&&(o.value=e.ok&&"active"===(e.out||"").trim()?"1":"0")}).catch(()=>{})},applyEnabled(){const e=document.getElementById("settingsSshEnabled");if(!e)return;const a="1"===e.value?"enable --now":"disable --now";window.sysCmd.run("sudo -n systemctl "+a+" ssh.socket").then(()=>{this.refreshStatus()}).catch(()=>{})}};const v=(e,t)=>{const n=(e||"").replace';
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
// v2.2 SSH 文案:SSH 默认开启(开机默认打开),help 改为"默认开启"。
const ZH_SSH_NEW = "\"settings.cat.ssh\":\"SSH 远程登录\",\"settings.ssh.enabled\":\"SSH 服务\",\"settings.ssh.enabled.help\":\"启用/停用 OpenSSH 服务器(sshd)。默认开启;不需要时可在这里关掉。\",";
const EN_SSH_NEW = "\"settings.cat.ssh\":\"SSH\",\"settings.ssh.enabled\":\"SSH service\",\"settings.ssh.enabled.help\":\"Start/stop the OpenSSH server (sshd). On by default; turn it off here when not needed.\",";
// 派生 i18n 全块/局部块(匹配真实部署态:updates + SSH块 + APP块 连续)
// v2 全块(含 v2 SSH 文案):当前部署最终形态;revert 时锚回 updates 键。
const ZH_FULL = '"settings.cat.updates":"更新",' + ZH_SSH + ZH_APP + ZH_AXEL + ZH_CLASH;
const EN_FULL = '"settings.cat.updates":"Updates",' + EN_SSH + EN_APP + EN_AXEL + EN_CLASH;
const ZH_PARTIAL = '"settings.cat.updates":"更新",' + ZH_SSH + ZH_APP;
const EN_PARTIAL = '"settings.cat.updates":"Updates",' + EN_SSH + EN_APP;
// v2.2 全块/局部块(默认开启文案):revert 后从 updates 锚点注入。
const ZH_FULL_NEW = '"settings.cat.updates":"更新",' + ZH_SSH_NEW + ZH_APP + ZH_AXEL + ZH_CLASH;
const EN_FULL_NEW = '"settings.cat.updates":"Updates",' + EN_SSH_NEW + EN_APP + EN_AXEL + EN_CLASH;
const ZH_PARTIAL_NEW = '"settings.cat.updates":"更新",' + ZH_SSH_NEW + ZH_APP;
const EN_PARTIAL_NEW = '"settings.cat.updates":"Updates",' + EN_SSH_NEW + EN_APP;
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
const CLI_PANEL_CLASS_V3 = `window.cliApps = [ { id: "claude", name: "Claude", cmd: ["claude"], icon: "ai" }, { id: "browsh", name: "browsh", cmd: ["browsh", "--startup-url", "https://lite.duckduckgo.com/lite"], icon: "browser" }, { id: "aerc", name: "aerc", cmd: ["aerc"], icon: "mail" }, { id: "htop", name: "htop", cmd: ["htop"], icon: "monitor" }, { id: "btop", name: "BTOP", cmd: ["btop"], icon: "monitor" } ]; try { const _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); if (Array.isArray(_u)) _u.forEach(_a => { if (_a && _a.cmd && _a.cmd[0] && !window.cliApps.some(_x => _x.id === _a.id)) window.cliApps.push({ id: _a.id, name: _a.name || _a.cmd[0], cmd: _a.cmd }); }); } catch (_) {} const _cliIcons={ai:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',browser:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',monitor:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',mail:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',terminal:'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'}; (function(){try{var _s=document.createElement("style");_s.id="edex_cli_css";_s.textContent=".cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}";document.head.appendChild(_s)}catch(_){}})(); class CliPanel { constructor(o) { this.container = document.getElementById(o.parentId); this.monitorId = o.monitorId; this.labelEl = document.getElementById(o.labelId); this.selected = null; this.sessions = {}; this._spawning = false; this.menuFocusIdx = -1; this.menu = document.createElement("div"); this.menu.className = "webapp_menu appmonitor_menu"; this.menu.id = "appmonitor_menu_" + this.monitorId; this.menu.style.display = "none"; this.menu.setAttribute("tabindex", "-1"); document.body.appendChild(this.menu); const _t = this; document.addEventListener("click", e => { if (!_t.menu || _t.menu.style.display === "none") return; const _i = e.target && e.target.closest && (e.target.closest("#appmonitor_menu_" + _t.monitorId) || e.target.closest(".webapp_chevron")); if (!_i) _t.closeMenu(); }); this.menu.addEventListener("keydown", e => { const _o = _t.menu.querySelectorAll(".appmonitor_opt"); if (!_o.length) return; e.stopPropagation(); if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx + 1); } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); _t._focusMenu(_t.menuFocusIdx - 1); } else if (e.key === "Enter") { e.preventDefault(); const _x = _o[_t.menuFocusIdx]; if (_x) _x.click(); } else if (e.key === "Escape") { e.preventDefault(); _t.closeMenu(); } }); if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; } focus() { if (this.selected && this.sessions[this.selected.id]) { const _s = this.sessions[this.selected.id]; Object.keys(this.sessions).forEach(_k => { const _e = this.sessions[_k].el; if (_e) _e.classList.toggle("active", _k === this.selected.id); }); if (_s.term && _s.term.term && _s.term.term.focus) _s.term.term.focus(); } } activate() { this.focus(); } toggleMenu(ev) { if (ev) ev.stopPropagation(); if (!this.menu) return; if (this.menu.style.display === "none") { if (ev && ev.currentTarget) { const _r = ev.currentTarget.getBoundingClientRect(); this.menu.style.left = Math.max(4, _r.left - 20) + "px"; this.menu.style.top = (_r.bottom + 6) + "px"; } this.menu.style.display = "block"; this.menu.focus(); this._renderMenu(); this._focusMenu(0); } else this.closeMenu(); } closeMenu() { if (this.menu) this.menu.style.display = "none"; this.menuFocusIdx = -1; } _focusMenu(i) { const _o = this.menu.querySelectorAll(".appmonitor_opt"); if (!_o.length) return; this.menuFocusIdx = Math.max(0, Math.min(i, _o.length - 1)); _o.forEach((x, j) => { x.classList.toggle("active", j === this.menuFocusIdx); if (j === this.menuFocusIdx) x.scrollIntoView({ block: "nearest" }); }); } _renderMenu() { if (!this.menu) return; this.menu.innerHTML = ""; const _add = document.createElement("div"); _add.className = "webapp_menu_opt appmonitor_opt appmonitor_menu_add"; _add.textContent = "+ ADD APP"; _add.onclick = e => { e.stopPropagation(); this._addApp(); }; this.menu.appendChild(_add); window.cliApps.forEach(_a => { const _opt = document.createElement("div"); const _run = this.sessions[_a.id]; _opt.className = "webapp_menu_opt appmonitor_opt" + (this.selected && this.selected.id === _a.id ? " active" : ""); const _dot = document.createElement("span"); _dot.className = "appmonitor_dot_slot"; if (_run && (_run.starting || _run.term)) { const _d = document.createElement("span"); _d.className = "appmonitor_dot appmonitor_dot_" + (_run.starting ? "starting" : "running"); _dot.appendChild(_d); } _opt.appendChild(_dot); const _ic = document.createElement("span"); _ic.className = "appmonitor_icon_slot"; _ic.innerHTML = _cliIcons[_a.icon] || _cliIcons.terminal; _opt.appendChild(_ic); const _nm = document.createElement("span"); _nm.className = "appmonitor_name"; _nm.textContent = _a.name; _opt.appendChild(_nm); if (_run && _run.term) { const _cl = document.createElement("button"); _cl.className = "webapp_menu_del"; _cl.textContent = "×"; _cl.title = "关闭会话"; _cl.onclick = e => { e.stopPropagation(); this._closeSession(_a.id); }; _opt.appendChild(_cl); } _opt.onclick = e => { e.stopPropagation(); this.select(_a); this.closeMenu(); }; this.menu.appendChild(_opt); }); if (!window.cliApps.length) { const _em = document.createElement("div"); _em.className = "webapp_menu_opt"; _em.textContent = "No apps"; this.menu.appendChild(_em); } } select(_a) { if (!_a) return; this.selected = _a; if (this.labelEl) this.labelEl.textContent = _a.name; this._renderMenu(); if (this.sessions[_a.id]) { this.focus(); return; } if (this._spawning) return; this._startSession(_a); } _startSession(_a) { const _t = this, _sid = _a.id + "_" + Math.floor(1e6 * Math.random()); const _s = { id: _a.id, sid: _sid, starting: true, term: null, el: null }; this.sessions[_a.id] = _s; this._spawning = true; const _box = this.container; if (!_box) return this._abortSpawn(_a); const _el = document.createElement("div"); _el.className = "cli_session"; _el.id = _sid; _box.appendChild(_el); _s.el = _el; _el.classList.add("active"); Object.keys(this.sessions).forEach(_k => { if (_k !== _a.id && this.sessions[_k].el) this.sessions[_k].el.classList.remove("active"); }); ipc.send("ttyspawn", { cli: _a.cmd }); ipc.once("ttyspawn-reply", (e, r) => { this._spawning = false; if (String(r).startsWith("ERROR")) { _s.starting = false; if (_el.parentNode) _el.parentNode.removeChild(_el); delete _t.sessions[_a.id]; _t._renderMenu(); return; } const _port = Number(String(r).substr(9)); let _term = null; try { _term = new Terminal({ role: "client", parentId: _sid, port: _port }); } catch (_e) { _s.starting = false; _t._renderMenu(); return; } _term.onclose = () => { try { if (_term.term && _term.term.dispose) _term.term.dispose(); } catch (_e) {} if (_el.parentNode) _el.parentNode.removeChild(_el); delete _t.sessions[_a.id]; if (_t.selected && _t.selected.id === _a.id && _t.labelEl) _t.labelEl.textContent = "a" === _t.monitorId ? "MONITOR A" : "MONITOR B"; _t._renderMenu(); }; _s.starting = false; _s.term = _term; _t._renderMenu(); }); } _abortSpawn(_a) { this._spawning = false; if (this.sessions[_a.id]) delete this.sessions[_a.id]; if (this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; this._renderMenu(); } _closeSession(_id) { const _s = this.sessions[_id]; if (!_s) return; if (_s.term) { try { if (_s.term.onclose) _s.term.onclose = null; if (_s.term.term && _s.term.term.dispose) _s.term.term.dispose(); } catch (_e) {} } if (_s.el && _s.el.parentNode) _s.el.parentNode.removeChild(_s.el); delete this.sessions[_id]; if (this.selected && this.selected.id === _id && this.labelEl) this.labelEl.textContent = "a" === this.monitorId ? "MONITOR A" : "MONITOR B"; this._renderMenu(); } _addApp() { this.closeMenu(); try { if (window.cliAddModal && window.cliAddModal.close) window.cliAddModal.close(); } catch (_e) {} const _pn = "a" === this.monitorId ? "A" : "B"; window.cliAddModal = new Modal({ type: "custom", title: "ADD APP", html: '<div class="appmonitor_add"><label>启动命令</label><input type="text" id="cli_add_cmd" placeholder="如 btop 或 ncmpcpp" style="width:100%"></div>', buttons: [{ label: "Add", action: "window.cliAddModal&&window.cliAddModal.close();window.appmonitor" + _pn + ".submitCliAdd()" }] }); } submitCliAdd() { const _in = document.getElementById("cli_add_cmd"); if (!_in || !_in.value || !_in.value.trim()) { this._notify("请输入启动命令"); return; } const _c = _in.value.trim().split(/\\s+/), _id = "cli_" + _c[0].replace(/[^a-zA-Z0-9_-]/g, ""); let _u = []; try { _u = JSON.parse(localStorage.getItem("edex_cli_apps") || "[]"); } catch (_e) {} if (!Array.isArray(_u)) _u = []; if (!_u.some(_x => _x.id === _id)) { _u.push({ id: _id, name: _c[0], cmd: _c }); try { localStorage.setItem("edex_cli_apps", JSON.stringify(_u)); } catch (_e) {} window.cliApps.push({ id: _id, name: _c[0], cmd: _c }); } this._notify("已添加 " + _c[0]); this._renderMenu(); } _notify(m) { let _t = document.getElementById("edex_toast"); if (!_t) { _t = document.createElement("div"); _t.id = "edex_toast"; _t.className = "browser_toast"; document.body.appendChild(_t); } _t.textContent = m; _t.classList.add("show"); clearTimeout(this._notifyTimer); this._notifyTimer = setTimeout(() => _t.classList.remove("show"), 2200); } fullscreenButton() {} toggleDevTools() {} }`;
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
const CLI_FS4_V3_OLD = '${""}';
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
// 新加的,尚未部署),所以 CLI_PANEL_V2_OLD 必须用 v2 类体(CLI_PANEL_CLASS_V3 去 td)+ v2 路由,
// 否则 revert 匹配不上(类体逐字不等)→ 三元路由残留、apply 又会在三元 else 分支里二次注入。
const CLI_PANEL_V2_ROUTE = 'window.appmonitorA=window.appmonitorB=null,((window.settings.appMonitor||{}).enabled===!1?(window.appmonitorA=new CliPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new CliPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"})):(window.appmonitorA=new AppMonitorPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new AppMonitorPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"})))';
const CLI_PANEL_V2_OLD = CLI_PANEL_CLASS_V3.split(' toggleDevTools() {} }').join(' }') + CLI_PANEL_V2_ROUTE;
// #34:27fix 部署态(无图标类体 + 同款三元路由)整块 revert,必须在 CLI_PANEL_CLASS_27 桥接之前,
// 否则类体先被桥接成当前版(toggleDevTools 加入)后,类+路由整块常量匹配不上 → 三元残留。
const CLI_PANEL_27_OLD = CLI_PANEL_CLASS_27 + CLI_PANEL_V2_ROUTE;
const CLI_PANEL_V3_OLD = CLI_PANEL_CLASS_V3 + 'window.appmonitorA=window.appmonitorB=null,(window.appmonitorA=new CliPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=new CliPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"}))';

// ---- #36 showGui 实验开关:图标库 + 新 CliPanel 类 + 三元路由 + 条件空心三角 + 设置行/对象 ----
// ICON_LIBRARY_JS / CLI_PANEL_CLASS_NEW 是 terser 压缩产物(iconLibrary.class.js / 改后 cliPanel.class.js,
// 含 _label()=showGui?"CLI APPS":"APP" 与 iconLibrary.get 图标),均无反引号/无 ${},可安全作 backtick 常量。
// 加载顺序:iconLibrary 先定义(菜单渲染异步才执行,时机安全);CLI_PANEL_NEW = 库 + 类 + 路由整块注入。
const ICON_LIBRARY_JS = `const _ic=e=>'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+e+"</svg>";window.iconLibrary={icons:{ai:{name:"AI",svg:_ic('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>')},browser:{name:"Browser",svg:_ic('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')},monitor:{name:"Monitor",svg:_ic('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>')},mail:{name:"Mail",svg:_ic('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>')},terminal:{name:"Terminal",svg:_ic('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>')},git:{name:"Git",svg:_ic('<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>')},python:{name:"Python",svg:_ic('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>')},node:{name:"Node",svg:_ic('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>')},docker:{name:"Docker",svg:_ic('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>')},ssh:{name:"SSH",svg:_ic('<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>')},tmux:{name:"Tmux",svg:_ic('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>')},vim:{name:"Vim",svg:_ic('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>')},database:{name:"Database",svg:_ic('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>')},download:{name:"Download",svg:_ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')},globe:{name:"Globe",svg:_ic('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')},code:{name:"Code",svg:_ic('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>')},server:{name:"Server",svg:_ic('<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>')},package:{name:"Package",svg:_ic('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>')},game:{name:"Game",svg:_ic('<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>')},music:{name:"Music",svg:_ic('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')},video:{name:"Video",svg:_ic('<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>')},image:{name:"Image",svg:_ic('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>')},calculator:{name:"Calculator",svg:_ic('<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>')},folder:{name:"Folder",svg:_ic('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>')},settings:{name:"Settings",svg:_ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')},file:{name:"File",svg:_ic('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>')},wifi:{name:"WiFi",svg:_ic('<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>')},shield:{name:"Shield",svg:_ic('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>')},editor:{name:"Editor",svg:_ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>')},clock:{name:"Clock",svg:_ic('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>')},default:{name:"Default",svg:_ic('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>')}},get(e){const i=this.icons[e];return i?i.svg:null},list(){return Object.keys(this.icons).map(e=>({id:e,name:this.icons[e].name,svg:this.icons[e].svg}))},pickerModal(e){try{window._icPickModal&&window._icPickModal.close&&window._icPickModal.close()}catch(e){}const i=this.list(),a=(e,i,a)=>'<div class="edex_ic_cell '+(a||"")+'" data-idx="'+e+'" onclick="window.iconLibrary._icPick('+e+')">'+i+"</div>",c=i.map((e,i)=>a(i,e.svg,"")).join("")+a(i.length,'<svg class="appmonitor_icon_ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',"edex_ic_none");this._icCb=e,window._icPickModal=new Modal({type:"custom",title:"CHOOSE ICON",html:'<div class="edex_ic_grid" id="edex_ic_grid">'+c+"</div>",buttons:[],closeLabel:"Cancel"});const t=document.getElementById("edex_ic_grid");if(t){const e=t.querySelectorAll(".edex_ic_cell"),i=8;let a=0;const c=i=>{e.length&&(i=Math.max(0,Math.min(i,e.length-1)),e.forEach((e,a)=>e.classList.toggle("active",a===i)),a=i,e[i]&&e[i].scrollIntoView({block:"nearest"}))};c(0),t.setAttribute("tabindex","-1"),t.addEventListener("keydown",t=>{if("ArrowRight"===t.key)t.preventDefault(),c(a+1);else if("ArrowLeft"===t.key)t.preventDefault(),c(a-1);else if("ArrowDown"===t.key)t.preventDefault(),c(a+i);else if("ArrowUp"===t.key)t.preventDefault(),c(a-i);else if("Enter"===t.key){t.preventDefault();const i=e[a];i&&i.click()}else if("Escape"===t.key){t.preventDefault();try{window._icPickModal&&window._icPickModal.close()}catch(e){}}}),t.focus()}},_icPick(e){const i=this.list(),a=e>=0&&e<i.length?i[e].id:null,c=this._icCb;this._icCb=null;try{window._icPickModal&&window._icPickModal.close&&window._icPickModal.close()}catch(e){}c&&c(a)}},function(){try{if(document.getElementById("edex_ic_css"))return;const e=document.createElement("style");e.id="edex_ic_css",e.textContent=".edex_ic_grid{display:grid;grid-template-columns:repeat(8,1fr);gap:1vh;max-height:52vh;overflow-y:auto;padding:1vh 0}.edex_ic_cell{display:flex;align-items:center;justify-content:center;padding:1.3vh;border:.092vh solid rgba(var(--color_r),var(--color_g),var(--color_b),.3);cursor:pointer;transition:background .15s}.edex_ic_cell .appmonitor_icon_ph{width:3.6vh;height:3.6vh;opacity:1}.edex_ic_cell:hover,.edex_ic_cell.active{background:rgba(var(--color_r),var(--color_g),var(--color_b),.28)}.edex_ic_none{opacity:.6}",document.head.appendChild(e)}catch(e){}}();`;
// #58/#50:#36 部署态(#36 已部署,类体 = 本常量原文)→ 桥接锚点,revert 阶段先换成新类体
// (carbonyl + cover session 方法),与 pristine apply 后的 CLI_PANEL_NEW 一致。
const CLI_PANEL_CLASS_NEW_OLD = `const _cliIpc=require("electron").ipcRenderer;window.cliApps=[{id:"claude",name:"Claude",cmd:["claude"],icon:"ai"},{id:"browsh",name:"browsh",cmd:["browsh","--startup-url","https://lite.duckduckgo.com/lite"],icon:"browser"},{id:"aerc",name:"aerc",cmd:["aerc"],icon:"mail"},{id:"htop",name:"htop",cmd:["htop"],icon:"monitor"},{id:"btop",name:"BTOP",cmd:["btop"],icon:"monitor"}];try{const e=JSON.parse(localStorage.getItem("edex_cli_apps")||"[]");Array.isArray(e)&&e.forEach(e=>{e&&e.cmd&&e.cmd[0]&&!window.cliApps.some(t=>t.id===e.id)&&window.cliApps.push({id:e.id,name:e.name||e.cmd[0],cmd:e.cmd,icon:e.icon||null})})}catch(e){}window._cliPickIcon=e=>{const t=document.getElementById("cli_add_icon");t&&(t.value=e||"");const n=document.getElementById("cli_add_icon_btn");n&&(n.textContent=e?"已选: "+e:"选择图标…")},function(){try{const e=document.createElement("style");e.id="edex_cli_css",e.textContent=".cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}",document.head.appendChild(e)}catch(e){}}();class CliPanel{constructor(e){this.container=document.getElementById(e.parentId),this.monitorId=e.monitorId,this.labelEl=document.getElementById(e.labelId),this.selected=null,this.sessions={},this._spawning=!1,this.menuFocusIdx=-1,this.menu=document.createElement("div"),this.menu.className="webapp_menu appmonitor_menu",this.menu.id="appmonitor_menu_"+this.monitorId,this.menu.style.display="none",this.menu.setAttribute("tabindex","-1"),document.body.appendChild(this.menu);const t=this;document.addEventListener("click",e=>{if(!t.menu||"none"===t.menu.style.display)return;e.target&&e.target.closest&&(e.target.closest("#appmonitor_menu_"+t.monitorId)||e.target.closest(".webapp_chevron"))||t.closeMenu()}),this.menu.addEventListener("keydown",e=>{const n=t.menu.querySelectorAll(".appmonitor_opt");if(n.length)if(e.stopPropagation(),"ArrowDown"===e.key||"ArrowRight"===e.key)e.preventDefault(),t._focusMenu(t.menuFocusIdx+1);else if("ArrowUp"===e.key||"ArrowLeft"===e.key)e.preventDefault(),t._focusMenu(t.menuFocusIdx-1);else if("Enter"===e.key){e.preventDefault();const s=n[t.menuFocusIdx];s&&s.click()}else"Escape"===e.key&&(e.preventDefault(),t.closeMenu())}),this.labelEl&&(this.labelEl.textContent=this._label())}_label(){return(window.settings.appMonitor||{}).showGui?"CLI APPS":"APP"}focus(){if(this.selected&&this.sessions[this.selected.id]){const e=this.sessions[this.selected.id];Object.keys(this.sessions).forEach(e=>{const t=this.sessions[e].el;t&&t.classList.toggle("active",e===this.selected.id)}),e.term&&e.term.term&&e.term.term.focus&&e.term.term.focus()}}activate(){this.focus()}toggleMenu(e){if(e&&e.stopPropagation(),this.menu)if("none"===this.menu.style.display){if(e&&e.currentTarget){const t=e.currentTarget.getBoundingClientRect();this.menu.style.left=Math.max(4,t.left-20)+"px",this.menu.style.top=t.bottom+6+"px"}this.menu.style.display="block",this.menu.focus(),this._renderMenu(),this._focusMenu(0)}else this.closeMenu()}closeMenu(){this.menu&&(this.menu.style.display="none"),this.menuFocusIdx=-1}_focusMenu(e){const t=this.menu.querySelectorAll(".appmonitor_opt");t.length&&(this.menuFocusIdx=Math.max(0,Math.min(e,t.length-1)),t.forEach((e,t)=>{e.classList.toggle("active",t===this.menuFocusIdx),t===this.menuFocusIdx&&e.scrollIntoView({block:"nearest"})}))}_renderMenu(){if(!this.menu)return;this.menu.innerHTML="";const e=document.createElement("div");if(e.className="webapp_menu_opt appmonitor_opt appmonitor_menu_add",e.textContent="+ ADD APP",e.onclick=e=>{e.stopPropagation(),this._addApp()},this.menu.appendChild(e),window.cliApps.forEach(e=>{const t=document.createElement("div"),n=this.sessions[e.id];t.className="webapp_menu_opt appmonitor_opt"+(this.selected&&this.selected.id===e.id?" active":"");const s=document.createElement("span");if(s.className="appmonitor_dot_slot",n&&(n.starting||n.term)){const e=document.createElement("span");e.className="appmonitor_dot appmonitor_dot_"+(n.starting?"starting":"running"),s.appendChild(e)}t.appendChild(s);const i=document.createElement("span");i.className="appmonitor_icon_slot",i.innerHTML=window.iconLibrary&&(window.iconLibrary.get(e.icon)||window.iconLibrary.get("terminal"))||"",t.appendChild(i);const o=document.createElement("span");if(o.className="appmonitor_name",o.textContent=e.name,t.appendChild(o),n&&n.term){const n=document.createElement("button");n.className="webapp_menu_del",n.textContent="×",n.title="关闭会话",n.onclick=t=>{t.stopPropagation(),this._closeSession(e.id)},t.appendChild(n)}t.onclick=t=>{t.stopPropagation(),this.select(e),this.closeMenu()},this.menu.appendChild(t)}),!window.cliApps.length){const e=document.createElement("div");e.className="webapp_menu_opt",e.textContent="No apps",this.menu.appendChild(e)}}select(e){e&&(this.selected=e,this.labelEl&&(this.labelEl.textContent=e.name),this._renderMenu(),this.sessions[e.id]?this.focus():this._spawning||this._startSession(e))}_startSession(e){const t=this,n=e.id+"_"+Math.floor(1e6*Math.random()),s={id:e.id,sid:n,starting:!0,term:null,el:null};this.sessions[e.id]=s,this._spawning=!0;const i=this.container;if(!i)return this._abortSpawn(e);const o=document.createElement("div");o.className="cli_session",o.id=n,i.appendChild(o),s.el=o,o.classList.add("active"),Object.keys(this.sessions).forEach(t=>{t!==e.id&&this.sessions[t].el&&this.sessions[t].el.classList.remove("active")}),_cliIpc.send("ttyspawn",{cli:e.cmd}),_cliIpc.once("ttyspawn-reply",(i,l)=>{if(this._spawning=!1,String(l).startsWith("ERROR"))return s.starting=!1,o.parentNode&&o.parentNode.removeChild(o),delete t.sessions[e.id],void t._renderMenu();const d=Number(String(l).substr(9));let c=null;try{c=new Terminal({role:"client",parentId:n,port:d})}catch(e){return s.starting=!1,void t._renderMenu()}c.onclose=()=>{try{c.term&&c.term.dispose&&c.term.dispose()}catch(e){}o.parentNode&&o.parentNode.removeChild(o),delete t.sessions[e.id],t.selected&&t.selected.id===e.id&&t.labelEl&&(t.labelEl.textContent=t._label()),t._renderMenu()},s.starting=!1,s.term=c,t._renderMenu()})}_abortSpawn(e){this._spawning=!1,this.sessions[e.id]&&delete this.sessions[e.id],this.labelEl&&(this.labelEl.textContent=this._label()),this._renderMenu()}_closeSession(e){const t=this.sessions[e];if(t){if(t.term)try{t.term.onclose&&(t.term.onclose=null),t.term.term&&t.term.term.dispose&&t.term.term.dispose()}catch(e){}t.el&&t.el.parentNode&&t.el.parentNode.removeChild(t.el),delete this.sessions[e],this.selected&&this.selected.id===e&&this.labelEl&&(this.labelEl.textContent=this._label()),this._renderMenu()}}_addApp(){this.closeMenu();try{window.cliAddModal&&window.cliAddModal.close&&window.cliAddModal.close()}catch(e){}const e="a"===this.monitorId?"A":"B";window.cliAddModal=new Modal({type:"custom",title:"ADD APP",html:'<div class="appmonitor_add"><label>名称</label><input type="text" id="cli_add_name" placeholder="如 ncmpcpp" style="width:100%"><label>启动命令</label><input type="text" id="cli_add_cmd" placeholder="如 btop 或 ncmpcpp" style="width:100%"><label>图标</label><button type="button" id="cli_add_icon_btn" class="settings_net_btn" onclick="window.iconLibrary&&window.iconLibrary.pickerModal(window._cliPickIcon)">选择图标…</button><input type="hidden" id="cli_add_icon" value=""></div>',buttons:[{label:"Add",action:"window.cliAddModal&&window.cliAddModal.close();window.appmonitor"+e+".submitCliAdd()"}]})}submitCliAdd(){const e=document.getElementById("cli_add_name"),t=document.getElementById("cli_add_cmd"),n=document.getElementById("cli_add_icon");if(!t||!t.value||!t.value.trim())return void this._notify("请输入启动命令");const s=t.value.trim().split(/\s+/),i="cli_"+s[0].replace(/[^a-zA-Z0-9_-]/g,""),o=e&&e.value&&e.value.trim()?e.value.trim():s[0],l=n&&n.value?n.value:null;let d=[];try{d=JSON.parse(localStorage.getItem("edex_cli_apps")||"[]")}catch(e){}if(Array.isArray(d)||(d=[]),!d.some(e=>e.id===i)){d.push({id:i,name:o,cmd:s,icon:l});try{localStorage.setItem("edex_cli_apps",JSON.stringify(d))}catch(e){}window.cliApps.push({id:i,name:o,cmd:s,icon:l})}this._notify("已添加 "+o),this._renderMenu()}_notify(e){let t=document.getElementById("edex_toast");t||(t=document.createElement("div"),t.id="edex_toast",t.className="browser_toast",document.body.appendChild(t)),t.textContent=e,t.classList.add("show"),clearTimeout(this._notifyTimer),this._notifyTimer=setTimeout(()=>t.classList.remove("show"),2200)}fullscreenButton(){}toggleDevTools(){}}`;
const CLI_PANEL_ROUTE_NEW = 'window.appmonitorA=window.appmonitorB=null,(window.appmonitorA=new CliPanel({parentId:"appmonitor_a_slot",monitorId:"a",labelId:"shell_tab3_label"}),window.appmonitorB=(window.settings.appMonitor||{}).showGui?new AppMonitorPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"}):new CliPanel({parentId:"appmonitor_b_slot",monitorId:"b",labelId:"shell_tab4_label"}))';
// ---- #50 Part B:CliPanel cover session 方法(carbonyl 版类体扩展)----
// 镜像 src cliPanel.class.js 的 beginCoverSession/coverTerm/endCoverSession(压缩版)。
// 从 CLI_PANEL_CLASS_NEW_OLD 派生:内建 browsh 换成 carbonyl,类尾 toggleDevTools(){}} 前
// 注入三个 cover 方法(临时 `__cover__` 会话,真 pty `sh -c "stty raw -echo; exec cat"`,
// Terminal wrapper muted:true)。derive 保证新类体与 #36 部署态旧类体逐字兼容,桥接零漂移。
const CLI_COVER_METHODS = `beginCoverSession(){if(this._coverSession||this.sessions.__cover__)return this._coverSession||this.sessions.__cover__;const e=this,n="__cover__";this._coverRestoreSel||(this._coverRestoreSel=this.selected||null),this.selected={id:n,name:"AUTH GATE"};const s={id:n,sid:n,starting:!0,term:null,el:null,cover:!0};this.sessions[n]=s;const i=this.container,o=document.createElement("div");o.className="cli_session",o.id=n,i.appendChild(o),o.classList.add("active"),Object.keys(this.sessions).forEach(e=>{e!==n&&this.sessions[e].el&&this.sessions[e].el.classList.remove("active")}),_cliIpc.send("ttyspawn",{cli:["sh","-c","stty raw -echo; exec cat"]}),_cliIpc.once("ttyspawn-reply",(i,r)=>{if(String(r).startsWith("ERROR"))return s.starting=!1,o.parentNode&&o.parentNode.removeChild(o),delete e.sessions[n],void(e._coverSession=null);const d=Number(String(r).substr(9));let c=null;try{c=new Terminal({role:"client",parentId:n,port:d,muted:!0})}catch(e){return s.starting=!1,void(e._coverSession=null)}c.onclose=()=>{try{c.term&&c.term.dispose&&c.term.dispose()}catch(e){}o.parentNode&&o.parentNode.removeChild(o),delete e.sessions[n],e._coverSession=null},s.starting=!1,s.term=c,e._coverSession=s}),s}coverTerm(){const e=this._coverSession||this.sessions.__cover__||null;return e&&e.term?e.term:null}endCoverSession(){const e=this._coverSession||this.sessions.__cover__||null;if(!e)return;if(e.term)try{e.term.onclose&&(e.term.onclose=null),e.term.socket&&"function"==typeof e.term.socket.close&&e.term.socket.close(),e.term.term&&e.term.term.dispose&&e.term.term.dispose()}catch(e){}e.el&&e.el.parentNode&&e.el.parentNode.removeChild(e.el),delete this.sessions.__cover__,this._coverSession=null,this.selected=this._coverRestoreSel||this.selected,this.selected&&this.selected.id==="__cover__"&&(this.selected=null),this._coverRestoreSel=null,this._renderMenu()}`;
const CLI_PANEL_CLASS_NEW = CLI_PANEL_CLASS_NEW_OLD
  .split('{id:"browsh",name:"browsh",cmd:["browsh","--startup-url","https://lite.duckduckgo.com/lite"],icon:"browser"}')
  // #58:carbonyl bundles Chromium; Ubuntu 24.04 blocks its userns sandbox
  // ("No usable sandbox!" FATAL) → always launch --no-sandbox (kiosk device).
  .join('{id:"carbonyl",name:"carbonyl",cmd:["carbonyl","--no-sandbox","https://lite.duckduckgo.com/lite"],icon:"browser"}')
  // #49:最终应用态去掉 htop(保留 btop)。CLI_PANEL_CLASS_NEW_OLD 仍带 htop —— 它是 #36 部署态的
  // 匹配锚点(桥接 .split(NEW_OLD).join(NEW) 靠它命中),不能在 OLD 里删;derive 出 NEW 后再移除,
  // 锚点不受影响,最终注入的菜单与 src(cliPanel.class.js 无 htop)对齐。
  .split('{id:"htop",name:"htop",cmd:["htop"],icon:"monitor"},')
  .join('')
  // #75/#74(round-4):1) CSS 注入隐藏 xterm-viewport 滚动条(黑边根因:滚动条留白撑出左右 15px 黑边);
  // 2) _closeSession 先关 WebSocket(触发后端 ondisconnected 杀进程组,修关闭浏览器后视频声音残留)。
  // 两处 OLD 锚点均在 CLI_PANEL_CLASS_NEW_OLD 内唯一(_closeSession 用 t.term,cover 用 e.term 不冲突)。
  .split('.cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}')
  .join('.cli_session{position:absolute;inset:0;display:none;overflow:hidden}.cli_session.active{display:block}' + '.xterm .xterm-viewport{overflow-y:hidden!important;scrollbar-width:none!important}.xterm .xterm-viewport::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}')
  .split('t.term.onclose&&(t.term.onclose=null),t.term.term&&t.term.term.dispose&&t.term.term.dispose()}catch(e){}')
  .join('t.term.onclose&&(t.term.onclose=null),t.term.socket&&t.term.socket.close&&t.term.socket.close(),t.term.term&&t.term.term.dispose&&t.term.term.dispose()}catch(e){}')
  .split('toggleDevTools(){}}')
  .join('toggleDevTools(){}' + CLI_COVER_METHODS + '}');
// CLI_PANEL_NEW 注入点是逗号表达式链(appmonitorApi={...},appmonitorA=...,appmonitorB=...,wifiApi=...),
// 开头必须是**表达式**不能是 const/class 语句(否则 },const 语法错误)。前缀 window.cliApps=||[]
// 以表达式入链并 ; 收束,后续 const/class 降为独立语句;末尾 ROUTE 以表达式接回 wifiApi 链。
const CLI_PANEL_NEW = 'window.cliApps=window.cliApps||[];' + ICON_LIBRARY_JS + CLI_PANEL_CLASS_NEW + CLI_PANEL_ROUTE_NEW;
// tab4 条件空心三角(仅 showGui 开时渲染;空心 outline 避免实心太亮;tab3 恒无三角)。
// 照 CLI_FS4_V2_OLD 引号写法:+ "'" + 包 button HTML,无反引号、无裸 ${} 外泄。
const CLI_FS4_NEW = '${' + '(window.settings.appMonitor||{}).showGui?' + "'" + '<button class="appmonitor_fs_tab" title="Fullscreen" onclick="event.stopPropagation();window.appmonitorB.fullscreenButton()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 2h20L2 22z"/></svg></button>' + "'" + ':""}';
// #36 设置:apps 分类顶部一行「显示GUI应用」(内联 onchange=window.showGui.apply(),免单独监听注入)。
// 部署态 settingsRow=n()/section=o();\n 是模板字面量里的 2 字符转义(与部署态逐字一致)。
const SHOWGUI_ROW = 'n("settings.appMonitor.showGui",`<select id="settingsEditor-showGui" onchange="window.showGui.apply()">\\n        <option>${!!(window.settings.appMonitor||{}).showGui}</option>\\n        <option>${!(window.settings.appMonitor||{}).showGui}</option>\\n    </select>`,"settings.appMonitor.showGui.help"),';
// SHOWGUI_OBJ 注入点:const v 语句前(完整语句前置,pristine/modal 均合法)。SHOWGUI_ANCHOR 是原始
// 语句边界;SHOWGUI_OBJ = window.showGui 对象 + 该边界(revert OBJ→ANCHOR、apply ANCHOR→OBJ,自洽幂等)。
const SHOWGUI_ANCHOR = 'const v=(e,t)=>{const n=(e||"").replace';
const SHOWGUI_OBJ = 'window.showGui={apply(){const el=document.getElementById("settingsEditor-showGui");if(!el)return;const on=el.value==="true";window.settings.appMonitor=window.settings.appMonitor||{};window.settings.appMonitor.showGui=on;try{fs.writeFileSync(settingsFile,JSON.stringify(window.settings,"",4))}catch(e){}this._notify("重启后生效")},_notify(m){let _t=document.getElementById("edex_toast");if(!_t){_t=document.createElement("div");_t.id="edex_toast";_t.className="browser_toast";document.body.appendChild(_t)}_t.textContent=m;_t.classList.add("show");clearTimeout(this._notifyTimer);this._notifyTimer=setTimeout(()=>_t.classList.remove("show"),2200)}};' + SHOWGUI_ANCHOR;
// ---- #62/#63:应用管理器 window.appManager + 设置分类 + 文件浏览器 AppImage/deb 入口 ----
// 镜像 src(事实源)。控制器/CATS/fs 方法块取自 minify(当前 src)真实构建(prebuild-src),
// 单引号常量(内容含反引号/模板占位/转义,统一 \ 与 ' 双写,保证字节级一致,已 node --check 验证)。
// 控制器引用 window.settingsFile/window.appmonitorApi/window.iconLibrary(运行期全局,部署态均存在),
// 全部惰性求值(对象字面量,无顶层副作用);方法名与 CATS onclick 及 fs.class 方法一一对应。
const APPMGR_CTRL = 'window.appManager={_list:[],_searchList:[],_pending:null,_fpOk:!1,_debFile:()=>require("path").join(require("path").dirname(window.settingsFile),"installed-debs.json"),_readDebs(){try{const t=JSON.parse(require("fs").readFileSync(this._debFile(),"utf8"));return Array.isArray(t)?t:[]}catch(t){return[]}},_writeDebs(t){try{require("fs").writeFileSync(this._debFile(),JSON.stringify(t,null,2))}catch(t){}},_home(){try{return require("os").homedir()}catch(t){return"~"}},_run:(t,e)=>new Promise(n=>{require("child_process").exec(t,{timeout:e||18e5,maxBuffer:33554432},(t,e,s)=>n({out:e||"",err:s||"",ok:!t}))}),_shq:t=>"\'"+String(t).replace(/\'/g,"\'\\\\\'\'")+"\'",_esc:t=>String(null==t?"":t).replace(/[<>&"]/g,t=>({"<":"&lt;",">":"&gt;","&":"&amp;",\'"\':"&quot;"}[t])),_notify(t){let e=document.getElementById("edex_toast");e||(e=document.createElement("div"),e.id="edex_toast",e.className="browser_toast",document.body.appendChild(e)),e.textContent=t,e.classList.add("show"),clearTimeout(this._notifyTimer),this._notifyTimer=setTimeout(()=>e.classList.remove("show"),2200)},_ensureCss(){if(document.getElementById("appmgr-style"))return;const t=document.createElement("style");t.id="appmgr-style",t.textContent=".appmgr_row{display:flex;align-items:center;gap:.8vh;padding:.5vh .6vh;border-bottom:1px dashed rgba(128,128,128,.22)}.appmgr_row.active,.appmgr_row:focus{background:rgba(128,128,128,.16);outline:none}.appmgr_icon{width:2.2vh;height:2.2vh;flex:0 0 2.2vh;opacity:.85}.appmgr_name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.appmgr_desc{opacity:.5;font-size:1.05vh}.appmgr_badge{font-size:1.05vh;opacity:.65;padding:0 .5vh;border:1px solid rgba(128,128,128,.45);border-radius:.3vh;white-space:nowrap}.appmgr_btn{font-size:1.15vh;padding:.25vh .9vh;cursor:pointer}.appmgr_btn:disabled{opacity:.4}.appmgr_empty{padding:.8vh;opacity:.55;text-align:center}.appmgr_banner{display:flex;align-items:center;justify-content:space-between;gap:1vh;padding:.5vh .8vh;margin-bottom:.6vh}",(document.head||document.documentElement).appendChild(t)},_flatpakIcon(t){const e=["/var/lib/flatpak/exports/share/icons/hicolor",this._home()+"/.local/share/flatpak/exports/share/icons/hicolor"];for(const n of e)for(const e of["256x256","128x128","64x64","512x512","scalable"])for(const s of["png","svg"]){const o=n+"/"+e+"/apps/"+t+"."+s;try{if(require("fs").existsSync(o))return o}catch(t){}}return null},_parseFlatpakList(t){const e=[];for(const n of String(t||"").split("\\n")){const t=n.split("\\t").map(t=>t.trim()).filter(Boolean);if(t.length<2)continue;let s=t[0];if(!/^(application|name|ref|application_id)$/i.test(s)){if(s.indexOf("/")>=0){const t=s.split("/");s="app"===t[0]&&t[1]?t[1]:t[t.length-1]}e.push({id:"flatpak:"+s,appId:s,name:t[1]||s,source:"flatpak"})}}return e},_parseFlatpakSearch(t){const e=[];for(const n of String(t||"").split("\\n")){const t=n.split("\\t").map(t=>t.trim()).filter(Boolean);if(!t.length)continue;let s=t[0];if(!/^(application|name|ref|application_id)$/i.test(s)){if(s.indexOf("/")>=0){const t=s.split("/");s="app"===t[0]&&t[1]?t[1]:t[t.length-1]}e.push({id:"flatpak:"+s,appId:s,name:t[1]||s,desc:t.slice(2).join(" ")||"",source:"flatpak"})}}return e},_appImageDirs(){const t=String(((window.settings||{}).appMonitor||{}).appImageDirs||"~/Applications,~/AppImages"),e=this._home();return t.split(",").map(t=>t.trim()).filter(Boolean).map(t=>"~"===t?e:0===t.indexOf("~/")?require("path").join(e,t.slice(2)):t)},_iconHtml(t){let e=null;if(t.icon&&window.iconLibrary&&(e=window.iconLibrary.get(t.icon)),e)return e;if("flatpak"===t.source&&t.appId){const e=this._flatpakIcon(t.appId);if(e)return\'<img class="appmgr_icon" src="\'+this._esc(e)+\'">\'}return\'<svg class="appmgr_icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-opacity=".7"/></svg>\'},_row(e,n,s){const o=\'<span class="appmgr_badge">\'+this._esc(t("appmgr.source."+e.source))+"</span>",i="installFlatpak"===s&&e.desc?\' <span class="appmgr_desc">\'+this._esc(e.desc)+"</span>":"",r=e.name||e.appId||"",a="uninstall"===s?\'<button type="button" class="appmgr_btn" onclick="window.appManager.uninstall(\'+n+\')">\'+this._esc(t("appmgr.uninstall"))+"</button>":\'<button type="button" class="appmgr_btn" data-fpi="\'+n+\'" onclick="window.appManager.installFlatpak(\'+n+\')">\'+this._esc(t("appmgr.install"))+"</button>";return\'<div class="appmgr_row" tabindex="-1">\'+this._iconHtml(e)+\'<span class="appmgr_name">\'+this._esc(r)+i+"</span>"+o+a+"</div>"},_wireKeys(t){const e=document.getElementById(t);e&&(e.onkeydown=t=>{const n=e.querySelectorAll(".appmgr_row");if(n.length)if("ArrowDown"===t.key||"ArrowUp"===t.key){t.preventDefault(),t.stopPropagation();let e=-1;n.forEach((t,n)=>{t.classList.contains("active")&&(e=n)}),e="ArrowDown"===t.key?Math.min(e+1,n.length-1):Math.max(e-1,0),n.forEach(t=>t.classList.remove("active")),n[e].classList.add("active");try{n[e].scrollIntoView({block:"nearest"})}catch(t){}}else if("Enter"===t.key){t.preventDefault(),t.stopPropagation();const n=e.querySelector(".appmgr_row.active"),s=n&&n.querySelector("button.appmgr_btn");s&&s.click()}else"Escape"===t.key&&(t.stopPropagation(),n.forEach(t=>t.classList.remove("active")))})},async refresh(){const e=document.getElementById("appmgrInstalledList");if(!e)return;this._ensureCss(),this._fpOk=!1;try{this._fpOk=(await this._run("flatpak --version",1e4)).ok}catch(t){}let n=[];if(this._fpOk){const t=await this._run("flatpak list --app --columns=application,name",3e4);t.ok&&(n=n.concat(this._parseFlatpakList(t.out)))}try{const t=await window.appmonitorApi.nativeList(),e=t&&t.apps||[];for(const t of e)0===String(t.id||"").indexOf("appimage:")?n.push({id:t.id,name:t.name,source:"appimage",path:t.path,icon:null}):0===String(t.id||"").indexOf("custom:")&&n.push({id:t.id,name:t.name,source:"custom",icon:t.icon})}catch(t){}for(const t of this._readDebs())n.push({id:"deb:"+(t.pkg||t.name),name:t.name,pkg:t.pkg||t.name,source:"deb",icon:null});n.sort((t,e)=>(t.name||"").localeCompare(e.name||"")),this._list=n;let s="";this._fpOk||(s+=\'<div class="appmgr_banner"><span>\'+this._esc(t("appmgr.flatpakMissing"))+\'</span><button type="button" class="appmgr_btn" onclick="window.appManager.ensureFlatpakThen()">\'+this._esc(t("appmgr.flatpakInstall"))+"</button></div>"),s+=n.length?n.map((t,e)=>this._row(t,e,"uninstall")).join(""):\'<div class="appmgr_empty">\'+this._esc(t("appmgr.installed.empty"))+"</div>",e.innerHTML=s,this._wireKeys("appmgrInstalledList")},_renderSearchResults(t){const e=document.getElementById("appmgrSearchResults");e&&(this._searchList=t,e.innerHTML=t.map((t,e)=>this._row(t,e,"installFlatpak")).join(""),this._wireKeys("appmgrSearchResults"))},async searchFlathub(){const e=document.getElementById("appmgrSearchInput"),n=document.getElementById("appmgrSearchResults");if(!e||!n)return;const s=String(e.value||"").trim();if(!s)return;n.innerHTML=\'<div class="appmgr_empty">…</div>\',await this.ensureFlathub();const o=await this._run("flatpak search --columns=application,name,description "+this._shq(s),6e4);if(!o.ok)return void(n.innerHTML=\'<div class="appmgr_empty">\'+this._esc(t("appmgr.search.failed"))+"</div>");const i=this._parseFlatpakSearch(o.out);i.length?this._renderSearchResults(i):n.innerHTML=\'<div class="appmgr_empty">\'+this._esc(t("appmgr.search.empty"))+"</div>"},async ensureFlathub(){const t=void 0;if(!(await this._run("flatpak --version",1e4)).ok){const t=void 0;if(!(await this._run("sudo -n apt install -y flatpak",6e5)).ok)return!1}return await this._run("sudo -n flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo",6e4),!0},ensureFlatpakThen(){this.ensureFlathub().then(()=>this.refresh())},installFlatpak(e){const n=this._searchList&&this._searchList[e];if(!n)return;const s=document.querySelector(\'#appmgrSearchResults button[data-fpi="\'+e+\'"]\');this._confirm(t("appmgr.confirm.install"),this._esc(n.name||n.appId)+" · <code>"+this._esc(n.appId)+"</code>",t("appmgr.install"),()=>{s&&(s.disabled=!0,s.textContent=t("appmgr.installing")),this._runInstall("sudo -n flatpak install -y flathub "+this._shq(n.appId),()=>{s&&(s.disabled=!1,s.textContent=t("appmgr.install")),this.refresh()})})},_runInstall(e,n){this._run(e,18e5).then(e=>{e.ok?this._notify(t("appmgr.done")):this._notify((e.err||"").split("\\n").filter(Boolean).pop()||t("appmgr.failed")),n&&n()})},async installLocal(){const e=document.getElementById("appmgrLocalInput");if(!e)return;const n=String(e.value||"").trim();if(!n)return;const s=0===n.indexOf("~/")?require("path").join(this._home(),n.slice(2)):n,o=require("path").resolve(s),i=o.toLowerCase();if(i.indexOf(".appimage")===i.length-9){const n=this._appImageDirs();if(!n.length)return void this._notify(t("appmgr.failed"));const s=require("path").join(n[0],require("path").basename(o)),i=await this._run("install -Dm755 "+this._shq(o)+" "+this._shq(s),12e4);return i.ok?(this._notify(t("appmgr.done")),e.value=""):this._notify((i.err||"").split("\\n").filter(Boolean).pop()||t("appmgr.failed")),void this.refresh()}i.indexOf(".deb")!==i.length-4?this._notify(t("appmgr.badType")):this.installDeb(o).then(t=>{t&&(e.value="")})},async installDeb(e){const n=await this._run("dpkg-deb -f "+this._shq(e)+" Package Description",3e4),s=(n.out||"").split("\\n").map(t=>t.trim()).filter(Boolean),o=s[0]||"";if(!n.ok||!o)return this._notify(t("appmgr.failed")),this.refresh(),!1;const i=await this._run("sudo -n apt install -y "+this._shq(e),18e5);if(i.ok){const e=this._readDebs();e.some(t=>t.pkg===o)||(e.push({name:s[1]||o,pkg:o,added:Date.now()}),this._writeDebs(e)),this._notify(t("appmgr.done"))}else this._notify((i.err||"").split("\\n").filter(Boolean).pop()||t("appmgr.failed"));return this.refresh(),!!i.ok},uninstall(e){const n=this._list&&this._list[e];if(!n)return;const s=n.name||n.appId||"";"deb"!==n.source?this._confirm(t("appmgr.confirm.uninstall"),this._esc(s)+" · "+this._esc(t("appmgr.source."+n.source)),t("appmgr.uninstall"),()=>{let e;"flatpak"===n.source?e=this._run("sudo -n flatpak uninstall -y "+this._shq(n.appId),6e5):"appimage"===n.source?e=this._run("rm -f "+this._shq(n.path),3e4):"custom"===n.source&&(e=window.appmonitorApi.removeNative(n.id)),e?e.then(e=>{e&&!1===e.ok?this._notify((e.err||"").split("\\n").filter(Boolean).pop()||t("appmgr.failed")):this._notify(t("appmgr.done")),this.refresh()}).catch(()=>this.refresh()):this.refresh()}):this._confirm(t("appmgr.confirm.uninstall"),this._esc(t("appmgr.confirm.debRisk").replace("{name}",s)),t("appmgr.uninstall"),()=>{this._confirm(t("appmgr.confirm.uninstall"),this._esc(t("appmgr.confirm.debRisk").replace("{name}",s)),t("appmgr.uninstall"),()=>{this._run("sudo -n apt remove --purge -y "+this._shq(n.pkg),6e5).then(e=>{e.ok?(this._writeDebs(this._readDebs().filter(t=>t.pkg!==n.pkg)),this._notify(t("appmgr.done"))):this._notify((e.err||"").split("\\n").filter(Boolean).pop()||t("appmgr.failed")),this.refresh()})})})},_confirm(t,e,n,s){this._pending=s;const o=this,i=new Modal({type:"custom",title:t,html:\'<div class="appmgr_confirm">\'+e+"</div>",closeLabel:window.settings&&"zh"===window.settings.language?"关闭":"Close",buttons:[{label:n,action:"window.appManager._confirmed()"}]}),r=window.modals[i];if(!r)return;const a=t=>{"Escape"===t.key?(t.stopPropagation(),t.preventDefault(),r.close()):"Enter"===t.key&&(t.stopPropagation(),t.preventDefault(),o._confirmed())};document.addEventListener("keydown",a,!0);const l=r.close.bind(r);r.close=()=>{document.removeEventListener("keydown",a,!0),l()},setTimeout(()=>{const t=document.querySelectorAll("#modal_"+i+" button");t[0]&&t[0].focus()},60)},_confirmed(){const t=this._pending;this._pending=null;const e=Object.keys(window.modals),n=e.length?window.modals[e[e.length-1]]:null;n&&"function"==typeof n.close&&n.close(),"function"==typeof t&&t()}}';
const APPMGR_ANCHOR = 'window.showGui={apply(){';
const APPMGR_CTRL_FULL = APPMGR_CTRL + ',window.showGui={apply(){';
const APPMGR_CAT_ANCHOR = '{id:"clash",titleKey:"settings.cat.clash",html:()=>{';
const APPMGR_CAT = '{id:"appmgr",titleKey:"settings.cat.appmgr",html:()=>(setTimeout(()=>{window.appManager&&window.appManager.refresh()},0),[s("settings.cat.appmgr"),s("appmgr.install.title"),n("appmgr.search",`<div class="settings_net_pw"><input type="text" id="appmgrSearchInput" placeholder="${t("appmgr.search.placeholder")}" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.appManager.searchFlathub();}"></div>\\n                    <div class="settings_net_actions">\\n                        <button type="button" id="appmgrSearchBtn" class="settings_net_btn" onclick="window.appManager.searchFlathub()">${t("appmgr.search")}</button>\\n                    </div>\\n                    <div id="appmgrSearchResults" class="settings_net_list" tabindex="0" augmented-ui="bl-clip tr-clip exe"></div>`),n("appmgr.local.title",`<div class="settings_net_pw"><input type="text" id="appmgrLocalInput" placeholder="${t("appmgr.local.placeholder")}" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.appManager.installLocal();}"></div>\\n                    <div class="settings_net_actions">\\n                        <button type="button" id="appmgrLocalInstall" class="settings_net_btn" onclick="window.appManager.installLocal()">${t("appmgr.local.install")}</button>\\n                    </div>`),s("appmgr.installed.title"),n("appmgr.installed",\'<div id="appmgrInstalledList" class="settings_net_list" tabindex="0" augmented-ui="bl-clip tr-clip exe"></div>\')].join(""))},';
const APPMGR_CAT_FULL = APPMGR_CAT + APPMGR_CAT_ANCHOR;
// 文件浏览器 AppImage/deb 入口(fs.class):openFile 扩展名分流(FS_EXT_OLD→NEW)+ 方法块
// (FS_METHODS 以逗号续链,插在 runInTerminal 尾 catch(e){}}} 与 openFileAsText 之间)。
const FS_EXT_OLD = 'const a=String(e||"").toLowerCase().split(".").pop()||"",o=!0===s.isScript||"sh"===a||"bash"===a,r=void 0;';
const FS_EXT_NEW = 'const a=String(e||"").toLowerCase().split(".").pop()||"";if("appimage"===a)return void this._appImagePrompt(s);if("deb"===a)return void this._debPrompt(s);const o=!0===s.isScript||"sh"===a||"bash"===a,r=void 0;';
const FS_METHODS = ',this._appImagePrompt=e=>{const t=e.name||String(e.path).split("/").pop()||"file",i=e=>String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),s="window.modals[Object.keys(window.modals).pop()].close();",n=window.appManager&&window.appManager._appImageDirs?window.appManager._appImageDirs():[],a=String(e.path).split("/").slice(0,-1).join("/"),o=-1!==n.indexOf(a);window._pendingRunPath=e.path;const r=o?[{label:window.t("fs.appimage.run"),action:"window.fsDisp.runAppImageOnce(window._pendingRunPath); "+s}]:[{label:window.t("fs.appimage.runOnce"),action:"window.fsDisp.runAppImageOnce(window._pendingRunPath); "+s},{label:window.t("fs.appimage.moveToApps"),action:"window.fsDisp.moveAppImageToApps(window._pendingRunPath); "+s}];new Modal({type:"custom",title:window.t("fs.appimage.title")+" — "+t,html:`<p style="margin:0 0 1.2vh;">${o?window.t("fs.appimage.inAppsMsg"):window.t("fs.appimage.msg")}</p>\\n                       <pre class="file_run_path">${i(e.path)}</pre>`,buttons:r,closeLabel:window.t("fs.cancel")})},this.runAppImageOnce=e=>{const t=String(e||"").replace(/"/g,\'\\\\"\');require("child_process").exec(`chmod +x "${t}" >/dev/null 2>&1; DISPLAY=:0 nohup "${t}" --no-sandbox >/dev/null 2>&1 &`,{timeout:1e4},()=>{})},this.moveAppImageToApps=e=>{const t=e=>String(e).replace(/"/g,\'\\\\"\');let i="";if(window.appManager&&window.appManager._appImageDirs){const e=window.appManager._appImageDirs();e.length&&(i=e[0])}i||(i=require("path").join(require("os").homedir(),"Applications"));const s=void 0,n=i+"/"+(String(e||"").split("/").pop()||"app.AppImage");require("child_process").exec(`mkdir -p "${t(i)}" && mv -f "${t(String(e))}" "${t(n)}" && chmod +x "${t(n)}"`,{timeout:15e3},e=>{window.appManager&&window.appManager._notify&&(e?window.appManager._notify(window.t("appmgr.failed")):window.appManager._notify(window.t("fs.appimage.moved"))),this.readFS(this.dirpath)})},this._debPrompt=e=>{const t=e.name||String(e.path).split("/").pop()||"file",i=e=>String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),s="window.modals[Object.keys(window.modals).pop()].close();";window._pendingRunPath=e.path,new Modal({type:"custom",title:window.t("fs.deb.title")+" — "+t,html:`<p style="margin:0 0 1.2vh;">${window.t("fs.deb.msg")}</p>\\n                       <pre class="file_run_path">${i(e.path)}</pre>`,buttons:[{label:window.t("fs.deb.install"),action:"window.fsDisp.installDebFromBrowser(window._pendingRunPath); "+s}],closeLabel:window.t("fs.cancel")})},this.installDebFromBrowser=e=>{window.appManager&&window.appManager.installDeb?window.appManager.installDeb(e):new Modal({type:"info",title:"App manager unavailable",message:"Reload the interface and try again."})},';
const FS_METHODS_SEAM = 'catch(e){}}},this.openFileAsText=';
// i18n 键块(zh/en 各一份,取 src 原文;插在 clash ctrlError(父括号版)前,对象键序无关紧要)。
// 锚父括号版(#9 起所有构建都烘焙);旧 patch 注入的非父括号版可能共存,不碰它。
const ZH_APPMGR = '"settings.cat.appmgr":"应用管理","appmgr.install.title":"安装应用","appmgr.search":"搜索","appmgr.search.placeholder":"搜索 Flathub 应用…","appmgr.search.empty":"无搜索结果","appmgr.search.failed":"搜索失败","appmgr.local.title":"从本地文件安装","appmgr.local.placeholder":"AppImage 或 .deb 文件路径","appmgr.local.install":"安装","appmgr.installed.title":"已安装应用","appmgr.installed.empty":"暂无应用","appmgr.installed":"","appmgr.source.flatpak":"Flatpak","appmgr.source.appimage":"AppImage","appmgr.source.custom":"自定义","appmgr.source.deb":"deb","appmgr.install":"安装","appmgr.installing":"安装中…","appmgr.uninstall":"卸载","appmgr.confirm.install":"确认安装","appmgr.confirm.uninstall":"确认卸载","appmgr.confirm.debRisk":"卸载 deb 应用会移除相关文件，且不可恢复。确定卸载 {name} 吗？","appmgr.done":"完成","appmgr.failed":"失败","appmgr.flatpakMissing":"未检测到 Flatpak","appmgr.flatpakInstall":"安装 Flatpak","appmgr.badType":"不支持的文件类型","fs.cancel":"取消","fs.appimage.title":"AppImage 应用","fs.appimage.msg":"这是一个 AppImage 应用。直接打开运行一次，或移动到应用文件夹以便随时启动。","fs.appimage.inAppsMsg":"运行这个 AppImage 应用？","fs.appimage.run":"运行","fs.appimage.runOnce":"直接打开","fs.appimage.moveToApps":"移动到应用文件夹","fs.appimage.moved":"已移动到应用文件夹","fs.deb.title":"安装 deb 应用","fs.deb.msg":"安装这个 .deb 包？安装后它会出现在应用列表和应用管理里。","fs.deb.install":"安装",';
const EN_APPMGR = '"settings.cat.appmgr":"App Manager","appmgr.install.title":"Install apps","appmgr.search":"Search","appmgr.search.placeholder":"Search Flathub…","appmgr.search.empty":"No results","appmgr.search.failed":"Search failed","appmgr.local.title":"Install from local file","appmgr.local.placeholder":"AppImage or .deb file path","appmgr.local.install":"Install","appmgr.installed.title":"Installed apps","appmgr.installed.empty":"No apps yet","appmgr.installed":"","appmgr.source.flatpak":"Flatpak","appmgr.source.appimage":"AppImage","appmgr.source.custom":"Custom","appmgr.source.deb":"deb","appmgr.install":"Install","appmgr.installing":"Installing…","appmgr.uninstall":"Uninstall","appmgr.confirm.install":"Confirm install","appmgr.confirm.uninstall":"Confirm uninstall","appmgr.confirm.debRisk":"Uninstalling a deb app removes its files and cannot be undone. Uninstall {name}?","appmgr.done":"Done","appmgr.failed":"Failed","appmgr.flatpakMissing":"Flatpak not detected","appmgr.flatpakInstall":"Install Flatpak","appmgr.badType":"Unsupported file type","fs.cancel":"Cancel","fs.appimage.title":"AppImage app","fs.appimage.msg":"This is an AppImage app. Run it once, or move it to the apps folder to launch it anytime.","fs.appimage.inAppsMsg":"Run this AppImage app?","fs.appimage.run":"Run","fs.appimage.runOnce":"Run once","fs.appimage.moveToApps":"Move to apps folder","fs.appimage.moved":"Moved to apps folder","fs.deb.title":"Install deb package","fs.deb.msg":"Install this .deb package? It will appear in the app list and app manager.","fs.deb.install":"Install",';
const ZH_CTRL_SEAM = '"settings.clash.ctrlError":"控制接口无响应（daemon 未运行？）",';
const EN_CTRL_SEAM = '"settings.clash.ctrlError":"Controller unreachable (is the daemon running?)",';
// #17 兼容:已部署 AppImage 里仍是旧递归版 focus()(else this.activate() → activate() → focus() 死循环)。
// 直接把它换成修复版片段,保证对"当前已打补丁的 AppImage 重打"时也能生效(否则链首 revert 的
// CLI_PANEL_V3_OLD 因新旧不一致 miss → 旧递归代码残留)。对 pristine orig 是 no-op(片段不存在)。
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

// ---- #50 Part B:屏保/锁屏改 CliPanel cover session(已部署 AppImage 用)----
// 用户拍板:屏保/锁屏写入一个临时出现的真终端 tab(在 CLI 面板临时新建一个 "app"),解锁就
// 销毁,并恢复锁屏前的画面。不再用 #screensaver_vt / #lock_virt_term 虚拟终端覆盖层。
// 新设计(与 src 一致):
//   * CliPanel 建一个固定 id `__cover__` 的临时会话(真 pty `sh -c "stty raw -echo; exec cat"`,
//     Terminal wrapper muted:true),窗口侧 screensaver.coverTerm()/streamCodeIntoCover() 借用。
//   * 屏保 code 模式:show → _mkSsvt() 调 appmonitorA.beginCoverSession() + 切 tab3(记 restoreTab)
//     + 启动 codeTimer → codeTick 写 coverTerm()。hide:停 timer,keepCover=!1 → _rmSsvt() 销毁。
//   * 锁:_showTerminalLock 用 screensaver.coverTerm()(屏保来过→复用;直接锁→新建),输入走
//     _termKey 拦截 socket.send(不再用全局 keydown + lock_pass_input 隐藏输入框)。
//   * teardown:还原 send 拦截 + stopCodeStream + endCover(销毁 cover 会话,恢复面板选中)。
// 收敛链(pristine → 新态;旧部署 #20/#36 → 新态;重跑幂等):
//   L1:  .split(L1_NEW).join(L1_OLD)          旧部署 xterm/ttyspawn 态 revert 回 L1_OLD
//        .split('const r={term:null,socket:null,id:"__lockvirt"};').join('')  死前缀
//        .split(LOCK1_OLD).join(L1_COVER)     pristine 锚点
//        .split(L1_OLD).join(L1_COVER)         旧部署锚点
//        .split(LOCK1_PASS_OLD).join('')       移除 lock_pass_input 隐藏输入框
//   teardown: .split('_teardownLock(e){this.active=!1,').join(NEW_LOCK2_PREFIX)  pristine
//        .split(L2_NEW).join(L2_OLD)           旧部署 dispose 块 revert
//        .split(LOCK2_NEW).join(NEW_LOCK2_PREFIX)  旧部署整块换新
//        .split(L2_OLD).join('')               pristine 残余 dispose 块空删
//   SVT:  .split(SVT_OLD).join(SVT_NEW)  旧锚点走一遍,再 .split(SVT_NEW).join(SVT_COVER) 全覆盖
//        .split(SSVT_HIDE_OLD).join(SSVT_HIDE_NEW).split(SSVT_HIDE_NEW).join(SSVT_HIDE_NEW2)
// 注意:NEW_LOCK2_PREFIX 必须不含 '_teardownLock(e){this.active=!1,'(前置 hook 防二次命中),
// L1_COVER 必须不含 L1_OLD/LOCK1_OLD/L1_NEW/'const r={term:null,socket:null,id:"__lockvirt"};'/
// LOCK1_PASS_OLD 作子串。
const SSVT_HIDE_NEW2 = 'n){if(t){clearInterval(t),t=null}this._rmSsvt(n);}';
// SVT_COVER 替换 SVT_OLD/SVT_NEW 的 `_mkSsvt(){...},_rmSsvt(){...}` 对,展开为 6 个方法
// (_mkSsvt/_rmSsvt(k)/endCover/coverTerm/streamCodeIntoCover/stopCodeStream)。d/n/_/k/t/I
// 是原屏保闭包变量(d=sessionUsed,n=winding,_=pendingLines,k=sessionFirstFile,t=codeTimer,I=codeTick)。
const SVT_COVER = `_mkSsvt(){try{this._rmSsvt()}catch(_){}Vt=null;const _p=(window._uiReady&&window.appmonitorA&&"function"==typeof window.appmonitorA.beginCoverSession)?window.appmonitorA:null;if(!_p)return Vt;if(null==this._coverRestoreTab)this._coverRestoreTab=window.currentTerm;window.screensaverSilent=!0;try{_p.beginCoverSession()}catch(_){}try{if(3!==window.currentTerm&&window.focusShellTab)window.focusShellTab(3)}catch(_){}try{const _w=_p.coverTerm?_p.coverTerm():null;if(_w&&window.term&&window.term[3]!==_w){null==this._coverShim&&(this._coverShim=window.term[3]);window.term[3]=_w}Vt=_w}catch(_){}return Vt},_rmSsvt(k){if(!k){if(this._coverShim&&window.term){try{window.term[3]=this._coverShim}catch(_){}}this._coverShim=null;window.screensaverSilent=!1;try{const _p=window.appmonitorA;_p&&"function"==typeof _p.endCoverSession&&_p.endCoverSession()}catch(_){}if(this._coverRestoreTab){const _t=this._coverRestoreTab;this._coverRestoreTab=null;try{_t!==window.currentTerm&&window.focusShellTab&&window.focusShellTab(_t)}catch(_){}}}},endCover(k){if(!k)this._coverRestoreTab=null;if(this._coverShim&&window.term){try{window.term[3]=this._coverShim}catch(_){}}this._coverShim=null;window.screensaverSilent=!1;try{const _p=window.appmonitorA;_p&&"function"==typeof _p.endCoverSession&&_p.endCoverSession()}catch(_){}},coverTerm(){if(window.screensaverSilent===!0)try{const _p=window.appmonitorA;if(_p&&"function"==typeof _p.coverTerm){const _w=_p.coverTerm();if(_w){Vt=_w;return _w}}}catch(_){}return this._mkSsvt()},streamCodeIntoCover(){this.coverTerm(),d.clear(),n=!1,_=[],k=!0,t||(t=setInterval(I,100))},stopCodeStream(){if(t){clearInterval(t),t=null}}`;
// L1_COVER 替换 LOCK1_OLD(pristine)与 L1_OLD(旧部署):保留 z-index 提升,去掉
// focusShellTab(0)/window.term[0](不碰真终端),改用 cover session。direct 锁(Win+L)先
// streamCodeIntoCover() 流假代码,_grab 轮询 coverTerm() attach 后拦截 socket.send → _termKey,
// ~1.5s 后 stopCodeStream + _drawLockBox(!0);屏保→锁(非 direct)直接 _drawLockBox(!0)。
const L1_COVER = `const i=document.getElementById("mod_clock");i&&(this._origClockPos=i.style.position,i.style.position="relative",i.style.zIndex="3100");const o=document.getElementById("main_shell_title");o&&(this._origTitleZ=o.style.zIndex,o.style.zIndex="3100");const s=document.getElementById("main_shell");s&&(this._origShellClip=s.style.clipPath,this._origShellZ=s.style.zIndex,s.style.zIndex="3200",s.style.clipPath="none");const n=document.getElementById("main_shell_innercontainer");n&&(this._origInnerZ=n.style.zIndex,this._origInnerClip=n.style.clipPath,n.style.zIndex="3001",n.style.clipPath="polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))");const _direct=!(window.screensaver&&window.screensaver.isActive&&window.screensaver.isActive());if(_direct&&window.screensaver&&window.screensaver.streamCodeIntoCover)try{window.screensaver.streamCodeIntoCover()}catch(e){}this._codeBuf="";const _grab=()=>{if(!this.active)return;const _t=window.screensaver&&window.screensaver.coverTerm?window.screensaver.coverTerm():null;if(!_t||!_t.term||!_t.socket)return void setTimeout(_grab,120);this._term=_t;if(_t.socket&&"function"==typeof _t.socket.send){this._origSend=_t.socket.send.bind(_t.socket);_t.socket.send=d=>this._termKey(d)}this._rawWrite=_t.term.write.bind(_t.term);this._suppressOutput=!0;this._boxAnimating=!0;if(_direct){const _ss=window.screensaver;setTimeout(()=>{try{if(!this.active)return;try{_ss&&_ss.stopCodeStream&&_ss.stopCodeStream()}catch(e){}try{this._drawLockBox(!0)}catch(e){}}catch(e){}},1500)}else try{this._drawLockBox(!0)}catch(e){}};_grab()`;
// LOCK1_NEW 的 lock_pass_input 隐藏输入框尾段(全局 keydown 输密码)——#50 不再需要(输入走
// _termKey 拦截 socket.send)。
const LOCK1_PASS_OLD = 'try{const pi=document.createElement("input");pi.id="lock_pass_input",pi.type="text",pi.autocomplete="off",pi.inputMode="numeric",pi.style.cssText="position:fixed;left:-9999px;top:0;opacity:0",document.body.appendChild(pi),pi.focus(),this._keydownHandler=e=>{if(!this.active||this._boxAnimating)return;e.preventDefault(),e.stopPropagation();const k=e.key;if("Enter"===k)return this._codeSubmit();if("Backspace"===k||"Delete"===k)return this._codeBuf=this._codeBuf.slice(0,-1),this._codeRedraw();if(1===k.length&&k>=" ")this._codeBuf+=k,this._codeRedraw()},window.addEventListener("keydown",this._keydownHandler,!0)}catch(e){}';
// NEW_LOCK2_PREFIX 替换旧 LOCK2_NEW(清 keydown/lock_pass_input/lock_virt_term + 销毁 socket):
// 还原 send 拦截 + _suppressOutput + stopCodeStream + endCover(销毁 cover 会话并恢复面板选中)。
// e=restoreWindows(真实解锁)。endCover(!e):真解锁→清 restoreTab(锁自己 _applyRestore 回 _prevTerm);
// 锁→屏保→keepRestoreTab(供 resumeCode 用)。设置 _term.term=null 以匹配旧部署 L2_NEW 之后
// [BODY2] 看到的 this._term.term=null 状态(旧部署已证明安全)。
const NEW_LOCK2_PREFIX = '_teardownLock(e){this._term&&this._origSend&&(this._term.socket.send=this._origSend),this._suppressOutput=!1,window.screensaver&&window.screensaver.stopCodeStream&&window.screensaver.stopCodeStream(),window.screensaver&&window.screensaver.endCover&&window.screensaver.endCover(!e),this._term&&this._term.term&&(this._term.term=null),this.active=!1,';


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
      // #74(round-4):ttyspawn extra 终端断线时杀整个进程组(音频残留根因 —— 旧实现只 d.close() 关 socket,
      // carbonyl/浏览器子进程不杀,视频声音驻留)。锚点用 pristine 的 minified 形态(变量 d,extraTtys 条目);
      // d.tty.pid 即 node-pty 进程(进程组组长),杀 -pid 连带 shell+子进程。幂等:已打新版则 OLD 不在 → no-op。
      .split('d.ondisconnected=()=>{d.onclosed=()=>{},d.close(),d.wss.close(),extraTtys[d.port]=null,d=null}')
      .join('d.ondisconnected=()=>{d.onclosed=()=>{};try{process.kill(-d.tty.pid,"SIGKILL")}catch(e){try{d.close()}catch(e){}}d.wss.close(),extraTtys[d.port]=null,d=null}')
      // #8/#9:AXEL 主进程(5 handler)+ clash:ctrl 透传 handler(锚点前缀注入,expectOut 换新防重跑)
      .split(AXEL_BOOT_ANCHOR).join(AXEL_BOOT_NEW + AXEL_BOOT_ANCHOR)
      .split(CLASH_CTRL_ANCHOR).join(CLASH_CTRL_NEW + CLASH_CTRL_ANCHOR),
  },
  {
    name: 'terminal.class.js (alt-screen 历史滚动 + ws 断线重连 + #9 完成音效)',
    path: ['classes', 'terminal.class.js'],
    expectIn: 'scrollback:1500,',
    // #69 expectOut 改 muted 专属锚:_doneT 在 17fix 代就已注入,用它做跳过标记会让 17fix
    // 老构建被误判"已打"整段跳过,永远拿不到 ws 断线重连 / alt-screen 历史滚动 / 当前 wheel。
    // muted 只有当前代才有 —— 但 src 新构建的构造器参数是 t(this.muted=!!t.muted),
    // 老 patch 构建是 e(this.muted=!!e.muted),用带参数名的 `muted=!!e.muted` 会让
    // src 新构建(CI 上预烘焙)匹配不上 → 目标误跑 → 双重注入 noBootCR 等。故锚取
    // 参数无关的 `this.muted=!!`:两种当前态都命中跳过,老 12fix/17fix/中代(无 muted)
    // 全部会跑,靠下方 revert 桥 + 注入链收敛到当前态。
    expectOut: 'this.muted=!!',
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
      // #69 老构建覆盖桥:12fix/17fix 代注入的旧形态先 revert 回 pristine 锚点,当前链才能
      // 从锚点重打(否则旧守卫/旧 socket 挡在锚点和当前注入串之间,split 匹配不上)。
      // ① 旧代 wheel 守卫是 `...{return}e.preventDefault()...`;当前链锚 pristine 的
      //    `{e.preventDefault(),e.stopPropagation();const t=Number(...`,不 revert 则
      //    alt-screen 历史滚动分支打不上。当前代 wheel 分支是 `{e.preventDefault(),e.stopPropagation();const _d=e.deltaY...`,
      //    与 `{return}` 形态不同 → 对当前构建天然无匹配(fresh 无旧守卫同样 no-op)。
      .split('m.addEventListener("wheel",e=>{const _b=this.term&&this.term.buffer&&this.term.buffer.active;if(_b&&"alt"===_b.type){return}e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      .join('m.addEventListener("wheel",e=>{e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      // ② 17fix 代 socket 块已把 #9 doneT 注入进 message 监听器,当前 ws-断线重连(整块重写)
      //    锚的是 pristine socket → 锚不上。局部 revert:把 doneT 块夹在
      //    `this.lastSoundFX=t),` 与 `t-this.lastRefit>1e4` 之间的唯一形态拆掉(该序列在 17fix
      //    旧 socket 与 18fix 的 _wsConn 监听器里同形,一并拆;fresh/12fix 无 doneT 不误伤,
      //    当前 _wsConn 形态由步骤9重新注入)。
      .split('this.lastSoundFX=t),this._doneT&&clearTimeout(this._doneT),this._lastOut=Date.now(),this._doneT=setTimeout(()=>{this._doneT=null;if(this._userIn&&Date.now()-this._lastOut>=1500)try{window.audioManager&&window.audioManager.info&&window.audioManager.info.play()}catch(_){}},1500),t-this.lastRefit>1e4')
      .join('this.lastSoundFX=t),t-this.lastRefit>1e4')
      // ③ 前缀型注入 revert:这些步骤的锚是"注入串的前缀",对已含注入的旧代/中代重跑会
      //    二次拼接(enableMouseEvents 双份、_altHist 初始化双份、_noBootCR 双份、boot-CR
      //    守卫双份、_userIn 双份)。先回退到 pristine 前缀,当前注入链再整体重打一遍。
      //    对 pristine 这些串不存在 → 全部 no-op;对真·当前构建 expectOut=muted 已跳过。
      .split('scrollback:1500,enableMouseEvents:!0,').join('scrollback:1500,')
      .split('this.port=e.port||3e3,this.cwd="",this._altHist=[],this._altHistIdx=0,this._altLast="",this._altPaused=!1,this._altLastT=0,this._serializeA=null')
      .join('this.port=e.port||3e3,this.cwd=""')
      .split('this.port=e.port||3e3,this.cwd="",this.muted=!!e.muted,this._altHist=[],this._altHistIdx=0,this._altLast="",this._altPaused=!1,this._altLastT=0,this._serializeA=null')
      .join('this.port=e.port||3e3,this.cwd=""')
      .split('this._disableCWDtracking=!1,this._noBootCR=!!e.noBootCR,').join('this._disableCWDtracking=!1,')
      .split('try{this._noBootCR||this.tty.write("\\r")}catch(e){}}').join('try{this.tty.write("\\r")}catch(e){}}')
      .split('this.write=e=>{this._userIn=!0;this.socket.send(e)}').join('this.write=e=>{this.socket.send(e)}')
      .split('scrollback:1500,').join('scrollback:1500,enableMouseEvents:!0,')
      .split('this.port=e.port||3e3,this.cwd=""')
      .join('this.port=e.port||3e3,this.cwd="",this._altHist=[],this._altHistIdx=0,this._altLast="",this._altPaused=!1,this._altLastT=0,this._serializeA=null')
      .split('let a=new r;this.term.loadAddon(a),this.term.attachCustomKeyEventHandler')
      .join('let a=new r;this.term.loadAddon(a),this._ow=this.term.write.bind(this.term),this.term.write=d=>{try{const b=this.term.buffer&&this.term.buffer.active;if(this._altPaused&&(!b||"alt"!==b.type))this._altPaused=!1;if(this._altPaused)return;if(b&&"alt"===b.type){const tt=Date.now();if(tt-this._altLastT>250){this._altLastT=tt;if(!this._serializeA){const{SerializeAddon:SA}=require("xterm-addon-serialize");this._serializeA=new SA;try{this.term.loadAddon(this._serializeA)}catch(e){}}const ss=this._serializeA?this._serializeA.serialize():"",pv=this._altHist[0];if(ss&&ss!==pv){this._altLast=ss,this._altHist.unshift(ss),this._altHist.length>400&&this._altHist.pop(),this._altHistIdx=0}}}}catch(e){}this._ow(d)},this.term.attachCustomKeyEventHandler')
      .split('m.addEventListener("wheel",e=>{e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      .join('m.addEventListener("wheel",e=>{const _b=this.term&&this.term.buffer&&this.term.buffer.active;if(_b&&"alt"===_b.type){e.preventDefault(),e.stopPropagation();const _d=e.deltaY;if(_d<0){if(this._altPaused){if(this._altHistIdx<this._altHist.length-1)this._altHistIdx++;else this._altPaused=!1,this._altHistIdx=0,this.term.reset(),this._altLast&&this._ow(this._altLast)}else this._altHist.length&&(this._altPaused=!0,this._altHistIdx=Math.min(1,this._altHist.length-1));if(this._altPaused){const h=this._altHist[this._altHistIdx];h&&(this.term.reset(),this._ow(h))}}else if(_d>0&&this._altPaused){if(this._altHistIdx>0)this._altHistIdx--;else this._altPaused=!1,this._altHistIdx=0,this.term.reset(),this._altLast&&this._ow(this._altLast)}return}e.preventDefault(),e.stopPropagation();const t=Number(window.settings.terminalScrollSensitivity)')
      .split('this._disableCWDtracking=!1,').join('this._disableCWDtracking=!1,this._noBootCR=!!e.noBootCR,')
      .split('try{this.tty.write("\\r")}catch(e){}}').join('try{this._noBootCR||this.tty.write("\\r")}catch(e){}}')
      // #75(round-4):fit() 黑边修复 —— 基础 AppImage 的 fit 直接取 proposeDimensions 的 cols
      // (被滚动条留白挤窄 → 左右黑边)。改为:proposeDimensions 得基准 cols,再用父容器真实
      // 像素宽 ÷ actualCellWidth 微调(最多 +4,防超出撑横向滚动)。锚点取基础版 fit 全串
      // (pristine 唯一,变量字母 h 依基础 AppImage 压缩产物固定)。
      .split('let e=h.proposeDimensions();e&&void 0!==e.cols&&void 0!==e.rows&&(this.term.cols===e.cols&&this.term.rows===e.rows||this.resize(e.cols,e.rows))')
      .join('let e=h.proposeDimensions();if(!e||void 0===e.cols||void 0===e.rows)return;const base=Math.max(1,Math.floor(e.cols));let t=base;try{const p=this.term.element&&this.term.element.parentElement,d=this.term._core&&this.term._core._renderService&&this.term._core._renderService.dimensions;if(p&&d&&d.actualCellWidth>0){const r=p.getBoundingClientRect(),c2=Math.round(r.width/d.actualCellWidth);c2>=base&&(t=Math.min(c2,base+4))}}catch(x){}const i=Math.max(1,Math.floor(e.rows));this.term.cols===t&&this.term.rows===i||this.resize(t,i)')
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
    name: 'lockScreen.class.js (code 锁屏用 CliPanel cover session + 框加大 + 主题配色)',
    path: ['classes', 'lockScreen.class.js'],
    expectIn: '_teardownLock(e){',
    expectOut: 'streamCodeIntoCover',
    transform: c => c
      // #50:旧部署态(L1_NEW / LOCK2_NEW,独立虚拟终端 #lock_virt_term + lock_pass_input)先 revert
      // 回旧锚点,再与 pristine(LOCK1_OLD)统一走 cover-session 版 L1_COVER;移除 const r={id:
      // "__lockvirt"} 死前缀与 lock_pass_input 隐藏输入框(输入改走 _termKey 拦截 socket.send)。
      .split(L1_NEW).join(L1_OLD)
      .split('const r={term:null,socket:null,id:"__lockvirt"};').join('')
      .split(LOCK1_OLD).join(L1_COVER)
      .split(L1_OLD).join(L1_COVER)
      .split(LOCK1_PASS_OLD).join('')
      // teardown:deployed 的 LOCK2_NEW(清 keydown/lock_pass_input/lock_virt_term + 销毁 socket)
      // 先经 L2_NEW→L2_OLD revert 还原,再整体换成 NEW_LOCK2_PREFIX;pristine 从
      // '_teardownLock(e){this.active=!1,' 锚点注入,残余 L2_OLD 空删、L3_OLD→L3_NEW。
      .split('_teardownLock(e){this.active=!1,').join(NEW_LOCK2_PREFIX)
      .split(L2_NEW).join(L2_OLD)
      .split(LOCK2_NEW).join(NEW_LOCK2_PREFIX)
      .split(L2_OLD).join('')
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
      // L1/L2 已在上方统一走 cover 收敛链;此处只剩 L3(恢复)替换。
      .split(L3_OLD).join(L3_NEW),
  },
  {
    name: 'backend.js (openbox --config → --config-file + #5 剪贴板桥 + #7 Xvfb 光标)',
    path: ['appmonitor', 'backend.js'],
    expectIn: '"openbox",["--config",',
    expectOut: 'edex-clipboard-bridge.sh',
    // expectIn 与 transform 均不硬编码 terser mangle 字母:变量名(openbox/Xvfb/x11vnc/fcitx5/
    // array 的 mangle 名)随 minify 的变量计数改变(2026-08: v2.3.11 的 MONITOR_RC=d 在 v2.4 变 l),
    // 这里全部按结构正则匹配,同一 transform 同时兼容旧版与新版 minified。
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
      // 1) openbox 用非法参数 --config → 正确参数 --config-file(mangle 无关:变量名通配)。
      .replace(/"openbox",\["--config",[a-zA-Z_$][\w$]*,"--sm-disable"\]/g, m => m.replace('"--config",', '"--config-file",'))
      // 2) x11vnc 改监听 rfbPort+10,原 rfbPort 由 websockify 转发;再拉起剪贴板桥。
      //    $2 = display var(realBackend 形参),$4/$5 = push 里的 Xvfb/openbox 变量。
      .replace(/([a-zA-Z_$][\w$]*)=o\("x11vnc",\["-display",([a-zA-Z_$][\w$]*)\.display,"-rfbport",String\(\2\.rfbPort\),"-shared","-forever","-nopw","-listen","127\.0\.0\.1"\],\{stdio:"ignore"\}\);([a-zA-Z_$][\w$]*)\.push\(([a-zA-Z_$][\w$]*),([a-zA-Z_$][\w$]*),\1\);/g, '$1=o("x11vnc",["-display",$2.display,"-rfbport",String($2.rfbPort+10),"-shared","-forever","-nopw","-listen","127.0.0.1"],{stdio:"ignore"}),w=o("websockify",[String($2.rfbPort),"127.0.0.1:"+String($2.rfbPort+10)],{stdio:"ignore"}),B=o("/usr/local/bin/edex-clipboard-bridge.sh",[$2.display],{stdio:"ignore",env:Object.assign({},process.env,{DISPLAY:$2.display})});$3.push($4,$5,$1,w,B);')
      // 3) 删除虚拟屏 fcitx5 spawn 及其 push(独占主屏 dbus name,#144 盲打修复)。
      .replace(/const ([a-zA-Z_$][\w$]*)=o\("fcitx5"[\s\S]*?\);([a-zA-Z_$][\w$]*)\.push\(\1\);/g, '')
      // 4) spawn 应用 env 加 XCURSOR_THEME=edex(已有则不重复;fcitx env 已被 #3 移除)。
      .replace(/\{DISPLAY:[a-zA-Z_$][\w$]*\.display[^{}]*GTK_IM_MODULE:"fcitx",QT_IM_MODULE:"fcitx",XMODIFIERS:"@im=fcitx"\}/g, m => m.includes('XCURSOR_THEME') ? m : m.slice(0, -1) + ',XCURSOR_THEME:"edex"}')
      // 5) 主屏 :0 的 env 加光标(v2.4 已烘焙进 src,此步为旧版补齐,命中即幂等)。
      .split('{DISPLAY:":0"}')
      .join('{DISPLAY:":0",XCURSOR_THEME:"edex"}'),
  },
  {
    name: 'backend.js (fullscreen 按 PID 定位窗口:不再 wmctrl :ACTIVE: 误全屏 eDEX)',
    path: ['appmonitor', 'backend.js'],
    expectIn: 'setTimeout(()=>{try{o("wmctrl",["-r",":ACTIVE:","-b","add,fullscreen"],{env:p,stdio:"ignore"})}catch(e){}},1500)',
    expectOut: 'spawnSync',
    // expectOut 用 mangle 无关的 `spawnSync`:PID 修复已烘焙进 v2.4 src(解构式
    // `{spawn:o,spawnSync:r}=require("child_process")`),新构建含它 → 幂等 skip;
    // 旧版(v2.3.x)src 无 spawnSync、仍是 :ACTIVE: 旧代码 → 走下面 transform 打补丁。
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
    // expectIn 用模块头(pristine 与已打 #17 的部署版都存在);org\.kde\. 是 pristine 独有,
    // 已打 #17 的部署版该串已被替换,不能作 expectIn。
    expectIn: '"use strict";const fs=require("fs"),path=require("path"),os=require("os")',
    expectOut: 'icon:e.icon||null',
    // #17 应用列表恢复 native:(含 Firefox)后,Input Method / Keyboard layout viewer /
    // X11VNC Server 这三个系统工具名没被原 SYSTEM_APP_RE 命中,会混进应用列表。
    // 补漏:按 exec/名字追加三个精准替代(im-config / kbd-layout-viewer5 / x11vnc)。
    // #36 icon 透传:custom 条目把 iconLibrary id 存进 custom 列表、列表映射带出
    // (icon:e.icon||null),这样 ADD APP 选的图标才能在菜单里渲染。icon 只收
    // 短安全串(/^[a-z0-9_\-]{1,48}$/i),其余一律落 null。
    transform: c => c
      .split('org\\.kde\\.)([\\s_.\\/-]|$)/i')
      .join('org\\.kde\\.|im-config|kbd-layout-viewer5|x11vnc)([\\s_.\\/-]|$)/i')
      .split('exec:e.value,icon:null,custom:!0')
      .join('exec:e.value,icon:e.icon||null,custom:!0')
      .split('n.push({name:t.name,value:t.value,added:Date.now()})')
      .join('n.push({name:t.name,value:t.value,icon:"string"==typeof t.icon&&/^[a-z0-9_\\-]{1,48}$/i.test(t.icon)?t.icon:null,added:Date.now()})'),
  },
  {
    name: 'native-apps.js (Flatpak 导出目录扫描:flatpak 应用进 GUI 应用列表)',
    path: ['appmonitor', 'native-apps.js'],
    // Flatpak 应用不把 .desktop 拷进 /usr/share/applications,而是导出到
    // /var/lib/flatpak/exports/share/applications(系统级)与
    // ~/.local/share/flatpak/exports/share/applications(--user 级)。不扫这两个目录,
    // flatpak 装的 GUI 应用永远不出现在应用列表。expectIn 用 scanDesktopDirs 的
    // .local push(pristine 与所有已打部署版都在,scanDesktopDirs 从未被其他 transform
    // 碰过);expectOut 用 flatpak 导出目录串(打了才出现)→ 独立幂等:即使旧部署已含
    // #36 标记 icon:e.icon||null,本 target 仍会执行;再跑则 expectOut 命中跳过。
    expectIn: 'e.push(path.join(os.homedir(),".local","share","applications"))',
    expectOut: '/var/lib/flatpak/exports/share/applications',
    transform: c => c
      .split('e.push("/usr/share/applications"),e.push("/usr/local/share/applications"),e.push(path.join(os.homedir(),".local","share","applications"))')
      .join('e.push("/usr/share/applications"),e.push("/usr/local/share/applications"),e.push(path.join(os.homedir(),".local","share","applications")),e.push("/var/lib/flatpak/exports/share/applications"),e.push(path.join(os.homedir(),".local","share","flatpak","exports","share","applications"))'),
  },
  {
    name: 'backend.js (#36 GUI 应用 HOME 钉死:Firefox 等复用 ~/.mozilla 配置)',
    path: ['appmonitor', 'backend.js'],
    expectIn: '"use strict";const{listNativeApps,addNativeApp,removeNativeApp,tokenizeExec}=require("./native-apps.js")',
    expectOut: 'HOME:process.env.HOME||os.homedir()',
    // #36 决策 5:launch()(流式预览)与 fullscreen()(native 全屏)都要把 HOME 显式
    // 钉成用户的真实 HOME,否则 appmonitor server(lightdm 启动,可能 HOME 未设/是
    // root)spawn 出去的 GUI 应用会当作全新用户,Firefox 每次开都丢 profile(~/.mozilla
    // 找不到)。两处 env 各加一个 HOME 键;顶部 require 补 os(现仅函数内 require)。
    transform: c => c
      .split('"use strict";const{listNativeApps,addNativeApp,removeNativeApp,tokenizeExec}=require("./native-apps.js")')
      .join('"use strict";const os=require("os"),{listNativeApps,addNativeApp,removeNativeApp,tokenizeExec}=require("./native-apps.js")')
      .split('{DISPLAY:i.display,GTK_IM_MODULE:"fcitx"')
      .join('{DISPLAY:i.display,HOME:process.env.HOME||os.homedir(),GTK_IM_MODULE:"fcitx"')
      .split('{DISPLAY:":0",XCURSOR_THEME:"edex"}')
      .join('{DISPLAY:":0",XCURSOR_THEME:"edex",HOME:process.env.HOME||os.homedir()}'),
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
    // 已打 #36(文件浏览器已去 APPS)→ no-op,幂等。哨兵 /*fs-apps-removed*/ 在三种状态
    // (modal 版 / folder 版 / 全新 pristine)首跑时都会注入,重跑 expectOut 命中跳过。
    expectOut: 'fs-apps-removed',
    // Bug4 文件浏览器闪烁:对"正在显示的目录"再次 readFS(Enter 同一项 / 刷新)时,
    // 每次都会闪 LOADING 再全量重渲染。修复:1) 开头算 _silent(目标 == 当前 dirpath 且
    // 已有列表);_silent 时跳过 LOADING 显示(静默刷新)。2) 读取完成、渲染前算 _sig
    // (name:type:size 指纹),若 _silent 且指纹与上次一致 → 内容没变,直接返回不重渲染。
    // 避免闪一次还白刷屏。首次进入或跨目录时不 silent,行为不变。
    // #36:移除文件浏览器的 APPS 功能(按钮/方法块/apps:// 接线/CSS 全部删净)。#34 曾插过
    // 两种形态(modal 版 FS_APPS_BTN/FS_APPS_METHODS,后升级为 folder 版 FS_APPS_BTN_NEW/
    // FS_APPS_METHODS_FOLDER),这里对两态都做精确子串删除并落到 /*fs-apps-removed*/ 哨兵。
    // 方法块是 this.selected=[],... 逗号赋值链的注入点(FS_APPS_METHODS(_FOLDER) 尾部无 `;`,
    // 以 `,` 续链),删除时连同尾随逗号一起换成哨兵注释(合法 JS,不留悬空逗号)。
    // pristine 版无 APPS 方法块 → 在 FS_CDT_JOIN 前插哨兵,三种输入收敛到同一结果,幂等。
    transform: c => c
      .split("this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>'")
      .join(c.includes('this._fsSig=') ? "this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>'" : "this._silent=e===this.dirpath&&!!this.cwd&&this.cwd.length||(this.filesContainer.innerHTML='<div class=\"fs_loading\"><div class=\"fs_loading_ring\"></div><div class=\"fs_loading_text\">LOADING</div></div>',!1)")
      .split('this.dirpath=t,this.render(this.cwd),this._reading=!1')
      .join(c.includes('this._fsSig=') ? 'this.dirpath=t,this.render(this.cwd),this._reading=!1' : '(this._sig=this.cwd.map(x=>x.name+":"+x.type+":"+(x.size||0)).join("|"),this._silent&&this._sig===this._fsSig?this._reading=!1:(this._fsSig=this._sig,this.dirpath=t,this.render(this.cwd),this._reading=!1))')
      // APPS 删除:按钮两个形态、方法块两个形态各自精确删除 → 哨兵注释。
      .split(FS_APPS_BTN).join('')
      .split(FS_APPS_BTN_NEW).join('')
      .split(FS_APPS_METHODS + ',').join('/*fs-apps-removed*/')
      .split(FS_APPS_METHODS_FOLDER + ',').join('/*fs-apps-removed*/')
      .split(FS_CDT_JOIN).join(c.includes('fs-apps-removed') || c.includes(FS_APPS_METHODS) || c.includes(FS_APPS_METHODS_FOLDER) ? FS_CDT_JOIN : '/*fs-apps-removed*/' + FS_CDT_JOIN)
      // apps:// 接线删净:readFS 短路、渲染三分支改两分支、cdToTerminal 的 apps:// 守卫。
      .split('||"apps://"===e').join('')
      .split(':"network://"===e?this._renderNetworkView():this._renderAppsView()').join(':this._renderNetworkView()')
      .split('"apps://"!==this.dirpath&&').join(''),
  },
  {
    name: 'filesystem.class.js (#62 文件浏览器 AppImage/deb 安装入口)',
    path: ['classes', 'filesystem.class.js'],
    expectIn: 'openFile=(e,t,i)=>{',
    // 幂等标记:_appImagePrompt 方法。src 新构建已烘焙 → 跳过;旧部署版 → 注入。
    expectOut: '_appImagePrompt=',
    // openFile 扩展名分流:OLD(仅 sh/bash/executable)→ NEW(先分流 .appimage→_appImagePrompt、
    // .deb→_debPrompt,再 sh/bash/executable)。FS_METHODS 是逗号链方法块(自身以 `,` 开头、
    // `},` 结尾),插在 runInTerminal 尾 `catch(e){}}}` 与 this.openFileAsText 之间。
    transform: c => c
      .split(FS_METHODS).join('')
      .split(FS_EXT_NEW).join(FS_EXT_OLD)
      .split(FS_EXT_OLD).join(FS_EXT_NEW)
      .split(FS_METHODS_SEAM).join('catch(e){}}}' + FS_METHODS + 'this.openFileAsText='),
  },
  {
    name: 'filesystem.css (#36 去 APPS 按钮/列表样式)',
    path: ['assets', 'css', 'filesystem.css'],
    expectIn: 'button#fs_cd_btn:hover{',
    expectOut: 'fs-apps-removed',
    // #36:删除 APPS 按钮样式 + 全屏应用列表 modal/文件夹行样式。modal 版 FS_APPS_CSS、
    // folder 版 FS_APPS_CSS_NEW 都精确删除 → 哨兵注释;pristine 版无 APPS 样式 → 在 CD 按钮
    // hover 规则前插哨兵,三种输入收敛到同一结果,重跑 expectOut 命中跳过(幂等)。
    transform: c => c
      .split(FS_APPS_CSS).join('/*fs-apps-removed*/')
      .split(FS_APPS_CSS_NEW).join('/*fs-apps-removed*/')
      .split('button#fs_cd_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}')
      .join(c.includes(FS_APPS_CSS) || c.includes(FS_APPS_CSS_NEW) || c.includes('fs-apps-removed') ? 'button#fs_cd_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}' : '/*fs-apps-removed*/button#fs_cd_btn:hover{background:rgba(var(--color_r),var(--color_g),var(--color_b),.35)}'),
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
    // #36(showGui 三元):标记换成三元路由特征串。v3 部署版(恒双 CliPanel)无此串 → 必跑 transform;
    //   已打 #36(showGui 三元)→ 整 target 跳过(幂等)。src 新构建同理 no-op。
    // #50/#58:标记换成 beginCoverSession(#50 cover 方法 / carbonyl 类体的特征串)。已打 #36 的部署版
    //   无此串 → 整链重跑(设计支持幂等 revert→apply),CLI_PANEL_CLASS_NEW_OLD 桥接 + SVT_COVER/
    //   SSVT_HIDE_NEW2 升级;新态有此串 → 跳过。
    // #60(v2.2 SSH 可靠性):标记再换成 `is-active ssh.socket`。v2.1 部署版(有 beginCoverSession、但
    //   refreshStatus 仍查 `is-active ssh`)→ 无此串 → 整链重跑,SSH_OBJ_NEW_OLD revert 后注入 v2.2;
    //   新态(此串)→ 跳过。src 新构建的 _renderer.js 含此串(刷新状态命令),ISO 烘焙同样 no-op。
    // v2.3(socket-only 开关):标记换成命令特征串 `"+a+" ssh.socket")`。v2.2 部署版(有 is-active
    //   ssh.socket、但开关命令仍带 ssh 双 unit)→ 无此串 → 整链重跑,SSH_OBJ_V23_OLD revert 后注入
    //   v2.3(socket-only);新态(此串)→ 跳过。src 新构建的 _renderer.js 含此串(开关命令已改
    //   socket-only),ISO 烘焙同样 no-op。
    expectOut: '"+a+" ssh.socket")',
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
      .split(CLI_FS4_V3_OLD).join(CLI_FS4_OLD)
      .split(CLIRECUR_OLD).join(CLIRECUR_NEW)
      // #29 桥接:27fix(及更早)部署版含旧 CLI 面板类体(无 aerc/图标),既不匹配下面 revert 的
      // 当前 NEW、也不匹配 apply 的 pristine OLD → 会整段跳过(expectOut 前缀还误判"已打")。
      // 先把它还原成当前类体,revert 就能把整块(类+尾部)还原为 pristine,再正常 apply。
      // #34:先试 27fix 整块(旧类体+三元路由)还原为 pristine;未命中才轮到 v2 整块/类体桥接。
      .split(CLI_PANEL_27_OLD).join(CLI_PANEL_OLD)
      .split(CLI_PANEL_CLASS_27).join(CLI_PANEL_CLASS_V3)
      .split(CLI_PANEL_V2_OLD).join(CLI_PANEL_OLD)
      .split(CLI_PANEL_V3_OLD).join(CLI_PANEL_OLD)
      // #50/#58:#36 部署态(类体 = CLI_PANEL_CLASS_NEW_OLD,无 carbonyl/cover 方法)先桥接成
      // 新类体,再与 pristine apply 后状态一致;对 pristine 是 no-op(类体已是 CLI_PANEL_NEW)。
      .split(CLI_PANEL_CLASS_NEW_OLD).join(CLI_PANEL_CLASS_NEW)
      .split('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})'+APPEND)
      .join('document.addEventListener("visibilitychange",()=>{"visible"===document.visibilityState&&resumeFromSuspend()})')
      .split('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}}),ipc.on("system-idle",(e,s)=>{try{window._sysIdleSec=Number(s)||0}catch(_){}})')
      .join('ipc.on("pm:suspend",()=>{try{window.lockScreen&&!window.lockScreen.active&&window.settings&&String(window.settings.lockCode||"").length>0&&!1!==window.settings.lockOnIdle&&window.lockScreen.engage()}catch(e){try{console.error("pm:suspend handler failed:",e&&e.stack||e)}catch(e){}}})')
      .split(SSH_SEC_OLD).join(SSH_SEC_ANCHOR)
      .split(SSH_OBJ_OLD).join(SSH_OBJ_ANCHOR)
      // #36 revert:已注入的 showGui 设置行/对象先还原(行→删,对象→锚点),apply 再无条件重建,
      // 保证重跑收敛。SHOWGUI_OBJ revert 必须在 SSH_OBJ_ANCHOR→NEW 之前(对象含 const v 锚,先还原才不干扰 SSH)。
      .split(SHOWGUI_ROW).join('')
      .split(SHOWGUI_OBJ).join(SHOWGUI_ANCHOR)
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
      // v2.2:当前部署态(默认关行)先 revert 回锚点,再从锚点注入默认开的新行(收敛/幂等)。
      .split(SSH_NET_ROW_OLD).join(SSH_NET_ANCHOR)
      .split(SSH_NET_ANCHOR).join(SSH_NET_ROW)
      // v2:部署版(v2)的 window.ssh 是旧命令(只带 ssh),先 revert 回锚点。
      .split(SSH_OBJ_V2_OLD).join(SSH_OBJ_ANCHOR)
      // v2.1:refreshStatus 仍查 `is-active ssh`(socket 激活下空闲误报 inactive),revert 回锚点。
      .split(SSH_OBJ_NEW_OLD).join(SSH_OBJ_ANCHOR)
      // v2.2:开关命令仍带 ssh 双 unit(socket-only 修复前),revert 回锚点。
      .split(SSH_OBJ_V23_OLD).join(SSH_OBJ_ANCHOR)
      // anchor → v2.3(socket-only 开关)。
      .split(SSH_OBJ_ANCHOR).join(SSH_OBJ_NEW)
      // #36 apply:SHOWGUI_OBJ 挂在 const v 锚点(SSH_OBJ_NEW 尾部同锚,顺序必须在 SSH 之后);
      // SHOWGUI_ROW 无条件插到 apps 分类首行(o("settings.cat.apps"),后)。
      .split(SHOWGUI_ANCHOR).join(SHOWGUI_OBJ)
      .split('o("settings.cat.apps"),').join('o("settings.cat.apps"),'+SHOWGUI_ROW)
      // #31 屏保触发前关闭全部 modal(仅闲置触发路径;startScreensaver 已有此逻辑)。
      .split(SSMODAL_OLD).join(SSMODAL_NEW)
      .split(AM_ROW_OLD).join(AM_ROW_NEW)
      .split(SSH_WIRE_NEW_OLD).join(SSH_WIRE_ANCHOR)
      .split(SSVT_VAR_OLD).join(SSVT_VAR_NEW)
      .split(SSVT_I_OLD).join(SSVT_I_NEW)
      .split(SSVT_SHOW_OLD).join(SSVT_SHOW_NEW)
      .split(SSVT_HIDE_OLD).join(SSVT_HIDE_NEW).split(SSVT_HIDE_NEW).join(SSVT_HIDE_NEW2)
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
      // #50:SVT_OLD→SVT_NEW 旧变换走一遍(pristine),再统一 .split(SVT_NEW).join(SVT_COVER)
      // 升级为 cover session(旧部署 #20 直接命中 SVT_NEW→SVT_COVER)。I_OLD→I_NEW 保留。
      .split(SVT_OLD).join(SVT_NEW).split(SVT_NEW).join(SVT_COVER).split(I_OLD).join(I_NEW)
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
    name: '_renderer.js (#62 应用管理器 window.appManager + 设置分类)',
    path: ['_renderer.js'],
    expectIn: 'window.showGui={apply(){',
    // 幂等标记:appmgr 控制器特征串。src 新构建(prebuild-src 已烘焙)→ 跳过(ISO 烘焙 no-op);
    // 旧部署版(无 window.appManager)→ transform 跑 → 注入控制器 + 设置分类。
    // 控制器挂在 showGui 前(同一逗号表达式链);分类插在 clash 分类前。revert→apply 幂等。
    expectOut: 'window.appManager={_list',
    transform: c => c
      .split(APPMGR_CTRL_FULL).join(APPMGR_ANCHOR)
      .split(APPMGR_CAT_FULL).join(APPMGR_CAT_ANCHOR)
      .split(APPMGR_ANCHOR).join(APPMGR_CTRL_FULL)
      .split(APPMGR_CAT_ANCHOR).join(APPMGR_CAT_FULL),
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
    name: 'appmonitorPanel.class.js (#36 GUI 面板:图标库渲染/去 TYPE/ADD APP 图标/标签)',
    path: ['classes', 'appmonitorPanel.class.js'],
    expectIn: 'class AppMonitorPanel{_dbg(e){',
    expectOut: 'window._ampPickIcon=',
    // #36:tab5(showGui 开时)是 GUI 应用入口。对齐 src 的四处改动:
    //  0) window._ampPickIcon 图标选择回调(注入到 class 声明前);
    //  1) init 无已保存应用时回退选第一个 native(不再只挂空标签),无应用时的回退
    //     标签(init + _fetchStatus 两处)"MONITOR A/B" → "GUI APPS";
    //  2) 菜单条目图标渲染序:iconLibrary 库 id → 内联 SVG;否则 <img src=icon>
    //     (.desktop 路径);否则占位 glyph;
    //  3) ADD APP 手动态:去 TYPE 下拉,改 NAME + PATH/COMMAND + 图标选择
    //     (iconLibrary.pickerModal);submitAdd 带 icon 走 addNative({name,value,icon})。
    // 每个 split 锚应用后即消失 → 幂等;expectOut(_ampPickIcon) 做整体跳过标记。
    transform: c => c
      .split('class AppMonitorPanel{_dbg(e){')
      .join(c.includes('window._ampPickIcon=') ? 'class AppMonitorPanel{_dbg(e){' : 'window._ampPickIcon=e=>{const t=document.getElementById("appmonitor_add_icon");t&&(t.value=e||"");const n=document.getElementById("appmonitor_add_icon_btn");n&&(n.textContent=e?"已选: "+e:"Choose icon…")};class AppMonitorPanel{_dbg(e){')
      .split('const t=e&&this.apps.find(t=>t.name===e);')
      .join('const t=(e&&this.apps.find(t=>t.name===e))||this.apps.find(t=>t.kind==="native")||this.apps[0];')
      .split('"a"===this.monitorId?"MONITOR A":"MONITOR B"')
      .join('"GUI APPS"')
      .split('if(n.className="appmonitor_icon_slot",e.icon){const t=document.createElement("img");t.src=e.icon,n.appendChild(t)}else n.innerHTML=')
      .join('if(n.className="appmonitor_icon_slot",window.iconLibrary&&window.iconLibrary.get(e.icon)){n.innerHTML=window.iconLibrary.get(e.icon)}else if(e.icon){const t=document.createElement("img");t.src=e.icon,n.appendChild(t)}else n.innerHTML=')
      .split('title:"ADD APP — MONITOR "+this.monitorId.toUpperCase()')
      .join('title:"ADD APP"')
      .split('<label>TYPE</label>\\n                    <select id="appmonitor_add_type"><option>native</option><option>web</option></select>\\n                    <label>NAME</label>')
      .join('<label>NAME</label>')
      .split('<label>VALUE</label>\\n                    <input type="text" id="appmonitor_add_value"\\n                           placeholder="AppImage path / command / https:// URL">\\n                </div>')
      .join('<label>PATH / COMMAND</label>\\n                    <input type="text" id="appmonitor_add_value"\\n                           placeholder="AppImage path / command">\\n                    <label>ICON</label>\\n                    <button type="button" id="appmonitor_add_icon_btn" class="settings_net_btn" onclick="window.iconLibrary&&window.iconLibrary.pickerModal(window._ampPickIcon)">Choose icon…</button>\\n                    <input type="hidden" id="appmonitor_add_icon" value="">\\n                </div>')
      .split('i=document.getElementById("appmonitor_add_type")')
      .join('i=document.getElementById("appmonitor_add_icon")')
      .split('i&&"web"===i.value&&/^https?:\\/\\//i.test(n)?window.webapps&&window.webapps.addCustom(s,n):window.appmonitorApi.addNative({name:s,value:n})')
      .join('window.appmonitorApi.addNative({name:s,value:n,icon:i&&i.value?i.value:null})'),
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
    name: 'main_shell.css (注入实心光标:.terminal.xterm 双类选择器)',
    path: ['assets', 'css', 'main_shell.css'],
    expectIn: '.xterm:not(.enable-mouse-events){cursor:text}',
    expectOut: '.terminal.xterm{cursor:url(',
    // #76(round-4):.terminal 与 .xterm 是**同一元素**上的两个 class(终端 DOM 双类),原
    // `.terminal .xterm`(后代选择器)匹配不到 → SVG 实心光标不生效(终端内光标透明)。
    // 基础 AppImage 的 css 里**没有**这条规则(此前笔记本是手工注入),此处直接注入
    // **修复后**的双类选择器版本:`.terminal.xterm` 命中实心光标,
    // `body.cursor_hidden .terminal.xterm` 锁屏/屏保闲置时隐藏。幂等:expectOut 用修复后
    // 标记,已注入则跳过,重跑不叠加。
    transform: c => c
      .split('.xterm:not(.enable-mouse-events){cursor:text}')
      .join('.xterm:not(.enable-mouse-events){cursor:text}' + '.terminal.xterm{cursor:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20d%3D%22M5%202%20L5%2020%20L9.5%2016%20L11.5%2022%20L14.5%2021%20L12.5%2015%20L17.5%2015%20Z%22%20fill%3D%22%23ffffff%22%20stroke%3D%22%23000000%22%20stroke-width%3D%221.4%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E") 2 2,default!important}body.cursor_hidden .terminal.xterm{cursor:none!important}'),
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
      // v2.2:revert 也覆盖 *_NEW(默认开启文案)块,再统一 apply v2.2 文案,重跑幂等。
      .split(ZH_FULL_NEW).join('"settings.cat.updates":"更新",')
      .split(EN_FULL_NEW).join('"settings.cat.updates":"Updates",')
      .split(ZH_FULL).join('"settings.cat.updates":"更新",')
      .split(EN_FULL).join('"settings.cat.updates":"Updates",')
      .split(ZH_FULL_OLD).join('"settings.cat.updates":"更新",')
      .split(EN_FULL_OLD).join('"settings.cat.updates":"Updates",')
      .split(ZH_PARTIAL_NEW).join('"settings.cat.updates":"更新",')
      .split(EN_PARTIAL_NEW).join('"settings.cat.updates":"Updates",')
      .split(ZH_PARTIAL).join('"settings.cat.updates":"更新",')
      .split(EN_PARTIAL).join('"settings.cat.updates":"Updates",')
      .split(ZH_PARTIAL_OLD).join('"settings.cat.updates":"更新",')
      .split(EN_PARTIAL_OLD).join('"settings.cat.updates":"Updates",')
      .split('"settings.cat.updates":"更新",').join(ZH_FULL_NEW)
      .split('"settings.cat.updates":"Updates",').join(EN_FULL_NEW),
  },
  {
    name: '_i18n.js (#62 应用管理器 + 文件浏览器 AppImage/deb 文案)',
    path: ['_i18n.js'],
    expectIn: '"settings.clash.ctrlError":"控制接口无响应（daemon 未运行？）",',
    // 幂等标记:appmgr 分类文案键。src 新构建已烘焙 → 跳过;旧部署版 → 注入。
    expectOut: '"settings.cat.appmgr":"应用管理",',
    // 在 zh/en 父括号 ctrlError 前各插一段 appmgr+fs 键(对象键序无关紧要)。
    // 锚父括号版(#9 起所有构建都烘焙,且不受 SSH i18n target 影响);旧 patch 注入的非父括号
    // 版可能共存(本 target 之前的 SSH target 在更老构建上会注入),不碰它。revert→apply 幂等。
    transform: c => c
      .split(ZH_APPMGR + ZH_CTRL_SEAM).join(ZH_CTRL_SEAM)
      .split(EN_APPMGR + EN_CTRL_SEAM).join(EN_CTRL_SEAM)
      .split(ZH_CTRL_SEAM).join(ZH_APPMGR + ZH_CTRL_SEAM)
      .split(EN_CTRL_SEAM).join(EN_APPMGR + EN_CTRL_SEAM),
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
  {
    // #89 CLI 面板底部黑边:.cli_session 负 inset 已把容器底撑到 shell frame 底,
    // 但 xterm canvas 高 = rows×cellHeight,fit() 向下取整会在容器底留 <1 行高的
    // 空隙(实测 1080p 差 12px,露出黑色)。修复:仅当终端挂在 .cli_session 下时把
    // rows 向上取整到覆盖容器底,溢出部分由 .cli_session 自身 overflow:hidden +
    // clip-path(左下角缺角)裁掉 —— 内容贴 frame 底、缺角保留。普通 tab 不受影响。
    name: 'terminal.class.js (#89 CLI 面板底部黑边:cli_session 行数向上取整)',
    path: ['classes', 'terminal.class.js'],
    expectIn: 'const s=Math.max(1,Math.floor(t.rows));this.term.cols===i&&this.term.rows===s||this.resize(i,s)',
    expectOut: '__edexCliRowsCeil',
    transform: c => c
      // 先 revert 到 pristine(老代已注入过一次的场景防叠加,幂等入口由 expectOut 保证)
      .split('let s=Math.max(1,Math.floor(t.rows));try{const e=this.term.element&&this.term.element.parentElement,a=this.term._core&&this.term._core._renderService&&this.term._core._renderService.dimensions;if(e&&a&&a.actualCellHeight>0&&e.classList&&e.classList.contains("cli_session")){const r=e.getBoundingClientRect();s=Math.max(s,Math.ceil(r.height/a.actualCellHeight));window.__edexCliRowsCeil=1}}catch(e){}this.term.cols===i&&this.term.rows===s||this.resize(i,s)')
      .join('const s=Math.max(1,Math.floor(t.rows));this.term.cols===i&&this.term.rows===s||this.resize(i,s)')
      // 注入:cli_session 容器行数向上取整(见上方注释);锚取 pristine fit 尾串,幂等靠 expectOut。
      .split('const s=Math.max(1,Math.floor(t.rows));this.term.cols===i&&this.term.rows===s||this.resize(i,s)')
      .join('let s=Math.max(1,Math.floor(t.rows));try{const e=this.term.element&&this.term.element.parentElement,a=this.term._core&&this.term._core._renderService&&this.term._core._renderService.dimensions;if(e&&a&&a.actualCellHeight>0&&e.classList&&e.classList.contains("cli_session")){const r=e.getBoundingClientRect();s=Math.max(s,Math.ceil(r.height/a.actualCellHeight));window.__edexCliRowsCeil=1}}catch(e){}this.term.cols===i&&this.term.rows===s||this.resize(i,s)'),
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
const patchedFiles = new Map();   // 同文件多个 target 时缓存累积内容(见下)
for (const t of targets) {
  const entry = getEntry(t.path);
  if (!entry) { console.error(`[patch] ${t.name} not found in asar header`); process.exit(1); }
  // 同一路径可能有多个 target(如 backend.js 有 openbox/fullscreen/HOME 三个)。
  // 若从 orig 按 entry(已被前一个 target 改过 offset)切,会越界读到空串;改用
  // patchedFiles 缓存上一个 target 的累积结果(无缓存才回退原 orig 切片)。
  const cached = patchedFiles.get(t.path.join('/'));
  const content = cached ? cached.toString('utf8')
    : orig.slice(base + parseInt(entry.offset), base + parseInt(entry.offset) + entry.size).toString('utf8');
  if (content.includes(t.expectOut)) { console.log(`[patch] ${t.name} already patched, no-op`); continue; }
  if (!content.includes(t.expectIn)) { console.error(`[patch] unexpected content in ${t.name}: missing \`${t.expectIn}\``); process.exit(1); }
  const patched = t.transform(content);
  const buf = Buffer.from(patched, 'utf8');
  patchedFiles.set(t.path.join('/'), buf);   // 累积缓存:同文件后续 target 基于此继续
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
