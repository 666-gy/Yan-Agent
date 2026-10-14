'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Old tool outputs begin with JSON and may append human-readable status text.
function outputObject(output) {
  if (output && typeof output === 'object') return output;
  try { return JSON.parse(String(output).split(/\r?\n\r?\n/)[0]); } catch { return {}; }
}
function sessionApps(session) {
  const apps = [];
  for (const message of session.messages || []) {
    const calls = new Map(), processes = new Map();
    for (const event of message.agentRun?.timeline || []) {
      if (!/(?:^|_)computer_/.test(event.name || '')) continue;
      if (event.type === 'tool_call') { calls.set(event.callId, event); continue; }
      const call = calls.get(event.callId);
      if (event.type !== 'tool_result' || !call || event.ok !== true) continue;
      const result = outputObject(event.output);
      if (result.isError || result.error || result.ok === false) continue;
      const args = call.args || {}, time = event.completedAt || call.startedAt || 0;
      if (/_list_(apps|windows)$/.test(call.name)) {
        for (const item of result.apps || result.windows || []) {
          if (item.pid && (item.path || item.executable_path)) processes.set(item.pid, { path: item.path || item.executable_path, name: item.name });
        }
        continue;
      }
      if (/_check_permissions$/.test(call.name)) continue;
      let item = processes.get(args.pid);
      if (/_launch_app$/.test(call.name) && args.path && result.running === true) {
        item = { path: args.path, name: result.windows?.[0]?.title };
        if (result.pid) processes.set(result.pid, item);
      }
      if (item) apps.push({ ...item, lastUsedAt: time });
    }
  }
  return apps;
}

function createHistoryImporter(dataDir, importApp, knownApps) {
  const seen = new Map();
  return () => {
    const sessions = path.join(dataDir, 'sessions');
    if (fs.existsSync(sessions)) for (const file of fs.readdirSync(sessions).filter(f => f.endsWith('.json'))) {
      const full = path.join(sessions, file);
      try {
        const stat = fs.statSync(full), stamp = `${stat.mtimeMs}:${stat.size}`;
        if (seen.get(full) === stamp) continue;
        const session = JSON.parse(fs.readFileSync(full, 'utf8'));
        for (const item of sessionApps(session)) importApp(item);
        seen.set(full, stamp);
      } catch { /* A session may be in the middle of being saved. Retry next refresh. */ }
    }
    const reports = path.join(dataDir, 'Computer-Use-Astra');
    if (fs.existsSync(reports)) for (const file of fs.readdirSync(reports).filter(f => f.endsWith('.md'))) {
      try {
        const full = path.join(reports, file), markdown = fs.readFileSync(full, 'utf8');
        const name = markdown.match(/^app:\s*(.+)$/m)?.[1]?.trim() || path.basename(file, '.md');
        const process = markdown.match(/^process:\s*(.+)$/m)?.[1]?.trim();
        const paths = [...markdown.matchAll(/[A-Za-z]:\\[^\r\n<>"`|。；]*?\.exe\b/gi)].map(match => match[0]);
        const executable = paths.find(p => !process || path.win32.basename(p).toLowerCase() === process.toLowerCase())
          || knownApps().find(app => path.win32.basename(app.path).toLowerCase() === process?.toLowerCase())?.path;
        if (executable) importApp({ path: executable, name, lastUsedAt: fs.statSync(full).mtimeMs, legacyReport: file });
      } catch { /* Ignore incomplete legacy documents. */ }
    }
  };
}
module.exports = { createHistoryImporter, sessionApps };
