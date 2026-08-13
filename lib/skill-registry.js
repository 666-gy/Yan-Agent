/**
 * Yan Agent — Skill registry (main process)
 * Builtin + market catalog + explicit custom installs
 */
const fs = require('fs');
const path = require('path');
const skillStore = require('./skill-store');

let bundledBuiltin = null;
let bundledMarket = null;

const SKILL_LOGO_ROOT = 'assets/skill-logos/';
const SKILL_LOGO_FALLBACK = `${SKILL_LOGO_ROOT}github.png`;
const YAN_SKILL_MANIFEST = '.yan-skill.json';
const DEFAULT_SKILL_LOAD_ATTEMPTS = 3;
const DEFAULT_SKILL_RETRY_DELAYS_MS = Object.freeze([40, 120]);
const SKILL_LOGOS_BY_ID = Object.freeze({
  'yan-prompt-optimizer': `${SKILL_LOGO_ROOT}prompt-optimizer.svg`,
  'yan-react-bits': `${SKILL_LOGO_ROOT}react-bits.png`,
  'yan-uiverse': `${SKILL_LOGO_ROOT}uiverse.png`,
  'code-simplifier': `${SKILL_LOGO_ROOT}anthropic.png`,
  officecli: `${SKILL_LOGO_ROOT}officecli.png`,
  'market-anysearch': `${SKILL_LOGO_ROOT}anysearch.png`,
  hyperframes: `${SKILL_LOGO_ROOT}hyperframes.png`,
  'remotion-best-practices': `${SKILL_LOGO_ROOT}remotion.png`,
  'yan-computer-use': `${SKILL_LOGO_ROOT}computer-use.png`
});

const SKILL_LOGOS_BY_SOURCE = Object.freeze([
  ['anthropics', 'anthropic.png'],
  ['snyk', 'snyk.png'],
  ['anysearch-ai/', 'anysearch.png'],
  ['iofficeai/', 'officecli.png'],
  ['officecli.ai', 'officecli.png'],
  ['uiverse-io/', 'uiverse.png'],
  ['davidhdev/react-bits', 'react-bits.png']
]);

function resolveSkillLogo(skill = {}) {
  const id = normalizeId(skill.id);
  if (SKILL_LOGOS_BY_ID[id]) return SKILL_LOGOS_BY_ID[id];

  const explicit = String(skill.logo || '').trim();
  if (/^(?:assets\/skill-logos\/[a-z0-9._-]+|assets\/logo-light\.png)$/i.test(explicit)) return explicit;

  const source = `${skill.repo || ''} ${skill.source || ''}`.toLowerCase();
  const match = SKILL_LOGOS_BY_SOURCE.find(([needle]) => source.includes(needle));
  return match ? `${SKILL_LOGO_ROOT}${match[1]}` : SKILL_LOGO_FALLBACK;
}

