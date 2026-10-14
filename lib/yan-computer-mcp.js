'use strict';

// Thin MCP adapter: native Cua schemas/actions, Yan's existing model capability
// flag and read_image path. No second vision provider or modality detector.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { PluginMcpClient } = require('./plugins/mcp-client');
const { resolveDriver, VERSION } = require('./cua-driver-runtime');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { createComputerControlStore } = require('./computer-control-store');
const { createControlLease, RELEASED } = require('./computer-control-lease');

async function resolveProcessExecutable(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return '';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Process -Id ${Number(pid)} -ErrorAction Stop).Path`], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
  return stdout.trim();
}

const EXPOSED_TOOLS = new Set([
  'list_apps', 'list_windows', 'get_window_state', 'verify_state', 'launch_app',
  'bring_to_front', 'set_window_frame', 'invoke_menu', 'click', 'double_click',
  'right_click', 'drag', 'type_text', 'press_key', 'hotkey', 'set_value', 'scroll',
  'get_screen_size', 'get_desktop_state', 'get_cursor_position', 'move_cursor',
  'check_permissions', 'start_session', 'escalate_session', 'get_session', 'end_session'
]);
const GUIDANCE = 'Ending computer control only returns input ownership: preserve all user applications, windows and playback. Never close the operated app as cleanup unless the user explicitly requested closing it. After the final computer action and outcome verification, call end_session and then Continual Harness schedule_refinement with evidence-backed application-specific experience before the final response. Existing experience is not a reason to skip review: confirm what was verified, changed or failed, without inventing novelty. Scheduling is not proof that experience was saved. Yan independently releases control and reviews the real trajectory at run end, including interrupted and failed runs. Yan Windows Computer Use (Cua Driver): discover the exact app and window, then take a fresh get_window_state before acting. Prefer element_token and background delivery. A new snapshot invalidates older tokens. Use screenshot coordinates only from that exact target and frame. Verify outcomes from fresh state; delivery alone is not success. Refusals do not authorize foreground or desktop escalation. Ordinary browsing uses Yan Built-in Browser. Screenshots are saved as local artifacts; text-only models can use the existing yan_media_read_image tool when visual interpretation is needed.';

function createComputerAdapter({ client, createClient, imageInput = false, imageDir, controlStore, createLease, resolveExecutable = resolveProcessExecutable }) {
  let catalog;
  let starting;
  let queue = Promise.resolve();
  const cancelled = new Set();
  let active;
  let released = false;
  const lease = createLease?.(() => {
    released = true;
    // Kill only the native input worker (including an in-flight drag/type). The
    // MCP adapter remains alive and returns a handoff result to the model loop.
    void client.close();
  });
  async function tools() {
    if (controlStore?.settings().enabled === false) throw new Error('电脑操控已关闭，请在设置 → 集成 → 电脑操控中启用。');
    if (released && starting) return starting;
    if (client.closed) throw new Error('Cua Driver 连接已关闭，请重启任务工具进程后重新观察桌面。');
    if (!starting) {
      starting = client.start().then(upstream => {
        catalog = new Map(upstream.filter(tool => EXPOSED_TOOLS.has(tool.name)).map(tool => [tool.name, tool]));
        const learned = controlStore ? controlStore.list().map(app => {
          try {
            const markdown = controlStore.experience(app.id).markdown.trim();
            return markdown ? `\n已记录的应用经验（${app.name}，${app.path}）：\n${markdown.slice(0, 4000)}` : '';
          } catch { return ''; }
        }).filter(Boolean).join('\n') : '';
        return [...catalog.values()].map(({ name, description, inputSchema, annotations }) => {
          // Native file-only capture suppresses image blocks. Yan already saves
          // captures and selects image delivery from the user's capabilities.
          const schema = JSON.parse(JSON.stringify(inputSchema));
          delete schema.properties?.screenshot_out_file;
          if (Array.isArray(schema.required)) schema.required = schema.required.filter(key => key !== 'screenshot_out_file');
          return { name, description: `${description}\n\n${GUIDANCE}${learned}\nYan manages screenshot files automatically; do not pass screenshot_out_file. ${imageInput
            ? 'This model is configured for image input: inspect attached screenshots directly; do not route them through a vision relay or browser.'
            : 'This model is configured for text-only input; use the existing read_image tool if visual interpretation is required.'}`, inputSchema: schema, annotations };
        });
      }).catch(error => { starting = null; throw error; });
    }
    return starting;
  }
  function call(id, name, args = {}) {
    const work = async () => {
      if (cancelled.has(id)) throw new Error('电脑操作已取消；重试前请读取最新状态。');
      if (controlStore?.settings().enabled === false) throw new Error('电脑操控已关闭，请在设置 → 集成 → 电脑操控中启用。');
      if (!EXPOSED_TOOLS.has(name)) throw new Error(`Unsupported computer tool: ${name}`);
      if (released && name === 'end_session') return { content: [{ type: 'text', text: '电脑操控已释放，任务可继续。' }] };
      if (lease && name !== 'end_session') {
        await lease.acquire();
        if (lease.isReleased?.()) throw new Error(RELEASED);
        // Only the desktop host can authorize a new user run after Esc.
        if (released && createClient) { client = createClient(); starting = null; released = false; }
      }
      if (released) {
        throw new Error(RELEASED);
      }
      await tools();
      if (cancelled.has(id)) throw new Error('电脑操作已取消；重试前请读取最新状态。');
      if (!catalog.has(name)) throw new Error(`Unsupported computer tool: ${name}`);
      if (released) throw new Error(RELEASED);
      // Preserve Cua's argument validation and target/capture semantics.
      const { screenshot_out_file: ignoredOutputPath, ...nativeArgs } = args;
      const pending = client.request('tools/call', { name, arguments: nativeArgs });
      active = { id, upstreamId: client.id };
      try {
        let result;
        try { result = await pending; } catch (error) { if (released) throw new Error(RELEASED); throw error; }
        if (released) throw new Error(RELEASED);
        if (name === 'end_session' && !result.isError) lease?.end();
        if (cancelled.has(id)) throw new Error('电脑操作已取消；已发送的输入不能撤销，请重新观察。');
        let recordedApp = null;
        // Discovery alone does not mean Yan has operated this app. Resolve the
        // real executable from the driver target PID, never from model text.
        if (controlStore && !result.isError && nativeArgs.pid && !['list_apps', 'list_windows', 'check_permissions'].includes(name)) {
          try { const exe = await resolveExecutable(nativeArgs.pid); if (exe) recordedApp = controlStore.record(exe); }
          catch { /* Protected/exited processes cannot always reveal their path. */ }
        }
          if (controlStore && !result.isError && name === 'launch_app' && nativeArgs.path) {
            try { recordedApp = controlStore.record(nativeArgs.path); } catch { /* Non-EXE launch targets are not application identities. */ }
          }
        const saved = [];
        const content = [];
        for (const block of result.content || []) {
          if (block.type !== 'image') { content.push(block); continue; }
          if (block.mimeType !== 'image/png' || typeof block.data !== 'string') throw new Error('Unsupported Cua screenshot format');
          const bytes = Buffer.from(block.data, 'base64');
          if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid Cua PNG screenshot');
          fs.mkdirSync(imageDir, { recursive: true });
          const file = path.join(imageDir, `${Date.now()}-${crypto.randomUUID()}.png`);
          fs.writeFileSync(file, bytes);
          saved.push(file);
          if (imageInput) content.push(block);
        }
        if (saved.length) content.push({ type: 'text', text: JSON.stringify({
          screenshot_paths: saved,
          guidance: imageInput ? 'Screenshots attached for the configured multimodal model.'
            : 'The configured model is text-only. Use the accessibility tree for semantic actions; for visual details call yan_media_read_image with this path and a focused prompt using the existing multimodal relay configuration.'
        }) });
        const structured = (saved.length || recordedApp) ? { ...(result.structuredContent || {}), ...(saved.length ? { screenshot_paths: saved } : {}), ...(recordedApp ? { computer_control_app: recordedApp } : {}) } : result.structuredContent;
        // Some MCP consumers project content only. Keep exact native element
        // tokens/capture ids available to DS as text as well as structuredContent.
        if (structured) content.unshift({ type: 'text', text: JSON.stringify(structured) });
        return { ...result, content, ...(structured ? { structuredContent: structured } : {}) };
      } finally { active = null; cancelled.delete(id); }
    };
    const result = queue.then(work);
    queue = result.catch(() => {}).finally(() => cancelled.delete(id));
    return result;
  }
  function cancel(id) {
    cancelled.add(id);
    if (active?.id === id) void client.notify('notifications/cancelled', { requestId: active.upstreamId, reason: 'Yan task cancelled' });
  }
  return { tools, call, cancel, close: () => { lease?.close(); return client.close(); } };
}

function startServer() {
  const driver = resolveDriver(__dirname + '/..');
  const createClient = () => new PluginMcpClient({
    id: 'cua-driver', type: 'local', command: driver.command, killTree: false,
    args: ['mcp', '--direct', '--no-overlay'], cwd: path.dirname(driver.command),
    env: { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false', CUA_DRIVER_PERMISSION_MODE: 'standard' },
    protocolVersion: '2025-06-18', timeoutMs: 150_000, maxResponseBytes: 32 * 1024 * 1024
  });
  const adapter = createComputerAdapter({ client: createClient(), createClient,
    createLease: onRelease => createControlLease(String(process.env.YAN_COMPUTER_DATA_DIR || process.cwd()), onRelease, process.env.YAN_COMPUTER_OWNER || ''),
    controlStore: createComputerControlStore(String(process.env.YAN_COMPUTER_DATA_DIR || process.cwd())),
    imageInput: process.env.YAN_COMPUTER_IMAGE_INPUT === 'true',
    imageDir: path.join(String(process.env.YAN_COMPUTER_DATA_DIR || process.cwd()), 'computer-screenshots')
  });
  const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const error = (id, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id,
    error: { code: -32603, message: String(message) } }) + '\n');
  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
    const { id, method, params = {} } = message;
    if (method === 'notifications/cancelled') { adapter.cancel(params.requestId); return; }
    if (id === undefined) return;
    try {
      if (method === 'initialize') return send(id, {
        protocolVersion: params.protocolVersion || '2025-03-26', capabilities: { tools: {} },
        serverInfo: { name: 'Yan Computer Use', version: VERSION }
      });
      if (method === 'ping') return send(id, {});
      if (method === 'tools/list') {
        if (!driver.available) throw new Error('Cua Driver 未就绪，请运行 npm run build:cua-driver。当前支持 Windows x64。');
        return send(id, { tools: await adapter.tools() });
      }
      if (method === 'tools/call') {
        try { return send(id, await adapter.call(id, params.name, params.arguments)); }
        catch (failure) { return send(id, { isError: true, content: [{ type: 'text', text: failure.message }] }); }
      }
      error(id, `Unsupported method: ${method}`);
    } catch (failure) { error(id, failure.message); }
  }
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) return;
    try { void handle(JSON.parse(line)); } catch { /* Ignore invalid JSON-RPC lines. */ }
  });
  lines.on('close', () => { void adapter.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    lines.close(); void adapter.close().finally(() => process.exit(0));
  });
}

if (require.main === module) startServer();
module.exports = { createComputerAdapter, EXPOSED_TOOLS, GUIDANCE };
