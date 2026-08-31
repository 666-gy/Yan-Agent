'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const skillRegistry = require('../lib/skill-registry');
const { buildOpenCodeConfig, combineSystem } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');

test('Skill parser has one strict validation entry', () => {
  const parsed = skillRegistry.parseSkillDocument([
    '---',
    'name: demo-skill',
    'description: "A demo skill"',
    '---',
    '',
    'Do the demo.'
  ].join('\n'), { requireFrontmatter: true, requireName: true, requireDescription: true, requirePrompt: true });
  assert.equal(parsed.name, 'demo-skill');
  assert.equal(parsed.description, 'A demo skill');
  assert.equal(parsed.prompt, 'Do the demo.');
  assert.throws(() => skillRegistry.parseSkillDocument('just text', { requireFrontmatter: true }), /frontmatter/i);
});

test('readSkillWithRetry retries transient failures and stops at three attempts', async () => {
  let calls = 0;
  const result = await skillRegistry.readSkillWithRetry(
    'demo', '', {}, appRoot, os.tmpdir(), () => {},
    {
      maxAttempts: 3,
      retryDelaysMs: [0, 0],
      readSkillImpl: () => {
        calls += 1;
        return { ok: false, retryable: true, error: `transient-${calls}` };
      }
    }
  );
  assert.equal(calls, 3);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.attempts, 3);
  assert.match(result.skipNotice, /3 次/);
});

test('readSkillWithRetry does not retry permanent failures', async () => {
  let calls = 0;
  const result = await skillRegistry.readSkillWithRetry(
    'missing', '', {}, appRoot, os.tmpdir(), () => {},
    {
      maxAttempts: 3,
      retryDelaysMs: [0, 0],
      readSkillImpl: () => {
        calls += 1;
        return { ok: false, retryable: false, error: 'not installed' };
      }
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.skipped, true);
  assert.equal(result.attempts, 1);
});

test('a malformed installed Skill reaches the three-attempt parse threshold', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-broken-'));
  try {
    const directory = path.join(dataDir, 'skills', 'broken-skill');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '.yan-skill.json'), JSON.stringify({
      schema: 1,
      id: 'broken-skill',
      name: 'Broken Skill'
    }), 'utf8');
    fs.writeFileSync(path.join(directory, 'SKILL.md'), [
      '---',
      'name: broken-skill',
      'description: broken frontmatter'
    ].join('\n'), 'utf8');
    const result = await skillRegistry.readSkillWithRetry(
      'broken-skill', '', { customSkills: [] }, appRoot, dataDir, () => {},
      { maxAttempts: 3, retryDelaysMs: [0, 0] }
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SKILL_PARSE_FAILED');
    assert.equal(result.skipped, true);
    assert.equal(result.attempts, 3);
    assert.match(result.error, /frontmatter 未闭合/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('OpenCode does not scan or expose native Skills', () => {
  const config = buildOpenCodeConfig({
    providerId: 'qwen',
    modelId: 'qwen3.5-plus',
    skillPaths: [path.join(appRoot, 'lib', 'skills')]
  });
  assert.deepEqual(config.skills, { paths: [] });
  const system = combineSystem({
    providerId: 'qwen',
    modelId: 'qwen3.5-plus',
    yanSkillDirectory: path.join(os.tmpdir(), 'yan-skills'),
    availableSkills: [{ id: 'demo', name: 'Demo', description: 'demo' }]
  });
  assert.match(system, /Yan Skills read_skill/);
  assert.match(system, /Yan installed Skill catalog/);
  assert.match(system, /demo \| Demo \| demo/);
  assert.match(system, /fetch every chunkPlan entry with read_skill_resource in one parallel tool batch via read_skill_resources/);
  assert.match(system, /reconstruct the exact instruction document in chunk_index order/);
  assert.match(system, /input_tokens_per_second|high-throughput/iu);
  assert.match(system, /Use native write for a complete new text file/);
  assert.match(system, /Do not use apply_patch Add File or a Bash here-string/);
  assert.doesNotMatch(system, /prefer (?:a )?Bash here-string/iu);
  assert.doesNotMatch(system, /native skill tool/);
});

test('skill store read remains available after retry helpers are loaded', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-runtime-'));
  try {
    const cfg = { customSkills: [] };
    const installed = skillRegistry.installYanUserSkill(dataDir, {
      id: 'runtime-demo', name: 'Runtime Demo', desc: 'demo', prompt: 'Run demo.'
    });
    assert.equal(installed.ok, true);
    const resolved = await skillRegistry.readSkillWithRetry(
      'runtime-demo', '', cfg, appRoot, dataDir, () => {}, { retryDelaysMs: [0, 0] }
    );
    assert.equal(resolved.ok, true);
    assert.match(resolved.prompt, /^Run demo\./);
    assert.equal(resolved.attempts, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('renderer-facing Skill catalogs never carry instruction bodies', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-metadata-'));
  try {
    const cfg = { customSkills: [] };
    skillRegistry.installYanUserSkill(dataDir, {
      id: 'metadata-demo', name: 'Metadata Demo', desc: 'demo', prompt: 'Private instruction body.'
    });
    const list = skillRegistry.getMergedSkillsForList(cfg, appRoot, dataDir);
    const catalog = skillRegistry.getAllSkillsForCatalog(cfg, appRoot, dataDir);
    const listed = list.find(skill => skill.id === 'metadata-demo');
    const cataloged = catalog.find(skill => skill.id === 'metadata-demo');
    assert.ok(listed);
    assert.ok(cataloged);
    assert.equal(Object.hasOwn(listed, 'prompt'), false);
    assert.equal(Object.hasOwn(cataloged, 'prompt'), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
