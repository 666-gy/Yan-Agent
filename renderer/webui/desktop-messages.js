// Generated from desktop sources by scripts/sync-webui-messages.cjs.
window.YanWebMessages = (() => {
const ICONS = {"copy":"<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\"/></svg>","check":"<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\"><polyline points=\"20 6 9 17 4 12\"/></svg>","clock":"<svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/></svg>"};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const escapeAttr = escapeHtml;
const AGENT_URL_PATTERN = /(?:https?:\/\/|file:\/\/|www\.)[^\s<>"'`]+/gi;
const AGENT_MARKDOWN_LINK_PATTERN = /(?<!!)\[([^\]\r\n]+)\]\(\s*(?:<([^<>\r\n]+)>|((?:[^\s()<>]|\([^()\r\n]*\))+))(?:\s+["'][^\r\n]*?["'])?\s*\)/g;
const AGENT_MARKDOWN_IMAGE_PATTERN = /!\[([^\]\r\n]*)\]\(\s*([^\s<>"')]+)\s*\)/gi;


const THINKING_BOT_ICON = "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z\"></path><path d=\"M12 7.60279L12.4521 10.5685M15.9543 7L16.4064 9.96574\"></path></svg>";
function normalizeAgentImageUrl(value) {
  const url = String(value || '').trim();
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url.length <= 2000000 ? url : '';
  try { return new URL(url).protocol === 'https:' ? url : ''; } catch { return ''; }
}
function renderInlineEmphasis(escapedText) {
  return String(escapedText ?? '')
    .replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>');
}
function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
function renderMarkdownTables(t) {
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const sep = lines[i + 1];
    const isSep = sep != null && sep.includes('|') &&
      /-/.test(sep) && sep.replace(/[^|:\-\s]/g, '') === sep;
    if (header && header.includes('|') && isSep) {
      const parseRow = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const headers = parseRow(header);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        rows.push(parseRow(lines[j]));
        j++;
      }
      let html = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      html += rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
      html += '</tbody></table>';
      out.push(html);
      i = j - 1;
    } else {
      out.push(header);
    }
  }
  return out.join('\n');
}
function normalizeAgentUrl(value) {
  let url = String(value || '').trim();
  if (!url) return '';
  // Models commonly use absolute or workspace-relative paths in Markdown.
  // Encode path characters before treating them as a URL (# is a filename,
  // not a fragment), and accept optional source line/column suffixes.
  if (!/^(?:https?:|file:|www\.)/i.test(url)) {
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(url) && !/^[A-Za-z]:[\\/]/.test(url)) return '';
    const workspace = typeof state !== 'undefined'
      ? String(state.currentSession?.workspace || state.config?.workspace || '').replace(/\\/g, '/') : '';
    let filePath = url.replace(/\\/g, '/').replace(/:\d+(?::\d+)?$/, '');
    if (!/^(?:[A-Za-z]:\/|\/)/.test(filePath)) {
      if (!workspace || !/^(?:[A-Za-z]:\/|\/)/.test(workspace)) return '';
      filePath = `${workspace.replace(/\/$/, '')}/${filePath}`;
    }
    const encoded = filePath.split('/').map((part, index) => (
      index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
    )).join('/');
    url = `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
  }
  if (/^www\./i.test(url)) url = `https://${url}`;
  if (!/^(?:https?|file):/i.test(url)) return '';
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    if (!['http:', 'https:'].includes(protocol)) return '';
  } catch {
    return '';
  }
  return url;
}
function trimAgentUrlCandidate(value) {
  let url = String(value || '').trim();
  // Do not include sentence punctuation or unmatched closing brackets in links.
  url = url.replace(/[\u3002\uff0c\u3001\uff01\uff1f\uff1b\uff1a,.!?;:]+$/u, '');
  const countChar = (text, character) => {
    let count = 0;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === character) count++;
    }
    return count;
  };
  for (const [closing, opening] of [[')', '('], [']', '['], ['}', '{']]) {
    while (url.endsWith(closing) && countChar(url, closing) > countChar(url, opening)) {
      url = url.slice(0, -1);
    }
  }
  return url;
}
function buildAgentUrlLink(label, url) {
  const target = normalizeAgentUrl(url);
  if (!target) return escapeHtml(label);
  return `<a class="agent-output-link" href="${escapeAttr(target)}" data-yan-browser-link="${escapeAttr(target)}" rel="noreferrer">${escapeHtml(label)}</a>`;
}
function renderMarkdown(text, { softBreaks = false } = {}) {
  if (!text) return '';
  if (String(text).length > 200000) return `<pre>${escapeHtml(String(text))}</pre>`;
  // 先抽出代码块，避免其内部内容被后续规则误处理
  const codeBlocks = [];
  let t = String(text).replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  const inlineCodes = [];
  t = t.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\u0000INLINE${inlineCodes.length - 1}\u0000`;
  });
  const agentLinks = [];
  const agentImages = [];
  const math = window.YanMarkdownMath?.prepare(t);
  if (math) t = math.text;
  const saveAgentLink = (label, url) => {
    const restoreInlineLabel = value => String(value).replace(/\u0000INLINE(\d+)\u0000/g, (_, i) => inlineCodes[Number(i)] || '');
    const target = normalizeAgentUrl(restoreInlineLabel(url));
    if (!target) return null;
    agentLinks.push({ label: restoreInlineLabel(label), url: target });
    return `\u0000AGENTLINK${agentLinks.length - 1}\u0000`;
  };
  const saveAgentImage = (alt, url) => {
    const target = normalizeAgentImageUrl(url);
    if (!target) return null;
    agentImages.push({ alt: String(alt || 'Agent 图片').slice(0, 160), url: target });
    return `\u0000AGENTIMAGE${agentImages.length - 1}\u0000`;
  };
  // Preserve standard Markdown images before link auto-detection. External
  // images must be HTTPS; local images are restricted to the active workspace.
  t = t.replace(AGENT_MARKDOWN_IMAGE_PATTERN, (match, alt, url) => saveAgentImage(alt, url) || match);
  // Preserve explicit Markdown links before auto-linking bare URLs.
  t = t.replace(AGENT_MARKDOWN_LINK_PATTERN, (match, label, angledUrl, url) => saveAgentLink(label, angledUrl || url) || match);
  t = t.replace(AGENT_URL_PATTERN, match => {
    const source = trimAgentUrlCandidate(match);
    const token = saveAgentLink(source, source);
    return token ? token + match.slice(source.length) : match;
  });
  t = escapeHtml(t);
  t = t.replace(/\u0000INLINE(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(inlineCodes[Number(i)])}</code>`);
  // bold / italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
  // headers
  t = t.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  t = t.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  t = t.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  // tables (在列表/段落处理之前)
  t = renderMarkdownTables(t);
  // ordered lists — 用哨兵标记合并连续项为 <ol>
  t = t.replace(/^\s*\d+[.)]\s+(.*)$/gm, '\u0001$1\u0002');
  t = t.replace(/(\u0001[\s\S]*?\u0002(?:\s*\u0001[\s\S]*?\u0002)*)/g,
    m => '<ol>' + m.replace(/\u0001/g, '<li>').replace(/\u0002/g, '</li>').replace(/\s+/g, ' ') + '</ol>');
  // unordered lists — 合并连续的 <li> 为一个 <ul>
  t = t.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  t = t.replace(/(<li>[\s\S]*?<\/li>(?:\s*<li>[\s\S]*?<\/li>)*)/g, '<ul>$1</ul>');
  // paragraphs
  t = t.split(/\n{2,}/).map(block => {
    const b = block.trim();
    if (!b) return '';
    if (/^<(h\d|ul|ol|pre|li|table|blockquote)/.test(b)) return block;
    if (/^\u0000(?:CODE|AGENTIMAGE)\d+\u0000$/.test(b)) return block;
    // Skill documents often wrap source prose at 80 columns. Those soft
    // line breaks should reflow; explicit Markdown hard breaks still remain.
    const prose = softBreaks
      ? block.replace(/(?: {2,}|\\)\r?\n/g, '<br>').replace(/\r?\n/g, ' ')
      : block.replace(/\n/g, '<br>');
    return '<p>' + prose + '</p>';
  }).join('\n');
  // 还原代码块（内容做转义）
  t = t.replace(/\u0000CODE(\d+)\u0000/g, (_, i) =>
    `<div class="md-code-block"><span class="md-code-kind">纯文本</span><button type="button" class="md-code-copy" data-state="idle" aria-label="复制整段代码" aria-live="polite" title="复制整段代码">${ICONS.copy}</button><pre><code>${escapeHtml(codeBlocks[Number(i)])}</code></pre></div>`);
  t = t.replace(/\u0000AGENTLINK(\d+)\u0000/g, (_, i) => {
    const link = agentLinks[Number(i)];
    return link ? buildAgentUrlLink(link.label, link.url) : '';
  });
  t = t.replace(/\u0000AGENTIMAGE(\d+)\u0000/g, (_, i) => {
    const image = agentImages[Number(i)];
    if (!image) return '';
    return `<figure class="agent-markdown-image"><a class="agent-markdown-image-link" href="${escapeAttr(image.url)}" data-yan-browser-link="${escapeAttr(image.url)}" rel="noreferrer" aria-label="打开图片预览" title="打开图片预览"><img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a></figure>`;
  });
  return math ? math.restore(t) : t;
}
function buildTextRoundElement(content) {
  const roundEl = document.createElement('div');
  roundEl.className = 'msg-round';
  roundEl.innerHTML = renderMarkdown(content || '');
  return roundEl;
}
function buildThinkingElement(content, open = false) {
  const thinkEl = document.createElement('details');
  thinkEl.className = 'thinking-block';
  thinkEl.open = open;

  const summary = document.createElement('summary');
  const icon = document.createElement('span');
  icon.className = 'think-icon thinking-bot';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = THINKING_BOT_ICON;
  const label = document.createElement('span');
  label.className = 'thinking-label';
  label.textContent = '思考中';
  summary.append(icon, label);

  const text = document.createElement('div');
  text.className = 'thinking-text';
  text.textContent = content || '';
  thinkEl.append(summary, text);
  return thinkEl;
}
function formatMessageClock(value) {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
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

return { ICONS, escapeHtml, renderInlineEmphasis, renderMarkdown, buildTextRoundElement, buildThinkingElement, formatDuration, formatMessageClock, foldUserMessage, clearFoldedMessages };
})();
