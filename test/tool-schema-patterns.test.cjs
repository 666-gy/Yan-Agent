'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../lib/tool-schema-patterns.mjs');

test('REA NUL pattern becomes portable without changing allowed path values', async () => {
  const { portableSchemaPattern } = await modulePromise;
  const original = String.raw`^[^\0]*$`;
  const next = portableSchemaPattern(original);
  assert.equal(next, String.raw`^[^\x00]*$`);
  for (const value of ['C:\\应用\\0.js', '/tmp/app.js', '', 'a\0b', '\\0', '00']) {
    assert.equal(new RegExp(next, 'u').test(value), new RegExp(original, 'u').test(value));
  }
  assert.equal(portableSchemaPattern('^[^\0]*$'), next);
  assert.equal(portableSchemaPattern('^[^\\\0]*$'), next);
  assert.equal(portableSchemaPattern(String.raw`\\0`), String.raw`\\0`);
  assert.equal(portableSchemaPattern(String.raw`\01`), String.raw`\01`);
});

test('nested schemas are normalized without rewriting property names or instance data', async () => {
  const { portableToolSchema } = await modulePromise;
  const pattern = String.raw`^[^\0]*$`;
  const schema = { type: 'object', required: ['pattern'], additionalProperties: false,
    properties: { pattern: { type: 'string', default: pattern, examples: [pattern], enum: [pattern] },
      paths: { type: 'array', items: { anyOf: [{ type: 'string', pattern }] } } },
    $defs: { path: { type: 'string', pattern } },
    patternProperties: { [pattern]: { type: 'string', pattern } } };
  const before = JSON.stringify(schema);
  const next = portableToolSchema(schema);
  assert.equal(next.properties.paths.items.anyOf[0].pattern, String.raw`^[^\x00]*$`);
  assert.equal(next.$defs.path.pattern, String.raw`^[^\x00]*$`);
  assert.ok(next.patternProperties[String.raw`^[^\x00]*$`]);
  assert.deepEqual(next.properties.pattern, schema.properties.pattern);
  assert.deepEqual(next.required, ['pattern']);
  assert.equal(next.additionalProperties, false);
  assert.equal(JSON.stringify(schema), before);
});

test('DS outbound fetch sends portable REA schema before the first request', async () => {
  const { createYanProviderFetch } = await import('../lib/opencode-dsml-provider.mjs');
  let calls = 0;
  const fetch = createYanProviderFetch(async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    const fn = body.tools[0].function;
    assert.equal(fn.name, 'mcp_1791536642591_analyze_javascript_application');
    assert.equal(fn.parameters.properties.input_path.pattern, String.raw`^[^\x00]*$`);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Analyze this application' }]);
    assert.equal(new Headers(init.headers).has('content-length'), false);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  await fetch('https://example.test/v1/chat/completions', { method: 'POST',
    headers: { 'content-length': '123' }, body: JSON.stringify({ model: 'deepseek-test',
      messages: [{ role: 'user', content: 'Analyze this application' }], tools: [{ type: 'function',
        function: { name: 'mcp_1791536642591_analyze_javascript_application', parameters: {
          type: 'object', properties: { input_path: { type: 'string', pattern: String.raw`^[^\0]*$` } }
        } } }] }) });
  assert.equal(calls, 1);
});
