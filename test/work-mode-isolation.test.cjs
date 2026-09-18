'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { agiEnabled, isolateWorkMode, sessionModeMatches } = require('../lib/work-mode-isolation');
const { combineSystem, combineTurnPrompt, permissionForRun } = require('../lib/opencode-sidecar');
const { LongTermMemoryStore } = require('../lib/long-term-memory');

const polluted = { reasoningSidepath: { required: true }, longHorizonContext: 'LONG_MARKER',
  experienceEdgeContext: 'EDGE_MARKER', harnessContext: 'HARNESS_MARKER', escalation: { steps: 2 },
  behaviorPolicies: [{ id: 'p', kind: 'prompt', content: 'POLICY_MARKER', metadata: { status: 'active' } }] };

test('normal/plan/goal never inject AGI even with stale request fields', () => {
  for (const workMode of ['normal', 'plan', 'goal']) {
    const request = { ...polluted, workMode, prompt: 'fix code', accessMode: 'full' };
    const clean = isolateWorkMode(request);
    assert.equal(agiEnabled(clean), false);
    assert.equal(clean.reasoningSidepath, undefined);
    assert.equal(clean.escalation, undefined);
    const text = combineSystem(request) + combineTurnPrompt(request, request.prompt, false);
    assert.doesNotMatch(text, /LONG_MARKER|EDGE_MARKER|HARNESS_MARKER|POLICY_MARKER|AGI reasoning side-path|Yan 系统词表/);
    assert.equal(permissionForRun(request).write, workMode === 'plan' ? 'deny' : 'allow');
  }
});
test('AGI retains its gate and context; evolution retains only Harness', () => {
  const agi = { ...polluted, workMode: 'agi', accessMode: 'full' };
  const text = combineTurnPrompt(agi, 'fix code', false);
  assert.match(text, /LONG_MARKER/);
  assert.match(text, /EDGE_MARKER/);
  assert.match(text, /HARNESS_MARKER/);
  assert.match(text, /AGI reasoning side-path/);
  assert.equal(permissionForRun(agi).write, 'ask');
  const evolution = combineTurnPrompt({ ...polluted, workMode: 'evolution' }, 'fix code', false);
  assert.match(evolution, /HARNESS_MARKER/);
  assert.doesNotMatch(evolution, /LONG_MARKER|EDGE_MARKER|AGI reasoning side-path/);
  assert.equal(agiEnabled({ workMode: 'agi', utility: true }), false);
  assert.equal(agiEnabled({ workMode: 'agi', skillOnly: true }), false);
});
test('mode changes and legacy sessions cannot reuse injected kernel history', () => {
  const session = { metadata: { yanWorkMode: 'agi', yanModeIsolation: 1 } };
  assert.equal(sessionModeMatches(session, { workMode: 'normal' }), false);
  assert.equal(sessionModeMatches(session, { workMode: 'agi' }), true);
  assert.equal(sessionModeMatches({ metadata: { yanWorkMode: 'normal' } }, { workMode: 'normal' }), false);
  const text = combineTurnPrompt({ workMode: 'normal', history: [
    { role: 'assistant', content: 'Visible answer<yan-reasoning-sidepath>SECRET_BRIEF</yan-reasoning-sidepath>' },
    { role: 'user', content: '<yan-turn-context>OLD_SYSTEM</yan-turn-context>Continue work' }
  ] }, 'Continue', true);
  assert.match(text, /Visible answer/);
  assert.match(text, /Continue work/);
  assert.doesNotMatch(text, /SECRET_BRIEF|OLD_SYSTEM/);
});
test('normal retrieval excludes AGI-derived memory without deleting regular memory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mode-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LongTermMemoryStore({ globalPath: path.join(root, 'memory.json') });
  store.upsert({ key: 'user-language', type: 'preference', scope: 'global', content: '用户偏好中文报告。', confidence: 0.9 });
  store.upsert({ key: 'agi-preference', type: 'preference', scope: 'global', content: '用户偏好先比较多个实验候选。', confidence: 0.9 }, { sourceKind: 'agi_memory_consolidation' });
  const normal = store.query({ query: '用户偏好', excludeSourceKinds: ['agi_memory_consolidation'] });
  assert.match(normal.context, /中文报告/);
  assert.doesNotMatch(normal.context, /实验候选/);
  assert.match(store.query({ query: '用户偏好' }).context, /实验候选/);
});
