'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('raw provider diagnostics distinguish truncated, empty and valid tool inputs without storing arguments', async () => {
  const { observeProviderFetch } = await import('../lib/provider-telemetry.mjs');
  const records = [];
  const chunks = [
    { choices: [{ index: 0, delta: { tool_calls: [
      { index: 0, function: { arguments: '{"command":"PRIVATE' } },
      { index: 1, function: { arguments: '{}' } },
      { index: 2, function: { arguments: '{"command":"PRIVATE_OK"}' } }
    ] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
  ];
  const wire = chunks.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('') + 'data: [DONE]\n\n';
  const fetch = observeProviderFetch(async () => new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }), { adapter: 'test', emit: row => records.push(row) });
  const response = await fetch('http://fixture', { body: JSON.stringify({ model: 'fixture', messages: [] }) });
  assert.equal(await response.text(), wire);
  const finish = records.find(row => row.event === 'finish');
  assert.equal(finish.toolInputs[0].validJson, false);
  assert.equal(finish.toolInputs[1].fieldCount, 0);
  assert.equal(finish.toolInputs[2].validJson, true);
  assert.equal(finish.toolInputs[2].fieldCount, 1);
  assert.ok(!JSON.stringify(records).includes('PRIVATE'));
});
