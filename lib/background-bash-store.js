'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Persist bounded snapshots, never executable requests/credentials. Recovered
// work is displayed as interrupted; restarting the app must not rerun commands.
function createBashStore(directory) {
  if (!directory) return { load: () => [], save() {}, flush() {} };
  const file = path.join(directory, 'bash-jobs.json');
  let latest, timer;
  const records = new Map();
  function flush() {
    clearTimeout(timer); timer = null;
    if (!latest) return;
    const value = latest; latest = null;
    try {
      fs.mkdirSync(directory, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, jobs: value }));
      fs.renameSync(temporary, file);
    } catch (error) { console.warn('[bash] snapshot save failed:', error.message); }
  }
  return {
    load() {
      try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); const jobs = data.version === 1 && Array.isArray(data.jobs) ? data.jobs.slice(-128) : []; for (const job of jobs) records.set(job.id, job); return jobs; }
      catch { return []; }
    },
    save(job, removedSession) {
      if (removedSession) for (const [id, row] of records) if (row.sessionId === removedSession) records.delete(id);
      if (job) { records.delete(job.id); records.set(job.id, { ...job, truncated: job.truncated || String(job.output || '').length > 16000, output: String(job.output || '').slice(-16000) }); }
      while (records.size > 128) records.delete(records.keys().next().value);
      latest = [...records.values()];
      if (!timer) timer = setTimeout(flush, 500);
    }, flush
  };
}
module.exports = { createBashStore };
