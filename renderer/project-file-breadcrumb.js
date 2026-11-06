'use strict';

window.createProjectFileBreadcrumb = ({ host, getCache, loadDirectory, openFile, icon, folderIcon, chevron }) => {
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  host.innerHTML = '<nav class="pf-path-pill" aria-label="文件路径"></nav><div class="pf-path-menu" role="tree" aria-label="选择文件或文件夹" hidden></div>';
  const pill = host.firstChild, menu = host.lastChild;
  let cache, base = '', selected = '', expanded = new Set(), trigger, revision = 0;
  const close = () => {
    revision++;
    menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  };
  const render = () => {
    close();
    const current = getCache();
    if (!current) { pill.textContent = '请先打开一个任务'; return; }
    const root = current.root.replace(/\\/g, '/').replace(/\/$/, '');
    const parts = current.selected ? current.selected.split('/') : [];
    const drive = /^[a-z]:/i.exec(root)?.[0] || (root.startsWith('//') ? root.split('/').slice(0, 4).join('/') : '/');
    if (!parts.length) {
      pill.innerHTML = `<span class="pf-path-drive">${esc(drive)}</span>`;
      return;
    }
    const crumbs = parts.length ? [{ name: root.split('/').pop() || drive, path: '', parent: '' }, ...parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/'), parent: parts.slice(0, i).join('/') }))] : [{ name: drive, path: '', parent: '' }];
    pill.innerHTML = crumbs.map((crumb, index) => `${index ? '<span class="pf-path-separator">' + chevron(false) + '</span>' : ''}<button type="button" data-path="${esc(crumb.path)}" data-parent="${esc(crumb.parent)}" aria-haspopup="tree" aria-expanded="false" title="${esc(crumb.path || current.root)}"${index === crumbs.length - 1 ? ' aria-current="location"' : ''}>${esc(crumb.name)}</button>`).join('');
    pill.scrollLeft = pill.scrollWidth;
  };
  const paint = () => {
    const branch = (directory, depth) => (cache.dirs.get(directory) || []).map(entry => {
      const open = expanded.has(entry.path);
      return `<div role="none"><button type="button" role="treeitem" class="pf-path-row${entry.path === selected ? ' selected' : ''}" data-entry="${esc(entry.path)}" data-directory="${entry.directory}" style="--depth:${depth}" aria-level="${depth + 1}"${entry.directory ? ` aria-expanded="${open}"` : ''} aria-selected="${entry.path === selected}" title="${esc(entry.path)}"><span class="pf-chevron">${entry.directory ? chevron(open) : ''}</span>${entry.directory ? folderIcon : icon(entry.path)}<span>${esc(entry.name)}</span></button>${entry.directory && open ? `<div role="group" class="pf-path-children">${cache.dirs.has(entry.path) ? branch(entry.path, depth + 1) : '<div class="pf-path-message">正在加载…</div>'}</div>` : ''}</div>`;
    }).join('');
    menu.innerHTML = branch(base, 0) || '<div class="pf-path-message">此目录为空</div>';
  };
  pill.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    const same = trigger === button && !menu.hidden;
    close();
    if (same) return;
    trigger = button; cache = getCache();
    if (!cache) return;
    base = button.dataset.parent; selected = button.dataset.path;
    expanded = new Set();
    const directory = selected && selected !== cache.selected;
    if (directory) expanded.add(selected);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.innerHTML = '<div class="pf-path-message">正在加载…</div>';
    const rect = host.getBoundingClientRect();
    menu.style.width = Math.min(420, Math.max(220, window.innerWidth - rect.left - 18)) + 'px';
    menu.style.maxHeight = Math.max(100, Math.min(430, window.innerHeight - rect.bottom - 24)) + 'px';
    const request = revision;
    await loadDirectory(cache, base);
    if (directory) await loadDirectory(cache, selected);
    if (request !== revision || getCache() !== cache) return;
    paint();
    const active = [...menu.querySelectorAll('[data-entry]')].find(row => row.dataset.entry === selected);
    (active || menu.querySelector('button'))?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: 'nearest' });
  });
  menu.addEventListener('click', async event => {
    const row = event.target.closest('[data-entry]');
    if (!row || getCache() !== cache) return;
    const path = row.dataset.entry;
    if (row.dataset.directory !== 'true') { close(); void openFile(cache, path); return; }
    const request = revision;
    if (expanded.has(path)) expanded.delete(path);
    else {
      expanded.add(path); paint();
      await loadDirectory(cache, path);
    }
    if (request !== revision || getCache() !== cache) return;
    paint();
    [...menu.querySelectorAll('[data-entry]')].find(item => item.dataset.entry === path)?.focus({ preventScroll: true });
  });
  host.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.stopPropagation(); close(); trigger?.focus(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const rows = [...menu.querySelectorAll('button')];
      const index = rows.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      rows[next]?.focus();
    }
    if (['ArrowRight', 'ArrowLeft'].includes(event.key) && document.activeElement?.dataset.directory === 'true') {
      event.preventDefault();
      if ((event.key === 'ArrowRight') !== expanded.has(document.activeElement.dataset.entry)) document.activeElement.click();
    }
  });
  document.addEventListener('pointerdown', event => { if (!host.contains(event.target)) close(); });
  window.addEventListener('resize', close);
  return { render, close };
};
