'use strict';

// Yan Work GUI feed: turns the raw Yan Core event stream into normalized world
// events for the cloud-sea archipelago page. The feed is deliberately
// read-only: it observes Core events, keeps bounded per-run state, persists the
// home island counters, and never talks back into the run pipeline.

const path = require('path');
const { WorkGuiHomeStore } = require('./home-store');
const workflow = require('../subagent/workflow-state');

const FLUSH_INTERVAL_MS = 120;
const EVENT_RING_LIMIT = 2400;
const MAX_BATCH_EVENTS = 260;
const TEXT_TAIL_LIMIT = 420;
const RECENT_RUNS_LIMIT = 12;
const MAX_HELPERS_PER_RUN = 12;
const ENERGY_STEP = 0.01;
const DAY_ACTIVITY_MS = 5 * 60_000;

const ZONES = Object.freeze({
  dock: { id: 'dock', name: '码头' },
  workshop: { id: 'workshop', name: '工坊' },
  forge: { id: 'forge', name: '熔炉' },
  tower: { id: 'tower', name: '瞭望塔' },
  library: { id: 'library', name: '书房' },
  hall: { id: 'hall', name: '议事厅' },
  studio: { id: 'studio', name: '画室' },
  lighthouse: { id: 'lighthouse', name: '灯塔' }
});

const TOOL_ZONE_RULES = [
  [/^(read|glob|grep|list|codegraph|yan_analysis|serena|memory|note)/i, 'library'],
  [/^(skill|yan_skills|read_skill)/i, 'library'],
  [/^(edit|write|apply_patch|create|multi)/i, 'workshop'],
  [/^(bash|shell|powershell|terminal|cmd|exec|python)/i, 'forge'],
  [/^(browser|yan_browser|webfetch|yan_web|anysearch|market|search|fetch)/i, 'tower'],
  [/^(media|image|video|yan_media|vision|tts|audio)/i, 'studio'],
  [/^(task|subagent|todo|plan|ask|question)/i, 'hall'],
  [/^(deliver|submit|acceptance|finish|goal)/i, 'lighthouse']
];

function zoneForTool(tool) {
  const name = String(tool || '').toLowerCase();
  if (!name) return 'workshop';
  for (const [pattern, zone] of TOOL_ZONE_RULES) {
    if (pattern.test(name)) return zone;
  }
  return 'workshop';
}

function clip(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toolLabel(tool) {
  const name = String(tool || '').trim();
  return name || '工具';
}

function toolInputSummary(input) {
  if (!input || typeof input !== 'object') return '';
  const preferred = ['description', 'command', 'filePath', 'file_path', 'path', 'pattern', 'query', 'prompt', 'url'];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return clip(value, 90);
  }
  try {
    return clip(JSON.stringify(input), 90);
  } catch {
    return '';
  }
}

function helperAgentState(record) {
  const timeline = Array.isArray(record?.timeline) ? record.timeline : [];
  const openCalls = new Map();
  let lastTool = '';
  let lastResult = '';
  let text = '';
  let zone = 'hall';
  for (const item of timeline) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'tool_call' && item.callId) {
      openCalls.set(item.callId, item.name || '工具');
      lastTool = item.name || lastTool;
      zone = zoneForTool(item.name);
    } else if (item.type === 'tool_result' && item.callId) {
      openCalls.delete(item.callId);
      lastResult = item.name || lastResult;
    } else if (item.type === 'text' && item.content) {
      text = clip(item.content, 160);
    }
  }
  const currentTool = openCalls.size ? [...openCalls.values()][openCalls.size - 1] : '';
  if (currentTool) zone = zoneForTool(currentTool);
  return { tool: currentTool || lastTool, text, zone, toolCount: timeline.filter(item => item?.type === 'tool_call').length, lastResult };
}

class WorkGuiFeed {
  constructor({
    dataDir = '',
    core,
    emit,
    listSessions,
    listSkills,
    listMcp,
    listMemory,
    logger = console
  } = {}) {
    this.core = typeof core === 'function' ? core : () => core;
    this.emit = typeof emit === 'function' ? emit : () => {};
    this.deps = { listSessions, listSkills, listMcp, listMemory };
    this.logger = logger;
    this.home = new WorkGuiHomeStore({
      filePath: dataDir ? path.join(dataDir, 'work-gui', 'home.json') : '',
      logger
    });
    this.seq = 0;
    this.runs = new Map();
    this.recentRuns = [];
    this.agents = new Map();
    this.workflows = new Map();
    this.ring = [];
    this.queue = [];
    this.buffers = new Map();
    this.flushTimer = 0;
    this.energySeen = new Map();
    this.snapshotCache = { at: 0, value: null };
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    this.runs.clear();
    this.agents.clear();
    this.workflows.clear();
    this.buffers.clear();
  }

