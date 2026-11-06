const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-deliverable-ui-'));
const workspace = path.join(temp, 'workspace'); fs.mkdirSync(workspace);
const plan = path.join(temp, '计划 (终稿).md'); fs.writeFileSync(plan, '# 统一计划预览\n\n任务内容');
const local = path.join(workspace, 'result.md'); fs.writeFileSync(local, '# 项目产物');
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(temp, 'data') } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async ({workspace, url}) => {
      await newSession({workspace, forceNew: true});
      const body = document.createElement('div'); body.className = 'msg-body'; body.id = 'deliverableFixture';
      body.innerHTML = renderMarkdown(`[计划](<${url}>)`); document.body.append(body);
    }, {workspace, url: pathToFileURL(plan).href});
    await page.locator('#deliverableFixture a').dispatchEvent('click');
    await page.locator('.pf-markdown h1').waitFor();
    assert.equal(await page.locator('.pf-markdown h1').textContent(), '统一计划预览');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    assert.equal(await page.locator('#rs-files').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    assert.equal(await page.locator('#rs-plan, .run-plan-summary, [data-rs-tab-type="plan"]').count(), 0);
    await page.locator('[data-pf="source"]').click();
    await page.locator('.pf-editor').fill('# 未保存计划');
    await page.evaluate(async target => YanProjectFiles.openLocal(target), local);
    await page.waitForFunction(() => document.querySelector('.pf-markdown h1')?.textContent === '项目产物');
    await page.evaluate(async target => YanProjectFiles.openLocal(target), plan);
    assert.equal(await page.locator('.pf-editor').inputValue(), '# 未保存计划');
    await page.evaluate(async target => {
      await openCompletedMarkdown(state.currentSession, { status: 'done', runId: 'test-complete', textContent: `[结果](<${target}>)` });
    }, pathToFileURL(local).href);
    await page.waitForFunction(() => document.querySelector('.pf-markdown h1')?.textContent === '项目产物');
    await page.evaluate(async target => {
      await YanProjectFiles.openLocal(target);
      await openCompletedMarkdown(state.currentSession, { status: 'done', runId: 'test-complete', textContent: '[结果](result.md)' });
      await openCompletedMarkdown({ id: 'other' }, { status: 'done', runId: 'other', textContent: '[结果](result.md)' });
      await openCompletedMarkdown(state.currentSession, { status: 'error', runId: 'error', textContent: '[结果](result.md)' });
    }, plan);
    assert.equal(await page.locator('.pf-editor').inputValue(), '# 未保存计划');
    await page.locator('[data-pf="save-edits"]').click();
    await page.waitForFunction(() => !document.querySelector('.rs-work-tab.active.pf-dirty'));
    assert.equal(fs.readFileSync(plan, 'utf8'), '# 未保存计划');
    const html = path.join(workspace, 'preview page.html');
    fs.writeFileSync(html, '<!doctype html><title>网页产物预览</title><h1>Browser deliverable</h1>');
    await page.evaluate(url => {
      document.querySelector('#deliverableFixture').innerHTML = renderMarkdown(`[网页](<${url}>)`);
    }, pathToFileURL(html).href);
    await page.locator('#deliverableFixture a').dispatchEvent('click');
    await page.waitForFunction(() => getActiveRightSidebarTab()?.type === 'browser');
    await page.waitForFunction(() => getBrowserTabController()?.currentUrl?.includes('preview%20page.html'));
    assert.equal(await page.evaluate(() => openRightSidebarTabs.some(tab => tab.type === 'files' && tab.filePath === 'preview page.html')), false);
    await page.waitForFunction(async () => (await api.browserHistory()).some(item => item.url.includes('preview%20page.html')));
    console.log('PASS local webpage uses built-in browser; Markdown uses Files; auto-open and guards');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
