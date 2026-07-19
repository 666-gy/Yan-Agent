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

function getToolDefinition(name, tools = []) {
  return (tools || []).find(t => t?.function?.name === name) || null;
}

function validateToolArguments(value, schema, path = 'arguments') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  const expected = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  const actual = Array.isArray(value)
    ? 'array'
    : (value === null ? 'null' : (Number.isInteger(value) ? 'integer' : typeof value));
  const typeMatches = !expected.length || expected.some(type => (
    type === actual || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
  ));

  if (!typeMatches) {
    errors.push(`${path} must be ${expected.join(' or ')}, got ${actual}`);
    return errors;
  }
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path} is too long`);
  }
  if (typeof value === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    value.forEach((item, index) => errors.push(...validateToolArguments(item, schema.items, `${path}[${index}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateToolArguments(value[key], child, `${path}.${key}`));
      }
    }
  }
  return errors;
}

function prepareToolCall(toolCall, tools = [], runCtx = null) {
  const name = String(toolCall?.function?.name || '').trim();
  const seq = runCtx ? (runCtx.toolCallSeq = (runCtx.toolCallSeq || 0) + 1) : Date.now();
  const id = String(toolCall?.id || `call_${runCtx?.runId || 'local'}_${seq}`);
  const definition = getToolDefinition(name, tools);
  let args = {};
  let parseError = null;

  try {
    const raw = toolCall?.function?.arguments;
    args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
  } catch (error) {
    parseError = `Tool arguments are not valid JSON: ${error.message}`;
  }

  if (!parseError && (!args || typeof args !== 'object' || Array.isArray(args))) {
    parseError = 'Tool arguments must be a JSON object.';
  }
  if (!parseError && !name) parseError = 'Tool name is missing.';
  if (!parseError && !definition) parseError = `Unknown tool: ${name}`;

  const validationErrors = parseError
    ? []
    : validateToolArguments(args, definition.function?.parameters, 'arguments');
  const error = parseError || (validationErrors.length ? `Invalid tool arguments: ${validationErrors.join('; ')}` : null);

  return {
    id,
    name: name || 'unknown_tool',
    args: parseError ? {} : args,
    valid: !error,
    error,
    errorOutput: error ? toolError(name || 'unknown_tool', error, {
      callId: id,
      invalidArguments: true,
      noRetry: true,
      validationErrors
    }) : null
  };
}

function mergeToolResultMeta(raw, meta) {
  try {
    const parsed = JSON.parse(raw);
    parsed.meta = { ...(parsed.meta || {}), ...meta };
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

  K.clipToolText = clipToolText;
  K.toolResult = toolResult;
  K.toolSuccess = toolSuccess;
  K.toolError = toolError;
  K.execToolResult = execToolResult;
  K.parseToolOutputOk = parseToolOutputOk;
  K.getToolDefinition = getToolDefinition;
  K.validateToolArguments = validateToolArguments;
  K.prepareToolCall = prepareToolCall;
  K.mergeToolResultMeta = mergeToolResultMeta;

})(window.YanKernel);
