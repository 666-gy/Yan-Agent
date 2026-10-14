'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startRun } = require('../lib/run-orchestrator');
const { createRunContext } = require('./helpers/run-context.cjs');

test('releasing computer input leaves the actual model run active and able to complete', async t => {
  const { createComputerAdapter } = require('../lib/yan-computer-mcp');
  const fixture = createRunContext(t);
  assert.equal((await startRun(fixture.ctx, { runId: 'esc-run', utility: true })).ok, true);
  let release, rejectInput;
  const client = {
    closed: false, id: 1,
    start: async () => [{ name: 'click', inputSchema: { type: 'object' } }],
    request: () => new Promise((resolve, reject) => { rejectInput = reject; }),
    close: async () => { client.closed = true; rejectInput?.(new Error('input worker closed')); }
  };
  const adapter = createComputerAdapter({ client, createLease: onRelease => {
    release = onRelease; return { acquire: async () => {}, close() {} };
  } });
  const action = adapter.call(1, 'click');
  await new Promise(resolve => setImmediate(resolve));
  release();
  await assert.rejects(action, /COMPUTER_CONTROL_RELEASED/);
  assert.equal(fixture.ctx.openCodeActiveRuns.has('esc-run'), true);
  assert.equal(fixture.calls.completed.length, 0);
  fixture.complete({ status: 'done', text: '电脑控制权已交还，继续整理结果。' });
  await fixture.idle;
  assert.equal(fixture.calls.completed[0].result.status, 'done');
});


test('remote model selection is per run and cannot select a disabled connection', async t => {
  const fixture = createRunContext(t);
  fixture.config.api.reasoningSpeed = 'medium';
  fixture.config.agentModel = {providerId:'original',supplierId:'original',modelId:'original'};
  Object.assign(fixture.ctx.providerConfig,{
    ensureProviderConfigs:()=>{},
    getEnabledConnections:()=>[{providerId:'remote',supplierId:'configured'}],
    getProviderModels:()=>[{id:'remote-text',modelType:'text'}]
  });
  let chosen;
  fixture.ctx.modelState.normalizeAgentModelSelection = cfg => {
    chosen = {selection:cfg.agentModel,reasoning:cfg.api.reasoningSpeed};
    return {...cfg.agentModel,modelType:'text'};
  };
  const modelSelection={providerId:'remote',supplierId:'configured',modelId:'remote-text'};
  assert.equal((await startRun(fixture.ctx,{runId:'remote-model',utility:true,prompt:'hello',modelSelection,reasoningMode:'high'})).ok,true);
  assert.equal(chosen.selection.modelId,'remote-text');assert.equal(chosen.reasoning,'high');
  assert.equal(fixture.config.agentModel.modelId,'original');assert.equal(fixture.config.api.reasoningSpeed,'medium');
  fixture.complete({status:'done',text:'done'});await fixture.idle;
  const denied=await startRun(fixture.ctx,{runId:'invalid-model',modelSelection:{...modelSelection,supplierId:'disabled'}});
  assert.equal(denied.ok,false);assert.equal(fixture.calls.provider.length,1);
});

