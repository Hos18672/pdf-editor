#!/usr/bin/env python3
"""
Synthetic scanner test photos with known text (reproducible: fixed seeds, fonts shipped with the app).

Each case is a page (letter, invoice table, handwritten note with signature and stamp, receipt, book
page with fine print) rendered flat, bent in 3-D (flat, tilted, curled, open book, folded, crumpled),
lit (shading from the surface, cast shadows, dim light), photographed (pinhole camera, blur, noise,
JPEG) on a desk.

Writes, per case, into OUT:
  <case>.jpg   the photo
  <case>.json  ground truth: page corners in the photo, page size, text lines, the scenario
  <case>_flat.png  the page as printed (for reference)

  python3 test/scan-bench/gen.py OUT [case,case,...]
"""
import json, math, os, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from scipy.interpolate import griddata

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', '..', 'public', 'fonts')

_font_cache = {}
def font(name, size):
    """a font shipped with the app (woff2 → ttf once, next to the output)"""
    key = (name, size)
    if key in _font_cache: return _font_cache[key]
    ttf = os.path.join(OUT, '.fonts', name + '.ttf')
    if not os.path.exists(ttf):
        from fontTools.ttLib import TTFont
        os.makedirs(os.path.dirname(ttf), exist_ok=True)
        f = TTFont(os.path.join(FONTS, name + '.woff2')); f.flavor = None; f.save(ttf)
    _font_cache[key] = ImageFont.truetype(ttf, size)
    return _font_cache[key]

WORDS = ('the of and to in is that for it as with was on be by at this from or have an they which one you '
         'were all we when your can said there use each how their if will up other about out many then them '
         'these so some would make like into time has look two more write see number way could people than '
         'first water been call who now find long down day did get come made may part over new sound take '
         'only little work know place year live back give most very after thing our just name good sentence '
         'man think say great where help through much before line right too mean old any same tell boy follow '
         'came want show also around form three small set put end does another well large must big even such '
         'because turn here why ask went men read need land different home move try kind hand picture again '
         'change off play spell air away animal house point page letter mother answer found study still learn '
         'should world high every near add food between own below country plant last school father keep tree '
         'never start city earth eye light thought head under story saw left few while along might close '
         'something seem next hard open example begin life always those both paper together got group often run').split()

def sentence(rng, n):
    w = [WORDS[i] for i in rng.integers(0, len(WORDS), n)]
    w[0] = w[0].capitalize()
    return ' '.join(w)

def wrap(rng, f, width, nwords):
    """random words wrapped to `width` pixels"""
    lines, cur = [], []
    for i in range(nwords):
        w = WORDS[rng.integers(0, len(WORDS))]
        if not cur: w = w.capitalize()
        t = ' '.join(cur + [w])
        if f.getlength(t) > width and cur:
            lines.append(' '.join(cur)); cur = [w]
        else: cur.append(w)
    if cur: lines.append(' '.join(cur) + '.')
    return lines

class Page:
    def __init__(self, w, h):
        self.im = Image.new('RGB', (w, h), (255, 255, 255)); self.d = ImageDraw.Draw(self.im); self.lines = []
    def text(self, xy, s, f, fill=(20, 20, 24), keep=True):
        self.d.text(xy, s, font=f, fill=fill)
        if keep: self.lines.append(s)

def letter(seed):
    """A4 letter at 150 dpi: heading, body (11 pt), fine print (7 pt)"""
    rng = np.random.default_rng(seed); p = Page(1240, 1754)
    p.text((110, 110), 'Northfield Housing Office', font('arimo-latin-700-normal', 40))
    p.text((110, 170), 'Reference 2026-0417  Room 12  Tel 0660 4471 22', font('arimo-latin-400-normal', 22))
    y = 260; body = font('tinos-latin-400-normal', 24)
    for para in range(5):
        for ln in wrap(rng, body, 1020, 70): p.text((110, y), ln, body); y += 34
        y += 22
    small = font('arimo-latin-400-normal', 15); y += 20
    for ln in wrap(rng, small, 1020, 120): p.text((110, y), ln, small, fill=(60, 60, 60)); y += 21
    return p

