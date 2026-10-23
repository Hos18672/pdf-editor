#!/usr/bin/env python3
"""
OCR the scanner's outputs and score them against the known text.

  python3 test/scan-bench/eval.py PHOTOS RUN_DIR [RUN_DIR …]

For every case: Tesseract (eng, same engine family as the app's tesseract.js) on the photo itself
and on each run's straightened page (.warped.png) and Magic page (.auto.png).

  CER        character error rate against the printed text (edit distance / length; lower is better).
             Reading order matters, so tables and columns cost a little even when every word is right.
  bent       how far recognised text lines wander from a straight line: RMS of the word centres
             around the line's straight fit, in word heights (0 = perfectly straight).
  words      share of printed words found anywhere (order-free).
  geo        geometric error: words found both on the printed page and on the scan, positions compared
             after the best overall fit (scale, shift, shear), RMS in % of the page width. Bulges,
             squeezed margins and leftover curls show up here; a correct flat page is near 0.

OCR disagreement is a warning sign, not proof: a page can read well and still be cropped.
"""
import json, os, re, subprocess, sys
import numpy as np

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

def lev(a, b):
    try:
        from rapidfuzz.distance import Levenshtein
        return Levenshtein.distance(a, b)
    except ImportError: pass
    if len(a) < len(b): a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def boxes(path):
    tsv = subprocess.run(['tesseract', path, '-', '-l', 'eng', '--psm', '3', 'tsv'], capture_output=True, text=True).stdout
    out = {}
    for r in tsv.strip().split('\n')[1:]:
        r = r.split('\t')
        if len(r) < 12 or r[0] != '5' or not r[11].strip() or float(r[10]) < 60: continue
        out.setdefault(r[11], []).append((int(r[6]) + int(r[8]) / 2, int(r[7]) + int(r[9]) / 2))
    import cv2
    h, w = cv2.imread(path).shape[:2]
    return {k: (v[0][0] / w, v[0][1] / h) for k, v in out.items() if len(v) == 1 and len(k) >= 3}, w

_flat = {}
def geo(flat_path, path):
    if flat_path not in _flat: _flat[flat_path] = boxes(flat_path)[0]
    a = _flat[flat_path]; b, _ = boxes(path)
    common = [k for k in a if k in b]
    if len(common) < 12: return None
    P = np.array([a[k] for k in common]); Q = np.array([b[k] for k in common])
    A = np.hstack([P, np.ones((len(P), 1))])
    M, *_ = np.linalg.lstsq(A, Q, rcond=None)
    res = np.linalg.norm(A @ M - Q, axis=1)
    # a few mismatched words (same word read elsewhere) shouldn't dominate: drop the worst 5 %
    res = np.sort(res)[: max(12, int(len(res) * 0.95))]
    return float(np.sqrt(np.mean(res ** 2)) * 100)

def ocr(path):
    tsv = subprocess.run(['tesseract', path, '-', '-l', 'eng', '--psm', '3', 'tsv'], capture_output=True, text=True).stdout
    rows = [r.split('\t') for r in tsv.strip().split('\n')[1:]]
    words, lines = [], {}
    for r in rows:
        if len(r) < 12 or r[0] != '5' or not r[11].strip(): continue
        x, y, w, h, conf = int(r[6]), int(r[7]), int(r[8]), int(r[9]), float(r[10])
        key = (r[2], r[3], r[4])
        lines.setdefault(key, []).append((x + w / 2, y + h / 2, h, r[11]))
        words.append(r[11])
    text = '\n'.join(' '.join(w[3] for w in sorted(v)) for k, v in sorted(lines.items(), key=lambda kv: (int(kv[0][0]), int(kv[0][1]), int(kv[0][2]))))
    # straightness of each line with 4+ words
    devs = []
    for v in lines.values():
        if len(v) < 4: continue
        xs = np.array([p[0] for p in v]); ys = np.array([p[1] for p in v]); hs = np.median([p[2] for p in v])
        A = np.vstack([xs, np.ones_like(xs)]).T
        c, *_ = np.linalg.lstsq(A, ys, rcond=None)
        devs.append(float(np.sqrt(np.mean((ys - A @ c) ** 2)) / max(1, hs)))
    return text, (float(np.mean(devs)) if devs else None), words

def score(gt_lines, path, flat=None):
    if not os.path.exists(path): return None
    text, bent, words = ocr(path)
    g_err = geo(flat, path) if flat else None
    g, o = norm(' '.join(gt_lines)), norm(text)
    cer = lev(g, o) / max(1, len(g))
    gw = re.findall(r'\w+', ' '.join(gt_lines).lower()); ow = set(re.findall(r'\w+', text.lower()))
    found = sum(1 for w in gw if w in ow) / max(1, len(gw))
    return {'cer': round(cer, 4), 'bent': None if bent is None else round(bent, 4), 'words': round(found, 4), 'geo': None if g_err is None else round(g_err, 3)}

if __name__ == '__main__':
    photos, runs = sys.argv[1], sys.argv[2:]
    cases = sorted(f[:-5] for f in os.listdir(photos) if f.endswith('.json'))
    out = {}
    for n in cases:
        gt = json.load(open(os.path.join(photos, n + '.json')))
        row = {'photo': score(gt['lines'], os.path.join(photos, n + '.jpg'))}
        for r in runs:
            tag = os.path.basename(os.path.normpath(r))
            row[tag + '.warped'] = score(gt['lines'], os.path.join(r, n + '.warped.png'))
            row[tag + '.auto'] = score(gt['lines'], os.path.join(r, n + '.auto.png'), os.path.join(photos, n + '_flat.png'))
        out[n] = row
        print(n, json.dumps(row), flush=True)
    json.dump(out, open(os.path.join(runs[-1] if runs else photos, 'eval.json'), 'w'), indent=1)
