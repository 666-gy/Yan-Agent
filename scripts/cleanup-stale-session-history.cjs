'use strict';

// Archive orphaned workspace conversations using Yan's existing archive format.
const fs = require('node:fs/promises');
const path = require('node:path');
async function main() {
  const directory = path.join(process.env.APPDATA, 'yan-agent', 'YanData', 'sessions');
  const archiveFile = path.join(directory, '.archived');
  let archives = {};
  try { archives = JSON.parse(await fs.readFile(archiveFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stale = [];
  for (const name of await fs.readdir(directory)) {
    if (!/^sess_[A-Za-z0-9_-]+\.json$/.test(name)) continue;
    let session;
    try { session = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); } catch { continue; }
    if (!session.id || !session.workspace || archives[session.id]) continue;
    try { await fs.access(session.workspace); }
    catch (error) { if (error.code === 'ENOENT') stale.push(session.id); else throw error; }
  }
  if (process.argv.includes('--apply') && stale.length) {
    const backupDir = path.resolve(__dirname, '../.local/webui-history-recovery');
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = Date.now();
    await fs.writeFile(path.join(backupDir, `archives-before-${stamp}.json`), JSON.stringify(archives, null, 2));
    await fs.writeFile(path.join(backupDir, `cleanup-${stamp}.json`), JSON.stringify({ archivedAt: stamp, ids: stale }, null, 2));
    for (const id of stale) archives[id] = stamp;
    const temporary = archiveFile + '.webui-cleanup.tmp';
    await fs.writeFile(temporary, JSON.stringify(archives));
    await fs.rename(temporary, archiveFile);
  }
  console.log(JSON.stringify({ applied: process.argv.includes('--apply'), staleSessions: stale.length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
