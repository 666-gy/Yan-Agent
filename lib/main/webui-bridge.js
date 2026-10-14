'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function registerWebuiBridge({ ipcMain, getMainWindow, dataDir }) {
  const token = crypto.randomBytes(32).toString('hex');
  const pending = new Map();
  const snapshots = new Map();
  const watches = new Map();
  const owner = event => event.sender === getMainWindow()?.webContents;
  ipcMain.on('webui:reply', (event, { id, result } = {}) => {
    if (!owner(event)) return;
    const request = pending.get(id);
    if (request) { clearTimeout(request.timer); pending.delete(id); request.resolve(result); }
  });
  ipcMain.on('webui:snapshots', (event, tasks) => {
    if (!owner(event) || !Array.isArray(tasks)) return;
    for (const task of tasks) if (task?.id) snapshots.set(task.id, task);
    while (snapshots.size > 50) snapshots.delete(snapshots.keys().next().value);
  });
  function invoke(payload) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) throw new Error('Yan 桌面端未就绪');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('桌面端未响应发送请求')); }, 30000);
      pending.set(id, { resolve, timer });
      window.webContents.send('webui:request', { id, payload });
    });
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      let result;
      if (req.method === 'GET' && url.pathname === '/snapshot') {
        const id = url.searchParams.get('id');
        const now = Date.now();
        if (now - (watches.get(id) || 0) > 1000) {
          if (watches.has(id) && now - watches.get(id) > 10000) snapshots.delete(id);
          watches.set(id,now);
          for (const [watchedId,seen] of watches) if (now-seen > 60000) {watches.delete(watchedId);snapshots.delete(watchedId);}
          getMainWindow()?.webContents.send('webui:watch',id);
        }
        result = snapshots.get(id) || null;
      }
      else if (req.method === 'GET' && url.pathname === '/running') {
        result = await invoke({action:'running'});
      }
      else if (req.method === 'POST' && url.pathname === '/send') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 70 * 1024 * 1024) throw new Error('附件过大'); chunks.push(chunk); }
        result = await invoke(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(503, { 'Content-Type':'application/json' }); res.end(JSON.stringify({ ok:false, error:error.message })); }
  });
  server.on('error', error => console.error('[webui] bridge failed',error.message));
  server.listen(0, '127.0.0.1', async () => {
    try { await fs.mkdir(dataDir, { recursive:true }); await fs.writeFile(path.join(dataDir, 'webui-bridge.json'), JSON.stringify({ port:server.address().port, token })); }
    catch (error) { console.error('[webui] bridge registration failed', error.message); }
  });
  server.unref();
  return server;
}
module.exports = { registerWebuiBridge };
