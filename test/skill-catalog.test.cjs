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
const requiredVisibleIds = [
  'code-simplifier',
  'hallmark',
  'hyperframes',
  'market-anysearch',
  'officecli',
  'remotion-best-practices',
  'greensock-gsap',
  'ui-ux-pro-max',
  'yan-codegraph',
  'yan-prompt-optimizer',
  'yan-react-bits',
  'yan-serena',
  'yan-uiverse',
  'yan-understand-anything'
].sort();
const requiredInternalIds = [
  'gsap',
  'hyperframes-cli',
  'hyperframes-registry',
  'website-to-hyperframes'
].sort();

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
  const retainedIds = all.map(skill => skill.id).sort();
  const visibleIds = all.filter(skill => !skill.hidden).map(skill => skill.id).sort();
  const internalIds = all.filter(skill => skill.hidden).map(skill => skill.id).sort();

  assert.strictEqual(market.length, 0, 'prompt-only market entries must not return');
  assert.strictEqual(new Set(all.map(skill => skill.id)).size, retainedIds.length);
  for (const skill of all) {
    assert.ok(skill.tags.length >= 1 && skill.tags.length <= 2, `${skill.id} must have one or two categories`);
    assert.ok(skill.tags.every(tag => categoryIds.includes(tag)), `${skill.id} has an unknown category`);
    assert.ok(String(skill.prompt || '').trim(), `${skill.id} must have a real prompt`);
  }
  for (const id of requiredVisibleIds) {
    assert.ok(!all.find(skill => skill.id === id)?.hidden, `${id} must be visible`);
  }
  for (const id of requiredInternalIds) {
    assert.ok(all.find(skill => skill.id === id)?.hidden, `${id} must remain an internal companion`);
  }

  const expectedPackages = [
    ['hallmark', 'references/macrostructures.md'],
    ['hallmark', 'references/macrostructures/01-bento-grid.md'],
    ['hallmark', 'references/themes/grid.md'],
    ['hallmark', 'references/theme-tokens.css'],
    ['hyperframes', 'references/typography.md'],
    ['hyperframes-cli', 'SKILL.md'],
    ['gsap', 'references/effects.md'],
    ['hyperframes-registry', 'references/discovery.md'],
    ['website-to-hyperframes', 'references/step-7-validate.md'],
    ['remotion-best-practices', 'rules/3d.md'],
    ['remotion-best-practices', 'rules/voiceover.md'],
    ['greensock-gsap', 'SKILL.md'],
    ['ui-ux-pro-max', 'data/styles.csv'],
    ['ui-ux-pro-max', 'data/stacks/threejs.csv'],
    ['ui-ux-pro-max', 'references/quick-reference.md'],
    ['ui-ux-pro-max', 'scripts/search.py']
  ];
  for (const [id, relativePath] of expectedPackages) {
    assert.ok(fs.existsSync(path.join(appRoot, 'lib', 'skills', id, relativePath)), `${id} is missing ${relativePath}`);
  }

  const retired = readJson(path.join('lib', 'skills', 'retired.json')).skillIds;
  assert.ok(retired.length >= 52, 'the retired migration list must not lose historical Skill IDs');
  assert.strictEqual(new Set(retired).size, retired.length);
  for (const id of retainedIds) assert.ok(!retired.includes(id), `${id} cannot be retired`);
  assert.ok(visibleIds.length > requiredVisibleIds.length, 'the expanded v1.4.0 catalog must remain visible');
  assert.ok(internalIds.length >= requiredInternalIds.length, 'companion Skills must remain bundled');
}

