'use strict';

// P0-3: long-horizon task protocol across sessions.
// Storage: <workspace>/.yanagent/agi/long-horizon/<taskId>/
// Artifacts: feature-list.json, progress.md, init.sh, protocol.json.
// Reuses only the shared primitives from ./contracts (no new dependencies).

const fs = require('fs');
const path = require('path');
const {
  clip,
  normalizeId,
  stableHash,
  readJson,
  writeJsonAtomic,
  appendTextAtomic,
  containsUnsafeText
} = require('./contracts');

const TITLE_MAX = 300;
const EVIDENCE_MAX = 600;
const NOTE_MAX = 600;
const COMMAND_MAX = 2000;
const GOAL_MAX = 500;
const PROGRESS_TAIL_MAX = 2000;

function nowMs(now) {
  if (typeof now === 'function') {
    const value = now();
    if (Number.isFinite(value)) return value;
  }
  if (Number.isFinite(now)) return now;
  return Date.now();
}

function isoOf(now) {
  return new Date(nowMs(now)).toISOString();
}

function fail(error) {
  return { ok: false, error: String(error) };
}

function taskIdFor(goal) {
  return normalizeId(`lh-${stableHash(goal).slice(0, 12)}`);
}

function storageRoot(workspace) {
  return path.join(String(workspace), '.yanagent', 'agi', 'long-horizon');
}

function taskDir(workspace, taskId) {
  return path.join(storageRoot(workspace), taskId);
}

