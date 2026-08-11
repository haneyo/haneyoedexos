#!/usr/bin/env bash
# Build out-of-tree WiFi drivers for the kernel baked into the base squashfs and
# bake them (plus blacklists of the broken in-tree counterparts) into the image.
#
# WHY: several very common WiFi chips are driven poorly or not at all by the
# Ubuntu 24.04 (kernel 6.8) in-tree drivers:
#   - RTL8821CE (ThinkPad E580, 10ec:c821): rtw88_8821ce binds but can't scan —
#     floods the log with "PCIe Bus Error: Correctable Physical Layer" and the
#     interface stays "unavailable", so `nmcli device wifi list` is always empty.
#   - RTL8822CE / RTL8821CU / RTL8822CU / RTL8821AU / 88x2bu (RTL8822BU/8812BU) /
#     RTL8188EU / RTL8192EU / RTL8812AU / RTL8723BU / RTL8723DU: in-tree support
#     is partial or flaky (rtw88 has no USB support at all on kernel 6.8);
#     Realtek's own drivers are the reliable fix.
#   - RTL8852AU / RTL8852BU / RTL8852CU (WiFi 6 USB): kernel 6.8's rtw89 cannot
#     bind them — the out-of-tree driver is their only option.
#   - Broadcom BCM43142/BCM4360/BCM4352: the in-tree b43/brcmsmac cannot drive
#     them; the proprietary 'wl' driver (multiverse broadcom-sta) is required.
# Wired Ethernet (r8169/e1000e/igc/alx + USB r8152) is already fully covered by
# the in-tree drivers + linux-firmware, so nothing extra is needed there.
#
# Runs INSIDE the target rootfs (chroot or proot). The kernel to build for is
# taken from /lib/modules — NOT `uname -r`, which inside a chroot reports the
# build host's kernel, not the target's.
#
# Best-effort by design: every failure logs a WARN and continues; a driver that
# never ships a .ko does not abort the ISO. Blacklists are written ONLY for
# drivers whose .ko actually landed, so a failed build leaves the in-tree driver
# available rather than nothing at all.
set -u
export DEBIAN_FRONTEND=noninteractive

log()  { echo "[edex] wifi: $*"; }
warn() { echo "[edex] wifi: WARN: $*"; }

KVER="$(ls /lib/modules 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -n1)"
log "target kernel: ${KVER:-<none>}"
[ -n "$KVER" ] || { warn "no kernel in /lib/modules — skipped"; exit 0; }

# One dependency install for ALL drivers: headers for the EXACT target kernel
# (not linux-headers-generic, which would resolve to a different build) plus a
# compiler. --no-install-recommends keeps it lean.
if ! apt-get install -y --no-install-recommends "linux-headers-$KVER" build-essential \
        >/tmp/edex-wifi-deps.log 2>&1; then
    warn "deps install failed for $KVER"
    tail -5 /tmp/edex-wifi-deps.log
    exit 0
fi
[ -d "/lib/modules/$KVER/build" ] || { warn "kernel build symlink missing after deps — skipped"; exit 0; }

# Build one driver from a GitHub source tarball into /lib/modules/$KVER/extra/
# (the out-of-tree dir, which wins alias resolution over the in-tree kernel/ dir
# in modules.dep). KVER/KSRC on the command line override each repo's
# `$(shell uname -r)` so the module targets the chroot kernel, not the host's.
# $1 = name, $2 = tarball URL, $3+ = in-tree module names to blacklist once it
# lands.
build_driver() {
    local name="$1" url="$2"; shift 2
    curl -fsSL -o "/tmp/${name}-src.tar.gz" "$url" \
        || { warn "$name: download failed — skipped"; return 0; }
    rm -rf "/opt/${name}-src" && mkdir -p "/opt/${name}-src"
    tar -xzf "/tmp/${name}-src.tar.gz" -C "/opt/${name}-src" --strip-components=1 \
        || { warn "$name: extract failed — skipped"; return 0; }
    ( cd "/opt/${name}-src" \
        && make -j"$(nproc)" KVER="$KVER" KSRC="/lib/modules/$KVER/build" \
            >"/tmp/${name}-make.log" 2>&1 ) \
        || { warn "$name: make failed"; tail -8 "/tmp/${name}-make.log"; return 0; }
    # Install EVERY module the repo built — some ship several (e.g. 88x2bu
    # produces both 8822bu.ko and 8812bu.ko) and a device may match any of them.
    local n=0 ko
    while IFS= read -r ko; do
        install -D -m 644 "$ko" "/lib/modules/$KVER/extra/$(basename "$ko")" && n=$((n+1))
    done < <(find "/opt/${name}-src" -name '*.ko' -type f)
    [ "$n" -gt 0 ] || { warn "$name: no .ko produced"; return 0; }
    depmod -a "$KVER"
    for bl in "$@"; do
        echo "blacklist $bl" >> "/etc/modprobe.d/${name}.conf"
    done
    log "$name: installed $(basename "$ko"), blacklisted: $*"
}

