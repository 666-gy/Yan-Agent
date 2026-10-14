# Third-Party Notices

## Local Voice Input

DeepSeek Harness's SenseVoice provider, recording module and WAV validator are
vendored under MIT at `lib/vendor/dsh-voice`, pinned to commit
639ed015397290b3745d163aafe02ffee4aa3f84. The license and source mapping are
retained in that directory. Source: https://github.com/deepseek-ai/deepseek-harness.
Its bundled utility dependencies are @deepseek-ai/schemastery and dsh-timeout
(MIT) and zod (MIT). sherpa-onnx-node 1.13.8 and its Windows x64 native runtime
are Apache-2.0: https://github.com/k2-fsa/sherpa-onnx. The runtime includes ONNX
Runtime (MIT). SenseVoiceSmall model weights are governed by the FunASR Model
Open Source License Agreement, version 1.1, copyright Alibaba Group, as linked
by https://huggingface.co/FunAudioLLM/SenseVoiceSmall. This is distinct from the
MIT license of the SenseVoice source code. The full model agreement is retained
in `lib/vendor/dsh-voice/licenses/SenseVoice-MODEL_LICENSE`; source:
https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE.
SenseVoiceSmall (FunAudioLLM/FunASR, Alibaba Group) and Silero VAD (MIT) model
files are downloaded separately on explicit user request from the upstream
pinned assets. The ONNX conversion is supplied by csukuangfj/sherpa-onnx.

The Voice settings and composer microphone use the unmodified Keyline Icons
`mic` stroke path (MIT): https://keylineicons.com/icons?search=voice&icon=mic.
The circular model action uses Lucide `download` and `trash-2` SVG paths under
the ISC license reproduced in the Lucide notice below.


## Playwright MCP and Chromium

The Windows installer bundles Microsoft Playwright MCP 0.0.83 and its exact
Playwright / Playwright Core dependencies, pinned in `vendor/playwright/package-lock.json`.
These packages are distributed under Apache-2.0; their LICENSE, NOTICE and
ThirdPartyNotices files are preserved under `resources/playwright-runtime/node_modules`.
Source: https://github.com/microsoft/playwright-mcp and https://github.com/microsoft/playwright.

The matching Chrome for Testing (Chromium), FFmpeg and Winldd distribution is not
part of this installer. Yan Agent downloads it from Playwright's official CDN when
the user installs the Playwright plugin, and verifies every file against the
SHA-256 inventory recorded in `resources/playwright-runtime/runtime.json` before
it is used. The downloaded tree lands in the user's data directory
(`runtimes/playwright/browsers`) together with its license and credit files. The
complete upstream distributions are retained; see their bundled notices for
component licenses.

## Prime Agent Continual Harness

Yan Agent's Continual Harness implementation adapts architectural ideas and
selected data-model patterns from Prime Agent, copyright 2025 Mario Zechner and
copyright 2026 Prime Intellect, licensed under the MIT License.

Source: https://github.com/PrimeIntellect-ai/prime-agent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Edge text-to-speech engine

`lib/tts-msedge.bundle.cjs` bundles the msedge-tts client and its runtime
dependencies so the packaged app stays self-contained. All bundled components
are MIT licensed, with copyright held by their respective authors:

- msedge-tts, copyright Migushthe2nd — https://github.com/Migushthe2nd/MsEdgeTTS
- ws, copyright 2011 Einar Otto Stangvik and contributors — https://github.com/websockets/ws
- axios, copyright 2014-present Matt Zabriskie and contributors — https://github.com/axios/axios
- isomorphic-ws — https://github.com/hemanth/isomorphic-ws
- stream-browserify — https://github.com/browserify/stream-browserify
- buffer, copyright Feross Aboukhadijeh — https://github.com/feross/buffer
- follow-redirects — https://github.com/follow-redirects/follow-redirects
- form-data — https://github.com/form-data/form-data
- proxy-from-env — https://github.com/Rob--W/proxy-from-env

The MIT License terms reproduced above apply to these components under their
respective copyright notices.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Agent role icons

The inline Agent role icons in `renderer/subagent-panel.js` include artwork from
the following MIT/ISC licensed projects. Their copyright and license terms
remain applicable to the bundled SVG paths.

### Lucide

The Review and Research icons are adapted from Lucide (`bug` and
`book-open-text`), copyright 2026 Lucide Icons and Contributors, under the ISC
License. Source: https://github.com/lucide-icons/lucide

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

### Phosphor Icons

The Explore and Build icons are adapted from Phosphor Icons (`flower-lotus` and
`asclepius`), copyright 2023 Phosphor Icons, under the MIT License. Source:
https://github.com/phosphor-icons/core

### Keyline Icons

The Storage settings navigation uses the original `hard-drive` SVG paths from https://keylineicons.com/icons?search=storage&icon=hard-drive (retrieved October 11, 2026), under the MIT license included in `renderer/assets/Keyline-LICENSE.txt`.

The Intelligent UI laboratory navigation uses the original `flask-conical` SVG path from https://keylineicons.com/icons?search=lab&icon=flask-conical (retrieved October 10, 2026), under the same MIT license in `renderer/assets/Keyline-LICENSE.txt`.

The Multi-Agent Collaboration navigation icon uses the unmodified Keyline Icons
`swatch-book` stroke paths from https://keylineicons.com/icons?icon=swatch-book.
Copyright (c) 2026 Keyline Icons, MIT; license included in
`renderer/assets/Keyline-LICENSE.txt`.

