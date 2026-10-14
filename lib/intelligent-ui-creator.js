'use strict';

const MAX_HTML_BYTES = 160 * 1024;
const OPENUI = require('./intelligent-ui/openui-library.cjs');
const MAX_IMAGES = 12;
const MAX_IMAGE_URL_LENGTH = 2048;
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'images.unsplash.com', 'images.pexels.com']);
const DESIGN_SKILL = require('node:fs').readFileSync(require('node:path').join(__dirname, 'intelligent-ui', 'SKILL.md'), 'utf8');
const TOOL = {
  name: 'intelligent_ui_creator',
  description: 'Intelligent UI Creator: build a compact task-specific mini-app inline in the Agent response so the user can plan, choose, configure or practice without switching apps. Meaningful controls change the task object/state and produce a useful result. First call action=start with title, purpose and placement as soon as the benefit is clear, BEFORE designing/code generation. Read the returned design skill, then call action=render with format=openui and code for registered components, or format=html and self-contained HTML (inline CSS/JS) for custom programs. One mini-app per task turn; further render calls update it. No write or browser tool needed. Available only with the Labs opt-in.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      task_id: { type: 'string', description: 'Exact task_id from the current yan-turn-context.' },
      action: { type: 'string', enum: ['start', 'render'] },
      title: { type: 'string', maxLength: 100, description: 'Required for start: short user-facing title.' },
      purpose: { type: 'string', maxLength: 500, description: 'Required for start: the task object, what the user can do with it and the useful result they can reach.' },
      placement: { type: 'string', enum: ['during_work', 'final'], description: 'Required for start: useful now, or accompanies the final answer.' },
      format: { type: 'string', enum: ['html', 'openui'], description: 'Use openui for the registered map/itinerary, adjustable budget and choice components; html for custom mini-apps such as games or physical demonstrations. Default html for backward compatibility.' },
      handoff: { type: 'boolean', description: 'Optional for OpenUI render only, default false. Show Bring back to chat only when the result is needed for a concrete next conversation step. Ordinary preview, exploration and learning do not need it.' },
      code: { type: 'string', maxLength: 65536, description: 'Required for format=openui render: OpenUI Lang following the contract returned by start. Mutually exclusive with html.' },
      html: { type: 'string', maxLength: MAX_HTML_BYTES, description: 'Required for render: complete mini-app HTML fragment with inline CSS and JavaScript. Host APIs are limited to documented window.yanUi capabilities; declare map/photos in resources.' },
      resources: {
        type: 'object', additionalProperties: false,
        description: 'Optional for render only. Request the host-provided map (locally bundled MapLibre GL JS with the fixed OpenFreeMap Positron style) and declare complete HTTPS photo URLs already found in research. Image CSP restricts origin/path, not individual query parameters. This does not grant general-purpose fetch, remote scripts or arbitrary network access. Omission clears previous resource grants.',
        properties: {
          map: { type: 'boolean', description: 'Enable the local map library and fixed tiles.openfreemap.org style/tile/font/sprite resources, starting from /styles/positron. Preserve OpenFreeMap, OpenMapTiles and OpenStreetMap contributors attribution.' },
          images: { type: 'array', maxItems: MAX_IMAGES, items: { type: 'string', maxLength: MAX_IMAGE_URL_LENGTH }, description: 'Exact HTTPS photo URLs from upload.wikimedia.org, images.unsplash.com or images.pexels.com. Up to 12; no credentials, non-443 ports or fragments.' }
        }
      }
    },
    required: ['task_id', 'action']
  }
};

