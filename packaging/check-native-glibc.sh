#!/usr/bin/env bash
# check-native-glibc.sh — fail the build if a native module needs a newer glibc
# than the eDEX-OS base system.
#
# WHY: node-pty has no linux-x64 prebuild in its npm tarball, so `npm install`
# falls back to node-gyp and compiles pty.node on the build machine. The moment
# GitHub moved `ubuntu-latest` to ubuntu-26.04 (2026-10-28), that compile picked
# up GLIBC_2.42 symbols while the ISO ships Ubuntu 24.04 (glibc 2.39). The
# AppImage then cannot dlopen pty.node on the target, `require` of the terminal
# class throws during startup, no window is ever created, and the machine boots
# to a black screen with only a mouse cursor (v2.4.54/55/56 ISOs).
#
# Run this on the tree electron-builder is about to package (prebuild-src/),
# AFTER the native rebuild, and before uploading/publishing anything.
#
#   bash packaging/check-native-glibc.sh prebuild-src [max-glibc]
#
# Default max-glibc is 2.39 (Ubuntu 24.04). Files that are not ELF (the win32 /
# darwin prebuilds node-pty also ships) contain no GLIBC_ symbols and are
# skipped automatically.
set -uo pipefail

DIR="${1:?usage: check-native-glibc.sh <node_modules-dir> [max-glibc]}"
MAX="${2:-2.39}"
[[ -d "$DIR" ]] || { echo "[glibc] missing directory: $DIR" >&2; exit 1; }

# version_le A B → true when A <= B (V-sort, so 2.9 < 2.39 < 2.42)
version_le() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ]; }

bad=0
checked=0
while IFS= read -r f; do
    # Highest GLIBC_x.y the binary actually references.
    need="$(grep -ao 'GLIBC_[0-9][0-9]*\.[0-9][0-9]*' "$f" 2>/dev/null \
        | sed 's/^GLIBC_//' | sort -V | tail -1)"
    [[ -n "$need" ]] || continue          # not ELF, or statically linked
    checked=$((checked + 1))
    if version_le "$need" "$MAX"; then
        echo "[glibc] OK $f needs glibc $need"
    else
        echo "::error file=$f::needs glibc $need but the ISO ships $MAX — build on an older runner/container"
        echo "[glibc] FAIL $f needs glibc $need > $MAX"
        bad=1
    fi
done < <(find "$DIR" -type f -name '*.node')

if [[ $bad -ne 0 ]]; then
    echo "[glibc] $checked native module(s) checked — at least one will not load on the target system." >&2
    exit 1
fi
echo "[glibc] $checked native module(s) checked, all <= glibc $MAX"
