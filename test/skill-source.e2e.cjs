 'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-source-ui-'));
const userData = path.join(root, 'user');
const workspace = path.join(root, 'project');
const external = path.join(root, 'Other Agent', 'skills');
const evidence = path.join(appRoot, 'output', 'playwright');
fs.mkdirSync(path.join(userData, 'YanData'), { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
for (const id of ['document-review', 'frontend-guide']) {
  fs.mkdirSync(path.join(external, id), { recursive: true });
  fs.writeFileSync(path.join(external, id, 'SKILL.md'), `---\nname: ${id}\ndescription: A sample external skill\n---\nReview the requested work.\n`);
}
fs.writeFileSync(path.join(userData, 'YanData', 'config.json'), JSON.stringify({ workspace, customSkills: [] }));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true);
    await page.locator('[data-nav="plugins"]').click();
    await page.locator('#pluginsSkillsTab').click();
    await page.locator('#skillMarketOverview:not(.hidden)').waitFor();
    assert.equal(await page.locator('#skillSourceBtn').count(), 0);
    assert.equal(await page.locator('#skillSourceDialog').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.yan.applySkillSource), 'undefined');
    await assert.rejects(app.evaluate(({ ipcMain }, sourcePath) => {
      const apply = ipcMain._invokeHandlers.get('skills:source-apply');
      if (!apply) throw new Error('source apply is not registered');
      return apply(null, { path: sourcePath, mode: 'copy' });
    }, external), /not registered/);
    const skills = await page.evaluate(() => window.yan.listSkills());
    assert.ok(!skills.some(skill => ['document-review', 'frontend-guide'].includes(skill.id)));
    const attachment = await page.evaluate(filePath => window.yan.inspectAttachmentPath(filePath), path.join(external, 'document-review', 'SKILL.md'));
    assert.equal(attachment.ok, true);
    assert.equal(attachment.isFile, true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.screenshot({ path: path.join(evidence, 'skill-source-removed.png') });
    await page.setViewportSize({ width: 768, height: 860 });
    await page.screenshot({ path: path.join(evidence, 'skill-source-removed-narrow.png') });
    assert.equal(fs.existsSync(path.join(workspace, '.yanagent', 'skills')), false);
    assert.ok(fs.existsSync(path.join(external, 'document-review', 'SKILL.md')));
    assert.deepEqual(errors, []);
    console.log('Skill UI passed: source controls and IPC removed, official catalog retained, external attachment accepted.');
  } finally {
    await app?.close().catch(() => {});
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('yan-source-ui-')) fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