// Creates or idempotently refreshes the four protocol artifacts.
function ensureProtocol({ workspace, goal, features, smokeCommands = [], now } = {}) {
  const ws = clip(workspace, 1000);
  const cleanGoal = clip(goal, GOAL_MAX);
  if (!ws) return fail('workspace required');
  if (!cleanGoal) return fail('goal required');
  if (containsUnsafeText(ws) || containsUnsafeText(cleanGoal)) return fail('unsafe text rejected');
  if (!Array.isArray(features) || features.length === 0) return fail('at least one feature required');

  const commands = [];
  for (const raw of Array.isArray(smokeCommands) ? smokeCommands : []) {
    if (raw === null || raw === undefined) continue;
    const command = clip(raw, COMMAND_MAX);
    if (!command) continue;
    if (containsUnsafeText(command)) return fail('unsafe smoke command rejected');
    commands.push(command);
  }

  const definitions = [];
  for (let index = 0; index < features.length; index += 1) {
    const item = features[index];
    if (!item || typeof item !== 'object') return fail(`feature[${index}] must be an object`);
    const title = clip(item.title, TITLE_MAX);
    const rawId = clip(item.id, 80);
    if (!title) return fail(`feature[${index}].title required`);
    if (containsUnsafeText(title) || containsUnsafeText(rawId)) return fail('unsafe feature rejected');
    definitions.push({ id: normalizeId(rawId) || normalizeId(title) || `f${index + 1}`, title });
  }

  const taskId = taskIdFor(cleanGoal);
  const dir = taskDir(ws, taskId);
  const listPath = path.join(dir, 'feature-list.json');
  const protocolPath = path.join(dir, 'protocol.json');
  const progressPath = path.join(dir, 'progress.md');
  const initPath = path.join(dir, 'init.sh');

  const existingList = readJson(listPath, null);
  const existingFeatures = existingList && Array.isArray(existingList.features) ? existingList.features : [];
  const merged = [];
  const seen = new Set();
  for (const existing of existingFeatures) {
    if (!existing || typeof existing !== 'object') continue;
    const id = normalizeId(existing.id) || `f${merged.length + 1}`;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push({
      id,
      title: clip(existing.title, TITLE_MAX),
      status: existing.status === 'passing' ? 'passing' : 'failing',
      evidence: clip(existing.evidence, EVIDENCE_MAX)
    });
  }
  // New definitions only append; an existing id keeps its status/evidence.
  for (const definition of definitions) {
    if (seen.has(definition.id)) continue;
    seen.add(definition.id);
    merged.push({ id: definition.id, title: definition.title, status: 'failing', evidence: '' });
  }

  const createdAt = existingList && typeof existingList.createdAt === 'string' && existingList.createdAt
    ? existingList.createdAt
    : isoOf(now);

  writeJsonAtomic(listPath, { version: 1, taskId, goal: cleanGoal, createdAt, features: merged });

  if (!fs.existsSync(progressPath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(progressPath, `# Progress — ${cleanGoal}\n`, 'utf8');
  }

  // LF-only shell script; not executed by tests (Windows can run it via bash/git-bash).
  const scriptLines = ['#!/usr/bin/env bash', 'set -e', '', `# long-horizon smoke for ${taskId}`];
  for (const command of commands) scriptLines.push(command);
  scriptLines.push('', `echo "smoke ok: ${taskId}"`, '');
  fs.writeFileSync(initPath, scriptLines.join('\n'), 'utf8');

  const protocol = { version: 1, taskId, goal: cleanGoal, smokeCommands: commands, updatedAt: isoOf(now) };
  writeJsonAtomic(protocolPath, protocol);

  return { ok: true, taskId, dir, protocol };
}

// Returns { protocol, dir } for the most recently updated task, or null.
function loadProtocol({ workspace } = {}) {
  const ws = clip(workspace, 1000);
  if (!ws) return null;
  const root = storageRoot(ws);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  let best = null;
  for (const entry of entries) {
    if (!entry || typeof entry.isDirectory !== 'function' || !entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const protocol = readJson(path.join(dir, 'protocol.json'), null);
    if (!protocol || typeof protocol !== 'object' || !protocol.taskId || typeof protocol.goal !== 'string') continue;
    const updatedAt = typeof protocol.updatedAt === 'string' ? protocol.updatedAt : '';
    if (!best || updatedAt >= best.updatedAt) best = { protocol, dir, updatedAt };
  }
  return best ? { protocol: best.protocol, dir: best.dir } : null;
}

// Reads one stored protocol plus its feature list and progress tail.
function readProtocol({ workspace, taskId } = {}) {
  const ws = clip(workspace, 1000);
  const id = normalizeId(taskId);
  if (!ws || !id) return fail('workspace and taskId required');
  const dir = taskDir(ws, id);
  const protocol = readJson(path.join(dir, 'protocol.json'), null);
  if (!protocol || typeof protocol !== 'object') return fail('protocol not found');
  const list = readJson(path.join(dir, 'feature-list.json'), null);
  const features = list && Array.isArray(list.features) ? list.features : [];
  let progressTail = '';
  try {
    const raw = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
    progressTail = raw.length > PROGRESS_TAIL_MAX ? raw.slice(-PROGRESS_TAIL_MAX) : raw;
  } catch {
    progressTail = '';
  }
  return { ok: true, protocol, features, progressTail };
}

// Updates one feature. Passing requires non-empty evidence (clipped to 600).
function updateFeature({ workspace, taskId, featureId, status, evidence, now } = {}) {
  const ws = clip(workspace, 1000);
  const id = normalizeId(taskId);
  const fid = normalizeId(featureId);
  if (!ws || !id || !fid) return fail('workspace, taskId and featureId required');
  if (status !== 'passing' && status !== 'failing') return fail('status must be passing or failing');
  const cleanEvidence = clip(evidence, EVIDENCE_MAX);
  if (status === 'passing' && !cleanEvidence) return fail('evidence required for passing');
  if (cleanEvidence && containsUnsafeText(cleanEvidence)) return fail('unsafe evidence rejected');

  const listPath = path.join(taskDir(ws, id), 'feature-list.json');
  const list = readJson(listPath, null);
  if (!list || typeof list !== 'object' || !Array.isArray(list.features)) return fail('feature list not found');
  const feature = list.features.find(item => item && normalizeId(item.id) === fid);
  if (!feature) return fail(`feature not found: ${fid}`);

  feature.status = status;
  feature.evidence = cleanEvidence;
  writeJsonAtomic(listPath, list);
  return { ok: true, feature, features: list.features };
}

// Appends a timestamped progress line; notes are clipped to 600 chars.
function recordProgress({ workspace, taskId, note, runId = '', now } = {}) {
  const ws = clip(workspace, 1000);
  const id = normalizeId(taskId);
  if (!ws || !id) return fail('workspace and taskId required');
  const dir = taskDir(ws, id);
  const protocol = readJson(path.join(dir, 'protocol.json'), null);
  if (!protocol || typeof protocol !== 'object') return fail('protocol not found');

  const progressPath = path.join(dir, 'progress.md');
  if (!fs.existsSync(progressPath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(progressPath, `# Progress — ${clip(protocol.goal, GOAL_MAX)}\n`, 'utf8');
  }
  const text = clip(note, NOTE_MAX);
  const run = clip(runId, 80);
  const line = `- [${isoOf(now)}] ${text}${run ? ` (run ${run})` : ''}`.trimEnd();
  appendTextAtomic(progressPath, `${line}\n`);
  return { ok: true, line, file: progressPath };
}

// Returns the smoke commands and a note about running them on Windows.
function smokePlan(protocol) {
  const commands = [];
  if (protocol && Array.isArray(protocol.smokeCommands)) {
    for (const raw of protocol.smokeCommands) {
      const command = clip(raw, COMMAND_MAX);
      if (command) commands.push(command);
    }
  }
  const taskId = protocol && protocol.taskId ? protocol.taskId : '<taskId>';
  const note = commands.length
    ? `Windows 下请用 bash 或 Git Bash 执行 init.sh（如 bash .yanagent/agi/long-horizon/${taskId}/init.sh）。`
    : '未登记冒烟命令；建议补充 smokeCommands 后在 bash/Git Bash 中执行 init.sh。';
  return { commands, note };
}

// Bounded prompt text for the next session: whole lines only, never a half line.
function renderProtocolPrompt({ protocol, features, progressTail = '', maxChars = 1800 } = {}) {
  const budget = Math.max(0, Number(maxChars) || 0);
  if (!budget) return '';
  const source = protocol && typeof protocol === 'object' ? protocol : {};
  const goal = clip(source.goal, 400) || '(no goal)';
  const all = Array.isArray(features) ? features : [];
  const failing = all.filter(item => item && item.status !== 'passing');
  const next = failing[0] || null;
  const progressLines = String(progressTail || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3);

  const lines = [];
  lines.push(`[long-horizon] goal: ${goal}`);
  lines.push(`failing: ${failing.length}/${all.length}`);
  lines.push(`next: ${next ? `${clip(next.id, 60)} — ${clip(next.title, 120)}` : 'all features passing'}`);
  if (failing.length) {
    lines.push(`todo (top ${Math.min(10, failing.length)}):`);
    failing.slice(0, 10).forEach((item, index) => {
      lines.push(`  ${index + 1}. ${clip(item.id, 60)}: ${clip(item.title, 120)}`);
    });
  }
  if (progressLines.length) {
    lines.push('progress (last 3):');
    for (const line of progressLines) lines.push(`  ${clip(line, 200)}`);
  }
  const { commands } = smokePlan(source);
  if (commands.length) {
    lines.push('smoke:');
    for (const command of commands.slice(0, 5)) lines.push(`  $ ${clip(command, 200)}`);
  }

  // Per-line cap keeps every emitted line short; the final cut lands on a newline.
  const cap = Math.max(80, Math.min(600, budget));
  const prepared = lines.map(line => (line.length > cap ? line.slice(0, cap) : line));
  const full = prepared.join('\n');
  if (full.length <= budget) return full;
  const cut = full.lastIndexOf('\n', budget - 1);
  if (cut > 0) return full.slice(0, cut);
  return full.slice(0, budget);
}

module.exports = {
  ensureProtocol,
  loadProtocol,
  readProtocol,
  updateFeature,
  recordProgress,
  smokePlan,
  renderProtocolPrompt
};
