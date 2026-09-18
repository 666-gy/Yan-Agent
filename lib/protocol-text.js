(function exposeProtocolText(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanProtocolText = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Track Markdown code delimiters across chunks. Protocol arguments are not
  // fed through this context, since they can contain arbitrary source code.
  class ProtocolTextContext {
    constructor() {
      this.inline = 0;
      this.fence = '';
      this.fenceLength = 0;
      this.lineStart = true;
      this.delimiter = '';
      this.delimiterLength = 0;
      this.delimiterAtLineStart = false;
    }

    resolveDelimiter() {
      const marker = this.delimiter;
      const length = this.delimiterLength;
      if (!marker) return;
      if (this.fence) {
        if (this.delimiterAtLineStart && marker === this.fence && length >= this.fenceLength) {
          this.fence = '';
          this.fenceLength = 0;
        }
      } else if (this.inline) {
        if (marker === '`' && length === this.inline) this.inline = 0;
      } else if (this.delimiterAtLineStart && length >= 3) {
        this.fence = marker;
        this.fenceLength = length;
      } else if (marker === '`') {
        this.inline = length;
      }
      this.delimiter = '';
      this.delimiterLength = 0;
    }

    write(value) {
      for (const character of value) {
        if (character === this.delimiter) {
          this.delimiterLength += 1;
          continue;
        }
        this.resolveDelimiter();
        if (character === '`' || character === '~') {
          this.delimiter = character;
          this.delimiterLength = 1;
          this.delimiterAtLineStart = this.lineStart;
        }
        if (character === '\n' || character === '\r') this.lineStart = true;
        else if (character !== ' ' && character !== '\t') this.lineStart = false;
      }
    }

    get literal() {
      this.resolveDelimiter();
      return !!(this.inline || this.fence);
    }
  }

  function findUnquotedMarkup(value, pattern, context = new ProtocolTextContext()) {
    const source = String(value || '');
    const probe = Object.assign(new ProtocolTextContext(), context);
    const matches = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '') + 'g');
    let offset = 0;
    let match;
    while ((match = matches.exec(source))) {
      probe.write(source.slice(offset, match.index));
      if (!probe.literal) return match;
      // A quoted opening tag can match all the way to a real call's closing
      // tag. Resume after its first character so that real call is still seen.
      probe.write(source[match.index]);
      offset = match.index + 1;
      matches.lastIndex = offset;
    }
    return null;
  }

  function containsDsmlMarkup(value) {
    return !!findUnquotedMarkup(value, /<\/?[|｜]{2}\s*DSML\s*[|｜]{2}/iu);
  }

  return { ProtocolTextContext, findUnquotedMarkup, containsDsmlMarkup };
}));
