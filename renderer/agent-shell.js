'use strict';

// Reuse the existing workspace control and handlers in the new-task composer.
// Once submitted, return the same node to the task bar for its locked behavior.
window.YanAgentShell = (() => {
  let home = null;
  document.getElementById('taskBarNewTask')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try { await newSession(); }
    catch (error) { toast(error?.message || '新建任务失败'); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  });

  function sync(empty) {
    const control = document.getElementById('taskBarFolderWrap');
    const slot = document.getElementById('newTaskWorkspaceSlot');
    const sheet = document.getElementById('newTaskWorkspace');
    if (!control || !slot || !sheet) return;
    if (!home) {
      home = document.createComment('task workspace control');
      control.before(home);
    }
    if (empty && control.parentElement !== slot) slot.appendChild(control);
    if (!empty && control.parentElement === slot) home.after(control);
    sheet.hidden = !empty;
    if (!empty) {
      document.getElementById('workspaceChoiceMenu')?.classList.add('hidden');
      document.getElementById('taskBarFolder')?.setAttribute('aria-expanded', 'false');
    }
  }

  // Keyline folder-open (stroke), from the user-selected icon.
  const workspaceFolderIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.842 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11"/></svg>';
  function renderWorkspaceChoices() {
    const list = document.getElementById('workspaceChoiceRecent');
    const query = document.getElementById('workspaceChoiceSearch').value.trim().toLocaleLowerCase();
    const groups = new Map();
    for (const session of state.sessions) {
      const workspace = String(session.workspace || '').trim();
      const key = workspaceGroupKey(workspace);
      if (!workspace || workspaceSidebarMeta[key]?.hidden) continue;
      const latest = Number(session.updatedAt) || 0;
      if (!groups.has(key) || latest > groups.get(key).latest) {
        groups.set(key, { key, workspace, label: workspaceGroupLabel(workspace), latest });
      }
    }
    const recent = [...groups.values()].sort((a, b) => b.latest - a.latest)
      .filter(group => group.label.toLocaleLowerCase().includes(query) || group.workspace.toLocaleLowerCase().includes(query))
      .slice(0, 3);
    list.replaceChildren();
    for (const group of recent) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'workspace-choice-item';
      button.dataset.workspaceChoice = 'recent';
      button.dataset.workspace = group.workspace;
      button.title = group.workspace;
      button.setAttribute('aria-pressed', String(group.key === workspaceGroupKey(state.currentSession)));
      button.innerHTML = workspaceFolderIcon;
      const label = document.createElement('span');
      label.textContent = group.label;
      label.setAttribute('translate', 'no');
      button.appendChild(label);
      list.appendChild(button);
    }
    if (!recent.length) {
      const empty = document.createElement('div');
      empty.className = 'workspace-choice-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = query ? '未找到匹配项目' : '暂无最近工作区';
      list.appendChild(empty);
    }
  }
  function openWorkspaceChoices() {
    const search = document.getElementById('workspaceChoiceSearch');
    search.value = '';
    renderWorkspaceChoices();
    search.focus({ preventScroll: true });
  }
  document.getElementById('workspaceChoiceSearch')?.addEventListener('input', renderWorkspaceChoices);
  document.getElementById('taskBarFolderWrap')?.addEventListener('focusout', event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeWorkspaceChoiceMenu();
  });

  function menuKeyboard(event) {
    const wrap = event.target.closest('#taskBarFolderWrap');
    if (!wrap) return;
    const trigger = document.getElementById('taskBarFolder');
    const menu = document.getElementById('workspaceChoiceMenu');
    if (!menu || !trigger.hasAttribute('aria-haspopup')) return;
    if (event.key === 'Escape') {
      if (!menu.classList.contains('hidden')) trigger.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (event.target.id === 'workspaceChoiceSearch' && ['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (menu.classList.contains('hidden')) trigger.click();
      const items = [...menu.querySelectorAll('button:not(:disabled)')];
      const current = items.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' || (current < 0 && event.key === 'ArrowUp') ? items.length - 1
        : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[index]?.focus();
    }
  }
  document.addEventListener('keydown', menuKeyboard);

  function composerCeiling(lines, minimum) {
    const composer = document.getElementById('composer');
    const input = document.getElementById('composerInput');
    if (!composer || !input) return minimum;
    const style = getComputedStyle(input);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const chrome = composer.getBoundingClientRect().height - input.getBoundingClientRect().height;
    return Math.max(minimum, Math.ceil(chrome + padding + lines * parseFloat(style.lineHeight)));
  }

  // Observe width changes as well as first layout: soft-wrapped text can cross
  // six visible lines when the sidebar opens or the window becomes narrower.
  const foldedBodies = new Map();
  let foldFrame = 0;
  const foldObserver = new ResizeObserver(entries => {
    for (const { target } of entries) updateFold(target);
  });
  function updateFold(body) {
    const entry = foldedBodies.get(body);
    if (!entry || !body.isConnected) return;
    const { content, button, message } = entry;
    const limit = 6 * parseFloat(getComputedStyle(content).lineHeight);
    button.hidden = content.scrollHeight <= limit + 1;
    if (button.hidden) {
      message.classList.remove('is-expanded');
      button.textContent = '展开';
      button.setAttribute('aria-expanded', 'false');
    }
  }
  function foldUserMessage(message) {
    const body = message.querySelector('.msg-body');
    if (!body || foldedBodies.has(body)) return;
    const content = document.createElement('div');
    content.className = 'user-message-content';
    while (body.firstChild) content.appendChild(body.firstChild);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'user-message-toggle';
    button.textContent = '展开';
    button.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const expanded = message.classList.toggle('is-expanded');
      button.textContent = expanded ? '收起' : '展开';
      button.setAttribute('aria-expanded', String(expanded));
      if (!expanded) message.scrollIntoView({ block: 'nearest' });
    });
    body.append(content, button);
    foldedBodies.set(body, { content, button, message });
    foldObserver.observe(body);
    if (!foldFrame) foldFrame = requestAnimationFrame(() => {
      foldFrame = 0;
      for (const [node] of foldedBodies) {
        if (!node.isConnected) { foldObserver.unobserve(node); foldedBodies.delete(node); }
        else updateFold(node);
      }
    });
  }
  function clearFoldedMessages() {
    foldObserver.disconnect();
    foldedBodies.clear();
    if (foldFrame) cancelAnimationFrame(foldFrame);
    foldFrame = 0;
  }
  return Object.freeze({ sync, openWorkspaceChoices, composerCeiling, foldUserMessage, clearFoldedMessages });
})();
