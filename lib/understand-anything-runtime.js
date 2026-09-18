const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const codeGraphRuntime = require('./codegraph-runtime');
const { convertCodeGraph } = require('./codegraph-to-understand-anything');

const viewers = new Map();

function toPublic(record, extra = {}) {
  if (!record) return { ok: false };
  return {
    ok: !!record.ok,
    workspace: record.workspace,
    url: record.url,
    pid: record.child?.pid || record.pid || null,
    graph: record.graph || null,
    openedAt: record.openedAt || null,
    ...extra
  };
}

function unpackedPath(filePath) {
  const marker = `${path.sep}app.asar${path.sep}`;
  return String(filePath || '').includes(marker)
    ? String(filePath).replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
    : filePath;
}

function validateWorkspace(workspace) {
  const resolved = path.resolve(String(workspace || '').trim());
  if (!workspace) return { ok: false, error: 'Understand Anything 需要当前任务工作区。' };
  try {
    if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: `工作区不是文件夹：${resolved}` };
  } catch {
    return { ok: false, error: `工作区不存在：${resolved}` };
  }
  return { ok: true, workspace: resolved };
}

function runConverter(command, converterPath, workspace, timeoutMs = 180000) {
  return new Promise(resolve => {
    const child = spawn(command, [converterPath, workspace], {
      cwd: workspace,
      env: { ...process.env, CODEGRAPH_TELEMETRY: '0', DO_NOT_TRACK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-200000);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, error: `Understand Anything 转换超时（${Math.round(timeoutMs / 1000)} 秒）`, stdout, stderr });
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: String(stderr || stdout || `转换器退出代码 ${code}`).trim(), stdout, stderr });
        return;
      }
      try {
        const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
        resolve({ ok: true, result: JSON.parse(lines.at(-1) || '{}'), stdout, stderr });
      } catch (error) {
        resolve({ ok: false, error: `转换器输出无效：${error.message}`, stdout, stderr });
      }
    });
  });
}

function spawnViewer({ command, viewerEntry, workspace, token, useElectron = false }) {
  // 横幅等待必须有上限:viewer 启动了却始终不打印 Dashboard URL(端口被占、
  // 杀软延迟、崩溃前卡住)时,不设超时会把这个 IPC 永久挂死
  const BANNER_TIMEOUT_MS = 60000;
  return new Promise(resolve => {
    const args = [viewerEntry, workspace, '--port', '0', '--no-open'];
    const child = spawn(command, args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...(useElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        UNDERSTAND_ACCESS_TOKEN: token,
        ELECTRON_NO_ATTACH_CONSOLE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-200000);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(bannerTimer);
      resolve(result);
    };
    const bannerTimer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({
        ok: false,
        error: `viewer 启动超时（${Math.round(BANNER_TIMEOUT_MS / 1000)} 秒未输出 Dashboard URL）`,
        child,
        stdout,
        stderr
      });
    }, BANNER_TIMEOUT_MS);
    child.stdout.on('data', chunk => {
      stdout = append(stdout, chunk);
      const match = stdout.match(/Dashboard URL:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/i);
      if (match) finish({ ok: true, child, url: match[1], stdout, stderr });
    });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => finish({ ok: false, error: error.message, child, stdout, stderr }));
    child.once('exit', code => {
      if (!settled) finish({ ok: false, error: String(stderr || stdout || `viewer 退出代码 ${code}`).trim(), child, stdout, stderr });
    });
  });
}

async function openUnderstandAnything(appRoot, workspace, options = {}) {
  const checked = validateWorkspace(workspace);
  if (!checked.ok) return checked;
  const root = checked.workspace;
  const cached = viewers.get(root);
  if (cached?.child && !cached.child.killed && cached.url) return toPublic(cached, { reused: true });

  const index = await codeGraphRuntime.ensureIndex(appRoot, root);
  if (!index.ok) return { ...index, error: index.error || 'CodeGraph 建图失败' };
  const synced = await codeGraphRuntime.syncIndex(appRoot, root);
  if (!synced.ok) return { ...synced, error: synced.error || 'CodeGraph 同步失败' };

  const runtime = codeGraphRuntime.resolveNodeCommand(appRoot);
  if (!runtime.ok) return { ok: false, error: runtime.error };
  const converterPath = unpackedPath(path.join(appRoot, 'lib', 'codegraph-to-understand-anything.js'));
  const viewerEntry = unpackedPath(path.join(appRoot, 'lib', 'understand-anything', 'viewer', 'bin', 'viewer.mjs'));
  if (!fs.existsSync(converterPath)) return { ok: false, error: `Understand Anything 转换器不存在：${converterPath}` };
  if (!fs.existsSync(viewerEntry)) return { ok: false, error: `Understand Anything viewer 未打包：${viewerEntry}` };

  const conversion = await runConverter(runtime.command, converterPath, root);
  if (!conversion.ok) return { ok: false, error: `生成代码知识图谱失败：${conversion.error}`, details: conversion.stderr || conversion.stdout };
  const token = crypto.randomBytes(24).toString('hex');
  const viewer = await spawnViewer({
    command: options.viewerCommand || process.execPath,
    viewerEntry,
    workspace: root,
    token,
    useElectron: options.useElectron ?? true
  });
  if (!viewer.ok) return { ok: false, error: `启动 Understand Anything viewer 失败：${viewer.error}` };
  const record = {
    ok: true,
    workspace: root,
    url: viewer.url,
    token,
    child: viewer.child,
    pid: viewer.child.pid,
    graph: conversion.result,
    openedAt: Date.now()
  };
  viewers.set(root, record);
  viewer.child.once('exit', () => {
    if (viewers.get(root)?.child === viewer.child) viewers.delete(root);
  });
  return toPublic(record);
}

function stopUnderstandAnything(workspace) {
  const root = path.resolve(String(workspace || ''));
  const record = viewers.get(root);
  if (!record) return { ok: true, stopped: false };
  viewers.delete(root);
  try { record.child.kill(); } catch {}
  return { ok: true, stopped: true };
}

function stopAllUnderstandAnything() {
  for (const root of [...viewers.keys()]) stopUnderstandAnything(root);
}

function listUnderstandAnything() {
  return [...viewers.values()].map(({ child, token, ...record }) => ({ ...record, pid: child?.pid || record.pid }));
}

module.exports = {
  openUnderstandAnything,
  stopUnderstandAnything,
  stopAllUnderstandAnything,
  listUnderstandAnything
};
