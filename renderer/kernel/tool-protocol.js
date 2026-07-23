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

// Unified tool result protocol:
// { ok, tool, output, error, meta: { code, retryable, repair_hints, ... } }
function toolResult(ok, tool, { output = '', error = null, meta = {} } = {}) {
  const nextMeta = { ...(meta || {}) };
  if (ok) {
    if (nextMeta.code == null) nextMeta.code = 'OK';
    if (nextMeta.retryable == null) nextMeta.retryable = false;
  } else {
    if (nextMeta.code == null) nextMeta.code = inferErrorCode(error, nextMeta);
    if (nextMeta.retryable == null) nextMeta.retryable = isRetryableCode(nextMeta.code, nextMeta);
    if (!Array.isArray(nextMeta.repair_hints) || !nextMeta.repair_hints.length) {
      nextMeta.repair_hints = defaultRepairHints(nextMeta.code, tool);
    }
  }
  return JSON.stringify({
    ok,
    tool,
    output,
    error: ok ? null : (error || 'Tool failed'),
    meta: nextMeta
  }, null, 2);
}

function inferErrorCode(error, meta = {}) {
  if (meta.code) return String(meta.code);
  if (meta.policy) return `POLICY_${String(meta.policy).toUpperCase()}`;
  if (meta.denied) return 'PERMISSION_DENIED';
  if (meta.invalidArguments) return 'INVALID_ARGUMENTS';
  if (meta.exception) return 'EXCEPTION';
  const err = String(error || '').toLowerCase();
  if (/path escapes workspace|workspace is not set|workspace_required|path_escape/i.test(err)) return 'PATH_ESCAPE';
  if (/old_string not found/i.test(err)) return 'EDIT_NOT_FOUND';
  if (/matches multiple|not unique/i.test(err)) return 'EDIT_NOT_UNIQUE';
  if (/read_file\(.*\) required before editing|read_before_edit/i.test(err)) return 'POLICY_READ_BEFORE_EDIT';
  if (/enoent|path not found|file not found|no such file/i.test(err)) return 'NOT_FOUND';
  if (/eacces|eperm|permission/i.test(err)) return 'PERMISSION_DENIED';
  if (/econnreset|econnrefused|etimedout|eai_again|ebusy|rate.?limit|temporar/i.test(err)) return 'TRANSIENT';
  if (/shell_destructive|destructive/i.test(err)) return 'SHELL_DESTRUCTIVE';
  return 'TOOL_FAILED';
}

function isRetryableCode(code, meta = {}) {
  if (meta.noRetry || meta.denied || meta.policy || meta.invalidArguments) return false;
  if (meta.transient === true) return true;
  const c = String(code || '');
  return c === 'TRANSIENT' || ['408', '425', '429', '500', '502', '503', '504'].includes(String(meta.status || meta.statusCode || ''));
}

function defaultRepairHints(code, tool) {
  switch (String(code || '')) {
    case 'EDIT_NOT_FOUND':
      return ['Call read_file or read_file_range on the target path', 'Copy exact old_string including whitespace', 'Retry edit_file once with larger context'];
    case 'EDIT_NOT_UNIQUE':
      return ['Include more surrounding lines in old_string', 'Or use apply_patch with unique hunks'];
    case 'POLICY_READ_BEFORE_EDIT':
      return ['Call read_file on this path first', 'Then retry the edit'];
    case 'PATH_ESCAPE':
    case 'WORKSPACE_REQUIRED':
      return ['Use a path relative to the workspace root', 'Or ask the user to set a workspace'];
    case 'NOT_FOUND':
      return ['list_directory or search_files to locate the path', 'Confirm the relative path'];
    case 'INVALID_ARGUMENTS':
      return ['Fix argument names and types per the tool schema', 'Do not invent fields'];
    case 'SHELL_DESTRUCTIVE':
      return ['Use a narrower, non-destructive command', 'Or ask the user to run the dangerous command manually'];
    case 'PERMISSION_DENIED':
      return ['Do not retry the same privileged action', 'Continue with allowed tools or ask the user'];
    case 'TRANSIENT':
      return ['Retry once is automatic for safe tools', 'If it persists, switch approach or report blocked'];
    default:
      return tool ? [`Inspect the ${tool} error carefully`, 'Change strategy rather than repeating the identical call'] : ['Change strategy rather than repeating the identical call'];
  }
}