test('selected plugins reach the core and model; disabling blocks later dispatch', async t => {
  const fixture = createRunContext(t);
  const store = require('../lib/plugins/store').createPluginStore(fixture.ctx.STABLE_DATA_DIR);
  require('../lib/plugins/catalog').createPluginCatalog(store).install('remotion');
  store.update('remotion', { enabled: true });
  const request = { runId: 'plugin-selection', utility: true, selectedPlugins: [{ id: 'remotion', name: 'forged name' }], prompt: '制作视频' };
  assert.equal((await startRun(fixture.ctx, request)).ok, true);
  const dispatched = fixture.calls.provider[0].request;
  assert.equal(dispatched.selectedPlugins[0].id, 'remotion');
  assert.notEqual(dispatched.selectedPlugins[0].name, 'forged name');
  assert.match(dispatched.prompt, /plugins_inspect/);
  assert.match(dispatched.prompt, /plugins_activate/);
  assert.deepEqual(fixture.calls.core[0].intent.selectedPlugins, dispatched.selectedPlugins);
  fixture.complete({ status: 'done', text: 'done' });
  await fixture.idle;
  store.update('remotion', { enabled: false });
  const rejected = await startRun(fixture.ctx, { ...request, runId: 'plugin-disabled' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /未启用/);
  assert.equal(fixture.calls.provider.length, 1);
  assert.equal(fixture.ctx.openCodeRunAdmissions.size, 0);
});

test('desktop agent mentions reach core and model with GUI routing and authoritative preferences', async t => {
  const fixture = createRunContext(t);
  fixture.config.externalAgents = { enabled: true, providers: { codex: { enabled: true }, claude: { enabled: true } } };
  const request = { runId: 'desktop-selection', utility: true, prompt: '实现功能并审查', selectedPlugins: [
    { id: 'external-agent:codex', name: 'forged' }, { id: 'external-agent:claude' }, { id: 'external-agent:codex' }
  ] };
  assert.equal((await startRun(fixture.ctx, request)).ok, true);
  const dispatched = fixture.calls.provider[0].request;
  assert.deepEqual(dispatched.selectedPlugins, [
    { id: 'external-agent:codex', name: 'Codex' }, { id: 'external-agent:claude', name: 'Claude' }
  ]);
  assert.deepEqual(fixture.calls.core[0].intent.selectedPlugins, dispatched.selectedPlugins);
  assert.match(dispatched.prompt, /yan_session_delegate_external_task/);
  assert.match(dispatched.prompt, /depends_on/);
  assert.match(dispatched.prompt, /yan_session_wait_external_tasks/);
  assert.doesNotMatch(dispatched.prompt, /explicitly selected these Yan plugins/);
  fixture.complete({ status: 'done', text: 'done' }); await fixture.idle;
  fixture.config.externalAgents.providers.claude.enabled = false;
  const rejected = await startRun(fixture.ctx, { ...request, runId: 'desktop-disabled' });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /Claude.*未启用/);
  assert.equal(fixture.calls.provider.length, 1);
  fixture.config.externalAgents.enabled = false;
  const legacy = await startRun(fixture.ctx, { ...request, runId: 'desktop-master-off', selectedPlugins: [{ id: 'external-agent:codex' }] });
  assert.equal(legacy.ok, false); assert.match(legacy.error, /Codex.*未启用/);
  assert.equal(fixture.ctx.openCodeRunAdmissions.size, 0);
});

test('annotation intent survives core normalization and vision relay stripping images', async t => {
  const fixture = createRunContext(t);
  const { normalizeIntent } = require('../lib/yan-core/protocol');
  const { imageEditContext } = require('../lib/image-edit-context');
  const annotated = require('path').join(fixture.ctx.STABLE_DATA_DIR, '标注.png');
  const intent = normalizeIntent({ prompt: '修改此图片：把圈里的杯子改为蓝色', attachments: [
    { path: annotated, name: '标注.png', mimeType: 'image/png', imageEdit: 'annotation' }
  ] });
  assert.equal(intent.attachments[0].imageEdit, 'annotation');
  assert.equal(imageEditContext([{ path: annotated }]), '', 'ordinary attachments do not force image editing');
  fixture.ctx.visionRelay.relayImagesForTextModel = async () => ({ prompt: 'Visual report: red circle on a cup', attachments: [] });
  assert.equal((await startRun(fixture.ctx, { ...intent, runId: 'annotated-image', utility: true })).ok, true);
  const dispatched = fixture.calls.provider[0].request;
  assert.match(dispatched.prompt, /yan_media_generate_image with source_path/);
  assert.match(dispatched.prompt, /Do not substitute Python/);
  assert.ok(dispatched.prompt.includes(JSON.stringify(annotated)));
  assert.equal(fixture.calls.core[0].intent.attachments[0].imageEdit, 'annotation');
  fixture.complete({ status: 'done', text: 'done' }); await fixture.idle;
});