function normalizeResources(input) {
  if (input === undefined) return { map: false, images: [] };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['map', 'images'].includes(key))
    || (Object.hasOwn(input, 'map') && typeof input.map !== 'boolean')
    || (Object.hasOwn(input, 'images') && !Array.isArray(input.images))) {
    throw new Error('resources 仅支持 map 布尔值与 images URL 数组。');
  }
  const images = input.images || [];
  if (images.length > MAX_IMAGES) throw new Error('resources.images 至多包含 12 张照片。');
  const normalized = images.map(value => {
    if (typeof value !== 'string' || !value || value.length > MAX_IMAGE_URL_LENGTH
      || value !== value.trim() || /[\u0000-\u0020\u007f\\#]/.test(value)) {
      throw new Error('照片 URL 必须是不带空白或片段、至多 2048 字符的 HTTPS 地址。');
    }
    let url;
    try { url = new URL(value); } catch { throw new Error('照片 URL 无效。'); }
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname) || url.username || url.password
      || (url.port && url.port !== '443') || url.hash || url.href.length > MAX_IMAGE_URL_LENGTH) {
      throw new Error('照片 URL 仅允许 upload.wikimedia.org、images.unsplash.com、images.pexels.com 的标准 HTTPS 地址。');
    }
    return url.href;
  });
  return { map: input.map === true, images: [...new Set(normalized)] };
}

function createIntelligentUi(active, runId, input) {
  if (!active?.intelligentUiAllowed) throw new Error('Intelligent UI 未启用，或当前任务不支持。');
  if (input.task_id !== runId) throw new Error('Intelligent UI 调用与当前任务不匹配。');
  if (input.format !== undefined && !['html', 'openui'].includes(input.format)) throw new Error('format 必须是 html 或 openui。');
  if (input.action === 'start') {
    if (Object.hasOwn(input, 'handoff')) throw new Error('handoff 只能在 OpenUI render 时声明。');
    if (Object.hasOwn(input, 'resources')) throw new Error('resources 只能在 render 时声明。');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
    if (!title || title.length > 100 || !purpose || purpose.length > 500
      || !['during_work', 'final'].includes(input.placement)) throw new Error('start 需要 title、明确收益 purpose 和 placement。');
    if (input.html || input.code) throw new Error('先用 start 告知用途，再通过 render 提交内容。');
    active.intelligentUi ||= { version: 1, id: runId, title, purpose, placement: input.placement, status: 'creating', revision: 0 };
    return { ok: true, intelligent_ui: { ...active.intelligentUi }, design_skill: DESIGN_SKILL, ...(input.format !== 'html' ? {openui_contract: OPENUI.prompt} : {}), next: 'Choose format=openui with code for the registered mini-app components; use format=html with html for custom programs. Follow the returned contract. Call render with the same task_id and required resources. No write or browser deliverable.' };
  }
  if (input.action !== 'render') throw new Error('action 必须是 start 或 render。');
  if (!active.intelligentUi) throw new Error('请先调用 action=start，让用户知道正在创建什么。');
  const html = typeof input.html === 'string' ? input.html.trim() : '';
  const format = input.format || 'html';
  if (Object.hasOwn(input, 'handoff') && (typeof input.handoff !== 'boolean' || format !== 'openui')) throw new Error('handoff 仅支持 OpenUI render 的布尔值。');
  if (format === 'openui' && Object.hasOwn(input, 'html') || format === 'html' && Object.hasOwn(input, 'code')) throw new Error('html 与 code 不能混用；请明确 format。');
  if (format === 'html' && (!html || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES || /^```/.test(html))) throw new Error('render 需要不带代码围栏、至多 160 KiB 的 HTML。');
  const resources = normalizeResources(input.resources);
  if (active.intelligentUiNetworkAllowed === false && (resources.map || resources.images.length)) {
    throw new Error('当前任务已关闭网络权限，不能加载地图或在线照片。');
  }
  if (format === 'openui') OPENUI.validateProgram(input.code, resources);
  const ui = active.intelligentUi;
  ui.format = format;
  ui.handoff = format === 'openui' && input.handoff === true;
  ui.status = 'ready';
  ui.revision += 1;
  ui.resources = resources;
  // HTML is already persisted in the tool input. Keep the acknowledgement small
  // so kernel output truncation cannot corrupt the renderer's acceptance record.
  return { ok: true, intelligent_ui: { ...ui }, output: '小程序已交付到当前回答。使用 yanUi 保存的选择与进度可在重开面板后恢复；交互不会自动提交给 Agent。这不是逻辑正确性或浏览器验收证明。' };
}

module.exports = { TOOL, MAX_HTML_BYTES, createIntelligentUi };
