'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createTwoFilesPatch } = require('diff');

require('../renderer/vendor/dsh-code-review/core.js');
const core = globalThis.DshCodeReviewCore;

test('dsh-code-review core exposes the upstream pure pipeline', () => {
  for (const key of ['parseGitDiff', 'isDiffText', 'countStats', 'buildStandaloneHtml', 'buildCommentReport', 'CR_TEXTS', 'THEME_VARS', 'rawDiffFromSummary', 'applyEmbeddingCompat', 'sanitizeComments']) {
    assert.ok(core[key] != null, `${key} exported`);
  }
  assert.ok(core.THEME_VARS.includes('--dsw-alias-label-primary'));
});

test('rawDiffFromSummary feeds real two-file patches through the upstream parser', () => {
  const before = 'const a = 1;\nconst b = 2;\n';
  const after = 'const a = 0;\nconst b = 2;\nconst c = 3;\n';
  const patch = createTwoFilesPatch('a/src/app.js', 'b/src/app.js', before, after);
  const rawText = core.rawDiffFromSummary({
    files: [{ path: 'src/app.js', status: 'modified', additions: 2, deletions: 1, patch }]
  });
  const files = core.parseGitDiff(rawText);
  assert.equal(files.length, 1);
  assert.equal(files[0].newPath, 'b/src/app.js');
  const kinds = files[0].rows.map(row => row.kind);
  assert.ok(kinds.includes('change'));
  assert.ok(kinds.includes('add'));
  const stats = core.countStats(files);
  assert.deepEqual(stats, { added: 2, removed: 1, files: 1 });
});

test('rawDiffFromSummary reconstructs hunks from the Yan row model', () => {
  const rawText = core.rawDiffFromSummary({
    files: [{
      path: 'src/rows.js',
      status: 'modified',
      diff: {
        rows: [
          { type: 'context', oldLine: 1, newLine: 1, text: 'const keep = true;' },
          { type: 'del', oldLine: 2, text: 'const gone = 1;' },
          { type: 'add', newLine: 2, text: 'const here = 1;' },
          { type: 'skip', count: 40 },
          { type: 'add', newLine: 43, text: 'const tail = 1;' }
        ]
      }
    }]
  });
  const files = core.parseGitDiff(rawText);
  assert.equal(files.length, 1);
  const kinds = files[0].rows.filter(row => row.kind !== 'gap').map(row => row.kind);
  assert.deepEqual(kinds, ['ctx', 'change', 'add']);
  const gapCount = files[0].rows.filter(row => row.kind === 'gap').length;
  assert.equal(gapCount, 2, 'skip rows split the content into two hunks');
});

test('rawDiffFromSummary keeps patches that already carry a git header intact', () => {
  const lines = [
    'diff --git a/src/app.js b/src/app.js',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,2 +1,3 @@',
    '-const a = 1;',
    '+const a = 0;',
    ' const b = 2;',
    '+const c = 3;'
  ];
  const rawText = core.rawDiffFromSummary({
    files: [{ path: 'src/app.js', status: 'modified', additions: 2, deletions: 1, patch: lines.join('\n') }]
  });
  assert.equal((rawText.match(/diff --git /g) || []).length, 1);
  const files = core.parseGitDiff(rawText);
  assert.equal(files.length, 1);
  assert.equal(files[0].rows.length, 4);
});

test('rawDiffFromSummary marks binary, added and renamed files for upstream badges', () => {
  const rawText = core.rawDiffFromSummary({
    files: [
      { path: 'assets/logo.bin', status: 'modified', binary: true },
      { path: 'src/new.js', status: 'added', additions: 1, diff: { rows: [{ type: 'add', newLine: 1, text: 'const n = 1;' }] } },
      { path: 'src/renamed.js', status: 'renamed', oldPath: 'src/old.js', newPath: 'src/renamed.js' }
    ]
  });
  const files = core.parseGitDiff(rawText);
  assert.equal(files.length, 3);
  assert.equal(files[0].status, 'binary');
  assert.equal(files[1].status, 'added');
  assert.equal(files[2].status, 'renamed');
});

test('applyEmbeddingCompat redirects opener plumbing to the embedding frame', () => {
  const files = core.parseGitDiff('diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n');
  const html = core.buildStandaloneHtml(files, {}, 'raw', 'zh');
  assert.equal((html.match(/window\.opener/g) || []).length, 2);
  const { html: patched, applied } = core.applyEmbeddingCompat(html);
  assert.deepEqual(applied, [true, true]);
  assert.equal((patched.match(/window\.opener/g) || []).length, 2);
  assert.ok(patched.includes('window.parent !== window ? window.parent : null'));
  assert.ok(patched.includes('event.source !== (window.opener || window.parent)'));
  const rendered = core.buildStandaloneHtml(files, { '--dsw-alias-bg-base': '#101010' }, 'raw', 'zh');
  assert.ok(rendered.includes('--dsw-alias-bg-base: #101010;'));
});

test('sanitizeComments mirrors the upstream shape validation', () => {
  assert.deepEqual(core.sanitizeComments([
    { path: 'a.js', lineNo: 3.7, text: ' ok ' },
    { path: 'b.js', lineNo: 1, text: '   ' },
    { path: 'c.js', lineNo: '2', text: 'nope' },
    { lineNo: 1, text: 'no path' },
    'junk'
  ]), [{ path: 'a.js', lineNo: 3, side: undefined, text: ' ok ' }]);
});
