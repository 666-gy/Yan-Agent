'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { readProjects } = require('./webui-projects.cjs');
const { readComposerModels } = require('./webui-models.cjs');
const { readSkills } = require('./webui-additions.cjs');
function createLiveRoutes(dataDir, workImages) {
  async function bridge(route, body) {
    try {
      const connection = JSON.parse(await fs.readFile(path.join(dataDir,'webui-bridge.json'),'utf8'));
      const response = await fetch(`http://127.0.0.1:${Number(connection.port)}${route}`, {
        method:body ? 'POST' : 'GET', headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},
        body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(body ? 35000 : 3000)
      });
      if (!response.ok) throw new Error('bridge unavailable');
      return await response.json();
    } catch { throw new Error('无法连接 Yan 桌面端，请打开更新后的 Yan Agent 再试'); }
  }
  const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data)); };
  async function visible(id) {
    return (await readProjects(dataDir)).some(p => p.tasks.some(t => t.id === id));
  }
  return async (req,res,url) => {
    if (!['/api/send','/api/events','/api/running'].includes(url.pathname)) return false;
    try {
      if (url.pathname === '/api/running') {
        if (req.method !== 'GET') { json(res,405,{ok:false}); return true; }
        const result = await bridge('/running');
        if (!result.ok || !Array.isArray(result.ids)) throw new Error('无法读取运行状态');
        json(res,200,{ids:result.ids});
      } else if (url.pathname === '/api/send') {
        if (req.method !== 'POST') { json(res,405,{ok:false}); return true; }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
          json(res,403,{ok:false,error:'不允许跨站发送'}); return true;
        }
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 35 * 1024 * 1024) throw new Error('照片总大小不能超过 25 MB'); chunks.push(chunk); }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!/^[a-zA-Z0-9_-]{12,100}$/.test(payload.intentId || '')) throw new Error('无效消息标识');
        if (typeof payload.text !== 'string' || payload.text.length > 200000) throw new Error('消息过长');
        if (payload.taskId && (!/^sess_[\w-]{4,160}$/.test(payload.taskId) || !await visible(payload.taskId))) throw new Error('任务不存在');
        const config = JSON.parse(await fs.readFile(path.join(dataDir,'config.json'),'utf8'));
        const model = readComposerModels(config,dataDir).models.find(m => m.key === payload.model?.key);
        if (!model) throw new Error('所选模型已不可用，请刷新模型列表');
        const availableSkills = await readSkills(dataDir);
        const skills = (payload.skills || []).map(s => { const skill = availableSkills.find(x => x.id === s.id); if (!skill) throw new Error('所选技能不可用'); return skill; });
        if (!Array.isArray(payload.photos) || payload.photos.length > 20) throw new Error('照片数量过多');
        const photos = payload.photos.map(p => {
          if (!/^image\/(png|jpeg|webp|gif|heic|heif)$/i.test(p.mimeType || '') || typeof p.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.base64)) throw new Error('无效照片');
          return {name:path.basename(String(p.name || 'photo')),mimeType:p.mimeType,base64:p.base64};
        });
        const task = payload.taskId ? JSON.parse(await fs.readFile(path.join(dataDir,'sessions',payload.taskId+'.json'),'utf8')) : null;
        const requestedWorkspace = typeof payload.workspace === 'string' ? payload.workspace.trim() : '';
        const visibleProjects = await readProjects(dataDir);
        const allowedWorkspaces = new Set(visibleProjects.map(project => String(project.workspace || '').trim()).filter(Boolean));
        if (!task && requestedWorkspace && !allowedWorkspaces.has(requestedWorkspace)) throw new Error('所选工作区不可用');
        const workspace = task ? task.workspace : requestedWorkspace;
        const projectAttachments = [];
        for (const item of payload.projectFiles || []) {
          if (!workspace || path.resolve(item.workspace || '') !== path.resolve(workspace)) throw new Error('文件不属于当前项目');
          const root = await fs.realpath(workspace), filename = await fs.realpath(path.resolve(root,item.path));
          const relative = path.relative(root,filename);
          if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep)) throw new Error('文件不属于当前项目');
          const stat = await fs.stat(filename); if (!stat.isFile()) throw new Error('请选择文件');
          projectAttachments.push({path:filename,name:path.basename(filename),size:stat.size});
        }
        if (!payload.text.trim() && !skills.length && !photos.length && !projectAttachments.length) throw new Error('消息为空');
        // A desktop reload loses its in-memory request map; the saved user intent
        // remains authoritative, including when the first new-task ACK was lost.
        const candidates = payload.taskId ? [task] : await Promise.all((await readProjects(dataDir)).flatMap(p=>p.tasks).map(async t => {
          try { return JSON.parse(await fs.readFile(path.join(dataDir,'sessions',t.id+'.json'),'utf8')); } catch { return null; }
        }));
        const submitted = candidates.find(t => t?.messages?.some(m=>m.role === 'user' && m.intentId === payload.intentId));
        if (submitted) {json(res,200,{ok:true,taskId:submitted.id,deduped:true});return true;}
        const result = await bridge('/send',{intentId:payload.intentId,taskId:payload.taskId || '',workspace:task ? task.workspace : requestedWorkspace,text:payload.text,model,reasoningMode:payload.reasoningMode,skills,photos,projectAttachments});
        json(res,result.ok ? 200 : 409,result);
      } else {
        const id = url.searchParams.get('id') || '';
        if (req.method !== 'GET' || !/^sess_[\w-]{4,160}$/.test(id) || !await visible(id)) {json(res,404,{ok:false});return true;}
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write('retry: 1500\n\n');
        // Push the headers and initial frame immediately so later deltas are
        // not held behind a response buffer in the browser or proxy.
        res.flushHeaders?.();
        let closed = false, previous = '', timer, offline = false;
        res.on('close',()=>{closed=true;clearTimeout(timer);});
        const tick = async () => {
          try {
            let snapshot = await bridge('/snapshot?id='+encodeURIComponent(id));
            if (!snapshot || snapshot.messagesStart > 0) {
              const saved = JSON.parse(await fs.readFile(path.join(dataDir,'sessions',id+'.json'),'utf8'));
              const projectMessage = m => ({role:m.role,content:m.content,ts:m.ts,duration:m.duration,agentRun:m.agentRun,attachments:m.attachments,skillCalls:m.skillCalls,mediaAssets:m.mediaAssets,intentId:m.intentId});
              const history = saved.messages || [];
              if (snapshot) snapshot = {...snapshot,messages:[...history.slice(0,snapshot.messagesStart).filter(m=>['user','assistant'].includes(m.role)).map(projectMessage),...snapshot.messages]};
              else snapshot = {id:saved.id,title:saved.title,workspace:saved.workspace || '',pinned:!!saved.pinned,running:false,messages:history.filter(m=>['user','assistant'].includes(m.role)).map(projectMessage)};
            }
            if (offline && !closed) res.write('event: connection\ndata: {"online":true}\n\n');
            offline = false;
            const raw = JSON.stringify(snapshot);
            if (snapshot && raw !== previous) {
              const task = await workImages.prepareWorkImages(snapshot,snapshot.workspace);
              if (!closed && !res.writableNeedDrain) {res.write('data: '+JSON.stringify(task)+'\n\n');previous=raw;}
            } else if (!closed) res.write(': heartbeat\n\n');
          } catch {
            if (!closed && !offline) res.write('event: connection\ndata: {"online":false}\n\n');
            offline = true;
          }
          if (!closed) timer=setTimeout(tick,offline ? 3000 : 80);
        };
        void tick();
      }
    } catch(error) { if (!res.headersSent) json(res,400,{ok:false,error:error.message}); else res.end(); }
    return true;
  };
}
module.exports={createLiveRoutes};
