"""Procedural PBR texture sets for the city, following xikhar/atlas `pbr-texture-gen`.

Each facade set is one seamless tile covering 8 bays x 8 floors. We author the
base colour, a physical height field, roughness and metallic masks directly
(we know where glass, frames, sills and mortar are), then derive the tangent
normal and AO with atlas's `pbr_maps.py` and pack glTF-style ORM
(R = AO, G = roughness, B = metallic).

To swap in image-generated textures later, replace `<name>_basecolor.jpg`
(and optionally the height) and re-run only the derivation steps.

    python3 tools/gen_textures.py            # all sets
    python3 tools/gen_textures.py glass_blue # one set
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "textures")
PBR = os.path.join(ROOT, "tools", "atlas", "pbr_maps.py")
N = 1024
CELLS = 8
C = N // CELLS  # pixels per bay / floor cell


# ----------------------------------------------------------------- helpers
def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def vnoise(rng, size, cells):
    """Tileable value noise in [0,1]."""
    g = rng.random((cells, cells)).astype(np.float32)
    t = np.arange(size, dtype=np.float32) * cells / size
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0]
    b = g[i0][:, i1]
    c = g[i1][:, i0]
    d = g[i1][:, i1]
    fx = f[None, :]
    fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(rng, size, base=4, octaves=5, gain=0.5):
    out = np.zeros((size, size), np.float32)
    amp, tot, cells = 1.0, 0.0, base
    for _ in range(octaves):
        if cells > size:
            break
        out += vnoise(rng, size, cells) * amp
        tot += amp
        amp *= gain
        cells *= 2
    return out / tot


class Canvas:
    def __init__(self, rng, base, rough=0.85, height=0.5, metal=0.0):
        self.rng = rng
        self.col = np.tile(hexc(base), (N, N, 1)).astype(np.float32)
        self.h = np.full((N, N), height, np.float32)
        self.r = np.full((N, N), rough, np.float32)
        self.m = np.full((N, N), metal, np.float32)

    def rect(self, x0, y0, x1, y1, col=None, h=None, r=None, m=None, mul=None):
        x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(N, x1), min(N, y1)
        if x1 <= x0 or y1 <= y0:
            return
        s = (slice(y0, y1), slice(x0, x1))
        if col is not None:
            self.col[s] = col
        if mul is not None:
            self.col[s] *= mul
        if h is not None:
            self.h[s] = h
        if r is not None:
            self.r[s] = r
        if m is not None:
            self.m[s] = m

    def grime(self, amount=0.12, scale=6, tint=(0.95, 0.93, 0.9)):
        n = fbm(self.rng, N, scale, 6)
        k = 1.0 - amount * (n - 0.5) * 2.0
        self.col *= k[..., None]
        self.col *= np.array(tint, np.float32)[None, None, :] ** (n[..., None] * 0.5)

    def speckle(self, amount=0.06):
        n = self.rng.random((N, N)).astype(np.float32)
        self.col *= (1.0 + (n - 0.5) * amount)[..., None]

    def streaks(self, xs, y0, length, strength=0.18, width=6):
        """Rain-washed dirt streaks running down from a sill (wraps vertically)."""
        for x in xs:
            w = width * (0.6 + self.rng.random())
            L = int(length * (0.5 + self.rng.random()))
            a = strength * (0.5 + self.rng.random())
            for dy in range(L):
                y = (int(y0) + dy) % N
                fall = (1 - dy / L) ** 1.5
                xa, xb = int(x - w / 2), int(x + w / 2)
                cols = np.arange(xa, xb) % N
                prof = 1 - np.abs(np.linspace(-1, 1, len(cols))) ** 2
                self.col[y, cols] *= (1 - a * fall * prof)[:, None]


def bricks(cv, course=3, stretch=7, mortar_col=None, var=0.12, mortar_h=0.42):
    """Running-bond brick courses; tiny at this texel density, so keep contrast low."""
    rng = cv.rng
    yy, xx = np.mgrid[0:N, 0:N]
    row = yy // course
    off = (row % 2) * (stretch // 2)
    bx = (xx + off) // stretch
    tone = rng.random((N // course + 2, N // stretch + 3)).astype(np.float32)
    t = tone[row, bx % tone.shape[1]]
    cv.col *= (1 + (t - 0.5) * var)[..., None]
    mortar = ((yy % course) == 0) | (((xx + off) % stretch) == 0)
    if mortar_col is not None:
        cv.col[mortar] = cv.col[mortar] * 0.35 + hexc(mortar_col) * 0.65
    cv.h[mortar] = mortar_h


def glass_tint(rng, base, refl, top_bias=0.35):
    """A window pane's colour: dark glass mixed with a sky/building reflection gradient."""
    return base, refl, top_bias


