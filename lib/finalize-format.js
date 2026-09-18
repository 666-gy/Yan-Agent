'use strict';

// Finalization formatting pass — the quality backstop for the fast write
// path. When the kernel config ships `formatter: false` (per-edit
// auto-format disabled), the sidecar calls formatRunAuthoredFiles() once at
// run finalization to normalize every file the run authored, so the on-disk
// result stays project-formatted without paying a formatter process after
// every single edit.
//
// Best-effort by contract: probe, spawn, and timeout failures are logged and
// swallowed. Formatting must never fail a run or change its outcome. Only
// files the agent's mutation tools wrote are considered — files produced by
// bash (build output, generated artifacts, lockfiles) were written by project
// tooling and are already in project shape.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Machine-managed artifacts: reformatting corrupts their state or produces
// enormous diffs the run did not author.
const EXCLUDED_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'deno.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Pipfile.lock.bak',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
  'flake.lock'
]);

const MINIFIED_RE = /(^|[.\-])(min|bundle|prod)\.[cm]?js$|\.d\.ts$/i;

const PRETTIER_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.json', '.jsonc', '.css', '.scss', '.less', '.html', '.htm',
  '.vue', '.svelte', '.md', '.mdx', '.yaml', '.yml', '.graphql', '.gql'
]);
const GO_EXTENSIONS = new Set(['.go']);
const PYTHON_EXTENSIONS = new Set(['.py']);

const FORMATTER_COMMANDS = {
  gofmt: ['gofmt', '-w'],
  ruff: ['ruff', 'format'],
  black: ['black', '--quiet'],
  biome: ['biome', 'format', '--write']
};

const PROBE_TIMEOUT_MS = 5_000;
const GROUP_TIMEOUT_MS = 20_000;
const MAX_FILES_PER_GROUP = 400;
const AVAILABILITY_CACHE_TTL_MS = 10 * 60_000;

const availabilityCache = new Map();

function cacheKey(workspace, formatter) {
  return `${workspace}\u0000${formatter}`;
}

function setCachedAvailability(workspace, formatter, available) {
  availabilityCache.set(cacheKey(workspace, formatter), {
    available,
    at: Date.now()
  });
}

function getCachedAvailability(workspace, formatter) {
  const hit = availabilityCache.get(cacheKey(workspace, formatter));
  if (!hit) return null;
  if (Date.now() - hit.at > AVAILABILITY_CACHE_TTL_MS) {
    availabilityCache.delete(cacheKey(workspace, formatter));
    return null;
  }
  return hit.available;
}

// The workspace's own prettier is executed through the current runtime binary
// (ELECTRON_RUN_AS_NODE under the packaged Electron app), because spawning
// .cmd shims without a shell fails on modern Node and shell spawning would
// put file names through quoting.
function resolveLocalPrettier(workspace) {
  try {
    const packagePath = path.join(workspace, 'node_modules', 'prettier', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin.prettier);
    if (!bin) return null;
    const binPath = path.join(workspace, 'node_modules', 'prettier', bin);
    fs.accessSync(binPath);
    return binPath;
  } catch {
    return null;
  }
}

function runProcess(command, args, { cwd, timeoutMs, extraEnv } = {}) {
  return new Promise(resolve => {
    let child;
    let timer = null;
    let settled = false;
    const stderrTail = [];
    const settle = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child?.kill(); } catch {}
      resolve(result);
    };
    try {
      child = spawn(command, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {})
      });
    } catch (error) {
      return settle({ ok: false, error: error?.message || String(error) });
    }
    timer = setTimeout(() => settle({ ok: false, error: 'timeout' }), timeoutMs);
    child.once('error', error => settle({ ok: false, error: error?.message || String(error) }));
    child.once('close', code => settle({
      ok: code === 0,
      code,
      error: code === 0 ? null : `exit ${code}${stderrTail.length ? `: ${stderrTail.join('').slice(-400)}` : ''}`
    }));
    child.stderr?.on('data', chunk => {
      stderrTail.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      if (stderrTail.length > 16) stderrTail.splice(0, stderrTail.length - 16);
    });
  });
}