# Realtek 88x1c/88x2c family — PCIe (8821ce/8822ce) and USB (8821cu/8822cu),
# very common on budget laptops and cheap USB dongles. rtw88 (in-tree) drives the
# PCIe cards poorly (8821CE on the E580 binds but cannot scan); in kernel 6.8
# rtw88 has NO USB support, so the USB chips rely on these drivers entirely. We
# blacklist only the specific in-tree glue module each one replaces — never the
# shared core (rtw88_8821c/8822c), which would kill the sibling PCIe driver.
build_driver rtl8821ce "https://github.com/tomaspinho/rtl8821ce/archive/refs/heads/master.tar.gz" rtw88_8821ce
build_driver rtl8822ce "https://github.com/rtlwifi-linux/rtk_wifi_driver_rtl8822ce/archive/refs/heads/master.tar.gz" rtw88_8822ce
build_driver rtl8821cu "https://github.com/morrownr/8821cu-20210916/archive/refs/heads/main.tar.gz" rtw88_8821cu
build_driver rtl8822cu "https://github.com/libc0607/rtl88x2cu-20230728/archive/refs/heads/main.tar.gz" rtw88_8822cu

# Realtek USB dongles (cheap WiFi for desktops) + WiFi 6 (8852). The in-tree
# rtl8xxxu covers some of these but flakily, so the Realtek drivers take over
# everything it would claim. 8852au/bu/cu are USB-only chips that kernel 6.8's
# rtw89 cannot bind at all — the out-of-tree driver is their only option, and we
# deliberately do NOT blacklist rtw89: that would disable the in-tree PCIe
# 8852ae/8852be/8852ce cards, which work fine.
build_driver rtl8821au "https://github.com/morrownr/8821au-20210708/archive/refs/heads/main.tar.gz" rtl8xxxu
build_driver 88x2bu "https://github.com/morrownr/88x2bu-20210702/archive/refs/heads/main.tar.gz" rtl8xxxu
build_driver rtl8188eu "https://github.com/aircrack-ng/rtl8188eus/archive/refs/heads/master.tar.gz" rtl8xxxu
build_driver rtl8192eu "https://github.com/clnhub/rtl8192eu-linux/archive/refs/heads/master.tar.gz" rtl8xxxu
build_driver rtl8812au "https://github.com/morrownr/8812au-20210820/archive/refs/heads/main.tar.gz" rtl8xxxu
build_driver rtl8723bu "https://github.com/lwfinger/rtl8723bu/archive/refs/heads/master.tar.gz" rtl8xxxu
build_driver rtl8723du "https://github.com/lwfinger/rtl8723du/archive/refs/heads/master.tar.gz" rtl8xxxu
build_driver rtl8852au "https://github.com/lwfinger/rtl8852au/archive/refs/heads/dwa-x1850.tar.gz"
build_driver rtl8852bu "https://github.com/morrownr/rtl8852bu-20250826/archive/refs/heads/main.tar.gz"
build_driver rtl8852cu "https://github.com/morrownr/rtl8852cu-20251113/archive/refs/heads/main.tar.gz"

# Broadcom BCM43142/BCM4360/BCM4352 (older Dell/HP/Lenovo laptops): the source
# ships inside the multiverse broadcom-sta-dkms package. Built against the
# target kernel like everything else; b43/brcmsmac blacklisted once wl.ko lands.
build_broadcom() {
    local deb
    deb="$(apt-get download --print-uris broadcom-sta-dkms 2>/dev/null | sed -n "s/^'\([^']*\)'.*/\1/p" | head -n1)"
    [ -n "$deb" ] || { warn "broadcom: package URI not found — skipped"; return 0; }
    curl -fsSL -o /tmp/broadcom-sta.deb "$deb" \
        || { warn "broadcom: deb download failed — skipped"; return 0; }
    rm -rf /opt/broadcom-pkg && mkdir -p /opt/broadcom-pkg
    dpkg-deb -x /tmp/broadcom-sta.deb /opt/broadcom-pkg \
        || { warn "broadcom: deb extract failed"; return 0; }
    local src
    src="$(find /opt/broadcom-pkg/usr/src -maxdepth 1 -type d -name 'broadcom-sta-*' | head -n1)"
    [ -n "$src" ] || { warn "broadcom: source dir not found — skipped"; return 0; }
    ( cd "$src" && make -C "/lib/modules/$KVER/build" M="$src" \
        >/tmp/broadcom-make.log 2>&1 ) \
        || { warn "broadcom: make failed"; tail -8 /tmp/broadcom-make.log; return 0; }
    local n=0 ko
    while IFS= read -r ko; do
        install -D -m 644 "$ko" "/lib/modules/$KVER/extra/$(basename "$ko")" && n=$((n+1))
    done < <(find "$src" -maxdepth 1 -name '*.ko' -type f)
    [ "$n" -gt 0 ] || { warn "broadcom: no wl.ko produced"; return 0; }
    depmod -a "$KVER"
    cat > /etc/modprobe.d/broadcom-sta.conf <<'BCM'
blacklist b43
blacklist b43legacy
blacklist ssb
blacklist brcmsmac
blacklist bcma
BCM
    log "broadcom: installed $(basename "$ko"), in-tree b43/brcmsmac blacklisted"
}
build_broadcom

# Reclaim the build-only packages (all modules are compiled and depmod'ed).
apt-get purge -y build-essential "linux-headers-$KVER" "linux-headers-${KVER%-generic}" >/dev/null 2>&1 || true
apt-get autoremove -y >/dev/null 2>&1 || true
apt-get clean >/dev/null 2>&1 || true
exit 0
