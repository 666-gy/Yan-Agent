'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTwoFilesPatch } = require('diff');
const {
  buildPatchRows,
  buildRollbackChanges,
  collectWorkspaceFileSweep,
  filterReviewSummary,
  summarizeOpenCodeDiffs,
  summarizeOpenCodeToolChanges,
  summarizeRunChanges
} = require('../lib/run-change-summary');

const patch = [
  'Index: src/app.js',
  '===================================================================',
  '--- src/app.js',
  '+++ src/app.js',
  '@@ -1,3 +1,4 @@',
  ' const title = "Yan";',
  '-const state = "old";',
  '+const state = "live";',
  '+const review = true;',
  ' export { title, state };',
  ''
].join('\n');

async function mkdtempWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}

test('converts an OpenCode unified patch into review rows', () => {
  const result = buildPatchRows(patch);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows.map(row => ({
    type: row.type,
    oldLine: row.oldLine,
    newLine: row.newLine,
    text: row.text
  })), [
    { type: 'context', oldLine: 1, newLine: 1, text: 'const title = "Yan";' },
    { type: 'del', oldLine: 2, newLine: null, text: 'const state = "old";' },
    { type: 'add', oldLine: null, newLine: 2, text: 'const state = "live";' },
    { type: 'add', oldLine: null, newLine: 3, text: 'const review = true;' },
    { type: 'context', oldLine: 3, newLine: 4, text: 'export { title, state };' }
  ]);
});

test('normalizes OpenCode live diffs for the review panel', () => {
  const result = summarizeOpenCodeDiffs('C:\\workspace', [{
    file: 'src/app.js',
    patch,
    additions: 2,
    deletions: 1,
    status: 'added'
  }], { includeDiff: true });

  assert.equal(result.count, 1);
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 1);
  assert.equal(result.files[0].path, 'src/app.js');
  assert.equal(result.files[0].status, 'created');
  assert.equal(result.files[0].diff.rows.length, 5);
});

test('drops binary files from OpenCode review while preserving text changes', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-binary-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const binaryPath = path.join(workspace, 'capture.asset');
  await fs.writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]));

  const summary = summarizeOpenCodeDiffs(workspace, [{
    file: binaryPath,
    additions: 4,
    deletions: 0,
    status: 'added'
  }, {
    file: 'src/app.js',
    patch,
    additions: 2,
    deletions: 1,
    status: 'modified'
  }], { includeDiff: true });

  assert.equal(summary.count, 1);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 1);
  assert.equal(summary.files[0].path, 'src/app.js');
});

test('removes deleted image diffs already persisted in an older session', () => {
  const summary = filterReviewSummary('C:\\workspace', {
    source: 'opencode',
    count: 2,
    additions: 3,
    deletions: 1289,
    files: [{
      path: 'race1.png',
      additions: 0,
      deletions: 1288,
      status: 'deleted',
      diff: { rows: [{ type: 'del', text: '\u0000IHDR' }] }
    }, {
      path: 'index.html',
      additions: 3,
      deletions: 1,
      status: 'modified',
      diff: { rows: [{ type: 'add', text: '<canvas></canvas>' }] }
    }]
  });

  assert.equal(summary.source, 'opencode');
  assert.equal(summary.count, 1);
  assert.equal(summary.additions, 3);
  assert.equal(summary.deletions, 1);
  assert.deepEqual(summary.files.map(file => file.path), ['index.html']);
});

test('legacy review summaries also ignore binary snapshots', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-legacy-binary-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const imagePath = path.join(workspace, 'frame.png');
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
  const summary = await summarizeRunChanges(workspace, [{
    path: imagePath,
    before: null,
    op: 'write'
  }], { includeDiff: true });
  assert.deepEqual(summary, { count: 0, additions: 0, deletions: 0, files: [] });
});

test('recovers an edit from structured tool metadata when session diff is empty', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-edit-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const filePath = path.join(workspace, '0.cpp');
  const before = 'int main() {\n  return 0\n}\n';
  const after = 'int main() {\n  return 0;\n}\n';
  await fs.writeFile(filePath, after);
  const editPatch = createTwoFilesPatch(filePath, filePath, before, after);
  const messages = [{
    info: { id: 'assistant-1', role: 'assistant', time: { created: 100 } },
    parts: [{
      type: 'tool',
      tool: 'read',
      state: {
        status: 'completed',
        metadata: { display: { path: filePath, text: before } }
      }
    }, {
      type: 'tool',
      tool: 'edit',
      state: {
        status: 'completed',
        input: { filePath },
        metadata: { filediff: { file: filePath, patch: editPatch, additions: 1, deletions: 1 } }
      }
    }]
  }];

  const diffs = await summarizeOpenCodeToolChanges(workspace, messages);
  const summary = summarizeOpenCodeDiffs(workspace, diffs, { includeDiff: true });
  assert.equal(summary.count, 1);
  assert.equal(summary.additions, 1);
  assert.equal(summary.deletions, 1);
  assert.equal(summary.files[0].path, '0.cpp');
  assert.equal(summary.files[0].status, 'modified');
  assert.ok(summary.files[0].diff.rows.some(row => row.type === 'add' && row.text.includes('return 0;')));
});

