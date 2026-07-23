/**
 * Yan Agent — Skill registry (main process)
 * Builtin + market catalog + explicit custom installs
 */
const fs = require('fs');
const path = require('path');

let bundledBuiltin = null;
let bundledMarket = null;

const SKILL_LOGO_ROOT = 'assets/skill-logos/';
const SKILL_LOGO_FALLBACK = `${SKILL_LOGO_ROOT}github.png`;
const SKILL_LOGOS_BY_ID = Object.freeze({
  'yan-react-bits': `${SKILL_LOGO_ROOT}react-bits.png`,
  'yan-uiverse': `${SKILL_LOGO_ROOT}uiverse.png`,
  'code-simplifier': `${SKILL_LOGO_ROOT}anthropic.png`,
  cubesandbox: `${SKILL_LOGO_ROOT}tencentcloud.png`,
  officecli: `${SKILL_LOGO_ROOT}officecli.png`,
  'yan-computer-use': `${SKILL_LOGO_ROOT}computer-use.png`,
  'market-anysearch': `${SKILL_LOGO_ROOT}anysearch.png`
});

const SKILL_LOGOS_BY_SOURCE = Object.freeze([
  ['anthropics', 'anthropic.png'],
  ['snyk', 'snyk.png'],
  ['anysearch-ai/', 'anysearch.png'],
  ['tencentcloud/', 'tencentcloud.png'],
  ['iofficeai/', 'officecli.png'],
  ['officecli.ai', 'officecli.png'],
  ['uiverse-io/', 'uiverse.png'],
  ['davidhdev/react-bits', 'react-bits.png']
]);

function resolveSkillLogo(skill = {}) {
  const id = normalizeId(skill.id);
  if (SKILL_LOGOS_BY_ID[id]) return SKILL_LOGOS_BY_ID[id];

  const explicit = String(skill.logo || '').trim();
  if (/^assets\/skill-logos\/[a-z0-9._-]+$/i.test(explicit)) return explicit;

  const source = `${skill.repo || ''} ${skill.source || ''}`.toLowerCase();
  const match = SKILL_LOGOS_BY_SOURCE.find(([needle]) => source.includes(needle));
  return match ? `${SKILL_LOGO_ROOT}${match[1]}` : SKILL_LOGO_FALLBACK;
}

function withSkillLogo(skill) {
  return {
    ...skill,
    tags: normalizeId(skill.id) === 'yan-computer-use' ? [] : (skill.tags || []),
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

function getInstalledSkills(cfg, appRoot) {
  const builtin = getBuiltinSkills(appRoot).map(s => ({
    ...s,
    source: 'builtin',
    installed: true
  }));
  const custom = (cfg.customSkills || []).map(s => ({
    ...withSkillLogo(s),
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
  return (loadMarketCatalog(appRoot, dataDir).skills || []).map(withSkillLogo);
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
      logo: resolveSkillLogo(s),
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

function suggestSkills(query, cfg, appRoot, dataDir, limit = 5) {
  const all = getInstalledSkills(cfg, appRoot);
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
  const installed = getInstalledSkills(cfg, appRoot);
  let skill = findById(installed, skillId);
  let fuzzy = false;
  if (!skill) {
    const marketMatch = findById(getMarketSkills(appRoot, dataDir), skillId);
    if (marketMatch) {
      return {
        error: `Skill 未安装，请先在 Skill 市场安装：${marketMatch.id}`,
        suggestions: suggestSkills(skillId, cfg, appRoot, dataDir)
      };
    }
    skill = findByFuzzy(installed, skillId);
    fuzzy = !!skill;
  }
  if (!skill) {
    return {
      error: `已安装的 Skill 中未找到：${skillId}`,
      suggestions: suggestSkills(skillId, cfg, appRoot, dataDir)
    };
  }
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
    fuzzy
  };
}

function formatCatalogForPrompt(cfg, appRoot, dataDir) {
  const installed = getInstalledSkills(cfg, appRoot);
  const lines = ['### Installed (builtin + custom)'];
  for (const s of installed) {
    lines.push(`- ${s.id}: ${s.name} — ${s.desc}`);
  }
  return lines.join('\n');
}

function getMergedSkillsForList(cfg, appRoot) {
  return getInstalledSkills(cfg, appRoot).map(s => ({
    id: s.id,
    name: s.name,
    desc: s.desc,
    prompt: s.prompt || undefined,
    tags: s.tags,
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
  resolveSkill,
  readSkill,
  suggestSkills,
  formatCatalogForPrompt,
  loadMarketCatalog,
  resolveSkillLogo
};
