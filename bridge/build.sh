#!/bin/sh
# Build bridge/AppleMCPBridge.app, the TCC identity for the Python bridges.
# See bridge/launcher.c for why it exists.
#
# The bundle is ad-hoc signed, so TCC pins its grants to this exact binary.
# Rebuilding produces a new signature and the Calendar/Contacts prompts will
# appear again, so an up-to-date bundle is left alone unless --force is given.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
app="$here/AppleMCPBridge.app"
exe="$app/Contents/MacOS/AppleMCPBridge"

if [ "${1:-}" != "--force" ] && [ -x "$exe" ] \
  && [ "$exe" -nt "$here/launcher.c" ] \
  && [ "$app/Contents/Info.plist" -nt "$here/Info.plist" ]; then
  echo "AppleMCPBridge.app is up to date (use --force to rebuild)"
  exit 0
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$here/Info.plist" "$app/Contents/Info.plist"
xcrun clang -O2 -Wall -Wextra -o "$exe" "$here/launcher.c"
codesign --force --sign - --identifier com.dcpurnell.apple-mcp.bridge "$app"
codesign --verify --strict "$app"
echo "Built $app"