def pane(cv, x0, y0, x1, y1, refl_field, kind="dark", interior=None):
    """Paint one glazed opening with a vertical reflection gradient + interior variety."""
    rng = cv.rng
    x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
    h = max(1, y1 - y0)
    grad = np.linspace(1.0, 0.0, h, dtype=np.float32)[:, None, None]
    rf = float(refl_field[min(N - 1, max(0, (y0 + y1) // 2)), min(N - 1, max(0, (x0 + x1) // 2))])
    sky = np.array([0.62, 0.70, 0.78], np.float32) * (0.75 + 0.5 * rf)
    dark = np.array([0.07, 0.085, 0.10], np.float32) * (0.8 + 0.5 * rng.random())
    k = (0.25 + 0.55 * rf) * (0.35 + 0.65 * grad)
    col = dark * (1 - k) + sky * k
    cv.col[y0:y1, x0:x1] = col
    cv.h[y0:y1, x0:x1] = 0.12
    cv.r[y0:y1, x0:x1] = 0.06
    cv.m[y0:y1, x0:x1] = 0.3
    roll = rng.random() if interior is None else interior
    if roll < 0.28:  # venetian blinds lowered part-way
        bh = int(h * (0.25 + 0.6 * rng.random()))
        shade = np.array([0.78, 0.74, 0.66], np.float32) * (0.75 + 0.25 * rng.random())
        cv.col[y0:y0 + bh, x0:x1] = cv.col[y0:y0 + bh, x0:x1] * 0.35 + shade * 0.65
        cv.col[y0:y0 + bh:2, x0:x1] *= 0.88
        cv.r[y0:y0 + bh, x0:x1] = 0.18
    elif roll < 0.4:  # curtains drawn at the sides
        cw = max(1, (x1 - x0) // 4)
        cc = [np.array([0.62, 0.52, 0.4], np.float32), np.array([0.7, 0.68, 0.62], np.float32), np.array([0.45, 0.2, 0.18], np.float32)][rng.integers(3)]
        for xa in (x0, x1 - cw):
            cv.col[y0:y1, xa:xa + cw] = cv.col[y0:y1, xa:xa + cw] * 0.4 + cc * 0.6
    elif roll < 0.5:  # dim warm interior
        cv.col[y0:y1, x0:x1] = cv.col[y0:y1, x0:x1] * 0.6 + np.array([0.3, 0.24, 0.17], np.float32) * 0.4


def ac_unit(cv, cx, y_sill):
    w, h = C * 0.3, C * 0.16
    cv.rect(cx - w / 2, y_sill - h, cx + w / 2, y_sill, col=hexc("#b9b8b2"), h=0.95, r=0.45, m=0.4)
    cv.rect(cx - w / 2, y_sill - h, cx + w / 2, y_sill - h + 2, mul=1.15)
    for gy in range(int(y_sill - h + 4), int(y_sill - 2), 2):
        cv.rect(cx - w / 2 + 3, gy, cx + w / 2 - 3, gy + 1, mul=0.7)


# ----------------------------------------------------------------- facade styles
def punched(cv, spec, refl):
    """Masonry facade with one punched window per cell (prewar / brownstone / postwar)."""
    rng = cv.rng
    ww, wh = spec["win"]
    frame = hexc(spec["frame"])
    sill = hexc(spec.get("sill", "#cfc6b4"))
    sill_xs = []
    for fy in range(CELLS):
        for bx in range(CELLS):
            x0, y0 = bx * C, fy * C
            w, h = C * ww, C * wh
            wx, wy = x0 + (C - w) / 2, y0 + C * spec.get("wtop", 0.2)
            # masonry surround / quoin
            if spec.get("surround"):
                s = spec["surround"]
                cv.rect(wx - s, wy - s, wx + w + s, wy + h + s, col=hexc(spec["surround_col"]), h=0.62, r=0.8)
            # lintel & sill (projecting stone)
            cv.rect(wx - 5, wy - 7, wx + w + 5, wy - 1, col=sill * (0.92 + 0.1 * rng.random()), h=0.85, r=0.8)
            if spec.get("pediment") and fy % 2 == 0:
                cv.rect(wx - 8, wy - 12, wx + w + 8, wy - 7, col=sill * 0.95, h=0.95, r=0.8)
            cv.rect(wx - 6, wy + h + 1, wx + w + 6, wy + h + 6, col=sill, h=0.9, r=0.8)
            cv.rect(wx - 6, wy + h + 6, wx + w + 6, wy + h + 8, mul=0.6)  # sill shadow
            # frame (recessed reveal is the height step from wall to 0.3)
            cv.rect(wx, wy, wx + w, wy + h, col=frame, h=0.32, r=0.45)
            f = spec.get("fw", 4)
            pane(cv, wx + f, wy + f, wx + w - f, wy + h - f, refl)
            # double-hung meeting rail / mullions
            if spec.get("rail", True):
                cv.rect(wx + f, wy + h * 0.5 - 2, wx + w - f, wy + h * 0.5 + 2, col=frame, h=0.3, r=0.45)
            for k in range(1, spec.get("mullions", 1)):
                mx = wx + w * k / spec["mullions"]
                cv.rect(mx - 1.5, wy + f, mx + 1.5, wy + h - f, col=frame, h=0.3, r=0.45)
            if rng.random() < spec.get("ac", 0.0):
                ac_unit(cv, wx + w * (0.3 + 0.4 * rng.random()), wy + h)
            sill_xs.append((wx + w / 2, wy + h + 8))
    for (sx, sy) in sill_xs:
        if rng.random() < 0.55:
            cv.streaks([sx + (rng.random() - 0.5) * 20], sy, C * 0.7, strength=spec.get("streak", 0.14), width=10)


def facade_prewar_brick(rng, refl, base="#8a4632", mortar="#b7a998", ac=0.14):
    cv = Canvas(rng, base, rough=0.9)
    bricks(cv, course=3, stretch=7, mortar_col=mortar, var=0.22)
    cv.grime(0.16, 5)
    # stone belt course every other floor top
    for fy in range(0, CELLS, 4):
        cv.rect(0, fy * C, N, fy * C + 6, col=hexc("#cbbfa8"), h=0.8, r=0.85)
    punched(cv, {"win": (0.42, 0.56), "frame": "#e9e4da", "sill": "#cdbfa6", "ac": ac, "wtop": 0.22}, refl)
    cv.speckle(0.05)
    return cv


def facade_prewar_tan(rng, refl):
    cv = facade_prewar_brick(rng, refl, base="#b58f63", mortar="#d2c2a4", ac=0.12)
    return cv


def facade_white_brick(rng, refl):
    cv = Canvas(rng, "#d7d2c6", rough=0.8)
    bricks(cv, course=3, stretch=7, mortar_col="#bab4a8", var=0.08)
    cv.grime(0.18, 5)
    punched(cv, {"win": (0.62, 0.5), "frame": "#8b8f93", "sill": "#c5c0b4", "ac": 0.2, "wtop": 0.25, "mullions": 2, "rail": False, "fw": 3, "streak": 0.2}, refl)
    cv.speckle(0.05)
    return cv


def facade_limestone(rng, refl):
    cv = Canvas(rng, "#cfc3aa", rough=0.88, height=0.55)
    # rusticated coursing
    for y in range(0, N, 22):
        cv.rect(0, y, N, y + 1.5, mul=0.8, h=0.45)
    for y in range(0, N, 22):
        off = 0 if (y // 22) % 2 else 34
        for x in range(off, N, 68):
            cv.rect(x, y, x + 1.2, y + 22, mul=0.88, h=0.5)
    cv.grime(0.2, 4)
    # belt courses
    for fy in range(0, CELLS, 4):
        cv.rect(0, fy * C, N, fy * C + 8, col=hexc("#d8ceb8"), h=0.9, r=0.85)
        cv.rect(0, fy * C + 8, N, fy * C + 11, mul=0.62)
    punched(cv, {"win": (0.4, 0.58), "frame": "#3c3a36", "sill": "#e0d6c0", "surround": 5, "surround_col": "#d9ceb6", "pediment": True, "ac": 0.06, "streak": 0.2}, refl)
    cv.speckle(0.06)
    return cv


def facade_brownstone(rng, refl):
    cv = Canvas(rng, "#6d4a37", rough=0.92, height=0.55)
    n = fbm(rng, N, 8, 6)
    cv.col *= (0.85 + 0.3 * n)[..., None]
    cv.grime(0.12, 6)
    punched(cv, {"win": (0.44, 0.64), "frame": "#1f1b18", "sill": "#8a6a55", "surround": 4, "surround_col": "#7b5745", "pediment": True, "ac": 0.05, "streak": 0.1}, refl)
    cv.speckle(0.05)
    return cv


def facade_deco(rng, refl):
    """Art-deco setback tower: raised brick piers, dark recessed spandrels, vertical windows."""
    cv = Canvas(rng, "#b8a584", rough=0.88)
    bricks(cv, course=3, stretch=7, mortar_col="#cfc2a8", var=0.1)
    cv.grime(0.16, 4)
    for bx in range(CELLS + 1):
        x0 = bx * C
        # raised pier on each bay edge
        cv.rect(x0 - C * 0.1, 0, x0 + C * 0.1, N, col=hexc("#c9b893"), h=0.9, r=0.85)
        cv.rect(x0 + C * 0.1, 0, x0 + C * 0.12, N, mul=0.72)
    for fy in range(CELLS):
        for bx in range(CELLS):
            x0, y0 = bx * C, fy * C
            wx0, wx1 = x0 + C * 0.2, x0 + C * 0.8
            cv.rect(wx0, y0, wx1, y0 + C, col=hexc("#4c4436"), h=0.3, r=0.55, m=0.3)  # bronze spandrel strip
            cv.rect(wx0 + 4, y0 + C * 0.12, wx1 - 4, y0 + C * 0.14, mul=1.3)
            cv.rect(wx0 + 3, y0 + C * 0.24, wx1 - 3, y0 + C * 0.9, col=hexc("#2a2a2a"), h=0.28)
            pane(cv, wx0 + 6, y0 + C * 0.26, wx1 - 6, y0 + C * 0.88, refl)
            cv.rect((wx0 + wx1) / 2 - 1.5, y0 + C * 0.26, (wx0 + wx1) / 2 + 1.5, y0 + C * 0.88, col=hexc("#2a2a2a"), h=0.28)
    cv.speckle(0.05)
    return cv


def facade_curtain(rng, refl, tint="#4e6a80", mull="#8e9aa4", spandrel="#33414c", metal=0.75):
    """Unitised glass curtain wall: per-panel tint variation is what sells it."""
    cv = Canvas(rng, mull, rough=0.35, height=0.6, metal=0.6)
    t = hexc(tint)
    big = fbm(rng, N, 3, 3)
    for fy in range(CELLS):
        for bx in range(CELLS * 2):
            pw = C / 2
            x0, y0 = bx * pw, fy * C
            k = 0.82 + 0.3 * rng.random() + 0.3 * (big[int(y0), int(x0)] - 0.5)
            hue = np.array([1.0 + (rng.random() - 0.5) * 0.08, 1.0, 1.0 + (rng.random() - 0.5) * 0.1], np.float32)
            y_sp = y0 + C * 0.8
            # vision glass
            h = int(C * 0.8) - 4
            grad = np.linspace(1.12, 0.9, h, dtype=np.float32)[:, None, None]
            cv.col[int(y0) + 2:int(y0) + 2 + h, int(x0) + 2:int(x0 + pw) - 2] = t * hue * k * grad
            cv.h[int(y0) + 2:int(y0) + 2 + h, int(x0) + 2:int(x0 + pw) - 2] = 0.45
            cv.r[int(y0) + 2:int(y0) + 2 + h, int(x0) + 2:int(x0 + pw) - 2] = 0.04 + 0.05 * rng.random()
            cv.m[int(y0) + 2:int(y0) + 2 + h, int(x0) + 2:int(x0 + pw) - 2] = metal
            # opaque spandrel band
            cv.rect(x0 + 2, y_sp, x0 + pw - 2, y0 + C - 2, col=hexc(spandrel) * (0.9 + 0.2 * rng.random()), h=0.5, r=0.2, m=0.7)
            if rng.random() < 0.18:  # a few panels with blinds down behind the glass
                bh = int(C * 0.8 * (0.2 + 0.6 * rng.random()))
                cv.rect(x0 + 2, y0 + 2, x0 + pw - 2, y0 + 2 + bh, mul=1.35, r=0.12)
    cv.speckle(0.03)
    return cv


def facade_glass_blue(rng, refl):
    return facade_curtain(rng, refl)


def facade_glass_dark(rng, refl):
    return facade_curtain(rng, refl, tint="#2e3740", mull="#1c1f22", spandrel="#202428", metal=0.8)


def facade_glass_green(rng, refl):
    return facade_curtain(rng, refl, tint="#4f7470", mull="#b7bcbe", spandrel="#3b4a49", metal=0.7)


def facade_modern(rng, refl):
    """Precast concrete with continuous ribbon windows."""
    cv = Canvas(rng, "#a9a8a2", rough=0.9, height=0.6)
    cv.grime(0.2, 5)
    for fy in range(CELLS):
        y0 = fy * C
        wy0, wy1 = y0 + C * 0.3, y0 + C * 0.78
        cv.rect(0, wy0 - 3, N, wy1 + 3, col=hexc("#5b5f63"), h=0.3, r=0.4, m=0.5)
        for bx in range(CELLS * 2):
            x0 = bx * C / 2
            pane(cv, x0 + 3, wy0, x0 + C / 2 - 3, wy1, refl, interior=rng.random() * 0.8 + 0.2)
        # precast panel joints + tie-holes
        for bx in range(CELLS):
            cv.rect(bx * C, y0, bx * C + 1, y0 + C, mul=0.75, h=0.5)
            cv.rect(bx * C + C - 1, y0, bx * C + C, y0 + C, mul=0.75, h=0.5)
        cv.rect(0, y0, N, y0 + 1, mul=0.75, h=0.5)
        cv.rect(0, y0 + C - 1, N, y0 + C, mul=0.75, h=0.5)
        cv.streaks([x for x in np.linspace(0, N, 12)], wy1 + 3, C * 0.5, strength=0.15, width=14)
    cv.speckle(0.05)
    return cv


FACADES = {
    "prewar_brick": facade_prewar_brick,
    "prewar_tan": facade_prewar_tan,
    "white_brick": facade_white_brick,
    "limestone": facade_limestone,
    "brownstone": facade_brownstone,
    "deco": facade_deco,
    "glass_blue": facade_glass_blue,
    "glass_dark": facade_glass_dark,
    "glass_green": facade_glass_green,
    "modern": facade_modern,
}


# ----------------------------------------------------------------- ground / roof sets
def ground_asphalt(rng):
    cv = Canvas(rng, "#3b3c3e", rough=0.92)
    n = fbm(rng, N, 4, 7)
    cv.col *= (0.85 + 0.3 * n)[..., None]
    cv.speckle(0.25)
    cv.h = 0.5 + (rng.random((N, N)).astype(np.float32) - 0.5) * 0.25
    # tar-sealed cracks and patches
    for _ in range(6):
        x, y = rng.random() * N, rng.random() * N
        w, h = 80 + rng.random() * 200, 60 + rng.random() * 160
        cv.rect(x, y, x + w, y + h, mul=0.92 + 0.12 * rng.random(), r=0.85)
    for _ in range(10):
        x, y = rng.random() * N, rng.random() * N
        for _ in range(90):
            x = (x + rng.normal(0, 1.0)) % N
            y = (y + rng.normal(0.6, 0.9)) % N
            cv.rect(x, y, x + 1, y + 1, mul=0.7, h=0.35, r=0.7)
    return cv


def ground_sidewalk(rng):
    cv = Canvas(rng, "#a19d95", rough=0.9)
    n = fbm(rng, N, 6, 6)
    cv.col *= (0.88 + 0.24 * n)[..., None]
    cv.speckle(0.12)
    slab = N // 4
    for i in range(0, N, slab):
        for j in range(0, N, slab):
            cv.rect(i + 1, j + 1, i + slab - 1, j + slab - 1, mul=0.94 + 0.12 * rng.random())
        for a in (i, i + slab - 1):
            cv.rect(a, 0, a + 1, N, col=hexc("#6f6b64"), h=0.3)
            cv.rect(0, a, N, a + 1, col=hexc("#6f6b64"), h=0.3)
    for _ in range(40):  # gum spots
        x, y = rng.random() * N, rng.random() * N
        cv.rect(x, y, x + 4, y + 4, mul=0.6)
    return cv


def ground_roof(rng):
    cv = Canvas(rng, "#77787a", rough=0.95)
    n = fbm(rng, N, 5, 7)
    cv.col *= (0.8 + 0.4 * n)[..., None]
    cv.speckle(0.35)
    cv.h = 0.5 + (rng.random((N, N)).astype(np.float32) - 0.5) * 0.4
    for i in range(0, N, N // 6):  # membrane seams
        cv.rect(i, 0, i + 3, N, mul=0.82, h=0.7)
    for _ in range(8):  # ponding stains
        x, y = rng.random() * N, rng.random() * N
        r = 40 + rng.random() * 80
        yy, xx = np.mgrid[0:N, 0:N]
        d = np.hypot(((xx - x + N / 2) % N) - N / 2, ((yy - y + N / 2) % N) - N / 2)
        cv.col *= (1 - 0.18 * np.clip(1 - d / r, 0, 1))[..., None]
    return cv


def ground_plaza(rng):
    cv = Canvas(rng, "#b4aa99", rough=0.85)
    cv.speckle(0.1)
    p = N // 16
    for i in range(0, N, p):
        for j in range(0, N, p):
            cv.rect(i + 1, j + 1, i + p - 1, j + p - 1, mul=0.9 + 0.18 * rng.random())
        for a in (i, i + p - 1):
            cv.rect(a, 0, a + 1, N, mul=0.84, h=0.35)
            cv.rect(0, a, N, a + 1, mul=0.84, h=0.35)
    cv.grime(0.15, 4)
    return cv


def ground_lawn(rng):
    cv = Canvas(rng, "#557a36", rough=1.0)
    n = fbm(rng, N, 4, 6)
    m = fbm(rng, N, 16, 4)
    cv.col *= (0.75 + 0.45 * n)[..., None]
    cv.col = cv.col * (1 - 0.3 * m[..., None]) + hexc("#8a9a4a") * 0.3 * m[..., None]
    blades = rng.random((N, N)).astype(np.float32)
    cv.col *= (0.8 + 0.4 * blades)[..., None]
    cv.h = 0.4 + blades * 0.3
    return cv


def ground_water(rng):
    cv = Canvas(rng, "#2f4656", rough=0.08)
    a = fbm(rng, N, 6, 6, 0.55)
    b = fbm(rng, N, 12, 5, 0.5)
    cv.h = (a * 0.6 + b * 0.4).astype(np.float32)
    return cv


GROUNDS = {
    "asphalt": ground_asphalt,
    "sidewalk": ground_sidewalk,
    "roof": ground_roof,
    "plaza": ground_plaza,
    "lawn": ground_lawn,
    "water": ground_water,
}


# ----------------------------------------------------------------- output
def run(*a):
    subprocess.run([sys.executable, PBR, *a], check=True, stdout=subprocess.DEVNULL)


def export(name, cv, normal_strength=3.0):
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="tex_")
    p = lambda s: os.path.join(tmp, f"{name}_{s}.png")
    col = np.clip(cv.col, 0, 1)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(p("basecolor"))
    for key, arr in (("height", cv.h), ("rough", cv.r), ("metal", cv.m)):
        Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(p(key))
    # atlas derivations: normal + AO from the authored height, then pack ORM
    run("normal", p("height"), p("normal"), "--strength", str(normal_strength))
    run("ao", p("height"), p("ao"), "--strength", "0.8")
    run("orm", p("orm"), "--ao", p("ao"), "--rough", p("rough"), "--metal", p("metal"))
    seam = subprocess.run([sys.executable, PBR, "seamcheck", p("basecolor")], capture_output=True, text=True)
    Image.open(p("basecolor")).convert("RGB").save(os.path.join(OUT, f"{name}_basecolor.jpg"), quality=86)
    Image.open(p("normal")).convert("RGB").save(os.path.join(OUT, f"{name}_normal.webp"), quality=88)
    Image.open(p("orm")).convert("RGB").save(os.path.join(OUT, f"{name}_orm.webp"), quality=88)
    print(f"{name:14s} seam: {seam.stdout.strip().splitlines()[-1] if seam.stdout.strip() else seam.stderr.strip()[:80]}")


def main():
    want = set(sys.argv[1:])
    for i, (name, fn) in enumerate(FACADES.items()):
        if want and name not in want:
            continue
        rng = np.random.default_rng(100 + i)
        refl = fbm(np.random.default_rng(900 + i), N, 3, 4)
        export(name, fn(rng, refl), normal_strength=4.0)
    for i, (name, fn) in enumerate(GROUNDS.items()):
        if want and name not in want:
            continue
        export(name, fn(np.random.default_rng(300 + i)), normal_strength=2.0)


if __name__ == "__main__":
    main()
