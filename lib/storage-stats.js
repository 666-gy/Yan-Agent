'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const CATEGORY_KEYS = ['chats', 'subagents', 'archivedChats', 'unclassifiedChats', 'worktrees', 'other'];
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const within = (file, root) => file === root || file.startsWith(root + path.sep);

// Source is validated JSON. Track its structure to count only the persisted
// messages[].agentRun.subagents array, never similarly named tool arguments.
// Count original bytes including formatting, without counting nested children twice.
function subagentBytes(source) {
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g;
  const stack = [];
  let match, bytes = 0;
  while ((match = tokens.exec(source))) {
    const token = match[0], parent = stack.at(-1);
    if (token === '{' || token === '[') {
      const tracked = token === '[' && stack.length === 4 && stack[1].segment === 'messages'
        && stack[1].kind === '[' && parent.segment === 'agentRun' && parent.key === 'subagents';
      stack.push({ kind: token, segment: parent?.kind === '{' ? parent.key : null, key: null,
        expectingKey: token === '{', start: match.index, tracked });
    } else if (token === '}' || token === ']') {
      const container = stack.pop();
      if (container.tracked && source.slice(container.start + 1, match.index).trim()) {
        bytes += Buffer.byteLength(source.slice(container.start, tokens.lastIndex));
      }
    } else if (token === ',' && parent?.kind === '{') parent.expectingKey = true;
    else if (token === ':' && parent?.kind === '{') parent.expectingKey = false;
    else if (token.startsWith('"') && parent?.expectingKey) {
      parent.key = JSON.parse(token);
      parent.expectingKey = false;
    }
  }
  return bytes;
}

async function collectStorageStats({ dataDir }) {
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('存储目录无效');
  const categories = Object.fromEntries(CATEGORY_KEYS.map(key => [key, 0]));
  const warnings = [];
  let warningCount = 0;
  const warn = message => { warningCount++; if (warnings.length < 20) warnings.push(message); };
  async function readMetadata(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`无法读取存储索引 ${path.basename(file)}：${error.message}`); }
  }
  const archives = await readMetadata(path.join(dataDir, 'sessions', '.archived'), {});
  const registry = await readMetadata(path.join(dataDir, 'managed-worktrees.json'), []);
  if (!archives || typeof archives !== 'object' || Array.isArray(archives)) throw new Error('聊天归档索引格式无效');
  if (!Array.isArray(registry)) throw new Error('工作树索引格式无效');
  const dataRoot = canonical(await fs.realpath(dataDir).catch(error => {
    if (error.code === 'ENOENT') return dataDir;
    throw error;
  }));
  const worktreeRoots = [];
  for (const record of registry) {
    if (!record || record.archived || typeof record.path !== 'string' || !path.isAbsolute(record.path)) continue;
    try {
      const stat = await fs.lstat(record.path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const root = canonical(await fs.realpath(record.path));
      // A malformed registry must never cause the entire drive/data parent to be scanned.
      if (within(dataRoot, root) || root === canonical(path.parse(root).root)) {
        warn(`已跳过无效工作树目录：${record.path}`); continue;
      }
      if (!worktreeRoots.some(existing => within(root, existing))) {
        for (let i = worktreeRoots.length - 1; i >= 0; i--) if (within(worktreeRoots[i], root)) worktreeRoots.splice(i, 1);
        worktreeRoots.push(root);
      }
    } catch (error) { if (error.code !== 'ENOENT') warn(`无法读取工作树 ${record.path}：${error.message}`); }
  }
  const sessionsRoot = canonical(path.join(dataRoot, 'sessions'));
  async function scan(root, isWorktree = false) {
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      try { entries = await fs.opendir(current); }
      catch (error) { if (error.code !== 'ENOENT') warn(`无法扫描 ${current}：${error.message}`); continue; }
      try {
        for await (const entry of entries) {
          const file = path.join(current, entry.name);
          try {
            const stat = await fs.lstat(file);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) { pending.push(file); continue; }
            if (!stat.isFile()) continue;
            const worktree = isWorktree || worktreeRoots.some(root => within(canonical(file), root));
            if (worktree) { categories.worktrees += stat.size; continue; }
            if (canonical(current) !== sessionsRoot || !entry.name.endsWith('.json')) { categories.other += stat.size; continue; }
            if (stat.size > MAX_SESSION_BYTES) {
              categories.unclassifiedChats += stat.size;
              warn(`聊天文件过大，已计入未分类聊天：${entry.name}`); continue;
            }
            let source;
            try {
              source = await fs.readFile(file, 'utf8');
              const session = JSON.parse(source);
              if (!session || typeof session.id !== 'string' || !Array.isArray(session.messages)) throw new Error('聊天格式无效');
              const size = Buffer.byteLength(source);
              const children = subagentBytes(source);
              categories.subagents += children;
              categories[Object.hasOwn(archives, session.id) ? 'archivedChats' : 'chats'] += size - children;
            } catch (error) {
              if (error.code === 'ENOENT') continue;
              categories.unclassifiedChats += source === undefined ? stat.size : Buffer.byteLength(source);
              warn(`无法分类聊天 ${entry.name}：${error.message}`);
            }
          } catch (error) { if (error.code !== 'ENOENT') warn(`无法读取 ${file}：${error.message}`); }
        }
      } catch (error) { warn(`扫描未完成 ${current}：${error.message}`); }
    }
  }
  await scan(dataRoot);
  for (const root of worktreeRoots) if (!within(root, dataRoot)) await scan(root, true);
  return { ok: true, dataDir, worktreeRoots, categories, totalBytes: Object.values(categories).reduce((a, b) => a + b, 0),
    scannedAt: new Date().toISOString(), partial: warningCount > 0, warningCount, warnings };
}

