'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');

function createClient(dataDir) {
  const skillsRoot = path.join(dataDir, 'skills');
  fs.mkdirSync(skillsRoot, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ customSkills: [] }), 'utf8');
  const child = spawn(process.execPath, [path.join(appRoot, 'lib', 'yan-skills-mcp.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_SKILLS_ROOT: skillsRoot,
      YAN_SKILLS_DATA_DIR: dataDir,
      YAN_SKILLS_CONFIG_PATH: path.join(dataDir, 'config.json'),
      YAN_SKILLS_APP_ROOT: appRoot,
      YAN_SKILLS_CLI: path.join(appRoot, 'node_modules', 'skills', 'bin', 'cli.mjs'),
      YAN_SKILLS_ALLOW_NETWORK: 'false'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
      newline = buffer.indexOf('\n');
    }
  });
  let id = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 10_000);
    pending.set(requestId, message => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
  });
  return { child, request };
}

test('read_skill returns a structured per-task skip without failing MCP', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skills-mcp-'));
  const client = createClient(dataDir);
  t.after(() => {
    client.child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const listed = await client.request('tools/list');
  const readSkill = listed.result.tools.find(tool => tool.name === 'read_skill');
  assert.equal(readSkill.inputSchema.properties.task_id.type, 'string');
  assert.deepEqual(readSkill.inputSchema.required, ['id', 'task_id']);

  const available = await client.request('tools/call', {
    name: 'read_skill',
    arguments: { id: 'yan-react-bits', task_id: 'run-success' }
  });
  assert.equal(available.result.isError, false);
  assert.equal(available.result.structuredContent.ok, true);
  assert.match(available.result.structuredContent.instructions, /React Bits/i);

  const called = await client.request('tools/call', {
    name: 'read_skill',
    arguments: { id: 'definitely-missing-skill', task_id: 'run-test' }
  });
  assert.equal(called.result.isError, false);
  assert.equal(called.result.structuredContent.ok, false);
  assert.equal(called.result.structuredContent.skipped, true);
  assert.equal(called.result.structuredContent.attempts, 1);
  assert.match(called.result.structuredContent.skipNotice, /1 次/);

  const repeated = await client.request('tools/call', {
    name: 'read_skill',
    arguments: { id: 'definitely-missing-skill', task_id: 'run-test' }
  });
  assert.deepEqual(repeated.result.structuredContent, called.result.structuredContent);
});
