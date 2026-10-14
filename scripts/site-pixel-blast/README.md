# Pixel Blast website background

Source: https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/PixelBlast (retrieved 2026-10-13).
License: LICENSE.react-bits. Shader and CSS are unchanged. Lifecycle repairs remove the upstream cleanup early return and keep the latest animation-frame ID so unmount actually stops rendering and frees resources. The wrapper unmounts while hidden/offscreen.

Demo parameters: color=#97cdcf, patternScale=8, patternDensity=1.25, speed=1. Other defaults match the demo: square, pixelSize=4, edgeFade=0.25, liquid=false, noiseAmount=0.

Build: npm ci --prefix scripts/site-pixel-blast; node scripts/site-pixel-blast/build.cjs.
