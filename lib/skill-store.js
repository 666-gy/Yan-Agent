/**
 * Yan Agent SkillStore
 *
 * Materializes every installed Skill into one runtime-owned store and keeps a
 * single local vector index for exact-name, alias and semantic-ish retrieval.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_SCHEMA = 1;
const VECTOR_DIMENSIONS = 96;
const ENTRY_MARKER = '.yan-skill-entry';
const syncCache = new Map();

function getPaths(dataDir) {
  const root = path.join(String(dataDir || ''), 'SkillStore');
  return {
    root,
    bundled: path.join(root, 'bundled'),
    installed: path.join(root, 'installed'),
    staging: path.join(root, 'staging'),
    quarantine: path.join(root, 'quarantine'),
    index: path.join(root, 'index.json')
  };
}

function ensureStore(dataDir) {
  const paths = getPaths(dataDir);
  for (const dir of [paths.root, paths.bundled, paths.installed, paths.staging, paths.quarantine]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function normalizeLookup(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^skill\s*:/, '')
    .replace(/[\s_.:/\\-]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function tokenize(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\\/]+/g, ' ')
    .toLowerCase();
  const latin = normalized.match(/[a-z][a-z0-9]{1,}/g) || [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) || [];
  const chinese = [];
  for (const run of chineseRuns) {
    if (run.length === 1) chinese.push(run);
    for (let index = 0; index < run.length - 1; index++) chinese.push(run.slice(index, index + 2));
  }
  return [...latin, ...chinese];
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildVector(value) {
  const vector = Array(VECTOR_DIMENSIONS).fill(0);
  for (const token of tokenize(value)) vector[hashToken(token) % VECTOR_DIMENSIONS] += 1;
  const norm = Math.sqrt(vector.reduce((sum, number) => sum + number * number, 0)) || 1;
  return vector.map(number => Number((number / norm).toFixed(5)));
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  let value = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) value += left[index] * right[index];
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function atomicWrite(filePath, content) {
  const text = String(content);
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === text) return false;
  } catch { /* rewrite unreadable files */ }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text, 'utf8');
  try {
    fs.renameSync(temp, filePath);
  } catch (error) {
    try { fs.rmSync(filePath, { force: true }); } catch {}
    fs.renameSync(temp, filePath);
  }
  return true;
}

function directoryNameFor(id) {
  const slug = String(id || 'skill').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  return `${slug.slice(0, 72)}-${sha256(id).slice(0, 8)}`;
}

