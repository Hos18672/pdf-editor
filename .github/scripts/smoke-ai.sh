#!/usr/bin/env bash
# Scanner AI on the emulator: in the app's own WebView, run the classical scan worker and the AI
# (UVDoc) worker on a synthetic curved page; record times, the AI decision, memory and the logcat.
set -x
mkdir -p out
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb logcat -c
adb shell am start -n com.rezahossaini.pdfeditor/.MainActivity
sleep 30
python3 .github/scripts/ai-device-test.py
sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
if [ -n "$sock" ]; then
  adb forward tcp:9222 "localabstract:$sock"
  CDP_TIMEOUT=600000 node .github/scripts/cdp-eval.mjs @out/ai-test.js | tee out/ai-result.txt
fi
adb shell dumpsys meminfo com.rezahossaini.pdfeditor | head -40 | tee out/meminfo.txt
adb exec-out screencap -p > out/after.png
adb shell pidof com.rezahossaini.pdfeditor | tee -a out/ai-result.txt
adb logcat -d > out/logcat.txt
grep -nE "FATAL|AndroidRuntime|chromium.*(Error|error)|OutOfMemory|lowmemorykiller" out/logcat.txt | head -80
exit 0
