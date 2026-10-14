'use strict';

// Computer-control experience review (Continual Harness).
//
// The previous workflow appended a canned Markdown shell to each application's
// experience file after every run; that shell taught nothing and never reflected
// what actually happened. An explicit exit or host-owned release now queues an
// evidence-backed Continual Harness review, even when the model skips end_session.
// The post-turn reviewer distills the actual trajectory after control is released.

const NATIVE_TOOLS = new Set([
  'start_session', 'escalate_session', 'get_session', 'end_session',
  'list_apps', 'list_windows', 'get_window_state', 'verify_state', 'launch_app',
  'bring_to_front', 'set_window_frame', 'invoke_menu', 'click', 'double_click',
  'right_click', 'drag', 'type_text', 'press_key', 'hotkey', 'set_value', 'scroll',
  'get_screen_size', 'get_desktop_state', 'get_cursor_position', 'move_cursor',
  'check_permissions'
]);
const SYSTEM_HOSTS = new Set([
  'cmd', 'conhost', 'openconsole', 'powershell', 'pwsh', 'windowsterminal',
  'wt', 'bash', 'wsl', 'ubuntu', 'kali', 'cua-driver'
]);

function isComputerControlToolName(name) {
  const value = String(name || '').toLowerCase();
  return value.includes('computer_') || value.includes('computer-') || value === 'computer'
    || value.includes('yan_computer') || NATIVE_TOOLS.has(value) || value.includes('end_session');
}

function isComputerControlExitName(name) {
  const value = String(name || '').toLowerCase();
  return value === 'end_session' || value.endsWith('_end_session') || value.includes('end_session');
}

// Preserve native tool evidence independently of the provider's final response.
// A rejected/aborted provider promise may never return its toolCalls array.
function observeControlEvent(calls, event) {
  if (event?.type !== 'message.part.updated') return;
  const part = (event.properties || event.data || {}).part;
  if (part?.type !== 'tool' || !isComputerControlToolName(part.tool)) return;
  const id = String(part.callID || part.id || '');
  if (!id) return;
  const state = part.state || {};
  calls.set(id, {
    id, name: part.tool, args: state.input || {}, status: state.status || 'running',
    ok: state.status === 'completed' ? true : state.status === 'error' ? false : undefined,
    output: state.output || state.error || ''
  });
}

// A console host used to locate a program is an objective service, never the
// application the model operated; it must not be named as controlled.
function isSystemHost(executable) {
  const base = String(executable || '').split(/[\\/]/).pop() || '';
  return SYSTEM_HOSTS.has(base.replace(/\.exe$/i, '').toLowerCase());
}

function callOutput(call) {
  const output = call?.output;
  if (typeof output === 'string') return output;
  if (output == null) return '';
  try { return JSON.stringify(output); } catch { return ''; }
}

