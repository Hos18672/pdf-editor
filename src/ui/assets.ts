/**
 * Where the files from /public (pdf.js, fonts) are served.
 * Web: the site's base path. Android app: the page is opened from the APK
 * (file:///android_asset/www.bundle/<hash>.html) and Expo puts /public right next to it.
 */
export function appBase(): string {
  if (typeof location !== 'undefined' && location.protocol === 'file:') return location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const b = (process.env.EXPO_BASE_URL as string | undefined) ?? '/';
  return b.endsWith('/') ? b : b + '/';
}
