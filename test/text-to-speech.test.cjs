'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const {
  createTextToSpeech,
  normalizeVoice,
  normalizeRate,
  rateToProsody,
  DEFAULT_VOICE,
  MAX_TEXT_LENGTH
} = require('../lib/text-to-speech');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-tts-'));
}

function createFakeClient({ calls = [], payload = Buffer.from('fake-mp3'), mode = 'ok' } = {}) {
  const streams = new Set();
  return {
    async setMetadata(voice, format) {
      calls.push({ type: 'metadata', voice, format });
    },
    toStream(text, options) {
      calls.push({ type: 'synthesize', text, options });
      const audioStream = new PassThrough();
      streams.add(audioStream);
      audioStream.once('close', () => streams.delete(audioStream));
      if (mode === 'ok') process.nextTick(() => audioStream.end(payload));
      if (mode === 'fail') process.nextTick(() => audioStream.destroy(new Error('edge down')));
      return { audioStream, metadataStream: null };
    },
    async getVoices() {
      return [{ ShortName: 'zh-CN-XiaoxiaoNeural', Locale: 'zh-CN', Gender: 'Female' }];
    },
    close() {
      for (const stream of streams) stream.destroy(new Error('closed before synthesis completed'));
    }
  };
}

function listFiles(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

async function waitFor(check, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

test('synthesizes audio once and serves the second request from cache', async () => {
  const dir = makeTmpDir();
  const calls = [];
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({ calls })
  });
  const first = await service.synthesize({ text: '你好，世界。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0 });
  assert.equal(first.cached, false);
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'fake-mp3');
  assert.equal(calls.filter(call => call.type === 'synthesize').length, 1);
  const second = await service.synthesize({ text: '你好，世界。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0 });
  assert.equal(second.cached, true);
  assert.equal(second.path, first.path);
  assert.equal(calls.filter(call => call.type === 'synthesize').length, 1);
});

test('voice and rate changes create distinct cache entries', async () => {
  const dir = makeTmpDir();
  const calls = [];
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({ calls })
  });
  const base = await service.synthesize({ text: '同一句话。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0 });
  const faster = await service.synthesize({ text: '同一句话。', voice: 'zh-CN-XiaoxiaoNeural', rate: 30 });
  const otherVoice = await service.synthesize({ text: '同一句话。', voice: 'zh-CN-YunxiNeural', rate: 0 });
  assert.notEqual(base.path, faster.path);
  assert.notEqual(base.path, otherVoice.path);
  const synthesizeCalls = calls.filter(call => call.type === 'synthesize');
  assert.equal(synthesizeCalls.length, 3);
  assert.equal(synthesizeCalls[1].options.rate, '+30%');
});

test('normalization clamps rate and rejects malformed voices', () => {
  assert.equal(normalizeRate(999), 100);
  assert.equal(normalizeRate(-999), -50);
  assert.equal(normalizeRate('+20'), 20);
  assert.equal(normalizeRate('nope'), 0);
  assert.equal(rateToProsody(0), '+0%');
  assert.equal(rateToProsody(-20), '-20%');
  assert.equal(normalizeVoice('zh-CN-YunxiNeural'), 'zh-CN-YunxiNeural');
  assert.equal(normalizeVoice('bad voice!'), DEFAULT_VOICE);
  assert.equal(normalizeVoice(''), DEFAULT_VOICE);
});

test('rejects empty and oversized text before touching the engine', async () => {
  const dir = makeTmpDir();
  const calls = [];
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({ calls })
  });
  await assert.rejects(() => service.synthesize({ text: '   ' }), /没有可朗读的文本/);
  await assert.rejects(
    () => service.synthesize({ text: '朗'.repeat(MAX_TEXT_LENGTH + 1) }),
    /朗读文本过长/
  );
  assert.equal(calls.length, 0);
});

test('surfaces engine failure and leaves no partial files behind', async () => {
  const dir = makeTmpDir();
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({ mode: 'fail' })
  });
  await assert.rejects(() => service.synthesize({ text: '会失败。' }), /edge down/);
  assert.deepEqual(listFiles(dir), []);
});

test('cancel aborts an in-flight synthesis and cleans its partial file', async () => {
  const dir = makeTmpDir();
  const calls = [];
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({ calls, mode: 'hang' })
  });
  const pending = service.synthesize({ text: '取消我。', requestId: 'req-1' });
  assert.ok(await waitFor(() => calls.some(call => call.type === 'synthesize')));
  assert.equal(service.cancel('req-1'), true);
  await assert.rejects(() => pending, /已取消/);
  assert.equal(service.cancel('req-1'), false);
  assert.equal(service.activeCount, 0);
  assert.deepEqual(listFiles(dir), []);
});

test('prunes the cache down to the configured ceiling', async () => {
  const dir = makeTmpDir();
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({}),
    maxCacheFiles: 16
  });
  for (let index = 0; index < 20; index += 1) {
    await service.synthesize({ text: `第 ${index} 句缓存内容。`, rate: 0 });
  }
  await service.pruneCache();
  const files = listFiles(dir).filter(name => name.endsWith('.mp3'));
  assert.ok(files.length <= 16, `expected <= 16 cached files, got ${files.length}`);
  assert.ok(files.length > 0);
});

test('listVoices caches the engine response for repeated calls', async () => {
  const dir = makeTmpDir();
  const service = createTextToSpeech({
    cacheDir: dir,
    clientFactory: () => createFakeClient({})
  });
  const first = await service.listVoices();
  const second = await service.listVoices();
  assert.equal(first.length, 1);
  assert.equal(first, second);
});
