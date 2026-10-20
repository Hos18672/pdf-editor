'use dom';

import React from 'react';
import EditorApp from '../ui/EditorApp';

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
