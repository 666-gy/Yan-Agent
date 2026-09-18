const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PLATFORM_PACKAGE = `@colbymchenry/codegraph-${process.platform}-${process.arch}`;
const activeInitializations = new Map();
const activeSynchronizations = new Map();

function unpackedPath(filePath) {
  const marker = `${path.sep}app.asar${path.sep}`;
  return String(filePath || '').includes(marker)
    ? String(filePath).replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
    : filePath;
}

function packagedRuntimeRoot(appRoot) {
  const root = path.resolve(String(appRoot || ''));
  const resourcesDir = path.basename(root).toLowerCase() === 'app.asar'
    ? path.dirname(root)
    : path.join(root, 'resources');
  return path.join(resourcesDir, 'codegraph-runtime');
}

function nodeCommandName() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function runtimeFromRoot(candidate) {
  const preferred = path.join(candidate, nodeCommandName());
  const legacy = path.join(candidate, process.platform === 'win32' ? 'node' : 'node.exe');
  const command = fs.existsSync(preferred) ? preferred : legacy;
  const entry = path.join(candidate, 'lib', 'dist', 'bin', 'codegraph.js');
  if (!fs.existsSync(command) || !fs.existsSync(entry)) return null;
  return {
    ok: true,
    command,
    args: ['--liftoff-only', '--disable-warning=ExperimentalWarning', entry],
    env: {
      CODEGRAPH_TELEMETRY: '0',
      CODEGRAPH_NO_DOWNLOAD: '1',
      DO_NOT_TRACK: '1',
      NO_COLOR: '1'
    },
    root: candidate
  };
}

function resolveRuntime(appRoot) {
  const candidates = [];
  const packagedRoot = packagedRuntimeRoot(appRoot);
  if (packagedRoot) {
    candidates.push(packagedRoot);
    const packagedRuntime = runtimeFromRoot(packagedRoot);
    if (packagedRuntime) return packagedRuntime;
  }

  try {
    const packageJson = require.resolve(`${PLATFORM_PACKAGE}/package.json`, { paths: [appRoot] });
    const packageRoot = path.dirname(unpackedPath(packageJson));
    if (packageRoot && !candidates.includes(packageRoot)) candidates.push(packageRoot);
    for (const candidate of candidates) {
      const runtime = runtimeFromRoot(candidate);
      if (runtime) return runtime;
    }
    return { ok: false, error: `CodeGraph 运行时不完整：${candidates.join('；') || packageRoot}` };
  } catch (error) {
    for (const candidate of candidates) {
      const runtime = runtimeFromRoot(candidate);
      if (runtime) return runtime;
    }
    return { ok: false, error: `未找到 CodeGraph 运行时：${error.message}` };
  }
}

function resolveNodeCommand(appRoot) {
  const runtime = resolveRuntime(appRoot);
  if (!runtime.ok) return runtime;
  return { ok: true, command: runtime.command };
}

function cleanOutput(value) {
  return String(value || '')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .trim();
}

function runCodeGraph(appRoot, args, options = {}) {
  const runtime = resolveRuntime(appRoot);
  if (!runtime.ok) return Promise.resolve(runtime);
  const cwd = path.resolve(options.cwd || process.cwd());
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 600000));
  return new Promise(resolve => {
    const child = spawn(runtime.command, [...runtime.args, ...args], {
      cwd,
      env: { ...process.env, ...runtime.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-2_000_000);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({
        ok: false,
        error: `CodeGraph 命令超时（${Math.round(timeoutMs / 1000)} 秒）`,
        stdout: cleanOutput(stdout),
        stderr: cleanOutput(stderr)
      });
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout: cleanOutput(stdout), stderr: cleanOutput(stderr) });
    });
    child.once('exit', code => {
      clearTimeout(timer);
      const output = cleanOutput(stdout);
      const diagnostic = cleanOutput(stderr);
      resolve(code === 0
        ? { ok: true, code, stdout: output, stderr: diagnostic }
        : { ok: false, code, error: diagnostic || output || `CodeGraph 退出代码 ${code}`, stdout: output, stderr: diagnostic });
    });
  });
}

function validateWorkspace(workspace) {
  const resolved = path.resolve(String(workspace || '').trim());
  if (!workspace) return { ok: false, error: 'CodeGraph 需要当前任务工作区。' };
  try {
    if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: `工作区不是文件夹：${resolved}` };
  } catch {
    return { ok: false, error: `工作区不存在：${resolved}` };
  }
  return { ok: true, workspace: resolved };
}

async function ensureIndex(appRoot, workspace) {
  const checked = validateWorkspace(workspace);
  if (!checked.ok) return checked;
  const root = checked.workspace;
  if (activeInitializations.has(root)) return activeInitializations.get(root);
  const operation = (async () => {
    const database = path.join(root, '.codegraph', 'codegraph.db');
    if (fs.existsSync(database)) {
      return { ok: true, workspace: root, initialized: false, database };
    }
    const result = await runCodeGraph(appRoot, ['init', '--no-color', root], {
      cwd: root,
      timeoutMs: 15 * 60 * 1000
    });
    if (!result.ok) {
      return {
        ...result,
        error: `CodeGraph 建图失败：${result.error}`,
        workspace: root
      };
    }
    if (!fs.existsSync(database)) {
      return { ok: false, error: 'CodeGraph 命令已结束，但没有生成索引数据库。', workspace: root };
    }
    return { ...result, workspace: root, initialized: true, database };
  })();
  activeInitializations.set(root, operation);
  try {
    return await operation;
  } finally {
    activeInitializations.delete(root);
  }
}

async function syncIndex(appRoot, workspace) {
  const checked = validateWorkspace(workspace);
  if (!checked.ok) return checked;
  const root = checked.workspace;
  const database = path.join(root, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(database)) return ensureIndex(appRoot, root);
  if (activeSynchronizations.has(root)) return activeSynchronizations.get(root);
  const operation = (async () => {
    const result = await runCodeGraph(appRoot, ['--no-color', 'sync', root], {
      cwd: root,
      timeoutMs: 5 * 60 * 1000
    });
    return result.ok
      ? { ...result, workspace: root, database, synchronized: true }
      : { ...result, error: `CodeGraph 增量同步失败：${result.error}`, workspace: root };
  })();
  activeSynchronizations.set(root, operation);
  try {
    return await operation;
  } finally {
    activeSynchronizations.delete(root);
  }
}

module.exports = {
  ensureIndex,
  resolveRuntime,
  resolveNodeCommand,
  runCodeGraph,
  syncIndex
};