  nextSeq() {
    this.seq += 1;
    return this.seq;
  }

  schedule() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = 0;
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  push(kind, { runId = '', sessionId = '', agentId = 'main', payload = {}, at = 0 } = {}) {
    const event = {
      seq: this.nextSeq(),
      ts: Number(at) || Date.now(),
      kind,
      runId: String(runId || ''),
      sessionId: String(sessionId || ''),
      agentId: String(agentId || 'main'),
      payload
    };
    this.queue.push(event);
    this.ring.push(event);
    if (this.ring.length > EVENT_RING_LIMIT) this.ring.splice(0, this.ring.length - EVENT_RING_LIMIT);
    this.schedule();
    return event;
  }

  bufferDelta(runId, sessionId, agentId, kind, delta, at) {
    const text = String(delta || '');
    if (!text) return;
    const key = `${runId}\u0000${agentId}\u0000${kind}`;
    const existing = this.buffers.get(key);
    if (existing) {
      existing.text = (existing.text + text).slice(-TEXT_TAIL_LIMIT);
      existing.at = Number(at) || existing.at;
      return;
    }
    this.buffers.set(key, { runId, sessionId, agentId, kind, text: text.slice(-TEXT_TAIL_LIMIT), at: Number(at) || Date.now() });
  }

  flush() {
    const events = this.queue;
    this.queue = [];
    for (const buffer of this.buffers.values()) {
      events.push({
        seq: this.nextSeq(),
        ts: buffer.at,
        kind: buffer.kind,
        runId: buffer.runId,
        sessionId: buffer.sessionId,
        agentId: buffer.agentId,
        payload: { delta: buffer.text }
      });
    }
    this.buffers.clear();
    if (!events.length) return;
    events.sort((left, right) => left.seq - right.seq);
    for (let index = 0; index < events.length; index += MAX_BATCH_EVENTS) {
      this.emit({ events: events.slice(index, index + MAX_BATCH_EVENTS) });
    }
  }

  run(runId) {
    return this.runs.get(String(runId || '')) || null;
  }

  agent(agentId) {
    const id = String(agentId || '');
    if (!this.agents.has(id)) {
      this.agents.set(id, {
        id,
        kind: id.startsWith('sub:') ? 'sub' : 'main',
        runId: '',
        sessionId: '',
        name: id.startsWith('sub:') ? 'Sub Agent' : 'Yan Agent',
        role: '',
        state: 'idle',
        zone: 'dock',
        tool: '',
        text: '',
        startedAt: 0,
        finishedAt: 0,
        toolCount: 0
      });
    }
    return this.agents.get(id);
  }

  registerRun(turn, at) {
    const runId = String(turn?.id || '');
    if (!runId || this.runs.has(runId)) return this.run(runId);
    const sessionId = String(turn?.threadId || '');
    const thread = this.core()?.getThread?.(sessionId);
    const config = turn?.configSnapshot || {};
    const record = {
      runId,
      sessionId,
      title: clip(thread?.title || '新对话', 80),
      prompt: clip(turn?.intent?.prompt, 160),
      model: clip(config.modelName || config.modelId, 60),
      workMode: String(config.workMode || 'normal'),
      skillIds: (Array.isArray(turn?.intent?.selectedSkills) ? turn.intent.selectedSkills : [])
        .map(skill => String(skill?.id || skill?.name || ''))
        .filter(Boolean),
      status: String(turn?.status || 'created'),
      startedAt: Number(turn?.startedAt) || Number(turn?.createdAt) || Number(at) || Date.now(),
      finishedAt: 0,
      toolCalls: 0,
      helpers: 0,
      energy: null,
      textTail: '',
      storm: '',
      delivery: '',
      startedEmitted: false
    };
    this.runs.set(runId, record);
    const main = this.agent('main');
    main.kind = 'main';
    main.runId = runId;
    main.sessionId = sessionId;
    return record;
  }

