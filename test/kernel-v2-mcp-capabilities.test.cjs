'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { deferredServers, deferredConfig, connectionToolAllowed, capabilities } = require('../lib/kernel-v2/mcp-capabilities');
const { permissions } = require('../lib/kernel-v2/config');

test('only enabled bundled entrypoints defer; external and disabled services retain their policy', () => {
  const builtin = { type: 'local', command: [process.execPath, path.resolve(__dirname, '../lib/yan-web-mcp.js')] };
  const config = { mcp: { servers: { yan_web: builtin, external: builtin,
    yan_plugin: { ...builtin, command: [process.execPath, 'different.js'] },
    yan_browser: { type: 'remote', url: 'https://example.invalid' } } } };
  assert.deepEqual(Object.keys(deferredServers(config)), ['yan_web']);
  assert.equal(deferredConfig(config).mcp.servers.yan_web.disabled, true);
  assert.equal(config.mcp.servers.yan_web.disabled, undefined, 'never mutate the input policy');
  assert.equal(deferredConfig(config).mcp.servers.external, builtin);
  assert.deepEqual(deferredServers({ mcp: { servers: { yan_web: { ...builtin, disabled: true } } } }), {});
  assert.equal(Object.keys(capabilities).length, 10);
});

test('connection entrypoints follow mode/custom tool whitelists and no-tools utilities stay denied', () => {
  assert.equal(connectionToolAllowed('yan_web_connect', id => id === 'yan_web_fetch'), true);
  assert.equal(connectionToolAllowed('yan_plugin_connect', id => id === 'yan_web_fetch'), false);
  const daily = require('../lib/daily-agent');
  assert.equal(daily.toolAllowed('yan_web_connect'), true);
  assert.equal(daily.toolAllowed('yan_session_connect'), true);
  assert.equal(daily.toolAllowed('yan_browser_connect'), false);
  assert.equal(daily.toolAllowed('yan_web_download_file'), false);
  assert.equal(require('../lib/creative-agent').toolAllowed('yan_skills_connect'), true);
  assert.equal(require('../lib/minimal-agent').toolAllowed('yan_skills_connect'), false);
  assert.equal(permissions({ utility: true, utilityKind: 'prompt-suggestion' }).findLast(r => r.action === 'yan_connect').effect, 'deny');
});
