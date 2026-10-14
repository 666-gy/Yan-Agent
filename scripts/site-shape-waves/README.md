# Shape Waves website background

Upstream: https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/ShapeWaves

`ShapeWaves.jsx` and `ShapeWaves.css` are the unmodified upstream files retrieved on 2026-10-13. License: `LICENSE.react-bits` (MIT + Commons Clause). Dependencies are pinned in `package-lock.json`; vgpu matches the upstream 0.3.1 dependency baseline.

The entry uses the dark demo defaults (including the `</>` cutout and #120f17 background), overriding only introDuration=1, speed=1.2, cellSize=12, glow=0.65 from the requested URL.

Build: `npm ci --prefix scripts/site-shape-waves`, then `node scripts/site-shape-waves/build.cjs`. Generated JS, CSS and dependency license comments are served locally from docs/.
