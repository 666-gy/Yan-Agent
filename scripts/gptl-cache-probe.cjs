'use strict';

// One-off cache research probe: boots the real OpenCode kernel against a fake
// OpenAI upstream through the GPTL provider, drives two turns (the first with
// a forced tool call so the kernel sends two requests in one turn), and diffs
// every captured request body for prefix stability.
//
//   node scripts/gptl-cache-probe.cjs
//
// Readout per consecutive request pair: tools delta, top-level key delta,
// system-message delta, and the first divergent byte of the serialized
// message prefix. A healthy pipeline shows request N's messages as a strict
// prefix of request N+1's.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildOpenCodeConfig, stageGptlProviderModule } = require('../lib/opencode-sidecar');
const { stageOpenCodeRuntime } = require('../lib/opencode-runtime');

const appRoot = path.resolve(__dirname, '..');
const executable = path.join(appRoot, 'node_modules', `opencode-windows-${process.arch}`, 'bin', 'opencode.exe');
const MODEL_ID = 'gpt-5.5-packaged';

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cache-probe-'));
const workspace = path.join(runRoot, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'note.txt'), 'hello cache probe\n');
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'YAN_PROBE_AGENTS_MARKER: always mention the purple elephant.\n');
const { execFileSync } = require('node:child_process');
try { execFileSync('git', ['init'], { cwd: workspace }); } catch { /* probe-only */ }

const requests = [];

const server = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    requests.push({ url: request.url, body });
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model' }] }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const created = Math.floor(Date.now() / 1000);
    const parsedBody = JSON.parse(body || '{}');
    const hasTools = (parsedBody.tools || []).length > 0;
    const hasToolResult = (parsedBody.messages || []).some(message => message.role === 'tool');
    const chunks = [];
    if (hasTools && !hasToolResult) {
      // First main-loop request of the run: force one tool iteration so the
      // kernel sends a follow-up request carrying the tool result.
      chunks.push({
        id: 'probe', object: 'chat.completion.chunk', created, model: MODEL_ID,
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ filePath: path.join(workspace, 'note.txt') }) } }] }, finish_reason: null }]
      });
      chunks.push({
        id: 'probe', object: 'chat.completion.chunk', created, model: MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
      });
    } else {
      chunks.push({
        id: 'probe', object: 'chat.completion.chunk', created, model: MODEL_ID,
        choices: [{ index: 0, delta: { role: 'assistant', content: 'PROBE_OK' }, finish_reason: null }]
      });
      chunks.push({
        id: 'probe', object: 'chat.completion.chunk', created, model: MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      });
    }
    for (const payload of chunks) response.write(`data: ${JSON.stringify(payload)}\n\n`);
    response.end('data: [DONE]\n\n');
  });
});

