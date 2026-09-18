'use strict';

// Persistent home island state. The world itself is derived from live data
// (skills, MCP servers, memory entries, Core turns); this store only keeps the
// long-lived counters and unlocks that cannot be re-derived after restarts.

const fs = require('fs');
const path = require('path');

const HOME_VERSION = 1;

const ACHIEVEMENTS = [
  { id: 'first-voyage', title: '首航', hint: '完成第一个任务' },
  { id: 'ten-voyages', title: '老船长', hint: '累计完成 10 个任务' },
  { id: 'hundred-tools', title: '千锤百炼', hint: '累计执行 100 次工具调用' },
  { id: 'first-delivery', title: '灯塔初亮', hint: '第一次通过交付验收' },
  { id: 'five-homes', title: '群岛居民', hint: '在 5 个不同任务里工作过' }
];

function emptyHome() {
  return {
    version: HOME_VERSION,
    updatedAt: 0,
    totals: { completed: 0, aborted: 0, failed: 0, toolCalls: 0, deliveries: 0 },
    sessions: {},
    skills: {},
    achievements: []
  };
}

function clampCounter(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

class WorkGuiHomeStore {
  constructor({ filePath, logger = console } = {}) {
    this.filePath = String(filePath || '');
    this.logger = logger;
    this.state = this.load();
  }

  load() {
    const base = emptyHome();
    if (!this.filePath || !fs.existsSync(this.filePath)) return base;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return base;
      return {
        ...base,
        ...parsed,
        totals: { ...base.totals, ...(parsed.totals || {}) },
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {},
        achievements: Array.isArray(parsed.achievements) ? parsed.achievements.slice(0, 64) : []
      };
    } catch (error) {
      this.logger?.warn?.('[work-gui] home store load failed:', error?.message || error);
      return base;
    }
  }

  persist() {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      this.logger?.warn?.('[work-gui] home store persist failed:', error?.message || error);
    }
  }

  unlock(id, at) {
    if (this.state.achievements.some(item => item.id === id)) return null;
    const definition = ACHIEVEMENTS.find(item => item.id === id);
    if (!definition) return null;
    const achievement = { id, title: definition.title, at: Number(at) || Date.now() };
    this.state.achievements.push(achievement);
    return achievement;
  }

  // Called once per finished Turn. Returns the achievements unlocked by this
  // Turn so the world can play a ceremony for them.
  recordTurn({ sessionId = '', title = '', status = '', skillIds = [], toolCalls = 0, delivery = null, at = 0 } = {}) {
    const timestamp = Number(at) || Date.now();
    const totalStatus = status === 'completed' ? 'completed' : (status === 'failed' ? 'failed' : 'aborted');
    this.state.totals[totalStatus] += 1;
    this.state.totals.toolCalls += clampCounter(toolCalls);
    if (delivery && delivery.verified === true) this.state.totals.deliveries += 1;

    const sessionKey = String(sessionId || '');
    if (sessionKey) {
      const session = this.state.sessions[sessionKey] || { title: '', completed: 0, lastAt: 0 };
      session.title = String(title || session.title || '').slice(0, 120);
      if (totalStatus === 'completed') session.completed += 1;
      session.lastAt = timestamp;
      this.state.sessions[sessionKey] = session;
    }
    for (const skillId of Array.isArray(skillIds) ? skillIds : []) {
      const key = String(skillId || '').trim();
      if (!key) continue;
      const skill = this.state.skills[key] || { uses: 0, lastAt: 0 };
      skill.uses += 1;
      skill.lastAt = timestamp;
      this.state.skills[key] = skill;
    }

    const unlocked = [];
    const push = id => {
      const achievement = this.unlock(id, timestamp);
      if (achievement) unlocked.push(achievement);
    };
    if (this.state.totals.completed >= 1) push('first-voyage');
    if (this.state.totals.completed >= 10) push('ten-voyages');
    if (this.state.totals.toolCalls >= 100) push('hundred-tools');
    if (this.state.totals.deliveries >= 1) push('first-delivery');
    if (Object.keys(this.state.sessions).length >= 5) push('five-homes');

    this.state.updatedAt = timestamp;
    this.persist();
    return unlocked;
  }

  snapshot() {
    return {
      version: this.state.version,
      updatedAt: this.state.updatedAt,
      totals: { ...this.state.totals },
      skillUses: Object.fromEntries(
        Object.entries(this.state.skills).map(([id, entry]) => [id, { uses: clampCounter(entry.uses), lastAt: clampCounter(entry.lastAt) }])
      ),
      achievements: this.state.achievements.map(item => ({ ...item }))
    };
  }
}

module.exports = { WorkGuiHomeStore, ACHIEVEMENTS };
