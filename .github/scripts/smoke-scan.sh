#!/usr/bin/env bash
# Scanner on the emulator: tap Scan on the start screen, see what opens, keep the logcat (crashes).
set -x
mkdir -p out
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell pm grant com.rezahossaini.pdfeditor android.permission.CAMERA || true
adb logcat -c
adb shell am start -n com.rezahossaini.pdfeditor/.MainActivity
sleep 25
sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
adb forward tcp:9222 "localabstract:$sock"
node .github/scripts/cdp-eval.mjs "(() => { const b = [...document.querySelectorAll('button, .s2-chip')].find((e) => /^\s*Scan\s*$/.test(e.textContent || '')); if (!b) return 'no scan button'; b.click(); return 'clicked ' + b.className; })()" | tee out/flow.txt
for t in 3 8 15; do sleep 5; adb exec-out screencap -p > out/scan-$t.png; adb shell dumpsys window | grep -E "mCurrentFocus" | tee -a out/flow.txt; done
adb shell pidof com.rezahossaini.pdfeditor | tee -a out/flow.txt
sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
if [ -n "$sock" ]; then adb forward tcp:9222 "localabstract:$sock"; node .github/scripts/cdp-eval.mjs "JSON.stringify({ native: !!document.querySelector('.sc-native'), cam: !!document.querySelector('.scam'), errors: window.__pageErrors })" | tee -a out/flow.txt; fi
adb logcat -d > out/logcat.txt
grep -nE "FATAL|AndroidRuntime|DocumentScan|mlkit|MlKit|ReactNativeJS|chromium.*(Error|error)" out/logcat.txt | head -150
exit 0
