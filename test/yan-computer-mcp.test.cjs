'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createComputerAdapter } = require('../lib/yan-computer-mcp');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { ensureInstalled, PLUGIN_ID } = require('../lib/plugins/computer-use');
const { resolveSelectedPlugins } = require('../lib/plugins/selection');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=';

function fixture(t, imageInput) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-computer-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const client = {
    id: 0, closed: false,
    start: async () => ['get_window_state', 'click', 'install_extension'].map(name => ({
      name, description: name, inputSchema: { type: 'object', properties: { pid: { type: 'integer' } } }
    })),
    request: async (method, params) => {
      client.id++; calls.push({ method, params });
      return { content: [{ type: 'text', text: 'native state' }, { type: 'image', mimeType: 'image/png', data: png }],
        structuredContent: { capture_id: 'native-capture', elements: [{ element_token: 's12345678:1' }] } };
    },
    notify: async () => {}, close: async () => { client.closed = true; }
  };
  return { dir, client, calls, adapter: createComputerAdapter({ client, imageInput, imageDir: dir }) };
}

test('text-only screenshots retain native capture state and reuse existing read_image path', async t => {
  const f = fixture(t, false);
  const tools = await f.adapter.tools();
  assert.ok(tools.some(tool => tool.name === 'click'));
  assert.ok(!tools.some(tool => tool.name === 'install_extension'));
  const args = { pid: 123, window_id: 456, include_screenshot: true };
  const result = await f.adapter.call(1, 'get_window_state', args);
  assert.deepEqual(f.calls[0].params.arguments, args);
  assert.equal(result.structuredContent.capture_id, 'native-capture');
  assert.equal(result.content.some(block => block.type === 'image'), false);
  assert.match(result.content.at(-1).text, /yan_media_read_image/);
  const file = result.structuredContent.screenshot_paths[0];
  assert.ok(path.isAbsolute(file));
  assert.deepEqual(fs.readFileSync(file), Buffer.from(png, 'base64'));
  await assert.rejects(f.adapter.call(2, 'install_extension', {}), /Unsupported/);
});

test('multimodal screenshot bytes pass through without a visual backend call', async t => {
  const f = fixture(t, true);
  const result = await f.adapter.call(1, 'get_window_state', { pid: 123, window_id: 456 });
  assert.equal(result.content.find(block => block.type === 'image').data, png);
  assert.equal(f.calls.length, 1);
});

test('file-only capture cannot suppress configured image delivery', async t => {
  for (const imageInput of [true, false]) {
    const f = fixture(t, imageInput);
    f.client.start = async () => [{ name: 'get_window_state', description: 'Capture',
      inputSchema: { type: 'object', properties: { screenshot_out_file: { type: 'string' }, pid: { type: 'integer' } } } }];
    const originalRequest = f.client.request;
    f.client.request = (method, params) => params.arguments.screenshot_out_file
      ? Promise.resolve({ content: [{ type: 'text', text: 'saved to file only' }] })
      : originalRequest(method, params);
    const tools = await f.adapter.tools();
    assert.equal(Object.hasOwn(tools[0].inputSchema.properties, 'screenshot_out_file'), false);
    const args = { pid: 123, screenshot_out_file: 'capture.png' };
    const result = await f.adapter.call(1, 'get_window_state', args);
    assert.deepEqual(f.calls[0].params.arguments, { pid: 123 });
    assert.equal(args.screenshot_out_file, 'capture.png');
    assert.equal(result.content.some(block => block.type === 'image'), imageInput);
    assert.ok(fs.existsSync(result.structuredContent.screenshot_paths[0]));
  }
});

test('queued cancellation prevents input; native refusal is never retried', async t => {
  const f = fixture(t, false);
  f.adapter.cancel(2);
  await assert.rejects(f.adapter.call(2, 'click', { pid: 1 }), /取消/);
  assert.equal(f.calls.length, 0);
  f.client.request = async () => ({ isError: true, content: [{ type: 'text', text: 'background_unavailable' }] });
  const result = await f.adapter.call(3, 'click', { pid: 1 });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'background_unavailable');
});

