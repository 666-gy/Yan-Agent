/* Official DSH recording and recognition, adapted to Yan's settings and drafts. */
(() => {
  const page = document.querySelector('#tab-voice');
  const mic = document.querySelector('#voiceMicButton');
  const editor = document.querySelector('#composerInput');
  const shortcut = page.querySelector('#voiceShortcut');
  let capturingShortcut = false;
  const language = page.querySelector('#voiceLanguage');
  const source = page.querySelector('#voiceDownloadSource');
  const install = page.querySelector('#voiceInstall');
  const dialog = page.querySelector('#voiceRemoveDialog');
  const row = document.createElement('div');
  row.className = 'voice-recording-row hidden';
  row.innerHTML = '<span role="status" aria-live="polite"></span>';
  document.querySelector('.composer-editor').append(row);
  const message = row.querySelector('[role="status"]');
  const wave = document.createElement('span');
  wave.className = 'voice-wave'; wave.setAttribute('aria-hidden', 'true');
  wave.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  mic.append(wave);
  wave.hidden = true;
  const phases = { unprepared: '尚未安装语音模型', checking: '检查模型文件', downloading: '下载模型文件', loading: '加载语音模型', ready: '语音模型已就绪', standby: '语音模型已安装', waking: '唤醒语音模型', cancelling: '正在取消安装', cancelled: '安装已取消', failed: '模型准备失败' };
  let status, settingsBusy = false, current, generation = 0, pending = '', pendingSession = '', interimTimer = 0;
  let revision = 0, lastMarkup = editor.innerHTML, rowWasVisible = false;
  new MutationObserver(() => {
    if (editor.innerHTML !== lastMarkup) { revision++; lastMarkup = editor.innerHTML; }
  }).observe(editor, { childList: true, subtree: true, characterData: true });
  const editingAllowed = () => editor.contentEditable !== 'false' && !promptOptimizationRun;
  const installing = () => ['checking', 'downloading', 'loading', 'cancelling'].includes(status?.preparation?.phase) || status?.streamingPhase === 'downloading';

  function render() {
    if (!status) return;
    const rowVisible = !row.classList.contains('hidden');
    if (rowVisible !== rowWasVisible) { rowWasVisible = rowVisible; scheduleComposerGrow(); }
    const prefs = status.preferences, prep = status.preparation;
    shortcut.textContent = capturingShortcut ? '请按下快捷键…' : prefs.shortcut || 'Ctrl+Shift+1';
    shortcut.disabled = settingsBusy;
    language.value = prefs.language; source.value = prefs.downloadSource;
    language.disabled = settingsBusy; source.disabled = settingsBusy || installing();
    window.YanAppearanceControls?.sync?.();
    const busy = installing();
    const action = busy ? 'installing' : status.installed && status.streamingReady ? 'remove' : 'download';
    const fraction = prep.totalBytes > 0 ? Math.min(1, Math.max(0, prep.completedBytes / prep.totalBytes || 0)) : 0;
    const determinate = prep.phase === 'downloading' && prep.totalBytes > 0;
    const percent = Math.round(fraction * 100);
    const progress = page.querySelector('#voiceInstallProgress');
    progress.toggleAttribute('hidden', !busy);
    progress.dataset.indeterminate = String(!determinate);
    progress.style.setProperty('--voice-progress-offset', String(1 - fraction));
    if (determinate) progress.setAttribute('aria-valuenow', String(percent));
    else progress.removeAttribute('aria-valuenow');
    progress.setAttribute('aria-valuetext', determinate ? `已下载 ${percent}%` : phases[prep.phase] || '准备中');
    page.querySelector('#voiceModelSize').textContent = `${Math.round(status.modelBytes / 1000000)} MB`;
    install.dataset.state = action;
    install.querySelector('.voice-action-download').toggleAttribute('hidden', action !== 'download');
    install.querySelector('.voice-action-remove').toggleAttribute('hidden', action !== 'remove');
    install.querySelector('.voice-action-stop').hidden = !busy;
    install.disabled = settingsBusy || !status.supported || prep.phase === 'cancelling' || (action === 'remove' && !!current);
    install.title = busy ? prep.phase === 'cancelling' ? '正在取消安装' : determinate ? `已下载 ${percent}% · 取消安装` : '取消安装'
      : status.installed && status.streamingReady ? '卸载模型' : ['failed', 'cancelled'].includes(prep.phase) || status.streamingPhase === 'failed' ? '重试安装' : '下载并安装';
    install.setAttribute('aria-label', `${install.title} 流式语音模型`);
    install.setAttribute('aria-busy', String(busy));
    const error = page.querySelector('#voiceInstallError');
    error.hidden = prep.phase !== 'failed' && status.streamingPhase !== 'failed';
    const reasons = { dns: '下载源地址无法解析', timeout: '下载超时，请重试或更换下载源', certificate: '下载源证书验证失败', storage: '无法写入模型文件，请检查磁盘空间和访问权限', integrity: '模型文件校验失败，请重试', network: '网络连接失败，请重试或更换下载源', http: '下载源返回错误，请重试或更换下载源', unknown: '模型准备失败，请重试' };
    error.textContent = status.streamingError || (prep.download ? `${reasons[prep.download.reason] || reasons.unknown}${prep.download.status ? `（HTTP ${prep.download.status}）` : ''}` : prep.message || '');
    mic.classList.toggle('hidden', !status.ready && !current);
    mic.disabled = current?.phase === 'transcribing' || !editingAllowed();
    mic.setAttribute('aria-pressed', String(!!current && current.phase !== 'transcribing'));
    mic.setAttribute('aria-busy', String(current?.phase === 'transcribing'));
    mic.querySelector('svg').toggleAttribute('hidden', !wave.hidden);
    mic.classList.toggle('voice-recording', !wave.hidden);
    mic.title = current ? current.phase === 'transcribing' ? '正在转写' : '停止并转写' : '语音输入';
    mic.setAttribute('aria-label', current ? mic.title : '开始录音');
  }

  function accept(value) {
    status = value;
    if (state.config) state.config.voice = { ...value.preferences };
    if (!value.preferences.enabled) cancel();
    render();
  }
  async function call(method, ...args) {
    const result = await api[method](...args);
    if (!result?.ok) throw new Error(result?.error || '语音操作失败');
    return result.value;
  }
  async function refresh() {
    try { accept(await call('voiceStatus')); }
    catch (error) { toast(error.message, { error: true }); }
  }
  async function setting(method, payload) {
    settingsBusy = true; render();
    try { accept(await call(method, payload)); }
    catch (error) { toast(error.message, { error: true }); }
    finally { settingsBusy = false; render(); }
  }
  language.addEventListener('change', () => setting('voiceConfigure', { language: language.value }));
  source.addEventListener('change', () => setting('voiceConfigure', { downloadSource: source.value }));
  install.addEventListener('click', () => {
    if (installing()) void setting('voiceCancelPreparation');
    else if (status?.installed && status.streamingReady) dialog.showModal();
    else void setting('voicePrepare');
  });
  page.querySelector('#voiceRemoveCancel').addEventListener('click', () => dialog.close());
  page.querySelector('#voiceRemoveConfirm').addEventListener('click', async event => {
    event.target.disabled = true; cancel();
    try { await setting('voiceRemoveModels'); dialog.close(); }
    finally { event.target.disabled = false; }
  });

  function cancel() {
    ++generation;
    clearTimeout(interimTimer); interimTimer = 0;
    const active = current; current = undefined;
    if (active) {
      clearTimeout(active.limit);
      void active.recording.dispose().catch(() => {});
      void api.voiceCancel(active.requestId).catch(() => {});
    }
    pending = ''; pendingSession = '';
    wave.hidden = true;
    row.classList.add('hidden');
    render();
  }
  function feedback(text, transcript = '') {
    row.classList.remove('hidden'); message.textContent = text;
    pending = transcript; pendingSession = state.currentSession?.id || '';
    wave.hidden = true;
    render();
  }
  function insertText(text, range, caret = composerLastCaretTextOffset) {
    if (!editingAllowed()) return false;
    const selection = window.getSelection();
    range ||= composerSelectionInside()?.cloneRange();
    editor.focus({ preventScroll: true });
    if (range && range.startContainer.isConnected && range.endContainer.isConnected) {
      selection.removeAllRanges(); selection.addRange(range);
    } else setComposerCaretByTextOffset(caret);
    // Chromium records this as a single undoable edit while preserving mention tokens.
    const inserted = document.execCommand('insertText', false, text) || insertComposerPlainText(text);
    if (inserted) { invalidateComposerTextCache(); autoGrow(); updateSendState(); captureComposerDraftForSession(); }
    return inserted;
  }
  function replaceLiveText(active, text) {
    const value = String(text || '').trim();
    if (!value || !editingAllowed()) return false;
    const selection = window.getSelection();
    editor.focus({ preventScroll: true });
    if (active.liveInserted) {
      if (getComposerText().slice(active.liveStart, active.liveStart + active.liveText.length) !== active.liveText) return false;
      const liveRange = document.createRange();
      const start = composerTextPoint(active.liveStart);
      const end = composerTextPoint(active.liveStart + active.liveText.length);
      liveRange.setStart(start.node, start.offset);
      liveRange.setEnd(end.node, end.offset);
      selection.removeAllRanges(); selection.addRange(liveRange);
    } else {
      const range = active.range?.cloneRange?.();
      if (range && range.startContainer.isConnected && range.endContainer.isConnected) {
        selection.removeAllRanges(); selection.addRange(range);
      } else setComposerCaretByTextOffset(active.caret);
      active.liveStart = getComposerCaretTextOffset() - String(selection.toString()).length;
    }
    if (!document.execCommand('insertText', false, value)) return false;
    active.liveInserted = true;
    active.liveText = value;
    invalidateComposerTextCache(); autoGrow(); updateSendState(); captureComposerDraftForSession();
    return true;
  }
  function mergePartial(previous, next) {
    const before = String(previous || '').trim();
    const after = String(next || '').trim();
    if (!after) return before;
    if (!before) return after;
    if (after === before || after.startsWith(before)) return after;
    if (before.startsWith(after)) return before;
    const max = Math.min(before.length, after.length);
    for (let size = max; size > 0; size--) {
      if (before.slice(-size) === after.slice(0, size)) return before + after.slice(size);
    }
    return before + after;
  }
  async function finish() {
    const active = current;
    if (!active || active.phase !== 'recording') return;
    active.phase = 'transcribing'; clearTimeout(active.limit);
    clearTimeout(interimTimer); interimTimer = 0;
    message.textContent = '正在转写'; wave.hidden = true; render();
    try {
      const audio = await active.recording.stop(status.maxDurationSeconds);
      if (active.run !== generation) return;
      if (!active.streamFailed) {
        try { await call('voiceStreamFinish', { requestId: active.requestId }); } catch { /* final SenseVoice remains authoritative */ }
      }
      const result = await call('voiceTranscribe', { requestId: active.requestId, audio });
      if (active.run !== generation || active.session !== state.currentSession?.id) return;
      current = undefined;
      if (!result.text.trim()) { feedback('未识别到语音'); return; }
      if (active.liveInserted && replaceLiveText(active, result.text)) {
        row.classList.add('hidden');
      } else {
        const spanValid = active.revision === revision && active.markup === editor.innerHTML && !active.hasTokens;
        if (spanValid && insertText(result.text, active.range, active.caret)) row.classList.add('hidden');
        else feedback('转写已完成', result.text);
      }
    } catch (error) {
      if (active.run === generation) { current = undefined; feedback(error.message || '语音转写失败'); }
    } finally { if (active.run === generation) { current = undefined; render(); } }
  }
  async function interim(active) {
    if (current !== active || active.phase !== 'recording') return;
    try {
      const audio = await active.recording.snapshot(status.maxDurationSeconds);
      if (audio.byteLength >= 32044 && active.run === generation) {
        const result = await call('voiceTranscribe', { requestId: `${active.requestId}-interim-${++active.interim}`, audio });
        if (current === active && active.run === generation && active.session === state.currentSession?.id && result.text.trim()) {
          active.interimText = mergePartial(active.interimText, result.text);
          replaceLiveText(active, active.interimText);
          message.textContent = active.interimText;
        }
      }
    } catch { /* interim recognition is best effort */ }
    if (current === active && active.phase === 'recording') interimTimer = setTimeout(() => void interim(active), 1500);
  }
  async function streamPartial(active) {
    if (current !== active || active.phase !== 'recording') return;
    try {
      const pcm = await active.recording.readPcmChunk();
      if (pcm.byteLength && active.run === generation) {
        const result = await call('voiceStreamChunk', { requestId: active.requestId, pcm });
        if (current === active && active.run === generation && result.text?.trim()) {
          active.interimText = result.text.trim();
          replaceLiveText(active, active.interimText);
          message.textContent = active.interimText;
        }
      }
    } catch (error) {
      if (current === active && active.run === generation && !active.streamFailed) {
        active.streamFailed = true;
        message.textContent = '正在录音';
      }
    }
    if (current === active && active.phase === 'recording') interimTimer = setTimeout(() => void streamPartial(active), 120);
  }
  async function start() {
    if (current || !status?.ready || !editingAllowed()) return;
    cancel();
    const range = composerSelectionInside()?.cloneRange();
    const active = { recording: new YanVoiceAudio.Recording(() => {}), run: ++generation,
      requestId: crypto.randomUUID(), session: state.currentSession?.id, markup: editor.innerHTML, revision,
      range, caret: composerLastCaretTextOffset, interim: 0, hasTokens: !!range && [...editor.querySelectorAll(COMPOSER_TOKEN_SELECTOR)].some(token => range.intersectsNode(token)), phase: 'requesting' };
    current = active;
    row.classList.remove('hidden'); message.textContent = '正在连接麦克风';
    wave.hidden = true; render();
    try {
      await active.recording.start(error => {
        if (active.run !== generation) return;
        cancel(); feedback(recordingError(error));
      });
      if (active.run !== generation) return;
      active.phase = 'recording'; active.started = performance.now();
      try { await call('voiceStreamStart', { requestId: active.requestId }); } catch { active.streamFailed = true; }
      active.limit = setTimeout(() => { void finish(); }, status.maxDurationSeconds * 1000);
      message.textContent = '正在录音'; wave.hidden = false;
      render(); interimTimer = setTimeout(() => void streamPartial(active), 120);
    } catch (error) { if (active.run === generation) { cancel(); feedback(recordingError(error)); } }
  }
  function recordingError(error) {
    return { permission: '麦克风访问被拒绝，请检查系统麦克风权限', unavailable: '当前设备无法访问麦克风', empty: '录音为空', interrupted: '麦克风连接已中断', cancelled: '录音已取消' }[error.kind] || error.message || '无法开始录音';
  }
  mic.addEventListener('mousedown', event => event.preventDefault());
  function toggleRecording() { if (!current) void start(); else if (current.phase === 'recording') void finish(); else if (current.phase === 'requesting') cancel(); }
  mic.addEventListener('click', toggleRecording);
  function endShortcutCapture() {
    capturingShortcut = false; shortcut.setAttribute('aria-pressed', 'false'); render();
  }
  shortcut.addEventListener('click', () => {
    capturingShortcut = !capturingShortcut;
    shortcut.setAttribute('aria-pressed', String(capturingShortcut)); render();
  });
  shortcut.addEventListener('blur', endShortcutCapture);
  function shortcutFromEvent(event) {
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F(?:[1-9]|1[0-2])$/.test(event.code) ? event.code : '';
    const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean);
    return key && modifiers.length ? [...modifiers, key].join('+') : '';
  }
  document.addEventListener('keydown', event => {
    if (capturingShortcut) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { endShortcutCapture(); return; }
      const value = shortcutFromEvent(event);
      if (value && !event.repeat) { endShortcutCapture(); void setting('voiceConfigure', { shortcut: value }); }
      return;
    }
    if (shortcutFromEvent(event) !== (status?.preferences.shortcut || 'Ctrl+Shift+1')) return;
    if (currentMainPage !== 'chat') return;
    if (document.querySelector('#app').classList.contains('settings-mode') || !status?.ready || !editingAllowed()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) toggleRecording();
  }, true);
  editor.addEventListener('input', render);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && current) { event.preventDefault(); cancel(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  window.addEventListener('beforeunload', cancel);
  api.onVoiceChanged(accept);
  window.YanVoiceInput = { refresh, cancel };
  window.YanVoiceInput.mergePartial = mergePartial;
  document.addEventListener('DOMContentLoaded', () => { void refresh(); });
})();
