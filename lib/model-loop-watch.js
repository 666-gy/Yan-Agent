'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? '').digest('hex');
}

// Exact trailing cycles, not similarity of prose. Bounded history and scan
// cadence follow Reasonix's conservative streaming perseveration guard.
function trailingCycle(items, repeats, maxPeriod, minSpan = 0) {
  const size = items.length;
  for (let period = 1; period <= Math.min(maxPeriod, Math.floor(size / repeats)); period++) {
    if (period * repeats < minSpan) continue;
    let equal = true;
    for (let offset = period; offset < period * repeats; offset++) {
      if (items[size - 1 - offset] !== items[size - 1 - offset % period]) { equal = false; break; }
    }
    if (equal) return period;
  }
  return 0;
}

class ModelLoopWatch {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.sequence = 0;
    this.lastNotice = new Map();
    this.reset();
  }

  reset() {
    this.reasoning = new Map();
    this.calls = new Map();
    this.finished = new Set();
    this.tools = [];
    this.toolTripped = false;
    this.progress = new Map();
  }

  notice(kind, repeats, detail) {
    const timestamp = this.now();
    if (timestamp - (this.lastNotice.get(kind) ?? -Infinity) < 60_000) return null;
    this.lastNotice.set(kind, timestamp);
    return { type: 'yan.model.loop-warning', data: {
      id: ++this.sequence, kind, repeats, timestamp,
      message: `${kind === 'reasoning' ? '思考内容' : '工具调用及结果'}连续重复 ${repeats} 次，疑似陷入循环。任务仍在继续，可检查进展或手动停止。`,
      ...detail
    } };
  }

  observe(event, settings = {}) {
    if (settings.loopNotification === false) { this.reset(); return null; }
    const repeats = 5;
    const data = event?.data || event?.properties || {};
    const part = data.part;
    const type = event?.type;
    if (type === 'file.edited' || type === 'todo.updated'
      || (type === 'session.diff' && data.diff?.length)) {
      // Replayed diffs or unchanged todos do not count as new effects.
      if (type !== 'file.edited') {
        const signature = fingerprint(data);
        if (this.progress.get(type) === signature) return null;
        this.progress.set(type, signature);
      }
      this.tools = []; this.toolTripped = false;
      return null;
    }
    const isNext = type === 'session.next.reasoning.delta' || type === 'session.next.reasoning.ended';
    const isPart = (type === 'message.part.updated' && part?.type === 'reasoning')
      || (type === 'message.part.delta' && (data.field === 'reasoning' || this.reasoning.has(String(data.partID || ''))));
    if (isNext || isPart) {
      const id = String(isNext ? data.reasoningID || 'stream' : part?.id || data.partID || 'stream');
      let channel = this.reasoning.get(id);
      if (!channel) {
        channel = { tail: '', length: 0, sinceScan: 0, tripped: false, next: false };
        this.reasoning.set(id, channel);
        if (this.reasoning.size > 32) this.reasoning.delete(this.reasoning.keys().next().value);
      }
      // The next and legacy events may carry the same part. Once next owns a
      // channel, legacy deltas must not double its content.
      if (!isNext && channel.next && type === 'message.part.delta') return null;
      if (isNext) channel.next = true;
      const snapshot = type === 'message.part.updated' || type.endsWith('.ended');
      let delta = String(snapshot ? part?.text ?? data.text ?? '' : data.delta || '');
      if (snapshot) {
        const prefix = delta.slice(Math.max(0, channel.length - channel.tail.length), channel.length);
        if (delta.length >= channel.length && prefix === channel.tail) delta = delta.slice(channel.length);
        else { channel.tail = ''; channel.length = 0; channel.sinceScan = 0; channel.tripped = false; }
      }
      channel.length += delta.length;
      channel.tail = (channel.tail + delta).slice(-2048 * repeats);
      channel.sinceScan += delta.length;
      if (channel.sinceScan < 128 && !snapshot) return null;
      channel.sinceScan = 0;
      const period = trailingCycle(channel.tail, repeats, 2048, 128);
      const rising = period && !channel.tripped;
      channel.tripped = !!period;
      return rising ? this.notice('reasoning', repeats, { period }) : null;
    }
    if (type === 'session.next.tool.called' || (type === 'message.part.updated' && part?.type === 'tool')) {
      const id = String(part?.callID || part?.id || data.callID || '');
      if (!id || this.finished.has(id)) return null;
      this.calls.set(id, { name: String(part?.tool || data.tool || 'tool'), input: part?.state?.input || data.input || {} });
      if (this.calls.size > 256) this.calls.delete(this.calls.keys().next().value);
      if (!['completed', 'error'].includes(part?.state?.status)) return null;
      return this.complete(id, part.state.status === 'completed', part.state.output ?? part.state.error ?? '', repeats);
    }
    if (type === 'session.next.tool.success' || type === 'session.next.tool.failed') {
      return this.complete(String(data.callID || ''), type.endsWith('.success'), data.result ?? data.content ?? data.error ?? '', repeats);
    }
    return null;
  }

  complete(id, ok, output, repeats) {
    const call = this.calls.get(id);
    if (!call || this.finished.has(id)) return null;
    this.calls.delete(id);
    this.finished.add(id);
    if (this.finished.size > 1024) this.finished.delete(this.finished.values().next().value);
    // Explicit wait/poll tools reporting ongoing work are not failed attempts.
    const waitingTool = /(?:^|[._/])(?:wait(?:_[a-z]+)*|poll(?:_[a-z]+)*|sleep)$/.test(call.name);
    if (ok && waitingTool) { this.tools = []; this.toolTripped = false; return null; }
    this.tools.push(fingerprint({ name: call.name, input: call.input, ok, output }));
    this.tools = this.tools.slice(-4 * repeats);
    const period = trailingCycle(this.tools, repeats, 4);
    const rising = period && !this.toolTripped;
    this.toolTripped = !!period;
    return rising ? this.notice('tool', repeats, { tool: call.name, period }) : null;
  }
}

module.exports = { ModelLoopWatch, trailingCycle };
