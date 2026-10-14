'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDeletionFence } = require('../lib/deletion-fence');

async function readWorkspaceMeta(dataDir) {
  // Read only Yan's workspace visibility preference from a consistent copy of
  // its Electron store. Never open the live database with a second writer.
  const source = path.join(path.dirname(dataDir), 'Local Storage', 'leveldb');
  try { await fs.access(source); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  // classic-level only ships inside the dev workspace runtime (.local). In a
  // packaged build it is absent, so degrade to no sidebar metadata instead of
  // failing the whole project list.
  let ClassicLevel;
  try {
    ({ ClassicLevel } = require('../.local/webui-runtime/node_modules/classic-level'));
  } catch {
    try { ({ ClassicLevel } = require('classic-level')); } catch { return {}; }
  }
  const snapshot = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-webui-preferences-'));
  const databasePath = path.join(snapshot, 'leveldb');
  let database;
  try {
    await fs.cp(source, databasePath, { recursive: true, filter: filename => path.basename(filename) !== 'LOCK' });
    database = new ClassicLevel(databasePath, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    await database.open();
    for await (const [key, value] of database.iterator()) {
      if (!key.toString('utf8').endsWith('\u0000\u0001yan.workspace-sidebar-meta.v1')) continue;
      const json = value.subarray(1).toString(value[0] === 0 ? 'utf16le' : 'utf8');
      const meta = JSON.parse(json);
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) return meta;
    }
    return {};
  } finally {
    if (database) await database.close();
    await fs.rm(snapshot, { recursive: true, force: true });
  }
}

async function readProjects(dataDir) {
  const directory = path.join(dataDir, 'sessions');
  let files;
  try { files = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  let archives = {};
  try { archives = JSON.parse(await fs.readFile(path.join(directory, '.archived'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const meta = await readWorkspaceMeta(dataDir);
  const deleted = createDeletionFence(directory);
  const groups = new Map();
  for (const file of files.filter(name => /^sess_[A-Za-z0-9_-]+\.json$/.test(name))) {
    let task;
    try { task = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')); } catch { continue; }
    if (!task.id || archives[task.id] || task.archived || deleted.has(task.id)) continue;
    const workspace = String(task.workspace || '').trim();
    const key = workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || 'blank';
    if (meta[key]?.hidden) continue;
    if (workspace) { try { await fs.access(workspace); } catch { continue; } }
    if (!groups.has(key)) groups.set(key, { workspace, label: workspace ? path.win32.basename(workspace.replace(/[\\/]+$/, '')) : 'blank', tasks: [], latest: 0, pinned: !!meta[key]?.pinned });
    const group = groups.get(key);
    group.tasks.push({ id: task.id, title: task.title, updatedAt: Number(task.updatedAt) || 0 });
    group.latest = Math.max(group.latest, Number(task.updatedAt) || 0);
  }
  return [...groups.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.latest - a.latest).map(group => ({ ...group, tasks: group.tasks.sort((a, b) => b.updatedAt - a.updatedAt) }));
}

module.exports = { readProjects, readWorkspaceMeta };
