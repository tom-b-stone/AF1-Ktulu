#!/bin/bash
# Builds "AF1 Notch.app" with the Command Line Tools (no Xcode) and puts it in ~/Applications.
# Unsigned (ad-hoc): for this Mac. Needs `brew install webp` for the WebP encoding.
set -euo pipefail
cd "$(dirname "$0")"
APP="build/AF1 Notch.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -parse-as-library -target arm64-apple-macos14.0 AF1Notch.swift -o "$APP/Contents/MacOS/AF1Notch"
cp Info.plist "$APP/Contents/Info.plist"
codesign --force --deep -s - "$APP"
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/AF1 Notch.app"
cp -R "$APP" "$HOME/Applications/"
echo "Built: $HOME/Applications/AF1 Notch.app"
