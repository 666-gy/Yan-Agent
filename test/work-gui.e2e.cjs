'use strict';

// Yan Work GUI acceptance inside the real window: the page mounts on its tab,
// renders the work island from normalized events, tracks subagent helpers,
// switches districts, and preserves the world across titlebar navigation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-gui-e2e-'));

function buildFixture(sessionId) {
  const now = Date.now();
  const runId = 'run-e2e-world';
  const events = [
    { kind: 'run.started', runId, sessionId, agentId: 'main', ts: now - 40_000, payload: { title: '演示任务：修复登录回归', prompt: '修复登录回归', model: 'Demo 模型', workMode: 'normal', skills: ['code-simplifier'] } },
    { kind: 'tool.started', runId, sessionId, agentId: 'main', ts: now - 36_000, payload: { callId: 'c1', tool: 'grep', label: 'grep', zone: 'library', zoneName: '书房', input: '登录 回归' } },
    { kind: 'tool.finished', runId, sessionId, agentId: 'main', ts: now - 33_000, payload: { callId: 'c1', tool: 'grep', zone: 'library', status: 'completed' } },
    { kind: 'tool.started', runId, sessionId, agentId: 'main', ts: now - 30_000, payload: { callId: 'c2', tool: 'bash', label: 'bash', zone: 'forge', zoneName: '熔炉', input: 'npm test' } },
    { kind: 'message.delta', runId, sessionId, agentId: 'main', ts: now - 28_000, payload: { delta: '已定位到登录回归：会话缓存过期判断写反了，正在熔炉里跑测试验证修复。' } },
    { kind: 'agent.spawned', runId, sessionId, agentId: 'sub:t1', ts: now - 24_000, payload: { name: '探索子代理', role: 'explore', state: 'working', zone: 'hall', zoneName: '议事厅', tool: '', label: '', text: '', toolCount: 1 } },
    { kind: 'agent.updated', runId, sessionId, agentId: 'sub:t1', ts: now - 21_000, payload: { name: '探索子代理', role: 'explore', state: 'working', zone: 'library', zoneName: '书房', tool: 'read', label: 'read', text: '正在阅读会话模块…', toolCount: 2 } },
    { kind: 'todo.updated', runId, sessionId, agentId: 'main', ts: now - 18_000, payload: { todos: [{ id: 't1', text: '定位回归', status: 'completed' }, { id: 't2', text: '修复并验证', status: 'in_progress' }] } },
    { kind: 'energy.changed', runId, sessionId, agentId: 'main', ts: now - 15_000, payload: { tokens: 26_000, budget: 60_000, ratio: 0.43, compactionCount: 0 } },
    { kind: 'ceremony', runId, sessionId, agentId: 'main', ts: now - 12_000, payload: { phase: 'achievement', id: 'first-voyage', title: '首航' } }
  ];
  const snapshot = {
    generatedAt: now,
    seq: 400,
    activeRunId: runId,
    sessions: [{ id: sessionId, title: '演示任务：修复登录回归', workspace: '', updatedAt: now }],
    runs: [{ runId, sessionId, title: '演示任务：修复登录回归', prompt: '修复登录回归', model: 'Demo 模型', status: 'running', startedAt: now - 40_000, finishedAt: 0, toolCalls: 0, helpers: 1, energy: { tokens: 26_000, budget: 60_000, ratio: 0.43 }, textTail: '', storm: '', delivery: '' }],
    agents: [
      { id: 'main', kind: 'main', runId, sessionId, name: '主代理', role: '', state: 'working', zone: 'forge', tool: 'bash', label: 'bash', text: '', startedAt: now - 40_000, finishedAt: 0, toolCount: 2 },
      { id: 'sub:t1', kind: 'sub', runId, sessionId, name: '探索子代理', role: 'explore', state: 'working', zone: 'library', tool: 'read', label: 'read', text: '正在阅读会话模块…', startedAt: now - 24_000, finishedAt: 0, toolCount: 2 }
    ],
    recentEvents: [],
    home: {
      version: 1,
      updatedAt: now - 400_000,
      totals: { completed: 3, aborted: 0, failed: 0, toolCalls: 140, deliveries: 2 },
      skillUses: { 'code-simplifier': { uses: 7, lastAt: now - 400_000 }, 'diagnosing-bugs': { uses: 3, lastAt: now - 900_000 } },
      buildings: [
        { id: 'skill:code-simplifier', kind: 'skill', name: 'Code Simplifier', level: 3, uses: 7, lastAt: now - 400_000 },
        { id: 'skill:diagnosing-bugs', kind: 'skill', name: 'Diagnosing Bugs', level: 2, uses: 3, lastAt: now - 900_000 },
        { id: 'mcp:mcp_default_codegraph', kind: 'mcp', name: 'CodeGraph', level: 2, uses: 0, lastAt: 0 }
      ],
      memory: { count: 12, recent: [{ title: '用户偏好中文' }] },
      mcp: [{ id: 'mcp_default_codegraph', name: 'CodeGraph', enabled: true }],
      achievements: [{ id: 'first-voyage', title: '首航', at: now - 400_000 }, { id: 'hundred-tools', title: '千锤百炼', at: now - 300_000 }],
      dayPhase: 'day'
    }
  };
  return { events, snapshot };
}

