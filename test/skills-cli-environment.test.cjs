'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { officialSkillsCliEnvironment } = require('../lib/skills-cli-environment');

test('skills CLI receives the Windows proxy while its private HOME stays isolated', () => {
  const env = officialSkillsCliEnvironment({
    runtimeHome: 'C:/tmp/yan-cli-home',
    runtimeTemp: 'C:/tmp/yan-cli-temp',
    inherited: { NO_PROXY: 'internal.test' },
    readProxy: () => 'http://127.0.0.1:7897'
  });
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.HTTP_PROXY, env.HTTPS_PROXY);
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  for (const host of ['internal.test', '127.0.0.1', 'localhost', '::1']) {
    assert(env.NO_PROXY.split(',').includes(host), `NO_PROXY must include ${host}`);
  }
  assert.equal(env.HOME, 'C:/tmp/yan-cli-home');
  assert.equal(env.USERPROFILE, 'C:/tmp/yan-cli-home');
  assert.equal(env.XDG_CONFIG_HOME, path.join('C:/tmp/yan-cli-home', 'config'));
  assert.equal(env.XDG_DATA_HOME, path.join('C:/tmp/yan-cli-home', 'data'));
  assert.equal(env.XDG_CACHE_HOME, path.join('C:/tmp/yan-cli-home', 'cache'));
  assert.equal(env.TEMP, 'C:/tmp/yan-cli-temp');
  assert.equal(env.TMP, 'C:/tmp/yan-cli-temp');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
});

test('an explicit proxy wins over the system proxy', () => {
  const env = officialSkillsCliEnvironment({
    runtimeHome: 'C:/tmp/yan-cli-home',
    runtimeTemp: 'C:/tmp/yan-cli-temp',
    inherited: { https_proxy: 'http://other:99' },
    readProxy: () => { throw new Error('system proxy must not be read'); }
  });
  assert.equal(env.https_proxy, 'http://other:99');
  assert.equal(env.NO_PROXY.split(',').includes('localhost'), true);
});
