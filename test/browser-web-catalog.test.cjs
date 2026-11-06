'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('explicit connection reveals 20/21 browser tools and preserves annotation policy across turns', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-web-catalog-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const missing = ['yan_browser', 'yan_web'].filter(name => !requests.at(-1).tools.some(tool => tool.function.name === (name === 'yan_browser' ? 'yan_browser_browser_observe' : 'yan_web_fetch')));
      const delta = missing.length ? { role: 'assistant', tool_calls: missing.map((name, index) => ({ index, id: `connect-${name}-${requests.length}`, type: 'function', function: { name: `${name}_connect`, arguments: '{}' } })) } : { role: 'assistant', content: 'Done.' };
      res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: missing.length ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await adapter.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = {
    providerId: 'fixture', modelId: 'fixture', apiKey: 'local',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }),
    dsml: false, accessMode: 'full', enableSubagents: false,
    mcpServers: ['browser', 'web'].map(name => ({ id: `yan_${name}`, enabled: true, command: process.execPath, args: [path.join(appRoot, `lib/yan-${name}-mcp.js`)] }))
  };
  let openCodeSessionId;
  for (const [index, annotated] of [false, true, false].entries()) {
    const before = requests.length;
    const result = await adapter.run({ ...options, runId: `catalog-${index}`, workspace: root,
      hasUserWorkspace: true, browserAnnotation: annotated, openCodeSessionId,
      prompt: 'Connect browser and web tools, then reply Done.', openCodeConfig: buildOpenCodeConfig(options) });
    assert.equal(result.status, 'done', JSON.stringify(result));
    openCodeSessionId = result.openCodeSessionId;
    if (index === 0) assert.deepEqual(requests[before].tools.map(tool => tool.function.name).filter(name => /^yan_(browser|web)_/.test(name)).sort(), ['yan_browser_connect', 'yan_web_connect']);
    const names = requests.at(-1).tools.map(tool => tool.function.name);
    const browser = names.filter(name => name.startsWith('yan_browser_') && name !== 'yan_browser_connect');
    assert.equal(browser.length, annotated ? 21 : 20, JSON.stringify(browser));
    assert.equal(names.includes('yan_browser_browser_apply_annotation'), annotated);
    assert.ok(names.includes('yan_web_fetch'));
    assert.ok(names.includes('yan_web_download_file'));
    assert.ok(!names.includes('webfetch'));
    assert.ok(!names.includes('yan_web_fetch_text'));
  }
});
