'use strict';

// Real kernel + staged bundle + native and recovered calls. No external model
// request or user session is used. Check the actual outbound history each turn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, stageGlmmProviderModule } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-glmm-runtime-'));
const workspace = path.join(directory, 'workspace');
fs.mkdirSync(workspace);
const file = path.join(workspace, 'adapter.txt');
fs.writeFileSync(file, 'GLMM adapter runtime fixture.\n');
const marker = 'GLMM_RUNTIME_REGRESSION';
const followupMarker = marker + '_FOLLOWUP';
const call = '<tool_call>read<arg_key>filePath</arg_key><arg_value>' + file + '</arg_value></tool_call>';
const reasoning = '  Read next. GLM examples use `<tool_call>` and `<arg_key>`.\nExact preserved reasoning.\n';
const answer = 'GLMM 工具循环完成。\n```xml\n' + call + '\n```';
const failures = [];
let requests = 0;
let failLastStep = false;
let previousRequest = null;
let prefixComparisons = 0;

const server = http.createServer((request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    try {
      const body = JSON.parse(raw);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish = null) => response.write('data: ' + JSON.stringify({
        id: 'glmm-runtime', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason: finish }]
      }) + '\n\n');
      if (!body.tools?.length || !JSON.stringify(body.messages).includes(marker)) {
        emit({ content: 'GLMM runtime' });
        emit({}, 'stop');
      } else {
        requests++;
        if (previousRequest) {
          assert.ok(JSON.stringify(body.tools) === JSON.stringify(previousRequest.tools), 'tool definitions must stay byte-identical');
          const changedIndex = previousRequest.messages.findIndex((message, index) => JSON.stringify(message) !== JSON.stringify(body.messages[index]));
          assert.equal(changedIndex, -1,
            `request ${requests} rewrote message ${changedIndex}: ` + JSON.stringify({
              before: previousRequest.messages[changedIndex], after: body.messages[changedIndex]
            }).slice(0, 2500));
          prefixComparisons++;
        }
        previousRequest = body;
        const history = body.messages.filter(message => message.role === 'assistant');
        for (const message of history) assert.equal(message.reasoning_content, reasoning, 'reasoning must replay exactly');
        if (body.model.startsWith('glm-5.3')) {
          assert.equal(body.thinking?.type, 'enabled');
          assert.equal(body.thinking?.clear_thinking, false);
          assert.equal(body.reasoning_effort, 'high');
          assert.equal(body.tool_stream, true);
        }
        const lastUserIndex = body.messages.findLastIndex(message => message.role === 'user');
        const currentTurn = JSON.stringify(body.messages[lastUserIndex].content);
        const followup = currentTurn.includes(followupMarker);
        assert.ok(currentTurn.includes(followup ? 'snapshot-after-edit.js' : 'snapshot-before-edit.js'));
        assert.ok(currentTurn.includes(followup ? '~30000 tokens/s' : '~6000 tokens/s'));
        assert.ok(!currentTurn.includes(followup ? 'snapshot-before-edit.js' : 'snapshot-after-edit.js'));
        for (const message of body.messages.filter(message => message.role === 'system')) {
          assert.doesNotMatch(JSON.stringify(message.content), /snapshot-(before|after)-edit|Recent effective input throughput/);
        }
        const step = body.messages.slice(lastUserIndex + 1).filter(message => message.role === 'tool').length;
        const maxSteps = followup ? 1 : 4;
        assert.ok(step <= maxSteps && requests <= (followup ? 7 : 5), 'no extra calls from quoted examples');
        for (const character of reasoning) emit({ reasoning_content: character });
        if (step < maxSteps && (step === 1 || step === 3)) {
          for (const character of call) emit({ content: character });
          emit({}, 'stop');
        } else if (step < maxSteps) {
          emit({ tool_calls: [{ index: 0, id: `read-${followup ? 'followup-' : ''}${step}`, type: 'function', function: { name: 'read', arguments: '' } }] });
          for (const character of JSON.stringify({ filePath: file })) emit({ tool_calls: [{ index: 0, function: { arguments: character } }] });
          emit({}, 'tool_calls');
        } else {
          for (const character of failLastStep ? '<tool_call>read<arg_key>' : answer) emit({ content: character });
          emit({}, 'stop');
        }
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      failures.push(error);
      console.error('GLMM mock validation failed:', error);
      // An assertion is terminal, not a transient socket failure to retry.
      response.end('data: ' + JSON.stringify({ error: { message: error.message, type: 'invalid_request_error' } }) + '\n\ndata: [DONE]\n\n');
    }
  });
});

