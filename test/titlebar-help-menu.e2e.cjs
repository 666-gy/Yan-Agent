'use strict';

// Title-bar 帮助 menu acceptance, verified in the real window:
//   1. 帮助 sits right of 文件, renders bold and uses the same strict flash;
//   2. the panel is a rounded surface with full-width rectangular options;
//   3. 检查更新…… runs the About page's own update flow (IPC + update dialog);
//   4. 关于 Yan Agent opens a Windows-style About box with logo, name,
//      version, release date and a right-aligned 确定, closable by 确定 / X / Esc.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-titlebar-help-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');

(async () => {
  let application;
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof newSession === 'function' && typeof checkForUpdatesFromAbout === 'function', null, { timeout: 60000 });
    await page.waitForSelector('#titlebarHelpMenuBtn');
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 20000 }).catch(async () => {
      await page.evaluate(() => {
        document.querySelector('#yanStartupHello')?.remove();
        const app = document.querySelector('#app');
        if (app) app.inert = false;
      });
    });

    // --- 1. trigger placement + weight --------------------------------------
    const placement = await page.evaluate(() => {
      const help = document.querySelector('#titlebarHelpMenuBtn');
      const file = document.querySelector('#titlebarFileMenuBtn');
      return {
        text: help.textContent.trim(),
        helpLeft: Math.round(help.getBoundingClientRect().left),
        fileRight: Math.round(file.getBoundingClientRect().right),
        weight: getComputedStyle(help).fontWeight
      };
    });
    assert.equal(placement.text, '帮助');
    assert.equal(placement.weight, '700');
    assert.ok(placement.helpLeft >= placement.fileRight, `帮助 must sit right of 文件: ${JSON.stringify(placement)}`);

    // --- 2. panel shape ------------------------------------------------------
    await page.click('#titlebarHelpMenuBtn');
    await page.waitForSelector('#titlebarHelpMenu:not(.hidden)');
    await page.waitForTimeout(220);
    const menu = await page.evaluate(() => {
      const el = document.querySelector('#titlebarHelpMenu');
      const panel = el.getBoundingClientRect();
      const items = [...el.querySelectorAll('.titlebar-menu-item')];
      return {
        radius: getComputedStyle(el).borderTopLeftRadius,
        borderLeft: parseFloat(getComputedStyle(el).borderLeftWidth) || 0,
        panelLeft: Math.round(panel.left),
        panelRight: Math.round(panel.right),
        labels: items.map(item => item.querySelector('.titlebar-menu-label').textContent.trim()),
        itemRadius: items.map(item => getComputedStyle(item).borderTopLeftRadius),
        itemLeft: items.map(item => Math.round(item.getBoundingClientRect().left)),
        triggerBackground: getComputedStyle(document.querySelector('#titlebarHelpMenuBtn')).backgroundColor,
        separators: el.querySelectorAll('.titlebar-menu-sep').length
      };
    });
    assert.equal(menu.radius, '14px');
    assert.deepEqual(menu.labels, ['新功能', '检查更新……', '关于 Yan Agent', '查看我们的官网', '赞赏我们一杯咖啡']);
    assert.equal(menu.separators, 2, '新功能 and the two branding entries each get their own separator');
    assert.ok(menu.itemRadius.every(radius => radius === '0px'), `options must be rectangular: ${menu.itemRadius}`);
    assert.ok(menu.itemLeft.every(left => Math.abs(left - (menu.panelLeft + menu.borderLeft)) <= 1), `options must touch the panel edge: ${menu.itemLeft} vs ${menu.panelLeft}+${menu.borderLeft}`);
    assert.equal(menu.triggerBackground, 'rgb(0, 0, 0)', 'dark theme trigger flash must be strict black');
    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-help-menu.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarHelpMenu.hidden', { state: 'attached' });

    // --- 3. 检查更新…… uses the About page update flow -----------------------
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('update:check');
      ipcMain.handle('update:check', () => new Promise(resolve => setTimeout(() => resolve({
        ok: true, hasUpdate: false, currentVersion: '1.8.0-beta.1-rc.5', latestVersion: '1.8.0-beta.1-rc.5'
      }), 700)));
    });
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="check-update"]');
    // The trigger itself reports progress while the real check is in flight.
    await page.waitForFunction(() => document.querySelector('#titlebarHelpMenuBtn')?.textContent.trim() === '正在检查更新……', null, { timeout: 5000 });
    assert.equal(await page.getAttribute('#titlebarHelpMenuBtn', 'aria-busy'), 'true');
    // Let the closed-menu flash fade so the shot shows the steady checking state.
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(evidenceDir, 'titlebar-help-checking.png') });
    await page.waitForSelector('#yan-update-dialog', { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.querySelector('#titlebarHelpMenuBtn').textContent.trim()), '帮助', 'the trigger label must restore after the check');
    assert.equal(await page.getAttribute('#titlebarHelpMenuBtn', 'aria-busy'), null);
    const updateTitle = await page.evaluate(() => document.querySelector('#yan-update-dialog #yan-update-title')?.textContent.trim());
    assert.equal(updateTitle, '已是最新版本', '检查更新…… must run the real update flow');
    await page.click('#yan-update-dialog .close');
    await page.waitForSelector('#yan-update-dialog', { state: 'detached', timeout: 10000 });

    // --- 4. 关于 Yan Agent ---------------------------------------------------
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="about"]');
    await page.waitForSelector('#titlebarAboutDialog[open]');
    const about = await page.evaluate(() => {
      const dialog = document.querySelector('#titlebarAboutDialog');
      const panel = dialog.getBoundingClientRect();
      const foot = dialog.querySelector('.about-dialog-foot').getBoundingClientRect();
      const ok = dialog.querySelector('.about-dialog-ok').getBoundingClientRect();
      const mark = dialog.querySelector('.about-dialog-mark:not([style*="display: none"])');
      const visibleMark = [...dialog.querySelectorAll('.about-dialog-mark')].find(img => getComputedStyle(img).display !== 'none');
      return {
        title: dialog.querySelector('#titlebarAboutTitle').textContent.trim(),
        headLogoVisible: [...dialog.querySelectorAll('.about-dialog-head-logo')].some(img => getComputedStyle(img).display !== 'none'),
        closeVisible: getComputedStyle(dialog.querySelector('.about-dialog-close')).display !== 'none',
        name: dialog.querySelector('.about-dialog-name').textContent.trim(),
        version: dialog.querySelector('#titlebarAboutVersion').textContent.trim(),
        date: dialog.querySelector('#titlebarAboutDate').textContent.trim(),
        okLabel: dialog.querySelector('.about-dialog-ok').textContent.trim(),
        markWidth: Math.round((visibleMark || mark).getBoundingClientRect().width),
        panelRadius: getComputedStyle(dialog).borderTopLeftRadius,
        okRightGap: Math.round(foot.right - ok.right),
        centered: Math.abs((panel.left + panel.right) / 2 - window.innerWidth / 2) <= 2,
        focused: document.activeElement?.className
      };
    });
    assert.equal(about.title, '关于 Yan Agent');
    assert.equal(about.headLogoVisible, true);
    assert.equal(about.closeVisible, true);
    assert.equal(about.name, 'Yan Agent');
    assert.equal(about.version, '版本 1.8.0 Beta1-RC5');
    assert.equal(about.date, '发布于 2026年10月28日');
    assert.equal(about.okLabel, '确定');
    assert.ok(about.markWidth >= 60, `the body mark must be a real logo: ${about.markWidth}`);
    assert.equal(about.panelRadius, '8px');
    assert.ok(about.okRightGap <= 20, `确定 must sit at the footer's right edge: ${about.okRightGap}`);
    assert.equal(about.centered, true);
    assert.match(String(about.focused), /about-dialog-ok/);
    await page.screenshot({ path: path.join(evidenceDir, 'about-dialog.png') });

    // 确定 closes and returns focus to the 帮助 trigger.
    await page.click('.about-dialog-ok');
    await page.waitForSelector('#titlebarAboutDialog', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'titlebarHelpMenuBtn');

    // Close button closes.
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="about"]');
    await page.waitForSelector('#titlebarAboutDialog[open]');
    await page.click('#titlebarAboutDialog .about-dialog-close');
    await page.waitForSelector('#titlebarAboutDialog', { state: 'hidden' });

    // Esc closes.
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="about"]');
    await page.waitForSelector('#titlebarAboutDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarAboutDialog', { state: 'hidden' });

    // --- 5. 新功能 -----------------------------------------------------------
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="whats-new"]');
    await page.waitForSelector('#titlebarWhatsNewDialog[open]');
    const whatsNew = await page.evaluate(() => {
      const dialog = document.querySelector('#titlebarWhatsNewDialog');
      const body = dialog.querySelector('.whats-new-body');
      const sections = [...dialog.querySelectorAll('.whats-new-section')];
      return {
        title: dialog.querySelector('#titlebarWhatsNewTitle').textContent.trim(),
        version: dialog.querySelector('#titlebarWhatsNewVersion').textContent.trim(),
        heroRadius: getComputedStyle(dialog.querySelector('.whats-new-hero')).borderTopLeftRadius,
        heroGradient: getComputedStyle(dialog.querySelector('.whats-new-hero')).backgroundImage !== 'none',
        heroCentered: (() => {
          const hero = dialog.querySelector('.whats-new-hero').getBoundingClientRect();
          const host = body.getBoundingClientRect();
          // clientWidth excludes the scrollbar, so this is the content center.
          return Math.abs((hero.left + hero.right) / 2 - (host.left + body.clientWidth / 2)) <= 2;
        })(),
        heroLogo: (() => {
          const img = dialog.querySelector('.whats-new-hero-logo');
          return !!img && img.complete && img.naturalWidth > 0;
        })(),
        headings: sections.map(section => section.querySelector('h3')?.textContent.trim() || ''),
        listCounts: sections.map(section => section.querySelectorAll('li').length),
        scrollable: body.scrollHeight > body.clientHeight,
        overflowY: getComputedStyle(body).overflowY,
        headLogo: [...dialog.querySelectorAll('.about-dialog-head-logo')].some(img => getComputedStyle(img).display !== 'none'),
        closeVisible: !!dialog.querySelector('[data-whats-new-close]')
      };
    });
    assert.equal(whatsNew.title, '本版本更新内容');
    assert.equal(whatsNew.version, 'Yan Agent v1.8.0 Beta1-RC5');
    assert.equal(whatsNew.heroRadius, '16px', 'the version must sit in the rounded plate');
    assert.equal(whatsNew.heroGradient, true, 'the plate must carry the gradient material');
    assert.equal(whatsNew.heroCentered, true, 'the plate must be centered in the body');
    assert.equal(whatsNew.heroLogo, true, 'the plate must show the logo');
    assert.deepEqual(whatsNew.headings, ['体验优化', 'bug修复']);
    assert.ok(whatsNew.listCounts.every(count => count > 0), `sections must be bullet lists: ${whatsNew.listCounts}`);
    assert.ok(whatsNew.listCounts.reduce((sum, count) => sum + count, 0) >= 10);
    assert.equal(whatsNew.overflowY, 'auto');
    assert.equal(whatsNew.scrollable, true, 'the notes must scroll instead of overflowing');
    assert.equal(whatsNew.headLogo, true);
    assert.equal(whatsNew.closeVisible, true);
    await page.screenshot({ path: path.join(evidenceDir, 'whats-new-dialog.png') });

    await page.evaluate(() => { const body = document.querySelector('.whats-new-body'); body.scrollTop = body.scrollHeight; });
    await page.waitForTimeout(150);
    await page.click('[data-whats-new-close]');
    await page.waitForSelector('#titlebarWhatsNewDialog', { state: 'hidden' });

    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="whats-new"]');
    await page.waitForSelector('#titlebarWhatsNewDialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarWhatsNewDialog', { state: 'hidden' });

    // --- 6. 查看我们的官网 ----------------------------------------------------
    const website = await page.evaluate(async () => {
      const result = await api.openWebsite('https://yanagent.top');
      const blocked = await api.openWebsite('https://example.com');
      const sneaky = await api.openWebsite('https://yanagent.top.evil.com');
      return { result, blocked, sneaky };
    });
    assert.equal(website.result.ok, true, 'the official site must open');
    assert.equal(website.result.url, 'https://yanagent.top');
    assert.equal(website.blocked.ok, false, 'other hosts are refused');
    assert.equal(website.sneaky.ok, false, 'lookalike hosts are refused');

    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="open-website"]');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.querySelector('#titlebarHelpMenu').classList.contains('hidden')), true);

    // --- 7. 赞赏我们一杯咖啡 --------------------------------------------------
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="donate"]');
    await page.waitForSelector('#titlebarDonateDialog[open]');
    const donate = await page.evaluate(() => {
      const dialog = document.querySelector('#titlebarDonateDialog');
      const img = dialog.querySelector('.donate-qr');
      const rect = img.getBoundingClientRect();
      return {
        title: dialog.querySelector('#titlebarDonateTitle').textContent.trim(),
        headLogo: [...dialog.querySelectorAll('.about-dialog-head-logo')].some(el => getComputedStyle(el).display !== 'none'),
        closeVisible: !!dialog.querySelector('[data-donate-close]'),
        alt: img.getAttribute('alt'),
        loaded: img.complete && img.naturalWidth > 0,
        width: Math.round(rect.width),
        radius: getComputedStyle(img).borderTopLeftRadius,
        buttons: dialog.querySelectorAll('button').length
      };
    });
    assert.equal(donate.title, '感谢你的支持');
    assert.equal(donate.headLogo, true);
    assert.equal(donate.closeVisible, true);
    assert.equal(donate.alt, '微信赞赏码');
    assert.equal(donate.loaded, true, 'the donation code image must load');
    assert.ok(donate.width > 150 && donate.width <= 300, `the code sits at a readable size: ${donate.width}`);
    assert.equal(donate.radius, '12px');
    await page.screenshot({ path: path.join(evidenceDir, 'donate-dialog.png') });

    await page.keyboard.press('Escape');
    await page.waitForSelector('#titlebarDonateDialog', { state: 'hidden' });
    await page.click('#titlebarHelpMenuBtn');
    await page.click('[data-titlebar-action="donate"]');
    await page.waitForSelector('#titlebarDonateDialog[open]');
    await page.click('[data-donate-close]');
    await page.waitForSelector('#titlebarDonateDialog', { state: 'hidden' });

    console.log('titlebar-help-menu.e2e: OK');
  } finally {
    try { await application?.close(); } catch { /* already closed */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('titlebar-help-menu.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