function normalizeAliases(skill) {
  const id = String(skill?.id || '').trim();
  const values = [
    id,
    id.replace(/^(?:yan|market)-/i, ''),
    skill?.name,
    ...(Array.isArray(skill?.aliases) ? skill.aliases : []),
    ...(Array.isArray(skill?.triggers) ? skill.triggers : [])
  ].map(value => String(value || '').trim()).filter(Boolean);
  const seen = new Set();
  return values.filter(value => {
    const key = normalizeLookup(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isBundled(skill) {
  return ['builtin', 'bundled'].includes(String(skill?.source || '').toLowerCase());
}

function serializeSkill(skill, relativeDir) {
  const prompt = String(skill?.prompt || '').trim();
  const aliases = normalizeAliases(skill);
  const manifest = {
    schema: STORE_SCHEMA,
    id: String(skill.id),
    name: String(skill.name || skill.id),
    aliases,
    description: String(skill.desc || ''),
    version: Number(skill.version || 1),
    source: String(skill.source || 'custom'),
    repo: String(skill.repo || ''),
    logo: String(skill.logo || ''),
    hidden: skill.hidden === true,
    userOnly: skill.userOnly === true,
    parentSkillId: String(skill.parentSkillId || ''),
    tags: Array.isArray(skill.tags) ? skill.tags : [],
    triggers: Array.isArray(skill.triggers) ? skill.triggers : [],
    requires: Array.isArray(skill.requires) ? skill.requires : [],
    installedAt: Number(skill.installedAt || 0),
    updatedAt: Number(skill.updatedAt || 0),
    entry: 'SKILL.md',
    storePath: relativeDir.replace(/\\/g, '/'),
    runtimeDirectory: String(skill.runtimeDirectory || ''),
    sha256: sha256(JSON.stringify({
      id: skill.id,
      name: skill.name,
      aliases,
      desc: skill.desc,
      version: skill.version,
      hidden: skill.hidden === true,
      userOnly: skill.userOnly === true,
      parentSkillId: skill.parentSkillId,
      prompt,
      requires: skill.requires
    }))
  };
  const searchText = [
    manifest.name,
    manifest.id,
    aliases.join(' '),
    manifest.description,
    manifest.tags.join(' '),
    manifest.triggers.join(' ')
  ].join(' ');
  return { manifest, prompt, searchText, vector: buildVector(searchText) };
}

function cleanManagedEntries(parentDir, expectedNames) {
  let names = [];
  try { names = fs.readdirSync(parentDir); } catch { return; }
  const root = path.resolve(parentDir);
  for (const name of names) {
    if (expectedNames.has(name)) continue;
    const target = path.resolve(parentDir, name);
    if (path.dirname(target) !== root || !fs.existsSync(path.join(target, ENTRY_MARKER))) continue;
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function syncSkillStoreImpl(dataDir, skills) {
  if (!dataDir) return { ok: false, error: 'SkillStore data directory is missing.' };
  const paths = ensureStore(dataDir);
  const fingerprint = sha256(JSON.stringify((skills || [])
    .map(skill => ({
      id: skill?.id,
      name: skill?.name,
      aliases: skill?.aliases,
      desc: skill?.desc,
      version: skill?.version,
      hidden: skill?.hidden === true,
      userOnly: skill?.userOnly === true,
      parentSkillId: skill?.parentSkillId,
      updatedAt: skill?.updatedAt,
      source: skill?.source,
      repo: skill?.repo,
      runtimeDirectory: skill?.runtimeDirectory,
      promptHash: sha256(skill?.prompt),
      requires: skill?.requires
    }))
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')))));
  const cached = syncCache.get(paths.root);
  if (cached?.fingerprint === fingerprint && fs.existsSync(paths.index)) {
    return { ok: true, paths, index: cached.index, cached: true };
  }
  const entries = [];
  const expected = { bundled: new Set(), installed: new Set() };

  for (const skill of skills || []) {
    const id = String(skill?.id || '').trim();
    const prompt = String(skill?.prompt || '').trim();
    if (!id || !prompt) continue;
    const bucket = isBundled(skill) ? 'bundled' : 'installed';
    const dirName = directoryNameFor(id);
    expected[bucket].add(dirName);
    const relativeDir = path.join(bucket, dirName);
    const dir = path.join(paths.root, relativeDir);
    const serialized = serializeSkill(skill, relativeDir);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(path.join(dir, ENTRY_MARKER), `${id}\n`);
    atomicWrite(path.join(dir, 'manifest.json'), `${JSON.stringify(serialized.manifest, null, 2)}\n`);
    atomicWrite(path.join(dir, 'SKILL.md'), `${serialized.prompt}\n`);
    entries.push({
      ...serialized.manifest,
      vector: serialized.vector
    });
  }

  cleanManagedEntries(paths.bundled, expected.bundled);
  cleanManagedEntries(paths.installed, expected.installed);
  entries.sort((left, right) => left.id.localeCompare(right.id));
  const index = {
    schema: STORE_SCHEMA,
    dimensions: VECTOR_DIMENSIONS,
    entries
  };
  atomicWrite(paths.index, `${JSON.stringify(index, null, 2)}\n`);
  syncCache.set(paths.root, { fingerprint, index });
  return { ok: true, paths, index };
}

function syncSkillStore(dataDir, skills) {
  try {
    return syncSkillStoreImpl(dataDir, skills);
  } catch (error) {
    return {
      ok: false,
      error: `SkillStore synchronization failed: ${String(error?.message || error)}`,
      paths: getPaths(dataDir)
    };
  }
}

function readIndex(dataDir) {
  const paths = getPaths(dataDir);
  try {
    const index = JSON.parse(fs.readFileSync(paths.index, 'utf8'));
    if (index?.schema !== STORE_SCHEMA || !Array.isArray(index.entries)) return null;
    return { paths, index };
  } catch {
    return null;
  }
}

function readStoredSkill(dataDir, entry) {
  if (!entry?.storePath) return null;
  const paths = getPaths(dataDir);
  const root = path.resolve(paths.root);
  const dir = path.resolve(paths.root, entry.storePath);
  if (dir !== root && !dir.startsWith(`${root}${path.sep}`)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const prompt = fs.readFileSync(path.join(dir, manifest.entry || 'SKILL.md'), 'utf8').trim();
    if (!prompt || manifest.id !== entry.id) return null;
    return {
      ...manifest,
      prompt,
      runtimeDirectory: String(manifest.runtimeDirectory || dir),
      storeDirectory: dir
    };
  } catch {
    return null;
  }
}

function scoreEntry(entry, query, queryVector) {
  const normalizedQuery = normalizeLookup(query);
  const normalizedName = normalizeLookup(entry.name);
  const normalizedId = normalizeLookup(entry.id);
  const aliases = (entry.aliases || []).map(normalizeLookup);
  if (normalizedQuery && (normalizedQuery === normalizedName || normalizedQuery === normalizedId || aliases.includes(normalizedQuery))) {
    return { score: 10, exact: true };
  }

  const queryTokens = new Set(tokenize(query));
  const entryTokens = new Set(tokenize([
    entry.id,
    entry.name,
    ...(entry.aliases || []),
    entry.description,
    ...(entry.tags || []),
    ...(entry.triggers || [])
  ].join(' ')));
  let overlap = 0;
  for (const token of queryTokens) if (entryTokens.has(token)) overlap++;
  const lexical = queryTokens.size ? overlap / queryTokens.size : 0;
  const vector = cosine(queryVector, entry.vector);
  return { score: vector * 0.68 + lexical * 0.32, exact: false };
}

function searchSkillStore(dataDir, query, options = {}) {
  const store = readIndex(dataDir);
  if (!store) return [];
  const limit = Math.max(1, Math.min(20, Number(options.limit || 5)));
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.18;
  const queryVector = buildVector(query);
  return store.index.entries
    .map(entry => ({ entry, ...scoreEntry(entry, query, queryVector) }))
    .filter(item => item.exact || item.score >= threshold)
    .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    .slice(0, limit)
    .map(item => ({ ...item.entry, score: Number(item.score.toFixed(5)), exact: item.exact }));
}

function resolveSkillStore(dataDir, query) {
  const match = searchSkillStore(dataDir, query, { limit: 1 })[0];
  if (!match) return null;
  const skill = readStoredSkill(dataDir, match);
  return skill ? { skill, score: match.score, exact: match.exact } : null;
}

function getStoreInfo(dataDir) {
  const store = readIndex(dataDir);
  const paths = getPaths(dataDir);
  return {
    root: paths.root,
    indexPath: paths.index,
    ready: !!store,
    schema: store?.index?.schema || STORE_SCHEMA,
    dimensions: store?.index?.dimensions || VECTOR_DIMENSIONS,
    count: store?.index?.entries?.length || 0
  };
}

module.exports = {
  STORE_SCHEMA,
  VECTOR_DIMENSIONS,
  getPaths,
  ensureStore,
  syncSkillStore,
  readIndex,
  readStoredSkill,
  searchSkillStore,
  resolveSkillStore,
  getStoreInfo,
  normalizeLookup,
  buildVector,
  cosine
};
