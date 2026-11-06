/* General settings use the same compact pickers as Appearance. */
function syncGeneralPreferences() {
  const cfg = state.config || {};
  const settings = cfg.general || {};
  if (settings.confettiEnabled === false) window.YanConfetti?.stop();
  if (settings.showQuickReview !== true) {
    document.querySelectorAll('#messages .run-change-summary').forEach(panel => panel.remove());
  }
  const blankPath = settingsOverlay.querySelector('#generalBlankWorkspacePath');
  if (blankPath) { blankPath.textContent = settings.blankWorkspace || '未设置'; blankPath.title = settings.blankWorkspace || ''; }
  syncContextPanelPreference();
  settingsOverlay.querySelectorAll('[data-follow-up-mode]').forEach(button => {
    const active = (settings.followUpMode || 'queue') === button.dataset.followUpMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  settingsOverlay.querySelectorAll('[data-general-setting]').forEach(control => {
    const value = settings[control.dataset.generalSetting];
    if (control.type === 'checkbox') control.checked = !!value;
    else if (value != null) {
      control.value = value;
    }
  });
  settingsOverlay.querySelectorAll('[data-agent-setting]').forEach(control => {
    const value = cfg.agent?.[control.dataset.agentSetting];
    if (control.type === 'number') control.value = value != null ? value : control.getAttribute('value') || '';
    else control.value = value || control.options[0].value;
  });
  settingsOverlay.querySelectorAll('[data-experiment-setting]').forEach(control => {
    control.checked = cfg.experiments?.[control.dataset.experimentSetting] === true;
  });
  window.YanAppearanceControls?.sync();
  window.YanPromptSuggestions?.onSettingChanged?.();
}

let generalPreferenceSave = Promise.resolve();
let generalFileLinksBound = false;
let localSettingsBusy = false;
let localSettingsPoll;
function renderLocalHistorySettings(result) {
  settingsOverlay.querySelectorAll('[data-local-setting]').forEach(control => {
    const checked = result[control.dataset.localSetting] === true;
    if (control.checked !== checked) control.checked = checked;
    // Keep an in-flight control disabled, but never toggle the other switch's
    // disabled state: changing one preference must not make its sibling flash.
    if (!control.dataset.localSettingBusy) control.disabled = !result.supported;
  });
  const startupApps = settingsOverlay.querySelector('#generalStartupApps');
  if (startupApps) startupApps.disabled = !result.supported;
  if (state.config) state.config.general = { ...state.config.general, compressLocalHistory: result.compressLocalHistory };
}
async function refreshLocalHistorySettings() {
  if (localSettingsBusy) return;
  try {
    const result = await api.getLocalHistorySettings();
    if (!localSettingsBusy) renderLocalHistorySettings(result);
  } catch (error) {
  }
}
function bindGeneralPreferences() {
  settingsOverlay.querySelectorAll('[data-local-setting]').forEach(control => {
    if (control.dataset.bound) return;
    control.dataset.bound = 'true';
    control.addEventListener('change', async () => {
      const enabled = control.checked;
      localSettingsBusy = true;
      control.dataset.localSettingBusy = 'true';
      control.disabled = true;
      try { await api.setLocalHistorySetting(control.dataset.localSetting, enabled); }
      catch (error) { toast(`设置失败：${error.message}`); }
      finally {
        localSettingsBusy = false;
        delete control.dataset.localSettingBusy;
        control.disabled = false;
        await refreshLocalHistorySettings();
      }
    });
  });
  const startupApps = settingsOverlay.querySelector('#generalStartupApps');
  if (startupApps && !startupApps.dataset.bound) {
    startupApps.dataset.bound = 'true';
    startupApps.addEventListener('click', () => { void api.openStartupApps().catch(error => toast(`打开启动应用失败：${error.message}`)); });
  }
  void refreshLocalHistorySettings();
  if (!localSettingsPoll) localSettingsPoll = setInterval(() => {
    if (settingsOverlay.isConnected && settingsOverlay.querySelector('#tab-general')?.classList.contains('active')) void refreshLocalHistorySettings();
  }, 2000);
  if (!generalFileLinksBound) {
    generalFileLinksBound = true;
    document.addEventListener('click', event => {
      const link = event.target.closest('.msg-body a[href], .agent-markdown a[href]');
      const target = link?.getAttribute('href') || '';
      // Agent-output screenshots are images, not files: open the image overlay
      // here, before the generic local-file branch can route them to Files.
      const imagePath = /\.(?:png|jpe?g|webp|gif)$/i.test(target)
        ? (localImagePathFromUrl(target) || (/^(?:[a-z]:[\\/]|\/)/i.test(target) ? target : ''))
        : '';
      if (imagePath && typeof openAttachmentPreview === 'function') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const scope = link.closest('.msg-body, .agent-markdown, .skill-document-markdown') || link.parentElement;
        const gallery = [...(scope?.querySelectorAll('a[href]') || [])].map(item => {
          const href = item.getAttribute('href') || '';
          if (!/\.(?:png|jpe?g|webp|gif)$/i.test(href)) return null;
          const path = localImagePathFromUrl(href) || (/^(?:[a-z]:[\\/]|\/)/i.test(href) ? href : '');
          return path ? { path, name: '' } : null;
        }).filter(Boolean);
        openAttachmentPreview({ path: imagePath, name: '' }, { gallery });
        return;
      }
      
      if (!/^(?:file:|[a-z]:[\\/]|\/)/i.test(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Keep browser-viewable deliverables in Yan's browser, independent of OS defaults.
      const url = normalizeAgentUrl(target);
      if (url && /\.(?:html?|svg|pdf)$/i.test(new URL(url).pathname)) {
        openBrowserUrlInNewTab(url);
        return;
      }
      void window.YanProjectFiles.openLocal(target).catch(error => toast(error.message, { error: true }));
    }, true);
  }

  const blankChange = settingsOverlay.querySelector('#generalBlankWorkspaceChange');
  if (blankChange && !blankChange.dataset.bound) {
    blankChange.dataset.bound = 'true';
    blankChange.addEventListener('click', async () => {
      try {
        const selected = await api.pickWorkspace?.(state.config?.general?.blankWorkspace || '');
        if (!selected) return;
        state.config = await api.setConfig({ general: { blankWorkspace: selected } });
      syncGeneralPreferences();
      } catch (error) { toast(`更改文件夹失败：${error.message}`); }
    });
  }
  settingsOverlay.querySelectorAll('[data-follow-up-mode]').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      try {
        state.config = await api.setConfig({ general: { followUpMode: button.dataset.followUpMode } });
      updateSendState();
      syncGeneralPreferences();
      } catch (error) { toast(`设置保存失败：${error.message}`); }
    });
  });

  settingsOverlay.querySelectorAll('[data-general-setting], [data-agent-setting], [data-experiment-setting]').forEach(control => {
    if (control.dataset.bound) return;
    control.dataset.bound = 'true';
    control.addEventListener('change', () => {
      const value = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
      control.disabled = true;
      window.YanAppearanceControls?.sync();
      generalPreferenceSave = generalPreferenceSave.then(async () => {
        try {
          if (control.dataset.experimentSetting) {
            state.config = await api.setConfig({ experiments: { [control.dataset.experimentSetting]: value } });
          } else if (control.dataset.agentSetting === 'accessMode') {
            await selectAccessMode(value, { closeMenu: false });
          } else if (control.dataset.agentSetting) {
            state.config = await api.setConfig({ agent: { [control.dataset.agentSetting]: value } });

          } else {
            const key = control.dataset.generalSetting;
            state.config = await api.setConfig({ general: { [key]: value } });
          }
        } catch (error) {
          toast(`设置保存失败：${error?.message || error}`);
        } finally {
          control.disabled = false;
          syncGeneralPreferences();
        }
      });
    });
  });
  syncGeneralPreferences();
  void refreshVsCodeAvailability();
  const preview = settingsOverlay.querySelector('#generalSoundPreview');
  if (preview && !preview.dataset.bound) {
    preview.dataset.bound = 'true';
    preview.addEventListener('click', () => playGeneralBell(state.config?.general?.notificationSound, true));
  }
  const customButton = settingsOverlay.querySelector('#generalSoundCustom');
  const customInput = settingsOverlay.querySelector('#generalSoundCustomInput');
  if (customButton && customInput && !customButton.dataset.bound) {
    customButton.dataset.bound = 'true';
    customButton.addEventListener('click', () => customInput.click());
    customInput.addEventListener('change', async () => {
      try {
        const uploaded = await window.YanNotifySounds.setCustom(customInput.files?.[0]);
        state.config = await api.setConfig({ general: { notificationSound: 'custom', notificationCustomSound: uploaded.customSound, notificationCustomSoundName: uploaded.customSoundName } });
        syncGeneralPreferences();
        playGeneralBell('custom', true);
      } catch (error) { toast(`自定义提示音失败：${error.message}`, { error: true }); }
      finally { customInput.value = ''; }
    });
  }
}

function canNotifyGeneral(kind) {
  if (!window.Notification || Notification.permission !== 'granted') return false;
  const settings = state.config?.general || {};
  if (kind === 'completion') {
    if (settings.completionNotification === 'never') return false;
    if (settings.completionNotification === 'unfocused' && document.hasFocus() && !document.hidden) return false;
  }
  if (kind === 'permission' && settings.permissionNotification === false) return false;
  if (kind === 'question' && settings.questionNotification === false) return false;
  return true;
}

function generalNotificationOptions() {
  const sound = state.config?.general?.notificationSound || 'bell';
  playGeneralBell(sound);
  return { silent: sound === 'none' };
}

function playGeneralBell(sound, preview = false) {
  try {
    window.YanNotifySounds?.play(sound, state.config?.general?.notificationVolume, state.config?.general?.notificationCustomSound);
  } catch (error) { if (preview) toast(`无法播放通知声音：${error.message}`, { error: true }); }
}
