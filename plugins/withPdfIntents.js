// Android: the app in "Open with" for PDFs, in the share sheet for PDFs, pictures, office files and
// text, and a second share entry "Convert to PDF" that turns what is shared into a PDF right away.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const DOCS = [
  'image/*', 'text/plain', 'text/html', 'text/markdown', 'text/csv', 'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet',
];
const filter = (action, mimes, extra = {}) => ({
  action: [{ $: { 'android:name': action } }],
  category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }, ...(extra.browsable ? [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }] : [])],
  data: [...new Set(mimes)].map((m) => ({ $: { 'android:mimeType': m } })).concat(
    (extra.schemes ?? []).map((s) => ({ $: { 'android:scheme': s } }))),
});

module.exports = function withPdfIntents(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    const ours = [
      filter('android.intent.action.VIEW', ['application/pdf'], { schemes: ['content', 'file'] }),
      filter('android.intent.action.SEND', ['application/pdf', ...DOCS]),
      filter('android.intent.action.SEND_MULTIPLE', ['application/pdf', 'image/*']),
    ];
    // (prebuild can run on an existing project: don't add them twice)
    const key = (f) => JSON.stringify(f);
    const have = new Set(ours.map(key));
    main['intent-filter'] = [...(main['intent-filter'] ?? []).filter((f) => !have.has(key(f))), ...ours];
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app['activity-alias'] = (app['activity-alias'] ?? []).filter((a) => a.$?.['android:name'] !== '.ConvertToPdf');
    app['activity-alias'].push({
      $: {
        'android:name': '.ConvertToPdf',
        'android:targetActivity': '.MainActivity',
        'android:label': 'Convert to PDF',
        'android:icon': '@mipmap/ic_launcher',
        'android:exported': 'true',
      },
      'intent-filter': [
        filter('android.intent.action.SEND', DOCS),
        filter('android.intent.action.SEND_MULTIPLE', ['image/*', ...DOCS.filter((m) => !m.startsWith('text/'))]),
      ],
    });
    return cfg;
  });
};
