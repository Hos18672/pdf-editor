// Runs the scanner's own pipeline (find the page → straighten → Magic) on the test photos, as the app
// does at "standard" quality, and saves each step for OCR and review.
//
//   [CASES=a,b] npx tsx test/scan-bench/run.mts PHOTOS OUT [SRC]
//
// SRC is the scanner source to test (default: this checkout's src/ui/scan), so an older version can
// be run from a git worktree for the baseline. Writes OUT/<case>.{warped,auto}.png and OUT/run.json
// (corner error, times per stage, peak memory).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const [PHOTOS, OUT, SRC0] = process.argv.slice(2), ONLY = process.env.CASES;
const SRC = resolve(SRC0 || join(import.meta.dirname, '../../src/ui/scan'));
mkdirSync(OUT, { recursive: true });
const D = (await import(join(SRC, 'detect.ts'))).detectKernels();
const K = (await import(join(SRC, 'kernels.ts'))).scanKernels();
const { traceBend } = await import(join(SRC, 'bend.ts'));
const geom = await import(join(SRC, 'geom.ts'));
const dewarp = existsSync(join(SRC, 'dewarp.ts')) ? await import('./nodeDewarp.ts') : null;

type Img = { w: number; h: number; data: Uint8ClampedArray };
const PY = `
import sys, cv2, numpy as np
src, dst, mx = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = cv2.imread(src); h, w = im.shape[:2]; k = min(1, mx / max(w, h))
if k < 1: im = cv2.resize(im, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
open(dst, 'wb').write(cv2.cvtColor(im, cv2.COLOR_BGR2RGBA).tobytes()); print(im.shape[1], im.shape[0])`;
function load(file: string, max: number): Img {
  const tmp = join(OUT, `.raw_${max}`);
  const [w, h] = execFileSync('python3', ['-c', PY, file, tmp, String(max)]).toString().trim().split(' ').map(Number);
  return { w, h, data: new Uint8ClampedArray(readFileSync(tmp)) };
}
const SAVE = `
import sys, cv2, numpy as np
w, h = int(sys.argv[2]), int(sys.argv[3])
a = np.frombuffer(open(sys.argv[1], 'rb').read(), np.uint8).reshape(h, w, 4)
cv2.imwrite(sys.argv[4], cv2.cvtColor(a, cv2.COLOR_RGBA2BGR))`;
function save(img: Img, file: string) {
  const tmp = join(OUT, '.out.rgba');
  writeFileSync(tmp, img.data);
  execFileSync('python3', ['-c', SAVE, tmp, String(img.w), String(img.h), file]);
}

const cases = ONLY ? ONLY.split(',') : readdirSync(PHOTOS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const report: any[] = existsSync(join(OUT, 'run.json')) ? JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8')).filter((r: any) => !cases.includes(r.case)) : [];
for (const n of cases) {
  const gt = JSON.parse(readFileSync(join(PHOTOS, n + '.json'), 'utf8'));
  const receipt = n.includes('receipt');
  const full = load(join(PHOTOS, n + '.jpg'), 4096), small = load(join(PHOTOS, n + '.jpg'), 512), mid = load(join(PHOTOS, n + '.jpg'), 1600);
  const T: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => { const t = performance.now(); T[k] = Math.round(t - t0); t0 = t; };
  const d = D.detectQuad(small, {});
  let quad: { x: number; y: number }[], bend: number[][] | null = null;
  if (d) {
    const k = mid.w / small.w, L = D.luminance(mid);
    let q = D.refineQuad(L, mid.w, mid.h, d.quad.map((p: any) => ({ x: p.x * k, y: p.y * k })));
    const b = traceBend(L, mid.w, mid.h, q);
    if (b) { q = b.quad; bend = b.bend; }
    const s = full.w / mid.w;
    quad = q.map((p: any) => ({ x: p.x * s, y: p.y * s }));
    if (bend) bend = bend.map((a) => a.map((v) => v * s));
  } else quad = [{ x: 0, y: 0 }, { x: full.w, y: 0 }, { x: full.w, y: full.h }, { x: 0, y: full.h }];
  lap('find');
  const err = quad.map((p, i) => Math.hypot(p.x - Math.max(0, Math.min(gt.W, gt.quad[i][0])), p.y - Math.max(0, Math.min(gt.H, gt.quad[i][1]))));
  // output size as the app's "standard" quality
  const ratio = geom.aspectOf(quad, full.w, full.h);
  const srcLong = Math.max(geom.dist(quad[0], quad[1]), geom.dist(quad[3], quad[2]), geom.dist(quad[0], quad[3]), geom.dist(quad[1], quad[2]));
  let long = receipt ? Math.min(5200, 1000 / Math.min(1, ratio)) : 2339;
  long = Math.max(320, Math.min(long, srcLong * 1.15));
  const outW = Math.round(ratio >= 1 ? long : long * ratio), outH = Math.round(ratio >= 1 ? long / ratio : long);
  const job = { src: full, quad: quad.flatMap((p) => [p.x, p.y]), bend, outW, outH, sharpen: 'auto' as const, flatten: 'rows' as const };
  let geo: any = null;
  if (dewarp && !process.env.NO_AI) {
    // the optional AI stage, as the worker runs it (model on disk next to the app)
    geo = await dewarp.nodeDewarp(SRC, job, join(import.meta.dirname, '../../public/scan/uvdoc.onnx'));
    lap('ai');
  }
  const p = K.prepare(geo ? { ...job, ...geo.job } : job);
  Object.assign(T, p.times);
  t0 = performance.now();
  save(p.warped, join(OUT, n + '.warped.png'));
  const img = K.finish(p.sharp ?? p.warped, 'auto', p.blur, 0, 0);
  lap('look');
  save(img, join(OUT, n + '.auto.png'));
  const rss = Math.round(process.resourceUsage().maxRSS / 1024);
  const r = { case: n, found: !!d, bend: !!bend, cornerErr: Math.round(Math.max(...err)), out: [outW, outH], times: T, ai: geo?.info ?? null, peakMB: rss };
  console.log(JSON.stringify(r));
  report.push(r);
  writeFileSync(join(OUT, 'run.json'), JSON.stringify(report, null, 1));
}
