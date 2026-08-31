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
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ customSkills: [retiredSkill, legacyBundledSkill] }, null, 2));
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
    const expectedMarketCount = expectedSkills.length;
    const expectedCounts = new Map([
      'code-assist',
      'ui-beautify',
      'web-design',
      'agent-rules',
      'office-assist'
    ].map(tag => [tag, expectedSkills.filter(skill => skill.tags?.includes(tag)).length]));
    await page.locator('.sidebar-nav-item[data-nav="skills"]').click();
    await page.locator('#pageSkills:not(.hidden)').waitFor();
    await page.waitForFunction(count => document.querySelectorAll('#skillMarketGrid .skill-card').length === count, expectedMarketCount);

    await page.locator('#skillFilterToggle').click();
    const filters = await page.locator('#skillFilterMenu .skill-filter-option').evaluateAll(buttons => (
      buttons.map(button => button.textContent.trim())
    ));
    assert.deepEqual(filters, ['全部', '代码辅助', 'UI美化', '网页设计', 'Agent规则', '办公辅助', '个人']);
    assert.equal(await page.locator('.skill-tag-btn').count(), 0);
    assert.equal(await page.locator('.capability-toolbar').count(), 0);
    assert.equal(await page.locator('#skillFilterMenu .skill-filter-check').count(), 0);
    await page.locator('#skillFilterToggle').click();

    await page.locator('#skillSearchToggle').click();
    await page.locator('#skillSearchPopover:not(.hidden)').waitFor();
    const searchBox = await page.locator('#skillSearchPopover').boundingBox();
    const searchButtonBox = await page.locator('#skillSearchToggle').boundingBox();
    assert.ok(searchBox && searchButtonBox);
    assert.ok(Math.abs(searchBox.y - searchButtonBox.y) < 8);
    assert.ok(searchBox.x + searchBox.width < searchButtonBox.x);
    await page.locator('#skillMarketSearch').fill('hyperframes');
    await page.waitForFunction(() => document.querySelectorAll('#skillMarketGrid .skill-card').length === 1);
    await page.locator('#skillMarketSearch').fill('');
    await page.locator('#skillSearchToggle').click();

    for (const [tag, expected] of expectedCounts) {
      await page.locator('#skillFilterToggle').click();
      await page.locator(`#skillFilterMenu [data-filter="${tag}"]`).click();
      await page.waitForFunction(count => document.querySelectorAll('#skillMarketGrid .skill-card').length === count, expected);
      assert.equal(await page.locator('#skillMarketGrid .skill-card').count(), expected);
    }

    await page.locator('#skillFilterToggle').click();
    await page.locator('#skillFilterMenu [data-filter="all"]').click();
    await page.waitForFunction(count => document.querySelectorAll('#skillMarketGrid .skill-card').length === count, expectedMarketCount);
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
    assert.equal(await page.locator('.skill-detail-row').count(), 4);
    assert.equal(await page.locator('#skillDetailView .skill-market-group-count').count(), 0);
    assert.equal(await page.locator('#skillDetailView [data-detail-action="back"]').count(), 1);
    await page.locator('#skillDetailView [data-detail-action="back"]').click();
    await page.locator('#skillMarketOverview:not(.hidden)').waitFor();
    await page.waitForFunction(() => !document.querySelector('#pageSkills > .capability-page-header')?.classList.contains('hidden'));
    const ids = await page.locator('#skillMarketGrid .skill-card').evaluateAll(cards => cards.map(card => card.dataset.marketId));
    assert.ok(!ids.includes(retiredSkill.id));
    assert.equal(await page.locator('#skillMarketGrid [data-skill-action="remove"]').count(), 0);
    await page.locator('#skillFilterToggle').click();
    await page.locator('#skillFilterMenu [data-filter="office-assist"]').click();
    await page.waitForFunction(count => document.querySelectorAll('#skillMarketGrid .skill-card').length === count, expectedCounts.get('office-assist'));
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
    console.log(JSON.stringify({ ok: true, screenshotPath, skills: ids }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
