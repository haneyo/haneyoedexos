# eDEX-OS · 真机运行时系统配置

> 本目录是 **真机(E580 / 任何跑 eDEX-OS 的机器)** 上实际生效的系统级配置快照,
> 与 `src/` 里的应用代码是**两层**:下面这些文件由 `install/install-edex.sh` 落到
> 系统里,负责把 Ubuntu 会话调成「开机直接进 eDEX 全屏」的 kiosk 形态。
> 装好之后手工改过的,也同步回这里(见 `FIXES-2026-08-11.md`)。

| 文件 | 真机落点 | 作用 |
|---|---|---|
| `edex-session.sh` | `/usr/local/sbin/edex-session.sh` | lightdm X 会话入口:`DISPLAY=:0`、fcitx5+Rime 输入法环境变量、`rfkill` 唤醒 WiFi、键盘背光、黑屏过渡 + DMZ-Black 光标、openbox 无装饰 WM、`xset` 关屏保/DPMS,最后 `exec eDEX-UI.AppImage --no-sandbox`。 |
| `zz-edex-autologin.conf` | `/etc/lightdm/lightdm.conf.d/zz-edex-autologin.conf` | 开机免登录:autologin 到 `edex` 用户、`edex` 会话、autologin 不等待。 |
| `edex.desktop` | `/usr/share/xsessions/edex.desktop` | 声明 `eDEX-OS` 这个 X session,Exec 指向 `edex-session.sh`。 |
| `settings.json.template` | `~/.config/eDEX-UI/settings.json` | eDEX 应用配置模板。**密钥已用占位符替换**:`claude.apiKey` → `<your-api-key>`、`lockCode` → `<your-pin>`。部署到真机前请替换成自己的值。 |

## 部署/还原到一台新机器

```bash
# 假设已安装 eDEX-OS(install-edex.sh 跑过),登录到 edex 用户:
sudo cp edex-session.sh        /usr/local/sbin/edex-session.sh && sudo chmod 755 /usr/local/sbin/edex-session.sh
sudo cp zz-edex-autologin.conf /etc/lightdm/lightdm.conf.d/zz-edex-autologin.conf
sudo cp edex.desktop           /usr/share/xsessions/edex.desktop
cp settings.json.template      ~/.config/eDEX-UI/settings.json   # 先替换 apiKey / lockCode
sudo systemctl restart lightdm
```

> ⚠️ 重启 lightdm 会杀掉正在运行的 eDEX 会话(以及里面开的终端/Claude)。真机操作时
> 先在别的终端做好交接,或直接重启整机。

## 为什么会有这层

eDEX-UI 本身只是一个 Electron AppImage。要让开机**直接**进它而不是先看到桌面,
需要 X 层配合:lightdm 自动登录 → 一个自定义 session 脚本把输入法/WM/关屏策略备好 →
再 exec AppImage。这些文件就是那一层。代码层面(eDEX 应用内)的修改见
`../FIXES-2026-08-11.md` 和 `../packaging/patch-appimage.sh`。
