'use strict';

// Exercise the real kernel's configuration decoder and session creation; a
// healthy /global/health response alone does not validate the loaded config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, permissionRulesForRun, stopChildProcess } = require('../lib/opencode-sidecar');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-config-'));
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace);
  const sidecar = new OpenCodeSidecar({ appRoot: path.resolve(__dirname, '..'), dataDir: directory,
    log: { info() {}, warn() {}, error() {} } });
  try {
    const config = buildOpenCodeConfig({ hasUserWorkspace: true });
    const invalid = structuredClone(config);
    invalid.permission.doom_loop = { '*': 'ask', yan_session_wait_external_tasks: 'allow' };
    for (const agent of Object.values(invalid.agent)) agent.permission.doom_loop = invalid.permission.doom_loop;
    await sidecar.start(invalid);
    const rejected = await sidecar.client.session.create({ directory: workspace, title: 'Invalid config regression' });
    assert.ok(rejected.error, 'the old pattern-map config must reproduce the kernel error');
    assert.match(JSON.stringify(rejected.error), /ConfigInvalidError/);
    assert.match(JSON.stringify(rejected.error), /doom_loop/);

    await sidecar.start(config);
    const response = await sidecar.client.session.create({ directory: workspace, title: 'Valid permission config',
      permission: permissionRulesForRun({ hasUserWorkspace: true }) });
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    assert.ok(response.data?.id, 'the real kernel must return a new session id');
    const fetched = await sidecar.client.session.get({ directory: workspace, sessionID: response.data.id });
    assert.equal(fetched.error, undefined, JSON.stringify(fetched.error));
    assert.equal(fetched.data.id, response.data.id);
    assert.equal(path.resolve(fetched.data.directory), path.resolve(workspace));
    console.log('PASS real kernel rejects the old doom_loop map, accepts the generated config, and creates/reads a session. No model request sent.');
  } finally {
    const child = sidecar.server?.child || sidecar.startingChild;
    sidecar.close();
    await stopChildProcess(child);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yan-session-config-'));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
