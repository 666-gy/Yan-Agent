'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-coding-kernel-'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'ROOT_PROJECT_RULE_739: keep the existing module style.');
fs.writeFileSync(path.join(workspace, 'YAN.md'), 'YAN_PROJECT_RULE_739: verify syntax after edits.');
fs.writeFileSync(path.join(workspace, 'src', 'AGENTS.md'), 'SCOPED_RULE_739: applies only to src.');
const file = path.join(workspace, 'src', 'sample.js');
fs.writeFileSync(file, 'const value = 1;\n');
let calls = 0;
let parentRules = 0;
let childRules = 0;
let failedChecks = 0;
let passedChecks = 0;
let scopedRules = 0;
const failures = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8'); req.on('data', data => { raw += data; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const lastUser = body.messages.findLastIndex(message => message.role === 'user');
      const user = JSON.stringify(body.messages[lastUser]?.content || '');
      const child = user.includes('CHILD_CODING_739');
      const active = body.tools?.length && (child || user.includes('PARENT_CODING_739'));
      let delta = { content: 'fixture' };
      if (active) {
        assert.ok(body.tools.some(tool => tool.function?.name === 'lsp'), 'native semantic tool exposed');
        assert.ok(++calls < 50, 'no runaway loop');
        const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        assert.match(system, /ROOT_PROJECT_RULE_739/);
        assert.match(system, /YAN_PROJECT_RULE_739/);
        child ? childRules++ : parentRules++;
        const tools = body.messages.slice(lastUser + 1).filter(message => message.role === 'tool');
        const contents = tools.map(message => String(message.content));
        const latest = contents.at(-1) || '';
        let action;
        if (contents.some(text => text.includes('SCOPED_RULE_739'))) scopedRules++;
        if (!contents.some(text => /const value = 1/.test(text))) action = ['read', { filePath: file }];
        else if (child) delta = { content: 'Child read and verified rules.' };
        else if (!contents.some(text => text.includes('Yan verification: code changed'))) action = ['write', { filePath: file, content: 'const value = ;\n' }];
        else if (latest.includes('Yan check: syntax — failed')) {
          failedChecks++;
          action = ['edit', { filePath: file, oldString: 'const value = ;', newString: 'const value = 1;' }];
        } else if (!contents.some(text => text.includes('Yan check: syntax — passed'))) action = ['bash', { command: `node --check "${file}"` }];
        else if (!contents.some(text => text.includes('Child read and verified rules.'))) {
          passedChecks++;
          action = ['task', { subagent_type: 'explorer', description: 'Inspect module', prompt: 'CHILD_CODING_739 read ' + file }];
        } else delta = { content: 'Coding environment verified.' };
        if (action) delta = { tool_calls: [{ index: 0, id: `call-${calls}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] };
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'environment', model: body.model,
        object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
      emit(delta); emit({}, delta.tool_calls ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
    } catch (error) {
      failures.push(error.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
});
(async () => {
  const appRoot = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const codingEnvironmentModule = stageCodingEnvironmentModule({ appRoot, dataDir });
    const config = buildOpenCodeConfig({ providerId: 'fixture', modelId: 'fixture', codingEnvironmentModule, accessMode: 'full',
      apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, mcpServers: [], enableSubagents: true });
    const result = await sidecar.run({ runId: 'environment-test', providerId: 'fixture', modelId: 'fixture',
      workspace, hasUserWorkspace: true, workMode: 'normal', accessMode: 'full', openCodeConfig: config,
      prompt: 'PARENT_CODING_739 修复代码并检查。' });
    assert.deepEqual(failures, []);
    assert.equal(result.status, 'done', result.error);
    assert.ok(parentRules && childRules && failedChecks && passedChecks && scopedRules,
      JSON.stringify({ parentRules, childRules, failedChecks, passedChecks, scopedRules }));
    assert.equal(fs.readFileSync(file, 'utf8').trim(), 'const value = 1;');
    console.log(JSON.stringify({ ok: true, calls, parentRules, childRules, failedChecks, passedChecks, scopedRules }));
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close(); await stopped;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.ok(path.basename(root).startsWith('yan-coding-kernel-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
