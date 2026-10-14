const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-task-models-'));
const suppliers = ['x', 'y', 'z'].map((id, index) => ({ id: `supplier-${index}`, name: `Supplier ${index}`,
  kind: 'custom', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'isolated-test-key',
  models: [{ id, name: `Model ${id}`, modelType: 'text' }] }));
fs.mkdirSync(path.join(userDataDir, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(userDataDir, 'YanData', 'config.json'), JSON.stringify({ api: {
  provider: 'openai', model: 'x', connectionsMigrated: true, enabledConnections: suppliers.map(supplier => supplier.id),
  providerSuppliers: { openai: suppliers }, providerActiveSupplierIds: { openai: 'supplier-0' },
  connections: suppliers.map(supplier => ({ id: supplier.id, name: supplier.name, providerId: 'openai',
    supplierId: supplier.id, enabled: true }))
}, agentModel: { providerId: 'openai', supplierId: 'supplier-0', modelId: 'x', modelType: 'text' } }));
(async () => {
  let application;
  try {
    application = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir } });
    const page = await application.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const result = await page.evaluate(async () => {
      const catalog = await api.listQuickModels();
      const models = ['x', 'y', 'z'].map((id, index) => catalog.models.find(model =>
        model.id === id && model.supplierId === `supplier-${index}`));
      if (models.some(model => !model)) throw new Error('Missing seeded model catalog: ' + JSON.stringify(catalog.models.map(m => [m.id,m.supplierId])));
      const originalGlobal = JSON.stringify(getAgentModelSelection(null));
      const ids = [];
      for (const [index, model] of models.entries()) {
        await newSession({ forceNew: true });
        const session = state.currentSession;
        ids.push(session.id);
        session.messages = [{ role: 'user', content: `Task ${index}`, ts: Date.now() }];
        await saveCurrentSession(session);
        await refreshQuickModels();
        const option = document.createElement('button');
        option.dataset.modelPickerProvider = model.providerId;
        option.dataset.modelPickerSupplier = model.supplierId;
        option.dataset.modelPickerModel = model.id;
        await selectModelFromMenu(option);
        await selectReasoningSpeed(['low', 'high', 'max'][index], { notify: false });
      }
      const check = async () => {
        const selections = [];
        for (const id of ids) {
          await loadSession(id);
          selections.push({ id: getAgentModelSelection().modelId, supplier: getAgentModelSelection().supplierId,
            reasoning: getReasoningSpeedMode(), badge: document.querySelector('#modelPill').textContent,
            stored: (await api.getSession(id)).modelSelection.modelId });
        }
        return selections;
      };
      const before = await check();
      await loadSession(ids[0]);
      const ctx = createRunCtx(ids[0], false, '');
      ctx.remoteModelSelection = normalizeModelSelectionSnapshot(getAgentModelSelection());
      ctx.remoteReasoningMode = getReasoningSpeedMode();
      state.activeRuns.set(ids[0], { sessionRef: state.currentSession, runCtx: ctx, assistantEl: null });
      await loadSession(ids[1]);
      await selectTaskModel(models[2]);
      const runningModel = ctx.remoteModelSelection.modelId;
      state.activeRuns.delete(ids[0]);
      // A late selection result must stay attached to the task captured before
      // an asynchronous save, even if another task is now on screen.
      const taskB = state.currentSession;
      await loadSession(ids[2]);
      await selectTaskModel(models[1], taskB);
      const focusedModel = getAgentModelSelection().modelId;
      const globalBefore = JSON.stringify(getAgentModelSelection(null));
      let unavailable = false;
      try { await selectTaskModel({ ...models[0], id: 'removed' }); } catch { unavailable = true; }
      const globalAfter = JSON.stringify(getAgentModelSelection(null));
      const after = await check();
      // Exercise ordinary submitMessage (without onAccepted), including a
      // background task, and inspect the snapshots delivered to execution.
      const realLoop = runOpenCodeLoop;
      const submitted = [];
      runOpenCodeLoop = async (session, element, runCtx) => {
        submitted.push([session.id, runCtx.remoteModelSelection?.modelId,
          runCtx.remoteModelSelection?.supplierId, runCtx.remoteReasoningMode]);
        return { content: 'test response', agentRun: { status: 'done', timeline: [], textContent: 'test response' } };
      };
      try {
        for (const id of ids) {
          const session = await api.getSession(id);
          await submitMessage('Test isolated execution', [], [], { session });
        }
      } finally { runOpenCodeLoop = realLoop; }

      if (JSON.stringify(getAgentModelSelection(null)) !== originalGlobal) throw new Error('Task picker changed global default');
      state.config = await api.setModelRole(models[2].providerId, models[2].id, 'text', models[2].supplierId);
      await loadSession(ids[0]);
      const pinnedAfterDefaultChange = getAgentModelSelection().modelId;
      await newSession({ forceNew: true });
      const newTaskDefault = getAgentModelSelection().modelId;
      const legacy = await api.createSession(true, '');
      legacy.messages = [{ role: 'user', content: 'Legacy task', modelSelection: {
        providerId: models[1].providerId, supplierId: models[1].supplierId,
        modelId: models[1].id, modelType: 'text', name: models[1].name
      }, ts: Date.now() }];
      await api.saveSession(legacy);
      await loadSession(legacy.id);
      const migratedModel = getAgentModelSelection().modelId;

      return { ids, before, after, submitted, pinnedAfterDefaultChange, newTaskDefault, migratedModel, runningModel, focusedModel, unavailable, globalUnchanged: globalBefore === globalAfter };

    });
    assert.deepEqual(result.before.map(item => item.id), ['x', 'y', 'z']);
    assert.deepEqual(result.before.map(item => item.supplier), ['supplier-0', 'supplier-1', 'supplier-2']);
    assert.deepEqual(result.before.map(item => item.reasoning), ['low', 'high', 'max']);
    result.before.forEach(item => { assert.equal(item.stored, item.id); assert.ok(item.badge.includes(`Model ${item.id}`)); });
    assert.deepEqual(result.after.map(item => item.id), ['x', 'y', 'z']);
    assert.deepEqual(result.submitted, result.ids.map((id, index) => [id, ['x','y','z'][index], `supplier-${index}`, ['low','high','max'][index]]));
    assert.equal(result.pinnedAfterDefaultChange, 'x');
    assert.equal(result.newTaskDefault, 'z');
    assert.equal(result.migratedModel, 'y');
    assert.equal(result.runningModel, 'x');
    assert.equal(result.focusedModel, 'z');
    assert.equal(result.unavailable, true);
    assert.equal(result.globalUnchanged, true);
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const restored = await page.evaluate(async ids => {
      const models = [];
      for (const id of ids) { await loadSession(id); models.push([getAgentModelSelection().modelId, getReasoningSpeedMode()]); }
      return models;
    }, result.ids);
    assert.deepEqual(restored, [['x', 'low'], ['y', 'high'], ['z', 'max']]);
    console.log('PASS: independent task models, suppliers, reasoning, switching, persistence, and reload');
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
