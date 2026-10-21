#!/usr/bin/env bash
# Runs inside the emulator job: install, launch, capture screen, logcat and the WebView state.
set -x
mkdir -p out
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb logcat -c
adb shell am start -n com.rezahossaini.pdfeditor/.MainActivity
sleep 30
adb exec-out screencap -p > out/start.png
sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
echo "devtools socket: $sock"
if [ -n "$sock" ]; then
  adb forward tcp:9222 "localabstract:$sock"
  node .github/scripts/cdp.mjs > out/webview-state.txt 2>&1 || true
  cat out/webview-state.txt
fi
adb shell "cmd uimode night yes" || true
sleep 8
adb exec-out screencap -p > out/start-dark.png
adb logcat -d > out/logcat.txt
grep -E "ReactNativeJS|chromium" out/logcat.txt | head -100
adb shell dumpsys webviewupdate > out/webview.txt || true
exit 0