def invoice(seed):
    """invoice with a ruled table and numbers"""
    rng = np.random.default_rng(seed); p = Page(1240, 1754)
    p.text((100, 100), 'INVOICE 7731', font('arimo-latin-700-normal', 46))
    p.text((100, 165), 'Date 14.03.2026   Customer 55120   Due 30 days', font('arimo-latin-400-normal', 23))
    f = font('arimo-latin-400-normal', 22); fb = font('arimo-latin-700-normal', 22)
    cols = [100, 200, 720, 860, 1010, 1140]
    y = 260
    p.d.rectangle([cols[0], y, cols[-1], y + 44], fill=(225, 230, 238))
    for x, t in zip(cols, ['Pos', 'Description', 'Qty', 'Price', 'Total']): p.text((x + 10, y + 9), t, fb, keep=False)
    p.lines.append('Pos Description Qty Price Total')
    y += 44; total = 0
    for i in range(18):
        q = int(rng.integers(1, 20)); pr = int(rng.integers(100, 9999)) / 100; t = q * pr; total += t
        d = sentence(rng, 3).lower().capitalize()
        row = [str(i + 1), d, str(q), f'{pr:.2f}', f'{t:.2f}']
        for x, s in zip(cols, row): p.text((x + 10, y + 10), s, f, keep=False)
        p.lines.append(' '.join(row))
        y += 46
        p.d.line([cols[0], y, cols[-1], y], fill=(120, 120, 120), width=2)
    for x in cols: p.d.line([x, 260, x, y], fill=(120, 120, 120), width=2)
    p.text((720, y + 30), f'Sum EUR {total:.2f}', fb)
    small = font('arimo-latin-400-normal', 15); y += 120
    for ln in wrap(rng, small, 1040, 90): p.text((100, y), ln, small, fill=(70, 70, 70)); y += 21
    return p

def note(seed):
    """handwritten note, a signature and a red stamp"""
    rng = np.random.default_rng(seed); p = Page(1240, 1754)
    hf = font('caveat-latin-600-normal', 44); y = 140
    for ln in wrap(rng, hf, 980, 110): p.text((120, y), ln, hf, fill=(20, 40, 120)); y += 62
    # signature: a smooth pen stroke (not text)
    t = np.linspace(0, 1, 400)
    xs = 700 + 380 * t + 30 * np.sin(t * 19); ys = y + 120 - 50 * np.sin(t * 7) * np.exp(-t * 1.5)
    p.d.line(list(zip(xs, ys)), fill=(15, 25, 90), width=4)
    # stamp: red ring with text
    cx, cy, r = 330, y + 140, 110
    p.d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(200, 40, 40), width=7)
    p.d.text((cx - 78, cy - 18), 'APPROVED', font=font('arimo-latin-700-normal', 30), fill=(200, 40, 40))
    return p

def receipt(seed):
    """a long till receipt, narrow and small print"""
    rng = np.random.default_rng(seed); p = Page(600, 2300)
    f = font('arimo-latin-400-normal', 21); fb = font('arimo-latin-700-normal', 30)
    p.text((150, 50), 'CORNER MARKET', fb)
    p.text((120, 100), 'Main Street 18  1050 Town', f)
    y = 170; tot = 0
    for i in range(34):
        name = ' '.join(WORDS[j] for j in rng.integers(0, len(WORDS), 2)).upper()
        pr = int(rng.integers(49, 2999)) / 100; tot += pr
        s = f'{name[:22]:<22} {pr:>7.2f}'
        p.text((40, y), name[:22], f, keep=False); p.d.text((440, y), f'{pr:>7.2f}', font=f, fill=(20, 20, 24))
        p.lines.append(f'{name[:22]} {pr:.2f}')
        y += 34
    p.d.line([40, y + 10, 560, y + 10], fill=(40, 40, 40), width=2)
    p.text((40, y + 30), f'TOTAL EUR {tot:.2f}', fb)
    p.text((40, y + 90), 'CARD **** 4471  14.03.2026 18:22', f)
    y += 150
    for ln in wrap(rng, font('arimo-latin-400-normal', 16), 520, 50): p.text((40, y), ln, font('arimo-latin-400-normal', 16)); y += 22
    return p

