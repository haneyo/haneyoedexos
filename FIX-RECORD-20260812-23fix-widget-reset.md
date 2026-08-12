# 交接文档 — 23fix:周期性 widget 重置后左右列消失(2026-08-12)

> 记录「系统闲置一段时间(默认 90 分钟)后,左右侧 UI 组件消失」的根因、修复与验证、部署。
> 任务清单唯一权威 = 根目录 [`TODOS.md`](TODOS.md)。

---

## §1 用户反馈

系统放着一段时间后(闲置约 90 分钟),左右侧的 UI 组件消失——**只剩:终端、文件浏览器、
DATA STREAM、雷达**。即 `#mod_column_left` / `#mod_column_right` 里的全部 widget
(clock / sysinfo / hardwareInspector / cpuinfo / ramwatcher / toplist / netstat / globe /
conninfo)整列不见了,cyber 面板与主终端完好。

---

## §2 根因

补丁 `packaging/patch-appimage.sh` 的「修复 4(#12 卡顿)→ 周期性部件层无感重置」在渲染进程
注入了一段 `_edexWidgetReset()`:

```js
// 每 periodicResetMinutes(默认 90)分钟,在用户闲置 ≥60s 时:
//  1) _edexDestroy 清掉所有 widget 的 interval/timeout/rAF;
//  2) 把左右两列的非 H3 子节点全部 removeChild(仅保留 PANEL title);
//  3) mods[k] = _edexCtor[k]() 重建 9 个 widget 实例。
```

**缺失环节**:widget 的挂载方式(widget 构造器内 `parent.innerHTML += ...`)新建的 div 继承
CSS `.mod_column > div { opacity:0; animation-name:fadeIn; animation-play-state:paused;
animation-fill-mode:forwards }` —— 默认 opacity:0 + **动画暂停**。只有开机时的 reveal
序列(`reRevealUI`,逐个把 `style.animationPlayState="running"` 触发 fadeIn)才会显示。
`_edexWidgetReset` 重建后**没有触发 reveal**,所以新 widget 永远停在 opacity:0 → 左右列
整列空。

### 时间线(与现象完全吻合)
- 本机 eDEX 17:27 启动;闲置约 90 分钟 → 第一次 `_edexWatch` 于 **~18:57** 触发
  `_edexWidgetReset()` → widget div 被删、重建但不显示 → 用户 ~19:0x 反馈左右列消失。
- 实测截图:整屏 84% 为纯背景 `#05080d`、右侧列亮像素 0.4%,左右列 widget 全部缺失;
  模拟鼠标移动唤醒后仍未恢复(确认是 DOM 被删,不是被覆盖/隐藏)。
- renderer 进程 ~79% CPU 持续 1 小时以上——这是 **CODE 屏保**用 echo/canonical pty 持续流式
  写入 1.5h、每 10 行整屏清屏被回显成乱码导致反复整屏重绘所致,由 **#22**(raw pty +
  覆盖层不透明背景)一并解决,与本 bug 独立。

---

## §3 修复(packaging/patch-appimage.sh 的 APPEND 常量,1 处)

在 `_edexWidgetReset` 的**重建循环之后**,追加与开机 reveal 相同机制的触发:

```js
["mod_column_left","mod_column_right"].forEach(function(cid){try{
  var col=document.getElementById(cid);if(!col)return;
  var kids=col.children;
  for(var j=0;j<kids.length;j++){
    var el=kids[j];
    if(el&&"H3"!==el.tagName){try{el.style.animationPlayState="running"}catch(e){}}
  }
}catch(e){}});
```

效果:重建后的每个 widget div 的 `animation-play-state` 被置 `running` → 0.5s fadeIn →
`fill-mode:forwards` 停在 opacity:1 → 列恢复显示。**终端/文件浏览器/DATA STREAM/雷达零影响**;
`_edexDestroy` 与列清理逻辑一行未动。

> 注:首次编辑时注释里含反引号(`` `.mod_column > div` ``),而 APPEND 是反引号模板字符串,
> 反引号截断导致构建报 `ReferenceError: div is not defined`。已去掉注释中的反引号后构建通过。

---

## §4 验证

- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建成功
  → **`/tmp/eDEX-UI.AppImage.23fix-20260812`**(185092858B)。
- 产物 4 文件(`_renderer.js`=157348B、`lockScreen.class.js`=24401B、
  `terminal.class.js`=12930B、`_boot.js`=54198B)`node --check` 全部通过。
- 关键标记:
  - `#23` `el.style.animationPlayState="running"` 出现在 `_renderer.js`(重置函数内,重建后)1 处;
  - `#22` `cli:["sh","-c","stty raw -echo; exec cat"]` 仍在 `_renderer.js` 与
    `lockScreen.class.js` 各 1 处;
  - `#22` 两个覆盖层 div 的不透明背景仍在。
- **逻辑单测(模拟 DOM)**:重建后 9 个 widget div 的 `animationPlayState` 全部为 `running`
  (PASS),列内 div 数左 6 右 3 符合预期。
- **幂等**:23fix 产物再跑一遍 patch 脚本 → "nothing to patch, asar left untouched"。

---

## §5 部署(需重启 eDEX,会杀掉当前会话)

> 按铁律:**先写交接文档 → 再推 GitHub → 最后才重启**。本会话运行在 eDEX 进程树内,重启即
> 杀掉本会话,故此处不代做,交给用户/下个会话执行。本产物包含 #20+#21+#22+#23 全部改动,
> 直接替换即可(若之前 #22 已部署,本次只是在其基础上加 #23)。

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.23fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.23fix-20260812 /opt/edex/` 留存一份。
> 验证要点:闲置 >90 分钟后左右列应仍在(重置后自动重新淡入);CODE 屏保无乱码/双行/空行、
> 不遮真终端(#22)。

---

## §6 遗留待办

> 唯一权威 = [`TODOS.md`](TODOS.md)。本节仅记相关项:
> - 周期性重置开关 `settings.periodicResetMinutes`(0 关闭,缺省 90)。若用户发现 90 分钟
>   一次的整列淡入略扎眼,可调大或关闭。
> - 其余(内置 BTOP/AXEL/CLASH 增强/FASTFETCH/FFMPEG/超负荷红光闪烁、#2 滚动、
>   #4 appmonitor、#174 用户名、#183 开机过渡)→ 见 TODOS.md。
