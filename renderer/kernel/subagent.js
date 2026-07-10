/* Yan Agent — subagent runner (explore / shell specialists) */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

  const PROFILES = {
    explore: {
      label: 'Explore',
      tools: new Set(['read_file', 'list_directory', 'search_files', 'git_status', 'git_diff', 'git_log']),
      directive: `You are an Explore subagent. READ ONLY — never edit or write files.
Goal: quickly gather facts (paths, symbols, git state, relevant snippets) for the main agent.
Output a concise structured summary: key files, findings, and recommended next steps. No filler.`
    },
    shell: {
      label: 'Shell',
      tools: new Set(['execute_shell']),
      directive: `You are a Shell subagent focused on running commands and reporting results.
Run only what is needed for the assigned task. Report exit codes and relevant stdout/stderr.
Output a concise summary of what ran and what was learned.`
    }
  };

  function filterTools(allTools, allowed) {
    return allTools.filter(t => {
      const name = t.function?.name;
      return name && allowed.has(name);
    });
  }

  async function runSubagent(type, task, context, parentRunCtx) {
    const profile = PROFILES[type];
    if (!profile) {
      return K.toolError('spawn_subagent', `Unknown subagent type "${type}". Use explore or shell.`);
    }
    const taskText = String(task || '').trim();
    if (!taskText) {
      return K.toolError('spawn_subagent', 'task is required.');
    }

    const subCtx = K.createRunCtx(parentRunCtx.sessionId, false);
    subCtx.isSubagent = true;
    subCtx.runId = parentRunCtx.runId;
    subCtx.shellAllowedOnce = parentRunCtx.shellAllowedOnce;
    subCtx.mcpToolMapSnapshot = parentRunCtx.mcpToolMapSnapshot;
    subCtx.policyState = parentRunCtx.policyState;

    const tools = filterTools(K.snapshotTools(), profile.tools);
    if (!tools.length) {
      return K.toolError('spawn_subagent', 'No tools available for subagent profile.');
    }

    let basePrompt = '';
    try {
      basePrompt = await K.buildSystemPrompt();
    } catch {
      basePrompt = 'You are Yan Agent subagent.';
    }

    const apiMessages = [
      {
        role: 'system',
        content: basePrompt + '\n\n# Subagent: ' + profile.label + '\n' + profile.directive
      },
      {
        role: 'user',
        content: (context ? String(context).trim() + '\n\n' : '') + '## Subtask\n' + taskText
      }
    ];

    let iteration = 0;
    let summary = '';
    let toolCallCount = 0;
    const maxIter = K.MAX_SUBAGENT_ITERATIONS || 12;

    while (iteration < maxIter) {
      if (parentRunCtx.shouldAbort) {
        return K.toolSuccess('spawn_subagent', summary || 'Subagent interrupted.', {
          type, iterations: iteration, toolCalls: toolCallCount, interrupted: true, subagent: true
        });
      }

      iteration++;
      const result = await K.callApiStream(apiMessages, null, subCtx, tools);

      if (result.content) summary = result.content;
      if (!result.tool_calls || !result.tool_calls.length) break;

      const assistantTurn = {
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.tool_calls
      };
      if (result.reasoning_content) assistantTurn.reasoning_content = result.reasoning_content;
      apiMessages.push(assistantTurn);

      for (const tc of result.tool_calls) {
        if (parentRunCtx.shouldAbort) break;
        const fnName = tc.function.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}

        let toolOutput;
        if (fnName === 'spawn_subagent') {
          toolOutput = K.toolError(fnName, 'Nested subagents are not allowed.', { noRetry: true });
        } else {
          toolOutput = await K.executeToolWithRetry(fnName, fnArgs, subCtx);
        }
        toolCallCount++;
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolOutput });
      }
    }

    parentRunCtx.fileChangeCount = (parentRunCtx.fileChangeCount || 0) + (subCtx.fileChangeCount || 0);

    return K.toolSuccess('spawn_subagent', summary || '(Subagent finished.)', {
      type,
      task: taskText.slice(0, 300),
      iterations: iteration,
      toolCalls: toolCallCount,
      subagent: true
    });
  }

  K.runSubagent = runSubagent;
  K.SUBAGENT_PROFILES = PROFILES;
})(window.YanKernel);