test('retired work mode and saved experimental fields never reach the provider', async t => {
  const fixture = createRunContext(t);
  fixture.config.memory = { enabled: false };
  fixture.config.agent.workMode = 'agi';
  const result = await startRun(fixture.ctx, {
    runId: 'retired-mode', workMode: 'agi',
    reasoningSidepath: { required: true }, escalation: { steps: 3 },
    longHorizonContext: 'retired context', experienceEdgeContext: 'retired edges'
  });
  assert.equal(result.ok, true);
  const request = fixture.calls.provider[0].request;
  assert.equal(request.workMode, 'normal');
  for (const key of ['reasoningSidepath', 'escalation', 'longHorizonContext', 'experienceEdgeContext']) {
    assert.equal(request[key], undefined, key);
  }
  assert.equal(fixture.calls.core[0].configSnapshot.workMode, 'normal');
  fixture.complete({ status: 'done', text: 'done' });
  await fixture.idle;
});

test('configured reply and summary preferences reach the dispatched run', async t => {
  const fixture = createRunContext(t);
  Object.assign(fixture.config.agent, { replyVerbosity: 'high', reasoningSummary: 'none', sandboxMode: 'workspace-write' });
  assert.equal((await startRun(fixture.ctx, { runId: 'preferences', utility: true })).ok, true);
  assert.equal(fixture.calls.provider[0].request.replyVerbosity, 'high');
  assert.equal(fixture.calls.provider[0].request.reasoningSummary, 'none');
  assert.equal(fixture.calls.provider[0].request.sandboxMode, 'workspace-write');
  fixture.complete({ status: 'done', text: 'done' });
  await fixture.idle;
});

test('admission rejects compression, non-text models and pending concurrency without dispatch', async t => {
  for (const reason of ['compression', 'model', 'capacity']) {
    const { ctx, calls } = createRunContext(t);
    if (reason === 'compression') ctx.manualContextCompressions.add('session-1');
    if (reason === 'model') ctx.modelState.normalizeAgentModelSelection = () => ({ modelType: 'image' });
    if (reason === 'capacity') {
      ctx.openCodeActiveRuns.set('active', {});
      ctx.openCodeRunAdmissions.set('pending-1', '');
      ctx.openCodeRunAdmissions.set('pending-2', '');
    }
    const result = await startRun(ctx, { runId: 'rejected', yanSessionId: 'session-1' });
    assert.equal(result.ok, false, reason);
    assert.equal(calls.provider.length, 0);
    assert.equal(calls.core.length, 0);
    assert.equal(ctx.openCodeRunAdmissions.has('rejected'), false);
  }
});

test('admission reserves capacity before asynchronous setup', async t => {
  const fixture = createRunContext(t);
  fixture.ctx.MAX_CONCURRENT_AGENT_RUNS = 1;
  const first = startRun(fixture.ctx, { runId: 'first', utility: true });
  const second = await startRun(fixture.ctx, { runId: 'second' });
  assert.equal(second.ok, false);
  assert.equal((await first).ok, true);
  assert.equal(fixture.ctx.openCodeRunAdmissions.size, 0);
  fixture.complete({ status: 'done', text: 'done' });
  await fixture.idle;
  assert.equal(fixture.ctx.openCodeActiveRuns.size, 0);
});

test('core and skill failures clean up active runs without dispatching a provider', async t => {
  for (const reason of ['core', 'skills']) {
    const fixture = createRunContext(t);
    if (reason === 'core') fixture.core.startTurn = () => { throw new Error('core unavailable'); };
    else fixture.ctx.skillsRuntime.selectedRunSkills = async () => ({ error: 'skill unavailable' });
    const result = await startRun(fixture.ctx, { runId: 'failed', utility: true });
    assert.equal(result.ok, false);
    assert.equal(fixture.calls.provider.length, 0);
    assert.equal(fixture.ctx.openCodeActiveRuns.size, 0);
    assert.equal(fixture.ctx.openCodeRunAdmissions.size, 0);
    assert.deepEqual(fixture.calls.released, ['failed']);
    if (reason === 'skills') assert.equal(fixture.calls.completed[0].result.status, 'error');
  }
});

