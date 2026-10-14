'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '../renderer');
  const taskId = 'sess_webui_ui_test';
  let respondToSend;
  let sendArrived;
  const sendReceived = new Promise(resolve => {sendArrived = resolve;});
  const reply = (res, value) => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/projects') return reply(res,{projects:[{label:'项目 A',workspace:'C:\\project-a',tasks:[{id:taskId,title:'运行中的任务'}]}]});
    if (url.pathname === '/api/running') return reply(res,{ids:[taskId]});
    if (url.pathname === '/api/task') return reply(res,{id:taskId,title:'运行中的任务',workspace:'C:\\project-a',messages:[{role:'user',content:'旧消息',ts:1}]});
    if (url.pathname === '/api/composer-models') return reply(res,{models:[{key:'model-a',name:'测试模型',providerId:'test'}],selected:'model-a',reasoningMode:'medium'});
    if (url.pathname === '/api/send') {
      for await (const _chunk of req) { /* Wait for the complete request. */ }
      respondToSend = () => {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'发送失败'}));};
      sendArrived();
      return;
    }
    const filename = path.resolve(root, '.' + (url.pathname === '/' ? '/webui/index.html' : url.pathname));
    if (!filename.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
    try {
      const content = await fs.readFile(filename);
      const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200,{'Content-Type':type});res.end(content);
    } catch {res.writeHead(404);res.end();}
  });
  let browser;
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    browser = await chromium.launch();
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const base = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(base);
    await page.locator('.project summary').waitFor();
    await page.waitForFunction(() => !document.querySelector('.project-spinner').hidden);
    assert.equal(await page.locator('.project-spinner:visible').count(),1);
    await page.locator('.project summary').click();
    assert.equal(await page.locator('.task-spinner:visible').count(),1);
    await page.locator('.task-row').click();
    await page.locator('#taskMessagePane').waitFor({state:'visible'});
    assert.equal(await page.locator('#newTaskWorkspace').isVisible(),false);
    await page.locator('#backToProjects').click();
    await page.locator('#newTaskView').waitFor({state:'hidden'});
    await page.locator('#newTaskButton').click();
    await page.locator('#newTaskWorkspace').waitFor({state:'visible'});
    await page.locator('#composerInput').fill('需要立即清空');
    await page.locator('#sendTaskButton').click();
    await page.waitForFunction(() => document.querySelector('#composerInput').value === '');
    assert.equal(await page.locator('#newTaskWorkspace').isVisible(),false);
    await page.waitForFunction(() => document.querySelector('#taskMessages').textContent.includes('需要立即清空'));
    await page.waitForFunction(() => document.querySelector('#sendTaskButton').disabled);
    await sendReceived;
    respondToSend();
    await page.waitForFunction(() => document.querySelector('#composerInput').value === '需要立即清空');
    assert.equal(await page.locator('#newTaskWorkspace').isVisible(),true);
    console.log('PASS WebUI running indicators, existing task workspace, immediate clear and failure restore');
  } finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});
