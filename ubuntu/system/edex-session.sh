#!/bin/bash
# Runs inside the lightdm X session. openbox is the WM (no decorations — kiosk
# look), Fcitx5 + Rime (小狼毫) are started for Chinese input, then eDEX takes
# the whole screen. The one-time first-boot setup (interface language / timezone
# / unlock PIN) now runs INSIDE the app — classes/firstRun.class.js, triggered by
# the seeded settings.json having no lockCode — so there is no xterm step here.
export DISPLAY=:0
export GTK_IM_MODULE=fcitx
export QT_IM_MODULE=fcitx
export XMODIFIERS=@im=fcitx
# Wake the wireless radio: rfkill can leave it soft-blocked right after a fresh
# install (and some EFI firmware settings hard-block it). NetworkManager handles
# scanning from here on; the WIFI button in eDEX drives nmcli. The rfkill write
# needs root — a plain call from the display user silently fails (the keyboard
# backlight below uses the same sudo -n pattern).
sudo -n rfkill unblock all 2>/dev/null || true
nmcli radio wifi on 2>/dev/null || true
# Realtek RTL8821CE combo card: the Bluetooth half is powered by the ThinkPad
# ACPI radio switch, and rfkill can't flip tpacpi_bluetooth_sw (it stays soft-
# blocked). Write the ACPI + sysfs enable directly so the BT USB device
# enumerates and hci0 registers before eDEX's Bluetooth panel reads it.
sudo -n sh -c 'echo enable > /proc/acpi/ibm/bluetooth' 2>/dev/null || true
sudo -n sh -c 'echo 1 > /sys/devices/platform/thinkpad_acpi/bluetooth_enable' 2>/dev/null || true
# Turn on the keyboard backlight: many laptops boot with it off. The sysfs node
# is root-owned (leds subsystem), so a plain echo from the display user silently
# fails — use passwordless sudo (like edex-brightness.sh), with a direct write as
# fallback. Match any kbd-led name (ThinkPad tpacpi::/thinkpad::, generic kbd_)
# and use the device max so "on" means fully lit, not a fixed guess.
for LED in /sys/class/leds/*kbd*backlight /sys/class/leds/*kbd*led; do
    [ -f "$LED/brightness" ] || continue
    MAX=$(cat "$LED/max_brightness" 2>/dev/null || echo 2)
    echo "$MAX" | sudo -n tee "$LED/brightness" >/dev/null 2>&1 \
        || echo "$MAX" > "$LED/brightness" 2>/dev/null || true
done
# Black the X root window + use the eDEX cursor theme for the gap between the
# lightdm greeter closing and the eDEX window mapping — this is the "white flash
# with the default arrow" seen on real hardware at boot. Once eDEX is up it
# paints its own sci-fi image cursor over the whole screen, so the OS cursor
# only ever shows during this handoff; using the same WP7-style cursor keeps it
# visually consistent with the eDEX overlay (task #7).
xsetroot -solid black 2>/dev/null || true
export XCURSOR_THEME=edex
# Set the root window cursor to the theme's dark arrow immediately (openbox does
# this too once it maps, but doing it here covers the very first frames of X).
xsetroot -cursor_name left_ptr 2>/dev/null || true
openbox --replace >/dev/null 2>&1 &
# Kill Xorg's own screen blanking/DPMS. X ships a ~10-minute idle default that
# physically blanks the display regardless of the app, so on real hardware the
# panel would go dark before eDEX's configured screen-off timeout (and a wake
# keypress would land on whatever the app had up — often the real UI, with no
# lock). eDEX blanks the display itself with the #screen_off overlay at its own
# screenOffIdle, so OS blanking must be fully disabled for that setting to mean
# anything. xset s off + noblank kill the X screen-saver; -dpms stops the
# monitor powering down on its own.
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true
fcitx5 -d >/dev/null 2>&1 &
sleep 1
exec /opt/edex/eDEX-UI.AppImage --no-sandbox
