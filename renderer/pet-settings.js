/* Domml settings share the desktop pets' original artwork and Orb renderer. */
let DOMML_PETS = [
  { id: 'orb', name: 'Yan Agent Orb', description: '随任务状态变化的粒子伙伴。' },
  { id: 'deepseek', name: '大烧货', description: '为桌面添一点活力。' },
  { id: 'claude', name: 'claude', description: '在桌面上与你作伴。' }
];
let petCatalogFingerprint = '';
let petSizeSave = Promise.resolve();
let petSizeTimer;
function refreshPetCatalog() {
  return api.listPets().then(pets => {
    if (!Array.isArray(pets) || !pets.length) return;
    const fingerprint = JSON.stringify(pets.map(({ id, version }) => [id, version]));
    if (fingerprint === petCatalogFingerprint) return;
    petCatalogFingerprint = fingerprint;
    DOMML_PETS = pets;
    const grid = settingsOverlay.querySelector('#petSettingsGrid');
    grid.querySelectorAll('canvas').forEach(canvas => {
      petPreviewObserver.unobserve(canvas); petPreviewOrbs.get(canvas)?.destroy(); petPreviewOrbs.delete(canvas);
    });
    grid.replaceChildren();
    settingsOverlay.querySelector('#petSettingsPreview').dataset.pet = '';
    syncPetSettings();
  }).catch(error => console.warn('[pets] catalog refresh failed:', error));
}

async function openDommlCreator() {
  closeSettings();
  await newSession({ standalone: true, forceNew: true });
  clearComposerPayload();
  const creator = installedSkillPickerItems().find(skill => skill.id === 'domml-creator') || { id: 'domml-creator', name: 'Domml-Creator' };
  setComposerSkills([creator]);
  input.value = '帮我做一个宠物';
  autoGrow(); updateSendState();
  input.focus({ preventScroll: true });
  setComposerCaretByTextOffset(input.value.length);
  captureComposerDraftForSession();
}

function savePetSize(value) {
  const scale = Math.max(0.5, Math.min(1.5, Number(value) || 1));
  const notice = settingsOverlay.querySelector('#petSizeNotice');
  petSizeSave = petSizeSave.then(async () => {
    try {
      state.config = await api.setConfig({ pet: { scale } });
      notice.hidden = true;
      syncPetSettings();
    } catch (error) {
      notice.textContent = `${window.YanI18n?.translate('宠物大小保存失败') || '宠物大小保存失败'}：${error.message}`; notice.hidden = false;
      settingsOverlay.querySelector('#petSize').value = String(state.config?.pet?.scale || 1);
      syncPetSizeSlider(settingsOverlay.querySelector('#petSize'));
    }
  });
  return petSizeSave;
}
let petSettingsBusy = false;
const petPreviewOrbs = new Map();
const petPreviewObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const canvas = entry.target;
    if (entry.isIntersecting && !petPreviewOrbs.has(canvas)) {
      petPreviewOrbs.set(canvas, new window.yanParticlesOrb.ParticlesOrb(canvas, {
        size: Number(canvas.dataset.orbSize), speed: 2
      }));
    } else if (!entry.isIntersecting && petPreviewOrbs.has(canvas)) {
      petPreviewOrbs.get(canvas).destroy();
      petPreviewOrbs.delete(canvas);
    }
  }
});

function createPetPreview(id, large = false) {
  const art = document.createElement('span');
  art.className = `pet-settings-art${large ? ' is-large' : ''}`;
  art.setAttribute('aria-hidden', 'true');
  if (id === 'orb') {
    const canvas = document.createElement('canvas');
    canvas.dataset.orbSize = large ? '264' : '112';
    art.append(canvas);
    petPreviewObserver.observe(canvas);
  } else {
    const sprite = document.createElement('span');
    sprite.className = 'pet-settings-sprite';
    sprite.dataset.pet = id;
    const pet = DOMML_PETS.find(item => item.id === id);
    if (pet?.spriteDataUrl) sprite.style.backgroundImage = `url("${pet.spriteDataUrl}")`;
    if (['widget', 'web'].includes(pet?.layout)) {
      sprite.classList.add('is-static');
      sprite.textContent = pet.dataSource?.label || pet.name;
      sprite.style.cssText = 'display:grid;place-items:center;background:none;font-size:14px;padding:16px;box-sizing:border-box;text-align:center;overflow-wrap:anywhere';
    }
    sprite.classList.toggle('is-static', ['static', 'widget', 'web'].includes(pet?.layout));
    art.append(sprite);
  }
  return art;
}

function syncPetSettingsVisibility(visible) {
  const button = settingsOverlay.querySelector('#petVisibilityToggle');
  if (!button) return;
  button.textContent = window.YanI18n?.translate(visible ? '隐藏Domml' : '显示Domml') || (visible ? '隐藏Domml' : '显示Domml');
  button.setAttribute('aria-pressed', String(visible));
}

