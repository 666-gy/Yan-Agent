'use strict';

// Real-kernel regression: Yan's plugin must shadow the built-in bash tool and
// the tool must return as soon as the launched command exits, even when a
// background grandchild keeps the inherited stdout/stderr pipe open. The
// built-in kernel tool waits for pipe EOF, so it used to block for the whole
// timeout on exactly this kind of command.
//
// The same kernel run also pins the Full Access contract at the integration
// level: Full Access makes the kernel stop asking for shell, so this is the path
// where the renderer never classifies anything. A destructive command must reach
// the shell there — the execution-layer gate defers to the mode the user chose.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-bash-tool-kernel-'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
// Parent process exits immediately; the detached grandchild inherits stdout and
// keeps it open for 6s, which is what made the built-in tool hang.
fs.writeFileSync(path.join(workspace, 'grandchild.js'), [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 6000)'], { stdio: 'inherit' });",
  'child.unref();',
  "console.log('E2E_BASH_DONE');"
].join('\n'));
fs.writeFileSync(path.join(workspace, 'doomed.txt'), 'Full Access must be able to delete this.');

const OVERRIDE_SIGNATURE = 'does not wait for background child processes';
const failures = [];
let overrideExposed = false;
let toolResultSeen = false;
let toolCallAt = 0;
let toolResultAt = 0;
let fullAccessAllowed = false;
let runtimeLogSeen = false;
let deleteCommand = 'rm doomed.txt';

const server = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw || '{}');
      const messages = body.messages || [];
      const lastUserIndex = messages.findLastIndex(message => message.role === 'user');
      const user = JSON.stringify(messages[lastUserIndex]?.content || '');
      const toolMessages = messages.slice(lastUserIndex + 1).filter(message => message.role === 'tool');
      const bashTool = (body.tools || []).find(tool => tool.function?.name === 'bash');
      let delta;
      if (bashTool && user.includes('E2E_BASH_MARK')) {
        if (String(bashTool.function.description || '').includes(OVERRIDE_SIGNATURE)) overrideExposed = true;
        if (process.platform === 'win32') assert.match(bashTool.function.description, /Windows PowerShell \(5\.1\)/);
        if (!toolMessages.length) {
          toolCallAt = Date.now();
          delta = { tool_calls: [{ index: 0, id: 'call-bash', type: 'function',
            function: { name: 'bash', arguments: JSON.stringify({ command: process.platform === 'win32' ? "Write-Output E2E_SHELL_OK; Write-Output ('E2E_PS_' + $PSVersionTable.PSVersion.Major); node grandchild.js" : "echo E2E_SHELL_OK; node grandchild.js", timeout: 20000 }) } }] };
        } else if (toolMessages.length === 1) {
          toolResultAt = Date.now();
          const content = String(toolMessages.at(-1)?.content || '');
          if (process.platform === 'win32') assert.match(content, /E2E_PS_5/);
          toolResultSeen = content.includes('E2E_BASH_DONE') && content.includes('E2E_SHELL_OK');
          delta = { tool_calls: [{ index: 0, id: 'call-doomed', type: 'function',
            function: { name: 'bash', arguments: JSON.stringify({ command: deleteCommand, timeout: 20000 }) } }] };
        } else if (toolMessages.length === 2) {
          const content = String(toolMessages.at(-1)?.content || '');
          fullAccessAllowed = !content.includes('Shell risk gate blocked');
          assert.ok(body.tools.some(tool => tool.function?.name === 'yan_runtime_log'));
          delta = { tool_calls: [{ index: 0, id: 'call-logs', type: 'function', function: { name: 'yan_runtime_log', arguments: JSON.stringify({ file: 'stability.log' }) } }] };
        } else {
          runtimeLogSeen = String(toolMessages.at(-1)?.content || '').includes('runtime-log-fixture');
          delta = { content: 'E2E_BASH_TOOL_OK' };
        }
      } else {
        delta = { content: 'fixture' };
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (value, finish = null) => res.write('data: ' + JSON.stringify({ id: 'bash-tool',
        model: body.model, object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: value, finish_reason: finish }] }) + '\n\n');
      emit(delta);
      emit({}, delta.tool_calls ? 'tool_calls' : 'stop');
      res.end('data: [DONE]\n\n');
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
    const { resolveBashShell } = await import(
      pathToFileURL(path.join(appRoot, 'lib', 'kernel-bash-tool.mjs')).href
    );
    if (resolveBashShell().kind === 'cmd') deleteCommand = 'del doomed.txt';
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'stability.log'), 'runtime-log-fixture\n');
    const codingEnvironmentModule = stageCodingEnvironmentModule({ appRoot, dataDir });
    const config = buildOpenCodeConfig({ providerId: 'fixture', modelId: 'fixture', codingEnvironmentModule,
      terminalShell: 'powershell', accessMode: 'full', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      mcpServers: [], enableSubagents: false });
    const result = await sidecar.run({ runId: 'bash-tool-test', providerId: 'fixture', modelId: 'fixture',
      workspace, hasUserWorkspace: true, workMode: 'normal', accessMode: 'full', openCodeConfig: config,
      prompt: 'E2E_BASH_MARK run the grandchild command.' });
    assert.deepEqual(failures, []);
    assert.equal(result.status, 'done', result.error);
    assert.ok(String(result.text || '').includes('E2E_BASH_TOOL_OK'), JSON.stringify(result.text));
    assert.ok(overrideExposed, 'plugin bash tool did not shadow the kernel built-in');
    assert.ok(toolResultSeen, 'bash tool result missing the command output ');
    assert.ok(runtimeLogSeen, 'desktop runtime log tool must read the actual runtime log through the kernel');
    assert.ok(fullAccessAllowed, 'Full Access must not be blocked by the shell risk gate');
    assert.equal(fs.existsSync(path.join(workspace, 'doomed.txt')), false,
      'Full Access must actually let the destructive command run');
    const toolDuration = toolResultAt - toolCallAt;
    assert.ok(toolDuration > 0 && toolDuration < 4000, `bash tool blocked for ${toolDuration}ms; expected a prompt return`);
    console.log(JSON.stringify({ ok: true, toolDuration }));
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.basename(root).startsWith('yan-bash-tool-kernel-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
