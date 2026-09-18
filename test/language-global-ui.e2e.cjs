'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-language-global-e2e-'));

async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [appRoot],
    cwd: appRoot,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
  });
}

async function visibleChinese(page) {
  return page.evaluate(() => {
    const values = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue.trim();
      const element = node.parentElement;
      if (!text || !/[\u3400-\u9fff]/u.test(text) || !element) continue;
      if (element.closest('script, style, pre, code, .msg.user .msg-body, [data-preserve-language]')) continue;
      if (getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden') continue;
      values.push(text);
    }
    return [...new Set(values)];
  });
}

async function visibleChineseAttributes(page) {
  return page.evaluate(() => {
    const values = [];
    for (const element of document.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
      for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
        const value = element.getAttribute(name);
        if (value && /[\u3400-\u9fff]/u.test(value)) values.push(value);
      }
    }
    return [...new Set(values)];
  });
}

(async () => {
  let application;
  try {
    application = await launch();
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof yan !== 'undefined');
    await page.evaluate(() => yan.setConfig({ language: 'en' }));
    await page.reload();
    await page.waitForFunction(() => document.readyState === 'complete' && document.documentElement.dataset.language === 'en');

    const pages = [];
    const audit = async label => {
      await page.waitForTimeout(220);
      const remaining = await visibleChinese(page);
      pages.push({ label, remaining });
      assert.deepEqual(remaining, [], `${label} contains visible Chinese: ${remaining.join(' | ')}`);
      const remainingAttributes = await visibleChineseAttributes(page);
      assert.deepEqual(remainingAttributes, [], `${label} contains Chinese accessibility text: ${remainingAttributes.join(' | ')}`);
    };

    await audit('chat');
    await page.locator('[data-nav="skills"]').click();
    await audit('skills');
    await page.locator('[data-nav="mcp"]').click();
    await audit('mcp');
    await page.locator('#settingsBtn').click();
    for (const tab of ['about', 'general', 'api', 'model', 'vision-relay']) {
      await page.evaluate(tabId => document.querySelector(`[data-tab="${tabId}"]`)?.click(), tab);
      await audit(`settings-${tab}`);
    }

    console.log(JSON.stringify({ ok: true, language: 'en', auditedPages: pages.map(item => item.label) }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