  handleCoreEvent(event) {
    if (!event || typeof event !== 'object') return;
    const type = String(event.type || '');
    const at = Number(event.timestamp) || Date.now();
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const turnId = String(event.turnId || '');
    try {
      if (type === 'turn.created') {
        const record = this.registerRun(payload.turn, at);
        if (record) this.schedule();
        return;
      }
      if (!turnId) return;
      const run = this.run(turnId) || (payload.turn ? this.registerRun(payload.turn, at) : null);
      if (!run) return;
      switch (type) {
        case 'turn.started': {
          run.status = 'running';
          if (!run.startedEmitted) {
            run.startedEmitted = true;
            const main = this.agent('main');
            main.state = 'working';
            main.zone = 'dock';
            main.text = '';
            main.startedAt = run.startedAt;
            this.push('run.started', {
              runId: run.runId,
              sessionId: run.sessionId,
              at,
              payload: {
                title: run.title,
                prompt: run.prompt,
                model: run.model,
                workMode: run.workMode,
                skills: run.skillIds.slice(0, 6)
              }
            });
          }
          return;
        }
        case 'turn.completed':
        case 'turn.aborted':
        case 'turn.failed':
        case 'turn.incomplete': {
          this.finishRun(run, type.split('.')[1], payload, at);
          return;
        }
        case 'turn.retrying': {
          this.push('repair', { runId: run.runId, sessionId: run.sessionId, at, payload: { reason: clip(payload.reason || payload.message, 80) } });
          return;
        }
        case 'message.delta':
        case 'reasoning.delta': {
          this.bufferDelta(run.runId, run.sessionId, 'main', type, payload.delta, at);
          return;
        }
        case 'tool.started':
        case 'tool.progress':
        case 'tool.completed': {
          this.handleToolEvent(run, type, payload, at);
          return;
        }
        case 'context.updated':
        case 'context.compacted':
        case 'context.compaction.completed': {
          this.energyChanged(run, at, payload.data || null);
          return;
        }
        case 'provider.error': {
          const message = clip(
            payload.data?.error?.message || payload.data?.message || payload.data?.error || payload.error,
            140
          );
          run.storm = message || '服务出错';
          this.push('storm', { runId: run.runId, sessionId: run.sessionId, at, payload: { message: run.storm } });
          return;
        }
        case 'delivery.acceptance.started':
        case 'delivery.acceptance.repaired':
        case 'delivery.acceptance.passed':
        case 'delivery.acceptance.failed': {
          const phase = type.split('.').pop();
          run.delivery = phase;
          this.push('ceremony', { runId: run.runId, sessionId: run.sessionId, at, payload: { phase } });
          return;
        }
        case 'file.edited': {
          const file = clip(payload.data?.file || payload.data?.path || payload.file, 120);
          if (file) this.push('file.edited', { runId: run.runId, sessionId: run.sessionId, at, payload: { file } });
          return;
        }
        case 'provider.event': {
          this.handleProviderEvent(run, payload, at);
          return;
        }
        default:
          return;
      }
    } catch (error) {
      this.logger?.warn?.('[work-gui] feed event failed:', error?.message || error);
    }
  }

  consumeWorkflow(run, type, data, at) {
    const eventType = String(type || '');
    if (!eventType) return;
    let workflowRun = this.workflows.get(run.runId);
    if (!workflowRun) {
      workflowRun = { subagents: [], timeline: [] };
      this.workflows.set(run.runId, workflowRun);
    }
    // Child-session events carry only the child session id. When exactly one
    // task record is still open without a child, bind them so the helper keeps
    // its parent name/callId instead of splitting into an anonymous record.
    if ((eventType === 'yan.subagent.event' || eventType === 'yan.subagent.history')
      && data?.sessionID
      && !workflowRun.subagents.some(record => record.childSessionID === data.sessionID)) {
      const open = workflowRun.subagents.filter(record => (
        !record.childSessionID && !['completed', 'error', 'interrupted'].includes(String(record.status || ''))
      ));
      if (open.length === 1) open[0].childSessionID = String(data.sessionID);
    }
    try {
      workflow.consume(workflowRun, { type: eventType, data: data && typeof data === 'object' ? data : {} }, Number(at) || Date.now());
    } catch (error) {
      this.logger?.warn?.('[work-gui] subagent event failed:', error?.message || error);
    }
    this.syncHelpers(run, Number(at) || Date.now());
  }

