'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { shellEnvironment } = require('../lib/shell-network');
test('system proxy reaches shell clients and Node while localhost bypasses it', () => {
  const env = shellEnvironment({ NO_PROXY: 'internal.test' }, () => 'http://127.0.0.1:7897');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  for (const host of ['internal.test', '127.0.0.1', 'localhost', '::1']) assert(env.NO_PROXY.split(',').includes(host));
  const explicit = shellEnvironment({ https_proxy: 'http://other:99' }, () => { throw Error('must not override'); });
  assert.equal(explicit.https_proxy, 'http://other:99');
  assert.equal(shellEnvironment({}, () => '').NODE_USE_ENV_PROXY, undefined);
});

