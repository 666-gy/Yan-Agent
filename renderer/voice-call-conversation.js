/* One utterance at a time: listen -> final ASR -> task -> speech -> listen.
   Capture pauses while Yan speaks, preventing speaker audio from becoming input. */
(() => {
  let enabled = true, generation = 0, active, timer, audio, audioUrl, speechId, playbackDone, waiting = false, responding = false, welcomed = false;
  const status = document.getElementById('callStatus');
  const pill = document.getElementById('callStatePill');
  const title = document.getElementById('callTitle');
  const interrupt = document.getElementById('callInterrupt');
  const wave = document.querySelector('.call-wave');
  let speaking = false;
  function center(reply = responding) { responding = reply; interrupt.hidden = !reply; if (!reply) speaking = false; if (reply) interrupt.textContent = speaking ? '打断妍宝' : '我正在组织回答'; document.getElementById('callSpeakingBubble').hidden = !reply; title.hidden = reply || !enabled; status.hidden = reply; }
  const buttons = ['callMic', 'miniCallMic'].map(id => document.getElementById(id));
  const render = window.YanCallTranscript;
  async function rpc(method, payload) {
    const r = await window.voiceCall.media(method, payload);
    if (!r?.ok) throw Error(r?.error || '语音操作失败'); return r.value;
  }
  function label(text) {
    const phase = text === '畅所欲言' ? 'welcome' : text === '正在听…' ? 'listening' : 'status';
    pill.setAttribute('data-phase', phase);
    title.hidden = responding || !enabled || phase === 'status';
    status.textContent = text; status.setAttribute('aria-live', 'polite'); status.title = text; document.getElementById('callTitle').title = text; }
  function sync() {
    center();
    for (const b of buttons) { b.innerHTML = window.YanCallMicIcons[enabled ? 'mic' : 'mic-off']; b.setAttribute('aria-pressed', String(enabled)); b.title = enabled ? '关闭麦克风' : '开启麦克风'; b.setAttribute('aria-label', b.title); }
  }
  function stopCapture() {
    clearTimeout(timer);
    const previous = active; active = null;
    if (previous) { void previous.recording.dispose().catch(() => {}); void rpc('cancel', previous.id).catch(() => {}); }
  }
  function stopPlayback() {
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    playbackDone?.(); playbackDone = null;
    if (speechId) void rpc('cancelSpeech', speechId).catch(() => {});
    speechId = null;
  }
  function fail(error, token) {
    if (token !== generation) return;
    responding = false; enabled = false; stopCapture(); stopPlayback(); sync(); status.setAttribute('data-error', 'true');
    label(({ permission: '麦克风权限被拒绝', unavailable: '没有可用麦克风' })[error.kind] || error.message || '通话出现错误');
  }
  async function start() {
    if (!enabled || waiting || active) return;
    center(false);
    const token = generation;
    const a = { id: crypto.randomUUID(), recording: new YanVoiceAudio.Recording(() => {}), token, started: performance.now(), heard: false, lastVoice: performance.now(), stream: false, max: 60 };
    active = a; status.setAttribute('data-error', 'false'); label(welcomed ? '正在听…' : '畅所欲言');
    try {
      const info = await rpc('status'); a.max = Math.min(info.maxDurationSeconds || 60, 60);
      if (token !== generation) return;
      await a.recording.start(error => fail(error, token));
      if (token !== generation) { await a.recording.dispose(); return; }
      try { await rpc('streamStart', { requestId: a.id }); a.stream = true; } catch { /* final recognition remains available */ }
      if (token !== generation) { await rpc('cancel', a.id); return; }
      a.started = performance.now(); a.lastVoice = a.started; label(welcomed ? '正在听…' : '畅所欲言');
      void poll(a);
    } catch (error) { fail(error, token); }
  }
  async function poll(a) {
    if (active !== a || a.token !== generation) return;
    try {
      const now = performance.now();
      const amplitude = a.recording.amplitude();
      wave.setAttribute('data-level', String(Math.min(3, Math.floor(amplitude * 45))));
      if (amplitude > .018) { welcomed = true; label('正在听…'); a.heard = true; a.lastVoice = now; }
      if (a.stream) {
        const pcm = await a.recording.readPcmChunk();
        if (pcm.byteLength) {
          const r = await rpc('streamChunk', { requestId: a.id, pcm });
          if (active !== a || a.token !== generation) return;
          if (r.text?.trim()) render({ id: a.id, role: 'user', text: r.text, final: false });
        }
      }
      if (a.heard && now - a.lastVoice > 1100) { await finish(a); return; }
      if (now - a.started > a.max * 1000) {
        if (a.heard) await finish(a);
        else { stopCapture(); if (enabled) void start(); }
        return;
      }
    } catch (error) { if (active === a) { a.stream = false; void rpc('cancel', a.id).catch(() => {}); label('正在听…'); } }
    if (active === a && a.token === generation) timer = setTimeout(() => void poll(a), 100);
  }
  async function speak(text, token) {
    // Submit the complete final body once; never pre-read partial output.
    const plain = text.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_`>]/g, '').trim();
    const chunks = plain ? [plain] : [];
    for (const text of chunks) {
      if (token !== generation) return;
      speechId = crypto.randomUUID();
      const r = await rpc('synthesize', { text, requestId: speechId });
      if (token !== generation) return;
      audioUrl = URL.createObjectURL(new Blob([new Uint8Array(r.audio)], { type: r.mime }));
      audio = new Audio(audioUrl);
      audio.onplaying = () => { if (token === generation) { speaking = true; center(true); } };
      await new Promise((resolve, reject) => {
        playbackDone = resolve; audio.onended = resolve; audio.onerror = () => reject(Error('语音播放失败'));
        audio.play().catch(reject);
      });
      stopPlayback();
    }
  }
  async function finish(a) {
    if (active !== a) return;
    clearTimeout(timer); label('正在发送你的消息');
    try {
      const wav = await a.recording.stop(a.max);
      if (a.token !== generation) return;
      if (a.stream) await rpc('streamFinish', { requestId: a.id }).catch(() => {});
      const r = await rpc('transcribe', { requestId: a.id, audio: wav });
      if (a.token !== generation) return;
      active = null;
      const text = r.text?.trim();
      if (!text) { label('未识别到语音'); if (enabled) void start(); return; }
      render({ id: a.id, role: 'user', text, final: true }); label('Yan 正在回复'); center(true);
      waiting = true;
      let reply;
      try { reply = await window.voiceCall.utterance(text, window.YanCallSharing === true); }
      finally { waiting = false; if (a.token !== generation && enabled) void start(); }
      if (a.token !== generation) return;
      if (!reply.ok) throw Error(reply.error || '任务执行失败');
      render({ id: reply.id, role: 'assistant', text: reply.text, html: reply.html, final: true });
      label('Yan 正在说话');
      await speak(reply.text, a.token);
      if (a.token === generation) { center(false); if (enabled) void start(); else label('你已关闭麦克风'); }
    } catch (error) { fail(error, a.token); }
  }
  for (const button of buttons) button.addEventListener('click', () => {
    enabled = !enabled; welcomed = true;
    if (!responding) { generation++; stopCapture(); stopPlayback(); }
    sync(); label(enabled ? '正在听…' : '你已关闭麦克风');
    if (enabled && !responding) void start();
  });
  interrupt.addEventListener('click', async () => {
    generation++; welcomed = true; stopCapture(); stopPlayback(); center(false);
    label(enabled ? '正在听…' : '你已关闭麦克风');
    try { const result = await window.voiceCall.action('interrupt'); if (!result?.ok) throw Error('无法中断任务'); }
    catch (error) { fail(error, generation); return; }
    if (enabled && !waiting) void start();
  });
  window.addEventListener('beforeunload', () => { enabled = false; generation++; stopCapture(); stopPlayback(); });
  sync();
  (async () => {
    try {
      await rpc('initialize');
      document.body.classList.remove('call-starting');
      await window.voiceCall.action('expand');
      await window.voiceCall.action('connected');
      void start();
    } catch (error) {
      const startupText = document.getElementById('callStartupText');
      startupText.title = error.message || '启动失败';
      startupText.textContent = error.message || '语音启动失败，请重新拨打';
    }
  })();
})();