  handleToolEvent(run, type, payload, at) {
    const tool = String(payload.tool || '');
    const callId = String(payload.callId || '');
    const status = String(payload.status || '');
    const input = payload.data?.part?.state?.input || payload.data?.input || {};
    const zone = zoneForTool(tool);
    const main = this.agent('main');
    // Parent task parts and their completion feed the subagent workflow so
    // helpers are tracked with the same fidelity as the in-app panel.
    this.consumeWorkflow(run, payload.rawType, payload.data, at);
    if (type === 'tool.started') {
      run.toolCalls += 1;
      main.state = 'working';
      main.zone = zone;
      main.tool = tool;
      main.toolCount += 1;
      this.push('tool.started', {
        runId: run.runId,
        sessionId: run.sessionId,
        at,
        payload: {
          callId,
          tool,
          label: toolLabel(tool),
          zone,
          zoneName: ZONES[zone]?.name || zone,
          input: toolInputSummary(input)
        }
      });
      return;
    }
    if (type === 'tool.completed') {
      if (main.tool === tool) main.tool = '';
      this.push('tool.finished', {
        runId: run.runId,
        sessionId: run.sessionId,
        at,
        payload: { callId, tool, zone, zoneName: ZONES[zone]?.name || zone, status: status === 'error' ? 'error' : 'completed' }
      });
      return;
    }
    if (type === 'tool.progress') {
      const title = clip(input.title || input.description || '', 80);
      if (title && title !== main.text) {
        main.text = title;
        this.push('tool.progress', { runId: run.runId, sessionId: run.sessionId, at, payload: { callId, tool, zone, title } });
      }
    }
  }

  handleProviderEvent(run, payload, at) {
    const rawType = String(payload.rawType || '');
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    if (rawType === 'yan.subagent.event' || rawType === 'yan.subagent.history') {
      this.consumeWorkflow(run, rawType, data, at);
      return;
    }
    if (rawType === 'todo.updated') {
      const todos = Array.isArray(data.todos) ? data.todos : [];
      this.push('todo.updated', {
        runId: run.runId,
        sessionId: run.sessionId,
        at,
        payload: {
          todos: todos.slice(0, 12).map(todo => ({
            id: clip(todo?.id, 40),
            text: clip(todo?.content || todo?.text, 60),
            status: clip(todo?.status, 20)
          }))
        }
      });
      return;
    }
    if (rawType === 'yan.context.budget') {
      this.energyChanged(run, at, data);
      return;
    }
    if (rawType === 'session.error') {
      const message = clip(data.error?.message || data.message || data.error, 140);
      run.storm = message || '服务出错';
      this.push('storm', { runId: run.runId, sessionId: run.sessionId, at, payload: { message: run.storm } });
    }
  }

  syncHelpers(run, at) {
    const workflowRun = this.workflows.get(run.runId);
    if (!workflowRun) return;
    const records = Array.isArray(workflowRun.subagents) ? workflowRun.subagents.slice(0, MAX_HELPERS_PER_RUN) : [];
    run.helpers = records.length;
    records.forEach((record, index) => {
      const agentId = `sub:${record.callId || record.id || index}`;
      const agent = this.agent(agentId);
      const previous = { state: agent.state, tool: agent.tool, text: agent.text, zone: agent.zone, name: agent.name, role: agent.role };
      const activity = helperAgentState(record);
      const finished = ['completed', 'error', 'interrupted'].includes(String(record.status || ''));
      agent.kind = 'sub';
      agent.runId = run.runId;
      agent.sessionId = run.sessionId;
      agent.name = `${workflow.name(record.role) || 'Sub'} Agent`;
      agent.role = clip(record.role, 24);
      agent.state = finished
        ? (record.status === 'completed' ? 'done' : (record.status === 'error' ? 'error' : 'idle'))
        : 'working';
      agent.zone = activity.zone;
      agent.tool = activity.tool;
      agent.text = activity.text;
      agent.toolCount = activity.toolCount;
      if (!agent.startedAt) agent.startedAt = Number(record.startedAt) || at;
      agent.finishedAt = finished ? (Number(record.completedAt) || at) : 0;
      const changed = previous.state !== agent.state
        || previous.tool !== agent.tool
        || previous.text !== agent.text
        || previous.zone !== agent.zone
        || previous.name !== agent.name;
      if (!changed) return;
      const spawned = previous.state === 'idle' && agent.state !== 'idle';
      this.push(spawned ? 'agent.spawned' : 'agent.updated', {
        runId: run.runId,
        sessionId: run.sessionId,
        agentId,
        at,
        payload: {
          name: agent.name,
          role: agent.role,
          state: agent.state,
          zone: agent.zone,
          zoneName: ZONES[agent.zone]?.name || agent.zone,
          tool: agent.tool,
          label: agent.tool ? toolLabel(agent.tool) : '',
          text: agent.text,
          toolCount: agent.toolCount
        }
      });
    });
  }

