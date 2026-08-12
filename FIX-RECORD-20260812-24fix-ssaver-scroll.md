# 交接文档 — 24fix:CODE 屏保假代码不再中途整屏清屏,改为自然滚动(2026-08-12)

> 记录「CODE 屏保假代码跑到一半就不见了,然后从头再跑」的根因、修复与验证、部署。
> 任务清单唯一权威 = 根目录 [`TODOS.md`](TODOS.md)。

---

## §1 用户反馈

CODE 屏保的假代码**跑到屏幕一半就不见了,然后又从头开始跑**。用户要求:假代码应当是
**连贯自然的**(像真终端持续滚动),而不是每隔几行整屏重来。

---

## §2 根因

屏保绘制函数 `I()`(packaging/patch-appimage.sh 的 `I_NEW`)每个 tick(100ms)写一行假代码,
但**每 10 行就发一次整屏清屏序列**:

```js
// 旧 I_NEW(22fix 起):
const I=()=>{if(!Vt||!Vt.write)return;try{
  const _c=++S%10==0?"[2J[H":"";   // ← 每 10 行:清整屏 + 光标回原点
  Vt.write(_c+E()+"\r\n")
}catch(e){}};
```

`ESC[2J ESC[H` = **清屏 + 光标回到(1,1)**。终端约 34 行,每 10 行就整屏清一次 → 假代码永远
只显示最上面几行就被抹掉、回到顶部重来 → 用户看到的「跑到一半不见了,又从头跑」。

### 来历与必要性
- 这是 20fix 时代的**遗留策略**:当时 pty 还是 canonical+ECHO 行缓冲,写大量行会被攒批吐
  出,靠每 10 行清屏配合行缓冲「刷」屏幕(22fix 记录 §6 已注明「raw pty 下已无必要,保留
  无害——如用户觉得清屏太频繁可改为只滚不清」)。
- 22fix 已把 pty 改成 `stty raw -echo` 直通模式,行写入实时回显,清屏的原始动机**已不存在**;
  现在清屏只剩副作用(每 10 行整屏重来)。
- **锁屏不受影响**:锁屏画的是 ASCII 框(`_drawLockBox`/`_writeLockLine`),不含这种周期整屏
  清屏逻辑,一行未动。

---

## §3 修复(packaging/patch-appimage.sh 的 `I_NEW`,1 处)

删除周期整屏清屏,`I()` 只做「写一行 → 终端自然上滚」:

```js
// 新 I_NEW:
const I=()=>{if(!Vt||!Vt.write)return;try{Vt.write(E()+"\r\n")}catch(e){}};
```

效果:
- 每 100ms 一行假代码,从底部冒出来,旧行自然向上滚动消失 —— 与真实终端跑程序一致,连贯自然;
- 屏幕写满后照常滚动(底进顶出),不再任何时刻整屏清空;
- `E()`(假代码行生成)、`S` 计数器(现仅 `let S=0` 残留,无引用、无害)、`Vt`(真实 pty 终端)
  其余逻辑一律不动。

---

## §4 验证

- 从 pristine 基线 `/opt/edex/eDEX-UI.AppImage.orig-20260811` 构建成功
  → **`/tmp/eDEX-UI.AppImage.24fix-20260812`**(185092858B)。
- 产物 4 文件(`_renderer.js`=157313B、`lockScreen.class.js`=24401B、
  `terminal.class.js`=12930B、`_boot.js`=54198B)`node --check` **全部通过**。
  (注:asar 提取需按 4 字节对齐基址 `round_up(16+headerSize,4)` 才得到完整文件,否则开头
  多 2 字节上一文件残尾、`node --check` 误报失败。)
- 关键标记:
  - `I()` 现为 `const I=()=>{if(!Vt||!Vt.write)return;try{Vt.write(E()+"\r\n")}catch(e){}};`
    —— 已无 `++S%10` / `ESC[2J ESC[H` 清屏;
  - 全文件 grep `[2J[H` **0 处**;
  - `#22` `cli:["sh","-c","stty raw -echo; exec cat"]` 仍在 `_renderer.js`(1 处);
  - `#22` 两个覆盖层 div(`screensaver_vt` / `lock_virt_term`)的**不透明背景**仍在;
  - `#22` `muted:!0` 音效开关仍在。
- **幂等**:24fix 产物再跑一遍 patch 脚本 → 全部 target "already patched, no-op"。

---

## §5 部署(需重启 eDEX,会杀掉当前会话)

> 按铁律:**先写交接文档 → 再推 GitHub → 最后才重启**。本会话运行在 eDEX 进程树内,重启即
> 杀掉本会话,故此处不代做,交给用户/下个会话执行。本产物包含 #20+#21+#22+#23+#24 全部
> 改动,直接替换即可。

```bash
sudo systemctl stop lightdm
sudo pkill -f eDEX-UI.AppImage
sudo cp /tmp/eDEX-UI.AppImage.24fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
sudo systemctl start lightdm
```

> 重启前建议先 `sudo cp /tmp/eDEX-UI.AppImage.24fix-20260812 /opt/edex/` 留存一份。
> 验证要点:进 CODE 屏保,假代码应从底部持续冒出、向上自然滚动,**任何时刻不再整屏清空重来**;
> 屏保期间真终端内容完全被遮住(#22)、无乱码/双行/空行。

---

## §6 遗留待办

> 唯一权威 = [`TODOS.md`](TODOS.md)。本节仅记本轮范围外相关项:
> - 若还想让假代码「滚动若干屏后做一次整体过渡」,可在 `I()` 里把清屏换成
>   `ESC[H`(仅回原点)或 `ESC[3J`(仅清 scrollback),保留滚动连续性;本轮按用户要求
>   「连贯自然」取纯滚动。
> - 其余(内置 BTOP/AXEL/CLASH 增强/FASTFETCH/FFMPEG/超负荷红光闪烁、#2 滚动、
>   #4 appmonitor、#174 用户名、#183 开机过渡)→ 见 TODOS.md。
