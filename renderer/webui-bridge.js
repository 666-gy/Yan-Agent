'use strict';
// Remote clients use the same admission, persistence and execution path as the composer.
(() => {
  if (!api.onWebuiRequest) return;
  const tracked = new Map(), requests = new Map(), locks = new Set(), watched = new Map(), previous = new Map();
  api.onWebuiWatch?.(id => { watched.set(id,Date.now()); });
  function publish() {
    for (const [id,time] of watched) if (Date.now()-time>10000) {watched.delete(id);tracked.delete(id);previous.delete(id);}
    if (!watched.size) return;
    if (watched.has(state.currentSession?.id)) tracked.set(state.currentSession.id, state.currentSession);
    for (const [id, entry] of state.activeRuns) if (watched.has(id)) tracked.set(id, entry.sessionRef);
    const tasks = [...tracked.values()].map(session => {
      const entry = state.activeRuns.get(session.id), ctx = entry?.runCtx;
      const messages = (session.messages || []).filter(m => ['user', 'assistant'].includes(m.role)).map(m => ({
        role:m.role, content:m.content, ts:m.ts, duration:m.duration, agentRun:m.agentRun,
        attachments:m.attachments, skillCalls:m.skillCalls, mediaAssets:m.mediaAssets, intentId:m.intentId
      }));
      if (ctx && !messages.some(m => m.agentRun?.runId && m.agentRun.runId === ctx.runId)) {
        flushOpenCodeStreamDeltas(ctx);
        messages.push({ role:'assistant', content:ctx.partialContent || '', ts:ctx.startedAt,
          agentRun:{ ...ctx.activeAgentRun, status:'working', todos:ctx.agentState?.todos || [], toolCallCount:ctx.agentState?.toolCallCount || 0 } });
      }
      return { id:session.id, title:session.title, workspace:session.workspace || '', pinned:!!session.pinned, running:!!entry,
        messagesStart:session.messagesTruncated ? Number(session.messagesStart) || 0 : 0, messages };
    });
    const changed = tasks.filter(task => { const serialized=JSON.stringify(task); if (previous.get(task.id)===serialized) return false; previous.set(task.id,serialized); return true; });
    if (changed.length) api.webuiSnapshots(changed);
    while (tracked.size > 30) {
      const id = [...tracked.keys()].find(id => !state.activeRuns.has(id) && id !== state.currentSession?.id);
      if (!id) break; tracked.delete(id);
    }
  }
  async function accept(payload) {
    const lock = payload.taskId || 'new';
    if (locks.has(lock)) return { ok:false, error:'当前任务正在接收消息，请稍后再试' };
    locks.add(lock);
    try {
      const session = payload.taskId
        ? state.activeRuns.get(payload.taskId)?.sessionRef || (state.currentSession?.id === payload.taskId ? state.currentSession : await api.getSession(payload.taskId))
        : await api.createSession(true, payload.workspace || '');
      if (!session?.id) throw new Error('任务不存在');
      if ((session.messages || []).some(m => m.role === 'user' && m.intentId === payload.intentId)) {
        tracked.set(session.id,session); watched.set(session.id,Date.now()); publish();
        return {ok:true,taskId:session.id,deduped:true};
      }
      if (isSessionExecutionActive(session.id) || !canStartRun()) throw new Error('任务正在执行或并发已满，请完成后再发送');
      const attachments = [...(payload.projectAttachments || [])];
      for (const photo of payload.photos || []) {
        const file = await api.uploadFile(photo.name, photo.base64, photo.mimeType);
        if (!file?.path) throw new Error(file?.error || '照片上传失败');
        attachments.push(file);
      }
      tracked.set(session.id, session);
      watched.set(session.id,Date.now());
      return await new Promise(resolve => {
        submitMessage(payload.text, attachments, payload.skills || [], {
          session, modelSelection:payload.model, reasoningMode:payload.reasoningMode,
          intentId:payload.intentId,
          onAccepted:() => { publish(); resolve({ok:true, taskId:session.id}); }
        }).then(result => { publish(); resolve({...result, taskId:session.id}); })
          .catch(error => resolve({ok:false,error:error.message}));
      });
    } catch (error) { return {ok:false,error:error.message}; }
    finally { locks.delete(lock); }
  }
  api.onWebuiRequest(async ({id,payload}) => {
    if (payload?.action === 'running') {
      api.webuiReply(id,{ok:true,ids:[...state.activeRuns].filter(([,entry]) => entry?.runCtx && !entry.runCtx.shouldAbort).map(([sessionId]) => sessionId)});
      return;
    }
    const key = payload?.intentId;
    if (!key) { api.webuiReply(id,{ok:false,error:'缺少消息标识'}); return; }
    if (!requests.has(key)) requests.set(key, accept(payload));
    const result = await requests.get(key);
    api.webuiReply(id,result);
    if (!result.ok) requests.delete(key);
    if (requests.size > 500) requests.delete(requests.keys().next().value);
  });
  setInterval(() => { try { publish(); } catch (error) { console.warn('[webui] snapshot',error); } }, 200);
})();
