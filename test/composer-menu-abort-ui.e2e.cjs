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
const skillMenuScreenshotPath = path.join(outputDir, 'composer-skill-menu.png');
const skillTokenScreenshotPath = path.join(outputDir, 'composer-skill-token.png');
const userSkillMessageScreenshotPath = path.join(outputDir, 'user-skill-message.png');
const userSkillMessageLightScreenshotPath = path.join(outputDir, 'user-skill-message-light.png');
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
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#attachBtn').waitFor();

    await page.locator('#attachBtn').click();
    await page.locator('#attachmentMenu:not(.hidden)').waitFor();
    const menu = await page.evaluate(() => {
      const panel = document.querySelector('#attachmentMenu');
      const actionText = [...panel.querySelectorAll('#composerAddMainView > .composer-add-actions button:not(#appSnapshotAction):not(#promptOptimizerPill)')]
        .map(button => button.querySelector('.composer-add-action-name')?.textContent.trim());
      return {
        width: panel.getBoundingClientRect().width,
        composerWidth: document.querySelector('#composer').getBoundingClientRect().width,
        height: panel.getBoundingClientRect().height,
        actionText,
        skillListPresent: !!document.querySelector('#composerSkillMenuList'),
        workModeChoices: panel.querySelectorAll('#composerAddMainView [data-work-mode]').length,
        configHidden: panel.querySelector('#composerConfigView')?.classList.contains('hidden'),
        removedLaunchers: panel.querySelectorAll('#composerConfigAction, #composerPluginAction').length,
        launcherIcons: [...panel.querySelectorAll('#composerConfigAction > svg, #composerSkillAction > svg, #composerPluginAction > svg, #composerSubagentAction > svg')]
          .map(icon => icon.textContent.trim())
      };
    });
    assert.ok(Math.abs(menu.width - menu.composerWidth) <= 8);
    assert.ok(menu.height <= 360);
    assert.deepEqual(menu.actionText, [
      '添加附件',
      '绘图',
      '使用$选择技能',
      '目标',
      '计划模式'
    ]);
    assert.deepEqual(menu.launcherIcons, ['$']);
    assert.equal(menu.skillListPresent, true);
    assert.equal(menu.workModeChoices, 2);
    assert.equal(menu.configHidden, true);
    assert.equal(menu.removedLaunchers, 0);
    await page.waitForTimeout(220);
    const workModeMenu = await page.evaluate(() => {
      const panel = document.querySelector('#attachmentMenu');
      const baseHeight = Number(panel.dataset.baseHeight);
      const buttons = [...panel.querySelectorAll('#composerAddMainView [data-work-mode]')];
      return {
        baseHeight,
        height: panel.getBoundingClientRect().height,
        labels: buttons.map(button => button.querySelector('.composer-add-action-name')?.textContent.trim()),
        descriptions: buttons.map(button => button.querySelector('.composer-add-action-desc')?.textContent.trim()),
        heights: buttons.map(button => button.getBoundingClientRect().height),
        fontSizes: buttons.map(button => getComputedStyle(button.querySelector('.composer-add-action-name')).fontSize),
        iconMarkup: buttons.map(button => button.querySelector('svg:first-child')?.innerHTML),
        mainHidden: panel.querySelector('#composerAddMainView')?.classList.contains('hidden')
      };
    });
    assert.deepEqual(workModeMenu.labels, ['目标', '计划模式']);
    assert.deepEqual(workModeMenu.descriptions, ['设置要追求的目标', '开启计划模式']);
    assert.ok(workModeMenu.heights.every(height => height >= 32 && height <= 34), `工作方式按钮应为紧凑行高，实际 ${workModeMenu.heights.join(', ')}px`);
    assert.deepEqual(workModeMenu.fontSizes, ['13px', '13px']);
    assert.deepEqual(workModeMenu.iconMarkup, [
      '<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="3"></circle><path d="M22 2 13.5 10.5M16 2h6v6"></path>',
      '<path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M8.5 14.5A7 7 0 1 1 15.5 14.5c-.9.7-1.5 1.5-1.5 2.5h-4c0-1-.6-1.8-1.5-2.5Z"></path>'
    ]);
    assert.equal(workModeMenu.mainHidden, false);
    await page.screenshot({ path: menuScreenshotPath, fullPage: false });
    await page.locator('#attachBtn').click();

    const composerInput = page.locator('#composerInput');
    const openSkills = async () => {
      await page.evaluate(() => { input.focus(); setComposerCaretByTextOffset(getComposerText().length); });
      await page.keyboard.type('/');
      await page.locator('[data-composer-config="skills"]').click();
    };
    const skillChoices = page.locator('#composerConfigList [data-composer-config^="skill:"]');
    await composerInput.fill('folder/name');
    assert.equal(await page.locator('#attachmentMenu').evaluate(panel => panel.classList.contains('hidden')), true,
      'prompt 中间的 / 不应打开工作方式面板');
    await composerInput.fill('');
    await composerInput.fill('/');
    await page.waitForTimeout(220);
    const slashTrigger = await page.evaluate(() => ({
      menuHidden: document.querySelector('#attachmentMenu')?.classList.contains('hidden'),
      mainHidden: document.querySelector('#composerAddMainView')?.classList.contains('hidden'),
      configHidden: document.querySelector('#composerConfigView')?.classList.contains('hidden'),
      caretOffset: getComposerCaretTextOffset()
    }));
    assert.deepEqual(slashTrigger, { menuHidden: false, mainHidden: true, configHidden: false, caretOffset: 1 });
    await composerInput.press('Backspace');
    assert.equal(await composerInput.evaluate(element => element.value.trim()), '');
    assert.equal(await page.locator('#attachmentMenu').evaluate(panel => panel.classList.contains('hidden')), true,
      '删除开头的 / 后应关闭工作方式面板');

    await composerInput.fill('/');
    await page.waitForTimeout(220);
    await page.locator('[data-composer-config="goal"]').click();
    assert.equal(await composerInput.evaluate(element => element.value), '',
      '选择工作方式后应移除开头的 /');
    assert.equal(await page.locator('#attachmentMenu').evaluate(panel => panel.classList.contains('hidden')), true,
      '选择工作方式后应关闭工作方式面板');

    await openSkills();
    await page.waitForTimeout(220);
    const skillMenu = await page.evaluate(() => {
      const panel = document.querySelector('#attachmentMenu');
      const list = document.querySelector('#composerConfigList');
      const items = [...list.querySelectorAll('[data-composer-config^="skill:"]')];
      const first = items[0];
      return {
        baseHeight: Number(panel.dataset.baseHeight),
        heightLimit: Math.min(window.innerHeight * 0.5, 360),
        height: panel.getBoundingClientRect().height,
        itemCount: items.length,
        rowHeight: first?.getBoundingClientRect().height || 0,
        visibleRows: first ? Math.floor(panel.clientHeight / first.getBoundingClientRect().height) : 0,
        title: document.querySelector('#composerConfigTitle')?.textContent.trim(),
        names: items.slice(0, 6).map(item => item.querySelector('.composer-add-action-name')?.textContent.trim()),
        descriptions: items.slice(0, 6).map(item => item.querySelector('.composer-add-action-desc')?.textContent.trim()),
        descOverflow: first ? getComputedStyle(first.querySelector('.composer-add-action-desc')).textOverflow : '',
        mainHidden: document.querySelector('#composerAddMainView')?.classList.contains('hidden'),
        skillHidden: document.querySelector('#composerConfigView')?.classList.contains('hidden')
      };
    });
    assert.ok(skillMenu.height <= skillMenu.heightLimit + 2,
      `技能面板高度应适应窗口上限，实际 ${skillMenu.height}px`);
    assert.ok(skillMenu.itemCount >= 6, `技能面板至少应有 6 个技能，实际 ${skillMenu.itemCount}`);
    assert.ok(skillMenu.visibleRows >= 6);
    assert.equal(skillMenu.title, '技能');
    assert.ok(skillMenu.names.every(name => name.startsWith('$')));
    assert.ok(skillMenu.descriptions.every(Boolean));
    assert.equal(skillMenu.descOverflow, 'ellipsis');
    assert.equal(skillMenu.mainHidden, true);
    assert.equal(skillMenu.skillHidden, false);
    await page.screenshot({ path: skillMenuScreenshotPath, fullPage: false });
    await page.locator('#attachBtn').click();

    await composerInput.fill('普通$文本');
    assert.equal(await page.locator('#attachmentMenu').evaluate(panel => panel.classList.contains('hidden')), true,
      '普通字符后的 $ 不应打开技能面板');
    await composerInput.fill('/');
    await page.locator('[data-composer-config="skills"]').click();
    await page.waitForTimeout(220);
    const dollarTrigger = await page.evaluate(() => ({
      value: document.querySelector('#composerInput')?.value,
      caretOffset: getComposerCaretTextOffset(),
      menuHidden: document.querySelector('#attachmentMenu')?.classList.contains('hidden'),
      skillHidden: document.querySelector('#composerConfigView')?.classList.contains('hidden')
    }));
    assert.deepEqual(dollarTrigger, { value: '/', caretOffset: 1, menuHidden: false, skillHidden: false });

    await composerInput.fill('/hallmark');
    await page.waitForTimeout(220);
    const fuzzySkillSearch = await page.evaluate(() => ({
      names: [...document.querySelectorAll('#composerConfigList [data-composer-config^="skill:"] .composer-add-action-name')]
        .map(item => item.textContent.trim())
    }));
    assert.ok(fuzzySkillSearch.names.some(name => /^\$hallmark$/i.test(name)),
      `/hallmark 应筛选出 Hallmark，实际为 ${fuzzySkillSearch.names.join(', ')}`);

    await page.locator('[data-composer-config="skill:hallmark"]').click();
    const selectedFromDollar = await page.evaluate(() => ({
      value: document.querySelector('#composerInput')?.value,
      tokenCount: document.querySelectorAll('#composerInput [data-composer-skill-id]').length,
      tokenIds: [...document.querySelectorAll('#composerInput [data-composer-skill-id]')].map(token => token.dataset.composerSkillId),
      menuHidden: document.querySelector('#attachmentMenu')?.classList.contains('hidden')
    }));
    assert.equal(selectedFromDollar.value, '');
    assert.equal(selectedFromDollar.tokenCount, 1);
    assert.deepEqual(selectedFromDollar.tokenIds, ['hallmark']);
    assert.equal(selectedFromDollar.menuHidden, true);
    const skillTokenVisual = await page.evaluate(() => {
      const token = document.querySelector('#composerInput [data-composer-skill-id]');
      const wand = token?.querySelector('.composer-skill-wand');
      const name = token?.querySelector('.composer-skill-name');
      const tokenStyle = getComputedStyle(token);
      const wandStyle = getComputedStyle(wand);
      const nameStyle = getComputedStyle(name);
      return {
        contentEditable: token?.getAttribute('contenteditable'),
        childClasses: [...(token?.children || [])].map(child => child.className),
        color: tokenStyle.color,
        nameColor: nameStyle.color,
        backgroundColor: tokenStyle.backgroundColor,
        borderWidth: tokenStyle.borderTopWidth,
        borderStyle: tokenStyle.borderTopStyle,
        padding: tokenStyle.padding,
        wandMask: wandStyle.webkitMaskImage || wandStyle.maskImage
      };
    });
    assert.equal(skillTokenVisual.contentEditable, 'false');
    assert.deepEqual(skillTokenVisual.childClasses, ['composer-skill-wand', 'composer-skill-name']);
    assert.equal(skillTokenVisual.nameColor, skillTokenVisual.color);
    assert.equal(skillTokenVisual.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(skillTokenVisual.borderWidth, '0px');
    assert.equal(skillTokenVisual.borderStyle, 'none');
    assert.equal(skillTokenVisual.padding, '0px');
    assert.match(skillTokenVisual.wandMask, /prompt-optimizer\.svg/);
    await page.screenshot({ path: skillTokenScreenshotPath, fullPage: false });

    await openSkills();
    await page.waitForTimeout(220);
    await skillChoices.first().click();
    const twoSkillsFromDollar = await page.evaluate(() => ({
      value: document.querySelector('#composerInput')?.value,
      tokenIds: [...document.querySelectorAll('#composerInput [data-composer-skill-id]')].map(token => token.dataset.composerSkillId)
    }));
    assert.equal(twoSkillsFromDollar.value, '');
    assert.equal(twoSkillsFromDollar.tokenIds.length, 2);
    assert.equal(twoSkillsFromDollar.tokenIds[0], selectedFromDollar.tokenIds[0]);
    assert.notEqual(twoSkillsFromDollar.tokenIds[1], twoSkillsFromDollar.tokenIds[0]);

    const skillMentionLayout = await page.evaluate(() => {
      const composerTokens = [...document.querySelectorAll('#composerInput [data-composer-skill-id]')];
      const composerGap = composerTokens[1].getBoundingClientRect().left
        - composerTokens[0].getBoundingClientRect().right;
      const message = appendMessage(
        'user',
        '读取这个skill',
        [],
        false,
        -1,
        Date.now(),
        null,
        null,
        state.selectedSkills.slice(0, 2)
      );
      const body = message.querySelector('.msg-body');
      const mentions = [...body.querySelectorAll('.msg-skill-call')];
      const messageGap = mentions[1].getBoundingClientRect().left - mentions[0].getBoundingClientRect().right;
      const nameNode = mentions[0].querySelector('.msg-skill-name').firstChild;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let contentNode;
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.includes('读取这个skill')) { contentNode = walker.currentNode; break; }
      }
      const textRect = node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      const nameRect = textRect(nameNode);
      const contentRect = textRect(contentNode);
      const mentionStyle = getComputedStyle(mentions[0]);
      const wandStyle = getComputedStyle(mentions[0].querySelector('.msg-skill-wand'));
      const result = {
        composerGap,
        messageGap,
        mentionCount: mentions.length,
        childClasses: [...mentions[0].children].map(child => child.className),
        legacyImageCount: body.querySelectorAll('.msg-skill-call img').length,
        backgroundColor: mentionStyle.backgroundColor,
        borderWidth: mentionStyle.borderTopWidth,
        color: mentionStyle.color,
        composerColor: getComputedStyle(composerTokens[0]).color,
        wandMask: wandStyle.webkitMaskImage || wandStyle.maskImage,
        baselineDelta: Math.abs(nameRect.bottom - contentRect.bottom),
        message
      };
      window.__skillMentionMessage = message;
      delete result.message;
      return result;
    });
    assert.ok(skillMentionLayout.composerGap >= 5,
      `输入框内相邻 Skill 应空开一格，实际间距 ${skillMentionLayout.composerGap}px`);
    assert.ok(skillMentionLayout.messageGap >= 5,
      `用户消息内相邻 Skill 应空开一格，实际间距 ${skillMentionLayout.messageGap}px`);
    assert.equal(skillMentionLayout.mentionCount, 2);
    assert.deepEqual(skillMentionLayout.childClasses, ['msg-skill-wand', 'msg-skill-name']);
    assert.equal(skillMentionLayout.legacyImageCount, 0);
    assert.equal(skillMentionLayout.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(skillMentionLayout.borderWidth, '0px');
    assert.equal(skillMentionLayout.color, skillMentionLayout.composerColor);
    assert.match(skillMentionLayout.wandMask, /prompt-optimizer\.svg/);
    assert.ok(skillMentionLayout.baselineDelta <= 1,
      `Skill 昵称应与用户正文基线平齐，实际差值 ${skillMentionLayout.baselineDelta}px`);
    await page.screenshot({ path: userSkillMessageScreenshotPath, fullPage: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: userSkillMessageLightScreenshotPath, fullPage: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.evaluate(() => {
      window.__skillMentionMessage?.remove();
      delete window.__skillMentionMessage;
    });

    await openSkills();
    await page.waitForTimeout(220);
    await skillChoices.first().click();
    const threeSkillsWithButton = await page.evaluate(() => ({
      value: document.querySelector('#composerInput')?.value,
      caretOffset: getComposerCaretTextOffset(),
      tokenIds: [...document.querySelectorAll('#composerInput [data-composer-skill-id]')].map(token => token.dataset.composerSkillId)
    }));
    assert.equal(threeSkillsWithButton.value, '');
    assert.equal(threeSkillsWithButton.caretOffset, 0);
    assert.deepEqual(threeSkillsWithButton.tokenIds.slice(0, 2), twoSkillsFromDollar.tokenIds);
    assert.equal(threeSkillsWithButton.tokenIds.length, 3);

    await page.keyboard.type('  /');
    await page.locator('[data-composer-config="skills"]').click();
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#composerConfigView').evaluate(view => view.classList.contains('hidden')), false,
      '已选技能后的一个或多个空格再输入 / 应打开命令面板');
    await skillChoices.first().click();
    const skillAfterWhitespace = await page.evaluate(() => ({
      value: document.querySelector('#composerInput')?.value,
      tokenIds: [...document.querySelectorAll('#composerInput [data-composer-skill-id]')].map(token => token.dataset.composerSkillId)
    }));
    assert.equal(skillAfterWhitespace.value, '  ');
    assert.equal(skillAfterWhitespace.tokenIds.length, 4);
    assert.deepEqual(skillAfterWhitespace.tokenIds.slice(0, 3), threeSkillsWithButton.tokenIds);

    await composerInput.fill('/skills');
    await page.locator('[data-composer-config="skills"]').click();
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#composerConfigView').evaluate(view => view.classList.contains('hidden')), false,
      '/skills 应打开技能面板');
    await skillChoices.first().click();
    const selectedFromSlashDollar = await page.evaluate(() => ({
      value: document.querySelector('#composerInput')?.value,
      tokenCount: document.querySelectorAll('#composerInput [data-composer-skill-id]').length
    }));
    assert.deepEqual(selectedFromSlashDollar, { value: '', tokenCount: 1 });

    const integritySkill = await page.evaluate(() => {
      const skill = state.selectedSkills[0];
      setComposerText('', { preserveSkills: false });
      setComposerSkills([skill]);
      const name = document.querySelector('#composerInput .composer-skill-name');
      name.firstChild.insertData(2, '保留');
      document.querySelector('#composerInput').dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: '保留'
      }));
      return {
        value: document.querySelector('#composerInput').value,
        tokenCount: document.querySelectorAll('#composerInput [data-composer-skill-id]').length,
        selectedCount: state.selectedSkills.length
      };
    });
    assert.deepEqual(integritySkill, { value: '保留', tokenCount: 0, selectedCount: 0 });

    const deletedSkillCharacter = await page.evaluate(() => {
      const skill = installedSkillCatalog[0];
      setComposerText('', { preserveSkills: false });
      setComposerSkills([skill]);
      const name = document.querySelector('#composerInput .composer-skill-name');
      name.firstChild.deleteData(2, 1);
      document.querySelector('#composerInput').dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      return {
        value: document.querySelector('#composerInput').value,
        tokenCount: document.querySelectorAll('#composerInput [data-composer-skill-id]').length,
        selectedCount: state.selectedSkills.length
      };
    });
    assert.deepEqual(deletedSkillCharacter, { value: '', tokenCount: 0, selectedCount: 0 });

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

    const abortLifecycle = await page.evaluate(async () => {
      const session = { openCodeSessionId: 'poisoned-session' };
      syncSessionOpenCodeIdAfterRun(session, {
        status: 'interrupted',
        openCodeSessionId: 'poisoned-session'
      });

      const runCtx = createRunCtx('abort-before-start-ack', false, '');
      runCtx.runAbortController.abort();
      const cancellations = [];
      let errorName = '';
      try {
        await rejectStartedOpenCodeRunIfAborted(runCtx, 'late-start-run', async runId => {
          cancellations.push(runId);
          return { ok: true };
        });
      } catch (error) {
        errorName = error?.name || '';
      }
      return {
        openCodeSessionId: session.openCodeSessionId,
        cancellations,
        errorName
      };
    });
    assert.deepEqual(abortLifecycle, {
      openCodeSessionId: '',
      cancellations: ['late-start-run'],
      errorName: 'AbortError'
    });

    console.log(JSON.stringify({
      ok: true,
      menu,
      menuScreenshotPath,
      skillMenuScreenshotPath,
      skillTokenScreenshotPath,
      userSkillMessageScreenshotPath,
      userSkillMessageLightScreenshotPath,
      abortScreenshotPath
    }));
  } finally {
    await application?.close().catch(() => {});
    assert.equal(path.dirname(userDataDir), path.resolve(os.tmpdir()));
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn('Temporary Electron profile cleanup:', error.message); }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
