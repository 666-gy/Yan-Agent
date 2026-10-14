'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDeferredJsonStore } = require('../lib/main/deferred-json-store');
test('coalesces bursts, flushes concurrent changes and leaves a complete atomic document', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-deferred-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'data.json');
  let value = 0, snapshots = 0;
  const store = createDeferredJsonStore(file, () => { snapshots++; return { value }; }, { delay: 10000 });
  for (let i = 0; i < 100; i++) { value = i; store.schedule(); }
  await assert.rejects(fs.readFile(file), { code: 'ENOENT' });
  const first = store.flush(); value = 101; store.schedule();
  await Promise.all([first, store.flush()]);
  assert.deepEqual(JSON.parse(await fs.readFile(file)), { value: 101 });
  assert.ok(snapshots <= 2);
  assert.deepEqual(await fs.readdir(dir), ['data.json']);
});
