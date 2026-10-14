# DeepSeek Harness Voice Input

Source: https://github.com/deepseek-ai/deepseek-harness
Commit: 639ed015397290b3745d163aafe02ffee4aa3f84 (2026-09-29).
License: MIT, retained in LICENSE.

Unmodified upstream sources:
- src/: packages/experimental/speech-to-text-sensevoice/src (provider lifecycle,
  verified asset downloads, native inference and authenticated worker transport).
- speech/wave.ts: packages/experimental/speech-to-text/src/wave.ts.
- client/audio.ts: packages/experimental/client-ui-voice-input/src/client/audio.ts.
- runtime/assets.json: speech-to-text-sensevoice/runtime/assets.json.

Build: npm run bundle:voice. The build aliases the upstream WAV validator to
the vendored source, bundles utility dependencies, and retains sherpa-onnx-node
as an external native dependency. lib/provider.mjs exports SenseVoiceWorker;
lib/worker.js is its private Electron Node-mode process. The browser recording
module is emitted to renderer/vendor/dsh-voice/audio.js.

Yan supplies a subprocess adapter and settings/IPC/composer integration. Model
URLs, revisions, hashes, download fallback, cancellation and inference remain
owned by the upstream implementation. Model assets are downloaded only after
an explicit user action and are not part of the application bundle.

SenseVoiceSmall weights retain the FunASR Model Open Source License Agreement
(version 1.1), linked by the original FunAudioLLM/SenseVoiceSmall model card.
The agreement is retained in licenses/SenseVoice-MODEL_LICENSE, from FunASR
commit 58830eca4012644aac0c3218c3ccc7d98f003fda. The SenseVoice-LICENSE file
applies to upstream source code, not the weights. SenseVoiceSmall is authored
by FunAudioLLM/FunASR (Alibaba Group); the pinned ONNX conversion is by
csukuangfj/sherpa-onnx. Silero VAD retains its MIT license.
