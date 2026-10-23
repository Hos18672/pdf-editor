# Scanner benchmark

Reproducible test photos with known text, the scanner's own pipeline run on them, and OCR scoring.
Everything is synthetic (rendered here from fixed seeds with fonts shipped in `public/fonts`), so no
personal documents are needed and results can be compared run to run.

## Cases

`gen.py` renders five page types: a letter with fine print, an invoice table with numbers, a
handwritten note with a signature and a red stamp, a long till receipt, and a dense book page.
It bends them in 3-D (flat, tilted, curled, one end curling up, an open book's page rising from the
spine, a fold, crumpled), lights them from the surface (plus cast shadows and dim light), and
photographs them with a pinhole camera (blur, noise, JPEG) on a desk. 16 cases are listed in
`CASES` at the bottom of `gen.py`.

For each case the generator writes the photo, the page as printed (`_flat.png`), and a JSON file
with the true page corners and text lines.

## Run

```bash
pip install opencv-python numpy scipy pillow fonttools brotli rapidfuzz   # and tesseract (eng)
python3 test/scan-bench/gen.py OUT/photos                    # ~1 min per case

# the pipeline as it is now (with the AI step), and a baseline from another checkout
npx tsx test/scan-bench/run.mts OUT/photos OUT/new
git worktree add /tmp/base <commit> && npx tsx test/scan-bench/run.mts OUT/photos OUT/base /tmp/base/src/ui/scan
NO_AI=1 npx tsx test/scan-bench/run.mts OUT/photos OUT/classic   # this checkout, AI step off

python3 test/scan-bench/eval.py OUT/photos OUT/base OUT/new  # scores → OUT/new/eval.json
```

`run.mts` follows the app at "standard" quality: find the page (512 px) → refine corners
(1600 px) → follow curved sides → AI flattening (only for pages that look bent, see
`src/ui/scan/dewarp.ts`) → straighten → Magic. It saves `<case>.warped.png` (straightened only) and
`<case>.auto.png` (Magic), plus `run.json` (corner error against the truth, time per stage, the
AI's decision, and the process's peak memory).

Use `CASES=a,b` to run some cases only, and `FORCE_AI=1` to run the model on every page
(`FORCE_AI=use` also keeps its result, to look at what the safety check rejected).

## Scores (`eval.py`)

- **CER**: character error rate of Tesseract's reading against the printed text. Reading order
  counts, so tables score worse than their pixels deserve. Compare runs with each other, not
  against zero.
- **words**: the share of printed words found anywhere on the page, order-free.
- **geo**: geometric error, in % of the page width. Words read on both the printed page and the
  scan are compared after the best overall affine fit. Leftover curls, squeezed margins and bulges
  show up here.
- **bent**: how far recognised lines wander from a straight line, in word heights.

OCR disagreement is a warning, not proof. A page can read well and still be cropped, so look at the
pictures too.

## Desk along the edges

`edges.py` draws a straightened receipt with desk left in the crop (dark corner wedges, a dark line
along each side a few pixels in, print close to the edges) and the same page without it.
`edges.mts` runs every document look on both and fails if desk stays dark or print is lost:

```bash
python3 test/scan-bench/edges.py OUT/edges && npx tsx test/scan-bench/edges.mts OUT/edges
```

## On the device

`.github/scripts/smoke-ai.sh` (run the `Android smoke test` workflow with suite `ai`) runs the
classical worker and the AI worker inside the app's WebView on an emulator, using
`sample-curl.jpg` (a scaled copy of the `curl_letter` case). It reports load and run times, the AI's
decision and memory.
