#!/usr/bin/env python3
"""
A straightened receipt with desk left in the crop (as when the found outline sits a little outside the
paper): dark wedges in three corners, a dark line along the left side that drifts a few pixels in
(with a pale gap at the edge), a line a few pixels in from the right side, and print close to the
edges (left-aligned text 14 px in, a word cut by the right edge).

  python3 test/scan-bench/edges.py OUT_DIR     → OUT_DIR/edges.png and OUT_DIR/edges_clean.png
"""
import os, sys, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
W, H = 1000, 2900
try:
    font = ImageFont.truetype('DejaVuSansMono.ttf', 30)
except OSError:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 30)

def page(desk_on):
    random.seed(1)
    im = Image.new('RGB', (W, H), (236, 233, 226))
    d = ImageDraw.Draw(im)
    words = 'Milch Brot Pfand Karte Summe Netto Brutto MWST Trm-Id AID Datum Beleg Kunde Wien EUR'.split()
    y = 60
    while y < H - 60:
        d.text((random.choice([14, 30, 60]), y), ' '.join(random.choice(words) for _ in range(random.randint(2, 4))), font=font, fill=(40, 40, 45))
        num = f'{random.randint(0, 99)},{random.randint(10, 99)}'
        d.text((W - 20 - 18 * len(num), y), num, font=font, fill=(40, 40, 45))
        y += 46
    d.text((W - 160, 1500), 'Brutto', font=font, fill=(30, 30, 30))  # print running off the page
    a = np.asarray(im).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    a *= (0.85 + 0.15 * (1 - xx / W))[..., None] * (0.9 + 0.1 * (yy / H))[..., None]
    mask = np.zeros((H, W), np.float32)
    if desk_on:
        mask[xx < 90 - yy * 2.2] = 1                                  # top-left wedge
        mask[(xx > W - 40 + yy * 0.9) & (yy < 50)] = 1                # top-right wedge
        lx = 2 + yy * 6 / H                                           # left: a line drifting in
        mask[(xx >= lx) & (xx < lx + 5) & (yy > 300)] = 1
        mask[(xx < 2) & (yy < 1500)] = 1
        mask[(xx >= W - 9) & (xx < W - 5) & (yy > 600) & (yy < 2850)] = 1  # right: a line a few px in
        mask[yy > H - 60 + xx * 0.5] = 1                              # bottom-left wedge
    m = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255.0
    a = a * (1 - m[..., None]) + np.array([22, 20, 24], np.float32) * m[..., None]
    a += np.random.default_rng(1).normal(0, 3, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

page(True).save(os.path.join(out, 'edges.png'))
page(False).save(os.path.join(out, 'edges_clean.png'))
print(os.path.join(out, 'edges.png'))
