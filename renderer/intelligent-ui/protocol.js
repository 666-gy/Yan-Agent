// Acceptance records remain authoritative; pending/failed tool input is never executed.
export const isTool = name => /^(?:yan_session_)?intelligent_ui_creator$/.test(String(name || ''));
  function decode(value, depth = 0) {
    if (depth > 5 || value == null) return null;
    if (typeof value === 'string') {
      try { return decode(JSON.parse(value), depth + 1); } catch { return null; }
    }
    if (value.intelligent_ui?.version === 1) return value;
    if (Array.isArray(value)) {
      for (const part of value) { const found = decode(part, depth + 1); if (found) return found; }
    }
    for (const key of ['structuredContent', 'content', 'text', 'output']) {
      if (value[key]) { const found = decode(value[key], depth + 1); if (found) return found; }
    }
    return null;
  }
export function fromCall(call, result, runStatus) {
    const payload = result?.ok !== false ? decode(result?.output) : null;
    const raw = payload?.ok === true ? payload.intelligent_ui : null;
    const args = call.args || {};
    const format = raw?.format || 'html';
    const id = String(raw?.id || args.task_id || call.callId || '');
    const accepted = raw?.status === 'ready' && raw.id === args.task_id && args.action === 'render' && format === (args.format || 'html');
    const code = accepted && format === 'openui' && typeof args.code === 'string' && args.code.length <= 65536 && !Object.hasOwn(args, 'html') ? args.code.trim() : '';
    const html = accepted && format === 'html' && !Object.hasOwn(args, 'code')
      && typeof args.html === 'string' && args.html.length <= 163840 ? args.html.trim() : '';
    return {
      type: 'intelligent_ui', openCodeKey: `intelligent-ui:${id}`, stage: 'summary',
      id, revision: Number.isSafeInteger(raw?.revision) ? raw.revision : 0,
      resources: html || code ? raw.resources || null : null, format, code,
      handoff: !!code && raw.handoff === true && args.handoff === true,
      title: String(raw?.title || args.title || 'Intelligent UI').slice(0, 100),
      purpose: String(raw?.purpose || args.purpose || '').slice(0, 500), html,
      status: html || code ? 'ready' : result?.ok === false ? 'error' : runStatus === 'working' ? 'creating' : 'incomplete'
    };
  }

// Project tool history before work rows are folded, so the UI stays visible in chat.
export function projectTimeline(timeline, status) {
  const calls = new Set(timeline.filter(item => item.type==='tool_call' && isTool(item.name)).map(item=>item.callId));
  if (!calls.size) return timeline;
  const results = new Map(timeline.filter(item=>item.type==='tool_result' && calls.has(item.callId)).map(item=>[item.callId,item]));
  const panels = new Map(), projected = [];
  for (const item of timeline) {
    if (item.type==='tool_result' && calls.has(item.callId)) continue;
    if (item.type!=='tool_call' || !isTool(item.name)) {projected.push(item);continue;}
    const next=fromCall(item,results.get(item.callId),status);
    const previous=panels.get(next.id);
    if (!previous) {panels.set(next.id,next);projected.push(next);}
    else if (next.html || next.code || !(previous.html || previous.code)) {
      const title=next.title==='Intelligent UI'?previous.title:next.title;
      Object.assign(previous,next,{title,purpose:next.purpose || previous.purpose});
    }
  }
  return projected;
}
