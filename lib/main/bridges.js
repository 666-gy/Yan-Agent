'use strict';

// Browser + session agent bridges (plan T6.3): the local JSON-RPC bridges the
// bundled MCP servers talk to, the browser tool-claim bookkeeping and the
// browser context-menu/guest helpers. Moved verbatim from main.js; every
// mutable singleton stays owned by main.js and is reached through deps.

const crypto = require('crypto');
const net = require('net');
const { isDeepStrictEqual } = require('node:util');
const { normalizeWorkspacePath, sameWorkspace, normalizeAbsoluteWorkspacePath } = require('../session-handoff');
const { buildScreenshotRelayInput, describeImages, isRecoverableVisionRelayError } = require('../vision-relay');
const { deliveryContractId, deliveryReviewInstructions, deliveryVisualPrompt } = require('../delivery-policy');

function registerBridges(ctx, deps) {
  const { app, shell, clipboard, Menu, session } = ctx;
  const {
    electronNet,
    resourceLocks,
    getMainWindow,
    isMainRendererReady,
    openCodeActiveRuns,
    browserAgentToolClaims,
    sessionAgentToolClaims,
    configuredBrowserGuestIds,
    browserAgentBridgePending,
    sessionAgentBridgePending,
    browserAgentBridgeToken,
    sessionAgentBridgeToken,
    BROWSER_PARTITION,
    BROWSER_AGENT_BRIDGE_ACTIONS,
    BROWSER_AGENT_BRIDGE_MAX_BYTES,
    SESSION_AGENT_BRIDGE_MAX_BYTES,
    SESSION_AGENT_ACTIONS,
    OPEN_CODE_SESSION_TOOL_ACTIONS,
    bridgeServer,
    bridgePort,
    sessionBridgeServer,
    sessionBridgePort,
    sessionStore,
    configStore,
    modelState,
    visionRelay,
    browserHelpers,
    hangGuard
  } = deps;
  const {
    isBrowserPageUrl,
    isExternalBrowserUrl,
    sendBrowserNewTab,
    getBrowserNavigationState,
    runBrowserMediaAction,
    buildBrowserContextMenu,
  } = browserHelpers;

  const OPEN_CODE_BROWSER_TOOL_ACTIONS = Object.freeze({
    open_builtin_browser: 'open',
    browser_snapshot: 'snapshot',
    browser_read_page: 'read_page',
    browser_click: 'click',
    browser_type: 'type',
    browser_select: 'select',
    browser_check: 'check',
    browser_hover: 'hover',
    browser_focus: 'focus',
    browser_drag: 'drag',
    browser_pointer: 'pointer',
    browser_press: 'press',
    browser_scroll: 'scroll',
    browser_wait: 'wait',
    browser_screenshot: 'screenshot',
    browser_inspect_page: 'inspect_page',
    browser_set_viewport: 'set_viewport',
    browser_apply_annotation: 'apply_annotation',
    browser_status: 'status',
    browser_search_history: 'query_history'
  });
  function browserActionForOpenCodeTool(toolName, input = {}) {
    const raw = String(toolName || '').toLowerCase();
    const localName = raw.startsWith('yan_browser_') ? raw.slice('yan_browser_'.length) : raw;
    if (localName === 'browser_history') {
      const historyAction = String(input.action || '').toLowerCase();
      return BROWSER_AGENT_BRIDGE_ACTIONS.has(historyAction) ? historyAction : '';
    }
    return OPEN_CODE_BROWSER_TOOL_ACTIONS[localName] || '';
  }

  function trackBrowserAgentToolClaim(runId, event = {}) {
    const activeRunId = String(runId || '');
    if (!activeRunId || !openCodeActiveRuns.has(activeRunId)) return;
    const data = event?.data || event?.properties || {};
    let callId = '';
    let toolName = '';
    let input = {};
    let finished = false;
    if (event.type === 'message.part.updated' || event.type === 'message.part.delta') {
      const part = data.part || {};
      if (part.type !== 'tool') return;
      callId = String(part.callID || part.id || '');
      toolName = String(part.tool || '');
      input = part.state?.input && typeof part.state.input === 'object' ? part.state.input : {};
      finished = part.state?.status === 'completed' || part.state?.status === 'error';
    } else if (event.type === 'session.next.tool.called') {
      callId = String(data.callID || '');
      toolName = String(data.tool || '');
      input = data.input && typeof data.input === 'object' ? data.input : {};
    } else if (event.type === 'session.next.tool.success' || event.type === 'session.next.tool.failed') {
      callId = String(data.callID || '');
      finished = true;
    } else {
      return;
    }
    if (!callId) return;
    if (finished) {
      browserAgentToolClaims.delete(callId);
      return;
    }
    const action = browserActionForOpenCodeTool(toolName, input);
    if (!action) return;
    browserAgentToolClaims.set(callId, { runId: activeRunId, action, createdAt: Date.now() });
  }

  function clearBrowserAgentToolClaims(runId) {
    const target = String(runId || '');
    for (const [callId, claim] of browserAgentToolClaims) {
      if (!target || claim.runId === target) browserAgentToolClaims.delete(callId);
    }
  }

  function consumeBrowserAgentToolClaim(action, runId) {
    const now = Date.now();
    for (const [callId, claim] of browserAgentToolClaims) {
      if (now - claim.createdAt > 30_000 || !openCodeActiveRuns.has(claim.runId)) {
        browserAgentToolClaims.delete(callId);
        continue;
      }
      if (claim.action !== action || claim.runId !== runId) continue;
      browserAgentToolClaims.delete(callId);
      return claim.runId;
    }
    return '';
  }

  function resolveAuthoritativeBrowserRun(action, params = {}) {
    const requestedRunId = String(params.yan_run_id || '');
    if (requestedRunId && openCodeActiveRuns.has(requestedRunId)) {
      // Shared MCP requests can arrive in a different order than tool events.
      // A claim for the same action in another run is never evidence of ownership.
      consumeBrowserAgentToolClaim(action, requestedRunId);
      return { ok: true, runId: requestedRunId };
    }
    if (process.env.YAN_E2E_MODE === '1' && requestedRunId) return { ok: true, runId: requestedRunId };
    if (requestedRunId) return { ok: false, error: '浏览器调用所属任务已结束或不存在。', code: 'BROWSER_RUN_NOT_ACTIVE' };
    const activeRunIds = [...openCodeActiveRuns.keys()];
    if (activeRunIds.length === 1) return { ok: true, runId: activeRunIds[0] };
    if (!activeRunIds.length) {
      return { ok: false, error: '当前没有可接管内置浏览器的 Agent 任务。', code: 'BROWSER_RUN_NOT_ACTIVE' };
    }
    return { ok: false, error: '多个 Agent 任务同时运行，当前浏览器调用缺少权威任务归属。', code: 'BROWSER_RUN_CONTEXT_AMBIGUOUS' };
  }

  function plainBrowserBridgeError(error, fallback = 'Yan 内置浏览器桥接失败。') {
    return {
      ok: false,
      error: error?.message || String(error || fallback),
      code: error?.code || 'YAN_BROWSER_BRIDGE_FAILED'
    };
  }

  async function relayBrowserScreenshotForTextModel(result, runId, params = {}) {
    if (!result?.ok || !result.image?.data || !result.image?.mimeType) return result;
    const activeRun = openCodeActiveRuns.get(String(runId || ''));
    const deliveryContract = activeRun?.deliveryContract;
    const question = String(params?.question || '').trim().slice(0, 600);
    const previousFrame = activeRun?.lastBrowserScreenshot?.data ? activeRun.lastBrowserScreenshot : null;
    if (activeRun) {
      // Keep exactly one previous frame per run so a later screenshot can ask
      // for a before/after comparison without reopening the browser panel.
      activeRun.lastBrowserScreenshot = {
        mimeType: String(result.image.mimeType),
        data: String(result.image.data),
        capturedAt: Date.now()
      };
    }
    const relayInput = buildScreenshotRelayInput({
      basePrompt: deliveryVisualPrompt(activeRun?.prompt, deliveryContract),
      question,
      compare: params?.compare_to_previous === true,
      previous: previousFrame,
      current: { mimeType: result.image.mimeType, data: result.image.data }
    });
    result = {
      ...result,
      ...(question ? { focusQuestion: question } : {}),
      comparedWithPrevious: relayInput.withPrevious,
      previousFrameAvailable: !!previousFrame
    };
    if (deliveryContract) {
      result = { ...result, deliveryContract, deliveryContractId: deliveryContractId(deliveryContract),
        deliveryReviewInstructions: deliveryReviewInstructions(deliveryContract) };
    }
    const cfg = configStore.loadConfig();
    const selection = activeRun?.selection || modelState.normalizeAgentModelSelection(cfg);
    // The main model sees images on its own: the relay step only exists for a
    // text-only main model.
    if (selection.capabilities?.imageInput) return result;
    if (cfg.permissions?.allowNetwork === false) {
      return {
        ...result,
        visualEvidence: { available: false, error: '当前已关闭网络权限，无法使用视觉中继读取浏览器截图。' }
      };
    }
    const attempts = visionRelay.getVisionRelayModels(cfg);
    if (!attempts.length) {
      return {
        ...result,
        visualEvidence: { available: false, error: '未指定可用的视觉中继模型，当前文本模型无法读取浏览器截图。请在“设置 → 多模态链路”开启至少一个。' }
      };
    }
    let lastError = null;
    for (const [index, model] of attempts.entries()) {
      try {
        const described = await describeImages({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          modelId: model.modelId,
          attachments: relayInput.attachments,
          userPrompt: relayInput.userPrompt,
          maxTokens: 3000,
          signal: activeRun?.visionAbortController?.signal,
          fetchImpl: (url, options = {}) => electronNet.fetch(url, {
            ...options,
            session: session.fromPartition(BROWSER_PARTITION)
          })
        });
        return {
          ...result,
          visualEvidence: {
            available: true,
            observerProvider: model.providerId,
            observerModel: model.modelId,
            report: String(described.text || '').slice(0, 16000)
          }
        };
      } catch (error) {
        lastError = error;
        if (isRecoverableVisionRelayError(error) && attempts[index + 1]) continue;
        break;
      }
    }
    return {
      ...result,
      visualEvidence: {
        available: false,
        error: lastError?.message || '视觉中继未能读取浏览器截图。'
      }
    };
  }

  function cancelDispatchedBrowserAgentOperation(operationId, reason = 'client_cancelled') {
    const id = String(operationId || '');
    if (!id) return false;
    let cancelled = false;
    for (const [requestId, pending] of browserAgentBridgePending) {
      if (pending.operationId !== id) continue;
      browserAgentBridgePending.delete(requestId);
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'Yan 内置浏览器操作已取消。', code: 'BROWSER_ACTION_CANCELLED' });
      if (getMainWindow() && !getMainWindow().isDestroyed()) {
        getMainWindow().webContents.send('browser:agent-command', {
          requestId: '',
          operationId: id,
          action: 'cancel',
          params: { yan_run_id: pending.runId, operation_id: id, reason }
        });
      }
      cancelled = true;
    }
    return cancelled;
  }

  // 截图熔断器:capturePage() 走 GPU/Viz 合成器。窗口最小化或被完全遮挡时这条路会
  // 抛 UnknownVizError,且可能把 GPU 进程卡住,进而拖死主进程的 UI 线程(这正是
  // 持久性死机的起点)。所以:窗口不可见时不截图;连续失败后进入冷却,期间改用
  // 无需 GPU 的 browser_snapshot / browser_read_page。
  const GPU_ERROR_PATTERN = /UnknownVizError|\bviz\b|\bgpu\b|compositor|SCREENSHOT_(EMPTY|GPU_ERROR|TIMEOUT)/i;
  const screenshotBreaker = { failures: 0, openUntil: 0 };
  const SCREENSHOT_FALLBACK_HINT = '请改用 browser_snapshot 获取可交互元素列表,或 browser_read_page 读取页面文本。';

  function screenshotPreflight() {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && (win.isMinimized() || !win.isVisible())) {
      hangGuard?.note?.('screenshot-blocked-window-hidden');
      return {
        ok: false,
        code: 'SCREENSHOT_WINDOW_HIDDEN',
        error: `Yan 窗口当前已最小化或不可见,此时截图会触发图形合成器故障,已阻止。${SCREENSHOT_FALLBACK_HINT}`
      };
    }
    if (Date.now() < screenshotBreaker.openUntil) {
      return {
        ok: false,
        code: 'SCREENSHOT_GPU_COOLDOWN',
        error: `内置浏览器截图刚刚连续失败(图形合成器异常),已临时熔断 ${Math.ceil((screenshotBreaker.openUntil - Date.now()) / 1000)} 秒。${SCREENSHOT_FALLBACK_HINT}`
      };
    }
    return null;
  }

  function recordScreenshotOutcome(result) {
    if (result?.ok) {
      screenshotBreaker.failures = 0;
      screenshotBreaker.openUntil = 0;
      return;
    }
    const signature = `${result?.code || ''} ${result?.error || ''}`;
    if (!GPU_ERROR_PATTERN.test(signature)) return;
    screenshotBreaker.failures += 1;
    hangGuard?.note?.('screenshot-gpu-failure', { failures: screenshotBreaker.failures, code: result?.code || '' });
    if (screenshotBreaker.failures < 2) return;
    screenshotBreaker.openUntil = Date.now() + 60_000;
    hangGuard?.note?.('screenshot-breaker-open', { cooldownMs: 60_000 });
  }

  async function dispatchBrowserAgentCommand(action, params = {}, { operationId = '' } = {}) {
    if (!BROWSER_AGENT_BRIDGE_ACTIONS.has(action)) {
      return { ok: false, error: `不支持的内置浏览器操作：${action}`, code: 'UNKNOWN_BROWSER_ACTION' };
    }
    if (configStore.loadConfig().browser?.enabled === false && action !== 'release') return { ok: false, error: '浏览器控制已在设置中关闭', code: 'BROWSER_DISABLED' };
    const authority = resolveAuthoritativeBrowserRun(action, params);
    if (!authority.ok) return authority;
    if (action === 'query_history') return deps.queryBrowserHistory(params, () => openCodeActiveRuns.has(authority.runId));
    const authorizedParams = {
      ...params,
      yan_run_id: authority.runId,
      yan_workspace: openCodeActiveRuns.get(authority.runId)?.workspace || '',
      yan_session_id: openCodeActiveRuns.get(authority.runId)?.yanSessionId || ''
    };
    const execute = async () => {
      if (!getMainWindow() || getMainWindow().isDestroyed() || !isMainRendererReady()) {
        return { ok: false, error: 'Yan 主窗口尚未就绪，无法控制内置浏览器。', code: 'YAN_RENDERER_NOT_READY' };
      }
      const requestId = crypto.randomUUID();
      const browserOperationId = String(operationId || requestId);
      if (action === 'screenshot') {
        const blocked = screenshotPreflight();
        if (blocked) return blocked;
      }
      hangGuard?.mark?.(`browser:${action}`);
      const result = await new Promise(resolve => {
        const timer = setTimeout(() => {
          browserAgentBridgePending.delete(requestId);
          if (getMainWindow() && !getMainWindow().isDestroyed()) {
            getMainWindow().webContents.send('browser:agent-command', {
              requestId: '',
              operationId: browserOperationId,
              action: 'cancel',
              params: { yan_run_id: authority.runId, operation_id: browserOperationId, reason: 'bridge_timeout' }
            });
          }
          resolve({ ok: false, error: 'Yan 内置浏览器操作超时。', code: 'YAN_BROWSER_TIMEOUT' });
        }, 40_000);
        browserAgentBridgePending.set(requestId, { resolve, timer, operationId: browserOperationId, runId: authority.runId });
        getMainWindow().webContents.send('browser:agent-command', { requestId, operationId: browserOperationId, action, params: authorizedParams });
      });
      if (action === 'screenshot') recordScreenshotOutcome(result);
      return action === 'screenshot'
        ? relayBrowserScreenshotForTextModel(result, authority.runId, authorizedParams)
        : result;
    };
    const mutating = new Set(['open', 'click', 'type', 'select', 'check', 'drag', 'pointer', 'press', 'scroll', 'back', 'forward', 'reload', 'apply_annotation']).has(action);
    return resourceLocks.withLock('browser:agent', mutating ? 'write' : 'read', {
      owner: authority.runId,
      timeoutMs: 45_000
    }, execute);
  }

  function notifyBrowserAgentRelease(runId, reason = 'run_finished') {
    const id = String(runId || '');
    if (!id || !getMainWindow() || getMainWindow().isDestroyed()) return;
    getMainWindow().webContents.send('browser:agent-command', {
      requestId: '',
      action: 'release',
      params: { yan_run_id: id, reason }
    });
  }

  function writeBrowserBridgeResponse(socket, payload) {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(payload)}\n`);
  }

  function handleBrowserAgentBridgeSocket(socket) {
    socket.setEncoding('utf8');
    let input = '';
    let handled = false;
    let operationId = '';
    let operationCompleted = false;
    socket.on('data', chunk => {
      if (handled) return;
      input += String(chunk || '');
      if (Buffer.byteLength(input, 'utf8') > BROWSER_AGENT_BRIDGE_MAX_BYTES) {
        handled = true;
        writeBrowserBridgeResponse(socket, { ok: false, error: '浏览器桥接请求过大。', code: 'YAN_BROWSER_REQUEST_TOO_LARGE' });
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      const line = input.slice(0, newline).trim();
      let request;
      try {
        request = JSON.parse(line);
      } catch (error) {
        writeBrowserBridgeResponse(socket, plainBrowserBridgeError(error, '浏览器桥接请求不是有效 JSON。'));
        return;
      }
      if (request?.token !== browserAgentBridgeToken) {
        writeBrowserBridgeResponse(socket, { ok: false, error: '浏览器桥接认证失败。', code: 'YAN_BROWSER_AUTH_FAILED' });
        return;
      }
      const action = String(request?.action || '');
      operationId = String(request?.operationId || crypto.randomUUID());
      const params = request?.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? request.params
        : {};
      dispatchBrowserAgentCommand(action, params, { operationId })
        .then(result => {
          operationCompleted = true;
          writeBrowserBridgeResponse(socket, { ok: true, result });
        })
        .catch(error => {
          operationCompleted = true;
          writeBrowserBridgeResponse(socket, plainBrowserBridgeError(error));
        });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (operationId && !operationCompleted) cancelDispatchedBrowserAgentOperation(operationId);
    });
  }

  function startBrowserAgentBridge() {
    if (bridgeServer.get() && bridgePort.get()) {
      return Promise.resolve({ port: bridgePort.get(), token: browserAgentBridgeToken });
    }
    return new Promise((resolve, reject) => {
      const server = net.createServer(handleBrowserAgentBridgeSocket);
      const fail = error => {
        server.close(() => {});
        reject(error);
      };
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', fail);
        server.on('error', error => console.warn('[browser bridge]', error.message));
        const address = server.address();
        bridgeServer.set(server);
        bridgePort.set(typeof address === 'object' && address ? Number(address.port) : 0);
        resolve({ port: bridgePort.get(), token: browserAgentBridgeToken });
      });
    });
  }

  function stopBrowserAgentBridge() {
    for (const pending of browserAgentBridgePending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'Yan 正在退出，内置浏览器操作已终止。', code: 'YAN_APP_EXITING' });
    }
    browserAgentBridgePending.clear();
    bridgePort.set(0);
    bridgeServer.get()?.close(() => {});
    bridgeServer.set(null);
  }

  function sessionActionForOpenCodeTool(toolName) {
    const name = String(toolName || '').toLowerCase();
    const local = name.startsWith('yan_session_') ? name.slice('yan_session_'.length) : '';
    if (local === 'intelligent_ui_creator') return local;
    return require('../external-agents/tools').ACTIONS.has(local) ? local : OPEN_CODE_SESSION_TOOL_ACTIONS[name] || '';
  }

  function trackSessionAgentToolClaim(runId, event = {}) {
    const activeRunId = String(runId || '');
    if (!activeRunId || !openCodeActiveRuns.has(activeRunId)) return;
    const data = event?.data || event?.properties || {};
    let callId = '';
    let toolName = '';
    let input = {};
    let finished = false;
    if (event.type === 'message.part.updated' || event.type === 'message.part.delta') {
      const part = data.part || {};
      if (part.type !== 'tool') return;
      callId = String(part.callID || part.id || '');
      toolName = String(part.tool || '');
      input = part.state?.input && typeof part.state.input === 'object' ? part.state.input : {};
      finished = part.state?.status === 'completed' || part.state?.status === 'error';
    } else if (event.type === 'session.next.tool.called') {
      callId = String(data.callID || '');
      toolName = String(data.tool || '');
      input = data.input && typeof data.input === 'object' ? data.input : {};
    } else if (event.type === 'session.next.tool.success' || event.type === 'session.next.tool.failed') {
      callId = String(data.callID || '');
      finished = true;
    } else {
      return;
    }
    if (!callId) return;
    if (finished) {
      sessionAgentToolClaims.delete(callId);
      return;
    }
    const action = sessionActionForOpenCodeTool(toolName);
    if (!action) return;
    sessionAgentToolClaims.set(callId, { runId: activeRunId, action, input, createdAt: Date.now() });
  }

  function clearSessionAgentToolClaims(runId) {
    const target = String(runId || '');
    for (const [callId, claim] of sessionAgentToolClaims) {
      if (!target || claim.runId === target) sessionAgentToolClaims.delete(callId);
    }
  }

  function consumeSessionAgentToolClaim(action, params = {}) {
    const now = Date.now();
    const requestedTarget = normalizeWorkspacePath(params.target_path);
    for (const [callId, claim] of sessionAgentToolClaims) {
      if (now - claim.createdAt > 30000 || !openCodeActiveRuns.has(claim.runId)) {
        sessionAgentToolClaims.delete(callId);
        continue;
      }
      if (claim.action !== action) continue;
      if (action === 'intelligent_ui_creator' && ['task_id', 'action', 'title', 'purpose', 'placement', 'html', 'format', 'code', 'handoff']
        .some(key => params[key] !== claim.input?.[key])) continue;
      if (action === 'intelligent_ui_creator' && !isDeepStrictEqual(params.resources, claim.input?.resources)) continue;
      if (require('../external-agents/tools').ACTIONS.has(action)) {
        if (String(params.task_id || '') !== String(claim.input?.task_id || '')) continue;
        if (params.request_key !== claim.input?.request_key || params.job_id !== claim.input?.job_id) continue;
        if (JSON.stringify(params.job_ids) !== JSON.stringify(claim.input?.job_ids)) continue;
        if (action === 'delegate_external_task' && ['provider', 'session_mode', 'history_id', 'prompt', 'previous_job_id', 'new_issue', 'read_only']
          .some(key => params[key] !== claim.input?.[key])) continue;
        if (['list_external_sessions', 'read_external_session'].includes(action)
          && ['provider', 'scope', 'query', 'history_id', 'cursor', 'offset', 'limit', 'include_tools', 'include_archived']
            .some(key => params[key] !== claim.input?.[key])) continue;
      }
      if (action === 'create_handoff') {
        const claimedTarget = normalizeWorkspacePath(claim.input?.target_path);
        if (requestedTarget && claimedTarget && !sameWorkspace(requestedTarget, claimedTarget)) continue;
      }
      sessionAgentToolClaims.delete(callId);
      return claim.runId;
    }
    return '';
  }

  function resolveAuthoritativeSessionRun(action, params = {}) {
    const claimedRunId = consumeSessionAgentToolClaim(action, params);
    if (claimedRunId) return { ok: true, runId: claimedRunId };
    const activeRunIds = [...openCodeActiveRuns.keys()];
    if (activeRunIds.length === 1) return { ok: true, runId: activeRunIds[0] };
    if (!activeRunIds.length) {
      return { ok: false, error: '当前没有可执行会话交接的 Agent 任务。', code: 'SESSION_RUN_NOT_ACTIVE' };
    }
    return { ok: false, error: '多个 Agent 任务同时运行，当前会话操作缺少权威任务归属。', code: 'SESSION_RUN_CONTEXT_AMBIGUOUS' };
  }

  function requestSessionAgentApproval(detail) {
    if (!getMainWindow() || getMainWindow().isDestroyed() || !isMainRendererReady()) {
      return Promise.resolve({ approved: false, error: 'Yan 主窗口尚未就绪。' });
    }
    const requestId = crypto.randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        sessionAgentBridgePending.delete(requestId);
        resolve({ approved: false, error: '等待用户授权超时。', code: 'SESSION_APPROVAL_TIMEOUT' });
      }, 270000);
      sessionAgentBridgePending.set(requestId, { resolve, timer });
      getMainWindow().webContents.send('session:agent-command', { requestId, ...detail });
    });
  }

  async function dispatchSessionAgentCommand(action, params = {}) {
    if (action === 'intelligent_ui_creator') {
      // Require an observed tool call; neither focus nor a supplied id grants authority.
      let claimed = consumeSessionAgentToolClaim(action, params);
      for (let attempt = 0; !claimed && attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        claimed = consumeSessionAgentToolClaim(action, params);
      }
      if (!claimed || claimed !== params.task_id) throw new Error('Intelligent UI 调用缺少匹配的来源任务。');
      return require('../intelligent-ui-creator').createIntelligentUi(openCodeActiveRuns.get(claimed), claimed, params);
    }
    const externalTools = require('../external-agents/tools');
    if (externalTools.ACTIONS.has(action)) {
      // The model's task_id must agree with the run that actually called the
      // tool. Never route A to B merely because B is focused or its id was sent.
      let claimed = consumeSessionAgentToolClaim(action, params);
      for (let attempt = 0; !claimed && openCodeActiveRuns.size > 1 && attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        claimed = consumeSessionAgentToolClaim(action, params);
      }
      const soleRun = openCodeActiveRuns.size === 1 ? [...openCodeActiveRuns.keys()][0] : '';
      if ((claimed || soleRun) !== params.task_id) throw new Error('协同调用与来源任务不匹配，未派发。请使用当前 task_id。');
      return externalTools.dispatch(deps.externalAgents(), openCodeActiveRuns, action, params);
    }
    if (!SESSION_AGENT_ACTIONS.has(action)) {
      return { ok: false, error: `不支持的会话操作：${action}`, code: 'UNKNOWN_SESSION_ACTION' };
    }
    const authority = resolveAuthoritativeSessionRun(action, params);
    if (!authority.ok) return authority;
    const active = openCodeActiveRuns.get(authority.runId);
    const sourceSessionId = String(active?.yanSessionId || '');
    if (!sourceSessionId) {
      return { ok: false, error: '当前 Yan Kernel 任务没有绑定 Yan 对话。', code: 'YAN_SESSION_NOT_BOUND' };
    }

    if (action === 'read_source_context') {
      return sessionStore.readBoundSourceContext(sourceSessionId, params.start, params.limit);
    }

    const source = await sessionStore.readSessionRecord(sourceSessionId);
    if (!source) return { ok: false, error: '来源任务不存在。', code: 'SESSION_SOURCE_NOT_FOUND' };
    const targetWorkspace = normalizeAbsoluteWorkspacePath(params.target_path);
    if (!targetWorkspace) {
      return { ok: false, error: '目标工作区必须使用绝对路径。', code: 'WORKSPACE_TARGET_ABSOLUTE_REQUIRED' };
    }
    const validation = await sessionStore.validateHandoffTarget(source.workspace, targetWorkspace);
    if (!validation.ok) return validation;
    const approval = await requestSessionAgentApproval({
      action,
      runId: authority.runId,
      sourceSessionId,
      sourceWorkspace: validation.source,
      targetWorkspace: validation.target,
      reason: String(params.reason || '').trim()
    });
    if (!approval?.approved) {
      return {
        ok: false,
        error: approval?.error || '用户拒绝了跨工作区任务导航。',
        code: approval?.code || 'SESSION_HANDOFF_DENIED',
        denied: true
      };
    }
    const resolved = await sessionStore.resolveWorkspaceSessionForHandoff(sourceSessionId, validation.target);
    if (!resolved.ok) return resolved;
    if (getMainWindow() && !getMainWindow().isDestroyed()) {
      getMainWindow().webContents.send('session:agent-handoff-ready', {
        sourceSessionId,
        targetSessionId: resolved.session.id,
        workspace: resolved.session.workspace,
        handoffId: resolved.handoffId,
        reused: resolved.reused
      });
    }
    return {
      ok: true,
      sourceSessionId,
      targetSessionId: resolved.session.id,
      workspace: resolved.session.workspace,
      handoffId: resolved.handoffId,
      reused: resolved.reused,
      created: !resolved.reused,
      output: resolved.reused
        ? 'Yan 已找到目标工作区现有的最新任务；当前回答结束后界面会自动返回该任务。'
        : 'Yan 已创建新的任务并完成上下文交接；当前回答结束后界面会自动进入新任务。'
    };
  }

  function writeSessionBridgeResponse(socket, payload) {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(payload)}\n`);
  }

  function handleSessionAgentBridgeSocket(socket) {
    socket.setEncoding('utf8');
    let input = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      input += String(chunk || '');
      if (Buffer.byteLength(input, 'utf8') > SESSION_AGENT_BRIDGE_MAX_BYTES) {
        handled = true;
        writeSessionBridgeResponse(socket, { ok: false, error: '会话桥接请求过大。', code: 'YAN_SESSION_REQUEST_TOO_LARGE' });
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      let request;
      try {
        request = JSON.parse(input.slice(0, newline).trim());
      } catch (error) {
        writeSessionBridgeResponse(socket, { ok: false, error: error?.message || '会话桥接请求不是有效 JSON。', code: 'YAN_SESSION_BAD_JSON' });
        return;
      }
      if (request?.token !== sessionAgentBridgeToken) {
        writeSessionBridgeResponse(socket, { ok: false, error: '会话桥接认证失败。', code: 'YAN_SESSION_AUTH_FAILED' });
        return;
      }
      const action = String(request?.action || '');
      const params = request?.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? request.params
        : {};
      dispatchSessionAgentCommand(action, params)
        .then(result => writeSessionBridgeResponse(socket, { ok: true, result }))
        .catch(error => writeSessionBridgeResponse(socket, {
          ok: false,
          error: error?.message || String(error),
          code: error?.code || 'YAN_SESSION_BRIDGE_FAILED'
        }));
    });
    socket.on('error', () => {});
  }

  function startSessionAgentBridge() {
    if (sessionBridgeServer.get() && sessionBridgePort.get()) {
      return Promise.resolve({ port: sessionBridgePort.get(), token: sessionAgentBridgeToken });
    }
    return new Promise((resolve, reject) => {
      const server = net.createServer(handleSessionAgentBridgeSocket);
      const fail = error => {
        server.close(() => {});
        reject(error);
      };
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', fail);
        server.on('error', error => console.warn('[session bridge]', error.message));
        const address = server.address();
        sessionBridgeServer.set(server);
        sessionBridgePort.set(typeof address === 'object' && address ? Number(address.port) : 0);
        resolve({ port: sessionBridgePort.get(), token: sessionAgentBridgeToken });
      });
    });
  }

  function stopSessionAgentBridge() {
    for (const pending of sessionAgentBridgePending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ approved: false, error: 'Yan 正在退出，会话操作已终止。', code: 'YAN_APP_EXITING' });
    }
    sessionAgentBridgePending.clear();
    sessionAgentToolClaims.clear();
    sessionBridgePort.set(0);
    sessionBridgeServer.get()?.close(() => {});
    sessionBridgeServer.set(null);
  }


  function configureBrowserGuest(contents) {
    if (!contents || contents.isDestroyed()) return;
    if (configuredBrowserGuestIds.has(contents.id)) return;
    configuredBrowserGuestIds.add(contents.id);
    contents.setZoomMode('isolated');
    contents.once('destroyed', () => configuredBrowserGuestIds.delete(contents.id));
    // 只记录不自动重载:guest 崩溃由 main.js 的 app 级 render-process-gone 统一记录,
    // 这里补上"页面卡住"这一类,便于与主进程停滞对照。
    contents.on('unresponsive', () => hangGuard?.note?.('browser-guest-unresponsive', { id: contents.id }));
    contents.on('responsive', () => hangGuard?.note?.('browser-guest-responsive', { id: contents.id }));
    contents.setWindowOpenHandler(({ url }) => {
      sendBrowserNewTab(url);
      return { action: 'deny' };
    });
    contents.on('context-menu', (event, params) => {
      event.preventDefault();
      const template = buildBrowserContextMenu(contents, params);
      if (!template.length) return;
      Menu.buildFromTemplate(template).popup({ window: getMainWindow() || undefined });
    });
  }

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') configureBrowserGuest(contents);
  });

  async function refreshBrowserNetworkSession(url = 'https://example.com', { resetConnections = true } = {}) {
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  await browserSession.setProxy({ mode: 'system' });
  if (typeof browserSession.forceReloadProxyConfig === 'function') {
    await browserSession.forceReloadProxyConfig();
  }
  if (resetConnections) await browserSession.closeAllConnections();

  let proxy = 'unknown';
  try {
    proxy = await browserSession.resolveProxy(String(url || 'https://example.com'));
  } catch { /* keep network recovery usable even if proxy diagnostics fail */ }
  return { ok: true, proxy };
}

  return {
    OPEN_CODE_BROWSER_TOOL_ACTIONS,
    browserActionForOpenCodeTool,
    trackBrowserAgentToolClaim,
    clearBrowserAgentToolClaims,
    consumeBrowserAgentToolClaim,
    resolveAuthoritativeBrowserRun,
    plainBrowserBridgeError,
    relayBrowserScreenshotForTextModel,
    cancelDispatchedBrowserAgentOperation,
    dispatchBrowserAgentCommand,
    notifyBrowserAgentRelease,
    writeBrowserBridgeResponse,
    handleBrowserAgentBridgeSocket,
    startBrowserAgentBridge,
    stopBrowserAgentBridge,
    sessionActionForOpenCodeTool,
    trackSessionAgentToolClaim,
    clearSessionAgentToolClaims,
    consumeSessionAgentToolClaim,
    resolveAuthoritativeSessionRun,
    requestSessionAgentApproval,
    dispatchSessionAgentCommand,
    writeSessionBridgeResponse,
    handleSessionAgentBridgeSocket,
    startSessionAgentBridge,
    stopSessionAgentBridge,
    configureBrowserGuest,
    refreshBrowserNetworkSession,
  };
}

module.exports = { registerBridges };