(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      !!window.YanWorkGui
      && typeof showWindowView === 'function'
      && typeof state !== 'undefined'
      && !!state.currentSession
    ));

    const sessionId = await page.evaluate(() => state.currentSession.id);
    const fixture = buildFixture(sessionId);

    const result = await page.evaluate(async ({ events, snapshot }) => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      await showWindowView('work-gui');
      // The page refreshes its own snapshot on open; let it settle, then apply
      // the deterministic fixture so the checks below are reproducible.
      await sleep(500);
      const liveHome = window.YanWorkGui.getState().home;
      window.YanWorkGui.applySnapshot(snapshot);
      window.YanWorkGui.ingest({ events });
      await sleep(900);
      const worldState = window.YanWorkGui.getState();
      const render3d = window.YanWorkGui.debug3d();
      const panelCount = document.querySelectorAll('.wgu-side,.wgu-card,.wgu-session').length;
      const worldTitle = document.querySelector('.wgu-brand')?.textContent || '';

      // Scene switch: home island shows buildings, library and achievements.
      const homeTab = document.querySelector('.wgu-scene[data-scene="home"]');
      homeTab.click();
      await sleep(120);
      const sceneAfterSwitch = window.YanWorkGui.getState().scene;
      // Returning to the task remains an explicit titlebar action.
      const stayedInWorld = !document.querySelector('#pageWorkGui').classList.contains('hidden');
      document.querySelector('[data-window-view="main"]').click();
      await sleep(500);
      const jumpedToChat = !document.querySelector('#pageWorkGui').classList.contains('hidden')
        ? false
        : (typeof currentWindowView !== 'undefined' ? currentWindowView === 'main' : true);

      document.querySelector('[data-window-view="work-gui"]').click();
      await sleep(500);
      // Reopening the page keeps the projected world; only the snapshot needs
      // restoring because the page refresh replaced it with live (empty) data.
      window.YanWorkGui.applySnapshot(snapshot);
      await sleep(400);
      const backToWorld = !document.querySelector('#pageWorkGui').classList.contains('hidden');
      const canvas = document.querySelector('.wgu-canvas');
      const probeCanvas = document.createElement('canvas');
      const threeStatus = await fetch('vendor/three/three.min.js').then(response => response.status).catch(error => String(error));
      return {
        probe: {
          three: typeof window.THREE,
          sceneModule: typeof window.YanWorkGuiScene,
          webgl2: !!probeCanvas.getContext('webgl2'),
          webgl1: !!probeCanvas.getContext('webgl'),
          threeStatus,
          scripts: [...document.scripts].map(script => script.getAttribute('src'))
        },
        worldState,
        liveHome,
        render3d,
        panelCount,
        worldTitle,
        sceneAfterSwitch,
        stayedInWorld,
        jumpedToChat,
        backToWorld,
        canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null
      };
    }, fixture);

    assert.equal(result.panelCount, 0, 'the right-side panels and task selector are removed');
    // The live snapshot traveled main feed -> IPC -> page before the fixture.
    assert.ok(result.liveHome, 'the page received a live snapshot over IPC');
    assert.ok(result.liveHome.buildings >= 1, `live home should contain the workspace skills/MCP (got ${result.liveHome?.buildings})`);
    assert.equal(result.worldTitle, '云海群岛');
    assert.equal(result.sceneAfterSwitch, 'home');
    assert.equal(result.jumpedToChat, true, 'the titlebar main button returns to the task');
    assert.equal(result.stayedInWorld, true, 'changing districts keeps the world open');
    assert.equal(result.render3d.continuousWorld, true, 'work and life share a continuous map');
    assert.equal(result.backToWorld, true, 'the work GUI page reopens');
    assert.ok(result.canvasSize && result.canvasSize.width > 0, 'canvas is sized');
    if (result.render3d.mode !== 'webgl') {
      console.error('render probe:', JSON.stringify(result.probe));
      console.error('page errors:', errors.join(' | '));
    }
    assert.equal(result.render3d.mode, 'webgl', `3D scene must run on WebGL (got ${result.render3d.mode})`);
    assert.ok(result.render3d.triangles > 0, `WebGL must actually draw geometry (triangles=${result.render3d.triangles})`);
    assert.ok(result.render3d.characters >= 2, 'both agents exist as 3D characters');

    const stateCheck = result.worldState;
    if (stateCheck.actors.length !== 2) console.error('actors:', JSON.stringify(stateCheck.actors, null, 1));
    assert.equal(stateCheck.runs.length, 1);
    assert.equal(stateCheck.runs[0].toolCalls, 2, JSON.stringify(stateCheck.runs));
    assert.equal(stateCheck.actors.length, 2);
    const helper = stateCheck.actors.find(agent => agent.id === 'sub:t1');
    assert.equal(helper.zone, 'library');
    assert.equal(helper.text, '正在阅读会话模块…');
    assert.equal(stateCheck.home.buildings, 3);
    assert.equal(stateCheck.home.memory, 12);

    // Visual evidence: the work island with the mid-run fixture state.
    await page.evaluate(() => {
      const tab = document.querySelector('.wgu-scene[data-scene="worksite"]');
      tab?.click();
    });
    await page.waitForTimeout(700);
    const shotDir = path.join(appRoot, 'output', 'work-gui');
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'work-island.png') });
    await page.evaluate(() => document.querySelector('.wgu-scene[data-scene="home"]')?.click());
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shotDir, 'home-island.png') });

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({
      ok: true,
      agents: stateCheck.actors.length,
      panelCount: result.panelCount,
      toolCalls: stateCheck.runs[0].toolCalls,
      helperZone: helper.zone,
      projected: result.render3d.projected
    }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
