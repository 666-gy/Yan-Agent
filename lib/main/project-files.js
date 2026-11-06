'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const MAX_BYTES = 250 * 1024 * 1024;
const PAGE_BYTES = 256 * 1024;

async function resolveProjectPath(root, relative = '') {
  const base = await fs.realpath(root);
  const target = await fs.realpath(path.resolve(base, String(relative)));
  const offset = path.relative(base, target);
  if (offset === '..' || offset.startsWith('..' + path.sep) || path.isAbsolute(offset)) {
    throw new Error('只能查看当前项目内的文件');
  }
  return target;
}

async function listProjectFiles(root, relative) {
  const target = await resolveProjectPath(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const items = await Promise.all(entries.map(async entry => {
    let directory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try { directory = (await fs.stat(await resolveProjectPath(root, path.join(relative || '', entry.name)))).isDirectory(); }
      catch { return null; }
    } else if (!directory && !entry.isFile()) return null;
    return { name: entry.name, path: path.join(relative || '', entry.name).split(path.sep).join('/'), directory };
  }));
  return items.filter(Boolean).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

async function readProjectFile(root, relative, options = {}) {
  const target = await resolveProjectPath(root, relative);
  const handle = await fs.open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('请选择文件');
    const version = `${stat.size}:${stat.mtimeMs}`;
    if (options.version && options.version !== version) throw new Error('文件已更改，请刷新后重试');
    if (stat.size > MAX_BYTES) return { kind: 'unsupported', title: '无法预览此文件', message: '文件超过 250 MB 预览上限，请在其他应用中打开。' };
    const offset = Number(options.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > stat.size) throw new Error('文件已更改，请刷新后重试');
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' }[path.extname(target).toLowerCase()];
    if (mime) return { kind: 'image', content: pathToFileURL(target).href + '?v=' + stat.mtimeMs };
    if (/\.(mp4|m4v|webm|ogv|mov|mkv|avi|mpeg|mpg|wmv|flv)$/i.test(target)) {
      return { kind: 'video', content: pathToFileURL(target).href + '?v=' + stat.mtimeMs };
    }
    const buffer = Buffer.alloc(Math.min(PAGE_BYTES, stat.size - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    let content = buffer.subarray(0, bytesRead);
    if (content.includes(0)) return { kind: 'unsupported', title: '暂不支持预览此文件', message: '此文件不是纯文本，请在其他应用中打开。' };
    // Bound DOM work by both bytes and lines; retain every byte for the next page.
    let lines = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === 10 && ++lines === 2000) { content = content.subarray(0, i + 1); break; }
    }
    if (offset + content.length < stat.size && content.length) {
      let lead = content.length - 1;
      while (lead > 0 && (content[lead] & 0xc0) === 0x80) lead--;
      const byte = content[lead];
      const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
      if (lead + width > content.length) content = content.subarray(0, lead);
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
    catch { return { kind: 'unsupported', title: '暂不支持预览此文件', message: '无法识别此文件的编码或格式，请在其他应用中打开。' }; }
    return { kind: 'text', content: text, offset, nextOffset: offset + content.length, size: stat.size, version, hasMore: offset + content.length < stat.size };
  } finally { await handle.close(); }
}

function registerProjectFilesIpc(ctx, store, skillsRuntime) {
  const { ipcMain } = ctx;
  const sessionWindows = require('./windows/session-windows');
  const fileRoots = new Map();
  ipcMain.handle('project-files:resolve', async (event, payload = {}) => {
    try {
      sessionWindows.assertSession(event, payload.sessionId);
      const owner = sessionWindows.windowFor(event, ctx.windows.getMainWindow());
      if (!owner || owner.isDestroyed() || event.sender.id !== owner.webContents.id) throw new Error('无权查看文件');
      const session = await store.readSessionRecord(payload.sessionId, { messageLimit: 1 });
      if (!session) throw new Error('任务不存在');
      const base = session.workspace || skillsRuntime.getNoWorkspaceAgentDirectory(session.id);
      const input = String(payload.path || '');
      const target = await fs.realpath(/^file:/i.test(input) ? fileURLToPath(input) : path.resolve(base, input));
      if (!(await fs.stat(target)).isFile()) throw new Error('请选择文件');
      const workspace = await fs.realpath(base).catch(() => path.resolve(base));
      const relative = path.relative(workspace, target);
      const outside = relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
      const root = outside ? path.dirname(target) : workspace;
      let rootToken = '';
      if (outside) {
        rootToken = [...fileRoots].find(([, value]) => value.root === root && value.sessionId === session.id)?.[0] || randomUUID();
        fileRoots.set(rootToken, { root, sessionId: session.id });
      }
      return { ok: true, root, rootToken, path: path.relative(root, target).split(path.sep).join('/') };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  const run = async (event, payload, operation) => {
    try {
      sessionWindows.assertSession(event, payload?.sessionId);
      const owner = sessionWindows.windowFor(event, ctx.windows.getMainWindow());
      if (!owner || owner.isDestroyed() || event.sender.id !== owner.webContents.id) throw new Error('无权查看项目文件');
      const session = await store.readSessionRecord(payload?.sessionId, { messageLimit: 1 });
      if (!session) throw new Error('任务不存在');
      const scope = payload?.rootToken ? fileRoots.get(payload.rootToken) : null;
      if (payload?.rootToken && scope?.sessionId !== session.id) throw new Error('文件目录授权已失效');
      const root = scope?.root || session.workspace || skillsRuntime.getNoWorkspaceAgentDirectory(session.id);
      if (!session.workspace) await fs.mkdir(root, { recursive: true });
      return { ok: true, root, result: await operation(root, payload?.path || '', payload || {}) };
    } catch (error) { return { ok: false, error: error.message }; }
  };
  ipcMain.handle('project-files:list', (event, payload) => run(event, payload, listProjectFiles));
  ipcMain.handle('project-files:read', (event, payload) => run(event, payload, readProjectFile));
  ipcMain.handle('project-files:action', (event, payload) => run(event, payload, async (root, relative, options) => {
    const target = await resolveProjectPath(root, relative);
    if (!(await fs.stat(target)).isFile()) throw new Error('请选择文件');
    if (options.action === 'write') return saveProjectEdits(root, relative, options);
    if (options.action === 'vscode') return require('../vscode-launcher').launchVsCode(target, { allowFile: true });
    if (options.action === 'explorer') { ctx.shell.showItemInFolder(target); return { ok: true }; }
    if (options.action === 'terminal') return require('../external-terminal').openExternalTerminal(path.dirname(target));
    if (options.action !== 'save') throw new Error('不支持的文件操作');
    const result = await ctx.dialog.showSaveDialog(ctx.windows.getMainWindow(), { title: '另存为', defaultPath: path.basename(target), buttonLabel: '保存' });
    if (result.canceled || !result.filePath) return { canceled: true };
    if (path.resolve(result.filePath) !== target) await fs.copyFile(target, result.filePath);
    return { ok: true, path: result.filePath };
  }));
}

async function saveProjectEdits(root, relative, options) {
  const target = await resolveProjectPath(root, relative);
  const stat = await fs.stat(target);
  if (!stat.isFile() || `${stat.size}:${stat.mtimeMs}` !== options.version) throw new Error('磁盘文件已更改，请保留你的编辑并重新打开文件');
  const edits = options.edits?.slice().sort((a, b) => a.offset - b.offset);
  if (!edits?.length) throw new Error('没有需要保存的修改');
  let end = 0;
  let size = stat.size;
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.offset) || !Number.isSafeInteger(edit.end) || edit.offset < end || edit.end < edit.offset || edit.end > stat.size || typeof edit.content !== 'string') throw new Error('无效的文件编辑范围');
    end = edit.end;
    size += Buffer.byteLength(edit.content) - (edit.end - edit.offset);
  }
  if (size > MAX_BYTES) throw new Error('保存后的文件超过 250 MB 上限');
  const temp = target + '.' + require('node:crypto').randomUUID() + '.tmp';
  const source = await fs.open(target, 'r');
  let output;
  try {
    output = await fs.open(temp, 'wx', stat.mode);
    const buffer = Buffer.alloc(1024 * 1024);
    const write = async data => { let offset = 0; while (offset < data.length) offset += (await output.write(data, offset, data.length - offset)).bytesWritten; };
    const copy = async (start, stop) => {
      while (start < stop) {
        const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, stop - start), start);
        if (!bytesRead) throw new Error('文件在保存期间已更改');
        await write(buffer.subarray(0, bytesRead)); start += bytesRead;
      }
    };
    let position = 0;
    for (const edit of edits) { await copy(position, edit.offset); await write(Buffer.from(edit.content)); position = edit.end; }
    await copy(position, stat.size);
    await output.sync();
    await output.close(); output = null;
    await source.close();
    const latest = await fs.stat(target);
    if (`${latest.size}:${latest.mtimeMs}` !== options.version) throw new Error('磁盘文件已更改，未覆盖你的文件');
    await fs.rename(temp, target);
    return { ok: true };
  } finally { await output?.close(); await source.close().catch(() => {}); await fs.rm(temp, { force: true }).catch(() => {}); }
}

module.exports = { registerProjectFilesIpc, resolveProjectPath, listProjectFiles, readProjectFile, saveProjectEdits };