async function probeFormatter(workspace, formatter) {
  const cached = getCachedAvailability(workspace, formatter);
  if (cached !== null) return cached;
  if (formatter === 'prettier') {
    const available = resolveLocalPrettier(workspace) !== null;
    setCachedAvailability(workspace, formatter, available);
    return available;
  }
  const spec = FORMATTER_COMMANDS[formatter];
  if (!spec) return false;
  const probe = await runProcess(spec[0], ['--version'], {
    cwd: workspace,
    timeoutMs: PROBE_TIMEOUT_MS
  });
  // ENOENT / timeout mean unavailable; a nonzero --version exit from a binary
  // that exists still proves the formatter is installed.
  const available = probe.error !== 'timeout' && !/ENOENT|not found/i.test(probe.error || '');
  setCachedAvailability(workspace, formatter, available);
  return available;
}

async function pickFirstAvailable(workspace, formatters) {
  for (const formatter of formatters) {
    if (await probeFormatter(workspace, formatter)) return formatter;
  }
  return null;
}

// Pure selection: workspace-scoped, deduplicated, minus lockfiles, minified
// bundles, generated typings, and unknown extensions. Files keep their
// formatter preference list in priority order; availability is decided later.
function selectFormatTargets(workspace, files) {
  const root = path.resolve(String(workspace || ''));
  if (!root) return [];
  const targets = [];
  const seen = new Set();
  for (const candidate of Array.isArray(files) ? files : []) {
    const source = String(candidate || '').trim();
    if (!source) continue;
    const resolved = path.isAbsolute(source) ? path.resolve(source) : path.resolve(root, source);
    let relative;
    try {
      relative = path.relative(root, resolved);
    } catch {
      continue;
    }
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = path.basename(resolved);
    if (EXCLUDED_BASENAMES.has(base)) continue;
    if (MINIFIED_RE.test(base)) continue;
    const extension = path.extname(base).toLowerCase();
    let formatters = null;
    if (PRETTIER_EXTENSIONS.has(extension)) formatters = ['prettier', 'biome'];
    else if (GO_EXTENSIONS.has(extension)) formatters = ['gofmt'];
    else if (PYTHON_EXTENSIONS.has(extension)) formatters = ['ruff', 'black'];
    if (!formatters) continue;
    targets.push({ path: resolved, formatters });
  }
  return targets;
}

async function executeFormatterGroup(workspace, formatter, files, log) {
  const group = files.slice(0, MAX_FILES_PER_GROUP);
  if (group.length < files.length) {
    log?.warn?.(`[finalize-format] ${formatter}: ${files.length - group.length} files skipped (cap ${MAX_FILES_PER_GROUP})`);
  }
  let result;
  if (formatter === 'prettier') {
    const binPath = resolveLocalPrettier(workspace);
    if (!binPath) return { formatter, files: group, ok: false, error: 'prettier disappeared' };
    result = await runProcess(process.execPath, [binPath, '--write', ...group], {
      cwd: workspace,
      timeoutMs: GROUP_TIMEOUT_MS,
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' }
    });
  } else {
    const spec = FORMATTER_COMMANDS[formatter];
    result = await runProcess(spec[0], [...spec.slice(1), ...group], {
      cwd: workspace,
      timeoutMs: GROUP_TIMEOUT_MS
    });
  }
  if (!result.ok) {
    log?.warn?.(`[finalize-format] ${formatter} (${group.length} files) failed: ${result.error || 'unknown error'}`);
  }
  return { formatter, files: group, ok: result.ok, error: result.error || null };
}

async function formatRunAuthoredFiles(workspace, files, log = console) {
  const root = path.resolve(String(workspace || ''));
  if (!root) return null;
  const targets = selectFormatTargets(root, files);
  if (!targets.length) return null;

  const groups = new Map();
  for (const target of targets) {
    const picked = await pickFirstAvailable(root, target.formatters);
    if (!picked) continue;
    if (!groups.has(picked)) groups.set(picked, []);
    groups.get(picked).push(target.path);
  }
  if (!groups.size) return null;

  const results = await Promise.all([...groups.entries()].map(([formatter, groupFiles]) => (
    executeFormatterGroup(root, formatter, groupFiles, log)
  )));
  const formatted = results.reduce((sum, result) => sum + (result.ok ? result.files.length : 0), 0);
  const failed = results.filter(result => !result.ok).reduce((sum, result) => sum + result.files.length, 0);
  return {
    formatters: [...groups.keys()],
    requested: targets.length,
    formatted,
    failed
  };
}

module.exports = {
  formatRunAuthoredFiles,
  selectFormatTargets,
  resolveLocalPrettier,
  runProcess
};
