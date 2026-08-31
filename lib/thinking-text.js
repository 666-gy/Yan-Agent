(function exposeThinkingText(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanThinkingText = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const OPEN_TAG = '<thinking>';
  const CLOSE_TAG = '</thinking>';

  function trailingTagPrefixLength(value, tag) {
    const text = String(value || '');
    const lower = text.toLowerCase();
    const limit = Math.min(lower.length, tag.length - 1);
    for (let length = limit; length > 0; length--) {
      if (lower.endsWith(tag.slice(0, length))) return length;
    }
    return 0;
  }

  function appendBlock(current, value) {
    const next = String(value || '').trim();
    if (!next) return current;
    return current ? `${current}\n\n${next}` : next;
  }

  function splitTaggedThinkingText(value) {
    const source = String(value || '');
    const lower = source.toLowerCase();
    let cursor = 0;
    let text = '';
    let thinking = '';
    let incomplete = false;

    while (cursor < source.length) {
      const openAt = lower.indexOf(OPEN_TAG, cursor);
      if (openAt < 0) {
        const remainder = source.slice(cursor);
        const heldLength = trailingTagPrefixLength(remainder, OPEN_TAG);
        text += heldLength ? remainder.slice(0, -heldLength) : remainder;
        incomplete = heldLength > 0;
        break;
      }

      text += source.slice(cursor, openAt);
      const bodyStart = openAt + OPEN_TAG.length;
      const closeAt = lower.indexOf(CLOSE_TAG, bodyStart);
      if (closeAt < 0) {
        const remainder = source.slice(bodyStart);
        const heldLength = trailingTagPrefixLength(remainder, CLOSE_TAG);
        thinking = appendBlock(thinking, heldLength ? remainder.slice(0, -heldLength) : remainder);
        incomplete = true;
        cursor = source.length;
        break;
      }

      thinking = appendBlock(thinking, source.slice(bodyStart, closeAt));
      cursor = closeAt + CLOSE_TAG.length;
    }

    return {
      text: text.replace(/<\/thinking>/giu, ''),
      thinking,
      incomplete
    };
  }

  return { splitTaggedThinkingText };
}));
