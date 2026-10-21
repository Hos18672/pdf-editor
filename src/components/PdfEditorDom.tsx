'use dom';

import React from 'react';
import EditorApp from '../ui/EditorApp';

// Android: react-native-webview hands the page its start-up values (host OS, initial props) with an
// async evaluateJavascript call, which can lose the race against the page's own start-up script.
// The DOM runtime then refuses to start and the app stays blank. This module runs before that
// check, so fill the values in here; the native side re-sends the real props once the page is ready.
if (typeof window !== 'undefined') {
  const w = window as any;
  if (w.ReactNativeWebView && (typeof w.$$EXPO_DOM_HOST_OS === 'undefined' || typeof w.$$EXPO_INITIAL_PROPS === 'undefined')) {
    let injected: any = null;
    try { injected = JSON.parse(w.ReactNativeWebView.injectedObjectJson?.() ?? 'null'); } catch { /* not there yet */ }
    w.$$EXPO_DOM_HOST_OS ??= injected?.EXPO_DOM_HOST_OS ?? 'android';
    w.$$EXPO_INITIAL_PROPS ??= injected?.initialProps ?? { names: ['pickPdf', 'savePdf'], props: { isNative: true } };
  }
}

// The whole editor is a DOM component: on the web it renders directly, on
// Android it runs inside a WebView with native file pick / save hooks.
export default function PdfEditorDom(props: {
  dom?: import('expo/dom').DOMProps;
  isNative?: boolean;
  pickPdf?: () => Promise<{ name: string; base64: string } | null>;
  savePdf?: (base64: string, name: string) => Promise<string | void>;
}) {
  return <EditorApp isNative={props.isNative} pickPdf={props.pickPdf} savePdf={props.savePdf} />;
}
