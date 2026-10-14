'use strict';
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Yan Text Kit', version: '1.0.0' } };
  else if (message.method === 'tools/list') result = { tools: [{ name: 'text_stats', description: 'Count Unicode code points, whitespace-separated segments, and lines of supplied text.', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200000 } }, required: ['text'], additionalProperties: false } }] };
  else if (message.method === 'tools/call' && message.params?.name === 'text_stats' && typeof message.params.arguments?.text === 'string') {
    const text = message.params.arguments.text;
    result = { content: [{ type: 'text', text: JSON.stringify({ characters: [...text].length, words: text.trim() ? text.trim().split(/\s+/u).length : 0, lines: text ? text.split(/\r\n|\r|\n/).length : 0 }) }] };
  } else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid request' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
});
