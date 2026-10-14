'use strict';

// Skill manifest reading and failure reporting.
//
// Extracted from skill-registry.js so that module stays inside its architecture
// budget, and shared by every load source (builtin/market/retired catalogs,
// Yan-local `.yan-skill.json`, project `.yan-source.json`, bundled manifests)
// so a broken file is diagnosable from one trace format instead of vanishing.

const fs = require('fs');

// A manifest that fails to parse used to disappear silently: the Skill simply
// was not in the list and nothing in the logs said why. Callers still degrade
// the same way (skip the entry); the difference is the failure is observable.
// A missing file is not reported -- that is the normal "not installed" case.
function reportManifestFailure(source, filePath, error) {
  if (error?.code === 'ENOENT') return;
  const message = String(error?.message || error || 'unknown error');
  console.warn(`[skills] ${source} manifest unusable (${filePath}): ${message}`);
}

function readManifestJson(source, filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    reportManifestFailure(source, filePath, error);
    return null;
  }
}

// A manifest that read fine but yields no usable Skill -- also worth a trace,
// since the entry is dropped rather than loaded.
function reportSkillSkipped(source, filePath, reason) {
  console.warn(`[skills] ${source} Skill skipped (${filePath}): ${reason}`);
}

function readManifestObject(source, filePath) {
  const parsed = readManifestJson(source, filePath);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

module.exports = { reportManifestFailure, reportSkillSkipped, readManifestJson, readManifestObject };
