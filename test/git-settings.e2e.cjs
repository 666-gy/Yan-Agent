const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-git-settings-'));
fs.mkdirSync(path.join(profile, 'YanData'));
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), '{}');
const output = path.join(process.cwd(), 'output/playwright/git-settings');
fs.mkdirSync(output, { recursive: true });
let app;
async function launch() {
  // Normal startup and renderer, isolated storage only. No YAN_E2E_MODE.
  const env = { ...process.env, YAN_E2E_USER_DATA_DIR: profile, YAN_DISABLE_SINGLE_INSTANCE: '1' };
  delete env.YAN_E2E_MODE;
  app = await _electron.launch({ executablePath: require('electron'), args: [process.cwd()], env });
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    page = app.windows().find(p => p.url().includes('/renderer/index.html'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(page, 'main window must be selected, not a startup window');
  await page.waitForFunction(() => window.__YAN_APP_READY__);
  return page;
}
(async () => {
  try {
    let page = await launch();
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-git').click();
    assert.deepEqual(await page.locator('.settings-nav-group-label').allTextContents(), ['个人', '集成', '编码', '模型']);
    assert.equal(await page.locator('#gitBranchPrefix').inputValue(), 'yan/');
    assert.equal(await page.locator('[data-git-setting="draftPr"]').isChecked(), true);
    await page.mouse.move(1900, 20);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async theme => { state.config = await api.setConfig({ theme }); applyTheme(theme); }, theme);
      await page.screenshot({ path: path.join(output, theme + '.png') });
    }
    const stacked = await page.locator('.git-setting-row').first().evaluate(row => row.querySelector('p').getBoundingClientRect().top >= row.querySelector('h3').getBoundingClientRect().bottom);
    assert.equal(stacked, true, 'description must sit beneath label');
    await page.locator('#gitBranchPrefix').fill('team/');
    await page.locator('#gitBranchPrefix').press('Tab');
    await page.waitForFunction(() => state.config.git.branchPrefix === 'team/');
    await page.locator('[data-git-setting="mergeMethod"][data-value="squash"]').click();
    await page.locator('[data-git-setting="forceWithLease"]').check();
    await page.locator('[data-git-setting="draftPr"]').uncheck();
    await page.locator('[data-git-setting="reviewMode"][data-value="separate"]').click();
    await page.evaluate(() => gitPreferenceSave);
    const instructions = { monitorInstructions: '检查失败时先读取日志\n不要修改无关代码', commitInstructions: '使用英文，包含正文', prInstructions: '先写目的，再写验证结果' };
    for (const [key, value] of Object.entries(instructions)) {
      const field = page.locator(`textarea[data-git-setting="${key}"]`);
      await field.fill(value); await field.press('Tab'); await page.evaluate(() => gitPreferenceSave);
    }
    await page.locator('[data-git-setting="autoMerge"]').check(); await page.evaluate(() => gitPreferenceSave);
    const expected = { branchPrefix: 'team/', mergeMethod: 'squash', forceWithLease: true, draftPr: false, reviewMode: 'separate', autoMerge: true, ...instructions };
    for (const key of Object.keys(instructions)) {
      const field = page.locator(`textarea[data-git-setting="${key}"]`);
      await field.focus();
      const style = await field.evaluate(el => {
        const s = getComputedStyle(el), outer = getComputedStyle(el.parentElement);
        return { lines: parseFloat(s.height) / parseFloat(s.lineHeight), resize: s.resize, outline: s.outlineStyle, shadow: s.boxShadow, outerOutline: outer.outlineStyle, border: outer.borderRadius };
      });
      assert.equal(style.lines, 6); assert.equal(style.resize, 'none'); assert.equal(style.outline, 'none'); assert.equal(style.shadow, 'none'); assert.equal(style.outerOutline, 'none'); assert.notEqual(style.border, '0px');
    }
    await page.screenshot({ path: path.join(output, 'instructions.png') });
    // Overflow scrolls instead of increasing the visible height.
    const field = page.locator('textarea[data-git-setting="prInstructions"]');
    await field.fill(Array.from({length: 10}, (_, i) => 'line ' + i).join('\n'));
    assert.equal(await field.evaluate(el => el.scrollHeight > el.clientHeight), true);
    await field.fill(instructions.prInstructions); await field.press('Tab'); await page.evaluate(() => gitPreferenceSave);
    await page.locator('#settings-tab-memory').click(); await page.locator('#memoryInstructions').focus();
    assert.deepEqual(await page.locator('#memoryInstructions').evaluate(el => [getComputedStyle(el).outlineStyle, getComputedStyle(el).boxShadow, getComputedStyle(el.parentElement).outlineStyle]), ['none', 'none', 'none']);
    await page.locator('#settings-tab-git').click();
    assert.deepEqual(await page.evaluate(async () => (await api.getConfig()).git), expected);
    await page.locator('#gitBranchPrefix').fill('bad prefix/'); await page.locator('#gitBranchPrefix').press('Tab');
    await page.evaluate(() => gitPreferenceSave);
    assert.equal(await page.locator('#gitBranchPrefix').inputValue(), 'team/');
    await app.close(); app = null;
    page = await launch();
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-git').click();
    assert.deepEqual(await page.evaluate(async () => (await api.getConfig()).git), expected);
    await page.screenshot({ path: path.join(output, 'saved.png') });
    await page.locator('#appRail [data-nav="tasks"]').click();
    // Keep the real composer/new-session route, replace only paid model submission.
    const routing = await page.evaluate(async () => {
      const original = submitMessage;
      const received = [];
      submitMessage = async (text, attachments, skills, options) => { received.push({ id: state.currentSession.id, workspace: state.currentSession.workspace, text }); };
      try {
        const before = state.currentSession.id;
        setComposerText('/review 检查错误处理'); await sendMessage();
        const separate = state.currentSession.id;
        state.config = await api.setConfig({ git: { reviewMode: 'inline' } });
        setComposerText('/review'); await sendMessage();
        return { before, separate, inline: state.currentSession.id, received };
      } finally { submitMessage = original; }
    });
    assert.notEqual(routing.before, routing.separate);
    assert.equal(routing.separate, routing.inline);
    assert.ok(routing.received[0].text.includes('检查错误处理'));
    assert.equal(routing.received.length, 2);
    // Verify merge confirmation is visible even though settings are parked.
    await page.evaluate(() => {
      const button = document.createElement('button'); button.dataset.taskGitPrMerge = '7';
      void mergeGitPullRequest(button);
    });
    await page.locator('#genericConfirmModal').waitFor({ state: 'visible' });
    assert.match(await page.locator('#genericConfirmTitle').textContent(), /压缩合并 PR #7/);
    await page.locator('#genericConfirmCancel').click();
    const generation = await page.evaluate(async workspace => {
      const originalLoop = runOpenCodeLoop, originalSelection = getAgentModelSelection, originalWorkspace = currentGitWorkspace, originalStatus = refreshTaskGitStatus;
      const requests = [];
      getAgentModelSelection = () => ({ modelType: 'text', providerId: 'openai', modelId: 'test-model' });
      currentGitWorkspace = () => workspace;
      refreshTaskGitStatus = async () => ({ isRepository: true, changes: [], currentBranch: 'main' });
      runOpenCodeLoop = async (session, el, context) => {
        requests.push(session.messages[0].content);
        return { content: session.title === 'Git Commit Message' ? 'Fix settings\n\nPreserve full commit body.' : '{"title":"Improve Git settings","body":"Verified persistence and workflow instructions."}' };
      };
      try {
        await generateTaskGitCommitMessage();
        await generateGitPrDescription();
        return { commit: $('#taskGitCommitMessageInput').value, title: $('#taskGitPrTitle').value, body: $('#taskGitPrBody').value, requests };
      } finally { runOpenCodeLoop = originalLoop; getAgentModelSelection = originalSelection; currentGitWorkspace = originalWorkspace; refreshTaskGitStatus = originalStatus; }
    }, profile);
    assert.equal(generation.commit, 'Fix settings\n\nPreserve full commit body.');
    assert.equal(generation.title, 'Improve Git settings');
    assert.match(generation.body, /Verified persistence/);
    assert.ok(generation.requests[1].includes('Pull Request 说明指引'));
    const monitoring = await page.evaluate(async workspace => {
      const originalSubmit = submitMessage, originalWorkspace = currentGitWorkspace, originalSelection = getAgentModelSelection;
      const oldId = state.currentSession.id;
      let received;
      currentGitWorkspace = () => workspace;
      getAgentModelSelection = () => ({ modelType: 'text', providerId: 'openai', modelId: 'test-model' });
      submitMessage = async text => { received = { text, id: state.currentSession.id, workspace: state.currentSession.workspace }; };
      try {
        const button = document.createElement('button'); button.dataset.taskGitPrMonitor = '7';
        await startGitPrMonitor(button);
        return { oldId, received };
      } finally { submitMessage = originalSubmit; currentGitWorkspace = originalWorkspace; getAgentModelSelection = originalSelection; }
    }, profile);
    assert.notEqual(monitoring.oldId, monitoring.received.id);
    assert.equal(monitoring.received.workspace, profile);
    assert.equal(monitoring.received.text, '/monitor-pr 7');
    console.log('PASS normal Electron startup, persisted Git instructions, six-line scrolling, neutral focus, review/monitor routing and commit/PR generation UI');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
