'use strict';
// Local transport fixture: no external provider, cost or media generation.
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'daily-media-fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools: ['read_image', 'generate_image', 'generate_video', 'delete_asset'].map(name => ({ name, description: name,
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, source_path: { type: 'string' } } } })) };
  if (request.method === 'tools/call') result = { content: [{ type: 'text', text: request.params.name === 'generate_image' && request.params.arguments.source_path?.endsWith('screen.png') ? 'MEDIA_EDIT_VERIFIED' : 'UNEXPECTED_MEDIA_CALL' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
