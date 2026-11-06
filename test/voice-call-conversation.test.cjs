const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('speech endpoint sends one utterance, renders body and plays audio; mute releases capture', async () => {
 const nodes = new Map(), events = {}, captions = [], calls = [], timers = new Map();
 let transcriptListener;
 let now = 0, sequence = 0, disposed = 0, played = 0, samples = 0;
 const node = id => { if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, addEventListener(event, fn) { this[event] = fn; } }); return nodes.get(id); };
 const window = { YanCallMicIcons: { mic: 'on', 'mic-off': 'off' }, YanCallTranscript: x => captions.push(x), addEventListener: (name, fn) => events[name] = fn,
  voiceCall: { onTranscript(fn) { transcriptListener = fn; }, action: async () => ({ ok: true }), media: async (method, payload) => {
   calls.push(method);
   const values = { status: { maxDurationSeconds: 60 }, streamChunk: { text: '用户' }, transcribe: { text: '用户说完了' }, synthesize: { audio: [1,2], mime: 'audio/mpeg' } };
   return { ok: true, value: values[method] || {} };
  }, utterance: async text => { assert.equal(text, '用户说完了'); transcriptListener?.({ role: 'assistant', text: 'Yan 正文', final: false }); await new Promise(setImmediate); assert.equal(played, 0, 'speech waits for complete final task result'); return { id: 'reply', ok: true, text: 'Yan 正文' }; } }
 };
 const context = { window, document: { body: { classList: { remove() {} } }, getElementById: node, querySelector: node }, crypto: { randomUUID: () => String(++sequence) }, performance: { now: () => now },
  YanVoiceAudio: { Recording: class { async start() {} amplitude() { return ++samples <= 2 ? .1 : 0; } async readPcmChunk() { return new Uint8Array(4); } async stop() { disposed++; return new Uint8Array(44); } async dispose() { disposed++; } } },
  setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  Uint8Array, Blob, URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
  Audio: class { async play() { this.onplaying?.(); assert.equal(node('callInterrupt').textContent, '打断妍宝'); node('callMic').click(); assert.equal(node('callInterrupt').textContent, '打断妍宝'); node('callMic').click(); played++; queueMicrotask(() => this.onended()); } pause() {} }
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/voice-call-conversation.js'), 'utf8'), context);
 await new Promise(setImmediate);
 assert.ok(['畅所欲言', '正在听…'].includes(node('callStatus').textContent));
 assert.equal(node('callTitle').hidden, false);
 for (let i = 0; i < 30 && !played; i++) { await new Promise(setImmediate); now += 100; const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }
 await new Promise(setImmediate);
 assert.equal(played, 1); assert.equal(calls.filter(x => x === 'transcribe').length, 1);
 assert.ok(captions.some(x => x.role === 'user' && x.final && x.text === '用户说完了'));
 assert.ok(captions.some(x => x.role === 'assistant' && x.final && x.text === 'Yan 正文'));
 node('callMic').click(); assert.equal(node('callMic').innerHTML, 'off');
 assert.equal(node('callStatus').textContent, '你已关闭麦克风'); assert.equal(node('callTitle').hidden, true);
 events.beforeunload(); assert.ok(disposed > 0); assert.equal(timers.size, 0);
});
