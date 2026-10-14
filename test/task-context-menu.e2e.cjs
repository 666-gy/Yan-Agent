'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-task-menu-'));
const workspace = path.join(userData, 'menu-workspace');
fs.mkdirSync(workspace);
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    const ids = await page.evaluate(async workspace => {
      const blank = state.currentSession.id;
      const session = await api.createSession(true, workspace);
      session.title = '菜单验收任务';
      session.messages = Array.from({ length: 64 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `完整消息 ${index}\n\n**Markdown**\n\n\`\`\`js\nconst n = ${index};\n\`\`\`` }));
      await api.saveSession(session); await refreshSessions();
      return { blank, target: session.id };
    }, workspace);
    const menu = page.locator('.task-context-menu').first();
    const button = label => page.locator('.task-context-menu').getByRole('menuitem', { name: label, exact: true });
    async function open(id = ids.target) {
      await page.locator(`.session-item[data-id="${id}"]`).first().click({ button: 'right' });
    }
    async function copy(label, id) {
      await app.evaluate(({ clipboard }) => clipboard.clear());
      await open(id); await button('复制').hover(); await button(label).click();
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await app.evaluate(({ clipboard }) => clipboard.readText())) return;
        await page.waitForTimeout(50);
      }
      throw new Error('Copy did not finish');
    }
    await open();
    assert.deepEqual(await menu.locator('button span').allTextContents(), ['重命名', '置顶', '标记为未读', '归档', '永久删除', '复制', '导出 JSON', '打开方式']);
    await button('重命名').click();
    await page.locator('#renameTaskInput').fill('改名后的任务');
    await page.locator('#renameTaskConfirm').click();
    await page.waitForFunction(id => state.sessions.find(s => s.id === id)?.title === '改名后的任务', ids.target);
    assert.equal(await page.evaluate(() => state.currentSession.id), ids.blank, 'renaming must not switch tasks');
    await open(); await button('置顶').click();
    await page.waitForFunction(id => state.sessions.find(s => s.id === id)?.pinned, ids.target);
    await open(); await button('标记为未读').click();
    assert.equal(await page.locator(`.session-item[data-id="${ids.target}"].is-unread`).count(), 1);
    await open(ids.blank); await button('标记为未读').click();
    await page.reload(); await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    assert.equal(await page.locator(`.session-item[data-id="${ids.blank}"].is-unread`).count(), 1);
    await open(); await button('标记为未读').click();
    await copy('复制工作目录');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), workspace);
    await copy('复制为 Markdown');
    const markdown = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.ok(markdown.startsWith('# 改名后的任务'));
    assert.ok(markdown.includes('完整消息 0') && markdown.includes('完整消息 63') && markdown.includes('```js'));
    assert.equal((markdown.match(/^## /gm) || []).length, 64);
    await copy('复制工作目录', ids.blank);
    const blankDirectory = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(path.basename(blankDirectory), crypto.createHash('sha256').update(ids.blank).digest('hex'));
    assert.equal(path.basename(path.dirname(blankDirectory)), 'no-workspace');
    assert.ok(fs.statSync(blankDirectory).isDirectory());
    // Verify the external app boundary without launching extra applications.
    await app.evaluate(({ ipcMain, shell }) => {
      global.__menuOpens = [];
      shell.openPath = async directory => { global.__menuOpens.push(['explorer', directory]); return ''; };
      for (const [channel, label] of [['vscode:launch', 'vscode'], ['powershell:open-external', 'terminal']]) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_e, { workspace }) => { global.__menuOpens.push([label, workspace]); return { ok: true }; });
      }
    });
    for (const label of ['VS Code', '文件资源管理器', '终端']) {
      await open(); await button('打开方式').hover(); await button(label).click();
    }
    assert.deepEqual(await app.evaluate(() => global.__menuOpens), [['vscode', workspace], ['explorer', workspace], ['terminal', workspace]]);
    await open(ids.blank); await button('打开方式').hover(); await button('文件资源管理器').click();
    assert.deepEqual((await app.evaluate(() => global.__menuOpens)).at(-1), ['explorer', blankDirectory]);
    await open(); await button('复制').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '复制工作目录');
    assert.equal(await button('复制深度链接').isDisabled(), false);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.task-context-menu').count(), 1);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.task-context-menu').count(), 0);
    fs.mkdirSync(path.join(root, 'output', 'playwright'), { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      for (const submenu of ['复制', '打开方式']) {
        await open(); await button(submenu).hover();
        const rects = await page.locator('.task-context-menu').evaluateAll(nodes => nodes.map(node => {
          const r = node.getBoundingClientRect(); return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
        }));
        assert.ok(rects.every(r => r.inside));
        await page.screenshot({ path: path.join(root, 'output', 'playwright', `task-menu-${theme}-${submenu === '复制' ? 'copy' : 'open'}.png`) });
        await page.locator('#composerInput').click();
      }
    }
    await page.locator(`.session-item[data-id="${ids.target}"]`).first().click();
    await page.waitForFunction(id => state.currentSession.id === id, ids.target);
    assert.equal(await page.locator(`.session-item[data-id="${ids.target}"].is-unread`).count(), 0);
    // The taskbar reuses the same actions with the compact Codex-style menu.
    const toolbar = page.locator('#taskBarMoreBtn');
    await toolbar.click();
    assert.deepEqual(await page.locator('#taskActionsMenu button span').allTextContents(), ['重命名任务', '取消置顶任务', '复制', '新建侧边会话', '打开方式', '导出 JSON', '归档本任务']);
    assert.equal(await page.locator('#taskActionsMenu kbd, #taskActionsMenu [aria-keyshortcuts]').count(), 0);
    assert.equal(await page.locator('#taskActionsMenu').evaluate(node => parseFloat(getComputedStyle(node).width)), 176);
    await button('取消置顶任务').click();
    await page.waitForFunction(id => !state.sessions.find(s => s.id === id)?.pinned, ids.target);
    await page.keyboard.press('Control+Alt+KeyP');
    await page.keyboard.press('Control+Alt+KeyR');
    await page.keyboard.press('Control+Shift+KeyA');
    assert.equal(await page.evaluate(() => state.currentSession.pinned), false);
    assert.equal(await page.locator('#renameTaskModal').isVisible(), false);
    assert.equal(await page.evaluate(() => state.currentSession.id), ids.target);
    await toolbar.click(); await button('重命名任务').click();
    await page.locator('#renameTaskInput').fill('工具栏菜单验收');
    await page.locator('#renameTaskConfirm').click();
    await page.waitForFunction(() => state.currentSession.title === '工具栏菜单验收');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await toolbar.click();
      await page.screenshot({ path: path.join(root, 'output', 'playwright', `task-toolbar-${theme}.png`) });
      await button('复制').hover();
      await page.screenshot({ path: path.join(root, 'output', 'playwright', `task-toolbar-${theme}-copy.png`) });
      await page.locator('#composerInput').click();
    }
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await toolbar.click(); await button('复制').hover(); await button('复制深度链接').click();
    await page.waitForTimeout(100);
    assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /^yanagent:/);
    const exportPath = path.join(userData, 'task-export.json');
    await app.evaluate(({ dialog }, exportPath) => {
      dialog.showSaveDialog = async (_owner, options) => {
        global.__exportOptions = options;
        return { canceled: false, filePath: exportPath };
      };
    }, exportPath);
    await toolbar.click(); await button('导出 JSON').click();
    await page.waitForFunction(() => document.body.innerText.includes('任务 JSON 已导出'));
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.equal(exported.schema, 'yan-agent.session');
    assert.equal(exported.session.id, ids.target);
    assert.equal(exported.session.messages.length, 64, 'exports the complete session, not the visible tail');
    assert.match(exported.session.messages[0].content, /完整消息 0/);
    await page.evaluate(() => {
      const ctx = createRunCtx(state.currentSession.id, true, ''); initOpenCodeRunState(ctx);
      ctx.runId = 'export-live';
      applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: { id: 'export-part', type: 'text', text: '' } } }, { deferEffects: true });
      applyOpenCodeEvent(ctx, { type: 'message.part.delta', data: { partID: 'export-part', field: 'text', delta: '当前已产生的内容' } }, { deferEffects: true });
      state.activeRuns.set(state.currentSession.id, { runCtx: ctx });
    });
    await toolbar.click(); await button('导出 JSON').click();
    for (let attempt = 0; attempt < 50; attempt++) {
      if (JSON.parse(fs.readFileSync(exportPath, 'utf8')).session.messages.at(-1)?.agentRun?.runId === 'export-live') break;
      await page.waitForTimeout(50);
    }
    const liveExport = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.equal(liveExport.session.messages.at(-1).agentRun.runId, 'export-live');
    assert.match(JSON.stringify(liveExport.session.messages.at(-1)), /当前已产生的内容/);
    await page.evaluate(() => state.activeRuns.delete(state.currentSession.id));
    assert.equal((await page.evaluate(id => api.getSession(id), ids.target)).messages.length, 64, 'export must not modify the conversation');
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    assert.deepEqual(await page.evaluate(id => api.exportSessionJson({ id }), ids.target), { canceled: true });
    assert.equal(await page.evaluate(() => typeof window.YanTrajectory), 'undefined');
    assert.equal(await page.locator('#rs-trajectory').count(), 0);
    await toolbar.click(); await button('归档本任务').click();
    await page.waitForFunction(id => !state.sessions.some(s => s.id === id), ids.target);
    assert.equal((await page.evaluate(() => api.listArchivedSessions())).some(s => s.id === ids.target), true);
    await page.evaluate(async id => { await api.setSessionsArchived([id], false); await refreshSessions(); }, ids.target);
    await open(); await button('永久删除').click();
    assert.equal(await page.locator('#deleteSessionModal').isVisible(), true);
    assert.ok(await page.evaluate(id => state.sessions.some(s => s.id === id), ids.target), 'deletion must wait for confirmation');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, fullMarkdownMessages: 64, blankDirectory: true, renameOtherTask: true, unreadPersistence: true, externalAppRouting: true }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