test('recovers newly written files without a pre-existing workspace snapshot', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-write-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const filePath = path.join(workspace, 'index.html');
  const content = '<!doctype html>\n<title>Yan</title>\n';
  await fs.writeFile(filePath, content);
  const messages = [{
    info: { id: 'assistant-2', role: 'assistant', time: { created: 200 } },
    parts: [{
      type: 'tool',
      tool: 'write',
      state: {
        status: 'completed',
        input: { filePath, content },
        metadata: { filepath: filePath, exists: false }
      }
    }]
  }];

  const diffs = await summarizeOpenCodeToolChanges(workspace, messages);
  const summary = summarizeOpenCodeDiffs(workspace, diffs, { includeDiff: true });
  assert.equal(summary.count, 1);
  assert.equal(summary.files[0].status, 'created');
  assert.equal(summary.files[0].additions, 2);
});

test('keeps every touched text file when OpenCode returns mixed diff metadata', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-complete-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const indexPath = path.join(workspace, 'index.html');
  const cssPath = path.join(workspace, 'styles.css');
  const jsPath = path.join(workspace, 'app.js');
  const cssBefore = 'body { color: black; }\n';
  const cssAfter = 'body { color: white; }\n';
  await Promise.all([
    fs.writeFile(indexPath, '<main>Yan</main>\n'),
    fs.writeFile(cssPath, cssAfter),
    fs.writeFile(jsPath, 'console.log("Yan");\n')
  ]);
  const messages = [{
    info: { id: 'assistant-mixed', role: 'assistant', time: { created: 250 } },
    parts: [{
      type: 'tool',
      tool: 'write_file',
      state: {
        status: 'completed',
        input: { file_path: indexPath },
        metadata: { filePath: indexPath, exists: false }
      }
    }, {
      type: 'tool',
      tool: 'edit_file',
      state: {
        status: 'completed',
        input: { target_file: cssPath },
        metadata: {
          fileDiff: {
            path: cssPath,
            patch: createTwoFilesPatch(cssPath, cssPath, cssBefore, cssAfter),
            additions: 1,
            deletions: 1,
            status: 'modified'
          }
        }
      }
    }]
  }];

  const diffs = await summarizeOpenCodeToolChanges(workspace, messages, {
    touchedFiles: new Set([indexPath, cssPath, jsPath])
  });
  const summary = summarizeOpenCodeDiffs(workspace, diffs, { includeDiff: true });
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.files.map(file => file.path).sort(), ['app.js', 'index.html', 'styles.css']);
  // Touched without recoverable before-content is reported as modified
  // (partial), never as an opaque "unknown +0/-0" row.
  const appEntry = summary.files.find(file => file.path === 'app.js');
  assert.equal(appEntry.status, 'modified');
  assert.equal(appEntry.additions, 0);
  assert.equal(appEntry.deletions, 0);
  assert.equal(summary.files.find(file => file.path === 'index.html').status, 'created');
  assert.equal(summary.files.find(file => file.path === 'styles.css').status, 'modified');
});

test('normalizes alternate OpenCode status labels and avoids unknown for existing files', async t => {
  const workspace = await mkdtempWorkspace(t);
  const filePath = path.join(workspace, 'renamed.txt');
  await fs.writeFile(filePath, 'renamed\n');
  const summary = summarizeOpenCodeDiffs(workspace, [
    { file: path.join(workspace, 'a.txt'), additions: 1, deletions: 0, status: 'created' },
    { file: path.join(workspace, 'b.txt'), additions: 0, deletions: 1, status: 'removed' },
    { file: filePath, additions: 2, deletions: 2, status: 'renamed' },
    { file: path.join(workspace, 'c.txt'), additions: 3, deletions: 3, status: 'changed' }
  ], { includeDiff: false });
  assert.deepEqual(
    summary.files.map(file => file.status),
    ['created', 'deleted', 'modified', 'modified']
  );
});

