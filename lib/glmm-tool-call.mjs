import protocolText from './protocol-text.js';
import { newToolCallId } from './opencode-dsml-provider.mjs';

const { ProtocolTextContext, findUnquotedMarkup } = protocolText;
export const MAX_GLMM_BYTES = 8 * 1024 * 1024;
export const MAX_GLMM_CALLS = 64;
const START = '<tool_call>';
const END = '</tool_call>';
const KEY = '<arg_key>';
const KEY_END = '</arg_key>';
const VALUE = '<arg_value>';
const VALUE_END = '</arg_value>';

function failure(message) {
  return new Error(`GLM GLMM compatibility failed: ${message}`);
}

// Raw strings in the official template are NOT JSON quoted or XML escaped.
// Consult the supplied schema before decoding, so file contents such as
// "true", "123", JSON source, backslashes and &amp; remain byte-for-byte text.
function schemaTypes(schema, root, depth = 0) {
  if (!schema || depth > 12) return [];
  if (schema.$ref?.startsWith('#/')) {
    const resolved = schema.$ref.slice(2).split('/').reduce((value, key) =>
      value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    return schemaTypes(resolved, root, depth + 1);
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  return [...types, ...['anyOf', 'oneOf', 'allOf'].flatMap(key =>
    (schema[key] || []).flatMap(item => schemaTypes(item, root, depth + 1)))];
}

function decodeValue(raw, schema, root) {
  const types = schemaTypes(schema, root);
  if (types.includes('string')) return raw;
  try { return JSON.parse(raw); } catch {
    if (types.length && !types.includes('string')) throw failure('Invalid JSON for a non-string argument.');
    return raw;
  }
}

export function glmmToolCatalog(options = {}) {
  if (options.toolChoice?.type === 'none') return new Map();
  // An absent catalog in a native Task child is resolved by the kernel's
  // registry and permission checks, just as native function calls are.
  if (options.tools == null) return null;
  if (Array.isArray(options.tools)) return new Map(options.tools.map(tool => [
    tool.name || tool.function?.name,
    tool.inputSchema || tool.parameters || tool.function?.parameters || {}
  ]).filter(([name]) => !!name));
  return new Map(Object.entries(options.tools).filter(([, enabled]) => enabled !== false));
}

// Incremental grammar, rather than an XML parser: arguments can contain HTML,
// shell redirection and literal </tool_call> strings. No code is evaluated.
export class GlmmTextDecoder {
  constructor(catalog = null, budget = { calls: 0, bytes: 0 }) {
    this.catalog = catalog;
    this.budget = budget;
    this.pending = '';
    this.state = 'text';
    this.context = new ProtocolTextContext();
    this.converted = false;
    this.fragments = [];
  }

  push(value) {
    this.pending += String(value || '');
    return this.drain(false);
  }

  finish() { return this.drain(true); }

  take(length) {
    const value = this.pending.slice(0, length);
    this.pending = this.pending.slice(length);
    if (this.state !== 'text') {
      this.budget.bytes += Buffer.byteLength(value);
      if (this.budget.bytes > MAX_GLMM_BYTES) throw failure('Tool calls exceed the 8 MiB response limit.');
    }
    return value;
  }

  // Consume ordinary data once and retain only a possible delimiter suffix.
  until(marker, final) {
    const index = this.pending.indexOf(marker);
    if (index >= 0) {
      this.fragments.push(this.take(index));
      this.take(marker.length);
      const result = this.fragments.join('');
      this.fragments = [];
      return result;
    }
    if (final) throw failure(`Incomplete Tool Call (${this.state}).`);
    const length = Math.max(0, this.pending.length - marker.length + 1);
    if (length) this.fragments.push(this.take(length));
    return null;
  }

  drain(final) {
    const output = [];
    while (this.pending) {
      if (this.state === 'text') {
        const match = findUnquotedMarkup(this.pending, /<tool_call>/u, this.context);
        if (!match) {
          const offset = this.pending.lastIndexOf('<');
          const suffix = offset >= 0 ? this.pending.slice(offset) : '';
          const keep = !final && suffix && START.startsWith(suffix) ? suffix.length : 0;
          if (final && findUnquotedMarkup(this.pending, /<tool_call\b/u, this.context)) {
            throw failure('Incomplete Tool Call opening tag.');
          }
          const text = this.take(this.pending.length - keep);
          if (text) { output.push({ type: 'text', text }); this.context.write(text); }
          break;
        }
        const text = this.take(match.index);
        if (text) { output.push({ type: 'text', text }); this.context.write(text); }
        this.state = 'name';
        this.take(START.length);
        this.args = Object.create(null);
        continue;
      }

      if (this.state === 'name') {
        const name = this.until('<', final);
        if (name == null) break;
        this.pending = '<' + this.pending;
        this.name = name.trim();
        if (!/^[\w.:-]{1,256}$/u.test(this.name)) throw failure('Invalid function name.');
        if (this.catalog && !this.catalog.has(this.name)) throw failure(`Unknown or disabled tool: ${this.name}`);
        if (++this.budget.calls > MAX_GLMM_CALLS) throw failure('Too many Tool Calls in one response.');
        this.earlyStart = { id: newToolCallId(), toolName: this.name };
        output.push({ type: 'tool-input-start', ...this.earlyStart });
        this.state = 'argument';
      }

      if (this.state === 'argument' || this.state === 'value-start') {
        const whitespace = /^\s*/u.exec(this.pending)[0].length;
        this.take(whitespace);
        const markers = this.state === 'argument' ? [KEY, END] : [VALUE];
        const marker = markers.find(value => this.pending.startsWith(value));
        if (!marker) {
          if (!final && markers.some(value => value.startsWith(this.pending))) break;
          throw failure(`Malformed Tool Call (${this.state}).`);
        }
        this.take(marker.length);
        if (marker === END) {
          output.push({ type: 'calls', calls: [{ toolId: this.name, args: this.args }], earlyStart: this.earlyStart });
          this.converted = true;
          this.state = 'text';
        } else this.state = marker === KEY ? 'key' : 'value';
        continue;
      }

      if (this.state === 'key') {
        const key = this.until(KEY_END, final);
        if (key == null) break;
        this.key = key.trim();
        if (!this.key || Object.hasOwn(this.args, this.key)) throw failure('Empty or duplicate argument key.');
        this.state = 'value-start';
        continue;
      }

      if (this.state === 'value') {
        const index = this.pending.indexOf(VALUE_END);
        if (index >= 0) {
          const after = this.pending.slice(index + VALUE_END.length).trimStart();
          const boundary = [KEY, END].some(marker => after.startsWith(marker));
          if (!boundary && !final && [KEY, END].some(marker => marker.startsWith(after))) {
            this.fragments.push(this.take(index));
            break;
          }
          if (!boundary) {
            // A closing token inside a source file is still argument text.
            this.fragments.push(this.take(index + VALUE_END.length));
            continue;
          }
        }
        const value = this.until(VALUE_END, final);
        if (value == null) break;
        const root = this.catalog?.get(this.name);
        this.args[this.key] = decodeValue(value, root?.properties?.[this.key], root);
        this.state = 'argument';
      }
    }
    if (this.state !== 'text' && final) throw failure(`Incomplete Tool Call (${this.state}).`);
    if (this.state !== 'text' && this.budget.bytes + Buffer.byteLength(this.pending) > MAX_GLMM_BYTES) {
      throw failure('Tool calls exceed the 8 MiB response limit.');
    }
    return output;
  }
}
