'use strict';
// Real primary-turn dispatch, kernel and plugin resources; only model replies are scripted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule, stageDeepSeekProviderModule } = require('../lib/opencode-sidecar');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-run-permissions-'));
const dataDir = path.join(root, 'data'), workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
const store = createPluginStore(dataDir); createPluginCatalog(store).install('remotion'); store.update('remotion', { enabled: true });
let step = 0; const failures = [];
const actions = [['plugins_inspect', { id: 'remotion' }], ['plugins_activate', { id: 'remotion' }], ['plugins_read_resource', { id: 'remotion', resource: 'skill:remotion-best-practices' }]];
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
    let delta;
    try {
      const body = JSON.parse(raw);
      if (!body.tools?.length) delta = { content: 'Summary' };
      else {
        assert.ok(body.tools.some(tool => tool.function.name === 'task'), 'Task remains exposed with subagents enabled');
        const action = actions[step++];
        delta = action ? { tool_calls: [{ index: 0, id: `plugin-step-${step}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] } : { content: 'PLUGIN_RUN_OK' };
      }
    } catch (error) { failures.push(error); delta = { content: `FAILED: ${error.message}` }; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    emit({ role: 'assistant', ...delta }); emit({}, delta.tool_calls ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
});
const unwrap = response => { assert.ok(!response.error, JSON.stringify(response.error)); return response.data; };
(async () => {
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const options = { accessMode: 'full', sandboxMode: 'full', enableSubagents: true, mcpServers: [] };
    const config = buildOpenCodeConfig({ ...options, providerId: 'deepseek', modelId: 'deepseek-test', dsml: true,
      codingEnvironmentModule: stageCodingEnvironmentModule({ appRoot, dataDir }), deepSeekProviderModule: stageDeepSeekProviderModule({ appRoot, dataDir }),
      apiKey: 'local-test', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, capabilities: { contextWindow: 64000, maxOutputTokens: 4096 } });
    let sessionID;
    for (const reuse of [false, true]) {
      step = 0;
      const result = await sidecar.run({ ...options, runId: `plugin-permissions-${reuse}`, providerId: 'deepseek', modelId: 'deepseek-test',
        workspace, hasUserWorkspace: true, openCodeConfig: config, openCodeSessionId: sessionID, prompt: 'Activate Remotion and read its router instructions.' },
      event => { if (event.type === 'yan.opencode.started') sessionID = event.data.sessionID; });
      assert.deepEqual(failures, []); assert.equal(result.status, 'done', result.error);
      const history = unwrap(await sidecar.client.session.messages({ sessionID, directory: workspace }));
      const calls = history.flatMap(message => message.parts || []).filter(part => part.type === 'tool').slice(-3);
      assert.equal(calls.length, 3); assert.ok(calls.every(call => call.state.status === 'completed'), JSON.stringify(calls));
      assert.equal(JSON.parse(calls[1].state.output).activated, true);
      assert.match(JSON.parse(calls[2].state.output).text, /Remotion/i);
      const info = unwrap(await sidecar.client.session.get({ sessionID, directory: workspace }));
      assert.ok(info.permission.some(rule => rule.permission === 'plugins_read_resource' && rule.action === 'allow'));
      if (!reuse) {
        // Reproduce the permissions left in the user's affected session; reuse must repair them.
        unwrap(await sidecar.client.session.update({ sessionID, directory: workspace, permission: [{ permission: 'task', pattern: '*', action: 'allow' }] }));
      }
    }
    console.log('PASS: subagents enabled; real primary dispatch activates/reads Remotion; Task remains available; damaged reused session permissions repaired.');
  } finally {
    const child = sidecar.server?.child, stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close(); await stopped; server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
