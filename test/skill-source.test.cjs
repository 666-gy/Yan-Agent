'use strict';

// Project Skill load source: importing another Agent's Skill folder into one
// workspace as a junction or a copy, and the load precedence that follows.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const skillRegistry = require('../lib/skill-registry');
const skillSource = require('../lib/skill-source');

function writeSkill(directory, name, description, body = 'Do the thing.') {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    body,
    ''
  ].join('\n'), 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-source-'));
  const external = path.join(root, 'external-agent', 'skills');
  writeSkill(path.join(external, 'alpha'), 'alpha-skill', 'External alpha.');
  writeSkill(path.join(external, 'beta'), 'beta-skill', 'External beta.');
  fs.mkdirSync(path.join(external, 'not-a-skill'), { recursive: true });
  fs.writeFileSync(path.join(external, 'not-a-skill', 'README.md'), 'no skill here', 'utf8');
  const workspace = path.join(root, 'project');
  fs.mkdirSync(workspace, { recursive: true });
  const dataDir = path.join(root, 'YanData');
  fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
  return { root, external, workspace, dataDir };
}

function configFor(workspace, skillSourceConfig = { known: [], active: {} }) {
  return { workspace, customSkills: [], skillSource: skillSourceConfig };
}

function activeConfig(fx, mode = 'copy') {
  const id = skillSource.sourceIdForPath(fx.external);
  return configFor(fx.workspace, {
    known: [{ id, path: fx.external, name: 'skills', mode }],
    active: { [skillRegistry.workspaceSkillSourceKey(fx.workspace)]: id }
  });
}

