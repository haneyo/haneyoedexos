#!/usr/bin/env bash
# 把 fcitx5 候选框配色/字体同步到 eDEX 当前主题
#
# 读 eDEX settings.json 里的当前主题 → 读 themes/<theme>.json 的主色/底色/字体
# → 生成 ~/.config/fcitx5/conf/classicui.conf(仅本版 fcitx5 支持的键)
#    + 更新 /usr/share/edex/fcitx5/themes/default/theme.conf(fcitx5 实际加载的 default 主题)
# → 热加载 fcitx5。
#
# 背景(本版 fcitx5 定制限制):
#   libclassicui.so 只识别 NormalColor/HighlightColor/HighlightBackgroundColor/
#   BorderColor/BorderWidth/PerScreenDPI/UseDarkTheme 这几个键,
#   Theme/DarkTheme/Font/NormalBackgroundColor/SpellHintColor/ShadowColor 会被忽略;
#   fcitx5 始终加载 "default" 主题,并优先搜 XDG 数据目录 /usr/share/edex/fcitx5/themes/。
#
# 用法:  bash sync-fcitx5-theme.sh
# 在 eDEX 里切换主题后运行一次即可;也可配合 inotify 自动跟随。

set -uo pipefail

SETTINGS="$HOME/.config/eDEX-UI/settings.json"
THEMES_DIR="$HOME/.config/eDEX-UI/themes"
FCITX_CONF="$HOME/.config/fcitx5/conf/classicui.conf"
SYSTEM_THEME="/usr/share/edex/fcitx5/themes/default/theme.conf"

# ---------- 1. 读当前 eDEX 主题名 ----------
if [ ! -f "$SETTINGS" ]; then
    echo "⚠️  找不到 $SETTINGS,跳过(非 eDEX 环境?)"
    exit 0
fi
THEME=$(python3 -c "import json;print(json.load(open('$SETTINGS')).get('theme','tron'))" 2>/dev/null)
THEME="${THEME:-tron}"
THEME_JSON="$THEMES_DIR/$THEME.json"
if [ ! -f "$THEME_JSON" ]; then
    echo "⚠️  主题文件不存在: $THEME_JSON,跳过"
    exit 1
fi

# ---------- 2. 解析配色与字体 ----------
# 输出用 | 分隔,避免含空格字体名(font_main)被 read 按空格拆错位
# 字段: r|g|b|black|light_black|grey|font_family|term_fg|term_bg
IFS='|' read -r r g b black light_black grey font_family term_fg term_bg <<< "$(
python3 -c "
import json,sys
t=json.load(open('$THEME_JSON'))
c=t.get('colors',{})
term=t.get('terminal',{})
def hx(v,d):
    if isinstance(v,str) and v.startswith('#'): return v
    return d
print(
  c.get('r',170), c.get('g',207), c.get('b',209),
  hx(c.get('black'),'#000000'), hx(c.get('light_black'),'#000000'), hx(c.get('grey'),'#262828'),
  term.get('fontFamily','Fira Mono'),
  term.get('foreground',''), term.get('background',''),
  sep='|'
)
" 2>/dev/null
)"

# 兜底
r="${r:-170}"; g="${g:-207}"; b="${b:-209}"
black="${black:-#000000}"; light_black="${light_black:-#000000}"; grey="${grey:-#262828}"
font_family="${font_family:-Fira Mono}"

# 主色 hex(小写)
main_hex=$(printf '#%02x%02x%02x' "$((10#$r))" "$((10#$g))" "$((10#$b))")

# 底色:用户偏好黑色。优先主题 black;若 black 近似纯黑则保持,否则也归一到纯黑
# (主题里 black 多为 #000000 / 接近黑的深色,这里统一为纯黑 + 无边框,保证通配)。
bg_hex="#000000"

# 高亮块 = 主色;高亮文字 = 黑(反色,同 eDEX 选中态)
hi_bg="$main_hex"
hi_fg="$bg_hex"
# 普通候选文字 = 主色;普通底 = 黑
norm_fg="$main_hex"
norm_bg="$bg_hex"

# ---------- 3. 字体 ----------
FONT_SIZE=$(python3 -c "import json;print(json.load(open('$SETTINGS')).get('termFontSize',14))" 2>/dev/null)
FONT_SIZE="${FONT_SIZE:-14}"
# 族名去掉常见字重后缀,避免 "Fira Mono Medium" 解析成找不到的族名
font_family=$(echo "$font_family" | sed -E 's/[[:space:]]+(Regular|Medium|Light|Bold|SemiBold|Semibold|Italic|Book|Thin|Black)$//I')
[ -z "$font_family" ] && font_family="Fira Mono"

# ---------- 4. 写 classicui.conf(只用本版 fcitx5 支持的键) ----------
mkdir -p "$(dirname "$FCITX_CONF")"
cat > "$FCITX_CONF" <<EOF
[Appearance]
UseDarkTheme=False
NormalColor=${norm_fg}
HighlightColor=${hi_fg}
HighlightBackgroundColor=${hi_bg}
PerScreenDPI=False
EOF

# ---------- 5. 更新 /usr/share/edex 的 default 主题(黑底/无边框/主题色/主题字体) ----------
sudo tee "$SYSTEM_THEME" > /dev/null <<EOF
[Metadata]
Name=Default
Name[zh_CN]=默认(eDEX 风格)
Version=1
Author=eDEX-OS
Description=eDEX-OS styled default theme (black panel, no border). Synced from active eDEX theme.
ScaleWithDPI=True

[InputPanel]
Font=${font_family} ${FONT_SIZE}
NormalColor=${main_hex}
HighlightColor=${bg_hex}
PageButtonAlignment=Last Candidate

[InputPanel/TextMargin]
Left=6
Right=6
Top=5
Bottom=5

[InputPanel/ContentMargin]
Left=0
Right=0
Top=0
Bottom=0

[InputPanel/Background]
Image=
Color=${bg_hex}
BorderColor=${bg_hex}
BorderWidth=0
Opacity=1

[InputPanel/Background/Margin]
Left=0
Right=0
Top=0
Bottom=0

[InputPanel/Highlight]
Image=
Color=${main_hex}

[InputPanel/Highlight/Margin]
Left=2
Right=2
Top=2
Bottom=2

[InputPanel/PrevPage]
Image=

[InputPanel/NextPage]
Image=

[Menu]
NormalColor=${main_hex}
HighlightColor=${bg_hex}

[Menu/Background]
Image=
Color=${bg_hex}
BorderColor=${bg_hex}
BorderWidth=0

[Menu/Background/Margin]
Left=0
Right=0
Top=0
Bottom=0

[Menu/Highlight]
Image=
Color=${main_hex}

[Menu/Highlight/Margin]
Left=2
Right=2
Top=2
Bottom=2

[Menu/ContentMargin]
Left=0
Right=0
Top=0
Bottom=0

[Menu/TextMargin]
Left=4
Right=4
Top=3
Bottom=3
EOF

# ---------- 6. 热加载 fcitx5 ----------
if fcitx5-remote -r 2>/dev/null || DISPLAY=:0 fcitx5-remote -r 2>/dev/null; then
    echo "✅ fcitx5 候选框已同步为 eDEX 主题 [${THEME}]"
    echo "   底色=${norm_bg}  字色=${norm_fg}  高亮=${hi_bg}  字体=${font_family} ${FONT_SIZE}"
else
    echo "⚠️  fcitx5-remote 不可达,请手动重启 fcitx5"
fi
