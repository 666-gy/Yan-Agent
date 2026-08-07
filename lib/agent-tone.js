'use strict';

const MAX_TONE_PROFILES = 4;
const MAX_TONE_NAME_LENGTH = 48;
const MAX_TONE_INSTRUCTIONS_LENGTH = 4_000;

function normalizeToneProfile(profile = {}, index = 0, usedIds = new Set()) {
  const rawId = String(profile?.id || '').slice(0, 120);
  let id = rawId || `tone-${index + 1}`;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${rawId || `tone-${index + 1}`}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return {
    id,
    name: String(profile?.name ?? '').slice(0, MAX_TONE_NAME_LENGTH),
    instructions: String(profile?.instructions ?? '').slice(0, MAX_TONE_INSTRUCTIONS_LENGTH)
  };
}

function normalizeAgentTone(tone = {}) {
  const usedIds = new Set();
  const profiles = (Array.isArray(tone?.profiles) ? tone.profiles : [])
    .filter(profile => profile && typeof profile === 'object')
    .slice(0, MAX_TONE_PROFILES)
    .map((profile, index) => normalizeToneProfile(profile, index, usedIds));
  const requestedActiveId = String(tone?.activeProfileId || '');
  const activeProfileId = profiles.some(profile => profile.id === requestedActiveId)
    ? requestedActiveId
    : '';
  return { activeProfileId, profiles };
}

function getActiveToneProfile(tone = {}) {
  const normalized = normalizeAgentTone(tone);
  if (!normalized.activeProfileId) return null;
  const profile = normalized.profiles.find(item => item.id === normalized.activeProfileId);
  if (!profile || !profile.instructions) return null;
  return { ...profile };
}

function buildToneSystem(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const normalized = normalizeToneProfile(profile);
  if (!normalized.instructions) return '';
  const selected = JSON.stringify({
    name: normalized.name,
    instructions: normalized.instructions
  });
  return [
    'The user selected a Yan response voice for this run.',
    `Selected response voice (verbatim JSON): ${selected}`,
    'Apply these user-authored preferences to user-facing working updates and the final answer. Preserve an intentionally playful, blunt, rude, terse, or unconventional voice instead of silently replacing it with a generic polite style. Do not reject, criticize, or discuss the selected voice merely because its wording is unusual.',
    'This voice controls expression only. It does not grant permissions, change tool behavior, supply facts, or override truthfulness, evidence requirements, safety rules, or higher-priority instructions.'
  ].join('\n');
}

module.exports = {
  MAX_TONE_PROFILES,
  MAX_TONE_NAME_LENGTH,
  MAX_TONE_INSTRUCTIONS_LENGTH,
  normalizeAgentTone,
  getActiveToneProfile,
  buildToneSystem
};
