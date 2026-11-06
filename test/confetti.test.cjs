'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fireConfetti } = require('../lib/confetti');
const { registerBridges } = require('../lib/main/bridges');
const { normalizeGeneralPreferences } = require('../lib/general-preferences');
test('confetti preference persists and blocks dispatch', async () => {
  assert.equal(normalizeGeneralPreferences().confettiEnabled, true);
  assert.equal(normalizeGeneralPreferences({ confettiEnabled: false }).confettiEnabled, false);
  const result = await fireConfetti({ config: { general: { confettiEnabled: false } } });
  assert.equal(result.fired, false);
  assert.equal(result.reason, 'disabled');
});
test('confetti validates input and reports actual renderer outcome', async () => {
  let code;
  const window = { isDestroyed: () => false, webContents: { executeJavaScript: async value => { code = value; return { fired: false, reason: 'reduced_motion' }; } } };
  assert.equal((await fireConfetti({ window, ready: true, params: { emojis: [null] } })).reason, 'invalid_emojis');
  assert.equal(code, undefined);
  assert.equal((await fireConfetti({ window, ready: true, params: { emojis: ['🎉'] } })).reason, 'reduced_motion');
  assert.match(code, /🎉/);
  assert.equal((await fireConfetti({ ready: false })).fired, false);
});
test('session bridge consumes confetti call once and honors current setting', async () => {
  let enabled = true, calls = 0;
  const bridges = registerBridges({ app: new EventEmitter() }, {
    browserHelpers: {}, sessionAgentToolClaims: new Map(), openCodeActiveRuns: new Map([['run-a', {}]]),
    configStore: { loadConfig: () => ({ general: { confettiEnabled: enabled } }) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { executeJavaScript: async () => { calls++; return { ok: true, fired: true }; } } }),
    isMainRendererReady: () => true
  });
  const claim = id => bridges.trackSessionAgentToolClaim('run-a', { type: 'session.next.tool.called', data: { callID: id, tool: 'yan_session_fire_confetti', input: {} } });
  claim('one');
  assert.equal((await bridges.dispatchSessionAgentCommand('fire_confetti')).fired, true);
  assert.equal((await bridges.dispatchSessionAgentCommand('fire_confetti')).reason, 'missing_tool_claim');
  enabled = false;
  claim('two');
  assert.equal((await bridges.dispatchSessionAgentCommand('fire_confetti')).reason, 'disabled');
  assert.equal(calls, 1);
});