test('collectWorkspaceFileSweep picks up shell-written files by mtime', async t => {
  const workspace = await mkdtempWorkspace(t);
  const startedAt = Date.now() - 1000;
  const freshPath = path.join(workspace, 'fresh.js');
  const stalePath = path.join(workspace, 'stale.js');
  await fs.writeFile(freshPath, 'export const fresh = true;\n');
  await fs.writeFile(stalePath, 'export const stale = true;\n');
  const staleTime = new Date(Date.now() - 60_000);
  await fs.utimes(stalePath, staleTime, staleTime);
  const sweep = await collectWorkspaceFileSweep(workspace, { startTime: startedAt });
  const keys = [...sweep.keys()];
  assert.ok(keys.some(key => key.endsWith('fresh.js')));
  assert.ok(!keys.some(key => key.endsWith('stale.js')));
});

test('buildRollbackChanges prefers baselines and falls back to reversed patches', async t => {
  const workspace = await mkdtempWorkspace(t);
  const filePath = path.join(workspace, 'app.js');
  const before = 'const a = 1;\n';
  const after = 'const a = 2;\n';
  await fs.writeFile(filePath, after);
  const changePatch = createTwoFilesPatch(filePath, filePath, before, after);
  const fromBaseline = await buildRollbackChanges(workspace, [
    { file: filePath, patch: changePatch, additions: 1, deletions: 1, status: 'modified' }
  ], new Map([[filePath.toLowerCase(), { path: filePath, before }]]));
  assert.equal(fromBaseline.length, 1);
  assert.equal(fromBaseline[0].before, before);

  const fromPatch = await buildRollbackChanges(workspace, [
    { file: filePath, patch: changePatch, additions: 1, deletions: 1, status: 'modified' }
  ]);
  assert.equal(fromPatch.length, 1);
  assert.equal(fromPatch[0].before, before);

  const skipped = await buildRollbackChanges(workspace, [
    { file: filePath, additions: 1, deletions: 0, status: 'modified' }
  ]);
  assert.equal(skipped.length, 0);
});

test('collapses multiple edits into the final per-run file diff', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-multi-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const filePath = path.join(workspace, 'app.js');
  const before = 'const state = "old";\n';
  const middle = 'const state = "new";\n';
  const after = 'const state = "new";\nconst ready = true;\n';
  await fs.writeFile(filePath, after);
  const messages = [{
    info: { id: 'assistant-3', role: 'assistant', time: { created: 300 } },
    parts: [
      {
        type: 'tool', tool: 'edit', state: {
          status: 'completed', input: { filePath }, metadata: {
            filediff: { file: filePath, patch: createTwoFilesPatch(filePath, filePath, before, middle), additions: 1, deletions: 1 }
          }
        }
      },
      {
        type: 'tool', tool: 'edit', state: {
          status: 'completed', input: { filePath }, metadata: {
            filediff: { file: filePath, patch: createTwoFilesPatch(filePath, filePath, middle, after), additions: 1, deletions: 0 }
          }
        }
      }
    ]
  }];

  const diffs = await summarizeOpenCodeToolChanges(workspace, messages);
  const summary = summarizeOpenCodeDiffs(workspace, diffs, { includeDiff: true });
  assert.equal(summary.count, 1);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 1);
  assert.ok(summary.files[0].diff.rows.some(row => row.type === 'add' && row.text.includes('ready')));
});

test('uses the authoritative tool patch when a live baseline arrives after the edit', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-review-late-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const filePath = path.join(workspace, 'late.cpp');
  const before = 'int value = 1;\n';
  const after = 'int value = 2;\n';
  await fs.writeFile(filePath, after);
  const messages = [{
    info: { id: 'assistant-4', role: 'assistant', time: { created: 400 } },
    parts: [{
      type: 'tool', tool: 'edit', state: {
        status: 'completed', input: { filePath }, metadata: {
          filediff: { file: filePath, patch: createTwoFilesPatch(filePath, filePath, before, after), additions: 1, deletions: 1 }
        }
      }
    }]
  }];
  const lateBaselines = new Map([[filePath.toLowerCase(), { path: filePath, before: after }]]);

  const diffs = await summarizeOpenCodeToolChanges(workspace, messages, { baselines: lateBaselines });
  const summary = summarizeOpenCodeDiffs(workspace, diffs, { includeDiff: true });
  assert.equal(summary.count, 1);
  assert.equal(summary.additions, 1);
  assert.equal(summary.deletions, 1);
});
