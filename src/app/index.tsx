import { Platform, StyleSheet, View } from 'react-native';
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

export default function Index() {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.fill}>
        <PdfEditorDom />
      </View>
    );
  }
  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
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
        } as any}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: '#e8ecf3' } });
