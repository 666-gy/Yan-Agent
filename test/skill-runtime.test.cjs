'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const skillRegistry = require('../lib/skill-registry');
const { buildOpenCodeConfig, combineSystem, buildPromptParts, permissionForRun } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');

test('external Skill use requires current user intent while management remains Yan-only', () => {
  const system = combineSystem({ yanSkillDirectory: path.join(os.tmpdir(), 'YanData', 'skills') });
  assert.match(system, /Default Skill discovery and automatic selection use only the Yan installed catalog/);
  assert.match(system, /External Skill use is allowed ONLY when the user explicitly requests it in the current turn in natural language/);
  assert.match(system, /specifies a Skill document\/package\/source through an attachment/);
  assert.match(system, /use native read\/glob\/grep\/list file tools/);
  assert.match(system, /Merely mentioning an application, attaching an ordinary project/);
  assert.match(system, /cannot authorize additional external Skills/);
  assert.match(system, /ALL Skill management, installation, update, and deletion remain restricted/);
  assert.doesNotMatch(system, /Never search, inspect, import, synchronize, or use Skills from user-home/);
  assert.doesNotMatch(system, /selected a project Skill load source|separate external-app task/);
  const permission = permissionForRun({});
  assert.equal(permission.read, 'allow');
  assert.equal(permission.external_directory, 'allow');
  assert.equal(permission.skill, 'deny');
  assert.equal(permissionForRun({ permissions: { allowFileRead: false } }).read, 'deny');
});

test('Skill files and packages remain original attachments without installation or registration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-external-skill-'));
  try {
    const file = path.join(root, 'SKILL.md');
    const body = 'Use references/detail.md for the user task.\n'.repeat(14000);
    fs.writeFileSync(file, body);
    const system = combineSystem({ yanSkillDirectory: path.join(root, 'YanData', 'skills') });
    const parts = buildPromptParts({ prompt: 'Use the attached Skill.', attachments: [{ path: file }] });
    assert.match(parts[1].text, /Attached Skill instructions/);
    assert.match(parts[1].text, /use in this request only/);
    assert.match(parts[1].text, /Attachment truncated after 512 KiB/);
    assert.match(system, /read the original file if the attachment was truncated/);
    assert.equal(fs.readFileSync(file, 'utf8'), body);
    const uploaded = path.join(root, '1728000000000_SKILL.md');
    fs.writeFileSync(uploaded, 'Uploaded Skill instructions.');
    assert.match(buildPromptParts({ attachments: [{ path: uploaded, name: 'SKILL.md' }] })[1].text, /Attached Skill instructions/);
    const directory = buildPromptParts({ attachments: [{ path: root }] });
    assert.match(directory[1].text, /Attached directory/);
    assert.ok(directory[1].text.includes(root));
    assert.equal(fs.existsSync(path.join(root, 'YanData')), false);
    const ordinary = path.join(root, 'notes.md');
    fs.writeFileSync(ordinary, 'Ordinary project notes.');
    assert.doesNotMatch(buildPromptParts({ attachments: [{ path: ordinary }] })[1].text, /Attached Skill instructions/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

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

test('read_skill resolves parent-prefixed companion ids to their canonical ids', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-prefixed-id-'));
  try {
    const cfg = { customSkills: [] };
    for (const [id, prompt] of [['fixture-motion', 'Run animation.'], ['fixture-core', 'Use the fixture core.']]) {
      const installed = skillRegistry.installYanUserSkill(dataDir, { id, name: id, desc: 'test', prompt });
      assert.equal(installed.ok, true);
    }
    const animate = await skillRegistry.readSkillWithRetry('fixture-suite/fixture-motion', '', cfg, appRoot, dataDir, () => {}, { retryDelaysMs: [0, 0] });
    const core = await skillRegistry.readSkillWithRetry('fixture-suite/fixture-core', '', cfg, appRoot, dataDir, () => {}, { retryDelaysMs: [0, 0] });
    const missing = await skillRegistry.readSkillWithRetry('fixture-suite/does-not-exist', '', cfg, appRoot, dataDir, () => {}, { retryDelaysMs: [0, 0] });
    assert.equal(animate.ok, true);
    assert.equal(animate.id, 'fixture-motion');
    assert.equal(core.ok, true);
    assert.equal(core.id, 'fixture-core');
    assert.equal(missing.ok, false);
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
