// Yan Work GUI · 云海群岛
// Normalized runtime events drive residents in a continuous Three.js village.
// Work and life share one map; district navigation only moves the camera.
// Ambient life is illustrative. Task states and progress come from Yan events.

(() => {
  'use strict';

  const STATIONS = {
    dock: { x: 400, y: 668 },
    tower: { x: 468, y: 344 },
    workshop: { x: 636, y: 466 },
    forge: { x: 772, y: 640 },
    hall: { x: 938, y: 566 },
    library: { x: 1012, y: 342 },
    studio: { x: 1186, y: 522 },
    lighthouse: { x: 1316, y: 372 }
  };
  const stationName = zone => window.YanWorkGuiScene?.stationName(zone) || zone;
  const PALETTE = {
    main: '#e98238',
    helper: ['#57b6d6', '#8d6fbf', '#59c98a', '#d98ba6', '#d9c26a']
  };

  const state = {
    opened: false,
    ready: false,
    scene: 'overview',
    focusRunId: '',
    lastEventAt: 0,
    lastSnapshotSeq: -1,
    chromeDirty: true,
    hoverTarget: null,
    home: null,
    todos: [],
    ticker: [],
    effects: [],
    runs: new Map(),
    actors: new Map(),
    stations: new Map(),
    unsubscribe: null,
    raf: 0,
    lastFrameAt: 0,
    clock: 0
  };

  const dom = {
    root: null,
    canvas: null,
    ctx: null,
    top: null,
    scenes: null,
    followHint: null,
    ticker: null,
    tip: null,
    hint: null
  };

  // -------------------------------------------------------------------------
  // small helpers
  // -------------------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hashSeed(input) {
    let hash = 2166136261;
    const text = String(input || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
  }

  function timeLabel(ts) {
    try {
      return new Date(Number(ts) || Date.now()).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function tailText(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `…${text.slice(-max)}` : text;
  }

  function pushTicker(text, at) {
    if (!text) return;
    state.ticker.unshift({ text, at: Number(at) || Date.now() });
    state.ticker = state.ticker.slice(0, 5);
    state.chromeDirty = true;
  }

  function addEffect(kind, options = {}) {
    state.effects.push({
      kind,
      at: state.clock,
      duration: Number(options.duration) || 2000,
      ...options
    });
    if (state.effects.length > 48) state.effects.splice(0, state.effects.length - 48);
  }

  // -------------------------------------------------------------------------
  // world projection
  // -------------------------------------------------------------------------

  function focusRun() {
    return state.runs.get(state.focusRunId) || null;
  }

  function ensureRun(runId, init = {}) {
    const id = String(runId || '');
    if (!id) return null;
    if (!state.runs.has(id)) {
      state.runs.set(id, {
        runId: id,
        sessionId: '',
        title: '新对话',
        prompt: '',
        model: '',
        status: 'created',
        startedAt: Date.now(),
        finishedAt: 0,
        toolCalls: 0,
        helpers: 0,
        energy: null,
        textTail: '',
        storm: '',
        stormUntil: 0,
        repairUntil: 0,
        delivery: '',
        lastEventAt: 0,
        ...init
      });
    } else {
      Object.assign(state.runs.get(id), init);
    }
    const run = state.runs.get(id);
    run.lastEventAt = Date.now();
    if (!state.focusRunId || !state.runs.get(state.focusRunId)?.finishedAt) {
      if (!state.focusRunId) state.focusRunId = id;
    }
    return run;
  }

  function ensureActor(agentId, init = {}) {
    const id = String(agentId || 'main');
    if (!state.actors.has(id)) {
      const helperIndex = state.actors.size;
      state.actors.set(id, {
        id,
        kind: id.startsWith('sub:') ? 'sub' : 'main',
        name: id.startsWith('sub:') ? 'Sub Agent' : 'Yan Agent',
        role: '',
        runId: '',
        state: 'idle',
        zone: 'dock',
        tool: '',
        label: '',
        text: '',
        thought: '',
        textAt: 0,
        thoughtAt: 0,
        toolCount: 0,
        startedAt: 0,
        finishedAt: 0,
        color: id.startsWith('sub:')
          ? PALETTE.helper[helperIndex % PALETTE.helper.length]
          : PALETTE.main,
        x: STATIONS.dock.x,
        y: STATIONS.dock.y,
        target: null,
        facing: 1,
        phase: hashSeed(id) * Math.PI * 2,
        celebrateUntil: 0
      });
    }
    Object.assign(state.actors.get(id), init);
    const resident = state.actors.get(id);
    resident.name = residentName(resident);
    return resident;
  }

  function residentName(resident) {
    if (resident.id === 'main' || resident.kind === 'main') return 'Yan Agent';
    return (resident.role && window.YanSubagentPanel?.nameFor?.(resident.role))
      || resident.name || 'Sub Agent';
  }

  function stationSlot(zone, index) {
    const station = STATIONS[zone] || STATIONS.workshop;
    const angle = hashSeed(`${zone}:${index}`) * Math.PI * 2;
    const radius = 34 + hashSeed(`r:${zone}:${index}`) * 26;
    return { x: station.x + Math.cos(angle) * radius, y: station.y + 16 + Math.sin(angle) * 12 };
  }

  function walkTo(actor, x, y, nextState) {
    actor.target = { x, y, nextState: nextState || 'work' };
    if (nextState === 'work') actor.state = 'working';
    else if (!['done', 'error'].includes(actor.state)) actor.state = nextState || 'working';
  }

  function setMainActivity(zone, tool, label) {
    const run = focusRun();
    const actor = state.actors.get('main');
    if (!actor) return;
    actor.zone = zone || actor.zone;
    actor.tool = tool || '';
    actor.label = label || '';
    if (run) actor.runId = run.runId;
    const slot = stationSlot(actor.zone, 0);
    walkTo(actor, slot.x, slot.y, 'work');
  }

  function applyEvent(event) {
    if (!event || typeof event !== 'object') return;
    const at = Number(event.ts) || Date.now();
    state.lastEventAt = at;
    const payload = event.payload || {};
    switch (event.kind) {
      case 'run.started': {
        const run = ensureRun(event.runId, {
          sessionId: event.sessionId,
          title: payload.title || '新对话',
          prompt: payload.prompt || '',
          model: payload.model || '',
          status: 'running',
          startedAt: at
        });
        state.focusRunId = run.runId;
        actor('main', {
          runId: run.runId,
          state: 'walk',
          zone: 'dock',
          tool: '',
          text: '',
          thought: '',
          startedAt: at
        });
        addEffect('boat', { runId: run.runId, duration: 2600 });
        pushTicker(`出航 · ${run.title}`, at);
        break;
      }
      case 'tool.started': {
        const run = ensureRun(event.runId, { sessionId: event.sessionId, status: 'running' });
        run.toolCalls += 1;
        state.stations.set(payload.zone || 'workshop', {
          zone: payload.zone || 'workshop',
          tool: payload.tool || '',
          label: payload.label || payload.tool || '工具',
          input: payload.input || '',
          runId: run.runId,
          at
        });
        if (run.runId === state.focusRunId) setMainActivity(payload.zone, payload.tool, payload.label);
        addEffect('spark', { zone: payload.zone || 'workshop', duration: 900 });
        pushTicker(`${payload.zoneName || ''} · ${payload.label || payload.tool}`, at);
        break;
      }
      case 'tool.finished': {
        const station = state.stations.get(payload.zone || '');
        if (station && station.tool === (payload.tool || '') && station.runId === event.runId) {
          state.stations.delete(payload.zone);
        }
        const main = state.actors.get('main');
        if (main && main.tool === payload.tool) main.tool = '';
        break;
      }
      case 'tool.progress': {
        if (payload.title) actor('main', { text: tailText(payload.title, 90), textAt: at });
        break;
      }
      case 'message.delta': {
        if (event.agentId === 'main' || !state.actors.has(event.agentId)) {
          actor('main', { text: tailText(payload.delta, 150), textAt: at });
        } else {
          actor(event.agentId, { text: tailText(payload.delta, 110), textAt: at });
        }
        break;
      }
      case 'reasoning.delta': {
        if (event.agentId === 'main') actor('main', { thought: tailText(payload.delta, 90), thoughtAt: at });
        else actor(event.agentId, { thought: tailText(payload.delta, 70), thoughtAt: at });
        break;
      }
      case 'agent.spawned': {
        const index = [...state.actors.keys()].filter(id => id.startsWith('sub:')).length;
        const helper = ensureActor(event.agentId, {
          runId: event.runId,
          name: payload.name || `子代理 ${index + 1}`,
          role: payload.role || '',
          state: payload.state === 'done' ? 'done' : 'working',
          zone: payload.zone || 'hall',
          tool: payload.tool || '',
          label: payload.label || '',
          text: payload.text || '',
          toolCount: Number(payload.toolCount) || 0,
          startedAt: at
        });
        const slot = stationSlot(helper.zone, index + 1);
        walkTo(helper, slot.x, slot.y, helper.state === 'working' ? 'work' : helper.state);
        addEffect('boat', { runId: event.runId, duration: 2200 });
        pushTicker(`${payload.name || '子代理'}出坞`, at);
        break;
      }
      case 'agent.updated': {
        const helper = ensureActor(event.agentId, { runId: event.runId });
        const previousZone = helper.zone;
        Object.assign(helper, {
          name: payload.name || helper.name,
          role: payload.role || helper.role,
          state: payload.state === 'done' ? 'done'
            : payload.state === 'error' ? 'error'
              : payload.state === 'idle' ? 'idle' : 'working',
          zone: payload.zone || helper.zone,
          tool: payload.tool || '',
          label: payload.label || '',
          text: payload.text || helper.text,
          toolCount: Number(payload.toolCount) || helper.toolCount
        });
        helper.name = residentName(helper);
        if (helper.state === 'done' || helper.state === 'error') {
          helper.finishedAt = at;
          const homeSlot = stationSlot('dock', 2);
          walkTo(helper, homeSlot.x, homeSlot.y, 'idle');
        } else {
          const slot = stationSlot(helper.zone, 2);
          if (previousZone !== helper.zone || !helper.target) {
            walkTo(helper, slot.x, slot.y, helper.state === 'working' ? 'work' : helper.state);
          }
        }
        break;
      }
      case 'todo.updated': {
        state.todos = Array.isArray(payload.todos) ? payload.todos : [];
        state.chromeDirty = true;
        break;
      }
      case 'energy.changed': {
        const run = ensureRun(event.runId, {});
        if (run) run.energy = { tokens: payload.tokens, budget: payload.budget, ratio: payload.ratio };
        state.chromeDirty = true;
        break;
      }
      case 'storm': {
        const run = ensureRun(event.runId, {});
        if (run) {
          run.storm = payload.message || '服务出错';
          run.stormUntil = state.clock + 9000;
        }
        pushTicker(`风暴 · ${run?.storm || ''}`, at);
        break;
      }
      case 'repair': {
        const run = ensureRun(event.runId, {});
        if (run) run.repairUntil = state.clock + 4000;
        pushTicker(`修缮中`, at);
        break;
      }
      case 'ceremony': {
        const run = ensureRun(event.runId, {});
        if (run) run.delivery = payload.phase || run.delivery;
        if (payload.phase === 'passed') {
          addEffect('beam', { duration: 6000 });
          pushTicker(`灯塔亮起 · 交付通过`, at);
        } else if (payload.phase === 'failed') {
          pushTicker(`交付未通过`, at);
        } else if (payload.phase === 'achievement') {
          addEffect('confetti', { duration: 4200 });
          pushTicker(`成就解锁 · ${payload.title || ''}`, at);
        }
        state.chromeDirty = true;
        break;
      }
      case 'file.edited': {
        addEffect('spark', { zone: 'workshop', duration: 700 });
        break;
      }
      case 'run.finished': {
        const run = ensureRun(event.runId, {});
        if (run) {
          run.status = payload.status || 'completed';
          run.finishedAt = at;
          run.textTail = payload.textTail || '';
          run.delivery = payload.delivery || run.delivery;
        }
        const main = state.actors.get('main');
        if (main && (!run || run.runId === state.focusRunId)) {
          main.state = payload.status === 'completed' ? 'celebrate'
            : payload.status === 'failed' ? 'error' : 'idle';
          main.celebrateUntil = state.clock + 2600;
          main.tool = '';
          const slot = stationSlot('dock', 0);
          walkTo(main, slot.x, slot.y, main.state);
        }
        if (run?.delivery === 'passed') addEffect('beam', { duration: 5000 });
        pushTicker(`返航 · ${payload.status === 'completed' ? '完成' : payload.status === 'failed' ? '失败' : '中断'}`, at);
        state.chromeDirty = true;
        break;
      }
      default:
        break;
    }
    // The feed can return a cached snapshot while newer events are arriving.
    // Protect the affected records without discarding unrelated snapshot data.
    if (Number.isFinite(event.seq)) {
      const run = state.runs.get(event.runId);
      const resident = state.actors.get(event.agentId || 'main');
      if (run) run.lastEventSeq = Math.max(run.lastEventSeq || 0, event.seq);
      if (resident) resident.lastEventSeq = Math.max(resident.lastEventSeq || 0, event.seq);
    }
    if (!state.focusRunId && event.runId) state.focusRunId = event.runId;
    state.chromeDirty = true;
  }

  function actor(id, patch) {
    return ensureActor(id, patch);
  }

  function ingest(batch) {
    const events = Array.isArray(batch?.events) ? batch.events : [];
    const snapshotKinds = new Set(['run.started', 'run.finished', 'agent.spawned', 'agent.updated',
      'tool.started', 'message.delta', 'energy.changed']);
    for (const event of events) {
      if (Number.isFinite(event?.seq) && event.seq <= state.lastSnapshotSeq && snapshotKinds.has(event.kind)) continue;
      try {
        applyEvent(event);
      } catch (error) {
        console.warn('[work-gui] event apply failed:', error);
      }
    }
    if (events.length) state.ready = true;
  }

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const seq = Number.isFinite(snapshot.seq) ? snapshot.seq : null;
    if (seq !== null && seq < state.lastSnapshotSeq) return;
    if (seq !== null) state.lastSnapshotSeq = seq;
    const newerThanSnapshot = record => seq !== null && (record?.lastEventSeq || 0) > seq;
    state.home = snapshot.home || null;
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
    const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
    const agentIds = new Set(agents.map(agent => agent.id));
    const runIds = new Set(runs.map(run => run.runId));
    for (const [id, resident] of state.actors) {
      if (!agentIds.has(id) && !newerThanSnapshot(resident)) state.actors.delete(id);
    }
    for (const [id, run] of state.runs) {
      if (!runIds.has(id) && !newerThanSnapshot(run)) state.runs.delete(id);
    }
    for (const agent of agents) {
      const existing = state.actors.get(agent.id);
      if (newerThanSnapshot(existing)) continue;
      const helper = ensureActor(agent.id, {
        runId: agent.runId,
        name: agent.name,
        role: agent.role,
        state: agent.state === 'working' ? 'working' : (agent.state === 'done' ? 'done' : agent.state),
        zone: agent.zone || 'dock',
        tool: agent.tool || '',
        label: agent.label || '',
        text: agent.text || '',
        toolCount: Number(agent.toolCount) || 0,
        startedAt: agent.startedAt || Date.now(),
        finishedAt: agent.finishedAt || 0
      });
      helper.textAt = helper.text ? Date.now() : 0;
      const slot = stationSlot(helper.zone, helper.kind === 'main' ? 0 : 2);
      helper.x = slot.x;
      helper.y = slot.y;
    }
    for (const run of runs) {
      if (newerThanSnapshot(state.runs.get(run.runId))) continue;
      ensureRun(run.runId, {
        sessionId: run.sessionId,
        title: run.title,
        prompt: run.prompt,
        model: run.model,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        toolCalls: run.toolCalls,
        helpers: run.helpers,
        energy: run.energy || null,
        textTail: run.textTail || '',
        delivery: run.delivery || ''
      });
    }
    for (const [zone, station] of state.stations) {
      const run = state.runs.get(station.runId);
      if (!run || run.finishedAt) state.stations.delete(zone);
    }
    if (!state.runs.has(state.focusRunId)) {
      const preferred = snapshot.activeRunId
        || [...state.runs.values()].find(run => !run.finishedAt)?.runId
        || state.runs.keys().next().value || '';
      state.focusRunId = preferred;
    }
    state.ready = true;
    state.chromeDirty = true;
  }

  // -------------------------------------------------------------------------
  // DOM chrome
  // -------------------------------------------------------------------------

  const viewState = { day: 'day', lastFollowAt: 0 };
  // Lucide 0.468.0, ISC license in icons/LICENSE.
  const ICONS = {"house":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-house\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" />\n  <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />\n</svg>\n","map":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-map\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\" />\n  <path d=\"M15 5.764v15\" />\n  <path d=\"M9 3.236v15\" />\n</svg>\n","hammer":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-hammer\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9\" />\n  <path d=\"m18 15 4-4\" />\n  <path d=\"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5\" />\n</svg>\n","sun":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-sun\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"4\" />\n  <path d=\"M12 2v2\" />\n  <path d=\"M12 20v2\" />\n  <path d=\"m4.93 4.93 1.41 1.41\" />\n  <path d=\"m17.66 17.66 1.41 1.41\" />\n  <path d=\"M2 12h2\" />\n  <path d=\"M20 12h2\" />\n  <path d=\"m6.34 17.66-1.41 1.41\" />\n  <path d=\"m19.07 4.93-1.41 1.41\" />\n</svg>\n","moon":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-moon\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z\" />\n</svg>\n","radio":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-radio\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M4.9 19.1C1 15.2 1 8.8 4.9 4.9\" />\n  <path d=\"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5\" />\n  <circle cx=\"12\" cy=\"12\" r=\"2\" />\n  <path d=\"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5\" />\n  <path d=\"M19.1 4.9C23 8.8 23 15.1 19.1 19\" />\n</svg>\n","minus":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-minus\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M5 12h14\" />\n</svg>\n","plus":"<!-- @license lucide-static v0.468.0 - ISC -->\n<svg\n  class=\"lucide lucide-plus\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M5 12h14\" />\n  <path d=\"M12 5v14\" />\n</svg>\n"};
  for (const [name, markup] of Object.entries(ICONS)) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    const svg = template.content.querySelector('svg');
    svg.setAttribute('class', 'wgu-icon');
    svg.setAttribute('aria-hidden', 'true');
    ICONS[name] = svg.outerHTML;
  }
  const icon = name => ICONS[name] || '';
  const control = (action, name, label) => '<button type="button" class="wgu-control" data-action="' + action + '" title="' + label + '" aria-label="' + label + '">' + icon(name) + '</button>';
  function ensureDom() {
    const host = document.querySelector('#pageWorkGui');
    if (!host) return false;
    if (dom.root) return true;
    const root = document.createElement('div');
    root.className = 'wgu-root';
    root.innerHTML = [
      '<canvas class="wgu-canvas" tabindex="0" aria-label="Yan Work GUI 世界"></canvas>',
      '<header class="wgu-top"><div class="wgu-brand"><strong>云海群岛</strong></div>',
      '<nav class="wgu-scenes" role="tablist" aria-label="世界区域">',
      '<button class="wgu-scene" type="button" role="tab" data-scene="overview">' + icon('map') + '全景</button>',
      '<button class="wgu-scene" type="button" role="tab" data-scene="worksite">' + icon('hammer') + '工作街区</button>',
      '<button class="wgu-scene" type="button" role="tab" data-scene="home">' + icon('house') + '生活庭院</button></nav>',
      '</header>',
      '<div class="wgu-ticker-wrap"><div class="wgu-ticker-title">' + icon('radio') + '岛上近况</div><footer class="wgu-ticker"></footer></div>',
      '<div class="wgu-camera" role="toolbar" aria-label="世界视角">' + control('reset','map','世界全景') + '<span class="wgu-camera-sep"></span>',
      control('zoom-out','minus','拉远') + control('zoom-in','plus','拉近') + '<span class="wgu-camera-sep"></span>' + control('day','sun','切换昼夜') + '</div>',
      '<div class="wgu-camera-hint"></div><div class="wgu-tip" hidden></div><div class="wgu-hint" hidden></div>'
    ].join('');
    host.replaceChildren(root);
    dom.root=root; dom.canvas=root.querySelector('.wgu-canvas');dom.scenes=root.querySelectorAll('.wgu-scene');
    const selectors={ticker:'ticker',tip:'tip',hint:'hint',followHint:'camera-hint'};
    for(const [key,cls] of Object.entries(selectors))dom[key]=root.querySelector('.wgu-'+cls);
    root.addEventListener('click',event=>{
      const sceneButton=event.target.closest('[data-scene]');
      if(sceneButton){state.scene=sceneButton.dataset.scene;sceneHost.api?.setScene(state.scene);state.chromeDirty=true;return;}
      const action=event.target.closest('[data-action]')?.dataset.action;
      if(action){
        if(action==='day')viewState.day=viewState.day==='day'?'night':'day';
        if(action==='reset'){state.scene='overview';sceneHost.api?.reset();}
        if(action==='zoom-in')sceneHost.api?.zoom(0.8);
        if(action==='zoom-out')sceneHost.api?.zoom(1.25);
        state.chromeDirty=true;
      }
    });
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape')sceneHost.api?.stopFollowing();
      const b=event.target.closest('.wgu-scene');
      if(b&&['ArrowLeft','ArrowRight'].includes(event.key)){
        event.preventDefault();const i=[...dom.scenes].indexOf(b),step=event.key==='ArrowRight'?1:-1;
        const next=dom.scenes[(i+step+dom.scenes.length)%dom.scenes.length];next.click();next.focus();
      }
    });
    dom.canvas.addEventListener('pointerleave',()=>{state.hoverTarget=null;dom.tip.hidden=true;});
    return true;
  }
  function updateMarkup(element,html){
    if(!element||element.dataset.html===html)return;
    element.innerHTML=html;element.dataset.html=html;
  }
  function renderChrome(){
    if(!dom.root)return;
    dom.root.dataset.loading=String(!state.ready);
    for(const b of dom.scenes){
      const active=b.dataset.scene===state.scene;b.classList.toggle('active',active);
      b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;
    }
    const dayButton=dom.root.querySelector('[data-action="day"]');
    updateMarkup(dayButton,icon(viewState.day==='day'?'sun':'moon'));dayButton.setAttribute('aria-pressed',String(viewState.day==='night'));
    updateMarkup(dom.ticker,state.ticker.slice(0,3).map(l=>'<div class="wgu-ticker-line"><time>'+timeLabel(l.at)+'</time><span>'+escapeHtml(l.text)+'</span></div>').join('')||'<div class="wgu-empty">尚无新动态</div>');
    if(sceneHost.failed || sceneHost.unavailable)showSceneFallback();
    else{dom.hint.textContent='';dom.hint.hidden=true;}
    resizeScene();state.chromeDirty=false;
  }
  function agentMeta(a){
    if(['done','celebrate'].includes(a.state))return '已完成 · '+a.toolCount+' 次工具';
    if(a.state==='error')return '等待处理 · '+a.toolCount+' 次工具';
    if(a.state==='idle')return '休息中 · '+a.toolCount+' 次工具';
    const zone=stationName(a.zone)||'待命';return a.tool?zone+' · '+(a.label||a.tool):zone+' · '+a.toolCount+' 次工具';
  }
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  // -------------------------------------------------------------------------
  // scene wiring (Three.js) — projection state is mirrored into the 3D world
  // -------------------------------------------------------------------------

  const sceneHost = { api: null, failed: false, resizeObserver: null };

  function initScene() {
    if (sceneHost.api || sceneHost.failed) return sceneHost.api;
    if (!dom.canvas || typeof window.YanWorkGuiScene?.create !== 'function' || !window.THREE) {
      sceneHost.failed = true;
      showSceneFallback();
      return null;
    }
    sceneHost.api = window.YanWorkGuiScene.create(dom.canvas, {
      onHover: onSceneHover,
      onClick: onSceneClick,
      onAvailability: available => {
        sceneHost.unavailable = !available;
        if (available) delete dom.root.dataset.error;
        state.chromeDirty = true;
      }
    });
    if (!sceneHost.api) {
      sceneHost.failed = true;
      showSceneFallback();
      return null;
    }
    if (typeof ResizeObserver === 'function') {
      sceneHost.resizeObserver = new ResizeObserver(() => resizeScene());
      sceneHost.resizeObserver.observe(dom.root);
    }
    resizeScene();
    return sceneHost.api;
  }

  function showSceneFallback() {
    if (!dom.hint) return;
    dom.root.dataset.error = 'true';
    dom.hint.hidden = false;
    dom.hint.innerHTML = sceneHost.unavailable
      ? '<strong>正在恢复世界画面</strong>图形连接暂时中断。'
      : '<strong>世界暂时无法显示</strong>当前环境不支持 WebGL。';
    dom.hint.style.display = 'block';
  }

  function disposeScene() {
    sceneHost.resizeObserver?.disconnect();
    sceneHost.resizeObserver = null;
    sceneHost.api?.dispose?.();
    sceneHost.api = null;
  }

  function resizeScene() {
    if (!sceneHost.api || !dom.root) return;
    const rect = dom.root.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(240, Math.round(rect.height));
    const key = width + ':' + height + ':' + window.devicePixelRatio;
    if (sceneHost.sizeKey !== key) {
      sceneHost.sizeKey = key;
      sceneHost.api.resize(width, height, Math.min(2, window.devicePixelRatio || 1));
    }
  }

  function updateActorLifetimes() {
    for (const agent of state.actors.values()) {
      if (agent.celebrateUntil && state.clock > agent.celebrateUntil) {
        agent.celebrateUntil = 0;
        if (agent.state === 'celebrate') agent.state = 'idle';
      }
      if (agent.textAt && Date.now() - agent.textAt > 15000) {
        agent.text = '';
        agent.textAt = 0;
      }
      if (agent.thoughtAt && Date.now() - agent.thoughtAt > 15000) {
        agent.thought = '';
        agent.thoughtAt = 0;
      }
    }
  }

  function reconcileEffects() {
    const api = sceneHost.api;
    for (const effect of state.effects) {
      if (effect.emitted || !api) continue;
      effect.emitted = true;
      if (effect.kind === 'spark') api.emitSparks(effect.zone);
      else if (effect.kind === 'boat') api.emitBoat();
      else if (effect.kind === 'beam') api.emitBeam();
      else if (effect.kind === 'confetti') api.emitConfetti();
    }
    state.effects = state.effects.filter(effect => state.clock - effect.at < effect.duration);
  }

  function activeZones() {
    const zones = new Set();
    for (const station of state.stations.values()) zones.add(station.zone);
    return zones;
  }

  function tick(dt) {
    const api = sceneHost.api;
    if (!api) return;
    updateActorLifetimes();
    reconcileEffects();
    api.setScene(state.scene);
    api.setDayPhase(viewState.day);
    api.setTodos(state.todos);
    if (state.home) api.setHome(state.home);
    const storm = [...state.runs.values()].some(run => run.storm && run.stormUntil > state.clock);
    api.setStorm(storm);
    api.render([...state.actors.values()], activeZones(), dt);
    if (state.clock - viewState.lastFollowAt > 600) {
      const following = api.stats().followId;
      dom.followHint.textContent = following ? '正在跟随 · ' + (state.actors.get(following)?.name || '') : '';
      viewState.lastFollowAt = state.clock;
    }
  }

  // -------------------------------------------------------------------------
  // interaction
  // -------------------------------------------------------------------------

  function tooltipHtml(target) {
    if (target.kind === 'agent') {
      const agent = state.actors.get(target.id);
      if (!agent) return '';
      return `<strong>${escapeHtml(agent.name)}</strong>${agent.role ? ` · ${escapeHtml(agent.role)}` : ''}<br>`
        + `${escapeHtml(agentMeta(agent))}<br>`
        + (agent.text ? `${escapeHtml(tailText(agent.text, 60))}<br>` : '')
        + '';
    }
    if (target.kind === 'building') {
      return `<strong>${escapeHtml(target.name || target.id)}</strong><br>`
        + `${target.buildingKind === 'mcp' ? 'MCP 港口' : `Skill 工坊 · Lv.${target.level || 1}`}<br>`
        + '';
    }
    const activity = state.stations.get(target.zone);
    return `<strong>${escapeHtml(stationName(target.zone))}</strong><br>`
      + (activity
        ? `正在使用：${escapeHtml(activity.label || activity.tool)}${activity.input ? `<br>${escapeHtml(tailText(activity.input, 40))}` : ''}`
        : '当前空闲');
  }

  function onSceneHover(target, clientX, clientY) {
    state.hoverTarget = target;
    if (!dom.tip) return;
    if (!target) {
      dom.tip.hidden = true;
      return;
    }
    dom.tip.innerHTML = tooltipHtml(target);
    dom.tip.hidden = false;
    const rect = dom.root.getBoundingClientRect();
    dom.tip.style.left = `${clamp(clientX - rect.left, 150, rect.width - 150)}px`;
    dom.tip.style.top = `${clamp(clientY - rect.top - 14, 60, rect.height - 20)}px`;
  }

  function onSceneClick(target) {
    dom.tip.hidden = true;
    if (target?.kind === 'agent') sceneHost.api?.focusAgent(target.id);
    if (target?.kind === 'station') sceneHost.api?.focusZone(target.zone);
  }

  function frame(timestamp) {
    if (!state.opened) return;
    const dt = Math.min(0.05, (timestamp - state.lastFrameAt) / 1000 || 0.016);
    state.lastFrameAt = timestamp;
    state.clock += dt * 1000;
    tick(dt);
    if (state.chromeDirty) renderChrome();
    state.raf = requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  async function refresh() {
    try {
      const snapshot = await api.workGuiSnapshot?.();
      applySnapshot(snapshot);
    } catch (error) {
      console.warn('[work-gui] snapshot failed:', error);
    }
  }

  function open() {
    if (!ensureDom()) return;
    state.opened = true;
    initScene();
    if (!state.unsubscribe) {
      state.unsubscribe = api.onWorkGuiEvent?.(ingest) || null;
    }
    void refresh();
    if (!state.raf) {
      state.lastFrameAt = performance.now();
      state.raf = requestAnimationFrame(frame);
    }
    state.chromeDirty = true;
  }

  function close() {
    state.opened = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
  }

  window.addEventListener('resize', () => {
    if (state.opened) resizeScene();
  });

  // The WebGL context stays warm across page toggles (shader recompiles are
  // the expensive part); it is released when the renderer is torn down.
  window.addEventListener('beforeunload', () => disposeScene());

  window.YanWorkGui = {
    open,
    close,
    refresh,
    ingest,
    applySnapshot,
    isOpen: () => state.opened,
    debug3d: () => (sceneHost.api ? sceneHost.api.stats() : { mode: sceneHost.failed ? 'unavailable' : 'idle', objects: 0, triangles: 0, calls: 0 }),
    samplePixels: () => sceneHost.api?.samplePixels(),
    getState: () => ({
      scene: state.scene,
      focusRunId: state.focusRunId,
      runs: [...state.runs.values()].map(run => ({
        runId: run.runId,
        sessionId: run.sessionId,
        title: run.title,
        status: run.status,
        toolCalls: run.toolCalls,
        finishedAt: run.finishedAt,
        energy: run.energy,
        storm: run.storm,
        delivery: run.delivery
      })),
      actors: [...state.actors.values()].map(agent => ({
        id: agent.id,
        kind: agent.kind,
        name: agent.name,
        state: agent.state,
        zone: agent.zone,
        tool: agent.tool,
        text: agent.text,
        runId: agent.runId
      })),
      ticker: state.ticker.slice(0, 5),
      todos: state.todos.length,
      home: state.home
        ? {
          buildings: state.home.buildings?.length || 0,
          memory: state.home.memory?.count || 0,
          achievements: state.home.achievements?.length || 0,
          dayPhase: state.home.dayPhase
        }
        : null,
      effects: state.effects.length
    })
  };
})();
