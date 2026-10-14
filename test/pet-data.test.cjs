'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeDataSource, readPetData, createPetDataPoller } = require('../lib/pet-data');
const source = { url: 'https://balance.example/account', value_path: ['data', 'balance'], prefix: '$', decimals: 2 };
const config = { api: { connections: [{ id: 'account', providerId: 'relay', supplierId: 'one' }],
  providerSuppliers: { relay: [{ id: 'one', baseUrl: 'https://balance.example/v1', apiKey: 'private-key' }] } } };

test('data binding reads real JSON fields and authenticates only to the account origin', async () => {
  let request;
  const result = await readPetData({ ...source, connection_id: 'account' }, { config, fetch: async (url, init) => {
    request = { url, init }; return Response.json({ data: { balance: 12.345 } });
  } });
  assert.equal(result.text, '$12.35');
  assert.equal(request.init.headers.Authorization, 'Bearer private-key');
  assert.equal(request.init.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(result), /private-key|Authorization/);
  let calls = 0;
  await assert.rejects(readPetData({ ...source, url: 'https://other.example/account', connection_id: 'account' }, {
    config, fetch: async () => { calls++; }
  }), /同源/);
  assert.equal(calls, 0);
  await assert.rejects(readPetData(source, { config: { permissions: { allowNetwork: false } },
    fetch: async () => { calls++; } }), /未允许联网/);
  assert.equal(calls, 0);
  await assert.rejects(readPetData({ ...source, connection_id: 'missing' }, { config }), /不可用/);
});

test('balance bindings convert quota units and subtract usage without leaking credentials', async () => {
  const result = await readPetData({ ...source, connection_id: 'account', multiplier: 0.01,
    subtract_source: { url: 'https://balance.example/usage', value_path: ['used'], multiplier: 0.01 }
  }, { config, fetch: async url => url.endsWith('/usage') ? Response.json({ used: 100 }) : Response.json({ data: { balance: 1234 } }) });
  assert.equal(result.text, '$11.34');
  let calls = 0;
  await assert.rejects(readPetData({ ...source, connection_id: 'account', subtract_source: {
    url: 'https://other.example/usage', value_path: ['used']
  } }, { config, fetch: async () => { calls++; } }), /同源/);
  assert.equal(calls, 0);
});

test('data sources reject malformed fields and bounded responses', async () => {
  for (const url of ['http://balance.example', 'file:///config', 'https://key:secret@balance.example']) {
    assert.throws(() => normalizeDataSource({ ...source, url }), /HTTPS/);
  }
  assert.throws(() => normalizeDataSource({ ...source, value_path: ['__proto__'] }), /value_path/);
  assert.equal(normalizeDataSource({ ...source, interval_seconds: 1 }).interval_seconds, 15);
  await assert.rejects(readPetData(source, { fetch: async () => Response.json({ data: {} }) }), /缺少/);
  await assert.rejects(readPetData(source, { fetch: async () => Response.json({ data: { balance: {} } }) }), /字段必须/);
  await assert.rejects(readPetData(source, { fetch: async () => new Response('x'.repeat(128 * 1024 + 1)) }), /过大/);
  await assert.rejects(readPetData(source, { fetch: async () => new Response('private error', { status: 401 }) }), /HTTP 401/);
});

test('poller stops old requests, avoids overlapping refresh and hides remote errors', async () => {
  const rows = []; let calls = 0, release;
  const poller = createPetDataPoller({ emit: row => rows.push(row), loadConfig: () => ({}), fetch: async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { release = () => resolve(Response.json({ data: { balance: 1 } })); });
    if (calls === 3) throw new Error('private-key remote failure');
    return Response.json({ data: { balance: 2 } });
  } });
  poller.select({ id: 'old', dataSource: source });
  await poller.refresh(); assert.equal(calls, 1);
  poller.select({ id: 'new', dataSource: source });
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows.some(row => row.petId === 'old' && row.status === 'ready'), false);
  assert.equal(rows.at(-1).text, '$2.00');
  await poller.refresh();
  assert.equal(rows.at(-1).status, 'error');
  assert.doesNotMatch(JSON.stringify(rows), /private-key/);
  poller.stop(); await poller.refresh(); assert.equal(calls, 3);
});