function toolSuccess(tool, output, meta = {}) {
  return toolResult(true, tool, { output, meta });
}

function toolError(tool, error, meta = {}) {
  return toolResult(false, tool, { output: '', error: String(error || 'Unknown error'), meta });
}

// Commands whose exit code 1 means "no match / no diff", not failure. Treating these
// as errors triggers pointless retries and can trip the identical-error circuit breaker.
const EXIT1_IS_OK_RE = /(?:^|[\\/\s;&|(])(?:grep|egrep|fgrep|findstr|rg|ag|ack|diff|git\s+diff|cmp|find|test|\[)\b/i;

function execToolResult(tool, res, fallbackOutput = '') {
  const stdout = clipToolText(res.stdout || '');
  const stderr = clipToolText(res.stderr || '');
  const exitCode = Number.isFinite(res.exitCode) ? res.exitCode : (res.error ? 1 : 0);
  // git diff exit 1 = has changes, not a failure.
  const gitDiffHasChanges = tool === 'git_diff' && !res.error && exitCode === 1;
  // For execute_shell, exit 1 from a search/diff tool with no stderr is a normal
  // "nothing matched" result, not an execution error.
  const commandText = String(res.command || res.cmd || res.argv || '');
  const searchNoMatch = tool === 'execute_shell'
    && !res.error
    && exitCode === 1
    && !stderr.trim()
    && EXIT1_IS_OK_RE.test(commandText);
  const ok = !res.error && (exitCode === 0 || gitDiffHasChanges || searchNoMatch);
  const output = stdout || stderr || fallbackOutput
    || (searchNoMatch ? '(no matches)' : '');
  const meta = {
    exitCode,
    stderr: stderr || undefined,
    hasChanges: gitDiffHasChanges || undefined,
    noMatch: searchNoMatch || undefined
  };
  if (res.code) meta.code = res.code;
  if (!ok && res.code) meta.code = res.code;
  if (!ok && !meta.code) {
    meta.code = exitCode === 127 || /not recognized|not found/i.test(String(res.error || stderr))
      ? 'NOT_FOUND'
      : (exitCode === 0 ? 'TOOL_FAILED' : 'EXIT_NONZERO');
  }
  return toolResult(ok, tool, {
    output,
    error: res.error || (ok ? null : (stderr || `exit code ${exitCode}`)),
    meta
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
  const capabilityBlock = !definition && K.getCapabilityToolBlock
    ? K.getCapabilityToolBlock(runCtx, name)
    : null;
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
  if (!parseError && !definition) parseError = capabilityBlock?.message || `Unknown tool: ${name}`;

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
      code: parseError ? 'INVALID_JSON' : (capabilityBlock?.meta?.code || 'INVALID_ARGUMENTS'),
      validationErrors,
      ...(capabilityBlock?.meta || {})
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

  // File-aware clipping: truncate on a line boundary and tell the model exactly
  // how to continue (read_file_range with a concrete start line), instead of an
  // opaque "N chars truncated" that leaves it guessing.
  K.clipFileContent = function (text, path, max = 12000) {
    const s = String(text ?? '');
    if (s.length <= max) return s;
    let cut = s.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max; // pathological single-line file: hard cut
    const shown = s.slice(0, cut);
    const shownLines = (shown.match(/\n/g) || []).length + 1;
    const totalLines = (s.match(/\n/g) || []).length + 1;
    return shown + `\n...(truncated: showing lines 1-${shownLines} of ${totalLines}. ` +
      `Use read_file_range(path=${JSON.stringify(String(path || ''))}, start_line=${shownLines + 1}, end_line=${Math.min(totalLines, shownLines + 400)}) to continue.)`;
  };
  K.toolResult = toolResult;
  K.toolSuccess = toolSuccess;
  K.toolError = toolError;
  K.execToolResult = execToolResult;
  K.parseToolOutputOk = parseToolOutputOk;
  K.getToolDefinition = getToolDefinition;
  K.validateToolArguments = validateToolArguments;
  K.prepareToolCall = prepareToolCall;
  K.mergeToolResultMeta = mergeToolResultMeta;
  K.inferErrorCode = inferErrorCode;

})(window.YanKernel);
