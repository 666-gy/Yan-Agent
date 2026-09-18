'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { combineTurnPrompt } = require('../lib/opencode-sidecar');

test('Self-Evolution is a distinct work mode; other modes keep the Build prompt', () => {
  const base = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', prompt: 'Do the work.' };
  const evolution = combineTurnPrompt({ ...base, workMode: 'evolution' }, base.prompt, false);
  assert.match(evolution, /Self-Evolution mode/);
  for (const workMode of ['normal', 'plan', 'goal']) {
    assert.doesNotMatch(combineTurnPrompt({ ...base, workMode }, base.prompt, false), /Self-Evolution mode/);
  }
  assert.match(combineTurnPrompt({ ...base, workMode: 'plan' }, base.prompt, false), /Plan mode/);
});

test('evolution work mode carries only the retrieved Harness context', () => {
  const base = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', prompt: 'hi', workMode: 'evolution' };
  const context = '- [记忆; global:db] 数据库迁移先备份，再执行迁移脚本。';
  const withContext = combineTurnPrompt({ ...base, harnessContext: context }, base.prompt, false);
  assert.match(withContext, /<yan-continual-harness>/);
  assert.match(withContext, /数据库迁移先备份/);
  const withoutContext = combineTurnPrompt(base, base.prompt, false);
  assert.doesNotMatch(withoutContext, /<yan-continual-harness>/);
});