test('plugin capability comes from the same user setting as provider image modalities', () => {
  for (const supported of [false, true]) {
    const config = buildOpenCodeConfig({ providerId: 'deepseek', modelId: 'deepseek-text-name',
      capabilities: { imageInput: supported } });
    assert.equal(new URL(config.plugin[0]).searchParams.get('yanComputerImageInput'), String(supported));
    assert.equal(config.provider.deepseek.models['deepseek-text-name'].modalities.input.includes('image'), supported);
  }
});

test('desktop progress watchdog recognizes both Cua tool name formats', () => {
  const { createRunPerformance, beginPerformanceRequest, observePerformanceEvent,
    probeDesktopActionProgress, summarizeRunPerformance } = require('../lib/open-code-stream');
  for (const tool of ['yan_computer_get_window_state', 'mcp__yan_computer__get_window_state',
    'yanp_1234567890abcdef_1234567890_computer_get_window_state']) {
    const performance = createRunPerformance(0);
    beginPerformanceRequest(performance, 0, 'computer-step');
    observePerformanceEvent(performance, {
      type: 'message.part.updated',
      data: { part: { messageID: 'computer-step', type: 'tool', tool,
        state: { status: 'completed' } } }
    }, 25_000);
    assert.equal(probeDesktopActionProgress(performance, 60_000, {
      windowMs: 30_000, graceMs: 1_000, minReasoningChars: 100
    }).stalled, false);
    assert.equal(summarizeRunPerformance(performance, {}, 60_000).firstDesktopProgressMs, 25_000);
  }
});

test('built-in plugin bootstraps ready and selectable while preserving disable and uninstall', {
  skip: process.platform !== 'win32' || process.arch !== 'x64'
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-computer-plugin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createPluginStore(dir);
  ensureInstalled(store);
  const plugin = createPluginCatalog(store).list().find(item => item.id === PLUGIN_ID);
  assert.equal(plugin.name, 'Yan Computer Use');
  assert.equal(plugin.installation.enabled, true);
  assert.equal(plugin.installation.ready, true);
  assert.equal(resolveSelectedPlugins(dir, [PLUGIN_ID])[0].name, 'Yan Computer Use');
  const registry = require('../lib/skill-registry');
  const cfg = { customSkills: [], disabledSkills: [] };
  const root = path.resolve(__dirname, '..');
  const skill = () => registry.getAllSkillsForCatalog(cfg, root, dir).find(item => item.id === PLUGIN_ID);
  assert.equal(skill().name, 'Computer Use');
  assert.equal(skill().enabled, true);
  assert.equal(registry.readSkill(PLUGIN_ID, '', cfg, root, dir).ok, true);
  store.update(PLUGIN_ID, { skill: { id: 'computer-use', enabled: false } });
  assert.equal(skill().enabled, false);
  assert.equal(registry.readSkill(PLUGIN_ID, '', cfg, root, dir).ok, false);
  store.update(PLUGIN_ID, { skill: { id: 'computer-use', enabled: true } });
  assert.equal(skill().enabled, true);
  store.update(PLUGIN_ID, { enabled: false });
  ensureInstalled(store);
  assert.equal(store.get(PLUGIN_ID).enabled, false);
  assert.equal(skill().enabled, false);
  assert.throws(() => resolveSelectedPlugins(dir, [PLUGIN_ID]), /未启用/);
  store.remove(PLUGIN_ID);
  ensureInstalled(store);
  assert.equal(store.get(PLUGIN_ID), null);
  assert.equal(skill(), undefined);
  createPluginCatalog(store).install(PLUGIN_ID);
  store.update(PLUGIN_ID, { enabled: true });
  assert.equal(resolveSelectedPlugins(dir, [PLUGIN_ID])[0].name, 'Yan Computer Use');
});