function withSkillLogo(skill) {
  return {
    ...skill,
    tags: skill.tags || [],
    logo: resolveSkillLogo(skill)
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadBundled(appRoot) {
  if (!bundledBuiltin) {
    bundledBuiltin = readJson(path.join(appRoot, 'lib', 'skills', 'builtin.json'));
  }
  if (!bundledMarket) {
    bundledMarket = readJson(path.join(appRoot, 'lib', 'skills', 'market.json'));
  }
  return { builtin: bundledBuiltin, market: bundledMarket };
}

function loadMarketCatalog(appRoot) {
  return loadBundled(appRoot).market;
}

function getBuiltinSkills(appRoot) {
  return (loadBundled(appRoot).builtin.skills || []).map(withSkillLogo);
}

function getRetiredSkillIds(appRoot) {
  try {
    const catalog = readJson(path.join(appRoot, 'lib', 'skills', 'retired.json'));
    return new Set((catalog.skillIds || []).map(normalizeId).filter(Boolean));
  } catch {
    return new Set();
  }
}

function normalizeId(id) {
  return String(id || '').trim().toLowerCase();
}

function getYanSkillDirectory(dataDir) {
  return path.join(String(dataDir || ''), 'skills');
}

function ensureYanSkillDirectory(dataDir) {
  const root = getYanSkillDirectory(dataDir);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function normalizeSkillDocument(text) {
  return String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function decodeFrontmatterValue(value) {
  const source = String(value || '').trim();
  if (source.length >= 2) {
    const first = source[0];
    const last = source[source.length - 1];
    if (first === '"' && last === '"') {
      try { return JSON.parse(source); } catch { return source.slice(1, -1); }
    }
    if (first === "'" && last === "'") return source.slice(1, -1).replaceAll("''", "'");
  }
  return source;
}

function parseSkillDocument(text, options = {}) {
  const normalized = normalizeSkillDocument(text);
  const lines = normalized.split('\n');
  const hasFrontmatter = lines[0]?.trim() === '---';
  if (!hasFrontmatter) {
    const prompt = normalized.trim();
    if (options.requireFrontmatter) throw new Error('SKILL.md 缺少 YAML frontmatter。');
    if (options.requirePrompt && !prompt) throw new Error('SKILL.md 没有可调用的正文。');
    return { metadata: {}, name: '', description: '', prompt, document: normalized };
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === '---') {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    if (options.requireFrontmatter) throw new Error('SKILL.md 的 YAML frontmatter 未闭合。');
    return { metadata: {}, name: '', description: '', prompt: normalized.trim(), document: normalized };
  }

  const metadata = {};
  for (let index = 1; index < closing; index++) {
    const line = lines[index];
    if (!line || line[0] === ' ' || line[0] === '\t') continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const rawValue = line.slice(separator + 1).trim();
    if (!key) continue;
    if (rawValue === '|' || rawValue === '>') {
      const chunks = [];
      while (index + 1 < closing) {
        const continuation = lines[index + 1];
        if (continuation && continuation[0] !== ' ' && continuation[0] !== '\t') break;
        index++;
        chunks.push(continuation.trim());
      }
      metadata[key] = chunks.join(rawValue === '>' ? ' ' : '\n').trim();
      continue;
    }
    metadata[key] = decodeFrontmatterValue(rawValue);
  }
  const name = String(metadata.name || '').trim();
  const description = String(metadata.description || '').trim();
  const prompt = lines.slice(closing + 1).join('\n').trim();
  if (options.requireName && !name) throw new Error('SKILL.md frontmatter 缺少 name。');
  if (options.requireDescription && !description) throw new Error('SKILL.md frontmatter 缺少 description。');
  if (options.requirePrompt && !prompt) throw new Error('SKILL.md 没有可调用的正文。');
  return { metadata, name, description, prompt, document: normalized };
}

function waitForSkillRetry(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function safeSkillDirectoryName(id) {
  const source = normalizeId(id);
  let output = '';
  for (const char of source) {
    const code = char.charCodeAt(0);
    const allowed = (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || char === '.'
      || char === '_'
      || char === '-';
    output += allowed ? char : '-';
  }
  while (output.includes('--')) output = output.replaceAll('--', '-');
  output = output.replaceAll('..', '.');
  while (output.startsWith('-') || output.startsWith('.')) output = output.slice(1);
  while (output.endsWith('-') || output.endsWith('.')) output = output.slice(0, -1);
  return output.slice(0, 96) || 'skill';
}

function readYanSkillManifest(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, YAN_SKILL_MANIFEST), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function installedSkillSourceState(dataDir, skillId) {
  const query = normalizeId(skillId);
  if (!query) return null;
  const root = ensureYanSkillDirectory(dataDir);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const manifest = readYanSkillManifest(dir);
    const candidates = [manifest.id, manifest.name, entry.name].map(normalizeId).filter(Boolean);
    if (!candidates.includes(query)) continue;
    const skillFile = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      return { error: `Skill「${query}」缺少 SKILL.md。` };
    }
    try {
      parseSkillDocument(fs.readFileSync(skillFile, 'utf8'), {
        requireFrontmatter: true,
        requireName: true,
        requireDescription: true,
        requirePrompt: true
      });
    } catch (error) {
      return { error: `Skill「${query}」解析失败：${String(error?.message || error)}` };
    }
    return { error: '' };
  }
  return null;
}

function scanYanUserSkills(dataDir) {
  const root = ensureYanSkillDirectory(dataDir);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const skillFile = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      const parsed = parseSkillDocument(fs.readFileSync(skillFile, 'utf8'), {
        requireFrontmatter: true,
        requireName: true,
        requireDescription: true,
        requirePrompt: true
      });
      const manifest = readYanSkillManifest(dir);
      const id = normalizeId(manifest.id || parsed.metadata.name || entry.name);
      if (!id || !parsed.prompt) continue;
      skills.push(withSkillLogo({
        id,
        name: String(manifest.name || parsed.metadata.display_name || parsed.metadata.name || id).trim(),
        desc: String(manifest.desc || parsed.metadata.description || '').trim(),
        prompt: parsed.prompt,
        version: Number(manifest.version || parsed.metadata.version || 1),
        source: String(manifest.source || parsed.metadata.source || 'yan-user').trim(),
        repo: String(manifest.repo || '').trim() || undefined,
        aliases: Array.isArray(manifest.aliases) ? manifest.aliases : [],
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
        triggers: Array.isArray(manifest.triggers) ? manifest.triggers : [],
        requires: Array.isArray(manifest.requires) ? manifest.requires : [],
        userOnly: manifest.userOnly === true,
        installedAt: Number(manifest.installedAt || 0) || undefined,
        updatedAt: Number(manifest.updatedAt || 0) || undefined,
        runtimeDirectory: dir,
        yanManaged: !!manifest.id
      }));
    } catch { /* Ignore invalid Yan-local packages until the user fixes or removes them. */ }
  }
  return skills;
}

function serializeYanSkillDocument(skill) {
  const parsed = parseSkillDocument(skill.prompt);
  const description = String(skill.desc || skill.description || '').trim();
  return [
    '---',
    `name: ${normalizeId(skill.id)}`,
    `description: ${JSON.stringify(description || `Yan Skill ${skill.id}`)}`,
    '---',
    '',
    parsed.prompt,
    ''
  ].join('\n');
}

function installYanUserSkill(dataDir, skill = {}) {
  const id = normalizeId(skill.id);
  const prompt = String(skill.prompt || '').trim();
  if (!id || !prompt) return { ok: false, error: 'Skill id 和 prompt 为必填项。' };
  const root = ensureYanSkillDirectory(dataDir);
  const existing = scanYanUserSkills(dataDir).find(item => normalizeId(item.id) === id);
  if (existing && !existing.yanManaged) {
    return { ok: true, preserved: true, directory: existing.runtimeDirectory, skill: existing };
  }
  const dir = existing?.runtimeDirectory || path.join(root, safeSkillDirectoryName(id));
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(dir);
  if (path.dirname(resolvedDir) !== resolvedRoot) {
    return { ok: false, error: 'Skill 安装目录必须是 Yan Skill 根目录的直接子目录。' };
  }
  fs.mkdirSync(resolvedDir, { recursive: true });
  const now = Date.now();
  const manifest = {
    schema: 1,
    id,
    name: String(skill.name || id).trim(),
    desc: String(skill.desc || '').trim(),
    version: Number.isFinite(Number(skill.version)) ? Number(skill.version) : 1,
    source: String(skill.source || 'custom').trim(),
    repo: String(skill.repo || '').trim(),
    aliases: Array.isArray(skill.aliases) ? skill.aliases : [],
    tags: Array.isArray(skill.tags) ? skill.tags : [],
    triggers: Array.isArray(skill.triggers) ? skill.triggers : [],
    requires: Array.isArray(skill.requires) ? skill.requires : [],
    userOnly: skill.userOnly === true,
    installedAt: Number(skill.installedAt || existing?.installedAt || now),
    updatedAt: Number(skill.updatedAt || now)
  };
  fs.writeFileSync(path.join(resolvedDir, 'SKILL.md'), serializeYanSkillDocument(skill), 'utf8');
  fs.writeFileSync(path.join(resolvedDir, YAN_SKILL_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { ok: true, directory: resolvedDir };
}

function removeYanUserSkill(dataDir, skillId) {
  const id = normalizeId(skillId);
  if (!id) return { ok: false, error: 'Skill id 不能为空。' };
  const root = ensureYanSkillDirectory(dataDir);
  const match = scanYanUserSkills(dataDir).find(item => normalizeId(item.id) === id);
  if (!match) return { ok: true, removed: false };
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(match.runtimeDirectory);
  if (path.dirname(resolvedDir) !== resolvedRoot) {
    return { ok: false, error: '拒绝删除 Yan Skill 根目录之外的目录。' };
  }
  fs.rmSync(resolvedDir, { recursive: true, force: true });
  return { ok: true, removed: true };
}

function pruneRetiredSkills(cfg, appRoot, dataDir) {
  const retiredIds = getRetiredSkillIds(appRoot);
  if (!retiredIds.size) return { changed: false, removedIds: [] };
  const removedIds = [];
  for (const skill of scanYanUserSkills(dataDir)) {
    const id = normalizeId(skill?.id);
    if (!retiredIds.has(id)) continue;
    const result = removeYanUserSkill(dataDir, id);
    if (result.ok && result.removed) removedIds.push(id);
  }
  const before = Array.isArray(cfg?.customSkills) ? cfg.customSkills.length : 0;
  if (cfg && Array.isArray(cfg.customSkills)) {
    cfg.customSkills = cfg.customSkills.filter(skill => !retiredIds.has(normalizeId(skill?.id)));
  }
  return {
    changed: removedIds.length > 0 || before !== (cfg?.customSkills?.length || 0),
    removedIds
  };
}

function syncYanUserSkills(cfg, appRoot, dataDir) {
  const appSkillRoot = path.join(String(appRoot || ''), 'lib', 'skills');
  const installedIds = new Set(scanYanUserSkills(dataDir).map(skill => normalizeId(skill.id)));
  const results = [];
  for (const skill of Array.isArray(cfg?.customSkills) ? cfg.customSkills : []) {
    const id = normalizeId(skill?.id);
    if (!id || installedIds.has(id)) continue;
    const bundledDirectory = path.join(appSkillRoot, safeSkillDirectoryName(skill?.id));
    if (fs.existsSync(path.join(bundledDirectory, 'SKILL.md'))) continue;
    results.push({ id: skill?.id, ...installYanUserSkill(dataDir, skill) });
    installedIds.add(id);
  }
  return results;
}

function bundledSkillPackage(appRoot, skillId) {
  const root = String(appRoot || '');
  const relative = path.join('lib', 'skills', safeSkillDirectoryName(skillId));
  const unpackedRoot = root.endsWith('app.asar') ? `${root}.unpacked` : root;
  const unpackedDirectory = path.join(unpackedRoot, relative);
  if (fs.existsSync(path.join(unpackedDirectory, 'SKILL.md'))) return unpackedDirectory;
  const asarDirectory = path.join(root, relative);
  return fs.existsSync(path.join(asarDirectory, 'SKILL.md')) ? asarDirectory : '';
}

function findById(skills, id) {
  const nid = normalizeId(id);
  return skills.find(s => normalizeId(s.id) === nid) || null;
}

function findByFuzzy(skills, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const exact = skills.find(s =>
    normalizeId(s.id) === q ||
    normalizeId(s.name) === q
  );
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  for (const s of skills) {
    const hay = `${s.id} ${s.name} ${s.desc} ${(s.triggers || []).join(' ')}`.toLowerCase();
    let score = 0;
    if (hay.includes(q)) score += q.length * 2;
    for (const t of s.triggers || []) {
      if (q.includes(String(t).toLowerCase()) || String(t).toLowerCase().includes(q)) score += 5;
    }
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 5 ? best : null;
}

function getInstalledSkills(cfg, appRoot, dataDir) {
  const builtin = getBuiltinSkills(appRoot).map(s => ({
    ...s,
    source: 'builtin',
    installed: true
  }));
  if (dataDir) syncYanUserSkills(cfg, appRoot, dataDir);
  const configById = new Map((cfg.customSkills || []).map(skill => [normalizeId(skill?.id), skill]));
  const diskSkills = dataDir ? scanYanUserSkills(dataDir) : [];
  const diskCustom = diskSkills.map(diskSkill => ({
    ...withSkillLogo({
      ...diskSkill,
      ...(configById.get(normalizeId(diskSkill.id)) || {}),
      prompt: diskSkill.prompt,
      runtimeDirectory: diskSkill.runtimeDirectory
    }),
    installed: true
  }));
  const diskIds = new Set(diskCustom.map(skill => normalizeId(skill.id)));
  const bundledCustom = (cfg.customSkills || []).flatMap(skill => {
    const id = normalizeId(skill?.id);
    if (!id || diskIds.has(id)) return [];
    const runtimeDirectory = bundledSkillPackage(appRoot, id);
    if (!runtimeDirectory) return [];
    let prompt = String(skill.prompt || '').trim();
    try {
      prompt = parseSkillDocument(fs.readFileSync(path.join(runtimeDirectory, 'SKILL.md'), 'utf8')).prompt || prompt;
    } catch {}
    return [{
      ...withSkillLogo({ ...skill, prompt, runtimeDirectory }),
      installed: true
    }];
  });
  const custom = [...diskCustom, ...bundledCustom];
  const ids = new Set(builtin.map(s => normalizeId(s.id)));
  const merged = [...builtin];
  for (const s of custom) {
    const id = normalizeId(s?.id);
    if (id && !ids.has(id)) {
      merged.push(s);
      ids.add(id);
    }
  }
  return merged;
}

function syncSkillStore(cfg, appRoot, dataDir) {
  return skillStore.syncSkillStore(dataDir, getInstalledSkills(cfg, appRoot, dataDir));
}

function storedSkillList(cfg, appRoot, dataDir) {
  const synced = syncSkillStore(cfg, appRoot, dataDir);
  if (!synced.ok) return getInstalledSkills(cfg, appRoot, dataDir);
  return synced.index.entries.map(entry => ({
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases || [],
    desc: entry.description || '',
    version: entry.version,
    source: entry.source,
    repo: entry.repo || undefined,
    logo: entry.logo || resolveSkillLogo(entry),
    hidden: entry.hidden === true,
    userOnly: entry.userOnly === true,
    parentSkillId: entry.parentSkillId || undefined,
    tags: entry.tags || [],
    triggers: entry.triggers || [],
    requires: entry.requires || [],
    installedAt: entry.installedAt || undefined,
    updatedAt: entry.updatedAt || undefined,
    installed: true,
    storePath: entry.storePath,
    runtimeDirectory: entry.runtimeDirectory || '',
    sha256: entry.sha256
  }));
}

function getMarketSkills(appRoot, dataDir) {
  return (loadMarketCatalog(appRoot, dataDir).skills || []).map(withSkillLogo);
}

function hydrateInstalledSkillMetadata(cfg, appRoot, dataDir) {
  if (!Array.isArray(cfg?.customSkills) || !cfg.customSkills.length) return false;
  const marketById = new Map(getMarketSkills(appRoot, dataDir).map(skill => [normalizeId(skill.id), skill]));
  const scalarFields = ['repo', 'version', 'updatedAt', 'stars'];
  const arrayFields = ['aliases', 'tags', 'triggers', 'requires'];
  let changed = false;
  cfg.customSkills = cfg.customSkills.map(skill => {
    const market = marketById.get(normalizeId(skill?.id));
    if (!market) return skill;
    const next = { ...skill };
    for (const field of scalarFields) {
      if ((next[field] === undefined || next[field] === null || next[field] === '')
          && market[field] !== undefined) {
        next[field] = market[field];
        changed = true;
      }
    }
    for (const field of arrayFields) {
      if ((!Array.isArray(next[field]) || !next[field].length)
          && Array.isArray(market[field]) && market[field].length) {
        next[field] = market[field];
        changed = true;
      }
    }
    return next;
  });
  return changed;
}

function getSkillCatalog(cfg, appRoot, dataDir) {
  const installed = storedSkillList(cfg, appRoot, dataDir).filter(skill => !skill.hidden);
  const market = getMarketSkills(appRoot, dataDir);
  const installedIds = new Set(installed.map(s => s.id));
  return {
    installed,
    market: market.map(s => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      aliases: s.aliases || [],
      tags: s.tags || [],
      triggers: s.triggers || [],
      repo: s.repo,
      logo: resolveSkillLogo(s),
      installed: installedIds.has(s.id)
    }))
  };
}

function resolveSkill(skillId, cfg, appRoot, dataDir, { allowFuzzy = true } = {}) {
  syncSkillStore(cfg, appRoot, dataDir);
  const stored = skillStore.resolveSkillStore(dataDir, skillId);
  if (stored && (allowFuzzy || stored.exact)) {
    return {
      skill: stored.skill,
      source: stored.skill.source || 'installed',
      installed: true,
      fuzzy: !stored.exact,
      score: stored.score
    };
  }

  const market = getMarketSkills(appRoot, dataDir);
  let hit = findById(market, skillId);
  if (hit) return { skill: hit, source: 'market', installed: false };

  if (allowFuzzy) {
    hit = findByFuzzy(market, skillId);
    if (hit) {
      return { skill: hit, source: 'market', installed: false, fuzzy: true };
    }
  }
  return null;
}

function suggestSkills(query, cfg, appRoot, dataDir, limit = 5) {
  syncSkillStore(cfg, appRoot, dataDir);
  return skillStore.searchSkillStore(dataDir, query, { limit: Math.max(limit, 20) })
    .filter(skill => !skill.userOnly)
    .slice(0, limit)
    .map(skill => ({
      id: skill.id,
      name: skill.name,
      aliases: skill.aliases || [],
      desc: skill.description || '',
      score: skill.score,
      exact: skill.exact
    }));
}

function resolveSkillRuntimeDirectory(appRoot, skillId) {
  if (normalizeId(skillId) !== 'market-anysearch') return '';
  const relative = path.join('lib', 'skills', 'anysearch');
  const unpackedRoot = String(appRoot || '').endsWith('app.asar') ? `${appRoot}.unpacked` : appRoot;
  const unpacked = path.join(unpackedRoot, relative);
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(appRoot, relative);
}

function resolveSkillPromptRuntime(skill, prompt, appRoot) {
  let resolved = String(prompt || '');
  let skillDir = String(skill?.runtimeDirectory || '').trim();
  if (normalizeId(skill?.id) === 'hyperframes') {
    resolved = [
      '# Yan Agent bundled-suite rules',
      '',
      'Yan Agent already bundles the complete HyperFrames companion set. When this document refers to the hyperframes-cli, gsap, hyperframes-registry, or website-to-hyperframes Skill, call read_skill with that exact id. Do not install, update, or search for another copy of those Skills.',
      'Use npx hyperframes only for project scaffolding, validation, preview, rendering, transcription, TTS, and other project operations described below.',
      '',
      resolved
    ].join('\n');
  }
  if (normalizeId(skill?.id) === 'remotion-best-practices') {
    resolved = [
      '# Yan Agent runtime rules',
      '',
      'Use the complete rules bundled in this Skill directory. Create project dependencies inside the selected workspace; do not install Remotion or its Agent Skills globally.',
      'Before the first preview or render, verify that node, npx, and ffmpeg are available. Report a missing runtime instead of claiming a render succeeded.',
      '',
      resolved
    ].join('\n');
  }
  if (normalizeId(skill?.id) === 'tasteskill') {
    resolved = [
      '# Yan Agent bundled-suite rules',
      '',
      'TasteSkill is a router. Load only the focused module needed for the current request with read_skill:',
      '- tasteskill-image-to-code: visual reference first, then implementation.',
      '- tasteskill-imagegen-web or tasteskill-imagegen-mobile: image-only design references.',
      '- tasteskill-redesign: audit and improve an existing interface.',
      '- tasteskill-gpt-taste: Awwwards-level page structure and GSAP motion.',
      '- tasteskill-brandkit: brand identity boards and visual systems.',
      '- tasteskill-minimalist, tasteskill-soft, or tasteskill-brutalist: choose one visual direction.',
      '- tasteskill-stitch: Google Stitch DESIGN.md guidance.',
      '- tasteskill-output: complete code output when the user explicitly asks for exhaustive code.',
      '',
      'Do not load every TasteSkill module by default. The user request and existing project conventions remain authoritative.',
      '',
      resolved
    ].join('\n');
  }
  if (normalizeId(skill?.id) === 'market-anysearch') {
    skillDir = resolveSkillRuntimeDirectory(appRoot, skill.id);
    const legacyLocation = /<skill_dir>[\\/]lib[\\/]skills[\\/]anysearch[\\/]?/gi;
    resolved = resolved.replace(legacyLocation, skillDir).replace(/<skill_dir>/gi, skillDir);
    const cliPath = path.join(skillDir, 'scripts', 'anysearch_cli.js');
    if (!resolved.includes(cliPath)) {
      resolved += `\n\nYan Agent resolved runtime directory: ${skillDir}\nWindows command: node "${cliPath}" <search|batch_search|extract|get_sub_domains> ...`;
    }
  }
  if (normalizeId(skill?.id) === 'ui-ux-pro-max') {
    skillDir = skillDir || bundledSkillPackage(appRoot, skill.id);
    const upstreamRoot = /\$\{CLAUDE_PLUGIN_ROOT\}[\\/]\.claude[\\/]skills[\\/]ui-ux-pro-max/gi;
    resolved = resolved.replace(upstreamRoot, () => skillDir);
    const searchPath = path.join(skillDir, 'scripts', 'search.py');
    if (skillDir && !resolved.includes(searchPath)) {
      resolved += `\n\nYan Agent UI/UX Pro Max runtime: ${skillDir}\nUse the complete local database and invoke the search script with Python: python "${searchPath}" <query> [options].`;
    }
  }
  if (normalizeId(skill?.id) === 'officecli') {
    const root = String(appRoot || '').endsWith('app.asar') ? `${appRoot}.unpacked` : appRoot;
    const runnerPath = path.join(String(root || ''), 'lib', process.platform === 'win32' ? 'officecli-runner.ps1' : 'officecli-runner.js');
    const invocation = process.platform === 'win32'
      ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${runnerPath}" <command> ...`
      : `node "${runnerPath}" <command> ...`;
    resolved += `\n\nYan Agent OfficeCLI runner: ${invocation}\nUse this runner for every OfficeCLI command. Yan manages the bundled or downloaded runtime; do not run an OfficeCLI installer or install another copy.`;
  }
  if (skillDir && !resolved.includes(skillDir)) {
    resolved += `\n\nYan Agent resolved Skill directory: ${skillDir}`;
  }
  if (skillDir) {
    resolved += '\nUse this exact Yan-owned directory for this Skill. Do not search user-home or other applications\' Agent directories for alternate copies.';
  }
  return resolved;
}

function readSkill(skillId, taskContext, cfg, appRoot, dataDir, saveConfig, options = {}) {
  const synced = syncSkillStore(cfg, appRoot, dataDir);
  if (!synced.ok) {
    return {
      ok: false,
      code: 'SKILL_STORE_UNAVAILABLE',
      retryable: true,
      error: synced.error || 'SkillStore 暂时不可用。'
    };
  }
  const stored = skillStore.resolveSkillStore(dataDir, skillId);
  let skill = stored?.exact ? stored.skill : null;
  const fuzzy = false;
  if (!skill) {
    const sourceState = installedSkillSourceState(dataDir, skillId);
    if (sourceState?.error) {
      return {
        ok: false,
        code: 'SKILL_PARSE_FAILED',
        retryable: true,
        error: sourceState.error
      };
    }
    if (sourceState) {
      return {
        ok: false,
        code: 'SKILL_STORE_STALE',
        retryable: true,
        error: `Skill「${normalizeId(skillId)}」源文件已恢复，正在重新同步运行索引。`
      };
    }
    const marketMatch = findById(getMarketSkills(appRoot, dataDir), skillId);
    if (marketMatch) {
      return {
        ok: false,
        code: 'SKILL_NOT_INSTALLED',
        retryable: false,
        error: `Skill 未安装，请先在 Skill 市场安装：${marketMatch.id}`,
        suggestions: suggestSkills(skillId, cfg, appRoot, dataDir)
      };
    }
    return {
      ok: false,
      code: 'SKILL_NOT_FOUND',
      retryable: false,
      error: `已安装的 Skill 中未找到：${skillId}`,
      suggestions: suggestSkills(skillId, cfg, appRoot, dataDir)
    };
  }
  if (skill.userOnly && options.allowUserOnly !== true) {
    return {
      ok: false,
      code: 'SKILL_REQUIRES_USER_SELECTION',
      retryable: false,
      error: `Skill「${skill.name || skill.id}」只能由用户在输入框中为当前任务明确选择。`
    };
  }
  let prompt = resolveSkillPromptRuntime(skill, String(skill.prompt || '').trim(), appRoot);
  const ctx = String(taskContext || '').trim();
  if (ctx) {
    prompt = prompt.includes('{{cursor}}')
      ? prompt.replace(/\{\{cursor\}\}/g, ctx)
      : prompt + '\n\n' + ctx;
  } else {
    prompt = prompt.replace(/\{\{cursor\}\}/g, '(见上方用户任务描述)');
  }
  return {
    ok: true,
    id: skill.id,
    name: skill.name,
    desc: skill.desc || skill.description || '',
    tags: skill.tags || [],
    aliases: skill.aliases || [],
    requires: Array.isArray(skill.requires) ? skill.requires : [],
    prompt,
    fuzzy,
    runtimeDirectory: skill.runtimeDirectory || '',
    store: skillStore.getStoreInfo(dataDir)
  };
}

async function readSkillWithRetry(skillId, taskContext, cfg, appRoot, dataDir, saveConfig, options = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts) || DEFAULT_SKILL_LOAD_ATTEMPTS));
  const retryDelays = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs
    : DEFAULT_SKILL_RETRY_DELAYS_MS;
  let lastResult = null;
  let attempts = 0;
  const read = typeof options.readSkillImpl === 'function' ? options.readSkillImpl : readSkill;
  for (let index = 0; index < maxAttempts; index++) {
    attempts = index + 1;
    try {
      lastResult = read(skillId, taskContext, cfg, appRoot, dataDir, saveConfig, options);
    } catch (error) {
      lastResult = {
        ok: false,
        code: 'SKILL_LOAD_FAILED',
        retryable: true,
        error: String(error?.message || error)
      };
    }
    if (lastResult?.ok) return { ...lastResult, attempts };
    if (lastResult?.retryable === false || attempts >= maxAttempts) break;
    await waitForSkillRetry(retryDelays[index]);
  }

  const id = normalizeId(skillId) || String(skillId || 'unknown');
  const error = String(lastResult?.error || `Skill「${id}」无法加载。`);
  return {
    ...(lastResult || {}),
    ok: false,
    skipped: true,
    id,
    attempts,
    retryable: false,
    error,
    skipNotice: `Skill「${id}」连续 ${attempts} 次加载失败，本轮已跳过。原因：${error}`
  };
}