def book(seed):
    """dense book page, serif"""
    rng = np.random.default_rng(seed); p = Page(1100, 1650)
    f = font('tinos-latin-400-normal', 23); y = 120
    p.text((420, 60), 'CHAPTER SEVEN', font('tinos-latin-400-normal', 26))
    while y < 1520:
        for ln in wrap(rng, f, 900, 60):
            if y > 1520: break
            p.text((100, y), ln, f); y += 31
        y += 10
    p.text((530, 1580), '147', f)
    return p

PAGES = {'letter': letter, 'invoice': invoice, 'note': note, 'receipt': receipt, 'book': book}

# --------------------------------------------------------------------------- shape of the paper
def profile(kind, n, rng):
    """unit-speed curve (X, Z) along one page direction, n samples over the page length 0…1"""
    s = np.linspace(0, 1, n)
    if kind == 'flat': th = np.zeros(n)
    elif kind == 'curl': th = 0.55 * np.sin(np.pi * (s - 0.5))          # bowed sheet
    elif kind == 'curl_end': th = 0.9 * np.clip((s - 0.55) / 0.45, 0, 1) ** 2  # one end curling up
    elif kind == 'book': th = -1.15 * np.exp(-s / 0.12) + 0.25 * s       # rises steeply from the spine
    elif kind == 'fold': th = 0.35 * np.tanh((s - 0.5) / 0.03)           # crease across the middle
    else: raise ValueError(kind)
    ds = 1 / (n - 1)
    X = np.concatenate([[0], np.cumsum(np.cos(th[1:]) * ds)]); Z = np.concatenate([[0], np.cumsum(np.sin(th[1:]) * ds)])
    return X, Z

def surface(scn, W, H, rng):
    """3-D points of the page on a grid (in page pixels): returns u, v grids and P (…, 3)"""
    step = 6
    us = np.arange(0, W + step, step).clip(0, W); vs = np.arange(0, H + step, step).clip(0, H)
    U, V = np.meshgrid(us, vs)
    bend, axis = scn.get('bend', 'flat'), scn.get('axis', 'x')
    if axis == 'x':
        X, Z = profile(bend, len(us), rng); Px = np.broadcast_to(X * W, U.shape); Pz = np.broadcast_to(Z * W, U.shape); Py = V.astype(float)
    else:
        X, Z = profile(bend, len(vs), rng); Py = np.broadcast_to((X * H)[:, None], U.shape); Pz = np.broadcast_to((Z * H)[:, None], U.shape); Px = U.astype(float)
    P = np.stack([Px, Py, Pz], -1).astype(float)
    if scn.get('crumple'):
        # crumpled: a few smooth random bumps (stretches the paper a little; small enough not to matter)
        a = scn['crumple'] * min(W, H)
        for _ in range(7):
            cx, cy, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.12, 0.3) * min(W, H)
            P[..., 2] += a * rng.uniform(-1, 1) * np.exp(-((U - cx) ** 2 + (V - cy) ** 2) / (2 * r * r))
    return us, vs, P

def rotation(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]]); Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]); Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx

