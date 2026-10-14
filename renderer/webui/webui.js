'use strict';
const $ = selector => document.querySelector(selector);
let projects = [];
let requestVersion = 0;
let composerModels = [];
let selectedModelKey = '';
let reasoningMode = 'medium';
let currentTask = null;
let selectedWorkspace = '';
let sending = false, liveEvents = null, pendingIntent = null;
let taskLoadVersion = 0;
const projectCache = { loaded: false, data: null };
const taskCache = new Map();
const pendingMessages = new Map();
let runningTaskIds = new Set();
const reasoningModes = ['low', 'medium', 'high', 'xhigh', 'max'];
const reasoningLabels = ['轻度', '中', '高', '极高', '最高'];
const icon = name => { const element = document.createElement('i'); element.dataset.lucide = name; return element; };
function renderProjects() {
  $('#projectList').replaceChildren();
  $('#emptyState').hidden = projects.length > 0;
  for (const project of projects) {
    const details = document.createElement('details');
    details.className = 'project';
    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = project.label;
    const chevron = icon('chevron-right');
    chevron.className = 'chevron';
    const projectSpinner = document.createElement('span');
    projectSpinner.className = 'session-spinner project-spinner';
    projectSpinner.setAttribute('aria-hidden','true');
    projectSpinner.hidden = !project.tasks.some(task => runningTaskIds.has(task.id));
    summary.append(icon('folder'), name, projectSpinner, chevron);
    const tasks = document.createElement('div');
    tasks.className = 'task-list';
    for (const task of project.tasks) {
      const row = document.createElement('button');
      row.className = 'task-row';
      const title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = task.title || '新任务';
      const spinner = document.createElement('span');
      spinner.className = 'session-spinner task-spinner';
      spinner.setAttribute('aria-hidden','true');
      spinner.hidden = !runningTaskIds.has(task.id);
      row.append(title, spinner);
      row.addEventListener('click', () => { location.hash = 'task=' + encodeURIComponent(task.id); });
      tasks.append(row);
    }
    details.append(summary, tasks);
    $('#projectList').append(details);
  }
  window.lucide?.createIcons();
}
function updateRunningIndicators() {
  for (const [index, project] of projects.entries()) {
    const group = $('#projectList').children[index];
    if (!group) continue;
    group.querySelector('.project-spinner').hidden = !project.tasks.some(task => runningTaskIds.has(task.id));
    for (const [taskIndex, task] of project.tasks.entries()) {
      const spinner = group.querySelector('.task-list').children[taskIndex]?.querySelector('.task-spinner');
      if (spinner) spinner.hidden = !runningTaskIds.has(task.id);
    }
  }
}
let runningRequest = false;
async function refreshRunningTasks() {
  if (runningRequest || document.body.dataset.view !== 'projects' || document.hidden) return;
  runningRequest = true;
  try {
    const response = await fetch('/api/running',{cache:'no-store'});
    if (!response.ok) throw new Error('Running status unavailable');
    const data = await response.json();
    if (!Array.isArray(data.ids)) throw new Error('Invalid running status');
    runningTaskIds = new Set(data.ids);
    if (data.ids.some(id => !projects.some(project => project.tasks.some(task => task.id === id)))) {
      projectCache.loaded = false;
      await loadProjects();
    }
    updateRunningIndicators();
  } catch { /* Keep the last known status until the desktop reconnects. */ }
  finally { runningRequest = false; }
}
async function loadProjects() {
  const version = ++requestVersion;
  $('.projects-section').setAttribute('aria-busy', 'true');
  $('#errorState').hidden = true;
  if (projectCache.loaded) { projects = projectCache.data; renderProjects(); renderWorkspaceMenu(); $('.projects-section').setAttribute('aria-busy', 'false'); return; }
  try {
    const preview = new URLSearchParams(location.search).get('preview') === 'empty' ? '?preview=empty' : '';
    const response = await fetch('/api/projects' + preview, { cache: 'no-store' });
    if (!response.ok) throw new Error('Project request failed');
    const data = await response.json();
    if (!Array.isArray(data.projects)) throw new Error('Invalid project response');
    if (version !== requestVersion) return;
    projects = data.projects;
    projectCache.data = projects; projectCache.loaded = true;
    renderProjects(); renderWorkspaceMenu();
  } catch {
    if (version !== requestVersion) return;
    $('#projectList').replaceChildren();
    $('#emptyState').hidden = true;
    $('#errorState').hidden = false;
  } finally { if (version === requestVersion) $('.projects-section').setAttribute('aria-busy', 'false'); }
}
$('#retryButton').addEventListener('click', loadProjects);
function messageText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map(part => typeof part === 'string' ? part : part?.type === 'text' ? part.text : '[附件]').join('\n') : '';
}
function visibleTaskMessages() {
  const messages = [...(currentTask?.messages || [])];
  for (const [intentId, pending] of pendingMessages) {
    if (pending.taskId !== currentTask?.id) continue;
    if (messages.some(message => message.role === 'user' && message.intentId === intentId)) {
      pendingMessages.delete(intentId);
      continue;
    }
    messages.push(pending.message, pending.startup);
  }
  return messages;
}
function updateTaskState() {
  const hasMessages = !!visibleTaskMessages().length;
  $('#taskMoreButton').hidden = !hasMessages;
  $('#taskMessagePane').hidden = !hasMessages;
  window.YanWebConversation.syncScrollbar();
  $('.new-task-welcome').hidden = hasMessages;
}
function renderTaskMessages(preserve = false) {
  window.YanWebConversation.render(visibleTaskMessages(), preserve);
}
function followTask(id) {
  liveEvents?.close();
  liveEvents = new EventSource('/api/events?id=' + encodeURIComponent(id));
  liveEvents.onmessage = event => {
    const task = JSON.parse(event.data);
    for (const message of task.messages || []) {
      if (message.role === 'user' && message.intentId) pendingMessages.delete(message.intentId);
    }
    taskCache.set(task.id, task);
    if (currentTask?.id !== task.id) return;
    currentTask = task;
    if (task.running) runningTaskIds.add(task.id); else runningTaskIds.delete(task.id);
    $('#newTaskTitle').textContent = task.title || '任务';
    syncWorkspacePicker();
    renderTaskMessages(true); updateTaskState(); updateComposer();
    let found = false;
    for (const project of projects) {
      const entry = project.tasks.find(t => t.id === task.id);
      if (entry) { entry.title = task.title; found = true; }
    }
    if (!found) projectCache.loaded = false;
  };
  liveEvents.addEventListener('connection', event => {
    if (!JSON.parse(event.data).online) showStatus('桌面端暂时离线，正在重连');
  });
}
async function loadHistoryTask(id) {
  const version = ++taskLoadVersion;
  const cached = taskCache.get(id);
  if (cached) {
    currentTask = cached; $('#newTaskTitle').textContent = cached.title || '任务'; composerInput.value = ''; syncWorkspacePicker();
    renderTaskMessages(); updateTaskState(); updateComposer(); followTask(id); return;
  }
  currentTask = null; updateTaskState();
  $('#newTaskTitle').textContent = '加载任务…';
  try {
    const response = await fetch('/api/task?id=' + encodeURIComponent(id), { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取任务');
    const task = await response.json();
    if (version !== taskLoadVersion) return;
    currentTask = task; $('#newTaskTitle').textContent = task.title || '任务'; composerInput.value = ''; syncWorkspacePicker();
    taskCache.set(id, task);
    followTask(id);
    renderTaskMessages(); updateTaskState(); updateComposer();
  } catch { if (version === taskLoadVersion) { $('#newTaskTitle').textContent = '无法读取任务'; showStatus('无法读取任务，请返回重试'); } }
}
let statusTimer;
function showStatus(text) { clearTimeout(statusTimer); $('#webuiStatus').textContent = text; $('#webuiStatus').hidden = false; statusTimer = setTimeout(() => { $('#webuiStatus').hidden = true; }, 2000); }
function closeTaskMenu() { $('#taskActionsMenu').hidden = true; $('#taskMoreButton').setAttribute('aria-expanded', 'false'); }
function openTaskMenu() {
  if (!currentTask?.messages.length) return;
  const menu = $('#taskActionsMenu'); menu.replaceChildren();
  const add = (label, iconName, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.innerHTML = taskIcons[iconName];
    const span = document.createElement('span'); span.textContent = label; button.append(span);
    button.addEventListener('click', async () => { closeTaskMenu(); try { await action(); } catch { showStatus('操作失败，请重试'); } }); menu.append(button);
  };
  add('重命名任务', 'edit', () => { $('#taskNameInput').value = currentTask.title; $('#renameTaskDialog').showModal(); $('#taskNameInput').focus(); });
  add(currentTask.pinned ? '取消置顶任务' : '置顶任务', 'pin', () => { currentTask.pinned = !currentTask.pinned; window.dispatchEvent(new CustomEvent('yanweb:pin-task', { detail: { id: currentTask.id, pinned: currentTask.pinned } })); showStatus('已更新当前预览的置顶状态'); });
  const separator = document.createElement('div'); separator.className = 'task-context-separator'; separator.setAttribute('role', 'separator'); menu.append(separator);
  add('复制工作目录', 'copy', async () => { if (!currentTask.workspace) { showStatus('当前任务未关联工作目录'); return; } await navigator.clipboard.writeText(currentTask.workspace); showStatus('已复制工作目录'); });
  add('复制深度链接', 'copy', async () => { if (!currentTask.id) { showStatus('任务尚未保存，暂无深度链接'); return; } await navigator.clipboard.writeText(location.origin + '/#task=' + encodeURIComponent(currentTask.id)); showStatus('已复制深度链接'); });
  menu.hidden = false; $('#taskMoreButton').setAttribute('aria-expanded', 'true');
  const rect = $('#taskMoreButton').getBoundingClientRect(); menu.style.right = `${Math.max(8, innerWidth - rect.right)}px`; menu.style.top = `${rect.bottom + 8}px`;
  menu.querySelector('button').focus();
}
$('#taskActionsMenu').addEventListener('keydown', event => {
  const buttons = [...$('#taskActionsMenu').querySelectorAll('button')];
  const current = buttons.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  } else if (event.key === 'Escape' || event.key === 'Tab') { closeTaskMenu(); if (event.key === 'Escape') $('#taskMoreButton').focus(); }
});
$('#taskMoreButton').addEventListener('click', () => { if ($('#taskActionsMenu').hidden) openTaskMenu(); else closeTaskMenu(); });
document.addEventListener('click', event => { if (!event.target.closest('#taskMoreButton, #taskActionsMenu')) closeTaskMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTaskMenu(); });
$('#cancelRename').addEventListener('click', () => $('#renameTaskDialog').close());
$('#renameTaskForm').addEventListener('submit', event => { event.preventDefault(); const title = $('#taskNameInput').value.trim(); if (!title || !currentTask) return; currentTask.title = title; $('#newTaskTitle').textContent = title; $('#renameTaskDialog').close(); window.dispatchEvent(new CustomEvent('yanweb:rename-task', { detail: { id: currentTask.id, title } })); });
function updateTaskViewport() {
  const viewport = window.visualViewport;
  $('#newTaskView').style.setProperty('--task-height', `${viewport?.height || innerHeight}px`);
  $('#newTaskView').style.setProperty('--task-top', `${viewport?.offsetTop || 0}px`);
}
function showView() {
  liveEvents?.close(); liveEvents = null;
  const historyTask = location.hash.startsWith('#task=');
  const creating = location.hash === '#new-task' || historyTask;
  $('#newTaskView').hidden = !creating;
  $('.topbar').hidden = creating;
  $('main').hidden = creating;
  $('#newTaskButton').hidden = creating;
  document.body.dataset.view = creating ? 'new-task' : 'projects';
  document.title = creating ? '新任务 · Yan Agent WebUI' : 'Yan Agent WebUI';
  updateTaskViewport();
  closeTaskMenu();
  if (!historyTask) { ++taskLoadVersion; currentTask = null; selectedWorkspace = ''; $('#taskMessages').replaceChildren(); $('#newTaskTitle').textContent = '新任务'; syncWorkspacePicker(); updateTaskState(); }
  else loadHistoryTask(decodeURIComponent(location.hash.slice(6)));
  if (!creating) loadProjects();
  if (!creating) refreshRunningTasks();
  if (creating) { updateComposer(); $('#backToProjects').focus({ preventScroll: true }); }
}
$('#newTaskButton').addEventListener('click', () => { location.hash = 'new-task'; });
$('#backToProjects').addEventListener('click', () => { location.hash = ''; });
window.addEventListener('hashchange', showView);
window.visualViewport?.addEventListener('resize', updateTaskViewport);
window.visualViewport?.addEventListener('scroll', updateTaskViewport);
window.addEventListener('resize', updateTaskViewport);
const composerInput = $('#composerInput');
function updateComposer() {
  composerInput.style.height = 'auto';
  composerInput.style.height = `${composerInput.scrollHeight}px`;
  $('#sendTaskButton').disabled = sending || !!currentTask?.running || [...pendingMessages.values()].some(pending => pending.taskId === currentTask?.id) || (!composerInput.value.trim() && !window.YanWebAdditions?.hasContent()) || !selectedModelKey;
}
function workspaceLabel(workspace) {
  if (!workspace) return '不在工作区工作';
  return String(workspace).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || workspace;
}
function renderWorkspaceMenu() {
  const menu = $('#workspaceChoiceMenu'), list = $('#workspaceChoiceRecent'); if (!menu || !list) return;
  list.replaceChildren();
  const choices = [], seen = new Set(['']);
  for (const project of projects) {
    const workspace = String(project.workspace || '').trim();
    if (!workspace || seen.has(workspace)) continue;
    seen.add(workspace); choices.push({workspace, label:workspaceLabel(workspace)});
  }
  for (const choice of choices) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-choice-item'; button.dataset.workspace = choice.workspace;
    button.setAttribute('aria-pressed', String(choice.workspace === selectedWorkspace));
    button.innerHTML = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.842 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11\"/></svg>";
    const label = document.createElement('span'); label.textContent = choice.label; label.title = choice.workspace; button.append(label);
    button.addEventListener('click', () => { selectedWorkspace = choice.workspace; $('#taskBarFolderName').textContent = choice.label; menu.classList.add('hidden'); $('#taskBarFolder').setAttribute('aria-expanded','false'); renderWorkspaceMenu(); });
    list.append(button);
  }
}
function syncWorkspacePicker() {
  selectedWorkspace = String(currentTask?.workspace ?? selectedWorkspace);
  $('#taskBarFolderName').textContent = workspaceLabel(selectedWorkspace);
  const locked = !!currentTask?.id && !String(currentTask.id).startsWith('pending_');
  const hasConversation = !!currentTask?.messages?.length || [...pendingMessages.values()].some(pending => pending.taskId === currentTask?.id);
  $('#newTaskWorkspace').hidden = hasConversation;
  if (hasConversation) { $('#workspaceChoiceMenu').classList.add('hidden'); $('#taskBarFolder').setAttribute('aria-expanded','false'); }
  $('#taskBarFolder').disabled = locked;
  $('#taskBarFolder').title = locked ? '当前任务工作区已锁定' : '选择工作区';
  renderWorkspaceMenu();
}
$('#workspaceChoiceMenu [data-workspace-choice="blank"]').addEventListener('click', () => { selectedWorkspace = ''; $('#taskBarFolderName').textContent = '不在工作区工作'; $('#workspaceChoiceMenu').classList.add('hidden'); $('#taskBarFolder').setAttribute('aria-expanded','false'); renderWorkspaceMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('#workspaceChoiceMenu').classList.add('hidden'); $('#taskBarFolder').setAttribute('aria-expanded','false'); } });
$('#taskBarFolder').addEventListener('click', () => { const menu = $('#workspaceChoiceMenu'); const open = menu.classList.toggle('hidden'); $('#taskBarFolder').setAttribute('aria-expanded', String(!open)); if (!open) renderWorkspaceMenu(); });
document.addEventListener('click', event => { if (!event.target.closest('#taskBarFolderWrap')) { $('#workspaceChoiceMenu')?.classList.add('hidden'); $('#taskBarFolder')?.setAttribute('aria-expanded','false'); } });
composerInput.addEventListener('input', updateComposer);
function renderModelControl() {
  const model = composerModels.find(model => model.key === selectedModelKey);
  const label = reasoningLabels[reasoningModes.indexOf(reasoningMode)];
  $('#modelPillName').textContent = model?.name || '模型不可用';
  $('#modelQuickRouteModel').textContent = model?.name || '模型不可用';
  $('#modelPillSpeed').textContent = label;
  $('#modelQuickRouteReasoning').textContent = label;
  $('#modelPill').dataset.reasoningMode = reasoningMode;
  $('#modelQuickMenu').dataset.reasoningMode = reasoningMode;
  $('#modelPill').setAttribute('aria-label', `当前模型 ${model?.name || '未选择模型'}，推理强度 ${label}，点击切换`);
  $('#reasoningSpeedSliderShell').dataset.mode = reasoningMode;
  $('#reasoningSpeedSliderShell').style.setProperty('--speed-progress', String(Number($('#reasoningSpeedSlider').value) / 100));
  $('#reasoningSpeedSlider').setAttribute('aria-valuetext', label);
  $('#modelQuickList').replaceChildren();
  for (const item of composerModels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'model-quick-item' + (item.key === selectedModelKey ? ' is-selected' : '');
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(item.key === selectedModelKey));
    const name = document.createElement('span'); name.className = 'model-quick-name'; name.textContent = item.name;
    button.title = `${item.providerName || item.providerId || ''} · ${item.supplierName || ''} · ${item.name}`;
    button.setAttribute('aria-label', `${item.name} · ${item.providerName || item.providerId || ''}`);
    const check = document.createElement('span'); check.className = 'model-quick-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    button.append(name, check);
    button.addEventListener('click', () => { selectedModelKey = item.key; renderModelControl(); updateComposer(); setModelQuickMenuOpen(false); });
    $('#modelQuickList').append(button);
  }
}
function setModelQuickView(view = 'control') {
  const models = view === 'models';
  $('#modelQuickMenu').dataset.view = view;
  $('#modelQuickDefaultView').classList.toggle('hidden', models);
  $('#modelQuickModelsView').classList.toggle('hidden', !models);
  $('#modelQuickModelRoute').setAttribute('aria-expanded', String(models));
  if (models) $('#modelQuickList .is-selected, #modelQuickList button')?.focus();
}
function setModelQuickMenuOpen(open, restoreFocus = false) {
  $('#modelQuickMenu').classList.toggle('hidden', !open);
  $('#modelQuickMenu').setAttribute('aria-hidden', String(!open));
  $('#modelPill').setAttribute('aria-expanded', String(open));
  setModelQuickView('control');
  if (open) $('#modelQuickModelRoute').focus();
  else if (restoreFocus) $('#modelPill').focus();
}
$('#modelPill').addEventListener('click', () => setModelQuickMenuOpen($('#modelQuickMenu').classList.contains('hidden')));
$('#modelQuickModelRoute').addEventListener('click', () => setModelQuickView('models'));
$('#reasoningSpeedSlider').addEventListener('input', event => {
  const nextMode = reasoningModes[Math.round(Number(event.target.value) / 25)];
  if (nextMode === 'max' && reasoningMode !== 'max') showMaxReasoningNotice();
  else if (nextMode !== 'max') clearMaxReasoningNotice();
  reasoningMode = nextMode;
  renderModelControl();
});
$('#reasoningSpeedSlider').addEventListener('change', () => {
  $('#reasoningSpeedSlider').value = String(reasoningModes.indexOf(reasoningMode) * 25);
  renderModelControl();
  if (reasoningMode === 'max') { clearTimeout(maxReasoningNoticeTimer); maxReasoningNoticeTimer = setTimeout(clearMaxReasoningNotice, 2000); }
});
document.addEventListener('click', event => { if (!event.target.closest('#modelPickerWrap')) setModelQuickMenuOpen(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#modelQuickMenu').classList.contains('hidden')) { event.stopPropagation(); if ($('#modelQuickMenu').dataset.view === 'models') { setModelQuickView(); $('#modelQuickModelRoute').focus(); } else setModelQuickMenuOpen(false, true); } });
window.addEventListener('hashchange', () => setModelQuickMenuOpen(false));
function photoPayload(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({name:file.name,mimeType:file.type,base64:String(reader.result).split(',')[1]});
    reader.onerror = () => reject(new Error('无法读取照片'));
    reader.readAsDataURL(file);
  });
}
$('#taskComposer').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('#sendTaskButton').disabled) return;
  const model = composerModels.find(model => model.key === selectedModelKey);
  const additions = window.YanWebAdditions?.payload() || {skills:[],photos:[],projectFiles:[]};
  const text = composerInput.value.trim(), taskId = currentTask?.id || '';
  const route = location.hash;
  const signature = JSON.stringify({taskId,text,workspace:selectedWorkspace,model,reasoningMode,skills:additions.skills,projectFiles:additions.projectFiles,photos:additions.photos.map(file => [file.name,file.size,file.type,file.lastModified])});
  if (pendingIntent?.signature !== signature) pendingIntent = {signature,id:'web_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)};
  const intentId = pendingIntent.id;
  const optimisticTask = currentTask || {id:'pending_'+intentId,title:'新任务',workspace:selectedWorkspace,messages:[]};
  const pending = {
    taskId:optimisticTask.id,
    message:{role:'user',content:text,ts:Date.now(),intentId,
      skillCalls:additions.skills,
      attachments:[...additions.photos.map(photo => ({name:photo.name,mimeType:photo.type})),
        ...additions.projectFiles.map(file => ({name:file.name || file.path,mimeType:'application/octet-stream'}))]},
    startup:{role:'assistant',content:'',agentRun:{status:'working',timeline:[]}}
  };
  pendingMessages.set(intentId,pending);
  currentTask = optimisticTask;
  composerInput.value = '';
  sending = true; syncWorkspacePicker(); updateComposer();
  renderTaskMessages(true); updateTaskState();
  try {
    const payload = {taskId,text,workspace:selectedWorkspace,model,reasoningMode,skills:additions.skills,projectFiles:additions.projectFiles,photos:await Promise.all(additions.photos.map(photoPayload))};
    const response = await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,intentId})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '发送失败');
    pendingIntent = null;
    pending.taskId = result.taskId;
    projectCache.loaded = false;
    if (location.hash !== route) { showStatus('消息已发送'); return; }
    window.YanWebAdditions?.clear();
    if (!currentTask) currentTask = {id:result.taskId,title:'新任务',messages:[]};
    currentTask.id = result.taskId; currentTask.running = true;
    runningTaskIds.add(result.taskId);
    taskCache.set(result.taskId,currentTask);
    history.replaceState(null,'','#task='+encodeURIComponent(result.taskId));
    followTask(result.taskId);
    showStatus('已发送，Agent 开始工作');
  } catch(error) {
    pendingMessages.delete(intentId);
    if (location.hash === route && !composerInput.value) composerInput.value = text;
    if (currentTask?.id === pending.taskId) {
      if (currentTask.id.startsWith('pending_') && !currentTask.messages.length) currentTask = null;
      renderTaskMessages(true); updateTaskState(); updateComposer();
    }
    if (location.hash === route) syncWorkspacePicker();
    showStatus(error.message || '发送失败，输入已恢复');
  }
  finally {sending=false;updateComposer();}
});
window.YanWebComposerContext = () => ({ workspace: currentTask ? currentTask.workspace || '' : undefined, taskId: currentTask?.id || '', model: composerModels.find(model => model.key === selectedModelKey), reasoningMode });
async function loadComposerModels() {
  try {
    const response = await fetch('/api/composer-models', { cache: 'no-store' });
    if (!response.ok) throw new Error('Models unavailable');
    const data = await response.json();
    composerModels = data.models;
    selectedModelKey = composerModels.find(model => model.key === data.selected)?.key || composerModels[0]?.key || '';
    reasoningMode = reasoningModes.includes(data.reasoningMode) ? data.reasoningMode : 'medium';
    $('#reasoningSpeedSlider').value = String(reasoningModes.indexOf(reasoningMode) * 25);
    $('#modelPill').disabled = !composerModels.length;
    renderModelControl();
  } catch { $('#modelPillName').textContent = '模型不可用'; $('#modelPill').disabled = true; }
  updateComposer();
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
  $('#themeButton').setAttribute('aria-label', label);
  $('#themeButton').title = label;
  $('#themeButton').replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#1a1a1a' : '#f5f5f5';
  window.lucide?.createIcons();
}
let savedTheme;
try { savedTheme = localStorage.getItem('yan.webui.theme'); } catch {}
setTheme(['light', 'dark'].includes(savedTheme) ? savedTheme : 'light');
$('#themeButton').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme);
  try { localStorage.setItem('yan.webui.theme', theme); } catch {}
});
$('#restartButton').addEventListener('click', () => location.reload());
$('#cancelDisconnect').addEventListener('click', () => $('#disconnectDialog').close());
$('#confirmDisconnect').addEventListener('click', () => { liveEvents?.close(); ++requestVersion; $('#disconnectDialog').close(); $('main').inert = true; $('.topbar').inert = true; $('#newTaskButton').disabled = true; $('#disconnectedDialog').showModal(); });
$('#disconnectedDialog').addEventListener('cancel', event => event.preventDefault());
$('#reconnectButton').addEventListener('click', () => location.reload());
window.lucide?.createIcons();
loadProjects();
showView();
loadComposerModels();
setInterval(refreshRunningTasks, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRunningTasks(); });
