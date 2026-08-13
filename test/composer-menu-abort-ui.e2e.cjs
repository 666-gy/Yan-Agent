'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-menu-abort-e2e-'));
const outputDir = path.join(appRoot, 'output', 'playwright');
const menuScreenshotPath = path.join(outputDir, 'composer-add-menu-compact.png');
const abortScreenshotPath = path.join(outputDir, 'task-abort-result.png');
fs.mkdirSync(outputDir, { recursive: true });

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
    await page.locator('#attachBtn').waitFor();

    await page.locator('#attachBtn').click();
    await page.locator('#attachmentMenu:not(.hidden)').waitFor();
    const menu = await page.evaluate(() => {
      const panel = document.querySelector('#attachmentMenu');
      const skillList = document.querySelector('#composerSkillMenuList');
      const actionText = [...panel.querySelectorAll('.composer-add-actions button')]
        .map(button => button.innerText.replace(/\s+/g, ' ').trim());
      const skillButtons = [...skillList.querySelectorAll('button')];
      return {
        height: panel.getBoundingClientRect().height,
        actionText,
        headings: [...panel.querySelectorAll('.composer-add-section-title')]
          .map(element => element.textContent.trim()),
        skillCount: skillButtons.length,
        skillNamesPresent: skillButtons.every(button => button.textContent.trim().length > 0),
        skillListScrollable: skillList.scrollHeight >= skillList.clientHeight
      };
    });
    assert.ok(menu.height <= 362, `附件面板高度应不超过 362px，实际为 ${menu.height}px`);
    assert.deepEqual(menu.headings, ['添加', '技能']);
    assert.deepEqual(menu.actionText, [
      '文件',
      '文件夹',
      '目标 设置要持续追求的目标',
      '计划模式 开启计划模式'
    ]);
    assert.ok(menu.skillCount > 0);
    assert.equal(menu.skillNamesPresent, true);
    assert.equal(menu.skillListScrollable, true);
    await page.screenshot({ path: menuScreenshotPath, fullPage: false });
    await page.locator('#attachBtn').click();

    await page.evaluate(() => {
      const sessionId = state.currentSession.id;
      const runCtx = createRunCtx(sessionId, true, state.currentSession.workspace || '');
      const assistantEl = appendMessage('assistant', '');
      renderAgentRunBody(assistantEl.querySelector('.msg-body'), {
        status: 'working',
        startedAt: Date.now(),
        timeline: [{ type: 'progress', content: '正在执行测试任务。' }]
      });
      state.activeRuns.set(sessionId, { sessionRef: state.currentSession, runCtx, assistantEl });
      applyAbortRunUi(sessionId);
    });

    const abortUi = await page.evaluate(() => {
      const message = [...document.querySelectorAll('.msg.assistant')].at(-1);
      const result = message.querySelector('.agent-run-error');
      return {
        text: result?.innerText || '',
        interruptedClass: result?.classList.contains('agent-run-interrupted') || false,
        oldNoteCount: message.querySelectorAll('.msg-abort-note').length,
        resultCount: message.querySelectorAll('.agent-run-error').length
      };
    });
    assert.match(abortUi.text, /已中止/);
    assert.match(abortUi.text, /用户手动中止输出/);
    assert.equal(abortUi.interruptedClass, true);
    assert.equal(abortUi.oldNoteCount, 0);
    assert.equal(abortUi.resultCount, 1);
    await page.screenshot({ path: abortScreenshotPath, fullPage: false });

    console.log(JSON.stringify({ ok: true, menu, menuScreenshotPath, abortScreenshotPath }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
