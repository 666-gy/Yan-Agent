'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const skillRegistry = require('../lib/skill-registry');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-source-'));
const dataDir = path.join(profile, 'YanData');
const output = path.join(root, 'output/playwright/skill-source-tabs');
skillRegistry.installYanUserSkill(dataDir, {
  id: 'demo-personal-skill', name: '个人示例技能', desc: '只在个人页显示的本地技能。',
  prompt: '# 个人示例技能\n\n用于验收个人/系统分栏。', source: 'custom'
});
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip());
    fs.mkdirSync(output, { recursive: true });
    const openSkills = async () => {
      await page.evaluate(() => switchSidebarNav('skills'));
      await page.waitForFunction(() => document.querySelectorAll('#pageSkills .skill-card').length > 0);
    };
    const ids = () => page.locator('#pageSkills .skill-card').evaluateAll(cards => cards.map(card => card.dataset.marketId));
    await openSkills();
    assert.equal(await page.locator('#pageSkills .capability-page-header').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px');
    assert.equal(await page.locator('#skillSourceSwitch [data-skill-source="system"]').getAttribute('aria-selected'), 'true');
    const systemIds = await ids();
    assert.ok(systemIds.includes('code-simplifier'), 'system tab lists bundled skills');
    assert.ok(!systemIds.includes('demo-personal-skill'), 'system tab hides personal skills');
    const layout = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      const header = box('#pageSkills .capability-page-header'), list = box('#pageSkills .skill-installed-list');
      const row = box('#pageSkills .skill-source-row'), pill = box('#skillSourceSwitch');
      const card = box('#pageSkills .skill-card'), logo = box('#pageSkills .skill-card-logo');
      const css = s => getComputedStyle(document.querySelector(s));
      return {
        aligned: Math.abs(header.left - list.left) <= 1 && Math.abs(header.right - list.right) <= 1,
        centered: Math.abs((row.left + row.right) / 2 - (pill.left + pill.right) / 2) <= 1,
        lowered: box('#pageSkills .capability-page-header h2').top > 60,
        cardRadius: css('#pageSkills .skill-card').borderRadius,
        logoRadius: css('#pageSkills .skill-card-logo').borderRadius,
        logoOverflow: css('#pageSkills .skill-card-logo').overflow,
        logoSize: [Math.round(logo.width), Math.round(logo.height)],
        cardWidth: Math.round(card.width)
      };
    });
    assert.deepEqual({ aligned: layout.aligned, centered: layout.centered, lowered: layout.lowered },
      { aligned: true, centered: true, lowered: true });
    assert.equal(layout.cardRadius, '0px');
    assert.equal(layout.logoRadius, '50%');
    assert.equal(layout.logoOverflow, 'hidden');
    await page.screenshot({ path: path.join(output, 'system.png') });
    await page.locator('#skillSourceSwitch [data-skill-source="personal"]').click();
    await page.waitForFunction(() => document.querySelector('#skillSourceSwitch [data-skill-source="personal"]')?.getAttribute('aria-selected') === 'true'
      && document.querySelectorAll('#pageSkills .skill-card').length === 1);
    assert.deepEqual(await ids(), ['demo-personal-skill']);
    await page.screenshot({ path: path.join(output, 'personal.png') });
    for (const width of [1600, 900, 720]) {
      await page.setViewportSize({ width, height: 900 });
      const fit = await page.evaluate(() => {
        const box = s => document.querySelector(s).getBoundingClientRect();
        const header = box('#pageSkills .capability-page-header'), list = box('#pageSkills .skill-installed-list');
        const row = box('#pageSkills .skill-source-row'), pill = box('#skillSourceSwitch');
        return {
          aligned: Math.abs(header.left - list.left) <= 1 && Math.abs(header.right - list.right) <= 1,
          centered: Math.abs((row.left + row.right) / 2 - (pill.left + pill.right) / 2) <= 1,
          inside: pill.left >= list.left && pill.right <= list.right
        };
      });
      assert.deepEqual(fit, { aligned: true, centered: true, inside: true }, `${width}px layout`);
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.locator('#pageSkills .skill-card').click();
    await page.locator('#skillModal[open]').waitFor();
    const removeButton = page.locator('#skillModal [data-modal-action="remove"]');
    assert.equal(await removeButton.isEnabled(), true);
    await removeButton.click();
    await page.locator('#removeSkillModal[open]').waitFor();
    assert.equal(await page.locator('#removeSkillDesc').count(), 0, 'skill name caption is removed');
    assert.equal(await page.locator('#removeSkillModal .remove-skill-note').textContent(), '再次调用此技能需重新安装。');
    const noteStyle = await page.locator('#removeSkillModal .remove-skill-note').evaluate(el => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderRadius, background: cs.backgroundColor };
    });
    assert.deepEqual(noteStyle, { radius: '999px', background: 'rgba(0, 0, 0, 0)' });
    assert.equal(await page.locator('#removeSkillCancel').textContent(), '取消');
    assert.equal(await page.locator('#removeSkillConfirm').textContent(), '删除 Skill');
    const layer = await page.evaluate(() => {
      const dialog = document.getElementById('removeSkillModal');
      const title = document.getElementById('removeSkillTitle');
      const box = title.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        skillOpen: document.getElementById('skillModal').open,
        confirmOpen: dialog.open,
        confirmOnTop: dialog.contains(top),
        topTag: top?.tagName || '',
        topId: top?.id || ''
      };
    });
    assert.deepEqual({ skillOpen: layer.skillOpen, confirmOpen: layer.confirmOpen, confirmOnTop: layer.confirmOnTop },
      { skillOpen: true, confirmOpen: true, confirmOnTop: true });
    await page.screenshot({ path: path.join(output, 'remove-confirm.png') });
    await page.locator('#removeSkillCancel').click();
    await page.waitForFunction(() => !document.getElementById('removeSkillModal').open);
    assert.equal(await page.locator('#skillModal').evaluate(el => el.open), true, 'skill detail stays open after cancel');
    await page.locator('#skillModal [data-modal-action="close"]').click();
    await page.waitForFunction(() => !document.getElementById('skillModal').open);
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await openSkills();
    assert.equal(await page.locator('#skillSourceSwitch [data-skill-source="personal"]').getAttribute('aria-selected'), 'true', 'selected tab persists');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, systemCount: systemIds.length, personal: ['demo-personal-skill'], layout }));
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
