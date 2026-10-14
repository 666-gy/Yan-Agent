'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { controlledAppsFromCalls } = require('./computer-control-review');

// Only this conversation's latest controlled episode may back a follow-up review.
function recentControlContext(dataDir, sessionId, runId) {
  if (!dataDir || !/^sess_[a-z0-9-]+$/i.test(sessionId || '')) return { apps: [], calls: [] };
  try {
    const session = JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions', `${sessionId}.json`), 'utf8'));
    for (const message of (session.messages || []).slice().reverse()) {
      const run = message.agentRun;
      if (!run || run.runId === runId) continue;
      const timeline = run.timeline || [];
      const calls = timeline.filter(item => item.type === 'tool_call').map(item => {
        const receipt = timeline.find(r => r.type === 'tool_result' && r.callId === item.callId);
        return { name: item.name, args: item.args, output: receipt?.output, ok: receipt?.ok };
      });
      const apps = controlledAppsFromCalls(calls);
      if (apps.length) return { apps, calls };
    }
  } catch { /* Missing/deleted conversations do not authorize attribution. */ }
  return { apps: [], calls: [] };
}

function namedControlApps(instructions, apps) {
  const text = String(instructions || '').toLowerCase();
  return apps.filter(app => text.includes(app.path.toLowerCase())
    || (app.name && text.includes(app.name.toLowerCase())));
}
module.exports = { recentControlContext, namedControlApps };
