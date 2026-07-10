/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
function clipToolText(text, max = 12000) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...(${s.length - max} chars truncated)...`;
}

// 统一工具返回协议：{ ok, tool, output, error, meta }
function toolResult(ok, tool, { output = '', error = null, meta = {} } = {}) {
  return JSON.stringify({ ok, tool, output, error: ok ? null : (error || 'Tool failed'), meta }, null, 2);
}

function toolSuccess(tool, output, meta = {}) {
  return toolResult(true, tool, { output, meta });
}

function toolError(tool, error, meta = {}) {
  return toolResult(false, tool, { output: '', error: String(error || 'Unknown error'), meta });
}

function execToolResult(tool, res, fallbackOutput = '') {
  const stdout = clipToolText(res.stdout || '');
  const stderr = clipToolText(res.stderr || '');
  const exitCode = Number.isFinite(res.exitCode) ? res.exitCode : (res.error ? 1 : 0);
  // git diff 有改动时 exit code 为 1，不是失败
  const gitDiffHasChanges = tool === 'git_diff' && !res.error && exitCode === 1;
  const ok = !res.error && (exitCode === 0 || gitDiffHasChanges);
  const output = stdout || stderr || fallbackOutput;
  return toolResult(ok, tool, {
    output,
    error: res.error || (ok ? null : (stderr || `exit code ${exitCode}`)),
    meta: { exitCode, stderr: stderr || undefined, hasChanges: gitDiffHasChanges || undefined }
  });
}
function parseToolOutputOk(raw) {
  try { return !!JSON.parse(raw).ok; } catch { return null; }
}

  K.clipToolText = clipToolText;
  K.toolResult = toolResult;
  K.toolSuccess = toolSuccess;
  K.toolError = toolError;
  K.execToolResult = execToolResult;
  K.parseToolOutputOk = parseToolOutputOk;

})(window.YanKernel);
