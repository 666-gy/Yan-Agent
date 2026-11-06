'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');
const { buildOpenCodeConfig, permissionRulesForRun } = require('../lib/kernel-policy');

test('global and every agent config use scalar doom_loop actions accepted by OpenCode', () => {
  for (const options of [{}, { workMode: 'plan' }, { enableSubagents: false },
    { sandboxMode: 'read-only' }, { sandboxMode: 'workspace-write' }]) {
    const config = buildOpenCodeConfig(options);
    assert.equal(config.permission.doom_loop, 'ask');
    for (const [name, agent] of Object.entries(config.agent)) {
      assert.ok(['ask', 'allow', 'deny'].includes(agent.permission.doom_loop),
        `agent.${name}.permission.doom_loop must be a scalar action`);
    }
    assert.equal(config.agent.build.permission.doom_loop, 'ask');
    assert.equal(config.agent.plan.permission.doom_loop, 'ask');
  }
});