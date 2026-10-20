// Engine round-trip test: edit existing text, export, then verify with pdf.js
import { readFileSync, writeFileSync } from 'fs';
import { buildRuns, analyseFont } from '../src/engine/pdfText';
import { exportPdf } from '../src/engine/exporter';
import type { TextEdit } from '../src/engine/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

async function load(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: true, disableFontFace: true, verbosity: 0 }).promise;
}

async function runsOf(doc: any, p: number) {
  const page = await doc.getPage(p + 1);
  await page.getOperatorList();
  const tc = await page.getTextContent();
  return { page, runs: buildRuns(tc.items, p) };
}

async function main() {
  const [file, out, ...pairs] = process.argv.slice(2);
  const bytes = new Uint8Array(readFileSync(file));
  const doc = await load(bytes);
  const { page, runs } = await runsOf(doc, 0);
  console.log('RUNS:');
  runs.forEach((r) => console.log(' ', r.key, JSON.stringify(r.str), r.fontName, r.region.height.toFixed(1)));
  const edits: TextEdit[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const run = runs.find((r) => r.str.includes(pairs[i]))!;
    const fi = analyseFont(page.commonObjs.get(run.fontName), run.fontName);
    const newText = run.str.replace(pairs[i], pairs[i + 1]);
    const missing = [...newText].filter((c) => c !== ' ' && fi.charMap[c] === undefined);
    console.log(`EDIT ${run.key} font=${fi.name} glyphs=${Object.keys(fi.charMap).length} missing=${JSON.stringify(missing.join(''))}`);
    edits.push({
      page: 0, key: run.key, region: run.region, text: newText, sizeScale: 1, color: null,
      charMap: fi.charMap, fallback: fi.fallback, bgColor: '#ffffff',
    });
  }
  const view = page.getViewport({ scale: 1 }).transform;
  const result = await exportPdf({
    bytes, pages: [{ src: 0, rotation: 0 }], edits,
    objects: [
      { id: 'a', page: 0, type: 'text', x: 60, y: 600, w: 200, h: 20, text: 'Added text object', family: 'Helvetica', size: 16, color: '#cc0000', bold: true, italic: false },
      { id: 'b', page: 0, type: 'highlight', x: 55, y: 595, w: 200, h: 26, fill: '#ffe14d' },
      { id: 'c', page: 0, type: 'ellipse', x: 300, y: 590, w: 120, h: 40, stroke: '#1e2559', fill: null, strokeWidth: 2 },
      { id: 'd', page: 0, type: 'draw', x: 300, y: 650, w: 100, h: 30, stroke: '#0a7', strokeWidth: 3, points: [0, 0, 20, 20, 40, 0, 60, 25, 80, 5] },
    ],
    viewMatrices: { 0: view as any },
  });
  writeFileSync(out, result);
  const doc2 = await load(result);
  const { runs: runs2 } = await runsOf(doc2, 0);
  console.log('AFTER:');
  runs2.forEach((r) => console.log(' ', JSON.stringify(r.str)));
}
main().catch((e) => { console.error(e); process.exit(1); });
