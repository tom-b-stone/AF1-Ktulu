#!/bin/bash
# Builds "AF1 Notch.app" with the Command Line Tools (no Xcode), installs it in
# ~/Applications and puts the download for Ktulu (Asset Uploader → Mac app) in
# public/downloads/af1-notch.zip. Ad-hoc signed, not notarized.
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
rm -f ../public/downloads/af1-notch.zip
ditto -c -k --keepParent "$APP" ../public/downloads/af1-notch.zip
echo "Built: $HOME/Applications/AF1 Notch.app and public/downloads/af1-notch.zip"
