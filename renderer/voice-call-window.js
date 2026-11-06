(() => {
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
  const panel = document.querySelector('#voiceCallPanel'), mini = document.querySelector('#voiceCallMini');
  const avatar = window.YanCallAvatar.create(document.querySelector('#callAvatar'));
  const miniAvatar = window.YanCallAvatar.create(document.querySelector('#callMiniAvatar'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = 'minimized', raf = 0, elapsed = 1, last = 0;
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function tick(now) {
    if (mode !== 'expanded' || document.hidden || reduced.matches) return;
    if (last) elapsed += Math.min((now - last) / 1000, .1);
    last = now; avatar.draw(elapsed); raf = requestAnimationFrame(tick);
  }
  function animate() { stop(); avatar.draw(elapsed); if (mode === 'expanded' && !document.hidden && !reduced.matches) raf = requestAnimationFrame(tick); }
  window.voiceCall.onMode(next => {
    if (next !== 'expanded' && next !== 'minimized') return;
    if (next === 'minimized') { stop(); miniAvatar.draw(elapsed); }
    mode = next; panel.hidden = mode !== 'expanded'; mini.hidden = mode !== 'minimized';
    document.body.dataset.mode = mode;
    animate(); document.getElementById(mode === 'expanded' ? 'callMinimize' : 'callExpand').focus();
  });
  for (const [id, action] of [['callMinimize','minimize'], ['callExpand','expand'], ['callHangup','hangup'], ['miniCallHangup','hangup']]) {
    document.getElementById(id).addEventListener('click', () => window.voiceCall.action(action));
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && mode === 'expanded') window.voiceCall.action('minimize'); });
  document.addEventListener('visibilitychange', animate); reduced.addEventListener('change', animate);
  window.addEventListener('beforeunload', stop);
  const transcript = document.getElementById('callTranscript');
  const messages = document.getElementById('callTranscriptMessages');
  const entries = new Map();
  // Capture happens only when a new utterance is submitted.
  // Keep it for this call across captions/minimize changes; a new call starts off.
  let sharing = false;
  function toggleSharing() {
    sharing = !sharing; window.YanCallSharing = sharing;
    for (const id of ['callShare', 'miniCallShare']) {
      const button = document.getElementById(id);
      button.setAttribute('aria-pressed', String(sharing));
      button.setAttribute('aria-label', sharing ? '停止共享屏幕' : '共享屏幕');
      button.title = sharing ? '停止共享屏幕' : '共享屏幕';
    }
  }
  for (const id of ['callShare', 'miniCallShare']) document.getElementById(id).addEventListener('click', toggleSharing);

  const track = document.getElementById('callScrollTrack'), thumb = document.getElementById('callScrollThumb');
  function updateScrollThumb() {
    const height = track.clientHeight, total = transcript.scrollHeight, visible = transcript.clientHeight;
    const size = Math.min(height, Math.max(20, height * visible / Math.max(total, 1)));
    thumb.style.height = size + 'px';
    thumb.style.transform = 'translateY(' + ((height - size) * transcript.scrollTop / Math.max(1, total - visible)) + 'px)';
  }
  transcript.addEventListener('scroll', updateScrollThumb, { passive: true });
  new ResizeObserver(updateScrollThumb).observe(transcript);
  let scrollTimer, hovering = false;
  transcript.addEventListener('mouseenter', () => { hovering = true; });
  transcript.addEventListener('mouseleave', () => { hovering = false; clearTimeout(scrollTimer); transcript.classList.remove('scrollbar-visible'); });
  transcript.addEventListener('wheel', () => {
    if (!hovering || transcript.scrollHeight <= transcript.clientHeight) return;
    updateScrollThumb(); transcript.classList.add('scrollbar-visible');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => transcript.classList.remove('scrollbar-visible'), 1000);
  }, { passive: true });
  messages.addEventListener('click', async event => {
    const button = event.target.closest('.md-code-copy');
    if (button) {
      try { await navigator.clipboard.writeText(button.closest('.md-code-block').querySelector('code').textContent); button.title = '代码已复制'; }
      catch { button.title = '代码复制失败'; }
    }
    if (event.target.closest('a')) event.preventDefault();
  });
  let captions = false;
  function toggleCaptions() {
    captions = !captions;
    panel.classList.toggle('captions-visible', captions);
    transcript.inert = !captions;
    for (const id of ['callCaptions', 'miniCallCaptions']) {
      const button = document.getElementById(id);
      button.setAttribute('aria-pressed', String(captions));
      button.setAttribute('aria-label', captions ? '隐藏字幕' : '显示字幕');
      button.title = captions ? '隐藏字幕' : '显示字幕';
    }
    window.voiceCall.action(captions ? 'captions-on' : 'captions-off');
  }
  for (const id of ['callCaptions', 'miniCallCaptions']) document.getElementById(id).addEventListener('click', toggleCaptions);
  // Full text snapshots can revise an ASR partial; stable IDs prevent duplicate bubbles.
  // Media and model producers will feed this event when the call pipeline is enabled.
  function renderTranscript(value) {
    if (!value || !['user', 'assistant'].includes(value.role) || typeof value.id !== 'string' || typeof value.text !== 'string') return;
    const follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
    const key = value.role + ':' + value.id;
    let entry = entries.get(key);
    if (!entry) {
      const node = value.role === 'user' ? document.createElement('div') : document.getElementById('callReplyTemplate').content.firstElementChild.cloneNode(true);
      if (value.role === 'user') { node.className = 'call-user'; node.setAttribute('role', 'textbox'); node.setAttribute('aria-readonly', 'true'); node.setAttribute('aria-label', '用户语音转写'); }
      entry = { node, text: '', time: new Date() };
      const copy = node.querySelector('.call-copy');
      if (copy) copy.addEventListener('click', async () => {
        const result = node.querySelector('.call-copy-result');
        try { await navigator.clipboard.writeText(entry.text); result.textContent = '已复制'; }
        catch { result.textContent = '复制失败'; }
      });
      for (const previous of entries.values()) { const footer = previous.node.querySelector('footer'); if (footer) footer.hidden = true; }
      entries.set(key, entry); messages.append(node);
    }
    entry.text = value.text;
    entry.node.dataset.streaming = String(value.final !== true);
    if (value.role === 'user') entry.node.textContent = value.text;
    else {
      const body = entry.node.querySelector('.call-reply-text');
      // HTML comes only from the main renderer's existing escaped Markdown renderer.
      if (typeof value.html === 'string') body.innerHTML = value.html;
      else body.textContent = value.text;
      const time = entry.node.querySelector('time');
      time.dateTime = entry.time.toISOString();
      time.textContent = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    document.getElementById('callTranscriptEmpty').hidden = entries.size > 0;
    if (follow) transcript.scrollTop = transcript.scrollHeight;
  }
  window.voiceCall.onTranscript(renderTranscript);
  window.YanCallTranscript = renderTranscript;
  miniAvatar.draw(elapsed);
  animate();
})();
