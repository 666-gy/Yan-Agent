'use strict';

function createSkillModelAccess({ readConfig, getRegistry, appRoot, dataDir, skillsRoot, loadedSkillState, skillLoadState }) {
  async function assertSkillAvailable(id, taskId, config) {
    const current = config || await readConfig(taskId);
    if (!getRegistry().isSkillEnabled(id, current, appRoot, dataDir)) {
      loadedSkillState.delete(`${taskId}:${id}`);
      skillLoadState.delete(`${taskId}:${id}`);
      throw new Error('未找到可用的 Skill。');
    }
  }

  async function listInstalledSkills(taskId) {
    const config = await readConfig(taskId);
    const installed = getRegistry().getMergedSkillsForList(config, appRoot, dataDir)
      .filter(skill => !skill.userOnly);
    return {
      ok: true,
      root: skillsRoot,
      count: installed.length,
      skills: installed.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.desc || '',
        aliases: Array.isArray(skill.aliases) ? skill.aliases : [],
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        requires: Array.isArray(skill.requires) ? skill.requires : [],
        source: skill.source || 'installed'
      }))
    };
  }

  return { assertSkillAvailable, listInstalledSkills };
}

module.exports = { createSkillModelAccess };
