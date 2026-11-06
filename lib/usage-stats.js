'use strict';

const fs = require('node:fs');
const path = require('node:path');

const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

// Kernel output excludes reasoning; input excludes cache reads and writes.
// Do not add tokens.total as well: it is the same usage, when supplied.
function tokenUsage(tokens = {}) {
  const input = count(tokens.input);
  const output = count(tokens.output);
  const reasoning = count(tokens.reasoning);
  const cacheRead = count(tokens.cache?.read);
  const cacheWrite = count(tokens.cache?.write);
  return { input, output, reasoning, cacheRead, cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite };
}

function normalizeOptions(options = {}) {
  const range = options?.range ?? 'all';
  if (!['all', '90d', '30d', '7d'].includes(range)) throw new Error('Invalid usage range');
  const timeZone = options?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof timeZone !== 'string' || timeZone.length > 100) throw new Error('Invalid time zone');
  new Intl.DateTimeFormat('en', { timeZone }).format();
  const sessionIds = Array.isArray(options.sessionIds) ? [...new Set(options.sessionIds.filter(id => typeof id === 'string' && id.length < 256))] : null;
  return { range, timeZone, ...(sessionIds ? { sessionIds } : {}) };
}

function aggregateUsage(rows, sessions, options = {}, now = Date.now()) {
  const { range, timeZone, sessionIds } = normalizeOptions(options);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const local = timestamp => {
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  };
  const today = local(now).date;
  const start = range === 'all' ? '' : new Date(Date.parse(`${today}T00:00:00Z`) - (parseInt(range, 10) - 1) * 86400000).toISOString().slice(0, 10);
  const roots = new Map();
  const rootOf = id => {
    if (roots.has(id)) return roots.get(id);
    const visited = new Set(); let root = id;
    while (sessions.get(root) && !visited.has(root)) { visited.add(root); root = sessions.get(root); }
    roots.set(id, root); return root;
  };
  const activeSessions = new Set(), days = new Map(), models = new Map();
  const hours = Array(24).fill(0);
  let messages = 0, unreportedMessages = 0;
  const allowed = sessionIds ? new Set(sessionIds) : null;
  for (const row of rows) {
    if (allowed && !allowed.has(rootOf(row.session_id)) && !allowed.has(row.session_id)) continue;
    if (!['user', 'assistant'].includes(row.role)) continue;
    const timestamp = Number(row.created);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) continue;
    const { date, hour } = local(timestamp);
    if (start && date < start) continue;
    activeSessions.add(rootOf(row.session_id)); messages++; hours[hour]++;
    if (!days.has(date)) days.set(date, { date, messages: 0, total: 0, models: {} });
    const day = days.get(date); day.messages++;
    if (row.role !== 'assistant') continue;
    let tokens;
    try { tokens = typeof row.tokens === 'string' ? JSON.parse(row.tokens) : row.tokens; } catch { tokens = null; }
    if (!tokens || !['input', 'output', 'reasoning'].some(key => typeof tokens[key] === 'number')) unreportedMessages++;
    const usage = tokenUsage(tokens || {});
    const modelId = String(row.model || 'Unknown model'), providerId = String(row.provider || 'Unknown provider');
    const key = JSON.stringify([providerId, modelId]);
    if (!models.has(key)) models.set(key, { key, modelId, providerId, messages: 0, ...tokenUsage() });
    const model = models.get(key); model.messages++;
    for (const field of Object.keys(usage)) model[field] += usage[field];
    day.total += usage.total;
    day.models[key] = (day.models[key] || 0) + usage.total;
  }
  const modelList = [...models.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const totals = tokenUsage();
  for (const model of modelList) for (const field of Object.keys(totals)) totals[field] += model[field];
  return { range, timeZone, today, generatedAt: now, overview: {
    sessions: activeSessions.size, messages, activeDays: days.size, ...totals,
    peakHour: messages ? hours.indexOf(Math.max(...hours)) : null,
    favoriteModel: modelList.find(model => model.total > 0)?.modelId || null, unreportedMessages
  }, models: modelList.map(model => ({ ...model, share: totals.total ? model.total / totals.total : 0 })),
  days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

function usageDatabaseFiles(dataDir) {
  const files = ['opencode-runtime', 'opencode-runtime-v2'].map(root => path.join(dataDir, root, 'data', 'opencode', 'opencode.db'));
  const pooled = path.join(dataDir, 'opencode-sessions-v2');
  if (fs.existsSync(pooled)) for (const entry of fs.readdirSync(pooled, {withFileTypes:true})) {
    if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) files.push(path.join(pooled, entry.name, 'opencode-runtime-v2', 'data', 'opencode', 'opencode.db'));
  }
  return files;
}

function readUsageDatabase(file, options, now) {
  if (Array.isArray(file)) {
    const sources = file.map(readUsageRows);
    // Migrated sessions can remain in the legacy database. The isolated copy owns their counters.
    const owners = new Map();
    sources.forEach((source, index) => { for (const id of source.sessions.keys()) owners.set(id, index); });
    return aggregateUsage(sources.flatMap((source, index) => source.rows.filter(row => owners.get(row.session_id) === index)), new Map(sources.flatMap(source => [...source.sessions])), options, now);
  }
  const source = readUsageRows(file);
  return aggregateUsage(source.rows, source.sessions, options, now);
}

function readUsageRows(file) {
  if (!fs.existsSync(file)) return { rows: [], sessions: new Map() };
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000; BEGIN');
    const v2 = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_v2'").get();
    const sessions = new Map(db.prepare(`SELECT id, parent_id FROM ${v2 ? 'session_v2' : 'session'}`).all().map(row => [row.id, row.parent_id]));
    // Project only counters/identifiers, never message text or tool payloads.
    const rows = db.prepare(v2 ? `SELECT session_id, time_created AS created, type AS role,
      json_extract(data, '$.model.id') AS model, json_extract(data, '$.model.providerID') AS provider,
      json_extract(data, '$.tokens') AS tokens FROM session_message WHERE json_valid(data) AND type IN ('user', 'assistant')` : `SELECT session_id, time_created AS created,
      json_extract(data, '$.role') AS role, json_extract(data, '$.modelID') AS model,
      json_extract(data, '$.providerID') AS provider, json_extract(data, '$.tokens') AS tokens
      FROM message WHERE json_valid(data)`).all();
    return { rows, sessions };
  } finally { db.close(); }
}

module.exports = { usageDatabaseFiles, tokenUsage, normalizeOptions, aggregateUsage, readUsageDatabase };