function reviewOptions(input = {}) {
  const days = input.days === undefined ? 30 : Number(input.days);
  const scope = input.scope === undefined ? 'archived' : input.scope;
  if (![30, 90, 180, 365].includes(days) || !['archived', 'all'].includes(scope)) throw new Error('旧聊天筛选条件无效');
  return { days, scope };
}

async function collectStorageReview({ dataDir, options }) {
  const { days, scope } = reviewOptions(options);
  const sessionsDir = path.join(dataDir, 'sessions');
  let archives = {}, entries;
  try { archives = JSON.parse(await fs.readFile(path.join(sessionsDir, '.archived'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取聊天归档索引'); }
  if (!archives || typeof archives !== 'object' || Array.isArray(archives)) throw new Error('聊天归档索引格式无效');
  try { entries = await fs.opendir(sessionsDir); }
  catch (error) { if (error.code === 'ENOENT') return { ok: true, chats: [], skipped: 0 }; throw error; }
  const chats = [], cutoff = Date.now() - days * 86400000;
  let skipped = 0;
  for await (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filename = path.join(sessionsDir, entry.name);
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (stat.size > MAX_SESSION_BYTES) { skipped++; continue; }
      const raw = await fs.readFile(filename);
      const record = JSON.parse(raw.toString('utf8'));
      if (!record || typeof record.id !== 'string' || !Array.isArray(record.messages) || entry.name !== `${record.id}.json`) { skipped++; continue; }
      const updatedAt = Number(record.updatedAt || record.createdAt);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) { skipped++; continue; }
      const archived = Object.hasOwn(archives, record.id);
      if (updatedAt >= cutoff || (scope === 'archived' && !archived)) continue;
      let subagents = 0;
      // Count nested records once; no message content is sent to the renderer.
      const pending = record.messages.flatMap(message => Array.isArray(message?.agentRun?.subagents) ? message.agentRun.subagents : []);
      while (pending.length) {
        const child = pending.pop();
        if (!child || typeof child !== 'object') continue;
        subagents++;
        if (Array.isArray(child.subagents)) pending.push(...child.subagents);
        for (const message of Array.isArray(child.messages) ? child.messages : []) {
          if (Array.isArray(message?.agentRun?.subagents)) pending.push(...message.agentRun.subagents);
        }
      }
      chats.push({ id: record.id, title: String(record.title || '新聊天'), updatedAt, archived, bytes: raw.length, subagents });
    } catch (error) { if (error.code !== 'ENOENT') skipped++; }
  }
  chats.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  return { ok: true, chats, skipped };
}

module.exports = { collectStorageStats, subagentBytes, collectStorageReview, reviewOptions };
