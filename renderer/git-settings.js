/* Settings keeps its DOM while parked outside document. */
function syncGitPreferences() {
  const prefs = { branchPrefix: 'yan/', mergeMethod: 'merge', forceWithLease: false, draftPr: true, reviewMode: 'inline', autoMerge: false, reviewInstructions: '', monitorInstructions: '', commitInstructions: '', prInstructions: '', ...state.config?.git };
  settingsOverlay.querySelectorAll('[data-git-setting]').forEach(control => {
    const value = prefs[control.dataset.gitSetting];
    if (control.tagName === 'BUTTON') {
      const active = value === control.dataset.value;
      control.classList.toggle('active', active);
      control.setAttribute('aria-pressed', String(active));
    } else if (control.type === 'checkbox') control.checked = value;
    else if (!control.dataset.dirty) control.value = value;
  });
}

let gitPreferenceSave = Promise.resolve();
function bindGitPreferences() {
  settingsOverlay.querySelectorAll('[data-git-setting]').forEach(control => {
    if (control.dataset.bound) return;
    control.dataset.bound = 'true';
    if (control.tagName === 'TEXTAREA') control.addEventListener('input', () => { control.dataset.dirty = 'true'; });
    control.addEventListener(control.tagName === 'BUTTON' ? 'click' : 'change', () => {
      const key = control.dataset.gitSetting;
      const value = control.tagName === 'BUTTON' ? control.dataset.value : control.type === 'checkbox' ? control.checked : control.value;
      if (control.tagName !== 'TEXTAREA') control.disabled = true;
      gitPreferenceSave = gitPreferenceSave.then(async () => {
        try {
          state.config = await api.setConfig({ git: { [key]: value } });
          if (control.value === value) delete control.dataset.dirty;
          if (key === 'reviewInstructions') settingsOverlay.querySelector('#reviewInstructionsSaveStatus').textContent = '已保存';
          if (key === 'draftPr' && $('#taskGitPrDraft')) $('#taskGitPrDraft').checked = value;
        } catch (error) { toast(`Git 设置保存失败：${error.message}`); if (key === 'reviewInstructions') settingsOverlay.querySelector('#reviewInstructionsSaveStatus').textContent = '保存失败，请重试'; }
        finally { control.disabled = false; syncGitPreferences(); }
      });
    });
  });
}

async function startGitPrMonitor(button) {
  if (button.disabled) return;
  const number = Number(button.dataset.taskGitPrMonitor);
  const workspace = currentGitWorkspace();
  const selection = normalizeModelSelectionSnapshot(getAgentModelSelection());
  if (!workspace || !Number.isSafeInteger(number) || number < 1) return;
  if (selection.modelType !== 'text') { toast('请先切换到文本模型'); return; }
  button.disabled = true;
  try {
    closeTaskGitPanel();
    // A dedicated task keeps monitoring independent of the current chat/draft.
    const previousSessionId = state.currentSession?.id;
    await newSession({ forceNew: true });
    if (!state.currentSession || state.currentSession.id === previousSessionId) throw new Error('未能创建监控聊天');
    state.currentSession.workspace = workspace;
    state.currentSession.title = `监控 PR #${number}`;
    await saveCurrentSession();
    await submitMessage(`/monitor-pr ${number}`, [], [], { modelSelection: selection, subagentRoles: [] });
  } catch (error) { toast(`无法启动 PR 监控：${error.message}`); }
  finally { button.disabled = false; }
}

async function generateGitPrDescription() {
  const button = $('#taskGitPrGenerateBtn');
  if (!button || button.disabled || button.getAttribute('aria-busy') === 'true') return;
  const workspace = currentGitWorkspace();
  if (!workspace) { toast('请先选择工作区'); return; }
  const selection = getAgentModelSelection();
  if (selection.modelType !== 'text' || !selection.providerId || !selection.modelId) { toast('请先配置文本模型'); return; }
  const title = $('#taskGitPrTitle'), body = $('#taskGitPrBody');
  const originalTitle = title.value, originalBody = body.value;
  const base = String($('#taskGitPrBase')?.value || '').trim();
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const runCtx = createRunCtx(`git-pr-description:${state.currentSession?.id || 'draft'}`, false, workspace);
    runCtx.utility = true;
    const session = { id: runCtx.sessionId, title: 'Pull Request 说明', workspace, messages: [{ role: 'user', content: [
      '只生成 Pull Request 标题和描述，不创建 PR，不提交、推送或修改任何文件。',
      `目标分支：${JSON.stringify(base || '自动检测远程默认分支')}。先通过只读 Git 命令确认当前分支、目标分支、共同祖先和两者之间的提交及差异。不要用未提交改动代替 PR 的提交差异；无法确认差异时报告错误，不编造。`,
      '遵循 Git 设置中的 Pull Request 说明指引。没有额外指引时，用中文概述变更、原因和实际验证结果。',
      '仅返回 JSON 对象 {"title":"标题","body":"描述"}，不要代码围栏。'
    ].join('\n') }] };
    const result = await runOpenCodeLoop(session, null, runCtx);
    const parsed = JSON.parse(String(result?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (typeof parsed.title !== 'string' || !parsed.title.trim() || typeof parsed.body !== 'string') throw new Error('模型未返回有效的标题和描述');
    if (workspace !== currentGitWorkspace() || title.value !== originalTitle || body.value !== originalBody) {
      toast('工作区或草稿已变化，未覆盖当前内容'); return;
    }
    title.value = parsed.title.trim().slice(0, 160);
    body.value = parsed.body;
  } catch (error) { toast(`生成 PR 说明失败：${error.message}`); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}

async function startGitReview(command) {
  const selection = normalizeModelSelectionSnapshot(getAgentModelSelection());
  if (selection.modelType !== 'text') { toast('请先切换到文本模型再进行审查'); return; }
  const attachments = state.attachments.slice();
  const scope = String(command).replace(/^\/review\s*/i, '').trim();
  const separate = state.config?.git?.reviewMode === 'separate' || isCurrentSessionExecutionActive();
  clearComposerPayload();
  if (separate) await newSession({ forceNew: true });
  const prompt = '请审查当前工作区的代码改动。只读检查，不修改文件、不提交、不推送。' +
    '先查看 Git 状态和差异，按严重程度报告有证据的缺陷，标明文件和行号、触发条件与影响；没有发现问题时明确说明，并说明验证局限。' +
    (scope ? `\n审查范围与要求：${scope}` : '\n默认审查当前未提交改动；如果没有改动，先说明情况，不擅自扩大范围。');
  const instructions = String(state.config?.git?.reviewInstructions || '').trim();
  const reviewPrompt = prompt + (instructions ? '\n默认审查指令（本次明确要求优先）：\n' + instructions : '');
  await submitMessage(reviewPrompt, attachments, [], { modelSelection: selection, subagentRoles: [] });
}

async function mergeGitPullRequest(button) {
  if (button.disabled) return;
  const workspace = currentGitWorkspace();
  const number = Number(button.dataset.taskGitPrMerge);
  const label = state.config?.git?.mergeMethod === 'squash' ? '压缩合并' : '合并';
  button.disabled = true;
  try {
    if (!await requestGenericConfirmation({ title: `${label} PR #${number}？`, description: '此操作将把 Pull Request 合并到远程目标分支。', confirmLabel: label })) return;
    const result = await api.ghPrMerge(workspace, number);
    if (!result?.ok) throw new Error(result?.error || '合并失败');
    toast(`已合并 PR #${number}`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
