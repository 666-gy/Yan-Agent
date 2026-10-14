'use strict';
// Copy the desktop component's markup and final styles without redesigning it.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const desktopHtml = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const desktopCss = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
const pagePath = path.join(root, 'renderer/webui/index.html');
let page = fs.readFileSync(pagePath, 'utf8');
const markupStart = desktopHtml.indexOf('<div id="modelPickerWrap"');
const markupEnd = desktopHtml.indexOf('<dialog id="modelPickerDialog"', markupStart);
const markup = desktopHtml.slice(markupStart, markupEnd).trimEnd() + '\n</div>';
page = page.replace(/<label class="model-pill"[\s\S]*?<\/label>/, markup);
if (!page.includes('desktop-composer.css')) page = page.replace('<link rel="stylesheet" href="webui.css">', '<link rel="stylesheet" href="webui.css">\n  <link rel="stylesheet" href="desktop-composer.css">');
fs.writeFileSync(pagePath, page);
const start = desktopCss.indexOf('.composer-toolbar-controls .model-picker-wrap {', desktopCss.indexOf('component: compact model + reasoning picker'));
const end = desktopCss.indexOf('/* Hallmark · component: delegation plan', start);
const sliderStart = desktopCss.indexOf('.reasoning-speed-slider-shell {');
const sliderEnd = desktopCss.indexOf('.work-mode-fluid::before', sliderStart);
const radius = desktopCss.match(/--r-xl:\s*[^;]+;/)[0];
const css = `/* Copied from renderer/styles.css by scripts/sync-webui-composer.cjs. */
:root { ${radius} --r-pill: 999px; }
#taskComposer {
  --text: var(--ink); --text-dim: var(--muted); --text-faint: var(--muted);
  --bg-hover: var(--hover); --bg-elev: var(--surface); --bg-elev2: var(--hover);
  --border: var(--rule); --border-strong: var(--composer-rule); --border-soft: var(--rule);
  --font-body: var(--font); --color-focus: var(--accent);
  --shadow: 0 8px 30px var(--glass-shadow);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1); --dur-micro: 120ms; --dur-short: 180ms;
}
.hidden { display: none !important; }
.ws-pill { display: inline-flex; align-items: center; cursor: pointer; }
${desktopCss.slice(sliderStart, sliderEnd)}
${desktopCss.slice(start, end)}
.composer-toolbar-controls .model-picker-wrap { margin-left: auto; max-width: calc(100% - 84px); }
.reasoning-speed-billing.is-empty { display: none; }
@keyframes modelSelectorMenuIn { from { opacity: 0; transform: translateY(4px) scale(.97); } to { opacity: 1; transform: none; } }
`;
fs.writeFileSync(path.join(root, 'renderer/webui/desktop-composer.css'), css);
const desktopJs = fs.readFileSync(path.join(root, 'renderer/renderer.js'), 'utf8');
const noticeStart = desktopJs.indexOf('let maxReasoningNoticeTimer = null;');
const noticeEnd = desktopJs.indexOf('function renderReasoningSpeedControl(', noticeStart);
fs.writeFileSync(path.join(root, 'renderer/webui/desktop-model-notice.js'), '// Copied unchanged from renderer/renderer.js.\n' + desktopJs.slice(noticeStart, noticeEnd));
const taskIcons = {};
for (const name of ['edit', 'pin', 'copy']) taskIcons[name] = desktopJs.match(new RegExp("  " + name + ": '([^']+)'"))[1];
fs.writeFileSync(path.join(root, 'renderer/webui/desktop-task-icons.js'), '// Copied from renderer/renderer.js.\nconst taskIcons = ' + JSON.stringify(taskIcons) + ';\n');
