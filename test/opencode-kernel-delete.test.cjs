'use strict';

// The kernel side of a permanent delete: the sidecar walks child sessions and
// deletes them, reporting whatever it could not confirm gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { OpenCodeSidecar } = require('../lib/opencode-sidecar');

// A sidecar that never started: the fields the method reads, and nothing else.
// kernelPoolingEnabled is false, so the non-pooled branch runs on this.client.
function fakeSidecar(client) {
  const sidecar = Object.create(OpenCodeSidecar.prototype);
  sidecar.client = client;
  sidecar.kernelPoolingEnabled = false;
  sidecar.log = { warn() {}, info() {} };
  sidecar.activeRuns = new Map();
  return sidecar;
}

function fakeClient(tree, { failDelete = [], hangDelete = [] } = {}) {
  const calls = { children: [], delete: [] };
  return {
    calls,
    session: {
      async children({ sessionID }) {
        calls.children.push(sessionID);
        const childIds = tree[sessionID] || [];
        return { data: childIds.map(id => ({ id })) };
      },
      async delete({ sessionID }) {
        calls.delete.push(sessionID);
        if (hangDelete.includes(sessionID)) return new Promise(() => {});
        if (failDelete.includes(sessionID)) return { error: { message: 'not found' } };
        return { data: true };
      }
    }
  };
}

const DIRECTORY = path.resolve('/tmp/yan-kernel-dir');

test('deleteKernelSessionTrees deletes every descendant before its parent', async () => {
  const tree = { root: ['childA', 'childB'], childA: ['grand'], childB: [], grand: [] };
  const client = fakeClient(tree);
  const sidecar = fakeSidecar(client);

  const result = await sidecar.deleteKernelSessionTrees(['root'], DIRECTORY);

  assert.equal(result.deleted, 4);
  assert.deepEqual(result.failed, []);
  assert.deepEqual([...client.calls.delete].sort(), ['childA', 'childB', 'grand', 'root']);
  // Each parent is deleted only after the children it listed.
  assert.ok(client.calls.delete.indexOf('grand') < client.calls.delete.indexOf('childA'));
  assert.ok(client.calls.delete.indexOf('childA') < client.calls.delete.indexOf('root'));
  assert.ok(client.calls.delete.indexOf('childB') < client.calls.delete.indexOf('root'));
});

test('deleteKernelSessionTrees reports a session whose delete failed', async () => {
  const tree = { root: ['childA'], childA: [] };
  const client = fakeClient(tree, { failDelete: ['childA'] });
  const sidecar = fakeSidecar(client);

  const result = await sidecar.deleteKernelSessionTrees(['root'], DIRECTORY);

  // The child keeps its parent_id, so a failed child survives its parent's
  // removal and stays deletable on the offline pass.
  assert.equal(result.deleted, 0, 'a failed child keeps its parent reachable');
  assert.deepEqual(result.failed, ['childA', 'root']);
});

test('a failed child listing keeps the parent for the offline pass', async () => {
  const client = {
    session: {
      async children() { throw new Error('kernel is gone'); },
      async delete() { throw new Error('must not be reached'); }
    }
  };
  const sidecar = fakeSidecar(client);

  const result = await sidecar.deleteKernelSessionTrees(['root'], DIRECTORY);

  assert.equal(result.deleted, 0);
  assert.deepEqual(result.failed, ['root']);
});

test('deleteKernelSessionTrees reports every ID when no kernel is running', async () => {
  const sidecar = fakeSidecar(null);
  const result = await sidecar.deleteKernelSessionTrees(['a', 'b'], DIRECTORY);
  assert.equal(result.notRunning, true);
  assert.equal(result.deleted, 0);
  assert.deepEqual(result.failed, ['a', 'b']);
});

test('deleteKernelSessionTrees ignores blank IDs and duplicates', async () => {
  const client = fakeClient({ dup: [] });
  const sidecar = fakeSidecar(client);

  const result = await sidecar.deleteKernelSessionTrees(['dup', 'dup', '  ', ''], DIRECTORY);

  assert.equal(result.deleted, 1);
  assert.deepEqual(client.calls.delete, ['dup']);
  assert.deepEqual(await sidecar.deleteKernelSessionTrees([], DIRECTORY), { deleted: 0, failed: [] });
});

test('a hung kernel call is bounded by the call timeout, not the delete queue', async () => {
  const tree = { slow: [] };
  const client = fakeClient(tree, { hangDelete: ['slow'] });
  const sidecar = fakeSidecar(client);

  const result = await sidecar.deleteKernelSessionTrees(['slow'], DIRECTORY, { callTimeoutMs: 200 });

  assert.equal(result.deleted, 0);
  assert.deepEqual(result.failed, ['slow']);
});
