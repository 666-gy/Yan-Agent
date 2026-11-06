/* Memory settings use the same persisted preferences as run admission. */
(() => {
  const page = document.querySelector('#tab-memory');
  const input = page.querySelector('#memoryInstructions');
  const save = page.querySelector('#memorySave');
  const toggle = page.querySelector('#memoryEnabled');
  const dialog = page.querySelector('#memoryDeleteDialog');
  let saved = '', busy = false, initialized = false;
  function update() { save.disabled = busy || input.value === saved; toggle.disabled = busy; }
  function sync() {
    const memory = state.config?.memory || {};
    if (!initialized || input.value === saved) input.value = memory.instructions || '';
    saved = memory.instructions || '';
    toggle.checked = memory.enabled !== false;
    initialized = true;
    update();
  }
  async function persist(partial) {
    busy = true; update();
    try {
      state.config = await api.setConfig({ memory: partial });
      saved = state.config.memory.instructions;
    } catch (error) { toast(`保存失败：${error.message}`, { error: true }); }
    finally { busy = false; toggle.checked = state.config?.memory?.enabled !== false; update(); }
  }
  input.addEventListener('input', update);
  save.addEventListener('click', () => persist({ instructions: input.value }));
  toggle.addEventListener('change', () => persist({ enabled: toggle.checked }));
  page.querySelector('#memoryDelete').addEventListener('click', () => dialog.showModal());
  page.querySelector('#memoryDeleteCancel').addEventListener('click', () => dialog.close());
  page.querySelector('#memoryDeleteConfirm').addEventListener('click', async event => {
    event.target.disabled = true;
    try {
      await api.clearMemories();
      dialog.close(); toast('已删除所有记忆');
    } catch (error) { dialog.close(); toast(`删除失败：${error.message}`, { error: true }); }
    finally { event.target.disabled = false; }
  });
  const sessionDialog = document.createElement('dialog');
  sessionDialog.id = 'sessionMemoryDialog';
  sessionDialog.className = 'perm-dialog session-memory-dialog';
  sessionDialog.setAttribute('aria-labelledby', 'sessionMemoryTitle');
  sessionDialog.innerHTML = `<h3 id="sessionMemoryTitle" class="perm-dialog-title">本会话的记忆</h3>
    <div class="memory-settings-row"><div><label for="sessionMemoryUse">使用记忆</label><p>对话开始后无法更改</p></div><input id="sessionMemoryUse" type="checkbox" class="switch" role="switch" aria-describedby="sessionMemoryHint"></div>
    <div class="memory-settings-row" id="sessionMemoryWriteRow"><div><label for="sessionMemoryWrite">生成记忆</label><p>允许 Yan Agent 在本会话里创建记忆</p></div><input id="sessionMemoryWrite" type="checkbox" class="switch" role="switch"></div>
    <p id="sessionMemoryHint" class="perm-dialog-desc" aria-live="polite"></p>
    <div class="perm-dialog-actions"><button type="button" class="secondary-btn" id="sessionMemoryClose">完成</button></div>`;
  document.body.append(sessionDialog);
  const use = sessionDialog.querySelector('#sessionMemoryUse');
  const write = sessionDialog.querySelector('#sessionMemoryWrite');
  let session = null, saving = false;
  function syncSession() {
    const active = isSessionExecutionActive(session?.id);
    use.checked = session?.memoryEnabled ?? (state.config?.memory?.enabled !== false);
    write.checked = session?.memoryWriteEnabled !== false;
    use.disabled = saving || active || !!(session?.totalMessages || session?.messages?.length);
    write.disabled = saving || active;
    sessionDialog.querySelector('#sessionMemoryWriteRow').hidden = !use.checked;
    sessionDialog.querySelector('#sessionMemoryHint').textContent = active ? '任务运行中，请在本轮结束后修改。' : '';
  }
  async function persistSession(key, value) {
    if (!session || saving) return;
    const target = session;
    const previous = target[key];
    target[key] = value;
    saving = true; syncSession();
    try {
      const savedSession = await api.saveSession(buildSessionSavePayload(target));
      if (savedSession?.ok === false) throw new Error(savedSession.error);
      if (typeof savedSession?.memoryEnabled === 'boolean') target.memoryEnabled = savedSession.memoryEnabled;
    } catch (error) {
      target[key] = previous;
      toast(`保存失败：${error.message}`, { error: true });
    } finally { saving = false; syncSession(); }
  }
  use.addEventListener('change', () => void persistSession('memoryEnabled', use.checked));
  write.addEventListener('change', () => void persistSession('memoryWriteEnabled', write.checked));
  sessionDialog.querySelector('#sessionMemoryClose').addEventListener('click', () => sessionDialog.close());
  async function openSession() {
    if (!state.currentSession) await newSession();
    session = state.currentSession;
    if (!session) return;
    syncSession();
    sessionDialog.showModal();
  }
  window.YanMemorySettings = { sync, openSession };
})();
