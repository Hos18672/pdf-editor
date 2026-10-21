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
    node .github/scripts/cdp-eval.mjs "JSON.stringify({ safeT: getComputedStyle(document.documentElement).getPropertyValue('--safe-t'), safeB: getComputedStyle(document.documentElement).getPropertyValue('--safe-b'), h: innerHeight, dpr: devicePixelRatio })" | tee -a out/flow.txt
    # text recognition prerequisites inside the WebView: bundled files over XHR (file://) and a blob worker
    node .github/scripts/cdp-eval.mjs "new Promise((r) => { const x = new XMLHttpRequest(); x.open('GET', location.href.replace(/[^/]*$/, '') + 'tesseract/deu-lstm.bin'); x.responseType = 'arraybuffer'; x.onload = () => { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(typeof WebAssembly)']))); w.onmessage = (e) => r('xhr ' + x.status + ' ' + x.response.byteLength + ' worker ' + e.data); w.onerror = () => r('worker error'); }; x.onerror = () => r('xhr error'); x.send(); })" | tee -a out/flow.txt
    node .github/scripts/cdp-eval.mjs "window.__peOcrTest().then((t) => 'ocr: ' + t, (e) => 'ocr failed: ' + e)" | tee -a out/flow.txt
    # tap the first text line with a real touch and check the page shrinks above the on-screen keyboard
    adb shell settings put secure show_ime_with_hard_keyboard 1
    pos=$(node .github/scripts/cdp-eval.mjs "(() => { const r = document.querySelector('.run').getBoundingClientRect(); return Math.round((r.left + 6) * devicePixelRatio) + ' ' + Math.round((r.top + r.height / 2) * devicePixelRatio); })()" | tr -d '"')
    echo "tap at $pos" | tee -a out/flow.txt
    adb shell input tap $pos
    sleep 4
    adb exec-out screencap -p > out/keyboard.png
    node .github/scripts/cdp-eval.mjs "JSON.stringify({ editing: !!document.querySelector('.run.editing'), h: innerHeight, slimbarBottom: Math.round(document.querySelector('.slimbar')?.getBoundingClientRect().bottom ?? -1), safeB: getComputedStyle(document.documentElement).getPropertyValue('--safe-b') })" | tee -a out/flow.txt
  else
    adb shell input keyevent BACK
  fi
fi
# dark mode last: on the emulator it restarts Play Services, which can take the app down with it
adb shell am start -n com.rezahossaini.pdfeditor/.MainActivity
adb shell "cmd uimode night yes" || true
sleep 8
adb exec-out screencap -p > out/start-dark.png
adb logcat -d > out/logcat.txt
grep -E "ReactNativeJS|chromium" out/logcat.txt | head -100
adb shell dumpsys webviewupdate > out/webview.txt || true
exit 0