function controlledAppsFromCalls(calls) {
  const apps = new Map();
  for (const call of calls) {
    if (call?.ok === false || !isComputerControlToolName(call?.name)) continue;
    const output = callOutput(call);
    const marker = output.match(/computer_control_app[\s\S]{0,800}?"path"\s*:\s*"([^"]+?)"/i);
    if (!marker) continue;
    const executable = marker[1].replace(/\\\\/g, '\\');
    if (!/\.exe$/i.test(executable) || isSystemHost(executable)) continue;
    const windowText = output.slice(marker.index || 0, (marker.index || 0) + marker[0].length + 200);
    apps.set(executable.toLowerCase(), {
      id: windowText.match(/"id"\s*:\s*"([^"]*)"/i)?.[1] || '',
      name: windowText.match(/"name"\s*:\s*"([^"]*)"/i)?.[1] || executable.split('\\').pop().replace(/\.exe$/i, ''),
      path: executable
    });
  }
  return [...apps.values()];
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const order = ['pid', 'path', 'window', 'element_token', 'text', 'keys', 'key', 'direction', 'value', 'x', 'y', 'coordinate', 'name', 'query'];
  const parts = [];
  for (const key of order) {
    const value = args[key];
    if (value == null || value === '') continue;
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(`${key}=${text.slice(0, 60)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(', ');
}

function analyzeComputerControlRun(toolCalls) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  let lastControl = -1;
  let lastExit = -1;
  calls.forEach((call, index) => {
    if (isComputerControlToolName(call?.name)) lastControl = index;
    if (isComputerControlExitName(call?.name) && call?.ok !== false) lastExit = index;
  });
  const controlCalls = calls.filter(call => isComputerControlToolName(call?.name));
  return {
    hasControl: lastControl >= 0,
    endsWithExit: lastExit >= 0 && lastExit === lastControl,
    exits: calls.filter(call => isComputerControlExitName(call?.name)).length,
    calls: controlCalls,
    apps: controlledAppsFromCalls(controlCalls)
  };
}

function extractEvidenceText(calls) {
  const snippets = [];
  for (const call of calls) {
    const output = callOutput(call).replace(/\s+/g, ' ').trim();
    if (!output) continue;
    // A console host is an objective service, not a controlled application; its
    // receipt must not leak into the review as if the user asked to control it.
    const marker = output.match(/computer_control_app[\s\S]{0,400}?"path"\s*:\s*"([^"]+?)"/i);
    if (marker && isSystemHost(marker[1].replace(/\\\\/g, '\\'))) continue;
    const name = String(call?.name || '').replace(/^.*computer[_-]/i, '');
    snippets.push(`${name}${call?.ok === false ? '[失败]' : ''}: ${output.slice(0, 160)}`);
  }
  return snippets.slice(-6);
}

function buildReviewInstructions(analysis, result) {
  if (!analysis?.hasControl) return '';
  const lines = [
    '本轮电脑操控已结束，控制权由 end_session、Esc 或任务结束时的宿主清理交还。请基于下面的真实执行轨迹复盘，把可复用的操控经验沉淀为长期记忆或经验条目（应用/窗口、可靠的动作与投递方式、元素/坐标、验收信号、失败与修正），不要泛泛而谈，也不要编造未发生的步骤。退出操控必须保留应用和播放状态。'
  ];
  if (analysis.apps.length) {
    lines.push(`操控应用：${analysis.apps.map(app => `${app.name}（${app.path}）`).join('；')}`);
  }
  const actions = analysis.calls.map(call => {
    const name = String(call?.name || '').replace(/^.*computer[_-]/i, '');
    const args = summarizeArgs(call?.args);
    const failed = call?.ok === false ? '[失败]' : '';
    return `${name}${args ? `(${args})` : ''}${failed}`;
  });
  if (actions.length) lines.push(`动作序列：${actions.slice(-40).join(' → ')}`);
  const evidence = extractEvidenceText(analysis.calls);
  if (evidence.length) lines.push(`关键回执：${evidence.join(' | ')}`);
  lines.push(`本轮结果：${result?.userRequestedFinish === true ? '用户要求提前结束，不能视为目标已完成' : result?.status === 'done' ? '成功完成' : `结束状态 ${String(result?.status || '未知')}`}`);
  return lines.join('\n').slice(0, 2_000);
}

// Returns the pending-refinement request when this run ended a control episode,
// or null when there was no control or control has not been released.
function computerControlReviewRequest({ runId, sessionId = '', workspace = '', toolCalls, result, controlReleased = false, now = Date.now() }) {
  const analysis = analyzeComputerControlRun(toolCalls);
  if (!analysis.hasControl || (!analysis.endsWithExit && !controlReleased)) return null;
  const instructions = buildReviewInstructions(analysis, result);
  if (!instructions) return null;
  return {
    schema: 1,
    action: 'refine',
    runId: String(runId || ''),
    sessionId: String(sessionId || ''),
    workspace: String(workspace || ''),
    scope: 'global',
    source: 'computer_control',
    apps: analysis.apps,
    instructions,
    requestedAt: now
  };
}

module.exports = {
  NATIVE_TOOLS,
  SYSTEM_HOSTS,
  isComputerControlToolName,
  isComputerControlExitName,
  observeControlEvent,
  isSystemHost,
  controlledAppsFromCalls,
  analyzeComputerControlRun,
  buildReviewInstructions,
  computerControlReviewRequest
};
