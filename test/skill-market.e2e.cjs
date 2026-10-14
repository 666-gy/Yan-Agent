'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const skillRegistry = require('../lib/skill-registry');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-market-e2e-'));
const dataDir = path.join(userDataDir, 'YanData');
const outputDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(outputDir, 'skill-market.png');
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const retiredSkill = {
  id: 'market-pr-review',
  name: 'PR Review Pro',
  desc: 'old catalog entry',
  prompt: 'old prompt-only wrapper',
  source: 'obra/superpowers'
};
const legacyBundledSkill = {
  id: 'code-simplifier',
  name: 'Code Simplifier',
  desc: 'legacy metadata',
  prompt: 'legacy prompt',
  source: 'https://github.com/anthropics/claude-plugins-official',
  tags: ['code'],
  version: 1
};
const legacyHallmarkShadow = {
  id: 'hallmark',
  name: 'Hallmark',
  desc: 'legacy incomplete bundled shadow',
  prompt: 'This two-file shadow must be removed during startup.',
  source: 'bundled',
  version: 110
};
const removedUiIds = ['emil-motion', 'animate', 'apple-design', 'find-animation-opportunities', 'review-animations',
  'greensock-gsap', 'gsap-core', 'gsap-frameworks', 'gsap-performance', 'gsap-plugins', 'gsap-react',
  'gsap-scrolltrigger', 'gsap-timeline', 'gsap-utils', 'ui-ux-pro-max', 'liquid-glass-react', 'yan-react-bits'];