test('cancelled background turns settle as interrupted and release run state', async t => {
  const fixture = createRunContext(t);
  assert.equal((await startRun(fixture.ctx, { runId: 'utility-cancel', utility: true })).ok, true);
  assert.equal(fixture.ctx.openCodeActiveRuns.get('utility-cancel').utility, true);
  fixture.complete({ status: 'interrupted', text: '', error: '' });
  await fixture.idle;
  assert.equal(fixture.calls.completed[0].result.status, 'interrupted');
  assert.equal(fixture.calls.completed[0].result.error, '');
  assert.equal(fixture.ctx.openCodeActiveRuns.size, 0);
});

test('provider completion and rejection use the current window and release run state', async t => {
  for (const reject of [false, true]) {
    const fixture = createRunContext(t);
    let currentWindow = null;
    const sent = [];
    fixture.ctx.getMainWindow = () => currentWindow;
    assert.equal((await startRun(fixture.ctx, { runId: 'run', utility: true })).ok, true);
    currentWindow = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
    fixture.calls.provider[0].emit({ type: 'file.edited', data: { file: 'example.js' } });
    assert.equal(fixture.calls.events.at(-1).event.type, 'yan.review.invalidated');
    if (reject) fixture.fail(new Error('provider unavailable'));
    else fixture.complete({ status: 'done', text: 'done' });
    await fixture.idle;
    assert.equal(fixture.calls.completed[0].result.status, reject ? 'error' : 'done');
    assert.equal(sent[0][0], 'opencode:completed');
    assert.equal(sent[0][1].result.status, reject ? 'error' : 'done');
    assert.equal(fixture.ctx.openCodeActiveRuns.size, 0);
    assert.deepEqual(fixture.calls.released, ['run']);
  }
});

test('host reviews real control after finish, interruption and provider failure without a model refinement call', async t => {
  for (const outcome of ['done', 'finish', 'interrupted', 'reject']) {
    const fixture = createRunContext(t);
    const queued = [], reviewed = [];
    fixture.config.memory = { enabled: false };
    fixture.ctx.harnessBridge.registerHarnessRunContext = () => {};
    fixture.ctx.workspaceRuntime = { peekRepoMap: () => '' };
    fixture.ctx.harnessBridge.writeHarnessRefinementRequest = (_runId, request) => queued.push(request);
    fixture.ctx.reviewCompletedRunMemory = async payload => reviewed.push(payload);
    assert.equal((await startRun(fixture.ctx, { runId: `control-${outcome}`, memoryEnabled: false, utility: outcome === 'interrupted' })).ok, true);
    const emit = fixture.calls.provider[0].emit;
    emit({ type: 'message.part.updated', properties: { part: {
      type: 'tool', id: 'part-1', callID: 'call-1', tool: 'yan_computer_click',
      state: { status: 'completed', input: { pid: 123, x: 12, y: 34 },
        output: JSON.stringify({ computer_control_app: { id: 'music', name: '波点音乐', path: 'D:\\bodian\\bodian_pc.exe' } }) }
    } } });
    if (outcome === 'reject') fixture.fail(new Error('provider disconnected'));
    else fixture.complete({ status: outcome === 'interrupted' ? 'interrupted' : 'done', userRequestedFinish: outcome === 'finish', toolCalls: [], text: '结束' });
    await fixture.idle;
    assert.equal(queued.length, 1, outcome);
    assert.equal(reviewed.length, 1, outcome);
    assert.equal(reviewed[0].result.toolCalls.length, 1, outcome);
    assert.equal(queued[0].apps[0].name, '波点音乐', outcome);
    assert.equal(reviewed[0].result.status, outcome === 'reject' ? 'error' : outcome === 'interrupted' ? 'interrupted' : 'done');
  }
});

test('interrupted utility without computer control does not create an experience review', async t => {
  const fixture = createRunContext(t);
  let reviews = 0;
  fixture.ctx.reviewCompletedRunMemory = async () => { reviews++; };
  assert.equal((await startRun(fixture.ctx, { runId: 'plain-utility', utility: true })).ok, true);
  fixture.complete({ status: 'interrupted', toolCalls: [] });
  await fixture.idle;
  assert.equal(reviews, 0);
});