test('scanSourceSkills reads only real SKILL.md packages', () => {
  const fx = makeFixture();
  try {
    const { root, skills } = skillSource.scanSourceSkills(fx.external);
    assert.equal(root, path.resolve(fx.external));
    assert.deepEqual(skills.map(skill => skill.id).sort(), ['alpha-skill', 'beta-skill']);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('copy import materializes a full copy and leaves the source folder alone', async () => {
  const fx = makeFixture();
  try {
    const applied = await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'copy'
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.entries.length, 2);
    for (const entry of applied.entries) {
      assert.ok(fs.existsSync(path.join(entry.target, 'SKILL.md')), `${entry.folder} copied`);
      assert.equal(fs.lstatSync(entry.target).isSymbolicLink(), false);
    }
    const projectRoot = skillRegistry.getProjectSkillDirectory(fx.workspace);
    assert.ok(fs.existsSync(path.join(projectRoot, '.yan-source.json')), 'manifest written');
    assert.ok(fs.existsSync(path.join(fx.external, 'alpha', 'SKILL.md')), 'source untouched');
    const described = skillSource.describeProjectSource(fx.workspace);
    assert.equal(described.source.mode, 'copy');
    assert.equal(described.entries.every(entry => entry.available), true);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('symlink import follows later changes in the source directory', async () => {
  const fx = makeFixture();
  try {
    const applied = await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'symlink'
    });
    const alpha = applied.entries.find(entry => entry.id === 'alpha-skill');
    assert.ok(alpha, 'alpha imported');
    assert.equal(fs.lstatSync(alpha.target).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(alpha.target), fs.realpathSync(path.join(fx.external, 'alpha')));
    writeSkill(path.join(fx.external, 'alpha'), 'alpha-skill', 'External alpha.', 'Updated body.');
    assert.match(fs.readFileSync(path.join(alpha.target, 'SKILL.md'), 'utf8'), /Updated body\./);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a legacy active project source cannot load external Skills or shadow Yan installs', async () => {
  const fx = makeFixture();
  try {
    writeSkill(path.join(fx.dataDir, 'skills', 'alpha-skill'), 'alpha-skill', 'User-installed alpha.');
    await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'copy'
    });
    const skills = skillRegistry.getInstalledSkills(activeConfig(fx), appRoot, fx.dataDir);
    const alpha = skills.find(skill => skill.id === 'alpha-skill');
    assert.notEqual(alpha.origin, 'project');
    assert.equal(alpha.desc, 'User-installed alpha.');
    assert.equal(skills.some(skill => skill.id === 'beta-skill'), false);
    assert.equal(skillRegistry.readSkill('beta-skill', '', activeConfig(fx), appRoot, fx.dataDir, () => {}).ok, false);
    assert.ok(fs.existsSync(path.join(fx.workspace, '.yanagent', 'skills', 'alpha-skill', 'SKILL.md')));
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('the official store stays the default and imported files survive the switch', async () => {
  const fx = makeFixture();
  try {
    await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'copy'
    });
    const skills = skillRegistry.getInstalledSkills(configFor(fx.workspace), appRoot, fx.dataDir);
    assert.equal(skills.some(skill => skill.origin === 'project'), false);
    const projectRoot = skillRegistry.getProjectSkillDirectory(fx.workspace);
    assert.ok(fs.existsSync(path.join(projectRoot, '.yan-source.json')), 'imported files are kept');
    assert.ok(fs.existsSync(path.join(projectRoot, 'alpha-skill', 'SKILL.md')));
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('re-applying the same source is a no-op and a source switch never deletes foreign folders', async () => {
  const fx = makeFixture();
  try {
    const first = await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'copy'
    });
    const second = await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'copy'
    });
    assert.equal(second.reused, true);
    assert.equal(second.entries.length, first.entries.length);

    const foreign = path.join(skillRegistry.getProjectSkillDirectory(fx.workspace), 'keep-me');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'notes.md'), 'user data', 'utf8');

    const switched = await skillSource.applyProjectSkillSource({
      workspace: fx.workspace,
      sourcePath: fx.external,
      mode: 'symlink'
    });
    assert.equal(switched.mode, 'symlink');
    assert.ok(fs.existsSync(foreign), 'a directory Yan does not own must survive');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('import refuses a missing workspace, a bad mode and an empty source', async () => {
  const fx = makeFixture();
  try {
    await assert.rejects(
      skillSource.applyProjectSkillSource({ workspace: '', sourcePath: fx.external, mode: 'copy' }),
      /工作区/
    );
    await assert.rejects(
      skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: fx.external, mode: 'nope' }),
      /导入方式/
    );
    const empty = path.join(fx.root, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    await assert.rejects(
      skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: empty, mode: 'copy' }),
      /SKILL\.md/
    );
    const projectRoot = skillRegistry.getProjectSkillDirectory(fx.workspace);
    const leftovers = fs.existsSync(projectRoot) ? fs.readdirSync(projectRoot) : [];
    assert.deepEqual(leftovers, [], 'nothing left behind');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});


test('failed replacement preserves the old source and leaves no partial package', async () => {
  const fx = makeFixture();
  try {
    const first = await skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: fx.external, mode: 'copy' });
    const next = path.join(fx.root, 'next');
    writeSkill(path.join(next, 'broken'), 'broken', 'Broken package');
    fs.symlinkSync(fx.external, path.join(next, 'broken', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: next, mode: 'copy' }), /符号链接/);
    assert.equal(skillSource.describeProjectSource(fx.workspace).source.path, fx.external);
    assert.ok(first.entries.every(entry => fs.existsSync(path.join(entry.target, 'SKILL.md'))));
    assert.ok(!fs.readdirSync(first.directory).some(name => name.startsWith('.import-') || name === 'broken'));
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('legacy linked Skills remain outside the catalog and copied packages are preserved offline', async () => {
  const fx = makeFixture();
  try {
    await skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: fx.external, mode: 'symlink' });
    const cfg = activeConfig(fx, 'symlink');
    assert.equal(skillRegistry.getInstalledSkills(cfg, appRoot, fx.dataDir).some(s => s.id === 'alpha-skill'), false);
    writeSkill(path.join(fx.external, 'alpha'), 'alpha-skill', 'New description', 'New body');
    assert.equal(skillRegistry.getInstalledSkills(cfg, appRoot, fx.dataDir).some(s => s.id === 'alpha-skill'), false);
    await skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: fx.external, mode: 'copy' });
    fs.renameSync(fx.external, fx.external + '-moved');
    const restored = await skillSource.applyProjectSkillSource({ workspace: fx.workspace, sourcePath: fx.external, mode: 'copy' });
    assert.equal(restored.reused, true);
    assert.equal(restored.entries.length, 2);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('runtime serializes source changes, preserves current config and forgets every workspace binding', async () => {
  const fx = makeFixture();
  try {
    let cfg = configFor(fx.workspace);
    const handlers = new Map();
    const { registerSkillSourceRuntime } = require('../lib/main/skill-source-runtime');
    registerSkillSourceRuntime({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: {}, state: {},
      config: { load: () => structuredClone(cfg), save: value => { cfg = value; } }
    }, { skillsDir: path.join(fx.dataDir, 'skills') });
    const apply = handlers.get('skills:source-apply');
    const result = await apply(null, { path: fx.external, mode: 'copy' });
    assert.equal(result.ok, true);
    const id = result.state.activeSourceId;
    await apply(null, { mode: 'official' });
    fs.renameSync(fx.external, fx.external + '-offline');
    assert.equal(handlers.get('skills:source-state')().sources[0].available, true);
    assert.equal((await apply(null, { sourceId: id })).ok, true);
    cfg.skillSource.active['another-workspace'] = id;
    await handlers.get('skills:source-forget')(null, id);
    assert.ok(Object.values(cfg.skillSource.active).every(value => value === 'official'));
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});