function syncPetSettings(value = state.config?.pet?.selected) {
  const selected = normalizePetPickerId(value);
  const preview = settingsOverlay.querySelector('#petSettingsPreview');
  const grid = settingsOverlay.querySelector('#petSettingsGrid');
  if (!preview || !grid) return;
  if (!grid.childElementCount) {
    for (const pet of DOMML_PETS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pet-settings-card';
      card.dataset.petSelect = pet.id;
      const name = document.createElement('strong');
      name.textContent = pet.name;
      const description = document.createElement('span');
      description.className = 'pet-settings-description';
      description.textContent = pet.description;
      card.append(createPetPreview(pet.id), name, description);
      const item = document.createElement('div');
      item.className = 'pet-settings-item';
      item.append(card);
      if (pet.id.startsWith('custom-')) {
        item.classList.add('is-custom');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pet-delete-button';
        remove.dataset.petDelete = pet.id;
        const label = window.YanI18n?.translate('删除宠物') || '删除宠物';
        remove.title = `${label} · ${pet.name}`;
        remove.setAttribute('aria-label', `${label} · ${pet.name}`);
        remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
        item.append(remove);
      }
      grid.append(item);
    }
  }
  grid.querySelectorAll('[data-pet-select]').forEach(card => {
    card.setAttribute('aria-pressed', String(card.dataset.petSelect === selected));
    card.disabled = petSettingsBusy;
  });
  grid.querySelectorAll('[data-pet-delete]').forEach(button => { button.disabled = petSettingsBusy; });
  if (preview.dataset.pet !== selected) {
    preview.querySelectorAll('canvas').forEach(canvas => {
      petPreviewObserver.unobserve(canvas);
      petPreviewOrbs.get(canvas)?.destroy();
      petPreviewOrbs.delete(canvas);
    });
    preview.dataset.pet = selected;
    preview.replaceChildren(createPetPreview(selected, true));
    preview.setAttribute('aria-label', DOMML_PETS.find(pet => pet.id === selected)?.name || selected);
  }
  syncPetSettingsVisibility(!!state.config?.pet?.enabled);
  preview.style.setProperty('--pet-preview-scale', String(state.config?.pet?.scale || 1));
}

function syncPetSizeSlider(slider) {
  slider.style.setProperty('--pet-size-progress', `${(Number(slider.value) - 0.5) * 100}%`);
}

function bindPetSettings() {
  const page = settingsOverlay.querySelector('#tab-pet');
  if (!page || page.dataset.bound) return;
  page.dataset.bound = 'true';
  const dialog = page.querySelector('#petCustomizeDialog');
  const slider = page.querySelector('#petSize');
  const deleteDialog = page.querySelector('#petDeleteDialog');
  let pendingDeleteId = null;
  deleteDialog.addEventListener('close', () => { pendingDeleteId = null; });
  page.querySelector('#petDeleteCancel').addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('click', event => {
    if (event.target !== deleteDialog) return;
    const rect = deleteDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) deleteDialog.close();
  });
  page.querySelector('#petDeleteConfirm').addEventListener('click', async () => {
    const id = pendingDeleteId;
    if (!id || petSettingsBusy) return;
    petSettingsBusy = true;
    deleteDialog.close();
    toggle.disabled = true;
    notice.hidden = true;
    syncPetSettings();
    try {
      await petSizeSave;
      state.config.pet = await api.deletePet(id);
      await refreshPetCatalog();
      page.querySelector('#petCreate').focus({ preventScroll: true });
    } catch (error) {
      notice.textContent = `${window.YanI18n?.translate('删除宠物失败') || '删除宠物失败'}：${error.message}`;
      notice.hidden = false;
    } finally {
      petSettingsBusy = false;
      toggle.disabled = false;
      syncPetSettings();
    }
  });
  page.querySelector('#petCustomize').addEventListener('click', () => {
    slider.value = String(state.config?.pet?.scale || 1);
    syncPetSizeSlider(slider);
    dialog.showModal();
  });
  page.querySelector('#petCustomizeClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  slider.addEventListener('input', () => {
    syncPetSizeSlider(slider);
    clearTimeout(petSizeTimer);
    petSizeTimer = setTimeout(() => void savePetSize(slider.value), 60);
  });
  slider.addEventListener('change', () => { clearTimeout(petSizeTimer); void savePetSize(slider.value); });
  page.querySelector('#petSizeReset').addEventListener('click', () => {
    clearTimeout(petSizeTimer); slider.value = '1'; syncPetSizeSlider(slider); void savePetSize(1);
  });
  page.querySelector('#petCreate').addEventListener('click', () => void openDommlCreator().catch(error => toast(error.message)));
  api.onPetsChanged(() => void refreshPetCatalog());
  void refreshPetCatalog();
  const toggle = page.querySelector('#petVisibilityToggle');
  const notice = page.querySelector('#petSettingsNotice');
  page.addEventListener('click', async event => {
    const remove = event.target.closest('[data-pet-delete]');
    if (remove && !petSettingsBusy) {
      const pet = DOMML_PETS.find(item => item.id === remove.dataset.petDelete);
      if (!pet) return;
      pendingDeleteId = pet.id;
      page.querySelector('#petDeleteDesc').textContent = pet.name;
      deleteDialog.showModal();
      page.querySelector('#petDeleteCancel').focus();
      return;
    }
    const card = event.target.closest('[data-pet-select]');
    if ((!card && !event.target.closest('#petVisibilityToggle')) || petSettingsBusy) return;
    petSettingsBusy = true;
    toggle.disabled = true;
    page.setAttribute('aria-busy', 'true');
    notice.hidden = true;
    syncPetSettings();
    try {
      if (card) {
        state.config = await api.setConfig({ pet: { selected: card.dataset.petSelect } });
      } else {
        const visible = await api.togglePetWindow();
        if (state.config?.pet) state.config.pet.enabled = visible;
      }
    } catch (error) {
      notice.textContent = `${window.YanI18n?.translate('宠物设置保存失败') || '宠物设置保存失败'}：${error?.message || error}`;
      notice.hidden = false;
    } finally {
      petSettingsBusy = false;
      toggle.disabled = false;
      page.setAttribute('aria-busy', 'false');
      syncPetSettings();
    }
  });
  syncPetSettings();
}
