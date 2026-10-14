'use strict';

// Skill logo resolution.
//
// Extracted from `skill-registry.js` (which sits at its architecture budget) and
// split out so the two lookup tables -- explicit ids and repo/source needles --
// stay next to the rule that consults them, in the order they are consulted:
// explicit id first, then an explicit `logo` path the manifest already carries,
// then the repo/source needle, then the generic fallback.

const { normalizeId } = require('./skill-ids');

const SKILL_LOGO_ROOT = 'assets/skill-logos/';
const SKILL_LOGO_FALLBACK = `${SKILL_LOGO_ROOT}github.png`;

const SKILL_LOGOS_BY_ID = Object.freeze({
  'yan-prompt-optimizer': `${SKILL_LOGO_ROOT}prompt-optimizer.svg`,
  'yan-uiverse': `${SKILL_LOGO_ROOT}uiverse.png`,
  'code-simplifier': `${SKILL_LOGO_ROOT}anthropic.png`,
  officecli: `${SKILL_LOGO_ROOT}officecli.png`,
  'market-anysearch': `${SKILL_LOGO_ROOT}anysearch.png`,
  hyperframes: `${SKILL_LOGO_ROOT}hyperframes.png`,
  'remotion-best-practices': `${SKILL_LOGO_ROOT}remotion.png`
});

const SKILL_LOGOS_BY_SOURCE = Object.freeze([
  ['anthropics', 'anthropic.png'],
  ['snyk', 'snyk.png'],
  ['anysearch-ai/', 'anysearch.png'],
  ['iofficeai/', 'officecli.png'],
  ['officecli.ai', 'officecli.png'],
  ['uiverse-io/', 'uiverse.png']
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

module.exports = { SKILL_LOGO_ROOT, SKILL_LOGO_FALLBACK, resolveSkillLogo, withSkillLogo };
