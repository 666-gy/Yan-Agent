'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DIMENSIONS,
  auditArtifactContent,
  auditArtifactFile,
  isVisualArtifact,
  renderAuditRequirement
} = require('../lib/agi/artifact-audit');

const FULL_HTML = [
  '<!DOCTYPE html><html><head><title>鹈鹕兜风</title>',
  '<style>@media (max-width:600px){body{margin:0}}@media print{body{}}</style></head>',
  '<body><h1>骑慢一点</h1><button id="play">暂停</button>',
  '<p aria-live="polite" aria-label="状态">正在兜风</p>',
  '<script>if (matchMedia("(prefers-reduced-motion: reduce)").matches) {}</script>',
  '</body></html>'
].join('');

const MINIMAL_HTML = '<!DOCTYPE html><html><head><title>P</title></head><body><svg><circle r="1"/></svg></body></html>';

test('isVisualArtifact only accepts html/htm/svg', () => {
  assert.equal(isVisualArtifact('a/index.html'), true);
  assert.equal(isVisualArtifact('a/page.HTM'), true);
  assert.equal(isVisualArtifact('a/icon.svg'), true);
  assert.equal(isVisualArtifact('a/main.js'), false);
  assert.equal(isVisualArtifact(''), false);
});

test('a complete artifact passes every measured dimension', () => {
  const audit = auditArtifactContent(FULL_HTML);
  assert.equal(audit.ok, true, JSON.stringify(audit.dimensions));
  assert.deepEqual(audit.missing, []);
  assert.equal(audit.dimensions.length, DIMENSIONS.length);
});

test('a minimal artifact reports every missing dimension with evidence', () => {
  const audit = auditArtifactContent(MINIMAL_HTML);
  assert.equal(audit.ok, false);
  assert.deepEqual(
    [...audit.missing].sort(),
    ['a11y-motion', 'a11y-semantics', 'identity', 'interaction', 'responsive'].sort()
  );
  for (const dimension of audit.dimensions) {
    assert.ok(dimension.evidence, `missing evidence for ${dimension.id}`);
  }
});

test('identity needs both a title and a heading or brand mark', () => {
  const audit = auditArtifactContent('<html><head><title>x</title></head><body><p>only text</p></body></html>');
  const identity = audit.dimensions.find(item => item.id === 'identity');
  assert.equal(identity.ok, false);
  assert.match(identity.evidence, /缺少一级标题/);
});

test('interaction counts controls, not decorative elements', () => {
  const audit = auditArtifactContent('<html><head><title>x</title></head><body><h1>x</h1><div class="btn"></div></body></html>');
  assert.equal(audit.dimensions.find(item => item.id === 'interaction').ok, false);
  const withRole = auditArtifactContent('<html><head><title>x</title></head><body><h1>x</h1><div role="button" tabindex="0">go</div></body></html>');
  assert.equal(withRole.dimensions.find(item => item.id === 'interaction').ok, true);
});

test('auditArtifactFile reads from disk and survives missing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-audit-'));
  try {
    const file = path.join(dir, 'page.html');
    fs.writeFileSync(file, FULL_HTML, 'utf8');
    const audit = auditArtifactFile(file);
    assert.equal(audit.ok, true, JSON.stringify(audit));
    assert.equal(audit.filePath, file);

    const missing = auditArtifactFile(path.join(dir, 'nope.html'));
    assert.equal(missing.ok, false);
    assert.ok(missing.error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderAuditRequirement lists only the missing dimensions', () => {
  const audit = auditArtifactContent(FULL_HTML.replace('<button id="play">暂停</button>', ''));
  const text = renderAuditRequirement(audit);
  assert.match(text, /runtime-measured/);
  assert.match(text, /交互/);
  assert.doesNotMatch(text, /响应式/);
  assert.equal(renderAuditRequirement({ missing: [] }), '');
});
