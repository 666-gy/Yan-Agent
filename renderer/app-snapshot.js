/* A user-selected, single-frame capture joins the ordinary image attachment path. */
(() => {
  const translate = text => window.YanI18n?.translate(text) || text;
  function renderCards() {
    const host = document.querySelector('#composerSnapshots');
    if (!host) return;
    host.replaceChildren();
    state.attachments.forEach((attachment, index) => {
      if (!attachment.snapshot) return;
      const card = document.createElement('article'); card.className = 'composer-snapshot';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'composer-snapshot-open';
      open.setAttribute('aria-label', `${translate('预览应用快照')}：${attachment.snapshot.name}`);
      const stage = document.createElement('span'); stage.className = 'composer-snapshot-stage';
      const image = document.createElement('img'); image.alt = ''; image.className = 'composer-snapshot-image';
      const safeImage = value => /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(value || ''));
      if (safeImage(attachment.snapshot.preview)) image.src = attachment.snapshot.preview;
      image.addEventListener('error', () => { image.hidden = true; stage.textContent = translate('点击预览'); });
      stage.append(image);
      const identity = document.createElement('span'); identity.className = 'composer-snapshot-identity';
      const icon = document.createElement('img'); icon.className = 'composer-snapshot-icon'; icon.alt = '';
      icon.src = safeImage(attachment.snapshot.icon) ? attachment.snapshot.icon : 'assets/app-window.svg';
      icon.addEventListener('error', () => { icon.src = 'assets/app-window.svg'; }, { once: true });
      const name = document.createElement('span'); name.className = 'composer-snapshot-title';
      name.textContent = attachment.snapshot.name; name.title = attachment.snapshot.name;
      identity.append(icon, name); open.append(stage, identity);
      open.addEventListener('click', () => openAttachmentPreview(attachment));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'composer-snapshot-remove';
      remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>'; remove.setAttribute('aria-label', translate('移除应用快照'));
      remove.addEventListener('click', () => { state.attachments.splice(index, 1); renderAttachments(); updateSendState(); });
      card.append(open, remove); host.append(card);
    });
    host.classList.toggle('hidden', !host.children.length);
    scheduleComposerGrow();
  }
  let snapshotSettings = { shortcut: 'Alt+Alt', destination: 'auto', sound: true, soundId: 'ding', soundVolume: 60, customSound: '', customSoundName: '' };
  let settingsRevision = 0;
  let settingsBound = false;
  function paintSettings() {
    settingsOverlay.querySelectorAll('[data-snapshot-setting]').forEach(control => {
      const value = snapshotSettings[control.dataset.snapshotSetting];
      if (control.type === 'checkbox') control.checked = !!value;
      else control.value = value;
    });
    window.YanAppearanceControls?.sync();
  }
  async function syncSettings() {
    const revision = ++settingsRevision;
    if (!settingsBound) {
      settingsBound = true;
      settingsOverlay.querySelectorAll('[data-snapshot-setting]').forEach(control => {
        control.addEventListener('change', async () => {
          ++settingsRevision;
          const controls = [...settingsOverlay.querySelectorAll('[data-snapshot-setting]')];
          controls.forEach(item => { item.disabled = true; }); window.YanAppearanceControls?.sync();
          try {
            const result = await api.updateAppSnapshotSettings({ [control.dataset.snapshotSetting]: control.type === 'checkbox' ? control.checked : control.value });
            if (result.settings) { snapshotSettings = result.settings; state.config.appSnapshot = { ...result.settings }; }
            if (result.error) toast(result.error, { error: true });
          } catch (error) { toast(error.message, { error: true }); }
          finally { controls.forEach(item => { item.disabled = false; }); paintSettings(); }
        });
      });
    }
    try {
      const result = await api.getAppSnapshotSettings();
      if (revision !== settingsRevision) return;
      if (result.settings) snapshotSettings = result.settings;
      paintSettings();
      if (result.error) toast(result.error, { error: true });
    } catch (error) { toast(error.message, { error: true }); }
  }
  function playSnapshotSound(enabled, settings = snapshotSettings) {
    if (!enabled) return;
    window.YanNotifySounds?.play(settings.soundId || 'ding', settings.soundVolume, settings.customSound);
  }
  async function attachSnapshot(result, shouldAccept) {
    if (result.error) throw new Error(result.error);
    const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
    const count = state.attachments.length;
    await addAttachment(new File([bytes], result.name, { type: 'image/png' }), {
      imageOnly: true, shouldAccept, snapshot: result.snapshot
    });
    const added = state.attachments.length > count;
    if (added) playSnapshotSound(result.settings?.sound ?? snapshotSettings.sound, result.settings || snapshotSettings);
    return added;
  }
  let received = Promise.resolve();
  api.onAppSnapshot(result => {
    received = received.then(async () => {
      if (result.error) throw new Error(result.error);
      closeSettings(); switchSidebarNav('tasks');
      const destination = result.settings?.destination || 'auto';
      if (destination === 'new' || !state.currentSession) await newSession({ standalone: true, forceNew: true });
      const id = state.currentSession?.id;
      await attachSnapshot(result, () => state.currentSession?.id === id);
      input.focus({ preventScroll: true });
    }).catch(error => toast(error.message));
  });
  window.YanAppSnapshot = { renderCards, syncSettings };
  void api.getAppSnapshotSettings().then(result => { if (result.settings) snapshotSettings = result.settings; }).catch(() => {});
  renderCards();
  const action = document.querySelector('#appSnapshotAction');
  const label = action.querySelector('.composer-add-action-name');
  const originalIcon = action.querySelector('svg');
  const appIcon = document.createElement('img'); appIcon.className = 'snapshot-action-icon'; appIcon.alt = ''; appIcon.hidden = true; action.prepend(appIcon);
  let target = { available: false }, capturing = false, request = 0;
  function paintTarget(next) {
    target = next || { available: false };
    action.disabled = capturing || !target.available;
    action.classList.toggle('snapshot-unavailable', !target.available);
    label.textContent = target.available ? (state.config?.language === 'en' ? 'Attach ' : '附加') + target.name : translate('应用快照');
    action.title = target.available ? label.textContent : translate('没有可附加的应用窗口');
    appIcon.hidden = !target.available; originalIcon.hidden = target.available;
    originalIcon.style.display = target.available ? 'none' : '';
    appIcon.src = /^data:image\//.test(target.icon || '') ? target.icon : 'assets/app-window.svg';
  }
  async function refreshTarget() {
    const version = ++request;
    try { const next = await api.getAppSnapshotTarget(); if (version === request) paintTarget(next); }
    catch { if (version === request) paintTarget({ available: false }); }
  }
  api.onAppSnapshotTarget(next => { ++request; paintTarget(next); });
  document.querySelector('#attachBtn').addEventListener('click', () => { void refreshTarget(); });
  action.addEventListener('click', async () => {
    if (capturing || !target.available) return;
    capturing = true; action.disabled = true; action.setAttribute('aria-busy', 'true');
    const handle = target.handle, sessionId = state.currentSession?.id;
    setAttachmentMenuOpen(false);
    try {
      const result = await api.captureAppSnapshot(handle);
      if (state.currentSession?.id !== sessionId) return;
      await attachSnapshot(result, () => state.currentSession?.id === sessionId);
      input.focus({ preventScroll: true });
    } catch (error) { toast(translate(error.message)); }
    finally { capturing = false; action.setAttribute('aria-busy', 'false'); void refreshTarget(); }
  });
  paintTarget(target); void refreshTarget();
})();
