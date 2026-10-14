'use strict';

// WebUI host; execution is forwarded to the local desktop Agent.
const http = require('node:http');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../renderer');
const dataDir = process.env.YAN_WEBUI_DATA_DIR || path.join(process.env.APPDATA, 'yan-agent', 'YanData');
const port = Number(process.env.YAN_WEBUI_PORT || 4317);
const host = process.env.YAN_WEBUI_HOST || '0.0.0.0';
const { readProjects } = require('./webui-projects.cjs');
const workImages = require('./webui-work-images.cjs');
const liveRoutes = require('./webui-live.cjs').createLiveRoutes(dataDir, workImages);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const safeAsset = value => /^[a-f0-9]{32}$/i.test(String(value || '')) ? String(value).toLowerCase() : '';
const mediaPathFor = async (type, assetId) => {
  const id = safeAsset(assetId); if (!id) return null;
  const manifestPath = path.join(dataDir, 'generated-media', id + '.json');
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.assetId !== id || manifest.type !== type) return null;
    const filePath = path.resolve(String(manifest.filePath || ''));
    if (!filePath.startsWith(path.resolve(dataDir) + path.sep)) return null;
    await fs.access(filePath); return { filePath, name: manifest.name || path.basename(filePath), type: manifest.mimeType || types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' };
  } catch { return null; }
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await liveRoutes(req,res,url)) return;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/media/work-image') {
      const asset = workImages.assets.get(url.searchParams.get('id'));
      if (!asset) { res.writeHead(404); res.end(); return; }
      const body = await fs.readFile(asset.filePath);
      res.writeHead(200, { 'Content-Type':asset.type, 'Content-Length':body.length, 'Cache-Control':'private, max-age=3600', 'X-Content-Type-Options':'nosniff' });
      res.end(body); return;
    }
    if (url.pathname === '/api/skills' || url.pathname === '/api/project-files') {
      const additions = require('./webui-additions.cjs');
      const payload = url.pathname === '/api/skills' ? { skills: await additions.readSkills(dataDir) }
        : await additions.readProjectFiles(dataDir, url.searchParams.has('workspace') ? url.searchParams.get('workspace') : null, url.searchParams.get('path') || '');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload)); return;
    }
    if (url.pathname === '/media/image' || url.pathname === '/media/video') {
      const type = url.pathname.endsWith('image') ? 'image' : 'video';
      const asset = await mediaPathFor(type, url.searchParams.get('id'));
      if (!asset) { res.writeHead(404); res.end(); return; }
      const stat = await fs.stat(asset.filePath);
      res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': stat.size, 'Content-Disposition': `inline; filename="${encodeURIComponent(asset.name)}"`, 'Cache-Control': 'private, max-age=3600', 'Accept-Ranges': 'bytes' });
      const body = await fs.readFile(asset.filePath);
      res.end(body); return;
    }
    if (url.pathname === '/api/task') {
      const id = url.searchParams.get('id') || '';
      if (!/^sess_[A-Za-z0-9_-]{4,160}$/.test(id)) { res.writeHead(400); res.end(); return; }
      const projects = await readProjects(dataDir);
      if (!projects.some(project => project.tasks.some(task => task.id === id))) { res.writeHead(404); res.end(); return; }
      let task = JSON.parse(await fs.readFile(path.join(dataDir, 'sessions', id + '.json'), 'utf8'));
      task = await workImages.prepareWorkImages(task, task.workspace);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ id: task.id, title: task.title, workspace: task.workspace || '', pinned: !!task.pinned,
        messages: (task.messages || []).filter(message => ['user', 'assistant'].includes(message.role)).map(message => ({ role: message.role, content: message.content, ts: message.ts, duration: message.duration, agentRun: message.agentRun, attachments: message.attachments, mediaAssets: message.mediaAssets })) }));
      return;
    }
    if (url.pathname === '/api/composer-models') {
      const config = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'));
      const payload = require('./webui-models.cjs').readComposerModels(config, dataDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
      return;
    }
    if (url.pathname === '/api/projects') {
      const projects = url.searchParams.get('preview') === 'empty' ? [] : await readProjects(dataDir);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ projects }));
      return;
    }
    const pathname = url.pathname === '/' || url.pathname === '/webui/' ? '/webui/index.html' : decodeURIComponent(url.pathname);
    if (!pathname.startsWith('/webui/') && !pathname.startsWith('/vendor/katex/')
      && !['/assets/logo-light.png', '/markdown-math.js', '/markdown-math.css'].includes(pathname)) { res.writeHead(404); res.end(); return; }
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const content = await fs.readFile(filename);
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch (error) {
    if (res.headersSent) { res.destroy(error); return; }
    res.writeHead(error.status || (error.code === 'ENOENT' ? 404 : 500));
    res.end('Unable to load preview');
    console.error(error.message);
  }
});
// Announce the running LAN host so the desktop remote-control panel shows the
// port actually being served instead of guessing the default.
const hostFile = path.join(dataDir, 'webui-host.json');
let announced = false;
function announceHost() {
  try {
    fss.writeFileSync(hostFile, JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }));
    announced = true;
  } catch {}
}
function withdrawHost() {
  if (!announced) return;
  try {
    const current = JSON.parse(fss.readFileSync(hostFile, 'utf8'));
    if (current && current.pid === process.pid) fss.rmSync(hostFile, { force: true });
  } catch {}
  announced = false;
}
server.listen(port, host, () => {
  announceHost();
  console.log(`Yan WebUI preview: http://${host}:${port}`);
});
process.on('exit', withdrawHost);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { withdrawHost(); process.exit(0); });