const removedUiSkills = removedUiIds.map(id => ({ id, name: id, desc: 'retired bundled Skill', prompt: 'Old instructions.', source: 'bundled' }));
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ customSkills: [retiredSkill, legacyBundledSkill, ...removedUiSkills] }, null, 2));
for (const skill of removedUiSkills) skillRegistry.installYanUserSkill(dataDir, skill);
skillRegistry.installYanUserSkill(dataDir, retiredSkill);
skillRegistry.installYanUserSkill(dataDir, legacyHallmarkShadow);

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.readyState === 'complete' && typeof switchSidebarNav === 'function');
    const expectedSkills = await page.evaluate(() => window.yan.listSkills());
    assert.ok(expectedSkills.every(skill => !removedUiIds.includes(skill.id)));
    const startupIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'SkillStore', 'index.json'), 'utf8'));
    assert.ok(startupIndex.entries.every(skill => !removedUiIds.includes(skill.id)));
    for (const id of removedUiIds) assert.ok(!fs.existsSync(path.join(dataDir, 'skills', id)));
    const expectedMarketCount = expectedSkills.length;
    await page.locator('[data-nav="plugins"]').click(); await page.locator('#pluginsSkillsTab').click();
    await page.locator('#pageSkills:not(.hidden)').waitFor();
    await page.waitForFunction(count => document.querySelectorAll('#skillMarketGrid .skill-card').length === count, expectedMarketCount);

    assert.equal(await page.locator('#skillSearchToggle, #skillSearchPopover, #skillMarketSearch, #skillFilterToggle, #skillFilterMenu').count(), 0);
    assert.equal(await page.locator('#skillSourceBtn, #skillImportBtn').count(), 2);
    assert.equal(await page.locator('#skillMarketGrid .skill-market-group').count(), 5);
    assert.equal(await page.locator('#skillMarketGrid .skill-group-grid').count(), 5);
    assert.equal(await page.locator('#skillMarketGrid .skill-card-tag').count(), 0);
    assert.equal(await page.locator('#skillMarketGrid .skill-status-pill').count(), 0);
    assert.equal(await page.locator('#skillMarketGrid .skill-card-open-mark').count(), 0);
    assert.equal(await page.locator('#skillMarketGrid .skill-child-count').count(), 0);
    assert.equal(await page.locator('#skillMarketGrid .skill-market-group-count').count(), 0);
    assert.equal(await page.locator('#skillFilterMenu .skill-tag-count').count(), 0);
    assert.equal(await page.locator('#skillMarketCount').count(), 0);
    await page.locator('#skillMarketGrid .skill-card[data-market-id="hyperframes"]').click();
    await page.locator('#skillDetailView:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelector('#pageSkills > .capability-page-header')?.classList.contains('hidden'));
    assert.equal(await page.locator('#skillDetailTitle').textContent(), 'HyperFrames');
    assert.equal(await page.locator('#skillDetailContent .skill-child-row').count(), 4);
    await page.locator('#skillDetailMarkdown[aria-busy="false"]').waitFor();
    assert.ok(await page.locator('#skillDetailMarkdown h1').count() > 0);
    assert.match(await page.locator('#skillDetailMarkdown').textContent(), /HTML is the source of truth/);
    assert.equal(await page.locator('#skillDetailContent .plugin-info-section, #skillDetailContent .plugin-examples').count(), 0);
    assert.equal(await page.locator('#skillDetailView .skill-market-group-count').count(), 0);
    assert.equal(await page.locator('#skillDetailView [data-detail-action="back"]').count(), 1);
    await page.locator('#skillDetailView [data-detail-action="back"]').click();
    await page.locator('#skillMarketOverview:not(.hidden)').waitFor();
    await page.waitForFunction(() => !document.querySelector('#pageSkills > .capability-page-header')?.classList.contains('hidden'));
    await page.locator('#skillMarketGrid [data-skill-action="open"]').first().click();
    await page.locator('#skillDetailView:not(.hidden)').waitFor();
    assert.ok(await page.locator('#skillDetailTitle').textContent());
    await page.locator('#skillDetailView [data-detail-action="back"]').click();
    await page.locator('#skillMarketOverview:not(.hidden)').waitFor();
    const ids = await page.locator('#skillMarketGrid .skill-card').evaluateAll(cards => cards.map(card => card.dataset.marketId));
    assert.ok(!ids.includes(retiredSkill.id));
    assert.equal(await page.locator('#skillMarketGrid [data-skill-action="remove"]').count(), 0);
    assert.equal(await page.locator('#skillMarketGrid .skill-card').count(), expectedMarketCount);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const installed = await page.evaluate(() => window.yan.listSkills());
    assert.equal(installed.length, expectedMarketCount);
    assert.ok(installed.some(skill => skill.id === 'hyperframes'));
    assert.ok(installed.some(skill => skill.id === 'remotion-best-practices'));
    assert.ok(!installed.some(skill => skill.id === 'hyperframes-cli'));
    assert.ok(!installed.some(skill => skill.id === retiredSkill.id));
    const migrated = installed.find(skill => skill.id === legacyBundledSkill.id);
    assert.deepEqual(migrated.tags, ['code-assist']);
    assert.equal(migrated.source, 'bundled');
    assert.ok(installed.some(skill => skill.id === legacyHallmarkShadow.id));
    assert.ok(!skillRegistry.scanYanUserSkills(dataDir).some(skill => skill.id === legacyHallmarkShadow.id));
    assert.ok(!skillRegistry.scanYanUserSkills(dataDir).some(skill => skill.id === retiredSkill.id));
    const child = application.process();
    const stopped = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await application.close(); await stopped;
    application = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir } });
    const restarted = await application.firstWindow();
    await restarted.waitForFunction(() => window.__YAN_APP_READY__ === true);
    const afterRestart = await restarted.evaluate(() => window.yan.listSkills());
    assert.ok(afterRestart.every(skill => !removedUiIds.includes(skill.id)), 'removed UI Skills must not reinstall on restart');
    assert.equal(afterRestart.length, expectedMarketCount);
    console.log(JSON.stringify({ ok: true, screenshotPath, skills: ids }));
  } finally {
    const child = application?.process();
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await application?.close().catch(() => {});
    await stopped;
    assert.equal(path.dirname(userDataDir), path.resolve(os.tmpdir()));
    await fs.promises.rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
