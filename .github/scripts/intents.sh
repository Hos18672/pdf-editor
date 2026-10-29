#!/usr/bin/env bash
# Emulator checks for the share sheet, "Open with", shortcuts and the widget.
set -x
P=com.rezahossaini.pdfeditor
mkdir -p out
{
  echo "== who handles a shared picture / PDF / PDF view"
  adb shell cmd package query-activities --brief -a android.intent.action.SEND -t image/jpeg | grep -i pdfeditor
  adb shell cmd package query-activities --brief -a android.intent.action.SEND -t application/pdf | grep -i pdfeditor
  adb shell cmd package query-activities --brief -a android.intent.action.VIEW -t application/pdf -d content://x/y.pdf | grep -i pdfeditor
  echo "== widget provider"
  adb shell dumpsys appwidget | grep -i -A2 pdfeditor | head -12
} > out/intents.txt 2>&1
# a picture in the media store, shared to "Convert to PDF"
adb push test/fixtures/scan-photo.jpg /sdcard/Pictures/scan-photo.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/scan-photo.jpg
sleep 4
id=$(adb shell content query --uri content://media/external/images/media --projection _id --where "_display_name=\'scan-photo.jpg\'" | grep -o '_id=[0-9]*' | head -1 | cut -d= -f2)
echo "media id: $id" >> out/intents.txt
adb shell am force-stop $P
adb shell am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM "content://media/external/images/media/$id" --grant-read-uri-permission -n $P/.ConvertToPdf >> out/intents.txt 2>&1
sleep 20
adb exec-out screencap -p > out/share-convert.png
adb shell dumpsys window | grep -E "mCurrentFocus" >> out/intents.txt
# the same picture to the editor itself
adb shell am force-stop $P
adb shell am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM "content://media/external/images/media/$id" --grant-read-uri-permission -n $P/.MainActivity >> out/intents.txt 2>&1
sleep 20
adb exec-out screencap -p > out/share-edit.png
# shortcuts (the app has run once now)
adb shell dumpsys shortcut | grep -A3 -i "$P" | grep -iE "id=|shortLabel|Package" | head -20 >> out/intents.txt
adb shell am start -a android.intent.action.VIEW -d pdfeditor://action/scan -n $P/.MainActivity >> out/intents.txt 2>&1
sleep 8
adb exec-out screencap -p > out/shortcut-scan.png
cat out/intents.txt
# a share with neither file nor text must be ignored (no file picker), and a recreate must not re-handle the file
adb shell am force-stop $P
adb shell am start -a android.intent.action.SEND -t text/plain -n $P/.MainActivity >> out/intents.txt 2>&1
sleep 15
adb exec-out screencap -p > out/share-empty.png
adb shell dumpsys window | grep -E "mCurrentFocus" | sed 's/^/empty-share focus: /' >> out/intents.txt
adb shell am force-stop $P
adb logcat -c
adb shell settings put global always_finish_activities 1
adb shell am start -a android.intent.action.SEND -t image/jpeg --eu android.intent.extra.STREAM "content://media/external/images/media/$id" --grant-read-uri-permission -n $P/.MainActivity >> out/intents.txt 2>&1
sleep 20
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell am start -n $P/.MainActivity >> out/intents.txt 2>&1
sleep 10
adb exec-out screencap -p > out/share-recreate.png
adb shell settings put global always_finish_activities 0
adb logcat -d > out/recreate-logcat.txt
tail -4 out/intents.txt