function formatCatalogForPrompt(cfg, appRoot, dataDir) {
  const installed = storedSkillList(cfg, appRoot, dataDir)
    .filter(skill => !skill.hidden && !skill.userOnly);
  const lines = ['### Installed (builtin + custom)'];
  for (const s of installed) {
    lines.push(`- ${s.name}${s.aliases?.length ? ` (aliases: ${s.aliases.join(', ')})` : ''} — ${s.desc}`);
  }
  return lines.join('\n');
}

function getMergedSkillsForList(cfg, appRoot, dataDir) {
  const installed = dataDir ? storedSkillList(cfg, appRoot, dataDir) : getInstalledSkills(cfg, appRoot, dataDir);
  return installed.filter(skill => !skill.hidden).map(s => ({
    id: s.id,
    name: s.name,
    desc: s.desc,
    prompt: s.prompt || undefined,
    tags: s.tags,
    aliases: s.aliases || [],
    requires: Array.isArray(s.requires) ? s.requires : [],
    userOnly: s.userOnly === true,
    source: s.source,
    logo: resolveSkillLogo(s)
  }));
}

module.exports = {
  getBuiltinSkills,
  getInstalledSkills,
  getMarketSkills,
  getSkillCatalog,
  getMergedSkillsForList,
  syncSkillStore,
  syncYanUserSkills,
  scanYanUserSkills,
  installYanUserSkill,
  removeYanUserSkill,
  pruneRetiredSkills,
  getRetiredSkillIds,
  getYanSkillDirectory,
  hydrateInstalledSkillMetadata,
  resolveSkill,
  readSkill,
  readSkillWithRetry,
  parseSkillDocument,
  suggestSkills,
  formatCatalogForPrompt,
  loadMarketCatalog,
  resolveSkillLogo,
  getSkillStoreInfo: skillStore.getStoreInfo,
  searchSkillStore: skillStore.searchSkillStore
};
