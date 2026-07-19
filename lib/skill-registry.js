/**
 * Yan Agent — Skill registry (main process)
 * Builtin + market catalog + custom installs + GitHub sync + auto-install gate
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_SYNC_URL =
  'https://raw.githubusercontent.com/YanxiCode/yan-agent-skills/main/market.json';
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let bundledBuiltin = null;
let bundledMarket = null;
let syncTimer = null;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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

function marketCachePath(dataDir) {
  return path.join(dataDir, 'skill-market-cache.json');
}

function loadMarketCatalog(appRoot, dataDir) {
  const bundled = loadBundled(appRoot).market;
  const cacheFile = marketCachePath(dataDir);
  if (!fs.existsSync(cacheFile)) return bundled;
  try {
    const cached = readJson(cacheFile);
    if (!cached?.skills?.length) return bundled;
    return mergeMarketCatalogs(bundled, cached);
  } catch {
    return bundled;
  }
}

function mergeMarketCatalogs(base, remote) {
  const map = new Map();
  for (const s of base.skills || []) map.set(s.id, { ...s });
  for (const s of remote.skills || []) {
    const prev = map.get(s.id);
    if (!prev || (s.version || 0) >= (prev.version || 0) || (s.updatedAt || 0) > (prev.updatedAt || 0)) {
      map.set(s.id, { ...prev, ...s });
    }
  }
  return {
    version: Math.max(base.version || 1, remote.version || 1),
    updatedAt: Date.now(),
    skills: [...map.values()]
  };
}

function getBuiltinSkills(appRoot) {
  return loadBundled(appRoot).builtin.skills || [];
}

function normalizeId(id) {
  return String(id || '').trim().toLowerCase();
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

function isBuiltin(id, appRoot) {
  return !!findById(getBuiltinSkills(appRoot), id);
}

function getInstalledSkills(cfg, appRoot) {
  const builtin = getBuiltinSkills(appRoot).map(s => ({
    ...s,
    source: 'builtin',
    installed: true
  }));
  const custom = (cfg.customSkills || []).map(s => ({
    ...s,
    installed: true
  }));
  const ids = new Set(builtin.map(s => s.id));
  const merged = [...builtin];
  for (const s of custom) {
    if (s?.id && !ids.has(s.id)) {
      merged.push(s);
      ids.add(s.id);
    }
  }
  return merged;
}

function getMarketSkills(appRoot, dataDir) {
  return loadMarketCatalog(appRoot, dataDir).skills || [];
}

function getSkillCatalog(cfg, appRoot, dataDir) {
  const installed = getInstalledSkills(cfg, appRoot);
  const market = getMarketSkills(appRoot, dataDir);
  const installedIds = new Set(installed.map(s => s.id));
  return {
    installed,
    market: market.map(s => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      tags: s.tags || [],
      triggers: s.triggers || [],
      repo: s.repo,
      installed: installedIds.has(s.id)
    }))
  };
}

function resolveSkill(skillId, cfg, appRoot, dataDir, { allowFuzzy = true } = {}) {
  const installed = getInstalledSkills(cfg, appRoot);
  let hit = findById(installed, skillId);
  if (hit) return { skill: hit, source: hit.source || 'installed', installed: true };

  const market = getMarketSkills(appRoot, dataDir);
  hit = findById(market, skillId);
  if (hit) return { skill: hit, source: 'market', installed: false };

  if (allowFuzzy) {
    hit = findByFuzzy([...installed, ...market], skillId);
    if (hit) {
      const isInst = !!findById(installed, hit.id);
      return { skill: hit, source: isInst ? 'installed' : 'market', installed: isInst, fuzzy: true };
    }
  }
  return null;
}

function installFromMarket(skill, cfg, saveConfig) {
  if (!cfg.customSkills) cfg.customSkills = [];
  const item = {
    id: skill.id,
    name: skill.name,
    desc: skill.desc,
    prompt: skill.prompt,
    tags: skill.tags || [],
    triggers: skill.triggers || [],
    source: skill.repo || 'market',
    version: skill.version || 1,
    installedAt: Date.now(),
    updatedAt: skill.updatedAt || Date.now()
  };
  const idx = cfg.customSkills.findIndex(s => s.id === item.id);
  if (idx >= 0) cfg.customSkills[idx] = { ...cfg.customSkills[idx], ...item };
  else cfg.customSkills.push(item);
  saveConfig(cfg);
  return item;
}

function ensureSkill(skillId, cfg, appRoot, dataDir, saveConfig) {
  const resolved = resolveSkill(skillId, cfg, appRoot, dataDir);
  if (!resolved) {
    return { error: `Skill not found: ${skillId}`, suggestions: suggestSkills(skillId, cfg, appRoot, dataDir) };
  }
  if (resolved.installed) {
    return { ok: true, skill: resolved.skill, autoInstalled: false, fuzzy: !!resolved.fuzzy };
  }
  if (isBuiltin(resolved.skill.id, appRoot)) {
    return { ok: true, skill: resolved.skill, autoInstalled: false };
  }
  const installed = installFromMarket(resolved.skill, cfg, saveConfig);
  return {
    ok: true,
    skill: installed,
    autoInstalled: true,
    fuzzy: !!resolved.fuzzy,
    message: `已从 Skill 目录安装「${installed.name}」`
  };
}

function suggestSkills(query, cfg, appRoot, dataDir, limit = 5) {
  const all = [...getInstalledSkills(cfg, appRoot), ...getMarketSkills(appRoot, dataDir)];
  const q = String(query || '').toLowerCase();
  return all
    .map(s => {
      const hay = `${s.id} ${s.name} ${s.desc}`.toLowerCase();
      let score = hay.includes(q) ? 10 : 0;
      for (const t of s.triggers || []) {
        if (q.includes(String(t).toLowerCase())) score += 3;
      }
      return { s, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => ({ id: x.s.id, name: x.s.name, desc: x.s.desc }));
}

function readSkill(skillId, taskContext, cfg, appRoot, dataDir, saveConfig) {
  const gate = ensureSkill(skillId, cfg, appRoot, dataDir, saveConfig);
  if (gate.error) return gate;
  const skill = gate.skill;
  let prompt = String(skill.prompt || '').trim();
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
    desc: skill.desc,
    tags: skill.tags || [],
    prompt,
    autoInstalled: gate.autoInstalled,
    fuzzy: gate.fuzzy,
    message: gate.message || null
  };
}

function formatCatalogForPrompt(cfg, appRoot, dataDir) {
  const { installed, market } = getSkillCatalog(cfg, appRoot, dataDir);
  const lines = [];
  lines.push('### Installed (builtin + custom)');
  for (const s of installed) {
    lines.push(`- ${s.id}: ${s.name} — ${s.desc}`);
  }
  const notInstalled = market.filter(m => !m.installed).slice(0, 40);
  if (notInstalled.length) {
    lines.push('### Market (call read_skill to load; auto-installs if missing)');
    for (const s of notInstalled) {
      lines.push(`- ${s.id}: ${s.name} — ${s.desc}`);
    }
  }
  return lines.join('\n');
}

function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function syncMarketFromGitHub(cfg, appRoot, dataDir, saveConfig, opts = {}) {
  const url = opts.url || cfg.skillsSyncUrl || DEFAULT_SYNC_URL;
  const result = { ok: false, url, added: 0, updated: 0, total: 0, error: null };
  try {
    const body = await fetchUrl(url);
    const remote = JSON.parse(body);
    if (!Array.isArray(remote.skills) || !remote.skills.length) {
      throw new Error('Remote catalog has no skills array');
    }
    const bundled = loadBundled(appRoot).market;
    const before = new Map((loadMarketCatalog(appRoot, dataDir).skills || []).map(s => [s.id, s]));
    const merged = mergeMarketCatalogs(bundled, remote);
    for (const s of remote.skills) {
      const prev = before.get(s.id);
      if (!prev) result.added++;
      else if ((s.version || 0) > (prev.version || 0) || (s.updatedAt || 0) > (prev.updatedAt || 0)) result.updated++;
    }
    writeJson(marketCachePath(dataDir), merged);
    result.total = merged.skills.length;
    result.ok = true;
    result.syncedAt = Date.now();

    cfg.skillsLastSyncAt = result.syncedAt;
    cfg.skillsLastSyncUrl = url;
    saveConfig(cfg);

    // Update installed market skills if remote has newer version
    let customUpdated = 0;
    for (const remoteSkill of remote.skills) {
      const idx = (cfg.customSkills || []).findIndex(c => c.id === remoteSkill.id);
      if (idx < 0) continue;
      const local = cfg.customSkills[idx];
      if ((remoteSkill.version || 0) > (local.version || 0) || (remoteSkill.updatedAt || 0) > (local.updatedAt || 0)) {
        cfg.customSkills[idx] = {
          ...local,
          name: remoteSkill.name || local.name,
          desc: remoteSkill.desc || local.desc,
          prompt: remoteSkill.prompt || local.prompt,
          tags: remoteSkill.tags || local.tags,
          version: remoteSkill.version || local.version,
          updatedAt: remoteSkill.updatedAt || Date.now()
        };
        customUpdated++;
      }
    }
    if (customUpdated) saveConfig(cfg);
    result.customUpdated = customUpdated;
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

function scheduleSkillSync(cfg, appRoot, dataDir, saveConfig, onResult) {
  if (syncTimer) clearInterval(syncTimer);
  const run = async () => {
    const res = await syncMarketFromGitHub(cfg, appRoot, dataDir, saveConfig);
    if (onResult) onResult(res);
  };
  const last = cfg.skillsLastSyncAt || 0;
  if (Date.now() - last > SYNC_INTERVAL_MS) {
    setTimeout(run, 5000);
  }
  syncTimer = setInterval(run, SYNC_INTERVAL_MS);
}

function stopSkillSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

function getMergedSkillsForList(cfg, appRoot) {
  return getInstalledSkills(cfg, appRoot).map(s => ({
    id: s.id,
    name: s.name,
    desc: s.desc,
    prompt: s.prompt || undefined,
    tags: s.tags,
    source: s.source
  }));
}

module.exports = {
  DEFAULT_SYNC_URL,
  SYNC_INTERVAL_MS,
  getBuiltinSkills,
  getInstalledSkills,
  getMarketSkills,
  getSkillCatalog,
  getMergedSkillsForList,
  resolveSkill,
  ensureSkill,
  readSkill,
  suggestSkills,
  formatCatalogForPrompt,
  syncMarketFromGitHub,
  scheduleSkillSync,
  stopSkillSync,
  loadMarketCatalog
};
