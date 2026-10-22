// The app is opened with files ("Open with", the share sheet) and with shortcut / widget links
// (pdfeditor://action/scan). There is only one screen: always land on it; the page reads what it was
// opened with from the native module.
export function redirectSystemPath({ initial }: { path: string; initial: boolean }) {
  return initial ? '/' : null;
}
