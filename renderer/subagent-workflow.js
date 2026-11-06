/* Serializable child workflows, shared by the event bridge and the renderer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YanSubagentWorkflow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const NAMES = Object.freeze({ explorer: 'Explore', reviewer: 'Review', researcher: 'Research', tester: 'Test', builder: 'Build' });
  const terminal = status => ['completed', 'error', 'interrupted', 'incomplete'].includes(status);
  const nativeCache = new WeakMap();
  const bookkeeping = ['seenEvents', 'milestones', 'pendingDeltas', 'nextStreams', 'partKinds', 'messages'];
  function compact(record, budget = 400000) {
    for (const field of ['prompt', 'result', 'error']) {
      if (typeof record[field] === 'string' && record[field].length > Math.min(16000, Math.floor(budget / 8))) {
        record[field] = record[field].slice(0, Math.min(16000, Math.floor(budget / 8))) + '\n[内容已截断，完整记录保存在内核会话]';
        record.historyTruncated = true;
      }
    }
    let size = 0, start = record.timeline?.length || 0;
    const length = start;
    for (let i = start - 1; i >= 0 && length - i <= 240; i--) {
      const item = record.timeline[i];
      for (const field of ['output', 'content']) if (typeof item[field] === 'string' && item[field].length > 16000) item[field] = item[field].slice(0, 16000) + '\n[内容已截断，完整记录保存在内核会话]';
      const cost = JSON.stringify(item).length;
      if (size + cost > budget) break;
      size += cost; start = i;
    }
    if (start > 0) { record.timeline = record.timeline.slice(start); record.historyTruncated = true; }
    for (const field of bookkeeping) {
      record[field] ||= {};
      const keys = Object.keys(record[field]);
      if (terminal(record.status)) record[field] = {};
      else for (const key of keys.slice(0, Math.max(0, keys.length - 512))) delete record[field][key];
    }
    return record;
  }
  const STATUS_TEXT = Object.freeze({ started: '已开始工作', updated: '有了更新', completed: '已完成工作', error: '工作失败', interrupted: '工作已中止', incomplete: '工作未确认完成' });
  const dataOf = event => event?.data || event?.properties || {};
  const text = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  const outputText = value => Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item : item?.text || '').filter(Boolean).join('\n')
    : value && typeof value === 'object' && ('output' in value || Array.isArray(value.content))
      ? outputText(value.output ?? value.content) : text(value);
  const messageInfo = message => message?.info || message?.properties?.info || message?.data?.info || message || {};
  const messageParts = message => Array.isArray(message?.parts) ? message.parts
    : Array.isArray(message?.properties?.parts) ? message.properties.parts
      : Array.isArray(message?.data?.parts) ? message.data.parts : [];
  const name = role => NAMES[role] || String(role || '').replace(/^sub[ _-]+|[ _-]+agent$/gi, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const label = role => `${name(role)}子代理`;
  const roleOf = input => String(input?.subagent_type || input?.subagentType || input?.agent || input?.role || '').trim().toLowerCase();
  // Legacy plan display parser: this file is a dependency-free UMD bundle
  // shared with the renderer, so the plan marker grammar is duplicated here
  // on purpose. Keep the two parsers in sync.
  const PLAN_MARKER_RE = /^\s*yan-plan:\s*(\{.*\})\s*$/;
  function planOf(prompt) {
    for (const line of String(prompt || '').split(/\r?\n/)) {
      const match = line.match(PLAN_MARKER_RE);
      if (!match) continue;
      try {
        const raw = JSON.parse(match[1]);
        if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) return null;
        return {
          id: raw.id.trim().slice(0, 64),
          dependsOn: (Array.isArray(raw.dependsOn) ? raw.dependsOn : [])
            .filter(item => typeof item === 'string' && item.trim())
            .map(item => item.trim().slice(0, 64))
            .slice(0, 8),
          acceptance: typeof raw.acceptance === 'string' ? raw.acceptance.trim().slice(0, 400) : ''
        };
      } catch { return null; }
    }
    return null;
  }
  const isTask = part => part?.type === 'subtask' || (part?.type === 'tool' && String(part.tool).toLowerCase() === 'task');
  function taskInfo(part = {}) {
    const state = part.state || {};
    const input = state.input || part.args || {};
    const metadata = { ...(state.output?.metadata || {}), ...(state.metadata || part.metadata || {}) };
    const output = outputText(state.output ?? part.result ?? '');
    const wrapper = output.match(/<task\b[^>]*\bid=["']([^"']+)["'][^>]*>/i);
    const wrapperState = output.match(/<task\b[^>]*\bstate=["']([^"']+)["']/i)?.[1];
    const inner = output.match(/<task_result>([\s\S]*?)<\/task_result>/i);
    const rawStatus = String(wrapperState || state.status || part.status || 'running');
    const status = ['completed', 'done', 'success'].includes(rawStatus) ? 'completed'
      : ['error', 'failed'].includes(rawStatus) ? 'error'
        : ['cancelled', 'interrupted', 'aborted'].includes(rawStatus) ? 'interrupted' : 'running';
    const prompt = text(input.prompt || part.prompt);
    return {
      agentID: metadata.agentID || '', activationID: metadata.activationID || '', workflow: metadata.workflow,
      callId: String(part.callID || part.callId || part.toolCallID || part.id || ''),
      partId: String(part.id || ''),
      childSessionID: String(metadata.sessionID || metadata.sessionId || metadata.session_id || part.childSessionID || part.childId || wrapper?.[1] || ''),
      role: roleOf(input) || roleOf(part),
      title: text(input.description || part.description || metadata.description),
      prompt,
      plan: planOf(prompt),
      result: inner ? inner[1].trim() : output.trim(),
      error: text(state.error || part.error),
      startedAt: Number(state.time?.start || part.time?.start) || undefined,
      completedAt: Number(state.time?.end || part.time?.end) || undefined,
      status
    };
  }
  function ensure(run) {
    if (!Array.isArray(run.subagents)) run.subagents = [];
    if (!Array.isArray(run.timeline)) run.timeline = [];
    return run.subagents;
  }
  function upsert(timeline, key, item) {
    const index = timeline.findIndex(entry => entry.openCodeKey === key);
    const next = { ...(index >= 0 ? timeline[index] : {}), stage: 'work', ...item, openCodeKey: key };
    if (index >= 0) timeline[index] = next;
    else timeline.push(next);
    return next;
  }
  function notice(run, record, state, at) {
    if (record.workflow?.workflowId) return;
    const suffix = STATUS_TEXT[state];
    const previous = run.timeline.find(item => item.openCodeKey === record.noticeKey);
    const revision = Number(run.subagentParentRevision) || 0;
    // A child cannot rewrite past parent work. While the parent is waiting,
    // reuse the current line; otherwise insert at the current timeline position.
    const append = !previous || revision > (record.noticeParentRevision || 0);
    const key = append ? `subagent:${record.id}:${++record.noticeSequence}` : record.noticeKey;
    // Subagent status is work-process content: keep it out of the summary text
    // even while the parent is already streaming its final answer.
    upsert(run.timeline, key, { type: 'subagent_status', subagentId: record.id, callId: record.callId,
      agentID: record.agentID || '', childSessionID: record.childSessionID || '',
      role: record.role, status: state, content: label(record.role) + suffix, at,
      stage: 'work' });
    record.noticeKey = key;
    record.noticeParentRevision = revision;
    run.subagentTimelineRevision = (Number(run.subagentTimelineRevision) || 0) + 1;
    run.subagentTimelineKey = key;
  }
  function findOrCreate(run, info, at) {
    const records = ensure(run);
    const byCall = info.callId && records.find(r => r.callId === info.callId || (info.partId && r.partId === info.partId));
    let bySession = info.childSessionID && records.find(r => r.childSessionID === info.childSessionID
      && (!info.callId || !r.callId || r.callId === info.callId));
    // Live child events reach the store before the parent tool part exposes its
    // session metadata. Bind that session to the pending record (same role and
    // title) so live output lands on the existing row instead of a duplicate.
    if (!byCall && !bySession && info.childSessionID && !info.callId) {
      const pending = records.filter(r => r.status === 'running' && !r.childSessionID
        && (!info.role || !r.role || r.role === info.role));
      const titled = pending.filter(r => info.title && r.title && r.title === info.title);
      bySession = titled[0] || pending[0] || null;
    }
    let record = (info.agentID && records.find(r => r.agentID === info.agentID)) || byCall || bySession;
    if (record && info.activationID && record.activationID && info.activationID !== record.activationID) {
      record.retiredActivations ||= [];
      if (record.retiredActivations.includes(info.activationID)) return { record, created: false, stale: true };
      record.retiredActivations.push(record.activationID);
      record.retiredActivations = record.retiredActivations.slice(-128);
      record.status = 'running'; record.completedAt = null; record.result = ''; record.error = '';
      for (const field of bookkeeping) record[field] = {};
    }
    if (byCall && bySession && byCall !== bySession) {
      for (const item of bySession.timeline) upsert(byCall.timeline, item.openCodeKey, item);
      for (const field of ['milestones', 'messages', 'partKinds', 'pendingDeltas', 'nextStreams', 'seenEvents']) {
        byCall[field] = { ...bySession[field], ...byCall[field] };
      }
      byCall.modelId ||= bySession.modelId;
      records.splice(records.indexOf(bySession), 1);
      run.timeline = run.timeline.filter(item => item.subagentId !== bySession.id);
      if (terminal(bySession.status)) finish(run, byCall, bySession.status, bySession.completedAt || at, bySession.error);
    }
    const created = !record;
    if (!record) {
      const identity = info.callId ? `call:${info.callId}` : `session:${info.childSessionID}`;
      record = { id: `${run.runId || run.openCodeSessionId || run.startedAt || 'history'}/${identity}`,
        callId: '', childSessionID: '', role: '', title: '', prompt: '', status: 'running',
        startedAt: at, timeline: [], messages: {}, partKinds: {}, pendingDeltas: {}, nextStreams: {},
        milestones: {}, seenEvents: {}, noticeSequence: 0, revision: 0, result: '', error: '' };
      records.push(record);
    }
    const previousRole = record.role;
    const previousIdentity = [record.agentID, record.childSessionID].join('|');
    for (const field of bookkeeping) record[field] ||= {};
    for (const field of ['agentID', 'activationID', 'callId', 'partId', 'childSessionID', 'role', 'title', 'prompt', 'plan', 'workflow']) {
      if (info[field]) record[field] = info[field];
    }
    if (info.startedAt) record.startedAt = Math.min(record.startedAt, info.startedAt);
    // Session registration may precede task metadata. Refresh existing names
    // and avatar identities when the authoritative fields arrive.
    const identityChanged = previousIdentity !== [record.agentID, record.childSessionID].join('|');
    for (const item of previousRole !== record.role || identityChanged ? run.timeline : []) {
      if (item.subagentId === record.id) {
        item.agentID = record.agentID || '';
        item.childSessionID = record.childSessionID || '';
        item.role = record.role;
        item.content = label(record.role) + (STATUS_TEXT[item.status] || STATUS_TEXT.started);
      }
    }
    if (created) notice(run, record, 'started', at);
    return { record, created };
  }
  function milestone(run, record, key, value, at, quiet) {
    if (value) {
      let hash = 2166136261;
      for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
      value = `${value.length}:${hash >>> 0}`;
    }
    if (!value || record.milestones[key] === value) return;
    record.milestones[key] = value;
    record.revision++;
    if (!quiet && !terminal(record.status)) notice(run, record, 'updated', at);
  }
  function finish(run, record, status, at, error = '') {
    if (terminal(record.status)) {
      if (record.status === status && error) record.error = error;
      return;
    }
    record.status = status;
    if (run.subagentWaiting) run.subagentWaiting = run.subagents.filter(item => item.status === 'running').length;
    record.completedAt = at;
    record.error = error;
    record.timeline = record.timeline.map(item => ({ ...item, streaming: false }));
    notice(run, record, status, at);
    compact(record, Math.min(400000, Math.floor(2000000 / Math.max(1, run.subagents.length))));
  }
  function childEvent(run, record, event, at, quiet = false) {
    if (terminal(record.status) && !quiet) return;
    record.seenEvents ||= {};
    if (event.id && record.seenEvents[event.id]) return;
    if (event.id) record.seenEvents[event.id] = true;
    const data = dataOf(event);
    const part = data.part;
    if (event.type === 'yan.opencode.started') {
      record.modelId = data.modelId || record.modelId;
      record.modelName = data.modelName || record.modelName;
      record.reasoningMode = data.reasoningMode || record.reasoningMode;
    }
    if (event.type === 'yan.model.request.started') record.executionStartedAt ||= at;
    if ((event.type === 'message.part.delta' && ['text', 'reasoning'].includes(data.field) && text(data.delta).trim())
      || (event.type === 'message.part.updated' && (part?.type === 'tool' || (['text', 'reasoning'].includes(part?.type) && text(part.text).trim())))) {
      record.responseStartedAt ||= at;
    }
    if (event.type === 'message.updated') {
      const info = data.info || {};
      record.messages[info.id] = { role: info.role, completed: !!info.time?.completed };
      if (info.modelID) record.modelId = info.modelID;
      if (info.role === 'user') record.timeline = record.timeline.filter(item => item.messageID !== info.id);
      // Message completion is a milestone, never task completion.
      if (info.role === 'assistant' && info.time?.completed) {
        for (const item of record.timeline.filter(item => item.messageID === info.id && ['text', 'thinking'].includes(item.type))) {
          item.streaming = false;
          milestone(run, record, item.openCodeKey, item.content?.trim(), at, quiet);
        }
      }
    } else if (event.type === 'message.part.updated' && part && !part.ignored) {
      const id = String(part.id || part.callID || '');
      if (!id) return;
      record.partKinds[id] = part.type;
      if (record.messages[part.messageID]?.role === 'user') return;
      if (['text', 'reasoning'].includes(part.type)) {
        const content = text(part.text) || record.pendingDeltas[id] || '';
        delete record.pendingDeltas[id];
        const completed = !!part.time?.end || record.messages[part.messageID]?.completed;
        upsert(record.timeline, `${part.type}:${id}`, { type: part.type === 'reasoning' ? 'thinking' : 'text',
          messageID: part.messageID, content, streaming: !completed });
        if (completed) milestone(run, record, `${part.type}:${id}`, content.trim(), at, quiet);
      } else if (part.type === 'tool') {
        const callId = part.callID || id;
        const state = part.state || {};
        upsert(record.timeline, `tool-call:${callId}`, { type: 'tool_call', callId, name: part.tool,
          args: state.input || {}, messageID: part.messageID, startedAt: state.time?.start || at });
        if (['completed', 'success', 'error', 'failed', 'cancelled', 'interrupted'].includes(String(state.status).toLowerCase())) {
          const output = outputText(state.output || state.error);
          const normalizedStatus = String(state.status).toLowerCase();
          upsert(record.timeline, `tool-result:${callId}`, { type: 'tool_result', callId, name: part.tool,
            output, metadata: state.metadata || {}, ok: ['completed', 'success'].includes(normalizedStatus), interrupted: ['cancelled', 'interrupted'].includes(normalizedStatus), completedAt: state.time?.end || at });
          milestone(run, record, `tool:${callId}`, `${normalizedStatus}:${output}`, at, quiet);
        }
      }
    } else if (event.type === 'message.part.delta') {
      const id = String(data.partID || '');
      if (!id || record.nextStreams[id] || !['text', 'reasoning'].includes(data.field)) return;
      const kind = record.partKinds[id];
      if (!kind) { record.pendingDeltas[id] = (record.pendingDeltas[id] || '') + text(data.delta); return; }
      const key = `${kind}:${id}`;
      const previous = record.timeline.find(item => item.openCodeKey === key);
      if (previous && !previous.streaming) return;
      upsert(record.timeline, key, { type: kind === 'reasoning' ? 'thinking' : 'text', messageID: data.messageID,
        content: (previous?.content || '') + text(data.delta), streaming: true });
    } else if (/^session\.next\.(text|reasoning)\.(delta|ended)$/.test(event.type)) {
      const kind = event.type.split('.')[2];
      const id = String(data.textID || data.reasoningID || data.partID || 'stream');
      const key = `${kind}:${id}`;
      record.nextStreams[id] = true;
      const previous = record.timeline.find(item => item.openCodeKey === key);
      const end = event.type.endsWith('.ended');
      if (previous && !previous.streaming && !end) return;
      const content = end && typeof data.text === 'string' ? data.text : (previous?.content || '') + (end ? '' : text(data.delta));
      upsert(record.timeline, key, { type: kind === 'reasoning' ? 'thinking' : 'text', messageID: data.assistantMessageID, content, streaming: !end });
      if (end) milestone(run, record, key, content.trim(), at, quiet);
    } else if (event.type === 'session.next.tool.called') {
      upsert(record.timeline, `tool-call:${data.callID}`, { type: 'tool_call', callId: data.callID, name: data.tool, args: data.input || {}, startedAt: at });
    } else if (/^session\.next\.tool\.(success|failed)$/.test(event.type)) {
      const call = record.timeline.find(item => item.callId === data.callID && item.type === 'tool_call');
      const output = outputText(data.result ?? data.content ?? data.error);
      const ok = event.type.endsWith('.success');
      upsert(record.timeline, `tool-result:${data.callID}`, { type: 'tool_result', callId: data.callID, name: call?.name || data.tool, output, metadata: data.structured || data.metadata || data.result?.metadata || {}, ok, completedAt: at });
      milestone(run, record, `tool:${data.callID}`, `${ok ? 'completed' : 'error'}:${output}`, at, quiet);
    } else if (event.type === 'message.part.removed') {
      record.timeline = record.timeline.filter(item => !item.openCodeKey.endsWith(`:${data.partID}`));
    } else if (event.type === 'message.removed') {
      record.timeline = record.timeline.filter(item => item.messageID !== data.messageID);
    } else if (event.type === 'session.error') {
      finish(run, record, 'error', at, text(data.error?.data?.message || data.error?.message || data.error));
    }
  }
  function consume(run, event, at = Date.now(), { quiet = false } = {}) {
    ensure(run);
    const timelineRevision = Number(run.subagentTimelineRevision) || 0;
    // Child-session activity only touches the subagent record; a parent-row
    // notice bumps subagentTimelineRevision. Renderers use this signal to avoid
    // re-reconciling an entire (long) parent message for child token churn.
    const result = (handled, created, record = null) => ({
      handled,
      created,
      record,
      timelineChanged: (Number(run.subagentTimelineRevision) || 0) !== timelineRevision,
      timelineKey: String(run.subagentTimelineKey || '')
    });
    const data = dataOf(event);
    if (event.type === 'yan.workflow.updated' && data.workflow?.id) {
      const key = `workflow:${data.workflow.id}`;
      const previous = run.timeline.find(item => item.openCodeKey === key);
      if ((previous?.workflow?.revision || 0) >= data.workflow.revision) return result(true, false);
      upsert(run.timeline, key, { type: 'workflow_orchestration', workflow: data.workflow, stage: 'work' });
      run.subagentTimelineRevision = timelineRevision + 1;
      run.subagentTimelineKey = key;
      return result(true, false);
    }
    if (event.type === 'yan.subagent.waiting') {
      run.subagentWaiting = data.count || 0;
      upsert(run.timeline, 'delegation:waiting', { type: 'progress', content: `等待 ${data.count || 0} 个子代理返回结果` });
      run.subagentTimelineRevision = timelineRevision + 1;
      return result(true, false);
    }
    let info;
    if (event.type === 'yan.subagent.event' || event.type === 'yan.subagent.history') {
      info = { ...data, role: data.subagentType || data.role };
    } else if (isTask(data.part)) info = taskInfo(data.part);
    else if (event.type === 'session.next.tool.called' && data.tool === 'task') {
      info = taskInfo({ type: 'tool', tool: 'task', callID: data.callID, state: { input: data.input } });
    } else if (/^session\.next\.tool\.(success|failed)$/.test(event.type)) {
      const existing = run.subagents.find(r => r.callId === data.callID);
      if (existing) info = taskInfo({ callID: data.callID, state: { output: data.result ?? data.content,
        metadata: data.structured, error: data.error, status: event.type.endsWith('.success') ? 'completed' : 'error' } });
    }
    if (!info) return result(event.type?.startsWith('yan.subagent.') || false, false);
    if (!info.callId && !info.childSessionID) return result(true, false);
    const { record, created, stale } = findOrCreate(run, info, at);
    if (stale || (terminal(record.status) && event.type === 'yan.subagent.event')) return result(true, false, record);
    if (event.type === 'yan.subagent.event') {
      if (data.event) childEvent(run, record, data.event, at, quiet);
    } else if (event.type === 'yan.subagent.history') {
      for (const message of data.messages || []) {
        const info = messageInfo(message);
        childEvent(run, record, { type: 'message.updated', data: { info } }, at, true);
        for (const part of messageParts(message)) childEvent(run, record, { type: 'message.part.updated', data: { part: { ...part, messageID: part.messageID || info?.id } } }, at, true);
      }
      record.historyError = text(data.historyError);
    } else {
      if (info.status === 'completed') record.result = info.result;
      if (terminal(info.status)) finish(run, record, info.status, info.completedAt || at, info.error);
    }
    record.outputRevision = (record.outputRevision || 0) + 1;
    // Token deltas mutate one text item and cannot grow the timeline; compact
    // them only when the record is already over budget. Tool/text completion
    // events still compact every time.
    const streamDelta = event.type === 'yan.subagent.event' && data.event?.type === 'message.part.delta';
    if (!streamDelta || (record.timeline?.length || 0) > 260) {
      compact(record, Math.min(400000, Math.floor(2000000 / Math.max(1, run.subagents.length))));
    }
    return result(true, created, record);
  }
  function noteParentWork(run, previous, next) {
    if (!['text', 'thinking', 'tool_call', 'tool_result'].includes(next.type) || next.name === 'task') return;
    const visible = item => item && [item.type, item.content || '', item.name || '', item.args || null, item.output || '', item.ok];
    if (JSON.stringify(visible(previous)) !== JSON.stringify(visible(next))) run.subagentParentRevision = (Number(run.subagentParentRevision) || 0) + 1;
  }
  function finalize(run, status, at = Date.now()) {
    for (const record of ensure(run)) {
      if (!terminal(record.status)) finish(run, record, status === 'error' ? 'error' : status === 'interrupted' ? 'interrupted' : 'incomplete', at,
        status === 'error' ? '主任务异常结束，子代理未确认完成。'
          : status === 'interrupted' ? '主任务已中止，子代理随之中止。' : '主任务已结束，子代理未确认完成。');
    }
  }
  function reconcile(run, records = []) {
    for (const incoming of records || []) {
      if (!incoming) continue;
      const record = ensure(run).find(item => (incoming.callId && item.callId === incoming.callId)
        || (incoming.childID && item.childSessionID === incoming.childID));
      if (!record) continue;
      if (incoming.result) record.result = incoming.result;
      const status = ['completed', 'error', 'interrupted'].includes(incoming.status) ? incoming.status : '';
      if (!status || record.status === status) continue;
      if (!terminal(record.status)) {
        finish(run, record, status, Date.now(), status === 'error' ? '子代理失败' : '');
        continue;
      }
      // The run result can arrive after the UI finalized a still-working child
      // as incomplete. Authoritative completion repairs that record; other
      // terminal states are never reopened.
      if (record.status === 'incomplete' && status === 'completed') {
        record.status = 'completed';
        record.completedAt ||= Date.now();
        record.error = '';
        record.timeline = record.timeline.map(item => ({ ...item, streaming: false }));
        notice(run, record, 'completed', record.completedAt);
      }
    }
  }
  function importRecords(run, records) {
    for (const incoming of records || []) {
      const { record } = findOrCreate(run, incoming, incoming.startedAt || Date.now());
      for (const item of incoming.timeline || []) upsert(record.timeline, item.openCodeKey, item);
      if (incoming.modelId) record.modelId = incoming.modelId;
      if (incoming.result) record.result = incoming.result;
      record.historyError = incoming.historyError || '';
      if (terminal(incoming.status)) finish(run, record, incoming.status, incoming.completedAt || Date.now(), incoming.error);
    }
  }
  function migrate(run) {
    if (!run || run.isSubagent) return;
    ensure(run);
    // Saved status rows predate the ID-based avatars. Rebind them to their
    // child record so the parent timeline and sidebar share visual identity.
    const records = new Map(run.subagents.map(record => [record.id, record]));
    for (const item of run.timeline) {
      if (item.type !== 'subagent_status') continue;
      const record = records.get(item.subagentId);
      if (!record) continue;
      item.agentID = record.agentID || '';
      item.childSessionID = record.childSessionID || '';
    }
    if (!run.timeline.some(item => item.type === 'subtask' || (item.type === 'tool_call' && item.name === 'task'))) return;
    const old = run.timeline;
    run.timeline = [];
    for (let index = 0; index < old.length; index++) {
      const item = old[index];
      if (item.type === 'tool_call' && item.name === 'task') {
        const result = old.find(r => r.type === 'tool_result' && r.callId === item.callId);
        const { record } = consume(run, { type: 'message.part.updated', data: { part: { type: 'tool', tool: 'task', callID: item.callId || `legacy-${index}`,
          state: { input: item.args || {}, output: result?.output, status: result ? (result.ok === false ? 'error' : 'completed') : 'running', time: { start: item.startedAt, end: result?.completedAt } } } } }, item.startedAt || run.startedAt || 0, { quiet: true });
        record.legacy = true;
      } else if (item.type === 'subtask') {
        consume(run, { type: 'message.part.updated', data: { part: { ...item, id: item.callId || item.childId || `legacy-${index}` } } }, run.startedAt || 0, { quiet: true });
      } else if (!(item.type === 'tool_result' && (item.name === 'task' || old.some(c => c.type === 'tool_call' && c.name === 'task' && c.callId === item.callId)))
        && !/^subagent-(capacity|progress)/.test(item.openCodeKey || '')) {
        run.timeline.push(item);
        noteParentWork(run, null, item);
      }
    }
    if (run.status && run.status !== 'working') finalize(run, run.status, run.completedAt);
  }
  function nativeRun(record) {
    const key = [record.outputRevision, record.revision, record.status, record.result, record.historyError].join('|');
    const cached = nativeCache.get(record);
    if (cached?.key === key) return cached.value;
    const timeline = record.timeline.map(item => ({ ...item }));
    if (record.legacy && !timeline.length) {
      timeline.push({ type: 'progress', content: '这条记录由旧版本 Yan 保存，只存了最终结果，当时的工具调用过程没有留档；之后的新任务会完整显示工具调用与工作过程。', openCodeKey: 'child:legacy-history' });
    }
    // The final message may consist of several text parts. Treat the trailing
    // text group as one answer; comparing the result to individual parts made
    // the assembled result appear a second time when work was expanded.
    const lastWork = timeline.findLastIndex(item => ['tool_call', 'tool_result', 'thinking'].includes(item.type));
    const answerParts = timeline.slice(lastWork + 1).filter(item => item.type === 'text' && item.content?.trim());
    if (record.result && !answerParts.some(item => item.content.trim() === record.result.trim())
      && ![answerParts.map(item => item.content).join(''), answerParts.map(item => item.content).join('\n')].some(value => value.trim() === record.result.trim())) {
      // The settled result is authoritative for the last answer, while earlier
      // narration preceding tool/thinking activity remains in work history.
      if (terminal(record.status)) for (const item of answerParts) timeline.splice(timeline.indexOf(item), 1);
      timeline.push({ type: 'text', content: record.result, stage: 'summary', streaming: false, openCodeKey: 'child:result' });
    }
    if (record.status === 'completed' && !record.result && !timeline.some(item => item.type === 'text' && item.content?.trim())) {
      timeline.push({ type: 'progress', content: '子代理未返回文字结果', openCodeKey: 'child:empty-result' });
    }
    if (record.historyError) timeline.push({ type: 'progress', content: `部分工作记录未能同步：${record.historyError}`, openCodeKey: 'child:history-error' });
    // Final text is answer content even for text-only children. Only activity
    // preceding that answer belongs behind "查看工作过程".
    const answerStart = timeline.findLastIndex(item => ['tool_call', 'tool_result', 'thinking'].includes(item.type)) + 1;
    const summaryParts = timeline.slice(answerStart).filter(item => item.type === 'text' && String(item.content || '').trim());
    const summaryStarted = summaryParts.length > 0;
    for (const item of summaryParts) item.stage = 'summary';
    if (record.historyTruncated) timeline.unshift({ type: 'progress', content: '较早工作记录已折叠，完整记录保存在内核会话。', openCodeKey: 'child:history-truncated' });
    const value = { isSubagent: true, runId: record.id, status: record.status === 'running' ? 'working' : record.status === 'completed' ? 'done' : record.status === 'incomplete' ? 'error' : record.status,
      startedAt: record.startedAt, completedAt: record.completedAt, durationMs: Math.max(0, (record.completedAt || Date.now()) - record.startedAt),
      modelId: record.modelId || '', responseStartedAt: record.responseStartedAt,
      executionStartedAt: record.executionStartedAt, summaryStarted, timeline, error: record.error,
      toolCallCount: timeline.filter(item => item.type === 'tool_call').length, textContent: record.result || '' };
    nativeCache.set(record, { key, value });
    return value;
  }
  return { NAMES, name, label, isTask, taskInfo, dataOf, ensure, consume, noteParentWork, finalize, reconcile, importRecords, migrate, nativeRun, compact };
});
