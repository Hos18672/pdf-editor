'use dom';

import React from 'react';
import EditorApp from '../ui/EditorApp';
import type { ChromeColors } from '../ui/hooks';

// Android: react-native-webview hands the page its start-up values (host OS, initial props) with an
// async evaluateJavascript call, which can lose the race against the page's own start-up script.
// The DOM runtime then refuses to start and the app stays blank. This module runs before that
// check, so fill the values in here.
const bridge = typeof window !== 'undefined' ? (window as any).ReactNativeWebView as { postMessage: (m: string) => void; injectedObjectJson?: () => string } | undefined : undefined;
if (bridge) {
  const w = window as any;
  if (typeof w.$$EXPO_DOM_HOST_OS === 'undefined' || typeof w.$$EXPO_INITIAL_PROPS === 'undefined') {
    let injected: any = null;
    try { injected = JSON.parse(bridge.injectedObjectJson?.() ?? 'null'); } catch { /* not there yet */ }
    w.$$EXPO_DOM_HOST_OS ??= injected?.EXPO_DOM_HOST_OS ?? 'android';
    w.$$EXPO_INITIAL_PROPS ??= injected?.initialProps ?? { names: ['pickPdf', 'savePdf', 'onChrome'], props: { isNative: true } };
  }
}

// Expo decides once, when its bridge module loads, whether native calls are possible; in the race
// above that is before the values exist, so its action proxies would refuse every call (open, save).
// Call the native side directly with the same message protocol instead.
function callNative<T>(actionId: string, args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const uid = Math.random().toString(36).slice(2);
    const onResult = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type !== '$$native_action_result' || msg.data?.uid !== uid || msg.data?.actionId !== actionId) return;
      window.removeEventListener('$$dom_event', onResult);
      if (msg.data && 'error' in msg.data) reject(Object.assign(new Error(msg.data.error?.message ?? 'Native action failed'), msg.data.error));
      else resolve(msg.data?.result as T);
    };
    window.addEventListener('$$dom_event', onResult);
    try { bridge!.postMessage(JSON.stringify({ type: '$$native_action', data: { uid, actionId, args } })); }
    catch (err) { window.removeEventListener('$$dom_event', onResult); reject(err); }
  });
}

const native = bridge ? {
  isNative: true,
  pickPdf: () => callNative<{ name: string; base64: string } | null>('pickPdf', []),
  savePdf: (base64: string, name: string) => callNative<string | void>('savePdf', [base64, name]),
  onChrome: (c: ChromeColors) => { callNative('onChrome', [c]).catch(() => null); },
} : null;

// The whole editor is a DOM component: on the web it renders directly, on
// Android it runs inside a WebView with native file pick / save hooks.
export default function PdfEditorDom(props: {
  dom?: import('expo/dom').DOMProps;
  isNative?: boolean;
  pickPdf?: () => Promise<{ name: string; base64: string } | null>;
  savePdf?: (base64: string, name: string) => Promise<string | void>;
  onChrome?: (c: ChromeColors) => void;
}) {
  if (native) return <EditorApp {...native} />;
  return <EditorApp isNative={props.isNative} pickPdf={props.pickPdf} savePdf={props.savePdf} onChrome={props.onChrome} />;
}
