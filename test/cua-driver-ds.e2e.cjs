'use strict';

// Real Windows UIA + Cua MCP + Yan Kernel + DS adapter. Model replies are
// scripted locally; no paid model/account requests or user applications.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { OpenCodeSidecar, buildOpenCodeConfig, stageDeepSeekProviderModule } = require('../lib/opencode-sidecar');
const { createPluginStore } = require('../lib/plugins/store');
const { ensureInstalled } = require('../lib/plugins/computer-use');

const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cua-ds-'));
const title = `Yan Cua Test ${process.pid}`;
const errors = [];
const outputs = [];
let step = 0;
let pid;
let hwnd;
function completion(response, delta) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = { id: 'cua-test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-test',
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  chunk.choices = [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }];
  response.write(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  response.end();
}
function structuredFromLastTool(body) {
  const message = body.messages.filter(m => m.role === 'tool').at(-1);
  const text = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content);
  outputs.push(text);
  // The adapter projects native structuredContent as the first JSON line.
  for (const line of String(text).split('\n')) {
    try { const result = JSON.parse(line); if (result && typeof result === 'object') return result; } catch {}
  }
  throw new Error(`No native structured state in DS tool result: ${text.slice(0, 1000)}`);
}
const server = http.createServer((request, response) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    try {
      const body = JSON.parse(raw || '{}');
      if (!JSON.stringify(body.messages).includes('CUA_DS_COMPATIBILITY') || !body.tools?.length) return completion(response, { content: 'Test' });
      const names = body.tools.map(tool => tool.function.name);
      assert.ok(!names.includes('yan_computer_get_window_state'), 'Standalone MCP must be retired');
      const tool = action => {
        const name = names.find(name => name.startsWith('yanp_') && name.endsWith(`_computer_${action}`));
        assert.ok(name, `Activated computer tool missing: ${action}; available=${names.join(',')}`); return name;
      };
      let action;
      if (step === 0) action = ['plugins_activate', { id: 'yan-computer-use' }];
      else if (step === 1) {
        assert.equal(structuredFromLastTool(body).activated, true);
        action = [tool('list_windows'), { pid }];
      } else if (step === 2) {
        const state = structuredFromLastTool(body);
        const windows = state.windows || state;
        const win = Array.isArray(windows) ? windows.find(w => JSON.stringify(w).includes(title)) : null;
        assert.ok(win, JSON.stringify(state));
        hwnd = Number(win.window_id ?? win.id ?? win.hwnd);
        assert.ok(hwnd > 0);
        action = [tool('get_window_state'), { pid, window_id: hwnd, max_elements: 100, timeout_ms: 5000 }];
      } else if (step === 3) {
        const state = structuredFromLastTool(body);
        assert.ok(state.screenshot_paths?.length, 'Text model must receive a local screenshot artifact');
        assert.ok(fs.existsSync(state.screenshot_paths[0]));
        const button = state.elements?.find(e => e.label === 'Increment');
        assert.ok(button?.element_token, JSON.stringify(state));
        action = [tool('click'), { pid, window_id: hwnd, element_token: button.element_token, delivery_mode: 'background' }];
      } else if (step === 4) {
        const result = structuredFromLastTool(body);
        // Invoke delivery cannot certify the business outcome. Inspect a new
        // snapshot even when the driver reports an unverifiable effect.
        assert.ok(['confirmed', 'unverifiable'].includes(result.effect), JSON.stringify(result));
        assert.equal(result.delivery?.mode, 'background');
        action = [tool('get_window_state'), { pid, window_id: hwnd, include_screenshot: false, max_elements: 100, timeout_ms: 5000 }];
      } else {
        const state = structuredFromLastTool(body);
        assert.ok(String(state.tree_markdown).includes('Count 1'), JSON.stringify(state));
        return completion(response, { content: 'CUA_DS_OK: Count 1 verified.' });
      }
      step++;
      completion(response, { tool_calls: [{ index: 0, id: `cua-${step}`, type: 'function',
        function: { name: action[0], arguments: JSON.stringify(action[1]) } }] });
    } catch (error) { errors.push(error); completion(response, { content: `TEST_FAILED: ${error.message}` }); }
  });
});
function unwrap(result) { if (result.error) throw new Error(JSON.stringify(result.error)); return result.data; }

(async () => {
  if (process.platform !== 'win32') throw new Error('Windows GUI session required');
  const fixturePath = path.join(root, 'fixture.ps1');
  fs.writeFileSync(fixturePath, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class YanFixtureWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int mode); }'
$form = New-Object System.Windows.Forms.Form
$form.Text = '${title}'
$form.Width = 400; $form.Height = 220
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Count 0'; $label.AutoSize = $true; $label.Left = 30; $label.Top = 30
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Increment'; $button.Left = 30; $button.Top = 70; $button.Width = 130
$button.Add_Click({ $label.Text = 'Count 1' })
$form.Controls.Add($label); $form.Controls.Add($button)
$form.Add_Shown({ [YanFixtureWindow]::ShowWindow($form.Handle, 4) | Out-Null; [Console]::WriteLine('READY') })
[System.Windows.Forms.Application]::Run($form)
`, 'utf8');
  const fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fixturePath], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  pid = fixture.pid;
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir: path.join(root, 'data') });
  ensureInstalled(createPluginStore(path.join(root, 'data')));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 15_000);
      fixture.stdout.on('data', data => { if (String(data).includes('READY')) { clearTimeout(timer); resolve(); } });
      fixture.once('error', error => { clearTimeout(timer); reject(error); });
      fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exit ${code}`)); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = buildOpenCodeConfig({ providerId: 'deepseek', modelId: 'deepseek-test', dsml: true,
      deepSeekProviderModule: stageDeepSeekProviderModule({ appRoot, dataDir: path.join(root, 'data') }),
      apiKey: 'local-scripted-model', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      accessMode: 'full', enableSubagents: false,
      capabilities: { reasoning: true, imageInput: false, contextWindow: 131072, maxOutputTokens: 4096 },
      mcpServers: []
    });
    await sidecar.start(config);
    const directory = path.join(root, 'workspace'); fs.mkdirSync(directory);
    const result = await sidecar.run({
      runId: 'cua-new-session', workspace: directory, hasUserWorkspace: true,
      providerId: 'deepseek', modelId: 'deepseek-test', openCodeConfig: config,
      accessMode: 'full', workMode: 'normal', reasoningSummary: 'none',
      prompt: 'CUA_DS_COMPATIBILITY: Inspect the test window, click Increment once in background, and verify Count 1.'
    });
    if (errors.length) throw errors[0];
    assert.equal(result.status, 'done', result.error);
    assert.ok(result.text.includes('CUA_DS_OK'), result.text);
    assert.equal(step, 5);
    console.log('PASS: DS adapter -> plugin activation -> Cua native window discovery -> UIA snapshot + screenshot -> background click -> Count 1 verified.');
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close(); await stopped;
    fixture.kill();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error('Invalid test directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error('Last tool results:', outputs.slice(-2)); console.error(error); process.exitCode = 1; });