(async () => {
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir: path.join(directory, 'data') });
  let kernelOutput = () => '';
  let kernelExit = null;
  const start = sidecar.start.bind(sidecar);
  sidecar.start = async (...args) => {
    const status = await start(...args);
    kernelOutput = sidecar.server.output;
    sidecar.server.child.once('exit', (code, signal) => { kernelExit = { code, signal }; });
    return status;
  };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const glmmProviderModule = stageGlmmProviderModule({ appRoot, dataDir: path.join(directory, 'data') });
    const results = [];
    for (const modelId of ['glm-5.3', 'glm-5.3-flash', 'future-alias', 'glm-5.3-broken']) {
      requests = 0;
      previousRequest = null;
      prefixComparisons = 0;
      failLastStep = modelId.endsWith('-broken');
      const providerId = 'conn-glm-test';
      const config = buildOpenCodeConfig({
        providerId, modelId, glmm: true, glmmProviderModule, workMode: 'normal', reasoningSpeed: 'medium',
        apiKey: 'local-test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        enableSubagents: false, mcpServers: [], capabilities: { maxOutputTokens: 8192 }
      });
      const events = [];
      const initialRequest = {
        runId: 'glmm-' + modelId, workspace, hasUserWorkspace: true,
        prompt: marker + ': read the fixture and explain the protocol.', providerId, modelId,
        workMode: 'normal', enableSubagents: false, openCodeConfig: config,
        measuredInputTokensPerSecond: 6000, repoMap: 'snapshot-before-edit.js'
      };
      const result = await sidecar.run(initialRequest, event => events.push(event)).catch(error => {
        console.error('Kernel output:', kernelOutput(), 'Exit:', kernelExit, 'Requests:', requests, 'Mock failures:', failures);
        const log = path.join(directory, 'data', 'opencode-runtime', 'data', 'opencode', 'log', 'opencode.log');
        if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-55).join('\n'));
        throw error;
      });
      assert.deepEqual(failures, []);
      assert.equal(result.status, failLastStep ? 'error' : 'done', result.error);
      if (failLastStep) {
        assert.match(result.error, /GLMM compatibility failed.*Incomplete Tool Call/);
        assert.equal(result.toolCalls.at(-1).status, 'error');
        assert.doesNotMatch(result.text, /本轮任务已完成/);
      }
      else {
        assert.equal(result.text, answer);
        assert.equal(events.some(event => event.type === 'session.error'), false);
      }
      const completedTools = result.toolCalls.filter(tool => tool.status === 'completed');
      assert.equal(completedTools.length, 4);
      assert.ok(completedTools.every(tool => tool.name === 'read'));
      assert.equal(requests, 5);
      if (!failLastStep) {
        const followupResult = await sidecar.run({
          ...initialRequest,
          runId: initialRequest.runId + '-followup',
          openCodeSessionId: result.openCodeSessionId,
          prompt: followupMarker + ': read the fixture once more.',
          measuredInputTokensPerSecond: 30000, repoMap: 'snapshot-after-edit.js'
        });
        assert.deepEqual(failures, []);
        assert.equal(followupResult.status, 'done', followupResult.error);
        assert.equal(followupResult.openCodeSessionId, result.openCodeSessionId, 'reuse the original kernel session');
        assert.equal(followupResult.text, answer);
        assert.equal(followupResult.toolCalls.length, 1);
        assert.equal(followupResult.toolCalls[0].status, 'completed');
        assert.equal(requests, 7);
      }
      assert.equal(prefixComparisons, requests - 1);
      results.push({ modelId, requests, userTurns: failLastStep ? 1 : 2, prefixComparisons, status: result.status });
    }
    console.log(JSON.stringify({ ok: true, reasoningReplay: 'exact', results }));
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yan-glmm-runtime-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
