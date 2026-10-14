"""Render the public site's original fluid artwork (static stills).

The hero animates the same field live in docs/site-fluid.js; these stills are its
reduced-motion poster and the backgrounds of the product panels.

Run:  python scripts/build-site-fluid.py
Requires: numpy, Pillow
"""
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(__file__).resolve().parent.parent / "docs" / "assets" / "fluid"
out.mkdir(parents=True, exist_ok=True)

# Ink-wash palettes: paper → mist → wash → ink, plus a warm highlight.
PALETTES = {
    "light": ["#f7f4ef", "#dfe3f3", "#a9b4ea", "#5b63c9", "#f1cdb8"],
    "dark": ["#0d0e14", "#1b1f3a", "#353d8c", "#7f8cf0", "#d39a7c"],
}


def hex_rgb(value):
    return np.array([int(value[i : i + 2], 16) for i in (1, 3, 5)], dtype=np.float32) / 255


def field(x, y, seed, t=0.0):
    """Sum-of-waves fbm, warped twice; mirrors the GLSL in site-fluid.js."""
    rng = np.random.default_rng(seed)

    def fbm(px, py, octaves=5):
        total, amp, freq = np.zeros_like(px), 0.5, 1.0
        for _ in range(octaves):
            a = rng.uniform(0, np.pi)
            ph = rng.uniform(0, 2 * np.pi)
            total += amp * np.sin(freq * (px * np.cos(a) + py * np.sin(a)) + ph + t)
            amp, freq = amp * 0.55, freq * 1.9
        return total

    qx, qy = fbm(x, y), fbm(x + 5.2, y + 1.3)
    rx, ry = fbm(x + 2.4 * qx + 1.7, y + 2.4 * qy + 9.2), fbm(x + 2.4 * qx + 8.3, y + 2.4 * qy + 2.8)
    return fbm(x + 2.0 * rx, y + 2.0 * ry), np.hypot(qx, qy)


def render(name, width, height, seed, palette="light", scale=2.6, shift=(0.0, 0.0)):
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    aspect = width / height
    x = (xs / width - 0.5) * scale * aspect + shift[0]
    y = (ys / height - 0.5) * scale + shift[1]
    f, warp = field(x, y, seed)
    f = (f - f.min()) / (f.max() - f.min())
    warp = (warp - warp.min()) / (warp.max() - warp.min())
    paper, mist, wash, ink, warm = (hex_rgb(c) for c in PALETTES[palette])
    smooth = lambda e0, e1, v: np.clip((v - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((v - e0) / (e1 - e0), 0, 1))
    color = paper + (mist - paper) * smooth(0.15, 0.55, f)[..., None]
    color += (wash - color) * smooth(0.5, 0.85, f)[..., None]
    color += (ink - color) * (smooth(0.82, 1.0, f) * 0.85)[..., None]
    color += (warm - color) * (smooth(0.62, 1.0, warp) * 0.45)[..., None]
    # Fine silk grain keeps large gradients from banding after WebP encoding.
    color += np.random.default_rng(seed).normal(0, 0.006, color.shape).astype(np.float32)
    image = Image.fromarray((np.clip(color, 0, 1) * 255).astype(np.uint8))
    target = out / f"{name}.webp"
    image.save(target, quality=86, method=6)
    print(f"{target.name}: {target.stat().st_size // 1024} KB")


render("hero-light", 1920, 1200, seed=7)
render("hero-dark", 1920, 1200, seed=7, palette="dark")
for i, (seed, shift) in enumerate([(11, (0.4, -0.2)), (23, (-0.6, 0.3)), (31, (0.1, 0.8)), (47, (-0.3, -0.7))]):
    render(f"panel-{i + 1}", 1600, 1000, seed=seed, shift=shift, scale=2.2)
render("closing-light", 1920, 900, seed=59, scale=2.0)
render("closing-dark", 1920, 900, seed=59, scale=2.0, palette="dark")
