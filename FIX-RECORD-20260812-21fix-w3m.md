# 21fix 完成记录(2026-08-12,TAB5 Browser w3m 裸启动秒退)

> 一行代码修复。构建基线:`/opt/edex/eDEX-UI.AppImage.orig-20260811`(铁律:必须从 pristine orig 出发)。

## 根因

- tab5(实际 tab 索引 4 = MONITOR B)是 #10 改的 CLI 会话面板,默认应用列表 `window.cliApps`
  里 `{ id:"w3m", name:"Browser", cmd:["w3m"] }`。
- `w3m` **裸启动(不带 URL)会立刻打印 usage 并 exit(1)**,即使有真实 pty 也一样(已实测)。
  会话秒关 → CLI 面板的 `_startSession` 收到 `onclose` → 销毁 div → 用户看到"浏览器没运行"。
- 与 spawn 链路无关(claude/htop 会话均正常)。带 URL 时 w3m 稳定存活(已实测 example.com、
  DuckDuckGo,网络 HTTP 200)。

## 修复

- `packaging/patch-appimage.sh` `CLI_PANEL_CLASS`:w3m 默认命令 `["w3m"]` →
  `["w3m","https://lite.duckduckgo.com/lite"]`(lite 版,文本浏览器最轻)。
- 已提交 `4390b97` 并推 GitHub。
- 已从 pristine orig 重建 AppImage:**`/opt/edex/eDEX-UI.AppImage.21fix-20260812`**(185092858B)。
  新旧 `_renderer.js` 逐字节对比:**唯一差异 = 该 URL**,`node --check` 通过,无回归。

## 部署(需重启 eDEX,会杀掉当前会话)

```bash
sudo cp /opt/edex/eDEX-UI.AppImage.21fix-20260812 /opt/edex/eDEX-UI.AppImage
sudo chmod 755 /opt/edex/eDEX-UI.AppImage
# 重启 eDEX:重启前本会话(运行在 eDEX 进程树内)会被杀死,先读本文件再接续。
# 参考流程: sudo systemctl stop lightdm; sudo pkill -f eDEX-UI.AppImage;
#           sudo systemctl start lightdm
```

## 待办衔接

- **#20 锁屏/屏保改独立真实终端** —— 用户已确认 CODE 屏保/锁屏未修好,新方案(engage
  `ttyspawn` 新建真实终端 + unlock 销毁)零代码。见 `FIX-RECORD-20260812-10fix-handover.md` §5。
- 终端复制用户已确认可用(#9 的复制部分闭环);滚动(#5)、文本选择剩余待确认。
- app monitor 填满的 openbox `--config→--config-file` 修复已在补丁内(backend.js target),
  但 appMonitor 默认禁用未真机验证。
