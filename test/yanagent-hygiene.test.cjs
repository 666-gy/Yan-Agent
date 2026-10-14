'use strict';

// Workspace hygiene contract: Yan runtime output stays inside .yanagent, the
// folder hides itself from git without touching the project .gitignore, and
// the agent is told to keep scratch artifacts there and clean them up.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const sidecarSrc = fs.readFileSync(path.join(appRoot, 'lib', 'opencode-sidecar.js'), 'utf8');
const deliverySrc = fs.readFileSync(path.join(appRoot, 'lib', 'delivery-policy.js'), 'utf8');
const { pruneYanagentEvidence, EVIDENCE_TTL_MS } = require('../lib/yanagent-evidence');
const { registerYanagentStore } = require('../lib/main/yanagent-store');

test('ensureYanagent writes a self-ignoring .gitignore, a scratch dir and the evidence dir', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-yanagent-'));
  try {
    const store = registerYanagentStore({
      resourceLocks: { withLock: (_name, _mode, _meta, run) => run() },
      yanagentDir: '.yanagent'
    });
    const root = store.ensureYanagent(workspace);
    assert.equal(root, path.join(workspace, '.yanagent'));
    for (const sub of ['logs', 'snapshots', 'scratch', 'evidence']) {
      assert.equal(fs.existsSync(path.join(root, sub)), true, `${sub} dir must be prepared`);
    }
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '*\n', 'the folder hides itself from git');

    // ensureYanagent must bound the evidence store on every call.
    const stale = path.join(root, 'evidence', 'stale.png');
    fs.writeFileSync(stale, 'stale', 'utf8');
    const old = new Date(Date.now() - EVIDENCE_TTL_MS - 60_000);
    fs.utimesSync(stale, old, old);
    store.ensureYanagent(workspace);
    assert.equal(fs.existsSync(stale), false, 'expired evidence must be pruned');

    // Idempotent: a second call keeps the same directory.
    assert.equal(store.ensureYanagent(workspace), root);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('a .yanagent folder with the written ignore file stays invisible to git', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-gitignore-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true });
    const dir = path.join(repo, '.yanagent');
    fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.txt'), 'yan', 'utf8');
    fs.writeFileSync(path.join(dir, 'memory.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dir, '.gitignore'), '*\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'app.js'), 'const a = 1;\n', 'utf8');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.equal(status.includes('.yanagent'), false, `git status leaked .yanagent: ${status}`);
    assert.ok(status.includes('app.js'), 'normal project files must stay visible');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('reusable evidence survives the run but is bounded by TTL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-evidence-'));
  try {
    const dir = path.join(root, 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    const fresh = path.join(dir, 'acceptance.png');
    const stale = path.join(dir, 'old-frame.png');
    fs.writeFileSync(fresh, 'fresh', 'utf8');
    fs.writeFileSync(stale, 'stale', 'utf8');
    const old = new Date(Date.now() - EVIDENCE_TTL_MS - 60_000);
    fs.utimesSync(stale, old, old);
    assert.deepEqual(pruneYanagentEvidence(root), { removed: 1 });
    assert.equal(fs.existsSync(fresh), true, 'fresh evidence must be kept');
    assert.equal(fs.existsSync(stale), false, 'expired evidence must be pruned');
    assert.deepEqual(pruneYanagentEvidence(path.join(root, 'missing')), { removed: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tool output and agent guidance separate evidence from scratch cleanup', () => {
  const { createRuntimeDefaults } = require('../lib/main/runtime-defaults');
  // Playwright's server appears only once its plugin installed the browser.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-hygiene-playwright-'));
  const executable = path.join(dataDir, 'runtimes', 'playwright', 'browsers', 'chromium-1247', 'chrome-win64', 'chrome.exe');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'fixture');
  fs.writeFileSync(path.join(dataDir, 'runtimes', 'playwright', 'installed.json'), JSON.stringify({
    mcpVersion: require('../lib/playwright-runtime').MCP_VERSION, browserExecutable: 'chromium-1247/chrome-win64/chrome.exe' }));
  const playwright = createRuntimeDefaults({ dataDir }).ensureDefaultMcp([]).find(server => server.id === 'mcp_default_playwright');
  fs.rmSync(dataDir, { recursive: true, force: true });
  assert.equal(playwright.args[playwright.args.indexOf('--output-dir') + 1], '.yanagent/playwright');
  assert.match(sidecarSrc, /put every temporary artifact[\s\S]{0,200}\.yanagent\//, 'workspace rule must name .yanagent');
  assert.match(sidecarSrc, /\.yanagent\/evidence\//, 'workspace rule must keep reusable evidence');
  assert.match(sidecarSrc, /keep them under <workspace>\/\.yanagent\/ and delete the ones you created/, 'mapper rule must clean up');
  assert.match(deliverySrc, /交付前清点工作区/, 'delivery policy must require a scratch cleanup pass');
  assert.match(deliverySrc, /\.yanagent\/evidence\//, 'delivery policy must route reusable evidence');
});
