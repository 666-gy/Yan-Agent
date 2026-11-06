'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { redact } = require('../runtime-logs');

function watchProcess(child, directory, { secrets = [], requestedStop = () => '', onExit = () => {} } = {}) {
  const file = path.join(directory, `kernel-${child.pid || process.pid}.jsonl`);
  const startedAt = Date.now();
  let tail = '', pending = '', partial = '', dropping = false, timer;
  const clean = value => {
    let text = String(value);
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]');
    return redact(text).replace(/\u001b\[[0-9;]*m/g, '');
  };
  function write(event) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
        fs.rmSync(file + '.1', { force: true }); fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: child.pid, ...event }) + '\n');
    } catch { /* Diagnostics must not bring down the host. */ }
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (pending) { const text = pending; pending = ''; tail = (tail + text).slice(-8192); write({ event: 'stderr', text }); }
  }
  try {
    fs.mkdirSync(directory, { recursive: true });
    const old = fs.readdirSync(directory).filter(name => /^kernel-\d+\.jsonl(?:\.1)?$/.test(name))
      .map(name => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs })).sort((a, b) => b.time - a.time);
    for (const item of old.slice(19)) fs.rmSync(path.join(directory, item.name), { force: true });
  } catch {}
  write({ event: 'started', startedAt });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', data => {
    // Redact complete lines before truncation or flushing. A token split across
    // stream chunks must never escape into diagnostics in two separate writes.
    const pieces = String(data).split('\n');
    for (let index = 0; index < pieces.length; index++) {
      if (!dropping) partial += pieces[index];
      if (partial.length > 16384) { partial = ''; dropping = true; }
      if (index < pieces.length - 1) {
        pending = (pending + (dropping ? '[oversized diagnostic line omitted]' : clean(partial)) + '\n').slice(-16384);
        partial = ''; dropping = false;
      }
    }
    if (!timer) { timer = setTimeout(flush, 500); timer.unref?.(); }
  });
  child.once('error', error => write({ event: 'process-error', message: clean(error.message) }));
  child.once('exit', (code, signal) => {
    if (partial && !dropping) pending = (pending + clean(partial)).slice(-16384);
    flush();
    const record = { event: 'exit', pid: child.pid, code, signal, uptimeMs: Date.now() - startedAt,
      reason: requestedStop() || 'unexpected_exit', lastStderr: tail };
    write(record); onExit(record);
  });
}
module.exports = { watchProcess };
