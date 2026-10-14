'use strict';
// Keep the desktop's text rendering and message styling as the source of truth.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'renderer/renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer/styles.css'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'renderer/agent-shell.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'renderer/agent-shell.css'), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Desktop fragment missing: ' + start);
  return source.slice(a, b);
}
function fn(name) {
  const a = js.indexOf('function ' + name + '(');
  const b = js.indexOf('\n}', a);
  if (a < 0 || b < 0) throw new Error('Missing desktop function ' + name);
  return js.slice(a, b + 2);
}
const icons = {};
for (const name of ['copy', 'check', 'clock']) icons[name] = js.match(new RegExp("  " + name + ": '([^']+)'"))[1];
const functions = ['renderInlineEmphasis', 'formatDuration', 'renderMarkdownTables', 'normalizeAgentUrl', 'trimAgentUrlCandidate', 'buildAgentUrlLink', 'renderMarkdown', 'buildTextRoundElement', 'buildThinkingElement', 'formatMessageClock'];
let source = functions.map(fn).join('\n');
// A browser cannot open desktop file URLs. Keep those labels as text.
source = source.replace("['http:', 'https:', 'file:']", "['http:', 'https:']");
const folding = between(shell, 'const foldedBodies = new Map();', '  return Object.freeze');
fs.writeFileSync(path.join(root, 'renderer/webui/desktop-messages.js'), `// Generated from desktop sources by scripts/sync-webui-messages.cjs.
window.YanWebMessages = (() => {
const ICONS = ${JSON.stringify(icons)};
const escapeHtml = value => String(value ?? '').replace(/[&<>\"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
const escapeAttr = escapeHtml;
${between(js, 'const AGENT_URL_PATTERN', 'function normalizeAgentUrl')}
${js.match(/const THINKING_BOT_ICON = .*;/)[0]}
function normalizeAgentImageUrl(value) {
  const url = String(value || '').trim();
  if (/^data:image\\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url.length <= 2000000 ? url : '';
  try { return new URL(url).protocol === 'https:' ? url : ''; } catch { return ''; }
}
${source}
${folding}
return { ICONS, escapeHtml, renderInlineEmphasis, renderMarkdown, buildTextRoundElement, buildThinkingElement, formatDuration, formatMessageClock, foldUserMessage, clearFoldedMessages };
})();
`);
const fragments = [
  between(css, '.msg {', '.model-switch-notice {'),
  between(css, '.msg-body {', '/* Agent activity summary */'),
  between(css, '.agent-run-header {', '.agent-run-summary {'),
  between(css, '.agent-activity-body {', '/* Skill market'),
  between(css, '.msg.user .msg-body {', '.msg-skill-calls {'),
  between(css, '.msg-actions {', '/* 选中正文后的划词工具条 */'),
  between(css, '/* Prose / markdown in assistant messages */', '.msg-round.streaming'),
  between(css, '.msg-body.agent-output .tool-activity-group,', '.tool-command-panel {'),
  between(css, '.thinking-block {', '\n.gpt-thinking-chain {'),
  between(shellCss, '.user-message-content {', '.task-context-menu {')
];
fs.writeFileSync(path.join(root, 'renderer/webui/desktop-messages.css'), '/* Generated unchanged desktop message styles. */\n' + fragments.join('\n'));
// Tool names/icons share the desktop vocabulary; the WebUI controls disclosure.
const toolSource = between(js, 'const TOOL_UI = {', '// MCP detail rows');
fs.writeFileSync(path.join(root, 'renderer/webui/desktop-tool-ui.js'), '// Generated desktop tool names and icons.\n(() => {\n' + toolSource + fn('parseToolIdentity') + '\n' + fn('toolServerCategory') + '\nwindow.YanWebToolUI = { TOOL_UI, TOOL_ICON_SVG, TOOL_SERVER_UI, parseToolIdentity, toolServerCategory };\n})();\n');
