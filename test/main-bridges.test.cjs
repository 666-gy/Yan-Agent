'use strict';

const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const { registerBridges } = require('../lib/main/bridges');
const { stateCell } = require('../lib/main/context');

function cell(value) {
  return stateCell(() => value, next => { value = next; });
}

function request(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error('bridge response timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', chunk => { response += chunk; });
    socket.on('end', () => {
      try { resolve(JSON.parse(response)); } catch (error) { reject(error); }
    });
  });
}

test('browser requests keep task identity when identical calls arrive out of order', () => {
  const bridges = registerBridges({ app: new EventEmitter() }, {
    browserHelpers: {}, browserAgentToolClaims: new Map(),
    openCodeActiveRuns: new Map([['run-a', {}], ['run-b', {}]])
  });
  for (const id of ['run-a', 'run-b']) {
    bridges.trackBrowserAgentToolClaim(id, { type: 'session.next.tool.called',
      data: { callID: `call-${id}`, tool: 'yan_browser_browser_click', input: { task_id: id, ref: 'same-ref' } } });
  }
  assert.equal(bridges.resolveAuthoritativeBrowserRun('click', { yan_run_id: 'run-b' }).runId, 'run-b');
  assert.equal(bridges.resolveAuthoritativeBrowserRun('click', { yan_run_id: 'run-a' }).runId, 'run-a');
  assert.equal(bridges.resolveAuthoritativeBrowserRun('click', {}).code, 'BROWSER_RUN_CONTEXT_AMBIGUOUS');
  assert.equal(bridges.resolveAuthoritativeBrowserRun('click', { yan_run_id: 'finished-run' }).code, 'BROWSER_RUN_NOT_ACTIVE');
});

test('browser control preference blocks agent commands before dispatch', async () => {
  const bridges = registerBridges({ app: new EventEmitter() }, {
    browserHelpers: {}, BROWSER_AGENT_BRIDGE_ACTIONS: new Set(['open', 'click', 'screenshot']),
    configStore: { loadConfig: () => ({ browser: { enabled: false } }) }
  });
  for (const action of ['open', 'click', 'screenshot']) {
    assert.equal((await bridges.dispatchBrowserAgentCommand(action)).code, 'BROWSER_DISABLED');
  }
});

for (const kind of ['Browser', 'Session']) {
  test(`${kind} bridge publishes shared state, reuses its listener and restarts after shutdown`, async t => {
    const deps = {
      bridgeServer: cell(null), bridgePort: cell(0),
      sessionBridgeServer: cell(null), sessionBridgePort: cell(0),
      browserAgentBridgePending: new Map(), sessionAgentBridgePending: new Map(),
      sessionAgentToolClaims: new Map(), browserHelpers: {},
      browserAgentBridgeToken: 'browser-test-token', sessionAgentBridgeToken: 'session-test-token',
      BROWSER_AGENT_BRIDGE_MAX_BYTES: 4096, SESSION_AGENT_BRIDGE_MAX_BYTES: 4096,
      BROWSER_AGENT_BRIDGE_ACTIONS: new Set(), SESSION_AGENT_ACTIONS: new Set()
    };
    const bridges = registerBridges({ app: new EventEmitter() }, deps);
    const start = bridges[`start${kind}AgentBridge`];
    const stop = bridges[`stop${kind}AgentBridge`];
    const serverCell = kind === 'Browser' ? deps.bridgeServer : deps.sessionBridgeServer;
    const portCell = kind === 'Browser' ? deps.bridgePort : deps.sessionBridgePort;
    const pending = kind === 'Browser' ? deps.browserAgentBridgePending : deps.sessionAgentBridgePending;
    t.after(stop);

    for (let cycle = 0; cycle < 2; cycle++) {
      const info = await start();
      assert.ok(info.port > 0);
      assert.equal(portCell.get(), info.port);
      const server = serverCell.get();
      assert.equal(server.address().port, info.port);
      assert.deepEqual(await start(), info);
      assert.equal(serverCell.get(), server);
      const denied = await request(info.port, { token: 'invalid' });
      assert.equal(denied.code, `YAN_${kind.toUpperCase()}_AUTH_FAILED`);
      const accepted = await request(info.port, { token: info.token, action: 'unknown' });
      assert.equal(accepted.result.code, `UNKNOWN_${kind.toUpperCase()}_ACTION`);

      let cancellation;
      const timer = setTimeout(() => assert.fail('pending request was not cancelled'), 2000);
      pending.set('pending', { timer, resolve: result => { cancellation = result; } });
      const closed = once(server, 'close');
      stop();
      await closed;
      assert.equal(cancellation.code, 'YAN_APP_EXITING');
      assert.equal(pending.size, 0);
      assert.equal(portCell.get(), 0);
      assert.equal(serverCell.get(), null);
      stop();
    }
  });
}
