'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'lib/vendor/dsh-voice');
const shared = {
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['sherpa-onnx-node'], legalComments: 'inline',
  alias: { '@deepseek-ai/dsh-experimental-speech-to-text/wave': path.join(vendor, 'speech/wave.ts') }
};
buildSync({ ...shared, stdin: { contents: "export { SenseVoiceWorker } from './src/recognizer.ts'; export { validateWave } from './speech/wave.ts'; export { inspectRuntime, downloadAsset } from './src/runtime.ts';", resolveDir: vendor, loader: 'ts' }, outfile: path.join(vendor, 'lib/provider.mjs') });
buildSync({ ...shared, entryPoints: [path.join(vendor, 'src/worker.ts')], outfile: path.join(vendor, 'lib/worker.js') });
buildSync({ entryPoints: [path.join(vendor, 'client/audio.ts')], outfile: path.join(root, 'renderer/vendor/dsh-voice/audio.js'),
  bundle: true, platform: 'browser', format: 'iife', globalName: 'YanVoiceAudio', target: 'chrome140', legalComments: 'inline' });
fs.copyFileSync(path.join(vendor, 'client/pcm-worklet.js'), path.join(root, 'renderer/vendor/dsh-voice/pcm-worklet.js'));
console.log('Built official DSH voice provider, worker and browser recording module.');
