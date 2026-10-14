'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const skillRegistry = require('../lib/skill-registry');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-detail-'));
const dataDir = path.join(userData, 'YanData');
const evidence = path.join(appRoot, 'output/playwright/skill-detail');
fs.mkdirSync(evidence, { recursive: true });
const prompt = '# Markdown Preview\n\nA **bold** and *italic* paragraph.\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| Example | 42 |\n\n```js\nconsole.log("hello");\n```\n\n<script>window.__skillPreviewUnsafe = true</script>\n\n[Example](https://example.com)\n\n{{cursor}}';
skillRegistry.installYanUserSkill(dataDir, { id: 'preview-demo', name: 'Markdown Preview Demo', desc: 'Verify the shared Skill detail page.', prompt, source: 'custom' });

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true);
    await app.evaluate(({ shell }) => { global.__skillOpened = ''; shell.openPath = async value => { global.__skillOpened = value; return ''; }; });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator('[data-nav="plugins"]').click();
    await page.locator('#pluginsSkillsTab').click();
    const open = async id => {
      await page.locator(`#skillMarketGrid [data-market-id="${id}"]`).click();
      await page.locator('#skillDetailMarkdown[aria-busy="false"]').waitFor();
    };
    const close = async () => {
      await page.locator('#skillDetailContent [data-detail-action="back"]').click();
      await page.locator('#skillMarketOverview:not(.hidden)').waitFor();
    };
    await open('hyperframes');
    assert.equal(await page.locator('.skill-child-row').count(), 4);
    assert.equal(await page.locator('#skillDetailPartsTitle').textContent(), '子技能 4');
    assert.equal(await page.locator('#skillDetailPartsTitle').evaluate(el => el.getBoundingClientRect().top < document.getElementById('skillDetailDocumentTitle').getBoundingClientRect().top), true);
    assert.doesNotMatch(await page.locator('#skillDetailMarkdown').textContent(), /Yan Agent already bundles the complete HyperFrames companion set/);
    const bounds = await page.locator('#skillDetailView').boundingBox(), parent = await page.locator('#pageSkills').boundingBox();
    assert.ok(bounds.width <= 880 && bounds.width < parent.width);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - parent.x - parent.width / 2) < 10);
    assert.equal(await page.locator('#skillDetailContent [data-detail-action="back"]').evaluate(el => el.innerHTML === document.getElementById('skillImportCloseBtn').innerHTML && el.className === document.getElementById('skillImportCloseBtn').className), true);
    assert.equal(await page.locator('#skillDetailContent .plugin-info-section').count(), 0);
    assert.equal(await page.locator('#skillDetailContent .plugin-examples').count(), 1);
    await page.locator('[data-detail-action="open-directory"]').click();
    assert.equal(await app.evaluate(() => global.__skillOpened), path.join(appRoot, 'lib/skills/hyperframes'));
    await page.evaluate(() => { window.__skillDetailNode = document.getElementById('skillDetailMarkdown'); });
    const mainToggle = page.locator('[data-skill-toggle="hyperframes"]');
    const childToggle = page.locator('.skill-child-row [data-skill-toggle]').first();
    const childId = await childToggle.getAttribute('data-skill-toggle');
    await childToggle.uncheck();
    await page.waitForFunction(id => !document.querySelector(`[data-skill-toggle="${id}"]`).disabled, childId);
    await mainToggle.uncheck();
    await page.waitForFunction(() => !document.querySelector('[data-skill-toggle="hyperframes"]').disabled);
    assert.equal(await page.evaluate(() => window.__skillDetailNode === document.getElementById('skillDetailMarkdown')), true, 'toggle preserves the detail DOM');
    assert.equal(await childToggle.isDisabled(), true);
    assert.equal(await childToggle.isChecked(), false);
    assert.equal(await page.evaluate(async () => (await window.yan.listSkills()).some(s => s.id === 'hyperframes')), false);
    assert.equal(await page.evaluate(async () => (await window.yan.readSkill('hyperframes')).ok), false);
    await close(); await open('hyperframes');
    assert.equal(await mainToggle.isChecked(), false, 'disabled Skill remains installed and manageable');
    await mainToggle.check();
    await page.waitForFunction(() => !document.querySelector('[data-skill-toggle="hyperframes"]').disabled);
    assert.equal(await childToggle.isDisabled(), false);
    assert.equal(await childToggle.isChecked(), false, 're-enabling parent preserves individually disabled children');
    await childToggle.check();
    await page.waitForFunction(id => !document.querySelector(`[data-skill-toggle="${id}"]`).disabled, childId);
    await page.screenshot({ path: path.join(evidence, 'hyperframes.png') });
    await close(); await open('preview-demo');
    assert.equal(await page.locator('#skillDetailPartsTitle, .skill-child-row').count(), 0);
    assert.equal(await page.locator('#skillDetailMarkdown h1').textContent(), 'Markdown Preview');
    const markdownWidth=await page.locator('#skillDetailMarkdown').evaluate(el=>({body:el.getBoundingClientRect().width,section:el.parentElement.getBoundingClientRect().width}));
    assert.ok(Math.abs(markdownWidth.body-markdownWidth.section)<1,'Skill.md fills its document section');
    assert.ok(Math.abs((await page.locator('#skillDetailMarkdown > p').first().boundingBox()).width-markdownWidth.section)<1,'Markdown paragraphs fill the document section');
    console.log('Skill document widths:',JSON.stringify(markdownWidth));
    const source=fs.readFileSync(path.join(appRoot,'lib/plugins/catalog/yan-computer-use/skills/computer-use/SKILL.md'),'utf8').replace(/^---[\s\S]*?---\s*/,'');
    const softWrap=await page.evaluate(source=>{
      const doc=document.createElement('div');doc.innerHTML=renderMarkdown(source,{softBreaks:true});
      const explicit=document.createElement('div');explicit.innerHTML=renderMarkdown('one  \ntwo\\\nthree',{softBreaks:true});
      return {breaks:doc.querySelectorAll('p br').length,joined:doc.textContent.includes('when needed'),explicit:explicit.querySelectorAll('br').length,chat:renderMarkdown('one\ntwo').includes('<br>')};
    },source);
    assert.deepEqual(softWrap,{breaks:0,joined:true,explicit:2,chat:true},'computer-use source wraps reflow, explicit hard breaks and chat behavior remain');
    assert.equal(await page.locator('#skillDetailMarkdown strong').textContent(), 'bold');
    assert.equal(await page.locator('#skillDetailMarkdown em').textContent(), 'italic');
    assert.equal(await page.locator('#skillDetailMarkdown li').count(), 2);
    assert.equal(await page.locator('#skillDetailMarkdown table').count(), 1);
    assert.equal(await page.locator('#skillDetailMarkdown pre code').textContent(), 'console.log("hello");');
    assert.equal(await page.evaluate(() => !!window.__skillPreviewUnsafe), false);
    assert.match(await page.locator('#skillDetailMarkdown').textContent(), /\{\{cursor\}\}/);
    assert.equal(await page.locator('[data-detail-action="open-directory"] img').getAttribute('src'), 'assets/windows-explorer.png');
    assert.equal(await page.locator('[data-detail-action="remove"]').count(), 1);
    await app.evaluate(({ shell }) => { global.__skillOpened = ''; shell.openPath = async value => { global.__skillOpened = value; return ''; }; });
    await page.locator('[data-detail-action="open-directory"]').click();
    assert.equal(await app.evaluate(() => global.__skillOpened), path.join(dataDir, 'skills', 'preview-demo'));
    await page.locator('.skill-document-copy').click();
    assert.equal((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'), fs.readFileSync(path.join(dataDir, 'skills/preview-demo/SKILL.md'), 'utf8').replace(/\r\n/g, '\n'));
    await page.locator('.md-code-copy').click();
    await page.waitForFunction(() => document.querySelector('.md-code-copy').dataset.state === 'success');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'console.log("hello");');
    await app.evaluate(({ ipcMain }) => { global.__skillOriginalLink = ipcMain._invokeHandlers.get('browser:open-link'); ipcMain.removeHandler('browser:open-link'); ipcMain.handle('browser:open-link', (_event, url) => { global.__skillLink = url; return { target: 'external' }; }); });
    await page.locator('#skillDetailMarkdown a').click();
    assert.equal(await app.evaluate(() => global.__skillLink), 'https://example.com');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('browser:open-link'); ipcMain.handle('browser:open-link', global.__skillOriginalLink); });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.screenshot({ path: path.join(evidence, `markdown-${theme}.png`) });
    }
    await page.locator('#sidebarToggle').click();
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('#skillDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
      await page.screenshot({ path: path.join(evidence, `markdown-${width}.png`) });
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await close();
    await app.evaluate(({ ipcMain }) => {
      global.__skillOriginalRead = ipcMain._invokeHandlers.get('skills:read');
      ipcMain.removeHandler('skills:read');
      ipcMain.handle('skills:read', async (event, payload) => {
        if (payload.documentOnly && payload.id === 'hyperframes') await new Promise(resolve => { global.__releaseSkillRead = resolve; });
        return global.__skillOriginalRead(event, payload);
      });
    });
    await page.locator('#skillMarketGrid [data-market-id="hyperframes"]').click();
    await page.locator('#skillDetailMarkdown[aria-busy="true"]').waitFor();
    await close(); await open('preview-demo');
    await app.evaluate(() => global.__releaseSkillRead());
    assert.equal(await page.locator('#skillDetailTitle').textContent(), 'Markdown Preview Demo');
    assert.equal(await page.locator('#skillDetailMarkdown h1').textContent(), 'Markdown Preview');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('skills:read'); ipcMain.handle('skills:read', global.__skillOriginalRead); });
    await close(); await open('yan-uiverse');
    assert.equal(await page.locator('#skillDetailPartsTitle').count(), 0);
    assert.match(await page.locator('#skillDetailMarkdown').textContent(), /Uiverse/);
    await page.locator('[data-detail-action="open-directory"]').click();
    const builtinPath = await app.evaluate(() => global.__skillOpened);
    assert.equal(fs.existsSync(path.join(builtinPath, 'SKILL.md')), true, 'prompt-only builtin opens its materialized SkillStore folder');
    await page.locator('[data-skill-toggle="yan-uiverse"]').uncheck();
    await page.waitForFunction(() => !document.querySelector('[data-skill-toggle="yan-uiverse"]').disabled);
    const unavailable = await page.evaluate(() => window.yan.readSkillDocument('../../config.json'));
    assert.equal(unavailable.ok, false);
    await close();
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('skills:read'); ipcMain.handle('skills:read', () => ({ ok: false, error: '测试正文读取失败' })); });
    await open('preview-demo');
    assert.equal(await page.locator('#skillDetailMarkdown').textContent(), '测试正文读取失败');
    assert.equal(await page.locator('.skill-document-copy').isDisabled(), true);
    await close();
    assert.deepEqual(errors, []);
    const exited = new Promise(resolve => app.process().once('exit', resolve));
    await app.close(); await exited;
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const reopened = await app.firstWindow();
    await reopened.waitForFunction(() => window.__YAN_APP_READY__ === true);
    assert.equal(await reopened.evaluate(async () => (await window.yan.listSkills()).some(s => s.id === 'yan-uiverse')), false, 'disabled state survives a real restart');
    assert.equal(await reopened.evaluate(async () => (await window.yan.getSkillCatalog()).find(s => s.id === 'yan-uiverse').enabled), false);
    assert.equal(await reopened.evaluate(async () => (await window.yan.setSkillEnabled('yan-uiverse', true)).enabled), true);
    console.log('PASS: shared detail, conditional children, raw Markdown preview, safe HTML, copy/link/Explorer actions, narrow widths, stale response guard, builtin fallback and failure state.');
  } finally {
    const child = app?.process();
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await app?.close().catch(() => {}); await stopped;
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir()));
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
