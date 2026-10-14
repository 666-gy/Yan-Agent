'use strict';

// ---------------------------------------------------------------------------
// Connection form dialog: a sidebar of official presets plus one unified
// panel. Replaces the old one-field-per-page wizard so a wrong value no longer
// forces the user to walk back through ten pages.
//
// Loaded after renderer.js on purpose: it reuses the renderer globals
// ($, api, state, toast, escapeHtml, escapeAttr, renderConnectionList, ...) and
// the connection state declared there (activeConnectionId, connectionEditing,
// connectionSaveComplete, providerConfirmResolver, connectionCache).
// ---------------------------------------------------------------------------

const MASKED_API_KEY = '••••••';
const CONNECTION_ENDPOINT_TABS = Object.freeze(['base', 'image', 'video']);
const CONNECTION_ENDPOINT_PLACEHOLDERS = Object.freeze({
  base: 'https://api.example.com/v1',
  image: 'https://api.example.com/v1/images/generations',
  video: 'https://api.example.com/v1/videos/generations'
});
const CONNECTION_ENDPOINT_OPTIONS = Object.freeze([
  ['base', 'Base URL'],
  ['image', '图像'],
  ['video', '视频']
]);
const CONNECTION_FORMAT_OPTIONS = Object.freeze([
  ['auto', '自动识别'],
  ['openai', 'Chat Completions'],
  ['anthropic', 'Anthropic Messages'],
  ['responses', 'Responses']
]);
const CONNECTION_PRESET_ORDER = Object.freeze([
  'auto', 'openai', 'gptl', 'deepseek', 'anthropic', 'gemini', 'kimi', 'glm',
  'qwen', 'doubao', 'agnes', 'stepfun', 'hunyuan', 'minimax', 'siliconflow',
  'grok', 'mimo', 'opencode', 'opencode-go', 'opencode-zen', 'sensenova', 'jiyuan'
]);
// Official tabs. Each one defaults the compatibility preset to the adapter we
// prepared for that vendor (Anthropic defaults to its own protocol preset). The
// preset stays editable, so the user can still point an official connection at
// another request shape when their relay needs it.
const OFFICIAL_CONNECTION_PRESETS = Object.freeze([
  { preset: 'deepseek', name: 'DeepSeek', logo: 'deepseek.png', baseUrl: 'https://api.deepseek.com' },
  { preset: 'glm', name: 'GLM', logo: 'glm.png', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { preset: 'gptl', name: 'GPT', logo: 'openai.png', baseUrl: 'https://api.openai.com/v1' },
  { preset: 'grok', name: 'Grok', logo: 'grok.png', baseUrl: 'https://api.x.ai/v1' },
  { preset: 'kimi', name: 'Kimi', logo: 'moonshot.png', baseUrl: 'https://api.moonshot.cn/v1' },
  { preset: 'qwen', name: 'Qwen', logo: 'qwen.png', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { preset: 'gemini', name: 'Gemini', logo: 'gemini.svg', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { preset: 'anthropic', name: 'Anthropic', logo: 'claude.svg', baseUrl: 'https://api.anthropic.com' },
  { preset: 'agnes', name: 'Agnes', logo: 'agnes.png', baseUrl: 'https://apihub.agnes-ai.com/v1' }
]);
// lucide circle-plus (https://lucide.dev/icons)
const CONNECTION_PLUS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>';
const CONNECTION_CHEVRON = '<svg class="conn-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const CONNECTION_CHECK = '<svg class="conn-select-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

let connectionDraft = { preset: 'auto', apiFormat: 'auto' };
let connectionDraftApiKey = '';
let connectionDraftModelCount = 0;
let connectionEndpoints = { base: '', image: '', video: '' };
let connectionEndpointTab = 'base';
let connectionNameAuto = true;
let connectionTestInFlight = false;
let connectionModelFlags = {};
// Custom model ids are additive and editable inline; detected models are the
// last fetched/saved catalog. The cache keeps a provider's list after a refresh
// so reopening the editor is not empty until the user refreshes again.
let connectionCustomModels = [];
let connectionDetectedModels = [];
const connectionModelCache = new Map();

const CONNECTION_MODEL_CAP_ORDER = Object.freeze(['multimodal', 'image', 'video']);
const CONNECTION_MODEL_CAP_LABELS = Object.freeze({ multimodal: '多模态', image: '生图', video: '生视频' });
const CONNECTION_MODEL_TYPE_LABELS = Object.freeze({ text: '文本', image: '图像', video: '视频' });

function officialConnectionPreset(preset) {
  return OFFICIAL_CONNECTION_PRESETS.find(item => item.preset === preset) || null;
}

function connectionPresetLabel(preset) {
  if (preset === 'auto') return '自动识别';
  return CONNECTION_PRESET_LABELS[preset] || preset;
}

function setConnectionSaveState(stateName = 'idle') {
  const button = $('#connNext');
  if (!button) return;
  if (stateName === 'saving') {
    button.dataset.busy = 'true';
    button.disabled = true;
    return;
  }
  button.disabled = false;
  button.dataset.busy = 'false';
  connectionSaveComplete = stateName === 'complete';
  button.dataset.state = stateName === 'complete' ? 'complete' : (stateName === 'error' ? 'error' : 'default');
}

function resetConnectionSaveFeedback() {
  setConnectionSaveState('idle');
}

function updateConnectionEyeButton(visible = false) {
  const icon = $('#connToggleKey .provider-eye-icon');
  const button = $('#connToggleKey');
  if (icon) icon.dataset.eye = visible ? 'open' : 'closed';
  if (button) {
    const label = visible ? '隐藏 API Key' : '显示 API Key';
    button.title = label;
    button.setAttribute('aria-label', label);
  }
}

// --- endpoint chain (base-url / image / video share one joined input) --------

function setConnectionEndpointTab(tab) {
  const next = CONNECTION_ENDPOINT_TABS.includes(tab) ? tab : 'base';
  const input = $('#connEndpointInput');
  if (input) connectionEndpoints[connectionEndpointTab] = input.value;
  connectionEndpointTab = next;
  syncConnectionEndpoint();
}

function syncConnectionEndpoint() {
  const input = $('#connEndpointInput');
  if (input) {
    input.value = connectionEndpoints[connectionEndpointTab] || '';
    input.placeholder = CONNECTION_ENDPOINT_PLACEHOLDERS[connectionEndpointTab] || '';
  }
  renderConnSelect($('#connEndpointSelect'), CONNECTION_ENDPOINT_OPTIONS, connectionEndpointTab);
}

function focusConnectionEndpoint(tab) {
  connectionEndpointTab = CONNECTION_ENDPOINT_TABS.includes(tab) ? tab : 'base';
  syncConnectionEndpoint();
  $('#connEndpointInput')?.focus({ preventScroll: true });
}

// --- sidebar ----------------------------------------------------------------

function renderConnPresetSidebar() {
  const sidebar = $('#connPresetSidebar');
  if (!sidebar) return;
  const officialActive = officialConnectionPreset(connectionDraft.preset);
  const rows = OFFICIAL_CONNECTION_PRESETS.map(item => {
    const active = item.preset === connectionDraft.preset;
    const logo = item.logo
      ? `<span class="connection-preset-logo" style="--provider-logo:url('assets/provider-logos/${item.logo}')" aria-hidden="true"></span>`
      : `<span class="connection-preset-logo is-letter" aria-hidden="true">${escapeHtml(item.name.slice(0, 1))}</span>`;
    return `<button type="button" class="connection-preset-item${active ? ' active' : ''}" data-conn-preset-item="${item.preset}" role="option" aria-selected="${active}">
      ${logo}<span class="connection-preset-name">${escapeHtml(item.name)}</span>
    </button>`;
  }).join('');
  const customActive = !officialActive;
  sidebar.innerHTML = `${rows}
    <button type="button" class="connection-preset-item is-custom${customActive ? ' active' : ''}" data-conn-preset-item="custom" role="option" aria-selected="${customActive}">
      <span class="connection-preset-logo is-plus" aria-hidden="true">${CONNECTION_PLUS_ICON}</span>
      <span class="connection-preset-name">自定义配置</span>
    </button>`;
}

// --- custom dropdowns (our own select, never a native <select>) -------------

// The check leads the row and every row reserves its slot, so switching the
// selection never shifts the labels sideways.
function renderConnSelect(host, options, value) {
  if (!host) return;
  const match = options.find(option => option[0] === value) || options[0] || ['', ''];
  const rows = options.map(([optionValue, label]) => {
    const selected = optionValue === value;
    return `<button type="button" class="conn-select-option" role="option" data-conn-select-value="${escapeAttr(optionValue)}" aria-selected="${selected}">
      ${selected ? CONNECTION_CHECK : '<span class="conn-select-check-slot" aria-hidden="true"></span>'}<span>${escapeHtml(label)}</span>
    </button>`;
  }).join('');
  host.classList.remove('is-locked', 'open');
  host.innerHTML = `
    <button type="button" class="conn-select-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="conn-select-value">${escapeHtml(match[1])}</span>
      ${CONNECTION_CHEVRON}
    </button>
    <div class="conn-select-menu" role="listbox">${rows}</div>`;
}

function renderConnSelects() {
  renderConnSelect($('#connFormatSelect'), CONNECTION_FORMAT_OPTIONS, connectionDraft.apiFormat);
  renderConnSelect($('#connPresetSelect'), CONNECTION_PRESET_ORDER.map(id => [id, connectionPresetLabel(id)]), connectionDraft.preset);
  $('#connPresetHint')?.classList.add('hidden');
}

function closeConnSelects() {
  document.querySelectorAll('#connectionDialog .conn-select.open').forEach(host => {
    host.classList.remove('open');
    host.querySelector('.conn-select-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function applyConnSelect(host, value) {
  if (host.id === 'connEndpointSelect') {
    setConnectionEndpointTab(value);
    if (connectionSaveComplete) resetConnectionSaveFeedback();
    return;
  }
  if (host.id === 'connFormatSelect') connectionDraft.apiFormat = value;
  if (host.id === 'connPresetSelect') connectionDraft.preset = value;
  renderConnSelects();
  if (connectionSaveComplete) resetConnectionSaveFeedback();
}

function selectConnectionPreset(key) {
  if (key === 'custom') {
    // Custom connections speak no vendor-specific shape until the user says so.
    connectionDraft.preset = 'openai';
    connectionEndpoints = { base: '', image: '', video: '' };
    connectionEndpointTab = 'base';
    if (connectionNameAuto) $('#connName').value = '';
  } else {
    const official = officialConnectionPreset(key);
    if (!official) return;
    connectionDraft.preset = official.preset;
    connectionEndpoints.base = official.baseUrl;
    connectionEndpointTab = 'base';
    if (connectionNameAuto) $('#connName').value = official.name;
  }
  renderConnPresetSidebar();
  renderConnSelects();
  syncConnectionEndpoint();
  resetConnectionSaveFeedback();
}

// --- form read / open / test / save ----------------------------------------

function collectConnectionForm() {
  const keyInput = $('#connApiKey');
  const keyValue = keyInput?.value?.trim() || '';
  const imageUrl = String(connectionEndpoints.image || '').trim();
  const customModels = connectionCustomModels
    .map(id => String(id || '').trim())
    .filter((id, index, list) => id && list.indexOf(id) === index);
  return {
    id: activeConnectionId || '',
    name: $('#connName')?.value?.trim() || '',
    baseUrl: String(connectionEndpoints.base || '').trim(),
    apiKey: keyInput?.dataset?.masked === 'true' ? connectionDraftApiKey : (connectionDraftApiKey || keyValue),
    imageGenerationUrl: imageUrl,
    imageEditUrl: imageUrl,
    videoGenerationUrl: String(connectionEndpoints.video || '').trim(),
    preset: connectionDraft.preset || 'auto',
    apiFormat: connectionDraft.apiFormat || 'auto',
    manualModelId: customModels[0] || '',
    customModels,
    modelFlags: collectConnectionModelFlags()
  };
}

function connectionModelFlagEntry(modelId) {
  const key = String(modelId || '');
  if (!key) return {};
  if (!connectionModelFlags[key] || typeof connectionModelFlags[key] !== 'object') connectionModelFlags[key] = {};
  return connectionModelFlags[key];
}

function connectionModelCapState(entry, cap) {
  const value = entry?.[cap];
  return value === true ? 'yes' : value === false ? 'no' : 'unknown';
}

function connectionModelCapLabel(cap, state) {
  const name = CONNECTION_MODEL_CAP_LABELS[cap] || cap;
  if (state === 'yes') return `支持${name}√`;
  if (state === 'no') return `不支持${name}×`;
  return `支持${name}？`;
}

// An explicit user mark wins over the backend classification: marking a model as
// image/video reclassifies it; marking either one unsupported falls back to text.
function connectionModelType(entry, baseType) {
  const fallback = baseType === 'image' || baseType === 'video' ? baseType : 'text';
  if (!entry) return fallback;
  if (entry.video === true) return 'video';
  if (entry.image === true) return 'image';
  if (entry.video === false || entry.image === false) return 'text';
  return fallback;
}

function connectionModelEnabled(entry) {
  return entry?.enabled !== false;
}

// A fresh refresh must not silently enable every model the provider returns:
// models the connection has never seen start disabled, while already-saved
// models and the user's explicit enable/disable toggles keep their state.
function defaultNewModelsDisabled(models) {
  const knownIds = new Set((connectionEditing?.models || []).map(model => String(model?.id || '')).filter(Boolean));
  for (const model of Array.isArray(models) ? models : []) {
    const id = String(model?.id || '');
    if (!id || knownIds.has(id)) continue;
    const entry = connectionModelFlags[id];
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'enabled')) continue;
    connectionModelFlags[id] = { ...(entry || {}), enabled: false };
  }
}

function connectionModelBaseType(model) {
  return model?.modelType === 'image' || model?.modelType === 'video' ? model.modelType : 'text';
}

function connectionKInputValue(tokens) {
  const value = Math.round(Number(tokens)) || 0;
  return value > 0 ? String(value / 1000) : '';
}

function connectionModelBudget(id, entry, type) {
  return type === 'text' ? window.YanModelBudgetProfiles?.automaticModelBudget(id, entry || {}) : null;
}

function connectionBudgetHint(id, key, manual, budget) {
  if (manual) return '手动设置，清空恢复自动';
  if (key === 'maxOutputTokens' && window.YanModelBudgetProfiles?.lookupModelBudget(id)?.outputConstraint === 'context') {
    return '官方无独立输出上限，此值为上下文总上限；实际输出受剩余空间限制';
  }
  if (Number(budget?.[key]) > 0) return '已按模型自动配置，可手动覆盖';
  return budget ? '官方未公布此上限，留空沿用默认值' : '未匹配模型规格，可手动填写';
}

function connectionBudgetField(id, entry, type, key, attribute, label, placeholder) {
  const budget = connectionModelBudget(id, entry, type);
  const manual = Number(entry?.[key]) > 0;
  const automatic = Number(budget?.[key]) > 0;
  const value = connectionKInputValue(manual ? entry[key] : budget?.[key]);
  const title = `${label} (k)；${connectionBudgetHint(id, key, manual, budget)}`;
  return `<label class="conn-model-kfield" title="${escapeAttr(title)}"><input class="conn-model-kinput" ${attribute} data-budget-mode="${manual ? 'manual' : automatic ? 'auto' : 'unknown'}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="${placeholder}" aria-label="${label} k" value="${escapeAttr(value)}" /><span class="conn-model-kunit">k</span></label>`;
}

function syncConnectionBudgetFields(row, editingInput = null) {
  if (!row) return;
  const entry = connectionModelFlags[row.dataset.modelId] || {};
  const budget = connectionModelBudget(row.dataset.modelId, entry, row.dataset.modelType);
  for (const [key, selector, label] of [
    ['contextWindow', '[data-model-context-input]', '最大上下文'],
    ['compactionThreshold', '[data-model-threshold-input]', '压缩阈值'],
    ['maxOutputTokens', '[data-model-output-input]', '最大输出（含思考）']
  ]) {
    const input = row.querySelector(selector);
    if (!input || input === editingInput) continue;
    const manual = Number(entry[key]) > 0;
    const automatic = Number(budget?.[key]) > 0;
    input.value = connectionKInputValue(manual ? entry[key] : budget?.[key]);
    input.dataset.budgetMode = manual ? 'manual' : automatic ? 'auto' : 'unknown';
    input.parentElement.title = `${label} (k)；${connectionBudgetHint(row.dataset.modelId, key, manual, budget)}`;
  }
}

function connectionModelCapsMarkup(entry) {
  return CONNECTION_MODEL_CAP_ORDER.map(cap => {
    const state = connectionModelCapState(entry, cap);
    const label = connectionModelCapLabel(cap, state);
    return `<button type="button" class="conn-model-cap" data-model-cap="${cap}" data-state="${state}" aria-pressed="${state === 'yes'}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${escapeHtml(label)}</button>`;
  }).join('');
}

function syncConnectionModelRow(row) {
  if (!row) return;
  const entry = connectionModelFlags[row.dataset.modelId] || {};
  row.querySelectorAll('[data-model-cap]').forEach(button => {
    const state = connectionModelCapState(entry, button.dataset.modelCap);
    const label = connectionModelCapLabel(button.dataset.modelCap, state);
    button.dataset.state = state;
    button.setAttribute('aria-pressed', String(state === 'yes'));
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = label;
  });
  const type = connectionModelType(entry, row.dataset.baseType);
  row.dataset.modelType = type;
  syncConnectionBudgetFields(row);
  const enable = row.querySelector('[data-model-enable]');
  if (enable) enable.checked = connectionModelEnabled(entry);
}

function collectConnectionModelFlags() {
  const out = {};
  for (const [id, entry] of Object.entries(connectionModelFlags)) {
    if (!entry || typeof entry !== 'object') continue;
    const clean = {};
    for (const cap of CONNECTION_MODEL_CAP_ORDER) {
      if (typeof entry[cap] === 'boolean') clean[cap] = entry[cap];
    }
    for (const key of ['contextWindow', 'compactionThreshold', 'maxOutputTokens']) {
      const number = Math.round(Number(entry[key]));
      if (Number.isFinite(number) && number > 0) clean[key] = number;
    }
    if (typeof entry.enabled === 'boolean') clean.enabled = entry.enabled;
    if (Object.keys(clean).length) out[id] = clean;
  }
  return out;
}

function connectionModelRowMarkup(model, { custom = false, index = -1 } = {}) {
  const id = String(model.id || '');
  const label = model.name || model.id || '未命名模型';
  const entry = connectionModelFlags[id];
  const baseType = custom ? 'text' : connectionModelBaseType(model);
  const type = custom ? 'text' : connectionModelType(entry, baseType);
  const enabled = connectionModelEnabled(entry);
  const nameCell = custom
    ? `<input class="conn-model-name conn-model-name-input" data-custom-model-input type="text" value="${escapeAttr(id)}" placeholder="输入模型 ID" autocomplete="off" spellcheck="false" aria-label="自定义模型 ID" />`
    : `<span class="conn-model-name" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`;
  const removeCell = custom
    ? '<button type="button" class="conn-model-remove" data-custom-model-remove title="移除自定义模型" aria-label="移除自定义模型">×</button>'
    : '';
  return `<div class="conn-model-row${custom ? ' conn-model-row-custom' : ''}" role="listitem" data-model-id="${escapeAttr(id)}" data-base-type="${baseType}" data-model-type="${type}"${custom ? ` data-custom-model-row="${index}"` : ''}>
    ${nameCell}
    ${connectionBudgetField(id, entry, type, 'contextWindow', 'data-model-context-input', '最大上下文', '上下文')}
    ${connectionBudgetField(id, entry, type, 'compactionThreshold', 'data-model-threshold-input', '压缩阈值', '阈值')}
    ${connectionBudgetField(id, entry, type, 'maxOutputTokens', 'data-model-output-input', '最大输出', '输出')}
    <div class="conn-model-controls" role="group" aria-label="模型能力">
      ${connectionModelCapsMarkup(entry)}
      <span class="conn-model-control-divider" aria-hidden="true"></span>
      <label class="conn-model-enable" title="启用后参与主模型选择"><input type="checkbox" class="switch" data-model-enable role="switch" aria-label="启用 ${escapeAttr(label)}"${enabled ? ' checked' : ''} /><span class="conn-model-enable-text">启用</span></label>
    </div>
    ${removeCell}
  </div>`;
}

function renderConnectionModels(models, modelCount) {
  const container = $('#connModels');
  if (!container) return;
  connectionDetectedModels = Array.isArray(models) ? models : [];
  const numericCount = Number(modelCount);
  connectionDraftModelCount = Number.isFinite(numericCount) && numericCount >= 0
    ? numericCount
    : connectionDetectedModels.length;
  const rows = [
    ...connectionCustomModels.map((id, index) => connectionModelRowMarkup({ id }, { custom: true, index })),
    ...connectionDetectedModels.map(model => connectionModelRowMarkup(model))
  ];
  if (!rows.length) {
    container.innerHTML = '<div class="conn-model-empty" role="listitem">点击刷新获取 API 返回的模型列表。</div>';
    syncConnModelsToggleAll();
    return;
  }
  container.innerHTML = rows.join('');
  syncConnModelsToggleAll();
}

// All-listed-models enabled? Returns null when there is nothing to toggle.
function connModelsAllEnabled() {
  const rows = [...($('#connModels')?.querySelectorAll('.conn-model-row') || [])];
  if (!rows.length) return null;
  return rows.every(row => {
    const enable = row.querySelector('[data-model-enable]');
    return enable ? enable.checked : true;
  });
}

// The one-click switch reflects "every listed model enabled" and switches its
// label between 一键启用所有 / 一键禁用所有.
function syncConnModelsToggleAll() {
  const button = $('#connModelsToggleAll');
  if (!button) return;
  const allEnabled = connModelsAllEnabled() === true;
  button.classList.toggle('is-active', allEnabled);
  button.setAttribute('aria-pressed', String(allEnabled));
  const label = allEnabled ? '一键禁用所有模型' : '一键启用所有模型';
  button.title = label;
  button.setAttribute('aria-label', label);
}

async function openConnectionDialog(connectionId = '') {
  activeConnectionId = String(connectionId || '');
  connectionEditing = findConnectionInCache(activeConnectionId);
  resetConnectionSaveFeedback();
  const dialog = $('#connectionDialog');
  if (!dialog) return;
  const editing = !!connectionEditing;
  // Editing drops the sidebar so an existing connection cannot be re-pointed at
  // a different official preset by accident.
  dialog.classList.toggle('is-editing', editing);
  closeConnSelects();
  $('#connectionDialogTitle').textContent = editing ? '编辑连接' : '新建连接';
  $('#connectionDialogSubtitle').textContent = editing
    ? '修改连接配置，保存后立即生效。'
    : '选择左侧官方预设，或自定义配置，一次填完。';
  connectionEndpoints = {
    base: connectionEditing?.baseUrl || '',
    image: connectionEditing?.imageGenerationUrl || connectionEditing?.imageEditUrl || '',
    video: connectionEditing?.videoGenerationUrl || ''
  };
  connectionEndpointTab = 'base';
  connectionDraft.preset = editing
    ? (connectionEditing?.presetManual ? (connectionEditing.preset || 'auto') : 'auto')
    : 'openai';
  connectionDraft.apiFormat = connectionEditing?.apiFormat || 'auto';
  connectionNameAuto = !editing;
  $('#connName').value = connectionEditing?.name || '';
  const keyInput = $('#connApiKey');
  keyInput.value = connectionEditing?.apiKeyConfigured ? MASKED_API_KEY : '';
  keyInput.type = connectionEditing?.apiKeyConfigured ? 'text' : 'password';
  keyInput.dataset.masked = connectionEditing?.apiKeyConfigured ? 'true' : 'false';
  keyInput.dataset.revealed = 'false';
  connectionDraftApiKey = '';
  updateConnectionEyeButton(false);
  renderConnPresetSidebar();
  renderConnSelects();
  syncConnectionEndpoint();
  connectionModelFlags = connectionEditing?.modelFlags && typeof connectionEditing.modelFlags === 'object'
    ? JSON.parse(JSON.stringify(connectionEditing.modelFlags))
    : {};
  // Custom models are shown as editable rows on top of the detected catalog.
  const customFromConnection = Array.isArray(connectionEditing?.customModels) ? connectionEditing.customModels : [];
  const customFromLegacy = connectionEditing?.manualModelId ? [connectionEditing.manualModelId] : [];
  const customFromModels = (connectionEditing?.models || []).filter(model => model.source === 'custom').map(model => model.id);
  connectionCustomModels = [...new Set([...customFromConnection, ...customFromLegacy, ...customFromModels]
    .map(id => String(id || '').trim())
    .filter(Boolean))];
  // Reuse the last refreshed catalog only when reopening an existing connection
  // by its own provider id. A brand-new connection must start with an empty list
  // instead of leaking the previous draft's models.
  const cached = editing ? connectionModelCache.get(connectionEditing?.providerId) : null;
  const detectedFromConnection = (connectionEditing?.models || []).filter(model => model.source !== 'custom');
  defaultNewModelsDisabled(cached ? cached.models : detectedFromConnection);
  renderConnectionModels(
    cached ? cached.models : detectedFromConnection,
    cached ? cached.modelCount : (connectionEditing?.totalModelCount ?? detectedFromConnection.length)
  );
  $('#connModelsCustom')?.setAttribute('aria-expanded', 'false');
  if (!dialog.open) dialog.showModal();
}

async function testConnection() {
  if (connectionTestInFlight) return;
  const form = collectConnectionForm();
  let apiKey = form.apiKey;
  if (!apiKey && connectionEditing?.apiKeyConfigured) {
    try {
      const secret = await api.getProviderSecret(connectionEditing.providerId, connectionEditing.supplierId);
      apiKey = secret?.apiKey || '';
    } catch {}
  }
  if (!form.baseUrl || !/^https?:\/\//i.test(form.baseUrl)) {
    toast('请先填写以 http(s):// 开头的 Base URL。', { error: true });
    focusConnectionEndpoint('base');
    return;
  }
  if (!apiKey) {
    toast('请先填写 API Key（已保存的连接会自动使用已存 Key）。', { error: true });
    return;
  }
  connectionTestInFlight = true;
  const button = $('#connModelsRefresh');
  if (button) { button.disabled = true; button.dataset.busy = 'true'; }
  toast('正在连接并拉取模型列表…');
  try {
    const result = await api.connectionsTest({
      baseUrl: form.baseUrl,
      apiKey,
      preset: form.preset,
      apiFormat: form.apiFormat
    });
    if (result?.ok) {
      const detected = Array.isArray(result.models) ? result.models : [];
      defaultNewModelsDisabled(detected);
      connectionModelCache.set(connectionEditing?.providerId || 'new', { models: detected, modelCount: result.modelCount });
      renderConnectionModels(detected, result.modelCount);
      toast(`连接成功：返回 ${Number(result.modelCount) || 0} 个模型。`);
    } else {
      toast(`连接失败：${result?.error || '未知错误'}`, { error: true });
    }
  } catch (error) {
    toast(`连接失败：${error?.message || error}`, { error: true });
  } finally {
    connectionTestInFlight = false;
    if (button) { button.disabled = false; button.dataset.busy = 'false'; }
  }
}

async function saveConnection() {
  if (connectionSaveComplete) return;
  const form = collectConnectionForm();
  if (!form.name) { toast('请填写连接名称。', { error: true }); $('#connName')?.focus({ preventScroll: true }); return; }
  if (!form.baseUrl || !/^https?:\/\//i.test(form.baseUrl)) {
    toast('Base URL 必须以 http:// 或 https:// 开头。', { error: true });
    focusConnectionEndpoint('base');
    return;
  }
  for (const [label, url, tab] of [
    ['图像 POST', form.imageGenerationUrl, 'image'],
    ['生视频 POST', form.videoGenerationUrl, 'video']
  ]) {
    if (url && !/^https?:\/\//i.test(url)) {
      toast(`${label} 必须以 http:// 或 https:// 开头。`, { error: true });
      focusConnectionEndpoint(tab);
      return;
    }
  }
  if (!form.apiKey && !connectionEditing?.apiKeyConfigured) {
    toast('请填写 API Key（留空仅对已保存连接表示保留旧 Key）。', { error: true });
    $('#connApiKey')?.focus({ preventScroll: true });
    return;
  }
  setConnectionSaveState('saving');
  toast(form.manualModelId ? '正在保存连接…' : '正在保存并同步模型目录…');
  try {
    const result = await api.connectionsSave(form);
    if (result?.ok) {
      setConnectionSaveState('complete');
      const savedModels = Array.isArray(result.connection?.models) ? result.connection.models : [];
      const detected = savedModels.filter(model => model.source !== 'custom');
      const savedCustom = Array.isArray(result.connection?.customModels) ? result.connection.customModels : connectionCustomModels;
      connectionCustomModels = [...new Set(savedCustom.map(id => String(id || '').trim()).filter(Boolean))];
      connectionModelCache.set(
        result.connection?.providerId || connectionEditing?.providerId || 'new',
        { models: detected, modelCount: result.connection?.modelCount || result.modelCount || detected.length }
      );
      renderConnectionModels(detected, result.connection?.modelCount || result.modelCount || detected.length);
      await renderConnectionList();
      connectionEditing = findConnectionInCache(result.connection?.id || activeConnectionId);
      activeConnectionId = connectionEditing?.id || activeConnectionId;
      state.config = await api.getConfig();
      renderModelBadge();
      await refreshQuickModels().catch(() => {});
      await primeMediaModelLabels();
      $('#connectionDialog')?.close();
      const supplementalCount = Number(result.supplementalModelCount) || 0;
      const supplementalText = supplementalCount
        ? `，另有 ${supplementalCount} 个${result.connection?.supplementalModelLabel || '官方补充'}模型可选`
        : '';
      toast(`已保存：API 返回 ${Number(result.modelCount) || 0} 个模型${supplementalText}。`);
    } else {
      setConnectionSaveState('error');
      toast(`保存失败：${result?.error || '未知错误'}`, { error: true });
    }
  } catch (error) {
    setConnectionSaveState('error');
    toast(`保存失败：${error?.message || error}`, { error: true });
  }
}

async function deleteConnection(connectionOverride = null) {
  const target = connectionOverride || connectionEditing;
  if (!target) return;
  if ($('#connectionDialog')?.open) $('#connectionDialog').close();
  const confirmed = await requestProviderConfirmation({
    title: '删除连接',
    description: `确定删除「${target.name}」？已绑定到它的模型角色会被重置。`,
    confirmLabel: '删除'
  });
  if (!confirmed) return;
  try {
    const result = await api.connectionsDelete(target.id);
    if (result?.ok) {
      if (connectionEditing?.id === target.id) {
        connectionEditing = null;
        activeConnectionId = '';
      }
      $('#connectionDialog')?.close();
      await renderConnectionList();
      state.config = await api.getConfig();
      quickModelsCache = null;
      renderModelBadge();
      await refreshQuickModels().catch(() => {});
      await primeMediaModelLabels();
      toast('连接已删除');
    } else {
      toast(result?.error || '删除失败', { error: true });
    }
  } catch (error) {
    toast(`删除失败：${error?.message || error}`, { error: true });
  }
}

// --- confirm modal ----------------------------------------------------------

function resolveProviderConfirmation(confirmed) {
  if (!providerConfirmResolver) return;
  const resolve = providerConfirmResolver;
  providerConfirmResolver = null;
  const layer = $('#providerConfirmModal');
  layer?.classList.add('hidden');
  layer?.setAttribute('aria-hidden', 'true');
  resolve(confirmed);
}

function requestProviderConfirmation({ title, description, confirmLabel = '确认' } = {}) {
  return new Promise(resolve => {
    const layer = $('#providerConfirmModal');
    if (!layer) { resolve(false); return; }
    $('#providerConfirmTitle').textContent = title || '确认操作';
    $('#providerConfirmDescription').textContent = description || '';
    $('#providerConfirmAccept').textContent = confirmLabel || '确认';
    layer.classList.remove('hidden');
    layer.setAttribute('aria-hidden', 'false');
    providerConfirmResolver = resolve;
  });
}

// --- events -----------------------------------------------------------------

$('#connectionDialogClose')?.addEventListener('click', () => $('#connectionDialog')?.close());
$('#connectionDialog')?.addEventListener('close', () => {
  closeConnSelects();
  // Clear the DOM only; a saved connection's per-provider catalog cache survives
  // so the next open shows the last refreshed list immediately. The unsaved
  // "new" draft cache is discarded so the next 新建连接 starts empty.
  connectionModelCache.delete('new');
  connectionModelFlags = {};
  connectionCustomModels = [];
  connectionDetectedModels = [];
  const container = $('#connModels');
  if (container) container.innerHTML = '';
  $('#connModelsCustom')?.classList.remove('is-active');
  $('#connModelsCustom')?.setAttribute('aria-expanded', 'false');
  syncConnModelsToggleAll();
});
$('#connectionDialog')?.addEventListener('click', event => {
  const option = event.target.closest('.conn-select-option');
  const host = event.target.closest('.conn-select');
  const trigger = event.target.closest('.conn-select-trigger');
  if (option && host) {
    applyConnSelect(host, option.dataset.connSelectValue);
    closeConnSelects();
    return;
  }
  if (trigger && host) {
    const wasOpen = host.classList.contains('open');
    closeConnSelects();
    if (!wasOpen) {
      host.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  closeConnSelects();
  if (event.target !== event.currentTarget) return;
  if (providerConfirmResolver) { resolveProviderConfirmation(false); return; }
  event.currentTarget.close();
});
$('#providerConfirmCancel')?.addEventListener('click', () => resolveProviderConfirmation(false));
$('#providerConfirmAccept')?.addEventListener('click', () => resolveProviderConfirmation(true));
$('#providerConfirmModal')?.addEventListener('click', event => {
  if (event.target === event.currentTarget) resolveProviderConfirmation(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (document.querySelector('#connectionDialog .conn-select.open')) { closeConnSelects(); return; }
  if (providerConfirmResolver) {
    event.preventDefault();
    event.stopImmediatePropagation();
    resolveProviderConfirmation(false);
  }
}, true);

$('#connPresetSidebar')?.addEventListener('click', event => {
  const button = event.target.closest('[data-conn-preset-item]');
  if (button) selectConnectionPreset(button.dataset.connPresetItem);
});
$('#connEndpointInput')?.addEventListener('input', event => {
  connectionEndpoints[connectionEndpointTab] = event.target.value;
  if (connectionSaveComplete) resetConnectionSaveFeedback();
});
$('#connName')?.addEventListener('input', () => {
  connectionNameAuto = false;
  if (connectionSaveComplete) resetConnectionSaveFeedback();
});
$('#connApiKey')?.addEventListener('input', event => {
  if (event.currentTarget.dataset.masked !== 'true') connectionDraftApiKey = event.currentTarget.value;
  if (connectionSaveComplete) resetConnectionSaveFeedback();
});
$('#connApiKey')?.addEventListener('beforeinput', event => {
  if (event.currentTarget.dataset.masked !== 'true') return;
  event.currentTarget.value = '';
  connectionDraftApiKey = '';
  event.currentTarget.dataset.masked = 'false';
  event.currentTarget.dataset.revealed = 'false';
  event.currentTarget.type = 'password';
});
$('#connToggleKey')?.addEventListener('click', async () => {
  const input = $('#connApiKey');
  const button = $('#connToggleKey');
  if (!input || !button) return;
  if (input.dataset.masked === 'true') {
    if (connectionDraftApiKey) {
      input.value = connectionDraftApiKey;
      input.dataset.masked = 'false';
      input.dataset.revealed = 'true';
      input.type = 'text';
      updateConnectionEyeButton(true);
      return;
    }
    if (!connectionEditing) return;
    button.disabled = true;
    try {
      const result = await api.getProviderSecret(connectionEditing.providerId, connectionEditing.supplierId);
      if (result?.error) { toast(result.error, { error: true }); return; }
      input.value = result?.apiKey || '';
      connectionDraftApiKey = input.value;
      input.dataset.masked = 'false';
      input.dataset.revealed = 'true';
      input.type = 'text';
      updateConnectionEyeButton(true);
    } finally {
      button.disabled = false;
    }
    return;
  }
  const actualValue = connectionDraftApiKey || input.value;
  if (actualValue) {
    connectionDraftApiKey = actualValue;
    input.value = MASKED_API_KEY;
    input.dataset.masked = 'true';
    input.dataset.revealed = 'false';
    input.type = 'text';
    updateConnectionEyeButton(false);
    return;
  }
  input.type = input.type === 'password' ? 'text' : 'password';
  updateConnectionEyeButton(input.type === 'text');
});
$('#connModelsRefresh')?.addEventListener('click', () => { void testConnection(); });
$('#connModelsToggleAll')?.addEventListener('click', () => {
  const rows = [...($('#connModels')?.querySelectorAll('.conn-model-row') || [])];
  if (!rows.length) { toast('暂无可操作的模型，请先刷新模型列表。'); return; }
  const enableAll = connModelsAllEnabled() !== true;
  for (const row of rows) {
    const enable = row.querySelector('[data-model-enable]');
    if (enable) enable.checked = enableAll;
    const id = String(row.dataset.modelId || '');
    if (id) connectionModelFlagEntry(id).enabled = enableAll;
  }
  syncConnModelsToggleAll();
  if (connectionSaveComplete) resetConnectionSaveFeedback();
  toast(enableAll ? '已启用全部模型' : '已禁用全部模型');
});
$('#connModelsCustom')?.addEventListener('click', () => {
  const button = $('#connModelsCustom');
  connectionCustomModels.push('');
  renderConnectionModels(connectionDetectedModels, connectionDraftModelCount);
  button?.classList.add('is-active');
  button?.setAttribute('aria-expanded', 'true');
  if (connectionSaveComplete) resetConnectionSaveFeedback();
  const inputs = $('#connModels')?.querySelectorAll('[data-custom-model-input]') || [];
  const target = inputs[inputs.length - 1];
  target?.scrollIntoView({ block: 'nearest' });
  target?.focus({ preventScroll: true });
});
$('#connModels')?.addEventListener('click', event => {
  const remove = event.target.closest('[data-custom-model-remove]');
  if (remove) {
    const row = remove.closest('[data-custom-model-row]');
    const index = Number(row?.dataset.customModelRow);
    if (Number.isInteger(index) && index >= 0) {
      const [removedId] = connectionCustomModels.splice(index, 1);
      if (removedId && connectionModelFlags[removedId]) delete connectionModelFlags[removedId];
      renderConnectionModels(connectionDetectedModels, connectionDraftModelCount);
      if (connectionSaveComplete) resetConnectionSaveFeedback();
    }
    return;
  }
  const cap = event.target.closest('[data-model-cap]');
  if (!cap) return;
  const row = cap.closest('.conn-model-row');
  if (!row) return;
  const entry = connectionModelFlagEntry(row.dataset.modelId);
  const capKey = cap.dataset.modelCap;
  const state = connectionModelCapState(entry, capKey);
  const next = state === 'unknown' ? 'yes' : state === 'yes' ? 'no' : 'unknown';
  if (next === 'unknown') delete entry[capKey];
  else entry[capKey] = next === 'yes';
  syncConnectionModelRow(row);
  if (connectionSaveComplete) resetConnectionSaveFeedback();
});
$('#connModels')?.addEventListener('input', event => {
  const custom = event.target.closest('[data-custom-model-input]');
  if (custom) {
    const row = custom.closest('[data-custom-model-row]');
    const index = Number(row?.dataset.customModelRow);
    const value = String(custom.value || '').trim();
    if (Number.isInteger(index) && index >= 0) connectionCustomModels[index] = value;
    if (row) {
      row.dataset.modelId = value;
      syncConnectionModelRow(row);
    }
    if (connectionSaveComplete) resetConnectionSaveFeedback();
    return;
  }
  const input = event.target.closest('[data-model-context-input],[data-model-threshold-input],[data-model-output-input]');
  if (!input) return;
  const row = input.closest('.conn-model-row');
  if (!row) return;
  const entry = connectionModelFlagEntry(row.dataset.modelId);
  const key = input.hasAttribute('data-model-context-input')
    ? 'contextWindow'
    : (input.hasAttribute('data-model-output-input') ? 'maxOutputTokens' : 'compactionThreshold');
  const raw = String(input.value || '').trim();
  if (!raw) {
    delete entry[key];
  } else {
    const k = Number(raw);
    if (Number.isFinite(k) && k > 0) entry[key] = Math.round(k * 1000);
  }
  syncConnectionBudgetFields(row, input);
  if (connectionSaveComplete) resetConnectionSaveFeedback();
});
$('#connModels')?.addEventListener('change', event => {
  const budgetInput = event.target.closest('[data-model-context-input],[data-model-threshold-input],[data-model-output-input]');
  if (budgetInput) {
    syncConnectionBudgetFields(budgetInput.closest('.conn-model-row'));
    return;
  }
  const enable = event.target.closest('[data-model-enable]');
  if (!enable) return;
  const row = enable.closest('.conn-model-row');
  if (!row) return;
  connectionModelFlagEntry(row.dataset.modelId).enabled = !!enable.checked;
  syncConnModelsToggleAll();
  if (connectionSaveComplete) resetConnectionSaveFeedback();
});
$('#connNext')?.addEventListener('click', () => { void saveConnection(); });
