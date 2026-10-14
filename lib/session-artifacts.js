'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const keyOf = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function pathsIn(value, paths = new Set()) {
  if (!value || typeof value !== 'object') return paths;
  for (const [key, entry] of Object.entries(value)) {
    if (['path', 'filePath', 'localPath'].includes(key) && typeof entry === 'string' && path.isAbsolute(entry)) paths.add(path.resolve(entry));
    else if (typeof entry === 'string' && entry.startsWith('file:')) {
      try { paths.add(fileURLToPath(entry)); } catch {}
    }
    else if (entry && typeof entry === 'object') pathsIn(entry, paths);
  }
  return paths;
}
function assetsIn(value, ids = new Set()) {
  if (!value || typeof value !== 'object') return ids;
  for (const [key, entry] of Object.entries(value)) {
    if (['assetId', 'generatedImageId', 'generatedVideoId'].includes(key) && /^[a-f0-9]{32}$/i.test(entry)) ids.add(entry.toLowerCase());
    else if (entry && typeof entry === 'object') assetsIn(entry, ids);
  }
  return ids;
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function assertOwned(root, target) {
  if (!within(path.resolve(root), path.resolve(target))) throw new Error('拒绝清理应用目录外的文件');
  // Do not traverse junctions/symlinks, even if a task contains a forged path.
  let current = path.resolve(root);
  for (const part of ['', ...path.relative(current, path.resolve(target)).split(path.sep)]) {
    if (part) current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('拒绝清理符号链接中的会话文件'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}
function describeSessionArtifacts(records) {
  const paths = new Set(), assets = new Set(), workspaces = new Set();
  for (const record of records) {
    pathsIn(record, paths); assetsIn(record, assets);
    for (const workspace of [record.workspace, ...(record.messages || []).map(message => message?.agentRun?.workspace)]) {
      if (workspace) workspaces.add(workspace);
    }
  }
  return { paths: [...paths], assets: [...assets], workspaces: [...workspaces] };
}
function purgeSessionArtifacts({ sessionsDir, filesDir = path.join(path.dirname(sessionsDir), 'uploads'), record, interruptedContents = [], pendingContents = [], cleanupPlan = {} }) {
  const references = new Set();
  const sharedAssets = new Set();
  const remember = other => { pathsIn(other, references); assetsIn(other, sharedAssets); };
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.json') || name === record.id + '.json') continue;
    // Unreadable references must fail closed rather than delete shared files.
    remember(JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8')));
  }
  for (const content of pendingContents) remember(JSON.parse(content));
  const sharedPaths = new Set([...references].map(keyOf));
  const owned = [record, ...interruptedContents.map(content => JSON.parse(content))];
  const targets = new Set(cleanupPlan.paths || []), assets = new Set(cleanupPlan.assets || []);
  for (const value of owned) { pathsIn(value, targets); assetsIn(value, assets); }
  const mediaRoots = ['generated-images', 'generated-videos', 'generated-media'].map(name => path.join(path.dirname(sessionsDir), name));
  for (const directory of mediaRoots) {
    if (!fs.existsSync(directory)) continue;
    assertOwned(path.dirname(sessionsDir), directory);
    for (const name of fs.readdirSync(directory)) {
      const id = name.match(/^([a-f0-9]{32})\./i)?.[1]?.toLowerCase();
      if (id && assets.has(id) && !sharedAssets.has(id)) targets.add(path.join(directory, name));
    }
  }
  for (const file of targets) {
    const root = [filesDir, ...mediaRoots].find(dir => within(path.resolve(dir), file));
    const assetId = path.basename(file).match(/^([a-f0-9]{32})\./i)?.[1]?.toLowerCase();
    if (!root || sharedPaths.has(keyOf(file)) || (assetId && sharedAssets.has(assetId))) continue;
    assertOwned(root, file);
    fs.rmSync(file, { force: true });
  }
  const workspaces = new Set([...(cleanupPlan.workspaces || []), record.workspace, ...(record.messages || []).map(message => message?.agentRun?.workspace)].filter(Boolean));
  // Read an existing Blank-directory pin; resolving one would create files.
  const pin = path.join(path.dirname(sessionsDir), 'opencode-runtime', 'directory-pins', record.id + '.json');
  if (fs.existsSync(pin)) {
    const directory = JSON.parse(fs.readFileSync(pin, 'utf8')).directory;
    if (directory && path.isAbsolute(directory)) workspaces.add(directory);
  }
  for (const workspace of workspaces) {
    const target = path.join(workspace, '.yanagent', 'snapshots', record.id);
    assertOwned(workspace, target);
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.rmSync(pin, { force: true });
  for (const name of fs.readdirSync(sessionsDir)) {
    if (name.startsWith(record.id + '.json.tmp-')) fs.rmSync(path.join(sessionsDir, name), { force: true });
  }
}
module.exports = { purgeSessionArtifacts, describeSessionArtifacts };
