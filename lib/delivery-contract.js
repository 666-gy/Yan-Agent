(function exposeDeliveryContract(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanDeliveryContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const FIELDS = Object.freeze(['intent', 'artifact', 'scope', 'direction', 'worldview', 'decisions', 'acceptance']);
  const LIMITS = { intent: 80, artifact: 80, scope: 800, direction: 800, worldview: 800, decisions: 1600, acceptance: 1200 };
  const ENUMS = {
    intent: ['demo', 'delivery', 'presentable'],
    artifact: ['frontend', 'backend', 'full-stack', 'code', 'answer']
  };

  function normalize(contract = {}) {
    const result = {};
    for (const field of FIELDS) {
      if (typeof contract?.[field] !== 'string') continue;
      let value = contract[field].replace(/\r\n?/gu, '\n').trim().slice(0, LIMITS[field]);
      if (ENUMS[field]) {
        value = value.toLowerCase().match(/^[a-z-]+/u)?.[0] || '';
        if (!ENUMS[field].includes(value)) continue;
      }
      if (value) result[field] = value;
    }
    return result;
  }

  function parseFields(text) {
    const result = {};
    let active = '';
    for (const line of String(text || '').split(/\r?\n/u)) {
      const field = line.match(/^\s*(intent|artifact|scope|direction|worldview|世界观意识|decisions|acceptance)\s*[:：]\s*(.*?)\s*$/iu);
      if (field) {
        active = field[1].toLowerCase() === '世界观意识' ? 'worldview' : field[1].toLowerCase();
        result[active] = field[2];
      } else if (/^\s*[a-z_]+\s*[:：]/iu.test(line)) {
        active = '';
      } else if (active && line.trim()) {
        result[active] = `${result[active]}\n${line.trim()}`;
      }
    }
    const normalized = normalize(result);
    return Object.keys(normalized).length ? normalized : null;
  }

  function parseText(text) {
    let contract = null;
    for (const match of String(text || '').matchAll(/<yan-delivery-contract>([\s\S]*?)<\/yan-delivery-contract>/giu)) {
      const update = parseFields(match[1]);
      if (update) contract = { ...contract, ...update };
    }
    return contract;
  }

  function stripReviews(text) {
    const result = String(text || '')
      .replace(/<yan-delivery-review>[\s\S]*?<\/yan-delivery-review>/giu, '')
      .replace(/<yan-delivery-review>[\s\S]*$/iu, '');
    const start = result.lastIndexOf('<');
    if (start >= 0 && '<yan-delivery-review>'.startsWith(result.slice(start).toLowerCase())) return result.slice(0, start);
    return result;
  }

  const PROTOCOL_TAGS = Object.freeze(['<yan-delivery-contract>', '<yan-delivery-review>', '<yan-delivery-agreement>', '<yan-reasoning-sidepath>']);

  // Removes whole delivery protocol blocks (contract/review/agreement) from
  // user-facing text: closed pairs first, then an unterminated trailing block,
  // then a dangling opening-tag prefix left behind by a cut stream.
  function stripProtocolBlocks(text) {
    let result = String(text || '');
    let previous;
    do {
      previous = result;
      for (const tag of PROTOCOL_TAGS) {
        const name = tag.slice(1, -1);
        result = result.replace(new RegExp(`<${name}>[\\s\\S]*?<\\/${name}>`, 'giu'), '');
      }
    } while (result !== previous);
    for (const tag of PROTOCOL_TAGS) {
      const name = tag.slice(1, -1);
      result = result.replace(new RegExp(`<${name}>[\\s\\S]*$`, 'iu'), '');
    }
    const lower = result.toLowerCase();
    const lastOpen = lower.lastIndexOf('<');
    if (lastOpen >= 0 && PROTOCOL_TAGS.some(tag => tag.startsWith(lower.slice(lastOpen)))) {
      result = result.slice(0, lastOpen);
    }
    return result;
  }

  // Only assistant text events reach this tracker. Keep a bounded tail so
  // normal code generation does not create an unbounded second transcript.
  class StreamTracker {
    constructor() {
      this.parts = new Map();
      this.types = new Map();
      this.contract = null;
    }

    observe(event) {
      const data = event?.properties || event?.data || {};
      const part = data.part;
      let key;
      let text;
      if (event?.type === 'message.part.updated' && part?.id) {
        this.types.set(String(part.id), part.type);
        if (this.types.size > 64) this.types.delete(this.types.keys().next().value);
      }
      if (event?.type === 'message.part.updated' && part?.type === 'text') {
        key = String(part.id || part.messageID || 'text');
        text = String(part.text || this.parts.get(key) || '');
      } else if (event?.type === 'message.part.delta' && data.field === 'text') {
        key = String(data.partID || data.messageID || 'text');
        if (this.types.get(key) && this.types.get(key) !== 'text') return null;
        text = (this.parts.get(key) || '') + String(data.delta || '');
      } else if (event?.type === 'session.next.text.delta') {
        key = `next:${data.messageID || 'text'}`;
        text = (this.parts.get(key) || '') + String(data.delta || '');
      } else {
        return null;
      }
      text = text.slice(-16000);
      this.parts.set(key, text);
      if (this.parts.size > 32) {
        const oldest = this.parts.keys().next().value;
        this.parts.delete(oldest);
        this.types.delete(oldest);
      }
      if (event?.type === 'message.part.delta' && !this.types.has(key)) return null;
      const update = parseText(text);
      if (!update) return null;
      const next = normalize({ ...this.contract, ...update });
      if (JSON.stringify(next) === JSON.stringify(this.contract)) return null;
      this.contract = next;
      return next;
    }
  }

  return { FIELDS, normalize, parseFields, parseText, stripReviews, stripProtocolBlocks, StreamTracker };
}));
