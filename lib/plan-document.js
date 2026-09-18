'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stripProtocolBlocks } = require('./delivery-contract');
const { stripTaggedThinkingBlocks } = require('./thinking-text');

const PLAN_DIRECTORY_NAME = 'plans';

function plansRoot(dataDir) {
  return path.join(String(dataDir || ''), PLAN_DIRECTORY_NAME);
}

function planTitleFromText(text) {
  const source = String(text || '');
  const heading = source.match(/^\s{0,3}#{1,4}\s+(.+?)\s*$/mu);
  const line = heading
    ? heading[1]
    : (source.split(/\r?\n/u).map(item => item.trim()).find(Boolean) || '');
  return line
    .replace(/[*_`>#]/gu, '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 40);
}

function buildPlanDocumentName(title) {
  const base = String(title || '').trim() || '计划';
  return base.endsWith('计划') ? `${base}.md` : `${base}计划.md`;
}

function normalizeComparisonText(value) {
  return String(value || '').replace(/\s+/gu, '');
}

// A model can repeat its reasoning as visible prose; when the opening
// paragraph is an exact (whitespace-normalized) run inside the run's reasoning
// text, treat it as leaked thinking and drop it. The length floors keep normal
// short openings from ever matching.
function stripLeakedReasoningPrefix(text, reasoning) {
  let source = String(text || '');
  const reasoningNorm = normalizeComparisonText(reasoning);
  if (reasoningNorm.length < 24) return source;
  for (let guard = 0; guard < 3; guard += 1) {
    const separator = source.match(/\n\s*\n/u);
    const paragraph = separator ? source.slice(0, separator.index) : source;
    const paragraphNorm = normalizeComparisonText(paragraph);
    if (paragraphNorm.length < 24) return source;
    const matched = reasoningNorm.startsWith(paragraphNorm)
      || (paragraphNorm.length >= 40 && reasoningNorm.includes(paragraphNorm));
    if (!matched) return source;
    source = separator ? source.slice(separator.index + separator[0].length) : '';
  }
  return source;
}

function sanitizePlanDocumentText(text, reasoning = '') {
  const withoutProtocols = stripProtocolBlocks(String(text || ''));
  const withoutThinking = stripTaggedThinkingBlocks(withoutProtocols);
  return stripLeakedReasoningPrefix(withoutThinking, reasoning).trim();
}

function writePlanDocument({ dataDir, text, reasoning = '', now = Date.now() } = {}) {
  const content = sanitizePlanDocumentText(text, reasoning);
  if (!content) return null;
  const root = plansRoot(dataDir);
  fs.mkdirSync(root, { recursive: true });
  const baseName = buildPlanDocumentName(planTitleFromText(content));
  let name = baseName;
  for (let index = 2; fs.existsSync(path.join(root, name)); index += 1) {
    name = baseName.replace(/\.md$/u, `-${index}.md`);
  }
  const target = path.join(root, name);
  fs.writeFileSync(target, `${content}\n`, 'utf8');
  return { name, path: target, createdAt: Number(now) || Date.now() };
}

module.exports = {
  plansRoot,
  planTitleFromText,
  buildPlanDocumentName,
  sanitizePlanDocumentText,
  stripLeakedReasoningPrefix,
  writePlanDocument
};
