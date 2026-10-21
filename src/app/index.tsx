import { Platform, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import PdfEditorDom from '../components/PdfEditorDom';

async function pickPdf() {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const base64 = await new File(asset.uri).base64();
  return { name: asset.name ?? 'document.pdf', base64 };
}

async function savePdf(base64: string, name: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share PDF', UTI: 'com.adobe.pdf' });
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
  return (
    <SafeAreaView style={[styles.fill, dark && { backgroundColor: '#191C27' }]} edges={['top', 'bottom']}>
      <PdfEditorDom
        isNative
        pickPdf={pickPdf}
        savePdf={savePdf}
        dom={{
          style: { flex: 1 },
          // react-native-webview supports <input type="file"> (signature photos, images) on Android
          useExpoDOMWebView: false,
          allowFileAccess: true,
          allowFileAccessFromFileURLs: true,
          allowUniversalAccessFromFileURLs: true,
          setBuiltInZoomControls: false,
          injectedJavaScriptBeforeContentLoaded: CATCH_PAGE_ERRORS,
          onMessage: onPageMessage,
          // only in the CI smoke-test build: lets the test read the page through DevTools
          webviewDebuggingEnabled: process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === '1',
        } as any}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: '#e8ecf3' } });
