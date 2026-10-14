'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJson } = require('./plugins/store');
const { createHistoryImporter } = require('./computer-control-history');
const { createDeletionFence } = require('./deletion-fence');
const { normalizeExperienceMarkdown } = require('./experience-markdown');

function executablePath(value) {
  const input = String(value || '').trim();
  if (!path.win32.isAbsolute(input) || !/\.exe$/i.test(input) || /[\r\n\0]/.test(input)) throw new Error('请选择有效的 EXE 程序');
  return path.win32.normalize(input);
}
const appId = value => crypto.createHash('sha256').update(executablePath(value).toLowerCase()).digest('hex');

function createComputerControlStore(dataDir) {
  const root = path.join(dataDir, 'computer-control');
  const settingsFile = path.join(root, 'settings.json');
  const appsDir = path.join(root, 'apps');
  const fence = createDeletionFence(root);
  const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  function settings() { return { enabled: true, allowedApps: [], ...read(settingsFile) }; }
  function update(partial) {
    const current = settings();
    if (typeof partial.enabled === 'boolean') current.enabled = partial.enabled;
    atomicJson(settingsFile, current); return current;
  }
  function allow(executable, name) {
    const exe = executablePath(executable), id = appId(exe), current = settings();
    if (!current.allowedApps.some(item => item.id === id)) current.allowedApps.push({ id, path: exe, name: name || path.win32.basename(exe, path.win32.extname(exe)) });
    atomicJson(settingsFile, current); return current;
  }
  function disallow(id) {
    const current = settings(); current.allowedApps = current.allowedApps.filter(item => item.id !== id);
    atomicJson(settingsFile, current); return current;
  }
  function appDirectory(id) {
    if (!/^[a-f0-9]{64}$/.test(String(id))) throw new Error('无效应用记录');
    return path.join(appsDir, id);
  }
  function record(executable, name) {
    const exe = executablePath(executable), id = appId(exe), dir = appDirectory(id);
    const previous = read(path.join(dir, 'app.json'));
    const item = { ...previous, id, path: exe, name: previous?.name || name || path.win32.basename(exe, path.win32.extname(exe)), lastUsedAt: Date.now() };
    atomicJson(path.join(dir, 'app.json'), item); return item;
  }
  function storedApps() {
    if (!fs.existsSync(appsDir)) return [];
    return fs.readdirSync(appsDir).filter(id => /^[a-f0-9]{64}$/.test(id))
      .map(id => read(path.join(appDirectory(id), 'app.json'))).filter(Boolean).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }
  const importHistory = createHistoryImporter(dataDir, item => {
    const exe = executablePath(item.path), id = appId(exe), file = path.join(appDirectory(id), 'app.json');
    if (fence.has(id)) return;
    const previous = read(file);
    const next = { ...previous, id, path: previous?.path || exe, name: item.legacyReport ? item.name : previous?.name || item.name || path.win32.basename(exe, '.exe'), lastUsedAt: Math.max(previous?.lastUsedAt || 0, item.lastUsedAt || 0) };
    if (item.legacyReport) next.legacyReport = item.legacyReport;
    if (JSON.stringify(previous) !== JSON.stringify(next)) atomicJson(file, next);
  }, storedApps);
  function list() { importHistory(); return storedApps(); }
  function legacyFile(app) {
    const name = app?.legacyReport;
    return typeof name === 'string' && path.basename(name) === name && !/[\\/]/.test(name) && name.endsWith('.md')
      ? path.join(dataDir, 'Computer-Use-Astra', name) : null;
  }
  function readExperienceParts(app) {
    const canonicalFile = path.join(appDirectory(app.id), 'experience.md');
    const legacy = legacyFile(app);
    const canonicalMarkdown = fs.existsSync(canonicalFile) ? fs.readFileSync(canonicalFile, 'utf8').trim() : '';
    const legacyMarkdown = legacy && fs.existsSync(legacy) ? fs.readFileSync(legacy, 'utf8').trim() : '';
    return { canonicalMarkdown, legacyMarkdown };
  }
  function experience(id) {
    const dir = appDirectory(id), app = read(path.join(dir, 'app.json'));
    if (!app) throw new Error('该应用记录已不存在');
    const { canonicalMarkdown, legacyMarkdown } = readExperienceParts(app);
    return { app, markdown: [legacyMarkdown, canonicalMarkdown].filter(Boolean).join('\n\n---\n\n') };
  }
  // A single canonical Markdown document per executable. Workflow review will
  // write here; the settings page never invents experience from observation.
  function writeExperience(id, markdown) {
    const { app } = experience(id);
    markdown = normalizeExperienceMarkdown(markdown, { title: app.name }).markdown;
    const dir = appDirectory(app.id), file = path.join(dir, 'experience.md');
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, String(markdown), 'utf8'); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
  function recordReview(executable, markdown, name) {
    const next = normalizeExperienceMarkdown(markdown, { title: name || '操控经验' }).markdown.trim();
    const app = record(executable, name);
    // Legacy reports are displayed alongside the canonical document, but are
    // not copied into the canonical file on every review.
    const previous = readExperienceParts(app).canonicalMarkdown;
    if (previous.includes(next)) return app;
    writeExperience(app.id, previous && next ? `${previous}\n\n---\n\n${next}` : (next || previous));
    return app;
  }
  function recordPendingReview(executable, request, name) {
    const app = record(executable, name);
    atomicJson(path.join(appDirectory(app.id), 'pending-review.json'), {
      status: 'pending', updatedAt: Date.now(), request
    });
    return app;
  }
  // Deleting an app removes its whole record and every artifact it owns, and
  // writes a deletion fence so replayed session history cannot recreate it.
  function removeApp(id) {
    const dir = appDirectory(id);
    const app = read(path.join(dir, 'app.json'));
    fence.mark(id);
    const legacy = legacyFile(app);
    if (legacy) fs.rmSync(legacy, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  }
  return { settings, update, allow, disallow, record, recordReview, recordPendingReview, list, experience, writeExperience, removeApp };
}
module.exports = { createComputerControlStore, executablePath, appId };
