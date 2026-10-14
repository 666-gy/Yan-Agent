'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../lib/skill-registry');
const { registerSkillsRuntime } = require('../lib/main/skills-runtime');
const appRoot = path.resolve(__dirname, '..');

test('disabled suites stay manageable but disappear from model discovery, aliases and direct reads', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-policy-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cfg = { customSkills: ['hyperframes', 'hyperframes-cli', 'hyperframes-gsap', 'hyperframes-registry', 'website-to-hyperframes'].map(id =>
    JSON.parse(fs.readFileSync(path.join(appRoot, 'lib/skills/bundled', `${id}.json`), 'utf8'))), disabledSkills: [] };
  const all = registry.getAllSkillsForCatalog(cfg, appRoot, dataDir);
  const child = all.find(skill => skill.parentSkillId === 'hyperframes');
  assert.ok(child);
  assert.equal(registry.readSkill(child.id, '', cfg, appRoot, dataDir).ok, true);
  cfg.disabledSkills = ['hyperframes', 'yan-uiverse'];
  for (const id of ['hyperframes', child.id, `hyperframes/${child.id}`, child.name, `skill: ${child.name}`, child.name.replace(/\s+/g, '-'), 'yan-uiverse', ...child.aliases]) {
    assert.equal(registry.isSkillEnabled(id, cfg, appRoot, dataDir), false, id);
    assert.equal(registry.readSkill(id, '', cfg, appRoot, dataDir).ok, false, id);
    assert.equal(registry.resolveSkill(id, cfg, appRoot, dataDir), null, id);
  }
  assert.ok(!registry.getMergedSkillsForList(cfg, appRoot, dataDir).some(skill => ['hyperframes', 'yan-uiverse'].includes(skill.id)));
  assert.doesNotMatch(registry.formatCatalogForPrompt(cfg, appRoot, dataDir), /HyperFrames|Uiverse/);
  assert.ok(!registry.suggestSkills(child.name, cfg, appRoot, dataDir).some(skill => skill.id === child.id));
  const disabledCatalog = registry.getAllSkillsForCatalog(cfg, appRoot, dataDir);
  assert.equal(disabledCatalog.length, all.length);
  assert.equal(disabledCatalog.find(skill => skill.id === child.id).enabled, false);
  cfg.disabledSkills = [child.id];
  assert.equal(registry.isSkillEnabled('hyperframes', cfg, appRoot, dataDir), true);
  assert.equal(registry.isSkillEnabled(child.id, cfg, appRoot, dataDir), false);
  cfg.disabledSkills = [];
  assert.equal(registry.readSkill(child.id, '', cfg, appRoot, dataDir).ok, true);
});

test('toggle persists separately from bundled bootstrap and excludes selected and automatic skills', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-toggle-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const configPath = path.join(dataDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ customSkills: [] }));
  const handlers = new Map();
  const store = {
    loadConfig: () => JSON.parse(fs.readFileSync(configPath, 'utf8')),
    saveConfig: cfg => fs.writeFileSync(configPath, JSON.stringify(cfg)),
    skillConfigMetadata: skill => skill,
    skillConfigMetadataList: skills => skills
  };
  const runtime = registerSkillsRuntime({ ipcMain: { handle: (id, fn) => handlers.set(id, fn) }, shell: {} }, {
    appRoot, dataDir, skillsDir: path.join(dataDir, 'skills'), skillRegistry: registry, configStore: store,
    getMergedSkills: cfg => registry.getMergedSkillsForList(cfg, appRoot, dataDir),
    getMainWindow: () => null, invalidateSidecar: () => { throw new Error('must not restart active kernel'); },
    mcpRuntimeConfig: { selectedSkillIds: skills => new Set(skills.map(s => s.id || s)), unmetSkillRequirements: () => [] }
  });
  const cfg = store.loadConfig(); runtime.ensureBundledAgentSkills(cfg); store.saveConfig(cfg);
  for (const id of ['yan-uiverse', 'mcp-puller', 'yan-serena']) {
    assert.equal(handlers.get('skills:set-enabled')(null, { id, enabled: false }).ok, true);
  }
  assert.equal(handlers.get('skills:set-enabled')(null, { id: '../../missing', enabled: true }).ok, false);
  assert.equal(handlers.get('skills:set-enabled')(null, { id: 'yan-uiverse', enabled: 'false' }).ok, false);
  const persisted = store.loadConfig();
  assert.deepEqual(persisted.disabledSkills, ['yan-uiverse', 'mcp-puller', 'yan-serena']);
  assert.deepEqual(await runtime.selectedRunSkills([{ id: 'yan-uiverse' }, 'yan-serena'], persisted, { workspace: dataDir, workMode: 'goal' }), { skills: [], skippedSkills: [] });
  assert.deepEqual(await runtime.selectedRunSkills(['yan-serena'], persisted, {}), { skills: [], skippedSkills: [] });
  assert.equal(handlers.get('skills:set-enabled')(null, { id: 'yan-uiverse', enabled: true }).enabled, true);
  assert.equal(registry.readSkill('yan-uiverse', '', store.loadConfig(), appRoot, dataDir).ok, true);
});
