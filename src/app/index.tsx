import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import PdfEditorDom from '../components/PdfEditorDom';
import { PeIntents } from '../../modules/pe-intents';

// Pages from Google's scanner that the page could not take (its renderer was stopped while the
// scanner had the screen, low memory): handed over as "scanned" when the page has started again
let pendingScan: string[] | null = null;
let pageGone = false;
let notifyPage: () => void = () => {};
const takeIntent = async () => {
  if (pendingScan?.length) {
    const files = pendingScan.map((uri, i) => ({ uri, name: `Scan ${i + 1}.jpg`, mime: 'image/jpeg', size: null }));
    pendingScan = null;
    return { mode: 'scanned', files, text: null, subject: null };
  }
  return PeIntents?.takeIntent() ?? null;
};
const addToCalendar = async (e: { title: string; begin: number; allDay: boolean; note: string }) => {
  if (!PeIntents) return false;
  try { return PeIntents.addCalendarEvent(e.title, e.begin, e.allDay, e.note); } catch { return false; }
};
const scanDocs = async (limit: number) => {
  if (!PeIntents?.scanDocuments) throw new Error('Not available');
  pageGone = false;
  const uris = await PeIntents.scanDocuments(limit, true);
  // the page that asked is gone: keep the pages for the new one
  if (pageGone && uris?.length) { pendingScan = uris; setTimeout(() => notifyPage(), 1500); }
  return uris;
};
const readShared = (uri: string) => (PeIntents ? PeIntents.readUri(uri) : Promise.reject(new Error('Not available')));

async function pickPdf() {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const base64 = await new File(asset.uri).base64();
  return { name: asset.name ?? 'document.pdf', base64 };
}

// the file's real type: a save target (Files, Drive) refuses a .zip or picture sent as a PDF
const TYPES: Record<string, [string, string]> = {
  pdf: ['application/pdf', 'com.adobe.pdf'], zip: ['application/zip', 'public.zip-archive'],
  jpg: ['image/jpeg', 'public.jpeg'], jpeg: ['image/jpeg', 'public.jpeg'], png: ['image/png', 'public.png'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'org.openxmlformats.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'org.openxmlformats.presentationml.presentation'],
  txt: ['text/plain', 'public.plain-text'], html: ['text/html', 'public.html'], csv: ['text/csv', 'public.comma-separated-values-text'],
  ics: ['text/calendar', 'public.calendar-event'], json: ['application/json', 'public.json'],
};

async function savePdf(base64: string, name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const [mimeType, UTI] = TYPES[ext] ?? ['application/octet-stream', 'public.data'];
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: ext === 'pdf' ? 'Save or share PDF' : `Save or share ${name}`, UTI });
  }
  return file.uri;
}

// Page errors inside the WebView would otherwise be silent in a release build: forward them to the
// native log (logcat, tag ReactNativeJS) so a blank screen can be diagnosed.
const CATCH_PAGE_ERRORS = `(function () {
  window.__pageErrors = [];
  function send(m) {
    window.__pageErrors.push(m);
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: '$$page_error', data: String(m).slice(0, 2000) })); } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    var t = e.target && e.target !== window ? (e.target.src || e.target.href || e.target.tagName) : '';
    send((e.message || 'load error') + ' @ ' + (e.filename || t || '') + ':' + (e.lineno || '') + (e.error && e.error.stack ? '\\n' + e.error.stack : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; send('unhandled rejection: ' + (r && (r.stack || r.message) || r)); });
  var ce = console.error;
  console.error = function () {
    try { send('console.error: ' + Array.prototype.map.call(arguments, function (a) { return a && a.stack || String(a); }).join(' ')); } catch (_) {}
    return ce.apply(console, arguments);
  };
})(); true;`;

const onPageMessage = (e: { nativeEvent: { data: string } }) => {
  try {
    const m = JSON.parse(e.nativeEvent.data);
    if (m?.type === '$$page_error') console.warn('[page]', m.data);
  } catch { /* not ours */ }
};

