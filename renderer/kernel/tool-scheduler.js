/* Yan Agent - dependency-aware tool scheduler */
(function (K) {
  'use strict';

  const PARALLEL_READ_TOOLS = new Set([
    'search_capabilities',
    'read_file', 'list_directory', 'search_files', 'get_file_outline',
    'find_symbol', 'read_file_range', 'get_file_imports', 'find_references',
    'find_related_files', 'search_symbols', 'git_status', 'git_diff', 'git_log',
    'list_ui_kit', 'read_ui_kit', 'list_skills'
  ]);

  function getToolEffect(prepared) {
    if (!prepared?.valid) return 'barrier';
    if (PARALLEL_READ_TOOLS.has(prepared.name)) return 'read';
    if (prepared.name === 'spawn_subagent' && ['explore', 'review'].includes(prepared.args?.type)) return 'read';
    return 'barrier';
  }

  function isToolRetrySafe(name) {
    return PARALLEL_READ_TOOLS.has(name);
  }

  function callHook(hooks, name, ...args) {
    try { hooks?.[name]?.(...args); } catch { /* UI hooks must not break execution */ }
  }

  async function executePreparedToolCall(prepared, runCtx, hooks = {}) {
    callHook(hooks, 'onStart', prepared);
    let output;
    let replayed = false;
    const cache = runCtx?.toolCallResults;

    if (cache?.has(prepared.id)) {
      output = K.mergeToolResultMeta(cache.get(prepared.id), { replayed: true, callId: prepared.id });
      replayed = true;
    } else if (!prepared.valid) {
      output = prepared.errorOutput;
    } else if (runCtx?.shouldAbort) {
      output = K.toolError(prepared.name, 'Run interrupted before tool execution.', {
        callId: prepared.id,
        interrupted: true,
        noRetry: true
      });
    } else {
      output = await K.executeToolWithRetry(prepared.name, prepared.args, runCtx);
      output = K.mergeToolResultMeta(output, { callId: prepared.id });
      cache?.set(prepared.id, output);
    }

    const result = {
      ...prepared,
      output,
      ok: K.parseToolOutputOk(output),
      replayed
    };
    callHook(hooks, 'onFinish', result);
    return result;
  }

  async function scheduleToolCalls(preparedCalls, runCtx, hooks = {}) {
    const calls = (preparedCalls || []).map((call, index) => ({ ...call, index }));
    const results = new Array(calls.length);
    let index = 0;

    while (index < calls.length) {
      if (getToolEffect(calls[index]) === 'read') {
        let end = index + 1;
        while (end < calls.length && getToolEffect(calls[end]) === 'read') end++;
        const batch = calls.slice(index, end);
        const batchResults = await Promise.all(batch.map(call => executePreparedToolCall(call, runCtx, hooks)));
        batchResults.forEach((result, offset) => { results[index + offset] = result; });
        index = end;
        continue;
      }

      results[index] = await executePreparedToolCall(calls[index], runCtx, hooks);
      index++;
    }

    return results;
  }

  K.PARALLEL_READ_TOOLS = PARALLEL_READ_TOOLS;
  K.getToolEffect = getToolEffect;
  K.isToolRetrySafe = isToolRetrySafe;
  K.executePreparedToolCall = executePreparedToolCall;
  K.scheduleToolCalls = scheduleToolCalls;
})(window.YanKernel);
