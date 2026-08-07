const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const appRoot = path.resolve(__dirname, '..');
const skillRegistry = require('../lib/skill-registry');
const categoryIds = [
  'code-assist',
  'ui-beautify',
  'web-design',
  'agent-rules',
  'office-assist'
];
const visibleIds = [
  'code-simplifier',
  'hyperframes',
  'market-anysearch',
  'officecli',
  'remotion-best-practices',
  'yan-codegraph',
  'yan-prompt-optimizer',
  'yan-react-bits',
  'yan-serena',
  'yan-uiverse',
  'yan-understand-anything'
].sort();
const internalIds = [
  'gsap',
  'hyperframes-cli',
  'hyperframes-registry',
  'website-to-hyperframes'
].sort();
const retainedIds = [...visibleIds, ...internalIds].sort();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(appRoot, relativePath), 'utf8'));
}

function loadBundledConfig() {
  const bundledDir = path.join(appRoot, 'lib', 'skills', 'bundled');
  return fs.readdirSync(bundledDir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const manifest = readJson(path.join('lib', 'skills', 'bundled', name));
      const prompt = fs.readFileSync(path.resolve(bundledDir, manifest.promptFile), 'utf8');
      return { ...manifest, prompt };
    });
}

function assertCatalogMetadata() {
  const builtin = readJson(path.join('lib', 'skills', 'builtin.json')).skills;
  const market = readJson(path.join('lib', 'skills', 'market.json')).skills;
  const bundled = loadBundledConfig();
  const all = [...builtin, ...bundled];

  assert.strictEqual(market.length, 0, 'prompt-only market entries must not return');
  assert.deepStrictEqual(all.map(skill => skill.id).sort(), retainedIds);
  assert.strictEqual(new Set(all.map(skill => skill.id)).size, retainedIds.length);
  for (const skill of all) {
    assert.strictEqual(skill.tags.length, 1, `${skill.id} must have exactly one category`);
    assert.ok(categoryIds.includes(skill.tags[0]), `${skill.id} has an unknown category`);
    assert.ok(String(skill.prompt || '').trim(), `${skill.id} must have a real prompt`);
  }
  assert.deepStrictEqual(
    all.filter(skill => skill.hidden).map(skill => skill.id).sort(),
    internalIds,
    'only HyperFrames companion Skills may be hidden'
  );
  for (const id of visibleIds) {
    assert.ok(!all.find(skill => skill.id === id)?.hidden, `${id} must be visible`);
  }

  const expectedPackages = [
    ['hyperframes', 'references/typography.md'],
    ['hyperframes-cli', 'SKILL.md'],
    ['gsap', 'references/effects.md'],
    ['hyperframes-registry', 'references/discovery.md'],
    ['website-to-hyperframes', 'references/step-7-validate.md'],
    ['remotion-best-practices', 'rules/3d.md'],
    ['remotion-best-practices', 'rules/voiceover.md']
  ];
  for (const [id, relativePath] of expectedPackages) {
    assert.ok(fs.existsSync(path.join(appRoot, 'lib', 'skills', id, relativePath)), `${id} is missing ${relativePath}`);
  }

  const retired = readJson(path.join('lib', 'skills', 'retired.json')).skillIds;
  assert.strictEqual(retired.length, 52);
  assert.strictEqual(new Set(retired).size, retired.length);
  for (const id of retainedIds) assert.ok(!retired.includes(id), `${id} cannot be retired`);
}

