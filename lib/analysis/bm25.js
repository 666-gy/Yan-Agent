'use strict';

// BM25 over mixed Latin/CJK text. Chinese (and other CJK) runs are tokenized
// as character bigrams, which gives decent recall without a segmentation
// dependency. Used by `code_search` (workspace) and `history_search`
// (analysis notes / harness history) in the Yan Analysis MCP.

const K1 = 1.5;
const B = 0.75;

function tokenize(text) {
  const normalized = String(text || '').toLowerCase().replace(/\r\n?/g, '\n');
  const tokens = [];
  for (const match of normalized.matchAll(/[a-z0-9_$]+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g)) {
    const run = match[0];
    if (!/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(run)) {
      tokens.push(run);
      continue;
    }
    // CJK run: bigrams (and the run itself when it is a single character).
    if (run.length === 1) { tokens.push(run); continue; }
    for (let index = 0; index < run.length - 1; index++) {
      tokens.push(run.slice(index, index + 2));
    }
  }
  return tokens;
}

function createBm25Index() {
  const docs = new Map(); // id -> { tokens Map, length, meta }
  const df = new Map();   // token -> document count
  let totalLength = 0;

  const remove = (id) => {
    const doc = docs.get(id);
    if (!doc) return;
    for (const token of doc.tokens.keys()) {
      const count = df.get(token) || 0;
      if (count <= 1) df.delete(token);
      else df.set(token, count - 1);
    }
    totalLength -= doc.length;
    docs.delete(id);
  };

  const add = (id, body, meta = {}) => {
    remove(id);
    const tokens = tokenize(body);
    if (!tokens.length) return;
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    for (const token of counts.keys()) df.set(token, (df.get(token) || 0) + 1);
    docs.set(id, { tokens: counts, length: tokens.length, meta });
    totalLength += tokens.length;
  };

  const search = (query, { limit = 8 } = {}) => {
    const queryTokens = tokenize(query);
    if (!queryTokens.length || !docs.size) return [];
    const avgLength = totalLength / docs.size;
    const scores = new Map();
    for (const token of new Set(queryTokens)) {
      const documentFrequency = df.get(token) || 0;
      if (!documentFrequency) continue;
      const idf = Math.log(1 + (docs.size - documentFrequency + 0.5) / (documentFrequency + 0.5));
      for (const [id, doc] of docs) {
        const frequency = doc.tokens.get(token) || 0;
        if (!frequency) continue;
        const weight = (frequency * (K1 + 1))
          / (frequency + K1 * (1 - B + B * (doc.length / avgLength)));
        scores.set(id, (scores.get(id) || 0) + idf * weight);
      }
    }
    return [...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, Math.max(1, limit))
      .map(([id, score]) => ({ id, score: Number(score.toFixed(4)), meta: docs.get(id).meta }));
  };

  return { add, remove, search, get size() { return docs.size; }, get avgLength() { return totalLength / Math.max(1, docs.size); } };
}

module.exports = { tokenize, createBm25Index };
