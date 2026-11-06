/* The main renderer only launches the independent desktop window. */
(() => {
  const trigger = document.querySelector('#voiceCallButton');
  let available = false, opening = false;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  let conversation = null;
  api.onVoiceCallSound(sound => {
    if (sound === 'arc' || sound === 'ding') window.YanNotifySounds?.play(sound, state.config?.general?.notificationVolume);
  });
  api.onVoiceCallWindowState(open => {
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) conversation = null;
  });
  trigger.addEventListener('click', async () => {
    if (!available || opening) return;
    opening = true;
    try {
      window.YanVoiceInput?.cancel();
      if (!state.currentSession?.id) throw Error('请先选择一个任务');
      const result = await api.voiceCallOpen({ sessionId: state.currentSession.id });
      if (!result.ok) toast(result.error || '无法打开语音通话', { error: true });
    } catch (error) { toast(error.message, { error: true }); }
    finally { opening = false; }
  });
  // The visible record is an archive only; never reuse its kernel session or
  // normal Yan messages as the voice agent's execution context.
  async function persistTranscript(voiceSession, messages) {
    if (!voiceSession.historyId) {
      const record = await api.createSession(true, voiceSession.workspace);
      if (!record?.id) throw Error('无法创建通话历史任务');
      voiceSession.historyId = record.id;
      await api.renameSession(record.id, '妍宝通话 · ' + new Date().toLocaleString('zh-CN', { hour12: false }));
    }
    const record = await api.getSession(voiceSession.historyId);
    if (!record) throw Error('通话历史任务已删除');
    record.messages ||= [];
    for (const message of messages) {
      const index = record.messages.findIndex(item => item.voiceCallMessageId === message.voiceCallMessageId);
      if (index < 0) record.messages.push(message);
      else record.messages[index] = message;
    }
    const saved = await api.saveSession(record);
    if (saved?.error || saved?.ok === false) throw Error(saved.error || '无法保存通话历史');
    await refreshSessions();
    if (state.currentSession?.id === record.id && !isSessionExecutionActive(record.id)) {
      state.currentSession = saved;
      renderMessages(saved.messages || []);
      setEmptyState(false);
    }
  }
  const turns = new Map();
  api.onVoiceCallInterrupt(request => {
    const turn = turns.get(request.id);
    if (!turn || turn.sessionId !== request.sessionId) return;
    turn.cancelled = true;
    if (turn.ctx) {
      turn.ctx.shouldAbort = true;
      turn.ctx.runAbortController?.abort();
      if (turn.ctx.runId) api.openCodeCancelRun(turn.ctx.runId).catch(() => {});
    }
  });
  api.onVoiceCallTurn(async request => {
    const turn = { sessionId: request.sessionId, cancelled: false, started: false };
    turns.set(request.id, turn);
    let timer;
    try {
      const sessions = await api.listSessions();
      if (!sessions.some(item => item.id === request.sessionId)) throw Error('通话任务已归档或删除，请挂断后重新拨打');
      const session = state.currentSession?.id === request.sessionId ? state.currentSession : await api.getSession(request.sessionId);
      if (!session) throw Error('通话任务不存在');
      const modelSelection = normalizeModelSelectionSnapshot(getAgentModelSelection(session));
      if (modelSelection.modelType !== 'text') throw Error('语音通话需要选择文本模型');
      conversation ||= { id: '', title: '妍宝语音通话', workspace: session.workspace || '', messages: [] };
      const voiceSession = conversation;
      const ctx = createRunCtx('voice-call-' + request.id, false, voiceSession.workspace);
      ctx.utility = true; ctx.utilityKind = 'voice-call'; ctx.workMode = 'normal';
      ctx.remoteModelSelection = modelSelection; ctx.remoteReasoningMode = 'low';
      setRunModelPresentation(ctx, modelSelection);
      turn.ctx = ctx;
      const attachments = [];
      if (request.screenshot) {
        const image = await api.uploadFile('通话屏幕-' + Date.now() + '.jpg', request.screenshot, 'image/jpeg');
        if (image?.error || !image?.path) throw Error(image?.error || '无法保存屏幕截图');
        attachments.push({ name: image.name, path: image.path, size: image.size, kind: 'image', mimeType: 'image/jpeg' });
      }

      timer = setInterval(() => {

        const text = [...(ctx?.activeAgentRun?.timeline || []).filter(item => item.type === 'text').map(item => item.content || ''), ctx?.streamingContent || ''].join('\n').trim();
        if (text) api.voiceCallTurnResult({ id: request.id, partial: true, text, html: renderMarkdown(text) });
      }, 180);
      if (turn.cancelled) throw Error('任务已中断');
      turn.started = true;
      turn.voiceSession = voiceSession;
      const userMessage = { role: 'user', content: request.text, attachments, ts: Date.now(), voiceCallMessageId: request.id + ':user' };
      await persistTranscript(voiceSession, [userMessage]);
      if (turn.cancelled) throw Error('任务已中断');
      voiceSession.messages.push(userMessage);
      const result = await runOpenCodeLoop(voiceSession, null, ctx);
      const reply = result.content || '';
      const ok = !turn.cancelled && result.agentRun?.status === 'done';
      const assistantMessage = { role: 'assistant', content: reply, ts: Date.now(), voiceCallMessageId: request.id + ':assistant' };
      if (ok) voiceSession.messages.push(assistantMessage);
      else { voiceSession.messages.pop(); voiceSession.openCodeSessionId = ''; }
      await persistTranscript(voiceSession, [reply ? assistantMessage : { ...assistantMessage, content: turn.cancelled ? '（本次回复已打断）' : '（本次回复失败）' }]);
      api.voiceCallTurnResult({ id: request.id, ok, text: reply, html: renderMarkdown(reply), error: ok ? '' : '通话回复已中断或失败' });
    } catch (error) {
      if (turn.voiceSession?.messages.at(-1)?.role === 'user') {
        turn.voiceSession.messages.pop(); turn.voiceSession.openCodeSessionId = '';
      }
      api.voiceCallTurnResult({ id: request.id, ok: false, error: error.message }); }
    finally { clearInterval(timer); turns.delete(request.id); }
  });
  window.YanVoiceCall = { setAvailable(value) { available = value; } };
})();
