'use strict';

// Tool capability table. Every tool a provider may invoke is classified by
// what it can touch, so schedulers and UI can reason about concurrency and
// risk without hard-coding tool names at each call site.
const TOOL_CAPABILITY_TABLE = Object.freeze({
  read: ['read', 'grep', 'glob', 'list', 'ls', 'webfetch', 'websearch',
    'yan_skills_find_skills', 'yan_skills_list_installed_skills', 'yan_skills_read_skill',
    'yan_skills_read_skill_resources'],
  write: ['edit', 'write', 'apply_patch', 'multiedit', 'notebookedit'],
  shell: ['bash', 'shell', 'powershell', 'cmd'],
  network: ['webfetch', 'websearch', 'browser_navigate', 'browser_click', 'browser_type',
    'yan_browser_navigate', 'yan_browser_snapshot', 'yan_browser_click', 'yan_browser_type',
    'yan_browser_fill', 'yan_browser_press_key', 'yan_browser_scroll', 'yan_browser_wait'],
  git: ['git_status', 'git_diff', 'git_commit', 'git_push', 'git_pull', 'git_checkout',
    'git_branch', 'git_stage'],
  process: ['task', 'subtask', 'agent'],
  state: ['todowrite', 'todoread'],
  media: ['image_generate', 'video_generate', 'yan_media_generate_image', 'yan_media_generate_video'],
  desktop: ['computer', 'computer_use', 'screenshot', 'yan_computer_screenshot',
    'yan_computer_click', 'yan_computer_type', 'yan_computer_key']
});

const CAPABILITY_KEYS = Object.freeze(Object.keys(TOOL_CAPABILITY_TABLE));

// Prefix rules cover prefixed MCP names (e.g. yan-session_*) and families too
// broad to enumerate (git*, computer*).
const TOOL_CAPABILITY_PREFIX_RULES = Object.freeze([
  { prefix: 'git', capability: 'git' },
  { prefix: 'computer', capability: 'desktop' },
  { prefix: 'terminal', capability: 'shell' },
  { prefix: 'yan_skills_install_skill', capability: 'write' },
  { prefix: 'yan_skills_remove_skill', capability: 'write' }
]);

function classifyToolCapabilities(name) {
  const normalized = String(name || '').trim().toLowerCase();
  const capabilities = {};
  for (const key of CAPABILITY_KEYS) capabilities[key] = false;
  if (!normalized) return capabilities;
  for (const key of CAPABILITY_KEYS) {
    if (TOOL_CAPABILITY_TABLE[key].includes(normalized)) capabilities[key] = true;
  }
  for (const rule of TOOL_CAPABILITY_PREFIX_RULES) {
    if (normalized === rule.prefix || normalized.startsWith(`${rule.prefix}_`) || normalized.startsWith(`${rule.prefix}-`)) {
      capabilities[rule.capability] = true;
    }
  }
  // A shell tool can reach the network, git, and the process tree.
  if (capabilities.shell) {
    capabilities.network = true;
    capabilities.git = true;
    capabilities.process = true;
  }
  // Anything not provably read-only must be treated as mutating.
  const readOnly = capabilities.read
    && !capabilities.write && !capabilities.shell && !capabilities.git
    && !capabilities.process && !capabilities.state && !capabilities.media
    && !capabilities.desktop;
  capabilities.mutating = !readOnly;
  return capabilities;
}

// Fair resource lock scheduler: N readers or 1 writer per resource, FIFO
// acquisition, optional timeout. This is the generic lock Yan-side runners
// (media generation, browser claims, harness writes) build on.
class ResourceLockManager {
  constructor({ maxWaiters = 128 } = {}) {
    this.maxWaiters = Math.max(1, Number(maxWaiters) || 128);
    this.resources = new Map(); // resourceId -> { holders:Set, queue:[] }
  }

  #resource(resourceId) {
    const id = String(resourceId || '');
    let entry = this.resources.get(id);
    if (!entry) {
      entry = { holders: new Set(), queue: [] };
      this.resources.set(id, entry);
    }
    return entry;
  }

  // Resolves a lock handle { resourceId, mode, owner } or rejects with an
  // Error carrying code: 'YAN_LOCK_TIMEOUT' | 'YAN_LOCK_QUEUE_FULL'.
  acquire(resourceId, mode = 'read', { owner = '', timeoutMs = 10_000 } = {}) {
    const id = String(resourceId || '');
    if (!id) return Promise.reject(new TypeError('ResourceLockManager requires a resourceId.'));
    const wantedMode = mode === 'write' ? 'write' : 'read';
    const entry = this.#resource(id);
    const tryGrant = () => {
      if (entry.holders.size === 0) return true;
      // Readers share the resource only with other readers; a writer needs it
      // exclusively. FIFO fairness: waiters already queued block new grants.
      if (entry.queue.length > 0) return false;
      if (wantedMode === 'read') return ![...entry.holders].some(holder => holder.mode === 'write');
      return entry.holders.size === 0;
    };

    const handle = { resourceId: id, mode: wantedMode, owner: String(owner || '') };
    if (tryGrant()) {
      entry.holders.add(handle);
      return Promise.resolve(handle);
    }
    if (entry.queue.length >= this.maxWaiters) {
      return Promise.reject(Object.assign(new Error(`Resource queue is full for "${id}".`), { code: 'YAN_LOCK_QUEUE_FULL' }));
    }
    return new Promise((resolve, reject) => {
      const waiter = { handle, resolve, reject, timer: null };
      if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
        waiter.timer = setTimeout(() => {
          const index = entry.queue.indexOf(waiter);
          if (index >= 0) entry.queue.splice(index, 1);
          reject(Object.assign(new Error(`Timed out waiting for resource "${id}".`), { code: 'YAN_LOCK_TIMEOUT' }));
          if (!entry.holders.size && !entry.queue.length) this.resources.delete(id);
        }, Number(timeoutMs));
        // This timer settles an awaited acquisition; keep it alive until
        // release or timeout, including standalone tools and test processes.
      }
      entry.queue.push(waiter);
    });
  }

  release(handle) {
    if (!handle) return false;
    const entry = this.resources.get(String(handle.resourceId || ''));
    if (!entry || !entry.holders.delete(handle)) return false;
    this.#grantNext(entry);
    if (!entry.holders.size && !entry.queue.length) this.resources.delete(String(handle.resourceId || ''));
    return true;
  }

  #grantNext(entry) {
    while (entry.queue.length) {
      if (entry.holders.size > 0) {
        const writerHolding = [...entry.holders].some(holder => holder.mode === 'write');
        if (writerHolding) return;
        const next = entry.queue[0];
        if (next.handle.mode === 'write') return;
      }
      const waiter = entry.queue.shift();
      if (waiter.timer) clearTimeout(waiter.timer);
      entry.holders.add(waiter.handle);
      waiter.resolve(waiter.handle);
    }
  }

  // Convenience: acquire -> run -> release, releasing even on throw.
  async withLock(resourceId, mode, options, fn) {
    const handle = await this.acquire(resourceId, mode, options);
    try {
      return await fn(handle);
    } finally {
      this.release(handle);
    }
  }

  status() {
    const resources = {};
    for (const [id, entry] of this.resources) {
      resources[id] = { holders: entry.holders.size, waiting: entry.queue.length };
    }
    return { resources, locked: Object.values(resources).some(item => item.holders > 0) };
  }
}

module.exports = {
  CAPABILITY_KEYS,
  ResourceLockManager,
  TOOL_CAPABILITY_PREFIX_RULES,
  TOOL_CAPABILITY_TABLE,
  classifyToolCapabilities
};