function assertHallmarkPackageIntegrity() {
  const hallmarkRoot = path.join(appRoot, 'lib', 'skills', 'hallmark');
  const markdownLink = /\[[^\]]*\]\((?!https?:|mailto:|#)([^)#]+)(?:#[^)]*)?\)/g;
  const broken = [];
  for (const file of fs.readdirSync(hallmarkRoot, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.md')) continue;
    const fullPath = path.join(file.parentPath, file.name);
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const match of content.matchAll(markdownLink)) {
      const target = decodeURIComponent(match[1]);
      const resolved = path.resolve(path.dirname(fullPath), target);
      if (!fs.existsSync(resolved)) broken.push(`${path.relative(hallmarkRoot, fullPath)} -> ${target}`);
    }
  }
  assert.deepStrictEqual(broken, [], `Hallmark contains broken local links:\n${broken.join('\n')}`);
}

function assertBundledPackageMigration() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-bundled-shadow-'));
  try {
    const hallmark = loadBundledConfig().find(skill => skill.id === 'hallmark');
    const stale = skillRegistry.installYanUserSkill(dataDir, hallmark);
    assert.strictEqual(stale.ok, true);
    assert.strictEqual(fs.readdirSync(stale.directory).length, 2, 'fixture must reproduce the legacy two-file shadow');

    const cfg = { customSkills: [hallmark] };
    const installed = skillRegistry.getInstalledSkills(cfg, appRoot, dataDir);
    const resolved = installed.find(skill => skill.id === 'hallmark');
    assert.strictEqual(resolved.runtimeDirectory, path.join(appRoot, 'lib', 'skills', 'hallmark'));
    assert.ok(fs.existsSync(path.join(resolved.runtimeDirectory, 'references', 'macrostructures.md')));

    const migrated = skillRegistry.migrateBundledSkillShadows(dataDir, appRoot, ['hallmark']);
    assert.strictEqual(migrated.changed, true);
    assert.deepStrictEqual(migrated.removedIds, ['hallmark']);
    assert.strictEqual(fs.existsSync(stale.directory), false);

    const userOwned = skillRegistry.installYanUserSkill(dataDir, {
      id: 'hallmark',
      name: 'User Hallmark',
      desc: 'A user-owned same-name fixture',
      prompt: 'Keep this directory intact.',
      source: 'custom'
    });
    assert.strictEqual(userOwned.ok, true);
    const preserved = skillRegistry.migrateBundledSkillShadows(dataDir, appRoot, ['hallmark']);
    assert.strictEqual(preserved.changed, false);
    assert.strictEqual(fs.existsSync(userOwned.directory), true, 'user-owned same-name Skill must not be deleted');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
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

}

function assertRetiredMigration() {
  const builtin = readJson(path.join('lib', 'skills', 'builtin.json')).skills;
  const bundled = loadBundledConfig();
  const retainedIds = [...builtin, ...bundled].map(skill => skill.id).sort();
  const visibleIds = [...builtin, ...bundled].filter(skill => !skill.hidden).map(skill => skill.id).sort();
  const internalIds = [...builtin, ...bundled].filter(skill => skill.hidden).map(skill => skill.id).sort();
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

    const cfg = { customSkills: [...bundled, retiredSkill, customSkill] };
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

    const uiux = skillRegistry.readSkill('ui-ux-pro-max', 'build a responsive dashboard', cfg, appRoot, dataDir);
    assert.strictEqual(uiux.ok, true);
    assert.ok(uiux.prompt.includes(path.join(appRoot, 'lib', 'skills', 'ui-ux-pro-max', 'scripts', 'search.py')));
    assert.ok(!uiux.prompt.includes('${CLAUDE_PLUGIN_ROOT}'));

    const gsap = skillRegistry.readSkill('greensock-gsap', 'add a scroll reveal animation', cfg, appRoot, dataDir);
    assert.strictEqual(gsap.ok, true);
    assert.ok(gsap.prompt.includes(path.join(appRoot, 'lib', 'skills', 'greensock-gsap')));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

assertCatalogMetadata();
assertHallmarkPackageIntegrity();
assertBundledPackageMigration();
assertRendererCategories();
assertRetiredMigration();
console.log('Skill catalog tests passed.');
