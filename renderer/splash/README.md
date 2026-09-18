# Startup splash

The background is the unmodified React Bits Ghost Fibers component, with every
default matching the upstream demo (including 60 FPS, DPR 1, grain, glow,
recursive waves, twist and rotation). It retains upstream reduced-motion and
page-visibility handling. No external requests are made at startup.

- Demo: https://www.reactbits.dev/backgrounds/ghost-fibers
- Pinned upstream revision: see `vendor/upstream.json`.
- Original source: `src/content/Backgrounds/GhostFibers/` in that repository.
- Component license: `vendor/LICENSE.md` (MIT + Commons Clause).
- Runtime dependency licenses: `vendor/*-LICENSE`.

The centered wordmark uses locally bundled Source Serif 4 Regular, licensed
under SIL OFL (`fonts/LICENSE`). This is a Claude-style serif alternative,
not Claude's proprietary font.

Rebuild with `npm run bundle:splash` after source changes. Both packaging
commands include this step; generated JS, CSS and fonts are included under
`renderer/**/*`, so packaged apps do not need React/OGL installed at runtime.

`main.js` keeps the splash visible for 3000 ms from display, then reveals the
ready main window. If main-window loading is slower, it waits for readiness.
Run `node test/splash.e2e.cjs` to check real Electron startup, animation,
local font loading, offline resources and the handoff duration with isolated
user data. The test writes a preview to `output/playwright/splash.png`.
