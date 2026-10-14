const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { _electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-worktrees-ui-'));
const profile = path.join(root, 'profile'), repo = path.join(root, 'repo'), custom = path.join(root, 'custom');
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true }); fs.mkdirSync(repo);
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), '{}');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, stdio: 'pipe' });
git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('commit', '--allow-empty', '-m', 'initial');
const output = path.join(process.cwd(), 'output/playwright/worktrees'); fs.mkdirSync(output, { recursive: true });
let app;
async function launch() {
  const env = { ...process.env, YAN_E2E_USER_DATA_DIR: profile, YAN_DISABLE_SINGLE_INSTANCE: '1' }; delete env.YAN_E2E_MODE;
  app = await _electron.launch({ executablePath: require('electron'), args: [process.cwd()], env });
  let page;
  for (let i = 0; i < 100; i++) { page = app.windows().find(p => p.url().includes('/renderer/index.html')); if (page) break; await new Promise(r => setTimeout(r, 200)); }
  assert.ok(page); await page.waitForFunction(() => window.__YAN_APP_READY__);
  await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-worktrees').click();
  await page.waitForFunction(() => !document.getElementById('worktreeRefresh').disabled);
  return page;
}
(async () => {
  try {
    let page = await launch();
    assert.deepEqual(await page.locator('#settingsSidebarNav [data-tab="git"], #settingsSidebarNav [data-tab="worktrees"]').allTextContents(), ['Git', 'Worktrees']);
    assert.equal(await page.locator('[data-worktree-setting="limit"]').inputValue(), '15');
    assert.match(await page.locator('#managedWorktreeList').textContent(), /Yan Agent 创建/);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async theme => { state.config = await api.setConfig({ theme }); applyTheme(theme); }, theme);
      await page.screenshot({ path: path.join(output, theme + '-empty.png') });
    }
    await page.locator('[data-worktree-setting="root"]').fill(custom); await page.locator('[data-worktree-setting="root"]').press('Tab'); await page.evaluate(() => YanWorktreeSettings.saved());
    await page.locator('[data-worktree-setting="fetchBeforeCreate"]').check(); await page.evaluate(() => YanWorktreeSettings.saved());
    await page.locator('[data-worktree-setting="limit"]').fill('2'); await page.locator('[data-worktree-setting="limit"]').press('Tab'); await page.evaluate(() => YanWorktreeSettings.saved());
    const result = await page.evaluate(repo => api.gitWorktreeCreate(repo, 'ui-test'), repo);
    assert.equal(result.ok, true, result.error); assert.ok(result.worktree.path.startsWith(custom));
    fs.writeFileSync(path.join(result.worktree.path, 'uncommitted.txt'), 'recover me');
    await page.locator('#worktreeRefresh').click(); await page.getByRole('button', { name: '归档', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'populated.png') });
    await page.getByRole('button', { name: '归档', exact: true }).click();
    await page.locator('#genericConfirmAccept').click();
    await page.getByRole('button', { name: '恢复', exact: true }).waitFor();
    assert.equal(fs.existsSync(result.worktree.path), false);
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await page.getByRole('button', { name: '归档', exact: true }).waitFor();
    assert.equal(fs.readFileSync(path.join(result.worktree.path, 'uncommitted.txt'), 'utf8'), 'recover me');
    await page.locator('[data-worktree-setting="autoCleanup"]').uncheck(); await page.evaluate(() => YanWorktreeSettings.saved());
    assert.equal(await page.locator('[data-worktree-setting="limit"]').isDisabled(), true);
    await app.close(); app = null;
    page = await launch();
    const prefs = await page.evaluate(async () => (await api.getConfig()).worktrees);
    assert.deepEqual(prefs, { root: custom, fetchBeforeCreate: true, autoCleanup: false, limit: 2 });
    assert.match(await page.locator('#managedWorktreeList').textContent(), /ui-test/);
    console.log('PASS normal startup, settings persistence, actual IPC creation at selected root, live list, physical archive/restore and recovered file');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