def render(name, page, scn, seed):
    rng = np.random.default_rng(seed)
    flat = np.asarray(page.im).astype(np.float32)
    H, W = flat.shape[:2]
    us, vs, P = surface(scn, W, H, rng)
    # centre the paper, tilt it, put it in front of the camera
    c = P.reshape(-1, 3).mean(0); P = P - c
    R = rotation(*[math.radians(a) for a in scn.get('tilt', (0, 0, 0))])
    P = P @ R.T
    PW, PH = scn.get('photo', (2250, 3000))
    fpx = 0.85 * max(PW, PH)               # about a 70° phone lens
    fill = scn.get('fill', 0.78)
    span = max(np.ptp(P[..., 0]) / PW, np.ptp(P[..., 1]) / PH)
    dist = fpx * span / fill
    Z = P[..., 2] + dist
    x = fpx * P[..., 0] / Z + PW / 2 + scn.get('shift', (0, 0))[0]; y = fpx * P[..., 1] / Z + PH / 2 + scn.get('shift', (0, 0))[1]
    # lighting from the surface normal (and dimming)
    nx = np.gradient(P, axis=1); ny = np.gradient(P, axis=0); N = np.cross(nx, ny); N /= np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9
    if N[..., 2].mean() > 0: N = -N
    L = np.array(scn.get('light', (0.35, -0.45, -0.82))); L = L / np.linalg.norm(L)
    shade = 0.45 + 0.55 * np.clip((N * L).sum(-1), 0, 1) / max(1e-6, (np.array([0, 0, -1]) * L).sum())
    shade = np.clip(shade, 0, 1.08) * scn.get('exposure', 1.0)
    # page coordinates for every photo pixel (scattered → grid), only inside the page's box
    x0, x1 = int(max(0, x.min() - 2)), int(min(PW, x.max() + 3)); y0, y1 = int(max(0, y.min() - 2)), int(min(PH, y.max() + 3))
    gx, gy = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1))
    U, V = np.meshgrid(us.astype(float), vs.astype(float))
    pts = np.stack([x.ravel(), y.ravel()], 1)
    mu = griddata(pts, U.ravel(), (gx, gy), method='linear'); mv = griddata(pts, V.ravel(), (gx, gy), method='linear')
    ms = griddata(pts, shade.ravel(), (gx, gy), method='linear')
    inside = np.isfinite(mu)
    # desk
    desk_col = np.array(scn.get('desk', (92, 78, 64)), np.float32)
    noise_lo = cv2.resize(rng.normal(0, 1, (PH // 60, PW // 60)).astype(np.float32), (PW, PH), interpolation=cv2.INTER_CUBIC)
    grain = rng.normal(0, 1, (PH, PW)).astype(np.float32)
    photo = desk_col[None, None, :] * (1 + 0.06 * noise_lo[..., None]) + 4 * grain[..., None]
    # ambient falloff over the whole frame
    fy, fx = np.mgrid[0:PH, 0:PW].astype(np.float32)
    vign = 1 - 0.18 * (((fx - PW / 2) / PW) ** 2 + ((fy - PH / 2) / PH) ** 2) * 2
    paper_tint = np.array(scn.get('paper', (246, 244, 238)), np.float32) / 255
    sx = cv2.remap(flat, np.nan_to_num(mu).astype(np.float32), np.nan_to_num(mv).astype(np.float32), cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    sx = sx * paper_tint[None, None, :]
    sx = sx * np.nan_to_num(ms)[..., None]
    reg = photo[y0:y1, x0:x1]
    reg[inside] = sx[inside]
    photo *= vign[..., None] * scn.get('exposure', 1.0) ** 0.3
    # cast shadow (a hand or the phone): a soft dark blob over part of the frame
    if scn.get('shadow'):
        sh = np.zeros((PH, PW), np.float32)
        cx, cy = scn['shadow'][0] * PW, scn['shadow'][1] * PH
        cv2.ellipse(sh, (int(cx), int(cy)), (int(PW * 0.42), int(PH * 0.22)), 25, 0, 360, 1.0, -1)
        sh = cv2.GaussianBlur(sh, (0, 0), PW * 0.05)
        photo *= (1 - scn.get('shadow_depth', 0.5) * sh)[..., None]
    if scn.get('blur'): photo = cv2.GaussianBlur(photo, (0, 0), scn['blur'])
    photo += rng.normal(0, scn.get('noise', 2.0), photo.shape).astype(np.float32)
    photo = np.clip(photo, 0, 255).astype(np.uint8)
    os.makedirs(OUT, exist_ok=True)
    cv2.imwrite(os.path.join(OUT, name + '.jpg'), cv2.cvtColor(photo, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, scn.get('jpeg', 88)])
    page.im.save(os.path.join(OUT, name + '_flat.png'))
    corners = [[float(x[0, 0]), float(y[0, 0])], [float(x[0, -1]), float(y[0, -1])], [float(x[-1, -1]), float(y[-1, -1])], [float(x[-1, 0]), float(y[-1, 0])]]
    json.dump({'case': name, 'W': PW, 'H': PH, 'quad': corners, 'page': [W, H], 'lines': page.lines, 'scenario': scn}, open(os.path.join(OUT, name + '.json'), 'w'), indent=1)

# --------------------------------------------------------------------------- the cases
DESK = (92, 78, 64); GREY = (150, 150, 152); LIGHT = (214, 210, 200)
CASES = {
    # flat, easy: the classical path must stay as good as it is
    'flat_letter':       ('letter',  {'tilt': (8, -5, 2)}, 1),
    'flat_invoice':      ('invoice', {'tilt': (14, 6, -3), 'desk': GREY}, 2),
    # curved paper
    'curl_letter':       ('letter',  {'bend': 'curl', 'tilt': (10, 0, 1)}, 3),
    'curlend_invoice':   ('invoice', {'bend': 'curl_end', 'axis': 'y', 'tilt': (12, 3, 0)}, 4),
    'book_page':         ('book',    {'bend': 'book', 'tilt': (8, 4, -2), 'light': (0.5, -0.2, -0.84)}, 5),
    'book_dim':          ('book',    {'bend': 'book', 'tilt': (14, -6, 3), 'exposure': 0.62, 'noise': 5.0, 'blur': 1.2}, 6),
    'book_close':        ('book',    {'bend': 'book', 'tilt': (6, 2, 1), 'fill': 1.08, 'light': (0.5, -0.2, -0.84)}, 15),
    'fold_letter':      ('letter',  {'bend': 'fold', 'axis': 'y', 'tilt': (6, 4, -2)}, 7),
    'crumple_note':      ('note',    {'crumple': 0.025, 'tilt': (9, 3, 4), 'desk': LIGHT}, 8),
    'crumple_receipt':   ('receipt', {'crumple': 0.03, 'tilt': (8, -2, 2), 'desk': DESK, 'fill': 0.85}, 9),
    'curl_receipt':      ('receipt', {'bend': 'curl', 'axis': 'y', 'tilt': (6, 0, -2), 'fill': 0.9}, 10),
    # light and blur
    'shadow_invoice':    ('invoice', {'tilt': (10, 4, 1), 'shadow': (0.3, 0.75), 'shadow_depth': 0.55}, 11),
    'shadow_curl_note':  ('note',    {'bend': 'curl', 'tilt': (9, -4, 0), 'shadow': (0.7, 0.3), 'shadow_depth': 0.45}, 12),
    'blur_letter':       ('letter',  {'bend': 'curl', 'tilt': (12, 3, 2), 'blur': 2.0, 'noise': 4.0, 'jpeg': 75}, 13),
    'dim_crumple_letter':('letter',  {'crumple': 0.02, 'tilt': (8, 0, -3), 'exposure': 0.55, 'noise': 6.0}, 14),
}

if __name__ == '__main__':
    OUT = sys.argv[1]
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else list(CASES)
    for n in only:
        kind, scn, seed = CASES[n]
        render(n, PAGES[kind](seed), scn, seed)
        print(n)
