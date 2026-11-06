'use strict';

const net = require('net');

const bridgePort = Number(process.env.YAN_BROWSER_BRIDGE_PORT || 0);
const bridgeToken = String(process.env.YAN_BROWSER_BRIDGE_TOKEN || '');
const networkAllowed = process.env.YAN_BROWSER_ALLOW_NETWORK !== 'false';
const activeCalls = new Map();
const MAX_BRIDGE_RESPONSE_BYTES = 16 * 1024 * 1024;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Browser MCP error') } });
}

function bridgeCall(action, params, signal) {
  if (!bridgePort || !bridgeToken) return Promise.reject(new Error('Yan built-in browser bridge is not configured.'));
  return new Promise((resolve, reject) => {
    const operationId = `browser-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    let input = '';
    const socket = net.createConnection({ host: '127.0.0.1', port: bridgePort });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!socket.destroyed) socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const onAbort = () => {
      const error = new Error('Yan built-in browser operation was cancelled.');
      error.name = 'AbortError';
      error.code = 'BROWSER_ACTION_CANCELLED';
      finish(error);
    };
    const timeoutMs = action === 'request_acceptance_upgrade' ? 610_000 : action === 'screenshot' ? 135_000 : 45_000;
    const timer = setTimeout(() => finish(new Error('Yan built-in browser bridge timed out.')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: bridgeToken, operationId, action, params })}\n`);
    });
    socket.on('data', chunk => {
      input += String(chunk || '');
      if (Buffer.byteLength(input, 'utf8') > MAX_BRIDGE_RESPONSE_BYTES) {
        finish(new Error('Yan built-in browser response exceeded the bridge limit.'));
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(input.slice(0, newline));
        if (!response?.ok) {
          const error = new Error(response?.error || 'Yan built-in browser bridge failed.');
          error.code = response?.code || 'YAN_BROWSER_BRIDGE_FAILED';
          finish(error);
        } else finish(null, response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      if (!settled) finish(new Error('Yan built-in browser bridge closed without a response.'));
    });
    if (signal?.aborted) onAbort();
  });
}