  energyChanged(run, at, data = null) {
    const turn = this.core()?.getTurn?.(run.runId);
    const stats = turn?.contextStats || {};
    const tokens = Number(data?.contextTokens ?? data?.tokens ?? stats.lastObservedTokens ?? stats.contextTokens) || 0;
    const budget = Number(data?.softThreshold ?? data?.threshold ?? stats.softThreshold ?? stats.window) || 0;
    if (tokens <= 0 && budget <= 0) return;
    const ratio = budget > 0 ? Math.max(0, Math.min(1, tokens / budget)) : 0;
    const previous = this.energySeen.get(run.runId);
    const now = Number(at) || Date.now();
    if (previous && Math.abs(previous.ratio - ratio) < ENERGY_STEP && now - previous.at < 4_000) return;
    this.energySeen.set(run.runId, { ratio, at: now });
    run.energy = { tokens, budget, ratio };
    this.push('energy.changed', {
      runId: run.runId,
      sessionId: run.sessionId,
      at: now,
      payload: { tokens, budget, ratio, compactionCount: Math.max(0, Number(stats.compactionCount) || 0) }
    });
  }

  finishRun(run, status, payload, at) {
    if (run.status === status && run.finishedAt) return;
    const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
    run.status = status;
    run.finishedAt = at;
    run.textTail = clip(result?.text, 140);
    if (result?.delivery) {
      run.delivery = result.delivery.verified === true
        ? 'passed'
        : (result.delivery.skipped === true ? 'skipped' : (result.delivery.failure ? 'failed' : run.delivery));
    }
    const main = this.agent('main');
    main.state = status === 'completed' ? 'done' : (status === 'failed' ? 'error' : 'done');
    main.tool = '';
    main.finishedAt = at;
    const unlocked = this.home.recordTurn({
      sessionId: run.sessionId,
      title: run.title,
      status,
      skillIds: run.skillIds,
      toolCalls: run.toolCalls,
      delivery: result?.delivery || null,
      at
    });
    this.push('run.finished', {
      runId: run.runId,
      sessionId: run.sessionId,
      at,
      payload: {
        status,
        textTail: run.textTail,
        toolCalls: run.toolCalls,
        helpers: run.helpers,
        title: run.title,
        delivery: run.delivery || ''
      }
    });
    for (const achievement of unlocked) {
      this.push('ceremony', {
        runId: run.runId,
        sessionId: run.sessionId,
        at,
        payload: { phase: 'achievement', id: achievement.id, title: achievement.title }
      });
    }
    this.recentRuns.unshift(run.runId);
    this.recentRuns = [...new Set(this.recentRuns)].slice(0, RECENT_RUNS_LIMIT);
  }

  trimRun(run) {
    return {
      runId: run.runId,
      sessionId: run.sessionId,
      title: run.title,
      prompt: run.prompt,
      model: run.model,
      status: run.status,
      workMode: run.workMode,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      toolCalls: run.toolCalls,
      helpers: run.helpers,
      energy: run.energy,
      textTail: run.textTail,
      storm: run.storm,
      delivery: run.delivery || ''
    };
  }

  trimAgent(agent) {
    return {
      id: agent.id,
      kind: agent.kind,
      runId: agent.runId,
      sessionId: agent.sessionId,
      name: agent.name,
      role: agent.role,
      state: agent.state,
      zone: agent.zone,
      tool: agent.tool,
      label: agent.tool ? toolLabel(agent.tool) : '',
      text: agent.text,
      startedAt: agent.startedAt,
      finishedAt: agent.finishedAt,
      toolCount: agent.toolCount
    };
  }

