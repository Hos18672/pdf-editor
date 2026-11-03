// Android: a smaller app. The app is a web page in a WebView, so the native image decoders for GIF and
// WebP (React Native's own <Image>) are left out, unused resources are dropped, and the bundle for
// Google Play carries only the symbol tables of the native libraries (enough to read crash reports)
// instead of their full debug information.
const { withGradleProperties, withAppBuildGradle } = require('expo/config-plugins');

const PROPS = {
  'expo.gif.enabled': 'false',
  'expo.webp.enabled': 'false',
  'expo.webp.animated': 'false',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
};

module.exports = function withSlimAndroid(config) {
  config = withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const at = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (at) at.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
  return withAppBuildGradle(config, (cfg) => {
    const g = cfg.modResults.contents;
    if (!g.includes("debugSymbolLevel 'SYMBOL_TABLE'")) {
      cfg.modResults.contents = g.replace(
        /(crunchPngs enablePngCrunchInRelease\.toBoolean\(\)\n)/,
        "$1            ndk { debugSymbolLevel 'SYMBOL_TABLE' }\n",
      );
    }
    return cfg;
  });
};
