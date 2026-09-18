'use strict';

// Evolution-mode regression probe: reproduces the field report
// "模型想进化 → 被 AGENTS.md 拒绝 → 硬性写入 → 刚写入就被清空".
//
// Boots the real kernel with the coding-environment plugin in a workspace
// that has AGENTS.md + a pre-seeded .yanagent/harness/harness-state.json,
// drives a run whose task is a direct evolution write, then replays the
// post-run harness normalization (continual-harness load → apply review →
// atomicWrite) and checks whether the model's entry survived.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');
const continualHarness = require('../lib/continual-harness');

const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-evo-probe-'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspace, '.yanagent', 'harness'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'EVO_RULE_741: keep entries inside .yanagent/harness.\n');

const statePath = path.join(workspace, '.yanagent', 'harness', 'harness-state.json');
const seeded = {
  version: 1,
  entries: { memory: {}, prompt: {}, skill: {}, subagent: {} },
  refinements: []
};
fs.writeFileSync(statePath, JSON.stringify(seeded, null, 2));

const MODEL_ENTRY = {
  version: 1,
  entries: {
    memory: {
      'evo-741': {
        id: 'evo-741', kind: 'memory', title: 'Evolution entry 741',
        content: 'EVO_ENTRY_741: the model wrote this evolution directly.',
        path: 'general', scope: 'workspace', status: 'active', createdAt: Date.now()
      }
    },
    prompt: {}, skill: {}, subagent: {}
  },
  refinements: []
};

const requests = [];
const rejections = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      if (raw.includes('"messages"')) {
        requests.push(body);
        if (JSON.stringify(body.messages).includes('No file operation was performed')) {
          rejections.push('rules/package interposition');
        }
      }
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'evo-fixture', object: 'model' }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'evo', model: body.model,
        object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      const toolCallsSeen = JSON.stringify(body.messages).includes('"name":"write"');
      if (!toolCallsSeen) {
        emit({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function',
          function: { name: 'write', arguments: JSON.stringify({ filePath: statePath, content: JSON.stringify(MODEL_ENTRY, null, 2) }) } }] }, 'tool_calls');
      } else {
        emit({ role: 'assistant', content: 'Evolution entry written.' });
      }
      emit({}, 'stop');
      res.end('data: [DONE]\n\n');
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dataDir = path.join(root, 'data');
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir });
  try {
    const codingEnvironmentModule = stageCodingEnvironmentModule({ appRoot, dataDir });
    const config = buildOpenCodeConfig({
      providerId: 'fixture', modelId: 'evo-fixture', codingEnvironmentModule,
      accessMode: 'full', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      mcpServers: [], enableSubagents: false
    });
    const result = await sidecar.run({
      runId: 'evo-741', providerId: 'fixture', modelId: 'evo-fixture',
      workspace, hasUserWorkspace: true, workMode: 'normal', accessMode: 'full',
      openCodeConfig: config, prompt: 'EVO_TASK_741 把进化记录写入 .yanagent/harness/harness-state.json'
    });
    assert.equal(result.status, 'done', result.error);

    const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const survivedKernel = JSON.stringify(onDisk).includes('EVO_ENTRY_741');
    console.log('after kernel run: entry on disk =', survivedKernel);

    // Post-run harness normalization: exactly what applyReviewedHarnessState
    // does (load current disk state, apply reviewed edits, atomicWrite).
    const { ContinualHarnessStore } = continualHarness;
    const harnessStore = new ContinualHarnessStore({
      globalPath: path.join(dataDir, 'harness', 'harness-state.json'),
      yanagentDir: '.yanagent'
    });
    const state = harnessStore.load({ scope: 'workspace', workspace });
    state.entries.memory = state.entries.memory || {};
    state.entries.memory['review-741'] = {
      id: 'review-741', kind: 'memory', title: 'Reviewed evolution',
      content: 'REVIEW_741: post-run reviewed entry.', path: 'general',
      scope: 'workspace', status: 'active', createdAt: Date.now()
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const afterHarness = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const survivedHarness = JSON.stringify(afterHarness).includes('EVO_ENTRY_741');
    console.log('after harness normalization: model entry survived =', survivedHarness);
    console.log('rejections observed:', JSON.stringify(rejections));
    console.log('entries on disk after normalize:', Object.keys(afterHarness.entries?.memory || {}));
    console.log(JSON.stringify({ ok: survivedKernel && survivedHarness, survivedKernel, survivedHarness, rejections: rejections.length }));
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