  async snapshot() {
    if (this.snapshotCache.value && Date.now() - this.snapshotCache.at < 1_500) return this.snapshotCache.value;
    const core = this.core();
    const liveRuns = [...this.runs.values()].filter(run => !run.finishedAt);
    const orderedRuns = [
      ...liveRuns,
      ...this.recentRuns.map(runId => this.runs.get(runId)).filter(Boolean).filter(run => run.finishedAt)
    ].slice(0, RECENT_RUNS_LIMIT);
    const liveAgentIds = new Set();
    for (const run of liveRuns) {
      for (const agent of this.agents.values()) {
        if (agent.runId === run.runId) liveAgentIds.add(agent.id);
      }
      liveAgentIds.add('main');
    }
    const agents = [...this.agents.values()].filter(agent => liveAgentIds.has(agent.id) || agent.runId === orderedRuns[0]?.runId);

    let sessions = [];
    try {
      const summaries = this.deps.listSessions ? await this.deps.listSessions() : [];
      sessions = (Array.isArray(summaries) ? summaries : []).slice(0, 12).map(item => ({
        id: String(item?.id || ''),
        title: clip(item?.title || '新对话', 60),
        workspace: String(item?.workspace || ''),
        updatedAt: Number(item?.updatedAt) || 0,
        workspaceMissing: item?.workspaceMissing === true
      })).filter(item => item.id);
    } catch (error) {
      this.logger?.warn?.('[work-gui] session snapshot failed:', error?.message || error);
    }

    let skills = [];
    try {
      const list = this.deps.listSkills ? this.deps.listSkills() : [];
      skills = (Array.isArray(list) ? list : []).map(item => ({
        id: String(item?.id || item?.name || ''),
        name: clip(item?.name || item?.id, 40)
      })).filter(item => item.id);
    } catch (error) {
      this.logger?.warn?.('[work-gui] skill snapshot failed:', error?.message || error);
    }
    let mcpServers = [];
    try {
      const list = this.deps.listMcp ? this.deps.listMcp() : [];
      mcpServers = (Array.isArray(list) ? list : []).map(item => ({
        id: String(item?.id || item?.name || ''),
        name: clip(item?.name || item?.id, 40),
        enabled: item?.enabled !== false
      })).filter(item => item.id);
    } catch (error) {
      this.logger?.warn?.('[work-gui] mcp snapshot failed:', error?.message || error);
    }
    let memory = { count: 0, recent: [] };
    try {
      const value = this.deps.listMemory ? this.deps.listMemory() : null;
      if (value && typeof value === 'object' && Number.isFinite(Number(value.count))) {
        memory = { count: Math.max(0, Number(value.count)), recent: Array.isArray(value.recent) ? value.recent.slice(0, 4) : [] };
      }
    } catch (error) {
      this.logger?.warn?.('[work-gui] memory snapshot failed:', error?.message || error);
    }

    const home = this.home.snapshot();
    const buildings = [];
    for (const skill of skills) {
      const uses = Number(home.skillUses[skill.id]?.uses) || 0;
      buildings.push({
        id: `skill:${skill.id}`,
        kind: 'skill',
        name: skill.name,
        level: Math.max(1, Math.min(5, 1 + Math.floor(uses / 3))),
        uses,
        lastAt: Number(home.skillUses[skill.id]?.lastAt) || 0
      });
    }
    for (const server of mcpServers) {
      buildings.push({
        id: `mcp:${server.id}`,
        kind: 'mcp',
        name: server.name,
        level: server.enabled ? 2 : 1,
        uses: 0,
        lastAt: 0
      });
    }
    buildings.sort((left, right) => right.uses - left.uses || left.name.localeCompare(right.name));
    const lastActivityAt = orderedRuns.reduce((latest, run) => Math.max(latest, Number(run.finishedAt) || Number(run.startedAt) || 0), 0);
    const dayPhase = liveRuns.length > 0 ? 'day' : (Date.now() - lastActivityAt < DAY_ACTIVITY_MS ? 'day' : 'night');

    const value = {
      generatedAt: Date.now(),
      seq: this.seq,
      sessions,
      runs: orderedRuns.map(run => this.trimRun(run)),
      activeRunId: liveRuns[liveRuns.length - 1]?.runId || '',
      agents: agents.map(agent => this.trimAgent(agent)),
      recentEvents: this.ring.slice(-40).map(event => ({
        seq: event.seq,
        ts: event.ts,
        kind: event.kind,
        runId: event.runId,
        agentId: event.agentId,
        payload: event.payload
      })),
      home: {
        ...home,
        buildings: buildings.slice(0, 14),
        memory,
        mcp: mcpServers.slice(0, 8),
        dayPhase
      }
    };
    this.snapshotCache = { at: Date.now(), value };
    return value;
  }
}

module.exports = { WorkGuiFeed, ZONES, zoneForTool };