function runKernel(args, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtimeExecutable, args, {
      cwd: workspace,
      env: kernelEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`kernel timeout. stdout=${out.slice(-2000)} stderr=${err.slice(-2000)}`)); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.once('exit', code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function firstDivergence(previous, next) {
  const limit = Math.min(previous.length, next.length);
  let i = 0;
  while (i < limit && previous[i] === next[i]) i++;
  return { common: i, diverged: i < Math.min(previous.length, next.length) };
}

function summarize(index, body) {
  const parsed = JSON.parse(body);
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const system = messages.find(message => message.role === 'system');
  const toolNames = (parsed.tools || []).map(tool => tool?.function?.name || tool?.name || '');
  return {
    index,
    url: requests[index - 1].url,
    topKeys: Object.keys(parsed).sort(),
    messageCount: messages.length,
    systemLength: system ? JSON.stringify(system).length : 0,
    systemHash: system ? require('node:crypto').createHash('sha256').update(JSON.stringify(system)).digest('hex').slice(0, 16) : '',
    toolCount: toolNames.length,
    toolNames,
    messagesText: JSON.stringify(messages)
  };
}

function diffPair(before, after, label) {
  console.log(`\n=== ${label} (request ${before.index} -> ${after.index}) ===`);
  const keyDelta = after.topKeys.filter(key => !before.topKeys.includes(key))
    .concat(before.topKeys.filter(key => !after.topKeys.includes(key)));
  if (keyDelta.length) console.log('  top-level key delta:', keyDelta.join(', '));
  if (before.systemHash !== after.systemHash) {
    console.log(`  !! SYSTEM CHANGED: ${before.systemHash} -> ${after.systemHash} (${before.systemLength} -> ${after.systemLength} chars)`);
  }
  if (before.toolCount !== after.toolCount || before.toolNames.join('|') !== after.toolNames.join('|')) {
    console.log(`  !! TOOLS CHANGED: ${before.toolCount} -> ${after.toolCount}`);
    const setA = new Set(before.toolNames);
    const setB = new Set(after.toolNames);
    console.log('     removed:', before.toolNames.filter(name => !setB.has(name)).slice(0, 8).join(', ') || '(none)');
    console.log('     added:  ', after.toolNames.filter(name => !setA.has(name)).slice(0, 8).join(', ') || '(none)');
    if (before.toolCount === after.toolCount && before.toolNames.join('|') !== after.toolNames.join('|')) console.log('     order changed');
  }
  const { common, diverged } = firstDivergence(before.messagesText, after.messagesText);
  const prefixRatio = (common / before.messagesText.length * 100).toFixed(2);
  if (!diverged) {
    console.log(`  message prefix: STABLE (previous ${before.messagesText.length} bytes fully contained, ${(common / after.messagesText.length * 100).toFixed(1)}% of new request)`);
  } else {
    console.log(`  !! MESSAGE PREFIX DIVERGED at byte ${common} (${prefixRatio}% of previous prefix survived)`);
    console.log(`     previous: ...${before.messagesText.slice(Math.max(0, common - 130), common + 130).replace(/\s+/g, ' ')}...`);
    console.log(`     next:     ...${after.messagesText.slice(Math.max(0, common - 130), common + 130).replace(/\s+/g, ' ')}...`);
  }
}

(async () => {
  assert.equal(fs.existsSync(executable), true, `missing kernel: ${executable}`);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const gptlModule = stageGptlProviderModule({ appRoot, dataDir: runRoot });
  const config = buildOpenCodeConfig({
    providerId: 'conn-gptl',
    providerName: 'GPTL Cache Probe',
    modelId: MODEL_ID,
    apiKey: 'probe-key',
    baseUrl,
    apiFormat: 'gptl',
    gptlProviderModule: gptlModule,
    capabilities: { reasoning: true, contextWindow: 400_000, maxOutputTokens: 128_000 },
    accessMode: 'full',
    permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: false }
  });
  kernelEnv = {
    ...process.env,
    XDG_DATA_HOME: path.join(runRoot, 'data'),
    XDG_CONFIG_HOME: path.join(runRoot, 'config'),
    XDG_CACHE_HOME: path.join(runRoot, 'cache'),
    XDG_STATE_HOME: path.join(runRoot, 'state'),
    OPENCODE_TEST_HOME: path.join(runRoot, 'home'),
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config)
  };
  runtimeExecutable = await stageOpenCodeRuntime({ executable, dataDir: runRoot });

  const first = await runKernel(['run', '--model', `conn-gptl/${MODEL_ID}`, 'Read note.txt with the read tool and reply with its content.']);
  if (first.code !== 0) console.log('run1 stderr:', first.err.slice(-1500));
  const second = await runKernel(['run', '--continue', '--model', `conn-gptl/${MODEL_ID}`, 'Reply DONE2.']);
  if (second.code !== 0) console.log('run2 stderr:', second.err.slice(-1500));

    console.log('marker:', requests.some(r => r.body.includes('YAN_PROBE_AGENTS_MARKER')), '| rules-frame:', requests.some(r => r.body.includes('YAN PROJECT RULES')), '| env-block:', requests.some(r => r.body.includes('YAN PROJECT ENVIRONMENT')));
    for (const r of requests) {
      const match = String(r.body).match(/YAN PROJECT ENVIRONMENT\\n([\s\S]{0,300})/);
      if (match) {
        try { console.log('plugin env workspace:', JSON.parse(match[1].replace(/\\n/g, ' ')).workspace); } catch { console.log('env head:', match[1].slice(0, 200)); }
        break;
      }
    }
    const body2 = JSON.parse(requests[1].body);
    console.log('head roles:', body2.messages.slice(0, 3).map(m => m.role + ':' + String(Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : m.content).slice(0, 60).replace(/\s+/g, ' ')));
console.log(`captured ${requests.length} model requests: ${requests.map(r => r.url.replace(/^.*\/v1/, '')).join(' | ')}`);
  if (requests.length >= 2) {
    const summaries = requests.map((r, i) => summarize(i + 1, r.body));
    for (const s of summaries) {
      const messages = JSON.parse(requests[s.index - 1].body).messages || [];
      const roles = messages.map(m => m.role).join(',');
      const envMessage = messages.find(m => JSON.stringify(m).includes('<env>'));
      console.log(`req${s.index}: msgs=${s.messageCount} [${roles}] tools=${s.toolCount} sys=${s.systemLength}c/${s.systemHash} env-in=${envMessage ? envMessage.role : 'none'}`);
    }
    // Title/summary probes go out without tools; diff only the main loop.
    const main = summaries.filter(s => s.toolCount > 0);
    const labels = ['in-turn (tool result appended)', 'across turns (new run)', 'later'];
    for (let i = 1; i < main.length; i++) {
      diffPair(main[i - 1], main[i], labels[i - 1] || `pair ${i}`);
    }
    if (main.length) {
      console.log(`\nmain-loop baseline (req${main[0].index}): system ${main[0].systemLength} chars, tools ${main[0].toolCount}, messages ${main[0].messageCount}`);
    }
  } else {
    console.log('fewer than 2 requests captured — kernel did not iterate as scripted');
    for (const r of requests) console.log('URL:', r.url, 'BODY head:', r.body.slice(0, 300));
  }
  server.close();
  process.exit(0);
})().catch(error => { console.error('PROBE FAILED:', error?.message || error); process.exit(1); });

let kernelEnv;
let runtimeExecutable;