export default function Index() {
  const dark = useColorScheme() === 'dark';
  if (Platform.OS === 'web') {
    // the page paints its own (themed) background
    return (
      <View style={[styles.fill, { backgroundColor: 'transparent' }]}>
        <PdfEditorDom />
      </View>
    );
  }
  return <NativeShell dark={dark} />;
}

type Chrome = { top: string; bottom: string; topDark: boolean; bottomDark: boolean };

/**
 * Android: the page runs edge to edge, under the status and navigation bars (they stay transparent).
 * The page asks for the bar sizes (`getInsets`) and pads its own content; it also reports the colours
 * at its edges so the bar icons stay readable. KeyboardAvoidingView keeps the page above the keyboard.
 */
function NativeShell({ dark }: { dark: boolean }) {
  const insets = useSafeAreaInsets();
  const latest = useRef(insets);
  latest.current = insets;
  const [chrome, setChrome] = useState<Chrome | null>(null);
  const desk = dark ? '#0F1118' : '#ECEEF3'; // page background until the page has painted
  const topDark = chrome ? chrome.topDark : dark, bottomDark = chrome ? chrome.bottomDark : dark;
  // The phone's back button goes to the page: it closes the open dialog or screen, and only when
  // nothing is left does the page ask to leave the app (exitApp).
  const dom = useRef<any>(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dom.current?.injectJavaScript) return false;
      dom.current.injectJavaScript("window.dispatchEvent(new Event('pe-back'));true;");
      return true;
    });
    return () => sub.remove();
  }, []);
  // opened again with a file or a shortcut while running: tell the page
  useEffect(() => {
    const sub = PeIntents?.addListener('onIntent', () => {
      dom.current?.injectJavaScript?.("window.dispatchEvent(new Event('pe-intent'));true;");
    });
    return () => sub?.remove();
  }, []);
  const exitApp = useCallback(() => { BackHandler.exitApp(); }, []);
  // the WebView's renderer was stopped (low memory, often while another app or the scanner has the
  // screen): start the page again instead of letting Android close the app
  const [gen, setGen] = useState(0);
  useEffect(() => { notifyPage = () => dom.current?.injectJavaScript?.("window.dispatchEvent(new Event('pe-intent'));true;"); }, []);
  const onGone = useCallback(() => { pageGone = true; setGen((g) => g + 1); }, []);
  const getInsets = useCallback(async () => {
    const i = latest.current;
    // with the keyboard up the page ends at the keyboard: no navigation-bar gap
    return { top: i.top, bottom: Keyboard.isVisible() ? 0 : i.bottom, left: i.left, right: i.right };
  }, []);
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.fill, { backgroundColor: chrome?.bottom ?? desk }]}>
      <StatusBar style={topDark ? 'light' : 'dark'} />
      <NavigationBar style={bottomDark ? 'light' : 'dark'} />
      <PdfEditorDom
        key={gen}
        ref={dom}
        exitApp={exitApp}
        isNative
        pickPdf={pickPdf}
        savePdf={savePdf}
        onChrome={setChrome}
        getInsets={getInsets}
        takeIntent={takeIntent}
        readShared={readShared}
        scanDocs={scanDocs}
        addToCalendar={addToCalendar}
        dom={{
          style: { flex: 1, backgroundColor: desk },
          // react-native-webview supports <input type="file"> (signature photos, images) on Android
          useExpoDOMWebView: false,
          allowFileAccess: true,
          allowFileAccessFromFileURLs: true,
          allowUniversalAccessFromFileURLs: true,
          setBuiltInZoomControls: false,
          // the document scanner's live camera (getUserMedia): Android asks for the camera permission
          // when the page first requests it; the preview video must play without a tap
          mediaPlaybackRequiresUserAction: false,
          allowsInlineMediaPlayback: true,
          mediaCapturePermissionGrantType: 'grant',
          injectedJavaScriptBeforeContentLoaded: CATCH_PAGE_ERRORS,
          onMessage: onPageMessage,
          onRenderProcessGone: onGone,
          onContentProcessDidTerminate: onGone,
          // only in the CI smoke-test build: lets the test read the page through DevTools
          webviewDebuggingEnabled: process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === '1',
        } as any}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
