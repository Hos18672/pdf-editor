// Vector drawables for the Android shortcuts and home-screen widget, from Phosphor icons.
// node scripts/gen-native-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'modules/pe-intents/android/src/main/res/drawable');
const icons = { scan: 'scan', open: 'pencil-simple-line', sign: 'signature', convert: 'file-pdf' };
const INK = '#FF1E2559', TINT = '#FFE4EBFF', WHITE = '#FFFFFFFF';
for (const [key, name] of Object.entries(icons)) {
  const svg = fs.readFileSync(path.join(root, `node_modules/@phosphor-icons/core/assets/bold/${name}-bold.svg`), 'utf8');
  const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
  // shortcut: glyph on a round tile (launchers mask it to a circle)
  fs.writeFileSync(path.join(out, `pe_sc_${key}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="256" android:viewportHeight="256">
  <path android:fillColor="${TINT}" android:pathData="M128,0a128,128 0,1 1,0 256a128,128 0,1 1,0 -256z"/>
  <group android:scaleX="0.5" android:scaleY="0.5" android:translateX="64" android:translateY="64">
    <path android:fillColor="${INK}" android:pathData="${d}"/>
  </group>
</vector>
`);
  // widget button glyphs: ink (on the yellow tile) and white (on the dark tiles)
  for (const [suffix, color] of [['', INK], ['_w', WHITE]]) fs.writeFileSync(path.join(out, `pe_ic_${key}${suffix}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="256" android:viewportHeight="256">
  <path android:fillColor="${color}" android:pathData="${d}"/>
</vector>
`);
}
console.log('icons written');
