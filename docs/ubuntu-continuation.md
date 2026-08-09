# Ubuntu 端交接清单(给下一台 Ubuntu/真机上的 Claude)

> 2026-08-09 生成。本文件是 Ubuntu 侧继续工作的**总入口**:把「未完成」「等待验证」「总体功能 + UI 综合测试」三件事一次性交接给在 Ubuntu/ThinkPad E580 上继续的 Claude。
>
> 详细背景请对照:
> - **状态权威清单** → `docs/first-boot-issues.md`(真机首启问题表,本文件所有 # 号即该表行号)
> - **改动与验证步骤权威清单** → `docs/ubuntu-side-changes.md`(每节 = 一个功能的 OS/App 改动 + 真机验证方法)
>
> 所有「待装验」项都以 **`docs/ubuntu-side-changes.md` 对应小节**为准,本节只给顺序与重点。

---

## 0. 当前仓库/构建状态(2026-08-09)

- **分支**: `main`。最近功能提交:`d1252e6`「feat: built-in mihomo proxy (#46) + centralized updates hub (#47)」(6 文件,+895/−17)。
- **版本**: `src/package.json` 已升 **2.3.8**(此前长期停在 2.2.9,导致 App 永远提示「有新版本」)。GitHub latest release/tag 停在 **v2.3.7**。
- **CI 出 ISO 方式**(`.github/workflows/release.yml`,打在 `v*` tag 上):
  1. `release` job 构建 x64 AppImage + sha256 → 挂到该 tag 的 GitHub Release(供 App 内 UpdateChecker 用)。
  2. `iso` job 用该 AppImage 重打 Ubuntu Server ISO → **~4.9GB**,因 GitHub 单资产 2GB 上限不能挂 Release,**只能作为 workflow artifact 下载**。
  3. 配了阿里云 OSS secret 时同一 ISO 会镜像一份(国内快、永久链接)。
- **本批附带 bugfix**(已 CDP 验证):`_boot.js` `bundledClaudeVersion` 对 ENOEXEC 未处理会抛未捕获 rejection;`clash:update` 对无参调用解构 `{url}` 抛 TypeError。两处已加固。
- **tag 命名规则**: `git tag v<版本>` 且必须等于 `src/package.json` version(去 `v`),否则版本比较失效。

### 安全注意(全项目硬性约束)

- 阿里云 OSS bucket 名/完整 URL **绝不能**写进 README/公开文档/CI 日志/commit(仓库是 public,commit search 会暴露)。
- AccessKey Secret 绝不粘贴到聊天。
- 日志只准含 object path,不准含完整 URL。

---

## 1. 出 ISO(本批已在 Mac 侧触发,Ubuntu 侧只消费产物)

1. Mac 侧已推 `v2.3.8` tag → CI 自动跑 `release.yml`。
2. Ubuntu 侧要做的:
   - 等 Actions 跑完(约 40–60 分钟)。
   - 从 **Actions 运行页的 artifact**(不是 Release assets)下载 ISO(~4.9GB)。配置了 OSS 时,镜像在阿里云 OSS(路径见 CI 日志,勿把链接写进任何 public 文件)。
   - 用 `dd`/Ventoy 烧到 U 盘,插 ThinkPad E580 UEFI 启动。
   - 若 CI 失败:先看 `iso` job 日志;`build-iso.sh` 里的 mihomo/metacubexd/geo 与模型 bake 都是 **best-effort(WARN 不中断)**,确认没有把关键内容(如 AppImage 替换、squashfs)静默跳过。

---

## 2. 未完成工作(仍需真机/编码,按优先级)

### 2.1 需真机才能做的(ThinkPad E580)

| # | 事项 | 入口 | 做法 |
|---|------|------|------|
| #128 | **安装器 subiquity 崩溃** `load_autoinstall_data` | ubuntu-side-changes §8 | 用 v2.3.8 ISO 真机装一遍;若仍崩,抓 traceback(`dmesg` / 安装器日志)发回。**这是出 ISO 后第一个要确认的**——装不上后面全没意义 |
| #11 | GRUB 报 `file '/boot/' not found` | §4 | 装饰性(签名 grubx64.efi 内嵌配置),不影响引导。低优先级,想清可做,否则记录跳过 |
| #19 + #142 | **plymouth 开机动画**(#19 恢复、#142 换 eDEX 品牌) | §1 | install-edex.sh 已配 quiet splash + update-initramfs;真机开机看动画是否出现且品牌化。若没动画:确认 `plymouth` 包、`initramfs` 已更新、GRUB 参数 |
| #139 | 笔记本电量不显示(upower + sysfs 兜底) | §11 | 真机看时钟旁电量 % + 状态;插拔电源看实时变化 |
| #140 | 电源键按下应弹电源菜单而非直接关机 | §10 | 真机按电源键 → 应弹 eDEX 电源菜单;长按(>5s)走固件断电(正常)。若直接关机:看 logind `HandlePowerKey` 谁在响应,改 install-edex.sh 的 edex.conf |
| #144 | 中文输入无候选框(盲打) | §3 | 真机打字,Ctrl+Space 切中 → 候选窗应为黑底青字。按 §3 里的「候选窗渲染确认」三步排查(fcitx5-diagnose、是否有独立 fcitx 窗口、IM 上下文) |
| #145 | Show disks 显示未挂载 U 盘 + 点击挂载 | §12 | 插 U 盘 → Show disks 应列出未挂载设备;点击自动挂载(udisksctl,polkit);无反应就把 app 终端报错发回 |

### 2.2 代码层未完成(可在 Ubuntu 侧继续编码)

- **app 列表过滤设置项**(first-boot-issues #11 后半):过滤逻辑已实现,但「设置里可配置过滤规则(可执行命令行)」的设置项**未加**。当前 `CATS` 有 7 个分类:general / network / clash / updates / power / performance / downloads(+ time、files 视版本)。新增设置项沿用 `settingsRow()` + `writeSettingsFile()` 浅合并模式。
- **#56 无电池机器上电量显示**:逻辑已有 upower/sysfs 兜底,若目标机器无电池需确认 UI 不报错并显示合理占位。
- **clash/updates 真机 Phase C 验证后的微调**:见 §3.7 清单,若有偏差回填到 `_boot.js` / `_renderer.js`(改完按 Mac 流程 CDP 验证再同步 src,见 §5)。

---

## 3. 等待验证(全部「已修,待装验」,一次重装可过多项)

> 装完 v2.3.8 后按这个顺序过,能省多次重装。每项完整步骤在 ubuntu-side-changes.md 对应小节。

1. **§2 WiFi**(#13):联网正常、设置-网络分类能连接/断开/已保存/忘记/代理。
2. **§3 输入法**(#16+#55):EN/中 切换、拼音候选框、Ctrl+Space。
3. **§9 首启向导**(#132, v2.3.5 起应用内 code 锁屏风格):首次进系统直接看到 SETUP TERMINAL 框;完成语言/时区/PIN 进桌面,Welcome back 显示真实用户名(#143)。
4. **§7 7z**(#48):文件浏览器右键 Compress to .7z / Extract Archive;命令行 `7z` 兜底。
5. **§10 电源键**(#140)+ **§11 电量**(#139)+ **§12 U 盘挂载**(#145):见 2.1。
6. **§13 clash + 更新**(#46/#47)Phase C:见下方 3.7 专项。
7. **§6 装机后完整自检清单**:WiFi / Claude / Rime / plymouth / 时间 / XDG 目录 / 电源 / 网络栈 / 7z —— 建议首启跑一遍,逐项打勾。
8. **first-boot-issues.md 其余「已修(源码/打包,待装验)」行**:#4 时间、#5 语音(模型已烘焙)、#7 XDG 目录、#8 用户名、#9 启动动画、#10 虚拟显示器、#15 键盘背光/触摸板、#17 光标、#18/19 屏保代码、#20 电量、#21 终端滚动、#22/26/31 锁屏流程、#23 光标自动隐藏、#24/25 合盖挂起恢复、#27 性能控制器、#28 时区、#29 亮度音量、#30 光标 45°、#37/50 电量分级、#51 日期、#52 电源管理、#53 固件、#54 屏幕熄灭时序、#55 输入法。
   - 这 20+ 项里**建议挑高风险的真机项优先**:#54(屏灭/锁屏时序)、#24/25(合盖挂起恢复后点击失效)、#31(开机进锁屏)、#5(语音模型)。

### 3.7 clash/updates 真机验证专项(#46/#47 Phase C)

按 ubuntu-side-changes.md §13 逐项:

1. 二进制与配置就位:`/opt/edex/mihomo`(含 geo)与 `/usr/local/bin/mihomo` 存在,`mihomo -v` 可跑。
2. 设置-网络(或 clash 分类)启用 clash → 自动 start + 设系统代理,期望 `nmcli con show` 里 proxy `manual / 127.0.0.1:7890 / 127.0.0.1:7890 / ignore=127.0.0.1,localhost,::1`。
3. 面板:设置 → clash →「打开面板」→ 全屏 webview 加载 `http://127.0.0.1:9090/ui/`,能正常打开(**无代理循环** = ignore-servers 生效)。
4. 订阅:填机场 URL → 拉取 → config.yaml 被替换并重启;`curl -s https://api.ip.sb/geoip` 出口 IP 应为机场节点。
5. 内网绕过:终端 `ws://127.0.0.1:3000` 连接不受代理影响。
6. 更新:更新分类 → mihomo 检查/更新(换 `/usr/local/bin/mihomo` + 重启);App 检查更新(v2.3.8 已 == 最新,应显示 up-to-date);系统更新 → apt 全量升级。
7. 关 clash → 恢复 `settings.clash.preProxy`;再开 → 重新捕获。
8. **若 webview 流量不走 nmcli 代理**(Chromium 读 GSettings 而非 NM 连接代理):`gsettings set org.gnome.system.proxy mode manual` + `host 127.0.0.1` + `port 7890`(标记为备选方案)。

### 3.8 本批已 CDP 验证、真机再确认一次

- **设置 7 分类 UI**(general/network/clash/updates/power/performance/downloads):分类切换、键盘导航(方向键/Enter/Esc)、持久化到 settings.json。
- **clash 分类 mock 态**(macOS 预览显示 NO_BINARY/不可用;真机应显示真实状态)。
- **updates 分类**:手动「检查更新」内联结果、系统更新 modal、内置程序状态行。
- **UPDATE 按钮路由**:设置页顶部 UPDATE → 跳到「更新」分类(不再直接开 apt modal)。

---

## 4. 总体功能 + UI 综合测试清单(装机后全量回归)

> 通过 = 按描述能完成且无报错;失败 = 记录现象 + app 终端报错(在 `~/.config/eDEX-UI/` 或运行日志)。UI 全键盘可操作是硬性要求(方向键+Enter+Esc)。

### 4.1 开机/首启流程
- [ ] GRUB 菜单暗色、无红色报错(#11 除外,装饰性)
- [ ] plymouth 开机动画(eDEX 品牌)出现
- [ ] 进 eDEX 全屏壳,无白屏/原生光标闪现
- [ ] 首启(无 settings.json):SETUP TERMINAL 向导 → 语言/时区/PIN → 桌面
- [ ] 重开(有 PIN):开机进锁屏,输密码后进 UI(#31);Welcome back 显示真实用户名
- [ ] 时钟左上角电量显示 + 日期,字体与 UI 一致

### 4.2 锁屏/屏保/电源
- [ ] Win+L / 电源菜单 Lock Screen → 先屏保后锁屏,解除需 PIN
- [ ] matrix 屏保瀑布保持原样不重载;code 屏保假代码随机不循环
- [ ] 解锁:问候语消失 → 加载真 UI,无残留假 UI/终端文字(#141 回归)
- [ ] 锁屏 30s 无操作 → 自动回屏保(带消失动画)
- [ ] 电源菜单:SHUTDOWN / RESTART / SLEEP / SCREENSAVER 全部可用(#26 重设计后)
- [ ] 锁屏/屏保下电源键:matrix → 熄屏;code → 电源菜单(#148)
- [ ] 合盖 → 挂起;开盖 → 恢复后锁屏,鼠标可点(#24/25)
- [ ] 屏幕熄灭超时:到点才熄,唤醒直接进锁屏/屏保而非真实 UI(#54)
- [ ] 光标:屏保/锁屏隐藏,静置 10s 隐藏,移动恢复;造型 45° < 荧光

### 4.3 终端
- [ ] 首 tab 可输入(无空白/无 setAttribute 报错)#13/14/23/62
- [ ] 长内容滚轮/方向键/滑动滚动;滚动速度可设(#21)
- [ ] 多 tab 切换;输入法 EN/中 切换 + 候选框(#144)
- [ ] 解锁后 scrollback 不丢(#141)
- [ ] 终端右键/复制文本到文件浏览器粘贴(#147)

### 4.4 文件浏览器
- [ ] 默认标签连上 XDG 目录(#7);Show disks 列出磁盘 + 未挂载 U 盘(#145)
- [ ] 右键:新建文件夹 / info 属性(#49);Compress to .7z / Extract Archive(#48)
- [ ] 可执行文件(.sh/可执行位)点击 → 确认运行(#146);文本文件可复制粘贴到终端(#147)
- [ ] 锁屏/屏保下文件浏览器显示虚假内容且不可点击(#69/85);解锁后刷新(#79)

### 4.5 虚拟显示器(tab 4/5)
- [ ] 不黑屏(#10);app 列表只显示用户应用(#21 过滤)
- [ ] 面板加载(clash 面板 / 自定义 webapp);全屏 webview 进出
- [ ] Claude tab:退出后留在本 tab 显示错误,不跳走擦除(#138)

### 4.6 设置菜单(7 分类)
- [ ] 分类切换 + 侧边栏序号 + 键盘导航全通(方向键/Enter/Esc);重复打开不叠加监听
- [ ] general:用户名(GECOS 真名 #8)、主题、语言、锁屏密码(输入校验 #94)
- [ ] network:WiFi 开关/详情/列表/已保存/忘记/断开、蓝牙全套、代理(自动|无|手动)
- [ ] clash:开关/状态/订阅拉取/打开面板/日志(§3.7)
- [ ] updates:App 检查更新 / 系统更新(apt 流式)/ 内置程序状态(§3.7)
- [ ] power:屏保/锁屏/熄屏超时、屏保类型、性能档(背光/轻触/电量分级 #15/27/37)
- [ ] performance:CPU 档(cpupower governor)、风扇安静度
- [ ] downloads:下载列表管理(#45)
- [ ] 修改 → 保存 → 重启后设置仍在(settings.json 持久化)

### 4.7 系统功能
- [ ] WiFi 连接/断开/已保存/忘记 + 代理设置生效(§2)
- [ ] 时间:实时状态/时区/手动设时间/联网同步(#14)
- [ ] 亮度/音量滑块 + Fn 键全可用(#29);键盘背光 + 轻触点按(#15)
- [ ] 语音输入:按钮可用,离线 ASR 有响应(#5,模型已烘焙)
- [ ] 7z 命令行 `7z` 可用;性能控制器切换 governor
- [ ] Claude CLI:`claude --version` 输出版本;服务商预设可配(#116)

### 4.8 更新与升级路径
- [ ] App 自更新:设置 → updates → 检查更新;有新版本 → Update 走 sha256 校验替换
- [ ] 系统更新:apt 全量升级流式输出;成功后在 updates 分类显示「上次更新」时间戳
- [ ] mihomo 更新:updates 分类 → mihomo 检查/更新(§3.7)

---

## 5. 开发工作流(Ubuntu 侧改 App 代码时)

eDEX-UI 是 Electron 应用(`src/`),系统层在 `packaging/`。

1. **改 → 本地跑**: `cd src && npm install && npx electron .`(或打包后跑 AppImage)。真机上直接跑源码需要依赖齐全。
2. **验证**:改 UI/IPC 最好用 CDP 预览(9222 端口)做交互验证;真机用系统日志 + app 终端。
3. **提交规范**:conventional-commit、英文、main 分支直接推;CI 只在打 `v*` tag 时出 ISO。
4. **clash/updates 改动注意**:主进程 IPC 在 `_boot.js` `app.on('ready')`,渲染端对象在 `_renderer.js`;i18n 键在 `_i18n.js`(zh/en 缺一不可);新设置项走 `CATS` + `settingsRow()` + `writeSettingsFile()` 浅合并。
5. **文档同步**:修完真机问题回填 `docs/ubuntu-side-changes.md` 对应小节的状态列,并把 first-boot-issues.md 的「待装验」翻成「已验证」。

---

## 6. 诊断速查(真机上)

```bash
# WiFi
nmcli device wifi list; nmcli radio; rfkill list; dmesg | grep -i iwl

# 输入法
fcitx5-diagnose | head -60; pgrep -a fcitx5

# 电量
upower -i /org/freedesktop/UPower/devices/battery_BAT0; ls /sys/class/power_supply/

# 代理
nmcli con show; gsettings get org.gnome.system.proxy mode

# mihomo
mihomo -v; mihomo -t -f ~/.config/edex-proxy/config.yaml; ls /opt/edex/mihomo/

# 更新/版本
cat /opt/firefox/browser/application.ini | grep Version; claude --version

# App 日志
ls -t ~/.config/eDEX-UI/ | head; journalctl -u edex -n 200
```
