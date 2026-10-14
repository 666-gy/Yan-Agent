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
  window.YanMemorySettings = { sync };
})();