function assertRendererCategories() {
  const source = fs.readFileSync(path.join(appRoot, 'renderer', 'skill-market.js'), 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__skillLabels = SKILL_TAG_LABELS; globalThis.__market = SKILL_MARKET;`, context);
  assert.deepStrictEqual(Array.from(Object.keys(context.__skillLabels)), categoryIds);
  assert.deepStrictEqual(Array.from(Object.values(context.__skillLabels)), [
    '代码辅助',
    'UI美化',
    '网页设计',
    'Agent规则',
    '办公辅助'
  ]);
  assert.strictEqual(context.__market.length, 0, 'renderer must not maintain a duplicate catalog');

  const renderer = fs.readFileSync(path.join(appRoot, 'renderer', 'renderer.js'), 'utf8');
  for (const id of visibleIds) {
    assert.ok(renderer.includes(`'${id}'`), `${id} must remain available in the composer picker`);
  }
  for (const id of internalIds) {
    assert.ok(!renderer.includes(`ids: ['${id}']`), `${id} must not become a duplicate composer card`);
  }
}

function assertRetiredMigration() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-catalog-'));
  try {
    const retiredSkill = {
      id: 'market-pr-review',
      name: 'PR Review Pro',
      desc: 'retired',
      prompt: 'old prompt-only wrapper',
      source: 'obra/superpowers'
    };
    const customSkill = {
      id: 'user-kept-skill',
      name: 'User Kept Skill',
      desc: 'user-owned',
      prompt: 'Keep this user-owned Skill.',
      source: 'custom'
    };
    assert.ok(skillRegistry.installYanUserSkill(dataDir, retiredSkill).ok);
    assert.ok(skillRegistry.installYanUserSkill(dataDir, customSkill).ok);

    const cfg = { customSkills: [...loadBundledConfig(), retiredSkill, customSkill] };
    const result = skillRegistry.pruneRetiredSkills(cfg, appRoot, dataDir);
    assert.strictEqual(result.changed, true);
    assert.ok(!cfg.customSkills.some(skill => skill.id === retiredSkill.id));
    assert.ok(cfg.customSkills.some(skill => skill.id === customSkill.id));
    assert.ok(!skillRegistry.scanYanUserSkills(dataDir).some(skill => skill.id === retiredSkill.id));
    assert.ok(skillRegistry.scanYanUserSkills(dataDir).some(skill => skill.id === customSkill.id));

    const installed = skillRegistry.getInstalledSkills(cfg, appRoot, dataDir);
    for (const id of retainedIds) assert.ok(installed.some(skill => skill.id === id), `${id} must load`);
    assert.ok(installed.some(skill => skill.id === customSkill.id), 'custom Skill must survive cleanup');
    assert.ok(!installed.some(skill => skill.id === retiredSkill.id), 'retired Skill must leave the registry');

    const catalog = skillRegistry.getSkillCatalog(cfg, appRoot, dataDir);
    for (const id of visibleIds) assert.ok(catalog.installed.some(skill => skill.id === id), `${id} must be visible`);
    for (const id of internalIds) assert.ok(!catalog.installed.some(skill => skill.id === id), `${id} must stay internal`);

    const companion = skillRegistry.readSkill('hyperframes-cli', 'render this composition', cfg, appRoot, dataDir);
    assert.strictEqual(companion.ok, true, 'HyperFrames must resolve its hidden CLI companion');
    assert.ok(companion.prompt.includes('npx hyperframes render'));

    const hyperframes = skillRegistry.readSkill('hyperframes', 'create a short video', cfg, appRoot, dataDir);
    assert.strictEqual(hyperframes.ok, true);
    assert.ok(hyperframes.prompt.includes('Yan Agent already bundles the complete HyperFrames companion set.'));
    assert.ok(hyperframes.prompt.includes(path.join(appRoot, 'lib', 'skills', 'hyperframes')));

    const remotion = skillRegistry.readSkill('remotion-best-practices', 'create an animated chart', cfg, appRoot, dataDir);
    assert.strictEqual(remotion.ok, true);
    assert.ok(remotion.prompt.includes('do not install Remotion or its Agent Skills globally'));
    assert.ok(remotion.prompt.includes(path.join(appRoot, 'lib', 'skills', 'remotion-best-practices')));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

assertCatalogMetadata();
assertRendererCategories();
assertRetiredMigration();
console.log('Skill catalog tests passed.');
