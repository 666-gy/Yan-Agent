'use strict';

// Review laziness acceptance: a working tree with tens of thousands of changed
// lines must open as a collapsed file manifest — no diff row is rendered up
// front — and clicking one file loads only that file's rows on demand.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-big-'));
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-repo-'));

function runGit(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true });
}

function numberedLines(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix} line ${index + 1}`).join('\n') + '\n';
}

function seedHeavyWorkspace() {
  runGit(['init']);
  runGit(['config', 'user.email', 'review@example.com']);
  runGit(['config', 'user.name', 'Review Test']);
  fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), numberedLines('base', 8000));
  fs.writeFileSync(path.join(repoRoot, 'small.txt'), 'a\nb\nc\n');
  runGit(['add', '-A']);
  runGit(['commit', '-m', 'Base']);
  // ~52k changed lines total: this is the size that used to freeze the panel.
  fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), numberedLines('rewritten', 8000));
  fs.writeFileSync(path.join(repoRoot, 'generated.txt'), numberedLines('generated', 40000));
  fs.writeFileSync(path.join(repoRoot, 'small.txt'), 'a\nb\nc\nd\n');
}

(async () => {
  let application;
  const errors = [];
  try {
    seedHeavyWorkspace();
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      typeof state !== 'undefined'
      && !!state.currentSession
      && typeof openTaskGitChanges === 'function'
      && typeof refreshTaskGitStatus === 'function'
      && !!globalThis.YanDshReview
    ));

    const result = await page.evaluate(async ({ repoPath }) => {
      await api.setSessionWorkspace(state.currentSession.id, repoPath, false);
      state.currentSession.workspace = repoPath;
      await refreshTaskGitStatus({ quiet: true, force: true });
      const waitFor = async (predicate, timeoutMs) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (predicate()) return true;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
      };
      const reviewDoc = () => document.querySelector('#yanDshReviewFrame')?.contentDocument || null;
      const readFrame = () => {
        const doc = reviewDoc();
        if (!doc) return null;
        const files = [...doc.querySelectorAll('main .file')];
        return {
          files: files.length,
          totalRows: doc.querySelectorAll('.dsh-cr-grid .dsh-cr-row').length,
          perFileRows: files.map(file => file.querySelectorAll('.dsh-cr-row').length),
          collapsed: files.map(file => file.classList.contains('yan-file-collapsed')),
          states: files.map(file => file.getAttribute('data-yan-state') || ''),
          stats: doc.querySelector('.stats')?.textContent || '',
          navPaths: [...doc.querySelectorAll('.navitem')].map(link => link.textContent.trim())
        };
      };

      const startedAt = performance.now();
      openTaskGitChanges();
      const opened = await waitFor(() => {
        const frame = readFrame();
        return !!frame && frame.files === 3 && frame.states.every(state => state === 'pending');
      }, 30_000);
      const openMs = performance.now() - startedAt;
      const initial = readFrame();

      const navitems = [...(reviewDoc()?.querySelectorAll('.navitem') || [])];
      const targetIndex = initial.navPaths.findIndex(item => item.includes('generated.txt'));
      const loadStartedAt = performance.now();
      navitems[targetIndex >= 0 ? targetIndex : 1].click();
      const loaded = await waitFor(() => {
        const frame = readFrame();
        return !!frame && frame.perFileRows.some((count, index) => index === (targetIndex >= 0 ? targetIndex : 1) && count > 0);
      }, 20_000);
      const loadMs = performance.now() - loadStartedAt;
      const afterFirst = readFrame();

      const otherIndex = initial.navPaths.findIndex((item, index) => index !== (targetIndex >= 0 ? targetIndex : 1));
      navitems[otherIndex >= 0 ? otherIndex : 0].click();
      await waitFor(() => {
        const frame = readFrame();
        return !!frame && frame.perFileRows[otherIndex >= 0 ? otherIndex : 0] > 0;
      }, 20_000);
      const afterSecond = readFrame();

      return {
        opened,
        loaded,
        openMs,
        loadMs,
        initial,
        afterFirst,
        afterSecond,
        targetIndex: targetIndex >= 0 ? targetIndex : 1,
        otherIndex: otherIndex >= 0 ? otherIndex : 0,
        panelVisible: (() => {
          const panel = document.querySelector('#yanDshReviewPanel');
          return !!panel && !panel.classList.contains('hidden');
        })(),
        bigBarExists: !!document.querySelector('.yan-dsh-review-bigbar'),
        diagnostics: {
          source: rsReviewState.source,
          isRepo: !!taskGitState.status?.isRepository,
          panelState: document.querySelector('#rs-review')?.dataset.state || '',
          dshError: document.querySelector('.yan-dsh-review-error')?.textContent || '',
          frameSrc: String(document.querySelector('#yanDshReviewFrame')?.src || '').slice(0, 80),
          manifestFiles: rsReviewState.summary?.files?.length || 0
        }
      };
    }, { repoPath: repoRoot });
    if (!result.opened || !result.loaded) console.error('diagnostics:', JSON.stringify(result.diagnostics));

    assert.equal(result.opened, true, 'lazy review manifest did not open');
    assert.equal(result.panelVisible, true);
    assert.equal(result.bigBarExists, false, 'single-file window bar must be gone');
    assert.equal(result.initial.files, 3, 'the full file manifest must be listed');
    assert.equal(result.initial.totalRows, 0, 'no diff row may render before a file is opened');
    assert.deepEqual(result.initial.states, ['pending', 'pending', 'pending']);
    assert.ok(result.initial.collapsed.every(Boolean), 'every file starts collapsed');
    assert.match(result.initial.stats, /3个文件/);
    assert.match(result.initial.stats, /\+48\d{3}/, `stats must carry manifest totals, got ${result.initial.stats}`);
    assert.ok(result.openMs < 10_000, `review open took ${Math.round(result.openMs)}ms`);

    assert.equal(result.loaded, true, 'clicking a file did not load its rows');
    assert.ok(result.afterFirst.perFileRows[result.targetIndex] > 0, 'the opened file must render rows');
    assert.equal(
      result.afterFirst.perFileRows.filter((count, index) => index !== result.targetIndex).every(count => count === 0),
      true,
      'other files must stay unloaded'
    );
    assert.equal(result.afterFirst.collapsed[result.targetIndex], false, 'the opened file must expand');
    assert.equal(result.afterFirst.states[result.targetIndex], 'loaded');

    assert.ok(result.afterSecond.perFileRows[result.otherIndex] > 0, 'the second opened file must render rows');
    assert.ok(
      result.afterSecond.perFileRows[result.targetIndex] > 0,
      'the first loaded file must stay rendered'
    );
    assert.equal(result.afterSecond.states.filter(state => state === 'pending').length, 1);

    const shotDir = path.join(appRoot, 'output', 'review-big-diff');
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'lazy-review.png') });

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({
      ok: true,
      openMs: Math.round(result.openMs),
      loadMs: Math.round(result.loadMs),
      files: result.initial.files,
      stats: result.initial.stats,
      perFileRows: result.afterSecond.perFileRows
    }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