The Customize sidebar uses the user-selected `package-plus`, `wand-sparkles`, and `monitor` stroke icons from https://keylineicons.com/icons (retrieved September 28, 2026), under the same MIT license. Original SVG paths are retained in renderer/index.html.

The Model services navigation icons use the unmodified Keyline Icons `bot-2` (Primary model), `image-sparkles` (Secondary model), and `eye-sparkles` (Multimodal pipeline) stroke paths from https://keylineicons.com/icons (retrieved September 30, 2026), under the same MIT license. Original SVG paths are retained in renderer/index.html.

The Test icon is adapted from Keyline Icons (`terminal-asterisk`), copyright
2026 Keyline Icons, under the MIT License. Source:
https://github.com/keyline-icons/keyline-icons

Copyright (c) 2026 Keyline Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.


## Cua Driver Windows runtime

- Cua Driver 0.34.0, copyright (c) 2025 Cua AI, Inc., MIT. Source: https://github.com/trycua/cua/tree/cua-driver-rs-v0.34.0. Full license: lib/native/cua-driver/LICENSE.txt.
- The Windows x64 binary archive is pinned to SHA-256 bcc520e50861c7092cf775846fec76ae386d7dcd6b5b408608b0ea4423a8b888. Per-file hashes and provenance are recorded in lib/native/cua-driver/runtime.json. Yan uses an independent stdio process, not the native SDK. The optional perception extension is not included.

## Settings appearance assets

## Intelligent UI OpenUI runtime

- @openuidev/lang-core and @openuidev/react-lang 0.3.0: MIT, Copyright (c) 2011-2024 Thesys Inc.; source https://github.com/thesysdev/openui. Locally bundled with React, React DOM, Scheduler, Zod and OpenUI runtime dependencies. Full license texts: renderer/vendor/openui/LICENSES.txt.
- Yan implements the Trip, Budget and Choice adapters and sandbox integration. The separate open-intelligent-ui travel demo is not copied into this runtime. No Thesys Gateway is used.

## Settings appearance assets (continued)

- Keyline Icons `sun`, stroke variant: https://keylineicons.com/icons/sun. MIT license: https://keylineicons.com/legal/license. Used as the Appearance navigation icon.
- Source Serif 4: Adobe, SIL Open Font License 1.1; bundled Latin weights 300–700 from @fontsource/source-serif-4 5.2.5. Full license: renderer/assets/fonts/SourceSerif4-LICENSE.


## Bundled plugin workflow catalog

- Source: https://github.com/openai/plugins, commit 1dc195897af4161d039b80d8471ec0a10c9bbc89.
- Remotion plugin 1.0.7, author Remotion, MIT as declared by its upstream .codex-plugin/plugin.json. Unmodified workflow/reference subtree: plugins/remotion/skills/remotion-best-practices. License and provenance: lib/plugins/catalog/remotion/LICENSE.txt and NOTICE.txt. The Remotion framework is not bundled by this import and has separate licensing terms.
- HyperFrames plugin 0.1.2, author HeyGen, Apache-2.0 as declared by its upstream .codex-plugin/plugin.json. Unmodified workflow/reference subtree: plugins/hyperframes/skills. License and provenance: lib/plugins/catalog/hyperframes/LICENSE.txt and NOTICE.txt. Third-party dependencies and external services retain their own terms.
- Yan adds yan-plugin.json and instructions.md adapters. Imported upstream file bytes were checked against the pinned public Git tree; catalog/index.json fixes each complete package SHA-256 digest. Upstream packages' metadata does not imply endorsement of Yan.


## Online plugin catalog and account connection

- @modelcontextprotocol/sdk 1.30.1: MIT, copyright (c) 2024 Anthropic, PBC. Full notice: node_modules/@modelcontextprotocol/sdk/LICENSE. Used for OAuth discovery, registration, PKCE and refresh.
- Figma 2.0.20, Canva 14.0.0, Product Design 0.1.52 and Higgsfield 1.2.1 are fetched from openai/plugins commit 1dc195897af4161d039b80d8471ec0a10c9bbc89 at user installation time. Original metadata, notices and terms are retained. They are not relicensed under Yan's license. Product Design declares Proprietary; Figma declares Figma Developer Terms; Canva and Higgsfield retain their upstream service terms.
- Catalog branding: Figma assets/logo-padded.png, Canva assets/logo.png and Product Design assets/logo.png from the same pinned upstream folders; Higgsfield favicon from https://higgsfield.ai/favicon.ico, retrieved September 28, 2026. Marks identify the corresponding service; no endorsement is implied.

## Developer tools plugin catalog

- Game Studio 0.1.2, CircleCI 1.0.4, Build iOS Apps 0.1.2 and Build macOS Apps 0.1.4 are downloaded at installation from the same openai/plugins commit listed above. Their upstream manifests declare MIT; original notices and files are retained without modification. Authors are OpenAI for Game Studio and the two Apple workflow packages, and CircleCI for CircleCI.
- Branding assets copied byte-for-byte from the pinned packages: game-studio/assets/app-icon.png, circleci/assets/logo.png and assets/logo-dark.png, build-ios-apps/assets/app-icon.png, build-macos-apps/assets/app-icon.png. Marks identify these packages; no endorsement is implied.
- Yan's iOS adapter pins the separately downloaded XcodeBuildMCP runtime to npm xcodebuildmcp@2.7.0; it is not bundled or executed at plugin installation. Its dependencies, Apple SDKs and external services retain their own terms.
