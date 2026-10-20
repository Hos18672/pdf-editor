/**
 * Where the files from /public (pdf.js, fonts) are served.
 * Web: the site's base path. Android app: the page is opened from the APK
 * (file:///android_asset/www.bundle/…), and the build copies those files next to www.bundle.
 */
export function appBase(): string {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    const i = location.href.indexOf('/www.bundle/');
    return i >= 0 ? location.href.slice(0, i + 1) : location.href.replace(/[^/]*$/, '');
  }
  const b = (process.env.EXPO_BASE_URL as string | undefined) ?? '/';
  return b.endsWith('/') ? b : b + '/';
}
