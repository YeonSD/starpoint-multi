#!/bin/sh
set -eu

CDN_TARGET="${CDN_DIR:-/app/.cdn}"
BUILTIN_MODS="/app/mods"

if [ -d "$BUILTIN_MODS" ]; then
    mkdir -p "$CDN_TARGET/mods"
    for mod in "$BUILTIN_MODS"/*.zip; do
        [ -e "$mod" ] || continue
        cp "$mod" "$CDN_TARGET/mods/$(basename "$mod")"
    done
fi

exec node out/server.js
