'use strict';

// Use Monaco's matching semantics without replacing the file editor or its undo history.
window.createProjectFileFind = panel => {
  const bar = document.createElement('div');
  bar.className = 'pf-find';
  bar.hidden = true;
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', '在当前文件中查找');
  const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  bar.innerHTML = `<input aria-label="查找文件内容" placeholder="查找" spellcheck="false"><button data-option="case" title="区分大小写" aria-label="区分大小写" aria-pressed="false">Aa</button><button data-option="word" title="全字匹配" aria-label="全字匹配" aria-pressed="false">ab</button><button data-option="regex" title="使用正则表达式" aria-label="使用正则表达式" aria-pressed="false">.*</button><span class="pf-find-count" role="status" aria-live="polite"></span><button data-find="previous" title="上一项 (Shift+Enter)" aria-label="上一项">${svg('m6 14 6-6 6 6')}</button><button data-find="next" title="下一项 (Enter)" aria-label="下一项">${svg('m6 10 6 6 6-6')}</button><button data-find="close" title="关闭查找 (Esc)" aria-label="关闭查找">${svg('m6 6 12 12M18 6 6 18')}</button>`;
  panel.querySelector('[data-pf="save-edits"]').before(bar);
  const input = bar.querySelector('input'), count = bar.querySelector('.pf-find-count');
  const preview = panel.querySelector('.pf-preview');
  let model, matches = [], index = -1, revision = 0, timer;
  const options = { case: false, word: false, regex: false };
  const content = () => preview.querySelector('.pf-editor') || preview.querySelector('.pf-markdown');
  const clearHighlight = () => CSS.highlights?.delete('pf-find-current');
  const close = () => {
    bar.hidden = true; revision++; clearTimeout(timer); clearHighlight();
    model?.dispose(); model = null; matches = []; index = -1;
  };
  const reveal = () => {
    count.textContent = matches.length ? `${index + 1} / ${matches.length}${matches.length === 10000 ? '+' : ''}` : input.value ? '无结果' : '';
    bar.querySelectorAll('[data-find="next"], [data-find="previous"]').forEach(button => button.disabled = !matches.length);
    clearHighlight();
    if (index < 0) return;
    let target = content();
    const range = matches[index].range;
    if (!target) return;
    const start = model.getOffsetAt(range.getStartPosition()), end = model.getOffsetAt(range.getEndPosition());
    if (target.matches('textarea')) {
      target.setSelectionRange(start, end);
      const style = getComputedStyle(target), height = parseFloat(style.lineHeight);
      target.scrollTop = Math.max(0, (range.startLineNumber - 1) * height - target.clientHeight / 2);
      target.scrollLeft = Math.max(0, (range.startColumn - 1) * height * .56 - target.clientWidth / 2);
      const reference = preview.querySelector('.pf-reference');
      if (reference) reference.hidden = true;
      target = preview.querySelector('.pf-editor-highlight code');
    }
    if (target) {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const selection = document.createRange();
      let node, offset = 0, started = false;
      while ((node = walker.nextNode())) {
        const next = offset + node.length;
        if (!started && start <= next) { selection.setStart(node, start - offset); started = true; }
        if (started && end <= next) { selection.setEnd(node, end - offset); break; }
        offset = next;
      }
      if (started && node) {
        if (CSS.highlights && window.Highlight) CSS.highlights.set('pf-find-current', new Highlight(selection));
        const rect = selection.getBoundingClientRect(), box = preview.getBoundingClientRect();
        if (target.matches('.pf-markdown')) preview.scrollTop += rect.top - box.top - box.height / 2;
      }
    }
  };
  const search = async () => {
    const request = ++revision;
    clearHighlight();
    const target = content();
    if (bar.hidden) return;
    if (!target) { close(); return; }
    try {
      const monaco = await window.YanReviewEditor.load();
      if (request !== revision || bar.hidden) return;
      const text = target.matches('textarea') ? target.value : target.textContent;
      if (!model) model = monaco.editor.createModel(text, 'plaintext');
      else if (model.getValue() !== text) model.setValue(text);
      if (options.regex && input.value) new RegExp(input.value);
      matches = input.value ? model.findMatches(input.value, false, options.regex, options.case, options.word ? '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?' : null, false, 10000) : [];
      index = matches.length ? 0 : -1;
      input.removeAttribute('aria-invalid');
      reveal();
    } catch (error) {
      if (request !== revision) return;
      matches = []; index = -1; reveal();
      count.textContent = options.regex ? '正则无效' : '查找不可用';
      input.setAttribute('aria-invalid', 'true');
      count.title = error.message;
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(search, 120); };
  input.addEventListener('input', schedule);
  panel.addEventListener('input', event => { if (event.target.matches('.pf-editor')) schedule(); });
  bar.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.option) {
      const option = button.dataset.option;
      options[option] = !options[option]; button.setAttribute('aria-pressed', String(options[option]));
      void search();
    } else if (button.dataset.find === 'close') { close(); content()?.focus(); return; }
    else if (matches.length) { index = (index + (button.dataset.find === 'previous' ? matches.length - 1 : 1)) % matches.length; reveal(); }
    input.focus();
  });
  bar.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); bar.querySelector(`[data-find="${event.shiftKey ? 'previous' : 'next'}"]`).click(); }
  });
  document.addEventListener('keydown', event => {
    if (!panel.getClientRects().length || !content()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation();
      const target = content();
      if (target.matches('textarea') && target.selectionEnd > target.selectionStart) {
        const text = target.value.slice(target.selectionStart, target.selectionEnd);
        if (!text.includes('\n')) input.value = text;
      }
      bar.hidden = false; input.focus(); input.select(); void search();
    } else if (event.key === 'Escape' && !bar.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); close(); content()?.focus();
    }
  }, true);
  new MutationObserver(() => { if (!bar.hidden) schedule(); }).observe(preview, { childList: true });
  return { close };
};
