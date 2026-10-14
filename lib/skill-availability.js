'use strict';

const { normalizeId } = require('./skill-ids');
const { normalizeLookup } = require('./skill-store');

// The management inventory stays complete. Apply this policy at every model
// boundary, including reads from a previously populated per-task cache.
function skillAvailability(config = {}, skills = []) {
  const disabled = new Set((Array.isArray(config.disabledSkills) ? config.disabledSkills : []).map(normalizeId));
  const byId = new Map(skills.map(skill => [normalizeId(skill.id), skill]));
  const aliases = new Map();
  for (const skill of skills) {
    for (const alias of [skill.id, skill.name, ...(skill.aliases || [])]) {
      const key = normalizeLookup(alias);
      if (key && !aliases.has(key)) aliases.set(key, skill);
    }
  }
  function resolve(value) {
    const id = normalizeId(typeof value === 'object' ? value?.id : value);
    return byId.get(id) || aliases.get(normalizeLookup(id)) || byId.get(id.split('/').pop());
  }
  return value => {
    let skill = resolve(value);
    const visited = new Set();
    if (!skill) return !disabled.has(normalizeId(value));
    while (skill) {
      const id = normalizeId(skill.id);
      if (skill.pluginEnabled === false || disabled.has(id) || visited.has(id)) return false;
      visited.add(id);
      const parent = normalizeId(skill.parentSkillId);
      if (parent && disabled.has(parent)) return false;
      skill = parent ? byId.get(parent) : null;
    }
    return true;
  };
}

module.exports = { skillAvailability };
