'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createVoiceInput } = require('../lib/voice-input');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'output/voice-smoke');
let config = {};
const service = createVoiceInput({ appRoot: root, dataDir, loadConfig: () => config, saveConfig: value => { config = value; },
  onChanged: value => {
    const p = value.preparation;
    if (p.phase !== 'downloading') console.log('Voice:', p.phase, p.step || '', p.message || '');
  } });
(async () => {
  try {
    await service.configure({ enabled: true });
    await waitUntil(() => ['unprepared', 'standby', 'failed'].includes(service.snapshot().preparation.phase));
    await service.prepare();
    await waitUntil(() => ['ready', 'failed', 'cancelled'].includes(service.snapshot().preparation.phase), 600000);
    assert.equal(service.snapshot().preparation.phase, 'ready', JSON.stringify(service.snapshot()));
    const recording = fs.readFileSync(path.join(root, 'output/voice-smoke/zh.wav'));
    await service.streamStart({ requestId: 'real-stream-smoke' });
    const partials = [];
    for (let offset = 44; offset < recording.length; offset += 3200) {
      const end = Math.min(recording.length, offset + 3200);
      const samples = new Float32Array((end - offset) / 2);
      for (let index = 0; index < samples.length; index++) samples[index] = recording.readInt16LE(offset + index * 2) / 32768;
      const partial = await service.streamChunk({ requestId: 'real-stream-smoke', pcm: new Uint8Array(samples.buffer) });
      if (partial.text) partials.push(partial.text);
    }
    const streamed = await service.streamFinish({ requestId: 'real-stream-smoke' });
    assert.ok(partials.length > 0, 'the online recognizer emits text before recording stops');
    assert.match(streamed.text, /早上.*下午/);
    console.log('Real streaming transcript:', streamed.text);
    const sample = process.env.YAN_VOICE_TEST_WAV;
    if (sample) {
      const result = await service.transcribe({ requestId: 'real-model-smoke', audio: fs.readFileSync(sample) });
      console.log('Real transcript:', result.text); assert.ok(result.text.trim());
    }
    await service.configure({ enabled: false });
    assert.equal(service.snapshot().installed, true);
    await service.configure({ enabled: true });
    await waitUntil(() => ['standby', 'failed'].includes(service.snapshot().preparation.phase));
    assert.equal(service.snapshot().preparation.phase, 'standby');
    const coldStates = [];
    const cold = createVoiceInput({ appRoot: root, dataDir, loadConfig: () => config, saveConfig: value => { config = value; },
      onChanged: value => coldStates.push(value.ready) });
    try {
      await cold.status();
      await waitUntil(() => cold.snapshot().ready);
      coldStates.length = 0;
      await cold.streamStart({ requestId: 'cold-stream-smoke' });
      assert.equal(cold.snapshot().ready, true, 'cached recognizer load keeps microphone ready');
      assert.equal(coldStates.every(Boolean), true, 'cached recognizer load never hides microphone');
      cold.cancel('cold-stream-smoke');
    } finally { await cold.dispose(); }
    console.log('PASS official assets, SHA-256 validation, native model load and cache reuse.');
  } finally { await service.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
async function waitUntil(predicate, timeout = 120000) {
  const started = Date.now(); let reported = 0;
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('Voice smoke timed out');
    if (Date.now() - reported > 10000) { const p = service.snapshot().preparation; console.log(p.phase, p.resource || '', p.completedBytes || '', p.totalBytes || ''); reported = Date.now(); }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