function toolDefinitions() {
  const tools = [
    {
      name: 'browser_apply_annotation',
      description: 'Apply text or CSS changes to the exact user-annotated element in its original tab, without opening another page. User settings from the annotation panel are automatically included; pass text for a requested text replacement. Only available for a task submitted from a browser annotation. Does not click links, execute arbitrary JavaScript or change server/source files. Returns read-back results; refresh clears this local preview. For project code changes edit the actual workspace files instead.',
      inputSchema: { type:'object', properties:{text:{type:'string',description:'Replacement visible text, only when requested by the user.'},styles:{type:'object',properties:{color:{type:'string'},background:{type:'string'},opacity:{type:'string'},fontFamily:{type:'string'},fontSize:{type:'string'},fontWeight:{type:'string'}},additionalProperties:false}},additionalProperties:false }
    },
    {
      name: 'open_builtin_browser',
      description: 'Navigate with action=open/back/forward/reload. Open a URL, search query, absolute local file, or workspace-relative preview. By default each task creates its own Agent-owned tab; subsequent calls in the same task use that tab. A user-opened tab or a tab left by an earlier turn in the same workspace and session can be reused only when explicitly requested with tab_id (from browser_list_tabs or browser_observe(mode="status")) or reuse:"scope"; reuse never takes over a tab another task is actively controlling. With tab_id and no url_or_path it attaches to the existing page without reloading it. Use it first for ordinary browsing, research, local previews, and website verification.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open', 'back', 'forward', 'reload'], default: 'open', description: 'Navigate or attach with open; back/forward/reload operate on the current task tab without opening another tab.' },
          target_type: { type: 'string', enum: ['url', 'search', 'file'], description: 'Use url for a complete HTTP(S) URL, search for a query, and file for an absolute or workspace-relative local path. Required unless attaching to an existing tab.' },
          url_or_path: { type: 'string', description: 'Complete HTTP(S) URL, search query, absolute file path, or path relative to the active Yan workspace. Omit together with tab_id to attach without navigating.' },
          tab_id: { type: 'string', description: 'Existing browser tab id from browser_list_tabs or browser_observe(mode="status") to take over explicitly. Must belong to the same workspace and session and must not be controlled by another running task.' },
          reuse: { type: 'string', enum: ['none', 'scope'], default: 'none', description: 'scope takes over the most recently used idle browser tab in the current workspace and session instead of opening a new one. Fails when no idle tab is available.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'browser_list_tabs',
      description: 'List browser tabs in the current workspace and session, including user-opened pages, with their tabId, URL, title, loading state and whether each one can be reused. Use it before open_builtin_browser with tab_id when the user asks to inspect an already open page or continue on a page an earlier turn left open. Does not open, attach or change any page.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'browser_observe',
      description: 'Observe the current tab. interactive returns fresh element refs for the latest snapshot and invalidates previous refs; text reads page text without changing refs; status reads lightweight tab metadata without running page JavaScript or changing refs. Use interactive before element actions.',
      inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['interactive', 'text', 'status'], default: 'interactive' } }, additionalProperties: false }
    },
    {
      name: 'browser_click',
      description: 'Click one element from the latest browser_observe(mode="interactive") by ref. Yan verifies that the intended element receives the event and reports whether the target or page changed; do not repeat the click or inspect source code when this result already confirms the expected state change.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from the latest browser_observe(mode="interactive") only, such as e3.' },
          button: { type: 'string', enum: ['left', 'right'], default: 'left' },
          click_count: { type: 'integer', enum: [1, 2], default: 1 }
        },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_fill',
      description: 'Replace the value of an input from the latest browser_observe(mode="interactive") and dispatch normal input/change events.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Fresh textbox or editable element ref.' },
          text: { type: 'string', description: 'Exact text to enter.' },
          submit: { type: 'boolean', default: false, description: 'Press Enter after entering the text.' }
        },
        required: ['ref', 'text'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_select',
      description: 'Choose one option in a native select element by exact value or visible label.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          value: { type: 'string', description: 'Exact option value or visible label.' }
        },
        required: ['ref', 'value'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_check',
      description: 'Set a checkbox, radio option, switch, or equivalent ARIA control to the requested checked state.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          checked: { type: 'boolean', default: true }
        },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_hover',
      description: 'Move the independent Agent pointer over an element to reveal hover UI without moving the user mouse.',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_drag',
      description: 'Drag from one fresh element ref to another using the independent Agent pointer.',
      inputSchema: {
        type: 'object',
        properties: { from_ref: { type: 'string' }, to_ref: { type: 'string' } },
        required: ['from_ref', 'to_ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_pointer',
      description: 'Operate canvas, maps, games, and other visual surfaces by viewport coordinates. Use only after a fresh screenshot or snapshot provides reliable coordinates.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['click', 'hover', 'drag'] },
          x: { type: 'number' },
          y: { type: 'number' },
          to_x: { type: 'number' },
          to_y: { type: 'number' },
          button: { type: 'string', enum: ['left', 'right'], default: 'left' }
        },
        required: ['action', 'x', 'y'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_press',
      description: 'Optionally focus ref without clicking, then press key if supplied. When pressing, verify that the page receives both keydown and keyup. Set duration_ms for games, editors, hold-to-repeat controls, or any page that reads continuous key state. Event delivery proves input reached the page; verify the intended business or visual result separately.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Optional fresh element ref to focus before pressing. Omit key for focus only; focusing does not click.' },
          key: { type: 'string', description: 'Key or chord such as Enter, ArrowRight, Space, or Control+S.' },
          duration_ms: { type: 'integer', minimum: 30, maximum: 5000, default: 80, description: 'How long to hold the key before releasing it. Use several hundred milliseconds for continuous movement.' }
        },
        anyOf: [{ required: ['key'] }, { required: ['ref'] }],
        additionalProperties: false
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the current Yan browser page, then take another snapshot if new targets are needed.',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          amount: { type: 'integer', minimum: 80, maximum: 2400 },
          ref: { type: 'string', description: 'Optional scrollable element ref. Omit to scroll the page.' }
        },
        required: ['direction'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_wait',
      description: 'Wait for text or an element state. Without a condition this is only a fixed delay, not proof the page has settled. Prefer an explicit condition.',
      inputSchema: {
        type: 'object',
        properties: {
          timeout_ms: { type: 'integer', minimum: 500, maximum: 15000, default: 1500 },
          text: { type: 'string', description: 'Optional exact page text to wait for.' },
          ref: { type: 'string', description: 'Optional fresh element ref to wait for.' },
          state: { type: 'string', enum: ['visible', 'hidden', 'enabled'], default: 'visible' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'browser_set_viewport',
      description: 'Set the built-in browser responsive viewport in CSS pixels for phone, tablet or desktop layout acceptance (for example 390x844 or 1440x900). The preview fits the sidebar without changing CSS breakpoints. Use reset to restore automatic sizing. Get a fresh snapshot/screenshot after resizing. This does not emulate a mobile OS, user agent or touch input.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 240, maximum: 3840 },
          height: { type: 'integer', minimum: 240, maximum: 3840 },
          reset: { type: 'boolean', default: false }
        }
      }
    },
    {
      name: 'browser_screenshot',
      description: 'Capture the visible Yan browser viewport together with capture-time page text. This is required evidence for visual acceptance of games, 3D, Canvas, WebGL, imagery, and layout; DOM existence and a clean console do not prove visual quality. Pass question to ask the visual observer about one specific detail, and compare_to_previous to send the previous frame plus the current frame for a before/after check.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Optional focused question for the visual observer about this frame (for example "双皮带是否可见").' },
          compare_to_previous: { type: 'boolean', default: false, description: 'Also send the previous screenshot of this run to compare before/after frames.' },
          full_size: { type: 'boolean', default: false, description: 'Return the full-resolution frame. Default downscales the longest edge to 1280px.' },
          force: { type: 'boolean', default: false, description: 'Capture even when the frame is identical to the previous screenshot. Default returns unchanged:true without transferring an image.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'browser_acceptance_sweep',
      description: 'One-call acceptance pass: wait for the page to settle, run declarative checks in a single pass, capture one frame, and return per-check results plus metrics. Prefer this over open + observe + read_page + screenshot + inspect_page as separate calls, which costs one model turn each. Supported check types: title_contains, url_contains, text_visible, element_exists, element_visible, no_horizontal_overflow, storage_equals, canvas_present, webgl_context_ok, no_console_errors.',
      inputSchema: {
        type: 'object',
        properties: {
          checks: {
            type: 'array',
            maxItems: 20,
            description: 'Declarative checks evaluated in the page, for example [{"type":"title_contains","value":"Dashboard"},{"type":"element_visible","selector":"main"}]',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['title_contains', 'url_contains', 'text_visible', 'element_exists', 'element_visible', 'no_horizontal_overflow', 'storage_equals', 'canvas_present', 'webgl_context_ok', 'no_console_errors'] },
                value: { type: 'string' },
                selector: { type: 'string' },
                key: { type: 'string' },
                session: { type: 'boolean' }
              },
              required: ['type'],
              additionalProperties: false
            }
          },
          settle_ms: { type: 'integer', minimum: 0, maximum: 15000, default: 4000, description: 'Maximum wait for commit, two frames, fonts and pending images before checking.' },
          include_performance: { type: 'boolean', default: false, description: 'Sample ~600 ms of requestAnimationFrame for fps and maxFrameMs.' },
          full_size: { type: 'boolean', default: false, description: 'Return the full-resolution frame instead of the 1280px default.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'browser_inspect_page',
      description: 'Inspect page readiness, document size, forms, invalid fields, broken images, Canvas diagnostics (WebGL context state instead of pixel sampling), resource failures and timings, recent console errors, and load errors. Set include_performance to sample real frame rate and max frame time. Use this for Yan browser diagnostics instead of opening Playwright merely to read the same page console.',
      inputSchema: { type: 'object', properties: { include_performance: { type: 'boolean', default: false, description: 'Sample ~600 ms of requestAnimationFrame to report fps and maxFrameMs. Adds latency; use it when smoothness matters.' } }, additionalProperties: false }
    },
    {
      name: 'browser_eval',
      description: 'Evaluate JavaScript in the page and return the last expression value (like the DevTools console). Use it for acceptance checks the structured tools cannot express: localStorage/sessionStorage persistence after reload, WebGL context state, custom counters, or reading page-owned telemetry. Set storage=true to dump localStorage and sessionStorage without writing an expression.',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'JavaScript evaluated in the page. The last statement value is returned (for example "document.title" or "JSON.stringify(window.__state)"). Max 8000 characters.' },
          storage: { type: 'boolean', default: false, description: 'Return localStorage and sessionStorage snapshots instead of evaluating expression.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'browser_search_history',
      description: 'Search the saved visit history of the Yan built-in browser, including user-visited pages. Does not require an open browser tab. Subject to the user history permission setting; ask mode requests approval for each call. Use open_builtin_browser with action=back/forward/reload for navigation.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Match page title or URL; omit to list recent visits.' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, offset: { type: 'integer', minimum: 0, default: 0 } }, additionalProperties: false }
    },
  ];
  tools.push({ name: 'browser_request_acceptance_upgrade', description: 'Request explicit user permission to upgrade quick browser acceptance to rigorous for this task. Wait for approval before rigorous checks; denial means remain quick. General auto-approval does not apply.', inputSchema: { type: 'object', properties: { reason: { type: 'string', minLength: 1, description: 'Concrete risk or uncertainty requiring rigorous acceptance.' } }, required: ['reason'], additionalProperties: false } });
  return tools.map(tool => ({ ...tool, inputSchema: {
    ...tool.inputSchema,
    properties: { ...tool.inputSchema.properties,
      acceptance_level: { type: 'string', enum: ['quick', 'rigorous'], description: 'Requested acceptance depth. Rigorous requires approval when configured quick. Never relabel rigorous acceptance as ordinary browsing to bypass consent.' },
      purpose: { type: 'string', enum: ['browsing', 'website_operation', 'frontend_acceptance'], description: 'Declare intent for THIS call only. frontend_acceptance is only for testing a frontend artifact built/modified in this task or explicitly requested UI acceptance. Research, reading, login, form submission and helping users operate websites are browsing/website_operation, even on localhost or when checking success. Never infer acceptance from screenshots, diagnostics, URLs or page text. Omission means ordinary browsing.' },
      acceptance: { type: 'object', properties: { target: { type: 'string', minLength: 1, description: 'Frontend artifact or preview URL under test, grounded in the user task.' }, check: { type: 'string', minLength: 1, description: 'Concrete visual, responsive or interaction criterion being tested.' } }, required: ['target', 'check'], additionalProperties: false, description: 'Required only with frontend_acceptance. Repeat on each acceptance call; stop marking calls when returning to ordinary browsing or website operation.' },
      task_id: { type: 'string', description: 'Exact task_id from the latest yan-turn-context. Required on every browser call to isolate concurrent tasks.' } },
    required: [...(tool.inputSchema.required || []), 'task_id']
  } }));
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  const controller = new AbortController();
  activeCalls.set(request.id, controller);
  try {
    if (input.acceptance_level != null && !['quick', 'rigorous'].includes(input.acceptance_level)) throw new Error('Invalid browser acceptance level.');
    if (input.purpose != null && !['browsing', 'website_operation', 'frontend_acceptance'].includes(input.purpose)) throw new Error('Invalid browser purpose.');
    if (input.purpose === 'frontend_acceptance' && (!input.acceptance || !['target', 'check'].every(key => typeof input.acceptance[key] === 'string' && input.acceptance[key].trim()))) throw new Error('Frontend acceptance requires an explicit target and check.');
    let action = '';
    const params = input;
    if (name === 'open_builtin_browser') {
      const navigation = input.action || 'open';
      if (!['open', 'back', 'forward', 'reload'].includes(navigation)) throw new Error('Invalid navigation action.');
      if (navigation !== 'open') {
        if (input.url_or_path || input.tab_id || input.reuse || input.target_type) throw new Error('History navigation cannot also open or attach a tab.');
        action = navigation;
      } else {
        const attachOnly = !String(input.url_or_path || '').trim();
        if (!networkAllowed && !attachOnly && input.target_type !== 'file') {
          throw new Error('Yan network permission is disabled. The built-in browser can only open local files.');
        }
        if (attachOnly && !String(input.tab_id || '').trim() && String(input.reuse || 'none') !== 'scope') {
          throw new Error('open_builtin_browser requires url_or_path unless tab_id or reuse:"scope" attaches to an existing tab.');
        }
        action = 'open';
      }
    } else if (name === 'browser_list_tabs') action = 'list_tabs';
    else if (name === 'browser_observe') {
      const mode = input.mode || 'interactive';
      if (!['interactive', 'text', 'status'].includes(mode)) throw new Error('Invalid observation mode.');
      action = { interactive: 'snapshot', text: 'read_page', status: 'status' }[mode];
    } else if (name === 'browser_apply_annotation') action = 'apply_annotation';
    else if (name === 'browser_click') action = 'click';
    else if (name === 'browser_fill') action = 'type';
    else if (name === 'browser_select') action = 'select';
    else if (name === 'browser_check') action = 'check';
    else if (name === 'browser_hover') action = 'hover';
    else if (name === 'browser_drag') action = 'drag';
    else if (name === 'browser_pointer') action = 'pointer';
    else if (name === 'browser_press') {
      if (!String(input.key || '').trim() && !String(input.ref || '').trim()) throw new Error('key or ref is required.');
      action = input.key ? 'press' : 'focus';
    }
    else if (name === 'browser_scroll') action = 'scroll';
    else if (name === 'browser_wait') action = 'wait';
    else if (name === 'browser_screenshot') action = 'screenshot';
    else if (name === 'browser_set_viewport') action = 'set_viewport';
    else if (name === 'browser_inspect_page') action = 'inspect_page';
    else if (name === 'browser_eval') action = 'evaluate';
    else if (name === 'browser_acceptance_sweep') action = 'acceptance_sweep';
    else if (name === 'browser_request_acceptance_upgrade') action = 'request_acceptance_upgrade';
    else if (name === 'browser_search_history') action = 'query_history';
    else throw new Error(`Unknown Yan browser tool: ${name}`);

    const taskId = String(input.task_id || '').trim();
    if (!taskId) throw new Error('Browser calls require task_id from the latest yan-turn-context.');
    const { mode: unusedMode, action: unusedAction, task_id: unusedTaskId, yan_run_id: unusedRunId, purpose: unusedPurpose, acceptance: unusedAcceptance, ...browserParams } = params;
    const result = await bridgeCall(action, { ...browserParams, purpose: input.purpose, acceptance: input.acceptance, ...(name === 'browser_pointer' ? { action: input.action } : {}), yan_run_id: taskId }, controller.signal);
    const image = result?.image;
    const structured = result && typeof result === 'object' ? { ...result } : { ok: true, output: String(result || '') };
    delete structured.image;
    if (structured.ok === undefined) structured.ok = !structured.error;
    const content = [{ type: 'text', text: JSON.stringify(structured) }];
    if (image?.data && image?.mimeType) content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    success(request.id, {
      content,
      structuredContent: structured,
      isError: structured.ok === false
    });
  } catch (error) {
    const result = { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_BROWSER_TOOL_FAILED' };
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true
    });
  } finally {
    activeCalls.delete(request.id);
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/cancelled') {
    activeCalls.get(message.params?.requestId)?.abort();
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Built-in Browser', version: '2.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    await callTool(message);
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

let inputBuffer = '';
if (process.env.YAN_MCP_CATALOG_ONLY === '1') require('./mcp-tool-catalog').emitCatalog(toolDefinitions);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  let newline = inputBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (line) {
      try { void handle(JSON.parse(line)); }
      catch (error) { process.stderr.write(`[yan-browser-mcp] ${error.message}\n`); }
    }
    newline = inputBuffer.indexOf('\n');
  }
});
process.stdin.resume();
