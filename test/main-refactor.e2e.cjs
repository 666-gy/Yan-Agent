'use strict';

// Exercise the real composition root and preload IPC with isolated user data.
// YAN_REFACTOR_PACKAGED=1 runs the same checks against the built application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.env.YAN_REFACTOR_PACKAGED === '1';
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-main-refactor-'));
const evidence = path.join(root, '.yanagent', 'evidence');
const label = packaged ? 'packaged' : 'source';

(async () => {
  let app;
  try {
    const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(fixture, 'data') };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: packaged ? path.join(root, 'dist', 'win-unpacked', 'Yan Agent.exe') : require('electron'),
      args: packaged ? [] : [root], cwd: root, env, timeout: 45000
    });
    const processErrors = [];
    app.process().stderr.on('data', data => {
      if (/uncaughtException|unhandledRejection|ReferenceError/.test(String(data))) processErrors.push(String(data));
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    const result = await page.evaluate(async workspace => {
      const before = await yan.getConfig();
      const saved = await yan.setConfig({ language: 'en' });
      const read = await yan.getConfig();
      await yan.setConfig({ language: before.language });
      return {
        savedLanguage: saved.language, readLanguage: read.language,
        core: await yan.yanCoreGetState(), runs: await yan.openCodeSyncActiveRuns(),
        recovered: await yan.openCodeRecoverRuns(),
        compress: await yan.openCodeCompressSession('invalid'),
        changes: await yan.openCodeRunChanges('missing'),
        interjection: await yan.openCodeInterject({ runId: 'missing', text: 'hello' }),
        network: await yan.browserRecoverNetwork('https://example.com'),
        clearData: await yan.browserClearData('invalid'),
        workspace: await yan.yanagentEnsure(workspace)
      };
    }, path.join(fixture, 'workspace'));
    assert.equal(result.savedLanguage, 'en');
    assert.equal(result.readLanguage, 'en');
    assert.equal(result.core.error, undefined);
    assert.deepEqual(result.runs, []);
    assert.deepEqual(result.recovered, []);
    assert.equal(result.compress.ok, false);
    assert.equal(result.changes.count, 0);
    assert.equal(result.interjection.ok, false);
    assert.equal(result.network.ok, true);
    assert.equal(result.clearData.ok, false);
    assert.equal(result.workspace.ok, true);
    assert.equal(fs.existsSync(path.join(result.workspace.path, '.gitignore')), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(processErrors, []);
    fs.mkdirSync(evidence, { recursive: true });
    const screenshot = path.join(evidence, `p1-main-${label}.png`);
    await page.screenshot({ path: screenshot });
    const summary = { ok: true, label, title: await page.title(), errors, processErrors, screenshot };
    fs.writeFileSync(path.join(evidence, `p1-main-${label}.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally {
    if (app) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
