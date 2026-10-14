'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-config-'));
const suppliers = [
  { id: 'supplier-a', name: 'Provider A', kind: 'custom', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', models: [{ id: 'text-a', name: 'Alpha', modelType: 'text' }, { id: 'image-a', name: 'Image', modelType: 'image' }] },
  { id: 'supplier-b', name: 'Provider B', kind: 'custom', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', models: [{ id: 'text-b', name: 'Beta', modelType: 'text' }] },
  { id: 'supplier-off', name: 'Disabled', kind: 'custom', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', models: [{ id: 'text-off', name: 'Hidden', modelType: 'text' }] }
];
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), JSON.stringify({ api: {
  provider: 'openai', model: 'text-a', connectionsMigrated: true, enabledConnections: ['supplier-a', 'supplier-b'],
  providerSuppliers: { openai: suppliers }, providerActiveSupplierIds: { openai: 'supplier-a' },
  connections: suppliers.map(supplier => ({ id: supplier.id, name: supplier.name, providerId: 'openai', supplierId: supplier.id, enabled: supplier.id !== 'supplier-off' }))
}, agentModel: { providerId: 'openai', supplierId: 'supplier-a', modelId: 'text-a', modelType: 'text' } }));
const evidence = path.join(root, 'output', 'playwright', 'composer-config');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    await page.setViewportSize({ width: 1400, height: 950 });
    const add = page.locator('#attachBtn');
    const menu = page.locator('#attachmentMenu');
    const input = page.locator('#composerInput');
    const config = async () => {
      await input.fill('');
      await input.fill('/');
      await page.locator('#composerConfigView:not(.hidden)').waitFor();
      await menu.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    };
    const command = id => page.locator(`[data-composer-config="${id}"]`);
    await add.click();
    assert.equal(await page.locator('#composerWorkModeAction, #composerWorkModeView').count(), 0);
    assert.equal(await page.locator('#composerConfigAction, #composerPluginAction').count(), 0);
    assert.equal(await page.locator('#composerSkillAction').count(), 1);
    assert.equal(await input.getAttribute('data-placeholder'), '与 Yan Agent 协作（按/选择配置，按$选择技能）');
    assert.equal(await page.locator('#composerSubagentAction, #composerSubagentView').count(), 0);
    assert.deepEqual(await page.locator('#composerAddMainView [data-work-mode]').evaluateAll(nodes => nodes.map(node => node.dataset.workMode)), ['goal', 'plan']);
    await page.screenshot({ path: path.join(evidence, 'add-panel.png') });
    await page.locator('#composerAddMainView [data-work-mode="goal"]').click();
    await page.waitForFunction(() => getCurrentWorkMode() === 'goal');
    await add.click();
    assert.equal(await page.locator('#composerAddMainView [data-work-mode="goal"]').getAttribute('aria-checked'), 'true');
    await page.locator('#composerAddMainView [data-work-mode="goal"]').click();
    await page.waitForFunction(() => getCurrentWorkMode() === 'normal');
    await config();
    const names = await page.locator('#composerConfigList .composer-add-action-name').allTextContents();
    assert.deepEqual(names, ['MCP', '侧边会话', '归档', '推理', '新聊天', '模型', '目标', '绘图', '置顶聊天', '虚拟宠物', '计划模式', '记忆', '重命名', '技能']);
    for (const [id, icon] of [['model', 'bot-droplet'], ['side', 'message-plus'], ['reasoning', 'lightbulb-on']]) {
      assert.equal(await command(id).locator('svg').getAttribute('data-keyline-icon'), icon);
    }
    for (const id of ['review', 'compact', 'status']) assert.equal(await command(id).count(), 0);
    const compactBounds = await menu.boundingBox();
    const composerBounds = await page.locator('#composer').boundingBox();
    assert.ok(Math.abs(compactBounds.width - composerBounds.width) <= 2 && compactBounds.height <= 360);
    const headerBefore = await page.locator('#composerConfigBack').boundingBox();
    await page.locator('#composerConfigList').evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.deepEqual(await page.locator('#composerConfigBack').boundingBox(), headerBefore);
    assert.ok(await page.locator('#composerConfigBack').evaluate(node => parseFloat(getComputedStyle(node).borderRadius) >= 14));
    await page.locator('#composerConfigList').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: path.join(evidence, 'config-dark.png') });
    await page.locator('#composerConfigBack').click();
    assert.equal(await page.locator('#composerAddMainView').isVisible(), true);
    await input.press('Escape');

    await input.fill('/plan');
    await command('plan').waitFor();
    assert.equal(await page.locator('#composerConfigList button').first().getAttribute('data-composer-config'), 'plan');
    await input.press('Enter');
    await page.waitForFunction(() => getCurrentWorkMode() === 'plan');
    assert.equal(await input.innerText(), '');
    assert.equal(await menu.isVisible(), false);
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    assert.equal(await page.evaluate(() => getCurrentWorkMode()), 'plan');
    await page.locator('#workModeIndicator').click();
    await page.waitForFunction(() => getCurrentWorkMode() === 'normal');
    await input.fill('/');
    await command('mcp').waitFor();
    await input.press('ArrowDown');
    assert.equal(await command('side').evaluate(node => node.classList.contains('is-highlighted')), true);
    await input.press('Escape');
    assert.equal(await input.innerText(), '/');
    await input.fill('/does-not-exist');
    await page.locator('#composerConfigList .skill-call-empty').waitFor();
    const session = await page.evaluate(() => state.currentSession.id);
    await input.press('Enter');
    assert.equal(await page.evaluate(() => state.currentSession.id), session);
    assert.equal(await input.innerText(), '/does-not-exist');
    await input.fill('/tmp/file.txt');
    assert.equal(await menu.isVisible(), false);
    await input.fill('');

    await config();
    await command('reasoning').click();
    assert.deepEqual(await page.locator('#composerConfigList .composer-add-action-name').allTextContents(), ['轻度', '中', '高', '极高', '最高']);
    await page.screenshot({ path: path.join(evidence, 'reasoning.png') });
    await command('reasoning:high').click();
    await page.waitForFunction(() => getReasoningSpeedMode() === 'high');
    assert.equal(await input.innerText(), '');
    await config();
    await command('model').click();
    await command('model:openai:supplier-b:text-b').waitFor();
    assert.deepEqual(await page.locator('#composerConfigList .composer-add-action-name').allTextContents(), ['Provider A / Alpha', 'Provider B / Beta']);
    assert.equal(await command('model:openai:supplier-a:text-a').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#modelQuickMenu').isVisible(), false);
    await page.screenshot({ path: path.join(evidence, 'models.png') });
    await command('model:openai:supplier-b:text-b').click();
    await page.waitForFunction(() => getAgentModelSelection().modelId === 'text-b');
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    assert.equal(await page.evaluate(() => getAgentModelSelection().modelId), 'text-b');
    assert.equal(await page.evaluate(() => getReasoningSpeedMode()), 'high');
    await config();
    await command('skills').click();
    await page.locator('[data-composer-config^="skill:"]').first().waitFor();
    const skill = await page.evaluate(() => curatedComposerSkillItems()[0]);
    assert.ok((await page.locator('#composerConfigList .composer-add-action-name').allTextContents()).every(name => name.startsWith('$')));
    await page.screenshot({ path: path.join(evidence, 'skills.png') });
    await input.press('Enter');
    assert.equal(await input.innerText(), skill.name);
    assert.deepEqual(await page.evaluate(() => state.selectedSkills.map(item => item.id)), [skill.id]);
    await page.evaluate(() => { setComposerSkills([]); setComposerText(''); });
    await input.fill(`正文 /${skill.id}`);
    await command(`skill:${skill.id}`).waitFor();
    await command(`skill:${skill.id}`).click();
    assert.equal(await page.evaluate(() => getComposerText()), '正文 ');
    assert.deepEqual(await page.evaluate(() => state.selectedSkills.map(item => item.id)), [skill.id]);
    await page.evaluate(() => { setComposerSkills([]); setComposerText(''); });
    await input.fill('$');
    await command(`skill:${skill.id}`).waitFor();
    await input.press('Enter');
    assert.deepEqual(await page.evaluate(() => state.selectedSkills.map(item => item.id)), [skill.id]);
    await page.evaluate(() => { setComposerSkills([]); setComposerText(''); });
    await input.fill(`正文 $${skill.id}`);
    await command(`skill:${skill.id}`).click();
    assert.equal(await page.evaluate(() => getComposerText()), '正文 ');
    await page.evaluate(() => { setComposerSkills([]); setComposerText(''); });
    await input.fill('保留正文');
    await add.click();
    await page.locator('#composerSkillAction').click();
    await command(`skill:${skill.id}`).click();
    assert.equal(await page.evaluate(() => getComposerText()), '保留正文');
    await page.evaluate(() => { setComposerSkills([]); setComposerText(''); });
    await input.fill('@');
    assert.equal(await menu.isVisible(), false);
    for (const text of ['￥', '￥plan', '正文 ￥general']) {
      await input.fill(text);
      assert.equal(await menu.isVisible(), false);
      assert.equal(await page.evaluate(() => getComposerText()), text);
      assert.equal(await page.evaluate(() => state.selectedSubagents.length), 0);
    }
    await input.fill('/model');
    await command('model').click();
    await command('model:openai:supplier-a:text-a').waitFor();
    await page.locator('#composerConfigBack').click();
    await command('skills').waitFor();
    await input.press('Escape');
    await config();
    await command('memory').click();
    await page.locator('#tab-memory:not(.hidden)').waitFor();
    await page.evaluate(() => closeSettings());
    await config();
    await command('rename').click();
    await page.locator('#renameTaskModal:not(.hidden)').waitFor();
    await page.locator('#renameTaskCancel').click();
    await config();
    await command('pin').click();
    await page.waitForFunction(() => state.currentSession.pinned === true);
    await config();
    assert.equal(await command('pin').locator('.composer-add-action-name').innerText(), '取消置顶聊天');
    await command('pin').click();
    await page.waitForFunction(() => !state.currentSession.pinned);
    await config();
    await command('side').click();
    await page.locator('#rs-interjection').waitFor({ state: 'visible' });
    await page.evaluate(() => closeRightSidebar());
    await config();
    await command('draw').click();
    await page.locator('#drawingBoard[open]').waitFor();
    await page.locator('#drawingBoard .drawing-close').click();
    await config();
    await command('mcp').click();
    await page.locator('#pageMcp:not(.hidden)').waitFor();
    await page.evaluate(() => switchSidebarNav('tasks'));
    await config();
    await command('new').click();
    await page.waitForFunction(previous => state.currentSession.id !== previous, session);
    await config();
    await page.evaluate(() => applyTheme('light'));
    await page.screenshot({ path: path.join(evidence, 'config-light.png') });
    for (const width of [768, 414, 375, 320]) {
      if (width < 768) await page.evaluate(() => setLeftSidebarOpen(false));
      await page.setViewportSize({ width, height: 860 });
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `Menu exceeds ${width}px viewport`);
      assert.ok(bounds.y >= 0, `Menu exceeds top at ${width}px`);
      await page.screenshot({ path: path.join(evidence, `config-${width}.png`) });
      for (const id of ['model', 'reasoning', 'skills']) {
        await command(id).click();
        if (id === 'model') await command('model:openai:supplier-a:text-a').waitFor();
        const childBounds = await menu.boundingBox();
        assert.ok(childBounds.x >= -1 && childBounds.x + childBounds.width <= width + 1 && childBounds.y >= 0);
        const first = page.locator('#composerConfigList button').first();
        const firstBounds = await first.boundingBox();
        const headerBounds = await page.locator('#composerConfigBack').boundingBox();
        assert.ok(firstBounds.y >= headerBounds.y + headerBounds.height, `${id} first row overlaps header`);
        await page.screenshot({ path: path.join(evidence, `${id}-${width}.png`) });
        await page.locator('#composerConfigBack').click();
      }
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.evaluate(() => switchSidebarNav('bot'));
    await config();
    assert.equal(await command('goal').isDisabled(), true);
    await command('skills').click();
    await page.locator('[data-composer-config^="skill:"]').first().click();
    assert.equal(await page.evaluate(() => state.selectedSkills.length), 1);
    assert.deepEqual(errors, []);
    console.log('Composer configuration passed: compact menus, fixed pill header, removed commands and subagent triggers, modes, slash skills, routes, persistence and responsive layouts.');
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { console.warn(`Temporary profile retained: ${error.message}`); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
