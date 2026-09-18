# Asset provenance

## Three.js

Local runtime copied from Yan Agent's bundled `renderer/vendor/three/three.global.js`.
Upstream: https://github.com/mrdoob/three.js

MIT License

Copyright © 2010–2026 Three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Three.js GLTFLoader / BufferGeometryUtils

Version 0.159.0, matching the existing Three.js r159 runtime; same MIT license above.
Retrieved from the published npm distribution via jsDelivr:

- https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/loaders/GLTFLoader.js
- https://cdn.jsdelivr.net/npm/three@0.159.0/examples/jsm/utils/BufferGeometryUtils.js

Original sources retained under `assets/vendor/`; `gltf-loader.js` is bundled locally with esbuild and shares the existing Three.js instance.

## Poly Haven photographic textures — CC0

- Rock Boulder Dry: https://polyhaven.com/a/rock_boulder_dry
- Stone Brick Wall 001: https://polyhaven.com/a/stone_brick_wall_001
- License: https://polyhaven.com/license
- Downloaded from asset URLs returned by https://api.polyhaven.com/files/{asset}.
- Local files: `rock-color.jpg`, `rock-normal.jpg`, `stone-color.jpg`, `stone-normal.jpg`.
- `textures-data.js` embeds the same images for offline file:// use.
- The original API asset manifests are retained as `rock-files.json` and `stone-files.json`.

Architecture, clouds, generated material textures, camera composition and interface are original code for this prototype.

## brunette.glb base character

Downloaded from the official TalkingHead example repository: https://github.com/met4citizen/TalkingHead/blob/main/avatars/brunette.glb . The asset is a Ready Player Me avatar, licensed CC BY-NC 4.0; attribution is required and commercial use is excluded. It is used locally as the female body/face/rig base for the nine prototype residents.
