'use strict';
// Copy the desktop workspace strip and picker; omit search and project creation.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../renderer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'agent-shell.css'), 'utf8');
const base = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const slice = (text, start, end) => {
  // CSS selectors must start a line, not match the tail of a longer selector.
  const at = start.startsWith('<') ? text.indexOf(start) : text.indexOf('\n' + start) + 1;
  const stop = text.indexOf(end, at + start.length);
  if (at < 0 || (!start.startsWith('<') && at === 0) || stop < 0) throw new Error(`Missing component boundary: ${start}`);
  return text.slice(at, stop);
};
let markup = slice(html, '<div id="taskBarFolderWrap"', '<button id="taskGitPrToggleBtn"').trim();
markup = markup.replace(/\s*<button id="taskBarNewTask"[\s\S]*?<\/button>/, '')
  .replace(/\s*<label class="workspace-choice-search">[\s\S]*?<\/label>/, '')
  .replace(/\s*<button[^>]*data-workspace-choice="pick"[\s\S]*?<\/button>/, '');
const strip = `<div id="newTaskWorkspace" class="new-task-workspace" aria-label="任务工作区"><div class="new-task-workspace-slot">${markup}</div></div>`;
const file = path.join(root, 'webui/index.html');
let page = fs.readFileSync(file, 'utf8');
page = page.replace(/\s*<div id="workspacePickerWrap"[\s\S]*?<\/section>\s*<\/div>/, '');
if (!page.includes('id="newTaskWorkspace"')) page = page.replace('    <form id="taskComposer"', `    ${strip}\n    <form id="taskComposer"`);
if (!page.includes('desktop-workspace.css')) page = page.replace('<link rel="stylesheet" href="messages.css">', '<link rel="stylesheet" href="messages.css">\n  <link rel="stylesheet" href="desktop-workspace.css">');
fs.writeFileSync(file, page);
let css = slice(base, '.task-bar-folder-wrap {', '.task-bar-folder.task-bar-folder-empty {')
  + slice(base, '.task-bar-folder-name {', '/* Locked task:')
  + '.task-bar-folder-open-glyph { display: none; }\n'
  + slice(base, '.workspace-choice-menu {', '.task-bar-right {')
  + slice(shell, '.app:not(.browser-focus-mode) #pageChat.empty .new-task-workspace:not([hidden]) {', '/* Dedicated branch picker')
  + slice(shell, '.new-task-workspace #taskBarFolderWrap {', '.workspace-choice-search {')
  + slice(shell, '.app .workspace-choice-item {', '.app.wallpaper-enabled.wallpaper-compat .workspace-choice-menu {');
css = css.replaceAll('.app:not(.browser-focus-mode) #pageChat.empty ', '').replaceAll('.app ', '');
fs.writeFileSync(path.join(root, 'webui/desktop-workspace.css'), `/* Copied from styles.css and agent-shell.css by sync-webui-workspace.cjs. */
.new-task-workspace {
  --text: var(--ink); --text-dim: var(--muted); --text-muted: var(--muted);
  --border: var(--composer-rule); --border-strong: var(--composer-rule);
  --bg-elev: var(--composer-surface); --bg-elev2: var(--hover); --bg-hover: var(--hover);
  --r-lg: 14px; --r-pill: 999px; --ui-scale: 14px; --color-focus: var(--muted);
  --shadow-lg: 0 8px 32px var(--shadow);
}
${css}
/* Adapt only the strip's width to the standalone WebUI composer. */
#newTaskWorkspace { flex: 0 0 32px; align-self: center; width: calc(100% - 48px); max-width: 712px; }
.workspace-choice-item { border: 0; background: transparent; }
.new-task-workspace-slot { max-width: 100%; }
`);
