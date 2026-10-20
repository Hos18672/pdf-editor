import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync, writeFileSync } from 'fs';
(async () => {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit);
  const f = await d.embedFont(readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'), { subset: true });
  const p = d.addPage([400, 300]);
  p.drawText('Cid font Grüße – 2026', { x: 30, y: 250, size: 18, font: f, color: rgb(0.1, 0.3, 0.6) });
  p.drawText('Rotated line here', { x: 200, y: 60, size: 14, font: f, rotate: { type: 'degrees', angle: 30 } as any });
  writeFileSync('/home/claude/pdf-editor/test/fixtures/cid.pdf', await d.save());
})();
