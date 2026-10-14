'use strict';
// Real OpenCode kernel + native plugin tools + stdio plugin. Only model replies
// are scripted: assertions inspect the actual outbound request schemas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { withPluginSessionPermissions } = require('../lib/plugins/sessions');
const { OpenCodeSidecar, buildOpenCodeConfig, permissionRulesForRun, stageDeepSeekProviderModule, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-kernel-'));
const dataDir = path.join(root, 'data'); const directory = path.join(root, 'workspace'); fs.mkdirSync(directory);
const store = createPluginStore(dataDir); const source = path.join(appRoot, 'test/fixtures/plugin-package');
const candidate = store.preview(source); store.install(source, candidate.digest); store.update('yan-text-kit', { enabled: true });
let step = 0; let deactivateStep = 0; let switchStep = 0; const errors = []; const requests = []; let pluginTool;
const catalogSteps = new Map();
const catalog = createPluginCatalog(store);
const catalogIds = ['remotion', 'hyperframes', 'game-studio', 'circleci'];
const entrySkills = { remotion: 'remotion-best-practices', hyperframes: 'hyperframes', 'game-studio': 'game-studio', circleci: 'config' };
for (const id of ['remotion', 'hyperframes']) { catalog.install(id); store.update(id, { enabled: true }); }
function completion(response, delta) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = { id: 'plugin-test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-test', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  response.write(`data: ${JSON.stringify(chunk)}\n\n`); chunk.choices = [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }];
  response.write(`data: ${JSON.stringify(chunk)}\n\n`); response.end('data: [DONE]\n\n');
}
const server = http.createServer((request, response) => {
  let raw = ''; request.on('data', chunk => { raw += chunk; }); request.on('end', () => {
    try {
      const body = JSON.parse(raw); const messages = JSON.stringify(body.messages);
      if (messages.includes('PLUGIN_SKILL_SWITCH_TEST') && body.tools?.length) {
        const actions = [['plugins_inspect', { id: 'remotion' }], ['plugins_activate', { id: 'remotion' }], ['plugins_read_resource', { id: 'remotion', resource: 'skill:remotion-captions' }], ['plugins_read_resource', { id: 'remotion', resource: 'skill:remotion-create' }]];
        const action = actions[switchStep++];
        if (!action) return completion(response, { content: 'PLUGIN_SKILL_SWITCH_OK' });
        return completion(response, { tool_calls: [{ index: 0, id: `skill-switch-${switchStep}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] });
      }
      if (messages.includes('PLUGIN_CATALOG_TEST') && body.tools?.length) {
        const id = catalogIds.find(id => messages.includes(`PLUGIN_CATALOG_${id.toUpperCase()}`));
        assert.ok(id, 'a known catalog package must be requested');
        const stage = catalogSteps.get(id) || 0;
        const names = body.tools.map(tool => tool.function.name);
        assert.equal(names.filter(name => name.startsWith('yanp_')).length, 0, 'workflow packages have no external tools');
        const manifest = store.manifest(store.get(id));
        const resource = manifest.resources.find(item => item.path.endsWith('.md'));
        const actions = [['plugins_activate', { id }], ['plugins_read_resource', { id, resource: `skill:${entrySkills[id]}` }], ['plugins_read_resource', { id, resource: `resource:${resource.id}` }]];
        if (stage >= actions.length) {
          assert.match(messages, /"activated"|\\"activated\\"/);
          return completion(response, { content: `PLUGIN_CATALOG_OK_${id}` });
        }
        catalogSteps.set(id, stage + 1);
        return completion(response, { tool_calls: [{ index: 0, id: `catalog-${id}-${stage}`, type: 'function', function: { name: actions[stage][0], arguments: JSON.stringify(actions[stage][1]) } }] });
      }
      if (!body.tools?.length || (!messages.includes('PLUGIN_OWNER_TEST') && !messages.includes('PLUGIN_OTHER_TEST'))) return completion(response, { content: 'Plugin test' });
      const names = (body.tools || []).map(t => t.function.name); requests.push({ names, messages });
      if (messages.includes('PLUGIN_DEACTIVATE_TEST')) {
        if (deactivateStep++ === 0) return completion(response, { tool_calls: [{ index: 0, id: 'deactivate-test', type: 'function', function: { name: 'plugins_deactivate', arguments: JSON.stringify({ id: 'yan-text-kit' }) } }] });
        assert.ok(!names.includes(pluginTool), 'deactivated schema must disappear');
        return completion(response, { content: 'PLUGIN_DEACTIVATE_OK' });
      }
      if (messages.includes('PLUGIN_OTHER_TEST')) {
        assert.equal(names.filter(n => n.startsWith('yanp_')).length, 0, 'other session in SAME directory must not receive owner tools');
        return completion(response, { content: 'PLUGIN_OTHER_OK' });
      }
      let action;
      if (step === 0) { assert.ok(names.includes('plugins_activate'), `Available: ${names.join(', ')}; system: ${messages.slice(0, 1800)}`); assert.equal(names.filter(n => n.startsWith('yanp_')).length, 0); action = ['plugins_activate', { id: 'yan-text-kit' }]; }
      else if (step === 1) {
        pluginTool = names.find(n => n.startsWith('yanp_'));
        assert.ok(pluginTool, `activated tool schema absent in next request; ${messages.slice(-9000)}`);
        action = ['plugins_read_resource', { id: 'yan-text-kit', resource: 'skill:text-review' }];
      } else if (step === 2) action = [pluginTool, { text: 'hello world' }];
      else { assert.match(messages, /characters/); return completion(response, { content: 'PLUGIN_OWNER_OK' }); }
      step++; completion(response, { tool_calls: [{ index: 0, id: `plugin-${step}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] });
    } catch (error) { errors.push(error); completion(response, { content: `FAILED: ${error.message}` }); }
  });
});
const unwrap = response => { if (response.error) throw new Error(JSON.stringify(response.error)); return response.data; };
(async () => {
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir });
  try {
    await require('./helpers/install-developer-plugins.cjs').installDeveloperPlugins(store, ['game-studio', 'circleci']);
    for (const id of ['game-studio', 'circleci']) store.update(id, { enabled: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const options = { accessMode: 'full', enableSubagents: false, sandboxMode: 'full', mcpServers: [] };
    const config = buildOpenCodeConfig({ ...options, providerId: 'deepseek', modelId: 'deepseek-test', dsml: true,
      deepSeekProviderModule: stageDeepSeekProviderModule({ appRoot, dataDir }), codingEnvironmentModule: stageCodingEnvironmentModule({ appRoot, dataDir }),
      apiKey: 'local-test', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, capabilities: { contextWindow: 64000, maxOutputTokens: 4096 } });
    await sidecar.start(config);
    const owner = unwrap(await sidecar.client.session.create({ directory, permission: permissionRulesForRun(options) }));
    const other = unwrap(await sidecar.client.session.create({ directory, permission: permissionRulesForRun(options) }));
    for (const session of [owner, other]) unwrap(await sidecar.client.session.update({ sessionID: session.id, directory, permission: withPluginSessionPermissions(directory, session.id, permissionRulesForRun(options)) }));
    const prompt = async (session, text) => unwrap(await sidecar.client.session.prompt({ sessionID: session.id, directory,
      model: { providerID: 'deepseek', modelID: 'deepseek-test' }, agent: 'build', parts: [{ type: 'text', text }] }, { signal: AbortSignal.timeout(90000) }));
    const result = await prompt(owner, 'PLUGIN_OWNER_TEST: use the text plugin then deactivate it.');
    if (errors.length) throw errors[0];
    assert.ok(result.parts.some(part => part.text?.includes('PLUGIN_OWNER_OK')));
    const messages = unwrap(await sidecar.client.session.messages({ sessionID: owner.id, directory }));
    const calls = messages.flatMap(m => m.parts || []).filter(part => part.type === 'tool');
    assert.equal(calls.length, 3); assert.ok(calls.every(part => part.state.status === 'completed'), JSON.stringify(calls));
    const otherResult = await prompt(other, 'PLUGIN_OTHER_TEST: inspect available tools only.');
    if (errors.length) throw errors[0]; assert.ok(otherResult.parts.some(part => part.text?.includes('PLUGIN_OTHER_OK')));
    const deactivated = await prompt(owner, 'PLUGIN_DEACTIVATE_TEST: deactivate the text plugin.');
    if (errors.length) throw errors[0]; assert.ok(deactivated.parts.some(part => part.text?.includes('PLUGIN_DEACTIVATE_OK')));
    for (const id of catalogIds) {
      const session = unwrap(await sidecar.client.session.create({ directory, permission: permissionRulesForRun(options) }));
      const response = await prompt(session, `PLUGIN_CATALOG_TEST PLUGIN_CATALOG_${id.toUpperCase()}: activate this workflow plugin and read its instructions, entry skill and reference.`);
      if (errors.length) throw errors[0];
      assert.ok(response.parts.some(part => part.text?.includes(`PLUGIN_CATALOG_OK_${id}`)));
      const history = unwrap(await sidecar.client.session.messages({ sessionID: session.id, directory }));
      const calls = history.flatMap(message => message.parts || []).filter(part => part.type === 'tool');
      assert.equal(calls.length, 3);
      assert.ok(calls.every(part => part.state.status === 'completed'), JSON.stringify(calls));
    }
    store.update('remotion', { skill: { id: 'remotion-captions', enabled: false } });
    const switchSession = unwrap(await sidecar.client.session.create({ directory, permission: permissionRulesForRun(options) }));
    const switchResult = await prompt(switchSession, 'PLUGIN_SKILL_SWITCH_TEST: inspect and activate Remotion, attempt the disabled skill then read an enabled skill.');
    assert.ok(switchResult.parts.some(part => part.text?.includes('PLUGIN_SKILL_SWITCH_OK')));
    const switchHistory = unwrap(await sidecar.client.session.messages({ sessionID: switchSession.id, directory }));
    const switchCalls = switchHistory.flatMap(message => message.parts || []).filter(part => part.type === 'tool');
    assert.equal(switchCalls.length, 4);
    for (const call of switchCalls.slice(0, 2)) {
      assert.equal(call.state.status, 'completed');
      const output = JSON.parse(call.state.output);
      assert.equal(output.skills.length, 11);
      assert.equal(output.skills.some(skill => skill.id.includes('remotion-captions')), false);
    }
    assert.equal(switchCalls[2].state.status, 'error');
    assert.match(switchCalls[2].state.error, /不存在/);
    assert.equal(switchCalls[3].state.status, 'completed');
    console.log('PASS: real kernel plugin activation, actual next-request schemas, resource loading, MCP execution, deactivation and session isolation; real catalog workflows; skill switch filters discovery and rejects disabled reads while enabled skills remain readable.');
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close(); await stopped; server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
