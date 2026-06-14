#!/usr/bin/env bash
# Build Rubberduck.app — a menu-bar wrapper around the local dashboard.
#
# Compiles the Swift sources directly (not via SwiftPM) into a .app bundle and
# ad-hoc signs it so it runs on this machine. Requires a working Swift toolchain
# with the macOS SDK — full Xcode is recommended; the standalone CommandLineTools
# 16.4 SDK has a broken module map (duplicate SwiftBridging) that fails to import
# AppKit. If you hit that, install Xcode and:
#   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
#
# Usage:
#   ./build.sh          # build build/Rubberduck.app
#   ./build.sh --run    # build, then open it
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Rubberduck.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"

echo "==> compiling"
rm -rf build
mkdir -p "$MACOS" "$CONTENTS/Resources"
swiftc -O \
  -framework AppKit -framework WebKit -framework UserNotifications -framework Foundation \
  -o "$MACOS/Rubberduck" \
  Sources/Rubberduck/*.swift

echo "==> writing Info.plist"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Rubberduck</string>
  <key>CFBundleDisplayName</key><string>Rubberduck</string>
  <key>CFBundleIdentifier</key><string>com.rubberduckhq.menubar</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>Rubberduck</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <!-- Menu-bar app: no Dock icon, no main window on launch. -->
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>RubberDuckHQ</string>
</dict>
</plist>
PLIST

echo "==> ad-hoc signing (runs locally; not notarized for distribution)"
codesign --force --deep --sign - "$APP"

echo "==> done: $APP"
if [[ "${1:-}" == "--run" ]]; then
  open "$APP"
fi
