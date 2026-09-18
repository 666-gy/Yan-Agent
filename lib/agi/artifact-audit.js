'use strict';

// Runtime-measured completeness audit for visual deliverables. This is an
// external judge: it never trusts the model's self-report, it measures the
// produced file. Presence is not quality — it only proves the product
// dimensions exist at all, which is exactly what self-verification skips.

const fs = require('fs');
const path = require('path');

const VISUAL_EXTENSIONS = Object.freeze(['.html', '.htm', '.svg']);

const DIMENSIONS = Object.freeze([
  { id: 'identity', label: '标题与身份', requirement: '标题 + 一级标题或品牌标识' },
  { id: 'interaction', label: '交互', requirement: '至少一个可操作控件（button/input/select/role=button/可聚焦）' },
  { id: 'responsive', label: '响应式', requirement: '至少一条媒体查询' },
  { id: 'a11y-motion', label: '动效可及性', requirement: 'prefers-reduced-motion 处理' },
  { id: 'a11y-semantics', label: '语义与可及性', requirement: 'aria 标注 ≥2 处' }
]);

function isVisualArtifact(filePath) {
  return VISUAL_EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase());
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function auditArtifactContent(content) {
  const text = String(content || '');
  const hasTitle = /<title[^>]*>\s*[^<\s][^<]*<\/title>/iu.test(text);
  const hasIdentity = hasTitle && (/<h1[\s>]/iu.test(text) || /role\s*=\s*["']banner["']/iu.test(text) || /class\s*=\s*["'][^"']*brand/iu.test(text));
  const interactionCount = countMatches(text, /<button[\s>]|<input[\s>]|<select[\s>]|role\s*=\s*["']button["']|tabindex\s*=\s*["']0["']/giu);
  const mediaCount = countMatches(text, /@media/giu);
  const reducedMotion = /prefers-reduced-motion/iu.test(text);
  const ariaCount = countMatches(text, /aria-/giu);

  const dimensions = [
    {
      id: 'identity',
      ok: hasIdentity,
      evidence: hasTitle ? 'title 存在' + (hasIdentity ? '，且有一级标题或品牌标识' : '，但缺少一级标题/品牌标识') : '缺少非空 title'
    },
    {
      id: 'interaction',
      ok: interactionCount > 0,
      evidence: interactionCount > 0 ? `可操作控件 ${interactionCount} 个` : '没有可操作控件'
    },
    {
      id: 'responsive',
      ok: mediaCount > 0,
      evidence: mediaCount > 0 ? `媒体查询 ${mediaCount} 条` : '没有媒体查询'
    },
    {
      id: 'a11y-motion',
      ok: reducedMotion,
      evidence: reducedMotion ? '处理了 prefers-reduced-motion' : '没有 prefers-reduced-motion 处理'
    },
    {
      id: 'a11y-semantics',
      ok: ariaCount >= 2,
      evidence: ariaCount >= 2 ? `aria 标注 ${ariaCount} 处` : `aria 标注仅 ${ariaCount} 处`
    }
  ];
  const missing = dimensions.filter(item => !item.ok).map(item => item.id);
  return { ok: missing.length === 0, dimensions, missing };
}

function auditArtifactFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, ...auditArtifactContent(content) };
  } catch (error) {
    return { filePath, ok: false, error: error?.message || String(error), dimensions: [], missing: [] };
  }
}

function renderAuditRequirement(audit = {}) {
  const missing = Array.isArray(audit.missing) ? audit.missing : [];
  if (!missing.length) return '';
  const lines = missing.map(id => {
    const dimension = DIMENSIONS.find(item => item.id === id);
    const evidence = (audit.dimensions || []).find(item => item.id === id)?.evidence || '';
    return `- ${dimension ? dimension.label : id}: ${dimension ? dimension.requirement : ''}${evidence ? `（实测：${evidence}）` : ''}`;
  });
  return [
    'AGI visual deliverable audit (runtime-measured, not self-reported). Missing dimensions:',
    ...lines
  ].join('\n');
}

module.exports = {
  DIMENSIONS,
  VISUAL_EXTENSIONS,
  auditArtifactContent,
  auditArtifactFile,
  isVisualArtifact,
  renderAuditRequirement
};
