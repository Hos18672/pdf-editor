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
# native file picker: tap "Open PDF", pick the pushed sample, check the editor opens it
adb push test/fixtures/sample.pdf /sdcard/Download/sample.pdf
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/sample.pdf || true
if [ -n "$sock" ]; then
  node .github/scripts/cdp-eval.mjs "document.querySelector('.s2-cta').click(), 'clicked'" | tee out/flow.txt
  sleep 6
  adb shell dumpsys window | grep -E "mCurrentFocus" | tee -a out/flow.txt
  adb exec-out screencap -p > out/picker.png
  adb shell uiautomator dump /sdcard/picker.xml && adb pull /sdcard/picker.xml out/picker.xml
  xy=$(python3 -c "
import re,sys
s=open('out/picker.xml').read()
m=re.search(r'text=\"sample\.pdf\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]', s)
print('' if not m else f'{(int(m[1])+int(m[3]))//2} {(int(m[2])+int(m[4]))//2}')")
  echo "sample.pdf at: $xy" | tee -a out/flow.txt
  if [ -n "$xy" ]; then
    adb shell input tap $xy
    sleep 12
    adb exec-out screencap -p > out/editor.png
    sock2=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
    adb forward tcp:9222 "localabstract:$sock2"
    node .github/scripts/cdp-eval.mjs "JSON.stringify({ runs: document.querySelectorAll('.run').length, file: document.querySelector('.fname')?.textContent, errors: window.__pageErrors })" | tee -a out/flow.txt
  else
    adb shell input keyevent BACK
  fi
fi
adb logcat -d > out/logcat.txt
grep -E "ReactNativeJS|chromium" out/logcat.txt | head -100
adb shell dumpsys webviewupdate > out/webview.txt || true
exit 0
