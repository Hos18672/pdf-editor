// Desk left along the edges of a straightened page (see edges.py): every document look must make it
// paper and keep the print. Compares each look on the page with desk against the same page without.
//
//   python3 test/scan-bench/edges.py OUT && npx tsx test/scan-bench/edges.mts OUT
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = process.argv[2];
const K = (await import('../../src/ui/scan/kernels.ts')).scanKernels();
type Img = { w: number; h: number; data: Uint8ClampedArray };
function load(file: string): Img {
  const tmp = join(OUT, '.raw');
  const [w, h] = execFileSync('python3', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');open(sys.argv[2],'wb').write(im.tobytes());print(*im.size)`, file, tmp]).toString().trim().split(' ').map(Number);
  return { w, h, data: new Uint8ClampedArray(readFileSync(tmp)) };
}
function save(img: Img, file: string) {
  const tmp = join(OUT, '.raw');
  writeFileSync(tmp, img.data);
  execFileSync('python3', ['-c', `import sys;from PIL import Image;Image.frombytes('RGBA',(int(sys.argv[2]),int(sys.argv[3])),open(sys.argv[1],'rb').read()).convert('RGB').save(sys.argv[4])`, tmp, String(img.w), String(img.h), file]);
}
const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
let failed = false;
for (const look of ['auto', 'enhance', 'lighten', 'gray', 'bw'] as const) {
  const t = performance.now();
  const a = K.finish(load(join(OUT, 'edges.png')), look, 0, 0, 0);
  const ms = Math.round(performance.now() - t);
  const b = K.finish(load(join(OUT, 'edges_clean.png')), look, 0, 0, 0);
  save(a, join(OUT, `edges.${look}.png`));
  // desk left: dark where the clean page is light; print lost: dark on the clean page, light here
  let left = 0, lost = 0, ink = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const va = luma(a.data, i), vb = luma(b.data, i);
    if (vb < 128) { ink++; if (va > 200) lost++; }
    if (va < 128 && vb > 160) left++;
  }
  const ok = left < 200 && lost < ink * 0.001;
  if (!ok) failed = true;
  console.log(`${look.padEnd(8)} desk left ${String(left).padStart(6)} px   print lost ${lost} of ${ink} px   ${ms} ms   ${ok ? 'ok' : 'FAIL'}`);
}
process.exit(failed ? 1 : 0);
